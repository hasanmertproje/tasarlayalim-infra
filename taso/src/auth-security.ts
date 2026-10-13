import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type TrustedDeviceRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  label: string;
  userAgent?: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  revokedAt?: number;
};

type EncryptedValue = { iv: string; tag: string; ciphertext: string };

type UserSecurityState = {
  totpSecret?: EncryptedValue;
  recoveryCodeHashes: string[];
  trustedDeviceDays: number;
  trustedDevices: TrustedDeviceRecord[];
};

type AuthSecurityStateV2 = {
  version: 2;
  users: Record<string, UserSecurityState>;
};

type AuthSecurityStateV1 = {
  version?: 1;
  totpSecret?: EncryptedValue;
  recoveryCodeHashes?: string[];
  trustedDeviceDays?: number;
  trustedDevices?: Array<Omit<TrustedDeviceRecord, 'userId'>>;
};

const DEFAULT_DAYS = 30;

function deriveKey() {
  const explicit = process.env.TASO_AUTH_ENCRYPTION_KEY?.trim();
  if (explicit) {
    const candidate = /^[a-f0-9]{64}$/i.test(explicit) ? Buffer.from(explicit, 'hex') : Buffer.from(explicit, 'base64');
    if (candidate.length === 32) return candidate;
  }
  const gateway = process.env.TASO_GATEWAY_SECRET?.trim();
  if (gateway) {
    return Buffer.from(hkdfSync('sha256', Buffer.from(gateway), Buffer.from('taso-auth-v30'), Buffer.from('totp-at-rest'), 32));
  }
  if (process.env.NODE_ENV !== 'production') {
    return createHash('sha256').update(process.env.TASO_OWNER_PASSWORD || 'taso-development-only-key').digest();
  }
  return undefined;
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function emptyUser(): UserSecurityState {
  return { recoveryCodeHashes: [], trustedDeviceDays: DEFAULT_DAYS, trustedDevices: [] };
}

export class AuthSecurityStore {
  private state: AuthSecurityStateV2;
  private readonly file = process.env.TASO_AUTH_SECURITY_FILE?.trim() || (process.env.NODE_ENV === 'production' ? '/data/taso-auth-security.json' : undefined);
  private readonly key = deriveKey();

  constructor(private readonly ownerUserId = 'user_owner') {
    this.state = this.load();
    this.cleanupExpired();
  }

  encryptionReady() { return Boolean(this.key); }

  hasTotp(userId = this.ownerUserId) {
    return Boolean(this.user(userId).totpSecret);
  }

  trustedDeviceDays(userId = this.ownerUserId) {
    return this.user(userId).trustedDeviceDays;
  }

  setTrustedDeviceDays(userIdOrDays: string | number, maybeDays?: number) {
    const userId = typeof userIdOrDays === 'string' ? userIdOrDays : this.ownerUserId;
    const days = typeof userIdOrDays === 'number' ? userIdOrDays : Number(maybeDays);
    const normalized = Math.max(1, Math.min(365, Math.floor(days)));
    this.user(userId).trustedDeviceDays = normalized;
    this.save();
    return normalized;
  }

  setTotpSecret(userIdOrSecret: string, maybeSecret?: string) {
    const userId = maybeSecret === undefined ? this.ownerUserId : userIdOrSecret;
    const secret = maybeSecret === undefined ? userIdOrSecret : maybeSecret;
    if (!this.key) throw new Error('TOTP encryption is not configured.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    this.user(userId).totpSecret = {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: encrypted.toString('base64'),
    };
    this.save();
  }

  getTotpSecret(userId = this.ownerUserId) {
    const value = this.user(userId).totpSecret;
    if (!value || !this.key) return undefined;
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  setRecoveryCodes(userIdOrCodes: string | string[], maybeCodes?: string[]) {
    const userId = Array.isArray(userIdOrCodes) ? this.ownerUserId : userIdOrCodes;
    const codes = Array.isArray(userIdOrCodes) ? userIdOrCodes : maybeCodes ?? [];
    this.user(userId).recoveryCodeHashes = codes.map((code) => hash(code.trim().toUpperCase()));
    this.save();
  }

  consumeRecoveryCode(userIdOrCode: string, maybeCode?: string) {
    const userId = maybeCode === undefined ? this.ownerUserId : userIdOrCode;
    const code = maybeCode === undefined ? userIdOrCode : maybeCode;
    const state = this.user(userId);
    const digest = hash(code.trim().toUpperCase());
    const index = state.recoveryCodeHashes.indexOf(digest);
    if (index < 0) return false;
    state.recoveryCodeHashes.splice(index, 1);
    this.save();
    return true;
  }

  createTrustedDevice(userIdOrInput: string | { token: string; label: string; userAgent?: string }, maybeInput?: { token: string; label: string; userAgent?: string }) {
    const userId = typeof userIdOrInput === 'string' ? userIdOrInput : this.ownerUserId;
    const input = typeof userIdOrInput === 'string' ? maybeInput! : userIdOrInput;
    const state = this.user(userId);
    const now = Date.now();
    const record: TrustedDeviceRecord = {
      id: `device_${randomBytes(9).toString('base64url')}`,
      userId,
      tokenHash: hash(input.token),
      label: input.label.slice(0, 80),
      userAgent: input.userAgent?.slice(0, 220),
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + state.trustedDeviceDays * 24 * 60 * 60 * 1000,
    };
    state.trustedDevices.push(record);
    this.save();
    return record;
  }

  validateTrustedDevice(userIdOrToken: string, maybeToken?: string) {
    const userId = maybeToken === undefined ? undefined : userIdOrToken;
    const token = maybeToken === undefined ? userIdOrToken : maybeToken;
    const digest = hash(token);
    const now = Date.now();
    const states = userId ? [this.user(userId)] : Object.values(this.state.users);
    for (const state of states) {
      const record = state.trustedDevices.find((entry) => entry.tokenHash === digest && !entry.revokedAt && entry.expiresAt > now);
      if (!record) continue;
      record.lastUsedAt = now;
      this.save();
      return record;
    }
    return undefined;
  }

  listTrustedDevices(userId = this.ownerUserId) {
    this.cleanupExpired();
    return this.user(userId).trustedDevices.map(({ tokenHash: _tokenHash, ...safe }) => safe);
  }

  revokeTrustedDevice(userIdOrDeviceId: string, maybeDeviceId?: string) {
    const userId = maybeDeviceId === undefined ? this.ownerUserId : userIdOrDeviceId;
    const deviceId = maybeDeviceId === undefined ? userIdOrDeviceId : maybeDeviceId;
    const record = this.user(userId).trustedDevices.find((entry) => entry.id === deviceId);
    if (!record || record.revokedAt) return false;
    record.revokedAt = Date.now();
    this.save();
    return true;
  }

  revokeAllTrustedDevices(userId = this.ownerUserId) {
    const now = Date.now();
    let count = 0;
    for (const record of this.user(userId).trustedDevices) {
      if (!record.revokedAt && record.expiresAt > now) {
        record.revokedAt = now;
        count += 1;
      }
    }
    this.save();
    return count;
  }

  resetUser(userId: string) {
    this.state.users[userId] = emptyUser();
    this.save();
  }

  private user(userId: string) {
    if (!this.state.users[userId]) this.state.users[userId] = emptyUser();
    return this.state.users[userId]!;
  }

  private cleanupExpired() {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let changed = false;
    for (const state of Object.values(this.state.users)) {
      const before = state.trustedDevices.length;
      state.trustedDevices = state.trustedDevices.filter((record) => !record.revokedAt || record.revokedAt > cutoff);
      if (before !== state.trustedDevices.length) changed = true;
    }
    if (changed) this.save();
  }

  private load(): AuthSecurityStateV2 {
    if (!this.file || !existsSync(this.file)) return { version: 2, users: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as AuthSecurityStateV2 | AuthSecurityStateV1;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid auth security document.');
      if ((parsed as AuthSecurityStateV2).version === 2 && (!('users' in parsed) || typeof (parsed as AuthSecurityStateV2).users !== 'object' || (parsed as AuthSecurityStateV2).users === null)) throw new Error('Invalid auth security users.');
      if ((parsed as AuthSecurityStateV2).version === 2 && (parsed as AuthSecurityStateV2).users) {
        const source = parsed as AuthSecurityStateV2;
        const users: Record<string, UserSecurityState> = {};
        for (const [userId, value] of Object.entries(source.users)) {
          users[userId] = {
            totpSecret: value?.totpSecret,
            recoveryCodeHashes: Array.isArray(value?.recoveryCodeHashes) ? value.recoveryCodeHashes : [],
            trustedDeviceDays: Number.isFinite(value?.trustedDeviceDays) ? Math.max(1, Math.min(365, Math.floor(value.trustedDeviceDays))) : DEFAULT_DAYS,
            trustedDevices: Array.isArray(value?.trustedDevices) ? value.trustedDevices.map((record) => ({ ...record, userId })) : [],
          };
        }
        return { version: 2, users };
      }

      const legacy = parsed as AuthSecurityStateV1;
      const owner: UserSecurityState = {
        totpSecret: legacy.totpSecret,
        recoveryCodeHashes: Array.isArray(legacy.recoveryCodeHashes) ? legacy.recoveryCodeHashes : [],
        trustedDeviceDays: Number.isFinite(legacy.trustedDeviceDays) ? Math.max(1, Math.min(365, Math.floor(legacy.trustedDeviceDays!))) : DEFAULT_DAYS,
        trustedDevices: Array.isArray(legacy.trustedDevices)
          ? legacy.trustedDevices.map((record) => ({ ...record, userId: this.ownerUserId }))
          : [],
      };
      return { version: 2, users: { [this.ownerUserId]: owner } };
    } catch (error) {
      throw new Error('Taso auth security state could not be loaded; refusing to reset enrolled 2FA.', { cause: error });
    }
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

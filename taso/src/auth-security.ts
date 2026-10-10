import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type TrustedDeviceRecord = {
  id: string;
  tokenHash: string;
  label: string;
  userAgent?: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  revokedAt?: number;
};

type EncryptedValue = { iv: string; tag: string; ciphertext: string };

type AuthSecurityState = {
  version: 1;
  totpSecret?: EncryptedValue;
  recoveryCodeHashes: string[];
  trustedDeviceDays: number;
  trustedDevices: TrustedDeviceRecord[];
};

const DEFAULT_STATE: AuthSecurityState = {
  version: 1,
  recoveryCodeHashes: [],
  trustedDeviceDays: 30,
  trustedDevices: [],
};

function deriveKey() {
  const explicit = process.env.TASO_AUTH_ENCRYPTION_KEY?.trim();
  if (explicit) {
    const candidate = /^[a-f0-9]{64}$/i.test(explicit) ? Buffer.from(explicit, 'hex') : Buffer.from(explicit, 'base64');
    if (candidate.length === 32) return candidate;
  }
  const gateway = process.env.TASO_GATEWAY_SECRET?.trim();
  if (gateway) {
    return Buffer.from(hkdfSync('sha256', Buffer.from(gateway), Buffer.from('taso-auth-v18'), Buffer.from('totp-at-rest'), 32));
  }
  if (process.env.NODE_ENV !== 'production') {
    return createHash('sha256').update(process.env.TASO_OWNER_PASSWORD || 'taso-development-only-key').digest();
  }
  return undefined;
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export class AuthSecurityStore {
  private state: AuthSecurityState;
  private readonly file = process.env.TASO_AUTH_SECURITY_FILE?.trim() || (process.env.NODE_ENV === 'production' ? '/data/taso-auth-security.json' : undefined);
  private readonly key = deriveKey();

  constructor() {
    this.state = this.load();
    this.cleanupExpired();
  }

  encryptionReady() { return Boolean(this.key); }
  hasTotp() { return Boolean(this.state.totpSecret); }
  trustedDeviceDays() { return this.state.trustedDeviceDays; }

  setTrustedDeviceDays(days: number) {
    const normalized = Math.max(1, Math.min(365, Math.floor(days)));
    this.state.trustedDeviceDays = normalized;
    this.save();
    return normalized;
  }

  setTotpSecret(secret: string) {
    if (!this.key) throw new Error('TOTP encryption is not configured.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    this.state.totpSecret = {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: encrypted.toString('base64'),
    };
    this.save();
  }

  getTotpSecret() {
    if (!this.state.totpSecret || !this.key) return undefined;
    const encrypted = this.state.totpSecret;
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  setRecoveryCodes(codes: string[]) {
    this.state.recoveryCodeHashes = codes.map(hash);
    this.save();
  }

  consumeRecoveryCode(code: string) {
    const digest = hash(code.trim().toUpperCase());
    const index = this.state.recoveryCodeHashes.indexOf(digest);
    if (index < 0) return false;
    this.state.recoveryCodeHashes.splice(index, 1);
    this.save();
    return true;
  }

  createTrustedDevice(input: { token: string; label: string; userAgent?: string }) {
    const now = Date.now();
    const record: TrustedDeviceRecord = {
      id: `device_${randomBytes(9).toString('base64url')}`,
      tokenHash: hash(input.token),
      label: input.label.slice(0, 80),
      userAgent: input.userAgent?.slice(0, 220),
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + this.state.trustedDeviceDays * 24 * 60 * 60 * 1000,
    };
    this.state.trustedDevices.push(record);
    this.save();
    return record;
  }

  validateTrustedDevice(token: string) {
    const digest = hash(token);
    const now = Date.now();
    const record = this.state.trustedDevices.find((entry) => entry.tokenHash === digest && !entry.revokedAt && entry.expiresAt > now);
    if (!record) return undefined;
    record.lastUsedAt = now;
    this.save();
    return record;
  }

  listTrustedDevices() {
    this.cleanupExpired();
    return this.state.trustedDevices.map(({ tokenHash: _tokenHash, ...safe }) => safe);
  }

  revokeTrustedDevice(id: string) {
    const record = this.state.trustedDevices.find((entry) => entry.id === id);
    if (!record || record.revokedAt) return false;
    record.revokedAt = Date.now();
    this.save();
    return true;
  }

  revokeAllTrustedDevices() {
    const now = Date.now();
    let count = 0;
    for (const record of this.state.trustedDevices) {
      if (!record.revokedAt && record.expiresAt > now) {
        record.revokedAt = now;
        count += 1;
      }
    }
    this.save();
    return count;
  }

  private cleanupExpired() {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const before = this.state.trustedDevices.length;
    this.state.trustedDevices = this.state.trustedDevices.filter((record) => !record.revokedAt || record.revokedAt > cutoff);
    if (before !== this.state.trustedDevices.length) this.save();
  }

  private load(): AuthSecurityState {
    if (!this.file || !existsSync(this.file)) return structuredClone(DEFAULT_STATE);
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<AuthSecurityState>;
      return {
        version: 1,
        totpSecret: parsed.totpSecret,
        recoveryCodeHashes: Array.isArray(parsed.recoveryCodeHashes) ? parsed.recoveryCodeHashes : [],
        trustedDeviceDays: Number.isFinite(parsed.trustedDeviceDays) ? Math.max(1, Math.min(365, Math.floor(parsed.trustedDeviceDays!))) : 30,
        trustedDevices: Array.isArray(parsed.trustedDevices) ? parsed.trustedDevices : [],
      };
    } catch {
      return structuredClone(DEFAULT_STATE);
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

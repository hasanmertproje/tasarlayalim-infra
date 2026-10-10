import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type TasoPermission =
  | 'dashboard.read'
  | 'projects.read'
  | 'projects.write'
  | 'missions.read'
  | 'missions.write'
  | 'agents.read'
  | 'agents.write'
  | 'approvals.read'
  | 'approvals.decide'
  | 'knowledge.read'
  | 'knowledge.write'
  | 'integrations.read'
  | 'integrations.write'
  | 'settings.read'
  | 'settings.write'
  | 'security.read'
  | 'security.write'
  | 'users.read'
  | 'users.write'
  | 'roles.read'
  | 'roles.write'
  | 'audit.read';

export type TasoRole = {
  id: string;
  name: string;
  description: string;
  permissions: TasoPermission[];
  system: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TasoUser = {
  id: string;
  email: string;
  displayName: string;
  roleIds: string[];
  active: boolean;
  owner: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  passwordConfigured: boolean;
  passwordChangeRequired: boolean;
};

type StoredTasoUser = Omit<TasoUser, 'passwordConfigured'> & {
  passwordHash?: string;
};

type IdentitySnapshot = {
  version?: 2;
  roles: TasoRole[];
  users: StoredTasoUser[];
};

const ALL_PERMISSIONS: TasoPermission[] = [
  'dashboard.read',
  'projects.read','projects.write',
  'missions.read','missions.write',
  'agents.read','agents.write',
  'approvals.read','approvals.decide',
  'knowledge.read','knowledge.write',
  'integrations.read','integrations.write',
  'settings.read','settings.write',
  'security.read','security.write',
  'users.read','users.write',
  'roles.read','roles.write',
  'audit.read',
];

const READ_ONLY_PERMISSIONS: TasoPermission[] = [
  'dashboard.read','projects.read','missions.read','agents.read','approvals.read',
  'knowledge.read','integrations.read','settings.read','security.read','users.read','roles.read','audit.read',
];

const OPERATOR_PERMISSIONS: TasoPermission[] = [
  'dashboard.read',
  'projects.read','projects.write',
  'missions.read','missions.write',
  'agents.read','agents.write',
  'approvals.read','approvals.decide',
  'knowledge.read','knowledge.write',
  'integrations.read',
  'settings.read',
  'security.read',
  'audit.read',
];

function isoNow() { return new Date().toISOString(); }
function normalizeEmail(value: string) { return value.trim().toLowerCase(); }
function id(prefix: string) { return `${prefix}_${randomBytes(10).toString('hex')}`; }

function defaultFilePath() {
  return process.env.TASO_IDENTITY_FILE?.trim()
    || (process.env.NODE_ENV === 'production' ? '/data/taso-identities.json' : undefined);
}

function builtInRoles(now = isoNow()): TasoRole[] {
  return [
    {
      id: 'role_owner',
      name: 'Ana Admin',
      description: 'Taso üzerindeki tüm yetkilere sahip, kaldırılamayan ana yönetici rolü.',
      permissions: [...ALL_PERMISSIONS],
      system: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'role_admin',
      name: 'Admin',
      description: 'Kullanıcı ve rol yönetimi dahil geniş yönetim yetkileri.',
      permissions: [...ALL_PERMISSIONS],
      system: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'role_operator',
      name: 'Operatör',
      description: 'Günlük operasyonları ve onay akışlarını yönetebilir; kimlik ve kritik ayar yönetemez.',
      permissions: [...OPERATOR_PERMISSIONS],
      system: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'role_viewer',
      name: 'Görüntüleyici',
      description: 'Salt okunur görünürlük.',
      permissions: [...READ_ONLY_PERMISSIONS],
      system: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function uniquePermissions(values: string[]): TasoPermission[] {
  const allowed = new Set(ALL_PERMISSIONS);
  return [...new Set(values.filter((value): value is TasoPermission => allowed.has(value as TasoPermission)))];
}

export function createPasswordHash(password: string) {
  if (password.length < 12 || password.length > 256) throw new Error('Password must be between 12 and 256 characters.');
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyStoredPassword(password: string, configuredHash: string | undefined) {
  const [scheme, saltB64, hashB64] = (configuredHash ?? '').split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) {
    scryptSync(password, Buffer.from('taso-auth-dummy-salt'), 32);
    return false;
  }
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const hash = Buffer.from(hashB64, 'base64');
    const candidate = scryptSync(password, salt, hash.length);
    return candidate.length === hash.length && timingSafeEqual(candidate, hash);
  } catch {
    return false;
  }
}

function publicUser(user: StoredTasoUser): TasoUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return { ...safe, passwordConfigured: Boolean(user.owner || passwordHash) };
}

export class IdentityStore {
  private readonly filePath = defaultFilePath();
  private snapshot: IdentitySnapshot;

  constructor(ownerEmail = process.env.TASO_OWNER_EMAIL || '') {
    this.snapshot = this.load();
    this.ensureBuiltIns();
    if (ownerEmail.trim()) this.ensureOwner(ownerEmail);
    this.persist();
  }

  listPermissions() { return [...ALL_PERMISSIONS]; }
  listRoles() { return this.snapshot.roles.map((role) => ({ ...role, permissions: [...role.permissions] })); }
  listUsers() { return this.snapshot.users.map((user) => ({ ...publicUser(user), roleIds: [...user.roleIds] })); }

  getUserById(userId: string) {
    const user = this.snapshot.users.find((entry) => entry.id === userId);
    return user ? publicUser(user) : undefined;
  }

  getUserByEmail(email: string) {
    const normalized = normalizeEmail(email);
    const user = this.snapshot.users.find((entry) => entry.email === normalized);
    return user ? publicUser(user) : undefined;
  }

  getCredentialHash(userId: string) {
    return this.snapshot.users.find((entry) => entry.id === userId)?.passwordHash;
  }

  verifyCredential(userId: string, password: string) {
    const stored = this.snapshot.users.find((entry) => entry.id === userId);
    if (!stored || stored.owner) return false;
    return verifyStoredPassword(password, stored.passwordHash);
  }

  setPassword(userId: string, password: string, requireChange = false) {
    const user = this.snapshot.users.find((entry) => entry.id === userId);
    if (!user) throw new Error('User not found.');
    if (user.owner) throw new Error('Owner password is managed by environment configuration.');
    user.passwordHash = createPasswordHash(password);
    user.passwordChangeRequired = requireChange;
    user.updatedAt = isoNow();
    this.persist();
    return publicUser(user);
  }

  clearPasswordChangeRequirement(userId: string) {
    const user = this.snapshot.users.find((entry) => entry.id === userId);
    if (!user) return false;
    user.passwordChangeRequired = false;
    user.updatedAt = isoNow();
    this.persist();
    return true;
  }

  permissionsForUser(user: TasoUser | undefined) {
    if (!user || !user.active) return [] as TasoPermission[];
    const permissions = new Set<TasoPermission>();
    for (const roleId of user.roleIds) {
      const role = this.snapshot.roles.find((entry) => entry.id === roleId);
      for (const permission of role?.permissions ?? []) permissions.add(permission);
    }
    return [...permissions];
  }

  can(user: TasoUser | undefined, permission: TasoPermission) {
    return this.permissionsForUser(user).includes(permission);
  }

  ensureOwner(emailRaw: string) {
    const email = normalizeEmail(emailRaw);
    if (!email) throw new Error('Owner email is required.');
    const now = isoNow();
    let user = this.snapshot.users.find((entry) => entry.owner);
    if (!user) {
      user = {
        id: 'user_owner',
        email,
        displayName: 'Ana Admin',
        roleIds: ['role_owner'],
        active: true,
        owner: true,
        createdAt: now,
        updatedAt: now,
        passwordChangeRequired: false,
      };
      this.snapshot.users.push(user);
    } else {
      user.email = email;
      user.active = true;
      user.owner = true;
      user.passwordChangeRequired = false;
      if (!user.roleIds.includes('role_owner')) user.roleIds.push('role_owner');
      user.updatedAt = now;
    }
    this.persist();
    return publicUser(user);
  }

  createUser(input: { email: string; displayName?: string; roleIds?: string[]; password?: string; passwordChangeRequired?: boolean }) {
    const email = normalizeEmail(input.email);
    if (!email || !email.includes('@')) throw new Error('Valid email is required.');
    if (this.snapshot.users.some((user) => user.email === email)) throw new Error('User already exists.');
    const roleIds = this.validateRoleIds(input.roleIds?.length ? input.roleIds : ['role_viewer']);
    const now = isoNow();
    const user: StoredTasoUser = {
      id: id('user'),
      email,
      displayName: input.displayName?.trim().slice(0, 100) || email.split('@')[0] || email,
      roleIds,
      active: true,
      owner: false,
      createdAt: now,
      updatedAt: now,
      passwordHash: input.password ? createPasswordHash(input.password) : undefined,
      passwordChangeRequired: Boolean(input.passwordChangeRequired),
    };
    this.snapshot.users.push(user);
    this.persist();
    return publicUser(user);
  }

  updateUser(userId: string, input: { displayName?: string; roleIds?: string[]; active?: boolean }) {
    const user = this.snapshot.users.find((entry) => entry.id === userId);
    if (!user) throw new Error('User not found.');
    if (user.owner && input.active === false) throw new Error('Owner account cannot be disabled.');
    if (user.owner && input.roleIds && !input.roleIds.includes('role_owner')) throw new Error('Owner role cannot be removed from owner account.');
    if (input.displayName !== undefined) user.displayName = input.displayName.trim().slice(0, 100) || user.displayName;
    if (input.roleIds !== undefined) user.roleIds = this.validateRoleIds(input.roleIds);
    if (input.active !== undefined) user.active = Boolean(input.active);
    user.updatedAt = isoNow();
    this.persist();
    return publicUser(user);
  }

  createRole(input: { name: string; description?: string; permissions?: string[] }) {
    const name = input.name.trim();
    if (!name) throw new Error('Role name is required.');
    const now = isoNow();
    const role: TasoRole = {
      id: id('role'),
      name: name.slice(0, 80),
      description: input.description?.trim().slice(0, 240) || '',
      permissions: uniquePermissions(input.permissions ?? []),
      system: false,
      createdAt: now,
      updatedAt: now,
    };
    this.snapshot.roles.push(role);
    this.persist();
    return { ...role, permissions: [...role.permissions] };
  }

  updateRole(roleId: string, input: { name?: string; description?: string; permissions?: string[] }) {
    const role = this.snapshot.roles.find((entry) => entry.id === roleId);
    if (!role) throw new Error('Role not found.');
    if (role.system) throw new Error('System roles cannot be modified. Create a custom role instead.');
    if (input.name !== undefined) role.name = input.name.trim().slice(0, 80) || role.name;
    if (input.description !== undefined) role.description = input.description.trim().slice(0, 240);
    if (input.permissions !== undefined) role.permissions = uniquePermissions(input.permissions);
    role.updatedAt = isoNow();
    this.persist();
    return { ...role, permissions: [...role.permissions] };
  }

  deleteRole(roleId: string) {
    const role = this.snapshot.roles.find((entry) => entry.id === roleId);
    if (!role) return false;
    if (role.system) throw new Error('System role cannot be deleted.');
    if (this.snapshot.users.some((user) => user.roleIds.includes(roleId))) throw new Error('Role is assigned to one or more users.');
    this.snapshot.roles = this.snapshot.roles.filter((entry) => entry.id !== roleId);
    this.persist();
    return true;
  }

  markLogin(emailRaw: string) {
    const email = normalizeEmail(emailRaw);
    const user = this.snapshot.users.find((entry) => entry.email === email);
    if (!user) return;
    user.lastLoginAt = isoNow();
    user.updatedAt = user.lastLoginAt;
    this.persist();
  }

  private validateRoleIds(roleIds: string[]) {
    const unique = [...new Set(roleIds)];
    for (const roleId of unique) {
      if (!this.snapshot.roles.some((role) => role.id === roleId)) throw new Error(`Unknown role: ${roleId}`);
    }
    return unique;
  }

  private ensureBuiltIns() {
    const defaults = builtInRoles();
    for (const expected of defaults) {
      const existing = this.snapshot.roles.find((role) => role.id === expected.id);
      if (!existing) this.snapshot.roles.push(expected);
      else if (existing.system) {
        existing.name = expected.name;
        existing.description = expected.description;
        existing.permissions = expected.permissions;
      }
    }
  }

  private load(): IdentitySnapshot {
    if (!this.filePath) return { version: 2, roles: [], users: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as { roles?: TasoRole[]; users?: Array<Partial<StoredTasoUser>> };
      const users = Array.isArray(parsed.users) ? parsed.users.map((user) => ({
        ...user,
        passwordChangeRequired: Boolean(user.passwordChangeRequired),
      })) as StoredTasoUser[] : [];
      return {
        version: 2,
        roles: Array.isArray(parsed.roles) ? parsed.roles : [],
        users,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 2, roles: [], users: [] };
      throw new Error(`Taso identity state could not be loaded: ${(error as Error).message}`);
    }
  }

  private persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.${createHash('sha256').update(String(process.pid)).digest('hex').slice(0, 8)}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ ...this.snapshot, version: 2 }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.filePath);
  }
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { IdentityStore } from '../src/identity-store.js';

test('owner is created with immutable owner role and full permissions', () => {
  const store = new IdentityStore('owner@example.com');
  const owner = store.getUserByEmail('OWNER@example.com');
  assert.ok(owner);
  assert.equal(owner.owner, true);
  assert.equal(owner.active, true);
  assert.ok(owner.roleIds.includes('role_owner'));
  assert.equal(store.can(owner, 'users.write'), true);
  assert.equal(store.can(owner, 'roles.write'), true);
  assert.throws(() => store.updateUser(owner.id, { active: false }), /Owner account cannot be disabled/);
  assert.throws(() => store.updateUser(owner.id, { roleIds: ['role_viewer'] }), /Owner role cannot be removed/);
});

test('admin can model custom roles and role-based permissions', () => {
  const store = new IdentityStore('owner@example.com');
  const role = store.createRole({
    name: 'Proje Operatörü',
    permissions: ['projects.read', 'missions.read', 'missions.write', 'not.real'],
  });
  assert.deepEqual(role.permissions.sort(), ['missions.read', 'missions.write', 'projects.read'].sort());

  const user = store.createUser({
    email: 'operator@example.com',
    displayName: 'Operatör',
    roleIds: [role.id],
  });
  assert.equal(store.can(user, 'projects.read'), true);
  assert.equal(store.can(user, 'missions.write'), true);
  assert.equal(store.can(user, 'users.write'), false);

  const disabled = store.updateUser(user.id, { active: false });
  assert.equal(store.can(disabled, 'projects.read'), false);
  assert.throws(() => store.deleteRole(role.id), /assigned/);
});

test('system roles cannot be deleted and owner role cannot be modified', () => {
  const store = new IdentityStore('owner@example.com');
  assert.throws(() => store.deleteRole('role_viewer'), /System role cannot be deleted/);
  assert.throws(() => store.updateRole('role_owner', { name: 'Changed' }), /Owner role cannot be modified/);
});

import { PRIVILEGED_PERMISSIONS, isPermissionKey, type Clock, type DataScope } from '@sfm/shared';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import type { AuditRecorder } from '../audit/audit.service';
import { normalizeEmail, type ClientInfo } from '../auth/auth.service';
import {
  assertPasswordAcceptable,
  generateTemporaryPassword,
  type PasswordHasher,
} from '../auth/password';
import {
  DuplicateEmailError,
  DuplicateRoleKeyError,
  type Principal,
  type RoleRecord,
  type RoleRepo,
  type SessionRepo,
  type UserRecord,
  type UserRepo,
} from '../auth/ports';
import type { PrincipalResolver } from '../auth/principal';

export const SUPER_ADMIN_KEY = 'SUPER_ADMIN';

const isPrivileged = (p: string): boolean =>
  (PRIVILEGED_PERMISSIONS as readonly string[]).includes(p);

export interface UserView {
  id: string;
  name: string;
  email: string;
  mobile?: string | undefined;
  status: UserRecord['status'];
  roleIds: string[];
  mustChangePassword: boolean;
  lastLoginAt?: Date | undefined;
  lockedUntil?: Date | null | undefined;
  createdAt: Date;
}

/** never expose the hash, token version or failure counters */
export const toUserView = (u: UserRecord): UserView => ({
  id: u.id,
  name: u.name,
  email: u.email,
  mobile: u.mobile,
  status: u.status,
  roleIds: u.roleIds,
  mustChangePassword: u.mustChangePassword,
  lastLoginAt: u.lastLoginAt,
  lockedUntil: u.lockedUntil,
  createdAt: u.createdAt,
});

interface Deps {
  users: UserRepo;
  roles: RoleRepo;
  sessions: SessionRepo;
  hasher: PasswordHasher;
  audit: AuditRecorder;
  clock: Clock;
  principals: PrincipalResolver;
}

export class IdentityService {
  constructor(private readonly d: Deps) {}

  private async record(
    actor: Principal,
    action: string,
    entityType: string,
    entityId: string,
    info: ClientInfo,
    change?: { before?: unknown; after?: unknown; reason?: string },
  ): Promise<void> {
    await this.d.audit.record({
      at: this.d.clock.now(),
      userId: actor.userId,
      userName: actor.name,
      roleKeys: actor.roleKeys,
      action,
      entityType,
      entityId,
      ...change,
      ip: info.ip,
      userAgent: info.userAgent?.slice(0, 300),
      requestId: info.requestId,
    });
  }

  /* ------------------------------ safeguards ------------------------------ */

  /** a role may only be handed out by someone who already holds every permission in it (no privilege escalation) */
  private assertCanGrant(actor: Principal, role: Pick<RoleRecord, 'key' | 'permissions'>): void {
    if (role.key === SUPER_ADMIN_KEY && !actor.roleKeys.includes(SUPER_ADMIN_KEY)) {
      throw forbidden('Only a Super Admin can give the Super Admin role.', 'ROLE_ESCALATION');
    }
    const missing = role.permissions.filter((p) => isPrivileged(p) && !actor.permissions.has(p));
    if (missing.length > 0) {
      throw forbidden(
        'You cannot give a role that has administration permissions you do not have yourself.',
        'ROLE_ESCALATION',
      );
    }
  }

  private async loadRoles(ids: string[]): Promise<RoleRecord[]> {
    const unique = [...new Set(ids)];
    const found = await this.d.roles.findByIds(unique);
    if (found.length !== unique.length)
      throw badRequest('ROLE_NOT_FOUND', 'One of the selected roles does not exist.');
    if (found.some((r) => !r.isActive))
      throw badRequest('ROLE_INACTIVE', 'One of the selected roles is no longer active.');
    return found;
  }

  private async targetIsSuperAdmin(user: UserRecord): Promise<boolean> {
    const superRole = await this.d.roles.findByKey(SUPER_ADMIN_KEY);
    return !!superRole && user.roleIds.includes(superRole.id);
  }

  /** only a Super Admin may touch another Super Admin's account */
  private async assertCanManage(actor: Principal, target: UserRecord): Promise<void> {
    if ((await this.targetIsSuperAdmin(target)) && !actor.roleKeys.includes(SUPER_ADMIN_KEY)) {
      throw forbidden('Only a Super Admin can change a Super Admin account.', 'ROLE_ESCALATION');
    }
  }

  /** the institution must never be left without a working Super Admin */
  private async assertNotLastSuperAdmin(target: UserRecord): Promise<void> {
    const superRole = await this.d.roles.findByKey(SUPER_ADMIN_KEY);
    if (!superRole || !target.roleIds.includes(superRole.id) || target.status !== 'ACTIVE') return;
    if ((await this.d.users.countActiveWithRole(superRole.id, target.id)) === 0) {
      throw conflict('LAST_SUPER_ADMIN', 'There must always be at least one active Super Admin.');
    }
  }

  private async mustFind(id: string): Promise<UserRecord> {
    const u = await this.d.users.findById(id);
    if (!u) throw notFound('User not found.', 'USER_NOT_FOUND');
    return u;
  }

  /* ------------------------------ users ------------------------------ */

  async listUsers(q: {
    page: number;
    pageSize: number;
    q?: string | undefined;
    status?: UserRecord['status'] | undefined;
  }) {
    const { items, total } = await this.d.users.list(q);
    return { items: items.map(toUserView), total };
  }

  async getUser(id: string): Promise<UserView> {
    return toUserView(await this.mustFind(id));
  }

  /** returns the temporary password ONCE — it is not stored anywhere in clear and the user must change it at first login */
  async createUser(
    actor: Principal,
    input: { email: string; name: string; mobile?: string | undefined; roleIds: string[] },
    info: ClientInfo = {},
  ): Promise<{ user: UserView; temporaryPassword: string }> {
    const roles = await this.loadRoles(input.roleIds);
    roles.forEach((r) => this.assertCanGrant(actor, r));
    const temporaryPassword = generateTemporaryPassword();
    let created: UserRecord;
    try {
      created = await this.d.users.create({
        institutionId: actor.institutionId,
        email: normalizeEmail(input.email),
        name: input.name.trim(),
        mobile: input.mobile,
        passwordHash: await this.d.hasher.hash(temporaryPassword),
        roleIds: roles.map((r) => r.id),
        status: 'INVITED',
        mustChangePassword: true,
      });
    } catch (e) {
      if (e instanceof DuplicateEmailError)
        throw conflict('EMAIL_IN_USE', 'A user with this e-mail already exists.');
      throw e;
    }
    await this.record(actor, 'USER_CREATED', 'user', created.id, info, {
      after: { email: created.email, name: created.name, roles: roles.map((r) => r.key) },
    });
    return { user: toUserView(created), temporaryPassword };
  }

  async updateUser(
    actor: Principal,
    id: string,
    patch: {
      name?: string | undefined;
      mobile?: string | undefined;
      roleIds?: string[] | undefined;
    },
    info: ClientInfo = {},
  ): Promise<UserView> {
    const target = await this.mustFind(id);
    await this.assertCanManage(actor, target);
    const update: Parameters<UserRepo['update']>[1] = {};
    if (patch.name !== undefined) update.name = patch.name.trim();
    if (patch.mobile !== undefined) update.mobile = patch.mobile;

    let rolesChanged = false;
    if (patch.roleIds !== undefined) {
      if (id === actor.userId)
        throw forbidden('You cannot change your own roles.', 'SELF_ROLE_CHANGE');
      const roles = await this.loadRoles(patch.roleIds);
      const before = new Set(target.roleIds);
      roles.filter((r) => !before.has(r.id)).forEach((r) => this.assertCanGrant(actor, r)); // only NEW grants are checked
      const superRole = await this.d.roles.findByKey(SUPER_ADMIN_KEY);
      if (superRole && before.has(superRole.id) && !roles.some((r) => r.id === superRole.id)) {
        if (!actor.roleKeys.includes(SUPER_ADMIN_KEY))
          throw forbidden('Only a Super Admin can remove the Super Admin role.', 'ROLE_ESCALATION');
        await this.assertNotLastSuperAdmin(target);
      }
      update.roleIds = roles.map((r) => r.id);
      rolesChanged = true;
    }
    const saved = await this.d.users.update(id, update);
    if (!saved) throw notFound('User not found.', 'USER_NOT_FOUND');
    this.d.principals.invalidateUser(id);
    await this.record(
      actor,
      rolesChanged ? 'USER_ROLES_CHANGED' : 'USER_UPDATED',
      'user',
      id,
      info,
      {
        before: { name: target.name, mobile: target.mobile, roleIds: target.roleIds },
        after: { name: saved.name, mobile: saved.mobile, roleIds: saved.roleIds },
      },
    );
    return toUserView(saved);
  }

  async deactivateUser(
    actor: Principal,
    id: string,
    reason: string,
    info: ClientInfo = {},
  ): Promise<UserView> {
    if (id === actor.userId)
      throw forbidden('You cannot deactivate your own account.', 'SELF_DEACTIVATE');
    const target = await this.mustFind(id);
    await this.assertCanManage(actor, target);
    await this.assertNotLastSuperAdmin(target);
    const saved = (await this.d.users.update(id, { status: 'INACTIVE' }))!;
    await this.d.sessions.revokeAllForUser(id, this.d.clock.now());
    this.d.principals.invalidateAll();
    await this.record(actor, 'USER_DEACTIVATED', 'user', id, info, {
      before: { status: target.status },
      after: { status: 'INACTIVE' },
      reason,
    });
    return toUserView(saved);
  }

  async activateUser(actor: Principal, id: string, info: ClientInfo = {}): Promise<UserView> {
    const target = await this.mustFind(id);
    await this.assertCanManage(actor, target);
    if (target.status !== 'INACTIVE' && target.status !== 'LOCKED')
      throw conflict('USER_NOT_DISABLED', 'This user is already active.');
    const saved = (await this.d.users.update(id, {
      status: target.mustChangePassword ? 'INVITED' : 'ACTIVE',
    }))!;
    await this.d.users.unlock(id);
    this.d.principals.invalidateUser(id);
    await this.record(actor, 'USER_ACTIVATED', 'user', id, info, {
      before: { status: target.status },
      after: { status: saved.status },
    });
    return toUserView(saved);
  }

  async unlockUser(actor: Principal, id: string, info: ClientInfo = {}): Promise<UserView> {
    const target = await this.mustFind(id);
    await this.assertCanManage(actor, target);
    await this.d.users.unlock(id);
    this.d.principals.invalidateUser(id);
    await this.record(actor, 'USER_UNLOCKED', 'user', id, info);
    return toUserView(await this.mustFind(id));
  }

  /** admin reset: new temporary password (shown once), every session of that user ends, must change at next login */
  async resetPassword(
    actor: Principal,
    id: string,
    info: ClientInfo = {},
  ): Promise<{ user: UserView; temporaryPassword: string }> {
    if (id === actor.userId)
      throw forbidden('Use "Change password" for your own account.', 'SELF_RESET');
    const target = await this.mustFind(id);
    await this.assertCanManage(actor, target);
    const temporaryPassword = generateTemporaryPassword();
    assertPasswordAcceptable(temporaryPassword);
    const saved = await this.d.users.setPassword(id, await this.d.hasher.hash(temporaryPassword), {
      mustChangePassword: true,
      activate: false,
    });
    if (!saved) throw notFound('User not found.', 'USER_NOT_FOUND');
    await this.d.sessions.revokeAllForUser(id, this.d.clock.now());
    this.d.principals.invalidateAll();
    await this.record(actor, 'USER_PASSWORD_RESET', 'user', id, info);
    return { user: toUserView(saved), temporaryPassword };
  }

  /* ------------------------------ roles ------------------------------ */

  async listRoles(): Promise<RoleRecord[]> {
    return (await this.d.roles.list()).sort(
      (a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name),
    );
  }

  async getRole(id: string): Promise<RoleRecord> {
    const r = await this.d.roles.findById(id);
    if (!r) throw notFound('Role not found.', 'ROLE_NOT_FOUND');
    return r;
  }

  private validatePermissions(actor: Principal, permissions: string[]): string[] {
    const unique = [...new Set(permissions)];
    const unknown = unique.filter((p) => !isPermissionKey(p));
    if (unknown.length > 0)
      throw badRequest('UNKNOWN_PERMISSION', `Unknown permission: ${unknown[0]}`, unknown);
    const beyond = unique.filter((p) => isPrivileged(p) && !actor.permissions.has(p));
    if (beyond.length > 0)
      throw forbidden(
        'You cannot give administration permissions you do not have yourself.',
        'ROLE_ESCALATION',
      );
    return unique;
  }

  async createRole(
    actor: Principal,
    input: {
      key: string;
      name: string;
      description?: string | undefined;
      permissions: string[];
      dataScope: DataScope;
    },
    info: ClientInfo = {},
  ): Promise<RoleRecord> {
    const permissions = this.validatePermissions(actor, input.permissions);
    try {
      const role = await this.d.roles.create({
        institutionId: actor.institutionId,
        key: input.key,
        name: input.name.trim(),
        description: input.description?.trim(),
        permissions,
        dataScope: input.dataScope,
        isSystem: false,
        isActive: true,
      });
      await this.record(actor, 'ROLE_CREATED', 'role', role.id, info, {
        after: { key: role.key, name: role.name, permissions },
      });
      return role;
    } catch (e) {
      if (e instanceof DuplicateRoleKeyError)
        throw conflict('ROLE_KEY_IN_USE', 'A role with this key already exists.');
      throw e;
    }
  }

  /** system roles are read-only (copy one to customise); edits need the current `version` → no lost updates */
  async updateRole(
    actor: Principal,
    id: string,
    expectedVersion: number,
    patch: {
      name?: string | undefined;
      description?: string | undefined;
      permissions?: string[] | undefined;
      dataScope?: DataScope | undefined;
    },
    info: ClientInfo = {},
  ): Promise<RoleRecord> {
    const before = await this.getRole(id);
    if (before.isSystem)
      throw conflict(
        'SYSTEM_ROLE_READONLY',
        'Built-in roles cannot be edited. Create a copy and change that instead.',
      );
    const update: Parameters<RoleRepo['update']>[1] = {};
    if (patch.name !== undefined) update.name = patch.name.trim();
    if (patch.description !== undefined) update.description = patch.description.trim();
    if (patch.dataScope !== undefined) update.dataScope = patch.dataScope;
    if (patch.permissions !== undefined) {
      const added = patch.permissions.filter((p) => !before.permissions.includes(p));
      this.validatePermissions(actor, added); // only NEW permissions must be ones the editor holds
      const unknown = patch.permissions.filter((p) => !isPermissionKey(p));
      if (unknown.length > 0)
        throw badRequest('UNKNOWN_PERMISSION', `Unknown permission: ${unknown[0]}`, unknown);
      update.permissions = [...new Set(patch.permissions)];
    }
    const saved = await this.d.roles.update(id, update, expectedVersion);
    if (!saved)
      throw conflict(
        'VERSION_CONFLICT',
        'This role was changed by someone else. Reload and try again.',
      );
    this.d.principals.invalidateAll();
    await this.record(actor, 'ROLE_UPDATED', 'role', id, info, {
      before: { name: before.name, permissions: before.permissions, dataScope: before.dataScope },
      after: { name: saved.name, permissions: saved.permissions, dataScope: saved.dataScope },
    });
    return saved;
  }

  async archiveRole(actor: Principal, id: string, info: ClientInfo = {}): Promise<RoleRecord> {
    const role = await this.getRole(id);
    if (role.isSystem) throw conflict('SYSTEM_ROLE_READONLY', 'Built-in roles cannot be archived.');
    if ((await this.d.users.countUsersWithRole(id)) > 0)
      throw conflict(
        'ROLE_IN_USE',
        'This role is still assigned to users. Move them to another role first.',
      );
    const saved = await this.d.roles.update(id, { isActive: false }, role.version);
    if (!saved)
      throw conflict(
        'VERSION_CONFLICT',
        'This role was changed by someone else. Reload and try again.',
      );
    this.d.principals.invalidateAll();
    await this.record(actor, 'ROLE_ARCHIVED', 'role', id, info, {
      before: { isActive: true },
      after: { isActive: false },
    });
    return saved;
  }
}

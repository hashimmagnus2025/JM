import { ALL_PERMISSIONS } from '@sfm/shared';
import { describe, expect, it } from 'vitest';
import { buildHttpHarness } from '../../testing/http-harness';
import type { Principal } from '../auth/ports';

const PW = 'Correct-Horse-42!';

const fakeSuperAdmin = (userId: string): Principal => ({
  userId,
  sessionId: 's',
  institutionId: 'inst-1',
  name: 'Fake Super',
  email: 'fake@school.test',
  roleKeys: ['SUPER_ADMIN'],
  permissions: new Set<string>(ALL_PERMISSIONS),
  dataScope: 'ALL',
  mustChangePassword: false,
});

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? 'NO_CODE';
  }
  return 'OK';
};

describe('IdentityService safeguards (called directly, below the HTTP layer)', () => {
  it('the LAST active Super Admin can be neither deactivated nor stripped of the role', async () => {
    const h = await buildHttpHarness();
    const only = await h.addUser('only@school.test', PW, ['SUPER_ADMIN']);
    const actor = fakeSuperAdmin('someone-else'); // e.g. an actor whose own account was disabled a moment ago
    expect(await code(h.identity.deactivateUser(actor, only.id, 'cleanup run'))).toBe(
      'LAST_SUPER_ADMIN',
    );
    expect(
      await code(h.identity.updateUser(actor, only.id, { roleIds: [h.roleId('AUDITOR')] })),
    ).toBe('LAST_SUPER_ADMIN');
    expect((await h.users.findById(only.id))?.status).toBe('ACTIVE');

    // with a second ACTIVE Super Admin it is allowed again
    await h.addUser('second@school.test', PW, ['SUPER_ADMIN']);
    expect(await code(h.identity.deactivateUser(actor, only.id, 'cleanup run'))).toBe('OK');
  });

  it('an INACTIVE second Super Admin does not count as a safety net', async () => {
    const h = await buildHttpHarness();
    const a = await h.addUser('a@school.test', PW, ['SUPER_ADMIN']);
    await h.addUser('b@school.test', PW, ['SUPER_ADMIN'], { status: 'INACTIVE' });
    expect(await code(h.identity.deactivateUser(fakeSuperAdmin('x'), a.id, 'cleanup run'))).toBe(
      'LAST_SUPER_ADMIN',
    );
  });

  it('only a Super Admin may give, remove or touch the Super Admin role', async () => {
    const h = await buildHttpHarness();
    const root = await h.addUser('root@school.test', PW, ['SUPER_ADMIN']);
    await h.addUser('root2@school.test', PW, ['SUPER_ADMIN']);
    const admin = { ...fakeSuperAdmin('adm'), roleKeys: ['ADMIN'] };
    expect(await code(h.identity.updateUser(admin, root.id, { name: 'Renamed Root' }))).toBe(
      'ROLE_ESCALATION',
    );
    expect(
      await code(h.identity.updateUser(admin, root.id, { roleIds: [h.roleId('AUDITOR')] })),
    ).toBe('ROLE_ESCALATION');
    expect(await code(h.identity.unlockUser(admin, root.id))).toBe('ROLE_ESCALATION');
    expect(await code(h.identity.activateUser(admin, root.id))).toBe('ROLE_ESCALATION');
  });

  it('activating a user who still has a temporary password returns them to INVITED, otherwise ACTIVE', async () => {
    const h = await buildHttpHarness();
    const actor = fakeSuperAdmin('x');
    const invitedOff = await h.addUser('i@school.test', PW, ['AUDITOR'], {
      status: 'INACTIVE',
      mustChangePassword: true,
    });
    const normalOff = await h.addUser('n@school.test', PW, ['AUDITOR'], { status: 'INACTIVE' });
    expect((await h.identity.activateUser(actor, invitedOff.id)).status).toBe('INVITED');
    expect((await h.identity.activateUser(actor, normalOff.id)).status).toBe('ACTIVE');
    expect(await code(h.identity.activateUser(actor, normalOff.id))).toBe('USER_NOT_DISABLED');
  });

  it('unknown users and unknown / inactive roles are reported clearly', async () => {
    const h = await buildHttpHarness();
    const actor = { ...fakeSuperAdmin('x'), permissions: new Set(['user.manage']) };
    expect(await code(h.identity.getUser('0123456789abcdef01234567'))).toBe('USER_NOT_FOUND');
    expect(
      await code(
        h.identity.createUser(actor, {
          email: 'a@b.test',
          name: 'Ab Cd',
          roleIds: ['0123456789abcdef01234567'],
        }),
      ),
    ).toBe('ROLE_NOT_FOUND');
    const dead = await h.roles.create({
      institutionId: 'inst-1',
      key: 'DEAD',
      name: 'Dead',
      permissions: [],
      dataScope: 'ALL',
      isSystem: false,
      isActive: false,
    });
    expect(
      await code(
        h.identity.createUser(actor, { email: 'a@b.test', name: 'Ab Cd', roleIds: [dead.id] }),
      ),
    ).toBe('ROLE_INACTIVE');
  });
});

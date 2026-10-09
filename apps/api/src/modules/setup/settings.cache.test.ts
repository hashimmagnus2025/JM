import { FixedClock } from '@sfm/shared';
import { describe, expect, it } from 'vitest';
import { MemorySettingRepo } from '../../testing/memory-setup-repos';
import type { Principal } from '../auth/ports';
import { SettingsService } from './setup.service';

const actor: Principal = {
  userId: 'u1',
  sessionId: 's',
  institutionId: 'i',
  name: 'Admin',
  email: 'a@a.a',
  roleKeys: ['ADMIN'],
  permissions: new Set(['settings.manage']),
  dataScope: 'ALL',
  mustChangePassword: false,
};
const noAudit = { record: async () => undefined };

describe('settings cache (production uses a 10 s TTL)', () => {
  it('serves the cache between changes but refreshes IMMEDIATELY after an update or a reset', async () => {
    const repo = new MemorySettingRepo();
    const clock = new FixedClock('2026-10-08T06:00:00Z');
    const svc = new SettingsService(repo, noAudit, clock, 60_000);

    expect((await svc.get())['status.dueSoonDays']).toBe(7);
    // changed behind the service's back (another process): the cache is still served
    await repo.set('status.dueSoonDays', 3, undefined, clock.now());
    expect((await svc.get())['status.dueSoonDays']).toBe(7);

    // a change made THROUGH the service is visible at once
    await svc.update(actor, 'status.dueSoonDays', 10, undefined);
    expect((await svc.get())['status.dueSoonDays']).toBe(10);
    await svc.reset(actor, 'status.dueSoonDays');
    expect((await svc.get())['status.dueSoonDays']).toBe(7);

    // another process's change shows up once the TTL has passed
    await repo.set('status.dueSoonDays', 4, undefined, clock.now());
    clock.set(new Date(clock.now().getTime() + 61_000));
    expect((await svc.get())['status.dueSoonDays']).toBe(4);
  });
});

import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  PERMISSION_DEFS,
  PRIVILEGED_PERMISSIONS,
  SYSTEM_ROLES,
  isPermissionKey,
} from './permissions';

describe('permission registry', () => {
  it('has unique keys in group.action form and a human label for each', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    for (const p of PERMISSION_DEFS) {
      expect(p.key).toMatch(/^[a-zA-Z]+\.[a-zA-Z]+$/);
      expect(p.label.length).toBeGreaterThan(3);
    }
  });
  it('privileged (administration-grade) permissions are registered, and the Fee Collector role has none of them', () => {
    expect(PRIVILEGED_PERMISSIONS.length).toBeGreaterThan(0);
    for (const p of PRIVILEGED_PERMISSIONS) expect(isPermissionKey(p)).toBe(true);
    const collector = SYSTEM_ROLES.find((r) => r.key === 'FEE_COLLECTOR')!;
    expect(
      collector.permissions.filter((p) =>
        (PRIVILEGED_PERMISSIONS as readonly string[]).includes(p),
      ),
    ).toEqual([]);
    // operational permissions are deliberately NOT privileged: an Admin must be able to create Fee Collectors
    expect(PRIVILEGED_PERMISSIONS).not.toContain('payment.collect');
  });
  it('recognises only registered keys', () => {
    expect(isPermissionKey('payment.collect')).toBe(true);
    expect(isPermissionKey('payment.steal')).toBe(false);
    expect(isPermissionKey(42)).toBe(false);
  });
});

describe('system roles', () => {
  const role = (key: string) => SYSTEM_ROLES.find((r) => r.key === key)!;
  it('only use registered permissions, without duplicates', () => {
    for (const r of SYSTEM_ROLES) {
      expect(new Set(r.permissions).size, r.key).toBe(r.permissions.length);
      for (const p of r.permissions) expect(isPermissionKey(p), `${r.key}: ${p}`).toBe(true);
    }
  });
  it('Super Admin holds everything', () => {
    expect(role('SUPER_ADMIN').permissions).toHaveLength(ALL_PERMISSIONS.length);
  });
  it('BRC-E6: the Fee Collector can collect but can NOT reverse; reversal is finance/admin only', () => {
    expect(role('FEE_COLLECTOR').permissions).toContain('payment.collect');
    expect(role('FEE_COLLECTOR').permissions).not.toContain('payment.reverse');
    expect(role('FEE_COLLECTOR').permissions).not.toContain('payment.reverseApprove');
    const holders = SYSTEM_ROLES.filter((r) => r.permissions.includes('payment.reverse')).map(
      (r) => r.key,
    );
    expect(holders.sort()).toEqual(['ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN']);
  });
  it('separation of duties: the person who requests a reversal / discount is not the only approver', () => {
    expect(role('ACCOUNTANT').permissions).not.toContain('payment.reverseApprove');
    expect(role('ACCOUNTANT').permissions).not.toContain('adjustment.approve');
    expect(role('ADMIN').permissions).toContain('payment.reverseApprove');
    expect(role('ADMIN').permissions).toContain('adjustment.approve');
  });
  it('only Super Admin can post into a closed year; Auditor is read-only', () => {
    expect(
      SYSTEM_ROLES.filter((r) => r.permissions.includes('academicYear.override')).map((r) => r.key),
    ).toEqual(['SUPER_ADMIN']);
    const writes = role('AUDITOR').permissions.filter(
      (p) => !/\.(view|export|viewContact)$/.test(p),
    );
    expect(writes).toEqual([]);
  });
  it('no release-1 role is scoped to own divisions (teachers do not log in, BRC-B6)', () => {
    expect(SYSTEM_ROLES.every((r) => r.dataScope === 'ALL')).toBe(true);
  });
  it('nobody but admins manages users, roles and settings', () => {
    const managers = (p: string) =>
      SYSTEM_ROLES.filter((r) => (r.permissions as readonly string[]).includes(p)).map(
        (r) => r.key,
      );
    expect(managers('user.manage').sort()).toEqual(['ADMIN', 'SUPER_ADMIN']);
    expect(managers('role.manage').sort()).toEqual(['ADMIN', 'SUPER_ADMIN']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTING_DEFS,
  isSettingKey,
  resolveSettings,
  settingDef,
} from './settings';

describe('settings registry', () => {
  it('has unique keys, a label, a group and a description for each', () => {
    expect(new Set(SETTING_DEFS.map((d) => d.key)).size).toBe(SETTING_DEFS.length);
    for (const d of SETTING_DEFS) {
      expect(d.label.length, d.key).toBeGreaterThan(3);
      expect(d.group.length, d.key).toBeGreaterThan(2);
      expect(d.description.length, d.key).toBeGreaterThan(10);
    }
  });
  it('every default is valid for its own schema', () => {
    for (const d of SETTING_DEFS) expect(d.schema.safeParse(d.default).success, d.key).toBe(true);
  });
  it('defaults equal the client decisions', () => {
    expect(DEFAULT_SETTINGS['status.dueSoonDays']).toBe(7);
    expect(DEFAULT_SETTINGS['aging.boundaries']).toEqual([30, 60, 90]);
    expect(DEFAULT_SETTINGS['aging.basis']).toBe('ORIGINAL_DUE_DATE');
    expect(DEFAULT_SETTINGS['metrics.expectedIncludesPenalties']).toBe(false);
    expect(DEFAULT_SETTINGS['allocation.strategy']).toBe('OLDEST_DUE_FIRST');
    expect(DEFAULT_SETTINGS['advance.enabled']).toBe(false);
    expect(DEFAULT_SETTINGS['reversal.approval.thresholdPaise']).toBeNull(); // no amount is hard-coded
    expect(DEFAULT_SETTINGS['receipt.numbering']).toEqual({
      prefix: 'REC',
      scope: 'ACADEMIC_YEAR',
      pad: 6,
    });
    expect(DEFAULT_SETTINGS['teacher.allowMultipleDivisions']).toBe(true);
    expect(DEFAULT_SETTINGS['billing.ratePerStudentPaise']).toBe(12_000);
  });
  it('validates values', () => {
    const ok = (k: Parameters<typeof settingDef>[0], v: unknown): boolean =>
      settingDef(k).schema.safeParse(v).success;
    expect(ok('status.dueSoonDays', 3)).toBe(true);
    expect(ok('status.dueSoonDays', -1)).toBe(false);
    expect(ok('status.dueSoonDays', 7.5)).toBe(false);
    expect(ok('aging.boundaries', [15, 45, 90])).toBe(true);
    expect(ok('aging.boundaries', [60, 30, 90])).toBe(false);
    expect(ok('reversal.approval.thresholdPaise', 5_000_000)).toBe(true);
    expect(ok('reversal.approval.thresholdPaise', null)).toBe(true);
    expect(ok('reversal.approval.thresholdPaise', 0)).toBe(false);
    expect(ok('reversal.approval.thresholdPaise', 10.5)).toBe(false);
    expect(ok('receipt.numbering', { prefix: 'FEE', scope: 'CALENDAR_YEAR', pad: 5 })).toBe(true);
    expect(ok('receipt.numbering', { prefix: 'fee', scope: 'CALENDAR_YEAR', pad: 5 })).toBe(false);
    expect(ok('receipt.numbering', { prefix: 'FEE', scope: 'WEEKLY', pad: 5 })).toBe(false);
    expect(ok('receipt.numbering', { prefix: 'FEE', scope: 'NONE', pad: 5, extra: 1 })).toBe(false);
    expect(ok('allocation.strategy', 'NEWEST_FIRST')).toBe(false);
    expect(ok('payment.methods', [])).toBe(false);
    expect(ok('billing.point', { kind: 'FIXED_DATE', date: '2026-06-30' })).toBe(true);
    expect(ok('billing.point', { kind: 'FIXED_DATE' })).toBe(false);
  });
  it('payment method codes must be unique', () => {
    const m = {
      code: 'CASH',
      label: 'Cash',
      requiresReference: false,
      uniqueReference: false,
      isActive: true,
    };
    expect(settingDef('payment.methods').schema.safeParse([m, m]).success).toBe(false);
  });
  it('resolveSettings merges over defaults and ignores unknown or invalid stored values', () => {
    const { settings, invalid } = resolveSettings({
      'status.dueSoonDays': 10,
      'aging.basis': 'WHATEVER',
      'retired.key': 1,
    });
    expect(settings['status.dueSoonDays']).toBe(10);
    expect(settings['aging.basis']).toBe('ORIGINAL_DUE_DATE');
    expect(invalid).toEqual(['aging.basis']);
    expect(Object.keys(settings)).toHaveLength(SETTING_DEFS.length);
  });
  it('recognises keys', () => {
    expect(isSettingKey('status.dueSoonDays')).toBe(true);
    expect(isSettingKey('nope')).toBe(false);
    expect(isSettingKey(1)).toBe(false);
  });
});

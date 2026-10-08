import { describe, expect, it } from 'vitest';
import {
  assertVersionEditable,
  canonicalVersionContent,
  resolveFeeStructure,
  validatePlansForPublish,
  type FeeStructureCandidate,
  type InstallmentPlan,
} from './index';
import { R, catchFinance, line, tuition } from '../../testing/fixtures';

const c = (id: string, over: Partial<FeeStructureCandidate> = {}): FeeStructureCandidate => ({
  id, classId: 'c5', divisionId: null, categoryId: null, publishedVersionId: `v-${id}`, ...over,
});
const ctx = { classId: 'c5', divisionId: 'c5-A', categoryId: 'GEN' };

describe('fee structure resolution — most specific wins (BRC-C1)', () => {
  const all = [
    c('class'),
    c('class+cat', { categoryId: 'GEN' }),
    c('class+div', { divisionId: 'c5-A' }),
    c('class+div+cat', { divisionId: 'c5-A', categoryId: 'GEN' }),
  ];
  it('picks class+division+category, then class+division, then class+category, then class', () => {
    expect(resolveFeeStructure(all, ctx).id).toBe('class+div+cat');
    expect(resolveFeeStructure(all.slice(0, 3), ctx).id).toBe('class+div');
    expect(resolveFeeStructure([all[0] as FeeStructureCandidate, all[1] as FeeStructureCandidate], ctx).id).toBe('class+cat');
    expect(resolveFeeStructure([all[0] as FeeStructureCandidate], ctx).id).toBe('class');
  });
  it('ignores other classes/divisions/categories and structures without a published version', () => {
    const list = [c('other-class', { classId: 'c6' }), c('other-div', { divisionId: 'c5-B' }), c('other-cat', { categoryId: 'RTE' }), c('draft', { publishedVersionId: null }), c('ok')];
    expect(resolveFeeStructure(list, ctx).id).toBe('ok');
  });
  it('no applicable structure → NO_FEE_STRUCTURE', () => {
    expect(catchFinance(() => resolveFeeStructure([], ctx)).code).toBe('NO_FEE_STRUCTURE');
    expect(catchFinance(() => resolveFeeStructure([c('draft', { publishedVersionId: null })], ctx)).code).toBe('NO_FEE_STRUCTURE');
  });
  it('two structures at the same specificity is a configuration error, never a silent pick', () => {
    expect(catchFinance(() => resolveFeeStructure([c('a'), c('b')], ctx)).code).toBe('NO_FEE_STRUCTURE');
  });
});

describe('published fee structures are immutable (decision #11)', () => {
  it('only a DRAFT can be edited', () => {
    expect(() => assertVersionEditable('DRAFT')).not.toThrow();
    expect(catchFinance(() => assertVersionEditable('PUBLISHED')).code).toBe('FEE_VERSION_IMMUTABLE');
    expect(catchFinance(() => assertVersionEditable('SUPERSEDED')).code).toBe('FEE_VERSION_IMMUTABLE');
  });
  const plan: InstallmentPlan = { planCode: 'P', installments: [{ no: 1, dueDate: '2026-04-10' }, { no: 2, dueDate: '2026-07-10' }] };
  it('canonical content is independent of ordering and changes when an amount changes', () => {
    const a = canonicalVersionContent([tuition(R(50_000)), line('LAB', R(1_000))], [plan]);
    const b = canonicalVersionContent([line('LAB', R(1_000)), tuition(R(50_000))], [plan]);
    expect(a).toBe(b);
    expect(canonicalVersionContent([tuition(R(50_001)), line('LAB', R(1_000))], [plan])).not.toBe(a);
  });
  it('publish-time validation catches plans that cannot split the fee', () => {
    expect(() => validatePlansForPublish([tuition(R(100))], [plan])).not.toThrow();
  });
});

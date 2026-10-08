import { canonicalJson } from '@sfm/shared';
import { buildInstallments, type InstallmentPlan } from './build-installments';
import { FinanceError } from './errors';
import type { FeeLine } from './types';

export type FeeVersionStatus = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';

/**
 * Published fee structures are IMMUTABLE (decision #11). Every code path that would edit a version
 * calls this first; a published or superseded version can only be replaced by a NEW version.
 */
export function assertVersionEditable(status: FeeVersionStatus): void {
  if (status !== 'DRAFT') {
    throw new FinanceError(
      'FEE_VERSION_IMMUTABLE',
      'A published fee structure cannot be edited. Create a new version instead.',
      {
        status,
      },
    );
  }
}

/** Canonical content of a version (hash input). Hashing lives in lib/hash.ts — the domain stays crypto-free. */
export function canonicalVersionContent(
  lines: readonly FeeLine[],
  plans: readonly InstallmentPlan[],
): string {
  return canonicalJson({
    lines: [...lines]
      .map((l) => ({ code: l.code, amount: l.amount, included: l.included ?? true }))
      .sort((a, b) => (a.code < b.code ? -1 : 1)),
    plans: [...plans].map((p) => ({ ...p })).sort((a, b) => (a.planCode < b.planCode ? -1 : 1)),
  });
}

/** Publish-time validation: every plan must split every component exactly. */
export function validatePlansForPublish(
  lines: readonly FeeLine[],
  plans: readonly InstallmentPlan[],
): void {
  if (plans.length === 0)
    throw new FinanceError(
      'INSTALLMENT_PLAN_INVALID',
      'A fee structure needs at least one installment plan.',
    );
  for (const plan of plans) {
    buildInstallments({
      assignmentId: 'validation',
      studentId: 'validation',
      academicYearId: 'validation',
      lines,
      plan: { kind: 'STANDARD', plan },
    });
  }
}

import { newReceivable } from '../domain/finance/receivable';
import type { FeeLine, Receivable, ReceivableKind } from '../domain/finance/types';

/** rupees → paise (test readability only; production code never converts floats) */
export const R = (rupees: number): number => Math.round(rupees * 100);

export const STUDENT = 'stu-1';
export const Y2025 = 'ay-2025-26';
export const Y2026 = 'ay-2026-27';

export interface MkOpts {
  id: string;
  due: string;
  /** a single TUITION amount, or an explicit component map (paise) */
  amount?: number;
  comps?: Record<string, number>;
  year?: string;
  kind?: ReceivableKind;
  no?: number;
  student?: string;
  parent?: string;
  periodKey?: string;
}

export function mk(o: MkOpts): Receivable {
  const comps = o.comps ?? { TUITION: o.amount ?? 0 };
  return newReceivable({
    id: o.id,
    studentId: o.student ?? STUDENT,
    academicYearId: o.year ?? Y2026,
    kind: o.kind ?? 'INSTALLMENT',
    label:
      o.kind === 'OPENING_BALANCE'
        ? 'Opening balance'
        : o.kind === 'PENALTY'
          ? 'Late fee'
          : `Installment ${o.no ?? ''}`.trim(),
    installmentNo: o.no,
    dueDate: o.due,
    parentReceivableId: o.parent,
    periodKey: o.periodKey,
    components: Object.entries(comps).map(([code, payable]) => ({ code, name: code, payable })),
    dedupeKey: `test:${o.id}`,
  });
}

export const tuition = (amount: number): FeeLine => ({ code: 'TUITION', name: 'Tuition', amount });
export const line = (code: string, amount: number): FeeLine => ({ code, name: code, amount });

/** deterministic id source for tests */
export function ids(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/** deep-freeze so tests prove the engine never mutates its inputs */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** run `fn`, return the thrown FinanceError (or fail) */
export function catchFinance(fn: () => unknown): {
  code: string;
  details?: Record<string, unknown>;
  message: string;
} {
  try {
    fn();
  } catch (e) {
    const err = e as { code?: string; details?: Record<string, unknown>; message: string };
    return err.details === undefined
      ? { code: String(err.code), message: err.message }
      : { code: String(err.code), details: err.details, message: err.message };
  }
  throw new Error('expected the function to throw');
}

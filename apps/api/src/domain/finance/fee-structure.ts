import { FinanceError } from './errors';

export interface FeeStructureCandidate {
  id: string;
  classId: string;
  /** null = applies to every division */
  divisionId: string | null;
  /** null = applies to every category */
  categoryId: string | null;
  /** only a structure with a PUBLISHED current version can be resolved */
  publishedVersionId: string | null;
}

export interface FeeStructureContext {
  classId: string;
  divisionId: string;
  categoryId: string;
}

/**
 * Most-specific-wins (BRC-C1 default):
 *   1 class+division+category   2 class+division   3 class+category   4 class only
 * The unique slot index guarantees at most one candidate per specificity level.
 */
export function resolveFeeStructure(
  candidates: readonly FeeStructureCandidate[],
  ctx: FeeStructureContext,
): FeeStructureCandidate {
  const rank = (c: FeeStructureCandidate): number | null => {
    if (c.classId !== ctx.classId || c.publishedVersionId === null) return null;
    if (c.divisionId !== null && c.divisionId !== ctx.divisionId) return null;
    if (c.categoryId !== null && c.categoryId !== ctx.categoryId) return null;
    if (c.divisionId !== null && c.categoryId !== null) return 1;
    if (c.divisionId !== null) return 2;
    if (c.categoryId !== null) return 3;
    return 4;
  };
  let best: { c: FeeStructureCandidate; r: number } | null = null;
  for (const c of candidates) {
    const r = rank(c);
    if (r === null) continue;
    if (best === null || r < best.r) best = { c, r };
    else if (r === best.r) {
      throw new FinanceError('NO_FEE_STRUCTURE', 'More than one fee structure matches with the same specificity.', {
        a: best.c.id,
        b: c.id,
      });
    }
  }
  if (!best) {
    throw new FinanceError('NO_FEE_STRUCTURE', 'No published fee structure applies to this class, division and category.', ctx as unknown as Record<string, unknown>);
  }
  return best.c;
}

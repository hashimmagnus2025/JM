/**
 * Money primitives. ALL money in the system is an integer number of PAISE (1 rupee = 100 paise).
 * No floating point is ever used for a financial value: percentage math goes through BigInt,
 * splits use the largest-remainder method so parts always add up to the whole.
 */

/** Integer paise. Plain number alias: every boundary validates with `assertPaise`. */
export type Paise = number;

export class MoneyError extends Error {
  constructor(
    public readonly code: 'MONEY_NOT_INTEGER' | 'MONEY_NEGATIVE' | 'MONEY_OVERFLOW' | 'MONEY_INVALID_INPUT',
    message: string,
  ) {
    super(message);
    this.name = 'MoneyError';
  }
}

export const isPaise = (n: unknown): n is Paise => typeof n === 'number' && Number.isSafeInteger(n);

export function assertPaise(n: unknown, label = 'amount'): asserts n is Paise {
  if (!isPaise(n)) {
    throw new MoneyError('MONEY_NOT_INTEGER', `${label} must be a safe integer number of paise`);
  }
}

export function assertNonNegativePaise(n: unknown, label = 'amount'): asserts n is Paise {
  assertPaise(n, label);
  if (n < 0) throw new MoneyError('MONEY_NEGATIVE', `${label} must not be negative`);
}

export function assertPositivePaise(n: unknown, label = 'amount'): asserts n is Paise {
  assertPaise(n, label);
  if (n <= 0) throw new MoneyError('MONEY_NEGATIVE', `${label} must be greater than zero`);
}

function checked(n: number): number {
  if (!Number.isSafeInteger(n)) throw new MoneyError('MONEY_OVERFLOW', 'amount exceeds the safe range');
  return n;
}

export const addPaise = (a: Paise, b: Paise): Paise => checked(a + b);
export const subPaise = (a: Paise, b: Paise): Paise => checked(a - b);
export const minPaise = (a: Paise, b: Paise): Paise => (a < b ? a : b);

export function sumPaise(values: readonly Paise[]): Paise {
  let total = 0;
  for (const v of values) {
    assertPaise(v);
    total = checked(total + v);
  }
  return total;
}

/** round-half-up( a × b ÷ d ) for non-negative integers, exact (BigInt intermediate). */
export function mulDivRound(a: number, b: number, d: number): number {
  assertNonNegativePaise(a, 'a');
  assertNonNegativePaise(b, 'b');
  assertPositivePaise(d, 'd');
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(d);
  const q = (2n * num + den) / (2n * den);
  if (q > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError('MONEY_OVERFLOW', 'result exceeds the safe range');
  }
  return Number(q);
}

/** `bp` basis points (10000 = 100 %) of `amount`, rounded half-up to the paisa. */
export const percentBp = (amount: Paise, bp: number): Paise => mulDivRound(amount, bp, 10_000);

/**
 * Split `total` across `weights` proportionally using the largest-remainder method.
 * Guarantees Σ result = total and every part ≤ ceil(exact share).
 * Ties on the remainder go to the larger weight, then the lower index (deterministic).
 */
export function splitProportional(total: Paise, weights: readonly number[]): Paise[] {
  assertNonNegativePaise(total, 'total');
  if (weights.length === 0) throw new MoneyError('MONEY_INVALID_INPUT', 'weights must not be empty');
  weights.forEach((w) => assertNonNegativePaise(w, 'weight'));
  const sumW = weights.reduce((s, w) => s + BigInt(w), 0n);
  if (sumW === 0n) {
    if (total === 0) return weights.map(() => 0);
    throw new MoneyError('MONEY_INVALID_INPUT', 'cannot split a non-zero total over zero weights');
  }
  const T = BigInt(total);
  const rows = weights.map((w, index) => {
    const num = T * BigInt(w);
    return { index, w, base: num / sumW, rem: num % sumW };
  });
  const baseTotal = rows.reduce((s, r) => s + r.base, 0n);
  let leftover = Number(T - baseTotal);
  const order = [...rows].sort((a, b) =>
    a.rem === b.rem ? (a.w === b.w ? a.index - b.index : b.w - a.w) : a.rem > b.rem ? -1 : 1,
  );
  const result = rows.map((r) => Number(r.base));
  for (const r of order) {
    if (leftover === 0) break;
    if (r.rem > 0n) {
      result[r.index] = (result[r.index] ?? 0) + 1;
      leftover -= 1;
    }
  }
  return result;
}

/** n equal parts; every part is floor(total/n) and the LAST part absorbs the leftover paise. */
export function splitEvenRemainderLast(total: Paise, n: number): Paise[] {
  assertNonNegativePaise(total, 'total');
  if (!Number.isInteger(n) || n < 1) throw new MoneyError('MONEY_INVALID_INPUT', 'n must be a positive integer');
  const base = Math.floor(total / n);
  const parts = Array.from({ length: n }, () => base);
  parts[n - 1] = total - base * (n - 1);
  return parts;
}

/** n equal parts; the FIRST part absorbs the leftover paise. */
export function splitEvenRemainderFirst(total: Paise, n: number): Paise[] {
  const parts = splitEvenRemainderLast(total, n);
  const last = parts[n - 1] ?? 0;
  const base = parts[0] ?? 0;
  const extra = last - base;
  parts[n - 1] = base;
  parts[0] = base + extra;
  return parts;
}

/* ------------------------------ formatting / parsing ------------------------------ */

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
}

/** ₹1,25,000 — paise are shown only when non-zero (or when `forceDecimals`). */
export function formatINR(
  paise: Paise,
  opts: { symbol?: boolean; forceDecimals?: boolean } = {},
): string {
  assertPaise(paise);
  const { symbol = true, forceDecimals = false } = opts;
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const ps = abs % 100;
  let out = groupIndian(String(rupees));
  if (ps !== 0 || forceDecimals) out += `.${String(ps).padStart(2, '0')}`;
  return `${negative ? '−' : ''}${symbol ? '₹' : ''}${out}`;
}

/** Compact Indian notation used by the SOW: ₹4.25 Cr, ₹75 L, ₹12,500. Rounds half-up to 2 dp. */
export function formatINRCompact(paise: Paise): string {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const CRORE = 1_000_000_000; // 1 crore rupees in paise
  const LAKH = 10_000_000; // 1 lakh rupees in paise
  const fmt = (unit: number, suffix: string): string => {
    const hundredths = mulDivRound(abs, 100, unit); // value × 100, rounded half-up
    const whole = Math.floor(hundredths / 100);
    const frac = hundredths % 100;
    const fracStr = frac === 0 ? '' : `.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
    return `₹${whole}${fracStr} ${suffix}`;
  };
  let out: string;
  if (abs >= CRORE) out = fmt(CRORE, 'Cr');
  else if (abs >= LAKH) out = fmt(LAKH, 'L');
  else out = formatINR(abs);
  return negative ? `−${out}` : out;
}

/** Strict parser for user-typed rupee amounts → paise. No floats involved. */
export function parseRupeesToPaise(input: string): Paise {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new MoneyError('MONEY_INVALID_INPUT', `"${input}" is not a valid rupee amount`);
  }
  const [rupees = '0', frac = ''] = cleaned.split('.');
  const paise = Number(rupees) * 100 + Number(frac.padEnd(2, '0'));
  return checked(paise);
}

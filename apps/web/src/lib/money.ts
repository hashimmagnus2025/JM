import { formatINR, formatINRCompact } from '@sfm/shared';

/** ₹1,25,000 — money is integer paise everywhere; formatting happens only here */
export const rs = (paise: number): string => formatINR(paise);
/** ₹4.25 Cr / ₹75 L — for dashboards */
export const rsShort = (paise: number): string => formatINRCompact(paise);
/** "1500.5" → 150050 paise; null when it is not a valid rupee amount */
export function parseRupees(input: string): number | null {
  const t = input.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

import { canonicalJson } from '@sfm/shared';
import { sha256Hex } from '../../lib/hash';

/**
 * Tamper-evident audit trail: every entry carries `hash = SHA-256(prevHash ‖ canonical(entry))`.
 * Changing, deleting or re-ordering any past entry breaks every later hash, which the verifier detects.
 */

export interface AuditEntryInput {
  at: Date;
  userId?: string | undefined;
  userName?: string | undefined;
  roleKeys?: string[] | undefined;
  action: string;
  entityType: string;
  entityId: string;
  studentId?: string | undefined;
  academicYearId?: string | undefined;
  before?: unknown;
  after?: unknown;
  reason?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export interface ChainedAuditEntry extends AuditEntryInput {
  seq: number;
  prevHash: string;
  hash: string;
}

export const GENESIS_HASH = 'GENESIS';

/** keys that must never be written to the audit log, at any depth */
const SENSITIVE =
  /^(password|passwordHash|newPassword|currentPassword|tokenHash|refreshToken|accessToken|token|secret|mfaSecret|secretEnc|temporaryPassword)$/i;

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE.test(k) ? '[REDACTED]' : redactSensitive(v),
      ]),
    );
  }
  return value;
}

/** Only the fields that carry meaning are hashed; the hash itself and the sequence are not part of the input. */
function hashInput(e: AuditEntryInput & { seq: number }): string {
  return canonicalJson({
    seq: e.seq,
    at: e.at,
    userId: e.userId,
    userName: e.userName,
    // an empty list and a missing list are the same fact (storage may turn one into the other)
    roleKeys: e.roleKeys && e.roleKeys.length > 0 ? e.roleKeys : undefined,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    studentId: e.studentId,
    academicYearId: e.academicYearId,
    before: e.before,
    after: e.after,
    reason: e.reason,
    ip: e.ip,
    userAgent: e.userAgent,
    requestId: e.requestId,
  });
}

export const computeHash = (prevHash: string, e: AuditEntryInput & { seq: number }): string =>
  sha256Hex(`${prevHash}|${hashInput(e)}`);

export function chain(
  prev: { seq: number; hash: string } | null,
  input: AuditEntryInput,
): ChainedAuditEntry {
  const clean: AuditEntryInput = {
    ...input,
    ...(input.before !== undefined ? { before: redactSensitive(input.before) } : {}),
    ...(input.after !== undefined ? { after: redactSensitive(input.after) } : {}),
  };
  const seq = (prev?.seq ?? 0) + 1;
  const prevHash = prev?.hash ?? GENESIS_HASH;
  return { ...clean, seq, prevHash, hash: computeHash(prevHash, { ...clean, seq }) };
}

export type ChainVerification =
  { ok: true; count: number } | { ok: false; brokenAtSeq: number; reason: string };

/** Verify entries in ascending `seq` order. */
export function verifyChain(entries: readonly ChainedAuditEntry[]): ChainVerification {
  let prev: { seq: number; hash: string } | null = null;
  for (const e of entries) {
    if (e.seq !== (prev?.seq ?? 0) + 1)
      return { ok: false, brokenAtSeq: e.seq, reason: 'sequence gap or reorder' };
    if (e.prevHash !== (prev?.hash ?? GENESIS_HASH))
      return { ok: false, brokenAtSeq: e.seq, reason: 'previous hash mismatch' };
    if (e.hash !== computeHash(e.prevHash, e))
      return { ok: false, brokenAtSeq: e.seq, reason: 'entry was modified' };
    prev = e;
  }
  return { ok: true, count: entries.length };
}

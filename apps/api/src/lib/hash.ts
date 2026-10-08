import { createHash } from 'node:crypto';
import { canonicalJson } from '@sfm/shared';

export const sha256Hex = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

/** `sha256:<hex>` of a canonical string — used for preview hashes and fee-version content hashes. */
export const hashCanonical = (canonical: string): string => `sha256:${sha256Hex(canonical)}`;

/** hash of any JSON-serialisable value (key-order independent) */
export const hashValue = (value: unknown): string => hashCanonical(canonicalJson(value));

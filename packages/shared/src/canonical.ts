/**
 * Canonical JSON: deterministic serialisation (sorted object keys, no whitespace, `undefined`
 * properties omitted). Used to hash fee previews and fee-structure versions so that
 * "what the user saw" can be compared with "what the server recomputed".
 */
export function canonicalJson(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'undefined':
      throw new TypeError('canonicalJson: undefined is only allowed as an object property');
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
    default:
      break;
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((v) => stringify(v === undefined ? null : v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stringify(obj[k])}`).join(',')}}`;
}

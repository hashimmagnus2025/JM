import { describe, expect, it } from 'vitest';
import { hexCodec, symbolicCodec } from './id-codec';

describe('id codecs', () => {
  it('hex codec round-trips real ObjectIds', () => {
    const hex = '65f1c2a4b3d4e5f607182930';
    expect(hexCodec.fromDb(hexCodec.toDb(hex))).toBe(hex);
    expect(() => hexCodec.toDb('not-an-id')).toThrow();
  });
  it('symbolic codec maps names to stable ObjectIds and back', () => {
    const c = symbolicCodec();
    const a = c.toDb('stu-1');
    expect(c.toDb('stu-1').equals(a)).toBe(true);
    expect(c.toDb('stu-2').equals(a)).toBe(false);
    expect(c.fromDb(a)).toBe('stu-1');
    expect(c.fromDb('65f1c2a4b3d4e5f607182930')).toBe('65f1c2a4b3d4e5f607182930');
    expect(c.fromDb(c.toDb('65f1c2a4b3d4e5f607182930'))).toBe('65f1c2a4b3d4e5f607182930');
  });
});

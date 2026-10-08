import { createHash } from 'node:crypto';
import mongoose from 'mongoose';

/**
 * Domain ids are strings; MongoDB ids are ObjectIds. Production uses the identity-by-hex codec.
 * Tests may use symbolic names ('i1', 'stu-1'): the symbolic codec maps each name to a stable ObjectId.
 */
export interface IdCodec {
  toDb(id: string): mongoose.Types.ObjectId;
  fromDb(value: unknown): string;
}

const HEX24 = /^[0-9a-f]{24}$/i;

export const hexCodec: IdCodec = {
  toDb: (id) => new mongoose.Types.ObjectId(id),
  fromDb: (v) => String(v),
};

export function symbolicCodec(): IdCodec {
  const reverse = new Map<string, string>();
  return {
    toDb(id) {
      if (HEX24.test(id)) return new mongoose.Types.ObjectId(id);
      const hex = createHash('sha1').update(id).digest('hex').slice(0, 24);
      reverse.set(hex, id);
      return new mongoose.Types.ObjectId(hex);
    },
    fromDb(v) {
      const hex = String(v);
      return reverse.get(hex) ?? hex;
    },
  };
}

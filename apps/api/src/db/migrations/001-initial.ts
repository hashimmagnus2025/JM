import type { Connection } from 'mongoose';
import { MODEL_DEFS } from '../schema-helpers';
import '../models';

/**
 * Migration 001 — create every collection (with its DB-level validator where one exists) and every index.
 * Idempotent: safe to run repeatedly. Indexes are never created implicitly by the app (`autoIndex: false`)
 * and `syncIndexes()` (which can DROP indexes) is never used in production.
 */
export async function up(conn: Connection): Promise<{ collections: number; indexes: number }> {
  const existing = new Set((await conn.listCollections()).map((c) => c.name));
  let indexes = 0;
  for (const def of MODEL_DEFS) {
    const model = conn.model(def.name);
    if (!existing.has(def.collection)) {
      await model.createCollection(
        def.validator
          ? { validator: def.validator, validationLevel: 'strict', validationAction: 'error' }
          : {},
      );
    } else if (def.validator) {
      await conn.db!.command({
        collMod: def.collection,
        validator: def.validator,
        validationLevel: 'strict',
        validationAction: 'error',
      });
    }
    await model.createIndexes();
    indexes += model.schema.indexes().length;
  }
  return { collections: MODEL_DEFS.length, indexes };
}

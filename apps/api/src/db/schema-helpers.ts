import mongoose, {
  Schema,
  type IndexDirection,
  type IndexOptions,
  type SchemaDefinition,
} from 'mongoose';

/** integer paise (safe integer) — floats are rejected at the schema level too */
export const paise = (opts: { required?: boolean; min?: number | null } = {}) => ({
  type: Number,
  required: opts.required ?? true,
  ...(opts.min === null ? {} : { min: opts.min ?? 0 }),
  validate: {
    validator: (v: number) => Number.isSafeInteger(v),
    message: '{PATH} must be a whole number of paise',
  },
});

/** business date 'YYYY-MM-DD' (institution time zone) — never a Date */
export const businessDate = (opts: { required?: boolean } = {}) => ({
  type: String,
  required: opts.required ?? true,
  match: [/^\d{4}-\d{2}-\d{2}$/, '{PATH} must be a YYYY-MM-DD business date'],
});

export const oid = (ref: string, required = true) => ({
  type: Schema.Types.ObjectId,
  ref,
  required,
});
export const str = (required = true, extra: Record<string, unknown> = {}) => ({
  type: String,
  required,
  trim: true,
  ...extra,
});
export const bool = (def = false) => ({ type: Boolean, default: def });
export const mixed = () => ({ type: Schema.Types.Mixed });
export const enumStr = (values: readonly string[], required = true, def?: string) => ({
  type: String,
  required,
  enum: values,
  ...(def !== undefined ? { default: def } : {}),
});

/** every business document belongs to an institution (multi-institution readiness) */
export const tenant = { institutionId: oid('Institution') };

export type IndexSpec = [Record<string, IndexDirection>, IndexOptions?];

export interface ModelDef {
  name: string;
  collection: string;
  fields: Record<string, unknown>;
  indexes?: IndexSpec[];
  timestamps?: boolean;
  /** MongoDB collection validator ($expr / $jsonSchema), applied by the migration */
  validator?: Record<string, unknown>;
}

/** registry used by the migration, the contract tests and the schema documentation */
export const MODEL_DEFS: ModelDef[] = [];

export function defineModel(def: ModelDef) {
  const schema = new Schema(def.fields as SchemaDefinition, {
    collection: def.collection,
    timestamps: def.timestamps ?? true,
    versionKey: false,
    strict: true,
    autoIndex: false, // indexes are created by migrations, never implicitly (production safety)
    autoCreate: false,
    suppressReservedKeysWarning: true,
  });
  for (const [spec, options] of def.indexes ?? []) schema.index(spec, options ?? {});
  MODEL_DEFS.push(def);
  return mongoose.models[def.name] ?? mongoose.model(def.name, schema);
}

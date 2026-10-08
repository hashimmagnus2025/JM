import { Schema } from 'mongoose';
import { bool, defineModel, enumStr, mixed, oid, str, tenant } from '../schema-helpers';

export const Institution = defineModel({
  name: 'Institution',
  collection: 'institutions',
  fields: {
    name: str(),
    shortName: str(false),
    code: str(true),
    logoFileId: oid('File', false),
    address: {
      line1: str(false),
      line2: str(false),
      city: str(false),
      state: str(false),
      pincode: str(false),
      country: str(false),
    },
    contact: { phone: str(false), altPhone: str(false), email: str(false), website: str(false) },
    registrationNo: str(false),
    timezone: str(true, { default: 'Asia/Kolkata' }),
    currency: str(true, { default: 'INR' }),
    academicStartMonth: { type: Number, default: 4, min: 1, max: 12 },
    receiptFooter: str(false),
    extra: { type: Map, of: String },
  },
  indexes: [[{ code: 1 }, { unique: true }]],
});

export const SystemSetting = defineModel({
  name: 'SystemSetting',
  collection: 'system_settings',
  fields: {
    ...tenant,
    key: str(),
    value: mixed(),
    schemaVersion: { type: Number, default: 1 },
    updatedBy: oid('User', false),
  },
  indexes: [[{ institutionId: 1, key: 1 }, { unique: true }]],
});

/** atomic sequence counters (receipt / payment numbers) — `_id` is `${institutionId}:${seriesKey}` */
export const Counter = defineModel({
  name: 'Counter',
  collection: 'counters',
  fields: {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0, min: 0 },
  },
  timestamps: false,
});

export const File = defineModel({
  name: 'File',
  collection: 'files',
  fields: {
    ...tenant,
    key: str(),
    bucket: str(),
    mime: str(),
    size: { type: Number, required: true, min: 0 },
    sha256: str(),
    kind: enumStr(['LOGO', 'RECEIPT_PDF', 'EXPORT', 'IMPORT', 'PHOTO']),
    ownerType: str(false),
    ownerId: str(false),
    expiresAt: { type: Date },
  },
  indexes: [
    [{ bucket: 1, key: 1 }, { unique: true }],
    [{ ownerType: 1, ownerId: 1 }],
    [{ expiresAt: 1 }, { sparse: true }],
  ],
});

/** replay store for retry-sensitive APIs (admission, promotion, import commit…) — 48 h TTL */
export const IdempotencyKey = defineModel({
  name: 'IdempotencyKey',
  collection: 'idempotency_keys',
  fields: {
    ...tenant,
    userId: oid('User'),
    route: str(),
    key: str(),
    requestHash: str(),
    status: enumStr(['IN_PROGRESS', 'DONE'], true, 'IN_PROGRESS'),
    responseStatus: { type: Number },
    responseBody: mixed(),
  },
  indexes: [
    [{ institutionId: 1, userId: 1, route: 1, key: 1 }, { unique: true }],
    [{ createdAt: 1 }, { expireAfterSeconds: 48 * 3600 }],
  ],
});

export { Schema, bool };

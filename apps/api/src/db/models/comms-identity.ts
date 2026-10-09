import { Schema } from 'mongoose';
import {
  bool,
  businessDate,
  defineModel,
  enumStr,
  mixed,
  oid,
  paise,
  str,
  tenant,
} from '../schema-helpers';

const CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL', 'IN_APP'] as const;

export const ReminderTemplate = defineModel({
  name: 'ReminderTemplate',
  collection: 'reminder_templates',
  fields: {
    ...tenant,
    code: str(),
    name: str(),
    channel: enumStr(CHANNELS),
    type: enumStr(['UPCOMING', 'DUE_TODAY', 'OVERDUE', 'FOLLOW_UP', 'MANUAL', 'CUSTOM']),
    language: str(true, { default: 'en' }),
    subject: str(false),
    body: str(),
    variables: { type: [String], default: [] },
    providerTemplateId: str(false),
    approvalStatus: enumStr(['NA', 'PENDING', 'APPROVED', 'REJECTED'], true, 'NA'),
    isActive: bool(true),
    version: { type: Number, default: 1 },
  },
  indexes: [[{ institutionId: 1, code: 1 }, { unique: true }]],
});

export const ReminderRule = defineModel({
  name: 'ReminderRule',
  collection: 'reminder_rules',
  fields: {
    ...tenant,
    name: str(),
    type: enumStr(['UPCOMING', 'DUE_TODAY', 'OVERDUE', 'FOLLOW_UP']),
    offsetDays: { type: Number, required: true, min: -365, max: 365 },
    repeatEveryDays: { type: Number, min: 1 },
    maxRepeats: { type: Number, min: 1 },
    sendTime: str(true, { match: /^\d{2}:\d{2}$/ }),
    channels: { type: [String], enum: CHANNELS, default: [] },
    templateByChannel: mixed(),
    targets: mixed(),
    isActive: bool(true),
  },
  indexes: [[{ institutionId: 1, isActive: 1 }]],
});

export const ReminderCampaign = defineModel({
  name: 'ReminderCampaign',
  collection: 'reminder_campaigns',
  fields: {
    ...tenant,
    source: enumStr(['MANUAL', 'RULE']),
    ruleId: oid('ReminderRule', false),
    name: str(),
    audienceFilter: mixed(),
    studentIds: { type: [Schema.Types.ObjectId], default: undefined },
    channels: { type: [String], enum: CHANNELS, default: [] },
    templateByChannel: mixed(),
    scheduledFor: { type: Date },
    status: enumStr(['DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED'], true, 'DRAFT'),
    counts: mixed(),
    createdBy: oid('User', false),
  },
  indexes: [[{ institutionId: 1, status: 1, scheduledFor: 1 }]],
});

export const Reminder = defineModel({
  name: 'Reminder',
  collection: 'reminders',
  fields: {
    ...tenant,
    campaignId: oid('ReminderCampaign', false),
    ruleId: oid('ReminderRule', false),
    studentId: oid('Student'),
    guardianSnapshot: { name: String, mobile: String, email: String },
    receivableIds: { type: [Schema.Types.ObjectId], default: [] },
    academicYearId: oid('AcademicYear', false),
    channel: enumStr(CHANNELS),
    type: str(),
    templateId: oid('ReminderTemplate', false),
    renderedMessage: str(false),
    pendingAtSend: paise({ required: false }),
    scheduledFor: { type: Date, required: true },
    status: enumStr(
      ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'CANCELLED'],
      true,
      'QUEUED',
    ),
    skipReason: str(false),
    failureReason: str(false),
    providerMessageId: str(false),
    attempts: { type: Number, default: 0 },
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    sentBy: str(true, { default: 'SYSTEM' }),
    dedupeKey: str(),
  },
  indexes: [
    // at most one reminder per rule/receivable/offset/channel, even if the scanner runs twice
    [{ institutionId: 1, dedupeKey: 1 }, { unique: true }],
    [{ studentId: 1, createdAt: -1 }],
    [{ status: 1, scheduledFor: 1 }],
    [{ providerMessageId: 1 }, { sparse: true }],
    [{ campaignId: 1, status: 1 }, { sparse: true }],
    [{ institutionId: 1, sentAt: 1 }],
  ],
});

export const Notification = defineModel({
  name: 'Notification',
  collection: 'notifications',
  fields: {
    ...tenant,
    recipientUserId: oid('User'),
    type: str(),
    title: str(),
    body: str(false),
    link: str(false),
    readAt: { type: Date },
  },
  indexes: [[{ recipientUserId: 1, readAt: 1, createdAt: -1 }]],
});

export const User = defineModel({
  name: 'User',
  collection: 'users',
  fields: {
    ...tenant,
    email: str(true, { lowercase: true }),
    name: str(),
    mobile: str(false),
    passwordHash: str(false, { select: false }),
    roleIds: { type: [Schema.Types.ObjectId], ref: 'Role', default: [] },
    teacherId: oid('Teacher', false),
    status: enumStr(['INVITED', 'ACTIVE', 'INACTIVE', 'LOCKED'], true, 'INVITED'),
    mustChangePassword: bool(true),
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    lastLoginAt: { type: Date },
    tokenVersion: { type: Number, default: 0 },
    mfa: { enabled: Boolean, secretEnc: { type: String, select: false } },
  },
  indexes: [[{ institutionId: 1, email: 1 }, { unique: true }]],
});

export const Role = defineModel({
  name: 'Role',
  collection: 'roles',
  fields: {
    ...tenant,
    key: str(),
    name: str(),
    description: str(false),
    permissions: { type: [String], default: [] },
    dataScope: enumStr(['ALL', 'OWN_DIVISIONS'], true, 'ALL'),
    isSystem: bool(false),
    isActive: bool(true),
    version: { type: Number, default: 0 },
  },
  indexes: [[{ institutionId: 1, key: 1 }, { unique: true }]],
});

export const Session = defineModel({
  name: 'Session',
  collection: 'sessions',
  fields: {
    ...tenant,
    userId: oid('User'),
    familyId: str(),
    tokenHash: str(),
    userAgent: str(false),
    ip: str(false),
    lastUsedAt: { type: Date },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedBy: str(false),
  },
  indexes: [
    [{ familyId: 1 }],
    [{ userId: 1, revokedAt: 1 }],
    [{ tokenHash: 1 }, { unique: true }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ],
});

/** APPEND-ONLY, hash-chained (hardening phase); the API's DB role gets insert-only on this collection */
export const AuditLog = defineModel({
  name: 'AuditLog',
  collection: 'audit_logs',
  timestamps: false,
  fields: {
    ...tenant,
    at: { type: Date, required: true, immutable: true },
    userId: oid('User', false),
    userName: str(false),
    roleKeys: { type: [String], default: [] },
    action: str(),
    entityType: str(),
    entityId: str(),
    studentId: oid('Student', false),
    academicYearId: oid('AcademicYear', false),
    before: mixed(),
    after: mixed(),
    reason: str(false),
    ip: str(false),
    userAgent: str(false),
    requestId: str(false),
    correlationId: str(false),
    /** position in the tamper-evident chain; the unique index lets exactly one concurrent writer take each number */
    seq: { type: Number, min: 1 },
    prevHash: str(false),
    hash: str(false),
  },
  indexes: [
    [
      { institutionId: 1, seq: 1 },
      {
        unique: true,
        partialFilterExpression: { seq: { $type: 'number' } },
        name: 'audit_chain_seq',
      },
    ],
    [{ entityType: 1, entityId: 1, at: -1 }],
    [{ studentId: 1, at: -1 }, { sparse: true }],
    [{ userId: 1, at: -1 }],
    [{ action: 1, at: -1 }],
    [{ institutionId: 1, at: -1 }],
  ],
});

export const ImportBatch = defineModel({
  name: 'ImportBatch',
  collection: 'import_batches',
  fields: {
    ...tenant,
    type: enumStr([
      'STUDENTS',
      'ENROLLMENTS',
      'CLASSES',
      'DIVISIONS',
      'TEACHER_ASSIGNMENTS',
      'OPENING_BALANCES',
      'FEES',
      'PAYMENTS',
    ]),
    fileId: oid('File'),
    checksum: str(),
    status: enumStr(
      [
        'UPLOADED',
        'VALIDATING',
        'VALIDATED',
        'COMMITTING',
        'COMMITTED',
        'PARTIAL',
        'FAILED',
        'CANCELLED',
      ],
      true,
      'UPLOADED',
    ),
    mapping: mixed(),
    summary: mixed(),
    options: mixed(),
    confirmedBy: oid('User', false),
    confirmedAt: { type: Date },
    committedCounts: mixed(),
  },
  indexes: [[{ institutionId: 1, status: 1, createdAt: -1 }], [{ institutionId: 1, checksum: 1 }]],
});

export const ImportRow = defineModel({
  name: 'ImportRow',
  collection: 'import_rows',
  fields: {
    ...tenant,
    batchId: oid('ImportBatch'),
    rowNo: { type: Number, required: true, min: 1 },
    raw: mixed(),
    normalized: mixed(),
    status: enumStr(['VALID', 'INVALID', 'DUPLICATE', 'WARNING', 'COMMITTED', 'FAILED']),
    errors: { type: [{ field: String, code: String, message: String }], default: [] },
    createdEntityId: { type: Schema.Types.ObjectId },
  },
  indexes: [[{ batchId: 1, rowNo: 1 }, { unique: true }], [{ batchId: 1, status: 1 }]],
});

export const ExportJob = defineModel({
  name: 'ExportJob',
  collection: 'export_jobs',
  fields: {
    ...tenant,
    reportKey: str(),
    format: enumStr(['PDF', 'XLSX', 'CSV']),
    filters: mixed(),
    requestedBy: oid('User'),
    status: enumStr(['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED'], true, 'QUEUED'),
    fileId: oid('File', false),
    rowCount: { type: Number },
    expiresAt: { type: Date },
  },
  indexes: [[{ requestedBy: 1, createdAt: -1 }], [{ expiresAt: 1 }, { sparse: true }]],
});

export { businessDate };

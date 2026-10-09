/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { type Connection } from 'mongoose';
import '../../db/models';
import { AuditSeqConflict, type AuditStore } from '../audit/audit.service';
import type { ChainedAuditEntry } from '../audit/audit-chain';
import {
  DuplicateEmailError,
  DuplicateRoleKeyError,
  type NewRole,
  type NewUser,
  type RoleRecord,
  type RoleRepo,
  type SessionRecord,
  type SessionRepo,
  type UserListQuery,
  type UserRecord,
  type UserRepo,
} from './ports';

const HEX24 = /^[a-f0-9]{24}$/i;
const oid = (s: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(s);
const str = (v: unknown): string => String(v);
const isDuplicate = (e: unknown): boolean => (e as { code?: number })?.code === 11000;
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** internal operators are built from validated values only; mark them trusted so `sanitizeFilter` lets them through */
const t = mongoose.trusted;

const toUser = (d: any): UserRecord => ({
  id: str(d._id),
  institutionId: str(d.institutionId),
  email: d.email,
  name: d.name,
  mobile: d.mobile ?? undefined,
  passwordHash: d.passwordHash ?? '',
  roleIds: (d.roleIds ?? []).map(str),
  status: d.status,
  mustChangePassword: !!d.mustChangePassword,
  failedLoginCount: d.failedLoginCount ?? 0,
  lockedUntil: d.lockedUntil ?? null,
  lastLoginAt: d.lastLoginAt ?? undefined,
  tokenVersion: d.tokenVersion ?? 0,
  createdAt: d.createdAt ?? new Date(0),
});

const toRole = (d: any): RoleRecord => ({
  id: str(d._id),
  institutionId: str(d.institutionId),
  key: d.key,
  name: d.name,
  description: d.description ?? undefined,
  permissions: d.permissions ?? [],
  dataScope: d.dataScope,
  isSystem: !!d.isSystem,
  isActive: d.isActive !== false,
  version: d.version ?? 0,
});

const toSession = (d: any): SessionRecord => ({
  id: str(d._id),
  institutionId: str(d.institutionId),
  userId: str(d.userId),
  familyId: d.familyId,
  tokenHash: d.tokenHash,
  userAgent: d.userAgent ?? undefined,
  ip: d.ip ?? undefined,
  createdAt: d.createdAt ?? d.lastUsedAt,
  lastUsedAt: d.lastUsedAt,
  expiresAt: d.expiresAt,
  revokedAt: d.revokedAt ?? undefined,
  replacedBy: d.replacedBy ?? undefined,
});

export class MongoUserRepo implements UserRepo {
  private readonly M: any;
  private readonly inst: mongoose.Types.ObjectId;
  constructor(conn: Connection, institutionId: string) {
    this.M = conn.model('User');
    this.inst = oid(institutionId);
  }
  private scope = (extra: Record<string, unknown> = {}) => ({ institutionId: this.inst, ...extra });

  async findById(id: string) {
    if (!HEX24.test(id)) return null;
    const d = await this.M.findOne(this.scope({ _id: oid(id) }))
      .select('+passwordHash')
      .lean();
    return d ? toUser(d) : null;
  }
  async findByEmail(email: string) {
    const d = await this.M.findOne(this.scope({ email: email.trim().toLowerCase() }))
      .select('+passwordHash')
      .lean();
    return d ? toUser(d) : null;
  }
  async create(u: NewUser) {
    try {
      const d = await this.M.create({
        institutionId: this.inst,
        email: u.email.trim().toLowerCase(),
        name: u.name,
        mobile: u.mobile,
        passwordHash: u.passwordHash,
        roleIds: u.roleIds.map(oid),
        status: u.status,
        mustChangePassword: u.mustChangePassword,
      });
      return toUser(d.toObject());
    } catch (e) {
      if (isDuplicate(e)) throw new DuplicateEmailError();
      throw e;
    }
  }
  async update(id: string, patch: Parameters<UserRepo['update']>[1]) {
    const set: Record<string, unknown> = { ...patch };
    if (patch.roleIds) set.roleIds = patch.roleIds.map(oid);
    const d = await this.M.findOneAndUpdate(
      this.scope({ _id: oid(id) }),
      { $set: set },
      { new: true },
    )
      .select('+passwordHash')
      .lean();
    return d ? toUser(d) : null;
  }
  async incrementFailedLogin(id: string) {
    const d = await this.M.findOneAndUpdate(
      this.scope({ _id: oid(id) }),
      { $inc: { failedLoginCount: 1 } },
      { new: true },
    ).lean();
    return (d?.failedLoginCount as number) ?? 0;
  }
  async lockUntil(id: string, until: Date) {
    await this.M.updateOne(this.scope({ _id: oid(id) }), { $set: { lockedUntil: until } });
  }
  async unlock(id: string) {
    await this.M.updateOne(this.scope({ _id: oid(id) }), {
      $set: { failedLoginCount: 0, lockedUntil: null },
    });
  }
  async registerSuccessfulLogin(id: string, at: Date) {
    await this.M.updateOne(this.scope({ _id: oid(id) }), {
      $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: at },
    });
  }
  async setPassword(
    id: string,
    passwordHash: string,
    opts: { mustChangePassword: boolean; activate: boolean },
  ) {
    const d = await this.M.findOneAndUpdate(
      this.scope({ _id: oid(id) }),
      {
        $set: {
          passwordHash,
          mustChangePassword: opts.mustChangePassword,
          failedLoginCount: 0,
          lockedUntil: null,
        },
        $inc: { tokenVersion: 1 },
      },
      { new: true },
    ).lean();
    if (!d) return null;
    if (opts.activate && d.status === 'INVITED') {
      await this.M.updateOne(this.scope({ _id: oid(id), status: 'INVITED' }), {
        $set: { status: 'ACTIVE' },
      });
    }
    return this.findById(id);
  }
  async list(q: UserListQuery) {
    const filter: Record<string, unknown> = this.scope();
    if (q.status) filter.status = q.status;
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      filter.$or = t([{ name: rx }, { email: rx }]);
    }
    const [docs, total] = await Promise.all([
      this.M.find(filter)
        .sort({ name: 1, _id: 1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean(),
      this.M.countDocuments(filter),
    ]);
    return { items: docs.map(toUser), total: total as number };
  }
  async countActiveWithRole(roleId: string, excludeUserId?: string) {
    return this.M.countDocuments(
      this.scope({
        status: 'ACTIVE',
        roleIds: oid(roleId),
        ...(excludeUserId ? { _id: t({ $ne: oid(excludeUserId) }) } : {}),
      }),
    );
  }
  async countUsersWithRole(roleId: string) {
    return this.M.countDocuments(this.scope({ roleIds: oid(roleId) }));
  }
}

export class MongoRoleRepo implements RoleRepo {
  private readonly M: any;
  private readonly inst: mongoose.Types.ObjectId;
  constructor(conn: Connection, institutionId: string) {
    this.M = conn.model('Role');
    this.inst = oid(institutionId);
  }
  private scope = (extra: Record<string, unknown> = {}) => ({ institutionId: this.inst, ...extra });

  async findById(id: string) {
    if (!HEX24.test(id)) return null;
    const d = await this.M.findOne(this.scope({ _id: oid(id) })).lean();
    return d ? toRole(d) : null;
  }
  async findByIds(ids: readonly string[]) {
    const valid = ids.filter((i) => HEX24.test(i)).map(oid);
    if (valid.length === 0) return [];
    return (await this.M.find(this.scope({ _id: t({ $in: valid }) })).lean()).map(toRole);
  }
  async findByKey(key: string) {
    const d = await this.M.findOne(this.scope({ key })).lean();
    return d ? toRole(d) : null;
  }
  async list() {
    return (await this.M.find(this.scope()).lean()).map(toRole);
  }
  async create(r: NewRole) {
    try {
      const d = await this.M.create({ ...r, institutionId: this.inst });
      return toRole(d.toObject());
    } catch (e) {
      if (isDuplicate(e)) throw new DuplicateRoleKeyError();
      throw e;
    }
  }
  async update(id: string, patch: Parameters<RoleRepo['update']>[1], expectedVersion: number) {
    const d = await this.M.findOneAndUpdate(
      this.scope({ _id: oid(id), version: expectedVersion }),
      { $set: patch, $inc: { version: 1 } },
      { new: true },
    ).lean();
    return d ? toRole(d) : null;
  }
}

export class MongoSessionRepo implements SessionRepo {
  private readonly M: any;
  private readonly inst: mongoose.Types.ObjectId;
  constructor(conn: Connection, institutionId: string) {
    this.M = conn.model('Session');
    this.inst = oid(institutionId);
  }
  private scope = (extra: Record<string, unknown> = {}) => ({ institutionId: this.inst, ...extra });

  async create(s: Omit<SessionRecord, 'id'>) {
    const d = await this.M.create({ ...s, institutionId: this.inst, userId: oid(s.userId) });
    return toSession(d.toObject());
  }
  async findByTokenHash(hash: string) {
    const d = await this.M.findOne(this.scope({ tokenHash: hash })).lean();
    return d ? toSession(d) : null;
  }
  async findById(id: string) {
    if (!HEX24.test(id)) return null;
    const d = await this.M.findOne(this.scope({ _id: oid(id) })).lean();
    return d ? toSession(d) : null;
  }
  /** guarded: `revokedAt: null` in the filter → only the first of several concurrent callers modifies the document */
  async markRotated(id: string, replacedBy: string | undefined, at: Date) {
    const r = await this.M.updateOne(this.scope({ _id: oid(id), revokedAt: null }), {
      $set: { revokedAt: at, replacedBy },
    });
    return r.modifiedCount === 1;
  }
  async touch(id: string, at: Date) {
    await this.M.updateOne(this.scope({ _id: oid(id) }), { $set: { lastUsedAt: at } });
  }
  async revoke(id: string, at: Date) {
    await this.M.updateOne(this.scope({ _id: oid(id), revokedAt: null }), {
      $set: { revokedAt: at },
    });
  }
  async revokeFamily(familyId: string, at: Date) {
    await this.M.updateMany(this.scope({ familyId, revokedAt: null }), { $set: { revokedAt: at } });
  }
  async revokeAllForUser(userId: string, at: Date, exceptSessionId?: string) {
    const r = await this.M.updateMany(
      this.scope({
        userId: oid(userId),
        revokedAt: null,
        ...(exceptSessionId ? { _id: t({ $ne: oid(exceptSessionId) }) } : {}),
      }),
      { $set: { revokedAt: at } },
    );
    return r.modifiedCount as number;
  }
  async listActiveForUser(userId: string, now: Date) {
    return (
      await this.M.find(
        this.scope({ userId: oid(userId), revokedAt: null, expiresAt: t({ $gt: now }) }),
      )
        .sort({ lastUsedAt: -1 })
        .lean()
    ).map(toSession);
  }
}

/** chained audit log on MongoDB; the unique (institutionId, seq) index decides which concurrent writer wins a sequence number */
export class MongoAuditStore implements AuditStore {
  private readonly M: any;
  private readonly inst: mongoose.Types.ObjectId;
  constructor(conn: Connection, institutionId: string) {
    this.M = conn.model('AuditLog');
    this.inst = oid(institutionId);
  }
  async head() {
    const d = await this.M.findOne({ institutionId: this.inst, seq: t({ $type: 'number' }) })
      .sort({ seq: -1 })
      .lean();
    return d ? { seq: d.seq as number, hash: d.hash as string } : null;
  }
  async insert(e: ChainedAuditEntry) {
    const ref = (v: string | undefined) => (v && HEX24.test(v) ? oid(v) : undefined);
    try {
      await this.M.create({
        institutionId: this.inst,
        seq: e.seq,
        at: e.at,
        userId: ref(e.userId),
        userName: e.userName,
        roleKeys: e.roleKeys ?? [],
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        studentId: ref(e.studentId),
        academicYearId: ref(e.academicYearId),
        before: e.before,
        after: e.after,
        reason: e.reason,
        ip: e.ip,
        userAgent: e.userAgent,
        requestId: e.requestId,
        prevHash: e.prevHash,
        hash: e.hash,
      });
    } catch (err) {
      if (isDuplicate(err)) throw new AuditSeqConflict();
      throw err;
    }
  }
  async list(opts: { fromSeq?: number; limit: number }) {
    const docs = await this.M.find({
      institutionId: this.inst,
      seq: t({ $gte: opts.fromSeq ?? 1 }),
    })
      .sort({ seq: 1 })
      .limit(opts.limit)
      .lean();
    return docs.map((d: any): ChainedAuditEntry => ({
      seq: d.seq,
      at: d.at,
      userId: d.userId ? str(d.userId) : undefined,
      userName: d.userName ?? undefined,
      roleKeys: d.roleKeys ?? [],
      action: d.action,
      entityType: d.entityType,
      entityId: d.entityId,
      studentId: d.studentId ? str(d.studentId) : undefined,
      academicYearId: d.academicYearId ? str(d.academicYearId) : undefined,
      before: d.before,
      after: d.after,
      reason: d.reason ?? undefined,
      ip: d.ip ?? undefined,
      userAgent: d.userAgent ?? undefined,
      requestId: d.requestId ?? undefined,
      prevHash: d.prevHash,
      hash: d.hash,
    }));
  }
}

// data/reports.js
import { getDb } from '../config/mongoConnection.js';
import { randomBytes } from 'crypto';

const VALID_TARGET_TYPES = new Set(['station', 'elevator', 'aps', 'ramp']);

const REPORT_ID_BYTES = 8; // 16 hex chars + "R" prefix
const MAX_TARGET_ID_LEN = 200;
const MAX_TEXT_LEN = 500;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function makeError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string') throw makeError(`${name} must be a string`, 400);
  const s = v.trim();
  if (!s) throw makeError(`${name} cannot be empty`, 400);
  return s;
}

function normalizeLimit(limit, def = DEFAULT_LIMIT, max = MAX_LIMIT) {
  const n = Number(limit);
  if (!Number.isInteger(n) || n <= 0) return def;
  return Math.min(n, max);
}

function normalizeTargetType(targetType) {
  const t = assertNonEmptyString(targetType, 'targetType').toLowerCase();
  if (!VALID_TARGET_TYPES.has(t)) {
    throw makeError('targetType must be one of: station, elevator, aps, ramp', 400);
  }
  return t;
}

function normalizeTargetId(targetId) {
  const s = String(targetId ?? '').trim();
  if (!s) throw makeError('targetId cannot be empty', 400);
  if (s.length > MAX_TARGET_ID_LEN) throw makeError('targetId is too long', 400);
  return s;
}

function normalizeText(text) {
  const s = assertNonEmptyString(text, 'text');
  if (s.length > MAX_TEXT_LEN) throw makeError(`text is too long (max ${MAX_TEXT_LEN} chars)`, 400);
  return s;
}

function normalizeReportId(reportId) {
  const id = assertNonEmptyString(String(reportId ?? ''), 'reportId');
  if (id.length > 200) throw makeError('reportId is too long', 400);
  return id;
}

function normalizeUserId(userId) {
  const id = assertNonEmptyString(String(userId ?? ''), 'userId');
  if (id.length > 200) throw makeError('userId is too long', 400);
  return id;
}

function newReportId() {
  return `R${randomBytes(REPORT_ID_BYTES).toString('hex')}`;
}

function sanitizeReport(doc) {
  if (!doc) return doc;
  const out = { ...doc };
  if (out._id && typeof out._id === 'object' && typeof out._id.toString === 'function') {
    out._id = out._id.toString();
  }
  return out;
}

// One-time index initialization (avoid re-creating indexes on every request).
// If index creation fails once (e.g., due to duplicates), reset so a future call can retry.
let _indexesReady = null;

async function reportsCollection(dbParam) {
  const db = dbParam || (await getDb());
  const col = db.collection('reports');

  if (!_indexesReady) {
    _indexesReady = (async () => {
      await col.createIndex({ reportId: 1 }, { unique: true });
      await col.createIndex({ targetType: 1, targetId: 1, status: 1, createdAt: -1 });
      await col.createIndex({ createdAt: -1 });
      await col.createIndex({ 'createdBy.userId': 1, createdAt: -1 });
    })().catch((err) => {
      _indexesReady = null;
      throw err;
    });
  }

  await _indexesReady;
  return col;
}

async function targetExists(db, targetType, targetId) {
  switch (targetType) {
    case 'station': {
      const doc = await db.collection('stations').findOne(
        { stationId: targetId },
        { projection: { _id: 1 } }
      );
      return !!doc;
    }
    case 'elevator': {
      const doc = await db.collection('elevators').findOne(
        { elevatorId: targetId },
        { projection: { _id: 1 } }
      );
      return !!doc;
    }
    case 'aps': {
      const doc = await db.collection('aps_locations').findOne(
        { apsId: targetId },
        { projection: { _id: 1 } }
      );
      return !!doc;
    }
    case 'ramp': {
      const doc = await db.collection('curb_ramps').findOne(
        { rampId: targetId },
        { projection: { _id: 1 } }
      );
      return !!doc;
    }
    default:
      return false;
  }
}

// ---------------------------
// Public API
// ---------------------------

export async function createReport({ targetType, targetId, text, createdBy }) {
  const db = await getDb();

  const tType = normalizeTargetType(targetType);
  const tId = normalizeTargetId(targetId);
  const tText = normalizeText(text);

  if (!createdBy || typeof createdBy !== 'object') {
    throw makeError('createdBy is required', 401);
  }

  const createdByUserId =
    createdBy.userId != null ? assertNonEmptyString(String(createdBy.userId), 'createdBy.userId') : '';
  const createdByUsername =
    createdBy.username != null
      ? assertNonEmptyString(String(createdBy.username), 'createdBy.username')
      : '';

  if (!createdByUserId || !createdByUsername) {
    throw makeError('createdBy is required', 401);
  }

  const ok = await targetExists(db, tType, tId);
  if (!ok) throw makeError('Target not found', 404);

  const col = await reportsCollection(db);
  const now = new Date();

  // Very low collision probability; simple retry on unique index violation.
  for (let i = 0; i < 3; i++) {
    const doc = {
      reportId: newReportId(),
      targetType: tType,
      targetId: tId,
      text: tText,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      createdBy: { userId: createdByUserId, username: createdByUsername }
    };

    try {
      const ins = await col.insertOne(doc);
      if (!ins.acknowledged) throw makeError('Could not create report', 500);
      // doc does not include _id, which is fine for API responses
      return doc;
    } catch (e) {
      if (e?.code === 11000 && i < 2) continue;
      throw e;
    }
  }

  throw makeError('Could not generate unique report id', 500);
}

export async function getReportByReportId(reportId) {
  const id = normalizeReportId(reportId);
  const col = await reportsCollection();
  const doc = await col.findOne({ reportId: id });
  if (!doc) throw makeError('Report not found', 404);
  return sanitizeReport(doc);
}

export async function getReportsByUser(userId, options = {}) {
  const uid = normalizeUserId(userId);
  const limit = normalizeLimit(options.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const includeHidden = options.includeHidden !== false; // default true

  const col = await reportsCollection();

  const query = { 'createdBy.userId': uid };
  if (!includeHidden) query.status = { $ne: 'hidden' };

  const docs = await col
    .find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .toArray();

  return docs.map(sanitizeReport);
}

export async function getReportsForTarget(targetType, targetId, options = {}) {
  const tType = normalizeTargetType(targetType);
  const tId = normalizeTargetId(targetId);
  const limit = normalizeLimit(options.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const includeHidden = options.includeHidden === true; // default false

  const col = await reportsCollection();

  const query = { targetType: tType, targetId: tId };
  if (!includeHidden) query.status = { $ne: 'hidden' };

  const docs = await col
    .find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .toArray();

  return docs.map(sanitizeReport);
}

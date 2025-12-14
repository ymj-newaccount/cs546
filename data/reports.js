// data/reports.js
import { getDb } from '../config/mongoConnection.js';
import { randomBytes } from 'crypto';
import { ObjectId } from 'mongodb';

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

// Note: This accepts either a custom reportId (e.g., "R...") or a MongoDB _id string.
// Callers decide how to interpret it.
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

function toSafeInt(v, def = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.trunc(n);
}

function toSafeNumber(v, def = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return n;
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

//helper for optional images
function normalizeImage(image)
{
  if(image == null)
  {
    return null;
  }
  if(typeof image !== "object")
  {
    throw makeError("image must be an object", 400);
  }

  let url = "";
  if(typeof image.url === "string")
  {
    url = image.url.trim();
  }
  if(!url)
  {
    return null;
  }
  let filename = "";
  if(typeof image.filename === "string")
  {
    filename = image.filename.trim();
  }
  let mimetype = "";
  if(typeof image.mimetype === "string")
  {
    mimetype = image.mimetype.trim();
  }
  let size = 0;
  if(typeof image.size === "number")
  {
    size = image. size;
  }

  //url checks
  if(url.length > 2000)
  {
    throw makeError("image.url is too long", 400);
  }
  if(filename.length > 500)
  {
    throw makeError("image.filename is too long", 400);
  }
  if(mimetype.length > 200)
  {
    throw makeError("image.mimetype is too long", 400);
  }
  if(!Number.isFinite(size) || size < 0)
  {
    throw makeError("image.size is invalid", 400);
  }

  return { url, filename, mimetype, size};
}

// MongoDB Node Driver compatibility:
// - Older drivers return { value: <doc>, ... } (ModifyResult)
// - Newer drivers (v6/v7) default to returning <doc> directly when includeResultMetadata is false
function unwrapFindOneAndUpdateResult(res) {
  if (!res) return null;

  const isModifyResult =
    typeof res === 'object' &&
    res !== null &&
    Object.prototype.hasOwnProperty.call(res, 'value') &&
    Object.prototype.hasOwnProperty.call(res, 'lastErrorObject');

  return isModifyResult ? (res.value ?? null) : res;
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

export async function createReport({ targetType, targetId, text, createdBy, image}) {
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
 
  const safeImage = normalizeImage(image);

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
      createdBy: { userId: createdByUserId, username: createdByUsername },
      votes: {
        upVote: 0,
        downVote: 0,
        voteCount: 0,
        // Primary score is reputation-weighted. rawScore is the unweighted score.
        score: 0,
        rawScore: 0,
        weightedScore: 0,
        upWeight: 0,
        downWeight: 0
      }
    };
    if(safeImage)
    {
      doc.image = safeImage;
    }

    try {
      const ins = await col.insertOne(doc);
      if (!ins.acknowledged) throw makeError('Could not create report', 500);
      // doc does not include _id, which is fine for API responses
      return sanitizeReport(doc);
    } catch (e) {
      if (e?.code === 11000 && i < 2) continue;
      throw e;
    }
  }

  throw makeError('Could not generate unique report id', 500);
}

// Fetch by custom reportId; also supports MongoDB _id as a fallback for robustness.
export async function getReportByReportId(reportId) {
  const id = normalizeReportId(reportId);
  const col = await reportsCollection();

  let doc = await col.findOne({ reportId: id });

  // Fallback: allow lookup by MongoDB _id if caller provided a 24-hex string.
  if (!doc && ObjectId.isValid(id)) {
    doc = await col.findOne({ _id: new ObjectId(id) });
  }

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

// Updates total votes on a report (stores both weighted and raw totals).
// Accepts either a custom reportId or a MongoDB _id string for robustness.
export async function updateReportVotes(reportIdOrMongoId, total = {}) {
  const id = normalizeReportId(reportIdOrMongoId);
  const col = await reportsCollection();
  const now = new Date();

  const upVote = Math.max(0, toSafeInt(total.upVotes, 0));
  const downVote = Math.max(0, toSafeInt(total.downVotes, 0));

  const rawScore = toSafeInt(total.rawScore ?? total.score, upVote - downVote);
  const voteCount = Math.max(0, toSafeInt(total.voteCount, upVote + downVote));

  const upWeight = Math.max(0, toSafeNumber(total.uWeight, 0));
  const downWeight = Math.max(0, toSafeNumber(total.dWeight, 0));

  let weightedScore = toSafeNumber(total.weightedScore, upWeight - downWeight);
  if (!Number.isFinite(weightedScore)) weightedScore = 0;

  const update = {
    $set: {
      'votes.upVote': upVote,
      'votes.downVote': downVote,
      'votes.voteCount': voteCount,

      // Primary score: reputation-weighted score.
      'votes.score': weightedScore,

      // Additional stored totals for debugging / alternate UI.
      'votes.rawScore': rawScore,
      'votes.weightedScore': weightedScore,
      'votes.upWeight': upWeight,
      'votes.downWeight': downWeight,

      updatedAt: now
    }
  };

  // 1) Try update by custom reportId
  const res1 = await col.findOneAndUpdate(
    { reportId: id },
    update,
    { returnDocument: 'after' }
  );
  let doc = unwrapFindOneAndUpdateResult(res1);

  // 2) Fallback update by MongoDB _id if the input looks like an ObjectId
  if (!doc && ObjectId.isValid(id)) {
    const res2 = await col.findOneAndUpdate(
      { _id: new ObjectId(id) },
      update,
      { returnDocument: 'after' }
    );
    doc = unwrapFindOneAndUpdateResult(res2);
  }

  if (!doc) {
    throw makeError('Report not found', 404);
  }

  return sanitizeReport(doc);
}

//Update Duplicate flags function
/**
 * Update stored duplicate-flag aggregates on a report.
 * Accepts either a custom reportId or a MongoDB _id string for robustness.
 */
export async function updateReportDuplicateFlags(reportIdOrMongoId, totals = {}) {
  const id = normalizeReportId(reportIdOrMongoId);
  const col = await reportsCollection();
  const now = new Date();

  const flagCount = Math.max(0, toSafeInt(totals.flagCount, 0));
  const weightTotal = Math.max(0, toSafeNumber(totals.weightTotal, 0));

  const topCandidateReportId = String(totals.topCandidateReportId ?? '').trim();
  const topCandidateCount = Math.max(0, toSafeInt(totals.topCandidateCount, 0));
  const topCandidateWeight = Math.max(0, toSafeNumber(totals.topCandidateWeight, 0));

  const update = {
    $set: {
      'duplicateFlags.flagCount': flagCount,
      'duplicateFlags.weightTotal': weightTotal,
      'duplicateFlags.topCandidateReportId': topCandidateReportId,
      'duplicateFlags.topCandidateCount': topCandidateCount,
      'duplicateFlags.topCandidateWeight': topCandidateWeight,
      updatedAt: now
    }
  };

  // 1) Try update by custom reportId
  const res1 = await col.findOneAndUpdate({ reportId: id }, update, { returnDocument: 'after' });
  let doc = unwrapFindOneAndUpdateResult(res1);

  // 2) Fallback update by MongoDB _id if the input looks like an ObjectId
  if (!doc && ObjectId.isValid(id)) {
    const res2 = await col.findOneAndUpdate({ _id: new ObjectId(id) }, update, {
      returnDocument: 'after'
    });
    doc = unwrapFindOneAndUpdateResult(res2);
  }

  if (!doc) {
    throw makeError('Report not found', 404);
  }

  return sanitizeReport(doc);
}
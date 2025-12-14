// data/duplicateFlags.js
// Duplicate-flagging data-access layer (MongoDB).
//
// Semantics:
// - A user may flag a report as a duplicate at most once per (reportId, userId) pair.
// - A flag may include an optional canonicalReportId (the "canonical" report).
// - Each flag stores a snapshot weight based on the user's reputation at the time of FIRST flagging.
// - Aggregates return raw counts and reputation-weighted totals.
//
// IMPORTANT KEYING RULE:
// - We ALWAYS store duplicate_flags.reportId as the application's stable custom reportId (e.g., "R...").
// - Callers may pass a MongoDB _id; reports.getReportByReportId() supports _id fallback.
// - All public functions in this module accept either custom reportId ("R...") or Mongo _id, and
//   will canonicalize to the stable custom reportId before reading/writing duplicate_flags.
//
// Canonical update rule (prevents accidental data loss):
// - If canonicalReportId is NOT provided in the params object, we DO NOT modify the stored canonicalReportId.
// - If canonicalReportId IS provided as an empty string (or whitespace), we CLEAR the stored canonicalReportId.
// - If canonicalReportId IS provided as a non-empty value, we validate/resolve it and store its stable reportId.

import { getDb } from '../config/mongoConnection.js';
import { getUserById } from './users.js';
import { getReportByReportId } from './reports.js';

const MAX_USER_ID_LEN = 200;
const MAX_REPORT_ID_LEN = 200;

const DEFAULT_WEIGHT = 1; // minimum weight so flags always have effect
const MAX_CANDIDATES = 5;

let _indexesReady = null;

// ---------------------------
// Helpers: errors + validation
// ---------------------------

function makeError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string') throw makeError(`${name} must be a string`, 400);
  const v = value.trim();
  if (!v) throw makeError(`${name} cannot be empty`, 400);
  return v;
}

function assertMaxLen(value, max, name) {
  if (value.length > max) throw makeError(`${name} is too long (max ${max})`, 400);
  return value;
}

function normalizeReportId(reportId) {
  const r = assertNonEmptyString(String(reportId ?? ''), 'reportId');
  return assertMaxLen(r, MAX_REPORT_ID_LEN, 'reportId');
}

function normalizeUserId(userId) {
  const u = assertNonEmptyString(String(userId ?? ''), 'userId');
  return assertMaxLen(u, MAX_USER_ID_LEN, 'userId');
}

// Returns:
// - undefined  => canonicalReportId not provided by caller
// - ''         => caller explicitly provided "empty" (meaning "clear canonical")
// - '...value' => caller provided a non-empty canonical id-like value
function normalizeOptionalCanonicalReportId(canonicalReportId) {
  if (canonicalReportId === undefined) return undefined;
  const raw = String(canonicalReportId ?? '').trim();
  if (!raw) return '';
  return assertMaxLen(raw, MAX_REPORT_ID_LEN, 'canonicalReportId');
}

function toFiniteNumber(value, def = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : def;
}

// ---------------------------
// Collection + indexes
// ---------------------------

async function duplicateFlagsCollection(dbParam) {
  const db = dbParam || (await getDb());
  const col = db.collection('duplicate_flags');

  // Create indexes once per process; reset if creation fails so later calls can retry.
  if (!_indexesReady) {
    _indexesReady = (async () => {
      // One duplicate-flag per user per report
      await col.createIndex({ reportId: 1, userId: 1 }, { unique: true });

      // Helpful secondary indexes
      await col.createIndex({ reportId: 1, createdAt: -1 });
      await col.createIndex({ canonicalReportId: 1, createdAt: -1 });
      await col.createIndex({ reportId: 1, canonicalReportId: 1, createdAt: -1 });
      await col.createIndex({ userId: 1, createdAt: -1 });
    })().catch((err) => {
      _indexesReady = null;
      throw err;
    });
  }

  await _indexesReady;
  return col;
}

// ---------------------------
// Business helpers
// ---------------------------

// Weight is a snapshot of user's reputation at first flag time.
// Keep minimum weight at DEFAULT_WEIGHT so flags always have effect.
async function getWeightForUser(userId) {
  const user = await getUserById(userId); // throws if userId invalid or user missing
  const rep = toFiniteNumber(user?.reputation, DEFAULT_WEIGHT);
  return Math.max(DEFAULT_WEIGHT, rep);
}

// Ensure the two reports refer to the same target (station/elevator/aps/ramp + id).
function sameTarget(a, b) {
  return (
    String(a?.targetType || '') === String(b?.targetType || '') &&
    String(a?.targetId || '') === String(b?.targetId || '')
  );
}

// Resolve an input (custom reportId OR Mongo _id) into the stable custom reportId.
async function resolveStableReportId(reportIdLike) {
  const input = normalizeReportId(reportIdLike);
  const report = await getReportByReportId(input); // supports _id fallback
  const stableId = String(report?.reportId || '').trim();
  if (!stableId) throw makeError('Report record is missing reportId', 500);
  assertMaxLen(stableId, MAX_REPORT_ID_LEN, 'reportId');
  return { report, stableId };
}

// Canonicalize report identifiers: accept "R..." or Mongo _id.
// NOTE: By default we do not re-check existence if the input already looks like a stable custom reportId.
// You can force validation by passing { validate: true }.
async function canonicalizeReportId(reportIdLike, { validate = false } = {}) {
  const raw = normalizeReportId(reportIdLike);

  const looksStableCustom = raw.startsWith('R'); // your app's stable reportId format
  if (looksStableCustom && !validate) return raw;

  const { stableId } = await resolveStableReportId(raw);
  return stableId;
}

// ---------------------------
// Public API
// ---------------------------

/**
 * Create or update a duplicate flag (upsert).
 *
 * Params object:
 *   - reportId (required): custom reportId ("R...") OR Mongo _id string
 *   - userId (required): user id string
 *   - canonicalReportId (optional):
 *       - omitted => do NOT modify stored canonicalReportId
 *       - empty/whitespace => clear stored canonicalReportId
 *       - non-empty => must exist, not equal base report, and share same target
 *
 * Notes:
 * - reportId is resolved to the stable custom reportId before writing to duplicate_flags.
 * - weight is captured ONLY on first insert (snapshot) and never changes afterward.
 * - If the flag already exists, we avoid re-reading the user's reputation.
 */
export async function flagDuplicate(params = {}) {
  if (params === null || typeof params !== 'object') {
    throw makeError('params must be an object', 400);
  }

  const uID = normalizeUserId(params.userId);

  // Resolve the base report and its stable custom reportId (prevents key drift).
  const { report: baseReport, stableId: rID } = await resolveStableReportId(params.reportId);

  // Detect whether the caller explicitly provided canonicalReportId.
  const canonicalProvided = hasOwn(params, 'canonicalReportId');
  const canonicalNormalized = canonicalProvided
    ? normalizeOptionalCanonicalReportId(params.canonicalReportId)
    : undefined;

  // Resolve/validate canonical report if explicitly provided and non-empty.
  let canonicalStableId = '';
  if (canonicalProvided) {
    // canonicalNormalized is either '' (clear) or a non-empty string (validate) or undefined (rare)
    const cInput = canonicalNormalized ?? '';

    if (cInput) {
      const { report: canonicalReport, stableId } = await resolveStableReportId(cInput);
      canonicalStableId = stableId;

      if (canonicalStableId === rID) {
        throw makeError('canonicalReportId cannot equal reportId', 400);
      }
      if (!sameTarget(baseReport, canonicalReport)) {
        throw makeError('canonicalReportId must reference a report on the same target', 400);
      }
    } else {
      // Explicitly clear canonical
      canonicalStableId = '';
    }
  }

  const now = new Date();
  const col = await duplicateFlagsCollection();

  // Check existence first to avoid unnecessary user reputation reads on updates.
  const existing = await col.findOne(
    { reportId: rID, userId: uID },
    { projection: { canonicalReportId: 1 } }
  );

  // Build the update: always update updatedAt; only touch canonicalReportId if caller provided it.
  const setDoc = { updatedAt: now };
  if (canonicalProvided) {
    setDoc.canonicalReportId = canonicalStableId;
  }

  if (existing) {
    await col.updateOne({ reportId: rID, userId: uID }, { $set: setDoc });

    // If canonical wasn't provided, keep the existing canonicalStableId for a truthful return payload.
    if (!canonicalProvided) {
      canonicalStableId = String(existing.canonicalReportId || '').trim();
    }
  } else {
    // Snapshot weight on FIRST insert only.
    const weight = await getWeightForUser(uID);

    await col.updateOne(
      { reportId: rID, userId: uID },
      {
        $set: setDoc,
        $setOnInsert: {
          reportId: rID,
          userId: uID,
          weight, // snapshot at first insert only
          createdAt: now
        }
      },
      { upsert: true }
    );
  }

  return {
    reportId: rID,
    userId: uID,
    canonicalReportId: canonicalStableId
  };
}

/**
 * Remove a duplicate flag (idempotent).
 *
 * Accepts either custom reportId ("R...") or Mongo _id.
 * Options:
 *   - validateReport (default false): if true, verifies the report exists even for "R..." inputs.
 */
export async function removeDuplicateFlag(reportId, userId, options = {}) {
  const validateReport = options?.validateReport === true;

  const rID = await canonicalizeReportId(reportId, { validate: validateReport });
  const uID = normalizeUserId(userId);

  const col = await duplicateFlagsCollection();
  await col.deleteOne({ reportId: rID, userId: uID });

  return true;
}

/**
 * Get aggregate totals for a report.
 *
 * Returns:
 *   - flagCount: number of flags
 *   - weightTotal: sum of weights
 *   - topCandidateReportId / topCandidateCount / topCandidateWeight
 *   - candidates: up to MAX_CANDIDATES canonical candidates (ranked by weight desc, then count desc, then id asc)
 *
 * Accepts either custom reportId ("R...") or Mongo _id.
 * Options:
 *   - validateReport (default false): if true, verifies the report exists even for "R..." inputs.
 */
export async function getDuplicateTotals(reportId, options = {}) {
  const validateReport = options?.validateReport === true;

  const rID = await canonicalizeReportId(reportId, { validate: validateReport });
  const col = await duplicateFlagsCollection();

  // Use MongoDB aggregation to avoid loading all flags into application memory.
  const pipeline = [
    { $match: { reportId: rID } },
    {
      $project: {
        canonicalReportId: 1,
        weight: { $ifNull: ['$weight', DEFAULT_WEIGHT] }
      }
    },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              flagCount: { $sum: 1 },
              weightTotal: { $sum: '$weight' }
            }
          }
        ],
        candidates: [
          { $match: { canonicalReportId: { $type: 'string', $ne: '' } } },
          {
            $group: {
              _id: '$canonicalReportId',
              count: { $sum: 1 },
              weight: { $sum: '$weight' }
            }
          },
          { $sort: { weight: -1, count: -1, _id: 1 } },
          { $limit: MAX_CANDIDATES },
          {
            $project: {
              _id: 0,
              canonicalReportId: '$_id',
              count: 1,
              weight: 1
            }
          }
        ]
      }
    }
  ];

  const agg = await col.aggregate(pipeline).toArray();
  const res = agg[0] || {};

  const totalsDoc = (res.totals && res.totals[0]) || { flagCount: 0, weightTotal: 0 };
  const candidates = Array.isArray(res.candidates) ? res.candidates : [];

  const top = candidates[0] || null;

  return {
    flagCount: Number(totalsDoc.flagCount || 0),
    weightTotal: Number(totalsDoc.weightTotal || 0),

    topCandidateReportId: top ? String(top.canonicalReportId || '') : '',
    topCandidateCount: top ? Number(top.count || 0) : 0,
    topCandidateWeight: top ? Number(top.weight || 0) : 0,

    candidates
  };
}

/**
 * Get the current user's duplicate-flag state for a report.
 *
 * Returns:
 *   - flagged: boolean
 *   - canonicalReportId: string
 *
 * Accepts either custom reportId ("R...") or Mongo _id.
 * Options:
 *   - validateReport (default false): if true, verifies the report exists even for "R..." inputs.
 */
export async function getUserDuplicateFlag(reportId, userId, options = {}) {
  const validateReport = options?.validateReport === true;

  const rID = await canonicalizeReportId(reportId, { validate: validateReport });
  const uID = normalizeUserId(userId);

  const col = await duplicateFlagsCollection();
  const doc = await col.findOne(
    { reportId: rID, userId: uID },
    { projection: { canonicalReportId: 1 } }
  );

  if (!doc) {
    return { flagged: false, canonicalReportId: '' };
  }

  return {
    flagged: true,
    canonicalReportId: String(doc.canonicalReportId || '').trim()
  };
}
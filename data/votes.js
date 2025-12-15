// data/votes.js
// Vote data-access layer (MongoDB).
// - One vote per (reportId, userId)
// - Stores a snapshot weight from user's current reputation at vote time
// - Returns both raw and reputation-weighted aggregates

import { getDb } from '../config/mongoConnection.js';
import { getUserById } from './users.js';

const MAX_USER_ID_LEN = 200;
const MAX_REPORT_ID_LEN = 200;

const DEFAULT_WEIGHT = 1; // minimum vote weight
let _indexesReady = null;

// ---------------------------
// Helpers
// ---------------------------

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

function assertMaxLen(s, max, name) {
  if (s.length > max) throw makeError(`${name} is too long (max ${max})`, 400);
  return s;
}

function normalizeReportId(reportId) {
  const r = assertNonEmptyString(String(reportId ?? ''), 'reportId');
  return assertMaxLen(r, MAX_REPORT_ID_LEN, 'reportId');
}

function normalizeUserId(userId) {
  const u = assertNonEmptyString(String(userId ?? ''), 'userId');
  return assertMaxLen(u, MAX_USER_ID_LEN, 'userId');
}

function normalizeVote(vote) {
  const v = Number(vote);
  if (v !== 1 && v !== -1) throw makeError('vote must be 1 or -1', 400);
  return v;
}

function toFiniteNumber(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// ---------------------------
// Collection + indexes
// ---------------------------

async function votesCollection(dbParam) {
  const db = dbParam || (await getDb());
  const col = db.collection('votes');

  // Create indexes once per process; reset if creation fails so later calls can retry.
  if (!_indexesReady) {
    _indexesReady = (async () => {
      // One vote per user per report
      await col.createIndex({ reportId: 1, userId: 1 }, { unique: true });

      // Fast lookups for aggregation / listing
      await col.createIndex({ reportId: 1, createdAt: -1 });
      await col.createIndex({ userId: 1, createdAt: -1 });
    })().catch((err) => {
      _indexesReady = null;
      throw err;
    });
  }

  await _indexesReady;
  return col;
}

// Weight is a snapshot of user's reputation at vote time.
// Keep minimum weight at DEFAULT_WEIGHT so votes always have effect.
async function getVoteWeightForUser(userId) {
  const user = await getUserById(userId); // will throw if userId invalid or user missing
  const rep = toFiniteNumber(user?.reputation, DEFAULT_WEIGHT);
  return Math.max(DEFAULT_WEIGHT, rep);
}

// ---------------------------
// Public API
// ---------------------------

// Create or update a vote on a report (upsert).
// Params: { reportId, userId, vote }
export async function castVote({ reportId, userId, vote }) {
  const rID = normalizeReportId(reportId);
  const uID = normalizeUserId(userId);
  const v = normalizeVote(vote);

  const votes = await votesCollection();
  const now = new Date();

  const weight = await getVoteWeightForUser(uID);

  await votes.updateOne(
    { reportId: rID, userId: uID },
    {
      $set: {
        vote: v,
        weight,
        updatedAt: now
      },
      $setOnInsert: {
        reportId: rID,
        userId: uID,
        createdAt: now
      }
    },
    { upsert: true }
  );

  return { reportId: rID, userId: uID, vote: v, weight };
}

// Remove a vote (idempotent).
export async function removeVote(reportId, userId) {
  const rID = normalizeReportId(reportId);
  const uID = normalizeUserId(userId);

  const votes = await votesCollection();
  await votes.deleteOne({ reportId: rID, userId: uID });

  return true;
}

// Get aggregate totals for a report.
// Returns BOTH raw and weighted totals.
// - score/rawScore: upVotes - downVotes (unweighted)
// - weightedScore: sum(upVote weights) - sum(downVote weights)
export async function getTotalVotes(reportId) {
  const rID = normalizeReportId(reportId);
  const votes = await votesCollection();

  const docs = await votes
    .find({ reportId: rID }, { projection: { vote: 1, weight: 1 } })
    .toArray();

  let upVotes = 0;
  let downVotes = 0;
  let uWeight = 0;
  let dWeight = 0;

  for (const doc of docs) {
    const v = Number(doc?.vote);
    const w = toFiniteNumber(doc?.weight, DEFAULT_WEIGHT);

    if (v === 1) {
      upVotes += 1;
      uWeight += w;
    } else if (v === -1) {
      downVotes += 1;
      dWeight += w;
    }
  }

  const rawScore = upVotes - downVotes;
  const weightedScore = uWeight - dWeight;

  return {
    upVotes,
    downVotes,
    voteCount: upVotes + downVotes,

    // Unweighted score (legacy)
    score: rawScore,
    rawScore,

    // Reputation-weighted totals
    uWeight,
    dWeight,
    weightedScore
  };
}

// Get the current user's vote for a report.
// Returns: 1, -1, or 0
export async function getUserVoteForReport(reportId, userId) {
  const rID = normalizeReportId(reportId);
  const uID = normalizeUserId(userId);

  const votes = await votesCollection();
  const doc = await votes.findOne(
    { reportId: rID, userId: uID },
    { projection: { vote: 1 } }
  );

  if (!doc) return 0;

  const v = Number(doc.vote);
  if (v === 1) return 1;
  if (v === -1) return -1;
  return 0;
}

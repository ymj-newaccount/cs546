// routes/reports.js
import express from 'express';

import { requireCsrf } from './auth.js';
import {
  createReport,
  getReportByReportId,
  updateReportVotes,
  updateReportDuplicateFlags
} from '../data/reports.js';

import {
  castVote,
  removeVote,
  getTotalVotes,
  getUserVoteForReport
} from '../data/votes.js';

import { adjustReputation } from '../data/users.js';

import {
  flagDuplicate,
  removeDuplicateFlag,
  getDuplicateTotals,
  getUserDuplicateFlag
} from '../data/duplicateFlags.js';

const router = express.Router();

// Reputation tuning (best-effort updates; failures must not break core flows)
const REP_MAX = 100;
const REP_DELTA_ON_REPORT_CREATE = 0.1;
const REP_DELTA_PER_UPVOTE = 0.05; // applied to report author
const REP_DELTA_PER_DOWNVOTE = -0.05; // applied to report author

function makeError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function ensureLoggedIn(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'You must be logged in.' });
}

/**
 * Normalize vote totals for consistent API semantics:
 * - totals.score is the reputation-weighted score (primary score)
 * - totals.rawScore is the unweighted score
 */
function normalizeTotals(totals) {
  const t = totals && typeof totals === 'object' ? totals : {};

  const upVotes = Math.max(
    0,
    Number.isFinite(Number(t.upVotes)) ? Math.trunc(Number(t.upVotes)) : 0
  );

  const downVotes = Math.max(
    0,
    Number.isFinite(Number(t.downVotes)) ? Math.trunc(Number(t.downVotes)) : 0
  );

  const rawScore = Number.isFinite(Number(t.rawScore))
    ? Math.trunc(Number(t.rawScore))
    : Number.isFinite(Number(t.score))
      ? Math.trunc(Number(t.score))
      : upVotes - downVotes;

  const uWeight = Number.isFinite(Number(t.uWeight)) ? Number(t.uWeight) : 0;
  const dWeight = Number.isFinite(Number(t.dWeight)) ? Number(t.dWeight) : 0;

  const weightedScore = Number.isFinite(Number(t.weightedScore))
    ? Number(t.weightedScore)
    : uWeight - dWeight;

  const voteCount = Math.max(
    0,
    Number.isFinite(Number(t.voteCount)) ? Math.trunc(Number(t.voteCount)) : upVotes + downVotes
  );

  return {
    upVotes,
    downVotes,
    voteCount,
    rawScore,
    weightedScore,
    score: weightedScore, // primary score = weighted
    uWeight,
    dWeight
  };
}

/**
 * Normalize duplicate totals for consistent API semantics.
 */
function normalizeDuplicateTotals(totals) {
  const t = totals && typeof totals === 'object' ? totals : {};

  const flagCount = Math.max(
    0,
    Number.isFinite(Number(t.flagCount)) ? Math.trunc(Number(t.flagCount)) : 0
  );

  const weightTotalRaw = Number.isFinite(Number(t.weightTotal)) ? Number(t.weightTotal) : 0;
  const weightTotal = Math.max(0, weightTotalRaw);

  const topCandidateReportId =
    typeof t.topCandidateReportId === 'string' ? t.topCandidateReportId : '';

  const topCandidateCount = Math.max(
    0,
    Number.isFinite(Number(t.topCandidateCount)) ? Math.trunc(Number(t.topCandidateCount)) : 0
  );

  const topCandidateWeightRaw = Number.isFinite(Number(t.topCandidateWeight))
    ? Number(t.topCandidateWeight)
    : 0;

  const topCandidateWeight = Math.max(0, topCandidateWeightRaw);

  const candidates = Array.isArray(t.candidates) ? t.candidates : [];

  return {
    flagCount,
    weightTotal,
    topCandidateReportId,
    topCandidateCount,
    topCandidateWeight,
    candidates
  };
}

function normalizeVoteInput(v) {
  const n = Number(v);
  if (n === 1 || n === -1) return n;
  return null;
}

function voteToRepDelta(vote) {
  if (vote === 1) return REP_DELTA_PER_UPVOTE;
  if (vote === -1) return REP_DELTA_PER_DOWNVOTE;
  return 0;
}

async function bestEffortAdjustReputation(userId, delta, req) {
  if (!userId) return;
  if (!Number.isFinite(Number(delta)) || Number(delta) === 0) return;

  try {
    const updated = await adjustReputation(String(userId), Number(delta), { max: REP_MAX });

    // Keep session user in sync if it is the same user and session object exists
    if (req?.session?.user && String(req.session.user._id) === String(updated?._id)) {
      req.session.user.reputation = updated.reputation;
    }
  } catch (_) {
    // Best-effort only; do not block the main request
  }
}

/**
 * Resolve a report reference from a route param that might be either:
 * - custom reportId (e.g., "R...")
 * - MongoDB _id (24-hex)
 *
 * Returns:
 *   { report, rid }
 * where rid is ALWAYS the canonical report.reportId string.
 */
async function resolveReportParam(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw makeError('reportId is required', 400);

  try {
    const report = await getReportByReportId(raw); // 依赖 data 层支持 reportId / _id
    const rid = String(report?.reportId || '').trim();
    if (!rid) throw makeError('Report record is missing reportId field.', 500);
    return { report, rid };
  } catch (err) {
    if (err?.status === 404) throw makeError('Report not found', 404);
    throw err;
  }
}

// ---------------------------
// Routes
// ---------------------------

/**
 * Create a report.
 * Returns the created report document.
 */
router.post('/', ensureLoggedIn, requireCsrf, async (req, res, next) => {
  try {
    const { targetType, targetId, text } = req.body || {};
    const createdBy = {
      userId: String(req.session.user._id),
      username: String(req.session.user.username)
    };

    const report = await createReport({ targetType, targetId, text, createdBy });

    // Reward contribution (best-effort)
    await bestEffortAdjustReputation(createdBy.userId, REP_DELTA_ON_REPORT_CREATE, req);

    return res.status(201).json({ report });
  } catch (err) {
    return next(err);
  }
});

/**
 * Get vote totals and the current user's vote (if logged in).
 */
router.get('/:reportId/votes', async (req, res, next) => {
  try {
    const { rid } = await resolveReportParam(req.params.reportId);

    const totals = normalizeTotals(await getTotalVotes(rid));

    let myVote = 0;
    if (req.session?.user?._id) {
      myVote = await getUserVoteForReport(rid, String(req.session.user._id));
    }

    return res.json({ reportId: rid, totals, myVote });
  } catch (err) {
    return next(err);
  }
});

/**
 * Cast/replace a vote on a report.
 * Body: { vote: 1 | -1 }
 */
router.post('/:reportId/vote', ensureLoggedIn, requireCsrf, async (req, res, next) => {
  try {
    const { report, rid } = await resolveReportParam(req.params.reportId);

    const vote = normalizeVoteInput(req.body?.vote);
    if (vote === null) {
      return res.status(400).json({ error: 'vote must be 1 or -1' });
    }

    const userId = String(req.session.user._id);

    // Capture prior vote to adjust author reputation by the delta
    const prevVote = await getUserVoteForReport(rid, userId);

    // Cast/replace vote keyed by canonical reportId
    await castVote({ reportId: rid, userId, vote });

    const totals = normalizeTotals(await getTotalVotes(rid));
    await updateReportVotes(rid, totals);

    // Best-effort: adjust report author's reputation (avoid self-adjust)
    const authorId = report?.createdBy?.userId ? String(report.createdBy.userId) : '';
    if (authorId && authorId !== userId) {
      const delta = voteToRepDelta(vote) - voteToRepDelta(prevVote);
      await bestEffortAdjustReputation(authorId, delta, req);
    }

    const myVote = await getUserVoteForReport(rid, userId);
    return res.json({ reportId: rid, totals, myVote });
  } catch (err) {
    return next(err);
  }
});

/**
 * Remove the current user's vote on a report (idempotent).
 */
router.delete('/:reportId/vote', ensureLoggedIn, requireCsrf, async (req, res, next) => {
  try {
    const { report, rid } = await resolveReportParam(req.params.reportId);

    const userId = String(req.session.user._id);

    // Capture prior vote before removal
    const prevVote = await getUserVoteForReport(rid, userId);

    // Remove vote keyed by canonical reportId
    await removeVote(rid, userId);

    const totals = normalizeTotals(await getTotalVotes(rid));
    await updateReportVotes(rid, totals);

    // Best-effort: reverse author reputation effect (avoid self-adjust)
    const authorId = report?.createdBy?.userId ? String(report.createdBy.userId) : '';
    if (authorId && authorId !== userId) {
      const delta = 0 - voteToRepDelta(prevVote);
      await bestEffortAdjustReputation(authorId, delta, req);
    }

    const myVote = await getUserVoteForReport(rid, userId);
    return res.json({ reportId: rid, totals, myVote });
  } catch (err) {
    return next(err);
  }
});

/**
 * Get duplicate-flag totals and the current user's flag state (if logged in).
 *
 * Response:
 *   { reportId, totals, myFlag: { flagged, canonicalReportId } }
 */
router.get('/:reportId/duplicate', async (req, res, next) => {
  try {
    const { rid } = await resolveReportParam(req.params.reportId);

    const totals = normalizeDuplicateTotals(await getDuplicateTotals(rid));

    let myFlag = { flagged: false, canonicalReportId: '' };
    if (req.session?.user?._id) {
      myFlag = await getUserDuplicateFlag(rid, String(req.session.user._id));
    }

    return res.json({ reportId: rid, totals, myFlag });
  } catch (err) {
    return next(err);
  }
});

/**
 * Create/update a duplicate flag (upsert).
 *
 * IMPORTANT: canonicalReportId is tri-state:
 * - If the field is OMITTED from the request body, the stored canonicalReportId is NOT modified.
 * - If provided as empty string/whitespace, the stored canonicalReportId is CLEARED.
 * - If provided as a non-empty value, it is validated and stored.
 *
 * Body:
 *   { canonicalReportId?: string }
 */
router.post('/:reportId/duplicate', ensureLoggedIn, requireCsrf, async (req, res, next) => {
  try {
    const { rid } = await resolveReportParam(req.params.reportId);
    const userId = String(req.session.user._id);

    // Preserve tri-state semantics: only pass canonicalReportId if the client actually sent it.
    const payload = { reportId: rid, userId };
    if (hasOwn(req.body || {}, 'canonicalReportId')) {
      payload.canonicalReportId = String(req.body.canonicalReportId ?? '');
    }

    await flagDuplicate(payload);

    const totals = normalizeDuplicateTotals(await getDuplicateTotals(rid));
    await updateReportDuplicateFlags(rid, totals);

    const myFlag = await getUserDuplicateFlag(rid, userId);
    return res.json({ reportId: rid, totals, myFlag });
  } catch (err) {
    return next(err);
  }
});

/**
 * Remove the current user's duplicate flag (idempotent).
 */
router.delete('/:reportId/duplicate', ensureLoggedIn, requireCsrf, async (req, res, next) => {
  try {
    const { rid } = await resolveReportParam(req.params.reportId);
    const userId = String(req.session.user._id);

    await removeDuplicateFlag(rid, userId);

    const totals = normalizeDuplicateTotals(await getDuplicateTotals(rid));
    await updateReportDuplicateFlags(rid, totals);

    const myFlag = await getUserDuplicateFlag(rid, userId);
    return res.json({ reportId: rid, totals, myFlag });
  } catch (err) {
    return next(err);
  }
});

export default router;

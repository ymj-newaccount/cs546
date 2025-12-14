// data/reportsAdmin.js
// Admin-side helpers for working with the "reports" collection.
//
// Responsibilities:
// - List recent reports for the admin dashboard
// - Hide / unhide / delete reports
// - Merge duplicate reports (vote migration + metadata + cached totals refresh)

import { getDb } from '../config/mongoConnection.js';
import { getTotalVotes } from './votes.js';
import { updateReportVotes } from './reports.js';

function makeError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeLimit(limit, def = 20, max = 100) {
  const n = Number(limit);
  if (!Number.isInteger(n) || n <= 0) return def;
  return Math.min(n, max);
}

function normalizeReportId(reportId) {
  if (typeof reportId !== 'string') {
    throw makeError('reportId must be a string', 400);
  }
  const id = reportId.trim();
  if (!id) {
    throw makeError('reportId cannot be empty', 400);
  }
  if (id.length > 200) {
    throw makeError('reportId is too long', 400);
  }
  return id;
}

function toDateSafe(v) {
  // Convert unknown values to a Date, defaulting to epoch if invalid.
  if (!v) return new Date(0);
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

/**
 * Fetch the most recent reports for the admin dashboard.
 * We sort by createdAt (if present) and _id as a fallback.
 */
export async function getRecentReports(limit = 20) {
  const db = await getDb();
  const safeLimit = normalizeLimit(limit);

  return db
    .collection('reports')
    .find({})
    .sort({ createdAt: -1, _id: -1 })
    .limit(safeLimit)
    .toArray();
}

/**
 * Mark a report as hidden so it no longer shows up in user-facing UIs.
 * Identifies reports by reportId.
 */
export async function hideReport(reportId) {
  const id = normalizeReportId(reportId);
  const db = await getDb();

  const result = await db.collection('reports').updateOne(
    { reportId: id },
    {
      $set: {
        status: 'hidden',
        moderatedAt: new Date()
      }
    }
  );

  return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
}

/**
 * Restore a hidden report back to "open".
 */
export async function unhideReport(reportId) {
  const id = normalizeReportId(reportId);
  const db = await getDb();

  const result = await db.collection('reports').updateOne(
    { reportId: id },
    {
      $set: {
        status: 'open',
        moderatedAt: new Date()
      }
    }
  );

  return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
}

/**
 * Permanently delete a report document from the collection.
 * Note: this does NOT delete votes; if you want that, add a cleanup step.
 */
export async function deleteReport(reportId) {
  const id = normalizeReportId(reportId);
  const db = await getDb();

  const result = await db.collection('reports').deleteOne({ reportId: id });
  return { deletedCount: result.deletedCount };
}

/**
 * Merge one duplicate report into a canonical/kept report.
 *
 * Expected use:
 *   mergeDuplicateReports(keepReportId, dupReportId)
 *
 * Behavior:
 * - Votes in "votes" collection are re-homed from dup -> keep.
 * - If the same user voted on both reports, keep the most recently updated vote.
 * - The duplicate report is marked hidden and annotated with mergedInto.
 * - The kept report is annotated with mergedFrom (audit trail) and has cached totals refreshed.
 *
 * Returns a summary object describing what happened.
 */
export async function mergeDuplicateReports(keepReportId, dupReportId) {
  const keepId = normalizeReportId(keepReportId);
  const dupId = normalizeReportId(dupReportId);

  if (keepId === dupId) {
    throw makeError('keepReportId and dupReportId must be different', 400);
  }

  const db = await getDb();
  const reportsCol = db.collection('reports');
  const votesCol = db.collection('votes');

  // Load both report documents
  const keep = await reportsCol.findOne({ reportId: keepId });
  if (!keep) throw makeError(`Keep report not found: ${keepId}`, 404);

  const dup = await reportsCol.findOne({ reportId: dupId });
  if (!dup) throw makeError(`Duplicate report not found: ${dupId}`, 404);

  // Guardrail: duplicates should target the same entity.
  // If you intentionally want to allow cross-target merges, remove this check.
  const keepTargetType = String(keep?.targetType ?? '');
  const keepTargetId = String(keep?.targetId ?? '');
  const dupTargetType = String(dup?.targetType ?? '');
  const dupTargetId = String(dup?.targetId ?? '');

  if (keepTargetType !== dupTargetType || keepTargetId !== dupTargetId) {
    throw makeError(
      'Cannot merge reports with different targets (targetType/targetId must match).',
      400
    );
  }

  // Optional guardrail: avoid accidental “merge chains”.
  if (dup?.mergedInto && String(dup.mergedInto) !== keepId) {
    throw makeError(`Duplicate report is already merged into ${dup.mergedInto}`, 409);
  }
  if (keep?.mergedInto) {
    throw makeError('Keep report is itself marked as merged; choose a canonical keep report.', 409);
  }

  const now = new Date();

  // 1) Move votes from dup -> keep
  // votes schema: { reportId, userId, vote, weight, createdAt, updatedAt }
  const dupVotes = await votesCol.find({ reportId: dupId }).toArray();

  let moved = 0;
  let overwritten = 0;
  let deleted = 0;
  let invalid = 0;

  for (const dv of dupVotes) {
    const userId = typeof dv?.userId === 'string' ? dv.userId.trim() : '';
    if (!userId) {
      invalid++;
      if (dv?._id) await votesCol.deleteOne({ _id: dv._id });
      continue;
    }

    const dvVote = Number(dv?.vote);
    if (dvVote !== 1 && dvVote !== -1) {
      invalid++;
      if (dv?._id) await votesCol.deleteOne({ _id: dv._id });
      continue;
    }

    const dvWeight = Number.isFinite(Number(dv?.weight)) ? Number(dv.weight) : 1;

    // Does the user already have a vote on the keep report?
    const existing = await votesCol.findOne({ reportId: keepId, userId });

    // No conflict: re-home the vote doc (keep _id / createdAt)
    if (!existing) {
      try {
        await votesCol.updateOne(
          { _id: dv._id },
          {
            $set: {
              reportId: keepId,
              updatedAt: dv?.updatedAt || now
            }
          }
        );
        moved++;
      } catch (e) {
        // In case of a rare race/uniqueness conflict, resolve like the conflict path.
        if (e?.code !== 11000) throw e;

        const existing2 = await votesCol.findOne({ reportId: keepId, userId });
        if (existing2) {
          const dvT = toDateSafe(dv?.updatedAt || dv?.createdAt);
          const exT = toDateSafe(existing2?.updatedAt || existing2?.createdAt);

          if (dvT > exT) {
            await votesCol.updateOne(
              { _id: existing2._id },
              {
                $set: {
                  vote: dvVote,
                  weight: dvWeight,
                  updatedAt: dv?.updatedAt || now
                }
              }
            );
            overwritten++;
          }

          await votesCol.deleteOne({ _id: dv._id });
          deleted++;
        }
      }
      continue;
    }

    // Conflict: same user has votes on both reports
    // Policy: keep the most recently updated vote (interpreted as "last intent").
    const dvT = toDateSafe(dv?.updatedAt || dv?.createdAt);
    const exT = toDateSafe(existing?.updatedAt || existing?.createdAt);

    if (dvT > exT) {
      await votesCol.updateOne(
        { _id: existing._id },
        {
          $set: {
            vote: dvVote,
            weight: dvWeight,
            updatedAt: dv?.updatedAt || now
          }
        }
      );
      overwritten++;
    }

    // Remove the duplicate-side vote doc
    await votesCol.deleteOne({ _id: dv._id });
    deleted++;
  }

  // 2) Hide/annotate the duplicate report (so it stops showing up in normal UIs)
  await reportsCol.updateOne(
    { reportId: dupId },
    {
      $set: {
        status: 'hidden',
        mergedInto: keepId,
        moderatedAt: now,
        updatedAt: now
      }
    }
  );

  // 3) Annotate the keep report (audit trail)
  await reportsCol.updateOne(
    { reportId: keepId },
    {
      $addToSet: { mergedFrom: dupId },
      $set: { updatedAt: now }
    }
  );

  // 4) Refresh cached vote totals on keep report
  const totals = await getTotalVotes(keepId);
  await updateReportVotes(keepId, totals);

  return {
    keepReportId: keepId,
    dupReportId: dupId,
    voteMoveSummary: { moved, overwritten, deleted, invalid },
    totals
  };
}

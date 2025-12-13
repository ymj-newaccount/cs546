// data/reportsAdmin.js
// Admin-side helpers for working with the "reports" collection.

import { getDb } from '../config/mongoConnection.js';

function normalizeLimit(limit, def = 20, max = 100) {
  const n = Number(limit);
  if (!Number.isInteger(n) || n <= 0) return def;
  return Math.min(n, max);
}

function normalizeReportId(reportId) {
  if (typeof reportId !== 'string') {
    throw new Error('reportId must be a string');
  }
  const id = reportId.trim();
  if (!id) {
    throw new Error('reportId cannot be empty');
  }
  if (id.length > 200) {
    throw new Error('reportId is too long');
  }
  return id;
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
 * NEW: Restore a hidden report back to "open".
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
 */
export async function deleteReport(reportId) {
  const id = normalizeReportId(reportId);
  const db = await getDb();

  const result = await db.collection('reports').deleteOne({ reportId: id });
  return { deletedCount: result.deletedCount };
}

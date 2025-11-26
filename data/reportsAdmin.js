// data/reportsAdmin.js
// Admin-side helpers for working with the "reports" collection.
// These are separate from any user-facing reports API, and are
// used only by the /admin moderation dashboard.

import { getDb } from '../config/mongoConnection.js';

/**
 * Fetch the most recent reports for the admin dashboard.
 * We sort by createdAt (if present) and _id as a fallback.
 */
export async function getRecentReports(limit = 20) {
  const db = await getDb();
  return db
    .collection('reports')
    .find({})
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Mark a report as "hidden" (or "rejected") so it no longer
 * shows up in user-facing UIs. We identify reports by reportId.
 */
export async function hideReport(reportId) {
  if (!reportId) return;
  const db = await getDb();

  await db.collection('reports').updateOne(
    { reportId: reportId },
    {
      $set: {
        status: 'hidden'
      }
    }
  );
}

/**
 * Permanently delete a report document from the collection.
 */
export async function deleteReport(reportId) {
  if (!reportId) return;
  const db = await getDb();

  await db.collection('reports').deleteOne({ reportId: reportId });
}

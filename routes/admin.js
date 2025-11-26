// routes/admin.js
// Admin dashboard routes.
// Provides a basic page with a "Sync Data" button that runs seedAll(),
// and a simple moderation panel for recent reports.

import express from 'express';
import { seedAll } from '../tasks/seed.js';
import {
  getRecentReports,
  hideReport,
  deleteReport
} from '../data/reportsAdmin.js';

const router = express.Router();

// Temporary admin guard. In the future, Person B can replace this
// with real authentication / authorization logic.
function ensureAdmin(req, res, next) {
  // Example for later:
  // if (!req.session.user || req.session.user.role !== 'admin') {
  //   return res.status(403).send('Forbidden');
  // }
  next();
}

// GET /admin - render the admin dashboard.
router.get('/', ensureAdmin, async (req, res) => {
  const synced = req.query.synced === '1';

  let reports = [];
  try {
    reports = await getRecentReports(20);
  } catch (err) {
    console.error('Error fetching reports for admin dashboard:', err);
  }

  res.render('admin', {
    title: 'Admin Dashboard',
    synced,
    reports,
    hasReports: reports.length > 0
  });
});

// POST /admin/sync - run the seedAll() snapshot import.
router.post('/sync', ensureAdmin, async (req, res) => {
  try {
    console.log('Admin: starting data sync via seedAll()...');
    await seedAll();
    console.log('Admin: data sync completed.');
    res.redirect('/admin?synced=1');
  } catch (err) {
    console.error('Error during admin sync:', err);
    res.status(500).send('Failed to run data sync.');
  }
});

// POST /admin/reports/:reportId/hide - mark a report as hidden.
router.post('/reports/:reportId/hide', ensureAdmin, async (req, res) => {
  const { reportId } = req.params;
  try {
    await hideReport(reportId);
  } catch (err) {
    console.error(`Error hiding report ${reportId}:`, err);
    // We still redirect back; in a real app we might show a flash message.
  }
  res.redirect('/admin');
});

// POST /admin/reports/:reportId/delete - permanently delete a report.
router.post('/reports/:reportId/delete', ensureAdmin, async (req, res) => {
  const { reportId } = req.params;
  try {
    await deleteReport(reportId);
  } catch (err) {
    console.error(`Error deleting report ${reportId}:`, err);
  }
  res.redirect('/admin');
});

export default router;

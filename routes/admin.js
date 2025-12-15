// routes/admin.js
// Admin dashboard routes.
//
// Features:
// - Admin auth gate (session role OR optional Basic Auth fallback)
// - Admin-only CSRF protection (cookie + hidden form field / header)
// - Data sync trigger (seedAll)
// - Report moderation: hide / unhide / delete
// - Merge duplicate reports: migrate votes + annotate reports + refresh cached totals

import express from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import { seedAll } from '../tasks/seed.js';
import {
  getRecentReports,
  hideReport,
  unhideReport,
  deleteReport,
  mergeDuplicateReports
} from '../data/reportsAdmin.js';

const router = express.Router();

const CSRF_COOKIE = 'csrf_admin';
const CSRF_FIELD = 'csrfToken';
const CSRF_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// ---------------------------
// Small utilities
// ---------------------------

// Minimal cookie parser (so we don't require cookie-parser just for admin).
function getCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return undefined;

  const parts = header.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      const v = rest.join('=');
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return undefined;
}

// Determine if the current request is HTTPS (including proxy deployments).
function isSecureRequest(req) {
  const xfProto = req.headers['x-forwarded-proto'];
  return req.secure === true || xfProto === 'https';
}

// Issue (or reuse) a CSRF token cookie scoped to /admin.
function issueCsrfToken(req, res) {
  let token = getCookie(req, CSRF_COOKIE);
  const looksValid = typeof token === 'string' && /^[a-f0-9]{64}$/i.test(token);

  if (!looksValid) token = randomBytes(32).toString('hex');

  res.cookie(CSRF_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecureRequest(req),
    path: '/admin',
    maxAge: CSRF_MAX_AGE_MS
  });

  return token;
}

// Constant-time comparison to reduce timing oracle risk.
function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

// CSRF guard for state-changing admin endpoints.
function requireCsrf(req, res, next) {
  const cookieToken = getCookie(req, CSRF_COOKIE);
  const bodyToken = req.body?.[CSRF_FIELD] || req.get('x-csrf-token');

  if (!cookieToken || !bodyToken || !tokensEqual(cookieToken, bodyToken)) {
    return res.status(403).send('Forbidden (CSRF)');
  }
  next();
}

// Basic Auth parsing helper (optional fallback).
function parseBasicAuth(header) {
  if (!header || typeof header !== 'string') return null;
  if (!header.startsWith('Basic ')) return null;

  const b64 = header.slice(6);
  let decoded;
  try {
    decoded = Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return null;
  }

  const idx = decoded.indexOf(':');
  if (idx < 0) return null;

  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

// Ensure caller is an admin.
// 1) Session-based auth is preferred (req.session.user.role === 'admin').
// 2) Optional Basic Auth fallback if ADMIN_USER/ADMIN_PASS are set.
function ensureAdmin(req, res, next) {
  // 1) Session-based (preferred)
  if (req.session?.user?.role === 'admin') return next();

  // 2) Basic Auth fallback (optional)
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;

  if (!adminUser || !adminPass) {
    return res.status(403).send('Forbidden');
  }

  const creds = parseBasicAuth(req.headers.authorization);
  if (!creds) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
    return res.status(401).send('Authentication required');
  }

  const okUser = tokensEqual(creds.user, adminUser);
  const okPass = tokensEqual(creds.pass, adminPass);

  if (!okUser || !okPass) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
    return res.status(401).send('Invalid credentials');
  }

  return next();
}

// ---------------------------
// Session "flash" helper (optional UX)
// ---------------------------

// Store one message for the next GET /admin render.
function setAdminFlash(req, flash) {
  if (req.session) req.session.adminFlash = flash;
}

// Read and clear the one-time message.
function takeAdminFlash(req) {
  const flash = req.session?.adminFlash;
  if (req.session?.adminFlash) delete req.session.adminFlash;
  return flash || null;
}

// ---------------------------
// Routes
// ---------------------------

// GET /admin
router.get('/', ensureAdmin, async (req, res) => {
  const synced = req.query.synced === '1';
  const csrfToken = issueCsrfToken(req, res);

  // One-time banner message (e.g., merge success/error).
  const flash = takeAdminFlash(req);

  let reports = [];
  try {
    reports = await getRecentReports(20);
    // Add isHidden flag so handlebars can conditionally show buttons.
    reports = reports.map((r) => ({
      ...r,
      isHidden: String(r.status || '').toLowerCase() === 'hidden'
    }));
  } catch (err) {
    console.error('Error fetching reports for admin dashboard:', err);
    // Keep rendering the page even if reports fail to load.
  }

  return res.render('admin', {
    title: 'Admin Dashboard',
    synced,
    flash, // Template can optionally show this: {{flash.type}} / {{flash.message}}
    reports,
    hasReports: reports.length > 0,
    csrfToken
  });
});

// POST /admin/sync
router.post('/sync', ensureAdmin, requireCsrf, async (req, res) => {
  try {
    await seedAll();
    return res.redirect('/admin?synced=1');
  } catch (err) {
    console.error('Error during admin sync:', err);
    return res.status(500).send('Failed to run data sync.');
  }
});

// POST /admin/reports/:reportId/hide
router.post('/reports/:reportId/hide', ensureAdmin, requireCsrf, async (req, res) => {
  const reportId = String(req.params.reportId || '').trim();
  if (!reportId) return res.status(400).send('Missing reportId');

  try {
    await hideReport(reportId);
  } catch (err) {
    console.error(`Error hiding report ${reportId}:`, err);
    setAdminFlash(req, { type: 'error', message: `Failed to hide report ${reportId}.` });
  }
  return res.redirect('/admin');
});

// POST /admin/reports/:reportId/unhide
router.post('/reports/:reportId/unhide', ensureAdmin, requireCsrf, async (req, res) => {
  const reportId = String(req.params.reportId || '').trim();
  if (!reportId) return res.status(400).send('Missing reportId');

  try {
    await unhideReport(reportId);
  } catch (err) {
    console.error(`Error unhiding report ${reportId}:`, err);
    setAdminFlash(req, { type: 'error', message: `Failed to unhide report ${reportId}.` });
  }
  return res.redirect('/admin');
});

// POST /admin/reports/:reportId/delete
router.post('/reports/:reportId/delete', ensureAdmin, requireCsrf, async (req, res) => {
  const reportId = String(req.params.reportId || '').trim();
  if (!reportId) return res.status(400).send('Missing reportId');

  try {
    await deleteReport(reportId);
  } catch (err) {
    console.error(`Error deleting report ${reportId}:`, err);
    setAdminFlash(req, { type: 'error', message: `Failed to delete report ${reportId}.` });
  }
  return res.redirect('/admin');
});

// NEW: POST /admin/reports/merge
// Merges a duplicate report into a canonical report.
// Expected form fields:
//   - keepReportId: the reportId to keep
//   - dupReportId:  the reportId to merge/hide
router.post('/reports/merge', ensureAdmin, requireCsrf, async (req, res) => {
  // Accept a couple of alias names to make the form/template flexible.
  const keepReportId = String(req.body?.keepReportId ?? req.body?.keepId ?? '').trim();
  const dupReportId = String(req.body?.dupReportId ?? req.body?.dupId ?? '').trim();

  if (!keepReportId || !dupReportId) {
    setAdminFlash(req, {
      type: 'error',
      message: 'Merge failed: keepReportId and dupReportId are required.'
    });
    return res.redirect('/admin');
  }

  if (keepReportId === dupReportId) {
    setAdminFlash(req, {
      type: 'error',
      message: 'Merge failed: keepReportId and dupReportId must be different.'
    });
    return res.redirect('/admin');
  }

  try {
    const result = await mergeDuplicateReports(keepReportId, dupReportId);

    const s = result?.voteMoveSummary || {};
    const totals = result?.totals || {};

    setAdminFlash(req, {
      type: 'success',
      message:
        `Merged ${result.dupReportId} into ${result.keepReportId}. ` +
        `Votes moved=${s.moved || 0}, overwritten=${s.overwritten || 0}, ` +
        `deleted=${s.deleted || 0}, invalid=${s.invalid || 0}. ` +
        `New totals: up=${totals.upVotes ?? 0}, down=${totals.downVotes ?? 0}, ` +
        `weightedScore=${totals.weightedScore ?? totals.score ?? 0}.`
    });

    return res.redirect('/admin');
  } catch (err) {
    const status = Number(err?.status || err?.statusCode) || 500;
    console.error(`Error merging reports keep=${keepReportId} dup=${dupReportId}:`, err);

    // Show a useful error message in the admin UI, but avoid leaking stack traces.
    setAdminFlash(req, {
      type: 'error',
      message: `Merge failed (${status}): ${err?.message || 'Unknown error'}`
    });

    return res.redirect('/admin');
  }
});

export default router;

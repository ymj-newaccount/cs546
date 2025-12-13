// routes/admin.js
import express from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import { seedAll } from '../tasks/seed.js';
import {
  getRecentReports,
  hideReport,
  unhideReport,
  deleteReport
} from '../data/reportsAdmin.js';

const router = express.Router();

const CSRF_COOKIE = 'csrf_admin';
const CSRF_FIELD = 'csrfToken';
const CSRF_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

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

function isSecureRequest(req) {
  const xfProto = req.headers['x-forwarded-proto'];
  return req.secure === true || xfProto === 'https';
}

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

function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function requireCsrf(req, res, next) {
  const cookieToken = getCookie(req, CSRF_COOKIE);
  const bodyToken = req.body?.[CSRF_FIELD] || req.get('x-csrf-token');

  if (!cookieToken || !bodyToken || !tokensEqual(cookieToken, bodyToken)) {
    return res.status(403).send('Forbidden (CSRF)');
  }
  next();
}

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

function ensureAdmin(req, res, next) {
  // 1) Session-based (preferred)
  if (req.session?.user?.role === 'admin') return next();

  // 2) Basic Auth fallback (optional)
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;

  if (!adminUser || !adminPass) {
    return res
      .status(403)
      .send('Forbidden');
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

// GET /admin
router.get('/', ensureAdmin, async (req, res) => {
  const synced = req.query.synced === '1';
  const csrfToken = issueCsrfToken(req, res);

  let reports = [];
  try {
    reports = await getRecentReports(20);
    // add isHidden flag so handlebars can conditionally show buttons
    reports = reports.map((r) => ({
      ...r,
      isHidden: String(r.status || '').toLowerCase() === 'hidden'
    }));
  } catch (err) {
    console.error('Error fetching reports for admin dashboard:', err);
  }

  return res.render('admin', {
    title: 'Admin Dashboard',
    synced,
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
  }
  return res.redirect('/admin');
});

// NEW: POST /admin/reports/:reportId/unhide
router.post('/reports/:reportId/unhide', ensureAdmin, requireCsrf, async (req, res) => {
  const reportId = String(req.params.reportId || '').trim();
  if (!reportId) return res.status(400).send('Missing reportId');

  try {
    await unhideReport(reportId);
  } catch (err) {
    console.error(`Error unhiding report ${reportId}:`, err);
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
  }
  return res.redirect('/admin');
});

export default router;

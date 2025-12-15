// routes/auth.js
import express from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import { createUser, checkUser } from '../data/users.js';

const router = express.Router();

const CSRF_COOKIE = 'csrf_token';
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

// Exported so you can optionally reuse it in app.js to provide csrfToken to ALL pages.
export function issueCsrfToken(req, res) {
  let token = getCookie(req, CSRF_COOKIE);
  const ok = typeof token === 'string' && /^[a-f0-9]{64}$/i.test(token);
  if (!ok) token = randomBytes(32).toString('hex');

  res.cookie(CSRF_COOKIE, token, {
    httpOnly: true,
    // LAX is usually the best tradeoff for coursework apps
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
    maxAge: CSRF_MAX_AGE_MS
  });

  return token;
}

function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function requireCsrf(req, res, next) {
  const cookieToken = getCookie(req, CSRF_COOKIE);
  const bodyToken = req.body?.[CSRF_FIELD] || req.get('x-csrf-token');

  if (!cookieToken || !bodyToken || !tokensEqual(cookieToken, bodyToken)) {
    return res.status(403).send('Forbidden (CSRF)');
  }
  next();
}

// Middleware: ensure csrf token exists and is available to templates as {{csrfToken}}
export function csrfLocals(req, res, next) {
  const token = issueCsrfToken(req, res);
  res.locals.csrfToken = token;
  next();
}

function alreadyLoggedIn(req) {
  return !!req.session?.user;
}

function clearCsrfCookie(res) {
  res.clearCookie(CSRF_COOKIE, {
    path: '/'
  });
}

function sessionRegenerate(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return reject(new Error('Session middleware is not configured'));
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function sessionSave(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return reject(new Error('Session middleware is not configured'));
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

// Apply csrfLocals for all auth routes so all auth views can use {{csrfToken}}
router.use(csrfLocals);

// GET /register
router.get('/register', (req, res) => {
  if (alreadyLoggedIn(req)) return res.redirect('/explore');

  res.set('Cache-Control', 'no-store');

  return res.render('register', {
    title: 'Register'
  });
});

// POST /register
router.post('/register', requireCsrf, async (req, res) => {
  if (alreadyLoggedIn(req)) return res.redirect('/explore');

  const { username, email, password, confirmPassword } = req.body || {};

  if (password !== confirmPassword) {
    return res.status(400).render('register', {
      title: 'Register',
      error: 'Passwords do not match',
      username,
      email
    });
  }

  try {
    const user = await createUser(username, email, password);

    // Prevent session fixation: regenerate session on privilege change (login)
    await sessionRegenerate(req);

    req.session.user = {
      _id: user._id,
      username: user.username,
      role: user.role
    };

    await sessionSave(req);
    return res.redirect('/explore');
  } catch (err) {
    const status = Number(err?.status) || 400;
    return res.status(status).render('register', {
      title: 'Register',
      error: err?.message || 'Failed to register',
      username,
      email
    });
  }
});

// GET /login
router.get('/login', (req, res) => {
  if (alreadyLoggedIn(req)) return res.redirect('/explore');

  res.set('Cache-Control', 'no-store');

  return res.render('login', {
    title: 'Login'
  });
});

// POST /login
router.post('/login', requireCsrf, async (req, res) => {
  if (alreadyLoggedIn(req)) return res.redirect('/explore');

  const { username, password } = req.body || {};

  try {
    const user = await checkUser(username, password);

    // Prevent session fixation
    await sessionRegenerate(req);

    req.session.user = {
      _id: user._id,
      username: user.username,
      role: user.role
    };

    await sessionSave(req);
    return res.redirect('/explore');
  } catch (err) {
    const status = Number(err?.status) || 401;
    return res.status(status).render('login', {
      title: 'Login',
      error: err?.message || 'Invalid credentials',
      username
    });
  }
});

// POST /logout
router.post('/logout', requireCsrf, (req, res) => {
  // Clear session + CSRF cookie
  req.session.destroy((err) => {
    clearCsrfCookie(res);
    if (err) return res.status(500).send('Failed to log out');
    return res.redirect('/login');
  });
});

export default router;

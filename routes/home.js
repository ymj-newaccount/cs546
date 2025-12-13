// routes/home.js
// Root routing helpers:
//   GET  /            -> /explore
//   GET  /search?q=.. -> /explore?q=..

import express from 'express';

const router = express.Router();

const MAX_Q_LEN = 80;

function normalizeQ(raw) {
  if (raw == null) return '';
  if (Array.isArray(raw)) raw = raw[0];

  return String(raw)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_Q_LEN);
}

router.get('/', (req, res) => {
  return res.redirect('/explore');
});

router.get('/search', (req, res) => {
  const q = normalizeQ(req.query.q);

  if (!q) {
    return res.redirect('/explore');
  }

  return res.redirect(`/explore?q=${encodeURIComponent(q)}`);
});

export default router;

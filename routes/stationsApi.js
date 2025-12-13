// routes/stationsApi.js
import express from 'express';
import { requireCsrf } from './auth.js';
import { addBookmark, removeBookmark } from '../data/users.js';
import { getDb } from '../config/mongoConnection.js';

const router = express.Router();

function ensureLoggedIn(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'You must be logged in.' });
}

function normalizeStationId(raw) {
  const sid = String(raw ?? '').trim();
  if (!sid) {
    const err = new Error('stationId is required');
    err.status = 400;
    throw err;
  }
  if (sid.length > 200) {
    const err = new Error('stationId is too long');
    err.status = 400;
    throw err;
  }
  return sid;
}

async function ensureStationExists(stationId) {
  const db = await getDb();
  const doc = await db.collection('stations').findOne(
    { stationId: String(stationId) },
    { projection: { _id: 1 } }
  );
  return !!doc;
}

// POST /api/stations/:stationId/follow
router.post('/:stationId/follow', ensureLoggedIn, requireCsrf, async (req, res, next) => {
  try {
    const stationId = normalizeStationId(req.params.stationId);

    const ok = await ensureStationExists(stationId);
    if (!ok) return res.status(404).json({ error: 'Station not found.' });

    const user = await addBookmark(req.session.user._id, stationId);
    return res.json({ stationId, followed: true, bookmarks: user.bookmarks || [] });
  } catch (err) {
    return next(err);
  }
});

// POST /api/stations/:stationId/unfollow
router.post('/:stationId/unfollow', ensureLoggedIn, requireCsrf, async (req, res, next) => {
  try {
    const stationId = normalizeStationId(req.params.stationId);

    const ok = await ensureStationExists(stationId);
    if (!ok) return res.status(404).json({ error: 'Station not found.' });

    const user = await removeBookmark(req.session.user._id, stationId);
    return res.json({ stationId, followed: false, bookmarks: user.bookmarks || [] });
  } catch (err) {
    return next(err);
  }
});

export default router;

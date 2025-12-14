// routes/crossingsApi.js
// API routes for following/unfollowing crossings (APS / curb ramps).
// Endpoints:
//   POST /api/crossings/:kind/:id/follow
//   POST /api/crossings/:kind/:id/unfollow

import express from 'express';
import { requireCsrf } from './auth.js';
import { addCrossingBookmark, removeCrossingBookmark } from '../data/users.js';
import { getDb } from '../config/mongoConnection.js';

const router = express.Router();

/**
 * Create an HTTP-style error object with a status code.
 * Your global error handler should read err.status.
 */
function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Middleware: require an authenticated session user.
 * Returns 401 JSON for API consumers.
 */
function ensureLoggedIn(req, res, next) {
  if (req.session?.user?._id) 
    {
        return next();
    }
  return res.status(401).json({ error: 'You must be logged in.' });
}

/**
 * Validate and normalize crossing kind from route params.
 * Allowed: "aps" | "ramp"
 */
function normalizeKind(raw) {
  const k = String(raw ?? '').trim().toLowerCase();
  if (!k)
  {
    throw httpError('kind is required', 400);
  }
  if (!['aps', 'ramp'].includes(k)) 
  {
    throw httpError('kind must be aps or ramp', 400);
  }
  return k;
}

/**
 * Validate and normalize crossing id from route params.
 * We keep it flexible (string) because dataset IDs are stored as strings.
 */
function normalizeId(raw) {
  const id = String(raw ?? '').trim();
  if (!id)
  {
    throw httpError('id is required', 400);
  }
  // Defensive limit against abuse / extremely long path segments
  if (id.length > 200) 
  {
    throw httpError('id is too long', 400);
  }
  return id;
}

/**
 * Verify that a crossing exists in the dataset before bookmarking it.
 * NOTE: IDs are stored as strings in MongoDB (apsId / rampId),
 * so we always query with String(id).
 */
async function ensureCrossingExists(kind, id) {
  const db = await getDb();
  const idStr = String(id); // critical: normalize query type

  if (kind === 'aps') {
    const doc = await db
      .collection('aps_locations')
      .findOne({ apsId: idStr }, { projection: { _id: 1 } });
    return !!doc;
  }

  const doc = await db
    .collection('curb_ramps')
    .findOne({ rampId: idStr }, { projection: { _id: 1 } });

  return !!doc;
}

/**
 * Shared handler for follow/unfollow to keep logic consistent.
 */
async function handleFollowToggle(req, res, next, shouldFollow) {
  try {
    const kind = normalizeKind(req.params.kind);
    const id = normalizeId(req.params.id);

    const ok = await ensureCrossingExists(kind, id);
    if (!ok) 
    {
     return res.status(404).json({ error: 'Crossing not found.' });
    }

    const userId = req.session.user._id;

    let updatedUser;
    if(shouldFollow === true)
    {
        updatedUser = await addCrossingBookmark(userId, kind, id);
    }
    else
    {
        updatedUser = await removeCrossingBookmark(userId, kind, id);
    }

    // Optional: keep the session copy in sync (useful if UI reads session user)
    req.session.user = {
      ...req.session.user,
      crossingBookmarks: updatedUser.crossingBookmarks
    };

    return res.json({
      kind,
      id,
      followed: shouldFollow,
      crossingBookmarks: updatedUser.crossingBookmarks || {}
    });
  } catch (e) {
    return next(e);
  }
}

// POST /api/crossings/:kind/:id/follow
router.post('/:kind/:id/follow', ensureLoggedIn, requireCsrf, (req, res, next) =>
  handleFollowToggle(req, res, next, true)
);

// POST /api/crossings/:kind/:id/unfollow
router.post('/:kind/:id/unfollow', ensureLoggedIn, requireCsrf, (req, res, next) =>
  handleFollowToggle(req, res, next, false)
);

export default router;

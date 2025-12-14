// routes/crossingPage.js
// Crossing detail page route: GET /crossing/:id
// - Attempts to resolve :id as an APS record first, then as a curb ramp record
// - Loads nearby APS + curb ramps (simple in-memory haversine filtering via data/locations.js)
// - Loads community reports for the resolved target (targetType = "aps" or "ramp")
// - Computes whether the logged-in user is following this crossing (isBookmarked)
// NOTE: If APS IDs and Ramp IDs can collide (same numeric ID), this route will prefer APS.
//       A more explicit design would be /crossing/:kind/:id (e.g., /crossing/aps/123).

import express from 'express';
import { getAPSById } from '../data/aps.js';
import { getCurbRampById } from '../data/curbRamps.js';
import * as locationData from '../data/locations.js';
import { getReportsForTarget } from '../data/reports.js';
import { getUserById } from '../data/users.js';

const router = express.Router();

const MAX_ID_LEN = 200;
const NEARBY_RADIUS_METERS = 250;
const REPORTS_LIMIT = 50;

function normalizeId(raw, name = 'id') {
  const s = String(raw ?? '').trim();

  if (!s) {
    const err = new Error(`${name} is required`);
    err.status = 400;
    throw err;
  }

  if (s.length > MAX_ID_LEN) {
    const err = new Error(`${name} is too long`);
    err.status = 400;
    throw err;
  }

  return s;
}

function isNotFoundError(err) {
  if (!err) return false;
  if (err.status === 404) return true;
  const msg = String(err.message || '');
  return /not found/i.test(msg);
}

// Only swallow "not found" so we don't mask real server/DB issues.
async function safeFind(getterFn, id) {
  try {
    return await getterFn(id);
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

router.get('/:id', async (req, res, next) => {
  try {
    // Prevent stale pages (reports and nearby features may change)
    res.set('Cache-Control', 'no-store');

    const id = normalizeId(req.params.id, 'crossingId');

    // Try resolving the ID as APS and Ramp in parallel (fastest)
    const [aps, ramp] = await Promise.all([safeFind(getAPSById, id), safeFind(getCurbRampById, id)]);

    if (!aps && !ramp) {
      const err = new Error('Crossing not found');
      err.status = 404;
      throw err;
    }

    // Prefer APS if both exist
    const kind = aps ? 'aps' : 'ramp';
    const primary = aps || ramp;

    // Ensure numeric coords before calling nearby queries
    const lat = Number(primary?.location?.lat);
    const lng = Number(primary?.location?.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    const [nearbyAPS, nearbyRamps] = await Promise.all([
      hasCoords ? locationData.getNearbyAPS({ lat, lng, radiusMeters: NEARBY_RADIUS_METERS }) : [],
      hasCoords ? locationData.getNearbyCurbRamps({ lat, lng, radiusMeters: NEARBY_RADIUS_METERS }) : []
    ]);

    // Reports are attached to the resolved kind (compatible with your existing /api/reports)
    const reports = await getReportsForTarget(kind, id, {
      limit: REPORTS_LIMIT,
      includeHidden: false
    });

    // Determine whether the logged-in user is following this crossing
    let isBookmarked = false;
    let sessionUserId = null
    if(req.session && req.session.user && req.session.user._id)
    {
      sessionUserId = req.session.user._id;
    }

    if (sessionUserId) {
      try {
        const u = await getUserById(String(sessionUserId));
        let arr;
        if(u && u.crossingBookmarks && u.crossingBookmarks[kind])
        {
          arr = u.crossingBookmarks[kind];
        }
        else
        {
          arr = undefined;
        }
        isBookmarked = Array.isArray(arr) && arr.includes(String(id));
      } catch {
        isBookmarked = false;
      }
    }

    return res.render('crossing', {
      title: kind === 'aps' ? `Crossing (APS ${id})` : `Crossing (Ramp ${id})`,

      id,
      kind,

      // Pass session user for templates that conditionally render authenticated UI
      user: req.session?.user || null,

      // Provide both objects to the template; one will be null
      aps,
      ramp,

      // Follow state for this crossing
      isBookmarked,

      // Useful for conditional template messages
      hasCoords,

      nearbyAPS,
      hasNearbyAPS: nearbyAPS.length > 0,

      nearbyRamps,
      hasNearbyRamps: nearbyRamps.length > 0,

      reports,
      hasReports: reports.length > 0,

      // Useful for a shared "Submit report" component on detail pages
      reportTargetType: kind,
      reportTargetId: id
    });
  } catch (err) {
    return next(err);
  }
});

export default router;

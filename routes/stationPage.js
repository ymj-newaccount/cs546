// routes/stationPage.js
// Station detail page route: GET /station/:id
// - Loads station metadata
// - Loads elevators for the station
// - Loads nearby APS + curb ramps (simple in-memory haversine filtering; see data/locations.js)
// - Loads community reports for this station
// - Computes whether the current user has bookmarked the station (for Follow/Unfollow UI)

import express from 'express';
import * as stationData from '../data/stations.js';
import * as elevatorData from '../data/elevators.js';
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

router.get('/:id', async (req, res, next) => {
  try {
    // Prevent stale pages (elevator status / reports can change frequently)
    res.set('Cache-Control', 'no-store');

    const stationId = normalizeId(req.params.id, 'stationId');

    // Fetch station. data/stations.js throws a generic Error when not found,
    // so we map that specific case to a 404 while preserving real server errors as 500s.
    let station;
    try {
      station = await stationData.getStationById(stationId);
    } catch (err) {
      if (!err?.status && /not found/i.test(err?.message || '')) {
        err.status = 404;
      }
      throw err;
    }

    // Fetch elevators for this station (may be empty)
    const elevators = await elevatorData.getElevatorsByStationId(stationId);

    // Nearby features require coordinates
    const lat = Number(station?.location?.lat);
    const lng = Number(station?.location?.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    const [nearbyAPS, nearbyRamps] = await Promise.all([
      hasCoords ? locationData.getNearbyAPS({ lat, lng, radiusMeters: NEARBY_RADIUS_METERS }) : [],
      hasCoords
        ? locationData.getNearbyCurbRamps({ lat, lng, radiusMeters: NEARBY_RADIUS_METERS })
        : []
    ]);

    // Community reports targeting this station
    const reports = await getReportsForTarget('station', stationId, {
      limit: REPORTS_LIMIT,
      includeHidden: false
    });

    // Bookmark state for the logged-in user (optional but recommended for the UI)
    let isBookmarked = false;
    const sessionUserId = req.session?.user?._id;

    if (sessionUserId) {
      try {
        const u = await getUserById(String(sessionUserId));
        isBookmarked = Array.isArray(u.bookmarks) && u.bookmarks.includes(stationId);
      } catch {
        // Do not fail the page if user lookup fails
        isBookmarked = false;
      }
    }

    return res.render('station', {
      title: `Station: ${station.stationName || stationId}`,

      stationId,
      station,

      elevators,
      hasElevators: elevators.length > 0,

      hasCoords,

      nearbyAPS,
      hasNearbyAPS: nearbyAPS.length > 0,

      nearbyRamps,
      hasNearbyRamps: nearbyRamps.length > 0,

      reports,
      hasReports: reports.length > 0,

      // Useful for a shared "Submit report" component on detail pages
      reportTargetType: 'station',
      reportTargetId: stationId,

      isBookmarked
    });
  } catch (err) {
    return next(err);
  }
});

export default router;

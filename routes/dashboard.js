// routes/dashboard.js
import express from 'express';
import { getUserById } from '../data/users.js';
import { getDb } from '../config/mongoConnection.js';
import { getReportsByUser } from '../data/reports.js';

const router = express.Router();

function ensureLoggedInPage(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/login');
}

function toStringArray(v) {
  if (!Array.isArray(v))
  {
    return [];
  }
  return v.map((x) => String(x)).filter((s) => s.trim().length > 0);
}

function normalizeCrossingBookmarks(v) {
  const out = { aps: [], ramp: [] };

  if (!v || typeof v !== 'object')
  {
    return out;
  }

  out.aps = toStringArray(v.aps);
  out.ramp = toStringArray(v.ramp);

  return out;
}

function toIdMap(docs, keyField) {
  const m = new Map();
  for (const d of docs || []) {
    const k = d?.[keyField];
    if (k != null) 
    {
      m.set(String(k), d);
    }
  }
  return m;
}

function safeIdLabel(s, fallback) {
  let v;
  if( s === null || s === undefined)
  {
    v = "";
  }
  else
  {
    v = String(s);
  }
  v = v.trim();
  if(v)
  {
    return v;
  }
  else
  {
    return fallback;
  }
}

function withTargetLink(doc) {
  const out = { ...(doc || {}) };

  if (out._id && typeof out._id?.toString === 'function') {
    out._id = out._id.toString();
  }

  const tType = String(out.targetType || '').toLowerCase();
  const tId = String(out.targetId || '');

  if (tType === 'station') out.targetLink = `/station/${encodeURIComponent(tId)}`;
  else if (tType === 'aps' || tType === 'ramp') out.targetLink = `/crossing/${encodeURIComponent(tId)}`;
  else out.targetLink = '';

  return out;
}

router.get('/', ensureLoggedInPage, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');

    const userId = String(req.session.user._id);
    const user = await getUserById(userId);

    const stationIds = toStringArray(user.bookmarks);
    const crossingBookmarks = normalizeCrossingBookmarks(user.crossingBookmarks);
    const apsIds = crossingBookmarks.aps;
    const rampIds = crossingBookmarks.ramp;

    const db = await getDb();

    // ---------------------------
    // Followed stations (quick access)
    // ---------------------------
    const stationDocs = stationIds.length
      ? await db
          .collection('stations')
          .find(
            { stationId: { $in: stationIds } },
            { projection: { stationId: 1, stationName: 1, adaStatus: 1, daytimeRoutes: 1 } }
          )
          .toArray()
      : [];

    const stationsById = toIdMap(stationDocs, 'stationId');

    const followedStations = stationIds.map((id) => {
      const s = stationsById.get(String(id));
      return {
        stationId: String(id),
        stationName: s?.stationName || '(not found)',
        adaStatus: s?.adaStatus || 'Unknown',
        routes: s?.daytimeRoutes || [],
        link: `/station/${encodeURIComponent(String(id))}`
      };
    });

    // ---------------------------
    // Followed crossings (quick access)
    // ---------------------------
    const apsDocs = apsIds.length
      ? await db
          .collection('aps_locations')
          .find({ apsId: { $in: apsIds } }, { projection: { apsId: 1, location: 1 } })
          .toArray()
      : [];

    const rampDocs = rampIds.length
      ? await db
          .collection('curb_ramps')
          .find(
            { rampId: { $in: rampIds } },
            { projection: { rampId: 1, streetName: 1, borough: 1, location: 1 } }
          )
          .toArray()
      : [];

    const apsById = toIdMap(apsDocs, 'apsId');
    const rampsById = toIdMap(rampDocs, 'rampId');

    const followedCrossings = [
      ...apsIds.map((id) => {
        const d = apsById.get(String(id));
        const addr = d?.location?.address;
        const borough = d?.location?.borough;
        const label = addr ? `APS at ${addr}` : `APS ${id}`;
        return {
          kind: 'aps',
          id: String(id),
          label,
          borough: safeIdLabel(borough, ''),
          link: `/crossing/${encodeURIComponent(String(id))}`
        };
      }),
      ...rampIds.map((id) => {
        const d = rampsById.get(String(id));
        const street = d?.streetName;
        const borough = d?.borough;
        const label = street ? `Ramp at ${street}` : `Ramp ${id}`;
        return {
          kind: 'ramp',
          id: String(id),
          label,
          borough: safeIdLabel(borough, ''),
          link: `/crossing/${encodeURIComponent(String(id))}`
        };
      })
    ];

    // ---------------------------
    // Your reports (created by you)
    // Add targetLink so the dashboard template can link to the target.
    // ---------------------------
    const reportsRaw = await getReportsByUser(userId, { limit: 50, includeHidden: true });
    const reports = (Array.isArray(reportsRaw) ? reportsRaw : []).map(withTargetLink);

    // ---------------------------
    // Personalized feed (reports about followed targets)
    // ---------------------------
    const or = [];
    if (stationIds.length) 
    {
      or.push({ targetType: 'station', targetId: { $in: stationIds } });
    }
    if (apsIds.length)
    {
      or.push({ targetType: 'aps', targetId: { $in: apsIds } });
    }
    if (rampIds.length) 
    {
      or.push({ targetType: 'ramp', targetId: { $in: rampIds } });
    }

    const feedDocs = or.length
      ? await db
          .collection('reports')
          .find({ $or: or, status: { $ne: 'hidden' } })
          .sort({ createdAt: -1, _id: -1 })
          .limit(50)
          .toArray()
      : [];

    const feed = feedDocs.map(withTargetLink);

    return res.render('dashboard', {
      title: 'Dashboard',
      user: req.session.user,

      followedStations,
      hasFollowed: followedStations.length > 0,

      followedCrossings,
      hasFollowedCrossings: followedCrossings.length > 0,

      reports,
      hasReports: reports.length > 0,

      feed,
      hasFeed: feed.length > 0
    });
  } catch (err) {
    return next(err);
  }
});

export default router;

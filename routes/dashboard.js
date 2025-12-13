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

router.get('/', ensureLoggedInPage, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');

    const userId = String(req.session.user._id);

    const user = await getUserById(userId);
    const bookmarks = Array.isArray(user.bookmarks) ? user.bookmarks.map((x) => String(x)) : [];

    const db = await getDb();
    const stationDocs = bookmarks.length
      ? await db
          .collection('stations')
          .find(
            { stationId: { $in: bookmarks } },
            { projection: { stationId: 1, stationName: 1, adaStatus: 1, daytimeRoutes: 1 } }
          )
          .toArray()
      : [];

    const byId = new Map(stationDocs.map((s) => [String(s.stationId), s]));
    const followedStations = bookmarks.map((id) => {
      const s = byId.get(String(id));
      return {
        stationId: String(id),
        stationName: s?.stationName || '(not found)',
        adaStatus: s?.adaStatus || 'Unknown',
        routes: s?.daytimeRoutes || []
      };
    });

    // FIX: second arg is an options object (per your data/reports.js)
    const reports = await getReportsByUser(userId, { limit: 50, includeHidden: true });
    // If you want to hide admin-hidden reports on dashboard:
    // const reports = await getReportsByUser(userId, { limit: 50, includeHidden: false });

    return res.render('dashboard', {
      title: 'Dashboard',
      user: req.session.user,
      followedStations,
      hasFollowed: followedStations.length > 0,
      reports,
      hasReports: reports.length > 0
    });
  } catch (err) {
    return next(err);
  }
});

export default router;

// config/routes.js
// Central place to register all Express routes.
// Keep this file small and declarative: only mount routers and set global fallbacks.

import authRoutes from '../routes/auth.js';
import adminRoutes from '../routes/admin.js';
import exploreRoutes from '../routes/explore.js';

// Home + search routes (GET /, GET /search)
import homeRoutes from '../routes/home.js';

// Reports API routes for AJAX report submission
import reportsRoutes from '../routes/reports.js';

// Stations API routes for follow/unfollow (AJAX)
import stationsApiRoutes from '../routes/stationsApi.js';

// Dashboard page route
import dashboardRoutes from '../routes/dashboard.js';

// Detail page routes
import stationPageRoutes from '../routes/stationPage.js';
import crossingPageRoutes from '../routes/crossingPage.js';

export function registerRoutes(app) {
  // ---------------------------
  // Public pages + authentication
  // ---------------------------

  // Auth routes: /register, /login, /logout
  // Mounted at '/' so the router defines the actual paths.
  app.use('/', authRoutes);

  // Home + search
  // Expected endpoints (implemented in routes/home.js):
  //   GET  /
  //   GET  /search?q=...
  app.use('/', homeRoutes);

  // ---------------------------
  // Main app pages
  // ---------------------------

  // Explore map
  // Expected endpoints (implemented in routes/explore.js):
  //   GET  /explore
  //   GET  /explore/api   (AJAX)
  app.use('/explore', exploreRoutes);

  // Detail pages
  // Expected endpoints:
  //   GET /station/:id
  //   GET /crossing/:id
  app.use('/station', stationPageRoutes);
  app.use('/crossing', crossingPageRoutes);

  // User dashboard page
  // Expected endpoint:
  //   GET /dashboard
  app.use('/dashboard', dashboardRoutes);

  // Admin dashboard
  // Expected endpoints (implemented in routes/admin.js):
  //   GET  /admin
  //   POST /admin/sync
  //   POST /admin/reports/:reportId/hide|unhide|delete
  app.use('/admin', adminRoutes);

  // ---------------------------
  // APIs (AJAX)
  // ---------------------------

  // Community reports API (AJAX)
  // Expected endpoints:
  //   POST /api/reports
  //   GET  /api/reports?...
  app.use('/api/reports', reportsRoutes);

  // Station follow/unfollow API (AJAX)
  // Expected endpoints:
  //   POST /api/stations/:stationId/follow
  //   POST /api/stations/:stationId/unfollow
  app.use('/api/stations', stationsApiRoutes);

  // ---------------------------
  // Global fallbacks
  // ---------------------------

  // Catch-all 404 handler (must be registered last).
  app.use((req, res) => {
    res.status(404).send('404 Not Found');
  });
}

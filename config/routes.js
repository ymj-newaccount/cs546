// config/routes.js
// Central place to register all Express routes.

import adminRoutes from '../routes/admin.js';

export function registerRoutes(app) {
  // Admin dashboard (Person A responsibilities).
  app.use('/admin', adminRoutes);

  // Simple home page for now.
  app.get('/', (req, res) => {
    res.send(
      'CommuteAble NYC server is running. ' +
        'Visit <a href="/admin">/admin</a> for the admin dashboard.'
    );
  });

  // Catch-all 404 handler (must be registered last).
  app.use((req, res) => {
    res.status(404).send('404 Not Found');
  });
}

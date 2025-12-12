// config/routes.js
// Central place to register all Express routes.

import adminRoutes from '../routes/admin.js';
import exploreRoutes from '../routes/explore.js';
import stationRoutes from '../routes/station.js';
import userRoutes from '../routes/home.js';
import crossingRoutes from '../routes/crossing.js';


export function registerRoutes(app) {
  // Admin dashboard (Person A responsibilities).
  app.use('/admin', adminRoutes);
  //Explore Map (Person D)
  app.use('/explore', exploreRoutes);
  // Simple home page for now.
  app.use('/station', stationRoutes);
  // Station/:id (Person C)
  app.use('/', userRoutes);
  // simple user home for now
  app.use('/crossing', crossingRoutes);
  // crossing/:id (Person C)
  app.get('/', (req, res) => {
    res.redirect("/home");
  });

  // Catch-all 404 handler (must be registered last).
  app.use((req, res) => {
    res.status(404).send('404 Not Found');
  });
}

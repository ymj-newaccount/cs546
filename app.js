// app.js
// Express entry point for the CommuteAble NYC project.
// Sets up middleware, the Handlebars view engine, and delegates
// route registration to config/routes.js.

import express from 'express';
import { engine as handlebarsEngine } from 'express-handlebars';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './config/mongoConnection.js';
import { registerRoutes } from './config/routes.js';


// Resolve __filename and __dirname in an ES module environment.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = process.env.PORT || 3000;

  // Basic middleware for parsing JSON and URL-encoded form bodies.
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static assets (CSS, client-side JS, images, etc.).
  app.use('/public', express.static(path.join(__dirname, 'public')));
  //app.use("/", stationRoutes);

  // Handlebars view engine configuration.
  app.engine(
    'handlebars',
    handlebarsEngine({
      defaultLayout: 'main'
      // You can add helpers / partials here later if needed.
    })
  );
  app.set('view engine', 'handlebars');
  app.set('views', path.join(__dirname, 'views'));

  // Ensure MongoDB is reachable before starting to listen.
  await getDb();

  // Register all application routes (including /admin).
  registerRoutes(app);

  // Start the HTTP server.
  app.listen(port, () => {
    console.log(`Server is listening on http://localhost:${port}`);
  });
}

// Centralized startup with error handling.
startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// app.js
// Express entry point for the CommuteAble NYC project.
// Sets up middleware, the Handlebars view engine, centralized error handling,
// and graceful shutdown (HTTP + MongoDB).

import express from 'express';
import session from 'express-session';
import { engine as handlebarsEngine } from 'express-handlebars';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { getDb, closeConnection } from './config/mongoConnection.js';
import { registerRoutes } from './config/routes.js';

// ADD: make csrf token available to all templates (for AJAX)
import { csrfLocals } from './routes/auth.js';

// Resolve __filename and __dirname in an ES module environment.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === 'production';

let server;
let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n${signal} received. Shutting down gracefully...`);

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await closeConnection();
  } catch (err) {
    console.error('Graceful shutdown failed:', err);
    exitCode = 1;
  } finally {
    process.exit(exitCode);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
  shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
  shutdown('unhandledRejection', 1);
});

async function startServer() {
  const app = express();
  const port = process.env.PORT || 3000;

  // If you ever deploy behind a reverse proxy, this makes secure cookies work.
  app.set('trust proxy', 1);

  // Basic middleware for parsing JSON and URL-encoded form bodies.
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static assets (CSS, client-side JS, images, etc.).
  app.use('/public', express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(path.join(process.cwd(),'uploads')));
  // Session middleware (REQUIRED for auth.js)
  app.use(
    session({
      name: 'sid',
      secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      }
    })
  );

  // Make logged-in user available to all templates (optional but useful)
  app.use((req, res, next) => {
    res.locals.user = req.session?.user || null;
    next();
  });

  // ADD: ensure csrf token exists and is available to templates as {{csrfToken}}
  // This is required so client-side JS can send x-csrf-token for AJAX POSTs.
  app.use(csrfLocals);

  // Handlebars view engine configuration.
  app.engine(
    'handlebars',
    handlebarsEngine({
      defaultLayout: 'main'
    })
  );
  app.set('view engine', 'handlebars');
  app.set('views', path.join(__dirname, 'views'));

  // Ensure MongoDB is reachable before starting to listen.
  await getDb();

  // Register all application routes (including /auth, /admin, /explore and 404).
  registerRoutes(app);

  // Centralized 500 error handler (must be AFTER routes).
  app.use((err, req, res, next) => {
    const status = Number(err?.status || err?.statusCode) || 500;

    console.error('[ERROR]', err);

    const message = status === 500 ? 'Internal Server Error' : (err?.message || 'Error');
    const wantsJson = req.accepts(['html', 'json']) === 'json';

    if (wantsJson) {
      const payload = { error: message };
      if (!isProd && err?.stack) payload.stack = err.stack;
      return res.status(status).json(payload);
    }

    return res.status(status).send(message);
  });

  // Start the HTTP server.
  server = app.listen(port, () => {
    console.log(`Server is listening on http://localhost:${port}`);
  });
}

// Centralized startup with error handling.
startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

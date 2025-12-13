// routes/reports.js
import express from 'express';
import { requireCsrf } from './auth.js';
import { createReport } from '../data/reports.js';

const router = express.Router();

function ensureLoggedIn(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'You must be logged in to submit a report.' });
}

router.post('/', ensureLoggedIn, requireCsrf, async (req, res, next) => {
  try {
    const { targetType, targetId, text } = req.body || {};

    const createdBy = {
      userId: req.session.user._id,
      username: req.session.user.username
    };

    const report = await createReport({ targetType, targetId, text, createdBy });
    return res.status(201).json({ report });
  } catch (err) {
    return next(err);
  }
});

export default router;

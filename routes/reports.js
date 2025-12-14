// routes/reports.js
import express from 'express';
import { requireCsrf } from './auth.js';
import { createReport ,getReportByReportId,updateReportVotes } from '../data/reports.js';
import {castVote, removeVote, getTotalVotes, getUserVoteForReport} from '../data/votes.js';

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

router.get('/:reportId/votes', async (req, res, next) => 
{
  try
  {
    const reportId = String(req.params.reportId).trim();
    await getReportByReportId(reportId);
    if(!reportId)
    {
      return res.status(400).json({error: "reportId required"});
    }
    const totals = await getTotalVotes(reportId);

    let myVote = 0;
    if(req.session && req.session.user && req.session.user._id)
    {
      myVote = await getUserVoteForReport(reportId, req.session.user._id);
    }
    return res.json({reportId, totals, myVote});
  }
  catch(e)
  {
    return next(e);
  }
});

router.post("/:reportId/vote", ensureLoggedIn, requireCsrf, async(req,res,next) => 
{
  try
  {
    const reportId = String(req.params.reportId).trim();
    if(!reportId)
    {
      return res.status(400).json({error: "reportId is required"});
    }
    await getReportByReportId(reportId);
    const vote = req.body.vote;
    const userId = String(req.session.user._id);

    await castVote({reportId: reportId, userId: userId, vote: vote});

    const totals = await getTotalVotes(reportId);
    await updateReportVotes(reportId, totals);
    const myVote = await getUserVoteForReport(reportId,  userId);
    return res.json({reportId, totals, myVote});
  }
  catch(e)
  {
    return next(e);
  }

});

router.delete("/:reportId/vote", ensureLoggedIn,requireCsrf, async (req, res, next) =>
{
  try
  {
    const reportId = String(req.params.reportId).trim();
    if(!reportId)
    {
      return res.status(400).json({error: "reportId required"});
    }
    const userId = String(req.session.user._id);
    await removeVote(reportId, userId);
    const totals = await getTotalVotes(reportId);
    await updateReportVotes(reportId, totals);
    const myVote = await getUserVoteForReport(reportId, userId);
    return res.json({reportId, totals, myVote});
  }
  catch(e)
  {
    return next(e);
  }

});

export default router;

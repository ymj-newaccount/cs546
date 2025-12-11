import express from "express";
const router = express.Router();

router.route('/home').get(async (req, res) => {
  return res.render('home', {
    title: 'Home'
  });
});

export default router;
const express = require('express');
const db = require('../db/pool');

const router = express.Router();

// GET /api/stats - dashboard totals and the top-5 leaderboard
router.get('/', async (req, res) => {
  const [totals, leaderboard] = await Promise.all([
    db.query(
      `SELECT (SELECT COUNT(*) FROM interns)::int AS "totalInterns",
              (SELECT COUNT(*) FROM projects)::int AS "totalProjects",
              (SELECT COUNT(*) FROM submissions WHERE status = 'submitted')::int AS "pendingReviews",
              (SELECT ROUND(AVG(score), 1) FROM submissions WHERE score IS NOT NULL)::float8 AS "averageScore"`
    ),
    db.query(
      `SELECT i.id, i.name, i.track,
              ROUND(AVG(s.score), 1)::float8 AS "averageScore",
              COUNT(s.score)::int AS "scoredSubmissions"
         FROM interns i
         JOIN submissions s ON s.intern_id = i.id
        WHERE s.score IS NOT NULL
        GROUP BY i.id, i.name, i.track
        ORDER BY "averageScore" DESC, i.name ASC
        LIMIT 5`
    ),
  ]);

  res.json({ ...totals.rows[0], leaderboard: leaderboard.rows });
});

module.exports = router;

const express = require('express');
const { body } = require('express-validator');
const db = require('../db/pool');
const HttpError = require('../utils/httpError');
const { validate, idParam, MAX_INT } = require('../middleware/validate');

const router = express.Router();

const projectRules = [
  body('title')
    .exists({ values: 'null' }).withMessage('Title is required').bail()
    .isString().withMessage('Title must be text').bail()
    .trim()
    .notEmpty().withMessage('Title is required')
    .isLength({ max: 150 }).withMessage('Title must be at most 150 characters'),
  body('description')
    .optional({ values: 'null' })
    .isString().withMessage('Description must be text').bail()
    .trim()
    .isLength({ max: 5000 }).withMessage('Description must be at most 5000 characters'),
  body('max_score')
    .exists({ values: 'null' }).withMessage('Max score is required').bail()
    .isInt({ min: 1, max: MAX_INT }).withMessage('Max score must be a whole number greater than 0')
    .toInt(),
];

const PROJECT_SELECT = `
  SELECT p.id, p.title, p.description, p.max_score,
         COUNT(s.id)::int AS submission_count,
         ROUND(AVG(s.score), 1)::float8 AS average_score
    FROM projects p
    LEFT JOIN submissions s ON s.project_id = p.id`;

// GET /api/projects - with submission count and average score
router.get('/', async (req, res) => {
  const { rows } = await db.query(`${PROJECT_SELECT} GROUP BY p.id ORDER BY p.title`);
  res.json({ data: rows });
});

// GET /api/projects/:id - with the interns assigned to it
router.get('/:id', validate([idParam()]), async (req, res) => {
  const id = req.params.id;
  const { rows } = await db.query(`${PROJECT_SELECT} WHERE p.id = $1 GROUP BY p.id`, [id]);
  if (rows.length === 0) throw new HttpError(404, 'Project not found');

  const { rows: submissions } = await db.query(
    `SELECT s.id, s.intern_id, i.name AS intern_name, s.github_url, s.status, s.score
       FROM submissions s
       JOIN interns i ON i.id = s.intern_id
      WHERE s.project_id = $1
      ORDER BY i.name`,
    [id]
  );
  res.json({ ...rows[0], submissions });
});

// POST /api/projects
router.post('/', validate(projectRules), async (req, res) => {
  const { title, description, max_score: maxScore } = req.body;
  const { rows } = await db.query(
    `INSERT INTO projects (title, description, max_score)
     VALUES ($1, $2, $3)
     RETURNING id, title, description, max_score`,
    [title, description || null, maxScore]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/projects/:id
router.put('/:id', validate([idParam(), ...projectRules]), async (req, res) => {
  const id = req.params.id;
  const { title, description, max_score: maxScore } = req.body;

  const project = await db.withTransaction(async (client) => {
    // Lock the project so no score can be raised past the new max meanwhile.
    const { rowCount } = await client.query('SELECT 1 FROM projects WHERE id = $1 FOR UPDATE', [id]);
    if (rowCount === 0) throw new HttpError(404, 'Project not found');

    const { rows: [{ highest }] } = await client.query(
      'SELECT MAX(score) AS highest FROM submissions WHERE project_id = $1',
      [id]
    );
    if (highest !== null && highest > maxScore) {
      throw new HttpError(422, 'Validation failed', [
        { field: 'max_score', message: `Max score cannot be lower than an existing score (${highest})` },
      ]);
    }

    const { rows } = await client.query(
      `UPDATE projects SET title = $2, description = $3, max_score = $4
        WHERE id = $1
        RETURNING id, title, description, max_score`,
      [id, title, description || null, maxScore]
    );
    return rows[0];
  });

  res.json(project);
});

// DELETE /api/projects/:id - its submissions are removed too (ON DELETE CASCADE)
router.delete('/:id', validate([idParam()]), async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
  if (rowCount === 0) throw new HttpError(404, 'Project not found');
  res.status(204).end();
});

module.exports = router;

const express = require('express');
const { body } = require('express-validator');
const db = require('../db/pool');
const HttpError = require('../utils/httpError');
const { validate, idParam } = require('../middleware/validate');

const router = express.Router();

const mentorRules = [
  body('name')
    .exists({ values: 'null' }).withMessage('Name is required').bail()
    .isString().withMessage('Name must be text').bail()
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ max: 100 }).withMessage('Name must be at most 100 characters'),
  body('email')
    .exists({ values: 'null' }).withMessage('Email is required').bail()
    .isString().withMessage('Email must be text').bail()
    .trim()
    .toLowerCase()
    .isEmail().withMessage('Email must be a valid email address')
    .isLength({ max: 150 }).withMessage('Email must be at most 150 characters'),
];

// GET /api/mentors - with how many interns each one mentors
router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT m.id, m.name, m.email, COUNT(i.id)::int AS intern_count
       FROM mentors m
       LEFT JOIN interns i ON i.mentor_id = m.id
      GROUP BY m.id
      ORDER BY m.name`
  );
  res.json({ data: rows });
});

// GET /api/mentors/:id - with their interns
router.get('/:id', validate([idParam()]), async (req, res) => {
  const id = req.params.id;
  const { rows } = await db.query('SELECT id, name, email FROM mentors WHERE id = $1', [id]);
  if (rows.length === 0) throw new HttpError(404, 'Mentor not found');

  const { rows: interns } = await db.query(
    'SELECT id, name, email, track FROM interns WHERE mentor_id = $1 ORDER BY name',
    [id]
  );
  res.json({ ...rows[0], interns });
});

// POST /api/mentors
router.post('/', validate(mentorRules), async (req, res) => {
  const { rows } = await db.query(
    'INSERT INTO mentors (name, email) VALUES ($1, $2) RETURNING id, name, email',
    [req.body.name, req.body.email]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/mentors/:id
router.put('/:id', validate([idParam(), ...mentorRules]), async (req, res) => {
  const { rows } = await db.query(
    'UPDATE mentors SET name = $2, email = $3 WHERE id = $1 RETURNING id, name, email',
    [req.params.id, req.body.name, req.body.email]
  );
  if (rows.length === 0) throw new HttpError(404, 'Mentor not found');
  res.json(rows[0]);
});

// DELETE /api/mentors/:id - their interns stay, with mentor_id set to NULL
router.delete('/:id', validate([idParam()]), async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM mentors WHERE id = $1', [req.params.id]);
  if (rowCount === 0) throw new HttpError(404, 'Mentor not found');
  res.status(204).end();
});

module.exports = router;

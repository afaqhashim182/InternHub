const express = require('express');
const { body } = require('express-validator');
const db = require('../db/pool');
const HttpError = require('../utils/httpError');
const { validate, idParam, requireSomeFields, pickPresent, MAX_INT } = require('../middleware/validate');

const router = express.Router();

const STATUSES = ['pending', 'submitted', 'reviewed'];
const PATCHABLE = ['status', 'score', 'github_url'];

const githubUrlRule = () =>
  body('github_url')
    .optional({ values: 'falsy' })
    .isString().withMessage('GitHub URL must be text').bail()
    .trim()
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('GitHub URL must be a valid http(s) URL');

const statusRule = () =>
  body('status')
    .optional()
    .isString().withMessage('Status must be text').bail()
    .isIn(STATUSES).withMessage(`Status must be one of: ${STATUSES.join(', ')}`);

/** A submission joined with its project and intern names; null if missing. */
async function findSubmission(id) {
  const { rows } = await db.query(
    `SELECT s.id, s.intern_id, i.name AS intern_name,
            s.project_id, p.title AS project_title, p.max_score,
            s.github_url, s.status, s.score
       FROM submissions s
       JOIN projects p ON p.id = s.project_id
       JOIN interns i ON i.id = s.intern_id
      WHERE s.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

// POST /api/submissions - assign a project to an intern
router.post(
  '/',
  validate([
    body('intern_id')
      .exists({ values: 'null' }).withMessage('Intern is required').bail()
      .isInt({ min: 1, max: MAX_INT }).withMessage('intern_id must be a positive integer')
      .toInt(),
    body('project_id')
      .exists({ values: 'null' }).withMessage('Project is required').bail()
      .isInt({ min: 1, max: MAX_INT }).withMessage('project_id must be a positive integer')
      .toInt(),
    githubUrlRule(),
    statusRule(),
  ]),
  async (req, res) => {
    const { intern_id: internId, project_id: projectId, github_url: githubUrl, status } = req.body;
    // A UNIQUE (intern_id, project_id) violation becomes 409, a missing intern/project 422.
    const { rows } = await db.query(
      `INSERT INTO submissions (intern_id, project_id, github_url, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [internId, projectId, githubUrl || null, status ?? 'pending']
    );
    res.status(201).json(await findSubmission(rows[0].id));
  }
);

// PATCH /api/submissions/:id - update status, score and/or github_url
router.patch(
  '/:id',
  validate([
    idParam(),
    requireSomeFields(PATCHABLE),
    statusRule(),
    body('score')
      .optional({ values: 'null' })
      .isInt({ min: 0, max: MAX_INT }).withMessage('Score must be a whole number of 0 or more')
      .toInt(),
    githubUrlRule(),
  ]),
  async (req, res) => {
    const id = req.params.id;
    const fields = pickPresent(req.body, PATCHABLE);

    await db.withTransaction(async (client) => {
      // FOR SHARE on the project blocks a concurrent max_score change until we commit.
      const { rows } = await client.query(
        `SELECT p.max_score
           FROM submissions s
           JOIN projects p ON p.id = s.project_id
          WHERE s.id = $1
            FOR SHARE OF p`,
        [id]
      );
      if (rows.length === 0) throw new HttpError(404, 'Submission not found');

      const maxScore = rows[0].max_score;
      if (fields.score != null && fields.score > maxScore) {
        throw new HttpError(422, 'Validation failed', [
          { field: 'score', message: `Score cannot exceed the project's max score of ${maxScore}` },
        ]);
      }

      const columns = PATCHABLE.filter((c) => Object.hasOwn(fields, c));
      const assignments = columns.map((c, i) => `${c} = $${i + 2}`);
      await client.query(
        `UPDATE submissions SET ${assignments.join(', ')} WHERE id = $1`,
        [id, ...columns.map((c) => fields[c])]
      );
    });

    res.json(await findSubmission(id));
  }
);

// DELETE /api/submissions/:id - unassign
router.delete('/:id', validate([idParam()]), async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM submissions WHERE id = $1', [req.params.id]);
  if (rowCount === 0) throw new HttpError(404, 'Submission not found');
  res.status(204).end();
});

module.exports = router;

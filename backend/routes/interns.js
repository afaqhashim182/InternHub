const express = require('express');
const { body, query, matchedData } = require('express-validator');
const db = require('../db/pool');
const HttpError = require('../utils/httpError');
const { validate, idParam, requireSomeFields, pickPresent, MAX_INT } = require('../middleware/validate');

const router = express.Router();

const TRACKS = ['frontend', 'backend', 'fullstack'];

// Whitelists of writable columns. Dynamic SQL (PATCH, profile upsert) is only
// ever built from these names - never from keys supplied by the client.
const INTERN_COLUMNS = ['name', 'email', 'phone', 'track', 'mentor_id'];
const PROFILE_COLUMNS = ['bio', 'linkedin_url'];
const WRITABLE = [...INTERN_COLUMNS, ...PROFILE_COLUMNS];

/**
 * Body rules shared by POST/PUT (partial = false: required fields must exist)
 * and PATCH (partial = true: every field optional, but validated if present).
 */
function internRules({ partial }) {
  const required = (field, label) =>
    partial
      ? body(field).optional()
      : body(field).exists({ values: 'null' }).withMessage(`${label} is required`).bail();

  return [
    required('name', 'Name')
      .isString().withMessage('Name must be text').bail()
      .trim()
      .notEmpty().withMessage('Name is required')
      .isLength({ max: 100 }).withMessage('Name must be at most 100 characters'),
    required('email', 'Email')
      .isString().withMessage('Email must be text').bail()
      .trim()
      .toLowerCase()
      .isEmail().withMessage('Email must be a valid email address')
      .isLength({ max: 150 }).withMessage('Email must be at most 150 characters'),
    body('phone')
      .optional({ values: 'falsy' })
      .isString().withMessage('Phone must be text').bail()
      .trim()
      .matches(/^\+?[0-9\s().-]{6,19}$/).withMessage('Phone may contain digits, spaces, + ( ) - and be at most 20 characters'),
    required('track', 'Track')
      .isString().withMessage('Track must be text').bail()
      .isIn(TRACKS).withMessage(`Track must be one of: ${TRACKS.join(', ')}`),
    body('mentor_id')
      .optional({ values: 'null' })
      .isInt({ min: 1, max: MAX_INT }).withMessage('mentor_id must be a positive integer')
      .toInt(),
    body('bio')
      .optional({ values: 'null' })
      .isString().withMessage('Bio must be text').bail()
      .isLength({ max: 2000 }).withMessage('Bio must be at most 2000 characters'),
    body('linkedin_url')
      .optional({ values: 'falsy' })
      .isString().withMessage('LinkedIn URL must be text').bail()
      .trim()
      .isURL({ protocols: ['http', 'https'], require_protocol: true })
      .withMessage('LinkedIn URL must be a valid http(s) URL'),
  ];
}

/** Escape LIKE wildcards so a search for "50%" matches literally. */
const escapeLike = (text) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** One intern with mentor + profile (JOINs) and their submissions; null if missing. */
async function findIntern(id) {
  const { rows } = await db.query(
    `SELECT i.id, i.name, i.email, i.phone, i.track, i.mentor_id, i.created_at,
            CASE WHEN m.id IS NULL THEN NULL
                 ELSE json_build_object('id', m.id, 'name', m.name, 'email', m.email) END AS mentor,
            CASE WHEN p.id IS NULL THEN NULL
                 ELSE json_build_object('bio', p.bio, 'linkedin_url', p.linkedin_url) END AS profile
       FROM interns i
       LEFT JOIN mentors m ON m.id = i.mentor_id
       LEFT JOIN intern_profiles p ON p.intern_id = i.id
      WHERE i.id = $1`,
    [id]
  );
  if (rows.length === 0) return null;

  const { rows: submissions } = await db.query(
    `SELECT s.id, s.project_id, pr.title AS project_title, pr.max_score,
            s.github_url, s.status, s.score
       FROM submissions s
       JOIN projects pr ON pr.id = s.project_id
      WHERE s.intern_id = $1
      ORDER BY pr.title`,
    [id]
  );
  return { ...rows[0], submissions };
}

/**
 * Insert or update the intern's 1:1 profile with whichever whitelisted
 * profile columns are present in `fields`.
 */
async function upsertProfile(client, internId, fields) {
  const columns = PROFILE_COLUMNS.filter((c) => Object.hasOwn(fields, c));
  if (columns.length === 0) return;

  const placeholders = columns.map((_, i) => `$${i + 2}`);
  const updates = columns.map((c) => `${c} = EXCLUDED.${c}`);
  await client.query(
    `INSERT INTO intern_profiles (intern_id, ${columns.join(', ')})
     VALUES ($1, ${placeholders.join(', ')})
     ON CONFLICT (intern_id) DO UPDATE SET ${updates.join(', ')}`,
    [internId, ...columns.map((c) => fields[c])]
  );
}

// GET /api/interns?track=&search=&page=&limit=
router.get(
  '/',
  validate([
    query('track').optional({ values: 'falsy' }).isString().bail()
      .isIn(TRACKS).withMessage(`track must be one of: ${TRACKS.join(', ')}`),
    query('search').optional({ values: 'falsy' }).isString().bail().trim()
      .isLength({ max: 100 }).withMessage('search must be at most 100 characters'),
    query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('page must be a positive integer').toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100').toInt(),
  ]),
  async (req, res) => {
    const { track, search, page = 1, limit = 10 } = matchedData(req, { locations: ['query'] });

    // Only fixed SQL fragments and $n placeholders are concatenated here;
    // every user-supplied value travels separately in `params`.
    const conditions = [];
    const params = [];
    if (track) {
      params.push(track);
      conditions.push(`i.track = $${params.length}`);
    }
    if (search) {
      params.push(`%${escapeLike(search)}%`);
      conditions.push(`(i.name ILIKE $${params.length} OR i.email ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countResult, dataResult] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total FROM interns i ${where}`, params),
      db.query(
        `SELECT i.id, i.name, i.email, i.phone, i.track, i.mentor_id, i.created_at,
                m.name AS mentor_name
           FROM interns i
           LEFT JOIN mentors m ON m.id = i.mentor_id
           ${where}
          ORDER BY i.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit]
      ),
    ]);

    res.json({ data: dataResult.rows, page, limit, total: countResult.rows[0].total });
  }
);

// GET /api/interns/:id
router.get('/:id', validate([idParam()]), async (req, res) => {
  const intern = await findIntern(req.params.id);
  if (!intern) throw new HttpError(404, 'Intern not found');
  res.json(intern);
});

// POST /api/interns
router.post('/', validate(internRules({ partial: false })), async (req, res) => {
  const data = pickPresent(req.body, WRITABLE);

  const id = await db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO interns (name, email, phone, track, mentor_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [data.name, data.email, data.phone ?? null, data.track, data.mentor_id ?? null]
    );
    // Only create a profile row when there is something to store.
    const profile = pickPresent(data, PROFILE_COLUMNS);
    for (const key of Object.keys(profile)) if (profile[key] === null) delete profile[key];
    await upsertProfile(client, rows[0].id, profile);
    return rows[0].id;
  });

  res.status(201).json(await findIntern(id));
});

// PUT /api/interns/:id - replaces the whole record (omitted optional fields become null)
router.put('/:id', validate([idParam(), ...internRules({ partial: false })]), async (req, res) => {
  const id = req.params.id;
  const data = pickPresent(req.body, WRITABLE);

  const found = await db.withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE interns
          SET name = $2, email = $3, phone = $4, track = $5, mentor_id = $6
        WHERE id = $1`,
      [id, data.name, data.email, data.phone ?? null, data.track, data.mentor_id ?? null]
    );
    if (rowCount === 0) return false;

    const bio = data.bio ?? null;
    const linkedinUrl = data.linkedin_url ?? null;
    if (bio === null && linkedinUrl === null) {
      await client.query('DELETE FROM intern_profiles WHERE intern_id = $1', [id]);
    } else {
      await upsertProfile(client, id, { bio, linkedin_url: linkedinUrl });
    }
    return true;
  });

  if (!found) throw new HttpError(404, 'Intern not found');
  res.json(await findIntern(id));
});

// PATCH /api/interns/:id - updates only the fields sent
router.patch(
  '/:id',
  validate([idParam(), requireSomeFields(WRITABLE), ...internRules({ partial: true })]),
  async (req, res) => {
    const id = req.params.id;
    const fields = pickPresent(req.body, WRITABLE);
    const internColumns = INTERN_COLUMNS.filter((c) => Object.hasOwn(fields, c));

    const found = await db.withTransaction(async (client) => {
      let rowCount;
      if (internColumns.length > 0) {
        const assignments = internColumns.map((c, i) => `${c} = $${i + 2}`);
        ({ rowCount } = await client.query(
          `UPDATE interns SET ${assignments.join(', ')} WHERE id = $1`,
          [id, ...internColumns.map((c) => fields[c])]
        ));
      } else {
        ({ rowCount } = await client.query('SELECT 1 FROM interns WHERE id = $1 FOR UPDATE', [id]));
      }
      if (rowCount === 0) return false;

      await upsertProfile(client, id, pickPresent(fields, PROFILE_COLUMNS));
      return true;
    });

    if (!found) throw new HttpError(404, 'Intern not found');
    res.json(await findIntern(id));
  }
);

// DELETE /api/interns/:id - profile and submissions go too (ON DELETE CASCADE)
router.delete('/:id', validate([idParam()]), async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM interns WHERE id = $1', [req.params.id]);
  if (rowCount === 0) throw new HttpError(404, 'Intern not found');
  res.status(204).end();
});

module.exports = router;

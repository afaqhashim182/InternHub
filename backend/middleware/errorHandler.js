const HttpError = require('../utils/httpError');

// Postgres SQLSTATE -> HTTP status + fallback message
const PG_ERRORS = {
  '23505': { status: 409, message: 'A record with this value already exists' }, // unique_violation
  '23503': { status: 422, message: 'A referenced record does not exist' },      // foreign_key_violation
  '23514': { status: 422, message: 'A value breaks a data rule' },              // check_violation
  '22001': { status: 422, message: 'A value is too long' },                     // string_data_right_truncation
};

// Friendly, field-level messages for the named constraints in schema.sql
const CONSTRAINTS = {
  mentors_email_key: { field: 'email', message: 'A mentor with this email already exists' },
  interns_email_key: { field: 'email', message: 'An intern with this email already exists' },
  projects_title_key: { field: 'title', message: 'A project with this title already exists' },
  submissions_intern_id_project_id_key: { field: 'project_id', message: 'This project is already assigned to this intern' },
  interns_mentor_id_fkey: { field: 'mentor_id', message: 'Selected mentor does not exist' },
  submissions_intern_id_fkey: { field: 'intern_id', message: 'Intern does not exist' },
  submissions_project_id_fkey: { field: 'project_id', message: 'Project does not exist' },
  interns_track_check: { field: 'track', message: 'Track must be frontend, backend or fullstack' },
  projects_max_score_check: { field: 'max_score', message: 'Max score must be greater than 0' },
  submissions_status_check: { field: 'status', message: 'Status must be pending, submitted or reviewed' },
  submissions_score_check: { field: 'score', message: 'Score cannot be negative' },
};

function toResponse(err) {
  if (err instanceof HttpError) {
    return { status: err.status, message: err.message, details: err.details };
  }
  if (err.type === 'entity.parse.failed') {
    return { status: 400, message: 'Request body is not valid JSON' };
  }
  if (err.type === 'entity.too.large') {
    return { status: 413, message: 'Request body is too large' };
  }
  const pg = PG_ERRORS[err.code];
  if (pg) {
    const known = CONSTRAINTS[err.constraint];
    return {
      status: pg.status,
      message: known ? known.message : pg.message,
      details: known ? [known] : undefined,
    };
  }
  if (err.code === 'ECONNREFUSED' || err.code === '57P01' || err.code === '3D000') {
    return { status: 503, message: 'Database is unavailable, please try again shortly' };
  }
  return { status: 500, message: 'Internal server error' };
}

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
function errorHandler(err, req, res, next) {
  const { status, message, details } = toResponse(err);

  // Full detail (stack, SQL error) stays in the server log, never in the response.
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  } else if (err.code) {
    console.warn(`[db] ${req.method} ${req.originalUrl} -> ${status} (${err.code} ${err.constraint || ''})`);
  }

  const error = { status, message };
  if (details && details.length) error.details = details;
  res.status(status).json({ error });
}

module.exports = errorHandler;

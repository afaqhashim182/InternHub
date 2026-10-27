const { validationResult, param, body } = require('express-validator');
const HttpError = require('../utils/httpError');

const MAX_INT = 2147483647; // PostgreSQL INT upper bound

/**
 * Wraps express-validator chains: runs them, then turns any failures into a
 * 422 HttpError whose details are [{ field, message }].
 */
function validate(rules) {
  return [
    ...rules,
    (req, res, next) => {
      const result = validationResult(req);
      if (result.isEmpty()) return next();
      const details = result
        .array({ onlyFirstError: true })
        .map((e) => ({ field: e.path || null, message: e.msg }));
      next(new HttpError(422, 'Validation failed', details));
    },
  ];
}

/** Route param that must be a positive integer within INT range. */
const idParam = (name = 'id') =>
  param(name)
    .isInt({ min: 1, max: MAX_INT, allow_leading_zeroes: false })
    .withMessage(`${name} must be a positive integer`)
    .toInt();

/** Body must contain at least one of `fields` (used by PATCH). */
const requireSomeFields = (fields) =>
  body()
    .custom((value) => value !== null && typeof value === 'object' && fields.some((f) => Object.hasOwn(value, f)))
    .withMessage(`Provide at least one of: ${fields.join(', ')}`);

/**
 * Copy the whitelisted `columns` that are present in `source`.
 * Empty strings become null so optional columns can be cleared.
 */
function pickPresent(source, columns) {
  const out = {};
  for (const column of columns) {
    if (source && Object.hasOwn(source, column)) {
      out[column] = source[column] === '' ? null : source[column];
    }
  }
  return out;
}

module.exports = { validate, idParam, requireSomeFields, pickPresent, MAX_INT };

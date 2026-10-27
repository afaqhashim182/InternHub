const HttpError = require('../utils/httpError');

/** Catch-all for routes that matched nothing: forwards a JSON 404. */
function notFound(req, res, next) {
  next(new HttpError(404, `Route ${req.method} ${req.path} not found`));
}

module.exports = notFound;

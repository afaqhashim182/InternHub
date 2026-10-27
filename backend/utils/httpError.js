/**
 * An error that maps directly to an HTTP response.
 * `details` is an optional array of { field, message } for field-level problems.
 */
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

module.exports = HttpError;

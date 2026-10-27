const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const db = require('./db/pool');
const HttpError = require('./utils/httpError');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const PORT = Number(process.env.PORT) || 3000;
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  console.warn('[cors] FRONTEND_ORIGIN is empty - browsers will be blocked from calling the API.');
}

const app = express();
app.disable('x-powered-by');

// Only the configured frontend origin(s) may call the API. The cors middleware
// also answers OPTIONS preflights, which browsers send before PUT/PATCH/DELETE
// and before any request with a JSON body.
app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  })
);

// JSON only: write requests that carry a body must declare it as JSON.
app.use((req, res, next) => {
  const hasBody = Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'];
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && hasBody && !req.is('application/json')) {
    return next(new HttpError(415, 'Content-Type must be application/json'));
  }
  next();
});
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/interns', require('./routes/interns'));
app.use('/api/mentors', require('./routes/mentors'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/submissions', require('./routes/submissions'));
app.use('/api/stats', require('./routes/stats'));

app.use(notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`InternHub API listening on http://localhost:${PORT}/api`);
  console.log(`CORS allowed origin(s): ${allowedOrigins.join(', ') || '(none)'}`);
});

function shutdown() {
  server.close(() => db.pool.end().finally(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

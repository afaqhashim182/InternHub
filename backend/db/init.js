// Creates the schema and loads seed data: `npm run db:init`
const fs = require('fs/promises');
const path = require('path');
const db = require('./pool');

async function main() {
  const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  const seed = await fs.readFile(path.join(__dirname, 'seed.sql'), 'utf8');

  // These files are trusted, static SQL (no user input), so running them as
  // multi-statement scripts is safe. Both run in one transaction: all or nothing.
  await db.withTransaction(async (client) => {
    await client.query(schema);
    await client.query(seed);
  });

  const { rows } = await db.query(`
    SELECT (SELECT COUNT(*) FROM mentors)::int     AS mentors,
           (SELECT COUNT(*) FROM interns)::int     AS interns,
           (SELECT COUNT(*) FROM projects)::int    AS projects,
           (SELECT COUNT(*) FROM submissions)::int AS submissions`);
  console.log('Database initialised:', rows[0]);
}

main()
  .catch((err) => {
    console.error('db:init failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());

# InternHub — Intern & Project Tracker

InternHub is a small full-stack app where **mentors manage interns, assign projects and score submissions**.

- **Backend:** Node.js + Express 5 (CommonJS), PostgreSQL via the `pg` driver with raw, parameterized SQL (no ORM), `express-validator`
- **Frontend:** plain HTML, CSS and JavaScript (ES modules, no framework, no build step), served separately from the API

---

## How the project maps to the learning goals

### Phase 1: Database integration

| Goal | Where it is in the project |
|---|---|
| **Schema design** | [`backend/db/schema.sql`](backend/db/schema.sql) has 5 normalized tables covering 1:1, 1:Many and Many:Many relationships, plus indexes on every foreign key used in JOINs and filters. |
| **CRUD** | Interns, mentors and projects have full GET / POST / PUT / DELETE. Interns also have PATCH. Submissions have POST / PATCH / DELETE. See the [endpoint table](#rest-api). |
| **Data integrity** | `NOT NULL`, `UNIQUE`, `CHECK` (track, status, `max_score > 0`, `score >= 0`), foreign keys with `ON DELETE CASCADE` / `SET NULL`, and `UNIQUE (intern_id, project_id)`. Multi-step writes run in transactions (`withTransaction` in [`db/pool.js`](backend/db/pool.js)). A rule the schema cannot express (`score <= project.max_score`) is enforced in the API under a row lock (`FOR SHARE` / `FOR UPDATE`), so concurrent edits can't slip past it. |
| **Security** | Every query uses `$1, $2…` placeholders. Dynamic SQL (filters, PATCH, profile upsert) is built only from **whitelisted column names**, and values always travel as parameters. All input is validated (types, required fields, email format, enums, positive-int ids, URL protocols). Postgres errors are mapped to clean 409/422 responses. Stack traces and SQL never reach the client. |

### Phase 2: Frontend–backend integration

| Goal | Where it is in the project |
|---|---|
| **API integration** | [`frontend/js/api.js`](frontend/js/api.js) has one `request()` wrapper around `fetch` that every page uses. CORS is restricted to `FRONTEND_ORIGIN`. |
| **Async requests** | async/await throughout. The dashboard loads `/stats`, `/interns`, `/projects` (and `/mentors` for the form) **in parallel with `Promise.all`**. Debounced search uses an `AbortController`, so a slow old response can never overwrite a newer one. |
| **Error handling** | The server returns a consistent `{ error: { status, message, details? } }` shape. The client throws `ApiError(status, message, details)`. 422/409 errors appear **next to the relevant form field**; other errors appear as toasts. Every data view has loading, empty and error-with-Retry states, and the spinner is hidden in `finally`. |
| **Full-stack flow** | Form → validation → `request()` → Express validation → parameterized SQL → Postgres constraint → mapped HTTP status → UI field error or refreshed view, with no page reload. |
| **XSS safety** | All API/user data is rendered with `createElement` + `textContent` (helper `el()` in [`ui.js`](frontend/js/ui.js)). `innerHTML` is never used. Links are only made clickable when they are `http(s)` URLs. |

---

## Entity-relationship model

```
┌───────────┐ 1      * ┌──────────────┐ 1      1 ┌──────────────────┐
│  mentors  │──────────│   interns    │──────────│ intern_profiles  │
│───────────│          │──────────────│          │──────────────────│
│ id PK     │          │ id PK        │          │ id PK            │
│ name      │          │ name         │          │ intern_id FK UQ  │
│ email UQ  │          │ email UQ     │          │ bio              │
└───────────┘          │ phone        │          │ linkedin_url     │
                       │ track CHECK  │          └──────────────────┘
                       │ mentor_id FK │
                       │ created_at   │
                       └──────┬───────┘
                              │ 1
                              │
                              │ *
                       ┌──────┴────────────┐ *      1 ┌──────────────────┐
                       │   submissions     │──────────│    projects      │
                       │───────────────────│          │──────────────────│
                       │ id PK             │          │ id PK            │
                       │ intern_id FK      │          │ title UQ         │
                       │ project_id FK     │          │ description      │
                       │ github_url        │          │ max_score CHECK  │
                       │ status CHECK      │          └──────────────────┘
                       │ score CHECK       │
                       │ UQ(intern_id,     │
                       │    project_id)    │
                       └───────────────────┘
```

- **mentors → interns: 1 : Many.** `interns.mentor_id` references `mentors.id`. Deleting a mentor keeps their interns and sets `mentor_id` to `NULL` (`ON DELETE SET NULL`).
- **interns → intern_profiles: 1 : 1.** `intern_profiles.intern_id` is `UNIQUE NOT NULL`, so each intern has at most one profile. Deleting the intern deletes the profile (`CASCADE`).
- **interns ↔ projects: Many : Many** through `submissions`. `UNIQUE (intern_id, project_id)` stops the same project being assigned to an intern twice. Deleting an intern or a project removes its submissions (`CASCADE`).
- **Indexes:** `interns(mentor_id)`, `submissions(intern_id)`, `submissions(project_id)`.

**Seed data** ([`seed.sql`](backend/db/seed.sql)): 3 mentors, 10 interns across all three tracks, 6 profiles, 4 projects and 15 submissions with mixed statuses and scores.

---

## Setup

### Prerequisites
- Node.js 20+ (LTS)
- PostgreSQL 14+ installed locally, **or** Docker (a `docker-compose.yml` with `postgres:16` is included)

### 1. Start PostgreSQL

**With Docker:**
```bash
docker compose up -d        # from the internhub/ folder
```
This creates database `internhub`, user `internhub` and password `internhub` on port 5432.

**With a local install:** create a matching user and database:
```sql
CREATE USER internhub WITH PASSWORD 'internhub';
CREATE DATABASE internhub OWNER internhub;
```

### 2. Install and configure the backend
```bash
cd backend
npm install
cp .env.example .env        # Windows: copy .env.example .env
```
`.env` settings:

| Variable | Example | Purpose |
|---|---|---|
| `PORT` | `3000` | API port |
| `DATABASE_URL` | `postgres://internhub:internhub@localhost:5432/internhub` | Postgres connection |
| `FRONTEND_ORIGIN` | `http://127.0.0.1:5500,http://localhost:5500` | Origins allowed by CORS (comma-separated) |

### 3. Create the schema and seed data
```bash
npm run db:init             # runs db/schema.sql + db/seed.sql in one transaction (safe to re-run)
```

### 4. Run the API
```bash
npm run dev                 # nodemon, restarts on file changes
# or
npm start
```
The API is now at `http://localhost:3000/api`. Check it with `curl http://localhost:3000/api/health`.

### 5. Run the frontend
Serve the `frontend/` folder on port **5500**. Opening the HTML files with `file://` does not work, because ES modules and CORS need an HTTP origin.

- **VS Code Live Server:** right-click `frontend/index.html`, then choose **Open with Live Server**.
- **Or any static server:** `npx http-server frontend -p 5500 -c-1`, then open http://127.0.0.1:5500.

If the API runs somewhere else, change `API_BASE_URL` in [`frontend/js/config.js`](frontend/js/config.js). If the frontend uses a different origin, add it to `FRONTEND_ORIGIN`.

### Pages
| Page | What it does |
|---|---|
| `index.html` | Stat cards, leaderboard, projects overview and the interns table, with track filter, debounced search and pagination. You can add an intern (POST), edit one (PUT), quick-edit a phone number inline (PATCH), or delete with an in-page confirm. |
| `intern.html?id=1` | Intern details, mentor and profile. You can assign a project (POST) and update its status, score or GitHub URL (PATCH), or unassign it (DELETE). |
| `projects.html` | Full project CRUD in a table plus a modal form. |

---

## REST API

Base path is `/api`. All requests and responses are JSON. Every error response has this shape:

```json
{ "error": { "status": 422, "message": "Validation failed",
             "details": [ { "field": "email", "message": "Email must be a valid email address" } ] } }
```

| Method | Path | Description | Success | Errors |
|---|---|---|---|---|
| GET | `/api/interns?track=&search=&page=&limit=` | Paginated list (filter by track, search name/email) → `{ data, page, limit, total }` | 200 | 422 |
| GET | `/api/interns/:id` | Intern with mentor, profile and submissions (JOINs) | 200 | 404, 422 |
| POST | `/api/interns` | Create intern (+ optional `bio`, `linkedin_url`) | 201 | 409, 422 |
| PUT | `/api/interns/:id` | Replace the full record (omitted optional fields become `null`) | 200 | 404, 409, 422 |
| PATCH | `/api/interns/:id` | Partial update, e.g. `{ "phone": "…" }` | 200 | 404, 409, 422 |
| DELETE | `/api/interns/:id` | Delete (profile and submissions cascade) | 204 | 404, 422 |
| GET | `/api/mentors` | List with `intern_count` → `{ data }` | 200 | |
| GET | `/api/mentors/:id` | Mentor with their interns | 200 | 404, 422 |
| POST | `/api/mentors` | Create mentor | 201 | 409, 422 |
| PUT | `/api/mentors/:id` | Replace mentor | 200 | 404, 409, 422 |
| DELETE | `/api/mentors/:id` | Delete (their interns get `mentor_id = null`) | 204 | 404, 422 |
| GET | `/api/projects` | List with `submission_count`, `average_score` → `{ data }` | 200 | |
| GET | `/api/projects/:id` | Project with its submissions | 200 | 404, 422 |
| POST | `/api/projects` | Create project | 201 | 409, 422 |
| PUT | `/api/projects/:id` | Replace project (`max_score` can't go below an existing score) | 200 | 404, 409, 422 |
| DELETE | `/api/projects/:id` | Delete (submissions cascade) | 204 | 404, 422 |
| POST | `/api/submissions` | Assign a project to an intern | 201 | 409 (already assigned), 422 |
| PATCH | `/api/submissions/:id` | Update `status`, `score`, `github_url` (score ≤ project's `max_score`) | 200 | 404, 422 |
| DELETE | `/api/submissions/:id` | Unassign | 204 | 404, 422 |
| GET | `/api/stats` | `{ totalInterns, totalProjects, pendingReviews, averageScore, leaderboard }` | 200 | |
| GET | `/api/health` | Liveness check | 200 | |
| any | unknown route | JSON 404 | | 404 |

**Status code meanings**
- 400: malformed JSON body
- 404: record or route not found
- 409: duplicate value (Postgres `23505`)
- 413: body too large
- 415: body is not `application/json`
- 422: validation failed, missing foreign key (`23503`) or check violation (`23514`)
- 500: unexpected error (details are logged on the server only)
- 503: database unreachable

**Stats definitions**
- `pendingReviews`: submissions with status `submitted` (handed in, awaiting a mentor's review).
- `averageScore`: `AVG(score)` over all scored submissions.
- `leaderboard`: top 5 interns by `AVG(score)`, computed with `GROUP BY`.

---

## Example curl commands

Bash syntax is shown. In Windows PowerShell, use `curl.exe` and put the JSON in a file (`--data-binary @body.json`) to avoid quoting problems.

```bash
API=http://localhost:3000/api

# ---------- Interns ----------
curl "$API/interns"
curl "$API/interns?track=frontend&search=ali&page=1&limit=5"
curl "$API/interns/1"
curl -X POST "$API/interns" -H "Content-Type: application/json" \
  -d '{"name":"Grace Hopper","email":"grace@example.com","phone":"+1 555 0100","track":"backend","mentor_id":2,"bio":"COBOL pioneer","linkedin_url":"https://linkedin.com/in/grace"}'
curl -X PUT "$API/interns/11" -H "Content-Type: application/json" \
  -d '{"name":"Grace B. Hopper","email":"grace@example.com","track":"fullstack","mentor_id":null}'
curl -X PATCH "$API/interns/11" -H "Content-Type: application/json" -d '{"phone":"+44 20 7946 0000"}'
curl -X DELETE "$API/interns/11" -i

# ---------- Mentors ----------
curl "$API/mentors"
curl "$API/mentors/1"
curl -X POST "$API/mentors" -H "Content-Type: application/json" -d '{"name":"Ada Lovelace","email":"ada@internhub.dev"}'
curl -X PUT "$API/mentors/4" -H "Content-Type: application/json" -d '{"name":"Ada King","email":"ada.king@internhub.dev"}'
curl -X DELETE "$API/mentors/4" -i

# ---------- Projects ----------
curl "$API/projects"
curl "$API/projects/1"
curl -X POST "$API/projects" -H "Content-Type: application/json" -d '{"title":"Testing Basics","description":"Unit tests","max_score":10}'
curl -X PUT "$API/projects/5" -H "Content-Type: application/json" -d '{"title":"Testing Basics","description":null,"max_score":20}'
curl -X DELETE "$API/projects/5" -i

# ---------- Submissions ----------
curl -X POST "$API/submissions" -H "Content-Type: application/json" -d '{"intern_id":9,"project_id":1}'
curl -X PATCH "$API/submissions/16" -H "Content-Type: application/json" \
  -d '{"status":"reviewed","score":85,"github_url":"https://github.com/noah/portfolio"}'
curl -X DELETE "$API/submissions/16" -i

# ---------- Stats ----------
curl "$API/stats"

# ---------- Failure cases ----------
curl -X POST "$API/interns" -H "Content-Type: application/json" \
  -d '{"name":"Dup","email":"ali.raza@example.com","track":"backend"}'              # 409 duplicate email
curl -X POST "$API/interns" -H "Content-Type: application/json" \
  -d '{"name":"Bad","email":"bad@example.com","track":"design"}'                   # 422 invalid track
curl -X PATCH "$API/submissions/1" -H "Content-Type: application/json" -d '{"score":150}'  # 422 score > max_score
curl "$API/interns/9999"                                                           # 404 not found
curl "$API/does-not-exist"                                                         # 404 unknown route
curl "$API/interns?search=%27%20OR%201%3D1%20--"                                   # SQL injection -> plain text, 0 results
```

---

## Project structure

```
internhub/
├── backend/
│   ├── db/            schema.sql, seed.sql, pool.js (pool + transaction helper), init.js
│   ├── routes/        interns.js, mentors.js, projects.js, submissions.js, stats.js
│   ├── middleware/    validate.js, errorHandler.js (PG error mapping), notFound.js
│   ├── utils/         httpError.js
│   ├── server.js      CORS, JSON parsing, routes, 404 + error middleware
│   └── .env.example
├── frontend/
│   ├── index.html, intern.html, projects.html
│   ├── css/style.css
│   └── js/            config.js, api.js (request + ApiError), ui.js (DOM/view helpers),
│                      dashboard.js, intern.js, projects.js
├── docker-compose.yml
└── README.md
```

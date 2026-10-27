-- InternHub schema. Re-runnable: drops and recreates every table.

DROP TABLE IF EXISTS submissions CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS intern_profiles CASCADE;
DROP TABLE IF EXISTS interns CASCADE;
DROP TABLE IF EXISTS mentors CASCADE;

-- 1 mentor : many interns
CREATE TABLE mentors (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL
);

CREATE TABLE interns (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  phone VARCHAR(20),
  track VARCHAR(20) NOT NULL CHECK (track IN ('frontend','backend','fullstack')),
  mentor_id INT REFERENCES mentors(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 1 intern : 1 profile (UNIQUE intern_id enforces the 1:1)
CREATE TABLE intern_profiles (
  id SERIAL PRIMARY KEY,
  intern_id INT UNIQUE NOT NULL REFERENCES interns(id) ON DELETE CASCADE,
  bio TEXT,
  linkedin_url TEXT
);

CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  title VARCHAR(150) UNIQUE NOT NULL,
  description TEXT,
  max_score INT NOT NULL CHECK (max_score > 0)
);

-- many interns : many projects, resolved through submissions
CREATE TABLE submissions (
  id SERIAL PRIMARY KEY,
  intern_id INT NOT NULL REFERENCES interns(id) ON DELETE CASCADE,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  github_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','reviewed')),
  score INT CHECK (score >= 0),
  UNIQUE (intern_id, project_id)
);

-- Foreign-key lookups used by JOINs and filters
CREATE INDEX idx_interns_mentor_id ON interns(mentor_id);
CREATE INDEX idx_submissions_intern_id ON submissions(intern_id);
CREATE INDEX idx_submissions_project_id ON submissions(project_id);

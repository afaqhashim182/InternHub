-- Sample data: 3 mentors, 10 interns, 6 profiles, 4 projects, 15 submissions.
-- Runs right after schema.sql, so SERIAL ids start at 1.

INSERT INTO mentors (name, email) VALUES
  ('Sara Malik',  'sara.malik@internhub.dev'),
  ('David Chen',  'david.chen@internhub.dev'),
  ('Amina Yusuf', 'amina.yusuf@internhub.dev');

INSERT INTO interns (name, email, phone, track, mentor_id) VALUES
  ('Ali Raza',       'ali.raza@example.com',       '+92 300 1234567',  'frontend',  1),
  ('Maria Garcia',   'maria.garcia@example.com',   '+34 612 345 678',  'backend',   2),
  ('John Smith',     'john.smith@example.com',     NULL,               'fullstack', 3),
  ('Fatima Noor',    'fatima.noor@example.com',    '+92 321 7654321',  'frontend',  1),
  ('Liam O''Brien',  'liam.obrien@example.com',    '+353 87 123 4567', 'backend',   2),
  ('Chloe Martin',   'chloe.martin@example.com',   NULL,               'fullstack', 1),
  ('Hassan Ahmed',   'hassan.ahmed@example.com',   '+20 100 555 0101', 'backend',   3),
  ('Priya Sharma',   'priya.sharma@example.com',   '+91 98765 43210',  'frontend',  2),
  ('Noah Williams',  'noah.williams@example.com',  NULL,               'fullstack', NULL),
  ('Zara Khan',      'zara.khan@example.com',      '+44 7700 900123',  'frontend',  3);

INSERT INTO intern_profiles (intern_id, bio, linkedin_url) VALUES
  (1,  'Enjoys building accessible, responsive UIs.',        'https://www.linkedin.com/in/ali-raza'),
  (2,  'Backend enthusiast who loves clean SQL.',            'https://www.linkedin.com/in/maria-garcia'),
  (3,  'Career switcher from data analysis to full-stack.',  NULL),
  (5,  'Interested in APIs and distributed systems.',        'https://www.linkedin.com/in/liam-obrien'),
  (8,  'CSS animations and design systems.',                 'https://www.linkedin.com/in/priya-sharma'),
  (10, 'Learning TypeScript and testing.',                   NULL);

INSERT INTO projects (title, description, max_score) VALUES
  ('Portfolio Website',      'Responsive personal portfolio using semantic HTML and modern CSS.', 100),
  ('REST API with Express',  'CRUD API with validation, error handling and status codes.',        100),
  ('Postgres Schema Design', 'Normalised schema with constraints, relationships and indexes.',     50),
  ('Auth Flow',              'Sign-up and login flow with hashed passwords and sessions.',         20);

-- Scores only on reviewed work, always <= the project's max_score.
INSERT INTO submissions (intern_id, project_id, github_url, status, score) VALUES
  (1,  1, 'https://github.com/ali-raza/portfolio',        'reviewed',  92),
  (1,  3, 'https://github.com/ali-raza/schema',           'submitted', NULL),
  (2,  2, 'https://github.com/maria-garcia/express-api',  'reviewed',  88),
  (2,  3, 'https://github.com/maria-garcia/schema',       'reviewed',  45),
  (3,  1, 'https://github.com/john-smith/portfolio',      'reviewed',  75),
  (3,  2, NULL,                                           'pending',   NULL),
  (4,  1, 'https://github.com/fatima-noor/portfolio',     'submitted', NULL),
  (5,  2, 'https://github.com/liam-obrien/express-api',   'reviewed',  95),
  (5,  4, 'https://github.com/liam-obrien/auth',          'reviewed',  18),
  (6,  1, NULL,                                           'pending',   NULL),
  (7,  2, 'https://github.com/hassan-ahmed/express-api',  'submitted', NULL),
  (7,  3, 'https://github.com/hassan-ahmed/schema',       'reviewed',  38),
  (8,  1, 'https://github.com/priya-sharma/portfolio',    'reviewed',  81),
  (9,  4, NULL,                                           'pending',   NULL),
  (10, 1, 'https://github.com/zara-khan/portfolio',       'reviewed',  67);

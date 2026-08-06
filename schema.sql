-- 个人项目驾驶舱 · D1 完整数据结构
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'member',
  recovery_hash TEXT,
  recovery_salt TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  milestone_id INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reflections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL,
  object_key TEXT UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'attach',
  size INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  content_base64 TEXT
);

CREATE INDEX IF NOT EXISTS idx_ms_proj ON milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_node_proj ON nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_node_ms ON nodes(milestone_id);
CREATE INDEX IF NOT EXISTS idx_attach_issue ON attachments(issue_id);

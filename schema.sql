-- 交付管理台 · D1 数据库表结构
-- 每个实体一行（行级更新，避免多人整块覆盖）。data 列存对象 JSON，附 id/外键列便于查询。

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'member',  -- admin / member / viewer
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS milestones (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL,
  milestone_id INTEGER NOT NULL,
  data         TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ms_proj   ON milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_node_proj ON nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_node_ms   ON nodes(milestone_id);

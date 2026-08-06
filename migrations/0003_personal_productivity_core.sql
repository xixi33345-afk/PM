-- 单人长期使用增强：账号恢复与每周回顾。
-- 项目状态、归档和回收站使用现有 JSON data 字段，无需新增列。
ALTER TABLE users ADD COLUMN recovery_hash TEXT;
ALTER TABLE users ADD COLUMN recovery_salt TEXT;

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

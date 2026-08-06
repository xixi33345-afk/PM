-- 单用户项目驾驶舱：复盘记录、跨设备附件与问题项目关联

CREATE TABLE IF NOT EXISTS reflections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id     INTEGER NOT NULL,
  object_key   TEXT UNIQUE NOT NULL,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'attach',
  size         INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attach_issue ON attachments(issue_id);

-- 仅当一个客户只对应一个项目时，自动把旧问题关联到该项目；其余保留为“未关联项目”。
UPDATE issues
SET data = json_set(
  data,
  '$.projectId',
  (
    SELECT p.id
    FROM projects p
    WHERE json_extract(p.data, '$.client') = json_extract(issues.data, '$.client')
    LIMIT 1
  )
)
WHERE json_extract(data, '$.projectId') IS NULL
  AND (
    SELECT COUNT(*)
    FROM projects p
    WHERE json_extract(p.data, '$.client') = json_extract(issues.data, '$.client')
  ) = 1;
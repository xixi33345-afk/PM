-- 单人工作区：默认负责人跨设备保存；节点可以直接归属项目。
-- 升级前导出备份；此脚本仅对旧版本执行一次，全新部署使用 schema.sql。
ALTER TABLE users ADD COLUMN default_owner TEXT NOT NULL DEFAULT '';
UPDATE users SET default_owner = COALESCE(name, '');

-- SQLite 不能直接移除 NOT NULL，复制全部记录（包括回收站记录）后替换原表。
CREATE TABLE nodes_personal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  milestone_id INTEGER,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO nodes_personal (id, project_id, milestone_id, data, updated_at)
SELECT id, project_id, milestone_id, data, updated_at FROM nodes;
-- 保留已彻底删除记录之后的自增序号，避免历史快照中的节点编号被重用。
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name='nodes'), 0)) WHERE name='nodes_personal';
DROP TABLE nodes;
ALTER TABLE nodes_personal RENAME TO nodes;
CREATE INDEX idx_node_proj ON nodes(project_id);
CREATE INDEX idx_node_ms ON nodes(milestone_id);

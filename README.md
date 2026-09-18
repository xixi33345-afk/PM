# 个人项目驾驶舱

面向一个人的项目、里程碑、节点、问题、复盘与每周回顾管理。网站使用 Cloudflare Pages + D1：D1 保存结构化数据和附件内容。

## 主要能力

- 项目状态：进行中、暂停、已完成、已归档。
- 个人设置保存默认负责人，随账号跨设备读取；新建里程碑、节点、问题与复盘后续行动时自动填写，可逐条修改，不改写旧记录。
- 在统一的项目页面切换甘特图和节点清单；保留全局月/周与近期日视图。
- 节点直接属于项目，里程碑可选。可以先建节点，之后关联或解除里程碑；直接节点也显示在甘特图中。
- 在节点表单中新建里程碑时保留原节点草稿与编辑状态；取消新建里程碑后仍可继续编辑节点。
- 个人清单按已完成、进行中、待开始、需关注分类并编号。负责人作为附注，保留他人负责、需要自己跟进的事项。
- 清单的已完成事项按实际完成日期筛选；未完成包含所选期间到期和之前延期事项。本周为周一至周日，本月为自然月；风险统计遵循相同筛选范围，排除归档项目。
- 里程碑和节点完成时自动记录当天为实际完成日期，并支持手动修正。
- 问题闭环后可直接生成复盘，并提示可能重复的历史问题。复盘也可关联项目节点或直接记录个人经验，后续行动默认由本人负责。
- 每周回顾按实际完成日期生成关键进展，并按下周计划与延期结转生成重点；事项可独立编辑、补充和删除。
- 已保存的回顾保持历史快照，通过“同步最新节点”主动合并变化，不覆盖人工文字。
- 历史周回顾使用独立页面，支持日期范围、全文搜索、继续编辑和单周导出。
- 回收站、撤销删除、JSON 备份与合并导入。
- 唯一账号、修改密码和一次性显示的恢复码。
- 手机照片上传前压缩、进度显示、失败重试与跨设备保留。
- 可添加到手机桌面；断网时新增问题和照片会暂存在本机，联网后自动同步。

## 从上一版本升级

### 本次升级：个人设置与可选里程碑

旧数据库的节点强制关联里程碑，因此本次需要升级数据库，不能仅更新网页。

1. 在网站设置中导出完整数据备份，并确认 Cloudflare D1 的恢复点可用。
2. 在 PM 项目目录执行以下脚本一次（不要重复执行）：

```bash
wrangler d1 execute delivery-pm-db --remote --file=./migrations/0005_personal_workspace.sql
```

也可在 Cloudflare D1 的 SQL 控制台执行该文件的内容。升级保留原节点编号、内容、日期、里程碑关联、回收站记录及自增序号。

3. 上传并部署 `public/index.html`、`public/service-worker.js`、`functions/api/[[path]].js`，同步本次迁移文件、`schema.sql`、README 与 `scripts` 中的校验脚本。
4. 重新打开网站，在“个人设置”保存默认负责人，测试新建不关联里程碑的节点。

数据备份合并导入不会改动当前账号的默认负责人。既有周回顾仍保持历史快照，只有主动“同步最新节点”才合并变化。

### 尚未完成的早期升级

先确认已经执行过附件与复盘升级：

```bash
wrangler d1 execute delivery-pm-db --remote --file=./migrations/0002_single_user_reviews_attachments.sql
```

再执行 0003，增加账号恢复字段和每周回顾表：

```bash
wrangler d1 execute delivery-pm-db --remote --file=./migrations/0003_personal_productivity_core.sql
```

未执行附件内容升级的数据库还需执行 `migrations/0004_d1_attachment_content.sql`；完成早期升级后再执行 0005。

部署后确认：

- D1 变量名 `DB` 指向 `delivery-pm-db`
- 已设置 Pages 密钥 `AUTH_SECRET`

## 全新部署

1. 创建 D1：`wrangler d1 create delivery-pm-db`
2. 将返回的 `database_id` 填入 `wrangler.toml`
3. 建表：`wrangler d1 execute delivery-pm-db --remote --file=./schema.sql`
4. 设置 `AUTH_SECRET`
5. 部署并确认 `DB` 绑定
6. 首次打开网站时创建唯一账号，并立即保存恢复码
7. 在“个人设置”保存默认负责人

全新建库已包含本次变更，无需再执行迁移脚本。

## 数据安全说明

- 删除的项目、里程碑、节点、问题和复盘会先进入回收站。
- 导出备份包含全部结构化数据与附件清单；照片文件继续保存在 D1，不会重复写入 JSON。
- 导入备份时以副本方式合并，不覆盖当前数据。
- 单个附件最大 1MB；手机照片会优先压缩后再上传。

## 本地预览

通过本地静态服务器打开 `public/index.html` 可使用演示模式。演示记录与默认负责人不会联网或持久化；完整调试需要 D1 和 `AUTH_SECRET` 绑定。

使用 Node.js 22.13+ 在项目目录校验：

```bash
node scripts/verify-site.cjs
node scripts/verify-weekly.cjs
node scripts/verify-completion-dates.cjs
node scripts/verify-personal.cjs
```

个人模式校验使用内存 SQLite，验证旧数据升级、负责人保存、节点关联及备份恢复，不连接线上数据库。

<!-- 触发 Cloudflare 重新部署 -->

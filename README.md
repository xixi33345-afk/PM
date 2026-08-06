# 个人项目驾驶舱

面向一个人的项目、里程碑、节点、问题、复盘与每周回顾管理。网站使用 Cloudflare Pages + D1 + R2：D1 保存结构化数据，R2 保存手机拍摄的图片和其他附件。

## 主要能力

- 项目状态：进行中、暂停、已完成、已归档。
- 混合甘特视图：全局月/周与近期日视图。
- 问题闭环后可直接生成复盘，并提示可能重复的历史问题。
- 每周回顾、历史周报浏览与编辑、单周导出、逾期提醒和手机日历导出。
- 回收站、撤销删除、JSON 备份与合并导入。
- 唯一账号、修改密码和一次性显示的恢复码。
- 手机照片上传前压缩、进度显示、失败重试与跨设备保留。
- 可添加到手机桌面；断网时新增问题和照片会暂存在本机，联网后自动同步。

## 从上一版本升级

先确认已经执行过附件与复盘升级：

```bash
wrangler d1 execute delivery-pm-db --remote --file=./migrations/0002_single_user_reviews_attachments.sql
```

再执行本次升级，增加账号恢复字段和每周回顾表：

```bash
wrangler d1 execute delivery-pm-db --remote --file=./migrations/0003_personal_productivity_core.sql
```

部署后确认：

- D1 变量名 `DB` 指向 `delivery-pm-db`
- R2 变量名 `ATTACHMENTS` 指向 `delivery-pm-attachments`
- 已设置 Pages 密钥 `AUTH_SECRET`

## 全新部署

1. 创建 D1：`wrangler d1 create delivery-pm-db`
2. 将返回的 `database_id` 填入 `wrangler.toml`
3. 建表：`wrangler d1 execute delivery-pm-db --remote --file=./schema.sql`
4. 创建 R2：`wrangler r2 bucket create delivery-pm-attachments`
5. 设置 `AUTH_SECRET`
6. 部署并确认 `DB`、`ATTACHMENTS` 绑定
7. 首次打开网站时创建唯一账号，并立即保存恢复码

## 数据安全说明

- 删除的项目、里程碑、节点、问题和复盘会先进入回收站。
- 导出备份包含全部结构化数据与附件清单；照片文件继续保存在 R2，不会重复写入 JSON。
- 导入备份时以副本方式合并，不覆盖当前数据。
- 单个附件最大 15MB；手机照片会优先压缩后再上传。

## 本地预览

直接打开 `public/index.html` 可使用演示模式。演示数据不会联网或持久化；完整调试需要 D1、R2 和 `AUTH_SECRET` 绑定。

<!-- 触发 Cloudflare 重新部署 -->

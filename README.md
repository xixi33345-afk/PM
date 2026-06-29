# 交付管理台 · 多人协作版 — 部署说明

面向 ≤10 人、共享同一份数据、按账号区分权限。托管在 **Cloudflare Pages + D1**，完全免费，大陆可访问。

```
.
├─ public/index.html              前端（登录后读写共享数据）
├─ functions/api/[[path]].js      后端 API（鉴权 / 角色 / 实体 CRUD）
├─ schema.sql                     D1 建表
├─ wrangler.toml                  配置（需填 D1 id）
└─ README.md
```

## 部署（约 7 步，复制即用）

> 前置：装好 Node.js。下面命令在项目根目录执行。

**1. 安装并登录 wrangler**
```bash
npm i -g wrangler
wrangler login
```

**2. 创建 D1 数据库**
```bash
wrangler d1 create delivery-pm-db
```
把输出里的 `database_id = "xxxx"` 复制，填进 `wrangler.toml` 的 `database_id`。

**3. 建表（远程库）**
```bash
wrangler d1 execute delivery-pm-db --remote --file=./schema.sql
```

**4. 首次部署（会自动创建 Pages 项目）**
```bash
wrangler pages deploy public --project-name delivery-pm
```
完成后会给你一个 `https://delivery-pm.pages.dev` 地址。

**5. 设置鉴权密钥**（务必设成一长串随机字符）
```bash
wrangler pages secret put AUTH_SECRET --project-name delivery-pm
# 粘贴一段随机字符串，例如用 `openssl rand -hex 32` 生成
```

**6. 确认 D1 绑定**
`wrangler.toml` 里的 `[[d1_databases]] binding = "DB"` 在 `pages deploy` 时会自动绑定。
若接口报“未绑定 D1”，到 Cloudflare 后台 → Pages → 你的项目 → Settings → Functions → D1 database bindings，新增：变量名 `DB` → 选 `delivery-pm-db`，再重新部署。

**7. 开始使用**
打开站点 → **注册第一个账号（自动成为管理员）** → 登录后点侧栏「**载入示例**」可填充示例数据 → 到「**成员管理**」给同事分配 **成员 / 访客** 角色。
之后改了 D1 id 或代码，重新 `wrangler pages deploy public --project-name delivery-pm` 即可。

## 角色权限

- **管理员 admin**：第一个注册者；可改他人角色、增删改全部数据。
- **成员 member**：可创建/编辑/删除项目、里程碑、节点、问题。
- **访客 viewer**：只读（新增按钮隐藏，后端也会拒绝写入）。

## 大陆访问与免费额度

- Pages + D1 + Functions 的免费额度对 ≤10 人、低频写入**完全够用**。
- 默认的 `*.pages.dev` 域名在大陆偶有不稳；**建议绑定自有域名**（后台 Pages → Custom domains，把你的域名 CNAME 到 pages.dev），大陆访问更稳。

## 本地预览

- 直接双击 `public/index.html` → 进入「**演示模式**」（不联网、不保存），用于看界面。
- 想本地连后端调试：`wrangler pages dev public`（需先建好 D1 并在本地 .dev.vars 里设 `AUTH_SECRET`）。

## 已知边界（二期可补）

- **附件**（图片/文件）当前**不入库、不跨人共享**，仅当前会话本地可见。要团队共享附件，二期接 **Cloudflare R2** 对象存储（仍免费额度内）。
- **改密码 / 忘记密码**未内置 UI；临时可由管理员在 D1 重置该用户记录。token 有效期 7 天。
- 并发为「行级更新 + 20 秒轮询」，≤10 人足够；要真正实时再上 Durable Objects。

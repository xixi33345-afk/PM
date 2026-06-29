// 交付管理台 · 后端 API（Cloudflare Pages Functions + D1）
// 路由：/api/login /api/signup /api/me /api/state /api/users[/:id] /api/{projects|milestones|nodes|issues}[/:id]
// 鉴权：邮箱+密码（PBKDF2 校验），登录签发 HMAC-SHA256 无状态 token，写接口校验角色。

const enc = new TextEncoder();
const dec = new TextDecoder();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// ---- base64url ----
function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---- HMAC token ----
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signToken(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return body + "." + b64url(sig);
}
async function verifyToken(token, secret) {
  if (!token || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64urlToBytes(body)));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---- 密码 PBKDF2 ----
function genSaltHex() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
  return b;
}
async function hashPassword(pw, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return b64url(bits);
}

// ---- 鉴权 ----
async function authUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const p = await verifyToken(token, env.AUTH_SECRET || "dev-secret-change-me");
  if (!p) return null;
  return { id: p.uid, role: p.role, name: p.name, email: p.email };
}
const canWrite = (u) => u && (u.role === "admin" || u.role === "member");

// ---- 实体定义（外键列）----
const ENTITY = {
  projects: [],
  milestones: ["project_id"],
  nodes: ["project_id", "milestone_id"],
  issues: [],
};
function fkValues(table, obj) {
  const map = { project_id: obj.projectId, milestone_id: obj.milestoneId };
  return ENTITY[table].map((c) => map[c]);
}

async function login(request, env) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) return json({ error: "缺少邮箱或密码" }, 400);
  const row = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(String(email).toLowerCase()).first();
  if (!row) return json({ error: "邮箱或密码错误" }, 401);
  const h = await hashPassword(password, row.salt);
  if (h !== row.password_hash) return json({ error: "邮箱或密码错误" }, 401);
  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  const token = await signToken({ uid: row.id, role: row.role, name: row.name, email: row.email, exp: Date.now() + 7 * 864e5 }, env.AUTH_SECRET || "dev-secret-change-me");
  return json({ token, user });
}

async function signup(request, env) {
  const { email, password, name } = await request.json().catch(() => ({}));
  if (!email || !password) return json({ error: "缺少邮箱或密码" }, 400);
  if (String(password).length < 6) return json({ error: "密码至少 6 位" }, 400);
  const mail = String(email).toLowerCase();
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(mail).first();
  if (existing) return json({ error: "该邮箱已注册" }, 409);
  const cnt = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first();
  const role = cnt.c === 0 ? "admin" : "member"; // 第一个注册者自动成为管理员
  const salt = genSaltHex();
  const ph = await hashPassword(password, salt);
  const nm = name || mail.split("@")[0];
  const res = await env.DB.prepare("INSERT INTO users (email,password_hash,salt,name,role,created_at) VALUES (?,?,?,?,?,?)")
    .bind(mail, ph, salt, nm, role, Date.now()).run();
  const uid = res.meta.last_row_id;
  const user = { id: uid, name: nm, email: mail, role };
  const token = await signToken({ uid, role, name: nm, email: mail, exp: Date.now() + 7 * 864e5 }, env.AUTH_SECRET || "dev-secret-change-me");
  return json({ token, user });
}

async function getState(env) {
  const out = {};
  for (const t of Object.keys(ENTITY)) {
    const { results } = await env.DB.prepare(`SELECT id, data FROM ${t}`).all();
    out[t] = results.map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
  }
  const us = await env.DB.prepare("SELECT id, email, name, role FROM users").all();
  out.users = us.results;
  return json(out);
}

async function createEntity(table, obj, env) {
  const fks = ENTITY[table];
  const data = { ...obj };
  delete data.id;
  const fields = [...fks, "data", "updated_at"];
  const vals = [...fkValues(table, obj), JSON.stringify(data), Date.now()];
  const res = await env.DB.prepare(`INSERT INTO ${table} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`).bind(...vals).run();
  return json({ id: res.meta.last_row_id, ...data });
}
async function updateEntity(table, id, obj, env) {
  const fks = ENTITY[table];
  const data = { ...obj };
  delete data.id;
  const sets = [...fks.map((c) => `${c}=?`), "data=?", "updated_at=?"];
  const vals = [...fkValues(table, obj), JSON.stringify(data), Date.now(), id];
  await env.DB.prepare(`UPDATE ${table} SET ${sets.join(",")} WHERE id=?`).bind(...vals).run();
  return json({ id: Number(id), ...data });
}
async function deleteEntity(table, id, env) {
  // 删除项目时级联其里程碑与节点；删除里程碑时级联其节点
  if (table === "projects") {
    await env.DB.prepare("DELETE FROM nodes WHERE project_id=?").bind(id).run();
    await env.DB.prepare("DELETE FROM milestones WHERE project_id=?").bind(id).run();
  } else if (table === "milestones") {
    await env.DB.prepare("DELETE FROM nodes WHERE milestone_id=?").bind(id).run();
  }
  await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
  return json({ ok: true });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const method = request.method;
  const seg = (params.path ? (Array.isArray(params.path) ? params.path : [params.path]) : []).filter(Boolean);
  const head = seg[0];

  try {
    if (!env.DB) return json({ error: "未绑定 D1 数据库（请检查 wrangler.toml 与 Pages 绑定）" }, 500);

    // 公开路由
    if (head === "login" && method === "POST") return login(request, env);
    if (head === "signup" && method === "POST") return signup(request, env);

    // 以下需登录
    const user = await authUser(request, env);
    if (!user) return json({ error: "未登录或登录已过期" }, 401);

    if (head === "me" && method === "GET") return json({ user });
    if (head === "state" && method === "GET") return getState(env);

    // 成员管理（管理员）
    if (head === "users") {
      if (method === "GET" && seg.length === 1) {
        const { results } = await env.DB.prepare("SELECT id,email,name,role,created_at FROM users").all();
        return json(results);
      }
      if (method === "PATCH" && seg.length === 2) {
        if (user.role !== "admin") return json({ error: "仅管理员可改角色" }, 403);
        const { role } = await request.json().catch(() => ({}));
        if (!["admin", "member", "viewer"].includes(role)) return json({ error: "非法角色" }, 400);
        await env.DB.prepare("UPDATE users SET role=? WHERE id=?").bind(role, seg[1]).run();
        return json({ ok: true });
      }
      return json({ error: "不支持的操作" }, 405);
    }

    // 实体 CRUD：projects / milestones / nodes / issues
    if (ENTITY[head]) {
      if (method === "GET" && seg.length === 1) {
        const { results } = await env.DB.prepare(`SELECT id, data FROM ${head}`).all();
        return json(results.map((r) => ({ id: r.id, ...JSON.parse(r.data) })));
      }
      if (method === "POST" && seg.length === 1) {
        if (!canWrite(user)) return json({ error: "无写入权限（访客只读）" }, 403);
        return createEntity(head, await request.json(), env);
      }
      if (method === "PATCH" && seg.length === 2) {
        if (!canWrite(user)) return json({ error: "无写入权限（访客只读）" }, 403);
        return updateEntity(head, seg[1], await request.json(), env);
      }
      if (method === "DELETE" && seg.length === 2) {
        if (!canWrite(user)) return json({ error: "无写入权限（访客只读）" }, 403);
        return deleteEntity(head, seg[1], env);
      }
      return json({ error: "不支持的操作" }, 405);
    }

    return json({ error: "接口不存在" }, 404);
  } catch (e) {
    return json({ error: "服务端错误：" + (e && e.message ? e.message : String(e)) }, 500);
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

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
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signToken(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return body + "." + b64url(sig);
}
async function verifyToken(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), b64urlToBytes(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64urlToBytes(body)));
    return payload.exp && Date.now() > payload.exp ? null : payload;
  } catch { return null; }
}

function genSaltHex() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
  return b;
}
async function hashPassword(value, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(value), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: hexToBytes(saltHex), iterations: 100000, hash: "SHA-256" }, key, 256);
  return b64url(bits);
}
function recoveryCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((n) => chars[n % chars.length]).join("").match(/.{1,4}/g).join("-");
}
const cleanRecovery = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function authUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const p = env.AUTH_SECRET ? await verifyToken(auth.startsWith("Bearer ") ? auth.slice(7) : "", env.AUTH_SECRET) : null;
  return p ? { id: p.uid, role: p.role, name: p.name, email: p.email } : null;
}
const canWrite = (u) => u && (u.role === "admin" || u.role === "member");

const ENTITY = {
  projects: [],
  milestones: ["project_id"],
  nodes: ["project_id", "milestone_id"],
  issues: [],
  reflections: [],
  weekly_reviews: [],
};
function fkValues(table, obj) {
  const map = { project_id: obj.projectId, milestone_id: obj.milestoneId };
  return ENTITY[table].map((c) => map[c]);
}
function parseRow(row) {
  try { return { id: row.id, ...JSON.parse(row.data) }; } catch { return { id: row.id }; }
}
async function insertEntity(table, obj, env) {
  const data = { ...obj };
  delete data.id;
  delete data.attaches;
  delete data.verifyShots;
  const fks = ENTITY[table];
  const fields = [...fks, "data", "updated_at"];
  const vals = [...fkValues(table, data), JSON.stringify(data), Date.now()];
  const q = `INSERT INTO ${table} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`;
  const res = await env.DB.prepare(q).bind(...vals).run();
  return { id: res.meta.last_row_id, ...data };
}

async function login(request, env) {
  if (!env.AUTH_SECRET) return json({ error: "服务端尚未设置登录密钥" }, 500);
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) return json({ error: "缺少邮箱或密码" }, 400);
  const row = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(String(email).toLowerCase()).first();
  if (!row || await hashPassword(password, row.salt) !== row.password_hash) return json({ error: "邮箱或密码错误" }, 401);
  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  const token = await signToken({ uid: row.id, role: row.role, name: row.name, email: row.email, exp: Date.now() + 7 * 864e5 }, env.AUTH_SECRET);
  return json({ token, user });
}
async function signup(request, env) {
  if (!env.AUTH_SECRET) return json({ error: "服务端尚未设置登录密钥" }, 500);
  const { email, password, name } = await request.json().catch(() => ({}));
  if (!email || !password) return json({ error: "缺少邮箱或密码" }, 400);
  if (String(password).length < 8) return json({ error: "密码至少 8 位" }, 400);
  const cnt = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first();
  if (Number(cnt.c) > 0) return json({ error: "此网站已经初始化，只允许一个账号" }, 403);
  const mail = String(email).toLowerCase();
  const salt = genSaltHex(), recSalt = genSaltHex(), code = recoveryCode();
  const ph = await hashPassword(password, salt), rh = await hashPassword(cleanRecovery(code), recSalt);
  const nm = name || mail.split("@")[0];
  const res = await env.DB.prepare("INSERT INTO users (email,password_hash,salt,name,role,recovery_hash,recovery_salt,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(mail, ph, salt, nm, "admin", rh, recSalt, Date.now()).run();
  const user = { id: res.meta.last_row_id, name: nm, email: mail, role: "admin" };
  const token = await signToken({ uid: user.id, role: user.role, name: user.name, email: user.email, exp: Date.now() + 7 * 864e5 }, env.AUTH_SECRET);
  return json({ token, user, recoveryCode: code });
}
async function recoverAccount(request, env) {
  const { email, recoveryCode: code, newPassword } = await request.json().catch(() => ({}));
  if (!email || !code || String(newPassword || "").length < 8) return json({ error: "请填写邮箱、恢复码和至少 8 位的新密码" }, 400);
  const row = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(String(email).toLowerCase()).first();
  if (!row || !row.recovery_hash || await hashPassword(cleanRecovery(code), row.recovery_salt) !== row.recovery_hash) return json({ error: "邮箱或恢复码错误" }, 401);
  const salt = genSaltHex(), hash = await hashPassword(newPassword, salt);
  await env.DB.prepare("UPDATE users SET password_hash=?,salt=? WHERE id=?").bind(hash, salt, row.id).run();
  return json({ ok: true });
}
async function changePassword(request, user, env) {
  const { currentPassword, newPassword } = await request.json().catch(() => ({}));
  if (String(newPassword || "").length < 8) return json({ error: "新密码至少 8 位" }, 400);
  const row = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(user.id).first();
  if (!row || await hashPassword(currentPassword || "", row.salt) !== row.password_hash) return json({ error: "当前密码错误" }, 401);
  const salt = genSaltHex(), hash = await hashPassword(newPassword, salt);
  await env.DB.prepare("UPDATE users SET password_hash=?,salt=? WHERE id=?").bind(hash, salt, user.id).run();
  return json({ ok: true });
}
async function renewRecovery(request, user, env) {
  const { currentPassword } = await request.json().catch(() => ({}));
  const row = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(user.id).first();
  if (!row || await hashPassword(currentPassword || "", row.salt) !== row.password_hash) return json({ error: "当前密码错误" }, 401);
  const code = recoveryCode(), salt = genSaltHex(), hash = await hashPassword(cleanRecovery(code), salt);
  await env.DB.prepare("UPDATE users SET recovery_hash=?,recovery_salt=? WHERE id=?").bind(hash, salt, user.id).run();
  return json({ recoveryCode: code });
}

async function getState(env) {
  const out = { trash: [] };
  for (const table of Object.keys(ENTITY)) {
    const { results } = await env.DB.prepare(`SELECT id,data FROM ${table} ORDER BY id`).all();
    out[table] = [];
    for (const row of results) {
      const item = parseRow(row);
      if (item.deletedAt) out.trash.push({ table, ...item });
      else out[table].push(item);
    }
  }
  const ats = await env.DB.prepare("SELECT id,issue_id,filename,content_type,kind,size,created_at FROM attachments ORDER BY id").all();
  out.attachments = ats.results.map((a) => ({ id: a.id, issueId: a.issue_id, name: a.filename, type: a.content_type, kind: a.kind, size: a.size, createdAt: a.created_at, url: `/api/attachments/${a.id}` }));
  out.storage = { attachmentCount: out.attachments.length, attachmentBytes: out.attachments.reduce((s, a) => s + Number(a.size || 0), 0) };
  return json(out);
}

async function uploadAttachment(request, env) {
  if (!env.ATTACHMENTS) return json({ error: "未绑定附件存储空间" }, 500);
  const form = await request.formData();
  const file = form.get("file"), issueId = Number(form.get("issueId"));
  const kind = form.get("kind") === "verify" ? "verify" : "attach";
  if (!file || typeof file.stream !== "function" || !issueId) return json({ error: "缺少附件或问题编号" }, 400);
  if (file.size > 15 * 1024 * 1024) return json({ error: "单个附件不能超过 15MB" }, 400);
  const issue = await env.DB.prepare("SELECT id FROM issues WHERE id=?").bind(issueId).first();
  if (!issue) return json({ error: "关联的问题不存在" }, 404);
  const key = `issues/${issueId}/${crypto.randomUUID()}`, contentType = file.type || "application/octet-stream";
  await env.ATTACHMENTS.put(key, file.stream(), { httpMetadata: { contentType } });
  const res = await env.DB.prepare("INSERT INTO attachments (issue_id,object_key,filename,content_type,kind,size,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(issueId, key, file.name || "附件", contentType, kind, file.size || 0, Date.now()).run();
  return json({ id: res.meta.last_row_id, issueId, name: file.name || "附件", type: contentType, kind, size: file.size || 0, url: `/api/attachments/${res.meta.last_row_id}` });
}
async function downloadAttachment(id, env) {
  if (!env.ATTACHMENTS) return json({ error: "未绑定附件存储空间" }, 500);
  const row = await env.DB.prepare("SELECT object_key,filename,content_type FROM attachments WHERE id=?").bind(id).first();
  if (!row) return json({ error: "附件不存在" }, 404);
  const object = await env.ATTACHMENTS.get(row.object_key);
  if (!object) return json({ error: "附件文件不存在" }, 404);
  const headers = new Headers(); object.writeHttpMetadata(headers);
  headers.set("content-type", row.content_type || "application/octet-stream");
  headers.set("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
  headers.set("cache-control", "private, max-age=3600");
  return new Response(object.body, { headers });
}
async function deleteAttachment(id, env) {
  const row = await env.DB.prepare("SELECT object_key FROM attachments WHERE id=?").bind(id).first();
  if (!row) return json({ ok: true });
  if (env.ATTACHMENTS) await env.ATTACHMENTS.delete(row.object_key);
  await env.DB.prepare("DELETE FROM attachments WHERE id=?").bind(id).run();
  return json({ ok: true });
}

async function createEntity(table, obj, env) { return json(await insertEntity(table, obj, env)); }
async function updateEntity(table, id, obj, env) {
  const exists = await env.DB.prepare(`SELECT data FROM ${table} WHERE id=?`).bind(id).first();
  if (!exists) return json({ error: "记录不存在" }, 404);
  const old = JSON.parse(exists.data), data = { ...old, ...obj };
  delete data.id; delete data.attaches; delete data.verifyShots; delete data.deletedAt; delete data.trashGroup;
  const fks = ENTITY[table], sets = [...fks.map((c) => `${c}=?`), "data=?", "updated_at=?"];
  await env.DB.prepare(`UPDATE ${table} SET ${sets.join(",")} WHERE id=?`).bind(...fkValues(table, data), JSON.stringify(data), Date.now(), id).run();
  return json({ id: Number(id), ...data });
}
async function softDeleteEntity(table, id, env) {
  const exists = await env.DB.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(id).first();
  if (!exists) return json({ ok: true });
  const group = crypto.randomUUID(), now = Date.now();
  const qs = [env.DB.prepare(`UPDATE ${table} SET data=json_set(data,'$.deletedAt',?,'$.trashGroup',?),updated_at=? WHERE id=?`).bind(now, group, now, id)];
  if (table === "projects") {
    qs.push(env.DB.prepare("UPDATE milestones SET data=json_set(data,'$.deletedAt',?,'$.trashGroup',?),updated_at=? WHERE project_id=? AND json_extract(data,'$.deletedAt') IS NULL").bind(now, group, now, id));
    qs.push(env.DB.prepare("UPDATE nodes SET data=json_set(data,'$.deletedAt',?,'$.trashGroup',?),updated_at=? WHERE project_id=? AND json_extract(data,'$.deletedAt') IS NULL").bind(now, group, now, id));
  }
  if (table === "milestones") qs.push(env.DB.prepare("UPDATE nodes SET data=json_set(data,'$.deletedAt',?,'$.trashGroup',?),updated_at=? WHERE milestone_id=? AND json_extract(data,'$.deletedAt') IS NULL").bind(now, group, now, id));
  await env.DB.batch(qs);
  return json({ ok: true, undo: { table, id: Number(id) } });
}
async function restoreEntity(table, id, env) {
  const row = await env.DB.prepare(`SELECT data FROM ${table} WHERE id=?`).bind(id).first();
  if (!row) return json({ error: "回收站中没有这条记录" }, 404);
  const data = JSON.parse(row.data), group = data.trashGroup, now = Date.now();
  if (group) {
    await env.DB.batch(Object.keys(ENTITY).map((t) => env.DB.prepare(`UPDATE ${t} SET data=json_remove(data,'$.deletedAt','$.trashGroup'),updated_at=? WHERE json_extract(data,'$.trashGroup')=?`).bind(now, group)));
  } else {
    await env.DB.prepare(`UPDATE ${table} SET data=json_remove(data,'$.deletedAt','$.trashGroup'),updated_at=? WHERE id=?`).bind(now, id).run();
  }
  return json({ ok: true });
}
async function purgeEntity(table, id, env) {
  const row = await env.DB.prepare(`SELECT data FROM ${table} WHERE id=?`).bind(id).first();
  if (!row) return json({ ok: true });
  const data = JSON.parse(row.data), group = data.trashGroup;
  const issueSql = group ? "SELECT id FROM issues WHERE json_extract(data,'$.trashGroup')=?" : (table === "issues" ? "SELECT id FROM issues WHERE id=?" : null);
  if (issueSql) {
    const { results } = await env.DB.prepare(issueSql).bind(group || id).all();
    for (const issue of results) {
      const ats = await env.DB.prepare("SELECT id,object_key FROM attachments WHERE issue_id=?").bind(issue.id).all();
      if (env.ATTACHMENTS) for (const a of ats.results) await env.ATTACHMENTS.delete(a.object_key);
      await env.DB.prepare("DELETE FROM attachments WHERE issue_id=?").bind(issue.id).run();
    }
  }
  if (group) await env.DB.batch(Object.keys(ENTITY).map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE json_extract(data,'$.trashGroup')=?`).bind(group)));
  else await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
  return json({ ok: true });
}

async function exportBackup(env) {
  const data = {};
  for (const table of Object.keys(ENTITY)) {
    const { results } = await env.DB.prepare(`SELECT id,data FROM ${table} WHERE json_extract(data,'$.deletedAt') IS NULL ORDER BY id`).all();
    data[table] = results.map(parseRow);
  }
  const ats = await env.DB.prepare("SELECT id,issue_id,filename,content_type,kind,size,created_at FROM attachments ORDER BY id").all();
  return json({ version: 1, generatedAt: new Date().toISOString(), note: "附件文件继续保存在云端，本备份包含附件清单但不复制照片文件。", data, attachments: ats.results });
}
async function importBackup(request, env) {
  const body = await request.json().catch(() => ({})), src = body.data || body;
  if (!src || !Array.isArray(src.projects) || !Array.isArray(src.issues)) return json({ error: "备份文件格式不正确" }, 400);
  const pmap = {}, mmap = {}, imap = {};
  for (const p of src.projects || []) { const n = await insertEntity("projects", { ...p, id: undefined, name: `${p.name || "未命名项目"}（恢复）` }, env); pmap[p.id] = n.id; }
  for (const m of src.milestones || []) { const n = await insertEntity("milestones", { ...m, id: undefined, projectId: pmap[m.projectId] }, env); mmap[m.id] = n.id; }
  for (const n of src.nodes || []) await insertEntity("nodes", { ...n, id: undefined, projectId: pmap[n.projectId], milestoneId: mmap[n.milestoneId] }, env);
  for (const i of src.issues || []) { const n = await insertEntity("issues", { ...i, id: undefined, projectId: pmap[i.projectId] || null }, env); imap[i.id] = n.id; }
  for (const r of src.reflections || []) await insertEntity("reflections", { ...r, id: undefined, projectIds: (r.projectIds || []).map((x) => pmap[x]).filter(Boolean), issueIds: (r.issueIds || []).map((x) => imap[x]).filter(Boolean) }, env);
  for (const w of src.weekly_reviews || []) await insertEntity("weekly_reviews", { ...w, id: undefined }, env);
  return json({ ok: true, imported: Object.values(pmap).length + Object.values(imap).length, warning: "原备份中的附件清单不会重复上传。" });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const method = request.method;
  const seg = (params.path ? (Array.isArray(params.path) ? params.path : [params.path]) : []).filter(Boolean);
  const head = seg[0];
  try {
    if (!env.DB) return json({ error: "未绑定 D1 数据库" }, 500);
    if (head === "login" && method === "POST") return login(request, env);
    if (head === "signup" && method === "POST") return signup(request, env);
    if (head === "recover" && method === "POST") return recoverAccount(request, env);
    if (head === "setup" && method === "GET") {
      const cnt = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first();
      return json({ initialized: Number(cnt.c) > 0 });
    }
    const user = await authUser(request, env);
    if (!user) return json({ error: "未登录或登录已过期" }, 401);
    if (head === "me" && method === "GET") return json({ user });
    if (head === "state" && method === "GET") return getState(env);
    if (head === "account" && seg[1] === "password" && method === "POST") return changePassword(request, user, env);
    if (head === "account" && seg[1] === "recovery" && method === "POST") return renewRecovery(request, user, env);
    if (head === "backup" && method === "GET") return exportBackup(env);
    if (head === "restore" && method === "POST") return importBackup(request, env);
    if (head === "trash" && ENTITY[seg[1]] && seg[2]) {
      if (!canWrite(user)) return json({ error: "无写入权限" }, 403);
      if (method === "POST") return restoreEntity(seg[1], seg[2], env);
      if (method === "DELETE") return purgeEntity(seg[1], seg[2], env);
    }
    if (head === "attachments") {
      if (method === "GET" && seg.length === 2) return downloadAttachment(seg[1], env);
      if (!canWrite(user)) return json({ error: "无写入权限" }, 403);
      if (method === "POST" && seg.length === 1) return uploadAttachment(request, env);
      if (method === "DELETE" && seg.length === 2) return deleteAttachment(seg[1], env);
      return json({ error: "不支持的附件操作" }, 405);
    }
    if (ENTITY[head]) {
      if (method === "GET" && seg.length === 1) {
        const { results } = await env.DB.prepare(`SELECT id,data FROM ${head} WHERE json_extract(data,'$.deletedAt') IS NULL ORDER BY id`).all();
        return json(results.map(parseRow));
      }
      if (!canWrite(user)) return json({ error: "无写入权限" }, 403);
      if (method === "POST" && seg.length === 1) return createEntity(head, await request.json(), env);
      if (method === "PATCH" && seg.length === 2) return updateEntity(head, seg[1], await request.json(), env);
      if (method === "DELETE" && seg.length === 2) return softDeleteEntity(head, seg[1], env);
      return json({ error: "不支持的操作" }, 405);
    }
    return json({ error: "接口不存在" }, 404);
  } catch (e) {
    return json({ error: "服务端错误：" + (e && e.message ? e.message : String(e)) }, 500);
  }
}

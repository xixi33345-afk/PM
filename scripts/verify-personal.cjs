// Run from PM with Node.js 22.13+ (uses the built-in in-memory SQLite engine).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { createHmac } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

function frontend() {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const elements = {};
  for (const id of ids) {
    const classes = new Set();
    elements[id] = { value: '', innerHTML: '', textContent: '', style: {}, dataset: {}, hidden: false, checked: false,
      addEventListener() {}, focus() {}, removeAttribute() {},
      classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v), toggle(v, force) { if (force) classes.add(v); else classes.delete(v); } },
    };
  }
  const context = { ...elements, console, Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-18T00:00:00'])); } },
    window: { innerWidth: 1200, addEventListener() {} }, navigator: { onLine: true },
    document: { getElementById: id => elements[id] || null, addEventListener() {},
      querySelector: selector => selector === '.view.active' ? { id: 'view-milestones' } : null,
      querySelectorAll: selector => {
        const id = selector.match(/^#(r\w+Checks) input:checked$/)?.[1];
        return id ? [...elements[id].innerHTML.matchAll(/<input[^>]*value="(\d+)" checked/g)].map(m => ({ value: m[1] })) : [];
      },
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    confirm: () => false, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {},
  };
  vm.createContext(context);
  let script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  script = script.replace(/^if\('serviceWorker'[^\n]+/m, '').replace(/^boot\(\);/m, '');
  vm.runInContext(script, context);
  const { state, APP, API } = vm.runInContext('({state,APP,API})', context);
  context.renderAll = () => {};
  context.toast = () => {};
  return { context, state, APP, API, elements };
}

async function verifyFrontend() {
  const { context: c, state, APP, API, elements: e } = frontend();
  state.projects = [{ id: 1, name: '项目甲', client: '客户甲' }, { id: 2, name: '直接节点项目', client: '客户乙' }, { id: 3, name: '已归档项目', status: '已归档' }];
  state.milestones = [{ id: 1, projectId: 1, name: '阶段一', owner: '其他人', due: '2026-09-20' }];
  state.nodes = []; state.issues = []; state.reflections = [];
  APP.online = true; APP.user = { name: '账号昵称', defaultOwner: '我的姓名', role: 'admin' };
  c.openNodeAdd(2);
  assert.equal(e.nOwner.value, '我的姓名');
  assert.equal(e.nMilestone.value, '');
  assert.ok(e.nodeOverlay.classList.contains('open'), 'No-milestone projects open the node form directly');
  assert.ok(!e.msOverlay.classList.contains('open'));
  e.nTitle.value = '直接节点'; e.nProject.value = '2'; e.nDue.value = '2026-09-18'; e.nStatus.value = '进行中';
  const writes = [];
  API.post = async (url, data) => { writes.push({ url, data }); return { id: 20, ...data }; };
  await c.saveNode();
  assert.equal(writes[0].data.milestoneId, null);
  assert.equal(state.nodes[0].milestoneId, null);
  assert.match(c.ganttProject(state.projects[1]), /直接节点/);
  assert.match(c.ganttProject(state.projects[1]), /直接归属项目/);

  c.openNodeAdd(1, 1);
  assert.equal(e.nOwner.value, '我的姓名', 'A milestone owner must not override the personal default');
  assert.equal(e.nMilestone.value, '1');
  c.openNodeEdit(20); e.nOwner.value = '协作人';
  API.patch = async (url, data) => ({ id: Number(url.split('/').pop()), ...data });
  await c.saveNode();
  assert.equal(state.nodes[0].owner, '协作人');
  c.openNodeEdit(20); e.nTitle.value = '失败改名';
  API.patch = async () => { throw new Error('network'); };
  await c.saveNode();
  assert.equal(state.nodes[0].title, '直接节点', 'Failed writes preserve the existing node');
  c.openNodeEdit(20); e.nProject.value = '1'; e.nMilestone.value = ''; e.nTitle.value = '保留编辑草稿';
  c.continueNodeAfterNewMilestone();
  e.mmName.value = '新阶段'; e.mmProject.value = '1'; e.mmStart.value = '2026-09-18'; e.mmDue.value = '2026-09-20'; e.mmStatus.value = '未完成';
  await c.saveMs();
  assert.equal(vm.runInContext('state.editing', c), 20, 'Creating an optional milestone preserves the node being edited');
  assert.equal(e.nTitle.value, '保留编辑草稿');
  assert.equal(e.nMilestone.value, '20');

  c.openIssueAdd();
  assert.equal(e.iOwnerIn.value, '我的姓名');
  assert.equal(e.iCreator.value, '我的姓名');
  APP.online = false;
  e.defaultOwnerInput.value = '新默认';
  await c.savePersonalProfile();
  c.openMsAdd(1); assert.equal(e.mmOwner.value, '新默认');
  c.openNodeAdd(1); assert.equal(e.nOwner.value, '新默认');
  c.openIssueAdd(); assert.equal(e.iOwnerIn.value, '新默认');
  c.openReflectionAdd(); assert.equal(e.rActionOwner.value, '新默认');
  assert.equal(state.nodes[0].owner, '协作人', 'Changing defaults never rewrites existing records');

  state.nodes = [
    { id: 1, projectId: 2, milestoneId: null, title: '本周完成直接节点', owner: '新默认', status: '已完成', completed: '2026-09-14', due: '2026-08-01' },
    { id: 2, projectId: 1, milestoneId: 1, title: '上周完成', owner: '协作人', status: '已完成', completed: '2026-09-13', due: '2026-09-18' },
    { id: 3, projectId: 2, milestoneId: null, title: '周日计划', owner: '协作人', status: '进行中', due: '2026-09-20' },
    { id: 4, projectId: 2, milestoneId: null, title: '下周计划', owner: '新默认', status: '未开始', due: '2026-09-21' },
    { id: 5, projectId: 2, milestoneId: null, title: '上周延期', owner: '协作人', status: '阻塞', due: '2026-09-10' },
    { id: 6, projectId: 2, milestoneId: null, title: '缺少日期', owner: '新默认', status: '已完成', due: '2026-09-18' },
    { id: 7, projectId: 3, milestoneId: null, title: '归档', owner: '新默认', status: '进行中', due: '2026-09-18' },
  ];
  state.issues = [
    { id: 1, projectId: 1, content: '其他项目 P0', priority: 'P0', status: '处理中', due: '2026-09-18' },
    { id: 2, projectId: 2, content: '本周关闭问题', priority: 'P2', owner: '协作人', status: '已关闭', solved: '2026-09-18', due: '2026-09-30' },
  ];
  const items = c.personalListData('both', 'proj:2', 'week');
  assert.deepEqual(Array.from(items.filter(x => x.type === 'node'), x => x.record.id).sort(), [1, 3, 5, 6]);
  assert.equal(items.find(x => x.record.id === 6).section, 'undated');
  e.genSource.value = 'both'; e.genScope.value = 'proj:2'; e.genTime.value = 'week'; c.generate();
  assert.match(e.genOut.value, /2026-09-14 至 2026-09-20/);
  assert.match(e.genOut.value, /已完成（2 项）/);
  assert.match(e.genOut.value, /负责人：协作人/);
  assert.match(e.genOut.value, /P0 0/);
  assert.ok(!e.genOut.value.includes('其他项目 P0'));
  assert.ok(!e.genOut.value.includes('全队'));
  assert.equal(c.personalListData('issue', '', 'week').length, 2);
  const suggested = c.weeklySuggestions('2026-09-14');
  const direct = suggested.done.find(x => x.sourceNodeId === 1);
  assert.equal(direct.sourceMilestoneId, null);
  assert.equal(c.normalizeReviewItem(direct, 'completed').sourceMilestoneId, null);

  c.openReflectionFromNode(1);
  e.rRootCause.value = '本次经验'; e.rSolution.value = '处理方法'; e.rNextAction.value = '继续复用';
  await c.saveReflection();
  assert.equal(state.reflections[0].nodeIds[0], 1);
  assert.equal(state.reflections[0].projectIds[0], 2);
  assert.equal(state.reflections[0].actionOwner, '新默认');
  e.rAnonymize.checked = false;
  const markdown = c.buildReflectionMarkdown();
  assert.match(markdown, /关联节点/); assert.match(markdown, /本周完成直接节点/); assert.match(markdown, /行动负责人：新默认/);
  e.rAnonymize.checked = true;
  const anonymized = c.buildReflectionMarkdown();
  assert.ok(!anonymized.includes('新默认'));
  console.log('Personal frontend checks passed (defaults, independent nodes, reports, reviews).');
}

function d1(sqlite) {
  return { prepare(sql) { let args = []; return {
    bind(...values) { args = values; return this; },
    async first() { return sqlite.prepare(sql).get(...args) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(result.lastInsertRowid), changes: Number(result.changes) } }; },
  }; }, async batch(statements) { return Promise.all(statements.map(s => s.run())); } };
}

async function verifyDatabase() {
  const schema = fs.readFileSync('schema.sql', 'utf8');
  const db = new DatabaseSync(':memory:');
  db.exec(schema.replace(/  default_owner[^\n]+\n/, '').replace('milestone_id INTEGER,', 'milestone_id INTEGER NOT NULL,'));
  db.prepare("INSERT INTO users(id,email,password_hash,salt,name,role,created_at) VALUES(1,'local@example.test','unused','unused','旧姓名','admin',1)").run();
  db.prepare('INSERT INTO projects(id,data,updated_at) VALUES(1,?,1),(2,?,1)').run('{"name":"项目一"}', '{"name":"项目二"}');
  db.prepare('INSERT INTO milestones(id,project_id,data,updated_at) VALUES(1,1,?,1)').run('{"projectId":1,"name":"里程碑"}');
  db.prepare('INSERT INTO nodes(id,project_id,milestone_id,data,updated_at) VALUES(1,1,1,?,1),(2,1,1,?,1),(99,1,1,?,1)').run('{"title":"旧节点","projectId":1,"milestoneId":1}', '{"title":"回收站节点","projectId":1,"milestoneId":1,"deletedAt":1}', '{}');
  db.exec('DELETE FROM nodes WHERE id=99');
  const before = db.prepare('SELECT * FROM nodes ORDER BY id').all();
  db.exec(fs.readFileSync('migrations/0005_personal_workspace.sql', 'utf8'));
  assert.deepEqual(db.prepare('SELECT * FROM nodes ORDER BY id').all(), before, 'Upgrade preserves node IDs, contents, and trash');
  assert.equal(db.prepare('SELECT default_owner FROM users WHERE id=1').get().default_owner, '旧姓名');

  const { onRequest } = await import(pathToFileURL(path.resolve('functions/api/[[path]].js')).href);
  const secret = 'local-fixture-only';
  const payload = Buffer.from(JSON.stringify({ uid: 1, role: 'admin', name: 'stale-token-name', exp: Date.now() + 60000 })).toString('base64url');
  const token = payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
  const env = { DB: d1(db), AUTH_SECRET: secret };
  const request = async (method, route, body) => {
    const response = await onRequest({ request: new Request('http://local.test/api/' + route, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, params: { path: route.split('/') } });
    return { status: response.status, body: await response.json() };
  };
  let response = await request('PATCH', 'account/profile', { defaultOwner: '个人姓名' });
  assert.equal(response.status, 200); assert.equal(response.body.user.defaultOwner, '个人姓名');
  assert.equal((await request('GET', 'me')).body.user.defaultOwner, '个人姓名', 'Fresh sessions read the saved default, not stale token claims');
  assert.equal((await request('PATCH', 'account/profile', { defaultOwner: ' ' })).status, 400);
  response = await request('POST', 'nodes', { projectId: 2, milestoneId: null, title: '独立节点', owner: '个人姓名', status: '已完成', completed: '2026-09-18' });
  assert.equal(response.status, 200); assert.equal(response.body.milestoneId, null); assert.ok(response.body.id > 99, 'Upgrade preserves the old autoincrement sequence');
  const nodeId = response.body.id;
  assert.equal(db.prepare('SELECT milestone_id FROM nodes WHERE id=?').get(nodeId).milestone_id, null);
  assert.equal((await request('PATCH', `nodes/${nodeId}`, { milestoneId: 1 })).status, 400, 'Cross-project links are rejected');
  assert.equal((await request('PATCH', `nodes/${nodeId}`, { projectId: 1, milestoneId: 1 })).status, 200);
  assert.equal((await request('PATCH', `nodes/${nodeId}`, { milestoneId: null })).body.milestoneId, null);
  assert.equal((await request('POST', 'nodes', { projectId: 404 })).status, 400);
  await request('POST', 'reflections', { title: '节点经验', projectIds: [1], nodeIds: [nodeId], issueIds: [], actionOwner: '个人姓名' });
  const backup = (await request('GET', 'backup')).body;
  assert.equal((await request('POST', 'restore', backup)).status, 200);
  const restored = (await request('GET', 'state')).body;
  const reflection = restored.reflections.at(-1);
  assert.notEqual(reflection.nodeIds[0], nodeId, 'Restored reflections reference the new node IDs');
  assert.equal(restored.nodes.find(n => n.id === reflection.nodeIds[0]).milestoneId, null);
  const fresh = new DatabaseSync(':memory:'); fresh.exec(schema);
  assert.equal(fresh.prepare('PRAGMA table_info(nodes)').all().find(c => c.name === 'milestone_id').notnull, 0);
  fresh.close(); db.close();
  console.log('Personal database/API checks passed (upgrade, profiles, links, backup restore).');
}

(async () => { await verifyFrontend(); await verifyDatabase(); })().catch(error => { console.error(error); process.exitCode = 1; });

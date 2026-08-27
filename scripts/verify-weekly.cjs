const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('public/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] || '';
const start = script.indexOf('function mondayOf(');
const end = script.indexOf('function relDate(', start);
if (start < 0 || end < 0) throw new Error('Weekly review functions are missing');

const state = {
  projects: [
    { id: 1, name: '项目甲', status: '进行中' },
    { id: 2, name: '归档项目', status: '已归档' },
  ],
  milestones: [{ id: 1, projectId: 1, name: '交付' }],
  nodes: [
    { id: 1, projectId: 1, milestoneId: 1, title: '周内实际完成', owner: '甲', due: '2026-08-20', completed: '2026-08-24', status: '已完成' },
    { id: 2, projectId: 1, milestoneId: 1, title: '缺少完成日期', owner: '甲', due: '2026-08-25', completed: '', status: '已完成' },
    { id: 3, projectId: 1, milestoneId: 1, title: '下周计划', owner: '乙', due: '2026-08-31', completed: '', status: '进行中' },
    { id: 4, projectId: 1, milestoneId: 1, title: '延期节点', owner: '乙', due: '2026-08-23', completed: '', status: '阻塞' },
    { id: 5, projectId: 1, milestoneId: 1, title: '更远计划', owner: '乙', due: '2026-09-07', completed: '', status: '未开始' },
    { id: 6, projectId: 2, milestoneId: 1, title: '归档项目节点', owner: '丙', due: '2026-09-01', completed: '', status: '未开始' },
  ],
  weeklyReviews: [],
  weekCursor: '2026-08-24',
  weeklyDraft: null,
};
const context = {
  state,
  APP: { online: false, user: null },
  today: new Date('2026-08-27T00:00:00'),
  fmt: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  short: (s) => s ? s.slice(5) : '',
  projectById: (id) => state.projects.find((p) => p.id === Number(id)),
  projectStatus: (p) => p?.status || '进行中',
  milestoneById: (id) => state.milestones.find((m) => m.id === Number(id)),
  confirm: () => true,
  toast: () => {},
  console,
};
vm.createContext(context);
vm.runInContext(script.slice(start, end), context);
context.renderWeekly = () => {};
context.renderWeeklyStatus = () => {};

const suggestions = context.weeklySuggestions('2026-08-24');
assert.deepStrictEqual(Array.from(suggestions.done, (x) => x.sourceNodeId), [1], 'Only nodes with an actual completion date in the selected week are completed');
assert.deepStrictEqual(Array.from(suggestions.next, (x) => x.sourceNodeId), [3], 'Only active-project nodes due in the following week are planned');
assert.deepStrictEqual(Array.from(suggestions.overdue, (x) => x.sourceNodeId), [4], 'Unfinished earlier nodes are carried over');
assert.deepStrictEqual(Array.from(suggestions.missingCompleted, (x) => x.id), [2], 'Completed nodes without dates are reported instead of inferred from due dates');

state.weeklyDraft = context.createWeeklyDraft('2026-08-24');
context.editWeeklyItem('nextItems', 'node-next-3', '人工改写后的重点');
state.nodes.find((n) => n.id === 3).title = '原节点标题已变化';
context.syncWeeklyDraft();
const edited = state.weeklyDraft.nextItems.find((x) => x.sourceNodeId === 3);
assert.strictEqual(edited.text, '人工改写后的重点', 'Sync must preserve edited review text');
assert.strictEqual(edited.sourceChanged, true, 'Source changes are surfaced to the user');

context.deleteWeeklyItem('nextItems', edited.id);
context.syncWeeklyDraft();
assert.ok(!state.weeklyDraft.nextItems.some((x) => x.sourceNodeId === 3), 'Deleted suggestions must not return after sync');
assert.ok(state.weeklyDraft.dismissedSourceNodeIds.includes(3), 'Deleted source node ids are remembered');

let downloaded = null;
context.downloadText = (name, text, type) => { downloaded = { name, text, type }; };
state.weeklyDraft = context.createWeeklyDraft('2026-08-24');
context.exportWeeklyReview('2026-08-24');
assert.ok(downloaded, 'Weekly review export should create a Markdown download');
assert.match(downloaded.text, /## 本周关键进展\n\n1\. /, 'Completed items use an ordered list');
assert.match(downloaded.text, /## 下周重点\n\n1\. [^\n]+\n2\. /, 'Next items use an independent ordered list');
assert.ok(!downloaded.text.includes('## 本周里程碑'), 'Export must not append a milestone section');

console.log('Weekly review rule checks passed.');

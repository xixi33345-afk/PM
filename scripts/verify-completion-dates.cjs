const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('public/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] || '';
const start = script.indexOf('async function persistMissingCompletionDates(');
const end = script.indexOf('async function hydrateAttachmentImages(', start);
if (start < 0 || end < 0) throw new Error('Completion-date backfill function is missing');

(async () => {
  const calls = [];
  const state = {
    nodes: [
      { id: 1, status: '已完成', title: '旧完成节点', completed: '' },
      { id: 2, status: '已完成', title: '已有日期节点', completed: '2026-08-25' },
      { id: 3, status: '进行中', title: '进行中节点', completed: '' },
      { id: 4, status: '已完成', title: '保存失败节点', completed: '' },
    ],
    milestones: [
      { id: 10, status: '已完成', name: '旧完成里程碑', completed: '' },
      { id: 11, status: '未完成', name: '未完成里程碑', completed: '' },
    ],
  };
  const context = {
    state,
    APP: { online: true },
    today: new Date('2026-08-27T00:00:00'),
    fmt: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    isViewerMode: () => false,
    stripForSync: (_table, item) => { const copy = { ...item }; delete copy.id; return copy; },
    API: {
      patch: async (path, data) => {
        calls.push({ path, data });
        if (path === '/nodes/4') throw new Error('mock save failure');
        return { id: Number(path.split('/').pop()), ...data };
      },
    },
    Promise,
  };
  vm.createContext(context);
  vm.runInContext(script.slice(start, end), context);

  const result = await context.persistMissingCompletionDates();
  assert.deepStrictEqual({ ...result }, { filled: 2, failed: 1 }, 'Backfill reports successful and failed writes separately');
  assert.strictEqual(state.nodes[0].completed, '2026-08-27', 'Missing completed node date defaults to today and is persisted');
  assert.strictEqual(state.milestones[0].completed, '2026-08-27', 'Missing completed milestone date defaults to today and is persisted');
  assert.strictEqual(state.nodes[1].completed, '2026-08-25', 'Existing completion dates are preserved');
  assert.strictEqual(state.nodes[3].completed, '', 'A failed API write does not invent a local completion date');
  assert.deepStrictEqual(calls.map((x) => x.path), ['/nodes/1', '/nodes/4', '/milestones/10'], 'Only completed records missing dates are written');

  console.log('Completion-date persistence checks passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

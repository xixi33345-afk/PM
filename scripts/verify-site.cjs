const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/);
if (!script) throw new Error('Inline script is missing');
new Function(script[1]);

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicateIds.length) throw new Error('Duplicate ids: ' + [...new Set(duplicateIds)].join(', '));

const known = new Set(ids);
const references = [...html.matchAll(/getElementById\(['"]([^'"]]+)['"]\)/g)].map((m) => m[1]);
const missing = [...new Set(references.filter((id) => !known.has(id)))];
if (missing.length) throw new Error('Missing ids: ' + missing.join(', '));

for (const fragment of [
  'function openNodeAdd(projectId=null,milestoneId=null,draft=null)',
  'openNodeAdd(${m.projectId},${m.id})',
  'pendingNodeAfterMilestone',
  'id="weeklyHistoryBtn"',
  'id="view-weekly-history"',
  'function weeklySuggestions(value=selectedWeekStart())',
  "n.status==='已完成'&&n.completed&&betweenDates(n.completed,b.start,b.end)",
  'dismissedSourceNodeIds',
  'function renderWeeklyHistory()',
  'function resizeWeeklyTextarea(el)',
  'class="weekly-item-footer"',
  'id="genAddNodeBtn"',
  'value="milestone"',
  'function markdownReviewLine(item,index)',
  'id="mmCompleted"',
  'id="nCompleted"',
  "completed=status==='已完成'?(nCompleted.value||fmt(today)):''",
  "n.completed=status==='已完成'?(n.completed||fmt(today)):''",
]) {
  if (!html.includes(fragment)) throw new Error(`Milestone/node workflow is missing: ${fragment}`);
}
if (html.includes('## 本周里程碑')) throw new Error('Weekly review export must not contain an extra milestone section');

JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
for (const file of ['public/service-worker.js', 'migrations/0003_personal_productivity_core.sql']) {
  if (!fs.existsSync(file)) throw new Error('Missing file: ' + file);
}
const api = fs.readFileSync('functions/api/[[path]].js', 'utf8');
for (const fragment of [
  'async function activeWeeklyReview(',
  'if (table === "weekly_reviews")',
  'const pmap = {}, mmap = {}, nmap = {}, imap = {}',
  'sourceNodeId: nmap[item.sourceNodeId] || null',
  'skippedReviews',
]) {
  if (!api.includes(fragment)) throw new Error(`Weekly review API protection is missing: ${fragment}`);
}
console.log(`Site checks passed: ${ids.length} unique elements.`);

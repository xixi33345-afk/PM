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

JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
for (const file of ['public/service-worker.js', 'migrations/0003_personal_productivity_core.sql']) {
  if (!fs.existsSync(file)) throw new Error('Missing file: ' + file);
}
console.log(`Site checks passed: ${ids.length} unique elements.`);

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = process.argv[2] || '.env.export-build';
const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.vite/manifest.json'), 'utf8'));
function imports(key, seen = new Set()) {
  if (seen.has(key)) return seen;
  seen.add(key);
  for (const dependency of manifest[key]?.imports || []) imports(dependency, seen);
  return seen;
}
const publicKeys = new Set([...imports('index.html'), ...imports('src/pages/LoginPage.tsx')]);
const files = [...publicKeys].map(key => manifest[key]?.file).filter(file => file?.endsWith('.js'));
assert.ok(!files.some(file => /(?:\/App-|\/charts-|\/chart-live-|\/journalExport-|\/jspdf|\/html2canvas|\/AdminPanel-|\/MT5Automation-)/.test(file)), 'public visitors must not eagerly load the dashboard, charts or export tools');
const total = files.reduce((sum, file) => sum + fs.statSync(path.join(dir, file)).size, 0);
assert.ok(total < 1000000, `public JavaScript budget exceeded: ${total} bytes`);
const exportFile = manifest['src/lib/journalExport.ts'].file;
const exportBytes = fs.statSync(path.join(dir, exportFile)).size;
assert.ok(exportBytes < 100000, 'XLSX writer exceeded 100 KB budget');
assert.ok(![...imports('src/lib/csvExport.ts')].some(key => key === 'src/lib/journalExport.ts'), 'CSV must not load XLSX writer');
let beforeBytes = null;
if (fs.existsSync('.env.audit-build/index.html')) {
  const html = fs.readFileSync('.env.audit-build/index.html', 'utf8');
  const js = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map(match => match[1]).filter(file => !/^https?:/.test(file));
  beforeBytes = js.reduce((sum, file) => sum + fs.statSync(path.join('.env.audit-build', file.replace(/^\//, ''))).size, 0);
}
const result = { publicJavaScriptBytes: total, excelExportBytes: exportBytes, beforePublicJavaScriptBytes: beforeBytes, reductionPercent: beforeBytes ? Math.round((1 - total / beforeBytes) * 100) : null, publicFiles: files };
fs.writeFileSync('.env.frontend-budget-results.json', JSON.stringify(result, null, 2));
console.log('PASS: public JS download boundary, CSV/XLSX isolation and XLSX bundle budget');
console.log(JSON.stringify(result, null, 2));

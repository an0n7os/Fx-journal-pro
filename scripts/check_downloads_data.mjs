import fs from 'fs';
import path from 'path';

async function check() {
  const dir = 'c:\\Users\\aswin\\Downloads';
  const csvFile = path.join(dir, 'Supabase Snippet Untitled query (1).csv');
  if (fs.existsSync(csvFile)) {
    const content = fs.readFileSync(csvFile, 'utf8');
    const lines = content.trim().split('\n');
    console.log(`Supabase Snippet CSV total lines: ${lines.length}`);
    console.log('Header:', lines[0]);
    console.log('Line 1:', lines[1]);
    console.log('Last line:', lines[lines.length - 1]);
  }

  const jsonFile = path.join(dir, 'fxjp-test-rows-backup-2026-10-01.json');
  if (fs.existsSync(jsonFile)) {
    const raw = fs.readFileSync(jsonFile, 'utf8');
    const parsed = JSON.parse(raw);
    console.log('\nfxjp-test-rows-backup-2026-10-01.json keys:', Object.keys(parsed));
    if (parsed.tables) {
      for (const [k, v] of Object.entries(parsed.tables)) {
        console.log(`  ${k}: ${Array.isArray(v) ? v.length : typeof v}`);
      }
    }
  }
}

check().catch(console.error);

import fs from 'fs';

const content = fs.readFileSync('server.ts', 'utf8');
const lines = content.split('\n');
const methods = new Set();

for (const line of lines) {
  if (line.includes('supabase.')) {
    const matches = line.matchAll(/\.([a-zA-Z0-9_]+)\(/g);
    for (const m of matches) {
      methods.add(m[1]);
    }
  }
}

console.log('All methods called on supabase/chains:', Array.from(methods));

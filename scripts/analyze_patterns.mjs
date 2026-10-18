import fs from 'fs';

const content = fs.readFileSync('server.ts', 'utf8');
const lines = content.split('\n');
const patterns = new Set();

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('supabase.')) {
    const trimmed = line.trim();
    if (trimmed.length < 120) {
      patterns.add(trimmed);
    }
  }
}

console.log('Sample patterns of supabase usage in server.ts:');
Array.from(patterns).slice(0, 30).forEach(p => console.log('-', p));

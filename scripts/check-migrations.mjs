#!/usr/bin/env node
/**
 * Static consistency check for the SQL migrations.
 *
 * Two migration bugs reached a live Supabase project before this existed, and
 * both aborted the whole run at the statement that hit them:
 *
 *   ERROR: 42703: column "actor_id" does not exist
 *     admin_schema.sql created admin_audit_logs with different column names, so
 *     the later CREATE TABLE IF NOT EXISTS did nothing and the index had
 *     nothing to index.
 *
 *   ERROR: 42804: foreign key constraint ... cannot be implemented
 *     DETAIL: Key columns "sub_admin_id" and "id" are of incompatible types.
 *     users.id is TEXT; two tables declared their reference to it as uuid.
 *
 * Both are visible without a database: replay the files in order, track what
 * each table ends up with, and check every reference and index against that.
 * This does not parse SQL in general — it reads the shapes these files use.
 *
 *   node scripts/check-migrations.mjs
 *
 * Exits non-zero on the first problem found, so it can gate CI.
 */
import fs from 'fs';
import path from 'path';

/** Applied in this order by supabase_setup.sql and by docs/deploy-netlify.md. */
const ORDER = [
  'supabase_schema.sql',
  'admin_schema.sql',
  'add_user_columns.sql',
  'add_otp_columns.sql',
  'add_exit_time_column.sql',
  'billing_and_roles_migration.sql',
  'mt5_ea_schema_migration.sql',
  'mt5_investor_sync_migration.sql',
  'sub_admin_console_migration.sql',
  'partner_portal_migration.sql',
  'mentor_access_migration.sql',
  'fix_rls_policies.sql',
];

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const problems = [];
const note = (file, message) => problems.push(`${file}: ${message}`);

/** table -> { columns: Map<name, type>, createdIn: file, dropped: boolean } */
const tables = new Map();

const bare = (name) => name.replace(/^public\./i, '').toLowerCase();

/** Normalise so that TEXT and "text primary key default ..." compare equal. */
const baseType = (decl) => {
  const m = /^\s*(text|uuid|bigint|integer|int|boolean|jsonb|json|float|double precision|numeric|timestamptz|timestamp with time zone|timestamp|date|serial|bigserial)\b/i
    .exec(decl.trim());
  return m ? m[1].toLowerCase() : null;
};

/** Split a CREATE TABLE body on commas that are not inside parentheses. */
const splitColumns = (body) => {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
};

/** Every reference found, checked once the whole run has been replayed. */
const references = [];
const indexes = [];
/** Columns a no-op CREATE TABLE declared; cleared if a later ALTER adds them. */
const pendingColumns = [];

for (const file of ORDER) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) { note(file, 'listed in the migration order but missing from the repo'); continue; }

  // Comments carry example SQL, so they have to go before anything is matched.
  const sql = fs.readFileSync(full, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '');

  // Statements must be replayed in the order they appear. A CREATE TABLE IF
  // NOT EXISTS whose columns are then added by ALTER statements below it is
  // correct, and processing all the CREATEs before all the ALTERs would
  // report it as broken.
  const statements = [];
  const collect = (re, kind) => {
    for (const m of sql.matchAll(re)) statements.push({ pos: m.index, kind, m });
  };
  collect(/drop\s+table\s+(?:if\s+exists\s+)?([a-z0-9_.]+)/gi, 'drop');
  collect(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_.]+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi, 'create');
  collect(/alter\s+table\s+(?:if\s+exists\s+)?([a-z0-9_.]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)\s+([^;]+);/gi, 'alter');
  statements.sort((a, b) => a.pos - b.pos);

  for (const { kind, m } of statements) {
  if (kind === 'drop') {
    tables.delete(bare(m[1]));
    continue;
  }

  if (kind === 'create') {
    const name = bare(m[1]);
    const existing = tables.get(name);
    const columns = new Map();
    for (const raw of splitColumns(m[2])) {
      const col = /^\s*([a-z0-9_]+)\s+(.+)$/is.exec(raw.trim());
      if (!col) continue;
      const [, colName, rest] = col;
      if (/^(primary|foreign|unique|constraint|check)$/i.test(colName)) continue;
      const type = baseType(rest);
      if (!type) continue;
      columns.set(colName.toLowerCase(), type);
      const ref = /references\s+([a-z0-9_.]+)\s*\(\s*([a-z0-9_]+)\s*\)/i.exec(rest);
      if (ref) references.push({ file, table: name, column: colName.toLowerCase(), type, target: bare(ref[1]), targetColumn: ref[2].toLowerCase() });
    }

    if (existing) {
      // CREATE TABLE IF NOT EXISTS is a no-op here, so the columns this
      // statement declares are NOT created. Unless a later ALTER adds them —
      // checked at the end, once every file has been replayed — this is the
      // admin_audit_logs bug.
      for (const [col, type] of columns) {
        if (!existing.columns.has(col)) {
          pendingColumns.push({ file, table: name, column: col, createdIn: existing.createdIn });
        } else if (existing.columns.get(col) !== type) {
          note(file, `${name}.${col} is ${type} here but ${existing.columns.get(col)} in ${existing.createdIn}`);
        }
      }
    } else {
      tables.set(name, { columns, createdIn: file });
    }
    continue;
  }

  // kind === 'alter'
  {
    const name = bare(m[1]);
    const col = m[2].toLowerCase();
    const type = baseType(m[3]);
    const t = tables.get(name);
    if (!t) { note(file, `ALTER TABLE ${name} but no migration created it`); continue; }
    if (!t.columns.has(col) && type) t.columns.set(col, type);
    const ref = /references\s+([a-z0-9_.]+)\s*\(\s*([a-z0-9_]+)\s*\)/i.exec(m[3]);
    if (ref && type) references.push({ file, table: name, column: col, type, target: bare(ref[1]), targetColumn: ref[2].toLowerCase() });
  }
  }

  for (const m of sql.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?[a-z0-9_]+\s+on\s+([a-z0-9_.]+)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/gi)) {
    indexes.push({ file, table: bare(m[1]), columns: m[2] });
  }
}

for (const p of pendingColumns) {
  if (!tables.get(p.table)?.columns.has(p.column)) {
    note(p.file, `CREATE TABLE IF NOT EXISTS ${p.table} declares "${p.column}", but the table already exists from ${p.createdIn}, so the column is never created and nothing adds it later. Add it with ALTER TABLE ... ADD COLUMN IF NOT EXISTS.`);
  }
}

for (const r of references) {
  const target = tables.get(r.target);
  if (!target) { note(r.file, `${r.table}.${r.column} references ${r.target}, which no migration creates`); continue; }
  const targetType = target.columns.get(r.targetColumn);
  if (!targetType) { note(r.file, `${r.table}.${r.column} references ${r.target}.${r.targetColumn}, which does not exist`); continue; }
  if (targetType !== r.type) {
    note(r.file, `foreign key ${r.table}.${r.column} is ${r.type} but ${r.target}.${r.targetColumn} is ${targetType} — Postgres will refuse this with "incompatible types"`);
  }
}

for (const ix of indexes) {
  const t = tables.get(ix.table);
  if (!t) { note(ix.file, `index on ${ix.table}, which no migration creates`); continue; }
  // Expression indexes such as lower(code) name their column inside the call.
  for (const col of ix.columns.match(/[a-z0-9_]+/gi) || []) {
    const name = col.toLowerCase();
    if (['lower', 'upper', 'desc', 'asc', 'nulls', 'first', 'last', 'coalesce', 'text', 'varchar'].includes(name)) continue;
    if (!t.columns.has(name)) {
      note(ix.file, `index on ${ix.table}(${ix.columns.trim()}) but "${name}" is not a column of ${ix.table}`);
    }
  }
}

if (problems.length) {
  console.error(`Migration check failed — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`Migration check passed: ${tables.size} tables, ${references.length} foreign keys, ${indexes.length} indexes.`);

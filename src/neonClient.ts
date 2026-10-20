import pg from 'pg';
const { Pool } = pg;

interface QueryFilter {
  column: string;
  op: '=' | '!=' | 'IN' | 'NOT IN' | 'IS' | 'IS NOT' | 'LIKE' | 'ILIKE' | '>' | '>=' | '<' | '<=';
  value?: any;
}

interface OrderBy {
  column: string;
  ascending: boolean;
}

export class NeonQueryBuilder {
  private pool: pg.Pool;
  private tableName: string;
  private action: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private selectCols: string = '*';
  private countOption?: 'exact';
  private isHead: boolean = false;
  private filters: QueryFilter[] = [];
  private orderBys: OrderBy[] = [];
  private limitCount?: number;
  private payload?: any;
  private onConflictCols?: string;
  private isSingleMode: boolean = false;
  private isMaybeSingleMode: boolean = false;

  constructor(pool: pg.Pool, tableName: string) {
    this.pool = pool;
    this.tableName = tableName;
  }

  select(columns: string = '*', options?: { count?: 'exact'; head?: boolean }) {
    this.action = 'select';
    this.selectCols = columns;
    if (options?.count === 'exact') this.countOption = 'exact';
    if (options?.head) this.isHead = true;
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ column, op: '=', value });
    return this;
  }

  neq(column: string, value: any) {
    this.filters.push({ column, op: '!=', value });
    return this;
  }

  in(column: string, values: any[]) {
    this.filters.push({ column, op: 'IN', value: values });
    return this;
  }

  ilike(column: string, value: any) {
    this.filters.push({ column, op: 'ILIKE', value });
    return this;
  }

  like(column: string, value: any) {
    this.filters.push({ column, op: 'LIKE', value });
    return this;
  }

  gt(column: string, value: any) {
    this.filters.push({ column, op: '>', value });
    return this;
  }

  gte(column: string, value: any) {
    this.filters.push({ column, op: '>=', value });
    return this;
  }

  lt(column: string, value: any) {
    this.filters.push({ column, op: '<', value });
    return this;
  }

  lte(column: string, value: any) {
    this.filters.push({ column, op: '<=', value });
    return this;
  }

  is(column: string, value: any) {
    if (value === null) {
      this.filters.push({ column, op: 'IS', value: null });
    } else {
      this.filters.push({ column, op: '=', value });
    }
    return this;
  }

  not(column: string, operator: string, value: any) {
    if (operator === 'is' && value === null) {
      this.filters.push({ column, op: 'IS NOT', value: null });
    } else if (operator === 'in') {
      this.filters.push({ column, op: 'NOT IN', value });
    } else {
      this.filters.push({ column, op: '!=', value });
    }
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBys.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  maybeSingle() {
    this.isMaybeSingleMode = true;
    this.limitCount = 1;
    return this;
  }

  single() {
    this.isSingleMode = true;
    this.limitCount = 1;
    return this;
  }

  insert(rows: any | any[], _options?: any) {
    this.action = 'insert';
    this.payload = rows;
    return this;
  }

  upsert(rows: any | any[], options?: { onConflict?: string }) {
    this.action = 'upsert';
    this.payload = rows;
    this.onConflictCols = options?.onConflict || 'id';
    return this;
  }

  update(updates: any) {
    this.action = 'update';
    this.payload = updates;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  // Makes the query builder thenable (awaitable)
  async then(resolve?: (value: any) => any, reject?: (reason?: any) => any): Promise<any> {
    try {
      const result = await this.execute();
      return resolve ? resolve(result) : result;
    } catch (err) {
      if (reject) return reject(err);
      return { data: null, error: err };
    }
  }

  private async execute(): Promise<{ data: any; error: any; count?: number | null }> {
    try {
      if (this.action === 'select') {
        return await this.executeSelect();
      } else if (this.action === 'insert' || this.action === 'upsert') {
        return await this.executeInsertOrUpsert();
      } else if (this.action === 'update') {
        return await this.executeUpdate();
      } else if (this.action === 'delete') {
        return await this.executeDelete();
      }
      return { data: null, error: null };
    } catch (err: any) {
      console.error(`[Neon DB Error in ${this.tableName}]`, err?.message || err);
      return { data: null, error: { message: err?.message || String(err) } };
    }
  }

  private buildWhereClause(startIndex = 1): { sql: string; values: any[] } {
    if (this.filters.length === 0) return { sql: '', values: [] };
    const parts: string[] = [];
    const values: any[] = [];
    let idx = startIndex;

    for (const f of this.filters) {
      const col = `"${f.column}"`;
      if (f.op === 'IS NOT' && f.value === null) {
        parts.push(`${col} IS NOT NULL`);
      } else if (f.op === 'IS' && f.value === null) {
        parts.push(`${col} IS NULL`);
      } else if (f.op === 'IN' || f.op === 'NOT IN') {
        const arr = Array.isArray(f.value) ? f.value : [f.value];
        if (arr.length === 0) {
          parts.push(f.op === 'IN' ? '1=0' : '1=1');
        } else {
          const placeholders = arr.map(() => `$${idx++}`).join(', ');
          values.push(...arr);
          parts.push(`${col} ${f.op} (${placeholders})`);
        }
      } else {
        parts.push(`${col} ${f.op} $${idx++}`);
        values.push(f.value);
      }
    }

    return { sql: ' WHERE ' + parts.join(' AND '), values };
  }

  private async executeSelect() {
    let exactCount: number | null = null;
    const where = this.buildWhereClause(1);

    if (this.countOption === 'exact') {
      const countSql = `SELECT count(*)::int as total FROM "${this.tableName}"${where.sql}`;
      const countRes = await this.pool.query(countSql, where.values);
      exactCount = countRes.rows[0]?.total ?? 0;
    }

    if (this.isHead) {
      return { data: [], error: null, count: exactCount };
    }

    let selectList = '*';
    if (this.selectCols && this.selectCols !== '*') {
      selectList = this.selectCols
        .split(',')
        .map(c => {
          const trimmed = c.trim();
          return trimmed.includes('(') ? trimmed : `"${trimmed}"`;
        })
        .join(', ');
    }

    let sql = `SELECT ${selectList} FROM "${this.tableName}"${where.sql}`;
    if (this.orderBys.length > 0) {
      const orderParts = this.orderBys.map(o => `"${o.column}" ${o.ascending ? 'ASC' : 'DESC'}`);
      sql += ` ORDER BY ${orderParts.join(', ')}`;
    }
    if (this.limitCount !== undefined && this.limitCount !== null) {
      sql += ` LIMIT ${this.limitCount}`;
    }

    const res = await this.pool.query(sql, where.values);
    let data: any = res.rows;

    if (this.isSingleMode) {
      if (res.rows.length === 0) {
        return { data: null, error: { message: 'Row not found', code: 'PGRST116' }, count: exactCount };
      }
      data = res.rows[0];
    } else if (this.isMaybeSingleMode) {
      data = res.rows[0] || null;
    }

    return { data, error: null, count: exactCount };
  }

  private isJsonCol(col: string): boolean {
    const jsonCols = new Set([
      'preferences', 'main_markets', 'mainmarkets', 'tags', 'screenshots', 'metadata',
      'links', 'payout_details', 'payoutdetails', 'mentor_access', 'mentoraccess', 'ea_processed_requests'
    ]);
    return jsonCols.has(col.toLowerCase());
  }

  private formatVal(val: any, col: string) {
    if (val === undefined || val === null) return null;
    if (val instanceof Date) return val.toISOString();

    if (typeof val === 'object') {
      if (this.isJsonCol(col)) {
        return JSON.stringify(val);
      }
      // Empty object passed for a non-JSON column (e.g. invalid date {}), treat as null or now()
      if (Object.keys(val).length === 0) {
        const lower = col.toLowerCase();
        if (lower === 'created_at' || lower === 'createdat') return new Date().toISOString();
        return null;
      }
      return JSON.stringify(val);
    }
    return val;
  }

  private async executeInsertOrUpsert() {
    const rawRows = Array.isArray(this.payload) ? this.payload : [this.payload];
    if (rawRows.length === 0) return { data: [], error: null };

    // Get all unique columns across all rows
    const colSet = new Set<string>();
    for (const r of rawRows) {
      if (r && typeof r === 'object') {
        Object.keys(r).forEach(k => colSet.add(k));
      }
    }
    const cols = Array.from(colSet);
    if (cols.length === 0) return { data: [], error: null };

    const quotedCols = cols.map(c => `"${c}"`).join(', ');
    const valuePlaceholders: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const row of rawRows) {
      const rowPlaceholders: string[] = [];
      for (const col of cols) {
        rowPlaceholders.push(`$${idx++}`);
        values.push(this.formatVal(row[col], col));
      }
      valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
    }

    let sql = `INSERT INTO "${this.tableName}" (${quotedCols}) VALUES ${valuePlaceholders.join(', ')}`;

    if (this.action === 'upsert' && this.onConflictCols) {
      const conflictCols = this.onConflictCols
        .split(',')
        .map(c => `"${c.trim()}"`)
        .join(', ');
      
      const updateCols = cols
        .filter(c => !this.onConflictCols!.split(',').map(x => x.trim()).includes(c))
        .map(c => `"${c}" = EXCLUDED."${c}"`);

      if (updateCols.length > 0) {
        sql += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateCols.join(', ')}`;
      } else {
        sql += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
      }
    }

    sql += ' RETURNING *';

    const res = await this.pool.query(sql, values);
    const data = Array.isArray(this.payload) ? res.rows : (res.rows[0] || null);
    return { data, error: null };
  }

  private async executeUpdate() {
    if (!this.payload || typeof this.payload !== 'object') {
      return { data: [], error: null };
    }

    const cols = Object.keys(this.payload);
    if (cols.length === 0) return { data: [], error: null };

    const setParts: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const col of cols) {
      setParts.push(`"${col}" = $${idx++}`);
      values.push(this.formatVal(this.payload[col], col));
    }

    const where = this.buildWhereClause(idx);
    values.push(...where.values);

    const sql = `UPDATE "${this.tableName}" SET ${setParts.join(', ')}${where.sql} RETURNING *`;
    const res = await this.pool.query(sql, values);
    return { data: res.rows, error: null };
  }

  private async executeDelete() {
    const where = this.buildWhereClause(1);
    const sql = `DELETE FROM "${this.tableName}"${where.sql} RETURNING *`;
    const res = await this.pool.query(sql, where.values);
    return { data: res.rows, error: null };
  }
}

export function createNeonClient(connectionString: string) {
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });

  // Handle idle connection resets from AWS / Neon poolers without crashing the node process
  pool.on('error', (err: any) => {
    console.warn('[Neon Pool Idle Event]:', err?.message || err);
  });

  return {
    pool,
    from(table: string) {
      return new NeonQueryBuilder(pool, table);
    },
    auth: {
      async getUser(token: string) {
        try {
          if (!token) return { data: { user: null }, error: null };
          // Check session in Neon DB session table (Better Auth)
          const sessionRes = await pool.query(
            'SELECT s.*, u.* FROM "session" s JOIN "user" u ON s."userId" = u.id WHERE s.token = $1 LIMIT 1',
            [token]
          );
          if (sessionRes.rows.length > 0) {
            const row = sessionRes.rows[0];
            return {
              data: {
                user: {
                  id: row.id,
                  email: row.email,
                  user_metadata: { name: row.name, avatar: row.image }
                }
              },
              error: null
            };
          }
          return { data: { user: null }, error: null };
        } catch (err: any) {
          return { data: { user: null }, error: { message: err?.message || String(err) } };
        }
      },
      admin: {
        async listUsers({ perPage = 100 } = {}) {
          try {
            const res = await pool.query('SELECT * FROM "user" LIMIT $1', [perPage]);
            return { data: { users: res.rows }, error: null };
          } catch (err: any) {
            return { data: { users: [] }, error: { message: err?.message || String(err) } };
          }
        },
        async updateUserById(id: string, updates: any) {
          try {
            const cols = Object.keys(updates);
            if (cols.length === 0) return { data: null, error: null };
            const sets = cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ');
            const vals = cols.map(c => updates[c]);
            const res = await pool.query(`UPDATE "user" SET ${sets} WHERE id = $1 RETURNING *`, [id, ...vals]);
            return { data: { user: res.rows[0] || null }, error: null };
          } catch (err: any) {
            return { data: null, error: { message: err?.message || String(err) } };
          }
        },
        async createUser(userAttrs: any) {
          try {
            const id = userAttrs.id || `user_${Date.now()}`;
            const email = userAttrs.email;
            const res = await pool.query(
              'INSERT INTO "user" (id, email, name, "createdAt", "updatedAt") VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email RETURNING *',
              [id, email, userAttrs.user_metadata?.name || '']
            );
            return { data: { user: res.rows[0] }, error: null };
          } catch (err: any) {
            return { data: null, error: { message: err?.message || String(err) } };
          }
        }
      }
    }
  };
}

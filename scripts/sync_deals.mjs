import pg from 'pg';

const NEW_DB = 'postgresql://neondb_owner:npg_Mun6aYkg4AUp@ep-square-poetry-bdg7lppf-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require';
const OLD_DB = 'postgresql://neondb_owner:npg_c1tdm3upqiCZ@ep-square-rain-a1z1psjs-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
  const oldPool = new pg.Pool({ connectionString: OLD_DB });
  const newPool = new pg.Pool({ connectionString: NEW_DB });

  const oldDeals = (await oldPool.query('SELECT * FROM mt5_deals;')).rows;
  const newDealIds = new Set((await newPool.query('SELECT id FROM mt5_deals;')).rows.map(r => r.id));
  
  let inserted = 0;
  for (const d of oldDeals) {
    if (!newDealIds.has(d.id)) {
      const keys = Object.keys(d);
      const cols = keys.map(k => `"${k}"`).join(', ');
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const values = keys.map(k => {
        const v = d[k];
        if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
          return JSON.stringify(v);
        }
        return v;
      });
      try {
        await newPool.query(`INSERT INTO mt5_deals (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING;`, values);
        inserted++;
      } catch (e) {
        console.warn('Deal insert error:', e.message);
      }
    }
  }

  console.log(`Re-inserted missing mt5_deals: ${inserted}`);
  const finalCount = (await newPool.query('SELECT count(*) FROM mt5_deals;')).rows[0].count;
  console.log(`Final mt5_deals in New DB: ${finalCount}`);

  await oldPool.end();
  await newPool.end();
}

main().catch(console.error);

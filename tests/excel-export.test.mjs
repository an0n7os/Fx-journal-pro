import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
import { readSheet } from 'read-excel-file/node';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { unzipSync, strFromU8 } = createRequire(require.resolve('write-excel-file/package.json'))('fflate');
const { createJournalWorkbook, csvCell } = await tsImport('../src/lib/journalExport.ts', import.meta.url);
const trade = overrides => ({ id: 't1', accountId: 'a1', symbol: 'EURUSD', type: 'Buy',
  entryPrice: 1.08123, exitPrice: 1.09123, date: '2026-10-01T10:15:00Z', exitTime: '2026-10-01T11:30:00Z',
  lotSize: 0.1, profit: 100, commission: -7, swap: -2, notes: 'പരിശോധന "quoted"\nsecond line', emotion: 'Calm', ...overrides });
const make = async trades => {
  const blob = await createJournalWorkbook({ trades, accountName: '=UNTRUSTED & <Account>', period: 'All Time', exportedAt: new Date('2026-10-31T00:00:00Z') });
  const buffer = Buffer.from(await blob.arrayBuffer());
  return { data: await readSheet(buffer, 'Journal'), zip: unzipSync(buffer) };
};
test('XLSX round trip preserves decimal prices, UTF-8 notes, signed costs and correct net totals', async () => {
  const { data, zip } = await make([trade({}), trade({ id: 't2', type: 'Sell', profit: -20, commission: -3, swap: 1 }), trade({ id: 'deposit', type: 'Deposit', profit: 5000, commission: 0, swap: 0, lotSize: 0 })]);
  assert.equal(data[0][0], 'FX JOURNAL PRO - TRADING JOURNAL');
  assert.equal(data[2][0], 'Account: =UNTRUSTED & <Account>');
  assert.equal(data[7][2], 1.08123);
  assert.equal(data[7][8], -7);
  assert.equal(data[7][9], -2);
  assert.equal(data[7][10], 91);
  assert.equal(data[7][12], trade({}).notes);
  assert.equal(data[8][10], -22);
  assert.equal(data[10][0], 'TRADE TOTALS');
  assert.equal(data[10][10], 69);
  assert.equal(data[7][16], 2); // deposits excluded from trading statistics
  assert.equal(data[13][16], 69);
  const sheetXml = strFromU8(zip['xl/worksheets/sheet1.xml']);
  assert.match(sheetXml, /mergeCell ref="A1:Q1"/);
  assert.match(sheetXml, /state="frozen"/);
  assert.match(strFromU8(zip['xl/styles.xml']), /#,##0.00/);
});
test('formula-shaped user text stays text with no worksheet formulas or external links', async () => {
  const note = '=HYPERLINK("https://example.invalid","click")';
  const { data, zip } = await make([trade({ notes: note })]);
  assert.equal(data[7][12], note);
  assert.doesNotMatch(strFromU8(zip['xl/worksheets/sheet1.xml']), /<f[ >]/);
  assert.ok(!Object.keys(zip).some(n => n.includes('externalLinks')));
});
test('empty export opens and retains summary with finite zero totals', async () => {
  const { data } = await make([]);
  assert.equal(data[7][0], 'TRADE TOTALS');
  assert.equal(data[7][10], 0);
  assert.equal(data[7][15], 'Total Trades');
  assert.equal(data[7][16], 0);
  assert.equal(data[13][16], 0);
});
test('large export retains every trade without dropping summary or footer', async () => {
  const trades = Array.from({ length: 1500 }, (_, i) => trade({ id: String(i), notes: `Record ${i}`, profit: 1, commission: 0, swap: 0 }));
  const { data } = await make(trades);
  assert.equal(data[1506][12], 'Record 1499');
  assert.equal(data[1507][10], 1500);
  assert.equal(data[7][16], 1500);
  assert.equal(data.at(-1)[0], 'https://fxjournalpro.com');
});
test('invalid financial data is rejected rather than exporting NaN or Infinity', async () => {
  await assert.rejects(() => make([trade({ profit: Infinity })]), /invalid number/);
  await assert.rejects(() => make([trade({ commission: 'not-a-number' })]), /invalid number/);
});
test('CSV escapes quotes/newlines and neutralizes text formulas without changing negative numbers', () => {
  assert.equal(csvCell(-12.5), '-12.5');
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell(' \t@SUM(A1)'), "' \t@SUM(A1)");
  assert.equal(csvCell('a,"b"\nsecond'), '"a,""b""\nsecond"');
  assert.equal(csvCell('മലയാളം'), 'മലയാളം');
});

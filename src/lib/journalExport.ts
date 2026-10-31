import writeExcelFile, { type CellObject, type Row, type SheetData } from 'write-excel-file/universal';
import type { Trade } from '../types';

export interface JournalExport {
  trades: Trade[];
  accountName: string;
  period: string;
  exportedAt?: Date;
}

const money = '#,##0.00;[Red]-#,##0.00';
const colors = { navy: '#1F4E79', blue: '#2F5B8E', border: '#B7C4D6', text: '#1F2937', green: '#1E7D32', red: '#C62828' };
const number = (value: unknown): number => {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('A trade contains an invalid number. Correct it before exporting.');
  return n;
};
const isTrade = (trade: Trade) => trade.type === 'Buy' || trade.type === 'Sell';
export const netTradeProfit = (trade: Trade): number => number(trade.profit) + number(trade.commission) + number(trade.swap);

function dateText(iso?: string): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Explicit String cells keep user notes/account names as text, never formulas. */
function cell(value: string | number, style: Partial<CellObject> = {}): CellObject {
  return {
    value, type: typeof value === 'number' ? Number : String,
    fontFamily: 'Calibri', fontSize: 10, textColor: colors.text,
    align: typeof value === 'number' ? 'right' : 'left', alignVertical: 'center',
    borderStyle: 'thin', borderColor: colors.border, ...style,
  };
}

export function buildJournalSheet(input: JournalExport): SheetData {
  const data: SheetData = [];
  const put = (row: number, col: number, value: CellObject) => {
    data[row - 1] ||= [];
    data[row - 1][col - 1] = value;
  };
  const band = (row: number, text: string, large = false) => put(row, 1, cell(text, {
    columnSpan: 17, backgroundColor: colors.navy, textColor: '#FFFFFF',
    fontWeight: 'bold', fontSize: large ? 18 : 10, height: large ? 36 : 22, align: 'center',
  }));
  band(1, 'FX JOURNAL PRO - TRADING JOURNAL', true);
  band(2, 'Trading Performance Report');
  const exportedAt = input.exportedAt ?? new Date();
  [
    `Account: ${input.accountName}`, `Period: ${input.period}`,
    `Exported: ${exportedAt.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
  ].forEach((text, i) => put(i + 3, 1, cell(text, { columnSpan: 17, backgroundColor: '#EEF2F7', height: 18 })));
  data[5] = [cell('', { height: 6, borderStyle: undefined })];
  const headers = ['Symbol', 'Type', 'Entry', 'Exit', 'Entry Time', 'Exit Time', 'Volume', 'Profit', 'Commission', 'Swap', 'Net P/L', 'Emotion', 'Notes'];
  headers.forEach((title, i) => put(7, i + 1, cell(title, {
    backgroundColor: colors.blue, textColor: '#FFFFFF', fontWeight: 'bold', align: 'center', height: 24,
  })));
  put(7, 16, cell('PERFORMANCE SUMMARY', { columnSpan: 2, backgroundColor: colors.navy, textColor: '#FFFFFF', fontWeight: 'bold', align: 'center', height: 24 }));
  input.trades.forEach((trade, i) => {
    const values = [trade.symbol, trade.type, number(trade.entryPrice), number(trade.exitPrice),
      dateText(trade.date), dateText(trade.exitTime), number(trade.lotSize), number(trade.profit),
      number(trade.commission), number(trade.swap), netTradeProfit(trade), trade.emotion || '-', trade.notes || '-'];
    values.forEach((value, col) => put(i + 8, col + 1, cell(value, {
      height: 24, backgroundColor: i % 2 ? '#F4F7FB' : '#FFFFFF',
      ...(col >= 6 && col <= 10 ? { format: col === 6 ? '0.00' : money } : {}),
      ...(col === 10 ? { textColor: Number(value) < 0 ? colors.red : colors.green, fontWeight: 'bold' as const } : {}),
      ...(col === 12 ? { wrap: true } : {}),
    })));
  });
  const trades = input.trades.filter(isTrade);
  const profits = trades.map(netTradeProfit);
  const wins = profits.filter(p => p > 0);
  const losses = profits.filter(p => p < 0);
  const total = (values: number[]) => Math.round(values.reduce((s, n) => s + n, 0) * 100) / 100;
  const net = total(profits);
  const summary: [string, number, string][] = [
    ['Total Trades', trades.length, '0'], ['No. of Winning Trades', wins.length, '0'],
    ['No. of Losing Trades', losses.length, '0'], ['Win Rate (%)', trades.length ? wins.length * 100 / trades.length : 0, '0.0'],
    ['Total Profit (net)', total(wins), money], ['Total Loss (net)', Math.abs(total(losses)), money],
    ['Trading Net Profit/Loss', net, money],
  ];
  summary.forEach(([label, value, format], i) => {
    put(i + 8, 16, cell(label, { backgroundColor: '#F1F5FA', fontWeight: 'bold', height: 24 }));
    put(i + 8, 17, cell(value, { format, fontWeight: 'bold', textColor: value < 0 ? colors.red : colors.text }));
  });
  const totalsRow = 8 + input.trades.length;
  const totals: Row = Array.from({ length: 13 }, () => cell('', { backgroundColor: '#E3EAF3', fontWeight: 'bold', height: 24 }));
  totals[0] = cell('TRADE TOTALS', { backgroundColor: '#E3EAF3', fontWeight: 'bold' });
  for (const [col, field] of [[6, 'lotSize'], [7, 'profit'], [8, 'commission'], [9, 'swap']] as const) {
    totals[col] = cell(total(trades.map(t => number(t[field]))), { format: col === 6 ? '0.00' : money, backgroundColor: '#E3EAF3', fontWeight: 'bold' });
  }
  totals[10] = cell(net, { format: money, backgroundColor: '#E3EAF3', fontWeight: 'bold', textColor: net < 0 ? colors.red : colors.green });
  // Keep summary columns intact when there are fewer than seven trade rows.
  data[totalsRow - 1] = [...totals, ...(data[totalsRow - 1]?.slice(13) || [])];
  const footer = Math.max(totalsRow + 3, 17);
  put(footer - 1, 1, cell('Trade totals exclude deposits/withdrawals. Net P/L = profit + signed commission + swap.', { columnSpan: 17, textColor: '#6B7280', height: 20 }));
  band(footer, 'https://fxjournalpro.com');
  // Fill array holes explicitly: the writer requires one entry per sheet row.
  return Array.from({ length: data.length }, (_, i) => data[i] || []);
}

export async function createJournalWorkbook(input: JournalExport): Promise<Blob> {
  return writeExcelFile(buildJournalSheet(input), {
    sheet: 'Journal', stickyRowsCount: 7, showGridLines: false, orientation: 'landscape',
    columns: [14, 13, 14, 14, 22, 22, 11, 15, 15, 13, 16, 14, 44, 3, 3, 28, 18].map(width => ({ width })),
  }).toBlob();
}

export { csvCell } from './csvExport';

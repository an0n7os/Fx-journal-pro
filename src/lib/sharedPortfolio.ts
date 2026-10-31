const round = (n: number) => Math.round(n * 100) / 100;
const finite = (n: unknown): number | null => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n)) ? Number(n) : null;
export function sharedPortfolio(account: any) {
  if (!account) return null;
  const startingCapital = finite(account.startingBalance);
  const currentBalance = finite(account.currentBalance);
  const netProfit = startingCapital !== null && currentBalance !== null ? round(currentBalance - startingCapital) : null;
  return { name: String(account.name || 'Portfolio'), currency: /^[A-Z]{3}$/.test(account.currency || '') ? account.currency : 'USD',
    startingCapital, currentBalance, netProfit,
    growthPercent: startingCapital !== null && startingCapital > 0 && netProfit !== null ? round(netProfit / startingCapital * 100) : null };
}
export function sharedBalanceCurve(trades: any[], startingCapital: number, cutoff = -Infinity) {
  const pnl = (t: any) => Number(t.profit ?? t.pnl ?? 0) + Number(t.commission || 0) + Number(t.swap || 0);
  const rows = trades.filter(t => Number.isFinite(new Date(t.date).getTime())).sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let balance = startingCapital + rows.filter(t => new Date(t.date).getTime() < cutoff).reduce((s,t) => s + pnl(t), 0);
  const curve = [{ tradeNum: 0, date: '', pnl: 0, equity: round(balance) }];
  for (const t of rows.filter(t => new Date(t.date).getTime() >= cutoff)) {
    balance += pnl(t);
    curve.push({ tradeNum: curve.length, date: String(t.date).slice(0,10), pnl: round(pnl(t)), equity: round(balance) });
  }
  return curve;
}

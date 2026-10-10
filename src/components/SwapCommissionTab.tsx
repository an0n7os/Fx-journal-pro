import React, { useState, useMemo } from 'react';
import {
  TrendingDown, TrendingUp, Search, Download, Filter, Receipt,
  DollarSign, ArrowUpDown, ChevronDown, ChevronUp, Layers, HelpCircle,
  AlertCircle, ShieldCheck
} from 'lucide-react';
import { TradingAccount, Trade } from '../types';

interface SwapCommissionTabProps {
  accounts: TradingAccount[];
  trades: Trade[];
  selectedAccountId: string;
  onSelectAccount: (accountId: string) => void;
  currency?: string;
}

export default function SwapCommissionTab({
  accounts,
  trades,
  selectedAccountId,
  onSelectAccount,
  currency = 'USD'
}: SwapCommissionTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [chargeFilter, setChargeFilter] = useState<'all' | 'negative_swap' | 'positive_swap' | 'has_commission'>('all');
  const [sortField, setSortField] = useState<'date' | 'commission' | 'swap' | 'totalFees' | 'profit'>('date');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Filter MT5 accounts
  const mt5Accounts = useMemo(() => {
    return accounts.filter(a => a.isMt5Sync);
  }, [accounts]);

  const activeAccount = useMemo(() => {
    return accounts.find(a => a.id === selectedAccountId) || mt5Accounts[0] || accounts[0];
  }, [accounts, selectedAccountId, mt5Accounts]);

  const accCurrency = activeAccount?.currency || currency;

  const formatMoney = (val: number) => {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: accCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(val);
    } catch {
      return `${accCurrency} ${val.toFixed(2)}`;
    }
  };

  // Filter trades for the selected account (exclude deposits/withdrawals)
  const accountTrades = useMemo(() => {
    if (!activeAccount) return [];
    return trades.filter(t => t.accountId === activeAccount.id && t.type !== 'Deposit' && t.type !== 'Withdrawal');
  }, [trades, activeAccount]);

  // Aggregate statistics
  const stats = useMemo(() => {
    let totalCommission = 0;
    let totalSwap = 0;
    let totalLots = 0;
    let grossProfit = 0;
    let negativeSwapTotal = 0;
    let positiveSwapTotal = 0;

    for (const t of accountTrades) {
      const comm = t.commission || 0;
      const sw = t.swap || 0;
      totalCommission += comm;
      totalSwap += sw;
      totalLots += t.lotSize || 0;
      grossProfit += t.profit || 0;

      if (sw < 0) negativeSwapTotal += sw;
      if (sw > 0) positiveSwapTotal += sw;
    }

    const totalFees = totalCommission + totalSwap;
    const netProfit = grossProfit + totalFees;
    const absFees = Math.abs(totalFees);
    const feeImpactPercent = grossProfit !== 0 ? Math.min(100, (absFees / Math.abs(grossProfit)) * 100) : 0;
    const avgCommissionPerLot = totalLots > 0 ? Math.abs(totalCommission) / totalLots : 0;

    return {
      totalCommission,
      totalSwap,
      totalFees,
      grossProfit,
      netProfit,
      totalLots,
      negativeSwapTotal,
      positiveSwapTotal,
      feeImpactPercent,
      avgCommissionPerLot,
      tradeCount: accountTrades.length
    };
  }, [accountTrades]);

  // Filter & sort table rows
  const filteredTrades = useMemo(() => {
    return accountTrades
      .filter(t => {
        const comm = t.commission || 0;
        const sw = t.swap || 0;

        if (chargeFilter === 'negative_swap' && sw >= 0) return false;
        if (chargeFilter === 'positive_swap' && sw <= 0) return false;
        if (chargeFilter === 'has_commission' && Math.abs(comm) === 0) return false;

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const sym = (t.symbol || '').toLowerCase();
          const ticket = String(t.ticket || t.eaDealId || t.id).toLowerCase();
          if (!sym.includes(q) && !ticket.includes(q)) return false;
        }

        return true;
      })
      .sort((a, b) => {
        let valA = 0;
        let valB = 0;

        if (sortField === 'date') {
          valA = new Date(a.date).getTime();
          valB = new Date(b.date).getTime();
        } else if (sortField === 'commission') {
          valA = a.commission || 0;
          valB = b.commission || 0;
        } else if (sortField === 'swap') {
          valA = a.swap || 0;
          valB = b.swap || 0;
        } else if (sortField === 'totalFees') {
          valA = (a.commission || 0) + (a.swap || 0);
          valB = (b.commission || 0) + (b.swap || 0);
        } else if (sortField === 'profit') {
          valA = a.profit || 0;
          valB = b.profit || 0;
        }

        return sortAsc ? valA - valB : valB - valA;
      });
  }, [accountTrades, chargeFilter, searchQuery, sortField, sortAsc]);

  // Export CSV
  const handleExportCSV = () => {
    if (!filteredTrades.length) return;
    const headers = ['Date', 'Ticket', 'Symbol', 'Type', 'Lot Size', 'Commission', 'Swap', 'Total Charges', 'Gross Profit', 'Net Profit'];
    const rows = filteredTrades.map(t => {
      const comm = t.commission || 0;
      const sw = t.swap || 0;
      const totalCost = comm + sw;
      const gross = t.profit || 0;
      const net = gross + totalCost;
      return [
        t.date,
        t.ticket || t.eaDealId || t.id,
        t.symbol,
        t.type,
        t.lotSize,
        comm.toFixed(2),
        sw.toFixed(2),
        totalCost.toFixed(2),
        gross.toFixed(2),
        net.toFixed(2)
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `swap_commission_${activeAccount?.name || 'mt5'}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Top Header Card */}
      <div className="dx-panel p-5 sm:p-6 bg-gradient-to-br from-violet-600/10 via-slate-900/40 to-slate-950 border border-violet-500/20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-violet-500/20 text-violet-400">
                <Receipt className="h-4 w-4" />
              </span>
              <span className="text-xs font-bold text-violet-400 tracking-wider uppercase font-mono">
                Brokerage Transparency
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              Swap Charges & Broker Commission
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 max-w-2xl">
              Track financing rollover fees, broker execution commissions, and net fee impact across all MT5 synced trade executions.
            </p>
          </div>

          {/* Account Selector */}
          <div className="flex items-center gap-2.5 self-start md:self-center">
            <div className="relative">
              <select
                value={activeAccount?.id || ''}
                onChange={e => onSelectAccount(e.target.value)}
                className="appearance-none bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 pr-9 text-xs font-bold text-slate-800 dark:text-slate-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500 cursor-pointer"
              >
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} {acc.isMt5Sync ? '(MT5)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            </div>

            {filteredTrades.length > 0 && (
              <button
                type="button"
                onClick={handleExportCSV}
                className="px-3.5 py-2.5 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                title="Export trade fees to CSV"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Export</span>
              </button>
            )}
          </div>
        </div>

        {/* Warning if account is not MT5 */}
        {!activeAccount?.isMt5Sync && (
          <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              This account was created manually. Automated swap rollover and lot commissions are populated directly on MT5-synced accounts.
            </span>
          </div>
        )}
      </div>

      {/* 4 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Commission */}
        <div className="dx-panel p-5 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Commissions</span>
            <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 dark:text-rose-400">
              <DollarSign className="h-4 w-4" />
            </span>
          </div>
          <div className="my-3">
            <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-slate-900 dark:text-white tabular-nums">
              {formatMoney(stats.totalCommission)}
            </span>
          </div>
          <div className="pt-2 border-t border-slate-100 dark:border-white/5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Avg / Lot</span>
            <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
              {formatMoney(stats.avgCommissionPerLot)}
            </span>
          </div>
        </div>

        {/* Total Swap */}
        <div className="dx-panel p-5 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Swap (Rollover)</span>
            <span className={`p-1.5 rounded-lg ${stats.totalSwap >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
              {stats.totalSwap >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            </span>
          </div>
          <div className="my-3">
            <span className={`text-2xl sm:text-3xl font-black font-mono tracking-tight tabular-nums ${
              stats.totalSwap >= 0 ? 'text-emerald-500' : 'text-rose-500'
            }`}>
              {stats.totalSwap >= 0 ? '+' : ''}{formatMoney(stats.totalSwap)}
            </span>
          </div>
          <div className="pt-2 border-t border-slate-100 dark:border-white/5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Paid vs Earned</span>
            <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
              {formatMoney(stats.negativeSwapTotal)} / +{formatMoney(stats.positiveSwapTotal)}
            </span>
          </div>
        </div>

        {/* Combined Brokerage Fees */}
        <div className="dx-panel p-5 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Combined Fees</span>
            <span className="p-1.5 rounded-lg bg-violet-500/10 text-violet-400">
              <Receipt className="h-4 w-4" />
            </span>
          </div>
          <div className="my-3">
            <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-slate-900 dark:text-white tabular-nums">
              {formatMoney(stats.totalFees)}
            </span>
          </div>
          <div className="pt-2 border-t border-slate-100 dark:border-white/5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Fee Drain</span>
            <span className="font-mono font-bold text-amber-500 dark:text-amber-400">
              {stats.feeImpactPercent.toFixed(1)}% of Gross P/L
            </span>
          </div>
        </div>

        {/* Net Profit Impact */}
        <div className="dx-panel p-5 rounded-2xl flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Net Closed P/L</span>
            <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
              <ShieldCheck className="h-4 w-4" />
            </span>
          </div>
          <div className="my-3">
            <span className={`text-2xl sm:text-3xl font-black font-mono tracking-tight tabular-nums ${
              stats.netProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'
            }`}>
              {stats.netProfit >= 0 ? '+' : ''}{formatMoney(stats.netProfit)}
            </span>
          </div>
          <div className="pt-2 border-t border-slate-100 dark:border-white/5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Gross vs Net</span>
            <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
              {formatMoney(stats.grossProfit)} → {formatMoney(stats.netProfit)}
            </span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setChargeFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              chargeFilter === 'all'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10'
            }`}
          >
            All Executions ({accountTrades.length})
          </button>
          <button
            type="button"
            onClick={() => setChargeFilter('negative_swap')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              chargeFilter === 'negative_swap'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10'
            }`}
          >
            Negative Swap Paid
          </button>
          <button
            type="button"
            onClick={() => setChargeFilter('positive_swap')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              chargeFilter === 'positive_swap'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10'
            }`}
          >
            Positive Swap Earned
          </button>
          <button
            type="button"
            onClick={() => setChargeFilter('has_commission')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              chargeFilter === 'has_commission'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10'
            }`}
          >
            With Commission
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search symbol or ticket…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>
      </div>

      {/* Trade-wise Details Table */}
      <div className="dx-panel rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-white/[0.03] border-b border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 text-[10.5px] uppercase font-bold tracking-wider select-none">
                <th
                  className="py-3 px-4 cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  onClick={() => { setSortField('date'); setSortAsc(!sortAsc); }}
                >
                  <div className="flex items-center gap-1">
                    <span>Date & Time</span>
                    {sortField === 'date' && (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                  </div>
                </th>
                <th className="py-3 px-3">Ticket #</th>
                <th className="py-3 px-3">Symbol</th>
                <th className="py-3 px-3">Direction</th>
                <th className="py-3 px-3">Volume</th>
                <th
                  className="py-3 px-3 text-right cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  onClick={() => { setSortField('commission'); setSortAsc(!sortAsc); }}
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Commission</span>
                    {sortField === 'commission' && (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                  </div>
                </th>
                <th
                  className="py-3 px-3 text-right cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  onClick={() => { setSortField('swap'); setSortAsc(!sortAsc); }}
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Swap</span>
                    {sortField === 'swap' && (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                  </div>
                </th>
                <th
                  className="py-3 px-3 text-right cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  onClick={() => { setSortField('totalFees'); setSortAsc(!sortAsc); }}
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Total Fees</span>
                    {sortField === 'totalFees' && (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                  </div>
                </th>
                <th
                  className="py-3 px-4 text-right cursor-pointer hover:text-slate-900 dark:hover:text-white"
                  onClick={() => { setSortField('profit'); setSortAsc(!sortAsc); }}
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Net Profit</span>
                    {sortField === 'profit' && (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
              {filteredTrades.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 text-xs">
                    No trade executions found matching the selected filter.
                  </td>
                </tr>
              ) : (
                filteredTrades.map(trade => {
                  const comm = trade.commission || 0;
                  const sw = trade.swap || 0;
                  const totalFee = comm + sw;
                  const gross = trade.profit || 0;
                  const net = gross + totalFee;
                  const ticketStr = trade.ticket || trade.eaDealId || trade.id.slice(0, 8);

                  return (
                    <tr
                      key={trade.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                        {trade.date ? new Date(trade.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap font-mono text-slate-500 text-[11px]">
                        #{ticketStr}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap font-bold text-slate-900 dark:text-white">
                        {trade.symbol}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded ${
                          trade.type === 'Buy'
                            ? 'bg-blue-500/15 text-blue-500 dark:text-blue-400'
                            : 'bg-orange-500/15 text-orange-500 dark:text-orange-400'
                        }`}>
                          {trade.type}
                        </span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap font-mono text-slate-700 dark:text-slate-300">
                        {trade.lotSize}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                        {comm !== 0 ? formatMoney(comm) : '—'}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold tabular-nums">
                        {sw !== 0 ? (
                          <span className={sw >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                            {sw >= 0 ? '+' : ''}{formatMoney(sw)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                        {totalFee !== 0 ? formatMoney(totalFee) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-extrabold tabular-nums">
                        <span className={net >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                          {net >= 0 ? '+' : ''}{formatMoney(net)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

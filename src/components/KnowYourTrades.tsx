import React, { useState, useMemo } from 'react';
import { Activity, ChevronDown } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, YAxis } from 'recharts';
import { Trade, TradingAccount } from '../types';

interface KnowYourTradesProps {
  trades: Trade[];
  accounts: TradingAccount[];
  currency?: string;
}

type TimeframeOption = 'all' | '30d' | '90d' | 'this_month' | 'this_year';

export default function KnowYourTrades({
  trades,
  accounts,
  currency = 'USD',
}: KnowYourTradesProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState<TimeframeOption>('all');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');

  // Format currency helper
  const formatMoney = (val: number) => {
    const isNeg = val < 0;
    const abs = Math.abs(val);
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
    }).format(abs);
    return isNeg ? `-${formatted}` : `+${formatted}`;
  };

  // 1. Filter trades by Account and Timeframe
  const filteredTrades = useMemo(() => {
    let list = trades.filter((t) => t.type !== 'Deposit' && t.type !== 'Withdrawal');

    // Account filter
    if (selectedAccountId !== 'all') {
      list = list.filter((t) => t.accountId === selectedAccountId);
    }

    // Timeframe filter
    if (selectedTimeframe !== 'all') {
      const now = Date.now();
      let cutoff = 0;
      if (selectedTimeframe === '30d') cutoff = now - 30 * 86400000;
      else if (selectedTimeframe === '90d') cutoff = now - 90 * 86400000;
      else if (selectedTimeframe === 'this_month') {
        const d = new Date();
        cutoff = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      } else if (selectedTimeframe === 'this_year') {
        const d = new Date();
        cutoff = new Date(d.getFullYear(), 0, 1).getTime();
      }

      list = list.filter((t) => {
        const tDate = new Date(t.date).getTime();
        return !isNaN(tDate) && tDate >= cutoff;
      });
    }

    return list;
  }, [trades, selectedAccountId, selectedTimeframe]);

  // Helper to calculate holding duration in milliseconds
  const getHoldDurationMs = (trade: Trade): number => {
    if (trade.exitTime && trade.date) {
      const entryMs = new Date(trade.date).getTime();
      const exitMs = new Date(trade.exitTime).getTime();
      if (!isNaN(entryMs) && !isNaN(exitMs) && exitMs >= entryMs) {
        return exitMs - entryMs;
      }
    }
    return 0;
  };

  // Helper to format duration string (e.g. 0s, 1h 3m, 1d 19h)
  const formatDuration = (ms: number): string => {
    if (ms <= 0) return '0s';
    const totalSec = Math.floor(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    if (days > 0) {
      return `${days}d ${hours}h`;
    }
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    if (mins > 0) {
      return `${mins}m ${secs > 0 ? `${secs}s` : ''}`.trim();
    }
    return `${secs}s`;
  };

  // 2. Classify trades into 3 modes
  const modeStats = useMemo(() => {
    const scalping: Trade[] = [];
    const intraday: Trade[] = [];
    const dayHolding: Trade[] = [];

    const FIVE_MINS_MS = 5 * 60 * 1000;
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

    for (const t of filteredTrades) {
      const dur = getHoldDurationMs(t);
      if (dur > 0 && dur <= FIVE_MINS_MS) {
        scalping.push(t);
      } else if (dur > FIVE_MINS_MS && dur <= FOUR_HOURS_MS) {
        intraday.push(t);
      } else if (dur > FOUR_HOURS_MS) {
        dayHolding.push(t);
      } else {
        // Fallback for trades where exitTime is missing or 0
        // If strategy or notes indicate scalping:
        const lower = `${t.strategy || ''} ${t.notes || ''}`.toLowerCase();
        if (lower.includes('scalp')) {
          scalping.push(t);
        } else if (lower.includes('swing') || lower.includes('position')) {
          dayHolding.push(t);
        } else {
          intraday.push(t);
        }
      }
    }

    const calcMode = (list: Trade[], label: string, range: string) => {
      const count = list.length;
      const wins = list.filter((t) => (Number(t.profit) || 0) > 0);
      const winRate = count > 0 ? Math.round((wins.length / count) * 100) : 0;
      const totalPnl = list.reduce((acc, t) => acc + (Number(t.profit) || 0), 0);

      const durTrades = list.filter((t) => getHoldDurationMs(t) > 0);
      const totalDur = durTrades.reduce((acc, t) => acc + getHoldDurationMs(t), 0);
      const avgDur = durTrades.length > 0 ? totalDur / durTrades.length : 0;

      let avgFormatted = formatDuration(avgDur);
      if (avgDur === 0) {
        if (count === 0) {
          avgFormatted = '0s';
        } else if (label === 'SCALPING') {
          avgFormatted = '< 5m';
        } else if (label === 'INTRADAY') {
          avgFormatted = '~1-4h';
        } else {
          avgFormatted = '> 4h';
        }
      }

      // P&L Trend sparkline points
      let cumPnl = 0;
      const sorted = [...list].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      let trendData: { index: number; pnl: number }[] = [];
      if (count === 1) {
        // Create a 2-point line so a single trade renders nicely as a trend line
        const p = Number(sorted[0].profit) || 0;
        trendData = [
          { index: 1, pnl: 0 },
          { index: 2, pnl: p },
        ];
      } else if (count > 1) {
        trendData = sorted.map((t, i) => {
          cumPnl += Number(t.profit) || 0;
          return { index: i + 1, pnl: cumPnl };
        });
      }

      return {
        label,
        range,
        count,
        winRate,
        totalPnl,
        avgDurationFormatted: avgFormatted,
        avgDurMs: avgDur,
        trendData,
      };
    };

    return {
      scalping: calcMode(scalping, 'SCALPING', '0-5M'),
      intraday: calcMode(intraday, 'INTRADAY', '5M-4H'),
      dayHolding: calcMode(dayHolding, 'DAY HOLDING', '>4H'),
    };
  }, [filteredTrades]);

  // 3. Determine Most Common Trading Style
  const dominantStyle = useMemo(() => {
    const { scalping, intraday, dayHolding } = modeStats;
    const arr = [
      { mode: 'Day Holding (>4h)', count: dayHolding.count, avg: dayHolding.avgDurationFormatted },
      { mode: 'Intraday (5m-4h)', count: intraday.count, avg: intraday.avgDurationFormatted },
      { mode: 'Scalping (0-5m)', count: scalping.count, avg: scalping.avgDurationFormatted },
    ];

    arr.sort((a, b) => b.count - a.count);

    if (arr[0].count === 0) {
      return {
        title: 'Trading Style Not Yet Detected',
        text: 'Log or sync your trades with entry and exit times to analyze your true trading behavior.',
      };
    }

    return {
      title: 'Your Trading Style',
      text: (
        <>
          Your most common trading style is{' '}
          <strong className="text-blue-400 font-bold">{arr[0].mode}</strong>, with an average
          holding time of <strong className="text-white font-bold">{arr[0].avg}</strong>.
        </>
      ),
    };
  }, [modeStats]);

  const modes = [modeStats.scalping, modeStats.intraday, modeStats.dayHolding];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header with Title and Dropdowns */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-wide uppercase">
            Know Your Trades
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 font-medium">
            Analyze your true trading style and behavior
          </p>
        </div>

        {/* Dropdown Filters */}
        <div className="flex items-center gap-2.5">
          {/* Timeframe Selector */}
          <div className="relative">
            <select
              value={selectedTimeframe}
              onChange={(e) => setSelectedTimeframe(e.target.value as TimeframeOption)}
              className="appearance-none bg-[#0e1626] hover:bg-[#121c32] border border-slate-800 text-slate-200 text-xs font-semibold rounded-xl pl-3.5 pr-8 py-2 focus:outline-none focus:border-blue-500 cursor-pointer transition shadow-sm"
            >
              <option value="all">All Time</option>
              <option value="this_month">This Month</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="this_year">This Year</option>
            </select>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Account Selector */}
          <div className="relative">
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="appearance-none bg-[#0e1626] hover:bg-[#121c32] border border-slate-800 text-slate-200 text-xs font-semibold rounded-xl pl-3.5 pr-8 py-2 focus:outline-none focus:border-blue-500 cursor-pointer transition shadow-sm max-w-[150px] truncate"
            >
              <option value="all">All Accounts</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Your Trading Style Highlight Banner */}
      <div className="rounded-2xl bg-[#09101d] border border-slate-800/80 p-4 sm:p-5 flex items-center gap-4 shadow-sm">
        <div className="h-10 w-10 rounded-xl bg-blue-950/60 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0 shadow-inner">
          <Activity className="h-5 w-5" />
        </div>
        <div className="space-y-0.5">
          <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide">
            Your Trading Style
          </h4>
          <p className="text-xs text-slate-400 leading-relaxed font-normal">
            {dominantStyle.text}
          </p>
        </div>
      </div>

      {/* Trading Modes Section */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white tracking-wide">
          Trading Modes
        </h3>

        {/* 3 Mode Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {modes.map((mode) => {
            const isProfit = mode.totalPnl >= 0;
            const hasTrades = mode.count > 0;
            const winRateColor = mode.winRate >= 50 ? 'text-emerald-400' : 'text-rose-500';

            return (
              <div
                key={mode.label}
                className="rounded-2xl bg-[#09101d] border border-slate-800/80 p-4 sm:p-5 flex flex-col justify-between shadow-sm relative overflow-hidden"
              >
                {/* Card Title */}
                <div className="mb-4">
                  <span className="text-xs font-extrabold text-slate-200 tracking-wider">
                    {mode.label} ({mode.range})
                  </span>
                </div>

                {/* Metrics 2x2 Header */}
                <div className="grid grid-cols-2 justify-between gap-y-1 mb-4 text-xs">
                  {/* Left: Trades & Avg Hold */}
                  <div>
                    <div className="font-semibold text-slate-200">
                      {mode.count} Trades
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      Avg. {mode.avgDurationFormatted}
                    </div>
                  </div>

                  {/* Right: Win Rate & Net P&L */}
                  <div className="text-right">
                    <div className={`font-bold ${winRateColor}`}>
                      {mode.winRate}% Win Rate
                    </div>
                    <div
                      className={`text-[11px] font-bold mt-1 ${
                        isProfit ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {formatMoney(mode.totalPnl)} Total P&L
                    </div>
                  </div>
                </div>

                {/* P&L Trend Section */}
                <div className="pt-2 border-t border-slate-800/60">
                  <div className="text-center text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-2">
                    P&amp;L Trend
                  </div>

                  {/* Chart Sparkline or Empty Text */}
                  <div className="h-20 w-full flex items-center justify-center">
                    {hasTrades && mode.trendData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={mode.trendData}>
                          <defs>
                            <linearGradient
                              id={`trendGrad_${mode.label}`}
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="5%"
                                stopColor={isProfit ? '#10b981' : '#f43f5e'}
                                stopOpacity={0.25}
                              />
                              <stop
                                offset="95%"
                                stopColor={isProfit ? '#10b981' : '#f43f5e'}
                                stopOpacity={0.0}
                              />
                            </linearGradient>
                          </defs>
                          <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
                          <Area
                            type="monotone"
                            dataKey="pnl"
                            stroke={isProfit ? '#10b981' : '#f43f5e'}
                            strokeWidth={2}
                            fill={`url(#trendGrad_${mode.label})`}
                            isAnimationActive={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="text-xs text-slate-500 font-medium">
                        No trades available
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

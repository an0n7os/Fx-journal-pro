import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Clock, Info } from 'lucide-react';
import { Trade } from '../types';

interface TradingCalendarProps {
  trades: Trade[];
  currency: string;
}

export default function TradingCalendar({ trades, currency }: TradingCalendarProps) {
  // Memoised because this array is a dependency of the effect below. Rebuilding
  // it on every render gave the effect a new reference each time, so it re-ran,
  // called setState, triggered another render, and looped until React threw
  // "Maximum update depth exceeded".
  const tradingTrades = useMemo(
    () => trades.filter(t => t.type !== 'Deposit' && t.type !== 'Withdrawal'),
    [trades]
  );
  const [currentDate, setCurrentDate] = useState(() => new Date());
  
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  const [selectedDayString, setSelectedDayString] = useState<string | null>(() => {
    const d = new Date();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  });

  const [selectedDayTrades, setSelectedDayTrades] = useState<Trade[] | null>(null);

  // Sync selectedDayTrades with tradesByDay whenever trades update or a new day is selected
  React.useEffect(() => {
    if (selectedDayKey) {
      // Recompute the local trades mapping just for the selected day to avoid dependency issues with the full tradesByDay object
      const localDayTrades = tradingTrades.filter(t => {
        const d = new Date(t.date);
        if (isNaN(d.getTime())) return false;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === selectedDayKey;
      });
      setSelectedDayTrades(localDayTrades);
    }
  }, [selectedDayKey, tradingTrades]);
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Helper to format currency
  const formatValue = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD'
    }).format(val);
  };

  const getCurrencySymbol = (curr: string) => {
    const symbols: { [key: string]: string } = {
      USD: '$',
      EUR: '€',
      INR: '₹',
      GBP: '£',
      JPY: '¥',
      AUD: '$',
      CAD: '$'
    };
    return symbols[curr] || '$';
  };

  // Helper to convert date to timezone-agnostic local YYYY-MM-DD string matching our calendar grid
  const getLocalDateString = (dateInput: string | Date) => {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Helper to format day P&L with currency symbol without +/- sign (e.g. $60, $25)
  const formatDayProfit = (val: number) => {
    const sym = getCurrencySymbol(currency);
    const abs = Math.abs(val);
    const numStr = abs >= 1000
      ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : Number.isInteger(abs)
        ? abs.toString()
        : abs.toFixed(2).replace(/\.?0+$/, '');
    return `${sym}${numStr}`;
  };

  // Group trades by day using local date to align with local calendar cells perfectly
  // Re-reduced the whole trade history on every render, including the 1s
  // countdown ticks elsewhere on the page.
  const tradesByDay = useMemo(
    () => tradingTrades.reduce((acc: { 
      [key: string]: { 
        trades: Trade[]; 
        netProfit: number;
        winCount: number;
        lossCount: number;
        breakEvenCount: number;
      } 
    }, trade) => {
      const dStr = getLocalDateString(trade.date);
      if (!dStr) return acc;
      if (!acc[dStr]) {
        acc[dStr] = { trades: [], netProfit: 0, winCount: 0, lossCount: 0, breakEvenCount: 0 };
      }
      acc[dStr].trades.push(trade);
      const net = trade.profit + (trade.commission || 0) + (trade.swap || 0);
      acc[dStr].netProfit += net;
      if (net > 0) {
        acc[dStr].winCount++;
      } else if (net < 0) {
        acc[dStr].lossCount++;
      } else {
        acc[dStr].breakEvenCount++;
      }
      return acc;
    }, {}),
    [tradingTrades]
  );

  // Calendar logic
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 (Sun) to 6 (Sat)
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedDayTrades(null);
    setSelectedDayKey(null);
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedDayTrades(null);
    setSelectedDayKey(null);
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Yearly stats calculation
  const yearlyStats = React.useMemo(() => {

    const monthlyProfits = new Array(12).fill(0);
    const weeklyProfits: { [week: string]: { profit: number, label: string } } = {};
    let winStreak = 0;
    let lossStreak = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;
    let maxDailyProfit = 0;
    let maxDailyLoss = 0;
    
    // To calculate streaks, we need a sorted array of active trading days in the year
    const daysInYear = Object.keys(tradesByDay)
      .filter(d => d.startsWith(`${year}-`))
      .sort();

    daysInYear.forEach(dayStr => {
      const dayData = tradesByDay[dayStr];
      // Note: Use UTC or parse parts to avoid timezone shift on YYYY-MM-DD
      const [y, m, d] = dayStr.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const monthIndex = date.getMonth();
      
      // Monthly
      monthlyProfits[monthIndex] += dayData.netProfit;
      
      // Daily Max/Min
      if (dayData.netProfit > maxDailyProfit) maxDailyProfit = dayData.netProfit;
      if (dayData.netProfit < maxDailyLoss) maxDailyLoss = dayData.netProfit;
      
      // Weekly (ISO week approximation)
      const dUTC = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = dUTC.getUTCDay() || 7;
      dUTC.setUTCDate(dUTC.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(dUTC.getUTCFullYear(),0,1));
      const weekNo = Math.ceil((((dUTC.getTime() - yearStart.getTime()) / 86400000) + 1)/7);
      const weekKey = `${dUTC.getUTCFullYear()}-W${weekNo}`;
      
      if (!weeklyProfits[weekKey]) {
        const day = date.getDay() || 7;
        const monday = new Date(date);
        monday.setDate(date.getDate() - day + 1);
        const sunday = new Date(date);
        sunday.setDate(date.getDate() - day + 7);
        const formatOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
        weeklyProfits[weekKey] = { 
          profit: 0, 
          label: `${monday.toLocaleDateString('en-US', formatOpts)} - ${sunday.toLocaleDateString('en-US', formatOpts)}` 
        };
      }
      weeklyProfits[weekKey].profit += dayData.netProfit;

      // Streaks
      if (dayData.netProfit > 0) {
        currentWinStreak++;
        currentLossStreak = 0;
        winStreak = Math.max(winStreak, currentWinStreak);
      } else if (dayData.netProfit < 0) {
        currentLossStreak++;
        currentWinStreak = 0;
        lossStreak = Math.max(lossStreak, currentLossStreak);
      }
    });

    const bestMonth = Math.max(...monthlyProfits);
    const worstMonth = Math.min(...monthlyProfits);
    const bestMonthIdx = monthlyProfits.indexOf(bestMonth);
    const worstMonthIdx = monthlyProfits.indexOf(worstMonth);

    const weekEntries = Object.values(weeklyProfits);
    const bestWeekObj = weekEntries.length > 0 ? weekEntries.reduce((a, b) => a.profit > b.profit ? a : b) : { profit: 0, label: '-' };
    const worstWeekObj = weekEntries.length > 0 ? weekEntries.reduce((a, b) => a.profit < b.profit ? a : b) : { profit: 0, label: '-' };

    return {
      bestMonth: { value: bestMonth, name: bestMonth !== 0 ? monthNames[bestMonthIdx] : '-' },
      worstMonth: { value: worstMonth, name: worstMonth !== 0 ? monthNames[worstMonthIdx] : '-' },
      bestWeek: bestWeekObj,
      worstWeek: worstWeekObj,
      winStreak,
      lossStreak,
      maxDailyProfit,
      maxDailyLoss
    };
  }, [year, tradesByDay, monthNames]);

  // Compile calendar cells
  const cells = [];
  // Empty slots before first day of month
  for (let i = 0; i < firstDayOfMonth; i++) {
    cells.push({ isPadding: true, day: 0 });
  }
  // Days of month
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({ isPadding: false, day: i });
  }

  // Monthly totals
  let monthlyProfit = 0;
  let winDays = 0;
  let lossDays = 0;

  for (let i = 1; i <= daysInMonth; i++) {
    const formattedDay = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    const dayData = tradesByDay[formattedDay];
    if (dayData) {
      monthlyProfit += dayData.netProfit;
      if (dayData.netProfit > 0) winDays++;
      if (dayData.netProfit < 0) lossDays++;
    }
  }

  const handleDayClick = (dayNum: number) => {
    const formattedDay = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    setSelectedDayKey(formattedDay);
    const dayData = tradesByDay[formattedDay];
    setSelectedDayString(`${monthNames[month]} ${dayNum}, ${year}`);
    if (dayData) {
      setSelectedDayTrades(dayData.trades);
    } else {
      setSelectedDayTrades([]);
    }
  };

  return (
    <div id="trading-calendar-card" className="w-full transition-all">

      <div className="space-y-10">
{/* Year Stats Row */}
          {yearlyStats && (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="dx-tile p-3">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider block mb-1">Best Month</span>
                <div className="flex flex-col">
                  <span className="text-sm font-black text-slate-800 dark:text-slate-200">{yearlyStats.bestMonth.name}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 text-xs font-bold">{formatValue(yearlyStats.bestMonth.value)}</span>
                </div>
              </div>
              <div className="dx-tile p-3">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider block mb-1">Worst Month</span>
                <div className="flex flex-col">
                  <span className="text-sm font-black text-slate-800 dark:text-slate-200">{yearlyStats.worstMonth.name}</span>
                  <span className="text-rose-600 dark:text-rose-400 text-xs font-bold">{formatValue(yearlyStats.worstMonth.value)}</span>
                </div>
              </div>
              <div className="dx-tile p-3">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider block mb-1">Best Week</span>
                <div className="flex flex-col">
                  <span className="text-sm font-black text-slate-800 dark:text-slate-200">{yearlyStats.bestWeek.label}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 text-xs font-bold">{formatValue(yearlyStats.bestWeek.profit)}</span>
                </div>
              </div>
              <div className="dx-tile p-3">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider block mb-1">Worst Week</span>
                <div className="flex flex-col">
                  <span className="text-sm font-black text-slate-800 dark:text-slate-200">{yearlyStats.worstWeek.label}</span>
                  <span className="text-rose-600 dark:text-rose-400 text-xs font-bold">{formatValue(yearlyStats.worstWeek.profit)}</span>
                </div>
              </div>
              <div className="dx-tile p-3">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider block mb-1">Win Streak</span>
                <div className="flex flex-col">
                  <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">{yearlyStats.winStreak} Days</span>
                </div>
              </div>
              <div className="dx-tile p-3">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider block mb-1">Loss Streak</span>
                <div className="flex flex-col">
                  <span className="text-sm font-black text-rose-600 dark:text-rose-400">{yearlyStats.lossStreak} Days</span>
                </div>
              </div>
            </div>
          </div>
        )}

                  {/* Monthly Calendar Grid */}
        <div>
          <div className="flex flex-row items-center justify-between mb-6">
            <h3 className="dx-section-title">Monthly Calendar</h3>
            {/* Navigation */}
            <div className="flex items-center gap-3">
              <button 
                onClick={handlePrevMonth}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-400 dark:border-slate-700 rounded-lg transition-colors bg-white dark:bg-slate-900/50"
              >
                <ChevronLeft className="h-5 w-5 text-slate-900 dark:text-white stroke-[3]" />
              </button>
              <span className="font-black text-slate-900 dark:text-white min-w-[100px] text-center text-sm md:text-base tracking-tight trading-calendar-month">
                {monthNames[month]} {year}
              </span>
              <button 
                onClick={handleNextMonth}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-400 dark:border-slate-700 rounded-lg transition-colors bg-white dark:bg-slate-900/50"
              >
                <ChevronRight className="h-5 w-5 text-slate-900 dark:text-white stroke-[3]" />
              </button>
            </div>
          </div>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Calendar Grid */}
        <div className="lg:col-span-3">
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5 md:gap-2 text-center mb-1.5 sm:mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-[10px] min-[360px]:text-[11px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider py-1 truncate">{day}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 sm:gap-1.5 md:gap-2">
            {cells.map((cell, idx) => {
              if (cell.isPadding) {
                return (
                  <div 
                    key={`pad-${idx}`} 
                    className="min-h-[64px] min-[390px]:min-h-[72px] sm:min-h-[84px] md:min-h-[96px] calendar-day-box opacity-25 dark:opacity-20 rounded-lg sm:rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200/40 dark:border-slate-800/40"
                  ></div>
                );
              }

              const formattedDay = `${year}-${String(month + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`;
              const dayData = tradesByDay[formattedDay];
              const isSelected = selectedDayKey === formattedDay;
              const todayKey = (() => {
                const n = new Date();
                return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
              })();
              const isToday = formattedDay === todayKey;
              
              let cellBg = "bg-white dark:bg-slate-900/50 hover:bg-slate-50 dark:hover:bg-slate-800/70";
              let borderClass = "border border-slate-200 dark:border-slate-800/80";
              let textAccent = "text-slate-500 dark:text-slate-400 font-medium";
              let statusClass = "calendar-day-neutral";

              if (dayData) {
                if (dayData.netProfit > 0) {
                  statusClass = "calendar-day-profit border-emerald-200 border-emerald-300";
                  cellBg = "bg-emerald-500/10 dark:bg-emerald-950/40 hover:bg-emerald-500/15 dark:hover:bg-emerald-950/60";
                  borderClass = "border border-emerald-300 dark:border-emerald-500/50";
                  textAccent = "calendar-profit-text text-emerald-600 dark:text-emerald-400 font-black";
                } else if (dayData.netProfit < 0) {
                  statusClass = "calendar-day-loss border-rose-200 border-rose-300";
                  cellBg = "bg-rose-500/10 dark:bg-rose-950/40 hover:bg-rose-500/15 dark:hover:bg-rose-950/60";
                  borderClass = "border border-rose-300 dark:border-rose-500/50";
                  textAccent = "calendar-loss-text text-rose-600 dark:text-rose-400 font-black";
                } else {
                  statusClass = "calendar-day-breakeven";
                  cellBg = "bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-800/50";
                  borderClass = "border border-slate-200 dark:border-slate-700/50";
                  textAccent = "text-slate-600 dark:text-slate-300 font-bold";
                }
              }

              return (
                <button
                  key={`day-${cell.day}`}
                  onClick={() => handleDayClick(cell.day)}
                  data-today={isToday ? 'true' : undefined}
                  aria-current={isToday ? 'date' : undefined}
                  className={`calendar-day-box min-h-[64px] min-[390px]:min-h-[72px] sm:min-h-[84px] md:min-h-[96px] p-1 min-[390px]:p-1.5 sm:p-2 text-left rounded-lg sm:rounded-xl flex flex-col justify-between group relative transition-all duration-200 overflow-hidden ${statusClass} ${cellBg} ${borderClass} ${
                    isSelected 
                      ? 'ring-2 ring-indigo-500 ring-offset-1 sm:ring-offset-2 dark:ring-offset-slate-900 scale-[1.02] z-10 shadow-md' 
                      : 'hover:scale-[1.02] hover:shadow-sm hover:z-10'
                  }`}
                >
                  <div className="flex items-center justify-between w-full leading-none">
                    <span className="calendar-day-number text-[10px] min-[390px]:text-[11px] sm:text-xs font-bold text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                      {cell.day}
                    </span>
                    {isToday && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 ring-2 ring-indigo-500/20" title="Today"></span>
                    )}
                  </div>

                  {dayData ? (
                    <>
                      {/* P&L Display in center */}
                      <div className="my-auto py-0.5 text-center w-full px-0.5 overflow-hidden">
                        <span className={`text-[10px] min-[360px]:text-[11px] min-[390px]:text-xs sm:text-sm md:text-base font-black tracking-tight leading-tight block whitespace-nowrap overflow-hidden text-ellipsis ${textAccent}`}>
                          {formatDayProfit(dayData.netProfit)}
                        </span>
                      </div>

                      {/* Trade statistics inside each date rectangle: T, W, L */}
                      <div className="w-full pt-0.5 min-[390px]:pt-1 border-t border-slate-200/50 dark:border-white/[0.06] select-none overflow-hidden">
                        <div className="flex items-center justify-center gap-1 min-[440px]:gap-2 text-[7.5px] min-[360px]:text-[8px] min-[440px]:text-[9px] sm:text-[10px] font-bold leading-none truncate w-full text-center">
                          <span className="text-slate-500 dark:text-slate-400 font-mono">T:<span className="text-slate-700 dark:text-slate-200">{dayData.trades.length}</span></span>
                          <span className="calendar-win-text text-emerald-600 dark:text-emerald-400 font-mono">W:{dayData.winCount}</span>
                          <span className="calendar-loss-stat-text text-rose-600 dark:text-rose-400 font-mono">L:{dayData.lossCount}</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex-1"></div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sidebar / Stats Panel */}
        <div className="lg:col-span-1 space-y-6">
          <div className="dx-panel p-5">
            <h3 className="dx-section-title mb-3">Month Performance</h3>
            <div className="space-y-4">
              <div>
                <span className="text-xs text-slate-500 dark:text-slate-400 block">Net P/L</span>
                <span className={`text-lg font-bold ${monthlyProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {formatValue(monthlyProfit)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-slate-100 dark:border-slate-800 pt-3">
                <div>
                  <span className="text-[11px] text-slate-600 dark:text-slate-500 block flex items-center gap-1">
                    <TrendingUp className="h-3 w-3 text-emerald-500" /> Profitable Days
                  </span>
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{winDays}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-600 dark:text-slate-500 block flex items-center gap-1">
                    <TrendingDown className="h-3 w-3 text-rose-500" /> Loss Days
                  </span>
                  <span className="text-sm font-bold text-rose-600 dark:text-rose-400">{lossDays}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Expanded Selected Day Trades */}
          <div className="dx-panel p-5 max-h-[300px] overflow-y-auto">
            {selectedDayTrades === null ? (
              <div className="text-center py-6 text-slate-400 dark:text-slate-500">
                <Info className="h-5 w-5 mx-auto mb-2 opacity-50" />
                <p className="text-xs">Click a calendar day to view active orders and closed trade journals</p>
              </div>
            ) : selectedDayTrades.length === 0 ? (
              <div>
                <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">{selectedDayString}</h4>
                <p className="text-xs text-slate-400 dark:text-slate-500">No trading activity logged on this date.</p>
              </div>
            ) : (
              <div>
                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2 mb-3">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">{selectedDayString}</h4>
                  <span className="text-[10px] bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded font-bold">
                    {selectedDayTrades.length} Positions
                  </span>
                </div>
                <div className="space-y-3">
                  {selectedDayTrades.map((trade) => (
                    <div key={trade.id} className={`p-2.5 bg-white dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800/50 rounded-lg text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50 transition ${trade.type === 'Deposit' || trade.type === 'Withdrawal' ? 'border-l-2 border-l-blue-400' : ''}`}>
                      <div className="flex justify-between font-semibold mb-1">
                        <span className="text-slate-800 dark:text-slate-200">{trade.symbol === 'BALANCE' ? (trade.type === 'Deposit' ? 'Funds Deposit' : 'Funds Withdrawal') : trade.symbol}</span>
                        <span className={trade.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                          {formatValue(trade.profit)}
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500">
                        <span>{trade.type}{trade.symbol !== 'BALANCE' ? ` • ${trade.lotSize} Lots` : ''}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {new Date(trade.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {trade.notes && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 line-clamp-1 italic bg-white/60 dark:bg-slate-900/40 p-1 rounded">
                          "{trade.notes}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
        <div className="pt-8 mt-10">
          <h3 className="dx-section-title mb-6">Year at a Glance</h3>
{/* 12 Months Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {monthNames.map((mName, mIdx) => {
              // Convert to Monday start for the exact layout in the screenshot
              const fdom = (new Date(year, mIdx, 1).getDay() + 6) % 7;
              const dim = new Date(year, mIdx + 1, 0).getDate();
              const mCells = [];
              for (let i = 0; i < fdom; i++) mCells.push({ isPad: true, day: 0 });
              for (let i = 1; i <= dim; i++) mCells.push({ isPad: false, day: i });

              return (
                <div key={mName} className="flex flex-col bg-transparent">
                  {/* Month Header */}
                  <div className="mb-2 pl-1">
                    <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-300 tracking-wide">{mName.substring(0, 3)}</span>
                  </div>
                  
                  {/* Grid */}
                  <div className="grid grid-cols-7 gap-1">
                    {/* Days Header */}
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                      <div key={`d-${i}`} className="text-[9px] font-medium text-slate-400 dark:text-slate-500/70 text-center mb-1">{d}</div>
                    ))}
                    
                    {/* Days */}
                    {mCells.map((cell, idx) => {
                      if (cell.isPad) {
                        return <div key={`pad-${idx}`} className="aspect-square"></div>;
                      }
                      
                      const fDay = `${year}-${String(mIdx + 1).padStart(2, '0')}-${String(cell.day).padStart(2, '0')}`;
                      const dData = tradesByDay[fDay];
                      
                      let cBg = "bg-slate-100 dark:bg-slate-800";
                      let cText = "text-slate-600 dark:text-slate-500 font-medium";
                      
                      if (dData) {
                        if (dData.netProfit > 0) {
                          const ratio = yearlyStats?.maxDailyProfit ? dData.netProfit / yearlyStats.maxDailyProfit : 1;
                          if (ratio > 0.8) {
                            cBg = "!bg-emerald-600 dark:!bg-emerald-500";
                            cText = "!text-white font-bold";
                          } else if (ratio > 0.6) {
                            cBg = "!bg-emerald-500 dark:!bg-emerald-600";
                            cText = "!text-white font-bold";
                          } else if (ratio > 0.4) {
                            cBg = "!bg-emerald-400 dark:!bg-emerald-700";
                            cText = "!text-emerald-950 dark:!text-emerald-50 font-bold";
                          } else if (ratio > 0.2) {
                            cBg = "!bg-emerald-300 dark:!bg-emerald-800";
                            cText = "!text-emerald-900 dark:!text-emerald-100 font-semibold";
                          } else {
                            cBg = "!bg-emerald-200 dark:!bg-emerald-900";
                            cText = "!text-emerald-800 dark:!text-emerald-200 font-semibold";
                          }
                        } else if (dData.netProfit < 0) {
                          const lossRatio = yearlyStats?.maxDailyLoss ? dData.netProfit / yearlyStats.maxDailyLoss : 1;
                          if (lossRatio > 0.8) {
                            cBg = "!bg-rose-600 dark:!bg-rose-500";
                            cText = "!text-white font-bold";
                          } else if (lossRatio > 0.6) {
                            cBg = "!bg-rose-500 dark:!bg-rose-600";
                            cText = "!text-white font-bold";
                          } else if (lossRatio > 0.4) {
                            cBg = "!bg-rose-400 dark:!bg-rose-700";
                            cText = "!text-rose-950 dark:!text-rose-50 font-bold";
                          } else if (lossRatio > 0.2) {
                            cBg = "!bg-rose-300 dark:!bg-rose-800";
                            cText = "!text-rose-900 dark:!text-rose-100 font-semibold";
                          } else {
                            cBg = "!bg-rose-200 dark:!bg-rose-900";
                            cText = "!text-rose-800 dark:!text-rose-200 font-semibold";
                          }
                        }
                      }
                      
                      return (
                        <div
                          key={`c-${cell.day}`} 
                          className={`cursor-pointer aspect-square flex items-center justify-center rounded-[3px] text-[10px] ${cBg} ${cText} transition-all hover:scale-110 hover:z-10`}
                          title={dData ? `${fDay}: ${formatValue(dData.netProfit)}` : fDay}
                          onClick={() => {
                            setCurrentDate(new Date(year, mIdx, 1));
                            setTimeout(() => handleDayClick(cell.day), 10);
                          }}
                        >
                          {cell.day}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Legend */}
          <div className="flex items-center justify-center sm:justify-end gap-2 text-[10px] text-slate-500 dark:text-slate-400 pt-2 font-medium">
            <span>High Loss</span>
            <div className="flex gap-0.5">
              <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: '#dc2626' }}></div>
              <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: '#ef4444' }}></div>
              <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: '#fb7185' }}></div>
              <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: '#fda4af' }}></div>
              <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: '#fecdd3' }}></div>
              <div className="w-3 h-3 rounded-[2px] bg-slate-100 dark:bg-slate-800 mx-1"></div>
              <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: '#a7f3d0' }}></div>
              <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: '#6ee7b7' }}></div>
              <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: '#34d399' }}></div>
              <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: '#22c55e' }}></div>
              <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: '#16a34a' }}></div>
            </div>
            <span>High Profit</span>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

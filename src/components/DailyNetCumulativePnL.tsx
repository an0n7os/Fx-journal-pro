import React, { useState, useMemo } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot 
} from 'recharts';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';

import { Trade } from '../types';

interface DailyNetCumulativePnLProps {
  trades: Trade[];
  startingBal?: number;
}

export function DailyNetCumulativePnL({ trades, startingBal = 0 }: DailyNetCumulativePnLProps) {
  const [timeFilter, setTimeFilter] = useState<'All' | '1Y' | '1M' | '1W' | '1D'>('All');

  // Format currency
  const formatMoney = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(val);
  };

  const chartData = useMemo(() => {
    if (!trades || trades.length === 0) return [];

    // 1. Group by Day & Calculate Daily Net
    const getLocalDayKey = (dateInput: string) => {
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return '';
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const dailyMap: { [key: string]: number } = {};
    const reversedTrades = [...trades].reverse(); // chronological

    reversedTrades.forEach(t => {
      const dKey = getLocalDayKey(t.date);
      if (!dKey) return;
      dailyMap[dKey] = (dailyMap[dKey] || 0) + t.profit + (t.commission || 0) + (t.swap || 0);
    });

    const sortedDays = Object.keys(dailyMap).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    // 2. Filter by Time Window
    let filteredDays = sortedDays;
    const now = new Date();
    
    if (timeFilter !== 'All') {
      const cutoff = new Date();
      if (timeFilter === '1Y') cutoff.setFullYear(now.getFullYear() - 1);
      else if (timeFilter === '1M') cutoff.setMonth(now.getMonth() - 1);
      else if (timeFilter === '1W') cutoff.setDate(now.getDate() - 7);
      else if (timeFilter === '1D') cutoff.setDate(now.getDate() - 1);
      
      filteredDays = sortedDays.filter(d => new Date(d).getTime() >= cutoff.getTime());
    }

    // 3. Calculate Cumulative
    let cumulative = 0; 
    const fullData: any[] = [];
    let runningTotal = 0;
    
    sortedDays.forEach(dKey => {
      runningTotal += dailyMap[dKey];
      fullData.push({
        date: dKey,
        dailyNet: dailyMap[dKey],
        cumulativeNet: parseFloat(runningTotal.toFixed(2))
      });
    });

    if (timeFilter === 'All') return fullData;

    const cutoffTime = new Date();
    if (timeFilter === '1Y') cutoffTime.setFullYear(now.getFullYear() - 1);
    else if (timeFilter === '1M') cutoffTime.setMonth(now.getMonth() - 1);
    else if (timeFilter === '1W') cutoffTime.setDate(now.getDate() - 7);
    else if (timeFilter === '1D') cutoffTime.setDate(now.getDate() - 1);

    return fullData.filter(d => new Date(d.date).getTime() >= cutoffTime.getTime());
  }, [trades, timeFilter]);

  // Derived Metrics
  const metrics = useMemo(() => {
    if (chartData.length === 0) return { current: 0, period: 0, peak: 0, trough: 0, bestDay: null, worstDay: null, peakItem: null, troughItem: null };
    
    const current = chartData[chartData.length - 1].cumulativeNet;
    const startOfPeriod = chartData[0].cumulativeNet - chartData[0].dailyNet;
    const period = current - startOfPeriod;

    let peak = -Infinity;
    let trough = Infinity;
    let bestDailyNet = -Infinity;
    let worstDailyNet = Infinity;
    
    let bestDayItem = null;
    let worstDayItem = null;
    let peakItem = null;
    let troughItem = null;

    chartData.forEach(item => {
      if (item.cumulativeNet > peak) { peak = item.cumulativeNet; peakItem = item; }
      if (item.cumulativeNet < trough) { trough = item.cumulativeNet; troughItem = item; }
      if (item.dailyNet > bestDailyNet) { bestDailyNet = item.dailyNet; bestDayItem = item; }
      if (item.dailyNet < worstDailyNet) { worstDailyNet = item.dailyNet; worstDayItem = item; }
    });

    return { current, period, peak, trough, bestDayItem, worstDayItem, peakItem, troughItem };
  }, [chartData]);

  // To calculate gradient offset at Y=0
  const gradientOffset = () => {
    if (chartData.length === 0) return 0;
    const dataMax = Math.max(...chartData.map(i => i.cumulativeNet));
    const dataMin = Math.min(...chartData.map(i => i.cumulativeNet));

    if (dataMax <= 0) return 0; // all negative (red)
    if (dataMin >= 0) return 1; // all positive (green)

    return dataMax / (dataMax - dataMin);
  };

  const off = gradientOffset();

  // Custom Badge Component for ReferenceDot
  const CustomBadge = (props: any) => {
    const { cx, cy, type } = props;
    if (cx === undefined || cy === undefined) return null;

    let bgColor = '#ef4444'; // Red (Worst/Low)
    let textColor = '#ffffff';

    if (type === 'Best Day') {
      bgColor = '#2dd4bf'; // Teal
    } else if (type === 'Breakeven') {
      bgColor = 'transparent';
      textColor = '#94a3b8'; // Slate
    }

    return (
      <g>
        {type === 'Breakeven' ? (
          <text x={cx} y={cy - 10} textAnchor="middle" fill={textColor} fontSize="10" fontWeight="bold">
            Breakeven
          </text>
        ) : (
          <g transform={`translate(${cx - 30}, ${cy - 25})`}>
            <rect width="60" height="20" rx="10" fill={bgColor} />
            <text x="30" y="14" textAnchor="middle" fill={textColor} fontSize="10" fontWeight="bold">
              {type === 'Low' ? '▼ Low' : type}
            </text>
            <circle cx="30" cy="25" r="3" fill={bgColor} stroke="#fff" strokeWidth="1.5" />
          </g>
        )}
      </g>
    );
  };

  return (
    <div className="bg-[#0f0f12] text-white border border-white/[0.05] rounded-xl p-6 shadow-xl flex flex-col font-sans h-full w-full relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 relative z-10">
        <h3 className="font-extrabold text-base tracking-wide text-slate-100">Daily Net Cumulative P&L</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-white/[0.03] rounded-lg p-1 border border-white/[0.05]">
            {['All', '1Y', '1M', '1W', '1D'].map(f => (
              <button
                key={f}
                onClick={() => setTimeFilter(f as any)}
                className={`text-[10px] font-bold px-3 py-1.5 rounded-md transition-colors ${
                  timeFilter === f ? 'bg-amber-500/20 text-amber-500' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 rounded-lg text-xs font-semibold hover:bg-white/5 transition text-slate-300">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Insights
            <ChevronDown className="w-3 h-3 ml-1" />
          </button>
        </div>
      </div>

      {/* Chart Area */}
      <div className="flex-1 w-full h-80 min-h-[300px] relative -mt-4">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 40, right: 20, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="splitColor" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={off} stopColor="#2dd4bf" stopOpacity={1} />
                  <stop offset={off} stopColor="#ef4444" stopOpacity={1} />
                </linearGradient>
                <linearGradient id="splitFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={off} stopColor="#2dd4bf" stopOpacity={0.2} />
                  <stop offset={off} stopColor="#ef4444" stopOpacity={0.2} />
                </linearGradient>
                {/* Red stripe pattern for drawdown */}
                <pattern id="diagonalHatch" patternUnits="userSpaceOnUse" width="4" height="4">
                  <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" stroke="#ef4444" strokeWidth="1" strokeOpacity="0.15" />
                </pattern>
              </defs>
              <CartesianGrid vertical={false} stroke="#ffffff" strokeOpacity={0.03} />
              
              <XAxis 
                dataKey="date" 
                stroke="#64748b" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false}
                tickFormatter={(val) => val}
                dy={10}
              />
              <YAxis 
                stroke="#64748b" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false}
                tickFormatter={(val) => formatMoney(val)}
                domain={['auto', 'auto']}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px', color: '#fff' }}
                itemStyle={{ color: '#fff', fontWeight: 'bold' }}
                formatter={(value: number) => [formatMoney(value), 'Net Cumulative']}
                labelStyle={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}
              />

              {/* Drawdown Hatch Area */}
              <Area 
                type="monotone" 
                dataKey="cumulativeNet" 
                stroke="none" 
                fill="url(#diagonalHatch)" 
                isAnimationActive={false}
              />
              
              {/* Main Area */}
              <Area 
                type="monotone" 
                dataKey="cumulativeNet" 
                stroke="url(#splitColor)" 
                strokeWidth={2.5} 
                fillOpacity={1} 
                fill="url(#splitFill)" 
                activeDot={{ r: 5, strokeWidth: 0, fill: '#fff' }} 
              />

              {/* Zero Line */}
              <ReferenceDot x={chartData[0]?.date} y={0} r={0} shape={<CustomBadge type="Breakeven" />} />

              {/* Annotations */}
              {metrics.bestDayItem && (
                <ReferenceDot 
                  x={metrics.bestDayItem.date} 
                  y={metrics.bestDayItem.cumulativeNet} 
                  r={0} 
                  shape={<CustomBadge type="Best Day" />} 
                />
              )}
              {metrics.worstDayItem && (
                <ReferenceDot 
                  x={metrics.worstDayItem.date} 
                  y={metrics.worstDayItem.cumulativeNet} 
                  r={0} 
                  shape={<CustomBadge type="Worst Day" />} 
                />
              )}
              {metrics.troughItem && metrics.troughItem.date !== metrics.worstDayItem?.date && (
                <ReferenceDot 
                  x={metrics.troughItem.date} 
                  y={metrics.troughItem.cumulativeNet} 
                  r={0} 
                  shape={<CustomBadge type="Low" />} 
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-slate-500">
            No trading data available for this period.
          </div>
        )}
      </div>

      {/* Footer Stats */}
      {chartData.length > 0 && (
        <div className="flex items-center gap-6 mt-4 pt-4 border-t border-white/[0.05] text-xs font-medium">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Current</span>
            <span className={`font-bold ${metrics.current >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
              {formatMoney(metrics.current)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Period</span>
            <span className={`font-bold ${metrics.period >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
              {metrics.period >= 0 ? '↑' : '↓'} {formatMoney(Math.abs(metrics.period))}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-teal-400"></div>
            <span className="text-slate-400">Peak</span>
            <span className="font-bold text-white">{formatMoney(metrics.peak)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-red-400"></div>
            <span className="text-slate-400">Trough</span>
            <span className="font-bold text-white">{formatMoney(metrics.trough)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

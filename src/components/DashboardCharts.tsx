import React from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

export interface EquityCurveChartProps {
  data: any[];
  totalTradesCount: number;
  gradientColor: string;
  strokeColor: string;
  formatValue: (v: number) => string;
}

export function EquityCurveChart({
  data,
  totalTradesCount,
  gradientColor,
  strokeColor,
  formatValue
}: EquityCurveChartProps) {
  if (totalTradesCount <= 0 || !data || data.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-xs text-slate-400 space-y-2">
        <span>Your equity curve appears here once you log your first trade.</span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={gradientColor} stopOpacity={0.15} />
            <stop offset="95%" stopColor={gradientColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
        <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} domain={['dataMin - 100', 'dataMax + 100']} />
        <Tooltip formatter={(value) => [formatValue(Number(value)), 'Equity']} />
        <Area
          type="monotone"
          dataKey="equity"
          stroke={strokeColor}
          strokeWidth={2.5}
          fillOpacity={1}
          fill="url(#colorEquity)"
          activeDot={{ r: 5, strokeWidth: 0, fill: strokeColor }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface WinLossPieChartProps {
  totalTradesCount: number;
  winsCount: number;
  lossesCount: number;
  innerRadius?: number;
  outerRadius?: number;
  showCenterText?: boolean;
}

export function WinLossPieChart({
  totalTradesCount,
  winsCount,
  lossesCount,
  innerRadius = 48,
  outerRadius = 68,
  showCenterText = false
}: WinLossPieChartProps) {
  if (totalTradesCount <= 0) {
    return <div className="text-xs text-slate-500 text-center">No trades yet</div>;
  }

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={[
              { name: 'Winning Trades', value: winsCount, color: '#10b981' },
              { name: 'Losing Trades', value: lossesCount, color: '#ef4444' }
            ]}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={5}
            dataKey="value"
            stroke="none"
          >
            <Cell fill="#10b981" />
            <Cell fill="#ef4444" />
          </Pie>
          <Tooltip
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
            itemStyle={{ fontWeight: 'bold' }}
          />
        </PieChart>
      </ResponsiveContainer>
      {showCenterText && (
        <div className="absolute flex flex-col items-center justify-center pointer-events-none">
          <span className="text-3xl font-black text-slate-800 dark:text-white tracking-tighter">
            {totalTradesCount}
          </span>
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 sm:mt-1">
            Trades
          </span>
        </div>
      )}
    </div>
  );
}

export interface MonthlyPnlBarChartProps {
  data: any[];
  formatValue: (v: number) => string;
}

export function MonthlyPnlBarChart({ data, formatValue }: MonthlyPnlBarChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-slate-400">
        No monthly trading history found.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.15} />
        <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
        <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
        <Tooltip formatter={(value) => [formatValue(Number(value)), 'Net Profit']} />
        <Bar dataKey="profit" maxBarSize={36} radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? '#10b981' : '#f43f5e'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface SymbolPerformanceBarChartProps {
  data: any[];
  formatValue: (v: number) => string;
}

export function SymbolPerformanceBarChart({ data, formatValue }: SymbolPerformanceBarChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-slate-400">
        No asset configurations calculated yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" opacity={0.15} />
        <XAxis type="number" stroke="#94a3b8" fontSize={10} tickLine={false} />
        <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={10} tickLine={false} />
        <Tooltip formatter={(value) => [formatValue(Number(value)), 'Cumulative Net']} />
        <Bar dataKey="profit" maxBarSize={28} fill="#3b82f6" radius={[0, 4, 4, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? '#10b981' : '#f43f5e'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface SessionConcentrationPieChartProps {
  data: any[];
}

export function SessionConcentrationPieChart({ data }: SessionConcentrationPieChartProps) {
  if (!data || data.length === 0) {
    return <div className="text-xs text-slate-400">No session metrics available.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={45}
          outerRadius={70}
          paddingAngle={3}
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip />
        <Legend verticalAlign="bottom" height={36} iconSize={8} wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export interface WinPerformanceChartProps {
  data: any[];
  theme: string;
  showVolume: boolean;
  formatValue: (v: number) => string;
}

export function WinPerformanceChart({ data, theme, showVolume, formatValue }: WinPerformanceChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-slate-400">
        No winning performance recorded.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="winGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#1e293b' : '#f1f5f9'} />
        <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} tickLine={false} />
        <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} tickFormatter={(val) => (showVolume ? `${val}` : `$${val}`)} />
        <Tooltip
          formatter={(value: any) => [
            showVolume ? `${value} Lots` : formatValue(Number(value)),
            showVolume ? 'Volume' : 'Cumulative Profit'
          ]}
        />
        <Area type="monotone" dataKey="val" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#winGradient)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface LossPerformanceChartProps {
  data: any[];
  theme: string;
  showVolume: boolean;
  formatValue: (v: number) => string;
}

export function LossPerformanceChart({ data, theme, showVolume, formatValue }: LossPerformanceChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-slate-400">
        No loss performance recorded.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="lossGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#1e293b' : '#f1f5f9'} />
        <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} tickLine={false} />
        <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} tickFormatter={(val) => (showVolume ? `${val}` : `-$${Math.abs(val)}`)} />
        <Tooltip
          formatter={(value: any) => [
            showVolume ? `${value} Lots` : `-${formatValue(Math.abs(Number(value)))}`,
            showVolume ? 'Volume' : 'Cumulative Loss'
          ]}
        />
        <Area type="monotone" dataKey="val" stroke="#f43f5e" strokeWidth={2.5} fillOpacity={1} fill="url(#lossGradient)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface UnderwaterCurveChartProps {
  data: any[];
  formatValue: (v: number) => string;
}

export function UnderwaterCurveChart({ data, formatValue }: UnderwaterCurveChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
          </linearGradient>
          <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.15} />
        <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
        <YAxis yAxisId="left" stroke="#94a3b8" fontSize={10} tickLine={false} tickFormatter={(v) => `$${v}`} />
        <YAxis yAxisId="right" orientation="right" stroke="#f43f5e" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}%`} domain={[-20, 0]} />
        <Tooltip formatter={(value: any, name: any) => [name === 'drawdown' ? `${value}%` : formatValue(Number(value)), name === 'drawdown' ? 'Drawdown' : 'Equity']} />
        <Area yAxisId="left" type="monotone" dataKey="equity" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#equityGrad)" />
        <Area yAxisId="right" type="monotone" dataKey="drawdown" stroke="#f43f5e" strokeWidth={1.5} fillOpacity={1} fill="url(#ddGrad)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface DayOfWeekPerformanceChartProps {
  data: any[];
  formatValue: (v: number) => string;
}

export function DayOfWeekPerformanceChart({ data, formatValue }: DayOfWeekPerformanceChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.15} />
        <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
        <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
        <Tooltip formatter={(val: any, name: any) => [name === 'profit' ? formatValue(Number(val)) : `${val}%`, name === 'profit' ? 'Net P&L' : 'Win Rate']} />
        <Bar dataKey="profit" maxBarSize={36} radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? '#10b981' : '#f43f5e'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

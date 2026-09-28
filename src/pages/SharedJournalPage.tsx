import React, { useState, useEffect, useMemo } from 'react';
import {
  Share2,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Calendar as CalendarIcon,
  LayoutDashboard,
  BarChart3,
  BookOpen,
  ArrowRight,
  UserCheck,
  Search,
  Filter,
  Lock,
  ChevronLeft,
  ChevronRight,
  Eye,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  ChevronDown
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import Logo from '../components/Logo';
import TradingCalendar from '../components/TradingCalendar';
import KnowYourTrades from '../components/KnowYourTrades';
import { Trade } from '../types';

interface SharedJournalPageProps {
  token: string;
  currentUser: any;
  onNavigate?: (path: string) => void;
}

export default function SharedJournalPage({
  token,
  currentUser,
  onNavigate,
}: SharedJournalPageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sharedData, setSharedData] = useState<{
    valid: boolean;
    ownerName: string;
    sections: string[];
    months: number | 'all';
    createdAt: string;
    views: number;
    isViewerRegistered: boolean;
    stats: {
      totalTrades: number;
      winRate: number;
      netProfit: number;
      profitFactor: number;
      winsCount: number;
      lossesCount: number;
      avgWin: number;
      avgLoss: number;
      bestTrade: number;
      worstTrade: number;
    };
    equityCurve: Array<{ tradeNum: number; date: string; pnl: number; equity: number }>;
    trades: any[];
    analysis: {
      pairs: Array<{ symbol: string; trades: number; winRate: number; profit: number }>;
    } | null;
  } | null>(null);

  // Active section tab
  const [activeSection, setActiveSection] = useState<string>('dashboard');

  // Journal table filters & pagination
  const [journalSearch, setJournalSearch] = useState('');
  const [journalFilterType, setJournalFilterType] = useState('ALL');
  const [journalFilterSymbol, setJournalFilterSymbol] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const tradesPerPage = 10;

  useEffect(() => {
    let isMounted = true;
    const fetchSharedJournal = async () => {
      try {
        setLoading(true);
        setError(null);

        const headers: Record<string, string> = {};
        const uid = sessionStorage.getItem('auth_user_id') || localStorage.getItem('auth_user_id');
        const email = sessionStorage.getItem('auth_email') || localStorage.getItem('auth_email');
        if (uid) headers['x-auth-user-id'] = uid;
        if (email) headers['x-auth-email'] = email;

        const res = await fetch(`/api/shared/${token}`, { headers });
        const data = await res.json();

        if (!isMounted) return;

        if (!res.ok || !data.valid) {
          setError(data.error || 'This shared journal link has expired or was disabled by the trader.');
        } else {
          setSharedData(data);
          // Set initial tab to first available section
          if (Array.isArray(data.sections) && data.sections.length > 0) {
            setActiveSection(data.sections[0]);
          }
        }
      } catch (err: any) {
        if (isMounted) setError(err?.message || 'Failed to load shared journal.');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchSharedJournal();
    return () => {
      isMounted = false;
    };
  }, [token, currentUser]);

  // Is viewer logged in / registered?
  const isRegisteredViewer = !!currentUser || !!sharedData?.isViewerRegistered;

  // Filtered trades for Journal tab
  const filteredTrades = useMemo(() => {
    if (!sharedData?.trades) return [];
    return sharedData.trades.filter((t) => {
      const matchType = journalFilterType === 'ALL' || t.type?.toUpperCase() === journalFilterType;
      const matchSymbol = journalFilterSymbol === 'ALL' || t.symbol?.toUpperCase() === journalFilterSymbol;
      const matchSearch =
        !journalSearch ||
        t.symbol?.toLowerCase().includes(journalSearch.toLowerCase()) ||
        t.emotion?.toLowerCase().includes(journalSearch.toLowerCase()) ||
        t.strategy?.toLowerCase().includes(journalSearch.toLowerCase()) ||
        (t.notes && t.notes.toLowerCase().includes(journalSearch.toLowerCase()));
      return matchType && matchSymbol && matchSearch;
    });
  }, [sharedData?.trades, journalFilterType, journalFilterSymbol, journalSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / tradesPerPage));
  const paginatedTrades = filteredTrades.slice((currentPage - 1) * tradesPerPage, currentPage * tradesPerPage);

  const availableSymbols = useMemo(() => {
    if (!sharedData?.trades) return [];
    return Array.from(new Set(sharedData.trades.map((t) => t.symbol?.toUpperCase()).filter(Boolean)));
  }, [sharedData?.trades]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(val);
  };

  const formatDateTime = (val: string | null | undefined): string => {
    if (!val) return '—';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val);
      const p = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      const hasTime = String(val).includes(':') || String(val).includes('T');
      if (!hasTime) return dateStr;
      const timeStr = `${p(d.getHours())}:${p(d.getMinutes())}`;
      return `${dateStr} ${timeStr}`;
    } catch {
      return String(val);
    }
  };

  const navigateTo = (path: string) => {
    if (onNavigate) {
      onNavigate(path);
    } else {
      window.location.href = path;
    }
  };

  // 1. Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-sm">
          <Logo size={34} className="justify-center" />
          <div className="flex items-center justify-center gap-2 text-violet-400 text-xs font-semibold">
            <span className="h-2 w-2 rounded-full bg-violet-400 animate-ping" />
            Loading verified journal record...
          </div>
        </div>
      </div>
    );
  }

  // 2. Error / Expired State
  if (error || !sharedData) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl backdrop-blur-md space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center justify-center mx-auto shadow-lg">
            <AlertCircle className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-bold text-white">Shared Journal Unavailable</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            {error || 'This shared journal link does not exist, has expired, or was revoked by the trader.'}
          </p>
          <div className="pt-2">
            <button
              onClick={() => navigateTo('/')}
              className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition shadow-lg shadow-violet-500/20"
            >
              Go to FXJournalPro Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { ownerName, sections, months, stats, equityCurve } = sharedData;

  const monthLabel =
    months === 'all'
      ? 'All Time (Full History)'
      : `Last ${months} Month${Number(months) > 1 ? 's' : ''}`;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans selection:bg-violet-500/30">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-[#0a0f1d]/90 backdrop-blur-md border-b border-slate-800/80 px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="cursor-pointer" onClick={() => navigateTo('/')}>
            <Logo size={26} />
          </div>
          <span className="hidden sm:inline-block h-4 w-[1px] bg-slate-800" />
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-violet-500/10 text-violet-400 border border-violet-500/20">
              <ShieldCheck className="h-3.5 w-3.5 text-violet-400" />
              Verified Performance
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isRegisteredViewer ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs">
              <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-slate-300 font-medium">
                Signed in as <strong className="text-white">{currentUser?.name || 'Trader'}</strong>
              </span>
              <button
                onClick={() => navigateTo('/dashboard')}
                className="ml-2 text-violet-400 hover:text-violet-300 font-semibold"
              >
                My Workspace →
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigateTo(`/login?redirect=/shared/${token}`)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs font-semibold text-slate-300 transition"
              >
                Sign In
              </button>
              <button
                onClick={() => navigateTo(`/register?redirect=/shared/${token}`)}
                className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold transition shadow-sm"
              >
                Register Free
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Hero Banner with Trader Info */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#0e162c] to-[#070b14] border-b border-slate-800/80 px-4 sm:px-8 py-8 sm:py-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-violet-900/15 via-transparent to-transparent pointer-events-none" />

        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-xs text-slate-400 font-medium">Shared Trading Journal</span>
              <span className="text-slate-600">•</span>
              <span className="text-xs text-violet-400 font-semibold flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {monthLabel}
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {sharedData.views} views
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {ownerName}
              <span className="text-slate-400 font-normal text-lg sm:text-xl">’s Trading Journal</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Authentic trading setups, risk execution, and statistical track record directly synced from live broker activity.
            </p>
          </div>

          {/* Quick Header Summary Pill */}
          <div className="flex items-center gap-4 bg-slate-900/80 border border-slate-800 p-3 sm:p-4 rounded-2xl backdrop-blur-md shadow-xl">
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Net Return</span>
              <span
                className={`text-lg sm:text-xl font-extrabold flex items-center gap-1 ${
                  stats.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {stats.netProfit >= 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
                {formatCurrency(stats.netProfit)}
              </span>
            </div>
            <div className="h-8 w-[1px] bg-slate-800" />
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Win Rate</span>
              <span className="text-lg sm:text-xl font-extrabold text-white">
                {stats.winRate}%
              </span>
            </div>
            <div className="h-8 w-[1px] bg-slate-800" />
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Profit Factor</span>
              <span className="text-lg sm:text-xl font-extrabold text-violet-400">
                {stats.profitFactor}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Section Tabs Navigation (Only allowed sections shown) */}
      <div className="bg-[#0a0f1d] border-b border-slate-800/80 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto flex items-center gap-2 overflow-x-auto no-scrollbar py-2">
          {sections.includes('dashboard') && (
            <button
              onClick={() => setActiveSection('dashboard')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap ${
                activeSection === 'dashboard'
                  ? 'bg-violet-600 text-white shadow-md shadow-violet-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </button>
          )}

          {sections.includes('analysis') && (
            <button
              onClick={() => setActiveSection('analysis')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap ${
                activeSection === 'analysis'
                  ? 'bg-violet-600 text-white shadow-md shadow-violet-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <BarChart3 className="h-4 w-4" />
              Analysis
            </button>
          )}

          {sections.includes('journal') && (
            <button
              onClick={() => setActiveSection('journal')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap ${
                activeSection === 'journal'
                  ? 'bg-violet-600 text-white shadow-md shadow-violet-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <BookOpen className="h-4 w-4" />
              Journal ({sharedData.trades?.length || stats.totalTrades})
            </button>
          )}

          {sections.includes('calendar') && (
            <button
              onClick={() => setActiveSection('calendar')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap ${
                activeSection === 'calendar'
                  ? 'bg-violet-600 text-white shadow-md shadow-violet-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <CalendarIcon className="h-4 w-4" />
              Calendar
            </button>
          )}
        </div>
      </div>

      {/* Main Shared Content Body */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-8 space-y-8 relative">
        {/* Unregistered Viewer Registration Banner / Gate */}
        {!isRegisteredViewer && (
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-950/60 via-indigo-950/50 to-slate-900 border border-violet-500/30 p-5 sm:p-6 shadow-2xl backdrop-blur-md">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    Guest Viewer
                  </span>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    Register on FXJournalPro to View Full Shared Content
                  </h3>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed max-w-2xl">
                  You are previewing <strong>{ownerName}</strong>'s verified performance. Create your free account or sign in to explore full trade executions, detailed analysis, and track your own trades.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => navigateTo(`/register?redirect=/shared/${token}`)}
                  className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold shadow-lg shadow-violet-500/25 transition flex items-center gap-1.5"
                >
                  Create Free Account
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => navigateTo(`/login?redirect=/shared/${token}`)}
                  className="px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs font-semibold text-slate-300 transition"
                >
                  Sign In
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 1. DASHBOARD TAB */}
        {activeSection === 'dashboard' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-sm space-y-2">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Net P&L</span>
                <div
                  className={`text-xl sm:text-2xl font-extrabold ${
                    stats.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatCurrency(stats.netProfit)}
                </div>
                <span className="text-[11px] text-slate-500 block">Total net profit in period</span>
              </div>

              <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-sm space-y-2">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Win Rate</span>
                <div className="text-xl sm:text-2xl font-extrabold text-white">
                  {stats.winRate}%
                </div>
                <span className="text-[11px] text-slate-500 block">
                  {stats.winsCount} Wins / {stats.lossesCount} Losses
                </span>
              </div>

              <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-sm space-y-2">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Profit Factor</span>
                <div className="text-xl sm:text-2xl font-extrabold text-violet-400">
                  {stats.profitFactor}
                </div>
                <span className="text-[11px] text-slate-500 block">Gross Profit / Gross Loss</span>
              </div>

              <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-sm space-y-2">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Total Trades</span>
                <div className="text-xl sm:text-2xl font-extrabold text-white">
                  {stats.totalTrades}
                </div>
                <span className="text-[11px] text-slate-500 block">Executed setups</span>
              </div>
            </div>

            {/* Growth Curve Chart */}
            <div className="p-5 sm:p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white">Equity Growth Curve</h3>
                  <p className="text-[11px] text-slate-400">Cumulative profit progression across all trades</p>
                </div>
              </div>

              <div className="h-64 sm:h-72 w-full">
                {equityCurve && equityCurve.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={equityCurve}>
                      <defs>
                        <linearGradient id="sharedEquityGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                      <XAxis dataKey="date" stroke="#64748b" fontSize={10} tickLine={false} />
                      <YAxis stroke="#64748b" fontSize={10} tickLine={false} tickFormatter={(v) => `$${v}`} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#334155',
                          borderRadius: '0.75rem',
                          fontSize: '11px',
                        }}
                        formatter={(val: any) => [formatCurrency(Number(val)), 'Cumulative Equity']}
                      />
                      <Area
                        type="monotone"
                        dataKey="equity"
                        stroke="#8b5cf6"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#sharedEquityGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-slate-500">
                    No trade equity history available for this timeframe.
                  </div>
                )}
              </div>
            </div>

            {/* Secondary Trade Mechanics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
              <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 block mb-1">Average Win</span>
                <span className="text-sm font-bold text-emerald-400">{formatCurrency(stats.avgWin)}</span>
              </div>
              <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 block mb-1">Average Loss</span>
                <span className="text-sm font-bold text-rose-400">{formatCurrency(stats.avgLoss)}</span>
              </div>
              <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 block mb-1">Best Trade</span>
                <span className="text-sm font-bold text-emerald-400">{formatCurrency(stats.bestTrade)}</span>
              </div>
              <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 block mb-1">Worst Trade</span>
                <span className="text-sm font-bold text-rose-400">{formatCurrency(stats.worstTrade)}</span>
              </div>
            </div>
          </div>
        )}

        {/* 2. ANALYSIS TAB */}
        {activeSection === 'analysis' && (
          <div className="space-y-6">
            {sharedData.trades && sharedData.trades.length > 0 && (
              <KnowYourTrades
                trades={sharedData.trades as Trade[]}
                accounts={[]}
                currency="USD"
              />
            )}

            {sharedData.analysis?.pairs && sharedData.analysis.pairs.length > 0 ? (
              <div className="p-5 sm:p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-sm space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white">Pairs Performance Breakdown</h3>
                  <p className="text-[11px] text-slate-400">Statistical win rates and net profits grouped by instrument</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                        <th className="py-3 px-4 font-semibold">Symbol</th>
                        <th className="py-3 px-4 font-semibold text-center">Trades</th>
                        <th className="py-3 px-4 font-semibold text-center">Win Rate</th>
                        <th className="py-3 px-4 font-semibold text-right">Net Profit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {sharedData.analysis.pairs.map((p) => (
                        <tr key={p.symbol} className="hover:bg-slate-800/30 transition">
                          <td className="py-3 px-4 font-bold text-white">{p.symbol}</td>
                          <td className="py-3 px-4 text-center text-slate-300">{p.trades}</td>
                          <td className="py-3 px-4 text-center font-semibold text-slate-200">
                            {p.winRate}%
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-extrabold ${
                              p.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {formatCurrency(p.profit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center text-xs text-slate-500 bg-slate-900/40 rounded-2xl border border-slate-800">
                No pair analysis data available for this selection.
              </div>
            )}
          </div>
        )}

        {/* 3. JOURNAL TAB */}
        {activeSection === 'journal' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={journalSearch}
                    onChange={(e) => {
                      setJournalSearch(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="Search pair or comments..."
                    className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-violet-500 w-44"
                  />
                </div>

                <select
                  value={journalFilterSymbol}
                  onChange={(e) => {
                    setJournalFilterSymbol(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-violet-500"
                >
                  <option value="ALL">All Symbols</option>
                  {availableSymbols.map((sym) => (
                    <option key={sym} value={sym}>
                      {sym}
                    </option>
                  ))}
                </select>

                <select
                  value={journalFilterType}
                  onChange={(e) => {
                    setJournalFilterType(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-violet-500"
                >
                  <option value="ALL">All Types</option>
                  <option value="BUY">Buy</option>
                  <option value="SELL">Sell</option>
                </select>
              </div>

              <div className="text-xs text-slate-400 font-medium">
                Showing {paginatedTrades.length} of {filteredTrades.length} trades
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 text-[11px] font-semibold">
                    <th className="py-3 px-4 whitespace-nowrap">Entry Time</th>
                    <th className="py-3 px-4 whitespace-nowrap">Exit Time</th>
                    <th className="py-3 px-4">Symbol</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4 text-center">Volume</th>
                    <th className="py-3 px-4 text-center">Entry</th>
                    <th className="py-3 px-4 text-center">Exit</th>
                    <th className="py-3 px-4 text-right">Net Profit</th>
                    <th className="py-3 px-4 text-center">Emotion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {paginatedTrades.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-xs text-slate-500">
                        No trade records match the chosen filter.
                      </td>
                    </tr>
                  ) : (
                    paginatedTrades.map((t) => {
                      const isProfit = (Number(t.profit) || Number(t.pnl) || 0) >= 0;
                      return (
                        <tr key={t.id} className="hover:bg-slate-800/40 transition">
                          <td className="py-3 px-4 text-slate-300 whitespace-nowrap font-mono text-[11px]">
                            {formatDateTime(t.date || t.openTime || t.entryTime)}
                          </td>
                          <td className="py-3 px-4 text-slate-300 whitespace-nowrap font-mono text-[11px]">
                            {formatDateTime(t.exitTime || t.closeTime)}
                          </td>
                          <td className="py-3 px-4 font-bold text-white">{t.symbol}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                t.type === 'Buy'
                                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                  : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                              }`}
                            >
                              {t.type}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center text-slate-300 font-mono">
                            {t.lotSize ?? t.lots ?? '—'}
                          </td>
                          <td className="py-3 px-4 text-center text-slate-300 font-mono">
                            {t.entryPrice ?? '—'}
                          </td>
                          <td className="py-3 px-4 text-center text-slate-300 font-mono">
                            {t.exitPrice ?? '—'}
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-extrabold font-mono ${
                              isProfit ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {formatCurrency(Number(t.profit) || Number(t.pnl) || 0)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-300">
                              {t.emotion || 'Calm'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-400">
                  Page {currentPage} of {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-white disabled:opacity-40 transition"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-white disabled:opacity-40 transition"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 4. CALENDAR TAB */}
        {activeSection === 'calendar' && (
          <div className="space-y-4">
            <div className="p-4 sm:p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
              <TradingCalendar
                trades={(sharedData.trades as Trade[]) || []}
                currency="USD"
              />
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-800/80 bg-[#070b14] px-4 sm:px-8 py-6 text-center text-xs text-slate-500">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 max-w-6xl mx-auto">
          <div className="flex items-center gap-2">
            <Logo size={20} />
            <span>FXJournalPro · Privacy Protected Trading Intelligence</span>
          </div>
          <div>
            Want your own verified trading journal?{' '}
            <button
              onClick={() => navigateTo('/register')}
              className="text-violet-400 hover:underline font-semibold"
            >
              Start Free Today →
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users, Crown, Activity, TrendingUp, ArrowLeft, Calendar, BookOpen,
  BarChart3, Clock, Lock, RefreshCw, Search, AlertCircle, ChevronRight,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

/**
 * Sub-Admin Console.
 *
 * Strictly read-only: there is no write path in this file, and the server
 * refuses any non-GET on /api/admin from a sub-admin session, so hiding the
 * controls is the second line of defence rather than the only one.
 *
 * A sub-admin sees only the users assigned to them. A super admin can pass
 * `subAdminId` to look at the same console a given sub-admin would see.
 */

interface OverviewUser {
  id: string;
  name: string;
  email: string;
  isPro: boolean;
  status: string;
  joinedAt: string | null;
  lastLogin: string | null;
  // Null when the viewer is a partner and this user has not switched on
  // "Allow Partner to View Trade Details". The server leaves the numbers out
  // of the payload entirely rather than sending them for the UI to hide.
  tradesToday: number | null;
  tradesTotal: number | null;
  netPnl: number | null;
  tradeAccess?: boolean;
  activity: { date: string; count: number }[];
}

interface Overview {
  subAdminId: string | null;
  stats: {
    totalUsers: number; proUsers: number; freeUsers: number;
    activeToday: number; tradesToday: number; sharingTrades?: number;
  };
  growth: { date: string; count: number }[];
  users: OverviewUser[];
}

interface Analysis {
  totalTrades: number; closedTrades: number; wins: number; losses: number;
  winRate: number; netPnl: number; grossWin: number; grossLoss: number;
  profitFactor: number | null; avgWin: number; avgLoss: number;
  avgR: number | null; bestTrade: number; worstTrade: number;
}

interface Detail {
  readOnly: boolean;
  user: any;
  accounts: any[];
  trades: any[];
  analysis: Analysis;
  activity: { date: string; count: number }[];
  journal: {
    id: string; date: string; symbol: string; type: string; profit: number;
    notes: string; emotion: string | null; strategy: string | null; tags: string[];
  }[];
}

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const shortDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const relativeTime = (iso?: string | null) => {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return 'Never';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return shortDate(iso);
};

function StatTile({ icon: Icon, label, value, tone = 'slate' }: {
  icon: any; label: string; value: string | number; tone?: 'slate' | 'violet' | 'emerald' | 'amber';
}) {
  const tones: Record<string, string> = {
    slate: 'text-slate-300 bg-slate-800/60 border-slate-700/60',
    violet: 'text-violet-300 bg-violet-600/10 border-violet-500/30',
    emerald: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25',
    amber: 'text-amber-300 bg-amber-500/10 border-amber-500/25',
  };
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
        <span className={`p-1.5 rounded-lg border ${tones[tone]}`}><Icon className="h-3.5 w-3.5" /></span>
      </div>
      <p className="text-2xl font-extrabold text-white tabular-nums">{value}</p>
    </div>
  );
}

/** Contributions-style heatmap. Weeks run left to right, days top to bottom. */
function ActivityHeatmap({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const weeks = useMemo(() => {
    if (data.length === 0) return [] as { date: string; count: number }[][];
    // Pad the front so the first column starts on a Sunday.
    const lead = new Date(data[0].date).getDay();
    const cells = [...Array(lead).fill(null), ...data];
    const out: any[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [data]);

  const shade = (count: number) => {
    if (count === 0) return 'bg-slate-800/60';
    const ratio = count / max;
    if (ratio > 0.66) return 'bg-violet-400';
    if (ratio > 0.33) return 'bg-violet-500/80';
    return 'bg-violet-600/50';
  };

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex gap-[3px]">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((cell: any, di: number) => (
              <div
                key={di}
                title={cell ? `${cell.count} on ${cell.date}` : ''}
                className={`h-[10px] w-[10px] rounded-[2px] ${cell ? shade(cell.count) : 'bg-transparent'}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3 text-[10px] text-slate-500">
        <span>Less</span>
        <span className="h-[10px] w-[10px] rounded-[2px] bg-slate-800/60" />
        <span className="h-[10px] w-[10px] rounded-[2px] bg-violet-600/50" />
        <span className="h-[10px] w-[10px] rounded-[2px] bg-violet-500/80" />
        <span className="h-[10px] w-[10px] rounded-[2px] bg-violet-400" />
        <span>More</span>
      </div>
    </div>
  );
}

/** 30-day trade sparkline on a user card. */
function Sparkline({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const points = data.map((d, i) => {
    const x = (i / Math.max(1, data.length - 1)) * 100;
    const y = 24 - (d.count / max) * 22;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5"
        vectorEffect="non-scaling-stroke" className="text-violet-400" />
    </svg>
  );
}

/**
 * variant only changes wording. A sub-admin's users were handed to them by an
 * admin ("assigned"); a partner's arrived through their referral link
 * ("referred"), and telling a partner their network was "assigned" to them
 * describes the wrong thing entirely.
 */
export default function SubAdminConsole({
  subAdminId,
  variant = 'subadmin',
}: {
  subAdminId?: string;
  variant?: 'subadmin' | 'partner';
}) {
  const isPartner = variant === 'partner';
  const noun = isPartner ? 'referred' : 'assigned';
  const [overview, setOverview] = useState<Overview | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'history' | 'analysis' | 'calendar' | 'journal'>('analysis');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);

  const getAuthHeaders = () => {
    const headers: Record<string, string> = {};
    const userId = sessionStorage.getItem('auth_user_id');
    const email = sessionStorage.getItem('auth_email');
    if (userId) headers['x-auth-user-id'] = userId;
    if (email) headers['x-auth-email'] = email;
    return headers;
  };

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = subAdminId ? `?subAdminId=${encodeURIComponent(subAdminId)}` : '';
      const res = await fetch(`/api/subadmin/overview${query}`, {
        credentials: 'include',
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not load your users.');
      }
      setOverview(await res.json());
    } catch (e: any) {
      setError(e.message || 'Could not load your users.');
    } finally {
      setLoading(false);
    }
  }, [subAdminId]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  useEffect(() => {
    if (!openUserId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    setAccessDenied(false);
    fetch(`/api/subadmin/user/${encodeURIComponent(openUserId)}`, {
      credentials: 'include',
      headers: getAuthHeaders()
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403 && body.code === 'TRADE_ACCESS_DENIED') {
          // Not an error — the user simply has not shared. Handled with its own
          // empty state so it does not read as something the partner broke.
          if (!cancelled) setAccessDenied(true);
          return null;
        }
        if (!res.ok) throw new Error(body.error || 'Could not open that user.');
        return body;
      })
      .then((d) => { if (!cancelled && d) setDetail(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [openUserId]);

  const visibleUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !overview) return overview?.users || [];
    return overview.users.filter((u) =>
      u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [overview, search]);

  // ── Per-user detail tab ──────────────────────────────────────────────────
  if (openUserId) {
    const analysis = detail?.analysis;
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setOpenUserId(null)}
            className="flex items-center gap-2 text-xs font-bold text-slate-300 bg-slate-800/70 hover:bg-slate-700/70 border border-slate-700/70 rounded-xl px-3 py-2 transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All users
          </button>
          {detail && (
            <>
              <div>
                <h3 className="text-base font-extrabold text-white leading-tight">{detail.user?.name || 'Trader'}</h3>
              </div>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${
                detail.user?.isPro
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}>
                {detail.user?.isPro ? 'PREMIUM' : 'FREE'}
              </span>
              <span className="ml-auto flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-800/60 border border-slate-700/60 rounded-full px-2.5 py-1">
                <Lock className="h-3 w-3" /> Read only
              </span>
            </>
          )}
        </div>

        {detailLoading && <p className="text-sm text-slate-400 py-10 text-center">Loading…</p>}

        {accessDenied && !detailLoading && (
          <div className="border border-slate-800/80 rounded-2xl py-14 px-6 text-center">
            <Lock className="h-6 w-6 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-300 font-semibold">This user has not shared their trading data</p>
            <p className="text-xs text-slate-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
              Their trades, analysis and journal stay private until they turn on
              <span className="text-slate-400 font-semibold"> Allow Partner to View Trade Details </span>
              in their own settings. Only they can switch it on.
            </p>
          </div>
        )}

        {detail && !detailLoading && (
          <>
            <div className="flex gap-1.5 border-b border-slate-800/80 pb-1 overflow-x-auto scrollbar-hide">
              {([
                { id: 'analysis', label: 'User Analysis', icon: BarChart3 },
                { id: 'history', label: 'Trading History', icon: TrendingUp },
                { id: 'calendar', label: 'Activity Calendar', icon: Calendar },
                { id: 'journal', label: 'Journal', icon: BookOpen },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setDetailTab(t.id)}
                  className={`py-2.5 px-4 text-xs font-bold rounded-xl transition flex items-center gap-2 whitespace-nowrap border ${
                    detailTab === t.id
                      ? 'bg-violet-600/20 text-violet-300 border-violet-500/40'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <t.icon className="h-4 w-4" /> {t.label}
                </button>
              ))}
            </div>

            {detailTab === 'analysis' && analysis && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatTile icon={TrendingUp} label="Net P&L" value={money(analysis.netPnl)}
                    tone={analysis.netPnl >= 0 ? 'emerald' : 'amber'} />
                  <StatTile icon={BarChart3} label="Win rate" value={`${analysis.winRate.toFixed(1)}%`} tone="violet" />
                  <StatTile icon={Activity} label="Avg R" value={analysis.avgR === null ? '—' : `${analysis.avgR.toFixed(2)}R`} />
                  <StatTile icon={BookOpen} label="Trades" value={analysis.totalTrades} />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatTile icon={TrendingUp} label="Profit factor"
                    value={analysis.profitFactor === null ? '—' : analysis.profitFactor.toFixed(2)} />
                  <StatTile icon={TrendingUp} label="Wins / losses" value={`${analysis.wins} / ${analysis.losses}`} />
                  <StatTile icon={TrendingUp} label="Best trade" value={money(analysis.bestTrade)} tone="emerald" />
                  <StatTile icon={TrendingUp} label="Worst trade" value={money(analysis.worstTrade)} tone="amber" />
                </div>
                {analysis.avgR === null && (
                  <p className="text-[11px] text-slate-500">
                    R-multiple needs an entry, exit and stop loss on a trade. None of this
                    user's trades have all three yet.
                  </p>
                )}
              </div>
            )}

            {detailTab === 'history' && (
              <div className="overflow-x-auto border border-slate-800/80 rounded-2xl">
                <table className="w-full text-xs">
                  <thead className="bg-slate-900/70 text-slate-400">
                    <tr>
                      {['Date', 'Symbol', 'Type', 'Lots', 'Entry', 'Exit', 'Net P&L'].map((h) => (
                        <th key={h} className="text-left font-bold uppercase tracking-wider px-4 py-3 text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {detail.trades.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">No trades logged yet.</td></tr>
                    )}
                    {detail.trades.map((t: any) => {
                      const net = (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);
                      return (
                        <tr key={t.id} className="hover:bg-slate-900/50">
                          <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{shortDate(t.date)}</td>
                          <td className="px-4 py-2.5 font-bold text-white">{t.symbol}</td>
                          <td className="px-4 py-2.5">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              String(t.type).toLowerCase().startsWith('s')
                                ? 'bg-red-500/10 text-red-300' : 'bg-emerald-500/10 text-emerald-300'
                            }`}>{t.type}</span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-400 tabular-nums">{t.lotSize}</td>
                          <td className="px-4 py-2.5 text-slate-400 tabular-nums">{t.entryPrice ?? '—'}</td>
                          <td className="px-4 py-2.5 text-slate-400 tabular-nums">{t.exitPrice ?? '—'}</td>
                          <td className={`px-4 py-2.5 font-bold tabular-nums ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {money(net)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {detailTab === 'calendar' && (
              <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4">
                  Trades logged — last 12 months
                </p>
                <ActivityHeatmap data={detail.activity} />
              </div>
            )}

            {detailTab === 'journal' && (
              <div className="space-y-3">
                <p className="flex items-center gap-2 text-[11px] text-slate-500">
                  <Lock className="h-3 w-3" /> Journal entries cannot be edited, deleted or commented on.
                </p>
                {detail.journal.length === 0 && (
                  <p className="text-sm text-slate-500 py-10 text-center border border-slate-800/80 rounded-2xl">
                    This user has not written any journal notes yet.
                  </p>
                )}
                {detail.journal.map((entry) => (
                  <div key={entry.id} className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4">
                    <div className="flex flex-wrap items-center gap-2.5 mb-2">
                      <span className="font-bold text-white text-sm">{entry.symbol}</span>
                      <span className="text-[10px] text-slate-500">{shortDate(entry.date)}</span>
                      <span className={`text-xs font-bold tabular-nums ${entry.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {money(entry.profit)}
                      </span>
                      {entry.emotion && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                          {entry.emotion}
                        </span>
                      )}
                      {entry.strategy && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-600/10 text-violet-300 border border-violet-500/25">
                          {entry.strategy}
                        </span>
                      )}
                    </div>
                    {entry.notes && <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{entry.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ── Overview ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/25 text-red-300 rounded-2xl px-4 py-3 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatTile icon={Users} label={isPartner ? 'Referred users' : 'Assigned users'} value={overview?.stats.totalUsers ?? 0} tone="violet" />
        <StatTile icon={Crown} label="Premium" value={overview?.stats.proUsers ?? 0} tone="amber" />
        <StatTile icon={Users} label="Free" value={overview?.stats.freeUsers ?? 0} />
        <StatTile icon={Activity} label="Active today" value={overview?.stats.activeToday ?? 0} tone="emerald" />
        <StatTile icon={TrendingUp} label="Trades today" value={overview?.stats.tradesToday ?? 0} />
      </div>

      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {isPartner ? 'User growth' : 'Assigned users over time'}
          </p>
          <button
            onClick={loadOverview}
            disabled={loading}
            className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 bg-slate-800/70 hover:bg-slate-700/70 border border-slate-700/70 rounded-lg px-2.5 py-1.5 transition"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin text-violet-400' : ''}`} /> Refresh
          </button>
        </div>
        {(overview?.growth?.length ?? 0) < 2 ? (
          <p className="text-xs text-slate-500 py-12 text-center">
            Not enough history to draw a trend yet — it appears once users {isPartner ? 'join' : 'are assigned'} on more than one day.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={overview!.growth}>
              <defs>
                <linearGradient id="subadminGrowth" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} width={28} />
              <Tooltip
                contentStyle={{ background: '#0b0f19', border: '1px solid #1e293b', borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Area type="monotone" dataKey="count" stroke="#a78bfa" strokeWidth={2} fill="url(#subadminGrowth)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${noun} users by name or email`}
          className="w-full bg-slate-900/60 border border-slate-800/80 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
        />
      </div>

      {loading && <p className="text-sm text-slate-400 py-10 text-center">Loading your {noun} users…</p>}

      {!loading && visibleUsers.length === 0 && (
        <div className="border border-slate-800/80 rounded-2xl py-14 text-center">
          <Users className="h-6 w-6 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-semibold">
            {search
              ? `No ${noun} user matches that search.`
              : isPartner ? 'Nobody has signed up with your link yet.' : 'No users are assigned to you yet.'}
          </p>
          {!search && (
            <p className="text-xs text-slate-600 mt-1">
              {isPartner
                ? 'Share your referral link or code above — anyone who signs up with it appears here.'
                : 'A super admin assigns users from the Team & Roles tab.'}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {visibleUsers.map((u) => (
          <button
            key={u.id}
            onClick={() => { setOpenUserId(u.id); setDetailTab('analysis'); }}
            className="group text-left bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-violet-500/40 rounded-2xl p-4 transition"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="font-bold text-white text-sm truncate">{u.name || 'Trader'}</p>
                <p className="text-[11px] text-slate-500 truncate">{u.isPro ? 'Pro Member' : 'Free Member'}</p>
              </div>
              <span className={`shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                u.isPro
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}>
                {u.isPro ? 'PREMIUM' : 'FREE'}
              </span>
            </div>

            {u.tradeAccess === false ? (
              <div className="mt-1 mb-1 flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-3">
                <Lock className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                <p className="text-[11px] leading-snug text-slate-500">
                  Trade details are private. This user can share them from their settings.
                </p>
              </div>
            ) : (
              <>
                <div className="text-violet-400/70 group-hover:text-violet-400 transition"><Sparkline data={u.activity} /></div>

                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-800/70">
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-slate-600 font-bold">Today</p>
                    <p className="text-sm font-extrabold text-white tabular-nums">{u.tradesToday ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-slate-600 font-bold">Total</p>
                    <p className="text-sm font-extrabold text-white tabular-nums">{u.tradesTotal ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-slate-600 font-bold">Net P&amp;L</p>
                    <p className={`text-sm font-extrabold tabular-nums ${(u.netPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {money(u.netPnl ?? 0)}
                    </p>
                  </div>
                </div>
              </>
            )}

            <div className="flex items-center justify-between mt-3 text-[10px] text-slate-500">
              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Joined {shortDate(u.joinedAt)}</span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {relativeTime(u.lastLogin)}</span>
            </div>

            <span className="flex items-center gap-1 mt-3 text-[10px] font-bold text-violet-400/0 group-hover:text-violet-400 transition">
              {u.tradeAccess === false ? 'Sharing is off' : 'Open dashboard'} <ChevronRight className="h-3 w-3" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

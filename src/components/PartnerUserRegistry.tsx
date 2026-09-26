import React, { useState, useEffect, useCallback } from 'react';
import { Search, Crown, Gift, BarChart3, Users, RefreshCw } from 'lucide-react';

interface PartnerUser {
  id: string;
  name?: string;
  email?: string;
  isPro?: boolean;
  status?: string;
  authProvider?: string;
  lastLogin?: string | null;
  createdAt?: string | null;
  tradingStyle?: string;
  experience?: string;
  accountsCount?: number;
  tradesCount?: number;
  referralCode?: string;
  referralCount?: number;
  referralIncome?: number;
  allowPartnerTradeView?: boolean;
}

interface PartnerUserRegistryProps {
  onInspectUser?: (user: any) => void;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Never';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDate(iso?: string | null): string {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'N/A';
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export default function PartnerUserRegistry({ onInspectUser }: PartnerUserRegistryProps) {
  const [users, setUsers] = useState<PartnerUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState<'ALL' | 'PRO' | 'FREE'>('ALL');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not load your referred users.');
      }
      const data = await res.json();
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load referred traders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const totalUsers = users.length;
  const totalPro = users.filter((u) => u.isPro).length;
  const totalFree = users.filter((u) => !u.isPro).length;

  const filteredUsers = users.filter((u) => {
    if (planFilter === 'PRO' && !u.isPro) return false;
    if (planFilter === 'FREE' && u.isPro) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const nameMatch = (u.name || '').toLowerCase().includes(q);
      const emailMatch = (u.email || '').toLowerCase().includes(q);
      const refMatch = (u.referralCode || '').toLowerCase().includes(q);
      if (!nameMatch && !emailMatch && !refMatch) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Search and Filters Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 sm:p-4 bg-slate-900/60 rounded-2xl border border-slate-800/90 shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or referral code..."
            className="w-full pl-10 pr-4 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex rounded-xl bg-slate-950/70 p-1 border border-slate-800 text-xs">
            {(['ALL', 'PRO', 'FREE'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setPlanFilter(filter)}
                className={`px-3.5 py-1 rounded-lg font-bold text-xs transition cursor-pointer ${
                  planFilter === filter
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {filter === 'ALL'
                  ? `All (${totalUsers})`
                  : filter === 'PRO'
                  ? `Pro (${totalPro})`
                  : `Free (${totalFree})`}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={fetchUsers}
            disabled={loading}
            title="Refresh list"
            className="p-2 rounded-xl border border-slate-800 bg-slate-950/70 hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-violet-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="overflow-x-auto bg-[#070b14]/90 rounded-2xl border border-slate-800/90 shadow-xl">
        <table className="w-full text-left border-collapse text-xs min-w-[840px]">
          <thead>
            <tr className="border-b border-slate-800/90 text-slate-400 uppercase tracking-wider font-extrabold text-[10.5px] bg-slate-900/60">
              <th className="py-3.5 px-4">User Details</th>
              <th className="py-3.5 px-4">Plan Tier</th>
              <th className="py-3.5 px-4">Last Activity</th>
              <th className="py-3.5 px-4">Trading Profile</th>
              <th className="py-3.5 px-4 text-center">Accounts &amp; Trades</th>
              <th className="py-3.5 px-4">Referral Info</th>
              <th className="py-3.5 px-4 text-center">Status</th>
              <th className="py-3.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <div className="h-6 w-6 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
                    <span className="text-xs">Loading referred traders…</span>
                  </div>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-rose-400 text-xs">
                  {error}
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500">
                  <Users className="h-8 w-8 mx-auto mb-2 text-slate-600 opacity-60" />
                  <p className="font-semibold text-slate-400 text-sm">No referred traders found</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {search ? 'Try changing your search keywords' : 'Traders who register with your referral link will appear here'}
                  </p>
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => (
                <tr key={u.id} className="hover:bg-slate-800/30 transition group">
                  {/* User Details */}
                  <td className="py-3.5 px-4">
                    <div className="font-bold text-white flex items-center gap-1.5 text-xs">
                      <span>{u.name || 'Trader'}</span>
                      {u.authProvider === 'google' && (
                        <span title="Google Account" className="text-[10px] px-1 py-0.2 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-bold">
                          G
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">{u.email}</div>
                  </td>

                  {/* Plan Tier */}
                  <td className="py-3.5 px-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        u.isPro
                          ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {u.isPro && <Crown className="h-3 w-3 text-amber-400 fill-amber-400" />}
                      {u.isPro ? 'Pro Member' : 'Free Basic'}
                    </span>
                  </td>

                  {/* Last Activity */}
                  <td className="py-3.5 px-4">
                    <div className="text-slate-300 font-medium text-[11px]">{formatDateTime(u.lastLogin)}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Joined: {formatDate(u.createdAt)}</div>
                  </td>

                  {/* Trading Profile */}
                  <td className="py-3.5 px-4">
                    <div className="text-slate-200 font-medium text-xs">{u.tradingStyle || 'Day Trading'}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{u.experience || 'Intermediate'}</div>
                  </td>

                  {/* Accounts & Trades */}
                  <td className="py-3.5 px-4 text-center">
                    <div className="inline-flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono font-bold text-xs">
                        {u.accountsCount || 0} acc
                      </span>
                      <button
                        type="button"
                        onClick={() => onInspectUser?.(u)}
                        className="px-2.5 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 font-mono font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-sm hover:scale-105 active:scale-95"
                        title="Click to inspect all trades & journal"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>{u.tradesCount || 0} trades</span>
                      </button>
                    </div>
                  </td>

                  {/* Referral Info */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-1 text-[11px] font-mono text-violet-300">
                      <Gift className="h-3 w-3 text-violet-400" />
                      <span className="bg-violet-500/10 px-1.5 py-0.2 rounded border border-violet-500/20">
                        {u.referralCode || 'FX-100'}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-2">
                      <span>Ref: <strong className="text-white">{u.referralCount || 0}</strong></span>
                      <span>Earned: <strong className="text-emerald-400">₹{u.referralIncome || 0}</strong></span>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="py-3.5 px-4 text-center">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wide uppercase ${
                        !u.status || u.status === 'ACTIVE'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}
                    >
                      {u.status || 'ACTIVE'}
                    </span>
                  </td>

                  {/* Actions: Analysis only (No Upgrade to Partner, No Suspend) */}
                  <td className="py-3.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => onInspectUser?.(u)}
                      className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-500 hover:via-purple-500 hover:to-indigo-500 text-white font-black text-xs inline-flex items-center gap-1.5 transition-all shadow-md shadow-violet-500/30 hover:scale-105 active:scale-95 shrink-0 border border-violet-400/30 cursor-pointer"
                      title="Inspect Trader Journal & Analysis"
                    >
                      <BarChart3 className="h-4 w-4 text-white" />
                      <span>Analysis</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

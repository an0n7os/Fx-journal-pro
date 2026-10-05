import React, { useState, useEffect } from 'react';
import {
  X,
  Share2,
  Lock,
  Crown,
  Check,
  Copy,
  ExternalLink,
  Shield,
  Calendar,
  LayoutDashboard,
  BarChart3,
  BookOpen,
  Trash2,
  Clock,
  Eye,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useScrollLock } from '../lib/useScrollLock';

export interface SharedLinkItem {
  token: string;
  userId: string;
  userName: string;
  sections: string[];
  months: number | 'all';
  active: boolean;
  views: number;
  createdAt: string;
  revokedAt?: string | null;
}

interface ShareJournalModalProps {
  isOpen: boolean;
  onClose: () => void;
  isPro: boolean;
  onUpgrade: () => void;
  getAuthHeaders?: () => Record<string, string>;
}

export default function ShareJournalModal({
  isOpen,
  onClose,
  isPro,
  onUpgrade,
  getAuthHeaders,
}: ShareJournalModalProps) {
  // Prevent background scrolling when share modal is open
  useScrollLock(isOpen);

  const [activeTab, setActiveTab] = useState<'create' | 'manage'>('create');

  // Creation state
  const [selectedSections, setSelectedSections] = useState<string[]>([
    'dashboard',
    'journal',
  ]);
  const [selectedMonths, setSelectedMonths] = useState<number | 'all'>(3);
  const [generating, setGenerating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<{
    token: string;
    url: string;
    sections: string[];
    months: number | 'all';
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Active links list
  const [links, setLinks] = useState<SharedLinkItem[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);

  const authHeaders = React.useMemo(() => {
    if (getAuthHeaders) return getAuthHeaders();
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const uid = sessionStorage.getItem('auth_user_id') || localStorage.getItem('auth_user_id');
    const email = sessionStorage.getItem('auth_email') || localStorage.getItem('auth_email');
    if (uid) h['x-auth-user-id'] = uid;
    if (email) h['x-auth-email'] = email;
    return h;
  }, [getAuthHeaders]);

  const loadActiveLinks = async () => {
    try {
      setLoadingLinks(true);
      const res = await fetch('/api/shared-links', {
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        setLinks(Array.isArray(data.links) ? data.links : []);
      }
    } catch (_) {
      // ignore
    } finally {
      setLoadingLinks(false);
    }
  };

  useEffect(() => {
    if (isOpen && isPro) {
      loadActiveLinks();
      setErrorMsg('');
      setGeneratedLink(null);
    }
  }, [isOpen, isPro]);

  if (!isOpen) return null;

  const toggleSection = (id: string) => {
    setSelectedSections((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev; // Keep at least one
        return prev.filter((s) => s !== id);
      }
      return [...prev, id];
    });
  };

  const handleGenerate = async () => {
    if (selectedSections.length === 0) {
      setErrorMsg('Please select at least one section to share.');
      return;
    }
    setErrorMsg('');
    setGenerating(true);

    try {
      const res = await fetch('/api/shared-links', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          sections: selectedSections,
          months: selectedMonths,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to generate share link.');
      } else {
        const fullUrl = `${window.location.origin}/shared/${data.link.token}`;
        setGeneratedLink({
          token: data.link.token,
          url: fullUrl,
          sections: data.link.sections,
          months: data.link.months,
        });
        loadActiveLinks();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error generating share link.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = (url: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  const handleRevoke = async (token: string) => {
    if (!window.confirm('Are you sure you want to disable this share link? Anyone visiting it will no longer have access.')) {
      return;
    }
    setRevokingToken(token);
    try {
      const res = await fetch(`/api/shared-links/${token}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (res.ok) {
        setLinks((prev) =>
          prev.map((l) => (l.token === token ? { ...l, active: false } : l))
        );
        if (generatedLink?.token === token) {
          setGeneratedLink(null);
        }
      }
    } catch (_) {
      // ignore
    } finally {
      setRevokingToken(null);
    }
  };

  const availableSections = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      desc: 'Win Rate, Profit Factor, Net P&L & Equity Growth Curve',
      icon: LayoutDashboard,
      color: 'text-violet-500 bg-violet-500/10 border-violet-500/20',
    },
    {
      id: 'analysis',
      label: 'Analysis',
      desc: 'Pairs performance breakdown, metrics & distribution',
      icon: BarChart3,
      color: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
    },
    {
      id: 'journal',
      label: 'Journal',
      desc: 'Complete trade logs, entry/exit prices, lots & individual P&L',
      icon: BookOpen,
      color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
    },
    {
      id: 'calendar',
      label: 'Calendar',
      desc: 'Interactive calendar showing daily P&L and trade counts',
      icon: Calendar,
      color: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
    },
  ];

  const monthOptions = [
    { value: 1, label: 'Last 1 Month' },
    { value: 3, label: 'Last 3 Months (Recommended)' },
    { value: 6, label: 'Last 6 Months' },
    { value: 12, label: 'Last 1 Year' },
    { value: 'all', label: 'All Time (Full History)' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fadeIn overscroll-contain modal-backdrop-contain">
      <div className="relative w-full max-w-2xl bg-white dark:bg-[#0f172a] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white">
              <Share2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  Share Your Journal
                </h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-amber-500/20 to-violet-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  <Crown className="h-3 w-3" />
                  PRO
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Generate secure, privacy-guarded links to showcase your verified trading.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* PRO Restriction Guard */}
        {!isPro ? (
          <div className="p-6 sm:p-8 text-center space-y-5">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-violet-500/20 border border-amber-500/30 flex items-center justify-center text-amber-500 shadow-xl">
              <Lock className="h-8 w-8" />
            </div>
            <div className="max-w-md mx-auto space-y-2">
              <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                Journal Sharing is an Exclusive Pro Feature
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Upgrade to FXJournalPro to create privacy-guarded public links for mentors, prop firms, investors, or friends. Control exactly what sections and months are visible.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 max-w-md mx-auto text-left space-y-2.5 text-xs text-slate-600 dark:text-slate-300">
              <div className="flex items-center gap-2 font-medium">
                <Check className="h-4 w-4 text-emerald-500" />
                <span>Custom section selection (Dashboard, Analysis, Journal, Calendar)</span>
              </div>
              <div className="flex items-center gap-2 font-medium">
                <Check className="h-4 w-4 text-emerald-500" />
                <span>Selectable date window (1, 3, 6, 12 months or full history)</span>
              </div>
              <div className="flex items-center gap-2 font-medium">
                <Check className="h-4 w-4 text-emerald-500" />
                <span>Instant link revocation at any time</span>
              </div>
              <div className="flex items-center gap-2 font-medium">
                <Check className="h-4 w-4 text-emerald-500" />
                <span>Zero broker credentials or private settings exposure</span>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={() => {
                  onClose();
                  onUpgrade();
                }}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-bold text-xs shadow-lg shadow-indigo-500/25 transition flex items-center justify-center gap-2 mx-auto"
              >
                <Sparkles className="h-4 w-4" />
                Upgrade to Pro — ₹499/mo
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Pro User Tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-800/80 px-6 pt-2 bg-slate-50/30 dark:bg-slate-900/20">
              <button
                onClick={() => setActiveTab('create')}
                className={`pb-3 text-xs font-bold border-b-2 transition flex items-center gap-2 mr-6 ${
                  activeTab === 'create'
                    ? 'border-violet-600 text-violet-600 dark:text-violet-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Share2 className="h-3.5 w-3.5" />
                Create Share Link
              </button>
              <button
                onClick={() => setActiveTab('manage')}
                className={`pb-3 text-xs font-bold border-b-2 transition flex items-center gap-2 ${
                  activeTab === 'manage'
                    ? 'border-violet-600 text-violet-600 dark:text-violet-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Clock className="h-3.5 w-3.5" />
                Active Links ({links.filter((l) => l.active).length})
              </button>
            </div>

            {/* Tab 1: Create Share Link */}
            {activeTab === 'create' && (
              <div className="p-6 overflow-y-auto space-y-6">
                {/* 1. Sections to Share */}
                <div>
                  <label className="block text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2">
                    1. Select Sections to Share
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    Choose one or more sections to include in the link. Only selected areas will be accessible.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {availableSections.map((sec) => {
                      const Icon = sec.icon;
                      const isSelected = selectedSections.includes(sec.id);
                      return (
                        <div
                          key={sec.id}
                          onClick={() => toggleSection(sec.id)}
                          className={`cursor-pointer p-3.5 rounded-xl border transition-all select-none flex items-start gap-3 ${
                            isSelected
                              ? 'border-violet-500 bg-violet-50/50 dark:bg-violet-950/20 shadow-sm'
                              : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900/40'
                          }`}
                        >
                          <div
                            className={`p-2 rounded-lg border shrink-0 ${sec.color}`}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-900 dark:text-white">
                                {sec.label}
                              </span>
                              <div
                                className={`w-4 h-4 rounded flex items-center justify-center transition ${
                                  isSelected
                                    ? 'bg-violet-600 text-white'
                                    : 'border border-slate-300 dark:border-slate-600'
                                }`}
                              >
                                {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                              </div>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                              {sec.desc}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Months of Data */}
                <div>
                  <label className="block text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-2">
                    2. Select Months of Data
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    Trades and metrics will be strictly confined to this timeframe. Older history is completely hidden.
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {monthOptions.map((opt) => {
                      const isSelected = selectedMonths === opt.value;
                      return (
                        <button
                          key={String(opt.value)}
                          type="button"
                          onClick={() => setSelectedMonths(opt.value as any)}
                          className={`p-2.5 rounded-lg border text-xs font-semibold text-center transition ${
                            isSelected
                              ? 'border-violet-500 bg-violet-500 text-white shadow-md shadow-violet-500/20'
                              : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Privacy Badge */}
                <div className="p-3.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/30 flex items-center gap-3 text-xs text-emerald-800 dark:text-emerald-300">
                  <Shield className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    <strong>Privacy Guarantee:</strong> Account logins, broker passwords, email address, and unselected tabs are never exposed through this link.
                  </span>
                </div>

                {errorMsg && (
                  <div className="p-3 rounded-lg bg-rose-50 text-rose-600 border border-rose-200 text-xs font-medium">
                    {errorMsg}
                  </div>
                )}

                {/* Generated Link Result */}
                {generatedLink && (
                  <div className="p-4 rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-violet-900 dark:text-violet-200 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                        Share Link Ready!
                      </span>
                      <span className="text-[10px] text-violet-600 dark:text-violet-400 font-medium">
                        {generatedLink.sections.join(', ')} ·{' '}
                        {generatedLink.months === 'all'
                          ? 'All Time'
                          : `${generatedLink.months} Months`}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={generatedLink.url}
                        className="bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-800 text-xs rounded-lg px-3 py-2 text-slate-700 dark:text-slate-200 flex-1 truncate font-mono select-all"
                      />
                      <button
                        onClick={() => handleCopy(generatedLink.url)}
                        className="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center gap-1.5 transition shrink-0 shadow-sm"
                      >
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                      <a
                        href={generatedLink.url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 rounded-lg border border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition shrink-0"
                        title="Open in new tab"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                )}

                {/* Generate Button */}
                <div className="pt-2">
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-500/20 disabled:opacity-50 transition flex items-center justify-center gap-2"
                  >
                    {generating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Share2 className="h-4 w-4" />
                    )}
                    {generating ? 'Generating Link...' : 'Generate Share Link'}
                  </button>
                </div>
              </div>
            )}

            {/* Tab 2: Manage Active Links */}
            {activeTab === 'manage' && (
              <div className="p-6 overflow-y-auto space-y-4">
                {loadingLinks ? (
                  <div className="py-12 text-center text-xs text-slate-400">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-violet-500" />
                    Loading your active links...
                  </div>
                ) : links.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 space-y-2">
                    <Share2 className="h-8 w-8 mx-auto opacity-40" />
                    <p className="text-xs">You haven't generated any share links yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {links.map((link) => {
                      const shareUrl = `${window.location.origin}/shared/${link.token}`;
                      return (
                        <div
                          key={link.token}
                          className={`p-4 rounded-xl border transition ${
                            link.active
                              ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50'
                              : 'border-slate-100 dark:border-slate-900 bg-slate-50/50 dark:bg-slate-950/40 opacity-60'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  link.active ? 'bg-emerald-500' : 'bg-slate-400'
                                }`}
                              />
                              <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 truncate max-w-xs">
                                /shared/{link.token}
                              </span>
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                  link.active
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                    : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                                }`}
                              >
                                {link.active ? 'Active' : 'Disabled'}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-slate-400">
                              <span className="flex items-center gap-1">
                                <Eye className="h-3 w-3" />
                                {link.views || 0} views
                              </span>
                              <span>
                                {new Date(link.createdAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 mb-3">
                            {link.sections.map((s) => (
                              <span
                                key={s}
                                className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-300 capitalize"
                              >
                                {s}
                              </span>
                            ))}
                            <span className="px-2 py-0.5 rounded bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 text-[10px] font-semibold">
                              {link.months === 'all'
                                ? 'All Time'
                                : `${link.months} Months`}
                            </span>
                          </div>

                          {link.active ? (
                            <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                              <button
                                onClick={() => handleCopy(shareUrl)}
                                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition"
                              >
                                <Copy className="h-3 w-3" />
                                Copy Link
                              </button>
                              <a
                                href={shareUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition"
                              >
                                <ExternalLink className="h-3 w-3" />
                                View
                              </a>
                              <button
                                onClick={() => handleRevoke(link.token)}
                                disabled={revokingToken === link.token}
                                className="ml-auto px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5 transition disabled:opacity-50"
                              >
                                <Trash2 className="h-3 w-3" />
                                {revokingToken === link.token
                                  ? 'Disabling...'
                                  : 'Disable Link'}
                              </button>
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-400 italic">
                              Link was revoked on{' '}
                              {link.revokedAt
                                ? new Date(link.revokedAt).toLocaleDateString()
                                : 'earlier date'}
                              .
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

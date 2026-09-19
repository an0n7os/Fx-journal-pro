import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Newspaper, CalendarRange, RefreshCw, ExternalLink, TrendingUp, TrendingDown,
  Minus, Clock, Globe, AlertTriangle, ChevronDown, Radio, MapPin, CalendarDays, Search
} from 'lucide-react';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY'];
const DEFAULT_CATEGORIES = [
  'Market Analysis', 'Central Banks', 'Interest Rates', 'Inflation', 'Employment',
  'GDP', 'Commodities', 'Geopolitics', 'Government',
];
const DATE_RANGES = ['Today', 'Tomorrow', 'This Week', 'Next Week', 'Custom'];

const IMPACT_CONFIG: Record<string, { label: string; chip: string; dot: string; ring: string }> = {
  high: { label: 'High', chip: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800/60', dot: 'bg-red-500', ring: 'ring-red-200 dark:ring-red-900' },
  medium: { label: 'Medium', chip: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60', dot: 'bg-amber-500', ring: 'ring-amber-200 dark:ring-amber-900' },
  low: { label: 'Low', chip: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-400 dark:border-yellow-800/60', dot: 'bg-yellow-400', ring: 'ring-yellow-200 dark:ring-yellow-900' },
  none: { label: '—', chip: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700/60', dot: 'bg-slate-400', ring: 'ring-slate-200 dark:ring-slate-800' },
};

interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  category: string;
  currencies: string[];
  pairs: string[];
  sentiment: { score: number | null; label: string };
}

interface EconEvent {
  id: string;
  date: string;
  currency: string;
  country: string;
  event: string;
  impact: 'high' | 'medium' | 'low' | 'none';
  actual: string | null;
  forecast: string | null;
  previous: string | null;
}

const DEFAULT_FALLBACK_NEWS: NewsArticle[] = [
  {
    id: 'n-1',
    title: 'US Non-Farm Payrolls Exceed Expectations at 275K; Dollar Tests Key Resistance',
    summary: 'Labor market strength reinforces Fed policy patience as wage growth holds steady across core sectors.',
    url: 'https://bloomberg.com',
    source: 'Bloomberg',
    publishedAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    category: 'Employment',
    currencies: ['USD', 'EUR'],
    pairs: ['EUR/USD'],
    sentiment: { score: 0.65, label: 'Bullish USD' }
  },
  {
    id: 'n-2',
    title: 'ECB Holds Benchmark Rates at 3.75%; Lagarde Stresses Data-Dependent Stance',
    summary: 'Euro tests 1.0850 support following European Central Bank policy press briefing and revised inflation trajectory.',
    url: 'https://reuters.com',
    source: 'Reuters',
    publishedAt: new Date(Date.now() - 1000 * 60 * 24).toISOString(),
    category: 'Central Banks',
    currencies: ['EUR', 'USD'],
    pairs: ['EUR/USD'],
    sentiment: { score: -0.42, label: 'Bearish EUR' }
  },
  {
    id: 'n-3',
    title: 'Spot Gold Extends Historic Rally Above $2,950 as Institutional Inflows Accelerate',
    summary: 'Safe-haven accumulation and central bank gold reserve expansion drive spot prices to fresh multi-month records.',
    url: 'https://ft.com',
    source: 'Financial Times',
    publishedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    category: 'Commodities',
    currencies: ['XAU', 'USD'],
    pairs: ['XAU/USD'],
    sentiment: { score: 0.78, label: 'Bullish Gold' }
  },
  {
    id: 'n-4',
    title: 'Bank of Japan Signals Additional Rate Normalization; Yen Gains Across Major Crosses',
    summary: 'Broadening wage growth trajectory fuels speculation of policy tightening, lifting the yen across Asian trading desks.',
    url: 'https://fxstreet.com',
    source: 'FXStreet',
    publishedAt: new Date(Date.now() - 1000 * 60 * 72).toISOString(),
    category: 'Central Banks',
    currencies: ['JPY', 'USD'],
    pairs: ['USD/JPY'],
    sentiment: { score: 0.68, label: 'Bullish JPY' }
  },
  {
    id: 'n-5',
    title: 'UK Core CPI Prints at 3.5%; Sterling Holds Above 1.2900 Against US Dollar',
    summary: 'Services inflation remains sticky, prompting Bank of England policymakers to signal cautious easing pace.',
    url: 'https://dailyfx.com',
    source: 'DailyFX',
    publishedAt: new Date(Date.now() - 1000 * 60 * 115).toISOString(),
    category: 'Inflation',
    currencies: ['GBP', 'USD'],
    pairs: ['GBP/USD'],
    sentiment: { score: 0.35, label: 'Bullish GBP' }
  }
];

const DEFAULT_FALLBACK_EVENTS: EconEvent[] = [
  {
    id: 'e-1',
    date: new Date(Date.now() + 1000 * 60 * 35).toISOString(),
    currency: 'USD',
    country: 'US',
    event: 'Core CPI Inflation Rate (MoM)',
    impact: 'high',
    actual: null,
    forecast: '0.3%',
    previous: '0.4%'
  },
  {
    id: 'e-2',
    date: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
    currency: 'EUR',
    country: 'EU',
    event: 'ECB Deposit Facility Rate Decision',
    impact: 'high',
    actual: '3.75%',
    forecast: '3.75%',
    previous: '4.00%'
  },
  {
    id: 'e-3',
    date: new Date(Date.now() + 1000 * 60 * 160).toISOString(),
    currency: 'USD',
    country: 'US',
    event: 'FOMC Meeting Minutes Release',
    impact: 'high',
    actual: null,
    forecast: '—',
    previous: '—'
  },
  {
    id: 'e-4',
    date: new Date(Date.now() - 1000 * 60 * 110).toISOString(),
    currency: 'GBP',
    country: 'UK',
    event: 'GDP Growth Rate (QoQ) Preliminary',
    impact: 'medium',
    actual: '0.6%',
    forecast: '0.4%',
    previous: '0.2%'
  },
  {
    id: 'e-5',
    date: new Date(Date.now() + 1000 * 60 * 290).toISOString(),
    currency: 'AUD',
    country: 'AU',
    event: 'Employment Change & Jobless Rate',
    impact: 'high',
    actual: null,
    forecast: '24.5K',
    previous: '18.2K'
  }
];

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalKey = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const addDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};
const startOfWeekMonday = (d: Date) => {
  const day = d.getDay();
  return addDays(d, day === 0 ? -6 : 1 - day);
};
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function timeAgo(iso: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function dayGroupLabel(key: string, tKeys: { today: string; tomorrow: string }): string {
  if (key === tKeys.today) return 'Today';
  if (key === tKeys.tomorrow) return 'Tomorrow';
  const d = new Date(`${key}T00:00:00`);
  if (isNaN(d.getTime())) return key;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function sentimentStyle(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('bullish')) return 'dx-sentiment-bull';
  if (l.includes('bearish')) return 'dx-sentiment-bear';
  return 'dx-sentiment-neutral';
}

function sentimentIcon(label: string) {
  const l = label.toLowerCase();
  if (l.includes('bullish')) return <TrendingUp className="h-3 w-3" />;
  if (l.includes('bearish')) return <TrendingDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
}

function impactConfig(impact: EconEvent['impact']) {
  return IMPACT_CONFIG[impact] || IMPACT_CONFIG.none;
}

function numColor(v: string | null): string {
  if (v === null) return '';
  const n = parseFloat(v.replace(/[^\d.-]/g, ''));
  if (isNaN(n) || n === 0) return 'text-slate-700 dark:text-slate-300';
  return n > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
}

function CellValue({ value }: { value: string | null }) {
  if (value === null || value === '' || value === undefined) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  return <span className={`font-mono font-semibold ${numColor(value)}`}>{value}</span>;
}

export default function FXNews({ initialTab = 'news' }: { initialTab?: 'news' | 'calendar' }) {
  const [tab, setTab] = useState<'news' | 'calendar'>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const [news, setNews] = useState<NewsArticle[]>([]);
  const [newsCategories, setNewsCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState('');
  // The fallback arrays below are hardcoded headlines. Showing them
  // unlabelled let a trader read a stale payrolls number as today's.
  const [newsIsSample, setNewsIsSample] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [events, setEvents] = useState<EconEvent[]>([]);
  const [calLoading, setCalLoading] = useState(true);
  const [calError, setCalError] = useState('');
  const [calIsSample, setCalIsSample] = useState(false);
  const [calProvider, setCalProvider] = useState('');

  const [newsCurrency, setNewsCurrency] = useState('All');
  const [newsCategory, setNewsCategory] = useState('All');
  const [impact, setImpact] = useState('All');
  const [calCurrency, setCalCurrency] = useState('All');
  const [dateRange, setDateRange] = useState('Today');
  const [customDate, setCustomDate] = useState(() => todayKey());

  const [now, setNow] = useState(Date.now());

  const fetchNews = useCallback(async () => {
    setNewsLoading(true);
    setNewsError('');
    setNewsIsSample(false);
    try {
      const res = await fetch('/api/fx-news?limit=30');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.articles) && data.articles.length > 0) {
          setNews(data.articles);
        } else {
          setNews(DEFAULT_FALLBACK_NEWS);
        setNewsIsSample(true);
          setNewsIsSample(true);
        }
        if (Array.isArray(data.categories) && data.categories.length > 0) setNewsCategories(data.categories);
      } else {
        setNews(DEFAULT_FALLBACK_NEWS);
        setNewsIsSample(true);
      }
    } catch {
      setNews(DEFAULT_FALLBACK_NEWS);
    } finally {
      setNewsLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchCalendar = useCallback(async () => {
    setCalLoading(true);
    setCalError('');
    setCalIsSample(false);
    const from = todayKey();
    const toKey = new Date();
    toKey.setDate(toKey.getDate() + 21);
    const to = `${toKey.getFullYear()}-${pad(toKey.getMonth() + 1)}-${pad(toKey.getDate())}`;
    try {
      const res = await fetch(`/api/economic-calendar?from=${from}&to=${to}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.events) && data.events.length > 0) {
          setEvents(data.events);
        } else {
          setEvents(DEFAULT_FALLBACK_EVENTS);
        setCalIsSample(true);
          setCalIsSample(true);
        }
        setCalProvider(data.provider || 'FX Journal Pro Economic Desk');
      } else {
        setEvents(DEFAULT_FALLBACK_EVENTS);
        setCalIsSample(true);
        setCalProvider('FX Journal Pro Economic Desk');
      }
    } catch {
      setEvents(DEFAULT_FALLBACK_EVENTS);
      setCalProvider('FX Journal Pro Economic Desk');
    } finally {
      setCalLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();
    fetchCalendar();
  }, [fetchNews, fetchCalendar]);

  // Live countdown tick (updates automatically every second)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // SEO metadata while this page is open
  useEffect(() => {
    const prevTitle = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute('content') || '';
    document.title = 'FX News & Economic Calendar | FX Journal Pro';
    if (meta) {
      meta.setAttribute('content', 'Stay updated with the latest forex news and economic calendar events, including high-impact market events, forecasts, previous values and actual results.');
    }
    return () => {
      document.title = prevTitle;
      if (meta) meta.setAttribute('content', prevDesc);
    };
  }, []);

  const filteredNews = useMemo(() => news.filter(a =>
    (newsCurrency === 'All' || a.currencies.includes(newsCurrency)) &&
    (newsCategory === 'All' || a.category === newsCategory)
  ), [news, newsCurrency, newsCategory]);

  const tKeys = useMemo(() => {
    const nowD = new Date();
    const thisWeekStart = startOfWeekMonday(nowD);
    return {
      today: todayKey(),
      tomorrow: toLocalKey(addDays(nowD, 1).toISOString()),
      weekStart: toLocalKey(thisWeekStart.toISOString()),
      weekEnd: toLocalKey(addDays(thisWeekStart, 6).toISOString()),
      nextWeekStart: toLocalKey(addDays(thisWeekStart, 7).toISOString()),
      nextWeekEnd: toLocalKey(addDays(thisWeekStart, 13).toISOString()),
    };
  }, []);

  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (impact !== 'All' && e.impact !== impact) return false;
      if (calCurrency !== 'All' && e.currency !== calCurrency) return false;
      const k = toLocalKey(e.date);
      if (!k) return false;
      switch (dateRange) {
        case 'Today': return k === tKeys.today;
        case 'Tomorrow': return k === tKeys.tomorrow;
        case 'This Week': return k >= tKeys.weekStart && k <= tKeys.weekEnd;
        case 'Next Week': return k >= tKeys.nextWeekStart && k <= tKeys.nextWeekEnd;
        case 'Custom': return k === customDate;
        default: return true;
      }
    }).sort((a, b) => a.date.localeCompare(b.date));
  }, [events, impact, calCurrency, dateRange, customDate, tKeys]);

  const eventGroups = useMemo(() => {
    const map: Record<string, EconEvent[]> = {};
    for (const e of filteredEvents) {
      const k = toLocalKey(e.date);
      if (!k) continue;
      (map[k] || (map[k] = [])).push(e);
    }
    return Object.keys(map).sort().map(k => ({ key: k, items: map[k] }));
  }, [filteredEvents]);

  const upcomingHigh = useMemo(() => events
    .filter(e => e.impact === 'high' && new Date(e.date).getTime() > now)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()), [events, now]);
  const nextHigh = upcomingHigh[0] || null;
  const nextHighCountdown = nextHigh ? formatCountdown(new Date(nextHigh.date).getTime() - now) : '';

  const tzName = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'; } catch { return 'local'; }
  })();

  const handleRefreshNews = () => {
    setRefreshing(true);
    fetchNews();
  };

  const handleRetryNews = () => {
    setNewsLoading(true);
    fetchNews();
  };

  const handleRetryCalendar = () => {
    setCalLoading(true);
    fetchCalendar();
  };

  const selectCls = 'bg-white dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.1] rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500/30';

  return (
    <div className="space-y-6" data-testid="fx-news-page">
      {nextHigh && (
        <div className="flex justify-end">
          <div className="inline-flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-300 text-xs font-bold px-3 py-2 rounded-xl">
            <Radio className="h-3.5 w-3.5 text-rose-500 dark:text-rose-400" />
            Next: {nextHigh.currency} {nextHigh.event} · Starts in {nextHighCountdown}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-white/[0.08]">
        <button
          onClick={() => setTab('news')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition ${
            tab === 'news'
              ? 'border-violet-500 text-violet-600 dark:text-violet-400 font-bold'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Newspaper className="h-4 w-4" /> Latest FX News
        </button>
        <button
          onClick={() => setTab('calendar')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition ${
            tab === 'calendar'
              ? 'border-violet-500 text-violet-600 dark:text-violet-400 font-bold'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <CalendarRange className="h-4 w-4" /> Economic Calendar
        </button>
      </div>

      {/* ================= NEWS TAB ================= */}
      {tab === 'news' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-slate-400" />
              <span className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Latest News</span>
            </div>
            <select value={newsCurrency} onChange={e => setNewsCurrency(e.target.value)} className={selectCls}>
              <option value="All">All Currencies</option>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={newsCategory} onChange={e => setNewsCategory(e.target.value)} className={selectCls}>
              <option value="All">All Categories</option>
              {newsCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button
              onClick={handleRefreshNews}
              disabled={refreshing || newsLoading}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-300 border border-violet-500/30 hover:bg-violet-500/10 rounded-xl px-3 py-2 transition disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

{newsIsSample && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
              <span>
                <span className="font-bold">Sample data.</span> Live news is unavailable right now, so these are example headlines, not current market news. Do not trade on it.
              </span>
            </div>
          )}
                    {newsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] rounded-xl p-5 space-y-3 animate-pulse">
                  <div className="flex items-center justify-between">
                    <div className="h-3 w-20 bg-slate-100 dark:bg-white/10 rounded-full" />
                    <div className="h-3 w-14 bg-slate-100 dark:bg-white/10 rounded-full" />
                  </div>
                  <div className="h-4 w-3/4 bg-slate-100 dark:bg-white/10 rounded-full" />
                  <div className="h-3 w-full bg-slate-100 dark:bg-white/10 rounded-full" />
                  <div className="h-3 w-5/6 bg-slate-100 dark:bg-white/10 rounded-full" />
                  <div className="flex gap-2 pt-2">
                    <div className="h-5 w-16 bg-slate-100 dark:bg-white/10 rounded-full" />
                    <div className="h-5 w-16 bg-slate-100 dark:bg-white/10 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : newsError ? (
            <div className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] rounded-xl p-8 text-center">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{newsError}</p>
              <button
                onClick={handleRetryNews}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-white bg-violet-600 hover:bg-violet-500 rounded-lg px-4 py-2 transition shadow-sm"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          ) : filteredNews.length === 0 ? (
            <div className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] rounded-xl p-10 text-center">
              <Globe className="h-8 w-8 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">No news articles match your filters.</p>
              <p className="text-xs text-slate-400 mt-1">Try a different currency or category, or refresh.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredNews.map(a => (
                <article key={a.id} className="dx-panel hover:border-violet-500/40 p-5 shadow-sm flex flex-col transition-colors duration-200">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
                      {a.category}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 flex items-center gap-1 shrink-0">
                      <Clock className="h-3 w-3" />
                      {timeAgo(a.publishedAt)}
                    </span>
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm leading-snug line-clamp-2">
                    {a.title}
                  </h3>
                  {a.summary && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-2 line-clamp-3">
                      {a.summary}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {a.currencies.slice(0, 4).map(c => (
                      <span key={c} className="text-[10px] font-mono font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/[0.06] border border-transparent dark:border-white/[0.08] px-1.5 py-0.5 rounded">
                        {c}
                      </span>
                    ))}
                    {a.pairs.slice(0, 2).map(p => (
                      <span key={p} className="text-[10px] font-mono font-bold text-violet-700 dark:text-violet-300 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded">
                        {p}
                      </span>
                    ))}
                    {a.currencies.length === 0 && a.pairs.length === 0 && (
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 px-1.5 py-0.5 rounded">
                        Forex
                      </span>
                    )}
                  </div>
                  <div className="mt-auto pt-4 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-white/[0.05]">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold border px-1.5 py-0.5 rounded-full ${sentimentStyle(a.sentiment.label)}`}>
                      {sentimentIcon(a.sentiment.label)}
                      {a.sentiment.label}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate max-w-[80px]">{a.source}</span>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-400 hover:text-violet-300 py-2 -my-2 shrink-0"
                      >
                        Read More <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= CALENDAR TAB ================= */}
      {tab === 'calendar' && (
        <div className="space-y-5">
          {/* Upcoming High Impact Events */}
          <section className="dx-panel text-slate-900 dark:text-white p-6 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 w-72 h-72 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-red-600 dark:text-red-300 bg-red-100 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 px-2 py-1 rounded-full">
                  <Radio className="h-3 w-3 animate-pulse" /> Upcoming High Impact Events
                </span>
                {calProvider && (
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-auto hidden sm:inline">Source: {calProvider}</span>
                )}
              </div>

              {upcomingHigh.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {calLoading
                    ? 'Loading upcoming events…'
                    : calError
                      ? 'High impact data unavailable right now.'
                      : 'No upcoming high impact events in the next 3 weeks.'}
                </p>
              ) : (
                <>
                  {nextHigh && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5 mb-4 shadow-sm dark:shadow-none">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-extrabold bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-500/40 px-1.5 py-0.5 rounded">
                            🔴 HIGH IMPACT
                          </span>
                          <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-transparent px-1.5 py-0.5 rounded">{nextHigh.currency}</span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">{nextHigh.country}</span>
                        </div>
                        <h3 className="font-black text-lg mt-2 text-slate-900 dark:text-white">{nextHigh.event}</h3>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {fmtTime(nextHigh.date)} · {fmtDate(nextHigh.date)} · your timezone ({tzName})
                        </p>
                      </div>
                      <div className="shrink-0">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Starts in</div>
                        <div className="font-mono font-black text-2xl tabular-nums text-slate-900 dark:text-white">{nextHighCountdown}</div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                    {upcomingHigh.slice(0, 6).map(ev => (
                      <div key={ev.id} className="shrink-0 min-w-[190px] bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 shadow-sm dark:shadow-none rounded-xl p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">{fmtTime(ev.date)}</span>
                          <span className="text-[10px] font-extrabold text-red-600 dark:text-red-300 bg-red-100 dark:bg-red-500/15 px-1.5 py-0.5 rounded-full">High</span>
                        </div>
                        <p className="text-xs font-bold text-slate-900 dark:text-white mt-1.5 line-clamp-2">{ev.currency} {ev.event}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">{fmtDate(ev.date)}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Filters */}
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-4 shadow-xs">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1.5">Impact</span>
                <div className="flex items-center gap-1 flex-wrap">
                  {['All', 'High', 'Medium', 'Low'].map(i => (
                    <button
                      key={i}
                      onClick={() => setImpact(i === 'All' ? 'All' : i.toLowerCase())}
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition ${
                        (i === 'All' ? impact === 'All' : impact === i.toLowerCase())
                          ? i === 'High' ? 'bg-red-500 text-white border-red-500'
                            : i === 'Medium' ? 'bg-amber-500 text-white border-amber-500'
                              : i === 'Low' ? 'bg-yellow-400 text-white border-yellow-400'
                                : 'bg-slate-900 text-white border-slate-900 dark:bg-blue-600 dark:border-blue-600'
                          : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1.5">Currency</span>
                <select value={calCurrency} onChange={e => setCalCurrency(e.target.value)} className={selectCls}>
                  <option value="All">All Currencies</option>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1.5">Date</span>
                <div className="flex items-center gap-2">
                  <select value={dateRange} onChange={e => setDateRange(e.target.value)} className={selectCls}>
                    {DATE_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {dateRange === 'Custom' && (
                    <input
                      type="date"
                      value={customDate}
                      onChange={e => setCustomDate(e.target.value || todayKey())}
                      className={selectCls}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
            <MapPin className="h-3 w-3" /> All times shown in your local timezone: <span className="font-bold text-slate-500 dark:text-slate-400">{tzName}</span>
          </p>

{calIsSample && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
              <span>
                <span className="font-bold">Sample data.</span> The live economic calendar is unavailable right now, so these are example events with example times. Do not trade on it.
              </span>
            </div>
          )}
                    {calLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 space-y-3 animate-pulse">
                  <div className="h-4 w-40 bg-slate-100 dark:bg-slate-800 rounded-full" />
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="flex items-center gap-4">
                      <div className="h-3 w-16 bg-slate-100 dark:bg-slate-800 rounded-full" />
                      <div className="h-3 w-12 bg-slate-100 dark:bg-slate-800 rounded-full" />
                      <div className="h-3 w-24 bg-slate-100 dark:bg-slate-800 rounded-full" />
                      <div className="h-3 w-40 bg-slate-100 dark:bg-slate-800 rounded-full" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : calError ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-10 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{calError}</p>
              <p className="text-xs text-slate-400 mt-1 mb-4">The calendar and news load independently.</p>
              <button
                onClick={handleRetryCalendar}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-4 py-2 transition"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          ) : eventGroups.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-10 text-center">
              <CalendarDays className="h-8 w-8 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">No economic events found for the selected filters.</p>
              <p className="text-xs text-slate-400 mt-1">Try widening the date range or clearing the impact/currency filters.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {eventGroups.map(group => (
                <section key={group.key} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
                  <header className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-5 py-3">
                    <span className="text-xs font-extrabold text-slate-800 dark:text-slate-200">{dayGroupLabel(group.key, tKeys)}</span>
                    <span className="text-[10px] text-slate-400">{new Date(`${group.key}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                    <span className="ml-auto text-[10px] font-bold text-slate-400 dark:text-slate-500">{group.items.length} {group.items.length === 1 ? 'event' : 'events'}</span>
                  </header>

                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800">
                          <th className="py-3 pl-5 pr-3 font-bold">Time</th>
                          <th className="py-3 px-3 font-bold">Currency</th>
                          <th className="py-3 px-3 font-bold">Impact</th>
                          <th className="py-3 px-3 font-bold">Event</th>
                          <th className="py-3 px-3 font-bold text-right">Actual</th>
                          <th className="py-3 px-3 font-bold text-right">Forecast</th>
                          <th className="py-3 pr-5 pl-3 font-bold text-right">Previous</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map(ev => {
                          const imp = impactConfig(ev.impact);
                          return (
                            <tr key={ev.id} className="border-b border-slate-50 dark:border-slate-800/50 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition">
                              <td className="py-3 pl-5 pr-3 whitespace-nowrap font-semibold text-slate-700 dark:text-slate-300 tabular-nums">{fmtTime(ev.date)}</td>
                              <td className="py-3 px-3 whitespace-nowrap">
                                <span className="font-bold text-blue-700 dark:text-blue-400">{ev.currency}</span>
                                <span className="text-slate-400 ml-1">({ev.country})</span>
                              </td>
                              <td className="py-3 px-3 whitespace-nowrap">
                                <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold border px-2 py-0.5 rounded-full ${imp.chip}`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${imp.dot}`} />
                                  {imp.label}
                                </span>
                              </td>
                              <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">{ev.event}</td>
                              <td className="py-3 px-3 text-right whitespace-nowrap"><CellValue value={ev.actual} /></td>
                              <td className="py-3 px-3 text-right whitespace-nowrap"><CellValue value={ev.forecast} /></td>
                              <td className="py-3 pr-5 pl-3 text-right whitespace-nowrap"><CellValue value={ev.previous} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
                    {group.items.map(ev => {
                      const imp = impactConfig(ev.impact);
                      return (
                        <div key={ev.id} className="p-4 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 tabular-nums flex items-center gap-1.5">
                              <Clock className="h-3 w-3 text-slate-400" /> {fmtTime(ev.date)}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-blue-700 dark:text-blue-400 text-[11px]">{ev.currency}</span>
                              <span className={`inline-flex items-center gap-1 text-[9px] font-bold border px-1.5 py-0.5 rounded-full ${imp.chip}`}>
                                <span className={`h-1 w-1 rounded-full ${imp.dot}`} />
                                {imp.label}
                              </span>
                            </div>
                          </div>
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 leading-snug">{ev.event}</p>
                          <div className="grid grid-cols-3 gap-2 pt-1">
                            {[['Actual', ev.actual], ['Forecast', ev.forecast], ['Previous', ev.previous]].map(([label, value]) => (
                              <div key={label as string} className="bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-lg px-2 py-1.5 text-center">
                                <span className="text-[9px] uppercase tracking-wide text-slate-400 block">{label as string}</span>
                                <CellValue value={value as string | null} />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

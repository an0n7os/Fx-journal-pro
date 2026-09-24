import React, { useEffect, useState, useMemo } from 'react';
import {
  Newspaper, CalendarRange, Clock, TrendingUp, TrendingDown,
  Radio, ShieldCheck, Zap
} from 'lucide-react';

interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  category: string;
  currencies: string[];
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

const FALLBACK_NEWS: NewsArticle[] = [
  {
    id: 'n-1',
    title: 'US Non-Farm Payrolls Surge to 275K; Dollar Tests Key Resistance Ahead of FOMC',
    summary: 'Labor market resilience reinforces Federal Reserve rate patience as wage growth holds steady across core sectors.',
    url: '#',
    source: 'Bloomberg',
    publishedAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    category: 'Forex Majors',
    currencies: ['USD', 'EUR'],
    sentiment: { score: 0.65, label: 'Bullish USD' }
  },
  {
    id: 'n-2',
    title: 'ECB Benchmark Rates Held at 3.75%; Lagarde Stresses Data-Dependent Stance',
    summary: 'Euro tests 1.0850 support following European Central Bank policy press briefing and revised inflation outlook.',
    url: '#',
    source: 'Reuters',
    publishedAt: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
    category: 'Central Banks',
    currencies: ['EUR', 'USD'],
    sentiment: { score: -0.42, label: 'Bearish EUR' }
  },
  {
    id: 'n-3',
    title: 'Spot Gold Extends Historic Rally Above $2,950 as Institutional Inflows Accelerate',
    summary: 'Safe-haven accumulation and central bank gold reserve expansion drive spot prices to fresh all-time highs.',
    url: '#',
    source: 'Financial Times',
    publishedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    category: 'Commodities',
    currencies: ['XAU', 'USD'],
    sentiment: { score: 0.78, label: 'Bullish Gold' }
  },
  {
    id: 'n-4',
    title: 'Bank of Japan Signals Further Rate Normalization; Yen Gains Across Major Crosses',
    summary: 'Broadening wage growth trajectory fuels speculation of additional policy tightening, lifting the yen across Asian desks.',
    url: '#',
    source: 'FXStreet',
    publishedAt: new Date(Date.now() - 1000 * 60 * 75).toISOString(),
    category: 'Monetary Policy',
    currencies: ['JPY', 'USD'],
    sentiment: { score: 0.68, label: 'Bullish JPY' }
  },
  {
    id: 'n-5',
    title: 'UK Core CPI Prints at 3.5%; Sterling Holds Above 1.2900 Against US Dollar',
    summary: 'Services inflation remains sticky, prompting Bank of England policymakers to signal cautious easing pace.',
    url: '#',
    source: 'DailyFX',
    publishedAt: new Date(Date.now() - 1000 * 60 * 115).toISOString(),
    category: 'Inflation',
    currencies: ['GBP', 'USD'],
    sentiment: { score: 0.35, label: 'Bullish GBP' }
  }
];

const FALLBACK_EVENTS: EconEvent[] = [
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

const CURRENCY_FILTERS = ['ALL', 'USD', 'EUR', 'GBP', 'JPY', 'XAU'];

function timeAgo(iso: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / (1000 * 60));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function FXNewsPreview() {
  const [tab, setTab] = useState<'news' | 'calendar'>('news');
  const [selectedCurrency, setSelectedCurrency] = useState('ALL');
  const [news, setNews] = useState<NewsArticle[]>(FALLBACK_NEWS);
  const [events, setEvents] = useState<EconEvent[]>(FALLBACK_EVENTS);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/fx-news?limit=10')
      .then(async (r) => {
        if (!r.ok) throw new Error('API unconfigured');
        return r.json().catch(() => ({}));
      })
      .then((d) => {
        if (!cancelled && d?.articles && Array.isArray(d.articles) && d.articles.length > 0) {
          setNews(d.articles);
        }
      })
      .catch(() => {
        // Seamless fallback to rich curated market news
      });

    fetch('/api/economic-calendar?limit=10')
      .then(async (r) => {
        if (!r.ok) throw new Error('API unconfigured');
        return r.json().catch(() => ({}));
      })
      .then((d) => {
        if (!cancelled && d?.events && Array.isArray(d.events) && d.events.length > 0) {
          setEvents(d.events);
        }
      })
      .catch(() => {
        // Seamless fallback to rich curated economic calendar
      });

    return () => { cancelled = true; };
  }, []);

  const filteredNews = useMemo(() => {
    if (selectedCurrency === 'ALL') return news.slice(0, 2);
    const filtered = news.filter((n) =>
      n.currencies?.some((c) => c.toUpperCase() === selectedCurrency.toUpperCase())
    );
    return (filtered.length > 0 ? filtered : news).slice(0, 2);
  }, [news, selectedCurrency]);

  const filteredEvents = useMemo(() => {
    if (selectedCurrency === 'ALL') return events.slice(0, 3);
    const filtered = events.filter((e) =>
      e.currency?.toUpperCase() === selectedCurrency.toUpperCase()
    );
    return (filtered.length > 0 ? filtered : events).slice(0, 3);
  }, [events, selectedCurrency]);

  return (
    <div className="relative">
      {/* Background violet/indigo glow exactly matching HeroPanel */}
      <div
        className="absolute -inset-5 sm:-inset-8 rounded-[36px] bg-gradient-to-tr from-violet-600/25 via-indigo-500/10 to-transparent blur-3xl pointer-events-none"
        aria-hidden="true"
      />

      {/* Main card container using .lp-card and glass aesthetics */}
      <div className="lp-card relative overflow-hidden shadow-2xl shadow-black/60">
        {/* Terminal window chrome matching MT5 Sync & HeroPanel */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            <div className="ml-3 hidden sm:flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 font-mono text-[11px] text-slate-400">
              <span className="text-violet-300 font-semibold">https://</span>fxjournalpro.com/app/fx-news
            </div>
          </div>

          {/* Live indicator exactly matching HeroPanel */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-300">Live</span>
          </span>
        </div>

        {/* Content Area */}
        <div className="p-5 sm:p-6">
          {/* Header Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-3 min-w-0">
              <span className="lp-chip h-9 w-9 shrink-0">
                <Newspaper className="h-[17px] w-[17px] text-violet-300" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-[15px] font-bold text-white leading-tight truncate">
                    FX NEWS &amp; CALENDAR
                  </h3>
                  <span className="inline-flex items-center text-[9px] font-mono font-bold uppercase tracking-wider text-violet-300 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded">
                    PRO
                  </span>
                </div>
                <p className="lp-eyebrow mt-0.5">Market Intelligence &middot; Live Terminal</p>
              </div>
            </div>

            {/* Pill view switcher matching .lp-navgroup */}
            <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white/[0.04] border border-white/[0.08] self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setTab('news')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${tab === 'news'
                  ? 'bg-white/[0.12] text-white shadow-sm border border-white/[0.15]'
                  : 'text-slate-400 hover:text-white'
                  }`}
              >
                <Newspaper className="h-3 w-3 text-violet-300" />
                Latest News
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </button>
              <button
                type="button"
                onClick={() => setTab('calendar')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${tab === 'calendar'
                  ? 'bg-white/[0.12] text-white shadow-sm border border-white/[0.15]'
                  : 'text-slate-400 hover:text-white'
                  }`}
              >
                <CalendarRange className="h-3 w-3 text-violet-300" />
                Economic Calendar
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
              </button>
            </div>
          </div>

          {/* Interactive Currency Filter Bar */}
          <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1 no-scrollbar">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mr-1 shrink-0">Pairs:</span>
            {CURRENCY_FILTERS.map((curr) => {
              const active = selectedCurrency === curr;
              return (
                <button
                  key={curr}
                  type="button"
                  onClick={() => setSelectedCurrency(curr)}
                  className={`fx-news-currency-chip text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full transition-all shrink-0 ${active
                    ? 'bg-violet-600/30 text-violet-200 border border-violet-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-white bg-white/[0.03] border border-white/[0.06]'
                    }`}
                >
                  {curr}
                </button>
              );
            })}
          </div>

          {/* High-Impact Volatility Alert Banner */}
          <div className="mb-4 bg-gradient-to-r from-rose-500/15 via-violet-500/10 to-transparent border border-rose-500/25 rounded-xl px-3.5 py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-200 min-w-0 truncate">
              <Radio className="h-3.5 w-3.5 text-rose-400 animate-pulse shrink-0" />
              <span className="truncate">Upcoming High-Impact: <strong className="text-white font-semibold">US Core CPI (MoM)</strong></span>
            </div>
            <span className="font-mono text-[10px] font-bold text-rose-300 bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 rounded-full shrink-0">
              in 35m &middot; HIGH
            </span>
          </div>

          {/* TAB 1: NEWS */}
          {tab === 'news' && (
            <div className="grid sm:grid-cols-2 gap-3 animate-in fade-in duration-200">
              {filteredNews.map((a) => {
                const isBullish = /bullish/i.test(a.sentiment?.label || '');
                const isBearish = /bearish/i.test(a.sentiment?.label || '');

                return (
                  <div
                    key={a.id}
                    className="group/card rounded-xl border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06] hover:border-violet-500/40 p-3.5 flex flex-col justify-between transition-all duration-200 shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="lp-eyebrow text-[9px] text-violet-300/90 truncate">
                          {a.category || 'Forex'}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full shrink-0 ${isBullish
                            ? 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/20'
                            : isBearish
                              ? 'text-rose-300 bg-rose-500/10 border border-rose-500/20'
                              : 'text-slate-300 bg-white/[0.06] border border-white/[0.1]'
                            }`}
                        >
                          {isBullish && <TrendingUp className="h-2.5 w-2.5 text-emerald-400" />}
                          {isBearish && <TrendingDown className="h-2.5 w-2.5 text-rose-400" />}
                          {a.sentiment?.label || 'Neutral'}
                        </span>
                      </div>

                      <h4 className="text-xs sm:text-[13px] font-semibold text-white leading-snug group-hover/card:text-violet-200 transition-colors line-clamp-2">
                        {a.title}
                      </h4>

                      <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed line-clamp-2">
                        {a.summary}
                      </p>
                    </div>

                    <div className="mt-3 pt-2.5 flex items-center justify-between gap-2 border-t border-white/[0.05]">
                      <span className="flex items-center gap-1 text-[10px] font-mono text-slate-400 truncate">
                        <Clock className="h-2.5 w-2.5 text-slate-500 shrink-0" />
                        <span className="text-slate-300 font-semibold">{a.source}</span> &middot; {timeAgo(a.publishedAt)}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {a.currencies?.slice(0, 2).map((c) => (
                          <span
                            key={c}
                            className="text-[9px] font-mono font-bold text-violet-300 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 2: CALENDAR */}
          {tab === 'calendar' && (
            <div className="space-y-2 animate-in fade-in duration-200">
              {filteredEvents.map((e) => {
                const isHigh = e.impact === 'high';
                return (
                  <div
                    key={e.id}
                    className="rounded-xl border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.05] hover:border-violet-500/30 px-3.5 py-2.5 flex items-center gap-3 sm:gap-4 transition-colors"
                  >
                    <div className="w-12 shrink-0 text-center">
                      <p className="lp-num font-mono text-xs font-bold text-slate-200">{fmtTime(e.date)}</p>
                      <span className="font-mono text-[9px] text-slate-500 uppercase">UTC</span>
                    </div>

                    <div className="shrink-0">
                      <span className="font-mono text-xs font-extrabold text-white bg-white/[0.08] border border-white/[0.1] px-2 py-0.5 rounded">
                        {e.currency}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white truncate">
                        {e.event}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 font-mono">
                        {e.actual && (
                          <span>Actual: <strong className="text-emerald-400">{e.actual}</strong></span>
                        )}
                        <span>Forecast: <strong className="text-slate-300">{e.forecast ?? '—'}</strong></span>
                        <span>Prior: <strong className="text-slate-500">{e.previous ?? '—'}</strong></span>
                      </div>
                    </div>

                    <span
                      className={`font-mono text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${isHigh
                        ? 'text-rose-300 bg-rose-500/15 border border-rose-500/30'
                        : 'text-amber-300 bg-amber-500/15 border border-amber-500/30'
                        }`}
                    >
                      {isHigh ? 'HIGH' : 'MED'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom subtle note matching HeroPanel */}
          <div className="lp-eyebrow mt-4 pt-3.5 border-t border-white/[0.07] flex items-center justify-between text-[10px]">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-violet-300" />
              Live auto-refresh before high-impact economic releases
            </span>
            <span className="text-slate-400 hidden sm:inline">GMT/UTC Synchronized</span>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Newspaper, CalendarRange, RefreshCw, ExternalLink, TrendingUp, TrendingDown,
  Minus, Clock, Globe, AlertTriangle, Radio, MapPin, CalendarDays, Search,
  Bell, X, CheckCircle2, Lock, MessageCircle, Loader2, Landmark, ArrowRight,
  ShieldAlert, Info, Building2, Flame
} from 'lucide-react';

export interface UsBankHoliday {
  id: string;
  name: string;
  date: string;
  dayOfWeek: string;
  status: string;
  impactLevel: 'Critical' | 'High' | 'Moderate';
  summary: string;
  liquidity: string;
  spreads: string;
  cme: string;
  advice: string;
}

export function generateUsHolidays(year: number): UsBankHoliday[] {
  const getNthWeekdayOfMonth = (y: number, m: number, weekday: number, n: number) => {
    let count = 0;
    for (let day = 1; day <= 31; day++) {
      const d = new Date(Date.UTC(y, m, day));
      if (d.getUTCMonth() !== m) break;
      if (d.getUTCDay() === weekday) {
        count++;
        if (count === n) return d;
      }
    }
    return new Date(Date.UTC(y, m, 1));
  };

  const getLastWeekdayOfMonth = (y: number, m: number, weekday: number) => {
    for (let day = 31; day >= 1; day--) {
      const d = new Date(Date.UTC(y, m, day));
      if (d.getUTCMonth() === m && d.getUTCDay() === weekday) {
        return d;
      }
    }
    return new Date(Date.UTC(y, m, 1));
  };

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const getDayName = (dStr: string) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const parts = dStr.split('-').map(Number);
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return days[d.getUTCDay()];
  };

  const list: Omit<UsBankHoliday, 'dayOfWeek'>[] = [
    {
      id: `${year}-new-years`,
      name: "New Year's Day",
      date: `${year}-01-01`,
      status: 'Full Global Market Closure',
      impactLevel: 'Critical',
      summary: 'All global financial institutions, Fedwire, and US exchanges are completely shut. Interbank forex trading is suspended or frozen.',
      liquidity: 'Zero liquidity; international central banking shutdown.',
      spreads: 'Extreme spread widening if quotes are offered; completely untradable.',
      cme: 'CME FX & commodity futures fully closed.',
      advice: 'Mandatory halt on trading; never hold high-leverage positions over New Year rollover.'
    },
    {
      id: `${year}-mlk`,
      name: "Martin Luther King Jr. Day",
      date: fmt(getNthWeekdayOfMonth(year, 0, 1, 3)),
      status: 'US Federal Holiday / Banks Closed',
      impactLevel: 'High',
      summary: 'US commercial banks and Federal Reserve bond desks closed. London session trades normally, followed by an afternoon liquidity vacuum.',
      liquidity: '65-75% drop in NY afternoon USD trading volume.',
      spreads: 'Bid-ask spreads on EUR/USD, GBP/USD, USD/JPY widen by 1.5x–2.5x after 12:00 PM EST.',
      cme: 'CME FX and metals futures close early (1:00 PM EST).',
      advice: 'Trade exclusively during the European/London morning session; close intraday scalp trades prior to US hours.'
    },
    {
      id: `${year}-presidents`,
      name: "Presidents' Day (Washington's Birthday)",
      date: fmt(getNthWeekdayOfMonth(year, 1, 1, 3)),
      status: 'US Banks & Exchanges Closed',
      impactLevel: 'High',
      summary: 'No US equity or debt clearing. Major currency pairs trade in compressed consolidation channels with elevated sensitivity to small headlines.',
      liquidity: 'Volume evaporates abruptly once London trading desks hand over to New York.',
      spreads: 'Moderate to high spread widening; execution slippage risk on market orders.',
      cme: 'Early halt for US index and currency futures.',
      advice: 'Beware of false breakouts during NY afternoon hours on hollow order books.'
    },
    {
      id: `${year}-good-friday`,
      name: "Good Friday",
      date: year === 2025 ? '2025-04-18' : year === 2026 ? '2026-04-03' : `${year}-03-26`,
      status: 'Global Banking Holiday',
      impactLevel: 'Critical',
      summary: 'Combined US, UK, European, Australian, and Canadian bank closures. One of the quietest yet highest-risk trading days of the entire calendar year.',
      liquidity: 'Global FX spot volume declines by ~80%+. Most major institutional desks operate skeleton crews.',
      spreads: 'Spreads can blow out by 3x–6x on both majors and crosses.',
      cme: 'CME and ICE markets closed.',
      advice: 'Strongly advise closing short-term positions; high vulnerability to flash spikes on low volume.'
    },
    {
      id: `${year}-memorial`,
      name: "Memorial Day",
      date: fmt(getLastWeekdayOfMonth(year, 4, 1)),
      status: 'US Federal Holiday / Banks Closed',
      impactLevel: 'High',
      summary: 'US markets closed. Marks the start of lower summer trading volume. UK Spring Bank Holiday frequently coincides.',
      liquidity: 'Active London morning liquidity; afternoon drops to near-zero as US desks are offline.',
      spreads: 'Spreads widen substantially after European cash close (11:30 AM EST).',
      cme: 'Early close at 1:00 PM EST.',
      advice: 'Avoid holding momentum breakout positions into US hours.'
    },
    {
      id: `${year}-juneteenth`,
      name: "Juneteenth National Independence Day",
      date: `${year}-06-19`,
      status: 'Federal Holiday / US Banks Closed',
      impactLevel: 'Moderate',
      summary: 'Federal banks and US stock exchanges closed. European and Asian sessions operate with standard volume.',
      liquidity: 'NY session volume lower by ~55%. USD pairs enter tight ranges.',
      spreads: 'Slight spread increase on USD pairs.',
      cme: 'Early closure at 1:00 PM EST for currency and equity futures.',
      advice: 'Trade with range-bound strategies; lower profit targets for intraday trades.'
    },
    {
      id: `${year}-july4`,
      name: "US Independence Day (4th of July)",
      date: `${year}-07-04`,
      status: 'Federal Holiday / Full Closure',
      impactLevel: 'High',
      summary: 'Major American national holiday. Wall Street and all US clearing banks closed.',
      liquidity: 'NY trading session virtually dead; price action stagnates across USD pairs.',
      spreads: 'Noticeable spread expansion and reduced market depth.',
      cme: 'CME FX futures close early or halt.',
      advice: 'Ideal day to stay out of the market or take time off from active day trading.'
    },
    {
      id: `${year}-labor-day`,
      name: "Labor Day",
      date: fmt(getNthWeekdayOfMonth(year, 8, 1, 1)),
      status: 'Federal Holiday / US Markets Closed',
      impactLevel: 'High',
      summary: 'US holiday signalling the official end of summer. European desks trade normally but NY desks are dark.',
      liquidity: 'London session volume remains solid; dramatic drop after London fixing (11:00 AM EST).',
      spreads: 'Spreads widen in the afternoon; erratic spikes possible on thin volume.',
      cme: 'Early closure at 1:00 PM EST.',
      advice: 'Take profits during the London session and avoid trading USD crosses in the afternoon.'
    },
    {
      id: `${year}-columbus`,
      name: "Columbus Day / Indigenous Peoples' Day",
      date: fmt(getNthWeekdayOfMonth(year, 9, 1, 2)),
      status: 'Bank Holiday (US Equities Open, Bonds Closed)',
      impactLevel: 'Moderate',
      summary: 'US bond market and Federal Reserve wire systems closed, while stock exchanges remain open.',
      liquidity: 'Moderate liquidity impact; FX swap settlements and treasury yields are paused.',
      spreads: 'Mild spread widening on USD crosses.',
      cme: 'Normal or slightly abbreviated trading hours.',
      advice: 'Monitor US equity session volatility; currency pairs may lag normal economic correlations.'
    },
    {
      id: `${year}-veterans`,
      name: "Veterans Day",
      date: `${year}-11-11`,
      status: 'Federal Bank Holiday / Bond Market Closed',
      impactLevel: 'Moderate',
      summary: 'US commercial banks and government bond markets closed; NYSE and NASDAQ remain open.',
      liquidity: 'Reduced institutional liquidity; money-market funds and interbank settlements offline.',
      spreads: 'Slightly wider spreads on USD pairs during late afternoon.',
      cme: 'Normal hours for equity & FX futures.',
      advice: 'Expect tighter intraday trading ranges.'
    },
    {
      id: `${year}-thanksgiving`,
      name: "Thanksgiving Day & Black Friday",
      date: fmt(getNthWeekdayOfMonth(year, 10, 4, 4)),
      status: 'Major US Holiday / Extended Closure',
      impactLevel: 'Critical',
      summary: 'US markets completely closed on Thursday; early close at 1:00 PM EST on Friday. Global FX liquidity plunges.',
      liquidity: 'Severe 75-90% drop in market depth from Thursday morning through the weekend.',
      spreads: 'Substantial spread widening; risk of flash slippage on algorithmic triggers.',
      cme: 'Closed Thursday; 1:15 PM EST early close Friday.',
      advice: 'Close active positions before Thanksgiving Wednesday close; avoid trading on thin holiday Friday.'
    },
    {
      id: `${year}-christmas`,
      name: "Christmas Day",
      date: `${year}-12-25`,
      status: 'Worldwide Full Market Closure',
      impactLevel: 'Critical',
      summary: 'All major worldwide financial hubs (New York, London, Tokyo, Frankfurt, Sydney) are completely closed.',
      liquidity: 'Zero liquidity; brokers disconnect price feeds.',
      spreads: 'No active trading.',
      cme: 'Full market closure.',
      advice: 'Mandatory trading break. Enjoy time with family!'
    }
  ];

  return list.map(item => ({
    ...item,
    dayOfWeek: getDayName(item.date)
  }));
}

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

// =====================================================
// WhatsApp Reminder Modal
// =====================================================
const REMIND_OPTIONS = [
  { label: '5 min before', value: 5 },
  { label: '10 min before', value: 10 },
  { label: '15 min before', value: 15 },
  { label: '30 min before', value: 30 },
  { label: '1 hour before', value: 60 },
  { label: '2 hours before', value: 120 },
];

function WhatsAppReminderModal({
  event,
  existingPhone,
  isPro,
  onClose,
  onSaved,
}: {
  event: EconEvent;
  existingPhone?: string;
  isPro: boolean;
  onClose: () => void;
  onSaved: (phone: string, mins: number, eventId: string) => void;
}) {
  const [phone, setPhone] = useState(existingPhone || '');
  const [mins, setMins] = useState(15);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    if (!phone.trim()) { setErr('Please enter your WhatsApp number.'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/reminders/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: event.id,
          eventName: event.event,
          eventDate: event.date,
          currency: event.currency,
          impact: event.impact,
          phone: phone.trim(),
          minutesBefore: mins,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Failed to save reminder.'); return; }
      setSuccess(true);
      setTimeout(() => { onSaved(phone.trim(), mins, event.id); onClose(); }, 1500);
    } catch {
      setErr('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl w-full max-w-md relative overflow-hidden">
        {/* Decorative gradient */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-green-400 via-emerald-400 to-teal-500" />
        <div className="p-6">
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-500/15 flex items-center justify-center">
                <MessageCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white">WhatsApp Reminder</h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Get notified before this event fires</p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition p-1">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Event summary */}
          <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 rounded-xl p-3.5 mb-5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-extrabold text-red-600 dark:text-red-300 bg-red-100 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 px-1.5 py-0.5 rounded-full">{event.impact.toUpperCase()} IMPACT</span>
              <span className="text-[10px] font-bold text-blue-700 dark:text-blue-400">{event.currency}</span>
            </div>
            <p className="text-sm font-bold text-slate-900 dark:text-white leading-snug">{event.event}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3" /> {fmtTime(event.date)} · {fmtDate(event.date)}
            </p>
          </div>

          {!isPro ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center mb-3">
                <Lock className="h-7 w-7 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="font-black text-slate-900 dark:text-white text-base mb-1">Pro Feature</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[260px] leading-relaxed">
                WhatsApp reminders are available for <span className="text-amber-600 dark:text-amber-400 font-bold">Pro subscribers</span>. Upgrade to get notified before high-impact events.
              </p>
              <button onClick={onClose} className="mt-5 px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold shadow hover:opacity-90 transition">
                Upgrade to Pro
              </button>
            </div>
          ) : success ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
              <p className="font-black text-slate-900 dark:text-white text-base">Reminder Set!</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">We'll message you {mins} minutes before the event.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1.5">
                  WhatsApp Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={e => { setPhone(e.target.value); setErr(''); }}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-400 transition"
                />
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Include country code, e.g. +91 for India</p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1.5">Remind me</label>
                <div className="grid grid-cols-3 gap-2">
                  {REMIND_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setMins(opt.value)}
                      className={`text-[11px] font-bold py-2 rounded-xl border transition ${
                        mins === opt.value
                          ? 'bg-green-500 text-white border-green-500 shadow-sm'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-green-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {err && (
                <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl px-3 py-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{err}
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white text-sm font-bold shadow-lg hover:opacity-90 transition disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                {saving ? 'Saving…' : 'Set Reminder'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FXNews({ initialTab = 'news', isPro = false }: { initialTab?: 'news' | 'calendar' | 'holidays'; isPro?: boolean }) {
  const [tab, setTab] = useState<'news' | 'calendar' | 'holidays'>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const [holidaySearch, setHolidaySearch] = useState('');
  const [holidayFilter, setHolidayFilter] = useState<'all' | 'critical' | 'upcoming'>('upcoming');

  const allHolidays = useMemo(() => {
    const currentY = new Date().getFullYear();
    const h1 = generateUsHolidays(currentY);
    const h2 = generateUsHolidays(currentY + 1);
    const combined = [...h1, ...h2];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return combined.map(h => {
      const parts = h.date.split('-').map(Number);
      const hDate = new Date(parts[0], parts[1] - 1, parts[2]);
      const diffTime = hDate.getTime() - today.getTime();
      const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return {
        ...h,
        daysUntil,
        isPast: daysUntil < 0,
        isToday: daysUntil === 0,
        formattedDate: hDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      };
    });
  }, []);

  const upcomingHolidays = useMemo(() => {
    return allHolidays.filter(h => h.daysUntil >= 0).sort((a, b) => a.daysUntil - b.daysUntil);
  }, [allHolidays]);

  const nearestHoliday = upcomingHolidays[0] || null;

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

  // WhatsApp reminder state
  const [reminderEvent, setReminderEvent] = useState<EconEvent | null>(null);
  const [savedReminders, setSavedReminders] = useState<Record<string, { phone: string; mins: number }>>({});

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

  const selectCls = 'h-8 bg-white dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.08] rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 px-2.5 focus:outline-none focus:ring-1 focus:ring-violet-500/30';

  return (
    <div className="space-y-4 sm:space-y-6" data-testid="fx-news-page">
      {/* Apple-style Segmented Control & Upcoming High-Impact Event */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center p-1 rounded-2xl bg-white/[0.03] border border-white/[0.08] w-full sm:w-auto">
          <button
            onClick={() => setTab('news')}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl text-xs font-semibold transition ${
              tab === 'news'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Newspaper className="h-3.5 w-3.5" /> Latest FX News
          </button>
          <button
            onClick={() => setTab('calendar')}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl text-xs font-semibold transition ${
              tab === 'calendar'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <CalendarRange className="h-3.5 w-3.5" /> Economic Calendar
          </button>
          <button
            onClick={() => setTab('holidays')}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl text-xs font-semibold transition ${
              tab === 'holidays'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Landmark className="h-3.5 w-3.5" /> US Bank Holidays & Impact
          </button>
        </div>

        {nextHigh && (
          <div className="inline-flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10.5px] font-medium px-2.5 py-1 rounded-xl self-start sm:self-auto">
            <Radio className="h-3 w-3 text-rose-400 animate-pulse shrink-0" />
            <span className="truncate">Next: <strong className="font-bold">{nextHigh.currency} {nextHigh.event}</strong> · {nextHighCountdown}</span>
          </div>
        )}
      </div>

      {/* ================= NEWS TAB ================= */}
      {tab === 'news' && (
        <div className="space-y-5">
          {/* Featured Upcoming US Bank Holiday Alert */}
          {nearestHoliday && (
            <div className="rounded-2xl p-4 sm:p-5 border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent text-slate-800 dark:text-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-500 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Landmark className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                      {nearestHoliday.daysUntil === 0 ? 'Today (US Holiday)' : nearestHoliday.daysUntil === 1 ? 'Tomorrow (US Holiday)' : `In ${nearestHoliday.daysUntil} Days`}
                    </span>
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {nearestHoliday.formattedDate} · {nearestHoliday.dayOfWeek}
                    </span>
                  </div>
                  <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {nearestHoliday.name} — Potential Forex Market Impact
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
                    {nearestHoliday.summary}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTab('holidays')}
                className="self-start md:self-center shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <span>Full Holiday Impact Analysis</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

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
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300 border border-violet-600/30 dark:border-violet-500/30 hover:bg-violet-500/10 rounded-xl px-3 py-2 transition disabled:opacity-50"
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
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
              {filteredNews.map(a => (
                <article key={a.id} className="dx-panel hover:border-violet-500/40 p-3.5 sm:p-5 rounded-2xl shadow-xs flex flex-col transition-colors duration-200">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[9.5px] font-mono font-bold uppercase tracking-wider text-violet-700 dark:text-violet-400 bg-violet-500/10 border border-violet-600/25 dark:border-violet-500/20 px-2 py-0.5 rounded-full">
                      {a.category}
                    </span>
                    <span className="text-[9.5px] font-mono text-slate-400 dark:text-slate-500 flex items-center gap-1 shrink-0">
                      <Clock className="h-3 w-3" />
                      {timeAgo(a.publishedAt)}
                    </span>
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm leading-snug line-clamp-2">
                    {a.title}
                  </h3>
                  {a.summary && (
                    <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-1.5 line-clamp-2">
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
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-700 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-300 py-2 -my-2 shrink-0"
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
          <section className="dx-panel text-slate-900 dark:text-white p-3.5 sm:p-5 rounded-2xl shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 w-72 h-72 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-red-600 dark:text-red-300 bg-red-100 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 px-2 py-0.5 rounded-full">
                  <Radio className="h-3 w-3 animate-pulse" /> Upcoming High Impact Events
                </span>
                {calProvider && (
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-auto hidden sm:inline">Source: {calProvider}</span>
                )}
              </div>

              {upcomingHigh.length === 0 ? (
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                  {calLoading
                    ? 'Loading upcoming events…'
                    : calError
                      ? 'High impact data unavailable right now.'
                      : 'No upcoming high impact events in the next 3 weeks.'}
                </p>
              ) : (
                <>
                  {nextHigh && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-3 sm:p-4 mb-3 shadow-xs">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[9.5px] font-bold bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-500/40 px-1.5 py-0.5 rounded">
                            🔴 HIGH IMPACT
                          </span>
                          <span className="text-[9.5px] font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-transparent px-1.5 py-0.5 rounded">{nextHigh.currency}</span>
                          <span className="text-[9.5px] text-slate-500 dark:text-slate-400">{nextHigh.country}</span>
                        </div>
                        <h3 className="font-extrabold text-sm sm:text-base mt-1.5 text-slate-900 dark:text-white truncate">{nextHigh.event}</h3>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {fmtTime(nextHigh.date)} · {fmtDate(nextHigh.date)} · ({tzName})
                        </p>
                      </div>
                      <div className="shrink-0 flex items-baseline sm:flex-col gap-2 sm:gap-0">
                        <div className="text-[9.5px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Starts in</div>
                        <div className="font-mono font-black text-lg sm:text-2xl tabular-nums text-slate-900 dark:text-white">{nextHighCountdown}</div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                    {upcomingHigh.slice(0, 6).map(ev => (
                      <div key={ev.id} className="shrink-0 min-w-[150px] sm:min-w-[180px] bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 shadow-xs rounded-xl p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[9.5px] font-bold text-slate-700 dark:text-slate-300">{fmtTime(ev.date)}</span>
                          <span className="text-[9.5px] font-extrabold text-red-600 dark:text-red-300 bg-red-100 dark:bg-red-500/15 px-1.5 py-0.5 rounded-full">High</span>
                        </div>
                        <p className="text-[11px] font-bold text-slate-900 dark:text-white mt-1 line-clamp-2">{ev.currency} {ev.event}</p>
                        <p className="text-[9.5px] text-slate-500 dark:text-slate-400 mt-0.5">{fmtDate(ev.date)}</p>
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
                          <th className="py-3 pr-5 pl-3 font-bold text-right">Remind</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map(ev => {
                          const imp = impactConfig(ev.impact);
                          const hasReminder = !!savedReminders[ev.id];
                          const isFuture = new Date(ev.date).getTime() > Date.now();
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
                              <td className="py-3 pr-5 pl-3 text-right whitespace-nowrap">
                                {isFuture && (
                                  <button
                                    onClick={() => setReminderEvent(ev)}
                                    title={hasReminder ? 'Reminder set – click to change' : 'Set WhatsApp reminder'}
                                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border transition ${
                                      hasReminder
                                        ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-300 border-green-300 dark:border-green-500/40'
                                        : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-green-400 hover:text-green-600'
                                    }`}
                                  >
                                    {hasReminder ? <Bell className="h-3 w-3" /> : <Bell className="h-3 w-3" />}
                                    {hasReminder ? 'Set' : 'Remind'}
                                  </button>
                                )}
                              </td>
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
                      const hasReminder = !!savedReminders[ev.id];
                      const isFuture = new Date(ev.date).getTime() > Date.now();
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
                              {isFuture && (
                                <button
                                  onClick={() => setReminderEvent(ev)}
                                  className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-lg border transition ${
                                    hasReminder
                                      ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-300 border-green-300 dark:border-green-500/40'
                                      : 'bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700 hover:border-green-400 hover:text-green-600'
                                  }`}
                                >
                                  <Bell className="h-2.5 w-2.5" />
                                  {hasReminder ? 'Set' : 'Remind'}
                                </button>
                              )}
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

      {/* ================= US BANK HOLIDAYS TAB ================= */}
      {tab === 'holidays' && (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="dx-panel p-5 sm:p-6 bg-gradient-to-br from-amber-500/10 via-slate-900/40 to-slate-950 border border-amber-500/25">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
                    <Landmark className="h-4 w-4" />
                  </span>
                  <span className="text-xs font-bold text-amber-400 tracking-wider uppercase font-mono">
                    US Federal & Bank Schedule
                  </span>
                </div>
                <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                  US Bank Holidays & Forex Market Impact
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
                  Federal Reserve banking closures halt USD interbank settlements and trigger severe liquidity drops. Review dates, expected market depth reductions, and volatility advisories below.
                </p>
              </div>

              {nearestHoliday && (
                <div className="shrink-0 p-3.5 rounded-xl bg-white/5 border border-white/10 flex flex-col gap-1 min-w-[200px]">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Next Upcoming Holiday</span>
                  <span className="text-sm font-black text-white truncate">{nearestHoliday.name}</span>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-slate-400">{nearestHoliday.formattedDate}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      {nearestHoliday.daysUntil === 0 ? 'Today' : `In ${nearestHoliday.daysUntil}d`}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Rules of Thumb Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-6 pt-5 border-t border-white/10">
              <div className="p-3 rounded-xl bg-black/20 border border-white/5 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                  <Building2 className="h-3.5 w-3.5" />
                  <span>Fedwire Offline</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-tight">
                  Federal Reserve interbank settlement pauses. Commercial banks process zero wire orders.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-black/20 border border-white/5 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-rose-400">
                  <TrendingDown className="h-3.5 w-3.5" />
                  <span>NY Liquidity Collapse</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-tight">
                  NY trading volume cuts by 65–85%. Price action stagnates into narrow consolidation channels.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-black/20 border border-white/5 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-sky-400">
                  <Globe className="h-3.5 w-3.5" />
                  <span>London Session Focus</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-tight">
                  European hours carry genuine volume. Activity drops abruptly after 11:30 AM EST.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-black/20 border border-white/5 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span>Wider Bid/Ask Spreads</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-tight">
                  Brokers expand spreads on EUR/USD, GBP/USD, and XAU/USD. Widen stop buffers.
                </p>
              </div>
            </div>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10 self-start">
              <button
                onClick={() => setHolidayFilter('upcoming')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  holidayFilter === 'upcoming' ? 'bg-violet-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
              >
                Upcoming Holidays ({upcomingHolidays.length})
              </button>
              <button
                onClick={() => setHolidayFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  holidayFilter === 'all' ? 'bg-violet-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
              >
                Full Calendar ({allHolidays.length})
              </button>
              <button
                onClick={() => setHolidayFilter('critical')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  holidayFilter === 'critical' ? 'bg-violet-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
              >
                Critical / Full Closure
              </button>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search US holiday or event…"
                value={holidaySearch}
                onChange={e => setHolidaySearch(e.target.value)}
                className="w-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
          </div>

          {/* Holidays Cards List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
            {allHolidays
              .filter(h => {
                if (holidayFilter === 'upcoming' && h.daysUntil < 0) return false;
                if (holidayFilter === 'critical' && h.impactLevel !== 'Critical') return false;
                if (holidaySearch.trim()) {
                  const q = holidaySearch.toLowerCase();
                  return h.name.toLowerCase().includes(q) || h.summary.toLowerCase().includes(q) || h.date.includes(q);
                }
                return true;
              })
              .map(h => {
                const isUpcomingNext = nearestHoliday?.id === h.id;
                return (
                  <div
                    key={h.id}
                    className={`dx-panel p-5 rounded-2xl flex flex-col justify-between transition-all duration-200 ${
                      isUpcomingNext
                        ? 'border-amber-500/50 bg-gradient-to-b from-amber-500/10 to-transparent shadow-md ring-1 ring-amber-500/30'
                        : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                    }`}
                  >
                    <div>
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                            h.impactLevel === 'Critical'
                              ? 'bg-rose-500/15 text-rose-500 dark:text-rose-400 border border-rose-500/30'
                              : h.impactLevel === 'High'
                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                                : 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30'
                          }`}>
                            {h.impactLevel} Impact
                          </span>
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 font-semibold">
                            {h.formattedDate} · {h.dayOfWeek}
                          </span>
                        </div>

                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg tabular-nums ${
                          h.daysUntil === 0
                            ? 'bg-emerald-500 text-black font-extrabold animate-pulse'
                            : h.daysUntil > 0
                              ? 'bg-white/10 text-slate-200'
                              : 'bg-slate-800 text-slate-500 line-through'
                        }`}>
                          {h.daysUntil === 0 ? 'TODAY' : h.daysUntil > 0 ? `In ${h.daysUntil} Days` : 'Past'}
                        </span>
                      </div>

                      {/* Title & Status */}
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        {h.name}
                      </h3>
                      <p className="text-xs text-amber-600 dark:text-amber-400/90 font-medium mt-0.5">
                        {h.status}
                      </p>

                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-2.5 leading-relaxed">
                        {h.summary}
                      </p>

                      {/* Impact Details Grid */}
                      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-white/5 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11.5px]">
                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5 space-y-0.5">
                          <span className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 block">📉 Volume Impact</span>
                          <span className="text-slate-700 dark:text-slate-200 leading-tight block">{h.liquidity}</span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5 space-y-0.5">
                          <span className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 block">↔️ Spread Expansion</span>
                          <span className="text-slate-700 dark:text-slate-200 leading-tight block">{h.spreads}</span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5 space-y-0.5">
                          <span className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 block">🕒 CME Hours</span>
                          <span className="text-slate-700 dark:text-slate-200 leading-tight block">{h.cme}</span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/15 space-y-0.5">
                          <span className="text-[9.5px] font-bold uppercase tracking-wider text-amber-500 dark:text-amber-400 block">💡 Trader Advisory</span>
                          <span className="text-slate-700 dark:text-slate-200 leading-tight block font-medium">{h.advice}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* WhatsApp Reminder Modal */}
      {reminderEvent && (
        <WhatsAppReminderModal
          event={reminderEvent}
          existingPhone={savedReminders[reminderEvent.id]?.phone}
          isPro={isPro}
          onClose={() => setReminderEvent(null)}
          onSaved={(phone, mins, eventId) => {
            setSavedReminders(prev => ({ ...prev, [eventId]: { phone, mins } }));
            setReminderEvent(null);
          }}
        />
      )}
    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import { Radio, CalendarRange, ArrowRight } from 'lucide-react';

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

const pad = (n: number) => String(n).padStart(2, '0');

export default function NextEventCard({ onOpenCalendar }: { onOpenCalendar: () => void }) {
  const [events, setEvents] = useState<EconEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    const from = new Date();
    const fromKey = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`;
    const toKeyDate = new Date();
    toKeyDate.setDate(toKeyDate.getDate() + 21);
    const toKey = `${toKeyDate.getFullYear()}-${pad(toKeyDate.getMonth() + 1)}-${pad(toKeyDate.getDate())}`;
    fetch(`/api/economic-calendar?from=${fromKey}&to=${toKey}`)
      .then(res => {
        if (!res.ok) throw new Error('unavailable');
        return res.json();
      })
      .then(data => {
        if (!cancelled) setEvents(Array.isArray(data.events) ? data.events : []);
      })
      .catch(() => {
        if (!cancelled) setError('unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const nextEvent = useMemo(() => {
    const upcoming = events
      .filter(e => new Date(e.date).getTime() > now)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return upcoming.find(e => e.impact === 'high') || upcoming[0] || null;
  }, [events, now]);

  const countdown = nextEvent ? formatCountdown(new Date(nextEvent.date).getTime() - now) : '';

  if (loading) {
    return (
      <div className="w-full bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-3 sm:p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-500 animate-pulse"><Radio className="h-4 w-4" /></div>
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            <div className="h-3 w-2/3 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !nextEvent) {
    return (
      <button
        type="button"
        onClick={onOpenCalendar}
        className="w-full text-left bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-3 sm:p-4 shadow-xs hover:shadow transition flex items-center gap-2.5 sm:gap-3"
      >
        <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
          <CalendarRange className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">Economic Calendar</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">No upcoming high-impact events scheduled right now.</p>
        </div>
        <ArrowRight className="h-4 w-4 text-slate-400" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenCalendar}
      className="w-full text-left group bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-3 sm:p-4 shadow-xs hover:shadow-md transition flex items-center gap-2.5 sm:gap-3 cursor-pointer"
    >
      <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-500 shrink-0">
        <Radio className="h-4 w-4 animate-pulse" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs font-extrabold text-slate-900 dark:text-white uppercase tracking-wider truncate">
            Next: {nextEvent.currency} {nextEvent.event}
          </p>
        </div>
        <p className="text-xs font-semibold text-red-600 dark:text-red-400 mt-0.5 sm:mt-1 tabular-nums">
          Starts in {countdown}
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-xs font-bold text-violet-600 dark:text-violet-400 shrink-0">
        <span className="hidden sm:inline">Open Economic Calendar</span>
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

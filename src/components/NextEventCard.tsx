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
      <div className="w-full bg-white/[0.025] border border-white/[0.06] rounded-2xl p-2.5 sm:p-3 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-red-500/10 text-red-400 animate-pulse"><Radio className="h-3.5 w-3.5" /></div>
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-1/3 bg-white/10 rounded animate-pulse" />
            <div className="h-2 w-2/3 bg-white/10 rounded animate-pulse" />
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
        className="w-full text-left bg-white/[0.025] hover:bg-white/[0.05] border border-white/[0.06] rounded-2xl p-2.5 sm:p-3 shadow-xs transition flex items-center gap-2.5"
      >
        <div className="p-1.5 rounded-lg bg-white/[0.05] text-slate-400">
          <CalendarRange className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-white uppercase tracking-wider">Economic Calendar</p>
          <p className="text-[10px] text-slate-400 truncate">No high-impact events scheduled right now.</p>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenCalendar}
      className="w-full text-left group bg-white/[0.025] hover:bg-white/[0.045] border border-white/[0.06] rounded-2xl p-2.5 sm:p-3 shadow-xs transition flex items-center gap-2.5 cursor-pointer active:scale-[0.99]"
    >
      <div className="h-7 w-7 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center shrink-0">
        <Radio className="h-3.5 w-3.5 animate-pulse" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11.5px] font-bold text-white uppercase tracking-wide truncate">
          Next: {nextEvent.currency} {nextEvent.event}
        </p>
        <p className="text-[10.5px] font-semibold text-rose-400 tabular-nums">
          Starts in {countdown}
        </p>
      </div>
      <div className="flex items-center gap-1 text-[11px] font-semibold text-violet-400 shrink-0">
        <span className="hidden sm:inline">Calendar</span>
        <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 text-slate-400 group-hover:text-white" />
      </div>
    </button>
  );
}

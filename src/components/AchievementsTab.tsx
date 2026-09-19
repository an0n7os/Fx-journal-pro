import React from 'react';
import { Trophy, Lock, CheckCircle2, TrendingUp, Flame, Filter } from 'lucide-react';

export default function AchievementsTab({ user, trades }: { user?: any, trades?: any[] }) {
  // Compute start date from user creation or first trade
  const startDateStr = (user?.createdAt || user?.created_at)
    ? new Date(user.createdAt || user.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : (trades && trades.length > 0 
        ? new Date(Math.min(...trades.map(t => new Date(t.date).getTime()))).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Today');

  // Helper to get start of week (Sunday)
  const getStartOfWeek = (d: Date) => {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    const diff = date.getDate() - day;
    return new Date(date.setDate(diff));
  };

  // Helper to format date range
  const formatWeekRange = (start: Date) => {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = start.getMonth() === end.getMonth() 
      ? end.toLocaleDateString('en-US', { day: 'numeric' })
      : end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${startStr} - ${endStr}`;
  };

  // Set of all weeks traded (timestamp of Sunday midnight)
  const tradedWeeks = new Set(
    (trades || []).map(t => getStartOfWeek(new Date(t.date)).getTime())
  );

  const today = new Date();
  const currentWeekStart = getStartOfWeek(today);

  // Generate last 6 weeks
  const recentWeeks = [];
  for (let i = 5; i >= 0; i--) {
    const weekStart = new Date(currentWeekStart);
    weekStart.setDate(weekStart.getDate() - (i * 7));
    let isTraded = tradedWeeks.has(weekStart.getTime());
    let label = formatWeekRange(weekStart);
    if (i === 0) {
      label = 'This week';
      isTraded = true; // Always show active for the current week
    }
    recentWeeks.push({ date: label, logged: isTraded, isCurrent: i === 0 });
  }

  const loggedCount = recentWeeks.filter(w => w.logged).length;

  // Calculate current streak
  let currentStreak = 0;
  let checkWeek = new Date(currentWeekStart);
  
  if (!tradedWeeks.has(checkWeek.getTime())) {
    checkWeek.setDate(checkWeek.getDate() - 7);
  }
  
  while (tradedWeeks.has(checkWeek.getTime())) {
    currentStreak++;
    checkWeek.setDate(checkWeek.getDate() - 7);
  }

  // Calculate best streak
  let bestStreak = 0;
  if (tradedWeeks.size > 0) {
    const sortedWeeks = Array.from(tradedWeeks).sort((a, b) => a - b);
    let currentRun = 1;
    bestStreak = 1;
    for (let i = 1; i < sortedWeeks.length; i++) {
      const prev = new Date(sortedWeeks[i - 1]);
      const curr = new Date(sortedWeeks[i]);
      if (curr.getTime() - prev.getTime() === 7 * 24 * 60 * 60 * 1000) {
        currentRun++;
        bestStreak = Math.max(bestStreak, currentRun);
      } else {
        currentRun = 1;
      }
    }
  }
  
  return (
    <div className="space-y-6 text-slate-900 dark:text-slate-100">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Side - Stats & Weekly Log */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-violet-500/10 text-violet-600 dark:text-violet-300 rounded-full text-xs font-semibold mb-4 border border-violet-500/20">
              <Trophy className="h-4 w-4" />
              Collector Showcase
            </div>
            
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Achievements</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
              Track the milestones that mark your progress across accounts, journaling, and consistency.
            </p>



            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Recent Weekly Log</h3>
              <span className="text-xs font-semibold text-violet-600 dark:text-violet-400">{loggedCount}/6 logged</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {recentWeeks.map((week, i) => (
                week.logged ? (
                  <div key={i} className="bg-emerald-50 dark:bg-[#11231D] border border-emerald-200 dark:border-emerald-900/50 rounded-xl p-3 text-center flex flex-col items-center justify-between h-[104px]">
                    <div className="text-xs text-emerald-800 dark:text-slate-100 font-bold">{week.date}</div>
                    <div className="bg-emerald-100 dark:bg-emerald-500/20 w-8 h-8 rounded-full flex items-center justify-center">
                      <Flame className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
                    </div>
                    <div className="text-xs font-bold text-emerald-700 dark:text-emerald-500">
                      {week.isCurrent ? 'Active' : 'Logged'}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="bg-slate-50 dark:bg-[#0B101E] border border-slate-200 dark:border-slate-800/80 rounded-xl p-3 text-center flex flex-col items-center justify-between h-[104px]">
                    <div className="text-xs text-slate-700 dark:text-slate-100 font-bold">{week.date}</div>
                    <div className="bg-slate-200 dark:bg-slate-800/60 w-8 h-8 rounded-full flex items-center justify-center">
                      {week.isCurrent ? (
                        <Lock className="h-3 w-3 text-slate-500 dark:text-slate-400" />
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400 font-bold text-base leading-none mb-0.5">-</span>
                      )}
                    </div>
                    <div className="text-xs font-bold text-slate-500 dark:text-blue-100/70">
                      {week.isCurrent ? 'Pending' : 'Missed'}
                    </div>
                  </div>
                )
              ))}
            </div>
          </div>
        </div>

        {/* Right Side - Streak Tracker */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 flex flex-col relative overflow-hidden">
          {/* Flame Icon Background */}
          <div className="absolute top-0 right-0 w-32 h-32 opacity-5 dark:opacity-10 blur-xl bg-blue-500 rounded-full translate-x-8 -translate-y-8"></div>
          
          <div className="flex justify-between items-start mb-6 z-10">
            <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 shadow-inner border border-slate-200 dark:border-slate-700 flex items-center justify-center w-24 h-24 relative overflow-hidden">
              {/* Background glow for the fire */}
              <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full"></div>
              {/* Hue-rotated 3D native emoji for a beautiful blue fire effect */}
              <div className="text-6xl leading-none relative z-10 select-none animate-pulse" style={{ filter: 'hue-rotate(200deg) saturate(1.5) drop-shadow(0 4px 12px rgba(59,130,246,0.6))' }}>
                🔥
              </div>
            </div>
            <div className="text-right flex flex-col items-end">
              {tradedWeeks.has(currentWeekStart.getTime()) ? (
                <div className="inline-flex items-center whitespace-nowrap gap-1 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full text-[11px] font-bold mb-3 shadow-sm">
                  <Flame className="h-3 w-3" />
                  This week locked in
                </div>
              ) : (
                <div className="inline-flex items-center whitespace-nowrap gap-1 px-2.5 py-1 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-full text-[11px] font-bold mb-3 shadow-sm">
                  <Lock className="h-3 w-3" />
                  Trade to lock in week
                </div>
              )}
              <div className="text-xs font-semibold text-violet-600 dark:text-violet-400">2/12 weekly ranks</div>
            </div>
          </div>

          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1 z-10">{currentStreak}-week streak</h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm mb-8 z-10">
            Keep logging in weekly to climb the streak ladder.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-8 z-10">
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700/50">
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Best run</div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">{bestStreak} weeks</div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700/50">
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Started</div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">{startDateStr}</div>
            </div>
          </div>

          <div className="mt-auto z-10">
            <div className="flex justify-between items-end mb-2">
              <div>
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Next streak rank</div>
                <div className="text-sm text-violet-600 dark:text-violet-400 font-medium mt-1">Flame Keeper: 2/4 weeks</div>
              </div>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300">2/12</div>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div className="bg-blue-500 h-full rounded-full" style={{ width: '50%' }}></div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

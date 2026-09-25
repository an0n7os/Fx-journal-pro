import React, { useEffect, useState, useCallback } from 'react';
import {
  Rocket,
  LayoutDashboard,
  PlusCircle,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  X,
  MousePointerClick,
  Terminal
} from 'lucide-react';

interface GuidedTourProps {
  step: number;
  accountCreated: boolean;
  variant?: 'onboarding' | 'mt5';
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onFinish: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const STEPS = [
  { id: 'welcome', badge: 'Welcome' },
  { id: 'create', badge: 'Step 1 of 2' },
  { id: 'trade', badge: 'Step 2 of 2' },
  { id: 'done', badge: 'Done' },
];

const MT5_STEPS = [
  { id: 'announce', badge: 'MT5 Sync' },
  { id: 'window', badge: 'The MT5 Sync Window' },
  { id: 'done', badge: 'Done' },
];

export default function GuidedTour({ step, accountCreated, variant = 'onboarding', onNext, onBack, onSkip, onFinish }: GuidedTourProps) {
  const [rect, setRect] = useState<Rect | null>(null);
  const isMT5 = variant === 'mt5';
  const selector = !isMT5
    ? step === 2 ? '[data-tour="create-portfolio"]' : step === 3 ? '[data-tour="add-trade"]' : null
    : null;

  const measure = useCallback(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    const el = document.querySelector(selector);
    if (el) {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    } else {
      setRect(null);
    }
  }, [selector]);

  useEffect(() => {
    if (!selector) return;
    measure();
    const el = document.querySelector(selector);
    if (el) {
      (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    const interval = setInterval(measure, 150);
    const stop = setTimeout(() => clearInterval(interval), 2500);
    return () => {
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [selector, measure]);

  useEffect(() => {
    if (!selector) return;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [selector, measure]);

  const isSpotlight = !isMT5 && (step === 2 || step === 3);
  const isFull = isMT5 ? (step === 1 || step === 2 || step === 3) : (step === 1 || step === 4);

  const tooltipWidth = 320;
  const tooltipHeightEst = 200;
  let tooltipStyle: React.CSSProperties | null = null;
  if (isSpotlight && rect) {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - tooltipWidth / 2, vw - tooltipWidth - 12));
    const spaceBelow = vh - (rect.top + rect.height) - 20;
    const spaceAbove = rect.top - 20;
    const below = spaceBelow > spaceAbove;
    const top = below
      ? Math.min(rect.top + rect.height + 16, vh - tooltipHeightEst - 12)
      : Math.max(12, rect.top - tooltipHeightEst - 16);
    tooltipStyle = { left, top, width: Math.min(tooltipWidth, vw - 24) };
  }

  const renderCard = (stepId: number) => {
    if (stepId === 4 || (isMT5 && stepId === 3)) {
      return (
        <div className="max-w-sm w-full bg-[#0c101d]/95 backdrop-blur-2xl text-slate-100 rounded-3xl shadow-[0_24px_70px_rgba(0,0,0,0.9),0_0_30px_rgba(16,185,129,0.2)] border border-white/10 overflow-hidden animate-in fade-in zoom-in duration-300 relative">
          <div className="absolute top-0 left-8 right-8 h-[2px] bg-gradient-to-r from-transparent via-emerald-500 to-transparent shadow-[0_0_12px_#10b981]" />
          <div className="p-6 text-center">
            <div className="h-14 w-14 mx-auto rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.25)]">
              <CheckCircle2 className="h-7 w-7 text-emerald-400 stroke-[2.5]" />
            </div>
            <h2 className="text-xl font-black text-white font-display mt-4">You're all set!</h2>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Your trading workspace is ready. You can restart this tour anytime from <span className="font-semibold text-violet-400">Settings &gt; Help</span>.
            </p>
            <button
              onClick={onFinish}
              className="mt-5 w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-2 shadow-[0_6px_20px_rgba(16,185,129,0.35)] cursor-pointer"
            >
              Finish &amp; Start Trading <CheckCircle2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      );
    }

    if (isMT5) {
      const isAnnounce = stepId === 1;
      return (
        <div className="max-w-sm w-full bg-[#0c101d]/95 backdrop-blur-2xl text-slate-100 rounded-3xl shadow-2xl border border-white/10 overflow-hidden animate-in fade-in zoom-in duration-300 relative">
          <div className="absolute top-0 left-8 right-8 h-[2px] bg-gradient-to-r from-transparent via-sky-500 to-transparent shadow-[0_0_12px_#0ea5e9]" />
          <div className="p-6">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white shrink-0 shadow-[0_4px_16px_rgba(14,165,233,0.35)]">
                <Terminal className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-black text-white font-display leading-tight">
                  {isAnnounce ? 'MT5 Sync is here — and it\'s fixed' : 'Your MT5 Sync window'}
                </h2>
                <span className="text-[10px] font-bold uppercase tracking-widest text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-full inline-block mt-1">
                  {MT5_STEPS[stepId - 1].badge}
                </span>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {isAnnounce ? (
                <>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    We've fixed and improved MT5 syncing. Trades now flow from your MT5 terminal into your journal automatically — no more copy-paste or failed syncs.
                  </p>
                  <div className="flex items-center gap-2.5 text-xs text-slate-300">
                    <span className="h-6 w-6 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shrink-0"><Terminal className="h-3.5 w-3.5" /></span>
                    Connect your MT5 terminal via the new MT5 Sync window
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-slate-300">
                    <span className="h-6 w-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0"><CheckCircle2 className="h-3.5 w-3.5" /></span>
                    Every trade syncs automatically with accurate balances
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-300 leading-relaxed">
                  This is your MT5 Sync window. Create an MT5 Sync account, attach the Expert Advisor to your terminal, and your trades sync automatically.
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 mt-5 pt-3 border-t border-white/10">
              {isAnnounce ? (
                <button
                  onClick={onSkip}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-white transition flex items-center gap-1 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" /> Skip
                </button>
              ) : (
                <button
                  onClick={onBack}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
              )}
              <button
                onClick={onNext}
                className="px-4 py-2 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                {isAnnounce ? 'Show me' : 'Continue'} <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (stepId === 1) {
      return (
        <div className="max-w-md w-full bg-[#0c101d]/95 backdrop-blur-2xl text-slate-100 rounded-3xl shadow-[0_24px_70px_rgba(0,0,0,0.9),0_0_40px_rgba(124,58,237,0.2)] border border-white/10 overflow-hidden animate-in fade-in zoom-in duration-300 relative">
          <div className="absolute top-0 left-8 right-8 h-[2px] bg-gradient-to-r from-transparent via-violet-500 to-transparent shadow-[0_0_12px_#8b5cf6]" />
          <div className="p-6">
            <div className="flex items-center gap-3.5 mb-4">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shrink-0 shadow-[0_8px_20px_rgba(124,58,237,0.4)]">
                <Rocket className="h-6 w-6" />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2.5 py-0.5 rounded-full inline-block mb-1">
                  Workspace Setup
                </span>
                <h2 className="text-lg font-black text-white font-display leading-tight">Welcome to FX Journal Pro</h2>
                <p className="text-xs text-slate-400 mt-0.5">Let's set up your trading workspace — takes less than a minute.</p>
              </div>
            </div>
            <div className="mt-4 space-y-2.5 bg-white/[0.03] border border-white/5 rounded-2xl p-4">
              <div className="flex items-center gap-3 text-xs text-slate-300">
                <span className="h-7 w-7 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-400 flex items-center justify-center shrink-0">
                  <LayoutDashboard className="h-3.5 w-3.5" />
                </span>
                <div>
                  <div className="font-semibold text-slate-100">Step 1: Your Portfolio Account</div>
                  <div className="text-[11px] text-slate-400">View balances and connect broker accounts</div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-300">
                <span className="h-7 w-7 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                  <PlusCircle className="h-3.5 w-3.5" />
                </span>
                <div>
                  <div className="font-semibold text-slate-100">Step 2: Log Your First Trade</div>
                  <div className="text-[11px] text-slate-400">Track executions, setups &amp; discipline metrics</div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 mt-6 pt-3 border-t border-white/10">
              <button
                onClick={onSkip}
                className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" /> Skip Tour
              </button>
              <button
                onClick={onNext}
                className="px-5 py-2.5 bg-gradient-to-r from-violet-600 via-indigo-600 to-emerald-600 hover:from-violet-500 hover:to-emerald-500 text-white font-bold text-xs rounded-xl transition flex items-center gap-2 shadow-[0_6px_20px_rgba(124,58,237,0.4)] cursor-pointer"
              >
                Get Started <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      );
    }

    const isCreate = stepId === 2;
    const title = isCreate ? 'Your Trading Accounts' : 'Log Your Trades';
    const body = isCreate
      ? 'Your trading portfolios live here. A starter portfolio is ready for you, or click below to connect your MT5 broker.'
      : 'Click here to log a trade manually, or import trade history from your terminal report.';

    return (
      <div className="w-[340px] bg-[#0c101d]/95 backdrop-blur-2xl text-slate-100 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.9),0_0_30px_rgba(124,58,237,0.25)] border border-white/15 p-5 animate-in fade-in zoom-in duration-300 relative overflow-hidden">
        <div className="absolute top-0 left-6 right-6 h-[2px] bg-gradient-to-r from-transparent via-violet-500 to-transparent" />
        <div className="flex items-center justify-between mb-3">
          <span className="text-[9px] font-bold uppercase tracking-widest text-violet-300 bg-violet-500/15 border border-violet-500/25 px-2.5 py-0.5 rounded-full">
            {STEPS[stepId - 1].badge}
          </span>
          <button onClick={onSkip} title="Skip tour" className="text-slate-400 hover:text-white transition p-1 cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-start gap-3">
          <div className={`h-9 w-9 rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm ${isCreate ? 'bg-gradient-to-br from-violet-600 to-indigo-600' : 'bg-gradient-to-br from-emerald-500 to-teal-600'}`}>
            {isCreate ? <LayoutDashboard className="h-4 w-4" /> : <MousePointerClick className="h-4 w-4" />}
          </div>
          <div>
            <h3 className="text-sm font-black text-white font-display leading-tight">{title}</h3>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">{body}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-white/10">
          <div className="flex items-center gap-1">
            <button
              onClick={onBack}
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="h-3 w-3" /> Back
            </button>
            <button
              onClick={onSkip}
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-white transition cursor-pointer"
            >
              Skip
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onFinish}
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition cursor-pointer"
            >
              Finish
            </button>
            <button
              onClick={onNext}
              className="px-4 py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs rounded-lg transition flex items-center gap-1 shadow-sm cursor-pointer"
            >
              Next <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[9999]" role="dialog" aria-modal="true" aria-label="Onboarding guide">
      {isSpotlight && rect && (
        <>
          <div
            className="absolute pointer-events-none transition-all duration-500 ease-out"
            style={{
              left: rect.left - 10,
              top: rect.top - 10,
              width: rect.width + 20,
              height: rect.height + 20,
              borderRadius: 18,
              boxShadow: '0 0 0 9999px rgba(2,6,23,0.7)',
            }}
          />
          <div
            className="absolute pointer-events-none transition-all duration-500 ease-out rounded-[18px]"
            style={{
              left: rect.left - 12,
              top: rect.top - 12,
              width: rect.width + 24,
              height: rect.height + 24,
              border: '2px solid rgba(139,92,246,0.9)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.25), 0 8px 30px rgba(124,58,237,0.4)',
            }}
          />
        </>
      )}
      {(isFull || (isSpotlight && (!rect || !tooltipStyle))) && (
        <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-[2px]" />
      )}
      {isSpotlight && rect && tooltipStyle && (
        <div className="absolute transition-all duration-300" style={tooltipStyle}>
          {renderCard(step)}
        </div>
      )}
      {(isFull || (isSpotlight && (!rect || !tooltipStyle))) && (
        <div className="absolute inset-0 flex items-center justify-center p-4 overflow-y-auto">
          {renderCard(step)}
        </div>
      )}
    </div>
  );
}

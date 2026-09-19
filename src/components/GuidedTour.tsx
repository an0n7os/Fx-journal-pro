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
    const t = setTimeout(() => {
      const el = document.querySelector(selector);
      if (el) {
        (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(measure, 500);
      }
    }, 150);
    return () => clearTimeout(t);
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
        <div className="max-w-sm w-full bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in duration-300">
          <div className="h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div className="p-5 text-center">
            <div className="h-12 w-12 mx-auto rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white font-display mt-3">You're all set!</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              {isMT5
                ? <>MT5 Sync is ready whenever you are — restart anytime from <span className="font-semibold text-slate-700 dark:text-slate-200">Settings &gt; Help</span>.</>
                : <>Restart anytime from <span className="font-semibold text-slate-700 dark:text-slate-200">Settings &gt; Help</span>.</>}
            </p>
            <button
              onClick={onFinish}
              className="mt-4 w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] rounded-lg transition flex items-center justify-center gap-1.5 shadow-sm"
            >
              Finish <CheckCircle2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      );
    }

    if (isMT5) {
      const isAnnounce = stepId === 1;
      return (
        <div className="max-w-sm w-full bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in duration-300">
          <div className="h-1 bg-gradient-to-r from-sky-500 via-indigo-500 to-blue-600" />
          <div className="p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white shrink-0">
                <Terminal className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white font-display leading-tight">
                  {isAnnounce ? 'MT5 Sync is here — and it\'s fixed' : 'Your MT5 Sync window'}
                </h2>
                <span className="text-[9px] font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 px-2 py-0.5 rounded-full inline-block mt-1">
                  {MT5_STEPS[stepId - 1].badge}
                </span>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {isAnnounce ? (
                <>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    We've fixed and improved MT5 syncing. Trades now flow from your MT5 terminal into your journal automatically — no more copy-paste or failed syncs.
                  </p>
                  <div className="flex items-center gap-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="h-6 w-6 rounded-lg bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0"><Terminal className="h-3.5 w-3.5" /></span>
                    Connect your MT5 terminal via the new MT5 Sync window
                  </div>
                  <div className="flex items-center gap-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="h-6 w-6 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0"><CheckCircle2 className="h-3.5 w-3.5" /></span>
                    Every trade syncs automatically with accurate balances
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  This is your MT5 Sync window. Create an MT5 Sync account, attach the Expert Advisor to your terminal, and your trades sync automatically — with corrected balances and reliable re-syncs.
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 mt-5">
              {isAnnounce ? (
                <button
                  onClick={onSkip}
                  className="px-3 py-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition flex items-center gap-1"
                >
                  <X className="h-3 w-3" /> Skip Tour
                </button>
              ) : (
                <button
                  onClick={onBack}
                  className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition flex items-center gap-0.5"
                >
                  <ArrowLeft className="h-3 w-3" /> Back
                </button>
              )}
              <button
                onClick={onNext}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] rounded-lg transition flex items-center gap-1.5 shadow-sm"
              >
                {isAnnounce ? 'Show me' : 'Continue'} <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (stepId === 1) {
      return (
        <div className="max-w-sm w-full bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in duration-300">
          <div className="h-1 bg-gradient-to-r from-indigo-500 via-blue-500 to-emerald-500" />
          <div className="p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white shrink-0">
                <Rocket className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white font-display leading-tight">Welcome to FX Journal Pro</h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Let's set up your workspace — takes a minute.</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                <span className="h-6 w-6 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0"><LayoutDashboard className="h-3.5 w-3.5" /></span>
                Create your portfolio
              </div>
              <div className="flex items-center gap-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                <span className="h-6 w-6 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0"><PlusCircle className="h-3.5 w-3.5" /></span>
                Add your first trade
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 mt-5">
              <button
                onClick={onSkip}
                className="px-3 py-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Skip Tour
              </button>
              <button
                onClick={onNext}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] rounded-lg transition flex items-center gap-1.5 shadow-sm"
              >
                Get Started <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (stepId === 4) {
      return (
        <div className="max-w-sm w-full bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in duration-300">
          <div className="h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div className="p-5 text-center">
            <div className="h-12 w-12 mx-auto rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white font-display mt-3">You're all set!</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Restart anytime from <span className="font-semibold text-slate-700 dark:text-slate-200">Settings &gt; Help</span>.
            </p>
            <button
              onClick={onFinish}
              className="mt-4 w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] rounded-lg transition flex items-center justify-center gap-1.5 shadow-sm"
            >
              Finish <CheckCircle2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      );
    }

    const isCreate = stepId === 2;
    const title = isCreate ? 'Create Your Portfolio' : 'Add Your First Trade';
    const body = isCreate
      ? 'Your trading accounts live here. Click below to add your broker or a manual account.'
      : 'Click below to log a trade manually, or paste trades in from your MT5/MT4 terminal report.';

    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 p-4 animate-in fade-in zoom-in duration-300">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded-full">
            {STEPS[stepId - 1].badge}
          </span>
          <button onClick={onSkip} title="Skip tour" className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition p-1">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-start gap-2.5">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-white shrink-0 ${isCreate ? 'bg-gradient-to-br from-indigo-500 to-blue-600' : 'bg-gradient-to-br from-emerald-500 to-teal-600'}`}>
            {isCreate ? <LayoutDashboard className="h-4 w-4" /> : <MousePointerClick className="h-4 w-4" />}
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white font-display leading-tight">{title}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{body}</p>
          </div>
        </div>

        {isCreate && !accountCreated && (
          <p className="mt-2.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 rounded-lg px-2.5 py-1.5">
            Create your portfolio to unlock the next step.
          </p>
        )}

        <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-0.5">
            <button
              onClick={onBack}
              className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition flex items-center gap-0.5"
            >
              <ArrowLeft className="h-3 w-3" /> Back
            </button>
            <button
              onClick={onSkip}
              className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition"
            >
              Skip
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onFinish}
              className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition"
            >
              Finish
            </button>
            <button
              onClick={onNext}
              disabled={isCreate && !accountCreated}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] rounded-lg transition flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              Next <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Onboarding guide">
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
              boxShadow: '0 0 0 9999px rgba(2,6,23,0.6)',
            }}
          />
          <div
            className="absolute pointer-events-none transition-all duration-500 ease-out rounded-[18px]"
            style={{
              left: rect.left - 12,
              top: rect.top - 12,
              width: rect.width + 24,
              height: rect.height + 24,
              border: '2px solid rgba(129,140,248,0.9)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.25), 0 8px 24px rgba(0,0,0,0.35)',
            }}
          />
        </>
      )}
      {isFull && (
        <div className="absolute inset-0 bg-slate-950/60 dark:bg-slate-950/70 backdrop-blur-[2px]" />
      )}
      {isSpotlight && rect && tooltipStyle && (
        <div className="absolute" style={tooltipStyle}>
          {renderCard(step)}
        </div>
      )}
      {isFull && (
        <div className="absolute inset-0 flex items-center justify-center p-4 overflow-y-auto">
          {renderCard(step)}
        </div>
      )}
    </div>
  );
}

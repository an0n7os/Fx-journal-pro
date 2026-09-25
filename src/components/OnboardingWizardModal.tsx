import React from 'react';
import {
  Sparkles, Compass, TrendingUp, Trophy, Flame, Clock,
  BarChart3, Globe, Cpu, LineChart, ChevronRight, ArrowLeft, Check, X
} from 'lucide-react';

interface OnboardingWizardModalProps {
  onboardingStep: number;
  setOnboardingStep: (step: number) => void;
  obExperience: 'Beginner' | 'Intermediate' | 'Professional';
  setObExperience: (exp: 'Beginner' | 'Intermediate' | 'Professional') => void;
  obStyle: 'Scalping' | 'Day Trading' | 'Swing Trading';
  setObStyle: (style: 'Scalping' | 'Day Trading' | 'Swing Trading') => void;
  obMarkets: string[];
  setObMarkets: (markets: string[]) => void;
  actionLoading: boolean;
  onSubmit: () => void;
  canDismiss?: boolean;
  onClose?: () => void;
}

export const OnboardingWizardModal: React.FC<OnboardingWizardModalProps> = ({
  onboardingStep,
  setOnboardingStep,
  obExperience,
  setObExperience,
  obStyle,
  setObStyle,
  obMarkets,
  setObMarkets,
  actionLoading,
  onSubmit,
  canDismiss = false,
  onClose,
}) => {
  const experienceOptions = [
    {
      id: 'Beginner' as const,
      label: 'Beginner',
      badge: '< 1 Year',
      detail: 'Learning price action & risk management',
      icon: Compass,
      accent: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
      activeRing: 'ring-emerald-500/40 border-emerald-500/80 bg-emerald-500/[0.12]',
    },
    {
      id: 'Intermediate' as const,
      label: 'Intermediate',
      badge: '1 — 3 Years',
      detail: 'Consistent rules & established strategy',
      icon: TrendingUp,
      accent: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
      activeRing: 'ring-violet-500/40 border-violet-500/80 bg-violet-500/[0.14]',
    },
    {
      id: 'Professional' as const,
      label: 'Professional',
      badge: '3+ Years',
      detail: 'Funded prop firm or full-time trading',
      icon: Trophy,
      accent: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
      activeRing: 'ring-amber-500/40 border-amber-500/80 bg-amber-500/[0.12]',
    },
  ];

  const styleOptions = [
    {
      id: 'Scalping' as const,
      label: 'Scalping',
      timeframe: 'M1 — M5',
      desc: 'Rapid momentum trades in seconds or minutes',
      icon: Flame,
      color: 'text-rose-400',
      iconBg: 'bg-rose-500/10 border-rose-500/25',
    },
    {
      id: 'Day Trading' as const,
      label: 'Day Trading',
      timeframe: 'M15 — H1',
      desc: 'Intraday positions closed before session close',
      icon: Clock,
      color: 'text-indigo-400',
      iconBg: 'bg-indigo-500/10 border-indigo-500/25',
    },
    {
      id: 'Swing Trading' as const,
      label: 'Swing Trading',
      timeframe: 'H4 — D1',
      desc: 'Multi-day trend captures over days to weeks',
      icon: BarChart3,
      color: 'text-cyan-400',
      iconBg: 'bg-cyan-500/10 border-cyan-500/25',
    },
  ];

  const marketOptions = [
    {
      id: 'Forex',
      label: 'Forex Currencies',
      popular: 'EUR/USD, GBP/USD, USD/JPY & Majors',
      category: 'Currency Markets',
      icon: Globe,
      color: 'text-indigo-400',
      tag: 'Liquid',
    },
    {
      id: 'Gold',
      label: 'Gold & Commodities',
      popular: 'XAU/USD, Silver, Crude Oil',
      category: 'Metals & Energy',
      icon: Sparkles,
      color: 'text-amber-400',
      tag: 'High Volatility',
    },
    {
      id: 'Crypto',
      label: 'Cryptocurrencies',
      popular: 'BTC/USD, ETH/USD, SOL & Altcoins',
      category: '24/7 Digital Assets',
      icon: Cpu,
      color: 'text-cyan-400',
      tag: '24/7',
    },
    {
      id: 'Indices',
      label: 'Indices & Equities',
      popular: 'US30, NAS100, SPX500, GER40',
      category: 'Global Stock Indexes',
      icon: LineChart,
      color: 'text-emerald-400',
      tag: 'Trend Following',
    },
  ];

  return (
    <div className="min-h-screen bg-[#060810] flex items-center justify-center p-4 sm:p-6 font-sans antialiased text-slate-100 relative overflow-hidden select-none">
      {/* Dynamic ambient backlight glows */}
      <div className="absolute top-1/4 -left-36 w-[420px] h-[420px] bg-violet-600/15 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-1/4 -right-36 w-[420px] h-[420px] bg-indigo-600/15 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-900/10 rounded-full blur-[180px] pointer-events-none" />

      {/* Modern subtle tech grid overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(#1e2438_1px,transparent_1px)] [background-size:28px_28px] opacity-35 pointer-events-none" />

      {/* Main Glassmorphic Card */}
      <div className="relative w-full max-w-xl bg-[#0c101d]/90 backdrop-blur-2xl border border-white/[0.09] hover:border-violet-500/25 rounded-3xl p-6 sm:p-9 shadow-[0_24px_70px_-12px_rgba(0,0,0,0.85),0_0_50px_-10px_rgba(124,58,237,0.18)] z-10 transition-all duration-300">
        {/* Top accent glow line */}
        <div className="absolute top-0 left-10 right-10 h-[2px] bg-gradient-to-r from-transparent via-violet-500 to-transparent shadow-[0_0_12px_#8b5cf6]" />

        {/* Stepper Header */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/25 text-violet-300 text-xs font-semibold tracking-wide">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            Personalized Setup
          </span>
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-mono font-medium text-slate-400">Step {onboardingStep} of 2</span>
            <div className="flex gap-1.5">
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  onboardingStep >= 1
                    ? 'w-7 bg-gradient-to-r from-violet-500 to-indigo-500 shadow-[0_0_10px_rgba(124,58,237,0.8)]'
                    : 'w-2 bg-white/10'
                }`}
              />
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  onboardingStep === 2
                    ? 'w-7 bg-gradient-to-r from-violet-500 to-indigo-500 shadow-[0_0_10px_rgba(124,58,237,0.8)]'
                    : 'w-2 bg-white/10'
                }`}
              />
            </div>
            {canDismiss && onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="ml-1 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {onboardingStep === 1 ? (
          <div className="space-y-6">
            {/* Heading */}
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-white font-display">
                Personalize your trading workspace
              </h2>
              <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                Configure your trading profile so our AI analytics and journal calibrate to your market behavior.
              </p>
            </div>

            {/* Experience Group */}
            <div className="space-y-2.5">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                What is your Trading Experience?
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {experienceOptions.map((exp) => {
                  const active = obExperience === exp.id;
                  const Icon = exp.icon;
                  return (
                    <button
                      key={exp.id}
                      type="button"
                      onClick={() => setObExperience(exp.id)}
                      className={`relative p-3.5 rounded-2xl border text-left transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                        active
                          ? `${exp.activeRing} shadow-[0_0_24px_rgba(124,58,237,0.22)] ring-1`
                          : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'
                      }`}
                    >
                      {active && (
                        <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-violet-400 shadow-[0_0_8px_#a78bfa]" />
                      )}
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`p-1.5 rounded-xl border ${active ? exp.accent : 'bg-white/[0.04] border-white/10 text-slate-400'}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <span className={`text-sm font-bold ${active ? 'text-white' : 'text-slate-200'}`}>
                          {exp.label}
                        </span>
                      </div>
                      <div>
                        <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-mono font-medium ${
                          active ? 'bg-violet-500/20 text-violet-200' : 'bg-white/[0.05] text-slate-400'
                        }`}>
                          {exp.badge}
                        </span>
                        <p className="text-[11px] text-slate-400 mt-1 leading-snug line-clamp-1">
                          {exp.detail}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Trading Style Group */}
            <div className="space-y-2.5">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                Primary Trading Style
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {styleOptions.map((style) => {
                  const active = obStyle === style.id;
                  const Icon = style.icon;
                  return (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => setObStyle(style.id)}
                      className={`relative p-3.5 rounded-2xl border text-left transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                        active
                          ? 'border-violet-500/80 bg-violet-500/[0.14] ring-1 ring-violet-500/40 shadow-[0_0_24px_rgba(124,58,237,0.22)]'
                          : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'
                      }`}
                    >
                      {active && (
                        <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-violet-400 shadow-[0_0_8px_#a78bfa]" />
                      )}
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className={`p-1.5 rounded-xl border ${active ? 'bg-violet-500/20 border-violet-500/30' : style.iconBg}`}>
                          <Icon className={`w-4 h-4 ${style.color}`} />
                        </div>
                        <span className={`text-sm font-bold ${active ? 'text-white' : 'text-slate-200'}`}>
                          {style.label}
                        </span>
                      </div>
                      <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-mono font-medium ${
                        active ? 'bg-violet-500/20 text-violet-200' : 'bg-white/[0.05] text-slate-400'
                      }`}>
                        {style.timeframe}
                      </span>
                      <p className="text-[11px] text-slate-400 mt-1 leading-snug line-clamp-1">
                        {style.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Primary CTA */}
            <button
              type="button"
              onClick={() => setOnboardingStep(2)}
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-violet-500 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[0_10px_30px_-8px_rgba(124,58,237,0.6)] hover:shadow-[0_14px_35px_-6px_rgba(124,58,237,0.7)] transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] cursor-pointer mt-4"
            >
              Continue Setup <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Heading */}
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-white font-display">
                Select your target markets
              </h2>
              <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                Pick the asset classes you actively trade. We will personalize your economic events, news filters, and metrics.
              </p>
            </div>

            {/* Markets Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {marketOptions.map((market) => {
                const active = obMarkets.includes(market.id);
                const Icon = market.icon;
                return (
                  <button
                    key={market.id}
                    type="button"
                    onClick={() => {
                      if (active) {
                        if (obMarkets.length > 1) {
                          setObMarkets(obMarkets.filter((m) => m !== market.id));
                        }
                      } else {
                        setObMarkets([...obMarkets, market.id]);
                      }
                    }}
                    className={`relative p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer flex items-center justify-between gap-3 ${
                      active
                        ? 'border-violet-500/80 bg-gradient-to-br from-violet-500/[0.16] to-indigo-500/[0.08] shadow-[0_0_24px_rgba(124,58,237,0.22)] ring-1 ring-violet-500/40'
                        : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div
                        className={`p-2.5 rounded-xl border flex-shrink-0 transition-colors ${
                          active
                            ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                            : 'bg-white/[0.04] border-white/10 text-slate-400'
                        }`}
                      >
                        <Icon className={`w-5 h-5 ${active ? 'text-violet-300' : market.color}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-bold truncate ${active ? 'text-white' : 'text-slate-200'}`}>
                            {market.label}
                          </p>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-400 border border-white/[0.06]">
                            {market.tag}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">
                          {market.popular}
                        </p>
                      </div>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                        active
                          ? 'bg-gradient-to-r from-violet-500 to-indigo-500 text-white shadow-[0_0_10px_#8b5cf6]'
                          : 'border border-white/20 bg-white/[0.03]'
                      }`}
                    >
                      {active && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setOnboardingStep(1)}
                className="w-1/3 py-3.5 px-4 rounded-2xl border border-white/10 hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.07] text-slate-300 font-semibold text-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                type="button"
                disabled={actionLoading || obMarkets.length === 0}
                onClick={onSubmit}
                className="w-2/3 py-3.5 px-6 rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-emerald-600 hover:from-violet-500 hover:to-emerald-500 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[0_10px_30px_-8px_rgba(124,58,237,0.6)] hover:shadow-[0_14px_35px_-6px_rgba(124,58,237,0.7)] transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    <span>Launching...</span>
                  </>
                ) : (
                  <>
                    <span>Complete & Launch</span>
                    <Check className="w-4 h-4 stroke-[2.5]" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
export default OnboardingWizardModal;

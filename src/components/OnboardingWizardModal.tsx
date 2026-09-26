import React, { useState } from 'react';
import {
  Compass, TrendingUp, Trophy, Flame, Clock,
  BarChart3, Globe, Sparkles, LineChart, Cpu,
  ArrowRight, ArrowLeft, Check, RefreshCw, X
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
  // 3-step modern flow matching the reference screenshot design
  const [currentStep, setCurrentStep] = useState<number>(() => {
    return onboardingStep === 2 ? 3 : 1;
  });

  const handleSetStep = (step: number) => {
    setCurrentStep(step);
    setOnboardingStep(step >= 2 ? 2 : 1);
  };

  // Step 1: Experience options (3 items like screenshot)
  const experienceOptions = [
    {
      id: 'Beginner' as const,
      title: 'Beginner Trader',
      subtitle: 'Learning price action & risk management (< 1 Year)',
      icon: Compass,
    },
    {
      id: 'Intermediate' as const,
      title: 'Intermediate Trader',
      subtitle: 'Consistent rules & established strategy (1 — 3 Years)',
      icon: TrendingUp,
    },
    {
      id: 'Professional' as const,
      title: 'Professional Trader',
      subtitle: 'Funded prop firm or full-time trading (3+ Years)',
      icon: Trophy,
    },
  ];

  // Step 2: Trading Style options (3 items like screenshot)
  const styleOptions = [
    {
      id: 'Scalping' as const,
      title: 'Scalping',
      subtitle: 'Rapid momentum trades in seconds or minutes (M1 — M5)',
      icon: Flame,
    },
    {
      id: 'Day Trading' as const,
      title: 'Day Trading',
      subtitle: 'Intraday positions closed before session close (M15 — H1)',
      icon: Clock,
    },
    {
      id: 'Swing Trading' as const,
      title: 'Swing Trading',
      subtitle: 'Multi-day trend captures over days to weeks (H4 — D1)',
      icon: BarChart3,
    },
  ];

  // Step 3: Target Markets options
  const marketOptions = [
    {
      id: 'Forex',
      title: 'Forex Currencies',
      subtitle: 'EUR/USD, GBP/USD, USD/JPY & Major pairs',
      icon: Globe,
    },
    {
      id: 'Gold',
      title: 'Gold & Commodities',
      subtitle: 'XAU/USD, Silver & Crude Oil',
      icon: Sparkles,
    },
    {
      id: 'Indices',
      title: 'Indices & Equities',
      subtitle: 'US30, NAS100, SPX500, GER40',
      icon: LineChart,
    },
    {
      id: 'Crypto',
      title: 'Cryptocurrencies',
      subtitle: 'BTC/USD, ETH/USD & Liquid Altcoins',
      icon: Cpu,
    },
  ];

  const totalSteps = 3;

  return (
    <div className="fixed inset-0 z-[9999] min-h-screen bg-[#06080d]/95 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 font-sans antialiased text-slate-100 select-none overflow-y-auto">
      {/* Soft spotlight beam from top-left matching reference screenshot */}
      <div className="fixed -top-40 -left-40 w-[450px] h-[450px] bg-gradient-to-br from-white/[0.08] via-emerald-500/[0.05] to-transparent rounded-full blur-[90px] pointer-events-none transform -rotate-12" />
      {/* Ambient glowing emerald auras */}
      <div className="fixed top-1/3 -left-20 w-80 h-80 bg-emerald-500/[0.12] rounded-full blur-[110px] pointer-events-none" />
      <div className="fixed bottom-1/4 -right-24 w-80 h-80 bg-emerald-600/[0.06] rounded-full blur-[120px] pointer-events-none" />

      {/* Main Glassmorphic Card Container */}
      <div className="relative w-full max-w-[440px] bg-[#0c1017]/95 border border-white/[0.08] hover:border-white/[0.14] rounded-[32px] p-6 sm:p-8 shadow-[0_24px_70px_rgba(0,0,0,0.9),0_0_40px_rgba(16,185,129,0.08)] z-10 transition-all duration-300">
        
        {/* Close Button if dismissible */}
        {canDismiss && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-5 right-5 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* ── Segmented Progress Bar (Pill dashes with glowing neon emerald) ── */}
        <div className="flex items-center justify-center gap-1.5 mb-6">
          {Array.from({ length: totalSteps }).map((_, idx) => {
            const stepNum = idx + 1;
            const isActive = stepNum === currentStep;
            const isPassed = stepNum < currentStep;
            return (
              <div
                key={stepNum}
                className={`h-1 rounded-full transition-all duration-300 ${
                  isActive
                    ? 'w-9 bg-[#10b981] shadow-[0_0_12px_#10b981]'
                    : isPassed
                    ? 'w-7 bg-emerald-700/70'
                    : 'w-7 bg-white/[0.08]'
                }`}
              />
            );
          })}
        </div>

        {/* ── 3D Folder / Contract Graphic (Exact match to reference image) ── */}
        <div className="flex justify-center mb-4">
          <div className="relative w-16 h-14 flex items-center justify-center">
            {/* Ambient emerald backlight behind folder */}
            <div className="absolute inset-0 bg-emerald-500/25 blur-xl rounded-full" />
            
            {/* Layered White Paper Cards Peeking Out */}
            <div className="absolute top-0 w-8 h-6 bg-white/80 rounded-t shadow-sm -rotate-6 transform border border-black/10 flex items-center justify-center">
              <span className="text-[6.5px] font-bold text-slate-900 tracking-tighter">Contract</span>
            </div>
            <div className="absolute top-0.5 w-8 h-6 bg-white rounded-t shadow-sm rotate-3 transform border border-black/10 flex items-center justify-center">
              <span className="text-[6.5px] font-mono font-bold text-slate-800">Plan</span>
            </div>

            {/* Front Glossy Dark Folder Body */}
            <div className="absolute bottom-0 w-12 h-9 bg-gradient-to-b from-[#242b38] to-[#10141e] rounded-xl border border-white/20 shadow-xl flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
            </div>
          </div>
        </div>

        {/* ── Title & Subtitle ── */}
        <div className="text-center mb-6">
          <h2 className="text-xl sm:text-[22px] font-bold text-white tracking-tight font-display">
            {currentStep === 1 && 'Choose experience level'}
            {currentStep === 2 && 'Choose trading style'}
            {currentStep === 3 && 'Choose target markets'}
          </h2>
          <p className="text-xs text-slate-400 mt-1.5 max-w-[280px] mx-auto leading-relaxed">
            {currentStep === 1 && 'What stage of your trading journey are you currently in?'}
            {currentStep === 2 && 'What type of execution strategy do you have in mind?'}
            {currentStep === 3 && 'Which markets do you actively journal & track?'}
          </p>
        </div>

        {/* ── Option Rows (Exact styling matching screenshot) ── */}
        <div className="space-y-2.5 mb-6">
          {/* STEP 1: Experience */}
          {currentStep === 1 &&
            experienceOptions.map((opt) => {
              const isSelected = obExperience === opt.id;
              const Icon = opt.icon;
              return (
                <div
                  key={opt.id}
                  onClick={() => setObExperience(opt.id)}
                  className={`group w-full p-3 sm:p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer flex items-center justify-between gap-3 text-left ${
                    isSelected
                      ? 'bg-emerald-950/25 border-emerald-500/60 shadow-[0_0_24px_rgba(16,185,129,0.18)] ring-1 ring-emerald-500/40'
                      : 'bg-[#10141d]/70 hover:bg-[#151a24] border-white/[0.06] hover:border-white/15'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Emerald squircle icon box */}
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border transition-all ${
                        isSelected
                          ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                          : 'bg-[#0d261a] border-emerald-500/25 text-emerald-400 group-hover:bg-[#113323] group-hover:border-emerald-500/40'
                      }`}
                    >
                      <Icon className="w-4 h-4 stroke-[2.2]" />
                    </div>

                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-white tracking-tight truncate">
                        {opt.title}
                      </h4>
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {opt.subtitle}
                      </p>
                    </div>
                  </div>

                  {/* Right squircle action button */}
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border transition-all duration-200 ${
                      isSelected
                        ? 'bg-emerald-500 border-emerald-400 text-black shadow-[0_0_10px_#10b981]'
                        : 'bg-white/[0.03] border-white/[0.08] text-slate-400 group-hover:text-white group-hover:bg-white/[0.08] group-hover:border-white/20'
                    }`}
                  >
                    {isSelected ? (
                      <Check className="w-4 h-4 stroke-[3]" />
                    ) : (
                      <ArrowRight className="w-4 h-4 stroke-[2] transition-transform group-hover:translate-x-0.5" />
                    )}
                  </div>
                </div>
              );
            })}

          {/* STEP 2: Trading Style */}
          {currentStep === 2 &&
            styleOptions.map((opt) => {
              const isSelected = obStyle === opt.id;
              const Icon = opt.icon;
              return (
                <div
                  key={opt.id}
                  onClick={() => setObStyle(opt.id)}
                  className={`group w-full p-3 sm:p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer flex items-center justify-between gap-3 text-left ${
                    isSelected
                      ? 'bg-emerald-950/25 border-emerald-500/60 shadow-[0_0_24px_rgba(16,185,129,0.18)] ring-1 ring-emerald-500/40'
                      : 'bg-[#10141d]/70 hover:bg-[#151a24] border-white/[0.06] hover:border-white/15'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border transition-all ${
                        isSelected
                          ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                          : 'bg-[#0d261a] border-emerald-500/25 text-emerald-400 group-hover:bg-[#113323] group-hover:border-emerald-500/40'
                      }`}
                    >
                      <Icon className="w-4 h-4 stroke-[2.2]" />
                    </div>

                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-white tracking-tight truncate">
                        {opt.title}
                      </h4>
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {opt.subtitle}
                      </p>
                    </div>
                  </div>

                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border transition-all duration-200 ${
                      isSelected
                        ? 'bg-emerald-500 border-emerald-400 text-black shadow-[0_0_10px_#10b981]'
                        : 'bg-white/[0.03] border-white/[0.08] text-slate-400 group-hover:text-white group-hover:bg-white/[0.08] group-hover:border-white/20'
                    }`}
                  >
                    {isSelected ? (
                      <Check className="w-4 h-4 stroke-[3]" />
                    ) : (
                      <ArrowRight className="w-4 h-4 stroke-[2] transition-transform group-hover:translate-x-0.5" />
                    )}
                  </div>
                </div>
              );
            })}

          {/* STEP 3: Target Markets */}
          {currentStep === 3 &&
            marketOptions.map((opt) => {
              const isSelected = obMarkets.includes(opt.id);
              const Icon = opt.icon;
              return (
                <div
                  key={opt.id}
                  onClick={() => {
                    if (isSelected) {
                      if (obMarkets.length > 1) {
                        setObMarkets(obMarkets.filter((m) => m !== opt.id));
                      }
                    } else {
                      setObMarkets([...obMarkets, opt.id]);
                    }
                  }}
                  className={`group w-full p-3 sm:p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer flex items-center justify-between gap-3 text-left ${
                    isSelected
                      ? 'bg-emerald-950/25 border-emerald-500/60 shadow-[0_0_24px_rgba(16,185,129,0.18)] ring-1 ring-emerald-500/40'
                      : 'bg-[#10141d]/70 hover:bg-[#151a24] border-white/[0.06] hover:border-white/15'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border transition-all ${
                        isSelected
                          ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                          : 'bg-[#0d261a] border-emerald-500/25 text-emerald-400 group-hover:bg-[#113323] group-hover:border-emerald-500/40'
                      }`}
                    >
                      <Icon className="w-4 h-4 stroke-[2.2]" />
                    </div>

                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-white tracking-tight truncate">
                        {opt.title}
                      </h4>
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {opt.subtitle}
                      </p>
                    </div>
                  </div>

                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border transition-all duration-200 ${
                      isSelected
                        ? 'bg-emerald-500 border-emerald-400 text-black shadow-[0_0_10px_#10b981]'
                        : 'bg-white/[0.03] border-white/[0.08] text-slate-400 group-hover:text-white group-hover:bg-white/[0.08] group-hover:border-white/20'
                    }`}
                  >
                    {isSelected ? (
                      <Check className="w-4 h-4 stroke-[3]" />
                    ) : (
                      <ArrowRight className="w-4 h-4 stroke-[2] transition-transform group-hover:translate-x-0.5" />
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {/* ── Bottom Pill Actions (Matching reference screenshot) ── */}
        <div className="flex items-center justify-between pt-2">
          {/* Back Pill Button */}
          <button
            type="button"
            disabled={currentStep === 1}
            onClick={() => handleSetStep(Math.max(1, currentStep - 1))}
            className={`px-4 py-2 rounded-full border text-xs font-semibold flex items-center gap-1.5 transition-all ${
              currentStep === 1
                ? 'opacity-25 border-white/[0.04] text-slate-500 cursor-not-allowed'
                : 'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.08] hover:text-white cursor-pointer'
            }`}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-2">
            {/* Skip Button */}
            <button
              type="button"
              onClick={() => {
                if (canDismiss && onClose) {
                  onClose();
                } else {
                  onSubmit();
                }
              }}
              className="px-4 py-2 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-semibold text-slate-400 hover:text-white transition cursor-pointer"
            >
              Skip
            </button>

            {/* Next / Launch Button */}
            {currentStep < 3 ? (
              <button
                type="button"
                onClick={() => handleSetStep(currentStep + 1)}
                className="px-5 py-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center gap-1.5 shadow-[0_0_16px_rgba(16,185,129,0.35)] transition-all cursor-pointer"
              >
                Continue
                <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
              </button>
            ) : (
              <button
                type="button"
                disabled={actionLoading || obMarkets.length === 0}
                onClick={onSubmit}
                className="px-5 py-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center gap-1.5 shadow-[0_0_20px_rgba(16,185,129,0.45)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-black" />
                    <span>Launching...</span>
                  </>
                ) : (
                  <>
                    <span>Complete</span>
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default OnboardingWizardModal;

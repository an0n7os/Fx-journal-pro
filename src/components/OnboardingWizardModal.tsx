import {
  Compass, TrendingUp, Trophy, Flame, Clock,
  BarChart3, Globe, Sparkles, LineChart, Cpu,
  ArrowRight, ArrowLeft, Check, RefreshCw, X
} from 'lucide-react';
import { useScrollLock } from '../lib/useScrollLock';

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
  // Prevent background scrolling while onboarding wizard is active
  useScrollLock(true);

  const [currentStep, setCurrentStep] = useState<number>(() => {
    return onboardingStep === 2 ? 3 : 1;
  });

  const handleSetStep = (step: number) => {
    setCurrentStep(step);
    setOnboardingStep(step >= 2 ? 2 : 1);
  };

  const experienceOptions = [
    { id: 'Beginner' as const, title: 'Beginner Trader', subtitle: 'Learning price action & risk management (< 1 Year)', icon: Compass },
    { id: 'Intermediate' as const, title: 'Intermediate Trader', subtitle: 'Consistent rules & established strategy (1 — 3 Years)', icon: TrendingUp },
    { id: 'Professional' as const, title: 'Professional Trader', subtitle: 'Funded prop firm or full-time trading (3+ Years)', icon: Trophy },
  ];

  const styleOptions = [
    { id: 'Scalping' as const, title: 'Scalping', subtitle: 'Rapid momentum trades in seconds or minutes (M1 — M5)', icon: Flame },
    { id: 'Day Trading' as const, title: 'Day Trading', subtitle: 'Intraday positions closed before session close (M15 — H1)', icon: Clock },
    { id: 'Swing Trading' as const, title: 'Swing Trading', subtitle: 'Multi-day trend captures over days to weeks (H4 — D1)', icon: BarChart3 },
  ];

  const marketOptions = [
    { id: 'Forex', title: 'Forex Currencies', subtitle: 'EUR/USD, GBP/USD, USD/JPY & Major pairs', icon: Globe },
    { id: 'Gold', title: 'Gold & Commodities', subtitle: 'XAU/USD, Silver & Crude Oil', icon: Sparkles },
    { id: 'Indices', title: 'Indices & Equities', subtitle: 'US30, NAS100, SPX500, GER40', icon: LineChart },
    { id: 'Crypto', title: 'Cryptocurrencies', subtitle: 'BTC/USD, ETH/USD & Liquid Altcoins', icon: Cpu },
  ];

  const totalSteps = 3;
  const stepMeta = [{ label: 'Experience' }, { label: 'Style' }, { label: 'Markets' }];

  // Shared option row renderer
  const OptionRow = ({
    id, title, subtitle, icon: Icon, isSelected, onClick,
  }: { id: string; title: string; subtitle: string; icon: any; isSelected: boolean; onClick: () => void }) => (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className={`group w-full p-2.5 xs:p-3 sm:p-3.5 rounded-xl sm:rounded-2xl border transition-all duration-200 cursor-pointer flex items-center justify-between gap-2.5 sm:gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 ${
        isSelected
          ? 'bg-violet-950/30 border-violet-500/55 shadow-[0_0_26px_rgba(139,92,246,0.18)] ring-1 ring-violet-500/35'
          : 'bg-[#10121b]/70 hover:bg-[#14172a] border-white/[0.06] hover:border-violet-500/25'
      }`}
    >
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 border transition-all ${
          isSelected
            ? 'bg-violet-500/20 border-violet-400/40 text-violet-300 shadow-[0_0_14px_rgba(139,92,246,0.35)]'
            : 'bg-violet-950/50 border-violet-500/20 text-violet-400 group-hover:bg-violet-950/80 group-hover:border-violet-500/35'
        }`}>
          <Icon className="w-4 h-4 stroke-[2.2]" />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-white tracking-tight truncate">{title}</h4>
          <p className="text-xs text-slate-400 truncate mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 border transition-all duration-200 ${
        isSelected
          ? 'bg-violet-500 border-violet-400 text-white shadow-[0_0_12px_rgba(139,92,246,0.55)]'
          : 'bg-white/[0.03] border-white/[0.07] text-slate-500 group-hover:text-slate-300 group-hover:bg-white/[0.07] group-hover:border-white/20'
      }`}>
        {isSelected ? <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" /> : <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2] transition-transform group-hover:translate-x-0.5" />}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[9999] min-h-screen bg-[#05070d]/95 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 font-sans antialiased text-slate-100 select-none overflow-y-auto overscroll-contain modal-backdrop-contain">

      {/* Violet ambient glows matching site hero */}
      <div className="fixed -top-60 -left-40 w-[520px] h-[520px] bg-violet-600/[0.12] rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed top-1/2 -right-32 w-[400px] h-[400px] bg-indigo-600/[0.08] rounded-full blur-[110px] pointer-events-none" />
      <div className="fixed bottom-0 left-1/4 w-[340px] h-[340px] bg-violet-700/[0.07] rounded-full blur-[100px] pointer-events-none" />

      {/* Main Card */}
      <div className="relative w-full max-w-[460px] bg-[#0b0d14]/95 border border-white/[0.08] hover:border-violet-500/30 rounded-3xl sm:rounded-[28px] p-4 xs:p-5 sm:p-8 shadow-[0_28px_80px_rgba(0,0,0,0.85),0_0_50px_rgba(139,92,246,0.12)] z-10 transition-all duration-300">

        {canDismiss && onClose && (
          <button type="button" onClick={onClose} aria-label="Close onboarding"
            className="absolute top-5 right-5 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Progress pills — violet */}
        <div className="flex items-center justify-center gap-2 mb-7">
          {Array.from({ length: totalSteps }).map((_, idx) => {
            const stepNum = idx + 1;
            const isActive = stepNum === currentStep;
            const isPassed = stepNum < currentStep;
            return (
              <div key={stepNum} className={`h-1 rounded-full transition-all duration-500 ease-out ${
                isActive ? 'w-10 bg-violet-500 shadow-[0_0_14px_rgba(139,92,246,0.7)]'
                  : isPassed ? 'w-8 bg-violet-700/60'
                  : 'w-8 bg-white/[0.07]'
              }`} />
            );
          })}
        </div>

        {/* Brand icon badge */}
        <div className="flex justify-center mb-5">
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center bg-slate-900/90 border border-violet-500/35 shadow-[0_0_30px_rgba(125,51,255,0.5)]">
            <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1.5" fill="#8b5cf6" opacity="0.9" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" fill="#8b5cf6" opacity="0.6" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" fill="#8b5cf6" opacity="0.6" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" fill="#8b5cf6" opacity="0.85" />
            </svg>
          </div>
        </div>

        {/* Step label pill */}
        <div className="flex justify-center mb-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-violet-300">
            Step {currentStep} of {totalSteps} &middot; {stepMeta[currentStep - 1].label}
          </span>
        </div>

        {/* Title & Subtitle */}
        <div className="text-center mb-6">
          <h2 className="text-xl sm:text-[22px] font-bold text-white tracking-tight">
            {currentStep === 1 && 'Choose experience level'}
            {currentStep === 2 && 'Choose trading style'}
            {currentStep === 3 && 'Choose target markets'}
          </h2>
          <p className="text-xs text-slate-400 mt-1.5 max-w-[290px] mx-auto leading-relaxed">
            {currentStep === 1 && 'What stage of your trading journey are you currently in?'}
            {currentStep === 2 && 'What type of execution strategy do you have in mind?'}
            {currentStep === 3 && 'Which markets do you actively journal & track?'}
          </p>
        </div>

        {/* Option rows */}
        <div className="space-y-2.5 mb-7">
          {currentStep === 1 && experienceOptions.map((opt) => (
            <OptionRow key={opt.id} {...opt} isSelected={obExperience === opt.id} onClick={() => setObExperience(opt.id)} />
          ))}
          {currentStep === 2 && styleOptions.map((opt) => (
            <OptionRow key={opt.id} {...opt} isSelected={obStyle === opt.id} onClick={() => setObStyle(opt.id)} />
          ))}
          {currentStep === 3 && marketOptions.map((opt) => (
            <OptionRow
              key={opt.id} {...opt}
              isSelected={obMarkets.includes(opt.id)}
              onClick={() => {
                if (obMarkets.includes(opt.id)) {
                  if (obMarkets.length > 1) setObMarkets(obMarkets.filter((m) => m !== opt.id));
                } else {
                  setObMarkets([...obMarkets, opt.id]);
                }
              }}
            />
          ))}
        </div>

        {/* Bottom actions */}
        <div className="flex items-center justify-between pt-1">
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
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { if (canDismiss && onClose) onClose(); else onSubmit(); }}
              className="px-4 py-2 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-semibold text-slate-400 hover:text-white transition cursor-pointer"
            >
              Skip
            </button>

            {currentStep < 3 ? (
              <button
                type="button"
                onClick={() => handleSetStep(currentStep + 1)}
                className="px-5 py-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-[0_0_20px_rgba(139,92,246,0.45)] transition-all cursor-pointer"
              >
                Continue <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
              </button>
            ) : (
              <button
                type="button"
                disabled={actionLoading || obMarkets.length === 0}
                onClick={onSubmit}
                className="px-5 py-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-[0_0_24px_rgba(139,92,246,0.5)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /><span>Launching...</span></>
                ) : (
                  <><span>Launch Dashboard</span><Check className="w-3.5 h-3.5 stroke-[2.5]" /></>
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

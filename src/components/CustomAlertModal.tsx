import { Sparkles, AlertTriangle, CheckCircle2, Info, X, Crown, Check } from 'lucide-react';

export interface CustomAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  type?: 'pro' | 'error' | 'success' | 'info' | 'warning';
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export default function CustomAlertModal({
  isOpen,
  onClose,
  title,
  message,
  type = 'info',
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}: CustomAlertModalProps) {
  if (!isOpen) return null;

  const isPro = type === 'pro' || /pro|upgrade|plan is limited|limit/i.test(title || '') || /pro|upgrade|plan is limited/i.test(message);

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
    onClose();
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-[#0d1322] border border-slate-800 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)] p-6 sm:p-7 text-white"
        role="dialog"
        aria-modal="true"
      >
        {/* Top ambient glow */}
        {isPro ? (
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-32 bg-gradient-to-b from-violet-600/40 via-amber-500/20 to-transparent blur-3xl pointer-events-none" />
        ) : type === 'error' ? (
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-32 bg-rose-500/20 blur-3xl pointer-events-none" />
        ) : type === 'success' ? (
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-32 bg-emerald-500/20 blur-3xl pointer-events-none" />
        ) : (
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-32 bg-indigo-500/20 blur-3xl pointer-events-none" />
        )}

        {/* Close Button */}
        <button
          onClick={handleCancel}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition z-10"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Icon & Header */}
        <div className="flex items-start gap-4 mb-4 relative z-10">
          <div className="shrink-0">
            {isPro ? (
              <div className="p-3 rounded-2xl bg-gradient-to-br from-violet-500/25 to-amber-500/20 border border-violet-500/40 text-amber-300 shadow-lg shadow-violet-900/30">
                <Crown className="h-6 w-6 text-amber-300 fill-amber-300" />
              </div>
            ) : type === 'error' ? (
              <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400">
                <AlertTriangle className="h-6 w-6" />
              </div>
            ) : type === 'success' ? (
              <div className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
            ) : (
              <div className="p-3 rounded-2xl bg-violet-500/15 border border-violet-500/30 text-violet-400">
                <Info className="h-6 w-6" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            <h3 className="text-base sm:text-lg font-bold text-white tracking-tight font-display">
              {title || (isPro ? 'Upgrade to Pro' : type === 'error' ? 'Attention Needed' : 'Notice')}
            </h3>
            {isPro && (
              <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-300 bg-amber-400/10 border border-amber-400/25 px-2 py-0.5 rounded-full">
                <Sparkles className="h-2.5 w-2.5 fill-amber-300" /> Pro Tier Feature
              </span>
            )}
          </div>
        </div>

        {/* Message body */}
        <div className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-5 relative z-10">
          {message}
        </div>

        {/* Pro Benefits preview if Pro Gate */}
        {isPro && (
          <div className="mb-6 p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] relative z-10 space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Pro includes:
            </div>
            <div className="grid gap-1.5 text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>Unlimited broker & prop firm accounts</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>Real-time MetaTrader 5 automatic sync</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>AI Trade Mentor on your actual trade history</span>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-2.5 relative z-10">
          {isPro ? (
            <>
              <button
                type="button"
                onClick={handleConfirm}
                className="w-full sm:flex-1 py-3 px-4 rounded-xl font-bold text-xs sm:text-sm text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 shadow-lg shadow-violet-600/30 transition flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
              >
                <Sparkles className="h-4 w-4 text-amber-300 fill-amber-300" />
                {confirmText || 'Upgrade to Pro — ₹499/mo'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="w-full sm:w-auto py-2.5 px-4 rounded-xl font-semibold text-xs text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] transition cursor-pointer"
              >
                {cancelText || 'Maybe Later'}
              </button>
            </>
          ) : cancelText ? (
            <>
              <button
                type="button"
                onClick={handleConfirm}
                className={`w-full sm:flex-1 py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm text-white transition cursor-pointer active:scale-[0.98] ${
                  type === 'warning' || type === 'error'
                    ? 'bg-rose-600 hover:bg-rose-500 shadow-md shadow-rose-600/30'
                    : 'bg-violet-600 hover:bg-violet-500 shadow-md'
                }`}
              >
                {confirmText || 'Confirm'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="w-full sm:w-auto py-2.5 px-4 rounded-xl font-semibold text-xs text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] transition cursor-pointer"
              >
                {cancelText}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleConfirm}
              className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm text-white transition cursor-pointer active:scale-[0.98] ${
                type === 'error'
                  ? 'bg-rose-600 hover:bg-rose-500'
                  : type === 'success'
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-violet-600 hover:bg-violet-500'
              }`}
            >
              {confirmText || 'Got it'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import {
  ShieldAlert, ShieldCheck, X, CheckCircle2, AlertTriangle, KeyRound,
  ExternalLink, ArrowRight
} from 'lucide-react';

interface Mt5SecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmUseInvestor?: () => void;
}

export default function Mt5SecurityModal({
  isOpen,
  onClose,
  onConfirmUseInvestor
}: Mt5SecurityModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="dx-panel relative max-w-xl w-full p-5 sm:p-7 rounded-2xl sm:rounded-3xl shadow-2xl border border-amber-500/30 bg-slate-900 text-slate-100 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Glow accent */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="flex items-start gap-3.5 mb-5">
          <div className="p-3 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Security Advisory
              </span>
              <span className="text-xs text-slate-400">Account Safety First</span>
            </div>
            <h2 className="text-lg sm:text-xl font-black text-white mt-1">
              Why You Should Use Your MT5 Investor Password
            </h2>
          </div>
        </div>

        {/* Comparison Cards: Master Password vs Investor Password */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          {/* Master Password - Risk */}
          <div className="p-4 rounded-xl bg-rose-500/5 border border-rose-500/20 space-y-2">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider">Master Password</span>
            </div>
            <p className="text-[11.5px] text-slate-300 leading-relaxed">
              Provides <strong className="text-rose-300">full execution authority</strong>. Allows placing, modifying, or closing trades, and accessing account actions.
            </p>
            <div className="text-[10.5px] text-rose-300/80 font-medium pt-1 border-t border-rose-500/15">
              ⚠️ Sharing exposes live capital to risk.
            </div>
          </div>

          {/* Investor Password - Safe */}
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
            <div className="flex items-center gap-2 text-emerald-400">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider">Investor Password</span>
            </div>
            <p className="text-[11.5px] text-slate-200 leading-relaxed">
              Provides <strong className="text-emerald-300">strictly read-only access</strong>. FxJournal Pro can analyze and sync trades without ANY ability to trade or move funds.
            </p>
            <div className="text-[10.5px] text-emerald-300 font-semibold pt-1 border-t border-emerald-500/20 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> 100% safe &amp; recommended by brokers.
            </div>
          </div>
        </div>

        {/* Step-by-Step Instructions */}
        <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 mb-6 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <KeyRound className="h-3.5 w-3.5 text-violet-400" />
            <span>How to set or find your Investor Password in MT5:</span>
          </div>

          <ol className="text-xs text-slate-300 space-y-1.5 list-decimal list-inside pl-1 leading-relaxed">
            <li>Open MetaTrader 5 on your desktop or mobile app.</li>
            <li>Go to <strong className="text-white">Tools → Options</strong> (or Settings on mobile) and select the <strong className="text-white">Server</strong> tab.</li>
            <li>Click the <strong className="text-white">Change</strong> button next to Password.</li>
            <li>Select <strong className="text-emerald-300">"Change investor (read-only) password"</strong>.</li>
            <li>Enter your current master password, set a new read-only password, and enter that here!</li>
          </ol>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (onConfirmUseInvestor) onConfirmUseInvestor();
              onClose();
            }}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white transition flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-violet-600/25"
          >
            <span>I Understand, Use Investor Password</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

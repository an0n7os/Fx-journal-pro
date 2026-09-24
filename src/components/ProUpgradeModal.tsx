import React, { useState, useEffect } from 'react';
import {
  X, Check, Star, ShieldCheck, CreditCard, Sparkles,
  Loader2, ArrowRight, Zap, RefreshCw, AlertCircle, CheckCircle2, Ticket
} from 'lucide-react';
import { User } from '../types';

interface ProUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onSuccess: () => Promise<void> | void;
}

/**
 * Developer bypass: a button that flips this account between Free and Pro
 * without paying, so the paid product can be exercised locally.
 *
 * Vite substitutes `import.meta.env.DEV` with the literal `false` when
 * building for production, so every block behind this constant is dead code
 * the bundler removes — the button, its handler and the endpoint string do
 * not exist in the shipped bundle at all, rather than being hidden in it.
 *
 * The server refuses /api/payments/toggle-test-tier unless it was started
 * with ALLOW_TEST_BILLING=true and NODE_ENV is not production, so both halves
 * have to be switched on for the bypass to work.
 */
const DEV_BYPASS = import.meta.env.DEV;

/**
 * The six things Free does not get, in the same order as the server's
 * entitlement table. Analysis, Calendar, FX News and Tools are deliberately
 * absent: they are free, and listing them as Pro benefits is padding.
 *
 * Each label is kept short enough to sit on one line inside a column of this
 * grid. That is a layout constraint, not a style preference — "Live Chart with
 * your trades plotted" wrapped to two lines, which made its grid row taller
 * than the row beside it and knocked the whole two-column list out of
 * alignment. Anything much longer than these will do it again.
 */
/*
 * "WhatsApp news alerts" is deliberately absent.
 *
 * Nothing sends them. /api/reminders/whatsapp stores a reminder in a
 * module-level array — wiped on every deploy, and on a serverless platform
 * between invocations — and there is no sender, no cron and no provider
 * anywhere in the codebase; the endpoint's own comment says so. Listing it
 * here charged ₹499 for something that could never arrive. It goes back in the
 * moment a sender exists.
 */
const PRO_BENEFITS = [
  'Unlimited portfolios',
  'MT5 auto-sync & cloud',
  'AI Mentor on your trades',
  'Live Chart with markers',
  'Excel & PDF reports',
  'Economic calendar & FX news',
];

/** Shown as chips so the long list of methods stops crowding a table row. */
const PAY_METHODS = ['UPI', 'GPay', 'PhonePe', 'Paytm', 'Cards', 'NetBanking'];

export default function ProUpgradeModal({
  isOpen,
  onClose,
  user,
  authFetch,
  onSuccess,
}: ProUpgradeModalProps) {
  const [activeTab, setActiveTab] = useState<'gateway' | 'test'>('gateway');
  const [loading, setLoading] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [config, setConfig] = useState<{
    configured: boolean;
    testBilling: boolean;
    sandboxMode: boolean;
    keyId: string;
    amountRupees: number;
    merchantName: string;
  }>({
    configured: false,
    testBilling: false,
    sandboxMode: false,
    keyId: 'rzp_test_sandbox_mode',
    amountRupees: 499,
    merchantName: 'FX Journal Pro'
  });

  const [couponInput, setCouponInput] = useState(() => {
    try { return sessionStorage.getItem('fx_referral_code') || ''; } catch { return ''; }
  });
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    partnerName: string;
    standardPrice: number;
    offerPrice: number;
    discountPercent: number;
    discountAmount: number;
    mentorCommission: number;
  } | null>(null);
  const [couponValidating, setCouponValidating] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);

  const handleApplyCoupon = async (codeToTest?: string) => {
    const code = (codeToTest || couponInput).trim().toUpperCase();
    if (!code) return;
    setCouponValidating(true);
    setCouponError(null);
    try {
      const res = await fetch(`/api/referral/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (res.ok && data?.valid) {
        setAppliedCoupon({
          code: data.code,
          partnerName: data.partnerName,
          standardPrice: data.standardPrice || 499,
          offerPrice: data.offerPrice !== undefined ? data.offerPrice : (data.finalPrice || 499),
          discountPercent: data.discountPercent || 0,
          discountAmount: data.discountAmount || 0,
          mentorCommission: data.mentorCommission || 0
        });
        setCouponError(null);
      } else {
        setCouponError(data?.error || 'That coupon code is not recognised.');
        setAppliedCoupon(null);
      }
    } catch {
      setCouponError('Could not validate coupon code.');
      setAppliedCoupon(null);
    } finally {
      setCouponValidating(false);
    }
  };

  // Auto-apply referral code if stored in sessionStorage from referral link
  useEffect(() => {
    if (!isOpen) return;
    try {
      const savedCode = sessionStorage.getItem('fx_referral_code');
      if (savedCode && !appliedCoupon) {
        handleApplyCoupon(savedCode);
      }
    } catch {}
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setStatusMessage(null);
      setConfigLoaded(false);
      return;
    }
    fetch('/api/payments/config')
      .then(res => res.json())
      .then(data => {
        if (data) setConfig(prev => ({ ...prev, ...data }));
      })
      .catch(console.error)
      // Either way the answer is in: a failed lookup must not leave the button
      // disabled forever with no explanation.
      .finally(() => setConfigLoaded(true));
  }, [isOpen]);

  // Escape closes the dialog, like every other modal in the app.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const amountRupees = config.amountRupees || 499;

  const handleTestModeToggle = async (targetTier: 'pro' | 'free') => {
    if (!DEV_BYPASS) return;
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await authFetch('/api/payments/toggle-test-tier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: targetTier })
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMessage({ type: 'success', text: data.message || 'Plan state updated!' });
        await onSuccess();
        setTimeout(() => onClose(), 1200);
      } else {
        setStatusMessage({ type: 'error', text: data.error || 'Failed to update plan.' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Could not reach server.' });
    } finally {
      setLoading(false);
    }
  };

  const handleGatewayCheckout = async () => {
    setLoading(true);
    setStatusMessage(null);

    try {
      const createRes = await authFetch('/api/payments/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ couponCode: appliedCoupon?.code || undefined })
      });
      const data = await createRes.json();
      if (!createRes.ok) {
        throw new Error(data?.error || 'Could not create payment order');
      }

      // If test billing is enabled and returned sandbox mode
      if (data.sandboxMode) {
        const verifyRes = await authFetch('/api/payments/toggle-test-tier', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tier: 'pro' })
        });
        if (verifyRes.ok) {
          setStatusMessage({
            type: 'success',
            text: appliedCoupon 
              ? `Mentor offer applied! You paid ₹${appliedCoupon.offerPrice}. Pro activated.`
              : 'Payment simulated! 30 days Pro active.'
          });
          await onSuccess();
          setTimeout(() => onClose(), 1500);
          return;
        }
      }

      if (typeof (window as any).Razorpay === 'undefined') {
        await new Promise<boolean>((resolve) => {
          const existing = document.querySelector('script[src*="checkout.razorpay.com"]');
          if (existing) {
            existing.addEventListener('load', () => resolve(true));
            existing.addEventListener('error', () => resolve(false));
            // In case it finished loading between checks
            if ((window as any).Razorpay) return resolve(true);
            return;
          }
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.async = true;
          script.onload = () => resolve(true);
          script.onerror = () => resolve(false);
          document.body.appendChild(script);
        });
      }

      if (typeof (window as any).Razorpay === 'undefined') {
        throw new Error('Razorpay SDK failed to load. Please check your internet connection and try again.');
      }

      const rzp = new (window as any).Razorpay({
        key: data.keyId,
        amount: data.amount,
        currency: data.currency || 'INR',
        order_id: data.orderId,
        name: 'FX Journal Pro',
        description: appliedCoupon ? `Pro Access (30 Days) — ₹${appliedCoupon.offerPrice} (Mentor Offer Applied)` : `Pro Access (30 Days) — ₹${amountRupees}`,
        prefill: { email: user?.email, name: user?.name },
        theme: { color: '#8b5cf6' },
        config: {
          display: {
            blocks: {
              upi: {
                name: 'Pay using UPI / QR',
                instruments: [
                  { method: 'upi' }
                ]
              }
            },
            sequence: ['block.upi', 'block.default'],
            preferences: {
              show_default_blocks: true
            }
          }
        },
        handler: async (response: any) => {
          setLoading(true);
          try {
            const verify = await authFetch('/api/payments/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(response),
            });
            const result = await verify.json().catch(() => ({}));
            if (verify.ok && result?.success) {
              setStatusMessage({ type: 'success', text: result?.message || 'Payment confirmed! Welcome to Pro.' });
              await onSuccess();
              setTimeout(() => onClose(), 1500);
            } else {
              setStatusMessage({ type: 'error', text: result?.error || 'Payment verification failed.' });
            }
          } catch (err: any) {
            setStatusMessage({ type: 'error', text: err?.message || 'Verification request failed.' });
          } finally {
            setLoading(false);
          }
        },
        modal: {
          ondismiss: () => setLoading(false),
        },
      });
      rzp.open();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Error opening checkout.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    // z-[70] because the mobile bottom nav is z-[60] and was floating over
    // the pay button.
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-[#07080c]/85 backdrop-blur-md animate-fade-in overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pro-upgrade-title"
    >
      <div
        className="relative w-full max-w-lg bg-[#0b0d13] border border-white/[0.07] rounded-2xl shadow-[0_40px_90px_-40px_rgba(0,0,0,0.9)] overflow-hidden my-6 text-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* One accent hairline in the product's violet. The previous
            violet/fuchsia/indigo bar was the only rainbow in the app. */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-violet-500/70 to-transparent" />
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-72 h-72 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />

        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-20 p-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="px-7 pt-7 pb-6 relative z-10">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/25 text-violet-300 text-[10px] font-bold uppercase tracking-[0.14em] mb-4">
            <Sparkles className="h-3 w-3" />
            Pro plan
          </div>

          <h2 id="pro-upgrade-title" className="text-2xl sm:text-[28px] leading-tight font-black text-white font-display tracking-tight">
            Everything in FX Journal Pro
          </h2>
          <p className="text-[13px] text-slate-400 mt-2 max-w-sm leading-relaxed">
            Automatic MT5 sync, an AI mentor that reads your own trade history,
            and as many accounts as you trade.
          </p>

          {/* The price belongs with the decision, not buried in the payment card */}
          {/* The period and the USD note are one span, not two flex children:
              split, they wrapped separately on a phone and left a line
              beginning with a bare "·". */}
          {/* The price belongs with the decision, not buried in the payment card */}
          {/* The period and the USD note are one span, not two flex children:
              split, they wrapped separately on a phone and left a line
              beginning with a bare "·". */}
          <div className="flex items-baseline flex-wrap gap-x-2.5 gap-y-1 mt-5">
            {appliedCoupon && appliedCoupon.offerPrice < 499 ? (
              <>
                <span className="text-4xl font-black text-emerald-400 font-display tracking-tight tabular-nums">₹{appliedCoupon.offerPrice}</span>
                <span className="text-xl font-bold line-through text-slate-500 tabular-nums">₹499</span>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Save ₹{appliedCoupon.discountAmount} ({appliedCoupon.discountPercent}% OFF)
                </span>
              </>
            ) : appliedCoupon ? (
              <>
                <span className="text-4xl font-black text-white font-display tracking-tight tabular-nums">₹499</span>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Mentor Code Applied
                </span>
              </>
            ) : (
              <span className="text-4xl font-black text-white font-display tracking-tight tabular-nums">₹{amountRupees}</span>
            )}
            <span className="text-sm text-slate-400">
              / 30 days access <span className="text-xs text-slate-600">· about $4.90</span>
            </span>
          </div>
        </div>

        {/* Benefits.
            items-center rather than items-start: with single-line labels the
            tick reads as centred on its text, and there is no longer a first
            line to align it to. */}
        <div className="px-7 py-5 border-y border-white/[0.06] bg-white/[0.015] grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
          {PRO_BENEFITS.map((benefit) => (
            <div key={benefit} className="flex items-center gap-2.5 text-[12.5px] text-slate-300">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-500/15 border border-violet-500/25">
                <Check className="h-2.5 w-2.5 text-violet-300" strokeWidth={3} />
              </span>
              <span className="leading-none">{benefit}</span>
            </div>
          ))}
        </div>

        <div className="px-7 py-6 space-y-5 relative z-10">
          {statusMessage && (
            <div className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 border ${statusMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
              }`}>
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-px text-emerald-400" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 mt-px text-rose-400" />
              )}
              <span className="leading-relaxed">{statusMessage.text}</span>
            </div>
          )}

          {/* A one-item tab strip is not a choice, and it read as a second
              primary button. The switcher appears only when the bypass exists,
              which is a development build with the server flag on. */}
          {DEV_BYPASS && config.testBilling && (
            <div className="flex rounded-xl bg-white/[0.03] p-1 border border-white/[0.06]">
              {([
                { id: 'gateway', label: 'Pay with Razorpay', icon: CreditCard },
                { id: 'test', label: 'Test Mode', icon: Zap },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-[11px] font-bold rounded-lg transition ${activeTab === t.id
                      ? 'bg-violet-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                    }`}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'gateway' && (
            <div className="space-y-4">
              {/* Mentor Coupon / Discount Section */}
              <div className="rounded-xl border border-white/[0.08] bg-slate-900/60 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Ticket className="h-3.5 w-3.5 text-amber-400" />
                    <span>Mentor Coupon Code</span>
                  </div>
                  {appliedCoupon && (
                    <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      {appliedCoupon.discountAmount > 0 ? `Offer Applied: Save ₹${appliedCoupon.discountAmount}` : 'Mentor Code Applied'}
                    </span>
                  )}
                </div>

                {appliedCoupon ? (
                  <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-emerald-300 tracking-wider uppercase">{appliedCoupon.code}</span>
                      <span className="text-[11px] text-slate-400">({appliedCoupon.partnerName})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setAppliedCoupon(null); setCouponInput(''); }}
                      className="text-[11px] text-slate-400 hover:text-rose-400 underline transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={couponInput}
                        onChange={(e) => {
                          setCouponInput(e.target.value.toUpperCase());
                          setCouponError(null);
                        }}
                        placeholder="Enter mentor coupon code (e.g. VIP60)"
                        className="flex-1 bg-slate-950/80 border border-slate-700/80 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 uppercase tracking-wide"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleApplyCoupon();
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleApplyCoupon()}
                        disabled={couponValidating || !couponInput.trim()}
                        className="px-3.5 py-2 bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed border border-white/[0.1] rounded-lg text-xs font-semibold text-white transition flex items-center gap-1.5"
                      >
                        {couponValidating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Apply'}
                      </button>
                    </div>
                    {couponError && (
                      <p className="text-[11px] text-rose-400 flex items-center gap-1 mt-1">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        {couponError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Payment methods as chips */}
              <div className="rounded-xl border border-white/[0.06] px-4 py-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Pay with</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {PAY_METHODS.map((m) => (
                    <span
                      key={m}
                      className="rounded-md bg-white/[0.04] border border-white/[0.07] px-2 py-1 text-[11px] font-semibold text-slate-300"
                    >
                      {m}
                    </span>
                  ))}
                </div>
                <p className="mt-3 pt-3 border-t border-white/[0.05] text-[11.5px] text-slate-400">
                  One-time payment · 30 days of Pro · no auto-renewal
                </p>
              </div>

              {configLoaded && !config.configured && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-px" />
                  <p className="text-[11.5px] leading-relaxed text-amber-200">
                    Payments are not switched on yet. Nothing will be charged — please try again shortly.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={handleGatewayCheckout}
                disabled={loading || (configLoaded && !config.configured)}
                className="w-full bg-violet-600 hover:bg-violet-500 active:translate-y-px text-white font-bold text-sm py-3.5 px-6 rounded-xl transition shadow-lg shadow-violet-950/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Opening checkout…
                  </>
                ) : (
                  <>
                    {appliedCoupon && appliedCoupon.offerPrice < 499 ? (
                      <>
                        Pay <span className="line-through opacity-60 font-normal mr-1">₹499</span> ₹{appliedCoupon.offerPrice} for Pro
                      </>
                    ) : (
                      <>Pay ₹{amountRupees} for Pro</>
                    )}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          )}

          {DEV_BYPASS && activeTab === 'test' && config.testBilling && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-amber-500/[0.07] border border-amber-500/20 flex items-start gap-3">
                <Zap className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-xs text-amber-200">Developer bypass — skips the ₹{amountRupees} payment</h3>
                  <p className="text-[11px] text-amber-300/75 mt-1 leading-relaxed">
                    Flips this account's plan with no money taken, so you can use Pro
                    while building. Only in a dev build with ALLOW_TEST_BILLING=true;
                    <code className="mx-1 px-1 rounded bg-amber-500/10">npm run build</code>
                    drops this whole panel from the bundle.
                  </p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleTestModeToggle('pro')}
                  disabled={loading}
                  className="p-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  <Star className="h-4 w-4" />
                  Unlock Pro free
                </button>
                <button
                  type="button"
                  onClick={() => handleTestModeToggle('free')}
                  disabled={loading}
                  className="p-3.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 font-bold text-xs flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4 text-slate-400" />
                  Back to Free
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 py-4 bg-black/30 border-t border-white/[0.06] flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/80 shrink-0" />
            Payment handled by Razorpay — we never see your card
          </span>
          {/* Matches the refund policy in Legal: 7 days, if Pro does not work
              as described. "100% money-back satisfaction" promised more. */}
          <span className="sm:ml-auto">7-day refund if Pro doesn't work as described</span>
        </div>
      </div>
    </div>
  );
}

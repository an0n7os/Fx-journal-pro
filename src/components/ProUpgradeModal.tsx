import { useState, useEffect } from 'react';
import {
  X, Check, Star, ShieldCheck, CreditCard, Sparkles,
  Loader2, ArrowRight, Zap, RefreshCw, AlertCircle, CheckCircle2, Ticket,
  Bot, Layers, BarChart3, Download, Share2, BookOpen, Bell
} from 'lucide-react';
import { User } from '../types';
import { useScrollLock } from '../lib/useScrollLock';

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
interface ProFeature {
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  bgColor: string;
  borderColor: string;
}

const PRO_FEATURES: ProFeature[] = [
  {
    title: 'Unlimited Accounts',
    desc: 'Prop firms & personal brokers',
    icon: Layers,
    iconColor: 'text-indigo-400',
    bgColor: 'bg-indigo-500/10',
    borderColor: 'border-indigo-500/20',
  },
  {
    title: 'MT5 Cloud Auto-Sync',
    desc: 'Instant auto trade imports',
    icon: RefreshCw,
    iconColor: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
  },
  {
    title: 'HEYZA — AI Mentor',
    desc: 'Psychology & execution audit',
    icon: Bot,
    iconColor: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/20',
  },
  {
    title: 'Historical Trade Export',
    desc: 'One-click CSV & Excel logs',
    icon: Download,
    iconColor: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/20',
  },
  {
    title: 'Live TradingView Charts',
    desc: 'Executions plotted on candles',
    icon: BarChart3,
    iconColor: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
  },
  {
    title: 'Share Trade Insights',
    desc: 'Verified public setup cards',
    icon: Share2,
    iconColor: 'text-pink-400',
    bgColor: 'bg-pink-500/10',
    borderColor: 'border-pink-500/20',
  },
  {
    title: 'Trader Notebook',
    desc: 'Mindset & rule tracking',
    icon: BookOpen,
    iconColor: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/20',
  },
  {
    title: 'Economic News Alerts',
    desc: 'High-impact event warnings',
    icon: Bell,
    iconColor: 'text-rose-400',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/20',
  },
];

/** Shown as chips so the long list of methods stops crowding a table row. */
const PAY_METHODS = ['UPI', 'GPay', 'PhonePe', 'Paytm', 'Cards', 'NetBanking'];

const RAZORPAY_SDK_URL = 'https://checkout.razorpay.com/v1/checkout.js';

/**
 * Makes sure the Razorpay checkout SDK is on the page.
 */
const loadRazorpaySdk = (): Promise<boolean> =>
  new Promise((resolve) => {
    if (typeof (window as any).Razorpay === 'function') return resolve(true);
    const existing = document.querySelector<HTMLScriptElement>(`script[src*="checkout.razorpay.com"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      if (typeof (window as any).Razorpay === 'function') resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = RAZORPAY_SDK_URL;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

export default function ProUpgradeModal({
  isOpen,
  onClose,
  user,
  authFetch,
  onSuccess,
}: ProUpgradeModalProps) {
  // Prevent background scrolling when modal is open
  useScrollLock(isOpen);

  const [activeTab, setActiveTab] = useState<'gateway' | 'test'>('gateway');
  const [loading, setLoading] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [config, setConfig] = useState<{
    configured: boolean;
    testBilling: boolean;
    sandboxMode: boolean;
    keyId?: string;
    mode?: string;
    amountRupees: number;
    merchantName: string;
  }>({
    configured: false,
    testBilling: false,
    sandboxMode: false,
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
    } catch { }
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

      if (!data.orderId || !data.keyId) {
        throw new Error('Payments are not configured yet. Please try again shortly.');
      }

      await loadRazorpaySdk();
      if (typeof (window as any).Razorpay !== 'function') {
        throw new Error('Payment SDK failed to load. Please check your internet connection and try again.');
      }

      const rzp = new (window as any).Razorpay({
        key: data.keyId,
        amount: data.amount,
        currency: data.currency || 'INR',
        order_id: data.orderId,
        name: 'FX Journal Pro',
        description: appliedCoupon
          ? `Pro Access (30 Days) — ₹${appliedCoupon.offerPrice} (Mentor Offer Applied)`
          : `Pro Access (30 Days) — ₹${amountRupees}`,
        prefill: {
          name: user?.name || undefined,
          email: user?.email || undefined,
        },
        theme: {
          color: '#7c3aed',
          backdrop_color: '#0c0e15',
        },
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
        modal: {
          backdropclose: true,
          ondismiss: () => {
            setLoading(false);
          },
        },
        handler: async (response: any) => {
          setLoading(true);
          try {
            const verify = await authFetch('/api/payments/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(response),
            });
            const verified = await verify.json().catch(() => ({}));
            if (verify.ok && verified?.success) {
              setStatusMessage({ type: 'success', text: verified?.message || 'Payment confirmed! Welcome to Pro.' });
              await onSuccess();
              setTimeout(() => onClose(), 1500);
            } else if (verified?.pending) {
              setStatusMessage({ type: 'info', text: verified.message || 'Payment is being confirmed. Pro unlocks shortly.' });
            } else {
              setStatusMessage({ type: 'error', text: verified?.error || 'Payment verification failed.' });
            }
          } catch (err: any) {
            setStatusMessage({ type: 'error', text: err?.message || 'Verification request failed.' });
          } finally {
            setLoading(false);
          }
        },
      });

      rzp.on('payment.failed', function (resp: any) {
        setLoading(false);
        setStatusMessage({
          type: 'error',
          text: resp?.error?.description || 'Payment was cancelled or failed.',
        });
      });

      rzp.open();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Error opening checkout.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-xl animate-fade-in overflow-y-auto overscroll-contain modal-backdrop-contain"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pro-upgrade-title"
    >
      <div
        className="relative w-full max-w-md lg:max-w-5xl bg-[#0c0e15]/95 border border-white/[0.08] rounded-2xl sm:rounded-3xl shadow-[0_32px_80px_-20px_rgba(0,0,0,0.95)] max-h-[92vh] sm:max-h-none overflow-y-auto my-auto text-slate-200 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >

        {/* Top subtle hairline glow & ambient background light */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" />
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-48 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-1/4 -left-12 w-60 h-60 bg-violet-600/[0.08] rounded-full blur-3xl pointer-events-none" />

        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 sm:right-5 sm:top-5 z-30 h-8 w-8 rounded-full text-slate-400 hover:text-white bg-white/[0.08] hover:bg-slate-800 border border-white/10 active:scale-95 flex items-center justify-center transition-all duration-150 shadow-md cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.88fr)] lg:items-stretch">
          {/* Left on desktop / Top on mobile: The Plan Offer */}
          <div className="lg:border-r lg:border-white/[0.07] px-5 sm:px-8 pt-5 pb-3 sm:py-8 flex flex-col justify-between h-full">
            <div>
              {/* Sleek Minimal Pill Badge */}
              <div className="inline-flex self-start items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-violet-500/10 text-violet-300 text-[10.5px] sm:text-[11px] font-medium tracking-wide mb-2 sm:mb-2.5">
                <Sparkles className="h-3 w-3 text-violet-400" />
                <span>Unlock Pro Access</span>
              </div>

              <h2 id="pro-upgrade-title" className="text-xl sm:text-2xl lg:text-3xl font-bold text-white font-display tracking-tight leading-snug">
                Trade with an Unfair Edge
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 leading-relaxed max-w-sm">
                Automate your trade journaling, eliminate emotional pitfalls with AI mentor, and connect all your prop & live accounts.
              </p>

              {/* Clean Minimal Price Display */}
              <div className="flex items-baseline flex-wrap gap-x-2 gap-y-0.5 mt-2.5 sm:mt-4 pt-1">
                {appliedCoupon && appliedCoupon.offerPrice < 499 ? (
                  <>
                    <span className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-emerald-400 font-display tracking-tight tabular-nums">
                      ₹{appliedCoupon.offerPrice}
                    </span>
                    <span className="text-sm sm:text-base lg:text-lg font-semibold line-through text-slate-500 tabular-nums">
                      ₹499
                    </span>
                    <span className="text-[10px] sm:text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                      Save ₹{appliedCoupon.discountAmount} ({appliedCoupon.discountPercent}% OFF)
                    </span>
                  </>
                ) : appliedCoupon ? (
                  <>
                    <span className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white font-display tracking-tight tabular-nums">
                      ₹499
                    </span>
                    <span className="text-[10px] sm:text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/25">
                      Mentor Code Applied
                    </span>
                  </>
                ) : (
                  <span className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white font-display tracking-tight tabular-nums">
                    ₹{amountRupees}
                  </span>
                )}
                <span className="text-xs sm:text-sm text-slate-400">
                  / 30 days <span className="text-[10.5px] sm:text-[11px] text-slate-500">· about ₹16/day</span>
                </span>
              </div>

              {/* Clean, Breathable Minimal Feature Grid */}
              <div className="mt-3.5 sm:mt-5 grid grid-cols-2 gap-x-3 sm:gap-x-6 gap-y-2 sm:gap-y-3">
                {PRO_FEATURES.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="flex items-start gap-2">
                      <Icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 mt-0.5 ${item.iconColor}`} />
                      <div className="min-w-0">
                        <div className="text-[11.5px] sm:text-xs font-medium text-slate-200 leading-snug">
                          {item.title}
                        </div>
                        <div className="text-[10px] sm:text-[11px] text-slate-400 leading-tight hidden sm:block">
                          {item.desc}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Minimal Footnote Notice */}
            <div className="mt-3.5 sm:mt-5 pt-2.5 sm:pt-3 border-t border-white/[0.04] flex items-center gap-1.5 sm:gap-2 text-[10.5px] sm:text-[11px] text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>30-day software access · No recurring auto-debit · Instant activation</span>
            </div>
          </div>

          {/* Right on desktop / Bottom on mobile: Checkout & Actions */}
          <div className="px-5 sm:px-8 pt-3 sm:pt-8 pb-5 sm:pb-8 border-t border-white/[0.07] lg:border-t-0 flex flex-col justify-between h-full relative z-10 w-full">
            <div className="w-full max-w-sm mx-auto space-y-3 sm:space-y-4">
              {/* Order Summary Header - Desktop Only to avoid mobile redundancy */}
              <div className="hidden lg:block pb-3 border-b border-white/[0.06] space-y-1">
                <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Instant Pro Activation</span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <h3 className="text-xl font-bold text-white tracking-tight">Order Summary</h3>
                  <span className="text-xl font-black text-white tabular-nums">
                    ₹{appliedCoupon && appliedCoupon.offerPrice < 499 ? appliedCoupon.offerPrice : amountRupees}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>FX Journal Pro (30 Days Pass)</span>
                  {appliedCoupon && appliedCoupon.offerPrice < 499 && (
                    <span className="text-emerald-400 font-medium">Save ₹{appliedCoupon.discountAmount}</span>
                  )}
                </div>
              </div>

            {statusMessage && (
              <div className={`p-2.5 sm:p-3 rounded-xl text-xs flex items-start gap-2 border ${statusMessage.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
                  : statusMessage.type === 'info'
                    ? 'bg-sky-500/10 border-sky-500/25 text-sky-200'
                    : 'bg-rose-500/10 border-rose-500/25 text-rose-200'
                }`}>
                {statusMessage.type === 'success' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-px text-emerald-400" />
                ) : statusMessage.type === 'info' ? (
                  <Loader2 className="h-4 w-4 shrink-0 mt-px text-sky-400 animate-spin" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 mt-px text-rose-400" />
                )}
                <span className="leading-snug">{statusMessage.text}</span>
              </div>
            )}

            {DEV_BYPASS && config.testBilling && (
              <div className="flex rounded-xl bg-white/[0.03] p-0.5 border border-white/[0.06]">
                {([
                  { id: 'gateway', label: 'Pay with Razorpay', icon: CreditCard },
                  { id: 'test', label: 'Test Mode', icon: Zap },
                ] as const).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium rounded-lg transition ${activeTab === t.id
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                      }`}
                  >
                    <t.icon className="h-3 w-3" />
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {activeTab === 'gateway' && (
              <div className="space-y-3">
                {/* Primary CTA Button - Centered & Balanced */}
                <button
                  type="button"
                  onClick={handleGatewayCheckout}
                  disabled={loading || (configLoaded && !config.configured)}
                  className="w-full h-12 bg-gradient-to-r from-violet-600 via-indigo-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 active:scale-[0.98] text-white font-bold text-sm rounded-xl transition-all shadow-[0_4px_24px_rgba(139,92,246,0.35)] hover:shadow-[0_6px_30px_rgba(139,92,246,0.5)] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer tracking-wide"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Opening secure checkout…
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

                {/* Sleek Apple-style Inset Mentor Coupon */}
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                      <Ticket className="h-3 w-3 text-amber-400" />
                      <span>Mentor Coupon</span>
                    </div>
                    {appliedCoupon && (
                      <span className="text-[10.5px] font-semibold text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Save ₹{appliedCoupon.discountAmount}
                      </span>
                    )}
                  </div>

                  {appliedCoupon ? (
                    <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-emerald-300 uppercase">{appliedCoupon.code}</span>
                        <span className="text-[10px] text-slate-400">({appliedCoupon.partnerName})</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setAppliedCoupon(null); setCouponInput(''); }}
                        className="text-[10.5px] text-slate-400 hover:text-rose-400 underline transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={couponInput}
                          onChange={(e) => {
                            setCouponInput(e.target.value.toUpperCase());
                            setCouponError(null);
                          }}
                          placeholder="Coupon code (e.g. VIP60)"
                          className="flex-1 h-8 bg-black/40 border border-white/[0.08] rounded-lg px-2.5 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 uppercase tracking-wider"
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
                          className="h-8 px-3 bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed border border-white/[0.08] rounded-lg text-xs font-medium text-white transition flex items-center gap-1"
                        >
                          {couponValidating ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Apply'}
                        </button>
                      </div>
                      {couponError && (
                        <p className="text-[10.5px] text-rose-400 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3 shrink-0" />
                          {couponError}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Minimalist Apple-style Payment Methods Chips */}
                <div className="rounded-xl border border-white/[0.05] p-2 bg-white/[0.01]">
                  <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase font-semibold tracking-wider mb-1">
                    <span>Pay with</span>
                    <span>Instant Activation</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {PAY_METHODS.map((m) => (
                      <span
                        key={m}
                        className="rounded-md bg-white/[0.03] border border-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-slate-400"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>

                {configLoaded && !config.configured && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" />
                    <p className="text-[11px] leading-relaxed text-amber-200">
                      Payments are not switched on yet. Nothing will be charged — please try again shortly.
                    </p>
                  </div>
                )}
              </div>
            )}

            {DEV_BYPASS && activeTab === 'test' && config.testBilling && (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-amber-500/[0.07] border border-amber-500/20 flex items-start gap-2.5">
                  <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-xs text-amber-200">Developer bypass — skips payment</h3>
                    <p className="text-[10.5px] text-amber-300/75 mt-0.5 leading-relaxed">
                      Flips account plan for local testing with ALLOW_TEST_BILLING=true.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleTestModeToggle('pro')}
                    disabled={loading}
                    className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                  >
                    <Star className="h-3.5 w-3.5" />
                    Unlock Pro
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTestModeToggle('free')}
                    disabled={loading}
                    className="p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 font-medium text-xs flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-slate-400" />
                    Back to Free
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-black/40 border-t border-white/[0.05] flex flex-col items-center justify-center text-center gap-0.5 text-[10.5px] text-slate-400">
          <div className="flex items-center justify-center gap-1 text-slate-300">
            <ShieldCheck className="h-3 w-3 text-emerald-400 shrink-0" />
            <span>Secured by Razorpay · 256-bit encryption</span>
          </div>
          <div className="text-slate-500 text-[10px]">
            Instant activation · 7-day money-back guarantee
          </div>
        </div>
      </div>
    </div>
  );
}

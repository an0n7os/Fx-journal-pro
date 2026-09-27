import React, { useState, useEffect, useCallback } from 'react';
import {
  Wallet,
  ArrowDownToLine,
  CheckCircle2,
  Clock,
  XCircle,
  Building2,
  QrCode,
  Copy,
  Check,
  AlertCircle,
  RefreshCw,
  Info,
  ChevronRight,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

interface PayoutDetails {
  type: 'UPI' | 'BANK';
  upiId?: string;
  accountHolderName?: string;
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
}

interface PayoutRequest {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerEmail: string;
  partnerCode: string;
  amount: number;
  method: 'UPI' | 'BANK';
  payoutDetails: PayoutDetails;
  status: 'PENDING' | 'PAID' | 'REJECTED';
  utrNumber?: string;
  adminNotes?: string;
  requestedAt: string;
  processedAt?: string;
  processedBy?: string;
}

interface PayoutEarnings {
  totalEarned: number;
  totalWithdrawn: number;
  totalPending: number;
  availableBalance: number;
  minPayoutThreshold: number;
}

interface PartnerMe {
  partnerId: string;
  name: string | null;
  referralCode: string;
  referralUrl: string;
}

interface PartnerPayoutHubProps {
  partnerMe?: PartnerMe | null;
}

function WhatsAppIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

const ADMIN_WHATSAPP = '918136802573';

export default function PartnerPayoutHub({ partnerMe }: PartnerPayoutHubProps = {}) {
  const [earnings, setEarnings] = useState<PayoutEarnings>({
    totalEarned: 0,
    totalWithdrawn: 0,
    totalPending: 0,
    availableBalance: 0,
    minPayoutThreshold: 500,
  });
  const [details, setDetails] = useState<PayoutDetails>({
    type: 'UPI',
    upiId: '',
    accountHolderName: '',
    accountNumber: '',
    ifsc: '',
    bankName: '',
  });
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Settings form state
  const [activeMethodTab, setActiveMethodTab] = useState<'UPI' | 'BANK'>('UPI');
  const [upiDraft, setUpiDraft] = useState('');
  const [bankHolderDraft, setBankHolderDraft] = useState('');
  const [bankAccountDraft, setBankAccountDraft] = useState('');
  const [bankIfscDraft, setBankIfscDraft] = useState('');
  const [bankNameDraft, setBankNameDraft] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);

  // Withdrawal modal state
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [modalMode, setModalMode] = useState<'whatsapp' | 'manual'>('whatsapp');
  const [modalUpi, setModalUpi] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState<number | ''>('');
  const [withdrawMethod, setWithdrawMethod] = useState<'UPI' | 'BANK'>('UPI');
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);

  // Clipboard
  const [copiedUtr, setCopiedUtr] = useState<string | null>(null);

  const fetchPayoutData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/partner/payout', { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load payout details.');
      }
      const data = await res.json();
      if (data.earnings) setEarnings(data.earnings);
      if (data.requests) setRequests(Array.isArray(data.requests) ? data.requests : []);
      if (data.payoutDetails) {
        setDetails(data.payoutDetails);
        setActiveMethodTab(data.payoutDetails.type || 'UPI');
        setUpiDraft(data.payoutDetails.upiId || '');
        setBankHolderDraft(data.payoutDetails.accountHolderName || '');
        setBankAccountDraft(data.payoutDetails.accountNumber || '');
        setBankIfscDraft(data.payoutDetails.ifsc || '');
        setBankNameDraft(data.payoutDetails.bankName || '');
      }
    } catch (err: any) {
      setError(err.message || 'Could not fetch payout data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchPayoutData();
  }, [fetchPayoutData]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsSuccess(null);
    setError(null);

    const payload: PayoutDetails = {
      type: activeMethodTab,
      upiId: activeMethodTab === 'UPI' ? upiDraft.trim() : details.upiId,
      accountHolderName: activeMethodTab === 'BANK' ? bankHolderDraft.trim() : details.accountHolderName,
      accountNumber: activeMethodTab === 'BANK' ? bankAccountDraft.trim() : details.accountNumber,
      ifsc: activeMethodTab === 'BANK' ? bankIfscDraft.trim().toUpperCase() : details.ifsc,
      bankName: activeMethodTab === 'BANK' ? bankNameDraft.trim() : details.bankName,
    };

    try {
      const res = await fetch('/api/partner/payout-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save payout settings.');
      setDetails(data.payoutDetails);
      setSettingsSuccess(
        activeMethodTab === 'UPI'
          ? 'UPI ID saved successfully! You can now request payouts.'
          : 'Bank details saved successfully! You can now request payouts.'
      );
      setTimeout(() => setSettingsSuccess(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Could not save payout settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleOpenWithdrawModal = (mode: 'whatsapp' | 'manual' = 'whatsapp') => {
    setWithdrawError(null);
    setWithdrawSuccess(null);
    setWithdrawAmount(earnings.availableBalance > 0 ? earnings.availableBalance : '');
    setModalUpi(details.upiId || '');
    setWithdrawMethod(details.type || 'UPI');
    setModalMode(mode);
    setShowWithdrawModal(true);
  };

  const handleWhatsAppClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0) {
      setWithdrawError('Please enter a valid amount.');
      return;
    }
    if (amt > earnings.availableBalance) {
      setWithdrawError(`Requested amount exceeds available balance (₹${earnings.availableBalance}).`);
      return;
    }
    const targetUpi = (modalUpi || details.upiId || '').trim();
    if (!targetUpi) {
      setWithdrawError('Please enter your UPI ID (Google Pay / PhonePe / Paytm).');
      return;
    }

    setSubmittingWithdrawal(true);
    setWithdrawError(null);

    try {
      // 1. Submit request to backend
      const res = await fetch('/api/partner/payout-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount: amt, method: 'UPI', upiId: targetUpi }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit withdrawal request.');

      // 2. Open WhatsApp with formatted claim including official server Request ID
      const partnerName = partnerMe?.name || 'Partner';
      const partnerCode = partnerMe?.referralCode || 'PARTNER';
      const reqId = data?.request?.id || 'PENDING';
      const msg = `Hi FX Journal Pro Admin! 👋\nI want to claim my Partner Referral Earnings.\n\n🆔 Request ID: ${reqId}\n👤 Partner: ${partnerName}\n🎟️ Referral Code: ${partnerCode}\n💰 Claim Amount: ₹${amt}\n📱 Pay to UPI: ${targetUpi}\n\n(Verify Request ID in Admin Panel). Thank you!`;
      const waUrl = `https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(msg)}`;
      window.open(waUrl, '_blank');

      setWithdrawSuccess('Withdrawal registered & WhatsApp opened! Admin will transfer to your UPI.');
      setTimeout(() => {
        setShowWithdrawModal(false);
        fetchPayoutData(true);
      }, 1800);
    } catch (err: any) {
      setWithdrawError(err.message || 'WhatsApp claim failed.');
    } finally {
      setSubmittingWithdrawal(false);
    }
  };

  const handleSubmitWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0) {
      setWithdrawError('Please enter a valid amount.');
      return;
    }
    if (amt > earnings.availableBalance) {
      setWithdrawError(`Requested amount exceeds available balance (₹${earnings.availableBalance}).`);
      return;
    }

    setSubmittingWithdrawal(true);
    setWithdrawError(null);

    try {
      const res = await fetch('/api/partner/payout-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount: amt, method: withdrawMethod }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit withdrawal request.');
      setWithdrawSuccess(data.message || 'Withdrawal request submitted successfully!');
      setTimeout(() => {
        setShowWithdrawModal(false);
        fetchPayoutData(true);
      }, 1500);
    } catch (err: any) {
      setWithdrawError(err.message || 'Withdrawal request failed.');
    } finally {
      setSubmittingWithdrawal(false);
    }
  };

  const hasConfiguredPayout =
    (details.type === 'UPI' && !!details.upiId) ||
    (details.type === 'BANK' && !!details.accountNumber && !!details.ifsc);

  const canWithdraw =
    earnings.availableBalance >= earnings.minPayoutThreshold && hasConfiguredPayout;

  const copyUtr = (utr: string) => {
    navigator.clipboard.writeText(utr);
    setCopiedUtr(utr);
    setTimeout(() => setCopiedUtr(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Refresh */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 bg-gradient-to-r from-violet-950/40 via-slate-900/60 to-slate-900/40 border border-violet-500/20 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-violet-600/20 border border-violet-500/30 text-violet-400">
            <Wallet className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              Partner Earnings & Withdrawal
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                Direct Payout
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Withdraw your referral commissions straight to your UPI ID or Bank Account.
            </p>
          </div>
        </div>

        <button
          onClick={() => fetchPayoutData(true)}
          disabled={refreshing || loading}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-700/80 bg-slate-800/60 hover:bg-slate-800 text-slate-300 transition-colors self-end sm:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-violet-400' : ''}`} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/25 text-red-300 text-xs rounded-xl">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── 1-Click WhatsApp Quick Action Banner ────────────────────────────── */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-slate-900/40 border border-emerald-500/30 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <WhatsAppIcon className="h-6 w-6" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              Simple 1-Click WhatsApp Payout
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Direct GPay / PhonePe
              </span>
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">
              Click claim, enter your UPI ID, and message Admin on WhatsApp. Admin transfers directly to your GPay / PhonePe!
            </p>
          </div>
        </div>

        <button
          onClick={() => handleOpenWithdrawModal('whatsapp')}
          disabled={earnings.availableBalance <= 0}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 transition-all shadow-md shadow-emerald-600/30 shrink-0 self-stretch sm:self-auto cursor-pointer"
        >
          <WhatsAppIcon className="h-4 w-4" />
          Claim ₹{earnings.availableBalance.toLocaleString()} on WhatsApp
        </button>
      </div>

      {/* ── Key Financial Overview Cards ────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Available Balance */}
        <div className="p-5 bg-slate-900/70 border border-emerald-500/30 rounded-2xl shadow-sm relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-colors pointer-events-none" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Available to Withdraw</span>
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Sparkles className="h-4 w-4" />
            </span>
          </div>
          <div className="text-3xl font-black text-emerald-400 font-mono">
            ₹{earnings.availableBalance.toLocaleString()}
          </div>
          <div className="mt-3 space-y-2">
            <button
              onClick={() => handleOpenWithdrawModal('whatsapp')}
              disabled={earnings.availableBalance <= 0}
              className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 transition-all shadow-md shadow-emerald-600/30 cursor-pointer disabled:cursor-not-allowed"
            >
              <WhatsAppIcon className="h-4 w-4" />
              1-Click WhatsApp Claim
            </button>
            <button
              onClick={() => handleOpenWithdrawModal('manual')}
              disabled={earnings.availableBalance <= 0}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-semibold text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer"
            >
              <ArrowDownToLine className="h-3 w-3" />
              Or in-app manual request
            </button>
          </div>
        </div>

        {/* Total Earned */}
        <div className="p-5 bg-slate-900/60 border border-slate-800/90 rounded-2xl shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Lifetime Commission</span>
            <span className="p-1.5 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20">
              <Wallet className="h-4 w-4" />
            </span>
          </div>
          <div className="text-3xl font-black text-white font-mono">
            ₹{earnings.totalEarned.toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Total earned from referred traders who upgraded to Pro.
          </p>
        </div>

        {/* Total Paid Out */}
        <div className="p-5 bg-slate-900/60 border border-slate-800/90 rounded-2xl shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Settled (Paid)</span>
            <span className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </div>
          <div className="text-3xl font-black text-white font-mono">
            ₹{earnings.totalWithdrawn.toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Transferred directly to your UPI ID or Bank account.
          </p>
        </div>

        {/* Pending Payouts */}
        <div className="p-5 bg-slate-900/60 border border-slate-800/90 rounded-2xl shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Pending Processing</span>
            <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          <div className="text-3xl font-black text-amber-400 font-mono">
            ₹{earnings.totalPending.toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            {earnings.totalPending > 0
              ? 'Requests currently being reviewed & disbursed by admin.'
              : 'No pending payout requests.'}
          </p>
        </div>
      </div>

      {/* ── Payout Configuration (UPI / Bank Account) ────────────────────── */}
      <div className="bg-slate-900/60 border border-slate-800/90 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Building2 className="h-4 w-4 text-violet-400" />
              Payout Destination & Bank Settings
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">
              Choose how you want to receive your referral commissions.
            </p>
          </div>

          <div className="flex items-center p-1 bg-slate-950/80 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveMethodTab('UPI')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                activeMethodTab === 'UPI'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <QrCode className="h-3.5 w-3.5" />
              UPI (Instant / Recommended)
            </button>
            <button
              onClick={() => setActiveMethodTab('BANK')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                activeMethodTab === 'BANK'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
              Bank Transfer
            </button>
          </div>
        </div>

        {settingsSuccess && (
          <div className="flex items-center gap-2.5 p-3.5 bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs rounded-xl">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{settingsSuccess}</span>
          </div>
        )}

        <form onSubmit={handleSaveSettings} className="space-y-4">
          {activeMethodTab === 'UPI' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  UPI ID (VPA)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={upiDraft}
                    onChange={(e) => setUpiDraft(e.target.value)}
                    placeholder="e.g. yourname@okhdfcbank, mobile@paytm, name@upi"
                    className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-violet-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none transition font-mono"
                    required
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-violet-400 inline" />
                  Supports Google Pay, PhonePe, Paytm, BHIM, and all Indian banking apps.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Beneficiary Name
                </label>
                <input
                  type="text"
                  value={bankHolderDraft}
                  onChange={(e) => setBankHolderDraft(e.target.value)}
                  placeholder="Full name as per bank record"
                  className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-violet-500 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Bank Name (Optional)
                </label>
                <input
                  type="text"
                  value={bankNameDraft}
                  onChange={(e) => setBankNameDraft(e.target.value)}
                  placeholder="e.g. HDFC Bank, ICICI Bank, SBI"
                  className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-violet-500 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Account Number
                </label>
                <input
                  type="text"
                  value={bankAccountDraft}
                  onChange={(e) => setBankAccountDraft(e.target.value.replace(/\D/g, ''))}
                  placeholder="9 to 18 digits account number"
                  className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-violet-500 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  IFSC Code
                </label>
                <input
                  type="text"
                  value={bankIfscDraft}
                  onChange={(e) => setBankIfscDraft(e.target.value.toUpperCase())}
                  placeholder="e.g. HDFC0001234, SBIN0004567"
                  maxLength={11}
                  className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-violet-500 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition font-mono uppercase"
                  required
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <Info className="h-3.5 w-3.5 text-slate-500" />
              <span>Payments are processed in INR without deduction.</span>
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-bold text-white transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {savingSettings ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Saving…
                </>
              ) : (
                'Save Payout Details'
              )}
            </button>
          </div>
        </form>
      </div>

      {/* ── Withdrawal History Table ──────────────────────────────────────── */}
      <div className="bg-slate-900/60 border border-slate-800/90 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 sm:p-5 border-b border-slate-800/80 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Clock className="h-4 w-4 text-violet-400" />
              Withdrawal & Settlement History
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">
              Track the status of all your payout requests and transaction UTRs.
            </p>
          </div>

          <span className="text-xs font-mono font-bold text-slate-400 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700">
            {requests.length} Requests
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-bold bg-slate-950/60">
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4">Payout Method</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4">UTR / Transaction Ref</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    <p className="text-sm font-medium">No withdrawal requests yet.</p>
                    <p className="text-xs text-slate-600 mt-1">
                      When your available referral earnings reach ₹{earnings.minPayoutThreshold}, you can click "Request Withdrawal" to receive your payout.
                    </p>
                  </td>
                </tr>
              ) : (
                requests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-800/30 transition">
                    <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                      {new Date(req.requestedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-black text-white whitespace-nowrap">
                      ₹{req.amount.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {req.method === 'UPI' ? (
                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-violet-300">
                          <QrCode className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                          <span>{req.payoutDetails?.upiId || 'UPI'}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-blue-300">
                          <Building2 className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                          <span>
                            {req.payoutDetails?.bankName || 'Bank'} (•••{req.payoutDetails?.accountNumber?.slice(-4) || 'XXXX'})
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      {req.status === 'PAID' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                          <CheckCircle2 className="h-3 w-3" /> Paid & Completed
                        </span>
                      )}
                      {req.status === 'PENDING' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/25">
                          <Clock className="h-3 w-3 animate-pulse" /> In Review
                        </span>
                      )}
                      {req.status === 'REJECTED' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/25">
                          <XCircle className="h-3 w-3" /> Rejected
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {req.status === 'PAID' && req.utrNumber ? (
                        <div className="inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 px-2 py-0.5 rounded-md">
                          <span>UTR: {req.utrNumber}</span>
                          <button
                            onClick={() => copyUtr(req.utrNumber!)}
                            className="hover:text-white transition p-0.5"
                            title="Copy UTR"
                          >
                            {copiedUtr === req.utrNumber ? (
                              <Check className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      ) : req.status === 'REJECTED' && req.adminNotes ? (
                        <span className="text-[11px] text-red-400/90 italic">
                          Note: {req.adminNotes}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Request Withdrawal / WhatsApp Claim Modal ───────────────────────── */}
      {showWithdrawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-5">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg border ${
                  modalMode === 'whatsapp'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                }`}>
                  {modalMode === 'whatsapp' ? <WhatsAppIcon className="h-4 w-4" /> : <ArrowDownToLine className="h-4 w-4" />}
                </div>
                <h3 className="text-base font-bold text-white">
                  {modalMode === 'whatsapp' ? '1-Click WhatsApp Claim' : 'Withdraw Referral Earnings'}
                </h3>
              </div>
              <button
                onClick={() => setShowWithdrawModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold p-1 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Mode Switcher */}
            <div className="flex items-center p-1 bg-slate-950/80 rounded-xl border border-slate-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setModalMode('whatsapp')}
                className={`flex-1 py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  modalMode === 'whatsapp'
                    ? 'bg-emerald-600 text-white shadow-sm font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <WhatsAppIcon className="h-3.5 w-3.5" />
                WhatsApp Claim (Instant)
              </button>
              <button
                type="button"
                onClick={() => setModalMode('manual')}
                className={`flex-1 py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  modalMode === 'manual'
                    ? 'bg-violet-600 text-white shadow-sm font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
                In-App Form
              </button>
            </div>

            {withdrawError && (
              <div className="p-3 bg-red-500/10 border border-red-500/25 text-red-300 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{withdrawError}</span>
              </div>
            )}

            {withdrawSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs rounded-xl flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>{withdrawSuccess}</span>
              </div>
            )}

            {modalMode === 'whatsapp' ? (
              <form onSubmit={handleWhatsAppClaim} className="space-y-4">
                {/* Available Balance highlight */}
                <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">Available Balance</span>
                  <span className="font-mono text-base font-black text-emerald-400">
                    ₹{earnings.availableBalance.toLocaleString()}
                  </span>
                </div>

                {/* Amount to Claim */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Amount to Claim (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">₹</span>
                    <input
                      type="number"
                      min={100}
                      max={earnings.availableBalance}
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="Enter amount"
                      className="w-full bg-slate-950 border border-slate-700/80 focus:border-emerald-500 rounded-xl pl-8 pr-4 py-2.5 text-sm text-white font-mono focus:outline-none"
                      required
                    />
                  </div>

                  {/* Preset Quick Chips */}
                  <div className="flex items-center gap-2 mt-2">
                    {[500, 1000, 2000].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        disabled={preset > earnings.availableBalance}
                        onClick={() => setWithdrawAmount(preset)}
                        className="px-2.5 py-1 text-[11px] font-mono font-bold rounded-lg border border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800 disabled:opacity-30 transition cursor-pointer"
                      >
                        ₹{preset}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setWithdrawAmount(earnings.availableBalance)}
                      className="px-2.5 py-1 text-[11px] font-mono font-bold rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition ml-auto cursor-pointer"
                    >
                      Max
                    </button>
                  </div>
                </div>

                {/* UPI ID Input */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Your UPI ID / GPay / PhonePe Number
                  </label>
                  <input
                    type="text"
                    value={modalUpi}
                    onChange={(e) => setModalUpi(e.target.value)}
                    placeholder="e.g. 9876543210@paytm, name@okhdfcbank"
                    className="w-full bg-slate-950 border border-slate-700/80 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none"
                    required
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Admin will send this payout directly to this UPI ID.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowWithdrawModal(false)}
                    className="px-4 py-2.5 rounded-xl border border-slate-700 text-xs font-bold text-slate-300 hover:bg-slate-800 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingWithdrawal || !withdrawAmount || Number(withdrawAmount) <= 0 || !modalUpi.trim()}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-bold text-white transition flex items-center gap-2 cursor-pointer shadow-md shadow-emerald-600/30"
                  >
                    {submittingWithdrawal ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Processing…
                      </>
                    ) : (
                      <>
                        <WhatsAppIcon className="h-4 w-4" /> Open WhatsApp & Claim ₹{withdrawAmount || 0}
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleSubmitWithdrawal} className="space-y-4">
                {/* Available balance highlight */}
                <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">Available Balance</span>
                  <span className="font-mono text-base font-black text-emerald-400">
                    ₹{earnings.availableBalance.toLocaleString()}
                  </span>
                </div>

                {/* Amount input */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Amount to Withdraw (₹)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">₹</span>
                    <input
                      type="number"
                      min={100}
                      max={earnings.availableBalance}
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="Enter amount"
                      className="w-full bg-slate-950 border border-slate-700/80 focus:border-violet-500 rounded-xl pl-8 pr-4 py-2.5 text-sm text-white font-mono focus:outline-none"
                      required
                    />
                  </div>
                </div>

                {/* Destination preview */}
                <div className="p-3 bg-violet-950/30 border border-violet-500/20 rounded-xl space-y-1">
                  <span className="text-[11px] uppercase tracking-wider font-bold text-violet-400">
                    Sending To:
                  </span>
                  {details.type === 'UPI' ? (
                    <p className="font-mono text-xs text-white font-bold break-all flex items-center gap-1.5">
                      <QrCode className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                      {details.upiId || 'Not configured'}
                    </p>
                  ) : (
                    <div className="text-xs text-white font-bold font-mono space-y-0.5">
                      <p>{details.accountHolderName} • {details.bankName}</p>
                      <p className="text-slate-400 text-[11px]">A/C: {details.accountNumber} | IFSC: {details.ifsc}</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowWithdrawModal(false)}
                    className="px-4 py-2.5 rounded-xl border border-slate-700 text-xs font-bold text-slate-300 hover:bg-slate-800 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingWithdrawal || !withdrawAmount || Number(withdrawAmount) <= 0}
                    className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-bold text-white transition flex items-center gap-1.5 cursor-pointer shadow-sm shadow-violet-600/30"
                  >
                    {submittingWithdrawal ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Submitting…
                      </>
                    ) : (
                      'Confirm & Submit Request'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

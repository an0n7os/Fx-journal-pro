import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, Pencil, Plus, Ticket, Users, X, Wallet, Sparkles } from 'lucide-react';
import PartnerUserRegistry from './PartnerUserRegistry';
import ReferralIncomeHub from './ReferralIncomeHub';
import PartnerPayoutHub from './PartnerPayoutHub';

interface PartnerReferralLink {
  id: string;
  code: string;
  label?: string;
  offerPrice: number;
  isActive: boolean;
  referralUrl?: string;
  mentorEarns: number;
  studentSaves: number;
  createdAt?: string;
}

interface PartnerMe {
  partnerId: string;
  name: string | null;
  referralCode: string;
  referralUrl: string;
  offerPrice?: number;
  standardPrice?: number;
  mentorEarns?: number;
  links?: PartnerReferralLink[];
}

interface PartnerPortalProps {
  onInspectUser?: (user: any, tab?: string) => void;
}

export default function PartnerPortal({ onInspectUser }: PartnerPortalProps = {}) {
  const [me, setMe] = useState<PartnerMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftCode, setDraftCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'payouts' | 'network'>('overview');
  const [selectedCampaignCode, setSelectedCampaignCode] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/partner/me', { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not load your partner profile.');
      setMe(body);
      setDraftCode(body.referralCode || '');
      if (!selectedCampaignCode) {
        setSelectedCampaignCode(body.referralCode || '');
      }
    } catch (e: any) {
      setError(e.message || 'Could not load your partner profile.');
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignCode]);

  useEffect(() => { load(); }, [load]);

  // Keep selected campaign valid when me changes
  useEffect(() => {
    if (me?.referralCode && !selectedCampaignCode) {
      setSelectedCampaignCode(me.referralCode);
    }
  }, [me, selectedCampaignCode]);

  // Clipboard helper with fallback
  const copy = async (value: string, which: 'link' | 'code') => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = value;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(which);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setError('Copying is blocked in this browser — select the text and copy it by hand.');
    }
  };

  const saveCode = async () => {
    const next = draftCode.trim().toUpperCase();
    if (!next) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/partner/code', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ referralCode: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save that code.');
      setMe((prev) => (prev ? { ...prev, referralCode: body.referralCode, referralUrl: body.referralUrl } : prev));
      if (selectedCampaignCode === me?.referralCode) {
        setSelectedCampaignCode(body.referralCode);
      }
      setEditing(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Determine active campaign to display in the hero cards
  const customMatch = (me?.links || []).find((l) => l.code === selectedCampaignCode);
  const activeCampaign = customMatch
    ? {
        id: customMatch.id,
        code: customMatch.code,
        label: customMatch.label || 'Custom Offer',
        offerPrice: customMatch.offerPrice,
        isActive: customMatch.isActive,
        referralUrl: customMatch.referralUrl || `${typeof window !== 'undefined' ? window.location.origin : ''}/?ref=${encodeURIComponent(customMatch.code)}`,
        mentorEarns: customMatch.mentorEarns,
        studentSaves: customMatch.studentSaves,
        isPrimary: false,
      }
    : {
        id: 'primary',
        code: me?.referralCode || 'MENTOR60',
        label: 'Primary Default',
        offerPrice: me?.offerPrice || 499,
        isActive: true,
        referralUrl: me?.referralUrl || `${typeof window !== 'undefined' ? window.location.origin : ''}/?ref=${encodeURIComponent(me?.referralCode || 'MENTOR60')}`,
        mentorEarns: me?.mentorEarns !== undefined ? me.mentorEarns : Math.max(0, (me?.offerPrice || 499) - 199),
        studentSaves: Math.max(0, 499 - (me?.offerPrice || 499)),
        isPrimary: true,
      };

  return (
    <div className="dx-dark-surface space-y-6">
      {/* Page notifications */}
      {error && (
        <div className="flex items-start justify-between gap-3 bg-red-500/10 border border-red-500/25 text-red-300 rounded-2xl px-4 py-3 text-xs">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* ── Sub Navigation Tabs ────────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-slate-800/80 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'overview'
              ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
          }`}
        >
          <Link2 className="h-4 w-4 text-violet-400" />
          Referral Links & Pricing
        </button>

        <button
          onClick={() => setActiveTab('payouts')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'payouts'
              ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
          }`}
        >
          <Wallet className="h-4 w-4 text-emerald-400" />
          Withdrawals & Payouts
        </button>

        <button
          onClick={() => setActiveTab('network')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'network'
              ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40 shadow-sm'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
          }`}
        >
          <Users className="h-4 w-4 text-blue-400" />
          Referred Traders Network
        </button>
      </div>

      {/* ── TAB 1: OVERVIEW & LINKS ──────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {/* Active Campaign Switcher Header */}
          <div className="p-3 sm:p-4 rounded-2xl bg-gradient-to-r from-violet-950/40 via-purple-950/30 to-slate-900/80 border border-violet-500/25 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-violet-500/20 text-violet-300 border border-violet-500/30">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-violet-300">
                    Active Campaign Preview
                  </span>
                  <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full border ${
                    activeCampaign.isActive
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                  }`}>
                    {activeCampaign.isActive ? 'Active' : 'Revoked'}
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Switch between campaigns below to copy their unique link and code.
                </p>
              </div>
            </div>

            {/* Campaign Selection Pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Primary default */}
              <button
                type="button"
                onClick={() => setSelectedCampaignCode(me?.referralCode || '')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  selectedCampaignCode === me?.referralCode || !selectedCampaignCode
                    ? 'bg-violet-600 text-white shadow-md ring-2 ring-violet-400/50'
                    : 'bg-slate-950/80 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700'
                }`}
              >
                <span>{me?.referralCode || 'Default'}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 font-medium">Primary (₹{me?.offerPrice || 499})</span>
              </button>

              {/* Custom campaigns */}
              {(me?.links || []).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setSelectedCampaignCode(l.code)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    selectedCampaignCode === l.code
                      ? 'bg-violet-600 text-white shadow-md ring-2 ring-violet-400/50'
                      : 'bg-slate-950/80 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <span>{l.code}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 font-medium">₹{l.offerPrice}</span>
                  {!l.isActive && <span className="text-[9px] text-rose-400 font-bold">(Off)</span>}
                </button>
              ))}

              {/* Trigger create modal */}
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('open-create-partner-link'))}
                className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/25 transition cursor-pointer flex items-center gap-1"
                title="Create new referral link"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>+ New</span>
              </button>
            </div>
          </div>

          {/* Referral identity cards (Dynamically shows active campaign) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Card 1: Referral Link */}
            <div className="bg-slate-900/70 border border-slate-800/90 rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-violet-400" />
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Referral Link</p>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20">
                  {activeCampaign.isPrimary ? 'Default Link' : (activeCampaign.label || 'Custom Campaign')}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 mb-4 select-all">
                <p className="font-mono text-xs sm:text-[13px] text-slate-200 break-all leading-relaxed">
                  {loading ? 'Loading…' : activeCampaign.referralUrl}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => copy(activeCampaign.referralUrl, 'link')}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-4 py-2.5 text-xs font-bold text-white transition-colors cursor-pointer shadow-md"
                >
                  {copied === 'link' ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied === 'link' ? 'Copied Link!' : 'Copy link'}
                </button>

                <a
                  href={activeCampaign.referralUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 hover:border-slate-500 hover:bg-slate-800/80 px-3.5 py-2.5 text-xs font-semibold text-slate-300 transition cursor-pointer"
                  title="Test student landing page"
                >
                  <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                  <span>Test Link</span>
                </a>
              </div>
            </div>

            {/* Card 2: Referral Code */}
            <div className="bg-slate-900/70 border border-slate-800/90 rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Ticket className="h-4 w-4 text-violet-400" />
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Referral Code / Coupon</p>
                </div>
                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  <span>Student: ₹{activeCampaign.offerPrice}</span>
                  <span className="text-slate-500">•</span>
                  <span>Earn: ₹{activeCampaign.mentorEarns}</span>
                </div>
              </div>

              {editing && activeCampaign.isPrimary ? (
                <>
                  <input
                    value={draftCode}
                    onChange={(e) => setDraftCode(e.target.value.toUpperCase())}
                    maxLength={16}
                    autoFocus
                    placeholder="YOURCODE"
                    aria-label="Referral code"
                    className="w-full bg-slate-950/80 border border-slate-700 focus:border-violet-500 rounded-xl px-3.5 py-2.5 font-mono text-lg tracking-[0.18em] text-white focus:outline-none mb-2"
                  />
                  <p className="text-[11px] text-slate-500 mb-4">4–16 letters and numbers. No spaces or symbols.</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveCode}
                      disabled={saving}
                      className="rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-4 py-2.5 text-xs font-bold text-white transition-colors cursor-pointer"
                    >
                      {saving ? 'Saving…' : 'Save code'}
                    </button>
                    <button
                      onClick={() => { setEditing(false); setDraftCode(me?.referralCode || ''); setError(''); }}
                      className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-baseline gap-3 mb-4">
                    <p className="font-mono text-2xl font-black tracking-[0.18em] text-white">
                      {loading ? '…' : activeCampaign.code}
                    </p>
                    {activeCampaign.studentSaves > 0 && (
                      <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                        ₹{activeCampaign.studentSaves} OFF
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copy(activeCampaign.code, 'code')}
                      disabled={loading}
                      className="inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-4 py-2.5 text-xs font-bold text-white transition-colors cursor-pointer shadow-md"
                    >
                      {copied === 'code' ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied === 'code' ? 'Copied Code!' : 'Copy code'}
                    </button>

                    {activeCampaign.isPrimary ? (
                      <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Customise
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('open-edit-partner-link', { detail: { link: activeCampaign } }));
                        }}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit Campaign
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Pricing, coupon and campaign links manager */}
          <ReferralIncomeHub
            selectedCampaignCode={selectedCampaignCode}
            onSelectCampaign={(code) => setSelectedCampaignCode(code)}
            onPartnerProfileUpdate={(updated) => {
              setMe((prev) => ({ ...(prev || {}), ...updated }));
            }}
          />
        </div>
      )}

      {/* ── TAB 2: WITHDRAWALS & PAYOUTS ──────────────────────────────────── */}
      {activeTab === 'payouts' && (
        <PartnerPayoutHub partnerMe={me} />
      )}

      {/* ── TAB 3: REFERRED TRADERS NETWORK ──────────────────────────────── */}
      {activeTab === 'network' && (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-2xl border border-slate-800/80 bg-slate-900/40 px-4 py-3">
            <Users className="h-4 w-4 shrink-0 text-slate-500 mt-px" />
            <p className="text-[11px] leading-relaxed text-slate-500">
              You can always see who is in your network. Their trades, analysis and journal stay
              private until each user turns on <span className="text-slate-300 font-semibold">Allow Partner to
              View Trade Details</span> in their own settings — and they can turn it back off at any time.
            </p>
          </div>

          <PartnerUserRegistry onInspectUser={onInspectUser} />
        </div>
      )}
    </div>
  );
}


import React, { useState, useEffect } from 'react';
import {
  AlertCircle, Check, CheckCircle, Copy, Link2, Pencil, Plus, Sliders, Ticket, Trash2, X,
} from 'lucide-react';

/**
 * A partner's referral pricing, coupon code and campaign links.
 *
 * This lived inside AdminPanel, on the dashboard a SUPER_ADMIN sees, even
 * though every endpoint it calls is /api/partner/* and everything it sets —
 * the student offer price, the coupon, the campaign links — belongs to one
 * partner's own account. An administrator is not a partner, so the controls
 * had nothing to act on there. It now renders where it applies, inside the
 * Partner Portal.
 *
 * Self-contained: it owns its state, loads /api/partner/me itself, and can be
 * dropped anywhere a partner is signed in.
 */
export default function ReferralIncomeHub() {

  // Partner / Mentor Referral Pricing, Coupon & Link states
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

  const [partnerProfile, setPartnerProfile] = useState<{
    referralCode: string;
    referralUrl: string;
    name?: string;
    offerPrice?: number;
    standardPrice?: number;
    mentorEarns?: number;
    links?: PartnerReferralLink[];
  } | null>(null);

  const [copiedCoupon, setCopiedCoupon] = useState<string | null>(null);
  const [copiedRefLink, setCopiedRefLink] = useState<string | null>(null);
  const [editingCoupon, setEditingCoupon] = useState(false);
  const [draftCouponCode, setDraftCouponCode] = useState('');
  const [savingCoupon, setSavingCoupon] = useState(false);
  const [couponSaveMsg, setCouponSaveMsg] = useState<string | null>(null);

  // Student offer price configuration
  const [currentOfferPrice, setCurrentOfferPrice] = useState<number>(499);
  const [savingOfferPrice, setSavingOfferPrice] = useState(false);
  const [offerPriceMsg, setOfferPriceMsg] = useState<string | null>(null);

  // Custom referral links modal & form states
  const [showCreateLinkModal, setShowCreateLinkModal] = useState(false);
  const [newLinkCode, setNewLinkCode] = useState('');
  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [newLinkPrice, setNewLinkPrice] = useState<number>(399);
  const [creatingLink, setCreatingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [editingLink, setEditingLink] = useState<PartnerReferralLink | null>(null);
  const [editLinkCode, setEditLinkCode] = useState('');
  const [editLinkLabel, setEditLinkLabel] = useState('');
  const [editLinkPrice, setEditLinkPrice] = useState<number>(399);
  const [savingEditLink, setSavingEditLink] = useState(false);
  // Sent alongside the cookie, matching the rest of the app's fetches.
  const getAuthHeaders = (): Record<string, string> => {
    const userId = sessionStorage.getItem('auth_user_id') || '';
    const email = sessionStorage.getItem('auth_email') || '';
    const headers: Record<string, string> = {};
    if (userId) headers['x-auth-user-id'] = userId;
    if (email) headers['x-auth-email'] = email;
    return headers;
  };

  // AdminPanel loaded this as a side effect of its own dashboard fetch. Owning
  // it here means the hub works wherever it is mounted.
  useEffect(() => {
    let alive = true;
    fetch('/api/partner/me', { headers: getAuthHeaders(), credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (!alive || !data?.referralCode) return;
        setPartnerProfile(data);
        setDraftCouponCode(data.referralCode);
        if (typeof data.offerPrice === 'number') setCurrentOfferPrice(data.offerPrice);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const handleCopyCoupon = (val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedCoupon(val);
    setTimeout(() => setCopiedCoupon(null), 2000);
  };

  const handleCopyRefLink = (val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedRefLink(val);
    setTimeout(() => setCopiedRefLink(null), 2000);
  };

  const handleSaveCouponCode = async () => {
    const next = draftCouponCode.trim().toUpperCase();
    if (!next) return;
    setSavingCoupon(true);
    setCouponSaveMsg(null);
    try {
      const res = await fetch('/api/partner/code', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ referralCode: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save that code.');
      setPartnerProfile((prev: any) => ({ ...(prev || {}), referralCode: body.referralCode, referralUrl: body.referralUrl }));
      setEditingCoupon(false);
      setCouponSaveMsg('Coupon code updated successfully!');
      setTimeout(() => setCouponSaveMsg(null), 3000);
    } catch (e: any) {
      alert(e.message || 'Error updating code');
    } finally {
      setSavingCoupon(false);
    }
  };

  const handleSaveOfferPrice = async (targetPrice?: number) => {
    const priceToSave = targetPrice !== undefined ? targetPrice : currentOfferPrice;
    setSavingOfferPrice(true);
    setOfferPriceMsg(null);
    try {
      const res = await fetch('/api/partner/offer-price', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ offerPrice: priceToSave }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save offer price.');
      setCurrentOfferPrice(body.offerPrice);
      setPartnerProfile((prev: any) => ({
        ...(prev || {}),
        offerPrice: body.offerPrice,
        mentorEarns: body.mentorEarns
      }));
      setOfferPriceMsg(`Offer price updated to ₹${body.offerPrice}! You earn ₹${body.mentorEarns} per student upgrade.`);
      setTimeout(() => setOfferPriceMsg(null), 3500);
    } catch (e: any) {
      alert(e.message || 'Error updating offer price');
    } finally {
      setSavingOfferPrice(false);
    }
  };

  const handleCreateReferralLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingLink(true);
    setLinkError(null);
    try {
      const res = await fetch('/api/partner/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({
          code: newLinkCode.trim().toUpperCase() || undefined,
          label: newLinkLabel.trim() || undefined,
          offerPrice: newLinkPrice
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not create referral link.');
      setPartnerProfile((prev: any) => ({
        ...(prev || {}),
        links: [body.link, ...((prev && prev.links) || [])]
      }));
      setShowCreateLinkModal(false);
      setNewLinkCode('');
      setNewLinkLabel('');
      setNewLinkPrice(399);
    } catch (e: any) {
      setLinkError(e.message || 'Error creating link');
    } finally {
      setCreatingLink(false);
    }
  };

  const handleUpdateReferralLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLink) return;
    setSavingEditLink(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/partner/links/${editingLink.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({
          code: editLinkCode.trim().toUpperCase(),
          label: editLinkLabel.trim(),
          offerPrice: editLinkPrice
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not update link.');
      setPartnerProfile((prev: any) => ({
        ...(prev || {}),
        links: (prev?.links || []).map((l: any) => l.id === editingLink.id ? body.link : l)
      }));
      setEditingLink(null);
    } catch (e: any) {
      setLinkError(e.message || 'Error updating link');
    } finally {
      setSavingEditLink(false);
    }
  };

  const handleToggleLinkActive = async (link: PartnerReferralLink) => {
    try {
      const res = await fetch(`/api/partner/links/${link.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ isActive: !link.isActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not toggle link status.');
      setPartnerProfile((prev: any) => ({
        ...(prev || {}),
        links: (prev?.links || []).map((l: any) => l.id === link.id ? body.link : l)
      }));
    } catch (e: any) {
      alert(e.message || 'Error toggling link status');
    }
  };

  const handleDeleteReferralLink = async (link: PartnerReferralLink) => {
    if (!confirm(`Delete referral link ${link.code}? Traders using this link will no longer receive the offer.`)) return;
    try {
      const res = await fetch(`/api/partner/links/${link.id}`, {
        method: 'DELETE',
        headers: { ...getAuthHeaders() },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Could not delete link.');
      setPartnerProfile((prev: any) => ({
        ...(prev || {}),
        links: (prev?.links || []).filter((l: any) => l.id !== link.id)
      }));
    } catch (e: any) {
      alert(e.message || 'Error deleting link');
    }
  };

  return (
    <>
      {/* Mentor Partner Referral Pricing & Console */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-950/40 via-violet-950/30 to-slate-900/90 border border-purple-500/30 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-purple-500/20">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30">
                <Ticket className="h-4 w-4" />
              </span>
              <h3 className="text-base font-extrabold text-white tracking-tight">Mentor Referral Pricing & Income Hub</h3>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
                Standard Price: ₹499/mo
              </span>
            </div>
            <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
              Set student offer prices between <strong className="text-white">₹199 and ₹499</strong>. Students see <span className="line-through text-slate-400">₹499</span> crossed out and pay your offer price. Your referral income is automatically calculated as: <strong className="text-emerald-400">Student Pays - ₹199</strong>.
            </p>
            {couponSaveMsg && (
              <p className="text-xs text-emerald-400 font-semibold mt-1.5 animate-fade-in flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5" /> {couponSaveMsg}
              </p>
            )}
            {offerPriceMsg && (
              <p className="text-xs text-emerald-400 font-semibold mt-1.5 animate-fade-in flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5" /> {offerPriceMsg}
              </p>
            )}
          </div>

          {/* Action Hub (Primary Coupon & Link) */}
          <div className="flex flex-wrap items-center gap-2.5">
            {editingCoupon ? (
              <div className="flex items-center gap-2 bg-slate-950/90 border border-purple-500/50 rounded-xl p-1.5">
                <input
                  type="text"
                  value={draftCouponCode}
                  onChange={(e) => setDraftCouponCode(e.target.value.toUpperCase())}
                  placeholder="CUSTOMCODE"
                  className="px-2.5 py-1 text-xs font-mono font-bold bg-slate-900 text-white rounded-lg border border-purple-500/40 w-28 uppercase focus:outline-none focus:border-purple-400"
                />
                <button
                  type="button"
                  onClick={handleSaveCouponCode}
                  disabled={savingCoupon}
                  className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition cursor-pointer"
                >
                  {savingCoupon ? '...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingCoupon(false)}
                  className="p-1 text-slate-400 hover:text-white transition cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-slate-950/80 border border-purple-500/30 rounded-xl px-3 py-1.5 shadow-sm">
                <span className="text-[10px] text-slate-400 font-semibold uppercase">Coupon:</span>
                <span className="font-mono text-sm font-black text-purple-300 tracking-wider">
                  {partnerProfile?.referralCode || 'MENTOR60'}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyCoupon(partnerProfile?.referralCode || 'MENTOR60')}
                  className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-[11px] flex items-center gap-1 transition cursor-pointer"
                >
                  {copiedCoupon === (partnerProfile?.referralCode || 'MENTOR60') ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  <span>{copiedCoupon === (partnerProfile?.referralCode || 'MENTOR60') ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditingCoupon(true)}
                  title="Edit custom code"
                  className="p-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => handleCopyRefLink(partnerProfile?.referralUrl || `${window.location.origin}/?ref=${partnerProfile?.referralCode || 'MENTOR60'}`)}
              className="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
            >
              {copiedRefLink === (partnerProfile?.referralUrl || `${window.location.origin}/?ref=${partnerProfile?.referralCode || 'MENTOR60'}`) ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Link2 className="h-3.5 w-3.5 text-violet-400" />}
              <span>{copiedRefLink === (partnerProfile?.referralUrl || `${window.location.origin}/?ref=${partnerProfile?.referralCode || 'MENTOR60'}`) ? 'Link Copied!' : 'Copy Referral Link'}</span>
            </button>
          </div>
        </div>

        {/* Dynamic Offer Price Slider & Live Income Calculator */}
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          <div className="lg:col-span-7 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="h-3.5 w-3.5 text-purple-400" />
                Student Offer Price Slider:
              </label>
              <span className="text-xs text-slate-400">
                Range: <strong className="text-slate-200">₹199 – ₹499</strong>
              </span>
            </div>

            {/* Range Slider */}
            <div className="space-y-2">
              <input
                type="range"
                min={199}
                max={499}
                step={10}
                value={currentOfferPrice}
                onChange={(e) => setCurrentOfferPrice(Number(e.target.value))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
              />
              <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                <span>₹199 (Max Discount)</span>
                <span>₹299</span>
                <span>₹399</span>
                <span>₹499 (Full Price)</span>
              </div>
            </div>

            {/* Preset Buttons */}
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { price: 499, label: '₹499 (Standard)', earns: 300 },
                { price: 399, label: '₹399 (20% Off)', earns: 200 },
                { price: 299, label: '₹299 (40% Off)', earns: 100 },
                { price: 199, label: '₹199 (Max Discount)', earns: 0 },
              ].map((p) => (
                <button
                  key={p.price}
                  type="button"
                  onClick={() => {
                    setCurrentOfferPrice(p.price);
                    handleSaveOfferPrice(p.price);
                  }}
                  className={`px-2.5 py-1 text-[11px] rounded-lg border font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                    currentOfferPrice === p.price
                      ? 'bg-purple-600/30 border-purple-500 text-purple-200 shadow-sm'
                      : 'bg-slate-900/60 border-slate-700/60 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <span>{p.label}</span>
                  <span className="text-[10px] text-emerald-400 font-bold">Earn ₹{p.earns}</span>
                </button>
              ))}
              {currentOfferPrice !== (partnerProfile?.offerPrice || 499) && (
                <button
                  type="button"
                  onClick={() => handleSaveOfferPrice(currentOfferPrice)}
                  disabled={savingOfferPrice}
                  className="px-3 py-1 text-[11px] rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition cursor-pointer shadow-sm ml-auto"
                >
                  {savingOfferPrice ? 'Saving...' : 'Apply Price'}
                </button>
              )}
            </div>
          </div>

          {/* Live Preview Display Box */}
          <div className="lg:col-span-5 p-4 rounded-xl bg-slate-950/80 border border-purple-500/25 space-y-3">
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
              Live Conversion Preview
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1 border-t border-white/[0.06]">
              <div>
                <span className="text-[11px] text-slate-400 block">Student Sees & Pays:</span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="line-through text-slate-500 text-sm">₹499</span>
                  <span className="text-2xl font-black text-emerald-400 font-display">₹{currentOfferPrice}</span>
                </div>
                <span className="text-[10px] text-emerald-300 font-medium">
                  Student saves ₹{499 - currentOfferPrice}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block">Your Referral Income:</span>
                <div className="text-2xl font-black text-purple-300 font-display mt-0.5">
                  ₹{Math.max(0, currentOfferPrice - 199)}
                </div>
                <span className="text-[10px] text-slate-400 font-medium">
                  Platform floor: ₹199
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Custom Referral Links & Campaign Manager */}
        <div className="mt-5 pt-4 border-t border-purple-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-violet-400" />
                Referral Links & Campaigns
              </h4>
              <p className="text-[11px] text-slate-400">
                Create, edit, manage, or revoke custom referral links with unique offer prices.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateLinkModal(true)}
              className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-sm self-start sm:self-auto"
            >
              <Plus className="h-3.5 w-3.5" />
              Create New Referral Link
            </button>
          </div>

          {/* Links Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/90 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Campaign / Code</th>
                  <th className="py-2.5 px-3">Student Pays</th>
                  <th className="py-2.5 px-3">Your Income</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {/* Primary Link Row */}
                <tr className="hover:bg-white/[0.02] transition">
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                        {partnerProfile?.referralCode || 'MENTOR60'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-semibold">(Primary Default)</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="line-through text-slate-500 mr-1.5 text-[11px]">₹499</span>
                    <strong className="text-emerald-400 font-bold">₹{currentOfferPrice}</strong>
                  </td>
                  <td className="py-2.5 px-3">
                    <strong className="text-purple-300 font-bold">₹{Math.max(0, currentOfferPrice - 199)}</strong>
                    <span className="text-[10px] text-slate-500 ml-1">/ upgrade</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      Active
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleCopyRefLink(partnerProfile?.referralUrl || `${window.location.origin}/?ref=${partnerProfile?.referralCode || 'MENTOR60'}`)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold inline-flex items-center gap-1 transition cursor-pointer"
                    >
                      {copiedRefLink === (partnerProfile?.referralUrl || `${window.location.origin}/?ref=${partnerProfile?.referralCode || 'MENTOR60'}`) ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      Copy Link
                    </button>
                  </td>
                </tr>

                {/* Custom Links Rows */}
                {(partnerProfile?.links || []).map((link) => (
                  <tr key={link.id} className="hover:bg-white/[0.02] transition">
                    <td className="py-2.5 px-3">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                            {link.code}
                          </span>
                          <span className="text-[11px] text-slate-300 font-medium">{link.label || 'Custom Offer'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="line-through text-slate-500 mr-1.5 text-[11px]">₹499</span>
                      <strong className="text-emerald-400 font-bold">₹{link.offerPrice}</strong>
                    </td>
                    <td className="py-2.5 px-3">
                      <strong className="text-purple-300 font-bold">₹{Math.max(0, link.offerPrice - 199)}</strong>
                      <span className="text-[10px] text-slate-500 ml-1">/ upgrade</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        link.isActive
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                      }`}>
                        {link.isActive ? 'Active' : 'Revoked'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleCopyRefLink(link.referralUrl || `${window.location.origin}/?ref=${link.code}`)}
                          className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold inline-flex items-center gap-1 transition cursor-pointer"
                          title="Copy Link"
                        >
                          {copiedRefLink === (link.referralUrl || `${window.location.origin}/?ref=${link.code}`) ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingLink(link);
                            setEditLinkCode(link.code);
                            setEditLinkLabel(link.label || '');
                            setEditLinkPrice(link.offerPrice);
                          }}
                          className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                          title="Edit link"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleLinkActive(link)}
                          className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 ${
                            link.isActive
                              ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/25'
                              : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/25'
                          }`}
                          title={link.isActive ? 'Revoke link' : 'Reactivate link'}
                        >
                          {link.isActive ? 'Revoke' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteReferralLink(link)}
                          className="p-1 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition cursor-pointer"
                          title="Delete link"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {/* Modal: Create New Referral Link */}
      {showCreateLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-purple-500/30 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Ticket className="h-5 w-5 text-purple-400" />
                <h3 className="font-bold text-base text-white">Create New Referral Link</h3>
              </div>
              <button
                type="button"
                onClick={() => { setShowCreateLinkModal(false); setLinkError(null); }}
                className="p-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {linkError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{linkError}</span>
              </div>
            )}

            <form onSubmit={handleCreateReferralLink} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Campaign Label (Optional)</label>
                <input
                  type="text"
                  value={newLinkLabel}
                  onChange={(e) => setNewLinkLabel(e.target.value)}
                  placeholder="e.g. YouTube Special, VIP Batch, Telegram"
                  className="bg-slate-950 border border-slate-700 text-white text-xs rounded-xl p-3 w-full focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Coupon / Referral Code</label>
                <input
                  type="text"
                  value={newLinkCode}
                  onChange={(e) => setNewLinkCode(e.target.value.toUpperCase())}
                  placeholder="e.g. VIP399 (leave blank to auto-generate)"
                  className="bg-slate-950 border border-slate-700 text-white font-mono text-xs rounded-xl p-3 w-full uppercase focus:outline-none focus:border-violet-500 tracking-wider"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-300">Student Offer Price</label>
                  <span className="text-xs font-bold text-emerald-400">₹{newLinkPrice}</span>
                </div>
                <input
                  type="range"
                  min={199}
                  max={499}
                  step={10}
                  value={newLinkPrice}
                  onChange={(e) => setNewLinkPrice(Number(e.target.value))}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[
                    { price: 499, label: '₹499 (Standard)', earns: 300 },
                    { price: 399, label: '₹399 (20% Off)', earns: 200 },
                    { price: 299, label: '₹299 (40% Off)', earns: 100 },
                    { price: 199, label: '₹199 (Max Discount)', earns: 0 },
                  ].map((p) => (
                    <button
                      key={p.price}
                      type="button"
                      onClick={() => setNewLinkPrice(p.price)}
                      className={`px-2 py-1 text-[10px] rounded-lg border font-semibold transition cursor-pointer ${
                        newLinkPrice === p.price
                          ? 'bg-purple-600/30 border-purple-500 text-purple-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Conversion Preview */}
              <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-500/20 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Student Pays:</span>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="line-through text-slate-500 text-[11px]">₹499</span>
                    <strong className="text-emerald-400 font-bold text-base">₹{newLinkPrice}</strong>
                  </div>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">You Earn:</span>
                  <strong className="text-purple-300 font-bold text-base mt-0.5 block">
                    ₹{Math.max(0, newLinkPrice - 199)}
                  </strong>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowCreateLinkModal(false); setLinkError(null); }}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingLink}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {creatingLink ? 'Creating...' : 'Create Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal: Edit Referral Link */}
      {editingLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-purple-500/30 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Pencil className="h-4 w-4 text-purple-400" />
                <h3 className="font-bold text-base text-white">Edit Referral Link</h3>
              </div>
              <button
                type="button"
                onClick={() => { setEditingLink(null); setLinkError(null); }}
                className="p-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {linkError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{linkError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateReferralLink} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Campaign Label</label>
                <input
                  type="text"
                  value={editLinkLabel}
                  onChange={(e) => setEditLinkLabel(e.target.value)}
                  placeholder="Campaign Label"
                  className="bg-slate-950 border border-slate-700 text-white text-xs rounded-xl p-3 w-full focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Coupon / Referral Code</label>
                <input
                  type="text"
                  value={editLinkCode}
                  onChange={(e) => setEditLinkCode(e.target.value.toUpperCase())}
                  required
                  className="bg-slate-950 border border-slate-700 text-white font-mono text-xs rounded-xl p-3 w-full uppercase focus:outline-none focus:border-violet-500 tracking-wider"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-300">Student Offer Price</label>
                  <span className="text-xs font-bold text-emerald-400">₹{editLinkPrice}</span>
                </div>
                <input
                  type="range"
                  min={199}
                  max={499}
                  step={10}
                  value={editLinkPrice}
                  onChange={(e) => setEditLinkPrice(Number(e.target.value))}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[
                    { price: 499, label: '₹499 (Standard)', earns: 300 },
                    { price: 399, label: '₹399 (20% Off)', earns: 200 },
                    { price: 299, label: '₹299 (40% Off)', earns: 100 },
                    { price: 199, label: '₹199 (Max Discount)', earns: 0 },
                  ].map((p) => (
                    <button
                      key={p.price}
                      type="button"
                      onClick={() => setEditLinkPrice(p.price)}
                      className={`px-2 py-1 text-[10px] rounded-lg border font-semibold transition cursor-pointer ${
                        editLinkPrice === p.price
                          ? 'bg-purple-600/30 border-purple-500 text-purple-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Conversion Preview */}
              <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-500/20 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Student Pays:</span>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="line-through text-slate-500 text-[11px]">₹499</span>
                    <strong className="text-emerald-400 font-bold text-base">₹{editLinkPrice}</strong>
                  </div>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">You Earn:</span>
                  <strong className="text-purple-300 font-bold text-base mt-0.5 block">
                    ₹{Math.max(0, editLinkPrice - 199)}
                  </strong>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setEditingLink(null); setLinkError(null); }}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEditLink}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {savingEditLink ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

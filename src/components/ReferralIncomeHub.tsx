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
export interface PartnerReferralLink {
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

export interface ReferralIncomeHubProps {
  selectedCampaignCode?: string;
  onSelectCampaign?: (code: string) => void;
  onPartnerProfileUpdate?: (updated: any) => void;
}

export default function ReferralIncomeHub({
  selectedCampaignCode,
  onSelectCampaign,
  onPartnerProfileUpdate,
}: ReferralIncomeHubProps = {}) {

  const [partnerProfile, setPartnerProfile] = useState<{
    referralCode: string;
    referralUrl: string;
    name?: string;
    offerPrice?: number;
    standardPrice?: number;
    mentorEarns?: number;
    links?: PartnerReferralLink[];
  } | null>(null);

  const [copiedItem, setCopiedItem] = useState<{ id: string; type: 'link' | 'code' } | null>(null);
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
  const [deletingLink, setDeletingLink] = useState<PartnerReferralLink | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Sent alongside the cookie, matching the rest of the app's fetches.
  const getAuthHeaders = (): Record<string, string> => {
    const userId = sessionStorage.getItem('auth_user_id') || localStorage.getItem('auth_user_id') || '';
    const email = sessionStorage.getItem('auth_email') || localStorage.getItem('auth_email') || '';
    const headers: Record<string, string> = {};
    if (userId) headers['x-auth-user-id'] = userId;
    if (email) headers['x-auth-email'] = email;
    return headers;
  };

  // Listen to open-create-partner-link and open-edit-partner-link events from hero cards
  useEffect(() => {
    const handleOpenCreate = () => {
      setLinkError(null);
      setShowCreateLinkModal(true);
    };
    const handleOpenEdit = (e: any) => {
      if (e.detail?.link) {
        setLinkError(null);
        setEditingLink(e.detail.link);
        setEditLinkCode(e.detail.link.code);
        setEditLinkLabel(e.detail.link.label || '');
        setEditLinkPrice(e.detail.link.offerPrice);
      }
    };
    window.addEventListener('open-create-partner-link', handleOpenCreate);
    window.addEventListener('open-edit-partner-link', handleOpenEdit);
    return () => {
      window.removeEventListener('open-create-partner-link', handleOpenCreate);
      window.removeEventListener('open-edit-partner-link', handleOpenEdit);
    };
  }, []);

  // Fetch partner profile on mount
  useEffect(() => {
    let alive = true;
    fetch('/api/partner/me', { headers: getAuthHeaders(), credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (!alive || !data?.referralCode) return;
        setPartnerProfile(data);
        setDraftCouponCode(data.referralCode);
        if (typeof data.offerPrice === 'number') setCurrentOfferPrice(data.offerPrice);
        onPartnerProfileUpdate?.(data);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const handleCopyRefLink = async (val: string, id: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(val);
      } else {
        const el = document.createElement('textarea');
        el.value = val;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopiedItem({ id, type: 'link' });
      setTimeout(() => setCopiedItem(null), 2000);
    } catch {}
  };

  const handleCopyCoupon = async (val: string, id: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(val);
      } else {
        const el = document.createElement('textarea');
        el.value = val;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopiedItem({ id, type: 'code' });
      setTimeout(() => setCopiedItem(null), 2000);
    } catch {}
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
      const updated = { ...(partnerProfile || {}), referralCode: body.referralCode, referralUrl: body.referralUrl };
      setPartnerProfile(updated as any);
      onPartnerProfileUpdate?.(updated);
      if (selectedCampaignCode === partnerProfile?.referralCode) {
        onSelectCampaign?.(body.referralCode);
      }
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
      const updated = {
        ...(partnerProfile || {}),
        offerPrice: body.offerPrice,
        mentorEarns: body.mentorEarns,
      };
      setPartnerProfile(updated as any);
      onPartnerProfileUpdate?.(updated);
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
          offerPrice: newLinkPrice,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not create referral link.');
      
      const updatedLinks = [body.link, ...((partnerProfile && partnerProfile.links) || [])];
      const updatedProfile = {
        ...(partnerProfile || {}),
        links: updatedLinks,
      };
      setPartnerProfile(updatedProfile as any);
      onPartnerProfileUpdate?.(updatedProfile);
      
      // Auto-select this newly created link into top cards!
      onSelectCampaign?.(body.link.code);
      
      setShowCreateLinkModal(false);
      setNewLinkCode('');
      setNewLinkLabel('');
      setNewLinkPrice(399);
      setCouponSaveMsg(`Referral link ${body.link.code} created and selected at the top!`);
      setTimeout(() => setCouponSaveMsg(null), 4000);
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
          offerPrice: editLinkPrice,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not update link.');
      
      const updatedLinks = (partnerProfile?.links || []).map((l: any) => l.id === editingLink.id ? body.link : l);
      const updatedProfile = {
        ...(partnerProfile || {}),
        links: updatedLinks,
      };
      setPartnerProfile(updatedProfile as any);
      onPartnerProfileUpdate?.(updatedProfile);
      
      if (selectedCampaignCode === editingLink.code && body.link.code !== editingLink.code) {
        onSelectCampaign?.(body.link.code);
      }
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
      
      const updatedLinks = (partnerProfile?.links || []).map((l: any) => l.id === link.id ? body.link : l);
      const updatedProfile = {
        ...(partnerProfile || {}),
        links: updatedLinks,
      };
      setPartnerProfile(updatedProfile as any);
      onPartnerProfileUpdate?.(updatedProfile);
    } catch (e: any) {
      alert(e.message || 'Error toggling link status');
    }
  };

  const executeDeleteReferralLink = async () => {
    if (!deletingLink) return;
    setIsDeleting(true);
    try {
      const linkId = deletingLink.id || deletingLink.code;
      const res = await fetch(`/api/partner/links/${encodeURIComponent(linkId)}`, {
        method: 'DELETE',
        headers: { ...getAuthHeaders() },
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not delete referral link.');
      
      const updatedLinks = (partnerProfile?.links || []).filter(
        (l: any) => l.id !== deletingLink.id && l.code !== deletingLink.code
      );
      const updatedProfile = {
        ...(partnerProfile || {}),
        links: updatedLinks,
      };
      setPartnerProfile(updatedProfile as any);
      onPartnerProfileUpdate?.(updatedProfile);
      
      if (selectedCampaignCode === deletingLink.code) {
        onSelectCampaign?.(partnerProfile?.referralCode || '');
      }
      
      setCouponSaveMsg(`Referral link "${deletingLink.code}" deleted successfully.`);
      setTimeout(() => setCouponSaveMsg(null), 3500);
      setDeletingLink(null);
    } catch (e: any) {
      alert(e.message || 'Error deleting link');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      {/* Mentor Partner Referral Pricing & Console */}
      <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-purple-950/40 via-violet-950/30 to-slate-900/90 border border-purple-500/30 shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 pb-2.5 border-b border-purple-500/20">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="p-1 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30">
                <Ticket className="h-3.5 w-3.5" />
              </span>
              <h3 className="text-sm sm:text-base font-extrabold text-white tracking-tight">Mentor Referral Pricing & Income Hub</h3>
              <span className="text-[9.5px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
                Standard Price: ₹499/mo
              </span>
            </div>
            <p className="text-[11px] text-slate-300 max-w-3xl leading-snug">
              Set student offer prices between <strong className="text-white">₹199 and ₹499</strong>. Students see <span className="line-through text-slate-400">₹499</span> crossed out and pay your offer price. Your referral income is automatically calculated as: <strong className="text-emerald-400">Student Pays - ₹199</strong>.
            </p>
            {couponSaveMsg && (
              <p className="text-[11px] text-emerald-400 font-semibold mt-1 animate-fade-in flex items-center gap-1.5">
                <CheckCircle className="h-3 w-3" /> {couponSaveMsg}
              </p>
            )}
            {offerPriceMsg && (
              <p className="text-[11px] text-emerald-400 font-semibold mt-1 animate-fade-in flex items-center gap-1.5">
                <CheckCircle className="h-3 w-3" /> {offerPriceMsg}
              </p>
            )}
          </div>
        </div>

        {/* Dynamic Offer Price Slider & Live Income Calculator */}
        <div className="mt-3.5 grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-center">
          <div className="lg:col-span-7 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="h-3 w-3 text-purple-400" />
                Student Offer Price Slider:
              </label>
              <span className="text-[11px] text-slate-400">
                Range: <strong className="text-slate-200">₹199 – ₹499</strong>
              </span>
            </div>

            {/* Range Slider */}
            <div className="space-y-1">
              <input
                type="range"
                min={199}
                max={499}
                step={10}
                value={currentOfferPrice}
                onChange={(e) => setCurrentOfferPrice(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>₹199 (Max Discount)</span>
                <span>₹299</span>
                <span>₹399</span>
                <span>₹499 (Full Price)</span>
              </div>
            </div>

            {/* Preset Buttons */}
            <div className="flex flex-wrap gap-1.5 pt-0.5">
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
                  className={`px-2 py-0.5 text-[10.5px] rounded-md border font-semibold transition cursor-pointer flex items-center gap-1 ${
                    currentOfferPrice === p.price
                      ? 'bg-purple-600/30 border-purple-500 text-purple-200 shadow-xs'
                      : 'bg-slate-900/60 border-slate-700/60 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <span>{p.label}</span>
                  <span className="text-[9.5px] text-emerald-400 font-bold">Earn ₹{p.earns}</span>
                </button>
              ))}
              {currentOfferPrice !== (partnerProfile?.offerPrice || 499) && (
                <button
                  type="button"
                  onClick={() => handleSaveOfferPrice(currentOfferPrice)}
                  disabled={savingOfferPrice}
                  className="px-2.5 py-0.5 text-[10.5px] rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition cursor-pointer shadow-xs ml-auto"
                >
                  {savingOfferPrice ? 'Saving...' : 'Apply Price'}
                </button>
              )}
            </div>
          </div>

          {/* Live Preview Display Box */}
          <div className="lg:col-span-5 p-2.5 sm:p-3 rounded-xl bg-slate-950/80 border border-purple-500/25 space-y-1.5">
            <div className="text-[9.5px] uppercase font-bold tracking-wider text-slate-400">
              Live Conversion Preview
            </div>
            <div className="grid grid-cols-2 gap-2.5 pt-1 border-t border-white/[0.06]">
              <div>
                <span className="text-[10px] text-slate-400 block">Student Sees & Pays:</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="line-through text-slate-500 text-xs">₹499</span>
                  <span className="text-xl font-black text-emerald-400 font-display">₹{currentOfferPrice}</span>
                </div>
                <span className="text-[9.5px] text-emerald-300 font-medium">
                  Student saves ₹{499 - currentOfferPrice}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Your Referral Income:</span>
                <div className="text-xl font-black text-purple-300 font-display mt-0.5">
                  ₹{Math.max(0, currentOfferPrice - 199)}
                </div>
                <span className="text-[9.5px] text-slate-400 font-medium">
                  Platform floor: ₹199
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Custom Referral Links & Campaign Manager */}
        <div className="mt-3.5 pt-3 border-t border-purple-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Link2 className="h-3 w-3 text-violet-400" />
                Referral Links & Campaigns
              </h4>
              <p className="text-[10.5px] text-slate-400">
                Create, edit, manage, or revoke custom referral links with unique offer prices.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateLinkModal(true)}
              className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-bold text-[11px] flex items-center gap-1 transition cursor-pointer shadow-xs self-start sm:self-auto"
            >
              <Plus className="h-3 w-3" />
              Create New Referral Link
            </button>
          </div>

          {/* Links Table (Desktop: hidden on mobile) */}
          <div className="hidden sm:block overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/90 text-[9px] uppercase font-bold text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-1.5 px-3">Campaign / Code</th>
                  <th className="py-1.5 px-3">Student Pays</th>
                  <th className="py-1.5 px-3">Your Income</th>
                  <th className="py-1.5 px-3">Status</th>
                  <th className="py-1.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {/* Primary Link Row */}
                <tr className={`hover:bg-white/[0.02] transition ${selectedCampaignCode === (partnerProfile?.referralCode || 'MENTOR60') || !selectedCampaignCode ? 'bg-violet-950/20' : ''}`}>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded-lg border border-violet-500/20 text-xs">
                        {partnerProfile?.referralCode || 'MENTOR60'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-semibold">(Primary Default)</span>
                      {(selectedCampaignCode === (partnerProfile?.referralCode || 'MENTOR60') || !selectedCampaignCode) && (
                        <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                          Active at Top
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="line-through text-slate-500 mr-1.5 text-xs">₹499</span>
                    <strong className="text-emerald-400 font-bold text-xs">₹{currentOfferPrice}</strong>
                  </td>
                  <td className="py-2.5 px-3">
                    <strong className="text-purple-300 font-bold text-xs">₹{Math.max(0, currentOfferPrice - 199)}</strong>
                    <span className="text-[10px] text-slate-500 ml-1">/ upgrade</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded-full text-[9.5px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      Active
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                      {/* Copy Link */}
                      <button
                        type="button"
                        onClick={() => handleCopyRefLink(partnerProfile?.referralUrl || `${window.location.origin}/?ref=${partnerProfile?.referralCode || 'MENTOR60'}`, 'primary')}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10.5px] font-semibold inline-flex items-center gap-1.5 transition cursor-pointer border border-slate-700"
                        title="Copy full referral link"
                      >
                        {copiedItem?.id === 'primary' && copiedItem?.type === 'link' ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400" />
                            <span className="text-emerald-300 font-bold">Copied Link!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 text-slate-400" />
                            <span>Copy Link</span>
                          </>
                        )}
                      </button>

                      {/* Copy Code */}
                      <button
                        type="button"
                        onClick={() => handleCopyCoupon(partnerProfile?.referralCode || 'MENTOR60', 'primary')}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10.5px] font-semibold inline-flex items-center gap-1.5 transition cursor-pointer border border-slate-700"
                        title="Copy coupon code only"
                      >
                        {copiedItem?.id === 'primary' && copiedItem?.type === 'code' ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400" />
                            <span className="text-emerald-300 font-bold">Copied Code!</span>
                          </>
                        ) : (
                          <>
                            <Ticket className="h-3 w-3 text-violet-400" />
                            <span>Copy Code</span>
                          </>
                        )}
                      </button>

                      {/* Select for top hero */}
                      <button
                        type="button"
                        onClick={() => onSelectCampaign?.(partnerProfile?.referralCode || '')}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer flex items-center gap-1 ${
                          selectedCampaignCode === partnerProfile?.referralCode || !selectedCampaignCode
                            ? 'bg-violet-600/30 text-violet-300 border border-violet-500/40 shadow-xs'
                            : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                        }`}
                        title="View and copy in top cards"
                      >
                        {selectedCampaignCode === partnerProfile?.referralCode || !selectedCampaignCode ? (
                          <>
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                            Active at Top
                          </>
                        ) : (
                          'Use at Top'
                        )}
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Custom Links Rows */}
                {(partnerProfile?.links || []).map((link) => {
                  const isSelected = selectedCampaignCode === link.code;
                  return (
                    <tr key={link.id} className={`hover:bg-white/[0.02] transition ${isSelected ? 'bg-violet-950/20' : ''}`}>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded-lg border border-violet-500/20 text-xs">
                            {link.code}
                          </span>
                          <span className="text-xs text-slate-300 font-medium">{link.label || 'Custom Offer'}</span>
                          {isSelected && (
                            <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                              Active at Top
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="line-through text-slate-500 mr-1.5 text-xs">₹499</span>
                        <strong className="text-emerald-400 font-bold text-xs">₹{link.offerPrice}</strong>
                      </td>
                      <td className="py-2.5 px-3">
                        <strong className="text-purple-300 font-bold text-xs">₹{Math.max(0, link.offerPrice - 199)}</strong>
                        <span className="text-[10px] text-slate-500 ml-1">/ upgrade</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[9.5px] font-semibold border ${
                          link.isActive
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                        }`}>
                          {link.isActive ? 'Active' : 'Revoked'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                          {/* Copy Link */}
                          <button
                            type="button"
                            onClick={() => handleCopyRefLink(link.referralUrl || `${window.location.origin}/?ref=${encodeURIComponent(link.code)}`, link.id)}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10.5px] font-semibold inline-flex items-center gap-1.5 transition cursor-pointer border border-slate-700"
                            title="Copy full referral link"
                          >
                            {copiedItem?.id === link.id && copiedItem?.type === 'link' ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-400" />
                                <span className="text-emerald-300 font-bold">Copied Link!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3 text-slate-400" />
                                <span>Copy Link</span>
                              </>
                            )}
                          </button>

                          {/* Copy Code */}
                          <button
                            type="button"
                            onClick={() => handleCopyCoupon(link.code, link.id)}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10.5px] font-semibold inline-flex items-center gap-1.5 transition cursor-pointer border border-slate-700"
                            title="Copy coupon code only"
                          >
                            {copiedItem?.id === link.id && copiedItem?.type === 'code' ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-400" />
                                <span className="text-emerald-300 font-bold">Copied Code!</span>
                              </>
                            ) : (
                              <>
                                <Ticket className="h-3 w-3 text-violet-400" />
                                <span>Copy Code</span>
                              </>
                            )}
                          </button>

                          {/* Select for top hero */}
                          <button
                            type="button"
                            onClick={() => onSelectCampaign?.(link.code)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer flex items-center gap-1 ${
                              isSelected
                                ? 'bg-violet-600/30 text-violet-300 border border-violet-500/40 shadow-xs'
                                : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                            }`}
                            title="View and copy in top cards"
                          >
                            {isSelected ? (
                              <>
                                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                                Active at Top
                              </>
                            ) : (
                              'Use at Top'
                            )}
                          </button>

                          {/* Edit */}
                          <button
                            type="button"
                            onClick={() => {
                              setEditingLink(link);
                              setEditLinkCode(link.code);
                              setEditLinkLabel(link.label || '');
                              setEditLinkPrice(link.offerPrice);
                            }}
                            className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer border border-slate-700"
                            title="Edit campaign"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>

                          {/* Toggle Active / Revoke */}
                          <button
                            type="button"
                            onClick={() => handleToggleLinkActive(link)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition cursor-pointer ${
                              link.isActive
                                ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/25'
                                : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/25'
                            }`}
                            title={link.isActive ? 'Revoke link' : 'Reactivate link'}
                          >
                            {link.isActive ? 'Revoke' : 'Activate'}
                          </button>

                          {/* Delete */}
                          <button
                            type="button"
                            onClick={() => setDeletingLink(link)}
                            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition cursor-pointer border border-slate-700/60 hover:border-rose-500/30 active:scale-95"
                            title="Delete link"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List (sm:hidden: clean, aligned, fully visible on phones) */}
          <div className="sm:hidden flex flex-col gap-2.5">
            {/* Primary Default Link Card */}
            <div className={`p-3 rounded-xl border transition ${
              selectedCampaignCode === (partnerProfile?.referralCode || 'MENTOR60') || !selectedCampaignCode
                ? 'bg-violet-950/30 border-violet-500/40 shadow-sm'
                : 'bg-slate-950/60 border-slate-800'
            }`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono font-bold text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded-lg border border-violet-500/20 text-xs">
                    {partnerProfile?.referralCode || 'MENTOR60'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-semibold truncate">(Primary Default)</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    Active
                  </span>
                  {(selectedCampaignCode === (partnerProfile?.referralCode || 'MENTOR60') || !selectedCampaignCode) && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                      Active at Top
                    </span>
                  )}
                </div>
              </div>

              {/* Pricing pill row */}
              <div className="grid grid-cols-2 gap-2 p-2 rounded-lg bg-slate-900/80 border border-slate-800/80 mb-2.5">
                <div>
                  <span className="text-[9px] text-slate-400 uppercase font-semibold block">Student Pays</span>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="line-through text-slate-500 text-[10px]">₹499</span>
                    <strong className="text-emerald-400 font-bold text-xs">₹{currentOfferPrice}</strong>
                  </div>
                </div>
                <div>
                  <span className="text-[9px] text-slate-400 uppercase font-semibold block">Your Income</span>
                  <div className="text-purple-300 font-bold text-xs mt-0.5">
                    ₹{Math.max(0, currentOfferPrice - 199)}
                    <span className="text-[9px] text-slate-500 font-normal ml-0.5">/ upgrade</span>
                  </div>
                </div>
              </div>

              {/* Actions button bar */}
              <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-800/60">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => handleCopyRefLink(partnerProfile?.referralUrl || `${window.location.origin}/?ref=${partnerProfile?.referralCode || 'MENTOR60'}`, 'primary')}
                    className="flex-1 py-1 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10.5px] font-semibold flex items-center justify-center gap-1 transition cursor-pointer border border-slate-700 truncate"
                  >
                    {copiedItem?.id === 'primary' && copiedItem?.type === 'link' ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                        <span className="text-emerald-300 font-bold">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3 text-slate-400 shrink-0" />
                        <span>Copy Link</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyCoupon(partnerProfile?.referralCode || 'MENTOR60', 'primary')}
                    className="py-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10.5px] font-semibold flex items-center gap-1 transition cursor-pointer border border-slate-700 shrink-0"
                  >
                    {copiedItem?.id === 'primary' && copiedItem?.type === 'code' ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                        <span className="text-emerald-300 font-bold">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Ticket className="h-3 w-3 text-violet-400 shrink-0" />
                        <span>Code</span>
                      </>
                    )}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectCampaign?.(partnerProfile?.referralCode || '')}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer shrink-0 ${
                    selectedCampaignCode === partnerProfile?.referralCode || !selectedCampaignCode
                      ? 'bg-violet-600/30 text-violet-300 border border-violet-500/40'
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {selectedCampaignCode === partnerProfile?.referralCode || !selectedCampaignCode ? 'Active at Top' : 'Use at Top'}
                </button>
              </div>
            </div>

            {/* Custom Referral Links Cards */}
            {(partnerProfile?.links || []).map((link) => {
              const isSelected = selectedCampaignCode === link.code;
              return (
                <div
                  key={link.id}
                  className={`p-3 rounded-xl border transition ${
                    isSelected
                      ? 'bg-violet-950/30 border-violet-500/40 shadow-sm'
                      : 'bg-slate-950/60 border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono font-bold text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded-lg border border-violet-500/20 text-xs">
                        {link.code}
                      </span>
                      <span className="text-xs text-slate-300 font-medium truncate">
                        {link.label || 'Custom Offer'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-semibold border ${
                        link.isActive
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                      }`}>
                        {link.isActive ? 'Active' : 'Revoked'}
                      </span>
                      {isSelected && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                          Active at Top
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Pricing pill row */}
                  <div className="grid grid-cols-2 gap-2 p-2 rounded-lg bg-slate-900/80 border border-slate-800/80 mb-2.5">
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-semibold block">Student Pays</span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="line-through text-slate-500 text-[10px]">₹499</span>
                        <strong className="text-emerald-400 font-bold text-xs">₹{link.offerPrice}</strong>
                      </div>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-semibold block">Your Income</span>
                      <div className="text-purple-300 font-bold text-xs mt-0.5">
                        ₹{Math.max(0, link.offerPrice - 199)}
                        <span className="text-[9px] text-slate-500 font-normal ml-0.5">/ upgrade</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions button bar */}
                  <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-800/60">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => handleCopyRefLink(link.referralUrl || `${window.location.origin}/?ref=${encodeURIComponent(link.code)}`, link.id)}
                        className="flex-1 py-1 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10.5px] font-semibold flex items-center justify-center gap-1 transition cursor-pointer border border-slate-700 truncate"
                      >
                        {copiedItem?.id === link.id && copiedItem?.type === 'link' ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                            <span className="text-emerald-300 font-bold">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 text-slate-400 shrink-0" />
                            <span>Copy Link</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyCoupon(link.code, link.id)}
                        className="py-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10.5px] font-semibold flex items-center gap-1 transition cursor-pointer border border-slate-700 shrink-0"
                      >
                        {copiedItem?.id === link.id && copiedItem?.type === 'code' ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                            <span className="text-emerald-300 font-bold">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Ticket className="h-3 w-3 text-violet-400 shrink-0" />
                            <span>Code</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onSelectCampaign?.(link.code)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                          isSelected
                            ? 'bg-violet-600/30 text-violet-300 border border-violet-500/40'
                            : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                        }`}
                      >
                        {isSelected ? 'Active at Top' : 'Use at Top'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEditingLink(link);
                          setEditLinkCode(link.code);
                          setEditLinkLabel(link.label || '');
                          setEditLinkPrice(link.offerPrice);
                        }}
                        className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer border border-slate-700"
                        title="Edit campaign"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleLinkActive(link)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition cursor-pointer ${
                          link.isActive
                            ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/25'
                            : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/25'
                        }`}
                      >
                        {link.isActive ? 'Revoke' : 'Activate'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setDeletingLink(link)}
                        className="p-1 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition cursor-pointer border border-slate-700"
                        title="Delete link"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
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

      {/* Modal: Delete Referral Link Confirmation */}
      {deletingLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-rose-500/30 rounded-2xl w-full max-w-sm p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base text-white">Delete Referral Link?</h3>
                <p className="text-xs text-slate-400">This action cannot be undone.</p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Referral Code:</span>
                <span className="font-mono font-bold text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                  {deletingLink.code}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Campaign:</span>
                <span className="text-slate-200 font-medium">{deletingLink.label || 'Custom Offer'}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Offer Price:</span>
                <span className="text-emerald-400 font-bold">₹{deletingLink.offerPrice}</span>
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Traders using this custom link will no longer receive this discount offer.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setDeletingLink(null)}
                disabled={isDeleting}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeDeleteReferralLink}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-rose-600/30 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{isDeleting ? 'Deleting...' : 'Delete Link'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

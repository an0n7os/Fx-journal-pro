import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, Pencil, Ticket, Users, X } from 'lucide-react';
import SubAdminConsole from './SubAdminConsole';
import ReferralIncomeHub from './ReferralIncomeHub';

interface PartnerMe {
  partnerId: string;
  name: string | null;
  referralCode: string;
  referralUrl: string;
}

/**
 * Partner Portal.
 *
 * Two parts: the partner's own referral identity (link and code, which they
 * can rename), and the read-only console over the users who signed up with it.
 * The console is the same component a sub-admin sees — the scoping, and the
 * per-user consent gate on trade data, are decided by the server from the
 * session's role, not by anything passed in here.
 */
export default function PartnerPortal() {
  const [me, setMe] = useState<PartnerMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftCode, setDraftCode] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/partner/me', { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not load your partner profile.');
      setMe(body);
      setDraftCode(body.referralCode || '');
    } catch (e: any) {
      setError(e.message || 'Could not load your partner profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Clipboard is unavailable on http origins and in some in-app browsers, so a
  // failure falls back to selecting the text rather than silently doing nothing.
  const copy = async (value: string, which: 'link' | 'code') => {
    try {
      await navigator.clipboard.writeText(value);
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
      setEditing(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dx-dark-surface space-y-6">
      {/* No heading here — the page header above the tab already says
          "Partner Portal", and repeating it stacked two titles on the screen. */}
      {error && (
        <div className="flex items-start justify-between gap-3 bg-red-500/10 border border-red-500/25 text-red-300 rounded-2xl px-4 py-3 text-xs">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* ── Referral identity ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Link2 className="h-4 w-4 text-violet-400" />
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Referral link</p>
          </div>
          <p className="font-mono text-[13px] text-slate-200 break-all leading-relaxed mb-4">
            {loading ? 'Loading…' : me?.referralUrl}
          </p>
          <button
            onClick={() => me && copy(me.referralUrl, 'link')}
            disabled={!me}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-4 py-2.5 text-xs font-bold text-white transition-colors"
          >
            {copied === 'link' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Ticket className="h-4 w-4 text-violet-400" />
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Referral code</p>
          </div>

          {editing ? (
            <>
              <input
                value={draftCode}
                onChange={(e) => setDraftCode(e.target.value.toUpperCase())}
                maxLength={16}
                autoFocus
                placeholder="YOURCODE"
                aria-label="Referral code"
                className="w-full bg-slate-950/60 border border-slate-700 focus:border-violet-500/60 rounded-xl px-3.5 py-2.5 font-mono text-lg tracking-[0.18em] text-white focus:outline-none mb-2"
              />
              <p className="text-[11px] text-slate-500 mb-4">4–16 letters and numbers. No spaces or symbols.</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={saveCode}
                  disabled={saving}
                  className="rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-4 py-2.5 text-xs font-bold text-white transition-colors"
                >
                  {saving ? 'Saving…' : 'Save code'}
                </button>
                <button
                  onClick={() => { setEditing(false); setDraftCode(me?.referralCode || ''); setError(''); }}
                  className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="font-mono text-2xl font-black tracking-[0.18em] text-white mb-4">
                {loading ? '…' : me?.referralCode}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => me && copy(me.referralCode, 'code')}
                  disabled={!me}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-4 py-2.5 text-xs font-bold text-white transition-colors"
                >
                  {copied === 'code' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied === 'code' ? 'Copied' : 'Copy code'}
                </button>
                <button
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" /> Customise
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Pricing, coupon and campaign links ───────────────────── */}
      <ReferralIncomeHub />

      {/* ── Referred Users Registry (Network) ────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-2xl border border-slate-800/80 bg-slate-900/40 px-4 py-3">
          <Users className="h-4 w-4 shrink-0 text-slate-500 mt-px" />
          <p className="text-[11px] leading-relaxed text-slate-500">
            You can always see who is in your network. Their trades, analysis and journal stay
            private until each user turns on <span className="text-slate-300 font-semibold">Allow Partner to
            View Trade Details</span> in their own settings — and they can turn it back off at any time.
          </p>
        </div>

        <SubAdminConsole variant="partner" />
      </div>
    </div>
  );
}

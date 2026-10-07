import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowUpRight, ExternalLink } from 'lucide-react';
import { LEGAL_DOCS, type LegalDocKey } from '../legalDocs';

const LINKS: { key: LegalDocKey; label: string; path: string }[] = [
  { key: 'terms', label: 'Terms & Conditions', path: '/terms-and-conditions' },
  { key: 'privacy', label: 'Privacy Policy', path: '/privacy-policy' },
  { key: 'refunds', label: 'Cancellation & Refund Policy', path: '/cancellation-and-refund-policy' },
  { key: 'shipping', label: 'Shipping & Delivery Policy', path: '/shipping-and-delivery' },
  { key: 'risk', label: 'Risk Disclosure', path: '/risk-disclosure' },
  { key: 'contact', label: 'Contact Us', path: '/contact-us' },
  { key: 'about', label: 'About Us', path: '/about-us' },
];

export default function LegalFooter() {
  const navigate = useNavigate();
  const [open, setOpen] = useState<LegalDocKey | null>(null);
  const doc = open ? LEGAL_DOCS[open] : null;

  return (
    <>
      <footer className="border-t border-slate-200/60 dark:border-white/[0.07] pt-5 pb-3 space-y-3.5">
        {/* Risk Warning Disclaimer */}
        <p className="text-[10.5px] leading-relaxed text-slate-400 dark:text-slate-500">
          <span className="font-semibold text-slate-500 dark:text-slate-400">Risk warning:</span>{' '}
          FXJournalPro is a software and analytics service and does not provide brokerage, investment management, trade execution, or financial advisory services. Trading financial instruments involves substantial risk. Users are solely responsible for their trading decisions and financial outcomes.
        </p>

        {/* Legal Links Row */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] pt-0.5">
          {LINKS.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => setOpen(l.key)}
              className="font-medium text-slate-400 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition whitespace-nowrap cursor-pointer"
            >
              {l.label}
            </button>
          ))}
        </div>

        {/* Copyright & Attribution Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[10px] text-slate-400 dark:text-slate-500 pt-2 border-t border-slate-100 dark:border-white/[0.04]">
          <span>&copy; {new Date().getFullYear()} FXJournalPro. All rights reserved.</span>
          <span className="inline-flex items-center gap-1 shrink-0">
            Built by{' '}
            <a
              href="https://brandliftonline.in"
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-700 dark:text-violet-500 hover:text-violet-800 dark:hover:text-violet-400 font-semibold underline decoration-violet-500/40 hover:decoration-violet-400 transition-colors inline-flex items-center gap-0.5"
            >
              Brandlift
              <ArrowUpRight className="h-2.5 w-2.5" />
            </a>
          </span>
        </div>
      </footer>

      {doc && open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
          onClick={() => setOpen(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={doc.title}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#0a0b12] border border-slate-200 dark:border-white/[0.1] rounded-2xl shadow-2xl max-w-xl w-full p-6"
            style={{ animation: 'modalIn 0.2s ease-out' }}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">{doc.title}</h3>
                {doc.lastUpdated && (
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">Last updated: {doc.lastUpdated}</p>
                )}
              </div>
              <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="h-80 overflow-y-auto p-4 bg-slate-50 dark:bg-white/[0.03] rounded-lg text-xs text-slate-600 dark:text-slate-300 leading-relaxed border border-slate-100 dark:border-white/[0.07] space-y-3">
              {doc.body.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
            <div className="flex items-center justify-between mt-4 pt-2">
              <button
                type="button"
                onClick={() => {
                  const target = LINKS.find(l => l.key === open)?.path || `/${open}`;
                  setOpen(null);
                  navigate(target);
                }}
                className="text-violet-600 dark:text-violet-400 hover:underline text-xs font-semibold inline-flex items-center gap-1"
              >
                <span>Open dedicated page</span>
                <ExternalLink className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="bg-slate-900 dark:bg-violet-500 hover:bg-slate-800 dark:hover:bg-violet-400 text-white font-bold text-xs px-4 py-2 rounded-lg transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

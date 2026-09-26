import React, { useState } from 'react';
import { X, ArrowUpRight } from 'lucide-react';
import { LEGAL_DOCS } from '../legalDocs';



const LINKS: { key: keyof typeof LEGAL_DOCS; label: string }[] = [
  { key: 'terms', label: 'Terms & Conditions' },
  { key: 'privacy', label: 'Privacy Policy' },
  { key: 'refunds', label: 'Cancellation & Refund' },
  { key: 'shipping', label: 'Shipping & Delivery' },
  { key: 'contact', label: 'Contact Us' },
  { key: 'risk', label: 'Risk Disclosure' },
];

export default function LegalFooter() {
  const [open, setOpen] = useState<string | null>(null);
  const doc = open ? LEGAL_DOCS[open] : null;

  return (
    <>
      <footer className="border-t border-slate-200/60 dark:border-white/[0.07] pt-6 pb-1 space-y-3">
        {/* A standing risk line. Regulators and users both expect this visible, * not buried inside a terms modal nobody opens. */}
        <p className="text-[10px] leading-relaxed text-slate-400 dark:text-slate-500 max-w-3xl">
          <span className="font-semibold text-slate-500 dark:text-slate-400">Risk warning:</span>{' '}
          Trading forex and CFDs carries a high risk of loss and is not suitable for everyone. FX Journal Pro is a
          journaling and analysis tool — it does not execute trades or provide investment advice. Past performance is
          not an indicator of future results.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 text-[10px] text-slate-400 dark:text-slate-500">
            <span>&copy; {new Date().getFullYear()} FX Journal Pro. Operated by Akshayraj (FX Journal Pro). All rights reserved.</span>
            <span className="hidden sm:inline text-slate-600 dark:text-slate-600">•</span>
            <span>
              Built by{' '}
              <a
                href="https://brandliftonline.in"
                target="_blank"
                rel="noopener noreferrer"
                className="text-violet-500 hover:text-violet-400 font-semibold underline decoration-violet-500/40 hover:decoration-violet-400 transition-colors inline-flex items-center gap-0.5"
              >
                Brandlift
                <ArrowUpRight className="h-2.5 w-2.5" />
              </a>
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {LINKS.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => setOpen(l.key as string)}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition"
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </footer>

      {doc && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
          onClick={() => setOpen(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={doc.title}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#0a0b12] border border-transparent dark:border-white/[0.1] rounded-2xl shadow-2xl max-w-lg w-full p-6"
            style={{ animation: 'modalIn 0.2s ease-out' }}
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">{doc.title}</h3>
              <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="h-72 overflow-y-auto p-4 bg-slate-50 dark:bg-white/[0.03] rounded-lg text-xs text-slate-500 dark:text-slate-400 leading-relaxed border border-slate-100 dark:border-white/[0.07] space-y-3">
              {doc.body.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
            <div className="flex justify-end mt-4">
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

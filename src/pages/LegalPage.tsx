import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  FileText, Shield, RefreshCcw, Truck, AlertTriangle, Mail,
  Info, ArrowLeft, CheckCircle2, ChevronRight, ExternalLink,
  ShieldCheck, Phone, MapPin, Clock, Send
} from 'lucide-react';
import Logo from '../components/Logo';
import { LEGAL_DOCS, resolveDocKeyFromPath, type LegalDocKey } from '../legalDocs';

interface LegalPageProps {
  initialKey?: LegalDocKey;
}

const DOC_NAV: { key: LegalDocKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'terms', label: 'Terms & Conditions', icon: FileText },
  { key: 'privacy', label: 'Privacy Policy', icon: Shield },
  { key: 'refunds', label: 'Cancellation & Refund', icon: RefreshCcw },
  { key: 'shipping', label: 'Shipping & Delivery', icon: Truck },
  { key: 'risk', label: 'Risk Disclosure', icon: AlertTriangle },
  { key: 'contact', label: 'Contact Us', icon: Mail },
  { key: 'about', label: 'About FXJournalPro', icon: Info },
];

export default function LegalPage({ initialKey }: LegalPageProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const pathKey = resolveDocKeyFromPath(location.pathname);
  const [activeKey, setActiveKey] = useState<LegalDocKey>(pathKey || initialKey || 'terms');

  useEffect(() => {
    const key = resolveDocKeyFromPath(location.pathname);
    if (key && key !== activeKey) {
      setActiveKey(key);
    }
  }, [location.pathname]);

  const doc = LEGAL_DOCS[activeKey] || LEGAL_DOCS.terms;

  const handleSelectDoc = (key: LegalDocKey) => {
    setActiveKey(key);
    const pathMap: Record<LegalDocKey, string> = {
      terms: '/terms-and-conditions',
      privacy: '/privacy-policy',
      refunds: '/cancellation-and-refund-policy',
      shipping: '/shipping-and-delivery',
      risk: '/risk-disclosure',
      contact: '/contact-us',
      about: '/about-us',
    };
    navigate(pathMap[key], { replace: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased selection:bg-violet-500/30 selection:text-white">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-white/[0.08] px-4 sm:px-6 lg:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-xl px-3 py-1.5 transition"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Home</span>
            </button>
            <div className="h-4 w-px bg-white/[0.1] hidden sm:block" />
            <div onClick={() => navigate('/')} className="cursor-pointer">
              <Logo size={24} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-medium text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Official Compliance Center
            </span>
            <button
              onClick={() => navigate('/')}
              className="lp-btn-primary text-xs font-semibold rounded-xl px-3.5 py-1.5"
            >
              Open Journal
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="grid lg:grid-cols-12 gap-8 items-start">
          {/* Navigation Sidebar */}
          <aside className="lg:col-span-4 xl:col-span-3 lg:sticky lg:top-20 space-y-2">
            <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-1">
              <p className="text-[11px] font-mono uppercase tracking-wider font-semibold text-slate-400 px-3 py-1">
                Policies &amp; Legal
              </p>
              {DOC_NAV.map((item) => {
                const Icon = item.icon;
                const isSelected = activeKey === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleSelectDoc(item.key)}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition text-left cursor-pointer ${
                      isSelected
                        ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/30'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <Icon className={`h-4 w-4 shrink-0 ${isSelected ? 'text-white' : 'text-slate-400'}`} />
                      <span className="truncate">{item.label}</span>
                    </div>
                    {isSelected && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-80" />}
                  </button>
                );
              })}
            </div>

            {/* Quick Contact Box in Sidebar */}
            <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-2.5 text-xs text-slate-400">
              <p className="font-semibold text-white">Need Compliance Help?</p>
              <p className="text-[11.5px] leading-relaxed text-slate-400">
                Contact our compliance &amp; grievance officer directly at:
              </p>
              <a
                href="mailto:contact@fxjournalpro.com"
                className="inline-flex items-center gap-1.5 text-violet-400 hover:text-violet-300 font-semibold break-all"
              >
                <Mail className="h-3.5 w-3.5 shrink-0" />
                contact@fxjournalpro.com
              </a>
              
            </div>
          </aside>

          {/* Document Body */}
          <main className="lg:col-span-8 xl:col-span-9 bg-slate-900/40 border border-white/[0.08] rounded-3xl p-6 sm:p-10 shadow-2xl relative overflow-hidden backdrop-blur-sm">
            {/* Header of the Document */}
            <div className="border-b border-white/[0.08] pb-6 mb-8">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <span className="px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-[11px] font-mono font-medium text-violet-300">
                  FXJournalPro Legal
                </span>
                {doc.lastUpdated && (
                  <span className="text-xs text-slate-400 font-mono">
                    Last Updated: <span className="text-slate-300 font-semibold">{doc.lastUpdated}</span>
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-white tracking-tight">
                {doc.title}
              </h1>
              {doc.subtitle && (
                <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                  {doc.subtitle}
                </p>
              )}
            </div>

            {/* Sections */}
            <div className="space-y-7 text-sm sm:text-[14.5px] text-slate-300 leading-relaxed font-normal">
              {doc.sections.map((section, sIdx) => (
                <section key={sIdx} className="space-y-3">
                  {section.heading && (
                    <h2 className="text-base sm:text-lg font-bold text-white tracking-tight pt-2 flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0" />
                      {section.heading}
                    </h2>
                  )}

                  {section.paragraphs.map((p, pIdx) => (
                    <p key={pIdx} className="text-slate-300/95 leading-relaxed">
                      {p}
                    </p>
                  ))}

                  {section.bullets && section.bullets.length > 0 && (
                    <ul className="space-y-2 pl-2 sm:pl-3 pt-1">
                      {section.bullets.map((b, bIdx) => (
                        <li key={bIdx} className="flex items-start gap-2.5 text-slate-300/90 text-[13.5px]">
                          <span className="h-1.5 w-1.5 rounded-full bg-violet-400/80 mt-2 shrink-0" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}

              {/* Special Footer Note if present (e.g. on About page) */}
              {doc.footerNote && (
                <div className="mt-8 p-4 sm:p-5 rounded-2xl bg-amber-500/[0.07] border border-amber-500/25 text-amber-200 text-xs sm:text-sm leading-relaxed">
                  <p className="font-semibold text-amber-300 mb-1 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                    Regulatory &amp; Service Notice
                  </p>
                  <p>{doc.footerNote}</p>
                </div>
              )}
            </div>

            {/* Bottom Quick-Switch Links */}
            <div className="mt-12 pt-6 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
              <span className="font-mono text-slate-500">FXJournalPro</span>
              <div className="flex flex-wrap items-center gap-3">
                {DOC_NAV.filter(n => n.key !== activeKey).slice(0, 3).map(n => (
                  <button
                    key={n.key}
                    type="button"
                    onClick={() => handleSelectDoc(n.key)}
                    className="hover:text-white transition underline decoration-white/20 hover:decoration-white"
                  >
                    View {n.label}
                  </button>
                ))}
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Global Footer Bar */}
      <footer className="border-t border-white/[0.08] bg-slate-950 py-6 px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500">
        <p className="mb-2 text-slate-400 text-[11px] leading-relaxed max-w-4xl mx-auto">
          FXJournalPro is a software and analytics platform only and does not provide financial advice, broker services, or managed accounts. Trading financial instruments involves substantial risk.
        </p>
        <p>&copy; {new Date().getFullYear()} FXJournalPro. All rights reserved.</p>
      </footer>
    </div>
  );
}

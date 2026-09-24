import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight, ArrowUpRight, Ban, BarChart3, BookOpen, Bot, Brain, CalendarDays, Check, CheckCircle2,
  ChevronDown, Clock, Compass, Cpu, Database, Eye, EyeOff,
  Flag, FileText, Gift, Globe, GraduationCap, Instagram, KeyRound, Layers, LineChart, Linkedin, Lock,
  Menu, MessageSquare, MoonStar, MousePointerClick, Newspaper, PieChart, RefreshCw, Send, Shield,
  ShieldCheck, Sparkles, Star, Sun, Tags, Target, TrendingDown,
  Trophy, Twitter, Wallet, Wrench, X, Youtube, Zap
} from 'lucide-react';
import Logo from '../components/Logo';
import FXNewsPreview from '../components/FXNewsPreview';
import { LEGAL_DOCS, type LegalDocKey } from '../legalDocs';
import { supabase } from '../supabaseClient';
import { Turnstile } from '@marsidev/react-turnstile';

/**
 * Reveals `[data-reveal]` elements as they scroll into view.
 *
 * The hidden state lives behind `.js-reveal` on <html>, which this hook adds —
 * so if the bundle fails or the browser lacks IntersectionObserver, nothing is
 * ever hidden. Elements unobserve after playing; the reveal is one-way, so
 * scrolling back up does not re-trigger it.
 */
function useScrollReveal() {
  useEffect(() => {
    const root = document.documentElement;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || typeof IntersectionObserver === 'undefined') return;

    root.classList.add('js-reveal');

    const pending = new Set(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    let frame = 0;

    // A position sweep rather than an IntersectionObserver: jumping straight to
    // an anchor (or a restored scroll position) moves elements from below the
    // viewport to above it without ever intersecting, and an observer would
    // leave those sections hidden for good.
    const sweep = () => {
      frame = 0;
      const triggerLine = window.innerHeight * 0.92;
      for (const el of pending) {
        const rect = el.getBoundingClientRect();
        const isApproaching = rect.top < triggerLine;
        if (!isApproaching) continue;
        // Anything already scrolled past appears without replaying its motion.
        if (rect.bottom < 0) el.style.transition = 'none';
        el.classList.add('is-visible');
        pending.delete(el);
      }
      if (pending.size === 0) window.removeEventListener('scroll', onScroll);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(sweep);
    };

    sweep();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
      root.classList.remove('js-reveal');
    };
  }, []);
}

/** Flags the navbar once the page has scrolled away from the top. */
function useScrolledNav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        setScrolled(window.scrollY > 24);
        frame = 0;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return scrolled;
}

interface LoginPageProps {
  isSupabaseConfigured: boolean;
  onLoginSuccess: () => void;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

export interface NavLinkItem {
  path: string;
  id: string;
  label: string;
  title: string;
}

const navLinks: NavLinkItem[] = [
  { path: '/features', id: 'features', label: 'Features', title: 'Features' },
  { path: '/how-it-works', id: 'how-it-works', label: 'How It Works', title: 'How It Works' },
  { path: '/ai-mentor', id: 'ai-mentor', label: 'AI Mentor', title: 'AI Trade Mentor' },
  { path: '/pricing', id: 'pricing', label: 'Pricing', title: 'Pricing' },
  { path: '/faq', id: 'faq', label: 'FAQ', title: 'Frequently Asked Questions' },
  { path: '/contact', id: 'contact', label: 'Contact', title: 'Contact' },
];

const SECTION_METADATA: Record<string, { title: string; path: string }> = {
  top: { title: 'FX Journal Pro - #1 Best Trading Journal for Forex & Prop Firm Traders', path: '/' },
  home: { title: 'FX Journal Pro - #1 Best Trading Journal for Forex & Prop Firm Traders', path: '/' },
  features: { title: 'Features | FX Journal Pro', path: '/features' },
  'fx-news': { title: 'FX News & Calendar | FX Journal Pro', path: '/fx-news' },
  'mt5-sync': { title: 'MT5 Auto Sync | FX Journal Pro', path: '/mt5-sync' },
  analytics: { title: 'Performance Analytics | FX Journal Pro', path: '/analytics' },
  'ai-mentor': { title: 'AI Trade Mentor | FX Journal Pro', path: '/ai-mentor' },
  security: { title: 'Security & Privacy | FX Journal Pro', path: '/security' },
  about: { title: 'About Us | FX Journal Pro', path: '/about-us' },
  faq: { title: 'FAQ | FX Journal Pro', path: '/faq' },
  'about-us': { title: 'About Us | FX Journal Pro', path: '/about-us' },
  'how-it-works': { title: 'How It Works | FX Journal Pro', path: '/how-it-works' },
  why: { title: 'Why FX Journal Pro | FX Journal Pro', path: '/why' },
  pricing: { title: 'Pricing - Free & Pro Plans | FX Journal Pro', path: '/pricing' },
  contact: { title: 'Contact | FX Journal Pro', path: '/contact' },
};

// Fill these in with your real profiles. Anything left blank is not rendered,
// so the footer never ships a link that goes nowhere.
const SOCIAL_LINKS: { label: string; href: string; icon: any }[] = [
  { label: 'X (Twitter)', href: 'https://twitter.com/fxjournalpro', icon: Twitter },
  { label: 'Telegram Community', href: 'https://t.me/fxjournalpro', icon: Send },
  { label: 'Discord Server', href: 'https://discord.gg/fxjournalpro', icon: MessageSquare },
  { label: 'YouTube Channel', href: 'https://youtube.com/@fxjournalpro', icon: Youtube },
  { label: 'Instagram', href: 'https://instagram.com/fxjournalpro', icon: Instagram },
];

const CONTACT_EMAIL = 'contact@fxjournalpro.com';

/**
 * Cloudflare Turnstile.
 *
 * `1x00000000000000000000AA` is Cloudflare's own always-passes test key. It
 * was the fallback in every build, so a deploy that forgot
 * VITE_TURNSTILE_SITE_KEY shipped with bot protection switched off and every
 * visitor reading "For testing only. If seen, report to site owner" on the
 * sign-in box. The fallback is now dev-only: production shows the widget it
 * was given, or says the key is missing.
 */
const TURNSTILE_TEST_KEY = '1x00000000000000000000BB'; // Cloudflare's official Invisible Always-Pass Test Key
const TURNSTILE_SITE_KEY: string =
  import.meta.env.VITE_TURNSTILE_SITE_KEY || (import.meta.env.DEV ? TURNSTILE_TEST_KEY : '');

/** Invisible Turnstile runs silently in the background without UI clutter */
function TurnstileBox({ onToken }: { onToken: (token: string) => void }) {
  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <div className="sr-only pointer-events-none fixed -top-[9999px] -left-[9999px]" aria-hidden="true">
      <Turnstile
        siteKey={TURNSTILE_SITE_KEY}
        options={{ theme: 'dark', size: 'invisible' }}
        onSuccess={onToken}
      />
    </div>
  );
}

// The eight areas of the product, in the order a trader meets them.
const productAreas = [
  { icon: BookOpen, title: 'Trading Journal', desc: 'Log every position with entry, exit, size, notes, tags, screenshots and the emotion behind it. Filter, review and edit any trade later.' },
  { icon: Layers, title: 'Accounts', desc: 'Track broker and prop firm accounts side by side. Add trades manually, or connect MetaTrader 5 so they arrive on their own.' },
  { icon: BarChart3, title: 'Analytics', desc: 'Win rate, profit factor, expectancy, drawdown, risk-to-reward, streaks and session breakdowns — calculated as you log.' },
  { icon: CalendarDays, title: 'Calendar', desc: 'Your month at a glance. Every day coloured by net P/L, so winning and losing patterns show themselves.' },
  { icon: Newspaper, title: 'FX News', desc: 'Live forex headlines plus the economic calendar — NFP, CPI, FOMC — so you know what is moving the market before you click buy.' },
  { icon: LineChart, title: 'Live Charts', desc: 'Price charts inside the journal, with your own trades marked on them. No switching windows to review a setup.' },
  { icon: Bot, title: 'AI Mentor', desc: 'Ask why last week went wrong. It reads your actual trade history and answers on your numbers, not generic advice.' },
  { icon: Wrench, title: 'Tools', desc: 'Pip value and position size calculators, so risk is worked out before the order, not after.' },
];

const howItWorks = [
  {
    title: 'Create your account',
    desc: 'Sign up with email or Google. Email verification takes a minute, and you are in.',
  },
  {
    title: 'Add a portfolio',
    desc: 'Name it, set your starting balance and currency. One for your broker, one for each prop challenge.',
  },
  {
    title: 'Get your trades in',
    desc: 'Add them by hand, paste an MT5 report, or install the free Expert Advisor once and let every trade arrive on its own.',
  },
  {
    title: 'Review and improve',
    desc: 'Read your analytics, mark the mistakes, ask the AI Mentor what to change. Then trade the next session better.',
  },
];

const benefits = [
  { icon: RefreshCw, title: 'No more spreadsheets', desc: 'Stop maintaining a sheet that breaks every time you add a column. Trades arrive and the numbers update themselves.' },
  { icon: Target, title: 'Built for prop traders', desc: 'Daily loss guards, drawdown monitoring and multi-account tracking, because the rules you trade under are strict.' },
  { icon: Brain, title: 'Find the real problem', desc: 'Most accounts do not die from bad strategy. They die from revenge trades and oversized risk. Both show up here.' },
  { icon: Zap, title: 'Set up once', desc: 'Install the EA one time. After that the journal keeps itself, whether you traded once this week or forty times.' },
  { icon: ShieldCheck, title: 'Your data stays yours', desc: 'Read-only MT5 access, encrypted in transit, never sold. Your broker password is never requested.' },
  { icon: Clock, title: 'Minutes, not evenings', desc: 'Review a full trading week in the time it used to take to type up one day.' },
];

// Plan comparison. Every row here is a promise to a paying customer, so each
// one has to be enforced in the product before this page goes live.
const PRO_PRICE_USD = '$5.90';
const PRO_PRICE_INR = '₹499';

const heroPoints = [
  'MT5 Trade Syncing',
  'AI Trading Mentor',
  'Advanced Performance Analytics',
  'Trading Psychology Insights',
  'Download Trading Reports (PDF & CSV)',
  'Complete Trading History Tracking',
];

const getPasswordStrength = (pw: string) => {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
};

// The eight that decide whether someone signs up. Everything else is a metric
// the product tracks, and metrics belong in a list, not in fifteen identical cards.
const features = [
  { icon: Cpu, title: 'MT5 Automatic Sync', desc: 'Trades, balance, and equity sync automatically from MetaTrader 5 via the free Expert Advisor.' },
  { icon: Bot, title: 'AI Trade Mentor', desc: 'Get personalized coaching on your setups, entries, exits, and risk decisions.' },
  { icon: BarChart3, title: 'Performance Analytics', desc: 'Track 10+ metrics including win rate, profit factor, expectancy, and drawdown.' },
  { icon: Newspaper, title: 'FX News & Economic Calendar', desc: 'Live forex headlines plus high-impact events like NFP, CPI, and FOMC — so you never trade blind.', new: true },
  { icon: Shield, title: 'Risk Management Tools', desc: 'Monitor risk per trade, daily limits, and position sizing to protect your capital.' },
  { icon: Trophy, title: 'Consistency Score', desc: 'A single score that grades how consistently you follow your edge.' },
  { icon: BookOpen, title: 'Detailed Trade Reviews', desc: 'Review every trade with notes, tags, screenshots, and full context.' },
  { icon: FileText, title: 'Download Trading Reports', desc: 'Export complete trading reports in PDF and CSV for reviews, prop firm applications, and backups.' },
];

// Tracked automatically, listed rather than carded — seven more boxes would only
// add scrolling, and every one of these is a number the dashboard already shows.
const trackedMetrics = [
  'Equity Curve Visualization',
  'Win Rate & Profit Factor',
  'Expectancy Analysis',
  'Drawdown Monitoring',
  'Session & Day Analysis',
  'Custom Tags & Notes',
  'Goal Setting & Tracking',
];

const perfectFor = [
  { icon: Globe, label: 'Forex Traders' },
  { icon: Trophy, label: 'Prop Firm Traders' },
  { icon: Sun, label: 'Day Traders' },
  { icon: MoonStar, label: 'Swing Traders' },
  { icon: GraduationCap, label: 'Beginners' },
  { icon: Target, label: 'Consistency Seekers' },
];

const mt5Sync = [
  { icon: MousePointerClick, title: 'One-Click EA Install', desc: 'Install the free FX Journal Pro EA in MetaTrader 5 in under a minute.' },
  { icon: RefreshCw, title: 'Automatic Sync', desc: 'Every trade syncs to your journal instantly — no manual entry.' },
  { icon: Zap, title: 'Real-Time Updates', desc: 'Balance, equity, and open positions stream live to your dashboard.' },
  { icon: Layers, title: 'Multiple Accounts', desc: 'Track broker and prop firm accounts all in one place.' },
  { icon: Database, title: 'Full History Import', desc: 'Your complete MT5 trade history is imported on first connect.' },
  { icon: ShieldCheck, title: 'Secure Connection', desc: 'Read-only access via token — your credentials never leave MT5.' },
];

const analyticsStats = [
  { label: 'Win Rate', value: '68%', sub: 'Last 100 trades', accent: 'text-emerald-400' },
  { label: 'Profit Factor', value: '2.1', sub: 'Gross profit / loss', accent: 'text-violet-300' },
  { label: 'Avg Risk:Reward', value: '1:2.4', sub: 'Per winning trade', accent: 'text-violet-300' },
  { label: 'Max Drawdown', value: '4.2%', sub: 'Lowest equity point', accent: 'text-rose-400' },
  { label: 'Expectancy', value: '+$184', sub: 'Average per trade', accent: 'text-emerald-400' },
  { label: 'Net Profit', value: '+$12,840', sub: 'This quarter', accent: 'text-emerald-400' },
  { label: 'Monthly Growth', value: '+34.2%', sub: 'Average / month', accent: 'text-violet-300' },
  { label: 'Avg Trade Duration', value: '2h 15m', sub: 'Held position', accent: 'text-violet-300' },
  { label: 'Best Trading Day', value: 'Thursday', sub: 'Most profitable', accent: 'text-amber-400' },
  { label: 'Worst Trading Day', value: 'Monday', sub: 'Needs attention', accent: 'text-slate-400' },
];

const aiMentorQuestions = [
  'Why did I lose money this week?',
  'How can I improve my win rate?',
  'Am I risking too much per trade?',
  'Which strategy should I scale?',
];

const aiPoints = [
  'Ask about any trade, strategy, or market condition.',
  'Get instant feedback on risk, entries, and exits.',
  'Receive actionable steps to improve next session.',
];

const security = [
  { icon: Lock, title: '256-Bit SSL Encryption', desc: 'All data in transit is encrypted end to end.' },
  { icon: KeyRound, title: 'Secure Authentication', desc: 'Password-based sign in with email verification and OTP codes.' },
  { icon: Bot, title: 'Cloudflare Turnstile', desc: 'Advanced bot protection keeps automated attacks out.' },
  { icon: ShieldCheck, title: 'Private by Design', desc: 'Your trades and analytics are yours — never sold or shared.' },
  { icon: Ban, title: 'Account Controls', desc: 'Reset your password and secure your session anytime.' },
];

const faqs = [
  { q: 'Can I cancel Pro anytime?', a: 'Yes. Pro is billed monthly and you can cancel whenever you like — you keep access until the end of the period you have paid for, and your journal stays intact on the free plan afterwards.' },
  { q: 'Is there a free plan?', a: 'Yes. The free plan covers one trading account with manual trade logging, full analytics, the calendar, FX news, live charts and the calculators — no card required. Pro adds unlimited accounts, MT5 automatic sync, the AI Mentor and full history export for ₹499 (about $5.90) per month.' },
  { q: 'What is a trading journal?', a: 'A trading journal is a record of your trades used to review performance, identify strengths and weaknesses, and improve consistency. FX Journal Pro automates this with MT5 auto-sync and AI-driven analysis.' },
  { q: 'Does FX Journal Pro work with MetaTrader 5?', a: 'Yes. MT5 automatic sync is a Pro feature: install the Expert Advisor once and your trades, balance and equity sync in real time. On the free plan you add trades manually, or paste an MT5 report.' },
  { q: 'Do I need to enter trades manually?', a: 'On the free plan, yes — logging a trade takes a few seconds. On Pro the MT5 Expert Advisor imports them automatically in real time, and you can still add or edit any trade by hand.' },
  { q: 'Can prop firm traders use FX Journal Pro?', a: 'Absolutely. Track multiple broker and prop firm accounts such as FTMO and FundedNext, monitor drawdown, and stay compliant with daily loss limits.' },
  { q: 'Is my trading data safe?', a: 'Yes. Your account is protected with secure authentication, email OTP verification, Cloudflare Turnstile bot protection, and 256-bit SSL encryption. Your data is never sold.' },
  { q: 'Do I need to download software?', a: 'The web dashboard runs in your browser with nothing to install. The only optional download is the free MT5 Expert Advisor for automatic trade syncing.' },
];

export default function LoginPage({ isSupabaseConfigured, onLoginSuccess, authFetch }: LoginPageProps) {
  useScrollReveal();
  const navScrolled = useScrolledNav();
  const [legalDoc, setLegalDoc] = useState<LegalDocKey | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const [activeSection, setActiveSection] = useState<string>('top');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [isRegistering, setIsRegistering] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isOtpMode, setIsOtpMode] = useState(false);
  const [isResetOtpMode, setIsResetOtpMode] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  // Referral code from a partner's link (/?ref=CODE).
  //
  // Kept in sessionStorage as well as state because the code has to survive
  // the round trip through an OAuth provider: the user leaves the site on
  // /?ref=CODE and comes back on a bare callback URL, and without this the
  // attribution is silently lost for every Google signup.
  const [referralCode, setReferralCode] = useState<string>(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('ref');
      if (fromUrl) {
        sessionStorage.setItem('fx_referral_code', fromUrl.toUpperCase());
        return fromUrl.toUpperCase();
      }
      return sessionStorage.getItem('fx_referral_code') || '';
    } catch {
      return '';
    }
  });
  const [referralPartner, setReferralPartner] = useState<string | null>(null);

  useEffect(() => {
    if (!referralCode) { setReferralPartner(null); return; }
    let cancelled = false;
    fetch(`/api/referral/${encodeURIComponent(referralCode)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.valid) {
          setReferralPartner(d.partnerName || null);
        } else {
          // An unrecognised code is dropped rather than carried into the
          // signup, where it would just be ignored by the server anyway.
          setReferralPartner(null);
          setReferralCode('');
          try { sessionStorage.removeItem('fx_referral_code'); } catch { /* private mode */ }
        }
      })
      .catch(() => { /* offline: the code is still sent, the server decides */ });
    return () => { cancelled = true; };
  }, [referralCode]);

  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [otpCode, setOtpCode] = useState('');

  const [resetEmail, setResetEmail] = useState('');
  const [resetOtpCode, setResetOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [turnstileToken, setTurnstileToken] = useState('');

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [newsletterSubscribed, setNewsletterSubscribed] = useState(false);

  const openAuthModal = (mode: 'login' | 'register') => {
    setIsRegistering(mode === 'register');
    setIsForgotPassword(false);
    setIsOtpMode(false);
    setIsResetOtpMode(false);
    setResetSuccess(false);
    setAuthError(null);
    setIsAuthModalOpen(true);
    if (mode === 'register') {
      document.title = 'Create Account | FX Journal Pro';
      if (location.pathname !== '/register') navigate('/register');
    } else {
      document.title = 'Sign In | FX Journal Pro';
      if (location.pathname !== '/login') navigate('/login');
    }
  };

  const closeAuthModal = () => {
    setIsAuthModalOpen(false);
    setAuthError(null);
    const fallbackPath = activeSection && activeSection !== 'top' ? `/${activeSection}` : '/';
    navigate(fallbackPath, { replace: true });
    const meta = SECTION_METADATA[activeSection || 'top'];
    if (meta) {
      document.title = meta.title;
    }
  };

  const scrollToSection = useCallback((sectionId: string, smooth: boolean = true) => {
    let cleanId = sectionId.replace(/^#/, '');
    if (cleanId === 'about') cleanId = 'about-us';
    if (!cleanId) return;

    const el = document.getElementById(cleanId);
    if (!el) return;

    // Immediately reveal [data-reveal] elements in this section so they aren't hidden
    const reveals = el.querySelectorAll<HTMLElement>('[data-reveal]');
    reveals.forEach((r) => r.classList.add('is-visible'));
    if (el.hasAttribute('data-reveal')) {
      el.classList.add('is-visible');
    }

    // Fixed navbar height is 68px, add 8px padding
    const navOffset = 76;
    const rect = el.getBoundingClientRect();
    const targetY = rect.top + window.scrollY - navOffset;

    window.scrollTo({
      top: Math.max(0, targetY),
      behavior: smooth ? 'smooth' : 'auto'
    });

    setActiveSection(cleanId);

    // Fire scroll event after animation to satisfy any observer/sweep
    setTimeout(() => {
      window.dispatchEvent(new Event('scroll'));
    }, 150);
  }, []);

  const isProgrammaticScrollRef = useRef(false);
  const scrollTimeoutRef = useRef<any>(null);

  /**
   * Releases the scroll-spy guard, and nothing else owns this timer.
   *
   * It used to be cleared by the scroll-spy effect's cleanup. handleNavClick
   * sets the guard, starts this timer, then calls navigate(path) — which
   * changes location.pathname, which is the scroll-spy effect's only
   * dependency, so the effect tore down and its cleanup cancelled the timer
   * that would have released the guard. The guard therefore stayed true for
   * the rest of the page's life and the spy returned early on every scroll
   * event: after one nav click the highlight and the URL froze on that link,
   * all the way down to the contact section.
   *
   * Clearing on unmount only, so a re-subscribe cannot cancel it again.
   */
  useEffect(() => () => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
  }, []);

  const handleNavClick = (e: React.MouseEvent, path: string, sectionId?: string) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement)?.blur();
    const cleanId = sectionId || path.replace(/^\//, '').replace(/^#/, '') || 'top';

    // Prevent scroll spy from overriding active state during smooth scroll animation
    isProgrammaticScrollRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

    // Immediately switch active section so ONLY the clicked option is active
    setActiveSection(cleanId);
    scrollToSection(cleanId, true);

    if (location.pathname !== path) {
      navigate(path);
    }
    const meta = SECTION_METADATA[cleanId];
    if (meta) {
      document.title = meta.title;
    }
    setMobileMenuOpen(false);

    scrollTimeoutRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 900);
  };

  // Route & Hash detection on load / pathname change
  useEffect(() => {
    const rawPath = location.pathname.replace(/^\//, '').toLowerCase();
    const hash = location.hash.replace(/^#/, '').toLowerCase();

    // Determine target section
    let targetSection = hash || rawPath || 'top';
    if (targetSection === '' || targetSection === 'home') targetSection = 'top';

    // Handle dedicated auth modal routes
    if (location.pathname === '/login') {
      document.title = 'Sign In | FX Journal Pro';
      openAuthModal('login');
      return;
    } else if (location.pathname === '/register') {
      document.title = 'Create Account | FX Journal Pro';
      openAuthModal('register');
      return;
    } else if (location.pathname === '/forgot-password') {
      document.title = 'Reset Password | FX Journal Pro';
      setIsForgotPassword(true);
      setIsAuthModalOpen(true);
      return;
    }

    // Update document title for this route / section
    const meta = SECTION_METADATA[targetSection];
    if (meta) {
      document.title = meta.title;
    }

    if (targetSection && targetSection !== 'top') {
      setActiveSection(targetSection);
      const t1 = setTimeout(() => scrollToSection(targetSection, false), 60);
      const t2 = setTimeout(() => scrollToSection(targetSection, true), 300);
      const t3 = setTimeout(() => scrollToSection(targetSection, true), 700);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    } else if (targetSection === 'top' && (rawPath === '' || rawPath === 'home')) {
      setActiveSection('top');
      if (window.scrollY > 0 && !sessionStorage.getItem('prevent_top_scroll')) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }, [location.pathname, location.hash, scrollToSection]);

  // Scroll spy to highlight active section and sync page title & URL
  useEffect(() => {
    const sectionIds = [
      'top',
      'features',
      'how-it-works',
      'fx-news',
      'mt5-sync',
      'analytics',
      'ai-mentor',
      'security',
      'about-us',
      'why',
      'pricing',
      'faq',
      'contact'
    ];
    let ticking = false;

    const onScrollSpy = () => {
      // If user just clicked an item, wait until smooth scrolling settles
      if (isProgrammaticScrollRef.current) return;

      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (isProgrammaticScrollRef.current) return;

        // If user is at the very top of the page
        if (window.scrollY < 100) {
          setActiveSection('top');
          if (location.pathname !== '/login' && location.pathname !== '/register' && location.pathname !== '/forgot-password') {
            const meta = SECTION_METADATA['top'];
            if (meta && window.location.pathname !== meta.path && !window.location.hash) {
              window.history.replaceState(null, '', meta.path);
              document.title = meta.title;
            }
          }
          return;
        }

        // 140px below the fixed navbar
        const triggerY = 140;
        let current = 'top';

        for (const id of sectionIds) {
          const el = document.getElementById(id);
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          if (rect.top <= triggerY && rect.bottom > triggerY) {
            current = id;
            break;
          }
        }

        setActiveSection(current);

        // Update document title and clean URL path when scrolling through landing page
        if (location.pathname !== '/login' && location.pathname !== '/register' && location.pathname !== '/forgot-password') {
          const meta = SECTION_METADATA[current];
          if (meta) {
            document.title = meta.title;
            if (window.location.pathname !== meta.path && !window.location.hash) {
              window.history.replaceState(null, '', meta.path);
            }
          }
        }
      });
    };

    window.addEventListener('scroll', onScrollSpy, { passive: true });
    // Only the listener is torn down here. scrollTimeoutRef belongs to
    // handleNavClick and is cleared on unmount above — clearing it here
    // cancelled the guard's own release on every navigate().
    return () => {
      window.removeEventListener('scroll', onScrollSpy);
    };
  }, [location.pathname]);

  const persistAuthSession = (userId: string, email?: string, sessionToken?: string) => {
    if (typeof window === 'undefined') return;
    if (userId) {
      window.sessionStorage.setItem('auth_user_id', userId);
      window.localStorage.setItem('auth_user_id', userId);
    } else {
      window.sessionStorage.removeItem('auth_user_id');
      window.localStorage.removeItem('auth_user_id');
    }
    if (email) {
      window.sessionStorage.setItem('auth_email', email);
      window.localStorage.setItem('auth_email', email);
    } else {
      window.sessionStorage.removeItem('auth_email');
      window.localStorage.removeItem('auth_email');
    }
    if (sessionToken) {
      window.sessionStorage.setItem('auth_session_token', sessionToken);
      window.localStorage.setItem('auth_session_token', sessionToken);
    }
  };

  const syncSupabaseUser = async (sessionUser: any, accessToken?: string) => {
    const userId = sessionUser?.id || '';
    const email = sessionUser?.email || '';
    const name = sessionUser?.user_metadata?.full_name || sessionUser?.user_metadata?.name || (email ? email.split('@')[0] : 'Trader');
    const authProvider = sessionUser?.app_metadata?.provider || 'email';
    persistAuthSession(userId, email);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-auth-user-id': userId, 'x-auth-email': email },
        body: JSON.stringify({ id: userId, email, name, provider: authProvider, supabaseAccessToken: accessToken, referralCode: referralCode || undefined })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          // Keep sessionStorage in sync with the server's canonical user id
          persistAuthSession(data.user.id || userId, data.user.email || email, data.sessionToken);
          onLoginSuccess();
          return;
        }
      }
    } catch (e) {
      console.error('Error syncing user with backend:', e);
    }
    onLoginSuccess();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail) return;
    setActionLoading(true);
    setAuthError(null);
    try {
      if (isSupabaseConfigured) {
        try {
          const { data: supabaseData, error: supabaseError } = await supabase.auth.signInWithPassword({
            email: authEmail,
            password: authPassword
          });
          if (!supabaseError && supabaseData?.session?.user) {
            await syncSupabaseUser(supabaseData.session.user, supabaseData.session.access_token);
            return;
          }
        } catch (sErr) {
          console.warn('[AxyFx] Supabase login warning, falling back to backend:', sErr);
        }
      }
      persistAuthSession(sessionStorage.getItem('auth_user_id') || '', authEmail);
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-auth-email': authEmail },
        body: JSON.stringify({ email: authEmail, password: authPassword, turnstileToken })
      });
      if (!res.ok) {
        const errorData = await res.json();
        setAuthError(errorData.error || 'Login failed.');
        return;
      }
      const data = await res.json();
      if (data.user) {
        persistAuthSession(data.user.id, data.user.email || authEmail, data.sessionToken);
        onLoginSuccess();
      }
    } catch (err: any) {
      setAuthError(`Connection error: ${err?.message || err || 'Network error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authName) return;
    // Matches the server-side minimum so the user sees the rule before the round trip.
    if (!authPassword || authPassword.length < 8) {
      setAuthError('Password must be at least 8 characters.');
      return;
    }
    setActionLoading(true);
    setAuthError(null);
    try {
      if (isSupabaseConfigured) {
        try {
          await supabase.auth.signUp({
            email: authEmail,
            password: authPassword,
            options: { data: { full_name: authName } }
          });
        } catch (sErr) {
          console.warn('[AxyFx] Supabase register warning:', sErr);
        }
      }
      persistAuthSession('');
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-auth-email': authEmail },
        body: JSON.stringify({ email: authEmail, name: authName, password: authPassword, turnstileToken, referralCode: referralCode || undefined })
      });
      if (!res.ok) {
        const errorData = await res.json();
        setAuthError(errorData.error || 'Failed to create account.');
        return;
      }
      const data = await res.json();
      setIsOtpMode(true);
      if (data.devOtp) setOtpCode(data.devOtp);
      else setOtpCode('');
      // The server tells us whether the code actually went out. This was
      // returned and never read, so a delivery failure showed the same
      // "enter your code" screen as a success and the user waited on mail
      // that was never sent.
      if (data.emailSent === false && !data.devOtp) {
        setAuthError(
          'Your account was created, but we could not send the verification code. ' +
          `Please contact ${CONTACT_EMAIL} and we will verify you manually.`
        );
      } else {
        setAuthError(null);
      }
    } catch (err: any) {
      setAuthError(`Registration error: ${err?.message || err || 'Network error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !otpCode || otpCode.length !== 6) {
      setAuthError('Please enter a valid 6-digit code');
      return;
    }
    setActionLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-auth-email': authEmail },
        body: JSON.stringify({ email: authEmail, otp: otpCode })
      });
      const data = await res.json();
      if (!res.ok) { setAuthError(data.error || 'Invalid or expired code.'); return; }
      if (data.user) { persistAuthSession(data.user.id, data.user.email || authEmail, data.sessionToken); onLoginSuccess(); return; }
    } catch (err: any) {
      setAuthError(`Verification error: ${err?.message || err}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!authEmail) return;
    setActionLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-email': authEmail },
        body: JSON.stringify({ email: authEmail })
      });
      const data = await res.json();
      if (!res.ok) { setAuthError(data.error || 'Failed to resend code.'); }
      else {
        if (data.devOtp) { setOtpCode(data.devOtp); alert(`Code: ${data.devOtp}`); }
        else { setOtpCode(''); alert(`New code sent to ${authEmail}`); }
      }
    } catch (err: any) { setAuthError(`Error: ${err?.message || err}`); }
    finally { setActionLoading(false); }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail) return;
    setActionLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail })
      });
      const data = await res.json();
      if (!res.ok) { setAuthError(data.error || 'Request failed.'); return; }
      setIsResetOtpMode(true);
      if (data.devOtp) { setResetOtpCode(data.devOtp); alert(`Reset code: ${data.devOtp}`); }
      else { setResetOtpCode(''); }
      setAuthError(null);
    } catch (err: any) { setAuthError(`Error: ${err?.message || err}`); }
    finally { setActionLoading(false); }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetOtpCode || resetOtpCode.length !== 6 || !newPassword) return;
    setActionLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail, otp: resetOtpCode, newPassword })
      });
      const data = await res.json();
      if (!res.ok) { setAuthError(data.error || 'Failed to reset password.'); return; }
      setResetSuccess(true);
      setTimeout(() => {
        setIsForgotPassword(false); setIsResetOtpMode(false); setResetSuccess(false);
        setResetEmail(''); setResetOtpCode(''); setNewPassword(''); setAuthError(null);
      }, 2500);
    } catch (err: any) { setAuthError(`Error: ${err?.message || err}`); }
    finally { setActionLoading(false); }
  };

  const inputClass = "cyber-input w-full";
  const buttonPrimary = "cyber-btn-cta w-full font-semibold text-base py-3.5 rounded-2xl cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";


  const isNavLinkActive = (linkId: string, current: string) => {
    if (current === linkId) return true;
    if (linkId === 'features' && ['features', 'fx-news', 'mt5-sync', 'analytics'].includes(current)) return true;
    return false;
  };

  return (
    <div className="lp relative min-h-screen text-slate-200 font-sans antialiased overflow-x-hidden">
      <div className="lp-aura" />

      {/* ── Navbar ── */}
      <header className="lp-nav fixed top-0 inset-x-0 z-50" data-scrolled={navScrolled}>
        <div className="lp-navbar max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-[68px] flex items-center justify-between gap-4">
          {/*
            min-w-0 rather than shrink-0: at 375px the three items in this row
            added up to 411px, and because the page clips overflow-x the
            hamburger sat past the right edge with no way to reach it. The
            wordmark is the one item that can give way.
          */}
          <a href="/" onClick={(e) => handleNavClick(e, '/', 'top')} className="flex items-center gap-2.5 min-w-0 group">
            <Logo size={28} />
          </a>
          <nav className="lp-navgroup hidden lg:flex">
            {navLinks.map((l) => {
              const isActive = isNavLinkActive(l.id, activeSection);
              return (
                <a
                  key={l.path}
                  href={l.path}
                  onClick={(e) => handleNavClick(e, l.path, l.id)}
                  data-active={isActive}
                  className={`lp-navlink ${isActive ? 'active' : ''}`}
                >
                  {l.label}
                </a>
              );
            })}
          </nav>
          <div className="flex items-center gap-2.5 shrink-0">
            <button onClick={() => openAuthModal('login')} className="lp-btn-ghost hidden sm:inline-flex text-[13px] font-medium rounded-full px-4 py-2">Sign In</button>
            <button onClick={() => openAuthModal('register')} className="lp-btn-primary text-xs sm:text-[13px] font-semibold rounded-full px-4 py-2 shrink-0">
              Get Started<span className="hidden sm:inline"> Free</span>
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle navigation menu"
              className="lg:hidden p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.08] transition"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-b border-white/[0.08] bg-[#0b0e14]/95 backdrop-blur-2xl px-4 py-4 space-y-1 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200">
            {navLinks.map((l) => {
              const isActive = isNavLinkActive(l.id, activeSection);
              return (
                <a
                  key={l.path}
                  href={l.path}
                  onClick={(e) => handleNavClick(e, l.path, l.id)}
                  className={`block px-4 py-2.5 rounded-xl text-sm font-medium transition ${isActive
                    ? 'bg-violet-600/25 text-violet-200 font-semibold'
                    : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                    }`}
                >
                  {l.label}
                </a>
              );
            })}
            <div className="pt-3 border-t border-white/[0.06] flex items-center gap-2">
              <button
                onClick={() => { setMobileMenuOpen(false); openAuthModal('login'); }}
                className="w-1/2 py-2.5 rounded-xl text-center text-sm font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] transition"
              >
                Sign In
              </button>
              <button
                onClick={() => { setMobileMenuOpen(false); openAuthModal('register'); }}
                className="lp-btn-primary w-1/2 py-2.5 rounded-xl text-center text-sm font-semibold"
              >
                Get Started
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ── Hero ── */}
      <section id="top" className="relative pt-28 md:pt-32 pb-14 md:pb-20">
        <div className="lp-grid" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-[1.02fr_0.98fr] gap-12 lg:gap-16 items-center">
            {/* Left: #1 Best Trading Journal */}
            <div className="animate-fade-up">
              <div className="lp-pill mb-6">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,.55)]" />
                <span className="lp-eyebrow">#1 Best Trading Journal</span>
              </div>

              {/* "Know Your Trades" leads. The keyword phrase moves to the
                sub-line: it appeared three times on this page and reads as
                stuffing when it is also the headline.

                h1, not h2: the whole marketing page had no h1 at all — 13 h2s
                and 34 h3s under nothing — so neither search engines nor a
                screen reader's heading list had a page title to anchor on. */}
              <h1 className="font-display text-[38px] sm:text-[48px] xl:text-[60px] font-bold text-white leading-[1.02] tracking-[-0.035em] text-balance">
                Know Your
                <span className="block bg-gradient-to-r from-violet-300 via-violet-400 to-indigo-300 bg-clip-text text-transparent">Trades.</span>
              </h1>

              <p className="mt-5 font-display text-lg sm:text-xl font-semibold text-slate-200 tracking-[-0.01em]">
                The trading journal for forex &amp; prop firm traders.
              </p>

              <p className="mt-6 text-base sm:text-[17px] text-slate-400 leading-relaxed max-w-xl">
                The fastest way to journal, analyze, and improve your trading. Auto-sync MetaTrader 5 trades, get AI mentor insights, and track every metric that matters.
              </p>

              <div className="mt-7 grid sm:grid-cols-2 gap-x-6 gap-y-3">
                {heroPoints.map((p) => (
                  <div key={p} className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="text-[13px] text-slate-300">{p}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-9">
                <button onClick={() => openAuthModal('register')} className="lp-btn-primary group inline-flex items-center justify-center gap-2 font-semibold rounded-full px-7 py-3.5 text-sm">
                  Get Started Free
                  <ArrowUpRight className="h-4 w-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </button>
                <button onClick={() => openAuthModal('login')} className="lp-btn-ghost inline-flex items-center justify-center gap-2 font-semibold rounded-full px-7 py-3.5 text-sm">
                  Sign In
                </button>
              </div>

            </div>

            {/* Right: the product itself — what the trader gets after MT5 sync */}
            <div className="animate-fade-up lg:mt-0 mt-8">
              <HeroPanel />
            </div>
          </div>

          {/* The "Trader's Mindset" pull-quote used to sit here. Removed: it was
            the company quoting itself, so the quote format borrowed no
            authority, and it delayed the product story by 60 words. Bring it
            back as a real trader testimonial — name and account type — if one
            becomes available. */}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="relative scroll-mt-20 py-14 md:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14" data-reveal="up">
            <span className="lp-pill mb-5">
              <Sparkles className="h-3.5 w-3.5 text-violet-300" />
              <span className="lp-eyebrow lp-num">{features.length + trackedMetrics.length} Core Features</span>
            </span>
            <h2 className="font-display text-3xl sm:text-[38px] font-bold text-white tracking-[-0.025em] text-balance">Everything You Need to Win Consistently</h2>
            <p className="mt-4 text-slate-400 text-base leading-relaxed">
              From automatic MT5 sync to AI coaching and deep analytics — FX Journal Pro combines every tool a serious trader needs into one powerful platform.
            </p>
          </div>

          {/* The first feature is the product's whole premise, so it gets a
              double-width tile. With 15 items that also leaves 12 — three full
              rows of four — instead of a ragged final row. */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {features.map((f, i) => {
              const isFlagship = i === 0;
              return (
                <div
                  key={f.title}
                  data-reveal="up"
                  style={{ ['--reveal-i' as any]: Math.min(i, 7) }}
                  className={`lp-card group p-5 flex flex-col ${isFlagship ? 'lp-card-accent xl:col-span-2 sm:p-6' : ''}`}
                >
                  <span className={`lp-chip mb-4 ${isFlagship ? 'w-12 h-12' : 'w-10 h-10'}`}>
                    <f.icon className={`${isFlagship ? 'h-[22px] w-[22px] text-violet-100' : 'h-[18px] w-[18px] text-violet-300'}`} />
                  </span>
                  <h3 className={`font-semibold text-white mb-1.5 flex items-center gap-2 ${isFlagship ? 'text-lg tracking-[-0.01em]' : 'text-sm'}`}>
                    {f.title}
                    {'new' in f && f.new && (
                      <span className="text-[9px] font-bold uppercase tracking-wider bg-emerald-400/15 text-emerald-300 border border-emerald-400/25 px-1.5 py-0.5 rounded-full">
                        New
                      </span>
                    )}
                  </h3>
                  <p className={`leading-relaxed text-slate-400 ${isFlagship ? 'text-sm max-w-md' : 'text-[13px]'}`}>{f.desc}</p>
                  {isFlagship && (
                    <p className="lp-eyebrow mt-auto pt-5">Set up once &middot; runs on its own</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* The remaining metrics as a list. Same information, a fraction of the
              scroll, and it reads as a spec sheet instead of more marketing tiles. */}
          <div className="mt-10 flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-10" data-reveal="up">
            <p className="lp-eyebrow shrink-0 lg:max-w-[140px]">Plus every metric, tracked automatically</p>
            <ul className="flex flex-wrap gap-x-6 gap-y-2.5">
              {trackedMetrics.map((m) => (
                <li key={m} className="flex items-center gap-2 text-[13px] text-slate-400">
                  <CheckCircle2 className="h-3.5 w-3.5 text-violet-400/70 shrink-0" />
                  {m}
                </li>
              ))}
            </ul>
          </div>

          {/* Audience chips, folded in from the section they used to own. Who it
              is for is one line of context, not a screen of its own. */}
          <div className="mt-12 pt-10 lp-rule flex flex-col lg:flex-row lg:items-center gap-5 lg:gap-10" data-reveal="up">
            <p className="lp-eyebrow shrink-0 lg:max-w-[140px]">Built for</p>
            <div className="flex flex-wrap gap-2.5">
              {perfectFor.map((p) => (
                <span key={p.label} className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-2">
                  <p.icon className="h-3.5 w-3.5 text-violet-300" />
                  <span className="text-[13px] font-medium text-slate-300">{p.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="relative scroll-mt-20 py-14 md:py-20 lp-rule">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12" data-reveal="up">
            <span className="lp-pill mb-5">
              <MousePointerClick className="h-3.5 w-3.5 text-violet-300" />
              <span className="lp-eyebrow">How It Works</span>
            </span>
            <h2 className="font-display text-3xl sm:text-[38px] font-bold text-white tracking-[-0.025em] text-balance">
              Four steps. Then it runs itself.
            </h2>
          </div>

          {/* Numbered because this genuinely is a sequence — the order matters. */}
          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {howItWorks.map((step, i) => (
              <li
                key={step.title}
                className="lp-card p-5 flex flex-col"
                data-reveal="up"
                style={{ ['--reveal-i' as any]: i }}
              >
                <span className="font-mono text-xs font-semibold text-violet-300/90 mb-3">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="text-[15px] font-semibold text-white mb-1.5">{step.title}</h3>
                <p className="text-[13px] leading-relaxed text-slate-400">{step.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── FX News & Economic Calendar ── */}
      <section id="fx-news" className="relative scroll-mt-20 py-14 md:py-20 lp-rule">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center" data-reveal="up">
          <div>
            <span className="lp-pill mb-4">
              <Newspaper className="h-3.5 w-3.5 text-violet-300" />
              <span className="lp-eyebrow">FX News &amp; Economic Calendar</span>
            </span>
            <h2 className="font-display text-3xl sm:text-[38px] font-bold text-white tracking-[-0.025em] text-balance leading-tight">Never Trade Blind Again</h2>
            <p className="mt-4 text-slate-400 text-base leading-relaxed">
              Track live forex headlines and high-impact economic events — NFP, CPI, FOMC, GDP — all inside your journal, so you're always ahead of market-moving news.
            </p>
            <div className="mt-6 space-y-3">
              {[
                'Real-time forex headlines with sentiment scoring',
                'High-impact events like NFP, CPI, FOMC & GDP',
                'Filter by currency, category, and impact level',
                'Live countdown to the next high-impact event',
              ].map((p) => (
                <div key={p} className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-violet-300 shrink-0 mt-0.5" />
                  <span className="text-sm text-slate-300">{p}</span>
                </div>
              ))}
            </div>
            <button onClick={() => openAuthModal('register')} className="lp-btn-primary mt-8 inline-flex items-center gap-2 font-semibold rounded-full px-7 py-3.5 text-sm">
              Explore FX News
              <ArrowUpRight className="h-4 w-4" />
            </button>
          </div>

          <div className="animate-fade-up">
            <FXNewsPreview />
          </div>
        </div>
      </section>

      {/* "Perfect For" removed — a whole screen for seven chips. The chips now
          sit at the foot of the Features section, where they read as context
          rather than a section of their own. */}

      {/* ── MT5 Sync ── */}
      <section id="mt5-sync" className="relative scroll-mt-20 py-14 md:py-20 lp-rule">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center" data-reveal="up">
          <div>
            <span className="lp-pill mb-4">
              <Cpu className="h-3.5 w-3.5 text-violet-300" />
              <span className="lp-eyebrow">MetaTrader 5</span>
            </span>
            <h2 className="font-display text-3xl sm:text-[38px] font-bold text-white tracking-[-0.025em] text-balance leading-tight">Automatic MT5 Synchronization</h2>
            <p className="mt-4 text-slate-400 text-base leading-relaxed">
              Install the free Expert Advisor once and your MT5 journal fills itself. No copy-pasting, no spreadsheets, no wasted hours.
            </p>
            <div className="mt-8 grid sm:grid-cols-2 gap-4">
              {mt5Sync.map((m) => (
                <div key={m.title} className="flex gap-3">
                  <div className="lp-chip w-9 h-9 shrink-0">
                    <m.icon className="h-4 w-4 text-violet-300" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1">{m.title}</h3>
                    <p className="text-[13px] leading-relaxed text-slate-400">{m.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="lp-card overflow-hidden shadow-2xl shadow-black/50">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.06] bg-white/[0.02]">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400/80"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80"></span>
                <span className="ml-2 text-[11px] text-slate-400 font-medium">MT5 Terminal — FX Journal Pro EA</span>
              </div>
              <div className="p-5 font-mono text-[11px] leading-6">
                <p className="text-slate-500">FX Journal Pro EA — v1.4.0</p>
                <p className="text-emerald-400">[10:32:01] Authenticated successfully</p>
                <p className="text-slate-400">[10:32:02] Importing trade history...</p>
                <p className="text-slate-400">[10:32:03] 47 trades loaded</p>
                <p className="text-violet-300">[10:32:04] Live sync active — broker: IC Markets</p>
                <p className="text-slate-400">[10:32:05] Waiting for new trades...</p>
                <p className="text-emerald-400">[10:32:07] New trade detected — EURUSD BUY 0.50</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              {[
                { icon: RefreshCw, label: 'Auto Sync', value: 'Real-time' },
                { icon: Layers, label: 'Accounts', value: 'Unlimited' },
                { icon: ShieldCheck, label: 'Security', value: 'Read-only' },
              ].map((s) => (
                <div key={s.label} className="lp-card p-2.5 sm:p-4 text-center">
                  <s.icon className="h-4 w-4 text-violet-300 mx-auto mb-2" />
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">{s.label}</p>
                  <p className="text-xs font-bold text-white mt-0.5">{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Analytics ── */}
      <section id="analytics" className="relative scroll-mt-20 py-14 md:py-20 lp-rule">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12 grid lg:grid-cols-[1fr_auto] lg:items-end gap-5 lg:gap-12" data-reveal="up">
            <div className="max-w-xl">
              <span className="lp-pill mb-4">
                <BarChart3 className="h-3.5 w-3.5 text-emerald-400" />
                <span className="lp-eyebrow">Deep Analytics</span>
              </span>
              <h2 className="font-display text-3xl sm:text-[38px] font-bold text-white tracking-[-0.025em] text-balance">Monitor Every Important Trading Metric</h2>
            </div>
            <p className="text-slate-400 text-[15px] leading-relaxed lg:max-w-sm lg:text-right">
              Know your numbers. Track 10+ performance metrics automatically so you can make data-driven decisions — not emotional ones.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {analyticsStats.map((s, i) => (
              <div key={s.label} className="lp-card p-5" data-reveal="up" style={{ ['--reveal-i' as any]: Math.min(i, 6) }}>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">{s.label}</p>
                <p className={`text-xl font-extrabold ${s.accent}`}>{s.value}</p>
                <p className="text-[11px] text-slate-500 mt-1">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* The equity-curve card that used to sit here was the same chart and
              the same +$12,840 already shown in the hero panel. One mockup per
              idea; the stat grid above carries this section on its own. */}
          <p className="lp-eyebrow mt-6">Figures shown are a sample account &middot; your own appear after MT5 sync</p>
        </div>
      </section>

      {/* ── AI Mentor ── */}
      <section id="ai-mentor" className="relative scroll-mt-20 py-14 md:py-20 lp-rule">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center" data-reveal="up">
          <div>
            <span className="lp-pill mb-4">
              <Brain className="h-3.5 w-3.5 text-violet-400" />
              <span className="lp-eyebrow">AI Mentor</span>
            </span>
            <h2 className="font-display text-3xl sm:text-[38px] font-bold text-white tracking-[-0.025em] text-balance leading-tight">Your Personal AI Trading Mentor</h2>
            <p className="mt-4 text-slate-400 text-base leading-relaxed">
              Talk to an AI coach that knows your trading history. Get honest, personalized feedback on your setups, risk, and psychology — whenever you need it.
            </p>
            <div className="mt-6 space-y-3">
              {aiPoints.map((p) => (
                <div key={p} className="flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
                  <span className="text-sm text-slate-300">{p}</span>
                </div>
              ))}
            </div>
            <button onClick={() => openAuthModal('register')} className="lp-btn-primary mt-8 inline-flex items-center gap-2 font-semibold rounded-full px-7 py-3.5 text-sm">
              Try the AI Mentor
              <ArrowUpRight className="h-4 w-4" />
            </button>
          </div>

          <div className="lp-card overflow-hidden shadow-2xl shadow-black/50">
            <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4 bg-white/[0.02]">
              <div className="lp-chip w-9 h-9">
                <Bot className="h-5 w-5 text-violet-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">AI Trading Mentor</p>
                <p className="flex items-center gap-1.5 text-[10px] text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Online
                </p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex justify-end">
                <div className="bg-violet-600/80 text-white text-[13px] rounded-2xl rounded-br-md px-4 py-2.5 max-w-[80%] leading-relaxed">
                  Why do I keep losing money on GBP/JPY?
                </div>
              </div>
              <div className="flex justify-start">
                <div className="bg-white/[0.06] border border-white/[0.08] text-slate-200 text-[13px] rounded-2xl rounded-bl-md px-4 py-2.5 max-w-[85%] leading-relaxed">
                  Your win rate is solid, but your average risk per trade is 2.1% — above your 1% target. Tighten position size on high-volatility pairs and take profits at your 1:2 target.
                </div>
              </div>
              <div className="pt-1">
                <p className="text-[10px] text-slate-500 mb-2 uppercase tracking-wide font-semibold">Ask your AI mentor</p>
                <div className="flex flex-wrap gap-2">
                  {aiMentorQuestions.map((q) => (
                    <span key={q} className="text-[11px] text-slate-300 bg-white/[0.05] border border-white/[0.08] rounded-full px-3 py-1.5 cursor-default">{q}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Security ── */}
      <section id="security" className="relative scroll-mt-20 py-14 md:py-20 lp-rule">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12 max-w-2xl" data-reveal="up">
            <span className="lp-pill mb-4">
              <Shield className="h-3.5 w-3.5 text-emerald-400" />
              <span className="lp-eyebrow">Security</span>
            </span>
            <h2 className="font-display text-3xl sm:text-[38px] font-bold text-white tracking-[-0.025em] text-balance">Enterprise-Grade Security, Zero Compromise</h2>
            <p className="mt-4 text-slate-400 text-[15px] leading-relaxed">
              Your trading data is private and valuable. We protect it with the same standards used by financial platforms.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {security.map((s, i) => (
              <div key={s.title} className="lp-card p-5" data-reveal="up" style={{ ['--reveal-i' as any]: Math.min(i, 5) }}>
                <div className="lp-chip w-10 h-10 mb-4">
                  <s.icon className="h-5 w-5 text-emerald-400" />
                </div>
                <h3 className="text-sm font-semibold text-white mb-1.5">{s.title}</h3>
                <p className="text-[13px] leading-relaxed text-slate-400">{s.desc}</p>
              </div>
            ))}
            <div className="lp-card lp-card-accent p-5 flex flex-col justify-center">
              <p className="text-sm font-semibold text-white mb-1.5">Protected from day one</p>
              <p className="text-[13px] leading-relaxed text-slate-400">Every account is secured with email verification, OTP codes, and bot protection.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── About Us ── */}
      <section id="about-us" className="relative scroll-mt-20 py-14 md:py-20 lp-rule">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16 items-start" data-reveal="up">
            <div>
              <span className="lp-pill mb-5">
                <Compass className="h-3.5 w-3.5 text-violet-300" />
                <span className="lp-eyebrow">About FX Journal Pro</span>
              </span>
              <h2 className="font-display text-3xl sm:text-[38px] font-bold text-white tracking-[-0.025em] text-balance">
                Most traders lose to their habits, not the market
              </h2>
            </div>
            <div className="space-y-4 text-[15px] sm:text-base text-slate-400 leading-relaxed">
              <p>
                FX Journal Pro was built on a simple observation: traders rarely fail because their strategy is
                broken. They fail because they take the trade they promised themselves they would skip, size up
                after a loss, and never sit down to look at the pattern.
              </p>
              <p>
                A journal fixes that — but only if keeping it costs nothing. So we made it automatic. Install the
                free MetaTrader 5 Expert Advisor once and every trade lands in your journal with its entry, exit,
                size and result already filled in. All you add is the part no broker records: what you were
                thinking.
              </p>
              <p>
                From there the platform does the arithmetic you would never do by hand — win rate, profit factor,
                expectancy, drawdown, which session you are actually good at, which emotion costs you money — and
                an AI mentor that reads your own history rather than reciting generic advice.
              </p>
              <p className="text-slate-300">
                Built for forex and prop firm traders who have to answer to a rulebook, and for anyone tired of a
                spreadsheet that breaks every time they add a column.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Benefits ── */}
      <section id="why" className="relative scroll-mt-20 py-14 md:py-20 lp-rule">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12 grid lg:grid-cols-[1fr_auto] lg:items-end gap-5 lg:gap-12" data-reveal="up">
            <div className="max-w-xl">
              <span className="lp-pill mb-4">
                <Trophy className="h-3.5 w-3.5 text-violet-300" />
                <span className="lp-eyebrow">Why FX Journal Pro</span>
              </span>
              <h2 className="font-display text-3xl sm:text-[38px] font-bold text-white tracking-[-0.025em] text-balance">
                What changes once you keep a real journal
              </h2>
            </div>
            <p className="text-slate-400 text-[15px] leading-relaxed lg:max-w-sm lg:text-right">
              Not more features. Fewer repeated mistakes, and a record you can actually act on.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {benefits.map((b, i) => (
              <div
                key={b.title}
                className="lp-card group p-5"
                data-reveal="up"
                style={{ ['--reveal-i' as any]: Math.min(i, 5) }}
              >
                <span className="lp-chip w-10 h-10 mb-4">
                  <b.icon className="h-[18px] w-[18px] text-violet-300" />
                </span>
                <h3 className="text-sm font-semibold text-white mb-1.5">{b.title}</h3>
                <p className="text-[13px] leading-relaxed text-slate-400">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="relative scroll-mt-20 py-14 md:py-20 lp-rule">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12" data-reveal="up">
            <span className="lp-pill mb-5">
              <Wallet className="h-3.5 w-3.5 text-violet-300" />
              <span className="lp-eyebrow">Plans</span>
            </span>
            <h2 className="font-display text-3xl sm:text-[38px] font-bold text-white tracking-[-0.025em] text-balance">
              Start free. Upgrade when it pays for itself.
            </h2>
            <p className="mt-4 text-slate-400 text-[15px] leading-relaxed">
              One trade saved from a bad habit covers a year of Pro.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-10" data-reveal="up">
            <div className="lp-card p-6 sm:p-7 flex flex-col">
              <p className="lp-eyebrow">Free</p>
              <p className="font-display text-[40px] font-bold text-white leading-none tracking-[-0.03em] mt-3">₹0</p>
              <p className="text-[13px] text-slate-400 mt-2">For traders getting started. No card required.</p>
              <ul className="mt-6 space-y-2.5 flex-1">
                {['One trading account', 'Manual trade logging', 'Full analytics & calendar', 'FX news, live charts & tools', 'Export the last 30 days'].map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13px] text-slate-300">
                    <Check className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => openAuthModal('register')}
                className="lp-btn-ghost mt-7 w-full font-semibold rounded-full px-6 py-3 text-sm"
              >
                Get Started Free
              </button>
            </div>

            <div className="lp-card lp-card-accent p-6 sm:p-7 flex flex-col relative">
              <span className="absolute top-6 right-6 rounded-full border border-violet-300/40 bg-violet-400/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-100">
                Recommended
              </span>
              <p className="lp-eyebrow">Pro</p>
              <div className="flex items-baseline gap-2 mt-3">
                <p className="font-display text-[40px] font-bold text-white leading-none tracking-[-0.03em] lp-num">{PRO_PRICE_INR}</p>
                <span className="text-sm text-slate-300">/ 30 days</span>
              </div>
              {/*
                "/month ... Cancel anytime" described a subscription that does
                not exist. Checkout calls /api/payments/order — a one-time
                Razorpay order that grants exactly 30 days — and never
                /api/payments/subscribe, so there is nothing recurring and
                nothing to cancel. A customer reading "cancel anytime" would
                expect auto-renewal and a cancel button; access simply lapses
                instead. No auto-renewal is the honest wording, and the better
                selling point.
              */}
              <p className="text-[13px] text-slate-300/90 mt-2">
                {PRO_PRICE_USD} billed internationally. One-time payment, no auto-renewal.
              </p>
              <ul className="mt-6 space-y-2.5 flex-1">
                {['Unlimited trading accounts', 'MT5 automatic sync', 'AI Mentor on your own history', 'Export your full trade history'].map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13px] text-white">
                    <Check className="h-4 w-4 text-violet-200 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => openAuthModal('register')}
                className="lp-btn-primary mt-7 w-full font-semibold rounded-full px-6 py-3 text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-violet-900/30"
              >
                <span>Go Pro — {PRO_PRICE_INR}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="relative scroll-mt-20 py-14 md:py-20 lp-rule">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="lp-pill mb-4">
              <MessageSquare className="h-3.5 w-3.5 text-violet-300" />
              <span className="lp-eyebrow">FAQ</span>
            </span>
            <h2 className="font-display text-3xl sm:text-[38px] font-bold text-white tracking-[-0.025em] text-balance">Frequently Asked Questions</h2>
          </div>

          <div className="space-y-3">
            {faqs.map((f) => (
              <details key={f.q} className="faq group lp-card px-5 py-4">
                <summary className="flex items-center justify-between gap-4 cursor-pointer text-sm font-semibold text-white select-none">
                  {f.q}
                  <ChevronDown className="faq-chevron h-4 w-4 text-slate-500 shrink-0" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{f.a}</p>
              </details>
            ))}
          </div>

          <div className="lp-card lp-card-accent mt-12 text-center p-8 sm:p-10" data-reveal="scale">
            <h3 className="text-lg font-bold text-white mb-2">Start your trading journal today</h3>
            <p className="text-sm text-slate-400 mb-6 max-w-md mx-auto">Join 1,000+ traders improving their performance with MT5 auto-sync and AI coaching.</p>
            <button onClick={() => openAuthModal('register')} className="lp-btn-primary inline-flex items-center gap-2 font-semibold rounded-full px-7 py-3.5 text-sm">
              Get Started Free
              <ArrowUpRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* ── Contact ── */}
      <section id="contact" className="relative scroll-mt-20 py-14 md:py-20 lp-rule">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="lp-card lp-card-accent p-7 sm:p-10 grid lg:grid-cols-[1fr_auto] gap-8 lg:gap-12 lg:items-center" data-reveal="up">
            <div>
              <span className="lp-pill mb-5">
                <MessageSquare className="h-3.5 w-3.5 text-violet-200" />
                <span className="lp-eyebrow">Contact</span>
              </span>
              <h2 className="font-display text-2xl sm:text-[32px] font-bold text-white tracking-[-0.025em] text-balance">
                Questions, bugs, or a feature you need?
              </h2>
              <p className="mt-4 text-[15px] text-slate-300/90 leading-relaxed max-w-xl">
                Write to us directly — a real person reads every message. Already have an account? Raise a support
                ticket from inside the app and we can see your setup while we answer.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:min-w-[230px]">
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="lp-btn-primary inline-flex items-center justify-center gap-2 font-semibold rounded-full px-6 py-3.5 text-sm"
              >
                <MessageSquare className="h-4 w-4" />
                Email us
              </a>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-center font-mono text-[12px] text-slate-300 hover:text-white transition-colors break-all min-h-[24px] flex items-center justify-center"
              >
                {CONTACT_EMAIL}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-rule bg-[#030508] border-t border-white/[0.08] relative overflow-hidden">
        {/* Subtle background ambient light */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-violet-600/[0.07] blur-[100px] pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-12">
          
          {/* Trust Guarantee Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-12 mb-12 border-b border-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center shrink-0">
                <Cpu className="h-4 w-4 text-violet-400" />
              </div>
              <div>
                <p className="text-xs font-bold text-white leading-tight">MetaTrader 5 Sync</p>
                <p className="text-[11px] text-slate-400">Official Expert Advisor</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center shrink-0">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-bold text-white leading-tight">256-Bit SSL Security</p>
                <p className="text-[11px] text-slate-400">Bank-Grade Encryption</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center shrink-0">
                <Lock className="h-4 w-4 text-violet-400" />
              </div>
              <div>
                <p className="text-xs font-bold text-white leading-tight">Read-Only Telemetry</p>
                <p className="text-[11px] text-slate-400">Zero Fund Access</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center shrink-0">
                <Globe className="h-4 w-4 text-sky-400" />
              </div>
              <div>
                <p className="text-xs font-bold text-white leading-tight">Razorpay Protected</p>
                <p className="text-[11px] text-slate-400">Verified Subscriptions</p>
              </div>
            </div>
          </div>

          {/* Main Footer Links Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-10 lg:gap-8 mb-14">
            
            {/* Column 1: Brand & Community Socials (4 Cols on LG) */}
            <div className="lg:col-span-4 space-y-5">
              <div className="flex items-center gap-2.5">
                <Logo size={28} />
              </div>

              <p className="text-sm text-slate-400 leading-relaxed max-w-sm">
                The premier trading journal and performance intelligence terminal for forex, indices, and prop firm traders worldwide.
              </p>

              {/* Status Indicator */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-mono font-medium text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                All Systems Operational &middot; Live
              </div>

              {/* Social Icons */}
              <div>
                <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2.5">Join Community</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {SOCIAL_LINKS.map((s) => (
                    <a
                      key={s.label}
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={s.label}
                      className="h-9 w-9 rounded-xl bg-white/[0.04] hover:bg-violet-600/20 border border-white/[0.08] hover:border-violet-500/40 text-slate-400 hover:text-white flex items-center justify-center transition-all duration-200 hover:scale-110 shadow-sm"
                    >
                      <s.icon className="h-4 w-4" />
                    </a>
                  ))}
                </div>
              </div>
            </div>

            {/* Column 2: Platform Links (2 Cols on LG) */}
            <div className="lg:col-span-2">
              <h3 className="text-xs font-mono uppercase tracking-wider font-bold text-white mb-4">Platform</h3>
              <ul className="space-y-2.5 text-xs">
                <li><a href="/#features" onClick={(e) => handleNavClick(e, '/features', 'features')} className="text-slate-400 hover:text-white transition">Features</a></li>
                <li><a href="/#mt5-sync" onClick={(e) => handleNavClick(e, '/mt5-sync', 'mt5-sync')} className="text-slate-400 hover:text-white transition">MT5 Auto-Sync</a></li>
                <li><a href="/#fx-news" onClick={(e) => handleNavClick(e, '/fx-news', 'fx-news')} className="text-slate-400 hover:text-white transition">FX News &amp; Calendar</a></li>
                <li><a href="/#analytics" onClick={(e) => handleNavClick(e, '/analytics', 'analytics')} className="text-slate-400 hover:text-white transition">Performance Analytics</a></li>
                <li><a href="/#ai-mentor" onClick={(e) => handleNavClick(e, '/ai-mentor', 'ai-mentor')} className="text-slate-400 hover:text-white transition">AI Trade Mentor</a></li>
                <li><a href="/#security" onClick={(e) => handleNavClick(e, '/security', 'security')} className="text-slate-400 hover:text-white transition">Risk Auditor</a></li>
              </ul>
            </div>

            {/* Column 3: Resources Links (2 Cols on LG) */}
            <div className="lg:col-span-2">
              <h3 className="text-xs font-mono uppercase tracking-wider font-bold text-white mb-4">Resources</h3>
              <ul className="space-y-2.5 text-xs">
                <li><a href="/#how-it-works" onClick={(e) => handleNavClick(e, '/how-it-works', 'how-it-works')} className="text-slate-400 hover:text-white transition">How It Works</a></li>
                <li><a href="/#pricing" onClick={(e) => handleNavClick(e, '/pricing', 'pricing')} className="text-slate-400 hover:text-white transition">Pricing &amp; Plans</a></li>
                <li><a href="/#why" onClick={(e) => handleNavClick(e, '/why', 'why')} className="text-slate-400 hover:text-white transition">Prop Firm Consistency</a></li>
                <li><a href="/#faq" onClick={(e) => handleNavClick(e, '/faq', 'faq')} className="text-slate-400 hover:text-white transition">FAQ Center</a></li>
                <li><a href="/#contact" onClick={(e) => handleNavClick(e, '/contact', 'contact')} className="text-slate-400 hover:text-white transition">Contact Support</a></li>
                <li><a href={`mailto:${CONTACT_EMAIL}`} className="text-slate-400 hover:text-white transition">Direct Inquiries</a></li>
              </ul>
            </div>

            {/* Column 4: Legal & Policies (2 Cols on LG) */}
            <div className="lg:col-span-2">
              <h3 className="text-xs font-mono uppercase tracking-wider font-bold text-white mb-4">Legal &amp; Trust</h3>
              <ul className="space-y-2.5 text-xs">
                {(['risk', 'terms', 'refunds', 'privacy'] as const).map((key) => (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => setLegalDoc(key)}
                      className="text-slate-400 hover:text-white transition text-left"
                    >
                      {LEGAL_DOCS[key].title}
                    </button>
                  </li>
                ))}
                <li>
                  <span className="text-[11px] font-mono text-slate-500 block pt-1">
                    Razorpay Official Merchant Partner
                  </span>
                </li>
              </ul>
            </div>

            {/* Column 5: Weekly Market Wire Newsletter (2 Cols on LG) */}
            <div className="lg:col-span-2">
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3 shadow-lg">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-violet-400 animate-pulse" />
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-violet-300">Trader Wire</span>
                </div>
                <h4 className="text-xs font-bold text-white leading-snug">
                  Get Weekly High-Impact Forex Forecasts
                </h4>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Join 10,000+ traders receiving curated NFP, CPI &amp; central bank outlooks.
                </p>

                {newsletterSubscribed ? (
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] flex items-center gap-2 font-medium">
                    <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    Subscribed! Check your inbox.
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (newsletterEmail.trim()) setNewsletterSubscribed(true);
                    }}
                    className="space-y-2"
                  >
                    <input
                      type="email"
                      required
                      aria-label="Email address for the newsletter"
                      placeholder="trader@email.com"
                      value={newsletterEmail}
                      onChange={(e) => setNewsletterEmail(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.1] rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500/60 transition"
                    />
                    <button
                      type="submit"
                      className="w-full lp-btn-primary text-xs font-semibold py-1.5 rounded-xl flex items-center justify-center gap-1.5"
                    >
                      Subscribe Free
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                  </form>
                )}
              </div>
            </div>

          </div>


          {/* Bottom Copyright & Sessions Bar */}
          <div className="border-t border-white/[0.06] pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <p>&copy; {new Date().getFullYear()} FX Journal Pro. All rights reserved.</p>
            <div className="flex items-center gap-4 text-[11px] font-mono">
              <span className="text-slate-400">Made with obsession for traders.</span>
            </div>
          </div>

        </div>
      </footer>

      {/* Legal documents, reachable from the public page rather than only from
          inside the app. Same copy as the in-app footer. */}
      {legalDoc && LEGAL_DOCS[legalDoc] && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(3,4,8,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
          onClick={() => setLegalDoc(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setLegalDoc(null); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={LEGAL_DOCS[legalDoc].title}
            onClick={(e) => e.stopPropagation()}
            className="lp-card max-w-lg w-full p-6 sm:p-7"
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <h3 className="font-display text-lg font-bold text-white tracking-[-0.02em]">{LEGAL_DOCS[legalDoc].title}</h3>
              <button
                type="button"
                onClick={() => setLegalDoc(null)}
                aria-label="Close"
                className="text-slate-400 hover:text-white transition shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="h-72 overflow-y-auto pr-1 space-y-3 text-[13px] text-slate-400 leading-relaxed">
              {LEGAL_DOCS[legalDoc].body.map((para, i) => <p key={i}>{para}</p>)}
            </div>
            <div className="flex justify-end mt-5">
              <button
                type="button"
                autoFocus
                onClick={() => setLegalDoc(null)}
                className="lp-btn-primary font-semibold text-xs rounded-xl px-5 py-2.5"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <AuthModal isOpen={isAuthModalOpen} onClose={closeAuthModal}>
        {/* Glowing Brand Icon Badge */}
        <div className="mb-5 flex items-center">
          <div className="h-12 w-12 rounded-2xl flex items-center justify-center bg-slate-900/90 border border-violet-500/35 shadow-[0_0_25px_rgba(125,51,255,0.45)]">
            <Logo iconOnly size={26} />
          </div>
        </div>

        <div className="mb-6">
          <h3 className="text-2xl font-bold text-white tracking-tight">
            {isRegistering ? 'Activate your account' : isForgotPassword ? 'Reset password' : 'Sign in to your account'}
          </h3>
          <p className="text-[13px] text-slate-400 mt-1.5 leading-relaxed">
            {isRegistering
              ? 'Join FX Journal Pro to automate MT5 sync and unlock AI insights.'
              : isForgotPassword
                ? 'Enter your email to receive a secure password reset code.'
                : 'Enter your credentials below to access your trading dashboard.'}
          </p>
        </div>

        {isForgotPassword ? (
          resetSuccess ? (
            <div className="bg-emerald-500/10 text-emerald-300 text-sm rounded-xl p-4 border border-emerald-500/20 text-center font-medium">
              Password updated successfully!
            </div>
          ) : isResetOtpMode ? (
            <form onSubmit={handleResetPassword} className="space-y-3">
              <p className="text-sm text-slate-400 text-center">Code sent to <strong className="text-white">{resetEmail}</strong></p>
              {/* aria-label, because these two have no visible label and a
                  placeholder of "------" names nothing. */}
              <input type="text" required maxLength={6} value={resetOtpCode}
                aria-label="6-digit verification code"
                onChange={(e) => setResetOtpCode(e.target.value.replace(/\D/g, ''))}
                className={inputClass} placeholder="------" />
              <input type="password" required minLength={6} value={newPassword}
                aria-label="New password"
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass} placeholder="New password" />
              {authError && <div className="bg-red-500/10 text-red-300 text-sm rounded-xl p-3 border border-red-500/20">{authError}</div>}
              <button type="submit" disabled={actionLoading || resetOtpCode.length !== 6 || !newPassword} className={buttonPrimary}>
                {actionLoading ? 'Resetting...' : 'Reset password'}
              </button>
              <button type="button" onClick={() => { setIsForgotPassword(false); setAuthError(null); }}
                className="w-full text-center text-sm text-slate-400 hover:text-white font-medium transition-colors">Back to sign in</button>
            </form>
          ) : (
            <form onSubmit={handleForgotPassword} className="space-y-3">
              <div>
                <label htmlFor="reset-email" className="block text-sm font-medium text-slate-300 mb-1.5">Email address</label>
                <input id="reset-email" type="email" required value={resetEmail} onChange={(e) => setResetEmail(e.target.value)}
                  className={inputClass} placeholder="Email address" />
              </div>
              {authError && <div className="bg-red-500/10 text-red-300 text-sm rounded-xl p-3 border border-red-500/20">{authError}</div>}
              <button type="submit" disabled={actionLoading} className={buttonPrimary}>
                {actionLoading ? 'Sending...' : 'Send reset code'}
              </button>
              <button type="button" onClick={() => { setIsForgotPassword(false); setAuthError(null); }}
                className="w-full text-center text-sm text-slate-400 hover:text-white font-medium transition-colors">Back to sign in</button>
            </form>
          )
        ) : isOtpMode ? (
          <form onSubmit={handleVerifyOtp} className="space-y-3">
            <p className="text-sm text-slate-400 text-center">Code sent to <strong className="text-white">{authEmail}</strong></p>
            <input type="text" required maxLength={6} value={otpCode}
              aria-label="6-digit verification code"
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
              className={inputClass + ' text-center tracking-[0.5em] font-mono text-lg'} placeholder="------" />
            {authError && <div className="bg-red-500/10 text-red-300 text-sm rounded-xl p-3 border border-red-500/20">{authError}</div>}
            <button type="submit" disabled={actionLoading || otpCode.length !== 6} className={buttonPrimary}>
              {actionLoading ? 'Verifying...' : 'Verify & sign in'}
            </button>
            <div className="flex items-center justify-between text-sm">
              <button type="button" onClick={handleResendOtp} disabled={actionLoading} className="text-violet-300 hover:text-violet-200 font-medium transition-colors">Resend code</button>
              <button type="button" onClick={() => { setIsOtpMode(false); setOtpCode(''); setAuthError(null); }} className="text-slate-400 hover:text-white font-medium transition-colors">Change email</button>
            </div>
          </form>
        ) : isRegistering ? (
          <form onSubmit={handleRegister} className="space-y-3">
            {/* A recognised code is confirmed by name so the person can tell
                they are joining the partner they expect, and a mistyped code
                does not quietly become an unattributed signup. */}
            {referralPartner && (
              <div className="flex items-center gap-2.5 rounded-xl border border-violet-500/25 bg-violet-500/10 px-3.5 py-2.5">
                <Gift className="h-4 w-4 shrink-0 text-violet-300" />
                <p className="text-xs text-violet-200">
                  Joining through <span className="font-bold">{referralPartner}</span>
                </p>
              </div>
            )}
            <div>
              <label htmlFor="register-name" className="block text-sm font-medium text-slate-300 mb-1.5">Full name</label>
              <input id="register-name" type="text" required value={authName} onChange={(e) => setAuthName(e.target.value)} className={inputClass} placeholder="Full name" />
            </div>
            <div>
              <label htmlFor="register-email" className="block text-sm font-medium text-slate-300 mb-1.5">Email address</label>
              <input id="register-email" type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className={inputClass} placeholder="Email address" />
            </div>
            <div>
              <label htmlFor="register-password" className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
              <div className="relative">
                <input id="register-password" type={showPassword ? "text" : "password"} required value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)} className={inputClass + ' pr-11'} placeholder="Password" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  /* p-2 keeps the icon where it looks right while giving the hit
                     area the 24px WCAG 2.2 minimum; the bare icon was 16x16. */
                  className="absolute right-2 top-1.5 p-2 text-slate-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {authPassword && (() => {
                const strength = getPasswordStrength(authPassword);
                const color = strength >= 5 ? 'bg-emerald-500' : strength >= 3 ? 'bg-amber-400' : 'bg-rose-500';
                const textColor = strength >= 5 ? 'text-emerald-400' : strength >= 3 ? 'text-amber-300' : 'text-rose-400';
                const message = strength >= 5
                  ? 'Strong password.'
                  : strength === 4
                    ? 'Good password — almost there.'
                    : strength === 3
                      ? 'Getting stronger — add uppercase, numbers, or symbols.'
                      : 'Use a stronger password — mix uppercase, lowercase, numbers, and symbols.';
                return (
                  <div className="mt-2">
                    <div className="flex gap-1.5">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= strength ? color : 'bg-white/10'}`}></div>
                      ))}
                    </div>
                    <p className={`text-xs mt-1.5 ${textColor}`}>{message}</p>
                  </div>
                );
              })()}
            </div>
            {authError && <div className="bg-red-500/10 text-red-300 text-sm rounded-xl p-3 border border-red-500/20">{authError}</div>}
            <TurnstileBox onToken={setTurnstileToken} />
            <button type="submit" disabled={actionLoading} className={buttonPrimary}>
              {actionLoading ? 'Activating...' : "Let's start"}
            </button>
            <p className="text-center text-sm text-slate-400 pt-1">
              Already have an account?{' '}
              <button type="button" onClick={() => { setIsRegistering(false); setAuthError(null); }} className="text-violet-300 hover:text-violet-200 font-semibold transition-colors cursor-pointer">Sign in</button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Email address</label>
              <input id="login-email" type="email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className={inputClass} placeholder="trader@example.com" />
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <label htmlFor="login-password" className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Password</label>
                <button type="button" onClick={() => setIsForgotPassword(true)} className="text-xs text-violet-300 hover:text-violet-200 font-medium transition-colors cursor-pointer">Forgot password?</button>
              </div>
              <div className="relative">
                <input id="login-password" type={showPassword ? "text" : "password"} required value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)} className={inputClass + ' pr-11'} placeholder="••••••••••••" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-2 p-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {authError && <div className="bg-red-500/10 text-red-300 text-sm rounded-xl p-3 border border-red-500/20">{authError}</div>}
            <TurnstileBox onToken={setTurnstileToken} />
            <button type="submit" disabled={actionLoading} className={buttonPrimary}>
              {actionLoading ? 'Starting...' : "Let's start"}
            </button>

            <div className="relative my-3">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
              <div className="relative flex justify-center text-xs"><span className="bg-[#0b0d13] px-3 text-slate-400 font-medium">or continue with</span></div>
            </div>

            <button type="button" disabled={actionLoading}
              onClick={async () => {
                setActionLoading(true); setAuthError(null);
                try {
                  const { error } = await supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: { redirectTo: window.location.origin },
                  });
                  if (error) { setAuthError(error.message); setActionLoading(false); }
                } catch (err: any) { setAuthError(`Google error: ${err?.message || err}`); setActionLoading(false); }
              }}
              className="w-full bg-[#0e111a] hover:bg-[#131724] border border-white/10 hover:border-white/20 text-white rounded-2xl py-3.5 text-sm font-semibold flex items-center justify-center gap-2.5 transition shadow-sm disabled:opacity-50 cursor-pointer">
              <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              Google
            </button>

            <p className="text-center text-sm text-slate-400 pt-1">
              New to FX Journal Pro?{' '}
              <button type="button" onClick={() => { setIsRegistering(true); setAuthError(null); }} className="text-violet-300 hover:text-violet-200 font-semibold transition-colors cursor-pointer">Get started</button>
            </p>
          </form>
        )}
      </AuthModal>
    </div>
  );
}

function AuthModal({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) {
  const mouseDownTargetRef = useRef<EventTarget | null>(null);
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto p-4 sm:p-6"
      onMouseDown={(e) => {
        mouseDownTargetRef.current = e.target;
        mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
        isDraggingRef.current = false;
      }}
      onMouseMove={(e) => {
        if (mouseDownPosRef.current) {
          const dx = e.clientX - mouseDownPosRef.current.x;
          const dy = e.clientY - mouseDownPosRef.current.y;
          if (Math.hypot(dx, dy) > 4) {
            isDraggingRef.current = true;
          }
        }
      }}
      onMouseUp={() => {
        // Retain drag status through the immediate click event
        setTimeout(() => {
          mouseDownPosRef.current = null;
          isDraggingRef.current = false;
        }, 100);
      }}
      onClick={(e) => {
        // If a drag movement occurred anywhere, ignore the click
        if (isDraggingRef.current) return;
        if (mouseDownPosRef.current) {
          const dist = Math.hypot(e.clientX - mouseDownPosRef.current.x, e.clientY - mouseDownPosRef.current.y);
          if (dist > 4) return;
        }

        // Only close on stationary click directly on the backdrop container
        if (e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="cyber-matrix-backdrop fixed inset-0 backdrop-blur-md pointer-events-none" aria-hidden="true"></div>
      <div role="dialog" aria-modal="true" className="relative w-full max-w-[440px] my-auto animate-fade-up z-10" onClick={(e) => e.stopPropagation()}>
        <div className="cyber-card-glow-wrap">
          <div className="cyber-card-surface p-6 sm:p-8">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="absolute right-5 top-5 z-20 text-slate-400 hover:text-white h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 transition-all flex items-center justify-center cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}


// Sample equity series. y is the plotted coordinate (lower = higher equity);
// `value` is the balance the crosshair reads out, so the two never disagree.
const EQUITY_SERIES = [
  { x: 0, y: 95, value: 9980 }, { x: 20, y: 90, value: 10180 }, { x: 40, y: 93, value: 10060 },
  { x: 60, y: 84, value: 10420 }, { x: 80, y: 87, value: 10300 }, { x: 100, y: 76, value: 10740 },
  { x: 120, y: 80, value: 10580 }, { x: 140, y: 66, value: 11140 }, { x: 160, y: 72, value: 10900 },
  { x: 180, y: 58, value: 11460 }, { x: 200, y: 63, value: 11260 }, { x: 220, y: 48, value: 11860 },
  { x: 240, y: 52, value: 11700 }, { x: 260, y: 40, value: 12180 }, { x: 280, y: 32, value: 12500 },
  { x: 300, y: 24, value: 12700 }, { x: 314, y: 18, value: 12840 },
];

const VIEW_W = 320;
const VIEW_H = 110;

function EquityCurve({ className = '' }: { className?: string }) {
  const [hover, setHover] = useState<number | null>(null);

  const points = EQUITY_SERIES.map((p) => `${p.x},${p.y}`).join(' ');
  const areaPath = `M${points.split(' ').join(' L')} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`;
  const last = EQUITY_SERIES[EQUITY_SERIES.length - 1];
  const active = hover === null ? null : EQUITY_SERIES[hover];

  // Pointer x maps to the nearest sample, the way a terminal snaps a crosshair
  // to the closest candle rather than floating between them.
  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    const targetX = ratio * VIEW_W;
    let nearest = 0;
    for (let i = 1; i < EQUITY_SERIES.length; i++) {
      if (Math.abs(EQUITY_SERIES[i].x - targetX) < Math.abs(EQUITY_SERIES[nearest].x - targetX)) nearest = i;
    }
    setHover(nearest);
  };

  return (
    <div
      className={`lp-curve relative ${className}`}
      onPointerMove={handleMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-full" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
          {/* Runs from the brand accent into the profit colour, so the curve
              literally travels from "journal" to "green". */}
          <linearGradient id="eqLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>

        <g className="lp-spark-grid">
          {[25, 50, 75].map((y) => (
            <line key={y} x1="0" x2={VIEW_W} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          ))}
        </g>

        <path className="lp-spark-fill" d={areaPath} fill="url(#eqFill)" />

        {/* --lp-path-len drives the draw-on-load dash animation. */}
        <polyline
          className="lp-spark-line"
          style={{ ['--lp-path-len' as any]: 430 }}
          points={points}
          fill="none"
          stroke="url(#eqLine)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {active && (
          <line
            x1={active.x}
            x2={active.x}
            y1="0"
            y2={VIEW_H}
            stroke="rgba(255,255,255,0.28)"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* Markers live in HTML, not SVG: preserveAspectRatio="none" stretches the
          viewBox horizontally, which would squash any <circle> into an ellipse. */}
      <span
        className="lp-curve-dot lp-spark-dot"
        style={{ left: `${(last.x / VIEW_W) * 100}%`, top: `${(last.y / VIEW_H) * 100}%` }}
        aria-hidden="true"
      >
        <span className="lp-curve-ping" />
      </span>

      {active && (
        <>
          <span
            className="lp-curve-marker"
            style={{ left: `${(active.x / VIEW_W) * 100}%`, top: `${(active.y / VIEW_H) * 100}%` }}
            aria-hidden="true"
          />
          <span
            className="lp-curve-readout lp-num"
            style={{ left: `${(active.x / VIEW_W) * 100}%`, top: `${(active.y / VIEW_H) * 100}%` }}
          >
            ${active.value.toLocaleString('en-US')}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Counts a number up to its final value once, on mount.
 *
 * Returns the final value immediately when the viewer prefers reduced motion,
 * so the panel never shows a placeholder zero to someone who asked for stillness.
 */
function useCountUp(target: number, durationMs = 1400, startDelayMs = 200) {
  const [value, setValue] = useState(target);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    let timer = 0;
    const run = () => {
      const started = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - started) / durationMs, 1);
        // easeOutExpo: fast start, long settle — reads as a figure landing
        const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
        setValue(target * eased);
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    setValue(0);
    timer = window.setTimeout(run, startDelayMs);
    return () => {
      window.clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [target, durationMs, startDelayMs]);

  return value;
}

/* The hero's product panel: the same anatomy a trader sees after MT5 sync —
   account header, headline figure, equity curve, metric strip. Figures are the
   sample set used in the Analytics section and are labelled as such. */
function HeroPanel() {
  // Figures count up on load, the way a terminal fills in after it connects.
  const netProfit = useCountUp(12840, 1600, 350);
  const delta = useCountUp(34.2, 1600, 450);
  const winRate = useCountUp(68, 1400, 600);
  const profitFactor = useCountUp(2.1, 1400, 700);

  const metrics = [
    { label: 'Win Rate', value: `${Math.round(winRate)}%` },
    { label: 'Profit Factor', value: profitFactor.toFixed(1) },
    { label: 'Avg R:R', value: '1:2.4' },
  ];

  return (
    <div className="relative">
      <div className="absolute -inset-5 sm:-inset-8 rounded-[36px] bg-gradient-to-tr from-violet-600/25 via-indigo-500/10 to-transparent blur-3xl pointer-events-none" aria-hidden="true" />

      <div className="lp-card relative p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="lp-chip h-9 w-9 shrink-0">
              <Wallet className="h-[17px] w-[17px] text-violet-300" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-white leading-tight truncate">Main Portfolio</p>
              <p className="lp-eyebrow mt-0.5">MT5 &middot; Auto-synced</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-300">Live</span>
          </span>
        </div>

        <div className="mt-6 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="lp-eyebrow">Net Profit &middot; This quarter</p>
            <p className="lp-num font-display text-[34px] sm:text-[40px] font-bold text-white leading-none tracking-[-0.02em] mt-2">
              +${Math.round(netProfit).toLocaleString('en-US')}
            </p>
          </div>
          <span className="lp-num inline-flex items-center gap-1 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-300 shrink-0">
            <ArrowUpRight className="h-3.5 w-3.5" />
            {delta.toFixed(1)}%
          </span>
        </div>

        <EquityCurve className="w-full h-24 sm:h-28 mt-5" />

        <div className="mt-5 grid grid-cols-3 gap-2.5">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
              <p className="lp-num font-display text-lg font-bold text-white leading-none">{m.value}</p>
              <p className="lp-eyebrow mt-1.5 truncate">{m.label}</p>
            </div>
          ))}
        </div>

        <p className="lp-eyebrow mt-5 pt-4 border-t border-white/[0.07]">Sample portfolio &middot; your own figures after MT5 sync</p>
      </div>
    </div>
  );
}


import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LineChart, BarChart3, BookOpen, Calendar, Shield, ShieldOff, HelpCircle, User,
  ChevronRight, ChevronLeft, Sparkles, TrendingUp, TrendingDown, Layers,
  DollarSign, Plus, CheckCircle2, ArrowRight, ArrowLeft,
  LogOut, Star, Compass, Trash2, Check, Download, AlertTriangle,
  Clock, Heart, Tag, Edit3, Image as ImageIcon, Eye, EyeOff, RefreshCw, Radio,
  Cpu, Terminal, Globe, Bell, CreditCard, Info, Activity, Menu, Sun, Moon, Brain, Upload,
  FileSpreadsheet, FileText, Mail, Wrench, X, Newspaper, Trophy, Lock, Flame, MessageSquare, MoreHorizontal, Users,
  Settings
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

import {
  User as UserType,
  TradingAccount,
  Trade,
  RiskSettings,
  SupportTicket,
  Announcement
} from './types';

import { supabase } from './supabaseClient';

import GuidedTour from './components/GuidedTour';
import Logo from './components/Logo';
import { TraderRankCard } from './components/TraderRankCard';
import LegalFooter from './components/LegalFooter';
import NextEventCard from './components/NextEventCard';
import LoginPage from './pages/LoginPage';
import ProUpgradeModal from './components/ProUpgradeModal';
import ProFeaturePanel from './components/ProFeaturePanel';
import CustomAlertModal from './components/CustomAlertModal';

// Screens that only ever render behind an activeTab check. Splitting them out
// keeps the admin panel, the MT5 console and lightweight-charts out of the
// first download — a visitor who never signs in should not pay for them.
const TradingCalendar = React.lazy(() => import('./components/TradingCalendar'));
const TradingViewChart = React.lazy(() => import('./components/TradingViewChart'));
const FXNews = React.lazy(() => import('./components/FXNews'));
const MT5Automation = React.lazy(() => import('./components/MT5Automation'));
const AIInsights = React.lazy(() => import('./components/AIInsights'));
const AdminPanel = React.lazy(() => import('./components/AdminPanel'));
const PartnerPortal = React.lazy(() => import('./components/PartnerPortal'));
const TradingTools = React.lazy(() => import('./components/TradingTools'));
const AchievementsTab = React.lazy(() => import('./components/AchievementsTab'));
const NotebookTab = React.lazy(() => import('./components/NotebookTab'));


/**
 * Sections where "Add New Trade" belongs in the page header.
 *
 * It used to render on all twelve, so it sat above the pip calculator, the
 * news feed and the AI chat — places where logging a trade is not the next
 * thing anyone does. A primary button that is always there stops reading as
 * the action for the page you are on.
 *
 * Accounts is included because the first-run tour points at this button from
 * that screen, right after the portfolio is created.
 */
const ADD_TRADE_TABS = new Set(['dashboard', 'journal', 'accounts', 'calendar']);

/**
 * Placeholder shown while a lazily-loaded tab's chunk arrives.
 *
 * Deliberately quiet and roughly the height of a card, so switching tabs on a
 * slow connection reads as "loading" rather than as the page having emptied.
 */
const TabLoading = () => (
  <div className="flex items-center justify-center py-24" role="status" aria-live="polite">
    <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500/25 border-t-violet-500" />
    <span className="sr-only">Loading…</span>
  </div>
);

// ─── Symbol Contract Specifications ─────────────────────────────────────────
// contractSize = number of units per 1 standard lot
// pipValue     = USD value of 1 pip per 1 standard lot (for USD-quoted pairs)
// For pairs where profit currency != USD, we use a simplified conversion.
interface SymbolSpec {
  contractSize: number; // units per lot
  pipSize: number;      // 1 pip in price units (e.g. 0.0001 for EURUSD, 0.01 for USDJPY)
  pipValuePerLot: number; // USD value of 1 pip movement for 1 standard lot
}

/**
 * The sections a student can share with their mentor.
 *
 * Accounts is deliberately absent: it is a selection of portfolios rather than
 * a switch, so it is rendered on its own below these rows.
 */
const MENTOR_ACCESS_ROWS: { key: string; label: string; icon: any; blurb: string }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: BarChart3,
    blurb: 'Your balance, win rate, trade counts and activity heatmap.' },
  { key: 'analysis', label: 'Analysis', icon: LineChart,
    blurb: 'Win and loss performance, strategy and emotion breakdowns.' },
  { key: 'calendar', label: 'Calendar', icon: Calendar,
    blurb: 'Which days you traded, and the profit or loss on each.' },
  { key: 'liveCharts', label: 'Live charts', icon: Activity,
    blurb: 'Your trade entries and exits drawn on the price chart.' },
  { key: 'journal', label: 'Journal', icon: BookOpen,
    blurb: 'Your trade notes, emotions and tags.' },
  { key: 'notebook', label: 'Notebook', icon: Edit3,
    blurb: 'Your written notes and daily reviews. Off by default.' },
];

const SYMBOL_SPECS: Record<string, SymbolSpec> = {
  // Forex Majors
  EURUSD: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 10 },
  GBPUSD: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 10 },
  AUDUSD: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 10 },
  NZDUSD: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 10 },
  USDCAD: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 10 },
  USDCHF: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 10 },
  USDJPY: { contractSize: 100000, pipSize: 0.01, pipValuePerLot: 9.09 }, // ~$9.09 per pip (varies with JPY rate)
  // Forex Crosses EUR
  EURGBP: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 12.5 },
  EURJPY: { contractSize: 100000, pipSize: 0.01, pipValuePerLot: 9.09 },
  EURAUD: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 6.5 },
  EURCAD: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 7.4 },
  EURCHF: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 11.2 },
  EURNZD: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 6.1 },
  // Forex Crosses GBP
  GBPJPY: { contractSize: 100000, pipSize: 0.01, pipValuePerLot: 9.09 },
  GBPAUD: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 6.5 },
  GBPCAD: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 7.4 },
  GBPCHF: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 11.2 },
  GBPNZD: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 6.1 },
  // Forex Crosses AUD
  AUDJPY: { contractSize: 100000, pipSize: 0.01, pipValuePerLot: 9.09 },
  AUDCAD: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 7.4 },
  AUDCHF: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 11.2 },
  AUDNZD: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 6.1 },
  // Forex Crosses NZD
  NZDJPY: { contractSize: 100000, pipSize: 0.01, pipValuePerLot: 9.09 },
  NZDCAD: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 7.4 },
  NZDCHF: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 11.2 },
  // Forex Crosses CAD/CHF
  CADJPY: { contractSize: 100000, pipSize: 0.01, pipValuePerLot: 9.09 },
  CADCHF: { contractSize: 100000, pipSize: 0.0001, pipValuePerLot: 11.2 },
  CHFJPY: { contractSize: 100000, pipSize: 0.01, pipValuePerLot: 9.09 },
  // Metals
  XAUUSD: { contractSize: 100, pipSize: 0.01, pipValuePerLot: 1 },   // Gold: 100 troy oz, $1 per $0.01 move per lot → $1 per pip
  XAGUSD: { contractSize: 5000, pipSize: 0.001, pipValuePerLot: 5 }, // Silver: 5000 oz
  XPTUSD: { contractSize: 100, pipSize: 0.01, pipValuePerLot: 1 },  // Platinum
  XPDUSD: { contractSize: 100, pipSize: 0.01, pipValuePerLot: 1 },  // Palladium
  // Crypto
  BTCUSD: { contractSize: 1, pipSize: 0.01, pipValuePerLot: 0.01 },
  ETHUSD: { contractSize: 1, pipSize: 0.01, pipValuePerLot: 0.01 },
  LTCUSD: { contractSize: 1, pipSize: 0.01, pipValuePerLot: 0.01 },
  XRPUSD: { contractSize: 1, pipSize: 0.0001, pipValuePerLot: 0.0001 },
  // Indices (CFDs)
  US30: { contractSize: 1, pipSize: 1, pipValuePerLot: 1 },
  US500: { contractSize: 1, pipSize: 0.1, pipValuePerLot: 0.1 },
  NAS100: { contractSize: 1, pipSize: 0.1, pipValuePerLot: 0.1 },
  UK100: { contractSize: 1, pipSize: 1, pipValuePerLot: 0.88 },
  GER40: { contractSize: 1, pipSize: 1, pipValuePerLot: 1.1 },
  JPN225: { contractSize: 1, pipSize: 1, pipValuePerLot: 0.0067 },
  // Oil
  USOIL: { contractSize: 1000, pipSize: 0.01, pipValuePerLot: 10 },
  UKOIL: { contractSize: 1000, pipSize: 0.01, pipValuePerLot: 10 },
};

// Common symbol aliases
const SYMBOL_ALIASES: Record<string, string> = {
  GOLD: 'XAUUSD', SILVER: 'XAGUSD', XAUUSD_m: 'XAUUSD',
  DJIA: 'US30', SPX500: 'US500', NASDAQ: 'NAS100',
  WTI: 'USOIL', BRENT: 'UKOIL',
};

// All available symbols for autocomplete
const ALL_SYMBOLS = [
  'XAUUSD', 'XAGUSD', 'XPTUSD', 'XPDUSD',
  'EURUSD', 'EURGBP', 'EURJPY', 'EURAUD', 'EURCAD', 'EURCHF', 'EURNZD',
  'GBPUSD', 'GBPJPY', 'GBPAUD', 'GBPCAD', 'GBPCHF', 'GBPNZD',
  'USDJPY', 'USDCAD', 'USDCHF',
  'AUDUSD', 'AUDJPY', 'AUDCAD', 'AUDCHF', 'AUDNZD',
  'NZDUSD', 'NZDJPY', 'NZDCAD', 'NZDCHF',
  'CADJPY', 'CADCHF', 'CHFJPY',
  'BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD',
  'US30', 'US500', 'NAS100', 'UK100', 'GER40', 'JPN225',
  'USOIL', 'UKOIL',
];

/**
 * Calculate profit/loss for a trade based on symbol contract specs.
 * Returns USD profit (positive = profit, negative = loss).
 */
function calculateTradeProfit(
  symbol: string,
  tradeType: 'Buy' | 'Sell',
  entryPrice: number,
  exitPrice: number,
  lotSize: number
): number | null {
  const sym = symbol.toUpperCase().trim();
  const resolved = SYMBOL_ALIASES[sym] || sym;
  const spec = SYMBOL_SPECS[resolved];

  if (!spec || isNaN(entryPrice) || isNaN(exitPrice) || isNaN(lotSize) || lotSize <= 0) {
    return null;
  }

  const priceDiff = tradeType === 'Buy'
    ? exitPrice - entryPrice
    : entryPrice - exitPrice;

  // Number of pips moved
  const pips = priceDiff / spec.pipSize;

  // Profit = pips × pipValuePerLot × lots
  const profit = pips * spec.pipValuePerLot * lotSize;

  return parseFloat(profit.toFixed(2));
}

async function applyFreezePane(xlsxArray: Uint8Array, ySplit: number): Promise<Uint8Array> {
  const fflate = await import('fflate');
  const files = fflate.unzipSync(xlsxArray);
  const key = 'xl/worksheets/sheet1.xml';
  if (!files[key]) return xlsxArray;
  let xml = fflate.strFromU8(files[key]);
  const pane = `<pane xSplit="0" ySplit="${ySplit}" topLeftCell="A${ySplit + 1}" activePane="bottomLeft" state="frozen"/>`;
  if (/<sheetView[^>]*?\/>/.test(xml)) {
    xml = xml.replace(/<sheetView([^>]*?)\/>/, `<sheetView$1>${pane}</sheetView>`);
  } else {
    xml = xml.replace(/<sheetView([^>]*?)>/, `<sheetView$1>${pane}`);
  }
  files[key] = fflate.strToU8(xml);
  return fflate.zipSync(files, { level: 6 });
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  // FIX #2: Refs to guard against the onAuthStateChange / bootstrapSession
  // race condition and concurrent fetchAccountData calls.
  const bootstrapDoneRef = React.useRef(false);
  const isFetchingAccountsRef = React.useRef(false);

  // FIX #1: Actually persist the session IDs to sessionStorage so that
  // authFetch can inject them as headers on every subsequent API call,
  // including after a page refresh where the React state is empty.
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

  const persistSelectedAccount = (accountId: string) => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem('selected_account_id', accountId);
    window.localStorage.removeItem('selected_account_id');
  };

  const clearAuthSession = () => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.removeItem('auth_user_id');
    window.sessionStorage.removeItem('auth_email');
    window.sessionStorage.removeItem('auth_session_token');
    window.sessionStorage.removeItem('selected_account_id');
    window.localStorage.removeItem('auth_user_id');
    window.localStorage.removeItem('auth_email');
    window.localStorage.removeItem('auth_session_token');
    window.localStorage.removeItem('selected_account_id');
    return fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
    }).catch(console.error);
  };

  // Auth states
  const [user, setUser] = useState<UserType | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authName, setAuthName] = useState('Akshay Raj');
  const [isRegistering, setIsRegistering] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [authPassword, setAuthPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // OTP states
  const [isOtpMode, setIsOtpMode] = useState(false);
  const [otpCode, setOtpCode] = useState('');

  // Forgot/Reset password states
  const [resetEmail, setResetEmail] = useState('');
  const [isResetOtpMode, setIsResetOtpMode] = useState(false);
  const [resetOtpCode, setResetOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);

  // Navigation
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.replace(/^\//, '').toLowerCase();
      const DASHBOARD_TABS = ['dashboard', 'journal', 'notebook', 'accounts', 'analytics', 'calendar', 'chart', 'fxnews', 'tools', 'insights', 'settings', 'admin'];
      const TAB_ALIASES: Record<string, string> = { notes: 'notebook', note: 'notebook', news: 'fxnews', mentor: 'insights', 'ai-mentor': 'insights', mt5: 'dashboard', 'mt5-sync': 'dashboard' };
      const mapped = TAB_ALIASES[path] || path;
      if (DASHBOARD_TABS.includes(mapped)) return mapped;
    }
    return 'dashboard';
  });
  const [selectedChartTradeId, setSelectedChartTradeId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Remembered across reloads. Someone who widens the sidebar to read the
  // labels had it snap back to the icon rail on every page load, so the choice
  // never stuck. Reads defensively: storage throws in private windows.
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem('journal_sidebar_open') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('journal_sidebar_open', desktopSidebarOpen ? '1' : '0');
    } catch {
      /* storage unavailable — the sidebar still works, it just will not persist */
    }
  }, [desktopSidebarOpen]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Scroll UI state
  const [isScrolled, setIsScrolled] = useState(false);
  const [showMobileNavNotifications, setShowMobileNavNotifications] = useState(false);
  const [showMobileNavProfile, setShowMobileNavProfile] = useState(false);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  const handleMainScroll = (e: React.UIEvent<HTMLElement>) => {
    setIsScrolled(e.currentTarget.scrollTop > 150);
  };

  React.useEffect(() => {
    const handleWindowScroll = () => {
      if (window.scrollY > 150) {
        setIsScrolled(true);
      } else if (window.scrollY <= 150 && isScrolled) {
        setIsScrolled(false);
      } else {
        setIsScrolled(window.scrollY > 150);
      }
    };
    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleWindowScroll);
  }, [isScrolled]);
  const [fxNewsInitialTab, setFxNewsInitialTab] = useState<'news' | 'calendar'>('news');

  const openEconomicCalendar = () => {
    setFxNewsInitialTab('calendar');
    setActiveTab('fxnews');
  };

  // Core business states
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [riskSettings, setRiskSettings] = useState<RiskSettings | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  // A partner is technically an admin role (read-only, scoped), but they get
  // the Partner Portal rather than the Admin panel, so the role itself has to
  // reach the UI — isAdmin alone cannot tell the two apart.
  const [adminRole, setAdminRole] = useState<string>('USER');
  const isPartner = adminRole === 'PARTNER';

  // Who referred this user, and whether they have agreed to let that partner
  // read their trading data. Both come from the server; the toggle below is a
  // view of the stored value, never the value itself.
  const [partnerLink, setPartnerLink] = useState<{ hasPartner: boolean; partnerName?: string; allowPartnerTradeView: boolean } | null>(null);
  /** Per-section mentor permissions, and the accounts the student picks from. */
  const [mentorAccess, setMentorAccess] = useState<Record<string, any> | null>(null);
  const [mentorAccounts, setMentorAccounts] = useState<{ id: string; name: string }[]>([]);
  const [savingMentorAccess, setSavingMentorAccess] = useState<string | null>(null);
  const [savingPartnerVisibility, setSavingPartnerVisibility] = useState(false);

  // Mentor inspection read-only mode states
  const [isMentorReadOnlyMode, setIsMentorReadOnlyMode] = useState<boolean>(false);
  const [inspectedUser, setInspectedUser] = useState<any | null>(null);
  const [adminBackupData, setAdminBackupData] = useState<{
    user: UserType | null;
    accounts: TradingAccount[];
    trades: Trade[];
    riskSettings: RiskSettings | null;
    selectedAccountId: string;
    activeTab: string;
  } | null>(null);

  // Loading indicator states
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Onboarding Wizard states
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [showOnboardingWizard, setShowOnboardingWizard] = useState(false);
  const [obExperience, setObExperience] = useState<'Beginner' | 'Intermediate' | 'Professional'>('Intermediate');
  const [obStyle, setObStyle] = useState<'Scalping' | 'Day Trading' | 'Swing Trading'>('Day Trading');
  const [obMarkets, setObMarkets] = useState<string[]>(['Forex', 'Gold']);

  // Modals & New Form fields
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccBroker, setNewAccBroker] = useState('');
  const [newAccPlatform, setNewAccPlatform] = useState<'MT4' | 'MT5' | 'cTrader' | 'DXtrade'>('MT5');
  const [newAccType, setNewAccType] = useState<'Live' | 'Demo'>('Live');
  const [newAccInstitutionType, setNewAccInstitutionType] = useState<'Broker' | 'Prop Firm'>('Broker');
  const [newAccCurrency, setNewAccCurrency] = useState('USD');
  const [newAccBalance, setNewAccBalance] = useState('10000');

  const [accountCreationMethod, setAccountCreationMethod] = useState<'select' | 'manual' | 'mt5'>('select');
  const [newAccBalanceMode, setNewAccBalanceMode] = useState<'auto' | 'manual'>('auto');
  const [newAccMt5Login, setNewAccMt5Login] = useState('');
  const [newAccMt5Server, setNewAccMt5Server] = useState('');
  const [newAccMt5InvestorPassword, setNewAccMt5InvestorPassword] = useState('');
  const [showInvestorPassword, setShowInvestorPassword] = useState(false);

  // Edit Account form fields
  const [showEditAccountModal, setShowEditAccountModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<TradingAccount | null>(null);
  const [editAccName, setEditAccName] = useState('');
  const [editAccStartingBalance, setEditAccStartingBalance] = useState('');
  const [editAccCurrency, setEditAccCurrency] = useState('USD');

  // Trade form fields
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [journalPage, setJournalPage] = useState(1);
  const [tradeDate, setTradeDate] = useState('');
  const [tradeExitTime, setTradeExitTime] = useState('');
  const [tradeSymbol, setTradeSymbol] = useState(() => localStorage.getItem('lastTradeSymbol') || 'XAUUSD');
  const [tradeType, setTradeType] = useState<'Buy' | 'Sell'>('Buy');
  const [tradeLotSize, setTradeLotSize] = useState('0.1');
  const [tradeEntryPrice, setTradeEntryPrice] = useState('4450');
  const [tradeExitPrice, setTradeExitPrice] = useState('4460');
  const [tradeSL, setTradeSL] = useState('');
  const [tradeTP, setTradeTP] = useState('');
  const [tradeProfit, setTradeProfit] = useState('100');
  const [tradeProfitIsAuto, setTradeProfitIsAuto] = useState(true);
  const [tradeComm, setTradeComm] = useState('0');
  const [tradeSwap, setTradeSwap] = useState('0');
  const [tradeRisk, setTradeRisk] = useState('1.0');
  const [tradeStrategy, setTradeStrategy] = useState('Order Block Rejection');
  const [tradeEmotion, setTradeEmotion] = useState<'Calm' | 'Excited' | 'Anxious' | 'FOMO' | 'Greedy' | 'Revenge'>('Calm');
  const [tradeNotes, setTradeNotes] = useState('');
  const [showNoteField, setShowNoteField] = useState(false);
  const [showEmotionField, setShowEmotionField] = useState(false);
  const [showStrategyField, setShowStrategyField] = useState(false);
  const [tradeScreenshot, setTradeScreenshot] = useState('');
  const [showChartField, setShowChartField] = useState(false);
  const [screenshotError, setScreenshotError] = useState('');
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [screenshotDragging, setScreenshotDragging] = useState(false);
  /** Full-size chart image opened from the journal. */
  const [viewingScreenshot, setViewingScreenshot] = useState<string | null>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const [tradeTags, setTradeTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState('');
  // Symbol autocomplete
  const [symbolSuggestions, setSymbolSuggestions] = useState<string[]>([]);
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);
  const symbolInputRef = useRef<HTMLInputElement>(null);
  const symbolDropdownRef = useRef<HTMLDivElement>(null);

  // Paste-from-MT5 modal state
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteRawText, setPasteRawText] = useState('');
  const [parsedTrades, setParsedTrades] = useState<any[]>([]);
  const [pasteImporting, setPasteImporting] = useState(false);

  // Delete trade confirmation modal state
  const [deleteConfirmTradeId, setDeleteConfirmTradeId] = useState<string | null>(null);
  const [deleteConfirmDontShow, setDeleteConfirmDontShow] = useState(false);
  const [deleteConfirmLoading, setDeleteConfirmLoading] = useState(false);

  // Dismissible drawdown warning (dismissal is scoped to the current account)
  const [dismissedDrawdownAccount, setDismissedDrawdownAccount] = useState<string | null>(null);

  // Support ticket form
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [ticketTitle, setTicketTitle] = useState('');
  const [ticketCategory, setTicketCategory] = useState<'Support' | 'Billing' | 'Feature Request' | 'Bug' | 'Other'>('Other');
  const [ticketDescription, setTicketDescription] = useState('');

  // Filtering / Search state for Journal
  const [searchQuery, setSearchQuery] = useState('');
  const [journalFilterSymbol, setJournalFilterSymbol] = useState('');
  const [journalFilterStrategy, setJournalFilterStrategy] = useState('');
  const [journalFilterEmotion, setJournalFilterEmotion] = useState('');

  // Export Journal modal
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportPreset, setExportPreset] = useState('this-month');
  const [exportCustomStart, setExportCustomStart] = useState('');
  const [exportCustomEnd, setExportCustomEnd] = useState('');
  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx' | 'pdf'>('xlsx');

  // Unified settings tab state
  const [settingsTab, setSettingsTab] = useState<'achievements' | 'general' | 'notifications' | 'subscription' | 'about' | 'theme' | 'risk' | 'help'>('achievements');
  const [activeAboutForm, setActiveAboutForm] = useState<'none' | 'support' | 'bug' | 'feature'>('none');
  const [isSettingsDropdownOpen, setIsSettingsDropdownOpen] = useState(false);

  // Sign-out confirmation modal
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  // Set for the one render in which a sign-out lands, so the route guard does
  // not mistake the half-applied state for an unauthenticated deep link.
  const justLoggedOutRef = useRef(false);

  // Pro Upgrade modal state
  const [showProModal, setShowProModal] = useState(false);

  // Custom in-app alert modal state (replaces browser native alerts)
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    title?: string;
    message: string;
    type?: 'pro' | 'error' | 'success' | 'info' | 'warning';
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }>({
    isOpen: false,
    message: '',
  });

  const showAlert = useCallback((
    message: string,
    options?: {
      title?: string;
      type?: 'pro' | 'error' | 'success' | 'info' | 'warning';
      confirmText?: string;
      cancelText?: string;
      onConfirm?: () => void;
      onCancel?: () => void;
    }
  ) => {
    const isPro = options?.type === 'pro' || /pro|upgrade|plan is limited|limited to/i.test(options?.title || '') || /pro|upgrade|plan is limited|limited to/i.test(message);
    setAlertModal({
      isOpen: true,
      title: options?.title || (isPro ? 'Upgrade to Pro' : 'Notice'),
      message,
      type: isPro ? 'pro' : (options?.type || 'info'),
      confirmText: options?.confirmText || (isPro ? 'Upgrade to Pro — ₹499/mo' : 'Got it'),
      cancelText: options?.cancelText || (isPro ? 'Maybe Later' : 'Cancel'),
      onConfirm: options?.onConfirm || (isPro ? () => {
        setAlertModal(prev => ({ ...prev, isOpen: false }));
        setShowProModal(true);
      } : undefined),
      onCancel: options?.onCancel,
    });
  }, []);

  // Intercept window.alert so no raw browser popups ever appear
  useEffect(() => {
    const originalAlert = window.alert;
    window.alert = (msg?: any) => {
      const text = typeof msg === 'string' ? msg : String(msg ?? '');
      showAlert(text);
    };
    return () => {
      window.alert = originalAlert;
    };
  }, [showAlert]);

  // Escape closes whichever dialog is open. Several of these could only be
  // dismissed with the button in their corner.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setShowExportModal(false);
      setShowPasteModal(false);
      setShowTicketModal(false);
      setShowEditAccountModal(false);
      setShowTradeModal(false);
      setShowAccountModal(false);
      setViewingScreenshot(null);
      setSelectedNote(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // First-time guided onboarding tour
  const [showGuidedTour, setShowGuidedTour] = useState(false);
  const [guidedTourStep, setGuidedTourStep] = useState(1);

  // One-time MT5 Sync tour (all users)

  // Theme state with local persistence
  // Two letters from the display name, falling back to the email. Shown in the
  // avatar instead of a generic silhouette.
  const userInitials = React.useMemo(() => {
    const source = (user?.name || user?.email || 'T').trim();
    const parts = source.split(/[\s._-]+/).filter(Boolean);
    const letters = parts.length >= 2
      ? parts[0][0] + parts[1][0]
      : source.slice(0, 2);
    return letters.toUpperCase();
  }, [user?.name, user?.email]);

  // The menu had no dismiss behaviour: it stayed open until the trigger was
  // clicked again, even after clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!showMobileNavProfile) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!profileMenuRef.current?.contains(e.target as Node)) setShowMobileNavProfile(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMobileNavProfile(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showMobileNavProfile]);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      // Dark is the default so the dashboard opens in the same world as the
      // landing page. A saved preference still wins, and the header toggle
      // switches back at any time.
      const stored = localStorage.getItem('theme') as 'light' | 'dark' | null;
      return stored === 'light' || stored === 'dark' ? stored : 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Interactive settings inputs
  const [settingsName, setSettingsName] = useState('');
  const [settingsEmail, setSettingsEmail] = useState('');
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [settingsCurrPassword, setSettingsCurrPassword] = useState('');
  const [settingsNewPassword, setSettingsNewPassword] = useState('');
  const [settingsConfirmPassword, setSettingsConfirmPassword] = useState('');

  // Selected currency
  const [selectedCurrency, setSelectedCurrency] = useState('USD');

  const isSupabaseConfigured = Boolean(
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_KEY &&
    !import.meta.env.VITE_SUPABASE_URL.includes('your-project.supabase.co') &&
    !import.meta.env.VITE_SUPABASE_KEY.includes('your-anon-key')
  );
  const siteUrl = import.meta.env.VITE_SITE_URL?.trim();
  const authRedirectUrl =
    siteUrl ||
    (typeof window !== 'undefined' ? window.location.origin : '');

  const syncSupabaseUser = async (sessionUser: any, accessToken?: string) => {
    const userId = sessionUser?.id || '';
    const email = sessionUser?.email || '';
    if (!userId && !email) {
      setLoading(false);
      return;
    }

    const name =
      sessionUser?.user_metadata?.full_name ||
      sessionUser?.user_metadata?.name ||
      (email ? email.split('@')[0] : 'Trader');

    const authProvider = sessionUser?.app_metadata?.provider || 'email';

    // FIX #1 (applied): persistAuthSession now correctly writes to sessionStorage.
    // This ensures authFetch includes x-auth-user-id on all subsequent calls.
    persistAuthSession(userId, email);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-user-id': userId,
          'x-auth-email': email
        },
        // The server verifies this token with Supabase and derives the identity
        // from it. It no longer trusts a client-asserted "already verified" flag.
        body: JSON.stringify({ id: userId, email, name, provider: authProvider, supabaseAccessToken: accessToken })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          // Keep sessionStorage in sync with the server's canonical user id
          persistAuthSession(data.user.id || userId, data.user.email || email, data.sessionToken);
          setUser(data.user);
          setShowOnboardingWizard(false);
          await fetchAccountData();
          // Check admin status directly after login
          try {
            const canonicalId = data.user.id || userId;
            const canonicalEmail = data.user.email || email;
            const adminRes = await fetch('/api/admin/check', {
              headers: { 'x-auth-user-id': canonicalId, 'x-auth-email': canonicalEmail }
            });
            if (adminRes.ok) {
              const adminData = await adminRes.json();
              setIsAdmin(!!adminData.isAdmin);
              setAdminRole(adminData.role || 'USER');
            }
          } catch (_) { }
          setLoading(false);
          return;
        }
      }
    } catch (e) {
      console.error('Error syncing user with backend:', e);
    }

    setUser({
      id: userId || `user_${Date.now()}`,
      email,
      name,
      experience: 'Intermediate',
      tradingStyle: 'Day Trading',
      mainMarkets: ['Forex', 'Gold'],
      onboardingCompleted: false,
      isPro: false,
    });

    setShowOnboardingWizard(false);
    await fetchAccountData();
    setLoading(false);
  };

  // Notifications
  const [dailyTradingReminder, setDailyTradingReminder] = useState(true);
  const [maxDailyLossAlert, setMaxDailyLossAlert] = useState(true);
  const [journalCompletionReminder, setJournalCompletionReminder] = useState(false);

  // About Forms
  const [bugTitle, setBugTitle] = useState('');
  const [bugSeverity, setBugSeverity] = useState('Medium');
  const [bugSteps, setBugSteps] = useState('');
  const [featureRequestTitle, setFeatureRequestTitle] = useState('');
  const [featureRequestDesc, setFeatureRequestDesc] = useState('');

  // Sync profile details when user loads
  useEffect(() => {
    if (user) {
      setSettingsName(user.name);
      setSettingsEmail(user.email);
      // Check admin status from server (accounts for role updates in Supabase after login)
      authFetch('/api/admin/check')
        .then(res => res.json())
        .then(data => { setIsAdmin(!!data.isAdmin); setAdminRole(data.role || 'USER'); loadPartnerLink(); loadMentorAccess(); })
        .catch(() => setIsAdmin(false));
    } else {
      setIsAdmin(false);
    }
  }, [user]);

  // Public landing, auth, and section routes accessible without login
  const PUBLIC_PATHS = [
    '/', '/home', '/login', '/register', '/forgot-password',
    '/features', '/how-it-works', '/pricing', '/contact', '/about-us', '/why',
    '/fx-news', '/mt5-sync', '/analytics', '/ai-mentor', '/security', '/about', '/faq'
  ];

  const DASHBOARD_TABS = [
    'dashboard', 'journal', 'notebook', 'accounts', 'analytics', 'calendar',
    'chart', 'fxnews', 'tools', 'insights', 'settings', 'admin'
  ];

  const TAB_ALIASES: Record<string, string> = {
    notes: 'notebook',
    note: 'notebook',
    news: 'fxnews',
    mentor: 'insights',
    'ai-mentor': 'insights',
    mt5: 'dashboard',
    'mt5-sync': 'dashboard'
  };

  // Auth-based route redirection & section/tab synchronization
  useEffect(() => {
    if (!user) {
      // A sign-out clears `user` and navigates to the landing page in the same
      // update. This effect runs before the new pathname has propagated, so it
      // still sees /dashboard, decides that is a protected route with no auth,
      // and replaces the landing page with /login — which is why signing out
      // dumped you straight back onto a "Welcome back" form. Let the logout's
      // own navigation stand.
      if (justLoggedOutRef.current) {
        justLoggedOutRef.current = false;
        return;
      }
      const path = location.pathname.toLowerCase();
      // Allow valid public landing & section routes without redirecting or stripping hashes
      if (PUBLIC_PATHS.includes(path)) {
        return;
      }
      // If visiting a protected dashboard route without auth, redirect to /login while preserving hash and query
      navigate({ pathname: '/login', hash: location.hash, search: location.search }, { replace: true });
    } else {
      // Authenticated user
      const pathRaw = location.pathname.replace(/^\//, '').toLowerCase();
      const mappedTab = TAB_ALIASES[pathRaw] || pathRaw;

      if (DASHBOARD_TABS.includes(mappedTab)) {
        if (activeTab !== mappedTab) {
          setActiveTab(mappedTab);
        }
      } else if (location.pathname === '/login' || location.pathname === '/' || !location.pathname) {
        navigate(`/${activeTab || 'dashboard'}`, { replace: true });
      }
    }
  }, [user, location.pathname]);

  // Keep URL pathname in sync with activeTab when user switches tabs
  useEffect(() => {
    if (!user) return;
    const currentPath = location.pathname.replace(/^\//, '').toLowerCase();
    const mappedCurrent = TAB_ALIASES[currentPath] || currentPath;
    if (activeTab && DASHBOARD_TABS.includes(activeTab) && mappedCurrent !== activeTab) {
      navigate(`/${activeTab}`);
    }
  }, [user, activeTab]);

  // Synchronize document.title with activeTab when user is logged in
  useEffect(() => {
    if (!user) return;
    const tabTitles: Record<string, string> = {
      dashboard: 'Dashboard | FX Journal Pro',
      journal: 'Trading Journal | FX Journal Pro',
      notebook: 'Notebook | FX Journal Pro',
      accounts: 'Portfolio Accounts | FX Journal Pro',
      analytics: 'Performance Analytics | FX Journal Pro',
      calendar: 'Trading Calendar | FX Journal Pro',
      chart: 'Live Chart | FX Journal Pro',
      fxnews: 'FX News & Economic Calendar | FX Journal Pro',
      tools: 'Trading Tools & Calculators | FX Journal Pro',
      insights: 'Heyza AI | FX Journal Pro',
      settings: 'Account Settings | FX Journal Pro',
      admin: 'Admin Panel | FX Journal Pro',
    };
    document.title = tabTitles[activeTab] || 'Dashboard | FX Journal Pro';
  }, [user, activeTab]);

  // Check for pending Pro upgrade intent from landing page or pricing
  useEffect(() => {
    if (user && typeof window !== 'undefined') {
      if (sessionStorage.getItem('pending_upgrade_to_pro') === 'true') {
        sessionStorage.removeItem('pending_upgrade_to_pro');
        setShowProModal(true);
      }
    }
  }, [user]);

  // First-time onboarding wizard: trigger if registration completed but onboarding not completed
  useEffect(() => {
    if (user && !user.onboardingCompleted && accounts.length === 0 && !loading) {
      setShowOnboardingWizard(true);
    }
  }, [user, loading, accounts.length]);

  // Guided tour: show for first-time users.
  //
  // This used to key off `accounts.length === 0`, but sign-up auto-creates a
  // default portfolio, so the condition was false for every new customer: the
  // welcome tour never ran, and the MT5 changelog below ran instead. "No
  // trades yet" is what actually means new.
  useEffect(() => {
    if (!user || loading) return;
    if (localStorage.getItem('journal_tutorial_done') === '1') return;
    if (trades.length === 0) {
      setGuidedTourStep(1);
      setShowGuidedTour(true);
    }
  }, [user, loading, trades]);

  // Auto-advance from "Create Portfolio" to "Add First Trade" once a portfolio exists
  useEffect(() => {
    if (showGuidedTour && guidedTourStep === 2 && accounts.length > 0) {
      setGuidedTourStep(3);
    }
  }, [showGuidedTour, guidedTourStep, accounts]);

  // One-time MT5 Sync announcement.
  //
  // This is a changelog for people who were already using the product — it
  // opens with "we've fixed and improved MT5 syncing", which reads to a brand
  // new customer as "this used to be broken". It also points at a Pro feature.
  // So: existing users only (they have trades), and Pro only.
  // The MT5 Sync Tour was removed: the state and handlers existed but no
  // component ever rendered it, so setting the flag showed nothing — and
  // because the bottom tab bar hid itself whenever a tour was "open", the
  // mobile navigation disappeared permanently for every Pro user with trades.
  // Nothing could clear it, since completeMT5Tour had no UI to be called from.


  const startGuidedTour = () => {
    setGuidedTourStep(1);
    setShowGuidedTour(true);
  };

  const completeGuidedTour = () => {
    localStorage.setItem('journal_tutorial_done', '1');
    setShowGuidedTour(false);
  };

  const nextGuidedTourStep = () => {
    setGuidedTourStep(prev => {
      const next = prev + 1;
      if (next === 2) setActiveTab('accounts');
      if (next === 3) setActiveTab('dashboard');
      return Math.min(next, 4);
    });
  };

  const backGuidedTourStep = () => {
    setGuidedTourStep(prev => {
      const back = prev - 1;
      if (back === 2) setActiveTab('accounts');
      if (back === 1) setActiveTab('dashboard');
      return Math.max(back, 1);
    });
  };


  // Sync selected currency when activeAccount loads
  useEffect(() => {
    if (activeAccount) {
      setSelectedCurrency(activeAccount.currency);
    }
  }, [selectedAccountId, accounts]);

  // Load notification settings on mount
  useEffect(() => {
    const daily = localStorage.getItem('notif_daily');
    const loss = localStorage.getItem('notif_loss');
    const journal = localStorage.getItem('notif_journal');
    if (daily !== null) setDailyTradingReminder(daily === 'true');
    if (loss !== null) setMaxDailyLossAlert(loss === 'true');
    if (journal !== null) setJournalCompletionReminder(journal === 'true');
  }, []);

  // Chart customization states
  // Violet by default: emerald is the profit colour everywhere else in the
  // app, so an emerald equity curve read as "this line is a gain" rather than
  // "this line is your balance".
  const [chartStyle, setChartStyle] = useState<'violet' | 'emerald' | 'indigo' | 'charcoal' | 'sunset'>('violet');

  const getChartColors = () => {
    switch (chartStyle) {
      case 'emerald':
        return { stroke: '#10b981', gradient: '#10b981' };
      case 'indigo':
        return { stroke: '#6366f1', gradient: '#6366f1' };
      case 'charcoal':
        return { stroke: '#475569', gradient: '#475569' };
      case 'sunset':
        return { stroke: '#f59e0b', gradient: '#f59e0b' };
      case 'violet':
      default:
        return { stroke: '#8b5cf6', gradient: '#8b5cf6' };
    }
  };

  // active account
  const activeAccount = accounts.find(a => a.id === selectedAccountId);

  // authFetch — wraps native fetch and injects auth credentials, bearer tokens, and headers
  const authFetch = (url: string, options: RequestInit = {}): Promise<Response> => {
    const storedUserId = sessionStorage.getItem('auth_user_id') || localStorage.getItem('auth_user_id') || user?.id || '';
    const storedEmail = sessionStorage.getItem('auth_email') || localStorage.getItem('auth_email') || user?.email || '';
    const sessionToken = sessionStorage.getItem('auth_session_token') || localStorage.getItem('auth_session_token') || '';
    const method = (options.method || 'GET').toUpperCase();
    const needsContentType = ['POST', 'PUT', 'PATCH'].includes(method) && options.body;
    return fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        ...(needsContentType ? { 'Content-Type': 'application/json' } : {}),
        ...(storedUserId ? { 'x-auth-user-id': storedUserId } : {}),
        ...(storedEmail ? { 'x-auth-email': storedEmail } : {}),
        ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}`, 'x-session-token': sessionToken } : {}),
        ...(options.headers || {}),
      },
    });
  };

  useEffect(() => {
    const bootstrapSession = async () => {
      try {
        if (isSupabaseConfigured) {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            // Mark bootstrap in-progress so onAuthStateChange SIGNED_IN (which
            // fires concurrently) knows not to double-fetch.
            await syncSupabaseUser(session.user, session.access_token);
            bootstrapDoneRef.current = true;
            return;
          }
        }
      } catch (err) {
        console.error('Error loading Supabase session:', err);
      }

      // FIX #3: Write sessionStorage BEFORE calling fetchAccountData so that
      // authFetch has the correct user ID available when it builds headers.
      try {
        const storedId = sessionStorage.getItem('auth_user_id');
        const storedEmail = sessionStorage.getItem('auth_email');
        const headers: Record<string, string> = {};
        if (storedId) headers['x-auth-user-id'] = storedId;
        if (storedEmail) headers['x-auth-email'] = storedEmail;

        const res = await fetch('/api/auth/me', { headers, credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            // Persist the canonical IDs resolved by the server (cookie-based restore)
            // before we call fetchAccountData so authFetch has them available.
            persistAuthSession(data.user.id, data.user.email, data.sessionToken);
            setUser(data.user);
            setShowOnboardingWizard(false);
            await fetchAccountData();
            // Check admin status after session restore
            try {
              const adminHeaders = {
                'x-auth-user-id': data.user.id,
                'x-auth-email': data.user.email
              };
              const adminRes = await fetch('/api/admin/check', { headers: adminHeaders, credentials: 'include' });
              if (adminRes.ok) {
                const adminData = await adminRes.json();
                setIsAdmin(!!adminData.isAdmin);
                setAdminRole(adminData.role || 'USER');
              }
            } catch (_) { }
            setLoading(false);
            bootstrapDoneRef.current = true;
            return;
          }
        }
      } catch (e) {
        console.error('Error loading stored session:', e);
      }

      setLoading(false);
      bootstrapDoneRef.current = true;
    };

    bootstrapSession();

    let subscription: any = null;
    if (isSupabaseConfigured) {
      const subObj = supabase.auth.onAuthStateChange(async (event, session) => {
        // FIX #2: Guard against the race where onAuthStateChange(SIGNED_IN) fires
        // at the same time as bootstrapSession is still running (Supabase always
        // emits INITIAL_SESSION then SIGNED_IN on page load). We only call
        // syncSupabaseUser from here once bootstrap has fully completed — that way
        // this handler only reacts to genuine new sign-in events (e.g. after a
        // login form submission) and not to the initial session restore.
        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && session?.user) {
          if (!bootstrapDoneRef.current) {
            // Bootstrap is still running; it will handle data loading.
            return;
          }
          await syncSupabaseUser(session.user, session.access_token);
        }

        if (event === 'SIGNED_OUT') {
          clearAuthSession();
          setUser(null);
          setAccounts([]);
          setTrades([]);
          setSelectedAccountId('');
          setTickets([]);
          setAnnouncements([]);
          setRiskSettings(null);
          setEditingAccount(null);
          setEditingTradeId(null);
          setLoading(false);
        }
      });
      subscription = subObj.data?.subscription;
    }

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [isSupabaseConfigured]);

  // Fetch all user accounts, active trades, risk params, support queues
  const fetchAccountData = async (overrideAccountId?: string) => {
    // FIX #4: Guard against concurrent fetches. If a fetch is already in flight,
    // skip this call to prevent an empty-data response from temporarily
    // overwriting real data that the first fetch is about to return.
    if (isFetchingAccountsRef.current) return;
    isFetchingAccountsRef.current = true;
    setLoading(true);
    try {
      // Accounts
      const accsRes = await authFetch('/api/accounts');
      const accsData = await accsRes.json();
      const loadedAccs = Array.isArray(accsData.accounts) ? accsData.accounts : [];

      if (loadedAccs.length > 0) {
        // Only update state when we have real data — never clear existing data
        // while a fresh load is in progress (prevents empty-data flash).
        setAccounts(loadedAccs);
        const storedSelectedId = sessionStorage.getItem('selected_account_id');
        // Prefer stored selection → then first account
        const defaultId = overrideAccountId
          ? overrideAccountId
          : (storedSelectedId && loadedAccs.some((a: any) => a.id === storedSelectedId)
            ? storedSelectedId
            : loadedAccs[0].id);

        setSelectedAccountId(defaultId);
        persistSelectedAccount(defaultId);
        await fetchTradesAndParams(defaultId);
      } else {
        // Server returned no accounts for this user. Only clear state if we
        // actually got a valid (authenticated) response — i.e. the response
        // body was parseable and the user is logged in. This avoids wiping data
        // when the server returns 401/empty due to a missing auth header.
        setAccounts([]);
        setSelectedAccountId('');
        setTrades([]);
        setRiskSettings(null);
        sessionStorage.removeItem('selected_account_id');
        localStorage.removeItem('selected_account_id');
      }

      // Support tickets
      const tickRes = await authFetch('/api/tickets');
      const tickData = await tickRes.json();
      setTickets(Array.isArray(tickData.tickets) ? tickData.tickets : []);

      // Announcements
      const annRes = await authFetch('/api/announcements');
      const annData = await annRes.json();
      setAnnouncements(Array.isArray(annData.announcements) ? annData.announcements : []);

    } catch (e) {
      console.error('Error fetching dashboard tables:', e);
    } finally {
      setLoading(false);
      isFetchingAccountsRef.current = false;
    }
  };

  const [tradesRefreshing, setTradesRefreshing] = useState(false);

  const refreshTrades = async () => {
    if (!selectedAccountId) return;
    setTradesRefreshing(true);
    try {
      const tradesRes = await authFetch(`/api/trades?accountId=${selectedAccountId}`);
      const tradesData = await tradesRes.json();
      setTrades(tradesData.trades || []);
      // Also refresh account balance
      const accsRes = await authFetch('/api/accounts');
      const accsData = await accsRes.json();
      if (Array.isArray(accsData.accounts)) setAccounts(accsData.accounts);
    } catch (e) {
      console.error('Error refreshing trades:', e);
    } finally {
      setTradesRefreshing(false);
    }
  };

  const fetchTradesAndParams = async (accId: string) => {
    try {
      const tradesRes = await authFetch(`/api/trades?accountId=${accId}`);
      const tradesData = await tradesRes.json();
      setTrades(tradesData.trades || []);

      const riskRes = await authFetch(`/api/risk-settings/${accId}`);
      const riskData = await riskRes.json();
      setRiskSettings(riskData.riskSettings || null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleAccountChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const accId = e.target.value;
    setSelectedAccountId(accId);
    persistSelectedAccount(accId);
    await fetchTradesAndParams(accId);
  };

  // Auth Operations
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

      // Login/Sync with Express backend
      persistAuthSession(sessionStorage.getItem('auth_user_id') || user?.id || '', authEmail);
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-email': authEmail
        },
        body: JSON.stringify({ email: authEmail, password: authPassword })
      });

      if (!res.ok) {
        const errorData = await res.json();
        setAuthError(errorData.error || 'Login failed.');
        return;
      }

      const data = await res.json();
      if (data.user) {
        persistAuthSession(data.user.id, data.user.email || authEmail, data.sessionToken);
        setUser(data.user);
        setShowOnboardingWizard(false);
        await fetchAccountData();
      }
    } catch (err: any) {
      console.error('[AxyFx] Login error:', err);
      setAuthError(`Login connection error: ${err?.message || err || 'Network or Parsing error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authName) return;
    setActionLoading(true);
    setAuthError(null);
    try {
      // 1. Try registering with Supabase Auth in background if configured
      if (isSupabaseConfigured) {
        try {
          await supabase.auth.signUp({
            email: authEmail,
            password: authPassword,
            options: {
              data: {
                full_name: authName
              }
            }
          });
        } catch (sErr) {
          console.warn('[AxyFx] Supabase register background warning:', sErr);
        }
      }

      // 2. Register with Express Backend API (sends 6-digit OTP code via SendGrid / Resend)
      // Do NOT persist a session before OTP verification — otherwise a page refresh
      // while the OTP window is open would bypass verification.
      persistAuthSession(sessionStorage.getItem('auth_user_id') || user?.id || '');
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-auth-email': authEmail },
        body: JSON.stringify({ email: authEmail, name: authName, password: authPassword })
      });

      if (!res.ok) {
        const errorData = await res.json();
        setAuthError(errorData.error || 'Failed to create account.');
        return;
      }

      const data = await res.json();
      // Prompt user for 6-digit OTP Verification code
      setIsOtpMode(true);
      if (data.devOtp) {
        setOtpCode(data.devOtp);
      } else {
        setOtpCode('');
      }
      setAuthError(null);
    } catch (err: any) {
      console.error('[AxyFx] Registration connection error:', err);
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
      // 1. Verify 6-digit OTP code via backend API
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-auth-email': authEmail },
        body: JSON.stringify({ email: authEmail, otp: otpCode })
      });

      const data = await res.json();

      if (!res.ok) {
        setAuthError(data.error || 'Invalid or expired OTP code.');
        return;
      }

      if (data.user) {
        persistAuthSession(data.user.id, data.user.email || authEmail, data.sessionToken);
        setUser(data.user);
        setIsOtpMode(false);
        setOtpCode('');
        setShowOnboardingWizard(true);
        await fetchAccountData();
        return;
      }

      // 2. Also attempt Supabase verifyOtp in parallel if configured
      if (isSupabaseConfigured) {
        try {
          await supabase.auth.verifyOtp({
            email: authEmail,
            token: otpCode,
            type: 'signup'
          });
        } catch (sErr) {
          console.warn('[AxyFx] Supabase OTP verify warning:', sErr);
        }
      }
    } catch (err: any) {
      setAuthError(`OTP Verification error: ${err?.message || err}`);
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
      if (!res.ok) {
        setAuthError(data.error || 'Failed to resend verification code.');
      } else {
        if (data.devOtp) {
          setOtpCode(data.devOtp);
          alert(`Code generated: ${data.devOtp} (Email provider sender unverified or pending setup)`);
        } else {
          setOtpCode('');
          alert(`A new 6-digit verification code has been sent to ${authEmail}`);
        }
      }
    } catch (err: any) {
      setAuthError(`Resend error: ${err?.message || err}`);
    } finally {
      setActionLoading(false);
    }
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
      if (!res.ok) {
        setAuthError(data.error || 'Request failed. Please try again.');
        return;
      }
      // Move to OTP + new password step
      setIsResetOtpMode(true);
      if (data.devOtp) {
        setResetOtpCode(data.devOtp);
        alert(`Dev mode – Reset code: ${data.devOtp}`);
      } else {
        setResetOtpCode('');
      }
      setAuthError(null);
    } catch (err: any) {
      setAuthError(`Error: ${err?.message || err}`);
    } finally {
      setActionLoading(false);
    }
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
      if (!res.ok) {
        setAuthError(data.error || 'Failed to reset password.');
        return;
      }
      // Success – show success message then go back to login
      setResetSuccess(true);
      setTimeout(() => {
        setIsForgotPassword(false);
        setIsResetOtpMode(false);
        setResetSuccess(false);
        setResetEmail('');
        setResetOtpCode('');
        setNewPassword('');
        setAuthError(null);
      }, 2500);
    } catch (err: any) {
      setAuthError(`Error: ${err?.message || err}`);
    } finally {
      setActionLoading(false);
    }
  };


  const handleLogout = async () => {
    setShowSignOutModal(true);
  };

  const performLogout = async () => {
    try {
      if (isSupabaseConfigured) {
        await supabase.auth.signOut();
      }
    } catch (e) {
      console.error('[AxyFx] Error during Supabase signout:', e);
    }

    // Waited on so the session is actually revoked before the UI says it is.
    await clearAuthSession();

    setUser(null);
    setAccounts([]);
    setTrades([]);
    setSelectedAccountId('');
    setTickets([]);
    setAnnouncements([]);
    setRiskSettings(null);
    setEditingAccount(null);
    setEditingTradeId(null);
    setActiveTab('dashboard');
    setOnboardingStep(0);
    setShowOnboardingWizard(false);
    setIsOtpMode(false);
    setIsForgotPassword(false);
    setAuthError(null);
    setAuthEmail('');
    setAuthPassword('');
    setAuthName('');
    // Role and referral state belong to the account that just left. Leaving
    // them set would carry one person's Partner tab and "you joined through X"
    // into the next sign-in on this device until the server answered again.
    setIsAdmin(false);
    setAdminRole('USER');
    setPartnerLink(null);
    justLoggedOutRef.current = true;
    // Home, not the sign-in form. Someone who just chose to sign out being
    // handed a "Welcome back" prompt reads as the logout having failed.
    navigate('/', { replace: true });
  };

  const submitOnboarding = async () => {
    console.log('submitOnboarding called', { obExperience, obStyle, obMarkets });
    setActionLoading(true);
    try {
      console.log('Sending onboarding request...');
      const res = await authFetch('/api/auth/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          experience: obExperience,
          tradingStyle: obStyle,
          markets: obMarkets
        })
      });
      console.log('Onboarding response status:', res.status);
      const data = await res.json();
      console.log('Onboarding response data:', data);
      if (!res.ok) {
        alert(data.error || 'Failed to complete onboarding');
        return;
      }
      if (data.user) {
        setUser(data.user);
        setShowOnboardingWizard(false);
        fetchAccountData();
      }
    } catch (err) {
      console.error('Onboarding exception:', err);
      alert('Failed to complete onboarding: ' + err);
    } finally {
      setActionLoading(false);
    }
  };

  // Account Operations
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const storedId = sessionStorage.getItem('auth_user_id') || user?.id || '';
    const storedEmail = sessionStorage.getItem('auth_email') || user?.email || '';
    console.log('[handleCreateAccount] auth check — id:', storedId, 'email:', storedEmail);
    if (!newAccName.trim() || !newAccBroker.trim()) {
      showAlert('Please fill in Account Name and Broker Name.', { title: 'Required Fields', type: 'warning' });
      return;
    }
    if (accountCreationMethod === 'mt5') {
      if (!newAccMt5Login.trim()) {
        showAlert('Please enter your MT5 Login ID (account number).', { title: 'Required Field', type: 'warning' });
        return;
      }
      if (!newAccMt5Server.trim()) {
        showAlert('Please enter your MT5 Server name.', { title: 'Required Field', type: 'warning' });
        return;
      }
      if (!newAccMt5InvestorPassword.trim()) {
        showAlert('Please enter your MT5 Investor (read-only) Password.', { title: 'Required Field', type: 'warning' });
        return;
      }
    }
    if (accountCreationMethod === 'manual' && !newAccBalance) {
      showAlert('Please fill in Starting Balance.', { title: 'Required Field', type: 'warning' });
      return;
    }
    setActionLoading(true);
    try {
      const res = await authFetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAccName.trim(),
          broker: newAccBroker.trim(),
          platform: 'MT5',
          accountType: newAccType,
          currency: newAccCurrency,
          startingBalance: newAccBalance || '10000',
          isMt5Sync: accountCreationMethod === 'mt5',
          ...(accountCreationMethod === 'mt5' ? {
            institutionType: newAccInstitutionType,
            login: newAccMt5Login.trim(),
            server: newAccMt5Server.trim(),
            investorPassword: newAccMt5InvestorPassword.trim()
          } : {
            platform: newAccPlatform
          })
        })
      });
      console.log('[handleCreateAccount] response status:', res.status);
      const data = await res.json();
      console.log('[handleCreateAccount] response data:', data);
      if (res.ok) {
        setShowAccountModal(false);
        setNewAccName('');
        setNewAccBroker('');
        setNewAccMt5Login('');
        setNewAccMt5Server('');
        setNewAccMt5InvestorPassword('');
        setShowInvestorPassword(false);
        setNewAccInstitutionType('Broker');
        if (data.account?.id) {
          setSelectedAccountId(data.account.id);
          persistSelectedAccount(data.account.id);
          await fetchAccountData(data.account.id);
        } else {
          await fetchAccountData();
        }
      } else {
        const errMsg = data.error || `Server error (${res.status})`;
        console.error('[handleCreateAccount] error:', errMsg);
        if (res.status === 401) {
          showAlert('Your session has timed out. Please refresh or sign in again to sync your MT5 account.', {
            title: 'Authentication Required',
            type: 'warning',
            confirmText: 'Sign In Again',
            onConfirm: () => {
              setAlertModal(prev => ({ ...prev, isOpen: false }));
              handleLogout();
            }
          });
          return;
        }
        if (data.proRequired || /pro|upgrade|plan is limited|limited to/i.test(errMsg)) {
          showAlert(errMsg, {
            title: 'Unlimited Accounts (Pro Feature)',
            type: 'pro',
            confirmText: 'Upgrade to Pro — ₹499/mo',
            onConfirm: () => {
              setAlertModal(prev => ({ ...prev, isOpen: false }));
              setShowAccountModal(false);
              setShowProModal(true);
            }
          });
        } else {
          showAlert(errMsg, { title: 'Unable to Create Account', type: 'error' });
        }
      }
    } catch (err: any) {
      console.error('[handleCreateAccount] exception:', err);
      showAlert('Error creating account: ' + (err?.message || err), { title: 'Connection Error', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount || !editAccName || !editAccStartingBalance) return;
    setActionLoading(true);
    try {
      const res = await authFetch(`/api/accounts/${editingAccount.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editAccName,
          startingBalance: editAccStartingBalance,
          currency: editAccCurrency
        })
      });
      const data = await res.json();
      if (res.ok) {
        setShowEditAccountModal(false);
        setEditingAccount(null);
        fetchAccountData();
      } else if (data.error) {
        alert(data.error);
      }
    } catch (err) {
      alert('Error updating account');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!editingAccount) return;
    if (!window.confirm(`Are you sure you want to delete "${editingAccount.name}"? All associated trades and risk settings will be permanently removed.`)) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await authFetch(`/api/accounts/${editingAccount.id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (res.ok) {
        setShowEditAccountModal(false);
        setEditingAccount(null);
        const remaining = accounts.filter(a => a.id !== editingAccount.id);
        if (selectedAccountId === editingAccount.id) {
          const nextId = remaining.length > 0 ? remaining[0].id : '';
          setSelectedAccountId(nextId);
          persistSelectedAccount(nextId);
          await fetchAccountData(nextId);
        } else {
          await fetchAccountData();
        }
      } else if (data.error) {
        alert(data.error);
      }
    } catch (err) {
      alert('Error deleting account');
    } finally {
      setActionLoading(false);
    }
  };

  /**
   * Chart screenshot attached to a trade.
   *
   * The image is stored inline on the trade row (trades.screenshot, TEXT), so a
   * raw 4MB phone photo would be base64-inflated to ~5.5MB and then carried on
   * every journal fetch. Downscaling to 1600px and re-encoding as JPEG first
   * keeps a readable chart at roughly 200–400KB.
   */
  const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024; // pre-compression guard
  const MAX_STORED_SCREENSHOT_BYTES = 2 * 1024 * 1024; // post-compression ceiling

  const compressImageFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That file is not a readable image.'));
        img.onload = () => {
          const maxEdge = 1600;
          const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Image processing is unavailable in this browser.'));
          // Charts are usually screenshots with no alpha; a white matte stops
          // transparent PNGs turning black once they are flattened to JPEG.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          let quality = 0.82;
          let out = canvas.toDataURL('image/jpeg', quality);
          while (out.length * 0.75 > MAX_STORED_SCREENSHOT_BYTES && quality > 0.4) {
            quality -= 0.12;
            out = canvas.toDataURL('image/jpeg', quality);
          }
          resolve(out);
        };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });

  const handleScreenshotFile = async (file: File | null | undefined) => {
    if (!file) return;
    setScreenshotError('');
    if (!file.type.startsWith('image/')) {
      setScreenshotError('Only image files can be attached.');
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setScreenshotError('That image is over 8MB. Please pick a smaller one.');
      return;
    }
    setScreenshotBusy(true);
    try {
      const dataUrl = await compressImageFile(file);
      if (dataUrl.length * 0.75 > MAX_STORED_SCREENSHOT_BYTES) {
        setScreenshotError('Image is still too large after compression. Try a screenshot instead of a photo.');
        return;
      }
      setTradeScreenshot(dataUrl);
    } catch (err: any) {
      setScreenshotError(err?.message || 'Could not process that image.');
    } finally {
      setScreenshotBusy(false);
    }
  };

  // Trade Operations
  const handleOpenTradeModal = (trade?: Trade) => {
    if (trade) {
      setEditingTradeId(trade.id);
      if (trade.date) {
        try {
          const d = new Date(trade.date);
          const offset = d.getTimezoneOffset();
          const localDate = new Date(d.getTime() - offset * 60 * 1000);
          setTradeDate(localDate.toISOString().slice(0, 16));
        } catch (e) {
          setTradeDate('');
        }
      } else {
        setTradeDate('');
      }

      if (trade.exitTime) {
        try {
          const d = new Date(trade.exitTime);
          const offset = d.getTimezoneOffset();
          const localDate = new Date(d.getTime() - offset * 60 * 1000);
          setTradeExitTime(localDate.toISOString().slice(0, 16));
        } catch (e) {
          setTradeExitTime('');
        }
      } else {
        setTradeExitTime('');
      }
      setTradeSymbol(trade.symbol);
      setTradeType(trade.type as 'Buy' | 'Sell');
      setTradeLotSize(String(trade.lotSize));
      setTradeEntryPrice(String(trade.entryPrice));
      setTradeExitPrice(String(trade.exitPrice));
      setTradeSL(trade.stopLoss ? String(trade.stopLoss) : '');
      setTradeTP(trade.takeProfit ? String(trade.takeProfit) : '');
      setTradeProfit(String(trade.profit));
      setTradeProfitIsAuto(false); // When editing existing trade, keep profit as-is
      setTradeComm(String(trade.commission));
      setTradeSwap(String(trade.swap));
      setTradeRisk(String(trade.riskPercentage));
      setTradeStrategy(trade.strategy || 'Unspecified');
      setTradeEmotion(trade.emotion || 'Calm');
      setTradeNotes(trade.notes || '');
      setShowNoteField(!!(trade.notes && trade.notes.trim().length > 0));
      setShowEmotionField(!!(trade.emotion && trade.emotion !== 'Calm'));
      setShowStrategyField(!!(trade.strategy && trade.strategy.trim().length > 0 && trade.strategy !== 'Unspecified'));
      setTradeScreenshot(trade.screenshot || '');
      setShowChartField(!!trade.screenshot);
      setScreenshotError('');
      setTradeTags(trade.tags || []);
    } else {
      const defaultSymbol = localStorage.getItem('lastTradeSymbol') || 'XAUUSD';
      const defaultEntry = defaultSymbol === 'XAUUSD' ? '4450' : '1.08500';
      const defaultExit = defaultSymbol === 'XAUUSD' ? '4460' : '1.09200';
      const defaultLot = '0.1';
      setEditingTradeId(null);
      // Pre-fill current local date & time (refreshed each time the modal opens)
      const now = new Date();
      const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setTradeDate(localISO);
      setTradeSymbol(defaultSymbol);
      setTradeType('Buy');
      setTradeLotSize(defaultLot);
      setTradeEntryPrice(defaultEntry);
      setTradeExitPrice(defaultExit);
      setTradeSL('');
      setTradeTP('');
      // Auto-calculate profit for defaults
      const autoProfit = calculateTradeProfit(defaultSymbol, 'Buy', parseFloat(defaultEntry), parseFloat(defaultExit), parseFloat(defaultLot));
      setTradeProfit(autoProfit !== null ? String(autoProfit) : '100');
      setTradeProfitIsAuto(true);
      setTradeComm('0');
      setTradeSwap('0');
      setTradeRisk('1.0');
      setTradeStrategy('Order Block Rejection');
      setTradeEmotion('Calm');
      setTradeNotes('');
      setShowNoteField(false);
      setShowEmotionField(false);
      setShowStrategyField(false);
      setTradeScreenshot('');
      setShowChartField(false);
      setScreenshotError('');
      setTradeTags([]);
    }
    setSymbolSuggestions([]);
    setShowSymbolDropdown(false);
    setShowTradeModal(true);
  };

  // Auto-recalculate profit whenever trade inputs change
  useEffect(() => {
    if (!tradeProfitIsAuto) return;
    const entry = parseFloat(tradeEntryPrice);
    const exit = parseFloat(tradeExitPrice);
    const lot = parseFloat(tradeLotSize);
    const calc = calculateTradeProfit(tradeSymbol, tradeType, entry, exit, lot);
    if (calc !== null) {
      setTradeProfit(String(calc));
    }
  }, [tradeSymbol, tradeType, tradeEntryPrice, tradeExitPrice, tradeLotSize, tradeProfitIsAuto]);

  // Close symbol dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        symbolDropdownRef.current && !symbolDropdownRef.current.contains(e.target as Node) &&
        symbolInputRef.current && !symbolInputRef.current.contains(e.target as Node)
      ) {
        setShowSymbolDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSaveTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isMentorReadOnlyMode) {
      alert('Modifications are disabled in Mentor Read-Only Mode.');
      return;
    }
    if (!selectedAccountId) return alert('Select a trading account first.');

    const tradeData = {
      accountId: selectedAccountId,
      date: tradeDate ? new Date(tradeDate).toISOString() : new Date().toISOString(),
      symbol: tradeSymbol,
      type: tradeType,
      lotSize: tradeLotSize,
      entryPrice: tradeEntryPrice,
      exitPrice: tradeExitPrice,
      exitTime: tradeExitTime ? new Date(tradeExitTime).toISOString() : undefined,
      stopLoss: tradeSL || null,
      takeProfit: tradeTP || null,
      profit: tradeProfit,
      commission: tradeComm || 0,
      swap: tradeSwap || 0,
      riskPercentage: tradeRisk,
      strategy: tradeStrategy,
      emotion: tradeEmotion,
      notes: tradeNotes,
      screenshot: tradeScreenshot,
      tags: tradeTags
    };

    setActionLoading(true);
    try {
      let res;
      if (editingTradeId) {
        res = await authFetch(`/api/trades/${editingTradeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tradeData)
        });
      } else {
        res = await authFetch('/api/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tradeData)
        });
      }

      if (res.ok) {
        setShowTradeModal(false);
        setEditingTradeId(null);
        await fetchTradesAndParams(selectedAccountId);
        // Refresh accounts to get new balance/equity calculations
        const accsRes = await authFetch('/api/accounts');
        const accsData = await accsRes.json();
        setAccounts(accsData.accounts || []);
      } else {
        const errorData = await res.json();
        // The account this form was pointing at is gone — deleted elsewhere,
        // or the database moved under us. Resync and retry once, rather than
        // leaving the trader staring at a dialog about an account they did
        // not know had changed.
        if (errorData.code === 'ACCOUNT_STALE') {
          const fresh = errorData.accounts || [];
          setAccounts(fresh);
          const nextId = fresh[0]?.id || null;
          setSelectedAccountId(nextId);
          if (nextId) {
            const retry = await authFetch('/api/trades', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...tradeData, accountId: nextId }),
            });
            if (retry.ok) {
              setShowTradeModal(false);
              setEditingTradeId(null);
              await fetchTradesAndParams(nextId);
              const accsRes = await authFetch('/api/accounts');
              const accsData = await accsRes.json();
              setAccounts(accsData.accounts || []);
              return;
            }
          }
        }
        alert(errorData.error || 'Error saving trade record');
      }
    } catch (err: any) {
      console.error('Error saving trade:', err);
      alert('Error saving trade record: ' + (err?.message || err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteTrade = (tradeId: string) => {
    if (isMentorReadOnlyMode) {
      alert('Trade deletion is disabled in Mentor Read-Only Mode.');
      return;
    }
    // Check both user state and localStorage so the preference works instantly
    const skipConfirm = (user as any)?.preferences?.skipDeleteConfirm
      || localStorage.getItem('skipDeleteConfirm') === 'true';
    if (skipConfirm) {
      executeDeleteTrade(tradeId);
    } else {
      setDeleteConfirmDontShow(false);
      setDeleteConfirmTradeId(tradeId);
    }
  };

  const handleInspectUser = async (targetUser: any) => {
    try {
      setActionLoading(true);
      const res = await authFetch(`/api/admin/inspect-user/${targetUser.id}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showAlert(err.error || 'Failed to inspect trader data', { title: 'Trader Inspection', type: 'warning' });
        return;
      }
      const data = await res.json();

      // Backup current admin user data
      setAdminBackupData({
        user,
        accounts,
        trades,
        riskSettings,
        selectedAccountId,
        activeTab
      });

      const targetU = data.user || targetUser;
      const targetAccs: TradingAccount[] = data.accounts || [];
      const targetTrades: Trade[] = data.trades || [];
      const targetRisk: RiskSettings | null = data.riskSettings || null;

      setInspectedUser(targetU);
      setIsMentorReadOnlyMode(true);
      setUser(targetU);
      setAccounts(targetAccs);
      setTrades(targetTrades);
      setRiskSettings(targetRisk);
      if (targetAccs.length > 0) {
        setSelectedAccountId(targetAccs[0].id);
      } else {
        setSelectedAccountId('');
      }

      // Redirect mentor directly to user trading journal to inspect all trades
      setActiveTab('journal');
    } catch (err: any) {
      console.error('Error inspecting trader:', err);
      showAlert('Failed to inspect trader: ' + (err?.message || err), { title: 'Trader Inspection', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleExitMentorMode = () => {
    if (adminBackupData) {
      setUser(adminBackupData.user);
      setAccounts(adminBackupData.accounts);
      setTrades(adminBackupData.trades);
      setRiskSettings(adminBackupData.riskSettings);
      setSelectedAccountId(adminBackupData.selectedAccountId);
    }
    setIsMentorReadOnlyMode(false);
    setInspectedUser(null);
    setAdminBackupData(null);
    setActiveTab('admin');
  };

  const executeDeleteTrade = async (tradeId: string) => {
    setDeleteConfirmLoading(true);
    try {
      const res = await authFetch(`/api/trades/${tradeId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchTradesAndParams(selectedAccountId);
        // Refresh accounts
        const accsRes = await authFetch('/api/accounts');
        const accsData = await accsRes.json();
        setAccounts(accsData.accounts || []);
      } else {
        const errorData = await res.json();
        alert(errorData.error || 'Error deleting trade');
      }
    } catch (e: any) {
      alert('Error deleting trade: ' + (e?.message || e));
    } finally {
      setDeleteConfirmLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmTradeId) return;
    const tradeId = deleteConfirmTradeId;
    setDeleteConfirmTradeId(null);
    // Persist "don't show again" preference
    if (deleteConfirmDontShow) {
      // Write to localStorage immediately so next deletion skips the modal
      // without waiting for the async server call or React re-render
      localStorage.setItem('skipDeleteConfirm', 'true');
      try {
        const res = await authFetch('/api/auth/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skipDeleteConfirm: true })
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch (_) {
        // localStorage already set — preference will still work this session
      }
    }
    await executeDeleteTrade(tradeId);
  };

  // ── Paste-from-MT5 handlers ──
  const handleParsePaste = () => {
    const parsed = parseMt5PastedText(pasteRawText);
    setParsedTrades(parsed);
  };

  const handleImportParsedTrades = async () => {
    if (!selectedAccountId || parsedTrades.length === 0) return;
    setPasteImporting(true);
    try {
      const res = await authFetch('/api/trades/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccountId, trades: parsedTrades })
      });
      if (res.ok) {
        await fetchTradesAndParams(selectedAccountId);
        const accsRes = await authFetch('/api/accounts');
        const accsData = await accsRes.json();
        setAccounts(accsData.accounts);
        setShowPasteModal(false);
        setPasteRawText('');
        setParsedTrades([]);
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to import trades');
      }
    } catch (e: any) {
      alert('Import error: ' + (e?.message || e));
    } finally {
      setPasteImporting(false);
    }
  };

  // ── MT5 HTML/XML report parsers ──
  const parseMt5HtmlReport = (html: string): any[] => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const tables = doc.querySelectorAll('table');
    if (tables.length === 0) return [];

    // Score each table: pick the one with the most deal-like rows
    let bestTable: Element | null = null;
    let bestScore = -1;
    let bestHeaders: string[] = [];

    const dealKeywords = ['ticket', 'type', 'buy', 'sell', 'volume', 'symbol', 'profit', 'commission', 'swap'];
    const headerAliases: [string, string[]][] = [
      ['type', ['type', 'direction']],
      ['symbol', ['symbol', 'item', 'instrument', 'pair']],
      ['lots', ['lots', 'size', 'volume']],
      ['time', ['time', 'opentime', 'open_time', 'date']],
      ['entry', ['price', 'openprice', 'open_price']],
      ['exit', ['closeprice', 'close_price', 'exitprice', 'exit_price']],
      ['profit', ['profit', 'pnl']],
    ];

    const findHeaderIdx = (headers: string[], names: string[]): number => {
      for (const name of names) {
        const idx = headers.indexOf(name);
        if (idx !== -1) return idx;
        const pIdx = headers.findIndex(h => h.includes(name));
        if (pIdx !== -1) return pIdx;
      }
      return -1;
    };

    for (const tbl of tables) {
      const rows = tbl.querySelectorAll('tr');
      if (rows.length < 2) continue;

      // Normalize first row as headers
      const hCells = rows[0].querySelectorAll('th, td');
      const headers: string[] = [];
      hCells.forEach(c => headers.push((c.textContent || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')));

      // Score: +1 for each detected deal column
      let score = 0;
      for (const [, aliases] of headerAliases) {
        if (findHeaderIdx(headers, aliases) !== -1) score++;
      }
      // Bonus if type+buy/sell keywords found in data rows
      let dealCount = 0;
      for (let i = 1; i < Math.min(rows.length, 20); i++) {
        const text = rows[i].textContent?.toLowerCase() || '';
        if ((text.includes('buy') || text.includes('sell')) && /[0-9.]+/.test(text)) dealCount++;
      }
      if (dealCount >= 3) score += 5;

      if (score > bestScore) {
        bestScore = score;
        bestTable = tbl;
        bestHeaders = headers;
      }
    }

    if (!bestTable || bestScore < 3) return [];

    const rows = bestTable.querySelectorAll('tr');
    if (rows.length < 2) return [];

    const findCol = (names: string[]): number => findHeaderIdx(bestHeaders, names);
    const typeCol = findCol(['type', 'direction']);
    const symbolCol = findCol(['symbol', 'item', 'instrument', 'pair']);
    const lotsCol = findCol(['lots', 'size', 'volume']);
    const timeCol = findCol(['time', 'opentime', 'open_time', 'date']);
    const entryCol = findCol(['price', 'openprice', 'open_price']);
    const exitCol = findCol(['closeprice', 'close_price', 'exitprice', 'exit_price']);
    const profitCol = findCol(['profit', 'pnl']);
    const commCol = findCol(['commission', 'comm']);
    const swapCol = findCol(['swap', 'taxes', 'swaps']);

    // Price columns: first = entry, last = exit
    let entryIdx = entryCol;
    let exitIdx = exitCol;
    if (entryCol === exitCol && entryCol !== -1) {
      const allPrice: number[] = [];
      bestHeaders.forEach((h, i) => { if (h.includes('price') || h.includes('rate')) allPrice.push(i); });
      entryIdx = allPrice.length > 0 ? allPrice[0] : entryCol;
      exitIdx = allPrice.length > 1 ? allPrice[allPrice.length - 1] : entryIdx;
    }

    const parseNum = (s: string): number => {
      const cleaned = (s || '').replace(/[^0-9.\-]/g, '');
      return cleaned ? parseFloat(cleaned) : 0;
    };

    const results: any[] = [];
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].querySelectorAll('th, td');
      if (cells.length < 3) continue;

      const getVal = (idx: number): string => (idx !== -1 && idx < cells.length ? (cells[idx].textContent || '').trim() : '');

      const rawType = getVal(typeCol).toLowerCase();
      const tradeType = rawType === 'buy' ? 'Buy' as const : rawType === 'sell' ? 'Sell' as const : null;
      if (!tradeType) continue;

      const symbol = getVal(symbolCol).toUpperCase();
      if (!symbol) continue;

      const rawDate = getVal(timeCol);
      let parsedDate: string;
      if (rawDate) {
        const d = new Date(rawDate.replace(/\./g, '-').replace(/\s+/g, 'T'));
        parsedDate = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
      } else {
        parsedDate = new Date().toISOString();
      }

      results.push({
        date: parsedDate,
        symbol,
        type: tradeType,
        lotSize: parseNum(getVal(lotsCol)) || 0.01,
        entryPrice: entryIdx !== -1 ? parseNum(getVal(entryIdx)) : 0,
        exitPrice: exitIdx !== -1 ? parseNum(getVal(exitIdx)) : 0,
        profit: parseNum(getVal(profitCol)),
        commission: getVal(commCol) ? parseNum(getVal(commCol)) : 0,
        swap: getVal(swapCol) ? parseNum(getVal(swapCol)) : 0,
        strategy: 'Pasted from MT5',
        emotion: 'Calm',
        tags: ['MT5 Paste'],
        isMt5Sync: true
      });
    }
    return results;
  };

  const parseMt5XmlReport = (xml: string): any[] => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');

    // Try common MT5 export formats
    const dealNodes = doc.querySelectorAll('Deal, deal, Trade, trade, Order, order, Position, position');
    if (dealNodes.length === 0) return [];

    const parseNum = (s: string | null): number => {
      const cleaned = (s || '').replace(/[^0-9.\-]/g, '');
      return cleaned ? parseFloat(cleaned) : 0;
    };

    const results: any[] = [];
    for (const node of dealNodes) {
      const getTag = (names: string[]): string | null => {
        for (const name of names) {
          const el = node.querySelector(name);
          if (el?.textContent) return el.textContent.trim();
        }
        return null;
      };

      // Type: 0=Buy, 1=Sell or "buy"/"sell"
      const rawType = (getTag(['Type', 'type', 'DIRECTION']) || '').toLowerCase();
      const tradeType = rawType === 'buy' || rawType === '0' ? 'Buy' as const : rawType === 'sell' || rawType === '1' ? 'Sell' as const : null;
      if (!tradeType) continue;

      const symbol = (getTag(['Symbol', 'symbol', 'SYMBOL']) || '').toUpperCase();
      if (!symbol) continue;

      const rawDate = getTag(['OpenTime', 'Open_Time', 'opentime', 'Time', 'time', 'Date', 'date']);
      let parsedDate: string;
      if (rawDate) {
        const d = new Date(rawDate.replace(/\./g, '-').replace(/\s+/g, 'T'));
        parsedDate = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
      } else {
        parsedDate = new Date().toISOString();
      }

      const lotSize = parseNum(getTag(['Volume', 'volume', 'Lots', 'lots', 'Size', 'size']));
      const entryPrice = parseNum(getTag(['Price', 'price', 'OpenPrice', 'Open_Price', 'openprice']));
      const exitPrice = parseNum(getTag(['ClosePrice', 'Close_Price', 'closeprice', 'exitprice', 'ExitPrice', 'exit_price']));
      const profit = parseNum(getTag(['Profit', 'profit', 'PROFIT']));
      const commission = parseNum(getTag(['Commission', 'commission', 'COMMISSION']));
      const swap = parseNum(getTag(['Swap', 'swap', 'SWAP', 'Taxes', 'taxes']));

      results.push({
        date: parsedDate,
        symbol,
        type: tradeType,
        lotSize: lotSize || 0.01,
        entryPrice: entryPrice || 0,
        exitPrice: exitPrice || 0,
        profit: profit || 0,
        commission: commission || 0,
        swap: swap || 0,
        strategy: 'Pasted from MT5',
        emotion: 'Calm',
        tags: ['MT5 Paste'],
        isMt5Sync: true
      });
    }
    return results;
  };

  // ── File upload handler for MT5 reports ──
  const handleReportFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (!content) return;

      // Show raw content in textarea so user can see what was read
      setPasteRawText(content);

      const ext = file.name.split('.').pop()?.toLowerCase();
      let parsed: any[] = [];

      if (ext === 'html' || ext === 'htm') {
        parsed = parseMt5HtmlReport(content);
      } else if (ext === 'xml') {
        parsed = parseMt5XmlReport(content);
      }

      if (parsed.length > 0) {
        setParsedTrades(parsed);
      } else {
        setParsedTrades([]);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Sends the user to the Pro upgrade modal
  const goToSubscriptionSettings = () => {
    setShowProModal(true);
  };

  // ── Billing ───────────────────────────────────────────────────────────────
  // Replaces handleActivateFreePlan, which POSTed { isPro: true } to
  // update-profile. The server ignores that field by design (it was a free-Pro
  // escalation hole), so the old button reported success and granted nothing.

  const [billingLoading, setBillingLoading] = useState(true);
  const [billingConfigured, setBillingConfigured] = useState(false);
  const [subscription, setSubscription] = useState<any>(null);
  const [billingPayments, setBillingPayments] = useState<any[]>([]);

  const isProActive = !!user?.isPro;

  /**
   * Whole days of Pro remaining, or null when there is nothing to count from.
   *
   * Reads the subscription's period end rather than a stored flag, so a plan
   * that has lapsed or was cancelled shows the truth. Floored at 0: a negative
   * countdown would mean the plan already ended, and the flag would be off.
   */
  const proDaysLeft = (() => {
    const end = subscription?.currentPeriodEnd;
    if (!end) return null;
    const ms = new Date(end).getTime() - Date.now();
    if (Number.isNaN(ms)) return null;
    return Math.max(0, Math.ceil(ms / 86400000));
  })();

  const renewalDate = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  /**
   * When one-time Pro runs out. `user.proUntil` is what the server checks Pro
   * against, and it is the only date a one-time buyer has — they have no
   * subscription row, so renewalDate above is always null for them.
   */
  const proUntilLabel = (() => {
    const raw = (user as any)?.proUntil;
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  })();

  const loadBilling = useCallback(async () => {
    try {
      const [cfgRes, subRes] = await Promise.all([
        fetch('/api/payments/config'),
        authFetch('/api/payments/subscription'),
      ]);
      const cfg = await cfgRes.json().catch(() => ({}));
      setBillingConfigured(!!cfg?.configured);
      if (subRes.ok) {
        const data = await subRes.json().catch(() => ({}));
        setSubscription(data?.subscription || null);
        setBillingPayments(data?.payments || []);
      }
    } catch (e) {
      console.error('[billing] load failed', e);
    } finally {
      setBillingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && settingsTab === 'subscription') loadBilling();
  }, [user, settingsTab, loadBilling]);

  /** Loads Razorpay Checkout on demand rather than on every page load. */
  const loadRazorpayScript = () =>
    new Promise<boolean>((resolve) => {
      if ((window as any).Razorpay) return resolve(true);
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });

  const handleUpgradeToPro = () => {
    setShowProModal(true);
  };

  const handleCancelSubscription = () => {
    showAlert(
      'Are you sure you want to cancel your Pro subscription? You will still keep access to all Pro features until your current billing period ends.',
      {
        title: 'Cancel Subscription?',
        type: 'warning',
        confirmText: 'Yes, Cancel Pro',
        cancelText: 'Keep Subscription',
        onConfirm: async () => {
          setActionLoading(true);
          try {
            const res = await authFetch('/api/payments/cancel', { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            showAlert(data?.message || data?.error || 'Your subscription has been cancelled. You will retain Pro access until the end of your billing cycle.', {
              title: 'Subscription Cancelled',
              type: 'info',
              confirmText: 'OK',
            });
            await loadBilling();
          } catch (e) {
            showAlert('Could not cancel subscription right now. Please contact support.', {
              title: 'Cancellation Failed',
              type: 'error',
              confirmText: 'OK',
            });
          } finally {
            setActionLoading(false);
          }
        },
      }
    );
  };


  // Custom Settings Handlers
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsName) return;
    setActionLoading(true);
    try {
      // The email address is the account identity and can no longer be changed
      // from here — doing so without re-verification allowed account takeover.
      const res = await authFetch('/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: settingsName })
      });
      const data = await res.json();
      if (res.ok) {
        setUser(data.user);
        if (data.user?.id) {
          persistAuthSession(data.user.id, data.user.email || user?.email || '');
        }
        alert('General profile settings updated successfully.');
      } else {
        alert(data.error || 'Failed to update settings.');
      }
    } catch (e) {
      alert('Error updating profile.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsCurrPassword || !settingsNewPassword || !settingsConfirmPassword) {
      alert('Please fill out all password fields.');
      return;
    }
    if (settingsNewPassword !== settingsConfirmPassword) {
      alert('New passwords do not match!');
      return;
    }
    setActionLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: settingsNewPassword
      });
      if (!error) {
        alert('Password updated successfully.');
        setSettingsCurrPassword('');
        setSettingsNewPassword('');
        setSettingsConfirmPassword('');
        setShowPasswordChange(false);
      } else {
        alert(error.message || 'Failed to update password.');
      }
    } catch (e) {
      alert('Error changing password.');
    } finally {
      setActionLoading(false);
    }
  };

  const loadMentorAccess = useCallback(async () => {
    try {
      const res = await fetch('/api/user/mentor-access', { credentials: 'include' });
      if (!res.ok) return;
      const body = await res.json();
      setMentorAccess(body.access || null);
      setMentorAccounts(body.accounts || []);
    } catch {
      // Leaves the section unrendered rather than showing permissions that
      // might not match what the server holds.
    }
  }, []);

  const loadPartnerLink = useCallback(async () => {
    try {
      const res = await fetch('/api/user/partner-link', { credentials: 'include' });
      if (res.ok) {
        setPartnerLink(await res.json());
      }
    } catch {
      // A failure here just leaves the section hidden; nothing else depends on it.
    }
  }, []);

  /**
   * Saves one section. The request carries only the key that changed, because
   * the endpoint merges — sending the whole map from a client that predates a
   * new section would reset it.
   */
  const handleMentorAccessChange = async (key: string, value: boolean | string[] | null) => {
    const previous = mentorAccess;
    setSavingMentorAccess(key);
    setMentorAccess((prev) => (prev ? { ...prev, [key]: value } : prev));
    try {
      const res = await fetch('/api/user/mentor-access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ [key]: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save that setting.');
      // Reconciled with what was actually stored: the server drops account ids
      // the user does not own, so an optimistic value can be wrong.
      setMentorAccess(body.access || null);
    } catch (err: any) {
      setMentorAccess(previous);
      alert(err.message || 'Could not save that setting.');
    } finally {
      setSavingMentorAccess(null);
    }
  };

  const handlePartnerVisibility = async (allow: boolean) => {
    setSavingPartnerVisibility(true);
    // Optimistic, then reconciled with whatever the server actually stored —
    // the checkbox must never end up showing a permission that is not real.
    setPartnerLink((prev) => (prev ? { ...prev, allowPartnerTradeView: allow } : prev));
    try {
      const res = await fetch('/api/user/partner-visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ allow }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save that setting.');
      setPartnerLink((prev) => (prev ? { ...prev, allowPartnerTradeView: !!body.allowPartnerTradeView } : prev));
    } catch (err: any) {
      setPartnerLink((prev) => (prev ? { ...prev, allowPartnerTradeView: !allow } : prev));
      alert(err.message || 'Could not save that setting.');
    } finally {
      setSavingPartnerVisibility(false);
    }
  };

  const handleSaveNotifications = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('notif_daily', String(dailyTradingReminder));
    localStorage.setItem('notif_loss', String(maxDailyLossAlert));
    localStorage.setItem('notif_journal', String(journalCompletionReminder));
    alert('Notification preferences updated successfully!');
  };


  const handleReportBug = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bugTitle || !bugSteps) {
      alert('Please fill out all fields.');
      return;
    }
    setActionLoading(true);
    try {
      const res = await authFetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `[Bug Report - Severity: ${bugSeverity}] ${bugTitle}`,
          description: `Steps to reproduce:\n${bugSteps}`,
          category: 'Bug'
        })
      });
      if (res.ok) {
        setBugTitle('');
        setBugSteps('');
        setActiveAboutForm('none');
        // Refresh tickets list
        const tickRes = await authFetch('/api/tickets');
        const tickData = await tickRes.json();
        setTickets(tickData.tickets);
        alert('Bug report submitted successfully. Thank you for helping us improve FX Journal Pro.');
      } else {
        alert('Failed to submit bug report.');
      }
    } catch (err) {
      alert('Error submitting bug report.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleFeatureRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!featureRequestTitle || !featureRequestDesc) {
      alert('Please fill out all fields.');
      return;
    }
    setActionLoading(true);
    try {
      const res = await authFetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `[Feature Request] ${featureRequestTitle}`,
          description: featureRequestDesc,
          category: 'Feature Request'
        })
      });
      if (res.ok) {
        setFeatureRequestTitle('');
        setFeatureRequestDesc('');
        setActiveAboutForm('none');
        // Refresh tickets list
        const tickRes = await authFetch('/api/tickets');
        const tickData = await tickRes.json();
        setTickets(tickData.tickets);
        alert('Feature request submitted successfully. Our product team will review this soon!');
      } else {
        alert('Failed to submit feature request.');
      }
    } catch (err) {
      alert('Error submitting feature request.');
    } finally {
      setActionLoading(false);
    }
  };

  // Support ticket logging
  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketTitle || !ticketDescription) return;
    setActionLoading(true);
    try {
      const res = await authFetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: ticketTitle,
          description: ticketDescription,
          category: ticketCategory
        })
      });
      if (res.ok) {
        setShowTicketModal(false);
        setTicketTitle('');
        setTicketDescription('');
        // Refresh tickets list
        const tickRes = await authFetch('/api/tickets');
        const tickData = await tickRes.json();
        setTickets(tickData.tickets);
        alert('Support ticket submitted successfully. Our engineers will respond shortly.');
      }
    } catch (err) {
      alert('Error creating support ticket.');
    } finally {
      setActionLoading(false);
    }
  };

  // Update Risk Rules
  const handleSaveRiskSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const accId = selectedAccountId || activeAccount?.id || (accounts.length > 0 ? accounts[0].id : '');
    if (!accId) return;
    const currentRisk = riskSettings || {
      id: `r_${Date.now()}`,
      accountId: accId,
      riskPerTradeLimit: 2.0,
      dailyLossLimit: 500,
      weeklyLossLimit: 1500,
      maxDrawdownLimit: 10.0,
      disciplineEnabled: true,
      maxTradesPerDay: 5
    };
    setActionLoading(true);
    try {
      const res = await authFetch(`/api/risk-settings/${accId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentRisk)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.riskSettings) {
          setRiskSettings(data.riskSettings);
        }
        alert('Risk parameters saved successfully. Drawdown scanners are active.');
      } else {
        alert('Error saving risk settings');
      }
    } catch (err) {
      alert('Error saving risk settings');
    } finally {
      setActionLoading(false);
    }
  };

  const isPortfolioGuardOn = riskSettings ? (riskSettings.disciplineEnabled ?? true) : true;

  const handleTogglePortfolioGuard = async (newState: boolean) => {
    const accId = selectedAccountId || activeAccount?.id || (accounts.length > 0 ? accounts[0].id : '');
    if (!accId) return;
    const currentRisk: RiskSettings = riskSettings || {
      id: `r_${Date.now()}`,
      accountId: accId,
      riskPerTradeLimit: 2.0,
      dailyLossLimit: 500,
      weeklyLossLimit: 1500,
      maxDrawdownLimit: 10.0,
      disciplineEnabled: true,
      maxTradesPerDay: 5
    };
    const updated = { ...currentRisk, accountId: accId, disciplineEnabled: newState };
    setRiskSettings(updated);
    try {
      const res = await authFetch(`/api/risk-settings/${accId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.riskSettings) {
          setRiskSettings(data.riskSettings);
        }
      }
    } catch (err) {
      console.error('Failed to toggle portfolio guard', err);
    }
  };

  const updateRiskSettingField = (field: keyof RiskSettings, value: any) => {
    const accId = selectedAccountId || activeAccount?.id || (accounts.length > 0 ? accounts[0].id : '');
    const currentRisk: RiskSettings = riskSettings || {
      id: `r_${Date.now()}`,
      accountId: accId,
      riskPerTradeLimit: 2.0,
      dailyLossLimit: 500,
      weeklyLossLimit: 1500,
      maxDrawdownLimit: 10.0,
      disciplineEnabled: true,
      maxTradesPerDay: 5
    };
    setRiskSettings({ ...currentRisk, accountId: accId, [field]: value });
  };

  // Add tag helper
  const addCustomTag = () => {
    const clean = customTagInput.trim();
    if (clean && !tradeTags.includes(clean)) {
      setTradeTags([...tradeTags, clean]);
      setCustomTagInput('');
    }
  };

  const removeTag = (t: string) => {
    setTradeTags(tradeTags.filter(tg => tg !== t));
  };

  // ==========================================
  // MATHEMATICAL STATISTICS & METRICS ENGINE
  // ==========================================

  const isTradingTrade = (t: Trade) => t.type !== 'Deposit' && t.type !== 'Withdrawal';
  const tradingTrades = trades.filter(isTradingTrade);

  const totalTradesCount = tradingTrades.length;
  const wins = tradingTrades.filter(t => t.profit > 0);
  const losses = tradingTrades.filter(t => t.profit <= 0);
  const winRate = totalTradesCount > 0 ? (wins.length / totalTradesCount) * 100 : 0;

  const sumWins = wins.reduce((sum, t) => sum + t.profit, 0);
  const sumLosses = Math.abs(losses.reduce((sum, t) => sum + t.profit, 0));
  const profitFactor = sumLosses > 0 ? parseFloat((sumWins / sumLosses).toFixed(2)) : parseFloat(sumWins.toFixed(2));

  // Risk Reward Ratio calculation
  const averageWin = wins.length > 0 ? sumWins / wins.length : 0;
  const averageLoss = losses.length > 0 ? sumLosses / losses.length : 0;
  const avgRR = averageLoss > 0 ? parseFloat((averageWin / averageLoss).toFixed(2)) : 0;

  // Winning / Losing streaks
  const sortedByDate = [...tradingTrades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let currentWinStreak = 0, maxWinStreak = 0;
  let currentLossStreak = 0, maxLossStreak = 0;
  for (const t of sortedByDate) {
    if (t.profit > 0) {
      currentWinStreak++;
      currentLossStreak = 0;
      if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
    } else {
      currentLossStreak++;
      currentWinStreak = 0;
      if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
    }
  }

  // Drawdown math
  const startingBal = activeAccount?.startingBalance || 10000;
  const currentBal = activeAccount?.currentBalance || 10000;
  const netProfit = parseFloat((currentBal - startingBal).toFixed(2));

  // High-end stats computation
  const maxDrawdownPercentage = currentBal < startingBal
    ? parseFloat((((startingBal - currentBal) / startingBal) * 100).toFixed(2))
    : 0;

  // Today's cumulative metrics for Guard scanner
  const todayTrades = tradingTrades.filter(t => {
    if (!t.date) return false;
    const tradeDate = new Date(t.date);
    const today = new Date();
    return tradeDate.getFullYear() === today.getFullYear() &&
      tradeDate.getMonth() === today.getMonth() &&
      tradeDate.getDate() === today.getDate();
  });

  const todayLoss = Math.abs(todayTrades.filter(t => t.profit < 0).reduce((sum, t) => sum + t.profit, 0));
  const todayTradesCount = todayTrades.length;

  // Compile Chart Data
  // 1. Equity Curve
  let cumulative = startingBal;
  const equityCurveData = [...trades].reverse().map((t, idx) => {
    cumulative += (t.profit + (t.commission || 0) + (t.swap || 0));
    return {
      name: `Trade ${idx + 1}`,
      equity: parseFloat(cumulative.toFixed(2)),
      profit: parseFloat((t.profit + (t.commission || 0) + (t.swap || 0)).toFixed(2))
    };
  });
  // Add starting coordinate
  equityCurveData.unshift({ name: 'Start', equity: startingBal, profit: 0 });

  // 2. Bar Chart: Profit by Symbol
  const symbolMap: { [key: string]: number } = {};
  tradingTrades.forEach(t => {
    symbolMap[t.symbol] = (symbolMap[t.symbol] || 0) + t.profit;
  });
  const symbolChartData = Object.keys(symbolMap).map(sym => ({
    name: sym,
    profit: parseFloat(symbolMap[sym].toFixed(2))
  })).sort((a, b) => b.profit - a.profit);

  // 3. Pie Chart: Sessions
  // Map trades to trading sessions (simulated based on timestamp hour, or mock)
  const sessionData = [
    { name: 'London Session', value: tradingTrades.filter((_, idx) => idx % 3 === 0).length, color: '#2563eb' },
    { name: 'New York Session', value: tradingTrades.filter((_, idx) => idx % 3 === 1).length, color: '#10b981' },
    { name: 'Asian Session', value: tradingTrades.filter((_, idx) => idx % 3 === 2).length, color: '#f59e0b' }
  ].filter(d => d.value > 0);

  // 4. Best & Worst Trades
  const sortedTradesByProfit = [...tradingTrades].sort((a, b) => b.profit - a.profit);
  const bestTrade = sortedTradesByProfit.length > 0 ? sortedTradesByProfit[0] : null;
  const worstTrade = sortedTradesByProfit.length > 0 ? sortedTradesByProfit[sortedTradesByProfit.length - 1] : null;

  // 4b. Best & Worst Days (based on daily net P&L)
  const getLocalDayKey = (dateInput: string | Date) => {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dailyNetMap: { [key: string]: { net: number; count: number } } = {};
  tradingTrades.forEach(t => {
    const dKey = getLocalDayKey(t.date);
    if (!dKey) return;
    if (!dailyNetMap[dKey]) dailyNetMap[dKey] = { net: 0, count: 0 };
    dailyNetMap[dKey].net += t.profit + (t.commission || 0) + (t.swap || 0);
    dailyNetMap[dKey].count += 1;
  });
  const sortedDaysByNet = Object.keys(dailyNetMap)
    .map(dKey => ({ dayKey: dKey, net: parseFloat(dailyNetMap[dKey].net.toFixed(2)), count: dailyNetMap[dKey].count }))
    .sort((a, b) => b.net - a.net);
  const bestDay = sortedDaysByNet.length > 0 ? sortedDaysByNet[0] : null;
  const worstDay = sortedDaysByNet.length > 0 ? sortedDaysByNet[sortedDaysByNet.length - 1] : null;

  // 5. Monthly P&L Chart Data
  const monthlyMap: { [key: string]: number } = {};
  tradingTrades.forEach(t => {
    try {
      const d = new Date(t.date);
      if (!isNaN(d.getTime())) {
        const monthYear = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        monthlyMap[monthYear] = (monthlyMap[monthYear] || 0) + t.profit;
      }
    } catch (e) { }
  });

  const monthlyPnlChartData = Object.keys(monthlyMap).map(my => ({
    name: my,
    profit: parseFloat(monthlyMap[my].toFixed(2))
  })).sort((a, b) => new Date(a.name).getTime() - new Date(b.name).getTime());

  // Pro Feature 1: Equity Growth & Underwater Drawdown Curve Data
  const equityDrawdownData = React.useMemo(() => {
    const startBal = activeAccount?.startingBalance || 10000;
    let runningBal = startBal;
    let peakBal = runningBal;
    const sortedTrades = [...tradingTrades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const points = [{
      name: 'Start',
      equity: startBal,
      drawdown: 0,
      pnl: 0
    }];

    sortedTrades.forEach((t, i) => {
      const net = t.profit + (t.commission || 0) + (t.swap || 0);
      runningBal += net;
      if (runningBal > peakBal) peakBal = runningBal;
      const ddPercent = peakBal > 0 ? -parseFloat((((peakBal - runningBal) / peakBal) * 100).toFixed(2)) : 0;

      const label = t.date ? new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : `#${i + 1}`;
      points.push({
        name: label,
        equity: parseFloat(runningBal.toFixed(2)),
        drawdown: ddPercent,
        pnl: parseFloat(net.toFixed(2))
      });
    });

    return points;
  }, [tradingTrades, activeAccount]);

  // Pro Feature 2: Day-of-Week Win Rate & Edge Performance
  const dayOfWeekPerformance = React.useMemo(() => {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const dayMap: { [key: string]: { name: string; trades: number; wins: number; losses: number; profit: number; winRate: number } } = {
      Monday: { name: 'Mon', trades: 0, wins: 0, losses: 0, profit: 0, winRate: 0 },
      Tuesday: { name: 'Tue', trades: 0, wins: 0, losses: 0, profit: 0, winRate: 0 },
      Wednesday: { name: 'Wed', trades: 0, wins: 0, losses: 0, profit: 0, winRate: 0 },
      Thursday: { name: 'Thu', trades: 0, wins: 0, losses: 0, profit: 0, winRate: 0 },
      Friday: { name: 'Fri', trades: 0, wins: 0, losses: 0, profit: 0, winRate: 0 }
    };

    tradingTrades.forEach(t => {
      if (!t.date) return;
      const d = new Date(t.date);
      const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
      if (dayMap[dayName]) {
        dayMap[dayName].trades += 1;
        const net = t.profit + (t.commission || 0) + (t.swap || 0);
        dayMap[dayName].profit += net;
        if (t.profit > 0) dayMap[dayName].wins += 1;
        else if (t.profit < 0) dayMap[dayName].losses += 1;
      }
    });

    return days.map(d => {
      const item = dayMap[d];
      const wr = item.trades > 0 ? parseFloat(((item.wins / item.trades) * 100).toFixed(1)) : 0;
      return {
        ...item,
        winRate: wr,
        profit: parseFloat(item.profit.toFixed(2))
      };
    });
  }, [tradingTrades]);

  // Pro Feature 3: Advanced Performance Metrics (Profit Factor, Expectancy, Streaks)
  const proMetrics = React.useMemo(() => {
    let grossProfit = 0;
    let grossLoss = 0;
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let curWins = 0;
    let curLosses = 0;

    const sorted = [...tradingTrades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    sorted.forEach(t => {
      if (t.profit > 0) {
        grossProfit += t.profit;
        curWins += 1;
        curLosses = 0;
        if (curWins > maxConsecutiveWins) maxConsecutiveWins = curWins;
      } else if (t.profit < 0) {
        grossLoss += Math.abs(t.profit);
        curLosses += 1;
        curWins = 0;
        if (curLosses > maxConsecutiveLosses) maxConsecutiveLosses = curLosses;
      }
    });

    const profitFactor = grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(2)) : (grossProfit > 0 ? 99.9 : 0);
    const totalTrd = tradingTrades.length;
    const wr = totalTrd > 0 ? (wins.length / totalTrd) : 0;
    const lr = totalTrd > 0 ? (losses.length / totalTrd) : 0;
    const avgWin = wins.length > 0 ? (grossProfit / wins.length) : 0;
    const avgLoss = losses.length > 0 ? (grossLoss / losses.length) : 0;
    const expectancy = parseFloat(((wr * avgWin) - (lr * avgLoss)).toFixed(2));

    return {
      profitFactor,
      expectancy,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      grossProfit: parseFloat(grossProfit.toFixed(2)),
      grossLoss: parseFloat(grossLoss.toFixed(2))
    };
  }, [tradingTrades, wins, losses]);

  // Reset journal page when filters change
  useEffect(() => {
    setJournalPage(1);
  }, [searchQuery, journalFilterSymbol, journalFilterEmotion]);

  // Filter trades for tabular journal.
  //
  // This used to run unmemoised on every render of this component. With a
  // synced MT5 account — 1,500 trades is an ordinary year — that meant scanning
  // the whole list, and lowercasing the query three times per trade, every time
  // any of the state in here changed. Typing one character into the journal
  // search cost ~150ms on a desktop, so "EURUSD" was close to a second of
  // blocked main thread and the text visibly trailed the keyboard.
  //
  // Memoising it is the part that pays: the filter no longer runs when some
  // unrelated piece of state changes, and the query is lowercased once instead
  // of three times per trade.
  //
  // useDeferredValue was tried here as well and measured *worse* — 228-546ms
  // per keystroke against 145-170ms without it. It renders this component twice
  // per key, and because everything lives in one component the second pass
  // repeats the whole body, which costs far more than the filter it skips.
  // It would only pay off once the journal table is its own memoised child.
  const filteredTrades = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return trades.filter(t => {
      const matchesSearch = !q ||
        t.symbol.toLowerCase().includes(q) ||
        t.strategy?.toLowerCase().includes(q) ||
        t.notes?.toLowerCase().includes(q);

      const matchesSymbol = journalFilterSymbol ? t.symbol === journalFilterSymbol : true;
      const matchesStrategy = journalFilterStrategy ? t.strategy === journalFilterStrategy : true;
      const matchesEmotion = journalFilterEmotion ? t.emotion === journalFilterEmotion : true;

      return matchesSearch && matchesSymbol && matchesStrategy && matchesEmotion;
    });
  }, [trades, searchQuery, journalFilterSymbol, journalFilterStrategy, journalFilterEmotion]);

  // Export report to CSV helper
  // Free plan exports the last 30 days only. Clamping here rather than in each
  // export path means the trade count shown in the modal matches the file.
  const FREE_EXPORT_DAYS = 30;
  const clampRangeForPlan = (range: { start?: Date; end?: Date }) => {
    if (isProActive) return range;
    const floor = new Date(Date.now() - FREE_EXPORT_DAYS * 86400000);
    return {
      start: range.start && range.start > floor ? range.start : floor,
      end: range.end,
    };
  };

  const getExportRange = (): { start?: Date; end?: Date } => {
    return clampRangeForPlan(getRequestedExportRange());
  };

  const getRequestedExportRange = (): { start?: Date; end?: Date } => {
    if (exportPreset === 'custom') {
      const start = exportCustomStart ? new Date(exportCustomStart + 'T00:00:00') : undefined;
      const end = exportCustomEnd ? new Date(exportCustomEnd + 'T23:59:59.999') : undefined;
      return { start, end };
    }
    if (exportPreset === 'all') return {};
    const now = new Date();
    switch (exportPreset) {
      case 'this-month': {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        return { start, end };
      }
      case 'last-month': {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        return { start, end };
      }
      case 'last-3-months': {
        const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        return { start, end };
      }
      case 'last-6-months': {
        const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        return { start, end };
      }
      case 'this-year': {
        const start = new Date(now.getFullYear(), 0, 1);
        const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
        return { start, end };
      }
      default:
        return {};
    }
  };

  const filterTradesByRange = (range: { start?: Date; end?: Date }) => {
    return trades.filter(t => {
      const d = new Date(t.date);
      if (isNaN(d.getTime())) return !range.start && !range.end;
      if (range.start && d < range.start) return false;
      if (range.end && d > range.end) return false;
      return true;
    });
  };

  const getPeriodLabel = (range: { start?: Date; end?: Date }): string => {
    if (!range.start && !range.end) return 'All Time';
    const fmt = (d?: Date) => d ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '...';
    return `${fmt(range.start)} - ${fmt(range.end)}`;
  };

  const computeExportStats = (inRange: Trade[]) => {
    const wins = inRange.filter(t => t.profit > 0);
    const losses = inRange.filter(t => t.profit <= 0);
    const totalProfit = inRange.reduce((s, t) => s + Math.max(t.profit, 0), 0);
    const totalLoss = Math.abs(inRange.reduce((s, t) => s + Math.min(t.profit, 0), 0));
    const winRate = inRange.length > 0 ? (wins.length / inRange.length) * 100 : 0;
    const netProfit = totalProfit - totalLoss;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : (totalProfit > 0 ? totalProfit : 0);
    return { wins, losses, totalProfit, totalLoss, winRate, netProfit, profitFactor };
  };

  const getExportFilename = (ext: string): string => {
    const safeName = (activeAccount?.name || 'export').replace(/[^a-zA-Z0-9]+/g, '_');
    const periodPart = exportPreset === 'custom'
      ? `${exportCustomStart || 'from'}_${exportCustomEnd || 'to'}`
      : exportPreset;
    return `fx_journal_pro_${safeName}_${periodPart}.${ext}`;
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', filename);
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const BRAND_WEBSITE = 'https://fxjournalpro.com';
  /**
   * The PDF header mark, as a PNG data URL.
   *
   * It used to read /fxjournalpro-logo.png, an asset that no longer exists.
   * The dev server and the SPA host both answer a missing path with index.html
   * at status 200, so `res.ok` was true and the HTML was handed to jsPDF as a
   * PNG — every exported PDF carried a broken image. It now rasterises
   * Icon.svg, which is the mark the app itself renders, so there is no second
   * binary copy of the logo to keep in step. jsPDF needs raster data, hence the
   * canvas rather than passing the SVG straight through.
   */
  const loadBrandLogoDataUrl = async (): Promise<string | null> => {
    try {
      const res = await fetch('/Icon.svg');
      if (!res.ok) return null;
      const type = res.headers.get('content-type') || '';
      if (!type.includes('svg')) return null;
      const svg = await res.text();
      const source = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
      const img = new Image();
      const loaded = await new Promise<boolean>((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        // An SVG with no width/height attributes rasterises at the browser's
        // 300x150 default, which would letterbox the square mark.
        img.width = 256;
        img.height = 256;
        img.src = source;
      });
      if (!loaded) return null;
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, 256, 256);
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  };

  /**
   * Asks the server for the rows this plan may export.
   *
   * The files are still assembled in the browser, but the data and the format
   * are authorised server-side: a free user who reaches for Excel, or for a
   * range beyond the plan's window, is refused here rather than by the client
   * being polite about it. Returns null when the request was refused, having
   * already raised the upgrade modal.
   */
  const fetchAuthorisedExport = async (
    format: 'csv' | 'xlsx' | 'pdf',
  ): Promise<{ trades: Trade[]; clamped: boolean; windowStart: string | null } | null> => {
    const requested = getRequestedExportRange();
    try {
      const res = await authFetch('/api/reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          start: requested.start ? requested.start.toISOString() : undefined,
          end: requested.end ? requested.end.toISOString() : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 403 && body.proRequired) {
        setShowExportModal(false);
        setShowProModal(true);
        return null;
      }
      if (!res.ok) {
        alert(body.error || 'Could not build the report.');
        return null;
      }
      return { trades: body.trades || [], clamped: !!body.clamped, windowStart: body.windowStart || null };
    } catch (err: any) {
      alert(err?.message || 'Could not reach the server to build the report.');
      return null;
    }
  };

  // Plain CSV, the free plan's report. One row per trade, no styling — the
  // point is that the numbers leave the product, not that they look good.
  const handleExportCsv = async () => {
    const authorised = await fetchAuthorisedExport('csv');
    if (!authorised) return;
    const rows = authorised.trades;
    const cell = (v: any) => {
      const str = v === null || v === undefined ? '' : String(v);
      return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const header = ['Date', 'Symbol', 'Type', 'Lots', 'Entry', 'Exit', 'Profit', 'Strategy', 'Emotion', 'Notes'];
    const lines = [header.join(',')];
    for (const t of rows) {
      lines.push([
        t.date, t.symbol, t.type, t.lotSize, t.entryPrice, t.exitPrice,
        t.profit, (t as any).strategy || '', (t as any).emotion || '', t.notes || '',
      ].map(cell).join(','));
    }
    // BOM so Excel opens UTF-8 symbol names correctly instead of mojibake.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fxjournalpro-trades-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = async () => {
    const authorised = await fetchAuthorisedExport('xlsx');
    if (!authorised) return;
    const mod: any = await import('exceljs');
    const ExcelJS = mod.default || mod;
    const range = getExportRange();
    const inRange = authorised.trades;
    const tradingInRange = inRange.filter(isTradingTrade);
    const stats = computeExportStats(tradingInRange);

    const NAVY = 'FF0F1E36';
    const BLUE = 'FF2F5B8E';
    const NAVY_TEXT = 'FF1E3A5F';
    const WHITE = 'FFFFFFFF';
    const META_FILL = 'FFEEF2F7';
    const SUMMARY_FILL = 'FFF1F5FA';
    const ALT_FILL = 'FFF4F7FB';
    const TOTAL_FILL = 'FFE3EAF3';
    const GREEN = 'FF1E7D32';
    const RED = 'FFC62828';
    const GRAY = 'FF6B7280';
    const TEXT_COLOR = 'FF1F2937';
    const BORDER = 'FFB7C4D6';
    const BRAND = 'FF1F4E79';

    const TABLE_COLS = 10;
    const SPACER_COL = 11;
    const SUMMARY_LABEL_COL = 12;
    const SUMMARY_VALUE_COL = 13;
    const TOTAL_COLS = 13;

    const solid = (rgb: string) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: rgb } });
    const fnt = (size: number, color: string, bold = false) => ({ name: 'Calibri', size, bold, color: { argb: color } });
    const algn = (horizontal: 'left' | 'center' | 'right', vertical = 'middle') => ({ horizontal, vertical });
    const borderAll = (color: string) => ({
      top: { style: 'thin', color: { argb: color } },
      bottom: { style: 'thin', color: { argb: color } },
      left: { style: 'thin', color: { argb: color } },
      right: { style: 'thin', color: { argb: color } },
    });

    const TABLE_HEADER = 7;
    const DATA_START = 8;
    const SUMMARY_START = 8;
    const TOTAL = DATA_START + inRange.length;
    const FOOTER = Math.max(TOTAL + 2, SUMMARY_START + 8);
    const SPACER_AFTER = FOOTER - 1;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Journal');

    ws.getColumn(1).width = 12; // Symbol
    ws.getColumn(2).width = 10; // Type
    ws.getColumn(3).width = 15; // Entry
    ws.getColumn(4).width = 15; // Exit
    ws.getColumn(5).width = 30; // Entry Time
    ws.getColumn(6).width = 30; // Exit Time
    ws.getColumn(7).width = 10; // Volume
    ws.getColumn(8).width = 15; // Net Profit
    ws.getColumn(9).width = 15; // Emotion
    ws.getColumn(10).width = 40; // Notes

    // Summary table columns
    ws.getColumn(12).width = 25; // Summary Label
    ws.getColumn(13).width = 15; // Summary Value

    const outlineMergedRow = (rowNum: number) => {
      for (let c = 1; c <= TOTAL_COLS; c++) {
        const cell = ws.getCell(rowNum, c);
        cell.border = {
          top: { style: 'thin', color: { argb: BORDER } },
          bottom: { style: 'thin', color: { argb: BORDER } },
          left: c === 1 ? { style: 'thin', color: { argb: BORDER } } : undefined,
          right: c === TOTAL_COLS ? { style: 'thin', color: { argb: BORDER } } : undefined,
        };
      }
    };

    const title = ws.getCell('A1');
    title.value = 'FX JOURNAL PRO - TRADING JOURNAL';
    ws.mergeCells(1, 1, 1, TOTAL_COLS);
    title.font = fnt(18, WHITE, true);
    title.fill = solid(BRAND);
    title.alignment = algn('center');
    ws.getRow(1).height = 36;

    const subtitle = ws.getCell('A2');
    subtitle.value = 'Trading Performance Report';
    ws.mergeCells(2, 1, 2, TOTAL_COLS);
    subtitle.font = fnt(10, WHITE, true);
    subtitle.fill = solid(BRAND);
    subtitle.alignment = algn('center');
    ws.getRow(2).height = 18;

    const meta = [
      `Account: ${activeAccount?.name || 'N/A'}`,
      `Period: ${getPeriodLabel(range)}`,
      `Exported: ${new Date().toLocaleString()}`,
    ];
    meta.forEach((text, i) => {
      const r = 3 + i;
      const cell = ws.getCell(r, 1);
      cell.value = text;
      ws.mergeCells(r, 1, r, TOTAL_COLS);
      cell.font = fnt(10, NAVY_TEXT);
      cell.fill = solid(META_FILL);
      cell.alignment = algn('left');
      ws.getRow(r).height = 16;
      for (let c = 1; c <= TOTAL_COLS; c++) {
        const cc = ws.getCell(r, c);
        cc.border = {
          top: { style: 'thin', color: { argb: BORDER } },
          bottom: { style: 'thin', color: { argb: BORDER } },
          left: c === 1 ? { style: 'thin', color: { argb: BORDER } } : undefined,
          right: c === TOTAL_COLS ? { style: 'thin', color: { argb: BORDER } } : undefined,
        };
      }
    });
    ws.getRow(6).height = 6;

    const sTitle = ws.getCell(TABLE_HEADER, SUMMARY_LABEL_COL);
    sTitle.value = 'PERFORMANCE SUMMARY';
    ws.mergeCells(TABLE_HEADER, SUMMARY_LABEL_COL, TABLE_HEADER, SUMMARY_VALUE_COL);
    sTitle.font = fnt(10, WHITE, true);
    sTitle.fill = solid(NAVY);
    sTitle.alignment = algn('center');
    sTitle.border = borderAll(BORDER);
    ws.getRow(TABLE_HEADER).height = 22;

    const net = stats.netProfit;
    const summaryRows: { label: string; value: number; numFmt: string; color?: string; bold?: boolean }[] = [
      { label: 'Total Trades', value: tradingInRange.length, numFmt: '0' },
      { label: 'No. of Winning Trades', value: stats.wins.length, numFmt: '0' },
      { label: 'No. of Losing Trades', value: stats.losses.length, numFmt: '0' },
      { label: 'Win Rate (%)', value: stats.winRate, numFmt: '0.0' },
      { label: 'Total Profit', value: stats.totalProfit, numFmt: '#,##0.00', color: GREEN, bold: true },
      { label: 'Total Loss', value: stats.totalLoss, numFmt: '#,##0.00', color: RED, bold: true },
      { label: 'Net Profit/Loss', value: stats.netProfit, numFmt: '#,##0.00', color: net > 0 ? GREEN : net < 0 ? RED : undefined, bold: true },
    ];
    summaryRows.forEach((s, i) => {
      const r = SUMMARY_START + i;
      const lc = ws.getCell(r, SUMMARY_LABEL_COL);
      const vc = ws.getCell(r, SUMMARY_VALUE_COL);
      lc.value = s.label;
      vc.value = s.value;
      lc.font = fnt(10, NAVY_TEXT, true);
      lc.fill = solid(SUMMARY_FILL);
      lc.alignment = algn('left');
      lc.border = borderAll(BORDER);
      vc.font = fnt(10, s.color || TEXT_COLOR, !!s.bold);
      vc.fill = solid('FFFFFFFF');
      vc.alignment = algn('center');
      vc.border = borderAll(BORDER);
      vc.numFmt = s.numFmt;
      ws.getRow(r).height = 20;
    });

    const lastSum = SUMMARY_START + summaryRows.length - 1;
    const tL = ws.getCell(TABLE_HEADER, SUMMARY_LABEL_COL);
    const tV = ws.getCell(TABLE_HEADER, SUMMARY_VALUE_COL);
    tL.border = { ...tL.border, top: { style: 'medium', color: { argb: BLUE } }, left: { style: 'medium', color: { argb: BLUE } } };
    tV.border = { ...tV.border, top: { style: 'medium', color: { argb: BLUE } }, right: { style: 'medium', color: { argb: BLUE } } };
    const bL = ws.getCell(lastSum, SUMMARY_LABEL_COL);
    const bV = ws.getCell(lastSum, SUMMARY_VALUE_COL);
    bL.border = { ...bL.border, left: { style: 'medium', color: { argb: BLUE } }, bottom: { style: 'medium', color: { argb: BLUE } } };
    bV.border = { ...bV.border, right: { style: 'medium', color: { argb: BLUE } }, bottom: { style: 'medium', color: { argb: BLUE } } };

    const headers = ['Symbol', 'Type', 'Entry', 'Exit', 'Entry Time', 'Exit Time', 'Volume', 'Net Profit', 'Emotion', 'Notes'];
    const hr = ws.getRow(TABLE_HEADER);
    headers.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h;
      c.font = fnt(10, WHITE, true);
      c.fill = solid(BLUE);
      c.alignment = algn('center');
      c.border = borderAll(BORDER);
    });
    hr.height = 22;

    const fmtDateTime = (iso: string): string => {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };

    inRange.forEach((t, idx) => {
      const row = ws.getRow(DATA_START + idx);
      const exitDate = t.exitTime ? new Date(t.exitTime) : null;
      const vals: (string | number)[] = [
        t.symbol, t.type, t.entryPrice, t.exitPrice,
        fmtDateTime(t.date), exitDate ? fmtDateTime(t.exitTime!) : '-',
        t.lotSize, t.profit,
        t.emotion || '-', t.notes || '-'
      ];
      vals.forEach((v, i) => {
        const c = row.getCell(i + 1);
        c.value = v;
        c.border = borderAll(BORDER);
        c.alignment = i === 4 || i === 5 ? algn('left') : i === 9 ? { ...algn('left'), wrapText: true } : algn('center');
        if (i === 6) c.numFmt = '0.00';
        // Note: Entry/Exit prices (i=2, i=3) are left with General formatting to avoid trailing zeros
        if (i === 7) {
          c.numFmt = '#,##0.00';
          const num = Number(v);
          c.font = fnt(10, num > 0 ? GREEN : num < 0 ? RED : GRAY, num !== 0);
        }
        if (idx % 2 === 1) c.fill = solid(ALT_FILL);
      });
      row.height = 20;
    });

    const netProfit = stats.netProfit;
    const totLots = inRange.reduce((s, t) => s + (Number(t.lotSize) || 0), 0);
    const tr = ws.getRow(TOTAL);
    tr.getCell(1).value = 'TOTALS';
    tr.getCell(7).value = totLots;
    tr.getCell(8).value = netProfit;

    // Format all cells in the TOTALS row up to column 10
    for (let col = 1; col <= 10; col++) {
      const c = tr.getCell(col);
      c.fill = solid(TOTAL_FILL);
      c.alignment = col === 1 ? algn('left') : algn('center');
      c.border = { ...borderAll(BORDER), top: { style: 'medium', color: { argb: BLUE } } };

      if (col === 7 || col === 8) {
        c.numFmt = col === 7 ? '0.00' : '#,##0.00';
        const num = Number(c.value);
        c.font = fnt(10, num > 0 ? GREEN : num < 0 ? RED : NAVY_TEXT, true);
      } else {
        c.font = fnt(10, NAVY_TEXT, true);
      }
    }
    tr.height = 22;

    ws.getRow(SPACER_AFTER).height = 6;

    const foot = ws.getCell(FOOTER, 1);
    foot.value = BRAND_WEBSITE;
    ws.mergeCells(FOOTER, 1, FOOTER, TOTAL_COLS);
    foot.font = fnt(10, WHITE, true);
    foot.fill = solid(BRAND);
    foot.alignment = algn('center');
    ws.getRow(FOOTER).height = 22;

    outlineMergedRow(FOOTER);

    const fmtMoneyLen = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).length;
    const displayLen = (v: unknown, col: number): number => {
      if (v === null || v === undefined) return 0;
      if (typeof v === 'number') {
        if (col === 4) return fmtMoneyLen(v);
        if (col === 5 || col === 6) return v.toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 5 }).length;
        if (col >= 7 && col <= 9) return fmtMoneyLen(v);
        return String(v).length;
      }
      return String(v).length;
    };
    const colMax: number[] = Array(TABLE_COLS).fill(0);
    for (let r = TABLE_HEADER; r <= TOTAL; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= TABLE_COLS; c++) {
        const cell = row.getCell(c);
        if (cell.value === null || cell.value === undefined) continue;
        colMax[c - 1] = Math.max(colMax[c - 1], displayLen(cell.value, c));
      }
    }
    const minW = [11, 10, 8, 8, 10, 10, 10, 13, 10, 12, 12, 8];
    const maxW = [14, 16, 12, 12, 14, 14, 14, 16, 12, 24, 18, 45];
    const widths = colMax.map((len, i) => Math.max(minW[i], Math.min(maxW[i], Math.ceil(len * 1.15) + 2)));
    widths.push(3, 23, 13);
    ws.columns = widths.map(width => ({ width }));

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, getExportFilename('xlsx'));
  };

  const handleExportPdf = async () => {
    const authorised = await fetchAuthorisedExport('pdf');
    if (!authorised) return;
    const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const logoDataUrl = await loadBrandLogoDataUrl();
    const range = getExportRange();
    const inRange = authorised.trades;
    const tradingInRange = inRange.filter(isTradingTrade);
    const stats = computeExportStats(tradingInRange);

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    // Brand header band
    doc.setFillColor(15, 30, 54);
    doc.rect(0, 0, pageW, 28, 'F');
    doc.setFillColor(16, 185, 129);
    doc.rect(0, 28, pageW, 1.6, 'F');

    if (logoDataUrl) {
      doc.addImage(logoDataUrl, 'PNG', 12, 5, 18, 18);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(255, 255, 255);
      doc.text('FXJournalPro', 34, 16);
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      doc.setTextColor(255, 255, 255);
      doc.text('FXJournalPro', 12, 17);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(255, 255, 255);
    doc.textWithLink(BRAND_WEBSITE, pageW - 12, 12, { url: BRAND_WEBSITE });

    // Report title block
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(15, 30, 54);
    doc.text('Trading Journal Export', 12, 44);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(100, 110, 125);
    doc.text(`Account: ${activeAccount?.name || 'N/A'}   |   Period: ${getPeriodLabel(range)}   |   Exported: ${new Date().toLocaleDateString()}`, 12, 50.5);

    autoTable(doc, {
      head: [['Performance Summary', '']],
      body: [
        ['Total Number of Trades', String(tradingInRange.length)],
        ['Number of Winning Trades', String(stats.wins.length)],
        ['Number of Losing Trades', String(stats.losses.length)],
        ['Win Rate (%)', `${stats.winRate.toFixed(2)}%`],
        ['Total Profit', `${stats.totalProfit >= 0 ? '+' : ''}$${stats.totalProfit.toFixed(2)}`],
        ['Total Loss', `-$${stats.totalLoss.toFixed(2)}`],
        ['Net Profit', `${stats.netProfit >= 0 ? '+' : ''}$${stats.netProfit.toFixed(2)}`],
        ['Profit Factor', stats.profitFactor.toFixed(2)],
      ],
      startY: 56,
      theme: 'grid',
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 10, fontStyle: 'bold', halign: 'center' },
      bodyStyles: { fontSize: 8.5, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 70 }, 1: { halign: 'right' } },
      styles: { cellPadding: 2, valign: 'middle' },
      margin: { left: 12, right: 12 },
    });

    const lastY = (doc as any).lastAutoTable?.finalY || 45;
    autoTable(doc, {
      head: [['Symbol', 'Type', 'Entry', 'Exit', 'Entry Time', 'Exit Time', 'Volume', 'Net Profit', 'Emotion', 'Notes']],
      body: inRange.map(t => {
        const entryDate = new Date(t.date);
        const exitDate = t.exitTime ? new Date(t.exitTime) : null;

        const fmtDateTime = (d: Date) => {
          if (isNaN(d.getTime())) return '-';
          return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        };

        return [
          t.symbol,
          t.type,
          String(t.entryPrice),
          String(t.exitPrice),
          fmtDateTime(entryDate),
          exitDate ? fmtDateTime(exitDate) : '-',
          String(t.lotSize),
          `${t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}`,
          t.emotion || '-',
          t.notes || '-'
        ];
      }),
      startY: lastY + 8,
      theme: 'striped',
      headStyles: { fillColor: [47, 91, 142], textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [242, 245, 249] },
      styles: { cellPadding: 1.8, valign: 'middle', overflow: 'linebreak' },
      columnStyles: { 6: { halign: 'center' }, 7: { halign: 'right' } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 7) {
          const val = parseFloat(String(data.cell.raw));
          if (val > 0) data.cell.styles.textColor = [16, 122, 87];
          else if (val < 0) data.cell.styles.textColor = [180, 35, 50];
        }
      },
      margin: { left: 12, right: 12 },
    });

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(120, 130, 145);
      doc.setFont('helvetica', 'normal');
      doc.text(`FXJournalPro | ${BRAND_WEBSITE}`, 12, pageH - 7);
      doc.text(`Page ${i} of ${pageCount}`, pageW - 12, pageH - 7, { align: 'right' });
    }

    const blob = doc.output('blob');
    downloadBlob(blob, getExportFilename('pdf'));
  };

  // A plan can change under a session (an admin grant, a lapsed subscription),
  // so the selected format is corrected when the modal opens rather than once
  // at mount.
  useEffect(() => {
    if (showExportModal && !isProActive && exportFormat !== 'csv') setExportFormat('csv');
  }, [showExportModal, isProActive]);

  const handleExportJournal = async () => {
    if (exportFormat === 'csv') await handleExportCsv();
    else if (exportFormat === 'xlsx') await handleExportExcel();
    else await handleExportPdf();
    setShowExportModal(false);
  };

  // ── MT5 paste parser ──
  const parseMt5PastedText = (text: string): any[] => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) return [];

    // Detect delimiter (tab vs comma)
    const tabCount = (lines[0].match(/\t/g) || []).length;
    const commaCount = (lines[0].match(/,/g) || []).length;
    const delim = tabCount >= commaCount ? '\t' : ',';

    const rows = lines.map(l => l.split(delim).map(c => c.trim()));
    const rawHeaders = rows[0];
    const headerRow = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

    // Find column indices by matching header aliases
    const findIdx = (aliases: string[]): number => {
      for (const alias of aliases) {
        const idx = headerRow.indexOf(alias);
        if (idx !== -1) return idx;
      }
      // Try partial matches (e.g. "price" in "closeprice")
      for (const alias of aliases) {
        const idx = headerRow.findIndex(h => h.includes(alias));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    // For columns that may appear twice (Price), get all matching indices
    const findAllIdx = (aliases: string[]): number[] => {
      const indices: number[] = [];
      for (const alias of aliases) {
        headerRow.forEach((h, i) => {
          if (h === alias && !indices.includes(i)) indices.push(i);
        });
      }
      // fallback: partial match for any not yet found
      for (const alias of aliases) {
        headerRow.forEach((h, i) => {
          if (h.includes(alias) && !indices.includes(i)) indices.push(i);
        });
      }
      return indices;
    };

    const timeIdx = findIdx(['time', 'opentime', 'open_time', 'openingtime', 'date']);
    const typeIdx = findIdx(['type', 'direction', 'kind']);
    const lotsIdx = findIdx(['lots', 'size', 'volume', 'lotes']);
    const symbolIdx = findIdx(['symbol', 'item', 'instrument', 'pair', 'symbols']);
    const slIdx = findIdx(['stoploss', 'stop_loss', 'sl']);
    const tpIdx = findIdx(['takeprofit', 'take_profit', 'tp']);
    const closeTimeIdx = findIdx(['closetime', 'close_time', 'closingtime']);
    const commissionIdx = findIdx(['commission', 'comm']);
    const swapIdx = findIdx(['swap', 'taxes', 'tax', 'swaps']);
    const profitIdx = findIdx(['profit', 'pnl', 'grosspnl', 'netpnl']);

    // Price columns: first match is entry, last match is exit
    const priceIndices = findAllIdx(['price', 'rate', 'openprice', 'open_price', 'closeprice', 'close_price', 'exitprice', 'exit_price']);
    const entryIdx = priceIndices.length > 0 ? priceIndices[0] : -1;
    const exitIdx = priceIndices.length > 1 ? priceIndices[priceIndices.length - 1] : (priceIndices.length === 1 ? priceIndices[0] : -1);

    const getVal = (idx: number, row: string[]): string => idx !== -1 && idx < row.length ? row[idx] : '';

    const results: any[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 3) continue;

      const rawType = getVal(typeIdx, row).toLowerCase();
      const tradeType = rawType === 'buy' ? 'Buy' as const : rawType === 'sell' ? 'Sell' as const : null;
      if (!tradeType) continue;

      const symbol = getVal(symbolIdx, row).toUpperCase();
      if (!symbol) continue;

      const parseNum = (s: string): number => {
        const cleaned = s.replace(/[^0-9.\-]/g, '');
        return cleaned ? parseFloat(cleaned) : 0;
      };

      const rawDate = getVal(timeIdx, row) || getVal(closeTimeIdx, row);
      let parsedDate: string;
      if (rawDate) {
        const d = new Date(rawDate.replace(/\./g, '-').replace(/\s+/g, 'T'));
        parsedDate = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
      } else {
        parsedDate = new Date().toISOString();
      }

      const lotSize = parseNum(getVal(lotsIdx, row));
      const entryPrice = parseNum(getVal(entryIdx, row));
      const exitPrice = parseNum(getVal(exitIdx, row));
      const profit = parseNum(getVal(profitIdx, row));
      const commission = parseNum(getVal(commissionIdx, row));
      const swap = parseNum(getVal(swapIdx, row));
      const sl = getVal(slIdx, row) ? parseNum(getVal(slIdx, row)) : undefined;
      const tp = getVal(tpIdx, row) ? parseNum(getVal(tpIdx, row)) : undefined;

      results.push({
        date: parsedDate,
        symbol: symbol || 'UNKNOWN',
        type: tradeType,
        lotSize: lotSize || 0.01,
        entryPrice: entryPrice || 0,
        exitPrice: exitPrice || 0,
        stopLoss: sl && sl !== 0 ? sl : undefined,
        takeProfit: tp && tp !== 0 ? tp : undefined,
        profit: profit || 0,
        commission: commission || 0,
        swap: swap || 0,
        strategy: 'Pasted from MT5',
        emotion: 'Calm',
        tags: ['MT5 Paste'],
        isMt5Sync: true
      });
    }

    return results;
  };

  // UI Currency formatting
  const formatValue = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: activeAccount?.currency || 'USD'
    }).format(val);
  };

  // Rendering check
  if (loading && !user) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#07080c] flex flex-col items-center justify-center font-sans">
        <div className="text-center space-y-6">
          <div className="relative h-16 w-16 mx-auto flex items-center justify-center">
            <Logo size={44} iconOnly={true} className="animate-pulse" />
            <div className="absolute inset-0 rounded-full border-2 border-slate-200 dark:border-white/10 border-t-violet-500 dark:border-t-violet-400 animate-spin"></div>
          </div>
          <div>
            <Logo size={28} className="justify-center" />
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">Loading your personalized trading workspace...</p>
          </div>
        </div>
      </div>
    );
  }

  // No user - show login page
  if (!user) {
    return (
      <LoginPage
        isSupabaseConfigured={isSupabaseConfigured}
        onLoginSuccess={async () => {
          // Re-trigger bootstrapSession to fetch user details and accounts dynamically
          const storedUserId = sessionStorage.getItem('auth_user_id') || localStorage.getItem('auth_user_id');
          const storedEmail = sessionStorage.getItem('auth_email') || localStorage.getItem('auth_email');
          if (storedUserId || storedEmail) {
            try {
              const headers: Record<string, string> = {};
              if (storedUserId) headers['x-auth-user-id'] = storedUserId;
              if (storedEmail) headers['x-auth-email'] = storedEmail;
              const res = await fetch('/api/auth/me', { headers });
              if (res.ok) {
                const data = await res.json();
                if (data.user) {
                  setUser(data.user);
                  await fetchAccountData();
                }
              }
            } catch (e) {
              console.error('Error fetching user post-login:', e);
            }
          }
          navigate('/dashboard', { replace: true });
        }}
        authFetch={authFetch}
      />
    );
  }

  // Onboarding Wizard (if registration completes but not onboarding completed)
  if (showOnboardingWizard && !user.onboardingCompleted) {
    return (
      <div className="lp min-h-screen flex items-center justify-center p-4 font-sans antialiased text-slate-200 relative overflow-hidden">
        <div className="lp-aura" />
        <div className="lp-card w-full max-w-lg p-8 space-y-6 relative overflow-hidden z-10">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-500 to-indigo-400"></div>
          <div className="flex items-center justify-between">
            <span className="lp-eyebrow">Onboarding Wizard</span>
            <span className="lp-eyebrow lp-num">Step {onboardingStep} of 2</span>
          </div>
          {onboardingStep === 1 ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white font-display">Personalize your trading dashboard</h2>
                <p className="text-xs text-slate-400">Configure your parameters to unlock a custom experience matching your style.</p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">What is your Trading Experience?</label>
                  <div className="grid grid-cols-3 gap-3">
                    {['Beginner', 'Intermediate', 'Professional'].map((exp) => (
                      <button key={exp} type="button" onClick={() => setObExperience(exp as any)}
                        className={`p-3 border rounded-lg text-xs font-semibold text-center transition ${obExperience === exp ? 'border-violet-500/50 bg-violet-500/15 text-violet-200' : 'border-white/[0.08] bg-white/[0.03] hover:border-white/20 text-slate-400'}`}>
                        {exp}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">Primary Trading Style</label>
                  <div className="grid grid-cols-3 gap-3">
                    {['Scalping', 'Day Trading', 'Swing Trading'].map((style) => (
                      <button key={style} type="button" onClick={() => setObStyle(style as any)}
                        className={`p-3 border rounded-lg text-xs font-semibold text-center transition ${obStyle === style ? 'border-violet-500/50 bg-violet-500/15 text-violet-200' : 'border-white/[0.08] bg-white/[0.03] hover:border-white/20 text-slate-400'}`}>
                        {style}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setOnboardingStep(2)}
                className="lp-btn-primary w-full font-semibold text-xs rounded-lg p-3 flex items-center justify-center gap-1.5">
                Continue Setup <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white font-display">Select Target Markets</h2>
                <p className="text-xs text-slate-400">Pick instruments you analyze daily to configure trackers.</p>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {['Forex', 'Gold', 'Crypto', 'Indices'].map((market) => {
                    const active = obMarkets.includes(market);
                    return (
                      <button key={market} type="button"
                        onClick={() => { if (active) setObMarkets(obMarkets.filter(m => m !== market)); else setObMarkets([...obMarkets, market]); }}
                        className={`p-4 border rounded-lg text-xs font-semibold text-left transition flex items-center justify-between ${active ? 'border-violet-500/50 bg-violet-500/15 text-violet-200' : 'border-white/[0.08] bg-white/[0.03] hover:border-white/20 text-slate-400'}`}>
                        {market}
                        <CheckCircle2 className={`h-4 w-4 ${active ? 'text-violet-600' : 'text-slate-300'}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setOnboardingStep(1)}
                  className="lp-btn-ghost w-1/3 font-semibold text-xs rounded-lg p-3">Back</button>
                <button type="button" disabled={actionLoading} onClick={submitOnboarding}
                  className="lp-btn-primary w-2/3 font-semibold text-xs rounded-lg p-3 flex items-center justify-center gap-1.5 disabled:opacity-50">
                  {actionLoading ? 'Initializing Platform...' : 'Complete & Launch'} <Check className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  interface NavItem {
    id: string;
    label: string;
    icon: any;
    onSelect?: () => void;
    /** Server refuses this tab's data on the free plan. */
    pro?: boolean;
  }
  interface NavGroup {
    label?: string;
    items: NavItem[];
  }

  const NAV_GROUPS: NavGroup[] = [
    {
      label: 'Core',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
        { id: 'journal', label: 'Journal', icon: BookOpen },
        { id: 'notebook', label: 'Notebook', icon: Edit3 },
        { id: 'accounts', label: 'Accounts', icon: Layers },
        { id: 'calendar', label: 'Calendar', icon: Calendar },
      ]
    },
    {
      label: 'Market & Charts',
      items: [
        { id: 'analytics', label: 'Analytics', icon: LineChart },
        { id: 'chart', label: 'Live Chart', icon: Activity, pro: true },
        // Reset to the news sub-tab: the economic-calendar shortcut leaves it
        // on 'calendar', and the sidebar entry says "FX News".
        { id: 'fxnews', label: 'FX News', icon: Newspaper, onSelect: () => setFxNewsInitialTab('news') },
      ]
    },
    {
      label: 'Tools & AI',
      items: [
        { id: 'insights', label: 'Heyza', icon: Brain, pro: true },
        { id: 'tools', label: 'Tools', icon: Wrench },
        { id: 'settings', label: 'Settings', icon: Settings },
      ]
    }
  ];

  // Primary Platform Shell Layout
  return (
    <div className="min-h-screen md:h-screen md:overflow-hidden bg-[#FBFBFA]/40 font-sans antialiased text-slate-800 flex flex-col">
      {/* Unified Top Header */}
      <header className="fixed top-0 left-0 right-0 h-[60px] z-[50] bg-[#FBFBFA]/90 dark:bg-slate-950/90 backdrop-blur-xl border-b border-slate-200/50 dark:border-white/[0.06] px-4 flex items-center justify-between">
        {/* Mobile Left: Greeting + Name | Desktop: Logo & Brand */}
        <div className="flex items-center gap-2.5">
          {/* One brand mark on every width. The phone header used to carry a
              greeting and the user's first name instead, so the product's own
              logo appeared nowhere on mobile — and the greeting repeated
              information the account already shows. It now opens the hero
              card below, where there is room for it. */}
          {/*
            24, not 28, on the app chrome.
            The bar is 60px tall and the page around it is quiet: body text
            12px, sidebar rail icons 22px, the avatar 36px. A 28px mark put a
            177px lockup at the head of a bar with 625px of empty space after
            it, and its 17px wordmark read louder than anything on the page bar
            the 30px heading. At 24 the mark sits with the rail icons it shares
            an edge with, and the lockup comes down to 152px.

            The landing navbar keeps 28: there the logo IS the statement, and
            there is no sidebar for it to harmonise with.
          */}
          <div className="flex items-center gap-2.5">
            <Logo size={24} />
          </div>
        </div>

        {/* Top Right: Actions */}
        <div className="flex items-center gap-2">

          {/* Notification Bell */}
          <div className="relative">
            <button
              onClick={() => { setShowMobileNavNotifications(!showMobileNavNotifications); setShowMobileNavProfile(false); }}
              aria-label="Notifications"
              aria-expanded={showMobileNavNotifications}
              title="Notifications"
              className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors relative rounded-xl hover:bg-slate-100 dark:hover:bg-white/5"
            >
              <Bell className="h-[18px] w-[18px]" />
              {false && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-[#FBFBFA] dark:border-slate-900"></span>
              )}
            </button>

            {/* Notification Dropdown */}
            {showMobileNavNotifications && (
              <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                  <h3 className="font-bold text-sm">Notifications</h3>
                  <button
                    onClick={() => setShowMobileNavNotifications(false)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
                  <Bell className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p>No new notifications</p>
                </div>
              </div>
            )}
          </div>

          {/* Pro badge only. The upgrade CTA that used to sit here was the
              third on the same screen — the sidebar carries the full card with
              "Get Pro — ₹399" and the profile menu has its own row. Asking
              three times in one viewport reads as pressure, not an offer. */}
          {user?.isPro && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-700 dark:text-violet-300 text-[11px] font-extrabold tracking-wide">
              <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
              <span>PRO</span>
            </div>
          )}

          {/* User Profile Avatar */}
          <div className="relative" ref={profileMenuRef}>
            <button
              onClick={() => { setShowMobileNavProfile(!showMobileNavProfile); setShowMobileNavNotifications(false); }}
              aria-haspopup="menu"
              aria-expanded={showMobileNavProfile}
              aria-label="Account menu"
              className="avatar-ring group relative h-9 w-9 rounded-full p-[1.5px] transition-transform duration-200 hover:scale-105 active:scale-95"
            >
              <span className="flex h-full w-full items-center justify-center rounded-full bg-violet-50 text-violet-700 dark:bg-[#0c0e15] dark:text-violet-100 text-[11px] font-bold tracking-wide">
                {userInitials}
              </span>
              {/* Pro indicator dot on avatar */}
              {user?.isPro && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-amber-400 rounded-full border-2 border-[#FBFBFA] dark:border-slate-950" />
              )}
            </button>

            {/* Profile Dropdown */}
            {showMobileNavProfile && (
              <div
                role="menu"
                aria-label="Account"
                className="profile-menu absolute right-0 mt-3 w-[278px] rounded-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2"
              >
                <div className="flex items-center gap-3 p-4 border-b border-slate-100 dark:border-white/[0.07]">
                  <span className="avatar-ring h-10 w-10 shrink-0 rounded-full p-[1.5px] relative">
                    <span className="flex h-full w-full items-center justify-center rounded-full bg-violet-50 text-violet-700 dark:bg-[#0c0e15] dark:text-violet-100 text-xs font-bold">
                      {userInitials}
                    </span>
                    {user?.isPro && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-amber-400 rounded-full border-2 border-white dark:border-slate-900" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">{user?.name || 'Trader'}</p>
                      {/* The role is part of who you are signed in as. It was
                          only visible in the sidebar, which is hidden on a
                          phone, so a partner had no way to tell. */}
                      {isPartner && (
                        <span className="shrink-0 rounded-md bg-violet-500/15 border border-violet-500/25 px-1.5 py-px text-[8px] font-extrabold uppercase tracking-wider text-violet-600 dark:text-violet-300">
                          Partner
                        </span>
                      )}
                      {isAdmin && !isPartner && (
                        <span className="shrink-0 rounded-md bg-rose-500/12 border border-rose-500/25 px-1.5 py-px text-[8px] font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-300">
                          Admin
                        </span>
                      )}
                    </div>
                    {/* title carries the whole address: the visible line is
                        truncated, and a support conversation that starts with
                        "freeui_178973...@examp…" helps nobody. */}
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={user?.email}>
                      {user?.email}
                    </p>
                  </div>
                </div>

                {/* Plan row.
                    A bare "FREE" badge states the plan and nothing about what
                    it means. What a trader wants to know here is what they are
                    up against: how many days of Pro are left, or which limit
                    they are already sitting on. */}
                <div className="px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.07] flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="block text-[10px] font-mono uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Plan</span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {isProActive
                        ? (proDaysLeft !== null
                          ? `${proDaysLeft} day${proDaysLeft === 1 ? '' : 's'} left${subscription?.cancelAtPeriodEnd ? ' · ends then' : ''}`
                          : 'All features unlocked')
                        : `${accounts.length} of 1 portfolio · 30-day reports`}
                    </span>
                  </div>
                  {isProActive ? (
                    <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-400/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-300">
                      <Star className="h-3 w-3" /> Pro
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/[0.06] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Free
                    </span>
                  )}
                </div>

                {/* Theme toggle inside profile */}
                <div className="px-4 py-3 border-b border-slate-100 dark:border-white/[0.07] flex items-center justify-between">
                  <span className="text-sm text-slate-700 dark:text-slate-300 flex items-center gap-2">
                    {theme === 'dark' ? <Moon className="h-4 w-4 text-slate-400" /> : <Sun className="h-4 w-4 text-slate-400" />}
                    {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                  </span>
                  <button
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    role="switch"
                    aria-checked={theme === 'dark'}
                    aria-label="Dark mode"
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${theme === 'dark' ? 'bg-violet-600' : 'bg-slate-300'
                      }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${theme === 'dark' ? 'translate-x-4' : 'translate-x-1'
                      }`} />
                  </button>
                </div>

                <div className="p-2 space-y-0.5">
                  {!user?.isPro ? (
                    <button
                      role="menuitem"
                      onClick={() => { setShowProModal(true); setShowMobileNavProfile(false); }}
                      className="dx-upgrade w-full text-left px-3 py-2 text-xs font-bold rounded-xl flex items-center gap-2 mb-1"
                    >
                      <Sparkles className="h-4 w-4 text-amber-300 fill-amber-300" /> Upgrade to Pro — ₹499
                    </button>
                  ) : null}
                  <button
                    role="menuitem"
                    onClick={() => { setActiveTab('settings'); setShowMobileNavProfile(false); }}
                    className="profile-menu-item w-full text-left px-3 py-2.5 text-sm text-slate-700 dark:text-slate-300 rounded-xl flex items-center gap-2.5"
                  >
                    <Settings className="h-4 w-4 text-slate-400 dark:text-slate-500" /> Account Settings
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => { setActiveTab('insights'); setShowMobileNavProfile(false); }}
                    className="profile-menu-item w-full text-left px-3 py-2.5 text-sm text-slate-700 dark:text-slate-300 rounded-xl flex items-center gap-2.5"
                  >
                    <Brain className="h-4 w-4 text-slate-400 dark:text-slate-500" /> Heyza AI
                    {!isProActive && (
                      <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-violet-500/12 border border-violet-500/25 px-1.5 py-px text-[8px] font-extrabold uppercase tracking-wider text-violet-600 dark:text-violet-300">
                        <Lock className="h-2 w-2" /> Pro
                      </span>
                    )}
                  </button>

                  <button
                    role="menuitem"
                    onClick={() => { setSettingsTab('help'); setActiveTab('settings'); setShowMobileNavProfile(false); }}
                    className="profile-menu-item w-full text-left px-3 py-2.5 text-sm text-slate-700 dark:text-slate-300 rounded-xl flex items-center gap-2.5"
                  >
                    <HelpCircle className="h-4 w-4 text-slate-400 dark:text-slate-500" /> Help &amp; support
                  </button>

                  {/* The Partner Portal and the Admin panel live in the desktop
                      sidebar, which is `hidden md:flex`. On a phone that left a
                      partner or an admin with no route to their own console at
                      all — the menu they can reach is this one. */}
                  {(isPartner || isAdmin) && (
                    <>
                      <div className="border-t border-slate-100 dark:border-white/[0.07] my-1.5" />
                      {isPartner && (
                        <button
                          role="menuitem"
                          onClick={() => { setActiveTab('partner'); setShowMobileNavProfile(false); }}
                          className="profile-menu-item w-full text-left px-3 py-2.5 text-sm text-violet-600 dark:text-violet-300 font-semibold rounded-xl flex items-center gap-2.5"
                        >
                          <Users className="h-4 w-4" /> Partner Portal
                        </button>
                      )}
                      {isAdmin && !isPartner && (
                        <button
                          role="menuitem"
                          onClick={() => { setActiveTab('admin'); setShowMobileNavProfile(false); }}
                          className="profile-menu-item w-full text-left px-3 py-2.5 text-sm text-rose-600 dark:text-rose-300 font-semibold rounded-xl flex items-center gap-2.5"
                        >
                          <Shield className="h-4 w-4" /> {adminRole === 'SUB_ADMIN' ? 'Partner Portal' : 'Admin Panel'}
                        </button>
                      )}
                    </>
                  )}

                  <div className="border-t border-slate-100 dark:border-white/[0.07] my-1.5" />

                  <button
                    role="menuitem"
                    onClick={() => { handleLogout(); setShowMobileNavProfile(false); }}
                    className="profile-menu-item profile-menu-item-danger w-full text-left px-3 py-2.5 text-sm text-rose-600 dark:text-rose-400 rounded-xl flex items-center gap-2.5"
                  >
                    <LogOut className="h-4 w-4" /> Log out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 md:overflow-hidden relative pt-[60px]">
        {/* Sidebar Navigation */}
        {/* Three regions, not one scrolling column.
            Everything used to live in a single wrapper inside an aside that
            scrolled as a whole, which caused all three complaints at once: the
            upgrade card scrolled out of reach, its `mt-auto` never worked
            because the wrapper was not a flex parent with height to give, and
            opening or closing the rail reflowed the labels and made the
            scrollbar appear and vanish mid-animation.

            Now the toggle and the upgrade card are fixed ends that cannot
            move, and only the nav list between them scrolls — and only when
            the items genuinely do not fit. */}
        <aside className={`hidden md:flex bg-white dark:bg-slate-950 border-r border-slate-200/80 dark:border-slate-800/80 flex-shrink-0 flex-col z-20 md:h-full overflow-hidden transition-[width] duration-300 ease-in-out motion-reduce:transition-none ${desktopSidebarOpen ? 'w-64' : 'w-20'} py-2`}>
          {/* Region 1 — pinned */}
          <div className={`shrink-0 w-full flex flex-col ${desktopSidebarOpen ? 'items-start px-3' : 'items-center'}`}>
            <div className={`flex w-full ${desktopSidebarOpen ? 'justify-end' : 'justify-center'} mb-1`}>
              <button
                onClick={() => setDesktopSidebarOpen(!desktopSidebarOpen)}
                aria-label={desktopSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                aria-expanded={desktopSidebarOpen}
                title={desktopSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                className="group flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:border-slate-300 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/[0.09] dark:hover:border-violet-500/40 transition-colors"
              >
                {desktopSidebarOpen
                  ? <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
                  : <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
              </button>
            </div>
          </div>

          {/* Region 2 — the only thing that scrolls */}
          <nav
            className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden dx-sidebar-scroll flex flex-col gap-0.5 w-full ${desktopSidebarOpen ? 'items-start px-3' : 'items-center'} pb-2`}
            aria-label="Main"
          >
            {isPartner && (
              <button
                onClick={() => { setActiveTab('partner'); setMobileMenuOpen(false); }}
                aria-current={activeTab === 'partner' ? 'page' : undefined}
                title={!desktopSidebarOpen ? 'Partner Portal' : undefined}
                className={`relative flex items-center transition-colors mb-0.5 ${desktopSidebarOpen
                    ? `flex-row justify-start gap-3 px-3 h-9 rounded-xl w-full ${activeTab === 'partner' ? 'dx-nav-active' : 'dx-nav-idle text-violet-400'}`
                    : `justify-center h-9 w-9 mx-auto rounded-xl ${activeTab === 'partner' ? 'dx-nav-active shadow-sm' : 'dx-nav-idle text-violet-400'}`
                  }`}
              >
                <Users className={`${desktopSidebarOpen ? 'h-4.5 w-4.5' : 'h-[22px] w-[22px]'} shrink-0`} />
                {desktopSidebarOpen && <span className="text-sm font-bold whitespace-nowrap">Partner</span>}
              </button>
            )}

            {isAdmin && !isPartner && (
              <button
                onClick={() => { setActiveTab('admin'); setMobileMenuOpen(false); }}
                aria-current={activeTab === 'admin' ? 'page' : undefined}
                title={!desktopSidebarOpen ? (adminRole === 'SUB_ADMIN' ? 'Partner Portal' : 'Admin') : undefined}
                className={`relative flex items-center transition-colors mb-0.5 ${desktopSidebarOpen
                    ? `flex-row justify-start gap-3 px-3 h-9 rounded-xl w-full ${activeTab === 'admin' ? 'dx-nav-active' : (adminRole === 'SUB_ADMIN' ? 'dx-nav-idle text-violet-400' : 'dx-nav-idle text-red-500')}`
                    : `justify-center h-9 w-9 mx-auto rounded-xl ${activeTab === 'admin' ? 'dx-nav-active shadow-sm' : (adminRole === 'SUB_ADMIN' ? 'dx-nav-idle text-violet-400' : 'dx-nav-idle text-red-500')}`
                  }`}
              >
                <Shield className={`${desktopSidebarOpen ? 'h-4.5 w-4.5' : 'h-[22px] w-[22px]'} shrink-0`} />
                {desktopSidebarOpen && (
                  <span className="text-sm font-bold whitespace-nowrap">
                    {adminRole === 'SUB_ADMIN' ? 'Partner Portal' : 'Admin'}
                  </span>
                )}
              </button>
            )}

            {NAV_GROUPS.map((group) => (
              <div key={group.label || 'primary'} className="w-full">
                {/* Group labels only make sense when the labels are visible. */}
                {group.label && desktopSidebarOpen && (
                  <p className="px-3 pt-1.5 pb-0.5 text-[9.5px] font-mono uppercase tracking-[0.14em] text-slate-400 dark:text-slate-600 whitespace-nowrap">
                    {group.label}
                  </p>
                )}
                {group.label && !desktopSidebarOpen && (
                  <div className="my-1 mx-auto w-5 border-t border-slate-200 dark:border-white/[0.07]" aria-hidden="true" />
                )}

                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => { item.onSelect?.(); setActiveTab(item.id); setMobileMenuOpen(false); }}
                        aria-current={isActive ? 'page' : undefined}
                        title={!desktopSidebarOpen ? item.label : undefined}
                        className={`relative flex items-center transition-colors ${desktopSidebarOpen
                            ? `flex-row justify-start gap-2.5 px-3 h-9 rounded-xl w-full ${isActive ? 'dx-nav-active' : 'dx-nav-idle'}`
                            : `justify-center h-9 w-9 mx-auto rounded-xl ${isActive ? 'dx-nav-active shadow-sm' : 'dx-nav-idle'}`
                          }`}
                      >
                        <item.icon className={`${desktopSidebarOpen ? 'h-4.5 w-4.5' : 'h-[22px] w-[22px]'} shrink-0`} />
                        {desktopSidebarOpen && (
                          <span className="text-sm font-bold whitespace-nowrap">{item.label}</span>
                        )}

                        {item.pro && !isProActive && desktopSidebarOpen && (
                          <span className="absolute right-3 inline-flex items-center gap-1 rounded-full bg-violet-500/12 border border-violet-500/25 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wider text-violet-600 dark:text-violet-300">
                            <Lock className="h-2 w-2" /> Pro
                          </span>
                        )}
                        {item.pro && !isProActive && !desktopSidebarOpen && (
                          <span className="absolute top-0.5 right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-violet-500/20 text-violet-500 dark:text-violet-300" title="Pro feature">
                            <Lock className="h-1.5 w-1.5" />
                          </span>
                        )}

                        {item.id === 'accounts' && accounts.length > 0 && (
                          /* Accent, not emerald: green means profit everywhere
                             else in this app, and a count is not a gain. */
                          <span className={`dx-badge absolute ${desktopSidebarOpen ? 'right-3' : 'top-0.5 right-0.5'} flex h-3.5 w-3.5 items-center justify-center text-[8px] rounded-full`}>
                            {accounts.length}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Region 3 — pinned. Only rendered when sidebar is expanded */}
          {!user?.isPro && desktopSidebarOpen && (
            <div className="shrink-0 w-full pt-2 px-3">
              <div className="relative overflow-hidden rounded-2xl p-3 bg-gradient-to-b from-violet-950/40 via-[#0e1324]/90 to-[#070b16] border border-violet-500/25 shadow-xl group transition-all duration-300 hover:border-violet-500/40">
                {/* Ambient subtle glow orb */}
                <div className="absolute -top-8 -right-8 w-20 h-20 bg-violet-600/20 rounded-full blur-xl pointer-events-none group-hover:bg-violet-600/30 transition-all" />

                {/* Top Row: Pro Badge & Pricing */}
                <div className="flex items-center justify-between mb-1.5 relative z-10">
                  <span className="inline-flex items-center gap-1 text-[9px] font-mono font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30">
                    <Sparkles className="h-2.5 w-2.5 text-amber-300 fill-amber-300" /> PRO PLAN
                  </span>
                  <span className="text-[10px] font-extrabold text-slate-300">
                    ₹499<span className="text-[9px] font-normal text-slate-400">/mo</span>
                  </span>
                </div>

                {/* Headline & Value proposition */}
                <div className="mb-2.5 relative z-10">
                  <h4 className="text-xs font-bold text-white tracking-tight mb-1">
                    Unlock Pro Trading
                  </h4>
                  <p className="text-[10.5px] text-slate-300/80 leading-relaxed">
                    MT5 Auto-Sync, AI Mentor &amp; unlimited portfolio accounts.
                  </p>
                </div>

                {/* Button */}
                <button
                  type="button"
                  onClick={() => setShowProModal(true)}
                  className="dx-upgrade w-full py-1.5 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-md shadow-violet-700/30 hover:shadow-violet-600/50 hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer relative z-10"
                >
                  <Sparkles className="h-3 w-3 text-amber-300 fill-amber-300" />
                  <span>Upgrade to Pro</span>
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>
          )}
        </aside>

        {/* Main Content Area */}
        <main
          className="flex-1 overflow-y-auto bg-[#FBFBFA] dark:bg-slate-950 px-4 pt-4 pb-32 md:pb-6 md:px-12 md:pt-8 space-y-6 md:space-y-8"
          onScroll={handleMainScroll}
        >
          <React.Suspense fallback={<TabLoading />}>
            {/* Mentor Inspection Mode Banner (Read-Only) */}
            {isMentorReadOnlyMode && inspectedUser && (
              <div className="bg-gradient-to-r from-violet-950 via-purple-900 to-slate-900 border-2 border-violet-500/60 rounded-2xl p-4 text-white shadow-2xl backdrop-blur-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-center gap-3.5">
                  <div className="p-2.5 rounded-xl bg-violet-500/20 text-violet-300 border border-violet-500/40 animate-pulse">
                    <Eye className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black uppercase tracking-wider text-violet-300 flex items-center gap-1.5">
                        <Shield className="h-4 w-4 text-violet-400" />
                        Mentor Inspection Mode (Read-Only)
                      </span>
                      <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-extrabold uppercase ${inspectedUser.isPro
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}>
                        {inspectedUser.isPro ? 'Pro Member' : 'Free Tier'}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        Read-Only Guard Active
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1">
                      Inspecting Trader: <strong className="text-white font-bold text-sm">{inspectedUser.name || 'Trader'}</strong> <span className="text-slate-400 font-mono text-xs">({inspectedUser.email})</span> &bull; <span className="text-emerald-400 font-semibold">{trades.length} trades logged</span> &bull; <span className="text-cyan-400 font-semibold">{accounts.length} accounts</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 self-stretch md:self-auto justify-end">
                  <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700/80 text-[11px] text-slate-300">
                    <Lock className="h-3.5 w-3.5 text-amber-400" />
                    <span>Trade Edits & Deletions Prohibited</span>
                  </div>
                  <button
                    onClick={handleExitMentorMode}
                    className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-600 via-rose-600 to-pink-600 hover:from-red-500 hover:via-rose-500 hover:to-pink-500 text-white text-xs font-black tracking-wide uppercase transition-all shadow-lg shadow-red-600/30 hover:scale-105 active:scale-95 flex items-center gap-2 cursor-pointer shrink-0"
                    title="Close Mentor View and return to Operations Console"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>Return to Admin Console</span>
                  </button>
                </div>
              </div>
            )}

            {/* Dynamic Title bar — hidden on mobile dashboard (hero card replaces it) */}
            <div className={`flex flex-col sm:flex-row items-stretch sm:items-start justify-between gap-3 sm:gap-4 w-full ${activeTab === 'dashboard' ? 'hidden sm:flex' : ''
              }`}>
              <div className="flex-1 min-w-0">
                <div>
                  <h1 className="text-xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white font-display sm:truncate">
                    {activeTab === 'dashboard' ? `Hello, ${user?.name || 'Trader'}` :
                      activeTab === 'journal' ? 'Trading Journal' :
                        activeTab === 'notebook' ? 'Notebook' :
                          activeTab === 'accounts' ? 'Portfolio Accounts' :
                            activeTab === 'analytics' ? 'Performance Analytics' :
                              activeTab === 'calendar' ? 'Trading Calendar' :
                                activeTab === 'chart' ? 'Live Chart' :
                                  activeTab === 'fxnews' ? 'FX News' :
                                    activeTab === 'settings' ? 'Settings' :
                                      activeTab === 'tools' ? 'Tools' :
                                        activeTab === 'insights' ? 'Heyza' :
                                          activeTab === 'partner' ? 'Partner Portal' : (adminRole === 'SUB_ADMIN' ? 'PARTNER PORTAL' : 'Admin Panel')}
                  </h1>
                  <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1 sm:line-clamp-1">
                    {activeTab === 'dashboard' ? 'Welcome back! Here\'s an overview of your trading performance.' :
                      activeTab === 'journal' ? 'Inline workspace database to log, filter, and audit trading setups.' :
                        activeTab === 'notebook' ? 'Jot down your feelings, plans, and daily reviews with our integrated rich-text templates.' :
                          activeTab === 'accounts' ? 'Manage your MetaTrader or custom brokerage accounts on-the-fly.' :
                          activeTab === 'analytics' ? 'Explore your strategic edge, session concentrations, and profit distribution.' :
                            activeTab === 'calendar' ? 'Visualize daily profit allocations and execution frequencies.' :
                              activeTab === 'chart' ? `View and analyze your trades directly on a live interactive chart · ${trades.filter(t => t.type !== 'Deposit' && t.type !== 'Withdrawal').length} trade markers plotted.` :
                                activeTab === 'settings' ? 'Configure portfolio guard, import tools, and co-pilot preferences.' :
                                  activeTab === 'tools' ? 'Precision calculators to plan your trades with confidence.' :
                                    activeTab === 'fxnews' ? 'Stay updated with the latest market-moving forex news and economic events.' :
                                      activeTab === 'insights' ? 'Your personal AI trading coach & mindset guide' :
                                        activeTab === 'partner' ? 'Your referral network, and the users who joined through it.' : (adminRole === 'SUB_ADMIN' ? 'Mentor & partner operations portal, assigned traders inspection and performance analytics.' : 'Administrative system configs.')}
                  </p>
                </div>
              </div>

              {ADD_TRADE_TABS.has(activeTab) && (
                <div className="hidden sm:flex items-center gap-2 sm:gap-3 w-full sm:w-auto sm:shrink-0 sm:pt-0.5">
                  <div className="flex flex-col items-stretch sm:items-end gap-2 w-full sm:w-auto">
                    <div className="relative flex items-center justify-end w-full">
                      <button
                        onClick={() => {
                          if (isMentorReadOnlyMode) {
                            alert('Adding trades is disabled in Mentor Read-Only Mode.');
                            return;
                          }
                          handleOpenTradeModal();
                        }}
                        disabled={accounts.length === 0 || isMentorReadOnlyMode}
                        data-tour="add-trade"
                        title={isMentorReadOnlyMode ? 'Adding trades disabled in Mentor Read-Only Mode' : accounts.length === 0 ? 'Connect a portfolio account first' : 'Log a new trade'}
                        className="group relative overflow-hidden bg-gradient-to-b from-violet-600 to-violet-700 hover:brightness-110 active:translate-y-px text-white font-bold text-xs rounded-lg py-2.5 sm:py-2 px-5 transition-all duration-200 flex items-center justify-center gap-1.5 w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed border border-violet-400/50 shadow-[0_10px_26px_-14px_rgba(139,92,246,.95),inset_0_1px_0_rgba(255,255,255,.26)]"
                      >
                        <div className="absolute inset-0 bg-white/20 -translate-x-[150%] skew-x-[-25deg] group-hover:animate-[shine_1.5s_ease-in-out]"></div>
                        <Plus className="h-4 w-4 relative z-10 group-hover:rotate-90 transition-transform duration-300" />
                        <span className="relative z-10">{isMentorReadOnlyMode ? 'Mentor Read-Only' : 'Add New Trade'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Mobile Dashboard Hero Card — replaces the plain title on small screens */}
            {/* The glows and the lit top edge are drawn by .dx-hero's own
              pseudo-elements, so the two white/5 discs that used to sit inside
              are gone along with the extra DOM. */}
            {activeTab === 'dashboard' && (
              <div className="dx-hero sm:hidden p-5">
                <div className="relative z-10">
                  {/* Greeting, relocated from the header so the logo could take
                    that slot. It belongs with the balance anyway. */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      {/* The name is the point of a greeting — "Good afternoon"
                        on its own greets nobody. First name only: full names
                        and long email-derived ones push the PRO badge off the
                        row, and `truncate` needs a single line to work on. */}
                      <p className="text-[13px] font-bold text-white leading-tight truncate">
                        {(() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })()}
                        , {user?.name?.split(' ')[0] || 'Trader'}
                      </p>
                      <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-white/60 truncate">
                        {activeAccount?.name || 'Portfolio Account'}
                      </span>
                    </div>
                    {user?.isPro ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/30 text-amber-300 text-[10px] font-extrabold">
                        <Star className="h-2.5 w-2.5 fill-amber-300" /> PRO
                      </span>
                    ) : (
                      <button
                        onClick={() => setShowProModal(true)}
                        className="dx-upgrade dx-upgrade-on-accent flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold"
                      >
                        <Sparkles className="h-2.5 w-2.5 text-amber-300 fill-amber-300" /> Upgrade
                      </button>
                    )}
                  </div>

                  {/* Balance */}
                  <div className="mb-1">
                    <p className="text-[11px] font-medium text-white/65 mb-1">Current Balance</p>
                    <p className="font-display text-[34px] leading-none font-black text-white tracking-tight tabular-nums">
                      {activeAccount ? formatValue(activeAccount.currentBalance ?? activeAccount.startingBalance) : '—'}
                    </p>
                  </div>

                  {/* Growth badge + quick stats */}
                  {(() => {
                    const _startBal = activeAccount?.startingBalance || 1;
                    const _curBal = activeAccount?.currentBalance ?? _startBal;
                    const growthPct = parseFloat((((_curBal - _startBal) / _startBal) * 100).toFixed(2));
                    const netPnL = parseFloat((_curBal - _startBal).toFixed(2));
                    return (
                      <>
                        {/* Green and red stay reserved for money, so the growth
                          pill keeps them. It gains a border because on glass a
                          tinted fill alone has nothing to sit against. */}
                        <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold mb-4 ${growthPct >= 0
                            ? 'bg-emerald-400/15 border-emerald-300/30 text-emerald-200'
                            : 'bg-rose-400/15 border-rose-300/30 text-rose-200'
                          }`}>
                          {growthPct >= 0 ? '↑' : '↓'} {Math.abs(growthPct).toFixed(2)}% growth
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div className="dx-hero-tile px-2 py-2.5 text-center">
                            <p className="text-[9px] font-semibold uppercase tracking-wider text-white/55 mb-1">Net P&amp;L</p>
                            <p className={`text-sm font-extrabold tabular-nums ${netPnL >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
                              {formatValue(netPnL)}
                            </p>
                          </div>
                          <div className="dx-hero-tile px-2 py-2.5 text-center">
                            <p className="text-[9px] font-semibold uppercase tracking-wider text-white/55 mb-1">Win Rate</p>
                            <p className="text-sm font-extrabold text-white tabular-nums">{winRate.toFixed(0)}%</p>
                          </div>
                          <div className="dx-hero-tile px-2 py-2.5 text-center">
                            <p className="text-[9px] font-semibold uppercase tracking-wider text-white/55 mb-1">Trades</p>
                            <p className="text-sm font-extrabold text-white tabular-nums">{totalTradesCount}</p>
                          </div>
                        </div>

                        {/* Rank, folded in. Two stacked cards took 59% of a
                          812px screen and both were captioned with the same
                          account name; this is the same information in ~70px. */}
                        <div className="mt-4 pt-4 border-t border-white/12">
                          <TraderRankCard
                            variant="strip"
                            account={activeAccount || null}
                            formatValue={formatValue}
                            netProfit={netProfit}
                            winRate={winRate}
                            winsCount={wins.length}
                            totalTradesCount={totalTradesCount}
                          />
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Global Drawdown Risk alert strip if active */}
            {activeAccount && maxDrawdownPercentage > 0 && dismissedDrawdownAccount !== activeAccount.id && (
              <div className="bg-amber-50 dark:bg-amber-400/10 border border-amber-200 dark:border-amber-400/25 text-amber-950 dark:text-amber-100 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <strong className="text-xs font-bold block">Portfolio Drawdown Active</strong>
                  <p className="text-xs text-amber-800/90 dark:text-amber-200/85 leading-relaxed mt-0.5">
                    Your portfolio is currently down <span className="font-extrabold">{maxDrawdownPercentage}%</span> from its starting balance. Drawdown guard is monitoring executions.
                  </p>
                </div>
                <button
                  onClick={() => setDismissedDrawdownAccount(activeAccount.id)}
                  className="text-amber-500 hover:text-amber-700 hover:bg-amber-100 dark:hover:text-amber-200 dark:hover:bg-amber-400/15 rounded-lg p-1.5 transition flex-shrink-0"
                  aria-label="Dismiss drawdown warning"
                  title="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Dynamic Route views */}

            {/* 1. DASHBOARD VIEW */}
            {activeTab === 'dashboard' && (
              <div className="space-y-8">
                {/* Dynamic Trader Rank & Drawdown Protection System.
                  Hidden on phones: the hero above carries the same rank as a
                  strip, so showing both repeated it twice. */}
                <div className="hidden sm:block">
                  <TraderRankCard
                    account={activeAccount || null}
                    formatValue={formatValue}
                    netProfit={netProfit}
                    winRate={winRate}
                    winsCount={wins.length}
                    totalTradesCount={totalTradesCount}
                  />
                </div>

                {/* Next high-impact economic event → jumps to Economic Calendar */}
                <NextEventCard onOpenCalendar={openEconomicCalendar} />

                {/* Main Visualizations Grid */}
                <div className="space-y-6">




                  <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2">
                      {/* Equity Curve Area Chart - Widescreen Layout */}
                      <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs flex flex-col h-80">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between mb-4 flex-shrink-0">
                          <div>
                            <h3 className="font-bold text-slate-900 text-sm">Portfolio Growth Curve</h3>
                            <p className="text-[10px] text-slate-400">Equity changes tracked trade-by-trade</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <button onClick={() => setActiveTab('analytics')} className="text-xs text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300 font-bold whitespace-nowrap">
                              Advanced Analytics →
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 w-full min-h-0 -mt-2">
                          {totalTradesCount > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={equityCurveData}>
                                <defs>
                                  <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={getChartColors().gradient} stopOpacity={0.15} />
                                    <stop offset="95%" stopColor={getChartColors().gradient} stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                                <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} domain={['dataMin - 100', 'dataMax + 100']} />
                                <Tooltip formatter={(value) => [formatValue(Number(value)), 'Equity']} />
                                <Area type="monotone" dataKey="equity" stroke={getChartColors().stroke} strokeWidth={2.5} fillOpacity={1} fill="url(#colorEquity)" activeDot={{ r: 5, strokeWidth: 0, fill: getChartColors().stroke }} />
                              </AreaChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="h-full flex flex-col items-center justify-center text-xs text-slate-400 space-y-2">
                              <span>Your equity curve appears here once you log your first trade.</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-1">
                      {/* Quick Risk Auditor status inside Dashboard */}
                      {/* min-h, not a fixed h-80: with all three guard rules present
                    the content is ~29px taller than 320px and spilled out past
                    the card's bottom edge. */}
                      <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs flex flex-col justify-between min-h-80">
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="font-bold text-slate-900 text-sm">Portfolio Guard Rules</h3>
                              <p className="text-[10px] text-slate-400">Drawdown status and protection systems</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleTogglePortfolioGuard(!isPortfolioGuardOn)}
                              className={`text-[10px] font-bold px-3 py-2 sm:py-1 rounded-full border uppercase tracking-wider cursor-pointer transition hover:opacity-80 ${isPortfolioGuardOn
                                ? 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                                : 'text-slate-600 bg-slate-100 border-slate-200 hover:bg-slate-200'
                                }`}
                              title={isPortfolioGuardOn ? 'Click to turn Portfolio Guard OFF' : 'Click to turn Portfolio Guard ON'}
                            >
                              {isPortfolioGuardOn ? 'Active' : 'Disabled'}
                            </button>
                          </div>

                          {isPortfolioGuardOn ? (
                            <div className="space-y-3">
                              {/* Daily Loss Guard */}
                              {(() => {
                                const limit = riskSettings?.dailyLossLimit || 500;
                                const breached = todayLoss >= limit;
                                return (
                                  <div className={`p-3 rounded-lg text-xs transition-colors duration-200 ${breached
                                    ? 'bg-rose-50/50 border border-rose-100'
                                    : 'bg-emerald-50/50 border border-emerald-100'
                                    }`}>
                                    <div className={`font-bold flex items-center justify-between ${breached ? 'text-rose-900 dark:text-rose-200' : 'text-emerald-900 dark:text-emerald-200'
                                      }`}>
                                      <span>Daily Loss Guard</span>
                                      <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border ${breached
                                        ? 'text-rose-600 bg-white border-rose-200 dark:bg-rose-400/15 dark:text-rose-300 dark:border-rose-400/30'
                                        : 'text-emerald-600 bg-white border-emerald-200 dark:bg-emerald-400/15 dark:text-emerald-300 dark:border-emerald-400/30'
                                        }`}>
                                        {breached ? 'Breached' : 'Active'}
                                      </span>
                                    </div>
                                    <p className={`mt-1 ${breached ? 'text-rose-700/80 dark:text-rose-300/80' : 'text-emerald-700/80 dark:text-emerald-300/80'}`}>
                                      {breached
                                        ? `Today's cumulative loss is ${formatValue(todayLoss)}, exceeding your limit of ${formatValue(limit)}!`
                                        : `Today's loss is ${formatValue(todayLoss)} (Limit: ${formatValue(limit)}). Safe.`
                                      }
                                    </p>
                                  </div>
                                );
                              })()}

                              {/* Overtrading Scanner */}
                              {(() => {
                                const limit = riskSettings?.maxTradesPerDay || 5;
                                const breached = todayTradesCount >= limit;
                                return (
                                  <div className={`p-3 rounded-lg text-xs transition-colors duration-200 ${breached
                                    ? 'bg-rose-50/50 border border-rose-100'
                                    : 'bg-emerald-50/50 border border-emerald-100'
                                    }`}>
                                    <div className={`font-bold flex items-center justify-between ${breached ? 'text-rose-900 dark:text-rose-200' : 'text-emerald-900 dark:text-emerald-200'
                                      }`}>
                                      <span>Overtrading Scanner</span>
                                      <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border ${breached
                                        ? 'text-rose-600 bg-white border-rose-200 dark:bg-rose-400/15 dark:text-rose-300 dark:border-rose-400/30'
                                        : 'text-emerald-600 bg-white border-emerald-200 dark:bg-emerald-400/15 dark:text-emerald-300 dark:border-emerald-400/30'
                                        }`}>
                                        {breached ? 'Breached' : 'Active'}
                                      </span>
                                    </div>
                                    <p className={`mt-1 ${breached ? 'text-rose-700/80 dark:text-rose-300/80' : 'text-emerald-700/80 dark:text-emerald-300/80'}`}>
                                      {breached
                                        ? `Executed ${todayTradesCount} trades today, breaching your limit of ${limit}!`
                                        : `Executed ${todayTradesCount} of ${limit} maximum daily positions. Safe.`
                                      }
                                    </p>
                                  </div>
                                );
                              })()}

                              {riskSettings && (
                                <div className="p-3 bg-emerald-50/60 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-400/20 rounded-lg text-xs">
                                  <div className="font-bold text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2">
                                    <span>Risk-Per-Trade Cap</span>
                                    <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border whitespace-nowrap shrink-0 text-emerald-600 bg-white border-emerald-200 dark:bg-emerald-400/15 dark:text-emerald-300 dark:border-emerald-400/30">
                                      Active
                                    </span>
                                  </div>
                                  <p className="text-emerald-700/80 dark:text-emerald-300/80 mt-1">Maximum limit set to {riskSettings.riskPerTradeLimit}% per position.</p>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-xl text-center space-y-2 my-2">
                              <div className="inline-flex p-2.5 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-400 mb-1">
                                <ShieldOff className="h-5 w-5 text-slate-400" />
                              </div>
                              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">Portfolio Guard Rules Disabled</h4>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 max-w-xs mx-auto">
                                Portfolio guard rules and risk limits are currently disabled. Toggle ON to enable active drawdown protection and discipline limits.
                              </p>
                            </div>
                          )}
                        </div>

                        <button onClick={() => { setActiveTab('settings'); setSettingsTab('risk'); }} className="w-full text-center py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 rounded-lg transition mt-4 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] dark:border-white/10 dark:text-slate-200">
                          Configure Guard Limits
                        </button>
                      </div>
                    </div>
                  </section>

                  <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* Risk-Reward Abstract Professional Balance Beam Card */}
                    {(() => {
                      const rrVal = avgRR || 0;
                      // Balanced at 1:1, right side (reward) tilts down if > 1.
                      const maxTilt = 10; // Keep tilt subtle and sophisticated
                      const tiltAngle = Math.min(Math.max((rrVal - 1) * 4, -maxTilt), maxTilt);

                      const angleRad = (tiltAngle * Math.PI) / 180;
                      const pivotX = 110;
                      const pivotY = 45;
                      const beamHalfLength = 85;

                      const xL = pivotX - beamHalfLength * Math.cos(angleRad);
                      const yL = pivotY - beamHalfLength * Math.sin(angleRad);
                      const xR = pivotX + beamHalfLength * Math.cos(angleRad);
                      const yR = pivotY + beamHalfLength * Math.sin(angleRad);

                      return (
                        <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs flex flex-col justify-between h-80">
                          <div className="flex justify-between items-start">
                            <div>
                              <h3 className="font-bold text-slate-900 text-sm">Risk : Reward</h3>
                              <p className="text-[10px] text-slate-400">Average risk-to-reward ratio of executions</p>
                            </div>
                            <span className={`text-[9px] uppercase font-extrabold tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${totalTradesCount === 0 ? 'bg-slate-100 text-slate-500 border border-slate-200 dark:bg-white/[0.06] dark:text-slate-400 dark:border-white/10' :
                              rrVal < 1.0 ? 'bg-rose-50 text-rose-600 border border-rose-100' :
                                rrVal < 1.5 ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                                  rrVal < 2.5 ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                                    'bg-indigo-50 text-indigo-600 border border-indigo-100'
                              }`}>
                              {totalTradesCount === 0 ? 'No data' : rrVal < 1.0 ? 'Low' : rrVal < 1.5 ? 'Moderate' : rrVal < 2.5 ? 'Good' : 'Excellent'}
                            </span>
                          </div>

                          {/* Prominent Center/Top Ratio */}
                          <div className="text-center mt-6">
                            <span className="text-4xl font-black text-slate-800 dark:text-white font-mono tracking-tight tabular-nums">
                              {totalTradesCount === 0 ? '1 : —' : `1 : ${rrVal.toFixed(2)}`}
                            </span>
                          </div>

                          {/* SVG Professional Abstract Balance Beam Illustration */}
                          <div className="relative w-full flex justify-center my-6 flex-1 items-center">
                            <svg width="220" height="70" viewBox="0 0 220 70" className="overflow-visible">

                              {/* Reference Baseline (1:1 perfect balance indication) */}
                              <line x1="25" y1={pivotY} x2="195" y2={pivotY} className="stroke-slate-200" strokeWidth="1" strokeDasharray="3 3" />

                              {/* Minimalist Center Pivot Base */}
                              <path d={`M ${pivotX} ${pivotY} L ${pivotX + 6} ${pivotY + 25} L ${pivotX - 6} ${pivotY + 25} Z`} className="fill-slate-50 stroke-slate-300" strokeWidth="1" strokeLinejoin="round" />
                              <circle cx={pivotX} cy={pivotY} r="2.5" className="fill-slate-400" />

                              {/* Tilted Precision Beam */}
                              <line x1={xL} y1={yL} x2={xR} y2={yR} className="stroke-slate-400" strokeWidth="1.5" strokeLinecap="round" />

                              {/* Left Side: Risk 1R (Abstract Node) */}
                              <circle cx={xL} cy={yL} r="5" className="fill-white stroke-rose-500" strokeWidth="2" />

                              {/* Right Side: Reward (Abstract Node) */}
                              <circle cx={xR} cy={yR} r="5" className="fill-white stroke-emerald-500" strokeWidth="2" />
                            </svg>
                          </div>

                          {/* Small Labels Risk 1R vs Reward 2.5R */}
                          <div className="border-t border-slate-50 pt-3 flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            <span className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                              Risk 1R
                            </span>
                            <span className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              Reward {rrVal.toFixed(1)}R
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                    {/* Win Rate Arc Chart Card */}
                    {(() => {
                      const wrVal = winRate || 0;
                      // No trades yet means no verdict: a 0% gauge labelled
                      // "Needs Work" judges a user who has not done anything.
                      const hasTrades = totalTradesCount > 0;
                      const wrPercentage = Math.min(Math.max(wrVal / 100, 0), 1);
                      const radius = 40;
                      const circumference = Math.PI * radius; // ~125.66
                      const strokeDashoffset = circumference - (wrPercentage * circumference);

                      return (
                        <div className="dx-panel p-6 shadow-xs flex flex-col justify-between h-80 relative overflow-hidden">
                          <div className="flex items-center gap-1.5 relative z-10">
                            <h3 className="font-bold text-slate-900 text-sm tracking-wide">Win / Loss Rate</h3>
                            <button
                              onClick={() => alert("Win Rate is calculated as:\n(Total Winning Trades ÷ Total Executed Trades) × 100")}
                              title="How is Win Rate calculated?"
                              className="hover:scale-110 transition-transform -m-2 p-2 shrink-0"
                            >
                              <HelpCircle className="w-4 h-4 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer" />
                            </button>
                          </div>

                          <div className="relative w-full flex-1 flex flex-col items-center justify-center mt-8">
                            <div className="relative w-64 h-36 flex items-end justify-center overflow-visible">
                              <svg className="w-full h-full overflow-visible" viewBox="0 0 100 55">
                                {/* Background Track */}
                                <path
                                  d="M 10 50 A 40 40 0 0 1 90 50"
                                  fill="none"
                                  stroke="var(--gauge-track)"
                                  strokeWidth="8"
                                  strokeLinecap="round"
                                />
                                {/* Active Progress */}
                                <path
                                  d="M 10 50 A 40 40 0 0 1 90 50"
                                  fill="none"
                                  stroke={hasTrades ? (winRate < 50 ? "#f87171" : "#a78bfa") : "var(--gauge-track)"}
                                  strokeWidth="8"
                                  strokeLinecap="round"
                                  strokeDasharray={circumference}
                                  strokeDashoffset={strokeDashoffset}
                                  className="transition-all duration-1000 ease-out"
                                />
                                {/* Dots overlay */}
                                <path
                                  d="M 10 50 A 40 40 0 0 1 90 50"
                                  fill="none"
                                  stroke="var(--gauge-pips)"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeDasharray={`0 ${circumference / 8}`}
                                />
                              </svg>

                              <div className="absolute flex flex-col items-center justify-end pb-3 gap-2 z-10">
                                <span className="gauge-chip text-xs font-bold px-4 py-1.5 rounded-full">
                                  {!hasTrades ? 'No data yet' : winRate < 40 ? 'Needs Work' : winRate < 50 ? 'Average' : winRate < 65 ? 'Good!' : 'Excellent!'}
                                </span>
                                <span className="gauge-chip text-xs font-medium px-5 py-2 rounded-full flex items-center gap-1.5">
                                  <span className="gauge-chip-value font-bold text-sm tracking-tight">{hasTrades ? wrVal.toFixed(0) + '%' : '—'}</span> Win Rate
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Winning vs Losing Trades Donut Chart */}
                    <div className="dx-panel p-6 shadow-xs flex flex-col justify-between h-80 relative overflow-hidden">
                      <div className="flex items-center justify-between relative z-10">
                        <div>
                          <h3 className="font-bold text-slate-900 dark:text-white text-sm">Win / Loss Ratio</h3>
                          <p className="text-[10px] text-slate-400">Total executions split by outcome</p>
                        </div>
                      </div>

                      <div className="relative w-full flex-1 flex items-center justify-center mt-2">
                        {totalTradesCount > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={[
                                  { name: "Winning Trades", value: wins.length, color: "#10b981" },
                                  { name: "Losing Trades", value: losses.length, color: "#ef4444" }
                                ]}
                                cx="50%"
                                cy="50%"
                                innerRadius={65}
                                outerRadius={85}
                                paddingAngle={5}
                                dataKey="value"
                                stroke="none"
                              >
                                {
                                  [{ color: "#10b981" }, { color: "#ef4444" }].map((entry, index) => (
                                    <Cell key={"cell-" + index} fill={entry.color} />
                                  ))
                                }
                              </Pie>
                              <Tooltip
                                contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)" }}
                                itemStyle={{ fontWeight: "bold" }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="text-xs text-slate-500 text-center">No trades yet</div>
                        )}

                        {totalTradesCount > 0 && (
                          <div className="absolute flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-3xl font-black text-slate-800 dark:text-white tracking-tighter">
                              {totalTradesCount}
                            </span>
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                              Trades
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex justify-between items-center mt-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{wins.length} Wins</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{losses.length} Losses</span>
                          <div className="w-2.5 h-2.5 rounded-full bg-rose-500"></div>
                        </div>
                      </div>
                    </div>

                  </section>

                </div>

                {/* Recent Executions Log Row */}
                <section className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm">Recent Trading Positions</h3>
                      <p className="text-[10px] text-slate-400 font-medium">Your 4 most recently logged positions</p>
                    </div>
                    <button
                      onClick={() => setActiveTab('journal')}
                      className="text-xs text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300 font-bold"
                    >
                      View Full Journal →
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {trades.slice(0, 4).map((t) => (
                      <div key={t.id} className="border border-slate-100 bg-white hover:bg-slate-50/50 rounded-xl p-4 text-xs transition duration-200 flex flex-col justify-between space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <strong className="text-sm font-bold text-slate-900 block">{t.symbol}</strong>
                            <span className="text-[10px] text-slate-400 font-semibold">{t.strategy || 'No Strategy'}</span>
                          </div>
                          <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${t.type === 'Buy' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                            }`}>
                            {t.type}
                          </span>
                        </div>

                        <div className="flex justify-between items-baseline pt-2 border-t border-slate-100/60">
                          <div>
                            <span className="text-[10px] text-slate-400 block">P/L Impact</span>
                            <span className={`font-extrabold text-sm ${t.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {t.profit >= 0 ? '+' : ''}{formatValue(t.profit)}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">{new Date(t.date).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}

                    {trades.length === 0 && (
                      <div className="col-span-4 text-center py-10 text-xs text-slate-400">
                        No trades in this portfolio yet. Add your first one to start tracking.
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            {/* 2. TRADING JOURNAL VIEW */}
            {activeTab === 'journal' && (
              <div className="space-y-6">
                <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-sm space-y-4">

                  {/* Filter controls */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search comments or pairs..."
                        className="bg-slate-50 border border-slate-200 text-xs rounded-lg px-3 py-2 w-full sm:w-48 focus:ring-blue-500 focus:border-blue-500"
                      />

                      <select
                        value={journalFilterSymbol}
                        onChange={(e) => setJournalFilterSymbol(e.target.value)}
                        className="bg-slate-50 border border-slate-200 text-xs rounded-lg px-2.5 py-2 text-slate-600"
                      >
                        <option value="">All Pairs</option>
                        {Array.from(new Set(trades.map(t => t.symbol))).map(sym => (
                          <option key={sym} value={sym}>{sym}</option>
                        ))}
                      </select>

                      <select
                        value={journalFilterEmotion}
                        onChange={(e) => setJournalFilterEmotion(e.target.value)}
                        className="bg-slate-50 border border-slate-200 text-xs rounded-lg px-2.5 py-2 text-slate-600"
                      >
                        <option value="">All Emotions</option>
                        <option value="Calm">Calm</option>
                        <option value="Anxious">Anxious</option>
                        <option value="Excited">Excited</option>
                        <option value="FOMO">FOMO</option>
                        <option value="Greedy">Greedy</option>
                        <option value="Revenge">Revenge</option>
                      </select>

                      {(() => {
                        const tradesWithExit = filteredTrades.filter(t => t.exitTime);
                        if (tradesWithExit.length === 0) return null;
                        const totalDuration = tradesWithExit.reduce((acc, t) => {
                          return acc + (new Date(t.exitTime!).getTime() - new Date(t.date).getTime());
                        }, 0);
                        const avgDurationMs = totalDuration / tradesWithExit.length;
                        const days = Math.floor(avgDurationMs / (1000 * 60 * 60 * 24));
                        const hours = Math.floor((avgDurationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                        const minutes = Math.floor((avgDurationMs % (1000 * 60 * 60)) / (1000 * 60));

                        let formatAvg = '';
                        if (days > 0) formatAvg += `${days}d `;
                        if (hours > 0) formatAvg += `${hours}h `;
                        formatAvg += `${minutes}m`;

                        return (
                          <div className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-400 rounded-lg text-xs font-semibold whitespace-nowrap">
                            <Clock className="h-3.5 w-3.5" />
                            Avg Hold: {formatAvg}
                          </div>
                        );
                      })()}

                      {(journalFilterSymbol || journalFilterEmotion || searchQuery) && (
                        <button
                          onClick={() => { setJournalFilterSymbol(''); setJournalFilterEmotion(''); setSearchQuery(''); }}
                          className="text-xs text-red-600 hover:underline font-semibold"
                        >
                          Clear Filters
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={refreshTrades}
                        disabled={tradesRefreshing}
                        title="Reload trades from Supabase"
                        className="border border-violet-200 hover:bg-violet-50 text-violet-700 text-xs font-semibold rounded-lg px-3 py-2 transition flex items-center gap-1 bg-white disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${tradesRefreshing ? 'animate-spin' : ''}`} />
                        {tradesRefreshing ? 'Syncing...' : 'Sync Trades'}
                      </button>
                      <button
                        onClick={() => setShowExportModal(true)}
                        className="border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg px-3 py-2 transition flex items-center gap-1 bg-white"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Export CSV
                      </button>
                    </div>
                  </div>

                  {/* Journal View Content */}
                  {(() => {
                    const tradesPerPage = 7;
                    const totalPages = Math.max(Math.ceil(filteredTrades.length / tradesPerPage), 1);
                    const validPage = Math.min(Math.max(journalPage, 1), totalPages);
                    const startIndex = (validPage - 1) * tradesPerPage;
                    const paginatedTrades = filteredTrades.slice(startIndex, startIndex + tradesPerPage);

                    return (
                      <div className="space-y-4">
                        {/* Big log Table (Desktop) */}
                        <div className="hidden md:block overflow-x-auto border border-slate-200 dark:border-[#1f2937] rounded-xl relative shadow-xl dark:shadow-2xl bg-white dark:bg-[#0a0d14]">
                          <table className="w-full text-center border-collapse text-xs">
                            <thead className="sticky top-0 bg-slate-50 dark:bg-[#0a0d14] z-10 border-b border-slate-200 dark:border-[#1f2937]">
                              <tr className="text-slate-900 dark:text-white font-bold text-[11.5px] tracking-wide">
                                <th className="py-4 px-4 font-bold text-center">Symbol</th>
                                <th className="py-4 px-4 font-bold border-l border-slate-200 dark:border-[#1f2937] text-center">Type</th>
                                <th className="py-4 px-4 font-bold border-l border-slate-200 dark:border-[#1f2937] text-center">Entry</th>
                                <th className="py-4 px-4 font-bold border-l border-slate-200 dark:border-[#1f2937] text-center">Exit</th>
                                <th className="py-4 px-4 font-bold border-l border-slate-200 dark:border-[#1f2937] text-center">Entry Time</th>
                                <th className="py-4 px-4 font-bold border-l border-slate-200 dark:border-[#1f2937] text-center">Exit Time</th>
                                <th className="py-4 px-4 font-bold border-l border-slate-200 dark:border-[#1f2937] text-center">Volume</th>
                                <th className="py-4 px-4 font-bold border-l border-slate-200 dark:border-[#1f2937] text-center">Net Profit</th>
                                <th className="py-4 px-4 font-bold border-l border-slate-200 dark:border-[#1f2937] text-center">Emotion</th>
                                <th className="py-4 px-4 font-bold border-l border-slate-200 dark:border-[#1f2937] text-center">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {paginatedTrades.map((t) => {
                                const entryDate = new Date(t.date);
                                const exitDate = t.exitTime ? new Date(t.exitTime) : null;
                                return (
                                  <tr key={t.id} className="border-b border-slate-100 dark:border-[#1f2937] hover:bg-slate-50 dark:hover:bg-white/[0.02] transition">
                                    <td className="py-4 px-4 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap text-center">
                                      {t.symbol}
                                    </td>
                                    <td className="py-4 px-4 border-l border-slate-100 dark:border-[#1f2937] text-center">
                                      <span className={`inline-flex items-center justify-center px-4 py-1.5 rounded-full text-[11px] font-bold ${t.type === 'Buy' ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                        }`}>
                                        {t.type}
                                      </span>
                                    </td>
                                    <td className="py-4 px-4 border-l border-slate-100 dark:border-[#1f2937] font-medium text-slate-700 dark:text-slate-300 text-center">
                                      {t.entryPrice}
                                    </td>
                                    <td className="py-4 px-4 border-l border-slate-100 dark:border-[#1f2937] font-medium text-slate-700 dark:text-slate-300 text-center">
                                      {t.exitPrice}
                                    </td>
                                    <td className="py-4 px-4 border-l border-slate-100 dark:border-[#1f2937] text-slate-700 dark:text-slate-300 text-center">
                                      <div className="flex flex-col items-center justify-center gap-0.5">
                                        <span className="font-medium text-[11.5px]">{entryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                        <span className="text-[10px] text-slate-500 dark:text-slate-400">{entryDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                                      </div>
                                    </td>
                                    <td className="py-4 px-4 border-l border-slate-100 dark:border-[#1f2937] text-slate-700 dark:text-slate-300 text-center">
                                      {exitDate ? (
                                        <div className="flex flex-col items-center justify-center gap-0.5">
                                          <span className="font-medium text-[11.5px]">{exitDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                          <span className="text-[10px] text-slate-500 dark:text-slate-400">{exitDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                                        </div>
                                      ) : (
                                        <span className="font-medium text-slate-400 dark:text-slate-500">-</span>
                                      )}
                                    </td>
                                    <td className="py-4 px-4 border-l border-slate-100 dark:border-[#1f2937] font-medium text-slate-700 dark:text-slate-300 text-center">
                                      {t.lotSize}
                                    </td>
                                    <td className="py-4 px-4 border-l border-slate-100 dark:border-[#1f2937] text-center">
                                      <span className={`font-medium ${t.profit >= 0 ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-600 dark:text-rose-500'}`}>
                                        {t.profit >= 0 ? '+' : ''}{new Intl.NumberFormat('en-US', { style: 'currency', currency: activeAccount?.currency || 'USD' }).format(t.profit)}
                                      </span>
                                    </td>
                                    <td className="py-4 px-4 border-l border-slate-100 dark:border-[#1f2937] text-center">
                                      <div className="flex items-center justify-center gap-2">
                                        {t.emotion ? (
                                          <span className="text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">
                                            {t.emotion}
                                          </span>
                                        ) : (
                                          <span className="text-slate-400 dark:text-slate-600">-</span>
                                        )}
                                        {t.notes && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setSelectedNote(t.notes || ''); }}
                                            className="text-slate-400 hover:text-violet-500 transition-colors -m-2 p-2 shrink-0"
                                            title="Read Note"
                                          >
                                            <MessageSquare className="h-3.5 w-3.5" />
                                          </button>
                                        )}
                                        {t.screenshot && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setViewingScreenshot(t.screenshot || ''); }}
                                            className="text-slate-400 hover:text-indigo-500 transition-colors -m-2 p-2 shrink-0"
                                            title="View chart screenshot"
                                          >
                                            <ImageIcon className="h-3.5 w-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                    <td className="py-4 px-4 border-l border-slate-100 dark:border-[#1f2937] text-center">
                                      <div className="flex items-center justify-center gap-3">
                                        {isMentorReadOnlyMode ? (
                                          <button
                                            onClick={() => handleOpenTradeModal(t)}
                                            className="text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20"
                                            title="Inspect trade execution details (Mentor Read-Only)"
                                          >
                                            <Eye className="h-3.5 w-3.5" />
                                            <span>Inspect</span>
                                          </button>
                                        ) : (
                                          <>
                                            <button
                                              onClick={() => handleOpenTradeModal(t)}
                                              className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition"
                                              title="Edit position details"
                                            >
                                              <Edit3 className="h-4 w-4" />
                                            </button>
                                            <button
                                              onClick={() => handleDeleteTrade(t.id)}
                                              className="text-rose-500/80 hover:text-rose-600 dark:hover:text-rose-500 transition"
                                              title="Delete position"
                                            >
                                              <Trash2 className="h-4 w-4" />
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}

                              {paginatedTrades.length === 0 && (
                                <tr>
                                  <td colSpan={10} className="text-center py-10 text-slate-500">
                                    No matching recorded trades. Clear filters or add your first position.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile Trades List (Reference Image Style) */}
                        <div className="md:hidden flex flex-col space-y-0 mt-2 border-t border-slate-100 dark:border-slate-800 -mx-6 px-6">
                          {paginatedTrades.map(t => (
                            <div
                              key={t.id}
                              onClick={() => handleOpenTradeModal(t)}
                              className="flex flex-col py-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50 active:bg-slate-50 dark:active:bg-slate-800/50 cursor-pointer transition-colors"
                            >
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="font-extrabold text-[14px] text-slate-800 dark:text-slate-200 tracking-wide uppercase">{t.symbol}</span>
                                <span className={`font-bold text-[13px] ${t.profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                  {t.profit >= 0 ? '+' : ''}{formatValue(t.profit)}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 mb-3">
                                <span className={`font-bold text-[11px] ${t.type === 'Buy' ? 'text-blue-500 dark:text-blue-400' : 'text-rose-500 dark:text-rose-400'} uppercase tracking-wide`}>{t.type}</span>
                                <span className="text-[12px] text-slate-500 dark:text-slate-400">{t.lotSize} lots</span>
                                {t.emotion && <span className="ml-2 text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded-full">{t.emotion}</span>}
                                {t.notes && <button onClick={(e) => { e.stopPropagation(); setSelectedNote(t.notes || ''); }} className="text-slate-400 hover:text-violet-500 transition-colors -m-2 p-2 shrink-0" title="Read Note"><MessageSquare className="h-3.5 w-3.5" /></button>}
                              </div>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center text-[12px] text-slate-600 dark:text-slate-300 font-mono">
                                  <span>{t.entryPrice}</span>
                                  <span className="mx-2 text-slate-400">&rarr;</span>
                                  <span>{t.exitPrice}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                                  {new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                  <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                                </div>
                              </div>
                            </div>
                          ))}
                          {paginatedTrades.length === 0 && (
                            <div className="text-center py-10 text-slate-400 text-sm">
                              No matching recorded trades. Clear filters or add your first position.
                            </div>
                          )}
                        </div>

                        {/* Pagination Controls */}
                        {filteredTrades.length > 0 && (
                          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2 pt-4">
                            <div className="text-xs text-slate-500 font-medium">
                              Showing <span className="text-slate-900 dark:text-white font-bold">{startIndex + 1}</span> to <span className="text-slate-900 dark:text-white font-bold">{Math.min(startIndex + tradesPerPage, filteredTrades.length)}</span> of <span className="text-slate-900 dark:text-white font-bold">{filteredTrades.length}</span> trades
                            </div>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => setJournalPage(p => Math.max(1, p - 1))}
                                disabled={validPage === 1}
                                className="px-4 py-2 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                              >
                                Previous
                              </button>
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                Page {validPage} of {totalPages}
                              </span>
                              <button
                                onClick={() => setJournalPage(p => Math.min(totalPages, p + 1))}
                                disabled={validPage === totalPages}
                                className="px-4 py-2 rounded-lg text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                              >
                                Next
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* 2b. STANDALONE LIVE CHART VIEW */}
            {/* The candles come from /api/chart/ohlc, which is Pro-only, so the
              chart would render empty with a fetch error on the free plan. */}
            {activeTab === 'chart' && !isProActive && (
              <ProFeaturePanel
                title="Live Chart"
                blurb="Plot your own entries and exits against live market candles across any timeframe, and click a trade to jump straight to it on the chart."
                onUpgrade={goToSubscriptionSettings}
              />
            )}

            {activeTab === 'chart' && isProActive && (
              <div className="space-y-2">
                {selectedChartTradeId && (
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-slate-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
                      Journal trade highlighted on chart
                    </span>
                    <button
                      onClick={() => setSelectedChartTradeId(null)}
                      className="text-xs text-slate-400 hover:text-white font-semibold flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-slate-800 transition border border-slate-700/50"
                    >
                      <X className="h-3 w-3" /> Clear selection
                    </button>
                  </div>
                )}

                {/* The chart fills the remaining viewport height */}
                <div style={{ height: selectedChartTradeId ? 'calc(100vh - 225px)' : 'calc(100vh - 195px)', minHeight: '520px' }}>
                  <TradingViewChart
                    trades={trades}
                    theme={theme}
                    selectedTradeId={selectedChartTradeId}
                    onTradeMarkerClick={(id) => setSelectedChartTradeId(id)}
                    initialSymbol={selectedChartTradeId ? (trades.find(t => t.id === selectedChartTradeId)?.symbol || 'XAUUSD') : 'XAUUSD'}
                  />
                </div>
              </div>
            )}

            {/* 3. CALENDAR VIEW */}
            {activeTab === 'calendar' && (
              <TradingCalendar trades={trades} currency={activeAccount?.currency || 'USD'} />
            )}

            {/* 3b. FX NEWS & ECONOMIC CALENDAR VIEW */}
            {activeTab === 'fxnews' && (
              <FXNews initialTab={fxNewsInitialTab} isPro={isProActive} />
            )}

            {/* 4. PORTFOLIO ACCOUNTS VIEW */}
            {activeTab === 'accounts' && (
              <div className="space-y-5 max-w-7xl">

                {/* Universal View: Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
                  {accounts.length === 0 && (
                    <div className="col-span-full py-16 text-center text-slate-500 text-sm border-2 border-dashed border-slate-200 dark:border-white/10 rounded-2xl">
                      No accounts connected yet.
                    </div>
                  )}
                  {accounts.map((acc, idx) => {
                    const isActive = acc.id === selectedAccountId;
                    const plReturn = acc.currentBalance - acc.startingBalance;

                    const cur = acc.currency || 'USD';
                    const formatCur = (val: number) => {
                      try {
                        return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(val);
                      } catch {
                        return `${cur} ${val.toFixed(2)}`;
                      }
                    };

                    const startingCapitalStr = formatCur(acc.startingBalance);
                    const currentBalanceStr = formatCur(acc.currentBalance);

                    // Format P/L Return with + or - sign
                    const formattedPlReturn = formatCur(Math.abs(plReturn));
                    const plReturnStr = plReturn >= 0 ? `+${formattedPlReturn}` : `-${formattedPlReturn}`;

                    return (
                      <div
                        key={acc.id}
                        className={`dx-panel flex flex-col overflow-hidden transition-all duration-300 ${isActive ? 'ring-1 ring-violet-500/60 shadow-md' : 'hover:shadow-md'
                          }`}
                      >
                        {/* Header */}
                        <div className="p-5 pb-4 border-b border-slate-100 dark:border-white/5">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className={`text-[16px] font-extrabold truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                              {acc.name}
                            </span>
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-widest ${acc.accountType === 'Live' ? 'bg-amber-500/10 text-amber-500' : 'bg-slate-500/10 text-slate-500'
                              }`}>
                              {acc.accountType}
                            </span>
                          </div>
                          <p className={`text-[11px] font-medium truncate ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                            {acc.broker || 'B'} • {acc.platform || 'MT5'} {acc.institutionType ? `• ${acc.institutionType}` : ''}
                          </p>
                        </div>

                        {/* Stats */}
                        <div className="px-5 py-5 space-y-3 flex-1 text-[13px]">
                          <div className="flex items-center justify-between">
                            <span className={`${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Starting Capital</span>
                            <span className={`font-mono font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{startingCapitalStr}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className={`${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Current Balance</span>
                            <span className={`font-mono font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{currentBalanceStr}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className={`${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>P/L Return</span>
                            <span className={`font-mono font-bold ${plReturn >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{plReturnStr}</span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="px-5 pb-5 flex items-center gap-3">
                          {isActive ? (
                            <button
                              className={`flex-1 py-2.5 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 transition ${theme === 'dark' ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'
                                }`}
                            >
                              <Check className="h-4 w-4" /> Active Portfolio
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                setSelectedAccountId(acc.id);
                                persistSelectedAccount(acc.id);
                                fetchTradesAndParams(acc.id);
                              }}
                              className={`flex-1 py-2.5 rounded-xl text-[13px] font-bold flex items-center justify-center transition bg-blue-600 hover:bg-blue-700 text-white`}
                            >
                              Activate Portfolio
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingAccount(acc);
                              setEditAccName(acc.name);
                              setEditAccStartingBalance(String(acc.startingBalance));
                              setEditAccCurrency(acc.currency || 'USD');
                              setShowEditAccountModal(true);
                            }}
                            className={`w-[42px] h-[42px] shrink-0 rounded-xl flex items-center justify-center border transition ${theme === 'dark' ? 'border-white/10 hover:bg-white/5 text-slate-400' : 'border-slate-200 hover:bg-slate-50 text-slate-500'
                              }`}
                            title="Edit Account Name, Currency and Starting Capital"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>



                {/* Add Account Button (Visible on both desktop & mobile) */}
                <button
                  onClick={() => { setShowAccountModal(true); setAccountCreationMethod('select'); }}
                  data-tour="create-portfolio"
                  className={`w-full border-2 border-dashed rounded-2xl py-5 flex items-center justify-center gap-2.5 transition text-sm font-semibold ${theme === 'dark'
                    ? 'border-white/10 hover:border-white/20 text-slate-400 hover:text-slate-200 bg-transparent'
                    : 'border-slate-300 hover:border-slate-400 text-slate-500 hover:text-slate-700 bg-transparent'
                    }`}
                >
                  <Plus className="h-5 w-5" />
                  Connect New Portfolio Account
                </button>

              </div>
            )}

            {/* 5. PERFORMANCE ANALYTICS VIEW */}
            {activeTab === 'analytics' && (
              <div className="space-y-8">



                <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                  {/* Equity Curve Area Chart */}
                  <div className="lg:col-span-2 bg-white border border-slate-100 rounded-xl p-6 shadow-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between mb-4">
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm">Portfolio Growth Curve</h3>
                        <p className="text-[10px] text-slate-400">Cumulative account equity changes traced trade-by-trade</p>
                      </div>
                    </div>
                    <div className="h-64">
                      {totalTradesCount > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={equityCurveData}>
                            <defs>
                              <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={getChartColors().gradient} stopOpacity={0.15} />
                                <stop offset="95%" stopColor={getChartColors().gradient} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                            <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} domain={['dataMin - 100', 'dataMax + 100']} />
                            <Tooltip formatter={(value) => [formatValue(Number(value)), 'Equity']} />
                            <Area type="monotone" dataKey="equity" stroke={getChartColors().stroke} strokeWidth={2.5} fillOpacity={1} fill="url(#colorEquity)" activeDot={{ r: 5, strokeWidth: 0, fill: getChartColors().stroke }} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs text-slate-400">
                          Your metrics appear here once you log your first trade.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Side cards for core mathematical ratios */}
                  <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs space-y-4 flex flex-col justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm mb-4">Trading Mechanics</h3>
                      <div className="space-y-4">
                        <div className="flex justify-between items-center border-b border-slate-50 pb-2 text-xs">
                          <span className="text-slate-400 font-medium">Profit Factor</span>
                          <span className={`font-extrabold ${totalTradesCount === 0 ? 'text-slate-400' : profitFactor >= 1.5 ? 'text-emerald-600' : 'text-slate-900 dark:text-white'}`}>{totalTradesCount === 0 ? '—' : profitFactor}</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-slate-50 pb-2 text-xs">
                          <span className="text-slate-400 font-medium">Risk-to-Reward Ratio</span>
                          <span className="font-extrabold text-slate-900 dark:text-white">{totalTradesCount === 0 ? '1 : —' : `1 : ${avgRR}`}</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-slate-50 pb-2 text-xs">
                          <span className="text-slate-400 font-medium">Wins / Losses</span>
                          <span className="font-bold text-slate-800">{wins.length} Wins / {losses.length} Losses</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-slate-50 pb-2 text-xs">
                          <span className="text-slate-400 font-medium">Active Drawdown</span>
                          <span className={`font-extrabold ${totalTradesCount === 0 ? 'text-slate-400' : maxDrawdownPercentage > 0 ? 'text-rose-600' : 'text-slate-900 dark:text-white'}`}>{totalTradesCount === 0 ? '—' : `${maxDrawdownPercentage}%`}</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-slate-50 pb-2 text-xs">
                          <span className="text-slate-400 font-medium">Winning Streak</span>
                          <span className="font-extrabold text-emerald-600">{maxWinStreak}{maxWinStreak > 0 && currentWinStreak > 0 ? ` (${currentWinStreak} active)` : ''}</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-slate-50 pb-2 text-xs">
                          <span className="text-slate-400 font-medium">Losing Streak</span>
                          <span className="font-extrabold text-rose-600">{maxLossStreak}{maxLossStreak > 0 && currentLossStreak > 0 ? ` (${currentLossStreak} active)` : ''}</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-lg p-3 text-[11px] text-slate-500 leading-relaxed border border-slate-100">
                      <span className="font-bold text-slate-800 dark:text-slate-200 block mb-0.5">Analyst Tip</span>
                      {totalTradesCount === 0
                        ? 'Log your first trades and this panel will show your profit factor, streaks and drawdown. Ratios above 1.5 indicate a viable system.'
                        : <>Your Profit Factor is <span className="font-semibold">{profitFactor}</span>. Ratios above 1.5 indicate institutional system viability.</>}
                    </div>
                  </div>
                </section>

                <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Risk-Reward Abstract Professional Balance Beam Card */}
                  {(() => {
                    const rrVal = avgRR || 0;
                    // Balanced at 1:1, right side (reward) tilts down if > 1.
                    const maxTilt = 10; // Keep tilt subtle and sophisticated
                    const tiltAngle = Math.min(Math.max((rrVal - 1) * 4, -maxTilt), maxTilt);

                    const angleRad = (tiltAngle * Math.PI) / 180;
                    const pivotX = 110;
                    const pivotY = 45;
                    const beamHalfLength = 85;

                    const xL = pivotX - beamHalfLength * Math.cos(angleRad);
                    const yL = pivotY - beamHalfLength * Math.sin(angleRad);
                    const xR = pivotX + beamHalfLength * Math.cos(angleRad);
                    const yR = pivotY + beamHalfLength * Math.sin(angleRad);

                    return (
                      <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs flex flex-col justify-between h-80">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-bold text-slate-900 text-sm">Risk : Reward</h3>
                            <p className="text-[10px] text-slate-400">Average risk-to-reward ratio of executions</p>
                          </div>
                          <span className={`text-[9px] uppercase font-extrabold tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${totalTradesCount === 0 ? 'bg-slate-100 text-slate-500 border border-slate-200 dark:bg-white/[0.06] dark:text-slate-400 dark:border-white/10' :
                            rrVal < 1.0 ? 'bg-rose-50 text-rose-600 border border-rose-100' :
                              rrVal < 1.5 ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                                rrVal < 2.5 ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                                  'bg-indigo-50 text-indigo-600 border border-indigo-100'
                            }`}>
                            {totalTradesCount === 0 ? 'No data' : rrVal < 1.0 ? 'Low' : rrVal < 1.5 ? 'Moderate' : rrVal < 2.5 ? 'Good' : 'Excellent'}
                          </span>
                        </div>

                        {/* Prominent Center/Top Ratio */}
                        <div className="text-center mt-6">
                          <span className="text-4xl font-black text-slate-800 dark:text-white font-mono tracking-tight tabular-nums">
                            {totalTradesCount === 0 ? '1 : —' : `1 : ${rrVal.toFixed(2)}`}
                          </span>
                        </div>

                        {/* SVG Professional Abstract Balance Beam Illustration */}
                        <div className="relative w-full flex justify-center my-6 flex-1 items-center">
                          <svg width="220" height="70" viewBox="0 0 220 70" className="overflow-visible">

                            {/* Reference Baseline (1:1 perfect balance indication) */}
                            <line x1="25" y1={pivotY} x2="195" y2={pivotY} className="stroke-slate-200" strokeWidth="1" strokeDasharray="3 3" />

                            {/* Minimalist Center Pivot Base */}
                            <path d={`M ${pivotX} ${pivotY} L ${pivotX + 6} ${pivotY + 25} L ${pivotX - 6} ${pivotY + 25} Z`} className="fill-slate-50 stroke-slate-300" strokeWidth="1" strokeLinejoin="round" />
                            <circle cx={pivotX} cy={pivotY} r="2.5" className="fill-slate-400" />

                            {/* Tilted Precision Beam */}
                            <line x1={xL} y1={yL} x2={xR} y2={yR} className="stroke-slate-400" strokeWidth="1.5" strokeLinecap="round" />

                            {/* Left Side: Risk 1R (Abstract Node) */}
                            <circle cx={xL} cy={yL} r="5" className="fill-white stroke-rose-500" strokeWidth="2" />

                            {/* Right Side: Reward (Abstract Node) */}
                            <circle cx={xR} cy={yR} r="5" className="fill-white stroke-emerald-500" strokeWidth="2" />
                          </svg>
                        </div>

                        {/* Small Labels Risk 1R vs Reward 2.5R */}
                        <div className="border-t border-slate-50 pt-3 flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                            Risk 1R
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            Reward {rrVal.toFixed(1)}R
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                  {/* Win Rate Arc Chart Card */}
                  {(() => {
                    const wrVal = winRate || 0;
                    // No trades yet means no verdict: a 0% gauge labelled
                    // "Needs Work" judges a user who has not done anything.
                    const hasTrades = totalTradesCount > 0;
                    const wrPercentage = Math.min(Math.max(wrVal / 100, 0), 1);
                    const radius = 40;
                    const circumference = Math.PI * radius; // ~125.66
                    const strokeDashoffset = circumference - (wrPercentage * circumference);

                    return (
                      <div className="dx-panel p-6 shadow-xs flex flex-col justify-between h-80 relative overflow-hidden">
                        <div className="flex items-center gap-1.5 relative z-10">
                          <h3 className="font-bold text-slate-900 text-sm tracking-wide">Win / Loss Rate</h3>
                          <button
                            onClick={() => alert("Win Rate is calculated as:\n(Total Winning Trades ÷ Total Executed Trades) × 100")}
                            title="How is Win Rate calculated?"
                            className="hover:scale-110 transition-transform -m-2 p-2 shrink-0"
                          >
                            <HelpCircle className="w-4 h-4 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer" />
                          </button>
                        </div>

                        <div className="relative w-full flex-1 flex flex-col items-center justify-center mt-8">
                          <div className="relative w-64 h-36 flex items-end justify-center overflow-visible">
                            <svg className="w-full h-full overflow-visible" viewBox="0 0 100 55">
                              {/* Background Track */}
                              <path
                                d="M 10 50 A 40 40 0 0 1 90 50"
                                fill="none"
                                stroke="var(--gauge-track)"
                                strokeWidth="8"
                                strokeLinecap="round"
                              />
                              {/* Active Progress */}
                              <path
                                d="M 10 50 A 40 40 0 0 1 90 50"
                                fill="none"
                                stroke={hasTrades ? (winRate < 50 ? "#f87171" : "#a78bfa") : "var(--gauge-track)"}
                                strokeWidth="8"
                                strokeLinecap="round"
                                strokeDasharray={circumference}
                                strokeDashoffset={strokeDashoffset}
                                className="transition-all duration-1000 ease-out"
                              />
                              {/* Dots overlay */}
                              <path
                                d="M 10 50 A 40 40 0 0 1 90 50"
                                fill="none"
                                stroke="var(--gauge-pips)"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeDasharray={`0 ${circumference / 8}`}
                              />
                            </svg>

                            <div className="absolute flex flex-col items-center justify-end pb-3 gap-2 z-10">
                              <span className="gauge-chip text-xs font-bold px-4 py-1.5 rounded-full">
                                {!hasTrades ? 'No data yet' : winRate < 40 ? 'Needs Work' : winRate < 50 ? 'Average' : winRate < 65 ? 'Good!' : 'Excellent!'}
                              </span>
                              <span className="gauge-chip text-xs font-medium px-5 py-2 rounded-full flex items-center gap-1.5">
                                <span className="gauge-chip-value font-bold text-sm tracking-tight">{hasTrades ? wrVal.toFixed(0) + '%' : '—'}</span> Win Rate
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Winning vs Losing Trades Donut Chart */}
                  <div className="dx-panel p-6 shadow-xs flex flex-col justify-between h-80 relative overflow-hidden">
                    <div className="flex items-center justify-between relative z-10">
                      <div>
                        <h3 className="font-bold text-slate-900 dark:text-white text-sm">Win / Loss Ratio</h3>
                        <p className="text-[10px] text-slate-400">Total executions split by outcome</p>
                      </div>
                    </div>

                    <div className="relative w-full flex-1 flex items-center justify-center mt-2">
                      {totalTradesCount > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={[
                                { name: "Winning Trades", value: wins.length, color: "#10b981" },
                                { name: "Losing Trades", value: losses.length, color: "#ef4444" }
                              ]}
                              cx="50%"
                              cy="50%"
                              innerRadius={65}
                              outerRadius={85}
                              paddingAngle={5}
                              dataKey="value"
                              stroke="none"
                            >
                              {
                                [{ color: "#10b981" }, { color: "#ef4444" }].map((entry, index) => (
                                  <Cell key={"cell-" + index} fill={entry.color} />
                                ))
                              }
                            </Pie>
                            <Tooltip
                              contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)" }}
                              itemStyle={{ fontWeight: "bold" }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="text-xs text-slate-500 text-center">No trades yet</div>
                      )}

                      {totalTradesCount > 0 && (
                        <div className="absolute flex flex-col items-center justify-center pointer-events-none">
                          <span className="text-3xl font-black text-slate-800 dark:text-white tracking-tighter">
                            {totalTradesCount}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                            Trades
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-between items-center mt-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{wins.length} Wins</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{losses.length} Losses</span>
                        <div className="w-2.5 h-2.5 rounded-full bg-rose-500"></div>
                      </div>
                    </div>
                  </div>

                </section>

                <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                  {/* Monthly P&L Bar Chart */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-6 shadow-xs">
                    <h3 className="font-bold text-slate-900 dark:text-white text-sm mb-1">Monthly P&L Distribution</h3>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-4 font-semibold">Net profit or loss grouped chronologically by month</p>
                    <div className="h-64">
                      {monthlyPnlChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={monthlyPnlChartData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.15} />
                            <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                            <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
                            <Tooltip formatter={(value) => [formatValue(Number(value)), 'Net Profit']} />
                            <Bar dataKey="profit" maxBarSize={36} radius={[4, 4, 0, 0]}>
                              {monthlyPnlChartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? '#10b981' : '#f43f5e'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs text-slate-400">
                          No monthly trading history found.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Profit by Instrument */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-6 shadow-xs">
                    <h3 className="font-bold text-slate-900 dark:text-white text-sm mb-4">Cumulative Profit by Instrument</h3>
                    <div className="h-64">
                      {symbolChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={symbolChartData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" opacity={0.15} />
                            <XAxis type="number" stroke="#94a3b8" fontSize={10} tickLine={false} />
                            <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={10} tickLine={false} />
                            <Tooltip formatter={(value) => [formatValue(Number(value)), 'Cumulative Net']} />
                            <Bar dataKey="profit" maxBarSize={28} fill="#3b82f6" radius={[0, 4, 4, 0]}>
                              {symbolChartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? '#10b981' : '#f43f5e'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs text-slate-400">
                          No asset configurations calculated yet.
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                  {/* Best Trade Card */}
                  <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm">Best Trade</h4>
                          <p className="text-[10px] text-slate-400">Single highest profit execution</p>
                        </div>
                        <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                          <TrendingUp className="h-5 w-5" />
                        </div>
                      </div>
                      {bestTrade ? (
                        <div className="space-y-3">
                          <div className="flex items-baseline justify-between">
                            <span className="text-xl font-black text-emerald-600">
                              +{formatValue(bestTrade.profit)}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-50 text-slate-600 rounded">
                              {bestTrade.symbol}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-3 text-xs pt-2 border-t border-slate-50">
                            <div>
                              <span className="text-slate-400 font-medium block">Type / Lots</span>
                              <span className="font-bold text-slate-800">{bestTrade.type} / {bestTrade.lotSize} Lots</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium block">Date</span>
                              <span className="font-bold text-slate-800">{new Date(bestTrade.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium block">Entry Price</span>
                              <span className="font-bold text-slate-800">{bestTrade.entryPrice}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium block">Exit Price</span>
                              <span className="font-bold text-slate-800">{bestTrade.exitPrice}</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400 py-6 text-center">
                          No profitable trades recorded.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Worst Trade Card */}
                  <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm">Worst Trade</h4>
                          <p className="text-[10px] text-slate-400">Single deepest loss execution</p>
                        </div>
                        <div className="p-2 bg-rose-50 text-rose-600 rounded-lg">
                          <TrendingDown className="h-5 w-5" />
                        </div>
                      </div>
                      {worstTrade ? (
                        <div className="space-y-3">
                          <div className="flex items-baseline justify-between">
                            <span className="text-xl font-black text-rose-600">
                              {formatValue(worstTrade.profit)}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-50 text-slate-600 rounded">
                              {worstTrade.symbol}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-3 text-xs pt-2 border-t border-slate-50">
                            <div>
                              <span className="text-slate-400 font-medium block">Type / Lots</span>
                              <span className="font-bold text-slate-800">{worstTrade.type} / {worstTrade.lotSize} Lots</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium block">Date</span>
                              <span className="font-bold text-slate-800">{new Date(worstTrade.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium block">Entry Price</span>
                              <span className="font-bold text-slate-800">{worstTrade.entryPrice}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium block">Exit Price</span>
                              <span className="font-bold text-slate-800">{worstTrade.exitPrice}</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400 py-6 text-center">
                          No losing trades recorded.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Sessions Concentration */}
                  <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs">
                    <h3 className="font-bold text-slate-900 text-sm mb-1">Session Concentration</h3>
                    <p className="text-[10px] text-slate-400 mb-4 font-semibold">Allocations of executions across operational timezones</p>
                    <div className="h-64 flex items-center justify-center">
                      {sessionData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={sessionData}
                              cx="50%"
                              cy="50%"
                              innerRadius={45}
                              outerRadius={70}
                              paddingAngle={3}
                              dataKey="value"
                            >
                              {sessionData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip />
                            <Legend verticalAlign="bottom" height={36} iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="text-xs text-slate-400">No session metrics available.</div>
                      )}
                    </div>
                  </div>
                </section>

                {/* Best & Worst Day Statistics (based on daily net P&L) */}
                <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Best Day Card */}
                  <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm">Best Day</h4>
                          <p className="text-[10px] text-slate-400">Most profitable day by net P&L</p>
                        </div>
                        <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                          <Calendar className="h-5 w-5" />
                        </div>
                      </div>
                      {bestDay && bestDay.net > 0 ? (
                        <div className="space-y-3">
                          <div className="flex items-baseline justify-between">
                            <span className="text-xl font-black text-emerald-600">
                              +{formatValue(bestDay.net)}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-50 text-slate-600 rounded">
                              {new Date(`${bestDay.dayKey}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-3 text-xs pt-2 border-t border-slate-50">
                            <div>
                              <span className="text-slate-400 font-medium block">Weekday</span>
                              <span className="font-bold text-slate-800">{new Date(`${bestDay.dayKey}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' })}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium block">Date</span>
                              <span className="font-bold text-slate-800">{new Date(`${bestDay.dayKey}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium block">Net P&L</span>
                              <span className="font-bold text-emerald-600">+{formatValue(bestDay.net)}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium block">Trades</span>
                              <span className="font-bold text-slate-800">{bestDay.count}</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400 py-6 text-center">
                          No profitable trading days recorded.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Worst Day Card */}
                  <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm">Worst Day</h4>
                          <p className="text-[10px] text-slate-400">Day with the largest net loss</p>
                        </div>
                        <div className="p-2 bg-rose-50 text-rose-600 rounded-lg">
                          <Calendar className="h-5 w-5" />
                        </div>
                      </div>
                      {worstDay && worstDay.net < 0 ? (
                        <div className="space-y-3">
                          <div className="flex items-baseline justify-between">
                            <span className="text-xl font-black text-rose-600">
                              {formatValue(worstDay.net)}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-50 text-slate-600 rounded">
                              {new Date(`${worstDay.dayKey}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-3 text-xs pt-2 border-t border-slate-50">
                            <div>
                              <span className="text-slate-400 font-medium block">Weekday</span>
                              <span className="font-bold text-slate-800">{new Date(`${worstDay.dayKey}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' })}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium block">Date</span>
                              <span className="font-bold text-slate-800">{new Date(`${worstDay.dayKey}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium block">Net P&L</span>
                              <span className="font-bold text-rose-600">{formatValue(worstDay.net)}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium block">Trades</span>
                              <span className="font-bold text-slate-800">{worstDay.count}</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400 py-6 text-center">
                          No losing trading days recorded.
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* 5b. PRO ANALYTICS & STATISTICAL EDGE SUITE */}
                <section className="mt-8 space-y-6">
                  {/* Section Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div className="flex items-center gap-3">
                      <span className="p-2 rounded-xl bg-violet-100 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 border border-violet-200/50 dark:border-violet-800/50">
                        <Sparkles className="h-5 w-5" />
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-slate-900 dark:text-white text-base">Advanced Pro Analytics</h3>
                          <span className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shadow-xs">
                            PRO
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          Deep-dive equity drawdown curve, day-of-week win rates, and expectancy edge
                        </p>
                      </div>
                    </div>
                    {!isProActive && (
                      <button
                        onClick={() => setShowProModal(true)}
                        className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-md transition shrink-0"
                      >
                        <Lock className="h-3.5 w-3.5" /> Unlock Pro Analytics Suite
                      </button>
                    )}
                  </div>

                  {/* Pro Stat Cards Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-4 shadow-xs">
                      <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 mb-1">Profit Factor</div>
                      <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                        {isProActive ? (proMetrics.profitFactor > 0 ? proMetrics.profitFactor.toFixed(2) : '—') : '2.45'}
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-medium">Gross Wins ÷ Gross Losses</div>
                    </div>
                    <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-4 shadow-xs">
                      <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 mb-1">Trade Expectancy</div>
                      <div className={`text-2xl font-black font-mono ${isProActive ? (proMetrics.expectancy >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400') : 'text-emerald-500'}`}>
                        {isProActive ? (tradingTrades.length > 0 ? formatValue(proMetrics.expectancy) : '—') : '+$142.50'}
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-medium">Expected net per trade</div>
                    </div>
                    <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-4 shadow-xs">
                      <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 mb-1">Max Win Streak</div>
                      <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                        {isProActive ? (proMetrics.maxConsecutiveWins || 0) : '6'} <span className="text-xs font-semibold text-slate-400">Wins</span>
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-medium">Consecutive profitable trades</div>
                    </div>
                    <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-4 shadow-xs">
                      <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 mb-1">Max Loss Streak</div>
                      <div className="text-2xl font-black text-rose-500 dark:text-rose-400 font-mono">
                        {isProActive ? (proMetrics.maxConsecutiveLosses || 0) : '2'} <span className="text-xs font-semibold text-slate-400">Losses</span>
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-medium">Consecutive losing trades</div>
                    </div>
                  </div>

                  {/* 2 Pro Charts with Pro Lock Gate for Free Users */}
                  <div className="relative">
                    {!isProActive && (
                      <div className="absolute inset-0 z-20 backdrop-blur-xs bg-slate-900/60 dark:bg-slate-950/70 rounded-2xl flex flex-col items-center justify-center p-6 text-center border border-white/10">
                        <div className="p-3.5 rounded-full bg-violet-600/30 border border-violet-500/40 text-violet-300 mb-3 shadow-xl">
                          <Lock className="h-6 w-6" />
                        </div>
                        <h4 className="text-lg font-bold text-white mb-1.5">Pro Analytics Suite</h4>
                        <p className="text-xs text-slate-300 max-w-md mb-4 leading-relaxed">
                          Upgrade to <strong>FX Journal Pro</strong> to unlock your real-time <strong>Equity & Underwater Drawdown Curve</strong>, <strong>Day-of-Week Win Rate Edge</strong>, and statistical trade expectancy.
                        </p>
                        <button
                          onClick={() => setShowProModal(true)}
                          className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg transition flex items-center gap-2"
                        >
                          <Sparkles className="h-3.5 w-3.5" /> Upgrade to PRO — ₹499/mo
                        </button>
                      </div>
                    )}

                    <div className={`grid grid-cols-1 lg:grid-cols-2 gap-6 ${!isProActive ? 'filter blur-[3px] opacity-60 pointer-events-none' : ''}`}>
                      {/* Pro Chart 1: Equity & Drawdown Underwater Curve */}
                      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-6 shadow-xs">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h4 className="font-bold text-slate-900 dark:text-white text-sm">Equity & Underwater Drawdown</h4>
                            <p className="text-[10px] text-slate-400">Account balance progression with peak-to-trough drawdown %</p>
                          </div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 border border-violet-100 dark:border-violet-800/40">
                            Underwater Curve
                          </span>
                        </div>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={isProActive ? equityDrawdownData : [
                              { name: 'Start', equity: 10000, drawdown: 0, pnl: 0 },
                              { name: 'W1', equity: 10450, drawdown: 0, pnl: 450 },
                              { name: 'W2', equity: 10200, drawdown: -2.39, pnl: -250 },
                              { name: 'W3', equity: 10800, drawdown: 0, pnl: 600 },
                              { name: 'W4', equity: 11250, drawdown: 0, pnl: 450 },
                              { name: 'W5', equity: 10900, drawdown: -3.11, pnl: -350 },
                              { name: 'W6', equity: 11600, drawdown: 0, pnl: 700 }
                            ]}>
                              <defs>
                                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
                                </linearGradient>
                                <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.05} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.15} />
                              <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                              <YAxis yAxisId="left" stroke="#94a3b8" fontSize={10} tickLine={false} tickFormatter={(v) => `$${v}`} />
                              <YAxis yAxisId="right" orientation="right" stroke="#f43f5e" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}%`} domain={[-20, 0]} />
                              <Tooltip formatter={(value: any, name: any) => [name === 'drawdown' ? `${value}%` : formatValue(Number(value)), name === 'drawdown' ? 'Drawdown' : 'Equity']} />
                              <Area yAxisId="left" type="monotone" dataKey="equity" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#equityGrad)" />
                              <Area yAxisId="right" type="monotone" dataKey="drawdown" stroke="#f43f5e" strokeWidth={1.5} fillOpacity={1} fill="url(#ddGrad)" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Pro Chart 2: Day-of-Week Win Rate & Edge Performance */}
                      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-6 shadow-xs">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h4 className="font-bold text-slate-900 dark:text-white text-sm">Performance by Day of the Week</h4>
                            <p className="text-[10px] text-slate-400">P&L distribution and win rate across active market days</p>
                          </div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/40">
                            Session Edge
                          </span>
                        </div>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={isProActive ? dayOfWeekPerformance : [
                              { name: 'Mon', profit: 320, winRate: 66.7, trades: 3, wins: 2, losses: 1 },
                              { name: 'Tue', profit: 540, winRate: 75.0, trades: 4, wins: 3, losses: 1 },
                              { name: 'Wed', profit: -120, winRate: 40.0, trades: 5, wins: 2, losses: 3 },
                              { name: 'Thu', profit: 680, winRate: 80.0, trades: 5, wins: 4, losses: 1 },
                              { name: 'Fri', profit: 210, winRate: 60.0, trades: 5, wins: 3, losses: 2 }
                            ]}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.15} />
                              <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                              <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
                              <Tooltip formatter={(val: any, name: any) => [name === 'profit' ? formatValue(Number(val)) : `${val}%`, name === 'profit' ? 'Net P&L' : 'Win Rate']} />
                              <Bar dataKey="profit" maxBarSize={32} radius={[4, 4, 0, 0]}>
                                {(isProActive ? dayOfWeekPerformance : [
                                  { profit: 320 }, { profit: 540 }, { profit: -120 }, { profit: 680 }, { profit: 210 }
                                ]).map((entry, index) => (
                                  <Cell key={`dow-${index}`} fill={entry.profit >= 0 ? '#10b981' : '#f43f5e'} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* 6. CONSOLIDATED SETTINGS VIEW */}
            {activeTab === 'settings' && (
              <div className="flex flex-col space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">

                  {/* Settings Inner Tabs Navigation */}
                  {/* Settings Inner Tabs Navigation */}
                  {/* settings-aside: `.dark aside` in index.css puts a
                      backdrop-filter on every <aside>, for the dashboard's glassy
                      nav rail. A backdrop-filter establishes a stacking context
                      and a containing block, which trapped this column's section
                      dropdown inside it — the menu could not paint over the panel
                      beside it, so the two rendered through each other and both
                      were unreadable. The class exists only to switch that blur
                      off here. */}
                  <aside className="settings-aside lg:col-span-1">
                    {/* Mobile Dropdown Navigation */}
                    <div className="lg:hidden relative mb-4">
                      <button
                        type="button"
                        onClick={() => setIsSettingsDropdownOpen(!isSettingsDropdownOpen)}
                        className="w-full bg-white dark:bg-[#0b101d] border border-slate-200/90 dark:border-white/10 rounded-xl p-3 text-sm font-bold text-slate-800 dark:text-white flex justify-between items-center shadow-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-violet-500/10 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                            {settingsTab === 'achievements' && <Trophy className="h-4 w-4" />}
                            {settingsTab === 'general' && <User className="h-4 w-4" />}
                            {settingsTab === 'risk' && <Shield className="h-4 w-4" />}
                            {settingsTab === 'notifications' && <Bell className="h-4 w-4" />}
                            {settingsTab === 'subscription' && <CreditCard className="h-4 w-4" />}
                            {settingsTab === 'about' && <Info className="h-4 w-4" />}
                            {settingsTab === 'help' && <HelpCircle className="h-4 w-4" />}
                            {settingsTab === 'theme' && (theme === 'dark' ? <Moon className="h-4 w-4 text-indigo-400" /> : <Sun className="h-4 w-4 text-amber-500" />)}
                          </div>
                          <span className="capitalize text-xs font-bold text-slate-900 dark:text-white">
                            {settingsTab === 'achievements' && 'Achievements & Badges'}
                            {settingsTab === 'general' && 'General Profile'}
                            {settingsTab === 'risk' && 'Risk Guard Limits'}
                            {settingsTab === 'notifications' && 'Notifications'}
                            {settingsTab === 'subscription' && 'Plan & Billing'}
                            {settingsTab === 'about' && 'About Platform'}
                            {settingsTab === 'help' && 'Help & Support'}
                            {settingsTab === 'theme' && `Appearance (${theme === 'dark' ? 'Dark' : 'Light'})`}
                          </span>
                        </div>
                        <ChevronRight className={`h-4 w-4 text-slate-400 transform transition-transform duration-200 ${isSettingsDropdownOpen ? 'rotate-90' : ''}`} />
                      </button>

                      {isSettingsDropdownOpen && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-[#0b101d] border border-slate-200 dark:border-white/10 rounded-xl shadow-xl z-50 overflow-hidden flex flex-col p-1.5 animate-slide-down">
                          {[
                            { id: 'general', label: 'General Profile', icon: User },
                            { id: 'risk', label: 'Risk Guard Limits', icon: Shield },
                            { id: 'achievements', label: 'Achievements & Badges', icon: Trophy },
                            { id: 'subscription', label: 'Plan & Billing', icon: CreditCard },
                            { id: 'notifications', label: 'Notifications', icon: Bell },
                            { id: 'theme', label: 'Appearance & Theme', icon: theme === 'dark' ? Moon : Sun },
                            { id: 'help', label: 'Help & Support', icon: HelpCircle },
                            { id: 'about', label: 'About Platform', icon: Info },
                          ].map(tab => {
                            const isActive = settingsTab === tab.id;
                            const TabIcon = tab.icon;
                            return (
                              <button
                                key={tab.id}
                                type="button"
                                onClick={() => {
                                  setSettingsTab(tab.id as any);
                                  setIsSettingsDropdownOpen(false);
                                }}
                                className={`w-full text-left py-2.5 px-3 rounded-lg text-xs font-semibold transition flex items-center gap-2.5 ${isActive
                                    ? 'settings-nav-active font-bold'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/[0.06] dark:hover:text-white'
                                  }`}
                              >
                                <TabIcon className="h-4 w-4 shrink-0" />
                                <span className="flex-1 truncate">{tab.label}</span>
                                {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Desktop Settings Navigation Card */}
                    <div className="hidden lg:block settings-nav-card rounded-2xl p-3 shadow-xs sticky top-20">
                      <div className="px-2.5 py-2 border-b border-slate-100 dark:border-white/[0.06] mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-violet-600/10 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                            <Settings className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-xs font-bold text-slate-900 dark:text-white tracking-tight">Preferences</span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Settings</span>
                      </div>

                      <div className="space-y-3.5">
                        {[
                          {
                            group: 'Account',
                            items: [
                              { id: 'general', label: 'General Profile', desc: 'User details & security', icon: User },
                              { id: 'subscription', label: 'Plan & Billing', desc: 'Current tier & features', icon: CreditCard },
                              { id: 'notifications', label: 'Notifications', desc: 'Email alerts & summaries', icon: Bell },
                            ]
                          },
                          {
                            group: 'Trading Rules',
                            items: [
                              { id: 'risk', label: 'Risk Guard Limits', desc: 'Drawdown & loss caps', icon: Shield },
                              { id: 'achievements', label: 'Achievements', desc: 'Badges & trading streaks', icon: Trophy },
                            ]
                          },
                          {
                            group: 'System',
                            items: [
                              { id: 'theme', label: 'Appearance', desc: theme === 'dark' ? 'Dark theme active' : 'Light theme active', icon: theme === 'dark' ? Moon : Sun },
                              { id: 'help', label: 'Help & Support', desc: 'Tours, guides & onboarding', icon: HelpCircle },
                              { id: 'about', label: 'About Platform', desc: 'App version & legal', icon: Info },
                            ]
                          }
                        ].map((section, idx, arr) => (
                          <div key={section.group} className="space-y-1">
                            <div className="px-2 text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                              {section.group}
                            </div>
                            <div className="space-y-1 pt-0.5">
                              {section.items.map((item) => {
                                const isActive = settingsTab === item.id;
                                const ItemIcon = item.icon;
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setSettingsTab(item.id as any)}
                                    className={`w-full text-left px-2.5 py-2 rounded-xl transition-all duration-150 flex items-center gap-2.5 group relative ${isActive
                                        ? 'settings-nav-active font-semibold'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/80 dark:hover:bg-white/[0.05]'
                                      }`}
                                  >
                                    <div
                                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${isActive
                                          ? 'bg-white/20 text-white'
                                          : 'bg-slate-100 dark:bg-white/[0.06] text-slate-500 dark:text-slate-400 group-hover:text-violet-600 dark:group-hover:text-violet-400 group-hover:bg-violet-50 dark:group-hover:bg-violet-500/10'
                                        }`}
                                    >
                                      <ItemIcon className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className={`text-xs font-bold truncate leading-tight ${isActive ? 'text-white' : 'text-slate-800 dark:text-slate-200'}`}>
                                        {item.label}
                                      </div>
                                      <div className={`text-[10px] truncate leading-tight mt-0.5 ${isActive ? 'settings-desc' : 'text-slate-400 dark:text-slate-500'}`}>
                                        {item.desc}
                                      </div>
                                    </div>
                                    {isActive && (
                                      <ChevronRight className="h-3.5 w-3.5 text-white/80 shrink-0" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                            {idx < arr.length - 1 && (
                              <div className="pt-1.5 border-b border-slate-100 dark:border-white/[0.04]" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </aside>

                  {/* Settings Right Hand Content Panel */}
                  <div className="lg:col-span-3 space-y-6">

                    {/* Achievements sub-tab */}
                    {settingsTab === 'achievements' && (
                      <AchievementsTab user={user} trades={trades} />
                    )}

                    {/* General sub-tab */}
                    {settingsTab === 'general' && user && (
                      <div className="space-y-6">
                        {/*
                        Only shown to users who actually have a partner. For
                        everyone else there is nobody the setting could apply
                        to, and a dead switch invites the wrong conclusion
                        about who can see their trades.
                      */}
                        {partnerLink?.hasPartner && (
                          <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs space-y-4">
                            <div>
                              <h3 className="font-extrabold text-slate-900 text-base">Partner access</h3>
                              <p className="text-xs text-slate-400">
                                You joined through <span className="font-semibold text-slate-600">{partnerLink.partnerName}</span>.
                              </p>
                            </div>

                            <div className="flex items-start justify-between gap-4 p-3.5 bg-slate-50/70 rounded-xl border border-slate-100">
                              <div className="space-y-0.5 text-xs">
                                <strong className="text-slate-800 block">Allow Partner to View Trade Details</strong>
                                <span className="text-[11px] text-slate-400 block leading-relaxed">
                                  Lets {partnerLink.partnerName} open your trading history, analysis and journal
                                  in read-only mode. They can never edit, add or delete anything, and they cannot
                                  change your account. Off by default — turn it back off whenever you like.
                                </span>
                              </div>
                              <input
                                type="checkbox"
                                role="switch"
                                aria-label="Allow Partner to View Trade Details"
                                disabled={savingPartnerVisibility}
                                checked={partnerLink.allowPartnerTradeView}
                                onChange={(e) => handlePartnerVisibility(e.target.checked)}
                                className="mt-0.5 h-4.5 w-4.5 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 cursor-pointer disabled:opacity-40"
                              />
                            </div>

                            <p className="text-[11px] text-slate-400">
                              {partnerLink.allowPartnerTradeView
                                ? 'Your partner can currently see your trading data.'
                                : 'Your partner can see your name and plan only — not your trades.'}
                            </p>
                          </div>
                        )}

                        {/*
                        {/*
                          Privacy & Mentor Access. Sharing used to be one
                          switch, so a student who wanted help reading their
                          analysis had to hand over their journal too. Each row
                          is enforced on the server: a section that is off is
                          left out of the response, rather than sent and hidden
                          in the console.

                          The controls are the app's own switch — the same
                          h-5 w-9 track and translating knob as the theme and
                          Portfolio Guard toggles — rather than the browser's
                          square checkbox, and the whole row is the hit target.
                        */}
                        {mentorAccess && (
                          <div className="dx-panel p-6 space-y-5">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <h3 className="dx-section-title">Privacy &amp; Mentor Access</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-lg leading-relaxed">
                                  {partnerLink?.hasPartner
                                    ? `Choose what ${partnerLink.partnerName || 'your mentor'} can open. Change it whenever you like.`
                                    : 'Set now what a mentor would be able to open. Nobody has access until you join through one.'}
                                </p>
                              </div>
                              {/* Answers "how exposed am I?" without reading
                                  seven rows. Not the .dx-badge count pill —
                                  that is for numbers, and a solid inverted
                                  slab around a sentence reads far heavier than
                                  a summary should. */}
                              <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-1">
                                <span className={`h-1.5 w-1.5 rounded-full ${MENTOR_ACCESS_ROWS.some((r) => mentorAccess[r.key] === true) ? 'bg-violet-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                                {MENTOR_ACCESS_ROWS.filter((r) => mentorAccess[r.key] === true).length}
                                {' of '}{MENTOR_ACCESS_ROWS.length} shared
                              </span>
                            </div>

                            <div className="space-y-2">
                              {MENTOR_ACCESS_ROWS.map((row) => {
                                const on = mentorAccess[row.key] === true;
                                const busy = savingMentorAccess === row.key;
                                return (
                                  <button
                                    key={row.key}
                                    type="button"
                                    role="switch"
                                    aria-checked={on}
                                    aria-label={row.label}
                                    disabled={busy}
                                    onClick={() => handleMentorAccessChange(row.key, !on)}
                                    className={`dx-perm-row ${on ? 'dx-perm-row-on' : ''}`}
                                  >
                                    <span className={`dx-perm-icon ${on ? 'dx-perm-icon-on' : ''}`}>
                                      <row.icon className="h-4 w-4" />
                                    </span>
                                    <span className="min-w-0 flex-1 text-left">
                                      <span className="block text-[13px] font-bold text-slate-800 dark:text-slate-100">
                                        {row.label}
                                      </span>
                                      <span className="block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                                        {row.blurb}
                                      </span>
                                    </span>
                                    <span className={`dx-switch ${on ? 'dx-switch-on' : ''} ${busy ? 'opacity-50' : ''}`}>
                                      <span className="dx-switch-knob" />
                                    </span>
                                  </button>
                                );
                              })}

                              {/* Accounts is a selection, not a switch: the
                                  student picks which portfolios are visible.
                                  null means every account, including any they
                                  add later. */}
                              <div className={`dx-perm-row dx-perm-row-static ${mentorAccess.accounts === null || (mentorAccess.accounts || []).length > 0 ? 'dx-perm-row-on' : ''}`}>
                                <span className={`dx-perm-icon ${mentorAccess.accounts === null || (mentorAccess.accounts || []).length > 0 ? 'dx-perm-icon-on' : ''}`}>
                                  <Layers className="h-4 w-4" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center justify-between gap-3">
                                    <span className="block text-[13px] font-bold text-slate-800 dark:text-slate-100">Accounts</span>
                                    <button
                                      type="button"
                                      disabled={savingMentorAccess === 'accounts'}
                                      onClick={() => handleMentorAccessChange(
                                        'accounts',
                                        mentorAccess.accounts === null ? [] : null,
                                      )}
                                      className="shrink-0 text-[11px] font-bold text-violet-600 dark:text-violet-300 hover:underline disabled:opacity-40"
                                    >
                                      {mentorAccess.accounts === null ? 'Choose accounts' : 'Share all'}
                                    </button>
                                  </span>
                                  <span className="block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                                    Pick the portfolios to share. Hiding one hides its trades, analysis and
                                    journal entries everywhere.
                                  </span>

                                  {mentorAccess.accounts === null ? (
                                    <span className="mt-2 block text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                      Sharing every account, including any you add later.
                                    </span>
                                  ) : mentorAccounts.length === 0 ? (
                                    <span className="mt-2 block text-[11px] text-slate-500 dark:text-slate-400">
                                      You have no trading accounts yet.
                                    </span>
                                  ) : (
                                    <span className="mt-2.5 block space-y-1.5 border-t border-slate-200/70 dark:border-white/[0.07] pt-2.5">
                                      {mentorAccounts.map((acc) => {
                                        const shown = (mentorAccess.accounts || []).includes(acc.id);
                                        return (
                                          <button
                                            key={acc.id}
                                            type="button"
                                            role="switch"
                                            aria-checked={shown}
                                            aria-label={acc.name}
                                            disabled={savingMentorAccess === 'accounts'}
                                            onClick={() => {
                                              const current: string[] = mentorAccess.accounts || [];
                                              handleMentorAccessChange(
                                                'accounts',
                                                shown ? current.filter((x) => x !== acc.id) : [...current, acc.id],
                                              );
                                            }}
                                            className="dx-perm-subrow"
                                          >
                                            <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                                              {acc.name}
                                            </span>
                                            <span className={`dx-switch dx-switch-sm ${shown ? 'dx-switch-on' : ''}`}>
                                              <span className="dx-switch-knob" />
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </span>
                                  )}
                                </span>
                              </div>
                            </div>

                            {/* Said rather than left to be discovered: the notebook
                                never leaves this browser, so there is nothing for the
                                server to withhold. */}
                            <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 border-t border-slate-200/70 dark:border-white/[0.07] pt-3.5">
                              Your notebook is stored only on this device and is never uploaded, so a mentor
                              cannot open it whatever this setting says. Live charts show market data; only the
                              trade markers drawn on them come from your account.
                            </p>
                          </div>
                        )}

                        {/* Profile Form */}
                        <form onSubmit={handleSaveProfile} className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs space-y-4">
                          <div>
                            <h3 className="font-extrabold text-slate-900 text-base">Profile details</h3>
                            <p className="text-xs text-slate-400">Update your account name and email address.</p>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-50 pt-4 text-xs">
                            <div>
                              <label className="font-bold text-slate-700 block mb-1">User Name</label>
                              <input
                                type="text"
                                required
                                value={settingsName}
                                onChange={(e) => setSettingsName(e.target.value)}
                                className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full font-semibold focus:ring-slate-500 focus:border-slate-500"
                              />
                            </div>

                            <div>
                              <label className="font-bold text-slate-700 block mb-1">Email Address</label>
                              <input
                                type="email"
                                value={settingsEmail}
                                readOnly
                                disabled
                                title="Your email address identifies your account and cannot be changed here."
                                className="bg-slate-100 border border-slate-200 text-xs rounded-lg p-2.5 w-full font-semibold text-slate-500 cursor-not-allowed"
                              />
                              <p className="text-[10px] text-slate-500 mt-1">Your email identifies your account. Contact support to change it.</p>
                            </div>
                          </div>

                          <div className="flex justify-end pt-2">
                            <button
                              type="submit"
                              disabled={actionLoading}
                              className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2.5 px-4 rounded-lg transition"
                            >
                              {actionLoading ? 'Saving...' : 'Save Profile Changes'}
                            </button>
                          </div>
                        </form>

                        {/* Password Form */}
                        <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="font-extrabold text-slate-900 text-base">Change Password</h3>
                              <p className="text-xs text-slate-400">Ensure your trading dashboard is secured with a strong password.</p>
                            </div>
                            {!showPasswordChange && (
                              <button
                                type="button"
                                onClick={() => setShowPasswordChange(true)}
                                className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2.5 px-4 rounded-lg transition"
                              >
                                Change Password
                              </button>
                            )}
                          </div>

                          {showPasswordChange && (
                            <form onSubmit={handleChangePassword} className="space-y-4 pt-4 border-t border-slate-50 animate-fade-in">
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                                <div>
                                  <label className="font-bold text-slate-700 block mb-1">Current Password</label>
                                  <input
                                    type="password"
                                    required
                                    placeholder="••••••••"
                                    value={settingsCurrPassword}
                                    onChange={(e) => setSettingsCurrPassword(e.target.value)}
                                    className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full font-mono"
                                  />
                                </div>

                                <div>
                                  <label className="font-bold text-slate-700 block mb-1">New Password</label>
                                  <input
                                    type="password"
                                    required
                                    placeholder="••••••••"
                                    value={settingsNewPassword}
                                    onChange={(e) => setSettingsNewPassword(e.target.value)}
                                    className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full font-mono"
                                  />
                                </div>

                                <div>
                                  <label className="font-bold text-slate-700 block mb-1">Confirm New Password</label>
                                  <input
                                    type="password"
                                    required
                                    placeholder="••••••••"
                                    value={settingsConfirmPassword}
                                    onChange={(e) => setSettingsConfirmPassword(e.target.value)}
                                    className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full font-mono"
                                  />
                                </div>
                              </div>

                              <div className="flex justify-end gap-2 pt-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowPasswordChange(false);
                                    setSettingsCurrPassword('');
                                    setSettingsNewPassword('');
                                    setSettingsConfirmPassword('');
                                  }}
                                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs py-2 px-4 rounded-lg transition"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="submit"
                                  disabled={actionLoading}
                                  className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 px-4 rounded-lg transition disabled:opacity-50"
                                >
                                  {actionLoading ? 'Updating...' : 'Update Password'}
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Notifications sub-tab */}
                    {settingsTab === 'notifications' && (
                      <form onSubmit={handleSaveNotifications} className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs space-y-4">
                        <div>
                          <h3 className="font-extrabold text-slate-900 text-base">Notification Preferences</h3>
                          <p className="text-xs text-slate-400">Choose the alerts and reminders you want once delivery goes live.</p>
                        </div>

                        {/*
                        Nothing sends these yet — the toggles only write to
                        localStorage. Saying so is not optional here: a trader
                        who believes "Max Daily Loss Alert" is armed may size a
                        position expecting to be warned, and no warning is coming.
                        The switches stay visible but inert until there is a
                        sender behind them.
                      */}
                        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
                          <Info className="h-4 w-4 shrink-0 text-amber-600 mt-px" />
                          <p className="text-[11px] leading-relaxed text-amber-800">
                            <strong className="font-bold">Alert delivery is not live yet.</strong> These preferences
                            are saved, but no email or push notification is sent at the moment. Do not rely on
                            the loss alert as a risk control — use your broker&apos;s stop-loss.
                          </p>
                        </div>

                        <div className="border-t border-slate-50 pt-4 space-y-4 opacity-60 pointer-events-none" aria-disabled="true">
                          {/* Toggle 1: Daily Trading Reminder */}
                          <div className="flex items-start justify-between p-3.5 bg-slate-50/70 rounded-xl border border-slate-100">
                            <div className="space-y-0.5 text-xs">
                              <strong className="text-slate-800 block">Daily Trading Reminder</strong>
                              <span className="text-[11px] text-slate-400 block">Get reminded to set targets, evaluate sentiment, and journal trades every morning.</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={dailyTradingReminder}
                              onChange={(e) => setDailyTradingReminder(e.target.checked)}
                              className="h-4.5 w-4.5 rounded border-slate-300 text-slate-900 focus:ring-slate-500 cursor-pointer"
                            />
                          </div>

                          {/* Toggle 2: Max Daily Loss Alert */}
                          <div className="flex items-start justify-between p-3.5 bg-slate-50/70 rounded-xl border border-slate-100">
                            <div className="space-y-0.5 text-xs">
                              <strong className="text-slate-800 block">Max Daily Loss Alert</strong>
                              <span className="text-[11px] text-slate-400 block">Be alerted when cumulative account losses approach your configured limits.</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={maxDailyLossAlert}
                              onChange={(e) => setMaxDailyLossAlert(e.target.checked)}
                              className="h-4.5 w-4.5 rounded border-slate-300 text-slate-900 focus:ring-slate-500 cursor-pointer"
                            />
                          </div>

                          {/* Toggle 3: Journal Completion Reminder */}
                          <div className="flex items-start justify-between p-3.5 bg-slate-50/70 rounded-xl border border-slate-100">
                            <div className="space-y-0.5 text-xs">
                              <strong className="text-slate-800 block">Journal Completion Reminder</strong>
                              <span className="text-[11px] text-slate-400 block">Prompt to log notes, upload charts, and tag your cognitive state before session close.</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={journalCompletionReminder}
                              onChange={(e) => setJournalCompletionReminder(e.target.checked)}
                              className="h-4.5 w-4.5 rounded border-slate-300 text-slate-900 focus:ring-slate-500 cursor-pointer"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end pt-2">
                          <button
                            type="submit"
                            disabled
                            className="bg-slate-900 text-white font-bold text-xs py-2.5 px-4 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Save Preferences
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Subscription sub-tab */}
                    {settingsTab === 'subscription' && user && (
                      <div className="space-y-5">

                        {/* Plan state comes from the billing API, not from a hardcoded
                      banner. The previous version advertised "full Pro at ₹0"
                      and its button POSTed isPro:true, which the server ignores
                      by design — so it claimed success and granted nothing. */}
                        {billingLoading ? (
                          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-white/[0.07] rounded-2xl p-6">
                            <div className="h-4 w-32 rounded bg-slate-100 dark:bg-white/[0.06] animate-pulse" />
                            <div className="h-8 w-48 rounded bg-slate-100 dark:bg-white/[0.06] animate-pulse mt-3" />
                          </div>
                        ) : (
                          <>
                            <div className={`relative overflow-hidden rounded-2xl p-6 border ${isProActive
                              ? 'border-violet-400/30 bg-gradient-to-br from-violet-500/20 via-indigo-500/10 to-transparent'
                              : 'border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.03]'
                              }`}>
                              <div className="flex items-start justify-between gap-4 flex-wrap">
                                <div>
                                  <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                    Current plan
                                  </span>
                                  <div className="flex items-baseline gap-2 mt-2">
                                    <h3 className="text-2xl font-black text-slate-900 dark:text-white font-display tracking-tight">
                                      {isProActive ? 'Pro' : 'Free'}
                                    </h3>
                                    {isProActive && (
                                      <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-400/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-300">
                                        <Star className="h-3 w-3" /> Active
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-md">
                                    {isProActive
                                      ? subscription?.cancelAtPeriodEnd
                                        ? `Cancelled. Pro stays active until ${renewalDate || 'the end of your paid period'}.`
                                        : renewalDate
                                          ? `Renews automatically on ${renewalDate}.`
                                          // No subscription row means Pro was bought
                                          // as a one-time 30-day order, so calling it
                                          // a "subscription" promises a renewal that
                                          // will not happen.
                                          : proUntilLabel
                                            ? `Pro is active until ${proUntilLabel}.`
                                            : 'Pro is active.'
                                      : 'One trading account, manual trade logging, full analytics, calendar, FX news, live charts and the calculators.'}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <div className="text-3xl font-black text-slate-900 dark:text-white font-display tracking-tight tabular-nums">
                                    {isProActive ? '₹499' : '₹0'}
                                  </div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400">
                                    {isProActive && !subscription?.id ? '/ 30 days' : '/month'}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Upgrade path for free users */}
                            {!isProActive && (
                              <div className="bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/[0.07] rounded-2xl p-6">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Upgrade to Pro</h4>
                                {/*
                                  There is nothing to cancel: checkout is a
                                  one-time order granting 30 days, not a
                                  subscription, so this promised a control that
                                  does not exist.
                                */}
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                  ₹499 for 30 days. One-time payment — it does not auto-renew, so nothing is charged again unless you choose to.
                                </p>

                                <ul className="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
                                  {[
                                    'Unlimited trading accounts',
                                    'MT5 automatic sync',
                                    'AI Mentor on your own history',
                                    'Export your full trade history',
                                    'Priority support',
                                  ].map((f) => (
                                    <li key={f} className="flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
                                      <Check className="h-4 w-4 text-violet-500 dark:text-violet-400 shrink-0" />
                                      {f}
                                    </li>
                                  ))}
                                </ul>

                                <button
                                  onClick={() => setShowProModal(true)}
                                  className="dx-upgrade mt-6 w-full font-bold text-sm rounded-xl py-3.5 flex items-center justify-center gap-2 cursor-pointer"
                                >
                                  <Sparkles className="h-4 w-4 text-amber-300 fill-amber-300" />
                                  <span>Upgrade to Pro — ₹499/month (UPI / Cards)</span>
                                </button>
                              </div>
                            )}

                            {/* Manage an active subscription — only when one exists.
                                The condition was `isProActive` alone, but Pro is
                                normally bought as a one-time 30-day order, which
                                creates no subscription row. So this card offered
                                "Cancelling stops the next charge" and a Cancel
                                button to users with nothing recurring: the server
                                answered 404 "No active subscription to cancel.",
                                which the client then displayed under the heading
                                "Subscription Cancelled". */}
                            {isProActive && subscription?.id && !subscription?.cancelAtPeriodEnd && (
                              <div className="bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/[0.07] rounded-2xl p-6">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Manage subscription</h4>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                  Cancelling stops the next charge. You keep Pro until {renewalDate || 'your paid period ends'}.
                                </p>
                                <button
                                  onClick={handleCancelSubscription}
                                  disabled={actionLoading}
                                  className="mt-4 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 transition disabled:opacity-50"
                                >
                                  Cancel subscription
                                </button>
                              </div>
                            )}

                            {/* One-time Pro: there is nothing to cancel, so say when
                                access ends and how to extend it. */}
                            {isProActive && !subscription?.id && (
                              <div className="bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/[0.07] rounded-2xl p-6">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white">Your Pro access</h4>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                  {proUntilLabel
                                    ? `Paid up to ${proUntilLabel}. Nothing renews automatically — buy another 30 days whenever you want to carry on.`
                                    : 'Bought as a one-time payment, so nothing renews automatically and there is nothing to cancel.'}
                                </p>
                              </div>
                            )}

                            {/* Payment history — previously kept only in memory, so it
                          vanished on restart. Now read from the payments table. */}
                            {billingPayments.length > 0 && (
                              <div className="bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/[0.07] rounded-2xl p-6">
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-4">Payment history</h4>
                                <div className="space-y-2.5">
                                  {billingPayments.map((pmt: any) => (
                                    <div key={pmt.id} className="flex items-center justify-between text-[13px] border-b border-slate-50 dark:border-white/[0.05] last:border-0 pb-2.5 last:pb-0">
                                      <div>
                                        <p className="font-semibold text-slate-800 dark:text-slate-200">{pmt.plan === 'pro' ? 'Pro' : pmt.plan} — monthly</p>
                                        <p className="text-[11px] text-slate-400 dark:text-slate-500">
                                          {pmt.paidAt ? new Date(pmt.paidAt).toLocaleDateString() : ''}
                                        </p>
                                      </div>
                                      <span className="font-bold text-slate-900 dark:text-white tabular-nums">
                                        {pmt.currency === 'INR' ? '₹' : '$'}{Number(pmt.amount).toFixed(2)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Account */}
                            <div className="bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/[0.07] rounded-2xl p-5">
                              <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Account</p>
                                  <p className="text-sm font-bold text-slate-900 dark:text-white mt-1 truncate">{user.name || user.email}</p>
                                  <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{user.email}</p>
                                </div>
                                <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg shrink-0 ${isProActive
                                  ? 'text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-400/12 border border-violet-100 dark:border-violet-400/25'
                                  : 'text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-white/[0.06] border border-slate-200 dark:border-white/10'
                                  }`}>
                                  {isProActive ? 'Pro' : 'Free'}
                                </span>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* About sub-tab */}
                    {settingsTab === 'about' && (
                      <div className="space-y-6">
                        {/* General App Info */}
                        <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-50 pb-4">
                            <div>
                              <h3 className="font-extrabold text-slate-900 text-base">About FX Journal Pro</h3>
                              <p className="text-xs text-slate-400">Application diagnostics and contact information.</p>
                            </div>
                            <span className="bg-slate-100 text-slate-800 font-mono text-xs font-bold px-3 py-1 rounded-full">
                              App Version 2.5.0
                            </span>
                          </div>
                        </div>

                        {/* Forms Grid for Contact, Report Bug, Feature Request */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                          {/* Contact */}
                          <div className="bg-white border border-slate-100 rounded-xl p-5 shadow-xs transition-all duration-300 flex flex-col justify-between min-h-[160px] hover:border-slate-300">
                            <div className="space-y-3 w-full">
                              <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                  <strong className="text-sm font-black text-slate-900 block">Contact</strong>
                                  <p className="text-[11px] text-slate-400">Reach our support team directly by email.</p>
                                </div>
                                <div className="p-2 rounded-lg bg-slate-50 text-slate-500 shrink-0">
                                  <HelpCircle className="h-4 w-4" />
                                </div>
                              </div>
                              <a
                                href="mailto:contact@fxjournalpro.com"
                                className="text-xs font-bold text-slate-900 dark:text-slate-100 hover:text-violet-600 dark:hover:text-violet-400 hover:underline inline-flex items-center gap-1.5 break-all"
                              >
                                contact@fxjournalpro.com <Mail className="h-3 w-3 shrink-0" />
                              </a>
                            </div>
                          </div>

                          {/* Report a Bug */}
                          <div
                            className={`bg-white border rounded-xl p-5 shadow-xs transition-all duration-300 flex flex-col justify-between min-h-[160px] ${activeAboutForm === 'bug'
                              ? 'border-slate-900 ring-1 ring-slate-900 md:col-span-1'
                              : 'border-slate-100 hover:border-slate-300 cursor-pointer'
                              }`}
                            onClick={() => {
                              if (activeAboutForm !== 'bug') {
                                setActiveAboutForm('bug');
                              }
                            }}
                          >
                            <div className="space-y-3 w-full">
                              <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                  <strong className="text-sm font-black text-slate-900 block">Report a Bug</strong>
                                  <p className="text-[11px] text-slate-400">Notice a glitch? Help us refine and stabilize your workspace.</p>
                                </div>
                                <div className={`p-2 rounded-lg shrink-0 ${activeAboutForm === 'bug' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500'}`}>
                                  <AlertTriangle className="h-4 w-4" />
                                </div>
                              </div>

                              {activeAboutForm === 'bug' ? (
                                <form onSubmit={handleReportBug} className="space-y-3 pt-2 text-xs border-t border-slate-100 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                                  <div>
                                    <label className="font-semibold text-slate-600 block mb-0.5">Bug Title</label>
                                    <input
                                      type="text"
                                      required
                                      value={bugTitle}
                                      onChange={(e) => setBugTitle(e.target.value)}
                                      placeholder="e.g. Chart does not load"
                                      className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 w-full font-semibold focus:outline-hidden focus:ring-1 focus:ring-slate-900"
                                    />
                                  </div>
                                  <div>
                                    <label className="font-semibold text-slate-600 block mb-0.5">Severity</label>
                                    <select
                                      value={bugSeverity}
                                      onChange={(e) => setBugSeverity(e.target.value)}
                                      className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 w-full font-semibold focus:outline-hidden focus:ring-1 focus:ring-slate-900"
                                    >
                                      <option value="Low">Low</option>
                                      <option value="Medium">Medium</option>
                                      <option value="High">High</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="font-semibold text-slate-600 block mb-0.5">Steps to Reproduce</label>
                                    <textarea
                                      required
                                      rows={2}
                                      value={bugSteps}
                                      onChange={(e) => setBugSteps(e.target.value)}
                                      placeholder="1. Go to tab... 2. Click..."
                                      className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 w-full font-semibold focus:outline-hidden focus:ring-1 focus:ring-slate-900"
                                    />
                                  </div>
                                  <div className="flex gap-2 pt-2">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveAboutForm('none');
                                      }}
                                      className="w-1/3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs py-2 rounded-lg transition text-center"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="submit"
                                      disabled={actionLoading}
                                      className="w-2/3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 rounded-lg transition text-center"
                                    >
                                      {actionLoading ? 'Submitting...' : 'Submit Bug'}
                                    </button>
                                  </div>
                                </form>
                              ) : (
                                <div className="pt-2">
                                  <button
                                    type="button"
                                    className="text-xs font-bold text-slate-900 hover:underline flex items-center gap-1 mt-1"
                                  >
                                    Report Glitch <ChevronRight className="h-3 w-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Feature Request */}
                          <div
                            className={`bg-white border rounded-xl p-5 shadow-xs transition-all duration-300 flex flex-col justify-between min-h-[160px] ${activeAboutForm === 'feature'
                              ? 'border-slate-900 ring-1 ring-slate-900 md:col-span-1'
                              : 'border-slate-100 hover:border-slate-300 cursor-pointer'
                              }`}
                            onClick={() => {
                              if (activeAboutForm !== 'feature') {
                                setActiveAboutForm('feature');
                              }
                            }}
                          >
                            <div className="space-y-3 w-full">
                              <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                  <strong className="text-sm font-black text-slate-900 block">Feature Request</strong>
                                  <p className="text-[11px] text-slate-400">Suggest new analytical features, tools, or sync capabilities.</p>
                                </div>
                                <div className={`p-2 rounded-lg shrink-0 ${activeAboutForm === 'feature' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500'}`}>
                                  <Sparkles className="h-4 w-4" />
                                </div>
                              </div>

                              {activeAboutForm === 'feature' ? (
                                <form onSubmit={handleFeatureRequest} className="space-y-3 pt-2 text-xs border-t border-slate-100 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                                  <div>
                                    <label className="font-semibold text-slate-600 block mb-0.5">Feature Title</label>
                                    <input
                                      type="text"
                                      required
                                      value={featureRequestTitle}
                                      onChange={(e) => setFeatureRequestTitle(e.target.value)}
                                      placeholder="e.g. Discord exports"
                                      className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 w-full font-semibold focus:outline-hidden focus:ring-1 focus:ring-slate-900"
                                    />
                                  </div>
                                  <div>
                                    <label className="font-semibold text-slate-600 block mb-0.5">Description</label>
                                    <textarea
                                      required
                                      rows={3}
                                      value={featureRequestDesc}
                                      onChange={(e) => setFeatureRequestDesc(e.target.value)}
                                      placeholder="What would you like to see?"
                                      className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2 w-full font-semibold focus:outline-hidden focus:ring-1 focus:ring-slate-900"
                                    />
                                  </div>
                                  <div className="flex gap-2 pt-2">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveAboutForm('none');
                                      }}
                                      className="w-1/3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs py-2 rounded-lg transition text-center"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="submit"
                                      disabled={actionLoading}
                                      className="w-2/3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 rounded-lg transition text-center"
                                    >
                                      {actionLoading ? 'Submitting...' : 'Submit Idea'}
                                    </button>
                                  </div>
                                </form>
                              ) : (
                                <div className="pt-2">
                                  <button
                                    type="button"
                                    className="text-xs font-bold text-slate-900 hover:underline flex items-center gap-1 mt-1"
                                  >
                                    Suggest Feature <ChevronRight className="h-3 w-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                        </div>
                      </div>
                    )}

                    {/* Help Sub-tab */}
                    {settingsTab === 'help' && (
                      <div className="space-y-6">
                        <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-50 pb-4">
                            <div>
                              <h3 className="font-extrabold text-slate-900 text-base">Help &amp; Getting Started</h3>
                              <p className="text-xs text-slate-400">Guides, tips, and onboarding tools.</p>
                            </div>
                            <span className="bg-slate-100 text-slate-800 font-mono text-xs font-bold px-3 py-1 rounded-full">
                              Support Center
                            </span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-500/10 dark:to-blue-500/5 border border-indigo-100 dark:border-indigo-500/20 rounded-xl p-5 space-y-3">
                              <div className="h-10 w-10 rounded-xl bg-indigo-500 text-white flex items-center justify-center">
                                <Compass className="h-5 w-5" />
                              </div>
                              <div>
                                <strong className="text-sm font-black text-slate-900 dark:text-white block">Restart Onboarding</strong>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                                  Replay the guided tour that walks you through creating a portfolio and logging your first trade.
                                </p>
                              </div>
                              <button
                                onClick={startGuidedTour}
                                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2.5 px-3 rounded-lg transition flex items-center justify-center gap-1.5"
                              >
                                <RefreshCw className="h-3.5 w-3.5" /> Restart Onboarding
                              </button>
                            </div>

                            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-500/10 dark:to-teal-500/5 border border-emerald-100 dark:border-emerald-500/20 rounded-xl p-5 space-y-3">
                              <div className="h-10 w-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center">
                                <BookOpen className="h-5 w-5" />
                              </div>
                              <div>
                                <strong className="text-sm font-black text-slate-900 dark:text-white block">Getting Started Tips</strong>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                                  Create a portfolio first, then log trades manually or paste them in from your MT5/MT4 terminal report.
                                </p>
                              </div>
                            </div>

                          </div>
                        </div>
                      </div>
                    )}

                    {/* Configure Guard Limits Sub-tab */}
                    {settingsTab === 'risk' && (
                      <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs space-y-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
                              <Shield className="h-5 w-5 text-indigo-500" />
                              Configure Portfolio Guard Limits
                            </h3>
                            <p className="text-xs text-slate-400">Establish drawdown, loss, and overtrading limits to protect your capital and maintain strict discipline.</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleTogglePortfolioGuard(!isPortfolioGuardOn)}
                            className="flex items-center gap-2 cursor-pointer group hover:opacity-90 transition p-1 rounded-lg"
                            title={isPortfolioGuardOn ? 'Turn Portfolio Guard OFF' : 'Turn Portfolio Guard ON'}
                          >
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${isPortfolioGuardOn ? 'text-emerald-600' : 'text-slate-400'}`}>
                              {isPortfolioGuardOn ? 'ON' : 'OFF'}
                            </span>
                            <div
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${isPortfolioGuardOn ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                                }`}
                              role="switch"
                              aria-checked={isPortfolioGuardOn}
                            >
                              <span
                                aria-hidden="true"
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${isPortfolioGuardOn ? 'translate-x-4' : 'translate-x-0'
                                  }`}
                              />
                            </div>
                          </button>
                        </div>

                        {accounts.length > 0 && (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200/60 dark:border-slate-800 text-xs shadow-xs">
                            <div>
                              <span className="font-bold text-slate-800 dark:text-slate-200 block">Configure Portfolio:</span>
                              <span className="text-[10px] text-slate-400">Select which trading account these guard limits apply to.</span>
                            </div>
                            <select
                              value={selectedAccountId || ''}
                              onChange={(e) => {
                                const accId = e.target.value;
                                setSelectedAccountId(accId);
                                fetchTradesAndParams(accId);
                              }}
                              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 font-bold text-slate-700 dark:text-slate-200 text-xs min-w-[200px] focus:ring-slate-500 focus:border-slate-500 shadow-xs"
                            >
                              {accounts.map((acc) => (
                                <option key={acc.id} value={acc.id}>
                                  {acc.name} ({acc.broker} - {acc.accountType})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        <form onSubmit={handleSaveRiskSettings} className="space-y-6 border-t border-slate-50 dark:border-slate-800/50 pt-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">

                            {/* Daily Loss Guard */}
                            <div className="space-y-1.5 p-4 bg-white dark:bg-slate-800/20 rounded-xl border border-slate-200/60 dark:border-slate-800 shadow-xs">
                              <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                Daily Loss Guard Limit ($)
                              </label>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500">Shut down new positions when daily cumulative losses breach this currency amount.</p>
                              <input
                                type="number"
                                required
                                value={riskSettings?.dailyLossLimit ?? 500}
                                onChange={(e) => updateRiskSettingField('dailyLossLimit', parseFloat(e.target.value) || 0)}
                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs rounded-lg p-2.5 w-full font-semibold focus:ring-slate-500 focus:border-slate-500 mt-2 text-slate-800 dark:text-slate-100 shadow-xs"
                              />
                            </div>

                            {/* Overtrading Scanner */}
                            <div className="space-y-1.5 p-4 bg-white dark:bg-slate-800/20 rounded-xl border border-slate-200/60 dark:border-slate-800 shadow-xs">
                              <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                Overtrading Max Daily Trades
                              </label>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500">Maximum allowed positions/trades per day before triggers lock or fire alerts.</p>
                              <input
                                type="number"
                                required
                                value={riskSettings?.maxTradesPerDay ?? 5}
                                onChange={(e) => updateRiskSettingField('maxTradesPerDay', parseInt(e.target.value) || 0)}
                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs rounded-lg p-2.5 w-full font-semibold focus:ring-slate-500 focus:border-slate-500 mt-2 text-slate-800 dark:text-slate-100 shadow-xs"
                              />
                            </div>

                            {/* Weekly Loss Limit */}
                            <div className="space-y-1.5 p-4 bg-white dark:bg-slate-800/20 rounded-xl border border-slate-200/60 dark:border-slate-800 shadow-xs">
                              <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                Weekly Loss Limit ($)
                              </label>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500">Aggregate drawdown cap across a 5-day cycle before system warnings.</p>
                              <input
                                type="number"
                                required
                                value={riskSettings?.weeklyLossLimit ?? 1500}
                                onChange={(e) => updateRiskSettingField('weeklyLossLimit', parseFloat(e.target.value) || 0)}
                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs rounded-lg p-2.5 w-full font-semibold focus:ring-slate-500 focus:border-slate-500 mt-2 text-slate-800 dark:text-slate-100 shadow-xs"
                              />
                            </div>

                            {/* Max Drawdown Limit */}
                            <div className="space-y-1.5 p-4 bg-white dark:bg-slate-800/20 rounded-xl border border-slate-200/60 dark:border-slate-800 shadow-xs">
                              <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                Max Drawdown Limit (%)
                              </label>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500">Critical percentage limit representing allowable high-to-low account equity dip.</p>
                              <input
                                type="number"
                                step="0.1"
                                required
                                value={riskSettings?.maxDrawdownLimit ?? 10.0}
                                onChange={(e) => updateRiskSettingField('maxDrawdownLimit', parseFloat(e.target.value) || 0)}
                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs rounded-lg p-2.5 w-full font-semibold focus:ring-slate-500 focus:border-slate-500 mt-2 text-slate-800 dark:text-slate-100 shadow-xs"
                              />
                            </div>

                            {/* Risk Per Trade Cap */}
                            <div className="space-y-1.5 p-4 bg-white dark:bg-slate-800/20 rounded-xl border border-slate-200/60 dark:border-slate-800 shadow-xs">
                              <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                Risk-Per-Trade Cap (%)
                              </label>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500">Ceiling for risk percentage per single entry based on stop-loss distance.</p>
                              <input
                                type="number"
                                step="0.1"
                                required
                                value={riskSettings?.riskPerTradeLimit ?? 2.0}
                                onChange={(e) => updateRiskSettingField('riskPerTradeLimit', parseFloat(e.target.value) || 0)}
                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs rounded-lg p-2.5 w-full font-semibold focus:ring-slate-500 focus:border-slate-500 mt-2 text-slate-800 dark:text-slate-100 shadow-xs"
                              />
                            </div>

                            {/* Discipline Protection Mode */}
                            <div className="space-y-1.5 p-4 bg-white dark:bg-slate-800/20 rounded-xl border border-slate-200/60 dark:border-slate-800 flex flex-col justify-between shadow-xs">
                              <div>
                                <label className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                  Discipline Protection Mode
                                </label>
                                <p className="text-[10px] text-slate-400 dark:text-slate-500">When enabled, exceeding any guard limits will block manual log inputs or sync permissions.</p>
                              </div>
                              <div className="flex items-center gap-3 mt-3">
                                <input
                                  type="checkbox"
                                  id="disciplineEnabled"
                                  checked={isPortfolioGuardOn}
                                  onChange={(e) => handleTogglePortfolioGuard(e.target.checked)}
                                  className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                                <label htmlFor="disciplineEnabled" className="font-bold text-slate-800 dark:text-slate-200 cursor-pointer select-none">
                                  Enable Strict Lockdown
                                </label>
                              </div>
                            </div>

                          </div>

                          <div className="flex justify-end pt-4 border-t border-slate-50 dark:border-slate-800">
                            <button
                              type="submit"
                              disabled={actionLoading}
                              className="bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 dark:text-slate-900 disabled:bg-slate-300 text-white font-bold text-xs py-2.5 px-6 rounded-lg transition shadow-xs flex items-center gap-2"
                            >
                              {actionLoading ? 'Saving Rules...' : 'Save Guard Limits'}
                            </button>
                          </div>
                        </form>
                      </div>
                    )}

                    {/* Theme sub-tab */}
                    {settingsTab === 'theme' && (
                      <div className="bg-white border border-slate-100 rounded-xl p-6 shadow-xs space-y-6">
                        <div>
                          <h3 className="font-extrabold text-slate-900 text-base">App Theme</h3>
                          <p className="text-xs text-slate-400">Choose between light and dark visual themes for your entire trading workspace.</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-50 pt-6">
                          {/* Light Mode Card */}
                          <button
                            onClick={() => setTheme('light')}
                            className={`p-5 rounded-xl border text-left transition relative flex flex-col justify-between h-32 ${theme === 'light'
                              ? 'border-slate-950 bg-slate-50 ring-1 ring-slate-950'
                              : 'border-slate-100 bg-white hover:border-slate-200'
                              }`}
                          >
                            <div className="flex items-center justify-between w-full">
                              <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                                <Sun className="h-5 w-5" />
                              </div>
                              {theme === 'light' && (
                                <span className="bg-slate-900 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Active</span>
                              )}
                            </div>
                            <div>
                              <span className="font-extrabold text-slate-900 text-sm block">Light Mode</span>
                              <span className="text-[11px] text-slate-400 block mt-1">Clean, high-contrast crisp display ideal for daytime journaling.</span>
                            </div>
                          </button>

                          {/* Dark Mode Card */}
                          <button
                            onClick={() => setTheme('dark')}
                            className={`p-5 rounded-xl border text-left transition relative flex flex-col justify-between h-32 ${theme === 'dark'
                              ? 'border-indigo-600 bg-slate-900 ring-1 ring-indigo-600'
                              : 'border-slate-100 bg-white hover:border-slate-200'
                              }`}
                          >
                            <div className="flex items-center justify-between w-full">
                              <div className="p-2 bg-indigo-950 text-indigo-400 rounded-lg">
                                <Moon className="h-5 w-5" />
                              </div>
                              {theme === 'dark' && (
                                <span className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Active</span>
                              )}
                            </div>
                            <div>
                              <span className="font-extrabold text-slate-900 text-sm block">Dark Mode</span>
                              <span className="text-[11px] text-slate-400 block mt-1">Sleek, low-fatigue dark display designed for late-night review.</span>
                            </div>
                          </button>
                        </div>
                      </div>
                    )}

                  </div>
                </div>
                <div className="mt-8 border-t border-slate-200 dark:border-slate-800 pt-8">
                  <LegalFooter />
                </div>
              </div>
            )}

            {/* 5. MT5 AUTOMATION VIEW */}
            {/* MT5 sync is a Pro feature and the server refuses to create a synced


          {/* 6. AI CO-PILOT INSIGHTS VIEW */}
            {activeTab === 'insights' && activeAccount && user && (
              <AIInsights
                user={user}
                account={activeAccount}
                onUpgradeToPro={goToSubscriptionSettings}
              />
            )}

            {/* 7. ADMIN PANEL VIEW */}
            {activeTab === 'admin' && (
              <AdminPanel
                role={adminRole}
                onPublishAnnouncement={fetchAccountData}
                onInspectUser={handleInspectUser}
              />
            )}

            {/* 8. TOOLS VIEW */}
            {activeTab === 'tools' && (
              <TradingTools />
            )}

            {/* 9. PARTNER PORTAL — referral network, read-only */}
            {activeTab === 'partner' && isPartner && (
              <PartnerPortal />
            )}

            {/* 10. NOTEBOOK VIEW */}
            {activeTab === 'notebook' && (
              <NotebookTab user={user} account={activeAccount} />
            )}



          </React.Suspense>
        </main>
      </div>

      {/* ============================================================
          MOBILE BOTTOM NAVIGATION — Premium 5-Tab App Style
          ============================================================ */}
      {(() => {
        const primaryTabs = [
          { id: 'dashboard', icon: BarChart3, label: 'Home' },
          { id: 'journal', icon: BookOpen, label: 'Journal', badge: filteredTrades.length > 0 ? filteredTrades.length : undefined },
          { id: 'analytics', icon: Activity, label: 'Analytics' },
          { id: 'fxnews', icon: Globe, label: 'News' },
          { id: 'more', icon: MoreHorizontal, label: 'More' },
        ];
        // The role consoles are appended rather than listed inline: the desktop
        // sidebar is `hidden md:flex`, so without an entry here a partner or an
        // admin on a phone could not open their own console from anywhere.
        const moreTabs = [
          { id: 'notebook', icon: Edit3, label: 'Notebook' },
          { id: 'accounts', icon: Layers, label: 'Accounts', badge: accounts.length > 0 ? accounts.length : undefined },
          { id: 'calendar', icon: Calendar, label: 'Calendar' },
          { id: 'chart', icon: LineChart, label: 'Live Chart' },
          { id: 'tools', icon: Wrench, label: 'Tools' },
          { id: 'insights', icon: Brain, label: 'Heyza' },
          { id: 'settings', icon: Settings, label: 'Settings' },
          ...(isPartner ? [{ id: 'partner', icon: Users, label: 'Partner Portal' }] : []),
          ...(isAdmin && !isPartner ? [{ id: 'admin', icon: Shield, label: 'Admin Panel' }] : []),
        ];
        const isMoreActive = moreTabs.some(t => t.id === activeTab);
        return (
          <>
            {/* More Drawer (bottom sheet) */}
            {showMobileMore && (
              <>
                {/* Backdrop */}
                <div
                  className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-[58] animate-in fade-in duration-200"
                  onClick={() => setShowMobileMore(false)}
                />
                {/* Sheet.
                    A real bottom sheet now: anchored to the screen edge with a
                    drag handle, rather than a floating rounded box hovering
                    above the tab bar.

                    Rows, not a four-column grid. Seven items in four columns
                    left a hole in the second row that the floating action
                    button sat in, and the labels had to shrink to 10px to fit
                    a quarter of a phone. A row gives each item its full name,
                    room for an icon chip, and somewhere to put the badge. */}
                <div className="md:hidden fixed inset-x-0 bottom-0 z-[59] bg-white dark:bg-[#0b0b13] rounded-t-3xl shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.85)] border-t border-x border-slate-200/60 dark:border-white/10 animate-in slide-in-from-bottom duration-300">

                  <div className="flex justify-center pt-2.5 pb-1">
                    <span className="h-1 w-9 rounded-full bg-slate-300 dark:bg-white/15" aria-hidden="true" />
                  </div>

                  <div className="flex items-center justify-between px-5 pt-2 pb-3">
                    <h3 className="font-bold text-base text-slate-900 dark:text-white font-display">More</h3>
                    <button
                      onClick={() => setShowMobileMore(false)}
                      aria-label="Close"
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.07] text-slate-500 dark:text-slate-400 active:scale-90 transition"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="px-3 max-h-[58vh] overflow-y-auto [padding-bottom:calc(58px+env(safe-area-inset-bottom,0px))]">
                    {moreTabs.map(item => {
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => { setActiveTab(item.id as any); setShowMobileMore(false); setIsScrolled(false); }}
                          className={`w-full flex items-center gap-3.5 px-3 py-3 rounded-2xl transition-colors active:scale-[0.99] ${isActive
                              ? 'bg-violet-50 dark:bg-violet-500/[0.14]'
                              : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                            }`}
                        >
                          <span
                            className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${isActive
                                ? 'bg-violet-500/20 text-violet-600 dark:bg-violet-500/25 dark:text-violet-300'
                                : 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400'
                              }`}
                          >
                            <item.icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.4 : 1.9} />
                          </span>

                          <span className={`flex-1 text-left text-sm font-bold ${isActive
                              ? 'text-violet-700 dark:text-violet-200'
                              : 'text-slate-700 dark:text-slate-200'
                            }`}>
                            {item.label}
                          </span>

                          {item.badge !== undefined && (
                            <span className="dx-badge text-[10px] px-1.5 min-w-[20px] h-5 rounded-full flex items-center justify-center shrink-0">
                              {item.badge > 99 ? '99+' : item.badge}
                            </span>
                          )}

                          <ChevronRight className={`h-4 w-4 shrink-0 ${isActive ? 'text-violet-500/70' : 'text-slate-300 dark:text-slate-600'
                            }`} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Bottom Tab Bar */}
            <div className={`md:hidden fixed bottom-0 left-0 right-0 z-[60] transition-all duration-300 ease-in-out ${(showTradeModal || showAccountModal || showEditAccountModal || showTicketModal || showExportModal || showPasteModal || showSignOutModal || deleteConfirmTradeId !== null || showGuidedTour)
              ? 'translate-y-full opacity-0 pointer-events-none'
              : 'translate-y-0 opacity-100'
              }`}>
              {/* Gradient fade above nav */}
              <div className="h-6 bg-gradient-to-t from-[#FBFBFA] dark:from-slate-950 to-transparent pointer-events-none" />
              <div className="bg-white/95 dark:bg-[#07070d]/95 backdrop-blur-2xl border-t border-slate-200/70 dark:border-white/[0.07] px-1.5 pb-safe">
                <nav className="flex items-stretch justify-around h-[62px]">
                  {primaryTabs.map(item => {
                    const isActive = item.id === 'more' ? isMoreActive || showMobileMore : activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          if (item.id === 'more') {
                            setShowMobileMore(!showMobileMore);
                          } else {
                            setActiveTab(item.id as any);
                            setIsScrolled(false);
                            setShowMobileMore(false);
                          }
                        }}
                        aria-current={isActive ? 'page' : undefined}
                        className="flex-1 flex flex-col items-center justify-center gap-1 relative transition-transform duration-200 active:scale-95"
                      >
                        {/* The active item sits in a filled pill.
                            It used to be marked by a 4px dot floating above the
                            icon, which on the "More" tab landed over the three
                            dots of its own glyph and read as a rendering fault.
                            A pill behind the icon is unambiguous and gives the
                            current section real weight. */}
                        <span
                          className={`relative flex items-center justify-center h-7 w-[52px] rounded-full transition-all duration-300 ${isActive
                              ? 'bg-violet-100 dark:bg-violet-500/20 shadow-[0_0_18px_-6px_rgba(139,92,246,0.9)]'
                              : 'bg-transparent'
                            }`}
                        >
                          <item.icon
                            className={`h-[21px] w-[21px] transition-colors duration-200 ${isActive
                                ? 'text-violet-700 dark:text-violet-300'
                                : 'text-slate-600 dark:text-slate-400'
                              }`}
                            strokeWidth={isActive ? 2.4 : 1.8}
                          />
                          {item.badge !== undefined && (
                            <span className="dx-badge absolute top-0 right-1.5 -translate-y-1/3 text-[9px] leading-none px-1 py-[3px] rounded-full ring-2 ring-white dark:ring-[#07070d] min-w-[16px] flex items-center justify-center">
                              {item.badge > 99 ? '99+' : item.badge}
                            </span>
                          )}
                        </span>

                        {/* slate-600/slate-400, not slate-400/slate-500: at 10px
                            slate-400 on the light nav bar measured 2.56:1, well
                            under the 4.5 minimum, and the icon beside it failed
                            even the 3:1 needed for a non-text graphic. */}
                        <span className={`text-[10px] leading-none transition-colors duration-200 ${isActive
                            ? 'font-bold text-violet-700 dark:text-violet-300'
                            : 'font-semibold text-slate-600 dark:text-slate-400'
                          }`}>
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </nav>
              </div>
            </div>

            {/* Floating Action Button (FAB) — Add Trade on mobile */}
            {/* Hidden while the More sheet is open — the button floated on top
                of the menu and covered one of its rows. */}
            {ADD_TRADE_TABS.has(activeTab) && !showTradeModal && !showAccountModal && !showMobileMore && (
              <button
                onClick={() => {
                  if (isMentorReadOnlyMode) { alert('Adding trades is disabled in Mentor Read-Only Mode.'); return; }
                  if (accounts.length === 0) { alert('Connect a portfolio account first.'); return; }
                  handleOpenTradeModal();
                }}
                disabled={isMentorReadOnlyMode}
                className="md:hidden fixed right-4 bottom-[100px] z-[59] h-14 w-14 rounded-full bg-gradient-to-br from-violet-500 to-violet-700 text-white shadow-[0_8px_28px_rgba(109,40,217,0.55)] flex items-center justify-center transition-all duration-200 active:scale-90 hover:brightness-110 disabled:opacity-50 border border-violet-400/40"
                aria-label="Add new trade"
              >
                <Plus className="h-7 w-7" strokeWidth={2.5} />
              </button>
            )}
          </>
        );
      })()}

      {/* ==========================================
          SYSTEM MODALS (CREATE ACCOUNT, ADD TRADE, ETC.)
         ========================================== */}

      {/* Edit Account Modal */}
      {showEditAccountModal && editingAccount && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[70] animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-100 max-w-md w-full p-6 relative">
            <button
              onClick={() => {
                setShowEditAccountModal(false);
                setEditingAccount(null);
              }}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 transition"
            >
              ✖
            </button>
            <form onSubmit={handleEditAccount} className="space-y-4">
              <div>
                <h3 className="font-extrabold text-slate-900 text-base">Edit Trading Portfolio</h3>
                <p className="text-[11px] text-slate-400">Modify the alias name and starting capital for {editingAccount.broker}.</p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Account Alias / Name</label>
                <input
                  type="text"
                  required
                  value={editAccName}
                  onChange={(e) => setEditAccName(e.target.value)}
                  placeholder="Primary Live Scalper"
                  className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full font-semibold focus:ring-slate-500 focus:border-slate-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Starting Capital / Balance</label>
                <input
                  type="number"
                  required
                  value={editAccStartingBalance}
                  onChange={(e) => setEditAccStartingBalance(e.target.value)}
                  placeholder="10000"
                  className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full font-semibold focus:ring-slate-500 focus:border-slate-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Account Currency</label>
                <select
                  value={editAccCurrency}
                  onChange={(e) => setEditAccCurrency(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full font-semibold focus:ring-slate-500 focus:border-slate-500"
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="INR">INR (₹)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="JPY">JPY (¥)</option>
                  <option value="AUD">AUD ($)</option>
                  <option value="CAD">CAD ($)</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 mt-2">
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={actionLoading}
                  className="bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-950/40 dark:hover:bg-red-900/50 dark:text-red-400 font-bold text-xs rounded-lg py-2.5 px-3 transition flex items-center gap-1.5 disabled:opacity-50 border border-red-200 dark:border-red-900/50"
                  title="Delete Portfolio Account"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditAccountModal(false);
                      setEditingAccount(null);
                    }}
                    className="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-lg py-2.5 px-3.5 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="bg-slate-900 hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500 text-white font-bold text-xs rounded-lg py-2.5 px-4 transition disabled:opacity-50"
                  >
                    {actionLoading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* A. Account Creation Modal */}
      {showAccountModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" style={{ zIndex: 9999 }}>
          <div className="bg-white rounded-xl shadow-2xl border border-slate-100 max-w-md w-full p-6 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => {
                setShowAccountModal(false);
                setNewAccMt5Login('');
                setNewAccMt5Server('');
                setNewAccMt5InvestorPassword('');
                setShowInvestorPassword(false);
              }}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 z-10"
            >
              ✖
            </button>

            {accountCreationMethod === 'select' && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Connect New Portfolio Account</h3>
                  <p className="text-[11px] text-slate-400">Choose how you want to connect and log trades.</p>
                </div>
                <div className="grid gap-3">
                  <button onClick={() => setAccountCreationMethod('manual')} className="border-2 border-slate-100 hover:border-slate-300 hover:bg-slate-50 rounded-xl p-4 text-left transition flex gap-3 items-center">
                    <div className="bg-slate-100 p-2 rounded-lg text-slate-600"><Edit3 className="w-5 h-5" /></div>
                    <div>
                      <div className="font-bold text-slate-800 text-sm">Manual Account Opening</div>
                      <div className="text-[11px] text-slate-500">Create an empty portfolio to manually log your trades one-by-one.</div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setAccountCreationMethod('mt5');
                      setNewAccName('');
                      setNewAccBroker('');
                      setNewAccMt5Login('');
                      setNewAccMt5Server('');
                      setNewAccMt5InvestorPassword('');
                      setShowInvestorPassword(false);
                      setNewAccInstitutionType('Broker');
                    }}
                    className="border-2 border-slate-100 hover:border-slate-300 hover:bg-slate-50 rounded-xl p-4 text-left transition flex gap-3 items-center"
                  >
                    <div className="bg-violet-100 dark:bg-violet-500/15 p-2 rounded-lg text-violet-600 dark:text-violet-300"><Terminal className="w-5 h-5" /></div>
                    <div>
                      <div className="font-bold text-slate-800 text-sm">MT5 Sync Account</div>
                      <div className="text-[11px] text-slate-500">Connect directly using MT5 Login, Server, and Investor (read-only) Password.</div>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {accountCreationMethod === 'manual' && (
              <form onSubmit={handleCreateAccount} className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <button type="button" onClick={() => setAccountCreationMethod('select')} className="text-slate-400 hover:text-slate-700 text-xs font-semibold">← Back</button>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Register Manual Portfolio</h3>
                  <p className="text-[11px] text-slate-400">Configure parameters to manually log your trades.</p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Account Alias / Name</label>
                  <input
                    type="text"
                    required
                    value={newAccName}
                    onChange={(e) => setNewAccName(e.target.value)}
                    placeholder="Primary Live Scalper"
                    className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Broker Name</label>
                  <input
                    type="text"
                    required
                    value={newAccBroker}
                    onChange={(e) => setNewAccBroker(e.target.value)}
                    placeholder="IC Markets"
                    className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">Trading Platform</label>
                    <select
                      value={newAccPlatform}
                      onChange={(e: any) => setNewAccPlatform(e.target.value)}
                      className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full"
                    >
                      <option value="MT5">MetaTrader 5 (MT5)</option>
                      <option value="MT4">MetaTrader 4 (MT4)</option>
                      <option value="cTrader">cTrader</option>
                      <option value="DXtrade">DXtrade</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">Account Type</label>
                    <select
                      value={newAccType}
                      onChange={(e: any) => setNewAccType(e.target.value)}
                      className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full"
                    >
                      <option value="Live">Live Portfolio</option>
                      <option value="Demo">Demo Practice</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">Base Currency</label>
                    <select
                      value={newAccCurrency}
                      onChange={(e) => setNewAccCurrency(e.target.value)}
                      className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full"
                    >
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="INR">INR (₹)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="JPY">JPY (¥)</option>
                      <option value="AUD">AUD ($)</option>
                      <option value="CAD">CAD ($)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">Starting Balance</label>
                    <input
                      type="number"
                      required
                      value={newAccBalance}
                      onChange={(e) => setNewAccBalance(e.target.value)}
                      className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={actionLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg py-2.5 px-4 transition disabled:opacity-50"
                >
                  {actionLoading ? 'Provisioning Account...' : 'Create Portfolio Account'}
                </button>
              </form>
            )}

            {accountCreationMethod === 'mt5' && (
              <div className="space-y-4" onKeyDown={(e) => { if (e.key === 'Enter') handleCreateAccount(e); }}>
                <div className="flex items-center gap-2 mb-2">
                  <button type="button" onClick={() => setAccountCreationMethod('select')} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs font-semibold">← Back</button>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">Connect MT5 Account (Investor Password)</h3>
                  <p className="text-[11px] text-slate-400">
                    Enter your MT5 login, server, and Investor (read-only) password to sync your trades directly.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Account Name</label>
                  <input
                    type="text"
                    required
                    value={newAccName}
                    onChange={(e) => setNewAccName(e.target.value)}
                    placeholder="e.g. Primary Live Scalper"
                    className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg p-2.5 w-full focus:ring-violet-500 focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">Account Category</label>
                  <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-900/80 rounded-lg border border-slate-200 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setNewAccInstitutionType('Broker')}
                      className={`py-1.5 text-xs font-semibold rounded-md transition-all ${
                        newAccInstitutionType === 'Broker'
                          ? 'bg-white dark:bg-slate-800 text-violet-600 dark:text-violet-300 shadow-xs'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      Broker
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewAccInstitutionType('Prop Firm')}
                      className={`py-1.5 text-xs font-semibold rounded-md transition-all ${
                        newAccInstitutionType === 'Prop Firm'
                          ? 'bg-white dark:bg-slate-800 text-violet-600 dark:text-violet-300 shadow-xs'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      Prop Firm
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                      {newAccInstitutionType === 'Prop Firm' ? 'Prop Firm Name' : 'Broker Name'}
                    </label>
                    <input
                      type="text"
                      required
                      value={newAccBroker}
                      onChange={(e) => setNewAccBroker(e.target.value)}
                      placeholder={newAccInstitutionType === 'Prop Firm' ? 'e.g. FTMO, FundedNext, The5ers' : 'e.g. IC Markets, Exness'}
                      className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg p-2.5 w-full focus:ring-violet-500 focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">MT5 Server</label>
                    <input
                      type="text"
                      required
                      value={newAccMt5Server}
                      onChange={(e) => setNewAccMt5Server(e.target.value)}
                      placeholder="e.g. ICMarketsSC-Live01"
                      className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg p-2.5 w-full focus:ring-violet-500 focus:border-violet-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">MT5 Login ID (Account Number)</label>
                  <input
                    type="text"
                    name="mt5_account_num_field"
                    id="mt5_account_num_field"
                    required
                    inputMode="numeric"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    value={newAccMt5Login}
                    onChange={(e) => setNewAccMt5Login(e.target.value)}
                    placeholder="e.g. 51012345"
                    className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg p-2.5 w-full focus:ring-violet-500 focus:border-violet-500"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">Investor Password (Read-Only)</label>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-semibold">
                      Read-Only Safe
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      name="mt5_investor_key_nonpwd"
                      id="mt5_investor_key_nonpwd"
                      required
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      style={{ WebkitTextSecurity: showInvestorPassword ? 'none' : 'disc' } as any}
                      value={newAccMt5InvestorPassword}
                      onChange={(e) => setNewAccMt5InvestorPassword(e.target.value)}
                      placeholder="••••••••"
                      className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs rounded-lg p-2.5 pr-10 w-full focus:ring-violet-500 focus:border-violet-500 font-mono tracking-wider"
                    />
                    <button
                      type="button"
                      onClick={() => setShowInvestorPassword(!showInvestorPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                      title={showInvestorPassword ? "Hide password" : "Show password"}
                    >
                      {showInvestorPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="mt-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-[11.5px] leading-relaxed text-emerald-300 flex items-start gap-2.5 backdrop-blur-xs">
                    <div className="p-1 rounded-md bg-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
                      <Shield className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      Always use your <strong className="text-emerald-200 font-semibold">Investor (read-only) Password</strong>, never your master trading password. Credentials are encrypted before storage.
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCreateAccount}
                  disabled={actionLoading}
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs rounded-lg py-2.5 px-4 transition disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-violet-600/20"
                >
                  {actionLoading ? 'Connecting MT5 Account...' : 'Connect MT5 Account'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* A2. Delete Trade Confirmation Modal */}
      {deleteConfirmTradeId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-xs p-5">
            <p className="text-sm font-semibold text-slate-800 mb-4">Delete this trade?</p>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => { setDeleteConfirmTradeId(null); setDeleteConfirmDontShow(false); }}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm rounded-lg py-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleteConfirmLoading}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-medium text-sm rounded-lg py-2 transition-colors disabled:opacity-60"
              >
                {deleteConfirmLoading ? '...' : 'Delete'}
              </button>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                id="delete-dont-show-again"
                type="checkbox"
                checked={deleteConfirmDontShow}
                onChange={(e) => setDeleteConfirmDontShow(e.target.checked)}
                className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
              />
              <span className="text-xs text-slate-400">Don't show again</span>
            </label>
          </div>
        </div>
      )}

      {/* Trade Note Minimalist Modal */}
      {selectedNote !== null && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-[60] overflow-y-auto" onClick={() => setSelectedNote(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 max-w-sm w-full relative overflow-hidden transform transition-all" onClick={e => e.stopPropagation()}>
            <div className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center text-blue-500">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white text-[15px]">Trade Note</h3>
                <button
                  onClick={() => setSelectedNote(null)}
                  className="ml-auto text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed max-h-[60vh] overflow-y-auto whitespace-pre-wrap">
                {selectedNote}
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  onClick={() => setSelectedNote(null)}
                  className="px-5 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[13px] font-bold rounded-xl hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors shadow-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trade Chart Screenshot Lightbox */}
      {viewingScreenshot && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-[80]"
          onClick={() => setViewingScreenshot(null)}
        >
          <div className="relative max-w-4xl w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-white/80 text-[13px] font-bold inline-flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Trade Chart
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={viewingScreenshot}
                  download="trade-chart.jpg"
                  className="text-white/70 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10"
                  title="Download image"
                >
                  <Download className="h-4 w-4" />
                </a>
                <button
                  onClick={() => setViewingScreenshot(null)}
                  className="text-white/70 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <img
              src={viewingScreenshot}
              alt="Trade chart screenshot"
              className="w-full max-h-[80vh] object-contain rounded-xl border border-white/10 shadow-2xl bg-slate-900"
            />
          </div>
        </div>
      )}

      {/* B. Add / Edit Trade Modal */}
      {showTradeModal && (
        <div
          className="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-[70] overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowTradeModal(false);
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 max-w-md w-full relative flex flex-col my-auto max-h-[min(92vh,780px)] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >

            {/* Modal Header - Sticky at top so Close button is always visible */}
            <div className="shrink-0 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 sm:p-5 pr-14 sticky top-0 z-20">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base sm:text-lg">
                {isMentorReadOnlyMode ? 'Inspect Trade Execution (Read-Only)' : editingTradeId ? 'Modify Trade Record' : 'Record Executed Trade'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isMentorReadOnlyMode ? 'Trader trade details and performance metrics in mentor read-only mode.' : 'Enter the essential details for your journal.'}
              </p>

              <button
                type="button"
                onClick={() => setShowTradeModal(false)}
                className="absolute right-3.5 top-3.5 sm:right-4 sm:top-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition duration-150 flex items-center justify-center cursor-pointer"
                title="Close modal (Esc)"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTrade} className="p-4 sm:p-5 space-y-5 overflow-y-auto flex-1 overscroll-contain">

              {/* Date & Time
                  Stacked below 420px: side by side, each datetime-local field
                  had 99px of inner width for a value that renders at 125px, so
                  the date was visibly cut off mid-digit on a phone. */}
              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5">Entry Time</label>
                  <div className="relative">
                    <input
                      id="tradeDateInput"
                      type="datetime-local"
                      value={tradeDate}
                      onChange={(e) => setTradeDate(e.target.value)}
                      className="bg-white border border-slate-200 text-sm rounded-xl p-3 pr-10 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-sm transition-all [&::-webkit-calendar-picker-indicator]:hidden"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const input = document.getElementById('tradeDateInput') as HTMLInputElement;
                        if (input) {
                          input.focus();
                          try { if ('showPicker' in input) (input as any).showPicker(); } catch (_) { }
                        }
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-500 transition-colors z-10"
                    >
                      <Calendar className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5">Exit Time (Optional)</label>
                  <div className="relative">
                    <input
                      id="tradeExitTimeInput"
                      type="datetime-local"
                      value={tradeExitTime}
                      onChange={(e) => setTradeExitTime(e.target.value)}
                      className="bg-white border border-slate-200 text-sm rounded-xl p-3 pr-10 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-sm transition-all [&::-webkit-calendar-picker-indicator]:hidden"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const input = document.getElementById('tradeExitTimeInput') as HTMLInputElement;
                        if (input) {
                          input.focus();
                          try { if ('showPicker' in input) (input as any).showPicker(); } catch (_) { }
                        }
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-500 transition-colors z-10"
                    >
                      <Calendar className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Core Details (Asset, Direction, Lots) */}
              <div className="grid grid-cols-3 gap-4">
                {/* Symbol with autocomplete */}
                <div className="relative">
                  <label className="text-xs font-bold text-slate-700 block mb-1.5">Symbol</label>
                  <input
                    ref={symbolInputRef}
                    type="text"
                    required
                    value={tradeSymbol}
                    onChange={(e) => {
                      const sym = e.target.value.toUpperCase();
                      setTradeSymbol(sym);
                      localStorage.setItem('lastTradeSymbol', sym);
                      if (sym.length > 0) {
                        const matches = ALL_SYMBOLS.filter(s => s.startsWith(sym) && s !== sym);
                        setSymbolSuggestions(matches.slice(0, 8));
                        setShowSymbolDropdown(matches.length > 0);
                      } else {
                        setSymbolSuggestions([]);
                        setShowSymbolDropdown(false);
                      }
                    }}
                    onFocus={() => {
                      if (tradeSymbol.length > 0) {
                        const matches = ALL_SYMBOLS.filter(s => s.startsWith(tradeSymbol) && s !== tradeSymbol);
                        if (matches.length > 0) { setSymbolSuggestions(matches.slice(0, 8)); setShowSymbolDropdown(true); }
                      } else {
                        setSymbolSuggestions(ALL_SYMBOLS.slice(0, 8));
                        setShowSymbolDropdown(true);
                      }
                    }}
                    placeholder="XAUUSD"
                    autoComplete="off"
                    className="bg-white border border-slate-200 text-sm rounded-xl p-3 w-full uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-sm transition-all"
                  />
                  {/* Autocomplete Dropdown */}
                  {showSymbolDropdown && symbolSuggestions.length > 0 && (
                    <div
                      ref={symbolDropdownRef}
                      className="absolute top-full left-0 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden"
                    >
                      {symbolSuggestions.map((sym) => {
                        const spec = SYMBOL_SPECS[sym];
                        const previewProfit = spec
                          ? calculateTradeProfit(sym, tradeType, parseFloat(tradeEntryPrice), parseFloat(tradeExitPrice), parseFloat(tradeLotSize))
                          : null;
                        return (
                          <button
                            key={sym}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setTradeSymbol(sym);
                              localStorage.setItem('lastTradeSymbol', sym);
                              setShowSymbolDropdown(false);
                              setSymbolSuggestions([]);
                            }}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex items-center justify-between font-medium border-b border-slate-50 last:border-0"
                          >
                            <span className="font-bold text-slate-800">{sym}</span>
                            {previewProfit !== null && (
                              <span className={`text-[10px] font-semibold ${previewProfit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                {previewProfit >= 0 ? '+' : ''}{previewProfit.toFixed(2)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5">Direction</label>
                  <select
                    value={tradeType}
                    onChange={(e: any) => setTradeType(e.target.value)}
                    className="bg-white border border-slate-200 text-sm rounded-xl p-3 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-sm transition-all cursor-pointer"
                  >
                    <option value="Buy">BUY</option>
                    <option value="Sell">SELL</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1.5">Lot Size</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={tradeLotSize}
                    onChange={(e) => setTradeLotSize(e.target.value)}
                    className="bg-white border border-slate-200 text-sm rounded-xl p-3 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-sm transition-all"
                  />
                </div>
              </div>

              {/* Price Details */}
              <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-100 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1.5">Entry Price</label>
                    <input
                      type="number"
                      step="0.00001"
                      required
                      value={tradeEntryPrice}
                      onChange={(e) => setTradeEntryPrice(e.target.value)}
                      className="bg-white border border-slate-200 text-sm rounded-xl p-2.5 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-sm transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1.5">Exit Price</label>
                    <input
                      type="number"
                      step="0.00001"
                      required
                      value={tradeExitPrice}
                      onChange={(e) => setTradeExitPrice(e.target.value)}
                      className="bg-white border border-slate-200 text-sm rounded-xl p-2.5 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-sm transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1.5">Stop Loss <span className="text-slate-400 font-normal">(SL)</span></label>
                    <input
                      type="number"
                      step="0.00001"
                      value={tradeSL}
                      onChange={(e) => setTradeSL(e.target.value)}
                      placeholder="Optional"
                      className="bg-white border border-slate-200 text-sm rounded-xl p-2.5 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-sm transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1.5">Take Profit <span className="text-slate-400 font-normal">(TP)</span></label>
                    <input
                      type="number"
                      step="0.00001"
                      value={tradeTP}
                      onChange={(e) => setTradeTP(e.target.value)}
                      placeholder="Optional"
                      className="bg-white border border-slate-200 text-sm rounded-xl p-2.5 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-sm transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Outcome (Net P/L) — auto-calculated */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Net P/L (Profit/Loss)</label>
                  <button
                    type="button"
                    onClick={() => {
                      setTradeProfitIsAuto(true);
                      const entry = parseFloat(tradeEntryPrice);
                      const exit = parseFloat(tradeExitPrice);
                      const lot = parseFloat(tradeLotSize);
                      const calc = calculateTradeProfit(tradeSymbol, tradeType, entry, exit, lot);
                      if (calc !== null) setTradeProfit(String(calc));
                    }}
                    title={tradeProfitIsAuto ? 'Auto-calculated from symbol, lots, entry & exit price. Click to recalculate.' : 'Manual override active. Click to recalculate automatically.'}
                    className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-0.5 rounded-full transition-colors cursor-pointer ${tradeProfitIsAuto
                      ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/25 hover:bg-violet-500/20'
                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 hover:bg-amber-500/20'
                      }`}
                  >
                    <RefreshCw className="h-2.5 w-2.5" />
                    {tradeProfitIsAuto ? 'Auto-calculated' : 'Manual (Reset)'}
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-slate-400 font-semibold sm:text-sm">$</span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={tradeProfit}
                    onChange={(e) => {
                      setTradeProfit(e.target.value);
                      setTradeProfitIsAuto(false);
                    }}
                    placeholder="0.00"
                    className={`bg-white dark:bg-slate-900 border text-sm rounded-xl p-3 pl-7 w-full focus:outline-none shadow-sm transition-all font-bold ${Number(tradeProfit) > 0
                      ? 'border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-400 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500'
                      : Number(tradeProfit) < 0
                        ? 'border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-400 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500'
                        : 'border-slate-200 dark:border-white/10 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500'
                      }`}
                  />
                </div>
                {!SYMBOL_SPECS[tradeSymbol.toUpperCase()] && tradeSymbol.length > 2 && (
                  <p className="text-[10px] text-amber-500 mt-1">
                    ⚠ Symbol not recognized — please enter profit manually.
                  </p>
                )}
              </div>

              {/* Optional extras — horizontal chip row */}
              <div className="space-y-3">

                {/* Toggle chips row
                    gap-1.5 and the tighter chip padding below sm keep all three
                    on one line at 375px: with the type icons added they came to
                    301px of chips plus 16px of gaps in a 308px container, so
                    Image wrapped on its own. */}
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">

                  {/* + Note */}
                  <button
                    type="button"
                    onClick={() => setShowNoteField(prev => !prev)}
                    className={`inline-flex items-center gap-1 sm:gap-1.5 text-xs font-semibold px-2.5 sm:px-3 py-1.5 rounded-full border transition-all duration-200 ${showNoteField
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-400 hover:text-indigo-600'
                      }`}
                  >
                    {/* A type icon beside the Plus, so the three chips are
                        distinguishable at a glance instead of reading as three
                        identical "+ word" pills. */}
                    <Plus className={`h-3 w-3 transition-transform duration-200 ${showNoteField ? 'rotate-45' : ''}`} />
                    <FileText className="h-3.5 w-3.5" />
                    Note
                  </button>

                  {/* + Emotion */}
                  <button
                    type="button"
                    onClick={() => setShowEmotionField(prev => !prev)}
                    className={`inline-flex items-center gap-1 sm:gap-1.5 text-xs font-semibold px-2.5 sm:px-3 py-1.5 rounded-full border transition-all duration-200 ${showEmotionField
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-400 hover:text-indigo-600'
                      }`}
                  >
                    <Plus className={`h-3 w-3 transition-transform duration-200 ${showEmotionField ? 'rotate-45' : ''}`} />
                    <Heart className="h-3.5 w-3.5" />
                    Emotion
                    {showEmotionField && <span className="opacity-70 font-normal">· {tradeEmotion}</span>}
                  </button>

                  {/* + Image — screenshot of the setup */}
                  <button
                    type="button"
                    onClick={() => setShowChartField(prev => !prev)}
                    className={`inline-flex items-center gap-1 sm:gap-1.5 text-xs font-semibold px-2.5 sm:px-3 py-1.5 rounded-full border transition-all duration-200 ${showChartField
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-400 hover:text-indigo-600'
                      }`}
                  >
                    <Plus className={`h-3 w-3 transition-transform duration-200 ${showChartField ? 'rotate-45' : ''}`} />
                    <ImageIcon className="h-3.5 w-3.5" />
                    Image
                    {tradeScreenshot && <span className="opacity-70 font-normal">· 1</span>}
                  </button>

                </div>

                {/* Expanded: Note */}
                {showNoteField && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                    <textarea
                      rows={3}
                      value={tradeNotes}
                      onChange={(e) => setTradeNotes(e.target.value)}
                      placeholder="Any thoughts, observations, or lessons from this trade…"
                      className="bg-slate-50/80 border border-slate-200 text-sm text-slate-700 rounded-xl p-3 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none placeholder:text-slate-400"
                    />
                  </div>
                )}

                {/* Expanded: Emotion */}
                {showEmotionField && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex flex-wrap gap-2">
                      {(['Calm', 'Excited', 'Anxious', 'FOMO', 'Greedy', 'Revenge'] as const).map(e => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => setTradeEmotion(e)}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all duration-150 ${tradeEmotion === e
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-400 hover:text-indigo-600'
                            }`}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expanded: Chart screenshot */}
                {showChartField && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                    <input
                      ref={screenshotInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        handleScreenshotFile(e.target.files?.[0]);
                        // Cleared so picking the same file twice still fires onChange.
                        e.target.value = '';
                      }}
                    />

                    {tradeScreenshot ? (
                      <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                        <img
                          src={tradeScreenshot}
                          alt="Trade image screenshot"
                          className="w-full max-h-52 object-contain bg-slate-100 cursor-zoom-in"
                          onClick={() => setViewingScreenshot(tradeScreenshot)}
                        />
                        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white border-t border-slate-200">
                          <span className="text-[11px] font-semibold text-slate-500 inline-flex items-center gap-1.5">
                            <ImageIcon className="h-3.5 w-3.5 text-indigo-500" />
                            Image attached
                          </span>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => screenshotInputRef.current?.click()}
                              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
                            >
                              Replace
                            </button>
                            <button
                              type="button"
                              onClick={() => { setTradeScreenshot(''); setScreenshotError(''); }}
                              className="text-[11px] font-bold text-rose-500 hover:text-rose-600 transition-colors inline-flex items-center gap-1"
                            >
                              <X className="h-3 w-3" />
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => screenshotInputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setScreenshotDragging(true); }}
                        onDragLeave={() => setScreenshotDragging(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setScreenshotDragging(false);
                          handleScreenshotFile(e.dataTransfer.files?.[0]);
                        }}
                        onPaste={(e) => {
                          const item = Array.from(e.clipboardData?.items || [])
                            .find(i => i.type.startsWith('image/'));
                          if (item) handleScreenshotFile(item.getAsFile());
                        }}
                        disabled={screenshotBusy}
                        className={`w-full rounded-xl border-2 border-dashed px-4 py-7 flex flex-col items-center justify-center gap-1.5 transition-all duration-200 disabled:opacity-60 ${screenshotDragging
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-slate-200 bg-slate-50/80 hover:border-indigo-400 hover:bg-indigo-50/40'
                          }`}
                      >
                        <Upload className={`h-5 w-5 ${screenshotDragging ? 'text-indigo-600' : 'text-slate-400'}`} />
                        <span className="text-xs font-semibold text-slate-600">
                          {screenshotBusy ? 'Processing image…' : 'Upload trade image'}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          Click, drag and drop, or paste · PNG/JPG up to 8MB
                        </span>
                      </button>
                    )}

                    {screenshotError && (
                      <p className="text-[10px] text-rose-500 mt-1.5 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {screenshotError}
                      </p>
                    )}
                  </div>
                )}

              </div>

              {/* Action Button */}
              <div className="pt-2">
                {isMentorReadOnlyMode ? (
                  <div className="p-3.5 bg-violet-500/10 border border-violet-500/30 rounded-xl text-center text-xs font-bold text-violet-600 dark:text-violet-300 flex items-center justify-center gap-2">
                    <Shield className="h-4 w-4 text-violet-500" />
                    <span>Mentor Read-Only Mode: Trade modifications are disabled.</span>
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl py-3.5 px-4 transition-all duration-300 shadow-md shadow-indigo-500/30 hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {actionLoading ? 'Saving...' : editingTradeId ? 'Update Trade Record' : 'Save Trade'}
                  </button>
                )}
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Paste-from-MT5 Modal */}
      {showPasteModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-start justify-center p-4 z-[70] overflow-y-auto pt-16 md:pt-24 pb-16">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-100 max-w-2xl w-full p-6 relative">
            <button
              onClick={() => setShowPasteModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-50 transition duration-150"
            >
              ✖
            </button>

            <h3 className="font-bold text-slate-900 text-base mb-1">Import MT5 Trades</h3>
            <p className="text-[11px] text-slate-400 mb-4">
              Paste copied trade data, or upload an HTML/XML report exported from MT5.
            </p>

            {/* File upload row */}
            <div className="flex items-center gap-3 mb-4 p-3 bg-slate-50 border border-dashed border-slate-200 rounded-lg">
              <label className="cursor-pointer flex items-center gap-2 text-xs font-semibold text-violet-600 hover:text-violet-700 dark:text-violet-400">
                <Upload className="h-4 w-4" />
                Upload HTML / XML Report
                <input
                  type="file"
                  accept=".html,.htm,.xml"
                  onChange={handleReportFileUpload}
                  className="hidden"
                />
              </label>
              <span className="text-[11px] text-slate-400">
                From MT5: <strong>File → Save as Report</strong> (HTML) or export XML
              </span>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 border-t border-slate-100"></div>
              <span className="text-[11px] text-slate-400 font-medium">or paste tabular data</span>
              <div className="flex-1 border-t border-slate-100"></div>
            </div>

            <textarea
              value={pasteRawText}
              onChange={e => setPasteRawText(e.target.value)}
              rows={6}
              className="w-full border border-slate-200 rounded-lg p-3 text-xs font-mono text-slate-700 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
              placeholder={`Paste MT5 trade data here...\n\nExample (tab-separated):\n#\tTime\tType\tSize\tItem\tPrice\tS/L\tT/P\tClose Time\tPrice\tCommission\tSwap\tProfit\n12345\t2024.01.15 10:30\tbuy\t0.10\tEURUSD\t1.08500\t1.08000\t1.09000\t2024.01.15 12:45\t1.09200\t-3.50\t-1.20\t50.00`}
            />

            <div className="flex gap-2 mt-3">
              <button
                onClick={handleParsePaste}
                disabled={!pasteRawText.trim() || pasteRawText.startsWith('[Parsed')}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg py-2 px-4 transition flex items-center gap-1.5"
              >
                <Terminal className="h-3.5 w-3.5" />
                Parse Trades
              </button>
              {parsedTrades.length > 0 && (
                <span className="text-xs text-slate-500 self-center ml-1">
                  {parsedTrades.length} trade{parsedTrades.length > 1 ? 's' : ''} detected
                </span>
              )}
            </div>

            {parsedTrades.length > 0 && (
              <div className="mt-4 border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500 font-semibold">
                      <th className="px-3 py-2 whitespace-nowrap">Date</th>
                      <th className="px-3 py-2 whitespace-nowrap">Symbol</th>
                      <th className="px-3 py-2 whitespace-nowrap">Type</th>
                      <th className="px-3 py-2 whitespace-nowrap">Lots</th>
                      <th className="px-3 py-2 whitespace-nowrap">Entry</th>
                      <th className="px-3 py-2 whitespace-nowrap">Exit</th>
                      <th className="px-3 py-2 whitespace-nowrap">Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedTrades.map((t, idx) => (
                      <tr key={idx} className="border-t border-slate-100 text-slate-700">
                        <td className="px-3 py-1.5 whitespace-nowrap">{new Date(t.date).toLocaleDateString()}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap font-medium">{t.symbol}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span className={`${t.type === 'Buy' ? 'text-emerald-600' : 'text-rose-600'} font-semibold`}>{t.type}</span>
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{t.lotSize}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap font-mono">{t.entryPrice}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap font-mono">{t.exitPrice}</td>
                        <td className={`px-3 py-1.5 whitespace-nowrap font-semibold font-mono ${t.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {t.profit >= 0 ? '+' : ''}{t.profit.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {parsedTrades.length > 0 && (
              <div className="flex gap-2 justify-end mt-4 pt-4 border-t border-slate-100">
                <button
                  onClick={() => setShowPasteModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImportParsedTrades}
                  disabled={pasteImporting}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg py-2 px-4 transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {pasteImporting ? 'Importing...' : `Save All ${parsedTrades.length} Trades`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* B2. Export Journal Modal (Excel / PDF) */}
      {showExportModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-100 max-w-md w-full p-6 relative">
            <button
              onClick={() => setShowExportModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-50 transition duration-150"
            >
              ✖
            </button>

            <h3 className="font-bold text-slate-900 text-base mb-1">Export Journal</h3>
            <p className="text-[11px] text-slate-400 mb-4">
              Choose the trading period and format for your export.
            </p>

            {/* Format selector */}
            <div className="mb-4">
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1.5">Format</label>
              {/* CSV is the free plan's report. Excel and PDF stay visible but
                  marked, because the server refuses them on Free and finding
                  that out only after picking a period is worse than seeing it
                  here. Selecting one raises the upgrade modal. */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setExportFormat('csv')}
                  className={`text-xs font-semibold rounded-lg px-3 py-2.5 border transition flex items-center justify-center gap-1.5 ${exportFormat === 'csv'
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  CSV
                </button>
                <button
                  onClick={() => {
                    if (!isProActive) { setShowExportModal(false); setShowProModal(true); return; }
                    setExportFormat('xlsx');
                  }}
                  className={`relative text-xs font-semibold rounded-lg px-3 py-2.5 border transition flex items-center justify-center gap-1.5 ${exportFormat === 'xlsx'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    } ${!isProActive ? 'opacity-70' : ''}`}
                >
                  {!isProActive && <Lock className="h-2.5 w-2.5 text-violet-600" />}
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Excel
                </button>
                <button
                  onClick={() => {
                    if (!isProActive) { setShowExportModal(false); setShowProModal(true); return; }
                    setExportFormat('pdf');
                  }}
                  className={`relative text-xs font-semibold rounded-lg px-3 py-2.5 border transition flex items-center justify-center gap-1.5 ${exportFormat === 'pdf'
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    } ${!isProActive ? 'opacity-70' : ''}`}
                >
                  {!isProActive && <Lock className="h-2.5 w-2.5 text-violet-600" />}
                  <FileText className="h-3.5 w-3.5" />
                  PDF
                </button>
              </div>
              {!isProActive && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Excel and PDF reports are a Pro feature. The free plan exports CSV for the last 30 days.
                </p>
              )}
            </div>

            {/* Preset periods */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                { key: 'this-month', label: 'This Month' },
                { key: 'last-month', label: 'Last Month' },
                { key: 'last-3-months', label: 'Last 3 Months' },
                { key: 'last-6-months', label: 'Last 6 Months' },
                { key: 'this-year', label: 'This Year' },
                { key: 'all', label: 'All Time' },
                { key: 'custom', label: 'Custom Range' },
              ].map(p => (
                <button
                  key={p.key}
                  onClick={() => setExportPreset(p.key)}
                  className={`text-xs font-semibold rounded-lg px-3 py-2.5 border transition ${exportPreset === p.key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom date range */}
            {exportPreset === 'custom' && (
              <div className="flex items-end gap-2 mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="flex-1">
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Start Date</label>
                  <input
                    type="date"
                    value={exportCustomStart}
                    onChange={e => setExportCustomStart(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                <div className="text-slate-400 pb-2">to</div>
                <div className="flex-1">
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">End Date</label>
                  <input
                    type="date"
                    value={exportCustomEnd}
                    onChange={e => setExportCustomEnd(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
              </div>
            )}

            {/* Trade count preview */}
            <div className="text-[11px] text-slate-500 mb-4 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
              {(() => {
                const count = filterTradesByRange(getExportRange()).length;
                return <>{count} trade{count === 1 ? '' : 's'} will be exported</>;
              })()}
            </div>

            {/* Say plainly when the plan, not the chosen period, decided the range. */}
            {!isProActive && (() => {
              const requested = filterTradesByRange(getRequestedExportRange()).length;
              const allowed = filterTradesByRange(getExportRange()).length;
              if (requested <= allowed) return null;
              return (
                <div className="text-[11px] text-amber-700 mb-4 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <span className="font-semibold">Free plan exports the last 30 days.</span>{' '}
                  {requested - allowed} older trade{requested - allowed === 1 ? '' : 's'} in this
                  period will be left out.{' '}
                  <button
                    onClick={() => { setShowExportModal(false); goToSubscriptionSettings(); }}
                    className="font-semibold underline underline-offset-2 hover:text-amber-800"
                  >
                    Upgrade to Pro
                  </button>
                </div>
              );
            })()}

            <div className="flex gap-2 justify-end pt-4 border-t border-slate-100">
              <button
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleExportJournal()}
                disabled={exportPreset === 'custom' && (!exportCustomStart || !exportCustomEnd)}
                className="bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg py-2 px-4 transition disabled:opacity-50 flex items-center gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                Download {exportFormat === 'xlsx' ? 'Excel' : exportFormat === 'pdf' ? 'PDF' : 'CSV'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* C. Ticket Creation Modal */}
      {showTicketModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-100 max-w-md w-full p-6 relative">
            <button
              onClick={() => setShowTicketModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600"
            >
              ✖
            </button>
            <form onSubmit={handleCreateTicket} className="space-y-4">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Submit Support Request</h3>
                <p className="text-[11px] text-slate-400">Briefly detail your query and our team will get in touch.</p>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Category</label>
                <select
                  value={ticketCategory}
                  onChange={(e: any) => setTicketCategory(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full"
                >
                  <option value="Other">General Support Query</option>
                  <option value="Billing">Billing & Subscription</option>
                  <option value="Feature Request">Feature Request</option>
                  <option value="Bug">Technical Bug Report</option>
                  <option value="Other">Other Query</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Subject Title</label>
                <input
                  type="text"
                  required
                  value={ticketTitle}
                  onChange={(e) => setTicketTitle(e.target.value)}
                  placeholder="Need assistance linking MetaQuotes terminal"
                  className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Detailed Description</label>
                <textarea
                  required
                  rows={4}
                  value={ticketDescription}
                  onChange={(e) => setTicketDescription(e.target.value)}
                  placeholder="Explain your situation in full..."
                  className="bg-slate-50 border border-slate-200 text-xs rounded-lg p-2.5 w-full"
                />
              </div>

              <button
                type="submit"
                disabled={actionLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg py-2.5 px-4 transition disabled:opacity-50"
              >
                {actionLoading ? 'Logging ticket...' : 'Submit Support Ticket'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* First-time onboarding guided tour */}
      {showGuidedTour && user && (
        <GuidedTour
          step={guidedTourStep}
          accountCreated={accounts.length > 0}
          onNext={nextGuidedTourStep}
          onBack={backGuidedTourStep}
          onSkip={completeGuidedTour}
          onFinish={completeGuidedTour}
        />
      )}



      {/* Sign-out confirmation modal */}
      {showSignOutModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(3,4,8,0.55)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
          onClick={() => setShowSignOutModal(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') setShowSignOutModal(false); }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="signout-title"
            aria-describedby="signout-desc"
            onClick={(e) => e.stopPropagation()}
            className="profile-menu rounded-2xl max-w-sm w-full p-6"
            style={{ animation: 'modalIn 0.2s ease-out' }}
          >
            <div className="flex items-center gap-3.5 mb-1">
              <div className="h-11 w-11 rounded-full bg-rose-100 dark:bg-rose-500/12 dark:border dark:border-rose-400/25 flex items-center justify-center flex-shrink-0">
                <LogOut className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div>
                <h3 id="signout-title" className="text-sm font-bold text-slate-800 dark:text-white">Sign out of FX Journal Pro?</h3>
                <p id="signout-desc" className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Your journal stays saved. You can sign back in anytime.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-7">
              <button
                onClick={() => setShowSignOutModal(false)}
                className="px-4 py-2.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 dark:text-slate-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.11] dark:border dark:border-white/10 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                autoFocus
                onClick={async () => {
                  setShowSignOutModal(false);
                  await performLogout();
                }}
                className="px-4 py-2.5 text-xs font-semibold text-white rounded-xl transition bg-gradient-to-b from-rose-500 to-rose-600 hover:brightness-110 active:translate-y-px border border-rose-400/50 shadow-[0_10px_24px_-12px_rgba(244,63,94,.9),inset_0_1px_0_rgba(255,255,255,.22)]"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pro Upgrade Modal */}
      <ProUpgradeModal
        isOpen={showProModal}
        onClose={() => setShowProModal(false)}
        user={user}
        authFetch={authFetch}
        onSuccess={async () => {
          await fetchAccountData();
          try {
            const storedUserId = sessionStorage.getItem('auth_user_id') || localStorage.getItem('auth_user_id');
            const storedEmail = sessionStorage.getItem('auth_email') || localStorage.getItem('auth_email');
            const headers: Record<string, string> = {};
            if (storedUserId) headers['x-auth-user-id'] = storedUserId;
            if (storedEmail) headers['x-auth-email'] = storedEmail;
            const res = await fetch('/api/auth/me', { headers });
            if (res.ok) {
              const d = await res.json();
              if (d.user) setUser(d.user);
            }
          } catch (e) {
            console.error('Error refreshing user post-upgrade:', e);
          }
        }}
      />

      {/* Modern In-App Custom Alert & Pro Gate Modal */}
      <CustomAlertModal
        isOpen={alertModal.isOpen}
        onClose={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
        title={alertModal.title}
        message={alertModal.message}
        type={alertModal.type}
        confirmText={alertModal.confirmText}
        cancelText={alertModal.cancelText}
        onConfirm={alertModal.onConfirm}
        onCancel={alertModal.onCancel}
      />

      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}

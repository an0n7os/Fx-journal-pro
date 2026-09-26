import React, { useCallback, useEffect, useState } from 'react';
import {
  Download,
  RefreshCw,
  Wifi,
  WifiOff,
  Terminal,
  Clock,
  KeyRound,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Plus,
  Copy,
  FileCode2,
  Loader2,
  Unplug,
  ArrowRight,
  ArrowDownRight,
  CircleDollarSign,
  XCircle,
  TrendingUp,
  Landmark,
  Play,
  X,
  Crown,
  Eye,
  Bot,
  Info
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import { TradingAccount } from '../types';

interface MT5AutomationProps {
  account: TradingAccount | null;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onRefresh: () => void;
}

interface MT5OpenPosition {
  positionId: number;
  ticket: number;
  symbol: string;
  side: string;
  volume: number;
  openTime: string;
  openPrice: number;
  sl: number | null;
  tp: number | null;
  profit: number;
  currentPrice: number | null;
}

interface MT5PendingOrder {
  orderId: number;
  symbol: string;
  type: string;
  volume: number;
  openPrice: number;
  sl: number | null;
  tp: number | null;
  state: string;
}

interface MT5MoneyFlow {
  ticket: number;
  flowType: string;
  amount: number;
  currency: string;
  time: string;
}

interface MT5ConnectionError {
  errorCode: string;
  errorMessage: string;
  occurredAt: string;
  resolvedAt: string | null;
}

interface MT5Snapshot {
  accountId: string;
  balance: number;
  equity: number;
  margin: number | null;
  marginFree: number | null;
  marginLevel: number | null;
  currency: string | null;
  leverage: number | null;
  capturedAt: string;
}

interface MT5ConnectJob {
  id: string;
  accountId: string;
  action: string;
  status: string;
  attempts?: number;
  statusMessage?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  lastError?: string | null;
  updatedAt?: string;
}

interface MT5Status {
  accountId: string;
  status: string;
  eaStatus: string;
  syncMethod: string;
  cloudConnected: boolean;
  workerConfigured?: boolean;
  connectJobs: MT5ConnectJob[];
  lastSyncTime: string | null;
  lastHeartbeatAt: string | null;
  lastDealId: number;
  syncTradeCount: number;
  startingBalance: number;
  currentBalance: number;
  equity: number;
  terminalLogin: string | null;
  terminalServer: string | null;
  openPositions: MT5OpenPosition[];
  pendingOrders: MT5PendingOrder[];
  moneyFlows: MT5MoneyFlow[];
  lastErrors: MT5ConnectionError[];
  snapshots: MT5Snapshot[];
}

type Phase =
  | 'Not Started'
  | 'Collecting'
  | 'EA Ready'
  | 'Validating'
  | 'Connected'
  | 'Syncing'
  | 'Synced'
  | 'Error'
  | 'Disconnected';

const ERROR_COPY: Record<string, string> = {
  EA_AUTH_FAILED: 'This EA file no longer works. Download a fresh copy from your account page.',
  EA_TOKEN_REVOKED: 'This account was disconnected. Reconnect to generate a fresh EA.',
  EA_LOGIN_MISMATCH: 'The EA is logged into a different MT5 account than expected. Log in with the correct account and reattach the EA.',
  EA_SERVER_MISMATCH: 'The MT5 server name does not match the one recorded for this portfolio. Check the broker server name and reconnect.',
  INVALID_TIMESTAMP: 'Security check failed due to a clock or replay issue. Download a fresh copy of your EA.',
  SIGNATURE_MISMATCH: 'Security check failed. Download a fresh copy of your EA.',
  ACCOUNT_NOT_FOUND: 'This EA belongs to a different account. Download the EA from the correct account page.',
  INVALID_PAYLOAD: 'The EA sent an invalid update. It will retry automatically.',
  RATE_LIMITED: 'Sync is temporarily throttled. It will retry shortly.',
  MT5_OFFLINE: 'MT5 is not connected to the broker. Reconnect MT5 and keep the EA attached to a chart.',
  E_CONNECTION_LOST: 'MT5 cannot reach the server. Check the WebRequest allow-list and your internet connection.',
  CLOUD_NOT_CONFIGURED: 'Cloud sync (investor password) is not configured on this deployment yet. Use the EA method instead.',
  CLOUD_WORKER_UNAVAILABLE: 'Cloud sync has no broker worker connected (META_API_TOKEN is missing on the server). Use the EA method, which needs no extra setup.',
  INVALID_PASSWORD: 'The investor password was rejected. Check it and try again.',
  E_AUTH: 'The investor password was rejected by the broker. Use the read-only Investor password (not your main password) and check the broker server name.',
  E_SRV_NOT_FOUND: 'The broker server could not be found. Check the exact server name shown in MetaTrader (Help → About).',
  E_SERVER_TIMEZONE: 'The broker server timezone could not be detected. Cloud provisioning may need manual setup in the MetaApi dashboard.',
  E_RESOURCE_SLOTS: 'The MetaApi plan has no free resource slots left. Free up a slot in the MetaApi dashboard, then reconnect.',
  E_MAIN_SERVERS: 'The cloud terminal could not reach the broker. Wait a minute and try again.',
  E_ACCOUNT_NOT_FOUND: 'The MetaTrader account was not found on this broker. Double-check the login number and server.',
  CLOUD_TIMEOUT: 'Cloud sync timed out while connecting. Starting the cloud terminal can take a few minutes — try again.',
  CLOUD_SYNC_FAILED: 'Cloud sync hit an unexpected error. Please try again in a minute.',
  CLOUD_SYNC_LOST: 'The cloud connection was lost. Reconnect to re-provision the terminal.',
  CLOUD_CREDENTIALS: 'The stored investor credentials could not be decrypted. Reconnect to re-enter the password.'
};

function timeAgo(iso?: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'Just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatMoney(n: number, currency = 'USD'): string {
  if (typeof n !== 'number' || isNaN(n)) return '—';
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPrice(n: number | null | undefined): string {
  if (typeof n !== 'number' || isNaN(n)) return '—';
  return n.toFixed(n > 1000 ? 0 : n > 1 ? 3 : 5);
}

function formatAxisTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatChartMoney(n: number): string {
  if (typeof n !== 'number' || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
}

function friendlyError(error: MT5ConnectionError | undefined): string {
  if (!error) return 'Something went wrong with the MT5 sync. Please retry.';
  return ERROR_COPY[error.errorCode] || error.errorMessage || 'Something went wrong with the MT5 sync. Please retry.';
}

export default function MT5Automation({ account, authFetch, onRefresh }: MT5AutomationProps) {
  const [downloading, setDownloading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState('');
  const [downloadedName, setDownloadedName] = useState('');
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [eaCopied, setEaCopied] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [status, setStatus] = useState<MT5Status | null>(null);
  const [cloudLogin, setCloudLogin] = useState('');
  const [cloudServer, setCloudServer] = useState('');
  const [cloudPassword, setCloudPassword] = useState('');
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [showVideo, setShowVideo] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'ea' | 'investor'>('ea');

  useEffect(() => {
    if (status?.syncMethod === 'CLOUD') {
      setActiveTab('investor');
    } else if (status?.syncMethod === 'EA') {
      setActiveTab('ea');
    }
  }, [status?.syncMethod]);

  const host = typeof window !== 'undefined' ? window.location.host : 'www.fxjournalpro.com';
  const apiUrl = `${window.location.protocol}//${host}/api/mt5`;

  const pollStatus = useCallback(async () => {
    if (!account) return;
    try {
      const res = await authFetch(`/api/mt5/${account.id}/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setError('');
      }
    } catch {
      // keep last known status on transient failures
    }
  }, [account, authFetch]);

  useEffect(() => {
    if (!account) return;
    pollStatus();
    const id = setInterval(pollStatus, 5000);
    return () => clearInterval(id);
  }, [account, pollStatus]);

  async function handleDownload() {
    if (!account) return;
    setDownloading(true);
    setError('');
    try {
      const res = await authFetch(`/api/mt5/ea/${account.id}/download`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Download failed. Please try again.');
        return;
      }
      const source = await res.text();
      const blob = new Blob([source], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `FXJournalPro_Sync_${account.name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 30)}.mq5`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDownloadedName(a.download);
      onRefresh();
    } catch (e) {
      setError('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  async function handleCopyCode() {
    if (!account) return;
    setCopying(true);
    setError('');
    try {
      const res = await authFetch(`/api/mt5/ea/${account.id}/download`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Failed to fetch EA code. Please try again.');
        return;
      }
      const source = await res.text();
      await navigator.clipboard.writeText(source);
      setEaCopied(true);
      setTimeout(() => setEaCopied(false), 2500);
      onRefresh();
    } catch (e) {
      setError('Failed to copy EA code. Please try again.');
    } finally {
      setCopying(false);
    }
  }

  async function handleReset() {
    if (!account) return;
    setResetting(true);
    setError('');
    try {
      const res = await authFetch(`/api/mt5/ea/${account.id}/reset-token`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Reset failed. Please try again.');
        return;
      }
      setDownloadedName('');
      onRefresh();
    } catch (e) {
      setError('Reset failed. Please try again.');
    } finally {
      setResetting(false);
    }
  }

  async function handleDisconnect() {
    if (!account) return;
    setDisconnecting(true);
    setError('');
    try {
      const res = await authFetch(`/api/mt5/${account.id}/disconnect`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Disconnect failed. Please try again.');
        return;
      }
      setShowDisconnectConfirm(false);
      setDownloadedName('');
      setStatus(null);
      onRefresh();
    } catch (e) {
      setError('Disconnect failed. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(apiUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setCopied(false);
    }
  }

  async function handleCloudConnect() {
    if (!account) return;
    setCloudBusy(true);
    setCloudError('');
    try {
      const res = await authFetch('/api/mt5/cloud/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: account.id,
          login: cloudLogin.trim(),
          server: cloudServer.trim(),
          investorPassword: cloudPassword
        })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCloudError(friendlyError({ errorCode: d.code || 'SERVER_ERROR', errorMessage: d.error || 'Cloud connect failed.', occurredAt: new Date().toISOString(), resolvedAt: null }));
        return;
      }
      setCloudPassword('');
      setCloudLogin('');
      setCloudServer('');
      onRefresh();
    } catch (e) {
      setCloudError('Cloud connect failed. Please try again.');
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleCloudDisconnect() {
    if (!account) return;
    setCloudBusy(true);
    setCloudError('');
    try {
      const res = await authFetch('/api/mt5/cloud/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: account.id })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setCloudError(d.error || 'Cloud disconnect failed. Please try again.');
        return;
      }
      onRefresh();
    } catch (e) {
      setCloudError('Cloud disconnect failed. Please try again.');
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleCloudSync() {
    if (!account) return;
    try {
      const res = await authFetch('/api/mt5/cloud/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: account.id })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Cloud sync failed to start. Please try again.');
        return;
      }
      onRefresh();
    } catch (e) {
      setError('Cloud sync failed to start. Please try again.');
    }
  }

  function derivePhase(): Phase {
    if (downloading || copying || resetting) return 'Collecting';
    if (status?.syncMethod === 'CLOUD' && status.cloudConnected) {
      if (status.status === 'Connected') return 'Synced';
      if (status.status === 'Disconnected') return 'Disconnected';
      if (status.status === 'Error') return 'Error';
      return 'Validating';
    }
    if (status?.status === 'Disconnected' || status?.eaStatus === 'Disconnected') return 'Disconnected';
    const unresolved = (status?.lastErrors || []).filter((e) => !e.resolvedAt);
    if (unresolved.length > 0 && status) return 'Error';
    const heartbeatAt = status?.lastHeartbeatAt;
    const fresh = heartbeatAt ? Date.now() - new Date(heartbeatAt).getTime() < 120000 : false;
    if (status?.eaStatus === 'Connected' || fresh) {
      return status && status.syncTradeCount > 0 ? 'Synced' : 'Syncing';
    }
    if (downloadedName) return 'Validating';
    if (status?.lastSyncTime) return 'Disconnected';
    return 'Not Started';
  }

  if (!account) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 flex items-center justify-center mb-4">
          <Terminal className="h-7 w-7" />
        </div>
        <h3 className="dx-section-title">No Portfolio Account Selected</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
          Create a portfolio account first — every account receives its own unique MT5 Expert Advisor.
        </p>
        <button
          onClick={onRefresh}
          className="mt-5 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2.5 rounded-lg transition"
        >
          <Plus className="h-4 w-4" /> Refresh Accounts
        </button>
      </div>
    );
  }

  const phase = derivePhase();
  const connected = phase === 'Synced' || phase === 'Syncing';
  const phaseIcon = connected
    ? Wifi
    : phase === 'Error'
      ? XCircle
      : phase === 'Disconnected'
        ? WifiOff
        : phase === 'Validating'
          ? Loader2
          : Terminal;
  const PhaseIcon = phaseIcon;

  const phaseLabel =
    phase === 'Synced' ? 'Connected' : phase === 'Syncing' ? 'Syncing' : phase;
  const phaseColor =
    phase === 'Synced'
      ? 'text-emerald-600 dark:text-emerald-400'
      : phase === 'Syncing'
        ? 'text-amber-600 dark:text-amber-400'
        : phase === 'Error'
          ? 'text-rose-600 dark:text-rose-400'
          : phase === 'Disconnected'
            ? 'text-slate-500 dark:text-slate-400'
            : 'text-indigo-600 dark:text-indigo-400';

  const latestError = (status?.lastErrors || []).filter((e) => !e.resolvedAt)[0];
  const latestCloudJob = (status?.connectJobs || []).filter((j) => j.action === 'CONNECT').slice(-1)[0];

  const currency = status?.moneyFlows?.[0]?.currency || account.currency || 'USD';
  const totalDeposits = (status?.moneyFlows || [])
    .filter((f) => f.flowType === 'DEPOSIT')
    .reduce((a, f) => a + Math.abs(f.amount), 0);
  const totalWithdrawals = (status?.moneyFlows || [])
    .filter((f) => f.flowType === 'WITHDRAWAL')
    .reduce((a, f) => a + Math.abs(f.amount), 0);
  const floatingPnl = (status?.openPositions || []).reduce((a, p) => a + (p.profit || 0), 0);
  const netPnl = (status && status.equity > 0 ? status.equity : 0) - (status?.startingBalance || 0);

  let chartData = (status?.snapshots || []).map((s) => ({
    time: s.capturedAt,
    label: formatAxisTime(s.capturedAt),
    equity: s.equity,
    balance: s.balance
  }));
  const maxChartPoints = 120;
  if (chartData.length > maxChartPoints) {
    const k = Math.ceil(chartData.length / maxChartPoints);
    chartData = chartData.filter((_, i) => i % k === 0);
  }

  return (
    <div className="space-y-5">
      {/* Status row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2">
            <PhaseIcon className={`h-3.5 w-3.5 ${phase === 'Syncing' ? 'animate-pulse' : ''} ${connected ? 'text-emerald-500' : phase === 'Error' ? 'text-rose-500' : 'text-slate-400'}`} />
            Connection
          </div>
          <div className={`text-lg font-black ${phaseColor}`}>{phaseLabel}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2">
            <Clock className="h-3.5 w-3.5" /> Last Sync
          </div>
          <div className="text-lg font-black text-slate-800 dark:text-white">
            {timeAgo(status?.lastSyncTime || account.eaLastSyncTime)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2">Synced Trades</div>
          <div className="text-lg font-black text-slate-800 dark:text-white">
            {status?.syncTradeCount ?? account.eaSyncTradeCount ?? '—'}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <div className="text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2">MT5 Account</div>
          <div className="text-lg font-black text-slate-800 dark:text-white truncate">
            {status?.terminalLogin || account.eaTerminalLogin ? `#${status?.terminalLogin || account.eaTerminalLogin}` : 'Not reported'}
          </div>
          {(status?.terminalServer || account.eaTerminalServer) && (
            <div className="text-[10px] text-slate-400 truncate">{status?.terminalServer || account.eaTerminalServer}</div>
          )}
        </div>
      </div>

      {/* Connection state banner */}
      {phase === 'Validating' && status?.syncMethod === 'CLOUD' && status.cloudConnected && (
        <div className="flex items-center gap-3 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-xs font-semibold rounded-xl px-4 py-3">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <div className="flex-1">
            {latestCloudJob?.statusMessage || 'Provisioning your cloud terminal… this can take a few minutes. The page refreshes automatically.'}
          </div>
          {!status.workerConfigured && (
            <span className="shrink-0 font-mono text-[10px] opacity-80">worker offline</span>
          )}
        </div>
      )}
      {phase === 'Validating' && !(status?.syncMethod === 'CLOUD' && status.cloudConnected) && (
        <div className="flex items-center gap-3 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-xs font-semibold rounded-xl px-4 py-3">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <div>
            Waiting for MT5… Compile the EA (F7), attach it to a chart, and allow automated trading. The server is listening
            for the first connection. This page refreshes automatically.
          </div>
        </div>
      )}
      {phase === 'Syncing' && (
        <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-semibold rounded-xl px-4 py-3">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          <div className="flex-1">
            Connected — importing your trade history{status && status.lastDealId > 0 ? ` (last deal #${status.lastDealId})` : ''}. First sync can take a few minutes for large histories.
          </div>
          <div className="w-32 h-1.5 rounded-full bg-amber-200 dark:bg-amber-500/30 overflow-hidden shrink-0">
            <div className="h-full w-1/2 bg-amber-500 animate-pulse rounded-full" />
          </div>
        </div>
      )}
      {phase === 'Error' && (
        <div className="flex items-start gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs font-semibold rounded-xl px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            {friendlyError(latestError)}
            {latestError && (
              <div className="mt-1 font-mono text-[10px] opacity-70">{latestError.errorCode} · {timeAgo(latestError.occurredAt)}</div>
            )}
          </div>
          <button onClick={() => onRefresh()} className="shrink-0 inline-flex items-center gap-1 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg transition">
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}
      {phase === 'Disconnected' && (
        <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-xl px-4 py-3">
          <WifiOff className="h-4 w-4 shrink-0" />
          <div className="flex-1">
            This account's MT5 sync is disconnected. The EA token was revoked, so the old EA file will stop working.
            Download a fresh copy to reconnect.
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs font-semibold rounded-xl px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Disconnect confirm */}
      {showDisconnectConfirm && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500" />
            <div className="flex-1">
              <h4 className="text-sm font-bold text-rose-700 dark:text-rose-300">Disconnect this MT5 account?</h4>
              <p className="text-xs text-rose-600/80 dark:text-rose-300/80 mt-1 leading-relaxed">
                The EA authentication token will be <strong>permanently revoked</strong>. The old EA file in your
                terminal will immediately stop syncing. To reconnect later, you'll download a fresh EA with a new token.
                No trading data is deleted.
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50"
                >
                  {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                  {disconnecting ? 'Disconnecting…' : 'Yes, Disconnect'}
                </button>
                <button
                  onClick={() => setShowDisconnectConfirm(false)}
                  className="border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs font-bold px-4 py-2 rounded-lg hover:bg-white dark:hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Method Selection Cards */}
      {!connected && (
        <div className="space-y-4 mb-8">
          <h3 className="dx-section-title text-center">
            Choose Your MT5 Connection Method
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {/* Card 1: Investor Password */}
            <div
              onClick={() => setActiveTab('investor')}
              className={`cursor-pointer rounded-2xl border p-5 flex items-center gap-4 transition-all duration-200 ${
                activeTab === 'investor'
                  ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/20 ring-2 ring-indigo-600/20'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/50'
              }`}
            >
              <div className="h-10 w-10 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
                <Eye className="h-5 w-5" />
              </div>
              <div className="flex items-center gap-1.5">
                <h4 className="dx-section-title">
                  Investor Password
                </h4>
                <Crown className="h-3.5 w-3.5 text-amber-500 fill-amber-500/10 shrink-0" />
              </div>
            </div>

            {/* Card 2: MT5 EA */}
            <div
              onClick={() => setActiveTab('ea')}
              className={`cursor-pointer rounded-2xl border p-5 flex items-center gap-4 transition-all duration-200 ${
                activeTab === 'ea'
                  ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/20 ring-2 ring-indigo-600/20'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/50'
              }`}
            >
              <div className="h-10 w-10 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-500 flex items-center justify-center shrink-0">
                <Bot className="h-5 w-5" />
              </div>
              <h4 className="dx-section-title flex items-center gap-1.5">
                MT5 EA
                <span className="font-bold text-[9px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/10">
                  FREE
                </span>
              </h4>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'ea' && (
        <>
          {/* Tutorial Video Section (Compact Preview) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 flex flex-col sm:flex-row items-center gap-6">
        <div 
          onClick={() => setShowVideo(true)}
          className="relative w-full sm:w-[400px] aspect-video rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 cursor-pointer group shrink-0"
        >
          <img 
            src="https://img.youtube.com/vi/iZR4SxV2Uls/maxresdefault.jpg" 
            alt="Video Thumbnail" 
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors flex items-center justify-center">
            <div className="h-12 w-12 rounded-full bg-white text-indigo-600 flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
              <Play className="h-5 w-5 ml-1" />
            </div>
          </div>
        </div>
        <div className="flex-1 space-y-2 text-center sm:text-left">
          <h3 className="dx-section-title">How to Connect MT5 with EA</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
            Follow this step-by-step video to connect your MT5 account with the FX Journal Pro EA and start syncing your trades automatically.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: EA setup */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-indigo-500" />
            <h3 className="dx-section-title">Unique Expert Advisor for “{account.name}”</h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Download this account's dedicated MT5 Expert Advisor. The EA file is pre-configured with a unique
            authentication token that ties it to <strong>{account.name}</strong> only. Install it in your MetaTrader 5
            terminal and it will import your complete trade history, then keep syncing every new trade and account
            update in real time.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-3 rounded-xl transition disabled:opacity-50"
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {downloading ? 'Generating…' : 'Download EA (.mq5)'}
            </button>
            <button
              onClick={handleCopyCode}
              disabled={copying}
              className="flex items-center justify-center gap-2 border border-indigo-200 dark:border-indigo-500/40 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 text-xs font-bold py-3 rounded-xl transition disabled:opacity-50"
            >
              <FileCode2 className="h-4 w-4" />
              {copying ? 'Copying…' : 'Copy EA Code'}
            </button>
            <button
              onClick={() => setShowDisconnectConfirm(true)}
              disabled={disconnecting || phase === 'Disconnected'}
              className="flex items-center justify-center gap-2 border border-rose-200 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-rose-600 dark:text-rose-300 text-xs font-bold py-3 rounded-xl transition disabled:opacity-50"
            >
              <Unplug className="h-4 w-4" />
              Disconnect
            </button>
            <button
              onClick={handleReset}
              disabled={resetting}
              className="flex items-center justify-center gap-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold py-3 rounded-xl transition disabled:opacity-50"
            >
              <KeyRound className="h-4 w-4" />
              {resetting ? 'Resetting…' : 'Reset Token'}
            </button>
          </div>

          {eaCopied && (
            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-semibold rounded-xl px-4 py-3">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              EA source code copied to clipboard. Save it as a <code className="text-[10px] bg-emerald-100 dark:bg-emerald-500/20 px-1.5 py-0.5 rounded">.mq5</code> file inside <code className="text-[10px] bg-emerald-100 dark:bg-emerald-500/20 px-1.5 py-0.5 rounded">MQL5/Experts</code>.
            </div>
          )}

          {downloadedName && (
            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-semibold rounded-xl px-4 py-3">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Saved as {downloadedName}. Open it in MetaEditor, compile (F7), then attach to a chart.
            </div>
          )}

          {phase === 'Synced' && (
            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-semibold rounded-xl px-4 py-3">
              <Wifi className="h-4 w-4 shrink-0" />
              This account is connected via its EA. New trades sync automatically.
            </div>
          )}

          {/* Read-only disclaimer (1 of 2) */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-indigo-500" />
            <span>
              <strong className="text-slate-600 dark:text-slate-300">Read-only by design.</strong> This EA contains zero
              trading functions — it cannot open, modify, or close positions. It only reads your account and reports it
              to your journal. Your MT5 Investor Password is never entered or stored anywhere on this site.
            </span>
          </div>
        </div>

        {/* Right: install steps */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6">
          <h3 className="dx-section-title mb-4">Install in 3 Steps</h3>
          <ol className="space-y-4">
            <li className="flex gap-3">
              <span className="h-6 w-6 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-xs font-black flex items-center justify-center shrink-0">1</span>
              <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <strong>Allow the connection</strong> in MT5: <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">Tools → Options → Expert Advisors</code>,
                tick “Allow WebRequest for listed URL” and add:
                <button
                  onClick={copyUrl}
                  className="ml-1 inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
                >
                  {host} <Copy className="h-3 w-3" />
                </button>
                {copied && <span className="ml-1 text-emerald-600 font-bold">Copied!</span>}
              </div>
            </li>
            <li className="flex gap-3">
              <span className="h-6 w-6 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-xs font-black flex items-center justify-center shrink-0">2</span>
              <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <strong>Install the EA:</strong> save the downloaded <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">.mq5</code> file into{' '}
                <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">MQL5/Experts</code> (open via{' '}
                <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">File → Open Data Folder</code>),
                open it in MetaEditor and press <strong>F7</strong> to compile.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="h-6 w-6 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-xs font-black flex items-center justify-center shrink-0">3</span>
              <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <strong>Attach it to any chart</strong> and allow automated trading. The EA authenticates instantly,
                imports your full history, then stays connected for real-time sync. This page updates automatically —
                no manual refresh needed.
              </div>
            </li>
          </ol>
          </div>
        </div>
        </>
      )}

      {activeTab === 'investor' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-slate-500" />
            <h3 className="dx-section-title">Cloud Sync with Investor Password</h3>
          </div>
          {status?.syncMethod === 'CLOUD' && status.cloudConnected && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold px-2.5 py-1">
              <Wifi className="h-3 w-3" /> Cloud connected
            </span>
          )}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          No EA installation needed — enter your broker login, server, and <strong>Investor (read-only) password</strong> and
          our cloud sync connects to your account for you. The password is <strong>encrypted before storage</strong> and is never
          stored in plaintext or shown again.
        </p>

        {cloudError && (
          <div className="flex items-center gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs font-semibold rounded-xl px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {cloudError}
          </div>
        )}

        {status?.syncMethod === 'CLOUD' && status.cloudConnected ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Sync Method</div>
                <div className="text-sm font-black text-slate-800 dark:text-white">Cloud</div>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">MT5 Login</div>
                <div className="text-sm font-black text-slate-800 dark:text-white truncate">{status.terminalLogin || account.eaTerminalLogin || '—'}</div>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Server</div>
                <div className="text-sm font-black text-slate-800 dark:text-white truncate">{status.terminalServer || account.eaTerminalServer || '—'}</div>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Status</div>
                <div className="text-sm font-black text-slate-800 dark:text-white">{status.status}</div>
              </div>
            </div>
            {status.connectJobs && status.connectJobs.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {status.connectJobs.map((j) => (
                  <div key={j.id} className="inline-flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 px-3 py-1.5 text-xs">
                    <span className="font-black text-slate-700 dark:text-slate-200">{j.action}</span>
                    <span className={`font-bold ${j.status === 'FAILED' ? 'text-rose-500' : j.status === 'CONNECTED' || j.status === 'DONE' ? 'text-emerald-600' : 'text-indigo-500'}`}>{j.status}</span>
                    {j.statusMessage && <span className="text-slate-500">{j.statusMessage}</span>}
                    {(j.errorCode || j.errorMessage) && (
                      <span className="text-rose-500 font-bold" title={j.errorMessage || ''}>
                        {j.errorCode || 'error'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={handleCloudDisconnect}
                disabled={cloudBusy}
                className="inline-flex items-center gap-1.5 border border-rose-200 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-rose-600 dark:text-rose-300 text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50"
              >
                {cloudBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                Disconnect Cloud Sync
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); handleCloudConnect(); }}
            className="space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5" htmlFor="cloudLogin">MT5 Login</label>
                <input
                  id="cloudLogin"
                  type="text"
                  value={cloudLogin}
                  onChange={(e) => setCloudLogin(e.target.value)}
                  required
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="e.g. 51012345"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white text-xs px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5" htmlFor="cloudServer">Broker Server</label>
                <input
                  id="cloudServer"
                  type="text"
                  value={cloudServer}
                  onChange={(e) => setCloudServer(e.target.value)}
                  required
                  autoComplete="off"
                  placeholder="e.g. ICMarkets-Demo"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white text-xs px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400" htmlFor="cloudPassword">Investor Password</label>
                <button
                  type="button"
                  onClick={() => setShowInfoModal(true)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition shrink-0"
                  title="How to find Investor Password"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                id="cloudPassword"
                type="password"
                value={cloudPassword}
                onChange={(e) => setCloudPassword(e.target.value)}
                required
                autoComplete="off"
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white text-xs px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>
            <button
              type="submit"
              disabled={cloudBusy}
              className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-900 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold px-4 py-2.5 rounded-xl transition disabled:opacity-50"
            >
              {cloudBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {cloudBusy ? 'Connecting…' : 'Connect Cloud Sync'}
            </button>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-indigo-500" />
              <span>
                Your Investor Password is encrypted with AES-256-GCM the moment you submit, never logged, and is only used
                to establish the read-only connection. <strong className="text-slate-600 dark:text-slate-300">Use your Investor
                password (read-only) — never your main trading password.</strong>
              </span>
            </div>
          </form>
        )}
      </div>
      )}

      {/* Live sync status */}
      {(connected || status?.lastSyncTime) && status && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="dx-section-title">Live Sync Status</h3>
            <div className="flex items-center gap-3">
              {status?.syncMethod === 'CLOUD' && (
                <button 
                  onClick={handleCloudSync} 
                  disabled={phase === 'Syncing' || phase === 'Validating'} 
                  className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${phase === 'Syncing' || phase === 'Validating' ? 'animate-spin' : ''}`} /> 
                  {phase === 'Syncing' || phase === 'Validating' ? 'Syncing...' : 'Sync Now'}
                </button>
              )}
              <button onClick={pollStatus} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:underline">
                <RefreshCw className={`h-3.5 w-3.5 ${phase === 'Syncing' ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Equity</div>
              <div className="text-sm font-black text-slate-800 dark:text-white">{formatMoney(status.equity)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Balance</div>
              <div className="text-sm font-black text-slate-800 dark:text-white">{formatMoney(status.currentBalance)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Open Positions</div>
              <div className="text-sm font-black text-slate-800 dark:text-white">{status.openPositions.length}</div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Pending Orders</div>
              <div className="text-sm font-black text-slate-800 dark:text-white">{status.pendingOrders.length}</div>
            </div>
          </div>

          {status.openPositions.length > 0 && (
            <div>
              <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">Open Positions</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                      <th className="pb-2 font-bold">Symbol</th>
                      <th className="pb-2 font-bold">Side</th>
                      <th className="pb-2 font-bold">Volume</th>
                      <th className="pb-2 font-bold">Open</th>
                      <th className="pb-2 font-bold">Current</th>
                      <th className="pb-2 font-bold text-right">Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {status.openPositions.map((p) => (
                      <tr key={p.positionId}>
                        <td className="py-2 font-bold text-slate-700 dark:text-slate-200">{p.symbol}</td>
                        <td className={`py-2 font-bold ${p.side === 'Buy' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{p.side}</td>
                        <td className="py-2 text-slate-500">{p.volume}</td>
                        <td className="py-2 text-slate-500">{formatPrice(p.openPrice)}</td>
                        <td className="py-2 text-slate-500">{formatPrice(p.currentPrice)}</td>
                        <td className={`py-2 text-right font-bold ${p.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {p.profit >= 0 ? '+' : ''}{formatMoney(p.profit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {status.pendingOrders.length > 0 && (
            <div>
              <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">Pending Orders</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                      <th className="pb-2 font-bold">Symbol</th>
                      <th className="pb-2 font-bold">Type</th>
                      <th className="pb-2 font-bold">Volume</th>
                      <th className="pb-2 font-bold">Price</th>
                      <th className="pb-2 font-bold">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {status.pendingOrders.map((o) => (
                      <tr key={o.orderId}>
                        <td className="py-2 font-bold text-slate-700 dark:text-slate-200">{o.symbol}</td>
                        <td className="py-2 text-slate-500">{o.type}</td>
                        <td className="py-2 text-slate-500">{o.volume}</td>
                        <td className="py-2 text-slate-500">{formatPrice(o.openPrice)}</td>
                        <td className="py-2 text-slate-500">{o.state}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {status.moneyFlows.length > 0 && (
            <div>
              <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">Deposits &amp; Withdrawals</h4>
              <div className="flex flex-wrap gap-2">
                {status.moneyFlows.slice(0, 12).map((f) => (
                  <div key={f.ticket} className="inline-flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 px-3 py-1.5 text-xs">
                    {f.flowType === 'WITHDRAWAL' ? (
                      <ArrowDownRight className="h-3.5 w-3.5 text-rose-500" />
                    ) : f.flowType === 'DEPOSIT' ? (
                      <ArrowRight className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <CircleDollarSign className="h-3.5 w-3.5 text-amber-500" />
                    )}
                    <span className="font-black text-slate-700 dark:text-slate-200">{f.flowType}</span>
                    <span className={`font-bold ${f.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {f.amount >= 0 ? '+' : ''}{formatMoney(f.amount, f.currency)}
                    </span>
                    <span className="text-[10px] text-slate-400">{timeAgo(f.time)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Performance dashboard */}
      {((status?.snapshots || []).length > 0 || (status?.moneyFlows || []).length > 0 || (status?.openPositions || []).length > 0) && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-indigo-500" />
            <h3 className="dx-section-title">Performance</h3>
          </div>

          {chartData.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-400">Equity Curve</h4>
                <div className="flex items-center gap-3 text-[10px] font-bold">
                  <span className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                    <span className="h-2 w-2 rounded-full bg-indigo-500" /> Equity
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                    <span className="h-2 w-2 rounded-full bg-slate-400" /> Balance
                  </span>
                </div>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} stroke="currentColor" className="text-slate-400" />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} domain={['auto', 'auto']} tickFormatter={formatChartMoney} stroke="currentColor" className="text-slate-400" />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, fontSize: 12, background: '#ffffff', border: '1px solid #e2e8f0', color: '#0f172a' }}
                      labelStyle={{ fontWeight: 700 }}
                      formatter={(value) => [formatMoney(Number(value), currency), undefined]}
                      labelFormatter={(label) => `Time: ${label}`}
                    />
                    <Area type="monotone" dataKey="balance" name="Balance" stroke="#94a3b8" strokeWidth={1.5} dot={false} fill="none" />
                    <Area type="monotone" dataKey="equity" name="Equity" stroke="#6366f1" strokeWidth={2} dot={false} fill="url(#equityFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Net P&amp;L</div>
              <div className={`text-sm font-black ${netPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {netPnl >= 0 ? '+' : ''}{formatMoney(netPnl, currency)}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Starting Balance</div>
              <div className="text-sm font-black text-slate-800 dark:text-white">{formatMoney(status?.startingBalance || 0, currency)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Deposits</div>
              <div className="text-sm font-black text-emerald-600 dark:text-emerald-400">{formatMoney(totalDeposits, currency)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Withdrawals</div>
              <div className="text-sm font-black text-rose-600 dark:text-rose-400">{formatMoney(totalWithdrawals, currency)}</div>
            </div>
          </div>

          {status?.openPositions.length ? (
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 px-3 py-2.5 text-xs">
              <Landmark className="h-4 w-4 shrink-0 text-indigo-500" />
              <span className="font-bold text-slate-600 dark:text-slate-300">Floating P&amp;L on {status.openPositions.length} open position{status.openPositions.length === 1 ? '' : 's'}:</span>
              <span className={`font-black ${floatingPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {floatingPnl >= 0 ? '+' : ''}{formatMoney(floatingPnl, currency)}
              </span>
            </div>
          ) : null}
        </div>
      )}

      {/* Video Modal */}
      {showVideo && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <div 
            className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"
            onClick={() => setShowVideo(false)}
          ></div>
          <div className="relative z-10 w-full max-w-5xl bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/10 ring-1 ring-white/10">
            <button 
              onClick={() => setShowVideo(false)}
              className="absolute top-4 right-4 z-20 h-10 w-10 bg-black/50 hover:bg-black/80 text-white rounded-full flex items-center justify-center transition-colors border border-white/20"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="w-full aspect-video bg-black">
              <iframe 
                className="w-full h-full"
                src="https://www.youtube.com/embed/iZR4SxV2Uls?autoplay=1" 
                title="How to Connect MT5 with EA"
                frameBorder="0" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                allowFullScreen
              ></iframe>
            </div>
          </div>
        </div>
      )}

      {/* Investor Password Info Modal */}
      {showInfoModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <div 
            className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"
            onClick={() => setShowInfoModal(false)}
          ></div>
          <div className="relative z-10 w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800">
            <button 
              onClick={() => setShowInfoModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition"
              title="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="space-y-4">
              <div className="h-10 w-10 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h3 className="dx-section-title">How to Find Your MT5 Investor Password</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  An Investor Password provides read-only access to your account. Here is how to find or reset it in MetaTrader 5:
                </p>
              </div>
              <ol className="space-y-3 text-xs text-slate-600 dark:text-slate-300 list-decimal pl-4 leading-relaxed">
                <li>
                  Open <strong>MetaTrader 5</strong> and log in to your account.
                </li>
                <li>
                  Go to the <strong>Navigator</strong> window (usually on the left side).
                </li>
                <li>
                  Right-click your account number and select <strong>Change Password</strong>.
                </li>
                <li>
                  Choose <strong>Change investor (read-only) password</strong>.
                </li>
                <li>
                  Enter your current main password, then set and confirm your new investor password.
                </li>
              </ol>
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-300 p-3 rounded-xl text-[11px] font-medium leading-relaxed">
                <strong>Security Notice:</strong> Always use your investor password. Never enter your main trading password to protect your funds.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

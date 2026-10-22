import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  Download,
  RefreshCw,
  Wifi,
  WifiOff,
  Terminal,
  Clock,
  KeyRound,
  AlertTriangle,
  ShieldCheck,
  Plus,
  Copy,
  Loader2,
  Unplug,
  ArrowRight,
  ArrowDownRight,
  CircleDollarSign,
  XCircle,
  TrendingUp,
  Landmark,
  X,
  Info,
  HelpCircle
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
  /** True only where this deployment can actually run the cloud sync worker. */
  cloudSyncAvailable?: boolean;
  /** True only where the self-hosted VPS worker pool is configured. */
  vpsSyncAvailable?: boolean;
  /**
   * When a worker last claimed a job, anywhere — null means no worker has ever
   * turned up. Configured (`vpsSyncAvailable`) is not the same as running, and
   * the difference is whether "In Queue" means "soon" or "never".
   */
  workerLastSeenAt?: string | null;
  /** When this account's oldest waiting job was queued. */
  queuedSince?: string | null;
  queueDepth?: number;
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
  | 'Queued'
  | 'Connected'
  | 'Syncing'
  | 'Synced'
  | 'Error'
  | 'Disconnected'
  | 'Incorrect Password';

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
  CLOUD_WORKER_UNAVAILABLE: 'Automatic sync worker is currently offline or not configured. Use the MT5 EA method, which syncs directly inside your MT5 terminal.',
  INVALID_PASSWORD: 'The investor password was rejected by the broker. Check it and try again.',
  E_AUTH: 'The investor password was rejected by the broker. Use the read-only Investor password (not your main password) and check the broker server name.',
  E_SRV_NOT_FOUND: 'The broker server could not be found. Check the exact server name shown in MetaTrader (Help → About).',
  E_SERVER_TIMEZONE: 'The broker server timezone could not be detected. Cloud provisioning may need manual setup.',
  E_RESOURCE_SLOTS: 'The sync service has no free resource slots left. Please retry shortly or use the EA method.',
  E_MAIN_SERVERS: 'The sync worker could not reach the broker server. Please check broker server status and try again.',
  E_ACCOUNT_NOT_FOUND: 'The MetaTrader account was not found on this broker. Double-check the login number and broker server.',
  CLOUD_TIMEOUT: 'Connection timed out while connecting to MT5. Starting the connection can take a moment — please try again.',
  CLOUD_SYNC_FAILED: 'Automatic sync hit an unexpected error. Please retry or use the EA method.',
  CLOUD_SYNC_LOST: 'The MT5 connection was lost. Reconnect to re-authenticate.',
  CLOUD_CREDENTIALS: 'The stored investor credentials could not be decrypted. Reconnect to re-enter the password.',
  MT5_LOGIN_FAILED: 'Broker rejected login. Double-check your MT5 login number, investor password, and exact broker server name.',
  BAD_LOGIN: 'The MT5 login number must contain only numeric digits.',
  MT5_NO_ACCOUNT_INFO: 'MT5 logged in, but the broker returned no account details. Verify that the account is active with your broker.',
  MT5_WRONG_LOGIN: 'The MT5 terminal is active on a different account number than expected. Check your account settings.',
  MT5_HISTORY_FAILED: 'Could not fetch trade history from the broker server. Check broker connectivity or server scan.',
  VPS_SYNC_FAILED: 'Automatic sync failed to connect to your MT5 account. Please verify your login, investor password, and broker server name.',
  WORKER_CRASH: 'The sync worker encountered an unexpected issue while communicating with MT5.',
  BACKEND_ERROR: 'Server communication error during sync. Please try again shortly.',
  EA_TIMESTAMP_SKEW: 'Computer system clock is skewed by more than 5 minutes. Please synchronize your system time.',
  EA_WEBREQUEST_BLOCKED: 'MT5 WebRequest was blocked.',
  BRIDGE_NOT_CONFIGURED: 'Automatic worker sync is not configured on this server.',
  VPS_NOT_CONFIGURED: 'Automatic VPS sync is not configured on this server.'
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
  // VPS sync state
  const [vpsLogin, setVpsLogin] = useState('');
  const [vpsServer, setVpsServer] = useState('');
  const [vpsPassword, setVpsPassword] = useState('');
  const [vpsBusy, setVpsBusy] = useState(false);
  const [vpsSyncing, setVpsSyncing] = useState(false);
  const [syncProgressText, setSyncProgressText] = useState<string>('');
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string>('');
  const [showVideo, setShowVideo] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showPasswordTip, setShowPasswordTip] = useState(false);
  const [activeTab, setActiveTab] = useState<'ea' | 'investor' | 'vps'>('vps');
  const [connectElapsed, setConnectElapsed] = useState(0);
  const [retrying, setRetrying] = useState(false);

  // The server decides: it knows whether a worker can run here at all.
  // Defaults to false so a status that has not arrived yet never advertises a
  // method that may not work.
  const cloudAvailable = status?.cloudSyncAvailable === true;
  const vpsAvailable = status?.vpsSyncAvailable === true;

  /**
   * Has a worker actually been seen recently, rather than merely allowed?
   *
   * Ten minutes, because a worker polls every few seconds but may be busy on a
   * long history pull for another account, and the claim that stamps this is
   * the start of the job, not its end.
   */
  const WORKER_PRESENCE_MS = 10 * 60 * 1000;
  const workerOnline = !!status?.workerLastSeenAt
    && Date.now() - new Date(status.workerLastSeenAt).getTime() < WORKER_PRESENCE_MS;

  /** A job that has waited this long with no worker in sight is not queued, it is stuck. */
  const queuedTooLong = !!status?.queuedSince
    && Date.now() - new Date(status.queuedSince).getTime() > 2 * 60 * 1000;

  /** Nothing is going to drain this queue. Say so instead of spinning. */
  const queueStalled = queuedTooLong && !workerOnline;

  useEffect(() => {
    setActiveTab('vps');
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    const isConnecting =
      status?.status === 'Queued' ||
      status?.status === 'Validating' ||
      status?.status === 'Syncing' ||
      vpsBusy ||
      (status?.syncMethod === 'VPS' && (status?.connectJobs || []).some((j) => j.status === 'PENDING' || j.status === 'RUNNING'));

    if (isConnecting) {
      timer = setInterval(() => {
        setConnectElapsed((s) => s + 1);
      }, 1000);
    } else {
      setConnectElapsed(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [status?.status, status?.syncMethod, status?.connectJobs, vpsBusy]);

  const host = typeof window !== 'undefined' ? window.location.host : 'www.fxjournalpro.com';
  const apiUrl = `${window.location.protocol}//${host}/api/mt5`;

  const prevSyncCountRef = useRef<number | null>(null);
  const prevSyncTimeRef = useRef<string | null>(null);
  const prevStatusRef = useRef<string | null>(null);

  const pollStatus = useCallback(async () => {
    if (!account) return;
    try {
      const res = await authFetch(`/api/mt5/${account.id}/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setError('');

        const isFirstPoll = prevStatusRef.current === null;
        const countChanged = prevSyncCountRef.current !== null && data.syncTradeCount !== prevSyncCountRef.current;
        const statusBecameConnected = prevStatusRef.current !== null && prevStatusRef.current !== 'Connected' && data.status === 'Connected';
        const syncTimeChanged = prevSyncTimeRef.current !== null && data.lastSyncTime && data.lastSyncTime !== prevSyncTimeRef.current;

        prevSyncCountRef.current = data.syncTradeCount ?? 0;
        prevStatusRef.current = data.status ?? '';
        prevSyncTimeRef.current = data.lastSyncTime ?? '';

        // Auto-refresh the entire dashboard & profile when MT5 syncs trades or connects
        if (!isFirstPoll && (countChanged || statusBecameConnected || syncTimeChanged)) {
          onRefresh();
        } else if (isFirstPoll && (
          (data.syncTradeCount > 0 && !(account as any).eaSyncTradeCount) ||
          (data.status === 'Connected' && (account as any).connectionStatus !== 'Connected') ||
          (data.currentBalance && data.currentBalance !== account.currentBalance)
        )) {
          onRefresh();
        }
      }
    } catch {
      // keep last known status on transient failures
    }
  }, [account, authFetch, onRefresh]);

  useEffect(() => {
    if (!account) return;
    pollStatus();
    const id = setInterval(pollStatus, 2500);
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

  // ── VPS sync handlers with smart polling & live progress ─────────────

  async function handleVpsConnect() {
    if (!account) return;
    setVpsBusy(true);
    setVpsError('');
    setSyncSuccessMsg('');
    setSyncProgressText('Authenticating with MT5 broker server...');
    try {
      const res = await authFetch('/api/mt5/vps/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: account.id,
          login: vpsLogin.trim(),
          server: vpsServer.trim(),
          investorPassword: vpsPassword
        })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setVpsError(d.error || 'Could not connect to MT5. Please try again.');
        return;
      }
      setVpsPassword('');
      setVpsLogin('');
      setVpsServer('');

      const targetJobId = d.jobId;
      setSyncProgressText('Worker connecting to MT5 terminal...');

      // Smart polling: wait until worker authenticates and finishes
      const startTime = Date.now();
      const maxWaitMs = 45000;
      let completed = false;

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 1800));
        try {
          const statusRes = await authFetch(`/api/mt5/${account.id}/status`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            setStatus(statusData);

            const matchingJob = targetJobId
              ? (statusData.connectJobs || []).find((j: any) => j.id === targetJobId)
              : (statusData.connectJobs || []).slice(-1)[0];

            if (matchingJob) {
              if (matchingJob.status === 'RUNNING') {
                setSyncProgressText('Credentials verified! Downloading initial trade history...');
              } else if (matchingJob.status === 'DONE') {
                setSyncSuccessMsg('Connected successfully! Initial trades imported into journal.');
                completed = true;
                onRefresh();
                break;
              } else if (matchingJob.status === 'FAILED') {
                setVpsError(matchingJob.error || matchingJob.errorMessage || 'MT5 authorization failed. Please check login number, investor password and server name.');
                completed = true;
                break;
              }
            } else if (statusData.status === 'Connected') {
              setSyncSuccessMsg('Connected successfully! Trades imported.');
              completed = true;
              onRefresh();
              break;
            }
          }
        } catch {
          // ignore transient poll error
        }
      }

      if (!completed) {
        await pollStatus();
        onRefresh();
      }
    } catch (e) {
      setVpsError('Could not connect to MT5. Please try again.');
    } finally {
      setVpsBusy(false);
      setTimeout(() => {
        setSyncProgressText('');
        setSyncSuccessMsg('');
      }, 5000);
    }
  }

  async function handleVpsSync() {
    if (!account) return;
    setVpsSyncing(true);
    setVpsError('');
    setSyncSuccessMsg('');
    setSyncProgressText('Queuing MT5 sync job...');
    try {
      const res = await authFetch('/api/mt5/vps/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: account.id })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setVpsError(d.error || 'Sync request failed. Please try again.');
        return;
      }

      const targetJobId = d.jobId;
      setSyncProgressText('Waiting for MT5 worker to claim job...');

      // Smart polling: wait for background worker to claim and sync deals
      const startTime = Date.now();
      const maxWaitMs = 45000; // 45 seconds max wait
      let completed = false;

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 1800));
        try {
          const statusRes = await authFetch(`/api/mt5/${account.id}/status`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            setStatus(statusData);

            const matchingJob = targetJobId
              ? (statusData.connectJobs || []).find((j: any) => j.id === targetJobId)
              : (statusData.connectJobs || []).slice(-1)[0];

            if (matchingJob) {
              if (matchingJob.status === 'RUNNING') {
                setSyncProgressText('Connected to MT5 terminal! Downloading new trades & closed deals...');
              } else if (matchingJob.status === 'DONE') {
                const count = statusData.syncTradeCount ?? 0;
                setSyncSuccessMsg(`Sync complete! ${count} trades updated in your journal.`);
                completed = true;
                onRefresh();
                break;
              } else if (matchingJob.status === 'FAILED') {
                setVpsError(matchingJob.error || matchingJob.errorMessage || 'MT5 Sync failed. Please verify your investor password or broker server.');
                completed = true;
                break;
              }
            } else if (statusData.status === 'Connected') {
              setSyncSuccessMsg('Sync complete! Journal updated.');
              completed = true;
              onRefresh();
              break;
            }
          }
        } catch {
          // ignore transient errors
        }
      }

      if (!completed) {
        await pollStatus();
        onRefresh();
      }
    } catch (e) {
      setVpsError('Sync request failed. Please try again.');
    } finally {
      setVpsSyncing(false);
      setTimeout(() => {
        setSyncProgressText('');
        setSyncSuccessMsg('');
      }, 5000);
    }
  }

  async function handleRetryConnection() {
    if (!account) return;
    setRetrying(true);
    setError('');
    setVpsError('');
    try {
      const res = await authFetch(`/api/mt5/${account.id}/retry`, {
        method: 'POST'
      });
      const data = await res.json().catch(() => ({}));
      if (!data.retried) {
        setStatus((prev) => prev ? {
          ...prev,
          status: 'Not Started',
          connectJobs: (prev.connectJobs || []).filter(j => j.status !== 'FAILED'),
          lastErrors: []
        } : null);
        setActiveTab('vps');
        setTimeout(() => {
          const el = document.getElementById('vpsLogin') || document.getElementById('vpsServer');
          if (el) el.focus();
        }, 100);
      }
      await pollStatus();
      onRefresh();
    } catch {
      onRefresh();
    } finally {
      setRetrying(false);
    }
  }

  async function handleVpsDisconnect() {
    if (!account) return;
    setVpsBusy(true);
    setVpsError('');
    try {
      const res = await authFetch(`/api/mt5/${account.id}/disconnect`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setVpsError(d.error || 'Disconnect failed. Please try again.');
        return;
      }
      setShowDisconnectConfirm(false);
      setStatus(null);
      onRefresh();
    } catch (e) {
      setVpsError('Disconnect failed. Please try again.');
    } finally {
      setVpsBusy(false);
    }
  }

  function derivePhase(): Phase {
    if (downloading || copying || resetting) return 'Collecting';

    // Helper: detect credential/auth failures across jobs and unresolved errors
    const AUTH_CODES = ['MT5_LOGIN_FAILED', 'INVALID_PASSWORD', 'E_AUTH', 'AUTH_FAILED', 'INVESTOR_PASSWORD_REJECTED', 'MT5_WRONG_LOGIN'];
    const isAuthError = (code?: string | null, msg?: string | null) =>
      AUTH_CODES.includes(code ?? '') || /password|login.?fail|auth.?fail|invalid.?account/i.test(msg ?? '');
    const hasAuthFailedJob = (status?.connectJobs || []).some(
      (j) => j.status === 'FAILED' && isAuthError(j.errorCode, j.errorMessage ?? j.lastError ?? j.statusMessage)
    );
    const hasAuthUnresolved = (status?.lastErrors || []).some(
      (e) => !e.resolvedAt && isAuthError(e.errorCode, e.errorMessage)
    );

    // Any authentication failure takes precedence
    if (hasAuthFailedJob || hasAuthUnresolved) return 'Incorrect Password';

    // Any active/pending VPS job takes precedence over past failed jobs!
    const pendingVps = (status?.connectJobs || []).some((j) => j.status === 'PENDING' || j.status === 'RUNNING');
    if (pendingVps) return 'Queued';

    // Check for any failed connect job or unresolved errors BEFORE defaulting to Validating!
    const lastJob = (status?.connectJobs || [])[(status?.connectJobs || []).length - 1];
    const failedJob = lastJob && lastJob.status === 'FAILED' ? lastJob : (status?.connectJobs || []).slice().reverse().find((j) => j.status === 'FAILED');
    const unresolved = (status?.lastErrors || []).filter((e) => !e.resolvedAt);

    if (status?.status === 'Error' || status?.eaStatus === 'Error') return 'Error';
    if (!pendingVps && failedJob) return 'Error';
    if (!pendingVps && unresolved.length > 0 && status) return 'Error';

    // VPS method
    if (status?.syncMethod === 'VPS' && status.cloudConnected) {
      if (status.eaStatus === 'Connected' || status.status === 'Connected') return 'Synced';
      if (status.status === 'Queued') return 'Queued';
      if (status.status === 'Disconnected') return 'Disconnected';
      const pendingVps = (status.connectJobs || []).some((j) => j.status === 'PENDING' || j.status === 'RUNNING');
      if (pendingVps) return 'Queued';
      return 'Validating';
    }
    // Cloud (MetaApi) method
    if (status?.syncMethod === 'CLOUD' && status.cloudConnected) {
      if (status.status === 'Connected') return 'Synced';
      if (status.status === 'Disconnected') return 'Disconnected';
      return 'Validating';
    }
    if (status?.status === 'Disconnected' || status?.eaStatus === 'Disconnected') return 'Disconnected';
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
          Create a portfolio account first to connect your MetaTrader 5 account.
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
    : phase === 'Error' || phase === 'Incorrect Password'
      ? XCircle
      : phase === 'Disconnected'
        ? WifiOff
        : phase === 'Validating' || phase === 'Queued'
          ? Loader2
          : Terminal;
  const PhaseIcon = phaseIcon;

  const phaseLabel =
    phase === 'Synced'
      ? 'Connected'
      : phase === 'Syncing'
        ? 'Syncing'
        : phase === 'Queued'
          ? 'Connecting'
          : phase === 'Incorrect Password'
            ? 'Incorrect Password'
            : phase;
  const phaseColor =
    phase === 'Synced'
      ? 'text-emerald-600 dark:text-emerald-400'
      : phase === 'Syncing'
        ? 'text-amber-600 dark:text-amber-400'
        : phase === 'Queued'
          ? 'text-indigo-600 dark:text-indigo-400'
          : phase === 'Error'
            ? 'text-rose-600 dark:text-rose-400'
            : phase === 'Incorrect Password'
              ? 'text-rose-600 dark:text-rose-400'
              : phase === 'Disconnected'
                ? 'text-slate-500 dark:text-slate-400'
                : 'text-indigo-600 dark:text-indigo-400';

  const unresolvedError = (status?.lastErrors || []).filter((e) => !e.resolvedAt)[0];
  const failedConnectJob = (status?.connectJobs || []).slice().reverse().find((j) => j.status === 'FAILED');
  const latestError = unresolvedError || (failedConnectJob ? {
    errorCode: failedConnectJob.errorCode || 'VPS_SYNC_FAILED',
    errorMessage: failedConnectJob.errorMessage || (failedConnectJob as any).error || (failedConnectJob as any).statusMessage || 'MT5 connection failed',
    occurredAt: (failedConnectJob as any).finishedAt || (failedConnectJob as any).updatedAt || new Date().toISOString(),
    resolvedAt: null
  } : undefined);
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
      {/* Queued with a worker running is a promise. Queued with no worker is a
          dead end, and a spinner over "will connect automatically" is a lie
          that costs the customer a support ticket to discover. */}
      {phase === 'Queued' && status?.syncMethod === 'VPS' && !queueStalled && (
        <div className="relative overflow-hidden rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-950/40 via-slate-900/90 to-indigo-950/40 p-4 sm:p-5 shadow-[0_8px_30px_rgba(139,92,246,0.14)]">
          {/* Ambient glow */}
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-violet-600/10 rounded-full blur-2xl pointer-events-none" />

          <div className="relative z-10 space-y-3.5">
            {/* Header row */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="relative flex items-center justify-center h-10 w-10 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-400 shrink-0">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-500"></span>
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-white tracking-tight">
                      Connecting to MT5 Broker
                    </h4>
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/35">
                      <Clock className="w-3 h-3" /> ~1 min wait
                    </span>
                    {status.queueDepth && status.queueDepth > 1 ? (
                      <span className="text-[10px] font-mono text-slate-400">
                        ({status.queueDepth} in queue)
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Please wait about 1 minute while we securely connect to your broker and sync your trading history.
                  </p>
                </div>
              </div>

              {/* Real-time elapsed badge */}
              <div className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-xl bg-slate-900/90 border border-white/10 text-slate-300 shrink-0">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Elapsed: <strong className="text-white font-bold">{connectElapsed}s</strong></span>
              </div>
            </div>

            {/* Live Progress Bar */}
            <div className="space-y-1.5 pt-1">
              <div className="w-full h-2 bg-slate-800/90 rounded-full overflow-hidden border border-white/5">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 via-indigo-500 to-emerald-400 rounded-full transition-all duration-1000 ease-out shadow-[0_0_12px_rgba(139,92,246,0.6)]"
                  style={{
                    width: `${Math.min(94, Math.max(12, Math.round((connectElapsed / 55) * 100)))}%`
                  }}
                />
              </div>

              {/* Live Status text */}
              <div className="flex items-center justify-between text-[11px] text-slate-400 flex-wrap gap-2 pt-0.5">
                <span className="flex items-center gap-2 text-violet-300 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-ping"></span>
                  {connectElapsed < 12
                    ? `Step 1/3: Dispatching secure worker to ${status?.terminalServer || account?.eaTerminalServer || account?.broker || 'broker server'}...`
                    : connectElapsed < 28
                    ? 'Step 2/3: Authorizing read-only Investor credentials with broker...'
                    : connectElapsed < 48
                    ? 'Step 3/3: Downloading trade history, deals & calculating balances...'
                    : 'Finalizing synchronization & journal analytics...'}
                </span>
                <span className="text-[10px] text-slate-400 font-medium">
                  Please keep this page open &bull; Auto-refreshes
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
      {phase === 'Queued' && status?.syncMethod === 'VPS' && queueStalled && (
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-200 text-xs font-semibold rounded-xl px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
          <div className="flex-1 space-y-1">
            <p>Your sync is waiting, but nothing has picked it up yet.</p>
            <p className="font-medium opacity-90">
              Your details are saved and the job stays in the queue — it will run as soon as Auto Sync processes the queue.
              Nothing needs re-entering.
            </p>
          </div>
        </div>
      )}
      {phase === 'Incorrect Password' && (
        <div className="flex items-start gap-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200 text-xs font-semibold rounded-xl px-4 py-3">
          <XCircle className="h-4 w-4 shrink-0 mt-px text-rose-500" />
          <div className="flex-1 space-y-1">
            <p className="font-bold">Incorrect MT5 Password</p>
            <p className="font-medium opacity-90">
              The broker rejected the password for MT5 login{' '}
              {status?.terminalLogin || account?.eaTerminalLogin ? `#${status?.terminalLogin || account?.eaTerminalLogin}` : ''}.
              {' '}Please make sure you are using the read-only <strong>Investor password</strong>, not your main account password.
              Re-enter your credentials below and try again.
            </p>
          </div>
        </div>
      )}
      {phase === 'Validating' && status?.syncMethod === 'CLOUD' && status.cloudConnected && (
        <div className="flex items-center gap-3 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-xs font-semibold rounded-xl px-4 py-3">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <div className="flex-1">
            {latestCloudJob?.statusMessage || 'Provisioning your cloud terminal… this can take a few minutes. The page refreshes automatically.'}
          </div>
          {!status.workerConfigured && (
            <span className="shrink-0 font-mono text-[10px] opacity-80">sync offline</span>
          )}
        </div>
      )}
      {phase === 'Validating' && status?.syncMethod === 'VPS' && (
        <div className="flex items-start gap-3 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-xs font-semibold rounded-xl px-4 py-3.5">
          <Loader2 className="h-4 w-4 shrink-0 mt-0.5 animate-spin text-indigo-600 dark:text-indigo-400" />
          <div className="flex-1 space-y-1.5">
            <p className="font-bold text-sm text-indigo-900 dark:text-indigo-100">Validating MT5 Broker Connection…</p>
            <p className="font-normal opacity-90 leading-relaxed text-indigo-800 dark:text-indigo-200">
              Contacting broker server <strong>{status?.terminalServer || account?.eaTerminalServer || account?.broker || 'MT5 Server'}</strong> for login <strong>#{status?.terminalLogin || account?.eaTerminalLogin || account?.mt5Login || '—'}</strong>. This verification usually takes 15–30 seconds.
            </p>
            {!workerOnline && (
              <div className="mt-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 text-[11px] font-normal space-y-1">
                <p className="font-bold flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  Auto Sync Worker Connecting…
                </p>
                <p>
                  Waiting for the background sync worker to pick up this validation job. Please allow a few moments.
                </p>
              </div>
            )}
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
        <div className="flex items-start gap-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200 text-xs font-semibold rounded-xl px-4 py-3.5">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
          <div className="flex-1 space-y-2">
            <div>
              <div className="font-bold text-sm text-rose-900 dark:text-rose-100 flex items-center gap-2">
                MT5 Connection Issue Detected
                {latestError?.errorCode && (
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-200/60 dark:bg-rose-500/20 text-rose-800 dark:text-rose-200">
                    {latestError.errorCode}
                  </span>
                )}
              </div>
              <p className="mt-1 text-rose-700 dark:text-rose-300 font-medium leading-relaxed">
                {friendlyError(latestError)}
              </p>
              {latestError?.occurredAt && (
                <div className="mt-1 font-mono text-[10px] opacity-70">Occurred {timeAgo(latestError.occurredAt)}</div>
              )}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleRetryConnection}
                disabled={retrying}
                className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition cursor-pointer disabled:opacity-60 shadow-xs"
              >
                {retrying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {retrying ? 'Retrying…' : 'Retry Connection'}
              </button>
            </div>
          </div>
        </div>
      )}
      {phase === 'Disconnected' && (
        <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-xl px-4 py-3">
          <WifiOff className="h-4 w-4 shrink-0" />
          <div className="flex-1">
            This account's MT5 sync is disconnected. Re-enter your MT5 investor password to reconnect.
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
                Your stored MT5 credentials will be securely removed. You can reconnect anytime with your investor password.
                No existing trading data is deleted.
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




      {/* ── VPS Auto Sync Tab ──────────────────────────────────────────── */}
      {activeTab === 'vps' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-emerald-500" />
              <h3 className="dx-section-title">MT5 Auto Sync</h3>
            </div>
            {/* The badge used to read "VPS Connected" whenever credentials were
                stored, which is a statement about this account, not about the
                worker. It said connected on a deployment where no worker had
                ever run. */}
            {status?.syncMethod === 'VPS' && status.cloudConnected && (
              workerOnline ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold px-2.5 py-1">
                  <Wifi className="h-3 w-3" /> Auto Sync ready
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-[10px] font-bold px-2.5 py-1"
                  title="Your MT5 details are saved. Auto Sync is not running yet, so queued syncs are waiting."
                >
                  <WifiOff className="h-3 w-3" /> Auto Sync offline
                </span>
              )
            )}
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Enter your MT5 login and <strong>Investor (read-only) password</strong>. We connect to your
            account, fetch your complete trade history, and sync it to your journal. The connection is only held open
            during the sync — it disconnects immediately after. Your password is <strong>encrypted before storage</strong>
            and never shown again.
          </p>

          {vpsError && (
            <div className="flex items-center gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs font-semibold rounded-xl px-4 py-3">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {vpsError}
            </div>
          )}

          {status?.syncMethod === 'VPS' && status.cloudConnected ? (
            /* ── Already connected: show status + Sync Now + Disconnect ── */
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Sync Method</div>
                  <div className="text-sm font-black text-slate-800 dark:text-white">MT5 Auto</div>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">MT5 Login</div>
                  <div className="text-sm font-black text-slate-800 dark:text-white truncate">{status.terminalLogin || '—'}</div>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Server</div>
                  <div className="text-sm font-black text-slate-800 dark:text-white truncate">{status.terminalServer || '—'}</div>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Last Sync</div>
                  <div className="text-sm font-black text-slate-800 dark:text-white">{timeAgo(status.lastSyncTime)}</div>
                </div>
              </div>

              {/* Queue / job status */}
              {status.connectJobs && status.connectJobs.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {status.connectJobs.slice(-3).map((j) => (
                    <div key={j.id} className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 px-3 py-2 text-xs">
                      <div className="inline-flex items-center gap-2">
                        <span className="font-black text-slate-700 dark:text-slate-200">{j.action}</span>
                        <span className={`font-bold ${
                          j.status === 'FAILED' ? 'text-rose-500'
                          : j.status === 'DONE' ? 'text-emerald-600'
                          : j.status === 'RUNNING' ? 'text-amber-500'
                          : 'text-indigo-500'
                        }`}>{j.status}</span>
                        {j.errorCode && <span className="text-rose-500 font-bold font-mono text-[10px]">{j.errorCode}</span>}
                      </div>
                      {j.status === 'FAILED' && (
                        <div className="text-rose-600 dark:text-rose-400 text-[11px] font-medium mt-1 leading-normal">
                          {friendlyError({
                            errorCode: j.errorCode || '',
                            errorMessage: j.errorMessage || (j as any).lastError || (j as any).error || j.statusMessage || '',
                            occurredAt: '',
                            resolvedAt: null
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleVpsSync}
                  disabled={vpsSyncing || phase === 'Queued'}
                  id="vps-sync-now-btn"
                  className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition disabled:opacity-50"
                >
                  {vpsSyncing || phase === 'Queued'
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <RefreshCw className="h-4 w-4" />}
                  {vpsSyncing ? 'Connecting…' : phase === 'Queued' ? 'Connecting…' : 'Sync Now'}
                </button>
              </div>

            </div>
          ) : (
            /* ── Not yet connected: show the connect form ── */
            <form
              onSubmit={(e) => { e.preventDefault(); handleVpsConnect(); }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5" htmlFor="vpsLogin">MT5 Login Number</label>
                  <input
                    id="vpsLogin"
                    type="text"
                    value={vpsLogin}
                    onChange={(e) => setVpsLogin(e.target.value)}
                    required
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="e.g. 51012345"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white text-xs px-3 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5" htmlFor="vpsServer">Broker Server</label>
                  <input
                    id="vpsServer"
                    type="text"
                    value={vpsServer}
                    onChange={(e) => setVpsServer(e.target.value)}
                    required
                    autoComplete="off"
                    placeholder="e.g. Exness-MT5Trial15"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white text-xs px-3 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400" htmlFor="vpsPassword">Investor (Read-Only) Password</label>
                  <button
                    type="button"
                    onClick={() => setShowInfoModal(true)}
                    className="text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition shrink-0 cursor-pointer"
                    title="How to find your Investor password"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input
                  id="vpsPassword"
                  type="password"
                  value={vpsPassword}
                  onChange={(e) => setVpsPassword(e.target.value)}
                  required
                  autoComplete="off"
                  placeholder="Enter your MT5 investor password"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white text-xs px-3 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>

              {/* How it works */}
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">How It Works</div>
                <div className="space-y-2">
                  {[
                    { n: '1', t: 'You click Connect → your credentials are encrypted and stored securely.' },
                    { n: '2', t: 'We log into MT5 with your Investor password (read-only).' },
                    { n: '3', t: 'It fetches your full trade history and sends it to your journal.' },
                    { n: '4', t: 'The MT5 session is closed immediately after sync completes.' },
                    { n: '5', t: 'Click "Sync Now" any time to refresh with new trades.' },
                  ].map((s) => (
                    <div key={s.n} className="flex items-start gap-2.5">
                      <span className="h-5 w-5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">{s.n}</span>
                      <span className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">{s.t}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={vpsBusy}
                id="vps-connect-btn"
                className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition disabled:opacity-50"
              >
                {vpsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {vpsBusy ? 'Connecting…' : 'Connect & Start Sync'}
              </button>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  <strong className="text-slate-700 dark:text-slate-200">Investor password only — read-only.</strong> Use your
                  MT5 Investor password, not your main account password. We cannot place or modify any trades.
                  Your password is AES-256-GCM encrypted before it is stored.
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
              <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-800 dark:text-emerald-300 p-3 rounded-xl text-[11px] font-medium leading-relaxed">
                <strong>Password Notice:</strong> Always enter your investor (read-only) password. Stored passwords are encrypted in our system.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

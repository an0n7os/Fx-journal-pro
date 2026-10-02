import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import {
  generateEaToken,
  generateEaSource,
  verifyEaSignature,
  recomputeMt5Trades
} from './mt5Service';

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * `a === b` on a token returns as soon as two bytes differ, so the time it
 * takes to refuse a guess tells an attacker how much of the prefix was right.
 * The length is hashed in rather than compared, because timingSafeEqual throws
 * on a length mismatch and that throw is itself an oracle.
 */
function safeTokenEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(String(a ?? ''), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b ?? ''), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function createMt5Router(deps: {
  getAccount: (accountId: string) => Promise<any>;
  saveAccount: (account: any) => Promise<void>;
  saveSnapshots: (snapshots: any[]) => Promise<void>;
  saveOpenPositions: (accountId: string, positions: any[]) => Promise<void>;
  savePendingOrders: (accountId: string, orders: any[]) => Promise<void>;
  saveTrades: (trades: any[]) => Promise<void>;
  // Worker queue dependencies
  getQueuedJobs: () => Promise<any[]>;
  updateJobStatus: (jobId: string, status: string, error?: string) => Promise<void>;
  saveImportedTrades: (jobId: string, payload: any) => Promise<{ imported: number; skipped: number }>;
  bridgeAuthToken: string;
}) {
  const router = Router();

  const workerAuth = (req: Request, res: Response, next: () => void) => {
    // Refuse outright when no token is configured, rather than falling open on
    // an empty string. A bridge token can pull a customer's trade history, so
    // "unconfigured" must never mean "open".
    const configured = String(deps.bridgeAuthToken || '').trim();
    if (!configured) {
      return res.status(503).json({ error: 'Bridge sync is not configured on this deployment.', code: 'BRIDGE_NOT_CONFIGURED' });
    }
    const header = String(req.headers.authorization || '').trim();
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (presented && safeTokenEqual(presented, configured)) return next();
    return res.status(401).json({ error: 'Unauthorized worker' });
  };

  // 1. Download custom .mq5 Expert Advisor
  router.get('/ea/:accountId/download', async (req: Request, res: Response) => {
    try {
      const account = await deps.getAccount(req.params.accountId);
      if (!account) return res.status(404).json({ error: 'Account not found' });

      if (!account.eaToken) {
        account.eaToken = generateEaToken();
        account.eaStatus = 'Not Connected';
        await deps.saveAccount(account);
      }

      const proto = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const apiUrl = `${proto}://${host}/api/mt5`;

      const source = generateEaSource(account, apiUrl);
      const safeName = String(account.name || 'Account').replace(/[^A-Za-z0-9]+/g, '_');
      
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="FXJournalPro_Sync_${safeName}.mq5"`);
      return res.send(source);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 2. EA Handshake & Validation
  router.post('/ea/validate', async (req: Request, res: Response) => {
    const { token, accountId, login, server, build } = req.body;
    const account = await deps.getAccount(accountId);
    if (!account || account.eaToken !== token) {
      return res.status(401).json({ error: 'Invalid EA Token', code: 'EA_AUTH_FAILED' });
    }

    const sig = verifyEaSignature(req, account, token);
    if (!sig.ok) return res.status(401).json({ error: sig.reason, code: sig.code });

    account.eaStatus = 'Connected';
    account.terminalLogin = login;
    account.terminalServer = server;
    account.terminalBuild = build;
    account.lastHeartbeatAt = new Date().toISOString();
    await deps.saveAccount(account);

    return res.json({ ok: true, status: 'Connected', lastDealId: account.eaLastDealId || 0, portfolioId: account.id });
  });

  // 3. EA Account Snapshots (Balance, Equity, Margin)
  router.post('/ea/account', async (req: Request, res: Response) => {
    const { token, accountId, balance, equity, margin, marginFree, currency } = req.body;
    const account = await deps.getAccount(accountId);
    if (!account || account.eaToken !== token) return res.status(401).json({ error: 'Unauthorized' });

    account.currentBalance = balance;
    account.equity = equity;
    if (currency) account.currency = currency;
    account.lastHeartbeatAt = new Date().toISOString();
    await deps.saveAccount(account);

    await deps.saveSnapshots([{
      accountId,
      balance,
      equity,
      margin,
      marginFree,
      currency,
      capturedAt: new Date().toISOString()
    }]);

    return res.json({ ok: true, captured: true });
  });

  // 4. EA Open Positions
  router.post('/ea/positions', async (req: Request, res: Response) => {
    const { token, accountId, positions } = req.body;
    const account = await deps.getAccount(accountId);
    if (!account || account.eaToken !== token) return res.status(401).json({ error: 'Unauthorized' });

    await deps.saveOpenPositions(accountId, positions || []);
    return res.json({ ok: true, count: (positions || []).length });
  });

  // 5. EA Pending Orders
  router.post('/ea/orders', async (req: Request, res: Response) => {
    const { token, accountId, orders } = req.body;
    const account = await deps.getAccount(accountId);
    if (!account || account.eaToken !== token) return res.status(401).json({ error: 'Unauthorized' });

    await deps.savePendingOrders(accountId, orders || []);
    return res.json({ ok: true, count: (orders || []).length });
  });

  // 6. EA Heartbeat
  router.post('/ea/heartbeat', async (req: Request, res: Response) => {
    const { token, accountId, balance, equity } = req.body;
    const account = await deps.getAccount(accountId);
    if (!account || account.eaToken !== token) return res.status(401).json({ error: 'Unauthorized' });

    if (balance !== undefined) account.currentBalance = balance;
    if (equity !== undefined) account.equity = equity;
    account.lastHeartbeatAt = new Date().toISOString();
    await deps.saveAccount(account);

    return res.json({ ok: true });
  });

  // 7. EA Trade Synchronization
  router.post('/ea/sync', async (req: Request, res: Response) => {
    const { token, accountId, deals } = req.body;
    const account = await deps.getAccount(accountId);
    if (!account || account.eaToken !== token) return res.status(401).json({ error: 'Unauthorized' });

    const trades = recomputeMt5Trades(accountId, deals || []);
    await deps.saveTrades(trades);

    const maxTicket = (deals || []).reduce((max: number, d: any) => Math.max(max, d.ticket || 0), account.eaLastDealId || 0);
    account.eaLastDealId = maxTicket;
    account.lastSyncTime = new Date().toISOString();
    await deps.saveAccount(account);

    return res.json({ ok: true, totalTrades: trades.length, cursor: maxTicket });
  });

  // ==========================================
  // Python Desktop Worker Endpoints
  // ==========================================
  router.post('/worker/heartbeat', workerAuth, (_req, res) => res.json({ success: true }));

  router.get('/worker/jobs', workerAuth, async (_req, res) => {
    const jobs = await deps.getQueuedJobs();
    return res.json({ jobs: jobs.slice(0, 1) });
  });

  router.post('/worker/job/:id/status', workerAuth, async (req, res) => {
    const { status, error_message } = req.body;
    await deps.updateJobStatus(req.params.id, status, error_message);
    return res.json({ success: true });
  });

  router.post('/worker/job/:id/trades', workerAuth, async (req, res) => {
    const result = await deps.saveImportedTrades(req.params.id, req.body);
    return res.json(result);
  });

  return router;
}

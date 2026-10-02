import crypto from 'crypto';
import { EA_TEMPLATE } from './eaTemplate';
import { MT5Deal, ReconstructedTrade } from './types';

export const ENTRY_IN = 0;
export const ENTRY_OUT = 1;
export const ENTRY_INOUT = 2;

export const DEAL_TYPE_BUY = 0;
export const DEAL_TYPE_SELL = 1;
export const DEAL_TYPE_BALANCE = 2;
export const DEAL_TYPE_CREDIT = 3;

export function generateEaToken(): string {
  return 'ea_' + crypto.randomBytes(24).toString('hex');
}

export function hmacSign(message: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

export function generateEaSource(account: { id: string; eaToken?: string }, apiUrl: string): string {
  const urlObj = new URL(apiUrl);
  const host = urlObj.host;
  // split/join, not replace: String.replace with a string pattern substitutes
  // only the FIRST match, and every placeholder appears two or three times in
  // the template (the host appears three times). With replace, the generated
  // .mq5 still carried a literal __FXJP_TOKEN__ in its second position, so the
  // EA could not authenticate and the download was useless.
  return EA_TEMPLATE
    .split('__FXJP_ACCOUNT_ID__').join(account.id)
    .split('__FXJP_TOKEN__').join(account.eaToken || '')
    .split('__FXJP_API_URL__').join(apiUrl)
    .split('__FXJP_WEBREQUEST_HOST__').join(host);
}

export function verifyEaSignature(
  req: { headers: Record<string, any>; rawBody?: string },
  account: { id: string },
  token: string
): { ok: boolean; code?: string; reason?: string } {
  const headerSig = (req.headers['x-ea-signature'] || '').toString().trim();
  const headerTs = (req.headers['x-ea-timestamp'] || '').toString().trim();
  const accountId = String(account.id || '');
  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';

  if (!headerSig || !headerTs) {
    return { ok: false, code: 'EA_SIGNATURE_MISSING', reason: 'Missing X-EA-Signature / X-EA-Timestamp headers' };
  }

  const ts = Date.parse(headerTs);
  if (Number.isNaN(ts)) {
    return { ok: false, code: 'EA_BAD_TIMESTAMP', reason: 'X-EA-Timestamp is not a valid date' };
  }

  // 5 minute replay window
  const windowMs = 5 * 60 * 1000;
  if (Math.abs(Date.now() - ts) > windowMs) {
    return { ok: false, code: 'EA_STALE_TIMESTAMP', reason: 'Request timestamp outside allowed window' };
  }

  const message = `${headerTs}.${accountId}.${rawBody}`;
  const expected = hmacSign(message, token);
  const provided = Buffer.from(headerSig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');

  if (provided.length !== expectedBuf.length || !crypto.timingSafeEqual(provided, expectedBuf)) {
    return { ok: false, code: 'SIGNATURE_MISMATCH', reason: 'HMAC signature does not match' };
  }

  return { ok: true };
}

/**
 * Rebuild trades from raw MT5 deals.
 * IN (entry 0) and OUT (entry 1) deals are matched by positionId.
 */
export function recomputeMt5Trades(
  accountId: string,
  deals: MT5Deal[],
  skipBalanceTicket?: number
): ReconstructedTrade[] {
  const result: ReconstructedTrade[] = [];
  const posGroups = new Map<number, MT5Deal[]>();

  for (const d of deals) {
    if (d.symbol && (d.entry === ENTRY_IN || d.entry === ENTRY_OUT || d.entry === ENTRY_INOUT)) {
      if (!posGroups.has(d.positionId)) posGroups.set(d.positionId, []);
      posGroups.get(d.positionId)!.push(d);
    }
  }

  for (const [posId, list] of posGroups) {
    const inDeals = list.filter((d) => d.entry === ENTRY_IN);
    const outDeals = list.filter((d) => d.entry === ENTRY_OUT || d.entry === ENTRY_INOUT);
    if (outDeals.length === 0) continue; // Position is still open

    const inDeal = inDeals[0] || outDeals[0];
    const lastOut = outDeals[outDeals.length - 1];

    // A position is CLOSED by the opposite deal: a Buy is closed by a SELL
    // deal and a Sell by a BUY deal. Reading the direction off `lastOut`
    // therefore labelled every Buy as a Sell and every Sell as a Buy — which
    // inverts the direction of every synced trade in the journal. The opening
    // deal is the one that says what the trade was; `lastOut` is only the
    // fallback for a position whose IN deal is outside the fetched range, and
    // there it has to be flipped.
    const direction: 'Buy' | 'Sell' = inDeals.length > 0
      ? (inDeals[0].type === DEAL_TYPE_SELL ? 'Sell' : 'Buy')
      : (lastOut.type === DEAL_TYPE_SELL ? 'Buy' : 'Sell');
    const totalProfit = list.reduce((s, d) => s + (d.profit || 0), 0);
    const totalComm = list.reduce((s, d) => s + (d.commission || 0), 0);
    const totalSwap = list.reduce((s, d) => s + (d.swap || 0), 0);

    result.push({
      id: `mt5_${accountId}_${posId}`,
      accountId,
      date: new Date(inDeal.time * 1000).toISOString(),
      exitTime: new Date(lastOut.time * 1000).toISOString(),
      symbol: lastOut.symbol || inDeal.symbol || 'UNKNOWN',
      type: direction,
      lotSize: lastOut.volume || inDeal.volume || 0.01,
      entryPrice: inDeal.price,
      exitPrice: lastOut.price,
      profit: Math.round((totalProfit + totalComm + totalSwap) * 100) / 100,
      commission: totalComm,
      swap: totalSwap,
      strategy: 'MT5 EA Sync',
      tags: ['MT5 Sync'],
      isMt5Sync: true,
      eaDealId: lastOut.ticket,
      eaPositionId: posId
    });
  }

  // Handle balance deposits & withdrawals
  for (const d of deals) {
    if (d.symbol) continue;
    if (d.type !== DEAL_TYPE_BALANCE && d.type !== DEAL_TYPE_CREDIT) continue;
    if (skipBalanceTicket !== undefined && d.ticket === skipBalanceTicket) continue;

    result.push({
      id: `mt5_${accountId}_dep_${d.ticket}`,
      accountId,
      date: new Date(d.time * 1000).toISOString(),
      exitTime: new Date(d.time * 1000).toISOString(),
      symbol: 'BALANCE',
      type: d.profit >= 0 ? 'Deposit' : 'Withdrawal',
      lotSize: 0,
      entryPrice: 0,
      exitPrice: 0,
      profit: d.profit,
      commission: d.commission || 0,
      swap: d.swap || 0,
      strategy: 'MT5 EA Sync',
      tags: ['MT5 Sync'],
      isMt5Sync: true,
      eaDealId: d.ticket,
      eaPositionId: 0
    });
  }

  return result;
}

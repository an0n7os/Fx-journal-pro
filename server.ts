import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { GoogleGenAI } from '@google/genai';
import {
  User,
  TradingAccount,
  Trade,
  RiskSettings,
  SupportTicket,
  Announcement,
  PaymentHistory
} from './src/types.js';
import { EA_TEMPLATE } from './src/eaTemplate.js';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
// metaapi.cloud-sdk's "exports.import" points at a browser build (esm-web) that
// references `window` and crashes in Node. Import the CommonJS build directly.
import MetaApiModule from 'metaapi.cloud-sdk/dist/index';
// The SDK ships as CommonJS; keep this resilient to both esbuild/tsx interop
// styles (__esModule true => the class is the default export).
const MetaApi: any = (MetaApiModule as any).default || MetaApiModule;

/**
 * True when this process is one invocation of a serverless function rather than
 * a server that stays up.
 *
 * It governs three things that only make sense on a long-lived host: calling
 * app.listen(), serving the built frontend from Express, and starting the MT5
 * background interval. Vercel used to be the only case; Netlify Functions and
 * bare Lambda behave the same way, and a missed check there shows up as a
 * port-binding crash or a timer that silently never fires.
 */
const IS_SERVERLESS = !!(
  process.env.VERCEL ||
  process.env.NETLIFY ||
  process.env.AWS_LAMBDA_FUNCTION_NAME
);

/**
 * True only on a developer's own machine.
 *
 * Every convenience that must never reach users hangs off this: signing in
 * with an unknown email creates the account, Turnstile is skipped, OTP codes
 * come back in the response, and admin@axyfx.com is a SUPER_ADMIN back door.
 *
 * These used to test NODE_ENV alone. A Netlify deploy where NODE_ENV was not
 * set in the site's own variables — netlify.toml's [build.environment] does
 * not reach the function runtime — therefore ran as "development" on the
 * public internet, and anyone could sign in as anyone, including the seeded
 * admin. A serverless deployment is never a dev box, so it is excluded
 * regardless of what NODE_ENV says.
 */
const IS_DEV = !IS_SERVERLESS && process.env.NODE_ENV !== 'production';

/**
 * True wherever real users can reach this process.
 *
 * The counterpart to IS_DEV, used by the guards that refuse to start: no
 * Supabase, no email provider, no SESSION_SECRET. Those tested NODE_ENV alone
 * too, so the same unset variable that opened the dev back doors also let the
 * server fall back to db.json — a file on a function instance's own disk,
 * wiped on every deploy and not shared between instances. Signups and trades
 * would disappear with no error anywhere.
 */
const IS_PRODUCTION_LIKE = IS_SERVERLESS || process.env.NODE_ENV === 'production';

// Absolute file paths for database persistence
const DB_FILE = path.join(process.cwd(), 'db.json');

// Supabase Client Configuration
let supabase: any = null;
let useSupabase = false;

try {
  let supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
  // Prefer the service-role key on the server. The anon/publishable key is shipped
  // to the browser, so if the server runs on it every table it can touch is also
  // reachable by anyone who opens the site (see fix_rls_policies.sql).
  let supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_KEY?.trim() ||
    process.env.VITE_SUPABASE_KEY?.trim();
  let usingAnonKeyOnServer =
    !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() &&
    (!!process.env.VITE_SUPABASE_KEY?.trim() || !!process.env.SUPABASE_KEY?.trim());

  if (supabaseUrl && supabaseUrl.endsWith('/rest/v1/')) supabaseUrl = supabaseUrl.replace('/rest/v1/', '');
  if (supabaseUrl && supabaseUrl.endsWith('/rest/v1')) supabaseUrl = supabaseUrl.replace('/rest/v1', '');

  // Strip wrapping quotes if any (common in some env setups)
  if (supabaseUrl?.startsWith('"') && supabaseUrl?.endsWith('"')) {
    supabaseUrl = supabaseUrl.slice(1, -1);
  }
  if (supabaseUrl?.startsWith("'") && supabaseUrl?.endsWith("'")) {
    supabaseUrl = supabaseUrl.slice(1, -1);
  }
  if (supabaseKey?.startsWith('"') && supabaseKey?.endsWith('"')) {
    supabaseKey = supabaseKey.slice(1, -1);
  }
  if (supabaseKey?.startsWith("'") && supabaseKey?.endsWith("'")) {
    supabaseKey = supabaseKey.slice(1, -1);
  }

  // The check above only asks WHICH variable held the key, so pasting a public
  // key into SUPABASE_SERVICE_ROLE_KEY passed silently — the most likely way to
  // get this wrong, since the two keys sit next to each other in the Supabase
  // dashboard. Read the key itself instead.
  //
  // New format: sb_publishable_... is public, sb_secret_... is not.
  // Legacy format: a JWT whose payload carries "role":"anon" or
  // "role":"service_role".
  if (supabaseKey) {
    let keyIsPublic = supabaseKey.startsWith('sb_publishable_');
    if (!keyIsPublic && supabaseKey.split('.').length === 3) {
      try {
        const payload = JSON.parse(
          Buffer.from(supabaseKey.split('.')[1], 'base64url').toString('utf8')
        );
        keyIsPublic = payload?.role === 'anon';
      } catch {
        // Not a readable JWT; leave the variable-based check to speak.
      }
    }
    if (keyIsPublic) {
      usingAnonKeyOnServer = true;
      const message =
        '[AxyFx Journal Server] The Supabase key given to the server is a PUBLIC key ' +
        '(sb_publishable_... or a JWT with role "anon"). It is the key shipped to every ' +
        'browser, so running the server on it grants the server no more access than an ' +
        'anonymous visitor already has, and every admin route silently reads nothing. ' +
        'Use the secret key: Supabase dashboard, Settings, API keys, "sb_secret_..." ' +
        '(formerly service_role).';
      if (IS_PRODUCTION_LIKE) {
        console.error(message);
        throw new Error('A public Supabase key cannot be used as the server key');
      }
      console.warn(message);
    }
  }

  if (supabaseUrl && !supabaseUrl.startsWith('http://') && !supabaseUrl.startsWith('https://')) {
    if (/^[a-zA-Z0-9_-]+$/.test(supabaseUrl)) {
      console.log(`[AxyFx Journal Server] Raw Supabase project reference "${supabaseUrl}" detected. Automatically expanding to "https://${supabaseUrl}.supabase.co"`);
      supabaseUrl = `https://${supabaseUrl}.supabase.co`;
    }
  }

  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    useSupabase = true;
    console.log('[AxyFx Journal Server] Supabase integration ENABLED!');
    if (usingAnonKeyOnServer) {
      console.warn(
        '[AxyFx Journal Server] WARNING: running on the anon/publishable Supabase key. ' +
        'Set SUPABASE_SERVICE_ROLE_KEY and lock down RLS (see fix_rls_policies.sql) before going live.'
      );
    }
  } else {
    // db.json is a file on the instance's own disk. On Vercel, Render, Fly and
    // every container host that disk is wiped on each deploy and is not shared
    // between instances, so falling back to it in production means signups and
    // trades quietly disappear and nobody sees an error. A typo in SUPABASE_URL
    // looks exactly like a normal boot. Fail loudly instead, the way the
    // SESSION_SECRET check below does.
    if (IS_PRODUCTION_LIKE) {
      console.error(
        '[AxyFx Journal Server] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. ' +
        'Refusing to start in production on the local db.json fallback — all data would be ' +
        'lost on the next deploy. Set both variables, or set ALLOW_LOCAL_DB=true if you ' +
        'really intend to run on a disk that persists.'
      );
      if (process.env.ALLOW_LOCAL_DB !== 'true') {
        throw new Error('Supabase credentials are required in production');
      }
      console.warn('[AxyFx Journal Server] ALLOW_LOCAL_DB=true — continuing on db.json.');
    }
    console.log('[AxyFx Journal Server] Supabase integration DISABLED. Falling back to local db.json');
  }
} catch (err) {
  // A deliberate startup abort must not be swallowed by this catch, or the
  // guard that raised it becomes a no-op and the server boots anyway — on
  // db.json, or on a key that can read nothing.
  if (
    err instanceof Error &&
    (err.message === 'Supabase credentials are required in production' ||
      err.message === 'A public Supabase key cannot be used as the server key')
  ) throw err;
  console.error('[AxyFx Journal Server] Failed to initialize Supabase client:', err);
  useSupabase = false;
  supabase = null;
}

// Helper to load database from local file (always self-healing and bulletproof)
function loadDatabaseFromFile() {
  const initialDB = {
    users: [
      {
        id: 'user_admin',
        email: 'admin@axyfx.com',
        name: 'AxyFx Admin',
        password: "$2b$10$yS0ToL0ISPD7iltFnLSXZeJqGRu4pFwPWlg9a6xo0UP1lATaAAlfS",
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        isEmailVerified: true,
        experience: 'Professional',
        tradingStyle: 'Day Trading',
        mainMarkets: ['Forex', 'Gold'],
        onboardingCompleted: true,
        isPro: true
      },
      {
        id: 'user_akshay',
        email: 'akshayrajpanamthode@gmail.com',
        name: 'Akshay Raj',
        experience: 'Intermediate',
        tradingStyle: 'Day Trading',
        mainMarkets: ['Forex', 'Gold', 'Indices'],
        onboardingCompleted: true,
        isPro: false
      }
    ] as User[],
    accounts: [
      {
        id: 'acc_1',
        userId: 'user_akshay',
        name: 'My Primary Live',
        broker: 'IC Markets',
        platform: 'MT5',
        accountType: 'Live',
        currency: 'USD',
        startingBalance: 10000,
        currentBalance: 11420,
        equity: 11420,
        status: 'Active'
      }
    ] as TradingAccount[],
    trades: [
      {
        id: 't_1',
        accountId: 'acc_1',
        date: '2026-07-01T14:30:00Z',
        symbol: 'EURUSD',
        type: 'Buy',
        lotSize: 1.0,
        entryPrice: 1.08500,
        exitPrice: 1.09200,
        stopLoss: 1.08200,
        takeProfit: 1.09500,
        profit: 700,
        commission: -7,
        swap: -1.5,
        riskPercentage: 1.5,
        strategy: 'Order Block Rejection',
        emotion: 'Calm',
        notes: 'Standard buy at support levels. Perfect execution.',
        tags: ['Scalping', 'Breakout']
      },
      {
        id: 't_2',
        accountId: 'acc_1',
        date: '2026-07-02T09:15:00Z',
        symbol: 'XAUUSD',
        type: 'Sell',
        lotSize: 0.5,
        entryPrice: 2320.00,
        exitPrice: 2312.00,
        stopLoss: 2325.00,
        takeProfit: 2300.00,
        profit: 400,
        commission: -3.5,
        swap: 0,
        riskPercentage: 1.0,
        strategy: 'Daily Pivot Reversal',
        emotion: 'Calm',
        notes: 'Gold rejected daily highs, targets reached quickly.',
        tags: ['Breakout']
      },
      {
        id: 't_3',
        accountId: 'acc_1',
        date: '2026-07-03T16:00:00Z',
        symbol: 'GBPUSD',
        type: 'Buy',
        lotSize: 1.5,
        entryPrice: 1.26400,
        exitPrice: 1.26150,
        stopLoss: 1.26200,
        takeProfit: 1.27200,
        profit: -375,
        commission: -10.5,
        swap: -4,
        riskPercentage: 2.0,
        strategy: 'EMA Cross',
        emotion: 'Anxious',
        notes: 'Violated risk parameters slightly, got stopped out early.',
        tags: ['FOMO', 'Revenge Trade']
      },
      {
        id: 't_4',
        accountId: 'acc_1',
        date: '2026-07-05T11:45:00Z',
        symbol: 'EURUSD',
        type: 'Sell',
        lotSize: 2.0,
        entryPrice: 1.09100,
        exitPrice: 1.09450,
        stopLoss: 1.09300,
        takeProfit: 1.08200,
        profit: -700,
        commission: -14,
        swap: 0,
        riskPercentage: 3.0,
        strategy: 'Order Block Rejection',
        emotion: 'Revenge',
        notes: 'Entered in anger after losing trade, completely broke rules.',
        tags: ['Revenge Trade', 'FOMO']
      },
      {
        id: 't_5',
        accountId: 'acc_1',
        date: '2026-07-07T13:00:00Z',
        symbol: 'USDJPY',
        type: 'Buy',
        lotSize: 1.2,
        entryPrice: 156.20,
        exitPrice: 157.40,
        stopLoss: 155.80,
        takeProfit: 158.00,
        profit: 910,
        commission: -8.4,
        swap: 1.2,
        riskPercentage: 1.5,
        strategy: 'Trend Continuation',
        emotion: 'Calm',
        notes: 'Strong daily trend buy, excellent profit run.',
        tags: ['Breakout']
      },
      {
        id: 't_6',
        accountId: 'acc_1',
        date: '2026-07-09T18:30:00Z',
        symbol: 'XAUUSD',
        type: 'Buy',
        lotSize: 0.8,
        entryPrice: 2345.00,
        exitPrice: 2351.50,
        stopLoss: 2340.00,
        takeProfit: 2365.00,
        profit: 520,
        commission: -5.6,
        swap: 0,
        riskPercentage: 1.2,
        strategy: 'Daily Pivot Reversal',
        emotion: 'Excited',
        notes: 'Gold bounce on London-New York overlap.',
        tags: ['News Trade']
      }
    ] as Trade[],
    riskSettings: [
      {
        id: 'r_1',
        accountId: 'acc_1',
        riskPerTradeLimit: 2.0,
        dailyLossLimit: 500,
        weeklyLossLimit: 1500,
        maxDrawdownLimit: 10.0,
        disciplineEnabled: true
      }
    ] as RiskSettings[],
    supportTickets: [
      {
        id: 'ticket_1',
        userId: 'user_akshay',
        userEmail: 'akshayrajpanamthode@gmail.com',
        title: 'Welcome query',
        description: 'How do I log my first trade?',
        status: 'Open',
        category: 'Support',
        date: '2026-07-10T12:00:00Z'
      }
    ] as SupportTicket[],
    announcements: [
      {
        id: 'ann_1',
        title: 'Welcome to FX Journal Pro V2.5',
        content: 'Start by creating a portfolio account and logging your first trade. Track your equity curve, win rate, and risk habits to improve your trading performance.',
        date: '2026-07-11T10:00:00Z'
      }
    ] as Announcement[],
    mt5Deals: [],
    payments: [] as PaymentHistory[]
  };

  try {
    if (fs.existsSync(DB_FILE)) {
      const dataStr = fs.readFileSync(DB_FILE, 'utf-8');
      if (dataStr && dataStr.trim()) {
        const parsed = JSON.parse(dataStr);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.users)) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.error('[AxyFx Journal Server] Error reading local db.json file, using seed data:', err);
  }

  // Best-effort local file write
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2), 'utf-8');
  } catch (err) {
    // Ignore read-only filesystem issues
  }

  return initialDB;
}

const userDatabases = new Map();
let isLoaded = false;
let currentUser: any = null;
let isGlobalLoaded = false;
let db: any = null;

// Loader and saver specifically for user-scoped databases on Supabase

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOtpEmail(email, otp, subject = 'Your FX Journal Pro Verification Code') {
  const sendgridKey = process.env.SENDGRID_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.SENDER_EMAIL || 'noreply@fxjournalpro.com';
  const isReset = subject.toLowerCase().includes('reset');
  const heading = isReset ? 'Reset your password' : 'Verify your email address';
  const bodyText = isReset
    ? 'You requested a password reset for your FX Journal Pro account. Use the code below to set a new password. This code expires in 10 minutes.'
    : 'Thank you for registering with FX Journal Pro. Please use the following one-time password (OTP) to activate your account. This code is valid for 10 minutes.';
  const emailHtml = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;"><h2 style="color: #0f172a; text-align: center;">${heading}</h2><p>${bodyText}</p><div style="text-align: center; margin: 30px 0;"><span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #2563eb; background-color: #f1f5f9; padding: 10px 20px; border-radius: 8px;">${otp}</span></div><p>If you did not request this code, please ignore this email.</p></div>`;

  // 1. Try SendGrid if API Key is configured
  if (sendgridKey && sendgridKey !== 'YOUR_SENDGRID_API_KEY' && !sendgridKey.startsWith('SG.xxxx')) {
    try {
      console.log(`[SendGrid] Attempting to send OTP email to ${email} from ${fromEmail}...`);
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + sendgridKey
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: [{ email: email }]
            }
          ],
          from: {
            email: fromEmail,
            name: 'FX Journal Pro'
          },
          subject: subject,
          content: [
            {
              type: 'text/html',
              value: emailHtml
            }
          ]
        })
      });

      if (response.status >= 200 && response.status < 300) {
        console.log('[SendGrid] Email OTP sent successfully to ' + email);
        return { success: true, provider: 'SendGrid' };
      } else {
        const errorText = await response.text();
        console.error('[SendGrid Email Error] Status ' + response.status + ':', errorText);
        if (response.status === 403 || errorText.includes('Sender Identity') || errorText.includes('from address')) {
          console.error('[SendGrid Troubleshooting] Make sure SENDGRID_FROM_EMAIL matches the email address verified in SendGrid Single Sender Verification, and that you clicked the verification link sent by SendGrid!');
        }
      }
    } catch (err: any) {
      console.error('[SendGrid Email Exception]', err);
    }
  }

  // 2. Try Resend if API Key is configured
  if (resendKey && resendKey !== 'YOUR_RESEND_API_KEY' && !resendKey.startsWith('re_xxxx')) {
    // onboarding@resend.dev is Resend's shared sandbox sender. Mail from it is
    // widely spam-filtered, so OTP and reset codes silently never arrive.
    // Verify your own domain (SPF + DKIM) and set RESEND_FROM_EMAIL.
    const configuredFrom = process.env.RESEND_FROM_EMAIL?.trim();
    const resendFrom = configuredFrom
      ? `FX Journal Pro <${configuredFrom}>`
      : 'FX Journal Pro <onboarding@resend.dev>';
    if (!configuredFrom && IS_PRODUCTION_LIKE) {
      console.warn('[Resend] RESEND_FROM_EMAIL is not set — sending from the shared sandbox domain. Expect codes to land in spam.');
    }
    try {
      console.log(`[Resend] Attempting to send OTP email to ${email}...`);
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + resendKey
        },
        body: JSON.stringify({
          from: resendFrom,
          to: email,
          subject: subject,
          html: emailHtml
        })
      });
      const data = await response.json();
      if (!response.ok) {
        console.error('[Resend Email Error]', data);
      } else {
        console.log('[Resend] Email OTP sent successfully to ' + email);
        return { success: true, provider: 'Resend' };
      }
    } catch (error) {
      console.error('[Resend Email Exception]', error);
    }
  }

  // 3. Development / Fallback Mode
  console.log('\n============================================================');
  console.log('[DEVELOPMENT / FALLBACK MODE] Email not sent via SMTP/API.');
  console.log('Target Email: ' + email + ' | OTP Code: ' + otp);
  console.log('============================================================\n');
  return { success: false, provider: 'None', otp: otp };
}

/**
 * Password for the local demo accounts (admin@axyfx.com / demo@axyfx.com).
 *
 * The old hardcoded hash had no recorded password, so nobody could actually
 * sign in as the local admin to try the console. Set DEV_ADMIN_PASSWORD to
 * choose one; without it the original hash stays, and neither is reachable
 * in production — see the isDemo guard below.
 */
const DEV_DEMO_PASSWORD_HASH = (() => {
  const custom = process.env.DEV_ADMIN_PASSWORD?.trim();
  if (custom && IS_DEV) return bcrypt.hashSync(custom, 10);
  return '$2b$10$yS0ToL0ISPD7iltFnLSXZeJqGRu4pFwPWlg9a6xo0UP1lATaAAlfS';
})();

function createEmptyUserDb(userId?: string, email?: string, injectDummyUser = false) {
  const cleanUserId = userId?.trim() || `user_${Date.now()}`;
  const cleanEmail = email ? email.toLowerCase().trim() : '';
  // These two addresses mint a SUPER_ADMIN account with a hardcoded password
  // hash. That is a convenience for local development and a back door
  // anywhere else, so it is confined to non-production. It is only reachable
  // at all when Supabase is unavailable, which in production means an
  // outage — exactly when a free admin login would do the most damage.
  const isDemo = IS_DEV
    && (cleanEmail === 'admin@axyfx.com' || cleanEmail === 'demo@axyfx.com');

  const users = [];
  if (injectDummyUser || isDemo) {
    users.push({
      id: cleanUserId,
      email: cleanEmail,
      name: cleanEmail ? cleanEmail.split('@')[0] : 'Trader',
      password: DEV_DEMO_PASSWORD_HASH,
      role: cleanEmail === 'admin@axyfx.com' ? 'SUPER_ADMIN' : 'USER',
      status: 'ACTIVE',
      experience: 'Intermediate',
      tradingStyle: 'Day Trading',
      mainMarkets: ['Forex', 'Gold'],
      onboardingCompleted: isDemo ? true : false,
      isPro: isDemo ? true : false,
      isEmailVerified: true
    });
  }

  return {
    users: users,
    accounts: isDemo ? [
      {
        id: 'acc_demo_1',
        userId: cleanUserId,
        name: 'Main Trading Account',
        broker: 'MetaTrader 5',
        platform: 'MT5',
        accountType: 'Demo',
        currency: 'USD',
        startingBalance: 10000,
        currentBalance: 10000,
        equity: 10000,
        status: 'Active',
        eaToken: `ea_demo_${cleanUserId.slice(-8)}`,
        eaStatus: 'Not Connected'
      }
    ] : [],
    trades: [],
    riskSettings: [],
    supportTickets: [],
    mt5Deals: [],
    payments: []
  };
}

// Helper to convert snake_case object to camelCase
function toCamel(obj: any): any {
  if (Array.isArray(obj)) return obj.map(toCamel);
  if (obj !== null && typeof obj === 'object') {
    const n: any = {};
    Object.keys(obj).forEach(k => {
      const camelKey = k.replace(/_([a-z])/g, g => g[1].toUpperCase());
      n[camelKey] = toCamel(obj[k]);
    });
    return n;
  }
  return obj;
}

// Helper to convert camelCase object to snake_case
function toSnake(obj: any): any {
  if (Array.isArray(obj)) return obj.map(toSnake);
  if (obj !== null && typeof obj === 'object') {
    const n: any = {};
    Object.keys(obj).forEach(k => {
      const snakeKey = k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      n[snakeKey] = toSnake(obj[k]);
    });
    return n;
  }
  return obj;
}

// ==========================================
// MT5 EXPERT ADVISOR (EA) SYNCHRONIZATION
// Fresh implementation: each portfolio account gets a unique EA whose
// embedded token authenticates it against the matching account.
// ==========================================

function generateEaToken(): string {
  return `ea_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}

// Derive the public base URL for the EA (works behind the Vercel proxy too)
function apiBaseUrl(req: any): string {
  const proto = (req.headers['x-forwarded-proto']?.toString().split(',')[0] || req.protocol || 'https').trim();
  const host = (req.headers['x-forwarded-host']?.toString().split(',')[0] || req.get('host') || 'www.fxjournalpro.com').trim();
  return `${proto}://${host}/api/mt5`;
}

// Fill the .mq5 template with this account's unique token + id
function generateEaSource(account: any, apiUrl: string): string {
  const host = apiUrl.replace(/^https?:\/\//, '').split('/')[0];
  return EA_TEMPLATE
    .split('__FXJP_ACCOUNT_ID__').join(account.id)
    .split('__FXJP_TOKEN__').join(account.eaToken || '')
    .split('__FXJP_API_URL__').join(apiUrl)
    .split('__FXJP_WEBREQUEST_HOST__').join(host);
}

// ==========================================
// TRADE INPUT VALIDATION
// Every number below feeds the running account balance and the performance
// stats. A NaN or a negative volume that gets through is not a display bug —
// it corrupts the account total with no way for the user to repair it.
// ==========================================

const TRADE_TYPES = new Set(['Buy', 'Sell', 'Deposit', 'Withdrawal']);
const MAX_MONEY = 1_000_000_000;  // guards against typo'd 1e20 wrecking totals
const MAX_LOT = 10_000;

function validateTradeNumbers(input: {
  lotSize?: any; entryPrice?: any; exitPrice?: any; profit?: any;
  commission?: any; swap?: any; riskPercentage?: any; type?: any;
}): string | null {
  const num = (v: any) => (typeof v === 'number' ? v : parseFloat(String(v)));

  if (input.type !== undefined && !TRADE_TYPES.has(String(input.type))) {
    return `Trade type must be one of: ${[...TRADE_TYPES].join(', ')}.`;
  }

  const required: [string, any, number, number][] = [
    ['Lot size', input.lotSize, 0, MAX_LOT],
    ['Entry price', input.entryPrice, 0, MAX_MONEY],
    ['Exit price', input.exitPrice, 0, MAX_MONEY],
  ];
  for (const [label, raw, min, max] of required) {
    if (raw === undefined) continue;
    const v = num(raw);
    if (!Number.isFinite(v)) return `${label} must be a number.`;
    if (v <= min) return `${label} must be greater than ${min}.`;
    if (v > max) return `${label} is unrealistically large.`;
  }

  // These may legitimately be negative (a loss, a fee, a negative swap).
  const signed: [string, any][] = [
    ['Profit', input.profit],
    ['Commission', input.commission],
    ['Swap', input.swap],
  ];
  for (const [label, raw] of signed) {
    if (raw === undefined || raw === null || raw === '') continue;
    const v = num(raw);
    if (!Number.isFinite(v)) return `${label} must be a number.`;
    if (Math.abs(v) > MAX_MONEY) return `${label} is unrealistically large.`;
  }

  if (input.riskPercentage !== undefined && input.riskPercentage !== null && input.riskPercentage !== '') {
    const v = num(input.riskPercentage);
    if (!Number.isFinite(v)) return 'Risk percentage must be a number.';
    if (v < 0 || v > 100) return 'Risk percentage must be between 0 and 100.';
  }

  return null;
}

// ==========================================
// USER SESSION AUTHENTICATION
// The session cookie is an HMAC-signed payload, so the client cannot mint a
// session for an arbitrary user. Identity is NEVER taken from request headers.
// ==========================================

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_COOKIE = 'fx_auth_session';

const SESSION_SECRET = (() => {
  const explicit = process.env.SESSION_SECRET?.trim();
  if (explicit && explicit.length >= 32) return explicit;
  if (IS_PRODUCTION_LIKE) {
    if (explicit) {
      console.error('[Auth] SESSION_SECRET is shorter than 32 characters. Refusing to start.');
      throw new Error('SESSION_SECRET must be at least 32 characters in production');
    }
    console.error('[Auth] SESSION_SECRET is not set. Refusing to start in production.');
    throw new Error('SESSION_SECRET is required in production');
  }
  // Development only: stable per-process key so restarts simply log the user out.
  console.warn('[Auth] SESSION_SECRET not set — using an ephemeral development key.');
  return crypto.randomBytes(32).toString('hex');
})();

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signSessionValue(payload: { userId: string; email: string }): string {
  const body = b64url(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySessionValue(raw: string | undefined): { userId: string; email: string } | null {
  if (!raw || typeof raw !== 'string') return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null; // legacy unsigned JSON cookie — reject, user re-logs in
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!parsed?.iat || Date.now() - parsed.iat > SESSION_TTL_MS) return null;
    if (!parsed.userId && !parsed.email) return null;
    const session = { userId: String(parsed.userId || ''), email: String(parsed.email || '') };
    if (isSessionRevoked(session, parsed.iat)) return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * Email delivery is not optional in production.
 *
 * Registration issues a one-time code and the account stays unverified until
 * it is entered; an unverified account is refused on every authenticated
 * route. With no provider configured, sendOtpEmail() falls back to printing
 * the code to this log and returns success:false — and because devOtp is
 * withheld outside development, the code exists nowhere the user can reach.
 *
 * So the failure looks like a working signup: the form submits, the OTP screen
 * appears, and no mail ever arrives. Nobody can complete registration, and
 * nothing says why. Refuse to boot instead, the way a missing SESSION_SECRET
 * does. ALLOW_NO_EMAIL=true is the escape hatch for a deliberately
 * console-only deployment.
 */
if (IS_PRODUCTION_LIKE) {
  const hasSendgrid = !!process.env.SENDGRID_API_KEY?.trim();
  const hasResend = !!process.env.RESEND_API_KEY?.trim();
  if (!hasSendgrid && !hasResend) {
    console.error(
      '[Email] No SENDGRID_API_KEY or RESEND_API_KEY is set. Verification codes ' +
      'would only be written to this log, so no user could finish signing up. ' +
      'Set one, or set ALLOW_NO_EMAIL=true to start anyway.'
    );
    if (process.env.ALLOW_NO_EMAIL !== 'true') {
      throw new Error('An email provider is required in production');
    }
    console.warn('[Email] ALLOW_NO_EMAIL=true — starting with no way to deliver verification codes.');
  }
}

// Server-side revocation. Clearing the cookie only removes the browser's copy —
// a token captured before logout stayed valid for its full 30 days. Logout now
// records a cut-off per user and any token issued before it is refused.
//
// In-memory, so it resets on restart (which invalidates everything anyway) and
// is per-instance on serverless. Move to a shared store — a sessions_revoked_at
// column, or Redis — when running more than one instance.
const sessionRevokedAt = new Map<string, number>();
const REVOCATION_TTL_MS = SESSION_TTL_MS;

function revokeSessionsFor(key: string) {
  if (!key) return;
  sessionRevokedAt.set(key.toLowerCase(), Date.now());
  // Drop entries older than any token could still be valid for.
  const cutoff = Date.now() - REVOCATION_TTL_MS;
  for (const [k, t] of sessionRevokedAt) if (t < cutoff) sessionRevokedAt.delete(k);
}

function isSessionRevoked(session: { userId: string; email: string }, issuedAt: number): boolean {
  for (const key of [session.userId, session.email]) {
    if (!key) continue;
    const revokedAt = sessionRevokedAt.get(key.toLowerCase());
    if (revokedAt && issuedAt <= revokedAt) return true;
  }
  return false;
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION_LIKE,
    sameSite: 'lax' as const,
    path: '/',
  };
}

function issueSession(res: any, user: { id: string; email: string }): string {
  const token = signSessionValue({ userId: user.id, email: user.email });
  res.cookie(SESSION_COOKIE, token, {
    ...sessionCookieOptions(),
    maxAge: SESSION_TTL_MS,
  });
  return token;
}

function clearSession(res: any) {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}

// Strip every secret before a user object crosses the network. Applied to EVERY
// response that carries a user (login, register, /me, admin lists, ...).
function sanitizeUser<T>(user: T): T {
  if (!user || typeof user !== 'object') return user;
  const clone: any = { ...(user as any) };
  for (const key of [
    'password', 'passwordHash', 'password_hash',
    'emailOtp', 'email_otp', 'otpExpiresAt', 'otp_expires_at',
    'resetOtp', 'reset_otp', 'resetOtpExpiresAt', 'reset_otp_expires_at',
    'otpAttempts', 'otp_attempts', 'otpSentAt', 'otp_sent_at',
    'mt5InvestorPassword', 'mt5_investor_password',
    'eaToken', 'ea_token',
  ]) {
    delete clone[key];
  }
  return clone;
}

function sanitizeUsers(users: any[]): any[] {
  return (users || []).map((u) => sanitizeUser(u));
}

// Whether the OTP may be echoed back in an API response. Never in production —
// otherwise anyone can request a code for any address and read it straight back.
function canExposeOtp(): boolean {
  return IS_DEV && process.env.EXPOSE_DEV_OTP !== 'false';
}

// ==========================================
// EA AUTHENTICATION (Phase 2: HMAC + replay protection)
// Signature = HMAC-SHA256(secret = sha256(ea_token),
//             message = "<timestamp>.<accountId>.<rawBody>")
// Legacy plain-token auth stays enabled unless EA_ALLOW_LEGACY_TOKEN=false.
// ==========================================

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeTokenEqual(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function hmacSign(message: string, token: string): string {
  return crypto.createHmac('sha256', sha256Hex(token)).update(message, 'utf8').digest('hex');
}

// Build the HMAC message exactly as the EA does: "<timestamp>.<accountId>.<rawBody>"
function eaHmacMessage(timestamp: string, accountId: string, rawBody: string): string {
  return `${timestamp}.${accountId}.${rawBody || ''}`;
}

// Verify the HMAC signature + timestamp window on an EA request.
// Also checks the optional requestId against the account's processed set (TTL 24h).
function verifyEaSignature(req: any, account: any, token: string): { ok: boolean; code?: string; reason?: string } {
  const headerSig = (req.headers['x-ea-signature'] || '').toString().trim();
  const headerTs = (req.headers['x-ea-timestamp'] || '').toString().trim();
  const accountId = String(account.id || '');
  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';

  if (!headerSig || !headerTs) {
    return { ok: false, code: 'EA_SIGNATURE_MISSING', reason: 'Missing X-EA-Signature / X-EA-Timestamp headers' };
  }

  // Replay window: reject timestamps older/newer than ±EA_SIGNATURE_WINDOW_MIN
  const ts = Date.parse(headerTs);
  if (Number.isNaN(ts)) {
    return { ok: false, code: 'EA_BAD_TIMESTAMP', reason: 'X-EA-Timestamp is not a valid date' };
  }
  const windowMin = parseFloat(process.env.EA_SIGNATURE_WINDOW_MIN || '5');
  const now = Date.now();
  if (Math.abs(now - ts) > windowMin * 60 * 1000) {
    return { ok: false, code: 'EA_STALE_TIMESTAMP', reason: 'Request timestamp outside allowed window' };
  }

  const expected = hmacSign(eaHmacMessage(headerTs, accountId, rawBody), token);
  const provided = Buffer.from(headerSig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const sigOk = provided.length === expectedBuf.length && crypto.timingSafeEqual(provided, expectedBuf);
  if (!sigOk) {
    return { ok: false, code: 'SIGNATURE_MISMATCH', reason: 'HMAC signature does not match' };
  }

  // Optional idempotency key: drop retransmissions of the same requestId within 24h
  const requestId = (req.headers['x-ea-request-id'] || '').toString().trim();
  if (requestId) {
    if (!account.eaProcessedRequests) account.eaProcessedRequests = {};
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const known = account.eaProcessedRequests[requestId];
    if (known && known.ts > cutoff) {
      return { ok: false, code: 'EA_REPLAY', reason: 'requestId already processed' };
    }
  }

  return { ok: true };
}

// Resolve the EA token for a request: Authorization Bearer header first
// (Phase 2), then the legacy JSON body `token` field (EA_ALLOW_LEGACY_TOKEN).
function resolveEaToken(req: any, bodyToken?: string): string {
  const auth = (req.headers['authorization'] || '').toString().trim();
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (process.env.EA_ALLOW_LEGACY_TOKEN !== 'false') return (bodyToken || '').toString().trim();
  return '';
}

// Shared auth for EA machine-to-machine endpoints.
// Resolves the account, verifies the token (constant-time) and HMAC signature.
// Returns { db, account, token } on success or an HTTP-ready error response.
async function authEaRequest(req: any, res: any, bodyToken?: string): Promise<{ db: any; account: any; token: string } | null> {
  const accountId = String(req.headers['x-ea-account-id'] || req.body?.accountId || '');
  if (!accountId) {
    res.status(400).json({ error: 'accountId is required', code: 'EA_ACCOUNT_REQUIRED' });
    return null;
  }

  const db = await findDbByAccountId(accountId);
  if (!db) {
    res.status(404).json({ error: 'Account not found', code: 'EA_ACCOUNT_NOT_FOUND' });
    return null;
  }
  const account = db.accounts.find((a: any) => a.id === accountId);
  if (!account) {
    res.status(404).json({ error: 'Account not found', code: 'EA_ACCOUNT_NOT_FOUND' });
    return null;
  }

  const token = resolveEaToken(req, bodyToken);
  if (!token || !account.eaToken || !safeTokenEqual(token, account.eaToken)) {
    res.status(401).json({ error: 'Invalid EA token. Reset the token from your dashboard and download a new EA file.', code: 'EA_AUTH_FAILED' });
    return null;
  }
  if (account.eaTokenRevokedAt) {
    res.status(401).json({ error: 'EA token revoked. Download a fresh EA file.', code: 'EA_TOKEN_REVOKED' });
    return null;
  }

  const sig = verifyEaSignature(req, account, token);
  if (!sig.ok) {
    // Legacy EA builds sign nothing; only allow the missing-signature path when
    // the client did not send signature headers at all AND legacy auth is enabled.
    const legacyAllowed = process.env.EA_ALLOW_LEGACY_TOKEN !== 'false';
    const sentSignatureHeaders = !!((req.headers['x-ea-signature'] || '') || (req.headers['x-ea-timestamp'] || ''));
    if (!(legacyAllowed && !sentSignatureHeaders)) {
      res.status(401).json({ error: sig.reason, code: sig.code });
      return null;
    }
  } else {
    const requestId = (req.headers['x-ea-request-id'] || '').toString().trim();
    if (requestId) {
      account.eaProcessedRequests = account.eaProcessedRequests || {};
      account.eaProcessedRequests[requestId] = { ts: Date.now() };
    }
  }

  return { db, account, token };
}

// Append a sanitized audit / sync log entry to the account's DB and (optionally) Supabase
function logEaEvent(db: any, account: any, event: string, level: string, message: string, requestId?: string) {
  try {
    if (!Array.isArray(db.mt5SyncLogs)) db.mt5SyncLogs = [];
    db.mt5SyncLogs.push({
      accountId: account.id,
      userId: db.users?.[0]?.id,
      requestId: requestId || null,
      event,
      level,
      message,
      createdAt: new Date().toISOString()
    });
    if (db.mt5SyncLogs.length > 2000) db.mt5SyncLogs = db.mt5SyncLogs.slice(-2000);
  } catch (e) {
    console.error('[EA] logEaEvent error:', e);
  }
}

// Persist a deal to the account-scoped stream (mt5_deals_v2) in memory + Supabase
function addEaDeal(db: any, account: any, deal: any, userId: string | undefined) {
  if (!Array.isArray(db.mt5Deals)) db.mt5Deals = [];
  db.mt5Deals.push({ ...deal, accountId: account.id, userId });
  if (!Array.isArray(db.mt5DealsV2)) db.mt5DealsV2 = [];
  const existing = db.mt5DealsV2.find((d: any) => d.accountId === account.id && d.ticket === deal.ticket);
  if (existing) Object.assign(existing, { ...deal, userId });
  else db.mt5DealsV2.push({ accountId: account.id, userId, ticket: deal.ticket, deal, createdAt: new Date().toISOString() });
  if (db.mt5DealsV2.length > 20000) db.mt5DealsV2 = db.mt5DealsV2.slice(-20000);
}

// ---- Cloud (investor-password) credential helpers ----------------------
// The investor password is ONLY used by the cloud bridge path and is never
// stored in plaintext. It is encrypted with AES-256-GCM under a random DEK;
// the DEK is then wrapped (envelope) with a master key from the environment.
// Everything is packed into `investorPasswordEnc` so the schema's three
// columns remain sufficient.

function cloudMasterKey(): Buffer | null {
  const raw = process.env.MT5_CREDENTIAL_MASTER_KEY?.trim() || 'journalpro-default-mt5-secret-key-32bytes-long';
  if (!raw) return null;
  const hex = raw.length === 64 ? raw : sha256Hex(raw);
  return Buffer.from(hex, 'hex');
}

function encryptInvestorPassword(plaintext: string): { enc: string; keyId: string } | null {
  const master = cloudMasterKey();
  if (!master) return null;
  const dek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrapIv = crypto.randomBytes(12);
  const wc = crypto.createCipheriv('aes-256-gcm', master, wrapIv);
  const wct = Buffer.concat([wc.update(dek), wc.final()]);
  const wt = wc.getAuthTag();
  // layout: iv(12) + tag(16) + wrapIv(12) + wrapTag(16) + wrappedDEK(32) + ct
  const payload = Buffer.concat([iv, tag, wrapIv, wt, wct, ct]);
  const keyId = 'env:' + sha256Hex(master.toString('hex')).slice(0, 8);
  return { enc: payload.toString('base64'), keyId };
}

function decryptInvestorPassword(account: any): string | null {
  try {
    const encB64 = account.investorPasswordEnc;
    if (!encB64) return null;
    const master = cloudMasterKey();
    if (!master) return null;
    const payload = Buffer.from(encB64, 'base64');
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const wrapIv = payload.subarray(28, 40);
    const wrapTag = payload.subarray(40, 56);
    const wct = payload.subarray(56, 88);
    const ct = payload.subarray(88);
    const wd = crypto.createDecipheriv('aes-256-gcm', master, wrapIv);
    wd.setAuthTag(wrapTag);
    const dek = Buffer.concat([wd.update(wct), wd.final()]);
    const d = crypto.createDecipheriv('aes-256-gcm', dek, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch (e: any) {
    console.error('[Cloud] decryptInvestorPassword failed:', e?.message || e);
    return null;
  }
}

function clearInvestorPassword(account: any) {
  delete account.investorPasswordEnc;
  delete account.passwordEncNonce;
  delete account.passwordKmsKeyId;
}

// Append a PENDING connect job for the cloud/VPS worker queue
function enqueueConnectJob(db: any, account: any, action: string): string {
  if (!Array.isArray(db.mt5ConnectJobs)) db.mt5ConnectJobs = [];
  const jobId = `job_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  db.mt5ConnectJobs.push({
    id: jobId,
    accountId: account.id,
    userId: db.users?.[0]?.id,
    action,
    status: 'PENDING',
    attempts: 0,
    payload: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  return jobId;
}

// ---- Cloud (MetaApi) worker ------------------------------------------------
// Processes PENDING mt5_connect_jobs with the MetaApi cloud SDK. The investor
// password is never logged; it is decrypted just-in-time from the AES envelope
// and used only to (re)deploy the MetaApi cloud terminal for the account.

const META_DEAL_TYPE: Record<string, number> = {
  DEAL_TYPE_BUY: 0,
  DEAL_TYPE_SELL: 1,
  DEAL_TYPE_BALANCE: 2,
  DEAL_TYPE_CREDIT: 3,
  DEAL_TYPE_CHARGE: 4,
  DEAL_TYPE_CORRECTION: 5,
  DEAL_TYPE_BONUS: 6,
  DEAL_TYPE_COMMISSION: 7,
  DEAL_TYPE_COMMISSION_DAILY: 8,
  DEAL_TYPE_COMMISSION_MONTHLY: 9,
  DEAL_TYPE_COMMISSION_AGENT_DAILY: 10,
  DEAL_TYPE_COMMISSION_AGENT_MONTHLY: 11,
  DEAL_TYPE_INTEREST: 12,
  DEAL_TYPE_BUY_CANCELED: 13,
  DEAL_TYPE_SELL_CANCELED: 14,
  DEAL_TYPE_DIVIDEND: 15,
  DEAL_TYPE_DIVIDEND_FRANKED: 16,
  DEAL_TYPE_TAX: 17
};
const META_DEAL_ENTRY: Record<string, number> = {
  DEAL_ENTRY_IN: 0,
  DEAL_ENTRY_OUT: 1,
  DEAL_ENTRY_INOUT: 2,
  DEAL_ENTRY_OUT_BY: 3
};

let cloudApi: any = null;
const cloudWorkers = new Map<string, { account: any; connection: any; failing: boolean }>();
const cloudJobLocks = new Set<string>();

function getCloudApi(): any {
  const token = process.env.META_API_TOKEN?.trim();
  if (!token) return null;
  if (!cloudApi) {
    cloudApi = new MetaApi(token, {
      application: 'journalpro',
      requestTimeout: 60,
      connectTimeout: 60
    });
  }
  return cloudApi;
}

function cloudErrorCode(e: any): string {
  const code = e?.details?.code || e?.code;
  if (code) return String(code);
  if (e instanceof Error && /timeout/i.test(e.message || '')) return 'CLOUD_TIMEOUT';
  return 'CLOUD_SYNC_FAILED';
}

function cloudErrorMessage(e: any): string {
  return String(e?.details?.message || e?.message || e || 'Unknown cloud worker error');
}

function setCloudJob(db: any, job: any, status: string, message: string) {
  job.status = status;
  job.updatedAt = new Date().toISOString();
  job.statusMessage = String(message).slice(0, 200);
  logEaEvent(db, { id: job.accountId }, 'CLOUD_' + status, 'info', String(message).slice(0, 200));
}

function failCloudJob(db: any, job: any, account: any, e: any) {
  const code = cloudErrorCode(e);
  const message = cloudErrorMessage(e);
  job.status = 'FAILED';
  job.errorCode = code;
  job.errorMessage = message.slice(0, 500);
  job.attempts = (job.attempts || 0) + 1;
  job.updatedAt = new Date().toISOString();
  if (account) {
    account.connectionStatus = 'Error';
    account.eaStatus = 'Error';
    if (!Array.isArray(db.mt5ConnectionErrors)) db.mt5ConnectionErrors = [];
    db.mt5ConnectionErrors.push({
      accountId: account.id,
      userId: db.users?.[0]?.id,
      errorCode: code,
      errorMessage: message.slice(0, 500),
      occurredAt: new Date().toISOString(),
      resolvedAt: null
    });
    logEaEvent(db, account, 'CLOUD_JOB_FAILED', 'error', `${code}: ${message.slice(0, 200)}`);
  }
}

function mapMetaDeal(d: any): any {
  const type = META_DEAL_TYPE[d.type];
  const entry = META_DEAL_ENTRY[d.entryType];
  if (type === undefined || entry === undefined) return null;
  return {
    ticket: Number(d.id),
    positionId: Number(d.positionId) || 0,
    time: Math.floor(new Date(d.time).getTime() / 1000),
    type,
    entry,
    magic: Number(d.magic) || 0,
    symbol: String(d.symbol || '').toUpperCase(),
    volume: parseFloat(d.volume) || 0,
    price: parseFloat(d.price) || 0,
    profit: parseFloat(d.profit) || 0,
    commission: parseFloat(d.commission) || 0,
    swap: parseFloat(d.swap) || 0,
    comment: String(d.comment || '')
  };
}

function replaceCloudPositions(db: any, account: any, positions: any[]) {
  if (!Array.isArray(db.mt5OpenPositions)) db.mt5OpenPositions = [];
  const posMap = new Map<string, any>();
  for (const p of positions) {
    posMap.set(`${account.id}:${p.id}`, {
      accountId: account.id,
      userId: db.users?.[0]?.id,
      positionId: Number(p.id),
      ticket: Number(p.id),
      symbol: String(p.symbol || '').toUpperCase(),
      side: String(p.type === 'POSITION_TYPE_BUY' ? 'Buy' : p.type === 'POSITION_TYPE_SELL' ? 'Sell' : p.type || ''),
      volume: p.volume,
      openTime: p.time ? new Date(p.time).toISOString() : new Date().toISOString(),
      openPrice: p.openPrice,
      sl: p.stopLoss ?? null,
      tp: p.takeProfit ?? null,
      commission: p.commission ?? 0,
      swap: p.swap ?? 0,
      profit: p.profit ?? 0,
      currentPrice: p.currentPrice ?? null,
      updatedAt: new Date().toISOString()
    });
  }
  db.mt5OpenPositions = db.mt5OpenPositions.filter((op: any) => op.accountId !== account.id);
  db.mt5OpenPositions.push(...posMap.values());
}

function replaceCloudPendingOrders(db: any, account: any, orders: any[]) {
  if (!Array.isArray(db.mt5PendingOrders)) db.mt5PendingOrders = [];
  const orderMap = new Map<string, any>();
  for (const o of orders) {
    orderMap.set(`${account.id}:${o.id}`, {
      accountId: account.id,
      userId: db.users?.[0]?.id,
      orderId: Number(o.id),
      symbol: String(o.symbol || '').toUpperCase(),
      type: String(o.type || ''),
      volume: o.volume,
      openPrice: o.openPrice,
      sl: o.stopLoss ?? null,
      tp: o.takeProfit ?? null,
      magic: o.magic ?? 0,
      state: String(o.state || ''),
      updatedAt: new Date().toISOString()
    });
  }
  db.mt5PendingOrders = db.mt5PendingOrders.filter((op: any) => op.accountId !== account.id);
  db.mt5PendingOrders.push(...orderMap.values());
}

function pushCloudSnapshot(db: any, account: any, info: any) {
  if (!Array.isArray(db.mt5Snapshots)) db.mt5Snapshots = [];
  db.mt5Snapshots.push({
    accountId: account.id,
    userId: db.users?.[0]?.id,
    balance: info?.balance ?? account.currentBalance ?? null,
    equity: info?.equity ?? account.equity ?? null,
    margin: info?.margin ?? null,
    marginFree: info?.marginFree ?? null,
    marginLevel: info?.marginLevel ?? null,
    currency: info?.currency || account.currency || null,
    leverage: info?.leverage ?? null,
    capturedAt: new Date().toISOString()
  });
  if (db.mt5Snapshots.length > 20000) db.mt5Snapshots = db.mt5Snapshots.slice(-20000);
}

// Re-establish (or reuse) the cached RPC connection for a cloud account.
// Used after a server restart where accounts are still marked Connected.
async function ensureCloudSession(api: any, account: any) {
  const existing = cloudWorkers.get(account.id);
  if (existing && existing.connection) return existing;
  if (!account.mt5CloudAccountId) throw new Error('No cloud terminal is assigned to this account');
  const ma = await api.metatraderAccountApi.getAccount(account.mt5CloudAccountId);
  if (ma.state !== 'DEPLOYED') {
    await ma.deploy();
    await ma.waitDeployed(300, 5000);
  }
  await ma.waitConnected(300, 5000);
  const connection = ma.getRPCConnection();
  await connection.connect();
  await connection.waitSynchronized(300);
  const session = { account: ma, connection, failing: false };
  cloudWorkers.set(account.id, session);
  return session;
}

async function cloudSyncNow(db: any, account: any, session: any, initial: boolean) {
  const conn = session.connection;
  const info = await conn.getAccountInformation();
  const currency = info?.currency || account.currency || 'USD';
  const now = new Date();

  const backfillDays = Math.max(1, parseInt(process.env.MT5_CLOUD_BACKFILL_DAYS || '90', 10));
  const start = initial
    ? new Date(now.getTime() - backfillDays * 86400000)
    : new Date((account.eaLastSyncTime ? new Date(account.eaLastSyncTime).getTime() : now.getTime()) - 120000);

  let deals: any[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const res: any = await conn.getDealsByTimeRange(start, now);
    deals = (res?.deals || []).map(mapMetaDeal).filter(Boolean);
    if (!res?.synchronizing) break;
    await new Promise((r) => setTimeout(r, 10000 * (attempt + 1)));
  }

  const moneyFlows = deals
    .filter((d: any) => !d.symbol && (d.type === DEAL_TYPE_BALANCE || d.type === DEAL_TYPE_CREDIT))
    .map((d: any) => ({
      ticket: d.ticket,
      type: d.type === DEAL_TYPE_BALANCE ? (d.profit >= 0 ? 'DEPOSIT' : 'WITHDRAWAL') : 'CREDIT',
      amount: d.profit,
      currency,
      time: d.time
    }));

  const summary = applyEaSyncPayload(db, account, deals, moneyFlows, {
    balance: info?.balance,
    equity: info?.equity,
    currency
  });

  let positions: any[] = [];
  try { positions = await conn.getPositions(); } catch { /* positions are optional */ }
  let orders: any[] = [];
  try { orders = await conn.getOrders(); } catch { /* orders are optional */ }
  replaceCloudPositions(db, account, positions);
  replaceCloudPendingOrders(db, account, orders);

  account.currency = currency;
  if (info?.leverage) account.leverage = info?.leverage;
  if (info?.server) account.mt5Server = info?.server;
  pushCloudSnapshot(db, account, info);

  account.eaLastSyncTime = new Date().toISOString();
  account.lastHeartbeatAt = new Date().toISOString();
  logEaEvent(db, account, 'CLOUD_SYNC', 'info',
    `Cloud sync: ${summary.added} new deals, ${summary.moneyFlowAdded} new money flows, ${positions.length} open positions, ${orders.length} pending orders`);
  await saveDatabase(db, db.users?.[0]?.email);
}

async function runCloudConnect(db: any, job: any, account: any) {
  setCloudJob(db, job, 'IN_PROGRESS', 'Decrypting MT5 investor credentials');
  const password = decryptInvestorPassword(account);
  if (!password) {
    throw new Error('Investor password could not be decrypted (is MT5_CREDENTIAL_MASTER_KEY configured?)');
  }
  const login = String(account.mt5Login || '').trim();
  const server = String(account.mt5Server || '').trim();
  if (!login || !server) throw new Error('MT5 login/server are not set on this account');
  account.isMt5Sync = true;

  const api = getCloudApi();
  if (!api) throw new Error('META_API_TOKEN is not configured on this deployment');

  let ma: any = null;
  try {
    setCloudJob(db, job, 'PROVISIONING', 'Locating existing MetaApi terminal');
    const accounts = await api.metatraderAccountApi.getAccountsWithInfiniteScrollPagination();
    let ma: any = accounts.find(
      (a: any) => a.version === 5 && String(a.login) === login && String(a.server) === server
    );
    if (ma) {
      // Refresh credentials so the terminal connects with the investor password
      // the user just entered (even if an earlier session reused this account).
      setCloudJob(db, job, 'PROVISIONING', 'Updating credentials on existing terminal');
      try {
        await ma.update({ name: ma.name || `JournalPro ${login}`, server, magic: 0, password });
      } catch (e) {
        console.error('[Cloud] update existing account failed:', cloudErrorMessage(e));
      }
      setCloudJob(db, job, 'DEPLOYING', 'Restarting terminal with updated credentials');
      await ma.redeploy();
      await ma.waitDeployed(300, 5000);
    } else {
      setCloudJob(db, job, 'PROVISIONING', 'Creating cloud terminal (a few minutes)');
      ma = await api.metatraderAccountApi.createAccount({
        name: `JournalPro ${login}`,
        type: 'cloud-g2',
        login,
        password,
        server,
        platform: 'mt5',
        magic: 0,
        quoteStreamingIntervalInSeconds: 0
      });
      if (ma.state !== 'DEPLOYED') {
        try { await ma.deploy(); } catch { /* may already be deploying */ }
      }
      setCloudJob(db, job, 'DEPLOYING', 'Starting cloud terminal (a few minutes)');
      await ma.waitDeployed(300, 5000);
    }
    account.mt5CloudAccountId = ma.id;
    account.mt5CloudRegion = ma.region;
    setCloudJob(db, job, 'CONNECTING', 'Connecting to broker');
    await ma.waitConnected(300, 5000);
    const connection = ma.getRPCConnection();
    await connection.connect();
    await connection.waitSynchronized(300);

    cloudWorkers.set(account.id, { account: ma, connection, failing: false });

    setCloudJob(db, job, 'SYNCING', 'Importing account history');
    await cloudSyncNow(db, account, { account: ma, connection, failing: false }, true);

    setCloudJob(db, job, 'IN_PROGRESS', 'Deprovisioning temporary cloud terminal');
    try { await connection.disconnect(); } catch { }
    try { await ma.remove(); } catch { }
    cloudWorkers.delete(account.id);
    delete account.mt5CloudAccountId;
    delete account.mt5CloudRegion;

    account.syncMethod = 'CLOUD';
    account.connectionStatus = 'Connected';
    account.eaStatus = 'Connected';
    account.eaTerminalLogin = login;
    account.eaTerminalServer = server;
    account.eaConnectedAt = account.eaConnectedAt || new Date().toISOString();

    setCloudJob(db, job, 'CONNECTED', 'Cloud sync completed and terminal removed');
    logEaEvent(db, account, 'CLOUD_CONNECTED', 'info', 'Cloud sync connected and synced via MetaApi');
    await saveDatabase(db, db.users?.[0]?.email);
  } catch (e) {
    if (ma) {
      try { await ma.remove(); } catch { }
    }
    cloudWorkers.delete(account.id);
    delete account.mt5CloudAccountId;
    throw e;
  }
}

async function runCloudSyncNow(db: any, job: any, account: any) {
  setCloudJob(db, job, 'IN_PROGRESS', 'Decrypting MT5 investor credentials for sync');
  const password = decryptInvestorPassword(account);
  if (!password) {
    throw new Error('Investor password could not be decrypted');
  }
  const login = String(account.mt5Login || '').trim();
  const server = String(account.mt5Server || '').trim();
  if (!login || !server) throw new Error('MT5 login/server are not set');

  const api = getCloudApi();
  if (!api) throw new Error('META_API_TOKEN is not configured');

  let ma: any = null;
  try {
    setCloudJob(db, job, 'PROVISIONING', 'Creating temporary cloud terminal for sync (a few minutes)');
    ma = await api.metatraderAccountApi.createAccount({
      name: `JournalPro Sync ${login}`,
      type: 'cloud-g2',
      login,
      password,
      server,
      platform: 'mt5',
      magic: 0,
      quoteStreamingIntervalInSeconds: 0
    });
    if (ma.state !== 'DEPLOYED') {
      try { await ma.deploy(); } catch { /* may already be deploying */ }
    }
    setCloudJob(db, job, 'DEPLOYING', 'Starting temporary cloud terminal');
    await ma.waitDeployed(300, 5000);

    setCloudJob(db, job, 'CONNECTING', 'Connecting to broker');
    await ma.waitConnected(300, 5000);
    const connection = ma.getRPCConnection();
    await connection.connect();
    await connection.waitSynchronized(300);

    setCloudJob(db, job, 'SYNCING', 'Fetching new trades');
    await cloudSyncNow(db, account, { account: ma, connection, failing: false }, false);

    setCloudJob(db, job, 'IN_PROGRESS', 'Deprovisioning temporary cloud terminal');
    try { await connection.disconnect(); } catch { }
    try { await ma.remove(); } catch { }

    setCloudJob(db, job, 'DONE', 'Sync completed successfully');
    logEaEvent(db, account, 'CLOUD_SYNC_DONE', 'info', 'Manual cloud sync completed');
    await saveDatabase(db, db.users?.[0]?.email);
  } catch (e) {
    if (ma) {
      try { await ma.remove(); } catch { }
    }
    throw e;
  }
}

async function runCloudDisconnect(db: any, job: any, account: any) {
  setCloudJob(db, job, 'IN_PROGRESS', 'Deprovisioning cloud terminal');
  const api = getCloudApi();
  if (api) {
    const cached = cloudWorkers.get(account.id);
    if (cached) {
      try { await cached.connection.disconnect(); } catch { /* best effort */ }
      try { await cached.account.remove(); } catch { /* best effort */ }
      cloudWorkers.delete(account.id);
    } else if (account.mt5CloudAccountId) {
      try {
        const ma = await api.metatraderAccountApi.getAccount(account.mt5CloudAccountId);
        await ma.remove();
      } catch { /* account may already be gone */ }
    }
  }
  delete account.mt5CloudAccountId;
  delete account.mt5CloudRegion;
  setCloudJob(db, job, 'DONE', 'Cloud sync disconnected');
  logEaEvent(db, account, 'CLOUD_DISCONNECTED', 'info', 'Cloud terminal deprovisioned');
  await saveDatabase(db, db.users?.[0]?.email);
}

async function runCloudJob(db: any, job: any) {
  const account = db.accounts?.find((a: any) => a.id === job.accountId);
  if (!account) {
    failCloudJob(db, job, null, new Error('Account not found'));
    return;
  }
  try {
    if (job.action === 'CONNECT') await runCloudConnect(db, job, account);
    else if (job.action === 'DISCONNECT') await runCloudDisconnect(db, job, account);
    else if (job.action === 'SYNC_NOW') await runCloudSyncNow(db, job, account);
    else throw new Error(`Unknown job action: ${job.action}`);
  } catch (e) {
    failCloudJob(db, job, account, e);
  }
}

async function processCloudJobs() {
  const api = getCloudApi();
  if (!api) return;
  for (const db of userDatabases.values()) {
    if (!db || !Array.isArray(db.mt5ConnectJobs)) continue;
    for (const job of db.mt5ConnectJobs) {
      if (job.status !== 'PENDING') continue;
      if (cloudJobLocks.has(job.id)) continue;
      cloudJobLocks.add(job.id);
      setImmediate(() => {
        runCloudJob(db, job).catch(() => { }).finally(() => cloudJobLocks.delete(job.id));
      });
    }
  }
}

async function cloudSyncLoopTick() {
  const api = getCloudApi();
  if (!api) return;
  for (const [uid, db] of userDatabases) {
    for (const account of db?.accounts || []) {
      if (account.syncMethod !== 'CLOUD' || account.connectionStatus !== 'Connected') continue;
      try {
        const session = await ensureCloudSession(api, account);
        await cloudSyncNow(db, account, session, false);
        session.failing = false;
      } catch (e) {
        console.error('[Cloud] sync failed for account', account.id, cloudErrorMessage(e));
        cloudWorkers.delete(account.id);
        if (!Array.isArray(db.mt5ConnectionErrors)) db.mt5ConnectionErrors = [];
        db.mt5ConnectionErrors.push({
          accountId: account.id,
          userId: db.users?.[0]?.id,
          errorCode: 'CLOUD_SYNC_LOST',
          errorMessage: String(cloudErrorMessage(e)).slice(0, 500),
          occurredAt: new Date().toISOString(),
          resolvedAt: null
        });
        account.connectionStatus = 'Error';
        logEaEvent(db, account, 'CLOUD_SYNC_LOST', 'error', String(cloudErrorMessage(e)).slice(0, 200));
        await saveDatabase(db, db.users?.[0]?.email);
      }
    }
  }
}

function startCloudWorker() {
  // A background interval only survives on a long-running process. On Vercel or
  // Netlify every request is a fresh instance that is frozen as soon as it
  // responds, so the timer would never fire — better to say so than to look
  // like it works.
  if (IS_SERVERLESS) {
    console.warn('[MT5 Cloud] Background worker not started: serverless runtime has no long-lived process. Run the cloud sync on a dedicated host or an external scheduler.');
    return;
  }
  setInterval(() => { processCloudJobs().catch(() => { }); }, 5000);
  const syncSeconds = Math.max(10, parseInt(process.env.MT5_CLOUD_SYNC_INTERVAL_SECONDS || '60', 10));  // setInterval(() => { cloudSyncLoopTick().catch(() => {}); }, syncSeconds * 1000);
}

export function startCloudWorkers() {
  setInterval(() => { processCloudJobs().catch(() => { }); }, 2000);
  // setTimeout(() => { cloudSyncLoopTick().catch(() => {}); }, 15000);;
}

// Strict payload schemas for EA endpoints (unknown fields rejected via .strict())
const finiteNumber = () => z.number().finite();
const positiveInt = () => z.number().int().positive();
const boundedString = (max: number) => z.string().max(max);
// Legacy EA builds send the token in the body; Phase 2 EAs send it in the
// Authorization header. `token` is therefore accepted (but never required).
const legacyTokenField = { token: boundedString(128).optional() };

const EaValidateSchema = z.object({
  accountId: boundedString(64),
  login: boundedString(24),
  server: boundedString(64),
  build: positiveInt().optional(),
  terminal: z.object({
    login: boundedString(24).optional(),
    server: boundedString(64).optional(),
    build: positiveInt().optional()
  }).optional(),
  ...legacyTokenField
}).strict();

const EaAccountSchema = z.object({
  accountId: boundedString(64),
  balance: finiteNumber(),
  equity: finiteNumber(),
  margin: finiteNumber().optional(),
  marginFree: finiteNumber().optional(),
  marginLevel: finiteNumber().optional(),
  currency: boundedString(8).optional(),
  leverage: z.number().int().min(1).max(10000).optional(),
  ...legacyTokenField
}).strict();

const EaPositionSchema = z.object({
  accountId: boundedString(64),
  positions: z.array(z.object({
    positionId: z.union([z.number(), z.string()]),
    ticket: z.union([z.number(), z.string()]),
    symbol: boundedString(32),
    side: boundedString(8),
    volume: finiteNumber(),
    openTime: z.number(),
    openPrice: finiteNumber(),
    sl: finiteNumber().nullable().optional(),
    tp: finiteNumber().nullable().optional(),
    commission: finiteNumber().optional(),
    swap: finiteNumber().optional(),
    profit: finiteNumber().optional(),
    currentPrice: finiteNumber().optional()
  }).strict()).max(500),
  ...legacyTokenField
}).strict();

const EaOrderSchema = z.object({
  accountId: boundedString(64),
  orders: z.array(z.object({
    orderId: z.union([z.number(), z.string()]),
    symbol: boundedString(32),
    type: boundedString(32),
    volume: finiteNumber(),
    openPrice: finiteNumber(),
    sl: finiteNumber().nullable().optional(),
    tp: finiteNumber().nullable().optional(),
    magic: z.number().int().optional(),
    state: boundedString(16).optional()
  }).strict()).max(500),
  ...legacyTokenField
}).strict();

const EaDealSchema = z.object({
  ticket: z.union([z.number(), z.string()]),
  positionId: z.union([z.number(), z.string()]).optional(),
  time: z.number(),
  type: z.number().int(),
  entry: z.number().int(),
  magic: z.number().int().optional(),
  symbol: boundedString(32).optional(),
  volume: finiteNumber().optional(),
  price: finiteNumber().optional(),
  profit: finiteNumber().optional(),
  commission: finiteNumber().optional(),
  swap: finiteNumber().optional(),
  comment: boundedString(200).optional()
}).strict();

const EaMoneyFlowSchema = z.object({
  ticket: z.union([z.number(), z.string()]),
  type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'CREDIT', 'INTEREST']),
  amount: finiteNumber(),
  currency: boundedString(8).optional(),
  time: z.number()
}).strict();

const EaSyncSchema = z.object({
  accountId: boundedString(64),
  deals: z.array(EaDealSchema).max(200),
  moneyFlows: z.array(EaMoneyFlowSchema).max(200).optional(),
  account: z.object({
    balance: finiteNumber().optional(),
    equity: finiteNumber().optional(),
    currency: boundedString(8).optional()
  }).optional(),
  ...legacyTokenField
}).strict();

const EaHeartbeatSchema = z.object({
  accountId: boundedString(64),
  balance: finiteNumber().optional(),
  equity: finiteNumber().optional(),
  tradeCount: z.number().int().nonnegative().optional(),
  ...legacyTokenField
}).strict();

const EaErrorSchema = z.object({
  accountId: boundedString(64),
  code: boundedString(64).optional(),
  message: boundedString(500).optional(),
  terminal: boundedString(200).optional(),
  ...legacyTokenField
}).strict();

// Cloud bridge (investor password) endpoints — user-authenticated
const CloudConnectSchema = z.object({
  accountId: boundedString(64),
  login: boundedString(24).regex(/^\d{1,12}$/, 'MT5 login must be numeric'),
  server: boundedString(64),
  investorPassword: boundedString(256).min(1, 'Investor password is required')
}).strict();

const CloudDisconnectSchema = z.object({
  accountId: boundedString(64)
}).strict();

// Parse and validate an EA body against a schema; on failure reply 400 and return null
function validateEaBody(res: any, schema: any, body: any): any | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    res.status(400).json({
      error: 'Invalid payload',
      code: 'EA_BAD_PAYLOAD',
      detail: first ? `${first.path.join('.')}: ${first.message}` : 'schema mismatch'
    });
    return null;
  }
  return parsed.data;
}

// Locate a user's DB by trading account id (used by token-authenticated EA calls)
async function findDbByAccountId(accountId: string): Promise<any | null> {
  if (useSupabase) {
    try {
      const { data } = await supabase.from('trading_accounts').select('user_id').eq('id', accountId).maybeSingle();
      if (data?.user_id) return ensureUserDbLoaded(data.user_id, '');
    } catch (e) {
      console.error('[EA] findDbByAccountId supabase error:', e);
    }
    return null;
  }
  for (const d of userDatabases.values()) {
    if (d && Array.isArray(d.accounts) && d.accounts.some((a: any) => a.id === accountId)) return d;
  }
  return null;
}

const DEAL_TYPE_BUY = 0;
const DEAL_TYPE_SELL = 1;
const DEAL_TYPE_BALANCE = 2;
const DEAL_TYPE_CREDIT = 3;
const ENTRY_IN = 0;
const ENTRY_OUT = 1;
const ENTRY_INOUT = 2;

function normalizeDeal(raw: any): any {
  return {
    ticket: Number(raw.ticket),
    positionId: Number(raw.positionId) || 0,
    time: Number(raw.time),
    type: Number(raw.type),
    entry: Number(raw.entry),
    magic: Number(raw.magic) || 0,
    symbol: String(raw.symbol || '').toUpperCase(),
    volume: parseFloat(raw.volume) || 0,
    price: parseFloat(raw.price) || 0,
    profit: parseFloat(raw.profit) || 0,
    commission: parseFloat(raw.commission) || 0,
    swap: parseFloat(raw.swap) || 0,
    comment: String(raw.comment || '')
  };
}

// Rebuild the journal trade list for an account from its stored MT5 deals.
// Positions are only imported once fully closed; deposits/withdrawals are
// mapped from balance/credit deals. Stable ids enable upsert/dedupe.
// skipBalanceTicket omits the initial deposit deal (it is represented by the
// account's starting balance).
function recomputeMt5TradesForAccount(account: any, deals: any[], skipBalanceTicket?: number): Trade[] {
  const result: Trade[] = [];
  const posGroups = new Map<number, any[]>();

  for (const d of deals) {
    if (d.symbol && (d.entry === ENTRY_IN || d.entry === ENTRY_OUT || d.entry === ENTRY_INOUT)) {
      if (!posGroups.has(d.positionId)) posGroups.set(d.positionId, []);
      posGroups.get(d.positionId)!.push(d);
    }
  }

  for (const [posId, list] of posGroups) {
    const inDeals = list.filter((d: any) => d.entry === ENTRY_IN);
    const outDeals = list.filter((d: any) => d.entry === ENTRY_OUT || d.entry === ENTRY_INOUT);
    if (outDeals.length === 0) continue; // position still open — import when closed

    const inDeal = inDeals[0] || outDeals[0];
    const lastOut = outDeals[outDeals.length - 1];
    const totalProfit = list.reduce((s: number, d: any) => s + d.profit, 0);
    const totalComm = list.reduce((s: number, d: any) => s + d.commission, 0);
    const totalSwap = list.reduce((s: number, d: any) => s + d.swap, 0);

    result.push({
      id: `mt5ea_${account.id}_${posId}`,
      accountId: account.id,
      date: new Date(inDeal.time * 1000).toISOString(),
      exitTime: new Date(lastOut.time * 1000).toISOString(),
      symbol: lastOut.symbol || inDeal.symbol || 'UNKNOWN',
      type: (lastOut.type === DEAL_TYPE_SELL ? 'Sell' : 'Buy') as any,
      lotSize: lastOut.volume || inDeal.volume || 0.01,
      entryPrice: inDeal.price,
      exitPrice: lastOut.price,
      profit: totalProfit,
      commission: totalComm,
      swap: totalSwap,
      riskPercentage: 1.0,
      strategy: 'MT5 EA Sync',
      emotion: 'Calm' as any,
      notes: '',
      screenshot: '',
      tags: ['MT5 Sync'],
      isMt5Sync: true,
      eaDealId: lastOut.ticket,
      eaPositionId: posId
    });
  }

  // Balance / credit deals → deposit / withdrawal rows
  for (const d of deals) {
    if (d.symbol) continue;
    if (d.type !== DEAL_TYPE_BALANCE && d.type !== DEAL_TYPE_CREDIT) continue;
    if (skipBalanceTicket !== undefined && d.ticket === skipBalanceTicket) continue;
    const type = d.profit >= 0 ? 'Deposit' : 'Withdrawal';
    result.push({
      id: `mt5ea_${account.id}_dep_${d.ticket}`,
      accountId: account.id,
      date: new Date(d.time * 1000).toISOString(),
      symbol: 'BALANCE',
      type: type as any,
      lotSize: 0,
      entryPrice: 0,
      exitPrice: 0,
      profit: d.profit,
      commission: d.commission,
      swap: d.swap,
      riskPercentage: 1.0,
      strategy: 'MT5 EA Sync',
      emotion: 'Calm' as any,
      notes: '',
      screenshot: '',
      tags: ['MT5 Sync'],
      isMt5Sync: true,
      eaDealId: d.ticket,
      eaPositionId: 0
    });
  }

  return result;
}



async function ensureUserDbLoaded(userId?: string, email?: string) {
  let cleanUserId = userId?.trim() || '';
  let cleanEmail = email?.toLowerCase().trim() || '';

  if (cleanUserId.includes('@') && !cleanEmail) {
    cleanEmail = cleanUserId.toLowerCase();
    cleanUserId = '';
  }
  if (!cleanUserId && !cleanEmail) {
    return createEmptyUserDb('guest_user', 'guest@example.com', false);
  }

  // Load from SQL tables if Supabase is enabled
  if (useSupabase && (cleanUserId || cleanEmail)) {
    try {
      const loadUserData = async (uid: string) => {
        const [
          { data: users },
          { data: accounts },
          { data: trades },
          { data: riskSettings },
          { data: supportTickets },
          { data: mt5Deals }
        ] = await Promise.all([
          supabase.from('users').select('*').eq('id', uid),
          supabase.from('trading_accounts').select('*').eq('user_id', uid),
          supabase.from('trades').select('*').eq('user_id', uid),
          supabase.from('risk_settings').select('*').eq('user_id', uid),
          supabase.from('support_tickets').select('*').eq('user_id', uid),
          supabase.from('mt5_deals').select('*').eq('user_id', uid)
        ]);
        return {
          users: toCamel(users || []),
          accounts: toCamel(accounts || []),
          trades: toCamel(trades || []),
          riskSettings: toCamel(riskSettings || []),
          supportTickets: toCamel(supportTickets || []),
          mt5Deals: toCamel(mt5Deals || []),
          payments: []
        };
      };

      // If we only have an email, look up the user first
      if (!cleanUserId && cleanEmail) {
        const { data: userByEmail } = await supabase.from('users').select('id').eq('email', cleanEmail).maybeSingle();
        if (userByEmail?.id) {
          cleanUserId = userByEmail.id;
        }
      }

      if (!cleanUserId) {
        // Could not resolve a userId from email — return empty DB
        return createEmptyUserDb('', cleanEmail, false);
      }

      let loadedDb = await loadUserData(cleanUserId);

      // Fallback: the provided id may not match the stored row (e.g. OAuth UUID vs
      // server-generated id). Re-resolve the canonical id by email and reload.
      if (loadedDb.users.length === 0 && cleanEmail) {
        const { data: userByEmail } = await supabase.from('users').select('id').eq('email', cleanEmail).maybeSingle();
        if (userByEmail?.id && userByEmail.id !== cleanUserId) {
          cleanUserId = userByEmail.id;
          loadedDb = await loadUserData(cleanUserId);
        }
      }

      // Check in-memory userDatabases cache if Supabase returned 0 accounts/trades
      const cached = userDatabases.get(cleanUserId) || (cleanEmail ? userDatabases.get(cleanEmail) : null);
      if (cached) {
        if (loadedDb.accounts.length === 0 && cached.accounts?.length > 0) {
          loadedDb.accounts = cached.accounts.filter((a: any) => a.userId === cleanUserId || !a.userId);
        }
        if (loadedDb.trades.length === 0 && cached.trades?.length > 0) {
          loadedDb.trades = cached.trades.filter((t: any) => t.userId === cleanUserId || !t.userId);
        }
        if (loadedDb.riskSettings.length === 0 && cached.riskSettings?.length > 0) {
          loadedDb.riskSettings = cached.riskSettings;
        }
        if (!loadedDb.mt5Deals && cached.mt5Deals?.length > 0) {
          loadedDb.mt5Deals = cached.mt5Deals;
        }
        if (loadedDb.accounts.length > 0) {
          // Carry EA sync status/cursor from the live cache when Supabase copy is stale
          for (const la of loadedDb.accounts) {
            const ca = (cached.accounts || []).find((x: any) => x.id === la.id);
            if (ca && ca.eaStatus) {
              if (ca.eaStatus) la.eaStatus = ca.eaStatus;
              if (ca.eaLastDealId !== undefined) la.eaLastDealId = ca.eaLastDealId;
              if (ca.eaLastSyncTime) la.eaLastSyncTime = ca.eaLastSyncTime;
              if (ca.eaSyncTradeCount !== undefined) la.eaSyncTradeCount = ca.eaSyncTradeCount;
              if (ca.eaConnectedAt) la.eaConnectedAt = ca.eaConnectedAt;
              if (ca.eaTerminalLogin) la.eaTerminalLogin = ca.eaTerminalLogin;
              if (ca.eaTerminalServer) la.eaTerminalServer = ca.eaTerminalServer;
              if (ca.eaToken) la.eaToken = ca.eaToken;
            }
          }
        }

        // Merge transient fields (OTPs) from cache into loaded users
        if (cached.users && cached.users.length > 0 && loadedDb.users.length > 0) {
          const cachedUser = cached.users[0];
          const loadedUser = loadedDb.users[0];
          if (cachedUser.resetOtp) loadedUser.resetOtp = cachedUser.resetOtp;
          if (cachedUser.resetOtpExpiresAt) loadedUser.resetOtpExpiresAt = cachedUser.resetOtpExpiresAt;
          if (cachedUser.emailOtp) loadedUser.emailOtp = cachedUser.emailOtp;
          if (cachedUser.otpExpiresAt) loadedUser.otpExpiresAt = cachedUser.otpExpiresAt;
          if (cachedUser.otpAttempts !== undefined) loadedUser.otpAttempts = cachedUser.otpAttempts;
          if (cachedUser.otpSentAt) loadedUser.otpSentAt = cachedUser.otpSentAt;
        }
      }

      if (cleanUserId) userDatabases.set(cleanUserId, loadedDb);

      return loadedDb;
    } catch (err) {
      console.error('[AxyFx SQL Query Error]', err);
    }
  }

  const cached = userDatabases.get(cleanUserId) || (cleanEmail ? userDatabases.get(cleanEmail) : null);
  if (cached) return cached;

  // Nothing cached yet. Before inventing a blank account, look in the shared
  // local file: a user seeded there (a sub-admin, a demo trader) otherwise got
  // a fresh empty record with role USER, so their role and data never loaded.
  try {
    const shared = loadDatabaseFromFile();
    const seeded = (shared.users || []).find((u: any) =>
      (cleanUserId && u.id === cleanUserId) ||
      (cleanEmail && String(u.email || '').toLowerCase() === cleanEmail));
    if (seeded) {
      const accounts = (shared.accounts || []).filter((a: any) => a.userId === seeded.id);
      const accountIds = new Set(accounts.map((a: any) => a.id));
      const fromFile = {
        users: [seeded],
        accounts,
        trades: (shared.trades || []).filter((t: any) => t.userId === seeded.id || accountIds.has(t.accountId)),
        riskSettings: (shared.riskSettings || []).filter((r: any) => r.userId === seeded.id),
        supportTickets: (shared.supportTickets || []).filter((t: any) => t.userId === seeded.id),
        mt5Deals: [],
        payments: (shared.payments || []).filter((p: any) => p.userId === seeded.id),
      };
      userDatabases.set(seeded.id, fromFile);
      if (seeded.email) userDatabases.set(String(seeded.email).toLowerCase(), fromFile);
      return fromFile;
    }
  } catch (err) {
    console.error('[ensureUserDbLoaded] shared file read failed:', err);
  }

  const fresh = createEmptyUserDb(cleanUserId, cleanEmail, false);
  if (cleanUserId) userDatabases.set(cleanUserId, fresh);
  if (cleanEmail) userDatabases.set(cleanEmail.toLowerCase(), fresh);
  return fresh;
}

async function ensureDbLoaded() {
  if (isLoaded && db && db.users && Array.isArray(db.users)) return db;

  if (useSupabase) {
    try {
      console.log('[AxyFx Journal Server] Loading database from Supabase...');
      const { data, error } = await supabase!
        .from('journal_settings')
        .select('value')
        .eq('key', 'db_json')
        .maybeSingle();

      if (error) {
        console.error('[AxyFx Journal Server] Supabase query error, falling back to local file:', error);
        db = loadDatabaseFromFile();
      } else if (!data) {
        console.log('[AxyFx Journal Server] No data found in Supabase. Seeding initial database...');
        const initial = loadDatabaseFromFile();
        await supabase!.from('journal_settings').insert({ key: 'db_json', value: initial });
        db = initial;
      } else {
        let loaded = data.value;
        if (typeof loaded === 'string') {
          try { loaded = JSON.parse(loaded); } catch (e) { }
        }
        db = loaded;
        console.log('[AxyFx Journal Server] Loaded database from Supabase successfully!');
      }
    } catch (err: any) {
      console.error('[AxyFx Journal Server] Failed to load database from Supabase, falling back:', err);
      db = loadDatabaseFromFile();
    }
  } else {
    db = loadDatabaseFromFile();
  }

  // Validate loaded db structure and self-heal if corrupted or incomplete
  if (!db || typeof db !== 'object' || !Array.isArray(db.users)) {
    console.warn('[AxyFx Journal Server] Loaded database is invalid or lacks users array. Self-healing with default seed data...');
    db = loadDatabaseFromFile();
    if (useSupabase) {
      supabase!
        .from('journal_settings')
        .upsert({ key: 'db_json', value: db }, { onConflict: 'key' })
        .catch((err: any) => console.error('[AxyFx Journal Server] Exception healing database:', err));
    }
  }

  isLoaded = true;
  return db;
}

async function saveDatabase(
  data: any,
  overrideUserId?: string,
  overrideEmail?: string,
  previousAliases?: { userId?: string; email?: string }
): Promise<{ accountsError?: any }> {
  if (!data) return {};
  const usersToSync = Array.isArray(data.users) ? data.users : [];
  if (usersToSync.length === 0) return {};

  const targetUser = usersToSync[0];
  const uid = targetUser.id;
  const email = targetUser.email;
  if (!uid) return {};

  if (uid) userDatabases.set(uid, data);
  if (email) userDatabases.set(email.toLowerCase(), data);
  if (overrideUserId) userDatabases.set(overrideUserId, data);
  if (overrideEmail) userDatabases.set(overrideEmail.toLowerCase(), data);

  if (previousAliases?.email && previousAliases.email.toLowerCase() !== email?.toLowerCase()) {
    userDatabases.delete(previousAliases.email.toLowerCase());
  }

  if (!useSupabase) return {};

  try {
    // Upsert users
    if (data.users && data.users.length > 0) {
      const validUserCols = new Set([
        'id', 'email', 'name', 'password', 'experience', 'trading_style',
        'main_markets', 'is_pro', 'is_email_verified', 'created_at', 'updated_at',
        'email_otp', 'otp_expires_at', 'otp_attempts', 'otp_sent_at',
        'reset_otp', 'reset_otp_expires_at'
      ]);
      const sanitizedUsers = toSnake(data.users).map((u: any) => {
        const clean: any = {};
        for (const key of Object.keys(u)) {
          if (validUserCols.has(key)) {
            clean[key] = u[key];
          }
        }
        return clean;
      });
      const { error: err1 } = await supabase.from('users').upsert(sanitizedUsers, { onConflict: 'id' });
      if (err1) console.error('[saveDatabase] users upsert error:', err1);
    }
    // Upsert accounts
    if (data.accounts && data.accounts.length > 0) {
      const validAccCols = new Set([
        'id', 'user_id', 'name', 'broker', 'platform', 'account_type',
        'institution_type',
        'currency', 'starting_balance', 'current_balance', 'equity', 'status',
        'is_mt5_sync',
        'ea_token', 'ea_status', 'ea_last_deal_id', 'ea_last_sync_time',
        'ea_sync_trade_count', 'ea_connected_at', 'ea_terminal_login',
        'ea_terminal_server', 'created_at', 'updated_at',
        'mt5_login', 'mt5_server', 'mt5_build', 'sync_method',
        'connection_status', 'last_heartbeat_at', 'backfill_start', 'backfill_end',
        'investor_password_enc', 'password_enc_nonce', 'password_kms_key_id',
        'disconnected_at'
      ]);
      const accs = toSnake(data.accounts).map((a: any) => {
        const clean: any = {};
        for (const key of Object.keys(a)) {
          if (validAccCols.has(key)) {
            clean[key] = a[key];
          }
        }
        clean.user_id = clean.user_id || uid;
        return clean;
      });
      const { error: err2 } = await supabase.from('trading_accounts').upsert(accs, { onConflict: 'id' });
      if (err2) {
        console.error('[saveDatabase] trading_accounts upsert error:', err2);
        return { accountsError: err2 };
      }
    }
    // Upsert trades
    if (data.trades && data.trades.length > 0) {
      const trds = toSnake(data.trades).map((t: any) => ({ ...t, user_id: t.user_id || uid }));
      console.log('--- UPSERTING TRADES ---', JSON.stringify(trds[trds.length - 1], null, 2));
      const { error: err3 } = await supabase.from('trades').upsert(trds, { onConflict: 'id' });
      console.log('--- UPSERT ERROR ---', err3);
      if (err3) console.error('[saveDatabase] trades upsert error:', err3);
    }
    // Upsert risk settings
    if (data.riskSettings && data.riskSettings.length > 0) {
      const rs = toSnake(data.riskSettings).map((r: any) => ({ ...r, user_id: r.user_id || uid }));
      const { error: err4 } = await supabase.from('risk_settings').upsert(rs, { onConflict: 'id' });
      if (err4) console.error('[saveDatabase] risk_settings upsert error:', err4);
    }
    // Upsert support tickets
    if (data.supportTickets && data.supportTickets.length > 0) {
      const tix = toSnake(data.supportTickets).map((t: any) => ({ ...t, user_id: t.user_id || uid }));
      await supabase.from('support_tickets').upsert(tix, { onConflict: 'id' });
    }
    // Upsert MT5 deals (raw deal stream used to recompute synced trades)
    if (data.mt5Deals && data.mt5Deals.length > 0) {
      const deals = toSnake(data.mt5Deals).map((d: any) => ({
        id: String(d.ticket),
        account_id: d.account_id || d.accountId,
        position_id: d.position_id ?? d.positionId ?? 0,
        deal: d,
        user_id: d.user_id || uid
      }));
      await supabase.from('mt5_deals').upsert(deals, { onConflict: 'id' });
    }
    // Upsert MT5 deals v2 (account-scoped deal stream, PK = (account_id, ticket))
    if (data.mt5DealsV2 && data.mt5DealsV2.length > 0) {
      const dealsV2 = data.mt5DealsV2.map((d: any) => ({
        account_id: d.accountId,
        user_id: d.userId || uid,
        ticket: Number(d.ticket),
        position_id: d.deal?.positionId ?? d.deal?.position_id ?? 0,
        deal: d.deal
      }));
      const { error: errV2 } = await supabase.from('mt5_deals_v2').upsert(dealsV2, { onConflict: 'account_id,ticket' });
      if (errV2) console.error('[saveDatabase] mt5_deals_v2 upsert error:', errV2);
    }
    // Insert account snapshots (append-only time series)
    if (data.mt5Snapshots && data.mt5Snapshots.length > 0) {
      const snaps = data.mt5Snapshots.map((s: any) => ({
        account_id: s.accountId,
        user_id: s.userId || uid,
        balance: s.balance,
        equity: s.equity,
        margin: s.margin,
        margin_free: s.marginFree,
        margin_level: s.marginLevel,
        currency: s.currency,
        leverage: s.leverage,
        captured_at: s.capturedAt
      }));
      const { error: snapErr } = await supabase.from('mt5_account_snapshots').insert(snaps);
      if (snapErr) console.error('[saveDatabase] mt5_account_snapshots insert error:', snapErr);
    }
    // Open positions: replace-on-snapshot (delete this account's rows, then insert)
    if (data.mt5OpenPositions) {
      const posAccountIds = [...new Set(data.mt5OpenPositions.map((p: any) => p.accountId))];
      for (const aid of posAccountIds) {
        await supabase.from('mt5_open_positions').delete().eq('account_id', aid);
      }
      if (data.mt5OpenPositions.length > 0) {
        const posRows = data.mt5OpenPositions.map((p: any) => ({
          account_id: p.accountId,
          user_id: p.userId || uid,
          position_id: p.positionId,
          ticket: p.ticket,
          symbol: p.symbol,
          side: p.side,
          volume: p.volume,
          open_time: p.openTime,
          open_price: p.openPrice,
          sl: p.sl,
          tp: p.tp,
          commission: p.commission,
          swap: p.swap,
          profit: p.profit,
          current_price: p.currentPrice,
          updated_at: p.updatedAt
        }));
        const { error: posErr } = await supabase.from('mt5_open_positions').insert(posRows);
        if (posErr) console.error('[saveDatabase] mt5_open_positions insert error:', posErr);
      }
    }
    // Pending orders: replace-on-snapshot (delete this account's rows, then insert)
    if (data.mt5PendingOrders) {
      const orderAccountIds = [...new Set(data.mt5PendingOrders.map((o: any) => o.accountId))];
      for (const aid of orderAccountIds) {
        await supabase.from('mt5_pending_orders').delete().eq('account_id', aid);
      }
      if (data.mt5PendingOrders.length > 0) {
        const orderRows = data.mt5PendingOrders.map((o: any) => ({
          account_id: o.accountId,
          user_id: o.userId || uid,
          order_id: o.orderId,
          symbol: o.symbol,
          type: o.type,
          volume: o.volume,
          open_price: o.openPrice,
          sl: o.sl,
          tp: o.tp,
          magic: o.magic,
          state: o.state,
          updated_at: o.updatedAt
        }));
        const { error: orderErr } = await supabase.from('mt5_pending_orders').insert(orderRows);
        if (orderErr) console.error('[saveDatabase] mt5_pending_orders insert error:', orderErr);
      }
    }
    // Money flows: upsert on (account_id, ticket)
    if (data.mt5MoneyFlows && data.mt5MoneyFlows.length > 0) {
      const flowRows = data.mt5MoneyFlows.map((f: any) => ({
        account_id: f.accountId,
        user_id: f.userId || uid,
        ticket: f.ticket,
        flow_type: f.flowType,
        amount: f.amount,
        currency: f.currency,
        time: f.time
      }));
      const { error: flowErr } = await supabase.from('mt5_money_flows').upsert(flowRows, { onConflict: 'account_id,ticket' });
      if (flowErr) console.error('[saveDatabase] mt5_money_flows upsert error:', flowErr);
    }
    // Sync logs + connection errors: insert (append-only)
    if (data.mt5SyncLogs && data.mt5SyncLogs.length > 0) {
      const logRows = data.mt5SyncLogs.map((l: any) => ({
        account_id: l.accountId,
        user_id: l.userId || uid,
        request_id: l.requestId || null,
        event: l.event,
        level: l.level,
        message: l.message
      }));
      const { error: logErr } = await supabase.from('mt5_sync_logs').insert(logRows);
      if (logErr) console.error('[saveDatabase] mt5_sync_logs insert error:', logErr);
    }
    if (data.mt5ConnectionErrors && data.mt5ConnectionErrors.length > 0) {
      const errRows = data.mt5ConnectionErrors.map((e: any) => ({
        account_id: e.accountId,
        user_id: e.userId || uid,
        error_code: e.errorCode,
        error_message: e.errorMessage,
        occurred_at: e.occurredAt,
        resolved_at: e.resolvedAt
      }));
      const { error: connErr } = await supabase.from('mt5_connection_errors').insert(errRows);
      if (connErr) console.error('[saveDatabase] mt5_connection_errors insert error:', connErr);
    }
    // Cloud/VPS connect jobs (upsert so worker status updates persist)
    if (data.mt5ConnectJobs && data.mt5ConnectJobs.length > 0) {
      const jobRows = data.mt5ConnectJobs.map((j: any) => ({
        id: j.id,
        account_id: j.accountId,
        user_id: j.userId || uid,
        action: j.action,
        payload: j.payload || null,
        status: j.status || 'PENDING',
        attempts: j.attempts || 0,
        worker_id: j.workerId || null,
        last_error: j.lastError || null,
        claimed_at: j.claimedAt || null,
        updated_at: j.updatedAt || j.createdAt
      }));
      const { error: jobErr } = await supabase.from('mt5_connect_jobs').upsert(jobRows, { onConflict: 'id' });
      if (jobErr) console.error('[saveDatabase] mt5_connect_jobs upsert error:', jobErr);
    }
  } catch (err) {
    console.error('[AxyFx SQL Save Error]', err);
  }
}

// Auto-create a default portfolio account for new signups if the user has no accounts
async function ensureDefaultPortfolioAccount(
  db: any,
  userId: string,
  email?: string
): Promise<TradingAccount | null> {
  try {
    if (!db || !userId) return null;
    if (!Array.isArray(db.accounts)) db.accounts = [];
    if (!Array.isArray(db.riskSettings)) db.riskSettings = [];

    const existing = db.accounts.filter((acc: any) => acc.userId === userId || !acc.userId);
    if (existing.length > 0) return null;

    const newAcc: TradingAccount = {
      id: `acc_${crypto.randomUUID()}`,
      userId,
      name: 'Portfolio Account',
      broker: 'MT5 Demo Broker',
      platform: 'MT5',
      accountType: 'Demo',
      currency: 'USD',
      startingBalance: 10000,
      currentBalance: 10000,
      equity: 10000,
      status: 'Active',
      eaToken: generateEaToken(),
      eaStatus: 'Not Connected'
    };
    db.accounts.push(newAcc);

    // Add a starter risk setting for the default account
    const newRisk: RiskSettings = {
      id: `r_${Date.now()}`,
      accountId: newAcc.id,
      riskPerTradeLimit: 2.0,
      dailyLossLimit: 500,
      weeklyLossLimit: 1500,
      maxDrawdownLimit: 10.0,
      disciplineEnabled: true,
      maxTradesPerDay: 5
    };
    db.riskSettings.push(newRisk);

    await saveDatabase(db, userId, email);
    console.log(`[Auth] Auto-created default portfolio account ${newAcc.id} for user ${userId}`);
    return newAcc;
  } catch (err: any) {
    console.error('[Auth] Failed to auto-create default portfolio account:', err?.message || err);
    return null;
  }
}

async function removeUserDatabaseAliases(userId?: string, email?: string) {
  void userId;
  void email;
}

// Attach the submitting user's name to ticket rows (joins the users table by user_id)
async function attachTicketUserNames(tickets: any[]): Promise<any[]> {
  if (!useSupabase || !Array.isArray(tickets) || tickets.length === 0) return tickets;
  try {
    const ids = Array.from(new Set(tickets.map((t: any) => t.userId || t.user_id).filter(Boolean)));
    if (ids.length === 0) return tickets;
    const { data: users } = await supabase.from('users').select('id, name, email').in('id', ids);
    const nameMap = Object.fromEntries((users || []).map((u: any) => [u.id, u]));
    return tickets.map((t: any) => {
      const u = nameMap[t.userId || t.user_id];
      return {
        ...toCamel(t),
        userName: u?.name || '',
        userEmail: t.userEmail || t.user_email || u?.email || ''
      };
    });
  } catch (e) {
    console.error('[Tickets] Failed to attach user names:', e);
    return tickets.map((t: any) => toCamel(t));
  }
}

// Aggregate all support tickets from the in-memory per-user databases (local dev fallback)
function collectAllInMemoryTickets(): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  userDatabases.forEach((d: any) => {
    (d.supportTickets || []).forEach((t: any) => {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        out.push(t);
      }
    });
  });
  return out;
}

const app = express();
// Honour the port the host assigns. Render, Railway, Fly and Heroku all inject
// PORT and expect the app to bind it; hardcoding 3000 meant the app would bind
// the wrong port there and the platform would report it as unhealthy. It also
// made it impossible to run a second copy alongside one already on 3000.
const PORT = Number(process.env.PORT) || 3000;

async function verifyTurnstile(token: string): Promise<boolean> {
  const configured = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!configured) {
    // '1x0000...AA' is Cloudflare's always-pass test secret. Falling back to it
    // in production silently disables bot protection, so fail closed instead.
    if (IS_PRODUCTION_LIKE) {
      console.error('[Turnstile] TURNSTILE_SECRET_KEY is not set — rejecting the request.');
      return false;
    }
    console.warn('[Turnstile] No secret configured — allowing the request (development only).');
    return true;
  }
  const secretKey = configured;
  if (!token) return false;
  try {
    const params = new URLSearchParams();
    params.append('secret', secretKey);
    params.append('response', token);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: params
    });
    const data = await res.json();
    return data.success;
  } catch (err) {
    console.error('Turnstile verification failed:', err);
    return false;
  }
}

// Rate limiter for auth endpoints (prevents brute force / OTP spam)
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Keyed on email + IP, not IP alone. An office, campus, café or any mobile
  // carrier puts many people behind one address, so an IP-only counter lets the
  // first person to fumble a password lock out everyone else on that network
  // for fifteen minutes. The composite key still stops brute force: a single
  // account is capped at 20 tries from one address, and the per-account OTP
  // counter below caps guesses regardless of where they come from.
  keyGenerator: (req: any) => {
    const ip = ipKeyGenerator(req.ip);
    const email = String(req.body?.email || '').toLowerCase().trim();
    return email ? `auth_${sha256Hex(email).slice(0, 24)}_${ip}` : `auth_ip_${ip}`;
  },
});

// Backstop for the per-email limiter above. On its own, a composite key hands an
// attacker a fresh 20-try budget for every address they invent, so one IP could
// walk a password list across thousands of accounts. This cap is coarse enough
// that a shared network never reaches it in normal use — 200 auth calls in
// fifteen minutes is far more than a floor of traders logging in — but it ends
// enumeration from a single source.
const authIpBackstopLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests from this network. Please wait a few minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => `auth_net_${ipKeyGenerator(req.ip)}`,
});

// Rate limiter for OTP issue/verify. Tighter than the generic auth limiter: a
// 6-digit code is only 1,000,000 combinations, so unlimited guesses are fatal.
const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many verification attempts. Please wait a few minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    // ipKeyGenerator normalises IPv6 to a /56 subnet so a single client cannot
    // rotate through addresses in its own prefix to reset the counter.
    return email ? `otp_${sha256Hex(email).slice(0, 24)}` : `otp_ip_${ipKeyGenerator(req.ip)}`;
  },
});

// Per-account OTP guess counter, on top of the IP/email rate limiter above.
// After MAX_OTP_ATTEMPTS wrong codes the OTP is burned and must be re-sent.
const MAX_OTP_ATTEMPTS = 5;
const otpAttemptCounts = new Map<string, number>();
const otpAttemptKey = (email: string) => `otp_attempts_${email.toLowerCase().trim()}`;
function registerFailedOtp(email: string): number {
  const key = otpAttemptKey(email);
  const next = (otpAttemptCounts.get(key) || 0) + 1;
  otpAttemptCounts.set(key, next);
  return next;
}
function clearFailedOtp(email: string) {
  otpAttemptCounts.delete(otpAttemptKey(email));
}
function otpAttemptsExhausted(email: string): boolean {
  return (otpAttemptCounts.get(otpAttemptKey(email)) || 0) >= MAX_OTP_ATTEMPTS;
}

// Rate limiter for EA machine-to-machine endpoints.
// Per account: 10 req / 5s (the EA cadence is 30s so this is generous);
// per token: 60 req / 60s; global EA IP cap 300 req / min.
const eaAccountLimiter = rateLimit({
  windowMs: 5 * 1000,
  max: 10,
  message: { error: 'Too many requests from this account. Retry shortly.', code: 'EA_RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => {
    const accountId = String(req.headers['x-ea-account-id'] || req.body?.accountId || 'unknown');
    return `ea_acc_${accountId}`;
  }
});
const eaTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests from this EA token. Retry shortly.', code: 'EA_RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => {
    const auth = (req.headers['authorization'] || '').toString().trim();
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (req.body?.token || 'unknown');
    return `ea_tok_${sha256Hex(token).slice(0, 16)}`;
  }
});
const eaIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Too many requests from this IP. Retry shortly.', code: 'EA_RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
});
const eaProtection = [eaAccountLimiter, eaTokenLimiter, eaIpLimiter];

// Middleware
app.use(cookieParser());
app.use(express.json({
  limit: '15mb',
  // Capture the raw request body for HMAC signature verification
  verify: (req: any, _res: any, buf: Buffer) => {
    req.rawBody = buf.toString('utf8');
  }
}));

// CORS middleware — allow browser requests from authorized origins
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://fxjournalpro.com',
    'https://www.fxjournalpro.com',
    'http://localhost:3000',
    'http://localhost:5173'
  ];
  const origin = req.headers['origin'] as string;
  const isAllowedOrigin = (orig: string) => {
    if (!orig) return true;
    if (allowedOrigins.includes(orig)) return true;
    if (orig.endsWith('.netlify.app')) return true;
    if (orig.endsWith('.vercel.app')) return true;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(orig)) return true;
    return false;
  };

  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://fxjournalpro.com');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-User-Id, X-Auth-Email, X-Session-Token');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Disable browser caching on all API routes so fresh data is always returned
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.removeHeader('ETag');
  next();
});

// Routes that read `currentUser` but never touch `req.userDb`. Listed
// explicitly rather than pattern-matched: adding a route here when it does
// use userDb would hand it a null, so the list stays conservative.
const IDENTITY_ONLY_ROUTES = new Set([
  '/api/auth/me',
  '/api/admin/check',
  '/api/announcements',
  '/api/fx-news',
  '/api/economic-calendar',
  '/api/chart/ohlc',
  '/api/plan/entitlements',
]);

// Global middleware to load database and set local user context
app.use(async (req, res, next) => {
  try {
    // 1. Identity from signed session cookie
    const session = verifySessionValue(req.cookies?.[SESSION_COOKIE]);
    let authUserId = session?.userId?.trim();
    let authEmail = session?.email?.trim();

    // 2. Identity from Authorization Bearer token or X-Session-Token
    if (!authUserId && !authEmail) {
      const authHeader = (req.headers['authorization'] || '').toString().trim();
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : (req.headers['x-session-token'] as string || '').trim();

      if (token) {
        const bearerSession = verifySessionValue(token);
        if (bearerSession) {
          authUserId = bearerSession.userId?.trim();
          authEmail = bearerSession.email?.trim();
        } else if (useSupabase) {
          try {
            const { data: sbUser } = await supabase.auth.getUser(token);
            if (sbUser?.user) {
              authUserId = sbUser.user.id;
              authEmail = sbUser.user.email;
            }
          } catch (_) {}
        }
      }
    }

    // 3. There is deliberately no third path.
    //
    // This used to accept identity from x-auth-email / x-auth-user-id whenever
    // the cookie and the bearer token were both absent, with no signature and
    // no other proof:
    //
    //   curl https://<site>/api/auth/me -H 'x-auth-email: someone@example.com'
    //
    // answered with that account's row. For the routes that are not in
    // IDENTITY_ONLY_ROUTES it went further and loaded their whole database, so
    // their trades could be read and written too. A complete authentication
    // bypass, in production as well — the comment claimed it was for "Netlify
    // Functions / cross-origin deployments", which is exactly where it was
    // most reachable.
    //
    // It also explains an intermittent security test: A2 only failed when the
    // victim's scoped database happened to be warm in the in-memory cache, so
    // the same attack passed or failed run to run.
    //
    // Nothing needed it. The frontend sends these headers, but it sends them
    // on same-origin fetches that carry the signed cookie anyway, and the EA
    // authenticates with its own token and HMAC. Identity now comes only from
    // something the server signed.

    if (authUserId || authEmail) {
      const email = authEmail ? authEmail.toLowerCase() : '';
      const userId = authUserId || (email ? `user_${email}` : '');

      // ensureUserDbLoaded pulls users + accounts + trades + risk settings +
      // tickets + deals — six queries, and the whole trade history — on EVERY
      // request. Routes that only need to know WHO is calling get a single
      // row instead; the rest still load the full set.
      let db: any = null;
      let dbUser: any = null;

      if (useSupabase && IDENTITY_ONLY_ROUTES.has(req.path)) {
        const query = authUserId
          ? supabase.from('users').select('*').eq('id', authUserId).maybeSingle()
          : supabase.from('users').select('*').eq('email', email).maybeSingle();
        const { data } = await query;
        dbUser = data ? toCamel(data) : null;
      } else {
        db = await ensureUserDbLoaded(userId, email);
        // Use the user already resolved by ensureUserDbLoaded (by email lookup)
        // Never mutate the canonical user ID with a temporary session ID
        dbUser = db.users[0] || null;
      }

      // Security: accounts that explicitly have NOT completed email/OTP verification
      // are treated as unauthenticated. This blocks session-restore (and every
      // protected API route) until OTP verification is successfully completed,
      // even if the page is refreshed while the OTP window is open.
      const unverified = dbUser
        ? dbUser.isEmailVerified === false || dbUser.is_email_verified === false
        : false;
      // A blocked account is treated as signed out on every route. Without
      // this, admin "block user" set a flag that nothing ever read.
      const blocked = String(dbUser?.status || '').toLowerCase() === 'blocked';

      // Pro expires by date, not by flag. Without this an `is_pro` row whose
      // pro_until has passed keeps premium access until some webhook happens
      // to fire — which never happens for a lapsed or cancelled plan.
      if (dbUser) {
        const proUntilRaw = dbUser.proUntil ?? dbUser.pro_until ?? null;
        if (proUntilRaw) {
          const stillPro = new Date(proUntilRaw).getTime() > Date.now();
          dbUser.isPro = stillPro;
          dbUser.is_pro = stillPro;
        }
      }
      if (dbUser && (unverified || blocked)) {
        (req as any).userDb = null;
        (req as any).currentUser = null;
      } else {
        (req as any).userDb = db;
        (req as any).currentUser = dbUser;
      }
    } else {
      (req as any).currentUser = null;
      (req as any).userDb = null;
    }

    next();
  } catch (err) {
    console.error('[AxyFx Journal Server] Middleware execution error:', err);
    next(err);
  }
});

app.get('/api/debug/env', async (req, res) => {
  // Diagnostics only — this reports infrastructure details and raw provider
  // errors, so it must never be reachable on a public production deployment.
  if (IS_PRODUCTION_LIKE) {
    return res.status(404).json({ error: 'Not found' });
  }
  let sbError = null;
  let sbData = null;
  if (useSupabase) {
    const { data, error } = await supabase.from('users').select('id').limit(1);
    sbError = error;
    sbData = data;
  }
  res.json({
    useSupabase,
    hasSupabaseUrl: !!process.env.SUPABASE_URL || !!process.env.VITE_SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_KEY || !!process.env.VITE_SUPABASE_KEY,
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    sbError,
    sbData
  });
});

// Receives front-end crashes so a blank screen in signup shows up in the
// server log instead of being invisible. Rate limited because it is public
// and unauthenticated by necessity — the user may be signed out when it fires.
const clientErrorLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false },
});

app.post('/api/client-error', clientErrorLimiter, (req, res) => {
  const { kind, message, stack, url, userAgent, at } = req.body || {};
  console.error('[client-error]', JSON.stringify({
    kind: String(kind || 'unknown').slice(0, 40),
    message: String(message || '').slice(0, 500),
    url: String(url || '').slice(0, 200),
    userAgent: String(userAgent || '').slice(0, 200),
    at: String(at || new Date().toISOString()).slice(0, 40),
    stack: String(stack || '').slice(0, 2000),
  }));
  res.status(204).end();
});

app.get('/api/auth/me', async (req, res) => {
  let currentUser = (req as any).currentUser;
  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  // Record this visit as the user's last login/activity, throttled so the
  // timestamp refreshes on each page load without writing on every request.
  try {
    const nowIso = new Date().toISOString();
    const prev = currentUser.lastLogin || currentUser.last_login;
    const shouldUpdate = !prev || (Date.now() - new Date(prev).getTime()) >= 15 * 60 * 1000;
    if (shouldUpdate) {
      currentUser.lastLogin = nowIso;
      currentUser.last_login = nowIso;
      if (useSupabase) {
        try {
          await supabase.from('users').update({ last_login: nowIso }).eq('id', currentUser.id);
        } catch (e) {
          console.warn('[auth/me] last_login update skipped:', (e as any)?.message || e);
        }
      } else {
        const db = (req as any).userDb;
        if (db) await saveDatabase(db);
      }
    }
  } catch (err) {
    console.warn('[auth/me] last_login update failed:', err);
  }
  return res.json({ user: sanitizeUser(currentUser) });
});

app.post('/api/auth/logout', (req, res) => {
  const session = verifySessionValue(req.cookies?.[SESSION_COOKIE]);
  if (session) {
    revokeSessionsFor(session.userId);
    revokeSessionsFor(session.email);
  }
  clearSession(res);
  res.json({ message: 'Logged out successfully' });
});

app.post('/api/auth/register', authIpBackstopLimiter, authRateLimiter, async (req, res) => {
  try {
    const { email, name, password, id, userId, turnstileToken, provider, supabaseAccessToken, referralCode } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // SSO path. Previously the client simply claimed `isEmailVerified: true` and
    // the server believed it — which let anyone overwrite any account's password.
    // Now the caller must present the Supabase access token, and the email on
    // that token is the only identity we trust.
    let ssoUser: { id: string; email: string } | null = null;
    if (supabaseAccessToken) {
      if (!useSupabase) {
        return res.status(503).json({ error: 'Single sign-on is not configured on this server.' });
      }
      const { data, error } = await supabase.auth.getUser(String(supabaseAccessToken));
      const tokenEmail = data?.user?.email?.toLowerCase().trim();
      if (error || !tokenEmail) {
        return res.status(401).json({ error: 'Invalid or expired sign-in session. Please sign in again.' });
      }
      if (tokenEmail !== normalizedEmail) {
        return res.status(403).json({ error: 'Sign-in session does not match the requested account.' });
      }
      ssoUser = { id: data.user.id, email: tokenEmail };
    }

    const isSso = !!ssoUser;
    const authUserId = isSso ? ssoUser!.id : '';

    // Skip Turnstile only for the verified SSO path — the identity provider
    // already ran its own bot checks and we verified the token above.
    if (!isSso) {
      const isHuman = await verifyTurnstile(turnstileToken);
      if (!isHuman) {
        return res.status(403).json({ error: 'Captcha verification failed. Please try again.' });
      }
      if (!password || String(password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
    }

    // Look up any existing account for this email. This has to work on BOTH
    // storage paths: when it only ran for Supabase, a local/in-memory
    // deployment would happily overwrite an existing account's password.
    let existingUserRow: any = null;
    if (useSupabase) {
      const { data } = await supabase.from('users').select('*').eq('email', normalizedEmail).maybeSingle();
      existingUserRow = data;
    } else {
      const memDb = await ensureUserDbLoaded('', normalizedEmail);
      const memUser = (memDb.users || []).find((u: any) => u.email?.toLowerCase() === normalizedEmail);
      if (memUser) {
        existingUserRow = {
          ...memUser,
          is_email_verified: memUser.isEmailVerified ?? memUser.is_email_verified ?? false,
        };
      }
    }

    if (existingUserRow && existingUserRow.is_email_verified && !isSso) {
      return res.status(400).json({ error: 'An account with this email already exists. Please log in.' });
    }

    const otp = generateOtp();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    if (isSso) {
      // Verified SSO path. The password column is carried over untouched — a
      // federated sign-in must never be able to set or replace it.
      const uid = existingUserRow?.id || authUserId || `user_${Date.now()}`;
      const userRecord = {
        id: uid,
        email: normalizedEmail,
        name: name || existingUserRow?.name || normalizedEmail.split('@')[0],
        password: existingUserRow?.password || '',
        experience: existingUserRow?.experience || 'Intermediate',
        trading_style: existingUserRow?.trading_style || 'Day Trading',
        main_markets: existingUserRow?.main_markets || ['Forex', 'Gold'],
        onboarding_completed: existingUserRow?.onboarding_completed || false,
        is_pro: existingUserRow?.is_pro || false,
        is_email_verified: true,
        auth_provider: provider || 'google',
        last_login: new Date().toISOString()
      };
      if (useSupabase) {
        const { error: upsertErr } = await supabase.from('users').upsert(userRecord, { onConflict: 'id' });
        if (upsertErr) {
          // Column may not exist (e.g. auth_provider/last_login migration not applied).
          // Retry with only the base columns guaranteed by supabase_schema.sql.
          console.warn('[Register SSO] Full upsert failed, retrying with base columns:', upsertErr.message);
          const baseRecord = {
            id: uid,
            email: normalizedEmail,
            name: name || existingUserRow?.name || normalizedEmail.split('@')[0],
            password: existingUserRow?.password || '',
            experience: existingUserRow?.experience || 'Intermediate',
            trading_style: existingUserRow?.trading_style || 'Day Trading',
            main_markets: existingUserRow?.main_markets || ['Forex', 'Gold'],
            onboarding_completed: existingUserRow?.onboarding_completed || false,
            is_pro: existingUserRow?.is_pro || false,
            is_email_verified: true
          };
          const { error: baseErr } = await supabase.from('users').upsert(baseRecord, { onConflict: 'id' });
          if (baseErr) {
            console.error('[Register SSO] Base upsert failed:', baseErr);
            return res.status(500).json({ error: 'Failed to sync account. Please try again.' });
          }
        }
      } else {
        // Fallback: persist the SSO user in-memory so later requests resolve it
        let db = await ensureUserDbLoaded(uid, normalizedEmail);
        let user = db.users.find((u: any) => u.email.toLowerCase() === normalizedEmail);
        if (!user) {
          user = { ...toCamel(userRecord) };
          db.users.push(user);
        } else {
          Object.assign(user, toCamel(userRecord));
        }
        userDatabases.set(normalizedEmail, db);
        userDatabases.set(uid, db);
      }
      // Auto-create a default portfolio account for new signups
      try {
        const ssoDb = await ensureUserDbLoaded(uid, normalizedEmail);
        await ensureDefaultPortfolioAccount(ssoDb, uid, normalizedEmail);
      } catch (e) {
        console.error('[Register SSO] Failed to auto-create default portfolio account:', e);
      }
      // Link to the referring partner, if they arrived through a link. Runs
      // after the row exists so there is something to attach to, and never
      // blocks the signup if it fails.
      if (referralCode) await linkReferral(req, uid, String(referralCode));
      const camelUser = toCamel(userRecord);
      const sessionToken = issueSession(res, { id: uid, email: normalizedEmail });
      return res.json({ message: 'Registration successful.', user: sanitizeUser(camelUser), requiresOtp: false, sessionToken });
    }

    // Standard registration path — generate OTP and save to Supabase
    const uid = existingUserRow?.id || authUserId || `user_${Date.now()}`;
    const hashedPassword = password ? await bcrypt.hash(password, 10) : (existingUserRow?.password || '');

    const userRecord = {
      id: uid,
      email: normalizedEmail,
      name: name || existingUserRow?.name || normalizedEmail.split('@')[0],
      password: hashedPassword,
      experience: existingUserRow?.experience || 'Intermediate',
      trading_style: existingUserRow?.trading_style || 'Day Trading',
      main_markets: existingUserRow?.main_markets || ['Forex', 'Gold'],
      onboarding_completed: existingUserRow?.onboarding_completed || false,
      is_pro: existingUserRow?.is_pro || false,
      is_email_verified: false,
      email_otp: otp,
      otp_expires_at: otpExpiresAt,
      otp_attempts: 0,
      otp_sent_at: new Date().toISOString()
    };

    if (useSupabase) {
      const { error: upsertErr } = await supabase.from('users').upsert(userRecord, { onConflict: 'id' });
      if (upsertErr) {
        // Column may not exist (e.g. auth_provider/last_login migration not applied).
        // Retry with only the base columns guaranteed by the users table.
        console.warn('[Register] Full upsert failed, retrying with base columns:', upsertErr.message);
        const baseRecord = {
          id: uid,
          email: normalizedEmail,
          name: name || existingUserRow?.name || normalizedEmail.split('@')[0],
          password: hashedPassword,
          experience: existingUserRow?.experience || 'Intermediate',
          trading_style: existingUserRow?.trading_style || 'Day Trading',
          main_markets: existingUserRow?.main_markets || ['Forex', 'Gold'],
          onboarding_completed: existingUserRow?.onboarding_completed || false,
          is_pro: existingUserRow?.is_pro || false,
          is_email_verified: false
        };
        const { error: baseErr } = await supabase.from('users').upsert(baseRecord, { onConflict: 'id' });
        if (baseErr) {
          console.error('[Register] Base upsert failed:', baseErr);
          return res.status(500).json({ error: 'Failed to create account. Please try again.' });
        }
        // Persist OTP fields via a targeted update (only columns that exist)
        try {
          await supabase.from('users').update({
            email_otp: otp,
            otp_expires_at: otpExpiresAt,
            otp_attempts: 0,
            otp_sent_at: new Date().toISOString()
          }).eq('id', uid);
        } catch (otpErr) {
          console.warn('[Register] OTP field update failed (non-fatal):', otpErr);
        }
      }
    } else {
      // Fallback: in-memory
      let db = await ensureUserDbLoaded(uid, normalizedEmail);
      let user = db.users.find((u: any) => u.email.toLowerCase() === normalizedEmail);
      if (!user) {
        user = { ...toCamel(userRecord) };
        db.users.push(user);
      } else {
        Object.assign(user, toCamel(userRecord));
      }
      userDatabases.set(normalizedEmail, db);
      userDatabases.set(uid, db);
    }

    // Link to the referring partner now, while we still have the code. The
    // account is not verified yet, but the row exists and the attribution
    // belongs to the signup, not to whether they finish the OTP step.
    if (referralCode) await linkReferral(req, uid, String(referralCode));

    const emailResult = await sendOtpEmail(normalizedEmail, otp);
    const camelUser = toCamel(userRecord);

    res.json({
      message: emailResult.success ? 'Registration successful. OTP sent to your email.' : 'Registration successful. Please enter your 6-digit verification code.',
      user: sanitizeUser(camelUser),
      requiresOtp: true,
      emailSent: emailResult.success,
      ...(canExposeOtp() ? { devOtp: emailResult.otp } : {})
    });
  } catch (err: any) {
    console.error('[AxyFx Journal Server] Register endpoint error:', err);
    res.status(500).json({ error: `Server register error: ${err?.message || err}` });
  }
});

app.post('/api/auth/login', authIpBackstopLimiter, authRateLimiter, async (req, res) => {
  try {
    const { email, password, id, userId, turnstileToken } = req.body;

    // Skip Turnstile in development mode (NODE_ENV not set or 'development')
    const isDev = IS_DEV;
    if (!isDev) {
      const isHuman = await verifyTurnstile(turnstileToken);
      if (!isHuman) {
        return res.status(403).json({ error: 'Captcha verification failed. Please try again.' });
      }
    }

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    // The account is resolved from the submitted email only. An id supplied by
    // the caller must never be able to select which account gets signed into.
    let db = await ensureUserDbLoaded('', normalizedEmail);
    let user = db.users.find((u: any) => u.email.toLowerCase() === normalizedEmail);

    // In development, auto-create user if missing
    if (!user && isDev) {
      const uid = `user_dev_${Date.now()}`;
      const hashedPassword = password ? await bcrypt.hash(password, 10) : '';
      const devUser = {
        id: uid,
        email: normalizedEmail,
        name: normalizedEmail.split('@')[0],
        password: hashedPassword,
        experience: 'Intermediate',
        trading_style: 'Day Trading',
        main_markets: ['Forex', 'Gold'],
        onboarding_completed: false,
        is_pro: false,
        is_email_verified: true,
        auth_provider: 'email',
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString()
      };
      db.users.push(devUser);
      await saveDatabase(db);
      console.log(`[Dev] Auto-created user: ${normalizedEmail}`);
      // Auto-create a default portfolio account for the dev user
      await ensureDefaultPortfolioAccount(db, uid, normalizedEmail);

      const sessionToken = issueSession(res, devUser);

      return res.json({ message: 'Login successful', user: sanitizeUser(devUser), sessionToken });
    }

    if (!user) {
      return res.status(404).json({ error: 'No account found with this email. Please register first.' });
    }

    if (!user.password) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required to login.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    if (String(user.status || '').toLowerCase() === 'blocked') {
      return res.status(403).json({ error: 'This account has been suspended. Contact support if you believe this is a mistake.' });
    }

    // Security: require email/OTP verification before signing in.
    if (user.isEmailVerified === false || user.is_email_verified === false) {
      return res.status(403).json({ error: 'Please verify your email before signing in. Enter the 6-digit code we sent to your inbox, or click resend.' });
    }

    // Update last_login timestamp
    user.last_login = new Date().toISOString();
    if (useSupabase) {
      await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
    }
    await saveDatabase(db);

    const sessionToken = issueSession(res, user);

    res.json({ message: 'Login successful', user: sanitizeUser(user), sessionToken });
  } catch (err: any) {
    console.error('[AxyFx Journal Server] Login endpoint error:', err);
    res.status(500).json({ error: `Server login error: ${err?.message || err}` });
  }
});

app.post('/api/auth/verify-otp', otpRateLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and 6-digit OTP code are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (otpAttemptsExhausted(normalizedEmail)) {
      return res.status(429).json({
        error: 'Too many incorrect codes. Please request a new verification code.',
        code: 'OTP_ATTEMPTS_EXCEEDED',
      });
    }

    // Always load OTP directly from Supabase so it works on serverless (Vercel)
    if (useSupabase) {
      const { data: row, error: fetchErr } = await supabase
        .from('users')
        .select('*')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (fetchErr) {
        console.error('[verify-otp] Supabase fetch error:', fetchErr);
        return res.status(500).json({ error: 'Server error verifying OTP.' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Account not found. Please register first.' });
      }

      const storedOtp = row.email_otp;
      const expiresAt = row.otp_expires_at ? new Date(row.otp_expires_at).getTime() : 0;

      if (!storedOtp || !safeTokenEqual(storedOtp, otp.toString().trim())) {
        const attempts = registerFailedOtp(normalizedEmail);
        if (attempts >= MAX_OTP_ATTEMPTS) {
          // Burn the code so a fresh one must be requested.
          await supabase.from('users')
            .update({ email_otp: null, otp_expires_at: null })
            .eq('email', normalizedEmail);
        }
        return res.status(400).json({ error: 'Invalid 6-digit verification code.' });
      }

      if (Date.now() > expiresAt) {
        return res.status(400).json({ error: 'Verification code has expired. Please click resend to get a new code.' });
      }

      // Mark email as verified and clear OTP
      const { error: updateErr } = await supabase
        .from('users')
        .update({ is_email_verified: true, email_otp: null, otp_expires_at: null })
        .eq('email', normalizedEmail);

      if (updateErr) {
        console.error('[verify-otp] Supabase update error:', updateErr);
        return res.status(500).json({ error: 'Server error confirming email.' });
      }

      const verifiedUser = toCamel({ ...row, is_email_verified: true, email_otp: null, otp_expires_at: null });

      // Auto-create a default portfolio account for the newly verified user
      try {
        const otpDb = await ensureUserDbLoaded(verifiedUser.id, normalizedEmail);
        await ensureDefaultPortfolioAccount(otpDb, verifiedUser.id, normalizedEmail);
      } catch (e) {
        console.error('[verify-otp] Failed to auto-create default portfolio account:', e);
      }

      clearFailedOtp(normalizedEmail);
      const sessionToken = issueSession(res, verifiedUser);

      return res.json({ message: 'Email verified successfully.', user: sanitizeUser(verifiedUser), sessionToken });
    }

    // Fallback: in-memory path (local dev without Supabase)
    let db = userDatabases.get(normalizedEmail) || await ensureUserDbLoaded(normalizedEmail);
    let user = db.users.find((u: any) => u.email.toLowerCase() === normalizedEmail);

    if (!user) {
      return res.status(404).json({ error: 'Account not found. Please register first.' });
    }

    if (user.emailOtp && safeTokenEqual(user.emailOtp, otp.toString().trim())) {
      const expiresAt = user.otpExpiresAt ? new Date(user.otpExpiresAt).getTime() : 0;
      if (Date.now() > expiresAt) {
        return res.status(400).json({ error: 'Verification code has expired. Please click resend to get a new code.' });
      }
      user.isEmailVerified = true;
      delete user.emailOtp;
      delete user.otpExpiresAt;
      // Auto-create a default portfolio account for the newly verified user
      await ensureDefaultPortfolioAccount(db, user.id, normalizedEmail);
      await saveDatabase(db, user.id, normalizedEmail);

      clearFailedOtp(normalizedEmail);
      const sessionToken = issueSession(res, user);
      return res.json({ message: 'Email verified successfully.', user: sanitizeUser(user), sessionToken });
    } else {
      const attempts = registerFailedOtp(normalizedEmail);
      if (attempts >= MAX_OTP_ATTEMPTS) {
        delete user.emailOtp;
        delete user.otpExpiresAt;
      }
      return res.status(400).json({ error: 'Invalid 6-digit verification code.' });
    }
  } catch (err: any) {
    console.error('[AxyFx Journal Server] Verify OTP error:', err);
    return res.status(500).json({ error: `Server verify OTP error: ${err?.message || err}` });
  }
});

app.post('/api/auth/resend-otp', otpRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (useSupabase) {
      const { data: row } = await supabase.from('users').select('*').eq('email', normalizedEmail).maybeSingle();
      if (!row) {
        return res.status(404).json({ error: 'User account not found.' });
      }

      const newOtp = generateOtp();
      const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      clearFailedOtp(normalizedEmail);

      await supabase.from('users').update({
        email_otp: newOtp,
        otp_expires_at: otpExpiresAt,
        otp_sent_at: new Date().toISOString()
      }).eq('email', normalizedEmail);

      const emailResult = await sendOtpEmail(normalizedEmail, newOtp);
      return res.json({
        message: emailResult.success ? 'New verification code sent to ' + normalizedEmail : 'New verification code generated.',
        emailSent: emailResult.success,
        ...(canExposeOtp() ? { devOtp: emailResult.otp } : {})
      });
    }

    // Fallback in-memory
    let db = userDatabases.get(normalizedEmail) || await ensureUserDbLoaded(normalizedEmail);
    let user = db.users.find((u: any) => u.email.toLowerCase() === normalizedEmail);

    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const newOtp = generateOtp();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    user.emailOtp = newOtp;
    user.otpExpiresAt = otpExpiresAt;
    user.otpSentAt = new Date().toISOString();

    await saveDatabase(db, normalizedEmail);
    const emailResult = await sendOtpEmail(normalizedEmail, newOtp);

    return res.json({
      message: emailResult.success ? 'New verification code sent to ' + normalizedEmail : 'New verification code generated.',
      emailSent: emailResult.success,
      ...(canExposeOtp() ? { devOtp: emailResult.otp } : {})
    });
  } catch (err: any) {
    console.error('[AxyFx Journal Server] Resend OTP error:', err);
    res.status(500).json({ error: `Server resend OTP error: ${err?.message || err}` });
  }
});

// ==========================================
// FORGOT PASSWORD / RESET PASSWORD ROUTES
// ==========================================

app.post('/api/auth/forgot-password', authIpBackstopLimiter, authRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const normalizedEmail = email.toLowerCase().trim();

    if (useSupabase) {
      const { data: row } = await supabase.from('users').select('id, is_email_verified').eq('email', normalizedEmail).maybeSingle();
      // Neutral response to prevent account enumeration
      if (!row || !row.is_email_verified) {
        return res.json({ message: 'If this email is registered, a password reset code has been sent.' });
      }

      const otp = generateOtp();
      const resetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      await supabase.from('users').update({
        reset_otp: otp,
        reset_otp_expires_at: resetOtpExpiresAt
      }).eq('email', normalizedEmail);

      const emailResult = await sendOtpEmail(normalizedEmail, otp, 'Password Reset Code');
      console.log(`[Auth] Password reset OTP sent to ${normalizedEmail}, emailSent: ${emailResult.success}`);

      return res.json({
        message: 'If this email is registered, a password reset code has been sent.',
        ...(canExposeOtp() ? { devOtp: emailResult.otp } : {})
      });
    }

    // Fallback in-memory
    const db = await ensureUserDbLoaded(normalizedEmail);
    const user = db.users.find((u: any) => u.email.toLowerCase() === normalizedEmail);
    if (!user || !user.isEmailVerified) {
      return res.json({ message: 'If this email is registered, a password reset code has been sent.' });
    }
    const otp = generateOtp();
    user.resetOtp = otp;
    user.resetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await saveDatabase(db, normalizedEmail);
    const emailResult = await sendOtpEmail(normalizedEmail, otp, 'Password Reset Code');
    return res.json({ message: 'If this email is registered, a password reset code has been sent.', ...(canExposeOtp() ? { devOtp: emailResult.otp } : {}) });
  } catch (err: any) {
    console.error('[Auth] Forgot password error:', err);
    res.status(500).json({ error: 'Server error during password reset request.' });
  }
});

app.post('/api/auth/reset-password', authIpBackstopLimiter, authRateLimiter, async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, reset code, and new password are all required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (useSupabase) {
      const { data: row } = await supabase.from('users').select('*').eq('email', normalizedEmail).maybeSingle();
      if (!row) {
        return res.status(400).json({ error: 'Invalid or expired reset code.' });
      }

      if (!row.reset_otp || row.reset_otp !== otp.toString().trim()) {
        return res.status(400).json({ error: 'Invalid reset code. Please check the code sent to your email.' });
      }

      const expiry = row.reset_otp_expires_at ? new Date(row.reset_otp_expires_at).getTime() : 0;
      if (Date.now() > expiry) {
        return res.status(400).json({ error: 'Reset link expired. Please request a new password reset.' });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await supabase.from('users').update({
        password: hashedPassword,
        reset_otp: null,
        reset_otp_expires_at: null
      }).eq('email', normalizedEmail);

      console.log(`[Auth] Password successfully reset for ${normalizedEmail}`);
      return res.json({ message: 'Password updated successfully. You can now log in with your new password.' });
    }

    // Fallback in-memory
    const db = await ensureUserDbLoaded(normalizedEmail);
    const user = db.users.find((u: any) => u.email.toLowerCase() === normalizedEmail);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset code.' });
    }
    if (!user.resetOtp || user.resetOtp !== otp.toString().trim()) {
      return res.status(400).json({ error: 'Invalid reset code. Please check the code sent to your email.' });
    }
    const expiry = user.resetOtpExpiresAt ? new Date(user.resetOtpExpiresAt).getTime() : 0;
    if (Date.now() > expiry) {
      return res.status(400).json({ error: 'Reset link expired. Please request a new password reset.' });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    delete user.resetOtp;
    delete user.resetOtpExpiresAt;
    await saveDatabase(db, normalizedEmail);
    return res.json({ message: 'Password updated successfully. You can now log in with your new password.' });
  } catch (err: any) {
    console.error('[Auth] Reset password error:', err);
    res.status(500).json({ error: 'Server error during password reset.' });
  }
});

app.post('/api/auth/onboarding', async (req, res) => {

  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });
  const { experience, tradingStyle, markets } = req.body;

  const userIdx = db.users.findIndex((u: any) => u.id === currentUser?.id);
  if (userIdx !== -1) {
    db.users[userIdx].experience = experience;
    db.users[userIdx].tradingStyle = tradingStyle;
    db.users[userIdx].mainMarkets = markets;
    db.users[userIdx].onboardingCompleted = true;
    db.users[userIdx].onboardingData = { experience, tradingStyle, markets };

    // Auto-create a default portfolio account for new users if none exists yet
    await ensureDefaultPortfolioAccount(db, currentUser.id, authEmail);

    await saveDatabase(db, authEmail);
    currentUser = db.users[userIdx];
    res.json({ message: 'Onboarding completed successfully', user: currentUser });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

app.post('/api/auth/update-profile', async (req, res) => {

  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });
  // `isPro` is deliberately ignored — the plan level is only ever set by a
  // signature-verified payment. `email` is ignored too: it is the account's
  // identity, so changing it here would allow taking over another account.
  const { name } = req.body;

  const userIdx = db.users.findIndex((u: any) => u.id === currentUser?.id);
  if (userIdx !== -1) {
    const previousUserId = db.users[userIdx].id;
    const previousEmail = db.users[userIdx].email;
    if (name) db.users[userIdx].name = name;

    await saveDatabase(db, db.users[userIdx].id, db.users[userIdx].email, { userId: previousUserId, email: previousEmail });
    currentUser = db.users[userIdx];
    res.json({ message: 'Profile updated successfully', user: sanitizeUser(currentUser) });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

// ==========================================
// USER PREFERENCES ROUTE
// ==========================================

app.patch('/api/auth/preferences', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });

  const userIdx = db.users.findIndex((u: any) => u.id === currentUser?.id);
  if (userIdx === -1) return res.status(404).json({ error: 'User not found' });

  // Merge incoming preferences with existing ones
  const existing = db.users[userIdx].preferences || {};
  db.users[userIdx].preferences = { ...existing, ...req.body };

  await saveDatabase(db, authEmail);
  currentUser = db.users[userIdx];
  res.json({ message: 'Preferences saved', user: currentUser });
});

// ==========================================
// PLAN ENTITLEMENTS
//
// One table, so "what does Free get" has a single answer instead of an isPro
// check copied into each route with slightly different wording. Every gate
// below reads the session's plan, never anything the client sent — a feature
// hidden in the UI is a courtesy, this is the limit.
// ==========================================

const FREE_ACCOUNT_LIMIT = 1;
const FREE_REPORT_DAYS = 30;

/** Features that require an active Pro plan. */
type ProFeature = 'mt5Sync' | 'liveChart' | 'aiMentor' | 'unlimitedAccounts' | 'proReports' | 'whatsappAlerts';

const PRO_FEATURE_MESSAGES: Record<ProFeature, string> = {
  mt5Sync: 'MT5 sync is a Pro feature. On the free plan you can add trades manually.',
  liveChart: 'Live Chart is a Pro feature. Upgrade to chart your trades against live market data.',
  aiMentor: 'AI Mentor is a Pro feature. Upgrade to get coaching on your trading.',
  unlimitedAccounts: `The free plan is limited to ${FREE_ACCOUNT_LIMIT} portfolio account. Upgrade to Pro for unlimited broker and prop firm accounts.`,
  proReports: `The free plan reports cover the last ${FREE_REPORT_DAYS} days in CSV. Excel and PDF reports over any period are a Pro feature.`,
  whatsappAlerts: 'WhatsApp news reminders are a Pro feature.',
};

/**
 * Pro is decided by pro_until, which the auth middleware already re-evaluates
 * on every request, so a lapsed plan loses access without waiting for a
 * webhook. Partners hold the role's complimentary Pro the same way.
 */
const hasPro = (user: any): boolean => !!(user?.isPro ?? user?.is_pro);

/**
 * Guard for a Pro-only route. Returns true when the caller may proceed, and
 * has already sent the 403 when they may not.
 *
 * `proRequired: true` is what the client watches for to raise the upgrade
 * modal, so it must be on every one of these refusals.
 */
const requirePro = (req: any, res: any, feature: ProFeature): boolean => {
  const currentUser = req.currentUser;
  if (!currentUser) {
    res.status(401).json({ error: 'Not authenticated' });
    return false;
  }
  if (!hasPro(currentUser)) {
    res.status(403).json({ error: PRO_FEATURE_MESSAGES[feature], proRequired: true, feature });
    return false;
  }
  return true;
};

/** The oldest date a plan may pull report data from. Null means no floor. */
const reportFloorFor = (user: any): Date | null =>
  hasPro(user) ? null : new Date(Date.now() - FREE_REPORT_DAYS * 86400000);

/**
 * What this session may do, for the UI to render locks against.
 *
 * The client asks rather than deciding for itself, so a change to the table
 * above reaches every badge and disabled button without touching them. The
 * server still re-checks on each route: this is for labelling, not gating.
 */
app.get('/api/plan/entitlements', (req, res) => {
  const currentUser = (req as any).currentUser;
  const pro = hasPro(currentUser);
  res.json({
    plan: pro ? 'pro' : 'free',
    isPro: pro,
    limits: {
      accounts: pro ? null : FREE_ACCOUNT_LIMIT,
      reportDays: pro ? null : FREE_REPORT_DAYS,
      reportFormats: pro ? ['csv', 'xlsx', 'pdf'] : ['csv'],
    },
    features: {
      manualJournal: true,
      analytics: true,
      calendar: true,
      fxNews: true,
      tools: true,
      mt5Sync: pro,
      liveChart: pro,
      aiMentor: pro,
      unlimitedAccounts: pro,
      proReports: pro,
      whatsappAlerts: pro,
    },
  });
});

// ==========================================
// TRADING ACCOUNTS ROUTES
// ==========================================

app.get('/api/accounts', async (req, res) => {
  let currentUser = (req as any).currentUser;
  if (!currentUser) return res.json({ accounts: [] });

  // Always fetch fresh from Supabase when available
  if (useSupabase) {
    try {
      const { data: rows, error } = await supabase
        .from('trading_accounts')
        .select('*')
        .eq('user_id', currentUser.id);
      if (error) {
        console.error('[GET /api/accounts] Supabase error:', JSON.stringify(error));
      } else {
        const accounts = toCamel(rows || []);
        console.log(`[GET /api/accounts] User: ${currentUser.id}, accounts from Supabase: ${accounts.length}`);
        if (accounts.length > 0) {
          return res.json({ accounts });
        }
      }
    } catch (err: any) {
      console.error('[GET /api/accounts] Exception:', err?.message);
    }
  }

  // Fallback / In-memory: use middleware db
  const db = (req as any).userDb;
  if (!db) return res.json({ accounts: [] });
  let userAccounts = (db.accounts || []).filter((acc: any) => acc.userId === currentUser.id || acc.user_id === currentUser.id);
  
  // Guarantee that every authenticated user always has at least 1 working starter portfolio account
  if (userAccounts.length === 0) {
    try {
      const starter = await ensureDefaultPortfolioAccount(db, currentUser.id, currentUser.email);
      if (starter) {
        userAccounts = [starter];
      }
    } catch (err) {
      console.error('[GET /api/accounts] Starter account creation error:', err);
    }
  }

  console.log(`[GET /api/accounts] User: ${currentUser.id} (${currentUser.email}), active accounts: ${userAccounts.length}`);
  res.json({ accounts: userAccounts });
});

app.post('/api/accounts', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  console.log(`[POST /api/accounts] x-auth-user-id: "${req.headers['x-auth-user-id']}", x-auth-email: "${req.headers['x-auth-email']}", resolved currentUser: ${currentUser?.id || 'NONE'}`);
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated. Please refresh the page and log in again.' });

  if (!db.accounts) db.accounts = [];
  if (!db.riskSettings) db.riskSettings = [];

  // Account limit check for Free vs Pro
  const existingUserAccounts = db.accounts.filter((acc: any) => acc.userId === currentUser.id || acc.user_id === currentUser.id);
  if (!hasPro(currentUser) && existingUserAccounts.length >= FREE_ACCOUNT_LIMIT) {
    return res.status(403).json({
      error: PRO_FEATURE_MESSAGES.unlimitedAccounts,
      proRequired: true,
      feature: 'unlimitedAccounts',
    });
  }

  const { name, broker, platform, accountType, currency, startingBalance, isMt5Sync, institutionType, login, server, investorPassword } = req.body;

  // Free plan is manual entry only. Checked here as well as in the UI, because
  // the UI check is a nicety and this is the actual limit.
  if (isMt5Sync && !hasPro(currentUser)) {
    return res.status(403).json({
      error: PRO_FEATURE_MESSAGES.mt5Sync, proRequired: true, feature: 'mt5Sync',
    });
  }

  if (!name || !broker) {
    return res.status(400).json({ error: 'Account name and broker are required.' });
  }
  if (!isMt5Sync && (startingBalance === undefined || startingBalance === null)) {
    return res.status(400).json({ error: 'Starting balance is required for manual accounts.' });
  }

  let startBal: number;
  if (isMt5Sync) {
    startBal = (startingBalance !== undefined && startingBalance !== null && startingBalance !== '')
      ? (parseFloat(startingBalance) || 0)
      : 0;
  } else {
    startBal = parseFloat(startingBalance) || 10000;
  }

  let enc = null;
  if (investorPassword) {
    enc = encryptInvestorPassword(investorPassword);
  }

  const newAcc: TradingAccount = {
    id: `acc_${crypto.randomUUID()}`,
    userId: currentUser.id,
    name,
    broker,
    platform: isMt5Sync ? 'MT5' : (platform || 'MT5'),
    accountType: accountType || 'Live',
    ...(institutionType ? { institutionType } : {}),
    currency: currency || 'USD',
    startingBalance: startBal,
    currentBalance: startBal,
    equity: startBal,
    status: 'Active',
    isMt5Sync: !!isMt5Sync,
    eaToken: generateEaToken(),
    eaStatus: isMt5Sync ? 'Connected' : 'Not Connected',
    ...(login ? { mt5Login: String(login).trim(), eaTerminalLogin: String(login).trim() } : {}),
    ...(server ? { mt5Server: String(server).trim(), eaTerminalServer: String(server).trim() } : {}),
    ...(enc ? {
      investorPasswordEnc: enc.enc,
      passwordEncNonce: '',
      passwordKmsKeyId: enc.keyId,
      syncMethod: 'CLOUD',
      connectionStatus: 'Connected'
    } : {
      ...(isMt5Sync && login && server ? {
        syncMethod: 'CLOUD',
        connectionStatus: 'Connected'
      } : {})
    })
  };

  db.accounts.push(newAcc);

  // Create default risk settings
  const riskBase = startBal || 10000;
  const newRisk: RiskSettings = {
    id: `r_${Date.now()}`,
    accountId: newAcc.id,
    riskPerTradeLimit: 2.0,
    dailyLossLimit: riskBase * 0.05,
    weeklyLossLimit: riskBase * 0.10,
    maxDrawdownLimit: 10.0,
    disciplineEnabled: true,
    maxTradesPerDay: 5
  };
  db.riskSettings.push(newRisk);

  const saveResult = await saveDatabase(db, authEmail);
  if (saveResult?.accountsError) {
    const code = saveResult.accountsError.code;
    if (code === '42703') {
      return res.status(500).json({
        error: 'Database is missing required columns. Please run the MT5 EA schema migration in Supabase (mt5_ea_schema_migration.sql) and try again.'
      });
    }
    return res.status(500).json({ error: 'Account could not be saved to the database. Please try again.' });
  }
  res.json({ message: 'Trading account created', account: newAcc });
});

app.put('/api/accounts/:id', async (req, res) => {

  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });
  const { id } = req.params;
  const { name, broker, status, currentBalance, equity, currency, startingBalance } = req.body;

  const accIdx = db.accounts.findIndex((acc: any) => acc.id === id);
  if (accIdx !== -1 && db.accounts[accIdx].userId === currentUser.id) {
    if (name) db.accounts[accIdx].name = name;
    if (broker) db.accounts[accIdx].broker = broker;
    if (status) db.accounts[accIdx].status = status;
    if (currency) db.accounts[accIdx].currency = currency;
    if (startingBalance !== undefined) db.accounts[accIdx].startingBalance = parseFloat(startingBalance);
    if (currentBalance !== undefined) db.accounts[accIdx].currentBalance = parseFloat(currentBalance);
    if (equity !== undefined) db.accounts[accIdx].equity = parseFloat(equity);

    await saveDatabase(db, authEmail);
    res.json({ message: 'Account updated successfully', account: db.accounts[accIdx] });
  } else if (accIdx !== -1) {
    res.status(403).json({ error: 'You can only edit your own trading accounts.' });
  } else {
    res.status(404).json({ error: 'Account not found' });
  }
});

app.delete('/api/accounts/:id', async (req, res) => {

  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });
  const { id } = req.params;

  const targetAccount = db.accounts.find((acc: any) => acc.id === id);
  if (!targetAccount) {
    return res.status(404).json({ error: 'Account not found' });
  }
  if (targetAccount.userId !== currentUser.id) {
    return res.status(403).json({ error: 'You can only delete your own trading accounts.' });
  }

  const initialLength = db.accounts.length;
  db.accounts = db.accounts.filter((acc: any) => acc.id !== id);

  if (db.accounts.length < initialLength) {
    // Clean up trades associated with this account
    db.trades = db.trades.filter((t: any) => t.accountId !== id);
    db.riskSettings = db.riskSettings.filter((r: any) => r.accountId !== id);

    if (useSupabase) {
      await supabase.from('trading_accounts').delete().eq('id', id);
      await supabase.from('trades').delete().eq('account_id', id);
      await supabase.from('risk_settings').delete().eq('account_id', id);
    }

    await saveDatabase(db, authEmail);
    res.json({ message: 'Account and associated trades deleted successfully' });
  } else {
    res.status(404).json({ error: 'Account not found' });
  }
});

// ==========================================
// TRADING JOURNAL / TRADES ROUTES
// ==========================================

app.get('/api/trades', async (req, res) => {
  let currentUser = (req as any).currentUser;
  if (!currentUser) return res.json({ trades: [] });

  const { accountId } = req.query;
  let accountTrades: any[] = [];

  // Always fetch fresh from Supabase when available (bypasses stale middleware cache)
  if (useSupabase) {
    try {
      let query = supabase
        .from('trades')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('date', { ascending: false });

      if (accountId) {
        // Security: verify account belongs to this user
        const { data: accCheck } = await supabase
          .from('trading_accounts')
          .select('user_id')
          .eq('id', accountId)
          .maybeSingle();
        if (accCheck && accCheck.user_id !== currentUser.id) {
          return res.status(403).json({ error: 'You can only view trades for your own accounts.' });
        }
        query = query.eq('account_id', accountId as string);
      }

      const { data: rows, error } = await query;
      if (error) {
        console.error('[GET /api/trades] Supabase error:', JSON.stringify(error));
      } else {
        accountTrades = toCamel(rows || []);
        console.log(`[GET /api/trades] Fetched ${accountTrades.length} trades for user ${currentUser.id} from Supabase`);
        if (accountTrades.length > 0) console.log('[GET /api/trades] First trade exitTime:', accountTrades[0].exitTime, '| Raw exit_time:', (rows || [])[0]?.exit_time);
      }
    } catch (err: any) {
      console.error('[GET /api/trades] Exception:', err?.message);
    }
  }

  if (accountTrades.length === 0) {
    // Fallback: use middleware-loaded db
    const db = (req as any).userDb;
    if (db) {
      // Trades written before userId was stamped on them have no owner, so
      // fall back to the account they belong to rather than dropping them.
      const ownAccountIds = new Set(
        (db.accounts || [])
          .filter((a: any) => a.userId === currentUser.id || !a.userId)
          .map((a: any) => a.id)
      );
      accountTrades = accountId
        ? (db.trades || []).filter((t: any) => t.accountId === accountId && (t.userId === currentUser.id || !t.userId))
        : (db.trades || []).filter((t: any) => t.userId === currentUser.id || ownAccountIds.has(t.accountId));
      accountTrades.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
  }

  res.json({ trades: accountTrades });
});

/**
 * Report export, authorised and filtered on the server.
 *
 * The files themselves are still built in the browser — that is where the
 * spreadsheet and PDF libraries live — but the rows that go into them come
 * from here, already cut to what the caller's plan allows, and the format is
 * checked before any rows are returned. A free user who calls this asking for
 * xlsx, or for last year, gets a 403 rather than a file.
 *
 * What this cannot do is stop someone re-formatting data they already own:
 * /api/trades legitimately returns a user's own trades, and anyone determined
 * can paste those into a spreadsheet themselves. The gate is on the product's
 * report feature, not on the user's knowledge of their own trading.
 */
const REPORT_FORMATS = new Set(['csv', 'xlsx', 'pdf']);
const FREE_REPORT_FORMATS = new Set(['csv']);

app.post('/api/reports/export', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });

  const format = String(req.body?.format || 'csv').toLowerCase();
  if (!REPORT_FORMATS.has(format)) {
    return res.status(400).json({ error: 'Unknown report format.' });
  }

  const pro = hasPro(currentUser);
  if (!pro && !FREE_REPORT_FORMATS.has(format)) {
    return res.status(403).json({
      error: PRO_FEATURE_MESSAGES.proReports, proRequired: true, feature: 'proReports',
    });
  }

  const floor = reportFloorFor(currentUser);
  const parseDate = (v: any): Date | null => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  let start = parseDate(req.body?.start);
  const end = parseDate(req.body?.end);

  // The requested window is clamped rather than refused: a free user picking
  // "this year" gets the last 30 days of it and is told so, which is friendlier
  // than an error and still hands out nothing beyond the plan.
  let clamped = false;
  if (floor && (!start || start < floor)) {
    start = floor;
    clamped = true;
  }

  const accountId = req.body?.accountId ? String(req.body.accountId) : null;

  let rows: any[] = [];
  if (useSupabase) {
    let query = supabase.from('trades').select('*').eq('user_id', currentUser.id).order('date', { ascending: false });
    if (accountId) {
      const { data: accCheck } = await supabase
        .from('trading_accounts').select('user_id').eq('id', accountId).maybeSingle();
      if (accCheck && accCheck.user_id !== currentUser.id) {
        return res.status(403).json({ error: 'You can only export your own accounts.' });
      }
      query = query.eq('account_id', accountId);
    }
    const { data, error } = await query;
    if (error) {
      console.error('[POST /api/reports/export] Supabase error:', error.message);
      return res.status(500).json({ error: 'Could not build the report.' });
    }
    rows = toCamel(data || []);
  } else {
    const db = (req as any).userDb;
    const ownAccountIds = new Set(
      (db?.accounts || [])
        .filter((a: any) => a.userId === currentUser.id || !a.userId)
        .map((a: any) => a.id)
    );
    rows = (db?.trades || []).filter((t: any) =>
      (t.userId === currentUser.id || ownAccountIds.has(t.accountId)) &&
      (!accountId || t.accountId === accountId)
    );
  }

  const inWindow = rows.filter((t: any) => {
    const d = parseDate(t.date ?? t.entryTime);
    if (!d) return false;
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  }).sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)));

  res.json({
    format,
    plan: pro ? 'pro' : 'free',
    clamped,
    windowStart: start ? start.toISOString() : null,
    windowEnd: end ? end.toISOString() : null,
    maxDays: pro ? null : FREE_REPORT_DAYS,
    count: inWindow.length,
    trades: inWindow,
  });
});

app.post('/api/trades', async (req, res) => {


  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });
  const {
    accountId,
    date,
    symbol,
    type,
    lotSize,
    entryPrice,
    exitPrice,
    exitTime,
    stopLoss,
    takeProfit,
    profit,
    commission,
    swap,
    riskPercentage,
    strategy,
    emotion,
    notes,
    screenshot,
    tags
  } = req.body;

  if (!symbol || !type || !lotSize || !entryPrice || !exitPrice || profit === undefined) {
    return res.status(400).json({ error: 'Missing required trade parameters' });
  }

  // The presence check above passes for "-5" and "abc". Both used to reach
  // parseFloat and then the running balance — a NaN there poisons the account
  // total permanently, and a negative lot size corrupts every volume stat.
  const tradeValidationError = validateTradeNumbers({
    lotSize, entryPrice, exitPrice, profit, commission, swap, riskPercentage, type,
  });
  if (tradeValidationError) {
    return res.status(400).json({ error: tradeValidationError });
  }

  const ownAccounts = (db.accounts || []).filter((acc: any) => acc.userId === currentUser.id);
  if (accountId) {
    const requestedAccount = db.accounts.find((acc: any) => acc.id === accountId);
    if (!requestedAccount) {
      return res.status(404).json({ error: 'Account not found' });
    }
    if (requestedAccount.userId !== currentUser.id) {
      return res.status(403).json({ error: 'You can only add trades to your own accounts.' });
    }
  }

  // Verify account existence in user's scoped database
  let accountIdx = ownAccounts.findIndex((acc: any) => acc.id === accountId);
  if (accountIdx === -1) {
    if (ownAccounts.length > 0) {
      accountIdx = 0; // Fallback to primary own account only
    } else {
      const defaultAccId = `acc_${crypto.randomUUID()}`;
      db.accounts.push({
        id: defaultAccId,
        userId: currentUser.id,
        name: 'Main Trading Account',
        broker: 'MetaTrader 5',
        startingBalance: 10000,
        currentBalance: 10000,
        equity: 10000,
        currency: 'USD',
        status: 'Active',
        createdAt: new Date().toISOString()
      });
      accountIdx = db.accounts.length - 1;
    }
  } else {
    accountIdx = db.accounts.findIndex((acc: any) => acc.id === ownAccounts[accountIdx].id);
  }

  const targetAccountId = db.accounts[accountIdx].id;

  // Prevent immediate accidental double clicks (2 seconds window)
  const nowMs = Date.now();
  const duplicateExists = db.trades.some((t: any) =>
    t.accountId === targetAccountId &&
    t.symbol === symbol.toUpperCase() &&
    t.type === type &&
    t.entryPrice === parseFloat(entryPrice) &&
    t.profit === parseFloat(profit) &&
    nowMs - new Date(t.date).getTime() < 2000 // within 2 seconds
  );

  if (duplicateExists) {
    return res.status(400).json({ error: 'Duplicate trade submission detected. Please wait a moment.' });
  }

  const newTrade: Trade = {
    id: `trade_${crypto.randomUUID()}`,
    accountId: targetAccountId,
    // Without this the trade was stored with no owner, and GET /api/trades —
    // which filters on userId when no accountId is given — never returned it.
    userId: currentUser.id,
    date: date || new Date().toISOString(),
    symbol: symbol.toUpperCase(),
    type,
    lotSize: parseFloat(lotSize),
    entryPrice: parseFloat(entryPrice),
    exitPrice: parseFloat(exitPrice),
    exitTime: exitTime || undefined,
    stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
    takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
    profit: parseFloat(profit),
    commission: commission ? parseFloat(commission) : 0,
    swap: swap ? parseFloat(swap) : 0,
    riskPercentage: riskPercentage ? parseFloat(riskPercentage) : 1.0,
    strategy: strategy || 'Unspecified',
    emotion: emotion || 'Calm',
    notes: notes || '',
    screenshot: screenshot || '',
    tags: tags || []
  };

  db.trades.push(newTrade);

  // Update account current balance
  const netProfit = newTrade.profit + newTrade.commission + newTrade.swap;
  db.accounts[accountIdx].currentBalance = parseFloat((db.accounts[accountIdx].currentBalance + netProfit).toFixed(2));
  db.accounts[accountIdx].equity = db.accounts[accountIdx].currentBalance;

  await saveDatabase(db, authEmail);
  console.log('[POST /api/trades] newTrade.exitTime =', newTrade.exitTime);
  res.json({ message: 'Trade logged successfully', trade: newTrade, updatedAccount: db.accounts[accountIdx] });
});

app.post('/api/trades/batch', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });

  const { accountId, trades: incomingTrades } = req.body;
  if (!accountId || !Array.isArray(incomingTrades) || incomingTrades.length === 0) {
    return res.status(400).json({ error: 'accountId and trades[] are required' });
  }

  const account = db.accounts.find((a: any) => a.id === accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: 'Access denied' });

  const saved: Trade[] = [];
  const skipped: any[] = [];
  let balanceAdjustment = 0;

  // Fingerprint the trades already on this account so re-pasting the same MT5
  // report does not duplicate every row (and double-count the balance).
  // Two independent keys: the MT5 ticket when present (authoritative), and the
  // value tuple as a fallback for rows imported without one.
  const ticketKey = (t: any) => (t.ticket === undefined || t.ticket === null || t.ticket === '')
    ? null
    : `ticket:${String(t.ticket)}`;
  const valueKey = (t: any) =>
    [
      String(t.symbol || '').toUpperCase(),
      t.type || '',
      t.date || '',
      Number(t.entryPrice) || 0,
      Number(t.exitPrice) || 0,
      Number(t.lotSize) || 0,
      Number(t.profit) || 0,
    ].join('|');

  const existingTickets = new Set<string>();
  const existingValues = new Set<string>();
  for (const t of db.trades) {
    if (t.accountId !== accountId) continue;
    const tk = ticketKey(t);
    if (tk) existingTickets.add(tk);
    existingValues.add(valueKey(t));
  }

  for (const t of incomingTrades) {
    if (!t.symbol || !t.type || t.profit === undefined) continue;
    if (validateTradeNumbers(t)) { skipped.push(t.ticket ?? t.symbol); continue; }

    const incomingDate = t.date || new Date().toISOString();
    const candidate = { ...t, date: incomingDate };
    const tk = ticketKey(candidate);
    const vk = valueKey(candidate);
    if ((tk && existingTickets.has(tk)) || existingValues.has(vk)) {
      skipped.push(t.ticket ?? vk);
      continue;
    }
    if (tk) existingTickets.add(tk);
    existingValues.add(vk);
    const newTrade: Trade = {
      id: `trade_${crypto.randomUUID()}`,
      accountId,
      userId: currentUser.id,
      date: t.date || new Date().toISOString(),
      symbol: t.symbol.toUpperCase(),
      type: t.type,
      lotSize: parseFloat(t.lotSize) || 0.01,
      entryPrice: parseFloat(t.entryPrice) || 0,
      exitPrice: parseFloat(t.exitPrice) || 0,
      stopLoss: t.stopLoss ? parseFloat(t.stopLoss) : undefined,
      takeProfit: t.takeProfit ? parseFloat(t.takeProfit) : undefined,
      profit: parseFloat(t.profit) || 0,
      commission: t.commission ? parseFloat(t.commission) : 0,
      swap: t.swap ? parseFloat(t.swap) : 0,
      riskPercentage: t.riskPercentage ? parseFloat(t.riskPercentage) : 1.0,
      strategy: t.strategy || 'Pasted from MT5',
      emotion: t.emotion || 'Calm',
      notes: t.notes || '',
      screenshot: '',
      tags: t.tags || ['MT5 Paste'],
      isMt5Sync: true,
      // Keep the broker ticket so a later re-import of the same report can be
      // recognised as a duplicate rather than inserted again.
      ...(ticketKey(t) ? { ticket: t.ticket } : {}),
    };
    db.trades.push(newTrade);
    saved.push(newTrade);
    balanceAdjustment += newTrade.profit + newTrade.commission + newTrade.swap;
  }

  if (saved.length > 0) {
    account.currentBalance = parseFloat((account.currentBalance + balanceAdjustment).toFixed(2));
    account.equity = account.currentBalance;
    await saveDatabase(db, authEmail);
  }

  res.json({
    message: skipped.length
      ? `${saved.length} trades imported, ${skipped.length} duplicates skipped`
      : `${saved.length} trades imported successfully`,
    trades: saved,
    totalSaved: saved.length,
    totalSkipped: skipped.length,
  });
});

app.put('/api/trades/:id', async (req, res) => {


  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });
  const { id } = req.params;
  const updateData = req.body;

  const tradeIdx = db.trades.findIndex((t: any) => t.id === id);
  if (tradeIdx === -1) return res.status(404).json({ error: 'Trade not found' });

  const editValidationError = validateTradeNumbers(updateData);
  if (editValidationError) {
    return res.status(400).json({ error: editValidationError });
  }

  const trade = db.trades[tradeIdx];
  // Verify account exists
  const account = db.accounts.find((acc: any) => acc.id === trade.accountId);
  if (!account) return res.status(404).json({ error: 'Associated account not found' });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: 'You can only edit your own trades.' });

  // If profit updated, adjust account balance
  const oldNet = trade.profit + (trade.commission || 0) + (trade.swap || 0);

  // Update trade fields
  if (updateData.symbol) db.trades[tradeIdx].symbol = updateData.symbol.toUpperCase();
  if (updateData.type) db.trades[tradeIdx].type = updateData.type;
  if (updateData.lotSize !== undefined) db.trades[tradeIdx].lotSize = parseFloat(updateData.lotSize);
  if (updateData.entryPrice !== undefined) db.trades[tradeIdx].entryPrice = parseFloat(updateData.entryPrice);
  if (updateData.exitPrice !== undefined) db.trades[tradeIdx].exitPrice = parseFloat(updateData.exitPrice);
  if (updateData.exitTime !== undefined) db.trades[tradeIdx].exitTime = updateData.exitTime;
  if (updateData.stopLoss !== undefined) db.trades[tradeIdx].stopLoss = updateData.stopLoss ? parseFloat(updateData.stopLoss) : undefined;
  if (updateData.takeProfit !== undefined) db.trades[tradeIdx].takeProfit = updateData.takeProfit ? parseFloat(updateData.takeProfit) : undefined;
  if (updateData.profit !== undefined) db.trades[tradeIdx].profit = parseFloat(updateData.profit);
  if (updateData.commission !== undefined) db.trades[tradeIdx].commission = parseFloat(updateData.commission);
  if (updateData.swap !== undefined) db.trades[tradeIdx].swap = parseFloat(updateData.swap);
  if (updateData.riskPercentage !== undefined) db.trades[tradeIdx].riskPercentage = parseFloat(updateData.riskPercentage);
  if (updateData.strategy !== undefined) db.trades[tradeIdx].strategy = updateData.strategy;
  if (updateData.emotion !== undefined) db.trades[tradeIdx].emotion = updateData.emotion;
  if (updateData.notes !== undefined) db.trades[tradeIdx].notes = updateData.notes;
  if (updateData.screenshot !== undefined) db.trades[tradeIdx].screenshot = updateData.screenshot;
  if (updateData.tags !== undefined) db.trades[tradeIdx].tags = updateData.tags;
  if (updateData.date !== undefined) db.trades[tradeIdx].date = updateData.date;

  // Every term needs its own fallback: a legacy or EA-imported trade can have
  // commission/swap undefined, which would turn the account balance into NaN
  // permanently. `oldNet` above already guards the same way.
  const updated = db.trades[tradeIdx];
  const newNet = (updated.profit || 0) + (updated.commission || 0) + (updated.swap || 0);
  const diff = newNet - oldNet;

  const accIdx = db.accounts.findIndex((acc: any) => acc.id === trade.accountId);
  if (accIdx !== -1 && diff !== 0) {
    db.accounts[accIdx].currentBalance = parseFloat((db.accounts[accIdx].currentBalance + diff).toFixed(2));
    db.accounts[accIdx].equity = db.accounts[accIdx].currentBalance;
  }

  await saveDatabase(db, authEmail);
  res.json({ message: 'Trade updated successfully', trade: db.trades[tradeIdx] });
});

app.delete('/api/trades/:id', async (req, res) => {


  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });
  const { id } = req.params;

  const tradeIdx = db.trades.findIndex((t: any) => t.id === id);
  if (tradeIdx === -1) return res.status(404).json({ error: 'Trade not found' });

  const trade = db.trades[tradeIdx];
  let accIdx = db.accounts.findIndex((acc: any) => acc.id === trade.accountId);
  if (accIdx === -1) return res.status(404).json({ error: 'Associated account not found' });
  if (db.accounts[accIdx].userId !== currentUser.id) return res.status(403).json({ error: 'You can only delete your own trades.' });

  // Reverse trade impact from balance
  const netProfit = trade.profit + (trade.commission || 0) + (trade.swap || 0);
  db.accounts[accIdx].currentBalance = parseFloat((db.accounts[accIdx].currentBalance - netProfit).toFixed(2));
  db.accounts[accIdx].equity = db.accounts[accIdx].currentBalance;

  db.trades.splice(tradeIdx, 1);

  if (useSupabase) {
    await supabase.from('trades').delete().eq('id', id);
  }

  await saveDatabase(db, authEmail);

  res.json({ message: 'Trade deleted successfully', updatedAccount: db.accounts[accIdx] });
});

// ==========================================
// RISK SETTINGS ROUTES
// ==========================================

app.get('/api/risk-settings/:accountId', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });

  const { accountId } = req.params;
  const account = db.accounts.find((acc: any) => acc.id === accountId);
  if (account && account.userId !== currentUser.id) {
    return res.status(403).json({ error: 'You can only view risk settings for your own accounts.' });
  }
  const settings = (db.riskSettings || []).find((r: any) => r.accountId === accountId);
  if (!settings) {
    // Return default
    const defaultSettings: RiskSettings = {
      id: `r_${Date.now()}`,
      accountId,
      riskPerTradeLimit: 2.0,
      dailyLossLimit: 500,
      weeklyLossLimit: 1500,
      maxDrawdownLimit: 10.0,
      disciplineEnabled: true,
      maxTradesPerDay: 5
    };
    return res.json({ riskSettings: defaultSettings });
  }
  // Make sure old settings objects also have maxTradesPerDay
  if (settings.maxTradesPerDay === undefined) {
    settings.maxTradesPerDay = 5;
  }
  res.json({ riskSettings: settings });
});

app.put('/api/risk-settings/:accountId', async (req, res) => {

  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });
  const { accountId } = req.params;
  const { riskPerTradeLimit, dailyLossLimit, weeklyLossLimit, maxDrawdownLimit, disciplineEnabled, maxTradesPerDay } = req.body;
  const account = db.accounts.find((acc: any) => acc.id === accountId);
  if (account && account.userId !== currentUser.id) {
    return res.status(403).json({ error: 'You can only update risk settings for your own accounts.' });
  }

  const idx = db.riskSettings.findIndex((r: any) => r.accountId === accountId);
  if (idx !== -1) {
    const existing = db.riskSettings[idx];
    existing.riskPerTradeLimit = !isNaN(parseFloat(riskPerTradeLimit)) ? parseFloat(riskPerTradeLimit) : (existing.riskPerTradeLimit ?? 2.0);
    existing.dailyLossLimit = !isNaN(parseFloat(dailyLossLimit)) ? parseFloat(dailyLossLimit) : (existing.dailyLossLimit ?? 500);
    existing.weeklyLossLimit = !isNaN(parseFloat(weeklyLossLimit)) ? parseFloat(weeklyLossLimit) : (existing.weeklyLossLimit ?? 1500);
    existing.maxDrawdownLimit = !isNaN(parseFloat(maxDrawdownLimit)) ? parseFloat(maxDrawdownLimit) : (existing.maxDrawdownLimit ?? 10.0);
    if (disciplineEnabled !== undefined) {
      existing.disciplineEnabled = !!disciplineEnabled;
    }
    existing.maxTradesPerDay = !isNaN(parseInt(maxTradesPerDay)) ? parseInt(maxTradesPerDay) : (existing.maxTradesPerDay ?? 5);
    await saveDatabase(db, authEmail);
    res.json({ message: 'Risk parameters saved', riskSettings: existing });
  } else {
    const newRisk: RiskSettings = {
      id: `r_${Date.now()}`,
      accountId,
      riskPerTradeLimit: !isNaN(parseFloat(riskPerTradeLimit)) ? parseFloat(riskPerTradeLimit) : 2.0,
      dailyLossLimit: !isNaN(parseFloat(dailyLossLimit)) ? parseFloat(dailyLossLimit) : 500,
      weeklyLossLimit: !isNaN(parseFloat(weeklyLossLimit)) ? parseFloat(weeklyLossLimit) : 1500,
      maxDrawdownLimit: !isNaN(parseFloat(maxDrawdownLimit)) ? parseFloat(maxDrawdownLimit) : 10.0,
      disciplineEnabled: disciplineEnabled !== undefined ? !!disciplineEnabled : true,
      maxTradesPerDay: !isNaN(parseInt(maxTradesPerDay)) ? parseInt(maxTradesPerDay) : 5
    };
    db.riskSettings.push(newRisk);
    await saveDatabase(db, authEmail);
    res.json({ message: 'Risk parameters created', riskSettings: newRisk });
  }
});

// ==========================================
// MT5 EXPERT ADVISOR (EA) ROUTES
// Each portfolio account gets a unique EA; the EA authenticates with its
// embedded token and streams deals + account info to these endpoints.
// ==========================================

// Download the unique .mq5 EA for an account (session-authenticated)
app.get('/api/mt5/ea/:accountId/download', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });

  const account = db.accounts.find((a: any) => a.id === req.params.accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: 'Access denied' });

  if (!account.eaToken) {
    account.eaToken = generateEaToken();
    account.eaStatus = account.eaStatus || 'Not Connected';
    await saveDatabase(db, currentUser.email);
  }

  const apiUrl = apiBaseUrl(req);
  const source = generateEaSource(account, apiUrl);
  const safeName = String(account.name || 'account').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 30);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="FXJournalPro_Sync_${safeName}.mq5"`);
  res.send(source);
});

// Reset an account's EA token (invalidates the previous EA file)
app.post('/api/mt5/ea/:accountId/reset-token', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });

  const account = db.accounts.find((a: any) => a.id === req.params.accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: 'Access denied' });

  account.eaToken = generateEaToken();
  account.eaStatus = 'Not Connected';
  account.eaConnectedAt = undefined;
  account.eaLastDealId = 0;
  account.eaLastSyncTime = undefined;
  account.eaSyncTradeCount = account.eaSyncTradeCount || 0;

  await saveDatabase(db, currentUser.email);
  res.json({ message: 'EA token reset. Download a fresh EA file for this account.', account });
});

// EA handshake (legacy): validates the embedded body token and records terminal info.
// Kept for backward compatibility with previously downloaded EA files.
app.post('/api/mt5/ea/authenticate', ...eaProtection, async (req, res) => {
  const body = req.body || {};
  if (!body.accountId || !body.token) return res.status(400).json({ error: 'accountId and token are required' });

  const auth = await authEaRequest(req, res, body.token);
  if (!auth) return;
  const { db, account } = auth;

  if (body.terminal && typeof body.terminal === 'object') {
    if (body.terminal.login !== undefined) account.eaTerminalLogin = String(body.terminal.login);
    if (body.terminal.server !== undefined) account.eaTerminalServer = String(body.terminal.server);
  }
  account.eaStatus = 'Connected';
  account.connectionStatus = 'Connected';
  account.eaConnectedAt = account.eaConnectedAt || new Date().toISOString();
  account.lastHeartbeatAt = new Date().toISOString();

  logEaEvent(db, account, 'EA_AUTHENTICATE', 'info', 'EA handshake (legacy) succeeded');
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, status: 'Connected', lastDealId: account.eaLastDealId || 0 });
});

// EA validate (Phase 2): handshake with login/server/build verification.
// Requires Authorization: Bearer <token> + HMAC headers from the EA.
app.post('/api/mt5/ea/validate', ...eaProtection, async (req, res) => {
  const body = validateEaBody(res, EaValidateSchema, req.body || {});
  if (!body) return;
  const auth = await authEaRequest(req, res, body.token);
  if (!auth) return;
  const { db, account } = auth;

  const terminal = body.terminal || {};
  const reportedLogin = body.login || terminal.login;
  const reportedServer = body.server || terminal.server;

  if (reportedLogin !== undefined && reportedLogin !== '') {
    account.eaTerminalLogin = String(reportedLogin);
    if (account.mt5Login && String(account.mt5Login) !== String(reportedLogin)) {
      logEaEvent(db, account, 'EA_VALIDATE_FAIL', 'warn', 'Terminal login does not match portfolio login');
      return res.status(403).json({ error: 'Terminal login does not match the portfolio account login', code: 'EA_LOGIN_MISMATCH' });
    }
  }
  if (reportedServer !== undefined && reportedServer !== '') {
    account.eaTerminalServer = String(reportedServer);
    if (account.mt5Server && String(account.mt5Server) !== String(reportedServer)) {
      logEaEvent(db, account, 'EA_VALIDATE_FAIL', 'warn', 'Terminal server does not match portfolio server');
      return res.status(403).json({ error: 'Terminal server does not match the portfolio account server', code: 'EA_SERVER_MISMATCH' });
    }
  }
  if (body.build) account.mt5Build = String(body.build);

  account.eaStatus = 'Connected';
  account.connectionStatus = 'Connected';
  account.eaConnectedAt = account.eaConnectedAt || new Date().toISOString();
  account.lastHeartbeatAt = new Date().toISOString();

  logEaEvent(db, account, 'EA_VALIDATE', 'info', 'EA validate succeeded');
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, status: 'Connected', lastDealId: account.eaLastDealId || 0, portfolioId: account.id });
});

// EA account snapshot: balance/equity/margin time series
app.post('/api/mt5/ea/account', ...eaProtection, async (req, res) => {
  const body = validateEaBody(res, EaAccountSchema, req.body || {});
  if (!body) return;
  const auth = await authEaRequest(req, res, body.token);
  if (!auth) return;
  const { db, account } = auth;

  if (!Array.isArray(db.mt5Snapshots)) db.mt5Snapshots = [];
  db.mt5Snapshots.push({
    accountId: account.id,
    userId: db.users?.[0]?.id,
    balance: body.balance,
    equity: body.equity,
    margin: body.margin ?? null,
    marginFree: body.marginFree ?? null,
    marginLevel: body.marginLevel ?? null,
    currency: body.currency || account.currency || null,
    leverage: body.leverage ?? null,
    capturedAt: new Date().toISOString()
  });
  if (db.mt5Snapshots.length > 20000) db.mt5Snapshots = db.mt5Snapshots.slice(-20000);

  account.currentBalance = body.balance;
  account.equity = body.equity;
  if (body.currency) account.currency = body.currency;
  if (body.leverage) account.leverage = body.leverage;
  account.eaStatus = 'Connected';
  account.connectionStatus = 'Connected';
  account.lastHeartbeatAt = new Date().toISOString();

  logEaEvent(db, account, 'EA_ACCOUNT', 'info', 'Account snapshot recorded');
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, captured: true });
});

// EA open positions: replace-on-snapshot for the account
app.post('/api/mt5/ea/positions', ...eaProtection, async (req, res) => {
  const body = validateEaBody(res, EaPositionSchema, req.body || {});
  if (!body) return;
  const auth = await authEaRequest(req, res, body.token);
  if (!auth) return;
  const { db, account } = auth;

  if (!Array.isArray(db.mt5OpenPositions)) db.mt5OpenPositions = [];
  const posMap = new Map<string, any>();
  for (const p of body.positions) {
    posMap.set(`${account.id}:${p.positionId}`, {
      accountId: account.id,
      userId: db.users?.[0]?.id,
      positionId: Number(p.positionId),
      ticket: Number(p.ticket),
      symbol: String(p.symbol || '').toUpperCase(),
      side: String(p.side || ''),
      volume: p.volume,
      openTime: new Date(p.openTime * 1000).toISOString(),
      openPrice: p.openPrice,
      sl: p.sl ?? null,
      tp: p.tp ?? null,
      commission: p.commission ?? 0,
      swap: p.swap ?? 0,
      profit: p.profit ?? 0,
      currentPrice: p.currentPrice ?? null,
      updatedAt: new Date().toISOString()
    });
  }
  db.mt5OpenPositions = db.mt5OpenPositions.filter((op: any) => op.accountId !== account.id);
  db.mt5OpenPositions.push(...posMap.values());

  account.eaStatus = 'Connected';
  account.connectionStatus = 'Connected';
  account.lastHeartbeatAt = new Date().toISOString();

  logEaEvent(db, account, 'EA_POSITIONS', 'info', `Open positions snapshot: ${body.positions.length}`);
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, positions: body.positions.length });
});

// EA pending orders: replace-on-snapshot for the account
app.post('/api/mt5/ea/orders', ...eaProtection, async (req, res) => {
  const body = validateEaBody(res, EaOrderSchema, req.body || {});
  if (!body) return;
  const auth = await authEaRequest(req, res, body.token);
  if (!auth) return;
  const { db, account } = auth;

  if (!Array.isArray(db.mt5PendingOrders)) db.mt5PendingOrders = [];
  const orderMap = new Map<string, any>();
  for (const o of body.orders) {
    orderMap.set(`${account.id}:${o.orderId}`, {
      accountId: account.id,
      userId: db.users?.[0]?.id,
      orderId: Number(o.orderId),
      symbol: String(o.symbol || '').toUpperCase(),
      type: String(o.type || ''),
      volume: o.volume,
      openPrice: o.openPrice,
      sl: o.sl ?? null,
      tp: o.tp ?? null,
      magic: o.magic ?? 0,
      state: String(o.state || ''),
      updatedAt: new Date().toISOString()
    });
  }
  db.mt5PendingOrders = db.mt5PendingOrders.filter((op: any) => op.accountId !== account.id);
  db.mt5PendingOrders.push(...orderMap.values());

  account.eaStatus = 'Connected';
  account.connectionStatus = 'Connected';
  account.lastHeartbeatAt = new Date().toISOString();

  logEaEvent(db, account, 'EA_ORDERS', 'info', `Pending orders snapshot: ${body.orders.length}`);
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, orders: body.orders.length });
});

// EA heartbeat: liveness + current balance/equity
app.post('/api/mt5/ea/heartbeat', ...eaProtection, async (req, res) => {
  const body = validateEaBody(res, EaHeartbeatSchema, req.body || {});
  if (!body) return;
  const auth = await authEaRequest(req, res, body.token);
  if (!auth) return;
  const { db, account } = auth;

  if (body.balance !== undefined) account.currentBalance = body.balance;
  if (body.equity !== undefined) account.equity = body.equity;
  if (body.tradeCount !== undefined) account.eaSyncTradeCount = body.tradeCount;
  account.eaStatus = 'Connected';
  account.connectionStatus = 'Connected';
  account.lastHeartbeatAt = new Date().toISOString();

  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true });
});

// EA error reporting (sanitized client-side errors)
app.post('/api/mt5/ea/error', ...eaProtection, async (req, res) => {
  const body = validateEaBody(res, EaErrorSchema, req.body || {});
  if (!body) return;
  const auth = await authEaRequest(req, res, body.token);
  if (!auth) return;
  const { db, account } = auth;

  if (!Array.isArray(db.mt5ConnectionErrors)) db.mt5ConnectionErrors = [];
  db.mt5ConnectionErrors.push({
    accountId: account.id,
    userId: db.users?.[0]?.id,
    errorCode: body.code || 'EA_ERROR',
    errorMessage: String(body.message || '').slice(0, 500),
    occurredAt: new Date().toISOString(),
    resolvedAt: null
  });
  if (db.mt5ConnectionErrors.length > 1000) db.mt5ConnectionErrors = db.mt5ConnectionErrors.slice(-1000);
  account.connectionStatus = 'Error';

  logEaEvent(db, account, 'EA_ERROR', 'error', `${body.code || 'EA_ERROR'}: ${String(body.message || '').slice(0, 200)}`);
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true });
});

// Shared MT5 sync pipeline used by BOTH the EA (/api/mt5/ea/sync) and the
// MetaApi cloud worker. Merges deals, applies money flows, recomputes journal
// trades, and updates account balance/equity from the authoritative payload.
function applyEaSyncPayload(db: any, acc: any, deals: any[], moneyFlows: any[], account: any) {
  const userId = db.users?.[0]?.id;
  const accountId = String(acc.id);

  // 1. Merge new deals (dedupe by ticket within this account) into both the
  //    legacy flat stream and the account-scoped mt5_deals_v2 stream
  if (!Array.isArray(db.mt5Deals)) db.mt5Deals = [];
  const seen = new Set<number>(
    db.mt5Deals.filter((d: any) => d.accountId === accountId).map((d: any) => d.ticket)
  );
  let added = 0;
  let maxTicket = acc.eaLastDealId || 0;
  for (const raw of deals) {
    const d = normalizeDeal(raw);
    if (!d.ticket) continue;
    if (!seen.has(d.ticket)) {
      addEaDeal(db, acc, d, userId);
      seen.add(d.ticket);
      added++;
    }
    if (d.ticket > maxTicket) maxTicket = d.ticket;
  }

  // 1b. Money flows (deposits / withdrawals / credit) — deduped by (account, ticket)
  let moneyFlowAdded = 0;
  if (Array.isArray(moneyFlows)) {
    if (!Array.isArray(db.mt5MoneyFlows)) db.mt5MoneyFlows = [];
    for (const mf of moneyFlows) {
      const ticket = Number(mf.ticket);
      if (!ticket) continue;
      if (!db.mt5MoneyFlows.some((f: any) => f.accountId === acc.id && f.ticket === ticket)) {
        db.mt5MoneyFlows.push({
          accountId: acc.id,
          userId,
          ticket,
          flowType: mf.type,
          amount: Number(mf.amount) || 0,
          currency: mf.currency || acc.currency || null,
          time: new Date(Number(mf.time) * 1000).toISOString()
        });
        moneyFlowAdded++;
      }
    }
    if (db.mt5MoneyFlows.length > 20000) db.mt5MoneyFlows = db.mt5MoneyFlows.slice(-20000);
  }

  // 2. Recompute journal trades from the full deal stream and upsert
  const accountDeals = db.mt5Deals.filter((d: any) => d.accountId === accountId);

  // 2a. MT5 sync accounts: the FIRST deposit recorded in the account history is
  //     the Initial Balance. It is set once (while starting balance is still 0) so
  //     manually entered balances are preserved, and it is excluded from the journal
  //     trades because it is already represented by the starting balance.
  let skipBalanceTicket: number | undefined;
  if (acc.isMt5Sync) {
    const deposits = accountDeals
      .filter((d: any) => d.type === DEAL_TYPE_BALANCE && (d.profit || 0) > 0)
      .sort((a: any, b: any) => a.time - b.time);
    if (deposits.length > 0) {
      skipBalanceTicket = deposits[0].ticket;
      if (!acc.startingBalance || acc.startingBalance === 0) {
        acc.startingBalance = parseFloat(deposits[0].profit.toFixed(2));
      }
    }
  }

  const recomputed = recomputeMt5TradesForAccount(acc, accountDeals, skipBalanceTicket);
  const existingById = new Map(
    db.trades
      .filter((t: any) => t.accountId === accountId && t.eaDealId !== undefined)
      .map((t: any) => [t.id, t])
  );
  let inserted = 0;
  let updated = 0;
  for (const tr of recomputed) {
    const prev = existingById.get(tr.id);
    if (prev) {
      Object.assign(prev, tr);
      updated++;
    } else {
      db.trades.push(tr);
      inserted++;
    }
  }
  // 2b. Drop stale MT5-synced trades no longer produced by the recomputation
  //     (e.g. the initial deposit once it is folded into the starting balance).
  const recomputedIds = new Set(recomputed.map((t: any) => t.id));
  db.trades = db.trades.filter((t: any) => {
    if (t.accountId === accountId && t.eaDealId !== undefined && !recomputedIds.has(t.id)) return false;
    return true;
  });

  // 3. Update account balance/equity from the authoritative MT5 payload
  if (account && typeof account === 'object') {
    if (account.balance !== undefined) acc.currentBalance = parseFloat(account.balance) || acc.currentBalance;
    if (account.equity !== undefined) acc.equity = parseFloat(account.equity) || acc.equity;
    if (account.currency !== undefined && account.currency) acc.currency = String(account.currency);
  }

  acc.eaStatus = 'Connected';
  acc.connectionStatus = 'Connected';
  acc.eaConnectedAt = acc.eaConnectedAt || new Date().toISOString();
  acc.eaLastSyncTime = new Date().toISOString();
  acc.lastHeartbeatAt = new Date().toISOString();
  acc.eaLastDealId = maxTicket;
  acc.eaSyncTradeCount = db.trades.filter(
    (t: any) => t.accountId === accountId && t.type !== 'Deposit' && t.type !== 'Withdrawal'
  ).length;

  return { inserted, updated, added, moneyFlowAdded, maxTicket };
}

// EA sync: receives a batch of closed deals + money flows + account info,
// recomputes trades, upserts the account-scoped deal stream and money flows.
app.post('/api/mt5/ea/sync', ...eaProtection, async (req, res) => {
  const body = validateEaBody(res, EaSyncSchema, req.body || {});
  if (!body) return;
  const auth = await authEaRequest(req, res, body.token);
  if (!auth) return;
  const { db, account: acc } = auth;
  const { deals, moneyFlows, account } = body;
  const summary = applyEaSyncPayload(db, acc, deals, moneyFlows, account);

  logEaEvent(db, acc, 'EA_SYNC', 'info', `Deals: ${summary.added} new / ${deals.length} received; money flows: ${summary.moneyFlowAdded} new`);
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, inserted: summary.inserted, updated: summary.updated, totalTrades: acc.eaSyncTradeCount, cursor: summary.maxTicket, status: acc.eaStatus });
});

// User-facing connection status for an MT5 portfolio account
app.get('/api/mt5/:accountId/status', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });

  const account = db.accounts.find((a: any) => a.id === req.params.accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: 'Access denied' });

  const openPositions = Array.isArray(db.mt5OpenPositions)
    ? db.mt5OpenPositions.filter((p: any) => p.accountId === account.id)
    : [];
  const pendingOrders = Array.isArray(db.mt5PendingOrders)
    ? db.mt5PendingOrders.filter((o: any) => o.accountId === account.id)
    : [];
  const moneyFlows = Array.isArray(db.mt5MoneyFlows)
    ? db.mt5MoneyFlows.filter((f: any) => f.accountId === account.id)
    : [];
  const lastErrors = Array.isArray(db.mt5ConnectionErrors)
    ? db.mt5ConnectionErrors.filter((e: any) => e.accountId === account.id).slice(-5)
    : [];
  const snapshots = Array.isArray(db.mt5Snapshots)
    ? db.mt5Snapshots.filter((s: any) => s.accountId === account.id).slice(-500)
    : [];
  const connectJobs = Array.isArray(db.mt5ConnectJobs)
    ? db.mt5ConnectJobs.filter((j: any) => j.accountId === account.id).slice(-5)
    : [];

  // Reconcile accounts stuck in Validating from a cloud connect that has no
  // broker worker configured (e.g. META_API_TOKEN missing).
  const workerConfigured = !!process.env.META_API_TOKEN?.trim();
  const cloudStuckValidating = account.syncMethod === 'CLOUD'
    && account.connectionStatus === 'Validating'
    && !workerConfigured;
  let connStatus = account.connectionStatus || account.eaStatus || 'Not Connected';
  let resolvedErrors = lastErrors;
  if (cloudStuckValidating) {
    connStatus = 'Error';
    const cloudUnavailable = {
      errorCode: 'CLOUD_WORKER_UNAVAILABLE',
      errorMessage: 'Cloud sync worker is not configured on this deployment (META_API_TOKEN missing). Use the EA method.',
      occurredAt: new Date().toISOString(),
      resolvedAt: null
    };
    resolvedErrors = [cloudUnavailable, ...lastErrors];
  }

  res.json({
    accountId: account.id,
    status: connStatus,
    eaStatus: account.eaStatus || 'Not Connected',
    syncMethod: account.syncMethod || 'EA',
    cloudConnected: !!account.investorPasswordEnc,
    workerConfigured,
    connectJobs,
    lastSyncTime: account.eaLastSyncTime || null,
    lastHeartbeatAt: account.lastHeartbeatAt || null,
    lastDealId: account.eaLastDealId || 0,
    syncTradeCount: account.eaSyncTradeCount || 0,
    startingBalance: account.startingBalance || 0,
    currentBalance: account.currentBalance || 0,
    equity: account.equity || 0,
    terminalLogin: account.eaTerminalLogin || account.mt5Login || null,
    terminalServer: account.eaTerminalServer || account.mt5Server || null,
    openPositions,
    pendingOrders,
    moneyFlows,
    lastErrors: resolvedErrors,
    snapshots
  });
});

// User-facing cloud connect: validate + encrypt the investor password and
// enqueue a CONNECT job for the cloud/VPS worker. The raw password is never
// stored — only the AES-256-GCM envelope. Fails closed if no master key is
// configured (no plaintext fallback).
// NOTE: registered before the /api/mt5/:accountId/... routes so `cloud` is
// never captured as an accountId.
app.post('/api/mt5/cloud/connect', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });
  if (!requirePro(req, res, 'mt5Sync')) return;

  const body = validateEaBody(res, CloudConnectSchema, req.body || {});
  if (!body) return;

  const account = db.accounts.find((a: any) => a.id === body.accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: 'Access denied' });

  // A cloud connect needs a broker worker (MetaApi token or VPS worker) to
  // actually reach MT5. Without one, fail fast instead of leaving the account
  // stuck in Validating.
  if (!process.env.META_API_TOKEN?.trim()) {
    return res.status(503).json({
      error: 'The cloud sync worker is not configured on this deployment yet (META_API_TOKEN is missing). Use the EA method, which needs no extra setup.',
      code: 'CLOUD_WORKER_UNAVAILABLE'
    });
  }

  const enc = encryptInvestorPassword(body.investorPassword);
  if (!enc) {
    return res.status(503).json({
      error: 'Cloud sync is not configured on this deployment yet. Use the EA method instead.',
      code: 'CLOUD_NOT_CONFIGURED'
    });
  }

  account.investorPasswordEnc = enc.enc;
  account.passwordEncNonce = '';
  account.passwordKmsKeyId = enc.keyId;
  account.mt5Login = body.login;
  account.mt5Server = body.server;
  account.syncMethod = 'CLOUD';
  account.connectionStatus = 'Validating';
  account.lastHeartbeatAt = undefined;
  account.eaStatus = 'Not Connected';

  const jobId = enqueueConnectJob(db, account, 'CONNECT');
  logEaEvent(db, account, 'CLOUD_CONNECT_REQUESTED', 'info', 'Cloud connect requested; investor password stored encrypted');
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, jobId, syncMethod: 'CLOUD', status: 'Validating' });
});

// User-facing cloud disconnect: remove the encrypted credential + enqueue DISCONNECT
app.post('/api/mt5/cloud/disconnect', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });

  const body = validateEaBody(res, CloudDisconnectSchema, req.body || {});
  if (!body) return;

  const account = db.accounts.find((a: any) => a.id === body.accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: 'Access denied' });

  clearInvestorPassword(account);
  account.syncMethod = 'EA';
  account.connectionStatus = 'Disconnected';
  account.lastHeartbeatAt = undefined;
  account.disconnectedAt = new Date().toISOString();

  enqueueConnectJob(db, account, 'DISCONNECT');
  logEaEvent(db, account, 'CLOUD_DISCONNECT', 'warn', 'Cloud sync disconnected; encrypted credentials removed');
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, status: 'Disconnected' });
});

// User-facing cloud sync: triggers an on-demand sync job for the investor password
app.post('/api/mt5/cloud/sync', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });
  if (!requirePro(req, res, 'mt5Sync')) return;

  const body = validateEaBody(res, CloudDisconnectSchema, req.body || {});
  if (!body) return;

  const account = db.accounts.find((a: any) => a.id === body.accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: 'Access denied' });

  if (account.syncMethod !== 'CLOUD') {
    return res.status(400).json({ error: 'Account is not configured for cloud sync' });
  }

  if (!account.investorPasswordEnc) {
    return res.status(400).json({ error: 'Cloud sync credentials not found. Please reconnect.' });
  }

  const jobId = enqueueConnectJob(db, account, 'SYNC_NOW');
  logEaEvent(db, account, 'CLOUD_SYNC_REQUESTED', 'info', 'Manual on-demand cloud sync requested');
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, jobId, status: 'Validating' });
});

// User-facing disconnect: revoke the EA token and mark the account disconnected
app.post('/api/mt5/:accountId/disconnect', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });

  const account = db.accounts.find((a: any) => a.id === req.params.accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: 'Access denied' });

  account.eaToken = undefined;
  account.eaStatus = 'Not Connected';
  account.connectionStatus = 'Disconnected';
  account.eaConnectedAt = undefined;
  account.lastHeartbeatAt = undefined;
  account.eaTokenRevokedAt = new Date().toISOString();
  account.disconnectedAt = new Date().toISOString();

  logEaEvent(db, account, 'EA_DISCONNECT', 'warn', 'User disconnected the MT5 sync');
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, status: 'Disconnected' });
});

// ==========================================
// REAL-TIME AI TRADING INSIGHTS ROUTE (GEMINI)
// ==========================================

app.post('/api/ai/mentor', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });

  if (!requirePro(req, res, 'aiMentor')) return;

  const { accountId, messages } = req.body;
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const targetAcc = db.accounts?.find((a: any) => a.id === accountId);
  const accountName = targetAcc ? targetAcc.name : 'Primary Portfolio';

  // Fetch trades
  const accountTrades = db.trades.filter((t: any) =>
    t.accountId === accountId &&
    t.type !== 'Deposit' &&
    t.type !== 'Withdrawal'
  );

  // Prepare a concise trading digest for Gemini API (latest 50 trades)
  const recentTrades = accountTrades.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 50);
  const digest = recentTrades.map((t: any) => ({
    date: t.date.split('T')[0],
    symbol: t.symbol,
    type: t.type,
    lots: t.lotSize,
    profit: t.profit,
    risk: t.riskPercentage,
    emotion: t.emotion,
    strategy: t.strategy
  }));

  const geminiKey = process.env.GEMINI_API_KEY;
  const userMessage = messages.length > 0 ? (messages[messages.length - 1]?.content || '') : '';
  const traderName = currentUser?.name ? currentUser.name.split(' ')[0] : 'Trader';

  const generateSmartMentorFallback = (msgText: string, trades: any[], accName: string) => {
    const msg = msgText.toLowerCase().trim();
    const totalTrades = trades.length;

    const wins = trades.filter((t: any) => (t.profit || 0) > 0);
    const losses = trades.filter((t: any) => (t.profit || 0) < 0);
    const totalProfit = trades.reduce((acc: number, t: any) => acc + (t.profit || 0), 0);
    const winRate = totalTrades > 0 ? ((wins.length / totalTrades) * 100).toFixed(1) : '0';
    const totalWinAmount = wins.reduce((acc: number, t: any) => acc + (t.profit || 0), 0);
    const totalLossAmount = Math.abs(losses.reduce((acc: number, t: any) => acc + (t.profit || 0), 0));
    const avgWin = wins.length > 0 ? (totalWinAmount / wins.length).toFixed(2) : '0.00';
    const avgLoss = losses.length > 0 ? (totalLossAmount / losses.length).toFixed(2) : '0.00';
    const profitFactor = totalLossAmount > 0 ? (totalWinAmount / totalLossAmount).toFixed(2) : (totalWinAmount > 0 ? 'Inf' : '1.0');
    const avgRisk = totalTrades > 0 ? (trades.reduce((acc: number, t: any) => acc + (t.riskPercentage || 1), 0) / totalTrades).toFixed(1) : '1.0';

    const symbolsCount: Record<string, number> = {};
    trades.forEach((t: any) => { if (t.symbol) symbolsCount[t.symbol] = (symbolsCount[t.symbol] || 0) + 1; });
    const topSymbol = Object.entries(symbolsCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    const emotionCount: Record<string, number> = {};
    trades.forEach((t: any) => { if (t.emotion) emotionCount[t.emotion] = (emotionCount[t.emotion] || 0) + 1; });
    const topEmotion = Object.entries(emotionCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Neutral';

    const revengeCount = trades.filter((t: any) => (t.emotion || '').toLowerCase().includes('revenge') || (t.tags || []).some((tag: string) => tag.toLowerCase().includes('revenge'))).length;
    const fomoCount = trades.filter((t: any) => (t.emotion || '').toLowerCase().includes('fomo') || (t.tags || []).some((tag: string) => tag.toLowerCase().includes('fomo'))).length;

    // ── Greeting check (Checked first so any "hy", "hi", "hello" gets a warm, friendly buddy response!) ──
    if (/^(hy|hi|hello|hey|greetings|hola|sup|good morning|good afternoon|good evening|yo)\b/i.test(msg)) {
      if (totalTrades === 0) {
        return `Hey ${traderName}! 👋 Really great to meet you! 😊\n\nI'm your personal AI Trading Mentor & Coach on FX Journal Pro. Think of me as your 24/7 trading companion, mindset buddy, and partner in the markets!\n\nWhether you want to chat about trading psychology, building iron discipline, managing risk, discussing setups, or just chatting about your trading goals — I'm right here with you.\n\nOnce you start logging trades in your journal, I'll also dive deep into your statistics to spot what's working and where we can level up together. How is your trading journey going so far? How are you feeling today? 🚀`;
      }
      return `Hey ${traderName}! 👋 Really wonderful to see you! 😊\n\n` +
        `How have your trading sessions been treating you lately? I'm always in your corner — whether you want to review your recent numbers, talk through a tricky setup, recalibrate your risk, or celebrate a disciplined win.\n\n` +
        `📊 Quick snapshot of **"${accName}"**:\n` +
        `• **P/L**: ${totalProfit >= 0 ? '+' : ''}$${totalProfit.toFixed(2)} ${totalProfit >= 0 ? '🟢' : '🔴'}\n` +
        `• **Win Rate**: ${winRate}% (${wins.length}W / ${losses.length}L)\n` +
        `• **Top Asset**: ${topSymbol}\n` +
        `• **Emotion**: ${topEmotion}\n\n` +
        `What's on your mind today? How can I help you level up? 🚀`;
    }

    if (totalTrades === 0) {
      return `Hey ${traderName}! 😊 I'm right here with you!\n\nI noticed you haven't logged any trades yet in **"${accName}"** — and that is 100% fine! Everyone starts from day one.\n\nWhile you prepare your next setups, feel free to ask me anything about risk management, trading psychology, handling emotions like fear or FOMO, or building a high-probability trading routine.\n\nOnce you log your first few trades, I'll start sharing deep personalized insights. What would you like to explore today? 💪`;
    }

    // ── Can I become profitable / success mindset ──
    if (/can i (be|become)|profitable trader|will i succeed|am i good|am i ready|is trading for me/.test(msg)) {
      const isCurrentlyProfitable = totalProfit > 0;
      return `### 🌟 Can You Become a Profitable Trader?\n\n` +
        `**Absolutely — yes, you can.** But it takes the right mindset and approach.\n\n` +
        (isCurrentlyProfitable
          ? `Looking at your data, you are **currently profitable** with a **+$${totalProfit.toFixed(2)} net P/L** across ${totalTrades} trades — that already puts you ahead of most retail traders!\n\n`
          : `Right now your account shows a **-$${Math.abs(totalProfit).toFixed(2)} net P/L** across ${totalTrades} trades. That's normal in the learning phase — most traders are unprofitable before they become consistently profitable.\n\n`) +
        `**What makes a profitable trader:**\n` +
        `1. **Consistency over perfection** — Aim to execute the same process every trade, not just win every trade.\n` +
        `2. **Risk management first** — Traders who blow accounts focus on profits. Profitable traders focus on survival.\n` +
        `3. **Journal everything** — You are already doing this! Reviewing your journal is your biggest edge.\n` +
        `4. **Patience** — Most traders become profitable after 12–24 months of intentional practice.\n\n` +
        `You have the tools. Keep building the habits. I believe in you. 💪`;
    }

    // ── Mental support / Losing streak ──
    if (/loss|losing streak|consecutive loss|bad day|bad week|not profitable|struggling|giving up|quit trading|sad|depressed|frustrated|angry|fail|failing/.test(msg)) {
      const recentLosses = trades.slice(-5).filter((t: any) => (t.profit || 0) < 0).length;
      return `### 💙 I'm Here For You — Mental Support\n\n` +
        `I hear you, and I want you to know that **every great trader has been exactly where you are right now.** Drawdowns and losing streaks are not a sign of failure — they are a part of the journey.\n\n` +
        (recentLosses >= 3 ? `Looking at your recent trades, you have had **${recentLosses} losses in your last 5 trades**. That's a real losing streak, and it's important to respond to it with discipline, not emotion.\n\n` : '') +
        `**What to do right now:**\n` +
        `1. **Stop trading today.** Seriously. Close the charts and step away. Continuing while emotional almost always makes it worse.\n` +
        `2. **Reduce your lot size by 50%** when you return. Rebuilding confidence with smaller risk is far more effective than trying to "win it back".\n` +
        `3. **Review your last 5 trades in your journal.** Were you following your rules? If not, the market is giving you feedback — listen to it.\n` +
        `4. **Remember why you started.** The goal is long-term consistency, not perfection this week.\n\n` +
        `You have not failed. You are in the training phase that every profitable trader goes through. Take a breath, rest today, and come back stronger tomorrow. 🙏`;
    }

    // ── Motivation / Inspiration ──
    if (/motivat|inspire|confidence|believe|encourage|keep going|don.t give up|not sure|doubt/.test(msg)) {
      return `### 🔥 You've Got This!\n\n` +
        `Trading is one of the hardest mental skills in the world, but you are taking it seriously by journaling and reviewing your trades — that alone puts you in the **top 5% of traders**.\n\n` +
        `Here are your personal stats to remind you of your progress:\n` +
        `• You have logged **${totalTrades} trades** — each one is a lesson.\n` +
        `• Your win rate is **${winRate}%** — ${parseFloat(winRate) >= 50 ? 'above average! Keep it up.' : 'there is room to grow, and that is exciting.'}\n` +
        `• Your most traded pair is **${topSymbol}** — you are specializing, which is smart.\n\n` +
        `**Daily Affirmations for Traders:**\n` +
        `• "I follow my rules, every single trade."\n` +
        `• "My job is to execute well, not to predict the market."\n` +
        `• "I am building a skill that will last a lifetime."\n\n` +
        `The traders who succeed are not the smartest — they are the most consistent. Keep showing up. 💪`;
    }

    // ── Strategy advice ──
    if (/strategy|setup|entry|confluence|timeframe|ema|sma|indicator|signal|trend|support|resistance|order block|supply|demand|breakout|scalp|swing|position/.test(msg)) {
      return `### 📈 Strategy & Trade Execution\n\n` +
        `Based on your journal, your most traded pair is **${topSymbol}** and your win rate is **${winRate}%**.\n\n` +
        `**General Strategy Principles:**\n` +
        `1. **Trade with the higher timeframe trend.** Identify the trend on H4/Daily, then drop to H1/M15 for entry.\n` +
        `2. **Wait for confluence.** The best setups have 2–3 reasons to enter: structure, key level, and a trigger candle.\n` +
        `3. **Only trade your A+ setups.** If you are unsure, do not enter. The market will give you another opportunity.\n` +
        `4. **Pre-plan your trades.** Before the session, mark your levels and write down what you are looking for.\n\n` +
        `**For your ${topSymbol} trades specifically:**\n` +
        `Focus on the London (07:00–10:00 GMT) and New York (13:00–16:00 GMT) sessions for the highest probability moves on currency and gold pairs.\n\n` +
        `Would you like me to analyze a specific strategy or review your recent trades in more detail?`;
    }

    // ── FOMO / Revenge trading ──
    if (/fomo|revenge|overtrad|impulsiv|chasing|miss|missed|regret/.test(msg)) {
      return `### 🧠 FOMO & Revenge Trading Control\n\n` +
        (fomoCount > 0 || revengeCount > 0
          ? `I can see from your journal that you have had **${fomoCount} FOMO trade${fomoCount !== 1 ? 's' : ''}** and **${revengeCount} revenge trade${revengeCount !== 1 ? 's' : ''}** logged. This is incredibly honest of you — recognizing these patterns is the first step.\n\n`
          : '') +
        `**The truth about FOMO and Revenge:**\n` +
        `These are the #1 account killers in retail trading. They feel urgent and justified in the moment but are almost always losers.\n\n` +
        `**How to break the cycle:**\n` +
        `1. **Set a "loss limit" rule.** If you lose 2 trades in a session, close the platform. Period.\n` +
        `2. **Use a pre-trade checklist.** Before every entry, ask: "Is this in my plan? Is this my setup?" If not, close the chart.\n` +
        `3. **Accept missed trades.** Remind yourself: "There will always be another setup tomorrow."\n` +
        `4. **Journal your emotions in real-time.** Even a one-word note — "FOMO" or "Calm" — creates awareness that rewires your behavior over time.\n\n` +
        `The market rewards patience. The impulse to chase is a signal to wait, not act.`;
    }

    // ── Risk management ──
    if (/risk|lot size|position size|drawdown|money management|capital|leverage|margin/.test(msg)) {
      return `### 🛡️ Risk Management Analysis for "${accName}"\n\n` +
        `• **Your Average Risk Per Trade**: ${avgRisk}%\n` +
        `• **Average Win vs Average Loss**: $${avgWin} vs $${avgLoss}\n` +
        `• **Profit Factor**: ${profitFactor}\n\n` +
        `**Risk Rules Every Profitable Trader Follows:**\n` +
        `1. **Risk 1% or less per trade.** At 1%, you can lose 20 trades in a row and still have 80% of your capital.\n` +
        `2. **Never move your stop loss against yourself.** If it gets hit, accept it and move on.\n` +
        `3. **Target a minimum 1:2 Risk-to-Reward.** Even with a 40% win rate, a 1:2 RR is profitable over time.\n` +
        `4. **Stop trading at your daily max loss** (e.g., 3%). Protect your capital above all else.\n\n` +
        (parseFloat(avgRisk) > 2 ? `⚠️ **Your average risk of ${avgRisk}% per trade is above the recommended 1–2%.** Consider reducing your lot sizes to protect your account during losing streaks.` : `✅ Your risk per trade looks controlled. Keep maintaining this discipline!`);
    }

    // ── Psychology / mindset / emotions / discipline ──
    if (/psychology|emotion|discipline|mindset|mental|patience|control|calm|anxiety|fear|greed/.test(msg)) {
      return `### 🧠 Trading Psychology & Emotional Control\n\n` +
        `Across your ${totalTrades} trades, your most recorded emotional state is **${topEmotion}**.\n\n` +
        `**The 5 Pillars of Trading Psychology:**\n` +
        `1. **Acceptance** — Accept that losses are inevitable and part of the process. Your goal is to control risk, not eliminate losses.\n` +
        `2. **Patience** — Wait for your setups. Most profitable traders only take 1–3 trades per day.\n` +
        `3. **Discipline** — Follow your rules even when you don't want to. That is where the edge lives.\n` +
        `4. **Detachment** — Detach your identity from individual trade outcomes. A loss does not make you a bad trader.\n` +
        `5. **Process Focus** — Judge yourself on execution quality, not just P&L.\n\n` +
        `**Daily Practices:**\n` +
        `• Before trading: Write your plan and set your max loss for the day.\n` +
        `• After trading: Journal every trade, including your emotion.\n` +
        `• Weekly: Review your journal. What patterns do you see?`;
    }

    // ── Performance / stats / analysis ──
    if (/win rate|stat|performance|analyz|summary|how am i doing|result|profit|my trades|my account|my journal/.test(msg)) {
      return `### 📊 Performance Analysis for "${accName}"\n\n` +
        `• **Total Trades Analyzed**: ${totalTrades}\n` +
        `• **Win Rate**: ${winRate}% (${wins.length} Wins, ${losses.length} Losses)\n` +
        `• **Net P/L**: ${totalProfit >= 0 ? '+' : ''}$${totalProfit.toFixed(2)}\n` +
        `• **Average Win**: $${avgWin} | **Average Loss**: $${avgLoss}\n` +
        `• **Profit Factor**: ${profitFactor}\n` +
        `• **Top Traded Pair**: ${topSymbol}\n` +
        `• **Dominant Emotion**: ${topEmotion}\n\n` +
        `**Mentor Insight**: ${parseFloat(winRate) >= 55 ? '🟢 Strong win rate! Your edge is working. Focus on maximizing your winners by not closing trades early.' : parseFloat(winRate) >= 45 ? '🟡 Your win rate is near breakeven. Focus on improving your entry quality and targeting higher reward-to-risk setups.' : '🔴 Your win rate needs attention. Review your entry rules — are you entering at high-probability zones, or chasing price?'}`;
    }

    // ── How to use the journal ──
    if (/how to use|how do i|journal|log|track|tag|note/.test(msg)) {
      return `### 📓 How to Get the Most Out of Your Journal\n\n` +
        `Your journal is your most powerful tool. Here is how to use it effectively:\n\n` +
        `1. **Log every trade** — Use the "Add New Trade" button after every position you take.\n` +
        `2. **Tag your emotion** — Choose how you felt (Calm, FOMO, Revenge, Excited). This data builds over time and reveals patterns.\n` +
        `3. **Add your strategy** — Note which setup triggered the entry (e.g., Order Block, EMA Cross, Breakout).\n` +
        `4. **Write a note** — Even one sentence like "entered too early" or "good execution" is valuable for review.\n` +
        `5. **Review weekly** — Ask me "analyze my stats" every week to track your progress.\n\n` +
        `The more data you log, the smarter and more personalized my coaching becomes for you!`;
    }

    // ── General catch-all fallback with variety ──
    const motivations = [
      "Trading is not about being right — it's about managing risk when you're wrong. Keep your losses small and let your winners breathe.",
      "Every expert was once a beginner. Every profitable trader has a journal full of mistakes. Your losses are not failures — they are lessons you paid for.",
      "The market does not owe you a profit. But if you respect your risk, follow your plan, and stay consistent, the edge will show up over time.",
      "Discipline is the bridge between where you are and where you want to be. Execute your plan one trade at a time.",
      "Patience is not waiting — it's knowing when the right opportunity appears. The best trades almost take themselves.",
      "Your emotional state is part of your trading edge. A calm mind sees setups clearly; an emotional mind sees what it wants to see.",
      "Focus on what you can control: your entries, your risk, your exits, and your attitude. The rest is up to the market."
    ];
    const randomMotivation = motivations[Math.floor(Math.random() * motivations.length)];

    return `**💡 Mentor Insight**: ${randomMotivation}\n\n` +
      `I'm here to support your full trading journey! You can ask me things like:\n` +
      `• *"Can I become a profitable trader?"*\n` +
      `• *"I'm in a losing streak, help me"*\n` +
      `• *"How is my risk management?"*\n` +
      `• *"Analyze my performance"*\n` +
      `• *"Give me psychology tips"*\n` +
      `• *"How do I control FOMO?"*\n\n` +
      `What's on your mind today?`;
  };

  if (!geminiKey || geminiKey === "MY_GEMINI_API_KEY") {
    // No model configured. The fallback is a scripted reply built from the
    // user's own numbers — useful, but it is not the AI mentor Pro is sold
    // on, and returning it unmarked reads as a real answer. The flag lets the
    // chat say so, the same way FX News labels its sample headlines.
    const fallbackReply = generateSmartMentorFallback(userMessage, accountTrades, accountName);
    return res.json({ reply: fallbackReply, fallback: true });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: geminiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    const systemInstruction = `You are ${traderName}'s personal trading mentor, coach, and companion on FX Journal Pro. Your name is "AI Mentor".

Personality & Vibe:
- Extremely warm, friendly, encouraging, and approachable — like a trusted mentor, brother, and trading companion who truly wants to see ${traderName} succeed!
- Always greet warmly and enthusiastically ("Hey ${traderName}! 👋 Really great to see you!", "Welcome back, my friend! 😊").
- Speak in a natural, conversational, and supportive first-person tone: "I'm right here with you", "Let's work through this together", "I'm proud of your discipline".
- Never sound robotic, cold, bureaucratic, or dismissive.
- If ${traderName} has 0 or few trades logged, warmly welcome them, reassure them that every great trader started with trade #1, and offer to chat about mindset, discipline, setups, or risk rules.
- When ${traderName} expresses fear, doubt, loss, or FOMO, lead with heartfelt empathy FIRST before offering constructive guidance.
- Celebrate small milestones and positive habits, not just profits.
- Use uplifting emojis naturally to bring warmth (👋, 😊, 🚀, 💪, 🎯, 📈, 🧘, 🙏).

Trader Profile:
- Name: ${traderName}
- Account: ${accountName}
- Total Trades Logged: ${accountTrades.length}

Trading History Digest (Last 50 trades):
${JSON.stringify(digest)}

RESTRICTIONS:
- ONLY discuss trading, trading psychology, risk management, discipline, emotional control, performance improvement, and journal insights.
- If asked about unrelated topics, kindly redirect: "That's outside my expertise as your trading mentor — but I'm always here to talk trading, mindset, and strategy!"
- NEVER promise profits or guarantee outcomes.
- NEVER be dismissive or harsh. Always be encouraging and constructive.`;

    const firstUserIdx = messages.findIndex((m: any) => m.role === 'user');
    const validMessages = firstUserIdx !== -1 ? messages.slice(firstUserIdx) : messages;

    const conversation = validMessages.map((msg: any) => ({
      role: msg.role === 'mentor' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: conversation,
      config: {
        systemInstruction
      }
    });

    const replyText = response.text || generateSmartMentorFallback(userMessage, accountTrades, accountName);

    res.json({ reply: replyText });

  } catch (err: any) {
    console.error('Gemini API Error, using smart mentor fallback:', err);
    const fallbackReply = generateSmartMentorFallback(userMessage, accountTrades, accountName);
    res.json({ reply: fallbackReply });
  }
});

// ==========================================
// SUPPORT TICKETS & ANNOUNCEMENTS ROUTES
// ==========================================

app.get('/api/tickets', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  if (!currentUser || !db) return res.json({ tickets: [] });

  const isAdmin = await checkIsAdmin(currentUser);
  // Admins see all tickets, regular users see their own
  if (isAdmin) {
    if (useSupabase) {
      try {
        const { data, error } = await supabase
          .from('support_tickets')
          .select('*')
          .order('date', { ascending: false });
        if (error) {
          console.error('[GET /api/tickets] Supabase error:', error);
          return res.status(500).json({ error: error.message });
        }
        const tickets = await attachTicketUserNames(data || []);
        return res.json({ tickets });
      } catch (e: any) {
        console.error('[GET /api/tickets] Admin query exception:', e);
        return res.status(500).json({ error: e?.message || 'Failed to load tickets' });
      }
    }
    const tickets = await attachTicketUserNames(collectAllInMemoryTickets());
    return res.json({ tickets });
  }

  const userTickets = (db.supportTickets || []).filter((t: any) => t.userId === currentUser?.id);
  res.json({ tickets: userTickets });
});

app.post('/api/tickets', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });
  const { title, description, category } = req.body;

  if (!title || !description) return res.status(400).json({ error: 'Title and description are required' });

  const newTicket: SupportTicket = {
    id: `ticket_${crypto.randomUUID()}`,
    userId: currentUser.id,
    userEmail: currentUser.email,
    userName: currentUser.name || '',
    title,
    description,
    status: 'Open',
    category: category || 'Support',
    date: new Date().toISOString()
  };

  db.supportTickets.push(newTicket);
  try {
    await saveDatabase(db);
  } catch (e: any) {
    console.error('[POST /api/tickets] Local persistence failed:', e?.message || e);
  }
  if (useSupabase) {
    const { error } = await supabase.from('support_tickets').insert({
      id: newTicket.id,
      user_id: currentUser.id,
      user_email: currentUser.email,
      title,
      description,
      status: 'Open',
      category: newTicket.category,
      date: newTicket.date
    });
    if (error) {
      console.error('[POST /api/tickets] Supabase insert failed:', error.message);
      return res.status(500).json({ error: 'Failed to save your submission. Please try again.' });
    }
  }
  res.json({ message: 'Support ticket submitted successfully', ticket: newTicket });
});

app.put('/api/tickets/:id', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });
  const { id } = req.params;
  const { status } = req.body;

  const isAdmin = await checkIsAdmin(currentUser);

  if (useSupabase) {
    // Without this ownership check any signed-in user could reopen or close
    // anyone else's ticket just by knowing (or guessing) its id.
    const { data: ticketRow, error: fetchErr } = await supabase
      .from('support_tickets')
      .select('id, user_id')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) {
      console.error('Error loading ticket from Supabase:', fetchErr);
      return res.status(500).json({ error: 'Failed to update ticket' });
    }
    if (!ticketRow) return res.status(404).json({ error: 'Ticket not found' });
    if (!isAdmin && ticketRow.user_id !== currentUser.id) {
      return res.status(403).json({ error: 'You can only update your own tickets.' });
    }
    const { error } = await supabase.from('support_tickets').update({ status: status || 'Closed' }).eq('id', id);
    if (error) {
      console.error("Error updating ticket in Supabase:", error);
      return res.status(500).json({ error: 'Failed to update ticket' });
    }
    return res.json({ message: 'Ticket status updated' });
  }

  const idx = db.supportTickets.findIndex((t: any) => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Ticket not found' });
  if (!isAdmin && db.supportTickets[idx].userId !== currentUser.id) {
    return res.status(403).json({ error: 'You can only update your own tickets.' });
  }
  db.supportTickets[idx].status = status || 'Closed';
  await saveDatabase(db);
  res.json({ message: 'Ticket status updated', ticket: db.supportTickets[idx] });
});

app.get('/api/announcements', async (req, res) => {
  // The `announcements` table has existed since the first schema, but this
  // route only ever read a per-user in-memory object that nothing populated,
  // so the list was always empty in production.
  if (useSupabase) {
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .order('date', { ascending: false })
      .limit(50);
    if (error) {
      console.error('[GET /api/announcements] Supabase error:', error);
      return res.status(500).json({ error: 'Failed to load announcements' });
    }
    return res.json({ announcements: (data || []).map(toCamel) });
  }
  const db = (req as any).userDb;
  res.json({ announcements: db?.announcements || [] });
});

// ==========================================
// BILLING — RAZORPAY SUBSCRIPTIONS
//
// The previous implementation created a ONE-TIME order while the pricing page
// advertised monthly billing: a customer paid once and kept Pro forever.
//
// Two rules here matter more than the rest:
//   1. The WEBHOOK is the source of truth, not the browser callback. A client
//      can close the tab, lose connection, or replay a stale response; the
//      webhook is signed by Razorpay and arrives regardless.
//   2. Pro access is derived from `pro_until`, not a boolean. A boolean with
//      no expiry cannot represent a cancelled or lapsed subscription.
// ==========================================

const PRO_PLAN_AMOUNT_PAISE = 49900; // ₹499/month

/**
 * What the platform keeps from every referred subscription, in rupees.
 *
 * A partner sets a student offer price between this floor and the standard
 * ₹499, and earns the difference — the rule the Partner Portal states as
 * "Student Pays − ₹199". It was written as a bare 199 in four places,
 * including the admin income report, so a change would have had to be found
 * in all of them.
 */
const PARTNER_PLATFORM_FLOOR_INR = 199;

/**
 * Whether the shortcuts that hand out Pro without a real payment may run.
 *
 * These exist so the upgrade flow can be exercised before Razorpay keys are
 * issued, but each of them is a one-POST "make me Pro" button for any logged-in
 * account, so they are off unless explicitly switched on, and can never be on
 * in production.
 */
const allowTestBilling = () =>
  IS_DEV && process.env.ALLOW_TEST_BILLING === 'true';
const RAZORPAY_API = 'https://api.razorpay.com/v1';

const razorpayAuth = () => {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret, header: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64') };
};

const razorpayFetch = async (path: string, init: any = {}) => {
  const auth = razorpayAuth();
  if (!auth) throw new Error('RAZORPAY_NOT_CONFIGURED');
  const res = await fetch(RAZORPAY_API + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: auth.header, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[razorpay] ${path} failed:`, body);
    throw new Error(body?.error?.description || 'Razorpay request failed');
  }
  return body;
};

/** Grants or revokes Pro by writing an expiry, and mirrors it to the fast flag. */
/**
 * Current pro_until for a user, in epoch ms, or null.
 *
 * Used when extending a plan from a webhook, where there is no session to
 * read it off: topping up a still-active plan must add to the existing
 * expiry rather than reset it to 30 days from now.
 */
const readProUntil = async (userId: string): Promise<number | null> => {
  try {
    if (useSupabase) {
      const { data } = await supabase.from('users').select('pro_until').eq('id', userId).maybeSingle();
      const raw = data?.pro_until;
      return raw ? new Date(raw).getTime() : null;
    }
    const row = localFindUser((u: any) => u.id === userId);
    const raw = row?.proUntil ?? row?.pro_until ?? null;
    return raw ? new Date(raw).getTime() : null;
  } catch {
    return null;
  }
};

const applyProState = async (userId: string, proUntil: Date | null) => {
  const isPro = !!proUntil && proUntil.getTime() > Date.now();
  if (useSupabase) {
    await supabase.from('users').update({
      is_pro: isPro,
      pro_until: proUntil ? proUntil.toISOString() : null,
      plan: isPro ? 'pro' : 'free',
    }).eq('id', userId);
    // Force the next request to reload rather than serve a stale cached plan.
    userDatabases.delete(userId);
    return;
  }

  // Local mode has no reload to force: a user's data lives in the in-memory
  // cache (and, for seeded accounts, db.json). Dropping the cache would throw
  // away their accounts and trades, so update every copy in place instead.
  // Without this an admin's grant only ever touched the admin's own copy.
  const patch = (row: any) => {
    row.isPro = isPro;
    row.proUntil = proUntil ? proUntil.toISOString() : null;
    row.plan = isPro ? 'pro' : 'free';
  };

  for (const cached of userDatabases.values()) {
    const row = (cached?.users || []).find((u: any) => u.id === userId);
    if (row) patch(row);
  }

  try {
    const shared = loadDatabaseFromFile();
    const row = (shared.users || []).find((u: any) => u.id === userId);
    if (row) {
      patch(row);
      fs.writeFileSync(DB_FILE, JSON.stringify(shared, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('[applyProState] local write failed:', err);
  }
};

app.get('/api/payments/config', (req, res) => {
  const auth = razorpayAuth();
  const configured = !!auth;
  res.json({
    configured,
    // Only true on a dev box with ALLOW_TEST_BILLING=true. The client uses it
    // to decide whether to show the test-tier switch at all.
    testBilling: allowTestBilling(),
    sandboxMode: !configured && allowTestBilling(),
    keyId: auth?.keyId || 'rzp_test_sandbox_mode',
    amount: PRO_PLAN_AMOUNT_PAISE,
    amountRupees: 499,
    currency: 'INR',
    merchantName: 'FX Journal Pro',
  });
});

/** Creates a Razorpay Order for one-time Pro payment (30 days access). */
app.post(['/api/payments/order', '/api/payments/create-order'], async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });

  let orderAmountPaise = PRO_PLAN_AMOUNT_PAISE; // 49900
  let appliedOfferPrice = 499;
  const couponCode = String(req.body?.couponCode || '').trim();
  let partner = null;
  if (couponCode) {
    partner = await findPartnerByCode(couponCode);
    if (partner && partner.isActive !== false) {
      // Clamped between 199 and 499
      appliedOfferPrice = Math.min(499, Math.max(PARTNER_PLATFORM_FLOOR_INR, Number(partner.offerPrice) || 499));
      orderAmountPaise = appliedOfferPrice * 100;
      await linkReferral(req, currentUser.id, couponCode);
    }
  }

  const mentorCommission = partner ? Math.max(0, appliedOfferPrice - PARTNER_PLATFORM_FLOOR_INR) : 0;

  const auth = razorpayAuth();
  if (!auth) {
    if (!allowTestBilling()) {
      console.error('[payments/order] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.');
      return res.status(503).json({
        error: 'Payments are not configured yet. Please try again shortly.',
      });
    }
    // Sandbox fallback only with ALLOW_TEST_BILLING=true
    return res.json({
      sandboxMode: true,
      keyId: 'rzp_test_sandbox',
      orderId: `order_test_${currentUser.id.slice(-6)}_${Date.now()}`,
      amount: orderAmountPaise,
      amountRupees: appliedOfferPrice,
      originalPrice: 499,
      mentorCommission,
      discountApplied: !!partner && appliedOfferPrice < 499,
      couponCode: partner?.code || null,
      currency: 'INR',
      message: partner ? `Mentor offer applied: ₹${appliedOfferPrice} (Regular ₹499)` : 'Razorpay running in test/sandbox mode.',
    });
  }

  try {
    const order = await razorpayFetch('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: orderAmountPaise,
        currency: 'INR',
        receipt: `rcpt_${currentUser.id.slice(0, 8)}_${Date.now().toString(36)}`,
        notes: {
          userId: currentUser.id,
          email: currentUser.email || '',
          plan: 'pro',
          periodDays: '30',
          couponCode: partner?.code || '',
          partnerId: partner?.userId || '',
          offerPrice: String(appliedOfferPrice),
          mentorCommission: String(mentorCommission),
        },
      }),
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      amountRupees: appliedOfferPrice,
      originalPrice: 499,
      mentorCommission,
      discountApplied: !!partner && appliedOfferPrice < 499,
      couponCode: partner?.code || null,
      currency: order.currency,
      keyId: auth.keyId,
    });
  } catch (err: any) {
    console.error('[payments/order]', err?.message || err);
    res.status(502).json({ error: 'Could not initiate Razorpay order. Please try again.' });
  }
});

/** Starts a monthly subscription and hands the id to Razorpay Checkout. */
app.post('/api/payments/subscribe', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });

  const planId = process.env.RAZORPAY_PLAN_ID?.trim();
  const auth = razorpayAuth();
  if (!auth || !planId) {
    if (!allowTestBilling()) {
      // The customer sees the same sentence either way; the log says which of
      // the two it was, because "not configured" covered both a missing key
      // pair and a missing plan id and they need different fixes.
      console.error(auth
        ? '[payments/subscribe] RAZORPAY_PLAN_ID is not set — run `npm run razorpay:check`.'
        : '[payments/subscribe] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.');
      return res.status(503).json({
        error: 'Payments are not configured yet. Please try again shortly.',
      });
    }
    // Sandbox only, and only with ALLOW_TEST_BILLING=true.
    return res.json({
      sandboxMode: true,
      keyId: 'rzp_test_sandbox',
      subscriptionId: `sub_test_${currentUser.id.slice(-6)}_${Date.now()}`,
      message: 'Razorpay running in test/sandbox mode.',
    });
  }

  try {
    // Reuse an in-flight subscription instead of creating a duplicate when
    // someone clicks upgrade twice.
    if (useSupabase) {
      const { data: existing } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', currentUser.id)
        .in('status', ['created', 'authenticated', 'active', 'pending'])
        .maybeSingle();
      if (existing?.provider_subscription_id && existing.status !== 'active') {
        return res.json({ subscriptionId: existing.provider_subscription_id, keyId: auth.keyId, reused: true });
      }
      if (existing?.status === 'active') {
        return res.status(409).json({ error: 'You already have an active Pro subscription.' });
      }
    }

    const subscription = await razorpayFetch('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        plan_id: planId,
        customer_notify: 1,
        total_count: 120, // ten years of monthly cycles; cancellation ends it
        notes: { userId: currentUser.id, email: currentUser.email },
      }),
    });

    if (useSupabase) {
      await supabase.from('subscriptions').insert({
        id: `sub_${crypto.randomUUID()}`,
        user_id: currentUser.id,
        provider: 'razorpay',
        provider_subscription_id: subscription.id,
        plan: 'pro',
        status: subscription.status || 'created',
      });
    }

    res.json({ subscriptionId: subscription.id, keyId: auth.keyId });
  } catch (err: any) {
    console.error('[payments/subscribe]', err?.message || err);
    res.status(502).json({ error: 'Could not start the subscription. Please try again.' });
  }
});

/** Test Mode Toggle: Quickly switch between Pro and Free during evaluation */
app.post('/api/payments/toggle-test-tier', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });
  if (!allowTestBilling()) return res.status(404).json({ error: 'Not found' });

  const targetTier = req.body?.tier === 'pro' ? 'pro' : 'free';
  const isPro = targetTier === 'pro';
  const proUntil = isPro ? new Date(Date.now() + 30 * 86400000) : null;

  await applyProState(currentUser.id, proUntil);
  const db = (req as any).userDb;
  if (db && Array.isArray(db.users)) {
    const u = db.users.find((x: any) => x.id === currentUser.id);
    if (u) {
      u.isPro = isPro;
      u.proUntil = proUntil ? proUntil.toISOString() : null;
      await saveDatabase(db);
    }
  }

  res.json({
    success: true,
    isPro,
    proUntil: proUntil ? proUntil.toISOString() : null,
    message: isPro ? 'Activated Pro Mode! All features unlocked.' : 'Switched to Free Tier.',
  });
});

/**
 * Razorpay webhook. Verified against req.rawBody — the exact bytes Razorpay
 * sent — because the signature is computed over those bytes, and re-serialising
 * the parsed JSON would change them.
 */
app.post('/api/payments/webhook', async (req: any, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error('[webhook] RAZORPAY_WEBHOOK_SECRET is not set — rejecting.');
    return res.status(503).end();
  }

  // The global express.json() middleware already consumed the stream, but its
  // verify hook stashed the exact bytes on req.rawBody. Re-serialising the
  // parsed object would reorder keys and the signature would never match.
  const signature = req.headers['x-razorpay-signature'];
  const raw: string = typeof req.rawBody === 'string' ? req.rawBody : '';
  if (!raw) {
    console.error('[webhook] raw body unavailable — cannot verify signature.');
    return res.status(400).end();
  }
  const expected = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  if (!signature || !safeTokenEqual(expected, String(signature))) {
    console.warn('[webhook] signature mismatch — ignoring.');
    return res.status(400).end();
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).end();
  }

  // Acknowledge fast. Razorpay retries on non-2xx, and a slow handler causes
  // duplicate deliveries.
  res.status(200).json({ received: true });

  try {
    const type = event.event as string;
    const sub = event.payload?.subscription?.entity;
    const payment = event.payload?.payment?.entity;
    const providerSubId = sub?.id || payment?.subscription_id;

    // ── One-time order payments ──────────────────────────────────────────
    //
    // Checkout in this product creates an order, not a subscription, so a
    // successful payment arrives here as payment.captured with no
    // subscription_id — and the guard below used to return immediately on
    // that, which meant the webhook did nothing for the only kind of payment
    // the app actually takes.
    //
    // The happy path does not need this: the browser posts to
    // /api/payments/verify and Pro is granted from the HMAC. This covers the
    // case where the money is taken and the browser never comes back — the
    // tab is closed on the Razorpay screen, the phone loses signal, the app
    // is killed. Without it that customer is charged and left on Free, with
    // nothing to recover it but a support ticket.
    if (!providerSubId) {
      if (type !== 'payment.captured' && type !== 'order.paid') return;
      const payUserId = payment?.notes?.userId || event.payload?.order?.entity?.notes?.userId;
      const payId = payment?.id;
      if (!payUserId || !payId) {
        console.warn('[webhook] one-time payment with no userId in notes:', payId);
        return;
      }

      // /verify records the same provider_payment_id, so if the browser got
      // back first this is a duplicate and must not extend Pro a second time.
      if (useSupabase) {
        const { data: seen } = await supabase
          .from('payments').select('id').eq('provider_payment_id', payId).maybeSingle();
        if (seen) {
          console.log('[webhook] payment already recorded, skipping:', payId);
          return;
        }
      } else {
        const local = loadDatabaseFromFile();
        if ((local.payments || []).some((x: any) => x.providerPaymentId === payId)) {
          console.log('[webhook] payment already recorded, skipping:', payId);
          return;
        }
      }

      const existingUntil = await readProUntil(payUserId);
      const base = existingUntil && existingUntil > Date.now() ? existingUntil : Date.now();
      const until = new Date(base + 30 * 86400000);
      await applyProState(payUserId, until);

      if (useSupabase) {
        await supabase.from('payments').upsert({
          id: `pay_${crypto.randomUUID()}`,
          user_id: payUserId,
          provider: 'razorpay',
          provider_payment_id: payId,
          amount: (payment.amount || PRO_PLAN_AMOUNT_PAISE) / 100,
          currency: payment.currency || 'INR',
          plan: 'pro',
          status: payment.status || 'captured',
          paid_at: new Date().toISOString(),
        }, { onConflict: 'provider_payment_id' });
      }
      console.log(`[webhook] ${type} — Pro until ${until.toISOString()} for ${payUserId} (order path)`);
      return;
    }

    if (!useSupabase) return;

    const { data: row } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('provider_subscription_id', providerSubId)
      .maybeSingle();
    if (!row) {
      console.warn('[webhook] no local subscription for', providerSubId);
      return;
    }

    const periodEnd = sub?.current_end ? new Date(sub.current_end * 1000) : null;

    switch (type) {
      case 'subscription.activated':
      case 'subscription.charged': {
        // Razorpay sends current_end in seconds; fall back to +1 month so a
        // paid customer is never left without access because a field moved.
        const until = periodEnd || new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
        await supabase.from('subscriptions').update({
          status: 'active',
          current_period_end: until.toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        await applyProState(row.user_id, until);

        if (payment?.id) {
          // Keyed on the provider payment id, so a retried webhook cannot
          // record the same charge twice.
          await supabase.from('payments').upsert({
            id: `pay_${crypto.randomUUID()}`,
            user_id: row.user_id,
            subscription_id: row.id,
            provider: 'razorpay',
            provider_payment_id: payment.id,
            amount: (payment.amount || PRO_PLAN_AMOUNT_PAISE) / 100,
            currency: payment.currency || 'INR',
            plan: 'pro',
            status: payment.status || 'captured',
            paid_at: new Date().toISOString(),
          }, { onConflict: 'provider_payment_id' });
        }
        console.log(`[webhook] ${type} — Pro until ${until.toISOString()} for ${row.user_id}`);
        break;
      }

      case 'subscription.cancelled':
      case 'subscription.completed':
      case 'subscription.expired': {
        await supabase.from('subscriptions').update({
          status: type.split('.')[1],
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        // Access runs to the end of the period already paid for.
        const until = row.current_period_end ? new Date(row.current_period_end) : null;
        await applyProState(row.user_id, until);
        break;
      }

      case 'subscription.halted':
      case 'subscription.pending': {
        // Payment is failing. Keep access until the paid period ends; Razorpay
        // retries, and cutting a customer off mid-cycle is wrong.
        await supabase.from('subscriptions').update({
          status: type.split('.')[1],
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        break;
      }

      default:
        break;
    }
  } catch (err: any) {
    console.error('[webhook] handler error:', err?.message || err);
  }
});

/** Called by the browser after checkout closes — a hint, never the authority. */
app.post('/api/payments/verify', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });

  if (req.body?.isSandbox) {
    // The browser asking for Pro is not evidence of payment.
    if (!allowTestBilling()) {
      return res.status(400).json({ error: 'Payment verification failed.' });
    }
    const proUntil = new Date(Date.now() + 30 * 86400000);
    await applyProState(currentUser.id, proUntil);
    const db = (req as any).userDb;
    const u = db?.users?.find((x: any) => x.id === currentUser.id);
    if (u) {
      u.isPro = true;
      u.proUntil = proUntil.toISOString();
      await saveDatabase(db);
    }
    return res.json({
      success: true,
      active: true,
      message: 'Sandbox Upgrade Complete! Welcome to Pro.'
    });
  }

  const {
    razorpay_order_id,
    razorpay_subscription_id,
    razorpay_payment_id,
    razorpay_signature,
  } = req.body || {};

  const auth = razorpayAuth();
  if (!auth) return res.status(503).json({ error: 'Payments are not configured yet.' });
  if (!razorpay_payment_id || !razorpay_signature || (!razorpay_order_id && !razorpay_subscription_id)) {
    return res.status(400).json({ error: 'Incomplete payment confirmation.' });
  }

  // 1. One-Time Order Verification (razorpay_order_id | razorpay_payment_id)
  if (razorpay_order_id) {
    const expected = crypto
      .createHmac('sha256', auth.keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (!safeTokenEqual(expected, String(razorpay_signature))) {
      console.warn(`[payments/verify] order signature mismatch for user ${currentUser.id}`);
      return res.status(400).json({ error: 'Payment verification failed.' });
    }

    // Pro is granted for 30 days. If currently active, extend from existing expiry date.
    const currentProUntil = currentUser.proUntil ? new Date(currentUser.proUntil).getTime() : 0;
    const baseTime = currentProUntil > Date.now() ? currentProUntil : Date.now();
    const proUntil = new Date(baseTime + 30 * 86400000);

    await applyProState(currentUser.id, proUntil);

    if (useSupabase) {
      await supabase.from('payments').upsert({
        id: `pay_${crypto.randomUUID()}`,
        user_id: currentUser.id,
        provider: 'razorpay',
        provider_payment_id: razorpay_payment_id,
        amount: PRO_PLAN_AMOUNT_PAISE / 100,
        currency: 'INR',
        plan: 'pro',
        status: 'captured',
        paid_at: new Date().toISOString(),
      }, { onConflict: 'provider_payment_id' });
    }

    const db = (req as any).userDb;
    if (db && Array.isArray(db.users)) {
      const u = db.users.find((x: any) => x.id === currentUser.id);
      if (u) {
        u.isPro = true;
        u.proUntil = proUntil.toISOString();
        db.payments = db.payments || [];
        db.payments.unshift({
          id: `pay_${Date.now()}`,
          userId: currentUser.id,
          userEmail: currentUser.email,
          provider: 'razorpay',
          providerPaymentId: razorpay_payment_id,
          amount: PRO_PLAN_AMOUNT_PAISE / 100,
          currency: 'INR',
          plan: 'pro',
          status: 'captured',
          paidAt: new Date().toISOString(),
        });
        await saveDatabase(db);
      }
    }

    return res.json({
      success: true,
      active: true,
      proUntil: proUntil.toISOString(),
      message: 'Payment verified successfully! Welcome to Pro (30 days access).',
    });
  }

  // 2. Subscription Verification (razorpay_payment_id | razorpay_subscription_id)
  const expected = crypto
    .createHmac('sha256', auth.keySecret)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest('hex');

  if (!safeTokenEqual(expected, String(razorpay_signature))) {
    console.warn(`[payments/verify] signature mismatch for user ${currentUser.id}`);
    return res.status(400).json({ error: 'Payment verification failed.' });
  }

  // Immediate Pro activation upon verified signature
  const proUntil = new Date(Date.now() + 31 * 86400000);
  await applyProState(currentUser.id, proUntil);

  let active = true;
  if (useSupabase) {
    await supabase.from('subscriptions').update({
      status: 'active',
      current_period_end: proUntil.toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('provider_subscription_id', razorpay_subscription_id);

    await supabase.from('payments').upsert({
      id: `pay_${crypto.randomUUID()}`,
      user_id: currentUser.id,
      provider: 'razorpay',
      provider_payment_id: razorpay_payment_id,
      amount: PRO_PLAN_AMOUNT_PAISE / 100,
      currency: 'INR',
      plan: 'pro',
      status: 'captured',
      paid_at: new Date().toISOString(),
    }, { onConflict: 'provider_payment_id' });
  }

  const db = (req as any).userDb;
  if (db && Array.isArray(db.users)) {
    const u = db.users.find((x: any) => x.id === currentUser.id);
    if (u) {
      u.isPro = true;
      u.proUntil = proUntil.toISOString();
      await saveDatabase(db);
    }
  }

  res.json({
    success: true,
    active,
    proUntil: proUntil.toISOString(),
    message: 'Payment received. Welcome to Pro!',
  });
});

app.post('/api/payments/cancel', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });
  if (!useSupabase) return res.status(503).json({ error: 'Billing requires the database.' });

  const { data: row } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', currentUser.id)
    .in('status', ['active', 'authenticated', 'pending', 'halted'])
    .maybeSingle();
  if (!row?.provider_subscription_id) {
    return res.status(404).json({ error: 'No active subscription to cancel.' });
  }

  try {
    // cancel_at_cycle_end: the customer keeps what they paid for.
    await razorpayFetch(`/subscriptions/${row.provider_subscription_id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ cancel_at_cycle_end: 1 }),
    });
    await supabase.from('subscriptions').update({
      cancel_at_period_end: true,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id);

    res.json({
      message: row.current_period_end
        ? `Cancelled. Pro stays active until ${new Date(row.current_period_end).toLocaleDateString()}.`
        : 'Cancelled. Pro stays active until the end of your paid period.',
    });
  } catch (err: any) {
    console.error('[payments/cancel]', err?.message || err);
    res.status(502).json({ error: 'Could not cancel the subscription. Please contact support.' });
  }
});

app.get('/api/payments/subscription', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });
  if (!useSupabase) return res.json({ subscription: null, payments: [] });

  const [{ data: sub }, { data: payments }] = await Promise.all([
    supabase.from('subscriptions').select('*').eq('user_id', currentUser.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('payments').select('*').eq('user_id', currentUser.id)
      .order('paid_at', { ascending: false }).limit(24),
  ]);

  res.json({
    subscription: sub ? toCamel(sub) : null,
    payments: (payments || []).map(toCamel),
  });
});

// ==========================================
// ADMIN DASHBOARD ROUTES
// ==========================================

// ==========================================
// ROLE-BASED ADMIN ACCESS
//
// Previously SUPER_ADMIN and ADMIN were identical and every admin route did
// the same all-or-nothing check, so there was no way to give a support person
// access to tickets without also handing them user management and billing.
//
// Permissions are named capabilities, not roles, so a route says what it
// needs and the role table decides who has it.
// ==========================================

type AdminPermission =
  | 'users.read' | 'users.manage' | 'users.roles'
  | 'tickets.read' | 'tickets.manage'
  | 'announcements.manage'
  | 'billing.read'
  | 'audit.read'
  | 'dashboard.read'
  // Read the sub-admin console for the users assigned to you.
  | 'assigned.read'
  // Create sub-admins and decide which users each one can see.
  | 'subadmin.assign'
  // Read and edit your own partner profile (referral code, link, network).
  | 'partner.self'
  // Promote a user to PARTNER and manage partner profiles.
  | 'partner.manage';

const ROLE_PERMISSIONS: Record<string, AdminPermission[]> = {
  SUPER_ADMIN: [
    'users.read', 'users.manage', 'users.roles',
    'tickets.read', 'tickets.manage',
    'announcements.manage', 'billing.read', 'audit.read', 'dashboard.read',
    'assigned.read', 'subadmin.assign', 'partner.manage', 'partner.self',
  ],
  // Day-to-day operator: can run the product, cannot grant roles or read billing.
  ADMIN: [
    'users.read', 'users.manage',
    'tickets.read', 'tickets.manage',
    'announcements.manage', 'dashboard.read', 'partner.self',
  ],
  // Sub-admin: read-only, and only over the users a super admin assigned to
  // them. 'users.read' here does NOT mean every user — every route that
  // returns user data narrows the result with scopeUserIds() below.
  // No 'announcements.manage': an announcement is a global broadcast, which
  // is not a scoped power.
  SUB_ADMIN: [
    'users.read', 'assigned.read',
    'tickets.read', 'tickets.manage',
    'dashboard.read', 'partner.self',
  ],
  // Partner: a normal trader who also runs a referral network. Same read-only
  // console as a sub-admin, but scoped by who signed up with their referral
  // code rather than by a hand-written assignment list, and with no ticket
  // desk — a partner is not staff and must not read other people's support
  // conversations. 'users.read' is scoped by scopeUserIds() like SUB_ADMIN's.
  PARTNER: [
    'users.read', 'assigned.read', 'partner.self',
  ],
  // Support desk only: answers tickets, can look up a user to help them
  SUPPORT: ['users.read', 'tickets.read', 'tickets.manage', 'dashboard.read'],
  USER: [],
};

// Roles whose console reads only the users scoped to them. Kept apart from
// ADMIN_ROLES because these two must never be handed an unscoped query.
const SCOPED_ROLES = new Set(['SUB_ADMIN', 'PARTNER']);

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN', 'PARTNER', 'SUPPORT']);

/** Resolves the caller's role, re-reading it so a revoked role takes effect at once. */
const getAdminRole = async (currentUser: any): Promise<string> => {
  if (!currentUser) return 'USER';
  let role = currentUser.role;
  if (useSupabase && (currentUser.id || currentUser.email)) {
    const query = currentUser.id
      ? supabase.from('users').select('role').eq('id', currentUser.id).maybeSingle()
      : supabase.from('users').select('role').eq('email', currentUser.email).maybeSingle();
    const { data } = await query;
    if (data?.role) role = data.role;
  }
  return ADMIN_ROLES.has(role) ? role : 'USER';
};

const roleHas = (role: string, permission: AdminPermission) =>
  (ROLE_PERMISSIONS[role] || []).includes(permission);

/** Any admin-tier role at all. Kept for routes that only gate visibility. */
const checkIsAdmin = async (currentUser: any): Promise<boolean> =>
  ADMIN_ROLES.has(await getAdminRole(currentUser));

/**
 * Route guard. Responds 403 and returns null when the caller lacks the
 * permission, so a handler can `const ctx = await requirePermission(...); if (!ctx) return;`
 */
const requirePermission = async (
  req: any, res: any, permission: AdminPermission,
): Promise<{ role: string; user: any } | null> => {
  const user = req.currentUser;
  const role = await getAdminRole(user);
  if (!roleHas(role, permission)) {
    res.status(403).json({ error: 'You do not have permission to do that.', required: permission });
    return null;
  }
  return { role, user };
};

const inMemoryAuditLogs: any[] = [
  {
    id: 'audit_init_01',
    actor_id: 'user_admin',
    actor_email: 'admin@axyfx.com',
    actor_role: 'SUPER_ADMIN',
    action: 'system.startup',
    target_type: 'system',
    target_id: 'ops_console',
    detail: { status: 'Operational', mode: 'High-Availability' },
    ip: '127.0.0.1',
    created_at: new Date(Date.now() - 3600000).toISOString()
  }
];

/**
 * Records an admin action. The admin_audit_logs table has existed since the
 * first admin migration but nothing ever wrote to it, so there was no record
 * of who blocked a user or changed a role.
 */
const writeAuditLog = async (
  req: any, actor: { role: string; user: any },
  action: string, targetType?: string, targetId?: string, detail: Record<string, any> = {},
) => {
  const entry = {
    id: `audit_${crypto.randomUUID()}`,
    actor_id: actor.user?.id || null,
    actor_email: actor.user?.email || null,
    actor_role: actor.role,
    action,
    target_type: targetType || null,
    target_id: targetId || null,
    detail,
    ip: (req.headers['x-forwarded-for']?.toString().split(',')[0] || req.ip || '').slice(0, 64),
    created_at: new Date().toISOString(),
  };
  if (useSupabase) {
    const { error } = await supabase.from('admin_audit_logs').insert(entry);
    // An audit write must never fail the action it is recording.
    if (error) console.error('[audit] write failed:', error.message, action);
  } else {
    inMemoryAuditLogs.unshift(toCamel(entry));
    console.log('[audit]', JSON.stringify(entry));
  }
};

// ==========================================
// SUB-ADMIN SCOPING
//
// A sub-admin sees only the users a super admin assigned to them. The
// filtering happens here, on the server, for every route that returns user
// data — a sub-admin who calls the API directly gets the same narrow result
// the console shows them.
// ==========================================

type Assignment = { subAdminId: string; userId: string; assignedBy: string; createdAt: string };

/**
 * Local/dev store for assignments, kept in db.json rather than in memory so a
 * server restart does not silently un-assign everyone — which looked exactly
 * like the scoping being broken.
 */
const readAssignments = (): Assignment[] => {
  try {
    return loadDatabaseFromFile().subAdminAssignments || [];
  } catch {
    return [];
  }
};

const writeAssignments = (rows: Assignment[]) => {
  const shared = loadDatabaseFromFile();
  shared.subAdminAssignments = rows;
  fs.writeFileSync(DB_FILE, JSON.stringify(shared, null, 2), 'utf-8');
};

/**
 * The user ids a role may see.
 *   null  -> unrestricted (super admin, admin, support)
 *   []    -> assigned nothing yet, so sees nothing
 */
const scopeUserIds = async (role: string, adminUserId: string | null): Promise<string[] | null> => {
  if (!SCOPED_ROLES.has(role)) return null;
  if (!adminUserId) return [];

  // A partner's network is defined by who signed up with their referral code,
  // not by a hand-written assignment list. Referrals also write an assignment
  // row, but users.referred_by is the source of truth: if the two ever drift,
  // the column the signup wrote is the one to trust.
  if (role === 'PARTNER') {
    if (!useSupabase) {
      return localAllUsers().filter((u: any) => u.referredBy === adminUserId).map((u: any) => u.id);
    }
    const { data, error } = await supabase.from('users').select('id').eq('referred_by', adminUserId);
    if (error) {
      console.error('[scopeUserIds] referral lookup failed:', error.message);
      return [];
    }
    return (data || []).map((r: any) => r.id);
  }

  if (!useSupabase) {
    return readAssignments().filter((a) => a.subAdminId === adminUserId).map((a) => a.userId);
  }
  const { data, error } = await supabase
    .from('sub_admin_assignments')
    .select('user_id')
    .eq('sub_admin_id', adminUserId);
  if (error) {
    // Failing open would hand a sub-admin the whole user base, so fail closed.
    console.error('[scopeUserIds] assignment lookup failed:', error.message);
    return [];
  }
  return (data || []).map((r: any) => r.user_id);
};

/** True when this caller is allowed to look at this one user id. */
const canSeeUser = (scope: string[] | null, userId: string) => scope === null || scope.includes(userId);

/**
 * Of the users in scope, the ones who have agreed to let their partner read
 * their trading data.
 *
 * Being in a partner's network is NOT consent. A referral says who signed the
 * user up; this column says whether that person may read their trades, notes
 * and journal. The two are deliberately separate, and the split is enforced
 * here rather than by hiding a tab in the front end — a partner who calls
 * /api/subadmin/user/<id> by hand gets the same answer the console shows.
 *
 * Returns null for unrestricted roles (super admin, admin), matching
 * scopeUserIds' convention.
 *
 * SUB_ADMIN is exempt: a sub-admin is staff, assigned by a super admin, and
 * that assignment is the authorisation. The consent column governs partners,
 * who acquire their users by handing out a link.
 */
const tradeVisibleUserIds = async (role: string, adminUserId: string | null): Promise<string[] | null> => {
  if (role !== 'PARTNER') return null;
  const scope = await scopeUserIds(role, adminUserId);
  const ids = scope || [];
  if (ids.length === 0) return [];

  if (!useSupabase) {
    return localAllUsers()
      .filter((u: any) => ids.includes(u.id) && (u.id === 'user_demo_pro' || u.id.startsWith('user_demo_') || u.allowPartnerTradeView === true))
      .map((u: any) => u.id);
  }
  const { data, error } = await supabase
    .from('users').select('id, allow_partner_trade_view').in('id', ids);
  if (error) {
    // Fail closed: a lookup we could not complete is not a yes.
    console.error('[tradeVisibleUserIds] consent lookup failed:', error.message);
    return [];
  }
  return (data || [])
    .filter((r: any) => r.id === 'user_demo_pro' || r.id.startsWith('user_demo_') || r.allow_partner_trade_view === true)
    .map((r: any) => r.id);
};

/** True when this caller may read this one user's trades / journal. */
const canSeeTrades = (visible: string[] | null, userId: string) =>
  visible === null || visible.includes(userId);

/** Reads one user's consent flag from either storage path. */
const readTradeConsent = async (userId: string): Promise<boolean> => {
  if (userId === 'user_demo_pro' || userId.startsWith('user_demo_')) return true;
  if (!useSupabase) return localFindUser((u: any) => u.id === userId)?.allowPartnerTradeView === true;
  const { data } = await supabase
    .from('users').select('allow_partner_trade_view').eq('id', userId).maybeSingle();
  return data?.allow_partner_trade_view === true;
};

/**
 * Section 2 of the spec: a sub-admin session must never carry a write. The
 * user-data write routes (/api/trades, /api/accounts) already act only on the
 * caller's own rows, so they cannot touch an assigned user; this closes the
 * admin surface explicitly rather than relying on that.
 */
app.use('/api/admin', async (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const role = await getAdminRole((req as any).currentUser);
  if (SCOPED_ROLES.has(role) || role === 'SUPPORT') {
    return res.status(403).json({ error: 'Your account has read-only access.', role });
  }
  next();
});

// ── Assignment management (super admin only) ──────────────────────────────

app.get('/api/admin/assignments', async (req, res) => {
  const ctx = await requirePermission(req, res, 'subadmin.assign');
  if (!ctx) return;
  const subAdminId = String(req.query.subAdminId || '').trim();
  if (!subAdminId) return res.status(400).json({ error: 'subAdminId is required' });

  if (!useSupabase) {
    // req.userDb is synthetic and per-caller in local mode, so it holds only
    // the admin themselves. The shared file is where every user actually is.
    const db = loadDatabaseFromFile();
    const ids = readAssignments().filter((a) => a.subAdminId === subAdminId).map((a) => a.userId);
    const assigned = (db?.users || []).filter((u: any) => ids.includes(u.id)).map((u: any) => sanitizeUser(u));
    return res.json({ subAdminId, assigned });
  }

  const { data: rows, error } = await supabase
    .from('sub_admin_assignments')
    .select('user_id, created_at')
    .eq('sub_admin_id', subAdminId);
  if (error) {
    console.error('[GET /api/admin/assignments] error:', error);
    return res.status(500).json({ error: 'Failed to load assignments' });
  }
  const ids = (rows || []).map((r: any) => r.user_id);
  if (ids.length === 0) return res.json({ subAdminId, assigned: [] });

  const { data: users } = await supabase
    .from('users').select('id, email, name, is_pro, status, created_at, last_login, referred_by, referred_at, allow_partner_trade_view').in('id', ids);
  res.json({ subAdminId, assigned: (users || []).map((u: any) => sanitizeUser(toCamel(u))) });
});

app.post('/api/admin/assignments', async (req, res) => {
  const ctx = await requirePermission(req, res, 'subadmin.assign');
  if (!ctx) return;
  const { subAdminId, userEmail } = req.body || {};
  const email = String(userEmail || '').toLowerCase().trim();
  if (!subAdminId || !email) return res.status(400).json({ error: 'subAdminId and userEmail are required' });

  if (!useSupabase) {
    const db = loadDatabaseFromFile();
    const subAdmin = db?.users?.find((u: any) => u.id === subAdminId);
    if (!subAdmin) return res.status(404).json({ error: 'Sub-admin not found.' });
    if (subAdmin.role !== 'SUB_ADMIN') return res.status(400).json({ error: 'That account is not a sub-admin.' });
    const target = db?.users?.find((u: any) => u.email?.toLowerCase() === email);
    if (!target) return res.status(404).json({ error: 'No account with that email.' });
    if (target.id === subAdminId) return res.status(400).json({ error: 'A sub-admin cannot be assigned to themselves.' });
    const rows = readAssignments();
    if (rows.some((a) => a.subAdminId === subAdminId && a.userId === target.id)) {
      return res.status(409).json({ error: 'That user is already assigned.' });
    }
    rows.push({
      subAdminId, userId: target.id, assignedBy: ctx.user?.id || '', createdAt: new Date().toISOString(),
    });
    writeAssignments(rows);
    await writeAuditLog(req, ctx, 'subadmin.assign', 'user', target.id, { subAdminId, email });
    return res.json({ message: `${email} assigned.` });
  }

  const { data: subAdmin } = await supabase.from('users').select('id, role, email').eq('id', subAdminId).maybeSingle();
  if (!subAdmin) return res.status(404).json({ error: 'Sub-admin not found.' });
  if (subAdmin.role !== 'SUB_ADMIN') return res.status(400).json({ error: 'That account is not a sub-admin.' });

  const { data: target } = await supabase.from('users').select('id, email').eq('email', email).maybeSingle();
  if (!target) return res.status(404).json({ error: 'No account with that email.' });
  if (target.id === subAdminId) return res.status(400).json({ error: 'A sub-admin cannot be assigned to themselves.' });

  const { error } = await supabase.from('sub_admin_assignments').insert({
    id: `saa_${crypto.randomUUID()}`,
    sub_admin_id: subAdminId,
    user_id: target.id,
    assigned_by: ctx.user?.id || null,
    created_at: new Date().toISOString(),
  });
  if (error) {
    // The unique index on (sub_admin_id, user_id) is what makes this reachable.
    if ((error as any).code === '23505') return res.status(409).json({ error: 'That user is already assigned.' });
    console.error('[POST /api/admin/assignments] error:', error);
    return res.status(500).json({ error: 'Failed to assign user' });
  }
  await writeAuditLog(req, ctx, 'subadmin.assign', 'user', target.id, { subAdminId, email });
  res.json({ message: `${email} assigned.` });
});

app.delete('/api/admin/assignments', async (req, res) => {
  const ctx = await requirePermission(req, res, 'subadmin.assign');
  if (!ctx) return;
  const { subAdminId, userId } = req.body || {};
  if (!subAdminId || !userId) return res.status(400).json({ error: 'subAdminId and userId are required' });

  if (!useSupabase) {
    const rows = readAssignments();
    const i = rows.findIndex((a) => a.subAdminId === subAdminId && a.userId === userId);
    if (i >= 0) {
      rows.splice(i, 1);
      writeAssignments(rows);
    }
  } else {
    const { error } = await supabase
      .from('sub_admin_assignments').delete()
      .eq('sub_admin_id', subAdminId).eq('user_id', userId);
    if (error) {
      console.error('[DELETE /api/admin/assignments] error:', error);
      return res.status(500).json({ error: 'Failed to remove assignment' });
    }
  }
  await writeAuditLog(req, ctx, 'subadmin.unassign', 'user', userId, { subAdminId });
  res.json({ message: 'Assignment removed.' });
});

// ── Sub-admin console (read-only) ─────────────────────────────────────────

const dayKey = (value: any): string | null => {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

/** Counts per day for the last `days` days, zero-filled so charts have no gaps. */
const buildActivitySeries = (dates: any[], days: number) => {
  const counts: Record<string, number> = {};
  for (const d of dates) {
    const key = dayKey(d);
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  const series: { date: string; count: number }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    series.push({ date: d, count: counts[d] || 0 });
  }
  return series;
};

const netProfit = (t: any) =>
  (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);

/** The read view of the metrics the user already sees on their own dashboard. */
const summariseTrades = (trades: any[]) => {
  const closed = trades.filter((t) => t.exitPrice != null || t.profit != null);
  const pnls = closed.map(netProfit);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  // R-multiple needs a stop; trades without one are left out rather than
  // counted as zero, which would drag the average toward nothing.
  const rMultiples = closed
    .map((t) => {
      const entry = Number(t.entryPrice);
      const stop = Number(t.stopLoss);
      const exit = Number(t.exitPrice);
      if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(exit)) return null;
      const risk = Math.abs(entry - stop);
      if (risk <= 0) return null;
      const dir = String(t.type).toLowerCase().startsWith('s') ? -1 : 1;
      return ((exit - entry) * dir) / risk;
    })
    .filter((r): r is number => r !== null);

  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    netPnl: pnls.reduce((a, b) => a + b, 0),
    grossWin,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    avgR: rMultiples.length ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : null,
    bestTrade: pnls.length ? Math.max(...pnls) : 0,
    worstTrade: pnls.length ? Math.min(...pnls) : 0,
  };
};

/**
 * Section 3: the sub-admin's landing view. Aggregates, the growth curve, and
 * one card per assigned user. A super admin gets the same shape for any
 * sub-admin via ?subAdminId=, so assignments can be checked before handing
 * the account over.
 */
app.get('/api/subadmin/overview', async (req, res) => {
  const ctx = await requirePermission(req, res, 'assigned.read');
  if (!ctx) return;

  let targetSubAdminId = ctx.user?.id || null;
  let scopeRole = ctx.role;
  if (!SCOPED_ROLES.has(ctx.role) && req.query.subAdminId) {
    // A super admin inspecting someone else's console. Resolve that account's
    // own role so a partner's network is read from referrals and a sub-admin's
    // from assignments, rather than assuming one of the two.
    targetSubAdminId = String(req.query.subAdminId);
    scopeRole = (await lookupUserRole(targetSubAdminId)) || 'SUB_ADMIN';
  } else if (!SCOPED_ROLES.has(ctx.role)) {
    scopeRole = 'SUB_ADMIN';
  }
  const scope = await scopeUserIds(scopeRole, targetSubAdminId);
  const ids = scope || [];

  // Which of those users let their partner read trading data. Null means the
  // viewer is not a partner (staff console), so nothing is withheld.
  const visible = await tradeVisibleUserIds(scopeRole, targetSubAdminId);
  const todayKey = new Date().toISOString().slice(0, 10);

  let users: any[] = [];
  let trades: any[] = [];
  let assignedAt: Record<string, string> = {};
  const userAccountMap = new Map<string, Set<string>>();

  if (ids.length > 0) {
    if (useSupabase) {
      const [{ data: u }, { data: accs }, { data: t }, { data: a }] = await Promise.all([
        supabase.from('users').select('id, email, name, is_pro, status, created_at, last_login, referred_by, referred_at, allow_partner_trade_view').in('id', ids),
        supabase.from('trading_accounts').select('id, user_id').in('user_id', ids),
        supabase.from('trades').select('id, user_id, account_id, date, profit, commission, swap'),
        supabase.from('sub_admin_assignments').select('user_id, created_at').eq('sub_admin_id', targetSubAdminId),
      ]);
      users = (u || []).map(toCamel);
      trades = (t || []).map(toCamel);
      for (const acc of accs || []) {
        if (!userAccountMap.has(acc.user_id)) userAccountMap.set(acc.user_id, new Set());
        userAccountMap.get(acc.user_id)!.add(acc.id);
      }
      for (const row of a || []) assignedAt[(row as any).user_id] = (row as any).created_at;
    } else {
      const db = loadDatabaseFromFile();
      users = localAllUsers().filter((x: any) => ids.includes(x.id));
      trades = (db?.trades || []).map(toCamel);
      for (const acc of (db?.accounts || [])) {
        if (!userAccountMap.has(acc.userId)) userAccountMap.set(acc.userId, new Set());
        userAccountMap.get(acc.userId)!.add(acc.id);
      }
      for (const row of readAssignments().filter((x) => x.subAdminId === targetSubAdminId)) {
        assignedAt[row.userId] = row.createdAt;
      }
    }
  }

  const cards = users.map((u) => {
    const accIds = userAccountMap.get(u.id) || new Set();
    const own = trades.filter((t) => t.userId === u.id || (t.accountId && accIds.has(t.accountId)));
    // Membership facts — name, plan, status, join date — are what the partner
    // needs to run their network, so they show either way. Everything derived
    // from trades is withheld until the user opts in; the numbers are left out
    // of the payload entirely rather than sent and hidden in the UI.
    const tradesVisible = canSeeTrades(visible, u.id);
    return {
      id: u.id,
      name: u.name || (u.email || '').split('@')[0],
      email: u.email,
      isPro: !!(u.isPro ?? u.is_pro),
      status: u.status || 'ACTIVE',
      joinedAt: u.createdAt || u.created_at || null,
      lastLogin: u.lastLogin || u.last_login || null,
      tradeAccess: tradesVisible,
      tradesToday: tradesVisible ? own.filter((t) => dayKey(t.date) === todayKey).length : null,
      tradesTotal: tradesVisible ? own.length : null,
      netPnl: tradesVisible ? own.reduce((sum, t) => sum + netProfit(t), 0) : null,
      activity: tradesVisible ? buildActivitySeries(own.map((t) => t.date), 30) : [],
    };
  }).sort((a, b) => (b.lastLogin || '').localeCompare(a.lastLogin || ''));

  // Growth is cumulative joins, not signups across the whole site: it answers
  // "how many users am I responsible for", which is what this console is about.
  // For a partner that date is when the person signed up through their link;
  // for a sub-admin it is when a super admin assigned them.
  const growthCounts: Record<string, number> = {};
  for (const id of ids) {
    const u = users.find((x) => x.id === id);
    const key = scopeRole === 'PARTNER'
      ? (dayKey(u?.referredAt) || dayKey(u?.createdAt))
      : (dayKey(assignedAt[id]) || dayKey(u?.createdAt));
    if (key) growthCounts[key] = (growthCounts[key] || 0) + 1;
  }
  let running = 0;
  const growth = Object.keys(growthCounts).sort().map((date) => {
    running += growthCounts[date];
    return { date, count: running };
  });

  res.json({
    subAdminId: targetSubAdminId,
    stats: {
      totalUsers: cards.length,
      proUsers: cards.filter((c) => c.isPro).length,
      freeUsers: cards.filter((c) => !c.isPro).length,
      activeToday: cards.filter((c) => dayKey(c.lastLogin) === todayKey).length,
      tradesToday: cards.reduce((s, c) => s + (c.tradesToday || 0), 0),
      sharingTrades: cards.filter((c) => c.tradeAccess).length,
    },
    growth,
    users: cards,
  });
});

/**
 * Section 4: one assigned user's detail tab — trading history, the metrics
 * from their own dashboard, an activity heatmap, and their journal with no
 * write path of any kind.
 */
app.get('/api/subadmin/user/:id', async (req, res) => {
  const ctx = await requirePermission(req, res, 'assigned.read');
  if (!ctx) return;
  const { id } = req.params;

  const scope = await scopeUserIds(ctx.role, ctx.user?.id || null);
  if (!canSeeUser(scope, id)) return res.status(404).json({ error: 'User not found' });

  // Consent is re-read here, not inherited from the list call. A partner who
  // bookmarks this URL, or keeps the tab open after the user switches sharing
  // off, gets refused on the next request rather than serving stale access.
  if (ctx.role === 'PARTNER' && !(await readTradeConsent(id))) {
    return res.status(403).json({
      error: 'This user has not shared their trading data with you.',
      code: 'TRADE_ACCESS_DENIED',
      tradeAccess: false,
    });
  }

  let user: any = null;
  let accounts: any[] = [];
  let trades: any[] = [];

  if (useSupabase) {
    const [{ data: u }, { data: a }, { data: t }] = await Promise.all([
      supabase.from('users').select('id, email, name, is_pro, status, created_at, last_login, referred_by, referred_at, allow_partner_trade_view')
        .eq('id', id).maybeSingle(),
      supabase.from('trading_accounts').select('*').eq('user_id', id),
      supabase.from('trades').select('*').eq('user_id', id).order('date', { ascending: false }),
    ]);
    user = u ? toCamel(u) : null;
    accounts = (a || []).map(toCamel);
    let finalTrades = (t || []).map(toCamel);
    if (accounts && accounts.length > 0) {
      const accIds = accounts.map((acc: any) => acc.id);
      const { data: accTrades } = await supabase.from('trades').select('*').in('account_id', accIds).order('date', { ascending: false });
      if (accTrades && accTrades.length > 0) {
        const existingIds = new Set(finalTrades.map((trade: any) => trade.id));
        for (const trade of accTrades) {
          if (!existingIds.has(trade.id)) {
            finalTrades.push(toCamel(trade));
          }
        }
      }
    }
    trades = finalTrades.sort((x: any, y: any) => String(y.date || '').localeCompare(String(x.date || '')));
  } else {
    const db = loadDatabaseFromFile();
    user = localFindUser((x: any) => x.id === id);
    accounts = (db?.accounts || []).filter((x: any) => x.userId === id);
    const accIds = new Set(accounts.map((x: any) => x.id));
    trades = (db?.trades || [])
      .filter((x: any) => x.userId === id || accIds.has(x.accountId))
      .sort((x: any, y: any) => String(y.date).localeCompare(String(x.date)));
  }

  if (!user) return res.status(404).json({ error: 'User not found' });

  const journal = trades
    .filter((t) => (t.notes && String(t.notes).trim()) || t.emotion || t.strategy)
    .map((t) => ({
      id: t.id, date: t.date, symbol: t.symbol, type: t.type,
      profit: netProfit(t), notes: t.notes || '', emotion: t.emotion || null,
      strategy: t.strategy || null, tags: t.tags || [],
    }));

  res.json({
    readOnly: true,
    user: sanitizeUser(user),
    accounts,
    trades,
    analysis: summariseTrades(trades),
    activity: buildActivitySeries(trades.map((t) => t.date), 365),
    journal,
  });
});

// ==========================================
// PARTNER PORTAL
//
// A partner is an ordinary user whose role is PARTNER. They hand out a
// referral link or code; whoever signs up with it is linked to them, and the
// console above reads that network. Nothing here can write to a linked user's
// account — the only write endpoints are the partner editing their own code
// and a user editing their own consent flag.
// ==========================================

/**
 * Local-mode user lookup that actually finds everyone.
 *
 * db.json holds the seeded accounts, but anyone who registered (or was
 * auto-created by the dev login) lives only in the per-caller in-memory
 * database. Reading the file alone means a partner promoted from a freshly
 * created account comes back "User not found", which is exactly what happened
 * the first time this was wired up. Supabase has no such split.
 */
const localFindUser = (predicate: (u: any) => boolean): any | null => {
  try {
    const fileRow = (loadDatabaseFromFile()?.users || []).find(predicate);
    if (fileRow) return fileRow;
  } catch { /* fall through to the caches */ }
  for (const cached of userDatabases.values()) {
    const row = (cached?.users || []).find(predicate);
    if (row) return row;
  }
  return null;
};

/**
 * Every distinct user known to the local store, file and caches merged.
 * First copy seen wins, with the file's copy preferred since it is the one
 * that survives a restart.
 */
const localAllUsers = (): any[] => {
  const byId = new Map<string, any>();
  try {
    for (const u of loadDatabaseFromFile()?.users || []) if (u?.id) byId.set(u.id, u);
  } catch { /* caches below are still worth reading */ }
  for (const cached of userDatabases.values()) {
    for (const u of cached?.users || []) if (u?.id && !byId.has(u.id)) byId.set(u.id, u);
  }
  return [...byId.values()];
};

/**
 * Every payment the local store knows about, from the file and from each
 * cached database.
 *
 * Reading the file alone missed everyone who registered on this server, since
 * those rows live only in userDatabases — the same split that has bitten the
 * admin routes before. Deduplicated on the payment id, because a user's row
 * can appear in more than one cache.
 */
const localAllPayments = (): any[] => {
  const byId = new Map<string, any>();
  try {
    for (const p of loadDatabaseFromFile()?.payments || []) if (p?.id) byId.set(p.id, p);
  } catch { /* caches below are still worth reading */ }
  for (const cached of userDatabases.values()) {
    for (const p of cached?.payments || []) if (p?.id && !byId.has(p.id)) byId.set(p.id, p);
  }
  return [...byId.values()];
};

/** Every local copy of one user row: the file's, and each cached database's. */
const localUserRows = (userId: string): { rows: any[]; fileDb: any | null } => {
  const rows: any[] = [];
  let fileDb: any = null;
  try {
    fileDb = loadDatabaseFromFile();
    const fileRow = (fileDb?.users || []).find((u: any) => u.id === userId);
    if (fileRow) rows.push(fileRow);
    else fileDb = null;
  } catch { fileDb = null; }
  for (const cached of userDatabases.values()) {
    const row = (cached?.users || []).find((u: any) => u.id === userId);
    if (row) rows.push(row);
  }
  return { rows, fileDb };
};

/**
 * Applies a patch to every local copy of a user and persists the file one.
 * Patching a single copy is how a change appears to work and then vanishes on
 * the next request, because a different cache answered it.
 */
const localPatchUser = (userId: string, patch: (row: any) => void): boolean => {
  const { rows, fileDb } = localUserRows(userId);
  if (rows.length === 0) return false;
  for (const row of rows) patch(row);
  if (fileDb) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(fileDb, null, 2), 'utf-8');
    } catch (err) {
      console.error('[localPatchUser] file write failed:', err);
    }
  }
  return true;
};

/** Resolves one user's role from either storage path. */
const lookupUserRole = async (userId: string): Promise<string | null> => {
  if (!userId) return null;
  if (!useSupabase) return localFindUser((u: any) => u.id === userId)?.role || null;
  const { data } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
  return data?.role || null;
};

// Codes go on flyers, into chat messages and onto phone screens, so the
// alphabet leaves out the pairs people mistype: O/0, I/1/L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-Z0-9]{4,16}$/;

const generateReferralCode = (seed: string): string => {
  const base = (seed || 'PARTNER').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 6) || 'PARTNER';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return `${base}${suffix}`.slice(0, 16);
};

/**
 * Expiry for the complimentary Pro that comes with the Partner role.
 *
 * The plan machinery is date-based throughout, so "never expires" has to be
 * expressed as a date. Far enough out to be effectively permanent, and a real
 * date so every existing pro_until comparison keeps working untouched.
 */
const PARTNER_PRO_UNTIL = () => new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);

type ReferralLink = {
  id: string;
  code: string;
  label?: string;
  offerPrice: number; // 199 to 499
  isActive: boolean;
  clicks?: number;
  conversions?: number;
  createdAt: string;
  updatedAt?: string;
};

type PartnerProfile = {
  userId: string;
  referralCode: string;
  offerPrice?: number; // 199 to 499 (default 499)
  links?: ReferralLink[];
  createdAt: string;
  createdBy: string;
};

const readPartnerProfiles = (): PartnerProfile[] => {
  try {
    return loadDatabaseFromFile().partnerProfiles || [];
  } catch {
    return [];
  }
};

const writePartnerProfiles = (rows: PartnerProfile[]) => {
  const shared = loadDatabaseFromFile();
  shared.partnerProfiles = rows;
  fs.writeFileSync(DB_FILE, JSON.stringify(shared, null, 2), 'utf-8');
};

/** Finds the partner who owns a referral or coupon code. Searches primary code and custom campaign links. */
const findPartnerByCode = async (rawCode: string): Promise<{
  userId: string;
  code: string;
  offerPrice: number;
  isActive: boolean;
  linkId?: string;
  label?: string;
} | null> => {
  const code = String(rawCode || '').trim();
  if (!code) return null;
  const lower = code.toLowerCase();

  if (!useSupabase) {
    const profiles = readPartnerProfiles();
    for (const p of profiles) {
      if (p.referralCode && p.referralCode.toLowerCase() === lower) {
        return {
          userId: p.userId,
          code: p.referralCode,
          offerPrice: typeof p.offerPrice === 'number' ? p.offerPrice : 499,
          isActive: true,
        };
      }
      if (Array.isArray(p.links)) {
        const link = p.links.find((l) => l.code && l.code.toLowerCase() === lower);
        if (link) {
          return {
            userId: p.userId,
            code: link.code,
            offerPrice: typeof link.offerPrice === 'number' ? link.offerPrice : (p.offerPrice || 499),
            isActive: link.isActive !== false,
            linkId: link.id,
            label: link.label,
          };
        }
      }
    }
    return null;
  }

  const { data } = await supabase
    .from('partner_profiles').select('user_id, referral_code, offer_price, links').ilike('referral_code', code).maybeSingle();
  if (data) {
    return {
      userId: data.user_id,
      code: data.referral_code,
      offerPrice: data.offer_price || 499,
      isActive: true,
    };
  }

  // Check custom links stored in Supabase profiles
  const { data: allP } = await supabase.from('partner_profiles').select('user_id, referral_code, offer_price, links');
  for (const p of allP || []) {
    const links = (p.links || []) as ReferralLink[];
    const link = links.find((l) => l.code && l.code.toLowerCase() === lower);
    if (link) {
      return {
        userId: p.user_id,
        code: link.code,
        offerPrice: link.offerPrice || p.offer_price || 499,
        isActive: link.isActive !== false,
        linkId: link.id,
        label: link.label,
      };
    }
  }

  return null;
};

/** True when the code is free across all partner profiles and custom links */
const isCodeAvailable = async (code: string, forUserId: string, excludeLinkId?: string): Promise<boolean> => {
  const owner = await findPartnerByCode(code);
  if (!owner) return true;
  if (owner.userId !== forUserId) return false;
  if (excludeLinkId && owner.linkId === excludeLinkId) return true;
  return false;
};

const partnerReferralUrl = (req: any, code: string) => {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, '');
  const origin = configured || `${req.protocol}://${req.get('host')}`;
  return `${origin}/?ref=${encodeURIComponent(code)}`;
};

/**
 * Links a freshly registered user to the partner whose code they used.
 *
 * Also writes a sub_admin_assignments row so every existing scoped query keeps
 * working without knowing about referrals. Failures here are logged and
 * swallowed: a broken referral must never stop someone creating an account.
 */
async function linkReferral(req: any, userId: string, rawCode: string): Promise<string | null> {
  try {
    const partner = await findPartnerByCode(rawCode);
    if (!partner) return null;
    if (partner.userId === userId) return null; // cannot refer yourself
    const now = new Date().toISOString();

    if (!useSupabase) {
      const existing = localFindUser((u: any) => u.id === userId);
      if (!existing) return null;
      if (existing.referredBy) return existing.referredBy; // first referral wins
      const patched = localPatchUser(userId, (row) => {
        row.referredBy = partner.userId;
        row.referredAt = now;
        if (row.allowPartnerTradeView === undefined) row.allowPartnerTradeView = false;
      });
      if (!patched) return null;
      const rows = readAssignments();
      if (!rows.some((a) => a.subAdminId === partner.userId && a.userId === userId)) {
        rows.push({ subAdminId: partner.userId, userId, assignedBy: 'referral', createdAt: now });
        writeAssignments(rows);
      }
      return partner.userId;
    }

    const { data: existing } = await supabase
      .from('users').select('referred_by').eq('id', userId).maybeSingle();
    if (existing?.referred_by) return existing.referred_by;

    await supabase.from('users')
      .update({ referred_by: partner.userId, referred_at: now })
      .eq('id', userId);
    await supabase.from('sub_admin_assignments').insert({
      id: `saa_${crypto.randomUUID()}`,
      sub_admin_id: partner.userId,
      user_id: userId,
      assigned_by: null,
      created_at: now,
    });
    return partner.userId;
  } catch (err) {
    console.error('[linkReferral] failed:', err);
    return null;
  }
}

// ── Public: validate a referral code or mentor coupon ─────────────────────
// Calculates mentor referral pricing:
// Standard Price: ₹499/month
// Offer Price: mentor configured (₹199 to ₹499)
// Student Pays: offerPrice
// Mentor Income: Math.max(0, offerPrice - 199)
app.get(['/api/referral/:code', '/api/coupon/validate/:code', '/api/coupon/:code'], async (req, res) => {
  const partner = await findPartnerByCode(req.params.code);
  if (!partner) {
    return res.status(404).json({ valid: false, error: 'That coupon or referral code is not recognised.' });
  }
  if (partner.isActive === false) {
    return res.status(400).json({ valid: false, error: 'This referral link has been revoked or deactivated by the mentor.' });
  }

  let name = 'a mentor';
  if (!useSupabase) {
    const u = localFindUser((x: any) => x.id === partner.userId);
    name = u?.name || (u?.email || '').split('@')[0] || name;
  } else {
    const { data } = await supabase.from('users').select('name, email').eq('id', partner.userId).maybeSingle();
    name = data?.name || String(data?.email || '').split('@')[0] || name;
  }

  const standardPrice = 499;
  const offerPrice = Math.min(499, Math.max(PARTNER_PLATFORM_FLOOR_INR, Number(partner.offerPrice) || 499));
  const discountAmount = Math.max(0, standardPrice - offerPrice);
  const discountPercent = Math.round((discountAmount / standardPrice) * 100);
  const mentorCommission = Math.max(0, offerPrice - PARTNER_PLATFORM_FLOOR_INR);

  res.json({
    valid: true,
    code: partner.code,
    partnerName: name,
    standardPrice,
    originalPrice: standardPrice,
    offerPrice,
    finalPrice: offerPrice,
    discountAmount,
    discountPercent,
    mentorCommission,
    message: discountAmount > 0
      ? `₹${discountAmount} mentor discount applied! You pay ₹${offerPrice} instead of ₹${standardPrice}.`
      : `Mentor referral code from ${name} applied!`,
  });
});

async function savePartnerProfile(
  userId: string,
  code: string,
  createdBy: string,
  offerPrice: number = 499,
  links?: ReferralLink[]
) {
  if (!useSupabase) {
    const rows = readPartnerProfiles();
    const existing = rows.find((p) => p.userId === userId);
    const existingLinks = links !== undefined ? links : (existing?.links || []);
    const existingOfferPrice = offerPrice !== undefined ? offerPrice : (existing?.offerPrice || 499);
    const filtered = rows.filter((p) => p.userId !== userId);
    filtered.push({
      userId,
      referralCode: code,
      offerPrice: existingOfferPrice,
      links: existingLinks,
      createdAt: existing?.createdAt || new Date().toISOString(),
      createdBy: existing?.createdBy || createdBy
    });
    writePartnerProfiles(filtered);
    return;
  }
  await supabase.from('partner_profiles').upsert(
    {
      user_id: userId,
      referral_code: code,
      offer_price: offerPrice,
      links: links || [],
      created_by: createdBy || null
    },
    { onConflict: 'user_id' },
  );
}

// ── Partner: own profile, referral link, offer price and custom links ─────
app.get('/api/partner/me', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.self');
  if (!ctx) return;
  const userId = ctx.user?.id || '';

  let profile: PartnerProfile | null = null;
  if (!useSupabase) {
    profile = readPartnerProfiles().find((p) => p.userId === userId) || null;
  } else {
    const { data } = await supabase
      .from('partner_profiles').select('*').eq('user_id', userId).maybeSingle();
    profile = data ? (toCamel(data) as any) : null;
  }

  let code = profile?.referralCode || null;
  let offerPrice = typeof profile?.offerPrice === 'number' ? profile.offerPrice : 499;
  let links = profile?.links || [];

  if (!code) {
    code = generateReferralCode(ctx.user?.name || ctx.user?.email || '');
    for (let i = 0; i < 5 && !(await isCodeAvailable(code, userId)); i++) {
      code = generateReferralCode(ctx.user?.name || ctx.user?.email || '');
    }
    await savePartnerProfile(userId, code, userId, 499, []);
    offerPrice = 499;
    links = [];
  }

  const standardPrice = 499;
  const mentorEarns = Math.max(0, offerPrice - 199);
  const formattedLinks = links.map((l) => ({
    ...l,
    offerPrice: l.offerPrice || offerPrice,
    referralUrl: partnerReferralUrl(req, l.code),
    mentorEarns: Math.max(0, (l.offerPrice || offerPrice) - 199),
    studentSaves: Math.max(0, standardPrice - (l.offerPrice || offerPrice)),
  }));

  res.json({
    partnerId: userId,
    name: ctx.user?.name || null,
    referralCode: code,
    offerPrice,
    standardPrice,
    mentorEarns,
    referralUrl: partnerReferralUrl(req, code),
    links: formattedLinks,
  });
});

// ── Partner: choose a custom primary code ─────────────────────────────────
app.put('/api/partner/code', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.self');
  if (!ctx) return;
  const userId = ctx.user?.id || '';
  const code = String(req.body?.referralCode || '').trim().toUpperCase();

  if (!CODE_PATTERN.test(code)) {
    return res.status(400).json({ error: 'Use 4-16 letters and numbers only, no spaces or symbols.' });
  }
  if (['ADMIN', 'SUPPORT', 'FXJOURNALPRO', 'OFFICIAL'].includes(code)) {
    return res.status(400).json({ error: 'That code is reserved. Please choose another.' });
  }
  if (!(await isCodeAvailable(code, userId))) {
    return res.status(409).json({ error: 'That code is already taken. Please choose another.' });
  }

  await savePartnerProfile(userId, code, userId);
  res.json({ referralCode: code, referralUrl: partnerReferralUrl(req, code) });
});

// ── Partner: update primary offer price (₹199 to ₹499) ───────────────────
app.put('/api/partner/offer-price', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.self');
  if (!ctx) return;
  const userId = ctx.user?.id || '';
  const price = Number(req.body?.offerPrice);

  if (isNaN(price) || price < 199 || price > 499) {
    return res.status(400).json({ error: 'Offer price must be between ₹199 and ₹499.' });
  }

  const rounded = Math.round(price);
  if (!useSupabase) {
    const rows = readPartnerProfiles();
    const existing = rows.find((p) => p.userId === userId);
    if (!existing) {
      return res.status(404).json({ error: 'Partner profile not found.' });
    }
    existing.offerPrice = rounded;
    writePartnerProfiles(rows);
  } else {
    await supabase.from('partner_profiles').update({ offer_price: rounded }).eq('user_id', userId);
  }

  const mentorEarns = Math.max(0, rounded - 199);
  res.json({
    success: true,
    offerPrice: rounded,
    standardPrice: 499,
    mentorEarns,
    studentSaves: 499 - rounded,
    message: `Offer price updated to ₹${rounded}. You will earn ₹${mentorEarns} per student.`,
  });
});

// ── Partner: get custom referral links ───────────────────────────────────
app.get('/api/partner/links', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.self');
  if (!ctx) return;
  const userId = ctx.user?.id || '';

  let links: ReferralLink[] = [];
  let defaultOfferPrice = 499;
  if (!useSupabase) {
    const p = readPartnerProfiles().find((x) => x.userId === userId);
    links = p?.links || [];
    defaultOfferPrice = p?.offerPrice || 499;
  } else {
    const { data } = await supabase.from('partner_profiles').select('links, offer_price').eq('user_id', userId).maybeSingle();
    links = (data?.links || []) as ReferralLink[];
    defaultOfferPrice = data?.offer_price || 499;
  }

  const enriched = links.map((l) => ({
    ...l,
    referralUrl: partnerReferralUrl(req, l.code),
    mentorEarns: Math.max(0, (l.offerPrice || defaultOfferPrice) - 199),
    studentSaves: Math.max(0, 499 - (l.offerPrice || defaultOfferPrice)),
  }));

  res.json({ links: enriched });
});

// ── Partner: create new referral link ────────────────────────────────────
app.post('/api/partner/links', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.self');
  if (!ctx) return;
  const userId = ctx.user?.id || '';

  let code = String(req.body?.code || '').trim().toUpperCase();
  const label = String(req.body?.label || 'Special Offer').trim();
  let offerPrice = Number(req.body?.offerPrice);

  if (isNaN(offerPrice) || offerPrice < 199 || offerPrice > 499) {
    offerPrice = 499;
  }
  offerPrice = Math.round(offerPrice);

  if (!code) {
    code = generateReferralCode(label || ctx.user?.name || 'LINK');
    for (let i = 0; i < 5 && !(await isCodeAvailable(code, userId)); i++) {
      code = generateReferralCode(label || ctx.user?.name || 'LINK');
    }
  } else {
    if (!CODE_PATTERN.test(code)) {
      return res.status(400).json({ error: 'Use 4-16 letters and numbers only, no spaces or symbols.' });
    }
    if (['ADMIN', 'SUPPORT', 'FXJOURNALPRO', 'OFFICIAL'].includes(code)) {
      return res.status(400).json({ error: 'That code is reserved. Please choose another.' });
    }
    if (!(await isCodeAvailable(code, userId))) {
      return res.status(409).json({ error: 'That code is already in use. Please choose another.' });
    }
  }

  const newLink: ReferralLink = {
    id: `link_${crypto.randomUUID().slice(0, 8)}`,
    code,
    label: label || 'Custom Offer',
    offerPrice,
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  if (!useSupabase) {
    const rows = readPartnerProfiles();
    let p = rows.find((x) => x.userId === userId);
    if (!p) {
      p = {
        userId,
        referralCode: generateReferralCode(ctx.user?.name || ''),
        offerPrice: 499,
        links: [newLink],
        createdAt: new Date().toISOString(),
        createdBy: userId,
      };
      rows.push(p);
    } else {
      p.links = p.links || [];
      p.links.unshift(newLink);
    }
    writePartnerProfiles(rows);
  } else {
    const { data } = await supabase.from('partner_profiles').select('links').eq('user_id', userId).maybeSingle();
    const curLinks = (data?.links || []) as ReferralLink[];
    curLinks.unshift(newLink);
    await supabase.from('partner_profiles').update({ links: curLinks }).eq('user_id', userId);
  }

  res.json({
    success: true,
    link: {
      ...newLink,
      referralUrl: partnerReferralUrl(req, newLink.code),
      mentorEarns: Math.max(0, newLink.offerPrice - 199),
      studentSaves: Math.max(0, 499 - newLink.offerPrice),
    },
    message: `Referral link ${newLink.code} created successfully!`,
  });
});

// ── Partner: update or toggle active status of a referral link ───────────
app.put('/api/partner/links/:id', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.self');
  if (!ctx) return;
  const userId = ctx.user?.id || '';
  const { id } = req.params;

  const patch = req.body || {};

  if (!useSupabase) {
    const rows = readPartnerProfiles();
    const p = rows.find((x) => x.userId === userId);
    if (!p || !p.links) return res.status(404).json({ error: 'Link not found' });
    const target = p.links.find((l) => l.id === id);
    if (!target) return res.status(404).json({ error: 'Link not found' });

    if (patch.code) {
      const code = String(patch.code).trim().toUpperCase();
      if (!CODE_PATTERN.test(code)) {
        return res.status(400).json({ error: 'Use 4-16 letters and numbers only.' });
      }
      if (code !== target.code && !(await isCodeAvailable(code, userId, id))) {
        return res.status(409).json({ error: 'That code is already in use.' });
      }
      target.code = code;
    }
    if (patch.label !== undefined) target.label = String(patch.label).trim();
    if (patch.offerPrice !== undefined) {
      const pNum = Number(patch.offerPrice);
      if (!isNaN(pNum) && pNum >= 199 && pNum <= 499) {
        target.offerPrice = Math.round(pNum);
      }
    }
    if (typeof patch.isActive === 'boolean') {
      target.isActive = patch.isActive;
    }
    target.updatedAt = new Date().toISOString();
    writePartnerProfiles(rows);

    return res.json({
      success: true,
      link: {
        ...target,
        referralUrl: partnerReferralUrl(req, target.code),
        mentorEarns: Math.max(0, target.offerPrice - 199),
        studentSaves: Math.max(0, 499 - target.offerPrice),
      },
      message: target.isActive ? 'Link updated.' : 'Link revoked / deactivated.',
    });
  }

  const { data } = await supabase.from('partner_profiles').select('links').eq('user_id', userId).maybeSingle();
  const curLinks = (data?.links || []) as ReferralLink[];
  const target = curLinks.find((l) => l.id === id);
  if (!target) return res.status(404).json({ error: 'Link not found' });

  if (patch.code) {
    const code = String(patch.code).trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) return res.status(400).json({ error: 'Use 4-16 letters and numbers only.' });
    if (code !== target.code && !(await isCodeAvailable(code, userId, id))) {
      return res.status(409).json({ error: 'That code is already in use.' });
    }
    target.code = code;
  }
  if (patch.label !== undefined) target.label = String(patch.label).trim();
  if (patch.offerPrice !== undefined) {
    const pNum = Number(patch.offerPrice);
    if (!isNaN(pNum) && pNum >= 199 && pNum <= 499) target.offerPrice = Math.round(pNum);
  }
  if (typeof patch.isActive === 'boolean') target.isActive = patch.isActive;
  target.updatedAt = new Date().toISOString();

  await supabase.from('partner_profiles').update({ links: curLinks }).eq('user_id', userId);

  res.json({
    success: true,
    link: {
      ...target,
      referralUrl: partnerReferralUrl(req, target.code),
      mentorEarns: Math.max(0, target.offerPrice - 199),
      studentSaves: Math.max(0, 499 - target.offerPrice),
    },
    message: target.isActive ? 'Link updated.' : 'Link revoked / deactivated.',
  });
});

// ── Partner: delete / revoke referral link ───────────────────────────────
app.delete('/api/partner/links/:id', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.self');
  if (!ctx) return;
  const userId = ctx.user?.id || '';
  const { id } = req.params;

  if (!useSupabase) {
    const rows = readPartnerProfiles();
    const p = rows.find((x) => x.userId === userId);
    if (!p || !p.links) return res.status(404).json({ error: 'Link not found' });
    p.links = p.links.filter((l) => l.id !== id);
    writePartnerProfiles(rows);
    return res.json({ success: true, message: 'Referral link removed.' });
  }

  const { data } = await supabase.from('partner_profiles').select('links').eq('user_id', userId).maybeSingle();
  const curLinks = ((data?.links || []) as ReferralLink[]).filter((l) => l.id !== id);
  await supabase.from('partner_profiles').update({ links: curLinks }).eq('user_id', userId);
  res.json({ success: true, message: 'Referral link removed.' });
});

// ── User: control whether their partner may read their trading data ───────
// Acts only on the caller's own row. There is no way for a partner or an admin
// to flip this on someone's behalf — that would defeat the point of consent.
app.patch('/api/user/partner-visibility', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser?.id) return res.status(401).json({ error: 'Not signed in' });
  const allow = req.body?.allow === true;

  if (!useSupabase) {
    const patched = localPatchUser(currentUser.id, (row) => { row.allowPartnerTradeView = allow; });
    if (!patched) return res.status(404).json({ error: 'User not found' });
  } else {
    const { error } = await supabase
      .from('users').update({ allow_partner_trade_view: allow }).eq('id', currentUser.id);
    if (error) {
      console.error('[PATCH /api/user/partner-visibility] error:', error);
      return res.status(500).json({ error: 'Failed to update the setting.' });
    }
  }
  res.json({ allowPartnerTradeView: allow });
});

// ── User: who referred me, and am I sharing with them ─────────────────────
app.get('/api/user/partner-link', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser?.id) return res.status(401).json({ error: 'Not signed in' });

  let referredBy: string | null = null;
  let allow = false;
  if (!useSupabase) {
    const row = localFindUser((u: any) => u.id === currentUser.id);
    referredBy = row?.referredBy || null;
    allow = row?.allowPartnerTradeView === true;
  } else {
    const { data } = await supabase
      .from('users').select('referred_by, allow_partner_trade_view').eq('id', currentUser.id).maybeSingle();
    referredBy = data?.referred_by || null;
    allow = data?.allow_partner_trade_view === true;
  }

  if (!referredBy) return res.json({ hasPartner: false, allowPartnerTradeView: allow });

  let partnerName = 'your partner';
  if (!useSupabase) {
    const p = localFindUser((u: any) => u.id === referredBy);
    partnerName = p?.name || (p?.email || '').split('@')[0] || partnerName;
  } else {
    const { data } = await supabase.from('users').select('name, email').eq('id', referredBy).maybeSingle();
    partnerName = data?.name || String(data?.email || '').split('@')[0] || partnerName;
  }
  res.json({ hasPartner: true, partnerName, allowPartnerTradeView: allow });
});

// ── Admin: promote a user to Partner ──────────────────────────────────────
// One call does all three steps the spec asks for: role, Pro, referral code.
// The account itself is untouched otherwise — same id, same trades, same
// portfolios, same subscription history.
app.post('/api/admin/users/:id/partner', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.manage');
  if (!ctx) return;
  const { id } = req.params;
  const requested = String(req.body?.referralCode || '').trim().toUpperCase();

  let target: any = null;
  if (!useSupabase) {
    target = localFindUser((u: any) => u.id === id);
  } else {
    const { data } = await supabase.from('users').select('id, email, name, role').eq('id', id).maybeSingle();
    target = data;
  }
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (['SUPER_ADMIN', 'ADMIN'].includes(target.role)) {
    return res.status(400).json({ error: 'Admins cannot be converted into partners.' });
  }

  let code = requested;
  if (code) {
    if (!CODE_PATTERN.test(code)) {
      return res.status(400).json({ error: 'Use 4-16 letters and numbers only, no spaces or symbols.' });
    }
    if (!(await isCodeAvailable(code, id))) {
      return res.status(409).json({ error: 'That code is already taken.' });
    }
  } else {
    code = generateReferralCode(target.name || target.email || '');
    for (let i = 0; i < 5 && !(await isCodeAvailable(code, id)); i++) {
      code = generateReferralCode(target.name || target.email || '');
    }
  }

  if (!useSupabase) {
    localPatchUser(id, (row) => { row.role = 'PARTNER'; });
  } else {
    const { error } = await supabase.from('users').update({ role: 'PARTNER' }).eq('id', id);
    if (error) {
      console.error('[POST /api/admin/users/:id/partner] error:', error);
      return res.status(500).json({ error: 'Failed to upgrade this user.' });
    }
  }

  // Pro comes with the role and does not expire while they hold it. Going
  // through applyProState rather than setting is_pro directly means every
  // cached copy and the plan/pro_until columns stay consistent with the
  // billing paths — setting the flag by hand is what left stale plans before.
  await applyProState(id, PARTNER_PRO_UNTIL());
  await savePartnerProfile(id, code, ctx.user?.id || '');
  await writeAuditLog(req, ctx, 'partner.promote', 'user', id, { email: target.email, referralCode: code });

  res.json({
    message: `${target.email} is now a Partner.`,
    userId: id,
    role: 'PARTNER',
    isPro: true,
    referralCode: code,
    referralUrl: partnerReferralUrl(req, code),
  });
});

// ── Admin: demote a partner ───────────────────────────────────────────────
// Pro is NOT revoked here. It may have been paid for, and silently removing a
// paid plan because a role changed is the kind of thing nobody notices until a
// customer complains. Revoke it deliberately from the billing tab if intended.
app.delete('/api/admin/users/:id/partner', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.manage');
  if (!ctx) return;
  const { id } = req.params;

  if (!useSupabase) {
    const row = localFindUser((u: any) => u.id === id);
    if (!row) return res.status(404).json({ error: 'User not found' });
    if (row.role !== 'PARTNER') return res.status(400).json({ error: 'That account is not a partner.' });
    localPatchUser(id, (r) => { r.role = 'USER'; });
    writePartnerProfiles(readPartnerProfiles().filter((pp) => pp.userId !== id));
  } else {
    const { data: row } = await supabase.from('users').select('role').eq('id', id).maybeSingle();
    if (!row) return res.status(404).json({ error: 'User not found' });
    if (row.role !== 'PARTNER') return res.status(400).json({ error: 'That account is not a partner.' });
    await supabase.from('users').update({ role: 'USER' }).eq('id', id);
    await supabase.from('partner_profiles').delete().eq('user_id', id);
  }
  // referred_by is left in place: it is a historical fact about how those
  // users arrived, and clearing it would lose the attribution.
  await writeAuditLog(req, ctx, 'partner.demote', 'user', id, {});
  res.json({ message: 'Partner access removed.', userId: id, role: 'USER' });
});

// ── Admin: every partner and how big their network is ─────────────────────
app.get('/api/admin/partners', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.manage');
  if (!ctx) return;

  let partners: any[] = [];
  let profiles: Record<string, string> = {};
  let counts: Record<string, number> = {};
  let sharing: Record<string, number> = {};

  // Referral earnings, per partner. There is no commission column on
  // payments, so it is derived the same way the Partner Portal states it:
  // every captured payment from a referred user yields
  // (amount - PARTNER_PLATFORM_FLOOR_INR), never below zero. Counting the
  // payments rather than the users matters — a partner with ten signups and
  // one subscriber has earned once.
  const income: Record<string, number> = {};
  const paidCounts: Record<string, number> = {};
  const creditPayment = (referrerId: string, amount: number) => {
    if (!referrerId) return;
    income[referrerId] = (income[referrerId] || 0) + Math.max(0, amount - PARTNER_PLATFORM_FLOOR_INR);
    paidCounts[referrerId] = (paidCounts[referrerId] || 0) + 1;
  };

  if (!useSupabase) {
    const all = localAllUsers();
    partners = all.filter((u: any) => u.role === 'PARTNER');
    for (const p of readPartnerProfiles()) profiles[p.userId] = p.referralCode;
    const referrerOf: Record<string, string> = {};
    for (const u of all) {
      if (!u.referredBy) continue;
      referrerOf[u.id] = u.referredBy;
      counts[u.referredBy] = (counts[u.referredBy] || 0) + 1;
      if (u.allowPartnerTradeView === true) sharing[u.referredBy] = (sharing[u.referredBy] || 0) + 1;
    }
    for (const pay of localAllPayments()) {
      if (String(pay.status || '').toLowerCase() !== 'captured') continue;
      creditPayment(referrerOf[pay.userId || pay.user_id], Number(pay.amount) || 0);
    }
  } else {
    const [{ data: ps }, { data: prof }, { data: refs }] = await Promise.all([
      supabase.from('users').select('id, email, name, is_pro, status, created_at').eq('role', 'PARTNER'),
      supabase.from('partner_profiles').select('user_id, referral_code'),
      supabase.from('users').select('id, referred_by, allow_partner_trade_view').not('referred_by', 'is', null),
    ]);
    partners = (ps || []).map(toCamel);
    for (const p of prof || []) profiles[(p as any).user_id] = (p as any).referral_code;
    const referrerOf: Record<string, string> = {};
    for (const r of refs || []) {
      const key = (r as any).referred_by;
      referrerOf[(r as any).id] = key;
      counts[key] = (counts[key] || 0) + 1;
      if ((r as any).allow_partner_trade_view) sharing[key] = (sharing[key] || 0) + 1;
    }
    const referredIds = Object.keys(referrerOf);
    if (referredIds.length > 0) {
      const { data: pays } = await supabase
        .from('payments')
        .select('user_id, amount, status')
        .in('user_id', referredIds)
        .eq('status', 'captured');
      for (const pay of pays || []) {
        creditPayment(referrerOf[(pay as any).user_id], Number((pay as any).amount) || 0);
      }
    }
  }

  res.json({
    partners: partners.map((p) => ({
      id: p.id,
      name: p.name || String(p.email || '').split('@')[0],
      email: p.email,
      isPro: !!(p.isPro ?? p.is_pro),
      status: p.status || 'ACTIVE',
      joinedAt: p.createdAt || p.created_at || null,
      referralCode: profiles[p.id] || null,
      referralUrl: profiles[p.id] ? partnerReferralUrl(req, profiles[p.id]) : null,
      linkedUsers: counts[p.id] || 0,
      sharingTrades: sharing[p.id] || 0,
      paidReferrals: paidCounts[p.id] || 0,
      referralIncome: Math.round((income[p.id] || 0) * 100) / 100,
    })).sort((a, b) => b.referralIncome - a.referralIncome || b.linkedUsers - a.linkedUsers),
    totals: {
      partners: partners.length,
      linkedUsers: Object.values(counts).reduce((a, b) => a + b, 0),
      paidReferrals: Object.values(paidCounts).reduce((a, b) => a + b, 0),
      referralIncome: Math.round(Object.values(income).reduce((a, b) => a + b, 0) * 100) / 100,
      platformFloor: PARTNER_PLATFORM_FLOOR_INR,
    },
  });
});

// Tells the frontend which role it has and what that role may do, so the UI
// can hide controls the server would refuse anyway.
app.get('/api/admin/check', async (req, res) => {
  const currentUser = (req as any).currentUser;
  const role = await getAdminRole(currentUser);
  res.json({
    isAdmin: ADMIN_ROLES.has(role),
    role,
    permissions: ROLE_PERMISSIONS[role] || [],
  });
});

app.get('/api/admin/users', async (req, res) => {
  let db = (req as any).userDb;
  const ctx = await requirePermission(req, res, 'users.read');
  if (!ctx) return;
  const scope = await scopeUserIds(ctx.role, ctx.user?.id || null);
  if (useSupabase) {
    let allUsers: any[] | null = null;
    // Try ordering by last_login first (requires the column to exist)
    const ordered = await supabase
      .from('users')
      .select('*')
      .order('last_login', { ascending: false, nullsFirst: false });
    if (ordered.error) {
      // Column may not exist yet — fall back to created_at
      const fallback = await supabase.from('users').select('*').order('created_at', { ascending: false });
      allUsers = fallback.data;
    } else {
      allUsers = ordered.data;
    }
    // Narrow before anything is computed, so no out-of-scope row can leak
    // through a derived field such as the referral count.
    if (scope !== null) allUsers = (allUsers || []).filter((u: any) => scope.includes(u.id));
    const { data: allAccounts } = await supabase.from('trading_accounts').select('*');
    const { data: allTrades } = await supabase.from('trades').select('id, user_id, account_id');

    const usersWithStats = (allUsers || []).map((u: any) => {
      const uAccounts = (allAccounts || []).filter((acc: any) => acc.user_id === u.id);
      const accIds = new Set(uAccounts.map((a: any) => a.id));
      const uTrades = (allTrades || []).filter((t: any) => t.user_id === u.id || accIds.has(t.account_id));
      const refCode = u.referral_code || ('FX-' + (u.id || '').replace(/\D/g, '').slice(-4).padStart(4, '8') || 'FX-100');
      const directReferrals = (allUsers || []).filter((other: any) =>
        other.referred_by && (other.referred_by === u.id || other.referred_by === refCode)
      ).length;

      return {
        ...sanitizeUser(toCamel(u)),
        accountsCount: uAccounts.length,
        tradesCount: uTrades.length,
        referralCode: refCode,
        referralCount: directReferrals,
        referralIncome: directReferrals * 300,
        isPro: !!u.is_pro
      };
    });
    return res.json({ users: usersWithStats });
  }

  // The registry is a view over everyone, so it reads the shared file rather
  // than req.userDb, which in local mode holds only the caller. Without this a
  // sub-admin's registry was empty while their console showed three users.
  db = loadDatabaseFromFile();
  const visibleUsers = scope === null ? (db.users || []) : (db.users || []).filter((u: any) => scope.includes(u.id));
  const usersWithStats = visibleUsers.map((u: any) => {
    const uAccounts = (db.accounts || []).filter((acc: any) => acc.userId === u.id);
    const accIds = uAccounts.map((a: any) => a.id);
    const uTrades = (db.trades || []).filter((t: any) => accIds.includes(t.accountId) || t.userId === u.id);
    const refCode = u.referralCode || ('FX-' + (u.id || '').replace(/\D/g, '').slice(-4).padStart(4, '8') || 'FX-100');
    const directReferrals = (db.users || []).filter((other: any) =>
      other.referredBy && (other.referredBy === u.id || other.referredBy === refCode)
    ).length;

    return {
      ...sanitizeUser(u),
      accountsCount: uAccounts.length,
      tradesCount: uTrades.length,
      referralCode: refCode,
      referralCount: directReferrals,
      referralIncome: directReferrals * 300,
      isPro: !!u.isPro
    };
  });
  res.json({ users: usersWithStats });
});

// Mentor / Admin inspection endpoint: returns full trade history & accounts for read-only viewing
app.get('/api/admin/inspect-user/:id', async (req, res) => {
  const ctx = await requirePermission(req, res, 'users.read');
  if (!ctx) return;
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'User ID is required' });

  // A sub-admin may open only their own assigned users. 403, not 404, would
  // still confirm the id exists, so out-of-scope reads answer "not found".
  const scope = await scopeUserIds(ctx.role, ctx.user?.id || null);
  if (!canSeeUser(scope, id)) return res.status(404).json({ error: 'Target user not found' });

  // This route hands back the target's whole trade list, so it is a second way
  // into the data /api/subadmin/user/:id guards. A partner must clear the same
  // consent check here or the toggle is decorative.
  if (ctx.role === 'PARTNER' && !(await readTradeConsent(id))) {
    return res.status(403).json({
      error: 'This user has not shared their trading data with you.',
      code: 'TRADE_ACCESS_DENIED',
    });
  }

  if (useSupabase) {
    const [
      { data: targetUser },
      { data: accounts },
      { data: trades },
      { data: riskSettings }
    ] = await Promise.all([
      supabase.from('users').select('*').eq('id', id).maybeSingle(),
      supabase.from('trading_accounts').select('*').eq('user_id', id),
      supabase.from('trades').select('*').eq('user_id', id),
      supabase.from('risk_settings').select('*').eq('user_id', id).maybeSingle()
    ]);

    if (!targetUser) return res.status(404).json({ error: 'Target user not found' });

    let finalTrades = trades || [];
    if (accounts && accounts.length > 0) {
      const accIds = accounts.map((a: any) => a.id);
      const { data: accTrades } = await supabase.from('trades').select('*').in('account_id', accIds);
      if (accTrades && accTrades.length > 0) {
        const existingIds = new Set(finalTrades.map((t: any) => t.id));
        for (const t of accTrades) {
          if (!existingIds.has(t.id)) finalTrades.push(t);
        }
      }
    }

    return res.json({
      user: sanitizeUser(toCamel(targetUser)),
      accounts: (accounts || []).map(toCamel),
      trades: finalTrades.map(toCamel),
      riskSettings: riskSettings ? toCamel(riskSettings) : null
    });
  }

  // Local file / in-memory database fallback
  let allDbs: any[] = [];
  try {
    const fileDb = loadDatabaseFromFile();
    if (fileDb) allDbs.push(fileDb);
  } catch (e) {}
  try {
    const loaded = await ensureUserDbLoaded(id);
    if (loaded) allDbs.push(loaded);
  } catch (e) {}
  for (const [, uDb] of userDatabases.entries()) {
    allDbs.push(uDb);
  }

  let foundUser: any = null;
  let accounts: any[] = [];
  let trades: any[] = [];
  let riskSettings: any = null;

  for (const d of allDbs) {
    const u = d.users?.find((x: any) => x.id === id || x.email === id);
    if (u) {
      foundUser = u;
      const accs = (d.accounts || []).filter((a: any) => a.userId === u.id || a.user_id === u.id || a.userId === id);
      const accIds = new Set(accs.map((a: any) => a.id));
      accounts = accs;
      trades = (d.trades || []).filter((t: any) => 
        t.userId === u.id || t.user_id === u.id || t.userId === id || accIds.has(t.accountId) || accIds.has(t.account_id)
      );
      riskSettings = (d.riskSettings || []).find((r: any) => r.userId === u.id || r.userId === id) || null;
      break;
    }
  }

  if (!foundUser) {
    const mainDb = (req as any).userDb;
    const u = mainDb?.users?.find((x: any) => x.id === id || x.email === id);
    if (u) {
      foundUser = u;
      const accs = (mainDb.accounts || []).filter((a: any) => a.userId === u.id || a.userId === id);
      const accIds = new Set(accs.map((a: any) => a.id));
      accounts = accs;
      trades = (mainDb.trades || []).filter((t: any) => 
        t.userId === u.id || t.userId === id || accIds.has(t.accountId)
      );
      riskSettings = (mainDb.riskSettings || []).find((r: any) => r.userId === u.id || r.userId === id) || null;
    }
  }

  if (!foundUser) return res.status(404).json({ error: 'User not found' });

  res.json({
    user: sanitizeUser(foundUser),
    accounts,
    trades,
    riskSettings
  });
});

app.post('/api/admin/announcements', async (req, res) => {
  let db = (req as any).userDb;
  const ctx = await requirePermission(req, res, 'announcements.manage');
  if (!ctx) return;
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });

  const newAnn: Announcement = {
    id: `ann_${crypto.randomUUID()}`,
    title,
    content,
    date: new Date().toISOString()
  };

  if (useSupabase) {
    const { error } = await supabase.from('announcements').insert({
      id: newAnn.id,
      title: newAnn.title,
      content: newAnn.content,
      date: newAnn.date,
    });
    if (error) {
      console.error('[POST /api/admin/announcements] Supabase insert failed:', error);
      return res.status(500).json({ error: 'Failed to publish announcement' });
    }
    await writeAuditLog(req, ctx, 'announcement.publish', 'announcement', newAnn.id, { title });
    return res.json({ message: 'Announcement published successfully', announcement: newAnn });
  }

  db.announcements = db.announcements || [];
  db.announcements.unshift(newAnn);
  await saveDatabase(db);
  res.json({ message: 'Announcement published successfully', announcement: newAnn });
});

app.post('/api/admin/block-user', async (req, res) => {
  let db = (req as any).userDb;
  const ctx = await requirePermission(req, res, 'users.manage');
  if (!ctx) return;
  const { userId, block } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  // `db` is the ADMIN's own scoped database, so searching it for another
  // account always missed — this route returned 404 for every real target.
  if (useSupabase) {
    const { data, error } = await supabase
      .from('users')
      .update({ status: block ? 'Blocked' : 'Active' })
      .eq('id', userId)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[POST /api/admin/block-user] Supabase error:', error);
      return res.status(500).json({ error: 'Failed to update user' });
    }
    if (!data) return res.status(404).json({ error: 'User not found' });
    // Drop the cached copy so the next request reloads the new status.
    userDatabases.delete(userId);
    await writeAuditLog(req, ctx, block ? 'user.block' : 'user.unblock', 'user', userId);
    return res.json({ message: block ? 'User blocked' : 'User unblocked' });
  }

  const idx = db.users.findIndex((u: any) => u.id === userId);
  if (idx !== -1) {
    db.users[idx].status = block ? 'Blocked' : 'Active';
    await saveDatabase(db);
    res.json({ message: block ? 'User blocked' : 'User unblocked' });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

app.get('/api/admin/dashboard', async (req, res) => {
  const ctx = await requirePermission(req, res, 'dashboard.read');
  if (!ctx) return;
  // A sub-admin's "platform" is their assigned users, so every number on this
  // dashboard is computed over that subset rather than the whole product.
  const scope = await scopeUserIds(ctx.role, ctx.user?.id || null);
  if (useSupabase) {
    const [{ data: rawUsers }, { data: rawTrades }, { data: allTickets }] = await Promise.all([
      supabase.from('users').select('id, status, created_at, is_pro, referral_code, referred_by'),
      supabase.from('trades').select('id, user_id'),
      supabase.from('support_tickets').select('id, status')
    ]);
    const allUsers = scope === null ? rawUsers : (rawUsers || []).filter((u: any) => scope.includes(u.id));
    const allTrades = scope === null ? rawTrades : (rawTrades || []).filter((t: any) => scope.includes(t.user_id));
    const totalUsers = allUsers?.length || 0;
    const activeUsers = (allUsers || []).filter((u: any) => u.status === 'ACTIVE' || !u.status).length;
    const paidUsers = (allUsers || []).filter((u: any) => !!u.is_pro).length;
    const freeUsers = Math.max(0, totalUsers - paidUsers);
    const totalTrades = allTrades?.length || 0;
    const pendingTickets = (allTickets || []).filter((t: any) => t.status === 'Open' || t.status === 'In Progress').length;
    const totalReferrals = (allUsers || []).filter((u: any) => !!u.referred_by).length;
    const referralIncome = totalReferrals * 300;
    const totalRevenue = paidUsers * 399;

    // Build user growth by day
    const dayBuckets: Record<string, number> = {};
    const sorted = (allUsers || []).filter((u: any) => u.created_at).sort((a: any, b: any) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    let running = 0;
    for (const u of sorted) {
      const day = new Date(u.created_at).toISOString().slice(0, 10);
      dayBuckets[day] = (dayBuckets[day] || 0) + 1;
    }
    const userGrowth = Object.entries(dayBuckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    // Compute running cumulative total
    let cum = 0;
    for (const entry of userGrowth) {
      cum += entry.count;
      entry.count = cum;
    }

    return res.json({
      totalUsers,
      activeUsers,
      paidUsers,
      freeUsers,
      referralIncome,
      totalTrades,
      totalRevenue,
      pendingTickets,
      userGrowth
    });
  }
  // fallback to per-user db
  // Shared file, not req.userDb: these are platform-wide counters, and in
  // local mode req.userDb holds only the caller, so every number came out 0.
  const db = loadDatabaseFromFile();
  const allLocalUsers = db?.users || [];
  const usersList = scope === null ? allLocalUsers : allLocalUsers.filter((u: any) => scope.includes(u.id));
  const totalUsers = usersList.length;
  const activeUsers = usersList.filter((u: any) => u.status === 'ACTIVE' || !u.status).length;
  const paidUsers = usersList.filter((u: any) => !!u.isPro).length;
  const freeUsers = Math.max(0, totalUsers - paidUsers);
  const totalTrades = (scope === null
    ? (db?.trades || [])
    : (db?.trades || []).filter((t: any) => scope.includes(t.userId))).length;
  const totalReferrals = usersList.filter((u: any) => !!u.referredBy).length;
  const referralIncome = totalReferrals * 300;
  const totalRevenue = paidUsers * 399;

  res.json({
    totalUsers,
    activeUsers,
    paidUsers,
    freeUsers,
    referralIncome,
    totalTrades,
    totalRevenue,
    pendingTickets: db?.supportTickets?.filter((t: any) => t.status === 'Open').length || 0,
    userGrowth: []
  });
});

app.post('/api/admin/users/:id/status', async (req, res) => {
  const ctx = await requirePermission(req, res, 'users.manage');
  if (!ctx) return;
  const { id } = req.params;
  const { status } = req.body;

  if (useSupabase) {
    const { error } = await supabase.from('users').update({ status }).eq('id', id);
    if (error) {
      console.error('Error updating supabase user:', error);
      return res.status(500).json({ error: 'Failed to update user status' });
    }
    await writeAuditLog(req, ctx, 'user.status', 'user', id, { status });
    return res.json({ message: `User status updated to ${status}` });
  }

  const db = (req as any).userDb;
  const idx = db?.users?.findIndex((u: any) => u.id === id);
  if (idx !== undefined && idx !== -1) {
    db.users[idx].status = status;
    res.json({ message: `User status updated to ${status}` });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

app.post('/api/admin/users/:id/plan', async (req, res) => {
  const ctx = await requirePermission(req, res, 'users.manage');
  if (!ctx) return;
  const { id } = req.params;
  const { isPro } = req.body;

  if (useSupabase) {
    const { error } = await supabase.from('users').update({
      is_pro: !!isPro,
      pro_until: isPro ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null
    }).eq('id', id);
    if (error) {
      console.error('Error updating user plan:', error);
      return res.status(500).json({ error: 'Failed to update user plan' });
    }
    userDatabases.delete(id);
    await writeAuditLog(req, ctx, isPro ? 'user.grant_pro' : 'user.revoke_pro', 'user', id);
    return res.json({ message: `User plan updated to ${isPro ? 'Pro' : 'Free'}` });
  }

  // req.userDb holds only the admin in local mode, so the grant went nowhere.
  // applyProState writes to the shared store and drops the target's cache.
  //
  // The lookup spans the caches as well as db.json: anyone who registered on
  // this server lives only in memory, so reading the file alone answered
  // "User not found" for every account that was not seeded — an admin could
  // grant Pro to the demo users and to nobody else.
  const target = localFindUser((u: any) => u.id === id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  await applyProState(id, isPro ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null);
  await writeAuditLog(req, ctx, isPro ? 'user.grant_pro' : 'user.revoke_pro', 'user', id);
  res.json({ message: `User plan updated to ${isPro ? 'Pro' : 'Free'}` });
});

app.get('/api/admin/bugs', async (req, res) => {
  const ctx = await requirePermission(req, res, 'tickets.read');
  if (!ctx) return;
  if (useSupabase) {
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('category', 'Bug')
      .order('date', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const tickets = await attachTicketUserNames(data || []);
    // Derive a priority badge from the severity embedded in the title
    const bugs = tickets.map((t: any) => {
      const m = /Severity:\s*(\w+)/i.exec(t.title || '');
      return { ...t, priority: (m?.[1] || 'Low').toUpperCase() };
    });
    return res.json({ bugs });
  }
  const tickets = await attachTicketUserNames(
    collectAllInMemoryTickets().filter((t: any) => t.category === 'Bug')
  );
  const bugs = tickets.map((t: any) => {
    const m = /Severity:\s*(\w+)/i.exec(t.title || '');
    return { ...t, priority: (m?.[1] || 'Low').toUpperCase() };
  });
  res.json({ bugs });
});

// ── Team / role management (SUPER_ADMIN & ADMIN) ──────────────────────────

app.get('/api/admin/team', async (req, res) => {
  const ctx = await requirePermission(req, res, 'users.roles');
  if (!ctx) return;
  if (!useSupabase) {
    // Shared file AND the caches: the per-caller local database holds only the
    // caller, and anyone who registered on this server lives in memory rather
    // than db.json, so reading either one alone leaves staff off the list.
    const team = localAllUsers()
      .filter((u: any) => ['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN', 'PARTNER', 'SUPPORT'].includes(u.role || ''))
      .map((u: any) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role || 'ADMIN',
        status: u.status || 'ACTIVE',
        lastLogin: u.lastLogin
      }));
    return res.json({
      team,
      roles: Object.keys(ROLE_PERMISSIONS).filter((r) => r !== 'USER'),
      permissions: ROLE_PERMISSIONS
    });
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, role, status, last_login')
    .in('role', ['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN', 'SUPPORT'])
    .order('role');
  if (error) {
    console.error('[GET /api/admin/team] error:', error);
    return res.status(500).json({ error: 'Failed to load team' });
  }
  res.json({
    team: (data || []).map(toCamel),
    roles: Object.keys(ROLE_PERMISSIONS).filter((r) => r !== 'USER'),
    permissions: ROLE_PERMISSIONS,
  });
});

app.post('/api/admin/team/role', async (req, res) => {
  const ctx = await requirePermission(req, res, 'users.roles');
  if (!ctx) return;

  const { email, role } = req.body || {};
  const targetEmail = String(email || '').toLowerCase().trim();
  if (!targetEmail || !role) return res.status(400).json({ error: 'email and role are required' });
  if (!ROLE_PERMISSIONS[role]) {
    return res.status(400).json({ error: `role must be one of: ${Object.keys(ROLE_PERMISSIONS).join(', ')}` });
  }
  // Without this an owner could demote themselves and lock everyone out of
  // role management, with no way back except editing the database by hand.
  if (targetEmail === String(ctx.user?.email || '').toLowerCase() && role !== 'SUPER_ADMIN') {
    return res.status(400).json({ error: 'You cannot remove your own owner access. Ask another owner to do it.' });
  }

  if (useSupabase) {
    const { data: target } = await supabase.from('users').select('id, role').eq('email', targetEmail).maybeSingle();
    if (!target) return res.status(404).json({ error: 'No account with that email.' });

    // Never let the last owner be demoted — same lockout, one step removed.
    if (target.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') {
      const { count } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'SUPER_ADMIN');
      if ((count ?? 0) <= 1) {
        return res.status(400).json({ error: 'This is the last owner account. Promote someone else first.' });
      }
    }

    const { error } = await supabase.from('users').update({ role }).eq('id', target.id);
    if (error) {
      console.error('[POST /api/admin/team/role] error:', error);
      return res.status(500).json({ error: 'Failed to update role' });
    }

    userDatabases.delete(target.id);
    await writeAuditLog(req, ctx, 'user.role', 'user', target.id, { email: targetEmail, from: target.role, to: role });
    return res.json({ message: `${targetEmail} is now ${role}.` });
  }

  // Local db fallback.
  //
  // req.userDb is the CALLER's database — in local mode that holds the admin
  // and nobody else, so looking the target up in it answered "No account with
  // that email" for every account that was not seeded. Team & Roles could
  // therefore only promote the demo users, which is the same lookup bug the
  // partner and plan routes had.
  const target = localFindUser((u: any) => u.email?.toLowerCase() === targetEmail);
  if (!target) return res.status(404).json({ error: 'No account with that email.' });

  const prevRole = target.role || 'USER';
  localPatchUser(target.id, (row) => { row.role = role; });
  await writeAuditLog(req, ctx, 'user.role', 'user', target.id, { email: targetEmail, from: prevRole, to: role });
  res.json({ message: `${targetEmail} is now ${role}.` });
});

// ── Audit trail ───────────────────────────────────────────────────────────

app.get('/api/admin/audit', async (req, res) => {
  const ctx = await requirePermission(req, res, 'audit.read');
  if (!ctx) return;
  if (!useSupabase) {
    return res.json({ entries: inMemoryAuditLogs.slice(0, 100) });
  }

  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '100'), 10) || 100, 1), 500);
  const { data, error } = await supabase
    .from('admin_audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[GET /api/admin/audit] error:', error);
    return res.status(500).json({ error: 'Failed to load the audit log' });
  }
  res.json({ entries: (data || []).map(toCamel) });
});

// ── Billing overview (SUPER_ADMIN only) ───────────────────────────────────

app.get('/api/admin/billing', async (req, res) => {
  const ctx = await requirePermission(req, res, 'billing.read');
  if (!ctx) return;
  if (!useSupabase) {
    const db = (req as any).userDb;
    const allUsers = db?.users || [];
    const paidUsers = allUsers.filter((u: any) => !!u.isPro);
    const freeUsers = Math.max(0, allUsers.length - paidUsers.length);
    
    // Referral calculation
    const referralLeaderboard = allUsers.map((u: any) => {
      const refCode = u.referralCode || ('FX-' + (u.id || '').replace(/\D/g, '').slice(-4).padStart(4, '8') || 'FX-100');
      const directRefs = allUsers.filter((o: any) => o.referredBy && (o.referredBy === u.id || o.referredBy === refCode));
      const paidRefs = directRefs.filter((o: any) => !!o.isPro).length;
      return {
        userId: u.id,
        name: u.name || 'Trader',
        email: u.email,
        referralCode: refCode,
        referralsCount: directRefs.length,
        paidReferralsCount: paidRefs,
        referralIncome: directRefs.length * 300
      };
    }).filter((r: any) => r.referralsCount > 0).sort((a: any, b: any) => b.referralsCount - a.referralsCount);

    const totalReferralIncome = referralLeaderboard.reduce((acc: number, r: any) => acc + r.referralIncome, 0);

    const payments = (db?.payments || []).length > 0 ? db.payments : [
      {
        id: 'pay_demo_01',
        userEmail: 'trader.sam@gmail.com',
        amount: 399,
        currency: 'INR',
        status: 'captured',
        method: 'card',
        paidAt: new Date(Date.now() - 2 * 86400000).toISOString()
      },
      {
        id: 'pay_demo_02',
        userEmail: 'alex.fx@proton.me',
        amount: 399,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
        paidAt: new Date(Date.now() - 5 * 86400000).toISOString()
      }
    ];

    const totalRev = payments.reduce((acc: number, p: any) => {
      const amt = p.amount ? (p.amount > 1000 ? p.amount / 100 : p.amount) : 399;
      return acc + amt;
    }, 0) || (Math.max(paidUsers.length, 2) * 399);

    return res.json({
      payments,
      subscriptions: [],
      activeCount: Math.max(paidUsers.length, 2),
      freeCount: freeUsers,
      totalUsers: allUsers.length || 2,
      mrr: Math.max(paidUsers.length, 2) * 399,
      totalRevenue: totalRev,
      currency: 'INR',
      totalReferralIncome,
      referralLeaderboard
    });
  }

  const [{ data: payments }, { data: subs }, { data: users }] = await Promise.all([
    supabase.from('payments').select('*').order('paid_at', { ascending: false }).limit(100),
    supabase.from('subscriptions').select('*').order('created_at', { ascending: false }).limit(200),
    supabase.from('users').select('id, email, name, is_pro, referral_code, referred_by')
  ]);

  const userMap = new Map<string, any>((users || []).map((u: any) => [u.id, u]));
  const enrichedPayments = (payments || []).map((p: any) => {
    const u = userMap.get(p.user_id);
    return {
      ...toCamel(p),
      userEmail: u?.email || p.user_email || 'subscriber@axyfx.com',
      userName: u?.name || 'Trader'
    };
  });

  const activeSubs = (subs || []).filter((s: any) => s.status === 'active');
  const paidUsersCount = (users || []).filter((u: any) => !!u.is_pro).length;
  const freeUsersCount = Math.max(0, (users?.length || 0) - paidUsersCount);

  const referralLeaderboard = (users || []).map((u: any) => {
    const refCode = u.referral_code || ('FX-' + (u.id || '').replace(/\D/g, '').slice(-4).padStart(4, '8') || 'FX-100');
    const directRefs = (users || []).filter((o: any) => o.referred_by && (o.referred_by === u.id || o.referred_by === refCode));
    const paidRefs = directRefs.filter((o: any) => !!o.is_pro).length;
    return {
      userId: u.id,
      name: u.name || 'Trader',
      email: u.email,
      referralCode: refCode,
      referralsCount: directRefs.length,
      paidReferralsCount: paidRefs,
      referralIncome: directRefs.length * 300
    };
  }).filter((r: any) => r.referralsCount > 0).sort((a: any, b: any) => b.referralsCount - a.referralsCount);

  const totalReferralIncome = referralLeaderboard.reduce((acc: number, r: any) => acc + r.referralIncome, 0);
  const totalRev = enrichedPayments.reduce((acc: number, p: any) => {
    const amt = p.amount ? (p.amount > 1000 ? p.amount / 100 : p.amount) : 399;
    return acc + amt;
  }, 0) || (paidUsersCount * 399);

  res.json({
    payments: enrichedPayments,
    subscriptions: (subs || []).map(toCamel),
    activeCount: activeSubs.length || paidUsersCount,
    freeCount: freeUsersCount,
    totalUsers: users?.length || 0,
    mrr: (activeSubs.length || paidUsersCount) * (PRO_PLAN_AMOUNT_PAISE / 100),
    totalRevenue: totalRev,
    currency: 'INR',
    totalReferralIncome,
    referralLeaderboard
  });
});

// ── Manual / Offline Payment Recording ───────────────────────────────────────
app.post('/api/admin/payments/record', async (req, res) => {
  const ctx = await requirePermission(req, res, 'users.manage');
  if (!ctx) return;
  const { userEmail, userId, amount = 399, method = 'upi', notes = '', plan = 'pro', days = 30 } = req.body || {};
  if (!userEmail && !userId) {
    return res.status(400).json({ error: 'User email or user ID is required' });
  }

  let targetUser: any = null;
  if (useSupabase) {
    const query = userId
      ? supabase.from('users').select('*').eq('id', userId).maybeSingle()
      : supabase.from('users').select('*').eq('email', userEmail.trim().toLowerCase()).maybeSingle();
    const { data } = await query;
    targetUser = data;
  } else {
    const db = (req as any).userDb;
    targetUser = (db?.users || []).find((u: any) => 
      (userId && u.id === userId) || (userEmail && u.email?.toLowerCase() === userEmail.trim().toLowerCase())
    );
  }

  if (!targetUser) {
    return res.status(404).json({ error: 'Trader account not found' });
  }

  const paymentId = `pay_manual_${crypto.randomUUID().slice(0, 8)}`;
  const proUntilDate = new Date(Date.now() + days * 86400000);

  // Apply Pro state
  await applyProState(targetUser.id, proUntilDate);

  // Record payment in payments table
  const paymentRecord = {
    id: paymentId,
    user_id: targetUser.id,
    provider: 'manual',
    provider_payment_id: `manual_${Date.now()}`,
    amount: Number(amount),
    currency: 'INR',
    plan,
    status: 'captured',
    paid_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  if (useSupabase) {
    await supabase.from('payments').insert(paymentRecord);
  } else {
    const db = (req as any).userDb;
    db.payments = db.payments || [];
    db.payments.unshift(toCamel(paymentRecord));
    await saveDatabase(db);
  }

  await writeAuditLog(req, ctx, 'payment.manual_record', 'payment', paymentId, {
    targetUserId: targetUser.id,
    targetEmail: targetUser.email,
    amount,
    method,
    notes,
    proUntil: proUntilDate.toISOString()
  });

  res.json({
    success: true,
    message: `Recorded ₹${amount} offline payment for ${targetUser.email}. Pro plan activated for ${days} days.`,
    paymentId,
    proUntil: proUntilDate.toISOString()
  });
});

app.get('/api/admin/features', async (req, res) => {
  const ctx = await requirePermission(req, res, 'tickets.read');
  if (!ctx) return;
  if (useSupabase) {
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('category', 'Feature Request')
      .order('date', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const features = await attachTicketUserNames(data || []);
    return res.json({ features });
  }
  const features = await attachTicketUserNames(
    collectAllInMemoryTickets().filter((t: any) => t.category === 'Feature Request')
  );
  res.json({ features });
});

// ==========================================
// FX NEWS & ECONOMIC CALENDAR
// ==========================================

// Optional upstream base-URL overrides (useful for testing or proxying).
const ALPHA_VANTAGE_BASE = (process.env.ALPHA_VANTAGE_BASE_URL || 'https://www.alphavantage.co').trim().replace(/\/+$/, '');
const FMP_BASE = (process.env.FMP_BASE_URL || 'https://financialmodelingprep.com').trim().replace(/\/+$/, '');
const FINNHUB_BASE = (process.env.FINNHUB_BASE_URL || 'https://finnhub.io').trim().replace(/\/+$/, '');
const XOOMAR_BASE = (process.env.XOOMAR_BASE_URL || 'https://xoomar.com').trim().replace(/\/+$/, '');

// Simple in-memory TTL cache so upstream APIs are only hit once per window.
const apiCache = new Map<string, { data: unknown; expiresAt: number }>();

function getCached<T>(key: string): T | undefined {
  const entry = apiCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    apiCache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

function setCached(key: string, data: unknown, ttlMs: number) {
  apiCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

async function fetchJson(url: string, timeoutMs = 15000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FXJournalPro/1.0', Accept: 'application/json' },
    });
    if (!res.ok) {
      const err = new Error(`Upstream API responded with ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---- FX News (Alpha Vantage News & Sentiment) ----

const NEWS_CATEGORY_ORDER = [
  'Market Analysis',
  'Central Banks',
  'Interest Rates',
  'Inflation',
  'Employment',
  'GDP',
  'Commodities',
  'Geopolitics',
  'Government',
];

// Alpha Vantage topic -> our display category (best-effort mapping).
const AV_TOPIC_CATEGORY: Record<string, string> = {
  financial_markets: 'Market Analysis',
  economy_monetary: 'Central Banks',
  economy_fiscal: 'Government',
  economy_macro: 'GDP',
  energy_transportation: 'Commodities',
  technology: 'Market Analysis',
  mergers_and_acquisitions: 'Market Analysis',
  retail_wholesale: 'Market Analysis',
};

const FX_NEWS_TOPICS = 'financial_markets,economy_monetary,economy_macro,economy_fiscal';

const CURRENCY_NAMES: Record<string, string> = {
  USD: 'U.S. Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  JPY: 'Japanese Yen',
  AUD: 'Australian Dollar',
  CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc',
  NZD: 'New Zealand Dollar',
  CNY: 'Chinese Yuan',
};

const MAJOR_PAIRS = [
  'EUR/USD', 'USD/JPY', 'GBP/USD', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD',
  'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'EUR/CHF', 'EUR/AUD', 'AUD/JPY', 'USD/CNY', 'USD/CNH',
];

function mapTopicToCategory(topics: string[]): string {
  for (const t of topics) {
    const mapped = AV_TOPIC_CATEGORY[t.toLowerCase()];
    if (mapped) return mapped;
  }
  return 'Market Analysis';
}

function deriveSentimentLabel(score: number | null): string {
  if (score === null) return 'Neutral';
  if (score >= 0.35) return 'Bullish';
  if (score <= -0.35) return 'Bearish';
  if (score > 0.1) return 'Somewhat Bullish';
  if (score < -0.1) return 'Somewhat Bearish';
  return 'Neutral';
}

function detectCurrenciesAndPairs(text: string, tickers: string[]): { currencies: string[]; pairs: string[] } {
  const currencies = new Set<string>();
  const pairs = new Set<string>();
  const upper = ` ${text.toUpperCase()} `;

  for (const pair of MAJOR_PAIRS) {
    if (upper.includes(pair)) {
      pairs.add(pair);
      const [a, b] = pair.split('/');
      if (CURRENCY_NAMES[a]) currencies.add(a);
      if (CURRENCY_NAMES[b]) currencies.add(b);
    }
  }

  for (const code of Object.keys(CURRENCY_NAMES)) {
    if (new RegExp(`\\b${code}\\b`).test(upper)) currencies.add(code);
  }

  // Forex-style tickers from the API (e.g. FOREX:EURUSD or EURUSD)
  for (const tk of tickers || []) {
    const clean = tk.replace(/^FOREX:+/i, '').replace(/[^A-Za-z/]/g, '');
    const m = /^([A-Z]{3})\/?([A-Z]{3})$/.exec(clean);
    if (m) {
      if (CURRENCY_NAMES[m[1]] && CURRENCY_NAMES[m[2]]) {
        pairs.add(`${m[1]}/${m[2]}`);
        currencies.add(m[1]);
        currencies.add(m[2]);
      } else if (CURRENCY_NAMES[m[1]]) {
        currencies.add(m[1]);
      }
    }
  }

  return {
    currencies: Array.from(currencies),
    pairs: Array.from(pairs),
  };
}

function normalizeNewsArticle(item: any) {
  const title = (item?.title || '').trim();
  if (!title) return null;

  const timePublished = (item?.time_published || '').trim();
  let publishedAt = '';
  if (/^\d{8}T\d{6}$/.test(timePublished)) {
    publishedAt = `${timePublished.slice(0, 4)}-${timePublished.slice(4, 6)}-${timePublished.slice(6, 8)}T${timePublished.slice(9, 11)}:${timePublished.slice(11, 13)}:${timePublished.slice(13, 15)}Z`;
  } else {
    const d = new Date(timePublished);
    if (!isNaN(d.getTime())) publishedAt = d.toISOString();
  }

  const topics = Array.isArray(item?.topics) ? item.topics.map((t: any) => (t?.topic || '')).filter(Boolean) : [];
  const category = mapTopicToCategory(topics);

  const sentimentScore = typeof item?.overall_sentiment_score === 'number' ? item.overall_sentiment_score : null;
  const sentimentLabel = item?.overall_sentiment_label || deriveSentimentLabel(sentimentScore);

  const tickers = Array.isArray(item?.ticker_sentiment)
    ? item.ticker_sentiment.map((t: any) => (t?.ticker || '')).filter(Boolean)
    : [];

  const { currencies, pairs } = detectCurrenciesAndPairs(`${title} ${item?.summary || ''}`, tickers);

  return {
    id: item?.url || title,
    title,
    summary: (item?.summary || '').trim(),
    url: item?.url || '#',
    source: item?.source || 'Unknown',
    publishedAt,
    category,
    currencies,
    pairs,
    sentiment: { score: sentimentScore, label: sentimentLabel },
  };
}


const YAHOO_SYMBOL_MAP: Record<string, string> = {
  // Metals
  XAUUSD: 'GC=F', GOLD: 'GC=F',
  XAGUSD: 'SI=F', SILVER: 'SI=F',
  XPTUSD: 'PL=F', XPDUSD: 'PA=F',
  // Forex pairs
  EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X',
  USDCHF: 'USDCHF=X', USDCAD: 'USDCAD=X', AUDUSD: 'AUDUSD=X',
  NZDUSD: 'NZDUSD=X', EURGBP: 'EURGBP=X', EURJPY: 'EURJPY=X',
  EURAUD: 'EURAUD=X', EURCAD: 'EURCAD=X', EURCHF: 'EURCHF=X',
  EURNZD: 'EURNZD=X', GBPJPY: 'GBPJPY=X', GBPAUD: 'GBPAUD=X',
  GBPCAD: 'GBPCAD=X', GBPCHF: 'GBPCHF=X', GBPNZD: 'GBPNZD=X',
  AUDJPY: 'AUDJPY=X', AUDCAD: 'AUDCAD=X', AUDCHF: 'AUDCHF=X',
  AUDNZD: 'AUDNZD=X', NZDJPY: 'NZDJPY=X', NZDCAD: 'NZDCAD=X',
  NZDCHF: 'NZDCHF=X', CADJPY: 'CADJPY=X', CADCHF: 'CADCHF=X',
  CHFJPY: 'CHFJPY=X',
  // Crypto
  BTCUSD: 'BTC-USD', ETHUSD: 'ETH-USD', LTCUSD: 'LTC-USD', XRPUSD: 'XRP-USD',
  // Indices
  US30: '^DJI', US500: '^GSPC', NAS100: '^NDX',
  UK100: '^FTSE', GER40: '^GDAXI', JPN225: '^N225',
  // Oil
  USOIL: 'CL=F', UKOIL: 'BZ=F',
};

// Interval/range mapping: timeframe param → { interval, range } for Yahoo Finance v8 API
const YAHOO_INTERVAL_MAP: Record<string, { interval: string; range: string }> = {
  '1m': { interval: '1m', range: '7d' },
  '5m': { interval: '5m', range: '60d' },
  '15m': { interval: '15m', range: '60d' },
  '30m': { interval: '30m', range: '60d' },
  '1h': { interval: '60m', range: '730d' },
  '4h': { interval: '60m', range: '730d' }, // Yahoo doesn't have 4h, we use 1h and resample client-side
  '1d': { interval: '1d', range: '20y' },
  '1mo': { interval: '1mo', range: 'max' },
};


app.get('/api/chart/ohlc', async (req, res) => {
  // Live Chart's only data source. It was reachable without even being signed
  // in, so hiding the tab from free users did nothing: the candles were one
  // URL away. Everything the chart draws now goes through this gate.
  if (!requirePro(req, res, 'liveChart')) return;
  try {
    const rawSymbol = ((req.query.symbol as string) || 'XAUUSD').toUpperCase().trim();
    const timeframe = ((req.query.timeframe as string) || '1d').toLowerCase().trim();

    // Translate to Yahoo Finance ticker
    const yahooSymbol = YAHOO_SYMBOL_MAP[rawSymbol] || (rawSymbol.endsWith('=X') ? rawSymbol : `${rawSymbol}=X`);
    const mapping = YAHOO_INTERVAL_MAP[timeframe] || YAHOO_INTERVAL_MAP['1d'];

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${mapping.interval}&range=${mapping.range}&includePrePost=false`;

    const yahooRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FXJournalPro/1.0)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!yahooRes.ok) {
      console.warn(`[chart/ohlc] Yahoo Finance returned ${yahooRes.status} for ${yahooSymbol}`);
      return res.json({ candles: [], symbol: rawSymbol, timeframe, error: 'No data available for this symbol.' });
    }

    const data: any = await yahooRes.json();
    const result = data?.chart?.result?.[0];

    if (!result) {
      return res.json({ candles: [], symbol: rawSymbol, timeframe, error: 'No chart data from provider.' });
    }

    const timestamps: number[] = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const opens: (number | null)[] = quotes.open || [];
    const highs: (number | null)[] = quotes.high || [];
    const lows: (number | null)[] = quotes.low || [];
    const closes: (number | null)[] = quotes.close || [];

    // For 4h timeframe, we receive 1h candles from Yahoo — aggregate every 4 into one
    let candles: { time: number; open: number; high: number; low: number; close: number }[] = [];

    if (timeframe === '4h') {
      // Aggregate 1h bars → 4h bars
      let i = 0;
      while (i < timestamps.length) {
        const group = [];
        for (let j = 0; j < 4 && i + j < timestamps.length; j++) {
          const idx = i + j;
          if (opens[idx] != null && highs[idx] != null && lows[idx] != null && closes[idx] != null) {
            group.push({ t: timestamps[idx], o: opens[idx]!, h: highs[idx]!, l: lows[idx]!, c: closes[idx]! });
          }
        }
        if (group.length > 0) {
          candles.push({
            time: group[0].t,
            open: group[0].o,
            high: Math.max(...group.map(g => g.h)),
            low: Math.min(...group.map(g => g.l)),
            close: group[group.length - 1].c,
          });
        }
        i += 4;
      }
    } else {
      candles = timestamps
        .map((t, i) => ({
          time: t,
          open: opens[i] ?? 0,
          high: highs[i] ?? 0,
          low: lows[i] ?? 0,
          close: closes[i] ?? 0,
        }))
        .filter(c => c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0);
    }

    // Deduplicate by timestamp and sort ascending
    const seen = new Set<number>();
    candles = candles
      .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true; })
      .sort((a, b) => a.time - b.time);

    res.json({ candles, symbol: rawSymbol, timeframe });
  } catch (err: any) {
    console.error('[chart/ohlc] Error:', err?.message || err);
    res.json({ candles: [], symbol: req.query.symbol || '', timeframe: req.query.timeframe || '1d', error: 'Chart data temporarily unavailable.' });
  }
});

app.get('/api/fx-news', async (req, res) => {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '25'), 10) || 25, 1), 50);

  if (!apiKey) {
    return res.status(503).json({
      error: 'FX news is not configured. Add ALPHA_VANTAGE_API_KEY to your environment.',
      code: 'NOT_CONFIGURED',
    });
  }

  const cacheKey = `fx-news:${limit}`;
  try {
    let articles = getCached<any[]>(cacheKey);
    if (!articles) {
      const url = `${ALPHA_VANTAGE_BASE}/query?function=NEWS_SENTIMENT&topics=${FX_NEWS_TOPICS}&limit=${limit}&sort=LATEST&apikey=${encodeURIComponent(apiKey)}`;
      const data = await fetchJson(url);
      // Alpha Vantage returns HTTP 200 with a "Note"/"Information" key when rate-limited.
      if (data?.Note || data?.Information || data?.Error) {
        console.warn('[GET /api/fx-news] Provider rate limit or info message:', data?.Note || data?.Information || data?.Error);
        return res.status(429).json({
          error: 'The news provider rate limit has been reached. Please try again later.',
          code: 'RATE_LIMITED',
        });
      }
      const feed = Array.isArray(data?.feed) ? data.feed : [];
      articles = feed.map(normalizeNewsArticle).filter(Boolean);
      setCached(cacheKey, articles, 15 * 60 * 1000);
    }

    let filtered = articles;
    const topic = typeof req.query.topic === 'string' ? req.query.topic : '';
    const currency = typeof req.query.currency === 'string' ? req.query.currency.toUpperCase() : '';
    if (topic) filtered = filtered.filter(a => a.category === topic);
    if (currency) filtered = filtered.filter(a => a.currencies.includes(currency));

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      articles: filtered,
      categories: NEWS_CATEGORY_ORDER,
      source: 'Alpha Vantage News & Sentiment',
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[GET /api/fx-news] error:', err?.message || err);
    res.status(502).json({
      error: 'Unable to fetch FX news right now. Please try again shortly.',
      code: 'UPSTREAM_ERROR',
    });
  }
});

// ---- Economic Calendar (modular provider architecture) ----

interface EconomicEvent {
  id: string;
  date: string; // ISO 8601 UTC
  currency: string;
  country: string;
  event: string;
  impact: 'high' | 'medium' | 'low' | 'none';
  actual: string | null;
  forecast: string | null;
  previous: string | null;
}

interface EconomicCalendarProvider {
  name: string;
  /** Message shown when the provider's API key is missing from the environment. */
  notConfiguredMessage: string;
  configured(): boolean;
  fetchEvents(from: string, to: string): Promise<EconomicEvent[]>;
}

const COUNTRY_TO_CURRENCY: Record<string, string> = {
  US: 'USD', EU: 'EUR', EMU: 'EUR', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR',
  GB: 'GBP', UK: 'GBP', JP: 'JPY', AU: 'AUD', CA: 'CAD', CH: 'CHF', NZ: 'NZD',
  CN: 'CNY', HK: 'HKD', KR: 'KRW', SG: 'SGD', IN: 'INR', BR: 'BRL', MX: 'MXN',
  ZA: 'ZAR', TR: 'TRY', RU: 'RUB', ID: 'IDR', TH: 'THB', MY: 'MYR', PH: 'PHP',
  SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON',
  GR: 'EUR', PT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', FI: 'EUR', IE: 'EUR',
};

function normalizeImpact(value: unknown): EconomicEvent['impact'] {
  const s = String(value || '').toLowerCase();
  if (s.startsWith('high')) return 'high';
  if (s.startsWith('med')) return 'medium';
  if (s.startsWith('low')) return 'low';
  return 'none';
}

function toIsoUtc(dateStr: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  const asIso = trimmed.replace(' ', 'T');
  const d = new Date(asIso.endsWith('Z') ? asIso : `${asIso}Z`);
  if (!isNaN(d.getTime())) return d.toISOString();
  const d2 = new Date(trimmed);
  if (!isNaN(d2.getTime())) return d2.toISOString();
  return '';
}

// Financial Modeling Prep provider.
// The legacy /api/v3/economic_calendar endpoint was retired by FMP (2025-08-31);
// the current route is /stable/economic-calendar and requires a paid FMP plan.
class ProviderAccessError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

const economicCalendarProviders: Record<string, EconomicCalendarProvider> = {
  // Xoomar Economic Calendar — genuinely free, no API key required (30 req/min/IP).
  // US macro releases synced weekly from BLS, the Fed, and BEA (CPI, NFP, FOMC, GDP).
  // Docs: https://xoomar.com/markets/api/calendar
  xoomar: {
    name: 'Xoomar Economic Calendar (BLS/Fed/BEA)',
    notConfiguredMessage: 'Economic calendar is not configured.',
    configured: () => true,
    async fetchEvents(from, to) {
      const url = `${XOOMAR_BASE}/api/markets/calendar?from=${from}&to=${to}`;
      const data = await fetchJson(url);
      const rows = Array.isArray(data?.data) ? data.data : [];
      const fromMs = new Date(`${from}T00:00:00.000Z`).getTime();
      const toMs = new Date(`${to}T23:59:59.999Z`).getTime();
      const events: EconomicEvent[] = [];
      for (const row of rows) {
        const eventName = (row?.eventName || '').toString().trim();
        if (!eventName) continue;
        const date = toIsoUtc((row?.scheduledAt || '').toString());
        if (!date) continue;
        const eventMs = new Date(date).getTime();
        if (eventMs < fromMs || eventMs > toMs) continue;
        const numOrDash = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v).trim());
        events.push({
          id: `${date}:USD:${eventName}`,
          date,
          currency: 'USD',
          country: 'US',
          event: eventName,
          impact: normalizeImpact(row?.importance),
          actual: numOrDash(row?.actual),
          forecast: numOrDash(row?.forecast),
          previous: numOrDash(row?.previous),
        });
      }
      return events;
    },
  },
  // Finnhub Economic Calendar — free tier (60 calls/min) includes this endpoint.
  // Docs: https://finnhub.io/docs/api/economic-calendar
  finnhub: {
    name: 'Finnhub Economic Calendar',
    notConfiguredMessage: 'Economic calendar is not configured. Add FINNHUB_API_KEY to your environment.',
    configured: () => Boolean(process.env.FINNHUB_API_KEY?.trim()),
    async fetchEvents(from, to) {
      const apiKey = process.env.FINNHUB_API_KEY?.trim();
      if (!apiKey) throw new Error('FINNHUB_API_KEY is not configured');
      const url = `${FINNHUB_BASE}/api/v1/calendar/economic?from=${from}&to=${to}&token=${encodeURIComponent(apiKey)}`;
      let data: any;
      try {
        data = await fetchJson(url);
      } catch (err: any) {
        if (err?.status === 401 || err?.status === 403) {
          throw new ProviderAccessError('Your Finnhub API key is invalid or has no access to the Economic Calendar.', 'RESTRICTED');
        }
        if (err?.status === 429) {
          throw new ProviderAccessError('Finnhub rate limit reached. Please try again shortly.', 'RATE_LIMITED');
        }
        throw err;
      }
      const rows = Array.isArray(data?.economicCalendar) ? data.economicCalendar : [];
      const fromMs = new Date(`${from}T00:00:00.000Z`).getTime();
      const toMs = new Date(`${to}T23:59:59.999Z`).getTime();
      const events: EconomicEvent[] = [];
      for (const row of rows) {
        const eventName = (row?.event || '').toString().trim();
        if (!eventName) continue;
        const country = (row?.country || '').toString().toUpperCase().trim();
        const date = toIsoUtc((row?.time || '').toString());
        if (!date) continue;
        const eventMs = new Date(date).getTime();
        if (eventMs < fromMs || eventMs > toMs) continue;
        const currency = COUNTRY_TO_CURRENCY[country] || country || '--';
        const numOrDash = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v).trim());
        events.push({
          id: `${date}:${currency}:${eventName}`,
          date,
          currency,
          country,
          event: eventName,
          impact: normalizeImpact(row?.impact),
          actual: numOrDash(row?.actual),
          forecast: numOrDash(row?.estimate),
          previous: numOrDash(row?.prev),
        });
      }
      return events;
    },
  },
  fmp: {
    name: 'Financial Modeling Prep Economic Calendar',
    notConfiguredMessage: 'Economic calendar is not configured. Add FMP_API_KEY to your environment.',
    configured: () => Boolean(process.env.FMP_API_KEY?.trim()),
    async fetchEvents(from, to) {
      const apiKey = process.env.FMP_API_KEY?.trim();
      if (!apiKey) throw new Error('FMP_API_KEY is not configured');
      const url = `${FMP_BASE}/stable/economic-calendar?from=${from}&to=${to}&apikey=${encodeURIComponent(apiKey)}`;
      let data: any;
      try {
        data = await fetchJson(url);
      } catch (err: any) {
        if (err?.status === 402) {
          throw new ProviderAccessError(
            'Your Financial Modeling Prep plan does not include the Economic Calendar. Upgrade your FMP plan or switch providers.',
            'RESTRICTED'
          );
        }
        if (err?.status === 403) {
          throw new ProviderAccessError(
            'Your Financial Modeling Prep API key does not have access to the Economic Calendar.',
            'RESTRICTED'
          );
        }
        throw err;
      }
      const rows = Array.isArray(data) ? data : [];
      const fromMs = new Date(`${from}T00:00:00.000Z`).getTime();
      const toMs = new Date(`${to}T23:59:59.999Z`).getTime();
      const events: EconomicEvent[] = [];
      for (const row of rows) {
        const eventName = (row?.event || '').toString().trim();
        if (!eventName) continue;
        const country = (row?.country || '').toString().toUpperCase().trim();
        const date = toIsoUtc((row?.date || '').toString());
        if (!date) continue;
        const eventMs = new Date(date).getTime();
        if (eventMs < fromMs || eventMs > toMs) continue;
        const currencyRaw = (row?.currency || '').toString().toUpperCase().trim();
        const numOrDash = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v).trim());
        events.push({
          id: `${date}:${currencyRaw || country}:${eventName}`,
          date,
          currency: currencyRaw || COUNTRY_TO_CURRENCY[country] || country || '--',
          country,
          event: eventName,
          impact: normalizeImpact(row?.impact),
          actual: numOrDash(row?.actual),
          forecast: numOrDash(row?.estimate),
          previous: numOrDash(row?.previous),
        });
      }
      return events;
    },
  },
};

app.get('/api/economic-calendar', async (req, res) => {
  const providerName = (process.env.ECONOMIC_CALENDAR_PROVIDER || 'xoomar').toLowerCase();
  const provider = economicCalendarProviders[providerName];
  if (!provider) {
    return res.status(500).json({ error: `Unknown economic calendar provider: ${providerName}` });
  }
  if (!provider.configured()) {
    return res.status(503).json({
      error: provider.notConfiguredMessage,
      code: 'NOT_CONFIGURED',
    });
  }

  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const today = new Date();
  const fromRaw = req.query.from;
  const toRaw = req.query.to;
  const from = typeof fromRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : fmtDate(today);
  const to = typeof toRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : fmtDate(new Date(today.getTime() + 21 * 86400000));

  const cacheKey = `economic-calendar:${providerName}:${from}:${to}`;
  try {
    let events = getCached<EconomicEvent[]>(cacheKey);
    if (!events) {
      events = await provider.fetchEvents(from, to);
      setCached(cacheKey, events, 10 * 60 * 1000);
    }

    const impact = typeof req.query.impact === 'string' ? req.query.impact.toLowerCase() : '';
    const currency = typeof req.query.currency === 'string' ? req.query.currency.toUpperCase() : '';
    let filtered = events;
    if (['high', 'medium', 'low'].includes(impact)) {
      filtered = filtered.filter(e => e.impact === impact);
    }
    if (currency) filtered = filtered.filter(e => e.currency === currency);

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      events: filtered,
      provider: provider.name,
      from,
      to,
      timezone: 'UTC',
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    if (err?.code === 'RESTRICTED') {
      console.error('[GET /api/economic-calendar] restricted:', err?.message || err);
      return res.status(403).json({
        error: err?.message || 'Your economic calendar provider is not accessible with the current plan.',
        code: 'RESTRICTED',
      });
    }
    if (err?.code === 'RATE_LIMITED') {
      console.error('[GET /api/economic-calendar] rate limited:', err?.message || err);
      return res.status(429).json({
        error: err?.message || 'Economic calendar provider rate limit reached. Please try again later.',
        code: 'RATE_LIMITED',
      });
    }
    console.error('[GET /api/economic-calendar] error:', err?.message || err);
    res.status(502).json({
      error: 'Economic calendar data is temporarily unavailable.',
      code: 'UPSTREAM_ERROR',
    });
  }
});

// ==========================================
// WHATSAPP REMINDERS (Pro users)
// ==========================================

/**
 * In-memory store for WhatsApp reminders (Dev/Demo).
 * In production, these should be stored in the DB and dispatched by a cron.
 */
const whatsappReminders: Array<{
  id: string;
  userId: string;
  eventId: string;
  eventName: string;
  eventDate: string;
  currency: string;
  impact: string;
  phone: string;
  minutesBefore: number;
  createdAt: string;
}> = [];

// POST /api/reminders/whatsapp – save a reminder preference
app.post('/api/reminders/whatsapp', async (req, res) => {
  try {
    const currentUser = (req as any).currentUser as User | undefined;
    if (!currentUser) return res.status(401).json({ error: 'Not authenticated.' });
    if (!currentUser.isPro) {
      return res.status(403).json({ error: 'WhatsApp reminders are a Pro feature. Please upgrade to access this.' });
    }

    const { eventId, eventName, eventDate, currency, impact, phone, minutesBefore } = req.body;
    if (!eventId || !eventName || !eventDate || !phone) {
      return res.status(400).json({ error: 'Missing required fields: eventId, eventName, eventDate, phone.' });
    }
    if (!/^\+?[\d\s\-()]{7,20}$/.test(String(phone).trim())) {
      return res.status(400).json({ error: 'Invalid phone number format.' });
    }
    const mins = Number(minutesBefore) || 15;
    if (mins < 5 || mins > 1440) {
      return res.status(400).json({ error: 'minutesBefore must be between 5 and 1440.' });
    }

    // Remove any existing reminder for this user+event
    const idx = whatsappReminders.findIndex(r => r.userId === currentUser.id && r.eventId === eventId);
    if (idx !== -1) whatsappReminders.splice(idx, 1);

    const reminder = {
      id: crypto.randomUUID(),
      userId: currentUser.id,
      eventId: String(eventId),
      eventName: String(eventName),
      eventDate: String(eventDate),
      currency: String(currency || ''),
      impact: String(impact || ''),
      phone: String(phone).trim(),
      minutesBefore: mins,
      createdAt: new Date().toISOString(),
    };
    whatsappReminders.push(reminder);

    console.log(`[WhatsApp Reminder] Set for user ${currentUser.id} – ${eventName} at ${eventDate}, ${mins}m before → ${phone}`);
    res.json({ success: true, reminder });
  } catch (err: any) {
    console.error('[POST /api/reminders/whatsapp]', err?.message || err);
    res.status(500).json({ error: 'Failed to save reminder.' });
  }
});

// DELETE /api/reminders/whatsapp/:eventId – cancel a specific reminder
app.delete('/api/reminders/whatsapp/:eventId', (req, res) => {
  const currentUser = (req as any).currentUser as User | undefined;
  if (!currentUser) return res.status(401).json({ error: 'Not authenticated.' });
  const { eventId } = req.params;
  const idx = whatsappReminders.findIndex(r => r.userId === currentUser.id && r.eventId === eventId);
  if (idx !== -1) {
    whatsappReminders.splice(idx, 1);
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Reminder not found.' });
});

// GET /api/reminders/whatsapp – list all reminders for current user
app.get('/api/reminders/whatsapp', (req, res) => {
  const currentUser = (req as any).currentUser as User | undefined;
  if (!currentUser) return res.status(401).json({ error: 'Not authenticated.' });
  const mine = whatsappReminders.filter(r => r.userId === currentUser.id);
  res.json({ reminders: mine });
});

// ==========================================
// VITE DEV SERVER OR STATIC ASSET PRODUCTION
// ==========================================

// In development on a long-lived host, load the Vite dev server
if (IS_DEV) {
  import('vite').then(({ createServer }) => {
    createServer({
      server: { middlewareMode: true },
      appType: 'spa'
    }).then((vite) => {
      app.use(vite.middlewares);
      startCloudWorker();
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`[AxyFx Journal Server] Dev listening on http://0.0.0.0:${PORT}`);
      });
    });
  }).catch(err => {
    console.error('Vite Dev Server creation failed:', err);
  });
} else if (!IS_SERVERLESS) {
  // Static hosting inside Express is only needed on a self-hosted production
  // box. Vercel and Netlify serve dist/ from their own CDN.
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });

  startCloudWorker();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[AxyFx Journal Server] Prod listening on http://0.0.0.0:${PORT}`);
  });
}

export default app;

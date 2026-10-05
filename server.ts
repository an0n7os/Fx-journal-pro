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
import { createMt5Router } from './src/mt5-integration-kit/backend/mt5Router.js';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import Razorpay from 'razorpay';
// metaapi.cloud-sdk is NOT a dependency any more — see getCloudApi() for why
// and for how to put it back.
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { auth as betterAuthInstance, autoMigrateBetterAuth } from './auth.js';

// Run Better Auth auto-migrations on boot
autoMigrateBetterAuth().catch((err) => console.error('[Better Auth] Auto-migrate failed:', err?.message || err));

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
 * come back in the response, and DEV_ACCOUNT_EMAIL is a SUPER_ADMIN.
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

/**
 * The single developer account, for local work and the test suite.
 *
 * This replaces the demo identities that used to be scattered across the
 * codebase: a hardcoded SUPER_ADMIN on admin@axyfx.com and demo@axyfx.com, a
 * real person's address seeded with their trades, a sub-admin seed script and
 * two seed SQL files carrying ten more. Anything that mints a privileged
 * account from a name the caller controls is a back door wherever it is
 * reachable, and sample rows in source become someone's revenue figures.
 *
 * Nothing here exists in production: IS_DEV gates the hash, so the account
 * cannot be signed into on a live deployment even if the email is guessed.
 * Set DEV_ADMIN_PASSWORD to choose the password; without it there is no
 * developer account at all.
 */
const DEV_ACCOUNT_ID = 'user_dev';
const DEV_ACCOUNT_EMAIL = IS_DEV
  ? (process.env.DEV_ACCOUNT_EMAIL?.trim().toLowerCase() || 'dev@localhost')
  : '';
const DEV_ADMIN_PASSWORD_HASH = (() => {
  const custom = process.env.DEV_ADMIN_PASSWORD?.trim();
  if (!IS_DEV || !custom) return '';
  return bcrypt.hashSync(custom, 10);
})();

const SUPER_ADMIN_EMAILS = new Set([
  'akshayrajak222@gmail.com',
  ...(process.env.SUPER_ADMIN_EMAILS ? process.env.SUPER_ADMIN_EMAILS.split(',').map((e: string) => e.trim().toLowerCase()) : []),
  ...(DEV_ACCOUNT_EMAIL ? [DEV_ACCOUNT_EMAIL.toLowerCase().trim()] : []),
]);

const isSuperAdminEmail = (email?: string | null): boolean => {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.has(email.toLowerCase().trim());
};

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
  // A brand-new local store: the developer account and nothing else.
  //
  // This used to seed a demo SUPER_ADMIN, a named real person's email with
  // their account and eleven of their trades, plus announcements. That is
  // sample data living in application source — a real address in a public
  // repository, and rows that show up as revenue and activity on the admin
  // dashboard of any deployment that ever falls back to the file store.
  //
  // The developer account is created only outside production, from
  // DEV_ACCOUNT_EMAIL / DEV_ADMIN_PASSWORD, so there is no identity here that
  // a live site could be signed into.
  // `any[]`, matching createEmptyUserDb below: the User type has no `role`,
  // and the seed needs one to make the developer account a SUPER_ADMIN.
  const devUsers: any[] = DEV_ACCOUNT_EMAIL && DEV_ADMIN_PASSWORD_HASH ? [
      {
        id: DEV_ACCOUNT_ID,
        email: DEV_ACCOUNT_EMAIL,
        name: 'Developer',
        password: DEV_ADMIN_PASSWORD_HASH,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        isEmailVerified: true,
        experience: 'Professional',
        tradingStyle: 'Day Trading',
        mainMarkets: ['Forex', 'Gold'],
        onboardingCompleted: true,
        isPro: true,
        // The local store has no column defaults, so a seeded row without this
        // reads "Joined: N/A" in the user registry.
        createdAt: new Date().toISOString(),
      },
    ] : [];

  const initialDB = {
    users: devUsers as User[],
    accounts: [] as TradingAccount[],
    trades: [] as Trade[],
    riskSettings: [] as RiskSettings[],
    supportTickets: [] as SupportTicket[],
    announcements: [] as Announcement[],
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
  const heading = isReset ? 'Reset your password' : 'Verify your email';
  const subheading = isReset
    ? 'Use the code below to reset your FX Journal Pro password.'
    : 'Use the code below to verify your FX Journal Pro account.';
  const footerNote = isReset
    ? 'This code expires in 10 minutes. If you did not request a password reset, you can safely ignore this email.'
    : 'This code expires in 10 minutes. If you did not create an account with FX Journal Pro, you can safely ignore this email.';

  // Premium branded HTML email template
  const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background-color:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0f1e;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%);border-radius:16px;border:1px solid rgba(139,92,246,0.2);overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid rgba(139,92,246,0.15);">
          <div style="display:inline-flex;align-items:center;gap:8px;">
            <span style="font-size:22px;font-weight:800;background:linear-gradient(135deg,#a78bfa,#60a5fa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;color:#a78bfa;">FX Journal Pro</span>
          </div>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px;">
          <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#f1f5f9;text-align:center;">${heading}</h1>
          <p style="margin:0 0 32px;font-size:15px;color:#94a3b8;text-align:center;line-height:1.6;">${subheading}</p>
          <!-- OTP Code Box -->
          <div style="background:rgba(139,92,246,0.08);border:1.5px solid rgba(139,92,246,0.3);border-radius:12px;padding:28px;text-align:center;margin-bottom:32px;">
            <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:2px;color:#8b5cf6;text-transform:uppercase;">Verification Code</p>
            <div style="font-size:40px;font-weight:800;letter-spacing:12px;color:#f1f5f9;font-variant-numeric:tabular-nums;">${otp}</div>
          </div>
          <p style="margin:0;font-size:13px;color:#64748b;text-align:center;line-height:1.6;">${footerNote}</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 40px 28px;border-top:1px solid rgba(139,92,246,0.15);text-align:center;">
          <p style="margin:0;font-size:12px;color:#475569;">© ${new Date().getFullYear()} FX Journal Pro · <a href="https://fxjournalpro.com" style="color:#7c3aed;text-decoration:none;">fxjournalpro.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
      ? (configuredFrom.includes('<') ? configuredFrom : `FX Journal Pro <${configuredFrom}>`)
      : 'FX Journal Pro <onboarding@resend.dev>';
    if (!configuredFrom && IS_PRODUCTION_LIKE) {
      console.warn('[Resend] RESEND_FROM_EMAIL is not set — sending from the shared sandbox domain. Expect codes to land in spam.');
    }
    try {
      console.log(`[Resend] Sending OTP email to ${email} from ${resendFrom}...`);
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
        console.error(`[Resend Email Error] HTTP ${response.status}:`, JSON.stringify(data));
        if (data?.name === 'validation_error') {
          console.error('[Resend] Validation error — check that RESEND_FROM_EMAIL is a verified sender domain.');
        }
      } else {
        console.log(`[Resend] OTP sent successfully to ${email} (id: ${data.id})`);
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

function createEmptyUserDb(userId?: string, email?: string, injectDummyUser = false) {
  const cleanUserId = userId?.trim() || `user_${crypto.randomUUID()}`;
  const cleanEmail = email ? email.toLowerCase().trim() : '';
  // One address, set by the developer, and only outside production. This used
  // to accept admin@axyfx.com or demo@axyfx.com and mint a SUPER_ADMIN from a
  // hardcoded hash — two guessable names that granted full admin wherever the
  // guard did not hold. It also needs DEV_ADMIN_PASSWORD to be set, so an
  // unconfigured checkout has no privileged account at all.
  const isDev = IS_DEV
    && !!DEV_ACCOUNT_EMAIL
    && !!DEV_ADMIN_PASSWORD_HASH
    && cleanEmail === DEV_ACCOUNT_EMAIL;

  const users = [];
  if (injectDummyUser || isDev) {
    users.push({
      id: cleanUserId,
      email: cleanEmail,
      name: isDev ? 'Developer' : (cleanEmail ? cleanEmail.split('@')[0] : 'Trader'),
      password: isDev ? DEV_ADMIN_PASSWORD_HASH : undefined,
      role: isDev ? 'SUPER_ADMIN' : 'USER',
      status: 'ACTIVE',
      experience: 'Intermediate',
      tradingStyle: 'Day Trading',
      mainMarkets: ['Forex', 'Gold'],
      onboardingCompleted: isDev ? true : false,
      isPro: isDev ? true : false,
      isEmailVerified: true,
      createdAt: new Date().toISOString()
    });
  }

  return {
    users: users,
    accounts: isDev ? [
      {
        id: 'acc_demo_1',
        userId: cleanUserId,
        name: 'Main Trading Account',
        broker: 'MetaTrader 5',
        platform: 'MT5',
        accountType: 'Demo',
        currency: 'USD',
        startingBalance: 0,
        currentBalance: 0,
        equity: 0,
        status: 'Active',
        eaToken: `ea_demo_${cleanUserId.slice(-8)}`,
        eaStatus: 'Not Connected',
        isDefaultDemo: true
      }
    ] : [],
    trades: [],
    riskSettings: [],
    supportTickets: [],
    mt5Deals: [],
    payments: []
  };
}

/**
 * Columns whose value is free-form JSON rather than a record of columns.
 *
 * These converters walk a row to rename its COLUMNS. A JSONB column's contents
 * are not columns — they are data the application addresses by exact key — so
 * recursing into them rewrote that data. `preferences` is where a partner's
 * referral links, their offer price, payout details, payout requests, shared
 * journal links and manual balance adjustments all live: on the user's next
 * login, saveDatabase upserted the row through toSnake and `partnerLinks`
 * became `partner_links`, `isActive` became `is_active`, and every reader
 * looking for the camelCase key found nothing. A partner created a referral
 * link, signed out, signed back in, and it was gone — still in the database,
 * under a name nothing reads.
 *
 * `mentor_access` was bitten by the same thing first: normaliseMentorAccess
 * carries an explicit `live_charts` fallback, which is this bug fossilised.
 *
 * The key is still renamed. Only its value is left alone.
 */
const OPAQUE_JSON_KEYS = new Set([
  'preferences',
  'mentor_access', 'mentorAccess',
  'payout_details', 'payoutDetails',
  'detail',
]);

// Helper to convert snake_case object to camelCase
function toCamel(obj: any): any {
  if (Array.isArray(obj)) return obj.map(toCamel);
  if (obj !== null && typeof obj === 'object') {
    const n: any = {};
    Object.keys(obj).forEach(k => {
      const camelKey = k.replace(/_([a-z])/g, g => g[1].toUpperCase());
      n[camelKey] = OPAQUE_JSON_KEYS.has(k) ? obj[k] : toCamel(obj[k]);
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
      n[snakeKey] = OPAQUE_JSON_KEYS.has(k) ? obj[k] : toSnake(obj[k]);
    });
    return n;
  }
  return obj;
}

/**
 * Reads one key out of a users.preferences blob.
 *
 * Rows written before OPAQUE_JSON_KEYS existed hold snake_cased keys, and the
 * values inside them are snake_cased too, so a partner's links are under
 * `partner_links` with `is_active` and `offer_price` fields. Checking both
 * spellings and running the value back through toCamel recovers those rows
 * without a migration; on a row that was never mangled both steps are no-ops.
 */
function prefsValue(prefs: any, camelKey: string): any {
  if (!prefs || typeof prefs !== 'object') return undefined;
  if (prefs[camelKey] !== undefined) return toCamel(prefs[camelKey]);
  const snakeKey = camelKey.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
  if (prefs[snakeKey] !== undefined) return toCamel(prefs[snakeKey]);
  return undefined;
}

/**
 * Writes one key into a preferences blob and drops the mangled twin.
 *
 * Without the delete a recovered row keeps both `partnerLinks` and
 * `partner_links` forever, and the next reader to check the wrong one gets
 * stale data. Returns the same object for chaining.
 */
function setPrefsValue(prefs: any, camelKey: string, value: any): any {
  const target = prefs && typeof prefs === 'object' ? prefs : {};
  const snakeKey = camelKey.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
  if (snakeKey !== camelKey) delete target[snakeKey];
  target[camelKey] = value;
  return target;
}

// ==========================================
// MT5 EXPERT ADVISOR (EA) SYNCHRONIZATION
// Fresh implementation: each portfolio account gets a unique EA whose
// embedded token authenticates it against the matching account.
// ==========================================

function generateEaToken(): string {
  return `ea_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The origin this request arrived on, as the browser sees it.
 *
 * Used for the URLs handed to a payment provider, which the customer's browser
 * has to be able to reach: a localhost value on a deployed box, or a
 * production value on a dev box, both break checkout. Derived from the request
 * rather than configured, so dev, Netlify previews and production each get
 * their own without an env var per environment. PUBLIC_SITE_URL overrides it
 * for the cases with no request to read (background jobs).
 */
function publicOrigin(req: any): string {
  const configured = process.env.PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const proto = (req?.headers?.['x-forwarded-proto']?.toString().split(',')[0] || req?.protocol || 'https').trim();
  const host = (req?.headers?.['x-forwarded-host']?.toString().split(',')[0] || req?.get?.('host') || 'www.fxjournalpro.com').trim();
  return `${proto}://${host}`;
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

/**
 * A balance write that refuses to store a broken total.
 *
 * Every site that moves an account balance goes through here. A single NaN or
 * Infinity written to currentBalance is unrecoverable from the UI — the figure
 * is the account's own running total, not a derived stat — and the terms come
 * from several sources (a client payload, an EA import, a trade row written
 * before these validations existed), so one guard at the write is worth more
 * than a guard at each source. Returns false when it refused.
 */
function applyBalanceDelta(account: any, delta: number): boolean {
  const next = parseFloat((Number(account?.currentBalance) + Number(delta)).toFixed(2));
  if (!Number.isFinite(next)) {
    console.error('[balance] refusing a non-finite balance', {
      accountId: account?.id,
      currentBalance: account?.currentBalance,
      delta,
    });
    return false;
  }
  account.currentBalance = next;
  account.equity = next;
  return true;
}

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

  // Profit is required, and null is not "absent" for it — the balance is
  // computed from it. Skipping null here is what let `profit: null` through to
  // `currentBalance + NaN`, which wrote NaN into the account total and
  // serialised as null. JSON.stringify turns Infinity into null, so any client
  // sending an overflowing number arrives here as null, not as a big value.
  if (input.profit !== undefined) {
    if (input.profit === null || input.profit === '') return 'Profit must be a number.';
    const v = num(input.profit);
    if (!Number.isFinite(v)) return 'Profit must be a number.';
    if (Math.abs(v) > MAX_MONEY) return 'Profit is unrealistically large.';
  }

  // Commission and swap are genuinely optional, and may be negative.
  const signed: [string, any][] = [
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
  const explicit = process.env.SESSION_SECRET?.trim() || process.env.BETTER_AUTH_SECRET?.trim();
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
  res.clearCookie('better-auth.session_token', { path: '/' });
  res.clearCookie('__Secure-better-auth.session_token', { path: '/' });
  res.clearCookie('better-auth.state', { path: '/' });
  res.clearCookie('__Secure-better-auth.state', { path: '/' });
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
  if (clone.onboardingCompleted !== undefined && clone.onboarding_completed === undefined) {
    clone.onboarding_completed = clone.onboardingCompleted;
  }
  if (clone.onboarding_completed !== undefined && clone.onboardingCompleted === undefined) {
    clone.onboardingCompleted = clone.onboarding_completed;
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

/**
 * The master key the per-credential DEKs are wrapped with.
 *
 * The fallback below is a literal in this file, and this repository is public,
 * so in production it is no key at all: anyone could unwrap every stored
 * investor password with a string they can read on GitHub. It is kept for a
 * local dev box, where the alternative is that nothing in the MT5 cloud path
 * runs without a hand-set variable, and refused everywhere real users reach —
 * the same shape as the SESSION_SECRET and Supabase guards.
 *
 * Returning null (rather than throwing) is what the callers already handle:
 * encryptInvestorPassword returns null and the route reports that the cloud
 * bridge is unavailable, instead of storing a password nobody can protect.
 */
const DEV_CLOUD_MASTER_KEY = 'journalpro-default-mt5-secret-key-32bytes-long';
let warnedAboutCloudMasterKey = false;

function cloudMasterKey(): Buffer | null {
  const raw = process.env.MT5_CREDENTIAL_MASTER_KEY?.trim();
  if (!raw) {
    if (IS_PRODUCTION_LIKE) {
      if (!warnedAboutCloudMasterKey) {
        warnedAboutCloudMasterKey = true;
        console.error(
          '[MT5] MT5_CREDENTIAL_MASTER_KEY is not set. Refusing to encrypt investor ' +
          'passwords under the built-in development key, which is a literal in a public ' +
          'repository. Set MT5_CREDENTIAL_MASTER_KEY to 64 hex characters.'
        );
      }
      return null;
    }
    const devHex = sha256Hex(DEV_CLOUD_MASTER_KEY);
    return Buffer.from(devHex, 'hex');
  }
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

/**
 * The MetaApi client, loaded on first use — if the SDK is installed at all.
 *
 * metaapi.cloud-sdk is deliberately not a dependency of this project. It was
 * 45MB on disk and carried thirteen of the sixteen production advisories npm
 * audit reports, including both criticals, through axios, crypto-js, lodash,
 * moment and socket.io-client. It paid for none of that: cloudSyncAvailable()
 * requires `!IS_SERVERLESS`, and IS_SERVERLESS is always true on Netlify, so
 * this path could not execute in production however it was configured.
 *
 * The code stays, because the cloud route is a real option — it is the hosted
 * "MT5 API" that needs no Windows host. To take it:
 *
 *   npm i metaapi.cloud-sdk
 *   MT5_CLOUD_SYNC_ENABLED=true, META_API_TOKEN=...
 *
 * and then make the sync run from a request or a background function rather
 * than the setInterval worker, which a serverless platform freezes.
 *
 * The require is deferred rather than imported at the top so that a missing
 * package is simply "cloud sync unavailable" instead of a server that will
 * not boot. createRequire, not `await import`, because this file is bundled
 * to CommonJS for Netlify and to ESM for Vercel, and a static specifier would
 * fail the build when the package is absent.
 */
let sdkUnavailable = false;
async function getCloudApi(): Promise<any> {
  const token = process.env.META_API_TOKEN?.trim();
  if (!token || sdkUnavailable) return null;
  if (cloudApi) return cloudApi;

  let MetaApi: any = null;
  try {
    // The SDK's "exports.import" points at a browser build that references
    // `window` and crashes in Node, so the CommonJS build is loaded directly.
    const mod = await import(/* @vite-ignore */ 'metaapi.cloud-sdk/dist/index' as string);
    MetaApi = (mod as any).default?.default || (mod as any).default || mod;
  } catch {
    if (!sdkUnavailable) {
      console.warn('[Cloud] metaapi.cloud-sdk is not installed — cloud sync is unavailable. `npm i metaapi.cloud-sdk` to enable it.');
      sdkUnavailable = true;
    }
    return null;
  }

  cloudApi = new MetaApi(token, {
    application: 'journalpro',
    requestTimeout: 60,
    connectTimeout: 60
  });
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

  const api = await getCloudApi();
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

  const api = await getCloudApi();
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
  const api = await getCloudApi();
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
  const api = await getCloudApi();
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
  const api = await getCloudApi();
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

/**
 * Whether cloud sync can actually run on this deployment.
 *
 * Three things have to be true, and on the current deployment none of the last
 * two are:
 *
 *  - a broker worker credential (META_API_TOKEN),
 *  - a process that lives long enough to hold the sync loop, which serverless
 *    is not — startCloudWorker below returns early on Vercel and Netlify,
 *  - the recurring loop actually being armed, which it is not:
 *    cloudSyncLoopTick is written and never called.
 *
 * Until that is wired, POST /api/mt5/cloud/connect returned 200 and parked the
 * account at "Validating" forever, while the UI offered it as the easier of
 * the two methods — "No EA installation needed". A customer who picked it was
 * simply stuck. Opt in explicitly when the worker is real; the EA path needs
 * none of this and works on the current deployment today.
 */
const cloudSyncAvailable = (): boolean =>
  process.env.MT5_CLOUD_SYNC_ENABLED === 'true'
  && !IS_SERVERLESS
  && !!process.env.META_API_TOKEN?.trim();

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

    // MT5 closes a position with the OPPOSITE deal: a long is closed by a sell
    // deal and a short by a buy deal. Reading the closing deal's type directly
    // labelled every synced trade backwards — a long showed as Sell and a
    // short as Buy — so the journal, the long/short split and every filter on
    // direction were wrong for anyone using MT5 sync. The direction is the
    // ENTRY deal's type; with no entry deal in the batch, the close is
    // inverted to recover it.
    const direction: 'Buy' | 'Sell' = inDeals.length > 0
      ? (inDeals[0].type === DEAL_TYPE_SELL ? 'Sell' : 'Buy')
      : (lastOut.type === DEAL_TYPE_SELL ? 'Buy' : 'Sell');
    const totalProfit = list.reduce((s: number, d: any) => s + d.profit, 0);
    const totalComm = list.reduce((s: number, d: any) => s + d.commission, 0);
    const totalSwap = list.reduce((s: number, d: any) => s + d.swap, 0);

    result.push({
      id: `mt5ea_${account.id}_${posId}`,
      accountId: account.id,
      date: new Date(inDeal.time * 1000).toISOString(),
      exitTime: new Date(lastOut.time * 1000).toISOString(),
      symbol: lastOut.symbol || inDeal.symbol || 'UNKNOWN',
      type: direction as any,
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
): Promise<{ accountsError?: any; usersError?: any; tradesError?: any }> {
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
      // Every real column on `users`. The list had fallen behind the schema by
      // eleven columns, and anything missing from it is dropped silently — the
      // upsert succeeds, the field never lands.
      //
      // That cost onboarding_completed, whose only writer is
      // /api/auth/onboarding via this function. The flag was set in the cached
      // copy and lost on the way to the database, so the wizard came back on
      // the next cold start: on a serverless platform, for every customer,
      // every time. The others (role, status, pro_until, plan, referred_by,
      // mentor_access, allow_partner_trade_view, last_login) happen to have
      // dedicated update paths, so they were saved despite this, not because
      // of it.
      //
      // Widening it is safe: no route copies request-body keys onto a user row
      // — update-profile takes `name` alone and preferences are confined to
      // their own object — so a client cannot reach role or is_pro through it.
      const validUserCols = new Set([
        'id', 'email', 'name', 'password', 'experience', 'trading_style',
        'main_markets', 'is_pro', 'is_email_verified', 'created_at',
        'email_otp', 'otp_expires_at', 'otp_attempts', 'otp_sent_at',
        'reset_otp', 'reset_otp_expires_at',
        'onboarding_completed', 'preferences', 'auth_provider', 'last_login',
        'role', 'status', 'plan', 'pro_until',
        'referred_by', 'referred_at', 'allow_partner_trade_view', 'mentor_access',
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
      if (err1) {
        // Reported, not just logged. Supabase being unreachable used to leave
        // the customer with a success response and nothing saved.
        console.error('[saveDatabase] users upsert error:', err1);
        return { usersError: err1 };
      }
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
    //
    // Whitelisted like users and accounts above. Without it, any property the
    // app hangs on a trade that is not a column fails the WHOLE batch —
    // PostgREST rejects the request, not the row — so one imported trade
    // carrying a broker `ticket` silently took every other trade in the same
    // save down with it, and the caller was still told it worked.
    if (data.trades && data.trades.length > 0) {
      const validTradeCols = new Set([
        'id', 'account_id', 'user_id', 'date', 'symbol', 'type', 'lot_size',
        'entry_price', 'exit_price', 'exit_time', 'stop_loss', 'take_profit',
        'profit', 'commission', 'swap', 'risk_percentage', 'strategy',
        'emotion', 'notes', 'screenshot', 'tags', 'is_mt5_sync',
        'ea_deal_id', 'ea_position_id', 'created_at',
      ]);
      const trds = toSnake(data.trades).map((t: any) => {
        const clean: any = {};
        for (const key of Object.keys(t)) {
          if (validTradeCols.has(key)) clean[key] = t[key];
        }
        if (clean.ea_deal_id === undefined && t.ticket !== undefined && Number.isFinite(Number(t.ticket))) {
          clean.ea_deal_id = Number(t.ticket);
        }
        clean.user_id = clean.user_id || uid;
        return clean;
      });
      const { error: err3 } = await supabase.from('trades').upsert(trds, { onConflict: 'id' });
      if (err3) {
        console.error('[saveDatabase] trades upsert error:', err3);
        return { tradesError: err3 };
      }
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
        action: j.action === 'SYNC_NOW' ? 'RESYNC' : j.action,
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
      startingBalance: 0,
      currentBalance: 0,
      equity: 0,
      status: 'Active',
      eaToken: generateEaToken(),
      eaStatus: 'Not Connected',
      isDefaultDemo: true
    };
    db.accounts.push(newAcc);

    // Add a starter risk setting for the default account
    const newRisk: RiskSettings = {
      id: `r_${crypto.randomUUID()}`,
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

// Check whether an account is the default starter demo account ($10k demo account)
function isDefaultDemoAccount(acc: any): boolean {
  if (!acc) return false;
  if (acc.isDefaultDemo === true || acc.is_default_demo === true) return true;
  if (acc.id === 'acc_demo_1') return true;
  const isDemo = (acc.accountType === 'Demo' || acc.account_type === 'DEMO');
  const isStarterBroker = (
    acc.broker === 'MT5 Demo Broker' ||
    acc.broker === 'Demo Broker' ||
    acc.name === 'Portfolio Account' ||
    acc.name === 'Main Trading Account'
  );
  const isNotSynced = !acc.isMt5Sync && !acc.is_mt5_sync && !acc.mt5Login && !acc.eaTerminalLogin;
  return isDemo && isStarterBroker && isNotSynced;
}

// Option A: Automatically remove the default starter demo account when MT5 is connected/synced
async function cleanupDefaultDemoAccounts(db: any, userId: string, exceptAccountId?: string): Promise<string[]> {
  try {
    if (!db || !Array.isArray(db.accounts) || !userId) return [];
    const removedIds: string[] = [];
    const toKeep: any[] = [];

    for (const acc of db.accounts) {
      const belongsToUser = acc.userId === userId || acc.user_id === userId;
      if (belongsToUser && acc.id !== exceptAccountId && isDefaultDemoAccount(acc)) {
        removedIds.push(acc.id);
      } else {
        toKeep.push(acc);
      }
    }

    if (removedIds.length > 0) {
      db.accounts = toKeep;
      if (Array.isArray(db.trades)) {
        db.trades = db.trades.filter((t: any) => !removedIds.includes(t.accountId || t.account_id));
      }
      if (Array.isArray(db.riskSettings)) {
        db.riskSettings = db.riskSettings.filter((r: any) => !removedIds.includes(r.accountId || r.account_id));
      }

      if (useSupabase) {
        try {
          for (const id of removedIds) {
            await supabase.from('trading_accounts').delete().eq('id', id);
            await supabase.from('trades').delete().eq('account_id', id);
            await supabase.from('risk_settings').delete().eq('account_id', id);
          }
        } catch (err) {
          console.error('[cleanupDefaultDemoAccounts] Supabase delete error:', err);
        }
      }
      console.log(`[cleanupDefaultDemoAccounts] Cleaned up default demo account(s) [${removedIds.join(', ')}] for user ${userId} upon MT5 connection`);
    }

    return removedIds;
  } catch (err) {
    console.error('[cleanupDefaultDemoAccounts] Error cleaning up demo accounts:', err);
    return [];
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
    console.warn('[Turnstile] No secret configured — allowing request.');
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

// Normalize duplicate slashes in request URL (e.g. //api/auth -> /api/auth)
app.use((req, _res, next) => {
  if (req.url.startsWith('//')) {
    req.url = req.url.replace(/^\/+/, '/');
  }
  next();
});

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

// Middleware
app.use(cookieParser());

// Better Auth Route Handler (mounted before express.json to preserve request body stream)
const betterAuthNodeHandler = toNodeHandler(betterAuthInstance);
const LEGACY_AUTH_ROUTES = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify-otp',
  '/api/auth/resend-otp',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/onboarding',
  '/api/auth/preferences',
  '/api/auth/update-profile'
]);

app.all('/api/auth/*', (req, res, next) => {
  if (LEGACY_AUTH_ROUTES.has(req.path)) {
    return next();
  }
  return betterAuthNodeHandler(req, res);
});

app.use(express.json({
  limit: '15mb',
  // Capture the raw request body for HMAC signature verification
  verify: (req: any, _res: any, buf: Buffer) => {
    req.rawBody = buf.toString('utf8');
  }
}));

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
    let authUserId: string | undefined;
    let authEmail: string | undefined;

    // 1. Identity from signed session cookie (fx_auth_session)
    const session = verifySessionValue(req.cookies?.[SESSION_COOKIE]);
    if (session?.userId || session?.email) {
      authUserId = session.userId?.trim();
      authEmail = session.email?.trim();
    }

    // 2. Identity from Authorization Bearer token or X-Session-Token
    if (!authUserId && !authEmail) {
      const authHeader = (req.headers['authorization'] || '').toString().trim();
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : (req.headers['x-session-token'] as string || '').trim();

      if (token) {
        const bearerSession = verifySessionValue(token);
        if (bearerSession?.userId || bearerSession?.email) {
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

    // 3. Identity from Better Auth session (Google OAuth etc.)
    let betterUser: any = null;
    if (!authUserId && !authEmail) {
      try {
        const betterSession = await betterAuthInstance.api.getSession({ headers: fromNodeHeaders(req.headers) });
        if (betterSession?.user) {
          betterUser = betterSession.user;
          authUserId = betterSession.user.id;
          authEmail = betterSession.user.email;
        }
      } catch (_) {}
    }

    // 4. In development, allow x-auth-user-id and x-auth-email fallback for API requests
    if (!authUserId && !authEmail && !IS_PRODUCTION_LIKE) {
      const headerUserId = (req.headers['x-auth-user-id'] as string || '').trim();
      const headerEmail = (req.headers['x-auth-email'] as string || '').trim();
      if (headerUserId || headerEmail) {
        authUserId = headerUserId;
        authEmail = headerEmail;
      }
    }

    if (authUserId || authEmail) {
      const email = authEmail ? authEmail.toLowerCase().trim() : '';
      let userId = authUserId || (email ? `user_${email}` : '');

      let db: any = null;
      let dbUser: any = null;
      const isSuperAdminUser = isSuperAdminEmail(email);

      if (useSupabase) {
        let existingUserRow: any = null;
        if (email) {
          const { data } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
          existingUserRow = data;
        }
        if (!existingUserRow && authUserId) {
          const { data } = await supabase.from('users').select('*').eq('id', authUserId).maybeSingle();
          existingUserRow = data;
        }

        if (existingUserRow) {
          dbUser = toCamel(existingUserRow);
          userId = existingUserRow.id;
          authUserId = existingUserRow.id;

          // Auto-upgrade designated super admin to SUPER_ADMIN role & Pro
          if (isSuperAdminUser && (existingUserRow.role !== 'SUPER_ADMIN' || !existingUserRow.is_pro)) {
            existingUserRow.role = 'SUPER_ADMIN';
            existingUserRow.is_pro = true;
            dbUser.role = 'SUPER_ADMIN';
            dbUser.isPro = true;
            dbUser.is_pro = true;
            supabase.from('users').update({ role: 'SUPER_ADMIN', is_pro: true }).eq('id', existingUserRow.id).then();
          }
        } else if (betterUser && email) {
          // User logged in with Better Auth / Google OAuth for the first time -> auto-provision in Supabase
          const canonicalId = authUserId || `user_${crypto.randomUUID()}`;
          const newRecord: any = {
            id: canonicalId,
            email: email,
            name: betterUser.name || email.split('@')[0],
            password: '',
            role: isSuperAdminUser ? 'SUPER_ADMIN' : 'USER',
            status: 'ACTIVE',
            experience: 'Intermediate',
            trading_style: 'Day Trading',
            main_markets: ['Forex', 'Gold'],
            onboarding_completed: false,
            is_pro: isSuperAdminUser ? true : false,
            is_email_verified: true,
            auth_provider: 'google',
            last_login: new Date().toISOString(),
          };
          try {
            await supabase.from('users').upsert(newRecord, { onConflict: 'id' });
            const defaultAcc = {
              id: `acc_${crypto.randomUUID()}`,
              user_id: canonicalId,
              name: 'Main Trading Account',
              broker: 'Demo Broker',
              platform: 'MT5',
              account_type: 'DEMO',
              currency: 'USD',
              starting_balance: 10000,
              current_balance: 10000,
              equity: 10000,
              status: 'ACTIVE',
              is_mt5_sync: false,
              is_default_demo: true,
            };
            await supabase.from('trading_accounts').upsert([defaultAcc], { onConflict: 'id' });
          } catch (createErr) {
            console.error('[Better Auth Sync] Failed to upsert new user to Supabase:', createErr);
          }
          dbUser = toCamel(newRecord);
          userId = canonicalId;
          authUserId = canonicalId;
        }

        if (!IDENTITY_ONLY_ROUTES.has(req.path)) {
          db = await ensureUserDbLoaded(userId, email);
          if (db?.users?.[0]) dbUser = db.users[0];
        }
      } else {
        db = await ensureUserDbLoaded(userId, email);
        dbUser = db.users[0] || null;
        if (!dbUser && betterUser && email) {
          const canonicalId = authUserId || `user_${crypto.randomUUID()}`;
          const newRecord: any = {
            id: canonicalId,
            email: email,
            name: betterUser.name || email.split('@')[0],
            password: '',
            role: isSuperAdminUser ? 'SUPER_ADMIN' : 'USER',
            status: 'ACTIVE',
            experience: 'Intermediate',
            tradingStyle: 'Day Trading',
            mainMarkets: ['Forex', 'Gold'],
            onboardingCompleted: false,
            isPro: isSuperAdminUser ? true : false,
            isEmailVerified: true,
            authProvider: 'google',
            lastLogin: new Date().toISOString(),
          };
          dbUser = newRecord;
          db.users.push(newRecord);
        }
      }

      if (isSuperAdminUser && dbUser) {
        dbUser.role = 'SUPER_ADMIN';
        dbUser.isPro = true;
        dbUser.is_pro = true;
      }

      // If user came via Better Auth (Google), their email is verified by Google
      if (betterUser && dbUser) {
        dbUser.isEmailVerified = true;
        dbUser.is_email_verified = true;
        if (!req.cookies?.[SESSION_COOKIE]) {
          issueSession(res, { id: dbUser.id, email: dbUser.email });
        }
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
  const existingCookie = req.cookies?.[SESSION_COOKIE];
  const token = (existingCookie && verifySessionValue(existingCookie))
    ? existingCookie
    : issueSession(res, currentUser);
  return res.json({ user: sanitizeUser(currentUser), sessionToken: token });
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const authHeader = (req.headers['authorization'] || '').toString().trim();
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const rawToken = req.cookies?.[SESSION_COOKIE] || (req.headers['x-session-token'] as string) || bearerToken || '';
    const session = verifySessionValue(rawToken);
    if (session) {
      revokeSessionsFor(session.userId);
      revokeSessionsFor(session.email);
    }
    clearSession(res);
  } catch (_) {}

  try {
    await betterAuthInstance.api.signOut({ headers: fromNodeHeaders(req.headers) });
  } catch (_) {}

  res.clearCookie('better-auth.session_token', { path: '/' });
  res.clearCookie('__Secure-better-auth.session_token', { path: '/' });
  res.clearCookie('better-auth.session_data', { path: '/' });
  res.clearCookie('__Secure-better-auth.session_data', { path: '/' });
  res.clearCookie('better-auth.state', { path: '/' });
  res.clearCookie('__Secure-better-auth.state', { path: '/' });
  res.clearCookie('fx_auth_session', { path: '/' });
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
      const uid = existingUserRow?.id || authUserId || `user_${crypto.randomUUID()}`;
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
        last_login: new Date().toISOString(),
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
    const uid = existingUserRow?.id || authUserId || `user_${crypto.randomUUID()}`;
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
      // Set here rather than left to the column default. Supabase fills it
      // from DEFAULT NOW(), but the local store has no defaults, so every
      // account registered against db.json read "Joined: N/A" in the registry
      // and sorted as if it had no join date at all.
      created_at: existingUserRow?.created_at || new Date().toISOString(),
      email_otp: otp,
      otp_expires_at: otpExpiresAt,
      otp_attempts: 0,
      otp_sent_at: new Date().toISOString(),
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

// ── Link a referral code to an already-authenticated user ──────────────────
// Called by the frontend after a Google OAuth sign-up completes. The referral
// code survives the OAuth round-trip in sessionStorage (saved before redirect,
// read back on /dashboard), then POST-ed here so it can be attributed to the
// partner even though Better Auth's OAuth callback never touches our register
// endpoint.
app.post('/api/auth/link-referral', authRateLimiter, async (req, res) => {
  try {
    const uid = req.headers['x-auth-user-id'] as string || '';
    const email = req.headers['x-auth-email'] as string || '';
    const { referralCode } = req.body;

    if (!referralCode || typeof referralCode !== 'string') {
      return res.status(400).json({ error: 'referralCode is required.' });
    }

    // Resolve current user — must be authenticated
    let userId = uid;
    if (!userId && email) {
      if (useSupabase) {
        const { data } = await supabase.from('users').select('id').eq('email', email.toLowerCase().trim()).maybeSingle();
        userId = data?.id || '';
      }
    }
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    // Check user hasn't already been referred (first-referral-wins policy)
    let alreadyReferred = false;
    if (useSupabase) {
      const { data } = await supabase.from('users').select('referred_by').eq('id', userId).maybeSingle();
      alreadyReferred = !!(data?.referred_by);
    }

    if (alreadyReferred) {
      return res.json({ success: false, message: 'User already has a referral attributed.' });
    }

    const partnerId = await linkReferral(req, userId, referralCode.trim());
    if (partnerId) {
      console.log(`[link-referral] Linked user ${userId} to partner ${partnerId} via code ${referralCode}`);
      return res.json({ success: true, message: 'Referral linked successfully.' });
    } else {
      return res.status(404).json({ success: false, error: 'Referral code not found or invalid.' });
    }
  } catch (err: any) {
    console.error('[link-referral] Error:', err?.message || err);
    res.status(500).json({ error: 'Failed to link referral.' });
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

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password. Please check your credentials.' });
    }

    if (!user.password) {
      return res.status(401).json({ error: 'This account was registered using Google. Please continue with Google sign-in.' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required to login.' });
    }

    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, user.password);
    } catch {
      isMatch = false;
    }
    if (!isMatch && user.password === password) {
      isMatch = true;
    }

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password. Please try again.' });
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

      // Upsert the user in Supabase Auth so signInWithPassword works and
      // Supabase never sends its own confirmation email (email_confirm: true
      // skips Supabase's built-in email flow entirely).
      if (useSupabase && supabase?.auth?.admin) {
        try {
          // Use a page-1 filter to avoid pulling all users
          const { data: authList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
          const existingAuthUser = authList?.users?.find((u: any) => u.email === normalizedEmail);
          if (existingAuthUser) {
            // Already in Supabase Auth — just mark the email as confirmed
            await supabase.auth.admin.updateUserById(existingAuthUser.id, {
              email_confirm: true,
            });
          } else {
            // Create in Supabase Auth with email pre-confirmed; use a random
            // secure password — this account should only be signed into via
            // our custom OTP flow or Google OAuth, not via Supabase directly.
            await supabase.auth.admin.createUser({
              email: normalizedEmail,
              email_confirm: true,
              password: crypto.randomBytes(32).toString('hex'),
              user_metadata: { name: row.name || normalizedEmail.split('@')[0] },
            });
          }
          console.log(`[verify-otp] Supabase Auth synced for ${normalizedEmail} (email_confirm=true)`);
        } catch (authErr: any) {
          // Non-fatal: the user is verified in our DB regardless.
          console.warn('[verify-otp] Supabase Auth upsert skipped:', authErr?.message || authErr);
        }
      }

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
    db.users[userIdx].onboarding_completed = true;
    db.users[userIdx].onboardingData = { experience, tradingStyle, markets };

    if (useSupabase && currentUser?.id) {
      try {
        await supabase.from('users').update({
          experience,
          trading_style: tradingStyle,
          main_markets: markets,
          onboarding_completed: true
        }).eq('id', currentUser.id);
      } catch (sbErr) {
        console.warn('[Onboarding] Supabase direct update warning:', sbErr);
      }
    }

    // Auto-create a default portfolio account for new users if none exists yet
    await ensureDefaultPortfolioAccount(db, currentUser.id, authEmail);

    await saveDatabase(db, authEmail);
    currentUser = db.users[userIdx];
    res.json({ message: 'Onboarding completed successfully', user: sanitizeUser(currentUser) });
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
type ProFeature = 'mt5Sync' | 'liveChart' | 'aiMentor' | 'unlimitedAccounts' | 'proReports' | 'whatsappAlerts' | 'notebook';

const PRO_FEATURE_MESSAGES: Record<ProFeature, string> = {
  mt5Sync: 'MT5 sync is a Pro feature. On the free plan you can add trades manually.',
  liveChart: 'Live Chart is a Pro feature. Upgrade to chart your trades against live market data.',
  aiMentor: 'AI Mentor is a Pro feature. Upgrade to get coaching on your trading.',
  unlimitedAccounts: `The free plan is limited to ${FREE_ACCOUNT_LIMIT} portfolio account. Upgrade to Pro for unlimited broker and prop firm accounts.`,
  proReports: `The free plan reports cover the last ${FREE_REPORT_DAYS} days in CSV. Excel and PDF reports over any period are a Pro feature.`,
  whatsappAlerts: 'WhatsApp news reminders are a Pro feature.',
  notebook: 'Trader Notebook is a Pro feature. Upgrade to unlock rich-text notes, custom dates, templates, and trade planning.',
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
      notebook: pro,
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

/**
 * Strips the secrets an account row carries before it goes to a browser.
 *
 * investorPasswordEnc is the customer's MT5 password under AES-GCM, and the EA
 * token authenticates that account's sync. Neither is any use to the client —
 * the EA file embeds its own token, and the password is only ever unwrapped
 * server-side for a claimed worker job — and both were being shipped in every
 * /api/accounts response, where they reach console logs, error reporters and
 * support screenshots.
 */
const sanitizeAccount = (account: any): any => {
  if (!account || typeof account !== 'object') return account;
  const {
    investorPasswordEnc, investor_password_enc,
    passwordEncNonce, password_enc_nonce,
    passwordKmsKeyId, password_kms_key_id,
    eaToken, ea_token,
    ...safe
  } = account;
  return { ...safe, hasStoredCredentials: !!(investorPasswordEnc || investor_password_enc) };
};

app.get('/api/accounts', async (req, res) => {
  let currentUser = (req as any).currentUser;
  // 401, not an empty list. Answering 200 with `{accounts: []}` to a caller
  // with no session told an expired customer that their accounts were gone
  // instead of that they were signed out — on a trading journal, the worst
  // possible way to say "please log in again". Every other route here answers
  // 401, and the client already handles it: fetchAccountData only replaces
  // state when the response actually carries an array, and the 401 path shows
  // "your session has timed out".
  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });

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
        let accounts = toCamel(rows || []).map(sanitizeAccount);
        console.log(`[GET /api/accounts] User: ${currentUser.id}, accounts from Supabase: ${accounts.length}`);

        // Option A: If user has at least one MT5 synced account, clean up and remove any default starter demo accounts
        const hasMt5 = accounts.some((a: any) => a.isMt5Sync || a.is_mt5_sync || a.mt5Login || a.eaTerminalLogin);
        if (hasMt5) {
          const demoAccs = accounts.filter(isDefaultDemoAccount);
          if (demoAccs.length > 0) {
            for (const d of demoAccs) {
              await supabase.from('trading_accounts').delete().eq('id', d.id);
              await supabase.from('trades').delete().eq('account_id', d.id);
              await supabase.from('risk_settings').delete().eq('account_id', d.id);
            }
            accounts = accounts.filter((a: any) => !demoAccs.some((d: any) => d.id === a.id));
          }
        }

        // Auto-calibrate starting balance for MT5 synced accounts, and clear 10000 placeholder on starter demo
        for (const acc of accounts) {
          if (acc.isMt5Sync && (acc.startingBalance === 10000 || !acc.startingBalance || acc.startingBalance === 0)) {
            try {
              const { data: dealRows } = await supabase
                .from('mt5_deals')
                .select('*')
                .eq('account_id', acc.id);
              const accountDeals = dealRows || [];
              const deposits = accountDeals
                .filter((d: any) => d.type === DEAL_TYPE_BALANCE && (d.profit || 0) > 0)
                .sort((a: any, b: any) => a.time - b.time);
              if (deposits.length > 0) {
                acc.startingBalance = parseFloat(deposits[0].profit.toFixed(2));
                await supabase.from('trading_accounts').update({ starting_balance: acc.startingBalance }).eq('id', acc.id);
              } else if (acc.currentBalance > 0 && acc.currentBalance !== 10000) {
                const { data: tradeRows } = await supabase
                  .from('trades')
                  .select('*')
                  .eq('account_id', acc.id);
                const closedPnl = (tradeRows || [])
                  .filter((t: any) => t.type !== 'Deposit' && t.type !== 'Withdrawal')
                  .reduce((sum: number, t: any) => sum + (t.profit || 0) + (t.commission || 0) + (t.swap || 0), 0);
                acc.startingBalance = parseFloat(Math.max(0, acc.currentBalance - closedPnl).toFixed(2));
                await supabase.from('trading_accounts').update({ starting_balance: acc.startingBalance }).eq('id', acc.id);
              }
            } catch (calibErr) {
              console.error('[GET /api/accounts] Calibration error:', calibErr);
            }
          } else if (isDefaultDemoAccount(acc) && acc.startingBalance === 10000) {
            acc.startingBalance = 0;
            acc.currentBalance = 0;
            acc.equity = 0;
            try {
              await supabase.from('trading_accounts').update({ starting_balance: 0, current_balance: 0, equity: 0 }).eq('id', acc.id);
            } catch { }
          }
        }

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

  // If user has an MT5 synced account, clean up any default starter demo accounts
  const hasMt5 = userAccounts.some((a: any) => a.isMt5Sync || a.is_mt5_sync || a.mt5Login || a.eaTerminalLogin);
  if (hasMt5) {
    const removedIds = await cleanupDefaultDemoAccounts(db, currentUser.id);
    if (removedIds.length > 0) {
      userAccounts = userAccounts.filter((a: any) => !removedIds.includes(a.id));
      await saveDatabase(db, currentUser.email);
    }
  }
  
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

  // Auto-calibrate starting balance for MT5 synced accounts from actual MT5 deposits or trades if still at 10000 placeholder
  for (const acc of userAccounts) {
    if (acc.isMt5Sync && (acc.startingBalance === 10000 || !acc.startingBalance || acc.startingBalance === 0)) {
      const accountDeals = (db.mt5Deals || []).filter((d: any) => d.accountId === acc.id);
      const deposits = accountDeals
        .filter((d: any) => d.type === DEAL_TYPE_BALANCE && (d.profit || 0) > 0)
        .sort((a: any, b: any) => a.time - b.time);
      if (deposits.length > 0) {
        acc.startingBalance = parseFloat(deposits[0].profit.toFixed(2));
        acc.startingBalanceLocked = true;
      } else if (acc.currentBalance > 0 && acc.currentBalance !== 10000) {
        const closedPnl = (db.trades || [])
          .filter((t: any) => t.accountId === acc.id && t.type !== 'Deposit' && t.type !== 'Withdrawal')
          .reduce((sum: number, t: any) => sum + (t.profit || 0) + (t.commission || 0) + (t.swap || 0), 0);
        acc.startingBalance = parseFloat(Math.max(0, acc.currentBalance - closedPnl).toFixed(2));
        acc.startingBalanceLocked = true;
      }
    }
  }

  console.log(`[GET /api/accounts] User: ${currentUser.id} (${currentUser.email}), active accounts: ${userAccounts.length}`);
  res.json({ accounts: userAccounts.map(sanitizeAccount) });
});

app.post('/api/accounts', async (req, res) => {
  let db = (req as any).userDb;
  let currentUser = (req as any).currentUser;
  const authEmail = currentUser?.email;
  console.log(`[POST /api/accounts] x-auth-user-id: "${req.headers['x-auth-user-id']}", x-auth-email: "${req.headers['x-auth-email']}", resolved currentUser: ${currentUser?.id || 'NONE'}`);
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated. Please refresh the page and log in again.' });

  if (!db.accounts) db.accounts = [];
  if (!db.riskSettings) db.riskSettings = [];

  const { name, broker, platform, accountType, currency, startingBalance, isMt5Sync, institutionType, login, server, investorPassword } = req.body;

  // Account limit check for Free vs Pro
  // If user is adding an MT5 synced account, default demo account will be removed to make room,
  // so filter out default demo accounts when calculating active account count.
  const existingUserAccounts = db.accounts.filter((acc: any) => {
    const isOwner = acc.userId === currentUser.id || acc.user_id === currentUser.id;
    if (!isOwner) return false;
    if (isMt5Sync && isDefaultDemoAccount(acc)) return false;
    return true;
  });
  if (!hasPro(currentUser) && existingUserAccounts.length >= FREE_ACCOUNT_LIMIT) {
    return res.status(403).json({
      error: PRO_FEATURE_MESSAGES.unlimitedAccounts,
      proRequired: true,
      feature: 'unlimitedAccounts',
    });
  }

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
    // A new MT5 account has no EA running yet — the file has not even been
    // downloaded. Marking it Connected at creation told the customer they were
    // synced before anything was installed, and hid the setup UI that would
    // have got them there: the method cards and the "Waiting for MT5" banner
    // both key off the connected state. The EA flips this itself on its first
    // authenticate or validate.
    eaStatus: 'Not Connected',
    ...(login ? { mt5Login: String(login).trim(), eaTerminalLogin: String(login).trim() } : {}),
    ...(server ? { mt5Server: String(server).trim(), eaTerminalServer: String(server).trim() } : {}),
    // Storing a password is not a connection. This said Connected the moment
    // the form was submitted, on the dead MetaApi method, and queued nothing —
    // so the customer saw "Connected" against an empty journal forever and had
    // no way to tell that nothing was ever going to arrive. An account with
    // credentials goes on the VPS queue where one can run; otherwise it waits
    // for its EA, and says so.
    ...(enc && vpsSyncAvailable() ? {
      investorPasswordEnc: enc.enc,
      passwordEncNonce: '',
      passwordKmsKeyId: enc.keyId,
      syncMethod: 'VPS',
      connectionStatus: 'Queued'
    } : enc ? {
      investorPasswordEnc: enc.enc,
      passwordEncNonce: '',
      passwordKmsKeyId: enc.keyId,
      syncMethod: 'EA',
      connectionStatus: 'Not Connected'
    } : {
      ...(isMt5Sync ? { syncMethod: 'EA', connectionStatus: 'Not Connected' } : {})
    })
  };

  // Option A: Automatically remove default starter demo account when an MT5 synced account is added
  if (isMt5Sync) {
    await cleanupDefaultDemoAccounts(db, currentUser.id);
  }

  db.accounts.push(newAcc);

  // Queue the first sync, the way /api/mt5/vps/connect does. Without this the
  // credentials sat encrypted and no worker was ever told to use them.
  if (enc && vpsSyncAvailable()) {
    enqueueConnectJob(db, newAcc, 'SYNC_NOW');
    logEaEvent(db, newAcc, 'VPS_CONNECT_REQUESTED', 'info', 'Queued for a VPS terminal on account creation');
  }

  // Create default risk settings
  const riskBase = startBal || 10000;
  const newRisk: RiskSettings = {
    id: `r_${crypto.randomUUID()}`,
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
  res.json({ message: 'Trading account created', account: sanitizeAccount(newAcc) });
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
    // parseFloat straight from the body wrote NaN into the account totals for
    // any non-numeric value — "abc", "", a stray comma — and the balance is
    // the account's own running total, so there is no way back from the UI.
    const money = (raw: any): number | null => {
      const v = typeof raw === 'number' ? raw : parseFloat(String(raw));
      if (!Number.isFinite(v)) return null;
      if (Math.abs(v) > MAX_MONEY) return null;
      return v;
    };
    for (const [label, raw] of [['Starting balance', startingBalance], ['Current balance', currentBalance], ['Equity', equity]] as [string, any][]) {
      if (raw !== undefined && money(raw) === null) {
        return res.status(400).json({ error: `${label} must be a number.` });
      }
    }
    if (startingBalance !== undefined) db.accounts[accIdx].startingBalance = money(startingBalance);
    if (currentBalance !== undefined) db.accounts[accIdx].currentBalance = money(currentBalance);
    if (equity !== undefined) db.accounts[accIdx].equity = money(equity);

    await saveDatabase(db, authEmail);
    res.json({ message: 'Account updated successfully', account: sanitizeAccount(db.accounts[accIdx]) });
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
  // 401 rather than an empty journal — see /api/accounts above.
  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });

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

  if (!symbol || !type || !lotSize || !entryPrice || !exitPrice
    || profit === undefined || profit === null || profit === '') {
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
    if (requestedAccount && requestedAccount.userId !== currentUser.id) {
      return res.status(403).json({ error: 'You can only add trades to your own accounts.' });
    }
    if (!requestedAccount) {
      // No account of the caller's carries this id. Two very different causes,
      // and req.userDb cannot tell them apart: it is scoped to the caller, so
      // someone else's account is not in it to be found — which is what makes
      // a cross-account write impossible, rather than the check above, which
      // never fires. So ask whether the id exists at all before answering.
      //
      // Only on this error path, so the extra lookup costs nothing in normal
      // use.
      let existsElsewhere = false;
      if (!useSupabase) {
        try {
          existsElsewhere = (loadDatabaseFromFile()?.accounts || [])
            .some((a: any) => a.id === accountId);
        } catch { /* treated as "gone" below */ }
        if (!existsElsewhere) {
          for (const cached of userDatabases.values()) {
            if ((cached?.accounts || []).some((a: any) => a.id === accountId)) {
              existsElsewhere = true;
              break;
            }
          }
        }
      } else {
        const { data } = await supabase
          .from('trading_accounts').select('id').eq('id', accountId).maybeSingle();
        existsElsewhere = !!data;
      }

      if (existsElsewhere) {
        return res.status(403).json({ error: 'You can only add trades to your own accounts.' });
      }

      // The account is gone — deleted in another tab, or the database was
      // restored underneath an open page. The fallback below, which would
      // otherwise pick their primary account, is unreachable from here, so
      // this used to answer a bare "Account not found": a dead end, since the
      // same request with no accountId at all succeeds.
      //
      // Silently writing to a different account than the one asked for would
      // be worse than refusing, so the response names what changed and
      // carries the caller's current list. The client resyncs from it and
      // retries once against an account that does exist.
      return res.status(409).json({
        error: 'That trading account no longer exists. Your account list has been refreshed — please save again.',
        code: 'ACCOUNT_STALE',
        accounts: ownAccounts.map((a: any) => ({ id: a.id, name: a.name })),
      });
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

  // Balance first, and only then store the trade: refusing after the push
  // would leave the trade saved with the account total not moved for it, which
  // is a worse state than rejecting the request outright. `profit: null`
  // reached this arithmetic before the validation above was tightened.
  const netProfit = newTrade.profit + newTrade.commission + newTrade.swap;
  if (!applyBalanceDelta(db.accounts[accountIdx], netProfit)) {
    return res.status(400).json({ error: 'Those numbers do not add up to a valid balance.' });
  }

  db.trades.push(newTrade);

  // "Trade logged successfully" is a promise about the database, not about the
  // in-memory copy. saveDatabase used to log a failed upsert and return, so a
  // Supabase outage or a schema mismatch answered 200 and the trade was gone
  // on the next request — with the balance already moved for it. Undo the
  // balance and say what happened instead.
  const saved = await saveDatabase(db, authEmail);
  if (saved?.tradesError || saved?.usersError || saved?.accountsError) {
    applyBalanceDelta(db.accounts[accountIdx], -netProfit);
    const idx = db.trades.findIndex((t: any) => t.id === newTrade.id);
    if (idx !== -1) db.trades.splice(idx, 1);
    return res.status(502).json({
      error: 'Your trade could not be saved. Nothing was changed — please try again.',
    });
  }

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
  const ticketKey = (t: any) => {
    const raw = t.ticket ?? t.eaDealId ?? t.ea_deal_id;
    return (raw === undefined || raw === null || raw === '')
      ? null
      : `ticket:${String(raw)}`;
  };
  const valueKey = (t: any) =>
    [
      String(t.symbol || '').toUpperCase(),
      t.type || '',
      t.date ? (isNaN(new Date(t.date).getTime()) ? t.date : new Date(t.date).getTime()) : '',
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
    applyBalanceDelta(account, balanceAdjustment);
    // Same promise as the single-trade route: reporting "42 trades imported"
    // for rows that never reached the database is the worst outcome here,
    // because the customer will re-import and the duplicate check — which
    // reads the saved rows — has nothing to compare against.
    const savedResult = await saveDatabase(db, authEmail);
    if (savedResult?.tradesError || savedResult?.usersError || savedResult?.accountsError) {
      applyBalanceDelta(account, -balanceAdjustment);
      const savedIds = new Set(saved.map((t: any) => t.id));
      db.trades = (db.trades || []).filter((t: any) => !savedIds.has(t.id));
      return res.status(502).json({
        error: 'The import could not be saved. Nothing was changed — please try again.',
      });
    }
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
  // Number.isFinite, not `diff !== 0`: NaN !== 0 is true, so a trade stored
  // with a non-finite profit would have carried its NaN into the account total
  // on the next edit.
  if (accIdx !== -1 && Number.isFinite(diff) && diff !== 0) {
    applyBalanceDelta(db.accounts[accIdx], diff);
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

  // Reverse trade impact from balance. `|| 0` on profit too: a row stored
  // before the validations above could hold a non-finite one, and reversing it
  // would leave the account total broken with the trade already gone.
  const netProfit = (Number(trade.profit) || 0) + (trade.commission || 0) + (trade.swap || 0);
  applyBalanceDelta(db.accounts[accIdx], -netProfit);

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
      id: `r_${crypto.randomUUID()}`,
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
      id: `r_${crypto.randomUUID()}`,
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

  // 2a. MT5 sync accounts: determine authentic initial/starting capital from MT5.
  // The first deposit in the MT5 history represents the authentic starting capital.
  let skipBalanceTicket: number | undefined;
  if (acc.isMt5Sync) {
    const deposits = accountDeals
      .filter((d: any) => d.type === DEAL_TYPE_BALANCE && (d.profit || 0) > 0)
      .sort((a: any, b: any) => a.time - b.time);

    const isPlaceholderOrUnset = !acc.startingBalance || acc.startingBalance === 0 || acc.startingBalance === 10000 || acc.isDefaultDemo;

    if (deposits.length > 0) {
      skipBalanceTicket = deposits[0].ticket;
      if (isPlaceholderOrUnset || !acc.startingBalanceLocked) {
        acc.startingBalance = parseFloat(deposits[0].profit.toFixed(2));
        acc.startingBalanceLocked = true;
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

  // 3b. If no initial deposit deal was in the MT5 history (e.g. broker history limits),
  // deduce starting capital from live balance minus closed trades net PnL:
  if (acc.isMt5Sync && (!acc.startingBalance || acc.startingBalance === 0 || acc.startingBalance === 10000 || acc.isDefaultDemo || !acc.startingBalanceLocked)) {
    const netTradingProfit = recomputed
      .filter((t: any) => t.type !== 'Deposit' && t.type !== 'Withdrawal')
      .reduce((sum: number, t: any) => sum + (t.profit || 0) + (t.commission || 0) + (t.swap || 0), 0);
    const effCurBalance = acc.currentBalance || (account?.balance ? parseFloat(account.balance) : 0);
    if (effCurBalance > 0) {
      acc.startingBalance = parseFloat(Math.max(0, effCurBalance - netTradingProfit).toFixed(2));
      acc.startingBalanceLocked = true;
    }
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
  acc.isMt5Sync = true;
  acc.isDefaultDemo = false;
  const targetUserId = acc.userId || db.users?.[0]?.id;
  if (targetUserId) {
    await cleanupDefaultDemoAccounts(db, targetUserId, acc.id);
  }
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
  const allConnectJobs: any[] = Array.isArray(db.mt5ConnectJobs) ? db.mt5ConnectJobs : [];
  const connectJobs = allConnectJobs.filter((j: any) => j.accountId === account.id).slice(-5);

  /**
   * Whether a sync worker is actually running, as opposed to merely allowed.
   *
   * vpsSyncAvailable() only says this deployment is CONFIGURED to accept a
   * worker — the token is set. It said "VPS Connected" on a deployment where
   * no worker had ever existed, under a banner promising the sync was about to
   * happen, while the job sat PENDING forever. Nothing in the UI distinguished
   * "queued, worker is working through the queue" from "queued, nothing is
   * going to pick this up".
   *
   * A worker announces itself by claiming: a claim stamps startedAt on the
   * job. So the most recent startedAt across the queue is the last time any
   * worker was alive, which is derived from data already stored rather than a
   * new presence channel that a serverless invocation would not share.
   */
  const workerLastSeenAt = allConnectJobs
    .map((j: any) => j.startedAt)
    .filter((t: any) => typeof t === 'string')
    .sort()
    .pop() || null;

  const oldestPending = allConnectJobs
    .filter((j: any) => j.accountId === account.id && j.status === 'PENDING')
    .map((j: any) => j.createdAt)
    .filter((t: any) => typeof t === 'string')
    .sort()[0] || null;

  // Reconcile accounts stuck in Validating from a cloud connect on a
  // deployment that cannot run the sync worker. The token alone was not enough
  // to tell: it is set here while the worker never starts, so an account
  // connected before this check sat at "Validating" and looked like it was
  // about to come up.
  const workerConfigured = cloudSyncAvailable();
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
    // The UI offers cloud as the easier of the two methods, so it has to know
    // whether this deployment can honour that before showing the form.
    // Two different methods, two different answers. cloudSyncAvailable is the
    // old MetaApi path, which is off; vpsSyncAvailable is our own terminal
    // pool. The UI gates each on its own flag rather than one shared "cloud".
    cloudSyncAvailable: workerConfigured,
    vpsSyncAvailable: vpsSyncAvailable(),
    // Configured to accept a worker (above) versus one having actually turned
    // up (below). The UI needs both: the first decides whether to offer the
    // method, the second decides whether "queued" is a promise or a dead end.
    workerLastSeenAt,
    queuedSince: oldestPending,
    queueDepth: queueDepth(db),
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

  // A cloud connect needs a worker that can actually reach MT5 and keep
  // syncing. Fail fast instead of leaving the account stuck in Validating.
  if (!cloudSyncAvailable()) {
    return res.status(503).json({
      error: 'Cloud sync is not available on this deployment. Use the Expert Advisor method — it needs no extra setup and syncs your full history.',
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

  if (!cloudSyncAvailable()) {
    return res.status(503).json({
      error: 'Cloud sync is not available on this deployment. Use the Expert Advisor method instead.',
      code: 'CLOUD_WORKER_UNAVAILABLE'
    });
  }

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
// MT5 VPS SYNC — worker pool on our own Windows VPS
// ==========================================
//
// A pool of MT5 terminals on a Windows VPS, each driven by a worker process
// that logs into one customer's account with their INVESTOR (read-only)
// password, pulls deal history, hands it to this server, logs out and takes
// the next job.
//
// The workers PULL. Every request below is started by the worker, so nothing
// here needs a long-lived process or a background timer — which is what killed
// the MetaApi path: its loop could never run on serverless. This works the
// same on Netlify as on a box.
//
// Imported trades go through applyEaSyncPayload, the same function the EA path
// uses. Deduplication by deal ticket, the incremental cursor, the reconstruction
// of positions from deals and the balance handling are therefore the code that
// is already proven, not a second implementation that could drift from it.
//
// The investor password is handed to a worker on claim, over HTTPS, for one
// job. That is inherent to the design: the terminal has to log in. It means
// MT5_WORKER_TOKEN can pull any connected customer's investor password, so it
// is a high-value secret — treat it like a database password, give each VPS
// its own if you ever split them, and rotate it if a VPS is ever reimaged.

/** Longest a worker may hold a job before it is considered dead. */
const MT5_JOB_LEASE_MS = 5 * 60 * 1000;
/** Attempts before a job is given up on, so a poisoned job cannot loop forever. */
const MT5_JOB_MAX_ATTEMPTS = 3;

const vpsSyncAvailable = (): boolean =>
  process.env.MT5_VPS_SYNC_ENABLED === 'true' && !!process.env.MT5_WORKER_TOKEN?.trim();

/**
 * Authenticates a VPS worker. Constant-time, and refuses outright when no
 * token is configured rather than falling open.
 */
function authWorker(req: any, res: any): boolean {
  const configured = process.env.MT5_WORKER_TOKEN?.trim();
  if (!configured) {
    res.status(503).json({ error: 'VPS sync is not configured on this deployment.', code: 'VPS_NOT_CONFIGURED' });
    return false;
  }
  const header = (req.headers['authorization'] || '').toString().trim();
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented || !safeTokenEqual(presented, configured)) {
    res.status(401).json({ error: 'Invalid worker token', code: 'WORKER_AUTH_FAILED' });
    return false;
  }
  // A password crosses this boundary, so refuse plaintext anywhere real.
  const proto = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim();
  if (IS_PRODUCTION_LIKE && proto && proto !== 'https') {
    res.status(403).json({ error: 'Worker API requires HTTPS', code: 'WORKER_INSECURE_TRANSPORT' });
    return false;
  }
  return true;
}

const WorkerClaimSchema = z.object({
  workerId: boundedString(64),
  terminal: boundedString(64).optional(),
}).strict();

const WorkerJobRefSchema = z.object({
  jobId: boundedString(80),
  workerId: boundedString(64),
}).strict();

const WorkerSyncSchema = z.object({
  jobId: boundedString(80),
  workerId: boundedString(64),
  deals: z.array(EaDealSchema).max(500),
  moneyFlows: z.array(EaMoneyFlowSchema).max(500).optional(),
  account: z.object({
    balance: finiteNumber().optional(),
    equity: finiteNumber().optional(),
    currency: boundedString(8).optional(),
  }).optional(),
}).strict();

const WorkerCompleteSchema = z.object({
  jobId: boundedString(80),
  workerId: boundedString(64),
  ok: z.boolean(),
  error: boundedString(500).optional(),
  errorCode: boundedString(64).optional(),
  tradesImported: z.number().int().nonnegative().optional(),
}).strict();

/**
 * Returns jobs whose lease has run out to the queue.
 *
 * A worker that is killed mid-job — the VPS reboots, the terminal hangs, the
 * process is stopped — leaves its job RUNNING forever and its terminal slot
 * permanently spoken for. Reaped on every claim rather than on a timer, so it
 * needs no background process.
 */
function reapExpiredJobs(db: any): number {
  const jobs: any[] = Array.isArray(db.mt5ConnectJobs) ? db.mt5ConnectJobs : [];
  const now = Date.now();
  let reaped = 0;
  for (const job of jobs) {
    if (job.status !== 'RUNNING') continue;
    const leaseUntil = job.leaseUntil ? Date.parse(job.leaseUntil) : 0;
    if (!leaseUntil || leaseUntil > now) continue;
    reaped++;
    if ((job.attempts || 0) >= MT5_JOB_MAX_ATTEMPTS) {
      job.status = 'FAILED';
      job.error = 'Worker stopped responding and the job ran out of attempts.';
    } else {
      job.status = 'PENDING';
      job.workerId = null;
      job.leaseUntil = null;
    }
    job.updatedAt = new Date().toISOString();
  }
  return reaped;
}

/** Every local database that might hold a queued job. */
const allJobDbs = (): any[] => {
  const seen = new Set<any>();
  const out: any[] = [];
  const add = (d: any) => { if (d && !seen.has(d)) { seen.add(d); out.push(d); } };
  try { add(loadDatabaseFromFile()); } catch { /* caches below still count */ }
  for (const cached of userDatabases.values()) add(cached);
  return out;
};

// POST /api/mt5/worker/claim — take the next queued sync job
app.post('/api/mt5/worker/claim', async (req, res) => {
  if (!authWorker(req, res)) return;
  const body = validateEaBody(res, WorkerClaimSchema, req.body || {});
  if (!body) return;

  // 1. On Supabase, query trading_accounts directly for any account waiting for VPS sync
  if (useSupabase) {
    try {
      const { data: pendingRows } = await supabase
        .from('trading_accounts')
        .select('*')
        .in('sync_method', ['CLOUD', 'VPS'])
        .in('connection_status', ['Validating', 'Queued', 'In Queue'])
        .not('investor_password_enc', 'is', null)
        .limit(5);

      for (const rawAcc of pendingRows || []) {
        const account = toCamel(rawAcc);
        const password = decryptInvestorPassword(account);
        if (!password) {
          console.error('[worker/claim] Stored investor password could not be decrypted for account:', account.id);
          continue;
        }

        const db = await ensureUserDbLoaded(account.userId, '');
        const jobId = `job_acc_${account.id}`;
        const job = {
          id: jobId,
          action: 'CONNECT',
          accountId: account.id,
          attempts: 1,
          leaseUntil: new Date(Date.now() + MT5_JOB_LEASE_MS).toISOString(),
          workerId: body.workerId,
          terminal: body.terminal || null,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'RUNNING',
        };

        if (!Array.isArray(db.mt5ConnectJobs)) db.mt5ConnectJobs = [];
        db.mt5ConnectJobs = db.mt5ConnectJobs.filter((j: any) => j.accountId !== account.id);
        db.mt5ConnectJobs.push(job);

        // Mirror connection attempt
        logEaEvent(db, account, 'VPS_JOB_CLAIMED', 'info', `Worker ${body.workerId} claimed CONNECT for MT5 ${account.mt5Login}`);
        await saveDatabase(db, db.users?.[0]?.email);

        return res.json({
          job: {
            id: job.id,
            action: job.action,
            accountId: account.id,
            attempts: job.attempts,
            leaseUntil: job.leaseUntil,
            leaseSeconds: Math.floor(MT5_JOB_LEASE_MS / 1000),
          },
          credentials: {
            login: String(account.mt5Login || ''),
            server: String(account.mt5Server || ''),
            investorPassword: password,
          },
          sinceDeal: account.eaLastDealId || 0,
          backfillDays: Number(process.env.MT5_CLOUD_BACKFILL_DAYS || 90),
        });
      }
    } catch (e: any) {
      console.error('[worker/claim] Supabase pending accounts lookup failed:', e?.message || e);
    }
  }

  // 2. In-memory / local database queue fallback
  const dbs = useSupabase ? [] : allJobDbs();
  if (useSupabase) {
    const { data: rows } = await supabase.from('users').select('id').limit(100);
    for (const r of rows || []) {
      const d = await ensureUserDbLoaded((r as any).id, '');
      if (d) dbs.push(d);
    }
  }

  for (const db of dbs) {
    reapExpiredJobs(db);
    const jobs: any[] = Array.isArray(db.mt5ConnectJobs) ? db.mt5ConnectJobs : [];
    const job = jobs
      .filter((j) => j.status === 'PENDING' && (j.action === 'SYNC_NOW' || j.action === 'CONNECT'))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
    if (!job) continue;

    const account = (db.accounts || []).find((a: any) => a.id === job.accountId);
    if (!account) {
      job.status = 'FAILED';
      job.error = 'Account no longer exists';
      job.updatedAt = new Date().toISOString();
      await saveDatabase(db, db.users?.[0]?.email);
      continue;
    }

    const password = decryptInvestorPassword(account);
    if (!password) {
      job.status = 'FAILED';
      job.error = 'Stored investor password could not be decrypted. Ask the customer to reconnect.';
      job.updatedAt = new Date().toISOString();
      account.connectionStatus = 'Error';
      logEaEvent(db, account, 'VPS_CREDENTIAL_UNREADABLE', 'error', job.error);
      await saveDatabase(db, db.users?.[0]?.email);
      continue;
    }

    job.status = 'RUNNING';
    job.attempts = (job.attempts || 0) + 1;
    job.workerId = body.workerId;
    job.terminal = body.terminal || null;
    job.leaseUntil = new Date(Date.now() + MT5_JOB_LEASE_MS).toISOString();
    job.startedAt = new Date().toISOString();
    job.updatedAt = job.startedAt;

    account.connectionStatus = 'Validating';
    logEaEvent(db, account, 'VPS_JOB_CLAIMED', 'info', `Worker ${body.workerId} claimed ${job.action}`);
    await saveDatabase(db, db.users?.[0]?.email);

    // `sinceDeal` is the incremental cursor: the worker asks MT5 only for
    // deals after it, so a re-sync is cheap and the first one is a full pull.
    return res.json({
      job: {
        id: job.id,
        action: job.action,
        accountId: account.id,
        attempts: job.attempts,
        leaseUntil: job.leaseUntil,
        leaseSeconds: Math.floor(MT5_JOB_LEASE_MS / 1000),
      },
      credentials: {
        login: String(account.mt5Login || ''),
        server: String(account.mt5Server || ''),
        investorPassword: password,
      },
      sinceDeal: account.eaLastDealId || 0,
      backfillDays: Number(process.env.MT5_CLOUD_BACKFILL_DAYS || 90),
    });
  }

  res.json({ job: null });
});

async function resolveJobDb(jobId: string, workerId?: string): Promise<{ db: any; job: any } | null> {
  for (const db of allJobDbs()) {
    const job = (db.mt5ConnectJobs || []).find((j: any) => j.id === jobId);
    if (job) return { db, job };
  }
  if (useSupabase && jobId.startsWith('job_acc_')) {
    const accountId = jobId.replace('job_acc_', '');
    const { data: acc } = await supabase.from('trading_accounts').select('user_id').eq('id', accountId).maybeSingle();
    if (acc?.user_id) {
      const udb = await ensureUserDbLoaded(acc.user_id, '');
      if (udb) {
        if (!Array.isArray(udb.mt5ConnectJobs)) udb.mt5ConnectJobs = [];
        let job = udb.mt5ConnectJobs.find((j: any) => j.id === jobId);
        if (!job) {
          job = {
            id: jobId,
            accountId,
            userId: acc.user_id,
            workerId: workerId || 'vps1-terminal1',
            status: 'RUNNING',
            leaseUntil: new Date(Date.now() + MT5_JOB_LEASE_MS).toISOString(),
          };
          udb.mt5ConnectJobs.push(job);
        }
        return { db: udb, job };
      }
    }
  }
  return null;
}

// POST /api/mt5/worker/heartbeat — extend the lease on a long history pull
app.post('/api/mt5/worker/heartbeat', async (req, res) => {
  if (!authWorker(req, res)) return;
  const body = validateEaBody(res, WorkerJobRefSchema, req.body || {});
  if (!body) return;

  const resolved = await resolveJobDb(body.jobId, body.workerId);
  if (!resolved) {
    return res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND' });
  }
  const { db, job } = resolved;
  if (job.workerId && job.workerId !== body.workerId) {
    return res.status(409).json({ error: 'This job belongs to another worker', code: 'JOB_LEASE_LOST' });
  }
  job.workerId = body.workerId;
  job.status = 'RUNNING';
  job.leaseUntil = new Date(Date.now() + MT5_JOB_LEASE_MS).toISOString();
  job.updatedAt = new Date().toISOString();
  await saveDatabase(db, db.users?.[0]?.email);
  return res.json({ ok: true, leaseUntil: job.leaseUntil });
});

// POST /api/mt5/worker/sync — hand over a batch of deals
app.post('/api/mt5/worker/sync', async (req, res) => {
  if (!authWorker(req, res)) return;
  const body = validateEaBody(res, WorkerSyncSchema, req.body || {});
  if (!body) return;

  const resolved = await resolveJobDb(body.jobId, body.workerId);
  if (!resolved) {
    return res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND' });
  }
  const { db, job } = resolved;

  // The lease, enforced. Without this the handler simply reassigned the job to
  // whoever posted — so any worker holding the shared token could push into a
  // job another worker was already running, and that worker's next heartbeat
  // came back 409 with its work half done. Two terminals on one job is exactly
  // the duplicate import the queue exists to prevent. Same rule as heartbeat:
  // a job with no owner yet may be adopted, one with an owner may not be
  // taken.
  if (job.workerId && job.workerId !== body.workerId) {
    return res.status(409).json({ error: 'Job lease lost — stop and re-claim', code: 'JOB_LEASE_LOST' });
  }

  const account = (db.accounts || []).find((a: any) => a.id === job.accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const summary = applyEaSyncPayload(db, account, body.deals, body.moneyFlows, body.account);
  account.syncMethod = 'VPS';
  job.workerId = body.workerId;
  job.status = 'RUNNING';
  job.leaseUntil = new Date(Date.now() + MT5_JOB_LEASE_MS).toISOString();
  job.updatedAt = new Date().toISOString();

  logEaEvent(db, account, 'VPS_SYNC', 'info',
    `Deals: ${summary.added} new / ${body.deals.length} received; money flows: ${summary.moneyFlowAdded} new`);
  await saveDatabase(db, db.users?.[0]?.email);

  return res.json({
    ok: true,
    inserted: summary.inserted,
    updated: summary.updated,
    cursor: summary.maxTicket,
    totalTrades: account.eaSyncTradeCount,
    leaseUntil: job.leaseUntil,
  });
});

// POST /api/mt5/worker/complete — the worker has logged out and is free again
app.post('/api/mt5/worker/complete', async (req, res) => {
  if (!authWorker(req, res)) return;
  const body = validateEaBody(res, WorkerCompleteSchema, req.body || {});
  if (!body) return;

  const resolved = await resolveJobDb(body.jobId, body.workerId);
  if (!resolved) {
    return res.status(404).json({ error: 'Job not found', code: 'JOB_NOT_FOUND' });
  }
  const { db, job } = resolved;

  // Finishing someone else's job is the same hijack as pushing to it, and
  // worse: it clears the owner's lease and marks the work done while that
  // worker is still mid-sync.
  if (job.workerId && job.workerId !== body.workerId) {
    return res.status(409).json({ error: 'This job belongs to another worker', code: 'JOB_LEASE_LOST' });
  }

  const account = (db.accounts || []).find((a: any) => a.id === job.accountId);

  job.status = body.ok ? 'DONE' : (job.attempts >= MT5_JOB_MAX_ATTEMPTS ? 'FAILED' : 'PENDING');
  job.error = body.ok ? null : (body.error || 'Sync failed');
  job.errorCode = body.ok ? null : (body.errorCode || null);
  job.workerId = null;
  job.leaseUntil = null;
  job.finishedAt = new Date().toISOString();
  job.updatedAt = job.finishedAt;

  if (account) {
    if (body.ok) {
      account.connectionStatus = 'Connected';
      account.eaStatus = 'Connected';
      account.eaLastSyncTime = new Date().toISOString();
      account.lastHeartbeatAt = account.eaLastSyncTime;
      logEaEvent(db, account, 'VPS_SYNC_DONE', 'info',
        `Sync finished; ${body.tradesImported ?? account.eaSyncTradeCount ?? 0} trades in the journal`);
    } else {
      account.connectionStatus = job.status === 'FAILED' ? 'Error' : 'Validating';
      if (!Array.isArray(db.mt5ConnectionErrors)) db.mt5ConnectionErrors = [];
      db.mt5ConnectionErrors.push({
        accountId: account.id,
        userId: db.users?.[0]?.id,
        errorCode: body.errorCode || 'VPS_SYNC_FAILED',
        errorMessage: String(body.error || 'Sync failed').slice(0, 500),
        occurredAt: new Date().toISOString(),
        resolvedAt: null,
      });
      logEaEvent(db, account, 'VPS_SYNC_FAILED', 'error', String(body.error || 'Sync failed').slice(0, 200));
    }
  }

  await saveDatabase(db, db.users?.[0]?.email);
  return res.json({ ok: true, status: job.status });
});

// ── Customer-facing VPS sync ──────────────────────────────────────────────

// POST /api/mt5/vps/connect — store the credentials and queue the first sync
app.post('/api/mt5/vps/connect', async (req, res) => {
  const db = (req as any).userDb;
  const currentUser = (req as any).currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });
  if (!requirePro(req, res, 'mt5Sync')) return;

  if (!vpsSyncAvailable()) {
    return res.status(503).json({
      error: 'Automatic sync is not available on this deployment yet. Use the Expert Advisor method.',
      code: 'VPS_NOT_CONFIGURED',
    });
  }

  const body = validateEaBody(res, CloudConnectSchema, req.body || {});
  if (!body) return;

  const account = db.accounts.find((a: any) => a.id === body.accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: 'Access denied' });

  const enc = encryptInvestorPassword(body.investorPassword);
  if (!enc) {
    return res.status(503).json({
      error: 'Credential storage is not configured on this deployment (MT5_CREDENTIAL_MASTER_KEY).',
      code: 'CLOUD_NOT_CONFIGURED',
    });
  }

  account.investorPasswordEnc = enc.enc;
  account.passwordEncNonce = '';
  account.passwordKmsKeyId = enc.keyId;
  account.mt5Login = body.login;
  account.mt5Server = body.server;
  account.isMt5Sync = true;
  account.isDefaultDemo = false;
  if (account.accountType === 'Demo' && (account.broker === 'MT5 Demo Broker' || account.broker === 'Demo Broker')) {
    account.broker = body.server || 'MetaTrader 5';
    if (account.name === 'Portfolio Account' || account.name === 'Main Trading Account') {
      account.name = `MT5 - ${body.login}`;
    }
  }
  account.syncMethod = 'VPS';
  account.connectionStatus = 'Queued';
  account.eaStatus = 'Not Connected';

  // Option A: Clean up any other default starter demo accounts
  await cleanupDefaultDemoAccounts(db, currentUser.id, account.id);

  const jobId = enqueueConnectJob(db, account, 'SYNC_NOW');
  logEaEvent(db, account, 'VPS_CONNECT_REQUESTED', 'info', 'Queued for a VPS terminal; password stored encrypted');
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, jobId, syncMethod: 'VPS', status: 'Queued', queuePosition: queueDepth(db) });
});

// POST /api/mt5/vps/sync — queue another sync for an already-connected account
app.post('/api/mt5/vps/sync', async (req, res) => {
  const db = (req as any).userDb;
  const currentUser = (req as any).currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: 'Not authenticated' });
  if (!requirePro(req, res, 'mt5Sync')) return;

  if (!vpsSyncAvailable()) {
    return res.status(503).json({
      error: 'Automatic sync is not available on this deployment yet.',
      code: 'VPS_NOT_CONFIGURED',
    });
  }

  const body = validateEaBody(res, CloudDisconnectSchema, req.body || {});
  if (!body) return;

  const account = db.accounts.find((a: any) => a.id === body.accountId);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: 'Access denied' });
  if (!account.investorPasswordEnc) {
    return res.status(400).json({ error: 'This account is not connected for automatic sync yet.' });
  }

  // Clicking Sync twice should not put two jobs on the queue for one account.
  const existing = (db.mt5ConnectJobs || []).find(
    (j: any) => j.accountId === account.id && (j.status === 'PENDING' || j.status === 'RUNNING'),
  );
  if (existing) {
    return res.json({ ok: true, jobId: existing.id, status: existing.status, alreadyQueued: true });
  }

  const jobId = enqueueConnectJob(db, account, 'SYNC_NOW');
  account.connectionStatus = 'Queued';
  logEaEvent(db, account, 'VPS_SYNC_REQUESTED', 'info', 'Sync queued');
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, jobId, status: 'Queued', queuePosition: queueDepth(db) });
});

/** How many jobs are waiting, for the "you are Nth in line" line in the UI. */
function queueDepth(db: any): number {
  return (db.mt5ConnectJobs || []).filter((j: any) => j.status === 'PENDING').length;
}

// ==========================================
// MT5 INTEGRATION KIT — DESKTOP BRIDGE ENDPOINTS
//
// MOUNT ORDER IS THE WHOLE DESIGN HERE. Express matches routes in the order
// they are registered, so this router is mounted AFTER every /api/mt5/* route
// above. Mounted before them it would shadow the EA and VPS endpoints that
// customers are using today.
//
// What that leaves the kit handling is exactly the three paths this server
// does not define:
//
//   GET  /api/mt5/worker/jobs
//   POST /api/mt5/worker/job/:id/status
//   POST /api/mt5/worker/job/:id/trades
//
// which is the protocol the kit's python_worker/worker.py speaks. Everything
// else in the kit's router — /ea/validate, /ea/account, /ea/positions,
// /ea/orders, /ea/heartbeat, /ea/sync, /ea/:accountId/download — is already
// answered above, with HMAC verification on every route rather than only on
// the handshake, zod-validated bodies, and rate limiting. Those handlers never
// run, and that is deliberate.
//
// The two bridges share one queue (db.mt5ConnectJobs) and one secret, so a
// job can be served by whichever worker is running and there is no second
// token to rotate.
// ==========================================

/**
 * The kit calls this the bridge token. It is the same secret as the VPS
 * worker's, because both pull the same jobs and both receive a decrypted
 * investor password — two names for one level of access would only mean one
 * of them gets forgotten at rotation time.
 *
 * No literal fallback: the kit's own README suggests
 * `process.env.BRIDGE_AUTH_TOKEN || 'dev-bridge-secret-token'`, and this
 * repository is public, so an unset variable would publish the token.
 */
const bridgeAuthToken = (): string =>
  process.env.BRIDGE_AUTH_TOKEN?.trim() || process.env.MT5_WORKER_TOKEN?.trim() || '';

/** Finds a queued job and its account across every loaded database. */
function findBridgeJob(jobId: string): { db: any; job: any; account: any } | null {
  for (const db of allJobDbs()) {
    const job = (db.mt5ConnectJobs || []).find((j: any) => j.id === jobId);
    if (!job) continue;
    const account = (db.accounts || []).find((a: any) => a.id === job.accountId) || null;
    return { db, job, account };
  }
  return null;
}

app.use('/api/mt5', createMt5Router({
  getAccount: async (id: string) => {
    for (const db of allJobDbs()) {
      const account = (db.accounts || []).find((a: any) => a.id === id);
      if (account) return account;
    }
    return null;
  },

  saveAccount: async (account: any) => {
    for (const db of allJobDbs()) {
      if ((db.accounts || []).some((a: any) => a.id === account.id)) {
        await saveDatabase(db, db.users?.[0]?.email);
        return;
      }
    }
  },

  // The EA routes that would use these are all answered above, so these exist
  // to satisfy the kit's interface rather than to be called. They write to the
  // same collections the live handlers use, so if the kit's router ever does
  // become reachable the data lands in one place rather than two.
  saveSnapshots: async (snapshots: any[]) => {
    for (const snap of snapshots) {
      for (const db of allJobDbs()) {
        if (!(db.accounts || []).some((a: any) => a.id === snap.accountId)) continue;
        if (!Array.isArray(db.mt5AccountSnapshots)) db.mt5AccountSnapshots = [];
        db.mt5AccountSnapshots.push({ ...snap, userId: db.users?.[0]?.id });
        await saveDatabase(db, db.users?.[0]?.email);
        break;
      }
    }
  },

  saveOpenPositions: async (accountId: string, positions: any[]) => {
    for (const db of allJobDbs()) {
      if (!(db.accounts || []).some((a: any) => a.id === accountId)) continue;
      if (!Array.isArray(db.mt5OpenPositions)) db.mt5OpenPositions = [];
      db.mt5OpenPositions = db.mt5OpenPositions.filter((p: any) => p.accountId !== accountId);
      db.mt5OpenPositions.push(...positions.map((p: any) => ({ ...p, accountId, userId: db.users?.[0]?.id })));
      await saveDatabase(db, db.users?.[0]?.email);
      return;
    }
  },

  savePendingOrders: async (accountId: string, orders: any[]) => {
    for (const db of allJobDbs()) {
      if (!(db.accounts || []).some((a: any) => a.id === accountId)) continue;
      if (!Array.isArray(db.mt5PendingOrders)) db.mt5PendingOrders = [];
      db.mt5PendingOrders = db.mt5PendingOrders.filter((o: any) => o.accountId !== accountId);
      db.mt5PendingOrders.push(...orders.map((o: any) => ({ ...o, accountId, userId: db.users?.[0]?.id })));
      await saveDatabase(db, db.users?.[0]?.email);
      return;
    }
  },

  saveTrades: async (trades: any[]) => {
    if (!trades.length) return;
    const accountId = trades[0].accountId;
    for (const db of allJobDbs()) {
      if (!(db.accounts || []).some((a: any) => a.id === accountId)) continue;
      if (!Array.isArray(db.trades)) db.trades = [];
      const existing = new Set(db.trades.map((t: any) => t.id));
      for (const t of trades) {
        if (!existing.has(t.id)) db.trades.push({ ...t, userId: db.users?.[0]?.id });
      }
      await saveDatabase(db, db.users?.[0]?.email);
      return;
    }
  },

  /**
   * Hands the desktop worker its next job, with the credentials for it.
   *
   * The kit's own version returned `jobs.slice(0, 1)` from a plain queue and
   * marked nothing, so two workers polling five seconds apart both received
   * the same job and imported it twice. Claiming it under the same lease the
   * VPS workers use means a second worker gets nothing instead of a duplicate,
   * and a worker that dies mid-job has its lease reaped and the job retried.
   */
  getQueuedJobs: async () => {
    for (const db of allJobDbs()) {
      reapExpiredJobs(db);
      const job = (db.mt5ConnectJobs || [])
        .filter((j: any) => j.status === 'PENDING' && (j.action === 'SYNC_NOW' || j.action === 'CONNECT'))
        .sort((a: any, b: any) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
      if (!job) continue;

      const account = (db.accounts || []).find((a: any) => a.id === job.accountId);
      if (!account) {
        job.status = 'FAILED';
        job.error = 'Account no longer exists';
        job.updatedAt = new Date().toISOString();
        await saveDatabase(db, db.users?.[0]?.email);
        continue;
      }

      const password = decryptInvestorPassword(account);
      if (!password) {
        job.status = 'FAILED';
        job.error = 'Stored investor password could not be decrypted. Ask the customer to reconnect.';
        job.updatedAt = new Date().toISOString();
        account.connectionStatus = 'Error';
        logEaEvent(db, account, 'VPS_CREDENTIAL_UNREADABLE', 'error', job.error);
        await saveDatabase(db, db.users?.[0]?.email);
        continue;
      }

      job.status = 'RUNNING';
      job.attempts = (job.attempts || 0) + 1;
      job.workerId = 'desktop-bridge';
      job.leaseUntil = new Date(Date.now() + MT5_JOB_LEASE_MS).toISOString();
      job.startedAt = new Date().toISOString();
      job.updatedAt = job.startedAt;
      account.connectionStatus = 'Validating';
      logEaEvent(db, account, 'BRIDGE_JOB_CLAIMED', 'info', `Desktop bridge claimed ${job.action}`);
      await saveDatabase(db, db.users?.[0]?.email);

      // Shaped the way worker.py reads it: job['id'] and job['connection'].
      return [{
        id: job.id,
        connection: {
          mt5AccountNumber: String(account.mt5Login || ''),
          mt5Server: String(account.mt5Server || ''),
          investorPassword: password,
        },
      }];
    }
    return [];
  },

  updateJobStatus: async (jobId: string, status: string, error?: string) => {
    const found = findBridgeJob(jobId);
    if (!found) return;
    const { db, job, account } = found;

    // The kit reports progress (CONNECTING, FETCHING_HISTORY, IMPORTING) as
    // well as outcomes. Only the outcomes end the job; the rest extend the
    // lease, so a long history pull is not reaped out from under the worker.
    if (status === 'COMPLETED' || status === 'FAILED') {
      job.status = status === 'COMPLETED' ? 'DONE' : 'FAILED';
      job.leaseUntil = null;
      job.completedAt = new Date().toISOString();
      if (error) job.error = error;
      if (account) {
        account.connectionStatus = status === 'COMPLETED' ? 'Connected' : 'Error';
        if (status === 'COMPLETED') account.lastSyncTime = new Date().toISOString();
        logEaEvent(db, account, `BRIDGE_${status}`, status === 'COMPLETED' ? 'info' : 'error',
          error || `Desktop bridge reported ${status}`);
      }
    } else {
      job.leaseUntil = new Date(Date.now() + MT5_JOB_LEASE_MS).toISOString();
      job.statusMessage = status;
      if (account) account.connectionStatus = 'Syncing';
    }
    job.updatedAt = new Date().toISOString();
    await saveDatabase(db, db.users?.[0]?.email);
  },

  /**
   * Stores the trades the desktop worker reconstructed.
   *
   * worker.py sends finished trades rather than raw deals, so this cannot go
   * through applyEaSyncPayload — that one takes deals. Rows are keyed on the
   * broker's position id, which is what makes a re-run idempotent: the worker
   * pulls the full history from 2000 every time it runs, so without the key
   * every sync would duplicate the entire journal.
   */
  saveImportedTrades: async (jobId: string, payload: any) => {
    const found = findBridgeJob(jobId);
    if (!found || !found.account) return { imported: 0, skipped: 0 };
    const { db, account } = found;

    if (!Array.isArray(db.trades)) db.trades = [];
    const existing = new Set(db.trades.map((t: any) => String(t.id)));
    const userId = db.users?.[0]?.id;

    let imported = 0;
    let skipped = 0;
    for (const t of Array.isArray(payload?.trades) ? payload.trades : []) {
      const id = `mt5bridge_${account.id}_${t.externalTradeId}`;
      if (existing.has(id)) { skipped++; continue; }
      db.trades.push({
        id,
        accountId: account.id,
        userId,
        date: t.entryTime || t.exitTime || new Date().toISOString(),
        exitTime: t.exitTime || null,
        symbol: String(t.symbol || 'UNKNOWN').toUpperCase(),
        type: String(t.type).toUpperCase() === 'SELL' ? 'Sell' : 'Buy',
        lotSize: Number(t.lotSize) || 0,
        entryPrice: Number(t.entryPrice) || 0,
        exitPrice: Number(t.exitPrice) || 0,
        // worker.py has already folded commission and swap into netProfit, so
        // adding them again here would double-count every cost.
        profit: Number(t.netProfit) || 0,
        commission: Number(t.commission) || 0,
        swap: Number(t.swap) || 0,
        riskPercentage: 1.0,
        strategy: 'MT5 Bridge Sync',
        emotion: 'Calm',
        notes: '',
        screenshot: '',
        tags: ['MT5 Sync'],
        isMt5Sync: true,
        ticket: String(t.externalTradeId),
      });
      existing.add(id);
      imported++;
    }

    if (payload?.balance !== undefined) account.currentBalance = Number(payload.balance);
    if (payload?.equity !== undefined) account.equity = Number(payload.equity);
    account.eaSyncTradeCount = db.trades.filter((t: any) => t.accountId === account.id && t.isMt5Sync).length;
    account.syncMethod = 'VPS';

    logEaEvent(db, account, 'BRIDGE_IMPORT', 'info', `Imported ${imported} trades, ${skipped} already present`);
    await saveDatabase(db, db.users?.[0]?.email);
    return { imported, skipped };
  },

  bridgeAuthToken: bridgeAuthToken(),
}));

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

  // Fetch trades respecting search scope
  const scope = req.body?.scope || 'account';
  const accountTrades = (db.trades || []).filter((t: any) => {
    if (t.type === 'Deposit' || t.type === 'Withdrawal') return false;
    if (scope === 'all') return true;
    if (scope === 'today') {
      const todayStr = new Date().toISOString().split('T')[0];
      return t.accountId === accountId && (t.date || '').startsWith(todayStr);
    }
    return t.accountId === accountId;
  });

  const startingBal = parseFloat(targetAcc?.startingBalance || targetAcc?.starting_balance || 0);
  const currentBal = parseFloat(targetAcc?.currentBalance || targetAcc?.current_balance || targetAcc?.balance || startingBal);
  const equityBal = parseFloat(targetAcc?.equity || currentBal);
  const netPnLVal = (currentBal - startingBal).toFixed(2);
  const drawdownPctVal = startingBal > 0 && currentBal < startingBal
    ? (((startingBal - currentBal) / startingBal) * 100).toFixed(2)
    : '0';

  // Prepare a concise trading digest for AI (latest 50 trades)
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

  const openRouterKey = process.env.OPENROUTER_API_KEY || '';

  const systemInstruction = `You are ${traderName}'s personal AI trading mentor, coach, and companion on FX Journal Pro. Your name is "Heyza AI" (also known as AI Mentor).

Language & Communication:
- ${traderName} speaks English, Malayalam, and Manglish (Malayalam written phonetically using the English alphabet).
- Common Manglish phrases and their exact meanings:
  * "ente trading engane und" / "engane und" -> "How is my trading performing?"
  * "ethraya loss aayath" / "ethra loss aayi" -> "How much loss did I make?"
  * "win rate ethraya" -> "What is my win rate?"
  * "rpy onum crct allalo" / "reply crct alla" -> "Your replies are not accurate or not answering my question"
  * "ai work avunondo" -> "Is the AI working?"
  * "trade edukkatte" -> "Should I enter a trade?"
  * "njan profit aano" -> "Am I in profit?"
- If ${traderName} writes in Malayalam or Manglish, you MUST understand their exact question and reply in friendly, conversational Malayalam or Manglish.
- NEVER give generic textbook definitions when asked conversational questions like "ente trading engane und". Always answer about their real account balance ($${currentBal.toFixed(2)}), net P/L (${parseFloat(netPnLVal) >= 0 ? '+' : ''}$${netPnLVal}), and drawdown (${drawdownPctVal}%)!

Account Live Overview:
- Trader Name: ${traderName}
- Account Name: ${accountName}
- Broker & Platform: ${targetAcc?.broker || 'Exness'} (${targetAcc?.platform || 'MT5'})
- Starting Capital: $${startingBal.toFixed(2)}
- Current Live Balance: $${currentBal.toFixed(2)}
- Live Equity: $${equityBal.toFixed(2)}
- Net P/L: ${parseFloat(netPnLVal) >= 0 ? '+' : ''}$${netPnLVal}
- Drawdown: ${drawdownPctVal}%
- Detected MT5 Sync Trades: ${targetAcc?.eaSyncTradeCount || 0}
- Detailed Journal Trades Logged: ${accountTrades.length}

Trading History Digest (Latest ${digest.length} closed trades in journal):
${JSON.stringify(digest)}

Personality & Guidance Rules:
- Extremely warm, approachable, realistic, and disciplined — like an experienced prop firm risk manager who genuinely cares about ${traderName}'s growth.
- MANDATORY LANGUAGE MATCHING: If ${traderName} speaks in Malayalam or Manglish, you MUST answer in Malayalam (or natural conversational Manglish).
- MANDATORY ACCOUNT METRICS: Whenever ${traderName} asks about their performance, account, profits, or losses, ALWAYS directly mention their live numbers:
  • Account: "${accountName}" (${targetAcc?.broker || 'Exness'} ${targetAcc?.platform || 'MT5'})
  • Starting Capital: $${startingBal.toFixed(2)}
  • Current Live Balance: $${currentBal.toFixed(2)}
  • Net P/L: ${parseFloat(netPnLVal) >= 0 ? '+' : ''}$${netPnLVal} (${drawdownPctVal}% drawdown)
  • Journaled Trades: ${accountTrades.length} trades
  If detailed closed trade records are 0 in the journal (even though MT5 is connected), explain that their live balance is $${currentBal.toFixed(2)} (${drawdownPctVal}% drawdown), and once trades are synced or closed in MT5, win rate and setup stats will automatically show up.
- Always encourage strict risk management (1-2% risk per trade, stop losses, avoiding revenge trading).
- Use helpful emojis naturally (📊, 🎯, 🚀, 💡, 🛡️, 💪, 🙏).
- NEVER guarantee profits or make financial promises.`;

  const firstUserIdx = messages.findIndex((m: any) => m.role === 'user');
  const validMessages = firstUserIdx !== -1 ? messages.slice(firstUserIdx) : messages;

  // 1. Try OpenRouter (GPT-4o Mini / Gemma Free)
  if (openRouterKey && !openRouterKey.includes('MY_KEY')) {
    try {
      const requestedModel = String(req.body?.model || '').toLowerCase();
      let preferredModel = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
      if (requestedModel.includes('gpt')) {
        preferredModel = 'openai/gpt-4o-mini';
      } else if (requestedModel.includes('gemma')) {
        preferredModel = 'google/gemma-4-26b-a4b-it:free';
      }
      const candidateModels = [...new Set([preferredModel, 'openai/gpt-4o-mini', 'google/gemma-4-26b-a4b-it:free', 'openai/gpt-4o'])];

      const promptMessages = [
        { role: 'system', content: systemInstruction },
        ...validMessages.map((m: any) => ({
          role: m.role === 'mentor' ? 'assistant' : 'user',
          content: m.content
        }))
      ];

      for (const model of candidateModels) {
        try {
          const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openRouterKey.trim()}`,
              'HTTP-Referer': 'https://www.fxjournalpro.com',
              'X-Title': 'FX Journal Pro',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              max_tokens: 1200,
              messages: promptMessages,
            })
          });

          const orData: any = await orRes.json();
          if (orData?.choices?.[0]?.message?.content) {
            return res.json({ reply: orData.choices[0].message.content });
          }
          console.warn(`[OpenRouter] Model ${model} unavailable:`, orData?.error?.message || orData);
        } catch (mErr: any) {
          console.warn(`[OpenRouter] Model ${model} fetch failed:`, mErr?.message || mErr);
        }
      }
    } catch (e: any) {
      console.error('[OpenRouter] Request error:', e?.message || e);
    }
  }

  // 2. Try Google Gemini if configured
  if (geminiKey && geminiKey !== "MY_GEMINI_API_KEY") {
    try {
      const ai = new GoogleGenAI({
        apiKey: geminiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });

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

      const replyText = response.text;
      if (replyText) {
        return res.json({ reply: replyText });
      }
    } catch (err: any) {
      console.error('Gemini API Error, using smart mentor fallback:', err);
    }
  }

  // 3. Fallback to smart mentor script
  const fallbackReply = generateSmartMentorFallback(userMessage, accountTrades, accountName);
  return res.json({ reply: fallbackReply, fallback: true });
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
// BILLING — RAZORPAY PAYMENT GATEWAY
//
// Pro is sold as a 30-day pass: one Razorpay order, one payment, 30 days of
// access added to whatever is left of the current period.
//
// Three rules here matter more than the rest:
//   1. The WEBHOOK is the source of truth, not the browser callback. A client
//      can close the tab or lose connection; the webhook is signed by Razorpay
//      and arrives regardless.
//   2. Nothing the browser sends is evidence of payment without verified signature.
//      /verify checks the HMAC signature computed from order_id|payment_id
//      with RAZORPAY_KEY_SECRET, and verifies against Razorpay's API.
//   3. Pro access is derived from `pro_until`, not a boolean. A boolean with
//      no expiry cannot represent a lapsed plan.
// ==========================================

const PRO_PLAN_AMOUNT_PAISE = 49900; // ₹499/month

/**
 * What the platform keeps from every referred subscription, in rupees.
 */
const PARTNER_PLATFORM_FLOOR_INR = 199;

/**
 * Whether the shortcuts that hand out Pro without a real payment may run.
 */
const allowTestBilling = () =>
  IS_DEV && process.env.ALLOW_TEST_BILLING === 'true';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

const razorpayAuth = () => {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  return {
    keyId,
    keySecret,
    header: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
    mode: keyId.startsWith('rzp_live_') ? 'production' : 'test',
  };
};

const razorpayFetch = async (path: string, init: any = {}) => {
  const auth = razorpayAuth();
  if (!auth) throw new Error('RAZORPAY_NOT_CONFIGURED');
  const res = await fetch(RAZORPAY_API + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth.header,
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[razorpay] ${path} failed (${res.status}):`, body);
    throw new Error(body?.error?.description || body?.message || 'Razorpay request failed');
  }
  return body;
};

/** Grants or revokes Pro by writing an expiry, and mirrors it to the fast flag. */
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

/**
 * Claims a provider payment id, so one payment can be credited exactly once.
 */
const claimPayment = async (opts: {
  providerPaymentId: string;
  userId: string;
  userEmail?: string;
  amountRupees: number;
  plan?: string;
}): Promise<boolean> => {
  const { providerPaymentId, userId, userEmail, amountRupees, plan = 'pro' } = opts;
  if (!providerPaymentId) return false;

  if (useSupabase) {
    const { error } = await supabase.from('payments').insert({
      id: `pay_${crypto.randomUUID()}`,
      user_id: userId,
      provider: 'razorpay',
      provider_payment_id: providerPaymentId,
      amount: amountRupees,
      currency: 'INR',
      plan,
      status: 'captured',
      paid_at: new Date().toISOString(),
    });
    if (!error) return true;
    // 23505 = unique_violation: already credited.
    if ((error as any)?.code === '23505') {
      console.warn('[claimPayment] replay refused for', providerPaymentId);
      return false;
    }
    console.error('[claimPayment] insert failed:', error);
    return false;
  }

  // Local mode: the same check across the file and every cached database.
  const seen = localAllPayments().some(
    (row: any) => (row?.providerPaymentId || row?.provider_payment_id) === providerPaymentId
  );
  if (seen) {
    console.warn('[claimPayment] replay refused for', providerPaymentId);
    return false;
  }
  try {
    const fileDb = loadDatabaseFromFile();
    fileDb.payments = fileDb.payments || [];
    fileDb.payments.unshift({
      id: `pay_${crypto.randomUUID()}`,
      userId,
      userEmail: userEmail || null,
      provider: 'razorpay',
      providerPaymentId,
      amount: amountRupees,
      currency: 'INR',
      plan,
      status: 'captured',
      paidAt: new Date().toISOString(),
    });
    fs.writeFileSync(DB_FILE, JSON.stringify(fileDb, null, 2), 'utf-8');
  } catch (err) {
    console.error('[claimPayment] local write failed:', err);
  }
  return true;
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

  // Local mode: in-memory cache and db.json
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
    provider: 'razorpay',
    keyId: auth?.keyId || 'rzp_test_sandbox_mode',
    mode: auth?.mode || 'test',
    testBilling: allowTestBilling(),
    sandboxMode: !configured && allowTestBilling(),
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
      provider: 'razorpay',
      mode: 'sandbox',
      keyId: 'rzp_test_sandbox',
      orderId: `order_test_${currentUser.id.slice(-6)}_${crypto.randomUUID()}`,
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
        receipt: `rcpt_${currentUser.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}_${Date.now().toString(36)}`,
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
      provider: 'razorpay',
      keyId: auth.keyId,
      orderId: order.id,
      amount: order.amount,
      amountRupees: appliedOfferPrice,
      originalPrice: 499,
      mentorCommission,
      discountApplied: !!partner && appliedOfferPrice < 499,
      couponCode: partner?.code || null,
      currency: order.currency || 'INR',
    });
  } catch (err: any) {
    console.error('[payments/order]', err?.message || err);
    if (allowTestBilling()) {
      console.log('[payments/order] Razorpay live API unavailable; falling back to simulated test billing.');
      return res.json({
        sandboxMode: true,
        provider: 'razorpay',
        mode: 'sandbox',
        keyId: 'rzp_test_sandbox',
        orderId: `order_test_${currentUser.id.slice(-6)}_${crypto.randomUUID()}`,
        amount: orderAmountPaise,
        amountRupees: appliedOfferPrice,
        originalPrice: 499,
        mentorCommission,
        discountApplied: !!partner && appliedOfferPrice < 499,
        couponCode: partner?.code || null,
        currency: 'INR',
        message: 'Razorpay test billing: simulated Pro upgrade.',
      });
    }
    res.status(502).json({ error: err?.message || 'Could not initiate Razorpay order. Please try again.' });
  }
});

/**
 * Razorpay Standard Web Checkout: Create Order
 * Endpoint: POST /api/create-order
 * Request: { amount (paise), currency, receipt }
 * Return: { order_id, amount, currency, key_id }
 * Minimum amount: 100 paise
 */
app.post('/api/create-order', async (req, res) => {
  const auth = razorpayAuth();
  if (!auth) {
    return res.status(401).json({ error: 'Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.' });
  }

  const rawAmount = req.body?.amount !== undefined ? Number(req.body.amount) : PRO_PLAN_AMOUNT_PAISE;
  const currency = String(req.body?.currency || 'INR').toUpperCase();
  const receipt = String(req.body?.receipt || `rcpt_${Date.now().toString(36)}`);

  // Validate amount >= 100 paise
  if (isNaN(rawAmount) || rawAmount < 100) {
    return res.status(400).json({ error: 'Invalid amount. Minimum amount is 100 paise.' });
  }

  const amount = Math.round(rawAmount);

  try {
    const razorpay = new Razorpay({
      key_id: auth.keyId,
      key_secret: auth.keySecret,
    });

    const currentUser = (req as any).currentUser;
    const order = await razorpay.orders.create({
      amount,
      currency,
      receipt,
      notes: {
        userId: currentUser?.id || '',
        email: currentUser?.email || '',
        plan: 'pro',
      },
    });

    return res.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: auth.keyId,
    });
  } catch (err: any) {
    console.error('[create-order] Razorpay API error:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Failed to create Razorpay order' });
  }
});

/**
 * Razorpay Standard Web Checkout: Verify Payment Signature
 * Endpoint: POST /api/verify-payment
 * Algorithm: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
 * Compare generated signature with razorpay_signature
 * Return success only if signatures match
 */
app.post('/api/verify-payment', async (req, res) => {
  const auth = razorpayAuth();
  if (!auth) {
    return res.status(401).json({ error: 'Razorpay credentials not configured.' });
  }

  const razorpay_order_id = String(req.body?.razorpay_order_id || req.body?.order_id || req.body?.orderId || '').trim();
  const razorpay_payment_id = String(req.body?.razorpay_payment_id || req.body?.payment_id || req.body?.paymentId || '').trim();
  const razorpay_signature = String(req.body?.razorpay_signature || req.body?.signature || '').trim();

  // Missing fields: return 400
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing required payment verification fields (order_id, payment_id, signature).' });
  }

  // Algorithm: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
  const textToSign = `${razorpay_order_id}|${razorpay_payment_id}`;
  const generatedSignature = crypto
    .createHmac('sha256', auth.keySecret)
    .update(textToSign)
    .digest('hex');

  // Compare generated signature with razorpay_signature
  if (!safeTokenEqual(generatedSignature, razorpay_signature)) {
    console.warn(`[verify-payment] Signature mismatch. expected=${generatedSignature} got=${razorpay_signature}`);
    return res.status(400).json({ success: false, error: 'Payment signature verification failed. Invalid signature.' });
  }

  // If user is authenticated, grant 30-day Pro access
  const currentUser = (req as any).currentUser;
  if (currentUser) {
    try {
      await grantProForPayment({
        userId: currentUser.id,
        providerPaymentId: razorpay_payment_id,
        amountRupees: 499,
        userEmail: currentUser.email,
        periodDays: 30,
      });
    } catch (e) {
      console.warn('[verify-payment] grantPro error:', e);
    }
  }

  return res.json({
    success: true,
    message: 'Payment verified successfully.',
    order_id: razorpay_order_id,
    payment_id: razorpay_payment_id,
  });
});

/**
 * Recurring billing route placeholder.
 * Pro is sold as a 30-day pass: use /api/payments/order.
 */
app.post('/api/payments/subscribe', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });

  console.warn('[payments/subscribe] called, but Pro is sold as a 30-day order — use /api/payments/order.');
  return res.status(503).json({
    error: 'Monthly auto-billing is not available yet. Pro is sold as a 30-day pass.',
    code: 'SUBSCRIPTIONS_NOT_ENABLED',
  });
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
 * Extends Pro for one captured payment, exactly once.
 */
const grantProForPayment = async (opts: {
  userId: string;
  providerPaymentId: string;
  amountRupees: number;
  userEmail?: string;
  periodDays?: number;
}): Promise<{ granted: boolean; proUntil: Date | null }> => {
  const { userId, providerPaymentId, amountRupees, userEmail, periodDays = 30 } = opts;

  const claimed = await claimPayment({
    providerPaymentId,
    userId,
    userEmail,
    amountRupees,
  });
  if (!claimed) return { granted: false, proUntil: null };

  const existingUntil = await readProUntil(userId);
  const base = existingUntil && existingUntil > Date.now() ? existingUntil : Date.now();
  const proUntil = new Date(base + periodDays * 86400000);
  await applyProState(userId, proUntil);
  return { granted: true, proUntil };
};

/**
 * Razorpay webhook.
 */
app.post('/api/payments/webhook', async (req: any, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!secret) {
    console.error('[webhook] RAZORPAY_WEBHOOK_SECRET / RAZORPAY_KEY_SECRET is not set — rejecting.');
    return res.status(503).end();
  }

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

  res.status(200).json({ received: true });

  try {
    const type = String(event.event || '');
    const payment = event.payload?.payment?.entity;
    const order = event.payload?.order?.entity;
    const sub = event.payload?.subscription?.entity;

    if (type === 'payment.captured' || type === 'order.paid') {
      const payUserId = payment?.notes?.userId || order?.notes?.userId;
      const payId = payment?.id || order?.id;
      if (!payUserId || !payId) {
        console.warn('[webhook] payment with no userId in notes:', payId);
        return;
      }

      const amountRupees = Number((payment?.amount || order?.amount || PRO_PLAN_AMOUNT_PAISE) / 100);
      const periodDays = Number(order?.notes?.periodDays || payment?.notes?.periodDays || 30);

      const { granted, proUntil } = await grantProForPayment({
        userId: payUserId,
        providerPaymentId: String(payId),
        amountRupees,
        userEmail: payment?.email || payment?.notes?.email,
        periodDays,
      });

      if (!granted) {
        console.log('[webhook] payment already credited, skipping:', payId);
        return;
      }
      console.log(`[webhook] ${type} — Pro until ${proUntil?.toISOString()} for ${payUserId}`);

      if (useSupabase && proUntil) {
        await supabase.from('subscriptions').update({
          status: 'active',
          current_period_end: proUntil.toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('user_id', payUserId).in('status', ['created', 'authenticated', 'active', 'pending', 'halted']);
      }
      return;
    }

    const providerSubId = sub?.id || payment?.subscription_id;
    if (providerSubId && useSupabase) {
      const { data: row } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('provider_subscription_id', providerSubId)
        .maybeSingle();
      if (!row) return;

      const periodEnd = sub?.current_end ? new Date(sub.current_end * 1000) : null;
      if (type === 'subscription.activated' || type === 'subscription.charged') {
        const until = periodEnd || new Date(Date.now() + 31 * 86400000);
        await supabase.from('subscriptions').update({
          status: 'active',
          current_period_end: until.toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        await applyProState(row.user_id, until);

        if (payment?.id) {
          await claimPayment({
            providerPaymentId: String(payment.id),
            userId: row.user_id,
            userEmail: payment?.email,
            amountRupees: (payment.amount || PRO_PLAN_AMOUNT_PAISE) / 100,
          });
        }
      }
    }
  } catch (err: any) {
    console.error('[webhook] handler error:', err?.message || err);
  }
});

/**
 * Called by the browser after checkout closes.
 */
app.post('/api/payments/verify', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser) return res.status(401).json({ error: 'Not authenticated' });

  if (req.body?.isSandbox) {
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

  const razorpay_order_id = String(req.body?.razorpay_order_id || req.body?.orderId || req.body?.order_id || '').trim();
  const razorpay_payment_id = String(req.body?.razorpay_payment_id || req.body?.paymentId || req.body?.payment_id || '').trim();
  const razorpay_signature = String(req.body?.razorpay_signature || req.body?.signature || '').trim();
  const razorpay_subscription_id = String(req.body?.razorpay_subscription_id || req.body?.subscriptionId || '').trim();

  const auth = razorpayAuth();
  if (!auth) return res.status(503).json({ error: 'Payments are not configured yet.' });
  if (!razorpay_payment_id || !razorpay_signature || (!razorpay_order_id && !razorpay_subscription_id)) {
    return res.status(400).json({ error: 'Incomplete payment confirmation.' });
  }

  const textToSign = razorpay_order_id
    ? `${razorpay_order_id}|${razorpay_payment_id}`
    : `${razorpay_payment_id}|${razorpay_subscription_id}`;
  const expected = crypto
    .createHmac('sha256', auth.keySecret)
    .update(textToSign)
    .digest('hex');

  if (!safeTokenEqual(expected, razorpay_signature)) {
    console.warn(`[payments/verify] signature mismatch for user ${currentUser.id}`);
    return res.status(400).json({ error: 'Payment verification failed.' });
  }

  let periodDays = 30;
  let amountRupees = PRO_PLAN_AMOUNT_PAISE / 100;

  // If order_id is present, look up the order from Razorpay to verify user ownership and exact amount
  if (razorpay_order_id) {
    try {
      const order = await razorpayFetch(`/orders/${encodeURIComponent(razorpay_order_id)}`);
      if (order?.notes?.userId && order.notes.userId !== currentUser.id) {
        console.warn(`[payments/verify] order ${razorpay_order_id} belongs to ${order.notes.userId}, not ${currentUser.id}`);
        return res.status(400).json({ error: 'Payment verification failed.' });
      }
      if (order?.amount) {
        amountRupees = order.amount / 100;
      }
      if (order?.notes?.periodDays) {
        periodDays = Number(order.notes.periodDays) || 30;
      }
    } catch (e) {
      console.warn('[payments/verify] order fetch warning (offline fallback allowed if signature valid):', e);
    }
  }

  const { granted, proUntil } = await grantProForPayment({
    userId: currentUser.id,
    providerPaymentId: razorpay_payment_id,
    amountRupees,
    userEmail: currentUser.email,
    periodDays,
  });

  if (!granted) {
    return res.json({
      success: true,
      active: !!currentUser.isPro,
      proUntil: currentUser.proUntil || null,
      alreadyApplied: true,
      message: 'This payment was already applied to your account.',
    });
  }

  const db = (req as any).userDb;
  if (db && Array.isArray(db.users)) {
    const u = db.users.find((x: any) => x.id === currentUser.id);
    if (u) {
      u.isPro = true;
      u.proUntil = proUntil!.toISOString();
      await saveDatabase(db);
    }
  }

  res.json({
    success: true,
    active: true,
    proUntil: proUntil!.toISOString(),
    message: `Payment verified successfully! Welcome to Pro (${periodDays} days access).`,
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
    // There is nothing to cancel at the provider: Pro is a 30-day order, so
    // not renewing IS the cancellation and no mandate exists to revoke. Rows
    // reaching here are from the retired Razorpay subscription path, whose
    // mandates were cancelled with that account. Marking the row keeps the
    // billing panel truthful, and access runs to the end of the paid period.
    await supabase.from('subscriptions').update({
      cancel_at_period_end: true,
      status: 'cancelled',
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
  const email = (currentUser.email || '').toLowerCase().trim();
  if (isSuperAdminEmail(email)) return 'SUPER_ADMIN';
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

// Empty: this held one fabricated "system.startup" entry attributed to
// admin@axyfx.com, an hour before whenever the process happened to boot. An
// audit trail whose first row is invented is worse than an empty one — it is
// the record used to answer who changed a role or blocked an account.
const inMemoryAuditLogs: any[] = [];

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

  // `!== false` read a column that has never been written as a yes, so every
  // user who had not touched the setting — which is every new signup — was
  // handed to their mentor. Consent is an opt-in: only an explicit true counts.
  // The `user_demo_` bypass went with the demo accounts themselves; any row
  // whose id started with that prefix was shared unconditionally.
  if (!useSupabase) {
    return localAllUsers()
      .filter((u: any) => ids.includes(u.id) && u.allowPartnerTradeView === true)
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
    .filter((r: any) => r.allow_partner_trade_view === true)
    .map((r: any) => r.id);
};

/** True when this caller may read this one user's trades / journal. */
const canSeeTrades = (visible: string[] | null, userId: string) =>
  visible === null || visible.includes(userId);

/**
 * The access map for every user in a scoped viewer's network, in one query.
 *
 * tradeVisibleUserIds above answers a yes/no per user, which is all the old
 * single switch could express. The overview now needs to know which sections
 * each student shares, and a per-user read would be one round trip per card.
 *
 * Returns null for an unscoped role (an admin sees everything), so callers
 * treat null the same way they already treat it for the id list.
 */
const mentorAccessByUser = async (
  role: string,
  adminUserId: string | null,
): Promise<Map<string, MentorAccess> | null> => {
  if (role !== 'PARTNER') return null;
  const scope = await scopeUserIds(role, adminUserId);
  const ids = scope || [];
  const out = new Map<string, MentorAccess>();
  if (ids.length === 0) return out;

  if (!useSupabase) {
    for (const u of localAllUsers()) {
      if (!ids.includes(u.id)) continue;
      out.set(u.id, normaliseMentorAccess(u.mentorAccess, u.allowPartnerTradeView === true));
    }
    return out;
  }
  const { data, error } = await supabase
    .from('users').select('id, mentor_access, allow_partner_trade_view').in('id', ids);
  if (error) {
    // Fail closed: a lookup we could not complete is not a yes.
    console.error('[mentorAccessByUser] lookup failed:', error.message);
    return out;
  }
  for (const r of data || []) {
    out.set((r as any).id, normaliseMentorAccess((r as any).mentor_access, (r as any).allow_partner_trade_view === true));
  }
  return out;
};

/** The map for one user, defaulting to full access for an unscoped viewer. */
const accessOf = (
  byUser: Map<string, MentorAccess> | null,
  userId: string,
): MentorAccess => byUser === null
  ? normaliseMentorAccess(null, true)
  : (byUser.get(userId) || normaliseMentorAccess(null, false));

/** Reads one user's consent flag from either storage path. */
/**
 * Per-section mentor permissions.
 *
 * allow_partner_trade_view was one switch for everything a mentor could see.
 * A student who wants help with their analysis had to hand over their journal
 * as well. These are the sections they can now decide separately.
 *
 * `accounts` is not a boolean: null means every account, [] means none, and a
 * list means only those ids. Anything else here is a boolean.
 */
type MentorAccess = {
  dashboard: boolean;
  analysis: boolean;
  accounts: string[] | null;
  calendar: boolean;
  liveCharts: boolean;
  journal: boolean;
  notebook: boolean;
};

/**
 * The spec's stated defaults: every section on except the notebook.
 *
 * NOT applied at registration, and deliberately so — this is a product
 * decision that is still open, not an oversight.
 *
 * The rest of the product promises the opposite. The Partner Portal tells a
 * partner their network's "trades, analysis and journal stay private until
 * each user turns on Allow Partner to View Trade Details", the settings copy
 * says "Off by default", and tests/partner.test.mjs asserts that a new
 * referral shares nothing ("a new referral does not share trades by
 * default"). Writing these defaults at signup makes all three false at once
 * and shares a new student's data with their mentor before they have looked
 * at the screen.
 *
 * To adopt the spec, set mentor_access to this on the registration records
 * and update that assertion and both pieces of copy together.
 */
const MENTOR_ACCESS_DEFAULTS = {
  dashboard: true,
  analysis: true,
  accounts: null as string[] | null,
  calendar: true,
  liveCharts: true,
  journal: true,
  notebook: false,
};

const MENTOR_ACCESS_BOOLEAN_SECTIONS = [
  'dashboard', 'analysis', 'calendar', 'liveCharts', 'journal', 'notebook',
] as const;

/**
 * Turns whatever is stored into a complete map, and is the single place that
 * decides what an unset value means.
 *
 * A row whose mentor_access is null has never seen this screen, so its
 * permissions come from the old boolean — otherwise running the migration
 * would silently change what every existing mentor can read. Notebook is the
 * exception: the spec has it off by default, and it was never covered by the
 * old switch, so it stays off until the student turns it on.
 */
const normaliseMentorAccess = (raw: any, legacyAllow?: boolean): MentorAccess => {
  // The legacy boolean is what an unset map means. Reading it as an implicit
  // "all on" instead made every section readable the moment someone signed up
  // through a referral link: a new row has mentor_access null and
  // allow_partner_trade_view false, so the student's own screen showed sharing
  // OFF while the mentor could open their dashboard, journal and calendar. It
  // also made the switch impossible to turn back off — clearing the boolean
  // left the map null, which resolved to all-on again.
  const legacy = legacyAllow === true;
  const base: MentorAccess = {
    dashboard: legacy,
    analysis: legacy,
    accounts: null,
    calendar: legacy,
    liveCharts: legacy,
    journal: legacy,
    notebook: false,
  };
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base };
  for (const key of MENTOR_ACCESS_BOOLEAN_SECTIONS) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  }
  if (typeof (raw as any).live_charts === 'boolean' && typeof raw.liveCharts !== 'boolean') {
    out.liveCharts = (raw as any).live_charts;
  }
  if (raw.accounts === null) out.accounts = null;
  else if (Array.isArray(raw.accounts)) {
    out.accounts = raw.accounts.filter((x: any) => typeof x === 'string');
  }
  return out;
};

/** True when the mentor may read this section at all. */
const mentorCanSee = (access: MentorAccess, section: keyof MentorAccess): boolean => {
  if (section === 'accounts') return access.accounts === null || access.accounts.length > 0;
  return access[section] === true;
};

/** Reads one user's map, applying the same fallback everywhere. */
const readMentorAccess = async (userId: string): Promise<MentorAccess> => {
  if (!useSupabase) {
    const row = localFindUser((u: any) => u.id === userId);
    return normaliseMentorAccess(row?.mentorAccess, row?.allowPartnerTradeView === true);
  }
  const { data } = await supabase
    .from('users').select('mentor_access, allow_partner_trade_view').eq('id', userId).maybeSingle();
  return normaliseMentorAccess(data?.mentor_access, data?.allow_partner_trade_view === true);
};

const readTradeConsent = async (userId: string): Promise<boolean> => {
  const access = await readMentorAccess(userId);
  if (access && (access.analysis || access.journal || access.dashboard || access.calendar || access.liveCharts)) {
    return true;
  }
  if (!useSupabase) {
    const u = localFindUser((user: any) => user.id === userId);
    return u?.allowPartnerTradeView === true;
  }
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
    // localAllUsers, not the file alone: req.userDb is synthetic and per-caller
    // in local mode, and a freshly registered user lives in their own in-memory
    // database until something flushes it, so a file-only read left brand-new
    // customers out of every assignment view.
    const ids = readAssignments().filter((a) => a.subAdminId === subAdminId).map((a) => a.userId);
    const assigned = localAllUsers().filter((u: any) => ids.includes(u.id)).map((u: any) => sanitizeUser(u));
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
    // Same union as the GET above. Looking only at the file answered
    // "Sub-admin not found." for an account that had just been promoted.
    const everyone = localAllUsers();
    const subAdmin = everyone.find((u: any) => u.id === subAdminId);
    if (!subAdmin) return res.status(404).json({ error: 'Sub-admin not found.' });
    if (subAdmin.role !== 'SUB_ADMIN') return res.status(400).json({ error: 'That account is not a sub-admin.' });
    const target = everyone.find((u: any) => u.email?.toLowerCase() === email);
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

  // Longest run of wins and of losses, in date order. Streaks are the one
  // figure here that depends on sequence, so the sort matters.
  const byDate = [...closed].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let runWins = 0;
  let runLosses = 0;
  for (const t of byDate) {
    const pnl = netProfit(t);
    if (pnl > 0) {
      runWins += 1;
      runLosses = 0;
      if (runWins > maxConsecutiveWins) maxConsecutiveWins = runWins;
    } else if (pnl < 0) {
      runLosses += 1;
      runWins = 0;
      if (runLosses > maxConsecutiveLosses) maxConsecutiveLosses = runLosses;
    }
    // A scratch trade breaks neither run: it is not a win or a loss.
  }

  // Split by side so each panel can be built from its own numbers rather than
  // the caller subtracting one set from another.
  const winTrades = closed.filter((t) => netProfit(t) > 0);
  const lossTrades = closed.filter((t) => netProfit(t) < 0);
  const sumLots = (rows: any[]) => rows.reduce((a, t) => a + (Number(t.lotSize) || 0), 0);
  const sumCommission = (rows: any[]) =>
    rows.reduce((a, t) => a + Math.abs(Number(t.commission) || 0) + Math.abs(Number(t.swap) || 0), 0);
  const activeDays = (rows: any[]) =>
    new Set(rows.map((t) => dayKey(t.date)).filter((d): d is string => !!d)).size;
  const curve = (rows: any[]) => {
    // Cumulative P&L by day, which is what the performance charts plot.
    const byDay = new Map<string, number>();
    for (const t of rows) {
      const key = dayKey(t.date);
      if (!key) continue;
      byDay.set(key, (byDay.get(key) || 0) + netProfit(t));
    }
    let running = 0;
    return [...byDay.keys()].sort().map((day) => {
      running += byDay.get(day) || 0;
      return { date: day, cumulative: Math.round(running * 100) / 100 };
    });
  };
  const sideSummary = (rows: any[]) => {
    const total = rows.reduce((a, t) => a + netProfit(t), 0);
    const days = activeDays(rows);
    const lots = sumLots(rows);
    return {
      totalPnl: Math.round(total * 100) / 100,
      trades: rows.length,
      activeDays: days,
      avgTrade: rows.length ? Math.round((total / rows.length) * 100) / 100 : 0,
      totalVolume: Math.round(lots * 100) / 100,
      avgDailyVolume: days ? Math.round((lots / days) * 100) / 100 : 0,
      totalCommissions: Math.round(sumCommission(rows) * 100) / 100,
      curve: curve(rows),
    };
  };

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
    // Everything the Win and Loss Performance panels need, per side.
    winPerformance: { ...sideSummary(winTrades), maxConsecutive: maxConsecutiveWins },
    lossPerformance: { ...sideSummary(lossTrades), maxConsecutive: maxConsecutiveLosses },
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
  let scopeRole = req.query.type === 'partner' ? 'PARTNER' : ctx.role;
  if (!SCOPED_ROLES.has(ctx.role) && req.query.subAdminId) {
    // A super admin inspecting someone else's console. Resolve that account's
    // own role so a partner's network is read from referrals and a sub-admin's
    // from assignments, rather than assuming one of the two.
    targetSubAdminId = String(req.query.subAdminId);
    scopeRole = (await lookupUserRole(targetSubAdminId)) || (req.query.type === 'partner' ? 'PARTNER' : 'SUB_ADMIN');
  } else if (!SCOPED_ROLES.has(ctx.role)) {
    scopeRole = req.query.type === 'partner' ? 'PARTNER' : 'SUB_ADMIN';
  }
  const scope = await scopeUserIds(scopeRole, targetSubAdminId);
  const ids = scope || [];

  // Which of those users let their partner read trading data. Null means the
  // viewer is not a partner (staff console), so nothing is withheld.
  const visible = await tradeVisibleUserIds(scopeRole, targetSubAdminId);
  // Per-section permissions for the same set, read once rather than per card.
  const accessByUser = await mentorAccessByUser(scopeRole, targetSubAdminId);
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
    const access = accessOf(accessByUser, u.id);
    // Hidden accounts drop out before anything is counted, so a student who
    // shares one of three accounts does not have the other two reflected in
    // their totals.
    const shown = access.accounts === null
      ? own
      : own.filter((t) => t.accountId && access.accounts!.includes(t.accountId));
    // Every number on this card is a dashboard figure, so that is the section
    // that governs them. tradeAccess stays for the existing console, and is
    // true when anything at all is shared.
    const tradesVisible = canSeeTrades(visible, u.id) && access.dashboard;
    // Only the section switches decide this. `accounts` is a scope — null means
    // "whichever accounts the shared sections cover", which is also its value
    // on a row that shares nothing — so folding it in here reported every new
    // referral as sharing.
    const sharesAnything = MENTOR_ACCESS_BOOLEAN_SECTIONS.some((k) => access[k] === true);
    return {
      id: u.id,
      name: u.name || (u.email || '').split('@')[0],
      email: u.email,
      isPro: !!(u.isPro ?? u.is_pro),
      status: u.status || 'ACTIVE',
      joinedAt: u.createdAt || u.created_at || null,
      lastLogin: u.lastLogin || u.last_login || null,
      tradeAccess: sharesAnything,
      access,
      tradesToday: tradesVisible ? shown.filter((t) => dayKey(t.date) === todayKey).length : null,
      tradesTotal: tradesVisible ? shown.length : null,
      netPnl: tradesVisible ? shown.reduce((sum, t) => sum + netProfit(t), 0) : null,
      activity: tradesVisible ? buildActivitySeries(shown.map((t) => t.date), 30) : [],
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
  //
  // Sharing is per section now, so a blanket 403 is only right when the
  // student has turned everything off. Otherwise each section is filtered out
  // of the response below, which is what makes the toggles real rather than a
  // frontend that hides tabs while the data is still one fetch away.
  const access = ctx.role === 'PARTNER'
    ? await readMentorAccess(id)
    : normaliseMentorAccess(null, true);

  // Section switches only — `accounts` is a scope and its "all" value is null,
  // which is also what a row that shares nothing carries, so it can never be
  // the thing that opens this door.
  const sharesAnything = ctx.role !== 'PARTNER' || MENTOR_ACCESS_BOOLEAN_SECTIONS
    .some((k) => access[k] === true);

  if (!sharesAnything) {
    return res.status(403).json({
      error: 'This user has not shared their trading data with you.',
      code: 'TRADE_ACCESS_DENIED',
      tradeAccess: false,
      access,
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

  // Accounts the student chose to hide take their trades with them: leaving
  // the trades in while dropping the account row would hand over the same
  // history under a different key.
  const permittedAccounts = access.accounts === null
    ? accounts
    : accounts.filter((a: any) => access.accounts!.includes(a.id));
  const permittedIds = new Set(permittedAccounts.map((a: any) => a.id));
  const permittedTrades = access.accounts === null
    ? trades
    : trades.filter((t: any) => permittedIds.has(t.accountId));

  res.json({
    readOnly: true,
    user: sanitizeUser(user),
    // What the viewer is allowed to see, so the console can render the same
    // shape without guessing why a section came back empty.
    access,
    accounts: permittedAccounts,
    // Trades underpin the dashboard, the calendar and the chart markers, so
    // they travel when any of those is shared.
    trades: (access.dashboard || access.calendar || access.liveCharts) ? permittedTrades : [],
    analysis: access.analysis ? summariseTrades(permittedTrades) : null,
    activity: access.dashboard ? buildActivitySeries(permittedTrades.map((t) => t.date), 365) : [],
    calendar: access.calendar ? permittedTrades.map((t) => ({ date: t.date, profit: netProfit(t) })) : [],
    // Built from the permitted trades, not all of them — a journal entry
    // carries the same symbol, direction and profit as its trade, so deriving
    // it before the account filter would hand back a hidden account's history
    // in a different shape.
    journal: access.journal
      ? permittedTrades
          .filter((t: any) => (t.notes && String(t.notes).trim()) || t.emotion || t.strategy)
          .map((t: any) => ({
            id: t.id, date: t.date, symbol: t.symbol, type: t.type,
            profit: netProfit(t), notes: t.notes || '', emotion: t.emotion || null,
            strategy: t.strategy || null, tags: t.tags || [],
          }))
      : [],
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

/**
 * The same union for accounts and trades.
 *
 * The user registry already read users through localAllUsers, but counted a
 * user's accounts and trades out of the file alone. In local mode a fresh
 * signup's rows live only in userDatabases until something flushes them, so
 * every row in the ACCOUNTS & TRADES column read 0 — for a user the mentor
 * banner on the very next screen described as having one account and six
 * trades.
 */
const localAllRows = (key: 'accounts' | 'trades'): any[] => {
  const byId = new Map<string, any>();
  try {
    for (const r of loadDatabaseFromFile()?.[key] || []) if (r?.id) byId.set(r.id, r);
  } catch { /* caches below are still worth reading */ }
  for (const cached of userDatabases.values()) {
    for (const r of cached?.[key] || []) if (r?.id && !byId.has(r.id)) byId.set(r.id, r);
  }
  return [...byId.values()];
};
const localAllAccounts = (): any[] => localAllRows('accounts');
const localAllTrades = (): any[] => localAllRows('trades');

/**
 * Referral earnings per referrer, from captured payments.
 *
 * Every screen that showed this used `referralCount * 300` — a flat ₹300 for
 * each signup, paid or not — which meant the user registry and the partner
 * roster reported different earnings for the same partner. Earnings are what
 * the Partner Portal states: (amount - PARTNER_PLATFORM_FLOOR_INR) per
 * captured payment, never below zero.
 *
 * `referredBy` holds either the referrer's id or their referral code
 * depending on how the signup arrived, so the map is keyed by whatever it
 * holds and callers look up both.
 */
const referralEarningsByReferrer = (
  users: { id: string; referredBy?: string | null }[],
  payments: any[],
): Record<string, number> => {
  const referrerOf: Record<string, string> = {};
  for (const u of users || []) {
    if (u?.referredBy && u.id) referrerOf[u.id] = u.referredBy;
  }
  const earned: Record<string, number> = {};
  for (const pay of payments || []) {
    if (String(pay?.status || '').toLowerCase() !== 'captured') continue;
    const key = referrerOf[pay.userId || pay.user_id];
    if (!key) continue;
    earned[key] = (earned[key] || 0) + Math.max(0, (Number(pay.amount) || 0) - PARTNER_PLATFORM_FLOOR_INR);
  }
  return earned;
};

/** Every local copy of one user row: the file's, and each cached database's. */
const localUserRows = (userId: string): { rows: any[]; fileDb: any | null } => {
  // Deduplicated by identity, not by position. One database object is cached
  // under both the user's id and their email — registration does
  // `userDatabases.set(email, db); userDatabases.set(uid, db)` — so the same
  // row object comes back twice from this map. Every caller so far assigned
  // fields, which is the same answer whether it runs once or twice; the first
  // patch that appended to a list wrote its entry two or three times.
  const seen = new Set<any>();
  const rows: any[] = [];
  const add = (row: any) => {
    if (!row || seen.has(row)) return;
    seen.add(row);
    rows.push(row);
  };

  let fileDb: any = null;
  try {
    fileDb = loadDatabaseFromFile();
    const fileRow = (fileDb?.users || []).find((u: any) => u.id === userId);
    if (fileRow) add(fileRow);
    else fileDb = null;
  } catch { fileDb = null; }
  for (const cached of userDatabases.values()) {
    add((cached?.users || []).find((u: any) => u.id === userId));
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

type PartnerPayoutDetails = {
  type: 'UPI' | 'BANK';
  upiId?: string;
  accountHolderName?: string;
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
};

type PartnerPayoutRequest = {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerEmail: string;
  partnerCode: string;
  amount: number;
  method: 'UPI' | 'BANK';
  payoutDetails: PartnerPayoutDetails;
  status: 'PENDING' | 'PAID' | 'REJECTED';
  utrNumber?: string;
  adminNotes?: string;
  requestedAt: string;
  processedAt?: string;
  processedBy?: string;
};

type PartnerProfile = {
  userId: string;
  referralCode: string;
  offerPrice?: number; // 199 to 499 (default 499)
  links?: ReferralLink[];
  payoutDetails?: PartnerPayoutDetails;
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

const readPayoutRequests = (): PartnerPayoutRequest[] => {
  try {
    return loadDatabaseFromFile().partnerPayoutRequests || [];
  } catch {
    return [];
  }
};

const writePayoutRequests = (rows: PartnerPayoutRequest[]) => {
  const shared = loadDatabaseFromFile();
  shared.partnerPayoutRequests = rows;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(shared, null, 2), 'utf-8');
  } catch (err) {
    console.error('[writePayoutRequests] Failed to write to DB_FILE:', err);
  }
};

async function getPartnerData(userId: string): Promise<{
  referralCode: string;
  offerPrice: number;
  links: ReferralLink[];
  payoutDetails: any;
  createdBy: string | null;
  createdAt: string;
}> {
  let referralCode = '';
  let offerPrice = 499;
  let links: ReferralLink[] = [];
  let payoutDetails: any = null;
  let createdBy: string | null = null;
  let createdAt = new Date().toISOString();

  if (!useSupabase) {
    const prof = readPartnerProfiles().find((p) => p.userId === userId);
    if (prof) {
      referralCode = prof.referralCode || '';
      offerPrice = typeof prof.offerPrice === 'number' ? prof.offerPrice : 499;
      links = Array.isArray(prof.links) ? prof.links : [];
      payoutDetails = prof.payoutDetails || null;
      createdBy = prof.createdBy || null;
      createdAt = prof.createdAt || createdAt;
    }
  } else {
    try {
      const [{ data: profData }, { data: userData }] = await Promise.all([
        supabase.from('partner_profiles').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('users').select('preferences').eq('id', userId).maybeSingle(),
      ]);

      const userPrefs = userData?.preferences || {};
      referralCode = profData?.referral_code || '';
      createdBy = profData?.created_by || null;
      createdAt = profData?.created_at || createdAt;

      if (typeof profData?.offer_price === 'number') {
        offerPrice = profData.offer_price;
      } else if (typeof prefsValue(userPrefs, 'partnerOfferPrice') === 'number') {
        offerPrice = prefsValue(userPrefs, 'partnerOfferPrice');
      }

      if (Array.isArray(profData?.links)) {
        links = profData.links;
      } else if (Array.isArray(prefsValue(userPrefs, 'partnerLinks'))) {
        links = prefsValue(userPrefs, 'partnerLinks');
      }

      payoutDetails = profData?.payout_details || prefsValue(userPrefs, 'payoutDetails') || null;
    } catch (err) {
      console.warn('[getPartnerData] Error loading partner data:', err);
    }
  }

  return { referralCode, offerPrice, links, payoutDetails, createdBy, createdAt };
}

async function savePartnerLinks(userId: string, links: ReferralLink[]) {
  if (!useSupabase) {
    const rows = readPartnerProfiles();
    const p = rows.find((x) => x.userId === userId);
    if (p) {
      p.links = links;
      writePartnerProfiles(rows);
    }
    return;
  }

  // 1. Always persist to users.preferences (guaranteed to succeed and persist in Supabase)
  try {
    const { data: u } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
    const nextPrefs = setPrefsValue({ ...(u?.preferences || {}) }, 'partnerLinks', links);
    await supabase.from('users').update({ preferences: nextPrefs }).eq('id', userId);
  } catch (err) {
    console.warn('[savePartnerLinks] Error updating users.preferences:', err);
  }

  // 2. Also attempt updating partner_profiles in case the column exists or was added
  try {
    await supabase.from('partner_profiles').update({ links }).eq('user_id', userId);
  } catch {}
}

async function savePartnerOfferPrice(userId: string, price: number) {
  if (!useSupabase) {
    const rows = readPartnerProfiles();
    const p = rows.find((x) => x.userId === userId);
    if (p) {
      p.offerPrice = price;
      writePartnerProfiles(rows);
    }
    return;
  }

  // 1. Always persist to users.preferences
  try {
    const { data: u } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
    const nextPrefs = { ...(u?.preferences || {}), partnerOfferPrice: price };
    await supabase.from('users').update({ preferences: nextPrefs }).eq('id', userId);
  } catch (err) {
    console.warn('[savePartnerOfferPrice] Error updating users.preferences:', err);
  }

  // 2. Also attempt updating partner_profiles
  try {
    await supabase.from('partner_profiles').update({ offer_price: price }).eq('user_id', userId);
  } catch {}
}

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

  // 1. Check primary referral code in partner_profiles (safe column select)
  try {
    const { data: primaryMatch } = await supabase
      .from('partner_profiles')
      .select('user_id, referral_code')
      .ilike('referral_code', code)
      .maybeSingle();

    if (primaryMatch) {
      const pData = await getPartnerData(primaryMatch.user_id);
      return {
        userId: primaryMatch.user_id,
        code: primaryMatch.referral_code,
        offerPrice: pData.offerPrice || 499,
        isActive: true,
      };
    }
  } catch (err) {
    console.warn('[findPartnerByCode] Error searching primary partner code:', err);
  }

  // 2. Check custom links stored in users.preferences
  try {
    const { data: partnerUsers } = await supabase
      .from('users')
      .select('id, preferences')
      .eq('role', 'PARTNER');

    for (const u of partnerUsers || []) {
      const links = (prefsValue(u.preferences, 'partnerLinks') || []) as ReferralLink[];
      const link = links.find((l) => l.code && l.code.toLowerCase() === lower);
      if (link) {
        return {
          userId: u.id,
          code: link.code,
          offerPrice: link.offerPrice || prefsValue(u.preferences, 'partnerOfferPrice') || 499,
          isActive: link.isActive !== false,
          linkId: link.id,
          label: link.label,
        };
      }
    }
  } catch (err) {
    console.warn('[findPartnerByCode] Error searching custom links in users:', err);
  }

  // 3. Fallback: check custom links in partner_profiles if column exists
  try {
    const { data: allP } = await supabase.from('partner_profiles').select('user_id, referral_code, links');
    for (const p of allP || []) {
      const links = (p.links || []) as ReferralLink[];
      const link = links.find((l) => l.code && l.code.toLowerCase() === lower);
      if (link) {
        return {
          userId: p.user_id,
          code: link.code,
          offerPrice: link.offerPrice || 499,
          isActive: link.isActive !== false,
          linkId: link.id,
          label: link.label,
        };
      }
    }
  } catch {}

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
    try {
      await supabase.from('sub_admin_assignments').upsert(
        {
          id: `saa_${crypto.randomUUID()}`,
          sub_admin_id: partner.userId,
          user_id: userId,
          assigned_by: null,
          created_at: now,
        },
        { onConflict: 'sub_admin_id, user_id' }
      );
    } catch (insertErr) {
      console.warn('[linkReferral] sub_admin_assignments upsert error:', insertErr);
    }
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
  links?: ReferralLink[],
  payoutDetails?: PartnerPayoutDetails
) {
  if (!useSupabase) {
    const rows = readPartnerProfiles();
    const existing = rows.find((p) => p.userId === userId);
    const existingLinks = links !== undefined ? links : (existing?.links || []);
    const existingOfferPrice = offerPrice !== undefined ? offerPrice : (existing?.offerPrice || 499);
    const existingPayoutDetails = payoutDetails !== undefined ? payoutDetails : (existing?.payoutDetails);
    const filtered = rows.filter((p) => p.userId !== userId);
    filtered.push({
      userId,
      referralCode: code,
      offerPrice: existingOfferPrice,
      links: existingLinks,
      payoutDetails: existingPayoutDetails,
      createdAt: existing?.createdAt || new Date().toISOString(),
      createdBy: existing?.createdBy || createdBy
    });
    writePartnerProfiles(filtered);
    return;
  }
  try {
    const { error: upsertErr } = await supabase.from('partner_profiles').upsert(
      {
        user_id: userId,
        referral_code: code,
        offer_price: offerPrice,
        links: links || [],
        payout_details: payoutDetails || {},
        created_by: createdBy || null
      },
      { onConflict: 'user_id' },
    );
    if (upsertErr) {
      await supabase.from('partner_profiles').upsert(
        {
          user_id: userId,
          referral_code: code,
          created_by: createdBy || null
        },
        { onConflict: 'user_id' },
      );
    }
  } catch (err) {
    console.warn('[savePartnerProfile] Supabase upsert error:', err);
  }

  // Also persist offerPrice, links, payoutDetails to users.preferences for persistent fallback
  try {
    const { data: u } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
    const curPrefs = u?.preferences || {};
    const nextPrefs: any = { ...curPrefs };
    if (offerPrice !== undefined) setPrefsValue(nextPrefs, 'partnerOfferPrice', offerPrice);
    if (links !== undefined) setPrefsValue(nextPrefs, 'partnerLinks', links);
    if (payoutDetails !== undefined) setPrefsValue(nextPrefs, 'payoutDetails', payoutDetails);
    await supabase.from('users').update({ preferences: nextPrefs }).eq('id', userId);
  } catch (err) {
    console.warn('[savePartnerProfile] Error syncing with users.preferences:', err);
  }
}

// ── Partner: own profile, referral link, offer price and custom links ─────
app.get('/api/partner/me', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.self');
  if (!ctx) return;
  const userId = ctx.user?.id || '';

  const { referralCode: code, offerPrice, links } = await getPartnerData(userId);
  let activeCode = code;

  if (!activeCode) {
    activeCode = generateReferralCode(ctx.user?.name || ctx.user?.email || '');
    for (let i = 0; i < 5 && !(await isCodeAvailable(activeCode, userId)); i++) {
      activeCode = generateReferralCode(ctx.user?.name || ctx.user?.email || '');
    }
    await savePartnerProfile(userId, activeCode, userId, 499, []);
  }

  const standardPrice = 499;
  const mentorEarns = Math.max(0, offerPrice - 199);
  const formattedLinks = (links || []).map((l) => ({
    ...l,
    offerPrice: l.offerPrice || offerPrice,
    referralUrl: partnerReferralUrl(req, l.code),
    mentorEarns: Math.max(0, (l.offerPrice || offerPrice) - 199),
    studentSaves: Math.max(0, standardPrice - (l.offerPrice || offerPrice)),
  }));

  res.json({
    partnerId: userId,
    name: ctx.user?.name || null,
    referralCode: activeCode,
    offerPrice,
    standardPrice,
    mentorEarns,
    referralUrl: partnerReferralUrl(req, activeCode),
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

  const { offerPrice, links, payoutDetails } = await getPartnerData(userId);
  await savePartnerProfile(userId, code, userId, offerPrice, links, payoutDetails);
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
  await savePartnerOfferPrice(userId, rounded);

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

  const { links, offerPrice: defaultOfferPrice } = await getPartnerData(userId);

  const enriched = (links || []).map((l) => ({
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

  const { links: existingLinks } = await getPartnerData(userId);
  const curLinks = [newLink, ...(existingLinks || [])];
  await savePartnerLinks(userId, curLinks);

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
  const { links: existingLinks } = await getPartnerData(userId);
  const curLinks = [...(existingLinks || [])];
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

  await savePartnerLinks(userId, curLinks);

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

  const { links: existingLinks } = await getPartnerData(userId);
  const curLinks = (existingLinks || []).filter((l) => l.id !== id && l.code !== id);
  await savePartnerLinks(userId, curLinks);

  res.json({ success: true, message: 'Referral link removed.' });
});

// ── User: control whether their partner may read their trading data ───────
// Acts only on the caller's own row. There is no way for a partner or an admin
// to flip this on someone's behalf — that would defeat the point of consent.
app.patch('/api/user/partner-visibility', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser?.id) return res.status(401).json({ error: 'Not signed in' });
  const allow = req.body?.allow === true;

  // The master switch has to move the per-section map as well, not just the
  // boolean. Writing the boolean alone left a stored map untouched, so a
  // student who had ever opened the per-section screen could not switch
  // sharing off again — the map still said yes and every read went through it.
  // Off writes an explicit all-off map; on clears the map back to null, which
  // the legacy boolean then resolves to the default sections.
  const sections = allow
    ? null
    : { dashboard: false, analysis: false, accounts: [] as string[], calendar: false, liveCharts: false, journal: false, notebook: false };

  if (!useSupabase) {
    const patched = localPatchUser(currentUser.id, (row) => {
      row.allowPartnerTradeView = allow;
      row.mentorAccess = sections;
    });
    if (!patched) return res.status(404).json({ error: 'User not found' });
  } else {
    const { error } = await supabase
      .from('users').update({ allow_partner_trade_view: allow, mentor_access: sections }).eq('id', currentUser.id);
    if (error) {
      console.error('[PATCH /api/user/partner-visibility] error:', error);
      return res.status(500).json({ error: 'Failed to update the setting.' });
    }
  }
  res.json({ allowPartnerTradeView: allow });
});

// ── User: per-section mentor permissions ──────────────────────────────────
// Acts only on the caller's own row, like partner-visibility above. A mentor
// or an admin cannot set these for someone else; that would defeat consent.
app.get('/api/user/mentor-access', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser?.id) return res.status(401).json({ error: 'Not signed in' });
  const access = await readMentorAccess(currentUser.id);

  // The student picks accounts by name, so send the list they are choosing
  // from rather than making the frontend guess which ids exist.
  let accounts: { id: string; name: string }[] = [];
  if (!useSupabase) {
    accounts = ((req as any).userDb?.accounts || [])
      .filter((a: any) => a.userId === currentUser.id)
      .map((a: any) => ({ id: a.id, name: a.name }));
  } else {
    const { data } = await supabase
      .from('trading_accounts').select('id, name').eq('user_id', currentUser.id);
    accounts = (data || []).map((a: any) => ({ id: a.id, name: a.name }));
  }

  res.json({ access, accounts });
});

app.patch('/api/user/mentor-access', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser?.id) return res.status(401).json({ error: 'Not signed in' });

  const current = await readMentorAccess(currentUser.id);
  const patch = req.body || {};

  // Merged rather than replaced, so a client that knows about six sections
  // cannot silently reset a seventh it has never heard of.
  const next: MentorAccess = { ...current };
  for (const key of MENTOR_ACCESS_BOOLEAN_SECTIONS) {
    if (typeof patch[key] === 'boolean') next[key] = patch[key];
  }
  if ('accounts' in patch) {
    if (patch.accounts === null) next.accounts = null;
    else if (Array.isArray(patch.accounts)) {
      // Only ids the caller actually owns. Without this the column would
      // accept any string, and a future reader could be pointed at another
      // user's account id.
      let owned: string[] = [];
      if (!useSupabase) {
        owned = ((req as any).userDb?.accounts || [])
          .filter((a: any) => a.userId === currentUser.id).map((a: any) => a.id);
      } else {
        const { data } = await supabase
          .from('trading_accounts').select('id').eq('user_id', currentUser.id);
        owned = (data || []).map((a: any) => a.id);
      }
      next.accounts = patch.accounts.filter((id: any) => typeof id === 'string' && owned.includes(id));
    } else {
      return res.status(400).json({ error: 'accounts must be null or a list of account ids.' });
    }
  }

  const allowTradeView = !!(next.dashboard || next.analysis || next.journal || next.calendar || next.liveCharts);
  if (!useSupabase) {
    const patched = localPatchUser(currentUser.id, (row) => {
      row.mentorAccess = next;
      row.allowPartnerTradeView = allowTradeView;
    });
    if (!patched) return res.status(404).json({ error: 'User not found' });
  } else {
    const { error } = await supabase
      .from('users').update({ mentor_access: next, allow_partner_trade_view: allowTradeView }).eq('id', currentUser.id);
    if (error) {
      console.error('[PATCH /api/user/mentor-access] error:', error);
      return res.status(500).json({ error: 'Failed to update your sharing settings.' });
    }
  }
  res.json({ access: next });
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
    const access = normaliseMentorAccess(row?.mentorAccess, row?.allowPartnerTradeView === true);
    allow = row?.allowPartnerTradeView === true || !!(access.dashboard || access.analysis || access.journal || access.calendar || access.liveCharts);
  } else {
    const { data } = await supabase
      .from('users').select('referred_by, allow_partner_trade_view, mentor_access').eq('id', currentUser.id).maybeSingle();
    referredBy = data?.referred_by || null;
    const access = normaliseMentorAccess(data?.mentor_access, data?.allow_partner_trade_view === true);
    allow = data?.allow_partner_trade_view === true || !!(access.dashboard || access.analysis || access.journal || access.calendar || access.liveCharts);
  }

  if (!referredBy) return res.json({ hasPartner: false, allowPartnerTradeView: allow });

  let partnerName = 'your partner';
  let partnerUsername = 'mentor';
  let partnerEmail: string | null = null;
  let referralCode: string | null = null;

  if (!useSupabase) {
    const p = localFindUser((u: any) => u.id === referredBy || u.referralCode === referredBy);
    partnerName = p?.name || (p?.email || '').split('@')[0] || partnerName;
    partnerEmail = p?.email || null;
    partnerUsername = p?.name || (p?.email || '').split('@')[0] || partnerName;
    referralCode = p?.referralCode || null;
  } else {
    // users has no referral_code column — partner_profiles owns the code, and
    // this select used to ask for one that does not exist, so Postgres failed
    // the whole query ("column users.referral_code does not exist") and this
    // route answered with nothing.
    let { data } = await supabase.from('users').select('id, name, email').eq('id', referredBy).maybeSingle();
    if (!data) {
      // referredBy may be a code rather than a user id. Resolve it where codes
      // actually live, then fetch that partner.
      const { data: byCode } = await supabase
        .from('partner_profiles').select('user_id').ilike('referral_code', referredBy).maybeSingle();
      if (byCode?.user_id) {
        const resUser = await supabase.from('users').select('id, name, email').eq('id', byCode.user_id).maybeSingle();
        data = resUser.data;
      }
    }
    const partnerUserId = data?.id || referredBy;
    const { data: profile } = await supabase.from('partner_profiles').select('referral_code').eq('user_id', partnerUserId).maybeSingle();
    partnerName = data?.name || String(data?.email || '').split('@')[0] || partnerName;
    partnerEmail = data?.email || null;
    partnerUsername = data?.name || String(data?.email || '').split('@')[0] || partnerName;
    referralCode = profile?.referral_code || data?.referral_code || (typeof referredBy === 'string' && referredBy.startsWith('FX') ? referredBy : null);
  }
  res.json({
    hasPartner: true,
    partnerName,
    partnerUsername,
    partnerEmail,
    referralCode,
    allowPartnerTradeView: allow
  });
});

app.post('/api/user/link-partner', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser?.id) return res.status(401).json({ error: 'Not signed in' });
  const rawCode = String(req.body?.code || '').trim().toUpperCase();
  if (!rawCode) return res.status(400).json({ error: 'Please enter a referral / mentor code.' });

  const partner = await findPartnerByCode(rawCode);
  if (!partner) {
    return res.status(404).json({ error: 'That mentor referral code does not exist. Please check the code and try again.' });
  }
  if (partner.isActive === false) {
    return res.status(400).json({ error: 'This referral code has been deactivated by the mentor.' });
  }
  if (partner.userId === currentUser.id) {
    return res.status(400).json({ error: 'You cannot link your own referral / mentor code to your account.' });
  }

  // Check if current user is already referred
  let existingReferredBy: string | null = null;
  if (!useSupabase) {
    const existing = localFindUser((u: any) => u.id === currentUser.id);
    existingReferredBy = existing?.referredBy || null;
  } else {
    const { data: existing } = await supabase
      .from('users').select('referred_by').eq('id', currentUser.id).maybeSingle();
    existingReferredBy = existing?.referred_by || null;
  }

  if (existingReferredBy) {
    if (existingReferredBy === partner.userId) {
      return res.status(400).json({ error: 'You are already linked to this mentor.' });
    }
    return res.status(400).json({ error: 'Your account is already linked to another mentor.' });
  }

  // Link the user to the partner
  const now = new Date().toISOString();
  if (!useSupabase) {
    localPatchUser(currentUser.id, (row) => {
      row.referredBy = partner.userId;
      row.referredAt = now;
      if (row.allowPartnerTradeView === undefined) row.allowPartnerTradeView = false;
    });
    const rows = readAssignments();
    if (!rows.some((a) => a.subAdminId === partner.userId && a.userId === currentUser.id)) {
      rows.push({ subAdminId: partner.userId, userId: currentUser.id, assignedBy: 'referral', createdAt: now });
      writeAssignments(rows);
    }
  } else {
    await supabase.from('users')
      .update({ referred_by: partner.userId, referred_at: now })
      .eq('id', currentUser.id);
    try {
      await supabase.from('sub_admin_assignments').upsert(
        {
          id: `saa_${crypto.randomUUID()}`,
          sub_admin_id: partner.userId,
          user_id: currentUser.id,
          assigned_by: null,
          created_at: now,
        },
        { onConflict: 'sub_admin_id, user_id' }
      );
    } catch (insertErr) {
      console.warn('[link-partner] sub_admin_assignments upsert error:', insertErr);
    }
  }

  let partnerName = 'your partner';
  let partnerUsername = 'mentor';
  let partnerEmail: string | null = null;
  let referralCode = partner?.code || rawCode;

  if (partner?.userId) {
    if (!useSupabase) {
      const p = localFindUser((u: any) => u.id === partner.userId);
      partnerName = p?.name || (p?.email || '').split('@')[0] || partnerName;
      partnerEmail = p?.email || null;
      partnerUsername = p?.name || (p?.email || '').split('@')[0] || partnerName;
    } else {
      // No referral_code on users; `partner` already carries the authoritative
      // code from findPartnerByCode, which reads partner_profiles.
      const { data } = await supabase.from('users').select('name, email').eq('id', partner.userId).maybeSingle();
      partnerName = data?.name || String(data?.email || '').split('@')[0] || partnerName;
      partnerEmail = data?.email || null;
      partnerUsername = data?.name || String(data?.email || '').split('@')[0] || partnerName;
    }
  }

  res.json({
    success: true,
    hasPartner: true,
    partnerName,
    partnerUsername,
    partnerEmail,
    referralCode,
    allowPartnerTradeView: false,
  });
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

// ── Partner: Withdrawal & Payout Management ──────────────────────────────

/**
 * A manual credit or correction an admin has applied to a partner's balance.
 *
 * Referral income is derived, not stored: it is the sum of every captured
 * payment from a referred user, less PARTNER_PLATFORM_FLOOR_INR. So there is
 * no column to write when a partner is owed something the payment history
 * cannot show — a bonus, a correction, or a referral settled outside the gateway.
 * Without this the only way to move the number was to insert a customer row
 * and a captured payment row that never happened, which also inflates platform
 * revenue and is indistinguishable from a real sale afterwards.
 *
 * Signed: a negative amount takes money back off a balance credited by
 * mistake. Every entry carries who did it and why, and is written to the audit
 * log as well.
 *
 * Stored on users.preferences, the JSONB column the payout requests already
 * use, so this needs no migration — partner_payout_requests is not in the
 * schema on the current project and the code already falls back to here.
 */
type PartnerAdjustment = {
  id: string;
  amount: number;
  reason: string;
  createdAt: string;
  createdBy: string | null;
  createdByEmail: string | null;
};

/** Ceiling on one entry, so a slipped decimal point cannot credit a fortune. */
const MAX_PARTNER_ADJUSTMENT_INR = 1_000_000;

const asAdjustmentList = (raw: any): PartnerAdjustment[] =>
  Array.isArray(raw) ? raw.filter((a) => a && Number.isFinite(Number(a.amount))) : [];

const sumAdjustments = (list: PartnerAdjustment[]): number =>
  list.reduce((sum, a) => sum + Number(a.amount), 0);

const readPartnerAdjustments = async (userId: string): Promise<PartnerAdjustment[]> => {
  if (!useSupabase) {
    const row = localFindUser((u: any) => u.id === userId);
    return asAdjustmentList(prefsValue(row?.preferences, 'partnerAdjustments'));
  }
  const { data } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
  return asAdjustmentList(prefsValue((data as any)?.preferences, 'partnerAdjustments'));
};

/** Every partner's adjustment total in one read, for the admin roster. */
const adjustmentTotalsByPartner = async (): Promise<Record<string, number>> => {
  const out: Record<string, number> = {};
  const rows = useSupabase
    ? ((await supabase.from('users').select('id, preferences')).data || [])
    : localAllUsers();
  for (const row of rows as any[]) {
    const list = asAdjustmentList(prefsValue(row?.preferences, 'partnerAdjustments'));
    if (list.length) out[row.id] = sumAdjustments(list);
  }
  return out;
};

async function getPartnerPayoutData(userId: string, partnerCode: string) {
  let totalEarned = 0;
  if (!useSupabase) {
    const all = localAllUsers();
    const referrerOf: Record<string, string> = {};
    for (const u of all) {
      if (u.referredBy) referrerOf[u.id] = u.referredBy;
    }
    for (const pay of localAllPayments()) {
      if (String(pay.status || '').toLowerCase() !== 'captured') continue;
      const key = referrerOf[pay.userId || pay.user_id];
      if (key === userId || (partnerCode && key === partnerCode)) {
        totalEarned += Math.max(0, (Number(pay.amount) || 0) - PARTNER_PLATFORM_FLOOR_INR);
      }
    }
  } else {
    try {
      const { data: users } = await supabase.from('users').select('id, referred_by');
      const { data: payments } = await supabase.from('payments').select('amount, status, user_id').eq('status', 'captured');
      const referrerOf: Record<string, string> = {};
      for (const u of users || []) {
        if (u.referred_by) referrerOf[u.id] = u.referred_by;
      }
      for (const pay of payments || []) {
        const key = referrerOf[pay.user_id];
        if (key === userId || (partnerCode && key === partnerCode)) {
          totalEarned += Math.max(0, (Number(pay.amount) || 0) - PARTNER_PLATFORM_FLOOR_INR);
        }
      }
    } catch (err) {
      console.warn('[getPartnerPayoutData] Supabase fetch error:', err);
    }
  }

  // Manual credits land in the same total the partner withdraws against, so
  // the portal shows one balance rather than two numbers that have to be added
  // up by hand.
  const adjustments = await readPartnerAdjustments(userId);
  const adjustmentTotal = sumAdjustments(adjustments);
  totalEarned += adjustmentTotal;

  let allRequests: PartnerPayoutRequest[] = [];
  if (useSupabase) {
    try {
      const { data, error } = await supabase
        .from('partner_payout_requests')
        .select('*')
        .eq('partner_id', userId)
        .order('requested_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        allRequests = data.map((r: any) => ({
          id: r.id,
          partnerId: r.partner_id,
          partnerName: r.partner_name || '',
          partnerEmail: r.partner_email || '',
          partnerCode: r.partner_code || partnerCode,
          amount: Number(r.amount) || 0,
          method: r.method,
          payoutDetails: r.payout_details || {},
          status: r.status,
          utrNumber: r.utr_number,
          adminNotes: r.admin_notes,
          requestedAt: r.requested_at,
          processedAt: r.processed_at,
          processedBy: r.processed_by,
        }));
      } else {
        const { data: u } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
        const stored = prefsValue(u?.preferences, 'payoutRequests');
        if (Array.isArray(stored)) {
          allRequests = stored;
        } else {
          allRequests = readPayoutRequests().filter((r) => r.partnerId === userId);
        }
      }
    } catch {
      allRequests = readPayoutRequests().filter((r) => r.partnerId === userId);
    }
  } else {
    allRequests = readPayoutRequests().filter((r) => r.partnerId === userId);
  }

  allRequests.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());

  const totalWithdrawn = allRequests
    .filter((r) => r.status === 'PAID')
    .reduce((sum, r) => sum + r.amount, 0);

  const totalPending = allRequests
    .filter((r) => r.status === 'PENDING')
    .reduce((sum, r) => sum + r.amount, 0);

  const availableBalance = Math.max(0, totalEarned - totalWithdrawn - totalPending);

  return {
    totalEarned,
    totalWithdrawn,
    totalPending,
    availableBalance,
    adjustmentTotal,
    adjustments,
    minPayoutThreshold: 500,
    requests: allRequests,
  };
}

// GET /api/partner/payout – partner's earnings, available balance, settings & request history
app.get('/api/partner/payout', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.self');
  if (!ctx) return;
  const userId = ctx.user?.id || '';

  let profile: PartnerProfile | null = null;
  let payoutDetails = null;

  if (!useSupabase) {
    profile = readPartnerProfiles().find((p) => p.userId === userId) || null;
    payoutDetails = profile?.payoutDetails || null;
  } else {
    const [{ data: profData }, { data: userData }] = await Promise.all([
      supabase.from('partner_profiles').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('users').select('preferences').eq('id', userId).maybeSingle(),
    ]);
    profile = profData ? (toCamel(profData) as any) : null;
    payoutDetails = profile?.payoutDetails || prefsValue(userData?.preferences, 'payoutDetails') || null;
  }

  const partnerCode = profile?.referralCode || '';
  const payoutData = await getPartnerPayoutData(userId, partnerCode);

  res.json({
    payoutDetails,
    earnings: {
      totalEarned: payoutData.totalEarned,
      totalWithdrawn: payoutData.totalWithdrawn,
      totalPending: payoutData.totalPending,
      availableBalance: payoutData.availableBalance,
      minPayoutThreshold: payoutData.minPayoutThreshold,
      // Sent so a partner can see why their balance is not simply their
      // referral count times the commission, rather than reading it as a bug.
      adjustmentTotal: payoutData.adjustmentTotal,
    },
    adjustments: payoutData.adjustments,
    requests: payoutData.requests,
  });
});

// PUT /api/partner/payout-settings – save or update partner's UPI or bank account
app.put('/api/partner/payout-settings', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.self');
  if (!ctx) return;
  const userId = ctx.user?.id || '';

  const type = req.body?.type === 'BANK' ? 'BANK' : 'UPI';
  const upiId = String(req.body?.upiId || '').trim();
  const accountHolderName = String(req.body?.accountHolderName || '').trim();
  const accountNumber = String(req.body?.accountNumber || '').trim();
  const ifsc = String(req.body?.ifsc || '').trim().toUpperCase();
  const bankName = String(req.body?.bankName || '').trim();

  if (type === 'UPI' && upiId && !/^[\w.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(upiId)) {
    return res.status(400).json({ error: 'Please enter a valid UPI ID (e.g. name@okhdfcbank, mobile@paytm).' });
  }

  if (type === 'BANK') {
    if (accountNumber && !/^\d{9,18}$/.test(accountNumber)) {
      return res.status(400).json({ error: 'Account number should be 9 to 18 digits.' });
    }
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      return res.status(400).json({ error: 'Please enter a valid 11-character IFSC code (e.g. HDFC0001234).' });
    }
  }

  const payoutDetails: PartnerPayoutDetails = {
    type,
    upiId,
    accountHolderName,
    accountNumber,
    ifsc,
    bankName,
  };

  const pData = await getPartnerData(userId);
  const code = pData.referralCode;
  const offerPrice = pData.offerPrice;
  const links = pData.links;

  await savePartnerProfile(userId, code, userId, offerPrice, links, payoutDetails);
  if (useSupabase) {
    try {
      const { data: u } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
      const nextPrefs = { ...(u?.preferences || {}), payoutDetails };
      await supabase.from('users').update({ preferences: nextPrefs }).eq('id', userId);
    } catch { }
  }
  res.json({ success: true, payoutDetails });
});

// POST /api/partner/payout-request – submit a new withdrawal request
app.post('/api/partner/payout-request', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.self');
  if (!ctx) return;
  const userId = ctx.user?.id || '';

  let profile: PartnerProfile | null = null;
  let payoutDetails = null;

  if (!useSupabase) {
    profile = readPartnerProfiles().find((p) => p.userId === userId) || null;
    payoutDetails = profile?.payoutDetails;
  } else {
    const [{ data: profData }, { data: userData }] = await Promise.all([
      supabase.from('partner_profiles').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('users').select('preferences').eq('id', userId).maybeSingle(),
    ]);
    profile = profData ? (toCamel(profData) as any) : null;
    payoutDetails = profile?.payoutDetails || prefsValue(userData?.preferences, 'payoutDetails') || null;
  }

  const method = req.body?.method === 'BANK' ? 'BANK' : 'UPI';

  // If partner passed upiId directly or needs WhatsApp fallback:
  if (method === 'UPI') {
    const passedUpi = typeof req.body?.upiId === 'string' ? req.body.upiId.trim() : '';
    const finalUpi = passedUpi || payoutDetails?.upiId || 'Direct on WhatsApp';
    payoutDetails = {
      ...(payoutDetails || {}),
      type: 'UPI',
      upiId: finalUpi,
    };
  }

  if (!payoutDetails) {
    return res.status(400).json({ error: 'Please enter your UPI ID (or Bank details) to proceed.' });
  }

  if (method === 'BANK' && (!payoutDetails.accountNumber || !payoutDetails.ifsc)) {
    return res.status(400).json({ error: 'Please enter your Bank Account Number and IFSC in Payout Settings first.' });
  }

  const rawAmount = Math.floor(Number(req.body?.amount));
  if (isNaN(rawAmount) || rawAmount <= 0) {
    return res.status(400).json({ error: 'Please enter a valid withdrawal amount.' });
  }

  const partnerCode = profile?.referralCode || '';
  const payoutData = await getPartnerPayoutData(userId, partnerCode);

  const effectiveMin = Math.min(500, payoutData.availableBalance);
  if (rawAmount < Math.min(100, effectiveMin)) {
    return res.status(400).json({ error: `Minimum withdrawal amount is ₹${Math.min(100, effectiveMin)}.` });
  }

  if (rawAmount > payoutData.availableBalance) {
    return res.status(400).json({ error: `Withdrawal amount (₹${rawAmount}) exceeds your available balance (₹${payoutData.availableBalance}).` });
  }

  const requestId = `pr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const partnerName = ctx.user?.name || ctx.user?.email?.split('@')[0] || 'Partner';
  const partnerEmail = ctx.user?.email || '';

  const newRequest: PartnerPayoutRequest = {
    id: requestId,
    partnerId: userId,
    partnerName,
    partnerEmail,
    partnerCode,
    amount: rawAmount,
    method,
    payoutDetails,
    status: 'PENDING',
    requestedAt: new Date().toISOString(),
  };

  const currentRequests = readPayoutRequests();
  currentRequests.unshift(newRequest);
  writePayoutRequests(currentRequests);

  if (useSupabase) {
    try {
      await supabase.from('partner_payout_requests').insert({
        id: requestId,
        partner_id: userId,
        amount: rawAmount,
        method,
        payout_details: payoutDetails,
        status: 'PENDING',
        requested_at: newRequest.requestedAt,
      });
    } catch (err) {
      console.warn('[partner-payout-request] Supabase fallback to preferences storage:', err);
    }
    try {
      const { data: u } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
      const storedReqs = prefsValue(u?.preferences, 'payoutRequests');
      const existingReqs = Array.isArray(storedReqs) ? storedReqs : [];
      existingReqs.unshift(newRequest);
      const nextPrefs = setPrefsValue({ ...(u?.preferences || {}) }, 'payoutRequests', existingReqs);
      await supabase.from('users').update({ preferences: nextPrefs }).eq('id', userId);
    } catch { }
  }

  await writeAuditLog(req, ctx, 'partner.payout_request', 'payout', requestId, {
    amount: rawAmount,
    method,
    partnerEmail,
  });

  res.json({
    success: true,
    message: `Withdrawal request for ₹${rawAmount} submitted successfully.`,
    request: newRequest,
  });
});

// ── Admin: List all partner payout requests ───────────────────────────────
app.get('/api/admin/payouts', async (req, res) => {
  const ctx = await requirePermission(req, res, 'billing.read');
  if (!ctx) return;

  let requests: PartnerPayoutRequest[] = [];
  if (!useSupabase) {
    requests = readPayoutRequests();
  } else {
    try {
      const { data, error } = await supabase
        .from('partner_payout_requests')
        .select('*')
        .order('requested_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        const { data: users } = await supabase.from('users').select('id, name, email');
        const { data: profs } = await supabase.from('partner_profiles').select('user_id, referral_code');
        const uMap = new Map<string, any>((users || []).map((u: any) => [u.id, u]));
        const pMap = new Map<string, any>((profs || []).map((p: any) => [p.user_id, p.referral_code]));
        requests = data.map((r: any) => {
          const u = uMap.get(r.partner_id);
          return {
            id: r.id,
            partnerId: r.partner_id,
            partnerName: u?.name || u?.email?.split('@')[0] || 'Partner',
            partnerEmail: u?.email || '',
            partnerCode: pMap.get(r.partner_id) || '',
            amount: Number(r.amount) || 0,
            method: r.method,
            payoutDetails: r.payout_details || {},
            status: r.status,
            utrNumber: r.utr_number,
            adminNotes: r.admin_notes,
            requestedAt: r.requested_at,
            processedAt: r.processed_at,
            processedBy: r.processed_by,
          };
        });
      } else {
        const { data: users } = await supabase.from('users').select('id, name, email, preferences');
        const { data: profs } = await supabase.from('partner_profiles').select('user_id, referral_code');
        const pMap = new Map<string, any>((profs || []).map((p: any) => [p.user_id, p.referral_code]));
        const prefReqs: any[] = [];
        for (const u of users || []) {
          const reqs = prefsValue(u?.preferences, 'payoutRequests');
          if (Array.isArray(reqs)) {
            for (const r of reqs) {
              prefReqs.push({
                ...r,
                partnerName: r.partnerName || u.name || 'Partner',
                partnerEmail: r.partnerEmail || u.email || '',
                partnerCode: r.partnerCode || pMap.get(u.id) || '',
              });
            }
          }
        }
        if (prefReqs.length > 0) {
          requests = prefReqs;
        } else {
          requests = readPayoutRequests();
        }
      }
    } catch {
      requests = readPayoutRequests();
    }
  }

  const totalPending = requests.filter((r) => r.status === 'PENDING').reduce((s, r) => s + r.amount, 0);
  const totalPaid = requests.filter((r) => r.status === 'PAID').reduce((s, r) => s + r.amount, 0);
  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;

  res.json({
    requests,
    summary: {
      totalPending,
      totalPaid,
      pendingCount,
      totalCount: requests.length,
    },
  });
});

// ── Admin: Process a partner payout request (PAID or REJECTED) ────────────
app.post('/api/admin/payouts/:id/process', async (req, res) => {
  const ctx = await requirePermission(req, res, 'billing.read');
  if (!ctx) return;

  const { id } = req.params;
  const action = req.body?.action;
  const utrNumber = String(req.body?.utrNumber || '').trim();
  const adminNotes = String(req.body?.adminNotes || '').trim();

  if (action !== 'PAID' && action !== 'REJECTED') {
    return res.status(400).json({ error: 'Action must be either PAID or REJECTED.' });
  }

  if (action === 'PAID' && !utrNumber) {
    return res.status(400).json({ error: 'Please enter a UTR or Transaction Reference number.' });
  }

  if (action === 'REJECTED' && !adminNotes) {
    return res.status(400).json({ error: 'Please provide a reason for rejecting this payout request.' });
  }

  const now = new Date().toISOString();
  const processedBy = ctx.user?.email || 'Admin';

  const all = readPayoutRequests();
  const target = all.find((r) => r.id === id);
  if (target) {
    target.status = action;
    target.utrNumber = utrNumber || undefined;
    target.adminNotes = adminNotes || undefined;
    target.processedAt = now;
    target.processedBy = processedBy;
    writePayoutRequests(all);
  }

  if (useSupabase) {
    try {
      await supabase
        .from('partner_payout_requests')
        .update({
          status: action,
          utr_number: utrNumber || null,
          admin_notes: adminNotes || null,
          processed_at: now,
          processed_by: processedBy,
        })
        .eq('id', id);
    } catch { }

    // Also update in users.preferences
    try {
      const { data: users } = await supabase.from('users').select('id, preferences');
      for (const u of users || []) {
        const reqs = prefsValue(u?.preferences, 'payoutRequests');
        if (Array.isArray(reqs)) {
          const matched = reqs.find((r: any) => r.id === id);
          if (matched) {
            matched.status = action;
            matched.utrNumber = utrNumber || undefined;
            matched.adminNotes = adminNotes || undefined;
            matched.processedAt = now;
            matched.processedBy = processedBy;
            await supabase.from('users').update({ preferences: u.preferences }).eq('id', u.id);
            break;
          }
        }
      }
    } catch { }
  }

  await writeAuditLog(req, ctx, `partner.payout_${action.toLowerCase()}`, 'payout', id, {
    action,
    utrNumber,
    adminNotes,
    amount: target?.amount,
  });

  res.json({
    success: true,
    message: action === 'PAID' ? `Payout marked as PAID (UTR: ${utrNumber})` : 'Payout request rejected.',
    request: target,
  });
});

// ── Admin: credit or correct a partner's balance by hand ──────────────────
// Referral income is derived from captured payments, so a partner owed
// something the payment history cannot show — a bonus, a correction, a
// referral settled outside the gateway — had no way to be paid except by
// inventing a customer and a payment. This writes a signed, reasoned entry
// instead, which the payout balance picks up and the audit log records.
//
// 'partner.manage' is SUPER_ADMIN only. An ADMIN runs the product; moving
// money is not part of that.
app.post('/api/admin/partners/:id/adjustment', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.manage');
  if (!ctx) return;
  const { id } = req.params;

  const amount = Number(req.body?.amount);
  const reason = String(req.body?.reason || '').trim();

  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ error: 'Amount must be a non-zero number of rupees.' });
  }
  if (Math.abs(amount) > MAX_PARTNER_ADJUSTMENT_INR) {
    return res.status(400).json({
      error: `A single adjustment is capped at ₹${MAX_PARTNER_ADJUSTMENT_INR.toLocaleString('en-IN')}.`,
    });
  }
  if (reason.length < 3) {
    return res.status(400).json({
      error: 'A reason is required. It is shown in the payout history and the audit log.',
    });
  }
  // Rupees and paise only. Anything finer is a slip, and it would show up as a
  // balance that never settles to a round figure.
  const rounded = Math.round(amount * 100) / 100;

  let target: any = null;
  if (!useSupabase) {
    target = localFindUser((u: any) => u.id === id);
  } else {
    const { data } = await supabase.from('users').select('id, email, name, role, preferences').eq('id', id).maybeSingle();
    target = data;
  }
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (String(target.role || '').toUpperCase() !== 'PARTNER') {
    return res.status(400).json({ error: 'This user is not a partner, so they have no payout balance.' });
  }

  const entry: PartnerAdjustment = {
    id: `adj_${crypto.randomUUID()}`,
    amount: rounded,
    reason: reason.slice(0, 500),
    createdAt: new Date().toISOString(),
    createdBy: ctx.user?.id || null,
    createdByEmail: ctx.user?.email || null,
  };

  // Read-modify-write on a JSONB column is not atomic, so two admins crediting
  // the same partner in the same instant could lose one entry. Both would be
  // in the audit log, which is what a reconciliation would go by.
  if (!useSupabase) {
    const patched = localPatchUser(id, (row: any) => {
      const prefs = row.preferences && typeof row.preferences === 'object' ? row.preferences : {};
      setPrefsValue(prefs, 'partnerAdjustments', [entry, ...asAdjustmentList(prefsValue(prefs, 'partnerAdjustments'))]);
      row.preferences = prefs;
    });
    if (!patched) return res.status(404).json({ error: 'User not found.' });
  } else {
    const prefs = (target.preferences && typeof target.preferences === 'object') ? target.preferences : {};
    const next = setPrefsValue({ ...prefs }, 'partnerAdjustments', [entry, ...asAdjustmentList(prefsValue(prefs, 'partnerAdjustments'))]);
    const { error } = await supabase.from('users').update({ preferences: next }).eq('id', id);
    if (error) {
      console.error('[admin/partners/adjustment] write failed:', error);
      return res.status(500).json({ error: 'Failed to save the adjustment.' });
    }
  }

  await writeAuditLog(req, ctx, 'partner.balance_adjusted', 'partner', id, {
    amount: rounded,
    reason: entry.reason,
    partnerEmail: target.email,
  });

  const adjustments = await readPartnerAdjustments(id);
  res.json({
    success: true,
    message: rounded > 0
      ? `Credited ₹${rounded.toLocaleString('en-IN')} to ${target.email}.`
      : `Deducted ₹${Math.abs(rounded).toLocaleString('en-IN')} from ${target.email}.`,
    adjustment: entry,
    adjustmentTotal: sumAdjustments(adjustments),
    adjustments,
  });
});

// ── Admin: the adjustment history behind one partner's balance ────────────
app.get('/api/admin/partners/:id/adjustments', async (req, res) => {
  const ctx = await requirePermission(req, res, 'partner.manage');
  if (!ctx) return;
  const adjustments = await readPartnerAdjustments(req.params.id);
  res.json({ adjustments, adjustmentTotal: sumAdjustments(adjustments) });
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

  // Manual credits count here too, or this roster and the partner's own
  // payout screen would report different balances for the same person — the
  // exact mismatch referralEarningsByReferrer was written to end.
  const adjustments = await adjustmentTotalsByPartner();

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
      referralIncome: Math.round(((income[p.id] || 0) + (adjustments[p.id] || 0)) * 100) / 100,
      // Split out so the roster can show "of which manual" rather than a
      // figure that does not reconcile against paidReferrals.
      adjustmentTotal: Math.round((adjustments[p.id] || 0) * 100) / 100,
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
    const { data: allPays } = await supabase.from('payments').select('user_id, amount, status');
    // referred_by holds either the referrer's id or their referral code, so the
    // earnings are keyed by whatever it holds and both are looked up below.
    const earnedByReferrer = referralEarningsByReferrer(
      (allUsers || []).map((u: any) => ({ id: u.id, referredBy: u.referred_by })),
      allPays || [],
    );

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
        referralIncome: (earnedByReferrer[u.id] || 0) + (earnedByReferrer[refCode] || 0),
        isPro: !!u.is_pro
      };
    });
    return res.json({ users: usersWithStats });
  }

  // The registry is a view over everyone, so it reads neither req.userDb —
  // which in local mode holds only the caller — nor the shared file alone. A
  // fresh signup lives in its own in-memory database until something flushes
  // it, so a file-only read left brand-new users out of the registry
  // altogether while /api/admin/partners, which spans both, counted them.
  // localAllUsers is the union.
  db = loadDatabaseFromFile();
  const everyone = localAllUsers();
  const visibleUsers = scope === null ? everyone : everyone.filter((u: any) => scope.includes(u.id));
  const earnedByReferrer = referralEarningsByReferrer(everyone, localAllPayments());
  // Accounts and trades come from the same union as the users above, not from
  // the file alone — see localAllRows.
  const allAccounts = localAllAccounts();
  const allTrades = localAllTrades();
  const usersWithStats = visibleUsers.map((u: any) => {
    const uAccounts = allAccounts.filter((acc: any) => acc.userId === u.id);
    const accIds = new Set(uAccounts.map((a: any) => a.id));
    const uTrades = allTrades.filter((t: any) => t.userId === u.id || (t.accountId && accIds.has(t.accountId)));
    const refCode = u.referralCode || ('FX-' + (u.id || '').replace(/\D/g, '').slice(-4).padStart(4, '8') || 'FX-100');
    const directReferrals = everyone.filter((other: any) =>
      other.referredBy && (other.referredBy === u.id || other.referredBy === refCode)
    ).length;

    return {
      ...sanitizeUser(u),
      accountsCount: uAccounts.length,
      tradesCount: uTrades.length,
      referralCode: refCode,
      referralCount: directReferrals,
      referralIncome: (earnedByReferrer[u.id] || 0) + (earnedByReferrer[refCode] || 0),
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

/**
 * Money totals for the admin dashboard, read off captured payments.
 *
 * These were `paidUsers * 399` and `totalReferrals * 300`. Both multiplied a
 * head count by a guessed price, and both were wrong:
 *  - 399 stopped being the Pro price when it became ₹499
 *    (PRO_PLAN_AMOUNT_PAISE), and a user who had renewed six times still
 *    counted once, so revenue was understated twice over.
 *  - every referred signup was credited ₹300 whether they ever paid or not,
 *    which also put this figure in open disagreement with the one
 *    /api/admin/partners reports for the very same partners.
 *
 * `amount` is stored in rupees (the payment rows divide by 100 on the way in),
 * which is the same unit PARTNER_PLATFORM_FLOOR_INR is in.
 */
/**
 * Captured revenue, in rupees.
 *
 * The callers used to guess: `p.amount > 1000 ? p.amount / 100 : p.amount`,
 * which silently divided any genuine payment over ₹1,000 by a hundred, and
 * `|| 399` for a missing amount, which invented money. Rows are stored in
 * rupees, so there is nothing to infer — a row without a usable amount
 * contributes nothing rather than a guess.
 */
const capturedRevenue = (payments: any[]): number => {
  let total = 0;
  for (const p of payments || []) {
    if (String(p?.status || '').toLowerCase() !== 'captured') continue;
    total += Number(p.amount) || 0;
  }
  return total;
};

const summarisePaymentTotals = (
  payments: any[],
  referrerOf: Record<string, string>,
): { totalRevenue: number; referralIncome: number; paidReferrals: number } => {
  let totalRevenue = 0;
  let referralIncome = 0;
  let paidReferrals = 0;
  for (const pay of payments || []) {
    if (String(pay?.status || '').toLowerCase() !== 'captured') continue;
    const amount = Number(pay.amount) || 0;
    totalRevenue += amount;
    const userId = pay.userId || pay.user_id;
    if (userId && referrerOf[userId]) {
      referralIncome += Math.max(0, amount - PARTNER_PLATFORM_FLOOR_INR);
      paidReferrals += 1;
    }
  }
  return { totalRevenue, referralIncome, paidReferrals };
};

app.get('/api/admin/dashboard', async (req, res) => {
  const ctx = await requirePermission(req, res, 'dashboard.read');
  if (!ctx) return;
  // A sub-admin's "platform" is their assigned users, so every number on this
  // dashboard is computed over that subset rather than the whole product.
  const scope = await scopeUserIds(ctx.role, ctx.user?.id || null);
  if (useSupabase) {
    const [{ data: rawUsers }, { data: rawTrades }, { data: allTickets }, { data: rawPayments }] = await Promise.all([
      // referral_code is not a column on users and was never read out of this
      // result — asking for it failed the whole select, so the admin dashboard
      // loaded with no users, no counts and no revenue.
      supabase.from('users').select('id, status, created_at, is_pro, referred_by'),
      supabase.from('trades').select('id, user_id'),
      supabase.from('support_tickets').select('id, status'),
      supabase.from('payments').select('user_id, amount, status'),
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
    const referrerOf: Record<string, string> = {};
    for (const u of allUsers || []) {
      if ((u as any).referred_by) referrerOf[(u as any).id] = (u as any).referred_by;
    }
    const scopedPayments = scope === null
      ? (rawPayments || [])
      : (rawPayments || []).filter((p: any) => scope.includes(p.user_id));
    const { totalRevenue, referralIncome, paidReferrals } =
      summarisePaymentTotals(scopedPayments, referrerOf);

    // Build user growth by day
    const dayBuckets: Record<string, number> = {};
    const sorted = (allUsers || []).filter((u: any) => u.created_at).sort((a: any, b: any) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
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
      paidReferrals,
      totalReferrals,
      totalTrades,
      totalRevenue,
      pendingTickets,
      userGrowth
    });
  }
  // fallback to per-user db
  // localAllUsers, not req.userDb and not the file alone: these are
  // platform-wide counters. req.userDb holds only the caller, so every number
  // came out 0; the file alone misses signups that are still only in their own
  // in-memory database, so the user count trailed reality.
  const db = loadDatabaseFromFile();
  const allLocalUsers = localAllUsers();
  const usersList = scope === null ? allLocalUsers : allLocalUsers.filter((u: any) => scope.includes(u.id));
  const totalUsers = usersList.length;
  const activeUsers = usersList.filter((u: any) => u.status === 'ACTIVE' || !u.status).length;
  const paidUsers = usersList.filter((u: any) => !!u.isPro).length;
  const freeUsers = Math.max(0, totalUsers - paidUsers);
  const totalTrades = (scope === null
    ? (db?.trades || [])
    : (db?.trades || []).filter((t: any) => scope.includes(t.userId))).length;
  const totalReferrals = usersList.filter((u: any) => !!u.referredBy).length;
  const localReferrerOf: Record<string, string> = {};
  for (const u of usersList) {
    if (u.referredBy) localReferrerOf[u.id] = u.referredBy;
  }
  const localPayments = scope === null
    ? localAllPayments()
    : localAllPayments().filter((p: any) => scope.includes(p.userId || p.user_id));
  const { totalRevenue, referralIncome, paidReferrals } =
    summarisePaymentTotals(localPayments, localReferrerOf);

  res.json({
    totalUsers,
    activeUsers,
    paidUsers,
    freeUsers,
    referralIncome,
    paidReferrals,
    totalReferrals,
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
  const { isPro, days } = req.body;

  const durationDays = Number(days) || 30;
  const proUntil = isPro ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000) : null;

  if (useSupabase) {
    const { error } = await supabase.from('users').update({
      is_pro: !!isPro,
      pro_until: proUntil ? proUntil.toISOString() : null,
      plan: isPro ? 'pro' : 'free'
    }).eq('id', id);
    if (error) {
      console.error('Error updating user plan:', error);
      return res.status(500).json({ error: 'Failed to update user plan' });
    }
    userDatabases.delete(id);
    await writeAuditLog(req, ctx, isPro ? 'user.grant_pro' : 'user.revoke_pro', 'user', id);
    return res.json({
      message: `User plan updated to ${isPro ? `Pro (${durationDays} days)` : 'Free'}`,
      isPro: !!isPro,
      proUntil: proUntil ? proUntil.toISOString() : null
    });
  }

  const target = localFindUser((u: any) => u.id === id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  await applyProState(id, proUntil);
  await writeAuditLog(req, ctx, isPro ? 'user.grant_pro' : 'user.revoke_pro', 'user', id);
  res.json({
    message: `User plan updated to ${isPro ? `Pro (${durationDays} days)` : 'Free'}`,
    isPro: !!isPro,
    proUntil: proUntil ? proUntil.toISOString() : null
  });
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
    // localAllUsers, not req.userDb: this is a platform-wide view, and in
    // local mode req.userDb holds only the caller, so the leaderboard and the
    // user counts were computed over one row.
    const allUsers = localAllUsers();
    const paidUsers = allUsers.filter((u: any) => !!u.isPro);
    const freeUsers = Math.max(0, allUsers.length - paidUsers.length);

    const earnedByReferrer = referralEarningsByReferrer(allUsers, localAllPayments());
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
        referralIncome: (earnedByReferrer[u.id] || 0) + (earnedByReferrer[refCode] || 0)
      };
    }).filter((r: any) => r.referralsCount > 0).sort((a: any, b: any) => b.referralsCount - a.referralsCount);

    const totalReferralIncome = referralLeaderboard.reduce((acc: number, r: any) => acc + r.referralIncome, 0);

    // Real payments only. This used to fall back to two invented transactions
    // from two invented customers whenever there were none, and to floor the
    // subscriber count and MRR at 2 — so a deployment that had never sold
    // anything reported ₹798 of monthly recurring revenue from "trader.sam".
    const payments = localAllPayments();

    return res.json({
      payments,
      subscriptions: [],
      activeCount: paidUsers.length,
      freeCount: freeUsers,
      totalUsers: allUsers.length,
      mrr: paidUsers.length * (PRO_PLAN_AMOUNT_PAISE / 100),
      totalRevenue: capturedRevenue(payments),
      currency: 'INR',
      totalReferralIncome,
      referralLeaderboard
    });
  }

  const [{ data: payments }, { data: subs }, { data: users }, { data: partnerCodes }] = await Promise.all([
    supabase.from('payments').select('*').order('paid_at', { ascending: false }).limit(100),
    supabase.from('subscriptions').select('*').order('created_at', { ascending: false }).limit(200),
    supabase.from('users').select('id, email, name, is_pro, referred_by'),
    // The referral codes, from the table that has them. Selecting
    // users.referral_code failed this whole query, so Billing & Payments
    // loaded empty.
    supabase.from('partner_profiles').select('user_id, referral_code')
  ]);

  const userMap = new Map<string, any>((users || []).map((u: any) => [u.id, u]));
  const enrichedPayments = (payments || []).map((p: any) => {
    const u = userMap.get(p.user_id);
    return {
      ...toCamel(p),
      // No invented address: this defaulted to 'subscriber@axyfx.com', so a
      // payment whose user row had been deleted was attributed to an account
      // that does not exist.
      userEmail: u?.email || p.user_email || null,
      userName: u?.name || 'Trader'
    };
  });

  const activeSubs = (subs || []).filter((s: any) => s.status === 'active');
  const paidUsersCount = (users || []).filter((u: any) => !!u.is_pro).length;
  const freeUsersCount = Math.max(0, (users?.length || 0) - paidUsersCount);

  const earnedByReferrer = referralEarningsByReferrer(
    (users || []).map((u: any) => ({ id: u.id, referredBy: u.referred_by })),
    payments || [],
  );
  const codeByUser = new Map<string, string>(
    (partnerCodes || []).map((p: any) => [p.user_id, p.referral_code]),
  );
  const referralLeaderboard = (users || []).map((u: any) => {
    const refCode = codeByUser.get(u.id) || ('FX-' + (u.id || '').replace(/\D/g, '').slice(-4).padStart(4, '8') || 'FX-100');
    const directRefs = (users || []).filter((o: any) => o.referred_by && (o.referred_by === u.id || o.referred_by === refCode));
    const paidRefs = directRefs.filter((o: any) => !!o.is_pro).length;
    return {
      userId: u.id,
      name: u.name || 'Trader',
      email: u.email,
      referralCode: refCode,
      referralsCount: directRefs.length,
      paidReferralsCount: paidRefs,
      referralIncome: (earnedByReferrer[u.id] || 0) + (earnedByReferrer[refCode] || 0)
    };
  }).filter((r: any) => r.referralsCount > 0).sort((a: any, b: any) => b.referralsCount - a.referralsCount);

  const totalReferralIncome = referralLeaderboard.reduce((acc: number, r: any) => acc + r.referralIncome, 0);
  // The `|| paidUsersCount * 399` tail meant a platform with no payments still
  // reported revenue, at a price that has not applied since Pro became ₹499.
  const totalRev = capturedRevenue(payments || []);

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
  // Defaulting to the current list price, not the 399 it charged before Pro
  // became ₹499 — an admin who recorded an offline payment without an amount
  // was under-recording it by ₹100.
  const {
    userEmail, userId, amount = PRO_PLAN_AMOUNT_PAISE / 100,
    method = 'upi', notes = '', plan = 'pro', days = 30,
  } = req.body || {};
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
    // localFindUser, not req.userDb: in local mode req.userDb holds only the
    // caller, so this could only ever find the admin's own row — recording an
    // offline payment for any other trader answered 404 Trader account not
    // found, which made the whole feature unusable.
    const wanted = userEmail ? userEmail.trim().toLowerCase() : '';
    targetUser = localFindUser((u: any) =>
      (userId && u.id === userId) || (!!wanted && u.email?.toLowerCase() === wanted)
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
    // randomUUID, not Date.now(): provider_payment_id is UNIQUE, and it is
    // what claimPayment dedupes on. Two offline payments recorded in the same
    // millisecond would have collided on it.
    provider_payment_id: `manual_${crypto.randomUUID()}`,
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
    // The shared file, so the row belongs to the platform rather than to
    // whichever admin happened to record it, and survives cache eviction.
    const row = { ...toCamel(paymentRecord), userEmail: targetUser.email };
    try {
      const fileDb = loadDatabaseFromFile();
      fileDb.payments = fileDb.payments || [];
      fileDb.payments.unshift(row);
      fs.writeFileSync(DB_FILE, JSON.stringify(fileDb, null, 2), 'utf-8');
    } catch (err) {
      console.error('[payments/record] file write failed:', err);
    }
    const db = (req as any).userDb;
    if (db) {
      db.payments = db.payments || [];
      if (!db.payments.some((p: any) => p.id === row.id)) db.payments.unshift(row);
    }
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

async function fetchLiveForexRss(limit: number = 30): Promise<any[]> {
  const url = 'https://news.google.com/rss/search?q=forex+trading+OR+"currency+market"+OR+"central+bank"+OR+"forex"+OR+"currency"&hl=en-US&gl=US&ceid=US:en';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Forex RSS responded with ${res.status}`);
  const text = await res.text();
  const rawItems = text.split('<item>').slice(1);

  const CURRENCY_LIST = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY', 'XAU', 'BTC'];
  const PAIRS_LIST = [
    'EUR/USD', 'USD/JPY', 'GBP/USD', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD',
    'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'EUR/CHF', 'EUR/AUD', 'AUD/JPY', 'XAU/USD'
  ];

  const articles: any[] = [];
  for (const raw of rawItems) {
    if (articles.length >= limit) break;
    let title = (raw.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const link = (raw.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/) || [])[1] || '';
    const pubDate = (raw.match(/<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/) || [])[1] || '';
    let source = (raw.match(/<source[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/source>/) || [])[1] || '';

    if (!title.trim()) continue;

    // Clean source from title if embedded as "Title - Source"
    if (title.includes(' - ') && !source) {
      const parts = title.split(' - ');
      source = parts.pop()?.trim() || '';
      title = parts.join(' - ');
    } else if (title.includes(' - ') && source) {
      title = title.replace(new RegExp('\\s*-\\s*' + source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '');
    }

    const clean = (str: string) =>
      str
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .trim();

    const cleanTitle = clean(title);
    if (!cleanTitle) continue;

    const upper = cleanTitle.toUpperCase();

    // Currencies detected
    const foundCurrencies = new Set<string>();
    for (const c of CURRENCY_LIST) {
      if (new RegExp(`\\b${c}\\b`).test(upper)) foundCurrencies.add(c);
    }
    if (foundCurrencies.size === 0) foundCurrencies.add('USD');

    // Pairs detected
    const foundPairs = new Set<string>();
    for (const p of PAIRS_LIST) {
      if (upper.includes(p) || upper.includes(p.replace('/', ''))) {
        foundPairs.add(p);
      }
    }

    // Category assignment
    let category = 'Market Analysis';
    if (/RATE|FED|FEDERAL RESERVE|FOMC|ECB|BOJ|BANK OF ENGLAND|CENTRAL BANK/i.test(upper)) {
      category = 'Central Banks';
    } else if (/INFLATION|CPI|PPI|PCE|PRICE INDEX/i.test(upper)) {
      category = 'Inflation';
    } else if (/JOB|PAYROLL|NFP|UNEMPLOYMENT|LABOR|EMPLOYMENT/i.test(upper)) {
      category = 'Employment';
    } else if (/GOLD|XAU|SILVER|CRUDE|OIL|BRENT|WTI|COMMODIT/i.test(upper)) {
      category = 'Commodities';
    } else if (/GDP|RECESSION|GROWTH|ECONOMIC EXPANSION/i.test(upper)) {
      category = 'GDP';
    } else if (/WAR|SANCTION|ELECTION|GEOPOLITIC|TARIFF|TRADE WAR/i.test(upper)) {
      category = 'Geopolitics';
    } else if (/FISCAL|BUDGET|DEBT CEILING|GOVERNMENT/i.test(upper)) {
      category = 'Government';
    }

    // Sentiment heuristic
    let sentimentScore = 0;
    let sentimentLabel = 'Neutral';
    const primaryCurrency = Array.from(foundCurrencies)[0] || 'USD';

    if (/RALLY|SURGE|JUMP|GAIN|RECORD HIGH|BULLISH|CLIMB|BOOST|SOAR|STRENGTHEN|EXPAND/i.test(cleanTitle)) {
      sentimentScore = 0.55;
      sentimentLabel = `Bullish ${primaryCurrency}`;
    } else if (/FALL|DROP|SLUMP|PLUNGE|DIP|BEARISH|WEAK|SINK|DECLINE|TUMBLE|SLIDE/i.test(cleanTitle)) {
      sentimentScore = -0.55;
      sentimentLabel = `Bearish ${primaryCurrency}`;
    }

    let publishedAt = new Date().toISOString();
    if (pubDate) {
      const parsed = new Date(pubDate);
      if (!isNaN(parsed.getTime())) publishedAt = parsed.toISOString();
    }

    articles.push({
      id: link || cleanTitle,
      title: cleanTitle,
      summary: cleanTitle,
      url: link || '#',
      source: source || 'Market Wire',
      publishedAt,
      category,
      currencies: Array.from(foundCurrencies),
      pairs: Array.from(foundPairs),
      sentiment: { score: sentimentScore, label: sentimentLabel },
    });
  }

  return articles;
}

app.get('/api/fx-news', async (req, res) => {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '25'), 10) || 25, 1), 50);

  const cacheKey = `fx-news:${limit}`;
  try {
    let articles = getCached<any[]>(cacheKey);
    let sourceName = 'Global Forex Market Wire';
    if (!articles) {
      if (apiKey) {
        try {
          const url = `${ALPHA_VANTAGE_BASE}/query?function=NEWS_SENTIMENT&topics=${FX_NEWS_TOPICS}&limit=${limit}&sort=LATEST&apikey=${encodeURIComponent(apiKey)}`;
          const data = await fetchJson(url);
          if (!data?.Note && !data?.Information && !data?.Error && Array.isArray(data?.feed) && data.feed.length > 0) {
            articles = data.feed.map(normalizeNewsArticle).filter(Boolean);
            sourceName = 'Alpha Vantage News & Sentiment';
          }
        } catch (avErr: any) {
          console.warn('[GET /api/fx-news] Alpha Vantage failed, using live RSS feed:', avErr?.message || avErr);
        }
      }

      // If Alpha Vantage is not configured or failed/rate-limited, use live Forex RSS feed
      if (!articles || articles.length === 0) {
        articles = await fetchLiveForexRss(limit);
        sourceName = 'Global Forex Market Wire';
      }

      if (articles && articles.length > 0) {
        setCached(cacheKey, articles, 10 * 60 * 1000);
      }
    }

    let filtered = articles || [];
    const topic = typeof req.query.topic === 'string' ? req.query.topic : '';
    const currency = typeof req.query.currency === 'string' ? req.query.currency.toUpperCase() : '';
    if (topic && topic !== 'All') filtered = filtered.filter(a => a.category === topic);
    if (currency && currency !== 'All') filtered = filtered.filter(a => a.currencies.includes(currency));

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      articles: filtered,
      categories: NEWS_CATEGORY_ORDER,
      source: sourceName,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
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
 *
 * Neither exists yet, so the POST below refuses rather than reporting success.
 * Set ALLOW_UNSENT_WHATSAPP_REMINDERS=true to exercise the flow locally while
 * building the sender.
 */
const ALLOW_UNSENT_WHATSAPP_REMINDERS = process.env.ALLOW_UNSENT_WHATSAPP_REMINDERS === 'true';

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

    // Nothing dispatches these. The store below is a module-level array with
    // no sender, no cron and no WhatsApp provider behind it, so a Pro user who
    // set a reminder was answered `success: true` for a message that could
    // never arrive — and on a serverless platform the array is gone before the
    // next request anyway. Refusing plainly is the honest answer until a
    // sender exists; the validation below is kept for when one does.
    if (!ALLOW_UNSENT_WHATSAPP_REMINDERS) {
      return res.status(503).json({
        error: 'WhatsApp reminders are not available yet. Nothing would be sent, so nothing is saved.',
        code: 'NOT_IMPLEMENTED',
      });
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
// SHARED JOURNAL LINKS (PRO FEATURE)
// ==========================================

interface SharedJournalLink {
  token: string;
  userId: string;
  userName: string;
  sections: string[]; // 'dashboard', 'analysis', 'journal', 'calendar'
  months: number | 'all';
  active: boolean;
  views: number;
  createdAt: string;
  revokedAt?: string | null;
}

// Helper: load shared links for a specific user
//
// The three helpers below each had a Supabase branch and no other, so on the
// local db.json store creating a share link silently stored nothing and every
// /shared/<token> answered 404. That made the feature impossible to exercise
// without a cloud project, which is how the redirect bug in App.tsx survived.
// The local branches keep the same preferences.sharedLinks shape.
async function getUserSharedLinks(userId: string): Promise<SharedJournalLink[]> {
  const links: SharedJournalLink[] = [];
  if (!useSupabase) {
    const row = localFindUser((u: any) => u.id === userId);
    const stored = prefsValue(row?.preferences, 'sharedLinks');
    if (Array.isArray(stored)) links.push(...stored);
    return links;
  }
  if (useSupabase) {
    try {
      const { data: u } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
      const storedShared = prefsValue(u?.preferences, 'sharedLinks');
      if (Array.isArray(storedShared)) {
        links.push(...storedShared);
      }
      // Also try shared_journal_links table if present
      const { data: rows } = await supabase.from('shared_journal_links').select('*').eq('user_id', userId);
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (!links.some(l => l.token === r.token)) {
            links.push({
              token: r.token,
              userId: r.user_id,
              userName: r.user_name || 'Trader',
              sections: Array.isArray(r.sections) ? r.sections : ['dashboard', 'journal'],
              months: r.months === 'all' ? 'all' : (Number(r.months) || 3),
              active: r.active !== false,
              views: r.views || 0,
              createdAt: r.created_at || new Date().toISOString(),
            });
          }
        }
      }
    } catch (err: any) {
      console.warn('[getUserSharedLinks] Error loading from Supabase:', err?.message);
    }
  }
  return links;
}

// Helper: save or update a shared link for a user
async function saveUserSharedLink(userId: string, link: SharedJournalLink): Promise<void> {
  if (!useSupabase) {
    localPatchUser(userId, (row: any) => {
      const prefs = row.preferences && typeof row.preferences === 'object' ? row.preferences : {};
      const stored = prefsValue(prefs, 'sharedLinks');
      const existing = Array.isArray(stored) ? stored : [];
      const idx = existing.findIndex((l: any) => l.token === link.token);
      setPrefsValue(prefs, 'sharedLinks', idx >= 0
        ? existing.map((l: any, i: number) => (i === idx ? { ...l, ...link } : l))
        : [link, ...existing]);
      row.preferences = prefs;
    });
    return;
  }
  if (useSupabase) {
    try {
      const { data: u } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
      const storedShared = prefsValue(u?.preferences, 'sharedLinks');
      const existing = Array.isArray(storedShared) ? storedShared : [];
      const idx = existing.findIndex((l: any) => l.token === link.token);
      let updated: SharedJournalLink[];
      if (idx >= 0) {
        updated = [...existing];
        updated[idx] = { ...existing[idx], ...link };
      } else {
        updated = [link, ...existing];
      }
      const nextPrefs = setPrefsValue({ ...(u?.preferences || {}) }, 'sharedLinks', updated);
      await supabase.from('users').update({ preferences: nextPrefs }).eq('id', userId);

      // Best effort table upsert
      try {
        await supabase.from('shared_journal_links').upsert({
          token: link.token,
          user_id: link.userId,
          user_name: link.userName,
          sections: link.sections,
          months: String(link.months),
          active: link.active,
          views: link.views || 0,
          created_at: link.createdAt,
          updated_at: new Date().toISOString()
        }, { onConflict: 'token' });
      } catch (_) {}
    } catch (err: any) {
      console.error('[saveUserSharedLink] Error saving shared link:', err?.message);
    }
  }
}

// Helper: find a shared link across all users by token
async function findSharedLinkByToken(token: string): Promise<{ link: SharedJournalLink; ownerUser?: any } | null> {
  if (!token) return null;
  if (!useSupabase) {
    for (const u of localAllUsers()) {
      const stored = prefsValue(u?.preferences, 'sharedLinks');
          const links = Array.isArray(stored) ? stored : [];
      const found = links.find((l: any) => l.token === token);
      if (found) return { link: { ...found, userId: found.userId || u.id }, ownerUser: u };
    }
    return null;
  }
  if (useSupabase) {
    try {
      // 1. Try table
      const { data: row } = await supabase.from('shared_journal_links').select('*').eq('token', token).maybeSingle();
      if (row) {
        const { data: userRow } = await supabase.from('users').select('id, name, email, preferences').eq('id', row.user_id).maybeSingle();
        return {
          link: {
            token: row.token,
            userId: row.user_id,
            userName: row.user_name || userRow?.name || 'Trader',
            sections: Array.isArray(row.sections) ? row.sections : ['dashboard', 'journal'],
            months: row.months === 'all' ? 'all' : (Number(row.months) || 3),
            active: row.active !== false,
            views: row.views || 0,
            createdAt: row.created_at || new Date().toISOString(),
          },
          ownerUser: userRow
        };
      }

      // 2. Scan users preferences
      const { data: allUsers } = await supabase.from('users').select('id, name, email, preferences');
      if (Array.isArray(allUsers)) {
        for (const u of allUsers) {
          const stored = prefsValue(u.preferences, 'sharedLinks');
          const links = Array.isArray(stored) ? stored : [];
          const found = links.find((l: any) => l.token === token);
          if (found) {
            return {
              link: {
                ...found,
                userName: found.userName || u.name || (u.email ? u.email.split('@')[0] : 'Trader')
              },
              ownerUser: u
            };
          }
        }
      }
    } catch (err: any) {
      console.error('[findSharedLinkByToken] Error finding shared link:', err?.message);
    }
  }
  return null;
}

// ==========================================
// TRADER NOTEBOOK
// ==========================================
//
// The notebook lived entirely in localStorage: three keys in one browser, no
// route on this server and no table behind it. Notes written on a phone were
// not on the laptop, clearing site data destroyed them with no copy anywhere,
// and the editor showed a "saved" badge the whole time — on a Pro feature. It
// is now stored against the account.
//
// Kept in users.preferences rather than its own table on purpose: three
// migrations this project already needs have not been run, and a table that
// does not exist is how shared_journal_links ended up silently falling back to
// preferences anyway. One path that works today beats two where the primary
// is dead. A dedicated table is a clean upgrade later.

/** Ceiling on one notebook, so a single account cannot bloat its user row. */
const NOTEBOOK_MAX_BYTES = 1_000_000;

type NotebookDoc = {
  notes: any[];
  folders: string[];
  tags: string[];
  updatedAt: string | null;
};

const EMPTY_NOTEBOOK: NotebookDoc = { notes: [], folders: [], tags: [], updatedAt: null };

const asNotebookDoc = (raw: any): NotebookDoc => {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_NOTEBOOK };
  return {
    notes: Array.isArray(raw.notes) ? raw.notes : [],
    folders: Array.isArray(raw.folders) ? raw.folders.filter((f: any) => typeof f === 'string') : [],
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: any) => typeof t === 'string') : [],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  };
};

const readNotebook = async (userId: string): Promise<NotebookDoc> => {
  if (!useSupabase) {
    const row = localFindUser((u: any) => u.id === userId);
    return asNotebookDoc(prefsValue(row?.preferences, 'notebook'));
  }
  const { data } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
  return asNotebookDoc(prefsValue((data as any)?.preferences, 'notebook'));
};

const writeNotebook = async (userId: string, doc: NotebookDoc): Promise<string | null> => {
  if (!useSupabase) {
    const patched = localPatchUser(userId, (row: any) => {
      const prefs = row.preferences && typeof row.preferences === 'object' ? row.preferences : {};
      setPrefsValue(prefs, 'notebook', doc);
      row.preferences = prefs;
    });
    return patched ? null : 'User not found';
  }
  const { data } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
  const next = setPrefsValue({ ...((data as any)?.preferences || {}) }, 'notebook', doc);
  const { error } = await supabase.from('users').update({ preferences: next }).eq('id', userId);
  if (error) {
    console.error('[notebook] write failed:', error);
    return 'Failed to save the notebook.';
  }
  return null;
};

// GET /api/notebook – the signed-in trader's own notebook
app.get('/api/notebook', async (req, res) => {
  if (!requirePro(req, res, 'notebook')) return;
  const userId = (req as any).currentUser.id;
  res.json(await readNotebook(userId));
});

// PUT /api/notebook – replace it
//
// The whole document goes up together because that is how the editor holds it:
// notes, folders and tags change as one, and a per-note API would need three
// endpoints to express a single rename. `baseUpdatedAt` is the copy the client
// started from — if the stored copy is newer, someone saved from another
// device and this write is refused with the server's version rather than
// quietly overwriting it.
app.put('/api/notebook', async (req, res) => {
  if (!requirePro(req, res, 'notebook')) return;
  const userId = (req as any).currentUser.id;

  const body = req.body || {};
  if (!Array.isArray(body.notes) || !Array.isArray(body.folders) || !Array.isArray(body.tags)) {
    return res.status(400).json({ error: 'notes, folders and tags must all be arrays.' });
  }

  const doc = asNotebookDoc({ ...body, updatedAt: new Date().toISOString() });

  const size = Buffer.byteLength(JSON.stringify({ notes: doc.notes, folders: doc.folders, tags: doc.tags }), 'utf8');
  if (size > NOTEBOOK_MAX_BYTES) {
    return res.status(413).json({
      error: `This notebook is ${Math.round(size / 1024)} KB, over the ${Math.round(NOTEBOOK_MAX_BYTES / 1024)} KB limit. Delete or export a few long notes.`,
      code: 'NOTEBOOK_TOO_LARGE',
      bytes: size,
    });
  }

  const current = await readNotebook(userId);
  const base = typeof body.baseUpdatedAt === 'string' ? body.baseUpdatedAt : null;
  if (current.updatedAt && base && current.updatedAt > base) {
    return res.status(409).json({
      error: 'This notebook was changed somewhere else since you loaded it.',
      code: 'NOTEBOOK_CONFLICT',
      server: current,
    });
  }

  const failure = await writeNotebook(userId, doc);
  if (failure) return res.status(500).json({ error: failure });

  res.json({ success: true, updatedAt: doc.updatedAt, counts: { notes: doc.notes.length } });
});

// GET /api/shared-links – list current user's shared links
app.get('/api/shared-links', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser) return res.status(401).json({ error: 'Please log in to manage shared links.' });
  const links = await getUserSharedLinks(currentUser.id);
  res.json({ links });
});

// POST /api/shared-links – create a new share link (PRO exclusive)
app.post('/api/shared-links', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser) return res.status(401).json({ error: 'Please log in to create a share link.' });

  // Verify Pro subscription/status
  const isPro = !!(currentUser.isPro || currentUser.is_pro);
  if (!isPro) {
    return res.status(403).json({
      error: 'Sharing your journal is an exclusive Pro feature. Please upgrade to Pro to create shareable links.'
    });
  }

  const { sections, months } = req.body || {};
  const allowedSections = ['dashboard', 'analysis', 'journal', 'calendar'];
  const validSections = (Array.isArray(sections) ? sections : [])
    .filter((s: string) => allowedSections.includes(s));
  
  if (validSections.length === 0) {
    validSections.push('dashboard', 'journal');
  }

  let validMonths: number | 'all' = 'all';
  if (months !== 'all') {
    const num = Number(months);
    if ([1, 3, 6, 12].includes(num)) {
      validMonths = num;
    } else {
      validMonths = 3;
    }
  }

  // Generate secure 12-char URL safe token
  const token = crypto.randomBytes(9).toString('base64url');
  const newLink: SharedJournalLink = {
    token,
    userId: currentUser.id,
    userName: currentUser.name || (currentUser.email ? currentUser.email.split('@')[0] : 'Trader'),
    sections: validSections,
    months: validMonths,
    active: true,
    views: 0,
    createdAt: new Date().toISOString()
  };

  await saveUserSharedLink(currentUser.id, newLink);

  res.status(201).json({
    success: true,
    link: newLink,
    shareUrl: `/shared/${token}`
  });
});

// DELETE /api/shared-links/:token – disable/revoke a share link
app.delete('/api/shared-links/:token', async (req, res) => {
  const currentUser = (req as any).currentUser;
  if (!currentUser) return res.status(401).json({ error: 'Please log in.' });

  const { token } = req.params;
  const links = await getUserSharedLinks(currentUser.id);
  const target = links.find(l => l.token === token);

  if (!target) {
    return res.status(404).json({ error: 'Share link not found or belongs to another user.' });
  }

  target.active = false;
  target.revokedAt = new Date().toISOString();
  await saveUserSharedLink(currentUser.id, target);

  res.json({ success: true, message: 'Share link disabled successfully.' });
});

// GET /api/shared/:token – PUBLIC endpoint to inspect shared journal data
app.get('/api/shared/:token', async (req, res) => {
  const { token } = req.params;
  const match = await findSharedLinkByToken(token);

  if (!match || !match.link || !match.link.active) {
    return res.status(404).json({
      error: 'This shared journal link does not exist, has expired, or was revoked by the trader.'
    });
  }

  const { link } = match;

  // Increment view counter asynchronously
  link.views = (link.views || 0) + 1;
  saveUserSharedLink(link.userId, link).catch(() => {});

  // Fetch owner trades. Reads the link owner's rows, never the caller's —
  // this endpoint is public and the viewer's own session must not change what
  // it returns.
  let allTrades: any[] = [];
  if (!useSupabase) {
    const ownerDb = await ensureUserDbLoaded(link.userId, match.ownerUser?.email || '');
    const ownerAccountIds = new Set(
      (ownerDb?.accounts || []).filter((a: any) => a.userId === link.userId).map((a: any) => a.id),
    );
    allTrades = (ownerDb?.trades || [])
      .filter((t: any) => t.userId === link.userId || (t.accountId && ownerAccountIds.has(t.accountId)))
      .sort((a: any, b: any) => String(b.date || '').localeCompare(String(a.date || '')));
  } else {
    try {
      const { data: rows } = await supabase
        .from('trades')
        .select('*')
        .eq('user_id', link.userId)
        .order('date', { ascending: false });
      if (rows) allTrades = toCamel(rows);
    } catch (err: any) {
      console.error('[GET /api/shared/:token] Error loading trades:', err?.message);
    }
  }

  // Filter out non-trading items (deposits, withdrawals)
  let tradingTrades = allTrades.filter(t => t.type !== 'Deposit' && t.type !== 'Withdrawal');

  // Filter by selected months
  if (link.months !== 'all') {
    const cutoffMs = Date.now() - (Number(link.months) * 30 * 24 * 60 * 60 * 1000);
    tradingTrades = tradingTrades.filter(t => {
      const d = new Date(t.date).getTime();
      return !isNaN(d) && d >= cutoffMs;
    });
  }

  // Compute summary stats
  const totalTrades = tradingTrades.length;
  const wins = tradingTrades.filter(t => (Number(t.profit) || Number(t.pnl) || 0) > 0);
  const losses = tradingTrades.filter(t => (Number(t.profit) || Number(t.pnl) || 0) < 0);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const netProfit = tradingTrades.reduce((acc, t) => acc + (Number(t.profit) || Number(t.pnl) || 0), 0);
  const grossProfit = wins.reduce((acc, t) => acc + (Number(t.profit) || Number(t.pnl) || 0), 0);
  const grossLoss = Math.abs(losses.reduce((acc, t) => acc + (Number(t.profit) || Number(t.pnl) || 0), 0));
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 99.9 : 0);
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const bestTrade = totalTrades > 0 ? Math.max(...tradingTrades.map(t => Number(t.profit) || Number(t.pnl) || 0)) : 0;
  const worstTrade = totalTrades > 0 ? Math.min(...tradingTrades.map(t => Number(t.profit) || Number(t.pnl) || 0)) : 0;

  // Cumulative equity curve data for charts
  let runningEquity = 0;
  const sortedChrono = [...tradingTrades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const equityCurve = sortedChrono.map((t, idx) => {
    runningEquity += (Number(t.profit) || Number(t.pnl) || 0);
    return {
      tradeNum: idx + 1,
      date: t.date ? String(t.date).slice(0, 10) : '',
      pnl: Number(t.profit) || Number(t.pnl) || 0,
      equity: Math.round(runningEquity * 100) / 100,
    };
  });

  // Strict Privacy: Sanitize trade rows (strip private account ids, broker passwords, secret tags, emails)
  // ONLY return full trade table fields if 'journal' was selected by owner!
  // If 'calendar' is selected without 'journal', provide only basic date/profit for the calendar view.
  const sanitizedTrades = link.sections.includes('journal')
    ? tradingTrades.map(t => ({
        id: t.id,
        symbol: t.symbol,
        type: t.type,
        lotSize: t.lotSize ?? t.lots ?? 0,
        entryPrice: t.entryPrice ?? 0,
        exitPrice: t.exitPrice ?? 0,
        date: t.date || t.openTime || t.open_time || null,
        exitTime: t.exitTime || t.exit_time || t.closeTime || null,
        profit: Number(t.profit) || Number(t.pnl) || 0,
        pnl: Number(t.profit) || Number(t.pnl) || 0,
        sl: t.sl || null,
        tp: t.tp || null,
        emotion: t.emotion || 'Calm',
        strategy: t.strategy || '',
        commission: t.commission || 0,
        swap: t.swap || 0,
        notes: t.notes ? String(t.notes).slice(0, 300) : '',
      }))
    : link.sections.includes('calendar')
      ? tradingTrades.map(t => ({
          id: t.id,
          symbol: t.symbol,
          type: t.type,
          date: t.date || t.openTime || t.open_time || null,
          exitTime: t.exitTime || t.exit_time || t.closeTime || null,
          profit: Number(t.profit) || Number(t.pnl) || 0,
          pnl: Number(t.profit) || Number(t.pnl) || 0,
        }))
      : [];

  // Analysis Breakdown if 'analysis' is in sections
  let analysisData = null;
  if (link.sections.includes('analysis')) {
    // Pairs performance breakdown
    const pairMap: Record<string, { trades: number; wins: number; profit: number }> = {};
    for (const t of tradingTrades) {
      const sym = (t.symbol || 'OTHER').toUpperCase();
      if (!pairMap[sym]) pairMap[sym] = { trades: 0, wins: 0, profit: 0 };
      const p = Number(t.profit) || Number(t.pnl) || 0;
      pairMap[sym].trades += 1;
      if (p > 0) pairMap[sym].wins += 1;
      pairMap[sym].profit += p;
    }
    const pairs = Object.entries(pairMap).map(([symbol, stat]) => ({
      symbol,
      trades: stat.trades,
      winRate: Math.round((stat.wins / stat.trades) * 100),
      profit: Math.round(stat.profit * 100) / 100,
    })).sort((a, b) => b.trades - a.trades);

    analysisData = { pairs };
  }

  // Check if current viewer is authenticated
  const currentViewer = (req as any).currentUser;
  const isViewerRegistered = !!currentViewer;

  res.json({
    valid: true,
    ownerName: link.userName || 'Verified Trader',
    sections: link.sections,
    months: link.months,
    createdAt: link.createdAt,
    views: link.views || 1,
    isViewerRegistered,
    stats: {
      totalTrades,
      winRate: Math.round(winRate * 10) / 10,
      netProfit: Math.round(netProfit * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      winsCount: wins.length,
      lossesCount: losses.length,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      bestTrade: Math.round(bestTrade * 100) / 100,
      worstTrade: Math.round(worstTrade * 100) / 100,
    },
    equityCurve,
    trades: sanitizedTrades,
    analysis: analysisData,
  });
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

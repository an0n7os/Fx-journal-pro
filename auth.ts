import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { twoFactor, bearer, admin } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { createRequire } from 'node:module';
import path from 'path';
import crypto from 'node:crypto';

const dynamicRequire = typeof require !== 'undefined' ? require : createRequire(typeof import.meta !== 'undefined' && import.meta.url ? import.meta.url : path.join(process.cwd(), 'index.js'));

const IS_SERVERLESS = !!(
  process.env.VERCEL ||
  process.env.NETLIFY ||
  process.env.AWS_LAMBDA_FUNCTION_NAME
);

const DB_PATH = path.join(process.cwd(), 'auth.sqlite');

function createMemoryStore(): Record<string, any[]> {
  return {
    user: [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
    jwks: [],
    twoFactor: [],
    passkey: [],
    invitation: [],
    organization: [],
    member: [],
  };
}

function getDatabaseAdapter(): any {
  // If PostgreSQL / Supabase connection string is configured
  if (process.env.DATABASE_URL) {
    const { Pool } = dynamicRequire('pg');
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }

  // On Serverless (Netlify Functions / Vercel), local SQLite disk is read-only and missing native bindings
  if (IS_SERVERLESS) {
    return memoryAdapter(createMemoryStore());
  }

  // Local development: load SQLite dynamically so serverless bundlers never fail
  try {
    const sqliteModule = dynamicRequire('node:' + 'sqlite');
    return new sqliteModule.DatabaseSync(DB_PATH);
  } catch (e) {
    console.warn('[Better Auth] Could not load SQLite, falling back to in-memory adapter:', e);
    return memoryAdapter(createMemoryStore());
  }
}

/**
 * The key Better Auth signs its sessions with.
 *
 * The fallback here used to be a literal in this file, and this repository is
 * public — so on any deployment where neither variable was set, the signing
 * key was readable by anyone and sessions could be forged. It is kept for a
 * local dev box and refused everywhere real users reach, the same shape as the
 * SESSION_SECRET and MT5_CREDENTIAL_MASTER_KEY guards in server.ts.
 *
 * A BETTER_AUTH_API_KEY constant also lived beside this, holding a real key
 * that nothing in the codebase ever read. It was deleted rather than moved to
 * an environment variable: dead code cannot be configured safely.
 */
function resolveAuthSecret(): string {
  const configured = process.env.BETTER_AUTH_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (IS_SERVERLESS || process.env.NODE_ENV === 'production') {
    throw new Error(
      'BETTER_AUTH_SECRET (or SESSION_SECRET) must be set to at least 32 characters in production.'
    );
  }
  console.warn('[Better Auth] No BETTER_AUTH_SECRET set — using an ephemeral development key.');
  return crypto.randomBytes(32).toString('hex');
}

export const auth = betterAuth({
  database: getDatabaseAdapter(),
  baseURL: process.env.BETTER_AUTH_URL || (IS_SERVERLESS ? 'https://fxjournalp.netlify.app' : 'http://localhost:3000'),
  secret: resolveAuthSecret(),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }: { user: any; url: string }) => {
      const resendKey = process.env.RESEND_API_KEY?.trim();
      if (!resendKey || resendKey === 'YOUR_RESEND_API_KEY') {
        console.log(`[Better Auth] Reset Password URL for ${user.email}: ${url}`);
        return;
      }
      const configuredFrom = process.env.RESEND_FROM_EMAIL?.trim();
      const resendFrom = configuredFrom
        ? (configuredFrom.includes('<') ? configuredFrom : `FX Journal Pro <${configuredFrom}>`)
        : 'FX Journal Pro <onboarding@resend.dev>';

      try {
        console.log(`[Better Auth] Sending password reset email via Resend to ${user.email}...`);
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + resendKey,
          },
          body: JSON.stringify({
            from: resendFrom,
            to: user.email,
            subject: 'Reset your password - FX Journal Pro',
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background: #0f172a; color: #f8fafc; border-radius: 12px; border: 1px solid #1e293b;">
                <div style="text-align: center; margin-bottom: 24px;">
                  <h1 style="color: #6366f1; font-size: 24px; margin: 0; font-weight: 800; letter-spacing: -0.5px;">FX Journal Pro</h1>
                  <p style="color: #94a3b8; font-size: 14px; margin-top: 6px;">Professional Trading Performance & Journaling</p>
                </div>
                <div style="background: #1e293b; padding: 24px; border-radius: 8px; border: 1px solid #334155;">
                  <h2 style="font-size: 18px; margin: 0 0 12px; color: #f1f5f9;">Reset your password</h2>
                  <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin: 0 0 20px;">
                    Hi ${user.name || 'Trader'}, we received a request to reset your password. Click the button below to choose a new password.
                  </p>
                  <div style="text-align: center; margin: 28px 0;">
                    <a href="${url}" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; text-decoration: none; padding: 13px 32px; border-radius: 6px; font-weight: 600; font-size: 15px; display: inline-block;">
                      Reset Password
                    </a>
                  </div>
                  <p style="font-size: 12px; color: #94a3b8; margin: 20px 0 0; word-break: break-all;">
                    Or copy and paste this link: <a href="${url}" style="color: #818cf8;">${url}</a>
                  </p>
                </div>
                <p style="text-align: center; font-size: 12px; color: #64748b; margin-top: 24px;">
                  If you did not request a password reset, you can safely ignore this email.
                </p>
              </div>
            `,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          console.error('[Better Auth Resend Reset Error]', data);
        } else {
          console.log(`[Better Auth] Reset email sent to ${user.email} (id: ${data.id})`);
        }
      } catch (err: any) {
        console.error('[Better Auth Resend Reset Exception]', err?.message || err);
      }
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }: { user: any; url: string }) => {
      const resendKey = process.env.RESEND_API_KEY?.trim();
      if (!resendKey || resendKey === 'YOUR_RESEND_API_KEY') {
        console.log(`[Better Auth] Verification URL for ${user.email}: ${url}`);
        return;
      }
      const configuredFrom = process.env.RESEND_FROM_EMAIL?.trim();
      const resendFrom = configuredFrom
        ? (configuredFrom.includes('<') ? configuredFrom : `FX Journal Pro <${configuredFrom}>`)
        : 'FX Journal Pro <onboarding@resend.dev>';

      try {
        console.log(`[Better Auth] Sending verification email via Resend to ${user.email}...`);
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + resendKey,
          },
          body: JSON.stringify({
            from: resendFrom,
            to: user.email,
            subject: 'Verify your email - FX Journal Pro',
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background: #0f172a; color: #f8fafc; border-radius: 12px; border: 1px solid #1e293b;">
                <div style="text-align: center; margin-bottom: 24px;">
                  <h1 style="color: #6366f1; font-size: 24px; margin: 0; font-weight: 800; letter-spacing: -0.5px;">FX Journal Pro</h1>
                  <p style="color: #94a3b8; font-size: 14px; margin-top: 6px;">Professional Trading Performance & Journaling</p>
                </div>
                <div style="background: #1e293b; padding: 24px; border-radius: 8px; border: 1px solid #334155;">
                  <h2 style="font-size: 18px; margin: 0 0 12px; color: #f1f5f9;">Confirm your email address</h2>
                  <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin: 0 0 20px;">
                    Hi ${user.name || 'Trader'}, thank you for signing up. Please verify your email to unlock all trading features and protect your account.
                  </p>
                  <div style="text-align: center; margin: 28px 0;">
                    <a href="${url}" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; text-decoration: none; padding: 13px 32px; border-radius: 6px; font-weight: 600; font-size: 15px; display: inline-block;">
                      Verify My Email
                    </a>
                  </div>
                  <p style="font-size: 12px; color: #94a3b8; margin: 20px 0 0; word-break: break-all;">
                    Or copy and paste this link: <a href="${url}" style="color: #818cf8;">${url}</a>
                  </p>
                </div>
                <p style="text-align: center; font-size: 12px; color: #64748b; margin-top: 24px;">
                  If you didn't create an account, you can safely ignore this email.
                </p>
              </div>
            `,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          console.error('[Better Auth Resend Error]', data);
        } else {
          console.log(`[Better Auth] Verification email sent successfully to ${user.email} (id: ${data.id})`);
        }
      } catch (err: any) {
        console.error('[Better Auth Resend Exception]', err?.message || err);
      }
    },
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'USER',
      },
      status: {
        type: 'string',
        required: false,
        defaultValue: 'ACTIVE',
      },
      experience: {
        type: 'string',
        required: false,
      },
      tradingStyle: {
        type: 'string',
        required: false,
      },
      mainMarkets: {
        type: 'string',
        required: false,
      },
      onboardingCompleted: {
        type: 'boolean',
        required: false,
        defaultValue: false,
      },
      isPro: {
        type: 'boolean',
        required: false,
        defaultValue: false,
      },
      proExpiresAt: {
        type: 'string',
        required: false,
      },
    },
  },
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID.trim(),
            clientSecret: process.env.GOOGLE_CLIENT_SECRET.trim(),
          },
        }
      : {}),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID.trim(),
            clientSecret: process.env.GITHUB_CLIENT_SECRET.trim(),
          },
        }
      : {}),
  },
  trustedOrigins: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://fxjournalp.netlify.app',
    'https://fxjournalpro.com',
  ],
  account: {
    storeStateStrategy: 'cookie',
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
    },
  },
  advanced: {
    useSecureCookies: (process.env.BETTER_AUTH_URL || '').startsWith('https://'),
    defaultCookieAttributes: {
      sameSite: 'lax',
      secure: (process.env.BETTER_AUTH_URL || '').startsWith('https://'),
    },
  },
  onAPIError: {
    onError: (error, ctx) => {
      console.error('[Better Auth API Error]', error?.message || error, ctx?.path);
    },
  },
  plugins: [
    bearer(),
  ],
});

/**
 * Automatically applies Better Auth migrations on startup if any tables/columns are missing.
 */
export async function autoMigrateBetterAuth() {
  if (IS_SERVERLESS) return;
  try {
    const migrations = await getMigrations(auth.options);
    if (migrations.toBeCreated.length > 0 || migrations.toBeAdded.length > 0) {
      console.log('[Better Auth] Running schema migrations...');
      if (migrations.runMigrations) {
        await migrations.runMigrations();
        console.log('[Better Auth] Schema migrations completed successfully.');
      }
    }
  } catch (err: any) {
    console.error('[Better Auth] Migration check error:', err?.message || err);
  }
}

import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { twoFactor, bearer, admin } from 'better-auth/plugins';
import { dash, sentinel } from '@better-auth/infra';
import { getMigrations } from 'better-auth/db/migration';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { createRequire } from 'node:module';
import path from 'path';

const dynamicRequire = typeof require !== 'undefined' ? require : createRequire(typeof import.meta !== 'undefined' && import.meta.url ? import.meta.url : path.join(process.cwd(), 'index.js'));

const IS_SERVERLESS = !!(
  process.env.VERCEL ||
  process.env.NETLIFY ||
  process.env.AWS_LAMBDA_FUNCTION_NAME
);

const DB_PATH = path.join(process.cwd(), 'auth.sqlite');
const apiKey = process.env.BETTER_AUTH_API_KEY?.trim() || 'ba_ukalull2qb70grj4r6a9ovq28blovydi';

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
    return memoryAdapter({});
  }

  // Local development: load SQLite dynamically so serverless bundlers never fail
  try {
    const sqliteModule = dynamicRequire('node:' + 'sqlite');
    return new sqliteModule.DatabaseSync(DB_PATH);
  } catch (e) {
    console.warn('[Better Auth] Could not load SQLite, falling back to in-memory adapter:', e);
    return memoryAdapter({});
  }
}

export const auth = betterAuth({
  database: getDatabaseAdapter(),
  baseURL: process.env.BETTER_AUTH_URL || (IS_SERVERLESS ? 'https://fxjournalp.netlify.app' : 'http://localhost:3000'),
  secret: process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET || 'axyfx-better-auth-secret-key-32chars-minimum-prod',
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    autoSignIn: true,
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
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
  },
  plugins: [
    bearer(),
    twoFactor({
      issuer: 'Fx Journal Pro',
    }),
    admin({
      defaultRole: 'user',
      adminRole: ['admin', 'SUPER_ADMIN', 'ADMIN'],
    }),
    dash(apiKey ? { apiKey } : undefined),
    sentinel(apiKey ? { apiKey } : undefined),
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

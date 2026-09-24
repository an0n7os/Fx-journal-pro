import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { twoFactor, bearer, admin } from 'better-auth/plugins';
import { dash, sentinel } from '@better-auth/infra';
import { getMigrations } from 'better-auth/db/migration';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'auth.sqlite');
const apiKey = process.env.BETTER_AUTH_API_KEY?.trim();

export const auth = betterAuth({
  database: new DatabaseSync(DB_PATH),
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
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

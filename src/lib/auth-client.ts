import { createAuthClient } from 'better-auth/react';
import { twoFactorClient, adminClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
  plugins: [
    twoFactorClient(),
    adminClient(),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;

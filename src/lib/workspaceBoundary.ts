/** This chooses a download boundary only. The server still authenticates every request. */
const publicPaths = new Set([
  '/', '/home', '/features', '/fx-news', '/mt5-sync', '/analytics', '/ai-mentor',
  '/security', '/faq', '/how-it-works', '/why', '/pricing',
  '/login', '/register', '/forgot-password',
]);
export function needsWorkspace(pathname: string, search: string, hash: string, hasStoredSession: boolean): boolean {
  if (hasStoredSession) return true;
  const params = new URLSearchParams(search);
  // Let the existing auth bootstrap finish OAuth callbacks and token recovery.
  if (params.has('code') || /(?:access_token|refresh_token|error_description)=/.test(hash)) return true;
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  return !publicPaths.has(path);
}

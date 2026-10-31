import React, { Suspense, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Logo from './components/Logo';
import { needsWorkspace } from './lib/workspaceBoundary';

const Workspace = React.lazy(() => import('./App'));
const PublicPage = React.lazy(() => import('./pages/LoginPage'));

function LoadingPage() {
  return <div className="min-h-screen bg-white dark:bg-[#07080c] flex items-center justify-center" role="status" aria-live="polite">
    <Logo size={36} className="animate-pulse" /><span className="sr-only">Loading…</span>
  </div>;
}

function hasStoredSession(): boolean {
  try {
    return ['auth_user_id', 'auth_email', 'auth_session_token'].some(key => !!(sessionStorage.getItem(key) || localStorage.getItem(key)));
  } catch { return true; } // Storage-blocked browsers keep the original bootstrap.
}

/** Public visitors do not download dashboard charts, admin code or trading tools. */
export default function Root() {
  const location = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState<'checking' | 'public' | 'workspace'>(() =>
    needsWorkspace(location.pathname, location.search, location.hash, hasStoredSession()) ? 'workspace' : 'checking');

  useEffect(() => {
    if (session !== 'checking') return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    // Cookie-only sessions must still restore when browser storage was cleared.
    fetch('/api/auth/me', { credentials: 'include', signal: controller.signal })
      .then(response => { if (active) setSession(response.status === 401 ? 'public' : 'workspace'); })
      .catch(() => { if (active) setSession('workspace'); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [session]);

  const workspace = session === 'workspace' || needsWorkspace(location.pathname, location.search, location.hash, hasStoredSession());
  return <Suspense fallback={<LoadingPage />}>
    {workspace ? <Workspace /> : session === 'checking' ? <LoadingPage /> : <PublicPage
      isSupabaseConfigured={false}
      authFetch={(url, options = {}) => fetch(url, { ...options, credentials: 'include' })}
      onLoginSuccess={() => { setSession('workspace'); navigate('/dashboard', { replace: true }); }}
    />}
  </Suspense>;
}

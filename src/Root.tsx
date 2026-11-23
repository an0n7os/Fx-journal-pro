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
  const hasSession = hasStoredSession();
  const isProtectedPath = needsWorkspace(location.pathname, location.search, location.hash, false);

  const [session, setSession] = useState<'checking' | 'public' | 'workspace'>(() => {
    if (hasSession || isProtectedPath) return 'workspace';
    return 'public';
  });

  useEffect(() => {
    if (session === 'workspace' && hasSession) return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    // Cookie-only sessions still restore in the background without blocking public render
    fetch('/api/auth/me', { credentials: 'include', signal: controller.signal })
      .then(response => {
        if (!active) return;
        if (response.ok) {
          setSession('workspace');
        } else if (isProtectedPath) {
          setSession('public');
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [hasSession, isProtectedPath, session]);

  const workspace = session === 'workspace';
  return (
    <Suspense fallback={<LoadingPage />}>
      {workspace ? (
        <Workspace />
      ) : (
        <PublicPage
          isSupabaseConfigured={false}
          authFetch={(url, options = {}) => fetch(url, { ...options, credentials: 'include' })}
          onLoginSuccess={() => { setSession('workspace'); navigate('/dashboard', { replace: true }); }}
        />
      )}
    </Suspense>
  );
}

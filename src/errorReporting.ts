/**
 * Minimal front-end error reporting.
 *
 * Without this, a crash in signup or trade logging is invisible — the user just
 * sees a blank screen and leaves, and nothing reaches you.
 *
 * Sentry is loaded lazily and only when VITE_SENTRY_DSN is set, so no DSN means
 * no extra bytes in the bundle and no third party in the request path. When it
 * is unset, errors are still caught and posted to /api/client-error, so the
 * server log records them.
 */

const DSN = import.meta.env.VITE_SENTRY_DSN?.trim();

// Never report the same message twice in a session — one broken render can fire
// hundreds of identical errors and bury everything else.
const seen = new Set<string>();

async function postToServer(payload: Record<string, unknown>) {
  try {
    await fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Reporting must never throw on top of the error it is reporting.
  }
}

function report(kind: string, message: string, stack?: string) {
  const key = `${kind}:${message}`;
  if (seen.has(key)) return;
  seen.add(key);

  postToServer({
    kind,
    message: String(message).slice(0, 500),
    stack: stack ? String(stack).slice(0, 2000) : undefined,
    url: window.location.pathname,
    userAgent: navigator.userAgent.slice(0, 200),
    at: new Date().toISOString(),
  });
}

/**
 * Report an error React caught before it reached window.onerror.
 *
 * A render-phase throw is handled by the nearest error boundary, so the global
 * 'error' listener above never fires for it — the crash that actually blanks
 * the screen would otherwise be the one crash we never hear about.
 */
export function reportClientError(error: Error, componentStack?: string) {
  report(
    'react',
    error?.message || String(error),
    [error?.stack, componentStack].filter(Boolean).join('\n\n'),
  );
}

export function initErrorReporting() {
  window.addEventListener('error', (e) => {
    report('error', e.message, e.error?.stack);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason: any = e.reason;
    report('unhandledrejection', reason?.message || String(reason), reason?.stack);
  });

  if (!DSN) return;

  // Pinned build, loaded from the CDN only when a DSN exists.
  import('https://cdn.jsdelivr.net/npm/@sentry/browser@8.47.0/+esm' as any)
    .then((Sentry: any) => {
      Sentry.init({
        dsn: DSN,
        environment: import.meta.env.MODE,
        tracesSampleRate: 0,
        // Trading notes and journal entries are private; never ship request
        // bodies or form contents to a third party.
        sendDefaultPii: false,
      });
    })
    .catch(() => {
      // Sentry blocked or offline — the server-side reporting above still runs.
    });
}

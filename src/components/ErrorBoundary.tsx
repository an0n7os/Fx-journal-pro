import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportClientError } from '../errorReporting';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence around the app tree.
 *
 * Without one, a single thrown error during render unmounts everything React
 * has on screen and the user is left looking at a blank white page with no way
 * back except guessing that a reload might help. A trader mid-session reads
 * that as "the site is down" and the error is never reported, because the only
 * trace of it is a console message nobody opens.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Send it on to the same endpoint window.onerror already feeds, so a crash
    // that kills the UI is at least as visible to us as one that does not.
    try {
      reportClientError(error, info?.componentStack || undefined);
    } catch {
      /* reporting must never mask the original error */
    }
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-slate-50 dark:bg-[#04040a]">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/12 border border-violet-500/25">
            <AlertTriangle className="h-6 w-6 text-violet-600 dark:text-violet-400" />
          </div>

          <h1 className="text-xl font-black text-slate-900 dark:text-white mb-2">
            Something went wrong on this screen
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            Your trades and account are safe — nothing was lost. Reloading usually clears it.
            If it keeps happening, send us the details at contact@fxjournalpro.com.
          </p>

          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 px-5 py-3 text-sm font-bold text-white transition-colors"
            >
              <RefreshCw className="h-4 w-4" /> Reload
            </button>
            <button
              onClick={() => { window.location.href = '/'; }}
              className="rounded-xl border border-slate-200 dark:border-white/10 px-5 py-3 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
            >
              Go to dashboard
            </button>
          </div>

          {import.meta.env.DEV && (
            <pre className="mt-6 max-h-56 overflow-auto rounded-xl bg-slate-900 p-4 text-left text-[11px] leading-relaxed text-rose-300">
              {error.stack || error.message}
            </pre>
          )}
        </div>
      </div>
    );
  }
}

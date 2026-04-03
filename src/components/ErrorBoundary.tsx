import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import * as Sentry from '@sentry/react';
import { reloadWithPreviewAccessToken } from '@/lib/previewToken';

const isChunkLoadError = (error: Error | null) => {
  if (!error) return false;
  const msg = error.message || '';
  return [
    'Failed to fetch dynamically imported module',
    'Importing a module script failed',
    'Failed to load module script',
    'ChunkLoadError',
  ].some((needle) => msg.includes(needle));
};

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);

    // Auto-reload for stale chunk errors (after deploys)
    if (isChunkLoadError(error)) {
      const reloaded = sessionStorage.getItem('chunk-reload');
      if (!reloaded) {
        sessionStorage.setItem('chunk-reload', '1');
        reloadWithPreviewAccessToken();
        return;
      }
    }

    Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    reloadWithPreviewAccessToken();
  };

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="max-w-md w-full border border-border bg-background p-8 text-center">
            <div className="h-14 w-14 bg-foreground text-background flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h1 className="text-lg font-semibold text-foreground uppercase tracking-wide mb-2">
              Une erreur est survenue
            </h1>
            <p className="text-sm text-muted-foreground mb-6">
              L'application a rencontré un problème inattendu. Essayez de rafraîchir la page.
            </p>
            {this.state.error && (
              <p className="text-xs text-muted-foreground/60 font-mono mb-6 break-all">
                {this.state.error.message?.slice(0, 150)}
              </p>
            )}
            <div className="flex gap-2 justify-center">
              <button
                onClick={this.handleRetry}
                className="relative overflow-hidden inline-flex items-center gap-2 h-9 px-5 bg-background text-foreground border border-border text-xs font-medium uppercase tracking-wider group"
              >
                <span className="relative z-10">Réessayer</span>
              </button>
              <button
                onClick={this.handleReload}
                className="relative overflow-hidden inline-flex items-center gap-2 h-9 px-5 bg-foreground text-background border border-border text-xs font-medium uppercase tracking-wider group"
              >
                <RefreshCw className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">Rafraîchir</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

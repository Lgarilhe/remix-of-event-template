import React, { Component, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { reloadWithPreviewAccessToken } from '@/lib/previewToken';
import { ErrorState } from '@/components/layout/ErrorState';
import { Button } from '@/components/ui/button';

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
        <ErrorState
          variant="page"
          title="Une erreur est survenue"
          description="L'application a rencontré un problème inattendu. Réessayez ; si le problème revient, rechargez la page."
          detail={this.state.error?.message}
          onRetry={this.handleRetry}
          action={
            <Button size="sm" onClick={this.handleReload}>
              Recharger la page
            </Button>
          }
        />
      );
    }

    return this.props.children;
  }
}

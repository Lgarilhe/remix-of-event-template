import React, { Component, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { ErrorState } from '@/components/layout/ErrorState';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  /**
   * Encart fixé en bas à droite plutôt que dans le flux : pour un composant
   * monté hors des pages (l'assistant), dont l'erreur finirait sous la page.
   */
  floating?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class SectionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[SectionErrorBoundary]', error, errorInfo?.componentStack);
    Sentry.captureException(error, {
      tags: { boundary: 'section' },
      contexts: { react: { componentStack: errorInfo?.componentStack } },
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const state = (
        <ErrorState
          variant={this.props.floating ? 'compact' : 'default'}
          title={this.props.fallbackTitle || 'Cette section n\'a pas pu s\'afficher'}
          description="Le reste de la page fonctionne. Réessayez pour recharger cette partie."
          detail={this.state.error?.message}
          onRetry={this.handleRetry}
          className={this.props.floating ? 'shadow-xl' : 'my-4'}
        />
      );
      if (this.props.floating) {
        return <div className="fixed bottom-4 right-4 z-toast w-[min(24rem,calc(100vw-2rem))]">{state}</div>;
      }
      return state;
    }

    return this.props.children;
  }
}

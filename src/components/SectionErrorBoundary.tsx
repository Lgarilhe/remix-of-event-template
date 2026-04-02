import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
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
    console.error('[SectionErrorBoundary]', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="border border-destructive/30 bg-destructive/5 p-6 text-center my-4">
          <AlertTriangle className="w-5 h-5 text-destructive mx-auto mb-2" />
          <p className="text-xs font-bold uppercase tracking-wider text-foreground mb-1">
            {this.props.fallbackTitle || 'Erreur dans cette section'}
          </p>
          <p className="text-xs text-muted-foreground font-mono mb-3">
            {this.state.error?.message?.slice(0, 100)}
          </p>
          <button
            onClick={this.handleRetry}
            className="relative overflow-hidden inline-flex items-center gap-1.5 h-[30px] px-4 text-xs font-medium uppercase tracking-wider border border-border bg-background text-foreground group"
          >
            <RefreshCw className="w-3 h-3 relative z-10" />
            <span className="relative z-10">Réessayer</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

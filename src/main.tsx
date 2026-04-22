import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from 'react-helmet-async';
import * as Sentry from "@sentry/react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { reloadWithPreviewAccessToken } from "@/lib/previewToken";
import App from "./App.tsx";
import "./index.css";

const isRecoverableImportError = (value: unknown) => {
  const message =
    typeof value === 'string'
      ? value
      : value instanceof Error
        ? value.message
        : typeof value === 'object' && value !== null && 'message' in value
          ? String((value as { message?: unknown }).message ?? '')
          : '';

  return [
    'Failed to fetch dynamically imported module',
    'Importing a module script failed',
    'Failed to load module script',
    'ChunkLoadError',
  ].some((needle) => message.includes(needle));
};

const recoverFromImportError = () => {
  const reloaded = sessionStorage.getItem('chunk-reload');
  if (!reloaded) {
    sessionStorage.setItem('chunk-reload', '1');
    reloadWithPreviewAccessToken();
  }
};

// ── Sentry error monitoring ──
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    tracesSampleRate: 0.1, // 10% of transactions for performance monitoring
    replaysSessionSampleRate: 0, // Don't record replays by default
    replaysOnErrorSampleRate: 0.5, // Record 50% of sessions with errors
    beforeSend(event) {
      // Don't send chunk reload errors (handled by the auto-reload below)
      if (event.exception?.values?.some(v => isRecoverableImportError(v.value))) {
        return null;
      }

      // PII scrubbing — RGPD compliance for multi-tenant SaaS
      // Strip cookies, auth tokens, request bodies, and user emails before
      // sending to Sentry. Sentry sees only sanitized error context.
      try {
        if (event.request) {
          // Cookies (auth session)
          if (event.request.cookies) event.request.cookies = '[Filtered]';
          if (event.request.headers) {
            const headers = event.request.headers as Record<string, string>;
            for (const key of Object.keys(headers)) {
              const lk = key.toLowerCase();
              if (lk === 'cookie' || lk === 'authorization' || lk === 'x-supabase-auth' || lk.startsWith('x-api')) {
                headers[key] = '[Filtered]';
              }
            }
          }
          // Request body (peut contenir messages, params privés)
          if (event.request.data) event.request.data = '[Filtered]';
        }
        // User PII : on garde id (utile pour debug) mais on scrub email
        if (event.user) {
          if (event.user.email) event.user.email = '[Filtered]';
          if (event.user.username) event.user.username = '[Filtered]';
          if (event.user.ip_address) event.user.ip_address = '[Filtered]';
        }
        // Breadcrumbs : strip data field (souvent params POST)
        if (event.breadcrumbs) {
          for (const crumb of event.breadcrumbs) {
            if (crumb.data) {
              const cd = crumb.data as Record<string, unknown>;
              for (const k of Object.keys(cd)) {
                if (/email|password|token|cookie|authorization/i.test(k)) {
                  cd[k] = '[Filtered]';
                }
              }
            }
          }
        }
      } catch {
        // Si le scrub plante, mieux vaut ne rien envoyer que d'envoyer du PII
        return null;
      }

      return event;
    },
  });
}

// Auto-reload on stale chunk errors (after deploys)
window.addEventListener('error', (e) => {
  if (isRecoverableImportError(e.error ?? e.message)) {
    recoverFromImportError();
  }
});

window.addEventListener('unhandledrejection', (e) => {
  if (isRecoverableImportError(e.reason)) {
    e.preventDefault();
    recoverFromImportError();
  }
});

window.addEventListener('load', () => sessionStorage.removeItem('chunk-reload'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const msg = (error as Error)?.message?.toLowerCase() || '';
        if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      onError: (error) => {
        Sentry.captureException(error);
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </QueryClientProvider>
      </BrowserRouter>
    </HelmetProvider>
  </StrictMode>,
);

/**
 * Generic wrapper for calling edge functions with automatic organization_id injection.
 * Includes timeout handling and user-friendly error messages.
 */

import { supabase } from '@/integrations/supabase/client';
import { getActiveOrganizationId } from '@/lib/orgContext';

const TIMEOUT_MS = 55_000;

/**
 * Timeouts plus longs pour certaines actions IA qui prennent du temps :
 * scorecard generation, scoring batch, etc. Ces fonctions appellent
 * Anthropic avec output structuré complexe (4000+ tokens output via
 * tool_use) → 25-40s d'inférence + cold start + DB queries.
 */
const HEAVY_AI_FUNCTIONS = new Set([
  'generate-scorecard',
  'score-profile-job',
  'screen-candidate',
  'generate-call-report',
  'audit-employer-brand',
]);
const HEAVY_AI_TIMEOUT_MS = 90_000;

function getTimeoutForFunction(functionName: string): number {
  return HEAVY_AI_FUNCTIONS.has(functionName) ? HEAVY_AI_TIMEOUT_MS : TIMEOUT_MS;
}

type EdgeResponsePayload = Record<string, unknown> | null;

async function readEdgeResponse(response: Response): Promise<{
  payload: EdgeResponsePayload;
  text: string;
}> {
  const text = await response.text();
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';

  if (!text.trim()) {
    return { payload: null, text: '' };
  }

  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { payload: parsed as Record<string, unknown>, text };
      }
    } catch {
      // Fall back to raw text below.
    }
  }

  return { payload: null, text };
}

/** Translate technical errors into French user-facing messages */
function humanizeError(err: Error | string): string {
  const msg = typeof err === 'string' ? err : err.message || '';
  const lower = msg.toLowerCase();

  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return 'Problème de connexion réseau. Vérifiez votre connexion internet et réessayez.';
  }
  if (lower.includes('aborted') || lower.includes('timeout') || lower.includes('signal')) {
    return 'La requête a pris trop de temps. Réessayez dans quelques instants.';
  }
  if (lower.includes('unauthorized') || lower.includes('401') || lower.includes('jwt')) {
    return 'Session expirée. Veuillez vous reconnecter.';
  }
  if (lower.includes('forbidden') || lower.includes('403')) {
    return 'Accès refusé. Vous n\'avez pas les permissions nécessaires.';
  }
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many')) {
    return 'Trop de requêtes. Patientez quelques secondes avant de réessayer.';
  }
  if (lower.includes('internal') || lower.includes('500') || lower.includes('502') || lower.includes('503')) {
    return 'Erreur serveur temporaire. Réessayez dans quelques instants.';
  }

  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
}

async function extractEdgeFunctionError(err: unknown): Promise<string> {
  const context = (err as { context?: Response })?.context;

  if (context instanceof Response) {
    try {
      const { payload, text } = await readEdgeResponse(context.clone());
      if (typeof payload?.error === 'string' && payload.error.trim()) {
        return payload.error;
      }
      if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message;
      }
      if (text.trim()) {
        return text;
      }
    } catch {
      // noop
    }
  }

  return humanizeError(err instanceof Error ? err : String(err));
}

/**
 * Make a single fetch call to the edge function. Used both for the initial
 * request and for the post-refresh retry.
 */
async function doFetchEdgeFunction(
  functionName: string,
  enrichedBody: Record<string, unknown>,
  accessToken: string | null,
): Promise<Response> {
  const abortController = new AbortController();
  const timeoutMs = getTimeoutForFunction(functionName);
  const timer = window.setTimeout(() => abortController.abort(), timeoutMs);
  try {
    return await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(enrichedBody),
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function invokeEdgeFunction<T = Record<string, unknown>>(
  functionName: string,
  body: Record<string, unknown> = {}
): Promise<{ data: T & { success?: boolean; error?: string }; error: Error | null }> {
  const enrichedBody = { ...body };
  if (!enrichedBody.organization_id) {
    const orgId = await getActiveOrganizationId();
    if (orgId) {
      enrichedBody.organization_id = orgId;
    }
  }

  try {
    let { data: { session } } = await supabase.auth.getSession();
    let response = await doFetchEdgeFunction(functionName, enrichedBody, session?.access_token ?? null);

    // I7 — Session recovery on 401 : si le JWT est expiré, on force un refresh
    // (Supabase tente normalement auto via autoRefreshToken: true mais peut rater
    // si l'onglet est resté longtemps en background ou si le refresh token a
    // été rotaté en parallèle). On retry une fois, pas plus.
    if (response.status === 401) {
      console.warn(`[invokeEdgeFunction] ${functionName} got 401, attempting session refresh + retry`);
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) {
        // Refresh impossible → l'user doit se reconnecter (on laisse l'erreur 401 remonter)
        console.error('[invokeEdgeFunction] session refresh failed, user must re-login:', refreshError?.message);
      } else {
        session = refreshData.session;
        response = await doFetchEdgeFunction(functionName, enrichedBody, session.access_token);
      }
    }

    const { payload, text } = await readEdgeResponse(response);

    if (!response.ok) {
      const rawMessage =
        (typeof payload?.error === 'string' && payload.error.trim())
          ? payload.error
          : (typeof payload?.message === 'string' && payload.message.trim())
            ? payload.message
            : text.trim() || `HTTP ${response.status}`;

      const friendlyMsg = humanizeError(rawMessage);
      return { data: { success: false, error: friendlyMsg } as any, error: new Error(friendlyMsg) };
    }

    return {
      data: ((payload ?? ({ success: true } satisfies { success: boolean })) as T & { success?: boolean; error?: string }),
      error: null,
    };
  } catch (e: any) {
    const friendlyMsg = await extractEdgeFunctionError(e);
    console.error(`[invokeEdgeFunction] ${functionName} failed:`, e);
    return { data: { success: false, error: friendlyMsg } as any, error: new Error(friendlyMsg) };
  }
}

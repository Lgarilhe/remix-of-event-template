/**
 * Generic wrapper for calling edge functions with automatic organization_id injection.
 * Includes timeout handling and user-friendly error messages.
 */

import { supabase } from '@/integrations/supabase/client';
import { getActiveOrganizationId } from '@/lib/orgContext';

const TIMEOUT_MS = 55_000;

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
    const abortController = new AbortController();
    const timer = window.setTimeout(() => abortController.abort(), TIMEOUT_MS);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(enrichedBody),
      signal: abortController.signal,
    });

    clearTimeout(timer);

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

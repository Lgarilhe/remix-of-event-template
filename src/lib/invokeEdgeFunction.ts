/**
 * Generic wrapper for calling edge functions with automatic organization_id injection.
 * Includes timeout handling and user-friendly error messages.
 */

import { supabase } from '@/integrations/supabase/client';
import { getActiveOrganizationId } from '@/lib/orgContext';

const TIMEOUT_MS = 55_000;

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
  // Return original if no match (but cap length)
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
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
    // Timeout wrapper
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
    });

    const { data, error } = await Promise.race([
      supabase.functions.invoke(functionName, {
        body: enrichedBody,
      }),
      timeoutPromise,
    ]);

    if (timer) clearTimeout(timer);

    if (error) {
      const friendlyMsg = humanizeError(error);
      return { data: { success: false, error: friendlyMsg } as any, error: new Error(friendlyMsg) };
    }

    return { data: data as T & { success?: boolean; error?: string }, error: null };
  } catch (e: any) {
    const friendlyMsg = humanizeError(e);
    console.error(`[invokeEdgeFunction] ${functionName} failed:`, e);
    return { data: { success: false, error: friendlyMsg } as any, error: new Error(friendlyMsg) };
  }
}

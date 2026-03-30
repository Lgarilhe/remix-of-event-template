/**
 * Unified wrapper for calling the unipile-search edge function.
 * 
 * Multi-tenant: automatically injects `organization_id` from the user's
 * active profile so edge functions can resolve per-org Unipile credentials.
 */

import { supabase } from '@/integrations/supabase/client';
import { getActiveOrganizationId } from '@/lib/orgContext';

export { clearOrgIdCache } from '@/lib/orgContext';

export interface UnipileResponse<T = Record<string, unknown>> {
  success: boolean;
  error?: string;
  errorType?: string;
  retryAfter?: number;
  [key: string]: unknown;
}

function humanizeUnipileError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? '');
  const lower = message.toLowerCase();

  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return 'Problème de connexion réseau. Vérifiez votre connexion internet et réessayez.';
  }

  if (lower.includes('timeout') || lower.includes('aborted') || lower.includes('signal')) {
    return 'La requête a pris trop de temps. Réessayez dans quelques instants.';
  }

  if (lower.includes('unauthorized') || lower.includes('401') || lower.includes('jwt')) {
    return 'Session expirée. Veuillez vous reconnecter.';
  }

  if (lower.includes('forbidden') || lower.includes('403')) {
    return 'Accès refusé. Vous n\'avez pas les permissions nécessaires.';
  }

  if (lower.includes('rate limit') || lower.includes('429')) {
    return 'Trop de requêtes. Patientez quelques secondes avant de réessayer.';
  }

  if (lower.includes('internal') || lower.includes('500') || lower.includes('502') || lower.includes('503')) {
    return 'Erreur serveur temporaire. Réessayez dans quelques instants.';
  }

  return message || 'Erreur de communication avec le serveur';
}

interface InvokeOptions {
  body: Record<string, unknown>;
}

/**
 * Call the unipile-search edge function with normalized error handling.
 * Automatically injects `organization_id` into the request body.
 */
export async function invokeUnipile(
  options: InvokeOptions
): Promise<{ data: UnipileResponse; httpStatus?: number }> {
  const body = { ...options.body };
  if (!body.organization_id) {
    const orgId = await getActiveOrganizationId();
    if (orgId) {
      body.organization_id = orgId;
    }
  }

  try {
    const { data, error } = await supabase.functions.invoke('unipile-search', {
      body,
    });

    if (!error) {
      return { data: data as UnipileResponse, httpStatus: 200 };
    }

    try {
      const context = (error as { context?: Response }).context;
      if (context instanceof Response) {
        const httpStatus = context.status;

        let parsedBody: Record<string, unknown> | null = null;
        try {
          parsedBody = await context.clone().json();
        } catch {
          const rawText = await context.clone().text();
          parsedBody = rawText ? { error: rawText } : null;
        }

        return {
          data: {
            success: false,
            ...(parsedBody ?? {}),
            error:
              (typeof parsedBody?.error === 'string' && parsedBody.error) ||
              (typeof parsedBody?.message === 'string' && parsedBody.message) ||
              humanizeUnipileError(error),
          } as UnipileResponse,
          httpStatus,
        };
      }
    } catch {
      // Fall through to normalized fallback below
    }

    return {
      data: {
        success: false,
        error: humanizeUnipileError(error),
      } as UnipileResponse,
      httpStatus: 500,
    };
  } catch (err) {
    return {
      data: {
        success: false,
        error: humanizeUnipileError(err),
      } as UnipileResponse,
      httpStatus: 500,
    };
  }
}

/**
 * Wrapper pour l'edge function `coresignal-search` (Base Konekt).
 *
 * Multi-tenant : injecte automatiquement `organization_id` depuis l'org active
 * du user. Même contrat de retour que invokeUnipile : `{ data, httpStatus }`
 * avec `data.success`, `data.results`, `data.cursor`, `data.total`, ou en cas
 * d'échec `data.error` / `data.errorType` / `data.retryable`.
 */

import { supabase } from '@/integrations/supabase/client';
import { getActiveOrganizationId } from '@/lib/orgContext';

export interface CoresignalResponse<T = Record<string, unknown>> {
  success: boolean;
  error?: string;
  errorType?: string;
  retryable?: boolean;
  [key: string]: unknown;
}

function humanizeError(err: unknown): string {
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
  if (lower.includes('rate limit') || lower.includes('429')) {
    return 'Trop de requêtes. Patientez quelques secondes avant de réessayer.';
  }
  return message || 'Erreur de communication avec le serveur';
}

interface InvokeOptions {
  body: Record<string, unknown>;
}

export async function invokeCoresignal(
  options: InvokeOptions
): Promise<{ data: CoresignalResponse; httpStatus?: number }> {
  const body = { ...options.body };
  if (!body.organization_id) {
    const orgId = await getActiveOrganizationId();
    if (orgId) body.organization_id = orgId;
  }

  try {
    const { data, error } = await supabase.functions.invoke('coresignal-search', { body });

    if (!error) {
      return { data: data as CoresignalResponse, httpStatus: 200 };
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
              humanizeError(error),
          } as CoresignalResponse,
          httpStatus,
        };
      }
    } catch {
      // fallthrough
    }

    return { data: { success: false, error: humanizeError(error) } as CoresignalResponse, httpStatus: 500 };
  } catch (err) {
    return { data: { success: false, error: humanizeError(err) } as CoresignalResponse, httpStatus: 500 };
  }
}

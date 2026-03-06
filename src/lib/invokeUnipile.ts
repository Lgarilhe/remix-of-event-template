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

  const { data, error } = await supabase.functions.invoke('unipile-search', {
    body,
  });

  if (!error) {
    return { data: data as UnipileResponse, httpStatus: 200 };
  }

  try {
    const context = (error as any).context;
    if (context instanceof Response) {
      const httpStatus = context.status;
      const responseBody = await context.json();
      return {
        data: { success: false, ...responseBody } as UnipileResponse,
        httpStatus,
      };
    }
  } catch {
    // Fall through
  }

  return {
    data: {
      success: false,
      error: error.message || 'Erreur de communication avec le serveur',
    } as UnipileResponse,
    httpStatus: 500,
  };
}

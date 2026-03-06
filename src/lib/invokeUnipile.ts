/**
 * Unified wrapper for calling the unipile-search edge function.
 * 
 * Normalizes responses so callers always get `{ success, error?, ...rest }`
 * regardless of whether the edge function returned a 2xx or non-2xx status.
 * 
 * Multi-tenant: automatically injects `organization_id` from the user's
 * active profile so edge functions can resolve per-org Unipile credentials.
 */

import { supabase } from '@/integrations/supabase/client';

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

// Module-level cache for organization_id to avoid repeated DB lookups
let cachedOrgId: string | null = null;
let cachedUserId: string | null = null;

async function getActiveOrganizationId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // Return cached value if same user
    if (cachedUserId === user.id && cachedOrgId !== null) {
      return cachedOrgId;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_organization_id')
      .eq('user_id', user.id)
      .single();

    cachedUserId = user.id;
    cachedOrgId = profile?.active_organization_id || null;
    return cachedOrgId;
  } catch {
    return null;
  }
}

/** Clear the cached org ID (call on auth state change or org switch) */
export function clearOrgIdCache() {
  cachedOrgId = null;
  cachedUserId = null;
}

/**
 * Call the unipile-search edge function with normalized error handling.
 * 
 * Automatically injects `organization_id` into the request body for
 * multi-tenant credential resolution.
 * 
 * Always returns `{ data, error: null }` where `data` contains `success: boolean`.
 * Non-2xx HTTP responses are transparently converted to `{ success: false, error: "..." }`.
 * Only truly unrecoverable errors (network failures, JSON parse errors) throw.
 */
export async function invokeUnipile(
  options: InvokeOptions
): Promise<{ data: UnipileResponse; httpStatus?: number }> {
  // Auto-inject organization_id if not already present
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

  // Happy path: 2xx response
  if (!error) {
    return { data: data as UnipileResponse, httpStatus: 200 };
  }

  // Non-2xx: extract the response body from the error context
  try {
    const context = (error as any).context;
    if (context instanceof Response) {
      const httpStatus = context.status;
      const responseBody = await context.json();
      
      return {
        data: {
          success: false,
          ...responseBody,
        } as UnipileResponse,
        httpStatus,
      };
    }
  } catch {
    // Failed to parse error context — fall through
  }

  // Fallback: wrap the raw error message
  return {
    data: {
      success: false,
      error: error.message || 'Erreur de communication avec le serveur',
    } as UnipileResponse,
    httpStatus: 500,
  };
}

/**
 * Generic wrapper for calling edge functions with automatic organization_id injection.
 * Works like invokeUnipile but for any edge function name.
 */

import { supabase } from '@/integrations/supabase/client';
import { getActiveOrganizationId } from '@/lib/orgContext';

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

  const { data, error } = await supabase.functions.invoke(functionName, {
    body: enrichedBody,
  });

  if (error) {
    return { data: { success: false, error: error.message } as any, error };
  }

  return { data: data as T & { success?: boolean; error?: string }, error: null };
}

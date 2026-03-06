/**
 * Shared utility to get the active organization ID for edge function calls.
 * Uses module-level caching to avoid repeated DB lookups.
 */

import { supabase } from '@/integrations/supabase/client';

let cachedOrgId: string | null = null;
let cachedUserId: string | null = null;

export async function getActiveOrganizationId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

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

export function clearOrgIdCache() {
  cachedOrgId = null;
  cachedUserId = null;
}

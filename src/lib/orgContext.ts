/**
 * Shared utility to get the active organization ID for edge function calls.
 * Uses module-level caching to avoid repeated DB lookups.
 */

import { supabase } from '@/integrations/supabase/client';

let cachedOrgId: string | null = null;
let cachedUserId: string | null = null;
let hasResolvedOrgId = false;
let pendingOrgIdPromise: Promise<string | null> | null = null;

export async function getActiveOrganizationId(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;
    if (!userId) {
      clearOrgIdCache();
      return null;
    }

    if (cachedUserId === userId && hasResolvedOrgId) {
      return cachedOrgId;
    }

    if (cachedUserId === userId && pendingOrgIdPromise) {
      return pendingOrgIdPromise;
    }

    cachedUserId = userId;
    hasResolvedOrgId = false;

    pendingOrgIdPromise = (async () => {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('active_organization_id')
          .eq('user_id', userId)
          .maybeSingle();

        cachedOrgId = profile?.active_organization_id || null;
        hasResolvedOrgId = true;
        return cachedOrgId;
      } catch {
        hasResolvedOrgId = false;
        return null;
      } finally {
        pendingOrgIdPromise = null;
      }
    })();

    return pendingOrgIdPromise;
  } catch {
    return null;
  }
}

export function clearOrgIdCache() {
  cachedOrgId = null;
  cachedUserId = null;
  hasResolvedOrgId = false;
  pendingOrgIdPromise = null;
}

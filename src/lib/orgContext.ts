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
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('active_organization_id')
          .eq('user_id', userId)
          .maybeSingle();

        if (error) {
          hasResolvedOrgId = false;
          return null;
        }

        cachedOrgId = profile?.active_organization_id || null;
        // Un null n'est pas définitif : l'utilisateur vient peut-être de
        // créer son organisation (onboarding) ou la ligne profil n'est pas
        // encore posée. On re-résout au prochain appel ; seul un id réel est
        // mis en cache pour la session.
        hasResolvedOrgId = cachedOrgId !== null;
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

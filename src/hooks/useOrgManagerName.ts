import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

/**
 * Nom affiché du propriétaire (le plus ancien), pour « gérés par ». null si inconnu, vide ou illisible.
 * Le profil n'est lisible que si l'active_organization_id du propriétaire désigne cette organisation
 * (règle own_or_same_org_select) : sinon null, et la phrase se replie.
 */
export function useOrgManagerName(enabled: boolean) {
  const { organizationId } = useOrganization();
  const query = useQuery({
    queryKey: ['org-manager-name', organizationId],
    enabled: enabled && !!organizationId,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    queryFn: async (): Promise<string | null> => {
      const { data: owner, error } = await supabase
        .from('organization_members').select('user_id')
        .eq('organization_id', organizationId!).eq('role', 'owner')
        .order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (error) throw error;
      if (!owner) return null;
      const { data: profile, error: profileError } = await supabase
        .from('profiles').select('display_name').eq('user_id', owner.user_id).maybeSingle();
      if (profileError) throw profileError;
      return profile?.display_name?.trim() || null;
    },
  });
  // En erreur, name = null : la phrase se replie sur « votre administrateur ».
  return { name: query.data ?? null, isLoading: enabled && !!organizationId && query.isLoading };
}

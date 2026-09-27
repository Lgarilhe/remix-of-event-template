import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

/**
 * Membres de l'organisation et leurs comptes reliés. Même clé de cache pour la
 * liste des expéditeurs et pour la vérification de l'éditeur (SequenceBuilder).
 */
export function useMultiSenderTeam(active: boolean) {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ['multi-sender-team', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const [membersRes, linkedInRes, emailRes] = await Promise.all([
        supabase
          .from('organization_members')
          .select('user_id, role')
          .eq('organization_id', organizationId),
        supabase
          .from('member_linkedin_accounts')
          .select('user_id, linkedin_account_id, linkedin_account_name')
          .eq('organization_id', organizationId),
        supabase
          .from('member_email_accounts')
          .select('user_id, email_account_id, email_address')
          .eq('organization_id', organizationId),
      ]);

      if (membersRes.error) throw membersRes.error;
      // Liaisons illisibles : l'équipe reste « inconnue » plutôt que de faire
      // passer tous les expéditeurs pour des comptes à retirer.
      if (linkedInRes.error) throw linkedInRes.error;
      const members = membersRes.data || [];

      const userIds = members.map(m => m.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);

      const profileMap = new Map((profiles || []).map(p => [p.user_id, p as { user_id: string; display_name: string | null }]));
      const linkedInMap = new Map((linkedInRes.data || []).map(l => [l.user_id, l]));
      const emailMap = new Map((emailRes.data || []).map(e => [e.user_id, e]));

      return members.map(m => {
        const profile = profileMap.get(m.user_id);
        const linkedin = linkedInMap.get(m.user_id);
        const email = emailMap.get(m.user_id);
        const displayName = profile?.display_name || 'Membre';
        return {
          userId: m.user_id,
          role: m.role,
          displayName,
          email: email?.email_address || '',
          avatarUrl: '',
          hasLinkedIn: !!linkedin,
          linkedInAccountId: linkedin?.linkedin_account_id || null,
          linkedInAccountName: linkedin?.linkedin_account_name || null,
          hasEmail: !!email,
          emailAccountId: email?.email_account_id || null,
        };
      });
    },
    enabled: !!organizationId && active,
    staleTime: 30_000,
  });
}

/** Comptes LinkedIn reliés à un membre de l'équipe : les seuls que la rotation utilise. */
export function linkedSenderIdsOf(members: ReadonlyArray<{ linkedInAccountId: string | null }>): Set<string> {
  return new Set(members.map(m => m.linkedInAccountId).filter((id): id is string => !!id));
}

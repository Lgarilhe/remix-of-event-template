import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from './useOrganization';
import { toast } from 'sonner';

export interface MemberLinkedInMapping {
  id: string;
  organization_id: string;
  user_id: string;
  linkedin_account_id: string;
  linkedin_account_name: string | null;
  linked_at: string;
  linked_by: string;
  proxy_country: string | null;
  proxy_updated_at: string | null;
  proxy_mode: string | null;
  proxy_host: string | null;
  proxy_port: number | null;
  proxy_protocol: string | null;
  proxy_last_error: string | null;
  proxy_is_active: boolean | null;
  account_status: string | null;
  failure_reason: string | null;
  last_checked_at: string | null;
}

/** Réponse de l'action serveur unlink_linkedin_account. */
export interface UnlinkLinkedInResult {
  removed?: number;
  paused_enrollments?: number;
  relabeled_enrollments?: number;
  cancelled_inmails?: number;
}

export function useMemberLinkedInAccounts() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const { data: mappings = [], isLoading, isSuccess, isRefetchError, isLoadingError, refetch } = useQuery({
    queryKey: ['member-linkedin-accounts', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_linkedin_accounts')
        .select('*')
        .eq('organization_id', organizationId!);
      if (error) throw error;
      return (data || []) as MemberLinkedInMapping[];
    },
    enabled: !!organizationId,
  });

  // Liaison et dissociation passent par le serveur (unipile-accounts) : la RLS
  // (admins_manage) refusait l'écriture directe à un simple membre, sans erreur
  // pour le DELETE (0 ligne, faux succès). Le résultat est vérifié ici.
  const linkAccount = useMutation({
    mutationFn: async ({ userId, linkedinAccountId }: { userId: string; linkedinAccountId: string; silent?: boolean }) => {
      if (!organizationId) throw new Error('Organisation introuvable, rechargez la page');
      const { data, error } = await invokeEdgeFunction<{ mapping?: { user_id?: string; linkedin_account_id?: string } }>('unipile-accounts', {
        action: 'claim_linkedin_account', organization_id: organizationId,
        user_id: userId, account_id: linkedinAccountId,
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "L'association a échoué");
      if (data.mapping?.linkedin_account_id !== linkedinAccountId || data.mapping?.user_id !== userId) {
        throw new Error("L'association n'a pas été confirmée. Rechargez la page puis réessayez.");
      }
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['member-linkedin-accounts'] });
      if (!vars.silent) toast.success('Compte LinkedIn associé');
    },
    onError: (err: Error) => toast.error("Le compte LinkedIn n'a pas été associé", { description: err.message }),
  });

  // « Dissocier » ne ferme jamais la session LinkedIn : le serveur retire la
  // liaison et arrête les envois du compte (relances en pause, InMails
  // programmés annulés). expectedAccountId : le compte que l'écran affichait,
  // une liaison repointée entre-temps est refusée.
  const unlinkAccount = useMutation({
    mutationFn: async ({ mappingId, expectedAccountId }: { mappingId: string; expectedAccountId: string }) => {
      if (!organizationId) throw new Error('Organisation introuvable, rechargez la page');
      const { data, error } = await invokeEdgeFunction<UnlinkLinkedInResult>('unipile-accounts', {
        action: 'unlink_linkedin_account', organization_id: organizationId,
        mapping_id: mappingId, expected_account_id: expectedAccountId,
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'La dissociation a échoué');
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['member-linkedin-accounts'] });
      const n = data.paused_enrollments ?? 0;
      const m = data.cancelled_inmails ?? 0;
      const parts = [
        n > 0 ? `${n} relance${n > 1 ? 's' : ''} mise${n > 1 ? 's' : ''} en pause` : null,
        m > 0 ? `${m} InMail${m > 1 ? 's' : ''} programmé${m > 1 ? 's' : ''} annulé${m > 1 ? 's' : ''}` : null,
      ].filter(Boolean);
      toast.success('Compte LinkedIn dissocié', parts.length ? { description: `${parts.join(', ')}.` } : undefined);
    },
    onError: (err: Error) => toast.error("Le compte LinkedIn n'a pas été dissocié", { description: err.message }),
  });

  const getMappingForUser = (userId: string) =>
    mappings.find(m => m.user_id === userId) || null;

  const getMappingForAccount = (accountId: string) =>
    mappings.find(m => m.linkedin_account_id === accountId) || null;

  const getUserLinkedAccountId = (userId: string): string | null =>
    getMappingForUser(userId)?.linkedin_account_id || null;

  return {
    mappings,
    isLoading,
    // React Query 5 : une requête désactivée (organisation pas encore connue) a
    // isLoading à false. Prêt = des liaisons ont été reçues : un rechargement
    // raté (isRefetchError) garde la dernière liste au lieu de repasser en attente.
    isReady: isSuccess || isRefetchError,
    // Lecture en échec sans aucune liaison reçue : à afficher comme une erreur
    // avec « Réessayer », jamais comme « aucun compte » ni comme un chargement.
    isError: isLoadingError,
    refetch,
    linkAccount: linkAccount.mutate,
    linkAccountAsync: linkAccount.mutateAsync,
    unlinkAccount: unlinkAccount.mutate,
    isLinking: linkAccount.isPending,
    isUnlinking: unlinkAccount.isPending,
    getMappingForUser,
    getMappingForAccount,
    getUserLinkedAccountId,
  };
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

export interface MemberWhatsAppAccount {
  id: string;
  name: string | null;
  identifier: string | null;
  status: string;
  type: 'WHATSAPP';
  /**
   * Vrai pour la trace d'un « Déconnecter » voulu (list_whatsapp) : la carte ne l'affiche jamais. Absent ou faux :
   * compte disparu chez le prestataire, qui reste une ligne « À reconnecter ». La carte lit ce champ par ce type
   * (withoutDeliberateDisconnects) : renommé dans ce type, le champ ne compile plus dans la garde de la carte. Le type
   * ne voit pas le serveur (la réponse est lue par un cast) : un test statique compare ce nom à celui que
   * unipile-accounts/handler.ts écrit (tests/ux/connexion-etats-comptes.test.mjs).
   */
  removed_by_member?: boolean;
}

/** Personal account API: no browser-side account claiming or shared sender. */
export function useMemberWhatsAppAccounts() {
  const { organizationId } = useOrganization();
  const { user, isReady } = useAuthReady();
  const queryClient = useQueryClient();
  const queryKey = ['member-whatsapp-accounts', organizationId, user?.id];
  const query = useQuery({
    queryKey,
    enabled: isReady && !!user?.id && !!organizationId,
    queryFn: async () => {
      const { data, error } = await invokeEdgeFunction<{ accounts: MemberWhatsAppAccount[] }>('unipile-accounts', {
        action: 'list_whatsapp', organization_id: organizationId,
      });
      if (error || !data?.success || !Array.isArray(data.accounts)) {
        throw error ?? new Error('Impossible de lire vos comptes WhatsApp');
      }
      return data.accounts;
    },
    refetchInterval: query => query.state.data?.some(account => account.status === 'CONNECTING') ? 5000 : false,
  });
  const disconnect = useMutation({
    mutationFn: async (accountId: string) => {
      const { data, error } = await invokeEdgeFunction('unipile-accounts', {
        action: 'disconnect_whatsapp', organization_id: organizationId, account_id: accountId,
      });
      if (error || !data?.success) throw error ?? new Error('Impossible de déconnecter votre compte WhatsApp');
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ['candidate-actions'] }),
      ]);
    },
  });
  return { ...query, accounts: query.data ?? [], disconnect, authReady: isReady && !!user?.id && !!organizationId };
}

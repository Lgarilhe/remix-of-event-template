/**
 * Boîtes e-mail de la personne connectée, lues chez le serveur (action list_email) :
 * une seule requête partagée, mise en cache par organisation et par utilisateur.
 *
 * La carte « Mon compte e-mail » lisait la liste dans un effet qui repartait à chaque
 * changement de contexte (session prête, organisation reçue) : plusieurs appels identiques
 * à chaque ouverture de Connexions. Une requête partagée n'en fait qu'un, et toute
 * relecture des liaisons (clé ['member-email-accounts'], après une connexion ou une
 * dissociation) relit aussi cette liste.
 *
 * Pas de nouvelle tentative automatique : une lecture ratée s'affiche tout de suite avec
 * « Réessayer », comme avant.
 */

import { useQuery } from '@tanstack/react-query';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

export interface MemberEmailListEntry {
  id: string;
  name?: string;
  identifier?: string;
  status?: string;
  type?: string;
}

/** Préfixe commun avec les liaisons : une relecture des liaisons relit aussi la liste. */
export const MEMBER_EMAIL_LIST_KEY = ['member-email-accounts', 'list'] as const;

export function useMemberEmailList() {
  const { organizationId } = useOrganization();
  const { user, isReady } = useAuthReady();
  return useQuery<MemberEmailListEntry[]>({
    queryKey: [...MEMBER_EMAIL_LIST_KEY, organizationId, user?.id],
    enabled: isReady && !!user?.id && !!organizationId,
    retry: false,
    queryFn: async () => {
      const { data, error } = await invokeEdgeFunction<{ accounts?: MemberEmailListEntry[] }>('unipile-accounts', {
        action: 'list_email',
        organization_id: organizationId,
      });
      if (error || !data?.success || !Array.isArray(data.accounts)) {
        throw error ?? new Error('Impossible de lire vos comptes e-mail');
      }
      return data.accounts;
    },
  });
}

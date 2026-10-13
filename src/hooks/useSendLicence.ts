import { useQuery } from '@tanstack/react-query';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { listContracts } from '@/components/connections/linkedInExtrasApi';
import { licenceFromContracts, type SendLicence } from '@/lib/inmailLicence';

export interface SendLicenceState {
  /** Licence qui enverra les InMails du compte ; `null` tant qu'elle n'est pas connue. */
  licence: SendLicence | null;
  /** Lecture des contrats en cours : la licence n'est pas encore connue. */
  isResolving: boolean;
}

/**
 * Licence active du compte d'envoi, lue comme le fait la file des InMails
 * (src/lib/inmailLicence.ts) : toujours dans la liste des contrats. Les offres
 * de la liste des comptes ne servent pas ici, le serveur les déduit au mieux
 * quand les contrats sont illisibles et un compte Recruiter passerait pour
 * Classic. Si les contrats sont illisibles, la licence reste inconnue
 * (`null`) : le navigateur ne la devine jamais et le serveur revérifie à
 * l'envoi.
 */
export function useSendLicence(accountId: string | null | undefined): SendLicenceState {
  const query = useQuery({
    queryKey: ['inmail-send-licence', accountId],
    enabled: !!accountId,
    staleTime: 0,
    retry: 1,
    queryFn: async () => {
      const result = await listContracts(
        (body) => invokeEdgeFunction('unipile-accounts', body),
        accountId as string,
      );
      if (result.ok === false) throw new Error(result.userMessage);
      return licenceFromContracts(result.contracts);
    },
  });

  if (!accountId) return { licence: null, isResolving: false };
  if (query.data) return { licence: query.data, isResolving: false };
  if (query.isError) return { licence: null, isResolving: false };
  return { licence: null, isResolving: true };
}

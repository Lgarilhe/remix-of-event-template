import { useMemo } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { resolveMyLinkedInStatus } from '@/lib/linkedinStatus';

/**
 * Identifiant du compte LinkedIn de la personne connectée, seulement s'il est
 * utilisable (relié et connecté). Liaison stricte par user_id : jamais le compte
 * d'un collègue (src/lib/linkedinStatus.ts). Sans compte utilisable : null.
 *
 * Sert aux lecteurs et aux envois de la fiche candidat : les comptes d'envoi
 * des séquences ne déterminent pas le compte personnel à utiliser.
 */
export function useMyLinkedInAccountId(): string | null {
  const { user } = useAuthReady();
  const { mappings, isReady: mappingsReady, isError: mappingsFailed } = useMemberLinkedInAccounts();
  const { accounts, ready: accountsReady, loadError: accountsFailed } = useLinkedInAccounts();
  const userId = user?.id ?? null;

  return useMemo(() => {
    const mine = resolveMyLinkedInStatus({
      userId,
      mappings,
      mappingsLoaded: mappingsReady,
      mappingsFailed,
      accounts,
      accountsLoaded: accountsReady,
      accountsFailed,
    });
    return mine.isUsable && mine.mapping ? mine.mapping.linkedin_account_id : null;
  }, [userId, mappings, mappingsReady, mappingsFailed, accounts, accountsReady, accountsFailed]);
}

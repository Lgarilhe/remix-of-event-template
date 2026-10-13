/**
 * Le compte LinkedIn de la personne connectée, tel que l'installation l'affiche.
 *
 * Liaison stricte par utilisateur (src/lib/linkedinStatus.ts) : jamais le premier
 * compte connecté de l'organisation, qui peut être celui d'un collègue. Un
 * compte relié dont la première synchronisation court est utilisable.
 */

import { useMemo } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { resolveMyLinkedInStatus } from '@/lib/linkedinStatus';
import { toOnboardingAccount, type OnboardingLinkedInAccount } from '@/lib/onboarding/linkedin';

export function useMyLinkedInAccount(): { account: OnboardingLinkedInAccount | null; ready: boolean } {
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
    return {
      account: mine.isUsable && mine.account ? toOnboardingAccount(mine.account) : null,
      ready: !!userId && mappingsReady && accountsReady,
    };
  }, [userId, mappings, mappingsReady, mappingsFailed, accounts, accountsReady, accountsFailed]);
}

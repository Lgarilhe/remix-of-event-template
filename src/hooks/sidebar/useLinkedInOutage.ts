/**
 * Panne du compte LinkedIn de l'utilisateur, en tête d'À traiter (§4.0, D41).
 *
 * Aucune requête nouvelle et aucun appel au service LinkedIn : les liaisons
 * (member_linkedin_accounts, en base) et la liste des comptes sont déjà
 * chargées par LinkedInAccountsContext. Sans liste reçue, le statut enregistré
 * sur la liaison fait foi (myLinkedInNeedsAction).
 * La panne disparaît quand le statut redevient bon, jamais au clic.
 */
import { useCallback } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { myLinkedInNeedsAction } from '@/lib/linkedinStatus';

export interface LinkedInOutage {
  status: 'loading' | 'error' | 'ok';
  outage: boolean;
  /** Relit les liaisons (ligne « Impossible de vérifier votre compte LinkedIn. »). */
  retry: () => void;
}

export function useLinkedInOutage(): LinkedInOutage {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const { mappings, isReady, isError, refetch } = useMemberLinkedInAccounts();
  const { accounts, ready, loadError } = useLinkedInAccounts();

  const needsAction = myLinkedInNeedsAction({
    userId,
    mappings,
    mappingsLoaded: isReady,
    mappingsFailed: isError,
    accounts,
    accountsLoaded: ready,
    accountsFailed: loadError,
  });

  const retry = useCallback(() => void refetch(), [refetch]);

  const status: LinkedInOutage['status'] = isError
    ? 'error'
    : !isReady || needsAction === null
      ? 'loading'
      : 'ok';
  return { status, outage: status === 'ok' && needsAction === true, retry };
}

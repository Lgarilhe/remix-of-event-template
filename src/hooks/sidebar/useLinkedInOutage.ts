/**
 * Panne du compte LinkedIn de l'utilisateur, en tête d'À traiter (§4.0, D41).
 *
 * Aucune requête nouvelle et aucun appel au service LinkedIn : les liaisons
 * (member_linkedin_accounts, en base) et la liste des comptes sont déjà
 * chargées par LinkedInAccountsContext. Sans liste reçue, le statut enregistré
 * sur la liaison fait foi (myLinkedInOutage).
 * La panne disparaît quand le statut redevient bon, jamais au clic.
 * Source unique du bandeau du tableau de bord et de la ligne d'À traiter :
 * `kind` dit si le compte est à reconnecter ou restreint (pas de « Reconnecter »).
 * Connexion limitée et PARTIAL ne sont pas une panne (état de carte seulement).
 */
import { useCallback } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { myLinkedInOutage, type LinkedInOutageKind } from '@/lib/linkedinStatus';

export interface LinkedInOutage {
  status: 'loading' | 'error' | 'ok';
  outage: boolean;
  /** À reconnecter ou accès restreint ; null hors panne et tant que l'état n'est pas connu. */
  kind: LinkedInOutageKind | null;
  /** Relit les liaisons (ligne « Impossible de vérifier votre compte LinkedIn. »). */
  retry: () => void;
}

export function useLinkedInOutage(): LinkedInOutage {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const { mappings, isReady, isError, refetch } = useMemberLinkedInAccounts();
  const { accounts, ready, loadError } = useLinkedInAccounts();

  const outageKind = myLinkedInOutage({
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
    : !isReady || outageKind === null
      ? 'loading'
      : 'ok';
  const kind = status === 'ok' && outageKind ? outageKind : null;
  return { status, outage: kind !== null, kind, retry };
}

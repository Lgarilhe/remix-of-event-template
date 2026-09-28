import { useEffect, useMemo, useState } from 'react';
import { LinkedInAccount } from '@/pages/Outreach';
import { applySubscriptionOverrides } from '@/components/outreach/LinkedInAccountManager';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useAuthReady } from '@/hooks/useAuthReady';

/**
 * Shared hook: filters LinkedIn accounts by role/membership and pre-selects the sending account.
 * Used by MissionSourcing, MissionOutreach and SourcingSearch.
 *
 * Liaison stricte (décision produit 2026-09) : chacun envoie depuis son propre
 * compte relié (member_linkedin_accounts), jamais depuis celui d'un collègue.
 * - Membre : uniquement son compte relié ; sans liaison, liste vide (les écrans
 *   affichent alors « connectez d'abord un compte LinkedIn »).
 * - Propriétaire et administrateur : tous les comptes de l'organisation restent
 *   listés, mais leur propre compte relié est présélectionné.
 */
export function useFilteredLinkedInAccounts() {
  const { accounts: rawAccounts, loading: accountsLoading } = useLinkedInAccounts();
  const { isAdmin, isOwner, isCollaborator } = useOrganization();
  const {
    getUserLinkedAccountId,
    isLoading: mappingsLoading,
    isReady: mappingsReady,
    isError: mappingsFailed,
  } = useMemberLinkedInAccounts();
  // Liaisons reçues, ou lecture en échec (on retombe alors sur le premier compte OK).
  const mappingsSettled = mappingsReady || mappingsFailed;
  const { isReady, user } = useAuthReady();
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const currentUserId = user?.id ?? null;
  const ownLinkedAccountId = currentUserId ? getUserLinkedAccountId(currentUserId) : null;

  // Apply subscription overrides + filter by member mapping
  const allAccounts = useMemo(
    () => (rawAccounts as LinkedInAccount[]).map(applySubscriptionOverrides),
    [rawAccounts]
  );

  const accounts = useMemo(() => {
    if (!isReady) return [];
    if ((isAdmin || isOwner) && !isCollaborator) return allAccounts;
    if (!currentUserId) return [];
    // Sans liaison : aucun compte, jamais celui d'un collègue.
    if (!ownLinkedAccountId) return [];
    return allAccounts.filter(a => a.id === ownLinkedAccountId);
  }, [allAccounts, isReady, isAdmin, isOwner, isCollaborator, currentUserId, ownLinkedAccountId]);

  // Présélection : son propre compte relié d'abord (même déconnecté, pour que
  // l'écran d'inscription affiche la panne au lieu d'envoyer depuis le compte
  // d'un collègue), sinon le premier compte OK. On attend les liaisons : sans
  // elles, le premier compte listé (souvent celui d'un collègue) serait retenu.
  useEffect(() => {
    if (selectedAccount || accounts.length === 0 || !mappingsSettled) return;
    const own = ownLinkedAccountId ? accounts.find(a => a.id === ownLinkedAccountId) : undefined;
    const okAccount = accounts.find(a => a.status === 'OK');
    setSelectedAccount(own?.id || okAccount?.id || accounts[0]?.id || null);
  }, [accounts, selectedAccount, mappingsSettled, ownLinkedAccountId]);

  return {
    accounts,
    accountsLoading: accountsLoading || mappingsLoading || !mappingsSettled || !isReady,
    selectedAccount,
    setSelectedAccount,
    currentUserId,
  };
}

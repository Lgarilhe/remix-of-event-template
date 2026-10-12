import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { LinkedInAccount } from '@/pages/Outreach';
import { applySubscriptionOverrides } from '@/components/outreach/LinkedInAccountManager';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useAuthReady } from '@/hooks/useAuthReady';

const sourcingAccountSelections = new Map<string, string>();

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
 * - Sourcing : selectionScope conserve le choix par recherche pendant la
 *   session du navigateur, après vérification des comptes encore autorisés.
 */
export function useFilteredLinkedInAccounts({ selectionScope }: { selectionScope?: string } = {}) {
  const { accounts: rawAccounts, loading: accountsLoading } = useLinkedInAccounts();
  const { organizationId, isAdmin, isOwner, isCollaborator, isLoading: organizationLoading } = useOrganization();
  const {
    getUserLinkedAccountId,
    isLoading: mappingsLoading,
    isReady: mappingsReady,
    isError: mappingsFailed,
  } = useMemberLinkedInAccounts();
  // Liaisons reçues, ou lecture en échec (on retombe alors sur le premier compte OK).
  const mappingsSettled = mappingsReady || mappingsFailed;
  const { isReady, user } = useAuthReady();
  const currentUserId = user?.id ?? null;
  const selectionKey = selectionScope && organizationId && currentUserId
    ? JSON.stringify([currentUserId, organizationId, selectionScope]) : null;
  const [selection, setSelection] = useState<{ key: string | null; id: string | null }>({ key: null, id: null });
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

  const selectionReady = !!selectionKey && isReady && !organizationLoading && !accountsLoading && mappingsSettled;
  // A mission or workspace switch must not expose the previous selection even
  // for the render before its restoration effect runs.
  const selectedAccount = selectionScope
    ? (selection.key === selectionKey && selectionReady && accounts.some(a => a.id === selection.id) ? selection.id : null)
    : selection.id;
  const liveSelection = useRef({ key: selectionKey, accounts, ready: selectionReady, selectedAccount });
  liveSelection.current = { key: selectionKey, accounts, ready: selectionReady, selectedAccount };
  const setSelectedAccount = useCallback((value: SetStateAction<string | null>) => {
    if (!selectionScope) {
      setSelection(previous => ({ key: null, id: typeof value === 'function' ? value(previous.id) : value }));
      return;
    }
    const live = liveSelection.current;
    if (!selectionKey || live.key !== selectionKey || !live.ready) return;
    const next = typeof value === 'function' ? value(live.selectedAccount) : value;
    if (next !== null && !live.accounts.some(a => a.id === next)) return;
    if (next === null) sourcingAccountSelections.delete(selectionKey);
    else sourcingAccountSelections.set(selectionKey, next);
    live.selectedAccount = next;
    setSelection({ key: selectionKey, id: next });
  }, [selectionScope, selectionKey]);

  // Présélection : son propre compte relié d'abord (même déconnecté, pour que
  // l'écran d'inscription affiche la panne au lieu d'envoyer depuis le compte
  // d'un collègue), sinon le premier compte OK. On attend les liaisons : sans
  // elles, le premier compte listé (souvent celui d'un collègue) serait retenu.
  useEffect(() => {
    if (selectionScope) return;
    if (selectedAccount || accounts.length === 0 || !mappingsSettled) return;
    const own = ownLinkedAccountId ? accounts.find(a => a.id === ownLinkedAccountId) : undefined;
    const okAccount = accounts.find(a => a.status === 'OK');
    setSelectedAccount(own?.id || okAccount?.id || accounts[0]?.id || null);
  }, [accounts, selectedAccount, mappingsSettled, ownLinkedAccountId, selectionScope, setSelectedAccount]);

  // Sourcing only: resume the account chosen for this search after navigation,
  // once the current workspace's accounts and member links have been received.
  // The filtered list remains authoritative when access or links have changed.
  useEffect(() => {
    if (!selectionScope || !selectionKey || !selectionReady) return;
    const rememberedId = sourcingAccountSelections.get(selectionKey);
    const remembered = accounts.find(a => a.id === rememberedId);
    if (rememberedId && !remembered) sourcingAccountSelections.delete(selectionKey);
    if (selectedAccount) return;
    const own = ownLinkedAccountId ? accounts.find(a => a.id === ownLinkedAccountId) : undefined;
    const okAccount = accounts.find(a => a.status === 'OK');
    setSelection({ key: selectionKey, id: remembered?.id || own?.id || okAccount?.id || accounts[0]?.id || null });
  }, [accounts, selectedAccount, selectionScope, selectionKey, selectionReady, ownLinkedAccountId]);

  return {
    accounts,
    accountsLoading: accountsLoading || mappingsLoading || !mappingsSettled || !isReady || (!!selectionScope && !selectionReady),
    selectedAccount,
    setSelectedAccount,
    currentUserId,
  };
}

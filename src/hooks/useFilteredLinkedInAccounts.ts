import { useMemo } from 'react';
import { LinkedInAccount } from '@/pages/Outreach';
import { applySubscriptionOverrides } from '@/components/outreach/LinkedInAccountManager';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useAuthReady } from '@/hooks/useAuthReady';

/**
 * Shared hook: filters LinkedIn accounts by role/membership and auto-selects the first OK one.
 * Used by MissionSourcing and MissionOutreach.
 */
export function useFilteredLinkedInAccounts() {
  const { accounts: rawAccounts, loading: accountsLoading } = useLinkedInAccounts();
  const { isAdmin, isOwner, isCollaborator } = useOrganization();
  const { getUserLinkedAccountId, isLoading: mappingsLoading } = useMemberLinkedInAccounts();
  const { isReady, user } = useAuthReady();
  const [selectedAccount, setSelectedAccount] = React.useState<string | null>(null);
  const currentUserId = user?.id ?? null;

  // Apply subscription overrides + filter by member mapping
  const allAccounts = useMemo(
    () => (rawAccounts as LinkedInAccount[]).map(applySubscriptionOverrides),
    [rawAccounts]
  );

  const accounts = useMemo(() => {
    if (!isReady) return [];
    if ((isAdmin || isOwner) && !isCollaborator) return allAccounts;
    if (!currentUserId) return [];
    const linkedAccountId = getUserLinkedAccountId(currentUserId);
    if (!linkedAccountId) return allAccounts;
    return allAccounts.filter(a => a.id === linkedAccountId);
  }, [allAccounts, isReady, isAdmin, isOwner, isCollaborator, currentUserId, getUserLinkedAccountId]);

  // Auto-select first OK account
  React.useEffect(() => {
    if (selectedAccount || accounts.length === 0) return;
    const okAccount = accounts.find(a => a.status === 'OK');
    setSelectedAccount(okAccount?.id || accounts[0]?.id || null);
  }, [accounts, selectedAccount]);

  return {
    accounts,
    accountsLoading: accountsLoading || mappingsLoading || !isReady,
    selectedAccount,
    setSelectedAccount,
    currentUserId,
  };
}

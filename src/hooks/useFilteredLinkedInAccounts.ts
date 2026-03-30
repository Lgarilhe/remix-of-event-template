import { useState, useEffect, useMemo } from 'react';
import { LinkedInAccount } from '@/pages/Outreach';
import { applySubscriptionOverrides } from '@/components/outreach/LinkedInAccountManager';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { supabase } from '@/integrations/supabase/client';

/**
 * Shared hook: filters LinkedIn accounts by role/membership and auto-selects the first OK one.
 * Used by MissionSourcing and MissionOutreach.
 */
export function useFilteredLinkedInAccounts() {
  const { accounts: rawAccounts, loading: accountsLoading } = useLinkedInAccounts();
  const { isAdmin, isOwner, isCollaborator } = useOrganization();
  const { getUserLinkedAccountId } = useMemberLinkedInAccounts();
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Get current user
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  // Apply subscription overrides + filter by member mapping
  const allAccounts = useMemo(
    () => (rawAccounts as LinkedInAccount[]).map(applySubscriptionOverrides),
    [rawAccounts]
  );

  const accounts = useMemo(() => {
    if ((isAdmin || isOwner) && !isCollaborator) return allAccounts;
    if (!currentUserId) return allAccounts;
    const linkedAccountId = getUserLinkedAccountId(currentUserId);
    if (!linkedAccountId) return allAccounts;
    return allAccounts.filter(a => a.id === linkedAccountId);
  }, [allAccounts, isAdmin, isOwner, isCollaborator, currentUserId, getUserLinkedAccountId]);

  // Auto-select first OK account
  useEffect(() => {
    if (selectedAccount || accounts.length === 0) return;
    const okAccount = accounts.find(a => a.status === 'OK');
    setSelectedAccount(okAccount?.id || accounts[0]?.id || null);
  }, [accounts, selectedAccount]);

  return {
    accounts,
    accountsLoading,
    selectedAccount,
    setSelectedAccount,
    currentUserId,
  };
}

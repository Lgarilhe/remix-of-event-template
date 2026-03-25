import React, { useState, useEffect, useMemo } from 'react';
import { Navbar } from '@/components/Navbar';
import { SEOHead } from '@/components/SEOHead';
import { MessagesInbox } from '@/components/outreach/MessagesInbox';
import { LinkedInAccount } from '@/pages/Outreach';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { applySubscriptionOverrides } from '@/components/outreach/LinkedInAccountManager';
import { supabase } from '@/integrations/supabase/client';
import { AttendeePicturesProvider } from '@/contexts/AttendeePicturesContext';

export default function Inbox() {
  const { accounts: rawAccounts, loading: accountsLoading } = useLinkedInAccounts();
  const { isAdmin, isOwner, isCollaborator, organizationId } = useOrganization();
  const { getUserLinkedAccountId } = useMemberLinkedInAccounts();
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  const accounts = useMemo(() => {
    if (!rawAccounts) return [];
    const mapped = rawAccounts.map(a => applySubscriptionOverrides(a as LinkedInAccount));
    if ((isAdmin || isOwner) && !isCollaborator) return mapped;
    if (!currentUserId) return [];
    const linkedId = getUserLinkedAccountId(currentUserId);
    if (!linkedId) return [];
    return mapped.filter(a => a.id === linkedId);
  }, [rawAccounts, isAdmin, isOwner, isCollaborator, currentUserId, getUserLinkedAccountId]);

  useEffect(() => {
    if (!selectedAccount && accounts.length > 0) {
      setSelectedAccount(accounts[0].id);
    }
  }, [accounts, selectedAccount]);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead title="Messages — Skalr" description="Messagerie LinkedIn unifiée" />
      <Navbar />
      <div className="pt-[57px]">
        <AttendeePicturesProvider>
          <MessagesInbox
            accounts={accounts}
            selectedAccount={selectedAccount}
            onAccountChange={setSelectedAccount}
            loading={accountsLoading}
          />
        </AttendeePicturesProvider>
      </div>
    </div>
  );
}

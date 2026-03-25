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
    <div className="h-screen flex flex-col bg-background">
      <SEOHead title="Messages — Skalr" description="Messagerie LinkedIn unifiée" />
      <Navbar />
      <div className="flex-1 min-h-0 px-3 pt-[57px] sm:px-6 lg:px-8">
        <div className="mx-auto h-full max-w-[1600px] md:px-[34px]">
          <AttendeePicturesProvider organizationId={organizationId || null}>
            <MessagesInbox
              accounts={accounts}
              selectedAccount={selectedAccount}
              onAccountChange={setSelectedAccount}
              loading={accountsLoading}
              fullHeight
            />
          </AttendeePicturesProvider>
        </div>
      </div>
    </div>
  );
}

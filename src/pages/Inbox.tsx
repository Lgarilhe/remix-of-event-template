import React, { useState, useEffect, useMemo } from 'react';
import { SEOHead } from '@/components/SEOHead';
import { MessagesInbox } from '@/components/outreach/MessagesInbox';
import { LinkedInAccount } from '@/pages/Outreach';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { applySubscriptionOverrides } from '@/components/outreach/LinkedInAccountManager';
import { AttendeePicturesProvider } from '@/contexts/AttendeePicturesContext';
import { useAuthReady } from '@/hooks/useAuthReady';
import { AnimatedChatBubble } from '@/components/ui/AnimatedChatBubble';

export default function Inbox() {
  const { accounts: rawAccounts, loading: accountsLoading } = useLinkedInAccounts();
  const { isAdmin, isOwner, isCollaborator, organizationId } = useOrganization();
  const { getUserLinkedAccountId } = useMemberLinkedInAccounts();
  const { user } = useAuthReady();
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);

  const accounts = useMemo(() => {
    if (!rawAccounts) return [];
    const mapped = rawAccounts.map(a => applySubscriptionOverrides(a as LinkedInAccount));
    if ((isAdmin || isOwner) && !isCollaborator) return mapped;
    const currentUserId = user?.id ?? null;
    if (!currentUserId) return [];
    const linkedId = getUserLinkedAccountId(currentUserId);
    if (!linkedId) return [];
    return mapped.filter(a => a.id === linkedId);
  }, [rawAccounts, isAdmin, isOwner, isCollaborator, user?.id, getUserLinkedAccountId]);

  useEffect(() => {
    if (!selectedAccount && accounts.length > 0) {
      setSelectedAccount(accounts[0].id);
    }
  }, [accounts, selectedAccount]);

  return (
    <div className="h-full flex flex-col bg-background">
      <SEOHead title="Messages — Skalr" description="Messagerie LinkedIn unifiée" />
      <div className="flex items-center gap-2.5 px-3 sm:px-6 lg:px-8 pt-6 pb-2">
        <AnimatedChatBubble size={32} speed={0.8} />
        <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Messages</h1>
      </div>
      <div className="flex-1 min-h-0 px-3 sm:px-6 lg:px-8">
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

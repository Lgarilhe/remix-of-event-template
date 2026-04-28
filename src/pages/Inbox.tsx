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
  const { organizationId } = useOrganization();
  const { getUserLinkedAccountId } = useMemberLinkedInAccounts();
  const { user } = useAuthReady();
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);

  // SECURITY FIX (BUG cross-membre data leak — 2026-04-28) :
  // Avant : un admin/owner recevait TOUS les comptes LinkedIn de l'org →
  // setSelectedAccount(accounts[0]) prenait le premier de la liste qui était
  // souvent le compte d'un autre membre (ex: Laurent admin voyait les messages
  // de Guillaume collaborateur). C'est une fuite data inacceptable.
  //
  // Maintenant : tous les rôles (admin / owner / collaborator) ne voient que
  // leur PROPRE compte LinkedIn dans l'inbox. Pour superviser un autre membre,
  // il faudra passer par un futur mode "supervision" explicite (P2 backlog).
  const accounts = useMemo(() => {
    if (!rawAccounts) return [];
    const mapped = rawAccounts.map(a => applySubscriptionOverrides(a as LinkedInAccount));
    const currentUserId = user?.id ?? null;
    if (!currentUserId) return [];
    const linkedId = getUserLinkedAccountId(currentUserId);
    if (!linkedId) return [];
    // Filtre strict par compte personnel — JAMAIS de fallback vers accounts[0]
    return mapped.filter(a => a.id === linkedId);
  }, [rawAccounts, user?.id, getUserLinkedAccountId]);

  useEffect(() => {
    if (!selectedAccount && accounts.length > 0) {
      setSelectedAccount(accounts[0].id);
    }
  }, [accounts, selectedAccount]);

  return (
    <div className="h-full min-h-0 flex flex-col bg-background overflow-hidden">
      <SEOHead title="Messages — Skalr" description="Messagerie LinkedIn unifiée" />
      <div className="shrink-0 flex items-center gap-2.5 px-3 sm:px-6 lg:px-8 pt-6 pb-2">
        <AnimatedChatBubble size={32} speed={0.8} />
        <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Messages</h1>
      </div>
      <div className="flex-1 min-h-0 px-3 sm:px-6 lg:px-8 pb-3">
        <div className="mx-auto h-full min-h-0 max-w-[1600px] md:px-[34px]">
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

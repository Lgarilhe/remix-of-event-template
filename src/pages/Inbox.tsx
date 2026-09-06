/**
 * Inbox — Page messagerie unifiée.
 *
 * Refonte from scratch — 2026-04-28.
 *
 * Architecture simplifiée :
 *   - Hauteur explicite via 100dvh - (AppHeader 64px + bandeau crédits ~50px)
 *     → indépendant de la propagation flex/min-h-0 fragile
 *   - Pas de h-full en cascade qui peut foirer
 *   - Layout direct CSS Grid 2 cols : sidebar | conversation
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { MessagesInbox } from '@/components/outreach/MessagesInbox';
import { LinkedInAccount } from '@/pages/Outreach';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { applySubscriptionOverrides } from '@/components/outreach/LinkedInAccountManager';
import { AttendeePicturesProvider } from '@/contexts/AttendeePicturesContext';
import { useAuthReady } from '@/hooks/useAuthReady';
import { supabase } from '@/integrations/supabase/client';

export default function Inbox() {
  const { accounts: rawAccounts, loading: accountsLoading } = useLinkedInAccounts();
  const { organizationId } = useOrganization();
  const { getUserLinkedAccountId } = useMemberLinkedInAccounts();
  const { user } = useAuthReady();
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  // Deep link depuis une notification de nouveau message : /inbox?chatId=<id>
  const [searchParams] = useSearchParams();
  const initialChatId = searchParams.get('chatId');

  // SECURITY (cf commit b440d7c5) : tous les rôles ne voient QUE leur propre
  // compte LinkedIn personnel. Pas de fallback vers accounts[0] qui leakait
  // les conversations d'un autre membre.
  const accounts = useMemo(() => {
    if (!rawAccounts) return [];
    const mapped = rawAccounts.map(a => applySubscriptionOverrides(a as LinkedInAccount));
    const currentUserId = user?.id ?? null;
    if (!currentUserId) return [];
    const linkedId = getUserLinkedAccountId(currentUserId);
    if (!linkedId) return [];
    return mapped.filter(a => a.id === linkedId);
  }, [rawAccounts, user?.id, getUserLinkedAccountId]);

  useEffect(() => {
    if (!selectedAccount && accounts.length > 0) {
      setSelectedAccount(accounts[0].id);
    }
  }, [accounts, selectedAccount]);

  // À l'ouverture de la messagerie, les notifications de nouveaux messages
  // sont considérées lues : useUnreadMessageNotifications (pastille
  // « Messages » de la sidebar) redescend via les événements UPDATE realtime.
  useEffect(() => {
    if (!user?.id) return;
    const markMessageNotificationsRead = async () => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('type', 'new_message')
        .is('read_at', null);
      if (error) console.warn('[Inbox] Failed to mark message notifications as read:', error);
    };
    void markMessageNotificationsRead();
  }, [user?.id]);

  return (
    <>
      <SEOHead title="Messages — Konekt" description="Messagerie LinkedIn unifiée" />
      {/* Hauteur explicite : viewport - (AppHeader 64 + bandeau crédits 50 + buffer 10).
          Si pas de bandeau crédits, ce buffer est juste de la marge OK.
          Cette approche est robuste : pas de dépendance à la propagation flex. */}
      <div
        className="bg-background overflow-hidden"
        style={{ height: 'calc(100dvh - 124px)' }}
      >
        <AttendeePicturesProvider organizationId={organizationId || null}>
          <MessagesInbox
            key={initialChatId ?? 'inbox'}
            accounts={accounts}
            selectedAccount={selectedAccount}
            onAccountChange={setSelectedAccount}
            initialChatId={initialChatId}
            loading={accountsLoading}
            fullHeight
          />
        </AttendeePicturesProvider>
      </div>
    </>
  );
}

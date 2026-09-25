/**
 * Inbox — page de la messagerie (liste des conversations et conversation).
 *
 * Hauteur : l'espace visible sous le bord haut de la messagerie, mesuré au
 * lieu d'un calcul figé (revue design D-11). Un bandeau d'essai ou de crédits
 * qui apparaît ou disparaît au-dessus déplace ce bord : la hauteur suit.
 */

import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
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

/**
 * Hauteur disponible sous le bord haut d'un élément : `100dvh` moins sa
 * position dans la page. La position vient de offsetTop (la mise en page, sans
 * la translation de l'entrée de page) et se relit quand la page ou la fenêtre
 * change de taille.
 */
function useAvailableHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [top, setTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      let y = 0;
      for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
        y += node.offsetTop;
      }
      setTop((prev) => (prev === y ? prev : y));
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(document.body);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return { ref, height: top === null ? undefined : `calc(100dvh - ${top}px)` };
}

export default function Inbox() {
  const { accounts: rawAccounts, loading: accountsLoading } = useLinkedInAccounts();
  const { organizationId } = useOrganization();
  const { getUserLinkedAccountId } = useMemberLinkedInAccounts();
  const { user } = useAuthReady();
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const { ref: frameRef, height } = useAvailableHeight<HTMLDivElement>();
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

  // Lecture par conversation (D35) : seules les notifications de message de la
  // conversation ouverte sont marquées lues, par le lien ?chatId= (réponse
  // ouverte depuis la barre latérale) ou par le choix d'une conversation dans
  // la liste. Sans conversation, rien n'est marqué : les autres réponses
  // restent dans « À traiter » et dans son chiffre.
  const markChatRead = useCallback(async (chatId: string | null) => {
    if (!user?.id || !chatId) return;
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('type', 'new_message')
      .is('read_at', null)
      .eq('metadata->>chat_id', chatId); // même filtre que le webhook (réponse envoyée depuis LinkedIn)
    if (error) console.warn('[Inbox] marquage lu de la conversation en échec :', error);
  }, [user?.id]);

  useEffect(() => {
    markChatRead(initialChatId).catch((err) => console.warn('[Inbox] marquage lu en échec :', err));
  }, [markChatRead, initialChatId]);

  const handleChatChange = useCallback((chatId: string | null) => {
    markChatRead(chatId).catch((err) => console.warn('[Inbox] marquage lu en échec :', err));
  }, [markChatRead]);

  return (
    <>
      <SEOHead title="Messagerie | Konekt" description="Vos conversations LinkedIn avec les candidats" />
      <div ref={frameRef} className="min-h-0 overflow-hidden bg-background" style={height ? { height } : undefined}>
        <AttendeePicturesProvider organizationId={organizationId || null}>
          <MessagesInbox
            key={initialChatId ?? 'inbox'}
            accounts={accounts}
            selectedAccount={selectedAccount}
            onAccountChange={setSelectedAccount}
            initialChatId={initialChatId}
            onChatChange={handleChatChange}
            loading={accountsLoading}
            fullHeight
          />
        </AttendeePicturesProvider>
      </div>
    </>
  );
}

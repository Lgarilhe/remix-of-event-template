/**
 * Canal temps réel unique de la barre latérale (§4.6).
 *
 * - notifications de l'utilisateur : un message invalide Réponses ; les
 *   autres types invalident Pour vous et Activité ;
 * - actions proposées et conversations de l'assistant : À valider, En cours
 *   et Récentes.
 * Les clés à invalider s'accumulent et partent ensemble 300 ms après le
 * dernier événement : un marquage lu de N lignes donne N événements.
 * Rattrapage au retour du réseau, au retour sur l'onglet et à chaque
 * réinscription du canal (pas à la première : la première lecture est encore
 * en vol).
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';

// Un topic par instance : supabase.channel(topic) renvoie le canal existant si
// le nom est déjà pris, et le nettoyage d'une instance couperait l'autre.
let channelSeq = 0;

type Target = 'replies' | 'for-you' | 'activity' | 'agent-signals' | 'assistant-recent';

const rowType = (payload: { new: unknown; old: unknown }): unknown => {
  for (const row of [payload.new, payload.old]) {
    if (row && typeof row === 'object' && 'type' in row) return (row as { type: unknown }).type;
  }
  return undefined;
};

export function useSidebarRealtime(): void {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    // Données lues avant l'ouverture de ce canal (cache chaud après un
    // remontage d'AppLayout) : des événements ont pu tomber entre l'ancien canal
    // et celui-ci.
    const effectStart = Date.now();
    const pending = new Set<Target>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      for (const target of pending) {
        void queryClient.invalidateQueries({ queryKey: ['sidebar', target] });
      }
      pending.clear();
    };
    const schedule = (...targets: Target[]) => {
      for (const t of targets) pending.add(t);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 300);
    };
    const catchUp = () => {
      void queryClient.invalidateQueries({ queryKey: ['sidebar'] });
      void queryClient.invalidateQueries({ queryKey: ['all-reminders', 'overdue-count'] });
    };

    let firstSubscribe = true;
    const channel = supabase
      .channel(`sidebar-signals-${userId}-${++channelSeq}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const type = rowType(payload);
          if (type === 'new_message') schedule('replies');
          else if (typeof type === 'string') schedule('for-you', 'activity');
          // Suppression sans le type de la ligne : tout ce qui lit la table.
          else schedule('replies', 'for-you', 'activity');
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_tool_executions', filter: `user_id=eq.${userId}` },
        () => schedule('agent-signals'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_conversations', filter: `created_by=eq.${userId}` },
        () => schedule('agent-signals', 'assistant-recent'),
      )
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        if (firstSubscribe) {
          firstSubscribe = false;
          // Première inscription : les lectures encore en vol ou postérieures
          // au canal sont justes ; seules les données plus anciennes sont relues.
          const readBefore = (q: { state: { dataUpdatedAt: number } }) =>
            q.state.dataUpdatedAt > 0 && q.state.dataUpdatedAt < effectStart;
          void queryClient.invalidateQueries({ queryKey: ['sidebar'], predicate: readBefore });
          void queryClient.invalidateQueries({ queryKey: ['all-reminders', 'overdue-count'], predicate: readBefore });
          return;
        }
        catchUp();
      });

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') catchUp();
    };
    window.addEventListener('online', catchUp);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (timer) clearTimeout(timer);
      pending.clear();
      window.removeEventListener('online', catchUp);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}

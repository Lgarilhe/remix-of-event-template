// Page d'une séquence (lot 5c-2) : la séquence, ses étapes et ses compteurs
// d'inscriptions, sous la même forme que l'écran Séquences (SequenceWithStats),
// pour que la page réutilise les actions de la liste (src/lib/sequenceActions.ts)
// sur une liste d'une seule séquence. Lectures sous la RLS de la personne
// connectée, aucun appel serveur nouveau.
//
// Une relecture en échec garde la séquence affichée ; une séquence introuvable
// (supprimée, autre organisation) donne l'état d'erreur de la page.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import type { SequenceWithStats } from '@/lib/sequenceActions';
import { aggregateEnrollmentCounts, emptyBreakdown } from '@/lib/sequenceTableStats';

export type SequenceDetailState = 'loading' | 'error' | 'ready';

export function useSequenceDetail(sequenceId: string | undefined) {
  const { organizationId } = useOrganization();
  const [sequences, setSequences] = useState<SequenceWithStats[]>([]);
  const [state, setState] = useState<SequenceDetailState>('loading');
  // Compteurs illisibles : « - » à la place des nombres, jamais un zéro inventé.
  const [countsError, setCountsError] = useState(false);

  const fetchSequence = useCallback(async () => {
    if (!sequenceId || !organizationId) return;
    const { data, error } = await supabase
      .from('outreach_sequences')
      .select('*')
      .eq('id', sequenceId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) {
      console.error('Error loading sequence:', error);
      // Relecture en échec : la séquence déjà affichée reste.
      setState((prev) => (prev === 'ready' ? prev : 'error'));
      return;
    }
    if (!data) {
      setSequences([]);
      setState('error');
      return;
    }
    const [stepsRes, countsRes] = await Promise.all([
      supabase
        .from('sequence_steps')
        .select('*')
        .eq('sequence_id', sequenceId)
        .order('step_order', { ascending: true })
        .order('id', { ascending: true }),
      supabase.rpc('get_sequence_enrollment_counts', { p_sequence_ids: [sequenceId] }),
    ]);
    if (stepsRes.error) console.error('Error loading sequence steps:', stepsRes.error);
    if (countsRes.error) console.error('Error loading enrollment counts:', countsRes.error);
    const stats = aggregateEnrollmentCounts(countsRes.error ? [] : countsRes.data ?? []);
    setSequences((prev) => [{
      ...data,
      stop_conditions: data.stop_conditions as unknown as SequenceWithStats['stop_conditions'],
      sender_accounts: data.sender_accounts as unknown as SequenceWithStats['sender_accounts'],
      // Étapes illisibles : celles déjà lues restent (l'éditeur relit les siennes à l'ouverture).
      steps: stepsRes.error ? prev[0]?.steps ?? [] : stepsRes.data ?? [],
      enrollments: stats.get(sequenceId) ?? emptyBreakdown(),
    }]);
    setCountsError(!!countsRes.error);
    setState('ready');
  }, [sequenceId, organizationId]);

  useEffect(() => {
    setState('loading');
    void fetchSequence();
    // Retour sur l'onglet du navigateur : les compteurs suivent les envois du moteur.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchSequence();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchSequence]);

  return { sequence: sequences[0] ?? null, sequences, setSequences, state, countsError, fetchSequence };
}

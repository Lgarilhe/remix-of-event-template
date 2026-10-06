// Écran Séquences de l'organisation (lot 5c-2) : séquences de l'organisation,
// leurs étapes et leurs compteurs d'inscriptions (mêmes lectures que la liste
// des séquences d'une mission), puis, à part, les chiffres du tableau :
// invitations envoyées et acceptées, candidats contactés, membres qui ont
// inscrit des candidats. Lectures sous la RLS de la personne connectée, aucun
// appel serveur nouveau.
//
// Une lecture secondaire en échec ne vide rien : la colonne concernée affiche
// « - » (infobulle « Indisponible »), jamais un zéro inventé.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import type { SequenceWithStats } from '@/lib/sequenceActions';
import { SENT_EXECUTION_STATUSES } from '@/lib/sequenceErrorMessages';
import {
  aggregateContacts,
  aggregateEnrollmentCounts,
  aggregateInvites,
  emptyBreakdown,
  type ContactStats,
} from '@/lib/sequenceTableStats';

// L'API renvoie au plus 1 000 lignes par requête : toutes les pages sont lues.
const API_PAGE_SIZE = 1000;
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += API_PAGE_SIZE) {
    const { data, error } = await page(from, from + API_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < API_PAGE_SIZE) return rows;
  }
}

export interface SequenceTableExtras {
  invites: Map<string, { sent: number; accepted: number }>;
  contacts: Map<string, ContactStats>;
}

export type ExtrasState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: SequenceTableExtras };

export function useOrgSequences() {
  const { organizationId } = useOrganization();
  const [sequences, setSequences] = useState<SequenceWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadErrorDetail, setLoadErrorDetail] = useState<string | null>(null);
  // Étapes (éditeur, modèles) ou compteurs (« – ») illisibles.
  const [detailError, setDetailError] = useState<{ steps: boolean; counts: boolean }>({ steps: false, counts: false });
  const [extras, setExtras] = useState<ExtrasState>({ status: 'loading' });

  const fetchExtras = useCallback(async (sequenceIds: string[]) => {
    if (sequenceIds.length === 0) {
      setExtras({ status: 'ready', value: { invites: new Map(), contacts: new Map() } });
      return;
    }
    try {
      const [analyticsRows, contactRows] = await Promise.all([
        fetchAllPages((from, to) => supabase
          .from('sequence_analytics')
          .select('sequence_id, invites_sent, invites_accepted')
          .in('sequence_id', sequenceIds)
          .order('id', { ascending: true })
          .range(from, to)),
        // Une ligne par inscription, avec au plus une étape envoyée : contacté
        // ou non, et qui l'a inscrite (compte LinkedIn d'envoi par défaut).
        fetchAllPages((from, to) => supabase
          .from('sequence_enrollments')
          .select('sequence_id, created_by, status, sent:sequence_step_executions(id)')
          .in('sequence_id', sequenceIds)
          .in('sent.status', [...SENT_EXECUTION_STATUSES])
          .limit(1, { referencedTable: 'sent' })
          .order('id', { ascending: true })
          .range(from, to)),
      ]);
      setExtras({
        status: 'ready',
        value: { invites: aggregateInvites(analyticsRows), contacts: aggregateContacts(contactRows) },
      });
    } catch (err) {
      console.error('Error fetching sequence table figures:', err);
      setExtras({ status: 'error' });
    }
  }, []);

  const fetchSequences = useCallback(async () => {
    if (!organizationId) return;
    try {
      const { data: seqData, error: seqError } = await supabase
        .from('outreach_sequences')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
      if (seqError) throw seqError;

      const sequenceIds: string[] = (seqData || []).map(s => s.id);
      const [stepsResult, countsResult] = await Promise.allSettled([
        sequenceIds.length === 0 ? Promise.resolve([]) : fetchAllPages((from, to) => supabase
          .from('sequence_steps')
          .select('*')
          .in('sequence_id', sequenceIds)
          .order('step_order', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)),
        sequenceIds.length === 0 ? Promise.resolve([]) : fetchAllPages((from, to) => supabase
          .rpc('get_sequence_enrollment_counts', { p_sequence_ids: sequenceIds })
          .order('sequence_id', { ascending: true })
          .order('status', { ascending: true })
          .order('pause_reason', { ascending: true })
          .range(from, to)),
      ]);
      if (stepsResult.status === 'rejected') console.error('Error fetching sequence steps:', stepsResult.reason);
      if (countsResult.status === 'rejected') console.error('Error fetching enrollment counts:', countsResult.reason);
      const stepsData = stepsResult.status === 'fulfilled' ? stepsResult.value : [];
      const statsBySequence = aggregateEnrollmentCounts(countsResult.status === 'fulfilled' ? countsResult.value : []);

      setSequences((seqData || []).map((seq) => ({
        ...seq,
        // Colonnes json : relues telles quelles par l'éditeur et la duplication.
        stop_conditions: seq.stop_conditions as unknown as SequenceWithStats['stop_conditions'],
        sender_accounts: seq.sender_accounts as unknown as SequenceWithStats['sender_accounts'],
        steps: stepsData.filter(s => s.sequence_id === seq.id),
        enrollments: statsBySequence.get(seq.id) ?? emptyBreakdown(),
      })));
      setLoadError(false);
      setLoadErrorDetail(null);
      setDetailError({ steps: stepsResult.status === 'rejected', counts: countsResult.status === 'rejected' });
      void fetchExtras(sequenceIds);
    } catch (err) {
      console.error('Error fetching organization sequences:', err);
      setLoadError(true);
      setLoadErrorDetail(err instanceof Error ? err.message : (err as { message?: string } | null)?.message ?? null);
    } finally {
      setLoading(false);
    }
  }, [organizationId, fetchExtras]);

  useEffect(() => {
    void fetchSequences();
    // Retour sur l'onglet du navigateur : les compteurs suivent les envois du moteur.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchSequences();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchSequences]);

  return { sequences, setSequences, loading, loadError, loadErrorDetail, detailError, extras, fetchSequences };
}

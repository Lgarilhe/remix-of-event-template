// Onglet « Candidats » de la page d'une séquence (lot 5c-2) : inscriptions de
// la séquence, filtrées par puce et par recherche dans la requête, paginées par
// curseur sur (created_at, id) : une pause ou un arrêt qui fait sortir une
// ligne du filtre ne décale pas la page suivante. Avec leurs exécutions et le
// lien de la conversation d'un candidat qui a répondu. Mêmes lectures que le suivi des inscrits (SequenceEnrollmentsPanel),
// sous la RLS de la personne connectée : un collaborateur ne lit que ses
// inscriptions, sauf sur une séquence dont il est l'auteur.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { EXECUTION_PAGE_SIZE, type Enrollment, type StepExecution } from '@/lib/sequenceActions';
import { chipFilter, type EnrollmentChip } from '@/lib/enrollmentStatusLine';
import { enrollmentCursorFilter, nextEnrollmentCursor, type EnrollmentCursor } from '@/lib/journalCursor';

/** Étape de la séquence telle que la lit l'onglet (parcours, statut). */
export interface DetailStep {
  id: string;
  step_order: number;
  action_type: string;
  message_template: string | null;
  subject_template: string | null;
  timeout_days?: number | null;
  wait_for_event?: string | null;
  variant_group?: string | null;
  delay_days?: number | null;
  delay_hours?: number | null;
  delay_minutes?: number | null;
}

export type DetailExecution = StepExecution & {
  step?: StepExecution['step'] & { timeout_days?: number | null; wait_for_event?: string | null };
};

export type DetailEnrollment = Enrollment & {
  updated_at?: string | null;
  completed_at?: string | null;
  account_id?: string | null;
  executions?: DetailExecution[];
};

export const ENROLLMENT_PAGE_SIZE = 100;
// Exécutions lues par lots d'inscriptions (limite de 1 000 lignes de l'API).
const EXECUTION_BATCH_SIZE = 50;

/** Recherche sans les caractères réservés des filtres de l'API. */
const searchTerm = (query: string) => query.replace(/[%_,()"\\*.:]/g, ' ').trim();

export function useSequenceEnrollments(
  sequenceId: string | null,
  steps: readonly DetailStep[],
  options: { chip: EnrollmentChip; query: string },
) {
  const [enrollments, setEnrollments] = useState<DetailEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<EnrollmentCursor | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chatByEnrollment, setChatByEnrollment] = useState<Map<string, string>>(new Map());
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  // Une réponse arrivée après un changement de filtre est ignorée.
  const requestRef = useRef(0);

  const fetchExecutionsFor = async (enrollmentIds: string[]) => {
    const batches: string[][] = [];
    for (let i = 0; i < enrollmentIds.length; i += EXECUTION_BATCH_SIZE) batches.push(enrollmentIds.slice(i, i + EXECUTION_BATCH_SIZE));
    const perBatch = await Promise.all(batches.map(async (batch) => {
      const rows: Tables<'sequence_step_executions'>[] = [];
      for (let from = 0; ; from += EXECUTION_PAGE_SIZE) {
        const { data, error } = await supabase
          .from('sequence_step_executions')
          .select('*')
          .in('enrollment_id', batch)
          .order('step_order', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + EXECUTION_PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < EXECUTION_PAGE_SIZE) break;
      }
      return rows;
    }));
    return perBatch.flat();
  };

  /** Conversation d'un candidat qui a répondu (liens de la mission, lot 0b). */
  const fetchChats = async (rows: DetailEnrollment[]) => {
    const ids = rows.filter((e) => e.status === 'replied' || e.status === 'stopped').map((e) => e.id);
    if (ids.length === 0) return new Map<string, string>();
    const { data, error } = await supabase
      .from('mission_conversations')
      .select('enrollment_id, chat_id')
      .in('enrollment_id', ids)
      .not('chat_id', 'is', null);
    if (error) {
      console.warn('[useSequenceEnrollments] conversations indisponibles:', error);
      return new Map<string, string>();
    }
    return new Map((data ?? []).filter((r) => r.enrollment_id && r.chat_id).map((r) => [r.enrollment_id as string, r.chat_id as string]));
  };

  const load = useCallback(async (after: EnrollmentCursor | null) => {
    const append = after !== null;
    if (!sequenceId) return;
    const request = ++requestRef.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const filter = chipFilter(options.chip);
      let query = supabase
        .from('sequence_enrollments')
        .select('*')
        .eq('sequence_id', sequenceId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(ENROLLMENT_PAGE_SIZE);
      // Page suivante : après la dernière ligne lue par le serveur, pas après N lignes affichées.
      if (after) query = query.or(enrollmentCursorFilter(after));
      if (filter.statuses) query = query.in('status', filter.statuses);
      if (filter.pauseReasonsIn) query = query.in('pause_reason', filter.pauseReasonsIn);
      // Pause sans raison : manuelle (même lecture que les compteurs).
      if (filter.pauseReasonsNotIn) query = query.or(`pause_reason.is.null,pause_reason.not.in.(${filter.pauseReasonsNotIn.join(',')})`);
      const term = searchTerm(options.query);
      if (term) query = query.or(`profile_name.ilike.*${term}*,profile_headline.ilike.*${term}*`);

      const { data, error } = await query;
      if (error) throw error;
      const rows = data ?? [];
      const executions = await fetchExecutionsFor(rows.map((e) => e.id));
      const stepById = new Map(stepsRef.current.map((s) => [s.id, s]));
      const enriched: DetailEnrollment[] = rows.map((enrollment) => ({
        ...enrollment,
        executions: executions
          .filter((e) => e.enrollment_id === enrollment.id)
          .map((exec) => {
            const step = stepById.get(exec.step_id);
            return {
              ...exec,
              step: step
                ? {
                    action_type: step.action_type,
                    message_template: step.message_template,
                    subject_template: step.subject_template,
                    timeout_days: step.timeout_days ?? null,
                    wait_for_event: step.wait_for_event ?? null,
                  }
                : undefined,
            };
          }),
      }));
      const chats = await fetchChats(enriched);
      if (request !== requestRef.current) return;
      setEnrollments((prev) => (append ? [...prev, ...enriched.filter((e) => !prev.some((p) => p.id === e.id))] : enriched));
      setChatByEnrollment((prev) => (append ? new Map([...prev, ...chats]) : chats));
      setCursor(nextEnrollmentCursor(rows, ENROLLMENT_PAGE_SIZE));
      setLoadError(null);
    } catch (err) {
      console.error('Error fetching enrollments:', err);
      if (request !== requestRef.current) return;
      if (!append) setLoadError(err instanceof Error ? err.message : (err as { message?: string } | null)?.message ?? 'Erreur inconnue');
    } finally {
      if (request === requestRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [sequenceId, options.chip, options.query]);

  const reload = useCallback(() => load(null), [load]);
  const loadMore = () => (cursor ? load(cursor) : Promise.resolve());
  const hasMore = cursor !== null;

  useEffect(() => {
    void reload();
  }, [reload]);

  return { enrollments, setEnrollments, loading, loadingMore, hasMore, loadError, chatByEnrollment, reload, loadMore };
}

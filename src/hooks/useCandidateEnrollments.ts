/**
 * useCandidateEnrollments — fetch toutes les inscriptions séquence d'un
 * candidat (cross-séquences) avec actions de contrôle.
 *
 * Pourquoi un hook dédié vs réutilisation de SequenceEnrollmentsPanel :
 *   - SequenceEnrollmentsPanel est ORIENTÉ SÉQUENCE (toutes les inscriptions
 *     d'UNE séquence). Ici on veut l'inverse : toutes les séquences d'UN
 *     candidat. Schéma de query opposé.
 *   - Hook réutilisable depuis CandidateDetailModal, Inbox, et future surface.
 *
 * Source single de vérité pour stop/resume/skip : la même logique que
 * SequenceEnrollmentsPanel pour rester cohérent (paused + cancel
 * scheduled executions).
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CandidateEnrollmentStepExecution {
  id: string;
  step_id: string;
  step_order: number;
  status: string;
  scheduled_at: string;
  executed_at: string | null;
  final_subject: string | null;
  final_message: string | null;
  error_message: string | null;
  skip_reason: string | null;
  step?: {
    action_type: string;
    message_template: string | null;
    subject_template: string | null;
  };
}

export interface CandidateEnrollment {
  id: string;
  sequence_id: string;
  sequence_name: string | null;
  status: string; // 'active' | 'paused' | 'replied' | 'completed' | 'stopped'
  pause_reason: string | null;
  current_step_order: number;
  created_at: string;
  replied_at: string | null;
  connection_status: string | null;
  job_id: string | null;
  job_title: string | null;
  total_steps: number;
  next_scheduled_at: string | null; // prochaine action prévue
  next_step_action_type: string | null;
  executions: CandidateEnrollmentStepExecution[];
}

interface UseCandidateEnrollmentsOptions {
  /** profile_id du candidat (LinkedIn provider_id ou ID interne). */
  profileId: string | null | undefined;
  /** Si false, n'effectue pas le fetch (économie de calls). */
  enabled?: boolean;
}

export function useCandidateEnrollments({ profileId, enabled = true }: UseCandidateEnrollmentsOptions) {
  const [enrollments, setEnrollments] = useState<CandidateEnrollment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEnrollments = useCallback(async () => {
    if (!profileId || !enabled) {
      setEnrollments([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Fetch enrollments avec sequence info + executions imbriquées.
      // On utilise un join Supabase via le shorthand FK.
      const { data, error } = await supabase
        .from('sequence_enrollments')
        .select(`
          id, sequence_id, status, pause_reason, current_step_order, created_at,
          replied_at, connection_status, job_id, job_title,
          outreach_sequences (id, name),
          sequence_step_executions (
            id, step_id, step_order, status, scheduled_at, executed_at,
            final_subject, final_message, error_message, skip_reason,
            sequence_steps (action_type, message_template, subject_template)
          )
        `)
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Compte total des steps par séquence (pour afficher "Étape 3 / 7").
      const sequenceIds = Array.from(new Set((data || []).map((e: any) => e.sequence_id)));
      const totalsBySeq: Record<string, number> = {};
      if (sequenceIds.length > 0) {
        const { data: stepsCount } = await supabase
          .from('sequence_steps')
          .select('sequence_id, id')
          .in('sequence_id', sequenceIds);
        for (const s of stepsCount || []) {
          totalsBySeq[s.sequence_id] = (totalsBySeq[s.sequence_id] || 0) + 1;
        }
      }

      const mapped: CandidateEnrollment[] = (data || []).map((e: any) => {
        const execs = (e.sequence_step_executions || []) as any[];
        // Normalise les step relations (Supabase nested select renvoie objet ou tableau selon FK)
        const normalizedExecs: CandidateEnrollmentStepExecution[] = execs
          .map(ex => ({
            id: ex.id,
            step_id: ex.step_id,
            step_order: ex.step_order,
            status: ex.status,
            scheduled_at: ex.scheduled_at,
            executed_at: ex.executed_at,
            final_subject: ex.final_subject,
            final_message: ex.final_message,
            error_message: ex.error_message,
            skip_reason: ex.skip_reason,
            step: ex.sequence_steps
              ? {
                  action_type: ex.sequence_steps.action_type,
                  message_template: ex.sequence_steps.message_template,
                  subject_template: ex.sequence_steps.subject_template,
                }
              : undefined,
          }))
          .sort((a, b) => a.step_order - b.step_order);

        // Prochaine action prévue : 1ère execution avec status='scheduled'
        // dans le futur (ou maintenant), trié par scheduled_at.
        const nextExec = normalizedExecs
          .filter(x => x.status === 'scheduled')
          .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];

        return {
          id: e.id,
          sequence_id: e.sequence_id,
          sequence_name: e.outreach_sequences?.name || null,
          status: e.status,
          pause_reason: e.pause_reason ?? null,
          current_step_order: e.current_step_order ?? 0,
          created_at: e.created_at,
          replied_at: e.replied_at,
          connection_status: e.connection_status,
          job_id: e.job_id,
          job_title: e.job_title,
          total_steps: totalsBySeq[e.sequence_id] || normalizedExecs.length || 0,
          next_scheduled_at: nextExec?.scheduled_at || null,
          next_step_action_type: nextExec?.step?.action_type || null,
          executions: normalizedExecs,
        };
      });

      setEnrollments(mapped);
    } catch (err: any) {
      console.error('[useCandidateEnrollments] fetch error:', err);
      setError(err?.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [profileId, enabled]);

  useEffect(() => {
    fetchEnrollments();
  }, [fetchEnrollments]);

  /**
   * Stoppe une inscription (status → 'paused' + cancel des executions
   * schedulées). Même logique que SequenceEnrollmentsPanel.stopEnrollment.
   */
  const stop = useCallback(async (enrollmentId: string): Promise<boolean> => {
    try {
      const { error: enrollError } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'paused' })
        .eq('id', enrollmentId);
      if (enrollError) throw enrollError;

      await supabase
        .from('sequence_step_executions')
        .update({ status: 'cancelled', skip_reason: 'Arrêt manuel' })
        .eq('enrollment_id', enrollmentId)
        .eq('status', 'scheduled');

      setEnrollments(prev =>
        prev.map(e => e.id === enrollmentId ? { ...e, status: 'paused', next_scheduled_at: null } : e)
      );
      toast.success('Séquence arrêtée');
      return true;
    } catch (err) {
      console.error('[useCandidateEnrollments] stop error:', err);
      toast.error("Erreur lors de l'arrêt");
      return false;
    }
  }, []);

  /**
   * Reprend une inscription paused : status → 'active' + re-schedule
   * la 1ère execution cancellée à T+1min.
   */
  const resume = useCallback(async (enrollmentId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'active', pause_reason: null })
        .eq('id', enrollmentId);
      if (error) throw error;

      const target = enrollments.find(e => e.id === enrollmentId);
      if (target) {
        const cancelledExecs = target.executions
          .filter(e => e.status === 'cancelled')
          .sort((a, b) => a.step_order - b.step_order);
        if (cancelledExecs.length > 0) {
          const nextExec = cancelledExecs[0];
          const scheduledAt = new Date();
          scheduledAt.setMinutes(scheduledAt.getMinutes() + 1);
          await supabase
            .from('sequence_step_executions')
            .update({
              status: 'scheduled',
              skip_reason: null,
              scheduled_at: scheduledAt.toISOString(),
            })
            .eq('id', nextExec.id);
        }
      }

      toast.success('Séquence reprise');
      await fetchEnrollments(); // refresh complet
      return true;
    } catch (err) {
      console.error('[useCandidateEnrollments] resume error:', err);
      toast.error('Erreur lors de la reprise');
      return false;
    }
  }, [enrollments, fetchEnrollments]);

  /**
   * Marque une inscription comme répondue (utile si réponse hors LinkedIn,
   * ou pour stopper proprement après avoir pris la conversation à la main).
   */
  const markReplied = useCallback(async (enrollmentId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'replied', replied_at: new Date().toISOString() })
        .eq('id', enrollmentId);
      if (error) throw error;

      await supabase
        .from('sequence_step_executions')
        .update({ status: 'cancelled', skip_reason: 'Marqué comme répondu' })
        .eq('enrollment_id', enrollmentId)
        .eq('status', 'scheduled');

      setEnrollments(prev =>
        prev.map(e => e.id === enrollmentId ? {
          ...e,
          status: 'replied',
          replied_at: new Date().toISOString(),
          next_scheduled_at: null,
        } : e)
      );
      toast.success('Marqué comme répondu — séquence stoppée');
      return true;
    } catch (err) {
      console.error('[useCandidateEnrollments] markReplied error:', err);
      toast.error('Erreur');
      return false;
    }
  }, []);

  return {
    enrollments,
    loading,
    error,
    refetch: fetchEnrollments,
    stop,
    resume,
    markReplied,
  };
}

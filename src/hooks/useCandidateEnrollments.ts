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
 * Mettre en pause = statut 'paused' + pause_reason 'manual', sans toucher aux
 * étapes prévues (le moteur les ignore tant que l'inscription n'est pas
 * active). Reprendre et marquer comme répondu passent par les actions serveur
 * de process-sequences : le navigateur ne réécrit jamais une exécution.
 *
 * Lot 5b : la pause part sans fenêtre, avec « Annuler » dans un toast (reprise
 * serveur resume_enrollments) ; « Arrêter pour ce candidat » passe par
 * stop_enrollments et « Relancer la séquence » par re_enroll
 * (useUndoableEnrollmentAction).
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import {
  isGdprErasedEnrollment,
  isSentExecutionStatus,
  pauseToastTitle,
  summarizeResumeResponse,
  type ResumeResponse,
} from '@/lib/sequenceErrorMessages';
import { toast } from 'sonner';
import { useUndoableEnrollmentAction } from '@/hooks/useUndoableEnrollmentAction';
import { isManualStopTrace, readManualStop, type ManualStopInfo } from '@/lib/sequenceLabels';

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
  /** Séquence active (is_active) ; null si la lecture ne l'a pas donné. */
  sequence_active: boolean | null;
  /** Nom du candidat, pour les confirmations et les messages. */
  profile_name: string | null;
  /** Membre qui a inscrit le candidat : un collaborateur n'agit que sur ses propres inscriptions. */
  created_by: string | null;
  status: string; // 'active' | 'paused' | 'replied' | 'completed' | 'stopped'
  pause_reason: string | null;
  current_step_order: number;
  created_at: string;
  replied_at: string | null;
  connection_status: string | null;
  job_id: string | null;
  job_title: string | null;
  /** Actions réellement parties chez le candidat (envoyé, ouvert, cliqué, répondu). */
  sent_count: number;
  next_scheduled_at: string | null; // prochaine action prévue
  next_step_action_type: string | null;
  /** D5 : effacement RGPD demandé, l'inscription ne peut plus être reprise ni relancée. */
  gdpr_erased: boolean;
  /** Lot 5b : arrêt manuel (« Arrêtée par … le … »), null pour toute autre inscription. */
  manual_stop: ManualStopInfo | null;
  /** Lot 5b : trace d'un arrêt manuel, quel que soit le statut (motif « Arrêt manuel » lu comme un arrêt). */
  stopped_manually: boolean;
  executions: CandidateEnrollmentStepExecution[];
}

interface UseCandidateEnrollmentsOptions {
  /** profile_id du candidat (LinkedIn provider_id ou ID interne). */
  profileId: string | null | undefined;
  /** Si false, n'effectue pas le fetch (économie de calls). */
  enabled?: boolean;
}

type StepRelation = { action_type: string; message_template: string | null; subject_template: string | null };
type SequenceRelation = { id: string; name: string; is_active: boolean | null };

interface EnrollmentRow {
  id: string;
  sequence_id: string;
  status: string;
  profile_name: string | null;
  created_by: string | null;
  pause_reason: string | null;
  current_step_order: number | null;
  created_at: string;
  replied_at: string | null;
  connection_status: string | null;
  job_id: string | null;
  job_title: string | null;
  /** tracking_data.gdpr_erased_at seul (tracking_data peut être lourd). */
  gdpr_erased_at: unknown;
  /** Lot 5b : raison de fin et trace d'un arrêt manuel. */
  completion_reason: unknown;
  manual_stop: unknown;
  outreach_sequences: SequenceRelation | SequenceRelation[] | null;
  sequence_step_executions: Array<{
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
    sequence_steps: StepRelation | StepRelation[] | null;
  }> | null;
}

/** Relation imbriquée : objet ou tableau selon la façon dont la clé étrangère est lue. */
const one = <T,>(rel: T | T[] | null | undefined): T | null => (Array.isArray(rel) ? rel[0] ?? null : rel ?? null);

export function useCandidateEnrollments({ profileId, enabled = true }: UseCandidateEnrollmentsOptions) {
  const [enrollments, setEnrollments] = useState<CandidateEnrollment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Inscription dont une action est en cours : ses boutons sont désactivés. */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { offerUndoPause, stopEnrollments } = useUndoableEnrollmentAction();

  const fetchEnrollments = useCallback(async () => {
    if (!profileId || !enabled) {
      setEnrollments([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Fetch enrollments avec sequence info + executions imbriquées.
      // On utilise un join Supabase via le shorthand FK. Type de ligne donné
      // explicitement : le chemin JSON (tracking_data->…) rend l'inférence
      // de la requête trop profonde pour TypeScript.
      const { data, error } = await supabase
        .from('sequence_enrollments')
        .select<string, EnrollmentRow>(`
          id, sequence_id, status, profile_name, created_by, pause_reason, current_step_order, created_at,
          replied_at, connection_status, job_id, job_title,
          gdpr_erased_at:tracking_data->gdpr_erased_at,
          completion_reason:tracking_data->>completion_reason,
          manual_stop:tracking_data->manual_stop,
          outreach_sequences (id, name, is_active),
          sequence_step_executions (
            id, step_id, step_order, status, scheduled_at, executed_at,
            final_subject, final_message, error_message, skip_reason,
            sequence_steps (action_type, message_template, subject_template)
          )
        `)
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = (data || []) as unknown as EnrollmentRow[];
      const mapped: CandidateEnrollment[] = rows.map((e) => {
        const normalizedExecs: CandidateEnrollmentStepExecution[] = (e.sequence_step_executions || [])
          .map(ex => {
            const step = one(ex.sequence_steps);
            return {
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
              step: step
                ? {
                    action_type: step.action_type,
                    message_template: step.message_template,
                    subject_template: step.subject_template,
                  }
                : undefined,
            };
          })
          .sort((a, b) => a.step_order - b.step_order);

        // Prochaine action prévue : 1ère execution avec status='scheduled'
        // dans le futur (ou maintenant), trié par scheduled_at.
        const nextExec = normalizedExecs
          .filter(x => x.status === 'scheduled')
          .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];

        const sequence = one(e.outreach_sequences);
        return {
          id: e.id,
          sequence_id: e.sequence_id,
          sequence_name: sequence?.name || null,
          sequence_active: typeof sequence?.is_active === 'boolean' ? sequence.is_active : null,
          profile_name: e.profile_name ?? null,
          created_by: e.created_by ?? null,
          status: e.status,
          pause_reason: e.pause_reason ?? null,
          current_step_order: e.current_step_order ?? 0,
          created_at: e.created_at,
          replied_at: e.replied_at,
          connection_status: e.connection_status,
          job_id: e.job_id,
          job_title: e.job_title,
          sent_count: normalizedExecs.filter(x => isSentExecutionStatus(x.status)).length,
          next_scheduled_at: nextExec?.scheduled_at || null,
          next_step_action_type: nextExec?.step?.action_type || null,
          gdpr_erased: isGdprErasedEnrollment(e.gdpr_erased_at, normalizedExecs),
          manual_stop: readManualStop(e.status, e.completion_reason, e.manual_stop),
          stopped_manually: isManualStopTrace(e.manual_stop),
          executions: normalizedExecs,
        };
      });

      setEnrollments(mapped);
    } catch (err) {
      console.error('[useCandidateEnrollments] fetch error:', err);
      setError('Impossible de charger les séquences de ce candidat. Vérifiez votre connexion puis réessayez.');
    } finally {
      setLoading(false);
    }
  }, [profileId, enabled]);

  useEffect(() => {
    fetchEnrollments();
  }, [fetchEnrollments]);

  /**
   * Met une inscription en pause (status 'paused', pause_reason 'manual'),
   * sans fenêtre. Les étapes prévues gardent leur date : le moteur n'envoie
   * rien tant que l'inscription n'est pas reprise. « Annuler » du toast la
   * reprend par l'action serveur resume_enrollments.
   */
  const stop = useCallback(async (enrollmentId: string): Promise<boolean> => {
    const name = enrollments.find(e => e.id === enrollmentId)?.profile_name || null;
    setPendingId(enrollmentId);
    try {
      const { data, error: enrollError } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'paused', pause_reason: 'manual', updated_at: new Date().toISOString() })
        .eq('id', enrollmentId)
        .eq('status', 'active')
        .select('id');
      if (enrollError) throw enrollError;

      if (!data || data.length === 0) {
        // Refus des droits ou inscription déjà sortie de l'état « en cours ».
        toast.error("Cette séquence n'a pas pu être mise en pause : elle n'est plus en cours pour ce candidat.");
        await fetchEnrollments();
        return false;
      }

      setEnrollments(prev =>
        prev.map(e => e.id === enrollmentId ? { ...e, status: 'paused', pause_reason: 'manual' } : e)
      );
      offerUndoPause({
        title: pauseToastTitle(name),
        enrollmentIds: data.map(row => row.id),
        candidateName: name,
        onSettled: () => fetchEnrollments(),
      });
      return true;
    } catch (err) {
      console.error('[useCandidateEnrollments] stop error:', err);
      toast.error('La mise en pause a échoué. Réessayez.');
      return false;
    } finally {
      setPendingId(null);
    }
  }, [enrollments, fetchEnrollments, offerUndoPause]);

  /**
   * « Arrêter pour ce candidat » (lot 5b) : clôture serveur (stop_enrollments),
   * sans fenêtre, avec « Annuler » pendant que le toast est affiché.
   */
  const manualStop = useCallback(async (enrollmentId: string): Promise<boolean> => {
    const name = enrollments.find(e => e.id === enrollmentId)?.profile_name || null;
    setPendingId(enrollmentId);
    try {
      const summary = await stopEnrollments({
        enrollmentIds: [enrollmentId],
        candidateName: name,
        onSettled: () => fetchEnrollments(),
      });
      return summary.stoppedIds.length > 0;
    } finally {
      setPendingId(null);
    }
  }, [enrollments, fetchEnrollments, stopEnrollments]);

  /**
   * « Relancer la séquence » après un arrêt manuel : action serveur re_enroll,
   * qui réarme l'étape annulée par l'arrêt (ou programme la suivante).
   */
  const reEnroll = useCallback(async (enrollmentId: string): Promise<boolean> => {
    const name = enrollments.find(e => e.id === enrollmentId)?.profile_name || 'ce candidat';
    setPendingId(enrollmentId);
    try {
      const { data, error } = await invokeEdgeFunction<ResumeResponse>('process-sequences', {
        action: 're_enroll',
        enrollment_ids: [enrollmentId],
      });
      const result = data?.results?.find(r => r.enrollment_id === enrollmentId);
      if (error || !data?.success || !result) {
        toast.error(`La séquence n’a pas pu être relancée pour ${name}`, {
          description: data?.message || error?.message || 'Réessayez dans un instant.',
        });
        return false;
      }
      // Mêmes messages que le suivi des inscrits (SequenceEnrollmentsPanel).
      if (result.outcome === 'resumed') {
        toast.success(`Séquence relancée pour ${name}`, {
          description: 'La prochaine action est programmée selon les délais de la séquence, pendant vos heures d’envoi.',
        });
      } else if (result.outcome === 'nothing_to_resume') {
        toast.info(`Rien à relancer : cette séquence est terminée pour ${name}`);
      } else if (result.outcome === 'account_unlinked') {
        toast.error('Ce compte LinkedIn n’est plus relié. Reliez-le avant de relancer la séquence.');
      } else {
        toast.error(`La séquence n’a pas pu être relancée pour ${name}`, { description: result.message });
      }
      return result.outcome === 'resumed';
    } catch (err) {
      console.error('[useCandidateEnrollments] reEnroll error:', err);
      toast.error(`La séquence n’a pas pu être relancée pour ${name}`);
      return false;
    } finally {
      setPendingId(null);
      await fetchEnrollments();
    }
  }, [enrollments, fetchEnrollments]);

  /**
   * Reprend une inscription en pause par l'action serveur resume_enrollments :
   * elle garde l'étape prévue (date = max(date prévue, maintenant + 1 min)),
   * refuse un compte LinkedIn qui n'est plus relié et renvoie le résultat réel.
   */
  const resume = useCallback(async (enrollmentId: string): Promise<boolean> => {
    setPendingId(enrollmentId);
    try {
      const { data, error } = await invokeEdgeFunction<ResumeResponse>('process-sequences', {
        action: 'resume_enrollments',
        enrollment_ids: [enrollmentId],
      });
      const summary = summarizeResumeResponse(
        error ? { success: false, message: data?.message || error.message } : data,
      );
      if (summary.tone === 'success') toast.success(summary.message);
      else if (summary.tone === 'info') toast.info(summary.message);
      else toast.error(summary.message);
      await fetchEnrollments(); // refresh complet
      return summary.resumed > 0;
    } catch (err) {
      console.error('[useCandidateEnrollments] resume error:', err);
      toast.error('La reprise a échoué. Réessayez.');
      return false;
    } finally {
      setPendingId(null);
    }
  }, [fetchEnrollments]);

  /**
   * Marque une inscription comme répondue (utile si réponse hors LinkedIn,
   * ou pour arrêter proprement après avoir pris la conversation à la main).
   * L'action serveur mark_replied clôt l'inscription comme une réponse
   * détectée : étapes en attente annulées, pipeline de la mission et compteur
   * de réponses mis à jour.
   */
  const markReplied = useCallback(async (enrollmentId: string): Promise<boolean> => {
    // Mêmes messages que le suivi des inscrits (SequenceEnrollmentsPanel).
    const name = enrollments.find(e => e.id === enrollmentId)?.profile_name || 'ce candidat';
    setPendingId(enrollmentId);
    try {
      const { data, error } = await invokeEdgeFunction<{ changed?: boolean; message?: string; warning?: string; stopped_siblings?: number }>('process-sequences', {
        action: 'mark_replied',
        enrollment_id: enrollmentId,
      });
      if (error || !data?.success) {
        toast.error(`La réponse n’a pas pu être enregistrée pour ${name}`, {
          description: data?.message || error?.message || 'Réessayez dans un instant.',
        });
        return false;
      }
      // Contrat §8 : les autres inscriptions du candidat sont arrêtées comme
      // pour une réponse détectée ; le bilan le dit.
      const siblings = typeof data.stopped_siblings === 'number' ? data.stopped_siblings : 0;
      const siblingsNotice = siblings > 0
        ? ` ${siblings > 1 ? `Ses ${siblings} autres séquences en cours ou en pause ont été arrêtées.` : 'Son autre séquence en cours ou en pause a été arrêtée.'}`
        : '';
      if (data.changed && data.warning) {
        toast.warning(`Réponse enregistrée pour ${name}`, { description: `${data.warning}${siblingsNotice}` });
      } else if (data.changed) {
        toast.success(`Réponse enregistrée pour ${name}`, {
          description: `Les étapes restantes ont été annulées.${siblingsNotice}`,
        });
      } else {
        toast.info(`Rien n’a changé : la séquence de ${name} était déjà close.`);
      }
      await fetchEnrollments();
      return !!data.changed;
    } catch (err) {
      console.error('[useCandidateEnrollments] markReplied error:', err);
      toast.error(`La réponse n’a pas pu être enregistrée pour ${name}`, {
        description: err instanceof Error ? err.message : undefined,
      });
      return false;
    } finally {
      setPendingId(null);
    }
  }, [enrollments, fetchEnrollments]);

  return {
    enrollments,
    loading,
    error,
    pendingId,
    refetch: fetchEnrollments,
    stop,
    manualStop,
    reEnroll,
    resume,
    markReplied,
  };
}

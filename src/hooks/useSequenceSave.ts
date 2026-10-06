// Enregistrement d'une séquence depuis l'éditeur : en-tête, puis étapes par la
// RPC save_sequence_steps. Sorti de SequencesList au lot 5c-1, à l'identique,
// pour que les pages Séquences enregistrent par le même chemin.

import type { MutableRefObject } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { actionTypeLabel } from '@/lib/sequenceErrorMessages';
import {
  DEFAULT_STOP_CONDITIONS,
  blockedStepsNotice,
  implicitWaitEvent,
  sequenceSaveError,
  shouldCreateInactiveForPlan,
  type EditorBaseStepIds,
} from '@/lib/sequenceActions';
import type { Sequence } from '@/types/sequence';

export const CONCURRENT_EDIT_MESSAGE = 'Cette séquence a été modifiée par un collègue depuis son ouverture. Rouvrez-la avant d’enregistrer.';

export interface SequenceSaveOptions {
  organizationId: string | null;
  projectId?: string | null;
  /** Faux quand l'offre n'autorise pas l'envoi : une nouvelle séquence est créée désactivée. */
  canSendSequences: boolean;
  /** Abonnement pas encore lu (décision 32) : une nouvelle séquence est créée désactivée. */
  planStateUnknown: boolean;
  editorBaseStepIdsRef: MutableRefObject<EditorBaseStepIds>;
  navigate: NavigateFunction;
  fetchSequences: () => Promise<void>;
  setShowBuilder: (open: boolean) => void;
  setEditingSequence: (sequence: Sequence | null) => void;
  /** Séquence créée par cet enregistrement (éditeur unique : la page passe sur son adresse). */
  onCreated?: (sequenceId: string) => void;
  /**
   * Annonce de la création à la place des messages ci-dessous (éditeur unique,
   * lot 5d-2). `inactiveForPlan` : créée inactive faute de droit d'envoi ou
   * d'abonnement lu. Sans elle, les messages de l'ancien éditeur.
   */
  announceCreated?: (outcome: { inactiveForPlan: boolean }) => void;
}

export function useSequenceSave({
  organizationId,
  projectId,
  canSendSequences,
  planStateUnknown,
  editorBaseStepIdsRef,
  navigate,
  fetchSequences,
  setShowBuilder,
  setEditingSequence,
  onCreated,
  announceCreated,
}: SequenceSaveOptions) {
  const handleSaveSequence = async (sequence: Sequence) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');
      if (!organizationId) throw new Error('Organisation introuvable : rechargez la page');

      // Payload de steps envoyé à la RPC transactionnelle `save_sequence_steps`.
      // On garde `id` = id CLIENT (= id DB pour un step existant, id généré pour
      // un nouveau) : la RPC s'en sert pour faire l'UPDATE in-place des steps
      // existants (préserve leurs exécutions planifiées) et pour remapper les
      // refs de branchement (if_true/false_goto, timeout_branch, next_step).
      const buildStepsPayload = () => sequence.steps.map(step => ({
        id: step.id,
        step_order: step.order,
        action_type: step.actionType,
        condition_type: step.conditionType,
        condition_value: step.conditionValue ?? null,
        delay_days: step.delayDays ?? 0,
        delay_hours: step.delayHours ?? 0,
        delay_minutes: step.delayMinutes ?? 0,
        preferred_hour_start: step.preferredHourStart ?? null,
        preferred_hour_end: step.preferredHourEnd ?? null,
        subject_template: step.subjectTemplate ?? null,
        message_template: step.messageTemplate ?? null,
        use_ai_personalization: step.useAiPersonalization ?? false,
        ai_tone: step.aiTone ?? null,
        timeout_days: step.timeoutDays ?? null,
        wait_for_event: implicitWaitEvent(step.actionType, step.waitForEvent),
        variant_group: step.variantGroup ?? null,
        variant_weight: step.variantWeight ?? 100,
        // '__end__' = sentinelle « Fin de séquence » du StepEditor : persistée
        // via ends_sequence (avant, elle devenait next_step_id=null = « auto »
        // et le moteur enchaînait quand même sur l'étape suivante).
        ends_sequence: step.nextStepId === '__end__',
        cc_emails: step.ccEmails ?? null,
        bcc_emails: step.bccEmails ?? null,
        include_unsubscribe: step.includeUnsubscribe ?? null,
        signature_id: step.signatureId ?? null,
        if_true_goto_step: step.ifTrueGotoStep ?? null,
        if_false_goto_step: step.ifFalseGotoStep ?? null,
        timeout_branch_step_id: step.timeoutBranchStepId ?? null,
        next_step_id: step.nextStepId === '__end__' ? null : (step.nextStepId ?? null),
      }));

      let targetSequenceId: string;
      // En-tête créé par cet enregistrement : supprimé si les étapes échouent,
      // sinon une séquence vide restait et le nouvel essai en créait une seconde.
      let createdSequenceId: string | null = null;
      // Type de chaque étape en base, par step_order : nomme une étape refusée
      // (STEP_HAS_HISTORY) que l'éditeur a renumérotée.
      const baseStepLabels = new Map<number, string>();
      // Sans droit d'envoi (plan gratuit) ou abonnement pas encore lu (décision 32),
      // une nouvelle séquence est créée désactivée.
      const createInactiveForPlan = shouldCreateInactiveForPlan(sequence, canSendSequences, planStateUnknown);

      if (sequence.id) {
        // Une étape en base que l'éditeur n'a jamais vue a été ajoutée par un
        // collègue depuis l'ouverture : la RPC la supprimerait, avec ses envois
        // prévus. On refuse avant toute écriture.
        const base = editorBaseStepIdsRef.current;
        const { data: currentSteps, error: currentStepsError } = await supabase
          .from('sequence_steps')
          .select('id, step_order, action_type')
          .eq('sequence_id', sequence.id);
        if (currentStepsError) {
          throw new Error('La séquence n’a pas pu être vérifiée avant l’enregistrement. Réessayez.');
        }
        const knownIds = base?.sequenceId === sequence.id ? base.stepIds : new Set<string>();
        if ((currentSteps || []).some(s => !knownIds.has(s.id))) {
          throw new Error(CONCURRENT_EDIT_MESSAGE);
        }
        for (const s of currentSteps || []) baseStepLabels.set(s.step_order, actionTypeLabel(s.action_type));

        // UPDATE de l'entête de séquence uniquement (les steps passent par la RPC).
        // is_active n'est pas réécrit : seul l'interrupteur de la liste l'écrit,
        // avec la mise en pause ou la reprise des candidats et le contrôle du
        // plan. L'éditeur renvoyait la valeur lue à l'ouverture, qui pouvait
        // éteindre l'interrupteur de candidats encore en cours d'envoi.
        const { error: updateError } = await supabase
          .from('outreach_sequences')
          .update({
            name: sequence.name,
            description: sequence.description,
            stop_conditions: sequence.stopConditions || null,
            sender_accounts: sequence.senderAccounts || null,
            rotation_mode: sequence.rotationMode || null,
            multi_sender_enabled: sequence.multiSenderEnabled || false,
          } as any)
          .eq('id', sequence.id);

        if (updateError) throw sequenceSaveError(updateError);
        targetSequenceId = sequence.id;
      } else {
        // CREATE de l'entête de séquence.
        const { data: newSeq, error: createError } = await supabase
          .from('outreach_sequences')
          .insert({
            name: sequence.name,
            description: sequence.description,
            is_active: sequence.isActive && !createInactiveForPlan,
            created_by: user.id,
            organization_id: organizationId,
            project_id: projectId || null,
            // Garde-fous et expéditeurs réglés dans l'éditeur : sans eux, le
            // moteur ignorait « Arrêter si un rendez-vous est pris » et la rotation.
            stop_conditions: sequence.stopConditions ?? DEFAULT_STOP_CONDITIONS,
            sender_accounts: sequence.senderAccounts || null,
            rotation_mode: sequence.rotationMode || null,
            multi_sender_enabled: sequence.multiSenderEnabled || false,
          } as any)
          .select()
          .single();

        if (createError) throw sequenceSaveError(createError);
        targetSequenceId = newSeq.id;
        createdSequenceId = newSeq.id;
      }

      // Sauvegarde transactionnelle des steps : UPDATE in-place des existants,
      // INSERT des nouveaux, DELETE des seuls steps réellement retirés. Ne
      // détruit PLUS les exécutions planifiées des enrollments actifs (bloquant B1).
      const { error: stepsError } = await supabase.rpc('save_sequence_steps', {
        p_sequence_id: targetSequenceId,
        p_steps: buildStepsPayload(),
      });

      if (stepsError) {
        if (createdSequenceId) {
          const { error: cleanupError } = await supabase
            .from('outreach_sequences')
            .delete()
            .eq('id', createdSequenceId);
          if (cleanupError) console.error('Error removing empty sequence after failed steps save:', cleanupError);
        }
        // Refus de supprimer une étape qui a un historique d'envoi (sinon ses
        // exécutions et son suivi e-mail disparaissaient, et une réponse à cet
        // e-mail n'était plus détectée).
        if (stepsError.hint === 'STEP_HAS_HISTORY' || stepsError.message?.includes('STEP_HAS_HISTORY')) {
          throw new Error(`Cette étape a déjà été envoyée à des candidats : elle ne peut pas être supprimée. Modifiez son contenu à la place.${blockedStepsNotice(stepsError.details, baseStepLabels)}`);
        }
        throw sequenceSaveError(stepsError);
      }

      if (sequence.id) {
        toast.success('Séquence mise à jour');
      } else if (announceCreated) {
        announceCreated({ inactiveForPlan: createInactiveForPlan });
      } else {
        // Étape suivante du parcours : inscrire des candidats depuis le Sourcing.
        const enrollAction = projectId
          ? { label: 'Inscrire des candidats', onClick: () => navigate(`/missions/${projectId}?tab=sourcing`) }
          : undefined;
        // Créée désactivée faute de droit d'envoi : l'éditeur (qui reçoit
        // canSendSequences) l'annonce avec le lien vers les offres.
        if (!createInactiveForPlan) {
          toast.success('Séquence créée', {
            description: 'Sélectionnez ensuite vos candidats dans l’onglet Sourcing et cliquez sur Séquence.',
            ...(enrollAction ? { action: enrollAction } : {}),
          });
        } else if (canSendSequences) {
          // Abonnement pas encore lu : l'éditeur n'a rien annoncé.
          toast.warning('Séquence créée désactivée', {
            description: 'Votre abonnement n’était pas encore vérifié : activez-la depuis la liste des séquences.',
          });
        }
      }

      editorBaseStepIdsRef.current = null;
      fetchSequences();
      setShowBuilder(false);
      setEditingSequence(null);
      if (createdSequenceId) onCreated?.(createdSequenceId);
    } catch (err) {
      // Relancé pour que SequenceBuilder.handleSave n'affiche pas
      // « Séquence enregistrée » et ne ferme pas le builder sur un échec
      // (les modifications étaient perdues).
      console.error('Error saving sequence:', err);
      throw err;
    }
  };

  return { handleSaveSequence };
}

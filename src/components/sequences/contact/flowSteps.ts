// Refonte mission, lot 5f-2c : étapes d'une séquence pour le panneau Contacter.
//
// Les inscriptions lisent les lignes brutes de sequence_steps (snake_case) ;
// l'aperçu du premier message (firstMessagePath, usePreviewValues) lit la forme
// de SequenceStepPreview. toFlowSteps fait la même correspondance, champ par
// champ, que mapSteps de EnrollmentPreviewModal (qui reste privée) : les deux
// fenêtres montrent donc le même parcours. Un test lit la source de la fenêtre
// et compare les deux résultats.

import { hasMessage, type SequenceStepPreview } from '@/hooks/useEnrollmentPreview';
import { requiresAiReview } from '@/lib/contactRecipientsGuard';
import { isClosedChannelStep } from '@/lib/sequenceCompatibility';

/**
 * Étape telle que lue dans sequence_steps (snake_case), ou telle que la forme
 * de l'éditeur la donne (camelCase) : mapSteps accepte les deux écritures.
 */
export interface RawFlowStep {
  id: string;
  step_order?: number | null;
  stepOrder?: number | null;
  action_type?: string | null;
  actionType?: string | null;
  step_channel?: string | null;
  channel?: string | null;
  message_template?: string | null;
  messageTemplate?: string | null;
  subject_template?: string | null;
  subjectTemplate?: string | null;
  use_ai_personalization?: boolean | null;
  useAiPersonalization?: boolean | null;
  ai_tone?: string | null;
  aiTone?: string | null;
  delay_days?: number | null;
  delayDays?: number | null;
  delay_hours?: number | null;
  delayHours?: number | null;
  delay_minutes?: number | null;
  delayMinutes?: number | null;
  condition?: string;
  timeout_days?: number | null;
  timeoutDays?: number | null;
  timeout_branch_step_id?: string | null;
  timeoutBranchStepId?: string | null;
  parent_step_id?: string | null;
  parentStepId?: string | null;
  branch?: string | null;
  if_true_goto_step?: string | null;
  ifTrueGotoStep?: string | null;
  if_false_goto_step?: string | null;
  ifFalseGotoStep?: string | null;
  next_step_id?: string | null;
  nextStepId?: string | null;
  variant_group?: string | null;
  variantGroup?: string | null;
  ends_sequence?: boolean | null;
  endsSequence?: boolean | null;
}

/** Lignes brutes vers la forme de l'aperçu, triées par ordre d'étape (mapSteps de EnrollmentPreviewModal). */
export function toFlowSteps(raw: readonly RawFlowStep[]): SequenceStepPreview[] {
  return raw.map(s => ({
    stepId: s.id,
    stepOrder: s.step_order ?? s.stepOrder ?? 0,
    actionType: s.action_type || s.actionType || 'message',
    channel: s.step_channel || s.channel,
    messageTemplate: s.message_template || s.messageTemplate || '',
    subjectTemplate: s.subject_template || s.subjectTemplate || '',
    useAiPersonalization: s.use_ai_personalization ?? s.useAiPersonalization ?? false,
    aiTone: s.ai_tone || s.aiTone || 'professional',
    delayDays: s.delay_days ?? s.delayDays ?? 0,
    delayHours: s.delay_hours ?? s.delayHours ?? 0,
    delayMinutes: s.delay_minutes ?? s.delayMinutes ?? 0,
    condition: s.condition,
    timeoutDays: s.timeout_days ?? s.timeoutDays,
    timeoutBranchStepId: s.timeout_branch_step_id || s.timeoutBranchStepId || null,
    parentStepId: s.parent_step_id || s.parentStepId || null,
    branch: s.branch || null,
    // Embranchements suivis par le moteur (vérification oui / non, chaînage).
    ifTrueGotoStep: s.if_true_goto_step || s.ifTrueGotoStep || null,
    ifFalseGotoStep: s.if_false_goto_step || s.ifFalseGotoStep || null,
    nextStepId: s.next_step_id || s.nextStepId || null,
    // Parcours du premier message (versions A/B, fin de séquence).
    variantGroup: s.variant_group ?? s.variantGroup ?? null,
    endsSequence: s.ends_sequence ?? s.endsSequence ?? null,
  })).sort((a, b) => a.stepOrder - b.stepOrder);
}

/**
 * Étape dont le message est montré en aperçu : même règle que la fenêtre
 * d'inscription (modèle écrit, ou rédaction par l'IA même sans modèle ; jamais
 * un canal fermé, que le moteur saute).
 */
export function isPreviewedMessageStep(step: SequenceStepPreview): boolean {
  return !isClosedChannelStep(step.actionType) && hasMessage(step);
}

export interface FlowSequenceInfo {
  /** Étapes qui portent un message (écrit ou rédigé par l'IA), canaux fermés exclus. */
  messageSteps: SequenceStepPreview[];
  /** Une étape à message est rédigée par l'IA pour chaque candidat : relecture obligatoire avant l'inscription. */
  aiReview: boolean;
  /** Une étape porte un texte écrit (l'aperçu du serveur le rend avec les valeurs du candidat). */
  hasWrittenSteps: boolean;
}

export function flowSequenceInfo(steps: readonly SequenceStepPreview[]): FlowSequenceInfo {
  const messageSteps = steps.filter(isPreviewedMessageStep);
  return {
    messageSteps,
    aiReview: messageSteps.some(requiresAiReview),
    hasWrittenSteps: messageSteps.some(s => !s.useAiPersonalization || s.actionType === 'connection_request'),
  };
}

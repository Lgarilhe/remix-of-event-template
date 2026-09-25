import { SequenceStep } from '../SequenceBuilder';

export interface MessageTypeInfo {
  label: string;
  shortLabel: string;
}

/**
 * Exemple neutre des variables, pour le menu « Variables » et l'aperçu d'un
 * message (revue design D-36) : jamais le nom d'une vraie personne ni d'un
 * vrai client. La syntaxe est celle que lit le moteur d'envoi
 * (`{{first_name}}`, supabase/functions/_shared/template-interpolation.ts).
 */
export const VARIABLE_EXAMPLE = {
  first_name: 'Marie',
  last_name: 'Dupont',
  company: 'Cabinet Horizon',
  job_title: 'Directrice technique',
  city: 'Lyon',
  calendly_link: 'https://calendly.com/votre-lien',
  ai_snippet: "[passage rédigé par l'IA pour chaque candidat]",
};

/**
 * Aperçu d'un message avec l'exemple neutre. L'expéditeur est l'utilisateur
 * connecté : le moteur remplace `{{sender_name}}` par le prénom de
 * l'expéditeur.
 */
export function previewMessageTemplate(template: string, senderName?: string | null): string {
  const sender = senderName?.trim() || 'Jean Martin';
  const values: Record<string, string> = {
    ...VARIABLE_EXAMPLE,
    sender_name: sender.split(/\s+/)[0],
    signature: sender,
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => values[key] ?? match);
}

/**
 * Determines the AI message type that will be generated for a given step
 * based on its position in the sequence graph. This mirrors the logic in
 * process-sequences/index.ts generatePersonalizedMessage().
 */
export function getStepMessageType(
  step: SequenceStep,
  allSteps: SequenceStep[]
): MessageTypeInfo | null {
  // Only message-type steps get a label
  if (!['message', 'smart_message', 'inmail', 'connection_request', 'whatsapp_message'].includes(step.actionType)) {
    return null;
  }

  if (step.actionType === 'connection_request') {
    return { label: 'Invitation (sans note)', shortLabel: 'Invitation' };
  }

  // Walk backwards through the graph to find previous message steps in this branch
  const previousSteps = getPreviousStepsInBranch(step, allSteps);

  if (step.actionType === 'whatsapp_message') {
    const prevWhatsApp = previousSteps.filter(s => s.actionType === 'whatsapp_message');
    if (prevWhatsApp.length === 0) {
      return { label: 'Premier message WhatsApp', shortLabel: 'WhatsApp' };
    }
    return { label: 'Relance WhatsApp', shortLabel: 'Relance WhatsApp' };
  }

  const prevMessages = previousSteps.filter(s =>
    ['message', 'smart_message', 'inmail'].includes(s.actionType)
  );
  const hadInvite = previousSteps.some(s => s.actionType === 'connection_request');

  if (step.actionType === 'inmail') {
    const prevInMails = prevMessages.filter(s => s.actionType === 'inmail');
    if (prevInMails.length === 0) {
      return { label: 'Premier InMail (formel)', shortLabel: 'Premier InMail' };
    }
    return { label: 'Relance par InMail', shortLabel: 'Relance InMail' };
  }

  // message or smart_message
  const prevDirectMsgs = prevMessages.filter(s => ['message', 'smart_message'].includes(s.actionType));

  if (prevDirectMsgs.length === 0 && !hadInvite) {
    return { label: 'Premier message (accroche)', shortLabel: 'Premier message' };
  }
  if (prevDirectMsgs.length === 0 && hadInvite) {
    return { label: "Après l'invitation (remerciement et présentation)", shortLabel: 'Après connexion' };
  }
  if (prevDirectMsgs.length === 1) {
    return { label: 'Relance 1', shortLabel: 'Relance 1' };
  }
  return { label: 'Relance 2', shortLabel: 'Relance 2' };
}

/**
 * Walk backwards through the graph to find all steps that come before this one
 * in the same branch path.
 */
function getPreviousStepsInBranch(
  targetStep: SequenceStep,
  allSteps: SequenceStep[]
): SequenceStep[] {
  // Build a map of stepId → step for quick lookup
  const stepMap = new Map(allSteps.map(s => [s.id, s]));

  // Build a reverse adjacency: for each step, who points to it?
  const pointedToBy = new Map<string, SequenceStep[]>();

  for (const s of allSteps) {
    const targets = [s.nextStepId, s.ifTrueGotoStep, s.ifFalseGotoStep, s.timeoutBranchStepId].filter(Boolean) as string[];
    for (const t of targets) {
      if (!pointedToBy.has(t)) pointedToBy.set(t, []);
      pointedToBy.get(t)!.push(s);
    }
  }

  // Walk backwards from targetStep
  const visited = new Set<string>();
  const result: SequenceStep[] = [];

  function walk(stepId: string) {
    if (visited.has(stepId)) return;
    visited.add(stepId);

    const parents = pointedToBy.get(stepId) || [];
    for (const parent of parents) {
      result.push(parent);
      walk(parent.id);
    }
  }

  walk(targetStep.id);
  return result;
}

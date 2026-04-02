import { SequenceStep } from '../SequenceBuilder';

export interface MessageTypeInfo {
  label: string;
  shortLabel: string;
  color: string; // tailwind classes
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
    return { label: 'Invitation (pas de note)', shortLabel: 'Invitation', color: 'bg-success/10 text-success' };
  }

  // Walk backwards through the graph to find previous message steps in this branch
  const previousSteps = getPreviousStepsInBranch(step, allSteps);

  if (step.actionType === 'whatsapp_message') {
    const prevWhatsApp = previousSteps.filter(s => s.actionType === 'whatsapp_message');
    if (prevWhatsApp.length === 0) {
      return { label: 'WhatsApp initial', shortLabel: 'WhatsApp', color: 'bg-green-500/10 text-green-500' };
    }
    return { label: 'WhatsApp relance', shortLabel: 'WA relance', color: 'bg-green-500/10 text-green-500' };
  }

  const prevMessages = previousSteps.filter(s =>
    ['message', 'smart_message', 'inmail'].includes(s.actionType)
  );
  const hadInvite = previousSteps.some(s => s.actionType === 'connection_request');

  if (step.actionType === 'inmail') {
    const prevInMails = prevMessages.filter(s => s.actionType === 'inmail');
    if (prevInMails.length === 0) {
      return { label: 'InMail initial (formel)', shortLabel: 'InMail initial', color: 'bg-info/10 text-info' };
    }
    return { label: 'InMail relance', shortLabel: 'InMail relance', color: 'bg-info/10 text-info' };
  }

  // message or smart_message
  const prevDirectMsgs = prevMessages.filter(s => ['message', 'smart_message'].includes(s.actionType));

  if (prevDirectMsgs.length === 0 && !hadInvite) {
    return { label: 'Premier message (accroche)', shortLabel: '1er message', color: 'bg-brand-purple/10 text-brand-purple' };
  }
  if (prevDirectMsgs.length === 0 && hadInvite) {
    return { label: 'Suite invitation (merci + pitch)', shortLabel: 'Post-connexion', color: 'bg-brand-purple/10 text-brand-purple' };
  }
  if (prevDirectMsgs.length === 1) {
    return { label: 'Relance 1', shortLabel: 'Relance 1', color: 'bg-warning/10 text-warning' };
  }
  return { label: 'Relance 2', shortLabel: 'Relance 2', color: 'bg-destructive/10 text-destructive' };
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

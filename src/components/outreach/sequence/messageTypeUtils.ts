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
  if (!['message', 'smart_message', 'inmail', 'connection_request'].includes(step.actionType)) {
    return null;
  }

  if (step.actionType === 'connection_request') {
    return { label: 'Invitation (pas de note)', shortLabel: 'Invitation', color: 'bg-emerald-50 text-emerald-700' };
  }

  // Walk backwards through the graph to find previous message steps in this branch
  const previousSteps = getPreviousStepsInBranch(step, allSteps);
  const prevMessages = previousSteps.filter(s =>
    ['message', 'smart_message', 'inmail'].includes(s.actionType)
  );
  const hadInvite = previousSteps.some(s => s.actionType === 'connection_request');

  if (step.actionType === 'inmail') {
    const prevInMails = prevMessages.filter(s => s.actionType === 'inmail');
    if (prevInMails.length === 0) {
      return { label: 'InMail initial (formel)', shortLabel: 'InMail initial', color: 'bg-blue-50 text-blue-700' };
    }
    return { label: 'InMail relance (clôture)', shortLabel: 'InMail relance', color: 'bg-blue-50 text-blue-700' };
  }

  // message or smart_message
  const prevDirectMsgs = prevMessages.filter(s => ['message', 'smart_message'].includes(s.actionType));

  if (prevDirectMsgs.length === 0 && !hadInvite) {
    return { label: 'Premier message (accroche)', shortLabel: '1er message', color: 'bg-violet-50 text-violet-700' };
  }
  if (prevDirectMsgs.length === 0 && hadInvite) {
    return { label: 'Suite invitation (merci + pitch)', shortLabel: 'Post-connexion', color: 'bg-violet-50 text-violet-700' };
  }
  if (prevDirectMsgs.length === 1) {
    return { label: 'Relance 1 (nouvel angle)', shortLabel: 'Relance 1', color: 'bg-amber-50 text-amber-700' };
  }
  return { label: 'Relance 2 (clôture)', shortLabel: 'Relance 2', color: 'bg-red-50 text-red-700' };
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

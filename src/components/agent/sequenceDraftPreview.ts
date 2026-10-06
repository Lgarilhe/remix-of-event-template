/**
 * Lecture de dry_run_result.details de l'outil create_sequence (refonte
 * mission, lot 5e) : étapes au format de l'éditeur (forme fixée par le
 * serveur, buildDraftSkeleton), textes entiers, formulations « À relire ».
 * Rendue par SequenceDraftPreview, en entier et sans troncature, sur chaque
 * surface où la proposition peut être approuvée : la carte de la conversation
 * (AgentToolApprovalCard) et le Journal (AgentActionsSettings).
 *
 * Module pur, sans import : testé directement par les tests Node.
 */

export interface SequenceDraftPreviewStep {
  id: string;
  order: number;
  actionType: string;
  conditionType: string;
  delayDays: number;
  timeoutDays: number | null;
  subject: string;
  body: string;
  /** Formulations à relire signalées par les contrôles (« À relire : … »). */
  warnings: string[];
}

export interface SequenceDraftPreviewData {
  name: string;
  missionName: string | null;
  steps: SequenceDraftPreviewStep[];
}

/** Note posée sur la proposition rejetée quand la personne la reprend dans l'éditeur. */
export const PROPOSAL_EDITOR_NOTE = "Reprise dans l'éditeur";

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const asText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const asCount = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** Lecture défensive (donnée stockée en base) ; null si la proposition n'a pas d'étapes lisibles. */
export function readSequenceDraftPreview(details: Record<string, unknown> | null | undefined): SequenceDraftPreviewData | null {
  if (!details || !Array.isArray(details.steps)) return null;
  const warnings = new Map<string, string[]>();
  for (const flag of Array.isArray(details.flags) ? details.flags : []) {
    if (!isRecord(flag) || flag.kind !== 'a_relire' || typeof flag.step_id !== 'string') continue;
    const messages = (Array.isArray(flag.messages) ? flag.messages : []).filter((m): m is string => typeof m === 'string');
    warnings.set(flag.step_id, [...(warnings.get(flag.step_id) ?? []), ...messages]);
  }
  const steps = details.steps
    .filter(isRecord)
    .map((s, i): SequenceDraftPreviewStep => {
      const id = asText(s.id) ?? String(i);
      return {
        id,
        order: typeof s.order === 'number' ? s.order : i,
        actionType: asText(s.actionType) ?? 'message',
        conditionType: asText(s.conditionType) ?? 'always',
        delayDays: asCount(s.delayDays),
        timeoutDays: typeof s.timeoutDays === 'number' && s.timeoutDays > 0 ? Math.round(s.timeoutDays) : null,
        subject: typeof s.subjectTemplate === 'string' ? s.subjectTemplate : '',
        body: typeof s.messageTemplate === 'string' ? s.messageTemplate : '',
        warnings: warnings.get(id) ?? [],
      };
    })
    .sort((a, b) => a.order - b.order);
  if (steps.length === 0) return null;
  return { name: asText(details.name) ?? 'Nouvelle séquence', missionName: asText(details.mission_name), steps };
}

/** Nom d'une étape, mêmes mots que l'éditeur (STEP_TYPE_LABELS de sequenceGraph.ts). */
export function sequenceDraftStepTitle(step: Pick<SequenceDraftPreviewStep, 'actionType' | 'timeoutDays'>): string {
  switch (step.actionType) {
    case 'profile_visit':
      return 'Visite de profil';
    case 'connection_request':
      return 'Invitation LinkedIn';
    case 'wait_connection':
      return step.timeoutDays
        ? `Attendre la connexion, ${step.timeoutDays} jours au plus`
        : 'Attendre la connexion';
    case 'message':
      return 'Message LinkedIn';
    case 'inmail':
      return 'InMail';
    default:
      return 'Étape';
  }
}

/** Délai avant l'étape, mêmes mots que le fil de l'éditeur. */
export function sequenceDraftDelayLabel(step: Pick<SequenceDraftPreviewStep, 'delayDays'>, index: number): string {
  if (index === 0 && step.delayDays === 0) return "Dès l'inscription";
  if (step.delayDays === 0) return 'Aussitôt';
  return `Attendre ${step.delayDays} jour${step.delayDays > 1 ? 's' : ''}`;
}

/** Condition de l'étape, en clair ; null quand elle part toujours. */
export function sequenceDraftConditionLabel(step: Pick<SequenceDraftPreviewStep, 'conditionType'>): string | null {
  return step.conditionType === 'if_connected' ? 'Seulement si en relation' : null;
}

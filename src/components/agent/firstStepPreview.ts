/**
 * Lecture de dry_run_result.details.first_step_preview (refonte mission,
 * lot 5a, outil enroll_in_sequence), rendue par EnrollFirstMessagePreview.
 */

export interface FirstStepPreviewText {
  stepId: string;
  actionType: string | null;
  stepLabel: string;
  condition: string | null;
  subject: string | null;
  text: string;
  ai: boolean;
  missing: string[];
}

export interface FirstStepPreviewData {
  candidateName: string | null;
  candidateInMission: boolean;
  texts: FirstStepPreviewText[];
  firstAction: string | null;
}

const asText = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/** Lecture défensive de details.first_step_preview (donnée stockée en base). */
export function readFirstStepPreview(details: Record<string, unknown> | null | undefined): FirstStepPreviewData | null {
  const raw = details?.first_step_preview;
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const texts = (Array.isArray(p.texts) ? p.texts : [])
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t, i) => ({
      stepId: asText(t.step_id) ?? String(i),
      actionType: asText(t.action_type),
      stepLabel: asText(t.step_label) ?? 'Message',
      condition: asText(t.condition),
      subject: asText(t.subject),
      text: typeof t.text === 'string' ? t.text : '',
      ai: t.ai === true,
      missing: (Array.isArray(t.missing) ? t.missing : []).filter((m): m is string => typeof m === 'string'),
    }));
  return {
    candidateName: asText(p.candidate_name),
    candidateInMission: p.candidate_in_mission !== false,
    texts,
    firstAction: asText(p.first_action),
  };
}

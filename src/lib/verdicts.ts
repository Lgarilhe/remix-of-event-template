/**
 * Vocabulaire des décisions sur un candidat, le même sur toutes les surfaces
 * (revue design E-16) : la scorecard, la qualification, le compte rendu du
 * coaching, l'historique de scoring, l'assistant. Jamais de clé brute
 * (« strong_yes », « NO_GO », « shortlist ») ni d'anglais (« Strong Yes »).
 *
 * Trois familles :
 * - la recommandation d'une personne (scorecard, compte rendu du coaching) ;
 * - le verdict d'une qualification ;
 * - la recommandation de l'IA après scoring.
 */

export type VerdictTone = 'success' | 'warning' | 'danger' | 'muted';

export interface VerdictMeta {
  label: string;
  tone: VerdictTone;
}

/** Décision d'une personne, de « Oui, clairement » à « Non, clairement ». */
export const HIRING_VERDICTS: Record<string, VerdictMeta> = {
  strong_yes: { label: 'Oui, clairement', tone: 'success' },
  yes: { label: 'Oui', tone: 'success' },
  maybe: { label: 'À revoir', tone: 'warning' },
  no: { label: 'Non', tone: 'danger' },
  strong_no: { label: 'Non, clairement', tone: 'danger' },
  pending: { label: 'En attente', tone: 'muted' },
};

/** Clés du compte rendu du coaching (GO, NO_GO, MAYBE). */
const VERDICT_ALIASES: Record<string, string> = {
  go: 'yes',
  no_go: 'no',
};

export function hiringVerdictMeta(value: string | null | undefined): VerdictMeta | null {
  if (!value) return null;
  const key = value.toLowerCase();
  return HIRING_VERDICTS[VERDICT_ALIASES[key] ?? key] ?? null;
}

/**
 * Verdict d'une qualification (`go`, `no_go`, `maybe`, `pending`) : la
 * question posée est « le candidat est-il qualifié ? ».
 */
export const QUALIFICATION_VERDICTS: Record<string, VerdictMeta> = {
  go: { label: 'Qualifié', tone: 'success' },
  no_go: { label: 'Non qualifié', tone: 'danger' },
  maybe: { label: 'À revoir', tone: 'warning' },
  pending: { label: 'En attente', tone: 'muted' },
};

export function qualificationVerdictMeta(value: string | null | undefined): VerdictMeta | null {
  if (!value) return null;
  return QUALIFICATION_VERDICTS[value.toLowerCase()] ?? null;
}

/** Recommandation de l'IA après scoring (`shortlist`, `maybe`, `skip`). */
export const AI_RECOMMENDATIONS: Record<string, VerdictMeta> = {
  shortlist: { label: 'Recommandé', tone: 'success' },
  maybe: { label: 'À évaluer', tone: 'warning' },
  skip: { label: 'Peu adapté', tone: 'muted' },
};

export function aiRecommendationMeta(value: string | null | undefined): VerdictMeta | null {
  if (!value) return null;
  return AI_RECOMMENDATIONS[value.toLowerCase()] ?? null;
}

/** Types d'entretien de la scorecard (« Phone Screen », « Culture Fit » : E-16). */
export const INTERVIEW_TYPES: Record<string, string> = {
  phone_screen: 'Préqualification',
  technique: 'Entretien technique',
  culture_fit: 'Adéquation culturelle',
  final: 'Entretien final',
};

export function interviewTypeLabel(value: string | null | undefined): string {
  return (value && INTERVIEW_TYPES[value]) || 'Entretien';
}

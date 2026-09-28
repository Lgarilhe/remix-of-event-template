/**
 * Barème unique du score d'adéquation d'un candidat (0 à 100), le même sur
 * toutes les vues (revue design E-11, E-15).
 *
 * Décision du propriétaire du produit (25 septembre 2026) : les seuils du
 * moteur de scoring (`score-profile-job` : GOOD_MATCH à 65, POSSIBLE_MATCH à
 * 50). Fort à partir de 65, moyen de 50 à 64, faible sous 50. Un score faible
 * reste gris : ce n'est pas une erreur.
 *
 * Module pur : le rendu est `ScoreBadge` (`src/components/ui/score-badge.tsx`).
 */

export type ScoreLevel = 'strong' | 'medium' | 'weak';

export type ScoreTone = 'success' | 'warning' | 'muted';

export const SCORE_THRESHOLDS = { strong: 65, medium: 50 } as const;

export const SCORE_LEVELS: Record<ScoreLevel, { label: string; tone: ScoreTone }> = {
  strong: { label: 'Fort', tone: 'success' },
  medium: { label: 'Moyen', tone: 'warning' },
  weak: { label: 'Faible', tone: 'muted' },
};

/** Score arrondi et borné à 0-100 ; null quand il n'y a pas de score. */
export function normalizeScore(score: number | null | undefined): number | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  return Math.round(Math.min(100, Math.max(0, score)));
}

export function scoreLevel(score: number | null | undefined): ScoreLevel | null {
  const value = normalizeScore(score);
  if (value === null) return null;
  if (value >= SCORE_THRESHOLDS.strong) return 'strong';
  if (value >= SCORE_THRESHOLDS.medium) return 'medium';
  return 'weak';
}

/** « Score 72 sur 100, fort » : nom accessible d'un score affiché seul. */
export function scoreAccessibleLabel(score: number | null | undefined): string {
  const value = normalizeScore(score);
  const level = scoreLevel(value);
  if (value === null || level === null) return 'Pas encore de score';
  return `Score ${value} sur 100, ${SCORE_LEVELS[level].label.toLowerCase()}`;
}

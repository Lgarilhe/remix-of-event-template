// Que faire d'une ligne de profile_enrichment_queue dont l'enrichissement a échoué.
// Règle pure, sans lecture réseau ni base : testée dans outcome.test.ts.

export const MAX_ATTEMPTS = 4;
export const RETRY_DELAY_MS = 30 * 60 * 1000;
/** Raisons qui ne tiennent pas à la ligne : on la reporte sans consommer de tentative. */
const LATER_DELAYS_MS: Record<string, number> = {
  // Ancien identifiant de compte : la ligne attend la reprise des identifiants (aucun appel au prestataire n'est fait).
  outdated_account_id: 6 * 60 * 60 * 1000,
  // Trop de requêtes sur la clé commune, ou compte en état dégradé : cela passe seul.
  profile_read_rate_limited: 60 * 60 * 1000,
  profile_read_account_degraded: 60 * 60 * 1000,
};
/** Compte inutilisable tant qu'un membre n'a pas agi : réessayer ne sert à rien. */
const CLOSE_NOW = new Set(['account_not_linked', 'profile_read_account_disconnected']);

export type QueueStep =
  | { action: 'defer'; delayMs: number }
  | { action: 'retry'; attempts: number; delayMs: number }
  | { action: 'fail'; attempts: number };

export function nextQueueStep(reason: string | undefined, previousAttempts: number): QueueStep {
  const why = reason ?? '';
  const later = LATER_DELAYS_MS[why];
  if (later !== undefined) return { action: 'defer', delayMs: later };
  const attempts = (previousAttempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS || CLOSE_NOW.has(why)) return { action: 'fail', attempts };
  return { action: 'retry', attempts, delayMs: RETRY_DELAY_MS };
}

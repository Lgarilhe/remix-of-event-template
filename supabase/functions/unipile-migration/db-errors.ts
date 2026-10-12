/**
 * Lecture des refus de la base pour la bascule des identifiants de compte.
 *
 * Les fonctions SQL lèvent des erreurs à HINT fixe (REMAP_*), les déclencheurs de garde les leurs
 * (ENROLL_ACCOUNT_OF_OTHER_MEMBER, CROSS_TENANT_VIOLATION). Le texte brut de la base peut contenir
 * des identifiants : il ne sort jamais, seulement un code et une phrase neutre.
 *
 * Module pur.
 */

export type RemapErrorCode =
  | 'conflict'
  | 'cross_tenant'
  | 'enrollment_guard'
  | 'concurrent_change'
  | 'invalid_input'
  | 'batch_unknown'
  | 'batch_already_rolled_back'
  | 'database';

export interface DbError {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
  details?: string | null;
}

const MESSAGES: Record<RemapErrorCode, string> = {
  conflict: 'Le nouvel identifiant est déjà utilisé par une autre ligne. Ce compte n\'est pas converti, rien n\'a été modifié.',
  cross_tenant: 'Le nouvel identifiant est déjà relié à une autre organisation. Ce compte n\'est pas converti, rien n\'a été modifié.',
  enrollment_guard: 'Une inscription de séquence est refusée par la garde de propriétaire du compte. Ce compte n\'est pas converti, rien n\'a été modifié.',
  concurrent_change: 'Des lignes ont changé pendant la bascule. Ce compte n\'est pas converti, rien n\'a été modifié. Relancez la conversion.',
  invalid_input: 'Les identifiants de ce compte sont invalides. Rien n\'a été modifié.',
  batch_unknown: 'Ce lot est introuvable.',
  batch_already_rolled_back: 'Ce lot a déjà été restauré.',
  database: 'La base de données a refusé l\'opération. Rien n\'a été modifié pour ce compte.',
};

export function remapErrorMessage(code: RemapErrorCode): string {
  return MESSAGES[code];
}

/** Code neutre d'une erreur de la base. */
export function classifyDbError(error: DbError | null | undefined): RemapErrorCode {
  const hint = String(error?.hint ?? '');
  const message = String(error?.message ?? '');
  const code = String(error?.code ?? '');
  if (hint === 'REMAP_CONFLICT') return 'conflict';
  if (hint === 'REMAP_CONCURRENT_CHANGE') return 'concurrent_change';
  if (hint === 'REMAP_BATCH_UNKNOWN') return 'batch_unknown';
  if (hint === 'REMAP_BATCH_ALREADY_ROLLED_BACK') return 'batch_already_rolled_back';
  if (hint.startsWith('REMAP_')) return 'invalid_input';
  if (hint === 'ENROLL_ACCOUNT_OF_OTHER_MEMBER') return 'enrollment_guard';
  if (message.includes('CROSS_TENANT_VIOLATION')) return 'cross_tenant';
  if (code === '23505') return 'conflict';
  return 'database';
}

/** True quand l'erreur dit que la fonction appelée n'existe pas (migration non appliquée). */
export function isMissingFunctionError(error: DbError | null | undefined): boolean {
  const code = String(error?.code ?? '');
  return code === 'PGRST202' || code === '42883';
}

/**
 * Où ramener la personne après une connexion lancée hors des Paramètres.
 *
 * L'adresse de retour de la connexion est posée par le serveur (toujours
 * /settings/account/connections/retour) : le navigateur n'en propose aucune. Un
 * écran qui veut reprendre ailleurs (l'installation) note, avant de partir, un
 * mot d'une liste fermée avec l'identifiant de la tentative. La page de retour
 * ne le lit que si l'identifiant de l'adresse est celui noté, et jamais au-delà
 * de quelques minutes. Aucune adresse n'est stockée ni suivie : le mot choisit
 * parmi des chemins écrits ici.
 *
 * Module pur : le stockage est injecté pour les tests
 * (tests/ux/connexion-cartes.test.mjs).
 */

export type ReturnTarget = 'settings' | 'onboarding';

export const RETURN_TARGET_STORAGE_KEY = 'konekt.connection-return';
/** La tentative expire au bout de 30 minutes côté serveur : cinq de marge. */
export const RETURN_TARGET_TTL_MS = 35 * 60 * 1000;

export type ReturnTargetStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): ReturnTargetStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Note la destination d'une tentative. Rend false si le stockage a refusé (la page de retour ramènera alors aux Paramètres). */
export function rememberReturnTarget(
  attemptId: string,
  target: ReturnTarget,
  now: number = Date.now(),
  storage: ReturnTargetStorage | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(RETURN_TARGET_STORAGE_KEY, JSON.stringify({ attemptId, target, at: now }));
    return true;
  } catch {
    return false;
  }
}

/** Destination notée pour cette tentative, sinon 'settings'. Lecture protégée : un stockage qui refuse ou une valeur inattendue ramène aux Paramètres. */
export function readReturnTarget(
  attemptId: string | null,
  now: number = Date.now(),
  storage: ReturnTargetStorage | null = defaultStorage(),
): ReturnTarget {
  if (!attemptId || !storage) return 'settings';
  try {
    const raw = storage.getItem(RETURN_TARGET_STORAGE_KEY);
    if (!raw) return 'settings';
    const parsed = JSON.parse(raw) as { attemptId?: unknown; target?: unknown; at?: unknown };
    if (parsed.attemptId !== attemptId) return 'settings';
    if (typeof parsed.at !== 'number' || now - parsed.at > RETURN_TARGET_TTL_MS || parsed.at > now + 60_000) return 'settings';
    return parsed.target === 'onboarding' ? 'onboarding' : 'settings';
  } catch {
    return 'settings';
  }
}

/** Efface la note (la reprise a eu lieu). */
export function forgetReturnTarget(storage: ReturnTargetStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(RETURN_TARGET_STORAGE_KEY);
  } catch {
    // stockage indisponible : rien à effacer
  }
}

/** Chemin de reprise d'une destination ; `ok` dit si la connexion a abouti (l'installation lit ?li=ok|ko). */
export function returnTargetPath(target: ReturnTarget, ok: boolean): { pathname: string; search: string } | null {
  if (target === 'onboarding') return { pathname: '/onboarding', search: ok ? '?li=ok' : '?li=ko' };
  return null;
}

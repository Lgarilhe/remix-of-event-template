/**
 * Page de retour d'une connexion (/settings/account/connections/retour), partie
 * sans React : lecture de l'adresse et choix de l'écran d'après l'état de la
 * tentative. Testé par tests/ux/connexion-retour.test.mjs.
 *
 * La page ne croit rien de ce que le fournisseur ajoute à l'adresse. Une seule
 * valeur est lue, `state` : l'identifiant de la tentative de connexion que le
 * serveur a créée. Le résultat vient de l'état de cette tentative côté serveur
 * (action connection_status), qui vérifie qu'elle appartient à la personne.
 */

import {
  GENERIC_FAILURE,
  RETURN_PAGE,
  readableConnectionName,
  type ConnectionProviderId,
} from '@/lib/connectionCopy';
import type { AttemptStatusView, PollResult } from './connectionApi';

export const CONNECTIONS_PATH = '/settings/account/connections';
export const RETURN_PATH = '/settings/account/connections/retour';

const ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Identifiant de la tentative (`state`), ou null s'il manque ou n'a pas la forme d'un identifiant. */
export function readReturnState(search: string): string | null {
  const value = new URLSearchParams(search).get('state');
  return value && ATTEMPT_ID.test(value) ? value : null;
}

export type ReturnView =
  | { kind: 'invalid' }
  | { kind: 'reading' }
  | { kind: 'waiting'; slow: boolean }
  | { kind: 'success'; provider: ConnectionProviderId; accountName: string | null }
  | { kind: 'failed'; message: string }
  | { kind: 'expired' }
  | { kind: 'cancelled' }
  | { kind: 'not_found' }
  | { kind: 'load_error'; message: string };

/** Écran d'une tentative lue : terminée, échouée, expirée, annulée ou encore en cours. */
export function viewOfAttempt(view: AttemptStatusView, slow = false): ReturnView {
  switch (view.status) {
    case 'completed': {
      const provider = view.provider ?? 'linkedin';
      const name = view.account?.name ? readableConnectionName(view.account.name, provider) : null;
      return { kind: 'success', provider, accountName: name };
    }
    case 'failed':
      return { kind: 'failed', message: view.errorMessage ?? GENERIC_FAILURE };
    case 'expired':
      return { kind: 'expired' };
    case 'cancelled':
      return { kind: 'cancelled' };
    default:
      return { kind: 'waiting', slow };
  }
}

/** Écran à montrer à la fin d'un suivi. */
export function viewOfPoll(result: PollResult): ReturnView {
  switch (result.kind) {
    case 'settled':
      return viewOfAttempt(result.view);
    case 'timeout':
      return result.view ? viewOfAttempt(result.view, true) : { kind: 'waiting', slow: true };
    case 'error':
      return result.failure.errorCode === 'attempt_not_found'
        ? { kind: 'not_found' }
        : { kind: 'load_error', message: result.failure.message };
    default:
      // Suivi arrêté (page quittée) : l'écran courant reste.
      return { kind: 'reading' };
  }
}

/** Destination gardée par le serveur dans une lecture de la tentative (terminée ou en délai), sinon null. */
export function serverReturnTarget(result: PollResult | AttemptStatusView): 'onboarding' | null {
  if ('status' in result) return result.returnTo;
  if (result.kind === 'settled') return result.view.returnTo;
  if (result.kind === 'timeout') return result.view?.returnTo ?? null;
  return null;
}

/**
 * Texte sous le titre d'un échec. La phrase générale ouvre par le titre lui-même
 * (« La connexion n'a pas abouti. ») : elle n'est pas répétée. La page n'a pas de
 * bouton « Réessayer », donc « Réessayez. » devient un renvoi vers la page Connexions.
 */
export function failedBody(message: string): string | undefined {
  let rest = message.trim();
  if (rest.startsWith(RETURN_PAGE.failedTitle)) rest = rest.slice(RETURN_PAGE.failedTitle.length).trim();
  rest = rest.replace(/^Réessayez\./, RETURN_PAGE.retryFromConnections);
  return rest === '' ? undefined : rest;
}

/** Ancre de la carte du canal sur la page Connexions (#linkedin, #email, #whatsapp). */
export function connectionsAnchor(provider: ConnectionProviderId | null): string {
  if (provider === 'linkedin') return '#linkedin';
  if (provider === 'whatsapp') return '#whatsapp';
  if (provider === 'google' || provider === 'outlook' || provider === 'imap') return '#email';
  return '';
}

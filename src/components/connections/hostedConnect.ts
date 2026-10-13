/**
 * Connexion standard d'un compte, sans React : démarrer la tentative sur le
 * serveur, noter où ramener la personne, puis envoyer l'onglet courant vers la
 * page de connexion.
 *
 * - Même onglet (`goToProvider`) : une fenêtre ouverte après un appel réseau
 *   est bloquée par Safari et par les navigateurs de téléphone.
 * - Aucune adresse de retour n'est envoyée : le serveur pose la sienne. Seul le mot
 *   `onboarding` (liste fermée) part avec la tentative, et reste noté localement en repli.
 * - Un échec devient une phrase de Konekt (code d'erreur du serveur), jamais
 *   le texte du prestataire.
 *
 * Testé par tests/ux/connexion-cartes.test.mjs.
 */

import { connectionErrorMessage, type ConnectionProviderId } from '@/lib/connectionCopy';
import {
  browserTimezone,
  goToProvider,
  type ConnectionApi,
} from './connectionApi';
import { rememberReturnTarget, type ReturnTarget } from './returnTarget';

export interface HostedConnectInput {
  provider: ConnectionProviderId;
  /** Compte à reconnecter (même compte, même historique). Absent : nouvelle connexion. */
  reconnectAccountId?: string | null;
  /** Où ramener la personne ensuite. Les Paramètres par défaut. */
  returnTo?: ReturnTarget;
}

export type HostedConnectOutcome = { ok: true } | { ok: false; errorCode: string; message: string };

export interface HostedConnectDeps {
  api: Pick<ConnectionApi, 'start'>;
  /** Envoie l'onglet vers l'adresse (window.location.assign en production). */
  navigate?: (url: string) => void;
  /** Note la destination de la tentative. */
  remember?: (attemptId: string, target: ReturnTarget) => void;
  /** Appelé juste avant de quitter la page (enregistrer l'état en cours). */
  onLeave?: () => void;
  timezone?: () => string | undefined;
}

export async function startHostedConnection(deps: HostedConnectDeps, input: HostedConnectInput): Promise<HostedConnectOutcome> {
  const tz = (deps.timezone ?? browserTimezone)();
  const result = await deps.api.start({
    provider: input.provider,
    mode: 'hosted',
    locale: 'fr',
    ...(tz ? { timezone: tz } : {}),
    ...(input.reconnectAccountId ? { reconnect_account_id: input.reconnectAccountId } : {}),
    // Le serveur garde la destination avec la tentative : elle survit à un autre navigateur ou à un stockage refusé.
    ...(input.returnTo === 'onboarding' ? { return_to: 'onboarding' as const } : {}),
  });
  if (result.ok === false) return { ok: false, errorCode: result.errorCode, message: result.message };
  if (result.next.kind !== 'redirect') {
    return { ok: false, errorCode: 'unknown', message: connectionErrorMessage('unknown', input.provider) };
  }
  const target = input.returnTo ?? 'settings';
  if (target !== 'settings') (deps.remember ?? ((id, t) => { rememberReturnTarget(id, t); }))(result.attemptId, target);
  deps.onLeave?.();
  if (!goToProvider(result.next.url, deps.navigate)) {
    return { ok: false, errorCode: 'unknown', message: connectionErrorMessage('unknown', input.provider) };
  }
  return { ok: true };
}

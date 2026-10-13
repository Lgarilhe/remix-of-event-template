/**
 * Alerte affichée quand le compte LinkedIn de la personne change d'état page ouverte (toast de
 * LinkedInAccountsContext), sans React.
 *
 * Une seule table pour la décision : la classe de santé de l'avant et de l'après
 * (disconnectionAlertFor), puis la cause du compte à reconnecter lue comme sur les cartes
 * (causeOfReconnect, connectionView.ts) et ses phrases (src/lib/connectionCopy.ts) :
 * - session expirée (CREDENTIALS, DISCONNECTED...) : « Votre session LinkedIn a expiré » ;
 * - connexion partielle (PARTIAL) : une partie de la connexion demande une nouvelle authentification,
 *   avec « Reconnecter » ; la phrase est celle de la carte, du bandeau et de la notification ;
 * - panne de connexion (ERROR...) et autres causes : « Le compte ne répond plus » ;
 * - compte restreint (LOCKED) : même titre et même phrase que le bandeau et la carte, « Voir » sans
 *   « Reconnecter », car se reconnecter n'y change rien ;
 * - connexion limitée (DEGRADED) : aucune alerte, la reprise est automatique.
 *
 * Testé par tests/ux/connexion-alerte-direct.test.mjs.
 */

import { disconnectionAlertFor, type ConnectionHealth } from '@/lib/linkedinStatus';
import { ALERT, readableConnectionName } from '@/lib/connectionCopy';
import { causeOfReconnect } from './connectionView';

export interface DisconnectToast {
  title: string;
  description: string;
  /** « Reconnecter », ou « Voir » là où se reconnecter ne sert à rien (compte restreint). */
  actionLabel: string;
}

/** Compte tel que la liste le décrit : l'identifiant et le statut brut suffisent à lire la cause. */
export interface ToastAccount {
  id: string;
  name?: string | null;
  status?: string | null;
}

/** L'alerte à lever pour ce changement d'état, ou null quand il n'y en a pas. */
export function disconnectToastFor(
  previous: ConnectionHealth,
  next: ConnectionHealth,
  account: ToastAccount,
): DisconnectToast | null {
  const alert = disconnectionAlertFor(previous, next);
  if (alert === 'locked') {
    return { title: ALERT.linkedinLockedTitle, description: ALERT.linkedinLocked, actionLabel: ALERT.seeAction };
  }
  if (alert !== 'needs_reconnect') return null;
  const cause = causeOfReconnect({ status: account.status, accountId: account.id });
  if (cause === 'authentication_partial') {
    return { title: ALERT.linkedinPartialTitle, description: ALERT.linkedinPartial, actionLabel: ALERT.reconnectAction };
  }
  return {
    title: ALERT.linkedinDisconnectedTitle(readableConnectionName(account.name, 'linkedin')),
    description: cause === 'session_expired' ? ALERT.linkedinCredentials : ALERT.linkedinStopped,
    actionLabel: ALERT.reconnectAction,
  };
}

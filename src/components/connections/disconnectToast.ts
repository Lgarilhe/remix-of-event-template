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
 * Une entrée que le serveur n'a pas pu lire (`unverified`, le prestataire n'a pas répondu) ne dit rien de l'état
 * du compte : elle ne lève aucune alerte et n'efface pas l'état retenu avant elle, sinon un prestataire instable
 * ferait lever deux fois la même alerte (lecture PARTIAL, lecture ratée vue comme « actif », lecture PARTIAL).
 *
 * Testé par tests/ux/connexion-alerte-direct.test.mjs.
 */

import {
  classifyConnectionHealth,
  disconnectionAlertFor,
  type ConnectionHealth,
  type LinkedInHealth,
} from '@/lib/linkedinStatus';
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

/** Compte tel que la liste le décrit, avec ce que la décision d'un passage lit de plus (verrou, marqueur « non lu »). */
export interface ListedToastAccount extends ToastAccount {
  is_locked?: boolean | null;
  /** Le prestataire n'a pas répondu pour ce compte : statut et licences ne sont pas lus. */
  unverified?: boolean;
}

/** Ce que le contexte retient d'un passage à l'autre : le compte et sa classe de santé lue. */
export interface ToastMemory {
  accountId: string;
  health: LinkedInHealth;
}

/**
 * Un passage de l'alerte en direct, à chaque liste reçue :
 * - entrée non lue : ni alerte ni changement de mémoire ;
 * - premier passage pour ce compte : la mémoire seule (pas d'alerte) ;
 * - sinon : l'alerte du changement d'état (disconnectToastFor), et la mémoire à jour.
 */
export function toastStepFor(
  memory: ToastMemory | null,
  account: ListedToastAccount,
): { memory: ToastMemory | null; toast: DisconnectToast | null } {
  if (account.unverified === true) return { memory, toast: null };
  const health = classifyConnectionHealth({ status: account.status, isLocked: account.is_locked });
  const next: ToastMemory = { accountId: account.id, health };
  if (memory?.accountId !== account.id) return { memory: next, toast: null };
  return { memory: next, toast: disconnectToastFor(memory.health, health, account) };
}

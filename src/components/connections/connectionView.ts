/**
 * Lecture d'un compte relié pour les cartes de Connexions, sans React : de la
 * classe de santé (src/lib/linkedinStatus.ts) au mot, à la teinte, à la phrase
 * d'explication et au geste proposé (src/lib/connectionCopy.ts). Une seule
 * table pour les trois canaux, pour que LinkedIn, la messagerie et WhatsApp
 * disent la même chose d'un même état.
 *
 * Règle des gestes : se reconnecter ne règle ni une connexion limitée (reprise
 * automatique) ni un accès suspendu (le support). Seul un compte à reconnecter
 * propose « Reconnecter ».
 *
 * Testé par tests/ux/connexion-cartes.test.mjs.
 */

import type { ConnectionHealth } from '@/lib/linkedinStatus';
import { hasOutdatedAccountId } from '@/lib/accountIdFormat';
import {
  CARD_COMMON,
  HEALTH_LABEL,
  HEALTH_TONE,
  OFFER_LABEL,
  PROVIDER_CHANNEL,
  causeReason,
  healthAction,
  healthActionLabel,
  healthReason,
  type AccountCause,
  type ConnectionChannel,
  type ConnectionProviderId,
  type HealthAction,
  type HealthTone,
} from '@/lib/connectionCopy';

export interface ConnectionView {
  health: ConnectionHealth;
  /** Le mot de l'état (« Actif », « À reconnecter »...). */
  label: string;
  tone: HealthTone;
  /** Phrase sous l'état ; vide quand l'état se suffit. */
  reason: string;
  action: HealthAction | null;
  /** Libellé du bouton du geste proposé, null sans geste. */
  actionLabel: string | null;
  /** Cause précise quand elle change la phrase (compte à reconnecter, état non lu), sinon null. */
  cause: AccountCause | null;
  /**
   * Ce que fait « Reconnecter » : 'in_place' renouvelle le compte relié, 'new_link' ouvre une
   * nouvelle connexion parce que l'ancien compte n'existe plus chez le prestataire.
   */
  reconnect: 'in_place' | 'new_link';
}

/** Ce que la carte montre d'un état de santé, pour un fournisseur donné. */
export function viewOfHealth(health: ConnectionHealth, provider: ConnectionProviderId): ConnectionView {
  const action = healthAction(health);
  return {
    health,
    label: HEALTH_LABEL[health],
    tone: HEALTH_TONE[health],
    reason: healthReason(health, PROVIDER_CHANNEL[provider]),
    action,
    actionLabel: action ? healthActionLabel(action, provider) : null,
    cause: null,
    reconnect: 'in_place',
  };
}

/** Ce que l'on sait d'un compte affiché sur une carte. */
export interface AccountFacts {
  /** Classe de santé déjà calculée (classifyConnectionHealth, healthOfState). */
  health: ConnectionHealth;
  /** Statut de la liste ou de la liaison (« CREDENTIALS », « PARTIAL »...) ; « DELETED » pour un compte retiré. */
  status?: string | null;
  /** Identifiant du compte tel qu'il est gardé : un ancien format dit que la connexion est à refaire. */
  accountId?: string | null;
  /** Compte que le prestataire n'a pas répondu : l'état reçu n'est qu'un dernier état connu, jamais affiché comme lu. */
  unverified?: boolean;
}

/** Pourquoi un compte est à reconnecter, d'après son statut et son identifiant. */
export function causeOfReconnect(facts: Pick<AccountFacts, 'status' | 'accountId'>): AccountCause {
  const status = typeof facts.status === 'string' ? facts.status.trim().toUpperCase() : '';
  if (status === 'DELETED') return 'removed';
  if (hasOutdatedAccountId(facts.accountId)) return 'outdated_identifier';
  if (status === 'PARTIAL') return 'authentication_partial';
  if (status === 'ERROR' || status === 'ERRORED' || status === 'STOPPED' || status === 'PERMISSIONS') return 'connection_error';
  return 'session_expired';
}

/**
 * Ce que la carte montre d'un compte : la classe de santé, avec une phrase par cause.
 * - état non lu : « État à vérifier » et « Réessayer », ni « Actif » ni offre devinés ;
 * - à reconnecter : session expirée, panne de connexion, authentification partielle,
 *   identifiant à refaire ou compte retiré, chacun avec sa phrase ; « Reconnecter » est
 *   le seul geste, et il ouvre une nouvelle connexion quand le compte n'existe plus ;
 * - tout le reste : la phrase de sa classe (viewOfHealth).
 */
export function viewOfAccount(facts: AccountFacts, provider: ConnectionProviderId): ConnectionView {
  const channel = PROVIDER_CHANNEL[provider];
  if (facts.unverified === true) {
    return {
      ...viewOfHealth('unknown', provider),
      reason: causeReason('unreadable', channel),
      actionLabel: CARD_COMMON.retry,
      cause: 'unreadable',
    };
  }
  const base = viewOfHealth(facts.health, provider);
  if (facts.health !== 'needs_reconnect') return base;
  const cause = causeOfReconnect(facts);
  return {
    ...base,
    reason: causeReason(cause, channel),
    cause,
    reconnect: cause === 'removed' ? 'new_link' : 'in_place',
  };
}

const isRemoved = (account: { status?: string | null }) => String(account.status ?? '').trim().toUpperCase() === 'DELETED';
const addressOf = (account: { identifier?: string | null; name?: string | null }) =>
  String(account.identifier ?? account.name ?? '').trim().toLowerCase();

/**
 * Comptes à lister sur une carte : un compte retiré chez le prestataire reste une ligne
 * (à reconnecter), sauf quand un compte vivant le remplace : même adresse pour une
 * messagerie, n'importe quel compte vivant pour WhatsApp (une seule ligne). Sans cela,
 * l'ancienne liaison s'afficherait à côté de la nouvelle connexion.
 */
export function withoutSupersededRemoved<T extends { status?: string | null; identifier?: string | null; name?: string | null }>(
  accounts: readonly T[],
  channel: ConnectionChannel,
): T[] {
  const live = accounts.filter((account) => !isRemoved(account));
  return accounts.filter((account) => {
    if (!isRemoved(account)) return true;
    if (channel === 'whatsapp') return live.length === 0;
    const address = addressOf(account);
    return address === '' || !live.some((other) => addressOf(other) === address);
  });
}

/** Rang d'affichage : ce qui demande un geste d'abord, le reste ensuite (ordre d'origine conservé à rang égal). */
export function attentionRank(view: Pick<ConnectionView, 'health'>): number {
  if (view.health === 'needs_reconnect' || view.health === 'locked') return 0;
  if (view.health === 'unknown' || view.health === 'limited') return 1;
  return 2;
}

/** Pastille de l'état : une classe de fond par teinte (jetons du thème, jamais une couleur brute). */
export const TONE_DOT: Record<HealthTone, string> = {
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger',
  muted: 'bg-muted-foreground',
};

/** Texte de l'état : discret quand tout va bien, appuyé par la couleur de l'état quand la personne doit agir. */
export const TONE_TEXT: Record<HealthTone, string> = {
  success: 'text-muted-foreground',
  info: 'text-muted-foreground',
  warning: 'font-medium text-warning',
  danger: 'font-medium text-danger',
  muted: 'text-muted-foreground',
};

/** Fournisseur de messagerie d'une liaison ou d'un compte (« GOOGLE », « gmail », « OUTLOOK »...), null s'il est inconnu. */
export function emailProviderOf(raw: unknown): 'google' | 'outlook' | 'imap' | null {
  const value = typeof raw === 'string' ? raw.toUpperCase() : '';
  if (!value) return null;
  if (value.includes('GOOGLE') || value.includes('GMAIL')) return 'google';
  if (value.includes('OUTLOOK') || value.includes('MICROSOFT') || value.includes('OFFICE')) return 'outlook';
  if (value.includes('IMAP') || value === 'MAIL') return 'imap';
  return null;
}

/** Date d'une liaison en clair (« 12/09/2026 »), null si elle manque ou ne se lit pas. */
export function sinceDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Le geste proposé sur une carte, d'après l'état et la forme du compte :
 * - 'reconnect' : session ou accès à renouveler, même compte ;
 * - 'connect' : aucun compte, ou compte disparu chez le prestataire (une
 *   nouvelle connexion remplace la liaison) ;
 * - 'contact_support' / 'refresh' : suspendu, état illisible ;
 * - null : rien à faire de votre côté.
 */
export function cardAction(view: ConnectionView, missing: boolean): HealthAction | null {
  if (missing) return 'connect';
  return view.action;
}

/** Offre LinkedIn du compte (la plus complète), en clair ; null quand la liste ne la donne pas. */
export function offerLabelOf(subscriptions: { classic?: boolean; recruiter?: boolean; sales_navigator?: boolean } | null | undefined): string | null {
  if (!subscriptions) return null;
  if (subscriptions.recruiter) return OFFER_LABEL.recruiter;
  if (subscriptions.sales_navigator) return OFFER_LABEL.sales_navigator;
  return OFFER_LABEL.classic;
}

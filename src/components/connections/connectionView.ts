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
import {
  HEALTH_LABEL,
  HEALTH_TONE,
  OFFER_LABEL,
  PROVIDER_CHANNEL,
  healthAction,
  healthActionLabel,
  healthReason,
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
  };
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

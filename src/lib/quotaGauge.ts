// Refonte mission, lot 5f-2c : jauge du plafond LinkedIn du panneau Contacter.
// Dit, avant l'inscription, combien d'actions il reste au compte d'envoi pour
// la première étape de la séquence, et si l'inscription va dépasser le plafond.
// Le plafond ne bloque jamais l'inscription : au-delà, le moteur reporte les
// envois (état « Reporté »), ce que le texte d'avertissement annonce.
//
// Deux sortes de jauge, d'après le type de la première action :
//   - invitations : plafond de la fenêtre glissante de 7 jours ;
//   - actions : plafond d'actions visibles du jour (messages).
// Une première étape sans envoi (visite, attente, e-mail...) n'a pas de jauge. Un InMail non plus :
// il a son propre plafond du jour et ses crédits, et un candidat déjà en relation reçoit un message
// direct à la place, ce que la jauge ne sait pas distinguer.
//
// Module pur, testé sous Node (tests/ux/lot5f2c-libs.test.mjs) : les chiffres
// viennent de get_linkedin_quota_status (useLinkedInQuotaStatus), lus par l'appelant.

import { plural } from './plural.ts';

/** Chiffres du compte, tels que rendus par get_linkedin_quota_status. */
export interface QuotaFigures {
  /** today.visible_actions */
  usedToday: number;
  /** caps.visible_actions */
  capToday: number;
  /** week.invitations */
  usedWeekInvitations: number;
  /** caps.weekly_invitations */
  capWeekInvitations: number;
}

export type GaugeKind = 'invitations' | 'actions';
export type GaugeLevel = 'ok' | 'warning' | 'critical';

export interface QuotaGaugeModel {
  kind: GaugeKind;
  /** Ce qu'il reste avant le plafond, avant cette inscription (jamais négatif). */
  remaining: number;
  cap: number;
  used: number;
  /** Nombre de candidats qui vont consommer une place. */
  count: number;
  /** Part du plafond utilisée une fois l'inscription faite, de 0 à 100. */
  percent: number;
  level: GaugeLevel;
  /** Phrase d'état, sans « N / M ». */
  text: string;
  /** Phrase d'avertissement quand l'inscription dépasse ce qui reste, sinon null. */
  warning: string | null;
}

/** Seuils de couleur, identiques à ceux des cartes de plafonds des réglages. */
export const GAUGE_WARNING_PERCENT = 80;
export const GAUGE_CRITICAL_PERCENT = 95;

/** Sorte de jauge d'après le type de la première action de la séquence. */
export function gaugeKindOf(firstActionType: string | null | undefined): GaugeKind | null {
  if (firstActionType === 'connection_request') return 'invitations';
  if (firstActionType === 'message') return 'actions';
  return null;
}

function figure(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Modèle de la jauge pour `count` candidats, ou null quand il n'y a rien à
 * montrer : première action sans envoi, plafond inconnu ou nul, aucun candidat.
 */
export function quotaGauge(
  firstActionType: string | null | undefined,
  figures: QuotaFigures,
  count: number,
): QuotaGaugeModel | null {
  const kind = gaugeKindOf(firstActionType);
  if (kind === null) return null;
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) return null;

  const rawCap = kind === 'invitations' ? figures.capWeekInvitations : figures.capToday;
  if (typeof rawCap !== 'number' || !Number.isFinite(rawCap) || rawCap <= 0) return null;
  const cap = rawCap;
  const used = Math.max(0, figure(kind === 'invitations' ? figures.usedWeekInvitations : figures.usedToday));

  const remaining = Math.max(0, cap - used);
  // Multiplier avant de diviser évite les écarts d'arrondi des flottants (23 sur 40 donne 57,5 et non 57,49999).
  const percent = Math.min(100, Math.round(((used + count) * 100) / cap));
  const level: GaugeLevel =
    percent >= GAUGE_CRITICAL_PERCENT ? 'critical' : percent >= GAUGE_WARNING_PERCENT ? 'warning' : 'ok';

  let text: string;
  if (kind === 'invitations') {
    text =
      remaining > 0
        ? `${plural(remaining, 'invitation possible', 'invitations possibles')} cette semaine`
        : "Plafond d'invitations atteint pour cette semaine";
  } else {
    text =
      remaining > 0
        ? `${plural(remaining, 'action possible', 'actions possibles')} aujourd'hui`
        : "Plafond d'actions atteint pour aujourd'hui";
  }

  let warning: string | null = null;
  if (count > remaining) {
    warning =
      remaining === 0
        ? `Plafond atteint : ${plural(count, 'candidat sera reporté', 'candidats seront reportés')} automatiquement.`
        : `${plural(count - remaining, 'candidat sera reporté', 'candidats seront reportés')} automatiquement : le plafond LinkedIn sera atteint.`;
  }

  return { kind, remaining, cap, used, count, percent, level, text, warning };
}

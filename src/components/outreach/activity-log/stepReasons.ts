/**
 * Raison d'une étape ignorée, annulée ou retenue, pour le suivi des séquences
 * (panneau des inscriptions, journal d'activité).
 *
 * Le catalogue (`skipReasonLabel`, src/lib/sequenceCatalog.ts) traduit la
 * plupart des raisons écrites par le moteur d'envoi. Les règles ci-dessous
 * couvrent celles qu'il ne connaît pas encore (compte déconnecté, abonnement,
 * conditions d'arrêt, limites d'envoi) : sans elles, ces étapes afficheraient
 * « Étape non exécutée ». Elles ont vocation à rejoindre SKIP_REASON_RULES.
 */

import { skipReasonLabel } from '@/lib/sequenceCatalog';

const EXTRA_REASON_RULES: [RegExp, string][] = [
  [/compte linkedin déconnecté/i, 'Compte LinkedIn déconnecté : reprise à la reconnexion'],
  [/abonnement requis/i, 'Abonnement requis'],
  [/stop condition: link clicked/i, 'Le candidat a cliqué sur le lien'],
  [/stop condition: unsubscribed/i, 'Le candidat s’est désinscrit'],
  [/stop condition: meeting booked/i, 'Rendez-vous pris'],
  [/hors plage horaire/i, "Hors de vos horaires d'envoi : envoi différé"],
  [/quota inmail épuisé/i, 'Crédits InMail épuisés'],
  [/contrôle de quota|quota check/i, "Limites d'envoi non vérifiées : envoi différé"],
  [/quota|plafond/i, "Limite d'envois atteinte : envoi différé"],
];

/** « Pas d'adresse e-mail », jamais « No email — channel skipped ». */
export function stepReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  for (const [pattern, label] of EXTRA_REASON_RULES) {
    if (pattern.test(reason)) return label;
  }
  return skipReasonLabel(reason);
}

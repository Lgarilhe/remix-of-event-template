// Liste des missions : phrases et dates de l'écran (design simplifié,
// docs/design/06-simplicite.md, règle 8 : pas de zéro affiché, pas d'état qui
// ne demande rien). Fonctions pures, jouées par tests/ux/liste-missions.test.mjs.
//
// Les nombres sont ceux de get_mission_stage_counts (effectifs « en ce moment »,
// CLAUDE.md, lots 0c) : ce module ne calcule rien, il choisit seulement quoi
// écrire. Un zéro n'est jamais écrit.

import { plural } from '@/lib/plural';
import { timeAgo } from '@/lib/relativeTime';

/** Effectifs que la liste affiche, dans l'ordre du Pipeline. */
export interface ListCounts {
  toSort: number;
  contacted: number;
  replied: number;
  interviewing: number;
}

/**
 * Les effectifs non nuls en une phrase courte, l'étape la plus avancée d'abord
 * (« 2 en entretien · 1 a répondu »). Chaîne vide quand tout est à zéro.
 */
export function countsPhrase(c: ListCounts): string {
  return [
    c.interviewing > 0 ? `${c.interviewing.toLocaleString('fr-FR')} en entretien` : null,
    c.replied > 0 ? plural(c.replied, 'a répondu', 'ont répondu') : null,
    c.contacted > 0 ? plural(c.contacted, 'contacté') : null,
    c.toSort > 0 ? `${c.toSort.toLocaleString('fr-FR')} à trier` : null,
  ].filter(Boolean).join(' · ');
}

/**
 * Sous-titre de la page : une phrase, seulement ce qui n'est pas nul, dans
 * l'ordre des lignes (« 4 missions en cours : 3 en entretien, 1 a répondu. »).
 * `sums` est null tant qu'une mission En cours n'a pas ses compteurs : la phrase
 * ne dit alors que le nombre de missions. Sans mission En cours : « Aucune mission en cours. »
 */
export function missionsSentence(ongoing: number, sums: ListCounts | null): string {
  if (ongoing === 0) return 'Aucune mission en cours.';
  const head = plural(ongoing, 'mission en cours', 'missions en cours');
  const detail = sums ? countsPhrase(sums).split(' · ').join(', ') : '';
  return detail ? `${head}\u00a0: ${detail}.` : `${head}.`;
}

/** Sous cette durée, une mission est en plein travail : « à l'instant » ne dirait rien, il est omis. */
export const QUIET_ACTIVITY_MS = 60 * 60 * 1000;

/**
 * Dernière activité d'une mission, en discret : « il y a 3 j », « 12 sept. ».
 * null quand elle date de moins d'une heure ou ne se lit pas : la liste est déjà
 * triée par activité, répéter « à l'instant » sur chaque ligne n'apprend rien.
 */
export function activityLabel(at: string | null | undefined, now: Date = new Date()): string | null {
  if (!at) return null;
  const ms = now.getTime() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < QUIET_ACTIVITY_MS) return null;
  return timeAgo(at, { now });
}

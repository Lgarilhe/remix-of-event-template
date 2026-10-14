// Refonte mission, lot 5f-2d : des profils de recherche vers les candidats de ContactFlow.
//
// Module pur : ni lecture, ni écriture. Les entrées hors Pipeline (Sourcing, recherche hors
// mission, fiches, messagerie) ont des profils vivants, sans ligne de mission : le candidat porte
// alors `rowId` nul et `ContactFlow` rend l'identifiant du profil à la place de la ligne.
// L'appelant fige la liste à l'ouverture : une sélection qui change pendant que la feuille est
// ouverte ne modifie pas ce que la personne y voit.

import type { LinkedInProfile } from '@/components/outreach/types';
import type { FlowCandidate } from './types';

/**
 * Candidats au plus par inscription : même valeur que CONTACT_FLOW_MAX de ContactFlow et de
 * useContactCandidates (ces fichiers n'importent pas la coquille de la page mission).
 */
export const FLOW_MAX = 400;

const NAMELESS = 'Profil sans nom';

function nameOf(profile: LinkedInProfile): string {
  const full = profile.name?.trim();
  if (full) return full;
  const parts = [profile.first_name, profile.last_name].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : NAMELESS;
}

/**
 * Un profil de recherche vers un candidat du flux. `rowId` : la ligne de la mission quand le
 * candidat en a une, sinon nul. `hasLinkedIn` : un lien de profil, comme le lit l'inscription.
 */
export function profileToFlowCandidate(
  profile: LinkedInProfile,
  options: { rowId?: string | null; hasLinkedIn?: boolean } = {},
): FlowCandidate {
  return {
    id: profile.id,
    rowId: options.rowId ?? null,
    candidateId: profile.id,
    name: nameOf(profile),
    headline: profile.headline ?? null,
    pictureUrl: profile.profile_picture_url ?? null,
    hasLinkedIn: options.hasLinkedIn ?? !!(profile.profile_url || profile.public_profile_url),
    profile,
  };
}

/** Les profils, une fois chacun (par identifiant, ordre gardé), coupés à FLOW_MAX ; `overflow` : le reste. */
export function profilesToFlowCandidates(
  profiles: readonly LinkedInProfile[],
): { candidates: FlowCandidate[]; overflow: number } {
  const seen = new Set<string>();
  const unique: LinkedInProfile[] = [];
  for (const profile of profiles) {
    if (!profile.id || seen.has(profile.id)) continue;
    seen.add(profile.id);
    unique.push(profile);
  }
  return {
    candidates: unique.slice(0, FLOW_MAX).map((profile) => profileToFlowCandidate(profile)),
    overflow: Math.max(0, unique.length - FLOW_MAX),
  };
}

// Refonte mission, lot 5f-2c : types partagés de ContactFlow (panneau Contacter).
// Contrat décrit dans docs/refonte-mission/lot5f2c-conception.md.
import type { LinkedInProfile } from '@/components/outreach/types';
import type { SequenceEnrollJob } from '@/components/outreach/SequenceEnrollButton';
import type { FlowEntryInput } from '@/lib/contactFlowGroups';

/** Un candidat de la sélection, prêt à classer, prévisualiser et inscrire. */
export interface FlowCandidate extends FlowEntryInput {
  /** profile.id : clé des inscriptions, de l'anti-doublon et des aperçus. */
  id: string;
  /** Ligne du Pipeline (ouvre la fiche, quitte la sélection après l'inscription). */
  rowId: string;
  candidateId: string;
  headline: string | null;
  pictureUrl: string | null;
  /** Prêt pour enrollCandidates, avec provider_id et network_distance quand ils sont connus. */
  profile: LinkedInProfile;
}

export type FlowCandidatesStatus = 'loading' | 'error' | 'ready';

export interface ContactFlowProps {
  /** Identifiant de la mission (uuid nu, sans « project: »). */
  missionId: string;
  /** Poste transmis à l'inscription (missionEnrollJob). */
  job: SequenceEnrollJob;
  candidates: readonly FlowCandidate[];
  candidatesStatus: FlowCandidatesStatus;
  /** Lignes sélectionnées au-delà du plafond de l'inscription (elles restent sélectionnées). */
  overflow: number;
  onRetryCandidates: () => void;
  /** Après une inscription : les lignes traitées quittent la sélection et le panneau passe sur « Contactés ». */
  onEnrolled: (handledRowIds: readonly string[]) => void;
  /** Ouvre la fiche d'un candidat (lien LinkedIn à compléter). */
  onOpenCandidate: (rowId: string) => void;
  /** « Voir les contactés » : quitte le mode Contacter sans rien inscrire. */
  onLeave: () => void;
}

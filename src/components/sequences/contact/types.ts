// Refonte mission, lots 5f-2c et 5f-2d : types partagés de ContactFlow (panneau Contacter).
// Contrats décrits dans docs/refonte-mission/lot5f2c-conception.md et lot5f2d-conception.md.
import type { LinkedInProfile } from '@/components/outreach/types';
import type { SequenceEnrollJob } from '@/components/outreach/SequenceEnrollButton';
import type { FlowEntryInput } from '@/lib/contactFlowGroups';
import type { SequenceStepRow } from './useSequenceSteps';

/** Un candidat de la sélection, prêt à classer, prévisualiser et inscrire. */
export interface FlowCandidate extends FlowEntryInput {
  /** profile.id : clé des inscriptions, de l'anti-doublon et des aperçus. */
  id: string;
  /**
   * Ligne du Pipeline (ouvre la fiche, quitte la sélection après l'inscription), ou null pour un
   * profil sans ligne (Sourcing, recherche hors mission, messagerie).
   */
  rowId: string | null;
  /** Identifiant du candidat (copie privée de la photo), ou null. */
  candidateId: string | null;
  headline: string | null;
  pictureUrl: string | null;
  /** Prêt pour enrollCandidates, avec provider_id et network_distance quand ils sont connus. */
  profile: LinkedInProfile;
}

export type FlowCandidatesStatus = 'loading' | 'error' | 'ready';

/** Avertissement du point d'entrée : texte fixe, ou calculé à partir des étapes de la séquence choisie. */
export type FlowNotice = string | ((steps: readonly SequenceStepRow[]) => string | null);

export interface ContactFlowProps {
  /** Identifiant de la mission (uuid nu, sans « project: »), null hors mission. */
  missionId: string | null;
  /** Poste transmis à l'inscription (missionEnrollJob), null hors mission : aucune ligne n'est alors écrite dans le Pipeline. */
  job: SequenceEnrollJob | null;
  candidates: readonly FlowCandidate[];
  candidatesStatus: FlowCandidatesStatus;
  /** Lignes sélectionnées au-delà du plafond de l'inscription (elles restent sélectionnées). Défaut 0. */
  overflow?: number;
  /** La sélection a changé et ses candidats sont relus : l'inscription attend (les candidats montrés sont ceux d'avant). */
  refreshing?: boolean;
  /** Absent : la porte d'erreur n'a pas de bouton « Réessayer ». */
  onRetryCandidates?: () => void;
  /**
   * Après une inscription : une clé par candidat traité, `rowId` quand la ligne existe, sinon `id` du
   * profil. L'appelant sait ce qu'il a donné ; le panneau de la mission quitte alors sur « Contactés ».
   */
  onEnrolled: (handledIds: readonly string[]) => void;
  /** Ouvre la fiche d'un candidat avec ligne (lien LinkedIn à compléter). Absent : pas de bouton « Ouvrir la fiche ». */
  onOpenCandidate?: (rowId: string) => void;
  /** Sortie du mode (Pipeline : « Voir les contactés » ; feuille : fermeture). */
  onLeave: () => void;
  // Lot 5f-2d, tous facultatifs : le défaut est le comportement du lot 5f-2c.
  /** Compte d'envoi imposé par le point d'entrée ; absent ou null : le compte propre de la personne. */
  accountId?: string | null;
  /** Avertissement du point d'entrée, montré sous le choix de la séquence et dans la fenêtre de relecture. */
  notice?: FlowNotice | null;
  /** Libellé du bouton de sortie ; null : pas de bouton (le conteneur a sa croix). Défaut « Voir les contactés ». */
  leaveLabel?: string | null;
  /** Deuxième phrase de la porte « aucun candidat ». */
  emptyHint?: string;
  /** Le conteneur retient sa fermeture tant que l'écriture dure. */
  onBusyChange?: (busy: boolean) => void;
  /** La fenêtre de relecture a retenu des candidats sans en inscrire : l'appelant relit ses statuts. */
  onChanged?: () => void;
  /** Séquence proposée d'avance (page séquence) ; absente du menu : aucune séquence choisie, jamais une autre. */
  preferredSequenceId?: string | null;
}

/**
 * Types et constantes de la shortlist / pipeline candidats (données Notion).
 *
 * Extraits de l'ancienne page `src/pages/Candidates.tsx` (supprimée : la route
 * /candidates redirige vers /pipeline). Consommés par `pages/ATS.tsx`,
 * `components/candidates/*` et `hooks/useNotionCandidates.ts`.
 */

export interface Candidate {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  expertise: string[];
  seniority: string | null;
  source: string | null;
  sourceUrl: string | null;
  location: string | null;
  availability: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  tjm: number | null;
  firstContactDate: string | null;
  createdAt: string | null;
  positionIds: string[];
  shortlistIds: string[];
}

export interface ShortlistEntry {
  id: string;
  name: string;
  stage: string | null;
  entity: string | null;
  presentiComments: string | null;
  cycle: string | null;
  preQualifDate: string | null;
  cvPresentationDate: string | null;
  managerReturnDate: string | null;
  managerDecisionDate: string | null;
  offerValidationDate: string | null;
  startDate: string | null;
  createdAt: string | null;
  positionIds: string[];
  positions: { id: string; name: string }[];
  candidate: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    linkedin: string | null;
    expertise: string[];
    seniority: string | null;
  } | null;
}

export const PIPELINE_STAGES = [
  { key: 'Pressenti', label: 'Pressenti', color: 'bg-muted border-border' },
  { key: 'CV envoyé', label: 'CV envoyé', color: 'bg-info/10 border-info/30' },
  { key: 'ITW en cours', label: 'ITW en cours', color: 'bg-warning/10 border-warning/30' },
  { key: 'Offre', label: 'Offre', color: 'bg-brand-purple/10 border-brand-purple/30' },
  { key: 'Gagné', label: 'Gagné', color: 'bg-success/10 border-success/30' },
  { key: 'Perdu', label: 'Perdu', color: 'bg-destructive/10 border-destructive/30' },
];

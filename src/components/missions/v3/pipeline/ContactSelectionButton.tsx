// Refonte mission, lot 2 : « Contacter » sur une sélection du Pipeline. Bouton
// d'inscription existant (SequenceEnrollButton), avec le poste de la mission ;
// les lignes sans profil LinkedIn sont laissées de côté, et le dit. Dans la
// barre d'actions, bouton plein clair (maquette) : le style du bouton partagé
// est surchargé ici, sans toucher au composant.

import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SequenceEnrollButton, type SequenceEnrollJob } from '@/components/outreach/SequenceEnrollButton';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import type { ATSCandidate } from '@/hooks/useATSData';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { atsCandidateToProfile } from '@/lib/atsCandidateToProfile';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/plural';
import { GENERAL_STAGE_LABEL } from '@/lib/stageDisplay';
import type { MissionCandidateRow } from '../types';

/** Poste transmis à l'inscription : le poste synthétique de la mission (« project:{id} »). */
export function missionEnrollJob(project: SourcingProject): SequenceEnrollJob {
  const jd = project.job_details ?? {};
  return {
    id: `project:${project.id}`,
    title: jd.title || project.name,
    skills: [...(jd.skills_must_have ?? []), ...(jd.skills_should_have ?? [])],
    description: [jd.mission_description, jd.context].filter(Boolean).join('\n\n') || undefined,
    location: jd.location || undefined,
  };
}

/** Ligne de la mission vers le candidat attendu par l'adaptateur de profil. */
function rowToAtsCandidate(row: MissionCandidateRow, project: SourcingProject): ATSCandidate {
  return {
    id: row.id,
    candidateId: row.candidateId,
    name: row.name ?? '',
    email: null,
    phone: null,
    linkedin: row.linkedinUrl,
    headline: row.headline,
    expertise: [],
    stage: GENERAL_STAGE_LABEL[row.stage],
    entity: null,
    source: 'local',
    sourceId: row.id,
    jobId: row.jobId,
    jobTitle: project.job_details?.title ?? project.name,
    lastActivity: row.updatedAt,
    createdAt: row.createdAt ?? '',
    score: row.score,
    recommendation: row.recommendation,
    tags: row.tags,
    linkedinProfileData: null,
  };
}

/** « 1 candidat sans profil LinkedIn, laissé de côté. » ; null si aucun. */
export function missingLinkedInText(count: number): string | null {
  if (!(count > 0)) return null;
  return count > 1
    ? `${plural(count, 'candidat')} sans profil LinkedIn, laissés de côté.`
    : `${plural(count, 'candidat')} sans profil LinkedIn, laissé de côté.`;
}

/** Bouton plein clair (couleur du texte en fond). */
const FILLED = 'border-0 bg-foreground text-background hover:bg-foreground/90 hover:text-background';
/** Même style imposé au déclencheur de SequenceEnrollButton (enfant direct). */
const FILLED_TRIGGER =
  '[&>button]:!h-8 [&>button]:!border-0 [&>button]:!bg-foreground [&>button]:!text-[13px] [&>button]:!text-background ' +
  '[&>button]:!shadow-none [&>button:hover]:!bg-foreground/90';

interface ContactSelectionButtonProps {
  rows: readonly MissionCandidateRow[];
  project: SourcingProject;
  disabled: boolean;
  onSuccess: () => void;
}

export function ContactSelectionButton({ rows, project, disabled, onSuccess }: ContactSelectionButtonProps) {
  const { selectedAccount, accountsLoading } = useFilteredLinkedInAccounts();
  const withLinkedIn = useMemo(() => rows.filter((row) => !!row.linkedinUrl), [rows]);
  const profiles = useMemo(
    () => withLinkedIn.map((row) => atsCandidateToProfile(rowToAtsCandidate(row, project))),
    [withLinkedIn, project],
  );
  const job = useMemo(() => missionEnrollJob(project), [project]);
  const missing = missingLinkedInText(rows.length - withLinkedIn.length);

  let control: ReactNode;
  if (accountsLoading) {
    control = <Skeleton className="h-8 w-24" aria-label="Chargement des comptes LinkedIn" />;
  } else if (disabled || !selectedAccount || profiles.length === 0) {
    control = (
      <Button variant="outline" size="sm" disabled className={FILLED}>
        <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Contacter
      </Button>
    );
  } else {
    control = (
      <div role="group" aria-label="Contacter" className={cn('inline-flex', FILLED_TRIGGER)}>
        <SequenceEnrollButton
          selectedProfiles={profiles}
          accountId={selectedAccount}
          selectedJob={job}
          onSuccess={onSuccess}
          triggerLabel="Contacter"
        />
      </div>
    );
  }

  const noAccount = !accountsLoading && !disabled && !selectedAccount;
  const note = noAccount ? 'Reliez votre compte LinkedIn pour contacter.' : missing;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {control}
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
      {noAccount && (
        <Link
          to="/settings/account/connections"
          className="rounded-sm text-xs font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Relier LinkedIn
        </Link>
      )}
    </div>
  );
}

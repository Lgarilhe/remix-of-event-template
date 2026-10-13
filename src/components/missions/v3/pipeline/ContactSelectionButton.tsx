// Refonte mission, lot 2 : « Contacter » sur une sélection du Pipeline. Bouton
// d'inscription existant (SequenceEnrollButton), avec le poste de la mission ;
// les lignes sans profil LinkedIn sont laissées de côté, et le dit. Dans la
// barre d'actions, bouton plein clair (maquette) : le style du bouton partagé
// est surchargé ici, sans toucher au composant.
//
// Lot 5f-2c, interrupteur des séquences allumé : « Contacter » ouvre le panneau
// Prise de contact en mode Contacter, sur la sélection (les lignes sans profil
// LinkedIn y sont rangées « à compléter », plus écartées ici). Éteint : le menu
// « Séquence » d'avant, inchangé.

import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SequenceEnrollButton, type SequenceEnrollJob } from '@/components/outreach/SequenceEnrollButton';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { useSequencesBeta } from '@/hooks/useSequencesBeta';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { atsCandidateToProfile } from '@/lib/atsCandidateToProfile';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/plural';
import { useMissionV3 } from '../MissionV3Context';
import { useMissionSelection } from '../shell/missionSelectionContext';
import type { MissionCandidateRow } from '../types';
import { rowToAtsCandidate } from './useContactCandidates';

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

/** « 1 candidat sans profil LinkedIn, laissé de côté. » ; null si aucun. */
export function missingLinkedInText(count: number): string | null {
  if (!(count > 0)) return null;
  return count > 1
    ? `${plural(count, 'candidat')} sans profil LinkedIn, laissés de côté.`
    : `${plural(count, 'candidat')} sans profil LinkedIn, laissé de côté.`;
}

/**
 * Aplat d'encre imposé au déclencheur de SequenceEnrollButton (enfant direct). Le bouton désactivé
 * prend la variante primary : son désactivé (fond gris, libellé gris, 5,10:1) remplace l'aplat,
 * jamais un libellé gris sur l'encre.
 */
const FILLED_TRIGGER =
  '[&>button]:!h-8 [&>button]:!border-0 [&>button]:!bg-foreground [&>button]:!text-sm [&>button]:!text-background ' +
  '[&>button]:!shadow-none [&>button:hover]:!bg-foreground/90';

interface ContactSelectionButtonProps {
  rows: readonly MissionCandidateRow[];
  project: SourcingProject;
  disabled: boolean;
  onSuccess: () => void;
}

export function ContactSelectionButton({ rows, project, disabled, onSuccess }: ContactSelectionButtonProps) {
  const { selectedAccount, accountsLoading } = useFilteredLinkedInAccounts();
  const sequencesV2 = useSequencesBeta();
  const { openContactFlow } = useMissionV3();
  const { selection, setSelection } = useMissionSelection();
  const withLinkedIn = useMemo(() => rows.filter((row) => !!row.linkedinUrl), [rows]);
  const profiles = useMemo(
    () => withLinkedIn.map((row) => atsCandidateToProfile(rowToAtsCandidate(row, project))),
    [withLinkedIn, project],
  );
  const job = useMemo(() => missionEnrollJob(project), [project]);
  const missing = missingLinkedInText(rows.length - withLinkedIn.length);

  // Interrupteur allumé : le panneau lit la sélection du Pipeline. Depuis la barre elle est déjà
  // celle des lignes reçues ; depuis la fiche d'un Retenu, elle devient ce candidat seul.
  const openFlow = () => {
    const same = rows.length === selection.size && rows.every((row) => selection.has(row.id));
    if (!same) setSelection(new Map(rows.map((row) => [row.id, row] as const)));
    openContactFlow();
  };

  // Allumé, un candidat sans profil LinkedIn ne bloque rien ici : le panneau le range « à compléter ».
  const nothingToContact = sequencesV2 ? rows.length === 0 : profiles.length === 0;

  let control: ReactNode;
  if (accountsLoading) {
    control = <Skeleton className="h-8 w-24" aria-label="Chargement des comptes LinkedIn" />;
  } else if (disabled || !selectedAccount || nothingToContact) {
    control = (
      <Button variant="primary" size="sm" disabled>
        <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Contacter
      </Button>
    );
  } else if (sequencesV2) {
    control = (
      <Button type="button" variant="primary" size="sm" className="max-sm:min-h-11" onClick={openFlow}>
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
  const note = noAccount ? 'Reliez votre compte LinkedIn pour contacter.' : sequencesV2 ? null : missing;

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

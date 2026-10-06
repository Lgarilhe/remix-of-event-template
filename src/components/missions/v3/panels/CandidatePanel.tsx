// Refonte mission, lot 2 : fiche candidat propre à la mission (conception 4.4),
// dans le panneau de droite (le cadre, sans voile, est PanelHost).
//
// Données : useMissionCandidateDetail (ligne de mission_candidate_rows, profil
// LinkedIn, notes, rappels) et useCandidateFullProfile. Onglets existants de
// src/components/ats/candidate-detail/** et src/components/outreach/**,
// importés tels quels. Gestes d'étape : useMissionStageActions sur tout le
// groupe de la ligne ; la fiche reste ouverte et se relit.
// Aperçu : vos notes, les rappels et les commentaires de l'équipe (les
// demandes à l'assistant arrivent au lot 9).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { ActivityTab } from '@/components/ats/candidate-detail';
import { CandidateCommentsTab } from '@/components/ats/CandidateCommentsTab';
import { EvaluationTab } from '@/components/ats/candidate-detail/EvaluationTab';
import { ProfileDetailedTab } from '@/components/ats/candidate-detail/ProfileDetailedTab';
import { CVTab } from '@/components/ats/candidate-detail/CVTab';
import { ManualContactsEditor } from '@/components/ats/candidate-detail/ManualContactsEditor';
import { CardMessageThread } from '@/components/outreach/result-card/CardMessageThread';
import { CandidateSequencesPanel } from '@/components/outreach/CandidateSequencesPanel';
import { useOrganization } from '@/hooks/useOrganization';
import { useMissionProcess } from '@/hooks/useMissionProcess';
import { useCandidateFullProfile } from '@/hooks/useCandidateFullProfile';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { useMissionCandidateDetail } from '@/hooks/useMissionCandidateDetail';
import { useMissionStageActions } from '@/hooks/useMissionStageActions';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateStageReaders } from '@/lib/stageDisplay';
import { atsCandidateToProfile } from '@/lib/atsCandidateToProfile';
import { useMissionV3 } from '../MissionV3Context';
import { ContactSelectionButton } from '../pipeline/ContactSelectionButton';
import {
  rowStageLabel,
  type CandidatePanelProps,
  type CandidatePanelTab,
  type MissionCandidateDetailRow,
  type MissionStepRef,
  type MoveOption,
  type StageMoveRequest,
} from '../types';
import {
  buildEnrichedProfile,
  candidateDisplayName,
  candidatePictureUrl,
  neighborRowIds,
  positionLine,
  rowPosition,
  scoreReasons,
  toAtsCandidate,
} from './candidateAdapters';
import { CandidateNotesSection } from './CandidateNotesSection';
import { CandidatePanelHeader } from './CandidatePanelHeader';
import { CandidateRemindersSection } from './CandidateRemindersSection';
import { CandidatePanelTabs, type CandidatePanelTabKey } from './CandidatePanelTabs';
import { getRememberedPanelTab, rememberPanelTab } from './panelTabMemory';


/** Couches ouvertes qui gardent les flèches pour elles (menus, listes, fenêtres). */
const OPEN_LAYER_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(', ');

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <SectionErrorBoundary fallbackTitle="Cette partie n'a pas pu s'afficher">{children}</SectionErrorBoundary>
    </section>
  );
}

function CloseBar({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex justify-end px-4 pt-3 sm:px-5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Fermer le panneau"
        title="Fermer (Échap)"
        className="min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
        onClick={onClose}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

function PanelSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <div aria-busy="true" aria-label="Chargement de la fiche">
      <CloseBar onClose={onClose} />
      <div className="space-y-3 border-b border-border px-4 pb-4 sm:px-5">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-5 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <div className="flex gap-3 border-b border-border px-4 py-3 sm:px-5">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-4 w-16" />
        ))}
      </div>
      <div className="space-y-3 px-4 py-4 sm:px-5">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}

function PanelMessage({
  titleId,
  title,
  onClose,
  action,
}: {
  titleId: string;
  title: string;
  onClose: () => void;
  action: ReactNode;
}) {
  return (
    <div>
      <CloseBar onClose={onClose} />
      <div role="alert" className="px-4 pb-6 pt-2 sm:px-5">
        <h2 id={titleId} tabIndex={-1} className="text-sm font-medium text-foreground outline-none">
          {title}
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">{action}</div>
      </div>
    </div>
  );
}

export function CandidatePanel({ rowId, titleId, onClose }: CandidatePanelProps): JSX.Element | null {
  const { project, openCandidate } = useMissionV3();
  const detail = useMissionCandidateDetail(project.id, rowId);
  const row = detail.row;

  // Ligne canonique changée (doublons réunis) : l'adresse suit la ligne affichée.
  useEffect(() => {
    if (row && row.id !== rowId) openCandidate(row.id, { replace: true });
  }, [row, rowId, openCandidate]);

  if (detail.isLoading) return <PanelSkeleton onClose={onClose} />;
  if (detail.isError) {
    return (
      <PanelMessage
        titleId={titleId}
        title="Impossible de charger la fiche."
        onClose={onClose}
        action={
          <Button type="button" variant="outline" size="sm" onClick={detail.refetch}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Réessayer
          </Button>
        }
      />
    );
  }
  if (!row) {
    return (
      <PanelMessage
        titleId={titleId}
        title="Ce candidat n'est plus dans cette mission, ou vous n'y avez pas accès."
        onClose={onClose}
        action={
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Fermer
          </Button>
        }
      />
    );
  }
  return <CandidatePanelLoaded rowId={rowId} titleId={titleId} onClose={onClose} row={row} detail={detail} />;
}

interface LoadedProps extends CandidatePanelProps {
  row: MissionCandidateDetailRow;
  detail: ReturnType<typeof useMissionCandidateDetail>;
}

function CandidatePanelLoaded({ rowId, titleId, onClose, row, detail }: LoadedProps) {
  const { project, canMoveCandidates, moveDisabledReason, visibleRowIds, openCandidate } = useMissionV3();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const { steps } = useMissionProcess(project.id);
  const actions = useMissionStageActions(project.id);
  const { selectedAccount } = useFilteredLinkedInAccounts();
  const fullProfile = useCandidateFullProfile(row.candidateId, row.linkedinUrl);
  const [tab, setTabState] = useState<CandidatePanelTabKey>(getRememberedPanelTab);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const setTab = (key: CandidatePanelTabKey) => {
    rememberPanelTab(key);
    setTabState(key);
  };

  const stepRefs: MissionStepRef[] = useMemo(
    () => steps.map((s) => ({ id: s.id, name: s.name, step_order: s.step_order })),
    [steps],
  );
  const stageLabel = rowStageLabel(row, stepRefs);
  const profileData = detail.profileData;
  const enriched = useMemo(
    () => buildEnrichedProfile(profileData, { name: row.name, headline: row.headline }),
    [profileData, row.name, row.headline],
  );
  const candidate = useMemo(
    () => toAtsCandidate(row, project, stageLabel, profileData),
    [row, project, stageLabel, profileData],
  );
  const pipelineProfile = useMemo(() => atsCandidateToProfile(candidate), [candidate]);
  const reasons = useMemo(() => scoreReasons(row.scoringDetails), [row.scoringDetails]);
  const name = candidateDisplayName(row, profileData);
  const pictureUrl = candidatePictureUrl(row, profileData);
  const position = positionLine(enriched, row.headline);
  const location = enriched?.location ?? null;
  const accountId = fullProfile.accountId || selectedAccount || undefined;
  const jobTitle = candidate.jobTitle;

  // Voisins dans la liste affichée par Pipeline.
  const ownIds = [rowId, row.id, ...row.groupIds];
  const { previous, next } = neighborRowIds(visibleRowIds, ownIds);
  const rank = rowPosition(visibleRowIds, ownIds);
  const goPrevious = previous ? () => openCandidate(previous, { replace: true }) : null;
  const goNext = next ? () => openCandidate(next, { replace: true }) : null;

  // Flèches haut et bas : candidat voisin, sauf dans un champ, un menu ou une fenêtre.
  const neighbors = useRef({ goPrevious, goNext });
  neighbors.current = { goPrevious, goNext };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isEditable(event.target)) return;
      if (document.querySelector(OPEN_LAYER_SELECTOR)) return;
      const panel = rootRef.current?.closest('[data-testid="mission-panel"]') ?? rootRef.current;
      const target = event.target;
      const inPanel = target instanceof Node && !!panel?.contains(target);
      if (!inPanel && target !== document.body) return;
      const go = event.key === 'ArrowUp' ? neighbors.current.goPrevious : neighbors.current.goNext;
      if (!go) return;
      event.preventDefault();
      go();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onMove = (option: MoveOption, verb: StageMoveRequest['verb']) => {
    if (!canMoveCandidates || actions.isMoving) return;
    void actions.move({ rows: [row], target: option.target, verb });
  };

  // Retenu : Contacter (inscription dans une séquence de la mission), avant « Étape suivante ».
  const contactAction =
    row.stage === 'retained' ? (
      <ContactSelectionButton
        rows={[row]}
        project={project}
        disabled={!canMoveCandidates || actions.isMoving}
        onSuccess={() => void invalidateStageReaders(queryClient)}
      />
    ) : null;

  const tabs: CandidatePanelTab[] = [
    {
      key: 'apercu',
      label: 'Aperçu',
      content: (
        <div className="space-y-6">
          <SectionErrorBoundary fallbackTitle="Vos notes n'ont pas pu s'afficher">
            <CandidateNotesSection
              notes={detail.notes}
              loading={detail.notesLoading}
              onAdd={detail.addNote}
              onDelete={detail.deleteNote}
            />
          </SectionErrorBoundary>
          <SectionErrorBoundary fallbackTitle="Les rappels n'ont pas pu s'afficher">
            <CandidateRemindersSection
              reminders={detail.reminders}
              onAdd={(title, date) => detail.addReminder(title, date, jobTitle)}
              onDelete={detail.deleteReminder}
            />
          </SectionErrorBoundary>
          <section aria-label="Commentaires de l'équipe" className="flex min-w-0 flex-col gap-2">
            <h3 className="text-md font-semibold text-foreground">Commentaires de l'équipe</h3>
            <SectionErrorBoundary fallbackTitle="Les commentaires n'ont pas pu s'afficher">
              <CandidateCommentsTab candidateId={row.candidateId} candidateName={name} jobId={row.jobId} />
            </SectionErrorBoundary>
          </section>
        </div>
      ),
    },
    {
      key: 'echanges',
      label: 'Échanges',
      content: (
        <div className="space-y-6">
          <PanelSection title="Messages">
            <CardMessageThread
              key={`${row.candidateId}:${accountId ?? ''}`}
              accountId={accountId}
              profileId={row.candidateId}
              profileName={name}
              projectId={project.id}
              onMessageSent={() => void invalidateStageReaders(queryClient)}
            />
          </PanelSection>
          <PanelSection title="Séquences">
            <CandidateSequencesPanel profileId={row.candidateId} hideTitle />
          </PanelSection>
          <PanelSection title="Activité">
            <ActivityTab loading={fullProfile.loading} timeline={fullProfile.timeline} />
          </PanelSection>
        </div>
      ),
    },
    {
      key: 'evaluations',
      label: 'Évaluations',
      content: (
        <SectionErrorBoundary fallbackTitle="Évaluations indisponibles">
          <EvaluationTab
            candidate={candidate}
            candidateWithProfileData={candidate}
            enrichedProfile={enriched}
            fullProfile={fullProfile}
            onOpenMobileProfile={() => setTab('profil')}
          />
        </SectionErrorBoundary>
      ),
    },
    {
      key: 'profil',
      label: 'Profil',
      content: (
        <div className="space-y-6">
          <PanelSection title="Parcours">
            {detail.profileLoading ? (
              <div className="space-y-2" aria-busy="true" aria-label="Chargement du profil">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : profileData ? (
              <ProfileDetailedTab linkedinProfileData={profileData} enrichedProfile={enriched} />
            ) : (
              <p className="text-sm text-muted-foreground">Aucun profil LinkedIn enregistré pour ce candidat.</p>
            )}
          </PanelSection>
          <PanelSection title="CV">
            <CVTab candidateId={row.candidateId} organizationId={organizationId} candidateName={name} />
          </PanelSection>
          <PanelSection title="Coordonnées">
            {organizationId ? (
              <ManualContactsEditor
                candidateId={row.candidateId}
                organizationId={organizationId}
                existingEmails={(pipelineProfile.contact_info?.emails as string[] | undefined) || []}
                existingPhones={(pipelineProfile.contact_info?.phones as string[] | undefined) || []}
              />
            ) : (
              <Skeleton className="h-16 w-full" />
            )}
          </PanelSection>
        </div>
      ),
    },
  ];

  return (
    <div ref={rootRef} className="flex min-h-full min-w-0 flex-col">
      <CandidatePanelHeader
        titleId={titleId}
        row={row}
        steps={stepRefs}
        name={name}
        pictureUrl={pictureUrl}
        position={position}
        location={location}
        reasons={reasons}
        canMove={canMoveCandidates}
        moveDisabledReason={moveDisabledReason}
        isMoving={actions.isMoving}
        onMove={onMove}
        onClose={onClose}
        onPrevious={goPrevious}
        onNext={goNext}
        rank={rank}
        contactAction={contactAction}
      />
      <CandidatePanelTabs tabs={tabs} active={tab} onChange={setTab} />
    </div>
  );
}

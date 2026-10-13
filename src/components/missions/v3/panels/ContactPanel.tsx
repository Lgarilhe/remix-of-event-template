// Refonte mission, lot 1 : panneau Prise de contact (conception 5.3, accès
// provisoire). Les séquences de la mission et les invitations, avec les
// composants d'aujourd'hui tels quels (SequencesList, InvitationsPanel). Pas de
// bandeau « candidats Go » ni de chiffres d'inscriptions : la conception les
// retire. MissionOutreach reste pour l'ancienne page.
// En-tête : titre, poste et client ; pied collé en bas : comment contacter.
//
// Lot 5f-2b, interrupteur des séquences allumé : deux onglets, « Contactés »
// (les candidats de la mission rangés par ContactedList, ouvert au départ s'il
// a une ligne) puis « Séquences ». Les invitations reçues sont dans la
// messagerie (lot 5f-3). Interrupteur éteint : l'ancien panneau, inchangé.
//
// Lot 5f-2c, interrupteur allumé et `?contacter=1` : le panneau est en mode
// Contacter. Il rend ContactFlow sur la sélection du Pipeline (contexte de la
// coquille), relue à l'ouverture (useContactCandidates). Le choix d'un onglet
// quitte ce mode. Rechargé sans sélection (elle n'est qu'en mémoire), il
// s'ouvre sur « Contactés ».
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { EmptyLinkedInAccountState } from '@/components/missions/EmptyLinkedInAccountState';
import { SequencesList } from '@/components/outreach/SequencesList';
import { InvitationsPanel } from '@/components/outreach/InvitationsPanel';
import { ContactFlow } from '@/components/sequences/contact/ContactFlow';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { useMissionContactedView } from '@/hooks/useMissionContacted';
import { useOrganization } from '@/hooks/useOrganization';
import { useSequencesBeta } from '@/hooks/useSequencesBeta';
import { cn } from '@/lib/utils';
import { useMissionV3 } from '../MissionV3Context';
import { missionEnrollJob } from '../pipeline/ContactSelectionButton';
import { useContactCandidates } from '../pipeline/useContactCandidates';
import { ArchivedNotice } from '../shell/ArchivedNotice';
import { useMissionSelection } from '../shell/missionSelectionContext';
import { PANEL_FULLSCREEN_QUERY, useMediaQuery } from '../shell/useMediaQuery';
import type { ContactPanelProps } from '../types';
import { ContactedList } from './ContactedList';

type ContactTab = 'contactes' | 'sequences' | 'invitations';

/** Interrupteur éteint : l'ancien panneau, Séquences et Invitations. */
const TABS: readonly { key: ContactTab; label: string }[] = [
  { key: 'sequences', label: 'Séquences' },
  { key: 'invitations', label: 'Invitations' },
];

/** Interrupteur allumé (lot 5f-2b) : les candidats contactés, puis les séquences. */
const TABS_V2: readonly { key: ContactTab; label: string }[] = [
  { key: 'contactes', label: 'Contactés' },
  { key: 'sequences', label: 'Séquences' },
];

/** Paramètre d'onglet repris de l'ancienne vue Prise de contact. */
const OUTREACH_PARAM = 'outreach';

/** Lot 5f-2c : « contacter=1 » met le panneau en mode Contacter (voir MissionWorkspaceV3). */
const CONTACT_PARAM = 'contacter';

/** Pas de lien de conversation connu (liste lue sans eux). */
const NO_CHATS: ReadonlyMap<string, string> = new Map();

/** Lot 5f-3 : avec l'interrupteur des séquences allumé, les invitations reçues vivent dans la messagerie. */
const INBOX_INVITATIONS_PATH = '/inbox?onglet=invitations';

export function ContactPanel({ titleId, onClose }: ContactPanelProps): JSX.Element | null {
  const { project, isArchived, openCandidate } = useMissionV3();
  const { selection, setSelection } = useMissionSelection();
  const { organizationId } = useOrganization();
  const { accounts, accountsLoading, selectedAccount, setSelectedAccount } = useFilteredLinkedInAccounts();
  const navigate = useNavigate();
  const location = useLocation();
  const baseId = useId();
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  // Panneau plein écran (sous lg) : le bandeau « Réactiver » de la page est derrière lui, inerte.
  const fullscreen = useMediaQuery(PANEL_FULLSCREEN_QUERY);

  // Interrupteur éteint : le panneau provisoire garde son onglet Invitations.
  const sequencesV2 = useSequencesBeta();
  const invitationsInPanel = !sequencesV2;
  const tabs = sequencesV2 ? TABS_V2 : TABS;
  const outreachParam = new URLSearchParams(location.search).get(OUTREACH_PARAM);
  const asksInvitations = outreachParam === 'invitations';
  // Mode Contacter : interrupteur allumé, mission en cours, adresse en `?contacter=1`.
  const asksFlow = sequencesV2 && !isArchived && new URLSearchParams(location.search).get(CONTACT_PARAM) === '1';
  // Choix de la personne ou de l'adresse (?outreach=contactes|sequences). Sans lui,
  // interrupteur allumé : « Contactés » s'ouvre s'il a une ligne, sinon « Séquences ».
  const [chosen, setChosen] = useState<ContactTab | null>(() => {
    if (sequencesV2) return outreachParam === 'contactes' || outreachParam === 'sequences' ? outreachParam : null;
    return asksInvitations ? 'invitations' : 'sequences';
  });
  const contacted = useMissionContactedView(project.id, project.job_id, { enabled: sequencesV2 && !isArchived });
  // Onglet de départ, tranché une fois par la première lecture des contactés puis gardé : une relecture
  // (retour sur l'onglet, inscription faite à côté) ne fait pas changer d'onglet sous les mains de la
  // personne. Une lecture en échec ouvre « Séquences ». null : la lecture décide encore.
  const startTab = useRef<ContactTab | null>(null);
  if (sequencesV2 && startTab.current === null && !contacted.isPending) {
    startTab.current = (contacted.view?.total ?? 0) > 0 ? 'contactes' : 'sequences';
  }
  const tab: ContactTab | null = sequencesV2 ? chosen ?? startTab.current : chosen ?? 'sequences';

  // L'onglet suit l'adresse (?outreach=), par remplacement et sans perdre le
  // marqueur d'historique du panneau (Retour le ferme toujours). Interrupteur
  // allumé, « Séquences » s'écrit aussi : sans cela l'adresse rouvrirait « Contactés ».
  const setTab = useCallback(
    (next: ContactTab) => {
      setChosen(next);
      const params = new URLSearchParams(location.search);
      // Choisir un onglet quitte le mode Contacter.
      params.delete(CONTACT_PARAM);
      if (!sequencesV2 && next === 'sequences') params.delete(OUTREACH_PARAM);
      else params.set(OUTREACH_PARAM, next);
      const query = params.toString();
      const to = `${location.pathname}${query ? `?${query}` : ''}`;
      if (to !== `${location.pathname}${location.search}`) navigate(to, { replace: true, state: location.state });
    },
    [location.pathname, location.search, location.state, navigate, sequencesV2],
  );

  // Mode Contacter : les lignes cochées sont relues à l'ouverture (lien LinkedIn, fournisseur, réseau).
  const flow = useContactCandidates(project, [...selection.values()], asksFlow);
  const job = useMemo(() => missionEnrollJob(project), [project]);
  // Après l'inscription : les lignes traitées quittent la sélection, puis « Contactés ».
  const onEnrolled = useCallback(
    (handledRowIds: readonly string[]) => {
      const handled = new Set(handledRowIds);
      setSelection((prev) => {
        const next = new Map(prev);
        for (const id of handled) next.delete(id);
        return next;
      });
      setTab('contactes');
    },
    [setSelection, setTab],
  );
  const onLeave = useCallback(() => setTab('contactes'), [setTab]);
  // Rechargement : la sélection n'est qu'en mémoire, `?contacter=1` seul ne la rend pas.
  // Au montage, sans sélection, le panneau s'ouvre sur « Contactés » (jamais ensuite : vider la
  // sélection panneau ouvert laisse l'état vide de ContactFlow).
  const reloadChecked = useRef(false);
  const selectionSize = selection.size;
  useEffect(() => {
    if (reloadChecked.current) return;
    reloadChecked.current = true;
    if (asksFlow && selectionSize === 0) setTab('contactes');
  }, [asksFlow, selectionSize, setTab]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    setTab(next.key);
    buttons.current[next.key]?.focus();
  };

  // Un lien ?outreach=invitations (notification, favori) mène à la messagerie.
  if (!invitationsInPanel && asksInvitations) return <Navigate to={INBOX_INVITATIONS_PATH} replace />;

  const loadingAccounts = (
    <div className="space-y-3 px-4 py-4 sm:px-5" aria-busy="true" aria-label="Chargement des comptes LinkedIn">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
  const noAccount = (
    <div className="px-4 py-4 sm:px-5">
      <EmptyLinkedInAccountState message="Pour gérer vos séquences, reliez d'abord un compte LinkedIn." />
    </div>
  );

  const tabBar = (
    <div
      role="tablist"
      aria-label="Prise de contact"
      className="sticky top-0 z-10 flex shrink-0 gap-1 border-b border-border bg-background px-3 sm:px-4"
    >
      {tabs.map((item, index) => {
        const selected = item.key === tab;
        return (
          <button
            key={item.key}
            ref={(el) => {
              buttons.current[item.key] = el;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${item.key}`}
            aria-selected={selected}
            aria-controls={`${baseId}-panel-${item.key}`}
            // Onglet encore indécis (lecture des contactés en cours) : le premier reste atteignable au clavier.
            tabIndex={selected || (tab === null && index === 0) ? 0 : -1}
            onClick={() => setTab(item.key)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
            className={cn(
              'relative h-10 shrink-0 px-2.5 text-sm transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              selected ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            <span
              aria-hidden="true"
              className={cn(
                'absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-colors duration-150',
                selected ? 'bg-brand' : 'bg-transparent',
              )}
            />
          </button>
        );
      })}
    </div>
  );

  const sequencesList = (
    <SectionErrorBoundary fallbackTitle="Les séquences n'ont pas pu s'afficher">
      <SequencesList
        accounts={accounts}
        selectedAccount={selectedAccount}
        isVisible={tab === 'sequences'}
        projectId={project.id}
        createRequestId={0}
        layout="compact"
        // À côté de la page (lg et plus), la page garde son bouton plein ; en plein écran, le panneau a le sien.
        besidePage={!fullscreen}
      />
    </SectionErrorBoundary>
  );

  let body: JSX.Element;
  if (isArchived) {
    body = (
      <div className="px-4 py-4 sm:px-5">
        <ArchivedNotice
          text={invitationsInPanel
            ? 'La prise de contact est fermée. Réactivez la mission pour gérer ses séquences et ses invitations.'
            : 'La prise de contact est fermée. Réactivez la mission pour gérer ses séquences.'}
          withAction={fullscreen}
        />
      </div>
    );
  } else if (asksFlow) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <SectionErrorBoundary fallbackTitle="Le panneau Contacter n'a pas pu s'afficher">
          <ContactFlow
            missionId={project.id}
            job={job}
            candidates={flow.candidates}
            candidatesStatus={flow.status}
            overflow={flow.overflow}
            onRetryCandidates={flow.refetch}
            onEnrolled={onEnrolled}
            onOpenCandidate={openCandidate}
            onLeave={onLeave}
          />
        </SectionErrorBoundary>
      </div>
    );
  } else if (sequencesV2) {
    // Les candidats contactés se lisent sans compte LinkedIn relié (un compte
    // déconnecté y est justement signalé) ; seules les séquences demandent un compte.
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        {tabBar}
        {tab === null && (
          <div className="space-y-3 px-4 py-4 sm:px-5" aria-busy="true" aria-label="Chargement des candidats contactés">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}
        {/* Les onglets restent montés : changer d'onglet ne perd ni la liste ni un brouillon. */}
        <div
          role="tabpanel"
          id={`${baseId}-panel-contactes`}
          aria-labelledby={`${baseId}-tab-contactes`}
          hidden={tab !== 'contactes'}
          className="min-w-0 px-4 py-4 sm:px-5"
        >
          <SectionErrorBoundary fallbackTitle="Les candidats contactés n'ont pas pu s'afficher">
            <ContactedList
              projectId={project.id}
              status={contacted.view ? 'ready' : contacted.isError ? 'error' : 'loading'}
              view={contacted.view}
              chatByEnrollment={contacted.data?.chatByEnrollment ?? NO_CHATS}
              truncated={contacted.data?.truncated ?? false}
              onRefresh={() => contacted.refetch()}
            />
          </SectionErrorBoundary>
        </div>
        <div
          role="tabpanel"
          id={`${baseId}-panel-sequences`}
          aria-labelledby={`${baseId}-tab-sequences`}
          hidden={tab !== 'sequences'}
          className="min-w-0"
        >
          {accountsLoading ? loadingAccounts : accounts.length === 0 ? noAccount : (
            <div className="min-w-0 px-4 py-4 sm:px-5">{sequencesList}</div>
          )}
        </div>
      </div>
    );
  } else if (accountsLoading) {
    body = loadingAccounts;
  } else if (accounts.length === 0) {
    body = noAccount;
  } else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        {tabBar}
        {/* Les onglets restent montés : changer d'onglet ne perd ni la liste ni un brouillon. */}
        <div
          role="tabpanel"
          id={`${baseId}-panel-sequences`}
          aria-labelledby={`${baseId}-tab-sequences`}
          hidden={tab !== 'sequences'}
          className="min-w-0 px-4 py-4 sm:px-5"
        >
          {sequencesList}
        </div>
        <div
          role="tabpanel"
          id={`${baseId}-panel-invitations`}
          aria-labelledby={`${baseId}-tab-invitations`}
          hidden={tab !== 'invitations'}
          className="min-w-0 px-4 py-4 sm:px-5"
        >
          <SectionErrorBoundary fallbackTitle="Les invitations n'ont pas pu s'afficher">
            <InvitationsPanel
              accounts={accounts}
              selectedAccount={selectedAccount}
              onAccountChange={setSelectedAccount}
              organizationId={organizationId || null}
            />
          </SectionErrorBoundary>
        </div>
      </div>
    );
  }

  const subtitle = [project.job_details?.title || project.name, project.client_name].filter(Boolean).join(' · ');

  return (
    <div className="flex min-h-full min-w-0 flex-col">
      <div className="flex min-h-[52px] shrink-0 items-center gap-2 border-b border-border py-2 pl-5 pr-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id={titleId} tabIndex={-1} className="text-md font-semibold leading-tight text-foreground outline-none">
            Prise de contact
          </h2>
          {subtitle && (
            <span title={subtitle} className="truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Fermer le panneau"
          title="Fermer (Échap)"
          className="min-h-11 min-w-11 shrink-0 lg:min-h-0 lg:min-w-0"
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {body}
      {!isArchived && !asksFlow && (
        <div className="sticky bottom-0 mt-auto flex shrink-0 items-start gap-2 border-t border-border bg-background px-5 py-3.5 text-xs text-muted-foreground">
          <Info className="mt-px h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
          <span>Pour contacter des candidats, cochez-les dans la liste puis « Contacter ».</span>
        </div>
      )}
    </div>
  );
}

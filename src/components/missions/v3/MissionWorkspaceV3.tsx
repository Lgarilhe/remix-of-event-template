// Refonte mission, lots 1 et 2 : la nouvelle page mission, derrière
// l'interrupteur (src/lib/missionBeta.ts). Charge la mission, fournit le
// contexte (droits, adresse, navigation des écrans et des panneaux) et rend la
// coquille.
//
// Historique : ouvrir un panneau ou le Bilan pousse une entrée marquée
// (state.missionV3Pushed), pour que Retour et « Fermer » reviennent à l'état
// d'avant ; passer au candidat voisin, ou d'un panneau à l'autre, remplace
// l'entrée. Changer d'écran pousse une entrée.
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { hasFeature } from '@/lib/featureGates';
import {
  V3_PARAM,
  readMissionV3Location,
  setMissionBeta,
  v3ToLegacyTarget,
  type CadrageSection,
  type MissionScreen,
  type MissionV3Location,
} from '@/lib/missionBeta';
import { useOrganization } from '@/hooks/useOrganization';
import { useSidebarOffline } from '@/hooks/sidebar/useSidebarOffline';
import { useSourcingProject, type SourcingProject } from '@/hooks/useSourcingProjects';
import { MissionV3Context } from './MissionV3Context';
import type { MissionV3ContextValue, MissionWorkspaceV3Props } from './types';
import { useClientLogoBackfill } from '@/hooks/useClientLogoBackfill';
import { MissionShell } from './shell/MissionShell';
import { missionClientName } from './shell/missionClient';
import { missionScreenTarget } from './shell/missionScreens';
import { ORG_TYPE_MISSING_REASON } from './shell/missionStatus';
import { ViewportFrame } from './shell/ViewportFrame';

type PushKind = 'panel' | 'bilan';

interface PushState {
  missionV3Pushed: true;
  missionV3PushKind: PushKind;
}

function pushState(kind: PushKind): PushState {
  return { missionV3Pushed: true, missionV3PushKind: kind };
}

/** Vrai si l'entrée courante a été poussée par la page pour ce type d'ouverture. */
function wasPushedFor(state: unknown, kind: PushKind): boolean {
  if (!state || typeof state !== 'object') return false;
  const s = state as Partial<PushState>;
  if (s.missionV3Pushed !== true) return false;
  // Sans type (entrée marquée ailleurs) : considérée comme un panneau.
  return (s.missionV3PushKind ?? 'panel') === kind;
}

/** Paramètre d'onglet du panneau Prise de contact (repris de l'ancienne vue). */
const OUTREACH_TAB_PARAM = 'outreach';

function withParams(search: string, set: Record<string, string>, remove: readonly string[]): string {
  const params = new URLSearchParams(search);
  for (const name of remove) params.delete(name);
  for (const [name, value] of Object.entries(set)) params.set(name, value);
  const out = params.toString();
  return out ? `?${out}` : '';
}

const PANEL_PARAMS: readonly string[] = [V3_PARAM.panel, V3_PARAM.candidate, OUTREACH_TAB_PARAM];

// --------------------------------------------------------------- états

function HeaderSkeleton() {
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-2 sm:px-4">
        <Skeleton className="hidden h-4 w-16 sm:block" />
        <Skeleton className="h-5 w-48 max-w-[50%]" />
        <div className="flex-1" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-8 w-8" />
      </div>
      <div className="flex h-10 shrink-0 items-center gap-4 border-b border-border px-4">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-16" />
      </div>
    </>
  );
}

function PageFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ViewportFrame className="flex w-full max-w-full flex-col overflow-hidden bg-background">
      <SEOHead title={title} description="Espace de travail mission" />
      {children}
    </ViewportFrame>
  );
}

function LoadingState() {
  return (
    <PageFrame title="Mission | Konekt">
      <div aria-busy="true" aria-label="Chargement de la mission" className="flex min-h-0 flex-1 flex-col">
        <HeaderSkeleton />
        <div className="flex flex-col gap-3 px-3 py-3 sm:px-6 lg:px-8">
          <Skeleton className="h-4 w-28" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-24" />
            ))}
          </div>
          <Skeleton className="mt-2 h-9 w-full" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </PageFrame>
  );
}

function MessageState({
  title,
  heading,
  text,
  action,
}: {
  title: string;
  heading: string;
  text: string;
  action: ReactNode;
}) {
  return (
    <PageFrame title={title}>
      <div className="flex min-h-0 flex-1 items-start justify-center px-4 py-12">
        <div role="alert" className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center">
          <h1 className="text-sm font-semibold text-foreground">{heading}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{text}</p>
          <div className="mt-6 flex justify-center">{action}</div>
        </div>
      </div>
    </PageFrame>
  );
}

// --------------------------------------------------------------- page

function MissionWorkspaceLoaded({ project }: { project: SourcingProject }) {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const { orgType, organizationId, isLoading: orgLoading } = useOrganization();
  const { offline } = useSidebarOffline();
  const [visibleRowIds, setVisibleRowIdsState] = useState<readonly string[]>([]);

  // Logo du client : enregistré côté serveur s'il manque.
  const logoCandidates = useMemo(
    () => [{
      id: project.id,
      clientName: missionClientName(project),
      logoUrl: project.job_details?.client?.logo_url ?? null,
      logoCheckedAt: project.job_details?.client?.logo_checked_at ?? null,
      website: project.job_details?.client?.website ?? null,
    }],
    [project],
  );
  useClientLogoBackfill(logoCandidates);

  const { pathname, search, state } = routerLocation;

  // Dernière adresse lue par les actions, pour des fonctions stables.
  const latest = useRef({ pathname, search, state });
  latest.current = { pathname, search, state };

  const location: MissionV3Location = useMemo(
    () =>
      readMissionV3Location(pathname, search) ?? {
        id: project.id,
        screen: 'pipeline',
        panel: null,
        candidateRowId: null,
        bilan: false,
        section: null,
        view: 'liste',
        stage: null,
      },
    [pathname, search, project.id],
  );

  const openPanel = useCallback(
    (set: Record<string, string>, remove: readonly string[], opts?: { replace?: boolean }) => {
      const { pathname: path, search: query, state: current } = latest.current;
      const alreadyOpen = readMissionV3Location(path, query)?.panel != null;
      const to = `${path}${withParams(query, set, remove)}`;
      if (to === `${path}${query}`) return;
      // Un seul panneau à la fois : passer d'un panneau (ou d'un candidat) à
      // l'autre remplace l'entrée et garde son marqueur.
      if (opts?.replace || alreadyOpen) navigate(to, { replace: true, state: current });
      else navigate(to, { state: pushState('panel') });
    },
    [navigate],
  );

  const openCandidate = useCallback(
    (rowId: string, opts?: { replace?: boolean }) => {
      openPanel({ [V3_PARAM.panel]: 'fiche', [V3_PARAM.candidate]: rowId }, [OUTREACH_TAB_PARAM], opts);
    },
    [openPanel],
  );

  const openContactPanel = useCallback(() => {
    openPanel({ [V3_PARAM.panel]: 'contact' }, [V3_PARAM.candidate]);
  }, [openPanel]);

  const closePanel = useCallback(() => {
    const { pathname: path, search: query, state: current } = latest.current;
    const params = new URLSearchParams(query);
    if (!PANEL_PARAMS.some((name) => params.has(name))) return;
    if (wasPushedFor(current, 'panel')) {
      navigate(-1);
      return;
    }
    navigate(`${path}${withParams(query, {}, PANEL_PARAMS)}`, { replace: true, state: null });
  }, [navigate]);

  const setBilanOpen = useCallback(
    (open: boolean) => {
      const { pathname: path, search: query, state: current } = latest.current;
      const isOpen = new URLSearchParams(query).get(V3_PARAM.bilan) === '1';
      if (open) {
        if (isOpen) return;
        navigate(`${path}${withParams(query, { [V3_PARAM.bilan]: '1' }, [])}`, { state: pushState('bilan') });
        return;
      }
      if (!isOpen) return;
      if (wasPushedFor(current, 'bilan')) {
        navigate(-1);
        return;
      }
      navigate(`${path}${withParams(query, {}, [V3_PARAM.bilan])}`, { replace: true, state: null });
    },
    [navigate],
  );

  const goToScreen = useCallback(
    (screen: MissionScreen, opts?: { section?: CadrageSection }) => {
      const { pathname: path, search: query } = latest.current;
      const to = missionScreenTarget(project.id, screen, query, opts?.section ?? null);
      if (to === `${path}${query}`) return;
      navigate(to);
    },
    [navigate, project.id],
  );

  const leaveBeta = useCallback(() => {
    const { pathname: path, search: query } = latest.current;
    setMissionBeta(false);
    navigate(v3ToLegacyTarget(path, query) ?? `${path}${query}`, { replace: true });
  }, [navigate]);

  const setVisibleRowIds = useCallback((ids: readonly string[]) => {
    setVisibleRowIdsState((prev) =>
      prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids,
    );
  }, []);

  const isOwnMission = !!organizationId && project.organization_id === organizationId;
  const isArchived = project.status === 'archived';
  const canPipeline = hasFeature(orgType, 'pipeline');
  const canEditBrief = hasFeature(orgType, 'edit_brief') && isOwnMission && !isArchived;
  const canEditProcess = hasFeature(orgType, 'edit_process') && isOwnMission && !isArchived;
  const canMoveCandidates = canPipeline && !isArchived && !offline;
  let moveDisabledReason: string | null = null;
  if (isArchived) moveDisabledReason = 'Mission archivée : réactivez-la pour agir.';
  else if (!orgLoading && !orgType) moveDisabledReason = ORG_TYPE_MISSING_REASON;
  else if (!orgLoading && !canPipeline) moveDisabledReason = 'Votre formule ne permet pas de modifier ce pipeline.';
  else if (offline) moveDisabledReason = 'Hors ligne : les changements reprendront à la reconnexion.';

  const value: MissionV3ContextValue = useMemo(
    () => ({
      project,
      location,
      isOwnMission,
      isArchived,
      canEditBrief,
      canEditProcess,
      canMoveCandidates,
      moveDisabledReason,
      goToScreen,
      openCandidate,
      openContactPanel,
      closePanel,
      setBilanOpen,
      visibleRowIds,
      setVisibleRowIds,
      leaveBeta,
    }),
    [
      project,
      location,
      isOwnMission,
      isArchived,
      canEditBrief,
      canEditProcess,
      canMoveCandidates,
      moveDisabledReason,
      goToScreen,
      openCandidate,
      openContactPanel,
      closePanel,
      setBilanOpen,
      visibleRowIds,
      setVisibleRowIds,
      leaveBeta,
    ],
  );

  return (
    <MissionV3Context.Provider value={value}>
      <SEOHead title={`${project.name} | Konekt`} description={`Mission ${project.name}`} />
      <MissionShell />
    </MissionV3Context.Provider>
  );
}

export function MissionWorkspaceV3({ projectId }: MissionWorkspaceV3Props) {
  const navigate = useNavigate();
  const query = useSourcingProject(projectId);
  const { data, isError, refetch, isFetching } = query;

  // Pas encore de réponse (requête en cours ou en attente de la session) : chargement.
  if (data === undefined && !isError) return <LoadingState />;

  if (data === undefined && isError) {
    return (
      <MessageState
        title="Mission | Konekt"
        heading="Impossible de charger la mission."
        text="Vérifiez votre connexion, puis réessayez."
        action={
          <Button type="button" variant="primary" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? 'Chargement…' : 'Réessayer'}
          </Button>
        }
      />
    );
  }

  if (!data) {
    return (
      <MessageState
        title="Mission introuvable | Konekt"
        heading="Mission introuvable"
        text="Cette mission n'existe pas ou a été supprimée."
        action={
          <Button type="button" variant="primary" onClick={() => navigate('/missions')}>
            Retour aux missions
          </Button>
        }
      />
    );
  }

  // Remontée à chaque mission : sélection, sections dépliées et défilement ne
  // passent jamais d'une mission à l'autre.
  return <MissionWorkspaceLoaded key={data.id} project={data} />;
}

export default MissionWorkspaceV3;

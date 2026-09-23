/**
 * Panneau de l'onglet Missions (§3.1, §3.8), dans l'ordre :
 * 1. « Nouvelle mission » (ou l'encart du plafond) ;
 * 2. mission ouverte, seulement sur /missions/:id ;
 * 3. vues globales (Pipeline, Recherche) ;
 * 4. épinglées, masquée si vide ;
 * 5. mes missions ;
 * 6. « Voir toutes les missions », toujours affiché.
 * Une mission n'apparaît qu'une fois : ouverte, puis épinglée, puis mienne.
 */
import { useEffect, useMemo } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { Columns3, Search } from 'lucide-react';
import { hasFeature } from '@/lib/featureGates';
import { parseMissionView } from '@/lib/missionViews';
import { canPin, hasNewProfiles, toMissionNavItem, type MissionNavItem } from '@/lib/sidebarMissions';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyMissions, useOpenMissionProject } from '@/hooks/sidebar/useMyMissions';
import { useMissionVisits } from '@/hooks/sidebar/useMissionVisits';
import { SidebarSection } from '@/components/sidebar/SidebarSection';
import { SidebarRow } from '@/components/sidebar/SidebarRow';
import { MissionNavRow } from './MissionNavRow';
import { NewMissionButton } from './NewMissionButton';

export function MissionsPanel() {
  const { pathname, search } = useLocation();
  const { orgType, organizationId } = useOrganization();

  const openId = matchPath('/missions/:id', pathname)?.params.id ?? null;
  const currentView = parseMissionView(new URLSearchParams(search).get('tab'));

  const missions = useMyMissions({ enabled: true, withPins: true, openMissionId: openId });
  const { data: openProject, isFetching: openFetching } = useOpenMissionProject(openId);
  const { visits, ensureBaselines } = useMissionVisits();

  const { setPinned, resolvedPinCount, pinnedIds } = missions;
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const canPinMore = canPin(resolvedPinCount);

  // Mission ouverte : ligne de liste ou de jointure (nom partenaire compris),
  // sinon la fiche en cache de la page.
  const fiche = openProject && openProject.id === openId ? openProject : null;
  const openItem: MissionNavItem | null =
    missions.open ??
    (fiche ? toMissionNavItem(fiche, null, !!organizationId && fiche.organization_id !== organizationId) : null);

  // Référence des missions jamais relevées : { v: null, n }, sans point.
  // Clé primitive (identifiant et total) pour les dépendances de l'effet.
  const baselineKey = useMemo(
    () => [...missions.pinned, ...missions.mine].map((m) => `${m.id}:${m.stats_total_found}`).join('|'),
    [missions.pinned, missions.mine],
  );
  useEffect(() => {
    if (!baselineKey) return;
    const items = baselineKey.split('|').map((entry) => {
      const sep = entry.lastIndexOf(':');
      return { id: entry.slice(0, sep), n: Number(entry.slice(sep + 1)) || 0 };
    });
    ensureBaselines(items);
  }, [baselineKey, ensureBaselines]);

  const onTogglePin = (item: MissionNavItem, pin: boolean) => setPinned(item.id, pin);

  const renderRow = (item: MissionNavItem, isOpen: boolean) => (
    <MissionNavRow
      key={item.id}
      item={item}
      readinessInput={isOpen && fiche ? fiche : item}
      lastView={isOpen ? currentView : visits[item.id]?.v ?? null}
      isOpenMission={isOpen}
      currentView={isOpen ? currentView : null}
      hasNewProfiles={!isOpen && hasNewProfiles(item.stats_total_found, visits[item.id])}
      pinned={pinnedSet.has(item.id)}
      canPinMore={canPinMore}
      onTogglePin={onTogglePin}
    />
  );

  let openState: 'loading' | 'ok' | null = null;
  if (openId) {
    if (openItem) openState = 'ok';
    else if (missions.status === 'loading' || openFetching) openState = 'loading';
  }

  return (
    <div className="flex flex-col gap-1">
      {hasFeature(orgType, 'create_missions') && (
        <div className="pb-1">
          <NewMissionButton />
        </div>
      )}

      {openId && openState && (
        <SidebarSection
          id="open-mission"
          title="Mission ouverte"
          state={openState}
          isEmpty={!openItem}
          loadingRows={1}
        >
          {openItem && renderRow(openItem, true)}
        </SidebarSection>
      )}

      <SidebarSection id="global-views" title="Vues globales" state="ok" isEmpty={false}>
        <SidebarRow leading={<Columns3 />} title="Pipeline" sub="Candidats de toutes les missions" to="/pipeline" />
        <SidebarRow leading={<Search />} title="Recherche" sub="Hors mission" to="/sourcing" />
      </SidebarSection>

      <SidebarSection
        id="pinned"
        title="Épinglées"
        state={missions.pinsStatus}
        stale={missions.pinsStale}
        onRetry={missions.retryPins}
        isEmpty={missions.pinned.length === 0}
        errorText="Impossible de charger vos épingles."
        loadingRows={2}
      >
        {missions.pinned.map((item) => renderRow(item, false))}
      </SidebarSection>

      <SidebarSection
        id="mine"
        title="Mes missions"
        state={missions.status}
        stale={missions.stale}
        onRetry={missions.retry}
        isEmpty={missions.mine.length === 0}
        hideWhenEmpty={false}
        emptyText="Aucune mission en cours."
        errorText="Impossible de charger vos missions."
        loadingRows={3}
        footer={<SidebarRow title="Voir toutes les missions" to="/missions" />}
      >
        {missions.mine.map((item) => renderRow(item, false))}
      </SidebarSection>
    </div>
  );
}

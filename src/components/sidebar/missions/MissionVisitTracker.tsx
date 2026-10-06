/**
 * Relevé de la mission ouverte (D18, D19, §3.6), sans rendu.
 *
 * Monté par AppSidebar hors du contenu de la feuille mobile : le relevé tourne
 * même quand l'onglet Missions n'est pas affiché. Sur /missions/:id, il écrit
 * la vue affichée et le total de profils de la fiche en cache ; tant que la
 * mission est ouverte, ce total suit la fiche, pour que mes propres ajouts
 * n'allument aucun point.
 *
 * La fiche est lue sans jamais être lancée : vraies options et enabled: false
 * (la page la charge et la tient à jour).
 *
 * Nouvelle page mission (interrupteur allumé, src/lib/missionBeta.ts) : la
 * mission et l'écran viennent du chemin (/missions/:id/sourcing…), relevés dans
 * le vocabulaire de l'ancienne page (Pipeline 'pipeline', Sourcing 'sourcing',
 * Cadrage 'brief') : l'interrupteur s'allume et s'éteint sans conversion.
 */
import { useEffect } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthReady } from '@/hooks/useAuthReady';
import { sourcingProjectQueryOptions } from '@/hooks/useSourcingProjects';
import { useMissionVisits } from '@/hooks/sidebar/useMissionVisits';
import { useMissionBeta } from '@/hooks/useMissionBeta';
import { missionIdFromPath, readMissionV3Location, screenToVisitView } from '@/lib/missionBeta';
import { parseMissionView } from '@/lib/missionViews';

export function MissionVisitTracker() {
  const { pathname, search } = useLocation();
  const { user } = useAuthReady();
  const { recordVisit } = useMissionVisits();

  const beta = useMissionBeta();

  const projectId = beta
    ? missionIdFromPath(pathname)
    : matchPath('/missions/:id', pathname)?.params.id ?? null;
  const view = beta
    ? screenToVisitView(readMissionV3Location(pathname, search)?.screen ?? 'pipeline')
    : parseMissionView(new URLSearchParams(search).get('tab'));

  const { data: project } = useQuery({
    ...sourcingProjectQueryOptions(projectId ?? '', user?.id ?? null),
    enabled: false,
  });
  const seenTotal = project && project.id === projectId ? project.stats_total_found ?? 0 : null;

  useEffect(() => {
    if (!projectId || seenTotal === null) return;
    recordVisit(projectId, { view, seenTotal });
  }, [projectId, view, seenTotal, recordVisit]);

  return null;
}

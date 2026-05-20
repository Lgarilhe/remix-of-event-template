import { useMemo } from 'react';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import type { JobDetails } from '@/types/jobDetails';
import { countBriefFields } from '@/lib/missionUtils';

export interface StepReadiness {
  id: string;
  isComplete: boolean;
  isReady: boolean;
  isLocked: boolean;
  completionPercent: number;
  blockerMessage: string | null;
  nextAction: { label: string; tab: string } | null;
}

export function computeReadiness(project: SourcingProject): StepReadiness[] {
  const jd = (project.job_details || {}) as JobDetails;
  const { filled, total } = countBriefFields(jd);
  const briefPct = total === 0 ? 0 : Math.round((filled / total) * 100);

  // hasBrief = on a au minimum un intitulé de poste pour sourcer.
  // Fallback sur les colonnes top-level project.job_title / project.name —
  // les missions créées via create_mission (agent IA) avant la migration
  // job_details expansion (commit 11704529) avaient le titre dans la colonne
  // SQL mais pas dans le JSONB. Sans ce fallback le sourcing reste verrouillé
  // alors qu'on a tout ce qu'il faut. La description reste un nice-to-have
  // pour le scoring mais pas un bloquant pour démarrer la recherche.
  const hasBrief = !!(
    jd.title || project.job_title || project.name
  );
  const hasFilters = !!(project.filters_snapshot && Object.keys(project.filters_snapshot).length > 0);
  const hasProcessSteps = Array.isArray((jd as any).process_steps) && (jd as any).process_steps.length > 0;
  const hasCandidates = (project.stats_total_found || 0) > 0;
  const hasMessaged = (project.stats_messaged || 0) > 0;

  return [
    {
      id: 'brief',
      isComplete: hasBrief,
      isReady: true, // always accessible
      isLocked: false,
      completionPercent: briefPct,
      blockerMessage: null,
      nextAction: hasBrief && !hasFilters
        ? { label: 'Analyser avec l\'IA', tab: 'brief' }
        : hasBrief && hasFilters
          ? { label: 'Lancer le sourcing', tab: 'sourcing' }
          : null,
    },
    {
      id: 'process',
      isComplete: hasProcessSteps,
      isReady: true, // optional step, always accessible
      isLocked: false,
      completionPercent: hasProcessSteps ? 100 : 0,
      blockerMessage: null,
      nextAction: !hasProcessSteps
        ? { label: 'Configurer le process', tab: 'process' }
        : null,
    },
    {
      id: 'sourcing',
      isComplete: hasCandidates,
      isReady: hasBrief && hasFilters,
      isLocked: !hasBrief,
      completionPercent: hasCandidates ? 100 : hasFilters ? 50 : 0,
      blockerMessage: !hasBrief
        ? 'Complétez le brief avant de lancer le sourcing.'
        : !hasFilters
          ? 'Lancez l\'analyse IA du brief pour générer les filtres.'
          : null,
      nextAction: hasCandidates && !hasMessaged
        ? { label: 'Contacter les candidats', tab: 'outreach' }
        : null,
    },
    {
      id: 'outreach',
      isComplete: hasMessaged,
      isReady: hasCandidates,
      // Pas de verrou : on permet la création de séquences en amont
      // (templates, brouillons) pour qu'elles soient prêtes au moment du sourcing.
      isLocked: false,
      completionPercent: hasMessaged ? 100 : hasCandidates ? 30 : 0,
      blockerMessage: null,
      nextAction: !hasCandidates
        ? { label: 'Sourcer des candidats', tab: 'sourcing' }
        : null,
    },
    {
      id: 'pipeline',
      isComplete: hasCandidates,
      isReady: hasCandidates,
      isLocked: !hasCandidates,
      completionPercent: hasCandidates ? 100 : 0,
      blockerMessage: !hasCandidates
        ? 'Ajoutez des candidats au pipeline depuis le sourcing.'
        : null,
      nextAction: !hasCandidates
        ? { label: 'Aller au sourcing', tab: 'sourcing' }
        : null,
    },
    {
      id: 'insights',
      isComplete: hasMessaged,
      isReady: hasCandidates,
      isLocked: !hasCandidates,
      completionPercent: hasMessaged ? 100 : 0,
      blockerMessage: !hasCandidates
        ? 'Des données de pipeline sont nécessaires pour afficher les insights.'
        : null,
      nextAction: !hasCandidates
        ? { label: 'Aller au sourcing', tab: 'sourcing' }
        : null,
    },
  ];
}

export function useMissionReadiness(project: SourcingProject | null): StepReadiness[] {
  return useMemo(() => {
    if (!project) return [];
    return computeReadiness(project);
  }, [project]);
}

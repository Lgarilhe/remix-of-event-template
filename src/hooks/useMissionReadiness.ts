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

  const hasBrief = !!(jd.title && (jd.mission_description || jd.raw_brief));
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
      isLocked: !hasCandidates,
      completionPercent: hasMessaged ? 100 : 0,
      blockerMessage: !hasCandidates
        ? 'Sourcez des candidats avant de créer une séquence.'
        : null,
      nextAction: null,
    },
  ];
}

export function useMissionReadiness(project: SourcingProject | null): StepReadiness[] {
  return useMemo(() => {
    if (!project) return [];
    return computeReadiness(project);
  }, [project]);
}

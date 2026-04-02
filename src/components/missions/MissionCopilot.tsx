import React, { useState, useEffect, useMemo } from 'react';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import type { StepReadiness } from '@/hooks/useMissionReadiness';

interface MissionCopilotProps {
  project: SourcingProject;
  activeTab: string;
  onTabChange: (tab: string) => void;
  readiness?: StepReadiness[];
}

interface CopilotSuggestion {
  icon: string;
  message: string;
  action?: {
    label: string;
    tab: string;
  };
}

function computeSuggestion(project: SourcingProject, activeTab: string): CopilotSuggestion | null {
  const hasFilters = project.filters_snapshot && Object.keys(project.filters_snapshot).length > 0;
  const jd = (project.job_details || {}) as Record<string, any>;
  const hasBrief = !!(jd.title && (jd.mission_description || jd.context || jd.raw_brief));
  const daysSinceLastSearch = project.last_search_at
    ? Math.floor((Date.now() - new Date(project.last_search_at).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  switch (activeTab) {
    case 'brief': {
      if (!hasBrief) {
        return {
          icon: '📋',
          message: "Collez un brief ou décrivez le poste pour que l'IA génère l'ICP et les filtres.",
        };
      }
      if (!hasFilters) {
        return {
          icon: '🤖',
          message: "Brief renseigné. Lancez l'analyse IA pour générer les filtres de recherche.",
        };
      }
      return {
        icon: '✅',
        message: 'ICP et filtres prêts.',
        action: { label: 'Lancer le sourcing', tab: 'sourcing' },
      };
    }

    case 'sourcing': {
      if (!hasFilters) {
        return {
          icon: '📋',
          message: 'Aucun filtre défini. Commencez par rédiger le brief de la mission.',
          action: { label: 'Aller au brief', tab: 'brief' },
        };
      }
      if (project.stats_total_found === 0) {
        return {
          icon: '🔍',
          message: 'Filtres prêts — lancez votre première recherche LinkedIn.',
        };
      }
      if (project.stats_total_found > 0 && project.stats_messaged === 0) {
        return {
          icon: '💡',
          message: `${project.stats_total_found} profils sourcés mais aucun contacté.`,
          action: { label: 'Créer une séquence', tab: 'outreach' },
        };
      }
      if (daysSinceLastSearch !== null && daysSinceLastSearch > 5) {
        return {
          icon: '⏸️',
          message: `Dernière recherche il y a ${daysSinceLastSearch} jours. Enrichissez votre pipeline.`,
        };
      }
      return null;
    }

    case 'pipeline': {
      if (project.stats_total_found === 0) {
        return {
          icon: '🔍',
          message: 'Pipeline vide. Sourcez des candidats pour commencer.',
          action: { label: 'Aller au sourcing', tab: 'sourcing' },
        };
      }
      const untreated = project.stats_total_found - project.stats_messaged - project.stats_dismissed;
      if (untreated > 3) {
        return {
          icon: '💡',
          message: `${untreated} candidats non contactés. Inscrivez-les dans une séquence.`,
          action: { label: 'Créer une séquence', tab: 'outreach' },
        };
      }
      if (project.stats_shortlisted === 0 && project.stats_messaged >= 3) {
        return {
          icon: '📋',
          message: `${project.stats_messaged} contactés mais aucun shortlisté. Passez-les en revue.`,
        };
      }
      return null;
    }

    case 'outreach': {
      if (project.stats_total_found === 0) {
        return {
          icon: '🔍',
          message: "Sourcez d'abord des candidats avant de créer une séquence.",
          action: { label: 'Aller au sourcing', tab: 'sourcing' },
        };
      }
      if (project.stats_messaged > 5 && project.stats_shortlisted > 0) {
        const rate = Math.round((project.stats_shortlisted / project.stats_messaged) * 100);
        if (rate >= 20) {
          return {
            icon: '🔥',
            message: `Taux de réponse de ${rate}% — votre approche fonctionne bien.`,
          };
        }
        if (rate < 8) {
          return {
            icon: '⚠️',
            message: `Taux de réponse de ${rate}%. Essayez de varier vos messages ou vos canaux.`,
          };
        }
      }
      return null;
    }

    case 'insights':
      return null;

    default:
      return null;
  }
}

export const MissionCopilot = ({ project, activeTab, onTabChange, readiness = [] }: MissionCopilotProps) => {
  const [dismissed, setDismissed] = useState(false);

  const baseSuggestion = useMemo(
    () => computeSuggestion(project, activeTab),
    [project, activeTab]
  );

  // Enhance with readiness-driven "next step" suggestion
  const suggestion = useMemo(() => {
    if (baseSuggestion) return baseSuggestion;

    // If current step is complete, suggest the next incomplete step
    const stepOrder = ['brief', 'process', 'sourcing', 'outreach'];
    const currentIdx = stepOrder.indexOf(activeTab);
    if (currentIdx >= 0) {
      const currentStep = readiness.find(r => r.id === activeTab);
      if (currentStep?.isComplete) {
        const nextIncomplete = readiness.find(r => !r.isComplete && !r.isLocked && r.id !== 'process');
        if (nextIncomplete?.nextAction) {
          return {
            icon: '➡️',
            message: `Étape terminée. Prochaine étape : ${nextIncomplete.nextAction.label.toLowerCase()}.`,
            action: nextIncomplete.nextAction,
          };
        }
      }
    }

    // On overview, show the first actionable step
    if (activeTab === 'overview') {
      const firstIncomplete = readiness.find(r => !r.isComplete && !r.isLocked);
      if (firstIncomplete?.nextAction) {
        return {
          icon: '🎯',
          message: `Prochaine étape : ${firstIncomplete.nextAction.label.toLowerCase()}.`,
          action: firstIncomplete.nextAction,
        };
      }
    }

    return null;
  }, [baseSuggestion, readiness, activeTab]);

  useEffect(() => {
    setDismissed(false);
  }, [activeTab, suggestion?.message]);

  if (!suggestion || dismissed) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-foreground text-background px-4 py-2.5">
      <div className="max-w-[1600px] mx-auto flex items-center gap-3">
        <span className="text-xs shrink-0">{suggestion.icon}</span>
        <span className="text-xs font-medium uppercase tracking-wider flex-1 min-w-0 truncate">
          {suggestion.message}
        </span>
        {suggestion.action && (
          <button
            onClick={() => onTabChange(suggestion.action!.tab)}
            className="shrink-0 h-[26px] px-3 text-xs font-medium uppercase tracking-wider bg-background text-foreground border border-background/30 hover:bg-background/90 transition-colors"
          >
            {suggestion.action.label}
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-background/50 hover:text-background text-xs ml-1"
          aria-label="Fermer"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

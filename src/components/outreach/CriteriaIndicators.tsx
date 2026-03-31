import React from 'react';
import { ScoringDimensions } from './JobScoreDisplay';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface CriteriaIndicatorsProps {
  dimensions: ScoringDimensions;
  compact?: boolean;
}

const CRITERIA_CONFIG: Record<string, { label: string; shortLabel: string }> = {
  tech_stack: { label: 'Stack technique', shortLabel: 'Tech' },
  seniority: { label: 'Séniorité / Expérience', shortLabel: 'XP' },
  domain: { label: 'Domaine métier', shortLabel: 'Domaine' },
  company_fit: { label: 'Culture & fit entreprise', shortLabel: 'Fit' },
  soft_skills: { label: 'Soft skills', shortLabel: 'Soft' },
  location: { label: 'Localisation', shortLabel: 'Loc' },
  tech_fit_llm: { label: 'Tech (évaluation IA)', shortLabel: 'Tech IA' },
  soft_skills_llm: { label: 'Soft Skills (évaluation IA)', shortLabel: 'Soft IA' },
};

function getIndicator(score: number): { emoji: string; color: string; bg: string } {
  if (score >= 70) return { emoji: '✅', color: 'text-green-600', bg: 'bg-green-50 border-green-200' };
  if (score >= 40) return { emoji: '🟡', color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200' };
  return { emoji: '🔴', color: 'text-red-500', bg: 'bg-red-50 border-red-200' };
}

export const CriteriaIndicators: React.FC<CriteriaIndicatorsProps> = ({ dimensions, compact = false }) => {
  const entries = Object.entries(dimensions)
    .filter(([, v]) => v != null && v.score !== undefined)
    .sort((a, b) => (b[1]!.weight || 0) - (a[1]!.weight || 0)) as [string, { score: number; weight: number }][];

  if (entries.length === 0) return null;

  const displayed = compact ? entries.slice(0, 4) : entries;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {displayed.map(([key, dim]) => {
        const config = CRITERIA_CONFIG[key] || { label: key, shortLabel: key };
        const indicator = getIndicator(dim.score);
        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <span className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium border rounded-none cursor-help",
                indicator.bg
              )}>
                <span className="text-xs">{indicator.emoji}</span>
                <span className={indicator.color}>{config.shortLabel}</span>
                <span className={cn("font-bold", indicator.color)}>{dim.score}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-xs font-medium">{config.label}: {dim.score}/100</p>
              {dim.weight > 0 && <p className="text-xs text-muted-foreground">Poids: {Math.round(dim.weight * 100)}%</p>}
            </TooltipContent>
          </Tooltip>
        );
      })}
      {compact && entries.length > 4 && (
        <span className="text-xs text-muted-foreground">+{entries.length - 4}</span>
      )}
    </div>
  );
};

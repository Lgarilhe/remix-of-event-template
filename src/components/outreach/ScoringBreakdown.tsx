import React, { useState } from 'react';
import { type JobMatchResult, type ScoringDimensions } from './JobScoreDisplay';
import { CheckCircle2, AlertTriangle, ThumbsUp, ThumbsDown, ChevronDown, BarChart3, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface ScoringBreakdownProps {
  result: JobMatchResult;
}

// ── Dimension bar ──
const DIMENSION_LABELS: Record<string, string> = {
  tech_stack: 'Stack technique',
  seniority: 'Séniorité',
  domain: 'Domaine métier',
  company_fit: 'Culture fit',
  soft_skills: 'Soft Skills',
  location: 'Localisation',
  receptivity: 'Réceptivité',
  tenure: 'Stabilité',
  contract_fit: 'Contrat',
  tech_fit_llm: 'Tech (IA)',
  soft_skills_llm: 'Soft Skills (IA)',
};

const DimensionRow: React.FC<{ label: string; score: number; weight: number }> = ({ label, score, weight }) => {
  const weightPct = Math.round(weight * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 text-xs text-muted-foreground font-medium truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-muted overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700 ease-out",
            score >= 70 ? "bg-accent" : score >= 40 ? "bg-accent/40" : "bg-destructive/50"
          )}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs font-bold tabular-nums text-foreground">{score}</span>
      {weightPct > 0 && (
        <span className="w-8 text-right text-xs text-muted-foreground/40 tabular-nums">
          ×{weightPct}%
        </span>
      )}
    </div>
  );
};

const DimensionsPanel: React.FC<{ dimensions: ScoringDimensions; finalScore: number }> = ({ dimensions, finalScore }) => {
  const entries = Object.entries(dimensions).filter(([, v]) => v != null) as [string, { score: number; weight: number }][];
  if (entries.length === 0) return null;

  // Sort by weight descending for better readability
  const sorted = [...entries].sort((a, b) => b[1].weight - a[1].weight);

  return (
    <div className="space-y-1.5 py-1">
      {sorted.map(([key, dim]) => (
        <DimensionRow key={key} label={DIMENSION_LABELS[key] || key} score={dim.score} weight={dim.weight} />
      ))}
      <div className="flex items-center gap-2 pt-1.5 mt-1.5 border-t border-border/50">
        <span className="w-24 text-xs font-black text-foreground uppercase tracking-wider">Total</span>
        <div className="flex-1" />
        <span className="text-xs font-black text-foreground tabular-nums">{finalScore}/100</span>
        <span className="w-8" />
      </div>
    </div>
  );
};

const InsightsPanel: React.FC<{ strengths: string[]; concerns: string[] }> = ({ strengths, concerns }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-1">
    {strengths.length > 0 && (
      <div className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1">
          <ThumbsUp className="w-3 h-3" /> Points forts
        </p>
        <ul className="space-y-0.5">
          {strengths.map((s, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80 leading-snug">
              <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </div>
    )}
    {concerns.length > 0 && (
      <div className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-wider text-destructive/70 flex items-center gap-1">
          <ThumbsDown className="w-3 h-3" /> Attention
        </p>
        <ul className="space-y-0.5">
          {concerns.map((c, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground leading-snug">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-destructive/60" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>
    )}
  </div>
);

export const ScoringBreakdown: React.FC<ScoringBreakdownProps> = ({ result }) => {
  const details = result.scoring_details;
  const { strengths = [], concerns = [] } = details || {};
  const hasDimensions = !!(result.dimensions && Object.values(result.dimensions).some(v => v != null));
  const hasInsights = strengths.length > 0 || concerns.length > 0;
  const [activeTab, setActiveTab] = useState<'dimensions' | 'insights'>(hasDimensions ? 'dimensions' : 'insights');
  const [isOpen, setIsOpen] = useState(false);

  if (!details) return null;
  if (!hasDimensions && !hasInsights && !details.skipReason) return null;

  const tabs = [
    ...(hasDimensions ? [{ id: 'dimensions' as const, label: 'Dimensions', icon: BarChart3 }] : []),
    ...(hasInsights ? [{ id: 'insights' as const, label: 'Analyse', icon: MessageSquare }] : []),
  ];

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between py-1.5 px-2 -mx-2 rounded hover:bg-muted/50 transition-colors group cursor-pointer">
        <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground group-hover:text-foreground transition-colors">
          Détail du scoring
        </span>
        <ChevronDown className={cn(
          "w-3.5 h-3.5 text-muted-foreground transition-transform duration-200",
          isOpen && "rotate-180"
        )} />
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="pt-2 space-y-2">
          {/* Tabs */}
          {tabs.length > 1 && (
            <div className="flex gap-1 border-b border-border/50 pb-0">
              {tabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 -mb-px",
                      activeTab === tab.id
                        ? "border-border text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground/70"
                    )}
                  >
                    <Icon className="w-3 h-3" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Tab content */}
          {activeTab === 'dimensions' && hasDimensions && result.dimensions && (
            <DimensionsPanel dimensions={result.dimensions} finalScore={result.match_score} />
          )}
          {activeTab === 'insights' && hasInsights && (
            <InsightsPanel strengths={strengths} concerns={concerns} />
          )}

          {/* Skip reason */}
          {details.skipReason && (
            <div className="flex items-start gap-2 text-xs text-foreground bg-muted px-2.5 py-1.5 border border-border">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-destructive" />
              <span className="font-medium">{details.skipReason}</span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

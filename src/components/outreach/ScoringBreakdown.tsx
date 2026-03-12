import React from 'react';
import { type JobMatchResult, type ScoringDimensions } from './JobScoreDisplay';
import { CheckCircle2, AlertTriangle, ThumbsUp, ThumbsDown } from 'lucide-react';
import { cn } from '@/lib/utils';

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
};

const DimensionRow: React.FC<{ label: string; score: number; weight: number }> = ({ label, score, weight }) => {
  const weightPct = Math.round(weight * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 text-xs text-muted-foreground font-medium truncate">{label}</span>
      <div className="flex-1 h-2 bg-muted overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700 ease-out",
            score >= 70 ? "bg-brutal-accent" : score >= 40 ? "bg-brutal-accent/50" : "bg-destructive/60"
          )}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="w-12 text-right text-xs font-bold tabular-nums text-foreground">{score}/100</span>
      {weightPct > 0 && (
        <span className="w-16 text-right text-[10px] text-muted-foreground/50 tabular-nums">
          poids {weightPct}%
        </span>
      )}
    </div>
  );
};

const DimensionsSection: React.FC<{ dimensions: ScoringDimensions; finalScore: number }> = ({ dimensions, finalScore }) => {
  const entries = Object.entries(dimensions).filter(([, v]) => v != null) as [string, { score: number; weight: number }][];
  if (entries.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Score par dimension
      </p>
      <div className="space-y-2">
        {entries.map(([key, dim]) => (
          <DimensionRow key={key} label={DIMENSION_LABELS[key] || key} score={dim.score} weight={dim.weight} />
        ))}
      </div>
      <div className="flex items-center gap-3 pt-2 border-t border-border">
        <span className="w-28 text-xs font-black text-foreground uppercase tracking-wider">Score final</span>
        <div className="flex-1" />
        <span className="text-sm font-black text-foreground tabular-nums">{finalScore}/100</span>
        <span className="w-16" />
      </div>
    </div>
  );
};

export const ScoringBreakdown: React.FC<ScoringBreakdownProps> = ({ result }) => {
  const details = result.scoring_details;
  if (!details) return null;

  const { strengths = [], concerns = [] } = details;

  return (
    <div className="space-y-4">
      {/* Dimensions */}
      {result.dimensions && (
        <DimensionsSection dimensions={result.dimensions} finalScore={result.match_score} />
      )}

      {/* Strengths & Concerns — side by side */}
      {(strengths.length > 0 || concerns.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {strengths.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-foreground flex items-center gap-1.5">
                <ThumbsUp className="w-3 h-3" />
                Points forts
              </p>
              <ul className="space-y-1">
                {strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-foreground/80 leading-relaxed">
                    <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0 text-brutal-accent" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {concerns.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-foreground flex items-center gap-1.5">
                <ThumbsDown className="w-3 h-3" />
                Points d'attention
              </p>
              <ul className="space-y-1">
                {concerns.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-destructive/70" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Skip reason */}
      {details.skipReason && (
        <div className="flex items-start gap-2 text-xs text-foreground bg-muted px-3 py-2 border border-foreground/10">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-destructive" />
          <span className="font-medium">{details.skipReason}</span>
        </div>
      )}
    </div>
  );
};

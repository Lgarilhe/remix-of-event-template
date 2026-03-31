import React from 'react';
import { Target, CheckCircle2, AlertTriangle, Briefcase, MapPin, Brain } from 'lucide-react';
import { ScoringRecord } from '@/hooks/useCandidateFullProfile';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { CollapsibleSection } from './shared';


const DIMENSION_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  skills: { label: 'Compétences', icon: <Target className="w-3 h-3" /> },
  experience: { label: 'Expérience', icon: <Briefcase className="w-3 h-3" /> },
  seniority: { label: 'Séniorité', icon: <Briefcase className="w-3 h-3" /> },
  location: { label: 'Localisation', icon: <MapPin className="w-3 h-3" /> },
  education: { label: 'Formation', icon: <Target className="w-3 h-3" /> },
  culture: { label: 'Culture fit', icon: <Brain className="w-3 h-3" /> },
  motivation: { label: 'Motivation', icon: <Brain className="w-3 h-3" /> },
  leadership: { label: 'Leadership', icon: <Brain className="w-3 h-3" /> },
  communication: { label: 'Communication', icon: <Brain className="w-3 h-3" /> },
  problem_solving: { label: 'Problem solving', icon: <Brain className="w-3 h-3" /> },
  salary: { label: 'Salaire', icon: <Target className="w-3 h-3" /> },
};

interface ScoringCardProps {
  scoring: ScoringRecord;
}

export const ScoringCard = React.memo<ScoringCardProps>(({ scoring }) => {
  const details = scoring.scoringDetails;

  // Parse weighted dimensions
  const dimensions = (details?.dimensions ? Object.values(details.dimensions) : []) as any[];
  const weightedDims = dimensions.filter((d: any) => d.weight > 0);
  const llmDims = dimensions.filter((d: any) => d.weight === 0);

  return (
    <div className="relative border border-foreground/10 p-3 space-y-3">
      {scoring.score > 80 && <div className="absolute left-0 top-0 bottom-0 w-1 bg-brutal-accent" />}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn("h-10 w-10 flex items-center justify-center border text-lg font-black",
            scoring.score >= 70 ? 'border-emerald-400 bg-emerald-50 text-emerald-700' :
            scoring.score >= 40 ? 'border-amber-400 bg-amber-50 text-amber-700' :
            'border-destructive/40 bg-destructive/5 text-destructive'
          )}>{scoring.score}</div>
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {scoring.jobTitle || 'Score'}
            </span>
            <p className="text-xs text-muted-foreground">
              {format(parseISO(scoring.createdAt), 'd MMM yyyy', { locale: fr })}
            </p>
          </div>
        </div>
        {scoring.recommendation && (
          <span className={cn("text-xs px-2 py-0.5 border font-medium uppercase tracking-wider",
            scoring.recommendation === 'shortlist' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' :
            scoring.recommendation === 'skip' ? 'border-destructive/30 text-destructive bg-destructive/5' :
            'border-amber-300 text-amber-700 bg-amber-50'
          )}>
            {scoring.recommendation === 'shortlist' ? 'GO' : scoring.recommendation === 'skip' ? 'SKIP' : 'MAYBE'}
          </span>
        )}
      </div>

      {details && (
        <div className="space-y-3">
          {/* Summary */}
          {details.summary && (
            <p className="text-xs text-muted-foreground leading-relaxed">{details.summary}</p>
          )}

          {/* Dimensions — weighted bars */}
          {weightedDims.length > 0 && (
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-foreground mb-2 block">Dimensions</span>
              <div className="space-y-2">
                {weightedDims.map((dim: any) => {
                  const cfg = DIMENSION_LABELS[dim.key] || { label: dim.key, icon: <Target className="w-3 h-3" /> };
                  return (
                    <div key={dim.key} className="space-y-0.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          {cfg.icon}
                          {cfg.label}
                          <span className="text-[8px] text-muted-foreground/60">({dim.weight}%)</span>
                        </span>
                        <span className={cn("font-bold",
                          dim.score >= 70 ? 'text-emerald-600' :
                          dim.score >= 40 ? 'text-amber-600' : 'text-destructive'
                        )}>{dim.score}</span>
                      </div>
                      <div className="h-1.5 bg-foreground/10 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full transition-all duration-500 rounded-full",
                            dim.score >= 70 ? 'bg-emerald-500' :
                            dim.score >= 40 ? 'bg-amber-500' : 'bg-destructive'
                          )}
                          style={{ width: `${dim.score}%` }}
                        />
                      </div>
                      {dim.details && (
                        <p className="text-xs text-muted-foreground/70">{dim.details}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* LLM dimensions */}
          {llmDims.length > 0 && (
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-foreground mb-1.5 block">Analyse IA</span>
              <div className="flex flex-wrap gap-2">
                {llmDims.map((dim: any) => {
                  const cfg = DIMENSION_LABELS[dim.key] || { label: dim.key, icon: <Brain className="w-3 h-3" /> };
                  return (
                    <div key={dim.key} className="flex items-center gap-1.5 px-2 py-1 border border-foreground/10 text-xs">
                      {cfg.icon}
                      <span className="text-muted-foreground">{cfg.label}</span>
                      <span className={cn("font-bold",
                        dim.score >= 70 ? 'text-emerald-600' :
                        dim.score >= 40 ? 'text-amber-600' : 'text-destructive'
                      )}>{dim.score}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Matching skills */}
          {details.matching_skills?.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Compétences matchées</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {details.matching_skills.map((s: string) => (
                  <span key={s} className="text-xs px-2 py-0.5 border border-emerald-300 text-emerald-700 bg-emerald-50 font-medium">{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Missing skills */}
          {details.missing_skills?.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-bold uppercase tracking-wider text-amber-700">Compétences manquantes</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {details.missing_skills.map((s: string) => (
                  <span key={s} className="text-xs px-2 py-0.5 border border-amber-300 text-amber-700 bg-amber-50 font-medium">{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Strengths */}
          {details.strengths?.length > 0 && (
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 mb-1 block">Forces</span>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {details.strengths.map((s: string, i: number) => <li key={i}>• {s}</li>)}
              </ul>
            </div>
          )}

          {/* Concerns */}
          {(details.concerns || details.weaknesses)?.length > 0 && (
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-amber-700 mb-1 block">Points d'attention</span>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {(details.concerns || details.weaknesses)!.map((w: string, i: number) => <li key={i}>• {w}</li>)}
              </ul>
            </div>
          )}

          {/* Experience & Location */}
          <div className="flex flex-wrap gap-3 text-xs">
            {details.experience_match && (
              <div className="flex items-center gap-1">
                <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Expérience :</span>
                <span className={cn("font-medium",
                  details.experience_match === 'compatible' ? 'text-emerald-600' :
                  details.experience_match === 'trop_senior' ? 'text-amber-600' :
                  details.experience_match === 'trop_junior' ? 'text-destructive' : 'text-muted-foreground'
                )}>
                  {details.experience_match === 'compatible' ? 'Compatible' :
                   details.experience_match === 'trop_senior' ? 'Trop senior' :
                   details.experience_match === 'trop_junior' ? 'Trop junior' : 'Incertain'}
                </span>
              </div>
            )}
            {details.location_match !== undefined && (
              <div className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Localisation :</span>
                <span className={cn("font-medium", details.location_match ? 'text-emerald-600' : 'text-destructive')}>
                  {details.location_match ? 'Compatible' : 'Non compatible'}
                </span>
              </div>
            )}
          </div>

          {/* Salary */}
          {details.salary_analysis && (
            <div className="pt-2 border-t border-foreground/10 text-xs text-muted-foreground">
              💰 {details.salary_analysis.status === 'adequate' ? 'Salaire adéquat' :
                  details.salary_analysis.status === 'too_low' ? 'Salaire potentiellement bas' :
                  details.salary_analysis.status === 'too_high' ? 'Salaire potentiellement élevé' : 'Analyse salariale'}
              {details.salary_analysis.gap_percent && ` (écart: ${details.salary_analysis.gap_percent}%)`}
            </div>
          )}

          {/* LLM Score */}
          {details.llmScore != null && (
            <div className="pt-2 border-t border-foreground/10 flex items-center gap-2 text-xs">
              <Brain className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Score LLM :</span>
              <span className={cn("font-bold",
                details.llmScore >= 70 ? 'text-emerald-600' :
                details.llmScore >= 40 ? 'text-amber-600' : 'text-destructive'
              )}>{details.llmScore}/100</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

ScoringCard.displayName = 'ScoringCard';

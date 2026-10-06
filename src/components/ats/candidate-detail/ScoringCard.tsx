import React from 'react';
import { ScoringRecord } from '@/hooks/useCandidateFullProfile';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { ScorePill } from '@/components/missions/v3/pipeline/CandidateListRow';
import { aiRecommendationMeta } from '@/lib/verdicts';


const DIMENSION_LABELS: Record<string, string> = {
  skills: 'Compétences',
  experience: 'Expérience',
  seniority: 'Séniorité',
  location: 'Localisation',
  education: 'Formation',
  culture: 'Adéquation culturelle',
  motivation: 'Motivation',
  leadership: 'Leadership',
  communication: 'Communication',
  problem_solving: 'Résolution de problèmes',
  salary: 'Salaire',
};

const dimensionLabel = (key: string) => DIMENSION_LABELS[key] || key;

const EXPERIENCE_LABELS: Record<string, string> = {
  compatible: 'compatible',
  trop_senior: 'trop senior',
  trop_junior: 'trop junior',
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
  const recommendation = aiRecommendationMeta(scoring.recommendation);
  const concerns: string[] = (details?.concerns || details?.weaknesses || []) as string[];

  return (
    <article className="space-y-4 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <header className="flex items-center gap-3">
        {scoring.score != null && <ScorePill score={scoring.score} size={40} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{scoring.jobTitle || 'Note'}</p>
          <p className="text-xs text-muted-foreground">
            {format(parseISO(scoring.createdAt), 'd MMM yyyy', { locale: fr })}
          </p>
        </div>
        {recommendation && <Badge variant={recommendation.tone}>{recommendation.label}</Badge>}
      </header>

      {details && (
        <div className="space-y-4">
          {details.summary && (
            <p className="text-sm leading-relaxed text-foreground-secondary">{details.summary}</p>
          )}

          {/* Dimensions pondérées */}
          {weightedDims.length > 0 && (
            <div>
              <h5 className="eyebrow mb-2">Dimensions</h5>
              <ul className="space-y-3">
                {weightedDims.map((dim: any) => (
                  <li key={dim.key}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="text-foreground">
                        {dimensionLabel(dim.key)}
                        <span className="ml-1.5 text-xs text-muted-foreground">poids {dim.weight} %</span>
                      </span>
                      <span className="font-medium tabular-nums text-foreground">{dim.score}</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={dimensionLabel(dim.key)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={dim.score}
                      className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
                    >
                      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, Math.max(0, dim.score))}%` }} />
                    </div>
                    {dim.details && <p className="mt-1 text-sm text-muted-foreground">{dim.details}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Analyse de l'assistant */}
          {llmDims.length > 0 && (
            <div>
              <h5 className="eyebrow mb-2">Analyse de l'assistant</h5>
              <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {llmDims.map((dim: any) => (
                  <li key={dim.key} className="text-muted-foreground">
                    {dimensionLabel(dim.key)}
                    <span className="ml-1.5 font-medium tabular-nums text-foreground">{dim.score}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {details.matching_skills?.length > 0 && (
            <div>
              <h5 className="eyebrow mb-2">Compétences correspondantes</h5>
              <div className="flex flex-wrap gap-1.5">
                {details.matching_skills.map((skill: string) => (
                  <Badge key={skill} variant="muted">{skill}</Badge>
                ))}
              </div>
            </div>
          )}

          {details.missing_skills?.length > 0 && (
            <div>
              <h5 className="eyebrow mb-2">Compétences manquantes</h5>
              <div className="flex flex-wrap gap-1.5">
                {details.missing_skills.map((skill: string) => (
                  <Badge key={skill} variant="warning">{skill}</Badge>
                ))}
              </div>
            </div>
          )}

          {details.strengths?.length > 0 && (
            <div>
              <h5 className="eyebrow mb-2">Points forts</h5>
              <ul className="list-disc space-y-1 pl-4 text-sm text-foreground-secondary">
                {details.strengths.map((item: string, i: number) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}

          {concerns.length > 0 && (
            <div>
              <h5 className="eyebrow mb-2">Points d'attention</h5>
              <ul className="list-disc space-y-1 pl-4 text-sm text-foreground-secondary">
                {concerns.map((item: string, i: number) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}

          {(details.experience_match || details.location_match !== undefined || details.salary_analysis || details.llmScore != null) && (
            <dl className="divide-y divide-border border-y border-border text-sm">
              {details.experience_match && (
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted-foreground">Expérience</dt>
                  <dd className="text-foreground">{EXPERIENCE_LABELS[details.experience_match] ?? 'incertaine'}</dd>
                </div>
              )}
              {details.location_match !== undefined && (
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted-foreground">Localisation</dt>
                  <dd className="text-foreground">{details.location_match ? 'compatible' : 'non compatible'}</dd>
                </div>
              )}
              {details.salary_analysis && (
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted-foreground">Salaire</dt>
                  <dd className="text-foreground">
                    {details.salary_analysis.status === 'adequate' ? 'adéquat' :
                     details.salary_analysis.status === 'too_low' ? 'potentiellement bas' :
                     details.salary_analysis.status === 'too_high' ? 'potentiellement élevé' : 'analysé'}
                    {details.salary_analysis.gap_percent && ` (écart de ${details.salary_analysis.gap_percent} %)`}
                  </dd>
                </div>
              )}
              {details.llmScore != null && (
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted-foreground">Note de l'analyse</dt>
                  <dd className="tabular-nums text-foreground">{details.llmScore} sur 100</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}
    </article>
  );
});

ScoringCard.displayName = 'ScoringCard';

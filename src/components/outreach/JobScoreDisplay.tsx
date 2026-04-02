import React from 'react';
import { CheckCircle2, XCircle, AlertCircle, Target, MapPin, Briefcase, TrendingUp, TrendingDown, DollarSign, AlertTriangle, Search, Ban } from 'lucide-react';
import { ScoringBreakdown } from './ScoringBreakdown';
import { CriteriaIndicators } from './CriteriaIndicators';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface SalaryAnalysis {
  status: 'adequate' | 'too_low' | 'too_high' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  estimated_market_salary?: { min: number; max: number; currency: string };
  job_salary?: { min: number | null; max: number | null; currency: string };
  gap_percentage?: number;
  explanation?: string;
}

export interface DimensionScore { score: number; weight: number; }

export interface ScoringDimensions {
  tech_stack?: DimensionScore;
  seniority?: DimensionScore;
  domain?: DimensionScore;
  company_fit?: DimensionScore;
  soft_skills?: DimensionScore;
  [key: string]: DimensionScore | undefined;
}

export interface ScoringDetails {
  strengths?: string[];
  concerns?: string[];
  seniorityMatch?: string;
  tenureAnalysis?: string;
  receptivityScore?: number | null;
  foreignDiplomaRisk?: 'none' | 'low' | 'medium' | 'high';
  locationCompatibility?: 'compatible' | 'partial' | 'incompatible' | 'unknown';
  candidatePreferencesConflict?: string | null;
  contractMismatch?: string | null;
  skipReason?: string | null;
}

export interface JobMatchResult {
  profile_name: string;
  match_score: number;
  matching_skills: string[];
  missing_skills: string[];
  experience_match: 'compatible' | 'trop_junior' | 'trop_senior' | 'incertain';
  location_match: boolean;
  summary: string;
  recommendation: 'go' | 'maybe' | 'skip';
  salary_analysis?: SalaryAnalysis;
  scoring_details?: ScoringDetails;
  error?: string;
  hardFilterPassed?: boolean;
  hardFilterKO?: string;
  confidenceScore?: number;
  dimensions?: ScoringDimensions;
  dataCompleteness?: 'full' | 'partial' | 'minimal';
  missingDataPoints?: string[];
  skippedLLM?: boolean;
  processingTimeMs?: number;
  tokensUsed?: { input: number; output: number } | null;
}

export interface BatchScoringStats {
  total: number;
  hardFiltered: number;
  llmSkipped: number;
  llmCalled: number;
  avgScore: number;
  totalTokens: number;
}

interface JobScoreDisplayProps {
  result: JobMatchResult;
  jobTitle?: string;
  compact?: boolean;
}

// ── Salary Badge ──
export const SalaryBadge: React.FC<{ analysis?: SalaryAnalysis }> = ({ analysis }) => {
  if (!analysis || analysis.status === 'unknown') return null;
  const config = {
    too_low: { icon: TrendingDown, label: 'Surqualifié', tooltip: 'Le salaire proposé semble bas pour ce niveau d\'expérience' },
    too_high: { icon: TrendingUp, label: 'Sous-qualifié', tooltip: 'Le salaire proposé semble élevé pour ce niveau d\'expérience' },
    adequate: { icon: DollarSign, label: 'Salaire OK', tooltip: 'Le salaire proposé est cohérent avec le profil' },
  }[analysis.status];
  if (!config) return null;
  const Icon = config.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium border border-border text-muted-foreground cursor-help rounded-lg bg-background">
          <Icon className="w-3 h-3" /> {config.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="font-medium">{config.tooltip}</p>
        {analysis.explanation && <p className="text-xs text-muted-foreground mt-1">{analysis.explanation}</p>}
      </TooltipContent>
    </Tooltip>
  );
};

// ── Score Ring ──
const ScoreRing: React.FC<{ score: number; size?: number }> = ({ score, size = 64 }) => {
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--primary))" strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="butt" className="transition-all duration-700 ease-out" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold text-foreground tabular-nums">{score}</span>
      </div>
    </div>
  );
};

// ── Recommendation pill ──
const RecommendationPill: React.FC<{ rec: string }> = ({ rec }) => {
  const config = {
    go: { icon: CheckCircle2, label: 'À contacter', cls: 'bg-accent/20 text-foreground border-accent' },
    maybe: { icon: AlertCircle, label: 'À évaluer', cls: 'bg-muted text-foreground border-border' },
    skip: { icon: XCircle, label: 'Peu adapté', cls: 'bg-muted text-muted-foreground border-border' },
  }[rec] || { icon: AlertCircle, label: 'Inconnu', cls: 'bg-muted text-muted-foreground border-border' };
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold border uppercase tracking-wider rounded-lg", config.cls)}>
      <Icon className="w-3 h-3" /> {config.label}
    </span>
  );
};

// ── Meta pill ──
const MetaPill: React.FC<{ icon: React.ElementType; label: string; ok: boolean }> = ({ icon: Icon, label, ok }) => (
  <span className={cn(
    "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium border uppercase tracking-wider rounded-lg",
    ok ? "bg-background text-foreground border-border" : "bg-muted text-muted-foreground border-border"
  )}>
    <Icon className="w-3 h-3" /> {label}
  </span>
);

// ── Skill tag ──
const SkillTag: React.FC<{ skill: string; matched: boolean }> = ({ skill, matched }) => (
  <span className={cn(
    "text-xs px-2 py-0.5 font-medium rounded-lg border",
    matched
      ? "bg-accent/10 text-foreground border-accent/30"
      : "bg-muted/50 text-muted-foreground border-border line-through decoration-foreground/20"
  )}>
    {skill}
  </span>
);

export const JobScoreDisplay: React.FC<JobScoreDisplayProps> = ({ result, jobTitle, compact = false }) => {
  if (result.error) {
    return (
      <div className="bg-muted border border-border p-3 text-sm text-foreground rounded-lg">
        Erreur: {result.error}
      </div>
    );
  }

  if (result.hardFilterPassed === false && result.hardFilterKO) {
    return (
      <div className="flex items-start gap-2.5 p-3 border border-border bg-muted rounded-lg">
        <Ban className="w-4 h-4 text-foreground/60 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-bold text-foreground uppercase tracking-wider">Éliminé par filtre</p>
          <p className="text-xs text-muted-foreground mt-0.5">{result.hardFilterKO}</p>
        </div>
      </div>
    );
  }

  const expLabel = {
    compatible: { text: 'XP compatible', ok: true },
    trop_junior: { text: 'Trop junior', ok: false },
    trop_senior: { text: 'Trop senior', ok: false },
    incertain: { text: 'XP à vérifier', ok: false },
  }[result.experience_match] || { text: 'À vérifier', ok: false };

  const confidenceBadge = result.confidenceScore != null && result.confidenceScore < 70 ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium border border-border text-muted-foreground cursor-help rounded-lg bg-muted">
          {result.confidenceScore < 40 ? <AlertTriangle className="w-3 h-3" /> : <Search className="w-3 h-3" />}
          {result.confidenceScore < 40 ? 'Données insuffisantes' : 'Score partiel'}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="text-xs font-medium">Confiance: {result.confidenceScore}%</p>
        {result.missingDataPoints?.length ? (
          <p className="text-xs text-muted-foreground mt-1">Données manquantes: {result.missingDataPoints.join(', ')}</p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  ) : null;

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-2 border border-border bg-muted/20 rounded-lg">
        <ScoreRing score={result.match_score} size={40} />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <RecommendationPill rec={result.recommendation} />
            {confidenceBadge}
            <SalaryBadge analysis={result.salary_analysis} />
            {result.matching_skills.slice(0, 2).map((skill, i) => (
              <SkillTag key={i} skill={skill} matched />
            ))}
            {result.matching_skills.length > 2 && (
              <span className="text-xs text-muted-foreground">+{result.matching_skills.length - 2}</span>
            )}
          </div>
          {result.dimensions && Object.values(result.dimensions).some(v => v != null) && (
            <CriteriaIndicators dimensions={result.dimensions} compact />
          )}
        </div>
      </div>
    );
  }

  // Merge all skills into one flat list for a cleaner display
  const allSkills = [
    ...result.matching_skills.map(s => ({ name: s, matched: true })),
    ...result.missing_skills.map(s => ({ name: s, matched: false })),
  ];

  return (
    <div className="space-y-4">
      {/* Header: ring + summary + pills */}
      <div className="flex items-start gap-4">
        <ScoreRing score={result.match_score} size={72} />
        <div className="flex-1 min-w-0 space-y-2">
          {jobTitle && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-bold uppercase tracking-wider">
              <Target className="w-3 h-3" />
              Match pour: <span className="text-foreground">{jobTitle}</span>
            </div>
          )}
          <p className="text-sm text-foreground/90 leading-relaxed">{result.summary}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <RecommendationPill rec={result.recommendation} />
            {confidenceBadge}
            <MetaPill icon={Briefcase} label={expLabel.text} ok={expLabel.ok} />
            <MetaPill icon={MapPin} label={result.location_match ? 'Localisation OK' : 'Localisation ?'} ok={result.location_match} />
            <SalaryBadge analysis={result.salary_analysis} />
          </div>
        </div>
      </div>

      {/* Criteria indicators */}
      {result.dimensions && Object.values(result.dimensions).some(v => v != null) && (
        <CriteriaIndicators dimensions={result.dimensions} />
      )}

      {/* Skills — unified row */}
      {allSkills.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Matchés ({result.matching_skills.length})</span>
            <span className="flex items-center gap-1"><XCircle className="w-3 h-3" /> Manquants ({result.missing_skills.length})</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {allSkills.map((s, i) => (
              <SkillTag key={i} skill={s.name} matched={s.matched} />
            ))}
          </div>
        </div>
      )}

      {/* Scoring breakdown */}
      {result.scoring_details && <ScoringBreakdown result={result} />}
    </div>
  );
};

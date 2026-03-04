import React from 'react';
import { CheckCircle2, XCircle, AlertCircle, Target, MapPin, Briefcase, TrendingUp, TrendingDown, DollarSign, AlertTriangle, Search, Ban } from 'lucide-react';
import { ScoringBreakdown } from './ScoringBreakdown';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface SalaryAnalysis {
  status: 'adequate' | 'too_low' | 'too_high' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  estimated_market_salary?: {
    min: number;
    max: number;
    currency: string;
  };
  job_salary?: {
    min: number | null;
    max: number | null;
    currency: string;
  };
  gap_percentage?: number;
  explanation?: string;
}

export interface DimensionScore {
  score: number;
  weight: number;
}

export interface ScoringDimensions {
  tech_stack?: DimensionScore;
  seniority?: DimensionScore;
  domain?: DimensionScore;
  company_fit?: DimensionScore;
  soft_skills?: DimensionScore;
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

// Compact salary badge for card display
export const SalaryBadge: React.FC<{ analysis?: SalaryAnalysis }> = ({ analysis }) => {
  if (!analysis || analysis.status === 'unknown') return null;

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'too_low':
        return { icon: TrendingDown, label: 'Surqualifié', tooltip: 'Le salaire proposé semble bas pour ce niveau d\'expérience' };
      case 'too_high':
        return { icon: TrendingUp, label: 'Sous-qualifié', tooltip: 'Le salaire proposé semble élevé pour ce niveau d\'expérience' };
      case 'adequate':
        return { icon: DollarSign, label: 'Salaire OK', tooltip: 'Le salaire proposé est cohérent avec le profil' };
      default:
        return null;
    }
  };

  const config = getStatusConfig(analysis.status);
  if (!config) return null;

  const Icon = config.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium border border-foreground/20 text-muted-foreground cursor-help rounded-none bg-background">
          <Icon className="w-3 h-3" />
          {config.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1">
          <p className="font-medium">{config.tooltip}</p>
          {analysis.explanation && <p className="text-xs text-muted-foreground">{analysis.explanation}</p>}
          {analysis.estimated_market_salary && (
            <p className="text-xs">Salaire marché estimé: {analysis.estimated_market_salary.min}-{analysis.estimated_market_salary.max} {analysis.estimated_market_salary.currency}</p>
          )}
          {analysis.gap_percentage !== undefined && analysis.gap_percentage !== 0 && (
            <p className="text-xs">Écart: {analysis.gap_percentage > 0 ? '+' : ''}{analysis.gap_percentage}%</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

// ── Score Ring (monochrome brutal) ──
const ScoreRing: React.FC<{ score: number; size?: number }> = ({ score, size = 64 }) => {
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--brutal-accent))" strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="butt" className="transition-all duration-700 ease-out" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold text-foreground tabular-nums">{score}</span>
      </div>
    </div>
  );
};

// ── Recommendation pill (monochrome) ──
const RecommendationPill: React.FC<{ rec: string }> = ({ rec }) => {
  const config = {
    go: { icon: CheckCircle2, label: 'À contacter', cls: 'bg-brutal-accent/20 text-foreground border-brutal-accent' },
    maybe: { icon: AlertCircle, label: 'À évaluer', cls: 'bg-muted text-foreground border-foreground/30' },
    skip: { icon: XCircle, label: 'Peu adapté', cls: 'bg-muted text-muted-foreground border-foreground/20' },
  }[rec] || { icon: AlertCircle, label: 'Inconnu', cls: 'bg-muted text-muted-foreground border-foreground/20' };

  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold border uppercase tracking-wider rounded-none", config.cls)}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
};

// ── Meta pill ──
const MetaPill: React.FC<{ icon: React.ElementType; label: string; ok: boolean }> = ({ icon: Icon, label, ok }) => (
  <span className={cn(
    "inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium border uppercase tracking-wider rounded-none",
    ok ? "bg-background text-foreground border-foreground/30" : "bg-muted text-muted-foreground border-foreground/20"
  )}>
    <Icon className="w-3 h-3" />
    {label}
  </span>
);

export const JobScoreDisplay: React.FC<JobScoreDisplayProps> = ({ 
  result, 
  jobTitle,
  compact = false 
}) => {
  if (result.error) {
    return (
      <div className="bg-muted border border-foreground/20 p-3 text-sm text-foreground rounded-none">
        Erreur: {result.error}
      </div>
    );
  }

  if (result.hardFilterPassed === false && result.hardFilterKO) {
    return (
      <div className="flex items-start gap-2.5 p-3 border border-foreground/20 bg-muted rounded-none">
        <Ban className="w-4 h-4 text-foreground/60 mt-0.5 shrink-0" />
        <div>
          <p className="text-[10px] font-bold text-foreground uppercase tracking-wider">Éliminé par filtre</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{result.hardFilterKO}</p>
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
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium border border-foreground/20 text-muted-foreground cursor-help rounded-none bg-muted">
          {result.confidenceScore < 40 ? <AlertTriangle className="w-3 h-3" /> : <Search className="w-3 h-3" />}
          {result.confidenceScore < 40 ? 'Données insuffisantes' : 'Score partiel'}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="text-xs font-medium">Confiance: {result.confidenceScore}%</p>
        {result.missingDataPoints && result.missingDataPoints.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">Données manquantes: {result.missingDataPoints.join(', ')}</p>
        )}
      </TooltipContent>
    </Tooltip>
  ) : null;

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-2 border border-foreground/10 bg-muted/20 rounded-none">
        <ScoreRing score={result.match_score} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <RecommendationPill rec={result.recommendation} />
            {confidenceBadge}
            <SalaryBadge analysis={result.salary_analysis} />
            {result.matching_skills.slice(0, 2).map((skill, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 bg-background text-foreground border border-foreground/20 font-medium rounded-none">
                {skill}
              </span>
            ))
            }
            {result.matching_skills.length > 2 && (
              <span className="text-[10px] text-muted-foreground">+{result.matching_skills.length - 2}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <ScoreRing score={result.match_score} size={72} />
        <div className="flex-1 min-w-0 space-y-2">
          {jobTitle && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
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

      {(result.matching_skills.length > 0 || result.missing_skills.length > 0) && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-foreground uppercase tracking-widest flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Matchés ({result.matching_skills.length})
            </p>
            {result.matching_skills.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {result.matching_skills.map((skill, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 bg-background text-foreground border border-foreground/20 font-medium rounded-none">{skill}</span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">Aucun match direct</p>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1">
              <XCircle className="w-3 h-3" />
              Manquants ({result.missing_skills.length})
            </p>
            {result.missing_skills.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {result.missing_skills.map((skill, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 bg-muted text-muted-foreground border border-foreground/10 font-medium rounded-none">{skill}</span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">Tous les skills requis ✓</p>
            )}
          </div>
        </div>
      )}

      {result.scoring_details && <ScoringBreakdown result={result} />}

      {result.salary_analysis && result.salary_analysis.status !== 'unknown' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 px-3 py-2 border border-foreground/10 rounded-none">
          <DollarSign className="w-3.5 h-3.5 shrink-0" />
          <span className="font-bold text-foreground/70 uppercase tracking-wider text-[10px]">Salaire</span>
          <SalaryBadge analysis={result.salary_analysis} />
          {result.salary_analysis.explanation && <span className="text-muted-foreground truncate">{result.salary_analysis.explanation}</span>}
        </div>
      )}
    </div>
  );
};

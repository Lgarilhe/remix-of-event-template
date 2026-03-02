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
  // V2 fields
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

  const getStatusConfig = (status: string, confidence: string) => {
    const isHighConfidence = confidence === 'high';
    const isMediumConfidence = confidence === 'medium';
    
    switch (status) {
      case 'too_low':
        return {
          icon: TrendingDown,
          label: 'Surqualifié',
          tooltip: 'Le salaire proposé semble bas pour ce niveau d\'expérience',
          bgColor: isHighConfidence ? 'bg-orange-100' : isMediumConfidence ? 'bg-orange-50' : 'bg-orange-50/50',
          textColor: isHighConfidence ? 'text-orange-700' : isMediumConfidence ? 'text-orange-600' : 'text-orange-500',
          borderColor: isHighConfidence ? 'border-orange-300' : isMediumConfidence ? 'border-orange-200' : 'border-orange-100',
        };
      case 'too_high':
        return {
          icon: TrendingUp,
          label: 'Sous-qualifié',
          tooltip: 'Le salaire proposé semble élevé pour ce niveau d\'expérience',
          bgColor: isHighConfidence ? 'bg-amber-100' : isMediumConfidence ? 'bg-amber-50' : 'bg-amber-50/50',
          textColor: isHighConfidence ? 'text-amber-700' : isMediumConfidence ? 'text-amber-600' : 'text-amber-500',
          borderColor: isHighConfidence ? 'border-amber-300' : isMediumConfidence ? 'border-amber-200' : 'border-amber-100',
        };
      case 'adequate':
        return {
          icon: DollarSign,
          label: 'Salaire OK',
          tooltip: 'Le salaire proposé est cohérent avec le profil',
          bgColor: 'bg-emerald-50',
          textColor: 'text-emerald-600',
          borderColor: 'border-emerald-200',
        };
      default:
        return null;
    }
  };

  const config = getStatusConfig(analysis.status, analysis.confidence);
  if (!config) return null;

  const Icon = config.icon;
  const confidenceLabel = analysis.confidence === 'high' ? '●●●' : analysis.confidence === 'medium' ? '●●○' : '●○○';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border cursor-help",
          config.bgColor, config.textColor, config.borderColor
        )}>
          <Icon className="w-3 h-3" />
          {config.label}
          <span className="opacity-60 text-[8px] tracking-tighter">{confidenceLabel}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1">
          <p className="font-medium">{config.tooltip}</p>
          {analysis.explanation && (
            <p className="text-xs text-muted-foreground">{analysis.explanation}</p>
          )}
          {analysis.estimated_market_salary && (
            <p className="text-xs">
              Salaire marché estimé: {analysis.estimated_market_salary.min}-{analysis.estimated_market_salary.max} {analysis.estimated_market_salary.currency}
            </p>
          )}
          {analysis.gap_percentage !== undefined && analysis.gap_percentage !== 0 && (
            <p className="text-xs">
              Écart: {analysis.gap_percentage > 0 ? '+' : ''}{analysis.gap_percentage}%
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

// ── Circular Score Ring ──
const ScoreRing: React.FC<{ score: number; size?: number }> = ({ score, size = 64 }) => {
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const strokeColor = score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
  const bgStroke = score >= 75 ? '#d1fae5' : score >= 50 ? '#fef3c7' : '#fee2e2';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={bgStroke} strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={strokeColor} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold text-foreground">{score}</span>
      </div>
    </div>
  );
};

// ── Recommendation pill ──
const RecommendationPill: React.FC<{ rec: string }> = ({ rec }) => {
  const config = {
    go: { icon: CheckCircle2, label: 'À contacter', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    maybe: { icon: AlertCircle, label: 'À évaluer', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    skip: { icon: XCircle, label: 'Peu adapté', cls: 'bg-red-100 text-red-600 border-red-200' },
  }[rec] || { icon: AlertCircle, label: 'Inconnu', cls: 'bg-muted text-muted-foreground border-border' };

  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border", config.cls)}>
      <Icon className="w-3.5 h-3.5" />
      {config.label}
    </span>
  );
};

// ── Meta pill (experience / location) ──
const MetaPill: React.FC<{ icon: React.ElementType; label: string; ok: boolean }> = ({ icon: Icon, label, ok }) => (
  <span className={cn(
    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border",
    ok ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
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
      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-destructive">
        Erreur: {result.error}
      </div>
    );
  }

  // ── Hard filter KO ──
  if (result.hardFilterPassed === false && result.hardFilterKO) {
    return (
      <div className="flex items-start gap-2.5 p-3 border border-red-200 bg-red-50/50">
        <Ban className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-semibold text-red-600">Éliminé par filtre</p>
          <p className="text-[11px] text-red-600/80 mt-0.5">{result.hardFilterKO}</p>
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

  // ── Confidence badge ──
  const confidenceBadge = result.confidenceScore != null && result.confidenceScore < 70 ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium border cursor-help",
          result.confidenceScore < 40
            ? "bg-amber-100 text-amber-700 border-amber-300"
            : "bg-sky-50 text-sky-600 border-sky-200"
        )}>
          {result.confidenceScore < 40 ? <AlertTriangle className="w-3 h-3" /> : <Search className="w-3 h-3" />}
          {result.confidenceScore < 40 ? 'Données insuffisantes' : 'Score partiel'}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="text-xs font-medium">Confiance: {result.confidenceScore}%</p>
        {result.missingDataPoints && result.missingDataPoints.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            Données manquantes: {result.missingDataPoints.join(', ')}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  ) : null;

  // ── Compact mode (used on result cards) ──
  if (compact) {
    return (
      <div className="flex items-center gap-3 p-2 rounded-lg border border-border/60 bg-muted/30">
        <ScoreRing score={result.match_score} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <RecommendationPill rec={result.recommendation} />
            {confidenceBadge}
            <SalaryBadge analysis={result.salary_analysis} />
            {result.matching_skills.slice(0, 2).map((skill, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                {skill}
              </span>
            ))}
            {result.matching_skills.length > 2 && (
              <span className="text-[10px] text-muted-foreground">
                +{result.matching_skills.length - 2}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Full mode (used in profile detail sheet) ──
  return (
    <div className="space-y-4">
      {/* ── Top: Score ring + Summary + Badges ── */}
      <div className="flex items-start gap-4">
        <ScoreRing score={result.match_score} size={72} />
        <div className="flex-1 min-w-0 space-y-2">
          {jobTitle && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
              <Target className="w-3 h-3" />
              Match pour: <span className="text-foreground/80">{jobTitle}</span>
            </div>
          )}
          <p className="text-sm text-foreground/90 leading-relaxed">{result.summary}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <RecommendationPill rec={result.recommendation} />
            {confidenceBadge}
            <MetaPill icon={Briefcase} label={expLabel.text} ok={expLabel.ok} />
            <MetaPill icon={MapPin} label={result.location_match ? 'Localisation OK' : 'Localisation ?' } ok={result.location_match} />
            <SalaryBadge analysis={result.salary_analysis} />
          </div>
        </div>
      </div>

      {/* ── Skills: visual bars ── */}
      {(result.matching_skills.length > 0 || result.missing_skills.length > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {/* Matched */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Matchés ({result.matching_skills.length})
            </p>
            {result.matching_skills.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {result.matching_skills.map((skill, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                    {skill}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">Aucun match direct</p>
            )}
          </div>
          {/* Missing */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-red-600 uppercase tracking-wider flex items-center gap-1">
              <XCircle className="w-3 h-3" />
              Manquants ({result.missing_skills.length})
            </p>
            {result.missing_skills.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {result.missing_skills.map((skill, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 font-medium">
                    {skill}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-emerald-600 italic">Tous les skills requis ✓</p>
            )}
          </div>
        </div>
      )}

      {/* ── Detailed scoring breakdown ── */}
      {result.scoring_details && (
        <ScoringBreakdown result={result} />
      )}

      {/* ── Salary analysis (collapsed into a subtle line) ── */}
      {result.salary_analysis && result.salary_analysis.status !== 'unknown' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border/40">
          <DollarSign className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium text-foreground/70">Salaire</span>
          <SalaryBadge analysis={result.salary_analysis} />
          {result.salary_analysis.explanation && (
            <span className="text-muted-foreground truncate">{result.salary_analysis.explanation}</span>
          )}
        </div>
      )}
    </div>
  );
};

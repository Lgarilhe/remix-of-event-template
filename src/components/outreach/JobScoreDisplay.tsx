import React from 'react';
import { CheckCircle2, XCircle, AlertCircle, Target, MapPin, Briefcase, TrendingUp, TrendingDown, DollarSign, HelpCircle } from 'lucide-react';
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
  error?: string;
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

export const JobScoreDisplay: React.FC<JobScoreDisplayProps> = ({ 
  result, 
  jobTitle,
  compact = false 
}) => {
  if (result.error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
        Erreur: {result.error}
      </div>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 75) return 'bg-emerald-500';
    if (score >= 50) return 'bg-amber-500';
    return 'bg-red-400';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 75) return 'bg-emerald-50 border-emerald-200';
    if (score >= 50) return 'bg-amber-50 border-amber-200';
    return 'bg-red-50 border-red-200';
  };

  const getRecommendationBadge = (rec: string) => {
    switch (rec) {
      case 'go':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="w-3 h-3" /> À contacter
          </span>
        );
      case 'maybe':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
            <AlertCircle className="w-3 h-3" /> À évaluer
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            <XCircle className="w-3 h-3" /> Peu adapté
          </span>
        );
    }
  };

  const getExperienceLabel = (exp: string) => {
    switch (exp) {
      case 'compatible': return { text: 'Expérience compatible', color: 'text-emerald-600' };
      case 'trop_junior': return { text: 'Trop junior', color: 'text-amber-600' };
      case 'trop_senior': return { text: 'Trop senior', color: 'text-amber-600' };
      default: return { text: 'À vérifier', color: 'text-gray-500' };
    }
  };

  const expLabel = getExperienceLabel(result.experience_match);

  if (compact) {
    return (
      <div className={cn(
        "flex items-center gap-3 p-2 rounded-lg border",
        getScoreBgColor(result.match_score)
      )}>
        <div className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm",
          getScoreColor(result.match_score)
        )}>
          {result.match_score}%
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {getRecommendationBadge(result.recommendation)}
            {/* Salary badge */}
            <SalaryBadge analysis={result.salary_analysis} />
            {result.matching_skills.slice(0, 2).map((skill, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                {skill}
              </span>
            ))}
            {result.matching_skills.length > 2 && (
              <span className="text-[10px] text-gray-400">
                +{result.matching_skills.length - 2}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "rounded-lg border p-4 space-y-3",
      getScoreBgColor(result.match_score)
    )}>
      {/* Header with score and job title */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-md",
            getScoreColor(result.match_score)
          )}>
            {result.match_score}%
          </div>
          <div>
            {jobTitle && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-0.5">
                <Target className="w-3 h-3" />
                Match pour: {jobTitle}
              </div>
            )}
            <p className="text-sm font-medium text-[#1A1A1A]">{result.summary}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {getRecommendationBadge(result.recommendation)}
          <SalaryBadge analysis={result.salary_analysis} />
        </div>
      </div>

      {/* Skills match */}
      <div className="grid grid-cols-2 gap-3">
        {/* Matching skills */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="w-3 h-3" />
            Skills matchés ({result.matching_skills.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {result.matching_skills.length > 0 ? (
              result.matching_skills.map((skill, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
                  ✓ {skill}
                </span>
              ))
            ) : (
              <span className="text-xs text-gray-400 italic">Aucun match direct</span>
            )}
          </div>
        </div>

        {/* Missing skills */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-red-600">
            <XCircle className="w-3 h-3" />
            Skills manquants ({result.missing_skills.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {result.missing_skills.length > 0 ? (
              result.missing_skills.map((skill, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                  ✗ {skill}
                </span>
              ))
            ) : (
              <span className="text-xs text-emerald-600 italic">Tous les skills requis ✓</span>
            )}
          </div>
        </div>
      </div>

      {/* Salary analysis section */}
      {result.salary_analysis && result.salary_analysis.status !== 'unknown' && (
        <div className="bg-white/50 rounded-lg p-2.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <DollarSign className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs font-medium text-gray-700">Analyse salaire</span>
            <SalaryBadge analysis={result.salary_analysis} />
          </div>
          {result.salary_analysis.explanation && (
            <p className="text-xs text-gray-600 pl-5">{result.salary_analysis.explanation}</p>
          )}
          {result.salary_analysis.estimated_market_salary && (
            <div className="flex items-center gap-4 pl-5 text-xs text-gray-500">
              <span>
                Marché estimé: {result.salary_analysis.estimated_market_salary.min}-{result.salary_analysis.estimated_market_salary.max} {result.salary_analysis.estimated_market_salary.currency}
              </span>
              {result.salary_analysis.job_salary?.min && (
                <span>
                  Poste: {result.salary_analysis.job_salary.min}-{result.salary_analysis.job_salary.max || '?'} {result.salary_analysis.job_salary.currency}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Experience and location */}
      <div className="flex items-center gap-4 pt-2 border-t border-current/10">
        <div className="flex items-center gap-1.5 text-xs">
          <Briefcase className="w-3 h-3 text-gray-400" />
          <span className={expLabel.color}>{expLabel.text}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <MapPin className="w-3 h-3 text-gray-400" />
          <span className={result.location_match ? 'text-emerald-600' : 'text-amber-600'}>
            {result.location_match ? 'Localisation OK' : 'Localisation à vérifier'}
          </span>
        </div>
      </div>
    </div>
  );
};

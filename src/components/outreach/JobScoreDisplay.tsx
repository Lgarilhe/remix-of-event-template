import React, { useState } from 'react';
import { CheckCircle2, XCircle, AlertCircle, Target, MapPin, Briefcase, TrendingUp, TrendingDown, DollarSign, AlertTriangle, Search, Ban, ChevronDown, Sparkles, Zap, Lightbulb, Shield } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  criteriaEvaluations?: Array<{ label: string; verdict: 'pass' | 'partial' | 'fail' | 'unknown'; reason: string }>;
  likelyToSwitchScore?: number | null;
  careerGrowthScore?: number | null;
  switchSignals?: string[];
  // ─── Sprint C : 3 axes de score + investigation + shape ────────────
  /** Confidence LLM (0-100) — distinct du confidenceScore data-completeness algo. */
  llmConfidenceScore?: number | null;
  /** Engagement (0-100) — probabilité de réponse positive à un outreach. */
  engagementScore?: number | null;
  /** True si profil mérite un call court avant de trancher (fit haut + confidence basse). */
  investigationNeeded?: boolean;
  /** 2-3 questions ciblées si investigationNeeded. */
  investigationFocus?: string[];
  /** Shape du profil — méta-signal (silencieux_competent, optimiseur, etc.). */
  shape?: string | null;
  /** Évaluation explicite du preset pedigree client (si présent). */
  pedigreeAssessment?: {
    presetName?: string;
    strictMode?: boolean;
    verdict?: 'match' | 'partial' | 'mismatch';
    matched?: string[];
    missed?: string[];
    capped?: boolean;
    detail?: string;
  } | null;
  skippedLLM?: boolean;
  processingTimeMs?: number;
  tokensUsed?: { input: number; output: number } | null;
}

export interface BatchScoringStats {
  total: number;
  hardFiltered: number;
  llmSkipped: number;
  llmCalled: number;
  /** Nombre de profils ré-évalués par le modèle d'escalation (tiered routing) */
  escalated?: number;
  /** Modèle d'escalation utilisé (ex: "claude-sonnet-4-6"). Présent si escalated > 0. */
  escalationModel?: string | null;
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
const ScoreRing: React.FC<{ score: number; size?: number; label?: string; tone?: 'primary' | 'success' | 'amber' | 'muted' }> = ({ score, size = 64, label, tone = 'primary' }) => {
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  // Couleur selon le tone (utilisé pour différencier fit / confidence / engagement)
  const strokeColor =
    tone === 'success' ? 'hsl(var(--success))' :
    tone === 'amber' ? 'hsl(38 92% 50%)' :  // amber-500
    tone === 'muted' ? 'hsl(var(--muted-foreground))' :
    'hsl(var(--primary))';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={strokeWidth} />
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={strokeColor} strokeWidth={strokeWidth}
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="butt" className="transition-all duration-700 ease-out" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={size <= 40 ? "text-sm font-bold text-foreground tabular-nums" : "text-lg font-bold text-foreground tabular-nums"}>{score}</span>
        </div>
      </div>
      {label && <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>}
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
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold border rounded-lg", config.cls)}>
      <Icon className="w-3 h-3" /> {config.label}
    </span>
  );
};

// ── Meta pill ──
const MetaPill: React.FC<{ icon: React.ElementType; label: string; ok: boolean }> = ({ icon: Icon, label, ok }) => (
  <span className={cn(
    "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium border rounded-lg",
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
          <p className="text-xs font-bold text-foreground">Éliminé par filtre</p>
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

  // Sprint UI-1 : 3 axes de score affichés séparément quand dispo (LLM-based).
  // - fit (= match_score) : adéquation candidat/poste
  // - confidence : sûreté de l'évaluation (LLM ou fallback algo)
  // - engagement : probabilité de réponse positive à un outreach
  const llmConfidence = result.llmConfidenceScore ?? null;
  const algoConfidence = result.confidenceScore ?? null;
  const confidence = llmConfidence ?? algoConfidence;
  const engagement = result.engagementScore ?? null;
  const showThreeRings = confidence != null || engagement != null;

  // Forces (strengths) et points d'attention (concerns) sont les highlights
  // les plus précieux du LLM. On les met en avant visuellement.
  const strengths = (result.scoring_details?.strengths || []).slice(0, 3);
  const concerns = (result.scoring_details?.concerns || []).slice(0, 3);

  return (
    <div className="space-y-5">
      {/* ─── HEADER : 3 scores ronds + verdict + summary ──────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:gap-5 gap-4">
        {/* Bloc rings : sur mobile en row full-width centré, desktop compact à gauche */}
        <div className="flex items-center gap-4 shrink-0 w-full sm:w-auto justify-around sm:justify-start">
          <ScoreRing score={result.match_score} size={72} label="Fit" tone="primary" />
          {confidence != null && (
            <ScoreRing
              score={confidence}
              size={52}
              label="Confiance"
              tone={confidence >= 70 ? 'success' : confidence >= 50 ? 'amber' : 'muted'}
            />
          )}
          {engagement != null && (
            <ScoreRing
              score={engagement}
              size={52}
              label="Engagement"
              tone={engagement >= 70 ? 'success' : engagement >= 50 ? 'amber' : 'muted'}
            />
          )}
        </div>

        {/* Bloc texte : recommandation + match pour + summary */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <RecommendationPill rec={result.recommendation} />
            {result.investigationNeeded && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium border border-amber-500/40 bg-amber-500/10 text-amber-600 cursor-help rounded-lg">
                    <Search className="w-3 h-3" />
                    À investiguer
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p className="text-xs font-medium">Profil prometteur mais signal faible</p>
                  {result.investigationFocus && result.investigationFocus.length > 0 ? (
                    <ul className="text-xs text-muted-foreground mt-1 list-disc list-inside space-y-0.5">
                      {result.investigationFocus.slice(0, 3).map((q, i) => (
                        <li key={i}>{typeof q === 'string' ? q : ''}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">À confirmer en call court (10-15 min).</p>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
            {!result.investigationNeeded && confidenceBadge}
          </div>
          {jobTitle && (
            <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Target className="w-3 h-3 mt-0.5 shrink-0" />
              <span>Match pour <span className="text-foreground font-semibold">{jobTitle}</span></span>
            </div>
          )}
          {result.summary && (
            <p className="text-sm text-foreground/90 leading-relaxed">{result.summary}</p>
          )}
        </div>
      </div>

      {/* ─── CRITÈRES CLÉS : 3 indicateurs visuels (XP, Localisation, Salaire) ───── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <CompatChip icon={Briefcase} label="Expérience" value={expLabel.text} ok={expLabel.ok} />
        <CompatChip icon={MapPin} label="Localisation" value={result.location_match ? 'Compatible' : 'À vérifier'} ok={!!result.location_match} />
        <SalaryCompatChip analysis={result.salary_analysis} />
      </div>

      {/* ─── FORCES & POINTS D'ATTENTION (highlights LLM) ──────────────────── */}
      {(strengths.length > 0 || concerns.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {strengths.length > 0 && (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                <Sparkles className="w-3.5 h-3.5" />
                Forces ({strengths.length})
              </div>
              <ul className="space-y-1 text-xs text-foreground/90">
                {strengths.map((s, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-emerald-500 shrink-0">·</span>
                    <span className="leading-relaxed">{typeof s === 'string' ? s : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {concerns.length > 0 && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-600">
                <AlertCircle className="w-3.5 h-3.5" />
                Points d'attention ({concerns.length})
              </div>
              <ul className="space-y-1 text-xs text-foreground/90">
                {concerns.map((c, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-amber-500 shrink-0">·</span>
                    <span className="leading-relaxed">{typeof c === 'string' ? c : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ─── SKILLS ──────────────────────────────────────────────── */}
      {allSkills.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs font-bold text-muted-foreground">
            <span className="flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="w-3.5 h-3.5" /> {result.matching_skills.length} matchés
            </span>
            {result.missing_skills.length > 0 && (
              <span className="flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" /> {result.missing_skills.length} manquants
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allSkills.map((s, i) => (
              <SkillTag key={i} skill={s.name} matched={s.matched} />
            ))}
          </div>
        </div>
      )}

      {/* ─── POWER SCORES (mobilité + progression carrière) ───────────────────── */}
      {(result.likelyToSwitchScore != null || result.careerGrowthScore != null) && (
        <div className="flex flex-wrap gap-2 items-center">
          {result.likelyToSwitchScore != null && (
            <PowerScoreChip
              icon={Zap}
              label="Mobilité"
              score={result.likelyToSwitchScore}
              tooltip="Probabilité que le candidat soit ouvert au changement (Open to Work, tenure courte, signaux d'activité)"
            />
          )}
          {result.careerGrowthScore != null && (
            <PowerScoreChip
              icon={TrendingUp}
              label="Progression"
              score={result.careerGrowthScore}
              tooltip="Trajectoire de carrière (promotions, montée en séniorité, qualité des entreprises)"
            />
          )}
          {result.switchSignals && result.switchSignals.length > 0 && (
            <div className="basis-full flex flex-wrap gap-1 mt-1">
              {result.switchSignals.slice(0, 5).map((signal, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 bg-muted/50 text-muted-foreground rounded">
                  {typeof signal === 'string' ? signal : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── PRESET PEDIGREE CLIENT (si appliqué) ──────────────────────── */}
      {result.pedigreeAssessment && (
        <PedigreeAssessmentBlock assessment={result.pedigreeAssessment} />
      )}

      {/* ─── CRITÈRES DU BRIEF (collapsible si > 3) ───────────────────── */}
      {result.criteriaEvaluations && result.criteriaEvaluations.length > 0 && (
        <CriteriaSection criteriaEvaluations={result.criteriaEvaluations} />
      )}

      {/* ─── DÉTAIL TECHNIQUE (collapsible) — dimensions algo brut ──────── */}
      {(result.dimensions && Object.values(result.dimensions).some(v => v != null)) || result.scoring_details ? (
        <Collapsible>
          <CollapsibleTrigger className="group w-full flex items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground border border-border rounded-md transition-colors hover:bg-muted/30">
            <span className="flex items-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5" />
              Détail du scoring
            </span>
            <ChevronDown className="w-4 h-4 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 space-y-3">
            {result.dimensions && Object.values(result.dimensions).some(v => v != null) && (
              <CriteriaIndicators dimensions={result.dimensions} />
            )}
            {result.scoring_details && <ScoringBreakdown result={result} />}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
};

// ── Compat chip (XP, Localisation, Salaire) — design moderne ──
const CompatChip: React.FC<{ icon: React.ElementType; label: string; value: string; ok: boolean }> = ({
  icon: Icon, label, value, ok,
}) => (
  <div
    className={cn(
      'flex items-center gap-2.5 px-3 py-2 border rounded-md transition-colors',
      ok
        ? 'border-emerald-500/30 bg-emerald-500/5'
        : 'border-border bg-muted/30',
    )}
  >
    <Icon className={cn('w-4 h-4 shrink-0', ok ? 'text-emerald-500' : 'text-muted-foreground')} />
    <div className="flex-1 min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground leading-none">{label}</p>
      <p className={cn('text-xs font-semibold mt-0.5 truncate', ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground')}>
        {value}
      </p>
    </div>
  </div>
);

// ── Salary compat chip dédié (gère les 3 cas analysed/null/range) ──
const SalaryCompatChip: React.FC<{ analysis?: SalaryAnalysis }> = ({ analysis }) => {
  if (!analysis) {
    return <CompatChip icon={DollarSign} label="Rémunération" value="Non vérifiée" ok={false} />;
  }
  const ok = analysis.compatible !== false && !analysis.over_max;
  return (
    <CompatChip
      icon={DollarSign}
      label="Rémunération"
      value={analysis.compatible ? 'Compatible' : analysis.over_max ? '> max' : '?'}
      ok={ok}
    />
  );
};

// ── Power score chip (Mobilité, Progression) ──
const PowerScoreChip: React.FC<{ icon: React.ElementType; label: string; score: number; tooltip?: string }> = ({
  icon: Icon, label, score, tooltip,
}) => {
  const tone = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  const cls = tone === 'high'
    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
    : tone === 'medium'
    ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
    : 'border-border bg-muted/30 text-muted-foreground';
  const chip = (
    <div className={cn('inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border rounded-md', cls)}>
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
      <span className="font-bold tabular-nums">{score}</span>
    </div>
  );
  if (!tooltip) return chip;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent className="max-w-xs"><p className="text-xs">{tooltip}</p></TooltipContent>
    </Tooltip>
  );
};

// ── Pedigree preset assessment ──
const PedigreeAssessmentBlock: React.FC<{ assessment: NonNullable<JobMatchResult['pedigreeAssessment']> }> = ({ assessment }) => {
  if (!assessment) return null;
  const verdictConfig = {
    match: { icon: CheckCircle2, label: "Conforme à l'ICP", cls: 'text-emerald-700 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5' },
    partial: { icon: AlertCircle, label: 'Partiellement conforme', cls: 'text-amber-700 dark:text-amber-400 border-amber-500/30 bg-amber-500/5' },
    mismatch: { icon: XCircle, label: 'Non conforme', cls: 'text-destructive border-destructive/30 bg-destructive/5' },
  }[assessment.verdict || 'partial'];
  const Icon = verdictConfig.icon;
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Shield className="w-3.5 h-3.5" />
        ICP société {assessment.presetName ? `— ${assessment.presetName}` : ''}
        {assessment.strictMode && <span className="text-3xs font-medium text-amber-600 dark:text-amber-400">(strict)</span>}
      </p>
      <div className={cn('flex items-start gap-2 px-2.5 py-2 border rounded-md text-xs', verdictConfig.cls)}>
        <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="font-semibold">
            {verdictConfig.label}
            {assessment.capped && <span className="ml-2 text-3xs uppercase font-bold tracking-wider">— score plafonné</span>}
          </div>
          {assessment.detail && <p className="text-muted-foreground">{assessment.detail}</p>}
          {assessment.matched && assessment.matched.length > 0 && (
            <p className="text-3xs"><span className="font-bold uppercase tracking-wider">Match</span> · {assessment.matched.join(' · ')}</p>
          )}
          {assessment.missed && assessment.missed.length > 0 && (
            <p className="text-3xs"><span className="font-bold uppercase tracking-wider">Manque</span> · {assessment.missed.join(' · ')}</p>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Criteria section (collapsible si > 3) ──
const CriteriaSection: React.FC<{ criteriaEvaluations: NonNullable<JobMatchResult['criteriaEvaluations']> }> = ({ criteriaEvaluations }) => {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? criteriaEvaluations : criteriaEvaluations.slice(0, 3);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5" />
          Critères du brief ({criteriaEvaluations.length})
        </p>
        {criteriaEvaluations.length > 3 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAll ? 'Réduire' : `+ ${criteriaEvaluations.length - 3} autres`}
          </button>
        )}
      </div>
      <div className="space-y-1">
        {visible.map((ce, i) => {
          const verdictConfig = {
            pass: { icon: CheckCircle2, cls: 'text-emerald-700 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5' },
            partial: { icon: AlertCircle, cls: 'text-amber-700 dark:text-amber-400 border-amber-500/30 bg-amber-500/5' },
            fail: { icon: XCircle, cls: 'text-destructive border-destructive/30 bg-destructive/5' },
            unknown: { icon: Search, cls: 'text-muted-foreground border-border bg-muted/30' },
          }[ce.verdict] || { icon: AlertCircle, cls: 'text-muted-foreground border-border bg-muted/30' };
          const Icon = verdictConfig.icon;
          return (
            <div key={i} className={cn('flex items-start gap-2 px-2.5 py-1.5 border rounded-md text-xs', verdictConfig.cls)}>
              <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold">{typeof ce.label === 'string' ? ce.label : ''}</span>
                {ce.reason && <span className="text-muted-foreground ml-1.5">— {typeof ce.reason === 'string' ? ce.reason : ''}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

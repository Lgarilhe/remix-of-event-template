import React from 'react';
import { type JobMatchResult, type ScoringDimensions } from './JobScoreDisplay';
import {
  CheckCircle2, XCircle, AlertTriangle, Shield, MapPin, Briefcase,
  GraduationCap, Clock, Radio, FileWarning, UserX, BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScoringBreakdownProps {
  result: JobMatchResult;
}

// ── Criterion Row (monochrome brutal) ──
const CriterionRow: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  status: 'good' | 'warning' | 'bad' | 'neutral';
  detail?: string | null;
}> = ({ icon: Icon, label, value, status, detail }) => {
  const badgeStyle = {
    good: 'bg-brutal-accent/15 border-brutal-accent/40 text-foreground',
    warning: 'bg-muted border-foreground/20 text-foreground',
    bad: 'bg-foreground text-background border-foreground',
    neutral: 'bg-muted/50 border-foreground/10 text-muted-foreground',
  };

  return (
    <div className="flex items-start gap-2.5 p-2.5 border border-foreground/10 bg-background hover:bg-muted/10 transition-colors rounded-none">
      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-foreground/60" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold text-foreground uppercase tracking-widest">{label}</span>
          <span className={cn('text-[10px] font-bold px-2 py-0.5 border rounded-none', badgeStyle[status])}>
            {value}
          </span>
        </div>
        {detail && <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{detail}</p>}
      </div>
    </div>
  );
};


function seniorityStatus(val?: string): { value: string; status: 'good' | 'warning' | 'bad' | 'neutral' } {
  if (!val) return { value: '—', status: 'neutral' };
  const v = val.toUpperCase();
  if (v === 'MATCH' || v === 'COMPATIBLE') return { value: 'Compatible', status: 'good' };
  if (v === 'OVER' || v.includes('SENIOR')) return { value: 'Trop senior', status: 'warning' };
  if (v === 'UNDER' || v.includes('JUNIOR')) return { value: 'Trop junior', status: 'warning' };
  return { value: val, status: 'neutral' };
}

function locationStatus(val?: string): { value: string; status: 'good' | 'warning' | 'bad' | 'neutral' } {
  if (!val || val === 'unknown') return { value: '—', status: 'neutral' };
  if (val === 'compatible') return { value: 'Compatible', status: 'good' };
  if (val === 'partial') return { value: 'Partiel', status: 'warning' };
  if (val === 'incompatible') return { value: 'Incompatible', status: 'bad' };
  return { value: val, status: 'neutral' };
}

function tenureStatus(val?: string): { value: string; status: 'good' | 'warning' | 'bad' | 'neutral' } {
  if (!val) return { value: '—', status: 'neutral' };
  const v = val.toUpperCase();
  if (v.includes('SHORT') || v.includes('COURT') || v.includes('RISK')) return { value: 'Tenure courte', status: 'warning' };
  if (v.includes('STABLE') || v.includes('OK') || v.includes('GOOD') || v.includes('NORMAL')) return { value: 'Stable', status: 'good' };
  return { value: val.length > 25 ? val.slice(0, 22) + '…' : val, status: 'neutral' };
}

function diplomaStatus(val?: string): { value: string; status: 'good' | 'warning' | 'bad' | 'neutral' } {
  if (!val || val === 'none') return { value: 'Aucun risque', status: 'good' };
  if (val === 'low') return { value: 'Faible', status: 'neutral' };
  if (val === 'medium') return { value: 'Modéré', status: 'warning' };
  if (val === 'high') return { value: 'Élevé', status: 'bad' };
  return { value: val, status: 'neutral' };
}

// ── Dimensions Breakdown (monochrome with brutal-accent bars) ──
const DIMENSION_LABELS: Record<string, string> = {
  tech_stack: 'Tech Stack',
  seniority: 'Séniorité',
  domain: 'Domaine',
  company_fit: 'Company Fit',
  soft_skills: 'Soft Skills',
};

const DimensionsBreakdown: React.FC<{ dimensions: ScoringDimensions; finalScore: number }> = ({ dimensions, finalScore }) => {
  const entries = Object.entries(dimensions).filter(([, v]) => v != null) as [string, { score: number; weight: number }][];
  if (entries.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
        <BarChart3 className="w-3 h-3" />
        Score par dimension
      </p>
      <div className="space-y-2">
        {entries.map(([key, dim]) => (
          <div key={key} className="flex items-center gap-2 text-[11px]">
            <span className="w-24 text-muted-foreground font-medium truncate">{DIMENSION_LABELS[key] || key}</span>
            <div className="flex-1 h-2.5 bg-muted/40 overflow-hidden rounded-none border border-foreground/5">
              <div
                className="h-full transition-all duration-500 bg-brutal-accent"
                style={{ width: `${dim.score}%`, opacity: dim.score >= 50 ? 1 : 0.5 }}
              />
            </div>
            <span className="w-12 text-right tabular-nums font-bold text-foreground">{dim.score}/100</span>
            <span className="w-16 text-right text-[9px] text-muted-foreground/60 uppercase tracking-wider">(poids {Math.round(dim.weight * 100)}%)</span>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-2 border-t border-foreground/20 mt-2">
          <span className="w-24 text-foreground font-black text-[11px] uppercase tracking-wider">Score Final</span>
          <div className="flex-1" />
          <span className="text-sm font-black text-foreground tabular-nums">{finalScore}/100</span>
          <span className="w-16" />
        </div>
      </div>
    </div>
  );
};

export const ScoringBreakdown: React.FC<ScoringBreakdownProps> = ({ result }) => {
  const details = result.scoring_details;
  if (!details) return null;

  const { strengths = [], concerns = [] } = details;

  const seniority = seniorityStatus(details.seniorityMatch);
  const location = locationStatus(details.locationCompatibility);
  const tenure = tenureStatus(details.tenureAnalysis);
  const diploma = diplomaStatus(details.foreignDiplomaRisk);

  const expLabel = {
    compatible: { text: 'Compatible', status: 'good' as const },
    trop_junior: { text: 'Trop junior', status: 'warning' as const },
    trop_senior: { text: 'Trop senior', status: 'warning' as const },
    incertain: { text: 'À vérifier', status: 'neutral' as const },
  }[result.experience_match] || { text: '—', status: 'neutral' as const };

  const receptivity = details.receptivityScore;

  return (
    <div className="space-y-4">
      {result.dimensions && <DimensionsBreakdown dimensions={result.dimensions} finalScore={result.match_score} />}

      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
          <Shield className="w-3 h-3" />
          Analyse critère par critère
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          <CriterionRow icon={Briefcase} label="Expérience" value={expLabel.text} status={expLabel.status} />
          <CriterionRow icon={UserX} label="Séniorité" value={seniority.value} status={seniority.status} />
          <CriterionRow icon={MapPin} label="Localisation" value={location.value} status={location.status}
            detail={details.candidatePreferencesConflict} />
          <CriterionRow icon={Clock} label="Tenure" value={tenure.value} status={tenure.status} />
          <CriterionRow icon={GraduationCap} label="Diplôme étranger" value={diploma.value} status={diploma.status} />
          <CriterionRow icon={Radio} label="Réceptivité"
            value={receptivity != null ? `${receptivity}/10` : '—'}
            status={receptivity != null ? (receptivity >= 7 ? 'good' : receptivity >= 4 ? 'neutral' : 'warning') : 'neutral'} />
          {details.contractMismatch && (
            <CriterionRow icon={FileWarning} label="Contrat" value="Mismatch" status="bad"
              detail={details.contractMismatch} />
          )}
        </div>
      </div>

      {(strengths.length > 0 || concerns.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {strengths.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-foreground flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Points forts ({strengths.length})
              </p>
              {strengths.map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] text-foreground/80 bg-brutal-accent/10 px-2.5 py-1.5 border border-brutal-accent/20 rounded-none">
                  <span className="text-foreground mt-0.5 shrink-0">✓</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          )}
          {concerns.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-foreground flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Points d'attention ({concerns.length})
              </p>
              {concerns.map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] text-foreground/80 bg-muted/30 px-2.5 py-1.5 border border-foreground/10 rounded-none">
                  <span className="text-foreground/50 mt-0.5 shrink-0">!</span>
                  <span>{c}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {details.skipReason && (
        <div className="flex items-start gap-2 text-xs text-foreground bg-foreground/5 px-3 py-2 border border-foreground/20 rounded-none">
          <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="font-bold uppercase tracking-wider text-[10px]">{details.skipReason}</span>
        </div>
      )}
    </div>
  );
};

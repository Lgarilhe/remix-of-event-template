import React from 'react';
import { ScoringDetails, JobMatchResult } from './JobScoreDisplay';
import {
  CheckCircle2, XCircle, AlertTriangle, Shield, MapPin, Briefcase,
  GraduationCap, Clock, Radio, FileWarning, UserX, Heart,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScoringBreakdownProps {
  result: JobMatchResult;
}

// ── Criterion Row ──
const CriterionRow: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  status: 'good' | 'warning' | 'bad' | 'neutral';
  detail?: string | null;
}> = ({ icon: Icon, label, value, status, detail }) => {
  const statusStyles = {
    good: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    warning: 'bg-amber-50 border-amber-200 text-amber-700',
    bad: 'bg-red-50 border-red-200 text-red-600',
    neutral: 'bg-muted/50 border-border text-muted-foreground',
  };

  const iconStyles = {
    good: 'text-emerald-600',
    warning: 'text-amber-600',
    bad: 'text-red-500',
    neutral: 'text-muted-foreground',
  };

  return (
    <div className="flex items-start gap-2.5 p-2.5 border border-border/40 bg-background hover:bg-muted/20 transition-colors">
      <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', iconStyles[status])} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">{label}</span>
          <span className={cn('text-[10px] font-semibold px-2 py-0.5 border', statusStyles[status])}>
            {value}
          </span>
        </div>
        {detail && (
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{detail}</p>
        )}
      </div>
    </div>
  );
};

// ── Helpers ──
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
      {/* ── Criteria Grid ── */}
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

      {/* ── Strengths & Concerns ── */}
      {(strengths.length > 0 || concerns.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {strengths.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Points forts ({strengths.length})
              </p>
              {strengths.map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] text-foreground/80 bg-emerald-50/50 px-2.5 py-1.5 border border-emerald-200/60">
                  <span className="text-emerald-500 mt-0.5 shrink-0">✓</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          )}
          {concerns.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Points d'attention ({concerns.length})
              </p>
              {concerns.map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] text-foreground/80 bg-amber-50/50 px-2.5 py-1.5 border border-amber-200/60">
                  <span className="text-amber-500 mt-0.5 shrink-0">!</span>
                  <span>{c}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Skip Reason ── */}
      {details.skipReason && (
        <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50/50 px-3 py-2 border border-red-200/60">
          <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="font-medium">{details.skipReason}</span>
        </div>
      )}
    </div>
  );
};

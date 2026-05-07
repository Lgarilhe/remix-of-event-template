import React, { useState } from 'react';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { CreditCostBadge } from '@/components/ai/CreditCostBadge';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { ATSCandidate } from '@/hooks/useATSData';
import { Shield, ShieldAlert, ShieldCheck, ShieldX, Loader2, AlertTriangle, Clock, TrendingUp, GraduationCap, Shuffle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  candidate: ATSCandidate;
}

interface Anomaly {
  category: 'TIMELINE' | 'INFLATION' | 'EDUCATION' | 'COHERENCE';
  severity: 'low' | 'medium' | 'high';
  description: string;
  detail?: string;
}

interface FraudResult {
  trust_score: number;
  anomalies: Anomaly[];
}

const CATEGORY_CONFIG = {
  TIMELINE: { icon: Clock, label: 'Timeline', color: 'text-info' },
  INFLATION: { icon: TrendingUp, label: 'Inflation', color: 'text-warning' },
  EDUCATION: { icon: GraduationCap, label: 'Éducation', color: 'text-brand-purple' },
  COHERENCE: { icon: Shuffle, label: 'Cohérence', color: 'text-info' },
};

const SEVERITY_CONFIG = {
  low: { label: 'Faible', bg: 'bg-info/10 text-info', dot: 'bg-info' },
  medium: { label: 'Moyen', bg: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  high: { label: 'Élevé', bg: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
};

export const FraudDetectionTab: React.FC<Props> = ({ candidate }) => {
  const [result, setResult] = useState<FraudResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await invokeWithCredits('detect-profile-fraud', 'screen_candidate', {
        profileData: candidate.linkedinProfileData,
        candidateName: candidate.name,
        headline: candidate.headline,
      }, { modelOverride: selectedModel ?? undefined });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setResult(data as any);
    } catch (e: any) {
      setError(e.message || 'Erreur lors de l\'analyse');
    } finally {
      setLoading(false);
    }
  };

  if (!candidate.linkedinProfileData) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ShieldAlert className="w-10 h-10 text-muted-foreground mb-3" />
        <p className="text-sm font-medium text-foreground">Données de profil indisponibles</p>
        <p className="text-xs text-muted-foreground mt-1">
          L'analyse nécessite les données LinkedIn enrichies du candidat.
        </p>
      </div>
    );
  }

  if (!result && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="h-12 w-12 rounded-2xl bg-emerald-500/15 grid place-items-center mb-3">
          <Shield className="w-5 h-5 text-foreground" />
        </div>
        <p className="font-display text-base font-bold tracking-tight text-foreground">Détection de fraude IA</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Analyse automatique du profil pour détecter les incohérences : dates, titres gonflés, diplômes douteux.
        </p>
        <div className="flex items-center gap-2 mt-4">
          <button
            type="button"
            onClick={runAnalysis}
            className="h-9 px-5 rounded-full bg-foreground text-background text-xs font-medium hover:bg-foreground/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Lancer l'analyse
          </button>
          <CreditCostBadge actionId="screen_candidate" />
          <ModelPicker actionId="screen_candidate" value={selectedModel} onChange={setSelectedModel} compact />
        </div>
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-foreground mb-3" />
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Analyse en cours…</p>
      </div>
    );
  }

  if (!result) return null;

  const ScoreIcon = result.trust_score >= 80 ? ShieldCheck
    : result.trust_score >= 50 ? ShieldAlert
    : ShieldX;

  const scoreColor = result.trust_score >= 80 ? 'text-success'
    : result.trust_score >= 50 ? 'text-warning'
    : 'text-destructive';

  return (
    <div className="space-y-4">
      {/* Trust Score */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
        <ScoreIcon className={cn("w-10 h-10 shrink-0", scoreColor)} />
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cn("font-display text-3xl font-bold tabular-nums tracking-tight", scoreColor)}>
              {result.trust_score}
            </span>
            <span className="text-xs text-muted-foreground">/100 confiance</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {result.anomalies.length === 0
              ? 'Aucune anomalie détectée — profil cohérent.'
              : `${result.anomalies.length} anomalie${result.anomalies.length > 1 ? 's' : ''} détectée${result.anomalies.length > 1 ? 's' : ''}`
            }
          </p>
        </div>
        <button
          type="button"
          onClick={runAnalysis}
          disabled={loading}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
        >
          Relancer
        </button>
      </div>

      {/* Anomalies List */}
      {result.anomalies.length > 0 && (
        <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
          {result.anomalies.map((anomaly, i) => {
            const cat = CATEGORY_CONFIG[anomaly.category];
            const sev = SEVERITY_CONFIG[anomaly.severity];
            const CatIcon = cat.icon;
            return (
              <div key={i} className="p-3">
                <div className="flex items-start gap-2.5">
                  <CatIcon className={cn("w-4 h-4 mt-0.5 shrink-0", cat.color)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {cat.label}
                      </span>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", sev.bg)}>
                        {sev.label}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground">{anomaly.description}</p>
                    {anomaly.detail && (
                      <p className="text-xs text-muted-foreground mt-1">{anomaly.detail}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

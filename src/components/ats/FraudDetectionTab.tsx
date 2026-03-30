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
  TIMELINE: { icon: Clock, label: 'Timeline', color: 'text-blue-600' },
  INFLATION: { icon: TrendingUp, label: 'Inflation', color: 'text-orange-600' },
  EDUCATION: { icon: GraduationCap, label: 'Éducation', color: 'text-purple-600' },
  COHERENCE: { icon: Shuffle, label: 'Cohérence', color: 'text-cyan-600' },
};

const SEVERITY_CONFIG = {
  low: { label: 'Faible', bg: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300', dot: 'bg-yellow-500' },
  medium: { label: 'Moyen', bg: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300', dot: 'bg-orange-500' },
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
        <p className="text-[11px] text-muted-foreground mt-1">
          L'analyse nécessite les données LinkedIn enrichies du candidat.
        </p>
      </div>
    );
  }

  if (!result && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Shield className="w-10 h-10 text-muted-foreground mb-3" />
        <p className="text-sm font-medium text-foreground">Détection de fraude IA</p>
        <p className="text-[11px] text-muted-foreground mt-1 max-w-xs">
          Analyse automatique du profil pour détecter les incohérences : dates, titres gonflés, diplômes douteux.
        </p>
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={runAnalysis}
            className="relative overflow-hidden h-[34px] px-6 border border-foreground text-foreground text-[11px] font-medium uppercase tracking-wider group"
          >
            <span className="relative z-10">Lancer l'analyse</span>
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          </button>
          <CreditCostBadge actionId="screen_candidate" />
          <ModelPicker actionId="screen_candidate" value={selectedModel} onChange={setSelectedModel} compact />
        </div>
        {error && <p className="text-[11px] text-destructive mt-2">{error}</p>}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-foreground mb-3" />
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Analyse en cours…</p>
      </div>
    );
  }

  if (!result) return null;

  const ScoreIcon = result.trust_score >= 80 ? ShieldCheck
    : result.trust_score >= 50 ? ShieldAlert
    : ShieldX;

  const scoreColor = result.trust_score >= 80 ? 'text-emerald-600'
    : result.trust_score >= 50 ? 'text-yellow-600'
    : 'text-destructive';

  return (
    <div className="space-y-4">
      {/* Trust Score */}
      <div className="border border-foreground bg-background p-4 flex items-center gap-4">
        <ScoreIcon className={cn("w-10 h-10 shrink-0", scoreColor)} />
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cn("text-3xl font-black tabular-nums", scoreColor)}>
              {result.trust_score}
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">/100 confiance</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {result.anomalies.length === 0
              ? 'Aucune anomalie détectée — profil cohérent.'
              : `${result.anomalies.length} anomalie${result.anomalies.length > 1 ? 's' : ''} détectée${result.anomalies.length > 1 ? 's' : ''}`
            }
          </p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading}
          className="text-[9px] text-muted-foreground hover:text-foreground uppercase tracking-wider"
        >
          Relancer
        </button>
      </div>

      {/* Anomalies List */}
      {result.anomalies.length > 0 && (
        <div className="border border-foreground bg-background divide-y divide-border">
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
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                        {cat.label}
                      </span>
                      <span className={cn("text-[8px] px-1.5 py-0.5 font-medium uppercase tracking-wider", sev.bg)}>
                        {sev.label}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground">{anomaly.description}</p>
                    {anomaly.detail && (
                      <p className="text-[11px] text-muted-foreground mt-1">{anomaly.detail}</p>
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

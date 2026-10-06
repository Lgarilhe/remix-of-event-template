import React, { useState } from 'react';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { isInsufficientCreditsError } from '@/lib/invokeEdgeFunction';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { ATSCandidate } from '@/hooks/useATSData';
import { Clock, GraduationCap, Shield, ShieldAlert, ShieldCheck, ShieldX, Shuffle, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/layout/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/IconTile';
import { Spinner } from '@/components/ui/spinner';

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

/** Catégories d'anomalie : un libellé et une icône neutres (revue design E-32, E-45). */
const CATEGORY_CONFIG = {
  TIMELINE: { icon: Clock, label: 'Chronologie' },
  INFLATION: { icon: TrendingUp, label: 'Intitulés gonflés' },
  EDUCATION: { icon: GraduationCap, label: 'Formation' },
  COHERENCE: { icon: Shuffle, label: 'Cohérence' },
};

const SEVERITY_CONFIG = {
  low: { label: 'Gravité faible', variant: 'muted' as const },
  medium: { label: 'Gravité moyenne', variant: 'warning' as const },
  high: { label: 'Gravité élevée', variant: 'danger' as const },
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
      const { data, error: fnError } = await invokeWithCredits<FraudResult & { error?: string }>('detect-profile-fraud', 'screen_candidate', {
        profileData: candidate.linkedinProfileData,
        candidateName: candidate.name,
        headline: candidate.headline,
      }, { modelOverride: selectedModel ?? undefined });
      if (fnError) {
        console.error('[FraudDetectionTab] vérification impossible :', fnError);
        setError(
          isInsufficientCreditsError(fnError)
            ? 'Crédits IA insuffisants pour lancer la vérification.'
            : 'La vérification a échoué. Réessayez dans un instant.',
        );
        return;
      }
      if (data?.error || !Array.isArray(data?.anomalies)) {
        console.error('[FraudDetectionTab] réponse inattendue :', data);
        setError('La vérification a échoué. Réessayez dans un instant.');
        return;
      }
      setResult(data);
    } catch (e) {
      console.error('[FraudDetectionTab] vérification impossible :', e);
      setError('La vérification a échoué. Réessayez dans un instant.');
    } finally {
      setLoading(false);
    }
  };

  if (!candidate.linkedinProfileData) {
    return (
      <EmptyState
        variant="compact"
        icon={ShieldAlert}
        title="Profil LinkedIn indisponible"
        description="La vérification a besoin du profil LinkedIn complet du candidat."
      />
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <Spinner label="Vérification du profil en cours" />
        <p className="text-sm text-muted-foreground" aria-hidden="true">Vérification en cours…</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <IconTile icon={Shield} size="lg" className="mb-3" />
        <p className="text-md font-semibold text-foreground">Vérifier la cohérence du profil</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
          L'IA Konekt repère les incohérences du profil&nbsp;: dates, intitulés gonflés, diplômes douteux.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" onClick={() => void runAnalysis()} className="max-md:min-h-11">
            {error ? 'Relancer la vérification' : 'Lancer la vérification'}
          </Button>
          <ModelPicker actionId="screen_candidate" value={selectedModel} onChange={setSelectedModel} compact />
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  const ScoreIcon = result.trust_score >= 80 ? ShieldCheck
    : result.trust_score >= 50 ? ShieldAlert
    : ShieldX;

  const scoreColor = result.trust_score >= 80 ? 'text-success'
    : result.trust_score >= 50 ? 'text-warning'
    : 'text-danger';

  return (
    <div className="space-y-4">
      {/* Indice de confiance */}
      <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
        <ScoreIcon className={cn('h-10 w-10 shrink-0', scoreColor)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2">
            <span className={cn('text-3xl font-bold tabular-nums', scoreColor)}>{result.trust_score}</span>
            <span className="text-xs text-muted-foreground">sur 100, indice de confiance</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {result.anomalies.length === 0
              ? 'Aucune anomalie détectée\u00a0: le profil est cohérent.'
              : `${result.anomalies.length} anomalie${result.anomalies.length > 1 ? 's' : ''} détectée${result.anomalies.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <Button variant="ghost" size="xs" onClick={() => void runAnalysis()} className="shrink-0 max-md:min-h-11">
          Relancer la vérification
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error} Le résultat affiché est celui de la vérification précédente.
        </p>
      )}

      {/* Anomalies */}
      {result.anomalies.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {result.anomalies.map((anomaly, i) => {
            const cat = CATEGORY_CONFIG[anomaly.category] ?? CATEGORY_CONFIG.COHERENCE;
            const sev = SEVERITY_CONFIG[anomaly.severity] ?? SEVERITY_CONFIG.low;
            const CatIcon = cat.icon;
            return (
              <li key={i} className="p-3">
                <div className="flex items-start gap-2.5">
                  <CatIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex flex-wrap items-center gap-2">
                      <span className="eyebrow">{cat.label}</span>
                      <Badge variant={sev.variant}>{sev.label}</Badge>
                    </div>
                    <p className="text-sm font-medium text-foreground">{anomaly.description}</p>
                    {anomaly.detail && <p className="mt-1 text-xs text-muted-foreground">{anomaly.detail}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

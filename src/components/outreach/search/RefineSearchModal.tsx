import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Maximize2, Minimize2, Check, X, AlertTriangle, ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RefineAdjustment {
  field: string;
  value: unknown;
  reason: string;
}

export type AdjustmentDecision = 'accept' | 'cautious' | 'reject';

interface RefineSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  direction: 'expand' | 'narrow';
  loading: boolean;
  adjustments: RefineAdjustment[];
  summary: string | null;
  expectedImpact: string | null;
  onFetchSuggestions: () => void;
  onApply: (decisions: Record<number, AdjustmentDecision>) => void;
}

const FIELD_LABELS: Record<string, string> = {
  keywords: 'Mots-clés Boolean',
  location_within_area: 'Rayon géographique',
  role: 'Titre / Rôle',
  calculated_experience_min: 'Expérience min (calculée)',
  calculated_experience_max: 'Expérience max (calculée)',
  years_of_experience: 'Expérience (LinkedIn)',
  years_of_experience_min: 'Expérience min (LinkedIn)',
  years_of_experience_max: 'Expérience max (LinkedIn)',
  degree: 'Niveau d\'études',
  skills_keywords: 'Compétences',
  company: 'Entreprise',
  industry: 'Secteur',
  seniority: 'Séniorité',
  school: 'École',
  location: 'Localisation',
};

const IMPACT_LABELS: Record<string, { label: string; className: string }> = {
  beaucoup_plus: { label: '↑↑ Beaucoup plus de résultats', className: 'text-success-foreground bg-success/10 border-success/20' },
  plus: { label: '↑ Plus de résultats', className: 'text-success-foreground bg-success/5 border-success/10' },
  similaire: { label: '≈ Résultats similaires', className: 'text-muted-foreground bg-muted/50 border-border' },
  moins: { label: '↓ Moins de résultats', className: 'text-warning-foreground bg-warning/10 border-warning/20' },
  beaucoup_moins: { label: '↓↓ Beaucoup moins', className: 'text-destructive bg-destructive/10 border-destructive/20' },
};

const DECISION_OPTIONS = [
  { value: 'accept' as const, label: 'Oui', icon: Check, className: 'border-success/30 bg-success/10 text-success-foreground hover:bg-success/20' },
  { value: 'cautious' as const, label: 'Avec prudence', icon: AlertTriangle, className: 'border-warning/30 bg-warning/10 text-warning-foreground hover:bg-warning/20' },
  { value: 'reject' as const, label: 'Non', icon: X, className: 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20' },
];

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '(vide)';
    // Array of objects with name/keywords
    if (typeof value[0] === 'object' && value[0] !== null) {
      return value.map((v: any) => v.name || v.keywords || JSON.stringify(v)).join(', ');
    }
    return value.join(', ');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('min' in obj || 'max' in obj) {
      return `${obj.min ?? '?'} – ${obj.max ?? '?'} ans`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

export const RefineSearchModal: React.FC<RefineSearchModalProps> = ({
  open,
  onOpenChange,
  direction,
  loading,
  adjustments,
  summary,
  expectedImpact,
  onFetchSuggestions,
  onApply,
}) => {
  const [decisions, setDecisions] = useState<Record<number, AdjustmentDecision>>({});

  const setDecision = useCallback((index: number, decision: AdjustmentDecision) => {
    setDecisions(prev => ({ ...prev, [index]: decision }));
  }, []);

  const acceptedCount = Object.values(decisions).filter(d => d === 'accept' || d === 'cautious').length;
  const allDecided = adjustments.length > 0 && Object.keys(decisions).length === adjustments.length;

  const handleApply = useCallback(() => {
    onApply(decisions);
  }, [decisions, onApply]);

  // Accept all
  const handleAcceptAll = useCallback(() => {
    const all: Record<number, AdjustmentDecision> = {};
    adjustments.forEach((_, i) => { all[i] = 'accept'; });
    setDecisions(all);
  }, [adjustments]);

  // Reject all
  const handleRejectAll = useCallback(() => {
    const all: Record<number, AdjustmentDecision> = {};
    adjustments.forEach((_, i) => { all[i] = 'reject'; });
    setDecisions(all);
  }, [adjustments]);

  // Reset when modal opens
  React.useEffect(() => {
    if (open) {
      setDecisions({});
      if (adjustments.length === 0) {
        onFetchSuggestions();
      }
    }
  }, [open]);

  const impact = expectedImpact ? IMPACT_LABELS[expectedImpact] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {direction === 'expand' ? (
              <Maximize2 className="w-5 h-5 text-success-foreground" />
            ) : (
              <Minimize2 className="w-5 h-5 text-warning-foreground" />
            )}
            {direction === 'expand' ? 'Élargir la recherche' : 'Affiner la recherche'}
          </DialogTitle>
          <DialogDescription>
            L'IA propose des ajustements pour vos filtres. Choisissez ceux que vous souhaitez appliquer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Analyse de vos filtres en cours...</p>
            </div>
          )}

          {!loading && adjustments.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">Aucune suggestion disponible.</p>
            </div>
          )}

          {!loading && adjustments.length > 0 && (
            <>
              {/* Summary + Impact */}
              {(summary || impact) && (
                <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
                  {summary && (
                    <div className="flex items-start gap-2">
                      <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <p className="text-sm text-foreground">{summary}</p>
                    </div>
                  )}
                  {impact && (
                    <Badge variant="outline" className={cn('text-xs', impact.className)}>
                      {impact.label}
                    </Badge>
                  )}
                </div>
              )}

              {/* Quick actions */}
              <div className="flex items-center gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={handleAcceptAll} className="text-xs h-7 text-success-foreground hover:text-success-foreground/80">
                  <Check className="w-3 h-3 mr-1" />
                  Tout accepter
                </Button>
                <Button variant="ghost" size="sm" onClick={handleRejectAll} className="text-xs h-7 text-destructive hover:text-destructive/80">
                  <X className="w-3 h-3 mr-1" />
                  Tout refuser
                </Button>
              </div>

              {/* Adjustments list */}
              <div className="space-y-2">
                {adjustments.map((adj, index) => {
                  const decision = decisions[index];
                  return (
                    <div
                      key={index}
                      className={cn(
                        'rounded-xl border p-3 transition-colors',
                        decision === 'accept' && 'border-success/20 bg-success/5',
                        decision === 'cautious' && 'border-warning/20 bg-warning/5',
                        decision === 'reject' && 'border-destructive/20 bg-destructive/5 opacity-60',
                        !decision && 'border-border bg-background'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="secondary" className="text-xs font-medium shrink-0">
                              {FIELD_LABELS[adj.field] || adj.field}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{adj.reason}</p>
                        </div>
                      </div>

                      {/* New value preview */}
                      <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-lg bg-muted/50">
                        <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        <code className="text-xs text-foreground break-all">
                          {formatValue(adj.value)}
                        </code>
                      </div>

                      {/* Decision buttons */}
                      <div className="flex items-center gap-1.5">
                        {DECISION_OPTIONS.map((opt) => {
                          const Icon = opt.icon;
                          const isSelected = decision === opt.value;
                          return (
                            <button
                              key={opt.value}
                              onClick={() => setDecision(index, opt.value)}
                              className={cn(
                                'flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all',
                                isSelected
                                  ? cn(opt.className, 'ring-1 ring-offset-1', 
                                      opt.value === 'accept' && 'ring-success',
                                      opt.value === 'cautious' && 'ring-warning',
                                      opt.value === 'reject' && 'ring-destructive')
                                  : 'border-border bg-background text-muted-foreground hover:bg-accent/50'
                              )}
                            >
                              <Icon className="w-3 h-3" />
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={handleApply}
            disabled={acceptedCount === 0}
            className="gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            Appliquer {acceptedCount > 0 ? `(${acceptedCount})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * EmployerBrandCard — l'audit marque employeur devient une feature du produit
 * (refonte onboarding 06/07/2026).
 *
 * Avant : écran bloquant de l'onboarding (jusqu'à 60 s d'attente), résultat
 * jeté à la fermeture. Maintenant : carte dashboard à la demande, résultat
 * persisté dans employer_brand_audits (re-consultable), garde-fou de
 * fréquence 7 jours côté serveur.
 */

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2, ScanSearch, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import type { EnrichmentSnapshot } from '@/lib/activationDrafts';
import { toast } from 'sonner';

interface AuditCategory {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  summary: string;
}

interface PersistedAudit {
  score: number | null;
  categories: AuditCategory[] | null;
  quick_wins: string[] | null;
  created_at: string;
}

const dismissKey = (orgId: string) => `konekt:employer-brand-dismissed:${orgId}`;
const RERUN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export const EmployerBrandCard: React.FC = () => {
  const queryClient = useQueryClient();
  const { organization, organizationId } = useOrganization();
  const [dismissed, setDismissed] = useState(() =>
    organizationId ? localStorage.getItem(dismissKey(organizationId)) === '1' : false
  );
  const [isRunning, setIsRunning] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const { data: audit, isLoading } = useQuery({
    queryKey: ['employer-brand-audit', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const { data } = await (supabase as any)
        .from('employer_brand_audits')
        .select('score, categories, quick_wins, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data ?? null) as PersistedAudit | null;
    },
    enabled: !!organizationId && !dismissed,
    staleTime: 5 * 60 * 1000,
  });

  if (!organizationId || dismissed || isLoading) return null;

  const snapshot = ((organization as any)?.enrichment_snapshot ?? null) as EnrichmentSnapshot | null;
  const canRerun = !audit || Date.now() - new Date(audit.created_at).getTime() > RERUN_COOLDOWN_MS;

  const handleDismiss = () => {
    localStorage.setItem(dismissKey(organizationId), '1');
    setDismissed(true);
  };

  const runAudit = async () => {
    setIsRunning(true);
    try {
      const website = (organization as any)?.website || snapshot?.websiteUrl || null;
      const domain = website ? website.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : snapshot?.domain || null;
      // Pas de force : le garde-fou 7 jours côté serveur est la seule source
      // de vérité (un force systématique le neutraliserait — un cache client
      // périmé suffirait à re-payer un audit complet pendant le cooldown).
      const { data, error } = await invokeEdgeFunction<{ cached?: boolean }>('audit-employer-brand', {
        company_name: snapshot?.name || organization?.name,
        domain,
        linkedin_url: snapshot?.linkedinUrl || null,
        careers_url: snapshot?.careersUrl || null,
        organization_id: organizationId,
      });
      if (error || !(data as any)?.success) {
        throw new Error((data as any)?.error || 'Audit indisponible pour le moment');
      }
      if ((data as any).cached) {
        toast.info('Un audit récent existe déjà — résultat réutilisé.');
      } else {
        toast.success('Audit marque employeur terminé');
      }
      queryClient.invalidateQueries({ queryKey: ['employer-brand-audit', organizationId] });
    } catch (err: any) {
      console.error('[EmployerBrandCard] Audit failed:', err);
      toast.error(err?.message || "Impossible de lancer l'audit. Réessayez plus tard.");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden mb-6">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          {audit?.score != null ? (
            <ScoreRing score={audit.score} />
          ) : (
            <div className="w-10 h-10 border border-border flex items-center justify-center shrink-0">
              <ScanSearch className="w-4 h-4 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold">Marque employeur</p>
            <p className="text-xs text-muted-foreground truncate">
              {audit
                ? `Audité le ${new Date(audit.created_at).toLocaleDateString('fr-FR')} · 7 sources analysées`
                : 'Site carrière, avis, LinkedIn, réseaux — score /100 et actions prioritaires.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {audit ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowDetails((v) => !v)}
                className="gap-1 text-xs"
              >
                Détails
                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showDetails && 'rotate-180')} />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={runAudit}
                disabled={isRunning || !canRerun}
                title={canRerun ? undefined : 'Disponible 7 jours après le dernier audit'}
                className="gap-1.5 text-xs"
              >
                {isRunning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isRunning ? 'Analyse…' : 'Relancer'}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={runAudit}
              disabled={isRunning}
              className="gap-1.5 text-xs"
            >
              {isRunning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isRunning ? 'Analyse en cours (~1 min)…' : "Lancer l'audit"}
            </Button>
          )}
          <button
            onClick={handleDismiss}
            aria-label="Masquer"
            className="text-muted-foreground hover:text-foreground p-1 ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {audit && showDetails && (
        <div className="border-t border-border px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            {(audit.categories || []).map((cat) => (
              <div key={cat.id} className="flex items-center gap-2 text-xs">
                <span className="w-32 shrink-0 truncate text-muted-foreground">{cat.label}</span>
                <div className="flex-1 h-1.5 bg-muted overflow-hidden">
                  <div
                    className="h-full bg-foreground"
                    style={{ width: `${Math.round((cat.score / (cat.maxScore || 5)) * 100)}%` }}
                  />
                </div>
                <span className="font-mono tabular-nums shrink-0">{cat.score}/{cat.maxScore || 5}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
              Actions prioritaires
            </p>
            <ul className="space-y-1">
              {(audit.quick_wins || []).slice(0, 4).map((win, i) => (
                <li key={i} className="text-xs flex gap-2">
                  <span className="text-muted-foreground shrink-0">→</span>
                  <span>{win}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

const ScoreRing: React.FC<{ score: number }> = ({ score }) => (
  <div
    className="w-10 h-10 rounded-full shrink-0 grid place-items-center"
    style={{ background: `conic-gradient(hsl(var(--primary)) ${score}%, hsl(var(--muted)) ${score}% 100%)` }}
  >
    <div className="w-8 h-8 rounded-full bg-card grid place-items-center text-xs font-bold tabular-nums">
      {score}
    </div>
  </div>
);

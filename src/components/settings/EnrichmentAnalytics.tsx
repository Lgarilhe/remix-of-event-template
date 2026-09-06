/**
 * EnrichmentAnalytics — Section analytique pour l'enrichissement de contact.
 *
 * Affiche :
 *   - Bandeau « X / N contacts inclus ce mois » (forfait de l'organisation)
 *   - Compteur des 30 derniers jours (total + hit rate email/phone)
 *   - Graphique enrichissements/jour (30 derniers jours)
 *   - Total crédits dépensés hors forfait
 *   - Les 20 derniers enrichissements (nom, date, email/téléphone trouvé ou
 *     non, inclus ou crédits, demandeur)
 *
 * Source de données :
 *   - candidate_enrichments (colonnes explicites, jamais raw_response)
 *   - RPC get_org_contact_usage via useEnrichmentPermission (forfait)
 *   - profiles.display_name pour le demandeur
 *
 * Intégré dans Settings > Crédits, sous la section AI credits.
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { useEnrichmentPermission, formatResetDay } from '@/hooks/useEnrichmentPermission';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Mail, Phone, TrendingUp, Loader2, Sparkles, BarChart3, Check, X, Package } from 'lucide-react';

interface EnrichmentRow {
  contact_email: string | null;
  contact_phone: string | null;
  included: boolean | null;
  credits_consumed: number;
  status: string;
  requested_at: string;
}

interface RecentEnrichmentRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  linkedin_url: string;
  contact_email: string | null;
  contact_phone: string | null;
  included: boolean;
  credits_consumed: number;
  status: string;
  requested_at: string;
  completed_at: string | null;
  requested_by_user_id: string | null;
  /** display_name du demandeur, résolu côté client depuis profiles */
  requester_name: string | null;
}

/** Nom affiché d'une ligne : prénom + nom, sinon le slug LinkedIn, sinon « Candidat ». */
function rowName(row: RecentEnrichmentRow): string {
  const name = `${row.first_name || ''} ${row.last_name || ''}`.trim();
  if (name) return name;
  const slug = row.linkedin_url.replace(/\/+$/, '').split('/').pop();
  return slug || 'Candidat';
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export const EnrichmentAnalytics: React.FC = () => {
  const { organizationId } = useOrganization();
  const { includedMonthly, includedUsed, periodEnd } = useEnrichmentPermission();
  const resetDay = formatResetDay(periodEnd);

  const { data: rows, isLoading } = useQuery({
    queryKey: ['enrichment-analytics', organizationId],
    queryFn: async (): Promise<EnrichmentRow[]> => {
      if (!organizationId) return [];
      // 30 derniers jours, status terminated only
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('candidate_enrichments')
        .select('contact_email, contact_phone, included, credits_consumed, status, requested_at')
        .eq('organization_id', organizationId)
        .eq('status', 'terminated')
        .gte('requested_at', thirtyDaysAgo)
        .order('requested_at', { ascending: false })
        .limit(1000);
      return (data as EnrichmentRow[]) || [];
    },
    enabled: !!organizationId,
    staleTime: 60 * 1000, // 1 min
  });

  // Les 20 derniers enrichissements, tous statuts, colonnes explicites.
  const { data: recent, isLoading: recentLoading } = useQuery({
    queryKey: ['enrichment-recent', organizationId],
    queryFn: async (): Promise<RecentEnrichmentRow[]> => {
      if (!organizationId) return [];
      const { data } = await supabase
        .from('candidate_enrichments')
        .select('id, first_name, last_name, linkedin_url, contact_email, contact_phone, included, credits_consumed, status, requested_at, completed_at, requested_by_user_id')
        .eq('organization_id', organizationId)
        .order('requested_at', { ascending: false })
        .limit(20);
      const list = (data || []) as Omit<RecentEnrichmentRow, 'requester_name'>[];

      const userIds = Array.from(new Set(list.map(r => r.requested_by_user_id).filter((id): id is string => !!id)));
      const names = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, display_name')
          .in('user_id', userIds);
        for (const p of profiles || []) {
          if (p.display_name) names.set(p.user_id, p.display_name);
        }
      }
      return list.map(r => ({
        ...r,
        requester_name: r.requested_by_user_id ? (names.get(r.requested_by_user_id) ?? null) : null,
      }));
    },
    enabled: !!organizationId,
    staleTime: 60 * 1000, // 1 min
  });

  // ── Calcul des stats ──
  const stats = useMemo(() => {
    if (!rows || rows.length === 0) {
      return {
        totalEnrichments: 0,
        emailsFound: 0,
        phonesFound: 0,
        emailHitRate: 0,
        phoneHitRate: 0,
        totalCreditsUsed: 0,
        dailyBuckets: [] as Array<{ date: string; count: number }>,
      };
    }

    const total = rows.length;
    const emailsFound = rows.filter(r => r.contact_email).length;
    const phonesFound = rows.filter(r => r.contact_phone).length;
    // Les demandes couvertes par le forfait n'ont rien coûté en crédits.
    const totalCredits = rows.filter(r => !r.included).reduce((sum, r) => sum + (r.credits_consumed || 0), 0);

    // Buckets par jour (30 derniers jours)
    const dailyMap = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split('T')[0];
      dailyMap.set(key, 0);
    }
    for (const row of rows) {
      const key = row.requested_at.split('T')[0];
      if (dailyMap.has(key)) dailyMap.set(key, dailyMap.get(key)! + 1);
    }

    return {
      totalEnrichments: total,
      emailsFound,
      phonesFound,
      emailHitRate: total > 0 ? Math.round((emailsFound / total) * 100) : 0,
      phoneHitRate: total > 0 ? Math.round((phonesFound / total) * 100) : 0,
      totalCreditsUsed: totalCredits,
      dailyBuckets: Array.from(dailyMap.entries()).map(([date, count]) => ({ date, count })),
    };
  }, [rows]);

  if (isLoading || recentLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Chargement des statistiques d'enrichissement de contact…
        </div>
      </Card>
    );
  }

  const maxDailyCount = Math.max(...stats.dailyBuckets.map(b => b.count), 1);
  const includedPct = includedMonthly > 0 ? Math.min(100, Math.round((includedUsed / includedMonthly) * 100)) : 0;

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Sparkles className="w-5 h-5 text-foreground" />
        <h3 className="text-base font-bold">Enrichissement de contact</h3>
        <span className="text-xs text-muted-foreground">30 derniers jours</span>
      </div>

      {/* Bandeau forfait */}
      <div className="border border-border rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Package className="w-3.5 h-3.5" />
            <span>Contacts inclus ce mois</span>
          </div>
          <div className="text-sm font-bold tabular-nums text-foreground">
            {includedUsed} / {includedMonthly}
            {resetDay && <span className="text-xs font-normal text-muted-foreground ml-1.5">(reset le {resetDay})</span>}
          </div>
        </div>
        {includedMonthly > 0 ? (
          <div className="bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full transition-all ${includedPct >= 100 ? 'bg-destructive' : 'bg-foreground'}`}
              style={{ width: `${includedPct}%` }}
            />
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Aucun contact inclus dans votre forfait actuel : les enrichissements de contact sont facturés en crédits.
          </p>
        )}
      </div>

      {stats.totalEnrichments === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun enrichissement de contact terminé dans les 30 derniers jours. Lancez votre premier
          enrichissement depuis le sourcing pour voir vos statistiques ici.
        </p>
      ) : (
        <>
          {/* KPIs principaux */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border border-border rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <BarChart3 className="w-3 h-3" />
                <span>Total</span>
              </div>
              <div className="text-2xl font-bold tabular-nums text-foreground">
                {stats.totalEnrichments}
              </div>
            </div>
            <div className="border border-border rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <Mail className="w-3 h-3 text-info" />
                <span>Emails trouvés</span>
              </div>
              <div className="text-2xl font-bold tabular-nums text-foreground">
                {stats.emailsFound}
                <span className="text-sm text-muted-foreground ml-1.5">({stats.emailHitRate}%)</span>
              </div>
            </div>
            <div className="border border-border rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <Phone className="w-3 h-3 text-warning" />
                <span>Téléphones trouvés</span>
              </div>
              <div className="text-2xl font-bold tabular-nums text-foreground">
                {stats.phonesFound}
                <span className="text-sm text-muted-foreground ml-1.5">({stats.phoneHitRate}%)</span>
              </div>
            </div>
            <div className="border border-border rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <TrendingUp className="w-3 h-3" />
                <span>Crédits hors forfait</span>
              </div>
              <div className="text-2xl font-bold tabular-nums text-foreground">
                {stats.totalCreditsUsed}
              </div>
            </div>
          </div>

          {/* Graphique simple : barres 30 jours */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Activité quotidienne
            </h4>
            <div className="flex items-end gap-0.5 h-20 border-b border-border">
              {stats.dailyBuckets.map(({ date, count }) => {
                const heightPct = (count / maxDailyCount) * 100;
                const isToday = date === new Date().toISOString().split('T')[0];
                return (
                  <div
                    key={date}
                    className={`flex-1 transition-all ${
                      isToday ? 'bg-foreground' : count > 0 ? 'bg-muted-foreground/40 hover:bg-foreground' : 'bg-transparent'
                    }`}
                    style={{ height: `${heightPct}%` }}
                    title={`${date} : ${count} enrichissement${count > 1 ? 's' : ''}`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>Il y a 30 jours</span>
              <span>Aujourd'hui</span>
            </div>
          </div>
        </>
      )}

      {/* Derniers enrichissements */}
      {recent && recent.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Derniers enrichissements
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-semibold">Candidat</th>
                  <th className="py-1.5 pr-3 font-semibold">Date</th>
                  <th className="py-1.5 pr-3 font-semibold">Email</th>
                  <th className="py-1.5 pr-3 font-semibold">Téléphone</th>
                  <th className="py-1.5 pr-3 font-semibold">Facturation</th>
                  <th className="py-1.5 font-semibold">Demandeur</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => {
                  const done = row.status === 'terminated';
                  const billing = row.status === 'pending'
                    ? 'En cours'
                    : row.status === 'error'
                      ? 'Erreur'
                      : row.included
                        ? 'Inclus'
                        : `${row.credits_consumed || 0} crédit${(row.credits_consumed || 0) > 1 ? 's' : ''}`;
                  return (
                    <tr key={row.id} className="border-b border-border/60 last:border-0">
                      <td className="py-1.5 pr-3 text-foreground font-medium max-w-[180px] truncate" title={rowName(row)}>
                        {rowName(row)}
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground tabular-nums whitespace-nowrap">
                        {formatDateTime(row.completed_at || row.requested_at)}
                      </td>
                      <td className="py-1.5 pr-3">
                        {done ? (
                          row.contact_email
                            ? <span className="inline-flex items-center gap-1 text-success"><Check className="w-3 h-3" aria-hidden="true" />Trouvé</span>
                            : <span className="inline-flex items-center gap-1 text-muted-foreground"><X className="w-3 h-3" aria-hidden="true" />Non trouvé</span>
                        ) : <span className="text-muted-foreground">…</span>}
                      </td>
                      <td className="py-1.5 pr-3">
                        {done ? (
                          row.contact_phone
                            ? <span className="inline-flex items-center gap-1 text-success"><Check className="w-3 h-3" aria-hidden="true" />Trouvé</span>
                            : <span className="inline-flex items-center gap-1 text-muted-foreground"><X className="w-3 h-3" aria-hidden="true" />Non trouvé</span>
                        ) : <span className="text-muted-foreground">…</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-foreground whitespace-nowrap">{billing}</td>
                      <td className="py-1.5 text-muted-foreground max-w-[140px] truncate" title={row.requester_name || undefined}>
                        {row.requester_name || (row.requested_by_user_id ? 'Membre' : '')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
};

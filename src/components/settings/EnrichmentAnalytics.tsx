/**
 * EnrichmentAnalytics — Section analytique pour la feature enrichment.
 *
 * Affiche :
 *   - Compteur du mois en cours (total + hit rate email/phone)
 *   - Graphique enrichments/jour (30 derniers jours)
 *   - Top 5 sources qui ont fourni les contacts (Datagma, Hunter, etc.)
 *   - Total crédits dépensés en enrichment
 *
 * Source de données :
 *   - candidate_enrichments table (rows status='terminated')
 *   - enrichment_user_quotas (compteur mensuel courant)
 *
 * Intégré dans Settings > Crédits, sous la section AI credits.
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Mail, Phone, TrendingUp, Loader2, Sparkles, BarChart3 } from 'lucide-react';

interface EnrichmentRow {
  contact_email: string | null;
  contact_phone: string | null;
  email_provider_source: string | null;
  phone_provider_source: string | null;
  credits_consumed: number;
  status: string;
  requested_at: string;
}

export const EnrichmentAnalytics: React.FC = () => {
  const { organizationId } = useOrganization();

  const { data: rows, isLoading } = useQuery({
    queryKey: ['enrichment-analytics', organizationId],
    queryFn: async (): Promise<EnrichmentRow[]> => {
      if (!organizationId) return [];
      // 30 derniers jours, status terminated only
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('candidate_enrichments')
        .select('contact_email, contact_phone, email_provider_source, phone_provider_source, credits_consumed, status, requested_at')
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
        providerCounts: new Map<string, number>(),
        dailyBuckets: [] as Array<{ date: string; count: number }>,
      };
    }

    const total = rows.length;
    const emailsFound = rows.filter(r => r.contact_email).length;
    const phonesFound = rows.filter(r => r.contact_phone).length;
    const totalCredits = rows.reduce((sum, r) => sum + (r.credits_consumed || 0), 0);

    const providerCounts = new Map<string, number>();
    for (const row of rows) {
      if (row.email_provider_source) {
        providerCounts.set(row.email_provider_source, (providerCounts.get(row.email_provider_source) || 0) + 1);
      }
      if (row.phone_provider_source && row.phone_provider_source !== row.email_provider_source) {
        providerCounts.set(row.phone_provider_source, (providerCounts.get(row.phone_provider_source) || 0) + 1);
      }
    }

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
      providerCounts,
      dailyBuckets: Array.from(dailyMap.entries()).map(([date, count]) => ({ date, count })),
    };
  }, [rows]);

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Chargement analytics enrichment…
        </div>
      </Card>
    );
  }

  if (stats.totalEnrichments === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-2">
          <Sparkles className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-base font-bold">Analytics enrichment</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Aucun enrichment de contact dans les 30 derniers jours. Lancez votre premier
          enrichment depuis le sourcing pour voir vos statistiques ici.
        </p>
      </Card>
    );
  }

  // Top 5 providers triés par nombre de contacts fournis
  const topProviders = Array.from(stats.providerCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const maxDailyCount = Math.max(...stats.dailyBuckets.map(b => b.count), 1);

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Sparkles className="w-5 h-5 text-foreground" />
        <h3 className="text-base font-bold">Analytics enrichment</h3>
        <span className="text-xs text-muted-foreground">30 derniers jours</span>
      </div>

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
            <span>Crédits dépensés</span>
          </div>
          <div className="text-2xl font-bold tabular-nums text-foreground">
            {stats.totalCreditsUsed}
          </div>
        </div>
      </div>

      {/* Graphique simple : barres horizontales 30 jours */}
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
                title={`${date} : ${count} enrichment${count > 1 ? 's' : ''}`}
              />
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>Il y a 30 jours</span>
          <span>Aujourd'hui</span>
        </div>
      </div>

      {/* Top providers */}
      {topProviders.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Top sources
          </h4>
          <div className="space-y-1.5">
            {topProviders.map(([provider, count]) => {
              const pct = Math.round((count / stats.totalEnrichments) * 100);
              return (
                <div key={provider} className="flex items-center gap-3">
                  <div className="text-xs text-foreground font-medium w-32 truncate">{provider}</div>
                  <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-foreground h-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums w-16 text-right">
                    {count} ({pct}%)
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Sources de données utilisées dans la cascade d'enrichment.
          </p>
        </div>
      )}
    </Card>
  );
};

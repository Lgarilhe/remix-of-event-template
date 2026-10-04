import React, { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, BarChart3, Lightbulb, TrendingUp, Zap, type LucideIcon } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { SourcingProject, useProjectCandidates, type ProjectCandidateRow } from '@/hooks/useSourcingProjects';
import { useMissionStageCounts } from '@/hooks/useMissionStageCounts';
import { ProjectFunnel } from '@/components/outreach/projects/ProjectFunnel';
import { toProjectStats } from '@/lib/missionStatsAdapter';
import { cumulativeText, stageLabel } from '@/lib/stageDisplay';
import { plural } from '@/lib/plural';
import { timeAgo } from '@/lib/relativeTime';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  computeResponseRate,
  countContactedEnrollments,
  missionEnrollmentJobIds,
  RESPONSE_RATE_MIN_CONTACTED,
} from '@/lib/sequenceErrorMessages';
import { toast } from 'sonner';

interface MissionInsightsProps {
  project: SourcingProject;
}

interface Insight {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; tab: string };
  priority: 'high' | 'medium' | 'low';
}

/** Pastille de l'activité récente, par étape générale. */
const STAGE_DOT: Record<string, string> = {
  retained: 'bg-warning',
  contacted: 'bg-muted-foreground',
  replied: 'bg-brand',
  interviewing: 'bg-foreground',
  hired: 'bg-success',
  rejected: 'bg-destructive/40',
};

const MetricCard = ({ label, value, sublabel, color }: {
  label: string;
  value: string;
  sublabel: string;
  color: string;
}) => (
  <div className="border border-border p-4 text-center">
    <p className="text-2xs uppercase tracking-wider font-bold text-muted-foreground mb-1">{label}</p>
    <p className={cn("text-2xl font-bold", color)}>{value}</p>
    <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>
  </div>
);

const EmptyInsightsState = () => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <h3 className="text-sm font-bold uppercase tracking-wider mb-2">Pas encore de données</h3>
    <p className="text-xs text-muted-foreground max-w-sm">
      Lancez une recherche dans l'onglet Sourcing pour commencer à voir les insights de cette mission.
    </p>
  </div>
);

export const MissionInsights = ({ project }: MissionInsightsProps) => {
  const [, setSearchParams] = useSearchParams();
  const { data: candidatesData } = useProjectCandidates(project.id);
  const candidates: ProjectCandidateRow[] = useMemo(() => candidatesData ?? [], [candidatesData]);
  const countsQuery = useMissionStageCounts([project.id]);
  const stats = useMemo(() => toProjectStats(countsQuery.data?.[project.id]), [countsQuery.data, project.id]);

  const [enrollmentStats, setEnrollmentStats] = useState({
    total: 0, active: 0, completed: 0, replied: 0, contacted: 0, avgResponseDays: null as number | null,
  });
  const [enrollmentStatsError, setEnrollmentStatsError] = useState(false);

  useEffect(() => {
    if (!project.id) return;
    let cancelled = false;
    const fetchEnrollmentStats = async () => {
      // Inscriptions de la mission par job_id : elles couvrent aussi les
      // séquences partagées entre missions (modèles), que le filtre par
      // séquence de la mission ignorait. Le statut des étapes dit qui a
      // vraiment été contacté.
      const { data: enrollments, error } = await supabase
        .from('sequence_enrollments')
        .select('status, created_at, replied_at, sequence_step_executions(status)')
        .in('job_id', missionEnrollmentJobIds(project.id, project.job_id));

      if (cancelled) return;
      if (error) {
        console.error('[MissionInsights] enrollment stats failed:', error);
        setEnrollmentStatsError(true);
        toast.error('Impossible de charger les chiffres des séquences de cette mission');
        return;
      }
      setEnrollmentStatsError(false);
      const rows = enrollments || [];

      const repliedWithTime = rows.filter(e => e.status === 'replied' && e.replied_at && e.created_at);
      let avgDays: number | null = null;
      if (repliedWithTime.length > 0) {
        const totalMs = repliedWithTime.reduce((sum, e) => {
          return sum + (new Date(e.replied_at as string).getTime() - new Date(e.created_at).getTime());
        }, 0);
        avgDays = Math.round((totalMs / repliedWithTime.length) / (1000 * 60 * 60 * 24) * 10) / 10;
      }

      const { replied, contacted } = countContactedEnrollments(rows.map(e => ({
        status: e.status,
        execution_statuses: (e.sequence_step_executions || []).map(x => x.status),
      })));

      setEnrollmentStats({
        total: rows.length,
        active: rows.filter(e => e.status === 'active').length,
        completed: rows.filter(e => e.status === 'completed').length,
        replied,
        contacted,
        avgResponseDays: avgDays,
      });
    };
    fetchEnrollmentStats();
    return () => { cancelled = true; };
  }, [project.id, project.job_id]);

  const hasData = stats && stats.total > 0;

  // Taux de réponse = répondus / contactés (helper partagé avec les statistiques
  // des séquences). Les inscrits jamais contactés ne font plus baisser le taux.
  const response = computeResponseRate({
    replied: enrollmentStats.replied,
    contacted: enrollmentStats.contacted,
  });
  const responseRate = response.rate ?? 0;
  const enoughContacted = !enrollmentStatsError && response.contacted >= RESPONSE_RATE_MIN_CONTACTED;

  const conversionRate = stats && stats.total > 0
    ? Math.round((stats.shortlisted / stats.total) * 100 * 10) / 10
    : 0;

  const contactRate = stats && stats.total > 0
    ? Math.round((stats.messaged / stats.total) * 100)
    : 0;

  const insights = useMemo(() => {
    const list: Insight[] = [];
    if (!stats) return list;

    // Plus d'alerte « aucune recherche lancée » : last_search_at n'a aucun
    // écrivain (lot 0c, conception 5.4).
    const daysSinceCreation = Math.floor(
      (Date.now() - new Date(project.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (stats.untreated > 3) {
      list.push({
        icon: Lightbulb,
        title: `${plural(stats.untreated, 'profil à trier', 'profils à trier')}`,
        description: 'Ces profils ne sont encore ni retenus, ni contactés, ni écartés. Retenez les meilleurs, puis créez une séquence pour les approcher.',
        action: { label: 'Créer une séquence', tab: 'outreach' },
        priority: stats.untreated > 10 ? 'high' : 'medium',
      });
    }

    if (stats.total > 0 && stats.total < 5 && daysSinceCreation > 2) {
      list.push({
        icon: Zap,
        title: 'Peu de profils sourcés',
        description: `Seulement ${plural(stats.total, 'profil sourcé', 'profils sourcés')}. Essayez d'élargir vos filtres dans le Brief (expérience, localisation, titres).`,
        action: { label: 'Modifier le brief', tab: 'brief' },
        priority: 'medium',
      });
    }

    if (enoughContacted && responseRate >= 25) {
      list.push({
        icon: TrendingUp,
        title: `Excellent taux de réponse (${responseRate}%)`,
        description: 'Votre approche fonctionne bien. Continuez à enrichir le pipeline avec de nouveaux profils.',
        action: { label: 'Sourcer plus', tab: 'sourcing' },
        priority: 'low',
      });
    }

    if (enoughContacted && responseRate < 8) {
      list.push({
        icon: AlertTriangle,
        title: `Taux de réponse bas (${responseRate}%)`,
        description: 'Essayez de personnaliser davantage vos messages, de varier les canaux (InMail vs invitation), ou de cibler des profils avec un meilleur score.',
        priority: 'high',
      });
    }

    if (stats.total >= 10 && stats.dismissed > stats.total * 0.5) {
      list.push({
        icon: BarChart3,
        title: `${Math.round((stats.dismissed / stats.total) * 100)}% de profils écartés`,
        description: 'Plus de la moitié des profils sont écartés. Affinez vos critères de recherche dans le Brief pour améliorer la pertinence.',
        action: { label: 'Affiner le brief', tab: 'brief' },
        priority: 'medium',
      });
    }

    return list.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    });
  }, [stats, project, responseRate, enoughContacted]);

  // Activité récente : datée sur l'entrée dans l'étape (stage_entered_at), que
  // ni une note ni un enrichissement ne font bouger, comme updated_at.
  const recentActivity = useMemo(() => {
    const dateOf = (c: ProjectCandidateRow) => c.stage_entered_at ?? c.updated_at ?? c.created_at;
    const time = (c: ProjectCandidateRow) => {
      const t = new Date(dateOf(c) ?? 0).getTime();
      return Number.isNaN(t) ? 0 : t;
    };
    return [...candidates]
      .sort((a, b) => time(b) - time(a))
      .slice(0, 15)
      .map((c) => ({
        id: c.id,
        name: c.candidate_name || 'Candidat inconnu',
        stage: c.general_stage,
        score: c.score,
        date: dateOf(c),
      }));
  }, [candidates]);

  const navigateToTab = (tab: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  };

  return (
    <div className="bg-background border border-border p-4 sm:p-6 space-y-6">
      {hasData ? (
        <>
          {/* Section 1 : entonnoir */}
          <div className="border border-border p-4 sm:p-6">
            <h3 className="text-2xs uppercase tracking-wider font-bold text-muted-foreground mb-4">
              Entonnoir de conversion
            </h3>
            <ProjectFunnel
              totalFound={stats.total}
              scored={stats.scored}
              messaged={stats.messaged}
              shortlisted={stats.shortlisted}
              dismissed={stats.dismissed}
            />
          </div>

          {/* Section 2: Métriques clés */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard
              label="Taux de réponse"
              value={enrollmentStatsError || response.rate === null ? '—' : `${response.rate}%`}
              sublabel={enrollmentStatsError
                ? 'Chiffre indisponible'
                : `${response.replied} sur ${response.contacted} contactés par séquence`}
              color={enrollmentStatsError || !enoughContacted
                ? 'text-foreground'
                : responseRate >= 20 ? 'text-success' : responseRate >= 10 ? 'text-warning' : 'text-destructive'}
            />
            <MetricCard
              label="Temps moyen de réponse"
              value={!enrollmentStatsError && enrollmentStats.avgResponseDays !== null ? `${enrollmentStats.avgResponseDays}j` : '—'}
              sublabel={enrollmentStatsError ? 'Chiffre indisponible' : 'délai moyen'}
              color="text-foreground"
            />
            <MetricCard
              label="Taux de contact"
              value={`${contactRate}%`}
              sublabel={`${cumulativeText('ever_contacted', stats.messaged)} sur ${plural(stats.total, 'sourcé')}`}
              color="text-foreground"
            />
            <MetricCard
              label="Conversion globale"
              value={`${conversionRate}%`}
              sublabel={cumulativeText('ever_retained', stats.shortlisted)}
              color={conversionRate >= 5 ? 'text-success' : 'text-foreground'}
            />
          </div>

          {/* Section 3: Recommandations */}
          {insights.length > 0 && (
            <div className="border border-border p-4 sm:p-6">
              <h3 className="text-2xs uppercase tracking-wider font-bold text-muted-foreground mb-4">
                Recommandations
              </h3>
              <div className="space-y-3">
                {insights.map((insight, i) => (
                  <div key={i} className={cn(
                    "border-l-4 p-3 flex items-start gap-3",
                    insight.priority === 'high' ? "border-destructive/40 bg-destructive/10" :
                    insight.priority === 'medium' ? "border-warning/40 bg-warning/10" :
                    "border-success/40 bg-success/10"
                  )}>
                    <insight.icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-foreground">{insight.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{insight.description}</p>
                      {insight.action && (
                        <button
                          onClick={() => navigateToTab(insight.action!.tab)}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-foreground underline underline-offset-2 hover:text-foreground/70"
                        >
                          {insight.action.label} →
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 4: Timeline */}
          {recentActivity.length > 0 && (
            <div className="border border-border p-4 sm:p-6">
              <h3 className="text-2xs uppercase tracking-wider font-bold text-muted-foreground mb-4">
                Activité récente
              </h3>
              <div className="space-y-2">
                {recentActivity.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 py-1.5 border-b border-border/5 last:border-0">
                    <span className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      (item.stage && STAGE_DOT[item.stage]) || "bg-muted-foreground/30"
                    )} />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-foreground">{item.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {stageLabel(item.stage) ?? ''}
                      </span>
                      {item.score !== null && (
                        <span className={cn(
                          "text-xs font-bold ml-2",
                          item.score >= 70 ? "text-success" :
                          item.score >= 40 ? "text-warning" :
                          "text-destructive"
                        )}>
                          {item.score}%
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {timeAgo(item.date) ?? ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : countsQuery.isError || (!countsQuery.isPending && !stats) ? (
        <div className="flex flex-col items-center justify-center py-16 text-center" role="status">
          <h3 className="text-sm font-bold uppercase tracking-wider mb-2">Chiffres indisponibles</h3>
          <p className="text-xs text-muted-foreground max-w-sm">
            Les chiffres de cette mission ne sont pas disponibles.
          </p>
          <Button variant="outline" size="xs" className="mt-3" onClick={() => { void countsQuery.refetch(); }}>
            Réessayer
          </Button>
        </div>
      ) : countsQuery.isPending ? (
        <div className="space-y-3" aria-busy="true" aria-label="Chargement des chiffres">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <EmptyInsightsState />
      )}
    </div>
  );
};

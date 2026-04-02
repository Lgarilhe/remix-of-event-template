import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SourcingProject, useProjectCandidates } from '@/hooks/useSourcingProjects';
import { useProjectStats } from '@/hooks/useProjectStats';
import { ProjectFunnel } from '@/components/outreach/projects/ProjectFunnel';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface MissionInsightsProps {
  project: SourcingProject;
}

interface Insight {
  icon: string;
  title: string;
  description: string;
  action?: { label: string; tab: string };
  priority: 'high' | 'medium' | 'low';
}

const statusLabels: Record<string, string> = {
  untreated: 'sourcé',
  messaged: 'contacté',
  shortlisted: 'shortlisté',
  dismissed: 'écarté',
};

const MetricCard = ({ label, value, sublabel, color }: {
  label: string;
  value: string;
  sublabel: string;
  color: string;
}) => (
  <div className="border border-border p-4 text-center">
    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
    <p className={cn("text-2xl font-bold", color)}>{value}</p>
    <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>
  </div>
);

const EmptyInsightsState = () => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <span className="text-3xl mb-3">💡</span>
    <h3 className="text-sm font-bold uppercase tracking-wider mb-2">Pas encore de données</h3>
    <p className="text-xs text-muted-foreground max-w-sm">
      Lancez une recherche dans l'onglet Sourcing pour commencer à voir les insights de cette mission.
    </p>
  </div>
);

export const MissionInsights = ({ project }: MissionInsightsProps) => {
  const [, setSearchParams] = useSearchParams();
  const { data: candidates = [] } = useProjectCandidates(project.id);
  const { data: stats } = useProjectStats(project.id);

  const [enrollmentStats, setEnrollmentStats] = useState({
    total: 0, active: 0, completed: 0, replied: 0, avgResponseDays: null as number | null,
  });

  useEffect(() => {
    if (!project.id) return;
    const fetchEnrollmentStats = async () => {
      const { data: sequences } = await (supabase
        .from('outreach_sequences')
        .select('id') as any)
        .eq('project_id', project.id);

      if (!sequences?.length) return;

      const seqIds = sequences.map((s: any) => s.id);
      const { data: enrollments } = await supabase
        .from('sequence_enrollments')
        .select('status, created_at, replied_at')
        .in('sequence_id', seqIds);

      if (!enrollments) return;

      const repliedWithTime = enrollments.filter(
        (e: any) => e.status === 'replied' && e.replied_at && e.created_at
      );
      let avgDays: number | null = null;
      if (repliedWithTime.length > 0) {
        const totalMs = repliedWithTime.reduce((sum: number, e: any) => {
          return sum + (new Date(e.replied_at).getTime() - new Date(e.created_at).getTime());
        }, 0);
        avgDays = Math.round((totalMs / repliedWithTime.length) / (1000 * 60 * 60 * 24) * 10) / 10;
      }

      setEnrollmentStats({
        total: enrollments.length,
        active: enrollments.filter((e: any) => e.status === 'active').length,
        completed: enrollments.filter((e: any) => e.status === 'completed').length,
        replied: enrollments.filter((e: any) => e.status === 'replied').length,
        avgResponseDays: avgDays,
      });
    };
    fetchEnrollmentStats();
  }, [project.id]);

  const hasData = stats && stats.total > 0;

  const responseRate = enrollmentStats.total > 0
    ? Math.round((enrollmentStats.replied / enrollmentStats.total) * 100)
    : 0;

  const conversionRate = stats && stats.total > 0
    ? Math.round((stats.shortlisted / stats.total) * 100 * 10) / 10
    : 0;

  const contactRate = stats && stats.total > 0
    ? Math.round((stats.messaged / stats.total) * 100)
    : 0;

  const insights = useMemo(() => {
    const list: Insight[] = [];
    if (!stats) return list;

    const daysSinceLastSearch = project.last_search_at
      ? Math.floor((Date.now() - new Date(project.last_search_at).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const daysSinceCreation = Math.floor(
      (Date.now() - new Date(project.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceLastSearch === null && daysSinceCreation > 3) {
      list.push({
        icon: '⏸️',
        title: 'Mission sans activité',
        description: `Aucune recherche lancée depuis la création il y a ${daysSinceCreation} jours. Lancez votre première recherche pour trouver des candidats.`,
        action: { label: 'Lancer le sourcing', tab: 'sourcing' },
        priority: 'high',
      });
    } else if (daysSinceLastSearch !== null && daysSinceLastSearch > 7) {
      list.push({
        icon: '⏸️',
        title: `Inactive depuis ${daysSinceLastSearch} jours`,
        description: 'Relancez une recherche pour enrichir votre pipeline avec de nouveaux profils.',
        action: { label: 'Relancer le sourcing', tab: 'sourcing' },
        priority: 'high',
      });
    }

    if (stats.untreated > 3) {
      list.push({
        icon: '💡',
        title: `${stats.untreated} profils non contactés`,
        description: `Vous avez ${stats.untreated} profils sourcés qui n'ont pas encore été contactés. Créez une séquence pour les approcher.`,
        action: { label: 'Créer une séquence', tab: 'outreach' },
        priority: stats.untreated > 10 ? 'high' : 'medium',
      });
    }

    if (stats.total > 0 && stats.total < 5 && daysSinceCreation > 2) {
      list.push({
        icon: '⚡',
        title: 'Peu de profils sourcés',
        description: `Seulement ${stats.total} profils trouvés. Essayez d'élargir vos filtres dans le Brief (expérience, localisation, titres).`,
        action: { label: 'Modifier le brief', tab: 'brief' },
        priority: 'medium',
      });
    }

    if (enrollmentStats.total >= 5 && responseRate >= 25) {
      list.push({
        icon: '🔥',
        title: `Excellent taux de réponse (${responseRate}%)`,
        description: 'Votre approche fonctionne bien. Continuez à enrichir le pipeline avec de nouveaux profils.',
        action: { label: 'Sourcer plus', tab: 'sourcing' },
        priority: 'low',
      });
    }

    if (enrollmentStats.total >= 5 && responseRate < 8) {
      list.push({
        icon: '⚠️',
        title: `Taux de réponse bas (${responseRate}%)`,
        description: 'Essayez de personnaliser davantage vos messages, de varier les canaux (InMail vs invitation), ou de cibler des profils avec un meilleur score.',
        priority: 'high',
      });
    }

    if (stats.total >= 10 && stats.dismissed > stats.total * 0.5) {
      list.push({
        icon: '📊',
        title: `${Math.round((stats.dismissed / stats.total) * 100)}% de profils écartés`,
        description: 'Plus de la moitié des profils sont écartés. Affinez vos critères de recherche dans le Brief pour améliorer la pertinence.',
        action: { label: 'Affiner le brief', tab: 'brief' },
        priority: 'medium',
      });
    }

    if (stats.messaged >= 5 && stats.shortlisted === 0) {
      list.push({
        icon: '📋',
        title: 'Aucun candidat shortlisté',
        description: `${stats.messaged} candidats contactés mais aucun shortlisté. Revoyez les réponses reçues dans le pipeline.`,
        action: { label: 'Voir le pipeline', tab: 'pipeline' },
        priority: 'medium',
      });
    }

    return list.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    });
  }, [stats, enrollmentStats, project, responseRate]);

  const recentActivity = useMemo(() => {
    return [...candidates]
      .sort((a: any, b: any) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
      .slice(0, 15)
      .map((c: any) => ({
        id: c.id,
        name: c.candidate_name || 'Candidat inconnu',
        status: c.status,
        score: c.score,
        date: c.updated_at || c.created_at,
        linkedinUrl: c.linkedin_profile_url,
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
    <div className="bg-background border border-border border-t-0 p-3 sm:p-6 space-y-6">
      {hasData ? (
        <>
          {/* Section 1: Funnel */}
          <div className="border border-border p-4 sm:p-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">
              📊 Funnel de conversion
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
              value={`${responseRate}%`}
              sublabel={`${enrollmentStats.replied}/${enrollmentStats.total} inscrits`}
              color={responseRate >= 20 ? 'text-green-600' : responseRate >= 10 ? 'text-yellow-600' : 'text-red-500'}
            />
            <MetricCard
              label="Temps moyen de réponse"
              value={enrollmentStats.avgResponseDays !== null ? `${enrollmentStats.avgResponseDays}j` : '—'}
              sublabel="délai moyen"
              color="text-foreground"
            />
            <MetricCard
              label="Taux de contact"
              value={`${contactRate}%`}
              sublabel={`${stats.messaged}/${stats.total} sourcés`}
              color="text-foreground"
            />
            <MetricCard
              label="Conversion globale"
              value={`${conversionRate}%`}
              sublabel={`${stats.shortlisted} shortlistés`}
              color={conversionRate >= 5 ? 'text-green-600' : 'text-foreground'}
            />
          </div>

          {/* Section 3: Recommandations */}
          {insights.length > 0 && (
            <div className="border border-border p-4 sm:p-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">
                🤖 Recommandations
              </h3>
              <div className="space-y-3">
                {insights.map((insight, i) => (
                  <div key={i} className={cn(
                    "border-l-4 p-3 flex items-start gap-3",
                    insight.priority === 'high' ? "border-red-400 bg-red-50/30" :
                    insight.priority === 'medium' ? "border-yellow-400 bg-yellow-50/30" :
                    "border-green-400 bg-green-50/30"
                  )}>
                    <span className="text-lg shrink-0">{insight.icon}</span>
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
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">
                🕐 Activité récente
              </h3>
              <div className="space-y-2">
                {recentActivity.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 py-1.5 border-b border-border/5 last:border-0">
                    <span className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      item.status === 'shortlisted' ? "bg-purple-400" :
                      item.status === 'messaged' ? "bg-blue-400" :
                      item.status === 'dismissed' ? "bg-red-300" :
                      "bg-gray-300"
                    )} />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-foreground">{item.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {statusLabels[item.status] || item.status}
                      </span>
                      {item.score !== null && (
                        <span className={cn(
                          "text-xs font-bold ml-2",
                          item.score >= 70 ? "text-green-600" :
                          item.score >= 40 ? "text-yellow-600" :
                          "text-red-500"
                        )}>
                          {item.score}%
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatDistanceToNow(new Date(item.date), { addSuffix: true, locale: fr })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <EmptyInsightsState />
      )}
    </div>
  );
};

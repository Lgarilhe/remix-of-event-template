import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ABTestResults } from './sequence/ABTestResults';
import {
  aggregateVariantResults,
  computeResponseRate,
  countContactedEnrollments,
  isHiddenActionType,
  isSentExecutionStatus,
  missionEnrollmentJobIds,
  type VariantResult,
} from '@/lib/sequenceErrorMessages';
import { stepTypeLabel } from './sequence/sequenceGraph';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BarChart3,
  TrendingUp,
  Users,
  Send,
  Eye,
  UserPlus,
  MessageCircle,
  Clock,
  ArrowDown,
  RefreshCw,
  Percent,
  AlertCircle,
} from 'lucide-react';
import { format, subDays, differenceInHours } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface SequenceAnalyticsProps {
  isOpen: boolean;
  onClose: () => void;
  sequenceId?: string;
  sequenceName?: string;
  /** Mission d'où les statistiques sont ouvertes : ses inscriptions sont comptées par défaut. */
  projectId?: string | null;
}

interface AnalyticsRow {
  id: string;
  sequence_id: string;
  date: string;
  invites_sent: number;
  invites_accepted: number;
  messages_sent: number;
  replies_received: number;
  profile_visits: number;
}

interface EnrollmentStats {
  total: number;
  contacted: number;
  active: number;
  completed: number;
  replied: number;
  paused: number;
  cancelled: number;
  avgResponseTimeHours: number | null;
}

interface StepStat {
  id: string;
  step_order: number;
  action_type: string;
  sent: number;
  replied: number;
}

type Scope = 'mission' | 'all';

/** Relation imbriquée : objet ou tableau selon la façon dont la clé étrangère est lue. */
const one = <T,>(rel: T | T[] | null | undefined): T | null => (Array.isArray(rel) ? rel[0] ?? null : rel ?? null);

export const SequenceAnalytics: React.FC<SequenceAnalyticsProps> = ({
  isOpen,
  onClose,
  sequenceId,
  sequenceName,
  projectId,
}) => {
  const [analytics, setAnalytics] = useState<AnalyticsRow[]>([]);
  const [enrollmentStats, setEnrollmentStats] = useState<EnrollmentStats | null>(null);
  const [sequences, setSequences] = useState<{ id: string; name: string }[]>([]);
  const [selectedSeqId, setSelectedSeqId] = useState<string>(sequenceId || 'all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [scope, setScope] = useState<Scope>('mission');
  const [period, setPeriod] = useState<'7' | '30' | '90' | 'custom'>('30');
  const [customStart, setCustomStart] = useState<string>(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [customEnd, setCustomEnd] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [abResults, setAbResults] = useState<VariantResult[]>([]);
  const [stepStats, setStepStats] = useState<StepStat[]>([]);

  const missionScoped = !!projectId && scope === 'mission';

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const startDate = period === 'custom'
        ? customStart
        : format(subDays(new Date(), parseInt(period)), 'yyyy-MM-dd');
      const endDate = period === 'custom' ? customEnd : format(new Date(), 'yyyy-MM-dd');
      const sinceTs = new Date(`${startDate}T00:00:00`).toISOString();
      const untilTs = new Date(`${endDate}T23:59:59`).toISOString();
      const filterSeqId = sequenceId || (selectedSeqId !== 'all' ? selectedSeqId : null);

      // Dans une mission : ses inscriptions seulement (job_id de la mission),
      // y compris celles faites avec un modèle partagé entre missions.
      let jobIds: string[] | null = null;
      if (projectId && scope === 'mission') {
        const { data: project, error: projectError } = await supabase
          .from('sourcing_projects')
          .select('job_id')
          .eq('id', projectId)
          .maybeSingle();
        if (projectError) throw projectError;
        jobIds = missionEnrollmentJobIds(projectId, project?.job_id);
      }

      if (!sequenceId) {
        let seqQuery = supabase
          .from('outreach_sequences')
          .select('id, name')
          .order('created_at', { ascending: false });
        if (projectId) seqQuery = seqQuery.or(`project_id.eq.${projectId},project_id.is.null`);
        const { data: seqData, error: seqError } = await seqQuery;
        if (seqError) throw seqError;
        setSequences(seqData || []);
      }

      // Compteurs journaliers par séquence : ils ne portent pas la mission. En
      // périmètre mission, on garde les séquences utilisées par ses inscriptions.
      let analyticsSeqIds: string[] | null = filterSeqId ? [filterSeqId] : null;
      if (!filterSeqId && jobIds) {
        const { data: missionSeqRows, error: missionSeqError } = await supabase
          .from('sequence_enrollments')
          .select('sequence_id')
          .in('job_id', jobIds);
        if (missionSeqError) throw missionSeqError;
        analyticsSeqIds = [...new Set((missionSeqRows || []).map(r => r.sequence_id))];
      }

      if (analyticsSeqIds && analyticsSeqIds.length === 0) {
        setAnalytics([]);
      } else {
        let query = supabase
          .from('sequence_analytics')
          .select('*')
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: true });
        if (analyticsSeqIds) query = query.in('sequence_id', analyticsSeqIds);
        const { data: analyticsData, error: analyticsError } = await query;
        if (analyticsError) throw analyticsError;
        setAnalytics(analyticsData || []);
      }

      // Inscriptions de la période (date d'inscription), avec le statut de leurs
      // étapes : « contacté » = au moins une étape envoyée.
      let enrollQuery = supabase
        .from('sequence_enrollments')
        .select('status, created_at, replied_at, profile_id, sequence_step_executions(status)')
        .gte('created_at', sinceTs)
        .lte('created_at', untilTs);
      if (filterSeqId) enrollQuery = enrollQuery.eq('sequence_id', filterSeqId);
      if (jobIds) enrollQuery = enrollQuery.in('job_id', jobIds);

      const { data: enrollData, error: enrollError } = await enrollQuery;
      if (enrollError) throw enrollError;

      const byProfile = new Map<string, NonNullable<typeof enrollData>[number]>();
      for (const e of enrollData || []) {
        const existing = byProfile.get(e.profile_id);
        if (!existing || new Date(e.created_at) > new Date(existing.created_at)) {
          byProfile.set(e.profile_id, e);
        }
      }
      const uniqueEnrollments = Array.from(byProfile.values());
      const { replied: repliedCount, contacted } = countContactedEnrollments(
        uniqueEnrollments.map(e => ({
          status: e.status,
          execution_statuses: (e.sequence_step_executions || []).map(x => x.status),
        })),
      );
      const responseTimes = uniqueEnrollments
        .filter(e => e.status === 'replied' && e.replied_at)
        .map(e => differenceInHours(new Date(e.replied_at as string), new Date(e.created_at)))
        .filter(h => h > 0 && h < 720);

      setEnrollmentStats({
        total: uniqueEnrollments.length,
        contacted,
        active: uniqueEnrollments.filter(e => e.status === 'active').length,
        completed: uniqueEnrollments.filter(e => e.status === 'completed').length,
        replied: repliedCount,
        paused: uniqueEnrollments.filter(e => e.status === 'paused').length,
        cancelled: uniqueEnrollments.filter(e => e.status === 'cancelled').length,
        avgResponseTimeHours: responseTimes.length > 0
          ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
          : null,
      });

      // Résultats A/B : exécutions portant une variante. sequence_step_executions
      // n'a pas de colonne sequence_id : la liaison passe par l'inscription, dont
      // le statut porte aussi la réponse (seules les réponses e-mail marquent
      // l'exécution 'replied').
      if (filterSeqId) {
        let abQuery = supabase
          .from('sequence_step_executions')
          .select('variant_assigned, status, sequence_enrollments!inner(sequence_id, status, job_id)')
          .eq('sequence_enrollments.sequence_id', filterSeqId)
          .not('variant_assigned', 'is', null);
        if (jobIds) abQuery = abQuery.in('sequence_enrollments.job_id', jobIds);
        const { data: execData, error: abError } = await abQuery;
        if (abError) throw abError;

        setAbResults(aggregateVariantResults((execData || []).map(row => ({
          variant_assigned: row.variant_assigned,
          status: row.status,
          enrollment_status: one(row.sequence_enrollments)?.status ?? null,
        }))));
      } else {
        setAbResults([]);
      }

      // Stats par étape (drill-down) si une séquence est sélectionnée. Les
      // étapes internes (attentes, conditions) n'envoient rien : écartées.
      if (filterSeqId) {
        const { data: stepRows, error: stepError } = await supabase
          .from('sequence_steps')
          .select('id, step_order, action_type')
          .eq('sequence_id', filterSeqId)
          .order('step_order', { ascending: true });
        if (stepError) throw stepError;

        const visibleSteps = (stepRows || []).filter(s => !isHiddenActionType(s.action_type));
        if (visibleSteps.length > 0) {
          const stepIds = visibleSteps.map(s => s.id);
          let execQuery = supabase
            .from('sequence_step_executions')
            .select('step_id, status, sequence_enrollments!inner(job_id)')
            .in('step_id', stepIds)
            .gte('created_at', sinceTs)
            .lte('created_at', untilTs);
          if (jobIds) execQuery = execQuery.in('sequence_enrollments.job_id', jobIds);
          const { data: execRows, error: execError } = await execQuery;
          if (execError) throw execError;

          const perStep = new Map<string, { sent: number; replied: number }>();
          (execRows || []).forEach(e => {
            const cur = perStep.get(e.step_id) || { sent: 0, replied: 0 };
            if (isSentExecutionStatus(e.status) || e.status === 'executed') cur.sent++;
            if (e.status === 'replied') cur.replied++;
            perStep.set(e.step_id, cur);
          });

          setStepStats(
            visibleSteps.map(s => ({
              id: s.id,
              step_order: s.step_order,
              action_type: s.action_type,
              sent: perStep.get(s.id)?.sent || 0,
              replied: perStep.get(s.id)?.replied || 0,
            })),
          );
        } else {
          setStepStats([]);
        }
      } else {
        setStepStats([]);
      }
    } catch (err) {
      console.error('Error fetching analytics:', err);
      setLoadError(true);
      toast.error('Impossible de charger les statistiques');
    } finally {
      setLoading(false);
    }
  }, [period, customStart, customEnd, sequenceId, selectedSeqId, projectId, scope]);

  useEffect(() => {
    if (isOpen) fetchData();
  }, [isOpen, fetchData]);

  const totals = useMemo(() => {
    return analytics.reduce(
      (acc, row) => ({
        invitesSent: acc.invitesSent + (row.invites_sent || 0),
        invitesAccepted: acc.invitesAccepted + (row.invites_accepted || 0),
        messagesSent: acc.messagesSent + (row.messages_sent || 0),
        repliesReceived: acc.repliesReceived + (row.replies_received || 0),
        profileVisits: acc.profileVisits + (row.profile_visits || 0),
      }),
      { invitesSent: 0, invitesAccepted: 0, messagesSent: 0, repliesReceived: 0, profileVisits: 0 }
    );
  }, [analytics]);

  const acceptRate = totals.invitesSent > 0 ? Math.round((totals.invitesAccepted / totals.invitesSent) * 100) : 0;
  // Taux de réponse = répondus / contactés (helper partagé avec la mission).
  const responseRate = computeResponseRate({
    replied: enrollmentStats?.replied ?? 0,
    contacted: enrollmentStats?.contacted ?? 0,
  });

  const chartData = useMemo(() => {
    const grouped: Record<string, { date: string; invites: number; messages: number; replies: number }> = {};
    analytics.forEach(row => {
      if (!grouped[row.date]) {
        grouped[row.date] = { date: row.date, invites: 0, messages: 0, replies: 0 };
      }
      grouped[row.date].invites += (row.invites_sent || 0);
      grouped[row.date].messages += (row.messages_sent || 0);
      grouped[row.date].replies += (row.replies_received || 0);
    });
    return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
  }, [analytics]);

  // Une seule source pour les réponses : les inscriptions de la période,
  // comme la tuile « Réponses ».
  const funnelData = useMemo(() => [
    { name: 'VISITES', value: totals.profileVisits },
    { name: 'INVITATIONS', value: totals.invitesSent },
    { name: 'ACCEPTÉES', value: totals.invitesAccepted },
    { name: 'RÉPONSES', value: enrollmentStats?.replied ?? 0 },
  ], [totals, enrollmentStats]);

  const statusData = useMemo(() => {
    if (!enrollmentStats) return [];
    return [
      { name: 'En cours', value: enrollmentStats.active },
      { name: 'Ont répondu', value: enrollmentStats.replied },
      { name: 'Terminés', value: enrollmentStats.completed },
      { name: 'En pause', value: enrollmentStats.paused },
      { name: 'Annulés', value: enrollmentStats.cancelled },
    ].filter(d => d.value > 0);
  }, [enrollmentStats]);

  const formatAvgTime = (hours: number | null) => {
    if (hours === null) return '—';
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    return `${days}j`;
  };

  const kpiItems: Array<{ icon: typeof Eye; label: string; value: number | string; sub?: string }> = [
    { icon: Eye, label: 'Visites', value: totals.profileVisits },
    { icon: UserPlus, label: 'Invitations', value: totals.invitesSent, sub: `${acceptRate}% acceptées` },
    { icon: Send, label: 'Messages', value: totals.messagesSent },
    { icon: Users, label: 'Candidats inscrits', value: enrollmentStats?.total || 0 },
    { icon: MessageCircle, label: 'Réponses', value: enrollmentStats?.replied || 0 },
    {
      icon: Percent,
      label: 'Taux de réponse',
      value: responseRate.rate === null ? '—' : `${responseRate.rate}%`,
      sub: `${responseRate.replied}/${responseRate.contacted} contactés`,
    },
    { icon: Clock, label: 'Délai de réponse', value: formatAvgTime(enrollmentStats?.avgResponseTimeHours ?? null) },
  ];

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:w-[580px] sm:max-w-[580px] bg-background p-0 rounded-lg border-l border-border">
        {/* Header */}
        <SheetHeader className="px-5 py-4 border-b border-border bg-accent">
          <SheetTitle className="flex items-center gap-2 text-foreground uppercase tracking-wider text-sm font-bold">
            <BarChart3 className="w-4 h-4" aria-hidden="true" />
            {sequenceName ? `Statistiques · ${sequenceName}` : 'Statistiques des séquences'}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-64px)]">
          <div className="p-4 space-y-4">
            {/* Filters row */}
            <div className="flex flex-wrap items-center gap-2">
              {projectId && (
                <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                  <SelectTrigger className="w-[170px] bg-background border-border rounded-lg text-xs" aria-label="Périmètre">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background border-border rounded-lg">
                    <SelectItem value="mission">Cette mission</SelectItem>
                    <SelectItem value="all">Toutes les missions</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {!sequenceId && (
                <Select value={selectedSeqId} onValueChange={setSelectedSeqId}>
                  <SelectTrigger className="flex-1 sm:w-[200px] sm:flex-none bg-background border-border rounded-lg text-xs uppercase tracking-wide" aria-label="Séquence">
                    <SelectValue placeholder="Toutes les séquences" />
                  </SelectTrigger>
                  <SelectContent className="bg-background border-border rounded-lg">
                    <SelectItem value="all">Toutes les séquences</SelectItem>
                    {sequences.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={period} onValueChange={(v) => setPeriod(v as '7' | '30' | '90' | 'custom')}>
                <SelectTrigger className="w-[140px] bg-background border-border rounded-lg text-xs" aria-label="Période">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border-border rounded-lg">
                  <SelectItem value="7">7 jours</SelectItem>
                  <SelectItem value="30">30 jours</SelectItem>
                  <SelectItem value="90">90 jours</SelectItem>
                  <SelectItem value="custom">Personnalisé</SelectItem>
                </SelectContent>
              </Select>
              {period === 'custom' && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    max={customEnd}
                    className="h-9 px-2 text-xs rounded-lg border border-border bg-background text-foreground"
                    aria-label="Date de début"
                  />
                  <span className="text-xs text-muted-foreground">→</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    min={customStart}
                    max={format(new Date(), 'yyyy-MM-dd')}
                    className="h-9 px-2 text-xs rounded-lg border border-border bg-background text-foreground"
                    aria-label="Date de fin"
                  />
                </div>
              )}
              <Button
                variant="outline"
                size="icon"
                onClick={fetchData}
                disabled={loading}
                className="border-border rounded-lg h-9 w-9"
                aria-label="Rafraîchir les statistiques"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} aria-hidden="true" />
              </Button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20" role="status" aria-label="Chargement des statistiques">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-border" />
              </div>
            ) : loadError ? (
              <div className="border border-destructive/40 bg-destructive/5 text-center py-12 px-4 space-y-3">
                <AlertCircle className="w-8 h-8 mx-auto text-destructive" aria-hidden="true" />
                <p className="text-sm text-foreground">
                  Impossible de charger les statistiques. Vérifiez votre connexion puis réessayez.
                </p>
                <Button variant="outline" size="sm" onClick={fetchData}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                  Réessayer
                </Button>
              </div>
            ) : (
              <>
                {/* KPI Strip */}
                <div className="flex flex-wrap gap-0">
                  {kpiItems.map((item, index) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.label}
                        className={cn(
                          "flex flex-col items-center px-3 py-3 border border-border bg-background min-w-[80px] flex-1",
                          index > 0 && "-ml-px",
                          "hover:bg-accent transition-colors duration-200"
                        )}
                      >
                        <Icon className="w-3.5 h-3.5 text-muted-foreground mb-1" aria-hidden="true" />
                        <span className="text-lg font-bold text-foreground tabular-nums leading-none">
                          {item.value}
                        </span>
                        {item.sub && (
                          <span className="text-xs text-muted-foreground tabular-nums mt-0.5">
                            {item.sub}
                          </span>
                        )}
                        <span className="text-3xs text-muted-foreground uppercase tracking-wider mt-1 font-medium">
                          {item.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-2xs text-muted-foreground -mt-2">
                  Candidats, réponses et taux : candidats inscrits sur la période.
                  {missionScoped && ' Visites, invitations et messages : toutes missions confondues pour les séquences de cette mission.'}
                </p>

                {/* Funnel */}
                <div className="border border-border bg-background">
                  <div className="px-3 py-2 border-b border-border bg-muted flex items-center gap-2">
                    <TrendingUp className="w-3.5 h-3.5 text-foreground" aria-hidden="true" />
                    <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                      Entonnoir de conversion
                    </span>
                  </div>
                  <div className="p-3 space-y-1">
                    {funnelData.map((item, index) => {
                      const maxVal = Math.max(...funnelData.map(f => f.value), 1);
                      const width = Math.max((item.value / maxVal) * 100, 3);
                      const prevValue = index > 0 ? funnelData[index - 1].value : null;
                      const convRate = prevValue && prevValue > 0 ? Math.round((item.value / prevValue) * 100) : null;

                      return (
                        <div key={item.name}>
                          {index > 0 && (
                            <div className="flex items-center justify-center py-0.5">
                              <ArrowDown className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                              {convRate !== null && (
                                <span className="text-xs text-muted-foreground ml-1 tabular-nums font-medium">
                                  {convRate}%
                                </span>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <div className="w-[70px] text-xs text-muted-foreground text-right uppercase tracking-wider font-medium shrink-0">
                              {item.name}
                            </div>
                            <div className="flex-1 h-6 bg-muted overflow-hidden relative">
                              <div
                                className="h-full bg-foreground transition-all duration-500 flex items-center px-2"
                                style={{ width: `${width}%` }}
                              >
                                <span className="text-xs font-bold text-background tabular-nums">
                                  {item.value}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Enrollment status breakdown */}
                {statusData.length > 0 && (
                  <div className="border border-border bg-background">
                    <div className="px-3 py-2 border-b border-border bg-muted">
                      <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                        Répartition des candidats
                      </span>
                    </div>
                    <div className="p-3">
                      <div className="flex h-3 w-full overflow-hidden mb-3">
                        {statusData.map((item) => {
                          const pct = enrollmentStats ? (item.value / enrollmentStats.total) * 100 : 0;
                          return (
                            <div
                              key={item.name}
                              className="h-full first:border-l-0 bg-foreground border-r border-background transition-all"
                              style={{
                                width: `${pct}%`,
                                opacity: item.name === 'Annulés' ? 0.3 : item.name === 'En pause' ? 0.5 : 1,
                              }}
                            />
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {statusData.map((item) => (
                          <div key={item.name} className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-foreground tabular-nums">{item.value}</span>
                            <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                              {item.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Activity chart */}
                {chartData.length > 0 && (
                  <div className="border border-border bg-background">
                    <div className="px-3 py-2 border-b border-border bg-muted">
                      <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                        Activité quotidienne
                      </span>
                    </div>
                    <div className="p-3">
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={chartData} barGap={1}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(d) => format(new Date(d), 'dd/MM', { locale: fr })}
                            tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                            axisLine={{ stroke: 'hsl(var(--foreground))' }}
                            tickLine={{ stroke: 'hsl(var(--foreground))' }}
                          />
                          <YAxis
                            tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                            axisLine={{ stroke: 'hsl(var(--foreground))' }}
                            tickLine={{ stroke: 'hsl(var(--foreground))' }}
                          />
                          <Tooltip
                            labelFormatter={(d) => format(new Date(d as string), 'dd MMMM yyyy', { locale: fr })}
                            contentStyle={{
                              borderRadius: 0,
                              border: '1px solid hsl(var(--foreground))',
                              backgroundColor: 'hsl(var(--background))',
                              fontSize: 11,
                            }}
                          />
                          <Bar dataKey="invites" name="Invitations" fill="hsl(var(--foreground))" radius={0} />
                          <Bar dataKey="messages" name="Messages" fill="hsl(var(--muted-foreground))" radius={0} />
                          <Bar dataKey="replies" name="Réponses" fill="hsl(var(--primary))" radius={0} />
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="flex items-center gap-4 mt-2 justify-center">
                        <LegendDot label="Invitations" className="bg-foreground" />
                        <LegendDot label="Messages" className="bg-muted-foreground" />
                        <LegendDot label="Réponses" className="bg-accent" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {chartData.length === 0 && !enrollmentStats?.total && (
                  <div className="border border-border bg-background text-center py-16">
                    <BarChart3 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm font-bold text-foreground uppercase tracking-wider">
                      Aucune donnée
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Les statistiques apparaîtront à mesure que les séquences s'exécutent.
                    </p>
                  </div>
                )}
              </>
                )}

                {/* A/B Test Results */}
                {!loading && !loadError && abResults.length > 0 && (
                  <ABTestResults results={abResults} />
                )}

                {/* Stats par étape (drill-down) */}
                {!loading && !loadError && stepStats.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <ArrowDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                      <h3 className="text-sm font-semibold text-foreground">Performance par étape</h3>
                    </div>
                    <div className="space-y-2">
                      {stepStats.map(s => {
                        // Seules les réponses e-mail sont rattachées à une étape.
                        const tracksReplies = s.action_type === 'email';
                        const replyRate = s.sent > 0 ? (s.replied / s.sent) * 100 : 0;
                        return (
                          <div
                            key={s.id}
                            className="flex items-center gap-3 text-xs p-2 rounded-md bg-background border border-border"
                          >
                            <span className="w-16 font-medium text-foreground">Étape {s.step_order + 1}</span>
                            <span className="w-32 text-muted-foreground">{stepTypeLabel(s.action_type)}</span>
                            <span className="flex-1 text-muted-foreground">
                              <span className="font-mono font-semibold text-foreground">{s.sent}</span> envoyé
                              {s.sent > 1 ? 's' : ''}
                              {tracksReplies && s.replied > 0 && (
                                <>
                                  {' · '}
                                  <span className="font-mono font-semibold text-success">{s.replied}</span> réponse
                                  {s.replied > 1 ? 's' : ''}
                                </>
                              )}
                            </span>
                            <span
                              className={cn(
                                'w-16 text-right font-mono font-semibold',
                                !tracksReplies ? 'text-muted-foreground' : replyRate >= 20 ? 'text-success' : replyRate >= 10 ? 'text-warning' : 'text-muted-foreground',
                              )}
                            >
                              {tracksReplies ? `${replyRate.toFixed(1).replace('.', ',')} %` : '—'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-2xs text-muted-foreground">
                      Réponses suivies pour l'e-mail uniquement : une réponse sur LinkedIn n'est pas rattachée à une
                      étape. Taux en vert à partir de 20 %, en orange à partir de 10 %.
                    </p>
                  </div>
                )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

const LegendDot: React.FC<{ label: string; className: string }> = ({ label, className }) => (
  <div className="flex items-center gap-1.5">
    <div className={cn("w-2 h-2", className)} />
    <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{label}</span>
  </div>
);

// Q5 — default export pour React.lazy() (recharts ~100KB sort dans son chunk)
export default SequenceAnalytics;

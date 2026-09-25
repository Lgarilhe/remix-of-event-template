import React, { useState, useEffect, useMemo, useId } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { enrollmentStatusMeta, sequenceActionLabel, type StatusTone } from '@/lib/sequenceCatalog';
import { ABTestResults } from './sequence/ABTestResults';
import { EnrollmentStatusBadge } from './SequenceBadges';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState, ErrorState, Section, StatGrid, StatTile } from '@/components/layout';
import {
  BarChart3,
  RefreshCw,
} from 'lucide-react';
import { format, subDays, differenceInHours } from 'date-fns';
import { fr } from 'date-fns/locale';
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

interface VariantResult {
  variant: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
}

/**
 * Séries du graphique d'activité : deux neutres et l'accent pour les réponses
 * (le résultat attendu). Jetons vérifiés avec le validateur de palette de la
 * revue : écart ΔE ≥ 15 entre voisins, en sombre comme en clair. La légende
 * reprend exactement ces couleurs (revue design D-60).
 */
const SERIES = [
  { key: 'invites', label: 'Invitations', fill: 'hsl(var(--foreground))', swatch: 'bg-foreground' },
  { key: 'messages', label: 'Messages', fill: 'hsl(var(--foreground-secondary))', swatch: 'bg-foreground-secondary' },
  { key: 'replies', label: 'Réponses', fill: 'hsl(var(--brand))', swatch: 'bg-brand' },
] as const;

/** Remplissage d'un segment de la répartition, du ton de badge de son statut. */
const TONE_FILL: Record<StatusTone, string> = {
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  muted: 'bg-muted-foreground',
};

const PERIOD_LABELS: Record<'7' | '30' | '90' | 'custom', string> = {
  '7': '7 derniers jours',
  '30': '30 derniers jours',
  '90': '90 derniers jours',
  custom: 'Période personnalisée',
};

export const SequenceAnalytics: React.FC<SequenceAnalyticsProps> = ({
  isOpen,
  onClose,
  sequenceId,
  sequenceName,
}) => {
  const [analytics, setAnalytics] = useState<AnalyticsRow[]>([]);
  const [enrollmentStats, setEnrollmentStats] = useState<EnrollmentStats | null>(null);
  const [sequences, setSequences] = useState<{ id: string; name: string }[]>([]);
  const [selectedSeqId, setSelectedSeqId] = useState<string>(sequenceId || 'all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'7' | '30' | '90' | 'custom'>('30');
  const [customStart, setCustomStart] = useState<string>(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [customEnd, setCustomEnd] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [abResults, setAbResults] = useState<VariantResult[]>([]);
  const [stepStats, setStepStats] = useState<Array<{ step_order: number; action_type: string; sent: number; replied: number }>>([]);
  const startId = useId();
  const endId = useId();

  const fetchData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const startDate = period === 'custom'
        ? customStart
        : format(subDays(new Date(), parseInt(period)), 'yyyy-MM-dd');
      const endDate = period === 'custom' ? customEnd : format(new Date(), 'yyyy-MM-dd');

      if (!sequenceId) {
        const { data: seqData, error: seqError } = await supabase
          .from('outreach_sequences')
          .select('id, name')
          .order('created_at', { ascending: false });
        if (seqError) throw seqError;
        setSequences(seqData || []);
      }

      let query = supabase
        .from('sequence_analytics')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      const filterSeqId = sequenceId || (selectedSeqId !== 'all' ? selectedSeqId : null);
      if (filterSeqId) {
        query = query.eq('sequence_id', filterSeqId);
      }

      const { data: analyticsData, error: analyticsError } = await query;
      if (analyticsError) throw analyticsError;
      setAnalytics(analyticsData || []);

      let enrollQuery = supabase
        .from('sequence_enrollments')
        .select('status, created_at, replied_at, profile_id');

      if (filterSeqId) {
        enrollQuery = enrollQuery.eq('sequence_id', filterSeqId);
      }

      const { data: enrollData, error: enrollError } = await enrollQuery;
      if (enrollError) throw enrollError;

      if (enrollData) {
        const byProfile = new Map<string, typeof enrollData[0]>();
        for (const e of enrollData) {
          const existing = byProfile.get(e.profile_id);
          if (!existing || new Date(e.created_at) > new Date(existing.created_at)) {
            byProfile.set(e.profile_id, e);
          }
        }
        const uniqueEnrollments = Array.from(byProfile.values());

        // "Contacted" = candidates that clearly received outreach (completed or replied)
        // Excludes 'active' since they may not have sent any message yet
        const contacted = uniqueEnrollments.filter(e =>
          ['completed', 'replied'].includes(e.status)
        );
        const replied = uniqueEnrollments.filter(e => e.status === 'replied' && e.replied_at);
        const responseTimes = replied
          .map(e => differenceInHours(new Date(e.replied_at!), new Date(e.created_at)))
          .filter(h => h > 0 && h < 720);

        setEnrollmentStats({
          total: uniqueEnrollments.length,
          contacted: contacted.length,
          active: uniqueEnrollments.filter(e => e.status === 'active').length,
          completed: uniqueEnrollments.filter(e => e.status === 'completed').length,
          replied: replied.length,
          paused: uniqueEnrollments.filter(e => e.status === 'paused').length,
          cancelled: uniqueEnrollments.filter(e => e.status === 'cancelled').length,
          avgResponseTimeHours: responseTimes.length > 0
            ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
            : null,
        });
      }

      // Fetch A/B test results from executions with variant_assigned
      // sequence_step_executions n'a pas de colonne sequence_id : la liaison passe
      // par enrollment_id → sequence_enrollments.sequence_id. On utilise un inner
      // join Supabase pour filtrer en une seule requête.
      const filterForAB = sequenceId || (selectedSeqId !== 'all' ? selectedSeqId : null);
      if (filterForAB) {
        const { data: execData, error: abError } = await (supabase as any)
          .from('sequence_step_executions')
          .select('variant_assigned, status, sequence_enrollments!inner(sequence_id)')
          .eq('sequence_enrollments.sequence_id', filterForAB)
          .not('variant_assigned', 'is', null) as { data: { variant_assigned: string | null; status: string }[] | null; error: unknown };
        if (abError) throw abError;

        if (execData && execData.length > 0) {
          const variantMap = new Map<string, { sent: number; opened: number; clicked: number; replied: number }>();
          for (const exec of execData) {
            const v = exec.variant_assigned;
            if (!v) continue;
            const existing = variantMap.get(v) || { sent: 0, opened: 0, clicked: 0, replied: 0 };
            if (['sent', 'executed'].includes(exec.status)) existing.sent++;
            variantMap.set(v, existing);
          }
          setAbResults(Array.from(variantMap.entries()).map(([variant, stats]) => ({ variant, ...stats })));
        } else {
          setAbResults([]);
        }
      } else {
        setAbResults([]);
      }

      // Stats par étape (drill-down) — reply_rate par step si une séquence est sélectionnée
      if (filterSeqId) {
        const { data: stepRows, error: stepRowsError } = await (supabase
          .from('sequence_steps')
          .select('id, step_order, action_type')
          .eq('sequence_id', filterSeqId)
          .order('step_order', { ascending: true }) as any);
        if (stepRowsError) throw stepRowsError;

        if (stepRows && stepRows.length > 0) {
          const stepIds = (stepRows as any[]).map((s: any) => s.id);
          // Récupère toutes les executions de ces steps sur la période
          const sinceTs = new Date(startDate).toISOString();
          const untilTs = new Date(endDate + 'T23:59:59').toISOString();
          const { data: execRows, error: execRowsError } = await (supabase
            .from('sequence_step_executions')
            .select('step_id, status')
            .in('step_id', stepIds)
            .gte('created_at', sinceTs)
            .lte('created_at', untilTs) as any);
          if (execRowsError) throw execRowsError;

          const perStep = new Map<string, { sent: number; replied: number }>();
          (execRows as any[] || []).forEach((e: any) => {
            const cur = perStep.get(e.step_id) || { sent: 0, replied: 0 };
            if (['sent', 'executed', 'opened', 'clicked', 'replied'].includes(e.status)) cur.sent++;
            if (e.status === 'replied') cur.replied++;
            perStep.set(e.step_id, cur);
          });

          setStepStats(
            (stepRows as any[]).map((s: any) => ({
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
      // Une panne ne se lit pas comme des statistiques vides : état d'erreur avec « Réessayer ».
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedSeqId, period, customStart, customEnd]);

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
  // Reply rate = replied / contacted (same logic as dashboard)
  const replyRate = enrollmentStats && enrollmentStats.contacted > 0
    ? Math.round((enrollmentStats.replied / enrollmentStats.contacted) * 100)
    : 0;

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

  const funnelData = useMemo(() => [
    { name: 'Visites', value: totals.profileVisits },
    { name: 'Invitations', value: totals.invitesSent },
    { name: 'Acceptées', value: totals.invitesAccepted },
    { name: 'Réponses', value: totals.repliesReceived },
  ], [totals]);

  // Répartition des inscriptions, avec les libellés et tons du catalogue.
  const statusData = useMemo(() => {
    if (!enrollmentStats) return [];
    return [
      { key: 'active', value: enrollmentStats.active },
      { key: 'replied', value: enrollmentStats.replied },
      { key: 'completed', value: enrollmentStats.completed },
      { key: 'paused', value: enrollmentStats.paused },
      { key: 'cancelled', value: enrollmentStats.cancelled },
    ].filter(d => d.value > 0);
  }, [enrollmentStats]);

  const formatAvgTime = (hours: number | null) => {
    if (hours === null) return '–';
    if (hours < 24) return `${hours} h`;
    const days = Math.round(hours / 24);
    return `${days} j`;
  };

  const hasData = chartData.length > 0 || !!enrollmentStats?.total;
  const title = sequenceName ? `Statistiques : ${sequenceName}` : 'Statistiques de toutes les séquences';

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="space-y-1 border-b border-border px-6 py-5 pr-14 text-left">
          <SheetTitle className="break-words">{title}</SheetTitle>
          <SheetDescription>
            Envois, réponses et inscriptions {sequenceId ? 'de cette séquence' : 'de vos séquences'}, sur la période choisie.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* Filtres */}
          <div className="flex flex-wrap items-end gap-2">
            {!sequenceId && (
              <Select value={selectedSeqId} onValueChange={setSelectedSeqId}>
                <SelectTrigger className="w-full sm:w-56" aria-label="Séquence">
                  <SelectValue placeholder="Toutes les séquences" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les séquences</SelectItem>
                  {sequences.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={period} onValueChange={(v) => setPeriod(v as '7' | '30' | '90' | 'custom')}>
              <SelectTrigger className="min-w-0 flex-1 sm:w-48 sm:flex-none" aria-label="Période">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">{PERIOD_LABELS['7']}</SelectItem>
                <SelectItem value="30">{PERIOD_LABELS['30']}</SelectItem>
                <SelectItem value="90">{PERIOD_LABELS['90']}</SelectItem>
                <SelectItem value="custom">{PERIOD_LABELS.custom}</SelectItem>
              </SelectContent>
            </Select>
            <UiTooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={fetchData}
                  disabled={loading}
                  className="shrink-0 max-md:h-11 max-md:w-11"
                  aria-label="Actualiser les statistiques"
                >
                  <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Actualiser</TooltipContent>
            </UiTooltip>
            {period === 'custom' && (
              <div className="flex w-full flex-wrap gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={startId} className="text-xs text-muted-foreground">Du</Label>
                  <Input
                    id={startId}
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    max={customEnd}
                    className="w-40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={endId} className="text-xs text-muted-foreground">Au</Label>
                  <Input
                    id={endId}
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    min={customStart}
                    max={format(new Date(), 'yyyy-MM-dd')}
                    className="w-40"
                  />
                </div>
              </div>
            )}
          </div>

          {loading ? (
            <AnalyticsSkeleton />
          ) : loadError ? (
            <ErrorState
              title="Impossible de charger les statistiques"
              description="Vérifiez votre connexion, puis réessayez."
              detail={loadError}
              onRetry={fetchData}
            />
          ) : !hasData ? (
            <EmptyState
              icon={BarChart3}
              title="Pas encore de statistiques"
              description={sequenceId
                ? 'Les chiffres apparaissent dès les premiers envois de cette séquence.'
                : 'Les chiffres apparaissent dès les premiers envois de vos séquences.'}
            />
          ) : (
            <>
              {/* Indicateurs */}
              <StatGrid cols={{ base: 2, sm: 3 }}>
                <StatTile label="Visites de profil" value={totals.profileVisits} />
                <StatTile
                  label="Invitations"
                  value={totals.invitesSent}
                  trailing={<span className="text-xs text-muted-foreground">{acceptRate} % acceptées</span>}
                />
                <StatTile label="Messages" value={totals.messagesSent} />
                <StatTile
                  label="Réponses"
                  value={enrollmentStats?.replied || 0}
                  trailing={<span className="text-xs text-muted-foreground">{replyRate} % des contactés</span>}
                />
                <StatTile label="Candidats inscrits" value={enrollmentStats?.total || 0} />
                <StatTile
                  label="Délai de réponse"
                  value={formatAvgTime(enrollmentStats?.avgResponseTimeHours ?? null)}
                  trailing={<span className="text-xs text-muted-foreground">en moyenne</span>}
                />
              </StatGrid>

              {/* Entonnoir */}
              <Section title="Entonnoir de conversion" padded>
                <ol className="space-y-3">
                  {funnelData.map((item, index) => {
                    const maxVal = Math.max(...funnelData.map(f => f.value), 1);
                    const width = item.value > 0 ? Math.max((item.value / maxVal) * 100, 2) : 0;
                    const prevValue = index > 0 ? funnelData[index - 1].value : null;
                    const convRate = prevValue && prevValue > 0 ? Math.round((item.value / prevValue) * 100) : null;

                    return (
                      <li key={item.name} className="grid grid-cols-[6rem_1fr_5rem] items-center gap-3">
                        <span className="truncate text-xs text-muted-foreground">{item.name}</span>
                        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                          <div className="h-full rounded-full bg-foreground-secondary" style={{ width: `${width}%` }} />
                        </div>
                        <span className="text-right text-sm font-medium tabular-nums text-foreground">
                          {item.value}
                          {convRate !== null && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">({convRate} %)</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <p className="mt-3 text-xs text-muted-foreground">
                  Entre parenthèses : la part de l'étape précédente.
                </p>
              </Section>

              {/* Répartition des inscriptions */}
              {statusData.length > 0 && enrollmentStats && (
                <Section title="Répartition des inscriptions" padded>
                  <div className="mb-3 flex h-2 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                    {statusData.map((item) => (
                      <div
                        key={item.key}
                        className={cn('h-full', TONE_FILL[enrollmentStatusMeta(item.key).tone])}
                        style={{ width: `${(item.value / enrollmentStats.total) * 100}%` }}
                      />
                    ))}
                  </div>
                  <ul className="flex flex-wrap gap-x-4 gap-y-2">
                    {statusData.map((item) => (
                      <li key={item.key} className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold tabular-nums text-foreground">{item.value}</span>
                        <EnrollmentStatusBadge status={item.key} />
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Activité quotidienne */}
              {chartData.length > 0 && (
                <Section title="Activité quotidienne" padded>
                  <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Légende">
                    {SERIES.map((s) => (
                      <li key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={cn('h-2.5 w-2.5 rounded-sm', s.swatch)} aria-hidden="true" />
                        {s.label}
                      </li>
                    ))}
                  </ul>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} barGap={2} barCategoryGap="20%">
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d) => format(new Date(d), 'dd/MM', { locale: fr })}
                        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                        axisLine={{ stroke: 'hsl(var(--border))' }}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        width={28}
                        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: 'hsl(var(--accent))' }}
                        labelFormatter={(d) => format(new Date(d as string), 'd MMMM yyyy', { locale: fr })}
                        contentStyle={{
                          borderRadius: 8,
                          border: '1px solid hsl(var(--border))',
                          backgroundColor: 'hsl(var(--popover))',
                          fontSize: 12,
                        }}
                        labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                        itemStyle={{ color: 'hsl(var(--foreground-secondary))' }}
                      />
                      {SERIES.map((s) => (
                        <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.fill} radius={[4, 4, 0, 0]} maxBarSize={24} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </Section>
              )}

              {/* Résultats A/B */}
              {abResults.length > 0 && (
                <ABTestResults results={abResults} />
              )}

              {/* Performance par étape */}
              {stepStats.length > 0 && (
                <Section title="Performance par étape" padded>
                  <ul className="space-y-2">
                    {stepStats.map(s => {
                      const stepReplyRate = s.sent > 0 ? (s.replied / s.sent) * 100 : 0;
                      return (
                        <li
                          key={s.step_order}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-background p-2.5 text-xs"
                        >
                          <span className="w-14 shrink-0 font-medium text-foreground">Étape {s.step_order + 1}</span>
                          <span className="min-w-0 flex-1 truncate text-foreground-secondary">{sequenceActionLabel(s.action_type)}</span>
                          <span className="text-muted-foreground">
                            <span className="font-semibold tabular-nums text-foreground">{s.sent}</span> {s.sent > 1 ? 'envoyées' : 'envoyée'}
                            {s.replied > 0 && (
                              <>
                                {' · '}
                                <span className="font-semibold tabular-nums text-foreground">{s.replied}</span> {s.replied > 1 ? 'réponses' : 'réponse'}
                              </>
                            )}
                          </span>
                          <span
                            className={cn(
                              'w-14 shrink-0 text-right font-semibold tabular-nums',
                              stepReplyRate >= 20 ? 'text-success' : stepReplyRate >= 10 ? 'text-warning' : 'text-muted-foreground',
                            )}
                          >
                            {stepReplyRate.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Taux de réponse de chaque étape : en vert à partir de 20 %, en orange de 10 à 20 %, en gris en dessous.
                  </p>
                </Section>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

/** Squelette des statistiques : six tuiles, puis deux blocs. */
const AnalyticsSkeleton: React.FC = () => (
  <div className="space-y-4" aria-hidden="true">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-20 rounded-xl" />
      ))}
    </div>
    <Skeleton className="h-44 w-full rounded-xl" />
    <Skeleton className="h-56 w-full rounded-xl" />
  </div>
);

// Q5 — default export pour React.lazy() (recharts ~100KB sort dans son chunk)
export default SequenceAnalytics;

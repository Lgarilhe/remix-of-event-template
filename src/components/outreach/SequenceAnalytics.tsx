import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ABTestResults } from './sequence/ABTestResults';
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
  const [period, setPeriod] = useState<'7' | '30' | '90'>('30');

  const fetchData = async () => {
    setLoading(true);
    try {
      const startDate = format(subDays(new Date(), parseInt(period)), 'yyyy-MM-dd');

      if (!sequenceId) {
        const { data: seqData } = await supabase
          .from('outreach_sequences')
          .select('id, name')
          .order('created_at', { ascending: false });
        setSequences(seqData || []);
      }

      let query = supabase
        .from('sequence_analytics')
        .select('*')
        .gte('date', startDate)
        .order('date', { ascending: true });

      const filterSeqId = sequenceId || (selectedSeqId !== 'all' ? selectedSeqId : null);
      if (filterSeqId) {
        query = query.eq('sequence_id', filterSeqId);
      }

      const { data: analyticsData } = await query;
      setAnalytics(analyticsData || []);

      let enrollQuery = supabase
        .from('sequence_enrollments')
        .select('status, created_at, replied_at, profile_id');

      if (filterSeqId) {
        enrollQuery = enrollQuery.eq('sequence_id', filterSeqId);
      }

      const { data: enrollData } = await enrollQuery;

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
    } catch (err) {
      console.error('Error fetching analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) fetchData();
  }, [isOpen, selectedSeqId, period]);

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
    { name: 'VISITES', value: totals.profileVisits },
    { name: 'INVITATIONS', value: totals.invitesSent },
    { name: 'ACCEPTÉES', value: totals.invitesAccepted },
    { name: 'RÉPONSES', value: totals.repliesReceived },
  ], [totals]);

  const statusData = useMemo(() => {
    if (!enrollmentStats) return [];
    return [
      { name: 'Actifs', value: enrollmentStats.active },
      { name: 'Répondu', value: enrollmentStats.replied },
      { name: 'Terminés', value: enrollmentStats.completed },
      { name: 'Pause', value: enrollmentStats.paused },
      { name: 'Annulés', value: enrollmentStats.cancelled },
    ].filter(d => d.value > 0);
  }, [enrollmentStats]);

  const formatAvgTime = (hours: number | null) => {
    if (hours === null) return '—';
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    return `${days}j`;
  };

  const kpiItems = [
    { icon: Eye, label: 'Visites', value: totals.profileVisits },
    { icon: UserPlus, label: 'Invitations', value: totals.invitesSent, sub: `${acceptRate}%` },
    { icon: Send, label: 'Messages', value: totals.messagesSent, sub: `${replyRate}%` },
    { icon: MessageCircle, label: 'Réponses', value: enrollmentStats?.replied || 0 },
    { icon: Users, label: 'Prospects', value: enrollmentStats?.total || 0 },
    { icon: Clock, label: 'Moy. rép.', value: formatAvgTime(enrollmentStats?.avgResponseTimeHours ?? null) },
  ];

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:w-[580px] sm:max-w-[580px] bg-background p-0 rounded-none border-l border-foreground">
        {/* Header */}
        <SheetHeader className="px-5 py-4 border-b border-foreground bg-brutal-accent">
          <SheetTitle className="flex items-center gap-2 text-foreground uppercase tracking-wider text-sm font-bold">
            <BarChart3 className="w-4 h-4" />
            {sequenceName ? `Analytics — ${sequenceName}` : 'Analytics globales'}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-64px)]">
          <div className="p-4 space-y-4">
            {/* Filters row */}
            <div className="flex flex-wrap items-center gap-2">
              {!sequenceId && (
                <Select value={selectedSeqId} onValueChange={setSelectedSeqId}>
                  <SelectTrigger className="flex-1 sm:w-[200px] sm:flex-none bg-background border-foreground rounded-none text-xs uppercase tracking-wide">
                    <SelectValue placeholder="Toutes les séquences" />
                  </SelectTrigger>
                  <SelectContent className="bg-background border-foreground rounded-none">
                    <SelectItem value="all">Toutes les séquences</SelectItem>
                    {sequences.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={period} onValueChange={(v) => setPeriod(v as '7' | '30' | '90')}>
                <SelectTrigger className="w-[120px] bg-background border-foreground rounded-none text-xs uppercase tracking-wide">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border-foreground rounded-none">
                  <SelectItem value="7">7 jours</SelectItem>
                  <SelectItem value="30">30 jours</SelectItem>
                  <SelectItem value="90">90 jours</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={fetchData}
                disabled={loading}
                className="border-foreground rounded-none h-9 w-9"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              </Button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
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
                          "flex flex-col items-center px-3 py-3 border border-foreground bg-background min-w-[80px] flex-1",
                          index > 0 && "-ml-px",
                          "hover:bg-brutal-accent transition-colors duration-200"
                        )}
                      >
                        <Icon className="w-3.5 h-3.5 text-muted-foreground mb-1" />
                        <span className="text-lg font-bold text-foreground tabular-nums leading-none">
                          {item.value}
                        </span>
                        {item.sub && (
                          <span className="text-xs text-muted-foreground tabular-nums mt-0.5">
                            {item.sub} taux
                          </span>
                        )}
                        <span className="text-[8px] text-muted-foreground uppercase tracking-widest mt-1 font-medium">
                          {item.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Funnel */}
                <div className="border border-foreground bg-background">
                  <div className="px-3 py-2 border-b border-foreground bg-muted flex items-center gap-2">
                    <TrendingUp className="w-3.5 h-3.5 text-foreground" />
                    <span className="text-xs font-bold text-foreground uppercase tracking-widest">
                      Funnel de conversion
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
                              <ArrowDown className="w-3 h-3 text-muted-foreground" />
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
                  <div className="border border-foreground bg-background">
                    <div className="px-3 py-2 border-b border-foreground bg-muted">
                      <span className="text-xs font-bold text-foreground uppercase tracking-widest">
                        Répartition prospects
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
                                opacity: item.name === 'Annulés' ? 0.3 : item.name === 'Pause' ? 0.5 : 1,
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
                  <div className="border border-foreground bg-background">
                    <div className="px-3 py-2 border-b border-foreground bg-muted">
                      <span className="text-xs font-bold text-foreground uppercase tracking-widest">
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
                          <Bar dataKey="replies" name="Réponses" fill="hsl(var(--brutal-accent))" radius={0} />
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="flex items-center gap-4 mt-2 justify-center">
                        <LegendDot label="Invitations" className="bg-foreground" />
                        <LegendDot label="Messages" className="bg-muted-foreground" />
                        <LegendDot label="Réponses" className="bg-brutal-accent" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {chartData.length === 0 && !enrollmentStats?.total && (
                  <div className="border border-foreground bg-background text-center py-16">
                    <BarChart3 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm font-bold text-foreground uppercase tracking-wider">
                      Aucune donnée
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Les analytics seront alimentées à mesure que les séquences s'exécutent.
                    </p>
                  </div>
                )}
              </>
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

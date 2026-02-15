import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
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
  Mail,
  Eye,
  UserPlus,
  MessageCircle,
  Clock,
  ArrowRight,
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
  PieChart,
  Pie,
  Cell,
} from 'recharts';

interface SequenceAnalyticsProps {
  isOpen: boolean;
  onClose: () => void;
  sequenceId?: string; // If provided, show stats for one sequence only
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
  active: number;
  completed: number;
  replied: number;
  paused: number;
  cancelled: number;
  avgResponseTimeHours: number | null;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#6b7280'];

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

      // Fetch sequences list if global view
      if (!sequenceId) {
        const { data: seqData } = await supabase
          .from('outreach_sequences')
          .select('id, name')
          .order('created_at', { ascending: false });
        setSequences(seqData || []);
      }

      // Fetch analytics
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

      // Fetch enrollment stats
      let enrollQuery = supabase
        .from('sequence_enrollments')
        .select('status, created_at, replied_at');

      if (filterSeqId) {
        enrollQuery = enrollQuery.eq('sequence_id', filterSeqId);
      }

      const { data: enrollData } = await enrollQuery;

      if (enrollData) {
        const replied = enrollData.filter(e => e.status === 'replied' && e.replied_at);
        const responseTimes = replied
          .map(e => differenceInHours(new Date(e.replied_at!), new Date(e.created_at)))
          .filter(h => h > 0 && h < 720); // Filter outliers (>30 days)

        setEnrollmentStats({
          total: enrollData.length,
          active: enrollData.filter(e => e.status === 'active').length,
          completed: enrollData.filter(e => e.status === 'completed').length,
          replied: replied.length,
          paused: enrollData.filter(e => e.status === 'paused').length,
          cancelled: enrollData.filter(e => e.status === 'cancelled').length,
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

  // Aggregated totals
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
  const replyRate = totals.messagesSent > 0 ? Math.round((totals.repliesReceived / totals.messagesSent) * 100) : 0;

  // Chart data
  const chartData = useMemo(() => {
    const grouped: Record<string, { date: string; invites: number; messages: number; replies: number; visits: number }> = {};
    analytics.forEach(row => {
      if (!grouped[row.date]) {
        grouped[row.date] = { date: row.date, invites: 0, messages: 0, replies: 0, visits: 0 };
      }
      grouped[row.date].invites += (row.invites_sent || 0);
      grouped[row.date].messages += (row.messages_sent || 0);
      grouped[row.date].replies += (row.replies_received || 0);
      grouped[row.date].visits += (row.profile_visits || 0);
    });
    return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
  }, [analytics]);

  // Funnel data
  const funnelData = useMemo(() => [
    { name: 'Visites profil', value: totals.profileVisits, color: '#6b7280' },
    { name: 'Invitations envoyées', value: totals.invitesSent, color: '#3b82f6' },
    { name: 'Invitations acceptées', value: totals.invitesAccepted, color: '#10b981' },
    { name: 'Messages envoyés', value: totals.messagesSent, color: '#8b5cf6' },
    { name: 'Réponses reçues', value: totals.repliesReceived, color: '#f59e0b' },
  ], [totals]);

  // Pie data for enrollment distribution
  const pieData = useMemo(() => {
    if (!enrollmentStats) return [];
    return [
      { name: 'Actifs', value: enrollmentStats.active, color: '#3b82f6' },
      { name: 'Répondu', value: enrollmentStats.replied, color: '#8b5cf6' },
      { name: 'Terminés', value: enrollmentStats.completed, color: '#10b981' },
      { name: 'En pause', value: enrollmentStats.paused, color: '#f59e0b' },
      { name: 'Annulés', value: enrollmentStats.cancelled, color: '#6b7280' },
    ].filter(d => d.value > 0);
  }, [enrollmentStats]);

  const formatAvgTime = (hours: number | null) => {
    if (hours === null) return '—';
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    return `${days}j`;
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:w-[600px] sm:max-w-[600px] bg-white p-0">
        <SheetHeader className="p-6 pb-4 border-b border-gray-100">
          <SheetTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            {sequenceName ? `Analytics — ${sequenceName}` : 'Analytics globales'}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-80px)]">
          <div className="p-6 space-y-6">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {!sequenceId && (
                <Select value={selectedSeqId} onValueChange={setSelectedSeqId}>
                  <SelectTrigger className="w-full sm:w-[220px] bg-white">
                    <SelectValue placeholder="Toutes les séquences" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="all">Toutes les séquences</SelectItem>
                    {sequences.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-2">
                <Select value={period} onValueChange={(v) => setPeriod(v as '7' | '30' | '90')}>
                  <SelectTrigger className="w-[130px] sm:w-[140px] bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="7">7 derniers jours</SelectItem>
                    <SelectItem value="30">30 derniers jours</SelectItem>
                    <SelectItem value="90">90 derniers jours</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" onClick={fetchData} disabled={loading}>
                  <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              </div>
            ) : (
              <>
                {/* KPI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                  <KPICard icon={<Eye className="w-4 h-4" />} label="Visites profil" value={totals.profileVisits} color="text-gray-600" bg="bg-gray-50" />
                  <KPICard icon={<UserPlus className="w-4 h-4" />} label="Invitations" value={totals.invitesSent} subValue={`${acceptRate}% acceptées`} color="text-blue-600" bg="bg-blue-50" />
                  <KPICard icon={<Send className="w-4 h-4" />} label="Messages" value={totals.messagesSent} subValue={`${replyRate}% répondus`} color="text-purple-600" bg="bg-purple-50" />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                  <KPICard icon={<MessageCircle className="w-4 h-4" />} label="Réponses" value={totals.repliesReceived} color="text-amber-600" bg="bg-amber-50" />
                  <KPICard icon={<Users className="w-4 h-4" />} label="Prospects" value={enrollmentStats?.total || 0} color="text-green-600" bg="bg-green-50" />
                  <KPICard icon={<Clock className="w-4 h-4" />} label="Temps moyen rép." value={formatAvgTime(enrollmentStats?.avgResponseTimeHours ?? null)} color="text-indigo-600" bg="bg-indigo-50" />
                </div>

                {/* Funnel */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Funnel de conversion
                  </h3>
                  <div className="space-y-2">
                    {funnelData.map((item, index) => {
                      const maxVal = Math.max(...funnelData.map(f => f.value), 1);
                      const width = Math.max((item.value / maxVal) * 100, 4);
                      const prevValue = index > 0 ? funnelData[index - 1].value : null;
                      const convRate = prevValue && prevValue > 0 ? Math.round((item.value / prevValue) * 100) : null;

                      return (
                        <div key={item.name} className="flex items-center gap-3">
                          <div className="w-[140px] text-xs text-gray-600 text-right truncate">{item.name}</div>
                          <div className="flex-1 h-7 bg-white rounded-md overflow-hidden relative">
                            <div
                              className="h-full rounded-md transition-all duration-500 flex items-center px-2"
                              style={{ width: `${width}%`, backgroundColor: item.color }}
                            >
                              <span className="text-xs font-bold text-white">{item.value}</span>
                            </div>
                          </div>
                          {convRate !== null && (
                            <div className="w-[50px] text-xs text-gray-500 flex items-center gap-0.5">
                              <ArrowRight className="w-3 h-3" />
                              {convRate}%
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Activity chart */}
                {chartData.length > 0 && (
                  <div className="bg-gray-50 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Activité quotidienne</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(d) => format(new Date(d), 'dd/MM', { locale: fr })}
                          tick={{ fontSize: 11 }}
                        />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          labelFormatter={(d) => format(new Date(d as string), 'dd MMMM yyyy', { locale: fr })}
                          contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
                        />
                        <Bar dataKey="invites" name="Invitations" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="messages" name="Messages" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="replies" name="Réponses" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Enrollment distribution pie chart */}
                {pieData.length > 0 && (
                  <div className="bg-gray-50 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Répartition des prospects</h3>
                    <div className="flex items-center gap-6">
                      <ResponsiveContainer width={140} height={140}>
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={35}
                            outerRadius={65}
                            dataKey="value"
                            strokeWidth={2}
                            stroke="#fff"
                          >
                            {pieData.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex-1 space-y-1.5">
                        {pieData.map((item) => (
                          <div key={item.name} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                              <span className="text-gray-600">{item.name}</span>
                            </div>
                            <span className="font-semibold text-gray-900">{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {chartData.length === 0 && !enrollmentStats?.total && (
                  <div className="text-center py-12 text-gray-500">
                    <BarChart3 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">Aucune donnée analytique</p>
                    <p className="text-sm mt-1">Les analytics seront alimentées à mesure que les séquences s'exécutent.</p>
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

// KPI Card component
const KPICard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number | string;
  subValue?: string;
  color: string;
  bg: string;
}> = ({ icon, label, value, subValue, color, bg }) => (
  <div className={cn("rounded-xl p-3", bg)}>
    <div className={cn("flex items-center gap-1.5 text-xs mb-1", color)}>
      {icon}
      {label}
    </div>
    <div className={cn("text-xl font-bold", color)}>{value}</div>
    {subValue && <div className="text-xs text-gray-500 mt-0.5">{subValue}</div>}
  </div>
);

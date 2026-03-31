import React, { useMemo, useState } from 'react';
import { ATSCandidate } from '@/hooks/useATSData';
import { useTodayScheduledMessages, ScheduledMessage } from '@/hooks/useTodayScheduledMessages';
import { useOutreachAcceptanceStats } from '@/hooks/useOutreachAcceptanceStats';
import { useDailyInviteStats } from '@/hooks/useDailyInviteStats';
import { useResponseRateStats } from '@/hooks/useResponseRateStats';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, CartesianGrid,
} from 'recharts';
import { format, subDays, parseISO, isAfter, differenceInDays, isToday } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  TrendingUp, Users, MessageCircle, CheckCircle, Target, Clock,
  ArrowRight, Briefcase, UserCheck, AlertCircle, Star, Send,
  Calendar, ExternalLink, Mail, Zap, UserPlus, UserX,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ATSDashboardProps {
  candidates: ATSCandidate[];
  stages: { key: string; label: string; color: string }[];
  onCandidateClick?: (candidate: ATSCandidate) => void;
  onJobClick?: (jobId: string) => void;
}

const STAGE_COLORS: Record<string, string> = {
  'Nouveau': 'hsl(210, 10%, 70%)',
  'Contacté': 'hsl(217, 91%, 60%)',
  'Répondu': 'hsl(187, 85%, 53%)',
  'Pressenti': 'hsl(210, 10%, 55%)',
  'Pré-qualif': 'hsl(168, 76%, 42%)',
  'CV envoyé': 'hsl(234, 89%, 63%)',
  'ITW en cours': 'hsl(45, 93%, 55%)',
  'Offre': 'hsl(271, 81%, 56%)',
  'Gagné': 'hsl(142, 71%, 45%)',
  'Perdu': 'hsl(0, 65%, 55%)',
};

const SOURCE_COLORS = [
  'hsl(var(--foreground))',
  'hsl(var(--brutal-accent))',
  'hsl(217, 91%, 60%)',
];

const SOURCE_LABELS: Record<string, string> = {
  local: 'Pipeline',
  sequence: 'Séquences',
  inmail: 'InMail',
};

// ─── Compact tooltip ───
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-foreground bg-background px-3 py-2 text-xs font-mono">
      <p className="font-medium mb-0.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-muted-foreground">
          {p.name || p.dataKey}: <span className="font-bold text-foreground">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

// ─── Section wrapper ───
function Section({ title, subtitle, icon: Icon, children, action, className }: {
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border border-foreground bg-background", className)}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-foreground">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5" />
          <h3 className="text-xs uppercase tracking-wider font-bold">{title}</h3>
          {subtitle && <span className="text-xs text-muted-foreground tracking-wide hidden sm:inline">— {subtitle}</span>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export const ATSDashboard = React.memo(function ATSDashboard({ candidates, stages, onCandidateClick, onJobClick }: ATSDashboardProps) {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const { data: scheduledMessages = [], isLoading: loadingMessages } = useTodayScheduledMessages();
  const { data: acceptanceStats, isLoading: loadingAcceptance } = useOutreachAcceptanceStats();
  const { data: dailyInvites = [], isLoading: loadingInvites } = useDailyInviteStats(period);
  const { data: responseRates, isLoading: loadingResponseRates } = useResponseRateStats();
  const [expandedMessageId, setExpandedMessageId] = React.useState<string | null>(null);
  const [responseView, setResponseView] = React.useState<'all' | 'sequences' | 'inmails'>('all');

  // ═══ KPIs ═══
  const kpis = useMemo(() => {
    const total = candidates.length;
    
    const contacted = candidates.filter(c => {
      if (['messaged', 'replied', 'interested', 'not_interested'].includes(c.outreachStatus || '')) return true;
      if (['Contacté', 'Répondu'].includes(c.stage)) return true;
      if (c.sequenceStatus && ['active', 'completed', 'replied'].includes(c.sequenceStatus)) return true;
      if (c.source === 'inmail' && c.stage !== 'Nouveau') return true;
      return false;
    }).length;
    
    const replied = candidates.filter(c => {
      if (['Répondu', 'Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre', 'Gagné'].includes(c.stage)) return true;
      if (['replied', 'interested', 'not_interested'].includes(c.outreachStatus || '')) return true;
      if (c.sequenceStatus === 'replied') return true;
      return false;
    }).length;
    
    const won = candidates.filter(c => c.stage === 'Gagné').length;
    const inProcess = candidates.filter(c =>
      ['Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre'].includes(c.stage)
    ).length;
    const responseRate = contacted > 0 ? Math.round((replied / contacted) * 100) : 0;

    return { total, contacted, replied, won, inProcess, responseRate };
  }, [candidates]);

  // ═══ Candidates needing attention (Répondu without action for 2+ days) ═══
  const urgentCandidates = useMemo(() => {
    return candidates
      .filter(c => {
        if (c.stage !== 'Répondu') return false;
        if (!c.lastActivity) return true;
        try {
          return differenceInDays(new Date(), parseISO(c.lastActivity)) >= 2;
        } catch {
          return true;
        }
      })
      .slice(0, 5);
  }, [candidates]);

  // ═══ Pipeline visual (funnel data) ═══
  const funnelData = useMemo(() => {
    return stages
      .filter(s => s.key !== 'Perdu')
      .map(stage => ({
        name: stage.key,
        count: candidates.filter(c => c.stage === stage.key).length,
        fill: STAGE_COLORS[stage.key] || 'hsl(var(--muted-foreground))',
      }));
  }, [candidates, stages]);

  // ═══ Source breakdown ═══
  const sourceData = useMemo(() => {
    const counts: Record<string, number> = {};
    candidates.forEach(c => { counts[c.source] = (counts[c.source] || 0) + 1; });
    return Object.entries(counts).map(([key, value]) => ({
      name: SOURCE_LABELS[key] || key,
      value,
    }));
  }, [candidates]);

  // ═══ Activity over time (period days) ═══
  const activityData = useMemo(() => {
    const now = new Date();
    const startDate = subDays(now, period);
    const dayCounts: Record<string, number> = {};
    for (let i = 0; i <= period; i++) {
      dayCounts[format(subDays(now, period - i), 'yyyy-MM-dd')] = 0;
    }
    candidates.forEach(c => {
      if (!c.createdAt) return;
      try {
        const date = parseISO(c.createdAt);
        if (isAfter(date, startDate)) {
          const key = format(date, 'yyyy-MM-dd');
          if (dayCounts[key] !== undefined) dayCounts[key]++;
        }
      } catch {}
    });
    return Object.entries(dayCounts).map(([date, count]) => ({
      date: format(parseISO(date), 'dd MMM', { locale: fr }),
      candidats: count,
    }));
  }, [candidates, period]);

  // ═══ Top performing jobs ═══
  const topJobs = useMemo(() => {
    const isContacted = (c: ATSCandidate) => {
      if (['messaged', 'replied', 'interested', 'not_interested'].includes(c.outreachStatus || '')) return true;
      if (['Contacté', 'Répondu'].includes(c.stage)) return true;
      if (c.sequenceStatus && ['active', 'completed', 'replied'].includes(c.sequenceStatus)) return true;
      if (c.source === 'inmail' && c.stage !== 'Nouveau') return true;
      return false;
    };
    const isReplied = (c: ATSCandidate) => {
      if (['Répondu', 'Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre', 'Gagné'].includes(c.stage)) return true;
      if (['replied', 'interested', 'not_interested'].includes(c.outreachStatus || '')) return true;
      if (c.sequenceStatus === 'replied') return true;
      return false;
    };

    const jobMap: Record<string, { title: string; contacted: number; replied: number; won: number }> = {};
    candidates.forEach(c => {
      if (!c.jobId || !c.jobTitle) return;
      if (!jobMap[c.jobId]) jobMap[c.jobId] = { title: c.jobTitle, contacted: 0, replied: 0, won: 0 };
      if (isContacted(c)) jobMap[c.jobId].contacted++;
      if (isReplied(c)) jobMap[c.jobId].replied++;
      if (c.stage === 'Gagné') jobMap[c.jobId].won++;
    });
    return Object.entries(jobMap)
      .filter(([, data]) => data.contacted > 0)
      .sort((a, b) => b[1].contacted - a[1].contacted)
      .slice(0, 5)
      .map(([id, data]) => ({ id, ...data }));
  }, [candidates]);

  // ═══ Top scored candidates ═══
  const topScored = useMemo(() => {
    return [...candidates]
      .filter(c => c.score != null && c.score > 0)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 6);
  }, [candidates]);

  // ═══ Recent activity feed ═══
  const recentActivity = useMemo(() => {
    return [...candidates]
      .filter(c => c.lastActivity || c.createdAt)
      .sort((a, b) => new Date(b.lastActivity || b.createdAt).getTime() - new Date(a.lastActivity || a.createdAt).getTime())
      .slice(0, 6);
  }, [candidates]);

  // ═══ Candidates added today ═══
  const todayCount = useMemo(() => {
    return candidates.filter(c => {
      try { return isToday(parseISO(c.createdAt)); } catch { return false; }
    }).length;
  }, [candidates]);

  // ═══ Funnel total (computed once) ═══
  const funnelTotal = useMemo(() => funnelData.reduce((s, x) => s + x.count, 0), [funnelData]);

  // ═══ Check if conversion rows would be empty ═══
  const hasConversionData = useMemo(() => {
    const stageOrderMap: Record<string, number> = {};
    STAGE_ORDER_CONV.forEach((s, i) => { stageOrderMap[s] = i; });
    const atOrBeyond = (stage: string) => {
      const idx = stageOrderMap[stage];
      if (idx === undefined) return 0;
      return candidates.filter(c => {
        const cIdx = stageOrderMap[c.stage];
        return cIdx !== undefined && cIdx >= idx;
      }).length;
    };
    for (let i = 0; i < STAGE_ORDER_CONV.length - 1; i++) {
      if (atOrBeyond(STAGE_ORDER_CONV[i]) > 0) return true;
    }
    return false;
  }, [candidates]);

  return (
    <div className="space-y-4">
      {/* ─── Period selector ─── */}
      <div className="flex items-center justify-end mb-2">
        <div className="flex gap-0 border border-foreground">
          {([7, 30, 90] as const).map((p, i) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-3 py-1 text-xs uppercase tracking-wider font-medium transition-colors",
                period === p
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
                i > 0 && "border-l border-foreground",
              )}
            >
              {p}j
            </button>
          ))}
        </div>
      </div>

      {/* ─── Hero KPI Strip ─── */}
      <div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-0 relative z-10">
          {[
            { label: 'Candidats', value: kpis.total, icon: Users, accent: false },
            { label: "Aujourd'hui", value: `+${todayCount}`, icon: TrendingUp, accent: todayCount > 0 },
            { label: 'Contactés', value: kpis.contacted, icon: Send, accent: false },
            { label: 'Taux réponse', value: `${kpis.responseRate}%`, icon: MessageCircle, accent: kpis.responseRate > 20 },
            { label: 'En process', value: kpis.inProcess, icon: Briefcase, accent: false },
            { label: 'Gagnés', value: kpis.won, icon: CheckCircle, accent: kpis.won > 0 },
          ].map((kpi, i) => {
            const Icon = kpi.icon;
            return (
              <div
                key={kpi.label}
                className={cn(
                  "border border-foreground p-3 sm:p-4 flex flex-col gap-1",
                  i > 0 && "sm:border-l-0",
                  i % 2 !== 0 && "max-sm:border-l-0",
                  i >= 2 && "max-sm:border-t-0",
                  i >= 3 && "max-sm:border-t-0 sm:border-t-0 lg:border-t",
                  kpi.accent ? "bg-brutal-accent/10" : "bg-background",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Icon className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium truncate">{kpi.label}</span>
                </div>
                <span className="text-xl sm:text-2xl font-bold font-mono tracking-tight">{kpi.value}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Main Grid ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">

        {/* ─── Left column (2/3) ─── */}
        <div className="lg:col-span-2 flex flex-col">

          {/* Urgent / Needs attention */}
          {urgentCandidates.length > 0 && (
            <Section
              title={`À traiter (${urgentCandidates.length})`}
              subtitle="Candidats ayant répondu sans action depuis 2+ jours"
              icon={AlertCircle}
              className="border-b-0 lg:border-r-0"
              action={
                <button
                  onClick={() => navigate('/pipeline')}
                  className="text-xs text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors flex items-center gap-1"
                >
                  Voir Pipeline <ArrowRight className="w-3 h-3" />
                </button>
              }
            >
              <div className="divide-y divide-border">
                {urgentCandidates.map(c => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer group"
                    onClick={() => onCandidateClick?.(c)}
                  >
                    <div className="w-7 h-7 bg-destructive/10 border border-destructive/30 flex items-center justify-center shrink-0">
                      <Clock className="w-3 h-3 text-destructive" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.headline || c.jobTitle || 'Pas de détails'}</p>
                    </div>
                    <span className="text-xs text-destructive font-medium uppercase tracking-wider whitespace-nowrap">
                      {(() => {
                        try {
                          return c.lastActivity ? `${differenceInDays(new Date(), parseISO(c.lastActivity))}j` : '?';
                        } catch {
                          return '?';
                        }
                      })()}
                    </span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Pipeline funnel */}
          <Section title="Pipeline" icon={TrendingUp} className={cn("lg:border-r-0", urgentCandidates.length === 0 ? "" : "border-t-0")}>
            <div className="p-4">
              {/* Visual pipeline bar */}
              <div className="flex h-8 mb-4 border border-foreground overflow-hidden relative z-10">
                {funnelData.filter(d => d.count > 0).map((d) => {
                  const pct = funnelTotal > 0 ? (d.count / funnelTotal) * 100 : 0;
                  return (
                    <div
                      key={d.name}
                      className="relative flex items-center justify-center text-xs font-bold transition-all group hover:opacity-90"
                      style={{ width: `${Math.max(pct, 5)}%`, backgroundColor: d.fill }}
                      title={`${d.name}: ${d.count}`}
                    >
                      <span className={cn(
                        "relative z-10 mix-blend-difference text-white truncate px-1",
                        pct < 8 && "hidden sm:inline"
                      )}>
                        {d.count}
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Legend */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 relative z-10">
                {funnelData.map(d => (
                  <div key={d.name} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 border border-foreground/30" style={{ backgroundColor: d.fill }} />
                    <span className="text-xs text-muted-foreground">{d.name}</span>
                    <span className="text-xs font-bold font-mono">{d.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {/* Activity chart */}
          <Section title={`Activité (${period} jours)`} icon={Calendar} className="border-t-0 lg:border-r-0">
            <div className="p-4 h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activityData} margin={{ left: -10, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    interval={period <= 7 ? 0 : period <= 30 ? 'preserveStartEnd' : Math.floor(period / 10)}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                    allowDecimals={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="candidats"
                    stroke="hsl(var(--foreground))"
                    fill="hsl(var(--foreground) / 0.08)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Section>
        </div>

        {/* ─── Right column (1/3) ─── */}
        <div className="flex flex-col">

          {/* Source breakdown */}
          <Section title="Sources" icon={Target} className="max-lg:border-t-0">
            <div className="p-4">
              {sourceData.length === 0 ? (
                <div className="p-6 flex flex-col items-center gap-2">
                  <Target className="w-6 h-6 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">Aucune donnée</p>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 sm:w-28 sm:h-28 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={sourceData}
                          cx="50%"
                          cy="50%"
                          innerRadius="55%"
                          outerRadius="90%"
                          dataKey="value"
                          stroke="hsl(var(--foreground))"
                          strokeWidth={1}
                        >
                          {sourceData.map((_, i) => (
                            <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-2 flex-1">
                    {sourceData.map((s, i) => {
                      const total = sourceData.reduce((sum, x) => sum + x.value, 0);
                      const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
                      return (
                        <div key={s.name} className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 shrink-0 border border-foreground/30"
                            style={{ backgroundColor: SOURCE_COLORS[i % SOURCE_COLORS.length] }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between">
                              <span className="text-xs text-muted-foreground truncate">{s.name}</span>
                              <span className="text-xs font-bold font-mono ml-2">{s.value}</span>
                            </div>
                            <div className="h-1 bg-muted mt-1 w-full">
                              <div
                                className="h-full transition-all"
                                style={{
                                  width: `${pct}%`,
                                  backgroundColor: SOURCE_COLORS[i % SOURCE_COLORS.length],
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </Section>


          {/* Scheduled messages today */}
          <Section
            title={`Envois prévus (${scheduledMessages.length})`}
            icon={Send}
            className="border-t-0"
            action={
              <button
                onClick={() => navigate('/missions')}
                className="text-xs text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors flex items-center gap-1"
              >
                Missions <ArrowRight className="w-3 h-3" />
              </button>
            }
          >
            {loadingMessages ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-10 bg-muted animate-pulse" />
                ))}
              </div>
            ) : scheduledMessages.length === 0 ? (
              <div className="p-6 flex flex-col items-center gap-2">
                <Send className="w-6 h-6 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">Aucun envoi prévu aujourd'hui</p>
              </div>
            ) : (
              <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
                {scheduledMessages.map(msg => {
                  const time = format(parseISO(msg.scheduledAt), 'HH:mm');
                  const isPast = new Date(msg.scheduledAt) < new Date();
                  const isSent = msg.status === 'sent' || msg.status === 'executed';
                  const isExpanded = expandedMessageId === msg.id;
                  const hasContent = isSent && !!msg.messageContent;
                  return (
                    <div key={msg.id}>
                      <div
                        className={cn(
                          "flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted/50 transition-colors",
                          hasContent && "cursor-pointer"
                        )}
                        onClick={() => hasContent && setExpandedMessageId(isExpanded ? null : msg.id)}
                      >
                        {/* Time */}
                        <span className={cn(
                          "text-xs font-mono font-bold w-11 shrink-0",
                          isSent ? "text-muted-foreground line-through" : isPast ? "text-destructive" : "text-foreground"
                        )}>
                          {time}
                        </span>
                        {/* Type badge */}
                        <div className={cn(
                          "w-5 h-5 flex items-center justify-center shrink-0 border",
                          msg.type === 'inmail'
                            ? "bg-brutal-accent/15 border-brutal-accent/40"
                            : "bg-foreground/5 border-foreground/20"
                        )}>
                          {msg.type === 'inmail' ? (
                            <Mail className="w-2.5 h-2.5" />
                          ) : (
                            <Zap className="w-2.5 h-2.5" />
                          )}
                        </div>
                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{msg.recipientName || 'Profil LinkedIn'}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {msg.type === 'inmail' && msg.subject
                              ? msg.subject
                              : msg.sequenceName
                                ? `${msg.sequenceName} · Étape ${(msg.stepOrder || 0) + 1}`
                                : msg.recipientHeadline || '—'}
                          </p>
                        </div>
                        {/* Status / Toggle */}
                        {hasContent ? (
                          <div className={cn(
                            "w-5 h-5 flex items-center justify-center shrink-0 border border-foreground/20 transition-transform",
                            isExpanded && "rotate-180"
                          )}>
                            <ArrowRight className="w-2.5 h-2.5 rotate-90" />
                          </div>
                        ) : isSent ? (
                          <CheckCircle className="w-3 h-3 text-muted-foreground shrink-0" />
                        ) : (
                          <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                        )}
                      </div>
                      {/* Expanded message content */}
                      {isExpanded && msg.messageContent && (
                        <div className="px-4 pb-3 pt-0">
                          <div className="ml-[4.5rem] border border-border bg-muted/30 p-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap max-h-[200px] overflow-y-auto font-mono">
                            {msg.subject && (
                              <p className="font-bold mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                                {msg.subject}
                              </p>
                            )}
                            {msg.messageContent}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Top scored candidates */}
          <Section title="Meilleurs profils" icon={Star} className="border-t-0">
            {topScored.length === 0 ? (
              <div className="p-6 flex flex-col items-center gap-2">
                <Star className="w-6 h-6 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">Aucun score</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {topScored.map(c => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2.5 px-4 py-2 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => onCandidateClick?.(c)}
                  >
                    <div className="w-7 h-7 bg-foreground text-background flex items-center justify-center shrink-0 text-xs font-bold font-mono">
                      {c.score}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.headline || '—'}</p>
                    </div>
                    <div
                      className="w-1.5 h-6"
                      style={{ backgroundColor: STAGE_COLORS[c.stage] || 'hsl(var(--muted))' }}
                      title={c.stage}
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Recent activity */}
          <Section title="Dernières activités" icon={Clock} className="border-t-0">
            {recentActivity.length === 0 ? (
              <div className="p-6 flex flex-col items-center gap-2">
                <Clock className="w-6 h-6 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">Aucune activité</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentActivity.map(c => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2.5 px-4 py-2 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => onCandidateClick?.(c)}
                  >
                    <div
                      className="w-2 h-2 shrink-0 border border-foreground/20"
                      style={{ backgroundColor: STAGE_COLORS[c.stage] || 'hsl(var(--muted))' }}
                    />
                    <span className="text-xs font-medium truncate flex-1 min-w-0">{c.name}</span>
                    <span className="text-xs uppercase tracking-wider px-1.5 py-0.5 border border-foreground/15 text-muted-foreground whitespace-nowrap">
                      {c.stage}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                      {(() => {
                        try {
                          return (c.lastActivity || c.createdAt)
                            ? format(parseISO(c.lastActivity || c.createdAt), 'dd/MM', { locale: fr })
                            : '—';
                        } catch {
                          return '—';
                        }
                      })()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* ─── Jobs Performance Table ─── */}
      {topJobs.length > 0 && (
        <Section
          title="Performance par poste"
          icon={Briefcase}
          action={
            <button
              onClick={() => navigate('/missions')}
              className="text-xs text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors flex items-center gap-1"
            >
              Missions <ArrowRight className="w-3 h-3" />
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-foreground">
                   <th className="text-left px-4 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">Poste</th>
                  <th className="text-center px-3 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">Contactés</th>
                  <th className="text-center px-3 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">Réponses</th>
                  <th className="text-center px-3 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">Taux</th>
                  <th className="text-center px-3 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">Gagnés</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topJobs.map(job => {
                  const rate = job.contacted > 0 ? Math.round((job.replied / job.contacted) * 100) : 0;
                  return (
                    <tr
                      key={job.id}
                      className="hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => onJobClick?.(job.id)}
                    >
                      <td className="px-4 py-2.5 font-medium truncate max-w-[200px]">{job.title}</td>
                      <td className="text-center px-3 py-2.5 font-mono font-bold">{job.contacted}</td>
                      <td className="text-center px-3 py-2.5 font-mono">{job.replied}</td>
                      <td className="text-center px-3 py-2.5">
                        <span className={cn(
                          "font-mono font-bold px-1.5 py-0.5 text-xs",
                          rate >= 30 ? "bg-brutal-accent/20 text-foreground" : rate >= 15 ? "bg-muted" : "text-muted-foreground"
                        )}>
                          {rate}%
                        </span>
                      </td>
                      <td className="text-center px-3 py-2.5">
                        {job.won > 0 ? (
                          <span className="inline-flex items-center gap-1 text-foreground font-bold font-mono">
                            <CheckCircle className="w-3 h-3" style={{ color: STAGE_COLORS['Gagné'] }} />
                            {job.won}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ─── Outreach Acceptance Stats ─── */}
      <Section title="Taux d'acceptation séquences" icon={UserPlus}>
        {loadingAcceptance ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-8 bg-muted animate-pulse" />
            ))}
          </div>
        ) : !acceptanceStats || acceptanceStats.global.totalEnrolled === 0 ? (
          <div className="p-6 flex flex-col items-center gap-2">
            <UserPlus className="w-6 h-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">Aucune donnée de séquences</p>
          </div>
        ) : (
          <>
            {/* Global KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-0 border-b border-foreground">
              {[
                { label: 'Inscrits', value: acceptanceStats.global.totalEnrolled, icon: Users },
                { label: 'Connectés', value: acceptanceStats.global.connected, icon: UserCheck },
                { label: 'Non connectés', value: acceptanceStats.global.notConnected, icon: UserX },
                { label: 'En attente', value: acceptanceStats.global.pending, icon: Clock },
                { label: 'Taux acceptation', value: `${acceptanceStats.global.acceptanceRate}%`, icon: Target, accent: acceptanceStats.global.acceptanceRate >= 30 },
              ].map((kpi, i) => {
                const Icon = kpi.icon;
                return (
                  <div
                    key={kpi.label}
                    className={cn(
                      "p-3 flex flex-col gap-1",
                      i > 0 && "sm:border-l border-foreground",
                      i % 2 !== 0 && "max-sm:border-l border-foreground",
                      i >= 2 && "max-sm:border-t border-foreground",
                      (kpi as any).accent ? "bg-brutal-accent/10" : "",
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium truncate">{kpi.label}</span>
                    </div>
                    <span className="text-lg font-bold font-mono tracking-tight">{kpi.value}</span>
                  </div>
                );
              })}
            </div>

            {/* By consultant table */}
            {acceptanceStats.byConsultant.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-foreground">
                      <th className="text-left px-4 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">Consultant</th>
                      <th className="text-center px-3 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">Inscrits</th>
                      <th className="text-center px-3 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">Connectés</th>
                      <th className="text-center px-3 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">Non conn.</th>
                      <th className="text-center px-3 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">En attente</th>
                      <th className="text-center px-3 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">Taux</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {acceptanceStats.byConsultant.map(consultant => (
                      <tr key={consultant.userId} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-2.5 font-medium truncate max-w-[180px]">{consultant.displayName}</td>
                        <td className="text-center px-3 py-2.5 font-mono font-bold">{consultant.totalEnrolled}</td>
                        <td className="text-center px-3 py-2.5 font-mono">{consultant.connected}</td>
                        <td className="text-center px-3 py-2.5 font-mono">{consultant.notConnected}</td>
                        <td className="text-center px-3 py-2.5 font-mono text-muted-foreground">{consultant.pending}</td>
                        <td className="text-center px-3 py-2.5">
                          <span className={cn(
                            "font-mono font-bold px-1.5 py-0.5 text-xs",
                            consultant.acceptanceRate >= 40 ? "bg-brutal-accent/20 text-foreground" : consultant.acceptanceRate >= 20 ? "bg-muted" : "text-muted-foreground"
                          )}>
                            {consultant.acceptanceRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Section>

      {/* ─── Response Rate Stats ─── */}
      <Section
        title="Taux de réponse"
        icon={MessageCircle}
        action={
          <div className="flex items-center gap-0 border border-foreground">
            {(['all', 'sequences', 'inmails'] as const).map(view => (
              <button
                key={view}
                onClick={() => setResponseView(view)}
                className={cn(
                  "px-2.5 py-1 text-xs uppercase tracking-wider font-medium transition-colors",
                  responseView === view
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                  view !== 'all' && "border-l border-foreground",
                )}
              >
                {view === 'all' ? 'Tous' : view === 'sequences' ? 'Séquences' : 'InMails'}
              </button>
            ))}
          </div>
        }
      >
        {loadingResponseRates ? (
          <div className="p-4 h-[80px] bg-muted animate-pulse" />
        ) : !responseRates ? (
          <div className="p-6 flex flex-col items-center gap-2">
            <MessageCircle className="w-6 h-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">Aucune donnée</p>
          </div>
        ) : (() => {
          const viewData = responseView === 'sequences' ? responseRates.sequences
            : responseView === 'inmails' ? responseRates.inmails
            : responseRates.combined;
          const showBreakdown = responseView === 'all';
          return (
            <div className="p-4">
              {/* Main KPIs */}
              <div className="grid grid-cols-3 gap-0 border border-foreground">
                {[
                  { label: 'Contactés', value: viewData.sent },
                  { label: 'Réponses', value: viewData.replied },
                  { label: 'Taux', value: `${viewData.rate}%`, accent: viewData.rate >= 20 },
                ].map((kpi, i) => (
                  <div key={kpi.label} className={cn(
                    "p-3 flex flex-col gap-0.5",
                    i > 0 && "border-l border-foreground",
                    (kpi as any).accent && "bg-brutal-accent/10",
                  )}>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{kpi.label}</span>
                    <span className="text-xl font-bold font-mono">{kpi.value}</span>
                  </div>
                ))}
              </div>

              {/* Breakdown when "Tous" is selected */}
              {showBreakdown && (
                <div className="grid grid-cols-2 gap-0 mt-3 border border-foreground">
                  {[
                    { label: 'Séquences', sent: responseRates.sequences.sent, replied: responseRates.sequences.replied, rate: responseRates.sequences.rate, icon: Zap },
                    { label: 'InMails', sent: responseRates.inmails.sent, replied: responseRates.inmails.replied, rate: responseRates.inmails.rate, icon: Mail },
                  ].map((channel, i) => {
                    const Icon = channel.icon;
                    return (
                      <div key={channel.label} className={cn("p-3", i > 0 && "border-l border-foreground")}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <Icon className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs uppercase tracking-wider font-bold">{channel.label}</span>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-lg font-bold font-mono">{channel.rate}%</span>
                          <span className="text-xs text-muted-foreground font-mono">
                            {channel.replied}/{channel.sent}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </Section>

      {/* ─── Daily Invitations Chart ─── */}
      <Section title="Invitations réseau / jour" subtitle={`Envoyées vs acceptées (${period} jours)`} icon={UserPlus}>
        {loadingInvites ? (
          <div className="p-4 h-[220px] bg-muted animate-pulse" />
        ) : dailyInvites.every(d => d.invitesSent === 0 && d.invitesAccepted === 0) ? (
          <div className="p-6 flex flex-col items-center gap-2">
            <UserPlus className="w-6 h-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">Aucune invitation envoyée sur la période</p>
          </div>
        ) : (
          <div className="p-4">
            {/* Summary KPIs */}
            <div className="grid grid-cols-3 gap-0 mb-4 border border-foreground">
              {(() => {
                const totalSent = dailyInvites.reduce((s, d) => s + d.invitesSent, 0);
                const totalAccepted = dailyInvites.reduce((s, d) => s + d.invitesAccepted, 0);
                const rate = totalSent > 0 ? Math.round((totalAccepted / totalSent) * 100) : 0;
                return [
                  { label: 'Envoyées', value: totalSent },
                  { label: 'Acceptées', value: totalAccepted },
                  { label: 'Taux', value: `${rate}%` },
                ].map((kpi, i) => (
                  <div key={kpi.label} className={cn("p-3 flex flex-col gap-0.5", i > 0 && "border-l border-foreground")}>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{kpi.label}</span>
                    <span className="text-lg font-bold font-mono">{kpi.value}</span>
                  </div>
                ));
              })()}
            </div>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyInvites} margin={{ left: -10, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    interval={period <= 7 ? 0 : period <= 30 ? 'preserveStartEnd' : Math.floor(period / 10)}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                    allowDecimals={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="invitesSent" name="Envoyées" fill="hsl(var(--foreground))" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="invitesAccepted" name="Acceptées" fill="hsl(var(--brutal-accent))" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Section>

      {/* ─── Pipeline Conversion Report ─── */}
      <Section title="Conversion pipeline" icon={TrendingUp}>
        {!hasConversionData ? (
          <div className="p-6 flex flex-col items-center gap-2">
            <TrendingUp className="w-6 h-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">Pas assez de données pour le calcul de conversion</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-foreground">
                  <th className="text-left px-4 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">Transition</th>
                  <th className="text-center px-3 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">Entrée</th>
                  <th className="text-center px-3 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">Sortie</th>
                  <th className="text-center px-3 py-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">Taux</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <ConversionRows candidates={candidates} stages={stages} />
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
});

// ─── Pipeline conversion rows ───
const STAGE_ORDER_CONV = ['Nouveau', 'Contacté', 'Répondu', 'Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre', 'Gagné'];

function ConversionRows({ candidates, stages }: { candidates: ATSCandidate[]; stages: { key: string }[] }) {
  const stageOrderMap: Record<string, number> = {};
  STAGE_ORDER_CONV.forEach((s, i) => { stageOrderMap[s] = i; });

  // Count candidates at or beyond each stage
  const atOrBeyond = (stage: string) => {
    const idx = stageOrderMap[stage];
    if (idx === undefined) return 0;
    return candidates.filter(c => {
      const cIdx = stageOrderMap[c.stage];
      return cIdx !== undefined && cIdx >= idx;
    }).length;
  };

  const rows = [];
  for (let i = 0; i < STAGE_ORDER_CONV.length - 1; i++) {
    const from = STAGE_ORDER_CONV[i];
    const to = STAGE_ORDER_CONV[i + 1];
    const fromCount = atOrBeyond(from);
    const toCount = atOrBeyond(to);
    if (fromCount === 0) continue;
    const rate = Math.round((toCount / fromCount) * 100);
    rows.push(
      <tr key={`${from}-${to}`} className="hover:bg-muted/50 transition-colors">
        <td className="px-4 py-2 font-medium">
          <span className="text-muted-foreground">{from}</span>
          <span className="mx-1.5 text-muted-foreground">→</span>
          <span>{to}</span>
        </td>
        <td className="text-center px-3 py-2 font-mono">{fromCount}</td>
        <td className="text-center px-3 py-2 font-mono">{toCount}</td>
        <td className="text-center px-3 py-2">
          <span className={cn(
            "font-mono font-bold px-1.5 py-0.5 text-xs",
            rate >= 50 ? "bg-brutal-accent/20 text-foreground" : rate >= 25 ? "bg-muted" : "text-muted-foreground"
          )}>
            {rate}%
          </span>
        </td>
      </tr>
    );
  }
  return <>{rows}</>;
}

import React, { useMemo } from 'react';
import { ATSCandidate } from '@/hooks/useATSData';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, CartesianGrid,
} from 'recharts';
import { format, subDays, parseISO, isAfter } from 'date-fns';
import { fr } from 'date-fns/locale';
import { TrendingUp, Users, MessageCircle, CheckCircle, Target, Zap, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ATSDashboardProps {
  candidates: ATSCandidate[];
  stages: { key: string; label: string; color: string }[];
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
  'hsl(271, 81%, 56%)',
  'hsl(217, 91%, 60%)',
  'hsl(187, 85%, 53%)',
];

const SOURCE_LABELS: Record<string, string> = {
  local: 'Pipeline direct',
  sequence: 'Séquences',
  inmail: 'InMail',
};

export function ATSDashboard({ candidates, stages }: ATSDashboardProps) {
  // KPIs
  const kpis = useMemo(() => {
    const total = candidates.length;
    const contacted = candidates.filter(c => c.stage !== 'Nouveau').length;
    const replied = candidates.filter(c => ['Répondu', 'Pressenti', 'Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre', 'Gagné'].includes(c.stage)).length;
    const won = candidates.filter(c => c.stage === 'Gagné').length;
    const responseRate = contacted > 0 ? Math.round((replied / contacted) * 100) : 0;
    const conversionRate = total > 0 ? Math.round((won / total) * 100) : 0;

    return [
      { label: 'Total candidats', value: total, icon: Users, suffix: '' },
      { label: 'Contactés', value: contacted, icon: MessageCircle, suffix: '' },
      { label: 'Taux réponse', value: responseRate, icon: Zap, suffix: '%' },
      { label: 'Conversion', value: conversionRate, icon: Target, suffix: '%' },
      { label: 'Gagnés', value: won, icon: CheckCircle, suffix: '' },
    ];
  }, [candidates]);

  // Pipeline funnel
  const funnelData = useMemo(() => {
    return stages
      .filter(s => s.key !== 'Perdu')
      .map(stage => ({
        name: stage.key,
        count: candidates.filter(c => c.stage === stage.key).length,
        fill: STAGE_COLORS[stage.key] || 'hsl(var(--muted-foreground))',
      }));
  }, [candidates, stages]);

  // Source breakdown
  const sourceData = useMemo(() => {
    const counts: Record<string, number> = {};
    candidates.forEach(c => {
      counts[c.source] = (counts[c.source] || 0) + 1;
    });
    return Object.entries(counts).map(([key, value]) => ({
      name: SOURCE_LABELS[key] || key,
      value,
    }));
  }, [candidates]);

  // Activity over time (last 30 days)
  const activityData = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = subDays(now, 30);
    const dayCounts: Record<string, number> = {};
    
    for (let i = 0; i <= 30; i++) {
      const day = format(subDays(now, 30 - i), 'yyyy-MM-dd');
      dayCounts[day] = 0;
    }
    
    candidates.forEach(c => {
      if (!c.createdAt) return;
      try {
        const date = parseISO(c.createdAt);
        if (isAfter(date, thirtyDaysAgo)) {
          const key = format(date, 'yyyy-MM-dd');
          if (dayCounts[key] !== undefined) dayCounts[key]++;
        }
      } catch {}
    });
    
    return Object.entries(dayCounts).map(([date, count]) => ({
      date: format(parseISO(date), 'dd MMM', { locale: fr }),
      candidats: count,
    }));
  }, [candidates]);

  // Top jobs
  const topJobs = useMemo(() => {
    const jobCounts: Record<string, { title: string; count: number }> = {};
    candidates.forEach(c => {
      if (!c.jobId || !c.jobTitle) return;
      if (!jobCounts[c.jobId]) jobCounts[c.jobId] = { title: c.jobTitle, count: 0 };
      jobCounts[c.jobId].count++;
    });
    return Object.values(jobCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(j => ({
        name: j.title.length > 28 ? j.title.substring(0, 28) + '…' : j.title,
        candidats: j.count,
      }));
  }, [candidates]);

  // Recent activity
  const recentActivity = useMemo(() => {
    return [...candidates]
      .filter(c => c.lastActivity || c.createdAt)
      .sort((a, b) => {
        const da = a.lastActivity || a.createdAt;
        const db = b.lastActivity || b.createdAt;
        return new Date(db).getTime() - new Date(da).getTime();
      })
      .slice(0, 8);
  }, [candidates]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="border border-foreground bg-background px-3 py-2 text-xs">
        <p className="font-medium">{label}</p>
        {payload.map((p: any, i: number) => (
          <p key={i} className="text-muted-foreground">{p.name || p.dataKey}: <span className="font-bold text-foreground">{p.value}</span></p>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-0">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className={cn(
                "border border-foreground bg-background p-3 sm:p-4 flex flex-col gap-1",
                i > 0 && "border-l-0",
                i >= 2 && "max-sm:border-l max-sm:border-t-0",
                i >= 3 && "max-md:border-t-0",
              )}
            >
              <div className="flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">{kpi.label}</span>
              </div>
              <span className="text-2xl sm:text-3xl font-bold font-mono tracking-tight">
                {kpi.value}{kpi.suffix}
              </span>
            </div>
          );
        })}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
        {/* Pipeline Funnel */}
        <div className="border border-foreground bg-background p-4">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-3.5 h-3.5" />
            <h3 className="text-[11px] uppercase tracking-wider font-bold">Pipeline</h3>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={80}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" radius={0} barSize={18}>
                  {funnelData.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Source Breakdown */}
        <div className="border border-foreground md:border-l-0 max-md:border-t-0 bg-background p-4">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-3.5 h-3.5" />
            <h3 className="text-[11px] uppercase tracking-wider font-bold">Sources</h3>
          </div>
          <div className="h-[220px] flex items-center justify-center">
            {sourceData.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune donnée</p>
            ) : (
              <div className="flex items-center gap-4 w-full">
                <div className="w-1/2 h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={sourceData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                        dataKey="value"
                        stroke="hsl(var(--foreground))"
                        strokeWidth={1.5}
                      >
                        {sourceData.map((_, i) => (
                          <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-2">
                  {sourceData.map((s, i) => (
                    <div key={s.name} className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 border border-foreground"
                        style={{ backgroundColor: SOURCE_COLORS[i % SOURCE_COLORS.length] }}
                      />
                      <span className="text-[10px] text-muted-foreground">{s.name}</span>
                      <span className="text-xs font-bold font-mono">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Activity Over Time */}
        <div className="border border-foreground border-t-0 bg-background p-4">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-3.5 h-3.5" />
            <h3 className="text-[11px] uppercase tracking-wider font-bold">Activité (30j)</h3>
          </div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  width={24}
                  allowDecimals={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="candidats"
                  stroke="hsl(var(--brutal-accent))"
                  fill="hsl(var(--brutal-accent) / 0.15)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Jobs */}
        <div className="border border-foreground border-t-0 md:border-l-0 bg-background p-4">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-3.5 h-3.5" />
            <h3 className="text-[11px] uppercase tracking-wider font-bold">Top postes</h3>
          </div>
          <div className="h-[180px]">
            {topJobs.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune donnée</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topJobs} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="candidats" fill="hsl(var(--foreground))" radius={0} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="border border-foreground bg-background">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-foreground">
          <Clock className="w-3.5 h-3.5" />
          <h3 className="text-[11px] uppercase tracking-wider font-bold">Activité récente</h3>
        </div>
        {recentActivity.length === 0 ? (
          <p className="text-xs text-muted-foreground p-4">Aucune activité</p>
        ) : (
          <div className="divide-y divide-border">
            {recentActivity.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-muted/50 transition-colors">
                <div
                  className="w-2 h-2 shrink-0 border border-foreground/30"
                  style={{ backgroundColor: STAGE_COLORS[c.stage] || 'hsl(var(--muted))' }}
                />
                <span className="font-medium truncate min-w-0 flex-1">{c.name}</span>
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-foreground/20 text-muted-foreground whitespace-nowrap">
                  {c.stage}
                </span>
                {c.jobTitle && (
                  <span className="text-muted-foreground truncate max-w-[120px] hidden sm:inline">{c.jobTitle}</span>
                )}
                <span className="text-muted-foreground whitespace-nowrap text-[10px]">
                  {c.lastActivity || c.createdAt
                    ? format(parseISO(c.lastActivity || c.createdAt), 'dd MMM', { locale: fr })
                    : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

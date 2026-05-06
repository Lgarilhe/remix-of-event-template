import React from 'react';
import { Users, Send, MessageCircle, UserCheck, Trophy } from 'lucide-react';
import { ATSCandidate } from '@/hooks/useATSData';

interface ATSStatsProps {
  candidates: ATSCandidate[];
  stages: { key: string; label: string; color: string }[];
}

const STAT_CONFIG: { key: string; label: string; icon: typeof Users; suffix?: string }[] = [
  { key: 'total', label: 'Total', icon: Users },
  { key: 'contacted', label: 'Contactés', icon: Send },
  { key: 'responseRate', label: 'Réponse', icon: MessageCircle, suffix: '%' },
  { key: 'inProgress', label: 'En cours', icon: UserCheck },
  { key: 'won', label: 'Gagnés', icon: Trophy },
  { key: 'conversionRate', label: 'Conv.', icon: Trophy, suffix: '%' },
];

function isContacted(c: ATSCandidate): boolean {
  if (['messaged', 'replied', 'interested', 'not_interested'].includes(c.outreachStatus || '')) return true;
  if (['Contacté', 'Répondu', 'Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre', 'Gagné'].includes(c.stage)) return true;
  // Only count sequence as contacted if a message was actually sent (completed/replied), not just enrolled (active)
  if (c.sequenceStatus && ['completed', 'replied'].includes(c.sequenceStatus)) return true;
  if (c.source === 'inmail' && !['Nouveau'].includes(c.stage)) return true;
  return false;
}

function isReplied(c: ATSCandidate): boolean {
  if (['Répondu', 'Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre', 'Gagné'].includes(c.stage)) return true;
  if (['replied', 'interested', 'not_interested'].includes(c.outreachStatus || '')) return true;
  if (c.sequenceStatus === 'replied') return true;
  return false;
}

export const ATSStats: React.FC<ATSStatsProps> = ({ candidates, stages }) => {
  const stats = React.useMemo(() => {
    const total = candidates.length;
    const contacted = candidates.filter(isContacted).length;
    const replied = candidates.filter(isReplied).length;
    const inProgress = candidates.filter(c =>
      ['Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre'].includes(c.stage)
    ).length;
    const won = candidates.filter(c => c.stage === 'Gagné').length;
    const lost = candidates.filter(c => c.stage === 'Perdu').length;

    const responseRate = contacted > 0 ? Math.round((replied / contacted) * 100) : 0;
    const conversionRate = (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : 0;

    return { total, contacted, replied, inProgress, won, lost, responseRate, conversionRate };
  }, [candidates]);

  const values: Record<string, number> = {
    total: stats.total,
    contacted: stats.contacted,
    responseRate: stats.responseRate,
    inProgress: stats.inProgress,
    won: stats.won,
    conversionRate: stats.conversionRate,
  };

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
      {STAT_CONFIG.map(stat => {
        const Icon = stat.icon;
        const value = values[stat.key];
        return (
          <div
            key={stat.key}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card hover:bg-muted/30 transition-colors"
          >
            <div className="h-7 w-7 rounded-lg bg-emerald-500/15 grid place-items-center shrink-0">
              <Icon className="w-3.5 h-3.5 text-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-[14px] font-bold text-foreground tabular-nums leading-tight">
                {value}{stat.suffix || ''}
              </p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold truncate">
                {stat.label}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

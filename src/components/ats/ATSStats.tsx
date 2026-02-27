import React from 'react';
import { Users, UserCheck, Send, MessageCircle, Trophy, XCircle } from 'lucide-react';
import { ATSCandidate } from '@/pages/ATS';

interface ATSStatsProps {
  candidates: ATSCandidate[];
  stages: { key: string; label: string; color: string }[];
}

const STAT_CONFIG: { key: string; label: string; icon: typeof Users; suffix?: string }[] = [
  { key: 'total', label: 'TOTAL', icon: Users },
  { key: 'contacted', label: 'CONTACTÉS', icon: Send },
  { key: 'responseRate', label: 'TAUX RÉPONSE', icon: MessageCircle, suffix: '%' },
  { key: 'inProgress', label: 'EN COURS', icon: UserCheck },
  { key: 'won', label: 'GAGNÉS', icon: Trophy },
  { key: 'conversionRate', label: 'CONVERSION', icon: Trophy, suffix: '%' },
];

export const ATSStats: React.FC<ATSStatsProps> = ({ candidates, stages }) => {
  const stats = React.useMemo(() => {
    const total = candidates.length;
    const contacted = candidates.filter(c => 
      ['Contacté', 'CV envoyé', 'ITW en cours', 'Offre', 'Gagné', 'Répondu'].includes(c.stage)
    ).length;
    const replied = candidates.filter(c => 
      ['Répondu', 'ITW en cours', 'Offre', 'Gagné'].includes(c.stage)
    ).length;
    const inProgress = candidates.filter(c => 
      ['CV envoyé', 'ITW en cours', 'Offre'].includes(c.stage)
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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-0 mb-6">
      {STAT_CONFIG.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.key}
            className={`
              p-4 border border-foreground bg-background
              ${index > 0 ? 'border-l-0' : ''}
              group hover:bg-brutal-accent transition-colors duration-200
            `}
          >
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 bg-foreground text-background flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {values[stat.key]}{stat.suffix || ''}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                  {stat.label}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
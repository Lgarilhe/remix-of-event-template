import React from 'react';
import { Card } from '@/components/ui/card';
import { Users, UserCheck, Send, MessageCircle, Trophy, XCircle } from 'lucide-react';
import { ATSCandidate } from '@/pages/ATS';

interface ATSStatsProps {
  candidates: ATSCandidate[];
  stages: { key: string; label: string; color: string }[];
}

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

    return {
      total,
      contacted,
      replied,
      inProgress,
      won,
      lost,
      responseRate,
      conversionRate,
    };
  }, [candidates]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
      <Card className="p-4 bg-white border-[#1A1A1A]/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-slate-100">
            <Users className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#1A1A1A]">{stats.total}</p>
            <p className="text-xs text-[#1A1A1A]/60">Total</p>
          </div>
        </div>
      </Card>

      <Card className="p-4 bg-white border-[#1A1A1A]/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-100">
            <Send className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#1A1A1A]">{stats.contacted}</p>
            <p className="text-xs text-[#1A1A1A]/60">Contactés</p>
          </div>
        </div>
      </Card>

      <Card className="p-4 bg-white border-[#1A1A1A]/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-100">
            <MessageCircle className="w-5 h-5 text-cyan-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#1A1A1A]">{stats.responseRate}%</p>
            <p className="text-xs text-[#1A1A1A]/60">Taux réponse</p>
          </div>
        </div>
      </Card>

      <Card className="p-4 bg-white border-[#1A1A1A]/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-yellow-100">
            <UserCheck className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#1A1A1A]">{stats.inProgress}</p>
            <p className="text-xs text-[#1A1A1A]/60">En cours</p>
          </div>
        </div>
      </Card>

      <Card className="p-4 bg-white border-[#1A1A1A]/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-100">
            <Trophy className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#1A1A1A]">{stats.won}</p>
            <p className="text-xs text-[#1A1A1A]/60">Gagnés</p>
          </div>
        </div>
      </Card>

      <Card className="p-4 bg-white border-[#1A1A1A]/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-100">
            <Trophy className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#1A1A1A]">{stats.conversionRate}%</p>
            <p className="text-xs text-[#1A1A1A]/60">Conversion</p>
          </div>
        </div>
      </Card>
    </div>
  );
};

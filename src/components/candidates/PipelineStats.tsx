import React from 'react';
import { Users, TrendingUp, Award, XCircle } from 'lucide-react';

interface PipelineStatsProps {
  data: Record<string, { id: string }[]>;
  stages: { key: string; label: string; color: string }[];
}

export const PipelineStats: React.FC<PipelineStatsProps> = ({ data, stages }) => {
  const totalCandidates = Object.values(data).reduce((sum, entries) => sum + entries.length, 0);

  const wonCount = data['Gagné']?.length || 0;
  const lostCount = data['Perdu']?.length || 0;
  const inProgressCount = totalCandidates - wonCount - lostCount;
  const conversionRate = totalCandidates > 0 ? Math.round((wonCount / totalCandidates) * 100) : 0;

  return (
    <div className="bg-background border border-foreground p-4 mb-6 animate-fade-in">
      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-0">
        <div className="p-3 border border-foreground bg-muted/30">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{totalCandidates}</p>
        </div>
        
        <div className="p-3 border border-foreground border-l-0 bg-blue-50/50">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-blue-600" />
            <span className="text-xs text-blue-600 font-medium uppercase tracking-wider">En cours</span>
          </div>
          <p className="text-2xl font-bold text-blue-700">{inProgressCount}</p>
        </div>
        
        <div className="p-3 border border-foreground border-l-0 bg-green-50/50">
          <div className="flex items-center gap-2 mb-1">
            <Award className="w-4 h-4 text-green-600" />
            <span className="text-xs text-green-600 font-medium uppercase tracking-wider">Gagnés</span>
          </div>
          <p className="text-2xl font-bold text-green-700">{wonCount}</p>
        </div>
        
        <div className="p-3 border border-foreground border-l-0 bg-red-50/50">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-red-600" />
            <span className="text-xs text-red-600 font-medium uppercase tracking-wider">Perdus</span>
          </div>
          <p className="text-2xl font-bold text-red-700">{lostCount}</p>
        </div>
      </div>

      {/* Conversion rate indicator */}
      <div className="mt-3 pt-3 border-t border-foreground/20 flex items-center gap-2">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">Conversion:</span>
        <div className="flex-1 h-1.5 bg-muted overflow-hidden max-w-[200px] border border-foreground/10">
          <div 
            className="h-full bg-green-500 transition-all duration-500"
            style={{ width: `${conversionRate}%` }}
          />
        </div>
        <span className="text-sm font-bold text-green-600">{conversionRate}%</span>
      </div>
    </div>
  );
};

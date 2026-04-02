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
    <div className="bg-background border border-border p-4 mb-6 animate-fade-in">
      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-0">
        <div className="p-3 border border-border bg-muted/30">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{totalCandidates}</p>
        </div>
        
        <div className="p-3 border border-border border-l-0 bg-info/5">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-info" />
            <span className="text-xs text-info font-medium uppercase tracking-wider">En cours</span>
          </div>
          <p className="text-2xl font-bold text-info">{inProgressCount}</p>
        </div>

        <div className="p-3 border border-border border-l-0 bg-success/5">
          <div className="flex items-center gap-2 mb-1">
            <Award className="w-4 h-4 text-success" />
            <span className="text-xs text-success font-medium uppercase tracking-wider">Gagnés</span>
          </div>
          <p className="text-2xl font-bold text-success">{wonCount}</p>
        </div>

        <div className="p-3 border border-border border-l-0 bg-destructive/5">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-destructive" />
            <span className="text-xs text-destructive font-medium uppercase tracking-wider">Perdus</span>
          </div>
          <p className="text-2xl font-bold text-destructive">{lostCount}</p>
        </div>
      </div>

      {/* Conversion rate indicator */}
      <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">Conversion:</span>
        <div className="flex-1 h-1.5 bg-muted overflow-hidden max-w-[200px] border border-border">
          <div 
            className="h-full bg-success transition-all duration-500"
            style={{ width: `${conversionRate}%` }}
          />
        </div>
        <span className="text-sm font-bold text-success">{conversionRate}%</span>
      </div>
    </div>
  );
};

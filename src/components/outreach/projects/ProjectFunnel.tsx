import React from 'react';
import { Users, Target, MessageSquare, UserCheck, UserX } from 'lucide-react';

// Lot 0c : messaged et shortlisted sont des cumuls depuis le début (contactés
// et retenus au total, get_mission_stage_counts), dismissed l'effectif écarté.
// Retenu vient avant Contacté (modèle des étapes du lot 0a). Toutes les parts
// se lisent sur les sourcés, comme les cartes de MissionInsights. Refonte au lot 1.
interface ProjectFunnelProps {
  totalFound: number;
  scored: number;
  messaged: number;
  shortlisted: number;
  dismissed: number;
}

export const ProjectFunnel: React.FC<ProjectFunnelProps> = ({
  totalFound,
  scored,
  messaged,
  shortlisted,
  dismissed,
}) => {
  // Calculate percentages safely
  const scoredPct = totalFound > 0 ? (scored / totalFound) * 100 : 0;
  const shortlistedPct = totalFound > 0 ? (shortlisted / totalFound) * 100 : 0;
  const contactedPct = totalFound > 0 ? (messaged / totalFound) * 100 : 0;

  const stages = [
    {
      label: 'Sourcés',
      value: totalFound,
      icon: Users,
      color: 'hsl(var(--status-info))',
      bgLight: 'bg-info/10',
    },
    {
      label: 'Évalués',
      value: scored,
      pct: scoredPct,
      pctOf: 'des sourcés',
      icon: Target,
      color: 'hsl(var(--status-warning))',
      bgLight: 'bg-warning/10',
    },
    {
      label: 'Retenus au total',
      value: shortlisted,
      pct: shortlistedPct,
      pctOf: 'des sourcés',
      icon: UserCheck,
      color: 'hsl(var(--brand))',
      bgLight: 'bg-brand/10',
    },
    {
      label: 'Contactés au total',
      value: messaged,
      pct: contactedPct,
      pctOf: 'des sourcés',
      icon: MessageSquare,
      color: 'hsl(var(--status-success))',
      bgLight: 'bg-success/10',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Funnel visual */}
      <div className="relative">
        {stages.map((stage, idx) => {
          // Calculate width as percentage of funnel (tapering effect)
          const widthPct = idx === 0 ? 100 : Math.max(20, 100 - (idx * 20));
          
          return (
            <div key={stage.label} className="relative mb-2">
              {/* Connecting line */}
              {idx > 0 && (
                <div 
                  className="absolute -top-2 left-1/2 w-0.5 h-2 bg-border"
                  style={{ transform: 'translateX(-50%)' }}
                />
              )}
              
              {/* Stage bar */}
              <div 
                className={`mx-auto rounded-lg p-4 transition-all ${stage.bgLight}`}
                style={{ 
                  width: `${widthPct}%`,
                  borderLeft: `4px solid ${stage.color}`,
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: `${stage.color}20` }}
                    >
                      <stage.icon 
                        className="w-4 h-4" 
                        style={{ color: stage.color }}
                      />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{stage.label}</p>
                      {stage.pct !== undefined && (
                        <p className="text-xs text-muted-foreground">
                          {stage.pct.toFixed(0)}% {stage.pctOf}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p 
                      className="text-2xl font-bold" 
                      style={{ color: stage.color }}
                    >
                      {stage.value}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dismissed section */}
      <div className="flex items-center justify-between p-4 bg-destructive/5 rounded-lg border border-destructive/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center">
            <UserX className="w-4 h-4 text-destructive" />
          </div>
          <div>
            <p className="font-medium text-foreground">Profils écartés</p>
            <p className="text-xs text-muted-foreground">En ce moment</p>
          </div>
        </div>
        <p className="text-2xl font-bold text-destructive">{dismissed}</p>
      </div>

      {/* Empty state hint */}
      {totalFound === 0 && (
        <div className="text-center py-6 text-muted-foreground">
          <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Aucune donnée pour le moment</p>
          <p className="text-xs mt-1">Lancez une recherche pour commencer</p>
        </div>
      )}
    </div>
  );
};

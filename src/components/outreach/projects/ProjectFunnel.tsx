import React from 'react';
import { Users, Target, MessageSquare, UserCheck, UserX, TrendingUp } from 'lucide-react';

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
  const contactedPct = scored > 0 ? (messaged / scored) * 100 : 0;
  const shortlistedPct = messaged > 0 ? (shortlisted / messaged) * 100 : 0;
  const overallConversion = totalFound > 0 ? (shortlisted / totalFound) * 100 : 0;

  const stages = [
    {
      label: 'Profils trouvés',
      value: totalFound,
      icon: Users,
      color: '#3B82F6', // blue-500
      bgLight: 'bg-blue-50',
    },
    {
      label: 'Évalués',
      value: scored,
      pct: scoredPct,
      icon: Target,
      color: '#F59E0B', // amber-500
      bgLight: 'bg-amber-50',
    },
    {
      label: 'Contactés',
      value: messaged,
      pct: contactedPct,
      icon: MessageSquare,
      color: '#10B981', // emerald-500
      bgLight: 'bg-emerald-50',
    },
    {
      label: 'Shortlistés',
      value: shortlisted,
      pct: shortlistedPct,
      icon: UserCheck,
      color: '#8B5CF6', // violet-500
      bgLight: 'bg-violet-50',
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
                  className="absolute -top-2 left-1/2 w-0.5 h-2 bg-gray-200"
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
                      <p className="font-medium text-gray-900">{stage.label}</p>
                      {stage.pct !== undefined && (
                        <p className="text-xs text-gray-500">
                          {stage.pct.toFixed(0)}% de l'étape précédente
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
      <div className="flex items-center justify-between p-4 bg-red-50/50 rounded-lg border border-red-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
            <UserX className="w-4 h-4 text-red-500" />
          </div>
          <div>
            <p className="font-medium text-gray-700">Profils écartés</p>
            <p className="text-xs text-gray-500">Score {'<'} 40 ou rejetés manuellement</p>
          </div>
        </div>
        <p className="text-2xl font-bold text-red-500">{dismissed}</p>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl p-4 text-center border border-blue-100">
          <TrendingUp className="w-5 h-5 text-blue-600 mx-auto mb-2" />
          <p className="text-2xl font-bold text-blue-700">
            {contactedPct.toFixed(0)}%
          </p>
          <p className="text-xs text-blue-600/80 font-medium">Taux de contact</p>
        </div>
        <div className="bg-gradient-to-br from-violet-50 to-violet-100/50 rounded-xl p-4 text-center border border-violet-100">
          <UserCheck className="w-5 h-5 text-violet-600 mx-auto mb-2" />
          <p className="text-2xl font-bold text-violet-700">
            {shortlistedPct.toFixed(0)}%
          </p>
          <p className="text-xs text-violet-600/80 font-medium">Taux shortlist</p>
        </div>
        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-xl p-4 text-center border border-emerald-100">
          <Target className="w-5 h-5 text-emerald-600 mx-auto mb-2" />
          <p className="text-2xl font-bold text-emerald-700">
            {overallConversion.toFixed(1)}%
          </p>
          <p className="text-xs text-emerald-600/80 font-medium">Conversion globale</p>
        </div>
      </div>

      {/* Empty state hint */}
      {totalFound === 0 && (
        <div className="text-center py-6 text-gray-400">
          <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Aucune donnée pour le moment</p>
          <p className="text-xs mt-1">Lancez une recherche pour commencer</p>
        </div>
      )}
    </div>
  );
};

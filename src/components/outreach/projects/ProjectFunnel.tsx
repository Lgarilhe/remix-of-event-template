import React from 'react';
import { Progress } from '@/components/ui/progress';
import { Users, Target, MessageSquare, UserCheck, UserX } from 'lucide-react';

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
  // Calculate percentages
  const scoredPct = totalFound > 0 ? (scored / totalFound) * 100 : 0;
  const contactedPct = scored > 0 ? (messaged / scored) * 100 : 0;
  const shortlistedPct = messaged > 0 ? (shortlisted / messaged) * 100 : 0;
  const dismissedPct = totalFound > 0 ? (dismissed / totalFound) * 100 : 0;

  const stages = [
    {
      label: 'Profils trouvés',
      value: totalFound,
      icon: Users,
      color: 'bg-blue-500',
      bgColor: 'bg-blue-50',
      textColor: 'text-blue-700',
    },
    {
      label: 'Scorés',
      value: scored,
      pct: scoredPct,
      icon: Target,
      color: 'bg-amber-500',
      bgColor: 'bg-amber-50',
      textColor: 'text-amber-700',
    },
    {
      label: 'Contactés',
      value: messaged,
      pct: contactedPct,
      icon: MessageSquare,
      color: 'bg-green-500',
      bgColor: 'bg-green-50',
      textColor: 'text-green-700',
    },
    {
      label: 'Shortlistés',
      value: shortlisted,
      pct: shortlistedPct,
      icon: UserCheck,
      color: 'bg-purple-500',
      bgColor: 'bg-purple-50',
      textColor: 'text-purple-700',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Funnel visualization */}
      <div className="space-y-3">
        {stages.map((stage, idx) => (
          <div key={stage.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <stage.icon className={`w-4 h-4 ${stage.textColor}`} />
                <span className="font-medium text-gray-700">{stage.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`font-bold ${stage.textColor}`}>{stage.value}</span>
                {stage.pct !== undefined && (
                  <span className="text-xs text-gray-400">
                    ({stage.pct.toFixed(0)}%)
                  </span>
                )}
              </div>
            </div>
            <Progress 
              value={idx === 0 ? 100 : stage.pct} 
              className={`h-2 ${stage.bgColor}`}
              style={{
                ['--progress-bg' as string]: stage.color.replace('bg-', ''),
              }}
            />
          </div>
        ))}
      </div>

      {/* Dismissed count */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <div className="flex items-center gap-2 text-sm">
          <UserX className="w-4 h-4 text-red-400" />
          <span className="text-gray-600">Écartés</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-bold text-red-600">{dismissed}</span>
          <span className="text-xs text-gray-400">
            ({dismissedPct.toFixed(0)}%)
          </span>
        </div>
      </div>

      {/* Conversion metrics */}
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-gray-900">
            {contactedPct.toFixed(0)}%
          </p>
          <p className="text-xs text-gray-500">Taux de contact</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-gray-900">
            {shortlistedPct.toFixed(0)}%
          </p>
          <p className="text-xs text-gray-500">Taux de conversion</p>
        </div>
      </div>
    </div>
  );
};

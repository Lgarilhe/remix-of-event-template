import React from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from 'recharts';
import { Users, TrendingUp, Award, XCircle } from 'lucide-react';

interface PipelineStage {
  key: string;
  label: string;
  color: string;
}

interface PipelineStatsProps {
  data: Record<string, { id: string }[]>;
  stages: PipelineStage[];
}

const STAGE_COLORS: Record<string, string> = {
  'Pressenti': '#9CA3AF',
  'CV envoyé': '#3B82F6',
  'ITW en cours': '#F59E0B',
  'Offre': '#8B5CF6',
  'Gagné': '#10B981',
  'Perdu': '#EF4444',
};

export const PipelineStats: React.FC<PipelineStatsProps> = ({ data, stages }) => {
  const totalCandidates = Object.values(data).reduce((sum, entries) => sum + entries.length, 0);
  
  const chartData = stages.map(stage => ({
    name: stage.label,
    count: data[stage.key]?.length || 0,
    color: STAGE_COLORS[stage.key] || '#6B7280',
  }));

  const wonCount = data['Gagné']?.length || 0;
  const lostCount = data['Perdu']?.length || 0;
  const inProgressCount = totalCandidates - wonCount - lostCount;
  const conversionRate = totalCandidates > 0 ? Math.round((wonCount / totalCandidates) * 100) : 0;

  return (
    <div className="bg-white rounded-xl border border-[#1A1A1A]/10 p-4 mb-6 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg p-3 border border-gray-200">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-gray-600" />
              <span className="text-xs text-gray-600 font-medium">Total</span>
            </div>
            <p className="text-2xl font-bold text-[#1A1A1A]">{totalCandidates}</p>
          </div>
          
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-blue-600 font-medium">En cours</span>
            </div>
            <p className="text-2xl font-bold text-blue-700">{inProgressCount}</p>
          </div>
          
          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-3 border border-green-200">
            <div className="flex items-center gap-2 mb-1">
              <Award className="w-4 h-4 text-green-600" />
              <span className="text-xs text-green-600 font-medium">Gagnés</span>
            </div>
            <p className="text-2xl font-bold text-green-700">{wonCount}</p>
          </div>
          
          <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-lg p-3 border border-red-200">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-red-600" />
              <span className="text-xs text-red-600 font-medium">Perdus</span>
            </div>
            <p className="text-2xl font-bold text-red-700">{lostCount}</p>
          </div>
        </div>

        {/* Chart */}
        <div className="h-[100px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
              <XAxis type="number" hide />
              <YAxis 
                type="category" 
                dataKey="name" 
                width={70} 
                tick={{ fontSize: 11, fill: '#6B7280' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip 
                formatter={(value: number) => [`${value} candidat${value > 1 ? 's' : ''}`, '']}
                contentStyle={{ 
                  backgroundColor: '#1A1A1A', 
                  border: 'none', 
                  borderRadius: '8px',
                  color: 'white',
                  fontSize: '12px'
                }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={16}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Conversion rate indicator */}
      <div className="mt-3 pt-3 border-t border-[#1A1A1A]/5 flex items-center gap-2">
        <span className="text-xs text-[#1A1A1A]/50">Taux de conversion:</span>
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-[200px]">
          <div 
            className="h-full bg-gradient-to-r from-green-400 to-green-500 rounded-full transition-all duration-500"
            style={{ width: `${conversionRate}%` }}
          />
        </div>
        <span className="text-sm font-semibold text-green-600">{conversionRate}%</span>
      </div>
    </div>
  );
};

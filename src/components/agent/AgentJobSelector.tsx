import React from 'react';
import { Job } from '@/types/jobs';
import { cn } from '@/lib/utils';
import { ArrowRight } from 'lucide-react';

interface AgentJobSelectorProps {
  jobs: Job[];
  selectedJob: Job | null;
  onSelectJob: (job: Job | null) => void;
  onLaunch: () => void;
}

export const AgentJobSelector: React.FC<AgentJobSelectorProps> = ({
  jobs, selectedJob, onSelectJob, onLaunch,
}) => {
  return (
    <div className="px-5 py-4 border-b border-white/[0.06] space-y-3">
      <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>
        Nouveau sourcing
      </p>

      {/* Job cards */}
      <div className="space-y-2 max-h-[200px] overflow-y-auto agent-scrollbar pr-1">
        {jobs.length === 0 ? (
          <p className="text-xs py-4 text-center" style={{ color: 'rgba(255,255,255,0.25)' }}>
            Aucun poste actif
          </p>
        ) : (
          jobs.map(job => {
            const isSelected = selectedJob?.id === job.id;
            return (
              <button
                key={job.id}
                onClick={() => onSelectJob(isSelected ? null : job)}
                className="w-full text-left px-3 py-2.5 rounded-lg transition-all duration-200 flex items-center gap-3"
                style={{
                  background: isSelected ? 'rgba(0,240,255,0.06)' : 'rgba(255,255,255,0.02)',
                  border: isSelected ? '1px solid rgba(0,240,255,0.3)' : '1px solid rgba(255,255,255,0.06)',
                  boxShadow: isSelected ? '0 0 24px rgba(0,240,255,0.06)' : 'none',
                }}
                onMouseEnter={e => {
                  if (!isSelected) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                  }
                }}
                onMouseLeave={e => {
                  if (!isSelected) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                  }
                }}
              >
                {/* Radio dot */}
                <div
                  className="h-4 w-4 rounded-full flex items-center justify-center shrink-0 transition-all"
                  style={{
                    border: isSelected ? '2px solid #00f0ff' : '2px solid rgba(255,255,255,0.15)',
                  }}
                >
                  {isSelected && (
                    <div className="h-2 w-2 rounded-full bg-[#00f0ff]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: isSelected ? '#fff' : 'rgba(255,255,255,0.7)' }}>
                    {job.title}
                  </p>
                  <p className="text-xs truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {job.client?.name || 'N/A'}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Launch button */}
      <div className="relative">
        {/* Animated gradient border */}
        {selectedJob && (
          <div
            className="absolute -inset-[2px] rounded-xl opacity-70"
            style={{
              background: 'linear-gradient(135deg, #00f0ff, #7c3aed, #f43f5e, #00f0ff)',
              backgroundSize: '300% 300%',
              animation: 'agent-gradient-shift 4s ease infinite',
              filter: 'blur(3px)',
            }}
          />
        )}
        <button
          onClick={onLaunch}
          disabled={!selectedJob}
          className={cn(
            "relative w-full h-10 text-sm font-medium flex items-center justify-center gap-2 rounded-lg transition-all z-[1]",
            !selectedJob && "cursor-not-allowed"
          )}
          style={
            selectedJob
              ? {
                  background: 'linear-gradient(135deg, rgba(0,240,255,0.15), rgba(124,58,237,0.15))',
                  color: '#fff',
                  border: '1px solid rgba(0,240,255,0.3)',
                }
              : {
                  background: 'rgba(255,255,255,0.04)',
                  color: 'rgba(255,255,255,0.3)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }
          }
        >
          Lancer l'agent
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

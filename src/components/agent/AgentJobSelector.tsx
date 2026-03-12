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
    <div className="px-4 py-4 border-b border-foreground/10 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
        Nouveau sourcing
      </p>

      {/* Job cards */}
      <div className="space-y-1.5 max-h-[200px] overflow-y-auto scrollbar-hide pr-1">
        {jobs.length === 0 ? (
          <p className="text-xs py-4 text-center text-muted-foreground">
            Aucun poste actif
          </p>
        ) : (
          jobs.map(job => {
            const isSelected = selectedJob?.id === job.id;
            return (
              <button
                key={job.id}
                onClick={() => onSelectJob(isSelected ? null : job)}
                className={cn(
                  "w-full text-left px-3 py-2.5 transition-colors flex items-center gap-3 border",
                  isSelected
                    ? "border-foreground bg-brutal-accent/10"
                    : "border-foreground/10 hover:border-foreground/30 hover:bg-muted/50"
                )}
              >
                {/* Radio dot */}
                <div className={cn(
                  "h-3.5 w-3.5 border-2 flex items-center justify-center shrink-0",
                  isSelected ? "border-foreground" : "border-foreground/30"
                )}>
                  {isSelected && <div className="h-1.5 w-1.5 bg-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-sm font-medium truncate",
                    isSelected ? "text-foreground" : "text-foreground/70"
                  )}>
                    {job.title}
                  </p>
                  <p className="text-xs truncate mt-0.5 text-muted-foreground">
                    {job.client?.name || 'N/A'}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Launch button */}
      <button
        onClick={onLaunch}
        disabled={!selectedJob}
        className={cn(
          "w-full h-10 text-xs font-bold uppercase tracking-[0.15em] flex items-center justify-center gap-2 border-2 transition-colors",
          selectedJob
            ? "border-foreground bg-foreground text-background hover:bg-brutal-accent hover:border-brutal-accent"
            : "border-foreground/20 text-muted-foreground cursor-not-allowed"
        )}
      >
        Lancer l'agent
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
};

import React from 'react';
import { Job } from '@/types/jobs';
import { cn } from '@/lib/utils';
import { ArrowRight, Check, MapPin } from 'lucide-react';

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
      <p className="text-xs font-display font-black uppercase tracking-[0.15em] text-muted-foreground">
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
            const location = job.city || (job as any).location;
            return (
              <button
                key={job.id}
                onClick={() => onSelectJob(isSelected ? null : job)}
                className={cn(
                  "w-full text-left px-3 py-2.5 transition-all duration-200 flex items-center gap-3 border",
                  isSelected
                    ? "border-brutal-accent bg-brutal-accent/5 glass-subtle"
                    : "border-foreground/10 hover:border-foreground/30 hover:bg-muted/50"
                )}
              >
                {/* Checkmark */}
                <div className={cn(
                  "h-5 w-5 flex items-center justify-center shrink-0 transition-all duration-200",
                  isSelected
                    ? "bg-brutal-accent text-white"
                    : "border border-foreground/20"
                )}>
                  {isSelected && (
                    <Check className="w-3 h-3 animate-scale-in" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-sm font-semibold truncate",
                    isSelected ? "text-foreground" : "text-foreground/70"
                  )}>
                    {job.title}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs truncate text-muted-foreground">
                      {job.client?.name || 'N/A'}
                    </p>
                    {location && (
                      <>
                        <span className="text-foreground/10">·</span>
                        <span className="flex items-center gap-0.5 text-xs text-muted-foreground/70 shrink-0">
                          <MapPin className="w-3 h-3" />
                          {location}
                        </span>
                      </>
                    )}
                  </div>
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
          "w-full h-10 text-xs font-bold uppercase tracking-[0.15em] flex items-center justify-center gap-2 border-2 transition-all duration-200",
          selectedJob
            ? "border-transparent skalr-gradient-bg text-white hover:shadow-[0_0_20px_-4px_hsl(var(--brutal-accent)/0.4)]"
            : "border-foreground/20 text-muted-foreground cursor-not-allowed"
        )}
      >
        Lancer l'agent
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
};

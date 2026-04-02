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
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Job cards — scrollable */}
      <div className="flex-1 overflow-y-auto scrollbar-hide px-4 py-3 space-y-1">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <p className="text-xs text-muted-foreground/50">Aucun poste actif</p>
          </div>
        ) : (
          jobs.map(job => {
            const isSelected = selectedJob?.id === job.id;
            const location = job.location;
            return (
              <button
                key={job.id}
                onClick={() => onSelectJob(isSelected ? null : job)}
                className={cn(
                  "w-full text-left px-3 py-2.5 transition-all duration-150 flex items-center gap-3 border-2",
                  isSelected
                    ? "border-border bg-foreground/[0.03] shadow-[3px_3px_0_0_hsl(var(--brutal-accent)/0.3)]"
                    : "border-transparent hover:border-border"
                )}
              >
                {/* Checkmark */}
                <div className={cn(
                  "h-5 w-5 flex items-center justify-center shrink-0 transition-all duration-150 border-2",
                  isSelected
                    ? "bg-foreground border-border text-background"
                    : "border-border"
                )}>
                  {isSelected && (
                    <Check className="w-3 h-3 animate-scale-in" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-sm font-semibold truncate transition-colors",
                    isSelected ? "text-foreground" : "text-foreground/70"
                  )}>
                    {job.title}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs truncate text-muted-foreground">
                      {job.client?.name || '—'}
                    </p>
                    {location && (
                      <>
                        <span className="text-foreground/15">·</span>
                        <span className="flex items-center gap-0.5 text-xs text-muted-foreground/70 shrink-0">
                          <MapPin className="w-2.5 h-2.5" />
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

      {/* Launch button — pinned bottom */}
      <div className="shrink-0 px-4 py-3 border-t border-border">
        <button
          onClick={onLaunch}
          disabled={!selectedJob}
          className={cn(
            "w-full h-11 text-xs font-bold uppercase tracking-[0.18em] flex items-center justify-center gap-2 border-2 transition-all duration-150",
            selectedJob
              ? "border-border bg-foreground text-background hover:shadow-[4px_4px_0_0_hsl(var(--brutal-accent)/0.5)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
              : "border-border text-muted-foreground/40 cursor-not-allowed"
          )}
        >
          Lancer l'agent
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

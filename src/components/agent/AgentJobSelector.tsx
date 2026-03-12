import React from 'react';
import { Plus, Briefcase, Zap } from 'lucide-react';
import { Job } from '@/types/jobs';
import { cn } from '@/lib/utils';

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
    <div className="p-4 border-b border-foreground/10 space-y-3">
      <div className="flex items-center gap-2">
        <Briefcase className="w-3 h-3 text-muted-foreground" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Nouveau sourcing
        </p>
      </div>

      <select
        value={selectedJob?.id || ''}
        onChange={(e) => {
          const job = jobs.find(j => j.id === e.target.value);
          onSelectJob(job || null);
        }}
        className="w-full h-9 px-3 text-xs border-2 border-foreground bg-background text-foreground focus:outline-none focus:border-brutal-accent transition-colors"
      >
        <option value="">Sélectionner un poste…</option>
        {jobs.map(job => (
          <option key={job.id} value={job.id}>
            {job.title} — {job.client?.name || 'N/A'}
          </option>
        ))}
      </select>

      <button
        onClick={onLaunch}
        disabled={!selectedJob}
        className={cn(
          "w-full h-10 text-[11px] font-bold uppercase tracking-wider border-2 flex items-center justify-center gap-2 transition-all",
          selectedJob
            ? "border-foreground bg-foreground text-background hover:bg-brutal-accent hover:border-brutal-accent hover:text-foreground"
            : "border-muted bg-muted text-muted-foreground cursor-not-allowed"
        )}
      >
        <Zap className="w-3.5 h-3.5" />
        Lancer un agent
      </button>
    </div>
  );
};

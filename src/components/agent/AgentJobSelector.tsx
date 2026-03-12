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
    <div className="px-5 py-4 border-b border-foreground/8 space-y-3">
      <p className="text-xs font-medium text-muted-foreground">
        Nouveau sourcing
      </p>

      <select
        value={selectedJob?.id || ''}
        onChange={(e) => {
          const job = jobs.find(j => j.id === e.target.value);
          onSelectJob(job || null);
        }}
        className="w-full h-10 px-3 text-sm border border-foreground/12 bg-background text-foreground focus:outline-none focus:border-foreground/30 transition-colors"
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
          "w-full h-10 text-sm font-medium flex items-center justify-center gap-2 transition-all",
          selectedJob
            ? "bg-foreground text-background hover:opacity-90"
            : "bg-muted text-muted-foreground/50 cursor-not-allowed"
        )}
      >
        Lancer l'agent
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
};

import React from 'react';
import { motion } from 'framer-motion';
import { FileText, Settings2, Search, Send, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import type { JobDetails } from '@/types/jobDetails';

interface StepConfig {
  value: string;
  label: string;
  icon: typeof FileText;
  getSummary: (project: SourcingProject) => string;
  getCompletion: (project: SourcingProject) => boolean;
}

const steps: StepConfig[] = [
  {
    value: 'brief',
    label: 'Brief',
    icon: FileText,
    getSummary: (p) => {
      const jd = (p.job_details || {}) as JobDetails;
      const fields = [jd.title, jd.mission_description, jd.seniority, jd.location].filter(Boolean);
      return fields.length > 0 ? `${fields.length} champs remplis` : 'À compléter';
    },
    getCompletion: (p) => {
      const jd = (p.job_details || {}) as JobDetails;
      return !!(jd.title && (jd.mission_description || jd.raw_brief));
    },
  },
  {
    value: 'process',
    label: 'Process',
    icon: Settings2,
    getSummary: (p) => {
      const jd = (p.job_details || {}) as JobDetails;
      const steps = (jd as any).process_steps;
      if (Array.isArray(steps) && steps.length > 0) return `${steps.length} étapes`;
      return 'Optionnel';
    },
    getCompletion: (p) => {
      const jd = (p.job_details || {}) as JobDetails;
      return Array.isArray((jd as any).process_steps) && (jd as any).process_steps.length > 0;
    },
  },
  {
    value: 'sourcing',
    label: 'Sourcing',
    icon: Search,
    getSummary: (p) => {
      const total = p.stats_total_found || 0;
      const scored = p.stats_scored || 0;
      if (total === 0) return 'Pas encore sourcé';
      return `${total} trouvés · ${scored} scorés`;
    },
    getCompletion: (p) => (p.stats_total_found || 0) > 0,
  },
  {
    value: 'outreach',
    label: 'Outreach',
    icon: Send,
    getSummary: (p) => {
      const msg = p.stats_messaged || 0;
      if (msg === 0) return 'Aucun message';
      return `${msg} contactés`;
    },
    getCompletion: (p) => (p.stats_messaged || 0) > 0,
  },
];

interface MissionProgressBarProps {
  project: SourcingProject;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export const MissionProgressBar: React.FC<MissionProgressBarProps> = ({
  project,
  activeTab,
  onTabChange,
}) => {
  const activeIndex = steps.findIndex(s => s.value === activeTab);

  return (
    <div className="border border-foreground bg-background mb-0">
      {/* Desktop */}
      <div className="hidden sm:flex items-stretch">
        {steps.map((step, index) => {
          const isActive = activeTab === step.value;
          const isCompleted = step.getCompletion(project);
          const isPast = activeIndex > index;
          const StepIcon = step.icon;
          const summary = step.getSummary(project);

          return (
            <React.Fragment key={step.value}>
              <button
                onClick={() => onTabChange(step.value)}
                className={cn(
                  "relative flex-1 flex items-center gap-3 px-4 py-3 transition-all duration-200 group",
                  isActive && "bg-brutal-accent/20",
                  !isActive && "hover:bg-muted/30",
                  index > 0 && "border-l border-foreground/10"
                )}
              >
                {/* Step number / check */}
                <div
                  className={cn(
                    "relative w-8 h-8 flex items-center justify-center text-xs font-black shrink-0 transition-colors",
                    isCompleted && !isActive
                      ? "bg-green-600 text-white"
                      : isActive
                        ? "bg-foreground text-background"
                        : "border border-foreground/30 text-muted-foreground"
                  )}
                >
                  {isCompleted && !isActive ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                  {isActive && (
                    <motion.div
                      layoutId="active-step-indicator"
                      className="absolute -bottom-[13px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-foreground"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                </div>

                {/* Label + summary */}
                <div className="flex flex-col items-start min-w-0">
                  <span
                    className={cn(
                      "text-[10px] font-black uppercase tracking-wider truncate",
                      isActive ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {step.label}
                  </span>
                  <span className="text-[9px] text-muted-foreground/70 truncate max-w-[140px]">
                    {summary}
                  </span>
                </div>
              </button>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="flex items-center px-0 shrink-0">
                  <div
                    className={cn(
                      "w-0 h-full border-r transition-colors",
                      isPast || (isActive && isCompleted) ? "border-green-600" : "border-foreground/10"
                    )}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Mobile: select dropdown */}
      <div className="sm:hidden p-3">
        <select
          value={activeTab}
          onChange={(e) => onTabChange(e.target.value)}
          className="w-full h-[36px] px-3 text-xs font-bold uppercase tracking-wider border border-foreground bg-background text-foreground"
        >
          {steps.map((step, index) => {
            const isCompleted = step.getCompletion(project);
            return (
              <option key={step.value} value={step.value}>
                {isCompleted ? '✅' : `${index + 1}.`} {step.label} — {step.getSummary(project)}
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );
};

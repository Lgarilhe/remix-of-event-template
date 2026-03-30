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
  emoji: string;
  getSummary: (project: SourcingProject) => string;
  getCompletion: (project: SourcingProject) => boolean;
}

const steps: StepConfig[] = [
  {
    value: 'brief',
    label: 'Brief',
    icon: FileText,
    emoji: '📝',
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
    emoji: '⚙️',
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
    emoji: '🔍',
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
    emoji: '📨',
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
    <div className="border border-foreground bg-background mb-0 relative overflow-hidden">
      {/* Animated accent line at top */}
      <motion.div
        className="absolute top-0 left-0 h-[2px] bg-brutal-accent"
        initial={false}
        animate={{
          width: `${((activeIndex + 1) / steps.length) * 100}%`,
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      />

      {/* Desktop */}
      <div className="hidden sm:flex items-stretch relative">
        {steps.map((step, index) => {
          const isActive = activeTab === step.value;
          const isCompleted = step.getCompletion(project);
          const isPast = activeIndex > index;
          const StepIcon = step.icon;
          const summary = step.getSummary(project);

          return (
            <React.Fragment key={step.value}>
              <motion.button
                onClick={() => onTabChange(step.value)}
                className={cn(
                  "relative flex-1 flex items-center gap-3 px-4 py-3.5 transition-all duration-200 group",
                  index > 0 && "border-l border-foreground/10"
                )}
                whileHover={{ backgroundColor: 'hsl(var(--muted) / 0.4)' }}
                whileTap={{ scale: 0.98 }}
              >
                {/* Active background with glow */}
                {isActive && (
                  <motion.div
                    layoutId="active-step-bg"
                    className="absolute inset-0 bg-brutal-accent/10"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  >
                    {/* Inner glow */}
                    <div className="absolute inset-0 bg-gradient-to-r from-brutal-accent/5 via-brutal-accent/10 to-brutal-accent/5" />
                  </motion.div>
                )}

                {/* Step indicator */}
                <div className="relative z-10">
                  <motion.div
                    className={cn(
                      "relative w-9 h-9 flex items-center justify-center text-xs font-black shrink-0 transition-colors",
                      isCompleted && !isActive
                        ? "bg-green-600 text-background"
                        : isActive
                          ? "bg-foreground text-background"
                          : "border border-foreground/30 text-muted-foreground group-hover:border-foreground/50"
                    )}
                    whileHover={!isActive ? { scale: 1.1 } : undefined}
                    animate={isActive ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                    transition={isActive ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
                  >
                    {isCompleted && !isActive ? (
                      <motion.div
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: 'spring', stiffness: 300 }}
                      >
                        <Check className="w-4 h-4" />
                      </motion.div>
                    ) : (
                      <span>{index + 1}</span>
                    )}

                    {/* Active pulse ring */}
                    {isActive && (
                      <motion.div
                        className="absolute inset-0 border-2 border-brutal-accent"
                        animate={{ scale: [1, 1.4, 1.4], opacity: [0.6, 0, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                      />
                    )}
                  </motion.div>

                  {/* Active indicator arrow */}
                  {isActive && (
                    <motion.div
                      layoutId="active-step-arrow"
                      className="absolute -bottom-[15px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-foreground"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                </div>

                {/* Label + summary */}
                <div className="relative z-10 flex flex-col items-start min-w-0">
                  <span
                    className={cn(
                      "text-[10px] font-black uppercase tracking-wider truncate transition-colors",
                      isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                    )}
                  >
                    {step.label}
                  </span>
                  <motion.span
                    className="text-[9px] text-muted-foreground/70 truncate max-w-[140px]"
                    key={summary}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    {summary}
                  </motion.span>
                </div>
              </motion.button>
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

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
      const fields = [jd.title, jd.mission_description, jd.seniority, jd.location, jd.contract_type, jd.remote_policy, jd.client?.name, jd.salary_min, jd.experience_min, (jd.skills_must_have?.length || 0) > 0 ? 'skills' : null, jd.context || jd.mission_description].filter(Boolean);
      const total = 11;
      return fields.length > 0 ? `${fields.length}/${total} champs` : 'À compléter';
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
      if (Array.isArray(steps) && steps.length > 0) return `${steps.length} étapes définies`;
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
      if (scored > 0) return `${total} trouvés · ${scored} scorés`;
      return `${total} candidats trouvés`;
    },
    getCompletion: (p) => (p.stats_total_found || 0) > 0,
  },
  {
    value: 'outreach',
    label: 'Outreach',
    icon: Send,
    getSummary: (p) => {
      const msg = p.stats_messaged || 0;
      if (msg === 0) return 'Aucun message envoyé';
      return `${msg} candidats contactés`;
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
      {/* Animated progress line at top */}
      <motion.div
        className="absolute top-0 left-0 h-[2px] z-20"
        style={{ background: 'linear-gradient(90deg, hsl(var(--brutal-accent)), hsl(var(--brutal-accent) / 0.5))' }}
        initial={false}
        animate={{ width: `${((activeIndex + 1) / steps.length) * 100}%` }}
        transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      />

      {/* Desktop */}
      <div className="hidden sm:flex items-stretch relative">
        {steps.map((step, index) => {
          const isActive = activeTab === step.value;
          const isCompleted = step.getCompletion(project);
          const StepIcon = step.icon;
          const summary = step.getSummary(project);

          return (
            <React.Fragment key={step.value}>
              <button
                onClick={() => onTabChange(step.value)}
                className={cn(
                  "relative flex-1 flex items-center gap-3 px-4 py-3.5 transition-all duration-200 group overflow-hidden",
                  index > 0 && "border-l border-foreground/10"
                )}
              >
                {/* Active background */}
                {isActive && (
                  <motion.div
                    layoutId="step-active-bg"
                    className="absolute inset-0"
                    style={{ background: 'hsl(var(--brutal-accent) / 0.15)' }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}

                {/* Pulse ring for active */}
                {isActive && (
                  <motion.div
                    className="absolute inset-0 border-2 border-brutal-accent/20"
                    animate={{ opacity: [0.3, 0, 0.3] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}

                {/* Step number/check */}
                <div className="relative z-10">
                  <motion.div
                    className={cn(
                      "relative w-9 h-9 flex items-center justify-center text-xs font-black shrink-0 transition-colors",
                      isCompleted && !isActive
                        ? "text-background"
                        : isActive
                          ? "bg-foreground text-background"
                          : "border border-foreground/30 text-muted-foreground group-hover:border-foreground/50"
                    )}
                    style={isCompleted && !isActive ? { background: 'hsl(142 71% 45%)' } : undefined}
                    animate={isActive ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                    transition={isActive ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
                  >
                    {isCompleted && !isActive ? (
                      <motion.div
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                      >
                        <Check className="w-4 h-4" />
                      </motion.div>
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </motion.div>

                  {/* Active bottom arrow */}
                  {isActive && (
                    <motion.div
                      layoutId="step-arrow"
                      className="absolute -bottom-[16px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-foreground"
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
                    className="text-[9px] text-muted-foreground/70 truncate max-w-[160px]"
                    key={summary}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    {summary}
                  </motion.span>
                </div>
              </button>

              {/* Animated connector line */}
              {index < steps.length - 1 && (
                <div className="flex items-center w-0 shrink-0 relative">
                  {/* Filled connector for completed steps */}
                  <motion.div
                    className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2"
                    style={{ background: 'hsl(142 71% 45%)' }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: isCompleted ? 1 : 0 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Mobile dropdown */}
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

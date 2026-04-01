import React from 'react';
import { motion } from 'framer-motion';
import { FileText, Settings2, Search, Send, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { countBriefFields } from '@/lib/missionUtils';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import type { JobDetails } from '@/types/jobDetails';

/* ─── Step configuration ─── */

interface StepConfig {
  value: string;
  label: string;
  icon: typeof FileText;
  getSubtitle: (project: SourcingProject) => string;
  getCompletion: (project: SourcingProject) => boolean;
}

const steps: StepConfig[] = [
  {
    value: 'brief',
    label: 'Brief',
    icon: FileText,
    getSubtitle: (p) => {
      const { filled, total } = countBriefFields((p.job_details || {}) as JobDetails);
      return `${filled}/${total}`;
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
    getSubtitle: (p) => {
      const s = ((p.job_details || {}) as any).process_steps;
      return Array.isArray(s) && s.length > 0 ? `${s.length}` : '—';
    },
    getCompletion: (p) => {
      return Array.isArray(((p.job_details || {}) as any).process_steps) && ((p.job_details || {}) as any).process_steps.length > 0;
    },
  },
  {
    value: 'sourcing',
    label: 'Sourcing',
    icon: Search,
    getSubtitle: (p) => {
      const t = p.stats_total_found || 0;
      return t > 0 ? `${t}` : '—';
    },
    getCompletion: (p) => (p.stats_total_found || 0) > 0,
  },
  {
    value: 'outreach',
    label: 'Outreach',
    icon: Send,
    getSubtitle: (p) => {
      const m = p.stats_messaged || 0;
      return m > 0 ? `${m}` : '—';
    },
    getCompletion: (p) => (p.stats_messaged || 0) > 0,
  },
];

/* ═══════════════════════════════════════════════════
   MAIN COMPONENT — Compact inline tab bar
   ═══════════════════════════════════════════════════ */

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
  return (
    <div className="border border-foreground bg-background mb-0 relative">
      {/* ── Desktop ── */}
      <div className="hidden sm:flex items-stretch h-[42px]">
        {steps.map((step, index) => {
          const isActive = activeTab === step.value;
          const isCompleted = step.getCompletion(project);
          const Icon = step.icon;

          return (
            <button
              key={step.value}
              onClick={() => onTabChange(step.value)}
              className={cn(
                "relative flex items-center gap-2 px-4 transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brutal-accent focus-visible:ring-inset",
                index > 0 && "border-l border-foreground/10",
                isActive
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
              )}
            >
              {/* Step number or check */}
              {isCompleted && !isActive ? (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="w-5 h-5 flex items-center justify-center shrink-0"
                  style={{ color: isActive ? undefined : 'hsl(142 71% 45%)' }}
                >
                  <Check className="w-3.5 h-3.5" />
                </motion.div>
              ) : (
                <div className={cn(
                  "w-5 h-5 flex items-center justify-center shrink-0",
                  isActive ? "text-background" : "text-muted-foreground"
                )}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
              )}

              {/* Label */}
              <span className={cn(
                "text-xs font-bold uppercase tracking-wider whitespace-nowrap",
                isActive ? "text-background" : ""
              )}>
                {step.label}
              </span>

              {/* Subtle counter */}
              <span className={cn(
                "text-[10px] font-medium tabular-nums opacity-60",
                isActive ? "text-background" : ""
              )}>
                {step.getSubtitle(project)}
              </span>

              {/* Active indicator — bottom accent line */}
              {isActive && (
                <motion.div
                  layoutId="activeStepIndicator"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-brutal-accent"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>
          );
        })}

        {/* Spacer to fill remaining width */}
        <div className="flex-1" />
      </div>

      {/* ── Mobile: compact chips ── */}
      <div className="sm:hidden flex items-center gap-0 overflow-x-auto scrollbar-hide">
        {steps.map((step, index) => {
          const isActive = activeTab === step.value;
          const isCompleted = step.getCompletion(project);

          return (
            <button
              key={step.value}
              onClick={() => onTabChange(step.value)}
              className={cn(
                "flex items-center gap-1.5 h-[38px] px-3 shrink-0 transition-colors",
                "text-xs font-bold uppercase tracking-wider",
                index > 0 && "border-l border-foreground/10",
                isActive
                  ? "bg-foreground text-background"
                  : isCompleted
                    ? "text-foreground/80"
                    : "text-muted-foreground"
              )}
            >
              {isCompleted && !isActive ? (
                <Check className="w-3 h-3 text-green-500" />
              ) : (
                <step.icon className="w-3 h-3" />
              )}
              <span>{step.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

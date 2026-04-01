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

/* ─── Secondary tabs ─── */

const secondarySteps = [
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'insights', label: 'Insights' },
  { value: 'config', label: 'Config' },
];

/* ═══════════════════════════════════════════════════
   MAIN — Linear-style unified tab bar
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
    <div className="relative">
      {/* ── Desktop ── */}
      <div className="hidden sm:flex items-center gap-1 border-b border-border">
        {/* Primary steps */}
        {steps.map((step) => {
          const isActive = activeTab === step.value;
          const isCompleted = step.getCompletion(project);
          const Icon = step.icon;

          return (
            <button
              key={step.value}
              onClick={() => onTabChange(step.value)}
              className={cn(
                "relative flex items-center gap-2 px-3 py-2 transition-colors rounded-md",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              {isCompleted && !isActive ? (
                <Check className="w-3.5 h-3.5 text-primary" />
              ) : (
                <Icon className={cn("w-3.5 h-3.5", isActive ? "text-foreground" : "")} />
              )}

              <span className={cn(
                "text-[13px] font-medium whitespace-nowrap",
                isActive ? "text-foreground" : ""
              )}>
                {step.label}
              </span>

              {step.getSubtitle(project) !== '—' && (
                <span className={cn(
                  "text-[11px] tabular-nums px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground",
                  isActive && "bg-primary/10 text-primary"
                )}>
                  {step.getSubtitle(project)}
                </span>
              )}

              {/* Active indicator */}
              {isActive && (
                <motion.div
                  layoutId="missionTabIndicator"
                  className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>
          );
        })}

        {/* Separator */}
        <div className="w-px h-4 bg-border mx-1" />

        {/* Secondary tabs */}
        {secondarySteps.map((tab) => {
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => onTabChange(tab.value)}
              className={cn(
                "relative flex items-center px-3 py-2 transition-colors rounded-md",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <span className={cn("text-[13px] font-medium whitespace-nowrap")}>
                {tab.label}
              </span>

              {isActive && (
                <motion.div
                  layoutId="missionTabIndicator"
                  className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Mobile: scrollable chips ── */}
      <div className="sm:hidden flex items-center gap-0.5 overflow-x-auto scrollbar-hide border-b border-border px-1">
        {[...steps.map(s => ({ value: s.value, label: s.label })), ...secondarySteps].map((tab) => {
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => onTabChange(tab.value)}
              className={cn(
                "relative flex items-center gap-1 h-9 px-3 shrink-0 transition-colors rounded-md",
                "text-[13px] font-medium",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              <span>{tab.label}</span>
              {isActive && (
                <motion.div
                  layoutId="missionTabIndicatorMobile"
                  className="absolute bottom-0 left-1 right-1 h-[2px] bg-primary rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

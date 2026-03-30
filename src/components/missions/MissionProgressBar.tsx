import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Settings2, Search, Send, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { countBriefFields } from '@/lib/missionUtils';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { NumberTicker } from '@/components/magicui/number-ticker';
import type { JobDetails } from '@/types/jobDetails';

/* ─── Step configuration ─── */

interface StepConfig {
  value: string;
  label: string;
  icon: typeof FileText;
  getFilledCount: (project: SourcingProject) => number;
  getTotalCount: (project: SourcingProject) => number;
  getSummary: (project: SourcingProject) => React.ReactNode;
  getCompletion: (project: SourcingProject) => boolean;
}

const steps: StepConfig[] = [
  {
    value: 'brief',
    label: 'Brief',
    icon: FileText,
    getFilledCount: (p) => countBriefFields((p.job_details || {}) as JobDetails).filled,
    getTotalCount: (p) => countBriefFields((p.job_details || {}) as JobDetails).total,
    getSummary: (p) => {
      const { filled, total } = countBriefFields((p.job_details || {}) as JobDetails);
      return (
        <span className="flex items-center gap-1.5">
          <NumberTicker value={filled} className="font-bold text-foreground" />
          <span>/{total} champs</span>
          <MiniProgressBar value={filled} max={total} />
        </span>
      );
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
    getFilledCount: (p) => {
      const jd = (p.job_details || {}) as JobDetails;
      const s = (jd as any).process_steps;
      return Array.isArray(s) ? s.length : 0;
    },
    getTotalCount: () => 0,
    getSummary: (p) => {
      const jd = (p.job_details || {}) as JobDetails;
      const s = (jd as any).process_steps;
      if (Array.isArray(s) && s.length > 0) {
        return (
          <span className="flex items-center gap-1">
            <NumberTicker value={s.length} className="font-bold text-foreground" />
            <span>etapes definies</span>
          </span>
        );
      }
      return <span className="italic">Optionnel</span>;
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
    getFilledCount: (p) => p.stats_total_found || 0,
    getTotalCount: () => 0,
    getSummary: (p) => {
      const total = p.stats_total_found || 0;
      if (total === 0) return <span>Pas encore source</span>;
      return (
        <span className="flex items-center gap-1">
          <NumberTicker value={total} className="font-bold text-foreground" />
          <span>candidats sources</span>
        </span>
      );
    },
    getCompletion: (p) => (p.stats_total_found || 0) > 0,
  },
  {
    value: 'outreach',
    label: 'Outreach',
    icon: Send,
    getFilledCount: (p) => p.stats_messaged || 0,
    getTotalCount: () => 0,
    getSummary: (p) => {
      const msg = p.stats_messaged || 0;
      if (msg === 0) return <span>Aucun message</span>;
      return (
        <span className="flex items-center gap-1">
          <NumberTicker value={msg} className="font-bold text-foreground" />
          <span>messages envoyes</span>
        </span>
      );
    },
    getCompletion: (p) => (p.stats_messaged || 0) > 0,
  },
];

/* ─── Mini progress bar for Brief ─── */

const MiniProgressBar: React.FC<{ value: number; max: number }> = ({ value, max }) => {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-12 h-1.5 bg-foreground/10 overflow-hidden ml-1">
      <motion.div
        className="h-full"
        style={{ background: pct >= 80 ? 'hsl(142 71% 45%)' : 'hsl(var(--brutal-accent))' }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' as const }}
      />
    </div>
  );
};

/* ─── Connector line between steps ─── */

const ConnectorLine: React.FC<{ filled: boolean; index: number }> = ({ filled, index }) => (
  <div className="flex-1 flex items-center px-0 min-w-[20px] sm:min-w-[32px]">
    <div className="w-full h-[2px] bg-foreground/10 relative overflow-hidden">
      <motion.div
        className="absolute inset-y-0 left-0"
        style={{
          background: 'linear-gradient(90deg, hsl(142 71% 45%), hsl(var(--brutal-accent)))',
        }}
        initial={{ width: '0%' }}
        animate={{ width: filled ? '100%' : '0%' }}
        transition={{ duration: 0.6, delay: index * 0.15, ease: 'easeOut' as const }}
      />
    </div>
  </div>
);

/* ─── Step circle ─── */

const StepCircle: React.FC<{
  index: number;
  isActive: boolean;
  isCompleted: boolean;
  icon: typeof FileText;
}> = ({ index, isActive, isCompleted, icon: Icon }) => {
  if (isCompleted && !isActive) {
    return (
      <motion.div
        className="relative w-10 h-10 flex items-center justify-center text-background shrink-0"
        style={{ background: 'hsl(142 71% 45%)' }}
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 15 }}
      >
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.1 }}
        >
          <Check className="w-4.5 h-4.5" />
        </motion.div>
      </motion.div>
    );
  }

  if (isActive) {
    return (
      <div className="relative w-10 h-10 shrink-0">
        {/* Pulse rings */}
        <motion.div
          className="absolute inset-[-4px] border-2 border-brutal-accent/30"
          animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' as const }}
        />
        <motion.div
          className="absolute inset-[-8px] border border-brutal-accent/15"
          animate={{ scale: [1, 1.3, 1], opacity: [0.2, 0, 0.2] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' as const, delay: 0.3 }}
        />
        <div
          className="relative w-full h-full flex items-center justify-center text-background"
          style={{ background: 'hsl(var(--brutal-accent))' }}
        >
          <Icon className="w-4.5 h-4.5" />
        </div>
      </div>
    );
  }

  // Future step
  return (
    <div className="w-10 h-10 flex items-center justify-center border border-foreground/20 text-muted-foreground shrink-0 transition-colors group-hover:border-foreground/40">
      <span className="text-xs font-black">{index + 1}</span>
    </div>
  );
};

/* ═══════════════════════════════════════════════════
   MAIN COMPONENT
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
    <div className="border border-foreground bg-background/80 backdrop-blur-sm mb-0 relative overflow-hidden">
      {/* ── Desktop: horizontal stepper ── */}
      <div className="hidden sm:flex items-center px-6 py-4 gap-0">
        {steps.map((step, index) => {
          const isActive = activeTab === step.value;
          const isCompleted = step.getCompletion(project);
          const isPast = steps.slice(0, index).every(s => s.getCompletion(project));

          return (
            <React.Fragment key={step.value}>
              {/* Connector before (except first) */}
              {index > 0 && (
                <ConnectorLine
                  filled={isCompleted || (isPast && isActive)}
                  index={index}
                />
              )}

              {/* Step */}
              <button
                onClick={() => onTabChange(step.value)}
                className={cn(
                  "group flex items-center gap-3 px-3 py-1.5 transition-all duration-200 shrink-0",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brutal-accent",
                  isActive && "relative"
                )}
              >
                <StepCircle
                  index={index}
                  isActive={isActive}
                  isCompleted={isCompleted}
                  icon={step.icon}
                />
                <div className="flex flex-col items-start min-w-0">
                  <span
                    className={cn(
                      "text-[10px] font-black uppercase tracking-wider transition-colors whitespace-nowrap",
                      isActive
                        ? "text-foreground"
                        : isCompleted
                          ? "text-foreground/80"
                          : "text-muted-foreground group-hover:text-foreground"
                    )}
                  >
                    {step.label}
                  </span>
                  <span className="text-[9px] text-muted-foreground/70 whitespace-nowrap">
                    {step.getSummary(project)}
                  </span>
                </div>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Mobile: compact horizontal chips ── */}
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
                "text-[10px] font-bold uppercase tracking-wider",
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

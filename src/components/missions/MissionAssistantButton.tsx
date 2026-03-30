import React from 'react';
import { Bot } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAgent, AgentContextMode } from '@/contexts/AgentContext';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { AGENT_TAB_CONFIG } from '@/lib/missionAgentConfig';
import { cn } from '@/lib/utils';
import type { JobDetails } from '@/types/jobDetails';

interface MissionAssistantButtonProps {
  project: SourcingProject;
  mode: AgentContextMode;
  pulse?: boolean;
  className?: string;
}

export const MissionAssistantButton: React.FC<MissionAssistantButtonProps> = ({
  project,
  mode,
  pulse = false,
  className,
}) => {
  const { openContextualAgent, isOpen } = useAgent();
  const config = AGENT_TAB_CONFIG[mode || 'brief'];

  if (!config || isOpen) return null;

  const jd = (project.job_details ?? {}) as JobDetails;
  const name = jd.title || project.name || '';

  const handleClick = () => {
    openContextualAgent({
      mode,
      briefContext: project.job_details as Record<string, unknown> ?? {},
      initialMessage: config.buildShortPrompt(name),
      job: undefined,
    });
  };

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      onClick={handleClick}
      className={cn(
        "flex items-center gap-2 h-[36px] px-4",
        "bg-foreground text-background border-2 border-foreground",
        "text-[10px] font-bold uppercase tracking-wider",
        "shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))]",
        "hover:shadow-[5px_5px_0px_0px_hsl(var(--brutal-accent))]",
        "hover:-translate-x-0.5 hover:-translate-y-0.5",
        "transition-all duration-200",
        pulse && "animate-pulse",
        className,
      )}
    >
      <Bot className="w-4 h-4 shrink-0" />
      <span>{config.label}</span>
    </motion.button>
  );
};

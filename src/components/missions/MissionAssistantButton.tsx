import React from 'react';
import { Bot } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAgent, AgentContextMode } from '@/contexts/AgentContext';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { cn } from '@/lib/utils';
import type { JobDetails } from '@/types/jobDetails';

const MODE_CONFIG: Record<string, { label: string; buildMessage: (name: string) => string }> = {
  brief: {
    label: 'Discuter avec l\'assistant IA',
    buildMessage: (name) => `Aide-moi à compléter mon brief pour le poste ${name}. Voici ce qui est déjà rempli, dis-moi ce qui manque et pose-moi des questions pour compléter.`,
  },
  process: {
    label: 'Suggérer un process d\'évaluation',
    buildMessage: (name) => `Suggère-moi un process d'évaluation adapté pour "${name}"`,
  },
  sourcing: {
    label: 'Aide-moi à sourcer des candidats',
    buildMessage: (name) => `Aide-moi à définir une stratégie de sourcing pour "${name}"`,
  },
  outreach: {
    label: 'Aide-moi à rédiger mes messages',
    buildMessage: (name) => `Aide-moi à rédiger des messages d'approche pour "${name}"`,
  },
};

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
  const config = MODE_CONFIG[mode || 'brief'];

  if (!config || isOpen) return null;

  const jd = (project.job_details ?? {}) as JobDetails;
  const name = jd.title || project.name || '';

  const handleClick = () => {
    openContextualAgent({
      mode,
      briefContext: project.job_details as Record<string, unknown> ?? {},
      initialMessage: config.buildMessage(name),
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

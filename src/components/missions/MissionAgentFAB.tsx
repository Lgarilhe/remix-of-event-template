import React, { useMemo } from 'react';
import { Bot } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgent } from '@/contexts/AgentContext';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { cn } from '@/lib/utils';

const TAB_CONFIG: Record<string, { label: string; prompt: (p: SourcingProject) => string }> = {
  brief: {
    label: 'Aide-moi à rédiger mon brief',
    prompt: (p) =>
      `Je travaille sur la mission "${p.name}"${p.client_name ? ` pour ${p.client_name}` : ''}. Aide-moi à structurer et compléter le brief de cette mission.${p.description ? `\n\nBrief actuel :\n${p.description.slice(0, 500)}` : ''}`,
  },
  process: {
    label: "Suggère un process d'évaluation",
    prompt: (p) =>
      `Je travaille sur la mission "${p.name}"${p.client_name ? ` pour ${p.client_name}` : ''}. Suggère-moi un process d'évaluation adapté à ce poste.${p.description ? `\n\nBrief :\n${p.description.slice(0, 300)}` : ''}`,
  },
  sourcing: {
    label: 'Aide-moi à trouver des candidats',
    prompt: (p) =>
      `Je travaille sur la mission "${p.name}"${p.client_name ? ` pour ${p.client_name}` : ''}. Aide-moi à définir une stratégie de sourcing efficace pour ce poste.${p.description ? `\n\nBrief :\n${p.description.slice(0, 300)}` : ''}`,
  },
  outreach: {
    label: 'Aide-moi à rédiger mes messages',
    prompt: (p) =>
      `Je travaille sur la mission "${p.name}"${p.client_name ? ` pour ${p.client_name}` : ''}. Aide-moi à rédiger des messages d'approche personnalisés pour contacter les candidats.${p.description ? `\n\nBrief :\n${p.description.slice(0, 300)}` : ''}`,
  },
};

interface MissionAgentFABProps {
  project: SourcingProject;
  activeTab: string;
  isEmpty?: boolean;
}

export const MissionAgentFAB: React.FC<MissionAgentFABProps> = ({
  project,
  activeTab,
  isEmpty = false,
}) => {
  const { isOpen, openAgentWithMessage } = useAgent();

  const config = TAB_CONFIG[activeTab];

  if (!config || isOpen) return null;

  const handleClick = () => {
    openAgentWithMessage(config.prompt(project));
  };

  return (
    <AnimatePresence>
      <motion.button
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        onClick={handleClick}
        className={cn(
          "fixed bottom-6 right-6 z-[1800] flex items-center gap-2",
          "h-10 sm:h-11 px-4 sm:px-5",
          "bg-foreground text-background border-2 border-foreground",
          "text-[10px] sm:text-xs font-bold uppercase tracking-wider",
          "shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))]",
          "hover:shadow-[5px_5px_0px_0px_hsl(var(--brutal-accent))]",
          "hover:-translate-x-0.5 hover:-translate-y-0.5",
          "transition-all duration-200",
          "touch-manipulation",
          isEmpty && "animate-pulse",
        )}
        style={{ WebkitTapHighlightColor: 'transparent' }}
        aria-label={config.label}
      >
        <Bot className="w-4 h-4 shrink-0" />
        <span className="hidden sm:inline">{config.label}</span>
        <span className="sm:hidden">Assistant IA</span>
      </motion.button>
    </AnimatePresence>
  );
};

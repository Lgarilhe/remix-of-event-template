import React, { useMemo } from 'react';
import { Bot } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgent } from '@/contexts/AgentContext';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { cn } from '@/lib/utils';
import type { JobDetails } from '@/types/jobDetails';

function buildBriefContext(p: SourcingProject): string {
  const jd = (p.job_details ?? {}) as JobDetails;
  const parts: string[] = [];
  if (jd.title) parts.push(`Poste : ${jd.title}`);
  if (jd.client?.name) parts.push(`Client : ${jd.client.name}`);
  if (jd.client?.sector) parts.push(`Secteur : ${jd.client.sector}`);
  if (jd.location) parts.push(`Localisation : ${jd.location}`);
  if (jd.contract_type) parts.push(`Contrat : ${jd.contract_type}`);
  if (jd.skills_must_have?.length) parts.push(`Compétences clés : ${jd.skills_must_have.join(', ')}`);
  if (jd.experience_min || jd.experience_max) parts.push(`Expérience : ${jd.experience_min ?? '?'}–${jd.experience_max ?? '?'} ans`);
  if (jd.mission_description) parts.push(`Description : ${jd.mission_description.slice(0, 300)}`);
  return parts.length > 0 ? `\n\nDonnées du brief :\n${parts.join('\n')}` : '';
}

const TAB_CONFIG: Record<string, { label: string; prompt: (p: SourcingProject) => string }> = {
  brief: {
    label: '💬 Discuter avec l\'assistant',
    prompt: (p) =>
      `Je vois que vous travaillez sur "${p.name}"${p.client_name ? ` pour ${p.client_name}` : ''}. Je peux vous aider à compléter votre brief. Que souhaitez-vous définir ?${buildBriefContext(p)}`,
  },
  process: {
    label: "Suggère un process d'évaluation",
    prompt: (p) =>
      `Je travaille sur la mission "${p.name}"${p.client_name ? ` pour ${p.client_name}` : ''}. Suggère-moi un process d'évaluation adapté à ce poste.${buildBriefContext(p)}`,
  },
  sourcing: {
    label: 'Aide-moi à trouver des candidats',
    prompt: (p) =>
      `Je travaille sur la mission "${p.name}"${p.client_name ? ` pour ${p.client_name}` : ''}. Aide-moi à définir une stratégie de sourcing efficace pour ce poste.${buildBriefContext(p)}`,
  },
  outreach: {
    label: 'Aide-moi à rédiger mes messages',
    prompt: (p) =>
      `Je travaille sur la mission "${p.name}"${p.client_name ? ` pour ${p.client_name}` : ''}. Aide-moi à rédiger des messages d'approche personnalisés pour contacter les candidats.${buildBriefContext(p)}`,
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

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, MessageSquare, X } from 'lucide-react';
import { useAgent } from '@/contexts/AgentContext';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { cn } from '@/lib/utils';
import type { JobDetails } from '@/types/jobDetails';

function buildBriefSummary(p: SourcingProject): string {
  const jd = (p.job_details ?? {}) as JobDetails;
  const parts: string[] = [];
  if (jd.title) parts.push(`Poste : ${jd.title}`);
  if (jd.client?.name) parts.push(`Client : ${jd.client.name}`);
  if (jd.skills_must_have?.length) parts.push(`Compétences : ${jd.skills_must_have.join(', ')}`);
  return parts.length > 0 ? `\n\nBrief actuel :\n${parts.join('\n')}` : '';
}

const HELP_CONFIG: Record<string, { title: string; description: string; cta: string; prompt: (p: SourcingProject) => string }> = {
  brief: {
    title: "L'assistant Konekt peut vous aider",
    description: 'Décrivez votre besoin en quelques mots et je structure votre brief automatiquement.',
    cta: '💬 Discuter avec l\'assistant',
    prompt: (p) =>
      `Je vois que vous travaillez sur "${p.name}"${p.client_name ? ` pour ${p.client_name}` : ''}. Je peux vous aider à compléter votre brief. Que souhaitez-vous définir ?${buildBriefSummary(p)}`,
  },
  process: {
    title: "Besoin d'un process d'évaluation ?",
    description: 'Décrivez le profil recherché et je vous propose un process structuré avec grille de scoring.',
    cta: 'Créer mon process avec l\'IA',
    prompt: (p) =>
      `Je travaille sur la mission "${p.name}". Propose-moi un process d'évaluation complet avec les étapes et critères de scoring.`,
  },
  sourcing: {
    title: 'Lancez votre recherche de candidats',
    description: 'Décrivez le profil idéal et je configure les filtres de sourcing automatiquement.',
    cta: 'Configurer avec l\'assistant',
    prompt: (p) =>
      `Je travaille sur la mission "${p.name}". Aide-moi à définir les meilleurs filtres de recherche LinkedIn pour ce poste.`,
  },
  outreach: {
    title: 'Rédigez vos messages d\'approche',
    description: 'Je personnalise chaque message selon le profil du candidat et le poste à pourvoir.',
    cta: 'Rédiger avec l\'assistant',
    prompt: (p) =>
      `Je travaille sur la mission "${p.name}". Aide-moi à rédiger un premier message d'approche LinkedIn personnalisé.`,
  },
};

interface MissionAgentHelpCardProps {
  project: SourcingProject;
  activeTab: string;
  className?: string;
}

export const MissionAgentHelpCard: React.FC<MissionAgentHelpCardProps> = ({
  project,
  activeTab,
  className,
}) => {
  const storageKey = `agent-help-dismissed:${activeTab}`;
  const [dismissed, setDismissed] = React.useState(
    () => localStorage.getItem(storageKey) === 'true'
  );

  const { openAgentWithMessage } = useAgent();
  const config = HELP_CONFIG[activeTab];

  if (!config || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(storageKey, 'true');
  };

  const handleStart = () => {
    openAgentWithMessage(config.prompt(project));
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={cn(
          "border border-foreground/15 border-l-4 border-l-brutal-accent bg-brutal-accent/5 overflow-hidden",
          className
        )}
      >
        <div className="flex items-start gap-3 p-4">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, delay: 0.15 }}
            className="w-8 h-8 bg-foreground text-background flex items-center justify-center shrink-0"
          >
            <Bot className="w-4 h-4" />
          </motion.div>

          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-wider text-foreground mb-1">
              🤖 {config.title}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              "{config.description}"
            </p>

            <button
              onClick={handleStart}
              className="relative overflow-hidden inline-flex items-center gap-1.5 h-[30px] px-4 bg-foreground text-background text-[10px] font-bold uppercase tracking-wider border border-foreground group"
            >
              <MessageSquare className="w-3 h-3 relative z-10" />
              <span className="relative z-10">{config.cta}</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            </button>
          </div>

          <button
            onClick={handleDismiss}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

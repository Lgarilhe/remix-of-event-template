import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { buildBriefContext } from './missionUtils';

/**
 * Centralised AI agent configuration for all mission tabs.
 * Used by MissionAgentFAB, MissionAgentHelpCard, and MissionAssistantButton.
 */

export interface AgentTabConfig {
  /** Short label for buttons / FAB */
  label: string;
  /** Longer title for the help card */
  helpTitle: string;
  /** Description shown in help card */
  helpDescription: string;
  /** CTA text for help card button */
  helpCta: string;
  /** Build the full prompt sent to the agent */
  buildPrompt: (project: SourcingProject) => string;
  /** Build a shorter prompt (used by inline assistant button) */
  buildShortPrompt: (name: string) => string;
}

export const AGENT_TAB_CONFIG: Record<string, AgentTabConfig> = {
  brief: {
    label: 'Discuter avec l\'assistant IA',
    helpTitle: 'L\'assistant Konekt peut vous aider',
    helpDescription: 'Décrivez votre besoin en quelques mots et je structure votre brief automatiquement.',
    helpCta: 'Discuter avec l\'assistant',
    buildPrompt: (p) =>
      `Je vois que vous travaillez sur "${p.name}"${p.client_name ? ` pour ${p.client_name}` : ''}. Je peux vous aider à compléter votre brief. Que souhaitez-vous définir ?${buildBriefContext(p)}`,
    buildShortPrompt: (name) =>
      `Aide-moi à compléter mon brief pour le poste ${name}. Voici ce qui est déjà rempli, dis-moi ce qui manque et pose-moi des questions pour compléter.`,
  },
  process: {
    label: 'Suggérer un process d\'évaluation',
    helpTitle: 'Besoin d\'un process d\'évaluation ?',
    helpDescription: 'Décrivez le profil recherché et je vous propose un process structuré avec grille de scoring.',
    helpCta: 'Créer mon process avec l\'IA',
    buildPrompt: (p) =>
      `Je travaille sur la mission "${p.name}"${p.client_name ? ` pour ${p.client_name}` : ''}. Suggère-moi un process d'évaluation adapté à ce poste.${buildBriefContext(p)}`,
    buildShortPrompt: (name) =>
      `Suggère-moi un process d'évaluation adapté pour "${name}"`,
  },
  sourcing: {
    label: 'Aide-moi à sourcer des candidats',
    helpTitle: 'Lancez votre recherche de candidats',
    helpDescription: 'Décrivez le profil idéal et je configure les filtres de sourcing automatiquement.',
    helpCta: 'Configurer avec l\'assistant',
    buildPrompt: (p) =>
      `Je travaille sur la mission "${p.name}"${p.client_name ? ` pour ${p.client_name}` : ''}. Aide-moi à définir une stratégie de sourcing efficace pour ce poste.${buildBriefContext(p)}`,
    buildShortPrompt: (name) =>
      `Aide-moi à définir une stratégie de sourcing pour "${name}"`,
  },
  outreach: {
    label: 'Aide-moi à rédiger mes messages',
    helpTitle: 'Rédigez vos messages d\'approche',
    helpDescription: 'Je personnalise chaque message selon le profil du candidat et le poste à pourvoir.',
    helpCta: 'Rédiger avec l\'assistant',
    buildPrompt: (p) =>
      `Je travaille sur la mission "${p.name}"${p.client_name ? ` pour ${p.client_name}` : ''}. Aide-moi à rédiger des messages d'approche personnalisés pour contacter les candidats.${buildBriefContext(p)}`,
    buildShortPrompt: (name) =>
      `Aide-moi à rédiger des messages d'approche pour "${name}"`,
  },
};

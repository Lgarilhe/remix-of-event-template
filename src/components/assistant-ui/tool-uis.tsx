import React from 'react';
import { makeAssistantToolUI } from '@assistant-ui/react';

/** Labels français des tools du copilot (reads + mutations + sourcing) */
const TOOL_CHIP_LABELS: Record<string, string> = {
  // Reads (omniscience)
  get_my_missions: 'Lecture des missions',
  get_mission_overview: 'Lecture de la mission',
  get_mission_brief: 'Lecture du brief',
  get_mission_candidates: 'Lecture des candidats',
  get_mission_process: 'Lecture du process',
  get_sequences_status: 'Lecture des séquences',
  get_candidate_detail: 'Lecture du profil candidat',
  get_upcoming_interviews: 'Lecture des entretiens',
  get_candidate_outreach: 'Lecture de la prospection',
  get_linkedin_thread: 'Lecture du fil LinkedIn',
  search_knowledge: 'Recherche sémantique',
  get_vivier_overview: 'Lecture du vivier',
  get_org_analytics: 'Lecture des statistiques',
  get_team_overview: "Lecture de l'équipe",
  get_recent_agent_actions: 'Vérification des actions',
  // Mutations (propose → bandeau d'approbation)
  add_candidate_note: 'Note candidat',
  dismiss_candidate: 'Écarter un candidat',
  assign_candidate_to_member: 'Assignation candidat',
  update_candidate_stage: 'Changement de stade',
  add_to_shortlist: 'Ajout à la shortlist',
  update_mission_status: 'Statut de mission',
  update_mission_brief: 'Modification du brief',
  regenerate_search_filters: 'Régénération des filtres',
  apply_search_filters_to_mission: 'Application des filtres',
  schedule_interview: "Planification d'entretien",
  launch_search: 'Lancement de la recherche',
  get_inbox_overview: 'Lecture de la messagerie',
  bulk_update_stage: 'Déplacement de candidats',
  bulk_dismiss: 'Écartement de candidats',
  send_email: "Envoi d'email",
  create_sequence: 'Création de séquence',
  create_mission: 'Création de mission',
  send_linkedin_message: 'Message LinkedIn',
  pause_sequence: 'Pause de séquence',
  resume_sequence: 'Reprise de séquence',
  enroll_in_sequence: 'Enrôlement en séquence',
  draft_outreach_message: "Rédaction d'approche",
  invite_team_member: "Invitation d'un membre",
  update_member_quota: 'Modification de quotas',
  enrich_candidate_contact: 'Enrichissement contact',
};

const toolChipLabel = (toolName: string) =>
  TOOL_CHIP_LABELS[toolName] ?? toolName.replace(/_/g, ' ');

/**
 * Fallback générique : chip discrète de progression pour TOUT tool sans UI
 * dédiée (branchée via MessagePrimitive.Content components.tools.Fallback).
 * Le statut est dérivé de la présence du result (posé par l'adapter à la
 * réception de l'event tool_status "done") — plus fiable que status.type
 * qui dépend du cycle de vie du message.
 */
export const ToolFallbackChip: React.FC<{
  toolName: string;
  result?: unknown;
  status?: { type: string };
}> = ({ toolName, result, status }) => {
  const outcome = (result as { outcome?: string } | undefined)?.outcome;
  // "en cours" UNIQUEMENT pendant le run actif : un message annulé/interrompu
  // (status incomplete — nouvel envoi pendant l'exécution, erreur réseau) ne
  // doit pas laisser une chip animée à vie.
  const running = result === undefined && status?.type === 'running';
  const unresolved = result === undefined && !running;
  return (
    <div className="my-1 inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground/80">{toolChipLabel(toolName)}</span>
      {running && <span className="animate-pulse">en cours…</span>}
      {unresolved && <span className="text-muted-foreground/60">interrompu</span>}
      {!running && !unresolved && outcome === 'awaiting_approval' && (
        <span className="text-amber-600 dark:text-amber-400">⏳ en attente d'approbation</span>
      )}
      {!running && !unresolved && outcome === 'denied' && <span className="text-destructive">refusé</span>}
      {!running && !unresolved && outcome === 'error' && <span className="text-destructive">échec</span>}
      {!running && !unresolved && (outcome === undefined || outcome === 'ok' || outcome === 'executed_inline') && (
        <span className="text-accent">✓</span>
      )}
    </div>
  );
};

/** Placeholder tool UIs — these render inline cards when tools are invoked */

export const SearchCandidatesToolUI = makeAssistantToolUI({
  toolName: 'search_candidates',
  render: ({ args, status }) => (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">🔍 Recherche de candidats</span>
      {status.type === 'running' && (
        <span className="ml-2 animate-pulse">en cours…</span>
      )}
      {status.type === 'complete' && (
        <span className="ml-2 text-accent">✓ terminée</span>
      )}
    </div>
  ),
});

export const EnrichCompanyToolUI = makeAssistantToolUI({
  toolName: 'enrich_company',
  render: ({ args, status }) => (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">🏢 Enrichissement entreprise</span>
      {status.type === 'running' && (
        <span className="ml-2 animate-pulse">en cours…</span>
      )}
      {status.type === 'complete' && (
        <span className="ml-2 text-accent">✓ terminé</span>
      )}
    </div>
  ),
});

export const WebSearchToolUI = makeAssistantToolUI({
  toolName: 'web_search',
  render: ({ args, status }) => (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">🌐 Recherche web</span>
      {status.type === 'running' && (
        <span className="ml-2 animate-pulse">en cours…</span>
      )}
      {status.type === 'complete' && (
        <span className="ml-2 text-accent">✓ terminée</span>
      )}
    </div>
  ),
});

/**
 * Statuts des conversations de l'assistant : une table pour la page
 * « Conversations de l'assistant » et l'historique du tiroir (revue design
 * E-35, E-39). Mêmes libellés que les Récentes de la barre latérale.
 *
 * Un statut inconnu garde un libellé neutre, jamais la valeur brute.
 */

export type AgentStatusTone = 'brand' | 'info' | 'success' | 'danger' | 'muted';

export const AGENT_CONVERSATION_STATUSES: Record<string, { label: string; tone: AgentStatusTone }> = {
  active: { label: 'Conversation', tone: 'muted' },
  calibrating: { label: 'Calibration', tone: 'muted' },
  plan_proposed: { label: 'Plan proposé', tone: 'brand' },
  running: { label: 'En cours', tone: 'info' },
  paused: { label: 'En pause', tone: 'muted' },
  completed: { label: 'Terminé', tone: 'success' },
  failed: { label: 'Erreur', tone: 'danger' },
  error: { label: 'Erreur', tone: 'danger' },
};

export function agentConversationStatus(status: string | null | undefined): { label: string; tone: AgentStatusTone } {
  return (status && AGENT_CONVERSATION_STATUSES[status]) || AGENT_CONVERSATION_STATUSES.active;
}

/** « 3 profils retenus · 120 profils analysés » à partir de `results_summary`. */
export function agentResultsSummary(summary: unknown): string | null {
  const s = (summary ?? {}) as { go_count?: number; total_scanned?: number };
  const parts: string[] = [];
  if (s.go_count) parts.push(`${s.go_count} profil${s.go_count > 1 ? 's' : ''} retenu${s.go_count > 1 ? 's' : ''}`);
  if (s.total_scanned) parts.push(`${s.total_scanned} profil${s.total_scanned > 1 ? 's' : ''} analysé${s.total_scanned > 1 ? 's' : ''}`);
  return parts.length ? parts.join(' · ') : null;
}

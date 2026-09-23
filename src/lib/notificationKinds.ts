/**
 * Classement des notifications : message, action à mener ou simple information.
 *
 * Le type seul ne suffit pas : la marketplace écrit une candidature à traiter
 * en 'info' et une mission confiée en 'success', la fin d'essai est écrite en
 * 'error', le scoring terminé en 'success'. Le classement combine donc type,
 * metadata.source et lien.
 *
 * Inventaire des écritures (2026-09-22) — toute nouvelle écriture dans la table
 * notifications doit être ajoutée ici et, si besoin, dans les règles ci-dessous.
 *
 * | Écrivain                                          | type                  | Titre                                | Lien                      | metadata.source       | Classe  |
 * |---------------------------------------------------|-----------------------|--------------------------------------|---------------------------|-----------------------|---------|
 * | unipile-webhook (message reçu)                    | new_message           | Nouveau message de …                 | /inbox?chatId=… ou /inbox | —                     | message |
 * | unipile-webhook (compte déconnecté ou en erreur)  | linkedin_disconnected | Compte LinkedIn déconnecté           | /settings?tab=account     | —                     | action  |
 * | unipile-webhook (rattachement du compte échoué)   | error                 | Compte LinkedIn non rattaché         | /settings?tab=account     | —                     | action  |
 * | CandidateCommentsTab (mention)                    | mention               | … vous a mentionné                   | /pipeline?candidate=…     | —                     | action  |
 * | process-agent-tasks (fin de tâche)                | success               | Scoring terminé — …                  | /missions/…?tab=pipeline  | agent_background_task | action  |
 * | process-agent-tasks (abandon de tâche)            | error                 | Tâche de fond interrompue — …        | /missions/…?tab=pipeline  | agent_background_task | action  |
 * | run-agent-search (profils retenus)                | success               | Recherche terminée : …               | /agents                   | agent_search          | action  |
 * | agent-daily-digest                                | digest                | Digest du …                          | /dashboard                | agent_daily_digest    | info    |
 * | marketplace-admin (entrée dans le cercle)         | success               | Bienvenue dans le cercle partenaires | /marketplace              | marketplace_admin     | info    |
 * | SQL expire_subscription_trials (cron)             | error                 | Essai terminé                        | /pricing                  | —                     | action  |
 * | SQL get_subscription_state (expiration lue)       | error                 | Essai terminé                        | /pricing                  | —                     | action  |
 * | SQL apply_to_hunt_mission (vers l'entreprise)     | info                  | Nouvelle candidature                 | /missions/…?tab=config    | marketplace           | action  |
 * | SQL respond_to_hunt_application (acceptée)        | success               | Candidature acceptée                 | /missions/…               | marketplace           | action  |
 * | SQL respond_to_hunt_application (refusée)         | info                  | Candidature non retenue              | /marketplace              | marketplace           | info    |
 * | SQL end_hunt_collaboration                        | info                  | Collaboration terminée               | /marketplace              | marketplace           | info    |
 * | SQL set_hunt_mission_status (candidatures closes) | info                  | Mission pourvue / annulée / retirée  | /marketplace              | marketplace           | info    |
 * | SQL validate_marketplace_partner                  | success               | Bienvenue dans le cercle partenaires | /marketplace              | marketplace           | info    |
 *
 * Écrivains : supabase/functions (from('notifications').insert), src/ (même
 * appel) et supabase/migrations (INSERT INTO public.notifications).
 *
 * Limites connues : aucune écriture n'émet aujourd'hui de notification
 * d'invitation (les invitations partent par email) ; un scoring terminé sans
 * profil scoré reste classé 'action', faute de compteur dans metadata.
 */

export type NotificationKind = 'message' | 'action' | 'info';

/** Champs utiles au classement ; compatible avec une ligne de la table notifications. */
export interface ClassifiableNotification {
  type: string;
  link?: string | null;
  metadata?: unknown;
}

// Types qui demandent une action quel que soit l'écrivain : mention, compte
// LinkedIn à reconnecter, erreur (fin d'essai, rattachement échoué, tâche interrompue).
const ACTION_TYPES = new Set(['mention', 'linkedin_disconnected', 'error']);

const metadataSource = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const source = (metadata as Record<string, unknown>).source;
  return typeof source === 'string' ? source : null;
};

export function notificationKind(n: ClassifiableNotification): NotificationKind {
  if (n.type === 'new_message') return 'message';
  if (ACTION_TYPES.has(n.type)) return 'action';

  const source = metadataSource(n.metadata);
  const link = n.link ?? '';

  // Marketplace : le lien vers une mission porte une candidature à traiter
  // (entreprise) ou une mission confiée (recruteur) ; le lien vers la
  // marketplace porte un refus, une fin de collaboration ou une bienvenue.
  if (source === 'marketplace') {
    return link.startsWith('/missions/') ? 'action' : 'info';
  }

  // Tâche de fond de l'assistant ou agent de sourcing terminés : des
  // résultats sont à revoir (run-agent-search n'écrit que si des profils
  // ont été retenus).
  if (source === 'agent_background_task' || source === 'agent_search') return 'action';

  return 'info';
}

/** Vrai pour une notification qui demande une action (hors messages, comptés à part). */
export function isActionable(n: ClassifiableNotification): boolean {
  return notificationKind(n) === 'action';
}

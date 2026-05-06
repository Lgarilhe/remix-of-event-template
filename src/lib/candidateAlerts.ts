/**
 * candidateAlerts — helpers pour les alertes dismissables du hub candidat.
 *
 * Le bandeau "À traiter" en haut de l'Aperçu détecte des signaux
 * (stagnation, données manquantes, message non répondu...). L'user
 * peut cliquer "✓ Traité" → INSERT dans candidate_alert_dismissals.
 * À la prochaine ouverture de la modale, l'alerte est filtrée.
 *
 * Pas de re-show automatique (volonté simple : si l'user a dit "traité"
 * on respecte). Si une nouvelle situation apparaît avec une nouvelle
 * alert_key, elle s'affichera normalement.
 */

import { supabase } from '@/integrations/supabase/client';

export type AlertKey =
  | 'stagnation'
  | 'unanswered_reply'
  | 'missing_email'
  | 'missing_phone'
  | 'missing_cv'
  | 'missing_contacts'   // groupé email + phone
  | 'no_score'
  | 'invite_unaccepted';

export interface CandidateAlertDismissal {
  id: string;
  candidateId: string;
  organizationId: string;
  alertKey: AlertKey;
  dismissedAt: string;
  dismissedBy: string | null;
}

/**
 * Liste les alertes déjà dismissées pour un candidat dans une org.
 * Retourne un Set<AlertKey> pour lookup O(1) côté UI.
 */
export async function listDismissedAlerts(
  candidateId: string,
  organizationId: string,
): Promise<Set<AlertKey>> {
  const { data, error } = await supabase
    .from('candidate_alert_dismissals')
    .select('alert_key')
    .eq('candidate_id', candidateId)
    .eq('organization_id', organizationId);

  if (error) {
    console.warn('[candidateAlerts] list error:', error);
    return new Set();
  }
  return new Set((data || []).map(r => r.alert_key as AlertKey));
}

/**
 * Marque une alerte comme traitée. Idempotent grâce à la contrainte
 * UNIQUE (org_id, candidate_id, alert_key) : un INSERT en double ne
 * lève pas d'erreur visible côté user.
 */
export async function dismissAlert(
  candidateId: string,
  organizationId: string,
  alertKey: AlertKey,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non authentifié');

  const { error } = await supabase
    .from('candidate_alert_dismissals')
    .upsert(
      {
        candidate_id: candidateId,
        organization_id: organizationId,
        alert_key: alertKey,
        dismissed_by: user.id,
      },
      {
        onConflict: 'organization_id,candidate_id,alert_key',
        ignoreDuplicates: true,
      },
    );

  if (error) {
    console.error('[candidateAlerts] dismiss error:', error);
    throw error;
  }
}

/**
 * Annule un dismiss (au cas où l'user voudrait re-voir une alerte).
 * Pas exposé dans l'UI pour l'instant mais utile pour debug.
 */
export async function undismissAlert(
  candidateId: string,
  organizationId: string,
  alertKey: AlertKey,
): Promise<void> {
  const { error } = await supabase
    .from('candidate_alert_dismissals')
    .delete()
    .eq('candidate_id', candidateId)
    .eq('organization_id', organizationId)
    .eq('alert_key', alertKey);

  if (error) throw error;
}

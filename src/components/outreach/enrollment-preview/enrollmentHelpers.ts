/**
 * Règles partagées par les deux fenêtres d'inscription en séquence (modale
 * simple et préparation avec aperçu) : textes communs, séquence encore active,
 * statut « contacté » sans rétrogradation, inscriptions déjà existantes et
 * annonce de la première action.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { pickFirstStep, type FirstStepCandidate } from '@/lib/sequenceCompatibility';
import { actionTypeLabel } from '@/lib/sequenceErrorMessages';

export const SEQUENCE_INACTIVE_MESSAGE =
  "Cette séquence est désactivée. Réactivez-la avant d'inscrire des candidats.";
export const NO_LINKEDIN_ACCOUNT_TITLE = 'Aucun compte LinkedIn connecté';
export const NO_LINKEDIN_ACCOUNT_DESCRIPTION =
  "Connectez votre compte LinkedIn dans Paramètres, Connexions avant d'inscrire des candidats.";
export const DUPLICATE_CHECK_FAILED_MESSAGE =
  "Impossible de vérifier les contacts récents de votre organisation. Réessayez avant d'inscrire.";
export const SEQUENCES_PLAN_REQUIRED_MESSAGE =
  "L'envoi de séquences et d'InMails nécessite un abonnement. Passez à un plan payant pour contacter ces candidats.";

/** Message affiché pour un candidat dont l'inscription a échoué (détail technique en console). */
export function enrollFailureMessage(name: string | null | undefined): string {
  return `Inscription impossible pour ${name || 'ce candidat'}. Réessayez ou contactez le support.`;
}

type Client = SupabaseClient<Database>;

/**
 * Relit l'état de la séquence juste avant d'inscrire : une séquence désactivée
 * entre l'ouverture du menu et le clic ne doit pas recevoir de candidats.
 * Renvoie null si l'inscription peut continuer, sinon le message à afficher.
 */
export async function sequenceInactiveReason(supabase: Client, sequenceId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('outreach_sequences')
    .select('is_active')
    .eq('id', sequenceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return "Cette séquence est introuvable. Rechargez la page, puis réessayez.";
  return data.is_active ? null : SEQUENCE_INACTIVE_MESSAGE;
}

/** Statuts pipeline plus avancés que « contacté » (ou égaux) : jamais écrasés par l'inscription. */
export const STATUSES_KEPT_ON_ENROLL = ['messaged', 'replied', 'shortlisted'] as const;

/** Vrai si l'inscription peut passer le candidat à « contacté » sans rétrograder un statut existant. */
export function shouldMarkMessaged(existingStatuses: ReadonlyArray<string | null | undefined>): boolean {
  return !existingStatuses.some(s => !!s && (STATUSES_KEPT_ON_ENROLL as readonly string[]).includes(s));
}

interface CandidateRef {
  id: string;
  name?: string | null;
  headline?: string | null;
  profile_url?: string | null;
  public_profile_url?: string | null;
}

/**
 * Passe à « contacté » (job_candidate_status) les candidats inscrits, sans
 * rétrograder un candidat déjà contacté, shortlisté ou qui a répondu. Les deux
 * formes d'identifiant d'une mission du sourcing (« project:{uuid} » et
 * « {uuid} ») sont lues, comme dans useJobCandidateStatus. Non bloquant :
 * l'inscription est faite, une erreur est seulement journalisée.
 */
export async function markCandidatesMessaged(
  supabase: Client,
  params: { rawJobId: string; userId: string; organizationId: string; profiles: CandidateRef[] },
): Promise<void> {
  const { rawJobId, userId, organizationId, profiles } = params;
  if (!rawJobId || profiles.length === 0) return;
  const jobId = rawJobId.startsWith('project:') ? rawJobId.slice('project:'.length) : rawJobId;
  const jobIdForms = Array.from(new Set([rawJobId, jobId]));
  try {
    const { data: existing, error: readError } = await supabase
      .from('job_candidate_status')
      .select('candidate_id, status')
      .in('job_id', jobIdForms)
      .eq('created_by', userId)
      .in('candidate_id', profiles.map(p => p.id));
    if (readError) throw readError;
    const statusesByCandidate = new Map<string, string[]>();
    for (const row of existing ?? []) {
      const list = statusesByCandidate.get(row.candidate_id) ?? [];
      list.push(row.status);
      statusesByCandidate.set(row.candidate_id, list);
    }
    const rows = profiles
      .filter(p => shouldMarkMessaged(statusesByCandidate.get(p.id) ?? []))
      .map(profile => ({
        job_id: jobId,
        candidate_id: profile.id,
        candidate_name: profile.name || null,
        candidate_headline: profile.headline || null,
        linkedin_profile_url: profile.profile_url || profile.public_profile_url || null,
        status: 'messaged',
        created_by: userId,
        organization_id: organizationId,
      }));
    if (rows.length === 0) return;
    const { error: writeError } = await supabase
      .from('job_candidate_status')
      .upsert(rows, { onConflict: 'job_id,candidate_id,created_by' });
    if (writeError) throw writeError;
  } catch (err) {
    console.warn('[enrollment] job_candidate_status update failed:', err);
  }
}

/**
 * Inscription déjà présente dans la séquence (la contrainte UNIQUE(sequence_id,
 * profile_id) empêche toute nouvelle ligne) : encore dans la séquence (en cours
 * ou en pause), ou déjà passé par elle (terminée, réponse, arrêtée, annulée).
 */
export function classifyExistingEnrollment(status: string | null | undefined): 'in_sequence' | 'passed' {
  return status === 'active' || status === 'paused' ? 'in_sequence' : 'passed';
}

/** « 2 candidats déjà dans cette séquence. » */
export function alreadyInSequenceLabel(count: number): string {
  return count > 1
    ? `${count} candidats déjà dans cette séquence.`
    : '1 candidat déjà dans cette séquence.';
}

/** « 1 candidat est déjà passé par cette séquence (arrêté). Reprenez-le depuis le suivi de la séquence. » */
export function alreadyPassedLabel(count: number): string {
  return count > 1
    ? `${count} candidats sont déjà passés par cette séquence (arrêtés). Reprenez-les depuis le suivi de la séquence.`
    : '1 candidat est déjà passé par cette séquence (arrêté). Reprenez-le depuis le suivi de la séquence.';
}

type StepLike = FirstStepCandidate & {
  id?: string;
  action_type?: string;
  actionType?: string;
  delay_days?: number | null;
  delayDays?: number | null;
  delay_hours?: number | null;
  delayHours?: number | null;
  delay_minutes?: number | null;
  delayMinutes?: number | null;
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

/**
 * « Première action : Invitation LinkedIn, dès maintenant pendant vos heures
 * d'envoi » ou « …, dans 2 jours, pendant vos heures d'envoi ». Calculée depuis
 * la première étape (celle que les inscriptions planifient) et son délai
 * effectif, modification de délai de l'inscription comprise. null sans étape.
 */
export function firstActionSummary(
  steps: readonly StepLike[],
  overrides?: Record<string, { delayDays?: number; delayHours?: number } | undefined>,
): string | null {
  // Tirage fixe : pour un test A/B en première position, la première variante
  // suffit à annoncer le délai (les variantes partagent la même position).
  const { step } = pickFirstStep(steps, () => 0);
  if (!step) return null;
  const override = step.id ? overrides?.[step.id] : undefined;
  const days = override?.delayDays ?? step.delay_days ?? step.delayDays ?? 0;
  const hours = override?.delayHours ?? step.delay_hours ?? step.delayHours ?? 0;
  const minutes = step.delay_minutes ?? step.delayMinutes ?? 0;
  const label = actionTypeLabel(step.action_type || step.actionType);
  if (!days && !hours && !minutes) {
    return `Première action : ${label}, dès maintenant pendant vos heures d'envoi`;
  }
  const parts: string[] = [];
  if (days) parts.push(plural(days, 'jour'));
  if (hours) parts.push(plural(hours, 'heure'));
  if (!days && !hours && minutes) parts.push(plural(minutes, 'minute'));
  return `Première action : ${label}, dans ${parts.join(' et ')}, pendant vos heures d'envoi`;
}

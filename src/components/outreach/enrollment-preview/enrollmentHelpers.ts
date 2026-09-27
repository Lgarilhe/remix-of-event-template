/**
 * Règles partagées par les deux fenêtres d'inscription en séquence (modale
 * simple et préparation avec aperçu) : textes communs, séquence encore active,
 * statut « contacté » sans rétrogradation, inscriptions déjà existantes et
 * annonce de la première action.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { isClosedChannelStep, pickFirstStep, type FirstStepCandidate } from '@/lib/sequenceCompatibility';
import { actionTypeLabel } from '@/lib/sequenceErrorMessages';
import { enrollmentProfileFilter, normalizeEnrollmentKey, type EnrollmentProfileRef } from '@/lib/enrollmentDuplicates';
import { extractLinkedInSlug } from '@/lib/linkedinUtils';

export const SEQUENCE_INACTIVE_MESSAGE =
  "Cette séquence est désactivée. Réactivez-la avant d'inscrire des candidats.";
export const NO_LINKEDIN_ACCOUNT_TITLE = 'Aucun compte LinkedIn connecté';
export const NO_LINKEDIN_ACCOUNT_DESCRIPTION =
  "Connectez votre compte LinkedIn dans Paramètres, Connexions avant d'inscrire des candidats.";
export const DUPLICATE_CHECK_FAILED_MESSAGE =
  "Impossible de vérifier les contacts récents de votre organisation. Réessayez avant d'inscrire.";
export const SEQUENCES_PLAN_REQUIRED_MESSAGE =
  "L'envoi de séquences et d'InMails nécessite un abonnement. Passez à un plan payant pour contacter ces candidats.";

/** HINT du refus de la base (SEQ-043, 42501) : inscription depuis le compte relié à un autre membre. */
export const ENROLL_ACCOUNT_OF_OTHER_MEMBER_HINT = 'ENROLL_ACCOUNT_OF_OTHER_MEMBER';

/**
 * Vrai si l'erreur Supabase est ce refus : réessayer échouerait de la même
 * façon, l'appelant affiche OTHER_MEMBER_ACCOUNT_MESSAGE (useSendingAccount).
 */
export function isOtherMemberAccountError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { hint?: unknown }).hint === ENROLL_ACCOUNT_OF_OTHER_MEMBER_HINT;
}

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

/** Clés d'identité d'un candidat, comme l'anti-doublon : identifiants LinkedIn, URL et slug public (/in/{slug}). */
function identityKeys(profile: EnrollmentProfileRef): string[] {
  const keys = new Set<string>();
  for (const value of [profile.id, profile.provider_id, profile.public_identifier, profile.profile_url, profile.public_profile_url]) {
    const key = normalizeEnrollmentKey(value);
    if (key) keys.add(key);
    const slug = value ? extractLinkedInSlug(value) : null;
    if (slug) keys.add(slug);
  }
  return Array.from(keys);
}

/**
 * Sélection dédoublonnée par identité (SEQ-046) : la même personne peut y
 * figurer sous son identifiant Recruiter (AE...) et sous son identifiant
 * classique (ACo...), par exemple un résultat de recherche et un profil du
 * vivier. Une seule inscription par personne, de préférence celle qui porte
 * les deux identifiants (provider_id) ; `duplicates` compte les autres.
 */
export function dedupeProfilesByIdentity<T extends EnrollmentProfileRef>(profiles: readonly T[]): { unique: T[]; duplicates: number } {
  const groupByKey = new Map<string, number>();
  const groups: T[][] = [];
  for (const profile of profiles) {
    const keys = identityKeys(profile);
    const known = keys.map(key => groupByKey.get(key)).find((g): g is number => g !== undefined);
    const index = known ?? groups.push([]) - 1;
    groups[index].push(profile);
    for (const key of keys) if (!groupByKey.has(key)) groupByKey.set(key, index);
  }
  const unique = groups.map(group => group.find(p => p.provider_id) ?? group[0]);
  return { unique, duplicates: profiles.length - unique.length };
}

/** Identifiants comparés par lecture (trois colonnes par identifiant : URL bornée). */
const SEQUENCE_LOOKUP_CHUNK_SIZE = 20;

/**
 * Inscriptions de la séquence qui empêchent d'inscrire ces candidats, par
 * `profile.id`. L'id et le provider_id du profil sont comparés à profile_id,
 * provider_id et resolved_profile_id (SEQ-046) :
 * - même profile_id : la contrainte UNIQUE(sequence_id, profile_id) refuse
 *   toute nouvelle ligne, quel que soit le statut ;
 * - autre identifiant : seule une inscription en cours ou en pause bloque,
 *   sinon le candidat recevrait deux fois les étapes. Une inscription close
 *   sous un autre identifiant relève de l'anti-doublon de l'organisation.
 * Une inscription en cours l'emporte pour le bilan (« déjà dans cette séquence »).
 */
export async function findBlockingSequenceEnrollments(
  supabase: Client,
  sequenceId: string,
  profiles: ReadonlyArray<Pick<EnrollmentProfileRef, 'id' | 'provider_id'>>,
): Promise<Map<string, { status: string }>> {
  const identifiers = (profile: Pick<EnrollmentProfileRef, 'id' | 'provider_id'>) =>
    Array.from(new Set([profile.id, profile.provider_id].map(v => v?.trim()).filter((v): v is string => !!v)));
  const values = Array.from(new Set(profiles.flatMap(identifiers)));
  const rows: Array<{ profile_id: string; provider_id: string | null; resolved_profile_id: string | null; status: string }> = [];
  for (let i = 0; i < values.length; i += SEQUENCE_LOOKUP_CHUNK_SIZE) {
    const { data, error } = await supabase
      .from('sequence_enrollments')
      .select('profile_id, provider_id, resolved_profile_id, status')
      .eq('sequence_id', sequenceId)
      .or(values.slice(i, i + SEQUENCE_LOOKUP_CHUNK_SIZE).map(enrollmentProfileFilter).join(','));
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  const result = new Map<string, { status: string }>();
  for (const profile of profiles) {
    const ids = identifiers(profile);
    let blocking: { status: string } | undefined;
    for (const row of rows) {
      if (![row.profile_id, row.provider_id, row.resolved_profile_id].some(v => !!v && ids.includes(v.trim()))) continue;
      if (classifyExistingEnrollment(row.status) === 'in_sequence') {
        blocking = { status: row.status };
        break;
      }
      if (row.profile_id.trim() === profile.id.trim()) blocking = { status: row.status };
    }
    if (blocking) result.set(profile.id, blocking);
  }
  return result;
}

/** « 2 candidats déjà dans cette séquence. » */
export function alreadyInSequenceLabel(count: number): string {
  return count > 1
    ? `${count} candidats déjà dans cette séquence.`
    : '1 candidat déjà dans cette séquence.';
}

/**
 * « 1 candidat est déjà passé par cette séquence (terminée, réponse ou arrêt).
 * Relancez-le depuis le suivi de la séquence. » Le suivi propose « Relancer »
 * (re_enroll) pour une inscription close ; « Reprendre » est réservé à la pause.
 */
export function alreadyPassedLabel(count: number): string {
  return count > 1
    ? `${count} candidats sont déjà passés par cette séquence (terminée, réponse ou arrêt). Relancez-les depuis le suivi de la séquence.`
    : '1 candidat est déjà passé par cette séquence (terminée, réponse ou arrêt). Relancez-le depuis le suivi de la séquence.';
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
  const actionType = step.action_type || step.actionType;
  const label = actionTypeLabel(actionType);
  // Canal fermé (D2) : le moteur saute cette étape sans rien envoyer, elle
  // n'est donc pas la première action du candidat.
  if (isClosedChannelStep(actionType)) {
    return `Première étape (${label}) sautée : ce canal n'est pas encore disponible. La séquence continue avec l'étape suivante.`;
  }
  if (!days && !hours && !minutes) {
    return `Première action : ${label}, dès maintenant pendant vos heures d'envoi`;
  }
  const parts: string[] = [];
  if (days) parts.push(plural(days, 'jour'));
  if (hours) parts.push(plural(hours, 'heure'));
  if (!days && !hours && minutes) parts.push(plural(minutes, 'minute'));
  return `Première action : ${label}, dans ${parts.join(' et ')}, pendant vos heures d'envoi`;
}

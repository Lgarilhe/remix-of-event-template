/**
 * Règles partagées par les deux fenêtres d'inscription en séquence (modale
 * simple et préparation avec aperçu) : textes communs, séquence encore active,
 * inscriptions déjà existantes et annonce de la première action. Rien n'est
 * écrit dans le pipeline à l'inscription (lot 0b) : « Contacté » est posé par
 * le serveur au premier envoi réel.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { isClosedChannelStep, pickFirstStep, type FirstStepCandidate } from '@/lib/sequenceCompatibility';
import { actionTypeLabel } from '@/lib/sequenceErrorMessages';
import { enrollmentProfileFilter, normalizeEnrollmentKey, type EnrollmentProfileRef } from '@/lib/enrollmentDuplicates';
import { extractLinkedInSlug } from '@/lib/linkedinUtils';
import { plural } from '@/lib/plural';

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

/**
 * Refus d'inscription posé par la base pour ce seul candidat : profil effacé
 * (décision 12) ou même personne déjà dans la séquence sous un autre
 * identifiant, ou sortie depuis moins de 90 jours (décision 21). Les autres
 * candidats de la sélection restent inscriptibles. null pour toute autre erreur.
 */
export function enrollmentRefusalOf(err: unknown): 'gdpr_erased' | 'same_person' | null {
  const hint = err && typeof err === 'object' ? (err as { hint?: unknown }).hint : null;
  if (hint === 'ENROLLMENT_GDPR_ERASED') return 'gdpr_erased';
  if (hint === 'ENROLLMENT_SAME_PERSON_IN_SEQUENCE') return 'same_person';
  return null;
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

/**
 * Inscription déjà présente dans la séquence (la contrainte UNIQUE(sequence_id,
 * profile_id) empêche toute nouvelle ligne) : encore dans la séquence (en cours
 * ou en pause), ou déjà passé par elle (terminée, réponse, arrêtée, annulée).
 */
export function classifyExistingEnrollment(status: string | null | undefined): 'in_sequence' | 'passed' {
  return status === 'active' || status === 'paused' ? 'in_sequence' : 'passed';
}

/** Clés normalisées de ces valeurs, comme l'anti-doublon : identifiant ou URL, plus le slug public (/in/{slug}). */
function identityKeysOf(values: ReadonlyArray<string | null | undefined>): string[] {
  const keys = new Set<string>();
  for (const value of values) {
    const key = normalizeEnrollmentKey(value);
    if (key) keys.add(key);
    const slug = value ? extractLinkedInSlug(value) : null;
    if (slug) keys.add(slug);
  }
  return Array.from(keys);
}

/** Clés d'identité d'un candidat : identifiants LinkedIn, URL et slug public (public_identifier est ce slug nu). */
function identityKeys(profile: EnrollmentProfileRef): string[] {
  return identityKeysOf([profile.id, profile.provider_id, profile.public_identifier, profile.profile_url, profile.public_profile_url]);
}

/** Slugs publics d'un candidat, cherchés dans le profile_url des inscriptions. */
function publicSlugs(profile: EnrollmentProfileRef): string[] {
  const slugs = new Set<string>();
  for (const value of [profile.id, profile.provider_id, profile.public_identifier, profile.profile_url, profile.public_profile_url]) {
    const slug = value ? extractLinkedInSlug(value) : null;
    if (slug) slugs.add(slug);
  }
  const bare = normalizeEnrollmentKey(profile.public_identifier);
  if (bare && !bare.includes('/')) slugs.add(bare);
  return Array.from(slugs);
}

/** Valeur sûre dans un filtre PostgREST `or` (motif entre guillemets). */
function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
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

/** Critères par lecture (un identifiant sur trois colonnes, ou un slug) : URL bornée. */
const SEQUENCE_LOOKUP_CHUNK_SIZE = 20;

/** Sortie de la séquence sous un autre identifiant : bloquante pendant ces jours (décisions 21 et 23, comme la garde en base). */
export const SAME_SEQUENCE_WINDOW_DAYS = 90;

export interface SequenceEnrollmentMatches {
  /** Inscriptions qui empêchent d'inscrire le candidat, par `profile.id`. */
  blocking: Map<string, { status: string }>;
  /**
   * Décision 23 : candidats sortis de la séquence depuis plus de 90 jours sous
   * un autre identifiant. L'inscription est permise, avec un avertissement.
   */
  formerPassages: Set<string>;
}

/**
 * Inscriptions de la séquence qui concernent ces candidats. Le candidat est
 * reconnu comme par l'anti-doublon (SEQ-046) : son id et son provider_id
 * comparés à profile_id, provider_id et resolved_profile_id, et son slug
 * public (/in/{slug}) comparé à celui du profile_url, par égalité exacte (le
 * motif ilike /in/jean* ramène aussi /in/jean-dupont, écarté ensuite).
 * - même profile_id : la contrainte UNIQUE(sequence_id, profile_id) refuse
 *   toute nouvelle ligne, quel que soit le statut ;
 * - autre identifiant ou slug : une inscription en cours ou en pause bloque
 *   (le candidat recevrait deux fois les étapes), une inscription close depuis
 *   moins de 90 jours aussi (la base la refuserait, décision 21) ; close depuis
 *   plus longtemps, elle est seulement signalée (décision 23). Date de sortie
 *   comme la base : la plus récente de completed_at et replied_at, à défaut
 *   updated_at.
 * Une inscription en cours l'emporte pour le bilan (« déjà dans cette séquence »).
 */
export async function findBlockingSequenceEnrollments(
  supabase: Client,
  sequenceId: string,
  profiles: ReadonlyArray<EnrollmentProfileRef>,
): Promise<SequenceEnrollmentMatches> {
  const ids = profiles.flatMap(p => [p.id, p.provider_id].map(v => v?.trim()).filter((v): v is string => !!v));
  const clauses = [
    ...Array.from(new Set(ids)).map(enrollmentProfileFilter),
    ...Array.from(new Set(profiles.flatMap(publicSlugs))).map(slug => `profile_url.ilike.${quoteFilterValue(`*/in/${slug}*`)}`),
  ];
  const rows: Array<{
    profile_id: string; provider_id: string | null; resolved_profile_id: string | null; profile_url: string | null;
    status: string; completed_at: string | null; replied_at: string | null; updated_at: string;
  }> = [];
  for (let i = 0; i < clauses.length; i += SEQUENCE_LOOKUP_CHUNK_SIZE) {
    const { data, error } = await supabase
      .from('sequence_enrollments')
      .select('profile_id, provider_id, resolved_profile_id, profile_url, status, completed_at, replied_at, updated_at')
      .eq('sequence_id', sequenceId)
      .or(clauses.slice(i, i + SEQUENCE_LOOKUP_CHUNK_SIZE).join(','));
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  const rowKeys = rows.map(row => identityKeysOf([row.profile_id, row.provider_id, row.resolved_profile_id, row.profile_url]));
  const windowStart = Date.now() - SAME_SEQUENCE_WINDOW_DAYS * 86_400_000;
  const result: SequenceEnrollmentMatches = { blocking: new Map(), formerPassages: new Set() };
  for (const profile of profiles) {
    const keys = new Set(identityKeys(profile));
    let blocking: { status: string } | undefined;
    let formerPassage = false;
    for (const [index, row] of rows.entries()) {
      if (!rowKeys[index].some(key => keys.has(key))) continue;
      if (classifyExistingEnrollment(row.status) === 'in_sequence') {
        blocking = { status: row.status };
        break;
      }
      const ends = [row.completed_at, row.replied_at].filter((d): d is string => !!d).map(d => new Date(d).getTime());
      const closedAt = ends.length > 0 ? Math.max(...ends) : new Date(row.updated_at).getTime();
      if (row.profile_id.trim() === profile.id.trim() || !(closedAt < windowStart)) blocking = { status: row.status };
      else formerPassage = true;
    }
    if (blocking) result.blocking.set(profile.id, blocking);
    else if (formerPassage) result.formerPassages.add(profile.id);
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

/**
 * Refus de la base (décision 21) : même personne déjà dans la séquence sous un
 * autre identifiant, ou sortie depuis moins de 90 jours. Vu par la base quand
 * la lecture du navigateur ne voit pas l'inscription (celle d'un collègue pour
 * un collaborateur, ou inscrite entre-temps).
 */
export function samePersonRefusedLabel(count: number): string {
  return count > 1
    ? `${count} candidats sont déjà dans cette séquence sous un autre identifiant LinkedIn, ou l'ont quittée il y a moins de 90 jours : ils n'ont pas été réinscrits.`
    : "1 candidat est déjà dans cette séquence sous un autre identifiant LinkedIn, ou l'a quittée il y a moins de 90 jours : il n'a pas été réinscrit.";
}

/** Décision 23 : avertissement pour un candidat réinscrit plus de 90 jours après sa sortie, sous un autre identifiant. */
export function formerPassageLabel(count: number): string {
  return count > 1
    ? `${count} candidats étaient déjà passés par cette séquence il y a plus de 90 jours, sous un autre identifiant LinkedIn : ils ont été réinscrits et recevront de nouveau ses étapes.`
    : '1 candidat était déjà passé par cette séquence il y a plus de 90 jours, sous un autre identifiant LinkedIn : il a été réinscrit et recevra de nouveau ses étapes.';
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

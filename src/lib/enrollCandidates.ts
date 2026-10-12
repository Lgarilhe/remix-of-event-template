/**
 * Inscription de candidats dans une séquence (lot 5f-1) : le seul écrivain
 * navigateur de `sequence_enrollments` et des premières lignes de
 * `sequence_step_executions`. Les fenêtres d'inscription (modale simple,
 * préparation avec aperçu) gardent leurs gardes, leurs états et leurs toasts :
 * elles appellent cette fonction et lisent le résultat.
 *
 * Deux écrivains, un seul jeu de règles :
 * - `batch` : une écriture groupée (inscriptions, puis premières exécutions),
 *   reprise candidat par candidat sur un refus de la base, retrait de tout le
 *   lot si la planification échoue ;
 * - `one_by_one` : un candidat après l'autre (lecture, inscription, première
 *   exécution), retrait du seul candidat dont la planification échoue, retouches
 *   par candidat dans `tracking_data`.
 *
 * Rien n'est écrit dans le pipeline à l'inscription : le serveur pose l'étape
 * du candidat au premier envoi réel.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/integrations/supabase/types';
import type { LinkedInProfile } from '@/components/outreach/types';
import type { StepConfigOverride } from '@/hooks/useEnrollmentPreview';
import { enrollmentRowFields } from '@/components/outreach/enrollment-preview/enrollmentRowFields';
import {
  classifyExistingEnrollment,
  dedupeProfilesByIdentity,
  enrollFailureMessage,
  enrollmentRefusalOf,
  findBlockingSequenceEnrollments,
  isOtherMemberAccountError,
  sequenceInactiveReason,
} from '@/components/outreach/enrollment-preview/enrollmentHelpers';
import { findRecentEnrollments, type RecentEnrollment } from '@/lib/enrollmentDuplicates';
import { normalizeNetworkDistance, pickFirstStep } from '@/lib/sequenceCompatibility';

type Client = SupabaseClient<Database>;

export interface EnrollResults {
  success: number;
  /** Déjà dans la séquence (en cours ou en pause). */
  skipped: number;
  /** Déjà passés par la séquence (terminée, réponse, arrêtée) : à reprendre depuis le suivi. */
  alreadyPassed: number;
  /** Refusés par la base, par nom : profil effacé (décision 12). */
  gdprErased: string[];
  /** Refusés par la base, par nom : même personne dans la séquence sous un autre identifiant (décision 21). */
  samePerson: string[];
  /** Inscrits, déjà passés par la séquence il y a plus de 90 jours sous un autre identifiant (décision 23). */
  formerPassages: number;
  errors: string[];
}

export const SESSION_EXPIRED_MESSAGE = 'Session expirée : reconnectez-vous, puis réessayez.';
export const ALL_RECENT_MESSAGE = 'Tous les candidats ont déjà été contactés par votre organisation';
const BATCH_ROLLED_BACK_MESSAGE = "L'inscription a échoué : aucune étape n'a pu être planifiée. Aucun message ne partira. Réessayez.";
const BATCH_NOT_ROLLED_BACK_MESSAGE = "Des inscriptions ont été créées sans étape ; elles démarreront dans l'heure.";
const NO_STEP_TO_SCHEDULE = 'Aucune étape à planifier';

/** Moment de la première exécution : dans la fenêtre d'envoi de l'étape, ou délai brut. */
export type FirstStepTiming = 'business_hours' | 'raw';

interface EnrollCandidatesBase {
  supabase: Client;
  organizationId: string;
  accountId: string;
  sequence: { id: string; steps: any[] };
  job?: { id: string; title: string } | null;
  /** Toute la sélection : l'anti-doublon la lit une fois quand `recentEnrollments` manque. */
  allProfiles: LinkedInProfile[];
  /** Candidats retenus par l'écran (compatibilité, retirés et déjà passés écartés). */
  candidates: LinkedInProfile[];
  /** Anti-doublon de 90 jours déjà lu par l'écran, ou null : il est alors lu ici, échec fermé. */
  recentEnrollments: Map<string, RecentEnrollment> | null;
  allowDuplicates: boolean;
  /** Texte rendu quand `candidates` est vide. */
  noCandidatesMessage: string;
  firstStepTiming: FirstStepTiming;
}

export type EnrollCandidatesOptions = EnrollCandidatesBase & (
  | { mode: 'batch' }
  | {
      mode: 'one_by_one';
      /** Lue au moment où le candidat est traité : une retouche faite pendant l'inscription vaut pour les suivants. */
      messageOverridesFor: (profileId: string) => Record<string, Json>;
      stepConfigOverrides: () => Record<string, StepConfigOverride>;
      onProgress?: (done: number, total: number) => void;
    }
);

export type EnrollOutcome =
  /** Rien n'a été écrit : `message` est le texte à afficher. */
  | { status: 'refused'; message: string; recentEnrollments: Map<string, RecentEnrollment> | null }
  | {
      status: 'done';
      results: EnrollResults;
      /** Identifiants des profils comptés dans `results.success`. */
      enrolledIds: string[];
      recentEnrollments: Map<string, RecentEnrollment>;
      /** Écriture groupée seulement : la première exécution n'a pas pu être planifiée pour le lot. */
      schedulingFailure?: { rolledBack: boolean };
    }
  /** Exception : `results` garde ce qui a été compté avant l'arrêt. */
  | {
      status: 'failed';
      error: unknown;
      results: EnrollResults;
      enrolledIds: string[];
      recentEnrollments: Map<string, RecentEnrollment> | null;
    };

interface Context {
  supabase: Client;
  organizationId: string;
  accountId: string;
  userId: string;
  sequence: { id: string; steps: any[] };
  jobId: string | undefined;
  jobTitle: string | undefined;
  userTimezone: string;
  firstStepTiming: FirstStepTiming;
}

/** Le moteur retrouve la mission par son identifiant : « project:{uuid} » devient {uuid}. */
function normalizedJobIdOf(job: EnrollCandidatesBase['job']): string | undefined {
  return job?.id?.startsWith('project:') ? job.id.slice('project:'.length) : job?.id;
}

function buildEnrollmentRow(ctx: Context, profile: LinkedInProfile, trackingData?: Record<string, Json>) {
  return {
    sequence_id: ctx.sequence.id,
    account_id: ctx.accountId,
    profile_id: profile.id,
    profile_name: profile.name,
    profile_headline: profile.headline,
    profile_url: profile.profile_url || profile.public_profile_url,
    job_id: ctx.jobId,
    job_title: ctx.jobTitle,
    created_by: ctx.userId,
    user_timezone: ctx.userTimezone,
    current_step_order: 0,
    status: 'active',
    network_distance: normalizeNetworkDistance(profile.network_distance),
    organization_id: ctx.organizationId,
    ...enrollmentRowFields(profile),
    ...(trackingData && Object.keys(trackingData).length > 0 ? { tracking_data: trackingData } : {}),
  };
}

const UPSERT_OPTIONS = { onConflict: 'sequence_id,profile_id', ignoreDuplicates: true };

/**
 * Ligne de la première exécution de UNE inscription. L'étape est tirée pour
 * chaque candidat (test A/B en première position réparti comme par le moteur).
 * Sans étape à planifier, rien n'est rendu : l'inscription serait dormante.
 */
function buildFirstExecution(
  ctx: Context,
  enrollmentId: string,
  stepConfigOverrides: Record<string, StepConfigOverride>,
) {
  const { step, variantAssigned } = pickFirstStep(ctx.sequence.steps);
  if (!step) return null;
  const override = stepConfigOverrides[step.id];
  const scheduledAt = firstExecutionTime(
    new Date(),
    override?.delayDays ?? step.delay_days ?? 0,
    override?.delayHours ?? step.delay_hours ?? 0,
    step.delay_minutes ?? 0,
    ctx.firstStepTiming,
    step.preferred_hour_start ?? 9,
    step.preferred_hour_end ?? 18,
    ctx.userTimezone,
  );
  return {
    enrollment_id: enrollmentId,
    step_id: step.id,
    step_order: step.step_order ?? step.stepOrder ?? 0,
    scheduled_at: scheduledAt.toISOString(),
    status: 'scheduled',
    variant_assigned: variantAssigned,
    organization_id: ctx.organizationId,
  };
}

function firstExecutionTime(
  now: Date,
  delayDays: number,
  delayHours: number,
  delayMinutes: number,
  timing: FirstStepTiming,
  preferredHourStart: number,
  preferredHourEnd: number,
  timezone: string,
): Date {
  if (timing === 'business_hours') {
    return calculateScheduledTime(now, delayDays, delayHours, delayMinutes, preferredHourStart, preferredHourEnd, timezone);
  }
  return new Date(now.getTime() + delayDays * 86400000 + delayHours * 3600000 + delayMinutes * 60000);
}

export async function enrollCandidates(options: EnrollCandidatesOptions): Promise<EnrollOutcome> {
  const { supabase, organizationId, sequence } = options;
  const results: EnrollResults = {
    success: 0,
    skipped: 0,
    alreadyPassed: 0,
    gdprErased: [],
    samePerson: [],
    formerPassages: 0,
    errors: [],
  };
  const enrolledIds: string[] = [];
  let recent = options.recentEnrollments;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { status: 'refused', message: SESSION_EXPIRED_MESSAGE, recentEnrollments: recent };

    // Séquence désactivée entre l'ouverture du menu et le clic : refus.
    const inactiveReason = await sequenceInactiveReason(supabase, sequence.id);
    if (inactiveReason) return { status: 'refused', message: inactiveReason, recentEnrollments: recent };

    // Anti-doublon de l'organisation : refait ici quand l'écran ne l'a pas obtenu.
    // Une lecture en échec lève : on n'inscrit jamais sans cette vérification.
    if (!recent) recent = await findRecentEnrollments(supabase, organizationId, options.allProfiles);
    const known = recent;
    // Même personne sélectionnée sous deux identifiants : une seule inscription,
    // les autres comptées « déjà dans cette séquence ».
    const { unique: enrollSet, duplicates } = dedupeProfilesByIdentity(options.allowDuplicates
      ? options.candidates
      : options.candidates.filter(p => !known.has(p.id)));
    if (enrollSet.length === 0) {
      return {
        status: 'refused',
        message: options.candidates.length === 0 ? options.noCandidatesMessage : ALL_RECENT_MESSAGE,
        recentEnrollments: known,
      };
    }

    const ctx: Context = {
      supabase,
      organizationId,
      accountId: options.accountId,
      userId: user.id,
      sequence,
      jobId: normalizedJobIdOf(options.job),
      jobTitle: options.job?.title,
      userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      firstStepTiming: options.firstStepTiming,
    };

    let schedulingFailure: { rolledBack: boolean } | undefined;
    if (options.mode === 'batch') {
      schedulingFailure = await enrollBatch(ctx, enrollSet, duplicates, results, enrolledIds);
    } else {
      results.skipped += duplicates;
      await enrollOneByOne(ctx, enrollSet, options, results, enrolledIds);
    }
    return { status: 'done', results, enrolledIds, recentEnrollments: known, schedulingFailure };
  } catch (error) {
    // Détail technique en console seulement : jamais de message brut de la base.
    console.error('[enrollCandidates] enrollment aborted:', error);
    return { status: 'failed', error, results, enrolledIds, recentEnrollments: recent };
  }
}

async function enrollBatch(
  ctx: Context,
  enrollSet: LinkedInProfile[],
  duplicates: number,
  results: EnrollResults,
  enrolledIds: string[],
): Promise<{ rolledBack: boolean } | undefined> {
  const { supabase, sequence, organizationId } = ctx;

  // 1. Pré-contrôle : qui a déjà une inscription dans cette séquence ? La
  // contrainte DB `UNIQUE(sequence_id, profile_id)` est inconditionnelle ; sous
  // un autre identifiant du candidat ou son slug public, une inscription en
  // cours ou en pause bloque aussi, dérogation comprise (SEQ-046), comme une
  // inscription close depuis moins de 90 jours (décision 21) ; au-delà,
  // inscription avec un avertissement (décision 23). On distingue ceux qui y
  // sont encore (en cours, en pause) de ceux qui y sont déjà passés (terminée,
  // réponse, arrêtée), à reprendre depuis le suivi.
  const profileIds = enrollSet.map(p => p.id);
  const { blocking, formerPassages } = await findBlockingSequenceEnrollments(supabase, sequence.id, enrollSet);
  const existingStatus = new Map(Array.from(blocking, ([id, e]) => [id, e.status]));
  const countExisting = (ids: Iterable<string>) => {
    let inSequence = 0;
    let passed = 0;
    for (const id of ids) {
      if (!existingStatus.has(id)) continue;
      if (classifyExistingEnrollment(existingStatus.get(id)) === 'in_sequence') inSequence++;
      else passed++;
    }
    return { inSequence, passed };
  };
  if (existingStatus.size === enrollSet.length) {
    // Tous déjà inscrits : sortie avant toute écriture.
    const { inSequence, passed } = countExisting(profileIds);
    results.skipped = inSequence + duplicates;
    results.alreadyPassed = passed;
    return undefined;
  }

  // 2. Écriture groupée. La contrainte UNIQUE(sequence_id, profile_id) élimine
  // la course entre le pré-contrôle et l'écriture : si un autre onglet ou
  // utilisateur a inscrit le même candidat entre-temps, la ligne est
  // silencieusement écartée (ignoreDuplicates) et seules les VRAIES nouvelles
  // inscriptions reviennent.
  const enrollmentRows = enrollSet
    .filter(p => !existingStatus.has(p.id))
    .map(profile => buildEnrollmentRow(ctx, profile));
  const { data: insertedEnrollments, error: enrollError } = await supabase
    .from('sequence_enrollments')
    .upsert(enrollmentRows, UPSERT_OPTIONS)
    .select('id, profile_id');

  // Pas d'erreur si le tableau est vide : tous les candidats étaient déjà
  // inscrits entre le pré-contrôle et l'écriture.
  let insertedRows = insertedEnrollments || [];
  // Candidats refusés ou en échec à l'insertion une par une.
  const refused = new Set<string>();
  if (enrollError) {
    // Refus de la base propre à un candidat (profil effacé, même personne dans
    // la séquence, décisions 12 et 21) : l'insertion groupée échoue en entier,
    // on reprend candidat par candidat pour inscrire les autres.
    if (!enrollmentRefusalOf(enrollError)) throw enrollError;
    insertedRows = [];
    for (const row of enrollmentRows) {
      const { data: one, error: oneError } = await supabase
        .from('sequence_enrollments')
        .upsert(row, UPSERT_OPTIONS)
        .select('id, profile_id');
      if (!oneError) {
        insertedRows.push(...(one ?? []));
        continue;
      }
      // Même compte pour toute la sélection : aucune ligne n'a pu passer avant.
      if (isOtherMemberAccountError(oneError)) throw oneError;
      refused.add(row.profile_id);
      const refusal = enrollmentRefusalOf(oneError);
      if (refusal === 'gdpr_erased') results.gdprErased.push(row.profile_name || 'Candidat sans nom');
      else if (refusal === 'same_person') results.samePerson.push(row.profile_name || 'Candidat sans nom');
      else {
        console.error('[enrollCandidates] enrollment failed for', row.profile_id, oneError);
        results.errors.push(enrollFailureMessage(row.profile_name));
      }
    }
  }
  const insertedProfileIds = new Set(insertedRows.map(e => e.profile_id));
  const notInserted = profileIds.filter(id => !insertedProfileIds.has(id) && !refused.has(id));
  const { passed: passedCount } = countExisting(notInserted);
  results.success = insertedRows.length;
  results.alreadyPassed = passedCount;
  results.skipped = notInserted.length - passedCount + duplicates;
  results.formerPassages = insertedRows.filter(e => formerPassages.has(e.profile_id)).length;
  if (insertedRows.length < enrollSet.length - existingStatus.size - refused.size) {
    console.warn(`[enrollCandidates] Race detected: ${enrollSet.length - existingStatus.size - refused.size - insertedRows.length} enrollment(s) deduped at DB level (concurrent enroll from another session)`);
  }
  if (insertedRows.length === 0) return undefined;

  // 3. Premières exécutions, en une écriture : une par inscription créée.
  const executionRows = insertedRows.flatMap(enrollment => {
    const row = buildFirstExecution(ctx, enrollment.id, {});
    return row ? [row] : [];
  });
  const { error: execError } = executionRows.length === insertedRows.length
    ? await supabase.from('sequence_step_executions').insert(executionRows)
    : { error: new Error(NO_STEP_TO_SCHEDULE) };
  if (execError) {
    // Une inscription active sans étape planifiée n'est reprise par le moteur
    // qu'au mieux une heure plus tard : on retire les inscriptions créées plutôt
    // que d'annoncer un faux succès.
    console.error('[enrollCandidates] Failed to schedule first executions:', execError);
    const insertedIds = insertedRows.map(e => e.id);
    const { data: removed, error: rollbackError } = await supabase
      .from('sequence_enrollments')
      .delete()
      .in('id', insertedIds)
      .select('id');
    const rolledBack = !rollbackError && (removed?.length ?? 0) === insertedIds.length;
    results.success = 0;
    // Retirées, ces inscriptions ne sont plus des réinscriptions à signaler.
    if (rolledBack) results.formerPassages = 0;
    results.errors.push(rolledBack ? BATCH_ROLLED_BACK_MESSAGE : BATCH_NOT_ROLLED_BACK_MESSAGE);
    return { rolledBack };
  }

  enrolledIds.push(...insertedRows.map(e => e.profile_id));
  return undefined;
}

async function enrollOneByOne(
  ctx: Context,
  enrollSet: LinkedInProfile[],
  options: Extract<EnrollCandidatesOptions, { mode: 'one_by_one' }>,
  results: EnrollResults,
  enrolledIds: string[],
): Promise<void> {
  const { supabase, sequence } = ctx;

  for (let index = 0; index < enrollSet.length; index++) {
    const profile = enrollSet[index];
    options.onProgress?.(index + 1, enrollSet.length);
    try {
      // Pré-contrôle : la contrainte DB UNIQUE(sequence_id, profile_id) est
      // inconditionnelle, toute ligne existante empêche l'inscription ; sous un
      // autre identifiant du candidat ou son slug public, une inscription en
      // cours ou en pause l'empêche aussi, dérogation comprise (SEQ-046), et une
      // inscription close depuis moins de 90 jours (décision 21) ; au-delà, il
      // est inscrit avec un avertissement (décision 23). La course entre la
      // lecture et l'écriture est gérée par l'upsert et ignoreDuplicates.
      const matches = await findBlockingSequenceEnrollments(supabase, sequence.id, [profile]);
      const existing = matches.blocking.get(profile.id);
      if (existing) {
        if (classifyExistingEnrollment(existing.status) === 'in_sequence') results.skipped++;
        else results.alreadyPassed++;
        continue;
      }

      const messageOverrides = options.messageOverridesFor(profile.id);
      // Réglages de délai et de délai d'attente par étape, retouchés par la
      // personne dans l'arbre : lus par le moteur à la planification de l'étape
      // suivante.
      const stepConfigOverrides = options.stepConfigOverrides();
      const trackingData: Record<string, Json> = {};
      if (Object.keys(messageOverrides).length > 0) trackingData.message_overrides = messageOverrides;
      if (Object.keys(stepConfigOverrides).length > 0) trackingData.step_config_overrides = stepConfigOverrides;

      const { data: enrollment, error: enrollError } = await supabase
        .from('sequence_enrollments')
        .upsert(buildEnrollmentRow(ctx, profile, trackingData), UPSERT_OPTIONS)
        .select('id, profile_id')
        .maybeSingle();
      if (enrollError) throw enrollError;
      if (!enrollment) {
        // Conflit (course entre la lecture et l'écriture) : l'inscription existait déjà.
        results.skipped++;
        continue;
      }

      const executionRow = buildFirstExecution(ctx, enrollment.id, stepConfigOverrides);
      const { error: execError } = executionRow
        ? await supabase.from('sequence_step_executions').insert(executionRow)
        : { error: new Error(NO_STEP_TO_SCHEDULE) };
      // Si la première exécution n'a pas pu être écrite (accès refusé,
      // contrainte, aucune étape), l'inscription serait active sans étape : on la
      // retire plutôt que de compter un faux succès.
      if (execError) {
        console.error('[enrollCandidates] first execution insert failed:', execError);
        // Retrait vérifié (.select) : un refus silencieux laisserait une
        // inscription active sans étape.
        const { data: removed } = await supabase
          .from('sequence_enrollments')
          .delete()
          .eq('id', enrollment.id)
          .select('id');
        results.errors.push(removed?.length
          ? `${profile.name} : les étapes n'ont pas pu être planifiées, candidat non inscrit.`
          : `${profile.name} : les étapes n'ont pas pu être planifiées et l'inscription n'a pas pu être retirée. Retirez-la depuis le suivi de la séquence.`);
        continue;
      }

      results.success++;
      if (matches.formerPassages.has(profile.id)) results.formerPassages++;
      enrolledIds.push(profile.id);
    } catch (err) {
      // Refus de la base (SEQ-043) : compte relié à un autre membre. Tous les
      // candidats suivants échoueraient pareil : on arrête la boucle.
      if (isOtherMemberAccountError(err)) throw err;
      // Refus propres à ce candidat (profil effacé, même personne dans la
      // séquence) : comptés à part, les suivants restent inscriptibles.
      const refusal = enrollmentRefusalOf(err);
      if (refusal === 'gdpr_erased') { results.gdprErased.push(profile.name || 'Candidat sans nom'); continue; }
      if (refusal === 'same_person') { results.samePerson.push(profile.name || 'Candidat sans nom'); continue; }
      // Détail technique en console seulement : jamais le message brut de la base.
      console.error('[enrollCandidates] enrollment failed for', profile.id, err);
      results.errors.push(enrollFailureMessage(profile.name));
    }
  }
}

// Décalage UTC, en heures, d'un fuseau à un instant donné.
function getTimezoneOffsetHours(date: Date, tz: string): number {
  const localHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(date), 10);
  const utcHour = date.getUTCHours();
  let offset = localHour - utcHour;
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  return offset;
}

// Fixe la date pour que l'heure LOCALE dans `tz` vaille `desiredLocalHour`.
function setLocalHour(date: Date, tz: string, desiredLocalHour: number, minutes = 0): void {
  const offset = getTimezoneOffsetHours(date, tz);
  date.setUTCHours(desiredLocalHour - offset, minutes, 0, 0);
}

// Calcule l'heure de la première exécution en respectant la fenêtre d'envoi.
function calculateScheduledTime(
  fromDate: Date,
  delayDays: number,
  delayHours: number,
  delayMinutes: number,
  preferredHourStart: number,
  preferredHourEnd: number,
  timezone: string,
): Date {
  const scheduled = new Date(fromDate);

  scheduled.setTime(scheduled.getTime()
    + delayDays * 86400000
    + delayHours * 3600000
    + delayMinutes * 60000
  );

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const localHour = parseInt(formatter.format(scheduled));

  if (localHour < preferredHourStart) {
    setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 15));
  } else if (localHour >= preferredHourEnd) {
    scheduled.setDate(scheduled.getDate() + 1);
    setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 15));
  }

  const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const day = dayFormatter.format(scheduled);
  if (day === 'Sun') { scheduled.setDate(scheduled.getDate() + 1); setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 15)); }
  if (day === 'Sat') { scheduled.setDate(scheduled.getDate() + 2); setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 15)); }

  const jitterMinutes = Math.floor(Math.random() * 11) - 5;
  scheduled.setTime(scheduled.getTime() + jitterMinutes * 60000);

  const finalHour = parseInt(formatter.format(scheduled));
  if (finalHour < preferredHourStart) {
    setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 6));
  } else if (finalHour >= preferredHourEnd) {
    scheduled.setDate(scheduled.getDate() + 1);
    setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 6));
  }

  return scheduled;
}

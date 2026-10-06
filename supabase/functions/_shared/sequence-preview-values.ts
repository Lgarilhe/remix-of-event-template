// Valeurs des variables d'un message, pour l'aperçu (refonte mission, lot 5d-1 ;
// fonction draft-sequence, action preview_values).
//
// Ce que l'aperçu montre est ce que le moteur enverra :
// - même contexte : buildSequenceContext appelé comme process-sequences
//   l'appelle avant un envoi LinkedIn (expéditeur = auteur de l'inscription,
//   remplacé par le titulaire du compte d'envoi ; assigned_sender_id hérité
//   ignoré comme isLegacyAssignedSender), sur la ligne d'inscription entière,
//   ou, pour un candidat pas encore inscrit, sur une inscription construite
//   avec les colonnes que le navigateur écrira ;
// - même rendu : le navigateur applique renderTemplatePreview
//   (src/lib/templatePreview.ts), copie de interpolateAndStrip prouvée par le
//   jeu de cas tests/fixtures/template-render-cases.json.
// Seules les variables des textes de la séquence (`keys`) sont rendues. Les
// variables personnelles (user_template_variables) d'un autre membre ne sont
// jamais données avec leur valeur : annoncées entre crochets (at_send), comme
// celles d'un expéditeur choisi à l'envoi par la rotation multi-expéditeurs.
// Les variables de l'heure d'envoi (salutation, date) sont annoncées à part
// (send_time). Une lecture en échec pendant la construction du contexte : pas
// d'aperçu (preview_failed, à réessayer), jamais un texte faux.
// Un candidat effacé (RGPD) n'a aucun aperçu ; registre illisible : aucun
// aperçu non plus, raison rendue. Rien n'est écrit, rien n'est débité.
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json supabase/functions/_shared/sequence-preview-values.test.ts

import { buildSequenceContext, type PlaceholderContext, type SequenceContextTrace } from './template-interpolation.ts';
import { SEND_TIME_VARIABLES } from './enroll-preview.ts';
import { SENT_EXECUTION_STATUSES } from './sequence-engine-rules.ts';
import { GDPR_ERASED_AT_KEY, isCandidateErasedForOrg } from './get-or-fetch-contact.ts';

type ContextClient = Parameters<typeof buildSequenceContext>[0];
type ErasureClient = Parameters<typeof isCandidateErasedForOrg>[0];

/** Candidats par appel, inscriptions et profils confondus. */
export const PREVIEW_MAX_CANDIDATES = 20;
/** Variables distinctes demandées par appel (clés des textes de la séquence). */
export const PREVIEW_MAX_KEYS = 50;
/** Longueur maximale d'un champ de profil reçu. */
const MAX_FIELD_LENGTH = 2000;
const MAX_ID_LENGTH = 512;
/** Candidats traités en même temps (lectures en base). */
const CONCURRENCY = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Clé de variable, lue comme le moteur la lit (en minuscules). Les clés du
 * contexte et des variables personnelles ont toutes cette forme : une autre
 * clé n'a jamais de valeur, le navigateur la retire sans la demander.
 */
export const PREVIEW_KEY_RE = /^[a-z0-9_]{1,64}$/;

export const PREVIEW_ERASED_MESSAGE = "Ce candidat a demandé l'effacement de ses données : aucun aperçu.";
export const PREVIEW_UNVERIFIED_MESSAGE =
  "L'effacement éventuel des données de ce candidat n'a pas pu être vérifié : aucun aperçu. Réessayez dans un instant.";
export const PREVIEW_FAILED_MESSAGE = "L'aperçu de ce candidat n'a pas pu être préparé. Réessayez dans un instant.";

/**
 * Variables que le moteur remplit à partir du candidat, de la mission, de
 * l'expéditeur et de l'organisation (clés françaises ; les alias anglais les
 * recopient). Une clé sans valeur figure dans `missing`.
 */
export const PREVIEW_CONTEXT_KEYS = [
  'prenom', 'nom', 'nom_complet', 'headline', 'poste_actuel', 'entreprise_actuelle', 'profil_linkedin',
  'niveau_connexion', 'poste_recherche', 'client', 'lieu_poste', 'type_contrat', 'skills_requis', 'lien_calendly',
  'mon_prenom', 'mon_nom', 'ma_signature', 'mon_poste', 'ma_societe',
] as const;

/**
 * Clés que le moteur remplit lui-même (contexte, alias anglais, heure
 * d'envoi). Toute autre clé ne peut venir que des variables personnelles de
 * l'expéditeur ({{ville}} et son alias {{city}} compris).
 */
export const PREVIEW_ENGINE_KEYS: ReadonlySet<string> = new Set([
  ...PREVIEW_CONTEXT_KEYS,
  'first_name', 'last_name', 'name', 'company', 'job_title', 'sender_name', 'calendly_link',
  ...Object.keys(SEND_TIME_VARIABLES),
]);

/** Variables de l'expéditeur annoncées quand la rotation le choisit à l'envoi. */
export const DRAWN_SENDER_LABELS: Readonly<Record<string, string>> = {
  mon_prenom: '[prénom de l’expéditeur choisi à l’envoi]',
  sender_name: '[prénom de l’expéditeur choisi à l’envoi]',
  mon_nom: '[nom de l’expéditeur choisi à l’envoi]',
  ma_signature: '[signature de l’expéditeur choisi à l’envoi]',
  mon_poste: '[poste de l’expéditeur choisi à l’envoi]',
};
export const DRAWN_SENDER_PERSONAL_LABEL = '[variable personnelle de l’expéditeur choisi à l’envoi, si elle existe]';
export const OTHER_SENDER_PERSONAL_LABEL = '[variable personnelle de l’expéditeur, remplie à l’envoi si elle existe]';

const hasOwn = (record: Readonly<Record<string, unknown>>, key: string) => Object.prototype.hasOwnProperty.call(record, key);

// ─── Requête ──────────────────────────────────────────────────────────────

/**
 * Candidat pas encore inscrit : les colonnes que l'inscription portera, telles
 * que le navigateur les écrira (sequence_enrollments). `id` est l'identifiant
 * LinkedIn du profil (profile_id de l'inscription).
 */
export interface PreviewProfileInput {
  id: string;
  provider_id?: string | null;
  profile_name?: string | null;
  profile_headline?: string | null;
  profile_url?: string | null;
  company_name?: string | null;
  /** Titre du poste à pourvoir écrit sur l'inscription (repli de poste_recherche sans mission). */
  job_title?: string | null;
  /** Valeur écrite à l'inscription (FIRST_DEGREE, SECOND_DEGREE…). */
  network_distance?: string | null;
}

export interface PreviewValuesRequest {
  organization_id: string;
  mission_id: string | null;
  /** Séquence des candidats pas encore inscrits (rotation multi-expéditeurs). */
  sequence_id: string | null;
  enrollment_ids: string[];
  profiles: PreviewProfileInput[];
  account_id: string | null;
  /** Clés des variables utilisées par les textes de la séquence, en minuscules, sans doublon. */
  keys: string[];
}

export type PreviewRequestCode = 'PREVIEW_INVALID_INPUT' | 'PREVIEW_UNKNOWN_ACTION' | 'PREVIEW_TOO_MANY';

export type ParsedPreviewRequest =
  | { ok: true; request: PreviewValuesRequest }
  | { ok: false; status: 400; code: PreviewRequestCode; error: string };

const PROFILE_TEXT_FIELDS = [
  'provider_id', 'profile_name', 'profile_headline', 'profile_url', 'company_name', 'job_title', 'network_distance',
] as const;

const invalid = (error: string): ParsedPreviewRequest => ({ ok: false, status: 400, code: 'PREVIEW_INVALID_INPUT', error });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Texte facultatif : absent, null, ou chaîne de longueur bornée. */
function optionalText(value: unknown, max: number): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string' || value.length > max) return { ok: false };
  return { ok: true, value };
}

const optionalUuid = (value: unknown): { ok: true; value: string | null } | { ok: false } => {
  if (value === undefined || value === null) return { ok: true, value: null };
  return typeof value === 'string' && UUID_RE.test(value) ? { ok: true, value } : { ok: false };
};

/**
 * Lecture et contrôle du corps de la requête. 20 candidats au plus en tout,
 * comptés avant tout dédoublonnage : 21 identifiants sont refusés. `keys` est
 * obligatoire (liste vide admise) : seules ces variables sont rendues.
 */
export function parsePreviewRequest(body: unknown): ParsedPreviewRequest {
  if (!isRecord(body)) return invalid('Requête illisible.');
  if (body.action !== 'preview_values') {
    return { ok: false, status: 400, code: 'PREVIEW_UNKNOWN_ACTION', error: 'Action inconnue.' };
  }
  const orgId = body.organization_id;
  if (typeof orgId !== 'string' || !UUID_RE.test(orgId)) return invalid('Organisation manquante ou invalide.');
  const missionId = optionalUuid(body.mission_id);
  if (!missionId.ok) return invalid('Mission invalide.');
  const sequenceId = optionalUuid(body.sequence_id);
  if (!sequenceId.ok) return invalid('Séquence invalide.');
  const accountId = optionalText(body.account_id, MAX_ID_LENGTH);
  if (!accountId.ok) return invalid('Compte LinkedIn invalide.');

  const rawIds = body.enrollment_ids ?? [];
  const rawProfiles = body.profiles ?? [];
  if (!Array.isArray(rawIds) || !Array.isArray(rawProfiles)) return invalid('Liste de candidats invalide.');
  if (rawIds.length + rawProfiles.length === 0) return invalid('Aucun candidat à prévisualiser.');
  if (rawIds.length + rawProfiles.length > PREVIEW_MAX_CANDIDATES) {
    return {
      ok: false,
      status: 400,
      code: 'PREVIEW_TOO_MANY',
      error: `Un aperçu porte sur ${PREVIEW_MAX_CANDIDATES} candidats au plus.`,
    };
  }
  if (!rawIds.every((id) => typeof id === 'string' && UUID_RE.test(id))) return invalid('Inscription invalide.');

  const profiles: PreviewProfileInput[] = [];
  for (const raw of rawProfiles) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > MAX_ID_LENGTH) {
      return invalid('Profil invalide.');
    }
    const profile: PreviewProfileInput = { id: raw.id };
    for (const field of PROFILE_TEXT_FIELDS) {
      const parsed = optionalText(raw[field], MAX_FIELD_LENGTH);
      if (!parsed.ok) return invalid('Profil invalide.');
      profile[field] = parsed.value;
    }
    profiles.push(profile);
  }

  const rawKeys = body.keys;
  if (!Array.isArray(rawKeys)) return invalid('Variables des messages manquantes.');
  if (rawKeys.length > PREVIEW_MAX_KEYS) {
    return invalid(`Les messages utilisent plus de ${PREVIEW_MAX_KEYS} variables : aperçu impossible.`);
  }
  const keys: string[] = [];
  for (const raw of rawKeys) {
    const key = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!PREVIEW_KEY_RE.test(key)) return invalid('Variable invalide.');
    if (!keys.includes(key)) keys.push(key);
  }

  return {
    ok: true,
    request: {
      organization_id: orgId,
      mission_id: missionId.value,
      sequence_id: sequenceId.value,
      enrollment_ids: [...new Set(rawIds as string[])],
      profiles,
      account_id: accountId.value,
      keys,
    },
  };
}

// ─── Inscription d'un candidat pas encore inscrit ─────────────────────────

/**
 * Inscription construite en mémoire avec les colonnes qu'écrit le navigateur
 * (sequence_enrollments) : auteur et expéditeur = l'appelant, compte d'envoi
 * vérifié par l'appelant, mission et séquence de l'aperçu. Rien n'est inséré.
 */
export function profileEnrollment(
  profile: PreviewProfileInput,
  ctx: { organizationId: string; userId: string; accountId: string | null; missionId: string | null; sequenceId?: string | null },
): Record<string, unknown> {
  return {
    organization_id: ctx.organizationId,
    sequence_id: ctx.sequenceId ?? null,
    created_by: ctx.userId,
    account_id: ctx.accountId,
    job_id: ctx.missionId,
    job_title: profile.job_title ?? null,
    profile_id: profile.id,
    provider_id: profile.provider_id ?? null,
    profile_name: profile.profile_name ?? null,
    profile_headline: profile.profile_headline ?? null,
    profile_url: profile.profile_url ?? null,
    company_name: profile.company_name ?? null,
    network_distance: profile.network_distance ?? null,
  };
}

// ─── Expéditeur ───────────────────────────────────────────────────────────

/**
 * assigned_sender_id hérité (user_id d'avant la migration B6, format uuid)
 * rattaché à aucun compte LinkedIn ni boîte de l'organisation : ignoré, comme
 * le moteur avant le contexte (isLegacyAssignedSender de process-sequences),
 * pour que l'expéditeur soit le titulaire du compte de l'inscription. Lecture
 * en échec : `ok: false` (pas d'aperçu).
 */
export async function withoutLegacySender(
  client: ContextClient,
  organizationId: string,
  enrollment: Record<string, unknown>,
): Promise<{ ok: true; enrollment: Record<string, unknown> } | { ok: false }> {
  const assigned = enrollment.assigned_sender_id;
  if (typeof assigned !== 'string' || !UUID_RE.test(assigned)) return { ok: true, enrollment };
  try {
    for (const [table, column] of [['member_linkedin_accounts', 'linkedin_account_id'], ['member_email_accounts', 'email_account_id']]) {
      const { data, error } = await client.from(table).select('id')
        .eq('organization_id', organizationId).eq(column, assigned).limit(1);
      if (error) {
        console.error(`[sequence-preview-values] ${table} illisible:`, error.message);
        return { ok: false };
      }
      if (((data ?? []) as unknown[]).length > 0) return { ok: true, enrollment };
    }
    return { ok: true, enrollment: { ...enrollment, assigned_sender_id: null } };
  } catch (err) {
    console.error('[sequence-preview-values] expéditeur hérité illisible:', err);
    return { ok: false };
  }
}

/**
 * Séquences de l'organisation dont l'expéditeur est choisi à l'envoi : rotation
 * multi-expéditeurs active, avec au moins un compte LinkedIn du groupe relié à
 * l'organisation (sans compte relié, le moteur envoie depuis le compte de
 * l'inscription : pickSenderForRotation de process-sequences). `found` :
 * séquences lues dans l'organisation. Lecture en échec : `ok: false`.
 */
export async function loadDrawnSenderSequences(
  client: ContextClient,
  organizationId: string,
  sequenceIds: readonly unknown[],
): Promise<{ ok: true; found: Set<string>; drawn: Set<string> } | { ok: false }> {
  const ids = [...new Set(sequenceIds.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))];
  if (ids.length === 0) return { ok: true, found: new Set(), drawn: new Set() };
  try {
    const { data, error } = await client.from('outreach_sequences')
      .select('id, multi_sender_enabled, sender_accounts')
      .eq('organization_id', organizationId)
      .in('id', ids);
    if (error) {
      console.error('[sequence-preview-values] séquences illisibles:', error.message);
      return { ok: false };
    }
    const rows = (data ?? []) as Array<{ id: string; multi_sender_enabled?: boolean | null; sender_accounts?: unknown }>;
    const pools = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.multi_sender_enabled) continue;
      const declared = (Array.isArray(row.sender_accounts) ? row.sender_accounts : [])
        .filter((a): a is Record<string, unknown> => isRecord(a))
        .filter((a) => typeof a.account_id === 'string' && !!a.account_id && (!a.channel || a.channel === 'linkedin'))
        .map((a) => a.account_id as string);
      if (declared.length > 0) pools.set(row.id, declared);
    }
    const drawn = new Set<string>();
    const accounts = [...new Set([...pools.values()].flat())];
    if (accounts.length > 0) {
      const { data: linked, error: linkedError } = await client.from('member_linkedin_accounts')
        .select('linkedin_account_id')
        .eq('organization_id', organizationId)
        .in('linkedin_account_id', accounts);
      if (linkedError) {
        console.error('[sequence-preview-values] comptes du groupe illisibles:', linkedError.message);
        return { ok: false };
      }
      const linkedIds = new Set(((linked ?? []) as Array<{ linkedin_account_id: string }>).map((r) => r.linkedin_account_id));
      for (const [id, pool] of pools) if (pool.some((account) => linkedIds.has(account))) drawn.add(id);
    }
    return { ok: true, found: new Set(rows.map((r) => r.id)), drawn };
  } catch (err) {
    console.error('[sequence-preview-values] séquences illisibles:', err);
    return { ok: false };
  }
}

/**
 * L'expéditeur de cette inscription sera-t-il choisi à l'envoi ? Séquence en
 * rotation, aucun expéditeur attribué, et (inscription déjà en base) aucune
 * étape déjà partie : le moteur fige alors la conversation sur le compte de
 * l'inscription (SEQ-013). Lecture en échec : `null` (pas d'aperçu).
 */
async function senderDrawnAtSend(
  client: ContextClient,
  item: PreviewItem,
  drawnSequences: ReadonlySet<string>,
): Promise<boolean | null> {
  const { enrollment } = item;
  if (enrollment.assigned_sender_id || typeof enrollment.sequence_id !== 'string' || !drawnSequences.has(enrollment.sequence_id)) {
    return false;
  }
  if (item.source !== 'enrollment' || typeof enrollment.id !== 'string') return true;
  try {
    const { data, error } = await client.from('sequence_step_executions').select('id')
      .eq('enrollment_id', enrollment.id).in('status', [...SENT_EXECUTION_STATUSES]).limit(1);
    if (error) {
      console.error('[sequence-preview-values] historique d\'envoi illisible:', error.message);
      return null;
    }
    return ((data ?? []) as unknown[]).length === 0;
  } catch (err) {
    console.error('[sequence-preview-values] historique d\'envoi illisible:', err);
    return null;
  }
}

// ─── Contexte du moteur ───────────────────────────────────────────────────

/** Relevé vide, rempli par buildSequenceContext. */
export const emptyTrace = (): SequenceContextTrace => ({ senderUserId: null, personalKeys: [], failedReads: [] });

/**
 * Contexte des variables pour une inscription, par le même appel que le moteur
 * avant un envoi LinkedIn (process-sequences, interpolation de garde) :
 * l'expéditeur donné est l'auteur de l'inscription, et buildSequenceContext le
 * remplace par le titulaire du compte d'envoi (assigned_sender_id déjà écrit,
 * sinon account_id). Un expéditeur que la rotation choisira à l'envoi n'est
 * pas encore connu : ses variables sont annoncées (splitPreviewValues).
 */
export function engineContext(
  client: ContextClient,
  enrollment: Record<string, unknown>,
  trace?: SequenceContextTrace,
): Promise<PlaceholderContext> {
  const createdBy = typeof enrollment.created_by === 'string' ? enrollment.created_by : null;
  return buildSequenceContext(client, { enrollment, senderUserId: createdBy || null, trace });
}

/**
 * Valeurs envoyées au navigateur : les seules variables demandées (`keys`),
 * sans celles de l'heure d'envoi (annoncées à part). Annoncées entre crochets
 * dans `at_send`, jamais avec leur valeur :
 * - expéditeur choisi à l'envoi (rotation) : ses prénom, nom, signature et
 *   poste, et toute variable personnelle ;
 * - expéditeur qui n'est pas l'appelant : ses variables personnelles (et toute
 *   clé hors du moteur, pour ne pas dire lesquelles existent).
 */
export function splitPreviewValues(
  ctx: PlaceholderContext,
  trace: SequenceContextTrace,
  opts: { keys: readonly string[]; callerUserId: string; senderDrawnAtSend: boolean },
): { values: Record<string, string>; at_send: Record<string, string> } {
  const values: Record<string, string> = {};
  const atSend: Record<string, string> = {};
  const personal = new Set(trace.personalKeys);
  const otherSender = !opts.senderDrawnAtSend && !!trace.senderUserId && trace.senderUserId !== opts.callerUserId;
  for (const key of opts.keys) {
    if (hasOwn(SEND_TIME_VARIABLES, key)) continue;
    const personalOrUnknown = personal.has(key) || !PREVIEW_ENGINE_KEYS.has(key);
    if (opts.senderDrawnAtSend && hasOwn(DRAWN_SENDER_LABELS, key)) {
      atSend[key] = DRAWN_SENDER_LABELS[key];
    } else if (opts.senderDrawnAtSend && personalOrUnknown) {
      atSend[key] = DRAWN_SENDER_PERSONAL_LABEL;
    } else if (otherSender && personalOrUnknown) {
      atSend[key] = OTHER_SENDER_PERSONAL_LABEL;
    } else if (hasOwn(ctx, key) && ctx[key] !== undefined && ctx[key] !== null) {
      values[key] = ctx[key] as string;
    }
  }
  return { values, at_send: atSend };
}

/** Variables du moteur sans valeur pour ce candidat (celles d'un expéditeur choisi à l'envoi exceptées). */
export function missingPreviewKeys(ctx: Readonly<PlaceholderContext>, senderDrawn = false): string[] {
  return PREVIEW_CONTEXT_KEYS.filter((key) => !(ctx[key] ?? '').trim() && !(senderDrawn && hasOwn(DRAWN_SENDER_LABELS, key)));
}

// ─── Effacement (RGPD) ────────────────────────────────────────────────────

export type ErasureState = 'clear' | 'erased' | 'unverified';

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/**
 * Candidat effacé dans l'organisation ? Marqueur de l'inscription elle-même,
 * puis isCandidateErasedForOrg (marqueur d'une autre inscription de
 * l'organisation, registre global), comme à l'inscription. Registre illisible :
 * 'unverified', jamais 'clear'.
 */
export async function erasureStateOf(
  client: ErasureClient,
  organizationId: string,
  enrollment: Record<string, unknown>,
): Promise<ErasureState> {
  const tracking = isRecord(enrollment.tracking_data) ? enrollment.tracking_data : null;
  const marker = tracking?.[GDPR_ERASED_AT_KEY];
  if (marker !== undefined && marker !== null && marker !== false && marker !== '') return 'erased';
  try {
    const erased = await isCandidateErasedForOrg(client, {
      organizationId,
      linkedinIds: [enrollment.profile_id, enrollment.provider_id, enrollment.resolved_profile_id].map(textOrNull),
      linkedinUrl: textOrNull(enrollment.profile_url),
    });
    return erased ? 'erased' : 'clear';
  } catch (err) {
    console.error('[sequence-preview-values] contrôle d\'effacement impossible:', err);
    return 'unverified';
  }
}

// ─── Réponse ──────────────────────────────────────────────────────────────

export type PreviewSource = 'enrollment' | 'profile';

export interface PreviewItem {
  source: PreviewSource;
  /** Identifiant reçu : id de l'inscription, ou id du profil. */
  id: string;
  /** Ligne d'inscription lue (RLS de l'appelant) ou inscription construite par profileEnrollment. */
  enrollment: Record<string, unknown>;
}

export interface PreviewCandidateValues {
  source: PreviewSource;
  id: string;
  /** Valeurs des variables demandées, comme le moteur les calculera. */
  values: Record<string, string>;
  /** Variables demandées remplies à l'envoi seulement, annoncées entre crochets (gardées telles quelles dans une retouche). */
  at_send: Record<string, string>;
  missing: string[];
}

export type PreviewExclusionReason = 'gdpr_erased' | 'gdpr_unverified' | 'preview_failed';

export interface PreviewExcluded {
  source: PreviewSource;
  id: string;
  reason: PreviewExclusionReason;
  message: string;
}

export interface PreviewValuesResult {
  candidates: PreviewCandidateValues[];
  excluded: PreviewExcluded[];
  /** Variables de l'heure d'envoi, annoncées entre crochets, jamais résolues à l'aperçu. */
  send_time: Record<string, string>;
}

export interface PreviewAudience {
  organizationId: string;
  /** Appelant : seules ses propres variables personnelles sont données avec leur valeur. */
  callerUserId: string;
  /** Clés des textes de la séquence : les seules rendues. */
  keys: readonly string[];
  /** Séquences dont l'expéditeur est choisi à l'envoi (loadDrawnSenderSequences). */
  drawnSenderSequences: ReadonlySet<string>;
}

const EXCLUSION_MESSAGES: Record<PreviewExclusionReason, string> = {
  gdpr_erased: PREVIEW_ERASED_MESSAGE,
  gdpr_unverified: PREVIEW_UNVERIFIED_MESSAGE,
  preview_failed: PREVIEW_FAILED_MESSAGE,
};

type Outcome = { kind: 'values'; item: PreviewCandidateValues } | { kind: 'excluded'; item: PreviewExcluded };

async function previewOne(client: ContextClient, audience: PreviewAudience, item: PreviewItem): Promise<Outcome> {
  const { source, id } = item;
  const excluded = (reason: PreviewExclusionReason): Outcome => ({
    kind: 'excluded',
    item: { source, id, reason, message: EXCLUSION_MESSAGES[reason] },
  });
  const erasure = await erasureStateOf(client, audience.organizationId, item.enrollment);
  if (erasure !== 'clear') return excluded(erasure === 'erased' ? 'gdpr_erased' : 'gdpr_unverified');

  const sender = await withoutLegacySender(client, audience.organizationId, item.enrollment);
  if (!sender.ok) return excluded('preview_failed');
  const drawn = await senderDrawnAtSend(client, { ...item, enrollment: sender.enrollment }, audience.drawnSenderSequences);
  if (drawn === null) return excluded('preview_failed');

  const trace = emptyTrace();
  const ctx = await engineContext(client, sender.enrollment, trace);
  if (trace.failedReads.length > 0) {
    console.error(`[sequence-preview-values] lectures en échec pour ${source} ${id}:`, trace.failedReads.join(', '));
    return excluded('preview_failed');
  }
  const { values, at_send } = splitPreviewValues(ctx, trace, {
    keys: audience.keys,
    callerUserId: audience.callerUserId,
    senderDrawnAtSend: drawn,
  });
  return { kind: 'values', item: { source, id, values, at_send, missing: missingPreviewKeys(ctx, drawn) } };
}

/**
 * Valeurs de chaque candidat, dans l'ordre reçu. Les lectures passent par le
 * client donné (clé de service, organisation déjà vérifiée par l'appelant).
 */
export async function buildPreviewValues(
  client: ContextClient,
  audience: PreviewAudience,
  items: readonly PreviewItem[],
): Promise<PreviewValuesResult> {
  const outcomes: Outcome[] = [];
  for (let start = 0; start < items.length; start += CONCURRENCY) {
    const batch = items.slice(start, start + CONCURRENCY);
    outcomes.push(...await Promise.all(batch.map((item) => previewOne(client, audience, item))));
  }
  return {
    candidates: outcomes.flatMap((o) => (o.kind === 'values' ? [o.item] : [])),
    excluded: outcomes.flatMap((o) => (o.kind === 'excluded' ? [o.item] : [])),
    send_time: { ...SEND_TIME_VARIABLES },
  };
}

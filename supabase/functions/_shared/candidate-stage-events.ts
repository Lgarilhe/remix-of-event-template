/**
 * Refonte mission, lot 0b-2a : appels serveur aux écrivains de l'étape
 * candidat (fonctions SQL du lot 0b-1, migration 20260928235358).
 *
 * - candidateRef : le candidat tel que le lisent les fonctions SQL
 *   ({ ids, slug, profile_url, name, headline }).
 * - recordOutbound, recordInbound, recordOwnMessage, recordReplySummary,
 *   resolveMeetingMission, recordMeeting : un appel typé par fonction SQL,
 *   avec exactement ses paramètres (tous transmis, NULL compris).
 * - classifyStageRpcError (décision 9 du plan 0b) : refus métier et fonction
 *   absente sont journalisés sans rejeu ; toute autre erreur est transitoire
 *   et seul unipile-webhook la rejoue (réponse 500).
 *
 * Les fonctions SQL ne sont ouvertes qu'à service_role : le client est
 * toujours le client admin (clé de service). Aucun appel ne lève : le
 * résultat porte l'erreur et son classement, l'appelant décide.
 *
 *   deno test --no-check --allow-read supabase/functions/_shared/candidate-stage-events.test.ts
 */

/** Ce que ce module demande au client Supabase (client admin, toute version de supabase-js). */
export interface StageRpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

// ─── Candidat ──────────────────────────────────────────────────────────────

/** Candidat au format jsonb des fonctions SQL (candidate_ref_ids, candidate_ref_slug). */
export interface CandidateRef {
  ids: string[];
  slug?: string;
  profile_url?: string;
  name?: string;
  headline?: string;
}

export interface CandidateRefInput {
  /** Identifiants LinkedIn (classique, Recruiter, URN). Le premier devient candidate_id d'une ligne ou d'un lien créé. */
  ids?: Array<string | null | undefined>;
  /** Identifiant public (slug) ; une URL de profil est aussi acceptée. */
  slug?: string | null;
  profileUrl?: string | null;
  name?: string | null;
  headline?: string | null;
}

/** Longueur maximale d'un identifiant, comme candidate_ref_ids. */
const MAX_CANDIDATE_ID_LENGTH = 512;

/** Slug d'une URL de profil, comme linkedin_url_slug en SQL. */
function linkedInUrlSlug(url: string): string | null {
  const match = url.toLowerCase().match(/linkedin\.com\/in\/([^/?#\s]+)/);
  return match ? match[1] : null;
}

function trimmed(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

/**
 * Candidat pour les fonctions SQL : identifiants sans espaces autour, sans
 * vide ni doublon, dans l'ordre donné ; slug en minuscules, tiré de l'URL
 * de profil s'il manque ; champs vides retirés.
 */
export function candidateRef(input: CandidateRefInput): CandidateRef {
  const ids: string[] = [];
  for (const raw of input.ids ?? []) {
    const id = trimmed(raw);
    if (id && id.length <= MAX_CANDIDATE_ID_LENGTH && !ids.includes(id)) ids.push(id);
  }
  const ref: CandidateRef = { ids };
  const explicitSlug = trimmed(input.slug);
  const profileUrl = trimmed(input.profileUrl);
  const slugFromInput = explicitSlug && /linkedin\.com\/in\//i.test(explicitSlug)
    ? linkedInUrlSlug(explicitSlug)
    : explicitSlug?.toLowerCase() ?? null;
  const slug = slugFromInput ?? (profileUrl ? linkedInUrlSlug(profileUrl) : null);
  if (slug) ref.slug = slug;
  if (profileUrl) ref.profile_url = profileUrl;
  const name = trimmed(input.name);
  if (name) ref.name = name;
  const headline = trimmed(input.headline);
  if (headline) ref.headline = headline;
  return ref;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Identifiant de mission reçu d'un appelant (job.id du Sourcing ou id de
 * sourcing_projects) : préfixe project: retiré, forme uuid exigée, sinon null.
 */
export function missionIdFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().replace(/^project:/, '');
  return UUID_RE.test(v) ? v.toLowerCase() : null;
}

// ─── Erreurs (décision 9) ──────────────────────────────────────────────────

/**
 * business : refus métier, journalisé sans rejeu.
 * missing : fonction absente ou paramètres qui ne correspondent à aucune
 *   signature (PGRST202), journalisé sans rejeu.
 * transient : tout le reste (réseau, délai, verrou, 5xx) ; le webhook rejoue.
 */
export type StageRpcErrorKind = 'business' | 'missing' | 'transient';

const BUSINESS_CODES = new Set(['22023', 'P0002', '42501']);
const MISSING_CODES = new Set(['PGRST202', '42883']);
const BUSINESS_HINT_RE = /^(STAGE|MISSION|LINK)_/;

function stringField(err: unknown, key: string): string | null {
  if (!err || typeof err !== 'object') return null;
  const v = (err as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : null;
}

export function classifyStageRpcError(err: unknown): StageRpcErrorKind {
  const code = (stringField(err, 'code') ?? '').trim().toUpperCase();
  const hint = (stringField(err, 'hint') ?? '').trim();
  if (MISSING_CODES.has(code)) return 'missing';
  if (BUSINESS_CODES.has(code) || BUSINESS_HINT_RE.test(hint)) return 'business';
  return 'transient';
}

export interface StageRpcError {
  code: string | null;
  message: string;
  hint: string | null;
  details: string | null;
}

export type StageRpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; fn: string; kind: StageRpcErrorKind; error: StageRpcError };

function toStageRpcError(err: unknown): StageRpcError {
  const message = stringField(err, 'message') ?? (typeof err === 'string' ? err : String(err));
  return { code: stringField(err, 'code'), message, hint: stringField(err, 'hint'), details: stringField(err, 'details') };
}

async function callStageRpc<T>(client: StageRpcClient, fn: string, args: Record<string, unknown>): Promise<StageRpcResult<T>> {
  try {
    const { data, error } = await client.rpc(fn, args);
    if (error) return { ok: false, fn, kind: classifyStageRpcError(error), error: toStageRpcError(error) };
    return { ok: true, data: data as T };
  } catch (err) {
    return { ok: false, fn, kind: classifyStageRpcError(err), error: toStageRpcError(err) };
  }
}

// ─── Résultats des fonctions SQL ───────────────────────────────────────────

export type GeneralStage = 'to_sort' | 'retained' | 'contacted' | 'replied' | 'interviewing' | 'hired' | 'rejected';

/** Une ligne de set_candidate_stages (résultat de set_candidate_stage, ou skipped, ou error par ligne). */
export interface StageRowResult {
  id: string;
  changed: boolean;
  result: 'updated' | 'unchanged' | 'kept' | 'not_contacted' | 'skipped' | 'error';
  general_stage?: GeneralStage;
  process_step_id?: string | null;
  stage_entered_at?: string | null;
  decision_source?: 'ai' | 'user' | 'system' | null;
  /** Refus rendu par ligne (result 'error'). */
  code?: string;
  hint?: string | null;
  message?: string;
}

/** explicit, enrollment : mission donnée ; chat, profile, rows : résolue (resolve_conversation_mission) ; single_mission : rendez-vous. */
export type MissionVia = 'explicit' | 'enrollment' | 'chat' | 'profile' | 'rows' | 'single_mission';

export type OutboundResult =
  | { project_id: null; reason: 'missing_input' | 'no_mission' }
  | { project_id: string; via: MissionVia; link_id: string | null; rows: StageRowResult[] };

export type InboundResult =
  | { project_id: null; reason: 'missing_input' | 'no_mission' }
  | { project_id: string; via: MissionVia; reason: 'before_contact' }
  | { project_id: string; via: MissionVia; link_id: string | null; contacted_rows: StageRowResult[]; rows: StageRowResult[] };

export type OwnMessageResult =
  | { result: 'missing_input' | 'konekt_send' | 'no_candidate' }
  | { result: 'invitation_note'; link_id: string }
  | { result: 'linked' | 'contacted'; project_id: string; link_id: string | null; rows: StageRowResult[] }
  | { result: 'not_retained' | 'ambiguous'; missions: number };

export interface ReplySummaryResult {
  project_id: string | null;
  via?: MissionVia;
  updated: number;
}

export interface MeetingMission {
  project_id: string;
  via: MissionVia;
}

export type MeetingResult =
  | { project_id: null; reason: 'no_mission' }
  | { project_id: string; process_step_id: string | null; rows: StageRowResult[] };

// ─── Appels ────────────────────────────────────────────────────────────────

/** Origine d'un lien créé par un envoi (les autres valeurs sont posées par le SQL). */
export type OutboundSource = 'manual' | 'sequence' | 'inmail_queue' | 'assistant';
export type SendKind = 'message' | 'inmail' | 'invitation';

export interface RecordOutboundInput {
  organizationId: string;
  /** Compte LinkedIn d'envoi ; sans compte, rien n'est écrit (missing_input). */
  accountId: string | null;
  candidate: CandidateRef;
  source: OutboundSource;
  /** Mission explicite (uuid, voir missionIdFrom) ; ignorée si elle n'est pas à l'organisation. */
  projectId?: string | null;
  chatId?: string | null;
  messageId?: string | null;
  enrollmentId?: string | null;
  /** Auteur d'une ligne À trier créée si le candidat n'en a aucune dans la mission (décision 6). */
  createdBy?: string | null;
  /** Marqueur avant l'envoi : lien seulement, sans « Contacté ». */
  pending?: boolean;
  sendKind?: SendKind;
}

/** record_candidate_outbound : envoi Konekt (ou son marqueur) ; lien, puis « Contacté » en origine system. */
export function recordOutbound(client: StageRpcClient, input: RecordOutboundInput): Promise<StageRpcResult<OutboundResult>> {
  return callStageRpc(client, 'record_candidate_outbound', {
    p_organization_id: input.organizationId,
    p_account_id: input.accountId ?? null,
    p_candidate: input.candidate,
    p_source: input.source,
    p_project_id: input.projectId ?? null,
    p_chat_id: input.chatId ?? null,
    p_message_id: input.messageId ?? null,
    p_enrollment_id: input.enrollmentId ?? null,
    p_created_by: input.createdBy ?? null,
    // Jamais NULL : en SQL, NULL enregistrerait l'envoi sans poser « Contacté ».
    p_pending: input.pending === true,
    p_send_kind: input.sendKind ?? 'message',
  });
}

export interface RecordInboundInput {
  organizationId: string;
  accountId?: string | null;
  candidate: CandidateRef;
  chatId?: string | null;
  /** Inscriptions du candidat dans l'organisation. Absentes ou vides : le serveur les cherche. */
  enrollmentIds?: Array<string | null | undefined> | null;
  /** Réponse vue par une inscription, sans conversation : sa mission d'abord (décision 4). */
  enrollmentFirst?: boolean;
  /** Rattrapage : date ISO du dernier message du candidat ; rien avant le premier contact dans la mission. */
  receivedAt?: string | null;
}

/** record_candidate_inbound : réponse d'un candidat, bornée à la mission résolue (décisions 3, 4, 13). */
export function recordInbound(client: StageRpcClient, input: RecordInboundInput): Promise<StageRpcResult<InboundResult>> {
  const enrollmentIds = [...new Set((input.enrollmentIds ?? []).map((id) => trimmed(id)).filter((id): id is string => id !== null))];
  return callStageRpc(client, 'record_candidate_inbound', {
    p_organization_id: input.organizationId,
    p_account_id: input.accountId ?? null,
    p_candidate: input.candidate,
    p_chat_id: input.chatId ?? null,
    // Un tableau vide couperait la recherche des inscriptions par le serveur (rang 3).
    p_enrollment_ids: enrollmentIds.length > 0 ? enrollmentIds : null,
    p_enrollment_first: input.enrollmentFirst === true,
    p_received_at: input.receivedAt ?? null,
  });
}

export interface RecordOwnMessageInput {
  organizationId: string;
  accountId: string | null;
  chatId: string | null;
  messageId: string | null;
  /** L'autre participant s'il est connu ; sinon celui de la conversation liée. */
  candidate?: CandidateRef | null;
}

/** record_own_message : message écrit depuis le compte du recruteur (décision 5). */
export function recordOwnMessage(client: StageRpcClient, input: RecordOwnMessageInput): Promise<StageRpcResult<OwnMessageResult>> {
  return callStageRpc(client, 'record_own_message', {
    p_organization_id: input.organizationId,
    p_account_id: input.accountId ?? null,
    p_chat_id: input.chatId ?? null,
    p_message_id: input.messageId ?? null,
    p_candidate: input.candidate ?? { ids: [] },
  });
}

export interface RecordReplySummaryInput {
  organizationId: string;
  accountId: string | null;
  chatId: string | null;
  candidate: CandidateRef;
  summary: string | null;
}

/** record_reply_summary : résumé d'une réponse sur les lignes contactées de la mission résolue. */
export function recordReplySummary(client: StageRpcClient, input: RecordReplySummaryInput): Promise<StageRpcResult<ReplySummaryResult>> {
  return callStageRpc(client, 'record_reply_summary', {
    p_organization_id: input.organizationId,
    p_account_id: input.accountId ?? null,
    p_chat_id: input.chatId ?? null,
    p_candidate: input.candidate,
    p_summary: input.summary ?? null,
  });
}

export interface ResolveMeetingMissionInput {
  organizationId: string;
  candidate: CandidateRef;
}

/** resolve_meeting_mission : mission d'un rendez-vous, ou null (aucune, ou plusieurs sans lien). */
export async function resolveMeetingMission(
  client: StageRpcClient,
  input: ResolveMeetingMissionInput,
): Promise<StageRpcResult<MeetingMission | null>> {
  const res = await callStageRpc<MeetingMission[] | MeetingMission | null>(client, 'resolve_meeting_mission', {
    p_organization_id: input.organizationId,
    p_candidate: input.candidate,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, data: row?.project_id ? { project_id: row.project_id, via: row.via } : null };
}

export interface RecordMeetingInput {
  organizationId: string;
  projectId: string;
  candidate: CandidateRef;
}

/** record_candidate_meeting : entretien en origine system, première étape d'entretien de la mission. */
export function recordMeeting(client: StageRpcClient, input: RecordMeetingInput): Promise<StageRpcResult<MeetingResult>> {
  return callStageRpc(client, 'record_candidate_meeting', {
    p_organization_id: input.organizationId,
    p_project_id: input.projectId,
    p_candidate: input.candidate,
  });
}

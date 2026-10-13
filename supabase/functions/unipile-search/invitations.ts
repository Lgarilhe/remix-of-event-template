/**
 * Actions `list_sent_invitations` et `withdraw_invitation` de unipile-search : les invitations LinkedIn
 * envoyées et encore en attente, avec leur ancienneté, et leur retrait à la main.
 *
 * Retrait (`withdraw_invitation`)
 *  - La route du prestataire annule une demande envoyée OU refuse une demande reçue. Le retrait ne doit
 *    jamais refuser une demande reçue : l'invitation est donc retrouvée d'abord dans les invitations
 *    ENVOYÉES du compte, et refusée comme introuvable sinon. Cette lecture donne aussi la personne invitée,
 *    nécessaire pour rattacher le retrait à une inscription.
 *  - Le retrait est inscrit au registre des actions LinkedIn (`linkedin_action_log`, type
 *    `invitation_withdraw`). Il ne compte dans aucun plafond : les plafonds ne lisent que les types
 *    qu'ils connaissent. Sa source commence par `manual` : comme tout geste manuel sur le compte, il
 *    repousse de 5 minutes les InMails programmés et les enrichissements de ce compte (espacer les actions
 *    sur un même compte est voulu).
 *  - Inscriptions de l'organisation de l'appelant, sur ce compte, pour cette personne : `connection_status`
 *    passe à `withdrawn` (déjà lu comme « non connecté » par les statistiques). Une attente de connexion
 *    d'une inscription active n'attend plus une acceptation qui ne viendra pas : sa date de début est
 *    reculée au-delà de tout délai, et le contrôle des délais du moteur la franchit par sa branche
 *    « non accepté », comme à l'échéance normale. Le moteur reste le seul à avancer une séquence.
 *  - Retrouver l'invitation lit au plus 10 pages et 30 secondes. Une liste plus longue ou un prestataire
 *    lent rend `INVITATION_LOOKUP_INCOMPLETE` (503) : l'invitation peut exister, l'écran ne la retire pas.
 *  - Si le retrait a réussi mais que la mise à jour des inscriptions échoue, la réponse reste un succès :
 *    `enrollments_synced` vaut alors `false` et l'erreur est dans les journaux.
 */

import {
  encodeOffsetCursor,
  listSentRelationRequests,
  withdrawRelationRequest,
  type RelationRequest,
} from '../_shared/unipile/index.ts';
import { effectiveWaitTimeoutDays, waitsForConnection } from '../_shared/sequence-wait-rules.ts';
import { clampLimit, offsetOfCursor } from './recruiter-projects.ts';
import { failureResponse, json } from './responses.ts';

// Identité d'une personne, comme `_shared/candidate-reply-closure.ts` (webhook) : identifiants LinkedIn assainis pour un
// filtre PostgREST, et slug public exact de l'adresse de profil. Recopiée ici : ce module-là tire le moteur de séquences.

/** Identifiants LinkedIn assainis (ni virgule, ni parenthèse, ni guillemet), sans doublon. */
export function candidateIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => v.replace(/[^a-zA-Z0-9_\-:]/g, ''))
    .filter((v) => v.length > 0))];
}

/** Slug public d'une adresse de profil LinkedIn (/in/{slug}), en minuscules. */
export function linkedInSlugOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/** Slugs de la personne, depuis des adresses de profil ou des identifiants publics bruts. */
export function candidateSlugs(values: Array<string | null | undefined>): string[] {
  const slugs = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const raw = value.trim();
    const slug = /linkedin\.com\/in\//i.test(raw) ? linkedInSlugOf(raw) : (/^[^/?#\s]+$/.test(raw) ? raw.toLowerCase() : null);
    if (slug) slugs.add(slug);
  }
  return [...slugs];
}

const DAY_MS = 86_400_000;
const REQUEST_ID_RE = /^[\w.:-]{1,200}$/;
/** Pages de 100 lues au plus pour retrouver une invitation avant de la retirer. */
const LOOKUP_MAX_PAGES = 10;
const LOOKUP_PAGE_SIZE = 100;
/** Durée maximale de la recherche de l'invitation, lectures du prestataire comprises (limite de la fonction : 60 s). */
export const LOOKUP_BUDGET_MS = 30_000;
const LOOKUP_INCOMPLETE_MESSAGE =
  'Votre liste d’invitations est trop longue ou trop lente à lire pour retrouver celle-ci. Réessayez dans un instant.';
const MAX_CURSOR_LENGTH = 2000;
/** Origine inscrite au registre des actions LinkedIn. */
export const WITHDRAW_LEDGER_TYPE = 'invitation_withdraw';
export const WITHDRAW_LEDGER_SOURCE = 'manual_invitations';
/** Valeur de `sequence_enrollments.connection_status` d'une invitation retirée (lue comme non connecté par les statistiques). */
export const WITHDRAWN_CONNECTION_STATUS = 'withdrawn';
const NOT_FOUND_MESSAGE = 'Cette invitation n’existe plus ou a déjà été traitée.';

/** Invitation envoyée telle que la lit l'écran. */
export interface SentInvitation {
  id: string;
  user_id: string | null;
  name: string | null;
  headline: string | null;
  profile_url: string | null;
  public_identifier: string | null;
  picture_url: string | null;
  message: string | null;
  sent_at: string | null;
  /** Jours entiers depuis l'envoi, `null` sans date. */
  age_days: number | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Demande du prestataire vers l'invitation de l'écran ; `null` pour une demande reçue ou sans identifiant. */
export function toSentInvitation(raw: RelationRequest | unknown, nowMs: number): SentInvitation | null {
  if (!raw || typeof raw !== 'object') return null;
  const request = raw as Record<string, unknown>;
  const id = typeof request.id === 'number' ? String(request.id) : text(request.id);
  if (!id || request.type === 'received') return null;
  const user = request.user && typeof request.user === 'object' ? (request.user as Record<string, unknown>) : {};
  const sentAt = text(request.created_at);
  const sentMs = sentAt ? Date.parse(sentAt) : Number.NaN;
  return {
    id,
    user_id: text(user.id),
    name: text(user.display_name),
    headline: text(user.headline) ?? text(user.description),
    profile_url: text(user.profile_url),
    public_identifier: text(user.public_identifier),
    picture_url: text(user.public_picture_url),
    message: text(request.message),
    sent_at: sentAt,
    age_days: Number.isFinite(sentMs) ? Math.max(0, Math.floor((nowMs - sentMs) / DAY_MS)) : null,
  };
}

/** Curseur de la page suivante : celui du prestataire, sinon un décalage quand le total dit qu'il en reste. */
function nextCursor(page: { items: unknown[]; nextCursor: string | null; totalCount: number | null }, offset: number): string | null {
  if (page.nextCursor !== null) return page.nextCursor;
  const next = offset + page.items.length;
  return page.items.length > 0 && page.totalCount !== null && next < page.totalCount ? encodeOffsetCursor(next) : null;
}

/** `cursor` de l'écran : un décalage `offset:<n>` ou le curseur du prestataire ; `null` s'il est inutilisable. */
function pagingOf(cursor: unknown): { cursor?: string; offset?: number } | null {
  if (cursor === undefined || cursor === null || cursor === '') return {};
  if (typeof cursor !== 'string' || cursor.length > MAX_CURSOR_LENGTH) return null;
  if (cursor.startsWith('offset:')) {
    const offset = offsetOfCursor(cursor);
    return offset === null ? null : { offset };
  }
  return { cursor };
}

export async function handleListSentInvitations(
  accountId: string,
  params: Record<string, unknown>,
  now: () => number = Date.now,
): Promise<Response> {
  const paging = pagingOf(params.cursor);
  if (paging === null) {
    return json({ success: false, error: 'La page demandée n’est plus valide. Relancez la liste.', errorType: 'INVALID_CURSOR' }, 400);
  }
  const limit = clampLimit(params.limit);
  try {
    const page = await listSentRelationRequests(accountId, { ...paging, limit });
    const nowMs = now();
    const invitations = page.items.map((r) => toSentInvitation(r, nowMs)).filter((i): i is SentInvitation => i !== null);
    return json({
      success: true,
      invitations,
      cursor: nextCursor(page, paging.offset ?? 0),
      total: page.totalCount,
    });
  } catch (error) {
    return failureResponse(error, 'list_sent_invitations', {}, { invitations: [] });
  }
}

// ---------------------------------------------------------------------------
// Retrait
// ---------------------------------------------------------------------------

/** Appelant d'un retrait : organisation vérifiée et utilisateur connecté. */
export interface WithdrawContext {
  organizationId: string;
  userId: string;
  // deno-lint-ignore no-explicit-any
  admin: () => any;
}

/**
 * Invitation envoyée de ce compte, retrouvée par son identifiant (10 pages de 100 et `LOOKUP_BUDGET_MS` au plus).
 * `complete` est faux quand la lecture s'est arrêtée avant la fin de la liste : une invitation absente n'est alors
 * pas prouvée inexistante.
 */
export async function findSentInvitation(
  accountId: string,
  requestId: string,
  now: () => number = Date.now,
): Promise<{ request: RelationRequest | null; complete: boolean }> {
  const startedAt = now();
  let cursor: string | undefined;
  let offset = 0;
  for (let page = 0; page < LOOKUP_MAX_PAGES; page++) {
    if (now() - startedAt >= LOOKUP_BUDGET_MS) return { request: null, complete: false };
    const result = await listSentRelationRequests(accountId, cursor !== undefined ? { cursor, limit: LOOKUP_PAGE_SIZE } : { offset, limit: LOOKUP_PAGE_SIZE });
    const hit = result.items.find((r) => r && String((r as { id?: unknown }).id) === requestId && (r as { type?: unknown }).type !== 'received');
    if (hit) return { request: hit, complete: true };
    if (result.items.length === 0) return { request: null, complete: true };
    offset += result.items.length;
    if (result.nextCursor !== null) {
      if (result.nextCursor === cursor) return { request: null, complete: true };
      cursor = result.nextCursor;
    } else if (result.totalCount === null || offset >= result.totalCount) {
      // Ni curseur ni total qui annonce une suite : fin de liste.
      return { request: null, complete: true };
    }
  }
  return { request: null, complete: false };
}

interface EnrollmentRow {
  id: string;
  status: string | null;
  connection_status: string | null;
  profile_url: string | null;
  profile_id: string | null;
  resolved_profile_id: string | null;
  provider_id: string | null;
  tracking_data: Record<string, unknown> | null;
}

const ENROLLMENT_COLUMNS = 'id, status, connection_status, profile_url, profile_id, resolved_profile_id, provider_id, tracking_data';
const UUID_COLUMN_ERROR = '22P02';

/** Cette inscription désigne-t-elle la personne invitée (identifiants LinkedIn, ou slug exact de l'adresse de profil) ? */
export function enrollmentIsInvitee(row: EnrollmentRow, ids: readonly string[], slugs: readonly string[]): boolean {
  if ([row.profile_id, row.resolved_profile_id, row.provider_id].some((v) => v && ids.includes(v))) return true;
  const slug = linkedInSlugOf(row.profile_url);
  return slug !== null && slugs.includes(slug);
}

/**
 * Inscriptions de l'organisation, sur ce compte (compte d'envoi puis expéditeur attribué, comme le webhook),
 * qui désignent la personne invitée. Les deux colonnes de compte sont lues à part : deux `or` dans une même
 * requête se lisent mal. Une colonne `assigned_sender_id` encore en uuid refuse un identifiant de compte
 * (22P02) : aucune ligne ne peut alors porter ce compte, le premier passage est gardé.
 */
// deno-lint-ignore no-explicit-any
async function inviteeEnrollments(admin: any, organizationId: string, accountId: string, user: { id: string | null; slugs: string[] }): Promise<EnrollmentRow[]> {
  const ids = candidateIds([user.id]);
  const found = new Map<string, EnrollmentRow>();
  for (const column of ['account_id', 'assigned_sender_id'] as const) {
    const base = () => admin.from('sequence_enrollments').select(ENROLLMENT_COLUMNS).eq('organization_id', organizationId).eq(column, accountId);
    const queries: PromiseLike<{ data: EnrollmentRow[] | null; error: { code?: string } | null }>[] = [];
    if (ids.length > 0) {
      queries.push(base().or(ids.flatMap((id) => [`profile_id.eq.${id}`, `resolved_profile_id.eq.${id}`, `provider_id.eq.${id}`]).join(',')));
    }
    for (const slug of user.slugs) {
      queries.push(base().ilike('profile_url', `%/in/${slug.replace(/([%_\\])/g, '\\$1')}%`));
    }
    for (const query of queries) {
      const { data, error } = await query;
      if (error) {
        if (column === 'assigned_sender_id' && error.code === UUID_COLUMN_ERROR) continue;
        throw error;
      }
      for (const row of data ?? []) if (enrollmentIsInvitee(row, ids, user.slugs)) found.set(row.id, row);
    }
  }
  return [...found.values()];
}

/** Attentes de connexion d'une inscription active, avec un délai : leur début est reculé, le contrôle des délais les franchit. */
// deno-lint-ignore no-explicit-any
async function expireConnectionWaits(admin: any, enrollment: EnrollmentRow, nowMs: number): Promise<number> {
  const { data, error } = await admin
    .from('sequence_step_executions')
    .select('id, step:sequence_steps!inner(id, action_type, wait_for_event, condition_type, timeout_days)')
    .eq('enrollment_id', enrollment.id)
    .eq('status', 'waiting_event');
  if (error) throw error;
  const overrides = (enrollment.tracking_data?.step_config_overrides ?? null) as Record<string, { timeoutDays?: number }> | null;
  let expired = 0;
  for (const execution of (data ?? []) as Array<{ id: string; step: { id: string; action_type: string | null; wait_for_event: string | null; condition_type: string | null; timeout_days: number | null } | null }>) {
    const step = execution.step;
    if (!step || !waitsForConnection(step)) continue;
    // Sans délai applicable, l'attente ne peut pas être franchie par ce contrôle : elle reste (limite connue).
    if (effectiveWaitTimeoutDays(step, overrides?.[step.id]?.timeoutDays) === null) continue;
    const { data: moved, error: moveError } = await admin
      .from('sequence_step_executions')
      .update({ scheduled_at: new Date(nowMs - 3650 * DAY_MS).toISOString() })
      .eq('id', execution.id)
      .eq('status', 'waiting_event')
      .select('id');
    if (moveError) throw moveError;
    expired += (moved ?? []).length;
  }
  return expired;
}

/** Inscriptions rattachées à l'invitation retirée : `withdrawn`, attentes de connexion franchissables. Renvoie le nombre mis à jour. */
export async function syncWithdrawnEnrollments(
  // deno-lint-ignore no-explicit-any
  admin: any,
  args: { organizationId: string; accountId: string; request: RelationRequest },
  nowMs: number = Date.now(),
): Promise<number> {
  const user = args.request.user;
  const slugs = candidateSlugs([user?.public_identifier, user?.profile_url]);
  const rows = (await inviteeEnrollments(admin, args.organizationId, args.accountId, { id: user?.id ?? null, slugs }))
    .filter((r) => r.connection_status !== 'connected' && r.connection_status !== WITHDRAWN_CONNECTION_STATUS);
  let updated = 0;
  for (const row of rows) {
    const { data, error } = await admin
      .from('sequence_enrollments')
      .update({ connection_status: WITHDRAWN_CONNECTION_STATUS })
      .eq('id', row.id)
      .eq('organization_id', args.organizationId)
      .or('connection_status.is.null,connection_status.neq.connected')
      .select('id');
    if (error) throw error;
    if ((data ?? []).length === 0) continue;
    updated++;
    if (row.status === 'active') await expireConnectionWaits(admin, row, nowMs);
  }
  return updated;
}

/** Inscrit le retrait au registre des actions LinkedIn. Au mieux : un échec est journalisé, le retrait est fait. */
export async function logWithdrawal(
  // deno-lint-ignore no-explicit-any
  admin: any,
  row: { organizationId: string; userId: string; accountId: string },
): Promise<void> {
  try {
    const { error } = await admin.from('linkedin_action_log').insert({
      organization_id: row.organizationId,
      user_id: row.userId || null,
      account_id: row.accountId,
      action_type: WITHDRAW_LEDGER_TYPE,
      source: WITHDRAW_LEDGER_SOURCE,
    });
    if (error) console.warn('[unipile-search] withdraw_invitation: registre non écrit:', error.message);
  } catch (e) {
    console.warn('[unipile-search] withdraw_invitation: registre non écrit:', e);
  }
}

export async function handleWithdrawInvitation(
  accountId: string,
  params: Record<string, unknown>,
  context: WithdrawContext,
  now: () => number = Date.now,
): Promise<Response> {
  const requestId = typeof params.request_id === 'number' ? String(params.request_id) : params.request_id;
  if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) {
    return json({ success: false, error: 'Invitation à retirer requise.', errorType: 'INVALID_REQUEST' }, 400);
  }

  let found: { request: RelationRequest | null; complete: boolean };
  try {
    found = await findSentInvitation(accountId, requestId, now);
  } catch (error) {
    return failureResponse(error, 'withdraw_invitation');
  }
  const request = found.request;
  if (!request) {
    // Une lecture interrompue ne prouve pas que l'invitation n'existe plus : l'écran la garde.
    return found.complete
      ? json({ success: false, error: NOT_FOUND_MESSAGE, errorType: 'INVITATION_NOT_FOUND' }, 404)
      : json({ success: false, error: LOOKUP_INCOMPLETE_MESSAGE, errorType: 'INVITATION_LOOKUP_INCOMPLETE' }, 503);
  }

  try {
    await withdrawRelationRequest(accountId, requestId);
  } catch (error) {
    return failureResponse(error, 'withdraw_invitation');
  }

  const admin = context.admin();
  await logWithdrawal(admin, { organizationId: context.organizationId, userId: context.userId, accountId });

  let enrollmentsUpdated = 0;
  let synced = true;
  try {
    enrollmentsUpdated = await syncWithdrawnEnrollments(admin, { organizationId: context.organizationId, accountId, request });
  } catch (e) {
    synced = false;
    console.error('[unipile-search] withdraw_invitation: inscriptions non mises à jour:', e);
  }
  return json({ success: true, request_id: requestId, enrollments_updated: enrollmentsUpdated, enrollments_synced: synced });
}

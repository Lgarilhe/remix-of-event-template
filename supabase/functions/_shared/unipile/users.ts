/**
 * People of the provider API (area "users-social"): profiles, profile visits,
 * relations, relation requests, recent posts and company profiles.
 *
 * Wire facts (see the users-social digest)
 *  - Every path is `/{account_id}/users/...` (or `/linkedin/company/...`);
 *    `me` stands for the owner of the account.
 *  - Reading a profile is SILENT: it never registers a visit. A visit is the
 *    explicit `POST /users/visit-profile?token=` with the
 *    `specifics.notify_visit_token` returned by the profile read.
 *  - Which identifier forms `{user_id}` accepts (provider id, slug, URL) is not
 *    settled by the spec (contract test D1). Reads therefore try the candidates
 *    of `userRef` in order (slug, then provider id) and move on only after a
 *    `not_found` or `validation` answer. Writes prefer the provider id.
 *  - A relation request is `POST /users/me/relation-requests {user_id, message?}`
 *    (201 `RelationRequest`). It follows the send outcome contract of
 *    `messaging.ts` (`sent` | `uncertain` | `refused`), never retried.
 *  - `with_sections` values are prefixed `linkedin_`; an array query parameter
 *    is serialised as a repeated key (the spec does not say which form the
 *    server expects: to confirm with the first live call).
 */

import { UnipileError } from './errors.ts';
import { unipileJson, unipileVoid, type TransportOptions } from './http.ts';
import { accountPath, userRef, type UserRefInput } from './ids.ts';
import { performSend, sendToUser, type SendResult } from './messaging.ts';
import { parsePage, type Page } from './pagination.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const SECTION_NAMES = [
  'experience',
  'education',
  'languages',
  'skills',
  'certifications',
  'volunteer_experience',
  'projects',
  'recommendations',
  'recruiting_activity',
  'interests',
] as const;

type SectionName = typeof SECTION_NAMES[number];

/** Values of the `with_sections` query parameter. */
export type ProfileSection =
  | 'linkedin_*'
  | 'linkedin_*_preview'
  | `linkedin_${SectionName}`
  | `linkedin_${SectionName}_preview`;

export const PROFILE_SECTIONS: readonly ProfileSection[] = [
  'linkedin_*',
  'linkedin_*_preview',
  ...SECTION_NAMES.map((name) => `linkedin_${name}` as const),
  ...SECTION_NAMES.map((name) => `linkedin_${name}_preview` as const),
];

export type ProfileVariant = 'linkedin_classic' | 'linkedin_recruiter' | 'linkedin_sales_navigator';

export interface LinkedInProfileSpecifics {
  readonly member_id?: string;
  readonly industry?: string;
  readonly can_send_inmail?: boolean;
  /** `SELF` | `FIRST_DEGREE` | `SECOND_DEGREE` | `THIRD_DEGREE` | `OUT_OF_NETWORK`. */
  readonly network_distance?: string;
  /** `PENDING` | `IGNORED` | `WITHDRAWN`. */
  readonly relation_request_status?: string;
  readonly relation_request?: RelationRequest;
  /** Token of `visitProfile`. */
  readonly notify_visit_token?: string;
  readonly is_open_profile?: boolean;
  readonly is_premium?: boolean;
  readonly is_open_to_work?: boolean;
  readonly is_hiring?: boolean;
  // Sections, present only when requested through `sections`.
  readonly experience?: readonly unknown[];
  readonly education?: readonly unknown[];
  readonly skills?: readonly unknown[];
  readonly languages?: readonly unknown[];
  readonly certifications?: readonly unknown[];
  readonly volunteer_experience?: readonly unknown[];
  readonly projects?: readonly unknown[];
  readonly recommendations?: unknown;
  readonly interests?: unknown;
  /** Sections LinkedIn refused to serve (names without the `linkedin_` prefix). */
  readonly throttled_sections?: readonly string[];
  readonly [key: string]: unknown;
}

/** A v2 `UserProfile`, minimal. The headline is not a documented field (likely `description`). */
export interface UserProfile {
  readonly id: string;
  readonly public_identifier?: string;
  readonly display_name: string;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly description?: string;
  /** About section. */
  readonly bio?: string;
  readonly location?: string;
  readonly profile_url?: string;
  readonly public_picture_url?: string;
  readonly followers_count?: number;
  readonly relations_count?: number;
  readonly shared_relations_count?: number;
  readonly is_following?: boolean;
  readonly is_blocked?: boolean;
  readonly emails?: readonly string[];
  readonly phone_numbers?: readonly string[];
  readonly websites?: readonly string[];
  readonly provider?: string;
  readonly specifics: LinkedInProfileSpecifics | null;
  readonly [key: string]: unknown;
}

export interface ProfileUser {
  readonly id: string;
  readonly display_name?: string;
  readonly public_identifier?: string;
  readonly profile_url?: string;
  readonly [key: string]: unknown;
}

export interface UserRelation {
  /** Id of the relation itself, the person is `user`. */
  readonly id: string;
  readonly created_at?: string;
  readonly user: ProfileUser;
}

export interface RelationRequest {
  readonly id: string;
  readonly type: 'sent' | 'received' | string;
  readonly created_at?: string;
  readonly message?: string;
  readonly user?: ProfileUser;
}

export interface UserPost {
  readonly id: string;
  readonly text?: string;
  readonly created_at?: string;
  readonly share_url?: string;
  readonly is_repost?: boolean;
  readonly reactions_counter?: ReadonlyArray<{ readonly reaction: string; readonly count: number }> | null;
  readonly comments_counter?: number | null;
  readonly reposts_counter?: number | null;
  readonly [key: string]: unknown;
}

export interface CompanyProfile {
  readonly id: string;
  readonly name: string;
  readonly public_identifier?: string;
  readonly profile_url?: string;
  readonly description?: string;
  readonly tagline?: string;
  readonly website?: string;
  readonly followers_count?: number;
  readonly industry?: readonly string[];
  readonly locations?: readonly unknown[];
  readonly insights?: unknown;
  readonly funding?: unknown;
  readonly [key: string]: unknown;
}

export interface PagingParams {
  cursor?: string;
  offset?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function invalid(note: string): UnipileError {
  return new UnipileError('validation', { debug: { note } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TRY_NEXT_KINDS = ['validation', 'not_found'];

/** Runs a read with each candidate form of a user reference until one is accepted. */
async function readWithRefs<T>(
  user: string | UserRefInput,
  run: (userId: string) => Promise<T>,
): Promise<T> {
  const ref = userRef(user);
  if (!ref) throw invalid('no usable user reference');
  let lastError: unknown;
  for (const candidate of ref.candidates) {
    try {
      return await run(candidate.value);
    } catch (error) {
      if (!(error instanceof UnipileError) || !TRY_NEXT_KINDS.includes(error.kind)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function paging(params: PagingParams): Record<string, string | number | undefined> {
  return { cursor: params.cursor, offset: params.offset, limit: params.limit };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export interface GetProfileParams {
  sections?: readonly ProfileSection[];
  variant?: ProfileVariant;
}

/**
 * `GET /{acc}/users/{user}`: a silent profile read. `user` is a slug, a provider
 * id, a profile URL, `me`, or the known pieces; the forms are tried in order.
 */
export async function getProfile(
  accountId: string,
  user: string | UserRefInput,
  params: GetProfileParams = {},
  options: TransportOptions = {},
): Promise<UserProfile> {
  for (const section of params.sections ?? []) {
    if (!PROFILE_SECTIONS.includes(section)) throw invalid(`unknown profile section: ${String(section)}`);
  }
  return await readWithRefs(user, async (userId) => {
    const body = await unipileJson(
      {
        path: accountPath(accountId, 'users', userId),
        query: { with_sections: params.sections ? [...params.sections] : undefined, variant: params.variant },
      },
      options,
    );
    if (!isRecord(body) || typeof body.id !== 'string') {
      throw new UnipileError('server', { code: 'invalid_profile', debug: { note: 'unreadable profile object', body } });
    }
    return body as unknown as UserProfile;
  });
}

/** The visit token of a profile read, or `null` when the provider gave none. */
export function notifyVisitToken(profile: Pick<UserProfile, 'specifics'>): string | null {
  const token = profile.specifics?.notify_visit_token;
  return typeof token === 'string' && token !== '' ? token : null;
}

/**
 * `POST /{acc}/users/visit-profile?token=`: reports a profile visit. A plain
 * profile read does NOT count as a visit. Resolves to whether the provider
 * confirmed the visit.
 */
export async function visitProfile(accountId: string, token: string, options: TransportOptions = {}): Promise<boolean> {
  if (typeof token !== 'string' || token.trim() === '') throw invalid('visit token must be a non-empty string');
  const body = await unipileJson(
    { method: 'POST', path: accountPath(accountId, 'users', 'visit-profile'), query: { token }, idempotent: true },
    options,
  );
  return isRecord(body) && body.object === 'ProfileVisited';
}

/** `GET /{acc}/users/{user}/posts`: posts created or shared by a person (reposts have `is_repost`). */
export function listUserPosts(
  accountId: string,
  user: string | UserRefInput,
  params: PagingParams = {},
  options: TransportOptions = {},
): Promise<Page<UserPost>> {
  return readWithRefs(user, async (userId) =>
    parsePage<UserPost>(
      await unipileJson({ path: accountPath(accountId, 'users', userId, 'posts'), query: paging(params) }, options),
    ));
}

/** `GET /{acc}/linkedin/company/{company}`. Whether a slug is accepted instead of the numeric id is not documented. */
export async function getCompany(accountId: string, companyId: string, options: TransportOptions = {}): Promise<CompanyProfile> {
  const body = await unipileJson({ path: accountPath(accountId, 'linkedin', 'company', companyId) }, options);
  if (!isRecord(body) || typeof body.id !== 'string') {
    throw new UnipileError('server', { code: 'invalid_company', debug: { note: 'unreadable company object', body } });
  }
  return body as unknown as CompanyProfile;
}

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

/** `GET /{acc}/users/{user}/relations` (default `me`): bi-directional relations, the person is `data[].user`. */
export function listRelations(
  accountId: string,
  user: string | UserRefInput = 'me',
  params: PagingParams & { search?: string } = {},
  options: TransportOptions = {},
): Promise<Page<UserRelation>> {
  return readWithRefs(user, async (userId) =>
    parsePage<UserRelation>(
      await unipileJson(
        { path: accountPath(accountId, 'users', userId, 'relations'), query: { search: params.search, ...paging(params) } },
        options,
      ),
    ));
}

/** `GET /{acc}/users/me/relation-requests?type=`: pending requests, sent or received (`type` is required). */
export async function listRelationRequests(
  accountId: string,
  type: 'sent' | 'received',
  params: PagingParams = {},
  options: TransportOptions = {},
): Promise<Page<RelationRequest>> {
  if (type !== 'sent' && type !== 'received') throw invalid('type must be sent or received');
  const body = await unipileJson(
    { path: accountPath(accountId, 'users', 'me', 'relation-requests'), query: { type, ...paging(params) } },
    options,
  );
  return parsePage<RelationRequest>(body);
}

/** Pending invitations sent by the account (NET-3). */
export function listSentRelationRequests(
  accountId: string,
  params: PagingParams = {},
  options: TransportOptions = {},
): Promise<Page<RelationRequest>> {
  return listRelationRequests(accountId, 'sent', params, options);
}

export interface SendRelationRequestInput {
  accountId: string;
  /** Provider id (preferred) or slug of the person. */
  user: string | UserRefInput;
  /** Note sent along with the request (LinkedIn limits it to 300 characters: truncate before). */
  message?: string;
}

export type RelationRequestOutcome = SendResult<{ requestId: string; request: RelationRequest }>;

/**
 * `POST /{acc}/users/me/relation-requests`: sends a connection request. Never
 * retried; an unknown user on the first form of the reference moves on to the
 * second one (nothing was done), any other failure ends the call.
 */
export async function sendRelationRequest(
  input: SendRelationRequestInput,
  options: TransportOptions = {},
): Promise<RelationRequestOutcome> {
  const path = accountPath(input.accountId, 'users', 'me', 'relation-requests');
  const message = typeof input.message === 'string' && input.message.trim() !== '' ? input.message : undefined;
  return await sendToUser(input.user, (userId) =>
    performSend(
      { method: 'POST', path, body: message === undefined ? { user_id: userId } : { user_id: userId, message } },
      (data) => {
        if (!isRecord(data) || typeof data.id !== 'string' || data.id === '') {
          return { ok: false, note: 'relation request answer has no id' };
        }
        return { ok: true, value: { requestId: data.id, request: data as unknown as RelationRequest } };
      },
      options,
    ));
}

/** `POST /{acc}/users/me/relation-requests/{request}/accept`: accepts a received request. */
export async function acceptRelationRequest(accountId: string, requestId: string, options: TransportOptions = {}): Promise<void> {
  await unipileVoid(
    { method: 'POST', path: accountPath(accountId, 'users', 'me', 'relation-requests', requestId, 'accept'), idempotent: true },
    options,
  );
}

/** `POST /{acc}/users/me/relation-requests/{request}/cancel`: withdraws a sent request, or refuses a received one. */
export async function cancelRelationRequest(accountId: string, requestId: string, options: TransportOptions = {}): Promise<void> {
  await unipileVoid(
    { method: 'POST', path: accountPath(accountId, 'users', 'me', 'relation-requests', requestId, 'cancel'), idempotent: true },
    options,
  );
}

/** Withdraws a sent invitation (same call as `cancelRelationRequest`). */
export const withdrawRelationRequest = cancelRelationRequest;

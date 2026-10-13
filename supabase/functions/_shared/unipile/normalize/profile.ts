/**
 * Profile, account and InMail credit normalisers.
 *
 * The provider API (v2) answers with new shapes; Konekt code (front end,
 * scoring, sequence engine) reads the legacy `LinkedInProfile`-like shape that
 * `unipile-search` used to return (`src/components/outreach/types.ts`,
 * `_shared/profile-data.ts`). These functions translate once, here, so callers
 * change little. Rules:
 *
 *  - Pure: no network, no database, no `Deno` API.
 *  - Never throw. A missing, null or malformed field becomes `null`; a section
 *    the provider did not send (not requested, throttled) is `null`, a section
 *    it sent empty is `[]`.
 *  - Dates `MM/DD/YYYY` become `{ year, month }` (`toKonektDate`).
 *  - The headline and the location of a v2 profile are not where the spec
 *    says (the spec is silent): several candidate paths are read and the one
 *    used is reported through the optional `onDiagnostic` callback.
 *
 * Source paths of every emitted field are listed next to its definition below.
 */

import { isReconnectable, isSendable, type KonektAccountStatus, mapAccountStatus } from '../status.ts';

// ---------------------------------------------------------------------------
// Small readers (shared with search.ts and messages.ts)
// ---------------------------------------------------------------------------

export type Rec = Record<string, unknown>;

/** The value as a plain object, or `null`. */
export function asRecord(value: unknown): Rec | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : null;
}

/** A trimmed non-empty string, or `null`. A number is not coerced. */
export function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** A finite number, or `null`. A numeric string is not coerced. */
export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A boolean, or `null`. */
export function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** The value as an array, or `null` when it is not one (so `[]` stays distinguishable from "absent"). */
export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** Array of non-empty strings, or `null` when the value is not an array. */
export function asStringArray(value: unknown): string[] | null {
  const list = asArray(value);
  if (!list) return null;
  return list.map(asString).filter((s): s is string => s !== null);
}

/** Reads `a.b.c` from nested objects (array indexes allowed: `addresses.0`). */
export function readPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const key of path.split('.')) {
    if (Array.isArray(current)) {
      current = current[Number(key)];
    } else {
      const record = asRecord(current);
      if (!record) return undefined;
      current = record[key];
    }
  }
  return current;
}

/** First non-empty string among `paths`, with the path that gave it. */
export function pickString(root: unknown, paths: readonly string[]): { value: string | null; path: string | null } {
  for (const path of paths) {
    const value = asString(readPath(root, path));
    if (value !== null) return { value, path };
  }
  return { value: null, path: null };
}

/**
 * Items, next cursor and total of a list answer. Reads the provider envelope
 * (`data`, `next_cursor`, `total_count`; a thread's `emails`) and also the
 * already parsed page of `pagination.ts` (`items`, `nextCursor`, `totalCount`),
 * so a caller can hand over either what the transport gave or what a client
 * returned. A bare array is a list; anything else is an empty list.
 */
export function readListEnvelope(input: unknown): { items: unknown[]; nextCursor: string | null; total: number | null } {
  const raw = asRecord(input);
  return {
    items: asArray(raw?.data) ?? asArray(raw?.items) ?? asArray(raw?.emails) ?? (Array.isArray(input) ? input : []),
    nextCursor: asString(raw?.next_cursor) ?? asString(raw?.nextCursor),
    total: asNumber(raw?.total_count) ?? asNumber(raw?.totalCount),
  };
}

// ---------------------------------------------------------------------------
// Dates, distances, identifiers
// ---------------------------------------------------------------------------

/** Legacy date: `{ year, month }`, month `null` when unknown. */
export interface KonektDate {
  year: number;
  month: number | null;
}

function validYear(year: number): boolean {
  return Number.isInteger(year) && year >= 1900 && year <= 2100;
}

function validMonth(month: number): number | null {
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

/**
 * Converts a provider date to `{ year, month }`.
 *
 * Accepts `MM/DD/YYYY` (the v2 format of experience and education), `MM/YYYY`,
 * `YYYY`, `YYYY-MM`, `YYYY-MM-DD` and ISO date-times, and the `{ year, month }`
 * object of older payloads. A first part above 12 with a second part up to 12
 * is read as day first. Anything else, and a year outside 1900..2100, gives `null`.
 */
export function toKonektDate(value: unknown): KonektDate | null {
  if (value === null || value === undefined) return null;
  const record = asRecord(value);
  if (record) {
    const year = typeof record.year === 'string' ? Number(record.year) : asNumber(record.year);
    if (year === null || !validYear(year)) return null;
    const monthRaw = typeof record.month === 'string' ? Number(record.month) : asNumber(record.month);
    return { year, month: monthRaw === null ? null : validMonth(monthRaw) };
  }
  if (typeof value === 'number') return validYear(value) ? { year: value, month: null } : null;
  const text = asString(value);
  if (!text) return null;
  let match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) {
    const [a, b, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (!validYear(year)) return null;
    return { year, month: validMonth(a) ?? (a > 12 ? validMonth(b) : null) };
  }
  match = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) {
    const year = Number(match[2]);
    return validYear(year) ? { year, month: validMonth(Number(match[1])) } : null;
  }
  match = /^(\d{4})(?:-(\d{1,2})(?:-\d{1,2})?)?(?:[T ].*)?$/.exec(text);
  if (match) {
    const year = Number(match[1]);
    return validYear(year) ? { year, month: match[2] ? validMonth(Number(match[2])) : null } : null;
  }
  return null;
}

/** v2 `FIRST_DEGREE`... or the older `DISTANCE_1`... or a number, to the closed provider enum. */
export function toNetworkDegree(value: unknown): 'SELF' | 'FIRST_DEGREE' | 'SECOND_DEGREE' | 'THIRD_DEGREE' | 'OUT_OF_NETWORK' | null {
  const key = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim().toUpperCase() : '';
  switch (key) {
    case 'SELF':
      return 'SELF';
    case '1':
    case 'DISTANCE_1':
    case 'FIRST_DEGREE':
      return 'FIRST_DEGREE';
    case '2':
    case 'DISTANCE_2':
    case 'SECOND_DEGREE':
      return 'SECOND_DEGREE';
    case '3':
    case 'DISTANCE_3':
    case 'THIRD_DEGREE':
      return 'THIRD_DEGREE';
    case 'OUT_OF_NETWORK':
      return 'OUT_OF_NETWORK';
    default:
      return null;
  }
}

/**
 * The legacy value of `network_distance`: `DISTANCE_1`, `DISTANCE_2`, `DISTANCE_3`
 * (what the front end compares to), `SELF` and `OUT_OF_NETWORK` unchanged.
 * Callers that need the provider enum read `network_degree` instead.
 */
export function toLegacyNetworkDistance(value: unknown): string | null {
  const degree = toNetworkDegree(value);
  switch (degree) {
    case 'FIRST_DEGREE':
      return 'DISTANCE_1';
    case 'SECOND_DEGREE':
      return 'DISTANCE_2';
    case 'THIRD_DEGREE':
      return 'DISTANCE_3';
    default:
      return degree;
  }
}

/**
 * Legacy `member_urn` from the provider's `member_id`: `urn:li:member:<digits>`
 * for a numeric id, an existing `urn:` value unchanged, otherwise `null`
 * (an alias is never invented).
 */
export function toMemberUrn(memberId: unknown): string | null {
  const id = typeof memberId === 'number' && Number.isFinite(memberId) ? String(memberId) : asString(memberId);
  if (!id) return null;
  if (/^urn:/i.test(id)) return id;
  return /^\d+$/.test(id) ? `urn:li:member:${id}` : null;
}

/** Slug from a `linkedin.com/in/<slug>` URL, or `null`. */
export function slugFromProfileUrl(url: unknown): string | null {
  const text = asString(url);
  if (!text) return null;
  const match = /linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/i.exec(text);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

// ---------------------------------------------------------------------------
// Section mappers (profile sections, also used by search results)
// ---------------------------------------------------------------------------

export interface KonektPosition {
  id: string | null;
  company: string | null;
  company_id: string | null;
  company_url: string | null;
  company_picture_url: string | null;
  industry: string[] | null;
  location: string | null;
  role: string | null;
  description: string | null;
  employment_type: string | null;
  workplace_type: string | null;
  current: boolean;
  skills: Array<{ name: string; endorsement_count: number }> | null;
  start: KonektDate | null;
  end: KonektDate | null;
}

/**
 * v2 `experience[]` / `work_experience[]` item to the legacy position.
 * `role` <- `job_title`; `company` <- `company.name` (a string, as before);
 * `start`/`end` <- `started_on`/`ended_on`; `current` is true when there is no
 * end date; `skills` strings become `{ name, endorsement_count: 0 }`.
 */
export function toKonektPosition(raw: unknown): KonektPosition {
  const item = asRecord(raw) ?? {};
  const company = asRecord(item.company) ?? {};
  const end = toKonektDate(item.ended_on ?? item.end);
  const skills = asArray(item.skills);
  return {
    id: asString(item.id),
    company: asString(company.name) ?? asString(item.company),
    company_id: asString(company.id),
    company_url: asString(company.profile_url),
    company_picture_url: asString(company.picture_url),
    industry: asStringArray(company.industries),
    location: asString(item.location),
    role: asString(item.job_title) ?? asString(item.role) ?? asString(item.position),
    description: asString(item.description),
    employment_type: asString(item.employment_type),
    workplace_type: asString(item.workplace_type),
    current: end === null,
    skills: skills
      ? skills.flatMap((s) => {
        const name = typeof s === 'string' ? asString(s) : asString(asRecord(s)?.name);
        return name ? [{ name, endorsement_count: 0 }] : [];
      })
      : null,
    start: toKonektDate(item.started_on ?? item.start),
    end,
  };
}

export interface KonektEducation {
  id: string | null;
  school: string | null;
  school_id: string | null;
  school_url: string | null;
  school_picture_url: string | null;
  degree: string | null;
  grade: string | null;
  description: string | null;
  activities: string | null;
  field_of_study: string | null;
  skills: string[] | null;
  start: KonektDate | null;
  end: KonektDate | null;
}

/**
 * v2 `education[]` item to the legacy entry. `school` <- `school.name`;
 * `field_of_study` <- `fields_of_study[]` joined with ", ".
 */
export function toKonektEducation(raw: unknown): KonektEducation {
  const item = asRecord(raw) ?? {};
  const school = asRecord(item.school) ?? {};
  const fields = asStringArray(item.fields_of_study);
  return {
    id: asString(item.id),
    school: asString(school.name) ?? asString(item.school),
    school_id: asString(school.id),
    school_url: asString(school.profile_url),
    school_picture_url: asString(school.picture_url),
    degree: asString(item.degree),
    grade: asString(item.grade),
    description: asString(item.description),
    activities: asString(item.activities),
    field_of_study: fields && fields.length > 0 ? fields.join(', ') : asString(item.field_of_study),
    skills: asStringArray(item.skills),
    start: toKonektDate(item.started_on ?? item.start),
    end: toKonektDate(item.ended_on ?? item.end),
  };
}

export interface KonektSkill {
  name: string;
  endorsement_count: number | null;
  endorsement_id: number | null;
  endorsed: boolean | null;
  insights: string[] | null;
}

/** v2 `skills[]` item (or a bare string) to the legacy skill; items without a name are dropped by the caller. */
export function toKonektSkill(raw: unknown): KonektSkill | null {
  if (typeof raw === 'string') {
    const name = asString(raw);
    return name ? { name, endorsement_count: null, endorsement_id: null, endorsed: null, insights: null } : null;
  }
  const item = asRecord(raw);
  const name = asString(item?.name);
  if (!item || !name) return null;
  return {
    name,
    endorsement_count: asNumber(item.endorsement_count),
    endorsement_id: asNumber(item.endorsement_id),
    endorsed: asBoolean(item.endorsed),
    insights: asStringArray(item.insights),
  };
}

export interface KonektLanguage {
  name: string;
  proficiency: string | null;
}

/** v2 `languages[]` item to `{ name, proficiency }`; the enum is lower-cased (`native_or_bilingual`). */
export function toKonektLanguage(raw: unknown): KonektLanguage | null {
  const item = asRecord(raw);
  const name = asString(item?.language) ?? asString(item?.name);
  if (!item || !name) return null;
  return { name, proficiency: asString(item.proficiency)?.toLowerCase() ?? null };
}

function mapSection<T>(value: unknown, mapper: (raw: unknown) => T | null): T[] | null {
  const list = asArray(value);
  if (!list) return null;
  return list.map(mapper).filter((entry): entry is T => entry !== null);
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface ProfileDiagnostic {
  /** Which logical field was resolved. */
  field: 'headline' | 'location' | 'summary';
  /** Path that gave the value (for example `description`), or `null` when none did. */
  path: string | null;
}

export interface ProfileOptions {
  /** Called once per resolved field (`headline`, `location`, `summary`) with the path used. */
  onDiagnostic?: (diagnostic: ProfileDiagnostic) => void;
}

/** Candidate paths, in order. The v2 spec names none for the headline: contract test D1 pins the real one. */
export const HEADLINE_PATHS = ['headline', 'specifics.headline', 'specifics.linkedin.headline', 'description'] as const;
export const LOCATION_PATHS = ['location', 'specifics.location', 'specifics.linkedin.location', 'addresses.0'] as const;
export const SUMMARY_PATHS = ['bio', 'summary', 'about', 'specifics.summary', 'specifics.about'] as const;

export interface KonektRecommendation {
  text: string | null;
  caption: string | null;
  actor: {
    first_name: string | null;
    last_name: string | null;
    provider_id: string | null;
    headline: string | null;
    public_identifier: string | null;
    public_profile_url: string | null;
  } | null;
}

function toKonektRecommendation(raw: unknown): KonektRecommendation | null {
  const item = asRecord(raw);
  if (!item) return null;
  const user = asRecord(item.user) ?? asRecord(item.actor);
  return {
    text: asString(item.text),
    caption: asString(item.caption),
    actor: user
      ? {
        first_name: asString(user.first_name),
        last_name: asString(user.last_name),
        provider_id: asString(user.id) ?? asString(user.provider_id),
        headline: asString(user.description) ?? asString(user.headline),
        public_identifier: asString(user.public_identifier),
        public_profile_url: asString(user.profile_url) ?? asString(user.public_profile_url),
      }
      : null,
  };
}

function toRecommendations(value: unknown): {
  received: KonektRecommendation[];
  received_total_count: number;
  given: KonektRecommendation[];
  given_total_count: number;
} | null {
  const record = asRecord(value);
  if (!record) return null;
  const received = mapSection(record.received, toKonektRecommendation) ?? [];
  const given = mapSection(record.given, toKonektRecommendation) ?? [];
  return { received, received_total_count: received.length, given, given_total_count: given.length };
}

export interface KonektContactInfo {
  emails: string[];
  phones: string[];
  /** Sic: the legacy key is spelled `adresses`. */
  adresses: string[];
  socials: Array<{ type: string; name: string }>;
}

function toContactInfo(raw: Rec): KonektContactInfo | null {
  const emails = asStringArray(raw.emails) ?? [];
  const phones = asStringArray(raw.phone_numbers) ?? [];
  const adresses = asStringArray(raw.addresses) ?? [];
  const socials: Array<{ type: string; name: string }> = [];
  const handles = asRecord(raw.social_handles);
  if (handles) {
    for (const [type, value] of Object.entries(handles)) {
      const handle = asRecord(value);
      const name = asString(handle?.name) ?? asString(handle?.url);
      if (name) socials.push({ type, name });
    }
  }
  if (emails.length + phones.length + adresses.length + socials.length === 0) return null;
  return { emails, phones, adresses, socials };
}

function toPrimaryLocale(raw: Rec, specifics: Rec): { country: string | null; language: string | null } | null {
  const locale = asString(specifics.default_locale);
  if (locale) {
    const match = /^([a-z]{2})[-_]([A-Za-z]{2})$/.exec(locale);
    if (match) return { language: match[1].toLowerCase(), country: match[2].toUpperCase() };
  }
  const language = asString(raw.language)?.toLowerCase() ?? (locale && /^[a-z]{2}$/i.test(locale) ? locale.toLowerCase() : null);
  return language ? { language, country: null } : null;
}

export interface KonektInvitation {
  type: 'SENT' | 'RECEIVED';
  status: 'PENDING' | 'IGNORED' | 'WITHDRAWN';
}

/** Legacy profile. Every key is always present; a missing value is `null`. */
export interface KonektProfile {
  id: string | null;
  provider_id: string | null;
  public_identifier: string | null;
  member_id: string | null;
  member_urn: string | null;
  recruiter_candidate_id: string | null;
  type: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  headline: string | null;
  summary: string | null;
  location: string | null;
  industry: string | null;
  profile_url: string | null;
  public_profile_url: string | null;
  profile_picture_url: string | null;
  profile_picture_url_large: string | null;
  background_picture_url: string | null;
  /** `DISTANCE_1`..`DISTANCE_3`, `SELF`, `OUT_OF_NETWORK` (the value the front end compares to). */
  network_distance: string | null;
  /** The provider enum (`FIRST_DEGREE`...), for the engine. */
  network_degree: string | null;
  can_send_inmail: boolean | null;
  open_to_work: boolean | null;
  is_open_to_work: boolean | null;
  premium: boolean | null;
  is_premium: boolean | null;
  open_profile: boolean | null;
  is_open_profile: boolean | null;
  is_hiring: boolean | null;
  is_influencer: boolean | null;
  is_creator: boolean | null;
  verified: boolean | null;
  pronoun: string | null;
  connections_count: number | null;
  followers_count: number | null;
  shared_connections_count: number | null;
  primary_locale: { country: string | null; language: string | null } | null;
  contact_info: KonektContactInfo | null;
  websites: string[] | null;
  pending_invitation: boolean | null;
  invitation: KonektInvitation | null;
  work_experience: KonektPosition[] | null;
  education: KonektEducation[] | null;
  skills: KonektSkill[] | null;
  languages: KonektLanguage[] | null;
  certifications: Array<{ name: string | null; organization: string | null; url: string | null }> | null;
  projects: Array<{ name: string | null; description: string | null; skills: string[] | null; start: KonektDate | null; end: KonektDate | null }> | null;
  volunteering_experience: Array<{ company: string | null; description: string | null; role: string | null; cause: string | null; start: KonektDate | null; end: KonektDate | null }> | null;
  recommendations: ReturnType<typeof toRecommendations>;
  tags: Array<{ id: string; name: string }> | null;
  notes: Array<{ project_id: string | null; content: string; created_at: number | null; author: string | null }> | null;
  recruiting_activity: Rec[] | null;
  throttled_sections: string[] | null;
}

/**
 * v2 `UserProfile` to the legacy profile. Source of each field:
 *
 *  id, provider_id <- id | public_identifier <- public_identifier (else slug of profile_url)
 *  member_id <- specifics.member_id | member_urn <- derived from member_id (`toMemberUrn`)
 *  recruiter_candidate_id <- null (a profile read has none) | type <- type
 *  name <- display_name | first_name, last_name <- first_name, last_name
 *  headline <- first of HEADLINE_PATHS | summary <- first of SUMMARY_PATHS (`bio` first)
 *  location <- first of LOCATION_PATHS | industry <- specifics.industry
 *  profile_url, public_profile_url <- profile_url
 *  profile_picture_url <- public_picture_url | profile_picture_url_large <- public_picture_url_large
 *  background_picture_url <- background_picture_url
 *  network_distance <- specifics.network_distance (legacy form) | network_degree <- same (provider enum)
 *  can_send_inmail, is_open_to_work (+ open_to_work), is_premium (+ premium), is_open_profile (+ open_profile),
 *  is_hiring, is_influencer, is_creator, pronoun <- specifics.* ; is_premium falls back to root is_premium
 *  verified <- is_verified
 *  connections_count <- relations_count | followers_count <- followers_count
 *  shared_connections_count <- shared_relations_count
 *  primary_locale <- specifics.default_locale, else language
 *  contact_info <- emails, phone_numbers, addresses, social_handles | websites <- websites
 *  invitation, pending_invitation <- specifics.relation_request(+_status)
 *  work_experience <- specifics.experience | education <- specifics.education | skills <- specifics.skills
 *  languages <- specifics.languages | certifications <- specifics.certifications
 *  projects <- specifics.projects | volunteering_experience <- specifics.volunteer_experience
 *  recommendations <- specifics.recommendations {received, given}
 *  tags, notes, recruiting_activity <- specifics.recruiting_profile.{tags, notes, events}
 *  throttled_sections <- specifics.throttled_sections
 *
 * Not available in v2 and always `null`: nothing else is invented (`interests`,
 * `hashtags`, `recently_hired`... are not emitted).
 */
export function toKonektProfile(input: unknown, options: ProfileOptions = {}): KonektProfile {
  const raw = asRecord(input) ?? {};
  const specifics = asRecord(raw.specifics) ?? {};
  const report = options.onDiagnostic;

  const headline = pickString(raw, HEADLINE_PATHS);
  const location = pickString(raw, LOCATION_PATHS);
  const summary = pickString(raw, SUMMARY_PATHS);
  if (report) {
    try {
      report({ field: 'headline', path: headline.path });
      report({ field: 'location', path: location.path });
      report({ field: 'summary', path: summary.path });
    } catch {
      // A failing diagnostics callback must never break normalisation.
    }
  }

  const profileUrl = asString(raw.profile_url);
  const degreeRaw = specifics.network_distance;
  const isOpenToWork = asBoolean(specifics.is_open_to_work);
  const isPremium = asBoolean(specifics.is_premium) ?? asBoolean(raw.is_premium);
  const isOpenProfile = asBoolean(specifics.is_open_profile);
  const relation = asRecord(specifics.relation_request);
  const relationType = asString(relation?.type)?.toUpperCase();
  const relationStatus = asString(specifics.relation_request_status)?.toUpperCase();
  const invitation: KonektInvitation | null = relation && (relationType === 'SENT' || relationType === 'RECEIVED')
    ? {
      type: relationType,
      status: relationStatus === 'IGNORED' || relationStatus === 'WITHDRAWN' ? relationStatus : 'PENDING',
    }
    : null;
  const recruiting = asRecord(specifics.recruiting_profile);
  const memberId = asString(specifics.member_id);

  return {
    id: asString(raw.id),
    provider_id: asString(raw.id),
    public_identifier: asString(raw.public_identifier) ?? slugFromProfileUrl(profileUrl),
    member_id: memberId,
    member_urn: toMemberUrn(memberId),
    recruiter_candidate_id: null,
    type: asString(raw.type),
    name: asString(raw.display_name),
    first_name: asString(raw.first_name),
    last_name: asString(raw.last_name),
    headline: headline.value,
    summary: summary.value,
    location: location.value,
    industry: asString(specifics.industry),
    profile_url: profileUrl,
    public_profile_url: profileUrl,
    profile_picture_url: asString(raw.public_picture_url),
    profile_picture_url_large: asString(raw.public_picture_url_large),
    background_picture_url: asString(raw.background_picture_url),
    network_distance: toLegacyNetworkDistance(degreeRaw),
    network_degree: toNetworkDegree(degreeRaw),
    can_send_inmail: asBoolean(specifics.can_send_inmail),
    open_to_work: isOpenToWork,
    is_open_to_work: isOpenToWork,
    premium: isPremium,
    is_premium: isPremium,
    open_profile: isOpenProfile,
    is_open_profile: isOpenProfile,
    is_hiring: asBoolean(specifics.is_hiring),
    is_influencer: asBoolean(specifics.is_influencer),
    is_creator: asBoolean(specifics.is_creator),
    verified: asBoolean(raw.is_verified),
    pronoun: asString(specifics.pronoun),
    connections_count: asNumber(raw.relations_count),
    followers_count: asNumber(raw.followers_count),
    shared_connections_count: asNumber(raw.shared_relations_count),
    primary_locale: toPrimaryLocale(raw, specifics),
    contact_info: toContactInfo(raw),
    websites: asStringArray(raw.websites),
    pending_invitation: invitation ? invitation.status === 'PENDING' : null,
    invitation,
    work_experience: mapSection(specifics.experience, (e) => asRecord(e) ? toKonektPosition(e) : null),
    education: mapSection(specifics.education, (e) => asRecord(e) ? toKonektEducation(e) : null),
    skills: mapSection(specifics.skills, toKonektSkill),
    languages: mapSection(specifics.languages, toKonektLanguage),
    certifications: mapSection(specifics.certifications, (c) => {
      const item = asRecord(c);
      if (!item) return null;
      return {
        name: asString(item.title) ?? asString(item.name),
        organization: asString(asRecord(item.organization)?.name) ?? asString(item.organization),
        url: asString(item.url),
      };
    }),
    projects: mapSection(specifics.projects, (p) => {
      const item = asRecord(p);
      if (!item) return null;
      return {
        name: asString(item.name),
        description: asString(item.description),
        skills: asStringArray(item.skills),
        start: toKonektDate(item.started_on),
        end: toKonektDate(item.ended_on),
      };
    }),
    volunteering_experience: mapSection(specifics.volunteer_experience, (v) => {
      const item = asRecord(v);
      if (!item) return null;
      return {
        company: asString(asRecord(item.organization)?.name) ?? asString(item.organization),
        description: asString(item.description),
        role: asString(item.role),
        cause: asString(item.cause),
        start: toKonektDate(item.started_on),
        end: toKonektDate(item.ended_on),
      };
    }),
    recommendations: toRecommendations(specifics.recommendations),
    tags: recruiting
      ? mapSection(recruiting.tags, (t) => {
        const item = asRecord(t);
        const id = asString(item?.id);
        const name = asString(item?.content);
        return id && name ? { id, name } : null;
      })
      : null,
    notes: recruiting
      ? mapSection(recruiting.notes, (n) => {
        const item = asRecord(n);
        const content = asString(item?.content);
        if (!item || !content) return null;
        const modified = asString(item.last_modified_at);
        const parsed = modified ? Date.parse(modified) : NaN;
        return {
          project_id: asString(item.project_id),
          content,
          created_at: Number.isFinite(parsed) ? parsed : null,
          author: asString(asRecord(item.author)?.display_name),
        };
      })
      : null,
    recruiting_activity: recruiting ? mapSection(recruiting.events, (e) => asRecord(e)) : null,
    throttled_sections: asStringArray(specifics.throttled_sections),
  };
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const LEGACY_ACCOUNT_TYPES: Record<string, string> = {
  linkedin: 'LINKEDIN',
  google: 'GOOGLE_OAUTH',
  outlook: 'OUTLOOK',
  imap: 'MAIL',
  whatsapp: 'WHATSAPP',
  telegram: 'TELEGRAM',
  instagram: 'INSTAGRAM',
  mock: 'MOCK',
};

export interface KonektAccount {
  /** The v2 id (`acc_...`). */
  id: string | null;
  /** The previous id when the account was migrated (`metadata.v1_account_id`). */
  v1_account_id: string | null;
  name: string | null;
  /** Legacy list projection: the account name. */
  identifier: string | null;
  provider: string | null;
  /** Legacy upper-case type (`LINKEDIN`, `GOOGLE_OAUTH`, `OUTLOOK`, `MAIL`, `WHATSAPP`). */
  type: string | null;
  /** Konekt status (`OK`, `CREDENTIALS`, `ERROR`, `DEGRADED`, `PARTIAL`, `LOCKED`). */
  status: KonektAccountStatus;
  /** The provider status as sent (`running`...), `null` when absent. */
  provider_status: string | null;
  is_locked: boolean;
  sendable: boolean;
  reconnectable: boolean;
  created_at: string | null;
  /** Owner id on the provider side. */
  user_id: string | null;
  products_connection_status: Record<string, string> | null;
  initial_sync_status: string | null;
  /**
   * `{ classic, recruiter, sales_navigator }` when the contracts of the account
   * were given (`options.contracts`), otherwise `null`. Classic is always true.
   */
  subscriptions: { classic: true; recruiter: boolean; sales_navigator: boolean } | null;
}

export interface AccountOptions {
  /** Result of `GET /linkedin/contracts` (`contracts[]`), to derive `subscriptions`. */
  contracts?: readonly unknown[];
}

/**
 * v2 `Account` to the legacy account projection of `unipile-accounts`.
 * `status` goes through `mapAccountStatus(status, is_locked)`; an unknown or
 * missing status is `ERROR`, never `OK`, so a doubt cannot let a send through.
 */
export function toKonektAccount(input: unknown, options: AccountOptions = {}): KonektAccount {
  const raw = asRecord(input) ?? {};
  const metadata = asRecord(raw.metadata) ?? {};
  const provider = asString(raw.provider)?.toLowerCase() ?? null;
  const isLocked = raw.is_locked === true;
  const status = mapAccountStatus(raw.status, isLocked);
  const productsRaw = asRecord(metadata.products_connection_status);
  let productStatuses: Record<string, string> | null = null;
  if (productsRaw) {
    productStatuses = {};
    for (const [key, value] of Object.entries(productsRaw)) {
      const text = asString(value);
      if (text) productStatuses[key] = text;
    }
  }
  let subscriptions: KonektAccount['subscriptions'] = null;
  if (options.contracts) {
    const licences = options.contracts.map((c) => asString(asRecord(c)?.product));
    subscriptions = { classic: true, recruiter: licences.includes('recruiter'), sales_navigator: licences.includes('sales_navigator') };
  }
  return {
    id: asString(raw.id),
    v1_account_id: asString(metadata.v1_account_id),
    name: asString(raw.name),
    identifier: asString(raw.name),
    provider,
    type: provider ? (LEGACY_ACCOUNT_TYPES[provider] ?? provider.toUpperCase()) : null,
    status,
    provider_status: asString(raw.status),
    is_locked: isLocked,
    sendable: isSendable(status),
    reconnectable: isReconnectable(status),
    created_at: asString(raw.created_at),
    user_id: asString(raw.user_id),
    products_connection_status: productStatuses,
    initial_sync_status: asString(asRecord(raw.initial_sync)?.status),
    subscriptions,
  };
}

// ---------------------------------------------------------------------------
// InMail credits
// ---------------------------------------------------------------------------

/** Legacy balance (what `useInMailBalance` and the engine read). A licence the account does not have is `null`, not 0. */
export interface KonektInmailBalance {
  premium: number | null;
  recruiter: number | null;
  sales_navigator: number | null;
}

/**
 * v2 `{ object: 'InmailCredits', credits: { classic?, recruiter?, sales_navigator? } }`
 * to the legacy `{ premium, recruiter, sales_navigator }`. `classic` is renamed
 * `premium`. Also accepts the older `{ balance: { premium, ... } | null }` and the
 * v1 root-level keys, so a response that does not match the main spec still reads.
 */
export function toKonektInmailCredits(input: unknown): KonektInmailBalance {
  const raw = asRecord(input) ?? {};
  const source = asRecord(raw.credits) ?? asRecord(raw.balance) ?? raw;
  return {
    premium: asNumber(source.classic) ?? asNumber(source.premium),
    recruiter: asNumber(source.recruiter),
    sales_navigator: asNumber(source.sales_navigator),
  };
}

/**
 * The licence an InMail should be sent through, by the engine's rule:
 * recruiter, then sales navigator, then classic, the first with credits left.
 * `null` when none has any (or the balance is unknown).
 */
export function pickInmailProduct(balance: KonektInmailBalance): 'recruiter' | 'sales_navigator' | 'classic' | null {
  if ((balance.recruiter ?? 0) > 0) return 'recruiter';
  if ((balance.sales_navigator ?? 0) > 0) return 'sales_navigator';
  if ((balance.premium ?? 0) > 0) return 'classic';
  return null;
}

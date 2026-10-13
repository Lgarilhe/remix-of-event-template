/**
 * Search normalisers: v2 results to the legacy `{ success, results, cursor, total }`
 * shape, and the filter compiler from the UI filter state to the three
 * licence-specific v2 people-search bodies.
 *
 * Results
 * -------
 * `toKonektSearchResults` emits `KonektSearchProfile` items (the fields of
 * `LinkedInProfile` in `src/components/outreach/types.ts` that the cards, the
 * scoring and the dedupe read). The provider gives one `display_name` (no first
 * or last name) and a Recruiter result can be a partial profile (no name, no
 * URL, no picture): every missing field is `null`, the card code already falls
 * back to `name.split(' ')`.
 *
 * Pagination differs per licence: classic people search and Recruiter take a
 * `cursor` (response `next_cursor`), Sales Navigator takes only `offset`. The
 * legacy `cursor` stays one opaque string: the provider cursor as is, or
 * `offset:<n>` for Sales Navigator (`parseKonektCursor` reads it back).
 *
 * Filters
 * -------
 * `toKonektFilters` takes the UI filter state (`LinkedInFiltersState`, only the
 * fields it reads are declared, so the real type is assignable). It does NOT
 * take the flattened request that `buildSearchParams` builds from it: a few
 * values change meaning there (a school sent as `CAN_HAVE` is an inclusion, in
 * the state it is a school "to review" that is not searched).
 *
 * The bodies contain only keys the endpoints accept (`additionalProperties:
 * false`: an extra key is a 400), never `api`, `category`, `limit` or `cursor`
 * (those are query parameters). A filter a licence cannot express is left out of
 * the body and listed in `dropped`; a filter applied with a change (a value
 * snapped to the nearest allowed one, a keyword text cut at 200 characters) is
 * listed in `adjusted`. Both carry a French label for the UI.
 */

import { UnipileError } from '../errors.ts';
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  asStringArray,
  type KonektContactInfo,
  type KonektEducation,
  type KonektLanguage,
  type KonektPosition,
  type KonektSkill,
  readListEnvelope,
  slugFromProfileUrl,
  toKonektEducation,
  toKonektLanguage,
  toKonektPosition,
  toKonektSkill,
  toLegacyNetworkDistance,
  toMemberUrn,
  toNetworkDegree,
} from './profile.ts';

export type SearchProduct = 'classic' | 'recruiter' | 'sales_navigator';

// ===========================================================================
// Results
// ===========================================================================

/** Legacy search result (a `LinkedInProfile`-like object). Every key is always present. */
export interface KonektSearchProfile {
  /** The provider id of the profile (the dedupe key of the result list). */
  id: string | null;
  provider_id: string | null;
  public_identifier: string | null;
  member_urn: string | null;
  /** Recruiter only: the candidate id (`candidate_id`). */
  recruiter_candidate_id: string | null;
  name: string | null;
  /** The provider sends no first/last name in search results. */
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
  network_distance: string | null;
  network_degree: string | null;
  can_send_inmail: boolean | null;
  open_to_work: boolean | null;
  is_open_to_work: boolean | null;
  premium: boolean | null;
  is_premium: boolean | null;
  open_profile: boolean | null;
  is_open_profile: boolean | null;
  verified: boolean | null;
  connections_count: number | null;
  followers_count: number | null;
  shared_connections_count: number | null;
  /**
   * `object` of the wrapper the profile came out of (`JobApplicant`, `PipelineCandidate`,
   * `SavedLead`), `null` for a plain `PeopleSearchResult`.
   */
  source_object: string | null;
  /** Recruiter: `partial` profiles carry no name, URL or picture. */
  profile_visibility: 'full' | 'partial' | null;
  hiddenCandidate: boolean | null;
  /** `['ACTIVE_TALENT']` when the provider flags the candidate as active talent. */
  interests: string[];
  interestLikelihood: string | null;
  keywords_match: string | null;
  recently_hired: boolean | null;
  last_outreach_activity: { type: string; performed_at: string } | null;
  contact_info: KonektContactInfo | null;
  work_experience: KonektPosition[] | null;
  current_positions: KonektPosition[] | null;
  past_positions: KonektPosition[] | null;
  education: KonektEducation[] | null;
  skills: KonektSkill[] | null;
  languages: KonektLanguage[] | null;
  product: SearchProduct | null;
}

const PRODUCTS: readonly string[] = ['classic', 'recruiter', 'sales_navigator'];

function mapList<T>(value: unknown, mapper: (raw: unknown) => T | null): T[] | null {
  const list = asArray(value);
  if (!list) return null;
  return list.map(mapper).filter((entry): entry is T => entry !== null);
}

/**
 * One v2 `PeopleSearchResult` (classic, Recruiter full or partial, Sales Navigator).
 *
 *  id, provider_id <- id | public_identifier <- public_identifier (else slug of profile_url)
 *  member_urn <- derived from member_id | recruiter_candidate_id <- candidate_id
 *  name <- display_name | first_name, last_name <- null
 *  headline, summary, location, industry <- same names
 *  profile_url, public_profile_url <- profile_url
 *  profile_picture_url <- public_picture_url | profile_picture_url_large <- public_picture_url_large
 *  network_distance, network_degree <- network_distance (legacy form, provider enum)
 *  can_send_inmail <- can_send_inmail | open_to_work, is_open_to_work <- is_open_to_work
 *  premium, is_premium <- is_premium | open_profile, is_open_profile <- is_open_profile | verified <- is_verified
 *  connections_count <- relations_count | followers_count | shared_connections_count <- shared_relations_count
 *  profile_visibility <- visibility | hiddenCandidate <- is_hidden_candidate
 *  interests <- ['ACTIVE_TALENT'] when is_active_talent | interestLikelihood <- interest_level
 *  keywords_match <- keywords_match | recently_hired <- was_hired_recently
 *  last_outreach_activity <- latest_contact { type, performed_at }
 *  contact_info <- contact_info { emails, phones } (Sales Navigator) or emails, phone_numbers (Recruiter)
 *  work_experience <- work_experience | current_positions, past_positions <- the same list split on the end date
 *  education, skills, languages <- same names | product <- product
 */
export function toKonektSearchProfile(input: unknown, fallbackProduct: SearchProduct | null = null): KonektSearchProfile {
  const raw = asRecord(input) ?? {};
  const profileUrl = asString(raw.profile_url);
  const degreeRaw = raw.network_distance;
  const openToWork = asBoolean(raw.is_open_to_work);
  const premium = asBoolean(raw.is_premium);
  const openProfile = asBoolean(raw.is_open_profile);
  const visibilityRaw = asString(raw.visibility);
  const productRaw = asString(raw.product);
  const positions = mapList(raw.work_experience, (e) => asRecord(e) ? toKonektPosition(e) : null);

  const contact = asRecord(raw.contact_info) ?? {};
  const emails = asStringArray(contact.emails) ?? asStringArray(raw.emails) ?? [];
  const phones = asStringArray(contact.phones) ?? asStringArray(raw.phone_numbers) ?? [];
  const addresses = asStringArray(raw.addresses) ?? [];
  const latest = asRecord(raw.latest_contact);
  const latestType = asString(latest?.type);
  const latestAt = asString(latest?.performed_at);

  return {
    id: asString(raw.id),
    provider_id: asString(raw.id),
    public_identifier: asString(raw.public_identifier) ?? slugFromProfileUrl(profileUrl),
    member_urn: toMemberUrn(raw.member_id),
    recruiter_candidate_id: asString(raw.candidate_id),
    name: asString(raw.display_name),
    first_name: null,
    last_name: null,
    headline: asString(raw.headline),
    summary: asString(raw.summary),
    location: asString(raw.location),
    industry: asString(raw.industry),
    profile_url: profileUrl,
    public_profile_url: profileUrl,
    profile_picture_url: asString(raw.public_picture_url),
    profile_picture_url_large: asString(raw.public_picture_url_large),
    network_distance: toLegacyNetworkDistance(degreeRaw),
    network_degree: toNetworkDegree(degreeRaw),
    can_send_inmail: asBoolean(raw.can_send_inmail),
    open_to_work: openToWork,
    is_open_to_work: openToWork,
    premium,
    is_premium: premium,
    open_profile: openProfile,
    is_open_profile: openProfile,
    verified: asBoolean(raw.is_verified),
    connections_count: asNumber(raw.relations_count),
    followers_count: asNumber(raw.followers_count),
    shared_connections_count: asNumber(raw.shared_relations_count),
    source_object: null,
    profile_visibility: visibilityRaw === 'full' || visibilityRaw === 'partial' ? visibilityRaw : null,
    hiddenCandidate: asBoolean(raw.is_hidden_candidate),
    interests: raw.is_active_talent === true ? ['ACTIVE_TALENT'] : [],
    interestLikelihood: asString(raw.interest_level),
    keywords_match: asString(raw.keywords_match),
    recently_hired: asBoolean(raw.was_hired_recently),
    last_outreach_activity: latestType && latestAt ? { type: latestType, performed_at: latestAt } : null,
    contact_info: emails.length + phones.length + addresses.length > 0
      ? { emails, phones, adresses: addresses, socials: [] }
      : null,
    work_experience: positions,
    current_positions: positions ? positions.filter((p) => p.current) : null,
    past_positions: positions ? positions.filter((p) => !p.current) : null,
    education: mapList(raw.education, (e) => asRecord(e) ? toKonektEducation(e) : null),
    skills: mapList(raw.skills, toKonektSkill),
    languages: mapList(raw.languages, toKonektLanguage),
    product: PRODUCTS.includes(productRaw ?? '') ? productRaw as SearchProduct : fallbackProduct,
  };
}

export interface KonektSearchResults {
  success: true;
  results: KonektSearchProfile[];
  /** Opaque cursor for the next page, `null` at the end. Sales Navigator: `offset:<n>`. */
  cursor: string | null;
  /** `total_count` when the provider sent one. */
  total: number | null;
}

export interface SearchDiagnostic {
  /** Items that are not people (companies, jobs, applicants...) were left out. */
  kind: 'skipped_items';
  count: number;
  objects: string[];
}

export interface SearchResultsOptions {
  product: SearchProduct;
  /** Sales Navigator: the offset the page was requested at (0 for the first page). */
  offset?: number;
  /**
   * Sales Navigator: the page size that was requested. Without `total_count` and
   * `next_cursor` (both optional in the spec), a full page is the only sign that
   * more may follow; the caller stops on the first short or empty page.
   */
  limit?: number;
  onDiagnostic?: (diagnostic: SearchDiagnostic) => void;
}

/** Prefix of the synthetic cursor of the offset-only licence. */
export const OFFSET_CURSOR_PREFIX = 'offset:';

/** Cursor to give back for the offset-only licence. */
export function encodeOffsetCursor(offset: number): string {
  return `${OFFSET_CURSOR_PREFIX}${Math.max(0, Math.floor(offset))}`;
}

/**
 * Reads a legacy cursor back into a query for `product`: classic and Recruiter
 * use the provider cursor unchanged (`{ cursor }`), Sales Navigator uses an
 * `offset:<n>` cursor (`{ offset }`). A missing cursor is the first page (`{}`).
 * A cursor that cannot be read for that licence (a provider cursor handed to
 * Sales Navigator, a garbled offset) is `null`: restarting from zero would
 * repeat results, so the caller must refuse the request.
 */
export function parseKonektCursor(cursor: unknown, product: SearchProduct): { cursor?: string; offset?: number } | null {
  const text = asString(cursor);
  if (text === null) return {};
  if (product !== 'sales_navigator') return text.startsWith(OFFSET_CURSOR_PREFIX) ? null : { cursor: text };
  const match = /^offset:(\d{1,9})$/.exec(text);
  return match ? { offset: Number(match[1]) } : null;
}

/**
 * v2 search page to the legacy search answer. Takes the provider body or the parsed page
 * of `pagination.ts` (see `readListEnvelope`).
 *
 *  results <- data[] / items: `PeopleSearchResult` (or an item without an `object`) as is;
 *            Recruiter `JobApplicant` and `PipelineCandidate` by their `profile` (product recruiter);
 *            Sales Navigator `SavedLead` as a profile. `source_object` keeps the wrapper name.
 *            Anything else (companies, accounts, jobs) is left out and reported to `onDiagnostic`.
 *  total <- total_count / totalCount
 *  cursor <- next_cursor / nextCursor (classic, Recruiter);
 *            Sales Navigator: `offset:<offset + received>` when more remain, that is when
 *            total_count says so, else when next_cursor is present, else (both are optional in
 *            the spec) when `options.limit` is given and the page was full.
 */
export function toKonektSearchResults(input: unknown, options: SearchResultsOptions): KonektSearchResults {
  const { items: list, nextCursor, total } = readListEnvelope(input);
  const results: KonektSearchProfile[] = [];
  const skipped: string[] = [];
  for (const entry of list) {
    const item = asRecord(entry);
    if (!item) continue;
    const object = asString(item.object);
    if (object === 'JobApplicant' || object === 'PipelineCandidate') {
      // Recruiter applicants and pipeline: the person is the nested `profile`.
      const profile = asRecord(item.profile);
      if (!profile) {
        skipped.push(object);
        continue;
      }
      results.push({ ...toKonektSearchProfile(profile, 'recruiter'), source_object: object });
      continue;
    }
    if (object === 'SavedLead') {
      results.push({ ...toKonektSearchProfile(item, options.product), source_object: object });
      continue;
    }
    if (object !== null && object !== 'PeopleSearchResult') {
      skipped.push(object);
      continue;
    }
    results.push(toKonektSearchProfile(item, options.product));
  }
  if (skipped.length > 0 && options.onDiagnostic) {
    try {
      options.onDiagnostic({ kind: 'skipped_items', count: skipped.length, objects: [...new Set(skipped)] });
    } catch {
      // A failing diagnostics callback must never break normalisation.
    }
  }
  let cursor: string | null;
  if (options.product === 'sales_navigator') {
    const nextOffset = Math.max(0, Math.floor(options.offset ?? 0)) + list.length;
    const fullPage = options.limit !== undefined && list.length >= options.limit;
    const more = list.length > 0 && (total !== null ? nextOffset < total : nextCursor !== null || fullPage);
    cursor = more ? encodeOffsetCursor(nextOffset) : null;
  } else {
    cursor = nextCursor;
  }
  return { success: true, results, cursor, total };
}

/** One entry of `search/parameters`, as the filter autocompletes read it (`{ id, title }`). */
export interface KonektSearchParameter {
  id: string;
  title: string;
}

/** v2 `{ data: [{ id, name }] }` to the legacy `[{ id, title }]` (`name` becomes `title`). Entries without id or name are dropped. */
export function toKonektSearchParameters(input: unknown): KonektSearchParameter[] {
  const out: KonektSearchParameter[] = [];
  for (const entry of readListEnvelope(input).items) {
    const item = asRecord(entry);
    const id = asString(item?.id);
    const title = asString(item?.name);
    if (id && title) out.push({ id, title });
  }
  return out;
}

// ===========================================================================
// Filters
// ===========================================================================

/** A filter value: a bare id or an object with an id, a name, a priority and a scope. */
export interface FilterRefInput {
  id?: string | number | null;
  name?: string | null;
  keywords?: string | null;
  priority?: string | null;
  scope?: string | null;
}

export type FilterRefsInput = ReadonlyArray<string | number | FilterRefInput> | { include?: ReadonlyArray<string | number | FilterRefInput>; exclude?: ReadonlyArray<string | number | FilterRefInput> };

/**
 * The part of `LinkedInFiltersState` (`src/components/outreach/types.ts`) the
 * compiler reads. Every field is optional so a partial state compiles.
 */
export interface KonektSearchFilters {
  keywords?: string | null;
  api?: string | null;
  category?: string | null;
  location?: FilterRefsInput | null;
  location_within_area?: number | null;
  company?: FilterRefsInput | null;
  company_keywords?: ReadonlyArray<{ keywords?: string | null; priority?: string | null; scope?: string | null }> | null;
  industry?: FilterRefsInput | null;
  school?: FilterRefsInput | null;
  job_title?: FilterRefsInput | null;
  skills?: FilterRefsInput | null;
  role?: ReadonlyArray<{ keywords?: string | null; priority?: string | null; scope?: string | null }> | null;
  function?: FilterRefsInput | null;
  degree?: FilterRefsInput | null;
  seniority?: ReadonlyArray<string> | null;
  network_distance?: ReadonlyArray<number | string> | null;
  profile_language?: ReadonlyArray<string> | null;
  years_of_experience_min?: number | null;
  years_of_experience_max?: number | null;
  tenure_at_company_min?: number | null;
  tenure_at_company_max?: number | null;
  tenure_at_role_min?: number | null;
  tenure_at_role_max?: number | null;
  open_to_work?: boolean | null;
  open_to?: ReadonlyArray<string> | null;
  hiring_project?: string | null;
  spotlight?: string | null;
  company_headcount?: ReadonlyArray<string> | null;
  company_type?: ReadonlyArray<string> | null;
  company_location?: FilterRefsInput | null;
  groups?: FilterRefsInput | null;
  past_company?: FilterRefsInput | null;
  past_job_title?: FilterRefsInput | null;
  first_name?: string | null;
  last_name?: string | null;
  title_keywords?: string | null;
  skills_keywords?: ReadonlyArray<string> | null;
  exclude_consulting?: boolean | null;
  company_category?: string | null;
  activity_messages?: string | null;
  activity_messages_days?: number | null;
  activity_notes?: string | null;
  activity_notes_days?: number | null;
  tags?: ReadonlyArray<string> | null;
  changed_jobs?: boolean | null;
  posted_on_linkedin?: boolean | null;
  following_your_company?: boolean | null;
  viewed_your_profile?: boolean | null;
  past_colleague?: boolean | null;
  employment_type?: ReadonlyArray<string> | null;
  spoken_languages?: ReadonlyArray<{ language?: string | null; priority?: string | null; scope?: string | null }> | null;
  recently_joined_min?: number | null;
  recently_joined_max?: number | null;
  graduation_year_min?: number | null;
  graduation_year_max?: number | null;
  hide_previously_viewed?: number | null;
}

export type DropReason =
  /** The licence has no such filter. */
  | 'unsupported'
  /** The licence has the filter but cannot exclude values (the exclusions were left out). */
  | 'exclusion'
  /** The licence cannot express the scope (past, open to relocate...). */
  | 'scope'
  /** The value has no equivalent (a company size bucket, an unknown seniority...). */
  | 'value';

export interface DroppedFilter {
  /** Name of the filter in the UI state (`industry`, `location_within_area`...). */
  filter: string;
  /** French label for the UI. */
  label: string;
  reason: DropReason;
  detail?: string;
}

export interface AdjustedFilter {
  filter: string;
  label: string;
  /** What changed, in short plain English for the logs. */
  change: string;
}

export interface CompiledSearch {
  product: SearchProduct;
  /** Path segments after the account id, ready for `accountPath(accountId, ...segments)`. */
  segments: string[];
  method: 'POST';
  body: Record<string, unknown>;
  /** Query parameters: `cursor` (classic, Recruiter), `offset` (Sales Navigator), `limit` (not classic). */
  query: Record<string, string | number>;
  dropped: DroppedFilter[];
  adjusted: AdjustedFilter[];
}

export interface CompileOptions {
  /** Overrides `filters.api`. */
  product?: SearchProduct;
  /** The legacy cursor of the page to fetch (`parseKonektCursor`). */
  cursor?: string | null;
  /** Page size for Recruiter and Sales Navigator (default 25, 1..100). Classic has a fixed page. */
  limit?: number;
}

/** French labels of the filters, for the "not applied" message of the UI. No provider name. */
export const FILTER_LABELS_FR: Readonly<Record<string, string>> = {
  keywords: 'Mots-clés',
  skills_keywords: 'Compétences suggérées',
  location: 'Lieux',
  location_within_area: 'Rayon autour du lieu',
  company: 'Entreprises',
  past_company: 'Entreprises passées',
  company_keywords: "Mots-clés d'entreprise",
  industry: 'Secteurs',
  exclude_consulting: 'Exclusion du conseil et des ESN',
  school: 'Écoles',
  job_title: 'Intitulés de poste',
  role: 'Postes (mots-clés)',
  past_job_title: 'Postes passés',
  title_keywords: 'Intitulé de poste (mots-clés)',
  skills: 'Compétences',
  function: 'Fonctions',
  degree: 'Diplômes',
  seniority: 'Séniorité',
  network_distance: 'Degré de relation',
  profile_language: 'Langue du profil',
  years_of_experience: "Années d'expérience",
  tenure_at_company: "Ancienneté dans l'entreprise",
  tenure_at_role: 'Ancienneté dans le poste',
  open_to_work: 'Ouvert aux opportunités',
  open_to: 'Ouvert à',
  spotlight: 'Signaux de disponibilité',
  hiring_project: 'Projet de recrutement',
  activity_messages: 'Activité : messages envoyés',
  activity_notes: 'Activité : notes',
  tags: 'Étiquettes',
  company_headcount: "Taille d'entreprise",
  company_category: "Catégorie d'entreprise",
  company_type: "Type d'entreprise",
  company_location: "Siège de l'entreprise",
  groups: 'Groupes',
  employment_type: "Type d'emploi",
  spoken_languages: 'Langues parlées',
  recently_joined: 'Inscrit récemment',
  graduation_year: 'Année de diplôme',
  hide_previously_viewed: 'Profils déjà consultés',
  first_name: 'Prénom',
  last_name: 'Nom',
  changed_jobs: 'Changement de poste récent',
  posted_on_linkedin: 'A publié récemment',
  following_your_company: 'Suit votre entreprise',
  viewed_your_profile: 'A consulté votre profil',
  past_colleague: 'Ancien collègue',
};

const MAX_KEYWORDS_NON_RECRUITER = 200;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Compile helpers
// ---------------------------------------------------------------------------

interface Ref {
  id: string | null;
  name: string | null;
  priority: string | null;
  scope: string | null;
}

const isExclusion = (ref: Ref): boolean => ref.priority === 'DOESNT_HAVE';

/** Reads a list of ids / objects (or an `{ include, exclude }` pair) into refs. Exclusion entries get priority `DOESNT_HAVE`. */
function toRefs(value: unknown): Ref[] {
  const out: Ref[] = [];
  const push = (entry: unknown, forcedPriority: string | null) => {
    if (typeof entry === 'string' || typeof entry === 'number') {
      const id = asString(String(entry));
      if (id) out.push({ id, name: null, priority: forcedPriority, scope: null });
      return;
    }
    const item = asRecord(entry);
    if (!item) return;
    const idRaw = typeof item.id === 'number' ? String(item.id) : asString(item.id);
    const name = asString(item.name) ?? asString(item.keywords);
    if (!idRaw && !name) return;
    out.push({
      id: idRaw,
      name,
      priority: forcedPriority ?? asString(item.priority),
      scope: asString(item.scope),
    });
  };
  if (Array.isArray(value)) {
    for (const entry of value) push(entry, null);
    return out;
  }
  const pair = asRecord(value);
  if (pair) {
    for (const entry of asArray(pair.include) ?? []) push(entry, null);
    for (const entry of asArray(pair.exclude) ?? []) push(entry, 'DOESNT_HAVE');
  }
  return out;
}

/** Ids of the refs that have one. */
const idsOf = (refs: Ref[]): string[] => refs.flatMap((r) => (r.id ? [r.id] : []));

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/** The value as a list of items (non-arrays give an empty list), items left as they are. */
const asStringArrayLoose = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Own-property lookup: a user-supplied key such as `constructor` must not reach the prototype. */
function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

class Notes {
  readonly dropped: DroppedFilter[] = [];
  readonly adjusted: AdjustedFilter[] = [];

  drop(filter: string, reason: DropReason, detail?: string): void {
    const duplicate = this.dropped.some((d) => d.filter === filter && d.reason === reason && d.detail === detail);
    if (duplicate) return;
    this.dropped.push({ filter, label: FILTER_LABELS_FR[filter] ?? filter, reason, ...(detail !== undefined ? { detail } : {}) });
  }

  adjust(filter: string, change: string): void {
    this.adjusted.push({ filter, label: FILTER_LABELS_FR[filter] ?? filter, change });
  }
}

/** Cuts `text` to at most `limit` characters, at a word boundary when one is close. */
function cutAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  if (/\s/.test(text[limit] ?? '')) return cut.trimEnd();
  const space = cut.search(/\s\S*$/);
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
}

/**
 * Boolean keywords: the user's text, plus the AI-suggested skills (at most 5,
 * quoted, joined with OR) as the UI does. Under a length limit (classic and
 * Sales Navigator accept 200 characters) the user's text is cut at a word
 * boundary and suggested skills are added only while they fit.
 */
function buildKeywords(f: KonektSearchFilters, limit: number | null, notes: Notes): string | null {
  let keywords = (asString(f.keywords) ?? '');
  if (limit !== null && keywords.length > limit) {
    keywords = cutAtWord(keywords, limit);
    notes.adjust('keywords', `cut to ${keywords.length} characters (limit ${limit})`);
  }
  const lower = keywords.toLowerCase();
  const wanted = (asStringArray(f.skills_keywords) ?? [])
    .filter((skill) => !lower.includes(skill.toLowerCase()))
    .map((skill) => `"${skill.replace(/"/g, '')}"`)
    .filter((skill) => skill !== '""')
    .slice(0, 5);
  if (wanted.length > 0) {
    const compose = (list: string[]) => {
      const group = list.join(' OR ');
      return keywords ? `(${keywords}) AND (${group})` : group;
    };
    let chosen = wanted;
    if (limit !== null) {
      chosen = [];
      for (const skill of wanted) {
        if (compose([...chosen, skill]).length > limit) break;
        chosen.push(skill);
      }
      if (chosen.length < wanted.length) notes.adjust('skills_keywords', `${chosen.length} of ${wanted.length} suggested skills kept (limit ${limit})`);
    }
    if (chosen.length > 0) keywords = compose(chosen);
  }
  return keywords === '' ? null : keywords;
}

const hasText = (value: unknown): boolean => asString(value) !== null;
const isSet = (value: unknown): boolean => value === true;
const hasItems = (value: unknown): boolean => (Array.isArray(value) && value.length > 0) || (asRecord(value) !== null && toRefs(value).length > 0);
const isNumber = (value: unknown): boolean => asNumber(value) !== null;

/** The default activity filter of the UI (`without_message`, 90 days) is not a choice of the user. */
function messagesActivityChosen(f: KonektSearchFilters): boolean {
  const mode = asString(f.activity_messages);
  if (mode === null) return false;
  const days = asNumber(f.activity_messages_days);
  return !(mode === 'without_message' && (days === null || days === 90));
}

function setIfNonEmpty(body: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value) && value.length === 0) return;
  const record = asRecord(value);
  if (record && Object.keys(record).length === 0) return;
  body[key] = value;
}

/** `{ include?, exclude? }` from refs split on exclusion; `null` when both are empty. */
function includeExclude(refs: Ref[]): { include?: string[]; exclude?: string[] } | null {
  const include = unique(idsOf(refs.filter((r) => !isExclusion(r))));
  const exclude = unique(idsOf(refs.filter(isExclusion)));
  if (include.length === 0 && exclude.length === 0) return null;
  return { ...(include.length > 0 ? { include } : {}), ...(exclude.length > 0 ? { exclude } : {}) };
}

/** Network distance: 1, 2, 3 (and `GROUP` where the licence has it). */
function networkDistances(value: unknown, allowGroup: boolean): Array<number | 'GROUP'> {
  const out: Array<number | 'GROUP'> = [];
  for (const entry of asArray(value) ?? []) {
    const n = typeof entry === 'string' && /^[123]$/.test(entry.trim()) ? Number(entry.trim()) : entry;
    if ((n === 1 || n === 2 || n === 3) && !out.includes(n)) out.push(n);
    else if (allowGroup && typeof n === 'string' && n.toUpperCase() === 'GROUP' && !out.includes('GROUP')) out.push('GROUP');
  }
  return out;
}

// ---- seniority -----------------------------------------------------------

const SENIORITY_LEVEL_WORDS: Record<string, string> = {
  '1': 'entry',
  '2': 'associate',
  '3': 'mid',
  '4': 'senior',
  '5': 'manager',
  '6': 'director',
  '7': 'vp',
  '8': 'cxo',
  '9': 'partner',
  '10': 'owner',
};

const RECRUITER_SENIORITY: Record<string, string> = {
  owner: 'OWNER',
  partner: 'PARTNER',
  cxo: 'CXO',
  'c-level': 'CXO',
  executive: 'CXO',
  vp: 'VP',
  vice_president: 'VP',
  'vice president': 'VP',
  director: 'DIRECTOR',
  directeur: 'DIRECTOR',
  manager: 'MANAGER',
  senior: 'SENIOR',
  'mid-senior': 'SENIOR',
  mid_senior: 'SENIOR',
  'mid senior': 'SENIOR',
  mid: 'SENIOR',
  entry: 'ENTRY',
  junior: 'ENTRY',
  associate: 'ENTRY',
  'débutant': 'ENTRY',
  debutant: 'ENTRY',
  training: 'TRAINING',
  intern: 'TRAINING',
  unpaid: 'UNPAID',
};

const SALES_NAVIGATOR_SENIORITY: Record<string, string> = {
  'owner/partner': 'OWNER/PARTNER',
  owner: 'OWNER/PARTNER',
  partner: 'OWNER/PARTNER',
  cxo: 'CXO',
  'c-level': 'CXO',
  executive: 'CXO',
  vp: 'VICE_PRESIDENT',
  vice_president: 'VICE_PRESIDENT',
  'vice president': 'VICE_PRESIDENT',
  director: 'DIRECTOR',
  directeur: 'DIRECTOR',
  manager: 'EXPERIENCED_MANAGER',
  experienced_manager: 'EXPERIENCED_MANAGER',
  entry_level_manager: 'ENTRY_LEVEL_MANAGER',
  strategic: 'STRATEGIC',
  senior: 'SENIOR',
  'mid-senior': 'SENIOR',
  mid_senior: 'SENIOR',
  mid: 'SENIOR',
  entry: 'ENTRY_LEVEL',
  entry_level: 'ENTRY_LEVEL',
  junior: 'ENTRY_LEVEL',
  associate: 'ENTRY_LEVEL',
  'débutant': 'ENTRY_LEVEL',
  debutant: 'ENTRY_LEVEL',
  intern: 'IN_TRAINING',
  in_training: 'IN_TRAINING',
  training: 'IN_TRAINING',
};

function mapSeniority(values: readonly unknown[], table: Record<string, string>, notes: Notes): string[] {
  const out: string[] = [];
  for (const value of values) {
    const key = String(value).trim().toLowerCase();
    if (!key) continue;
    const mapped = own(table, own(SENIORITY_LEVEL_WORDS, key) ?? key);
    if (mapped) {
      if (!out.includes(mapped)) out.push(mapped);
    } else {
      notes.drop('seniority', 'value', String(value));
    }
  }
  return out;
}

// ---- buckets -------------------------------------------------------------

/** Largest allowed value that is at most `value`, or `null` when `value` is below them all. */
const snapDown = (value: number, allowed: readonly number[]): number | null => {
  const candidates = allowed.filter((a) => a <= value);
  return candidates.length > 0 ? Math.max(...candidates) : null;
};

/** Smallest allowed value that is at least `value`, or `null` when `value` is above them all. */
const snapUp = (value: number, allowed: readonly number[]): number | null => {
  const candidates = allowed.filter((a) => a >= value);
  return candidates.length > 0 ? Math.min(...candidates) : null;
};

/**
 * A range on fixed buckets: the minimum goes down and the maximum goes up to the
 * nearest allowed value (the range only widens); a bound outside the buckets is
 * left open. Returns `null` when no bound is left.
 */
function bucketRange(
  min: number | null,
  max: number | null,
  mins: readonly number[],
  maxs: readonly number[],
  filter: string,
  notes: Notes,
): { min?: number; max?: number } | null {
  const range: { min?: number; max?: number } = {};
  if (min !== null) {
    const snapped = snapDown(min, mins);
    if (snapped !== null) range.min = snapped;
    if (snapped !== min) notes.adjust(filter, `minimum ${min} became ${snapped ?? 'open'}`);
  }
  if (max !== null) {
    const snapped = snapUp(max, maxs);
    if (snapped !== null) range.max = snapped;
    if (snapped !== max) notes.adjust(filter, `maximum ${max} became ${snapped ?? 'open'}`);
  }
  return range.min === undefined && range.max === undefined ? null : range;
}

/** A `{ min, max }` where both are required: missing bounds are filled with the limits. */
function closedRange(min: number | null, max: number | null, low: number, high: number, filter: string, notes: Notes): { min: number; max: number } {
  const lo = Math.min(Math.max(min ?? low, low), high);
  const hi = Math.min(Math.max(max ?? high, low), high);
  if ((min !== null && lo !== min) || (max !== null && hi !== max)) notes.adjust(filter, `range limited to ${low}..${high}`);
  return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
}

// ---- company size --------------------------------------------------------

const HEADCOUNT_LETTERS: Record<string, { min: number; max?: number }> = {
  A: { min: 1, max: 1 },
  B: { min: 1, max: 10 },
  C: { min: 11, max: 50 },
  D: { min: 51, max: 200 },
  E: { min: 201, max: 500 },
  F: { min: 501, max: 1000 },
  G: { min: 1001, max: 5000 },
  H: { min: 5001, max: 10000 },
  I: { min: 10001 },
};

const RECRUITER_SIZE_MIN = [1, 51, 201, 501, 1001, 5001, 10001] as const;
const RECRUITER_SIZE_MAX = [0, 10, 200, 500, 1000, 5000, 10000] as const;
const SALES_NAV_SIZE_MIN = [1, 11, 51, 201, 501, 1001, 5001, 10001] as const;
const SALES_NAV_SIZE_MAX = [0, 10, 50, 200, 500, 1000, 5000, 10000] as const;

const COMPANY_CATEGORY_LETTERS: Record<string, string[]> = {
  startup: ['B', 'C', 'D'],
  scaleup: ['D', 'E', 'F'],
  enterprise: ['G', 'H', 'I'],
};

/**
 * Company size letters (`A`..`I`) to `{ min, max }` buckets. A bucket whose lower
 * bound is not an allowed value is dropped (it cannot be expressed without
 * changing its meaning); one whose upper bound is not allowed is widened to the
 * next allowed one.
 */
function headcountBuckets(
  f: KonektSearchFilters,
  mins: readonly number[],
  maxs: readonly number[],
  notes: Notes,
): Array<{ min: number; max?: number }> {
  let letters = (asStringArray(f.company_headcount) ?? []).map((l) => l.toUpperCase());
  const category = asString(f.company_category);
  const categoryLetters = category ? own(COMPANY_CATEGORY_LETTERS, category) : undefined;
  if (letters.length === 0 && categoryLetters) letters = categoryLetters;
  const filter = asString(f.company_category) && !asStringArray(f.company_headcount)?.length ? 'company_category' : 'company_headcount';
  const out: Array<{ min: number; max?: number }> = [];
  for (const letter of unique(letters)) {
    const bucket = own(HEADCOUNT_LETTERS, letter);
    if (!bucket) {
      notes.drop(filter, 'value', letter);
      continue;
    }
    if (!mins.includes(bucket.min)) {
      notes.drop(filter, 'value', `${bucket.min}${bucket.max ? `-${bucket.max}` : '+'}`);
      continue;
    }
    if (bucket.max === undefined) {
      out.push({ min: bucket.min });
      continue;
    }
    if (maxs.includes(bucket.max)) {
      out.push({ min: bucket.min, max: bucket.max });
      continue;
    }
    const widened = snapUp(bucket.max, maxs);
    notes.adjust(filter, `${bucket.min}-${bucket.max} widened to ${bucket.min}-${widened ?? 'open'}`);
    out.push(widened === null ? { min: bucket.min } : { min: bucket.min, max: widened });
  }
  return out;
}

// ---- keyword entries (role, company keywords) ----------------------------

interface KeywordEntry {
  keywords: string;
  priority: string | null;
  scope: string | null;
}

function toKeywordEntries(value: unknown): KeywordEntry[] {
  const out: KeywordEntry[] = [];
  for (const entry of asArray(value) ?? []) {
    const item = asRecord(entry);
    const keywords = asString(item?.keywords);
    if (item && keywords) out.push({ keywords, priority: asString(item.priority), scope: asString(item.scope) });
  }
  return out;
}

const PRIORITIES = ['CAN_HAVE', 'MUST_HAVE', 'DOESNT_HAVE'] as const;
const priorityOr = (value: string | null, fallback: string): string => (value && (PRIORITIES as readonly string[]).includes(value) ? value : fallback);

const ROLE_PREFERENCES = ['CURRENT', 'CURRENT_OR_PAST', 'PAST', 'PAST_NOT_CURRENT'] as const;
const preferenceOr = (value: string | null, fallback: string): string => (value && (ROLE_PREFERENCES as readonly string[]).includes(value) ? value : fallback);

// ---------------------------------------------------------------------------
// Classic
// ---------------------------------------------------------------------------

export interface CompiledBody {
  body: Record<string, unknown>;
  dropped: DroppedFilter[];
  adjusted: AdjustedFilter[];
}

/** Filters the classic people search cannot express, with a check that says whether one is set. */
function classicUnsupported(f: KonektSearchFilters): Array<[string, boolean]> {
  return [
    ['location_within_area', isNumber(f.location_within_area)],
    ['company_keywords', toKeywordEntries(f.company_keywords).length > 0],
    ['skills', hasItems(f.skills)],
    ['function', hasItems(f.function)],
    ['degree', hasItems(f.degree)],
    ['seniority', hasItems(f.seniority)],
    ['years_of_experience', isNumber(f.years_of_experience_min) || isNumber(f.years_of_experience_max)],
    ['tenure_at_company', isNumber(f.tenure_at_company_min) || isNumber(f.tenure_at_company_max)],
    ['tenure_at_role', isNumber(f.tenure_at_role_min) || isNumber(f.tenure_at_role_max)],
    ['open_to_work', isSet(f.open_to_work)],
    ['spotlight', hasText(f.spotlight)],
    ['hiring_project', hasText(f.hiring_project)],
    ['activity_messages', messagesActivityChosen(f)],
    ['activity_notes', hasText(f.activity_notes)],
    ['tags', hasItems(f.tags)],
    ['company_headcount', hasItems(f.company_headcount)],
    ['company_category', hasText(f.company_category) && !hasItems(f.company_headcount)],
    ['company_type', hasItems(f.company_type)],
    ['company_location', hasItems(f.company_location)],
    ['groups', hasItems(f.groups)],
    ['past_job_title', hasItems(f.past_job_title)],
    ['employment_type', hasItems(f.employment_type)],
    ['spoken_languages', hasItems(f.spoken_languages)],
    ['recently_joined', isNumber(f.recently_joined_min) || isNumber(f.recently_joined_max)],
    ['graduation_year', isNumber(f.graduation_year_min) || isNumber(f.graduation_year_max)],
    ['hide_previously_viewed', isNumber(f.hide_previously_viewed)],
    ['changed_jobs', isSet(f.changed_jobs)],
    ['posted_on_linkedin', isSet(f.posted_on_linkedin)],
    ['following_your_company', isSet(f.following_your_company)],
    ['viewed_your_profile', isSet(f.viewed_your_profile)],
    ['past_colleague', isSet(f.past_colleague)],
  ];
}

/**
 * Classic people search (`POST /linkedin/search/people`). Supported keys:
 * `keywords`, `network_distance`, `location`, `current_company`, `past_company`,
 * `school`, `industry`, `profile_language`, `open_to_volunteering`,
 * `advanced_keywords` {first_name, last_name, title}. The first company scope
 * `CURRENT` (or none) is a current company, `PAST` a past one; exclusions
 * (`DOESNT_HAVE`) cannot be expressed and are dropped. The job title has no
 * filter: the first title (title keywords, a role, a job title name) goes to
 * `advanced_keywords.title`.
 */
export function compileClassicBody(f: KonektSearchFilters): CompiledBody {
  const notes = new Notes();
  const body: Record<string, unknown> = {};

  setIfNonEmpty(body, 'keywords', buildKeywords(f, MAX_KEYWORDS_NON_RECRUITER, notes));
  setIfNonEmpty(body, 'network_distance', networkDistances(f.network_distance, false));

  const exclusionFree = (filter: string, refs: Ref[]): Ref[] => {
    if (refs.some(isExclusion)) notes.drop(filter, 'exclusion');
    return refs.filter((r) => !isExclusion(r));
  };

  const locations = toRefs(f.location);
  const keptLocations = exclusionFree('location', locations);
  if (keptLocations.some((r) => r.scope && r.scope !== 'CURRENT')) notes.drop('location', 'scope', 'open to relocate');
  setIfNonEmpty(body, 'location', unique(idsOf(keptLocations)));

  const companies = exclusionFree('company', toRefs(f.company));
  const past = companies.filter((r) => r.scope === 'PAST' || r.scope === 'PAST_NOT_CURRENT');
  const current = companies.filter((r) => !past.includes(r));
  if (current.some((r) => r.scope === 'CURRENT_OR_PAST')) notes.adjust('company', 'companies searched as current employers only');
  setIfNonEmpty(body, 'current_company', unique(idsOf(current)));
  const pastCompanies = [...past, ...exclusionFree('past_company', toRefs(f.past_company))];
  setIfNonEmpty(body, 'past_company', unique(idsOf(pastCompanies)));

  setIfNonEmpty(body, 'school', unique(idsOf(exclusionFree('school', toRefs(f.school)))));
  setIfNonEmpty(body, 'industry', unique(idsOf(exclusionFree('industry', toRefs(f.industry)))));
  if (isSet(f.exclude_consulting)) notes.drop('exclude_consulting', 'exclusion');

  const languages = (asStringArray(f.profile_language) ?? []).map((l) => l.toLowerCase());
  const validLanguages = unique(languages.filter((l) => /^[a-z]{2}$/.test(l)));
  for (const l of languages.filter((l) => !/^[a-z]{2}$/.test(l))) notes.drop('profile_language', 'value', l);
  setIfNonEmpty(body, 'profile_language', validLanguages);

  const openTo = asStringArray(f.open_to) ?? [];
  if (openTo.includes('proBono')) body.open_to_volunteering = true;
  if (openTo.some((v) => v !== 'proBono')) notes.drop('open_to', 'value', openTo.filter((v) => v !== 'proBono').join(','));

  const advanced: Record<string, string> = {};
  const firstName = asString(f.first_name);
  const lastName = asString(f.last_name);
  if (firstName) advanced.first_name = firstName;
  if (lastName) advanced.last_name = lastName;
  const titles = [
    asString(f.title_keywords),
    ...toKeywordEntries(f.role).filter((r) => r.priority !== 'DOESNT_HAVE').map((r) => r.keywords),
    ...toRefs(f.job_title).filter((r) => !isExclusion(r)).map((r) => r.name),
  ].filter((t): t is string => t !== null);
  if (titles.length > 0) {
    advanced.title = titles[0];
    if (titles.length > 1) notes.adjust('job_title', `only the first of ${titles.length} titles applied`);
  }
  if (toKeywordEntries(f.role).some((r) => r.priority === 'DOESNT_HAVE') || toRefs(f.job_title).some(isExclusion)) {
    notes.drop('job_title', 'exclusion');
  }
  setIfNonEmpty(body, 'advanced_keywords', advanced);

  for (const [filter, active] of classicUnsupported(f)) if (active) notes.drop(filter, 'unsupported');
  return { body, dropped: notes.dropped, adjusted: notes.adjusted };
}

// ---------------------------------------------------------------------------
// Recruiter
// ---------------------------------------------------------------------------

const RECRUITER_SPOTLIGHTS = [
  'OPEN_TO_WORK',
  'ACTIVE_TALENT',
  'REDISCOVERED_CANDIDATES',
  'INTERNAL_CANDIDATES',
  'INTERESTED_IN_YOUR_COMPANY',
  'HAVE_COMPANY_CONNECTIONS',
] as const;

const LOCATION_PREFERENCES = ['CURRENT', 'OPEN_TO_RELOCATE_ONLY', 'CURRENT_OR_OPEN_TO_RELOCATE'] as const;
const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'] as const;
const PROFICIENCIES = ['ELEMENTARY', 'LIMITED_WORKING', 'PROFESSIONAL_WORKING', 'FULL_PROFESSIONAL', 'NATIVE_OR_BILINGUAL'] as const;
const ACTIVITY_BUCKETS: ReadonlyArray<[number, string]> = [
  [1, 'PAST_DAY'],
  [7, 'PAST_WEEK'],
  [14, 'PAST_2_WEEKS'],
  [90, 'PAST_3_MONTHS'],
  [180, 'PAST_6_MONTHS'],
  [365, 'PAST_YEAR'],
  [730, 'PAST_2_YEARS'],
];
const HIDE_VIEWED_BUCKETS: ReadonlyArray<[number, string]> = [
  [30, 'PAST_MONTH'],
  [90, 'PAST_3_MONTHS'],
  [180, 'PAST_6_MONTHS'],
  [365, 'PAST_YEAR'],
  [730, 'PAST_2_YEARS'],
];

/** Smallest bucket that covers `days` (a longer period than asked, never a shorter one); `null` above the last. */
function periodBucket(days: number, buckets: ReadonlyArray<[number, string]>): { name: string; exact: boolean } | null {
  const found = buckets.find(([limit]) => days <= limit);
  return found ? { name: found[1], exact: found[0] === days } : null;
}

function recruiterActivity(f: KonektSearchFilters, notes: Notes): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const add = (type: string, mode: string | null, days: number | null, filter: string) => {
    if (!mode) return;
    const priority = mode.startsWith('with_') ? 'MUST_HAVE' : 'DOESNT_HAVE';
    let preferences = 'ANYTIME';
    if (days !== null && days > 0) {
      const bucket = periodBucket(days, ACTIVITY_BUCKETS);
      if (bucket) {
        preferences = bucket.name;
        if (!bucket.exact) notes.adjust(filter, `${days} days widened to ${bucket.name}`);
      }
    }
    out.push({ type, priority, preferences });
  };
  add('messages', asString(f.activity_messages), asNumber(f.activity_messages_days), 'activity_messages');
  add('notes', asString(f.activity_notes), asNumber(f.activity_notes_days), 'activity_notes');
  return out;
}

/**
 * Recruiter people search (`POST /linkedin/recruiter/search/people`).
 *
 * v1 defaults are kept explicit because v2 changed them: a location without a
 * priority is `MUST_HAVE`, without a scope `CURRENT_OR_OPEN_TO_RELOCATE`; a job
 * title without a priority is `MUST_HAVE`, a company is `CAN_HAVE` over
 * `CURRENT_OR_PAST`. Included schools are sent `CAN_HAVE` (any of them) as before.
 */
export function compileRecruiterBody(f: KonektSearchFilters): CompiledBody {
  const notes = new Notes();
  const body: Record<string, unknown> = {};

  setIfNonEmpty(body, 'keywords', buildKeywords(f, null, notes));

  const locations = toRefs(f.location).filter((r) => r.id);
  setIfNonEmpty(
    body,
    'location',
    locations.map((r) => ({
      id: r.id,
      priority: priorityOr(r.priority, 'MUST_HAVE'),
      preferences: (LOCATION_PREFERENCES as readonly string[]).includes(r.scope ?? '') ? r.scope : 'CURRENT_OR_OPEN_TO_RELOCATE',
    })),
  );
  if (isNumber(f.location_within_area)) notes.drop('location_within_area', 'unsupported', 'needs a postal code');

  // Companies: current-only ones by id, the others by name with a scope.
  const currentCompanies: Array<Record<string, unknown>> = [];
  const namedCompanies: Array<Record<string, unknown>> = [];
  for (const ref of toRefs(f.company)) {
    if (!ref.id) continue;
    const priority = priorityOr(ref.priority, 'CAN_HAVE');
    if (ref.scope === 'CURRENT') {
      currentCompanies.push({ id: ref.id, priority });
    } else {
      namedCompanies.push({ name: ref.name ?? ref.id, id: ref.id, priority, preferences: preferenceOr(ref.scope, 'CURRENT_OR_PAST') });
    }
  }
  for (const entry of toKeywordEntries(f.company_keywords)) {
    namedCompanies.push({ name: entry.keywords, priority: priorityOr(entry.priority, 'CAN_HAVE'), preferences: preferenceOr(entry.scope, 'CURRENT_OR_PAST') });
  }
  setIfNonEmpty(body, 'current_company', currentCompanies);
  setIfNonEmpty(body, 'company', namedCompanies);
  setIfNonEmpty(
    body,
    'past_company',
    toRefs(f.past_company).filter((r) => r.id).map((r) => ({ id: r.id, priority: priorityOr(r.priority, 'CAN_HAVE') })),
  );

  const industry = includeExclude(toRefs(f.industry));
  const industryPair = { include: industry?.include ?? [], exclude: industry?.exclude ?? [] };
  if (isSet(f.exclude_consulting)) industryPair.exclude = unique([...industryPair.exclude, '96', '4', '104']);
  setIfNonEmpty(body, 'industry', {
    ...(industryPair.include.length > 0 ? { include: industryPair.include } : {}),
    ...(industryPair.exclude.length > 0 ? { exclude: industryPair.exclude } : {}),
  });

  // Schools "to review" (CAN_HAVE in the UI) are not searched; the others are.
  const schools = toRefs(f.school).filter((r) => r.id && (r.priority ?? 'MUST_HAVE') !== 'CAN_HAVE');
  setIfNonEmpty(body, 'school', schools.map((r) => ({ id: r.id, priority: isExclusion(r) ? 'DOESNT_HAVE' : 'CAN_HAVE' })));

  // Job titles: ids, role keywords, past titles and the free title all go to `job_title`.
  const jobTitles: Array<Record<string, unknown>> = [];
  for (const ref of toRefs(f.job_title)) {
    if (!ref.id && !ref.name) continue;
    jobTitles.push({
      name: ref.name ?? ref.id,
      ...(ref.id ? { id: ref.id } : {}),
      priority: priorityOr(ref.priority, 'MUST_HAVE'),
      preferences: preferenceOr(ref.scope, 'CURRENT_OR_PAST'),
    });
  }
  for (const entry of toKeywordEntries(f.role)) {
    jobTitles.push({ name: entry.keywords, priority: priorityOr(entry.priority, 'MUST_HAVE'), preferences: preferenceOr(entry.scope, 'CURRENT_OR_PAST') });
  }
  const freeTitle = asString(f.title_keywords);
  if (freeTitle) jobTitles.push({ name: freeTitle, priority: 'MUST_HAVE', preferences: 'CURRENT_OR_PAST' });
  for (const ref of toRefs(f.past_job_title)) {
    if (!ref.id && !ref.name) continue;
    jobTitles.push({ name: ref.name ?? ref.id, ...(ref.id ? { id: ref.id } : {}), priority: priorityOr(ref.priority, 'MUST_HAVE'), preferences: 'PAST' });
  }
  setIfNonEmpty(body, 'job_title', jobTitles);

  const skills = toRefs(f.skills).filter((r) => r.id || r.name);
  setIfNonEmpty(
    body,
    'skills',
    skills.map((r) => ({
      name: r.name ?? r.id,
      ...(r.id && /^\d+$/.test(r.id) ? { id: r.id } : {}),
      ...(r.priority && (PRIORITIES as readonly string[]).includes(r.priority) ? { priority: r.priority } : {}),
    })),
  );

  setIfNonEmpty(body, 'job_function', unique(idsOf(toRefs(f.function))));

  const degrees = toRefs(f.degree).filter((r) => {
    const n = Number(r.id);
    const valid = r.id !== null && Number.isFinite(n) && n > 10;
    if (!valid && r.id) notes.drop('degree', 'value', r.id);
    return valid;
  });
  setIfNonEmpty(body, 'degree', includeExclude(degrees));

  setIfNonEmpty(body, 'seniority', mapSeniority(asStringArrayLoose(f.seniority), RECRUITER_SENIORITY, notes));
  setIfNonEmpty(body, 'network_distance', networkDistances(f.network_distance, true));
  setIfNonEmpty(body, 'profile_language', unique(asStringArray(f.profile_language) ?? []));

  const years = (min: unknown, max: unknown) => isNumber(min) || isNumber(max);
  if (years(f.years_of_experience_min, f.years_of_experience_max)) {
    body.years_of_experience = closedRange(asNumber(f.years_of_experience_min), asNumber(f.years_of_experience_max), 0, 30, 'years_of_experience', notes);
  }
  if (years(f.tenure_at_company_min, f.tenure_at_company_max)) {
    body.years_in_current_company = closedRange(asNumber(f.tenure_at_company_min), asNumber(f.tenure_at_company_max), 0, 30, 'tenure_at_company', notes);
  }
  if (years(f.tenure_at_role_min, f.tenure_at_role_max)) {
    body.years_in_current_position = closedRange(asNumber(f.tenure_at_role_min), asNumber(f.tenure_at_role_max), 0, 30, 'tenure_at_role', notes);
  }

  const spotlights = unique([
    ...(isSet(f.open_to_work) ? ['OPEN_TO_WORK'] : []),
    ...(asString(f.spotlight) ? [asString(f.spotlight) as string] : []),
  ]);
  for (const s of spotlights.filter((s) => !(RECRUITER_SPOTLIGHTS as readonly string[]).includes(s))) notes.drop('spotlight', 'value', s);
  setIfNonEmpty(body, 'spotlights', spotlights.filter((s) => (RECRUITER_SPOTLIGHTS as readonly string[]).includes(s)));

  const hiringProject = asString(f.hiring_project);
  if (hiringProject) body.project = { include: [{ id: hiringProject, title: hiringProject }] };

  setIfNonEmpty(body, 'recruiting_activity', recruiterActivity(f, notes));
  const tags = unique(asStringArray(f.tags) ?? []);
  if (tags.length > 0) body.tags = { include: tags };

  const spoken = (asArray(f.spoken_languages) ?? []).flatMap((raw) => {
    const entry = asRecord(raw);
    const id = asString(entry?.language);
    if (!id) return [];
    const proficiency = asString(entry?.scope)?.toUpperCase();
    return [{
      id,
      ...(asString(entry?.priority) && (PRIORITIES as readonly string[]).includes(asString(entry?.priority) as string) ? { priority: asString(entry?.priority) } : {}),
      ...(proficiency && (PROFICIENCIES as readonly string[]).includes(proficiency) ? { proficiency } : {}),
    }];
  });
  setIfNonEmpty(body, 'spoken_language', spoken);

  const employment = unique((asStringArray(f.employment_type) ?? []).map((v) => v.toUpperCase()));
  for (const v of employment.filter((v) => !(EMPLOYMENT_TYPES as readonly string[]).includes(v))) notes.drop('employment_type', 'value', v);
  setIfNonEmpty(body, 'employment_type', employment.filter((v) => (EMPLOYMENT_TYPES as readonly string[]).includes(v)));

  if (years(f.graduation_year_min, f.graduation_year_max)) {
    body.graduation_year = closedRange(asNumber(f.graduation_year_min), asNumber(f.graduation_year_max), 1900, 2100, 'graduation_year', notes);
  }

  const hideViewed = asNumber(f.hide_previously_viewed);
  if (hideViewed !== null && hideViewed > 0) {
    const bucket = periodBucket(hideViewed, HIDE_VIEWED_BUCKETS) ?? { name: 'PAST_2_YEARS', exact: false };
    body.hide_previously_viewed = { timespan: bucket.name };
    if (!bucket.exact) notes.adjust('hide_previously_viewed', `${hideViewed} days became ${bucket.name}`);
  }

  if (years(f.recently_joined_min, f.recently_joined_max)) {
    const range = bucketRange(asNumber(f.recently_joined_min), asNumber(f.recently_joined_max), [2, 8, 15, 31], [1, 7, 14, 30, 90], 'recently_joined', notes);
    if (range) body.recently_joined = [range];
  }

  setIfNonEmpty(body, 'company_size', headcountBuckets(f, RECRUITER_SIZE_MIN, RECRUITER_SIZE_MAX, notes));
  setIfNonEmpty(body, 'group', unique(idsOf(toRefs(f.groups))));
  const firstName = asString(f.first_name);
  const lastName = asString(f.last_name);
  if (firstName) body.first_name = [firstName];
  if (lastName) body.last_name = [lastName];

  const unsupported: Array<[string, boolean]> = [
    ['open_to', hasItems(f.open_to)],
    ['company_type', hasItems(f.company_type)],
    ['company_location', hasItems(f.company_location)],
    ['changed_jobs', isSet(f.changed_jobs)],
    ['posted_on_linkedin', isSet(f.posted_on_linkedin)],
    ['following_your_company', isSet(f.following_your_company)],
    ['viewed_your_profile', isSet(f.viewed_your_profile)],
    ['past_colleague', isSet(f.past_colleague)],
  ];
  for (const [filter, active] of unsupported) if (active) notes.drop(filter, 'unsupported');
  return { body, dropped: notes.dropped, adjusted: notes.adjusted };
}

// ---------------------------------------------------------------------------
// Sales Navigator
// ---------------------------------------------------------------------------

const SALES_NAV_COMPANY_TYPES: Record<string, string> = {
  C: 'PUBLIC_COMPANY',
  O: 'PRIVATELY_HELD',
  E: 'NON_PROFIT',
  S: 'EDUCATIONAL_INSTITUTION',
  P: 'PARTNERSHIP',
  G: 'SELF_EMPLOYED',
  D: 'GOVERNMENT_AGENCY',
};
const SALES_NAV_COMPANY_TYPE_ENUM = [
  'PUBLIC_COMPANY',
  'PRIVATELY_HELD',
  'NON_PROFIT',
  'EDUCATIONAL_INSTITUTION',
  'PARTNERSHIP',
  'SELF_EMPLOYED',
  'SELF_OWNED',
  'GOVERNMENT_AGENCY',
] as const;

const SALES_NAV_YEARS_MIN = [1, 3, 6, 10] as const;
const SALES_NAV_YEARS_MAX = [1, 2, 5, 10] as const;

/** Plain-text entries (job titles, company names) of a Sales Navigator `{ include, exclude }`. */
function plainPair(include: string[], exclude: string[]): { include?: string[]; exclude?: string[] } | null {
  const inc = unique(include);
  const exc = unique(exclude);
  if (inc.length === 0 && exc.length === 0) return null;
  return { ...(inc.length > 0 ? { include: inc } : {}), ...(exc.length > 0 ? { exclude: exc } : {}) };
}

/**
 * Sales Navigator people search (`POST /linkedin/sales-navigator/search/people`).
 * Most filters are `{ include, exclude }` pairs of ids (company names and job
 * titles may be plain text). Company names given as keywords are sent as plain
 * text. Seniority, tenures and company size use the fixed values of the API.
 */
export function compileSalesNavigatorBody(f: KonektSearchFilters): CompiledBody {
  const notes = new Notes();
  const body: Record<string, unknown> = {};

  setIfNonEmpty(body, 'keywords', buildKeywords(f, MAX_KEYWORDS_NON_RECRUITER, notes));
  setIfNonEmpty(body, 'location', includeExclude(toRefs(f.location)));
  if (toRefs(f.location).some((r) => r.scope && r.scope !== 'CURRENT')) notes.drop('location', 'scope', 'open to relocate');
  if (isNumber(f.location_within_area)) notes.drop('location_within_area', 'unsupported', 'needs a postal code');

  // Companies: by id, plus company-name keywords as plain text; past ones apart.
  const currentInclude: string[] = [];
  const currentExclude: string[] = [];
  const pastInclude: string[] = [];
  const pastExclude: string[] = [];
  const addCompany = (value: string | null, exclude: boolean, past: boolean) => {
    if (!value) return;
    (past ? (exclude ? pastExclude : pastInclude) : (exclude ? currentExclude : currentInclude)).push(value);
  };
  for (const ref of toRefs(f.company)) {
    addCompany(ref.id, isExclusion(ref), ref.scope === 'PAST' || ref.scope === 'PAST_NOT_CURRENT');
    if (ref.scope === 'CURRENT_OR_PAST') notes.adjust('company', 'companies searched as current employers only');
  }
  for (const entry of toKeywordEntries(f.company_keywords)) {
    addCompany(entry.keywords, entry.priority === 'DOESNT_HAVE', entry.scope === 'PAST' || entry.scope === 'PAST_NOT_CURRENT');
  }
  for (const ref of toRefs(f.past_company)) addCompany(ref.id, isExclusion(ref), true);
  setIfNonEmpty(body, 'current_company', plainPair(currentInclude, currentExclude));
  setIfNonEmpty(body, 'past_company', plainPair(pastInclude, pastExclude));

  const industry = includeExclude(toRefs(f.industry)) ?? {};
  const industryExclude = isSet(f.exclude_consulting) ? unique([...(industry.exclude ?? []), '96', '4', '104']) : industry.exclude ?? [];
  setIfNonEmpty(body, 'industry', plainPair(industry.include ?? [], industryExclude));
  setIfNonEmpty(body, 'school', includeExclude(toRefs(f.school)));

  // Job titles: ids and plain text (role keywords, free title) for the current ones, ids for the past ones.
  const titleInclude: string[] = [];
  const titleExclude: string[] = [];
  const pastTitleInclude: string[] = [];
  const pastTitleExclude: string[] = [];
  for (const ref of toRefs(f.job_title)) (isExclusion(ref) ? titleExclude : titleInclude).push(...(ref.id ? [ref.id] : []));
  for (const entry of toKeywordEntries(f.role)) {
    const past = entry.scope === 'PAST' || entry.scope === 'PAST_NOT_CURRENT';
    const exclude = entry.priority === 'DOESNT_HAVE';
    (past ? (exclude ? pastTitleExclude : pastTitleInclude) : (exclude ? titleExclude : titleInclude)).push(entry.keywords);
    if (entry.scope === 'CURRENT_OR_PAST') notes.adjust('role', 'role searched in current positions only');
  }
  const freeTitle = asString(f.title_keywords);
  if (freeTitle) titleInclude.push(freeTitle);
  for (const ref of toRefs(f.past_job_title)) (isExclusion(ref) ? pastTitleExclude : pastTitleInclude).push(...(ref.id ? [ref.id] : []));
  setIfNonEmpty(body, 'current_job_title', plainPair(titleInclude, titleExclude));
  setIfNonEmpty(body, 'past_job_title', plainPair(pastTitleInclude, pastTitleExclude));

  setIfNonEmpty(body, 'function', includeExclude(toRefs(f.function)));
  const seniority = mapSeniority(asStringArrayLoose(f.seniority), SALES_NAVIGATOR_SENIORITY, notes);
  if (seniority.length > 0) body.seniority = { include: seniority };
  setIfNonEmpty(body, 'network_distance', networkDistances(f.network_distance, true));
  setIfNonEmpty(body, 'profile_language', unique(asStringArray(f.profile_language) ?? []));

  const bucketed = (key: string, filter: string, min: unknown, max: unknown) => {
    if (!isNumber(min) && !isNumber(max)) return;
    const range = bucketRange(asNumber(min), asNumber(max), SALES_NAV_YEARS_MIN, SALES_NAV_YEARS_MAX, filter, notes);
    if (range) body[key] = [range];
  };
  bucketed('years_of_experience', 'years_of_experience', f.years_of_experience_min, f.years_of_experience_max);
  bucketed('years_in_company', 'tenure_at_company', f.tenure_at_company_min, f.tenure_at_company_max);
  bucketed('years_in_position', 'tenure_at_role', f.tenure_at_role_min, f.tenure_at_role_max);

  setIfNonEmpty(body, 'company_headcount', headcountBuckets(f, SALES_NAV_SIZE_MIN, SALES_NAV_SIZE_MAX, notes));

  const companyTypes = unique(
    (asStringArray(f.company_type) ?? []).flatMap((t) => {
      const mapped = own(SALES_NAV_COMPANY_TYPES, t) ?? t.toUpperCase();
      if ((SALES_NAV_COMPANY_TYPE_ENUM as readonly string[]).includes(mapped)) return [mapped];
      notes.drop('company_type', 'value', t);
      return [];
    }),
  );
  setIfNonEmpty(body, 'company_type', companyTypes);
  setIfNonEmpty(body, 'company_location', includeExclude(toRefs(f.company_location)));
  setIfNonEmpty(body, 'group', includeExclude(toRefs(f.groups)));

  const firstName = asString(f.first_name);
  const lastName = asString(f.last_name);
  if (firstName) body.first_name = [firstName];
  if (lastName) body.last_name = [lastName];

  if (isSet(f.changed_jobs)) body.changed_jobs = true;
  if (isSet(f.posted_on_linkedin)) body.posted_on_linkedin = true;
  if (isSet(f.following_your_company)) body.following_your_company = true;
  if (isSet(f.viewed_your_profile)) body.viewed_your_profile_recently = true;
  if (isSet(f.past_colleague)) body.past_colleague = true;

  const unsupported: Array<[string, boolean]> = [
    ['skills', hasItems(f.skills)],
    ['degree', hasItems(f.degree)],
    ['open_to_work', isSet(f.open_to_work)],
    ['open_to', hasItems(f.open_to)],
    ['spotlight', hasText(f.spotlight)],
    ['hiring_project', hasText(f.hiring_project)],
    ['activity_messages', messagesActivityChosen(f)],
    ['activity_notes', hasText(f.activity_notes)],
    ['tags', hasItems(f.tags)],
    ['employment_type', hasItems(f.employment_type)],
    ['spoken_languages', hasItems(f.spoken_languages)],
    ['recently_joined', isNumber(f.recently_joined_min) || isNumber(f.recently_joined_max)],
    ['graduation_year', isNumber(f.graduation_year_min) || isNumber(f.graduation_year_max)],
    ['hide_previously_viewed', isNumber(f.hide_previously_viewed)],
  ];
  for (const [filter, active] of unsupported) if (active) notes.drop(filter, 'unsupported');
  return { body, dropped: notes.dropped, adjusted: notes.adjusted };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function clampLimit(value: number | undefined): number {
  const n = value === undefined || !Number.isFinite(value) ? DEFAULT_LIMIT : Math.floor(value);
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

/**
 * Compiles the UI filter state into the request of the people search of the
 * licence (`filters.api`, or `options.product`).
 *
 *  classic          POST /linkedin/search/people                    query: cursor
 *  recruiter        POST /linkedin/recruiter/search/people          query: cursor, limit
 *  sales_navigator  POST /linkedin/sales-navigator/search/people    query: offset, limit
 *
 * The search source `database` (retired) and any category other than `people`
 * throw a `validation` error: running a people search instead would be a
 * silent wrong answer. A cursor that cannot be read for the licence throws too
 * (see `parseKonektCursor`).
 */
export function toKonektFilters(filters: KonektSearchFilters, options: CompileOptions = {}): CompiledSearch {
  const f = filters ?? {};
  const product = options.product ?? asString(f.api);
  if (product !== 'classic' && product !== 'recruiter' && product !== 'sales_navigator') {
    throw new UnipileError('validation', { code: 'unsupported_search_source', debug: { note: `search source ${String(product)}` } });
  }
  const category = asString(f.category);
  if (category !== null && category !== 'people') {
    throw new UnipileError('validation', { code: 'unsupported_search_category', debug: { note: `search category ${category}` } });
  }
  const paging = parseKonektCursor(options.cursor, product);
  if (paging === null) {
    throw new UnipileError('validation', { code: 'invalid_cursor', debug: { note: 'cursor not readable for this licence' } });
  }

  const compiled = product === 'classic'
    ? compileClassicBody(f)
    : product === 'recruiter'
    ? compileRecruiterBody(f)
    : compileSalesNavigatorBody(f);

  const query: Record<string, string | number> = {};
  if (product === 'sales_navigator') {
    query.offset = paging.offset ?? 0;
    query.limit = clampLimit(options.limit);
  } else {
    if (paging.cursor !== undefined) query.cursor = paging.cursor;
    if (product === 'recruiter') query.limit = clampLimit(options.limit);
  }

  const segments = product === 'classic'
    ? ['linkedin', 'search', 'people']
    : product === 'recruiter'
    ? ['linkedin', 'recruiter', 'search', 'people']
    : ['linkedin', 'sales-navigator', 'search', 'people'];

  return { product, segments, method: 'POST', body: compiled.body, query, dropped: compiled.dropped, adjusted: compiled.adjusted };
}


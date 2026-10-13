/**
 * LinkedIn endpoints of the provider API (areas "linkedin-core" and
 * "recruiter-salesnav"): search per licence, search parameters, InMail credits,
 * contracts, Recruiter projects, and the pure parser of pasted search URLs.
 *
 * Wire facts (see the linkedin-core and recruiter-salesnav digests)
 *  - Every path is `/{account_id}/linkedin/...`. There is no generic search any
 *    more: the endpoint is chosen by licence (classic, Recruiter, Sales
 *    Navigator). The only generic entry is "search from URL".
 *  - Search bodies are `additionalProperties: false`. A key the endpoint does not
 *    know fails the whole call, so every body is checked against the closed list
 *    of its endpoint and an unknown key THROWS a `validation` error (a leftover of
 *    the previous generation, such as `api`, `category`, `cursor` or `limit`, can
 *    never reach the wire).
 *  - Filters are passed with their wire names (`current_company`, `years_of_experience`...):
 *    the compilation from Konekt's own filter state is the job of the normalisers.
 *  - Pagination differs per endpoint (cursor on classic people and companies,
 *    posts and Recruiter; offset on jobs and Sales Navigator; both on the
 *    from-URL endpoints). Each method accepts only the parameters its endpoint
 *    documents and rejects the others.
 *  - Searches are reads sent with POST: they are flagged repeatable.
 *  - `inmail-credits` answers `credits.classic` (not `premium`) for the classic
 *    licence.
 *  - Recruiter and Sales Navigator are separate CONTRACTS of one account, exactly
 *    one selected at a time (`listContracts`, `selectContract`).
 */

import { UnipileError } from './errors.ts';
import { unipileJson, type TransportOptions } from './http.ts';
import { accountPath } from './ids.ts';
import { parsePage, type Page } from './pagination.ts';

// ---------------------------------------------------------------------------
// Common helpers
// ---------------------------------------------------------------------------

export type SearchLicence = 'classic' | 'recruiter' | 'sales_navigator';

function invalid(note: string): UnipileError {
  return new UnipileError('validation', { debug: { note } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Integer in [min, max], or undefined. */
function intIn(value: number | undefined, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw invalid(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function keySet(keys: Record<string, true>): ReadonlySet<string> {
  return new Set(Object.keys(keys));
}

/**
 * Copies a body after checking it against the closed list of keys of its
 * endpoint. `undefined` entries are dropped; an unknown key throws.
 */
function strictBody(body: object | undefined, allowed: ReadonlySet<string>, what: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body ?? {})) {
    if (value === undefined) continue;
    if (!allowed.has(key)) throw invalid(`${what}: unsupported filter "${key}"`);
    out[key] = value;
  }
  return out;
}

function checkKeys(value: unknown, allowed: ReadonlySet<string>, what: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw invalid(`${what} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw invalid(`${what}: unsupported field "${key}"`);
  }
}

/** Cursor/offset/limit actually accepted by an endpoint. */
interface PagingRules {
  cursor?: boolean;
  offset?: boolean;
  limit?: { min: number; max: number };
}

export interface CursorPaging {
  cursor?: string;
  limit?: number;
}

export interface OffsetPaging {
  offset?: number;
  limit?: number;
}

function pagingQuery(
  params: { cursor?: string; offset?: number; limit?: number },
  rules: PagingRules,
  what: string,
): Record<string, string | number | undefined> {
  if (params.cursor !== undefined && !rules.cursor) throw invalid(`${what} does not paginate with a cursor`);
  if (params.offset !== undefined && !rules.offset) throw invalid(`${what} does not paginate with an offset`);
  if (params.limit !== undefined && !rules.limit) throw invalid(`${what} has no page size`);
  return {
    cursor: params.cursor,
    offset: intIn(params.offset, 'offset', 0, Number.MAX_SAFE_INTEGER),
    limit: rules.limit ? intIn(params.limit, 'limit', rules.limit.min, rules.limit.max) : undefined,
  };
}

async function post<T>(
  accountId: string,
  segments: string[],
  body: Record<string, unknown>,
  query: Record<string, string | number | undefined>,
  options: TransportOptions,
): Promise<Page<T>> {
  // A search only reads, so it may be retried; one that saves a search or a custom filter writes,
  // and a retry after a lost answer could create it twice.
  const writes = body.save_search !== undefined || body.save_custom_filter !== undefined;
  const response = await unipileJson(
    { method: 'POST', path: accountPath(accountId, 'linkedin', ...segments), body, query, idempotent: !writes, heavy: true },
    options,
  );
  return parsePage<T>(response);
}

// ---------------------------------------------------------------------------
// Result types (minimal)
// ---------------------------------------------------------------------------

/** `SELF` | `FIRST_DEGREE` | `SECOND_DEGREE` | `THIRD_DEGREE` | `OUT_OF_NETWORK`. */
export type NetworkDistance = string;

export interface ClassicPeopleResult {
  readonly id: string;
  readonly member_id?: string;
  readonly display_name: string;
  readonly public_identifier?: string;
  readonly profile_url?: string;
  readonly public_picture_url?: string;
  readonly headline?: string;
  readonly location?: string;
  readonly network_distance: NetworkDistance;
  readonly can_send_inmail?: boolean;
  readonly product?: string;
  readonly [key: string]: unknown;
}

export interface CompanyResult {
  readonly id: string;
  readonly display_name: string;
  readonly public_identifier?: string;
  readonly profile_url?: string;
  readonly industry?: string;
  readonly location?: string;
  readonly [key: string]: unknown;
}

/** Recruiter result: `visibility` `partial` has no name, picture or profile URL. */
export interface RecruiterPeopleResult {
  readonly id: string;
  readonly visibility: 'partial' | 'full' | string;
  readonly candidate_id: string;
  readonly display_name?: string;
  readonly public_identifier?: string;
  readonly profile_url?: string;
  readonly headline?: string;
  readonly location?: string;
  readonly network_distance?: NetworkDistance;
  readonly can_send_inmail?: boolean;
  readonly work_experience?: readonly unknown[];
  readonly [key: string]: unknown;
}

export interface SalesNavigatorPeopleResult {
  readonly id: string;
  readonly display_name: string;
  readonly public_identifier?: string;
  readonly profile_url?: string;
  readonly headline?: string;
  readonly location?: string;
  readonly network_distance: NetworkDistance;
  readonly can_send_inmail?: boolean;
  readonly work_experience?: readonly unknown[];
  readonly [key: string]: unknown;
}

/** One item of a search from URL: the `object` says what it is (`PeopleSearchResult`, `JobApplicant`, `SavedLead`...). */
export interface SearchFromUrlItem {
  readonly object: string;
  readonly id: string;
  readonly [key: string]: unknown;
}

export interface SearchParameter {
  readonly id: string;
  readonly name: string;
  readonly metadata?: unknown;
}

// ---------------------------------------------------------------------------
// Classic search
// ---------------------------------------------------------------------------

export interface ClassicPeopleFilters {
  keywords?: string;
  /** 1 first degree, 2 second, 3 third and beyond. */
  network_distance?: Array<1 | 2 | 3>;
  location?: string[];
  current_company?: string[];
  past_company?: string[];
  school?: string[];
  connections_of?: string;
  followers_of?: string;
  industry?: string[];
  service?: string[];
  /** ISO 639-1, two letters. */
  profile_language?: string[];
  open_to_volunteering?: boolean;
  advanced_keywords?: { first_name?: string; last_name?: string; title?: string; company?: string; school?: string };
}

const CLASSIC_PEOPLE_KEYS = keySet(
  {
    keywords: true, network_distance: true, location: true, current_company: true, past_company: true, school: true,
    connections_of: true, followers_of: true, industry: true, service: true, profile_language: true,
    open_to_volunteering: true, advanced_keywords: true,
  } satisfies Record<keyof ClassicPeopleFilters, true>,
);
const ADVANCED_KEYWORDS_KEYS = keySet({ first_name: true, last_name: true, title: true, company: true, school: true });

/** `POST /{acc}/linkedin/search/people`: 10 results per page, `cursor` only. */
export async function searchClassicPeople(
  accountId: string,
  filters: ClassicPeopleFilters = {},
  paging: { cursor?: string } = {},
  options: TransportOptions = {},
): Promise<Page<ClassicPeopleResult>> {
  const body = strictBody(filters, CLASSIC_PEOPLE_KEYS, 'classic people search');
  checkKeys(body.advanced_keywords, ADVANCED_KEYWORDS_KEYS, 'advanced_keywords');
  const query = pagingQuery(paging, { cursor: true }, 'classic people search');
  return await post(accountId, ['search', 'people'], body, query, options);
}

export interface ClassicCompaniesFilters {
  keywords?: string;
  location?: string[];
  industry?: string[];
  /** Company size buckets. */
  headcount?: Array<{ min?: 1 | 11 | 51 | 201 | 501 | 1001 | 5001 | 10001; max?: 10 | 50 | 200 | 500 | 1000 | 5000 | 10000 }>;
  has_job_postings?: boolean;
  is_employing_relations?: boolean;
}

const CLASSIC_COMPANIES_KEYS = keySet(
  { keywords: true, location: true, industry: true, headcount: true, has_job_postings: true, is_employing_relations: true } satisfies Record<
    keyof ClassicCompaniesFilters,
    true
  >,
);

/** `POST /{acc}/linkedin/search/companies`: `cursor` only. */
export async function searchClassicCompanies(
  accountId: string,
  filters: ClassicCompaniesFilters = {},
  paging: { cursor?: string } = {},
  options: TransportOptions = {},
): Promise<Page<CompanyResult>> {
  const body = strictBody(filters, CLASSIC_COMPANIES_KEYS, 'classic companies search');
  const query = pagingQuery(paging, { cursor: true }, 'classic companies search');
  return await post(accountId, ['search', 'companies'], body, query, options);
}

export interface ClassicPostsFilters {
  keywords?: string;
  sort_by?: 'RELEVANCE' | 'DATE';
  date_posted?: 'PAST_DAY' | 'PAST_WEEK' | 'PAST_MONTH';
  content_type?: 'VIDEOS' | 'IMAGES' | 'JOB_POSTS' | 'LIVE_VIDEOS' | 'DOCUMENTS' | 'COLLABORATIVE_ARTICLES';
  posted_by?: { member?: string[]; company?: string[]; me?: boolean; relations?: boolean; people_you_follow?: boolean };
  mentioning?: { member?: string[]; company?: string[] };
  author?: { keywords?: string; company?: string[]; industry?: string[] };
}

const CLASSIC_POSTS_KEYS = keySet(
  { keywords: true, sort_by: true, date_posted: true, content_type: true, posted_by: true, mentioning: true, author: true } satisfies Record<
    keyof ClassicPostsFilters,
    true
  >,
);

/** `POST /{acc}/linkedin/search/posts`: `cursor`, `limit` 1 to 49 (provider default 3). */
export async function searchClassicPosts(
  accountId: string,
  filters: ClassicPostsFilters = {},
  paging: CursorPaging = {},
  options: TransportOptions = {},
): Promise<Page<Record<string, unknown>>> {
  const body = strictBody(filters, CLASSIC_POSTS_KEYS, 'classic posts search');
  checkKeys(body.posted_by, keySet({ member: true, company: true, me: true, relations: true, people_you_follow: true }), 'posted_by');
  checkKeys(body.mentioning, keySet({ member: true, company: true }), 'mentioning');
  checkKeys(body.author, keySet({ keywords: true, company: true, industry: true }), 'author');
  const query = pagingQuery(paging, { cursor: true, limit: { min: 1, max: 49 } }, 'classic posts search');
  return await post(accountId, ['search', 'posts'], body, query, options);
}

export interface ClassicJobsFilters {
  keywords?: string;
  sort_by?: 'RELEVANCE' | 'DATE';
  date_posted?: 'PAST_DAY' | 'PAST_WEEK' | 'PAST_MONTH';
  workplace_type?: Array<'ON_SITE' | 'REMOTE' | 'HYBRID'>;
  seniority?: Array<'INTERNSHIP' | 'ENTRY_LEVEL' | 'ASSOCIATE' | 'MID_SENIOR_LEVEL' | 'DIRECTOR' | 'EXECUTIVE'>;
  employment_status?: Array<'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'TEMPORARY' | 'VOLUNTEER' | 'INTERNSHIP' | 'OTHER'>;
  company?: string[];
  primary_location?: string;
  location?: string[];
  /** Kilometres. */
  location_radius?: 0 | 8 | 16 | 40 | 80 | 160;
  industry?: string[];
  function?: string[];
  job_title?: string[];
  easy_apply?: boolean;
  has_verifications?: boolean;
  under_10_applicants?: boolean;
  in_your_network?: boolean;
  fair_chance_employer?: boolean;
  salary?: { currency: 'USD' | 'AUD' | 'GBP'; starting_from: number };
  benefits?: string[];
  commitments?: string[];
}

const CLASSIC_JOBS_KEYS = keySet(
  {
    keywords: true, sort_by: true, date_posted: true, workplace_type: true, seniority: true, employment_status: true,
    company: true, primary_location: true, location: true, location_radius: true, industry: true, function: true,
    job_title: true, easy_apply: true, has_verifications: true, under_10_applicants: true, in_your_network: true,
    fair_chance_employer: true, salary: true, benefits: true, commitments: true,
  } satisfies Record<keyof ClassicJobsFilters, true>,
);

/** `POST /{acc}/linkedin/search/jobs`: `offset` and `limit` 1 to 100 (classic jobs are capped at 50 per page). */
export async function searchClassicJobs(
  accountId: string,
  filters: ClassicJobsFilters = {},
  paging: OffsetPaging = {},
  options: TransportOptions = {},
): Promise<Page<Record<string, unknown>>> {
  const body = strictBody(filters, CLASSIC_JOBS_KEYS, 'classic jobs search');
  const query = pagingQuery(paging, { offset: true, limit: { min: 1, max: 100 } }, 'classic jobs search');
  return await post(accountId, ['search', 'jobs'], body, query, options);
}

// ---------------------------------------------------------------------------
// Recruiter search
// ---------------------------------------------------------------------------

export type Priority = 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE';
export type IncludeExclude = { include?: string[]; exclude?: string[] };
export type NumericRange = { min: number; max: number };
type PastPreference = 'CURRENT' | 'CURRENT_OR_PAST' | 'PAST' | 'PAST_NOT_CURRENT' | 'OPEN_TO_WORK';
type Timespan = 'ANYTIME' | 'PAST_DAY' | 'PAST_WEEK' | 'PAST_2_WEEKS' | 'PAST_3_MONTHS' | 'PAST_6_MONTHS' | 'PAST_YEAR' | 'PAST_2_YEARS';

export interface RecruiterPeopleFilters {
  keywords?: string;
  spotlights?: Array<
    'OPEN_TO_WORK' | 'ACTIVE_TALENT' | 'REDISCOVERED_CANDIDATES' | 'INTERNAL_CANDIDATES' | 'INTERESTED_IN_YOUR_COMPANY' | 'HAVE_COMPANY_CONNECTIONS'
  >;
  load_saved_search?: { id: string; new_results_only?: boolean };
  load_custom_filter?: { id: string };
  save_search?: { name: string; project_id: string };
  save_custom_filter?: { name: string };
  /** 1, 2, 3 or `GROUP` (common group members). */
  network_distance?: Array<1 | 2 | 3 | 'GROUP'>;
  location?: Array<{ id: string; priority?: Priority; preferences?: 'CURRENT' | 'OPEN_TO_RELOCATE_ONLY' | 'CURRENT_OR_OPEN_TO_RELOCATE' }>;
  postal_code?: Array<{ name: string; id: string }>;
  postal_code_radius?: 1 | 5 | 10 | 25 | 50 | 100 | 200;
  job_title?: Array<{ name: string; id?: string; priority?: Priority; preferences?: PastPreference }>;
  occupation?: Array<{ name: string; id?: string; priority?: Priority; preferences?: PastPreference }>;
  skills?: Array<{ name: string; id?: string; priority?: Priority }>;
  company?: Array<{ name: string; id?: string; priority?: Priority; preferences?: 'CURRENT' | 'CURRENT_OR_PAST' | 'PAST' | 'PAST_NOT_CURRENT' }>;
  current_company?: Array<{ id: string; priority?: Priority }>;
  past_company?: Array<{ id: string; priority?: Priority }>;
  company_size?: Array<{ min?: 1 | 51 | 201 | 501 | 1001 | 5001 | 10001; max?: 0 | 10 | 200 | 500 | 1000 | 5000 | 10000 }>;
  years_of_experience?: NumericRange;
  years_in_current_position?: NumericRange;
  years_in_current_company?: NumericRange;
  degree?: IncludeExclude;
  workplace_type?: Array<'ON_SITE' | 'HYBRID' | 'REMOTE'>;
  school?: Array<{ id: string; priority?: Priority }>;
  field_of_study?: Array<{ id: string; priority?: Priority }>;
  /** Recruiter PRO contracts only. */
  employment_type?: Array<'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP'>;
  graduation_year?: NumericRange;
  industry?: IncludeExclude;
  seniority?: Array<'UNPAID' | 'TRAINING' | 'ENTRY' | 'SENIOR' | 'MANAGER' | 'DIRECTOR' | 'VP' | 'CXO' | 'PARTNER' | 'OWNER'>;
  /** Recruiter PRO contracts only. */
  spoken_language?: Array<{
    id: string;
    priority?: Priority;
    proficiency?: 'ELEMENTARY' | 'LIMITED_WORKING' | 'PROFESSIONAL_WORKING' | 'FULL_PROFESSIONAL' | 'NATIVE_OR_BILINGUAL';
  }>;
  profile_language?: string[];
  project?: { include?: Array<{ id: string; title: string }>; exclude?: Array<{ id: string; title: string }> };
  job_function?: string[];
  first_name?: string[];
  last_name?: string[];
  recently_joined?: Array<{ min?: 2 | 8 | 15 | 31; max?: 1 | 7 | 14 | 30 | 90 }>;
  is_military_veteran?: boolean;
  /** `type` is lower case here (unlike the pipeline endpoint). */
  recruiting_activity?: Array<{ type: 'messages' | 'notes' | 'projects' | 'resumes' | 'reviews'; priority?: Priority; preferences?: Timespan }>;
  hide_previously_viewed?: { timespan: 'PAST_MONTH' | 'PAST_3_MONTHS' | 'PAST_6_MONTHS' | 'PAST_YEAR' | 'PAST_2_YEARS' };
  group?: string[];
  is_past_applicant?: boolean;
  notes?: string[];
  tags?: IncludeExclude;
}

const RECRUITER_PEOPLE_KEYS = keySet(
  {
    keywords: true, spotlights: true, load_saved_search: true, load_custom_filter: true, save_search: true,
    save_custom_filter: true, network_distance: true, location: true, postal_code: true, postal_code_radius: true,
    job_title: true, occupation: true, skills: true, company: true, current_company: true, past_company: true,
    company_size: true, years_of_experience: true, years_in_current_position: true, years_in_current_company: true,
    degree: true, workplace_type: true, school: true, field_of_study: true, employment_type: true, graduation_year: true,
    industry: true, seniority: true, spoken_language: true, profile_language: true, project: true, job_function: true,
    first_name: true, last_name: true, recently_joined: true, is_military_veteran: true, recruiting_activity: true,
    hide_previously_viewed: true, group: true, is_past_applicant: true, notes: true, tags: true,
  } satisfies Record<keyof RecruiterPeopleFilters, true>,
);

/** `POST /{acc}/linkedin/recruiter/search/people`: `cursor`, `limit` 1 to 100. Recruiter contract required. */
export async function searchRecruiterPeople(
  accountId: string,
  filters: RecruiterPeopleFilters = {},
  paging: CursorPaging = {},
  options: TransportOptions = {},
): Promise<Page<RecruiterPeopleResult>> {
  const body = strictBody(filters, RECRUITER_PEOPLE_KEYS, 'Recruiter people search');
  const query = pagingQuery(paging, { cursor: true, limit: { min: 1, max: 100 } }, 'Recruiter people search');
  return await post(accountId, ['recruiter', 'search', 'people'], body, query, options);
}

// ---------------------------------------------------------------------------
// Sales Navigator search
// ---------------------------------------------------------------------------

type SalesBucket = { min?: 1 | 3 | 6 | 10; max?: 1 | 2 | 5 | 10 };
type SalesHeadcount = { min?: 1 | 11 | 51 | 201 | 501 | 1001 | 5001 | 10001; max?: 0 | 10 | 50 | 200 | 500 | 1000 | 5000 | 10000 };

export interface SalesNavigatorPeopleFilters {
  keywords?: string;
  save_search?: { name: string };
  /** Overrides all other filters. `last_viewed_at` is a Unix timestamp that keeps only the new results. */
  load_saved_search?: { id: string; last_viewed_at?: number };
  load_recent_search?: { id: string };
  current_company?: IncludeExclude;
  past_company?: IncludeExclude;
  company_headcount?: SalesHeadcount[];
  company_type?: Array<
    'PUBLIC_COMPANY' | 'PRIVATELY_HELD' | 'NON_PROFIT' | 'EDUCATIONAL_INSTITUTION' | 'PARTNERSHIP' | 'SELF_EMPLOYED' | 'SELF_OWNED' | 'GOVERNMENT_AGENCY'
  >;
  company_location?: IncludeExclude;
  function?: IncludeExclude;
  current_job_title?: IncludeExclude;
  past_job_title?: IncludeExclude;
  seniority?: {
    include?: SalesSeniority[];
    exclude?: SalesSeniority[];
  };
  years_in_company?: SalesBucket[];
  years_in_position?: SalesBucket[];
  location?: IncludeExclude;
  postal_code?: IncludeExclude & { radius?: 1 | 5 | 10 | 25 | 35 | 50 | 75 | 100 };
  industry?: IncludeExclude;
  first_name?: string[];
  last_name?: string[];
  profile_language?: string[];
  years_of_experience?: SalesBucket[];
  group?: IncludeExclude;
  school?: IncludeExclude;
  following_your_company?: boolean;
  viewed_your_profile_recently?: boolean;
  network_distance?: Array<1 | 2 | 3 | 'GROUP'>;
  connections_of?: string[];
  past_colleague?: boolean;
  shared_experiences?: boolean;
  changed_jobs?: boolean;
  posted_on_linkedin?: boolean;
  persona?: string[];
  account_list?: IncludeExclude;
  lead_list?: IncludeExclude;
  recent_interaction?: { viewed_profile?: boolean; messaged?: boolean };
  saved_resources?: { saved_leads?: boolean; saved_accounts?: boolean };
}

export type SalesSeniority =
  | 'OWNER/PARTNER'
  | 'CXO'
  | 'VICE_PRESIDENT'
  | 'DIRECTOR'
  | 'EXPERIENCED_MANAGER'
  | 'ENTRY_LEVEL_MANAGER'
  | 'STRATEGIC'
  | 'SENIOR'
  | 'ENTRY_LEVEL'
  | 'IN_TRAINING';

const SALES_PEOPLE_KEYS = keySet(
  {
    keywords: true, save_search: true, load_saved_search: true, load_recent_search: true, current_company: true,
    past_company: true, company_headcount: true, company_type: true, company_location: true, function: true,
    current_job_title: true, past_job_title: true, seniority: true, years_in_company: true, years_in_position: true,
    location: true, postal_code: true, industry: true, first_name: true, last_name: true, profile_language: true,
    years_of_experience: true, group: true, school: true, following_your_company: true, viewed_your_profile_recently: true,
    network_distance: true, connections_of: true, past_colleague: true, shared_experiences: true, changed_jobs: true,
    posted_on_linkedin: true, persona: true, account_list: true, lead_list: true, recent_interaction: true, saved_resources: true,
  } satisfies Record<keyof SalesNavigatorPeopleFilters, true>,
);

/** `POST /{acc}/linkedin/sales-navigator/search/people`: `offset`, `limit` 1 to 100 (no cursor). */
export async function searchSalesNavigatorPeople(
  accountId: string,
  filters: SalesNavigatorPeopleFilters = {},
  paging: OffsetPaging = {},
  options: TransportOptions = {},
): Promise<Page<SalesNavigatorPeopleResult>> {
  const body = strictBody(filters, SALES_PEOPLE_KEYS, 'Sales Navigator people search');
  const query = pagingQuery(paging, { offset: true, limit: { min: 1, max: 100 } }, 'Sales Navigator people search');
  return await post(accountId, ['sales-navigator', 'search', 'people'], body, query, options);
}

export interface SalesNavigatorCompaniesFilters {
  keywords?: string;
  save_search?: { name: string };
  load_saved_search?: { id: string; last_viewed_at?: number };
  load_recent_search?: { id: string };
  annual_revenue?: { currency: string; min?: number; max?: number };
  headcount?: SalesHeadcount[];
  headcount_growth?: NumericRange;
  location?: IncludeExclude;
  postal_code?: IncludeExclude;
  industry?: IncludeExclude;
  followers?: Array<{ min?: 1 | 51 | 101 | 1001 | 5001; max?: 50 | 100 | 1000 | 5000 }>;
  department_headcount?: NumericRange & { department: string };
  department_headcount_growth?: NumericRange & { department: string };
  fortune?: Array<{ min?: 51 | 101 | 251; max?: 50 | 100 | 250 | 500 }>;
  spotlights?: Array<'HIRING_ON_LINKEDIN' | 'RECENT_LEADERSHIP_CHANGE' | 'RECENT_FUNDING_EVENTS' | 'FIRST_DEGREE_CONNECTIONS'>;
  saved_accounts?: boolean;
  account_list?: IncludeExclude;
}

const SALES_COMPANIES_KEYS = keySet(
  {
    keywords: true, save_search: true, load_saved_search: true, load_recent_search: true, annual_revenue: true,
    headcount: true, headcount_growth: true, location: true, postal_code: true, industry: true, followers: true,
    department_headcount: true, department_headcount_growth: true, fortune: true, spotlights: true, saved_accounts: true,
    account_list: true,
  } satisfies Record<keyof SalesNavigatorCompaniesFilters, true>,
);

/** `POST /{acc}/linkedin/sales-navigator/search/companies`: `offset`, `limit` 1 to 100 (no cursor). */
export async function searchSalesNavigatorCompanies(
  accountId: string,
  filters: SalesNavigatorCompaniesFilters = {},
  paging: OffsetPaging = {},
  options: TransportOptions = {},
): Promise<Page<CompanyResult>> {
  const body = strictBody(filters, SALES_COMPANIES_KEYS, 'Sales Navigator companies search');
  const query = pagingQuery(paging, { offset: true, limit: { min: 1, max: 100 } }, 'Sales Navigator companies search');
  return await post(accountId, ['sales-navigator', 'search', 'companies'], body, query, options);
}

// ---------------------------------------------------------------------------
// Search from a pasted URL
// ---------------------------------------------------------------------------

/**
 * `POST /{acc}/linkedin/search` (classic), `/recruiter/search` or
 * `/sales-navigator/search` with `{ url }`. Takes the result of
 * `resolveSearchUrl`, so a refused URL can never be sent. Paging per licence:
 * classic `offset`, `limit` 1 to 100, `cursor`; Recruiter `cursor`, `limit` 1 to
 * 5000; Sales Navigator `offset`, `limit` 1 to 50.
 */
export async function searchFromUrl(
  accountId: string,
  resolved: Pick<ResolvedSearchUrl, 'licence' | 'url'>,
  paging: { cursor?: string; offset?: number; limit?: number } = {},
  options: TransportOptions = {},
): Promise<Page<SearchFromUrlItem>> {
  const body = { url: resolved.url };
  switch (resolved.licence) {
    case 'classic':
      return await post(
        accountId, ['search'], body,
        pagingQuery(paging, { cursor: true, offset: true, limit: { min: 1, max: 100 } }, 'classic search from URL'), options,
      );
    case 'recruiter':
      return await post(
        accountId, ['recruiter', 'search'], body,
        pagingQuery(paging, { cursor: true, limit: { min: 1, max: 5000 } }, 'Recruiter search from URL'), options,
      );
    case 'sales_navigator':
      return await post(
        accountId, ['sales-navigator', 'search'], body,
        pagingQuery(paging, { offset: true, limit: { min: 1, max: 50 } }, 'Sales Navigator search from URL'), options,
      );
    default:
      throw invalid('unknown search licence');
  }
}

export type SearchUrlKind =
  | 'classic_people'
  | 'classic_companies'
  | 'classic_posts'
  | 'classic_jobs'
  | 'recruiter_search'
  | 'recruiter_applicants'
  | 'recruiter_pipeline'
  | 'sales_navigator_people'
  | 'sales_navigator_companies'
  | 'sales_navigator_lead_list'
  | 'sales_navigator_account_list';

export interface ResolvedSearchUrl {
  readonly ok: true;
  readonly licence: SearchLicence;
  readonly kind: SearchUrlKind;
  /** The URL to send (https scheme added when the member pasted it without one). */
  readonly url: string;
  /** Free-text keywords of the search, or `null`. */
  readonly keywords: string | null;
  /** Names of the filters the URL carries besides the keywords (query parameters, or Sales Navigator filter types). */
  readonly filterKeys: readonly string[];
  /** Recruiter project of a `/talent/hire/{id}/...` URL. */
  readonly projectId: string | null;
}

export type SearchUrlRefusalReason = 'invalid_url' | 'not_linkedin' | 'not_a_search' | 'unsupported_search';

/** A typed refusal. `message` is neutral French text that can be shown to the member. */
export interface SearchUrlRefusal {
  readonly ok: false;
  readonly reason: SearchUrlRefusalReason;
  readonly message: string;
}

export type SearchUrlResolution = ResolvedSearchUrl | SearchUrlRefusal;

const REFUSAL_MESSAGES: Record<SearchUrlRefusalReason, string> = {
  invalid_url: "Cette adresse n'est pas valide. Collez l'adresse complète d'une recherche LinkedIn.",
  not_linkedin: "Cette adresse n'est pas une adresse LinkedIn. Collez l'adresse d'une recherche LinkedIn.",
  not_a_search: "Cette adresse LinkedIn n'est pas une recherche. Collez l'adresse d'une page de résultats de recherche.",
  unsupported_search:
    "Ce type de recherche LinkedIn n'est pas pris en charge. Utilisez une recherche de personnes ou d'entreprises.",
};

function refuse(reason: SearchUrlRefusalReason): SearchUrlRefusal {
  return { ok: false, reason, message: REFUSAL_MESSAGES[reason] };
}

/** Query parameters that are not filters (tracking, paging, spell correction). */
const NOISE_PARAMS = new Set([
  'keywords', 'origin', 'sid', 'page', 'lipi', 'trk', 'trackingid', 'spellcorrectionenabled', 'searchid', 'start',
  'searchcontextid', 'searchhistoryid', 'searchrequestid', 'uiorigin', 'sessionid', 'query', 'refid',
]);

/** Top-level `key:value` entries of a Rest.li tuple such as `(a:b,c:(d:e),keywords:foo)`. */
function restliTopLevel(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  let body = text.trim();
  if (body.startsWith('(') && body.endsWith(')')) body = body.slice(1, -1);
  let depth = 0;
  let start = 0;
  const flush = (end: number) => {
    const entry = body.slice(start, end);
    const colon = entry.indexOf(':');
    if (colon > 0) entries.set(entry.slice(0, colon).trim(), entry.slice(colon + 1).trim());
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      flush(i);
      start = i + 1;
    }
  }
  flush(body.length);
  return entries;
}

/** Keywords as typed, decoded and trimmed. Quotes are kept: they can be an exact-phrase operator. */
function cleanKeywords(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

/**
 * Parses a pasted LinkedIn search URL (classic, Recruiter or Sales Navigator).
 * Pure: no network, never throws. Returns the licence, the kind of search, the
 * keywords and the names of the other filters, or a typed refusal.
 */
export function resolveSearchUrl(input: unknown): SearchUrlResolution {
  if (typeof input !== 'string' || input.trim() === '') return refuse('invalid_url');
  let raw = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    if (!/^[\w-]+(\.[\w-]+)+(\/|\?|$)/.test(raw)) return refuse('invalid_url');
    raw = `https://${raw}`;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse('invalid_url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return refuse('invalid_url');
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return refuse('not_linkedin');

  const segments = url.pathname.split('/').filter(Boolean).map((s) => s.toLowerCase());
  const params = url.searchParams;
  const make = (
    licence: SearchLicence,
    kind: SearchUrlKind,
    extra: { keywords?: string | null; filterKeys?: string[]; projectId?: string | null } = {},
  ): ResolvedSearchUrl => ({
    ok: true,
    licence,
    kind,
    url: raw,
    keywords: extra.keywords ?? null,
    filterKeys: [...new Set(extra.filterKeys ?? [])].sort(),
    projectId: extra.projectId ?? null,
  });

  const queryFilterKeys = (): string[] => [...params.keys()].filter((k) => !NOISE_PARAMS.has(k.toLowerCase()) && !k.toLowerCase().startsWith('utm_'));

  // Classic: /search/results/{people|companies|content|all|...} and /jobs/search
  if (segments[0] === 'search' && segments[1] === 'results') {
    const category = segments[2];
    if (category === undefined) return refuse('not_a_search');
    const kinds: Record<string, SearchUrlKind> = { people: 'classic_people', companies: 'classic_companies', content: 'classic_posts' };
    const kind = kinds[category];
    if (!kind) return refuse('unsupported_search');
    return make('classic', kind, { keywords: cleanKeywords(params.get('keywords')), filterKeys: queryFilterKeys() });
  }
  if (segments[0] === 'jobs' && (segments[1] === 'search' || segments[1] === 'search-results')) {
    return make('classic', 'classic_jobs', { keywords: cleanKeywords(params.get('keywords')), filterKeys: queryFilterKeys() });
  }

  // Recruiter: /talent/search and /talent/hire/{project}/discover|manage/...
  if (segments[0] === 'talent') {
    if (segments[1] === 'search') {
      return make('recruiter', 'recruiter_search', { keywords: cleanKeywords(params.get('keywords')) });
    }
    if (segments[1] === 'hire' && segments[2] && /^\d+$/.test(segments[2])) {
      const projectId = segments[2];
      if (segments[3] === 'discover') {
        if (segments[4] === 'recruitersearch') {
          return make('recruiter', 'recruiter_search', { keywords: cleanKeywords(params.get('keywords')), projectId });
        }
        if (segments[4] === 'applicants') return make('recruiter', 'recruiter_applicants', { projectId });
        return refuse('unsupported_search');
      }
      if (segments[3] === 'manage') return make('recruiter', 'recruiter_pipeline', { projectId });
    }
    return refuse('not_a_search');
  }

  // Sales Navigator: /sales/search/{people|company|companies}, /sales/lists/{people|company}/{id}
  if (segments[0] === 'sales') {
    if (segments[1] === 'search') {
      const target = segments[2];
      const kind: SearchUrlKind | null = target === 'people'
        ? 'sales_navigator_people'
        : target === 'company' || target === 'companies'
        ? 'sales_navigator_companies'
        : null;
      if (!kind) return refuse('unsupported_search');
      const restli = params.get('query');
      const top = restli ? restliTopLevel(restli) : new Map<string, string>();
      const keywords = cleanKeywords(top.get('keywords') ?? params.get('keywords'));
      const filterKeys: string[] = [];
      for (const match of (top.get('filters') ?? '').matchAll(/(?:^|[(,])type:([A-Z_]+)/g)) filterKeys.push(match[1]);
      if (top.has('recentSearchParam')) filterKeys.push('recentSearchParam');
      if (params.has('savedSearchId')) filterKeys.push('savedSearchId');
      return make('sales_navigator', kind, { keywords, filterKeys });
    }
    if (segments[1] === 'lists' && segments[3]) {
      if (segments[2] === 'people') return make('sales_navigator', 'sales_navigator_lead_list');
      if (segments[2] === 'company' || segments[2] === 'companies') return make('sales_navigator', 'sales_navigator_account_list');
    }
    return refuse('not_a_search');
  }

  return refuse('not_a_search');
}

// ---------------------------------------------------------------------------
// Search parameters (ids behind filters)
// ---------------------------------------------------------------------------

export type ClassicParameterType =
  | 'LOCATION' | 'COMPANY' | 'RELATION' | 'PEOPLE' | 'SCHOOL' | 'INDUSTRY' | 'SERVICE' | 'JOB_FUNCTION' | 'JOB_TITLE'
  | 'EMPLOYMENT_TYPE' | 'SKILL';

export type SalesNavigatorParameterType =
  | 'COMPANY' | 'ACCOUNT_LIST' | 'LEAD_LIST' | 'LOCATION' | 'POSTAL_CODE' | 'JOB_FUNCTION' | 'JOB_TITLE' | 'INDUSTRY' | 'GROUP'
  | 'SCHOOL' | 'RELATION' | 'PERSONA' | 'SAVED_PEOPLE_SEARCH' | 'SAVED_COMPANY_SEARCH' | 'RECENT_SEARCH' | 'PROFILE_LANGUAGE';

export type RecruiterParametersRequest =
  | {
    source: 'APPLICANTS';
    project_id: string;
    type: 'SKILL' | 'LOCATION' | 'JOB_TITLE' | 'JOB_FUNCTION' | 'COMPANY' | 'CURRENT_COMPANY' | 'INDUSTRY' | 'FIELD_OF_STUDY' | 'DEGREE' | 'TAG' | 'SPOKEN_LANGUAGE';
    /** Applicable to `TAG` only. */
    keywords?: string;
  }
  | {
    source: 'PIPELINE';
    project_id: string;
    type: 'SEAT' | 'SKILL' | 'CURRENT_COMPANY' | 'JOB_TITLE' | 'LOCATION';
    stage_id?: string;
    /** Applicable to `SEAT` only. */
    keywords?: string;
  }
  | {
    source: 'SEARCH' | 'JOB_POSTING';
    type:
      | 'OCCUPATION' | 'JOB_TITLE' | 'JOB_FUNCTION' | 'LOCATION' | 'ZIPCODE' | 'SKILL' | 'COMPANY' | 'SCHOOL' | 'INDUSTRY' | 'GROUP'
      | 'PROJECT' | 'CUSTOM_FILTER' | 'PROFILE_LANGUAGE' | 'SPOKEN_LANGUAGE' | 'SEAT' | 'SAVED_SEARCH' | 'DEGREE';
    keywords?: string;
  }
  | { source: 'JOBS'; type: 'CONTRACT' | 'SEAT' | 'LOCATION'; keywords?: string };

export type SearchParametersRequest =
  | { licence: 'classic'; type: ClassicParameterType; keywords: string }
  | { licence: 'sales_navigator'; type: SalesNavigatorParameterType; keywords?: string }
  | ({ licence: 'recruiter' } & RecruiterParametersRequest);

const CLASSIC_TYPES = keySet({
  LOCATION: true, COMPANY: true, RELATION: true, PEOPLE: true, SCHOOL: true, INDUSTRY: true, SERVICE: true, JOB_FUNCTION: true,
  JOB_TITLE: true, EMPLOYMENT_TYPE: true, SKILL: true,
});
const SALES_TYPES = keySet({
  COMPANY: true, ACCOUNT_LIST: true, LEAD_LIST: true, LOCATION: true, POSTAL_CODE: true, JOB_FUNCTION: true, JOB_TITLE: true,
  INDUSTRY: true, GROUP: true, SCHOOL: true, RELATION: true, PERSONA: true, SAVED_PEOPLE_SEARCH: true,
  SAVED_COMPANY_SEARCH: true, RECENT_SEARCH: true, PROFILE_LANGUAGE: true,
});
const RECRUITER_TYPES: Record<string, ReadonlySet<string>> = {
  APPLICANTS: keySet({
    SKILL: true, LOCATION: true, JOB_TITLE: true, JOB_FUNCTION: true, COMPANY: true, CURRENT_COMPANY: true, INDUSTRY: true,
    FIELD_OF_STUDY: true, DEGREE: true, TAG: true, SPOKEN_LANGUAGE: true,
  }),
  PIPELINE: keySet({ SEAT: true, SKILL: true, CURRENT_COMPANY: true, JOB_TITLE: true, LOCATION: true }),
  SEARCH: keySet({
    OCCUPATION: true, JOB_TITLE: true, JOB_FUNCTION: true, LOCATION: true, ZIPCODE: true, SKILL: true, COMPANY: true,
    SCHOOL: true, INDUSTRY: true, GROUP: true, PROJECT: true, CUSTOM_FILTER: true, PROFILE_LANGUAGE: true,
    SPOKEN_LANGUAGE: true, SEAT: true, SAVED_SEARCH: true, DEGREE: true,
  }),
  JOBS: keySet({ CONTRACT: true, SEAT: true, LOCATION: true }),
};
RECRUITER_TYPES.JOB_POSTING = RECRUITER_TYPES.SEARCH;

/** Builds the method, path segments, query and body of a parameters request. */
function parametersCall(request: SearchParametersRequest, paging: OffsetPaging): {
  method: 'GET' | 'POST';
  segments: string[];
  query: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
} {
  const page = pagingQuery(paging, { offset: true, limit: { min: 1, max: 100 } }, 'search parameters');
  switch (request.licence) {
    case 'classic':
      if (!CLASSIC_TYPES.has(request.type)) throw invalid(`unknown classic parameter type: ${String(request.type)}`);
      if (typeof request.keywords !== 'string') throw invalid('classic search parameters need keywords');
      return { method: 'GET', segments: ['search', 'parameters'], query: { type: request.type, keywords: request.keywords, ...page } };
    case 'sales_navigator':
      if (!SALES_TYPES.has(request.type)) throw invalid(`unknown Sales Navigator parameter type: ${String(request.type)}`);
      return {
        method: 'GET',
        segments: ['sales-navigator', 'search', 'parameters'],
        query: { type: request.type, keywords: request.keywords, ...page },
      };
    case 'recruiter': {
      const { licence: _licence, ...rest } = request;
      const allowed = RECRUITER_TYPES[rest.source];
      if (!allowed) throw invalid(`unknown Recruiter parameter source: ${String(rest.source)}`);
      if (!allowed.has(rest.type)) throw invalid(`parameter type ${String(rest.type)} is not available for source ${rest.source}`);
      if ((rest.source === 'APPLICANTS' || rest.source === 'PIPELINE') && (typeof rest.project_id !== 'string' || rest.project_id === '')) {
        throw invalid(`source ${rest.source} needs project_id`);
      }
      const bodyKeys = rest.source === 'APPLICANTS'
        ? ['source', 'project_id', 'type', 'keywords']
        : rest.source === 'PIPELINE'
        ? ['source', 'project_id', 'type', 'stage_id', 'keywords']
        : ['source', 'type', 'keywords'];
      const body = strictBody(rest, keySet(Object.fromEntries(bodyKeys.map((k) => [k, true as const]))), 'Recruiter search parameters');
      return { method: 'POST', segments: ['recruiter', 'search', 'parameters'], query: page, body };
    }
    default:
      throw invalid('unknown search licence');
  }
}

/**
 * Ids and names behind the search filters, per licence: `GET
 * /linkedin/search/parameters` (classic, `keywords` required),
 * `POST /linkedin/recruiter/search/parameters` (body by source) or
 * `GET /linkedin/sales-navigator/search/parameters`. `offset`, `limit` 1 to 100.
 */
export async function searchParameters(
  accountId: string,
  request: SearchParametersRequest,
  paging: OffsetPaging = {},
  options: TransportOptions = {},
): Promise<Page<SearchParameter>> {
  const call = parametersCall(request, paging);
  const body = await unipileJson(
    {
      method: call.method,
      path: accountPath(accountId, 'linkedin', ...call.segments),
      query: call.query,
      ...(call.body ? { body: call.body } : {}),
      idempotent: true,
    },
    options,
  );
  return parsePage<SearchParameter>(body);
}

// ---------------------------------------------------------------------------
// InMail credits, contracts, Recruiter projects
// ---------------------------------------------------------------------------

export interface InmailCredits {
  classic: number | null;
  recruiter: number | null;
  sales_navigator: number | null;
}

function creditOf(credits: Record<string, unknown>, key: string): number | null {
  const value = credits[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * `GET /{acc}/linkedin/inmail-credits`. Reads `credits.classic` (the previous
 * key was `premium`). A licence the account does not subscribe to is `null`.
 */
export async function getInmailCredits(
  accountId: string,
  service?: SearchLicence,
  options: TransportOptions = {},
): Promise<InmailCredits> {
  if (service !== undefined && service !== 'classic' && service !== 'recruiter' && service !== 'sales_navigator') {
    throw invalid('unknown InMail service');
  }
  const body = await unipileJson({ path: accountPath(accountId, 'linkedin', 'inmail-credits'), query: { service } }, options);
  if (!isRecord(body) || !isRecord(body.credits)) {
    throw new UnipileError('server', { code: 'invalid_inmail_credits', debug: { note: 'answer has no credits object', body } });
  }
  return {
    classic: creditOf(body.credits, 'classic'),
    recruiter: creditOf(body.credits, 'recruiter'),
    sales_navigator: creditOf(body.credits, 'sales_navigator'),
  };
}

export interface Contract {
  readonly id: string;
  readonly name: string;
  readonly product: 'recruiter' | 'sales_navigator' | string;
  readonly selected: boolean;
  readonly description?: string;
}

function asContract(value: unknown): Contract {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.product !== 'string') {
    throw new UnipileError('server', { code: 'invalid_contract', debug: { note: 'unreadable contract object', body: value } });
  }
  return value as unknown as Contract;
}

/** `GET /{acc}/linkedin/contracts`: Recruiter and Sales Navigator contracts, exactly one `selected`. */
export async function listContracts(accountId: string, options: TransportOptions = {}): Promise<Contract[]> {
  const body = await unipileJson({ path: accountPath(accountId, 'linkedin', 'contracts') }, options);
  return parsePage<unknown>(body).items.map(asContract);
}

/** `POST /{acc}/linkedin/contracts/{contract}/select`: activates a contract (selecting the active one again is harmless). */
export async function selectContract(accountId: string, contractId: string, options: TransportOptions = {}): Promise<Contract> {
  const body = await unipileJson(
    { method: 'POST', path: accountPath(accountId, 'linkedin', 'contracts', contractId, 'select'), idempotent: true },
    options,
  );
  if (!isRecord(body)) {
    throw new UnipileError('server', { code: 'invalid_contract', debug: { note: 'unreadable select answer', body } });
  }
  return asContract(body.contract);
}

export interface HiringProject {
  readonly id: string;
  readonly name: string;
  readonly archived?: boolean;
  readonly readonly?: boolean;
  readonly created_at?: string;
  readonly last_modified_at?: string;
  /** `PRIVATE` | `SHARED` on reads (the write side says `PUBLIC`). */
  readonly visibility?: string;
  readonly talent_pool?: { readonly channels?: ReadonlyArray<{ readonly id: string; readonly type: string; readonly state?: string }> };
  readonly pipeline?: { readonly stages?: ReadonlyArray<{ readonly id: string; readonly name: string; readonly candidates_count?: number }> };
  readonly [key: string]: unknown;
}

export interface ListRecruiterProjectsParams {
  /** Default on the provider side: ACTIVE. */
  status?: Array<'ACTIVE' | 'CLOSED'>;
  sortBy?:
    | 'LAST_USED_BY_ME' | 'MOST_USED_BY_ME' | 'LAST_VIEWED_BY_ME' | 'NEWEST_TO_OLDEST' | 'OLDEST_TO_NEWEST' | 'ALPHABETICAL'
    | 'REVERSE_ALPHABETICAL';
  /** Filters on the project name. */
  keywords?: string;
  offset?: number;
  limit?: number;
}

const PROJECT_SORTS = keySet({
  LAST_USED_BY_ME: true, MOST_USED_BY_ME: true, LAST_VIEWED_BY_ME: true, NEWEST_TO_OLDEST: true, OLDEST_TO_NEWEST: true,
  ALPHABETICAL: true, REVERSE_ALPHABETICAL: true,
});

/**
 * `GET /{acc}/linkedin/recruiter/projects`: hiring projects of the CURRENT
 * contract (see `selectContract`). `offset`, `limit` 1 to 100 (no cursor input).
 */
export async function listRecruiterProjects(
  accountId: string,
  params: ListRecruiterProjectsParams = {},
  options: TransportOptions = {},
): Promise<Page<HiringProject>> {
  for (const status of params.status ?? []) {
    if (status !== 'ACTIVE' && status !== 'CLOSED') throw invalid(`unknown project status: ${String(status)}`);
  }
  if (params.sortBy !== undefined && !PROJECT_SORTS.has(params.sortBy)) throw invalid(`unknown project sort: ${String(params.sortBy)}`);
  const page = pagingQuery(params, { offset: true, limit: { min: 1, max: 100 } }, 'Recruiter projects list');
  const body = await unipileJson(
    {
      path: accountPath(accountId, 'linkedin', 'recruiter', 'projects'),
      query: { status: params.status ? [...params.status] : undefined, sort_by: params.sortBy, keywords: params.keywords, ...page },
    },
    options,
  );
  return parsePage<HiringProject>(body);
}

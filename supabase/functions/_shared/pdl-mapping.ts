/**
 * Shared PDL mapping helpers — convertit entre :
 *   - LinkedInFiltersState (format pivot frontend) → body de la fonction pdl-search
 *   - PDL Person object brut → LinkedInProfile (format pivot retour)
 *
 * Utilisé par database-search (lorsque source='pdl') et potentiellement par
 * d'autres fonctions qui doivent enrichir un profil en fond.
 *
 * IMPORTANT : les noms de fournisseurs (PDL, People Data Labs) ne doivent
 * jamais apparaître dans des messages d'erreur user-facing. Voir CLAUDE.md.
 */

// ─── Types locaux (dupliqués depuis frontend pour rester self-contained) ─────

export interface FilterItem { id: string; name: string; }
export interface PriorityFilterItem extends FilterItem { priority: 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE'; }
export interface LocationFilterItem extends FilterItem { priority: string; scope: string; }
export interface RoleFilter { keywords: string; priority: string; scope: string; }

/** Subset de LinkedInFiltersState — uniquement les champs que PDL peut consommer. */
export interface LinkedInFiltersLite {
  keywords?: string;
  location?: LocationFilterItem[];
  company?: FilterItem[];
  industry?: FilterItem[];
  school?: PriorityFilterItem[];
  job_title?: PriorityFilterItem[];
  skills?: PriorityFilterItem[];
  role?: RoleFilter[];
  function?: FilterItem[];
  seniority?: string[];
  profile_language?: string[];
  calculated_experience_min?: number | null;
  calculated_experience_max?: number | null;
  years_of_experience_min?: number | null;
  years_of_experience_max?: number | null;
  company_headcount?: string[];
  // AI-generated keyword filters
  skills_keywords?: string[];
  industry_keywords?: string[];
  // database-only
  db_company_domain?: string;
  db_funding_stage?: string;
  db_revenue_min?: string;
  db_revenue_max?: string;
}

/** Body que la fonction pdl-search (SQL API) attend en entrée. */
export interface PdlSearchBody {
  // Person/title
  job_title?: string;                  // virgules pour OR multiple
  job_title_role?: string;
  job_title_sub_role?: string;
  job_title_class?: string;
  job_title_levels?: string[];

  // Location (person)
  location_country?: string;           // ISO lowercase or full name
  location_continent?: string;
  location_region?: string;
  location_metro?: string;
  location_locality?: string;

  // Company
  job_company_name?: string;
  job_company_industry?: string;
  job_company_size?: string;           // PDL ranges: '1-10', '11-50', etc.
  job_company_type?: string;
  job_company_ticker?: string;
  job_company_founded?: string;        // '>2015' / '<2010' / '=2018'
  job_company_inferred_revenue?: string;
  job_company_total_funding_raised_min?: number;
  job_company_total_funding_raised_max?: number;
  job_company_12mo_employee_growth_rate?: string;

  // Skills / experience
  skills?: string[];
  years_experience?: string;           // '5-10' or '5+'
  industry?: string;
  inferred_salary?: string;

  // Education
  education_school?: string;
  education_degree?: string;
  education_major?: string;

  // Languages, certifs
  languages?: string;                  // virgules pour OR
  certifications?: string;
  interests?: string;
  summary?: string;

  // Intent signals
  intent_job_change?: boolean;
  recently_funded?: boolean;

  // Pagination
  size?: number;
}

/** Subset de LinkedInProfile — format pivot retour. */
export interface LinkedInProfileLite {
  id: string;
  type?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  summary?: string;
  profile_url?: string;
  public_profile_url?: string;
  profile_picture_url?: string;
  location?: string;
  industry?: string;
  pronoun?: string;
  connections_count?: number;
  followers_count?: number;
  is_open_to_work?: boolean;
  open_to_work?: boolean;
  is_premium?: boolean;
  premium?: boolean;
  is_hiring?: boolean;
  is_influencer?: boolean;
  is_creator?: boolean;
  can_send_inmail?: boolean;
  is_open_profile?: boolean;
  open_profile?: boolean;
  primary_locale?: { country?: string; language?: string };
  contact_info?: { emails?: string[]; phones?: string[] };
  skills?: Array<{ name: string; endorsement_count?: number }>;
  languages?: Array<{ name: string; proficiency?: string }>;
  certifications?: Array<{ name?: string; organization?: string }>;
  education?: Array<{
    school?: string;
    school_id?: string;
    school_url?: string;
    degree?: string;
    field_of_study?: string;
    start?: string | { year?: number; month?: number } | null;
    end?: string | { year?: number; month?: number } | null;
    school_details?: {
      name?: string;
      employeeCount?: number;
      location?: string;
      description?: string;
      url?: string;
      logo?: string | null;
    };
  }>;
  work_experience?: Array<{
    company?: string;
    company_id?: string;
    company_url?: string;
    company_picture_url?: string;
    company_description?: string;
    company_headcount?: { min?: number; max?: number } | null;
    industry?: string | string[];
    location?: string;
    role?: string;
    description?: string;
    current?: boolean;
    logo?: string;
    start?: string | { month?: number; year?: number } | null;
    end?: string | { month?: number; year?: number } | null;
  }>;
  /** Marqueur de provenance — utile pour debug/UI conditionnelle */
  source?: 'database' | 'linkedin';
  /** Métadonnées internes (pas exposé user) */
  _provider?: 'pdl' | 'apollo';
}

// ─── Mapping LinkedInFiltersState → PdlSearchBody ────────────────────────────

/**
 * Mapping séniorité LinkedIn (1-10) → PDL job_title_levels.
 * Aligné avec SENIORITY_LEVELS dans src/components/outreach/types.ts
 */
const SENIORITY_TO_PDL: Record<string, string> = {
  '1': 'entry',
  '2': 'entry',         // associate ≈ entry
  '3': 'senior',        // mid-level mapped to senior
  '4': 'senior',
  '5': 'manager',
  '6': 'director',
  '7': 'vp',
  '8': 'cxo',
  '9': 'partner',
  '10': 'owner',
};

const HEADCOUNT_TO_PDL: Record<string, string> = {
  'A': '1-10',
  'B': '1-10',
  'C': '11-50',
  'D': '51-200',
  'E': '201-500',
  'F': '501-1000',
  'G': '1001-5000',
  'H': '5001-10000',
  'I': '10001+',
};

/**
 * Parse une expression Boolean LinkedIn-style en liste de termes individuels.
 *
 * Exemples :
 *   '"DevOps Engineer" OR "SRE" OR "Site Reliability"'
 *     → ['DevOps Engineer', 'SRE', 'Site Reliability']
 *   'data engineer AND python'
 *     → ['data engineer python']  (AND = on garde la phrase combinée)
 *   '"Senior" NOT "intern"'
 *     → ['Senior']  (NOT clauses retirées)
 *   'DevOps'
 *     → ['DevOps']  (passthrough)
 */
export function parseBoolean(input: string | null | undefined): string[] {
  if (!input) return [];
  let cleaned = String(input).trim();
  if (!cleaned) return [];

  // 1. Retirer les clauses NOT (NOT "junior", NOT junior)
  cleaned = cleaned.replace(/\bNOT\s+(?:"[^"]+"|\S+)/gi, ' ').trim();

  // 2. Splitter sur OR (les alternatives) — case insensitive
  const orParts = cleaned.split(/\s+OR\s+/i).map(s => s.trim()).filter(Boolean);

  // 3. Pour chaque partie, retirer AND (on garde les mots ANDed dans la même phrase)
  //    et nettoyer les quotes
  const terms: string[] = [];
  for (const part of orParts) {
    const noAnd = part.replace(/\s+AND\s+/gi, ' ');
    // Strip parentheses
    const noParens = noAnd.replace(/[()]/g, ' ').trim();
    // Strip quotes (déjà détectées comme phrase atomique)
    const noQuotes = noParens.replace(/"/g, '').trim();
    if (noQuotes && noQuotes.length >= 2) terms.push(noQuotes);
  }

  return Array.from(new Set(terms)); // dedup
}

/**
 * Extrait keywords d'un RoleFilter[] et retourne une string CSV
 * (lue par buildPdlSqlQuery comme alternatives OR).
 *
 * Garde uniquement les MUST_HAVE + parse le Boolean LinkedIn → termes plats.
 * Les DOESNT_HAVE sont ignorés (PDL n'a pas de NOT efficient en SQL).
 */
function rolesToJobTitle(roles?: RoleFilter[]): string | undefined {
  if (!roles || roles.length === 0) return undefined;
  const usable = roles.filter(r => r.priority !== 'DOESNT_HAVE');
  if (usable.length === 0) return undefined;

  const allTerms: string[] = [];
  for (const r of usable) {
    allTerms.push(...parseBoolean(r.keywords));
  }
  const dedup = Array.from(new Set(allTerms));
  return dedup.length > 0 ? dedup.join(', ') : undefined;
}

/**
 * Normalise un nom de ville/région LinkedIn pour PDL.
 *
 * - lowercase
 * - retire accents (Île-de-France → ile-de-france)
 * - retire préfixes administratifs ("Ville de", "Greater", "Région de", etc.)
 * - retire les "area" / "region" suffixes anglais
 *
 * Exemples :
 *   "Ville de Paris" → "paris"
 *   "Île-de-France" → "ile-de-france"
 *   "Greater Paris Metropolitan Area" → "paris"
 *   "Région Auvergne-Rhône-Alpes" → "auvergne-rhone-alpes"
 */
export function cleanLocationPart(part: string | null | undefined): string {
  if (!part) return '';
  let s = String(part).trim();

  // Retirer accents (NFD decompose + strip combining marks)
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Retirer préfixes français/anglais administratifs
  s = s.replace(/^(?:Ville de|Région|Region|Greater|Grand|Departement de|Commune de)\s+/i, '');

  // Retirer suffixes anglais "Area", "Metropolitan Area", "Metro Area"
  s = s.replace(/\s+(?:Metropolitan|Metro)?\s*Area$/i, '');

  // Lowercase
  return s.toLowerCase().trim();
}

/**
 * Convertit une LocationFilterItem[] en parts location_country / region / locality.
 * Utilise cleanLocationPart pour normaliser chaque part.
 */
function splitLocationParts(locations?: LocationFilterItem[]): {
  country?: string;
  region?: string;
  locality?: string;
} {
  if (!locations || locations.length === 0) return {};
  // Première location prioritaire (PDL ne supporte pas multi-location en SQL simple)
  const first = locations[0];
  if (!first?.name) return {};
  const parts = first.name.split(',').map(s => cleanLocationPart(s)).filter(Boolean);
  // Heuristique : 1 part = pays, 2 parts = ville+pays, 3+ parts = ville+région+pays
  if (parts.length === 1) return { country: parts[0] };
  if (parts.length === 2) return { locality: parts[0], country: parts[1] };
  return { locality: parts[0], region: parts[1], country: parts[parts.length - 1] };
}

/**
 * Convertit le format pivot LinkedInFiltersState vers le body que pdl-search
 * (SQL API) sait consommer. Tout filtre non-mappable est ignoré silencieusement.
 */
export function mapFiltersToPdl(filters: LinkedInFiltersLite, opts?: { size?: number }): PdlSearchBody {
  const body: PdlSearchBody = {};

  // ── Job title : prioriser role[] (avec keywords) puis job_title[]
  const fromRoles = rolesToJobTitle(filters.role);
  if (fromRoles) {
    body.job_title = fromRoles;
  } else if (filters.job_title && filters.job_title.length > 0) {
    body.job_title = filters.job_title.map(t => t.name).filter(Boolean).join(', ');
  } else if (filters.keywords && filters.keywords.length > 0) {
    // Si pas de role et keywords présents → parser le Boolean LinkedIn et
    // utiliser les termes comme alternatives job_title
    const terms = parseBoolean(filters.keywords);
    if (terms.length > 0) body.job_title = terms.join(', ');
  }

  // ── Seniority
  if (filters.seniority && filters.seniority.length > 0) {
    const levels = Array.from(new Set(
      filters.seniority.map(s => SENIORITY_TO_PDL[s]).filter(Boolean)
    ));
    if (levels.length > 0) body.job_title_levels = levels;
  }

  // ── Function (department) → job_title_class
  if (filters.function && filters.function.length > 0) {
    body.job_title_class = filters.function[0].name?.toLowerCase();
  }

  // ── Location
  const loc = splitLocationParts(filters.location);
  if (loc.country) body.location_country = loc.country;
  if (loc.region) body.location_region = loc.region;
  if (loc.locality) body.location_locality = loc.locality;

  // ── Company
  if (filters.company && filters.company.length > 0) {
    body.job_company_name = filters.company[0].name;
  }

  // ── Industry — combine IDs + AI-detected keywords
  const industries = [
    ...(filters.industry?.map(i => i.name) || []),
    ...(filters.industry_keywords || []),
  ].filter(Boolean);
  if (industries.length > 0) {
    body.job_company_industry = industries[0]; // PDL accepte 1 industry à la fois en SQL
  }

  // ── Company headcount → PDL size enum
  if (filters.company_headcount && filters.company_headcount.length > 0) {
    const mapped = HEADCOUNT_TO_PDL[filters.company_headcount[0]];
    if (mapped) body.job_company_size = mapped;
  }

  // ── Skills (combine PriorityFilterItem[] + AI keywords)
  const skills = [
    ...(filters.skills?.filter(s => s.priority !== 'DOESNT_HAVE').map(s => s.name) || []),
    ...(filters.skills_keywords || []),
  ].filter(Boolean);
  if (skills.length > 0) {
    body.skills = Array.from(new Set(skills.map(s => s.toLowerCase())));
  }

  // ── School
  if (filters.school && filters.school.length > 0) {
    const must = filters.school.find(s => s.priority === 'MUST_HAVE') || filters.school[0];
    body.education_school = must.name;
  }

  // ── Languages
  if (filters.profile_language && filters.profile_language.length > 0) {
    body.languages = filters.profile_language.join(',');
  }

  // ── Years of experience (calculated > LinkedIn API > rien)
  const minExp = filters.calculated_experience_min ?? filters.years_of_experience_min;
  const maxExp = filters.calculated_experience_max ?? filters.years_of_experience_max;
  if (minExp != null || maxExp != null) {
    body.years_experience = `${minExp ?? 0}-${maxExp ?? '+'}`;
  }

  // ── Database-only filters
  if (filters.db_funding_stage) {
    // PDL field is job_company_inferred_revenue, but funding_stage is different
    // Skipped for now — pas de mapping direct safe en SQL
  }

  // ── Pagination
  body.size = opts?.size ?? 50;

  return body;
}

// ─── Build PDL SQL query from PdlSearchBody ──────────────────────────────────

/** Sanitize user input for PDL SQL queries: escape single quotes and strip dangerous chars */
export function sanitizePdl(value: string): string {
  return value.replace(/'/g, "''").replace(/[;\\]/g, '').slice(0, 200);
}

/**
 * Build a PDL SQL query string from a PdlSearchBody.
 * Returns null if no condition is generated (caller should error out).
 */
export function buildPdlSqlQuery(body: PdlSearchBody): string | null {
  const conditions: string[] = [];

  // ── Person / Job Title ──
  if (body.job_title) {
    const titles = body.job_title.split(',').map(t => t.trim()).filter(Boolean);
    if (titles.length === 1) conditions.push(`job_title LIKE '%${sanitizePdl(titles[0])}%'`);
    else conditions.push(`(${titles.map(t => `job_title LIKE '%${sanitizePdl(t)}%'`).join(' OR ')})`);
  }
  if (body.job_title_role) conditions.push(`job_title_role='${sanitizePdl(body.job_title_role)}'`);
  if (body.job_title_sub_role) conditions.push(`job_title_sub_role='${sanitizePdl(body.job_title_sub_role)}'`);
  if (body.job_title_class) conditions.push(`job_title_class='${sanitizePdl(body.job_title_class)}'`);
  if (body.job_title_levels && body.job_title_levels.length > 0) {
    if (body.job_title_levels.length === 1) conditions.push(`job_title_levels='${sanitizePdl(body.job_title_levels[0])}'`);
    else conditions.push(`(${body.job_title_levels.map(l => `job_title_levels='${sanitizePdl(l)}'`).join(' OR ')})`);
  }

  // ── Company ──
  if (body.job_company_name) conditions.push(`job_company_name LIKE '%${sanitizePdl(body.job_company_name)}%'`);
  if (body.job_company_industry) conditions.push(`job_company_industry='${sanitizePdl(body.job_company_industry)}'`);
  if (body.job_company_size && body.job_company_size !== 'all') conditions.push(`job_company_size='${sanitizePdl(body.job_company_size)}'`);
  if (body.job_company_type) conditions.push(`job_company_type='${sanitizePdl(body.job_company_type)}'`);
  if (body.job_company_ticker) conditions.push(`job_company_ticker='${sanitizePdl(body.job_company_ticker.toLowerCase())}'`);
  if (body.job_company_founded) {
    const v = sanitizePdl(body.job_company_founded.trim());
    if (v.startsWith('>')) conditions.push(`job_company_founded>=${sanitizePdl(v.slice(1).trim())}`);
    else if (v.startsWith('<')) conditions.push(`job_company_founded<=${sanitizePdl(v.slice(1).trim())}`);
    else conditions.push(`job_company_founded=${sanitizePdl(v)}`);
  }
  if (body.job_company_inferred_revenue) conditions.push(`job_company_inferred_revenue='${sanitizePdl(body.job_company_inferred_revenue)}'`);
  if (body.job_company_total_funding_raised_min) conditions.push(`job_company_total_funding_raised>=${body.job_company_total_funding_raised_min}`);
  if (body.job_company_total_funding_raised_max) conditions.push(`job_company_total_funding_raised<=${body.job_company_total_funding_raised_max}`);

  // ── Location ──
  if (body.location_country) conditions.push(`location_country='${sanitizePdl(body.location_country)}'`);
  if (body.location_continent) conditions.push(`location_continent='${sanitizePdl(body.location_continent)}'`);
  if (body.location_region) conditions.push(`location_region LIKE '%${sanitizePdl(body.location_region)}%'`);
  if (body.location_metro) conditions.push(`location_metro LIKE '%${sanitizePdl(body.location_metro)}%'`);
  if (body.location_locality) conditions.push(`location_locality LIKE '%${sanitizePdl(body.location_locality)}%'`);

  // ── Skills ──
  if (body.skills && body.skills.length > 0) {
    conditions.push(`(${body.skills.map(s => `skills LIKE '%${sanitizePdl(s)}%'`).join(' OR ')})`);
  }

  // ── Experience ──
  if (body.years_experience) {
    const [minStr, maxStr] = body.years_experience.split('-');
    const min = parseInt(minStr);
    if (!isNaN(min)) conditions.push(`inferred_years_experience>=${min}`);
    if (maxStr && !maxStr.includes('+')) {
      const max = parseInt(maxStr);
      if (!isNaN(max)) conditions.push(`inferred_years_experience<=${max}`);
    }
  }
  if (body.industry) conditions.push(`industry='${sanitizePdl(body.industry)}'`);

  // ── Education ──
  if (body.education_school) conditions.push(`education.school.name LIKE '%${sanitizePdl(body.education_school)}%'`);
  if (body.education_degree) conditions.push(`education.degrees='${sanitizePdl(body.education_degree)}'`);
  if (body.education_major) conditions.push(`education.majors LIKE '%${sanitizePdl(body.education_major)}%'`);

  // ── Languages ──
  if (body.languages) {
    const langs = body.languages.split(',').map(l => l.trim().toLowerCase()).filter(Boolean);
    if (langs.length > 0) conditions.push(`(${langs.map(l => `languages.name='${sanitizePdl(l)}'`).join(' OR ')})`);
  }

  // ── Certifications / Interests / Summary ──
  if (body.certifications) conditions.push(`certifications.name LIKE '%${sanitizePdl(body.certifications)}%'`);
  if (body.interests) {
    const ints = body.interests.split(',').map(i => i.trim().toLowerCase()).filter(Boolean);
    if (ints.length > 0) conditions.push(`(${ints.map(i => `interests='${sanitizePdl(i)}'`).join(' OR ')})`);
  }
  if (body.summary) conditions.push(`summary LIKE '%${sanitizePdl(body.summary)}%'`);

  // ── Intent signals ──
  if (body.intent_job_change) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    conditions.push(`job_start_date>='${sixMonthsAgo.toISOString().split('T')[0]}'`);
  }
  if (body.recently_funded) {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    conditions.push(`job_company_funding_details.last_funding_date>='${oneYearAgo.toISOString().split('T')[0]}'`);
  }

  if (conditions.length === 0) return null;

  return `SELECT * FROM person WHERE ${conditions.join(' AND ')}`;
}

// ─── Cache helpers (read/write pdl_profile_cache) ────────────────────────────

const PDL_BASE = 'https://api.peopledatalabs.com/v5';

export interface PdlSearchOptions {
  size?: number;
  scrollToken?: string;
  /** Quel champ envoyer à PDL : 'all' (defaut, inclut historique) ou 'resume' */
  dataset?: string;
  /** Timeout HTTP ms */
  timeoutMs?: number;
}

export interface PdlSearchResponse {
  status: number;
  data: any[];
  total: number;
  scroll_token?: string;
  error?: string;
}

/** Fetch with timeout helper (Deno) */
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Appel direct à l'API PDL Person Search.
 * Retourne { status, data, total, scroll_token, error? }
 */
export async function searchPdl(
  apiKey: string,
  sqlQuery: string,
  options: PdlSearchOptions = {},
): Promise<PdlSearchResponse> {
  const searchBody: Record<string, unknown> = {
    sql: sqlQuery,
    size: Math.min(options.size ?? 50, 100),
    dataset: options.dataset ?? 'all',
  };
  if (options.scrollToken) searchBody.scroll_token = options.scrollToken;

  const response = await fetchWithTimeout(`${PDL_BASE}/person/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify(searchBody),
  }, options.timeoutMs ?? 20000);

  const text = await response.text();

  if (!response.ok) {
    // 404 not_found = empty result, not an error
    if (response.status === 404) {
      try {
        const parsed = JSON.parse(text);
        if (parsed?.error?.type === 'not_found') {
          return { status: 200, data: [], total: 0 };
        }
      } catch { /* fallthrough */ }
    }
    return { status: response.status, data: [], total: 0, error: text.slice(0, 500) };
  }

  let parsed: any;
  try { parsed = JSON.parse(text); } catch (e) {
    return { status: 500, data: [], total: 0, error: `Invalid JSON response: ${e}` };
  }

  return {
    status: response.status,
    data: Array.isArray(parsed.data) ? parsed.data : [],
    total: Number(parsed.total ?? parsed.data?.length ?? 0),
    scroll_token: parsed.scroll_token,
  };
}

/**
 * Normalise un linkedin_url pour le matching cache.
 * Lowercase, strip trailing slash, strip query/hash.
 */
export function normalizeLinkedInUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return String(url)
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '')
    .trim() || null;
}

interface SupabaseLikeClient {
  from: (table: string) => any;
}

/**
 * Lookup cache : retourne une Map<linkedin_url normalisé, profile_data>
 * pour les profils trouvés et non expirés.
 */
export async function lookupPdlCache(
  supabase: SupabaseLikeClient,
  organizationId: string,
  linkedinUrls: string[],
): Promise<Map<string, any>> {
  const normalized = linkedinUrls.map(normalizeLinkedInUrl).filter(Boolean) as string[];
  if (normalized.length === 0) return new Map();

  const { data, error } = await supabase
    .from('pdl_profile_cache')
    .select('linkedin_url, profile_data, fetched_at')
    .eq('organization_id', organizationId)
    .in('linkedin_url', normalized)
    .gt('expires_at', new Date().toISOString());

  if (error) {
    console.warn('[pdl-cache] lookup error:', error.message);
    return new Map();
  }

  const map = new Map<string, any>();
  for (const row of (data || [])) {
    if (row.linkedin_url) map.set(row.linkedin_url, row.profile_data);
  }
  return map;
}

/**
 * Write / upsert cache pour les profils enrichis.
 * Idempotent via ON CONFLICT (organization_id, pdl_id).
 */
export async function writePdlCache(
  supabase: SupabaseLikeClient,
  organizationId: string,
  entries: Array<{ pdl_id: string; linkedin_url: string | null; profile_data: any; source_query_hash?: string; credits_consumed?: number }>,
): Promise<void> {
  if (entries.length === 0) return;

  const rows = entries.map(e => ({
    organization_id: organizationId,
    pdl_id: e.pdl_id,
    linkedin_url: normalizeLinkedInUrl(e.linkedin_url),
    profile_data: e.profile_data,
    source_query_hash: e.source_query_hash || null,
    credits_consumed: e.credits_consumed ?? 1,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }));

  const { error } = await supabase
    .from('pdl_profile_cache')
    .upsert(rows, { onConflict: 'organization_id,pdl_id' });

  if (error) {
    console.warn('[pdl-cache] write error:', error.message);
  }
}

/**
 * Hash léger d'une chaîne pour identifier une requête source.
 * Utilisé uniquement pour debug/audit (source_query_hash du cache).
 *
 * Implémentation 100% sync FNV-1a (32-bit) — évite crypto.subtle qui peut
 * planter sur Supabase Edge runtime ("Deno.core.runMicrotasks() is not supported").
 * Ce hash n'est pas cryptographique mais c'est OK pour notre usage non-sensible.
 */
export function sha256Hex(s: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Pad to 8 hex chars
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}

// ─── Mapping PDL Person → LinkedInProfile ────────────────────────────────────

/**
 * Convertit une date PDL (ex: "2020-03-01" ou "2020-03") en { year, month }.
 */
function parsePdlDate(s: string | null | undefined): { year?: number; month?: number } | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?/);
  if (!m) return null;
  const year = parseInt(m[1]);
  const month = m[2] ? parseInt(m[2]) : undefined;
  return { year, month };
}

/**
 * Extrait un domaine canonique depuis une URL ou un domaine brut.
 * "https://www.finary.com/about" → "finary.com"
 * "linkedin.com/company/finary" → null (on filtre les linkedin URLs)
 */
export function extractDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let raw = String(input).trim();
  if (!raw) return null;

  // Déjà un domaine sans schéma ?
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }

  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    // Filtrer les domaines social/linkedin/etc — pas un vrai site société
    if (/(?:^|\.)(?:linkedin|facebook|twitter|x|instagram)\.com$/.test(host)) return null;
    if (host.length < 3 || !host.includes('.')) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * Construit une URL Clearbit Logo à partir d'un domaine.
 * Gratuit, illimité, 404 gracieux si pas de logo.
 */
export function clearbitLogoUrl(domain: string | null | undefined): string | null {
  if (!domain) return null;
  return `https://logo.clearbit.com/${domain}`;
}

function pdlExpToWorkExperience(exp: any) {
  // PDL ne fournit pas de logo — on dérive depuis le domaine du website société
  const website = exp.company?.website || null;
  const domain = extractDomain(website);
  const logoUrl = clearbitLogoUrl(domain);

  return {
    company: exp.company?.name || exp.company || undefined,
    company_id: exp.company?.id || undefined,
    company_url: exp.company?.linkedin_url || website || undefined,
    company_picture_url: logoUrl, // Clearbit fallback
    company_description: undefined, // PDL ne fournit pas de description marketing
    company_headcount: null, // size PDL est une string range, pas un { min, max }
    industry: exp.company?.industry || undefined,
    location: exp.location_names?.[0] || undefined,
    role: exp.title?.name || exp.title || undefined,
    description: exp.summary || undefined,
    current: !exp.end_date,
    logo: logoUrl, // alias, certains composants lisent .logo
    start: parsePdlDate(exp.start_date),
    end: exp.end_date ? parsePdlDate(exp.end_date) : null,
  };
}

function pdlEduToEducation(edu: any) {
  const website = edu.school?.website || null;
  const domain = extractDomain(website);
  const logoUrl = clearbitLogoUrl(domain);

  return {
    school: edu.school?.name || edu.school || undefined,
    school_id: edu.school?.id || undefined,
    school_url: edu.school?.linkedin_url || website || undefined,
    school_picture_url: logoUrl, // Clearbit fallback
    degree: Array.isArray(edu.degrees) ? edu.degrees.join(', ') : edu.degrees || undefined,
    field_of_study: Array.isArray(edu.majors) ? edu.majors.join(', ') : edu.majors || undefined,
    start: parsePdlDate(edu.start_date),
    end: edu.end_date ? parsePdlDate(edu.end_date) : null,
    school_details: edu.school
      ? {
          name: edu.school.name,
          location: edu.school.location?.name,
          description: undefined,
          url: edu.school.website,
          logo: logoUrl, // alias dans school_details
        }
      : undefined,
  };
}

/**
 * Mappe un objet Person PDL brut vers LinkedInProfile (format pivot retour
 * utilisé par la table Notion et toute la chaîne de scoring).
 *
 * Champs non remplis par PDL (gap structurel) :
 *  - profile_picture_url (PDL renvoie parfois `profile_pic_url` mais souvent vide)
 *  - logos société / école (à compléter via Brandfetch ultérieurement)
 *  - network_distance (pas de graph LinkedIn)
 *  - open_to_work signal natif (PDL ne suit pas)
 *  - recommendations, recent_posts (pas dans le scope PDL)
 */
export function pdlToLinkedInProfile(p: any): LinkedInProfileLite {
  const emails = Array.isArray(p.emails)
    ? p.emails.map((e: any) => typeof e === 'string' ? e : e?.address).filter(Boolean)
    : [];
  const phones = Array.isArray(p.phone_numbers)
    ? p.phone_numbers.map((ph: any) => typeof ph === 'string' ? ph : ph?.number).filter(Boolean)
    : Array.isArray(p.phones)
      ? p.phones.filter(Boolean)
      : [];

  const skills = Array.isArray(p.skills)
    ? p.skills.map((s: any) => ({ name: typeof s === 'string' ? s : s?.name })).filter((s: any) => s.name)
    : [];

  const languages = Array.isArray(p.languages)
    ? p.languages.map((l: any) => ({
        name: typeof l === 'string' ? l : l?.name,
        proficiency: l?.proficiency,
      })).filter((l: any) => l.name)
    : [];

  const certifications = Array.isArray(p.certifications)
    ? p.certifications.map((c: any) => ({
        name: typeof c === 'string' ? c : c?.name,
        organization: c?.organization,
      })).filter((c: any) => c.name)
    : [];

  const work_experience = Array.isArray(p.experience)
    ? p.experience.map(pdlExpToWorkExperience)
    : [];

  const education = Array.isArray(p.education)
    ? p.education.map(pdlEduToEducation)
    : [];

  // Reconstruction location concaténée
  const locationParts = [p.location_locality, p.location_region, p.location_country]
    .filter(Boolean);
  const location = locationParts.length > 0 ? locationParts.join(', ') : undefined;

  return {
    id: p.id || p.linkedin_id || crypto.randomUUID(),
    type: 'PUBLIC_PROFILE',
    name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || undefined,
    first_name: p.first_name,
    last_name: p.last_name,
    headline: p.headline || (p.job_title && p.job_company_name ? `${p.job_title} chez ${p.job_company_name}` : p.job_title),
    summary: p.summary,
    profile_url: p.linkedin_url || undefined,
    public_profile_url: p.linkedin_url || undefined,
    profile_picture_url: p.profile_pic_url || undefined,
    location,
    industry: p.industry || p.job_company_industry,
    pronoun: undefined,
    connections_count: p.linkedin_connections,
    followers_count: undefined,
    primary_locale: p.location_country
      ? { country: p.location_country, language: undefined }
      : undefined,
    contact_info: (emails.length > 0 || phones.length > 0)
      ? { emails, phones }
      : undefined,
    skills,
    languages,
    certifications,
    education,
    work_experience,
    source: 'database',
    _provider: 'pdl',
  };
}

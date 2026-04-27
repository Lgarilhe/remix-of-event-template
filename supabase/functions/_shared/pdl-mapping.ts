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
 * Extrait keywords / scope d'un RoleFilter pour PDL job_title.
 * PDL n'a pas de scope (CURRENT/PAST), on garde juste les MUST_HAVE.
 */
function rolesToJobTitle(roles?: RoleFilter[]): string | undefined {
  if (!roles || roles.length === 0) return undefined;
  const must = roles.filter(r => r.priority === 'MUST_HAVE');
  const items = (must.length > 0 ? must : roles)
    .map(r => r.keywords?.trim())
    .filter(Boolean);
  return items.length > 0 ? items.join(', ') : undefined;
}

/** Convertit une LocationFilterItem[] en parts location_country / region / locality */
function splitLocationParts(locations?: LocationFilterItem[]): {
  country?: string;
  region?: string;
  locality?: string;
} {
  if (!locations || locations.length === 0) return {};
  // Première location prioritaire (PDL ne supporte pas multi-location en SQL simple)
  const first = locations[0];
  if (!first?.name) return {};
  const parts = first.name.split(',').map(s => s.trim()).filter(Boolean);
  // Heuristique : 1 part = pays, 2 parts = ville+pays, 3 parts = ville+région+pays
  if (parts.length === 1) return { country: parts[0].toLowerCase() };
  if (parts.length === 2) return { locality: parts[0], country: parts[1].toLowerCase() };
  return { locality: parts[0], region: parts[1], country: parts[parts.length - 1].toLowerCase() };
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
  } else if (filters.keywords && filters.keywords.length > 0 && filters.keywords.length < 100) {
    // Si pas de role et keywords courts → considérer comme job_title
    body.job_title = filters.keywords;
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

function pdlExpToWorkExperience(exp: any) {
  return {
    company: exp.company?.name || exp.company || undefined,
    company_id: exp.company?.id || undefined,
    company_url: exp.company?.linkedin_url || exp.company?.website || undefined,
    company_picture_url: undefined, // PDL ne fournit pas de logo
    company_description: undefined, // idem
    company_headcount: exp.company?.size ? null : null, // size est une string range chez PDL
    industry: exp.company?.industry || undefined,
    location: exp.location_names?.[0] || undefined,
    role: exp.title?.name || exp.title || undefined,
    description: exp.summary || undefined,
    current: !exp.end_date,
    logo: undefined,
    start: parsePdlDate(exp.start_date),
    end: exp.end_date ? parsePdlDate(exp.end_date) : null,
  };
}

function pdlEduToEducation(edu: any) {
  return {
    school: edu.school?.name || edu.school || undefined,
    school_id: edu.school?.id || undefined,
    school_url: edu.school?.linkedin_url || edu.school?.website || undefined,
    degree: Array.isArray(edu.degrees) ? edu.degrees.join(', ') : edu.degrees || undefined,
    field_of_study: Array.isArray(edu.majors) ? edu.majors.join(', ') : edu.majors || undefined,
    start: parsePdlDate(edu.start_date),
    end: edu.end_date ? parsePdlDate(edu.end_date) : null,
    school_details: edu.school
      ? {
          name: edu.school.name,
          location: edu.school.location?.name,
          description: undefined, // PDL ne fournit pas de description
          url: edu.school.website,
          logo: null,
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

/**
 * Shared Coresignal mapping helpers — convertit entre :
 *   - LinkedInFiltersState (format pivot frontend) → requête Elasticsearch DSL
 *     de l'API employee_multi_source
 *   - Objet Coresignal brut (collect ou preview) → LinkedInProfile (format pivot)
 *
 * Utilisé par coresignal-search. Cf. docs/coresignal-integration-audit.md.
 *
 * IMPORTANT : le nom du fournisseur (Coresignal) ne doit jamais apparaître dans
 * un message d'erreur user-facing. On dit « Base Konekt ». Voir CLAUDE.md.
 *
 * Règles ES DSL vérifiées en test live (cf. audit §12) :
 *  - `match_phrase` obligatoire sur les intitulés de poste (`match` tokenise →
 *    faux positifs massifs).
 *  - Toujours filtrer `is_deleted: 0`.
 *  - Max 15 000 caractères et 1 024 clauses booléennes par requête.
 *  - Les champs incertains vont en `should` (une clause `match` sur un champ
 *    non mappé renvoie 0 hit sans erreur — dangereux en `must`, inoffensif en
 *    `should`).
 */

// ─── Types locaux (dupliqués depuis le frontend pour rester self-contained) ──

export interface FilterItem { id: string; name: string; }
export interface PriorityFilterItem extends FilterItem { priority: 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE'; }
export interface LocationFilterItem extends FilterItem { priority: string; scope: string; }
export interface RoleFilter { keywords: string; priority: string; scope: string; }

/** Subset de LinkedInFiltersState — champs que Coresignal peut consommer. */
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
  past_company?: FilterItem[];
  // AI-generated keyword filters
  skills_keywords?: string[];
  industry_keywords?: string[];
  location_keywords?: string[];
  // Base Konekt (db_*)
  exclude_consulting?: boolean;
  db_company_domain?: string;
  db_email_verified?: boolean | null;
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
  connections_count?: number;
  followers_count?: number;
  open_to_work?: boolean;
  contact_info?: { emails?: string[]; phones?: string[] };
  skills?: Array<{ name: string }>;
  languages?: Array<{ name: string; proficiency?: string }>;
  certifications?: Array<{ name?: string; organization?: string }>;
  education?: Array<{
    school?: string;
    school_url?: string;
    degree?: string;
    field_of_study?: string;
    start?: string | { year?: number; month?: number } | null;
    end?: string | { year?: number; month?: number } | null;
  }>;
  work_experience?: Array<{
    company?: string;
    company_url?: string;
    company_description?: string;
    industry?: string;
    location?: string;
    role?: string;
    description?: string;
    current?: boolean;
    start?: string | { month?: number; year?: number } | null;
    end?: string | { month?: number; year?: number } | null;
  }>;
  /** Marqueur de provenance — pour UI conditionnelle et enrichment. */
  source?: 'database' | 'linkedin';
  /** Métadonnées internes (jamais exposé user). */
  _provider?: 'coresignal';
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. Mapping filtres → Elasticsearch DSL (employee_multi_source)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Séniorité LinkedIn (apiValue 1..10) → Coresignal active_experience_management_level.
 * Aligné sur SENIORITY_LEVELS (src/components/outreach/types.ts).
 * Valeurs cibles = 11 niveaux du data dictionary Coresignal (avril 2026).
 */
const SENIORITY_TO_MGMT_LEVEL: Record<string, string> = {
  '1': 'Entry',
  '2': 'Entry',
  '3': 'Professional',
  '4': 'Senior',
  '5': 'Manager',
  '6': 'Director',
  '7': 'Vice President',
  '8': 'C-Level',
  '9': 'Partner',
  '10': 'Owner',
};

/** Fonction/département LinkedIn → Coresignal active_experience_department. */
const FUNCTION_TO_DEPARTMENT: Record<string, string> = {
  engineering: 'Engineering',
  sales: 'Sales',
  marketing: 'Marketing',
  operations: 'Operations',
  finance: 'Finance',
  human_resources: 'Human Resources',
  product: 'Product Management',
  product_management: 'Product Management',
  legal: 'Legal',
  design: 'Design',
  data_science: 'Data Science',
  it: 'Information Technology',
  consulting: 'Consulting',
};

type EsClause = Record<string, unknown>;

/**
 * Construit les clauses OU (match_phrase) pour TOUTES les variantes d'intitulé.
 * Un intitulé = match_phrase (obligatoire, cf. audit). Toutes les variantes
 * (plusieurs filtres de poste + « OR »/virgules internes) sont fusionnées dans
 * un unique `should` : le candidat doit matcher AU MOINS UN intitulé.
 */
function titleShouldClauses(keywordsList: string[]): EsClause[] {
  const parts = keywordsList
    .flatMap((k) => k.split(/\s+OR\s+|,/i))
    .map((s) => s.trim())
    .filter(Boolean);
  const uniq = [...new Set(parts)];
  return uniq.flatMap((p) => ([
    { match_phrase: { active_experience_title: p } },
    { match_phrase: { 'experience.position_title': p } },
  ]));
}

/**
 * Convertit LinkedInFiltersState (subset) en requête Elasticsearch DSL pour
 * l'endpoint employee_multi_source/search/es_dsl (ou /preview).
 *
 * Stratégie de robustesse :
 *  - `must` = clauses vérifiées (titre, localisation, skills MUST_HAVE, is_deleted).
 *  - `should` = raffinements sur des champs moins certains (jamais bloquants).
 *  - `must_not` = exclusions (DOESNT_HAVE, exclude_consulting).
 */
export function mapFiltersToEsDsl(filters: LinkedInFiltersLite): {
  query: EsClause;
  sort: unknown[];
} {
  const must: EsClause[] = [];
  const should: EsClause[] = [];
  const mustNot: EsClause[] = [];
  const filter: EsClause[] = [{ term: { is_deleted: 0 } }];

  // ── Titres / rôles ──
  const titleSources: string[] = [];
  (filters.role ?? []).forEach((r) => {
    if (!r?.keywords) return;
    if (r.priority === 'DOESNT_HAVE') {
      mustNot.push({ match_phrase: { active_experience_title: r.keywords } });
    } else {
      titleSources.push(r.keywords);
    }
  });
  (filters.job_title ?? []).forEach((t) => {
    if (!t?.name) return;
    if (t.priority === 'DOESNT_HAVE') {
      mustNot.push({ match_phrase: { active_experience_title: t.name } });
    } else {
      titleSources.push(t.name);
    }
  });
  // TOUTES les variantes d'intitulé dans UNE seule clause `must` (OU interne).
  // Sinon plusieurs filtres de poste seraient ET-és → un candidat devrait
  // porter tous les intitulés à la fois → 0 résultat (bug constaté en prod).
  const titleShould = titleShouldClauses(titleSources);
  if (titleShould.length > 0) {
    must.push({ bool: { should: titleShould, minimum_should_match: 1 } });
  }

  // ── Localisation ── (name = "Paris" / "France" / "Paris, Île-de-France, France")
  const locationNames = [
    ...(filters.location ?? []).map((l) => l?.name).filter(Boolean) as string[],
    ...(filters.location_keywords ?? []).filter(Boolean),
  ];
  if (locationNames.length > 0) {
    must.push({
      bool: {
        should: locationNames.map((name) => ({ match_phrase: { location_full: name } })),
        minimum_should_match: 1,
      },
    });
  }

  // ── Skills ── (inferred_skills, vérifié en test)
  const skillNames = [
    ...(filters.skills ?? []).map((s) => ({ name: s.name, priority: s.priority })),
    ...(filters.skills_keywords ?? []).map((name) => ({ name, priority: 'CAN_HAVE' as const })),
  ].filter((s) => s.name);
  skillNames.forEach((s) => {
    const clause = { match: { inferred_skills: s.name } };
    if (s.priority === 'MUST_HAVE') must.push(clause);
    else if (s.priority === 'DOESNT_HAVE') mustNot.push(clause);
    else should.push(clause);
  });

  // ── Séniorité → management level (best-effort en should) ──
  const mgmtLevels = (filters.seniority ?? [])
    .map((s) => SENIORITY_TO_MGMT_LEVEL[s])
    .filter(Boolean);
  if (mgmtLevels.length > 0) {
    should.push({
      bool: {
        should: mgmtLevels.map((lvl) => ({ match: { active_experience_management_level: lvl } })),
        minimum_should_match: 1,
      },
    });
  }

  // ── Fonction → département (best-effort en should) ──
  const departments = (filters.function ?? [])
    .map((f) => FUNCTION_TO_DEPARTMENT[(f.id || f.name || '').toLowerCase()])
    .filter(Boolean);
  if (departments.length > 0) {
    should.push({
      bool: {
        should: departments.map((d) => ({ match: { active_experience_department: d } })),
        minimum_should_match: 1,
      },
    });
  }

  // ── Industrie (best-effort) ──
  const industries = [
    ...(filters.industry ?? []).map((i) => i.name).filter(Boolean) as string[],
    ...(filters.industry_keywords ?? []).filter(Boolean),
  ];
  industries.forEach((name) => should.push({ match: { company_industry: name } }));

  // ── Entreprise actuelle (best-effort, plusieurs noms de champ candidats) ──
  (filters.company ?? []).forEach((c) => {
    if (!c?.name) return;
    should.push({
      bool: {
        should: [
          { match_phrase: { active_experience_company_name: c.name } },
          { match_phrase: { 'experience.company_name': c.name } },
        ],
        minimum_should_match: 1,
      },
    });
  });

  // ── Entreprise passée (best-effort) ──
  (filters.past_company ?? []).forEach((c) => {
    if (!c?.name) return;
    should.push({ match_phrase: { 'experience.company_name': c.name } });
  });

  // ── École (best-effort) ──
  (filters.school ?? []).forEach((s) => {
    if (!s?.name) return;
    if (s.priority === 'DOESNT_HAVE') {
      mustNot.push({ match_phrase: { 'education.institution_name': s.name } });
    } else {
      should.push({ match_phrase: { 'education.institution_name': s.name } });
    }
  });

  // ── Expérience (années) → total_experience_duration_months (range) ──
  // Champ numérique documenté. En `filter` (pas de score), non bloquant si vide.
  const expMin = filters.calculated_experience_min ?? filters.years_of_experience_min;
  const expMax = filters.calculated_experience_max ?? filters.years_of_experience_max;
  if ((expMin != null && expMin > 0) || (expMax != null && expMax > 0)) {
    const range: Record<string, number> = {};
    if (expMin != null && expMin > 0) range.gte = expMin * 12;
    if (expMax != null && expMax > 0) range.lte = expMax * 12;
    filter.push({ range: { total_experience_duration_months: range } });
  }

  // ── Langues parlées (best-effort) ──
  (filters.profile_language ?? []).forEach((lang) => {
    if (lang) should.push({ match: { 'languages.language': lang } });
  });

  // ── Mots-clés libres → recherche plein texte (simple_query_string, tolérant) ──
  if (filters.keywords && filters.keywords.trim()) {
    must.push({
      simple_query_string: {
        query: filters.keywords.trim().slice(0, 500),
        fields: ['headline', 'summary', 'experience.description', 'inferred_skills'],
        default_operator: 'and',
      },
    });
  }

  // ── db_* : email pro dispo ──
  if (filters.db_email_verified) {
    filter.push({ exists: { field: 'primary_professional_email' } });
  }

  // ── db_* : domaine société actuelle (best-effort) ──
  if (filters.db_company_domain && filters.db_company_domain.trim()) {
    should.push({ match: { active_experience_company_website: filters.db_company_domain.trim() } });
  }

  // ── Exclure ESN / conseil ──
  if (filters.exclude_consulting) {
    mustNot.push({ match: { active_experience_department: 'Consulting' } });
  }

  const bool: Record<string, unknown> = { filter };
  if (must.length) bool.must = must;
  if (should.length) {
    bool.should = should;
    // les `should` restent purement additifs (ne filtrent pas) tant qu'il y a
    // au moins un `must` ; sinon on exige au moins un should.
    if (must.length === 0) bool.minimum_should_match = 1;
  }
  if (mustNot.length) bool.must_not = mustNot;

  return { query: { bool }, sort: ['_score'] };
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. Mapping profil Coresignal → LinkedInProfile
// ═══════════════════════════════════════════════════════════════════════════

function stripHtml(s: unknown): string | undefined {
  if (typeof s !== 'string' || !s) return undefined;
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || undefined;
}

function normalizeLinkedinUrl(raw: unknown): string | undefined {
  const url = typeof raw === 'string' ? raw : undefined;
  if (!url) return undefined;
  return url.replace(/\/+$/, '');
}

function toYearMonth(year: unknown, month: unknown): { year?: number; month?: number } | null {
  const y = typeof year === 'number' ? year : (typeof year === 'string' && year ? Number(year) : undefined);
  const m = typeof month === 'number' ? month : (typeof month === 'string' && month ? Number(month) : undefined);
  if (!y && !m) return null;
  const out: { year?: number; month?: number } = {};
  if (y && !Number.isNaN(y)) out.year = y;
  if (m && !Number.isNaN(m)) out.month = m;
  return Object.keys(out).length ? out : null;
}

function coresignalExpToWork(exp: Record<string, unknown>) {
  const start = toYearMonth(exp.date_from_year, exp.date_from_month);
  const end = toYearMonth(exp.date_to_year, exp.date_to_month);
  return {
    company: (exp.company_name as string) || undefined,
    company_url: normalizeLinkedinUrl(exp.company_linkedin_url) || (exp.company_website as string) || undefined,
    company_description: undefined,
    industry: (exp.company_industry as string) || undefined,
    location: (exp.location as string) || undefined,
    role: (exp.position_title as string) || undefined,
    description: stripHtml(exp.description),
    current: end === null,
    start,
    end,
  };
}

function coresignalEduToEdu(edu: Record<string, unknown>) {
  return {
    school: (edu.institution_name as string) || undefined,
    school_url: normalizeLinkedinUrl(edu.institution_url) || undefined,
    degree: (edu.degree as string) || undefined,
    field_of_study: (edu.field_of_study as string) || (edu.subject as string) || undefined,
    start: toYearMonth(edu.date_from_year, undefined),
    end: toYearMonth(edu.date_to_year, undefined),
  };
}

/**
 * Mappe un profil Coresignal COMPLET (collect employee_multi_source) vers
 * LinkedInProfile. Champs non fournis (gap structurel) : téléphone, email perso,
 * network_distance, open_to_work fiable, recommendations.
 */
export function coresignalToLinkedInProfile(raw: Record<string, unknown>): LinkedInProfileLite {
  const inferredSkills = Array.isArray(raw.inferred_skills)
    ? (raw.inferred_skills as unknown[])
        .map((s) => ({ name: typeof s === 'string' ? s : (s as Record<string, unknown>)?.name as string }))
        .filter((s) => s.name)
    : [];

  const languages = Array.isArray(raw.languages)
    ? (raw.languages as Record<string, unknown>[])
        .map((l) => ({
          name: (l.language as string) || (l.name as string),
          proficiency: (l.proficiency as string) || undefined,
        }))
        .filter((l) => l.name)
    : [];

  const certifications = Array.isArray(raw.certifications)
    ? (raw.certifications as Record<string, unknown>[])
        .map((c) => ({ name: (c.title as string) || (c.name as string), organization: (c.issuer as string) || undefined }))
        .filter((c) => c.name)
    : [];

  const work_experience = Array.isArray(raw.experience)
    ? (raw.experience as Record<string, unknown>[]).map(coresignalExpToWork)
    : [];

  const education = Array.isArray(raw.education)
    ? (raw.education as Record<string, unknown>[]).map(coresignalEduToEdu)
    : [];

  const email = raw.primary_professional_email as string | undefined;
  const location =
    (raw.location_full as string) ||
    [raw.location_city, raw.location_state, raw.location_country].filter(Boolean).join(', ') ||
    undefined;

  const linkedin = normalizeLinkedinUrl(raw.linkedin_url) || normalizeLinkedinUrl(raw.professional_network_url);
  // L'industrie n'est pas au top-level du collect : on la dérive de l'expérience active.
  const industry =
    (raw.company_industry as string) ||
    (raw.active_experience_company_industry as string) ||
    work_experience.find((w) => w.current)?.industry ||
    work_experience[0]?.industry ||
    undefined;

  return {
    id: String(raw.id ?? crypto.randomUUID()),
    type: 'PUBLIC_PROFILE',
    name: (raw.full_name as string) || `${raw.first_name || ''} ${raw.last_name || ''}`.trim() || undefined,
    first_name: (raw.first_name as string) || undefined,
    last_name: (raw.last_name as string) || undefined,
    headline: (raw.headline as string) || (raw.active_experience_title as string) || undefined,
    summary: stripHtml(raw.summary),
    profile_url: linkedin,
    public_profile_url: linkedin,
    profile_picture_url: (raw.picture_url as string) || undefined,
    location,
    industry,
    connections_count: typeof raw.connections_count === 'number' ? raw.connections_count : undefined,
    followers_count: typeof raw.followers_count === 'number' ? raw.followers_count : undefined,
    contact_info: email ? { emails: [email], phones: [] } : undefined,
    skills: inferredSkills,
    languages,
    certifications,
    education,
    work_experience,
    source: 'database',
    _provider: 'coresignal',
  };
}

/**
 * Mappe un profil Coresignal PARTIEL (search preview) vers LinkedInProfile.
 * Suffisant pour une card candidat (identité, poste actuel, société) sans
 * consommer un crédit collect. Le poste courant devient une work_experience
 * unique pour l'affichage.
 */
export function coresignalPreviewToProfile(raw: Record<string, unknown>): LinkedInProfileLite {
  const linkedin = normalizeLinkedinUrl(raw.linkedin_url) || normalizeLinkedinUrl(raw.professional_network_url);
  const company = (raw.company_name as string) || undefined;
  const role = (raw.active_experience_title as string) || undefined;

  return {
    id: String(raw.id ?? crypto.randomUUID()),
    type: 'PUBLIC_PROFILE',
    name: (raw.full_name as string) || undefined,
    headline: (raw.headline as string) || role || undefined,
    profile_url: linkedin,
    public_profile_url: linkedin,
    location: (raw.location_full as string) || (raw.location_country as string) || undefined,
    industry: (raw.company_industry as string) || undefined,
    connections_count: typeof raw.connections_count === 'number' ? raw.connections_count : undefined,
    followers_count: typeof raw.followers_count === 'number' ? raw.followers_count : undefined,
    work_experience: (company || role)
      ? [{
          company,
          role,
          industry: (raw.company_industry as string) || undefined,
          location: (raw.company_hq_full_address as string) || undefined,
          current: true,
        }]
      : [],
    source: 'database',
    _provider: 'coresignal',
  };
}

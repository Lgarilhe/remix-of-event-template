import type { GeneratedFilters } from '@/components/outreach/search/generateFiltersFromJob';
import type { JobDetails } from '@/types/jobDetails';

/**
 * Brief d'un poste tel que l'onboarding le montre et le fait corriger. Il naît
 * de la réponse de `generate-search-filters` et redevient, une fois corrigé,
 * les filtres et le brief enregistrés sur la mission.
 */
export interface BriefDraft {
  title: string;
  /** Intitulés visés (les alternatives se cherchent en « OU »). */
  titles: string[];
  skills: string[];
  xpMin: number | null;
  xpMax: number | null;
  location: string;
  /** Sociétés « pépinières » où chercher ce type de profil. */
  feeders: string[];
  altSkills: string[];
  altTitles: string[];
  rationale: string | null;
  category: string | null;
  /** Filtres IA bruts : base de `filters_snapshot`, corrigés par `briefToFilters`. */
  filters: GeneratedFilters | null;
}

type Raw = Record<string, unknown>;

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr).map((s) => s.trim()) : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Liste sans doublon (casse ignorée), dans l'ordre d'arrivée. */
export function uniqueList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** « "SRE" OU "Platform Engineer" » : les intitulés d'un filtre de poste. */
export function splitRoleKeywords(keywords: string | undefined): string[] {
  if (!keywords) return [];
  return uniqueList(keywords.split(/\s+OR\s+/i).map((part) => part.replace(/^["'\s]+|["'\s]+$/g, '')));
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const clipped = text.slice(0, max);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, lastSpace > 40 ? lastSpace : max).replace(/[,;:\s]+$/, '')}…`;
}

/** Brief vide : l'IA n'a pas répondu, l'utilisateur écrit lui-même. */
export function emptyBrief(title: string): BriefDraft {
  return {
    title,
    titles: title ? [title] : [],
    skills: [],
    xpMin: null,
    xpMax: null,
    location: '',
    feeders: [],
    altSkills: [],
    altTitles: [],
    rationale: null,
    category: null,
    filters: null,
  };
}

/**
 * Lit la réponse de `generate-search-filters`. Rend null quand elle ne porte
 * pas de filtres (la fonction répond alors 200 avec `fallback: true`).
 */
export function parseBriefResponse(data: unknown, title: string): BriefDraft | null {
  const d = (data && typeof data === 'object' ? data : {}) as Raw;
  if (d.success !== true || !d.filters || typeof d.filters !== 'object') return null;

  const filters = d.filters as GeneratedFilters;
  const analysis = (d.analysis && typeof d.analysis === 'object' ? d.analysis : {}) as Raw;
  const suggestions = (d.suggestions && typeof d.suggestions === 'object' ? d.suggestions : {}) as Raw;
  const power = (d.power_filters && typeof d.power_filters === 'object' ? d.power_filters : {}) as Raw;

  const titles = splitRoleKeywords(filters.role?.[0]?.keywords);
  const location = strList(filters.location_keywords)[0] ?? (isStr(analysis.location_hint) ? analysis.location_hint.trim() : '');
  const rationale = isStr(analysis.search_rationale) ? cut(analysis.search_rationale.trim(), 220) : null;

  return {
    title: isStr(analysis.suggested_title) && !title ? analysis.suggested_title.trim() : title,
    titles: titles.length > 0 ? titles : title ? [title] : [],
    skills: uniqueList(strList(filters.skills_keywords)).slice(0, 12),
    xpMin: num(filters.years_of_experience_min),
    xpMax: num(filters.years_of_experience_max),
    location,
    feeders: uniqueList(strList(power.feeder_companies)).slice(0, 8),
    altSkills: uniqueList(strList(suggestions.alt_skills)).slice(0, 8),
    altTitles: uniqueList(strList(suggestions.alt_titles)).slice(0, 5),
    rationale,
    category: isStr(analysis.job_category) ? analysis.job_category : null,
    filters,
  };
}

/** Phrase lue à voix haute : « 5 à 10 ans », « 5 ans et plus », « jusqu'à 3 ans ». */
export function experienceLabel(min: number | null, max: number | null): string {
  const year = (n: number) => `${n} an${n > 1 ? 's' : ''}`;
  if (min === null && max === null) return 'Non précisée';
  if (min !== null && max !== null) return min === max ? year(min) : `${min} à ${year(max)}`;
  if (min !== null) return `${year(min)} et plus`;
  return `jusqu'à ${year(max as number)}`;
}

/**
 * Filtres au format IA, avec les corrections faites à l'écran : c'est ce que
 * la mission enregistre et que la recherche relit. Sans réponse de l'IA
 * (`filters` nul), on part de filtres vides plutôt que d'en inventer.
 */
export function briefToFilters(draft: BriefDraft): GeneratedFilters {
  const base: GeneratedFilters = draft.filters ?? {
    keywords: '',
    role: [],
    seniority: [],
    years_of_experience_min: null,
    years_of_experience_max: null,
    skills_keywords: [],
    industry_keywords: [],
    location_keywords: [],
    location_within_area: null,
    company_keywords: [],
    school: [],
    spotlight: '',
    open_to_work: false,
  };
  const titles = uniqueList(draft.titles);
  return {
    ...base,
    role: titles.length > 0
      ? [{ keywords: titles.length > 1 ? titles.join(' OR ') : titles[0], priority: 'MUST_HAVE', scope: 'CURRENT' }]
      : base.role,
    skills_keywords: uniqueList(draft.skills),
    years_of_experience_min: draft.xpMin,
    years_of_experience_max: draft.xpMax,
    location_keywords: draft.location.trim() ? [draft.location.trim()] : [],
  };
}

export interface BriefContext {
  client: string | null;
  sector: string | null;
  website: string | null;
  logoUrl: string | null;
  /** Texte de départ tapé par l'utilisateur (poste et client). */
  briefText: string;
}

/** Brief structuré de la mission (`sourcing_projects.job_details`), comme celui du parcours « brief » de la création de mission. */
export function briefToJobDetails(draft: BriefDraft, ctx: BriefContext): JobDetails {
  const skills = uniqueList(draft.skills);
  const client = ctx.client
    ? {
        name: ctx.client,
        ...(ctx.sector ? { sector: ctx.sector } : {}),
        ...(ctx.website ? { website: ctx.website } : {}),
        ...(ctx.logoUrl ? { logo_url: ctx.logoUrl } : {}),
      }
    : undefined;
  return {
    title: draft.title,
    mission_description: draft.rationale ?? ctx.briefText,
    raw_brief: ctx.briefText,
    brief_source: 'ai_structured',
    ...(draft.location.trim() ? { location: draft.location.trim() } : {}),
    ...(draft.xpMin !== null ? { experience_min: draft.xpMin } : {}),
    ...(draft.xpMax !== null ? { experience_max: draft.xpMax } : {}),
    skills_must_have: skills.slice(0, 6),
    skills_should_have: skills.slice(6),
    ...(client ? { client } : {}),
  };
}

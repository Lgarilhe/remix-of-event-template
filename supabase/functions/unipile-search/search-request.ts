/**
 * Requête de recherche Konekt (le format « à plat » que construisent
 * buildSearchParams du navigateur, continuous-sourcing-filters et run-agent-search)
 * vers l'état de filtres que compile `toKonektFilters`.
 *
 * Le compilateur partagé prend l'ÉTAT de filtres de l'interface, pas la requête
 * à plat : une valeur change de sens entre les deux (une école `CAN_HAVE` est une
 * école « à examiner, non cherchée » dans l'état et une inclusion dans la requête
 * à plat, les durées sont des tableaux `[{ min, max }]` à plat et des bornes
 * `_min` / `_max` dans l'état, une activité de recrutement est une liste d'objets
 * à plat et un mode `with_message` / `without_message` dans l'état). Ce module est
 * la seule traduction entre les deux.
 *
 * Parité avec la génération précédente : un filtre que la licence n'appliquait pas
 * (par exemple `role` en Sales Navigator, `skills` en Classic) reste non appliqué
 * et est rendu dans `ignored`, avec son libellé français, au lieu d'être
 * silencieusement perdu. Les erreurs d'entrée (requête booléenne incomplète,
 * recherche enregistrée, catégorie autre que les personnes) lèvent une
 * `UnipileInputError` 4xx avant tout appel au prestataire.
 */

import {
  FILTER_LABELS_FR,
  toKonektFilters,
  UnipileError,
  type CompiledSearch,
  type DroppedFilter,
  type KonektSearchFilters,
} from '../_shared/unipile/index.ts';
import { searchBooleanIssue } from '../_shared/search-boolean.ts';
import { UnipileInputError } from './responses.ts';

export type SearchApi = 'classic' | 'recruiter' | 'sales_navigator';

export const SEARCH_APIS: readonly SearchApi[] = ['classic', 'recruiter', 'sales_navigator'];

/** Longueur maximale d'une requête de mots-clés hors Recruiter (règle Konekt, inchangée). */
export const MAX_KEYWORDS_NON_RECRUITER = 200;

export interface AdaptedSearch {
  api: SearchApi;
  filters: KonektSearchFilters;
  /** Spotlights Recruiter valides, tous (le compilateur n'en garde qu'un en plus de « ouvert aux opportunités »). */
  spotlights: string[];
  /** Filtres posés dans la requête que la licence n'applique pas. */
  ignored: DroppedFilter[];
}

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Une valeur de requête « posée » : liste non vide, objet avec une valeur, texte, nombre, `true`. */
function isSetValue(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isRec(v)) return Object.values(v).some((x) => (Array.isArray(x) ? x.length > 0 : x !== undefined && x !== null));
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

/** Paramètres de la requête à plat que la génération précédente appliquait, par licence. */
const COMMON = ['keywords', 'network_distance', 'profile_language', 'past_company', 'recruiting_activity', 'tags'] as const;
export const APPLIED_PARAMS: Record<SearchApi, ReadonlySet<string>> = {
  classic: new Set([...COMMON, 'advanced_keywords', 'location', 'company', 'industry', 'school', 'open_to']),
  sales_navigator: new Set([
    ...COMMON, 'saved_search_id', 'recent_search_id', 'location', 'company', 'industry', 'school', 'job_title', 'function',
    'seniority', 'years_of_experience', 'tenure', 'tenure_at_company', 'tenure_at_role', 'company_headcount', 'company_type',
    'company_location', 'groups', 'past_job_title',
  ]),
  recruiter: new Set([
    ...COMMON, 'location', 'location_within_area', 'company', 'company_keywords', 'industry', 'school', 'job_title', 'skills',
    'role', 'function', 'degree', 'seniority', 'years_of_experience', 'tenure', 'tenure_at_company', 'tenure_at_role',
    'tenure_in_company', 'tenure_in_position', 'open_to_work', 'spotlights', 'spotlight', 'hiring_project', 'spoken_languages',
    'employment_type', 'graduation_year', 'hide_previously_viewed', 'recently_joined', 'company_headcount', 'groups',
    'past_job_title',
  ]),
};

/** Paramètre à plat → nom du filtre de l'interface (pour le libellé). */
const FILTER_OF_PARAM: Record<string, string> = {
  tenure: 'years_of_experience',
  tenure_in_company: 'tenure_at_company',
  tenure_in_position: 'tenure_at_role',
  spotlights: 'spotlight',
};
const EXTRA_LABELS: Record<string, string> = {
  advanced_keywords: 'Mots-clés avancés',
  saved_search_id: 'Recherche enregistrée',
  recent_search_id: 'Recherche récente',
  recruiting_activity: 'Activité de recrutement',
};
const ALL_FILTER_PARAMS: ReadonlySet<string> = new Set(SEARCH_APIS.flatMap((api) => [...APPLIED_PARAMS[api]]));

function dropped(filter: string, reason: DroppedFilter['reason'] = 'unsupported'): DroppedFilter {
  return { filter, label: FILTER_LABELS_FR[filter] ?? EXTRA_LABELS[filter] ?? filter, reason };
}

function booleanQuery(input: unknown, label: string): string {
  const issue = searchBooleanIssue(input);
  if (issue === 'empty') throw new UnipileInputError(`Renseignez la requête « ${label} ».`, 400, 'INVALID_BOOLEAN_QUERY');
  if (issue === 'quotes' || issue === 'parentheses') {
    throw new UnipileInputError(`Fermez les guillemets et les parenthèses de la requête « ${label} ».`, 400, 'INVALID_BOOLEAN_QUERY');
  }
  if (issue === 'operators') throw new UnipileInputError(`Complétez les opérateurs de la requête « ${label} ».`, 400, 'INVALID_BOOLEAN_QUERY');
  return input as string;
}

/** Entrées d'objets d'une liste, avec leurs mots-clés validés (la requête d'origine reste telle quelle). */
function checkedEntries(value: unknown, label: string): Rec[] {
  return list(value).filter(isRec).map((entry) => {
    if (entry.keywords !== undefined) booleanQuery(entry.keywords, label);
    return entry;
  });
}

/** Une plage `{ min, max }` à plat vers deux bornes. */
function rangeOf(value: unknown): { min: number | null; max: number | null } | null {
  if (!isRec(value)) return null;
  const min = num(value.min);
  const max = num(value.max);
  return min === null && max === null ? null : { min, max };
}

/** Tableau de plages (Sales Navigator, `tenure` d'avant) : la plus large, une borne absente restant ouverte. */
function hullOf(value: unknown): { min: number | null; max: number | null } | null {
  const ranges = list(value).map(rangeOf).filter((r): r is { min: number | null; max: number | null } => r !== null);
  if (ranges.length === 0) return null;
  const mins = ranges.map((r) => r.min);
  const maxs = ranges.map((r) => r.max);
  return {
    min: mins.some((m) => m === null) ? null : Math.min(...(mins as number[])),
    max: maxs.some((m) => m === null) ? null : Math.max(...(maxs as number[])),
  };
}

const VALID_RECRUITER_SPOTLIGHTS = new Set([
  'OPEN_TO_WORK', 'ACTIVE_TALENT', 'REDISCOVERED_CANDIDATES', 'INTERNAL_CANDIDATES', 'INTERESTED_IN_YOUR_COMPANY',
  'HAVE_COMPANY_CONNECTIONS',
]);

/**
 * Traduit la requête à plat de la licence `api` en état de filtres. Ne fait aucun
 * appel réseau ; lève `UnipileInputError` pour une entrée refusée.
 */
export function adaptSearchRequest(params: Rec, api: SearchApi): AdaptedSearch {
  const applied = APPLIED_PARAMS[api];
  const ignored: DroppedFilter[] = [];
  for (const key of ALL_FILTER_PARAMS) {
    if (applied.has(key) || !isSetValue(params[key])) continue;
    const filter = FILTER_OF_PARAM[key] ?? key;
    if (!ignored.some((d) => d.filter === filter)) ignored.push(dropped(filter));
  }
  const p = (key: string): unknown => (applied.has(key) ? params[key] : undefined);

  const f: KonektSearchFilters = { api, category: 'people' };

  // Mots-clés : requête booléenne conservée telle quelle, jamais réparée.
  if (typeof params.keywords === 'string' && params.keywords !== '') {
    if (api !== 'recruiter' && params.keywords.length > MAX_KEYWORDS_NON_RECRUITER) {
      throw new UnipileInputError(
        `La requête « Mots-clés » contient ${params.keywords.length} caractères. Cette recherche accepte actuellement jusqu’à ${MAX_KEYWORDS_NON_RECRUITER} caractères pour cette licence. Raccourcissez-la ou utilisez Recruiter.`,
        400,
        'KEYWORDS_TOO_LONG',
      );
    }
    f.keywords = booleanQuery(params.keywords, 'Mots-clés');
  }

  // Recherches enregistrées : elles remplaceraient tous les autres filtres, les ignorer lancerait une autre recherche.
  if (api === 'sales_navigator' && (isSetValue(params.saved_search_id) || isSetValue(params.recent_search_id))) {
    throw new UnipileInputError('Les recherches enregistrées ne sont pas encore disponibles. Lancez la recherche avec ses filtres.', 400, 'SAVED_SEARCH_UNSUPPORTED');
  }

  const advanced = p('advanced_keywords');
  if (isRec(advanced)) {
    const first = text(advanced.first_name);
    const last = text(advanced.last_name);
    const title = text(advanced.title);
    if (first) f.first_name = first;
    if (last) f.last_name = last;
    if (title) f.title_keywords = title;
    if (text(advanced.company) || text(advanced.school)) ignored.push(dropped('advanced_keywords'));
  }

  f.location = p('location') as KonektSearchFilters['location'];
  if (api === 'recruiter' && num(params.location_within_area) !== null) f.location_within_area = num(params.location_within_area);

  // Entreprises : un objet sans identifiant mais avec des mots-clés est une entreprise « par mots-clés » (Recruiter).
  const companyKeywordEntries: Rec[] = checkedEntries(p('company_keywords'), 'Entreprise');
  const company = p('company');
  if (Array.isArray(company)) {
    const refs: unknown[] = [];
    for (const entry of company) {
      if (isRec(entry) && entry.keywords !== undefined) {
        if (api === 'recruiter') booleanQuery(entry.keywords, 'Entreprise');
        if (entry.id === undefined) {
          if (api === 'recruiter') companyKeywordEntries.push(entry);
          else if (!ignored.some((d) => d.filter === 'company_keywords')) ignored.push(dropped('company_keywords'));
          continue;
        }
      }
      refs.push(entry);
    }
    f.company = refs as KonektSearchFilters['company'];
  } else {
    f.company = company as KonektSearchFilters['company'];
  }
  if (api === 'recruiter' && companyKeywordEntries.length > 0) {
    f.company_keywords = companyKeywordEntries.map((e) => ({
      keywords: text(e.keywords), priority: text(e.priority), scope: text(e.scope),
    }));
  }

  f.industry = p('industry') as KonektSearchFilters['industry'];

  // Écoles : en Recruiter, `CAN_HAVE` de la requête à plat est une inclusion (le compilateur l'attend en `MUST_HAVE`).
  const school = p('school');
  f.school = (api === 'recruiter' && Array.isArray(school)
    ? school.map((s) => (isRec(s) && s.priority === 'CAN_HAVE' ? { ...s, priority: 'MUST_HAVE' } : s))
    : school) as KonektSearchFilters['school'];

  const jobTitle = p('job_title');
  if (Array.isArray(jobTitle)) {
    f.job_title = checkedEntries(jobTitle, 'Poste').map((e) => ({
      id: e.id as string | number | null | undefined,
      name: text(e.name) ?? text(e.keywords),
      priority: text(e.priority),
      scope: text(e.scope),
    }));
  }

  const skills = p('skills');
  if (Array.isArray(skills)) {
    f.skills = checkedEntries(skills, 'Compétence').map((e) => ({
      id: e.id as string | number | null | undefined,
      name: text(e.name) ?? text(e.keywords),
      priority: text(e.priority),
    }));
  }

  const role = p('role');
  if (Array.isArray(role)) {
    f.role = checkedEntries(role, 'Poste').map((e) => ({ keywords: text(e.keywords), priority: text(e.priority), scope: text(e.scope) }));
  }

  // Fonction : Recruiter ne gardait que les identifiants inclus.
  const fn = p('function');
  if (api === 'recruiter' && isRec(fn)) {
    f.function = list(fn.include) as string[];
    if (list(fn.exclude).length > 0) ignored.push(dropped('function', 'exclusion'));
  } else {
    f.function = fn as KonektSearchFilters['function'];
  }

  f.degree = p('degree') as KonektSearchFilters['degree'];
  f.seniority = list(p('seniority')).filter((s): s is string => typeof s === 'string');
  f.network_distance = list(p('network_distance')) as KonektSearchFilters['network_distance'];
  f.profile_language = list(p('profile_language')).filter((s): s is string => typeof s === 'string');

  // Durées : Recruiter lit `years_of_experience`, puis l'ancien `tenure[0]` ; Sales Navigator lit `tenure`, puis `years_of_experience`.
  const experience = api === 'recruiter'
    ? rangeOf(p('years_of_experience')) ?? hullOf(p('tenure'))
    : hullOf(p('tenure')) ?? rangeOf(p('years_of_experience'));
  if (experience) {
    f.years_of_experience_min = experience.min;
    f.years_of_experience_max = experience.max;
  }
  const atCompany = api === 'recruiter'
    ? rangeOf(list(p('tenure_at_company'))[0]) ?? rangeOf(p('tenure_in_company'))
    : hullOf(p('tenure_at_company'));
  if (atCompany) {
    f.tenure_at_company_min = atCompany.min;
    f.tenure_at_company_max = atCompany.max;
  }
  const atRole = api === 'recruiter'
    ? rangeOf(list(p('tenure_at_role'))[0]) ?? rangeOf(p('tenure_in_position'))
    : hullOf(p('tenure_at_role'));
  if (atRole) {
    f.tenure_at_role_min = atRole.min;
    f.tenure_at_role_max = atRole.max;
  }

  const openTo = list(p('open_to')).filter((s): s is string => typeof s === 'string');
  if (openTo.length > 0) f.open_to = openTo;

  // Spotlights Recruiter : « ouvert aux opportunités », `spotlight` et `spotlights`, les valeurs inconnues sont écartées.
  const spotlights = api === 'recruiter'
    ? [...new Set([
      ...list(params.spotlights).filter((s): s is string => typeof s === 'string'),
      ...(text(params.spotlight) ? [text(params.spotlight) as string] : []),
      ...(params.open_to_work === true ? ['OPEN_TO_WORK'] : []),
    ])].filter((s) => VALID_RECRUITER_SPOTLIGHTS.has(s))
    : [];
  if (spotlights.includes('OPEN_TO_WORK')) f.open_to_work = true;
  const otherSpotlight = spotlights.find((s) => s !== 'OPEN_TO_WORK');
  if (otherSpotlight) f.spotlight = otherSpotlight;

  const hiringProject = text(p('hiring_project'));
  if (hiringProject) f.hiring_project = hiringProject;

  // Activité de recrutement : la liste à plat devient les modes de l'état. Les étiquettes demandent leurs identifiants (`tags`).
  for (const entry of list(p('recruiting_activity')).filter(isRec)) {
    const id = text(entry.id);
    const days = num(entry.timespan);
    if ((id === 'messages' || id === 'notes') && (entry.priority === 'MUST_HAVE' || entry.priority === 'DOESNT_HAVE')) {
      const mode = id === 'messages'
        ? (entry.priority === 'MUST_HAVE' ? 'with_message' : 'without_message')
        : (entry.priority === 'MUST_HAVE' ? 'with_note' : 'without_note');
      if (id === 'messages') {
        f.activity_messages = mode;
        f.activity_messages_days = days;
      } else {
        f.activity_notes = mode;
        f.activity_notes_days = days;
      }
    } else if (id !== 'tags' && !ignored.some((d) => d.filter === 'recruiting_activity')) {
      ignored.push(dropped('recruiting_activity'));
    }
  }
  const tags = list(p('tags')).filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  if (tags.length > 0) f.tags = tags;
  else if (list(p('recruiting_activity')).some((a) => isRec(a) && a.id === 'tags')) ignored.push(dropped('tags'));

  f.spoken_languages = list(p('spoken_languages')).filter(isRec).map((e) => ({
    language: text(e.language), priority: text(e.priority), scope: text(e.scope),
  }));
  f.employment_type = list(p('employment_type')).filter((s): s is string => typeof s === 'string');
  const graduation = rangeOf(p('graduation_year'));
  if (graduation) {
    f.graduation_year_min = graduation.min;
    f.graduation_year_max = graduation.max;
  }
  const hide = isRec(p('hide_previously_viewed')) ? num((p('hide_previously_viewed') as Rec).timespan) : null;
  if (hide !== null && hide > 0) f.hide_previously_viewed = hide;
  const joined = rangeOf(list(p('recently_joined'))[0]);
  if (joined) {
    f.recently_joined_min = joined.min;
    f.recently_joined_max = joined.max;
  }

  const headcount = list(p('company_headcount'));
  const letters = headcount.filter((h): h is string => typeof h === 'string');
  if (letters.length > 0) f.company_headcount = letters;
  if (headcount.length > letters.length) ignored.push(dropped('company_headcount', 'value'));
  f.company_type = list(p('company_type')).filter((s): s is string => typeof s === 'string');
  f.company_location = p('company_location') as KonektSearchFilters['company_location'];
  f.groups = p('groups') as KonektSearchFilters['groups'];
  f.past_company = p('past_company') as KonektSearchFilters['past_company'];
  f.past_job_title = p('past_job_title') as KonektSearchFilters['past_job_title'];

  return { api, filters: f, spotlights, ignored };
}

/** Identifiant d'un projet Recruiter : chiffres seulement (`^[0-9]+$` chez le prestataire). */
const RECRUITER_PROJECT_ID_RE = /^\d{1,20}$/;

/**
 * `recruiter_project_id` (choisi dans le sélecteur de projets Recruiter) limite la recherche aux personnes
 * déjà dans ce projet : c'est le filtre `project` de la recherche de personnes Recruiter, que la requête à
 * plat nomme `hiring_project`. Un `hiring_project` donné explicitement l'emporte. Hors Recruiter, le filtre
 * est rendu dans `filters_dropped` comme tout filtre que la licence n'applique pas. Identifiant invalide :
 * refus avant tout appel.
 */
function withRecruiterProject(params: Rec): Rec {
  const raw = params.recruiter_project_id;
  if (raw === undefined || raw === null || raw === '') return params;
  const id = typeof raw === 'number' ? String(raw) : raw;
  if (typeof id !== 'string' || !RECRUITER_PROJECT_ID_RE.test(id.trim())) {
    throw new UnipileInputError('Ce projet Recruiter n’est pas valide. Choisissez-le de nouveau dans la liste.', 400, 'RECRUITER_PROJECT_INVALID');
  }
  return text(params.hiring_project) ? params : { ...params, hiring_project: id.trim() };
}

export interface CompiledSearchRequest {
  api: SearchApi;
  compiled: CompiledSearch;
  /** Filtres non appliqués : ceux que la licence ne sait pas exprimer et ceux qu'elle n'appliquait pas déjà. */
  dropped: DroppedFilter[];
}

/**
 * Requête à plat → requête du prestataire : source et catégorie contrôlées,
 * traduction (`adaptSearchRequest`), compilation par licence (`toKonektFilters`),
 * spotlights Recruiter complétés. Pure et sans réseau.
 */
export function compileSearchRequest(params: Rec): CompiledSearchRequest {
  const api = String(params.api ?? 'recruiter').toLowerCase();
  if (!(SEARCH_APIS as readonly string[]).includes(api)) {
    throw new UnipileInputError('Cette source de recherche n’est pas prise en charge.', 400, 'UNSUPPORTED_SEARCH_SOURCE');
  }
  if ((params.category ?? 'people') !== 'people') {
    throw new UnipileInputError('Seules les recherches de personnes sont prises en charge.', 400, 'UNSUPPORTED_SEARCH_CATEGORY');
  }
  const adapted = adaptSearchRequest(withRecruiterProject(params), api as SearchApi);
  let compiled: CompiledSearch;
  try {
    compiled = toKonektFilters(adapted.filters, {
      product: api as SearchApi,
      cursor: typeof params.cursor === 'string' ? params.cursor : null,
      limit: typeof params.limit === 'number' ? params.limit : undefined,
    });
  } catch (error) {
    if (error instanceof UnipileError && error.code === 'invalid_cursor') {
      throw new UnipileInputError('La page demandée n’est plus valide. Relancez la recherche.', 400, 'INVALID_CURSOR');
    }
    throw error;
  }
  // Le compilateur ne garde qu'un spotlight en plus de « ouvert aux opportunités » : la liste complète prime.
  if (api === 'recruiter' && adapted.spotlights.length > 0) compiled.body.spotlights = adapted.spotlights;
  return { api: api as SearchApi, compiled, dropped: [...compiled.dropped, ...adapted.ignored] };
}

/**
 * Action `search_from_url` de unipile-search : une adresse de recherche LinkedIn collée
 * (Classic, Recruiter ou Sales Navigator) devient les filtres de l'interface.
 *
 * Aucune recherche n'est lancée ici. L'action rend `{ kind, keywords, filters, warnings }` :
 *  - `kind` : la licence de l'adresse (`classic`, `recruiter`, `sales_navigator`) ;
 *  - `filters` : le sous-ensemble de `LinkedInFiltersState` (src/components/outreach/types.ts)
 *    que l'adresse porte et qu'on sait lire sans se tromper, `api` et `category` compris ;
 *  - `warnings` : libellés français de ce que l'adresse contient et que l'on n'a pas repris.
 *
 * Ce qu'on lit
 *  - Classic : les paramètres `keywords`, `network`, `geoUrn`, `currentCompany`, `pastCompany`, `industry`,
 *    `schoolFilter`, `profileLanguage` (et leurs formes `facet*`). `firstName`, `lastName` et `title` n'ont ni
 *    champ à l'écran ni équivalent dans la recherche : ils sont signalés, jamais repris.
 *  - Sales Navigator : le paramètre `query` (tuples Rest.li), types REGION, CURRENT_TITLE, PAST_TITLE,
 *    CURRENT_COMPANY, PAST_COMPANY, INDUSTRY, FUNCTION, COMPANY_HEADQUARTERS, SCHOOL, GROUP,
 *    PROFILE_LANGUAGE et RELATIONSHIP, avec le texte de chaque valeur.
 *  - Recruiter : les mots-clés seulement. Une recherche Recruiter récente garde ses filtres chez
 *    LinkedIn (`searchRequestId`) : l'adresse ne les contient pas.
 *
 * Un identifiant LinkedIn n'a pas de nom dans une adresse Classic : l'élément porte alors son numéro
 * (« Lieu n° 105015875 »), que l'écran laisse corriger. Un critère exclu (Sales Navigator) n'est repris que
 * là où la recherche l'applique (titres, entreprises) ; pour un lieu ou une école, il est signalé. Rien n'est deviné : une valeur
 * illisible est signalée, jamais remplacée.
 */

import {
  FILTER_LABELS_FR,
  resolveSearchUrl,
  UnipileError,
  type ResolvedSearchUrl,
  type SearchLicence,
} from '../_shared/unipile/index.ts';
import { licenceProblem, searchLicenceProblem } from './licence.ts';
import { failureResponse, json } from './responses.ts';

type Dict = Record<string, unknown>;

export interface SearchFromUrlValue {
  kind: SearchLicence;
  keywords: string | null;
  filters: Dict;
  warnings: string[];
}

export type SearchFromUrlOutcome =
  | { ok: true; value: SearchFromUrlValue }
  | { ok: false; status: number; errorType: string; reason: string; error: string };

const UNSUPPORTED_KIND_MESSAGE =
  "Seules les recherches de personnes peuvent être reprises. Collez l'adresse d'une recherche de personnes.";

const PEOPLE_KINDS: ReadonlySet<string> = new Set(['classic_people', 'recruiter_search', 'sales_navigator_people']);

/** Longueur maximale d'une adresse collée. */
const MAX_URL_LENGTH = 8000;
const ID_RE = /^\d{1,20}$/;
const LANGUAGE_RE = /^[A-Za-z0-9_-]{1,32}$/;

const LABEL_LOCATION = FILTER_LABELS_FR.location;
const LABEL_COMPANY = FILTER_LABELS_FR.company;
const LABEL_PAST_COMPANY = FILTER_LABELS_FR.past_company;
const LABEL_INDUSTRY = FILTER_LABELS_FR.industry;
const LABEL_SCHOOL = FILTER_LABELS_FR.school;
const LABEL_NETWORK = FILTER_LABELS_FR.network_distance;
const LABEL_LANGUAGE = FILTER_LABELS_FR.profile_language;
const LABEL_OTHER = 'Autres critères de l’adresse';

/** Valeur d'adresse décodée une fois de plus quand elle porte encore des `%xx` (Sales Navigator encode deux fois). */
function safeDecode(value: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

class Warnings {
  private readonly seen = new Set<string>();
  readonly list: string[] = [];
  add(label: string | undefined): void {
    if (!label || this.seen.has(label)) return;
    this.seen.add(label);
    this.list.push(label);
  }
}

// ---------------------------------------------------------------------------
// Classic
// ---------------------------------------------------------------------------

/** Liste d'un paramètre Classic : `["F","S"]`, `F,S` ou une valeur seule. */
export function classicList(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) return [];
  const text = raw.trim();
  if (text === '') return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter((v) => v !== '');
    if (typeof parsed === 'string' || typeof parsed === 'number') return [String(parsed).trim()].filter((v) => v !== '');
  } catch {
    // Pas du JSON : liste séparée par des virgules.
  }
  return text
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((v) => v.replace(/^["'\s]+|["'\s]+$/g, ''))
    .filter((v) => v !== '');
}

const NETWORK_LETTERS: Readonly<Record<string, number>> = { F: 1, S: 2, O: 3 };

/** Degrés de relation (`F`, `S`, `O`) vers 1, 2, 3 ; `unreadable` quand une lettre n'a pas d'équivalent. */
function networkDegrees(values: readonly string[]): { degrees: number[]; unreadable: boolean } {
  const degrees: number[] = [];
  let unreadable = false;
  for (const value of values) {
    const degree = NETWORK_LETTERS[value.toUpperCase()];
    if (degree === undefined) unreadable = true;
    else if (!degrees.includes(degree)) degrees.push(degree);
  }
  return { degrees, unreadable };
}

/** Libellés des paramètres Classic connus que l'on ne reprend pas. */
const CLASSIC_UNREAD_LABELS: Readonly<Record<string, string>> = {
  company: 'Entreprise (texte libre)',
  school: 'École (texte libre)',
  servicecategory: 'Catégorie de service',
  connectionof: 'Relations de',
  followerof: 'Abonnés de',
  facetgeoregion: LABEL_LOCATION,
  firstname: 'Prénom',
  lastname: 'Nom',
  title: 'Titre (texte libre)',
};

/** Paramètres lus (en minuscules), avec leur forme `facet*`. */
const CLASSIC_READ_PARAMS: ReadonlySet<string> = new Set([
  'keywords', 'network', 'facetnetwork', 'geourn', 'currentcompany', 'facetcurrentcompany', 'pastcompany',
  'facetpastcompany', 'industry', 'facetindustry', 'schoolfilter', 'facetschool', 'profilelanguage',
  'facetprofilelanguage',
]);

/** Paramètres qui ne sont pas des critères et que le résolveur laisse passer. */
const CLASSIC_IGNORED_PARAMS: ReadonlySet<string> = new Set(['sortby', 'facetfetchedurl', 'fetchedurl']);

function classicFilters(resolved: ResolvedSearchUrl, url: URL, warnings: Warnings): Dict {
  const lower = new Map<string, string>();
  for (const [key, value] of url.searchParams) {
    if (!lower.has(key.toLowerCase())) lower.set(key.toLowerCase(), value);
  }
  const first = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value = lower.get(name);
      if (value !== undefined && value.trim() !== '') return value;
    }
    return undefined;
  };
  const filters: Dict = {};

  const network = networkDegrees(classicList(first('network', 'facetnetwork')));
  if (network.degrees.length > 0) filters.network_distance = network.degrees;
  if (network.unreadable) warnings.add(LABEL_NETWORK);

  /** Identifiants numériques d'un paramètre ; un identifiant illisible est signalé, jamais gardé. */
  const ids = (label: string, ...names: string[]): string[] => {
    const raw = classicList(first(...names));
    const good = [...new Set(raw.filter((v) => ID_RE.test(v)))];
    if (good.length < raw.length) warnings.add(label);
    return good;
  };

  const geo = ids(LABEL_LOCATION, 'geourn');
  if (geo.length > 0) {
    filters.location = geo.map((id) => ({ id, name: `Lieu n° ${id}`, priority: 'CAN_HAVE', scope: 'CURRENT' }));
  }
  const current = ids(LABEL_COMPANY, 'currentcompany', 'facetcurrentcompany');
  if (current.length > 0) {
    filters.company = current.map((id) => ({ id, name: `Entreprise n° ${id}`, priority: 'CAN_HAVE', scope: 'CURRENT' }));
  }
  const past = ids(LABEL_PAST_COMPANY, 'pastcompany', 'facetpastcompany');
  if (past.length > 0) filters.past_company = past.map((id) => ({ id, name: `Entreprise n° ${id}` }));
  const industry = ids(LABEL_INDUSTRY, 'industry', 'facetindustry');
  if (industry.length > 0) filters.industry = industry.map((id) => ({ id, name: `Secteur n° ${id}` }));
  const school = ids(LABEL_SCHOOL, 'schoolfilter', 'facetschool');
  // Une école « à examiner » (CAN_HAVE) n'est pas cherchée dans l'interface : l'adresse la demande, donc MUST_HAVE.
  if (school.length > 0) filters.school = school.map((id) => ({ id, name: `École n° ${id}`, priority: 'MUST_HAVE' }));

  const languages = [...new Set(classicList(first('profilelanguage', 'facetprofilelanguage')).filter((v) => LANGUAGE_RE.test(v)))];
  if (languages.length > 0) filters.profile_language = languages.map((v) => v.toLowerCase());

  // Le reste de l'adresse : connu (libellé propre) ou inconnu (libellé commun).
  for (const key of resolved.filterKeys) {
    const k = key.toLowerCase();
    if (CLASSIC_READ_PARAMS.has(k) || CLASSIC_IGNORED_PARAMS.has(k)) continue;
    if ((lower.get(k) ?? '').trim() === '') continue;
    warnings.add(CLASSIC_UNREAD_LABELS[k] ?? LABEL_OTHER);
  }
  return filters;
}

// ---------------------------------------------------------------------------
// Sales Navigator (tuples Rest.li)
// ---------------------------------------------------------------------------

/** Éléments d'une liste séparés par les virgules du premier niveau de parenthèses. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.filter((p) => p.trim() !== '');
}

/** Contenu d'un `(…)` ou d'un `List(…)`. */
function unwrap(text: string): string {
  const t = text.trim();
  const open = t.startsWith('List(') ? 5 : t.startsWith('(') ? 1 : -1;
  if (open === -1 || !t.endsWith(')')) return t;
  return t.slice(open, -1);
}

/** Entrées `clé:valeur` du premier niveau d'un tuple. */
export function tupleEntries(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  let lastKey: string | null = null;
  for (const part of splitTopLevel(unwrap(text))) {
    const colon = part.indexOf(':');
    if (colon > 0) {
      lastKey = part.slice(0, colon).trim();
      entries.set(lastKey, part.slice(colon + 1).trim());
    } else if (lastKey === 'text') {
      // Texte encodé une seule fois : sa virgule est devenue un séparateur. Le fragment sans clé redevient la suite du texte.
      entries.set('text', `${entries.get('text') ?? ''},${part}`.trim());
    }
  }
  return entries;
}

interface SalesValue {
  id: string;
  text: string;
  excluded: boolean;
}

interface SalesFilter {
  type: string;
  values: SalesValue[];
}

/** Filtres de la requête Sales Navigator : type et valeurs (identifiant, texte, inclus ou exclu). */
export function salesFilters(query: string): SalesFilter[] {
  const top = tupleEntries(query);
  const list = top.get('filters');
  if (!list) return [];
  const out: SalesFilter[] = [];
  for (const raw of splitTopLevel(unwrap(list))) {
    const entry = tupleEntries(raw);
    const type = entry.get('type');
    if (!type) continue;
    const values: SalesValue[] = [];
    for (const valueRaw of splitTopLevel(unwrap(entry.get('values') ?? ''))) {
      const v = tupleEntries(valueRaw);
      const id = v.get('id');
      if (id === undefined) continue;
      const text = safeDecode(v.get('text') ?? '').trim();
      values.push({ id: id.trim(), text, excluded: (v.get('selectionType') ?? '').toUpperCase() === 'EXCLUDED' });
    }
    out.push({ type, values });
  }
  return out;
}

type SalesTarget =
  | { key: 'location' | 'company'; shape: 'located' }
  | { key: 'job_title' | 'past_job_title'; shape: 'titled' }
  | { key: 'school'; shape: 'school' }
  | { key: 'past_company' | 'industry' | 'function' | 'company_location' | 'groups'; shape: 'plain' };

const SALES_TARGETS: Readonly<Record<string, SalesTarget>> = {
  REGION: { key: 'location', shape: 'located' },
  CURRENT_COMPANY: { key: 'company', shape: 'located' },
  CURRENT_TITLE: { key: 'job_title', shape: 'titled' },
  PAST_TITLE: { key: 'past_job_title', shape: 'titled' },
  SCHOOL: { key: 'school', shape: 'school' },
  PAST_COMPANY: { key: 'past_company', shape: 'plain' },
  INDUSTRY: { key: 'industry', shape: 'plain' },
  FUNCTION: { key: 'function', shape: 'plain' },
  COMPANY_HEADQUARTERS: { key: 'company_location', shape: 'plain' },
  GROUP: { key: 'groups', shape: 'plain' },
};

/** Libellés des types Sales Navigator que l'on ne reprend pas. */
const SALES_UNREAD_LABELS: Readonly<Record<string, string>> = {
  SENIORITY_LEVEL: FILTER_LABELS_FR.seniority,
  YEARS_OF_EXPERIENCE: FILTER_LABELS_FR.years_of_experience,
  YEARS_AT_CURRENT_COMPANY: FILTER_LABELS_FR.tenure_at_company,
  YEARS_IN_CURRENT_POSITION: FILTER_LABELS_FR.tenure_at_role,
  COMPANY_HEADCOUNT: FILTER_LABELS_FR.company_headcount,
  POSTAL_CODE: 'Code postal',
  RECENTLY_CHANGED_JOBS: FILTER_LABELS_FR.changed_jobs,
  POSTED_ON_LINKEDIN: FILTER_LABELS_FR.posted_on_linkedin,
  FOLLOWS_YOUR_COMPANY: FILTER_LABELS_FR.following_your_company,
  VIEWED_YOUR_PROFILE_RECENTLY: FILTER_LABELS_FR.viewed_your_profile,
  PAST_COLLEAGUE: FILTER_LABELS_FR.past_colleague,
};

const TARGET_LABELS: Readonly<Record<string, string | undefined>> = {
  location: LABEL_LOCATION,
  company: LABEL_COMPANY,
  job_title: FILTER_LABELS_FR.job_title,
  past_job_title: FILTER_LABELS_FR.past_job_title,
  school: LABEL_SCHOOL,
  past_company: LABEL_PAST_COMPANY,
  industry: LABEL_INDUSTRY,
  function: FILTER_LABELS_FR.function,
  company_location: FILTER_LABELS_FR.company_location,
  groups: FILTER_LABELS_FR.groups,
};

function salesNavigatorFilters(resolved: ResolvedSearchUrl, url: URL, warnings: Warnings): Dict {
  const filters: Dict = {};
  const query = url.searchParams.get('query') ?? '';
  const parsed = salesFilters(query);

  const push = (key: string, item: Dict): void => {
    const list = (filters[key] as Dict[] | undefined) ?? [];
    list.push(item);
    filters[key] = list;
  };

  for (const filter of parsed) {
    const type = filter.type.toUpperCase();
    if (type === 'RELATIONSHIP') {
      const included = filter.values.filter((v) => !v.excluded).map((v) => v.id);
      const { degrees, unreadable } = networkDegrees(included);
      if (degrees.length > 0) filters.network_distance = degrees;
      if (unreadable || filter.values.some((v) => v.excluded)) warnings.add(LABEL_NETWORK);
      continue;
    }
    if (type === 'PROFILE_LANGUAGE') {
      const codes = filter.values.filter((v) => !v.excluded && LANGUAGE_RE.test(v.id)).map((v) => v.id.toLowerCase());
      if (codes.length > 0) filters.profile_language = [...new Set(codes)];
      if (codes.length < filter.values.length) warnings.add(LABEL_LANGUAGE);
      continue;
    }
    const target = SALES_TARGETS[type];
    if (!target) {
      warnings.add(SALES_UNREAD_LABELS[type] ?? LABEL_OTHER);
      continue;
    }
    const label = TARGET_LABELS[target.key];
    for (const value of filter.values) {
      if (!ID_RE.test(value.id)) {
        warnings.add(label);
        continue;
      }
      const name = value.text !== '' ? value.text : `n° ${value.id}`;
      switch (target.shape) {
        case 'located':
          // Un lieu exclu n'est pas permis hors Recruiter (la recherche le refuse) : signalé, jamais repris.
          if (value.excluded && target.key === 'location') warnings.add(`${label} (exclusions)`);
          else {
            push(target.key, {
              id: value.id, name, priority: value.excluded ? 'DOESNT_HAVE' : 'CAN_HAVE', scope: 'CURRENT',
            });
          }
          break;
        case 'titled':
          push(target.key, { id: value.id, name, priority: value.excluded ? 'DOESNT_HAVE' : 'CAN_HAVE' });
          break;
        case 'school':
          // Une école exclue est retirée à l'envoi hors Recruiter : signalée, jamais reprise comme un critère actif.
          if (value.excluded) warnings.add(`${label} (exclusions)`);
          else push(target.key, { id: value.id, name, priority: 'MUST_HAVE' });
          break;
        case 'plain':
          // L'état de filtres ne sait pas exclure ces listes : l'exclusion est signalée, pas inversée.
          if (value.excluded) warnings.add(`${label} (exclusions)`);
          else push(target.key, { id: value.id, name });
          break;
      }
    }
  }

  if (url.searchParams.has('savedSearchId') && Object.keys(filters).length === 0 && resolved.keywords === null) {
    warnings.add('Recherche enregistrée');
  }
  return filters;
}

// ---------------------------------------------------------------------------
// Recruiter
// ---------------------------------------------------------------------------

function recruiterWarnings(resolved: ResolvedSearchUrl, url: URL, warnings: Warnings): void {
  const keys = new Set([...url.searchParams.keys()].map((k) => k.toLowerCase()));
  if (keys.has('searchrequestid') || keys.has('searchhistoryid')) warnings.add('Filtres de la recherche Recruiter');
  if (resolved.projectId !== null) warnings.add('Projet Recruiter de l’adresse');
}

// ---------------------------------------------------------------------------
// Entrée
// ---------------------------------------------------------------------------

/**
 * Adresse collée → licence, mots-clés, filtres de l'interface et avertissements. Pure : ni réseau ni écriture.
 * Une adresse invalide ou qui n'est pas une recherche de personnes est refusée avec un texte français neutre.
 */
export function filtersFromSearchUrl(input: unknown): SearchFromUrlOutcome {
  // Une adresse de recherche Sales Navigator dépasse rarement 4 000 caractères.
  const resolved = resolveSearchUrl(typeof input === 'string' && input.length > MAX_URL_LENGTH ? '' : input);
  if (!resolved.ok) {
    return { ok: false, status: 400, errorType: 'INVALID_SEARCH_URL', reason: resolved.reason, error: resolved.message };
  }
  if (!PEOPLE_KINDS.has(resolved.kind)) {
    return { ok: false, status: 400, errorType: 'UNSUPPORTED_SEARCH_URL', reason: resolved.kind, error: UNSUPPORTED_KIND_MESSAGE };
  }
  let url: URL;
  try {
    url = new URL(resolved.url);
  } catch {
    return { ok: false, status: 400, errorType: 'INVALID_SEARCH_URL', reason: 'invalid_url', error: 'Cette adresse n’est pas valide. Collez l’adresse complète d’une recherche LinkedIn.' };
  }

  const warnings = new Warnings();
  let readFilters: Dict;
  switch (resolved.licence) {
    case 'classic':
      readFilters = classicFilters(resolved, url, warnings);
      break;
    case 'sales_navigator':
      readFilters = salesNavigatorFilters(resolved, url, warnings);
      break;
    default:
      readFilters = {};
      recruiterWarnings(resolved, url, warnings);
  }

  const keywords = resolved.keywords === null ? null : safeDecode(resolved.keywords).trim() || null;
  const filters: Dict = { api: resolved.licence, category: 'people', ...(keywords ? { keywords } : {}), ...readFilters };
  return { ok: true, value: { kind: resolved.licence, keywords, filters, warnings: warnings.list } };
}

/**
 * `search_from_url` : lit l'adresse, vérifie que le compte a la licence qu'elle demande (comme `search`,
 * sans bloquer sur une vérification impossible pour une raison passagère), rend les filtres.
 */
export async function handleSearchFromUrl(accountId: string, params: Dict): Promise<Response> {
  const outcome = filtersFromSearchUrl(params.url);
  if (!outcome.ok) {
    return json({ success: false, error: outcome.error, errorType: outcome.errorType, error_code: outcome.reason }, outcome.status);
  }
  const { value } = outcome;
  if (value.kind !== 'classic') {
    let problem: string | null = null;
    try {
      problem = await licenceProblem(accountId, (licences) => searchLicenceProblem(value.kind, licences));
    } catch (error) {
      if (error instanceof UnipileError && ['account_disconnected', 'account_degraded', 'auth', 'config'].includes(error.kind)) {
        return failureResponse(error, 'search_from_url');
      }
      console.warn('[unipile-search] search_from_url: licence du compte non vérifiée');
    }
    if (problem) return json({ success: false, error: problem, errorType: 'LICENCE_UNAVAILABLE' }, 400);
  }
  return json({ success: true, kind: value.kind, keywords: value.keywords, filters: value.filters, warnings: value.warnings });
}

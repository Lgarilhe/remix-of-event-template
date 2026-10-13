/**
 * Adresse de recherche LinkedIn collée → filtres de l'interface.
 *
 * Le serveur (unipile-search, action `search_from_url`) lit l'adresse et rend
 * `{ kind, keywords, filters, warnings }` ; il ne lance aucune recherche. Ce module
 * pur relit cette réponse sans lui faire confiance (formes vérifiées une à une),
 * puis prépare la mise à jour de l'état de filtres. Elle passe par le même chemin
 * que la génération par l'IA : `setFilters((prev) => ({ ...prev, ...update }))`.
 *
 * Un critère que l'adresse de cette licence porte (`RESET_KEYS_BY_KIND`) est d'abord
 * remis à sa valeur d'origine, puis rempli par ce que l'adresse contient : la
 * recherche affichée est celle de l'adresse, sans reste d'un autre brief. Les autres
 * filtres ne bougent pas. Une adresse Recruiter ne porte que les mots-clés (ses
 * filtres restent chez LinkedIn) : elle ne vide jamais les autres critères.
 *
 * Testé par tests/ux/recherche-lien-projet.test.mjs.
 */

import {
  INITIAL_FILTERS,
  type FilterPriority,
  type LinkedInApiType,
  type LinkedInFiltersState,
  type LocationScope,
} from '@/components/outreach/types';
import { safeServerMessage } from '@/lib/connectionCopy';
import { CHOSEN_ON_LINKEDIN, PASTE_URL_COPY, readableWarning, sourceKeptText } from './searchControlsCopy';

type Dict = Record<string, unknown>;

export type SearchUrlKind = 'classic' | 'recruiter' | 'sales_navigator';

const KINDS: readonly SearchUrlKind[] = ['classic', 'recruiter', 'sales_navigator'];
const PRIORITIES: readonly FilterPriority[] = ['CAN_HAVE', 'MUST_HAVE', 'DOESNT_HAVE'];
const LOCATION_SCOPES: readonly LocationScope[] = ['CURRENT', 'OPEN_TO_RELOCATE_ONLY', 'CURRENT_OR_OPEN_TO_RELOCATE'];
const COMPANY_SCOPES = ['CURRENT_OR_PAST', 'CURRENT', 'PAST', 'PAST_NOT_CURRENT'] as const;

/**
 * Critères de l'état de filtres que l'adresse peut remplir. Prénom, nom et intitulé d'une adresse Classic
 * n'y sont pas : aucun champ ne les montre et la recherche ne les envoie pas, le serveur les signale.
 */
export const SEARCH_URL_KEYS = [
  'keywords', 'network_distance', 'location', 'company', 'past_company', 'industry', 'school',
  'job_title', 'past_job_title', 'function', 'company_location', 'groups', 'profile_language',
] as const satisfies ReadonlyArray<keyof LinkedInFiltersState>;

type UrlKey = (typeof SEARCH_URL_KEYS)[number];

/** Critères que la collée remplace, selon la licence de l'adresse (ce que cette adresse peut dire). */
export const RESET_KEYS_BY_KIND: Readonly<Record<SearchUrlKind, readonly UrlKey[]>> = {
  classic: ['keywords', 'network_distance', 'location', 'company', 'past_company', 'industry', 'school', 'profile_language'],
  sales_navigator: SEARCH_URL_KEYS,
  recruiter: ['keywords'],
};

export interface ParsedSearchUrl {
  kind: SearchUrlKind;
  keywords: string | null;
  filters: Dict;
  warnings: string[];
}

export type ParseOutcome =
  | { ok: true; value: ParsedSearchUrl }
  | { ok: false; message: string };

const isDict = (value: unknown): value is Dict => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Texte d'erreur montrable : la phrase du serveur si elle l'est, sinon le texte de repli. */
function errorMessage(data: unknown): string {
  return safeServerMessage(isDict(data) ? data.error : null) ?? PASTE_URL_COPY.genericError;
}

/** Réponse de `search_from_url` → valeur lue, ou texte d'erreur en français. */
export function parseSearchFromUrlResponse(data: unknown): ParseOutcome {
  if (!isDict(data) || data.success !== true) return { ok: false, message: errorMessage(data) };
  const kind = KINDS.find((k) => k === data.kind);
  if (!kind || !isDict(data.filters)) return { ok: false, message: PASTE_URL_COPY.genericError };
  const warnings = Array.isArray(data.warnings)
    ? data.warnings.map((w) => safeServerMessage(w)).filter((w): w is string => w !== null)
    : [];
  return {
    ok: true,
    value: { kind, keywords: text(data.keywords) || null, filters: data.filters, warnings: [...new Set(warnings)] },
  };
}

// ---------------------------------------------------------------------------
// Lecture des valeurs, une forme à la fois
// ---------------------------------------------------------------------------

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((a) => a === value) ?? fallback;
}

/** Éléments `{ id, name }` ; un élément sans identifiant ou sans nom est écarté. */
function items(raw: unknown): Array<{ id: string; name: string; source: Dict }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; name: string; source: Dict }> = [];
  for (const entry of raw) {
    if (!isDict(entry)) continue;
    const id = typeof entry.id === 'number' ? String(entry.id) : text(entry.id);
    const name = text(entry.name);
    if (id && name) out.push({ id, name, source: entry });
  }
  return out;
}

/** Nom que le serveur donne à un élément dont l'adresse ne porte que le numéro : « Lieu n° 105015875 », « n° 12 ». */
const NUMBER_ONLY_NAME = /^(?:\S+ )?n° ?\d+$/;

/** Nom d'un critère sans libellé propre : jamais le numéro. */
export const CHOSEN_FALLBACK = 'Critère choisi sur LinkedIn';

/**
 * Critères qu'une adresse Sales Navigator peut porter par leur seul numéro, en plus de ceux de
 * `CHOSEN_ON_LINKEDIN` (adresse Classic). Clé : critère de l'état de filtres.
 */
export const CHOSEN_ON_LINKEDIN_SALES: Readonly<Record<string, string>> = {
  job_title: 'Intitulé choisi sur LinkedIn',
  past_job_title: 'Ancien intitulé choisi sur LinkedIn',
  function: 'Fonction choisie sur LinkedIn',
  company_location: 'Lieu du siège choisi sur LinkedIn',
  groups: 'Groupe choisi sur LinkedIn',
};

/** Libellé d'un critère dont le nom est un numéro : celui du critère, sinon le libellé neutre. */
export function chosenOnLinkedinLabel(key: string): string {
  const own = (table: Readonly<Record<string, string>>) =>
    Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  return own(CHOSEN_ON_LINKEDIN) ?? own(CHOSEN_ON_LINKEDIN_SALES) ?? CHOSEN_FALLBACK;
}

/**
 * Libellé d'un élément sans nom quand plusieurs du même critère en manquent : le rang suit le mot du critère
 * (« Intitulé 1 · choisi sur LinkedIn »). La pastille coupe le texte par une ellipse ; un rang en fin de libellé
 * disparaissait et les pastilles se lisaient toutes pareil. Le libellé du critère s'écrit « Mot choisi sur
 * LinkedIn » (ou « choisie »), le mot et l'accord sont relus dans le libellé lui-même.
 */
function rankedLabel(label: string, rank: number): string {
  const parts = /^(.+?) (choisie?) sur LinkedIn$/.exec(label);
  return parts ? `${parts[1]} ${rank} · ${parts[2]} sur LinkedIn` : `${label} ${rank}`;
}

/**
 * Remplace ces noms par « Lieu choisi sur LinkedIn » (selon le critère), avec un rang placé devant « choisi » quand
 * il y en a plusieurs. Un nom lu dans l'adresse (Sales Navigator) n'est jamais touché.
 */
function readableNames<T extends { name: string }>(list: T[], key: string): T[] {
  const label = chosenOnLinkedinLabel(key);
  const numbered = list.filter((entry) => NUMBER_ONLY_NAME.test(entry.name)).length;
  let rank = 0;
  return list.map((entry) => {
    if (!NUMBER_ONLY_NAME.test(entry.name)) return entry;
    rank += 1;
    return { ...entry, name: numbered > 1 ? rankedLabel(label, rank) : label };
  });
}

const plainItems = (raw: unknown) => items(raw).map(({ id, name }) => ({ id, name }));

const priorityItems = (raw: unknown, fallback: FilterPriority) =>
  items(raw).map(({ id, name, source }) => ({ id, name, priority: pick(source.priority, PRIORITIES, fallback) }));

const locationItems = (raw: unknown) =>
  items(raw).map(({ id, name, source }) => ({
    id,
    name,
    priority: pick(source.priority, PRIORITIES, 'CAN_HAVE'),
    scope: pick(source.scope, LOCATION_SCOPES, 'CURRENT'),
  }));

const companyItems = (raw: unknown) =>
  items(raw).map(({ id, name, source }) => ({
    id,
    name,
    priority: pick(source.priority, PRIORITIES, 'CAN_HAVE'),
    scope: pick(source.scope, COMPANY_SCOPES, 'CURRENT'),
  }));

function readFilters(raw: Dict): Partial<LinkedInFiltersState> {
  const out: Partial<LinkedInFiltersState> = {};
  const set = <K extends UrlKey>(key: K, value: LinkedInFiltersState[K]) => {
    const empty = Array.isArray(value) ? value.length === 0 : value === '';
    if (!empty) out[key] = value;
  };
  set('location', readableNames(locationItems(raw.location), 'location'));
  set('company', readableNames(companyItems(raw.company), 'company'));
  set('past_company', readableNames(plainItems(raw.past_company), 'past_company'));
  set('industry', readableNames(plainItems(raw.industry), 'industry'));
  set('school', readableNames(priorityItems(raw.school, 'MUST_HAVE'), 'school'));
  set('job_title', readableNames(priorityItems(raw.job_title, 'CAN_HAVE'), 'job_title'));
  set('past_job_title', readableNames(priorityItems(raw.past_job_title, 'CAN_HAVE'), 'past_job_title'));
  set('function', readableNames(plainItems(raw.function), 'function'));
  set('company_location', readableNames(plainItems(raw.company_location), 'company_location'));
  set('groups', readableNames(plainItems(raw.groups), 'groups'));
  set('network_distance', (Array.isArray(raw.network_distance) ? raw.network_distance : [])
    .filter((n): n is number => n === 1 || n === 2 || n === 3));
  set('profile_language', (Array.isArray(raw.profile_language) ? raw.profile_language : [])
    .filter((v): v is string => typeof v === 'string' && /^[a-z0-9_-]{1,32}$/i.test(v)));
  return out;
}

// ---------------------------------------------------------------------------
// Mise à jour de l'état de filtres
// ---------------------------------------------------------------------------

export interface SearchUrlContext {
  /** Source de recherche en cours dans l'écran. */
  currentApi: LinkedInApiType;
  /** Sources que le compte permet de choisir (voir `availableSearchApis`). */
  availableApis: readonly LinkedInApiType[];
}

export interface SearchUrlUpdate {
  /** À fusionner dans l'état de filtres : `setFilters((prev) => ({ ...prev, ...update }))`. */
  update: Partial<LinkedInFiltersState>;
  /** Nombre de critères repris de l'adresse. */
  count: number;
  /** Non repris : libellés du serveur, plus la source gardée le cas échéant. */
  warnings: string[];
}

/**
 * Sources de recherche que le sélecteur de l'écran laisse choisir : même règle que
 * `SearchFiltersPanel` (Classic seulement sans licence premium).
 */
export function availableSearchApis(subscriptions?: { recruiter?: boolean; sales_navigator?: boolean } | null): LinkedInApiType[] {
  const apis: LinkedInApiType[] = [];
  if (!subscriptions?.recruiter && !subscriptions?.sales_navigator) apis.push('classic');
  if (subscriptions?.recruiter) apis.push('recruiter');
  if (subscriptions?.sales_navigator) apis.push('sales_navigator');
  return apis;
}

/**
 * Adresse lue → mise à jour de l'état de filtres. Sans critère lisible (`count` à 0),
 * `update` est vide : on ne remplace rien par du vide.
 */
export function buildSearchUrlUpdate(parsed: ParsedSearchUrl, context: SearchUrlContext): SearchUrlUpdate {
  const read = readFilters(parsed.filters);
  if (parsed.keywords) read.keywords = parsed.keywords;
  const count = Object.keys(read).length;
  const warnings = parsed.warnings.map(readableWarning);
  if (count === 0) return { update: {}, count, warnings };

  const reset: Partial<LinkedInFiltersState> = {};
  for (const key of RESET_KEYS_BY_KIND[parsed.kind]) {
    // Valeur d'origine copiée : la liste de l'état initial n'est jamais partagée.
    const initial = INITIAL_FILTERS[key];
    (reset as Dict)[key] = Array.isArray(initial) ? [...initial] : initial;
  }
  const update: Partial<LinkedInFiltersState> = { ...reset, ...read, category: 'people' };
  if (context.availableApis.includes(parsed.kind)) update.api = parsed.kind;
  else if (parsed.kind !== context.currentApi) warnings.push(sourceKeptText(parsed.kind, context.currentApi));
  return { update, count, warnings };
}

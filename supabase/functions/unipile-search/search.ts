/**
 * Actions `search` et `get_parameters` de unipile-search.
 *
 * La recherche est séparée par licence chez le prestataire (Classic, Recruiter,
 * Sales Navigator) : la requête à plat de Konekt est traduite par `search-request.ts`
 * puis compilée par `toKonektFilters`, les résultats sont remis dans la forme
 * `{ success, results, cursor, total }` que lisent le navigateur, l'agent de
 * sourcing et l'assistant. Les filtres qu'une licence ne peut pas appliquer sont
 * rendus dans `filters_dropped` (champ facultatif, libellés français) ; ceux qui
 * sont appliqués avec une approximation dans `filters_adjusted`.
 */

import {
  accountPath,
  searchParameters,
  toKonektSearchParameters,
  toKonektSearchResults,
  UnipileError,
  unipileJson,
  type SearchParametersRequest,
} from '../_shared/unipile/index.ts';
import { licenceProblem, resolveLicences, searchLicenceProblem, type Licence, type Licences } from './licence.ts';
import { applyProjectTitle } from './recruiter-projects.ts';
import { compileSearchRequest, type CompiledSearchRequest } from './search-request.ts';
import { failureResponse, json, UnipileInputError } from './responses.ts';

export interface SearchFailureRow {
  account_id: string;
  http_status: number;
  error_type: string;
  error_detail: string;
  search_body: unknown;
}

export interface SearchDeps {
  /** Avant chaque appel au prestataire (barrière de l'agent de sourcing continu). Sa présence supprime aussi les reprises. */
  beforeProvider?: () => Promise<void>;
  /** Boîte noire des échecs (`search_failure_log`), au mieux. */
  recordFailure?: (row: SearchFailureRow) => Promise<void>;
}

/** Filtres d'une réponse, un par filtre et par raison. */
function uniqueFilters<T extends { filter: string }>(list: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function errorDetail(error: UnipileError): string {
  const body = error.debug.body;
  const text = typeof body === 'string' ? body : body === null || body === undefined ? '' : JSON.stringify(body);
  return text.slice(0, 1000);
}

/** Requête compilée et contrôlée, prête à partir chez le prestataire. */
export type PreparedSearch = CompiledSearchRequest;

/**
 * Contrôles d'une recherche, sans rien consommer : requête (lève `UnipileInputError` pour une entrée refusée),
 * filtres que la licence ne sait pas appliquer et licence du compte. Appelé AVANT le plafond LinkedIn pour
 * qu'une recherche refusée ne compte pas dans le journal d'usage. Retourne la réponse d'un refus, ou la
 * recherche préparée.
 */
export async function prepareSearch(
  accountId: string,
  params: Record<string, unknown>,
  deps: SearchDeps = {},
): Promise<{ response: Response } | { prepared: PreparedSearch }> {
  const prepared = compileSearchRequest(params);
  const { api, dropped } = prepared;

  // L'agent de sourcing continu lance ce que l'équipe a relu : un critère que la licence ne sait pas appliquer
  // élargirait la recherche sans que personne le voie. Il s'arrête avant toute consultation (aucune unité de
  // plafond perdue) et le dit en français.
  if (deps.beforeProvider && dropped.length > 0) {
    const labels = [...new Set(dropped.map((d) => d.label))].join(', ');
    throw new UnipileInputError(
      `LinkedIn ne peut pas appliquer ces filtres avec cette licence : ${labels}. Retirez-les des filtres de la recherche pour que l’agent ne cherche pas plus large que prévu.`,
      422,
      'FILTERS_UNSUPPORTED',
    );
  }

  // Licence du compte : une recherche Recruiter ou Sales Navigator suppose le contrat correspondant. Une
  // vérification impossible pour une raison passagère n'empêche pas la recherche (le prestataire tranchera) ;
  // l'agent de sourcing continu a déjà choisi sa licence et n'ouvre pas de consultation de plus.
  if (!deps.beforeProvider && api !== 'classic') {
    let problem: string | null = null;
    try {
      problem = await licenceProblem(accountId, (licences) => searchLicenceProblem(api, licences));
    } catch (error) {
      if (error instanceof UnipileError && ['account_disconnected', 'account_degraded', 'auth', 'config'].includes(error.kind)) {
        return { response: failureResponse(error, 'search') };
      }
      console.warn('[unipile-search] search: licence du compte non vérifiée');
    }
    if (problem) return { response: json({ success: false, error: problem, errorType: 'LICENCE_UNAVAILABLE' }, 400) };
  }
  return { prepared };
}

/** Envoie la recherche préparée et met les résultats dans la forme lue par Konekt. */
export async function runSearch(accountId: string, prepared: PreparedSearch, deps: SearchDeps = {}): Promise<Response> {
  const { api, compiled, dropped } = prepared;
  // Sous la barrière de l'agent continu, aucune lecture de plus : le nom du projet n'est pas cherché.
  if (api === 'recruiter' && !deps.beforeProvider) await applyProjectTitle(accountId, compiled.body);
  console.log('Search body:', JSON.stringify(compiled.body), 'query:', JSON.stringify(compiled.query));
  try {
    if (deps.beforeProvider) await deps.beforeProvider();
    const body = await unipileJson({
      method: 'POST',
      path: accountPath(accountId, ...compiled.segments),
      body: compiled.body,
      query: compiled.query,
      // Une recherche ne fait que lire : reprise sûre, sauf sous barrière (aucune consultation de plus).
      idempotent: true,
      heavy: true,
      ...(deps.beforeProvider ? { retry: false as const } : {}),
    });
    const page = toKonektSearchResults(body, {
      product: api,
      offset: typeof compiled.query.offset === 'number' ? compiled.query.offset : undefined,
      limit: typeof compiled.query.limit === 'number' ? compiled.query.limit : undefined,
      onDiagnostic: (d) => console.warn(`[unipile-search] search: ${d.count} élément(s) hors personnes écartés (${d.objects.join(', ')})`),
    });
    const filtersDropped = uniqueFilters(dropped, (d) => `${d.filter}:${d.reason}`).map(({ filter, label, reason }) => ({ filter, label, reason }));
    const filtersAdjusted = uniqueFilters(compiled.adjusted, (a) => a.filter).map(({ filter, label }) => ({ filter, label }));
    return json({
      success: true,
      results: page.results,
      cursor: page.cursor,
      total: page.total,
      ...(filtersDropped.length > 0 ? { filters_dropped: filtersDropped } : {}),
      ...(filtersAdjusted.length > 0 ? { filters_adjusted: filtersAdjusted } : {}),
    });
  } catch (error) {
    if (!(error instanceof UnipileError)) throw error;
    // Boîte noire : payload exact et erreur brute du prestataire, lisibles en SQL (14 jours). Jamais renvoyés au navigateur.
    if (deps.recordFailure) {
      try {
        await deps.recordFailure({
          account_id: accountId,
          http_status: error.status ?? 0,
          error_type: error.code ?? error.kind,
          error_detail: errorDetail(error),
          search_body: compiled.body,
        });
      } catch { /* diagnostic non bloquant */ }
    }
    return failureResponse(error, 'search', {
      validationMessage: 'LinkedIn n’a pas pu traiter cette recherche. Retirez un critère ou raccourcissez les mots-clés, puis relancez.',
    });
  }
}

export async function handleSearch(
  accountId: string,
  params: Record<string, unknown>,
  deps: SearchDeps = {},
): Promise<Response> {
  const step = await prepareSearch(accountId, params, deps);
  return 'response' in step ? step.response : await runSearch(accountId, step.prepared, deps);
}

// ---------------------------------------------------------------------------
// Paramètres des filtres (autocomplétion)
// ---------------------------------------------------------------------------

/** Types de paramètres que chaque licence connaît (source `SEARCH` pour Recruiter). */
const PARAMETER_TYPES: Record<Licence, ReadonlySet<string>> = {
  classic: new Set(['LOCATION', 'COMPANY', 'RELATION', 'PEOPLE', 'SCHOOL', 'INDUSTRY', 'SERVICE', 'JOB_FUNCTION', 'JOB_TITLE', 'EMPLOYMENT_TYPE', 'SKILL']),
  sales_navigator: new Set([
    'COMPANY', 'ACCOUNT_LIST', 'LEAD_LIST', 'LOCATION', 'POSTAL_CODE', 'JOB_FUNCTION', 'JOB_TITLE', 'INDUSTRY', 'GROUP', 'SCHOOL',
    'RELATION', 'PERSONA', 'SAVED_PEOPLE_SEARCH', 'SAVED_COMPANY_SEARCH', 'RECENT_SEARCH', 'PROFILE_LANGUAGE',
  ]),
  recruiter: new Set([
    'OCCUPATION', 'JOB_TITLE', 'JOB_FUNCTION', 'LOCATION', 'ZIPCODE', 'SKILL', 'COMPANY', 'SCHOOL', 'INDUSTRY', 'GROUP', 'PROJECT',
    'CUSTOM_FILTER', 'PROFILE_LANGUAGE', 'SPOKEN_LANGUAGE', 'SEAT', 'SAVED_SEARCH', 'DEGREE',
  ]),
};

/** Noms de types que l'interface envoie, vers ceux de l'API. */
const PARAMETER_TYPE_ALIASES: Record<string, string> = {
  CONNECTIONS: 'RELATION',
  DEPARTMENT: 'JOB_FUNCTION',
  REGION: 'LOCATION',
  GROUPS: 'GROUP',
};

/**
 * Licence dont on interroge les paramètres. Le `service` de l'interface n'est qu'une indication (plusieurs
 * écrans demandent RECRUITER quelle que soit la source) : l'endpoint d'une licence que le compte n'a pas, ou
 * dont le contrat n'est pas le contrat actif, refuserait l'appel. On suit alors le contrat actif du compte.
 * Classic, toujours disponible, est respecté tel quel.
 */
export function parameterLicenceFor(requested: Licence, licences: Licences): Licence {
  if (requested === 'classic') return 'classic';
  if (!licences[requested]) return licences.active;
  if (licences.selectedKnown && licences.active !== requested) return licences.active;
  return requested;
}

export function parameterLicenceOf(service: unknown): Licence {
  const value = String(service ?? 'RECRUITER').toUpperCase();
  return value === 'CLASSIC' ? 'classic' : value === 'SALES_NAVIGATOR' ? 'sales_navigator' : 'recruiter';
}

/** Requête de paramètres, ou `null` quand la licence n'a pas ce type (liste vide pour l'interface). */
export function parameterRequest(licence: Licence, type: string, keywords: string | null): SearchParametersRequest | null {
  const apiType = PARAMETER_TYPE_ALIASES[type] ?? type;
  if (!PARAMETER_TYPES[licence].has(apiType)) return null;
  if (licence === 'classic') {
    // Classic exige des mots-clés : sans eux il n'y a rien à proposer.
    return keywords ? { licence, type: apiType as never, keywords } : null;
  }
  if (licence === 'sales_navigator') return { licence, type: apiType as never, ...(keywords ? { keywords } : {}) };
  return { licence, source: 'SEARCH', type: apiType as never, ...(keywords ? { keywords } : {}) };
}

export async function handleGetParameters(accountId: string, params: Record<string, unknown>): Promise<Response> {
  const { type, keywords, service, limit } = params;
  if (!type) return json({ success: false, error: 'Type de paramètre requis' }, 400);

  const requested = parameterLicenceOf(service);
  let licence = requested;
  if (requested !== 'classic') {
    try {
      licence = parameterLicenceFor(requested, await resolveLicences(accountId));
    } catch {
      // Contrat illisible : la licence demandée est essayée, l'appel dira l'état du compte.
      console.warn('[unipile-search] get_parameters: licence du compte non vérifiée');
    }
  }
  const request = parameterRequest(licence, String(type).toUpperCase(), typeof keywords === 'string' && keywords.trim() ? keywords.trim() : null);
  if (!request) {
    console.warn(`[unipile-search] get_parameters: type ${String(type)} sans équivalent pour la licence ${licence}`);
    return json({ success: true, items: [] });
  }
  const pageSize = Math.min(Math.max(Math.floor(Number(limit)) || 100, 1), 100);
  try {
    const page = await searchParameters(accountId, request, { limit: pageSize });
    return json({ success: true, items: toKonektSearchParameters(page) });
  } catch (error) {
    return failureResponse(error, 'get_parameters', {}, { items: [] });
  }
}

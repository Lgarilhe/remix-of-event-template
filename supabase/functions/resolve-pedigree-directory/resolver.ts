/**
 * Résolution d'un nom d'école ou d'entreprise en identifiant LinkedIn, par la
 * recherche de paramètres du service. Choix du compte de résolution.
 *
 * Espace d'identifiants : celui de la recherche Recruiter (source SEARCH), comme
 * l'ancien appel `service=RECRUITER`. Les colonnes du répertoire alimentent des
 * recherches Recruiter, et rien ne prouve que la liste classique rende les mêmes
 * identifiants : aucun repli sur la liste classique, qui mélangerait deux espaces
 * dans le répertoire. Un compte sans produit Recruiter arrête donc la série
 * (voir `probeResolverAccount`), il ne marque aucune ligne « failed ».
 */

import {
  describeForLog,
  errorKindOf,
  isUnipileError,
  isV2AccountId,
  type ErrorKind,
  searchParameters,
  toKonektSearchParameters,
  userSafeMessage,
  type KonektSearchParameter,
} from '../_shared/unipile/index.ts';

export type ParameterType = 'SCHOOL' | 'COMPANY';

/** Résultats demandés par recherche (le service accepte de 1 à 100). */
export const PARAMETERS_LIMIT = 20;

/** Mot cherché par le contrôle du compte (`probeResolverAccount`). */
export const PROBE_KEYWORDS = 'LinkedIn';

export interface DirectoryRow {
  id: string;
  canonical_name: string;
  aliases: string[] | null;
  linkedin_school_id?: string | null;
  linkedin_company_id?: string | null;
  resolution_status: string;
}

/**
 * Heuristique de matching : compare le canonical_name + aliases au nom renvoyé
 * par le service (case-insensitive, trim, ascii fold). Retourne le 1er match
 * exact, sinon le 1er match qui contient le canonical en sous-string.
 */
export function pickBestMatch(
  items: KonektSearchParameter[],
  canonical: string,
  aliases: string[],
): KonektSearchParameter | null {
  if (!items.length) return null;
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const canonicalNorm = norm(canonical);
  const aliasesNorm = aliases.map(norm);

  // 1. Match exact (sur canonical ou alias)
  for (const item of items) {
    const titleNorm = norm(item.title);
    if (titleNorm === canonicalNorm) return item;
    if (aliasesNorm.includes(titleNorm)) return item;
  }
  // 2. Match contient canonical
  for (const item of items) {
    const titleNorm = norm(item.title);
    if (titleNorm.includes(canonicalNorm) || canonicalNorm.includes(titleNorm)) return item;
  }
  // 3. Match contient un alias
  for (const item of items) {
    const titleNorm = norm(item.title);
    if (aliasesNorm.some((a) => a && (titleNorm.includes(a) || a.includes(titleNorm)))) return item;
  }
  return null;
}

export interface ResolveResult {
  id: string | null;
  matchedTitle: string | null;
  error: string | null;
  /**
   * L'échec tient au compte ou à l'accès (compte à reconnecter, limité,
   * verrouillé ou inconnu, accès refusé, limite de requêtes ou de quota) et non
   * à ce nom : toute la série échouerait de même.
   */
  systemic?: boolean;
  /** Nature de l'échec systémique, pour le message rendu à l'opérateur. */
  kind?: ErrorKind;
}

/**
 * Échecs qui valent pour toute la série : on l'arrête sans marquer les lignes « failed ».
 * `not_found` en fait partie : une recherche de paramètres rend une liste (vide
 * au besoin) et ne répond jamais 404 pour un nom, seul un compte inconnu le fait.
 */
const SYSTEMIC_KINDS: readonly ErrorKind[] = [
  'auth',
  'forbidden',
  'not_found',
  'account_disconnected',
  'account_degraded',
  'config',
  'rate_limited',
  'provider_limit',
];

export async function resolveOne(
  accountId: string,
  type: ParameterType,
  canonical: string,
  aliases: string[],
): Promise<ResolveResult> {
  // `keywords` est obligatoire pour la recherche de paramètres.
  if (typeof canonical !== 'string' || canonical.trim() === '') {
    return { id: null, matchedTitle: null, error: 'Empty name' };
  }
  try {
    const page = await searchParameters(accountId, { licence: 'recruiter', source: 'SEARCH', type, keywords: canonical }, { limit: PARAMETERS_LIMIT });
    const items = toKonektSearchParameters(page.items);
    const match = pickBestMatch(items, canonical, aliases);
    if (!match) return { id: null, matchedTitle: null, error: `No match in ${items.length} items` };
    return { id: match.id, matchedTitle: match.title, error: null };
  } catch (err) {
    const systemic = isUnipileError(err) && SYSTEMIC_KINDS.includes(errorKindOf(err));
    return {
      id: null,
      matchedTitle: null,
      error: describeForLog(err),
      ...(systemic ? { systemic: true, kind: errorKindOf(err) } : { systemic: false }),
    };
  }
}

export type ProbeResult = { ok: true } | { ok: false; kind: ErrorKind; error: string };

/**
 * Contrôle unique avant la série : une recherche Recruiter réelle (une entreprise,
 * un résultat). Toute erreur du service arrête la série avant d'écrire une ligne :
 * compte inconnu ou supprimé (404), compte sans produit Recruiter (refus ou
 * demande invalide, selon la réponse du service, que sa spécification ne
 * documente pas), accès refusé, compte à reconnecter. Sans ce contrôle, un
 * compte mal configuré marquerait « failed » jusqu'à 900 lignes.
 */
export async function probeResolverAccount(accountId: string): Promise<ProbeResult> {
  try {
    await searchParameters(accountId, { licence: 'recruiter', source: 'SEARCH', type: 'COMPANY', keywords: PROBE_KEYWORDS }, { limit: 1 });
    return { ok: true };
  } catch (err) {
    return { ok: false, kind: errorKindOf(err), error: describeForLog(err) };
  }
}

export const RESOLVER_ACCOUNT_UNKNOWN_MESSAGE =
  "Le compte de résolution configuré est introuvable ou n'a pas d'accès Recruiter : vérifiez internal_config.pedigree_resolver_account_id.";

/** Phrase rendue à l'opérateur pour un arrêt de série, sans nom de prestataire. */
export function resolverAbortMessage(kind: ErrorKind): string {
  return kind === 'not_found' ? RESOLVER_ACCOUNT_UNKNOWN_MESSAGE : userSafeMessage(kind);
}

export interface BatchStats {
  processed: number;
  resolved: number;
  failed: number;
}

export interface BatchAbort {
  kind: ErrorKind;
  error: string;
}

/**
 * Traite une série de lignes : une résolution par ligne, `save` pour chaque
 * ligne résolue ou en échec de nom. Un échec systémique arrête la série sans
 * appeler `save` pour cette ligne ni pour les suivantes (les lignes restent
 * telles quelles, jamais marquées « failed ») et le rend à l'appelant.
 */
export async function resolveBatch<T>(
  rows: readonly T[],
  stats: BatchStats,
  options: {
    resolve: (row: T) => Promise<ResolveResult>;
    save: (row: T, result: ResolveResult) => Promise<void>;
    /** Pause entre deux lignes, pour ménager la limite de requêtes du service. */
    throttleMs?: number;
  },
): Promise<BatchAbort | null> {
  const throttleMs = options.throttleMs ?? 300;
  for (const row of rows) {
    stats.processed++;
    const result = await options.resolve(row);
    if (result.systemic) {
      stats.processed--;
      return { kind: result.kind ?? 'server', error: result.error ?? '' };
    }
    if (result.id) stats.resolved++;
    else stats.failed++;
    await options.save(row, result);
    if (throttleMs > 0) await new Promise((r) => setTimeout(r, throttleMs));
  }
  return null;
}

export const RESOLVER_ACCOUNT_OUTDATED_MESSAGE =
  "Le compte de résolution configuré (internal_config.pedigree_resolver_account_id) n'est pas à jour : reconnectez-le, puis enregistrez son nouvel identifiant.";
export const RESOLVER_ACCOUNT_MISSING_MESSAGE =
  "Aucun compte LinkedIn à jour n'est disponible : renseignez internal_config.pedigree_resolver_account_id et pedigree_resolver_org_id, ou reliez au moins un compte LinkedIn.";

export interface ResolverContext {
  accountId: string;
  orgId: string | null;
}

export type ResolverPick = { ok: true; context: ResolverContext } | { ok: false; message: string };

interface ConfigRow {
  key: string;
  value: unknown;
}
interface LinkedAccountRow {
  linkedin_account_id: unknown;
  organization_id: string | null;
}

/**
 * Choisit le compte de résolution.
 *  1. internal_config.pedigree_resolver_account_id, s'il est renseigné : il doit
 *     être au format courant (acc_...), sinon refus net, sans repli sur le
 *     compte d'un autre client.
 *  2. Sinon le plus ancien compte LinkedIn relié au format courant.
 */
export function pickResolverAccount(configRows: readonly ConfigRow[], linkedAccounts: readonly LinkedAccountRow[]): ResolverPick {
  const cfg = new Map(configRows.map((r) => [r.key, r.value]));
  const cfgAccountId = cfg.get('pedigree_resolver_account_id');
  const cfgOrgId = cfg.get('pedigree_resolver_org_id');
  const orgId = typeof cfgOrgId === 'string' && cfgOrgId !== '' ? cfgOrgId : null;

  if (cfgAccountId !== undefined && cfgAccountId !== null && cfgAccountId !== '') {
    if (!isV2AccountId(cfgAccountId)) return { ok: false, message: RESOLVER_ACCOUNT_OUTDATED_MESSAGE };
    return { ok: true, context: { accountId: cfgAccountId, orgId } };
  }

  for (const acc of linkedAccounts) {
    if (isV2AccountId(acc.linkedin_account_id)) {
      return { ok: true, context: { accountId: acc.linkedin_account_id, orgId: acc.organization_id } };
    }
  }
  return { ok: false, message: RESOLVER_ACCOUNT_MISSING_MESSAGE };
}

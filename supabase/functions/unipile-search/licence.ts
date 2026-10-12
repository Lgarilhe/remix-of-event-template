/**
 * Licences LinkedIn d'un compte et boîtes de messagerie qu'il expose.
 *
 * La recherche et l'InMail sont séparés par licence : le compte n'en annonce pas
 * lui-même, elles se déduisent de ses contrats (Recruiter et Sales Navigator sont
 * exclusifs, un seul est sélectionné ; Classic est toujours là). Les boîtes
 * (`GET inboxes`) ne disent pas quelle licence elles servent : `inboxKindOf` ne
 * conclut que sur un mot explicite de l'identifiant ou de la description, sinon
 * la boîte reste sans type et l'appelant ne devine pas.
 *
 * Deux petits caches par isolat (2 minutes pour les licences, 10 minutes pour les
 * boîtes) évitent un appel de plus à chaque page de recherche ou chaque envoi.
 */

import { listContracts, listInboxes, UnipileError, type Inbox } from '../_shared/unipile/index.ts';

export type Licence = 'classic' | 'recruiter' | 'sales_navigator';

export interface Licences {
  recruiter: boolean;
  sales_navigator: boolean;
  /** Licence du contrat sélectionné ; Classic sans contrat. */
  active: Licence;
  /** Vrai quand le prestataire a désigné un contrat sélectionné (sinon `active` n'est qu'un choix par défaut). */
  selectedKnown: boolean;
}

const LICENCE_TTL_MS = 2 * 60_000;
const INBOX_TTL_MS = 10 * 60_000;
const CACHE_MAX = 500;

const licenceCache = new Map<string, { at: number; value: Licences }>();
const inboxCache = new Map<string, { at: number; value: Inbox[] }>();

/** Vide les caches (tests, changement de contrat). */
export function clearLicenceCache(): void {
  licenceCache.clear();
  inboxCache.clear();
}

/** Licences à partir de la liste des contrats (`product`, `selected`). */
export function licencesFromContracts(contracts: ReadonlyArray<{ product?: unknown; selected?: unknown }>): Licences {
  const products = contracts.map((c) => c.product);
  const recruiter = products.includes('recruiter');
  const salesNavigator = products.includes('sales_navigator');
  const selected = contracts.find((c) => c.selected === true)?.product;
  const selectedKnown = selected === 'recruiter' || selected === 'sales_navigator';
  const active: Licence = selectedKnown
    ? selected
    : recruiter ? 'recruiter' : salesNavigator ? 'sales_navigator' : 'classic';
  return { recruiter, sales_navigator: salesNavigator, active, selectedKnown };
}

/**
 * Licences d'un compte. Un compte sans contrat (ou dont la liste est refusée comme
 * introuvable, interdite ou invalide) est Classic ; toute autre erreur remonte.
 */
export async function resolveLicences(accountId: string, now: () => number = Date.now, refresh = false): Promise<Licences> {
  const hit = licenceCache.get(accountId);
  if (!refresh && hit && now() - hit.at < LICENCE_TTL_MS) return hit.value;
  let value: Licences;
  try {
    value = licencesFromContracts(await listContracts(accountId));
  } catch (error) {
    if (!(error instanceof UnipileError) || !['not_found', 'validation', 'forbidden'].includes(error.kind)) throw error;
    value = { recruiter: false, sales_navigator: false, active: 'classic', selectedKnown: false };
  }
  if (licenceCache.size >= CACHE_MAX) licenceCache.clear();
  licenceCache.set(accountId, { at: now(), value });
  return value;
}

/**
 * Refus de licence (`problemOf` rend un texte français ou `null`) jugé sur les licences du compte. Un refus fondé
 * sur une lecture gardée en cache est revérifié une fois auprès du prestataire : après un changement de contrat
 * (action `select_contract` d'une autre fonction, cache d'un autre isolat), la licence lue il y a moins de
 * 2 minutes peut être périmée. Une revérification impossible garde le premier refus.
 */
export async function licenceProblem(
  accountId: string,
  problemOf: (licences: Licences) => string | null,
  now: () => number = Date.now,
): Promise<string | null> {
  const hit = licenceCache.get(accountId);
  const served = hit !== undefined && now() - hit.at < LICENCE_TTL_MS;
  const problem = problemOf(await resolveLicences(accountId, now));
  if (problem === null || !served) return problem;
  try {
    return problemOf(await resolveLicences(accountId, now, true));
  } catch {
    return problem;
  }
}

/**
 * Texte français quand la recherche demandée n'est pas possible avec ce compte,
 * `null` sinon. Classic est toujours possible.
 */
export function searchLicenceProblem(api: Licence, licences: Licences): string | null {
  if (api === 'classic') return null;
  const name = api === 'recruiter' ? 'Recruiter' : 'Sales Navigator';
  if (!licences[api]) return `Ce compte LinkedIn n’a pas de licence ${name}. Choisissez une autre source de recherche.`;
  if (licences.selectedKnown && licences.active !== api) {
    const other = api === 'recruiter' ? 'Sales Navigator' : 'Recruiter';
    return `Le contrat LinkedIn actif sur ce compte est ${other}, pas ${name}. Choisissez une autre source de recherche ou activez le contrat ${name}.`;
  }
  return null;
}

/** Licence de la boîte, d'après un mot explicite ; `undefined` si rien ne permet de conclure. */
export function inboxKindOf(inbox: { id?: unknown; description?: unknown }): Licence | undefined {
  const label = `${typeof inbox.id === 'string' ? inbox.id : ''} ${typeof inbox.description === 'string' ? inbox.description : ''}`.toLowerCase();
  if (/recruiter|talent/.test(label)) return 'recruiter';
  if (/sales|navigator/.test(label)) return 'sales_navigator';
  if (/classic/.test(label)) return 'classic';
  return undefined;
}

/**
 * Boîtes actives du compte. Un compte qui n'a pas la notion de boîte (liste refusée
 * comme introuvable ou invalide) n'en a aucune ; toute autre erreur remonte.
 */
export async function accountInboxes(accountId: string, now: () => number = Date.now): Promise<Inbox[]> {
  const hit = inboxCache.get(accountId);
  if (hit && now() - hit.at < INBOX_TTL_MS) return hit.value;
  let value: Inbox[];
  try {
    value = (await listInboxes(accountId)).filter((inbox) => inbox && typeof inbox.id === 'string' && inbox.disabled !== true);
  } catch (error) {
    if (!(error instanceof UnipileError) || !['not_found', 'validation'].includes(error.kind)) throw error;
    value = [];
  }
  if (inboxCache.size >= CACHE_MAX) inboxCache.clear();
  inboxCache.set(accountId, { at: now(), value });
  return value;
}

/**
 * Boîte par laquelle démarrer une conversation de licence `kind` : l'unique boîte
 * active, sinon celle dont le type est connu et égal à `kind`, sinon aucune (le
 * client n'en devine pas).
 */
export function pickInbox(inboxes: readonly Inbox[], kind: Licence): Inbox | undefined {
  if (inboxes.length === 1) return inboxes[0];
  return inboxes.find((inbox) => inboxKindOf(inbox) === kind);
}

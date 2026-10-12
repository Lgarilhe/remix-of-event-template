/**
 * Appels et lectures des sections « Invitations en attente » et « Contrat LinkedIn »
 * de la carte « Mon compte LinkedIn » (LinkedInExtras), sans React.
 *
 * - invitations : actions `list_sent_invitations` et `withdraw_invitation` de la
 *   fonction de recherche ;
 * - contrats : actions `list_contracts` et `select_contract` de la fonction des comptes.
 *
 * Règles
 * - Un échec devient `{ ok: false, userMessage }` : le message du serveur n'est repris
 *   que s'il est montrable (safeServerMessage : court, sans nom de prestataire),
 *   sinon le texte de repli de linkedInExtrasCopy.
 * - Une réponse de forme inconnue est un échec, jamais une liste vide : une erreur
 *   ne s'affiche pas comme un état vide.
 * - Les appels sont injectés : le module se teste sans réseau
 *   (tests/ux/linkedin-extras.test.mjs).
 */

import { safeServerMessage } from '@/lib/connectionCopy';
import { CONTRACTS_COPY, INVITATIONS_COPY } from './linkedInExtrasCopy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Appel de la fonction de recherche (invokeUnipile en production). */
export type SearchInvoke = (body: Record<string, unknown>) => Promise<{ data: Record<string, any> | null; httpStatus?: number }>;
/** Appel de la fonction des comptes (invokeEdgeFunction en production). */
export type AccountsInvoke = (body: Record<string, unknown>) => Promise<{ data: Record<string, any> | null; error: Error | null }>;

export interface SentInvitation {
  id: string;
  name: string | null;
  headline: string | null;
  pictureUrl: string | null;
  /** Jours entiers depuis l'envoi, `null` sans date. */
  ageDays: number | null;
}

export interface InvitationsPage {
  invitations: SentInvitation[];
  /** Curseur de la page suivante, `null` en fin de liste. */
  cursor: string | null;
  /** Total annoncé par le serveur, `null` s'il ne le donne pas. */
  total: number | null;
}

export interface LinkedInContract {
  id: string;
  name: string | null;
  /** `recruiter`, `sales_navigator` ou une autre valeur du serveur. */
  product: string;
  selected: boolean;
  description: string | null;
}

/** `userMessage` : phrase déjà montrable (repli de Konekt ou message du serveur filtré par safeServerMessage). */
export type ExtrasFailure = { ok: false; userMessage: string; notFound?: boolean };
export type ExtrasResult<T> = ({ ok: true } & T) | ExtrasFailure;

// ---------------------------------------------------------------------------
// Lecture des réponses
// ---------------------------------------------------------------------------

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Message d'un échec : celui du serveur s'il est montrable, sinon le repli. */
export function failureMessageOf(data: unknown, fallback: string): string {
  return safeServerMessage(record(data).error) ?? fallback;
}

/** Adresse de photo à montrer : https seulement. */
function pictureOf(value: unknown): string | null {
  const url = text(value);
  return url && /^https:\/\//i.test(url) ? url : null;
}

/** Une invitation de la liste ; `null` sans identifiant. */
export function parseInvitation(raw: unknown): SentInvitation | null {
  const r = record(raw);
  const id = typeof r.id === 'number' ? String(r.id) : text(r.id);
  if (!id) return null;
  const age = typeof r.age_days === 'number' && Number.isFinite(r.age_days) && r.age_days >= 0 ? Math.floor(r.age_days) : null;
  return { id, name: text(r.name), headline: text(r.headline), pictureUrl: pictureOf(r.picture_url), ageDays: age };
}

/** Page d'invitations depuis la réponse ; `null` si la forme est inconnue. */
export function parseInvitationsPage(data: unknown): InvitationsPage | null {
  const d = record(data);
  if (d.success !== true || !Array.isArray(d.invitations)) return null;
  const seen = new Set<string>();
  const invitations: SentInvitation[] = [];
  for (const raw of d.invitations) {
    const item = parseInvitation(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    invitations.push(item);
  }
  return {
    invitations,
    cursor: text(d.cursor),
    total: typeof d.total === 'number' && Number.isFinite(d.total) && d.total >= 0 ? Math.floor(d.total) : null,
  };
}

/** Un contrat de la liste ; `null` sans identifiant. */
export function parseContract(raw: unknown): LinkedInContract | null {
  const r = record(raw);
  const id = text(r.id);
  if (!id) return null;
  return {
    id,
    name: safeServerMessage(r.name),
    product: text(r.product) ?? 'unknown',
    selected: r.selected === true,
    description: safeServerMessage(r.description),
  };
}

/** Contrats depuis la réponse ; `null` si la forme est inconnue. */
export function parseContracts(data: unknown): LinkedInContract[] | null {
  const d = record(data);
  if (d.success !== true || !Array.isArray(d.contracts)) return null;
  const seen = new Set<string>();
  const contracts: LinkedInContract[] = [];
  for (const raw of d.contracts) {
    const item = parseContract(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    contracts.push(item);
  }
  return contracts;
}

/** La section « Contrat LinkedIn » n'existe que si le compte expose plus d'un contrat. */
export function hasContractChoice(contracts: readonly LinkedInContract[] | null | undefined): boolean {
  return Array.isArray(contracts) && contracts.length > 1;
}

/**
 * Faut-il lire les contrats ? Un compte dont l'offre est connue et n'est ni Recruiter ni
 * Sales Navigator n'en a pas ; une offre inconnue (liste non reçue) se lit quand même.
 */
export function shouldReadContracts(
  subscriptions: { recruiter?: boolean; sales_navigator?: boolean } | null | undefined,
): boolean {
  if (!subscriptions) return true;
  return subscriptions.recruiter === true || subscriptions.sales_navigator === true;
}

/** Les contrats après le choix de `contractId` : lui seul est sélectionné. */
export function withSelectedContract(contracts: readonly LinkedInContract[], contractId: string): LinkedInContract[] {
  return contracts.map((c) => ({ ...c, selected: c.id === contractId }));
}

/** La page d'invitations sans l'invitation `id`, total diminué d'une unité. */
export function withoutInvitation(page: InvitationsPage, id: string): InvitationsPage {
  const invitations = page.invitations.filter((i) => i.id !== id);
  const removed = page.invitations.length - invitations.length;
  return {
    ...page,
    invitations,
    total: page.total !== null ? Math.max(0, page.total - removed) : null,
  };
}

// ---------------------------------------------------------------------------
// Appels
// ---------------------------------------------------------------------------

/** Une page des invitations envoyées et en attente. */
export async function listSentInvitations(
  invoke: SearchInvoke,
  accountId: string,
  cursor?: string | null,
): Promise<ExtrasResult<{ page: InvitationsPage }>> {
  const { data } = await invoke({
    action: 'list_sent_invitations',
    account_id: accountId,
    ...(cursor ? { cursor } : {}),
  });
  const page = parseInvitationsPage(data);
  if (!page) return { ok: false, userMessage: failureMessageOf(data, INVITATIONS_COPY.errorBody) };
  return { ok: true, page };
}

/** Retire une invitation envoyée. `notFound` : elle n'existe plus ou a déjà été traitée. */
export async function withdrawInvitation(
  invoke: SearchInvoke,
  accountId: string,
  requestId: string,
): Promise<ExtrasResult<{ enrollmentsSynced: boolean }>> {
  const { data, httpStatus } = await invoke({ action: 'withdraw_invitation', account_id: accountId, request_id: requestId });
  const d = record(data);
  if (d.success === true) return { ok: true, enrollmentsSynced: d.enrollments_synced !== false };
  if (d.errorType === 'INVITATION_NOT_FOUND' || httpStatus === 404) {
    return { ok: false, notFound: true, userMessage: INVITATIONS_COPY.alreadyGone };
  }
  return { ok: false, userMessage: failureMessageOf(d, INVITATIONS_COPY.withdrawFailed) };
}

/** Les contrats du compte. */
export async function listContracts(
  invoke: AccountsInvoke,
  accountId: string,
): Promise<ExtrasResult<{ contracts: LinkedInContract[] }>> {
  const { data, error } = await invoke({ action: 'list_contracts', account_id: accountId });
  const contracts = error ? null : parseContracts(data);
  if (!contracts) return { ok: false, userMessage: failureMessageOf(data, CONTRACTS_COPY.errorBody) };
  return { ok: true, contracts };
}

/** Choisit le contrat utilisé pour les recherches. */
export async function selectContract(
  invoke: AccountsInvoke,
  accountId: string,
  contractId: string,
): Promise<ExtrasResult<unknown>> {
  const { data, error } = await invoke({ action: 'select_contract', account_id: accountId, contract_id: contractId });
  if (error || record(data).success !== true) {
    return { ok: false, userMessage: failureMessageOf(data, CONTRACTS_COPY.selectFailed) };
  }
  return { ok: true };
}

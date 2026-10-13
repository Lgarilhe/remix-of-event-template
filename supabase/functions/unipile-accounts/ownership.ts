/**
 * Ownership rules of `unipile-accounts`: which organisation and which member an
 * account id belongs to, and who may act on it. Database only, no provider call.
 *
 * The provider key is global to the application, so an account id taken from a
 * request is only ever used after `assertAccountInOrg` (which itself starts with
 * the shared guard `assertAccountOwnedByOrg`). There is no orphan exception any
 * more: a connection that is still being created is identified by its
 * `connection_attempts` row, never by an account id typed by the browser.
 */

import { AccountNotOwnedError, assertAccountOwnedByOrg, isUnipileError } from '../_shared/unipile/index.ts';

export class HttpError extends Error {
  status: number;
  /** Code lisible par l'écran, rendu en `error_code` quand il est donné. */
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type AccountKind = 'linkedin' | 'email' | 'whatsapp';

export type AccountOwnership = { mapped: 'org' | 'foreign' | 'none'; userId: string | null; kind: AccountKind | null };

/**
 * Appartenance d'un account_id (LinkedIn, e-mail ou WhatsApp) à l'organisation
 * appelante. La clé du prestataire est partagée entre les organisations : sans ce
 * contrôle, un account_id d'une autre organisation pouvait être déconnecté,
 * reconfiguré (proxy), lu, ou voir ses invitations traitées (SEC-004).
 */
// deno-lint-ignore no-explicit-any
export async function lookupAccountOwnership(adminClient: any, organizationId: string, accountId: string): Promise<AccountOwnership> {
  const tables: Array<[string, string, AccountKind]> = [
    ['member_linkedin_accounts', 'linkedin_account_id', 'linkedin'],
    ['member_email_accounts', 'email_account_id', 'email'],
    ['member_whatsapp_accounts', 'whatsapp_account_id', 'whatsapp'],
  ];
  let foreign = false;
  for (const [table, column, kind] of tables) {
    const { data, error } = await adminClient
      .from(table)
      .select('organization_id, user_id')
      .eq(column, accountId);
    if (error) {
      console.error('[unipile-accounts] Account ownership query failed', { table, code: error.code });
      throw new HttpError(500, 'Impossible de vérifier ce compte pour le moment');
    }
    const rows = (data ?? []) as Array<{ organization_id: string; user_id: string | null }>;
    const own = rows.find((r) => r.organization_id === organizationId);
    if (own) return { mapped: 'org', userId: own.user_id ?? null, kind };
    if (rows.length > 0) foreign = true;
  }
  return { mapped: foreign ? 'foreign' : 'none', userId: null, kind: null };
}

/**
 * Refuse tout compte qui n'est pas rattaché à l'organisation appelante (autre
 * organisation ou compte sans liaison). Appelé avant tout appel au prestataire qui
 * porte un account_id venu d'une requête.
 */
export async function assertAccountInOrg(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  organizationId: string,
  callerUserId: string,
  accountId: unknown,
): Promise<AccountOwnership> {
  const id = typeof accountId === 'string' ? accountId.trim() : '';
  if (!id) throw new HttpError(400, 'Account ID requis');
  if (id.length > 512 || id.includes('..') || /[/\\?#]/.test(id)) throw new HttpError(400, 'Account ID invalide');
  try {
    await assertAccountOwnedByOrg(adminClient, organizationId, id);
  } catch (error) {
    if (error instanceof AccountNotOwnedError) throw new HttpError(403, "Ce compte n'est pas rattaché à votre organisation");
    if (isUnipileError(error)) throw new HttpError(500, 'Impossible de vérifier ce compte pour le moment');
    throw error;
  }
  const ownership = await lookupAccountOwnership(adminClient, organizationId, id);
  if (ownership.mapped !== 'org') throw new HttpError(403, "Ce compte n'est pas rattaché à votre organisation");
  if (ownership.kind === 'whatsapp' && ownership.userId !== callerUserId) {
    throw new HttpError(403, 'Ce compte WhatsApp appartient à un autre membre');
  }
  return ownership;
}

/**
 * Actions faites au nom de la personne dans sa messagerie (supprimer une conversation ou un
 * message, réagir) : le compte doit être SON compte LinkedIn relié, jamais celui d'un collègue,
 * même pour un administrateur (liaison stricte par `user_id`).
 */
export async function assertOwnLinkedInAccount(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  organizationId: string,
  callerUserId: string,
  accountId: unknown,
): Promise<AccountOwnership> {
  const ownership = await assertAccountInOrg(adminClient, organizationId, callerUserId, accountId);
  if (ownership.kind !== 'linkedin' || ownership.userId !== callerUserId) {
    throw new HttpError(403, "Cette action n'est possible que depuis votre propre compte LinkedIn");
  }
  return ownership;
}

// deno-lint-ignore no-explicit-any
export async function getCallerOrgRole(adminClient: any, organizationId: string, userId: string): Promise<string | null> {
  const { data } = await adminClient
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as { role?: string } | null)?.role ?? null;
}

/** Rôles de l'organisation qui utilisent les comptes de l'équipe (organization_members.role). */
const TEAM_READER_ROLES: ReadonlySet<string> = new Set(['owner', 'admin', 'member']);

/** Vrai pour un collaborateur, et pour tout rôle absent, illisible ou inconnu (échec fermé). */
export function isCollaboratorRole(role: string | null | undefined): boolean {
  return !TEAM_READER_ROLES.has(String(role ?? '').trim().toLowerCase());
}

/** Refus rendu à un collaborateur qui vise le compte d'un collègue (valable pour LinkedIn, e-mail et WhatsApp). */
export const ACCOUNT_NOT_YOURS_MESSAGE =
  "Ce compte est relié par un autre membre de l'organisation. Vous ne pouvez utiliser que votre propre compte.";

/**
 * Paramètres du corps qui désignent un compte existant du prestataire. `account_id` est celui de toutes les
 * actions sur un compte ; `reconnect_account_id` celui de la reconnexion (connection_start, connect_cookie).
 */
export const ACCOUNT_PARAM_KEYS: readonly string[] = ['account_id', 'reconnect_account_id'];

/**
 * Règle générale de l'usage des comptes de l'équipe : un collaborateur n'utilise que le compte qu'il a relié
 * lui-même. Elle ne dépend d'AUCUNE action : toute requête qui désigne, dans `ACCOUNT_PARAM_KEYS`, un compte relié
 * dans l'organisation à un autre membre est refusée (403, `error_code` account_not_yours), qu'il s'agisse d'une
 * lecture, d'un geste fait au nom du compte, d'une action à venir ou d'un nom d'action inconnu. Propriétaire,
 * administrateur et membre ne sont pas concernés. Un rôle absent ou inconnu est traité comme collaborateur.
 *
 * Un compte qui n'est relié à aucun membre de l'organisation (autre organisation, compte orphelin) n'est pas jugé
 * ici : l'action le refuse par ses propres contrôles (`assertAccountInOrg`), et la revendication d'un compte
 * orphelin par un administrateur de la plateforme (`claim_linkedin_account`) garde sa règle propre. Les actions qui
 * ne désignent aucun compte existant (`list`, `connection_start` pour une nouvelle liaison, `list_email`,
 * `list_whatsapp`, `unlink_*`) n'ont rien à juger. À appeler avant toute action, sur le rôle déjà lu avec l'appartenance.
 */
export async function assertCollaboratorUsesOwnAccount(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  organizationId: string,
  callerUserId: string,
  callerRole: string | null | undefined,
  params: Record<string, unknown>,
): Promise<void> {
  if (!isCollaboratorRole(callerRole)) return;
  for (const key of ACCOUNT_PARAM_KEYS) {
    const raw = params?.[key];
    const accountId = typeof raw === 'string' ? raw.trim() : '';
    if (!accountId || accountId.length > 512) continue; // malformé : l'action le refuse (400)
    const ownership = await lookupAccountOwnership(adminClient, organizationId, accountId);
    if (ownership.mapped === 'org' && (ownership.userId === null || ownership.userId !== callerUserId)) {
      throw new HttpError(403, ACCOUNT_NOT_YOURS_MESSAGE, 'account_not_yours');
    }
  }
}

/** Déconnexion, proxy, reconnexion : le propriétaire du compte ou un owner/admin de l'org. */
export async function assertCanManageAccount(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  organizationId: string,
  userId: string,
  ownership: AccountOwnership,
): Promise<void> {
  if (ownership.mapped !== 'org') return; // rien à protéger : aucun propriétaire
  if (ownership.userId === userId) return;
  if (ownership.kind === 'whatsapp') throw new HttpError(403, 'Seul le propriétaire peut gérer ce compte WhatsApp');
  const role = await getCallerOrgRole(adminClient, organizationId, userId);
  if (role === 'owner' || role === 'admin') return;
  throw new HttpError(403, "Seul le propriétaire du compte ou un administrateur de l'organisation peut effectuer cette action");
}

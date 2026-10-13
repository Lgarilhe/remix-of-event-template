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

// Écritures d'un uuid que la base lit comme le même identifiant : majuscules, accolades, tirets absents ou posés après
// chaque groupe de quatre chiffres (uuid_in de Postgres). Un espace autour ou un caractère faux est refusé par la base.
const UUID_SPELLING = /^(\{)?((?:[0-9a-f]{4}-?){7}[0-9a-f]{4})(\})?$/i;

/**
 * Forme canonique (minuscules, tirets 8-4-4-4-12) d'un uuid, sous toutes les écritures que la base accepte. Une valeur que
 * la base refuserait (espaces autour, longueur ou caractère faux) et tout ce qui n'est pas un uuid sont rendus tels quels :
 * rien n'est « réparé », la valeur reste refusée là où la base la lit. Les comparaisons de chaînes sur une organisation ou
 * un titulaire de compte passent par ici (`sameId`), sinon la même organisation écrite en majuscules passe pour une autre
 * et une règle posée sur cette comparaison est sautée.
 */
export function canonicalUuid(value: string): string {
  if (typeof value !== 'string') return value;
  const match = UUID_SPELLING.exec(value);
  if (!match || Boolean(match[1]) !== Boolean(match[3])) return value;
  const hex = match[2].replaceAll('-', '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Vrai quand les deux valeurs désignent le même identifiant ; un identifiant vide ou absent ne ressemble à rien. */
export function sameId(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a === '' || b === '') return false;
  return canonicalUuid(a) === canonicalUuid(b);
}

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
    const own = rows.find((r) => sameId(r.organization_id, organizationId));
    if (own) return { mapped: 'org', userId: own.user_id == null ? null : canonicalUuid(own.user_id), kind };
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
  if (ownership.kind === 'whatsapp' && !sameId(ownership.userId, callerUserId)) {
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
  if (ownership.kind !== 'linkedin' || !sameId(ownership.userId, callerUserId)) {
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
    if (ownership.mapped === 'org' && !sameId(ownership.userId, callerUserId)) {
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
  if (sameId(ownership.userId, userId)) return;
  if (ownership.kind === 'whatsapp') throw new HttpError(403, 'Seul le propriétaire peut gérer ce compte WhatsApp');
  const role = await getCallerOrgRole(adminClient, organizationId, userId);
  if (role === 'owner' || role === 'admin') return;
  throw new HttpError(403, "Seul le propriétaire du compte ou un administrateur de l'organisation peut effectuer cette action");
}

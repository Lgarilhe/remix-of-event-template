/**
 * Comptes des conversations à classer : format courant et reliés à
 * l'organisation de la personne.
 *
 * La clé du service est commune à toutes les organisations : sans ce contrôle,
 * un identifiant de conversation et de compte d'une autre organisation serait
 * lu avec la clé partagée. Le contrôle passe avant toute lecture et tout débit.
 */

import {
  AccountNotOwnedError,
  assertAccountOwnedByOrg,
  assertV2AccountId,
  isUnipileError,
  type GuardAdmin,
} from '../_shared/unipile/index.ts';

export interface AccountRefusal {
  status: number;
  error: string;
  error_code: string;
}

/** Comptes distincts nommés par les conversations (une conversation sans compte n'en nomme pas). */
export function distinctAccountIds(chats: readonly unknown[]): unknown[] {
  const ids: unknown[] = [];
  for (const chat of chats) {
    const id = (chat as { account_id?: unknown } | null)?.account_id;
    if (id === undefined || id === null || id === '' || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids;
}

/** `null` quand tous les comptes sont reliés à l'organisation, sinon le refus à rendre. */
export async function checkChatAccounts(
  admin: GuardAdmin,
  organizationId: string,
  accountIds: readonly unknown[],
): Promise<AccountRefusal | null> {
  for (const accountId of accountIds) {
    try {
      assertV2AccountId(accountId);
      await assertAccountOwnedByOrg(admin, organizationId, accountId as string, { kinds: ['linkedin'] });
    } catch (e) {
      if (e instanceof AccountNotOwnedError) {
        return { status: 403, error: "Ce compte LinkedIn n'est pas rattaché à votre organisation.", error_code: 'ACCOUNT_NOT_LINKED' };
      }
      // Ancien identifiant (409) ou identifiant illisible (400) : le message est celui, neutre, du client.
      if (isUnipileError(e) && (e.code === 'outdated_account_id' || e.code === 'missing_account_id')) {
        return { status: e.kind === 'validation' ? 400 : 409, error: e.message, error_code: e.code === 'outdated_account_id' ? 'ACCOUNT_OUTDATED' : 'ACCOUNT_INVALID' };
      }
      throw e;
    }
  }
  return null;
}

export const ORG_REQUIRED_REFUSAL: AccountRefusal = {
  status: 403,
  error: "Aucune organisation active n'est sélectionnée.",
  error_code: 'ORG_REQUIRED',
};

/**
 * Contrôle complet des comptes d'une demande : l'organisation active de la
 * personne (`ORG_REQUIRED` sans elle), puis chaque compte (`checkChatAccounts`).
 * Sans compte nommé, rien à contrôler. À appeler avant toute lecture et tout débit.
 */
export async function gateChatAccounts(
  admin: GuardAdmin,
  resolveOrganizationId: () => Promise<string | null | undefined>,
  accountIds: readonly unknown[],
): Promise<AccountRefusal | null> {
  if (accountIds.length === 0) return null;
  const orgId = await resolveOrganizationId();
  if (!orgId) return ORG_REQUIRED_REFUSAL;
  return await checkChatAccounts(admin, orgId, accountIds);
}

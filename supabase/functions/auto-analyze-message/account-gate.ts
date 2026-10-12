/**
 * Autorisation du compte LinkedIn d'une analyse, avant toute lecture et tout
 * débit.
 *
 * La clé du service est commune à toutes les organisations : le compte lu doit
 * être relié à l'organisation retenue. L'organisation se déduit du propriétaire
 * du compte, jamais de celle du corps de la demande pour un membre (sinon un
 * membre de l'organisation A lirait un compte de l'organisation B). Un appel
 * interne (clé de service) peut nommer l'organisation, mais le compte doit lui
 * être relié ; un compte relié à aucune organisation et sans organisation
 * nommée est refusé.
 */

import {
  AccountNotOwnedError,
  assertAccountOwnedByOrg,
  assertV2AccountId,
  isUnipileError,
  type GuardAdmin,
} from '../_shared/unipile/index.ts';

export interface GateRefusal {
  status: number;
  body: { error: string; error_code?: string };
}

export type GateResult =
  | { ok: true; accountOrgId: string | undefined; ownerUserId: string | undefined }
  | ({ ok: false } & GateRefusal);

export interface GateDeps {
  admin: GuardAdmin;
  /** Organisation et membre qui ont relié le compte, `undefined` si aucun lien. */
  findOwner: (accountId: string) => Promise<{ organizationId?: string; userId?: string }>;
  isMember: (userId: string, organizationId: string) => Promise<boolean>;
}

const FORBIDDEN: GateRefusal = { status: 403, body: { error: 'Forbidden' } };

/** Même vocabulaire de codes que le classement des conversations (auto-categorize-chats). */
export function accountFormatRefusal(accountId: unknown): GateRefusal | null {
  try {
    assertV2AccountId(accountId);
    return null;
  } catch (e) {
    if (!isUnipileError(e)) throw e;
    return {
      status: e.kind === 'validation' ? 400 : 409,
      body: { error: e.message, error_code: e.code === 'outdated_account_id' ? 'ACCOUNT_OUTDATED' : 'ACCOUNT_INVALID' },
    };
  }
}

export async function authorizeAccount(
  input: { accountId: unknown; userId: string | null; bodyOrganizationId: unknown },
  deps: GateDeps,
): Promise<GateResult> {
  const bodyOrg = typeof input.bodyOrganizationId === 'string' && input.bodyOrganizationId !== '' ? input.bodyOrganizationId : undefined;
  if (!input.accountId) return { ok: true, accountOrgId: bodyOrg, ownerUserId: undefined };

  // Un identifiant qui n'est pas du format courant : le compte est à reconnecter. Refus net,
  // avant toute lecture (une absence de lien ne doit pas se lire comme un compte inconnu).
  const formatRefusal = accountFormatRefusal(input.accountId);
  if (formatRefusal) return { ok: false, ...formatRefusal };
  const accountId = input.accountId as string;

  const owner = await deps.findOwner(accountId);
  let accountOrgId = bodyOrg;
  if (input.userId) {
    const isMember = owner.organizationId ? await deps.isMember(input.userId, owner.organizationId) : false;
    if (!isMember) return { ok: false, ...FORBIDDEN };
    accountOrgId = owner.organizationId;
  } else if (!accountOrgId) {
    accountOrgId = owner.organizationId;
  }

  // Aucune organisation pour ce compte (ni nommée, ni propriétaire) : rien ne borne la lecture.
  if (!accountOrgId) return { ok: false, ...FORBIDDEN };
  try {
    await assertAccountOwnedByOrg(deps.admin, accountOrgId, accountId, { kinds: ['linkedin'] });
  } catch (e) {
    if (!(e instanceof AccountNotOwnedError)) throw e;
    return { ok: false, ...FORBIDDEN };
  }
  return { ok: true, accountOrgId, ownerUserId: owner.userId };
}

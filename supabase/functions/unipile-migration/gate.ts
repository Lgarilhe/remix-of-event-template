/**
 * Porte des administrateurs de la plateforme (fonction unipile-migration).
 *
 * La bascule des identifiants de compte agit sur toutes les organisations : seuls
 * les identifiants d'utilisateur listés dans KONEKT_PLATFORM_ADMIN_USER_IDS
 * (séparés par des virgules) passent. Contrairement à unipile-manage-webhooks, où
 * une liste absente laisse passer les propriétaires d'organisation, la porte est
 * FERMÉE quand la liste est absente ou vide, et pour un appel sans utilisateur
 * (clé de service). Le même message neutre est rendu dans tous les cas de refus :
 * il ne dit pas si la liste existe.
 *
 * Module pur : aucun accès réseau ni base.
 */

export const ADMIN_LIST_VARIABLE = 'KONEKT_PLATFORM_ADMIN_USER_IDS';

export const ADMIN_DENIED_MESSAGE = 'Cette page est réservée aux administrateurs de la plateforme.';

/** Identifiants listés : séparés par des virgules, espaces retirés, vides ignorés. */
export function parseAdminList(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string') return [];
  return raw.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
}

export type GateResult = { ok: true } | { ok: false; status: 403; error: string; error_code: 'admin_only' };

/** Ferme la porte quand la liste est absente, quand l'utilisateur est inconnu ou non listé. */
export function platformAdminGate(userId: string | null | undefined, rawList: string | null | undefined): GateResult {
  const allow = parseAdminList(rawList);
  if (allow.length === 0 || typeof userId !== 'string' || userId === '' || !allow.includes(userId)) {
    return { ok: false, status: 403, error: ADMIN_DENIED_MESSAGE, error_code: 'admin_only' };
  }
  return { ok: true };
}

/**
 * Règles « de quel compte un membre peut-il se servir » de unipile-search (SEC-006).
 *
 * La clé du prestataire est partagée entre toutes les organisations : le rattachement du compte à
 * l'organisation de l'appelant est contrôlé avant tout appel (`assertAccountOwnedByOrg`, dans index.ts).
 * Deux règles s'ajoutent :
 *
 * - Écrire au nom du compte (envoyer un message, retirer une invitation) : depuis son propre compte
 *   LinkedIn seulement, jamais depuis celui d'un collègue, quel que soit le rôle (`ownerOnlyRefusal`).
 * - Se servir d'un compte, quelle que soit l'action (lire ses conversations, ses invitations, ses projets,
 *   chercher ou lire un profil avec lui, marquer lu, recommander une compétence, lister ses paramètres de
 *   recherche, qui rendent ses projets et ses recherches enregistrées) : un collaborateur n'utilise que le
 *   compte qu'il a relié lui-même ; propriétaire, administrateur et membre utilisent ceux de l'organisation
 *   (`collaboratorOwnAccountRefusal`). La règle ne dépend pas de l'action : une action ajoutée plus tard est
 *   couverte d'office, puisque toute action de cette fonction porte un compte existant (`account_id` est
 *   obligatoire avant le contrôle). Même principe que les liens de conversation et les inscriptions de séquence,
 *   qu'un collaborateur ne voit que pour lui. Un rôle absent ou inconnu est traité comme collaborateur
 *   (échec fermé).
 *
 * Les appels internes (clé de service : assistant, agent de sourcing, moteur) ne sont pas soumis à la règle du
 * collaborateur : leur appelant a déjà borné le compte. Règle à confirmer par le propriétaire du produit.
 */

// Écritures d'un uuid que la base lit comme le même identifiant : majuscules, accolades, tirets absents ou posés après
// chaque groupe de quatre chiffres (uuid_in de Postgres). Un espace autour ou un caractère faux est refusé par la base.
const UUID_SPELLING = /^(\{)?((?:[0-9a-f]{4}-?){7}[0-9a-f]{4})(\})?$/i;

/**
 * Forme canonique (minuscules, tirets 8-4-4-4-12) d'un uuid, sous toutes les écritures que la base accepte. Une valeur que
 * la base refuserait et tout ce qui n'est pas un uuid sont rendus tels quels. Copie exacte de `canonicalUuid` de
 * `unipile-accounts/ownership.ts` (une fonction ne dépend pas du dossier d'une autre) : un test garde les deux identiques.
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

/** Actions qui écrivent au nom du compte LinkedIn. */
export const OWNER_ONLY_ACTIONS: ReadonlySet<string> = new Set(['send_message', 'withdraw_invitation']);

/** Rôles de l'organisation qui utilisent les comptes de l'équipe (organization_members.role). */
const TEAM_READER_ROLES: ReadonlySet<string> = new Set(['owner', 'admin', 'member']);

/** Refus rendu à un collaborateur qui vise le compte d'un collègue (pas de nom de prestataire, valable pour tout type de compte). */
export const ACCOUNT_NOT_YOURS_MESSAGE =
  "Ce compte est relié par un autre membre de l'organisation. Vous ne pouvez utiliser que votre propre compte.";

export interface OwnerRuleContext {
  /** Appel interne (clé de service), sans utilisateur. */
  isInternal: boolean;
  userId: string;
  /** Membre qui a relié le compte. */
  accountOwnerId: string | null;
}

export interface RoleRuleContext extends OwnerRuleContext {
  /** Rôle de l'appelant dans l'organisation (`organization_members.role`), `null` quand il n'a pas été lu. */
  role: string | null | undefined;
}

export interface Refusal {
  status: number;
  body: Record<string, unknown>;
}

/** Vrai pour un collaborateur, et pour tout rôle absent ou inconnu (échec fermé). */
export function isCollaboratorRole(role: string | null | undefined): boolean {
  return !TEAM_READER_ROLES.has(String(role ?? '').trim().toLowerCase());
}

/** Refus 403 quand l'action n'est pas permise depuis ce compte, `null` sinon. */
export function ownerOnlyRefusal(action: string, context: OwnerRuleContext): Refusal | null {
  if (!OWNER_ONLY_ACTIONS.has(action)) return null;
  if (context.isInternal) {
    // Un envoi interne (assistant, agent) est cadré par son appelant ; retirer une invitation est un geste de la personne.
    return action === 'withdraw_invitation'
      ? {
        status: 403,
        body: { success: false, errorType: 'ACTION_UNAVAILABLE', error: 'Cette action est réservée à la personne connectée.' },
      }
      : null;
  }
  if (sameId(context.accountOwnerId, context.userId)) return null;
  return {
    status: 403,
    body: {
      success: false,
      errorType: 'ACCOUNT_NOT_YOURS',
      error: action === 'withdraw_invitation'
        ? "Ce compte LinkedIn est relié par un autre membre de l'organisation. Retirez les invitations depuis votre propre compte."
        : "Ce compte LinkedIn est relié par un autre membre de l'organisation. Envoyez depuis votre propre compte.",
    },
  };
}

/**
 * Refus 403 quand un collaborateur se sert du compte d'un collègue, `null` sinon. Aucune liste d'actions :
 * la règle vaut pour toute action de la fonction, présente ou à venir.
 */
export function collaboratorOwnAccountRefusal(context: RoleRuleContext): Refusal | null {
  if (context.isInternal) return null;
  if (!isCollaboratorRole(context.role)) return null;
  if (sameId(context.accountOwnerId, context.userId)) return null;
  return {
    status: 403,
    body: { success: false, errorType: 'ACCOUNT_NOT_YOURS', error: ACCOUNT_NOT_YOURS_MESSAGE },
  };
}

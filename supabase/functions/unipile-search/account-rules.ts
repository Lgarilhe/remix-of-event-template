/**
 * Règles « de quel compte un membre peut-il se servir » de unipile-search (SEC-006).
 *
 * La clé du prestataire est partagée entre toutes les organisations : le rattachement du compte à
 * l'organisation de l'appelant est contrôlé avant tout appel (`assertAccountOwnedByOrg`, dans index.ts).
 * Deux règles s'ajoutent, par action :
 *
 * - Écrire au nom du compte (envoyer un message, retirer une invitation) : depuis son propre compte
 *   LinkedIn seulement, jamais depuis celui d'un collègue, quel que soit le rôle (`ownerOnlyRefusal`).
 * - Lire le contenu ou les données d'un compte (conversations, messages, invitations envoyées, projets
 *   Recruiter) : un collaborateur ne lit que le compte qu'il a relié lui-même ; propriétaire,
 *   administrateur et membre lisent ceux de l'organisation (`collaboratorReadRefusal`). Même principe que
 *   les liens de conversation et les inscriptions de séquence, qu'un collaborateur ne voit que pour lui.
 *   Un rôle absent ou inconnu est traité comme collaborateur (échec fermé).
 *
 * Les appels internes (clé de service : assistant, agent de sourcing, moteur) ne passent par aucune des
 * deux règles de lecture : leur appelant a déjà borné le compte. Les actions qui se servent seulement du
 * compte pour consulter LinkedIn (recherche, profil, publications, paramètres) ne rendent rien du compte
 * lui-même et restent hors de la règle de lecture. Règle à confirmer par le propriétaire du produit.
 */

/** Actions qui écrivent au nom du compte LinkedIn. */
export const OWNER_ONLY_ACTIONS: ReadonlySet<string> = new Set(['send_message', 'withdraw_invitation']);

/** Actions qui rendent le contenu ou les données du compte lui-même : un collaborateur n'y lit que le sien. */
export const COLLABORATOR_OWN_ACCOUNT_READS: ReadonlySet<string> = new Set([
  'get_chats',
  'get_messages',
  'sync_chat_history',
  'list_sent_invitations',
  'list_recruiter_projects',
]);

/** Rôles de l'organisation qui lisent les comptes de l'équipe (organization_members.role). */
const TEAM_READER_ROLES: ReadonlySet<string> = new Set(['owner', 'admin', 'member']);

export interface OwnerRuleContext {
  /** Appel interne (clé de service), sans utilisateur. */
  isInternal: boolean;
  userId: string;
  /** Membre qui a relié le compte. */
  accountOwnerId: string | null;
}

export interface ReadRuleContext extends OwnerRuleContext {
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
  if (context.accountOwnerId === context.userId) return null;
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

/** Refus 403 quand un collaborateur lit le compte d'un collègue, `null` sinon. */
export function collaboratorReadRefusal(action: string, context: ReadRuleContext): Refusal | null {
  if (!COLLABORATOR_OWN_ACCOUNT_READS.has(action)) return null;
  if (context.isInternal) return null;
  if (!isCollaboratorRole(context.role)) return null;
  if (context.userId !== '' && context.accountOwnerId === context.userId) return null;
  return {
    status: 403,
    body: {
      success: false,
      errorType: 'ACCOUNT_NOT_YOURS',
      error: "Ce compte LinkedIn est relié par un autre membre de l'organisation. Vous ne pouvez consulter que votre propre compte.",
    },
  };
}

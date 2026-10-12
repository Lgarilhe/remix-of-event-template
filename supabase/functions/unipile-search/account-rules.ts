/**
 * Règle « un membre n'agit que depuis le compte qu'il a relié » de unipile-search (SEC-006).
 *
 * La clé du prestataire est partagée entre toutes les organisations : le rattachement du compte à
 * l'organisation de l'appelant est contrôlé avant tout appel (`assertAccountOwnedByOrg`, dans index.ts).
 * Cette règle va plus loin pour les actions qui écrivent au nom du compte : envoyer un message ou retirer
 * une invitation se fait depuis son propre compte LinkedIn, jamais depuis celui d'un collègue. Les
 * propriétaires et administrateurs voient encore les comptes de l'équipe en lecture. Règle à confirmer par
 * le propriétaire du produit.
 */

/** Actions qui écrivent au nom du compte LinkedIn. */
export const OWNER_ONLY_ACTIONS: ReadonlySet<string> = new Set(['send_message', 'withdraw_invitation']);

export interface OwnerRuleContext {
  /** Appel interne (clé de service), sans utilisateur. */
  isInternal: boolean;
  userId: string;
  /** Membre qui a relié le compte. */
  accountOwnerId: string | null;
}

export interface Refusal {
  status: number;
  body: Record<string, unknown>;
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

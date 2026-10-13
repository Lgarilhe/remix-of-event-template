/**
 * Textes des deux sections ajoutées à la carte « Mon compte LinkedIn » (LinkedInExtras) :
 * « Invitations en attente » et « Contrat LinkedIn ».
 *
 * Règles de rédaction (docs/design/01-direction.md, § 9) : français, vouvoiement,
 * phrases courtes, pas de tiret cadratin, pas de mot de remplissage, jamais le nom
 * d'un prestataire technique. Module pur, sans import : testé par
 * tests/ux/linkedin-extras.test.mjs.
 */

export const INVITATIONS_COPY = {
  title: 'Invitations en attente',
  help: 'Invitations LinkedIn que vous avez envoyées et qui n’ont pas encore été acceptées.',
  loading: 'Chargement des invitations en attente…',
  empty: 'Aucune invitation en attente.',
  loadFailedTitle: 'Impossible de charger vos invitations en attente.',
  errorBody: 'Vérifiez votre connexion, puis réessayez.',
  moreError: 'Les invitations suivantes n’ont pas pu être chargées.',
  more: 'Afficher plus',
  unknownPerson: 'Profil LinkedIn',
  withdraw: 'Retirer',
  dialogTitle: 'Retirer cette invitation ?',
  confirm: 'Retirer l’invitation',
  cancel: 'Annuler',
  withdrawn: 'Invitation retirée.',
  withdrawnNotSynced: 'Invitation retirée. Le suivi des séquences n’a pas pu être mis à jour.',
  alreadyGone: 'Cette invitation n’existe plus ou a déjà été traitée.',
  withdrawFailed: 'L’invitation n’a pas pu être retirée. Réessayez dans un instant.',
} as const;

/** « 3 invitations en attente » ; le total n'est affiché que s'il est connu. */
export function invitationsCountText(total: number): string {
  return `${total} invitation${total > 1 ? 's' : ''} en attente`;
}

/** Nom accessible du bouton « Retirer » d'une ligne. */
export function withdrawAriaLabel(name: string): string {
  return `Retirer l’invitation envoyée à ${name}`;
}

/** Corps de la confirmation de retrait. */
export function withdrawDialogBody(name: string): string {
  return `L’invitation envoyée à ${name} est annulée. Une séquence qui attendait son acceptation peut passer tout de suite à l’étape prévue en cas de non-acceptation.`;
}

/** Ancienneté d'une invitation : jours entiers depuis l'envoi, `null` sans date. */
export function invitationAgeText(ageDays: number | null): string {
  if (ageDays === null || !Number.isFinite(ageDays) || ageDays < 0) return 'Date d’envoi inconnue';
  const days = Math.floor(ageDays);
  if (days === 0) return 'Envoyée aujourd’hui';
  if (days === 1) return 'Envoyée hier';
  if (days < 30) return `Envoyée il y a ${days} jours`;
  if (days < 365) return `Envoyée il y a ${Math.floor(days / 30)} mois`;
  return 'Envoyée il y a plus d’un an';
}

export const CONTRACTS_COPY = {
  title: 'Contrat LinkedIn',
  explanation: 'Recruiter et Sales Navigator ne fonctionnent pas en même temps sur un même compte. Vos recherches utilisent un seul contrat à la fois.',
  applies: 'Le changement s’applique à vos prochaines recherches.',
  loading: 'Chargement des contrats LinkedIn…',
  loadFailedTitle: 'Impossible de lire vos contrats LinkedIn.',
  errorBody: 'Vérifiez votre connexion, puis réessayez.',
  current: 'Contrat utilisé',
  use: 'Utiliser',
  unnamed: 'Contrat LinkedIn',
  selectFailed: 'Le contrat n’a pas pu être changé. Réessayez dans un instant.',
} as const;

/** Nom accessible du bouton « Utiliser » d'une ligne. */
export function contractUseAriaLabel(name: string): string {
  return `Utiliser le contrat ${name}`;
}

/** Confirmation après le choix d'un contrat. */
export function contractChangedText(name: string): string {
  return `Contrat utilisé pour vos recherches : ${name}.`;
}

/** Offre d'un contrat, dans les mots de Konekt ; `null` pour une offre inconnue. */
export function contractProductLabel(product: string): string | null {
  if (product === 'recruiter') return 'LinkedIn Recruiter';
  if (product === 'sales_navigator') return 'Sales Navigator';
  return null;
}

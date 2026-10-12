/**
 * Textes des deux commandes ajoutées au panneau de filtres du sourcing :
 * « Coller un lien de recherche LinkedIn » (PasteSearchUrl) et le sélecteur
 * « Projet Recruiter » (RecruiterProjectPicker).
 *
 * Règles de rédaction (docs/design/01-direction.md) : français, vouvoiement,
 * phrases courtes, pas de tiret cadratin, pas de mot de remplissage, jamais le
 * nom d'un prestataire technique. Module pur, sans import : testé par
 * tests/ux/recherche-lien-projet.test.mjs.
 */

export const PASTE_URL_COPY = {
  trigger: 'Coller un lien de recherche LinkedIn',
  label: 'Lien de recherche LinkedIn',
  placeholder: 'https://www.linkedin.com/search/results/people/…',
  help: 'Collez l’adresse d’une recherche de personnes (Classic, Recruiter ou Sales Navigator). Aucune recherche n’est lancée.',
  submit: 'Reprendre les filtres',
  submitting: 'Lecture…',
  close: 'Fermer',
  dismissResult: 'Fermer le message',
  emptyInput: 'Collez l’adresse d’une recherche LinkedIn.',
  needsAccount: 'Connectez un compte LinkedIn pour lire un lien de recherche.',
  genericError: 'Ce lien n’a pas pu être lu. Vérifiez-le, puis réessayez.',
  nothingRead: 'Aucun filtre n’a pu être lu dans cette adresse. Vos filtres n’ont pas changé.',
  replacedHint: 'Les filtres de même type ont été remplacés. Vérifiez-les, puis lancez la recherche.',
  warningsTitle: 'Non repris depuis l’adresse :',
  warningsHint: 'Ajoutez-les dans les filtres si besoin.',
} as const;

/** Phrase de réussite : « 3 filtres repris de l’adresse. » */
export function appliedFiltersText(count: number): string {
  return `${count} filtre${count > 1 ? 's' : ''} repris de l’adresse.`;
}

/** Nom de la source de recherche, tel que la personne le connaît. */
export const SEARCH_SOURCE_NAME: Readonly<Record<string, string>> = {
  classic: 'Classic',
  recruiter: 'Recruiter',
  sales_navigator: 'Sales Navigator',
};

/** La source de l’adresse n’est pas disponible sur ce compte : la source en cours est gardée. */
export function sourceKeptText(addressSource: string, currentSource: string): string {
  const from = SEARCH_SOURCE_NAME[addressSource] ?? addressSource;
  const to = SEARCH_SOURCE_NAME[currentSource] ?? currentSource;
  return `Source de recherche : l’adresse vient d’une recherche ${from}, votre recherche reste en ${to}.`;
}

export const RECRUITER_PROJECT_COPY = {
  label: 'Projet Recruiter',
  noneOption: 'Tous les profils',
  placeholder: 'Tous les profils',
  help: 'Limite la recherche aux personnes déjà dans ce projet.',
  loading: 'Chargement des projets Recruiter',
  empty: 'Aucun projet Recruiter sur ce compte.',
  error: 'Les projets Recruiter n’ont pas pu être chargés.',
  retry: 'Réessayer',
  archivedSuffix: ' (archivé)',
} as const;

/** Libellé d’un projet gardé dans la recherche mais absent de la liste chargée. */
export function unknownProjectLabel(id: string): string {
  return `Projet n° ${id}`;
}

/**
 * Adresse de contact unique des pages légales (données personnelles, droits
 * RGPD, extension Chrome). Une seule constante pour que les deux politiques ne
 * divergent plus.
 */
export const PRIVACY_CONTACT_EMAIL = 'privacy@konekt.io';

/** Lien dans un texte légal : même apparence sur les deux pages. */
export const legalLinkClass =
  'font-medium text-foreground underline underline-offset-4 transition-colors hover:text-foreground-secondary';

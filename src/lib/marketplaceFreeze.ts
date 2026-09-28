/**
 * Gel de la Marketplace (décision 17, lot C1) : jusqu'au lot P2, aucune mission
 * n'y entre, aucun recruteur partenaire n'est invité sur une mission et aucun
 * partenaire n'est validé. Les écrans masquent ces gestes ; une mission déjà
 * proposée se gère jusqu'à sa clôture.
 *
 * Côté serveur, le déclencheur de publication de sourcing_projects et
 * validate_marketplace_partner refusent avec le HINT MARKETPLACE_FROZEN
 * (migration 20260927233806_c1_reparations_fuites.sql).
 *
 * Lever le gel au lot P2 : passer à false, puis relire les textes qui en
 * dépendent (grep MARKETPLACE_FROZEN).
 */
export const MARKETPLACE_FROZEN: boolean = true;

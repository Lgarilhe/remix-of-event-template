/**
 * Licence qui enverra un InMail, vue du navigateur. Miroir de la règle du serveur
 * (`resolveSendLicence` et `planInmail`, supabase/functions/_shared/sequence-linkedin-send.ts) :
 * la file envoie avec la licence ACTIVE du compte, jamais avec une autre.
 *
 * - licence active : le contrat sélectionné (Recruiter ou Sales Navigator), sinon
 *   Recruiter, sinon Sales Navigator, sinon Classic ;
 * - objet : exigé en Recruiter et en Sales Navigator, sans objet en Classic ;
 * - solde : celui de la licence active (la clé Classic du solde s'appelle `premium`).
 *
 * Module pur, sans React ni réseau : testé dans tests/ux/inmail-licence.test.mjs.
 */

export type SendLicence = 'classic' | 'recruiter' | 'sales_navigator';

/** Clé du solde rendu par l'action `inmail_balance` (voir useInMailBalance). */
export type BalanceKey = 'premium' | 'recruiter' | 'sales_navigator';

export interface ContractLike {
  product?: unknown;
  selected?: unknown;
}

/** Licence active d'après la liste des contrats (même règle que `licencesFromContracts`). */
export function licenceFromContracts(contracts: ReadonlyArray<ContractLike>): SendLicence {
  const products = contracts.map((c) => c.product);
  const selected = contracts.find((c) => c.selected === true)?.product;
  if (selected === 'recruiter' || selected === 'sales_navigator') return selected;
  if (products.includes('recruiter')) return 'recruiter';
  if (products.includes('sales_navigator')) return 'sales_navigator';
  return 'classic';
}

/** Clé du solde d'une licence. */
export function balanceKeyOf(licence: SendLicence): BalanceKey {
  return licence === 'classic' ? 'premium' : licence;
}

/** L'InMail de cette licence exige-t-il un objet ? (Classic n'en a pas.) */
export function subjectRequired(licence: SendLicence | null): boolean {
  return licence === 'recruiter' || licence === 'sales_navigator';
}

/** Aide sous le champ « Objet », selon la licence qui enverra. */
export function subjectHelp(licence: SendLicence | null): string | null {
  if (licence === 'recruiter') return "L'objet est obligatoire pour un InMail Recruiter. Votre nom de profil signe le message.";
  if (licence === 'sales_navigator') return "L'objet est obligatoire pour un InMail Sales Navigator.";
  return null;
}

/**
 * Quel recruteur de l'équipe a passé ou reçu un appel : l'e-mail de l'agent
 * que l'opérateur envoie est rapproché de l'e-mail des membres de
 * l'organisation. Sans correspondance (collègue pas encore dans Konekt, autre
 * adresse, collaborateur qui ne voit pas les e-mails), le nom de l'opérateur
 * s'affiche tel quel.
 *
 * Fonctions pures, sans importation : lues telles quelles par les tests Node.
 */

export interface RecruiterMember {
  userId: string;
  displayName: string | null;
  email: string | null;
}

export interface RecruiterRef {
  /** Identifiant du membre Konekt ; null si l'agent n'est pas (ou pas reconnu comme) un membre. */
  userId: string | null;
  name: string;
  isMember: boolean;
}

const lower = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

/** null : appel sans agent (manqué avant d'être pris). */
export function resolveRecruiter(
  members: ReadonlyArray<RecruiterMember>,
  agentEmail: string | null | undefined,
  agentName: string | null | undefined,
): RecruiterRef | null {
  const email = lower(agentEmail);
  const operatorName = (agentName ?? '').trim();
  if (!email && !operatorName) return null;

  const member = email ? members.find((m) => lower(m.email) === email) : undefined;
  if (member) {
    const own = (member.displayName ?? '').trim();
    // display_name vaut parfois le préfixe brut de l'e-mail (« l.garilhe ») : un nom en
    // deux mots se garde, sinon le nom complet donné par l'opérateur se lit mieux.
    const name = own && /\s/.test(own) ? own : operatorName || own || email.split('@')[0];
    return { userId: member.userId, name, isMember: true };
  }
  return { userId: null, name: operatorName || email.split('@')[0], isMember: false };
}

/** L'appel est-il le mien ? Comparaison des e-mails sans tenir compte de la casse. */
export function isOwnCall(userEmail: string | null | undefined, agentEmail: string | null | undefined): boolean {
  const mine = lower(userEmail);
  return !!mine && mine === lower(agentEmail);
}

import { classifyLinkedInStatus } from '@/lib/linkedinStatus';
import { readableConnectionName } from '@/lib/connectionCopy';

export interface OnboardingLinkedInAccount {
  id: string;
  name: string;
  photo: string | null;
  status: string | null;
  subscriptions: { classic?: boolean; recruiter?: boolean; sales_navigator?: boolean } | null;
}

/**
 * La liste des comptes vient du serveur telle quelle : un compte créé par
 * l'ancien formulaire peut porter l'état encodé de la connexion
 * (« user:…|org:… ») dans son nom. Il ne s'affiche jamais, pas plus qu'un nom
 * qui cite un prestataire (src/lib/connectionCopy.ts).
 */
export function readableAccountName(name: unknown): string {
  return readableConnectionName(name, 'linkedin');
}

/** Un compte de la liste, tel que l'installation l'affiche. */
export function toOnboardingAccount(a: Record<string, unknown>): OnboardingLinkedInAccount {
  return {
    id: a.id as string,
    name: readableAccountName(a.name),
    photo: typeof a.profile_picture_url === 'string' && a.profile_picture_url ? a.profile_picture_url : null,
    status: typeof a.status === 'string' ? a.status : null,
    subscriptions: (a.subscriptions as OnboardingLinkedInAccount['subscriptions']) ?? null,
  };
}

/** Comptes reliés et en état de servir (pas en cours de connexion, pas à reconnecter). */
export function connectedAccounts(raw: ReadonlyArray<Record<string, unknown>>): OnboardingLinkedInAccount[] {
  return raw
    .filter((a) => typeof a.id === 'string' && classifyLinkedInStatus(a.status as string | undefined) === 'connected')
    .map(toOnboardingAccount);
}

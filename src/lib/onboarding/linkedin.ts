import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { classifyLinkedInStatus } from '@/lib/linkedinStatus';

export interface OnboardingLinkedInAccount {
  id: string;
  name: string;
  photo: string | null;
  status: string | null;
  subscriptions: { classic?: boolean; recruiter?: boolean; sales_navigator?: boolean } | null;
}

/**
 * La liste des comptes vient du serveur telle quelle : pour un compte créé par
 * le formulaire hébergé, le nom peut être l'état encodé de la connexion
 * (« user:…|org:… »). Il ne s'affiche jamais.
 */
export function readableAccountName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim() || /^user:.*\|org:/.test(name)) return 'Compte LinkedIn';
  return name.trim();
}

/** Comptes reliés et en état de servir (pas en cours de connexion, pas à reconnecter). */
export function connectedAccounts(raw: ReadonlyArray<Record<string, unknown>>): OnboardingLinkedInAccount[] {
  return raw
    .filter((a) => typeof a.id === 'string' && classifyLinkedInStatus(a.status as string | undefined) === 'connected')
    .map((a) => ({
      id: a.id as string,
      name: readableAccountName(a.name),
      photo: typeof a.profile_picture_url === 'string' && a.profile_picture_url ? a.profile_picture_url : null,
      status: typeof a.status === 'string' ? a.status : null,
      subscriptions: (a.subscriptions as OnboardingLinkedInAccount['subscriptions']) ?? null,
    }));
}

/** Adresse où LinkedIn renvoie l'utilisateur : la même page, avec un drapeau pour lire le résultat. */
export function linkedInReturnUrl(flag: 'ok' | 'ko'): string {
  const to = withPreviewAccessToken('/onboarding', `?li=${flag}`);
  return `${window.location.origin}${to.pathname}${to.search}${to.hash}`;
}

/** Lien du formulaire de connexion hébergé. La page y part dans le même onglet et revient sur `?li=ok` ou `?li=ko`. */
export async function requestLinkedInConnectionUrl(orgName?: string | null): Promise<string> {
  const { data } = await invokeEdgeFunction<{ url?: string }>('unipile-accounts', {
    action: 'hosted_auth_link',
    providers: ['LINKEDIN'],
    success_redirect_url: linkedInReturnUrl('ok'),
    failure_redirect_url: linkedInReturnUrl('ko'),
    org_name: orgName || undefined,
  });
  if (!data?.success || !data.url) throw new Error(data?.error || 'lien de connexion absent');
  return data.url;
}

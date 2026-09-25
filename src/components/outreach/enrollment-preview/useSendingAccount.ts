import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useAuthReady } from '@/hooks/useAuthReady';
import { classifyLinkedInStatus, type LinkedInHealth } from '@/lib/linkedinStatus';

export interface SendingAccountState {
  /** Nom du compte LinkedIn d'envoi (profil affiché), null si inconnu. */
  name: string | null;
  /** État du compte, null tant qu'aucune source ne l'a renvoyé. */
  health: LinkedInHealth | null;
  /** Compte relié à un autre membre de l'organisation. */
  belongsToOtherMember: boolean;
  /** Raison de refuser l'inscription, en français ; null si rien ne bloque. */
  blockReason: string | null;
}

export const DISCONNECTED_ACCOUNT_MESSAGE =
  "Votre compte LinkedIn est déconnecté. Reconnectez-le avant d'inscrire des candidats.";
export const OTHER_MEMBER_ACCOUNT_MESSAGE =
  "Ce compte LinkedIn est relié à un autre membre de l'équipe. Inscrivez les candidats depuis votre propre compte.";
export const NO_ACCOUNT_MESSAGE =
  "Aucun compte LinkedIn n'est sélectionné. Connectez votre compte avant d'inscrire des candidats.";

/**
 * Compte depuis lequel partiront les messages d'une inscription, avec son état.
 * Règle de liaison stricte (décision produit 2026-09) : chacun inscrit depuis
 * son propre compte relié ; un compte déconnecté ou relié à un collègue bloque
 * l'inscription. Un état inconnu (liste pas encore reçue) ne bloque pas : le
 * moteur revérifie le compte avant chaque envoi.
 */
export function useSendingAccount(accountId: string | null | undefined): SendingAccountState {
  const { accounts } = useLinkedInAccounts();
  const { getMappingForAccount } = useMemberLinkedInAccounts();
  const { user } = useAuthReady();

  const account = accountId ? accounts.find(a => a.id === accountId) : undefined;
  const mapping = accountId ? getMappingForAccount(accountId) : null;
  const rawStatus = account?.status ?? mapping?.account_status ?? null;
  const health = rawStatus ? classifyLinkedInStatus(rawStatus) : null;
  const name = account?.name || mapping?.linkedin_account_name || null;
  const belongsToOtherMember = !!(mapping && user?.id && mapping.user_id !== user.id);

  let blockReason: string | null = null;
  if (!accountId) blockReason = NO_ACCOUNT_MESSAGE;
  else if (belongsToOtherMember) blockReason = OTHER_MEMBER_ACCOUNT_MESSAGE;
  else if (health === 'needs_reconnect') blockReason = DISCONNECTED_ACCOUNT_MESSAGE;

  return { name, health, belongsToOtherMember, blockReason };
}

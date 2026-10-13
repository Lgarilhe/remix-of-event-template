/**
 * useDashboardConnections — agrège l'état de connexion des canaux outreach
 * pour l'utilisateur courant.
 *
 * 2 canaux suivis :
 * - LinkedIn : le compte relié à l'utilisateur (member_linkedin_accounts),
 *   jamais celui d'un collègue ; état calculé par resolveMyLinkedInStatus
 * - Email (liste partagée useMemberEmailList, liaison member_email_accounts) :
 *   la même requête que la carte de Connexions, donc une seule lecture par
 *   chargement de page, relue toutes les 5 minutes
 * WhatsApp n'est pas suivi ici : sa liste est distincte (list_whatsapp) et aucun
 * écran n'en lisait l'état.
 *
 * Pour chaque canal :
 * - status : 'connected' | 'error' | 'connecting' | 'disconnected'. Seul un
 *   compte à reconnecter est une panne ('error') : une connexion limitée, un
 *   accès suspendu ou une synchronisation en cours restent neutres
 *   ('connecting'), car « Reconnecter » ne les répare pas.
 * - label : nom du compte
 * - avatarUrl : photo de profil LinkedIn si dispo (utilisée pour le greeting)
 *
 * `useLinkedInAccounts` retourne les comptes LinkedIn reliés à l'organisation
 * (et les orphelins en mode revendication). Les emails ont leur propre liste
 * séparée.
 */

import { useMemo } from 'react';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useMemberEmailAccounts } from '@/hooks/useMemberEmailAccounts';
import { useMemberEmailList, type MemberEmailListEntry } from '@/components/connections/useMemberEmailList';
import { useAuthReady } from '@/hooks/useAuthReady';
import { resolveMyLinkedInStatus, channelStatusOf, classifyLinkedInStatus } from '@/lib/linkedinStatus';
import { readableConnectionName } from '@/lib/connectionCopy';

export type ConnectionStatus = 'connected' | 'error' | 'connecting' | 'disconnected';

export interface ChannelConnection {
  status: ConnectionStatus;
  /** Account name/identifier shown to the user */
  label: string | null;
  /** Avatar URL (LinkedIn photo, etc.) if available */
  avatarUrl: string | null;
  /** Statut brut du compte (OK / CONNECTING / CREDENTIALS / ERROR / DEGRADED / LOCKED...) */
  rawStatus: string | null;
}

export interface DashboardConnections {
  linkedin: ChannelConnection;
  email: ChannelConnection;
  isLoading: boolean;
  /** True if LinkedIn or email is in error/disconnected state */
  hasIssue: boolean;
  /** True if LinkedIn and email are connected and OK */
  allConnected: boolean;
}

/** Statut d'une carte d'après le statut brut d'un compte : même classement que les cartes de Connexions. */
const statusOfRaw = (raw: string | null | undefined): ConnectionStatus => {
  if (!raw) return 'disconnected';
  return channelStatusOf(classifyLinkedInStatus(raw));
};

/** Actualisation de la liste des boîtes e-mail (en parallèle de celle des comptes LinkedIn). */
const EMAIL_REFRESH_MS = 5 * 60 * 1000;
const EMPTY_EMAIL_ACCOUNTS: MemberEmailListEntry[] = [];

export function useDashboardConnections(): DashboardConnections {
  const { isReady, user } = useAuthReady();
  const { accounts: unipileAccounts, loading: unipileLoading, ready: unipileReady } = useLinkedInAccounts();
  const { mappings: linkedinMappings, isReady: linkedinMappingReady, isLoading: linkedinMappingLoading } = useMemberLinkedInAccounts();
  const { getMappingForUser: getEmailMapping, isLoading: emailMappingLoading } = useMemberEmailAccounts();

  // Les comptes e-mail viennent d'un appel distinct (list_email), partagé avec la carte de Connexions.
  // Actualisation toutes les 5 minutes, en parallèle de celle de LinkedIn.
  const emailList = useMemberEmailList({ refetchInterval: EMAIL_REFRESH_MS });
  const emailAccounts = emailList.data ?? EMPTY_EMAIL_ACCOUNTS;
  const emailLoading = emailList.isLoading;

  return useMemo<DashboardConnections>(() => {
    const userId = user?.id || null;

    // ─── LinkedIn : SON compte uniquement (liaison stricte, aucun repli sur un collègue) ───
    const li = resolveMyLinkedInStatus({
      userId,
      mappings: linkedinMappings,
      mappingsLoaded: linkedinMappingReady,
      accounts: unipileAccounts,
      accountsLoaded: unipileReady,
    });
    const linkedin: ChannelConnection = {
      status: channelStatusOf(li.state),
      label: li.account || li.mapping
        ? readableConnectionName(li.account?.name || li.mapping?.linkedin_account_name, 'linkedin')
        : null,
      avatarUrl: li.account?.profile_picture_url || null,
      rawStatus: li.rawStatus,
    };

    // ─── Email ───
    const emailMapping = userId ? getEmailMapping(userId) : null;
    const emailAccount = emailMapping
      ? emailAccounts.find(a => a.id === emailMapping.email_account_id) || null
      : emailAccounts[0] || null; // fallback : 1er compte email si dispo

    const email: ChannelConnection = {
      status: statusOfRaw(emailAccount?.status),
      label: emailAccount?.identifier || emailAccount?.name || emailMapping?.email_address || null,
      avatarUrl: null,
      rawStatus: emailAccount?.status || null,
    };

    const channels = [linkedin, email];
    const hasIssue = channels.some((c) => c.status === 'error' || c.status === 'disconnected');
    const allConnected = channels.every((c) => c.status === 'connected');

    return {
      linkedin,
      email,
      isLoading: !isReady || unipileLoading || linkedinMappingLoading || emailMappingLoading || emailLoading,
      hasIssue,
      allConnected,
    };
  }, [
    user?.id,
    unipileAccounts,
    emailAccounts,
    isReady,
    unipileLoading,
    linkedinMappingLoading,
    emailMappingLoading,
    emailLoading,
    linkedinMappings,
    linkedinMappingReady,
    unipileReady,
    getEmailMapping,
  ]);
}

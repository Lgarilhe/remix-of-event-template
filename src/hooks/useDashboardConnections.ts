/**
 * useDashboardConnections — agrège l'état de connexion des canaux outreach
 * pour l'utilisateur courant.
 *
 * 3 canaux suivis :
 * - LinkedIn (via Unipile, avec profile picture si dispo)
 * - WhatsApp (via Unipile, filtré par provider/type)
 * - Email (via Unipile email_account, mapping member_email_accounts)
 *
 * Pour chaque canal :
 * - status : 'connected' | 'error' | 'connecting' | 'disconnected'
 * - account : compte Unipile mappé à l'user (nom, identifier, etc.)
 * - avatarUrl : photo de profil LinkedIn si dispo (utilisée pour le greeting)
 *
 * Plombage Unipile : `useLinkedInAccounts` retourne TOUS les comptes Unipile
 * (LinkedIn + WhatsApp). On filtre par type/provider. Les emails ont leur
 * propre liste séparée (action 'list_email').
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useMemberEmailAccounts } from '@/hooks/useMemberEmailAccounts';
import { useAuthReady } from '@/hooks/useAuthReady';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

export type ConnectionStatus = 'connected' | 'error' | 'connecting' | 'disconnected';

export interface ChannelConnection {
  status: ConnectionStatus;
  /** Account name/identifier shown to the user */
  label: string | null;
  /** Avatar URL (LinkedIn photo, etc.) if available */
  avatarUrl: string | null;
  /** Status raw from Unipile (OK / CONNECTING / CREDENTIALS / ERROR / DISCONNECTED) */
  rawStatus: string | null;
}

export interface DashboardConnections {
  linkedin: ChannelConnection;
  whatsapp: ChannelConnection;
  email: ChannelConnection;
  isLoading: boolean;
  /** True if at least one connector is in error/disconnected state */
  hasIssue: boolean;
  /** True if all 3 connectors are connected and OK */
  allConnected: boolean;
}

const mapUnipileStatus = (raw: string | null | undefined): ConnectionStatus => {
  if (!raw) return 'disconnected';
  const upper = raw.toUpperCase();
  if (upper === 'OK') return 'connected';
  if (upper === 'CONNECTING') return 'connecting';
  if (upper === 'DISCONNECTED') return 'disconnected';
  // CREDENTIALS / ERROR / anything else = error state
  return 'error';
};

export function useDashboardConnections(): DashboardConnections {
  const { isReady, user } = useAuthReady();
  const { accounts: unipileAccounts, loading: unipileLoading } = useLinkedInAccounts();
  const { getMappingForUser: getLinkedInMapping, isLoading: linkedinMappingLoading } = useMemberLinkedInAccounts();
  const { getMappingForUser: getEmailMapping, isLoading: emailMappingLoading } = useMemberEmailAccounts();

  // Email accounts come from a separate Unipile call (list_email)
  const [emailAccounts, setEmailAccounts] = useState<Array<{ id: string; name?: string; identifier?: string; status?: string }>>([]);
  const [emailLoading, setEmailLoading] = useState(false);

  const loadEmailAccounts = useCallback(async () => {
    if (!isReady || !user) return;
    setEmailLoading(true);
    try {
      const { data } = await invokeEdgeFunction('unipile-accounts', { action: 'list_email' });
      if ((data as any)?.success && (data as any)?.accounts) {
        setEmailAccounts((data as any).accounts);
      }
    } catch (err) {
      console.warn('[useDashboardConnections] email fetch failed:', err);
    } finally {
      setEmailLoading(false);
    }
  }, [isReady, user]);

  useEffect(() => {
    void loadEmailAccounts();
  }, [loadEmailAccounts]);

  // Healthcheck refresh email accounts every 5 min (parallèle avec LinkedIn)
  useEffect(() => {
    if (!isReady || !user) return;
    const interval = setInterval(() => {
      void loadEmailAccounts();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isReady, user, loadEmailAccounts]);

  return useMemo<DashboardConnections>(() => {
    const userId = user?.id || null;

    // ─── LinkedIn ───
    const linkedinMapping = userId ? getLinkedInMapping(userId) : null;
    const linkedinAccount = linkedinMapping
      ? unipileAccounts.find((a: any) => a.id === linkedinMapping.linkedin_account_id) || null
      : // Fallback : si pas de mapping mais 1 seul compte non-WhatsApp, on l'utilise
        unipileAccounts.find((a: any) => a.type !== 'WHATSAPP' && a.provider !== 'WHATSAPP') || null;

    const linkedin: ChannelConnection = {
      status: mapUnipileStatus(linkedinAccount?.status),
      label:
        (linkedinAccount as any)?.name ||
        linkedinMapping?.linkedin_account_name ||
        null,
      avatarUrl: (linkedinAccount as any)?.profile_picture_url || null,
      rawStatus: linkedinAccount?.status || null,
    };

    // ─── WhatsApp ───
    const whatsappAccount = unipileAccounts.find(
      (a: any) => a.type === 'WHATSAPP' || a.provider === 'WHATSAPP',
    ) || null;

    const whatsapp: ChannelConnection = {
      status: mapUnipileStatus(whatsappAccount?.status),
      label: (whatsappAccount as any)?.name || (whatsappAccount as any)?.identifier || null,
      avatarUrl: null,
      rawStatus: whatsappAccount?.status || null,
    };

    // ─── Email ───
    const emailMapping = userId ? getEmailMapping(userId) : null;
    const emailAccount = emailMapping
      ? emailAccounts.find(a => a.id === emailMapping.email_account_id) || null
      : emailAccounts[0] || null; // fallback : 1er compte email si dispo

    const email: ChannelConnection = {
      status: mapUnipileStatus(emailAccount?.status),
      label: emailAccount?.identifier || emailAccount?.name || emailMapping?.email_address || null,
      avatarUrl: null,
      rawStatus: emailAccount?.status || null,
    };

    const channels = [linkedin, whatsapp, email];
    const hasIssue = channels.some((c) => c.status === 'error' || c.status === 'disconnected');
    const allConnected = channels.every((c) => c.status === 'connected');

    return {
      linkedin,
      whatsapp,
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
    getLinkedInMapping,
    getEmailMapping,
  ]);
}

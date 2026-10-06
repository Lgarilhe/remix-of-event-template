import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from './useOrganization';

/** État de la liaison de l'organisation à son opérateur téléphonique (RPC get_telephony_status). */
export interface TelephonyStatus {
  connected: boolean;
  connectedAt: string | null;
  lastEventAt: string | null;
  callsCount: number;
  lastCallAt: string | null;
}

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export const useTelephonyStatus = () => {
  const { organizationId, isAdmin } = useOrganization();
  return useQuery({
    queryKey: ['telephony-status', organizationId],
    queryFn: async (): Promise<TelephonyStatus> => {
      const { data, error } = await supabase.rpc('get_telephony_status', { p_organization_id: organizationId! });
      if (error) throw error;
      const j = (data ?? {}) as Record<string, unknown>;
      return {
        connected: j.connected === true,
        connectedAt: asString(j.connected_at),
        lastEventAt: asString(j.last_event_at),
        callsCount: typeof j.calls_count === 'number' ? j.calls_count : 0,
        lastCallAt: asString(j.last_call_at),
      };
    },
    // Réservé aux propriétaires et administrateurs : l'écran des réglages l'est aussi.
    enabled: !!organizationId && isAdmin,
    staleTime: 60 * 1000,
  });
};

/** Relier ou délier le compte Aircall (fonction serveur aircall-connect). */
export const useAircallConnectionActions = () => {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['telephony-status', organizationId] }),
      queryClient.invalidateQueries({ queryKey: ['org-integrations', organizationId] }),
    ]);
  }, [queryClient, organizationId]);

  const connect = useCallback(async (): Promise<void> => {
    setBusy('connect');
    try {
      const { data, error } = await invokeEdgeFunction<{ connected?: boolean }>('aircall-connect', { action: 'connect' });
      if (error || !data?.connected) {
        throw new Error(data?.error || error?.message || 'La liaison avec Aircall a échoué. Réessayez.');
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  /** Vrai si la liaison a aussi été retirée chez Aircall, faux s'il faut la retirer à la main. */
  const disconnect = useCallback(async (): Promise<boolean> => {
    setBusy('disconnect');
    try {
      const { data, error } = await invokeEdgeFunction<{ connected?: boolean; remote_removed?: boolean }>('aircall-connect', { action: 'disconnect' });
      if (error || data?.connected !== false) {
        throw new Error(data?.error || error?.message || 'La liaison n\'a pas pu être retirée. Réessayez.');
      }
      await refresh();
      return data.remote_removed === true;
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  return { connect, disconnect, busy };
};

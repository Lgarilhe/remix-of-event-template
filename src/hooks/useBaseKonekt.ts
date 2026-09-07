/**
 * useBaseKonekt — état de la Base Konekt pour l'organisation active (lot K,
 * docs/marketplace-base-konekt-plan-2026-09-07.md).
 *
 * Tout est calculé par la RPC get_base_konekt_state : activation, plan
 * autorisé, quota de recherches incluses du mois, coût au-delà. Le front ne
 * fait qu'afficher ; l'activation passe par set_base_konekt_enabled, qui
 * refuse un appelant sans droits ou un plan gratuit.
 *
 * La lecture est ouverte à tous les membres, pas seulement aux
 * administrateurs : un membre doit voir le sélecteur de source et son compteur.
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

export interface BaseKonektState {
  enabled: boolean;
  /** Le plan effectif ouvre la Base Konekt (tout sauf le plan gratuit). */
  plan_allows: boolean;
  effective_plan_id: string;
  /** Recherches incluses par mois civil pour ce plan. */
  included_monthly: number;
  included_used: number;
  included_remaining: number;
  /** Remise à zéro du quota : 1er du mois suivant. */
  period_end: string | null;
  credits_per_search: number;
  credits_per_profile: number;
  /** Propriétaire ou administrateur, sur un plan qui autorise la Base Konekt. */
  can_activate: boolean;
}

export const BASE_KONEKT_QUERY_KEY = 'base-konekt';

// Messages de Postgres ou du réseau : ils ne sont pas écrits pour l'utilisateur.
const TECHNICAL_ERROR = /violates|permission denied|relation |column |syntax error|duplicate key|null value|JWT|Failed to fetch|FetchError|Internal Server Error/i;

/**
 * Message affichable. Les exceptions de la RPC sont rédigées en français et
 * destinées à l'écran ; une erreur technique est remplacée par le repli, le
 * détail restant dans la console.
 */
function errorMessage(err: unknown, fallback: string): string {
  let raw: string | null = null;
  if (err instanceof Error && err.message) raw = err.message;
  else if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) raw = msg;
  }
  if (!raw) return fallback;
  if (TECHNICAL_ERROR.test(raw)) {
    console.error('[base-konekt]', raw);
    return fallback;
  }
  return raw;
}

/**
 * État de la Base Konekt et activation.
 *
 * `setEnabled` affiche l'erreur puis la relance : l'appelant doit la rattraper
 * (par exemple pour laisser une boîte de dialogue ouverte).
 */
export const useBaseKonektState = () => {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: [BASE_KONEKT_QUERY_KEY, organizationId],
    queryFn: async (): Promise<BaseKonektState | null> => {
      if (!organizationId) return null;
      const { data, error } = await supabase.rpc('get_base_konekt_state', {
        p_organization_id: organizationId,
      });
      if (error) throw error;
      return (data as unknown as BaseKonektState | null) ?? null;
    },
    enabled: !!organizationId,
    staleTime: 60 * 1000,
  });

  const setEnabledMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!organizationId) throw new Error('Aucune organisation active');
      const { error } = await supabase.rpc('set_base_konekt_enabled', {
        p_organization_id: organizationId,
        p_enabled: enabled,
      });
      if (error) {
        throw new Error(
          errorMessage(error, enabled ? "L'activation n'a pas abouti" : "La désactivation n'a pas abouti"),
        );
      }
      return enabled;
    },
    onSuccess: (enabled) => {
      queryClient.invalidateQueries({ queryKey: [BASE_KONEKT_QUERY_KEY] });
      toast.success(enabled ? 'Base Konekt activée' : 'Base Konekt désactivée');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      await setEnabledMutation.mutateAsync(enabled);
    },
    [setEnabledMutation],
  );

  const state = query.data ?? null;

  return {
    state,
    isLoading: query.isLoading,
    isError: query.isError,
    errorText: query.isError ? errorMessage(query.error, 'Impossible de charger la Base Konekt') : null,
    refetch: () => { void query.refetch(); },
    isEnabled: !!state?.enabled,
    planAllows: !!state?.plan_allows,
    canActivate: !!state?.can_activate,
    includedRemaining: state?.included_remaining ?? 0,
    includedMonthly: state?.included_monthly ?? 0,
    includedUsed: state?.included_used ?? 0,
    setEnabled,
    isSaving: setEnabledMutation.isPending,
  };
};

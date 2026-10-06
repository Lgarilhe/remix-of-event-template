/**
 * useBaseKonekt : état de la Base Konekt pour l'organisation active (lot K,
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
  /** Propriétaire ou administrateur, quel que soit le plan (permet de couper l'accès). */
  can_manage: boolean;
  /** Vrai pendant l'essai : le forfait de recherches est plafonné. */
  trialing: boolean;
}

export const BASE_KONEKT_QUERY_KEY = 'base-konekt';

// Codes des exceptions levées volontairement par la RPC : leur message est
// écrit pour l'écran. Tout le reste (schéma, réseau, droits Postgres) est
// technique et ne doit pas être montré.
const USER_FACING_CODES = new Set(['42501', 'P0001', '22023']);

/**
 * Message affichable. On n'affiche le message du serveur que pour une
 * exception volontaire de la RPC ; sinon le repli, le détail restant dans la
 * console.
 */
function errorMessage(err: unknown, fallback: string): string {
  let raw: string | null = null;
  if (err instanceof Error && err.message) raw = err.message;
  else if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) raw = msg;
  }
  const code = err && typeof err === 'object' && 'code' in err
    ? String((err as { code?: unknown }).code ?? '')
    : '';
  if (!raw) return fallback;
  if (!USER_FACING_CODES.has(code)) {
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
  const { organizationId, isLoading: orgLoading } = useOrganization();

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
    // Tant que l'organisation n'est pas chargée, la requête est désactivée et
    // ne dit rien : les écrans doivent rester en chargement.
    isLoading: orgLoading || query.isPending,
    isError: query.isError,
    errorText: query.isError ? errorMessage(query.error, 'Impossible de charger la Base Konekt') : null,
    refetch: () => { void query.refetch(); },
    isEnabled: !!state?.enabled,
    planAllows: !!state?.plan_allows,
    canActivate: !!state?.can_activate,
    canManage: !!state?.can_manage,
    isTrialing: !!state?.trialing,
    includedRemaining: state?.included_remaining ?? 0,
    includedMonthly: state?.included_monthly ?? 0,
    includedUsed: state?.included_used ?? 0,
    creditsPerSearch: state?.credits_per_search ?? 2,
    creditsPerProfile: state?.credits_per_profile ?? 2,
    periodEnd: state?.period_end ?? null,
    setEnabled,
    isSaving: setEnabledMutation.isPending,
  };
};

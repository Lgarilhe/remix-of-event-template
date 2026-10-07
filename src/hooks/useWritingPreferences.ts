// Réglages de rédaction par l'IA (lot 5e-2) : style par défaut de la personne
// (profiles.ai_context.writing_style) et niveaux de l'organisation (niveau par
// défaut et niveau maximal, organizations.agency_permissions.ai_writing).
//
// Lecture : une clé React Query, ['writing-preferences', organizationId, userId].
// Écritures :
// - style : la personne seule (RLS de profiles). La ligne est relue juste avant
//   l'écriture et seule la clé writing_style est remplacée : les consignes de
//   rédaction (tone, specialty, do, dont, free_text) ne sont jamais écrasées ;
// - niveaux : le propriétaire seul (garde organizations_update_guard, HINT
//   ORG_OWNER_ONLY), par updateOrganization ; agency_permissions est relu puis
//   fusionné, ses autres clés sont gardées.
// Le serveur relit ces valeurs à chaque rédaction : l'écran ne fait que les
// montrer, et un niveau au-dessus du plafond est refusé par le serveur.
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { updateOrganization } from '@/lib/organizationUpdate';
import type { Json } from '@/integrations/supabase/types';
import {
  levelChoices,
  normalizeOrgLevels,
  normalizeWritingStyle,
  withOrgLevels,
  type AiLevel,
  type LevelChoice,
  type OrgLevels,
  type WritingAction,
  type WritingStyle,
} from '@/lib/writingStyle';

export interface WritingPreferences extends OrgLevels {
  /** Style par défaut de la personne (défaut de l'application tant qu'il n'a jamais été enregistré). */
  style: WritingStyle;
  /** Style déjà enregistré par la personne ; sinon « Votre style » montre des réglages par défaut. */
  styleSaved: boolean;
}

export const writingPreferencesKey = (organizationId: string | null, userId: string | null) =>
  ['writing-preferences', organizationId, userId] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function useWritingPreferences() {
  const { user } = useAuthReady();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: writingPreferencesKey(organizationId, userId),
    queryFn: async (): Promise<WritingPreferences> => {
      const [profile, org] = await Promise.all([
        supabase.from('profiles').select('ai_context').eq('user_id', userId as string).maybeSingle(),
        supabase.from('organizations').select('agency_permissions').eq('id', organizationId as string).maybeSingle(),
      ]);
      if (profile.error) throw profile.error;
      if (org.error) throw org.error;
      const context = isRecord(profile.data?.ai_context) ? profile.data.ai_context : {};
      return {
        style: normalizeWritingStyle(context.writing_style, context.tone),
        styleSaved: isRecord(context.writing_style),
        ...normalizeOrgLevels(org.data?.agency_permissions),
      };
    },
    enabled: !!userId && !!organizationId,
    staleTime: 60_000,
  });

  /** Enregistre le style par défaut de la personne : ligne relue, seule writing_style remplacée. */
  const saveStyle = useCallback(async (style: WritingStyle): Promise<WritingStyle> => {
    if (!userId) throw new Error('Votre session a expiré. Reconnectez-vous.');
    const { data: current, error: readError } = await supabase.from('profiles').select('ai_context').eq('user_id', userId).maybeSingle();
    if (readError) throw new Error('Votre style n’a pas été enregistré. Réessayez.');
    const merged = { ...(isRecord(current?.ai_context) ? current.ai_context : {}), writing_style: style } as Json;
    const { data, error } = await supabase
      .from('profiles')
      .update({ ai_context: merged, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select('ai_context');
    if (error || !data?.length) throw new Error('Votre style n’a pas été enregistré. Réessayez.');
    const context = isRecord(data[0].ai_context) ? data[0].ai_context : {};
    const saved = normalizeWritingStyle(context.writing_style);
    queryClient.setQueryData<WritingPreferences>(writingPreferencesKey(organizationId, userId), (prev) => (prev ? { ...prev, style: saved, styleSaved: true } : prev));
    // Les consignes de rédaction partagent la même ligne : relues à la prochaine ouverture.
    void queryClient.invalidateQueries({ queryKey: ['ai-context', 'user', userId] });
    return saved;
  }, [userId, organizationId, queryClient]);

  /** Niveaux de l'organisation (propriétaire) : agency_permissions relu puis fusionné. */
  const saveOrgLevels = useCallback(async (next: { level: AiLevel; max: AiLevel }): Promise<OrgLevels> => {
    if (!organizationId) throw new Error('Aucune organisation active.');
    const { data: current, error: readError } = await supabase.from('organizations').select('agency_permissions').eq('id', organizationId).maybeSingle();
    if (readError) throw new Error('Le réglage n’a pas été enregistré. Réessayez.');
    const row = await updateOrganization(organizationId, { agency_permissions: withOrgLevels(current?.agency_permissions, next) as Json });
    const saved = normalizeOrgLevels(row.agency_permissions);
    // Chaque membre relit ses préférences : le plafond vaut pour toute l'organisation.
    void queryClient.invalidateQueries({ queryKey: ['writing-preferences', organizationId] });
    return saved;
  }, [organizationId, queryClient]);

  const prefs = query.data ?? null;
  const choices = useCallback(
    (action: WritingAction): LevelChoice[] => levelChoices(action, { maxLevel: prefs?.maxLevel ?? 'avance' }),
    [prefs?.maxLevel],
  );

  return useMemo(() => ({
    prefs,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    saveStyle,
    saveOrgLevels,
    choices,
  }), [prefs, query.isLoading, query.isError, query.refetch, saveStyle, saveOrgLevels, choices]);
}

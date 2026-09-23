import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { updateOrganization } from '@/lib/organizationUpdate';

const STORAGE_KEY = 'konekt_ai_model_default';

/**
 * Hook to manage the organization's default AI model preference.
 * Persists in DB (for backend/cron), with a localStorage copy read by
 * invokeWithCredits. Returns null = auto-routing (recommended).
 * Écriture réservée au propriétaire (garde organizations_update_guard).
 */
export const useModelPreference = (orgId?: string | null) => {
  const [modelId, setModelIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });

  // Lecture ratée : l'état et la copie locale restent tels quels. Avant, l'erreur
  // était lue comme « aucun modèle » : le sélecteur affichait « Automatique » et
  // la copie locale lue par invokeWithCredits était effacée.
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // On mount / orgId change, hydrate from DB if available
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const { data, error } = await (supabase
        .from('organizations')
        .select('ai_model_default')
        .eq('id', orgId)
        .maybeSingle() as unknown as Promise<{ data: Record<string, unknown> | null; error: unknown }>);
      if (error) {
        console.warn('[useModelPreference] lecture de ai_model_default impossible', error);
        setLoadError(true);
        return;
      }
      setLoadError(false);
      const dbValue = (data as Record<string, unknown>)?.ai_model_default as string | null ?? null;
      setModelIdState(dbValue);
      try {
        if (dbValue) localStorage.setItem(STORAGE_KEY, dbValue);
        else localStorage.removeItem(STORAGE_KEY);
      } catch { /* noop */ }
    })();
  }, [orgId, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Plus d'état optimiste : l'état et la copie locale ne changent qu'après une
  // écriture confirmée. updateOrganization lève une erreur en français sur un
  // refus du serveur ou sur 0 ligne modifiée ; l'appelant l'affiche. Avant,
  // l'écriture partait sans être attendue : un refus laissait le choix appliqué
  // localement jusqu'au rechargement suivant, qui relisait l'ancienne valeur.
  const setModelId = useCallback(async (id: string | null) => {
    if (!orgId) throw new Error('Aucune organisation active. Rechargez la page.');
    const row = await updateOrganization(orgId, { ai_model_default: id });
    const saved = row.ai_model_default ?? null;
    setModelIdState(saved);
    try {
      if (saved) localStorage.setItem(STORAGE_KEY, saved);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* noop */ }
  }, [orgId]);

  return { modelId, setModelId, loadError, reload };
};

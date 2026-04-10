import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'konekt_ai_model_default';

/**
 * Hook to manage the organization's default AI model preference.
 * Persists in both localStorage (instant UI) and DB (for backend/cron).
 * Returns null = auto-routing (recommended).
 */
export const useModelPreference = (orgId?: string | null) => {
  const [modelId, setModelIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });

  // On mount / orgId change, hydrate from DB if available
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const { data } = await (supabase
        .from('organizations')
        .select('ai_model_default')
        .eq('id', orgId)
        .maybeSingle() as unknown as Promise<{ data: Record<string, unknown> | null; error: unknown }>);
      const dbValue = (data as Record<string, unknown>)?.ai_model_default as string | null ?? null;
      setModelIdState(dbValue);
      try {
        if (dbValue) localStorage.setItem(STORAGE_KEY, dbValue);
        else localStorage.removeItem(STORAGE_KEY);
      } catch { /* noop */ }
    })();
  }, [orgId]);

  const setModelId = useCallback((id: string | null) => {
    setModelIdState(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* noop */ }

    // Persist to DB
    if (orgId) {
      Promise.resolve(supabase
        .from('organizations')
        .update({ ai_model_default: id } as never)
        .eq('id', orgId))
        .then(({ error }: any) => {
          if (error) console.error('Failed to persist ai_model_default:', error);
        })
        .catch((e: unknown) => console.error('[useModelPreference] Save failed:', e));
    }
  }, [orgId]);

  return { modelId, setModelId };
};

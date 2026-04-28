/**
 * useEdgeFunctionWarmup — Ping les edge functions IA en background
 * pour éviter les cold starts de 400-800ms au premier appel user.
 *
 * Stratégie :
 *  - Au mount de l'inbox : ping immédiat (warm le runtime Deno)
 *  - Puis ping toutes les 4min (les edge functions Supabase restent
 *    chaudes ~5-10min avant de se faire spin down)
 *  - Skip si l'onglet n'est pas visible (économie quota)
 *  - Skip si pas d'organisation_id (user pas auth)
 *
 * Edge functions warmées :
 *  - analyze-response (panel IA suggestions + jobs)
 *  - generate-reply-suggestions (smart replies inline)
 *  - generate-outreach-message (composer assist)
 */

import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const WARMUP_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes
const FUNCTIONS_TO_WARM = [
  'analyze-response',
  'generate-reply-suggestions',
] as const;

export function useEdgeFunctionWarmup(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const pingFunction = async (functionName: string) => {
      // Skip si onglet pas visible (économie quota)
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      try {
        // Ping minimal avec body { warmup: true }. Les edge functions
        // doivent gérer ce flag en early-return pour ne pas consommer de
        // crédits. Si elles ne le gèrent pas, l'erreur est silencieuse.
        await supabase.functions.invoke(functionName, {
          body: { warmup: true },
        });
      } catch {
        // Silent fail — c'est juste un warm-up
      }
    };

    const warmAll = () => {
      FUNCTIONS_TO_WARM.forEach((fn) => {
        if (!cancelled) pingFunction(fn);
      });
    };

    // Ping immédiat au mount
    warmAll();

    // Ping périodique
    const intervalId = setInterval(warmAll, WARMUP_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [enabled]);
}

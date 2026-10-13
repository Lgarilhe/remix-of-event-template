// Refonte mission, lot 5f-2c : étapes de la séquence choisie dans le panneau Contacter.
//
// Lignes brutes de sequence_steps (snake_case, select('*'), par ordre d'étape),
// comme SequenceEnrollButton les lit au choix d'une séquence. Ce sont elles,
// et non la forme de l'aperçu, que enrollCandidates attend : il lit les délais et
// la fenêtre d'envoi dans les colonnes snake_case, et une autre forme donnerait
// un délai nul sans aucune erreur.
//
// Relues à chaque ouverture et au retour sur la fenêtre : une étape modifiée dans
// un autre onglet est vue avant l'inscription.

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type SequenceStepRow = Database['public']['Tables']['sequence_steps']['Row'];

export type SequenceStepsStatus = 'loading' | 'error' | 'ready';

export const CONTACT_STEPS_KEY = 'contact-flow-steps';

export function useSequenceSteps(sequenceId: string | null): {
  steps: SequenceStepRow[] | null;
  status: SequenceStepsStatus;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: [CONTACT_STEPS_KEY, sequenceId],
    queryFn: async (): Promise<SequenceStepRow[]> => {
      const { data, error } = await supabase
        .from('sequence_steps')
        .select('*')
        .eq('sequence_id', sequenceId as string)
        .order('step_order', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!sequenceId,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(() => {
    void refetchQuery();
  }, [refetchQuery]);

  let status: SequenceStepsStatus;
  if (!sequenceId) status = 'loading';
  else if (query.data !== undefined) status = 'ready';
  else if (query.isError || query.fetchStatus === 'paused') status = 'error';
  else status = 'loading';

  return { steps: query.data ?? null, status, refetch };
}

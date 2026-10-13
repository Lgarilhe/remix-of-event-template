// Refonte mission, lot 5f-2c : séquences proposées par le panneau Contacter.
//
// Même lecture que le menu « Séquence » de SequenceEnrollButton (séquences
// actives, plus récentes d'abord, nombre d'étapes avec la liste), plus les
// colonnes dont le panneau a besoin pour le compte d'envoi : l'auteur et la
// rotation d'expéditeurs. Aucun filtre d'organisation : c'est la RLS qui borne
// la lecture à l'organisation de la personne, et à ses seules séquences pour un
// collaborateur.
//
// La liste est relue à chaque ouverture du panneau et au retour sur la fenêtre :
// une séquence rédigée dans un autre onglet (porte « Rédiger une séquence »)
// apparaît sans recharger la page, et la plus récente de la mission devient le
// choix d'avance.

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import type { PickableSequence } from '@/lib/missionSequencePick';

export interface ContactSequenceRow extends PickableSequence {
  created_by: string;
  multi_sender_enabled: boolean | null;
  /** Comptes de la rotation d'expéditeurs (liste JSON), ou null. */
  sender_accounts: unknown;
}

export type ContactSequencesStatus = 'loading' | 'error' | 'ready';

export const CONTACT_SEQUENCES_KEY = 'contact-flow-sequences';

const NO_SEQUENCES: ContactSequenceRow[] = [];

async function readSequences(): Promise<ContactSequenceRow[]> {
  const { data, error } = await supabase
    .from('outreach_sequences')
    .select('id, name, is_active, created_at, project_id, created_by, multi_sender_enabled, sender_accounts, sequence_steps(count)')
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((seq) => {
    const counts = (seq as { sequence_steps?: Array<{ count: number }> }).sequence_steps;
    return {
      id: seq.id,
      name: seq.name,
      is_active: seq.is_active,
      project_id: seq.project_id,
      created_at: seq.created_at,
      created_by: seq.created_by,
      multi_sender_enabled: seq.multi_sender_enabled,
      sender_accounts: seq.sender_accounts,
      stepCount: counts?.[0]?.count ?? 0,
    };
  });
}

export function useContactSequences(missionId: string | null): {
  sequences: ContactSequenceRow[];
  status: ContactSequencesStatus;
  refetch: () => void;
} {
  const { organizationId } = useOrganization();
  const query = useQuery({
    queryKey: [CONTACT_SEQUENCES_KEY, organizationId, missionId],
    queryFn: readSequences,
    enabled: !!organizationId && !!missionId,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(() => {
    void refetchQuery();
  }, [refetchQuery]);

  let status: ContactSequencesStatus;
  // Une relecture en échec garde la liste déjà lue : le choix de la personne ne saute pas.
  if (query.data !== undefined) status = 'ready';
  // Hors ligne la lecture reste en attente : « Réessayer » plutôt qu'un chargement sans fin.
  else if (query.isError || query.fetchStatus === 'paused') status = 'error';
  else status = 'loading';

  return { sequences: query.data ?? NO_SEQUENCES, status, refetch };
}

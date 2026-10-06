// Appels de la rédaction par l'IA (lot 5e), derrière l'interrupteur
// konekt.sequences-v2 :
// - draft-sequence, action prepare (gratuite) : arguments du poste, « Vos
//   messages », angles, coût annoncé ;
// - draft-sequence, action draft (payante) : la séquence rédigée, jamais
//   enregistrée ici ;
// - text-action en contexte séquence (« Demander à l'IA ») : une proposition
//   pour le texte d'une étape.
// Rien n'est écrit ni gardé dans le navigateur : la rédaction va dans
// l'éditeur, qui l'enregistre par useSequenceSave au clic sur « Enregistrer ».
// Après un appel payant, le solde de crédits affiché est relu.
//
// useMissionDraftReadiness : le poste de la mission est-il assez décrit pour
// que l'IA rédige (canScoreProfiles, même règle que job_details_is_described) ?
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useAuthReady } from '@/hooks/useAuthReady';
import { sourcingProjectQueryOptions } from '@/hooks/useSourcingProjects';
import { canScoreProfiles } from '@/components/missions/v3/cadrage/cadrageModel';
import { V3_PARAM, missionV3Path } from '@/lib/missionBeta';
import type { JobDetails } from '@/types/jobDetails';
import {
  askAiErrorOf,
  draftErrorOf,
  readDraftResult,
  readPrepare,
  type AiDraftResult,
  type AskAiErrorKind,
  type DraftError,
  type DraftPrepare,
} from '@/lib/sequenceDraft';

// Discriminant en chaîne : tsconfig.app.json n'active pas strictNullChecks, qui
// est nécessaire pour qu'un booléen littéral sépare les cas.
export type PrepareOutcome = { status: 'ok'; prepare: DraftPrepare } | { status: 'error'; error: DraftError };
export type DraftOutcome = { status: 'ok'; result: AiDraftResult } | { status: 'error'; error: DraftError };
export type ProposalOutcome =
  | { status: 'ok'; text: string; warnings: string[]; creditsUsed: number | null }
  | { status: 'error'; kind: AskAiErrorKind; message: string };

export function useSequenceAI(organizationId: string | null) {
  const queryClient = useQueryClient();
  const refreshCredits = useCallback(() => {
    if (organizationId) void queryClient.invalidateQueries({ queryKey: ['ai-credits', organizationId] });
  }, [queryClient, organizationId]);

  const prepare = useCallback(async (missionId: string): Promise<PrepareOutcome> => {
    if (!organizationId) return { status: 'error', error: draftErrorOf(null, null) };
    const { data, error } = await invokeEdgeFunction('draft-sequence', { action: 'prepare', organization_id: organizationId, mission_id: missionId });
    if (error) return { status: 'error', error: draftErrorOf(error, data) };
    const read = readPrepare(data);
    return read ? { status: 'ok', prepare: read } : { status: 'error', error: draftErrorOf(null, null) };
  }, [organizationId]);

  const draft = useCallback(async (body: Record<string, unknown>): Promise<DraftOutcome> => {
    const { data, error } = await invokeEdgeFunction('draft-sequence', body);
    refreshCredits();
    if (error) return { status: 'error', error: draftErrorOf(error, data) };
    const result = readDraftResult(data);
    return result ? { status: 'ok', result } : { status: 'error', error: draftErrorOf(null, null) };
  }, [refreshCredits]);

  const propose = useCallback(async (body: Record<string, unknown>): Promise<ProposalOutcome> => {
    const { data, error } = await invokeEdgeFunction<{ text?: unknown; warnings?: unknown; credits_used?: unknown }>('text-action', body);
    refreshCredits();
    if (error) return { status: 'error', ...askAiErrorOf(error, data) };
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    if (!text) return { status: 'error', ...askAiErrorOf(null, null) };
    const warnings = Array.isArray(data?.warnings) ? data.warnings.filter((w): w is string => typeof w === 'string' && w.trim() !== '') : [];
    return { status: 'ok', text, warnings, creditsUsed: typeof data?.credits_used === 'number' ? data.credits_used : null };
  }, [refreshCredits]);

  return { prepare, draft, propose };
}

export interface MissionDraftReadiness {
  /** Lecture en cours : la porte attend, sans raison affichée. */
  loading: boolean;
  /** Poste assez décrit pour rédiger ; false aussi quand la mission est illisible. */
  described: boolean;
  /** « Décrire le poste » : section Le poste du Cadrage de la mission. */
  cadrageHref: string | null;
}

export function useMissionDraftReadiness(missionId: string | null | undefined): MissionDraftReadiness {
  const { isReady, user } = useAuthReady();
  // Même cache que useSourcingProject (relu par la page mission à chaque changement du poste).
  const query = useQuery({
    ...sourcingProjectQueryOptions(missionId ?? '', user?.id ?? null),
    enabled: isReady && !!user && !!missionId,
  });
  if (!missionId) return { loading: false, described: false, cadrageHref: null };
  const jobDetails = (query.data?.job_details ?? null) as JobDetails | null;
  return {
    loading: query.isLoading,
    described: !!jobDetails && canScoreProfiles(jobDetails),
    cadrageHref: missionV3Path(missionId, 'cadrage', { [V3_PARAM.section]: 'poste' }),
  };
}

// Refonte mission, lot 5f-2c : les candidats du panneau Contacter, relus au moment de
// l'ouvrir. La sélection du Pipeline garde des instantanés de ligne (lot 2) : un lien
// LinkedIn ajouté entre-temps, un candidat disparu ou une étape changée n'y sont pas.
// Le panneau relit donc les lignes cochées dans mission_candidate_rows (RLS de
// l'appelant, comme les listes du Pipeline), avec ce que les colonnes légères n'ont pas et
// que la compatibilité, l'aperçu et l'anti-doublon lisent : l'identifiant LinkedIn du
// fournisseur et la distance de réseau, extraits côté base (jamais le profil entier).
//
// Lecture seule. Bornée : 400 lignes au plus (les suivantes restent cochées, `overflow`
// les compte), par lots de 100 identifiants. Relue à chaque ouverture (staleTime 0, relue
// au montage) ; sans copie gardée d'une ouverture à l'autre. Les lignes qui n'existent plus
// sont écartées ; l'ordre est celui de la sélection.

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { FlowCandidate, FlowCandidatesStatus } from '@/components/sequences/contact/types';
import type { ATSCandidate } from '@/hooks/useATSData';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { atsCandidateToProfile } from '@/lib/atsCandidateToProfile';
import { GENERAL_STAGE_LABEL } from '@/lib/stageDisplay';
import { MISSION_ROW_LIGHT_COLUMNS, toMissionCandidateRow, type MissionCandidateRow } from '../types';

/** Candidats lus pour une inscription au plus ; les suivants de la sélection restent cochés. */
export const CONTACT_FLOW_MAX = 400;

/** Identifiants par lecture (longueur d'adresse raisonnable). */
const READ_CHUNK = 100;

/** Colonnes légères du Pipeline, plus les deux champs du profil LinkedIn que la compatibilité lit. */
const CONTACT_COLUMNS = [
  MISSION_ROW_LIGHT_COLUMNS,
  'provider_id:linkedin_profile_data->>provider_id',
  'network_distance:linkedin_profile_data->>network_distance',
].join(',');

// La vue n'a pas de clé primaire déclarée : lecture non typée, lignes validées par toMissionCandidateRow.
interface ContactRowsQuery extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  select(columns: string): ContactRowsQuery;
  eq(column: string, value: string | boolean): ContactRowsQuery;
  in(column: string, values: readonly string[]): ContactRowsQuery;
}

const db = supabase as unknown as {
  from: (table: 'mission_candidate_rows') => ContactRowsQuery;
};

const EMPTY_CANDIDATES: FlowCandidate[] = [];

/** Ligne de la mission vers le candidat attendu par l'adaptateur de profil. */
export function rowToAtsCandidate(row: MissionCandidateRow, project: SourcingProject): ATSCandidate {
  return {
    id: row.id,
    candidateId: row.candidateId,
    name: row.name ?? '',
    email: null,
    phone: null,
    linkedin: row.linkedinUrl,
    headline: row.headline,
    expertise: [],
    stage: GENERAL_STAGE_LABEL[row.stage],
    entity: null,
    source: 'local',
    sourceId: row.id,
    jobId: row.jobId,
    jobTitle: project.job_details?.title ?? project.name,
    lastActivity: row.updatedAt,
    createdAt: row.createdAt ?? '',
    score: row.score,
    recommendation: row.recommendation,
    tags: row.tags,
    linkedinProfileData: null,
  };
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** Une ligne brute de la vue vers le candidat du panneau ; null sans identifiant ou sans candidat. */
function toFlowCandidate(raw: unknown, project: SourcingProject): FlowCandidate | null {
  const row = toMissionCandidateRow(raw);
  if (!row) return null;
  const extra = (raw ?? {}) as Record<string, unknown>;
  const providerId = text(extra.provider_id);
  const networkDistance = text(extra.network_distance);
  const profile = {
    ...atsCandidateToProfile(rowToAtsCandidate(row, project)),
    ...(providerId ? { provider_id: providerId } : {}),
    ...(networkDistance ? { network_distance: networkDistance } : {}),
  };
  return {
    id: profile.id,
    rowId: row.id,
    candidateId: row.candidateId,
    name: row.name ?? '',
    headline: row.headline,
    pictureUrl: row.pictureUrl,
    hasLinkedIn: !!row.linkedinUrl,
    profile,
  };
}

async function readChunk(project: SourcingProject, ids: readonly string[]): Promise<FlowCandidate[]> {
  const { data, error } = await db
    .from('mission_candidate_rows')
    .select(CONTACT_COLUMNS)
    .eq('project_id', project.id)
    .eq('is_unopened', false)
    .in('id', ids);
  if (error) throw new Error(error.message || 'Lecture des candidats sélectionnés impossible');
  const out: FlowCandidate[] = [];
  for (const raw of Array.isArray(data) ? data : []) {
    const candidate = toFlowCandidate(raw, project);
    if (candidate) out.push(candidate);
  }
  return out;
}

/** Les lignes demandées, relues, dans l'ordre de la demande ; celles qui n'existent plus sont écartées. */
async function readSelectedRows(project: SourcingProject, ids: readonly string[]): Promise<FlowCandidate[]> {
  const chunks: string[][] = [];
  for (let from = 0; from < ids.length; from += READ_CHUNK) chunks.push(ids.slice(from, from + READ_CHUNK));
  const read = (await Promise.all(chunks.map((chunk) => readChunk(project, chunk)))).flat();
  const byRow = new Map(read.map((candidate) => [candidate.rowId, candidate] as const));
  const ordered: FlowCandidate[] = [];
  for (const id of ids) {
    const candidate = byRow.get(id);
    if (candidate) ordered.push(candidate);
  }
  return ordered;
}

/**
 * Candidats du panneau Contacter. `rows` : la sélection (un tableau neuf à chaque rendu convient,
 * seuls les identifiants comptent). `enabled` : le panneau est en mode Contacter.
 */
export function useContactCandidates(
  project: SourcingProject,
  rows: readonly MissionCandidateRow[],
  enabled: boolean,
): { candidates: FlowCandidate[]; status: FlowCandidatesStatus; refetch: () => void; overflow: number } {
  const overflow = Math.max(0, rows.length - CONTACT_FLOW_MAX);
  const signature = rows
    .slice(0, CONTACT_FLOW_MAX)
    .map((row) => row.id)
    .join(',');
  const ids = useMemo(() => (signature ? signature.split(',') : []), [signature]);

  const query = useQuery({
    queryKey: ['project-candidates', project.id, 'contact-flow', signature],
    queryFn: () => readSelectedRows(project, ids),
    enabled: enabled && ids.length > 0,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(() => {
    void refetchQuery();
  }, [refetchQuery]);

  const candidates = query.data ?? EMPTY_CANDIDATES;
  let status: FlowCandidatesStatus;
  if (!enabled) status = 'loading';
  else if (ids.length === 0 || query.data !== undefined) status = 'ready';
  // Hors ligne la lecture reste en attente : « Réessayer » plutôt qu'un chargement sans fin.
  else if (query.isError || query.fetchStatus === 'paused') status = 'error';
  else status = 'loading';

  return { candidates, status, refetch, overflow };
}

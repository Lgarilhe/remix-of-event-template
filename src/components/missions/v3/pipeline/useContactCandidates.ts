// Refonte mission, lot 5f-2c : les candidats du panneau Contacter, relus au moment de
// l'ouvrir. La sélection du Pipeline garde des instantanés de ligne (lot 2) : un lien
// LinkedIn ajouté entre-temps, un candidat disparu ou une étape changée n'y sont pas.
// Le panneau relit donc les lignes cochées dans mission_candidate_rows (RLS de
// l'appelant, comme les listes du Pipeline), colonnes légères seulement.
//
// Le profil de chaque candidat reste celui que le Pipeline fabriquait déjà (nom, titre, lien
// LinkedIn) : ni la distance de réseau ni l'identifiant du fournisseur d'un instantané ancien,
// ou d'un autre compte, ne sont écrits dans l'inscription (le moteur lit `network_distance`
// de l'inscription comme une preuve de connexion, avant de relire la relation en direct).
//
// Lecture seule. Bornée : 400 lignes au plus (les suivantes restent cochées, `overflow`
// les compte), par lots de 100 identifiants. Relue à chaque ouverture (staleTime 0, relue
// au montage) ; sans copie gardée d'une ouverture à l'autre. Les lignes qui n'existent plus
// sont écartées ; l'ordre est celui de la sélection.

import { useCallback, useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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

/** Une ligne brute de la vue vers le candidat du panneau ; null sans identifiant ou sans candidat. */
function toFlowCandidate(raw: unknown, project: SourcingProject): FlowCandidate | null {
  const row = toMissionCandidateRow(raw);
  if (!row) return null;
  const profile = atsCandidateToProfile(rowToAtsCandidate(row, project));
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
    .select(MISSION_ROW_LIGHT_COLUMNS)
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
): { candidates: FlowCandidate[]; status: FlowCandidatesStatus; refetch: () => void; overflow: number; refreshing: boolean } {
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
    // La sélection change panneau ouvert (grand écran, la liste reste cliquable) : les candidats déjà
    // lus restent affichés pendant la relecture, au lieu de remplacer tout le panneau par un squelette.
    placeholderData: keepPreviousData,
  });
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(() => {
    void refetchQuery();
  }, [refetchQuery]);

  // Pendant la relecture d'une autre sélection, seuls les candidats toujours cochés restent montrés :
  // un candidat décoché ne peut jamais être inscrit par ce qui reste à l'écran.
  const candidates = useMemo(() => {
    if (!query.data) return EMPTY_CANDIDATES;
    if (!query.isPlaceholderData) return query.data;
    const wanted = new Set(ids);
    return query.data.filter((candidate) => wanted.has(candidate.rowId));
  }, [query.data, query.isPlaceholderData, ids]);
  // Les candidats montrés ne sont pas encore ceux de la sélection : le pied attend la lecture.
  const refreshing = enabled && ids.length > 0 && query.isPlaceholderData;
  let status: FlowCandidatesStatus;
  if (!enabled) status = 'loading';
  else if (ids.length === 0 || query.data !== undefined) status = 'ready';
  // Hors ligne la lecture reste en attente : « Réessayer » plutôt qu'un chargement sans fin.
  else if (query.isError || query.fetchStatus === 'paused') status = 'error';
  else status = 'loading';

  return { candidates, status, refetch, overflow, refreshing };
}

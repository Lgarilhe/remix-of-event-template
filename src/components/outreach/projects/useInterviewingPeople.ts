// Liste des missions : les visages des candidats en entretien, une pile par
// mission (design simplifié, docs/design/06-simplicite.md, règle 4).
//
// Source légère et bornée : une seule lecture de la vue mission_candidate_rows
// (celle du Pipeline, RLS de l'appelant), limitée aux lignes en entretien des
// missions demandées, sans les profils jamais ouverts. Elle ne lit que le nom et
// l'adresse de la photo, extraite côté base (`linkedin_profile_data->>…`, comme
// keepStoredPictures de useJobCandidateStatus) : jamais le profil LinkedIn entier.
// Aucune photo n'est devinée : sans adresse enregistrée, ce sont les initiales.
//
// Clé sous ['project-candidates', …] : invalidée par invalidateStageReaders
// (src/lib/stageDisplay.ts) après chaque geste d'étape, comme le kanban. Les
// nombres de la liste restent ceux de get_mission_stage_counts ; ces visages ne
// sont qu'un habillage : une lecture en échec laisse le nombre, jamais un blanc.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { missionStageCountIds } from '@/hooks/useMissionStageCounts';

export interface InterviewingPerson {
  name: string | null;
  src: string | null;
  /** Identifiant du candidat : sa copie privée de photo passe avant `src` (PersonAvatar). */
  candidateId: string | null;
}

/** Visages gardés par mission : ceux que la pile montre avant « +N ». */
export const INTERVIEWING_FACES_PER_MISSION = 3;
/** Borne de la lecture, toutes missions confondues : au-delà, une mission garde son nombre. */
export const INTERVIEWING_ROWS_LIMIT = 300;

// La vue n'a pas de clé primaire déclarée : lecture non typée, lignes validées par groupInterviewingPeople.
interface FacesQuery extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  select(columns: string): FacesQuery;
  in(column: string, values: readonly string[]): FacesQuery;
  eq(column: string, value: string | boolean): FacesQuery;
  order(column: string, options: { ascending: boolean }): FacesQuery;
  limit(count: number): FacesQuery;
}

const db = supabase as unknown as {
  from: (table: 'mission_candidate_rows') => FacesQuery;
};

type FaceRow = {
  project_id?: unknown;
  candidate_id?: unknown;
  candidate_name?: unknown;
  picture?: unknown;
  picture_large?: unknown;
};

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** Lignes de la vue vers des piles par mission : personnes distinctes, trois au plus. */
export function groupInterviewingPeople(rows: unknown): Record<string, InterviewingPerson[]> {
  const out: Record<string, InterviewingPerson[]> = {};
  const seen = new Set<string>();
  if (!Array.isArray(rows)) return out;
  for (const raw of rows as FaceRow[]) {
    const projectId = text(raw?.project_id);
    if (!projectId) continue;
    const list = (out[projectId] ??= []);
    if (list.length >= INTERVIEWING_FACES_PER_MISSION) continue;
    const key = `${projectId}:${text(raw.candidate_id) ?? list.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ name: text(raw.candidate_name), src: text(raw.picture) ?? text(raw.picture_large), candidateId: text(raw.candidate_id) });
  }
  return out;
}

/**
 * Candidats en entretien par mission (identifiant nu), plus récemment touchés
 * d'abord. data : absent tant que la lecture n'est pas faite ou si elle échoue.
 */
export function useInterviewingPeople(projectIds: readonly (string | null | undefined)[]) {
  const key = missionStageCountIds(projectIds).join(',');
  const ids = useMemo(() => (key ? key.split(',') : []), [key]);

  return useQuery({
    queryKey: ['project-candidates', 'interviewing-people', ids],
    queryFn: async (): Promise<Record<string, InterviewingPerson[]>> => {
      const { data, error } = await db
        .from('mission_candidate_rows')
        .select('id, project_id, candidate_id, candidate_name, picture:linkedin_profile_data->>profile_picture_url, picture_large:linkedin_profile_data->>profile_picture_url_large')
        .in('project_id', ids)
        .eq('general_stage', 'interviewing')
        .eq('is_unopened', false)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: true })
        .limit(INTERVIEWING_ROWS_LIMIT);
      if (error) throw new Error(error.message || 'Lecture des candidats en entretien impossible');
      return groupInterviewingPeople(data);
    },
    enabled: ids.length > 0,
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

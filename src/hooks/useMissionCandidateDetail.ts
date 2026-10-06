// Refonte mission, lot 2 : données de la fiche candidat de la nouvelle page
// mission (src/components/missions/v3/panels/CandidatePanel.tsx).
//
// - Ligne : vue mission_candidate_rows, colonnes de la fiche, clé
//   ['project-candidates', projectId, 'v3-row', rowId] : relue après chaque geste
//   d'étape par invalidateStageReaders, sans fermer la fiche. Une ligne dont le
//   groupe a changé de ligne canonique est retrouvée par son groupe.
// - Profil LinkedIn : celui de la ligne, sinon le dernier enregistré pour ce
//   candidat (même repli que CandidateDetailModal).
// - Notes et rappels : mêmes lectures et écritures que CandidateDetailModal
//   (organization_id compris), clés ['mission-v3', 'candidate-notes' | 'candidate-reminders', candidateId].
// Aucune écriture d'étape ici : les gestes passent par useMissionStageActions.

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import {
  MISSION_ROW_DETAIL_COLUMNS,
  toMissionCandidateDetailRow,
  type MissionCandidateDetailRow,
} from '@/components/missions/v3/types';
import { hasProfileData } from '@/components/missions/v3/panels/candidateAdapters';

// La vue n'a pas de clé primaire déclarée : lecture non typée, ligne validée
// par toMissionCandidateDetailRow.
const db = supabase as unknown as {
  from: (table: 'mission_candidate_rows') => any;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CandidateNote {
  id: string;
  content: string;
  created_at: string;
  created_by: string;
}

export interface CandidateReminder {
  id: string;
  title: string;
  description: string | null;
  due_at: string;
  completed_at: string | null;
}

export const missionCandidateRowKey = (projectId: string, rowId: string) =>
  ['project-candidates', projectId, 'v3-row', rowId] as const;
const notesKey = (candidateId: string | null) => ['mission-v3', 'candidate-notes', candidateId] as const;
const remindersKey = (candidateId: string | null) => ['mission-v3', 'candidate-reminders', candidateId] as const;
const snapshotKey = (candidateId: string | null) => ['mission-v3', 'candidate-profile', candidateId] as const;

async function fetchRow(projectId: string, rowId: string): Promise<MissionCandidateDetailRow | null> {
  if (!UUID_RE.test(rowId)) return null;
  const base = () =>
    db.from('mission_candidate_rows').select(MISSION_ROW_DETAIL_COLUMNS).eq('project_id', projectId);
  const { data, error } = await base().eq('id', rowId).maybeSingle();
  if (error) throw error;
  if (data) return toMissionCandidateDetailRow(data);
  // Ligne canonique changée (doublons réunis) : la ligne qui porte rowId dans son groupe.
  const { data: grouped, error: groupError } = await base().contains('group_ids', [rowId]).limit(1);
  if (groupError) throw groupError;
  return Array.isArray(grouped) && grouped[0] ? toMissionCandidateDetailRow(grouped[0]) : null;
}

export interface MissionCandidateDetail {
  row: MissionCandidateDetailRow | null;
  /** Première lecture en cours (rien encore à afficher). */
  isLoading: boolean;
  /** Lecture en échec sans ligne déjà connue. */
  isError: boolean;
  /** Lecture faite, aucune ligne visible (retirée de la mission ou hors droits). */
  notFound: boolean;
  refetch: () => void;
  /** Profil LinkedIn enregistré (ligne ou repli), null sans profil. */
  profileData: unknown | null;
  profileLoading: boolean;
  notes: CandidateNote[];
  notesLoading: boolean;
  reminders: CandidateReminder[];
  addNote: (content: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  /** jobTitle : intitulé du poste, recopié sur le rappel comme dans CandidateDetailModal. */
  addReminder: (title: string, date: string, jobTitle?: string | null) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
}

export function useMissionCandidateDetail(projectId: string, rowId: string): MissionCandidateDetail {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  const rowQuery = useQuery({
    queryKey: missionCandidateRowKey(projectId, rowId),
    queryFn: () => fetchRow(projectId, rowId),
    enabled: !!projectId && !!rowId,
    staleTime: 30_000,
  });
  const row = rowQuery.data ?? null;
  const candidateId = row?.candidateId ?? null;
  const rowHasProfile = hasProfileData(row?.linkedinProfileData);

  const snapshotQuery = useQuery({
    queryKey: snapshotKey(candidateId),
    enabled: !!candidateId && !!row && !rowHasProfile,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_candidate_status')
        .select('linkedin_profile_data')
        .eq('candidate_id', candidateId as string)
        .not('linkedin_profile_data', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data?.linkedin_profile_data ?? null) as unknown;
    },
  });

  const notesQuery = useQuery({
    queryKey: notesKey(candidateId),
    enabled: !!candidateId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidate_notes')
        .select('*')
        .eq('candidate_id', candidateId as string)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CandidateNote[];
    },
  });

  const remindersQuery = useQuery({
    queryKey: remindersKey(candidateId),
    enabled: !!candidateId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidate_reminders')
        .select('*')
        .eq('candidate_id', candidateId as string)
        .order('due_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CandidateReminder[];
    },
  });

  const currentUserId = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  }, []);

  const addNote = useCallback(
    async (content: string) => {
      if (!candidateId) return;
      const userId = await currentUserId();
      if (!userId || !organizationId) {
        toast.error('Session ou organisation introuvable. Rechargez la page.');
        return;
      }
      const { error } = await supabase.from('candidate_notes').insert({
        candidate_id: candidateId,
        content,
        created_by: userId,
        organization_id: organizationId,
      });
      if (error) {
        toast.error("La note n'a pas été enregistrée. Réessayez.");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: notesKey(candidateId) });
      toast.success('Note ajoutée.');
    },
    [candidateId, currentUserId, organizationId, queryClient],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('candidate_notes').delete().eq('id', id);
      if (error) {
        toast.error("La note n'a pas été supprimée. Réessayez.");
        return;
      }
      queryClient.setQueryData<CandidateNote[]>(notesKey(candidateId), (prev) => (prev ?? []).filter((n) => n.id !== id));
      toast.success('Note supprimée.');
    },
    [candidateId, queryClient],
  );

  const addReminder = useCallback(
    async (title: string, date: string, jobTitle?: string | null) => {
      if (!candidateId || !row) return;
      const userId = await currentUserId();
      if (!userId || !organizationId) {
        toast.error('Session ou organisation introuvable. Rechargez la page.');
        return;
      }
      const due = new Date(date);
      if (Number.isNaN(due.getTime())) {
        toast.error('Date du rappel illisible.');
        return;
      }
      const { error } = await supabase.from('candidate_reminders').insert({
        candidate_id: candidateId,
        candidate_name: row.name,
        job_id: row.jobId,
        job_title: jobTitle ?? null,
        title,
        due_at: due.toISOString(),
        created_by: userId,
        organization_id: organizationId,
      });
      if (error) {
        toast.error("Le rappel n'a pas été créé. Réessayez.");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: remindersKey(candidateId) });
      toast.success('Rappel créé.');
    },
    [candidateId, currentUserId, organizationId, queryClient, row],
  );

  const deleteReminder = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('candidate_reminders').delete().eq('id', id);
      if (error) {
        toast.error("Le rappel n'a pas été supprimé. Réessayez.");
        return;
      }
      queryClient.setQueryData<CandidateReminder[]>(remindersKey(candidateId), (prev) =>
        (prev ?? []).filter((r) => r.id !== id),
      );
      toast.success('Rappel supprimé.');
    },
    [candidateId, queryClient],
  );

  const profileData = rowHasProfile ? row!.linkedinProfileData : hasProfileData(snapshotQuery.data) ? snapshotQuery.data! : null;

  return {
    row,
    isLoading: rowQuery.isLoading,
    isError: rowQuery.isError && !row,
    notFound: rowQuery.isSuccess && row === null,
    refetch: () => void rowQuery.refetch(),
    profileData,
    profileLoading: !!row && !rowHasProfile && snapshotQuery.isLoading,
    notes: notesQuery.data ?? [],
    notesLoading: notesQuery.isLoading,
    reminders: remindersQuery.data ?? [],
    addNote,
    deleteNote,
    addReminder,
    deleteReminder,
  };
}

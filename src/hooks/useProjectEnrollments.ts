import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Lookup léger : pour une mission donnée, la liste des profils déjà
 * enrôlés dans une séquence (avec nom de séquence, étape courante,
 * status). Sert à afficher un badge "En séquence X · Étape 2" sur les
 * cards de résultat de sourcing — l'user voit immédiatement quel
 * candidat est déjà touché par une séquence avant de re-enrôler.
 */
export interface ProjectEnrollmentInfo {
  enrollment_id: string;
  profile_id: string;
  sequence_id: string;
  sequence_name: string | null;
  status: string;
  current_step_order: number;
  replied_at: string | null;
  created_at: string;
}

/**
 * Fetch les enrollments actifs/passés pour les candidats d'une mission.
 * Indexé par profile_id pour un lookup O(1) côté UI.
 *
 * @param jobId — l'id du job lié à la mission (= sourcing_projects.job_id
 *   ou sourcing_projects.id selon la convention de ce projet). On accepte
 *   les 2 et on tente les 2 lookups.
 */
export function useProjectEnrollments(jobId: string | null | undefined) {
  const [enrollments, setEnrollments] = useState<Map<string, ProjectEnrollmentInfo>>(new Map());
  const [loading, setLoading] = useState(false);

  const fetchEnrollments = useCallback(async () => {
    if (!jobId) {
      setEnrollments(new Map());
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('sequence_enrollments')
        .select(`
          id,
          profile_id,
          sequence_id,
          status,
          current_step_order,
          replied_at,
          created_at,
          sequences:outreach_sequences ( name )
        `)
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      const map = new Map<string, ProjectEnrollmentInfo>();
      for (const row of (data || [])) {
        // 1 enrollment par profile_id (le plus récent, on a sorted desc).
        if (!map.has(row.profile_id)) {
          map.set(row.profile_id, {
            enrollment_id: row.id,
            profile_id: row.profile_id,
            sequence_id: row.sequence_id,
            sequence_name: (row.sequences as any)?.name || null,
            status: row.status,
            current_step_order: row.current_step_order ?? 0,
            replied_at: row.replied_at,
            created_at: row.created_at,
          });
        }
      }
      setEnrollments(map);
    } catch (err) {
      console.error('[useProjectEnrollments]', err);
      setEnrollments(new Map());
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchEnrollments();
  }, [fetchEnrollments]);

  return { enrollments, loading, refetch: fetchEnrollments };
}

import { useEffect, useState, useCallback, useRef } from 'react';
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

/** Rechargements des instances montées : une inscription faite ailleurs rafraîchit tous les badges. */
const refreshListeners = new Set<() => void>();

/**
 * Recharge toutes les instances montées de useProjectEnrollments (par exemple
 * après une inscription depuis la recherche, dont le badge « En séquence » est
 * affiché par un autre composant que celui qui inscrit).
 */
export function refreshProjectEnrollments(): void {
  refreshListeners.forEach((listener) => listener());
}

/**
 * Fetch les enrollments actifs/passés pour les candidats d'une mission.
 * Indexé par profile_id pour un lookup O(1) côté UI.
 *
 * @param jobIdOrIds — l'id du job lié à la mission (= sourcing_projects.job_id
 *   ou sourcing_projects.id selon la convention de ce projet), ou la liste des
 *   valeurs possibles (missionEnrollmentJobIds de src/lib/sequenceErrorMessages).
 */
export function useProjectEnrollments(jobIdOrIds: string | readonly string[] | null | undefined) {
  // Clé primitive : un tableau recréé à chaque rendu ne relance pas la lecture.
  const jobId = (typeof jobIdOrIds === 'string' ? [jobIdOrIds] : [...(jobIdOrIds ?? [])])
    .filter(Boolean)
    .join(',') || null;
  const [enrollments, setEnrollments] = useState<Map<string, ProjectEnrollmentInfo>>(new Map());
  const [loading, setLoading] = useState(false);
  /** Mission dont les badges affichés proviennent. */
  const loadedForRef = useRef<string | null>(null);

  const fetchEnrollments = useCallback(async () => {
    if (!jobId) {
      setEnrollments(new Map());
      loadedForRef.current = null;
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
        .in('job_id', jobId.split(','))
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
            sequence_name: (row.sequences as { name: string | null } | null)?.name || null,
            status: row.status,
            current_step_order: row.current_step_order ?? 0,
            replied_at: row.replied_at,
            created_at: row.created_at,
          });
        }
      }
      setEnrollments(map);
      loadedForRef.current = jobId;
    } catch (err) {
      // On garde les badges déjà affichés pour cette mission : les vider ferait
      // croire qu'aucun candidat n'est en séquence et inviterait à les
      // réinscrire. Ceux d'une autre mission ne sont jamais conservés.
      console.error('[useProjectEnrollments]', err);
      if (loadedForRef.current !== jobId) {
        setEnrollments(new Map());
        loadedForRef.current = null;
      }
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchEnrollments();
  }, [fetchEnrollments]);

  useEffect(() => {
    const listener = () => { fetchEnrollments(); };
    refreshListeners.add(listener);
    return () => { refreshListeners.delete(listener); };
  }, [fetchEnrollments]);

  return { enrollments, loading, refetch: fetchEnrollments };
}

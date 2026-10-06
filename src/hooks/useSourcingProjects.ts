import { useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import type { JobDetails } from '@/types/jobDetails';
import type { StageGestureRow } from '@/lib/candidateStage';

export interface SourcingProject {
  id: string;
  organization_id: string;
  name: string;
  /** 'mission' = mission classique · 'search' = recherche autonome (/sourcing), convertible en mission */
  kind: 'mission' | 'search';
  description: string | null;
  job_id: string | null;
  job_title: string | null;
  client_name: string | null;
  /** Only present when fetched individually (not in list query) */
  filters_snapshot?: Record<string, any>;
  notes: string | null;
  status: 'active' | 'paused' | 'completed' | 'archived';
  created_by: string;
  created_at: string;
  updated_at: string;
  last_search_at: string | null;
  stats_total_found: number;
  stats_scored: number;
  stats_messaged: number;
  stats_dismissed: number;
  stats_shortlisted: number;
  calendly_link: string | null;
  /** Only present when fetched individually (not in list query) */
  job_details?: JobDetails;
  /**
   * Liste seulement (lot 0c) : intitulé du poste, client et lieu lus dans le
   * brief (job_details), sans charger tout le JSON.
   */
  jd_title?: string | null;
  jd_client?: string | null;
  /** Logo du client enregistré dans le brief, et date de la dernière recherche infructueuse. */
  jd_client_logo?: string | null;
  jd_client_logo_checked?: string | null;
  jd_location?: string | null;
  /** Adresse de l'offre d'origine, quand la mission vient d'une offre lue en ligne. */
  jd_source_url?: string | null;
  hunt_mode: boolean;
  hunt_bounty_percent: number | null;
  hunt_max_recruiters: number | null;
  hunt_deadline: string | null;
  hunt_status: 'draft' | 'published' | 'in_progress' | 'filled' | 'cancelled' | null;
}

export interface CreateProjectInput {
  name: string;
  kind?: 'mission' | 'search';
  description?: string;
  job_id?: string;
  job_title?: string;
  client_name?: string;
  job_details?: Record<string, any>;
  filters_snapshot?: Record<string, any>;
  /** Pas de toast de confirmation : l'appelant annonce lui-même le résultat (création en lot). */
  silent?: boolean;
}

export interface UpdateProjectInput {
  id: string;
  name?: string;
  kind?: 'mission' | 'search';
  description?: string;
  notes?: string;
  status?: SourcingProject['status'];
  filters_snapshot?: Record<string, any>;
  last_search_at?: string;
  stats_total_found?: number;
  stats_scored?: number;
  stats_messaged?: number;
  stats_dismissed?: number;
  stats_shortlisted?: number;
  calendly_link?: string | null;
  job_details?: JobDetails;
  hunt_mode?: boolean;
  hunt_bounty_percent?: number | null;
  hunt_max_recruiters?: number | null;
  hunt_deadline?: string | null;
  hunt_status?: string | null;
}

export interface SourcingProjectsOptions {
  /** Relecture périodique posée par cet observateur (la barre latérale : 5 min). */
  refetchInterval?: number;
  /** Combiné par ET avec la condition existante (session et organisation prêtes). */
  enabled?: boolean;
}

// Colonnes de la liste. Typée string : l'analyse du littéral (chemins JSON
// compris) dépasse la profondeur admise par TypeScript ; le résultat est
// relu comme SourcingProject[].
const PROJECT_LIST_COLUMNS: string =
  'id, name, kind, status, created_at, updated_at, created_by, organization_id, job_id, job_title, client_name, description, notes, last_search_at, stats_total_found, stats_scored, stats_messaged, stats_dismissed, stats_shortlisted, calendly_link, hunt_mode, hunt_bounty_percent, hunt_max_recruiters, hunt_deadline, hunt_status, jd_title:job_details->>title, jd_client:job_details->client->>name, jd_client_logo:job_details->client->>logo_url, jd_client_logo_checked:job_details->client->>logo_checked_at, jd_location:job_details->>location, jd_source_url:job_details->>source_url';

export const useSourcingProjects = (
  kind: 'mission' | 'search' = 'mission',
  options?: SourcingProjectsOptions,
) => {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { isReady, user } = useAuthReady();

  // Fetch all projects — excludes heavy JSONB columns (job_details, filters_snapshot)
  // Use useSourcingProject(id) to fetch a single project with all fields.
  // Du brief, seuls le poste, le client et le lieu sont lus (jd_*, lot 0c).
  // Filtré par kind : les missions et les recherches autonomes (/sourcing)
  // partagent la table mais jamais les listes.
  const query = useQuery({
    queryKey: ['sourcing-projects', organizationId, user?.id, kind],
    queryFn: async () => {
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('sourcing_projects')
        .select(PROJECT_LIST_COLUMNS)
        .eq('organization_id', organizationId)
        .eq('kind', kind)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return data as unknown as SourcingProject[];
    },
    enabled: isReady && !!user && !!organizationId && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes cache
  });
  const { data: projects = [], isLoading, error, refetch } = query;

  // Create project mutation
  const createMutation = useMutation({
    mutationFn: async (input: CreateProjectInput) => {
      if (!user) throw new Error('Not authenticated');
      if (!organizationId) throw new Error('No organization selected');

      // `silent` ne concerne que l'écran : il n'est pas une colonne.
      const { silent, ...row } = input;
      const { data, error } = await supabase
        .from('sourcing_projects')
        .insert({
          ...row,
          created_by: user.id,
          organization_id: organizationId,
          filters_snapshot: input.filters_snapshot || {},
        })
        .select()
        .single();

      if (error) throw error;
      return data as SourcingProject;
    },
    onSuccess: (data, input) => {
      queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      // Compte du plafond de missions (useQuotaGate) : création, fin ou archivage le changent.
      queryClient.invalidateQueries({ queryKey: ['quota-job-count'] });
      if (!input.silent) toast.success(data?.kind === 'search' ? 'Recherche créée' : 'Projet créé avec succès');
    },
    onError: (err: Error) => {
      toast.error(`Erreur: ${err.message}`);
    },
  });

  // Update project mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...input }: UpdateProjectInput) => {
      const { job_details, ...rest } = input;
      const payload: Record<string, any> = { ...rest };
      if (job_details !== undefined) payload.job_details = job_details as any;
      const { data, error } = await supabase
        .from('sourcing_projects')
        .update(payload)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) throw error;
      // Zéro ligne renvoyée sans erreur explicite : la mission a été supprimée
      // ailleurs, ou l'accès a changé pendant l'édition. Fabriquer un objet à
      // partir du payload faisait passer ce cas pour une sauvegarde réussie, et
      // le brief vidait alors ses modifications en attente
      // (audit UX du 09/09/2026, constat UX03).
      if (!data) {
        throw new Error(
          "Mission introuvable ou accès modifié : vos modifications n'ont pas été enregistrées.",
        );
      }
      return data as SourcingProject;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      // Compte du plafond de missions (useQuotaGate) : création, fin ou archivage le changent.
      queryClient.invalidateQueries({ queryKey: ['quota-job-count'] });
      if (data?.id) {
        queryClient.invalidateQueries({ queryKey: ['sourcing-project', data.id] });
      }
    },
    onError: (err: Error) => {
      toast.error(`Erreur: ${err.message}`);
    },
  });

  // Delete project mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('sourcing_projects')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      queryClient.invalidateQueries({ queryKey: ['quota-job-count'] });
      toast.success('Projet supprimé');
    },
    onError: (err: Error) => {
      toast.error(`Erreur: ${err.message}`);
    },
  });

  // Find or create project for a job
  const findOrCreateForJob = useCallback(async (jobId: string, jobTitle: string, clientName?: string): Promise<SourcingProject> => {
    // Check if project already exists for this job
    const existing = projects.find(p => p.job_id === jobId);
    if (existing) return existing;

    // Create new project
    const result = await createMutation.mutateAsync({
      name: jobTitle,
      job_id: jobId,
      job_title: jobTitle,
      client_name: clientName,
    });

    return result;
  }, [projects, createMutation]);

  // Update project stats
  const updateStats = useCallback(async (projectId: string, stats: Partial<Pick<SourcingProject, 'stats_total_found' | 'stats_scored' | 'stats_messaged' | 'stats_dismissed' | 'stats_shortlisted'>>) => {
    await updateMutation.mutateAsync({
      id: projectId,
      ...stats,
    });
  }, [updateMutation]);

  // Get project by job_id
  const getProjectByJobId = useCallback((jobId: string): SourcingProject | undefined => {
    return projects.find(p => p.job_id === jobId);
  }, [projects]);

  return {
    projects,
    isLoading,
    error,
    refetch,
    // `projects` vaut [] tant que rien n'est reçu (et quand la requête est
    // désactivée) : hasData distingue « pas encore de données » d'une liste vide.
    hasData: query.data !== undefined,
    isError: query.isError,
    // 'paused' : hors ligne, la requête attend le réseau (ni chargement ni erreur).
    fetchStatus: query.fetchStatus,
    createProject: createMutation.mutateAsync,
    updateProject: updateMutation.mutateAsync,
    deleteProject: deleteMutation.mutateAsync,
    findOrCreateForJob,
    updateStats,
    getProjectByJobId,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
};

/**
 * Options de la fiche complète d'une mission (clé ['sourcing-project', id]).
 * Seule queryFn de cette clé : useSourcingProject l'utilise, et la barre
 * latérale la lit avec `enabled: false` (jamais skipToken : ses options sont
 * recopiées dans la requête partagée, et une invalidation déclenchée par la
 * page relancerait sinon une requête sans queryFn).
 */
export function sourcingProjectQueryOptions(projectId: string, userId: string | null): {
  queryKey: ['sourcing-project', string];
  queryFn: () => Promise<SourcingProject | null>;
  staleTime: number;
  gcTime: number;
} {
  return {
    queryKey: ['sourcing-project', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      if (!userId) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('sourcing_projects')
        .select('*')
        .eq('id', projectId)
        .maybeSingle();

      if (error) throw error;
      return data as SourcingProject | null;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes cache
  };
}

// Hook to get a single project with all fields (including job_details and filters_snapshot)
//
// Realtime : subscribes to UPDATE events on this row and invalidates the React
// Query cache so any change (e.g. agent IA pushing filters via
// `apply_search_filters_to_mission`) propagates to consumers like
// useLinkedInSearch without a manual reload.
export const useSourcingProject = (projectId: string | null | undefined) => {
  const { isReady, user } = useAuthReady();
  const queryClient = useQueryClient();

  const query = useQuery({
    ...sourcingProjectQueryOptions(projectId ?? '', user?.id ?? null),
    enabled: isReady && !!user && !!projectId,
  });

  // Realtime invalidation on row UPDATE (filters_snapshot, job_details, status, ...)
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`sourcing-project-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sourcing_projects',
          filter: `id=eq.${projectId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['sourcing-project', projectId] });
          queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
          queryClient.invalidateQueries({ queryKey: ['quota-job-count'] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, queryClient]);

  return query;
};

// Candidats d'une mission (kanban, tableau et Analyses de l'ancienne page mission).
// Lot 0c-3 : la vue mission_candidate_rows rend une ligne par candidat (doublons
// réunis, group_ids pour écrire tout le groupe) ; les profils jamais ouverts
// (is_unopened) restent au Sourcing, hors du Pipeline. La nouvelle page mission
// lit la même vue par useMissionCandidateRows et remplace cette page.
//
// Le commit ed2d2d6a avait rebasculé cette lecture sur la table parce que le
// glisser-déposer du kanban semblait instable : la carte retombait dans son
// ancienne colonne le temps de la relecture de la vue. La vue est reprise (elle
// seule tient « une carte par candidat » et « jamais ouverts hors du Pipeline »),
// et patchProjectCandidateStages range la carte dès l'écriture confirmée.

/** Page de lecture de la vue (plafond d'une requête PostgREST hébergée). */
export const PROJECT_CANDIDATES_PAGE_SIZE = 1000;
/** Plafond d'affichage : au-delà, le kanban et le tableau montrent les plus récents seulement. */
export const PROJECT_CANDIDATES_MAX_ROWS = 5000;

// Colonnes du kanban, du tableau et des Analyses ; ni le profil LinkedIn ni le
// détail de la note (la fiche relit le profil quand il manque). Typée string
// pour la même raison que PROJECT_LIST_COLUMNS.
const PROJECT_CANDIDATE_COLUMNS: string =
  'id, group_ids, group_size, candidate_id, candidate_name, candidate_headline, linkedin_profile_url, general_stage, process_step_id, stage_entered_at, replied_at, score, recommendation, skip_reason, tags, job_id, project_id, created_at, updated_at';

/** Ligne de la vue, colonnes de PROJECT_CANDIDATE_COLUMNS (la vue rend tout nullable, les lignes du Pipeline ont un id et un candidat). */
export interface ProjectCandidateRow {
  id: string;
  group_ids: string[] | null;
  group_size: number | null;
  candidate_id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  linkedin_profile_url: string | null;
  general_stage: string | null;
  process_step_id: string | null;
  stage_entered_at: string | null;
  replied_at: string | null;
  score: number | null;
  recommendation: string | null;
  skip_reason: string | null;
  tags: string[] | null;
  job_id: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export const useProjectCandidates = (projectId: string | null) => {
  return useQuery({
    queryKey: ['project-candidates', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      // Par pages de 1 000 lignes jusqu'à une page courte : un seul select
      // coupait en silence les plus anciens candidats d'une grosse mission.
      // Tri sur created_at puis id pour qu'une ligne ne change pas de
      // page entre deux lectures.
      const rows: ProjectCandidateRow[] = [];
      for (let from = 0; from < PROJECT_CANDIDATES_MAX_ROWS; from += PROJECT_CANDIDATES_PAGE_SIZE) {
        const page = await readProjectCandidatesPage(projectId, from);
        rows.push(...page);
        if (page.length < PROJECT_CANDIDATES_PAGE_SIZE) break;
      }
      const seen = new Set<string>();
      return rows.filter((row) => {
        const id = String(row.id ?? '');
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    },
    enabled: !!projectId,
    // Même fraîcheur que les compteurs de mission (30 s et retour sur l'onglet) :
    // une réponse reçue par le serveur apparaît au kanban comme sur la carte.
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    gcTime: 10 * 60 * 1000, // 10 minutes cache
  });
};

async function readProjectCandidatesPage(projectId: string, from: number): Promise<ProjectCandidateRow[]> {
  const { data, error } = await supabase
    .from('mission_candidate_rows')
    .select(PROJECT_CANDIDATE_COLUMNS)
    .eq('project_id', projectId)
    .eq('is_unopened', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, from + PROJECT_CANDIDATES_PAGE_SIZE - 1);
  if (error) throw error;
  return (data ?? []) as unknown as ProjectCandidateRow[];
}

/**
 * Range dans le cache de la mission les lignes qu'un geste vient d'écrire, sans
 * attendre la relecture de la vue : la carte reste dans la colonne visée. Une
 * ligne n'est rangée que si sa ligne affichée est écrite (updated ou unchanged)
 * et qu'aucune ligne de son groupe n'est restée en arrière (skipped, kept,
 * refus) : dans ce cas la relecture qui suit tranche. Sans effet si le cache de
 * la mission est vide.
 */
export function patchProjectCandidateStages(
  queryClient: QueryClient,
  projectId: string,
  rows: readonly StageGestureRow[],
): void {
  const written = new Map<string, StageGestureRow>();
  const left = new Set<string>();
  for (const r of rows) {
    if ((r.result === 'updated' || r.result === 'unchanged') && r.generalStage) written.set(r.id, r);
    else left.add(r.id);
  }
  if (written.size === 0) return;
  queryClient.setQueryData<ProjectCandidateRow[]>(['project-candidates', projectId], (old) => {
    if (!Array.isArray(old)) return old;
    return old.map((row) => {
      const shown = written.get(row.id);
      if (!shown) return row;
      if ((row.group_ids ?? []).some((id) => left.has(id))) return row;
      return {
        ...row,
        general_stage: shown.generalStage,
        process_step_id: shown.processStepId,
        stage_entered_at: shown.stageEnteredAt ?? row.stage_entered_at,
      };
    });
  });
}

/**
 * useMarketplace : cercle partenaires de la marketplace (lot M, 2026-09-07).
 *
 * Toutes les lectures et écritures passent par les RPC SQL (SECURITY DEFINER)
 * de la migration marketplace_partner_circle, sauf l'administration du cercle
 * qui passe par la edge function marketplace-admin. Clés React Query sous
 * ['marketplace', ...], invalidées après chaque mutation.
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from '@/hooks/useOrganization';
import type { JobDetails } from '@/types/jobDetails';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PartnerStatus = 'inactive' | 'pending_validation' | 'active' | 'suspended';

type HuntApplicationStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'ended';

export interface PartnerState {
  status: PartnerStatus;
  requested_at: string | null;
  validated_at: string | null;
  org_type: string | null;
  /** Vrai pour un propriétaire ou administrateur d'un cabinet ou d'un indépendant. */
  can_request: boolean;
}

export interface OpenHuntMission {
  id: string;
  name: string;
  client_name: string | null;
  job_details: JobDetails | null;
  hunt_bounty_percent: number | null;
  hunt_max_recruiters: number | null;
  hunt_deadline: string | null;
  hunt_status: string;
  created_at: string;
  organization_id: string;
  organization_name: string | null;
  accepted_count: number;
  my_application_status: HuntApplicationStatus | null;
}

export interface MyHuntApplication {
  id: string;
  project_id: string;
  status: HuntApplicationStatus;
  message: string | null;
  created_at: string;
  responded_at: string | null;
  mission_name: string;
  client_name: string | null;
  job_title: string | null;
  hunt_bounty_percent: number | null;
  hunt_status: string | null;
  organization_name: string | null;
}

export interface PartnerMission {
  id: string;
  name: string;
  client_name: string | null;
  job_title: string | null;
  hunt_status: string | null;
  hunt_bounty_percent: number | null;
  organization_name: string | null;
  created_at: string;
}

export interface HuntApplicant {
  id: string;
  recruiter_user_id: string;
  recruiter_org_id: string | null;
  status: HuntApplicationStatus;
  message: string | null;
  created_at: string;
  responded_at: string | null;
  display_name: string | null;
  recruiter_headline: string | null;
  recruiter_bio: string | null;
  specializations: string[] | null;
  linkedin_url: string | null;
  years_experience: number | null;
  placements_count: number | null;
  rating: number | null;
  organization_name: string | null;
  org_type: string | null;
}

export interface MyHuntMission {
  id: string;
  name: string;
  client_name: string | null;
  job_title: string | null;
  hunt_status: string | null;
  hunt_bounty_percent: number | null;
  hunt_max_recruiters: number | null;
  hunt_deadline: string | null;
  pending_count: number;
  accepted_count: number;
}

export interface MissionTeamProfile {
  id: string;
  project_id: string;
  user_id: string;
  role: string;
  permissions: Record<string, boolean> | null;
  created_at: string;
  display_name: string | null;
  recruiter_headline: string | null;
  /** Vrai si le membre n'appartient pas à l'organisation de la mission. */
  is_external: boolean;
}

export interface PlatformPartner {
  organization_id: string;
  organization_name: string | null;
  org_type: string | null;
  status: PartnerStatus;
  requested_at: string | null;
  requested_by_name: string | null;
  validated_at: string | null;
  member_count: number;
}

const MARKETPLACE_KEY = 'marketplace';

/** Message d'erreur lisible depuis une erreur RPC ou inconnue. */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Statut partenaire de l'organisation active
// ---------------------------------------------------------------------------

export const usePartnerState = () => {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: [MARKETPLACE_KEY, 'partner-state', organizationId],
    queryFn: async (): Promise<PartnerState | null> => {
      const { data, error } = await supabase.rpc('get_marketplace_partner_state');
      if (error) throw error;
      return (data as unknown as PartnerState | null) ?? null;
    },
    enabled: !!organizationId,
    staleTime: 60 * 1000,
  });

  const requestMutation = useMutation({
    mutationFn: async (input: { headline: string; bio: string; specializations: string[]; linkedin_url: string }) => {
      const { error } = await supabase.rpc('request_marketplace_partner', {
        p_headline: input.headline.trim(),
        p_bio: input.bio.trim(),
        p_specializations: input.specializations.map((s) => s.trim()).filter(Boolean),
        p_linkedin_url: input.linkedin_url.trim(),
      });
      if (error) throw new Error(errorMessage(error, "La demande n'a pas pu être envoyée"));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MARKETPLACE_KEY] });
      toast.success('Demande envoyée');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const requestPartner = useCallback(
    async (input: { headline: string; bio: string; specializations: string[]; linkedin_url: string }) => {
      await requestMutation.mutateAsync(input);
    },
    [requestMutation],
  );

  const state = query.data ?? null;

  return {
    state,
    isLoading: query.isLoading,
    isError: query.isError,
    errorText: query.isError ? errorMessage(query.error, 'Impossible de charger votre statut partenaire') : null,
    refetch: () => { void query.refetch(); },
    isPartner: state?.status === 'active',
    canRequest: !!state?.can_request,
    requestPartner,
    isRequesting: requestMutation.isPending,
  };
};

// ---------------------------------------------------------------------------
// Missions ouvertes (partenaires)
// ---------------------------------------------------------------------------

export const useOpenHuntMissions = (enabled: boolean) => {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: [MARKETPLACE_KEY, 'open-missions', organizationId],
    queryFn: async (): Promise<OpenHuntMission[]> => {
      const { data, error } = await supabase.rpc('get_open_hunt_missions');
      if (error) throw error;
      return (data ?? []) as unknown as OpenHuntMission[];
    },
    enabled: enabled && !!organizationId,
    staleTime: 60 * 1000,
  });

  const applyMutation = useMutation({
    mutationFn: async ({ projectId, message }: { projectId: string; message?: string }) => {
      const cleaned = message?.trim() ?? '';
      const { error } = await supabase.rpc('apply_to_hunt_mission', {
        p_project_id: projectId,
        p_message: cleaned ? cleaned : null,
      });
      if (error) throw new Error(errorMessage(error, "La candidature n'a pas pu être envoyée"));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MARKETPLACE_KEY] });
      toast.success('Candidature envoyée');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const apply = useCallback(
    async (projectId: string, message?: string) => {
      await applyMutation.mutateAsync({ projectId, message });
    },
    [applyMutation],
  );

  return {
    missions: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    errorText: query.isError ? errorMessage(query.error, 'Impossible de charger les missions ouvertes') : null,
    refetch: () => { void query.refetch(); },
    apply,
    isApplying: applyMutation.isPending,
  };
};

// ---------------------------------------------------------------------------
// Mes candidatures (partenaires)
// ---------------------------------------------------------------------------

export const useMyHuntApplications = (enabled: boolean) => {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: [MARKETPLACE_KEY, 'my-applications', organizationId],
    queryFn: async (): Promise<MyHuntApplication[]> => {
      const { data, error } = await supabase.rpc('get_my_hunt_applications');
      if (error) throw error;
      return (data ?? []) as unknown as MyHuntApplication[];
    },
    enabled: enabled && !!organizationId,
    staleTime: 60 * 1000,
  });

  const withdrawMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const { error } = await supabase.rpc('withdraw_hunt_application', { p_application_id: applicationId });
      if (error) throw new Error(errorMessage(error, "La candidature n'a pas pu être retirée"));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MARKETPLACE_KEY] });
      toast.success('Candidature retirée');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const withdraw = useCallback(
    async (applicationId: string) => {
      await withdrawMutation.mutateAsync(applicationId);
    },
    [withdrawMutation],
  );

  return {
    applications: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    errorText: query.isError ? errorMessage(query.error, 'Impossible de charger vos candidatures') : null,
    refetch: () => { void query.refetch(); },
    withdraw,
    isWithdrawing: withdrawMutation.isPending,
  };
};

// ---------------------------------------------------------------------------
// Missions en cours (partenaire accepté dans l'équipe d'une autre organisation)
// ---------------------------------------------------------------------------

export const usePartnerMissions = (enabled: boolean) => {
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: [MARKETPLACE_KEY, 'partner-missions', organizationId],
    queryFn: async (): Promise<PartnerMission[]> => {
      const { data, error } = await supabase.rpc('get_partner_missions');
      if (error) throw error;
      return (data ?? []) as unknown as PartnerMission[];
    },
    enabled: enabled && !!organizationId,
    staleTime: 60 * 1000,
  });

  return {
    missions: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    errorText: query.isError ? errorMessage(query.error, 'Impossible de charger vos missions partenaires') : null,
    refetch: () => { void query.refetch(); },
  };
};

// ---------------------------------------------------------------------------
// Missions publiées de mon organisation (entreprise)
// ---------------------------------------------------------------------------

export const useMyHuntMissions = (enabled: boolean) => {
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: [MARKETPLACE_KEY, 'my-hunt-missions', organizationId],
    queryFn: async (): Promise<MyHuntMission[]> => {
      const { data, error } = await supabase.rpc('get_my_hunt_missions');
      if (error) throw error;
      return (data ?? []) as unknown as MyHuntMission[];
    },
    enabled: enabled && !!organizationId,
    staleTime: 60 * 1000,
  });

  return {
    missions: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    errorText: query.isError ? errorMessage(query.error, 'Impossible de charger vos missions publiées') : null,
    refetch: () => { void query.refetch(); },
  };
};

// ---------------------------------------------------------------------------
// Candidatures reçues sur une mission (entreprise)
// ---------------------------------------------------------------------------

export const useHuntApplicants = (projectId: string | null | undefined, enabled: boolean) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [MARKETPLACE_KEY, 'applicants', projectId],
    queryFn: async (): Promise<HuntApplicant[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc('get_hunt_applicants', { p_project_id: projectId });
      if (error) throw error;
      return (data ?? []) as unknown as HuntApplicant[];
    },
    enabled: enabled && !!projectId,
    staleTime: 30 * 1000,
  });

  const invalidateAfterTeamChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [MARKETPLACE_KEY] });
    // L'acceptation peut faire passer hunt_status à in_progress et modifie
    // l'équipe mission : on rafraîchit les lectures qui les affichent.
    queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
    if (projectId) {
      queryClient.invalidateQueries({ queryKey: ['sourcing-project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['mission-team', projectId] });
    }
  }, [queryClient, projectId]);

  const respondMutation = useMutation({
    mutationFn: async ({ applicationId, decision }: { applicationId: string; decision: 'accepted' | 'rejected' }) => {
      const { error } = await supabase.rpc('respond_to_hunt_application', {
        p_application_id: applicationId,
        p_decision: decision,
      });
      if (error) throw new Error(errorMessage(error, "La réponse n'a pas pu être enregistrée"));
      return decision;
    },
    onSuccess: (decision) => {
      invalidateAfterTeamChange();
      toast.success(decision === 'accepted' ? 'Candidature acceptée' : 'Candidature refusée');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const endMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const { error } = await supabase.rpc('end_hunt_collaboration', { p_application_id: applicationId });
      if (error) throw new Error(errorMessage(error, "La collaboration n'a pas pu être terminée"));
    },
    onSuccess: () => {
      invalidateAfterTeamChange();
      toast.success('Collaboration terminée');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const respond = useCallback(
    async (applicationId: string, decision: 'accepted' | 'rejected') => {
      await respondMutation.mutateAsync({ applicationId, decision });
    },
    [respondMutation],
  );

  const endCollaboration = useCallback(
    async (applicationId: string) => {
      await endMutation.mutateAsync(applicationId);
    },
    [endMutation],
  );

  return {
    applicants: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    errorText: query.isError ? errorMessage(query.error, 'Impossible de charger les candidatures') : null,
    refetch: () => { void query.refetch(); },
    respond,
    endCollaboration,
    isResponding: respondMutation.isPending || endMutation.isPending,
  };
};

// ---------------------------------------------------------------------------
// Équipe mission avec noms (membres internes et recruteurs partenaires)
// ---------------------------------------------------------------------------

export const useMissionTeamProfiles = (projectId: string | null | undefined) => {
  const query = useQuery({
    queryKey: [MARKETPLACE_KEY, 'team-profiles', projectId],
    queryFn: async (): Promise<MissionTeamProfile[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc('get_mission_team_profiles', { p_project_id: projectId });
      if (error) throw error;
      return (data ?? []) as unknown as MissionTeamProfile[];
    },
    enabled: !!projectId,
    staleTime: 60 * 1000,
  });

  const profiles = useMemo(() => query.data ?? [], [query.data]);

  /**
   * Nom d'un membre de l'équipe. `fallback` sert tant que la RPC n'a pas
   * répondu, ou si elle échoue : l'appelant passe le nom qu'il connaît déjà
   * pour les membres de son organisation.
   */
  const getName = useCallback(
    (userId: string, fallback?: string): string => {
      const profile = profiles.find((p) => p.user_id === userId);
      const name = profile?.display_name?.trim();
      if (name) return name;
      const fromCaller = fallback?.trim();
      if (fromCaller) return fromCaller;
      return profile?.is_external ? 'Recruteur partenaire' : 'Membre';
    },
    [profiles],
  );

  return {
    profiles,
    isLoading: query.isLoading,
    getName,
  };
};

// ---------------------------------------------------------------------------
// Administration du cercle (edge function marketplace-admin)
// ---------------------------------------------------------------------------

export const usePlatformAdmin = () => {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  // Une seule requête whoami par session (staleTime 10 min) ; toute erreur
  // vaut « pas administrateur », sans toast : le panneau n'apparaît pas.
  const whoamiQuery = useQuery({
    queryKey: [MARKETPLACE_KEY, 'admin', 'whoami'],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await invokeEdgeFunction<{ is_platform_admin?: boolean }>('marketplace-admin', {
        action: 'whoami',
      });
      if (error) return false;
      return data?.is_platform_admin === true;
    },
    enabled: !!organizationId,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  const isPlatformAdmin = whoamiQuery.data === true;

  const partnersQuery = useQuery({
    queryKey: [MARKETPLACE_KEY, 'admin', 'partners'],
    queryFn: async (): Promise<PlatformPartner[]> => {
      const { data, error } = await invokeEdgeFunction<{ partners?: PlatformPartner[] }>('marketplace-admin', {
        action: 'list_partners',
      });
      if (error) throw error;
      return data?.partners ?? [];
    },
    enabled: isPlatformAdmin,
    staleTime: 60 * 1000,
  });

  const refresh = useCallback(async () => {
    await partnersQuery.refetch();
  }, [partnersQuery]);

  const statusMutation = useMutation({
    mutationFn: async ({ action, organizationId: targetOrgId }: {
      action: 'validate_partner' | 'suspend_partner';
      organizationId: string;
    }) => {
      const { error } = await invokeEdgeFunction<{ status?: string }>('marketplace-admin', {
        action,
        organization_id: targetOrgId,
      });
      if (error) throw error;
      return action;
    },
    onSuccess: (action) => {
      queryClient.invalidateQueries({ queryKey: [MARKETPLACE_KEY] });
      toast.success(action === 'validate_partner' ? 'Partenaire validé' : 'Partenaire suspendu');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const validate = useCallback(
    async (targetOrgId: string) => {
      await statusMutation.mutateAsync({ action: 'validate_partner', organizationId: targetOrgId });
    },
    [statusMutation],
  );

  const suspend = useCallback(
    async (targetOrgId: string) => {
      await statusMutation.mutateAsync({ action: 'suspend_partner', organizationId: targetOrgId });
    },
    [statusMutation],
  );

  return {
    isPlatformAdmin,
    isLoading: whoamiQuery.isLoading || (isPlatformAdmin && partnersQuery.isLoading),
    isError: partnersQuery.isError,
    errorText: partnersQuery.isError ? errorMessage(partnersQuery.error, 'Impossible de charger les demandes') : null,
    partners: partnersQuery.data ?? [],
    refresh,
    validate,
    suspend,
    isMutating: statusMutation.isPending,
  };
};

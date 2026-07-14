import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useAuthReady } from '@/hooks/useAuthReady';
import { toast } from 'sonner';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  logo_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'collaborator';
  created_at: string;
}

interface OrganizationInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
  token?: string | null;
  accepted_at?: string | null;
}

interface SendInvitationResult {
  success: boolean;
  invitation_id?: string | null;
  invitation_token?: string | null;
}

export const useOrganization = () => {
  const queryClient = useQueryClient();
  const { isReady, user } = useAuthReady();

  // Fetch current user's active organization
  const { data, isLoading } = useQuery({
    queryKey: ['active-organization', user?.id],
    queryFn: async () => {
      if (!user) return null;

      // Get profile with active_organization_id
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('active_organization_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError) {
        console.error('[useOrganization] profile fetch error:', profileError);
        return null;
      }

      let activeOrgId = profile?.active_organization_id;

      // 🔧 SAFETY NET (fix 2026-05-06) : si active_organization_id est null
      // (peut arriver après un bug trigger, bootstrap raté, ou reset),
      // on FALLBACK sur les orgs où l'user est déjà membre AVANT de
      // déclencher l'onboarding qui créerait une duplicate org.
      // Sans ce fallback, l'user redirigé vers /onboarding crée une
      // nouvelle org alors qu'il en avait déjà une → perte de tout
      // (crédits, missions, candidats, LinkedIn account...).
      if (!activeOrgId) {
        console.warn('[useOrganization] active_organization_id is null, checking memberships fallback...');
        const { data: memberships } = await supabase
          .from('organization_members')
          .select('organization_id, organizations(created_at)')
          .eq('user_id', user.id)
          .order('organizations(created_at)', { ascending: true });

        if (memberships && memberships.length > 0) {
          // Prend la PLUS ANCIENNE org où l'user est membre — typiquement
          // celle créée pendant l'onboarding initial, donc avec ses
          // données. Évite de prendre une nouvelle org de test/duplicate.
          activeOrgId = memberships[0].organization_id;
          console.warn(`[useOrganization] Recovered active org from memberships: ${activeOrgId} (${memberships.length} total)`);

          // Persiste pour pas re-faire le fallback à chaque mount
          await supabase
            .from('profiles')
            .upsert({ user_id: user.id, active_organization_id: activeOrgId }, { onConflict: 'user_id' });
        } else {
          // Vraiment aucune org → user nouveau → onboarding légitime
          return null;
        }
      }

      // Get organization details
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', activeOrgId)
        .single();

      if (orgError) return null;

      // Get user's role in org
      const { data: membership } = await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', org.id)
        .eq('user_id', user.id)
        .single();

      return {
        organization: org as Organization,
        role: (membership?.role || 'member') as OrganizationMember['role'],
      };
    },
    enabled: isReady && !!user,
    staleTime: 10 * 60 * 1000,
  });

  // Create organization mutation
  const createOrgMutation = useMutation({
    mutationFn: async ({
      name,
      slug,
      website,
      logoUrl,
    }: {
      name: string;
      slug: string;
      website?: string | null;
      logoUrl?: string | null;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const normalizedWebsite = website?.trim() || null;
      const normalizedLogoUrl = logoUrl?.trim() || null;

      const { data: org, error } = await supabase
        .from('organizations')
        .insert({
          name,
          slug,
          created_by: user.id,
          website: normalizedWebsite,
          logo_url: normalizedLogoUrl,
        })
        .select()
        .single();

      if (error) throw error;

      // The trigger auto-adds user as owner and sets active_organization_id
      // Ensure profile row exists and set active organization
      await supabase
        .from('profiles')
        .upsert({ user_id: user.id, active_organization_id: org.id }, { onConflict: 'user_id' });

      return org as Organization;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-organization'] });
      toast.success('Organisation créée avec succès');
    },
    onError: (err: Error) => {
      // Don't toast duplicate slug errors — handled in the form
      if (err.message?.includes('organizations_slug_key') || err.message?.includes('duplicate key')) return;
      toast.error(`Erreur: ${err.message}`);
    },
  });

  // Switch active organization
  const switchOrgMutation = useMutation({
    mutationFn: async (orgId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('profiles')
        .update({ active_organization_id: orgId })
        .eq('user_id', user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-organization'] });
    },
  });

  const orgType = ((data?.organization as any)?.org_type || null) as 'enterprise' | 'agency' | 'freelance' | null;

  return {
    organization: data?.organization || null,
    organizationId: data?.organization?.id || null,
    organizationName: data?.organization?.name || null,
    orgType,
    isEnterprise: orgType === 'enterprise',
    isAgency: orgType === 'agency',
    isFreelance: orgType === 'freelance',
    userRole: data?.role || null,
    isOwner: data?.role === 'owner',
    isAdmin: data?.role === 'owner' || data?.role === 'admin',
    isCollaborator: (data?.role as string) === 'collaborator',
    isLoading: !isReady || isLoading,
    needsOnboarding: isReady && !!user && !isLoading && data === null,
    createOrganization: createOrgMutation.mutateAsync,
    switchOrganization: switchOrgMutation.mutateAsync,
    isCreating: createOrgMutation.isPending,
  };
};

// Hook to list all organizations user belongs to
export const useUserOrganizations = () => {
  return useQuery({
    queryKey: ['user-organizations'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: memberships, error } = await supabase
        .from('organization_members')
        .select('organization_id, role')
        .eq('user_id', user.id);

      if (error || !memberships?.length) return [];

      const orgIds = memberships.map(m => m.organization_id);
      const { data: orgs } = await supabase
        .from('organizations')
        .select('*')
        .in('id', orgIds);

      return (orgs || []).map(org => ({
        ...org,
        role: memberships.find(m => m.organization_id === org.id)?.role || 'member',
      }));
    },
    staleTime: 10 * 60 * 1000,
  });
};

// Hook to manage organization members
export const useOrganizationMembers = (orgId: string | null) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel(`organization-invitations-${orgId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'organization_invitations',
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['org-invitations', orgId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['org-members', orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from('organization_members')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at');

      if (error) throw error;
      return data as unknown as OrganizationMember[];
    },
    enabled: !!orgId,
  });

  const inviteMember = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      if (!orgId) throw new Error('No organization');

      const { data, error } = await invokeEdgeFunction('send-team-invitation', {
        email: email.toLowerCase(),
        role,
        organization_id: orgId,
      });
      const result = (data ?? null) as SendInvitationResult | null;
      if (error || !result?.success) throw new Error((data as { error?: string } | null)?.error || 'Erreur lors de l\'envoi');
      return result;
    },
    onSuccess: async (data, variables) => {
      const optimisticInvitation: OrganizationInvitation = {
        id: data?.invitation_id || crypto.randomUUID(),
        email: variables.email.toLowerCase(),
        role: variables.role,
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        token: data?.invitation_token || data?.invitation_id || null,
        accepted_at: null,
      };

      queryClient.setQueryData<OrganizationInvitation[]>(['org-invitations', orgId], (current = []) => {
        const next = current.filter((invitation) => invitation.id !== optimisticInvitation.id);
        return [optimisticInvitation, ...next];
      });

      await queryClient.refetchQueries({ queryKey: ['org-invitations', orgId], type: 'active' });
      toast.success('Invitation envoyée par email');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const resendInvitation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      if (!orgId) throw new Error('No organization');

      const { data, error } = await invokeEdgeFunction('send-team-invitation', {
        email: email.toLowerCase(),
        role,
        organization_id: orgId,
        resend: true,
      });
      if (error || !data?.success) throw new Error(data?.error || 'Erreur lors du renvoi');
      return data;
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['org-invitations', orgId], type: 'active' });
      toast.success('Invitation renvoyée par email');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const cancelInvitation = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await supabase
        .from('organization_invitations')
        .delete()
        .eq('id', invitationId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['org-invitations', orgId], type: 'active' });
      toast.success('Invitation annulée');
    },
  });

  const { data: pendingInvitations = [] } = useQuery({
    queryKey: ['org-invitations', orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from('organization_invitations')
        .select('id, email, role, status, created_at, expires_at, token, accepted_at')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []) as OrganizationInvitation[];
    },
    enabled: !!orgId,
  });

  const updateRole = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: string }) => {
      // Jamais "owner" ni valeur arbitraire depuis le client
      const ASSIGNABLE_ROLES = ['admin', 'member', 'collaborator'];
      if (!ASSIGNABLE_ROLES.includes(role)) {
        throw new Error('Rôle invalide');
      }

      // .select() pour détecter un refus RLS : sans lui, un UPDATE bloqué
      // par la RLS renvoie un succès avec 0 ligne et l'échec est invisible.
      const { data, error } = await supabase
        .from('organization_members')
        .update({ role })
        .eq('id', memberId)
        .select('id');

      if (error) throw error;
      if (!data?.length) throw new Error('Modification refusée — droits insuffisants');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] });
      toast.success('Rôle mis à jour');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Impossible de mettre à jour le rôle');
    },
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { data, error } = await supabase
        .from('organization_members')
        .delete()
        .eq('id', memberId)
        .select('id');

      if (error) throw error;
      if (!data?.length) throw new Error('Suppression refusée — droits insuffisants');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] });
      toast.success('Membre retiré');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Impossible de retirer ce membre');
    },
  });

  return {
    members,
    isLoading,
    pendingInvitations,
    inviteMember: inviteMember.mutateAsync,
    isInviting: inviteMember.isPending,
    resendInvitation: resendInvitation.mutateAsync,
    isResendingInvitation: resendInvitation.isPending,
    cancelInvitation: cancelInvitation.mutateAsync,
    updateRole: updateRole.mutateAsync,
    removeMember: removeMember.mutateAsync,
  };
};

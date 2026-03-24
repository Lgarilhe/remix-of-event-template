import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
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
  role: 'owner' | 'admin' | 'member';
  created_at: string;
}

export const useOrganization = () => {
  const queryClient = useQueryClient();

  // Fetch current user's active organization
  const { data, isLoading, error } = useQuery({
    queryKey: ['active-organization'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // Get profile with active_organization_id
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('active_organization_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError || !profile?.active_organization_id) {
        return null;
      }

      // Get organization details
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', profile.active_organization_id)
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

  return {
    organization: data?.organization || null,
    organizationId: data?.organization?.id || null,
    organizationName: data?.organization?.name || null,
    userRole: data?.role || null,
    isOwner: data?.role === 'owner',
    isAdmin: data?.role === 'owner' || data?.role === 'admin',
    isLoading,
    needsOnboarding: !isLoading && data === null,
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
      return data as OrganizationMember[];
    },
    enabled: !!orgId,
  });

  const inviteMember = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      if (!orgId) throw new Error('No organization');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('organization_invitations')
        .insert({
          organization_id: orgId,
          email: email.toLowerCase(),
          role,
          invited_by: user.id,
        });

      if (error) {
        if (error.code === '23505') throw new Error('Une invitation est déjà en cours pour cet email');
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-invitations', orgId] });
      toast.success('Invitation envoyée');
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-invitations', orgId] });
      toast.success('Invitation annulée');
    },
  });

  const { data: pendingInvitations = [] } = useQuery({
    queryKey: ['org-invitations', orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from('organization_invitations')
        .select('*')
        .eq('organization_id', orgId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });

  const updateRole = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: string }) => {
      const { error } = await supabase
        .from('organization_members')
        .update({ role })
        .eq('id', memberId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] });
      toast.success('Rôle mis à jour');
    },
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from('organization_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] });
      toast.success('Membre retiré');
    },
  });

  return {
    members,
    isLoading,
    pendingInvitations,
    inviteMember: inviteMember.mutateAsync,
    isInviting: inviteMember.isPending,
    cancelInvitation: cancelInvitation.mutateAsync,
    updateRole: updateRole.mutateAsync,
    removeMember: removeMember.mutateAsync,
  };
};

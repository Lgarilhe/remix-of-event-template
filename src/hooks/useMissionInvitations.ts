import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { toast } from 'sonner';

const db = supabase as any;

export interface MissionInvitation {
  id: string;
  project_id: string;
  organization_id: string;
  email: string;
  role: string;
  token: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  invited_by: string;
  accepted_by: string | null;
  message: string | null;
  created_at: string;
  accepted_at: string | null;
  expires_at: string | null;
}

export const useMissionInvitations = (projectId: string | undefined) => {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  const { data: invitations = [], isLoading } = useQuery({
    queryKey: ['mission-invitations', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await db
        .from('mission_invitations')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as MissionInvitation[];
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });

  const sendInvitation = useMutation({
    mutationFn: async (input: { email: string; role?: string; message?: string }) => {
      if (!projectId || !organizationId) throw new Error('Missing context');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await db
        .from('mission_invitations')
        .insert({
          project_id: projectId,
          organization_id: organizationId,
          email: input.email.toLowerCase().trim(),
          role: input.role || 'freelance',
          invited_by: user.id,
          message: input.message || null,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505' || error.message?.includes('duplicate')) {
          throw new Error('Cette personne a déjà été invitée sur cette mission');
        }
        throw error;
      }
      return data as MissionInvitation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mission-invitations', projectId] });
      toast.success('Invitation envoyée');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const cancelInvitation = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await db
        .from('mission_invitations')
        .delete()
        .eq('id', invitationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mission-invitations', projectId] });
      toast.success('Invitation annulée');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return {
    invitations,
    isLoading,
    sendInvitation: sendInvitation.mutateAsync,
    isSending: sendInvitation.isPending,
    cancelInvitation: cancelInvitation.mutateAsync,
  };
};

/** Hook for the invited freelance to accept/reject an invitation */
export const useAcceptMissionInvitation = () => {
  const accept = async (token: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Connectez-vous pour accepter l\'invitation');

      // Get invitation
      const { data: invitation, error: fetchErr } = await db
        .from('mission_invitations')
        .select('*')
        .eq('token', token)
        .eq('status', 'pending')
        .maybeSingle();

      if (fetchErr || !invitation) throw new Error('Invitation introuvable ou expirée');

      // Check expiration
      if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
        await db.from('mission_invitations').update({ status: 'expired' }).eq('id', invitation.id);
        throw new Error('Cette invitation a expiré');
      }

      // Add to mission_team
      const { error: teamErr } = await db
        .from('mission_team')
        .insert({
          project_id: invitation.project_id,
          user_id: user.id,
          role: invitation.role,
        });

      if (teamErr) {
        if (teamErr.code === '23505') {
          // Already a member — just mark invitation as accepted
        } else {
          throw teamErr;
        }
      }

      // Mark invitation as accepted
      await db
        .from('mission_invitations')
        .update({
          status: 'accepted',
          accepted_by: user.id,
          accepted_at: new Date().toISOString(),
        })
        .eq('id', invitation.id);

      toast.success('Invitation acceptée — vous avez accès à la mission');
      return invitation.project_id;
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de l\'acceptation');
      return null;
    }
  };

  return { accept };
};

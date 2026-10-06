import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
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
    mutationFn: async (input: { email: string; role?: string; message?: string; missionName?: string }) => {
      if (!projectId || !organizationId) throw new Error('Missing context');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Create invitation record in DB
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

      const invitation = data as MissionInvitation;

      // 2. Get inviter profile name + org name for the email
      const { data: profile } = await supabase.from('profiles').select('display_name').eq('user_id', user.id).maybeSingle();
      const { data: org } = await supabase.from('organizations').select('name').eq('id', organizationId).maybeSingle();

      // 3. Send email via send-transactional-email edge function
      const inviteUrl = `${window.location.origin}/mission-invite/${invitation.token}`;
      try {
        await invokeEdgeFunction('send-transactional-email', {
          templateName: 'mission-invitation',
          recipientEmail: input.email.toLowerCase().trim(),
          invitationId: invitation.id,
          idempotencyKey: `mission-invite-${invitation.id}`,
          templateData: {
            inviterName: profile?.display_name || user.email,
            organizationName: org?.name || null,
            missionName: input.missionName || 'Recrutement',
            role: input.role || 'freelance',
            message: input.message || null,
            inviteUrl,
          },
        });
      } catch (emailErr) {
        // Email failed but invitation was created — don't fail the whole operation
        console.warn('Mission invitation email failed:', emailErr);
      }

      return invitation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mission-invitations', projectId] });
      toast.success('Invitation envoyée par email');
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

/**
 * Issue d'une acceptation. `status` est le code HTTP de la fonction : 410
 * invitation expirée, 403 autre adresse ou invitation invalide, 404 lien déjà
 * utilisé ou inconnu, 401 session ; null quand le serveur n'a pas répondu.
 */
export type AcceptMissionInvitationResult =
  | { ok: true; projectId: string | null; alreadyMember: boolean }
  | { ok: false; status: number | null; message: string };

/** Hook for the invited freelance to accept an invitation */
export const useAcceptMissionInvitation = () => {
  // Mémorisée : la page l'appelle depuis un effet. Recréée à chaque rendu, elle
  // relançait l'acceptation après un succès et le second appel échouait (B-01).
  // Pas de toast ici : la page affiche un message par cause.
  const accept = useCallback(async (token: string): Promise<AcceptMissionInvitationResult> => {
    // Server-side acceptance: verifies token, expiration and that the
    // invitation email matches the logged-in user, then adds to mission_team.
    const { data, error } = await invokeEdgeFunction<{ project_id?: string; already_member?: boolean }>(
      'accept-mission-invitation',
      { token }
    );

    if (error || !data?.success) {
      return { ok: false, status: error?.status ?? null, message: data?.error || error?.message || '' };
    }
    return { ok: true, projectId: data.project_id ?? null, alreadyMember: data.already_member === true };
  }, []);

  return { accept };
};

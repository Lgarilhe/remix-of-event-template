import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

export interface PendingInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
  organization?: { name: string };
}

export const usePendingInvitations = () => {
  const queryClient = useQueryClient();

  const { data: invitations = [], isLoading } = useQuery({
    queryKey: ['my-pending-invitations'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) return [];

      const { data, error } = await supabase
        .from('organization_invitations')
        .select('*')
        .eq('email', user.email.toLowerCase())
        .eq('status', 'pending');

      if (error || !data?.length) return [];

      // Fetch org names
      const orgIds = [...new Set(data.map(i => i.organization_id))];
      const { data: orgs } = await supabase
        .from('organizations')
        .select('id, name')
        .in('id', orgIds);

      return data.map(inv => ({
        ...inv,
        organization: orgs?.find(o => o.id === inv.organization_id),
      })) as PendingInvitation[];
    },
    staleTime: 2 * 60 * 1000,
  });

  const acceptInvitation = useMutation({
    mutationFn: async (invitationId: string) => {
      const { data, error } = await invokeEdgeFunction('accept-invitation', {
        invitation_id: invitationId,
      });
      if (error || !data?.success) throw new Error(data?.error || 'Erreur');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-pending-invitations'] });
      queryClient.invalidateQueries({ queryKey: ['active-organization'] });
      queryClient.invalidateQueries({ queryKey: ['user-organizations'] });
      toast.success('Invitation acceptée !');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return {
    invitations,
    isLoading,
    acceptInvitation: acceptInvitation.mutateAsync,
    isAccepting: acceptInvitation.isPending,
  };
};

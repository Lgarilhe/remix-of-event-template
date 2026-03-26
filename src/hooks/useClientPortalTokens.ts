import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface ClientPortalToken {
  id: string;
  organization_id: string;
  client_name: string;
  client_email: string | null;
  token: string;
  project_ids: string[] | null;
  permissions: {
    can_comment: boolean;
    can_see_names: boolean;
    can_fill_scorecard: boolean;
  };
  expires_at: string | null;
  created_at: string;
  last_accessed_at: string | null;
}

export const useClientPortalTokens = () => {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['client-portal-tokens', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('client_portal_tokens')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ClientPortalToken[];
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const createToken = useMutation({
    mutationFn: async (input: { client_name: string; client_email?: string; project_ids?: string[] }) => {
      if (!organizationId) throw new Error('No organization');
      const { data, error } = await supabase
        .from('client_portal_tokens')
        .insert({
          organization_id: organizationId,
          client_name: input.client_name,
          client_email: input.client_email || null,
          project_ids: input.project_ids || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as ClientPortalToken;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-portal-tokens', organizationId] });
      toast.success('Lien portail client créé');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteToken = useMutation({
    mutationFn: async (tokenId: string) => {
      const { error } = await supabase
        .from('client_portal_tokens')
        .delete()
        .eq('id', tokenId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-portal-tokens', organizationId] });
      toast.success('Accès client révoqué');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return {
    tokens,
    isLoading,
    createToken: createToken.mutateAsync,
    isCreating: createToken.isPending,
    deleteToken: deleteToken.mutateAsync,
  };
};

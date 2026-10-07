import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { toast } from 'sonner';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useAuthReady } from './useAuthReady';

export interface MemberEmailMapping {
  id: string;
  organization_id: string;
  user_id: string;
  email_account_id: string;
  email_address: string | null;
  provider: string | null;
  account_status: string | null;
  linked_at: string | null;
  linked_by: string;
}

export function useMemberEmailAccounts() {
  const { organizationId } = useOrganization();
  const { user, isReady } = useAuthReady();
  const queryClient = useQueryClient();

  const { data: mappings = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['member-email-accounts', organizationId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_email_accounts')
        .select('*')
        .eq('organization_id', organizationId!);
      if (error) throw error;
      return data || [];
    },
    enabled: isReady && !!user && !!organizationId,
  });

  const unlinkAccount = useMutation({
    mutationFn: async ({ mappingId, expectedAccountId }: { mappingId: string; expectedAccountId: string }) => {
      const { data, error } = await invokeEdgeFunction('unipile-accounts', {
        action: 'unlink_email_account',
        organization_id: organizationId,
        mapping_id: mappingId,
        expected_account_id: expectedAccountId,
      });
      if (error) throw error;
      if (!data?.success) throw new Error('La dissociation n’a pas été enregistrée');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-email-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-actions'] });
      queryClient.invalidateQueries({ queryKey: ['assistant-email-connector'] });
      queryClient.invalidateQueries({ queryKey: ['multichannel-inbox'] });
      toast.success('Compte e-mail dissocié');
    },
    onError: () => toast.error("Le compte e-mail n'a pas été dissocié", { description: 'Réessayez dans un instant.' }),
  });

  const getMappingForUser = (userId: string) =>
    mappings.find(m => m.user_id === userId) || null;

  const getMappingForAccount = (accountId: string) =>
    mappings.find(m => m.email_account_id === accountId) || null;

  const getUserEmailAccountId = (userId: string): string | null =>
    getMappingForUser(userId)?.email_account_id || null;

  return {
    mappings,
    isLoading,
    /** Lecture des associations en échec : ni « relié » ni « non relié » ne sont sûrs. */
    isError,
    refetch,
    unlinkAccount: unlinkAccount.mutate,
    isUnlinking: unlinkAccount.isPending,
    getMappingForUser,
    getMappingForAccount,
    getUserEmailAccountId,
  };
}

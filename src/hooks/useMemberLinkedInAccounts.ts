import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { toast } from 'sonner';

export interface MemberLinkedInMapping {
  id: string;
  organization_id: string;
  user_id: string;
  linkedin_account_id: string;
  linkedin_account_name: string | null;
  linked_at: string;
  linked_by: string;
  proxy_country: string | null;
  proxy_updated_at: string | null;
  proxy_mode: string | null;
  proxy_host: string | null;
  proxy_port: number | null;
  proxy_protocol: string | null;
  proxy_last_error: string | null;
  proxy_is_active: boolean | null;
}

export function useMemberLinkedInAccounts() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const { data: mappings = [], isLoading } = useQuery({
    queryKey: ['member-linkedin-accounts', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_linkedin_accounts')
        .select('*')
        .eq('organization_id', organizationId!);
      if (error) throw error;
      return (data || []) as MemberLinkedInMapping[];
    },
    enabled: !!organizationId,
  });

  const linkAccount = useMutation({
    mutationFn: async ({ userId, linkedinAccountId, linkedinAccountName }: {
      userId: string;
      linkedinAccountId: string;
      linkedinAccountName?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      const { error } = await supabase.from('member_linkedin_accounts').upsert({
        organization_id: organizationId!,
        user_id: userId,
        linkedin_account_id: linkedinAccountId,
        linkedin_account_name: linkedinAccountName || null,
        linked_by: user.id,
      }, { onConflict: 'organization_id,user_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-linkedin-accounts'] });
      toast.success('Compte LinkedIn associé');
    },
    onError: (err: Error) => {
      const msg = err.message || '';
      if (msg.includes('CROSS_TENANT_VIOLATION') || msg.includes('already mapped to another organization')) {
        toast.error('Ce compte LinkedIn appartient à une autre organisation', {
          description: 'Pour des raisons de sécurité, un compte LinkedIn ne peut être associé qu\'à une seule organisation Konekt. Contactez le support si nécessaire.',
        });
      } else if (msg.includes('duplicate') || msg.includes('unique')) {
        toast.error('Ce compte LinkedIn est déjà associé à un autre membre');
      } else {
        toast.error('Erreur lors de l\'association', { description: msg });
      }
    },
  });

  const unlinkAccount = useMutation({
    mutationFn: async (mappingId: string) => {
      const { error } = await supabase
        .from('member_linkedin_accounts')
        .delete()
        .eq('id', mappingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-linkedin-accounts'] });
      toast.success('Association LinkedIn retirée');
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  });

  const getMappingForUser = (userId: string) =>
    mappings.find(m => m.user_id === userId) || null;

  const getMappingForAccount = (accountId: string) =>
    mappings.find(m => m.linkedin_account_id === accountId) || null;

  const getUserLinkedAccountId = (userId: string): string | null =>
    getMappingForUser(userId)?.linkedin_account_id || null;

  return {
    mappings,
    isLoading,
    linkAccount: linkAccount.mutate,
    unlinkAccount: unlinkAccount.mutate,
    isLinking: linkAccount.isPending,
    getMappingForUser,
    getMappingForAccount,
    getUserLinkedAccountId,
  };
}

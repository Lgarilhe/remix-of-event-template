import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { toast } from 'sonner';

export interface MemberEmailMapping {
  id: string;
  organization_id: string;
  user_id: string;
  email_account_id: string;
  email_address: string | null;
  provider: string | null;
  account_status: string | null;
  linked_at: string;
  linked_by: string;
}

export function useMemberEmailAccounts() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const { data: mappings = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['member-email-accounts', organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('member_email_accounts')
        .select('*')
        .eq('organization_id', organizationId!) as unknown as Promise<{ data: MemberEmailMapping[] | null; error: unknown }>);
      if (error) throw error;
      return (data || []) as MemberEmailMapping[];
    },
    enabled: !!organizationId,
  });

  const linkAccount = useMutation({
    mutationFn: async ({ userId, emailAccountId, emailAddress, provider }: {
      userId: string;
      emailAccountId: string;
      emailAddress?: string;
      provider?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      const { error } = await (supabase.from('member_email_accounts').upsert({
        organization_id: organizationId!,
        user_id: userId,
        email_account_id: emailAccountId,
        email_address: emailAddress || null,
        provider: provider || null,
        linked_by: user.id,
      }, { onConflict: 'organization_id,email_account_id' }) as unknown as Promise<{ error: unknown }>);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-email-accounts'] });
      toast.success('Compte e-mail associé');
    },
    onError: (err: Error) => {
      if (err.message?.includes('duplicate') || err.message?.includes('unique')) {
        toast.error('Ce compte e-mail est déjà associé à un autre membre');
      } else {
        toast.error("Le compte e-mail n'a pas été associé", { description: 'Réessayez dans un instant.' });
      }
    },
  });

  const unlinkAccount = useMutation({
    mutationFn: async (mappingId: string) => {
      const { error } = await (supabase
        .from('member_email_accounts')
        .delete()
        .eq('id', mappingId) as unknown as Promise<{ error: unknown }>);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-email-accounts'] });
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
    linkAccount: linkAccount.mutate,
    unlinkAccount: unlinkAccount.mutate,
    isLinking: linkAccount.isPending,
    getMappingForUser,
    getMappingForAccount,
    getUserEmailAccountId,
  };
}

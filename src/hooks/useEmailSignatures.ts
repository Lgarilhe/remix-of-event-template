import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { toast } from 'sonner';

export interface EmailSignature {
  id: string;
  organization_id: string;
  name: string;
  content: string;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useEmailSignatures() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const { data: signatures = [], isLoading } = useQuery({
    queryKey: ['email-signatures', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('email_signatures')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as EmailSignature[];
    },
    enabled: !!organizationId,
  });

  const createSignature = useMutation({
    mutationFn: async (input: { name: string; content: string; is_default?: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !organizationId) throw new Error('Non authentifié');

      // If setting as default, unset other defaults first
      if (input.is_default) {
        await supabase
          .from('email_signatures')
          .update({ is_default: false } as any)
          .eq('organization_id', organizationId);
      }

      const { data, error } = await supabase
        .from('email_signatures')
        .insert({
          organization_id: organizationId,
          name: input.name,
          content: input.content,
          is_default: input.is_default || false,
          created_by: user.id,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-signatures'] });
      toast.success('Signature créée');
    },
    onError: () => toast.error('Erreur lors de la création'),
  });

  const updateSignature = useMutation({
    mutationFn: async (input: { id: string; name?: string; content?: string; is_default?: boolean }) => {
      if (!organizationId) throw new Error('No org');

      if (input.is_default) {
        await supabase
          .from('email_signatures')
          .update({ is_default: false } as any)
          .eq('organization_id', organizationId);
      }

      const { id, ...updates } = input;
      const { error } = await supabase
        .from('email_signatures')
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-signatures'] });
      toast.success('Signature mise à jour');
    },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  });

  const deleteSignature = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('email_signatures')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-signatures'] });
      toast.success('Signature supprimée');
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  });

  const getDefault = () => signatures.find(s => s.is_default) || null;

  return {
    signatures,
    isLoading,
    createSignature,
    updateSignature,
    deleteSignature,
    getDefault,
  };
}

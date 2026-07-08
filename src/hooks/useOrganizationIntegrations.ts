import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { toast } from 'sonner';

export interface OrganizationIntegrations {
  id: string;
  organization_id: string;
  notion_api_key: string | null;
  notion_postes_db_id: string | null;
  notion_candidats_db_id: string | null;
  notion_shortlist_db_id: string | null;
  notion_connected: boolean;
  calendly_api_key: string | null;
  calendly_connected: boolean;
  unipile_dsn: string | null;
  unipile_api_key: string | null;
  unipile_connected: boolean;
  airtable_api_key: string | null;
  airtable_base_id: string | null;
  airtable_base_id_2: string | null;
  airtable_connected: boolean;
  aircall_api_id: string | null;
  aircall_api_token: string | null;
  aircall_connected: boolean;
  coresignal_api_key: string | null;
  coresignal_enabled: boolean;
}

export const useOrganizationIntegrations = () => {
  const { organizationId, isAdmin } = useOrganization();
  const queryClient = useQueryClient();

  const { data: integrations, isLoading } = useQuery({
    queryKey: ['org-integrations', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const { data, error } = await supabase
        .from('organization_integrations')
        .select('*')
        .eq('organization_id', organizationId)
        .single();

      if (error) {
        // If no row exists, create one
        if (error.code === 'PGRST116') {
          const { data: newRow, error: insertError } = await supabase
            .from('organization_integrations')
            .insert({ organization_id: organizationId })
            .select()
            .single();
          if (insertError) throw insertError;
          return newRow as unknown as OrganizationIntegrations;
        }
        throw error;
      }
      return data as unknown as OrganizationIntegrations;
    },
    enabled: !!organizationId && isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const updateIntegration = useMutation({
    mutationFn: async (updates: Partial<OrganizationIntegrations>) => {
      if (!organizationId) throw new Error('No organization');
      const { error } = await supabase
        .from('organization_integrations')
        .update(updates)
        .eq('organization_id', organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-integrations', organizationId] });
      toast.success('Intégration mise à jour');
    },
    onError: (err: Error) => {
      toast.error(`Erreur: ${err.message}`);
    },
  });

  return {
    integrations,
    isLoading,
    updateIntegration: updateIntegration.mutateAsync,
    isUpdating: updateIntegration.isPending,
  };
};

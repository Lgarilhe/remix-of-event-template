import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getActiveOrganizationId } from '@/lib/orgContext';
import { toast } from 'sonner';

export interface ICPCriteria {
  industries?: string[];
  company_sizes?: string[];
  target_titles?: string[];
  geographies?: string[];
  technologies?: string[];
  keywords?: string[];
  exclusion_keywords?: string[];
  experience_range?: { min?: number; max?: number };
  funding_stages?: string[];
  languages?: string[];
  seniority_levels?: string[];
  school_types?: string[];
  revenue_range?: string;
  custom_fields?: { label: string; values: string[] }[];
}

export interface ICP {
  id: string;
  name: string;
  description: string | null;
  target_type: 'client' | 'candidate' | 'both';
  criteria: ICPCriteria;
  is_active: boolean;
  organization_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type ICPInsert = Omit<ICP, 'id' | 'created_at' | 'updated_at'>;

export function useICPs() {
  const queryClient = useQueryClient();

  const { data: icps = [], isLoading } = useQuery({
    queryKey: ['icps'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prospection_icps')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as unknown as ICP[];
    },
  });

  const createICP = useMutation({
    mutationFn: async (icp: Omit<ICPInsert, 'created_by' | 'organization_id'>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      const orgId = await getActiveOrganizationId();

      const { data, error } = await supabase
        .from('prospection_icps')
        .insert({
          ...icp,
          criteria: icp.criteria as any,
          created_by: user.id,
          organization_id: orgId,
        })
        .select()
        .single();

      if (error) throw error;
      return data as unknown as ICP;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['icps'] });
      toast.success('ICP créé avec succès');
    },
    onError: (err: Error) => {
      toast.error('Erreur lors de la création: ' + err.message);
    },
  });

  const updateICP = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ICP> & { id: string }) => {
      const { data, error } = await supabase
        .from('prospection_icps')
        .update({ ...updates, criteria: updates.criteria as any, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as ICP;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['icps'] });
      toast.success('ICP mis à jour');
    },
    onError: (err: Error) => {
      toast.error('Erreur: ' + err.message);
    },
  });

  const deleteICP = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('prospection_icps')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['icps'] });
      toast.success('ICP supprimé');
    },
    onError: (err: Error) => {
      toast.error('Erreur: ' + err.message);
    },
  });

  return { icps, isLoading, createICP, updateICP, deleteICP };
}

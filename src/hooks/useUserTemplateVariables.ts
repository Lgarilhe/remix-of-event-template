/**
 * useUserTemplateVariables — CRUD des variables custom user pour templates.
 *
 * Permet à l'user de définir ses PROPRES variables (ex: {{lien_demo}},
 * {{prix_offre}}, {{nom_produit}}) à utiliser dans les message_templates.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useAuthReady } from './useAuthReady';
import { toast } from 'sonner';

export interface UserTemplateVariable {
  id: string;
  user_id: string;
  organization_id: string;
  key: string;
  value: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export type CreateVariableInput = Pick<UserTemplateVariable, 'key' | 'value' | 'description'>;
export type UpdateVariableInput = Partial<CreateVariableInput> & { id: string };

export function useUserTemplateVariables() {
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  const queryClient = useQueryClient();
  const queryKey = ['user-template-variables', user?.id];

  const { data: variables = [], isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<UserTemplateVariable[]> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('user_template_variables')
        .select('*')
        .eq('user_id', user.id)
        .order('key', { ascending: true });
      if (error) throw error;
      return (data || []) as UserTemplateVariable[];
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const create = useMutation({
    mutationFn: async (input: CreateVariableInput): Promise<UserTemplateVariable> => {
      if (!user?.id || !organizationId) throw new Error('Non authentifié');
      const { data, error } = await supabase
        .from('user_template_variables')
        .insert({
          ...input,
          user_id: user.id,
          organization_id: organizationId,
        })
        .select()
        .single();
      if (error) throw error;
      return data as UserTemplateVariable;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Variable créée');
    },
    onError: (err: Error) => {
      const msg = err.message?.includes('user_template_variables_key_format')
        ? 'Le nom doit être en lettres minuscules, chiffres et underscores (ex: lien_demo)'
        : err.message?.includes('user_template_variables_user_key_unique')
        ? 'Cette variable existe déjà'
        : err.message;
      toast.error('Erreur création variable', { description: msg });
    },
  });

  const update = useMutation({
    mutationFn: async (input: UpdateVariableInput): Promise<UserTemplateVariable> => {
      const { id, ...updates } = input;
      const { data, error } = await supabase
        .from('user_template_variables')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as UserTemplateVariable;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Variable mise à jour');
    },
    onError: (err: Error) => {
      toast.error('Erreur modification', { description: err.message });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from('user_template_variables').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Variable supprimée');
    },
    onError: (err: Error) => {
      toast.error('Erreur suppression', { description: err.message });
    },
  });

  /** Map clé → valeur, prête à passer dans buildPlaceholderContext */
  const asMap = (): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const v of variables) {
      map[v.key] = v.value;
    }
    return map;
  };

  return {
    variables,
    asMap,
    isLoading,
    create: create.mutate,
    update: update.mutate,
    remove: remove.mutate,
  };
}

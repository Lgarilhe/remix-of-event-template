/**
 * useMessageTemplates — CRUD des templates de messages personnalisés.
 *
 * Stockage : table `message_templates` (per-user, RLS strict).
 * Cache : React Query, 5min staleTime, invalidation après mutations.
 *
 * Features :
 *  - getAll → liste des templates de l'user, triés par fréquence d'usage
 *  - create / update / delete
 *  - useTemplate(id) → marque comme utilisé (incrémente usage_count, met à jour last_used_at)
 *  - findByShortcut(shortcut) → résout un slash command "/intro" en template
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useAuthReady } from './useAuthReady';
import { toast } from 'sonner';

export interface MessageTemplate {
  id: string;
  user_id: string;
  organization_id: string;
  name: string;
  shortcut: string | null;
  emoji: string | null;
  category: string | null;
  content: string;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CreateTemplateInput = Omit<
  MessageTemplate,
  'id' | 'user_id' | 'organization_id' | 'usage_count' | 'last_used_at' | 'created_at' | 'updated_at'
>;

export type UpdateTemplateInput = Partial<CreateTemplateInput> & { id: string };

export function useMessageTemplates() {
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  const queryClient = useQueryClient();
  const queryKey = ['message-templates', user?.id];

  const { data: templates = [], isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<MessageTemplate[]> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .eq('user_id', user.id)
        .order('last_used_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as MessageTemplate[];
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const create = useMutation({
    mutationFn: async (input: CreateTemplateInput): Promise<MessageTemplate> => {
      if (!user?.id || !organizationId) throw new Error('Non authentifié');
      const { data, error } = await supabase
        .from('message_templates')
        .insert({
          ...input,
          user_id: user.id,
          organization_id: organizationId,
        })
        .select()
        .single();
      if (error) throw error;
      return data as MessageTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Template créé');
    },
    onError: (err: Error) => {
      toast.error('Erreur création template', { description: err.message });
    },
  });

  const update = useMutation({
    mutationFn: async (input: UpdateTemplateInput): Promise<MessageTemplate> => {
      const { id, ...updates } = input;
      const { data, error } = await supabase
        .from('message_templates')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as MessageTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Template mis à jour');
    },
    onError: (err: Error) => {
      toast.error('Erreur modification', { description: err.message });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from('message_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Template supprimé');
    },
    onError: (err: Error) => {
      toast.error('Erreur suppression', { description: err.message });
    },
  });

  /** Marque un template comme utilisé (incrémente usage_count + last_used_at) */
  const markUsed = async (id: string) => {
    const tpl = templates.find(t => t.id === id);
    if (!tpl) return;
    try {
      await supabase
        .from('message_templates')
        .update({
          usage_count: tpl.usage_count + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq('id', id);
      // Pas d'invalidation : on update silencieusement, le re-fetch suivant aura les bonnes valeurs
    } catch (e) {
      console.warn('[useMessageTemplates] markUsed failed:', e);
    }
  };

  /** Trouve un template par son shortcut (ex: "/intro") */
  const findByShortcut = (shortcut: string): MessageTemplate | undefined => {
    if (!shortcut) return undefined;
    const normalized = shortcut.startsWith('/') ? shortcut : `/${shortcut}`;
    return templates.find(t => t.shortcut === normalized);
  };

  return {
    templates,
    isLoading,
    create: create.mutate,
    update: update.mutate,
    remove: remove.mutate,
    markUsed,
    findByShortcut,
  };
}

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useMessageActions(organizationId: string | null) {
  const [isReacting, setIsReacting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const invoke = useCallback(async (action: string, params: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error('Session expirée');
      return null;
    }
    const { data, error } = await supabase.functions.invoke('unipile-accounts', {
      body: { action, organization_id: organizationId, ...params },
    });
    if (error) {
      // Try to extract body from context
      try {
        const ctx = (error as any).context;
        if (ctx instanceof Response) {
          const body = await ctx.json();
          return { success: false, error: body.error || error.message };
        }
      } catch {}
      return { success: false, error: error.message };
    }
    return data;
  }, [organizationId]);

  const addReaction = useCallback(async (messageId: string, reaction: string): Promise<boolean> => {
    setIsReacting(true);
    try {
      const res = await invoke('add_reaction', { message_id: messageId, reaction });
      if (res?.success) {
        toast.success('Réaction envoyée');
        return true;
      }
      toast.error(res?.error || 'Erreur lors de l\'ajout de la réaction');
      return false;
    } finally {
      setIsReacting(false);
    }
  }, [invoke]);

  const deleteMessage = useCallback(async (messageId: string): Promise<boolean> => {
    setIsDeleting(true);
    try {
      const res = await invoke('delete_message', { message_id: messageId });
      if (res?.success) {
        toast.success('Message supprimé');
        return true;
      }
      toast.error(res?.error || 'Impossible de supprimer le message');
      return false;
    } finally {
      setIsDeleting(false);
    }
  }, [invoke]);

  const deleteChat = useCallback(async (chatId: string): Promise<boolean> => {
    setIsDeleting(true);
    try {
      const res = await invoke('delete_chat', { chat_id: chatId });
      if (res?.success) {
        toast.success('Conversation supprimée');
        return true;
      }
      toast.error(res?.error || 'Impossible de supprimer la conversation');
      return false;
    } finally {
      setIsDeleting(false);
    }
  }, [invoke]);

  return { addReaction, deleteMessage, deleteChat, isReacting, isDeleting };
}

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';

export type ChatCategory = 'interested' | 'not_interested' | 'to_recontact' | 'no_response';

export interface ChatCategoryInfo {
  label: string;
  emoji: string;
  color: string;
}

export const CHAT_CATEGORIES: Record<ChatCategory, ChatCategoryInfo> = {
  interested: { label: 'Intéressé', emoji: '🟢', color: 'text-green-600 bg-green-100 border-green-300' },
  not_interested: { label: 'Pas intéressé', emoji: '🔴', color: 'text-red-600 bg-red-100 border-red-300' },
  to_recontact: { label: 'À recontacter', emoji: '🟡', color: 'text-yellow-600 bg-yellow-100 border-yellow-300' },
  no_response: { label: 'Sans réponse', emoji: '⚪', color: 'text-muted-foreground bg-muted border-muted-foreground/20' },
};

export function useChatCategories() {
  const [categoriesMap, setCategoriesMap] = useState<Map<string, ChatCategory>>(new Map());
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<ChatCategory | 'all'>('all');
  const { organizationId } = useOrganization();

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      const { data, error } = await supabase
        .from('chat_categories')
        .select('chat_id, category')
        .eq('created_by', user.user.id);

      if (error) throw error;

      const map = new Map<string, ChatCategory>();
      data?.forEach(row => {
        map.set(row.chat_id, row.category as ChatCategory);
      });
      setCategoriesMap(map);
    } catch (error) {
      console.error('Error fetching chat categories:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const setCategory = useCallback(async (chatId: string, accountId: string, category: ChatCategory | null) => {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      if (category === null) {
        // Remove category
        await supabase
          .from('chat_categories')
          .delete()
          .eq('chat_id', chatId)
          .eq('created_by', user.user.id);

        setCategoriesMap(prev => {
          const next = new Map(prev);
          next.delete(chatId);
          return next;
        });
      } else {
        // Upsert category
        const { error } = await supabase
          .from('chat_categories')
          .upsert({
            chat_id: chatId,
            account_id: accountId,
            category,
            created_by: user.user.id,
            organization_id: organizationId,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'chat_id,created_by' });

        if (error) throw error;

        setCategoriesMap(prev => {
          const next = new Map(prev);
          next.set(chatId, category);
          return next;
        });
      }
    } catch (error) {
      console.error('Error setting chat category:', error);
    }
  }, []);

  const getCategoryForChat = useCallback((chatId: string): ChatCategory | null => {
    return categoriesMap.get(chatId) || null;
  }, [categoriesMap]);

  const getCategoryCounts = useCallback((chatIds: string[]): Record<ChatCategory | 'uncategorized', number> => {
    const counts: Record<string, number> = {
      interested: 0,
      not_interested: 0,
      to_recontact: 0,
      no_response: 0,
      uncategorized: 0,
    };
    chatIds.forEach(id => {
      const cat = categoriesMap.get(id);
      if (cat) counts[cat]++;
      else counts.uncategorized++;
    });
    return counts as Record<ChatCategory | 'uncategorized', number>;
  }, [categoriesMap]);

  const [autoTagging, setAutoTagging] = useState(false);

  const autoTagChats = useCallback(async (chats: Array<{ id: string; account_id: string; name?: string; attendees?: any[]; last_message?: any; unread_count?: number; unread?: number }>) => {
    if (autoTagging || chats.length === 0) return;
    
    // Skip chats already categorized (manually or by previous auto-tag) to avoid overwriting user corrections
    const untaggedChats = chats.filter(c => !categoriesMap.has(c.id));
    if (untaggedChats.length === 0) return;

    setAutoTagging(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      // Process in batches of 30
      const batchSize = 30;
      let totalTagged = 0;

      for (let i = 0; i < untaggedChats.length; i += batchSize) {
        const batch = untaggedChats.slice(i, i + batchSize);
        
        const response = await invokeEdgeFunction('auto-categorize-chats', {
          chats: batch,
        });

        if (response.error || !response.data?.success) {
          console.error('Auto-categorize batch error:', response.error || response.data?.error);
          continue;
        }

        const results = response.data.results as Array<{ chat_id: string; account_id: string; category: string }>;
        if (results.length === 0) continue;

        // Bulk upsert
        const rows = results.map(r => ({
          chat_id: r.chat_id,
          account_id: r.account_id,
          category: r.category,
          created_by: user.user!.id,
          organization_id: organizationId,
          updated_at: new Date().toISOString(),
        }));

        const { error } = await supabase
          .from('chat_categories')
          .upsert(rows, { onConflict: 'chat_id,created_by' });

        if (error) {
          console.error('Upsert error:', error);
          continue;
        }

        // Update local map
        setCategoriesMap(prev => {
          const next = new Map(prev);
          results.forEach(r => next.set(r.chat_id, r.category as ChatCategory));
          return next;
        });

        totalTagged += results.length;
      }

      toast.success(`${totalTagged} conversations catégorisées automatiquement`);
    } catch (error) {
      console.error('Error auto-tagging:', error);
      toast.error('Erreur lors de la catégorisation automatique');
    } finally {
      setAutoTagging(false);
    }
  }, [autoTagging]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  return {
    categoriesMap,
    categoryFilter,
    setCategoryFilter,
    setCategory,
    getCategoryForChat,
    getCategoryCounts,
    fetchCategories,
    autoTagChats,
    autoTagging,
    loading,
  };
}

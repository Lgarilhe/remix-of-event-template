import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
    loading,
  };
}

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface UnreadCountResult {
  count: number;
  loading: boolean;
  refresh: () => void;
}

/**
 * Lightweight hook to fetch unread LinkedIn message count on mount.
 * This is used to show the badge in the Outreach tabs even before the user opens Messages.
 */
export const useUnreadMessageCount = (selectedAccountId: string | null): UnreadCountResult => {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchUnreadCount = useCallback(async () => {
    if (!selectedAccountId) {
      setCount(0);
      return;
    }

    setLoading(true);
    try {
      // Fetch both Classic and Recruiter inboxes in parallel
      const folders = ['INBOX_LINKEDIN_CLASSIC', 'INBOX_LINKEDIN_RECRUITER'];
      
      const results = await Promise.all(
        folders.map(async (folder) => {
          try {
            const response = await supabase.functions.invoke('unipile-search', {
              body: {
                action: 'get_chats',
                account_id: selectedAccountId,
                limit: 100,
                folder,
              },
            });

            if (!response.data?.success || !response.data?.chats) {
              return 0;
            }

            // Count unread messages
            return response.data.chats.reduce((acc: number, chat: any) => {
              const unread = chat.unread_messages_count || 0;
              return acc + unread;
            }, 0);
          } catch {
            return 0;
          }
        })
      );

      const total = results.reduce((a, b) => a + b, 0);
      setCount(total);
    } catch (error) {
      console.error('Error fetching unread count:', error);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId]);

  // Fetch on mount and when account changes
  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    if (!selectedAccountId) return;
    
    const interval = setInterval(fetchUnreadCount, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [selectedAccountId, fetchUnreadCount]);

  return { count, loading, refresh: fetchUnreadCount };
};

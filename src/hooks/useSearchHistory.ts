import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInFiltersState } from '@/components/outreach/types';
import { toast } from 'sonner';

export interface SearchHistoryEntry {
  id: string;
  job_id: string;
  job_title: string | null;
  client_name: string | null;
  filters_snapshot: LinkedInFiltersState;
  results_count: number;
  treated_count: number;
  dismissed_count: number;
  messaged_count: number;
  shortlisted_count: number;
  search_api: string;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useSearchHistory(jobId: string | null) {
  const queryClient = useQueryClient();

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['search-history', jobId],
    queryFn: async () => {
      if (!jobId) return [];
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      
      const { data, error } = await supabase
        .from('search_history')
        .select('*')
        .eq('job_id', jobId)
        .eq('created_by', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return (data || []) as unknown as SearchHistoryEntry[];
    },
    enabled: !!jobId,
  });

  const saveSearch = useCallback(async (params: {
    jobId: string;
    jobTitle: string | null;
    clientName: string | null;
    filters: LinkedInFiltersState;
    resultsCount: number;
    treatedCount: number;
    dismissedCount: number;
    messagedCount: number;
    shortlistedCount: number;
    searchApi: string;
    projectId?: string | null;
  }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('search_history').insert({
      created_by: user.id,
      job_id: params.jobId,
      job_title: params.jobTitle,
      client_name: params.clientName,
      filters_snapshot: params.filters as any,
      results_count: params.resultsCount,
      treated_count: params.treatedCount,
      dismissed_count: params.dismissedCount,
      messaged_count: params.messagedCount,
      shortlisted_count: params.shortlistedCount,
      search_api: params.searchApi,
      project_id: params.projectId || null,
    });

    if (error) {
      console.error('Failed to save search history:', error);
    } else {
      queryClient.invalidateQueries({ queryKey: ['search-history', params.jobId] });
    }
  }, [queryClient]);

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('search_history').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['search-history', jobId] });
      toast.success('Entrée supprimée');
    },
  });

  return {
    history,
    isLoading,
    saveSearch,
    deleteEntry: deleteEntry.mutate,
  };
}

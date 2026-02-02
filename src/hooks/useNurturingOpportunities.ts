import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface NurturingOpportunity {
  id: string;
  candidate_id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  candidate_profile_url: string | null;
  job_id: string | null;
  job_title: string | null;
  trigger_type: 'silence' | 'new_job_match' | 'stage_change' | 'intent_detected' | 'scheduled_followup';
  priority_score: number;
  analysis_context: Record<string, unknown>;
  last_message_at: string | null;
  days_since_contact: number | null;
  detected_intent: string | null;
  suggested_action: 'personalized_message' | 'job_alert' | 'call_proposal' | 'content_share' | 'followup';
  suggested_message: string | null;
  suggested_subject: string | null;
  status: 'pending' | 'approved' | 'sent' | 'dismissed' | 'expired';
  linkedin_account_id: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
}

interface UseNurturingOpportunitiesReturn {
  opportunities: NurturingOpportunity[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  analyzeConversations: (accountId: string, conversations: unknown[], jobs: unknown[]) => Promise<{ analyzed: number; opportunities: number }>;
  backfillNames: (accountId: string, limit?: number) => Promise<number>;
  updateStatus: (id: string, status: NurturingOpportunity['status']) => Promise<void>;
  generateMessage: (id: string) => Promise<{ message: string; subject: string } | null>;
  stats: {
    total: number;
    byTrigger: Record<string, number>;
    byAction: Record<string, number>;
    avgPriority: number;
  };
}

export function useNurturingOpportunities(): UseNurturingOpportunitiesReturn {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Fetch opportunities
  const { data: opportunities = [], isLoading, refetch } = useQuery({
    queryKey: ['nurturing-opportunities'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      // Use direct Supabase query since we have RLS
      const { data, error } = await supabase
        .from('nurturing_opportunities')
        .select('*')
        .eq('status', 'pending')
        .order('priority_score', { ascending: false });

      if (error) {
        console.error('Fetch error:', error);
        setError(error.message);
        return [];
      }

      return (data || []) as NurturingOpportunity[];
    },
    // IMPORTANT:
    // The dashboard is action-oriented and users expect fresh results right after running
    // an analysis. A long staleTime can keep an empty cached result "fresh" and prevent
    // refetch on mount, making it look like nothing happened.
    staleTime: 10_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  // Analyze conversations mutation
  const analyzeMutation = useMutation({
    mutationFn: async ({ 
      accountId, 
      conversations, 
      jobs 
    }: { 
      accountId: string; 
      conversations: unknown[]; 
      jobs: unknown[];
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('nurturing-analyzer', {
        body: {
          action: 'analyze',
          account_id: accountId,
          user_id: user.id,
          conversations,
          jobs,
        },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error || 'Analysis failed');

      return {
        analyzed: Number(response.data.analyzed || 0),
        opportunities: Number(response.data.opportunities || 0),
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['nurturing-opportunities'],
        refetchType: 'active',
      });
    },
  });

  // Backfill missing candidate names/headlines without re-running full analysis
  const backfillNamesMutation = useMutation({
    mutationFn: async ({ accountId, limit }: { accountId: string; limit?: number }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('nurturing-analyzer', {
        body: {
          action: 'backfill_names',
          account_id: accountId,
          user_id: user.id,
          limit,
        },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error || 'Backfill failed');

      return Number(response.data.updated || 0);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['nurturing-opportunities'],
        refetchType: 'active',
      });
    },
  });

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: NurturingOpportunity['status'] }) => {
      const updateData: Record<string, unknown> = { status };
      if (status === 'sent') {
        updateData.sent_at = new Date().toISOString();
      }
      if (['approved', 'dismissed'].includes(status)) {
        updateData.reviewed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('nurturing_opportunities')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['nurturing-opportunities'],
        refetchType: 'active',
      });
    },
  });

  // Generate message mutation
  const generateMessageMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await supabase.functions.invoke('nurturing-analyzer', {
        body: {
          action: 'generate_message',
          opportunity_id: id,
        },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error || 'Generation failed');

      return {
        message: response.data.message,
        subject: response.data.subject,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['nurturing-opportunities'],
        refetchType: 'active',
      });
    },
  });

  // Calculate stats
  const stats = {
    total: opportunities.length,
    byTrigger: opportunities.reduce((acc, opp) => {
      acc[opp.trigger_type] = (acc[opp.trigger_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    byAction: opportunities.reduce((acc, opp) => {
      acc[opp.suggested_action] = (acc[opp.suggested_action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    avgPriority: opportunities.length > 0 
      ? Math.round(opportunities.reduce((sum, opp) => sum + opp.priority_score, 0) / opportunities.length)
      : 0,
  };

  const analyzeConversations = useCallback(async (
    accountId: string,
    conversations: unknown[],
    jobs: unknown[]
  ) => {
    return await analyzeMutation.mutateAsync({ accountId, conversations, jobs });
  }, [analyzeMutation]);

  const backfillNames = useCallback(async (accountId: string, limit?: number) => {
    return await backfillNamesMutation.mutateAsync({ accountId, limit });
  }, [backfillNamesMutation]);

  const updateStatus = useCallback(async (id: string, status: NurturingOpportunity['status']) => {
    await updateStatusMutation.mutateAsync({ id, status });
  }, [updateStatusMutation]);

  const generateMessage = useCallback(async (id: string) => {
    try {
      return await generateMessageMutation.mutateAsync(id);
    } catch (err) {
      console.error('Generate message error:', err);
      return null;
    }
  }, [generateMessageMutation]);

  return {
    opportunities,
    isLoading,
    error,
    refetch,
    analyzeConversations,
    backfillNames,
    updateStatus,
    generateMessage,
    stats,
  };
}

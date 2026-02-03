import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type CandidateStatus = 'dismissed' | 'messaged' | 'replied' | 'shortlisted';

export interface JobCandidateStatus {
  id: string;
  job_id: string;
  candidate_id: string;
  linkedin_profile_url: string | null;
  candidate_name: string | null;
  candidate_headline: string | null;
  status: CandidateStatus;
  score: number | null;
  recommendation: string | null;
  skip_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function useJobCandidateStatus(jobId: string | null) {
  const [statuses, setStatuses] = useState<Map<string, JobCandidateStatus>>(new Map());
  const [loading, setLoading] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Fetch all statuses for current job
  const fetchStatuses = useCallback(async () => {
    if (!jobId) {
      setStatuses(new Map());
      setDismissedIds(new Set());
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setStatuses(new Map());
        setDismissedIds(new Set());
        return;
      }

      const { data, error } = await supabase
        .from('job_candidate_status')
        .select('*')
        .eq('job_id', jobId)
        .eq('created_by', user.id);

      if (error) throw error;

      const statusMap = new Map<string, JobCandidateStatus>();
      const dismissed = new Set<string>();
      
      (data || []).forEach((s: any) => {
        statusMap.set(s.candidate_id, s as JobCandidateStatus);
        if (s.status === 'dismissed') {
          dismissed.add(s.candidate_id);
        }
      });

      setStatuses(statusMap);
      setDismissedIds(dismissed);
    } catch (error) {
      console.error('Error fetching candidate statuses:', error);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  // Load statuses when job changes
  useEffect(() => {
    fetchStatuses();
  }, [fetchStatuses]);

  // Dismiss a candidate (mark as non-relevant for this job)
  const dismissCandidate = useCallback(async (
    candidateId: string,
    candidateData: {
      name?: string;
      headline?: string;
      profileUrl?: string;
      score?: number;
      recommendation?: string;
      skipReason?: string;
    }
  ) => {
    if (!jobId) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Vous devez être connecté');
        return;
      }

      const { error } = await supabase
        .from('job_candidate_status')
        .upsert({
          job_id: jobId,
          candidate_id: candidateId,
          linkedin_profile_url: candidateData.profileUrl || null,
          candidate_name: candidateData.name || null,
          candidate_headline: candidateData.headline || null,
          status: 'dismissed',
          score: candidateData.score || null,
          recommendation: candidateData.recommendation || null,
          skip_reason: candidateData.skipReason || null,
          created_by: user.id,
        }, {
          onConflict: 'job_id,candidate_id,created_by'
        });

      if (error) throw error;

      // Update local state
      setDismissedIds(prev => new Set([...prev, candidateId]));
      setStatuses(prev => {
        const next = new Map(prev);
        next.set(candidateId, {
          id: '', // Will be set by DB
          job_id: jobId,
          candidate_id: candidateId,
          linkedin_profile_url: candidateData.profileUrl || null,
          candidate_name: candidateData.name || null,
          candidate_headline: candidateData.headline || null,
          status: 'dismissed',
          score: candidateData.score || null,
          recommendation: candidateData.recommendation || null,
          skip_reason: candidateData.skipReason || null,
          created_by: user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return next;
      });
    } catch (error) {
      console.error('Error dismissing candidate:', error);
      toast.error('Erreur lors de l\'archivage');
    }
  }, [jobId]);

  // Batch dismiss multiple candidates (e.g., all with score < 40)
  const batchDismiss = useCallback(async (
    candidates: Array<{
      id: string;
      name?: string;
      headline?: string;
      profileUrl?: string;
      score?: number;
      recommendation?: string;
      skipReason?: string;
    }>
  ) => {
    if (!jobId || candidates.length === 0) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Vous devez être connecté');
        return;
      }

      const records = candidates.map(c => ({
        job_id: jobId,
        candidate_id: c.id,
        linkedin_profile_url: c.profileUrl || null,
        candidate_name: c.name || null,
        candidate_headline: c.headline || null,
        status: 'dismissed',
        score: c.score || null,
        recommendation: c.recommendation || null,
        skip_reason: c.skipReason || null,
        created_by: user.id,
      }));

      const { error } = await supabase
        .from('job_candidate_status')
        .upsert(records, {
          onConflict: 'job_id,candidate_id,created_by'
        });

      if (error) throw error;

      // Update local state
      const newDismissed = new Set(dismissedIds);
      candidates.forEach(c => newDismissed.add(c.id));
      setDismissedIds(newDismissed);

      // Note: Toast is handled by the caller (LinkedInSearch) to provide better context
    } catch (error) {
      console.error('Error batch dismissing candidates:', error);
      toast.error('Erreur lors de l\'archivage en lot');
    }
  }, [jobId, dismissedIds]);

  // Update status (messaged, replied, shortlisted)
  const updateStatus = useCallback(async (
    candidateId: string,
    status: CandidateStatus
  ) => {
    if (!jobId) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const existing = statuses.get(candidateId);

      const { error } = await supabase
        .from('job_candidate_status')
        .upsert({
          job_id: jobId,
          candidate_id: candidateId,
          status,
          created_by: user.id,
          ...(existing ? {
            linkedin_profile_url: existing.linkedin_profile_url,
            candidate_name: existing.candidate_name,
            candidate_headline: existing.candidate_headline,
            score: existing.score,
            recommendation: existing.recommendation,
          } : {}),
        }, {
          onConflict: 'job_id,candidate_id,created_by'
        });

      if (error) throw error;

      // Update local state
      if (status === 'dismissed') {
        setDismissedIds(prev => new Set([...prev, candidateId]));
      } else {
        setDismissedIds(prev => {
          const next = new Set(prev);
          next.delete(candidateId);
          return next;
        });
      }

      setStatuses(prev => {
        const next = new Map(prev);
        const current = next.get(candidateId);
        if (current) {
          next.set(candidateId, { ...current, status, updated_at: new Date().toISOString() });
        }
        return next;
      });
    } catch (error) {
      console.error('Error updating candidate status:', error);
    }
  }, [jobId, statuses]);

  // Restore a dismissed candidate
  const restoreCandidate = useCallback(async (candidateId: string) => {
    if (!jobId) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('job_candidate_status')
        .delete()
        .eq('job_id', jobId)
        .eq('candidate_id', candidateId)
        .eq('created_by', user.id);

      if (error) throw error;

      // Update local state
      setDismissedIds(prev => {
        const next = new Set(prev);
        next.delete(candidateId);
        return next;
      });
      setStatuses(prev => {
        const next = new Map(prev);
        next.delete(candidateId);
        return next;
      });

      toast.success('Profil restauré');
    } catch (error) {
      console.error('Error restoring candidate:', error);
      toast.error('Erreur lors de la restauration');
    }
  }, [jobId]);

  // Check if a candidate is dismissed
  const isDismissed = useCallback((candidateId: string) => {
    return dismissedIds.has(candidateId);
  }, [dismissedIds]);

  // Get status for a candidate
  const getStatus = useCallback((candidateId: string) => {
    return statuses.get(candidateId);
  }, [statuses]);

  return {
    statuses,
    dismissedIds,
    loading,
    dismissCandidate,
    batchDismiss,
    updateStatus,
    restoreCandidate,
    isDismissed,
    getStatus,
    refresh: fetchStatuses,
  };
}

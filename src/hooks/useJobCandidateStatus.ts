import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';

export type CandidateStatus = 'discovered' | 'dismissed' | 'messaged' | 'replied' | 'shortlisted' | 'scored';

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
  linkedin_profile_data?: any;
}

// Batched state to avoid 3 separate re-renders per fetchStatuses call
interface StatusState {
  statuses: Map<string, JobCandidateStatus>;
  dismissedIds: Set<string>;
  treatedIds: Set<string>;
}

const EMPTY_STATUS_STATE: StatusState = {
  statuses: new Map(),
  dismissedIds: new Set(),
  treatedIds: new Set(),
};

export function useJobCandidateStatus(jobId: string | null) {
  const [statusState, setStatusState] = useState<StatusState>(EMPTY_STATUS_STATE);
  const { statuses, dismissedIds, treatedIds } = statusState;
  const [loading, setLoading] = useState(false);
  const { organizationId } = useOrganization();
  const { isReady, user } = useAuthReady();

  // Helper setters that update individual parts of the batched state
  const setStatuses = useCallback((updater: Map<string, JobCandidateStatus> | ((prev: Map<string, JobCandidateStatus>) => Map<string, JobCandidateStatus>)) => {
    setStatusState(prev => ({
      ...prev,
      statuses: typeof updater === 'function' ? updater(prev.statuses) : updater,
    }));
  }, []);
  const setDismissedIds = useCallback((updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setStatusState(prev => ({
      ...prev,
      dismissedIds: typeof updater === 'function' ? updater(prev.dismissedIds) : updater,
    }));
  }, []);
  const setTreatedIds = useCallback((updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setStatusState(prev => ({
      ...prev,
      treatedIds: typeof updater === 'function' ? updater(prev.treatedIds) : updater,
    }));
  }, []);

  // Fetch all statuses for current job
  // Phase 1: fetch lightweight columns (no linkedin_profile_data) for fast initial load
  // Phase 2: fetch linkedin_profile_data separately for pool rehydration (non-blocking)
  const fetchStatuses = useCallback(async () => {
    if (!jobId) {
      setStatusState(EMPTY_STATUS_STATE);
      return;
    }

    if (!isReady) {
      return;
    }

    if (!user?.id) {
      setStatusState(EMPTY_STATUS_STATE);
      return;
    }

    setLoading(true);
    try {
      // Les statuts d'une mission synthétique existent sous 2 formes de job_id :
      // "project:{uuid}" (écrit par le sourcing) et "{uuid}" nu (écrit par
      // l'inscription en séquence qui normalise pour le cron). On lit les 2
      // formes pour que les candidats contactés via séquence restent visibles.
      const jobIdForms = jobId.startsWith('project:')
        ? [jobId, jobId.slice('project:'.length)]
        : [jobId];

      // Phase 1: lightweight fetch (no linkedin_profile_data)
      const LIGHT_COLUMNS = 'id,job_id,candidate_id,linkedin_profile_url,candidate_name,candidate_headline,status,score,recommendation,skip_reason,created_by,created_at,updated_at,scoring_details,tags,pipeline_stage,project_id,notion_candidate_id,notion_shortlist_id,notion_synced_at,organization_id';
      const allData: any[] = [];
      const PAGE_SIZE = 1000;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('job_candidate_status')
          .select(LIGHT_COLUMNS)
          .in('job_id', jobIdForms)
          .eq('created_by', user.id)
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          allData.push(...data);
          offset += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      const statusMap = new Map<string, JobCandidateStatus>();
      const dismissed = new Set<string>();
      const treated = new Set<string>();

      allData.forEach((s: any) => {
        const existing = statusMap.get(s.candidate_id);
        if (!existing) {
          statusMap.set(s.candidate_id, s as JobCandidateStatus);
          return;
        }
        // Même candidat sous les 2 formes de job_id → base = ligne la plus
        // récente, complétée par les champs que l'autre ligne est seule à porter
        const [base, other] = (s.updated_at || '') > (existing.updated_at || '')
          ? [s, existing as any]
          : [existing as any, s];
        statusMap.set(s.candidate_id, {
          ...base,
          score: base.score ?? other.score,
          recommendation: base.recommendation ?? other.recommendation,
          scoring_details: base.scoring_details ?? other.scoring_details,
          candidate_name: base.candidate_name ?? other.candidate_name,
          candidate_headline: base.candidate_headline ?? other.candidate_headline,
          linkedin_profile_url: base.linkedin_profile_url ?? other.linkedin_profile_url,
        });
      });

      for (const [candidateId, s] of statusMap) {
        if (s.status === 'dismissed') {
          dismissed.add(candidateId);
        }
        treated.add(candidateId);
      }

      // Single state update (1 re-render instead of 3)
      setStatusState({ statuses: statusMap, dismissedIds: dismissed, treatedIds: treated });

      // Phase 2: fetch linkedin_profile_data for pool rehydration (non-blocking, max 500)
      // Only fetch for candidates that have profile data (not null)
      const candidateIds = allData
        .filter(s => s.candidate_name || s.linkedin_profile_url)
        .map(s => s.candidate_id)
        .slice(0, 500);

      if (candidateIds.length > 0) {
        // Fire and forget — don't block the UI
        (async () => {
          try {
            const { data: profileData } = await supabase
              .from('job_candidate_status')
              .select('candidate_id,linkedin_profile_data')
              .in('job_id', jobIdForms)
              .eq('created_by', user.id)
              .in('candidate_id', candidateIds)
              .not('linkedin_profile_data', 'is', null);

            if (profileData && profileData.length > 0) {
              setStatusState(prev => {
                const next = new Map(prev.statuses);
                for (const row of profileData) {
                  const existing = next.get(row.candidate_id);
                  if (existing) {
                    next.set(row.candidate_id, {
                      ...existing,
                      linkedin_profile_data: row.linkedin_profile_data,
                    });
                  }
                }
                return { ...prev, statuses: next };
              });
            }
          } catch (err) {
            console.warn('Failed to fetch profile data for pool:', err);
          }
        })();
      }
    } catch (error) {
      console.error('Error fetching candidate statuses:', error);
    } finally {
      setLoading(false);
    }
  }, [jobId, isReady, user?.id]);

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
      scoringDetails?: any;
      linkedinProfileData?: any;
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
          scoring_details: candidateData.scoringDetails || null,
          linkedin_profile_data: candidateData.linkedinProfileData || null,
           created_by: user.id,
           organization_id: organizationId,
        }, {
          onConflict: 'job_id,candidate_id,created_by'
        });

      if (error) throw error;

      // Update local state
      setDismissedIds(prev => new Set([...prev, candidateId]));
      setTreatedIds(prev => new Set([...prev, candidateId]));
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
      scoringDetails?: any;
      linkedinProfileData?: any;
    }>
  ) => {
    if (!jobId || candidates.length === 0) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Vous devez être connecté');
        return;
      }

      // Dedupe by candidate_id to avoid Postgres "cannot affect row a second time" error
      const uniqueCandidates = Array.from(
        new Map(candidates.map(c => [c.id, c])).values()
      );

      const records = uniqueCandidates.map(c => ({
        job_id: jobId,
        candidate_id: c.id,
        linkedin_profile_url: c.profileUrl || null,
        candidate_name: c.name || null,
        candidate_headline: c.headline || null,
        status: 'dismissed',
        score: c.score || null,
        recommendation: c.recommendation || null,
        skip_reason: c.skipReason || null,
        scoring_details: c.scoringDetails || null,
        linkedin_profile_data: c.linkedinProfileData || null,
        created_by: user.id,
        organization_id: organizationId,
      }));

      const { error } = await supabase
        .from('job_candidate_status')
        .upsert(records, {
          onConflict: 'job_id,candidate_id,created_by'
        });

      if (error) throw error;

      // Update local state
      const newDismissed = new Set(dismissedIds);
      const newTreated = new Set(treatedIds);
      setStatuses(prev => {
        const next = new Map(prev);
        uniqueCandidates.forEach(c => {
          newDismissed.add(c.id);
          newTreated.add(c.id);
          next.set(c.id, {
            id: '',
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
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        });
        return next;
      });
      setDismissedIds(newDismissed);
      setTreatedIds(newTreated);

      // Note: Toast is handled by the caller (LinkedInSearch) to provide better context
    } catch (error) {
      console.error('Error batch dismissing candidates:', error);
      toast.error('Erreur lors de l\'archivage en lot');
    }
  }, [jobId, dismissedIds, treatedIds]);

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
           organization_id: organizationId,
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
      setTreatedIds(prev => new Set([...prev, candidateId]));
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

  // Restore a dismissed candidate → set back to 'discovered' (preserves linkedin_profile_data)
  const restoreCandidate = useCallback(async (candidateId: string) => {
    if (!jobId) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('job_candidate_status')
        .update({ status: 'discovered', score: null, recommendation: null, skip_reason: null })
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
        const existing = next.get(candidateId);
        if (existing) {
          next.set(candidateId, { ...existing, status: 'discovered', score: null, recommendation: null, skip_reason: null, updated_at: new Date().toISOString() });
        }
        return next;
      });

      toast.success('Profil restauré');
    } catch (error) {
      console.error('Error restoring candidate:', error);
      toast.error('Erreur lors de la restauration');
    }
  }, [jobId]);

  // Save score for a candidate (without changing status to dismissed)
  const saveScore = useCallback(async (
    candidateId: string,
    candidateData: {
      name?: string;
      headline?: string;
      profileUrl?: string;
      score: number;
      recommendation: string;
      scoringDetails?: any;
      linkedinProfileData?: any;
    }
  ) => {
    if (!jobId) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const existing = statuses.get(candidateId);
      // Don't overwrite a higher-priority status (messaged, replied, shortlisted)
      const currentStatus = existing?.status;
      const keepStatus = currentStatus && ['messaged', 'replied', 'shortlisted'].includes(currentStatus);

      const { error } = await supabase
        .from('job_candidate_status')
        .upsert({
          job_id: jobId,
          candidate_id: candidateId,
          linkedin_profile_url: candidateData.profileUrl || existing?.linkedin_profile_url || null,
          candidate_name: candidateData.name || existing?.candidate_name || null,
          candidate_headline: candidateData.headline || existing?.candidate_headline || null,
          status: keepStatus ? currentStatus : 'scored',
          score: candidateData.score,
          recommendation: candidateData.recommendation,
          scoring_details: candidateData.scoringDetails || null,
          linkedin_profile_data: candidateData.linkedinProfileData || null,
           created_by: user.id,
           organization_id: organizationId,
        }, {
          onConflict: 'job_id,candidate_id,created_by'
        });

      if (error) throw error;

      // Update local state
      setTreatedIds(prev => new Set([...prev, candidateId]));
      setStatuses(prev => {
        const next = new Map(prev);
        next.set(candidateId, {
          id: existing?.id || '',
          job_id: jobId,
          candidate_id: candidateId,
          linkedin_profile_url: candidateData.profileUrl || existing?.linkedin_profile_url || null,
          candidate_name: candidateData.name || existing?.candidate_name || null,
          candidate_headline: candidateData.headline || existing?.candidate_headline || null,
          status: (keepStatus ? currentStatus : 'scored') as CandidateStatus,
          score: candidateData.score,
          recommendation: candidateData.recommendation,
          skip_reason: null,
          created_by: user.id,
          created_at: existing?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return next;
      });
    } catch (error) {
      console.error('Error saving score:', error);
    }
  }, [jobId, statuses]);

  // Batch save scores for multiple candidates
  const batchSaveScores = useCallback(async (
    candidates: Array<{
      id: string;
      name?: string;
      headline?: string;
      profileUrl?: string;
      score: number;
      recommendation: string;
      scoringDetails?: any;
      linkedinProfileData?: any;
    }>
  ) => {
    if (!jobId || candidates.length === 0) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const records = candidates.map(c => {
        const existing = statuses.get(c.id);
        const keepStatus = existing?.status && ['messaged', 'replied', 'shortlisted'].includes(existing.status);
        return {
          job_id: jobId,
          candidate_id: c.id,
          linkedin_profile_url: c.profileUrl || existing?.linkedin_profile_url || null,
          candidate_name: c.name || existing?.candidate_name || null,
          candidate_headline: c.headline || existing?.candidate_headline || null,
          status: keepStatus ? existing.status : 'scored',
          score: c.score,
          recommendation: c.recommendation,
          scoring_details: c.scoringDetails || null,
          linkedin_profile_data: c.linkedinProfileData || null,
           created_by: user.id,
           organization_id: organizationId,
        };
      });

      const { error } = await supabase
        .from('job_candidate_status')
        .upsert(records, {
          onConflict: 'job_id,candidate_id,created_by'
        });

      if (error) throw error;

      // Update local state
      const newTreated = new Set(treatedIds);
      const newStatuses = new Map(statuses);
      candidates.forEach(c => {
        newTreated.add(c.id);
        const existing = newStatuses.get(c.id);
        const keepStatus = existing?.status && ['messaged', 'replied', 'shortlisted'].includes(existing.status);
        newStatuses.set(c.id, {
          id: existing?.id || '',
          job_id: jobId,
          candidate_id: c.id,
          linkedin_profile_url: c.profileUrl || existing?.linkedin_profile_url || null,
          candidate_name: c.name || existing?.candidate_name || null,
          candidate_headline: c.headline || existing?.candidate_headline || null,
          status: (keepStatus ? existing.status : 'scored') as CandidateStatus,
          score: c.score,
          recommendation: c.recommendation,
          skip_reason: null,
          created_by: user.id,
          created_at: existing?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      });
      setTreatedIds(newTreated);
      setStatuses(newStatuses);
    } catch (error) {
      console.error('Error batch saving scores:', error);
    }
  }, [jobId, statuses, treatedIds]);

  // Check if a candidate is dismissed
  const isDismissed = useCallback((candidateId: string) => {
    return dismissedIds.has(candidateId);
  }, [dismissedIds]);

  // Get status for a candidate
  const getStatus = useCallback((candidateId: string) => {
    return statuses.get(candidateId);
  }, [statuses]);

  // Batch discover — persist newly found profiles as 'discovered' without overwriting existing statuses
  const batchDiscover = useCallback(async (
    profiles: Array<{
      id: string;
      name?: string;
      headline?: string;
      profileUrl?: string;
      linkedinProfileData?: any;
    }>
  ) => {
    if (!jobId || profiles.length === 0) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Only persist profiles not already in local state
      const newProfiles = profiles.filter(p => !statuses.has(p.id));
      if (newProfiles.length === 0) return;

      // Dedupe by candidate_id
      const uniqueProfiles = Array.from(
        new Map(newProfiles.map(p => [p.id, p])).values()
      );

      const records = uniqueProfiles.map(p => ({
        job_id: jobId,
        candidate_id: p.id,
        candidate_name: p.name || null,
        candidate_headline: p.headline || null,
        linkedin_profile_url: p.profileUrl || null,
        linkedin_profile_data: p.linkedinProfileData || null,
        status: 'discovered',
        created_by: user.id,
        organization_id: organizationId,
      }));

      const { error } = await supabase
        .from('job_candidate_status')
        .upsert(records, {
          onConflict: 'job_id,candidate_id,created_by',
          ignoreDuplicates: true, // Don't overwrite existing rows
        });

      if (error) {
        console.error('Error batch discovering:', error);
        return;
      }

      // Optimistic local state update
      setStatuses(prev => {
        const next = new Map(prev);
        for (const p of uniqueProfiles) {
          if (!next.has(p.id)) {
            next.set(p.id, {
              id: '',
              job_id: jobId,
              candidate_id: p.id,
              linkedin_profile_url: p.profileUrl || null,
              candidate_name: p.name || null,
              candidate_headline: p.headline || null,
              status: 'discovered',
              score: null,
              recommendation: null,
              skip_reason: null,
              created_by: user.id,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              linkedin_profile_data: p.linkedinProfileData || null,
            });
          }
        }
        return next;
      });

      console.log(`[batchDiscover] Persisted ${uniqueProfiles.length} new profiles`);
    } catch (error) {
      console.error('Error in batchDiscover:', error);
    }
  }, [jobId, statuses]);

  return {
    statuses,
    dismissedIds,
    treatedIds,
    loading,
    dismissCandidate,
    batchDismiss,
    batchDiscover,
    saveScore,
    batchSaveScores,
    updateStatus,
    restoreCandidate,
    isDismissed,
    isTreated: useCallback((candidateId: string) => treatedIds.has(candidateId), [treatedIds]),
    getStatus,
    refresh: fetchStatuses,
  };
}

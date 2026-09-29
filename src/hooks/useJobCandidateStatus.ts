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
  /** JobMatchResult complet persisté au scoring (chargé par LIGHT_COLUMNS). */
  scoring_details?: any;
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

// Lot 0b (N10, N11) : enregistrer une note n'écrit plus le statut dans
// l'upsert, qui en cas de conflit réécrirait celui d'un candidat contacté,
// retenu ou écarté. Seuls les profils pas encore traités passent ensuite à
// « scored », ce qui ne change pas leur étape.
const SCORABLE_STATUSES = ['new', 'discovered', 'untreated'];
const STATUS_UPDATE_CHUNK = 100;

// Statut encore au stade de la notation (absent, à trier ou déjà noté).
function isScoringStatus(status: string | null | undefined): boolean {
  return !status || status === 'scored' || SCORABLE_STATUSES.includes(status);
}

// Lève l'erreur : l'appelant n'annonce pas « scored » si la base ne l'a pas.
async function markScored(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += STATUS_UPDATE_CHUNK) {
    const { error } = await supabase
      .from('job_candidate_status')
      .update({ status: 'scored' })
      .in('id', ids.slice(i, i + STATUS_UPDATE_CHUNK))
      .in('status', SCORABLE_STATUSES);
    if (error) throw error;
  }
}

// État local après une note, même règle que la base. Le statut local (fusion
// des deux formes de job_id) est gardé s'il est au-delà de la notation : la
// ligne écrite peut n'être que la ligne du Sourcing d'un candidat contacté.
// Sinon, statut relu en base, « scored » s'il est encore au stade de la notation.
function statusAfterScore(
  local: string | null | undefined,
  saved: string | null | undefined,
): CandidateStatus {
  if (!isScoringStatus(local)) return local as CandidateStatus;
  const status = saved ?? local;
  return (isScoringStatus(status) ? 'scored' : status) as CandidateStatus;
}

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
      const LIGHT_COLUMNS = 'id,job_id,candidate_id,linkedin_profile_url,candidate_name,candidate_headline,status,score,recommendation,skip_reason,created_by,created_at,updated_at,scoring_details,tags,pipeline_stage,project_id,organization_id';
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
          // Une note récente ne masque pas un statut plus avancé de l'autre ligne
          // (la note n'écrit plus le statut, lot 0b).
          status: isScoringStatus(base.status) && !isScoringStatus(other.status) ? other.status : base.status,
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

  // Save score for a candidate (le statut n'est changé que pour un profil pas
  // encore traité, voir markScored)
  const saveScore = useCallback(async (
    candidateId: string,
    candidateData: {
      name?: string;
      headline?: string;
      profileUrl?: string;
      score: number;
      recommendation: string;
      skipReason?: string;
      scoringDetails?: any;
      linkedinProfileData?: any;
    }
  ) => {
    if (!jobId) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const existing = statuses.get(candidateId);

      // Note seule, sans statut. skip_reason seulement si présent : une raison
      // posée ailleurs n'est pas effacée par une nouvelle note.
      const { data: saved, error } = await supabase
        .from('job_candidate_status')
        .upsert({
          job_id: jobId,
          candidate_id: candidateId,
          linkedin_profile_url: candidateData.profileUrl || existing?.linkedin_profile_url || null,
          candidate_name: candidateData.name || existing?.candidate_name || null,
          candidate_headline: candidateData.headline || existing?.candidate_headline || null,
          score: candidateData.score,
          recommendation: candidateData.recommendation,
          ...(candidateData.skipReason ? { skip_reason: candidateData.skipReason } : {}),
          scoring_details: candidateData.scoringDetails || null,
          linkedin_profile_data: candidateData.linkedinProfileData || null,
           created_by: user.id,
           organization_id: organizationId,
        }, {
          onConflict: 'job_id,candidate_id,created_by'
        })
        .select('id, status');

      if (error) throw error;

      await markScored((saved ?? []).map(row => row.id));
      const nextStatus = statusAfterScore(existing?.status, saved?.[0]?.status);

      // Update local state
      setTreatedIds(prev => new Set([...prev, candidateId]));
      setStatuses(prev => {
        const next = new Map(prev);
        next.set(candidateId, {
          id: saved?.[0]?.id || existing?.id || '',
          job_id: jobId,
          candidate_id: candidateId,
          linkedin_profile_url: candidateData.profileUrl || existing?.linkedin_profile_url || null,
          candidate_name: candidateData.name || existing?.candidate_name || null,
          candidate_headline: candidateData.headline || existing?.candidate_headline || null,
          status: nextStatus,
          score: candidateData.score,
          recommendation: candidateData.recommendation,
          skip_reason: candidateData.skipReason || existing?.skip_reason || null,
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

  // Batch save scores for multiple candidates (même règle que saveScore)
  const batchSaveScores = useCallback(async (
    candidates: Array<{
      id: string;
      name?: string;
      headline?: string;
      profileUrl?: string;
      score: number;
      recommendation: string;
      skipReason?: string;
      scoringDetails?: any;
      linkedinProfileData?: any;
    }>
  ) => {
    if (!jobId || candidates.length === 0) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Un upsert groupé ne peut pas toucher deux fois la même ligne.
      const uniqueCandidates = Array.from(
        new Map(candidates.map(c => [c.id, c])).values()
      );

      const toRecord = (c: typeof uniqueCandidates[number]) => {
        const existing = statuses.get(c.id);
        return {
          job_id: jobId,
          candidate_id: c.id,
          linkedin_profile_url: c.profileUrl || existing?.linkedin_profile_url || null,
          candidate_name: c.name || existing?.candidate_name || null,
          candidate_headline: c.headline || existing?.candidate_headline || null,
          score: c.score,
          recommendation: c.recommendation,
          ...(c.skipReason ? { skip_reason: c.skipReason } : {}),
          scoring_details: c.scoringDetails || null,
          linkedin_profile_data: c.linkedinProfileData || null,
           created_by: user.id,
           organization_id: organizationId,
        };
      };

      // Note seule, sans statut. Deux envois, avec et sans raison : dans un
      // upsert groupé, une colonne absente d'une ligne serait mise à NULL.
      const groups = [
        uniqueCandidates.filter(c => c.skipReason),
        uniqueCandidates.filter(c => !c.skipReason),
      ].filter(group => group.length > 0);
      const savedRows = new Map<string, { id: string; status: string }>();
      for (const group of groups) {
        const { data: saved, error } = await supabase
          .from('job_candidate_status')
          .upsert(group.map(toRecord), {
            onConflict: 'job_id,candidate_id,created_by'
          })
          .select('id, candidate_id, status');

        if (error) throw error;
        // Juste après l'upsert du groupe : un échec du groupe suivant ne laisse
        // pas celui-ci à « new ».
        await markScored((saved ?? []).map(row => row.id));
        for (const row of saved ?? []) {
          savedRows.set(row.candidate_id, { id: row.id, status: row.status });
        }
      }

      // Update local state
      const newTreated = new Set(treatedIds);
      const newStatuses = new Map(statuses);
      uniqueCandidates.forEach(c => {
        newTreated.add(c.id);
        const existing = newStatuses.get(c.id);
        const saved = savedRows.get(c.id);
        newStatuses.set(c.id, {
          id: saved?.id || existing?.id || '',
          job_id: jobId,
          candidate_id: c.id,
          linkedin_profile_url: c.profileUrl || existing?.linkedin_profile_url || null,
          candidate_name: c.name || existing?.candidate_name || null,
          candidate_headline: c.headline || existing?.candidate_headline || null,
          status: statusAfterScore(existing?.status, saved?.status),
          score: c.score,
          recommendation: c.recommendation,
          skip_reason: c.skipReason || existing?.skip_reason || null,
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

  /**
   * Met des profils en shortlist, et dit ce qui s'est réellement passé.
   *
   * Pourquoi cette fonction existe (audit UX du 09/09/2026, constats UX01/UX01b) :
   * le bouton « Shortlister » appelait `batchDiscover`, qui écrit le statut
   * `discovered`. Or le filtre Shortlist cherche `shortlisted`. L'utilisateur
   * voyait donc une confirmation positive sans retrouver personne dans sa
   * shortlist. `batchDiscover` ignorait en plus les profils déjà connus et
   * avalait ses erreurs de persistance : un échec base ressortait en succès.
   *
   * Les trois garanties tenues ici :
   *  - le statut écrit est bien `shortlisted`, y compris pour un profil déjà noté ;
   *  - l'historique utile du candidat est conservé (score, recommandation, identité) ;
   *  - le bilan retourné distingue ajoutés, déjà en shortlist, et échec.
   *    L'appelant ne doit afficher un succès que sur la foi de ce bilan.
   */
  const batchShortlist = useCallback(async (
    profiles: Array<{
      id: string;
      name?: string;
      headline?: string;
      profileUrl?: string;
      linkedinProfileData?: Record<string, unknown> | null;
    }>
  ): Promise<{ added: number; already: number; failed: number; error?: string }> => {
    if (!jobId) return { added: 0, already: 0, failed: profiles.length, error: 'Aucune mission active' };
    if (profiles.length === 0) return { added: 0, already: 0, failed: 0 };

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { added: 0, already: 0, failed: profiles.length, error: 'Session expirée' };

    // Dédoublonnage par candidat
    const unique = Array.from(new Map(profiles.map(p => [p.id, p])).values());

    // Déjà en shortlist : rien à écrire, mais à compter dans le bilan
    const already = unique.filter(p => statuses.get(p.id)?.status === 'shortlisted');
    const toWrite = unique.filter(p => statuses.get(p.id)?.status !== 'shortlisted');

    if (toWrite.length === 0) {
      return { added: 0, already: already.length, failed: 0 };
    }

    const records = toWrite.map(p => {
      const existing = statuses.get(p.id);
      return {
        job_id: jobId,
        candidate_id: p.id,
        // On préfère la donnée déjà en base quand elle existe : elle a pu être
        // enrichie depuis la recherche (nom complet, URL résolue).
        candidate_name: existing?.candidate_name || p.name || null,
        candidate_headline: existing?.candidate_headline || p.headline || null,
        linkedin_profile_url: existing?.linkedin_profile_url || p.profileUrl || null,
        linkedin_profile_data: existing?.linkedin_profile_data || p.linkedinProfileData || null,
        // L'historique de notation survit à la mise en shortlist.
        score: existing?.score ?? null,
        recommendation: existing?.recommendation ?? null,
        status: 'shortlisted' as const,
        created_by: user.id,
        organization_id: organizationId,
      };
    });

    const { error } = await supabase
      .from('job_candidate_status')
      .upsert(records, { onConflict: 'job_id,candidate_id,created_by' });

    if (error) {
      // Pas de `return` silencieux : l'appelant doit pouvoir ne rien confirmer.
      console.error('[batchShortlist] échec de persistance:', error);
      return { added: 0, already: already.length, failed: toWrite.length, error: error.message };
    }

    // État local : le statut change pour tout le monde, y compris les déjà connus.
    setStatuses(prev => {
      const next = new Map(prev);
      for (const p of toWrite) {
        const existing = next.get(p.id);
        next.set(p.id, {
          ...(existing ?? {
            id: '',
            job_id: jobId,
            candidate_id: p.id,
            linkedin_profile_url: p.profileUrl || null,
            candidate_name: p.name || null,
            candidate_headline: p.headline || null,
            score: null,
            recommendation: null,
            skip_reason: null,
            created_by: user.id,
            created_at: new Date().toISOString(),
            linkedin_profile_data: p.linkedinProfileData || null,
          }),
          status: 'shortlisted',
          updated_at: new Date().toISOString(),
        } as JobCandidateStatus);
      }
      return next;
    });
    setTreatedIds(prev => new Set([...prev, ...toWrite.map(p => p.id)]));

    return { added: toWrite.length, already: already.length, failed: 0 };
  }, [jobId, statuses, organizationId, setStatuses, setTreatedIds]);

  return {
    statuses,
    dismissedIds,
    treatedIds,
    loading,
    dismissCandidate,
    batchDismiss,
    batchDiscover,
    batchShortlist,
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

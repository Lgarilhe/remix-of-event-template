import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Types
export interface ATSCandidate {
  id: string;
  candidateId: string;
  name: string;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  headline: string | null;
  expertise: string[];
  stage: string;
  entity: string | null;
  source: 'shortlist' | 'sequence' | 'inmail';
  sourceId: string;
  jobId: string | null;
  jobTitle: string | null;
  sequenceId?: string;
  sequenceName?: string;
  sequenceStatus?: string;
  connectionStatus?: string;
  lastActivity: string | null;
  createdAt: string;
  notesCount?: number;
  hasReminder?: boolean;
}

export const ATS_STAGES = [
  { key: 'Nouveau', label: 'Nouveau', color: 'bg-slate-100 border-slate-300' },
  { key: 'Contacté', label: 'Contacté', color: 'bg-blue-50 border-blue-300' },
  { key: 'Répondu', label: 'Répondu', color: 'bg-cyan-50 border-cyan-300' },
  { key: 'Pressenti', label: 'Pressenti', color: 'bg-gray-100 border-gray-300' },
  { key: 'CV envoyé', label: 'CV envoyé', color: 'bg-indigo-50 border-indigo-300' },
  { key: 'ITW en cours', label: 'ITW en cours', color: 'bg-yellow-50 border-yellow-300' },
  { key: 'Offre', label: 'Offre', color: 'bg-purple-50 border-purple-300' },
  { key: 'Gagné', label: 'Gagné', color: 'bg-green-50 border-green-300' },
  { key: 'Perdu', label: 'Perdu', color: 'bg-red-50 border-red-300' },
];

interface LoadingState {
  shortlist: boolean;
  sequences: boolean;
  inmails: boolean;
  metadata: boolean;
}

export function useATSData() {
  const [candidates, setCandidates] = useState<ATSCandidate[]>([]);
  const [loading, setLoading] = useState<LoadingState>({
    shortlist: true,
    sequences: true,
    inmails: true,
    metadata: true,
  });
  const [error, setError] = useState<string | null>(null);

  const isLoading = loading.shortlist || loading.sequences || loading.inmails;
  const isFullyLoaded = !loading.shortlist && !loading.sequences && !loading.inmails && !loading.metadata;

  // Fetch shortlist from Notion (slowest, so we show it first)
  const fetchShortlist = useCallback(async () => {
    try {
      const response = await supabase.functions.invoke('fetch-notion-candidates', {
        body: {},
      });

      if (response.data?.success && response.data.shortlist) {
        const shortlistCandidates: ATSCandidate[] = response.data.shortlist.map((entry: any) => ({
          id: `shortlist-${entry.id}`,
          candidateId: entry.candidate?.id || entry.id,
          name: entry.candidate?.name || entry.name || 'Sans nom',
          email: entry.candidate?.email || null,
          phone: entry.candidate?.phone || null,
          linkedin: entry.candidate?.linkedin || null,
          headline: null,
          expertise: entry.candidate?.expertise || [],
          stage: entry.stage || 'Pressenti',
          entity: entry.entity || null,
          source: 'shortlist' as const,
          sourceId: entry.id,
          jobId: entry.positions?.[0]?.id || null,
          jobTitle: entry.positions?.[0]?.name || null,
          lastActivity: entry.createdAt || null,
          createdAt: entry.createdAt || new Date().toISOString(),
        }));
        
        setCandidates(prev => [...prev, ...shortlistCandidates]);
      }
    } catch (err) {
      console.error('Error fetching shortlist:', err);
    } finally {
      setLoading(prev => ({ ...prev, shortlist: false }));
    }
  }, []);

  // Fetch sequence enrollments
  const fetchSequences = useCallback(async () => {
    try {
      const { data: enrollments, error: enrollmentsError } = await supabase
        .from('sequence_enrollments')
        .select(`*, outreach_sequences (id, name)`)
        .order('created_at', { ascending: false });

      if (enrollmentsError) throw enrollmentsError;

      if (enrollments) {
        const sequenceCandidates: ATSCandidate[] = enrollments.map((enrollment: any) => {
          let stage = 'Contacté';
          if (enrollment.replied_at) {
            stage = 'Répondu';
          } else if (enrollment.status === 'paused') {
            stage = 'Nouveau';
          }

          return {
            id: `sequence-${enrollment.id}`,
            candidateId: enrollment.profile_id,
            name: enrollment.profile_name || 'Profil LinkedIn',
            email: null,
            phone: null,
            linkedin: enrollment.profile_url || null,
            headline: enrollment.profile_headline || null,
            expertise: [],
            stage,
            entity: null,
            source: 'sequence' as const,
            sourceId: enrollment.id,
            jobId: enrollment.job_id || null,
            jobTitle: enrollment.job_title || null,
            sequenceId: enrollment.sequence_id,
            sequenceName: enrollment.outreach_sequences?.name || null,
            sequenceStatus: enrollment.status,
            connectionStatus: enrollment.connection_status,
            lastActivity: enrollment.updated_at || enrollment.created_at,
            createdAt: enrollment.created_at,
          };
        });

        setCandidates(prev => [...prev, ...sequenceCandidates]);
      }
    } catch (err) {
      console.error('Error fetching sequences:', err);
    } finally {
      setLoading(prev => ({ ...prev, sequences: false }));
    }
  }, []);

  // Fetch InMail queue
  const fetchInMails = useCallback(async () => {
    try {
      const { data: inmails, error: inmailsError } = await supabase
        .from('inmail_queue')
        .select('*')
        .order('created_at', { ascending: false });

      if (inmailsError) throw inmailsError;

      if (inmails) {
        setCandidates(prev => {
          const existingProfileIds = new Set(prev.map(c => c.candidateId));
          
          const inmailCandidates: ATSCandidate[] = inmails
            .filter((inmail: any) => !existingProfileIds.has(inmail.recipient_profile_id))
            .map((inmail: any) => ({
              id: `inmail-${inmail.id}`,
              candidateId: inmail.recipient_profile_id,
              name: inmail.recipient_name || 'Profil LinkedIn',
              email: null,
              phone: null,
              linkedin: null,
              headline: inmail.recipient_headline || null,
              expertise: [],
              stage: inmail.status === 'sent' ? 'Contacté' : 'Nouveau',
              entity: null,
              source: 'inmail' as const,
              sourceId: inmail.id,
              jobId: null,
              jobTitle: null,
              lastActivity: inmail.sent_at || inmail.created_at,
              createdAt: inmail.created_at,
            }));

          return [...prev, ...inmailCandidates];
        });
      }
    } catch (err) {
      console.error('Error fetching inmails:', err);
    } finally {
      setLoading(prev => ({ ...prev, inmails: false }));
    }
  }, []);

  // Fetch metadata (notes count and reminders) - runs after main data
  const fetchMetadata = useCallback(async () => {
    try {
      const [notesResult, remindersResult] = await Promise.all([
        supabase.from('candidate_notes').select('candidate_id'),
        supabase.from('candidate_reminders').select('candidate_id').is('completed_at', null),
      ]);

      const notesMap = new Map<string, number>();
      if (notesResult.data) {
        notesResult.data.forEach((note: any) => {
          const count = notesMap.get(note.candidate_id) || 0;
          notesMap.set(note.candidate_id, count + 1);
        });
      }

      const reminderSet = new Set<string>();
      if (remindersResult.data) {
        remindersResult.data.forEach((r: any) => reminderSet.add(r.candidate_id));
      }

      setCandidates(prev => prev.map(candidate => ({
        ...candidate,
        notesCount: notesMap.get(candidate.candidateId) || 0,
        hasReminder: reminderSet.has(candidate.candidateId),
      })));
    } catch (err) {
      console.error('Error fetching metadata:', err);
    } finally {
      setLoading(prev => ({ ...prev, metadata: false }));
    }
  }, []);

  // Initial fetch - parallel for speed
  const fetchAll = useCallback(async () => {
    setCandidates([]);
    setError(null);
    setLoading({
      shortlist: true,
      sequences: true,
      inmails: true,
      metadata: true,
    });

    // Start all fetches in parallel
    Promise.all([
      fetchShortlist(),
      fetchSequences(),
      fetchInMails(),
    ]).then(() => {
      // Fetch metadata after main data is loaded
      fetchMetadata();
    }).catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    });
  }, [fetchShortlist, fetchSequences, fetchInMails, fetchMetadata]);

  // Handle stage change
  const handleStageChange = useCallback(async (candidateId: string, newStage: string) => {
    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate) return;

    const oldStage = candidate.stage;

    // Optimistic update
    setCandidates(prev => prev.map(c => 
      c.id === candidateId ? { ...c, stage: newStage } : c
    ));

    // If shortlist, update in Notion
    if (candidate.source === 'shortlist') {
      try {
        const response = await supabase.functions.invoke('update-candidate-stage', {
          body: {
            shortlistId: candidate.sourceId,
            newStage,
          },
        });

        if (response.error || !response.data?.success) {
          throw new Error(response.data?.error || 'Failed to update stage');
        }

        toast.success(`Candidat déplacé vers "${newStage}"`);
      } catch (error) {
        console.error('Error updating stage:', error);
        toast.error('Erreur lors de la mise à jour');
        // Revert
        setCandidates(prev => prev.map(c => 
          c.id === candidateId ? { ...c, stage: oldStage } : c
        ));
      }
    } else {
      toast.success(`Candidat déplacé vers "${newStage}"`);
    }
  }, [candidates]);

  return {
    candidates,
    loading: isLoading,
    isFullyLoaded,
    loadingState: loading,
    error,
    refetch: fetchAll,
    handleStageChange,
  };
}

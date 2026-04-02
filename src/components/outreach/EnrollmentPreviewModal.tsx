import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LinkedInProfile } from '@/components/outreach/types';
import { useEnrollmentPreview, SequenceStepPreview } from '@/hooks/useEnrollmentPreview';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  X, Check, CheckCircle, AlertTriangle,
  Sparkles, RefreshCw, Pencil, Eye, Send, Users, Mail, MessageSquare,
  Linkedin, Loader2, ChevronLeft, ChevronRight, Search, Zap,
  Clock, GitBranch, ListChecks,
} from 'lucide-react';
import { CandidateSidebarCard } from './enrollment-preview/CandidateSidebarCard';
import { CandidateContextHeader } from './enrollment-preview/CandidateContextHeader';
import { ScoringPopover } from './enrollment-preview/ScoringPopover';
import { HistoryPopover } from './enrollment-preview/HistoryPopover';
import { DynamicSummaryBanner } from './enrollment-preview/DynamicSummaryBanner';
import { CandidateStatesMap, CandidateState } from './enrollment-preview/types';

// ── Types ──

interface EnrollmentPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  sequence: {
    id: string;
    name: string;
    steps: any[];
  };
  profiles: LinkedInProfile[];
  accountId: string;
  job?: { id: string; title: string; client?: any; skills?: string[]; description?: string; location?: string; accompagnement?: string[] } | null;
  onSuccess: () => void;
}

// ── Helpers ──

const ACTION_ICONS: Record<string, typeof Mail> = {
  email: Mail,
  message: MessageSquare,
  smart_message: MessageSquare,
  inmail: Linkedin,
  connection_request: Linkedin,
  whatsapp_message: MessageSquare,
  profile_visit: Eye,
  wait_connection: Clock,
  wait_reply: Clock,
  wait_profile_visit: Clock,
  check_connection: GitBranch,
  condition_branch: GitBranch,
};

const ACTION_LABELS: Record<string, string> = {
  email: 'Email',
  message: 'Message LinkedIn',
  smart_message: 'Smart Message',
  inmail: 'InMail',
  connection_request: 'Invitation LinkedIn',
  whatsapp_message: 'WhatsApp',
  profile_visit: 'Visite de profil',
  wait_connection: 'Attendre connexion',
  wait_reply: 'Attendre réponse',
  wait_profile_visit: 'Attendre visite',
  check_connection: 'Vérifier connexion',
  condition_branch: 'Condition',
};

const CHANNEL_COLORS: Record<string, { header: string; border: string }> = {
  email: { header: 'text-info-foreground', border: 'border-border' },
  message: { header: 'text-sky-600 dark:text-sky-400', border: 'border-border' },
  smart_message: { header: 'text-sky-600 dark:text-sky-400', border: 'border-border' },
  inmail: { header: 'text-indigo-600 dark:text-indigo-400', border: 'border-border' },
  connection_request: { header: 'text-violet-600 dark:text-violet-400', border: 'border-border' },
  whatsapp_message: { header: 'text-green-600 dark:text-green-400', border: 'border-border' },
};

function mapSteps(rawSteps: any[]): SequenceStepPreview[] {
  return rawSteps.map(s => ({
    stepId: s.id,
    stepOrder: s.step_order ?? s.stepOrder ?? 0,
    actionType: s.action_type || s.actionType || 'message',
    channel: s.step_channel || s.channel,
    messageTemplate: s.message_template || s.messageTemplate || '',
    subjectTemplate: s.subject_template || s.subjectTemplate || '',
    useAiPersonalization: s.use_ai_personalization ?? s.useAiPersonalization ?? false,
    aiTone: s.ai_tone || s.aiTone || 'professional',
    delayDays: s.delay_days ?? s.delayDays ?? 0,
    delayHours: s.delay_hours ?? s.delayHours ?? 0,
    delayMinutes: s.delay_minutes ?? s.delayMinutes ?? 0,
    condition: s.condition,
    timeoutDays: s.timeout_days ?? s.timeoutDays,
    timeoutBranchStepId: s.timeout_branch_step_id || s.timeoutBranchStepId || null,
    parentStepId: s.parent_step_id || s.parentStepId || null,
    branch: s.branch || null,
  })).sort((a, b) => a.stepOrder - b.stepOrder);
}

const MESSAGE_ACTIONS = ['message', 'inmail', 'smart_message', 'email', 'connection_request', 'whatsapp_message'];

// ── Component ──

export const EnrollmentPreviewModal: React.FC<EnrollmentPreviewModalProps> = ({
  isOpen,
  onClose,
  sequence,
  profiles,
  accountId,
  job,
  onSuccess,
}) => {
  const steps = useMemo(() => mapSteps(sequence.steps), [sequence.steps]);
  const isSingle = profiles.length === 1;
  const isBulk = profiles.length > 10;
  const candidateIds = useMemo(() => profiles.map(profile => profile.id), [profiles]);
  const firstProfileId = candidateIds[0] ?? '';

  const {
    messageSteps, hasMessageSteps, hasAiSteps,
    generatedCount, totalToGenerate, isBulkGenerating,
    estimatedCredits, candidateAnalysis,
    getPreview, generateForCandidateById, regenerateStep,
    editMessage, generateAll, cancelBulkGeneration, getMessageOverrides,
  } = useEnrollmentPreview({ steps, profiles, job, accountId });

  const [selectedCandidateId, setSelectedCandidateId] = useState<string>(firstProfileId);
  const [mode, setMode] = useState<'preview' | 'summary'>(
    !hasMessageSteps ? 'summary' : (isBulk ? 'summary' : 'preview')
  );
  const [editingSteps, setEditingSteps] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [enrollResults, setEnrollResults] = useState<{ success: number; skipped: number; errors: string[] } | null>(null);
  const [page, setPage] = useState(0);
  const [mobilePane, setMobilePane] = useState<'list' | 'preview'>('preview');
  const pageSize = 10;

  // ── Candidate states (remove/skip) ──
  const [candidateStates, setCandidateStates] = useState<CandidateStatesMap>(new Map());
  const [scoringPopoverId, setScoringPopoverId] = useState<string | null>(null);
  const [historyPopoverId, setHistoryPopoverId] = useState<string | null>(null);
  // Score cache
  const [scoreCache, setScoreCache] = useState<Map<string, { score: number | null; recommendation: string | null }>>(new Map());
  const scoreFetchedRef = useRef(false);

  // Fetch scores for all candidates at mount
  useEffect(() => {
    if (scoreFetchedRef.current || !job?.id || profiles.length === 0) return;
    scoreFetchedRef.current = true;

    const fetchScores = async () => {
      const { data } = await supabase
        .from('job_candidate_status')
        .select('candidate_id, score, recommendation')
        .eq('job_id', job!.id)
        .in('candidate_id', profiles.map(p => p.id));

      if (data) {
        const map = new Map<string, { score: number | null; recommendation: string | null }>();
        data.forEach((r: any) => map.set(r.candidate_id, { score: r.score, recommendation: r.recommendation }));
        setScoreCache(map);
      }
    };
    fetchScores();
  }, [job?.id, profiles]);

  const getCandidateState = useCallback((id: string): CandidateState =>
    candidateStates.get(id) || { removed: false, skipped: false }, [candidateStates]);

  const handleRemoveCandidate = useCallback((id: string) => {
    const name = profiles.find(p => p.id === id)?.name || 'Candidat';
    setCandidateStates(prev => {
      const next = new Map(prev);
      next.set(id, { ...getCandidateState(id), removed: true });
      return next;
    });
    toast(`${name} retiré de la sélection`, {
      action: {
        label: 'Annuler',
        onClick: () => {
          setCandidateStates(prev => {
            const next = new Map(prev);
            next.set(id, { ...getCandidateState(id), removed: false });
            return next;
          });
        },
      },
    });
  }, [profiles, getCandidateState]);

  const handleSkipCandidate = useCallback((id: string) => {
    setCandidateStates(prev => {
      const next = new Map(prev);
      const current = getCandidateState(id);
      next.set(id, { ...current, skipped: !current.skipped });
      return next;
    });
  }, [getCandidateState]);

  // Active profiles (not removed, not skipped)
  const activeProfiles = useMemo(() =>
    profiles.filter(p => {
      const s = getCandidateState(p.id);
      return !s.removed && !s.skipped;
    }), [profiles, getCandidateState, candidateStates]);

  useEffect(() => {
    if (!candidateIds.length) {
      if (selectedCandidateId) setSelectedCandidateId('');
      return;
    }
    if (!selectedCandidateId || !candidateIds.includes(selectedCandidateId)) {
      setSelectedCandidateId(candidateIds[0]);
    }
  }, [candidateIds, selectedCandidateId]);

  // Auto-generate for single candidate
  useEffect(() => {
    if (isSingle && hasMessageSteps && mode === 'preview' && selectedCandidateId) {
      generateForCandidateById(selectedCandidateId);
    }
  }, [isSingle, hasMessageSteps, mode, selectedCandidateId]);

  // Auto-generate first candidate in list mode
  useEffect(() => {
    if (!isSingle && !isBulk && hasMessageSteps && mode === 'preview' && firstProfileId && selectedCandidateId === firstProfileId) {
      generateForCandidateById(firstProfileId);
    }
  }, [isSingle, isBulk, hasMessageSteps, mode, firstProfileId, selectedCandidateId]);

  const selectedProfile = useMemo(
    () => profiles.find(p => p.id === selectedCandidateId) ?? null,
    [profiles, selectedCandidateId]
  );

  const filteredProfiles = useMemo(() => {
    const list = profiles.filter(p => !getCandidateState(p.id).removed);
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.headline || '').toLowerCase().includes(q)
    );
  }, [profiles, searchQuery, candidateStates, getCandidateState]);

  const pagedProfiles = useMemo(() => {
    return filteredProfiles.slice(page * pageSize, (page + 1) * pageSize);
  }, [filteredProfiles, page]);

  const totalPages = Math.ceil(filteredProfiles.length / pageSize);

  useEffect(() => { setPage(0); }, [searchQuery]);

  useEffect(() => {
    if (page > 0 && page >= totalPages) setPage(Math.max(totalPages - 1, 0));
  }, [page, totalPages]);

  const handleSelectCandidate = (id: string) => {
    setSelectedCandidateId(id);
    setMobilePane('preview');
    const existing = messageSteps.every(s => getPreview(id, s.stepId)?.isGenerated);
    if (!existing) generateForCandidateById(id);
  };

  const toggleEditing = (stepId: string) => {
    setEditingSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  // ── Keyboard shortcuts ──
  useEffect(() => {
    if (!isOpen || mode !== 'preview' || enrollResults) return;

    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const currentIdx = filteredProfiles.findIndex(p => p.id === selectedCandidateId);

      if (e.key === 'ArrowDown' && currentIdx < filteredProfiles.length - 1) {
        e.preventDefault();
        handleSelectCandidate(filteredProfiles[currentIdx + 1].id);
      } else if (e.key === 'ArrowUp' && currentIdx > 0) {
        e.preventDefault();
        handleSelectCandidate(filteredProfiles[currentIdx - 1].id);
      } else if ((e.key === 'Delete' || e.key === 'x') && selectedCandidateId) {
        e.preventDefault();
        handleRemoveCandidate(selectedCandidateId);
      } else if (e.key === ' ' && selectedCandidateId) {
        e.preventDefault();
        handleSkipCandidate(selectedCandidateId);
      } else if (e.key === 'Enter' && selectedCandidateId) {
        e.preventDefault();
        generateForCandidateById(selectedCandidateId);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, mode, enrollResults, filteredProfiles, selectedCandidateId, handleRemoveCandidate, handleSkipCandidate]);

  // ── Enrollment Logic ──

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const handleEnroll = async () => {
    setIsEnrolling(true);
    setEnrollResults(null);
    const results = { success: 0, skipped: 0, errors: [] as string[] };

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || '00000000-0000-0000-0000-000000000000';
      const firstStep = sequence.steps.find((s: any) => (s.step_order ?? s.stepOrder) === 0) || sequence.steps[0];

      for (const profile of activeProfiles) {
        try {
          const { data: existing } = await supabase
            .from('sequence_enrollments')
            .select('id, status')
            .eq('sequence_id', sequence.id)
            .eq('profile_id', profile.id)
            .in('status', ['active', 'completed', 'replied'])
            .maybeSingle();

          if (existing) { results.skipped++; continue; }

          const networkDist = profile.network_distance;
          const normalizedDistance = networkDist === 1 || networkDist === '1' || networkDist === 'DISTANCE_1'
            ? 'FIRST_DEGREE'
            : networkDist === 2 || networkDist === '2' || networkDist === 'DISTANCE_2'
            ? 'SECOND_DEGREE'
            : networkDist === 3 || networkDist === '3' || networkDist === 'DISTANCE_3'
            ? 'THIRD_DEGREE'
            : typeof networkDist === 'string' ? networkDist : null;

          const overrides = getMessageOverrides(profile.id);

          const { data: enrollment, error: enrollError } = await supabase
            .from('sequence_enrollments')
            .insert({
              sequence_id: sequence.id,
              account_id: accountId,
              profile_id: profile.id,
              profile_name: profile.name,
              profile_headline: profile.headline,
              profile_url: profile.profile_url || profile.public_profile_url,
              job_id: job?.id,
              job_title: job?.title,
              created_by: userId,
              user_timezone: userTimezone,
              current_step_order: 0,
              status: 'active',
              network_distance: normalizedDistance,
              ...(Object.keys(overrides).length > 0 ? { tracking_data: { message_overrides: overrides } } : {}),
            })
            .select()
            .single();

          if (enrollError) throw enrollError;
          if (!enrollment) throw new Error('Enrollment non créé');

          if (firstStep) {
            const stepId = firstStep.id;
            const scheduledAt = new Date();
            scheduledAt.setTime(scheduledAt.getTime()
              + (firstStep.delay_days || 0) * 86400000
              + (firstStep.delay_hours || 0) * 3600000
              + (firstStep.delay_minutes || 0) * 60000
            );

            await supabase
              .from('sequence_step_executions')
              .insert({
                enrollment_id: enrollment.id,
                step_id: stepId,
                step_order: firstStep.step_order ?? firstStep.stepOrder ?? 0,
                scheduled_at: scheduledAt.toISOString(),
                status: 'scheduled',
              });
          }

          results.success++;

          if (job?.id) {
            await supabase
              .from('job_candidate_status')
              .upsert({
                job_id: job.id,
                candidate_id: profile.id,
                candidate_name: profile.name || null,
                candidate_headline: profile.headline || null,
                linkedin_profile_url: profile.profile_url || profile.public_profile_url || null,
                status: 'messaged',
                created_by: userId,
              }, { onConflict: 'job_id,candidate_id,created_by' });
          }
        } catch (err: any) {
          results.errors.push(`${profile.name}: ${err?.message || 'Erreur'}`);
        }
      }

      setEnrollResults(results);
      if (results.success > 0) toast.success(`${results.success} candidat(s) inscrits dans la séquence`);
      if (results.skipped > 0) toast.info(`${results.skipped} candidat(s) déjà inscrits`);
    } catch {
      toast.error("Erreur lors de l'inscription");
    } finally {
      setIsEnrolling(false);
    }
  };

  // ── Shortlist without message ──
  const handleShortlist = async () => {
    if (!job?.id) {
      toast.error("Aucun poste associé pour la shortlist");
      return;
    }
    setIsEnrolling(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || '00000000-0000-0000-0000-000000000000';
      let count = 0;

      for (const profile of activeProfiles) {
        await supabase
          .from('job_candidate_status')
          .upsert({
            job_id: job.id,
            candidate_id: profile.id,
            candidate_name: profile.name || null,
            candidate_headline: profile.headline || null,
            linkedin_profile_url: profile.profile_url || profile.public_profile_url || null,
            status: 'shortlisted',
            created_by: userId,
          }, { onConflict: 'job_id,candidate_id,created_by' });
        count++;
      }

      toast.success(`${count} candidat(s) ajouté(s) à la shortlist`);
      onSuccess();
    } catch {
      toast.error("Erreur lors de l'ajout à la shortlist");
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleClose = () => {
    if (enrollResults?.success) onSuccess();
    else onClose();
  };

  if (!isOpen) return null;

  // ── Render ──

  const content = (
    <div className="fixed inset-0 z-[4000] bg-background/95 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="border-b border-border shrink-0 bg-background">
        <div className="flex items-center justify-between px-3 sm:px-6 h-12 sm:h-14">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button onClick={handleClose} className="p-1.5 hover:bg-muted rounded-md transition-colors shrink-0">
              <X className="w-4 h-4" />
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="text-[13px] sm:text-sm font-semibold truncate">
                Inscription · {sequence.name}
              </h2>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground">
                {activeProfiles.length} candidat{activeProfiles.length > 1 ? 's' : ''} · {sequence.steps.length} étape{sequence.steps.length > 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {hasMessageSteps && mode !== 'summary' && (
              <Badge variant="outline" className="text-[10px] gap-1 hidden sm:inline-flex">
                <Eye className="w-3 h-3" />
                Preview {generatedCount}/{totalToGenerate}
              </Badge>
            )}
            {hasMessageSteps && !enrollResults && (
              <div className="flex items-center border border-border rounded-md overflow-hidden">
                <button
                  onClick={() => setMode('summary')}
                  className={cn(
                    "px-2.5 sm:px-3 h-7 text-[11px] font-medium transition-colors",
                    mode === 'summary' ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Résumé
                </button>
                <button
                  onClick={() => setMode('preview')}
                  className={cn(
                    "px-2.5 sm:px-3 h-7 text-[11px] font-medium transition-colors",
                    mode === 'preview' ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Previews
                </button>
              </div>
            )}
          </div>
        </div>
        {/* Mobile preview counter */}
        {hasMessageSteps && mode !== 'summary' && (
          <div className="sm:hidden px-3 pb-2 -mt-1">
            <span className="text-[10px] text-muted-foreground">
              ✨ Previews : {generatedCount}/{totalToGenerate} · ~{estimatedCredits} crédits
            </span>
          </div>
        )}
      </div>

      {/* Dynamic summary banner */}
      {mode === 'preview' && !enrollResults && !isSingle && (
        <DynamicSummaryBanner
          profiles={profiles}
          states={candidateStates}
          generatedCount={generatedCount}
          totalToGenerate={totalToGenerate}
          estimatedCredits={estimatedCredits}
          hasAiSteps={hasAiSteps}
        />
      )}

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        <AnimatePresence initial={false}>
          {enrollResults ? (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex-1 flex items-center justify-center p-8"
            >
              <EnrollmentResults results={enrollResults} onClose={handleClose} />
            </motion.div>
          ) : mode === 'summary' ? (
            <motion.div
              key="summary"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex-1 overflow-y-auto"
            >
              <SummaryMode
                profiles={profiles}
                activeProfiles={activeProfiles}
                steps={steps}
                candidateAnalysis={candidateAnalysis}
                estimatedCredits={estimatedCredits}
                hasAiSteps={hasAiSteps}
                hasMessageSteps={hasMessageSteps}
                isBulk={isBulk}
                onSwitchToPreview={() => setMode('preview')}
                isEnrolling={isEnrolling}
                onEnroll={handleEnroll}
                onShortlist={handleShortlist}
                onClose={handleClose}
                jobId={job?.id}
              />
            </motion.div>
          ) : (
            <motion.div
              key="preview"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="flex-1 flex flex-col sm:flex-row overflow-hidden"
            >
              {/* Mobile pane toggle */}
              {!isSingle && (
                <div className="sm:hidden flex items-center border-b border-border bg-muted/10">
                  <button
                    onClick={() => setMobilePane('list')}
                    className={cn(
                      "flex-1 py-2 text-[11px] font-medium text-center transition-colors",
                      mobilePane === 'list' ? "text-foreground border-b-2 border-primary" : "text-muted-foreground"
                    )}
                  >
                    Candidats ({activeProfiles.length})
                  </button>
                  <button
                    onClick={() => setMobilePane('preview')}
                    className={cn(
                      "flex-1 py-2 text-[11px] font-medium text-center transition-colors",
                      mobilePane === 'preview' ? "text-foreground border-b-2 border-primary" : "text-muted-foreground"
                    )}
                  >
                    Aperçu
                  </button>
                </div>
              )}

              {/* Candidate Sidebar — hidden on mobile when viewing preview */}
              {!isSingle && (
                <div className={cn(
                  "w-full sm:w-72 border-b sm:border-b-0 sm:border-r border-border bg-muted/10 flex flex-col shrink-0",
                  "sm:flex",
                  mobilePane === 'list' ? "flex flex-1 sm:flex-none" : "hidden sm:flex"
                )}>
                  <div className="p-2 border-b border-border">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Rechercher…"
                        className="w-full h-7 pl-7 pr-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="p-1 space-y-0.5">
                      {pagedProfiles.map(p => {
                        const allGenerated = messageSteps.every(s => getPreview(p.id, s.stepId)?.isGenerated);
                        const hasEdits = messageSteps.some(s => getPreview(p.id, s.stepId)?.isEdited);
                        const state = getCandidateState(p.id);
                        const cachedScore = scoreCache.get(p.id);

                        return (
                          <React.Fragment key={p.id}>
                            <ScoringPopover
                              candidateId={p.id}
                              jobId={job?.id}
                              isOpen={scoringPopoverId === p.id}
                              onOpenChange={open => setScoringPopoverId(open ? p.id : null)}
                            >
                              <HistoryPopover
                                candidateId={p.id}
                                linkedinUrl={p.profile_url || p.public_profile_url || null}
                                isOpen={historyPopoverId === p.id}
                                onOpenChange={open => setHistoryPopoverId(open ? p.id : null)}
                              >
                                <div>
                                  <CandidateSidebarCard
                                    profile={p}
                                    isSelected={p.id === selectedCandidateId}
                                    allGenerated={allGenerated}
                                    hasEdits={hasEdits}
                                    state={state}
                                    score={cachedScore?.score}
                                    onSelect={() => handleSelectCandidate(p.id)}
                                    onRemove={() => handleRemoveCandidate(p.id)}
                                    onSkip={() => handleSkipCandidate(p.id)}
                                    onViewScoring={() => setScoringPopoverId(p.id)}
                                    onViewHistory={() => setHistoryPopoverId(p.id)}
                                  />
                                </div>
                              </HistoryPopover>
                            </ScoringPopover>
                          </React.Fragment>
                        );
                      })}
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between px-2 py-1.5 border-t border-border">
                        <button
                          onClick={() => setPage(p => Math.max(0, p - 1))}
                          disabled={page === 0}
                          className="p-1 disabled:opacity-30"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[10px] text-muted-foreground">
                          {page * pageSize + 1}-{Math.min((page + 1) * pageSize, filteredProfiles.length)} / {filteredProfiles.length}
                        </span>
                        <button
                          onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                          disabled={page >= totalPages - 1}
                          className="p-1 disabled:opacity-30"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </ScrollArea>
                </div>
              )}

              {/* Preview Panel — hidden on mobile when viewing list */}
              <div className={cn(
                "flex-1 flex flex-col overflow-hidden",
                !isSingle && mobilePane === 'list' ? "hidden sm:flex" : "flex"
              )}>
                {/* Bulk generation bar */}
                {!isSingle && hasAiSteps && (
                  <div className="px-4 py-2 border-b border-border bg-muted/10 flex items-center gap-3">
                    {isBulkGenerating ? (
                      <>
                        <Progress value={(generatedCount / totalToGenerate) * 100} className="flex-1 h-1.5" />
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {generatedCount}/{totalToGenerate}
                        </span>
                        <Button size="sm" variant="ghost" onClick={cancelBulkGeneration} className="h-6 px-2 text-[10px]">
                          Annuler
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => generateAll(3)}
                          className="h-7 px-3 text-[11px] gap-1.5"
                        >
                          <Zap className="w-3 h-3" />
                          Générer toutes les previews
                        </Button>
                        <span className="text-[10px] text-muted-foreground">
                          ~{estimatedCredits} crédits
                        </span>
                      </>
                    )}
                  </div>
                )}

                {/* Message previews */}
                <ScrollArea className="flex-1 p-4 sm:p-6">
                  {selectedProfile ? (
                    <div className="max-w-2xl mx-auto space-y-4">
                      {/* Enriched candidate context header */}
                      <CandidateContextHeader
                        profile={selectedProfile}
                        score={scoreCache.get(selectedProfile.id)}
                        linkedinUrl={selectedProfile.profile_url || selectedProfile.public_profile_url || null}
                      />

                      {/* Steps */}
                      {steps.map((step, idx) => {
                        const isMessageStep = MESSAGE_ACTIONS.includes(step.actionType) && !!step.messageTemplate?.trim();
                        const Icon = ACTION_ICONS[step.actionType] || MessageSquare;

                        if (!isMessageStep) {
                          return (
                            <CompactStepCard
                              key={step.stepId}
                              step={step}
                              Icon={Icon}
                              index={idx}
                            />
                          );
                        }

                        const preview = getPreview(selectedCandidateId, step.stepId);
                        const isEditing = editingSteps.has(step.stepId);

                        return (
                          <MessageStepCard
                            key={step.stepId}
                            step={step}
                            preview={preview}
                            isEditing={isEditing}
                            Icon={Icon}
                            index={idx}
                            candidateId={selectedCandidateId}
                            onToggleEdit={() => toggleEditing(step.stepId)}
                            onRegenerate={() => regenerateStep(selectedCandidateId, step.stepId)}
                            onEditMessage={(field, value) => editMessage(selectedCandidateId, step.stepId, field, value)}
                            onGenerate={() => generateForCandidateById(selectedCandidateId)}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <PreviewPanelFallback hasProfiles={profiles.length > 0} />
                  )}
                </ScrollArea>

                {/* Bottom bar — 3 buttons */}
                <div className="px-4 sm:px-6 py-3 border-t border-border bg-background flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:justify-between">
                  <Button variant="ghost" onClick={handleClose} className="h-8 px-3 text-xs text-muted-foreground">
                    Annuler
                  </Button>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    {job?.id && (
                      <Button
                        variant="outline"
                        onClick={handleShortlist}
                        disabled={isEnrolling || activeProfiles.length === 0}
                        className="h-8 px-3 text-xs gap-1.5"
                      >
                        <ListChecks className="w-3.5 h-3.5" />
                        Shortlister sans message
                      </Button>
                    )}
                    <Button
                      onClick={handleEnroll}
                      disabled={isEnrolling || activeProfiles.length === 0}
                      className="h-8 px-4 text-xs gap-1.5 bg-foreground text-background hover:bg-foreground/90"
                    >
                      {isEnrolling ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Inscription…
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5" />
                          Enrôler {activeProfiles.length} candidat{activeProfiles.length > 1 ? 's' : ''}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  return createPortal(content, document.body);
};

// ── Sub-components ──

function CompactStepCard({ step, Icon, index }: { step: SequenceStepPreview; Icon: typeof Mail; index: number }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-muted/30 rounded-lg border border-border/50">
      <div className="flex items-center justify-center w-6 h-6 rounded-md bg-muted">
        <Icon className="w-3 h-3 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-medium">{ACTION_LABELS[step.actionType] || step.actionType}</span>
        {(step.delayDays || step.delayHours) ? (
          <span className="text-[10px] text-muted-foreground ml-2">
            +{step.delayDays ? `${step.delayDays}j` : ''}{step.delayHours ? `${step.delayHours}h` : ''}
          </span>
        ) : null}
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums">#{index + 1}</span>
    </div>
  );
}

function MessageStepCard({
  step, preview, isEditing, Icon, index, candidateId,
  onToggleEdit, onRegenerate, onEditMessage, onGenerate,
}: {
  step: SequenceStepPreview;
  preview: ReturnType<ReturnType<typeof useEnrollmentPreview>['getPreview']>;
  isEditing: boolean;
  Icon: typeof Mail;
  index: number;
  candidateId: string;
  onToggleEdit: () => void;
  onRegenerate: () => void;
  onEditMessage: (field: 'subject' | 'message', value: string) => void;
  onGenerate: () => void;
}) {
  const colorClass = CHANNEL_COLORS[step.actionType] || 'bg-muted/30 text-foreground border-border/50';

  return (
    <div className={cn("rounded-lg border overflow-hidden", colorClass)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-current/10">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5" />
          <span className="text-[11px] font-semibold">{ACTION_LABELS[step.actionType]}</span>
          <span className="text-[10px] opacity-60">#{index + 1}</span>
        </div>
        {step.useAiPersonalization && (
          <Badge className="text-[9px] h-4 px-1.5 bg-current/10 text-current border-0 gap-0.5">
            <Sparkles className="w-2.5 h-2.5" /> IA
          </Badge>
        )}
        {preview?.isEdited && (
          <Badge className="text-[9px] h-4 px-1.5 bg-warning/10 text-warning-foreground border-0">
            Modifié
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {preview?.isGenerated && (
            <>
              <button onClick={onRegenerate} className="p-1 rounded hover:bg-current/10 transition-colors" title="Regénérer">
                <RefreshCw className="w-3 h-3" />
              </button>
              <button
                onClick={onToggleEdit}
                className={cn("p-1 rounded transition-colors", isEditing ? "bg-current/15" : "hover:bg-current/10")}
                title={isEditing ? "Voir" : "Modifier"}
              >
                <Pencil className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="px-3 py-3 bg-background/80">
        {preview?.isGenerating ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : preview?.isGenerated || preview?.error ? (
          <div className="space-y-2">
            {preview.error && (
              <div className="flex items-center gap-1.5 text-[11px] text-warning-foreground mb-2">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                {preview.error}
              </div>
            )}
            {step.actionType === 'email' && (
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Objet</label>
                {isEditing ? (
                  <Input
                    value={preview?.subject || ''}
                    onChange={e => onEditMessage('subject', e.target.value)}
                    className="h-7 text-xs mt-0.5"
                  />
                ) : (
                  <p className="text-xs font-medium mt-0.5">{preview?.subject || '—'}</p>
                )}
              </div>
            )}
            <div>
              {step.actionType === 'email' && (
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Message</label>
              )}
              {isEditing ? (
                <Textarea
                  value={(preview?.message || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')}
                  onChange={e => onEditMessage('message', e.target.value)}
                  className="min-h-[100px] text-xs mt-0.5 resize-y"
                />
              ) : (
                <div
                  className="text-xs leading-relaxed mt-0.5 whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: preview?.message || '' }}
                />
              )}
            </div>
            {preview?.personalizationPoints && preview.personalizationPoints.length > 0 && (
              <div className="pt-1 border-t border-current/5">
                <p className="text-[10px] text-muted-foreground mb-1">Points de personnalisation</p>
                <div className="flex flex-wrap gap-1">
                  {preview.personalizationPoints.map((pt, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 bg-muted/50 rounded">
                      {pt}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={onGenerate}
            className="w-full py-4 flex flex-col items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Eye className="w-5 h-5" />
            <span className="text-xs">Cliquez pour générer la preview</span>
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryMode({
  profiles, activeProfiles, steps, candidateAnalysis, estimatedCredits, hasAiSteps, hasMessageSteps, isBulk,
  onSwitchToPreview, isEnrolling, onEnroll, onShortlist, onClose, jobId,
}: {
  profiles: LinkedInProfile[];
  activeProfiles: LinkedInProfile[];
  steps: SequenceStepPreview[];
  candidateAnalysis: { total: number; withEmail: number; withoutEmail: number; withPhone: number; withoutPhone: number };
  estimatedCredits: number;
  hasAiSteps: boolean;
  hasMessageSteps: boolean;
  isBulk: boolean;
  onSwitchToPreview: () => void;
  isEnrolling: boolean;
  onEnroll: () => void;
  onShortlist: () => void;
  onClose: () => void;
  jobId?: string;
}) {
  const emailSteps = steps.filter(s => s.actionType === 'email');
  const whatsappSteps = steps.filter(s => s.actionType === 'whatsapp_message');

  return (
    <div className="max-w-xl mx-auto p-6 sm:p-8 space-y-6">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 mx-auto rounded-xl bg-accent/50 flex items-center justify-center">
          <GitBranch className="w-6 h-6 text-foreground" />
        </div>
        <h3 className="text-lg font-semibold">Récapitulatif de l'enrollment</h3>
        <p className="text-sm text-muted-foreground">
          {activeProfiles.length} candidat{activeProfiles.length > 1 ? 's' : ''} sélectionné{activeProfiles.length > 1 ? 's' : ''}
        </p>
      </div>

      <div className="space-y-2">
        <SummaryRow icon={CheckCircle} color="text-success-foreground" label="Candidats avec LinkedIn" count={activeProfiles.length} />
        {candidateAnalysis.withEmail > 0 && (
          <SummaryRow icon={Mail} color="text-info-foreground" label="Avec email" count={candidateAnalysis.withEmail} />
        )}
        {candidateAnalysis.withoutEmail > 0 && emailSteps.length > 0 && (
          <SummaryRow icon={AlertTriangle} color="text-warning-foreground" label="Sans email (steps email skippés)" count={candidateAnalysis.withoutEmail} />
        )}
        {candidateAnalysis.withoutPhone > 0 && whatsappSteps.length > 0 && (
          <SummaryRow icon={AlertTriangle} color="text-warning-foreground" label="Sans téléphone (steps WhatsApp skippés)" count={candidateAnalysis.withoutPhone} />
        )}
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-muted/30 border-b border-border">
          <span className="text-[11px] font-medium uppercase tracking-wider">Séquence — {steps.length} étapes</span>
        </div>
        <div className="p-2 space-y-1">
          {steps.slice(0, 6).map((step, i) => {
            const Icon = ACTION_ICONS[step.actionType] || MessageSquare;
            return (
              <div key={step.stepId} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                <span className="text-[10px] text-muted-foreground tabular-nums w-4">#{i + 1}</span>
                <Icon className="w-3 h-3 text-muted-foreground" />
                <span>{ACTION_LABELS[step.actionType]}</span>
                {step.useAiPersonalization && <Sparkles className="w-2.5 h-2.5 text-amber-500" />}
                {(step.delayDays || step.delayHours) ? (
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    +{step.delayDays ? `${step.delayDays}j` : ''}{step.delayHours ? `${step.delayHours}h` : ''}
                  </span>
                ) : null}
              </div>
            );
          })}
          {steps.length > 6 && (
            <p className="text-[10px] text-muted-foreground text-center py-1">
              +{steps.length - 6} autres étapes
            </p>
          )}
        </div>
      </div>

      {hasAiSteps && (
        <div className="flex items-center gap-2 px-3 py-2 bg-warning/10 border border-warning/20 rounded-lg text-xs text-warning-foreground">
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span>Estimation : ~{estimatedCredits} crédits IA ({hasMessageSteps ? 'personnalisation' : 'génération'})</span>
        </div>
      )}

      {/* 3-button footer */}
      <div className="flex flex-col gap-2 pt-2">
        {hasMessageSteps && (
          <Button
            variant="outline"
            onClick={onSwitchToPreview}
            className="w-full h-9 gap-2 text-xs"
          >
            <Eye className="w-3.5 h-3.5" />
            Ouvrir la préparation des previews
          </Button>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={onClose} className="sm:flex-1 h-9 text-xs text-muted-foreground">
            Annuler
          </Button>
          {jobId && (
            <Button
              variant="outline"
              onClick={onShortlist}
              disabled={isEnrolling || activeProfiles.length === 0}
              className="sm:flex-1 h-9 gap-1.5 text-xs"
            >
              <ListChecks className="w-3.5 h-3.5" />
              Shortlister sans message
            </Button>
          )}
          <Button
            onClick={onEnroll}
            disabled={isEnrolling || activeProfiles.length === 0}
            className="sm:flex-1 h-10 gap-2 bg-foreground text-background hover:bg-foreground/90"
          >
            {isEnrolling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Inscription en cours…
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Enrôler {activeProfiles.length} candidat{activeProfiles.length > 1 ? 's' : ''}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ icon: Icon, color, label, count }: { icon: typeof Mail; color: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-muted/20 rounded-lg">
      <Icon className={cn("w-4 h-4 shrink-0", color)} />
      <span className="text-sm flex-1">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{count}</span>
    </div>
  );
}

function EnrollmentResults({ results, onClose }: { results: { success: number; skipped: number; errors: string[] }; onClose: () => void }) {
  return (
    <div className="max-w-md w-full text-center space-y-6">
      <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center">
        <CheckCircle className="w-8 h-8 text-success-foreground" />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Enrollment terminé</h3>
        {results.success > 0 && (
          <p className="text-sm text-success-foreground">
            ✅ {results.success} candidat{results.success > 1 ? 's' : ''} inscrit{results.success > 1 ? 's' : ''} avec succès
          </p>
        )}
        {results.skipped > 0 && (
          <p className="text-sm text-muted-foreground">
            ⏭️ {results.skipped} déjà inscrit{results.skipped > 1 ? 's' : ''}
          </p>
        )}
        {results.errors.length > 0 && (
          <div className="text-sm text-destructive text-left bg-destructive/5 rounded-lg p-3 mt-2">
            {results.errors.map((err, i) => (
              <p key={i} className="text-xs">{err}</p>
            ))}
          </div>
        )}
      </div>
      <Button onClick={onClose} className="bg-foreground text-background">
        Fermer
      </Button>
    </div>
  );
}

function PreviewPanelFallback({ hasProfiles }: { hasProfiles: boolean }) {
  if (!hasProfiles) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center text-sm text-muted-foreground">
        Aucun candidat sélectionné.
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-3 pb-4 border-b border-border">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      </div>

      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-muted/20">
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="px-3 py-3 space-y-2 bg-background/80">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

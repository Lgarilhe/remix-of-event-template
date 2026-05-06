import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LinkedInProfile } from '@/components/outreach/types';
import { useEnrollmentPreview, SequenceStepPreview } from '@/hooks/useEnrollmentPreview';
import { BulkEnrichButton } from '@/components/outreach/result-card/BulkEnrichButton';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { AiTextarea } from '@/components/ai/AiTextarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  X, Check, CheckCircle, AlertTriangle, AlertCircle,
  Sparkles, RefreshCw, Pencil, Eye, Send, Users, Mail, MessageSquare,
  Loader2, ChevronLeft, ChevronRight, Search, Zap,
  Clock, GitBranch, ListChecks,
} from 'lucide-react';
import { CandidateSidebarCard } from './enrollment-preview/CandidateSidebarCard';
import { SequenceTreeView } from './enrollment-preview/SequenceTreeView';
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

// Logos officiels pour LinkedIn et WhatsApp (cohérence avec le reste du
// site qui utilise les vrais logos plutôt que les icônes génériques Lucide).
import linkedinLogo from '@/assets/linkedin-logo.svg';
import whatsappLogo from '@/assets/whatsapp-logo.svg';

const makeBrandIcon = (src: string): typeof Mail => {
  const BrandIcon: any = ({ className }: { className?: string }) => (
    <img
      src={src}
      alt=""
      className={`object-contain ${className || ''}`}
      aria-hidden="true"
    />
  );
  BrandIcon.displayName = 'BrandIcon';
  return BrandIcon as typeof Mail;
};

const LinkedInBrand = makeBrandIcon(linkedinLogo);
const WhatsAppBrand = makeBrandIcon(whatsappLogo);

const ACTION_ICONS: Record<string, typeof Mail> = {
  email: Mail,
  message: LinkedInBrand,
  smart_message: LinkedInBrand,
  inmail: LinkedInBrand,
  connection_request: LinkedInBrand,
  whatsapp_message: WhatsAppBrand,
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

// Channel colors via design tokens. Backgrounds harmonisés avec les
// vrais logos de marque (LinkedIn = bleu/info, WhatsApp = vert/success,
// Email = neutre).
const CHANNEL_COLORS: Record<string, { header: string; border: string }> = {
  email: { header: 'bg-foreground/[0.06] text-foreground/70', border: 'border-border' },
  message: { header: 'bg-info/10 text-info', border: 'border-border' },
  smart_message: { header: 'bg-info/10 text-info', border: 'border-border' },
  inmail: { header: 'bg-info/10 text-info', border: 'border-border' },
  connection_request: { header: 'bg-info/10 text-info', border: 'border-border' },
  whatsapp_message: { header: 'bg-success/10 text-success', border: 'border-border' },
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
    getStepConfig, setStepConfig, getStepConfigOverrides,
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

  // 🛑 Auto-trigger retiré (refonte 2026-05-05) : on ne génère plus
  // automatiquement à l'ouverture du modal — l'user doit cliquer
  // explicitement sur "Générer la preview" pour ne pas brûler ses
  // crédits sans son accord. Le bouton "Générer toutes les previews"
  // (bulk) et "Régénérer ce step" (single) restent disponibles.

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
    // 🛑 Auto-trigger retiré : sélectionner un candidat n'enclenche plus
    // la génération. L'user doit cliquer explicitement sur "Générer la
    // preview" pour ce candidat. Évite la consommation silencieuse de
    // crédits IA quand on parcourt la liste pour vérifier qui est là.
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

      // 🔧 Normalise job.id : depuis le flow Sourcing, useLinkedInSearch
      // génère des jobs synthétiques avec id="project:{uuid}". Si on
      // sauvegarde "project:abc-123" en sequence_enrollments.job_id, le
      // cron process-sequences ne pourra PAS retrouver le sourcing_project
      // associé (queries WHERE id.eq.project:abc-123 → no match) → mode
      // outreach pas appliqué, contexte mission perdu.
      const normalizedJobId = job?.id?.startsWith('project:')
        ? job.id.slice('project:'.length)
        : job?.id;

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
          // Overrides de timing per-step (delays, timeouts) éditées par
          // l'user dans la tree view → stockées dans tracking_data, lues
          // par process-sequences au scheduling du step suivant.
          const stepConfigOverrides = getStepConfigOverrides();

          // Construit tracking_data uniquement si on a au moins un override
          // (sinon on laisse la colonne null pour rester clean).
          const trackingData: Record<string, unknown> = {};
          if (Object.keys(overrides).length > 0) {
            trackingData.message_overrides = overrides;
          }
          if (Object.keys(stepConfigOverrides).length > 0) {
            trackingData.step_config_overrides = stepConfigOverrides;
          }

          const { data: enrollment, error: enrollError } = await supabase
            .from('sequence_enrollments')
            .insert({
              sequence_id: sequence.id,
              account_id: accountId,
              profile_id: profile.id,
              profile_name: profile.name,
              profile_headline: profile.headline,
              profile_url: profile.profile_url || profile.public_profile_url,
              job_id: normalizedJobId,
              job_title: job?.title,
              created_by: userId,
              user_timezone: userTimezone,
              current_step_order: 0,
              status: 'active',
              network_distance: normalizedDistance,
              ...(Object.keys(trackingData).length > 0 ? { tracking_data: trackingData } : {}),
            })
            .select()
            .single();

          if (enrollError) throw enrollError;
          if (!enrollment) throw new Error('Enrollment non créé');

          if (firstStep) {
            const stepId = firstStep.id;
            // Applique l'override de timing s'il existe pour le 1er step.
            // Sinon utilise les valeurs du template séquence.
            const firstStepOverride = stepConfigOverrides[stepId];
            const effDelayDays = firstStepOverride?.delayDays ?? firstStep.delay_days ?? 0;
            const effDelayHours = firstStepOverride?.delayHours ?? firstStep.delay_hours ?? 0;
            const effDelayMinutes = firstStep.delay_minutes ?? 0; // pas exposé en UI pour le moment

            const scheduledAt = new Date();
            scheduledAt.setTime(scheduledAt.getTime()
              + effDelayDays * 86400000
              + effDelayHours * 3600000
              + effDelayMinutes * 60000
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

          if (normalizedJobId) {
            await supabase
              .from('job_candidate_status')
              .upsert({
                job_id: normalizedJobId,
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

      // Idem normalisation : "project:{uuid}" → uuid
      const normalizedJobId = job.id.startsWith('project:')
        ? job.id.slice('project:'.length)
        : job.id;

      for (const profile of activeProfiles) {
        await supabase
          .from('job_candidate_status')
          .upsert({
            job_id: normalizedJobId,
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
    <motion.div
      className="fixed inset-0 z-[4000] bg-background flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      {/* Header — refonte avec font-display + bouton X circular + eyebrow */}
      <motion.div
        className="border-b border-border shrink-0 bg-background"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 h-14 sm:h-16">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
            <button
              onClick={handleClose}
              className="h-9 w-9 grid place-items-center rounded-full border border-border bg-background hover:bg-accent transition-colors shrink-0"
              aria-label="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5 hidden sm:block">
                Inscription en séquence
              </p>
              <h2 className="font-display text-[15px] sm:text-base font-semibold truncate leading-tight">
                {sequence.name}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                {activeProfiles.length} candidat{activeProfiles.length > 1 ? 's' : ''}
                {' · '}
                {sequence.steps.length} étape{sequence.steps.length > 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {hasMessageSteps && !enrollResults && (
              <div className="flex items-center bg-muted/40 p-0.5 rounded-full border border-border">
                <button
                  onClick={() => setMode('summary')}
                  className={cn(
                    "px-3 sm:px-3.5 h-7 text-[11.5px] font-medium rounded-full transition-all",
                    mode === 'summary'
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Résumé
                </button>
                <button
                  onClick={() => setMode('preview')}
                  className={cn(
                    "px-3 sm:px-3.5 h-7 text-[11.5px] font-medium rounded-full transition-all",
                    mode === 'preview'
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Previews
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.div>

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

              {/* Candidate Sidebar — hidden on mobile when viewing preview.
                  Refonte : header avec eyebrow uppercase + compteur,
                  recherche pill rounded-full au lieu de carrée. */}
              {!isSingle && (
                <motion.div
                  className={cn(
                    "w-full sm:w-72 border-b sm:border-b-0 sm:border-r border-border bg-muted/10 flex flex-col shrink-0",
                    "sm:flex",
                    mobilePane === 'list' ? "flex flex-1 sm:flex-none" : "hidden sm:flex"
                  )}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
                >
                  <div className="p-3 border-b border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                        Candidats
                      </p>
                      <span className="text-[10px] tabular-nums text-muted-foreground/70">
                        {filteredProfiles.length}
                        {filteredProfiles.length !== profiles.length && <span className="opacity-50"> / {profiles.length}</span>}
                      </span>
                    </div>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Rechercher…"
                        className="w-full h-8 pl-8 pr-3 text-[12px] bg-background border border-border rounded-full focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/30 transition-all"
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
                </motion.div>
              )}

              {/* Preview Panel — hidden on mobile when viewing list */}
              <div className={cn(
                "flex-1 flex flex-col overflow-hidden",
                !isSingle && mobilePane === 'list' ? "hidden sm:flex" : "flex"
              )}>
                {/* Bulk generation bar — refonte avec shine button +
                    progress animé. Disparaît quand isSingle. */}
                {!isSingle && hasAiSteps && (
                  <div className="px-4 py-2.5 border-b border-border bg-gradient-to-r from-brand-purple/[0.04] via-brand-pink/[0.03] to-transparent flex items-center gap-3">
                    {isBulkGenerating ? (
                      <>
                        <div className="flex-1 flex items-center gap-2">
                          <Progress value={(generatedCount / totalToGenerate) * 100} className="flex-1 h-1.5" />
                          <span className="text-[11px] text-muted-foreground tabular-nums font-medium">
                            {generatedCount}/{totalToGenerate}
                          </span>
                        </div>
                        <button
                          onClick={cancelBulkGeneration}
                          className="h-7 px-3 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded-full"
                        >
                          Annuler
                        </button>
                      </>
                    ) : (
                      <>
                        <motion.button
                          type="button"
                          onClick={() => generateAll(3)}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className="h-8 px-4 inline-flex items-center gap-1.5 text-[11.5px] font-bold rounded-full text-white konekt-skalr-bg konekt-shine shadow-sm"
                        >
                          <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} />
                          Générer toutes les previews
                        </motion.button>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          ~{estimatedCredits} cr
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

                      {/* Vue arborescente : décisions stylées en diamants
                          + connecteurs avec labels (si accepté / si réponse...)
                          + flèches entre étapes. Les steps message gardent
                          leur card complète (avec preview AI), les autres
                          (visite, invitation, etc.) sont compactés.
                          Les délais et timeouts sont éditables PER step
                          pour cette inscription (override stocké côté hook). */}
                      <SequenceTreeView
                        steps={steps}
                        getStepConfig={getStepConfig}
                        setStepConfig={setStepConfig}
                        renderStep={(step, idx) => {
                          const isMessageStep = MESSAGE_ACTIONS.includes(step.actionType) && !!step.messageTemplate?.trim();
                          const Icon = ACTION_ICONS[step.actionType] || MessageSquare;

                          if (!isMessageStep) {
                            return null; // tree view rend ses propres cards pour non-message
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
                              // Génération INDIVIDUELLE de ce step (pas de toute la séquence) :
                              // l'user clique le bouton sur la card du step, on génère juste
                              // ce step. Sinon "Générer toutes les previews" (bulk) reste
                              // disponible en haut pour tout générer d'un coup.
                              onGenerate={() => regenerateStep(selectedCandidateId, step.stepId)}
                            />
                          );
                        }}
                      />
                    </div>
                  ) : (
                    <PreviewPanelFallback hasProfiles={profiles.length > 0} />
                  )}
                </ScrollArea>

                {/* Bottom bar — 3 buttons avec hierarchy claire :
                    primary konekt-skalr-bg (Enrôler) + secondary outline (Shortlist)
                    + tertiary ghost (Annuler). */}
                <div className="px-4 sm:px-6 py-3 border-t border-border bg-background flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:justify-between">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="h-9 px-3 text-[12px] text-muted-foreground hover:text-foreground transition-colors rounded-full"
                  >
                    Annuler
                  </button>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    {job?.id && (
                      <button
                        type="button"
                        onClick={handleShortlist}
                        disabled={isEnrolling || activeProfiles.length === 0}
                        className="h-9 px-4 inline-flex items-center justify-center gap-1.5 text-[12px] font-medium rounded-full border border-border bg-background hover:bg-accent disabled:opacity-50 transition-colors"
                      >
                        <ListChecks className="w-3.5 h-3.5" />
                        Shortlister sans message
                      </button>
                    )}
                    <motion.button
                      type="button"
                      onClick={handleEnroll}
                      disabled={isEnrolling || activeProfiles.length === 0}
                      whileHover={{ scale: isEnrolling ? 1 : 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="h-9 px-5 inline-flex items-center justify-center gap-1.5 text-[12px] font-bold rounded-full text-white konekt-skalr-bg konekt-shine konekt-glow disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-shadow"
                    >
                      {isEnrolling ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Inscription…
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5" strokeWidth={2.5} />
                          Enrôler {activeProfiles.length} candidat{activeProfiles.length > 1 ? 's' : ''}
                        </>
                      )}
                    </motion.button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );

  return createPortal(content, document.body);
};

// ── Sub-components ──

function CompactStepCard({ step, Icon, index }: { step: SequenceStepPreview; Icon: typeof Mail; index: number }) {
  return (
    <div className="relative">
      {/* Node sur la timeline (placé sur le rail vertical à -7 pour l'aligner) */}
      <div
        className="absolute left-[-22px] sm:left-[-26px] top-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-background border border-border grid place-items-center text-[10px] font-bold text-muted-foreground tabular-nums shadow-sm z-10"
        aria-hidden="true"
      >
        {index + 1}
      </div>
      <div className="flex items-center gap-3 px-3 py-2 bg-muted/30 rounded-lg border border-border/50">
        <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-[11.5px] font-medium text-foreground/80">{ACTION_LABELS[step.actionType] || step.actionType}</span>
        {(step.delayDays || step.delayHours) ? (
          <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
            +{step.delayDays ? `${step.delayDays}j` : ''}{step.delayHours ? `${step.delayHours}h` : ''}
          </span>
        ) : null}
      </div>
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
  const colors = CHANNEL_COLORS[step.actionType] || { header: 'text-foreground', border: 'border-border' };
  const isPreviewActive = preview?.isGenerating || preview?.isGenerated;

  return (
    <div className="relative">
      {/* Node sur la timeline — couleur active si preview généré */}
      <div
        className={cn(
          "absolute left-[-22px] sm:left-[-26px] top-4 h-6 w-6 rounded-full border-2 grid place-items-center text-[10px] font-bold tabular-nums z-10 transition-all",
          isPreviewActive
            ? "bg-foreground text-background border-foreground shadow-md"
            : "bg-background text-muted-foreground border-border shadow-sm"
        )}
        aria-hidden="true"
      >
        {index + 1}
      </div>
      <motion.div
        className={cn("rounded-xl border overflow-hidden bg-card", colors.border)}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
      <div className={cn("flex items-center gap-2 px-4 sm:px-5 py-2.5 border-b border-border bg-muted/20")}>
        <div className={cn("h-7 w-7 rounded-lg grid place-items-center shrink-0", colors.header)}>
          <Icon className="w-3.5 h-3.5" strokeWidth={2.25} />
        </div>
        <span className="text-[12.5px] font-semibold tracking-tight text-foreground">
          {ACTION_LABELS[step.actionType]}
        </span>
        {step.useAiPersonalization && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-brand-purple/10 text-brand-purple border border-brand-purple/20 font-semibold uppercase tracking-wider">
            <Sparkles className="w-2.5 h-2.5" />
            IA
          </span>
        )}
        {preview?.isEdited && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/30 font-semibold uppercase tracking-wider">
            Modifié
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {preview?.isGenerated && (
            <>
              <button
                onClick={onRegenerate}
                className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Régénérer ce step"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onToggleEdit}
                className={cn(
                  "h-7 w-7 grid place-items-center rounded-md transition-colors",
                  isEditing
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                title={isEditing ? "Voir" : "Modifier"}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="px-4 sm:px-5 py-4">
        {preview?.isGenerating ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : preview?.isGenerated || preview?.error ? (
          <div className="space-y-4">
            {preview.error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/30 text-[12px] text-warning">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {preview.error}
              </div>
            )}
            {step.actionType === 'email' && (
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/70 mb-1.5">
                  Objet
                </p>
                {isEditing ? (
                  <Input
                    value={preview?.subject || ''}
                    onChange={e => onEditMessage('subject', e.target.value)}
                    className="h-9 text-[13px] font-medium"
                  />
                ) : (
                  <p className="text-[14px] font-semibold text-foreground">{preview?.subject || '—'}</p>
                )}
              </div>
            )}
            <div>
              {step.actionType === 'email' && (
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/70 mb-1.5">
                  Message
                </p>
              )}
              {isEditing ? (
                <AiTextarea
                  value={(preview?.message || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')}
                  onChange={e => onEditMessage('message', e.target.value)}
                  className="min-h-[140px] text-[13px] leading-relaxed resize-y pr-10"
                  context={{
                    purpose: step.actionType === 'email' ? 'email outreach' : 'message LinkedIn',
                    data: { step_type: step.actionType, candidate: preview?.candidateName },
                    tone: 'casual',
                  }}
                  placeholder="Tape /ai pour générer ou améliorer le message"
                />
              ) : (
                <div
                  className="text-[13.5px] leading-relaxed text-foreground/90 whitespace-pre-wrap font-sans"
                  dangerouslySetInnerHTML={{ __html: preview?.message || '' }}
                />
              )}
            </div>
            {preview?.personalizationPoints && preview.personalizationPoints.length > 0 && (
              <div className="pt-3 border-t border-border/60">
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles className="w-3 h-3 text-brand-purple" />
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/70">
                    Points de personnalisation
                  </p>
                </div>
                <div className="space-y-1.5">
                  {preview.personalizationPoints.map((pt, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 px-3 py-2 rounded-lg bg-brand-purple/[0.04] border border-brand-purple/15 text-[12px] leading-relaxed text-foreground/85"
                    >
                      <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-brand-purple/15 text-brand-purple text-[10px] font-bold shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span>{pt}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={onGenerate}
            className="w-full py-5 px-4 flex flex-col items-center gap-2 rounded-md text-muted-foreground hover:text-foreground border-2 border-dashed border-border hover:border-brand-purple/40 hover:bg-brand-purple/5 transition-all group"
          >
            <Sparkles className="w-5 h-5 group-hover:text-brand-purple transition-colors" />
            <span className="text-[12px] font-medium">Générer la preview de ce step</span>
            <span className="text-[10px] text-muted-foreground/70">~2 crédits</span>
          </button>
        )}
      </div>
      </motion.div>
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
      {/* Hero icon konekt-skalr-bg + animation pour cohérence avec V2 */}
      <motion.div
        className="text-center space-y-3"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          className="w-14 h-14 mx-auto rounded-xl konekt-skalr-bg konekt-shine flex items-center justify-center shadow-lg"
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 180, damping: 14 }}
        >
          <GitBranch className="w-7 h-7 text-white" strokeWidth={2.5} />
        </motion.div>
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">
            Récapitulatif
          </p>
          <h3 className="font-display text-xl font-bold">Avant d'enrôler</h3>
          <p className="text-[13px] text-muted-foreground mt-1">
            <strong className="text-foreground">{activeProfiles.length}</strong> candidat{activeProfiles.length > 1 ? 's' : ''} sélectionné{activeProfiles.length > 1 ? 's' : ''} pour <strong className="text-foreground">{steps.length} étapes</strong> de séquence
          </p>
        </div>
      </motion.div>

      <div className="space-y-2">
        <SummaryRow icon={CheckCircle} color="text-success-foreground" label="Candidats avec LinkedIn" count={activeProfiles.length} />
        {candidateAnalysis.withEmail > 0 && (
          <SummaryRow icon={Mail} color="text-info-foreground" label="Avec email" count={candidateAnalysis.withEmail} />
        )}
        {candidateAnalysis.withoutEmail > 0 && emailSteps.length > 0 && (
          <div className="bg-warning/5 border border-warning/30 rounded-lg p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <SummaryRow icon={AlertTriangle} color="text-warning-foreground" label="Sans email (steps email skippés)" count={candidateAnalysis.withoutEmail} />
              <BulkEnrichButton
                profiles={activeProfiles.filter(p => !(p.contact_info?.emails?.[0]))}
              />
            </div>
            <p className="text-[11px] text-muted-foreground pl-1">
              Enrichissez maintenant pour que ces candidats reçoivent les emails de la séquence.
              Sans enrichment, leurs steps email seront skippés silencieusement.
            </p>
          </div>
        )}
        {candidateAnalysis.withoutPhone > 0 && whatsappSteps.length > 0 && (
          <div className="bg-warning/5 border border-warning/30 rounded-lg p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <SummaryRow icon={AlertTriangle} color="text-warning-foreground" label="Sans téléphone (steps WhatsApp skippés)" count={candidateAnalysis.withoutPhone} />
              <BulkEnrichButton
                profiles={activeProfiles.filter(p => !(p.contact_info?.phones?.[0]))}
              />
            </div>
            <p className="text-[11px] text-muted-foreground pl-1">
              Enrichissez avec téléphone (10 cr/profil) pour que les steps WhatsApp partent.
            </p>
          </div>
        )}
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-muted/30 border-b border-border">
          <span className="text-[11px] font-medium">Séquence — {steps.length} étapes</span>
        </div>
        <div className="p-2 space-y-1">
          {steps.slice(0, 6).map((step, i) => {
            const Icon = ACTION_ICONS[step.actionType] || MessageSquare;
            return (
              <div key={step.stepId} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                <span className="text-[10px] text-muted-foreground tabular-nums w-4">#{i + 1}</span>
                <Icon className="w-3 h-3 text-muted-foreground" />
                <span>{ACTION_LABELS[step.actionType]}</span>
                {step.useAiPersonalization && <Sparkles className="w-2.5 h-2.5 text-warning" />}
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
        <div className="flex items-center gap-2 px-3 py-2 bg-brand-purple/5 border border-brand-purple/20 rounded-xl text-xs text-foreground">
          <Sparkles className="w-3.5 h-3.5 shrink-0 text-brand-purple" />
          <span>
            Estimation : <strong className="tabular-nums">~{estimatedCredits} crédits IA</strong>
            {' '}({hasMessageSteps ? 'personnalisation' : 'génération'})
          </span>
        </div>
      )}

      {/* 3-button footer avec hierarchy claire et CTA hero skalr */}
      <div className="flex flex-col gap-2 pt-2">
        {hasMessageSteps && (
          <button
            type="button"
            onClick={onSwitchToPreview}
            className="w-full h-10 inline-flex items-center justify-center gap-2 text-[12px] font-medium rounded-full border border-border bg-background hover:bg-accent transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            Ouvrir la préparation des previews
          </button>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={onClose}
            className="sm:flex-1 h-9 text-[12px] text-muted-foreground hover:text-foreground transition-colors rounded-full"
          >
            Annuler
          </button>
          {jobId && (
            <button
              type="button"
              onClick={onShortlist}
              disabled={isEnrolling || activeProfiles.length === 0}
              className="sm:flex-1 h-9 inline-flex items-center justify-center gap-1.5 text-[12px] font-medium rounded-full border border-border bg-background hover:bg-accent disabled:opacity-50 transition-colors"
            >
              <ListChecks className="w-3.5 h-3.5" />
              Shortlister sans message
            </button>
          )}
          <motion.button
            type="button"
            onClick={onEnroll}
            disabled={isEnrolling || activeProfiles.length === 0}
            whileHover={{ scale: isEnrolling ? 1 : 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="sm:flex-1 h-10 inline-flex items-center justify-center gap-2 text-[12px] font-bold rounded-full text-white konekt-skalr-bg konekt-shine konekt-glow disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
          >
            {isEnrolling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Inscription en cours…
              </>
            ) : (
              <>
                <Send className="w-4 h-4" strokeWidth={2.5} />
                Enrôler {activeProfiles.length} candidat{activeProfiles.length > 1 ? 's' : ''}
              </>
            )}
          </motion.button>
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
      <motion.div
        className="w-20 h-20 mx-auto rounded-full bg-success/10 border-2 border-success/30 flex items-center justify-center shadow-lg"
        initial={{ scale: 0, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 220, damping: 16 }}
        >
          <CheckCircle className="w-10 h-10 text-success" strokeWidth={2.5} />
        </motion.div>
      </motion.div>
      <motion.div
        className="space-y-2"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.3 }}
      >
        <h3 className="font-display text-xl font-bold">Inscription terminée</h3>
        {results.success > 0 && (
          <p className="text-sm text-success font-medium flex items-center justify-center gap-1.5">
            <CheckCircle className="w-4 h-4" />
            {results.success} candidat{results.success > 1 ? 's' : ''} inscrit{results.success > 1 ? 's' : ''}
          </p>
        )}
        {results.skipped > 0 && (
          <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
            <AlertCircle className="w-4 h-4" />
            {results.skipped} déjà inscrit{results.skipped > 1 ? 's' : ''}
          </p>
        )}
        {results.errors.length > 0 && (
          <div className="text-sm text-destructive text-left bg-destructive/5 rounded-xl border border-destructive/30 p-3 mt-3">
            {results.errors.map((err, i) => (
              <p key={i} className="text-xs">{err}</p>
            ))}
          </div>
        )}
      </motion.div>
      <motion.button
        onClick={onClose}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.25 }}
        className="h-9 px-5 inline-flex items-center justify-center gap-1.5 text-[12px] font-bold rounded-full text-white konekt-skalr-bg konekt-shine konekt-glow shadow-md"
      >
        Fermer
      </motion.button>
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
          <div className="px-3 py-3 space-y-2 bg-background">
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

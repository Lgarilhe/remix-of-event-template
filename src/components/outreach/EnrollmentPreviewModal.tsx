import React, { useState, useEffect, useMemo, useCallback, useRef, useId } from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { useEnrollmentPreview, SequenceStepPreview } from '@/hooks/useEnrollmentPreview';
import { BulkEnrichButton } from '@/components/outreach/result-card/BulkEnrichButton';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AiTextarea } from '@/components/ai/AiTextarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { cn } from '@/lib/utils';
import { sequenceActionLabel, formatStepDelay } from '@/lib/sequenceCatalog';
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, ListChecks, Pencil, RefreshCw, Search,
} from 'lucide-react';
import { SequenceActionLabel } from './SequenceBadges';
import { CandidateSidebarCard } from './enrollment-preview/CandidateSidebarCard';
import { SequenceTreeView, StepNumber } from './enrollment-preview/SequenceTreeView';
import { CandidateContextHeader } from './enrollment-preview/CandidateContextHeader';
import { ScoringPopover } from './enrollment-preview/ScoringPopover';
import { HistoryPopover } from './enrollment-preview/HistoryPopover';
import { DynamicSummaryBanner } from './enrollment-preview/DynamicSummaryBanner';
import { CandidateStatesMap, CandidateState } from './enrollment-preview/types';
import { useOrganization } from '@/hooks/useOrganization';
import {
  findRecentEnrollments,
  formatRecentContactLabel,
  RECENT_CONTACT_WINDOW_DAYS,
  type RecentEnrollment,
} from '@/lib/enrollmentDuplicates';

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

/** « 1 candidat », « 3 candidats ». */
function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

/** Coût annoncé avant l'action, en toutes lettres. */
function creditsLabel(n: number): string {
  return n > 0 ? `environ ${plural(n, 'crédit')}` : 'aucun crédit';
}

/** « +1 j 2 h » : délai avant une étape. */
function delayLabel(days?: number, hours?: number, minutes?: number): string | null {
  const delay = formatStepDelay(days, hours, minutes);
  return delay ? `+${delay}` : null;
}

type ListShortcut = 'next' | 'previous' | 'remove' | 'skip';

/**
 * Raccourcis de la liste des candidats (revue design D-44). Ils ne partent que
 * de la ligne d'un candidat qui a le focus, jamais d'un champ, d'un menu ou
 * d'un autre bouton, ni avec une touche de modification : mêmes règles que la
 * garde commune (`shouldIgnoreShortcut`), qui ne peut pas servir ici puisque la
 * préparation est elle-même un dialogue. Entrée et Espace restent au bouton
 * (afficher le candidat) ; aucune touche ne lance de génération payante.
 */
function listShortcut(e: React.KeyboardEvent<HTMLElement>): ListShortcut | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return null;
  const target = e.target as HTMLElement;
  if (!target.dataset?.candidateId) return null;
  switch (e.key) {
    case 'ArrowDown': return 'next';
    case 'ArrowUp': return 'previous';
    case 'Delete': case 'x': case 'X': return 'remove';
    case 'p': case 'P': return 'skip';
    default: return null;
  }
}

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
  const { organizationId, isAdmin } = useOrganization();
  const steps = useMemo(() => mapSteps(sequence.steps), [sequence.steps]);
  const isSingle = profiles.length === 1;
  const isBulk = profiles.length > 10;
  const candidateIds = useMemo(() => profiles.map(profile => profile.id), [profiles]);
  const firstProfileId = candidateIds[0] ?? '';

  // Aperçus conservés pour la session : même séquence, même mission, même
  // compte d'envoi (revue design D-46).
  const sessionKey = `${sequence.id}|${job?.id ?? ''}|${accountId}`;
  const {
    previews, messageSteps, hasMessageSteps, hasAiSteps,
    generatedCount, totalToGenerate, isBulkGenerating,
    estimatedCredits, creditsPerMessage, candidateAnalysis,
    getPreview, generateForCandidateById, regenerateStep,
    editMessage, generateAll, cancelBulkGeneration, getMessageOverrides, discardSessionPreviews,
    getStepConfig, setStepConfig, getStepConfigOverrides,
  } = useEnrollmentPreview({ steps, profiles, job, accountId, sessionKey });

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
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);

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
    const name = profiles.find(p => p.id === id)?.name || 'candidat sans nom';
    setCandidateStates(prev => {
      const next = new Map(prev);
      next.set(id, { ...getCandidateState(id), removed: true });
      return next;
    });
    toast(`Retiré de la sélection : ${name}`, {
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

  // ── Anti-doublon organisation (90 jours) ──
  // Candidats déjà contactés par un membre (toute séquence, tout compte) :
  // signalés et exclus de l'inscription, sauf dérogation cochée par un
  // propriétaire ou administrateur. null = vérification pas encore aboutie.
  const [recentEnrollments, setRecentEnrollments] = useState<Map<string, RecentEnrollment> | null>(null);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [enrollDuplicatesAnyway, setEnrollDuplicatesAnyway] = useState(false);
  const profilesKey = useMemo(() => profiles.map(p => p.id).join('|'), [profiles]);
  useEffect(() => {
    if (!isOpen || !organizationId) return;
    let cancelled = false;
    setRecentEnrollments(null);
    setEnrollDuplicatesAnyway(false);
    setIsCheckingDuplicates(true);
    findRecentEnrollments(supabase, organizationId, profiles)
      .then(map => { if (!cancelled) setRecentEnrollments(map); })
      .catch(err => {
        console.warn('[EnrollmentPreviewModal] recent enrollments check failed:', err);
        if (!cancelled) {
          toast.warning('Vérification des contacts récents impossible', {
            description: 'Les candidats déjà contactés ne seront pas signalés.',
          });
          setRecentEnrollments(new Map());
        }
      })
      .finally(() => { if (!cancelled) setIsCheckingDuplicates(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, organizationId, profilesKey]);

  const allowDuplicates = isAdmin && enrollDuplicatesAnyway;
  const duplicateProfiles = useMemo(() =>
    recentEnrollments
      ? profiles.filter(p => recentEnrollments.has(p.id) && !getCandidateState(p.id).removed)
      : [],
    [profiles, recentEnrollments, getCandidateState]);

  // Active profiles (not removed, not skipped, not recently contacted unless override)
  const activeProfiles = useMemo(() =>
    profiles.filter(p => {
      const s = getCandidateState(p.id);
      if (s.removed || s.skipped) return false;
      return allowDuplicates || !recentEnrollments?.has(p.id);
    }), [profiles, getCandidateState, candidateStates, recentEnrollments, allowDuplicates]);

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

  const handleSelectCandidate = (id: string, options: { showPreview?: boolean } = {}) => {
    setSelectedCandidateId(id);
    if (options.showPreview !== false) setMobilePane('preview');
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

  // ── Enrollment Logic ──

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const handleEnroll = async () => {
    // Sans org résolue, les inserts partiraient avec organization_id null →
    // refusés par RLS ou invisibles pour l'org (même garde que
    // SequenceEnrollModal). On refuse plutôt que d'enrôler dans le vide.
    if (!organizationId) {
      toast.error("Votre organisation n'a pas pu être identifiée", {
        description: 'Rechargez la page ou reconnectez votre compte.',
      });
      return;
    }

    setIsEnrolling(true);
    setEnrollResults(null);
    const results = { success: 0, skipped: 0, errors: [] as string[] };
    const enrolledIds: string[] = [];

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

      // Anti-doublon organisation : si la vérification à l'ouverture n'a pas
      // abouti, on la refait ici avant tout INSERT. Les candidats contactés
      // dans les 90 derniers jours sont exclus sauf dérogation (owner/admin).
      let recent = recentEnrollments;
      if (!recent) {
        recent = await findRecentEnrollments(supabase, organizationId, profiles);
        setRecentEnrollments(recent);
      }
      const enrollSet = allowDuplicates
        ? activeProfiles
        : activeProfiles.filter(p => !recent.has(p.id));
      if (enrollSet.length === 0) {
        toast.error(
          activeProfiles.length === 0
            ? 'Aucun candidat à inscrire'
            : 'Tous les candidats ont déjà été contactés récemment par votre organisation',
        );
        return;
      }

      for (const profile of enrollSet) {
        try {
          // Pré-check pour info uniquement. La race fenêtre entre SELECT et
          // INSERT est gérée plus bas via UPSERT + ignoreDuplicates (la
          // contrainte DB UNIQUE(sequence_id, profile_id) est la vraie source
          // de vérité).
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
            .upsert({
              sequence_id: sequence.id,
              account_id: accountId,
              profile_id: profile.id,
              profile_name: profile.name,
              profile_headline: profile.headline,
              profile_url: profile.profile_url || profile.public_profile_url,
              job_id: normalizedJobId,
              job_title: job?.title,
              created_by: userId,
              organization_id: organizationId, // requis par RLS org_members_all
              user_timezone: userTimezone,
              current_step_order: 0,
              status: 'active',
              network_distance: normalizedDistance,
              ...(Object.keys(trackingData).length > 0 ? { tracking_data: trackingData } : {}),
            }, {
              onConflict: 'sequence_id,profile_id',
              ignoreDuplicates: true,
            })
            .select()
            .maybeSingle();

          if (enrollError) throw enrollError;
          if (!enrollment) {
            // Conflit DB (race entre pré-check et upsert) → enrollment existait
            // déjà, on incrémente skipped et on continue.
            results.skipped++;
            continue;
          }

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

            const { error: execError } = await supabase
              .from('sequence_step_executions')
              .insert({
                enrollment_id: enrollment.id,
                step_id: stepId,
                step_order: firstStep.step_order ?? firstStep.stepOrder ?? 0,
                scheduled_at: scheduledAt.toISOString(),
                status: 'scheduled',
                organization_id: organizationId, // RLS multi-tenant
              });

            // Si l'insert de la 1re exécution échoue (RLS, contrainte…),
            // l'enrollment serait « dormant » : actif mais sans aucune étape
            // planifiée — le moteur ne le reprendra JAMAIS (il ne traite que
            // des exécutions existantes). On remonte l'erreur au lieu de
            // compter un faux succès (audit 2026-07, Frontend H2).
            if (execError) {
              console.error('[EnrollmentPreviewModal] first execution insert failed:', execError);
              results.errors.push(`${profile.name} : le premier envoi n'a pas pu être planifié`);
              await supabase.from('sequence_enrollments').delete().eq('id', enrollment.id);
              continue;
            }
          }

          results.success++;
          enrolledIds.push(profile.id);

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
                organization_id: organizationId, // RLS multi-tenant
              }, { onConflict: 'job_id,candidate_id,created_by' });
          }
        } catch (err: any) {
          console.error('[EnrollmentPreviewModal] enrollment failed:', err);
          results.errors.push(`${profile.name} : inscription impossible`);
        }
      }

      // Les candidats inscrits n'ont plus besoin de leurs aperçus.
      discardSessionPreviews(enrolledIds);
      setEnrollResults(results);
      if (results.success > 0) {
        toast.success(`${plural(results.success, 'candidat inscrit', 'candidats inscrits')} dans « ${sequence.name} »`);
      }
      if (results.skipped > 0) {
        toast.info(`${plural(results.skipped, 'candidat déjà inscrit', 'candidats déjà inscrits')} dans cette séquence`);
      }
    } catch (err) {
      console.error('[EnrollmentPreviewModal] Bulk enrollment failed:', err);
      toast.error("L'inscription n'a pas abouti", {
        description: 'Vérifiez votre connexion, puis réessayez.',
      });
    } finally {
      setIsEnrolling(false);
    }
  };

  // ── Shortlist without message ──
  const handleShortlist = async () => {
    if (!job?.id) {
      toast.error('Aucune mission associée à ces candidats', {
        description: 'Ouvrez la préparation depuis une mission pour les présélectionner.',
      });
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

      toast.success(`${plural(count, 'candidat présélectionné', 'candidats présélectionnés')}`);
      onSuccess();
    } catch (err) {
      console.error('[EnrollmentPreviewModal] Shortlist failed:', err);
      toast.error("La présélection n'a pas abouti", {
        description: 'Vérifiez votre connexion, puis réessayez.',
      });
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleClose = () => {
    if (enrollResults?.success) onSuccess();
    else onClose();
  };

  // ── Fermeture (revue design D-46) ──
  // Fermer ne jette plus rien sans prévenir : les aperçus déjà préparés
  // (générés, donc payés, ou retouchés) restent pour la session ; la
  // confirmation le dit, et dit ce qui ne sera pas gardé.
  const previewStats = useMemo(() => {
    let kept = 0;
    let edited = 0;
    previews.forEach(byStep => byStep.forEach(msg => {
      if (!msg.isGenerating && (msg.isGenerated || msg.isEdited)) kept++;
      if (msg.isEdited) edited++;
    }));
    return { kept, edited };
  }, [previews]);
  const delayChanges = Object.keys(getStepConfigOverrides()).length;
  const hasWorkInProgress = previewStats.kept > 0 || delayChanges > 0 || isBulkGenerating;

  const requestClose = () => {
    if (enrollResults || isEnrolling) {
      handleClose();
      return;
    }
    if (hasWorkInProgress) {
      setConfirmCloseOpen(true);
      return;
    }
    onClose();
  };

  const confirmClose = () => {
    cancelBulkGeneration();
    setConfirmCloseOpen(false);
    onClose();
  };

  // ── Aperçus : prêts, manquants, coût annoncé avant l'action ──
  const isReady = useCallback((candidateId: string, stepId: string) => {
    const preview = getPreview(candidateId, stepId);
    return !!preview && !preview.isGenerating && (preview.isGenerated || !!preview.isEdited);
  }, [getPreview]);

  const listedProfiles = useMemo(
    () => profiles.filter(p => !getCandidateState(p.id).removed),
    [profiles, getCandidateState],
  );
  const readyCount = listedProfiles.filter(p => messageSteps.every(s => isReady(p.id, s.stepId))).length;
  // La génération groupée passe sur tous les candidats de la préparation.
  const bulkMissingAi = profiles.reduce(
    (sum, p) => sum + messageSteps.filter(s => s.useAiPersonalization && !isReady(p.id, s.stepId)).length,
    0,
  );
  const bulkMissingCandidates = profiles.filter(p => messageSteps.some(s => !isReady(p.id, s.stepId))).length;

  // ── Clavier de la liste des candidats (revue design D-44) ──
  const listRef = useRef<HTMLDivElement>(null);
  const focusCandidateRef = useRef<string | null>(null);
  const listLabelId = useId();
  const shortcutsHelpId = useId();

  const focusCandidate = (id: string) => {
    focusCandidateRef.current = id;
    setFocusRequest(n => n + 1);
  };

  useEffect(() => {
    const id = focusCandidateRef.current;
    if (!id) return;
    const position = filteredProfiles.findIndex(p => p.id === id);
    if (position === -1) {
      focusCandidateRef.current = null;
      return;
    }
    const targetPage = Math.floor(position / pageSize);
    if (targetPage !== page) {
      setPage(targetPage);
      return;
    }
    const row = listRef.current?.querySelector<HTMLElement>(`[data-candidate-id="${CSS.escape(id)}"]`);
    if (row) {
      row.focus();
      focusCandidateRef.current = null;
    }
  }, [focusRequest, filteredProfiles, page, pageSize]);

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const action = listShortcut(e);
    if (!action) return;
    const id = (e.target as HTMLElement).dataset.candidateId as string;
    const index = filteredProfiles.findIndex(p => p.id === id);
    if (index === -1) return;
    e.preventDefault();
    if (action === 'next' || action === 'previous') {
      const target = filteredProfiles[index + (action === 'next' ? 1 : -1)];
      if (!target) return;
      handleSelectCandidate(target.id, { showPreview: false });
      focusCandidate(target.id);
    } else if (action === 'remove') {
      const neighbour = filteredProfiles[index + 1] ?? filteredProfiles[index - 1];
      handleRemoveCandidate(id);
      if (neighbour) {
        if (id === selectedCandidateId) handleSelectCandidate(neighbour.id, { showPreview: false });
        focusCandidate(neighbour.id);
      }
    } else {
      handleSkipCandidate(id);
    }
  };

  if (!isOpen) return null;

  // ── Render ──

  const enrollLabel = activeProfiles.length > 0
    ? `Inscrire ${plural(activeProfiles.length, 'candidat')}`
    : 'Aucun candidat à inscrire';

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) requestClose(); }}>
        <DialogContent
          className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 max-sm:h-[100dvh] max-sm:w-screen max-sm:max-w-none"
          // Grand espace de travail : un clic sur la marge ne ferme pas.
          onInteractOutside={(e) => e.preventDefault()}
          // Focus d'arrivée : la ligne du candidat affiché, là où les
          // raccourcis de la liste s'appliquent ; sinon la fenêtre elle-même.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const row = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
            (row ?? (e.target as HTMLElement | null))?.focus();
          }}
        >
          {/* En-tête */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border py-3 pl-4 pr-14 sm:pl-6">
            <div className="min-w-0 flex-1">
              <p className="eyebrow hidden sm:block">Inscription en séquence</p>
              <DialogTitle className="truncate">{sequence.name}</DialogTitle>
              <DialogDescription className="text-xs tabular-nums">
                {plural(activeProfiles.length, 'candidat')} à inscrire · {plural(sequence.steps.length, 'étape')}
              </DialogDescription>
            </div>
            {hasMessageSteps && !enrollResults && (
              <SegmentedControl<'summary' | 'preview'>
                aria-label="Affichage de la préparation"
                value={mode}
                onValueChange={setMode}
                options={[
                  { value: 'summary', label: 'Résumé' },
                  { value: 'preview', label: 'Aperçus' },
                ]}
              />
            )}
          </div>

          {/* Bandeau de synthèse */}
          {mode === 'preview' && !enrollResults && !isSingle && (
            <DynamicSummaryBanner
              profiles={profiles}
              states={candidateStates}
              enrollCount={activeProfiles.length}
              readyCount={readyCount}
            />
          )}

          {/* Anti-doublon organisation : contactés dans les 90 derniers jours par
              un membre, toute séquence et tout compte. Exclus par défaut ;
              dérogation réservée aux propriétaires et administrateurs. */}
          {!enrollResults && isCheckingDuplicates && (
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground sm:px-6">
              <Spinner size="sm" label="Vérification en cours" />
              Vérification des contacts récents de votre organisation…
            </div>
          )}
          {!enrollResults && recentEnrollments && duplicateProfiles.length > 0 && (
            <DuplicatesNotice
              duplicates={duplicateProfiles}
              recentEnrollments={recentEnrollments}
              isAdmin={isAdmin}
              enrollAnyway={enrollDuplicatesAnyway}
              onEnrollAnywayChange={setEnrollDuplicatesAnyway}
            />
          )}

          {/* Corps */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {enrollResults ? (
              <div className="flex flex-1 items-center justify-center overflow-y-auto p-6 sm:p-8">
                <EnrollmentResults results={enrollResults} onClose={handleClose} />
              </div>
            ) : mode === 'summary' ? (
              <div className="flex-1 overflow-y-auto">
                <SummaryMode
                  activeProfiles={activeProfiles}
                  steps={steps}
                  candidateAnalysis={candidateAnalysis}
                  estimatedCredits={estimatedCredits}
                  hasAiSteps={hasAiSteps}
                  hasMessageSteps={hasMessageSteps}
                  onSwitchToPreview={() => setMode('preview')}
                />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
                {/* Téléphone : la liste ou l'aperçu */}
                {!isSingle && (
                  <div className="shrink-0 border-b border-border px-4 py-2 sm:hidden">
                    <SegmentedControl<'list' | 'preview'>
                      aria-label="Partie affichée"
                      value={mobilePane}
                      onValueChange={setMobilePane}
                      size="default"
                      options={[
                        { value: 'list', label: `Candidats (${listedProfiles.length})` },
                        { value: 'preview', label: 'Aperçu' },
                      ]}
                      className="flex h-11 w-full [&>button]:flex-1"
                    />
                  </div>
                )}

                {/* Liste des candidats */}
                {!isSingle && (
                  <div
                    className={cn(
                      'w-full shrink-0 flex-col border-border sm:flex sm:w-72 sm:border-r',
                      mobilePane === 'list' ? 'flex min-h-0 flex-1 sm:flex-none' : 'hidden',
                    )}
                  >
                    <div className="space-y-2 border-b border-border p-3">
                      <div className="flex items-center justify-between">
                        <p id={listLabelId} className="eyebrow">Candidats</p>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {filteredProfiles.length === listedProfiles.length
                            ? listedProfiles.length
                            : `${filteredProfiles.length} sur ${listedProfiles.length}`}
                        </span>
                      </div>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                          type="search"
                          value={searchQuery}
                          onChange={e => setSearchQuery(e.target.value)}
                          placeholder="Nom ou titre"
                          aria-label="Rechercher un candidat"
                          className="h-8 pl-8 max-md:h-11"
                        />
                      </div>
                    </div>
                    <ScrollArea className="min-h-0 flex-1">
                      <div
                        ref={listRef}
                        role="list"
                        aria-labelledby={listLabelId}
                        onKeyDown={handleListKeyDown}
                        className="space-y-0.5 p-1.5"
                      >
                        {pagedProfiles.map(p => {
                          const allGenerated = messageSteps.every(s => getPreview(p.id, s.stepId)?.isGenerated);
                          const hasEdits = messageSteps.some(s => getPreview(p.id, s.stepId)?.isEdited);
                          const state = getCandidateState(p.id);
                          const cachedScore = scoreCache.get(p.id);

                          return (
                            <div role="listitem" key={p.id}>
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
                                      shortcutsHelpId={shortcutsHelpId}
                                      onSelect={() => handleSelectCandidate(p.id)}
                                      onRemove={() => handleRemoveCandidate(p.id)}
                                      onSkip={() => handleSkipCandidate(p.id)}
                                      onViewScoring={() => setScoringPopoverId(p.id)}
                                      onViewHistory={() => setHistoryPopoverId(p.id)}
                                    />
                                  </div>
                                </HistoryPopover>
                              </ScoringPopover>
                            </div>
                          );
                        })}
                        {filteredProfiles.length === 0 && (
                          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                            {searchQuery.trim()
                              ? 'Aucun candidat ne correspond à cette recherche.'
                              : 'Tous les candidats ont été retirés de la sélection.'}
                          </p>
                        )}
                      </div>
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t border-border px-2 py-1.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Page précédente"
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0}
                                className="max-md:h-11 max-md:w-11"
                              >
                                <ChevronLeft aria-hidden="true" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Page précédente</TooltipContent>
                          </Tooltip>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {page * pageSize + 1} à {Math.min((page + 1) * pageSize, filteredProfiles.length)} sur {filteredProfiles.length}
                          </span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Page suivante"
                                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                disabled={page >= totalPages - 1}
                                className="max-md:h-11 max-md:w-11"
                              >
                                <ChevronRight aria-hidden="true" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Page suivante</TooltipContent>
                          </Tooltip>
                        </div>
                      )}
                    </ScrollArea>
                    <p id={shortcutsHelpId} className="hidden border-t border-border px-3 py-2 text-3xs text-muted-foreground sm:block">
                      <Kbd>↑</Kbd> <Kbd>↓</Kbd> parcourir, <Kbd>P</Kbd> passer, <Kbd>X</Kbd> retirer
                    </p>
                  </div>
                )}

                {/* Aperçus du candidat sélectionné */}
                <div className={cn(
                  'min-h-0 flex-1 flex-col overflow-hidden',
                  !isSingle && mobilePane === 'list' ? 'hidden sm:flex' : 'flex',
                )}>
                  {/* Génération groupée : bouton secondaire, coût annoncé avant l'action */}
                  {!isSingle && hasAiSteps && (
                    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5 sm:px-6">
                      {isBulkGenerating ? (
                        <>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <Progress
                              value={(generatedCount / Math.max(totalToGenerate, 1)) * 100}
                              aria-label="Génération des aperçus"
                              className="h-1.5 flex-1"
                            />
                            <span className="text-xs font-medium tabular-nums text-muted-foreground">
                              {generatedCount} sur {totalToGenerate}
                            </span>
                          </div>
                          <Button variant="ghost" size="sm" onClick={cancelBulkGeneration} className="max-md:h-11">
                            Arrêter la génération
                          </Button>
                        </>
                      ) : bulkMissingCandidates > 0 ? (
                        <>
                          <Button variant="outline" size="sm" onClick={() => generateAll(3)} className="max-md:h-11">
                            Générer tous les aperçus
                          </Button>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {creditsLabel(bulkMissingAi * creditsPerMessage)} pour {plural(bulkMissingCandidates, 'candidat')}
                          </span>
                        </>
                      ) : (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                          Les aperçus de tous les candidats sont prêts.
                        </p>
                      )}
                    </div>
                  )}

                  <ScrollArea className="min-h-0 flex-1">
                    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
                      {selectedProfile ? (
                        <>
                          <CandidateContextHeader
                            profile={selectedProfile}
                            score={scoreCache.get(selectedProfile.id)}
                            linkedinUrl={selectedProfile.profile_url || selectedProfile.public_profile_url || null}
                          />

                          <CandidatePreviewsBar
                            steps={messageSteps}
                            isReady={stepId => isReady(selectedProfile.id, stepId)}
                            isGenerating={messageSteps.some(s => getPreview(selectedProfile.id, s.stepId)?.isGenerating)}
                            isBulkGenerating={isBulkGenerating}
                            creditsPerMessage={creditsPerMessage}
                            onGenerate={() => generateForCandidateById(selectedProfile.id)}
                          />

                          {/* Vue arborescente : décisions à filet pointillé et
                              branches libellées ; les étapes message gardent leur
                              carte complète (aperçu), les autres sont compactes.
                              Délais et délais maximaux se modifient pour cette
                              inscription (override stocké côté hook). */}
                          <SequenceTreeView
                            steps={steps}
                            getStepConfig={getStepConfig}
                            setStepConfig={setStepConfig}
                            renderStep={(step, idx) => {
                              const isMessageStep = MESSAGE_ACTIONS.includes(step.actionType) && !!step.messageTemplate?.trim();
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
                                  index={idx}
                                  candidateName={selectedProfile.name}
                                  creditsPerMessage={creditsPerMessage}
                                  onToggleEdit={() => toggleEditing(step.stepId)}
                                  onRegenerate={() => regenerateStep(selectedCandidateId, step.stepId)}
                                  onEditMessage={(field, value) => editMessage(selectedCandidateId, step.stepId, field, value)}
                                  // Génération de cette seule étape, à la demande.
                                  onGenerate={() => regenerateStep(selectedCandidateId, step.stepId)}
                                />
                              );
                            }}
                          />
                        </>
                      ) : (
                        <PreviewPanelFallback hasProfiles={profiles.length > 0} />
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            )}
          </div>

          {/* Actions : une seule principale, monochrome (revue design D-45) */}
          {!enrollResults && (
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <Button variant="ghost" onClick={requestClose} className="max-md:h-11">
                Annuler
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                {job?.id && (
                  <Button
                    variant="outline"
                    onClick={handleShortlist}
                    disabled={isEnrolling || activeProfiles.length === 0}
                    className="max-md:h-11"
                  >
                    <ListChecks aria-hidden="true" />
                    Présélectionner sans message
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={handleEnroll}
                  loading={isEnrolling}
                  disabled={activeProfiles.length === 0}
                  className="max-md:h-11"
                >
                  {isEnrolling ? 'Inscription en cours…' : enrollLabel}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fermer la préparation ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {previewStats.kept > 0 && (
                  <p>
                    {previewStats.kept > 1
                      ? `Les ${previewStats.kept} aperçus déjà préparés${previewStats.edited > 0 ? `, dont ${plural(previewStats.edited, 'retouché', 'retouchés')},` : ''} restent disponibles`
                      : `L'aperçu déjà préparé${previewStats.edited > 0 ? ', retouché,' : ''} reste disponible`}
                    {' '}jusqu'au rechargement de la page : rouvrez la préparation de cette séquence avec ces candidats pour {previewStats.kept > 1 ? 'les' : 'le'} retrouver.
                  </p>
                )}
                {isBulkGenerating && <p>La génération en cours sera arrêtée.</p>}
                {delayChanges > 0 && (
                  <p>
                    {delayChanges > 1 ? 'Les délais modifiés' : 'Le délai modifié'} pour cette inscription ne {delayChanges > 1 ? 'seront' : 'sera'} pas conservé{delayChanges > 1 ? 's' : ''}.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuer la préparation</AlertDialogCancel>
            <AlertDialogAction onClick={confirmClose}>Fermer la préparation</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

// ── Sub-components ──

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-sm border border-border px-1 font-mono text-3xs text-foreground-secondary">{children}</kbd>
  );
}

/** Candidats déjà contactés par l'organisation ces 90 derniers jours. */
function DuplicatesNotice({
  duplicates, recentEnrollments, isAdmin, enrollAnyway, onEnrollAnywayChange,
}: {
  duplicates: LinkedInProfile[];
  recentEnrollments: Map<string, RecentEnrollment>;
  isAdmin: boolean;
  enrollAnyway: boolean;
  onEnrollAnywayChange: (value: boolean) => void;
}) {
  const checkboxId = useId();
  const count = duplicates.length;
  return (
    <div role="status" className="shrink-0 border-b border-warning/25 bg-warning-muted px-4 py-2.5 sm:px-6">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-medium text-foreground">
            {count > 1 ? `${count} candidats déjà contactés` : '1 candidat déjà contacté'} par votre organisation ces {RECENT_CONTACT_WINDOW_DAYS} derniers jours
          </p>
          <ul className="max-h-16 space-y-0.5 overflow-y-auto text-xs text-foreground-secondary">
            {duplicates.slice(0, 5).map(p => {
              const entry = recentEnrollments.get(p.id);
              return (
                <li key={p.id} className="break-words">
                  <span className="font-medium text-foreground">{p.name}</span>
                  {' : '}{entry ? formatRecentContactLabel(entry) : 'Déjà contacté'}
                </li>
              );
            })}
            {count > 5 && <li>et {plural(count - 5, 'autre')}</li>}
          </ul>
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id={checkboxId}
                checked={enrollAnyway}
                onCheckedChange={checked => onEnrollAnywayChange(checked === true)}
              />
              <Label htmlFor={checkboxId} className="cursor-pointer text-xs font-normal text-foreground max-md:py-3">
                Inscrire quand même ({count})
              </Label>
            </div>
          ) : (
            <p className="text-xs text-foreground-secondary">
              Exclus de l'inscription. Seuls les propriétaires et administrateurs peuvent les inscrire quand même.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Aperçus du candidat affiché : combien sont prêts, et de quoi générer le reste. */
function CandidatePreviewsBar({
  steps, isReady, isGenerating, isBulkGenerating, creditsPerMessage, onGenerate,
}: {
  steps: SequenceStepPreview[];
  isReady: (stepId: string) => boolean;
  isGenerating: boolean;
  isBulkGenerating: boolean;
  creditsPerMessage: number;
  onGenerate: () => void;
}) {
  if (steps.length === 0) return null;
  const missing = steps.filter(s => !isReady(s.stepId));
  const missingAi = missing.filter(s => s.useAiPersonalization).length;
  const ready = steps.length - missing.length;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-border px-4 py-3">
      <p className="flex items-center gap-1.5 text-sm text-foreground">
        {missing.length === 0 && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />}
        Aperçus prêts pour ce candidat : <span className="tabular-nums">{ready} sur {steps.length}</span>
      </p>
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">{creditsLabel(missingAi * creditsPerMessage)}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={onGenerate}
            loading={isGenerating}
            disabled={isBulkGenerating}
            className="max-md:h-11"
          >
            {missing.length > 1 ? `Générer les ${missing.length} aperçus` : "Générer l'aperçu"}
          </Button>
        </div>
      )}
    </div>
  );
}

function MessageStepCard({
  step, preview, isEditing, index, candidateName, creditsPerMessage,
  onToggleEdit, onRegenerate, onEditMessage, onGenerate,
}: {
  step: SequenceStepPreview;
  preview: ReturnType<ReturnType<typeof useEnrollmentPreview>['getPreview']>;
  isEditing: boolean;
  index: number;
  candidateName?: string;
  creditsPerMessage: number;
  onToggleEdit: () => void;
  onRegenerate: () => void;
  onEditMessage: (field: 'subject' | 'message', value: string) => void;
  onGenerate: () => void;
}) {
  const fieldId = useId();
  const cost = step.useAiPersonalization ? creditsLabel(creditsPerMessage) : 'aucun crédit';
  const label = sequenceActionLabel(step.actionType);
  const message = (preview?.message || '').replace(/<br\s*\/?>/gi, '\n');

  return (
    <article aria-label={`Étape ${index + 1} : ${label}`} className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <StepNumber index={index} />
        <SequenceActionLabel type={step.actionType} className="text-sm font-medium text-foreground" />
        {step.useAiPersonalization && step.actionType !== 'smart_message' && (
          <Badge variant="muted" className="px-1.5 py-0 text-3xs">Personnalisé par l'IA</Badge>
        )}
        {preview?.isEdited && <Badge variant="outline" className="px-1.5 py-0 text-3xs">Retouché</Badge>}
        {preview?.isGenerated && (
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Régénérer cette étape (${cost})`}
                  onClick={onRegenerate}
                  className="text-muted-foreground max-md:h-11 max-md:w-11"
                >
                  <RefreshCw aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Régénérer cette étape ({cost})</TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="xs"
              aria-pressed={isEditing}
              onClick={onToggleEdit}
              className={cn('max-md:h-11', isEditing ? 'bg-accent text-foreground' : 'text-muted-foreground')}
            >
              <Pencil aria-hidden="true" />
              Modifier
            </Button>
          </div>
        )}
      </header>

      <div className="px-4 py-4">
        {preview?.isGenerating ? (
          <div className="space-y-3" role="status">
            <span className="sr-only">Génération de l'aperçu en cours</span>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : preview?.isGenerated || preview?.error ? (
          <div className="space-y-4">
            {preview.error && (
              <div role="alert" className="flex flex-wrap items-start gap-2 rounded-lg border border-warning/25 bg-warning-muted px-3 py-2 text-xs text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                <p className="min-w-0 flex-1">{preview.error}</p>
                <Button variant="outline" size="xs" onClick={onGenerate} className="max-md:h-11">
                  Réessayer
                </Button>
              </div>
            )}
            {step.actionType === 'email' && (
              <div className="space-y-1.5">
                {isEditing ? (
                  <>
                    <Label htmlFor={`${fieldId}-objet`} className="text-xs text-muted-foreground">Objet</Label>
                    <Input
                      id={`${fieldId}-objet`}
                      value={preview?.subject || ''}
                      onChange={e => onEditMessage('subject', e.target.value)}
                      className="font-medium"
                    />
                  </>
                ) : (
                  <>
                    <p className="eyebrow">Objet</p>
                    <p className="text-md font-semibold text-foreground">
                      {preview?.subject || <span className="font-normal text-muted-foreground">Sans objet</span>}
                    </p>
                  </>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              {isEditing ? (
                <>
                  <Label htmlFor={`${fieldId}-message`} className="text-xs text-muted-foreground">Message</Label>
                  <AiTextarea
                    id={`${fieldId}-message`}
                    value={message.replace(/<[^>]+>/g, '')}
                    onChange={e => onEditMessage('message', e.target.value)}
                    className="min-h-36 resize-y pr-10 text-sm leading-relaxed"
                    context={{
                      purpose: step.actionType === 'email' ? 'email outreach' : 'message LinkedIn',
                      data: { step_type: step.actionType, candidate: candidateName },
                      tone: 'casual',
                    }}
                    placeholder="Tapez /ai pour générer ou améliorer le message"
                  />
                </>
              ) : (
                <>
                  {step.actionType === 'email' && <p className="eyebrow">Message</p>}
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{message}</p>
                </>
              )}
            </div>
            {preview?.personalizationPoints && preview.personalizationPoints.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="eyebrow mb-2">Points de personnalisation</p>
                <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-foreground-secondary">
                  {preview.personalizationPoints.map((pt, i) => (
                    <li key={i}>{pt}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-5 text-center">
            <p className="text-sm text-muted-foreground">Aperçu pas encore généré pour ce candidat.</p>
            <Button variant="outline" size="sm" onClick={onGenerate} className="max-md:h-11">
              Générer l'aperçu de cette étape
            </Button>
            <p className="text-xs text-muted-foreground">{cost}</p>
          </div>
        )}
      </div>
    </article>
  );
}

function SummaryMode({
  activeProfiles, steps, candidateAnalysis, estimatedCredits, hasAiSteps, hasMessageSteps, onSwitchToPreview,
}: {
  activeProfiles: LinkedInProfile[];
  steps: SequenceStepPreview[];
  candidateAnalysis: { total: number; withEmail: number; withoutEmail: number; withPhone: number; withoutPhone: number };
  estimatedCredits: number;
  hasAiSteps: boolean;
  hasMessageSteps: boolean;
  onSwitchToPreview: () => void;
}) {
  const emailSteps = steps.filter(s => s.actionType === 'email');
  const whatsappSteps = steps.filter(s => s.actionType === 'whatsapp_message');
  const stepsTitleId = useId();

  return (
    <div className="mx-auto max-w-xl space-y-6 p-4 sm:p-8">
      <div className="space-y-1 text-center">
        <p className="eyebrow">Récapitulatif</p>
        <h3 className="text-lg font-semibold text-foreground">Avant l'inscription</h3>
        <p className="text-sm text-foreground-secondary">
          {plural(activeProfiles.length, 'candidat sélectionné', 'candidats sélectionnés')} pour une séquence de {plural(steps.length, 'étape')}
        </p>
      </div>

      <ul className="divide-y divide-border rounded-xl border border-border">
        <SummaryRow channel="linkedin" label="Joignables sur LinkedIn" count={activeProfiles.length} />
        {candidateAnalysis.withEmail > 0 && (
          <SummaryRow channel="email" label="Avec une adresse e-mail" count={candidateAnalysis.withEmail} />
        )}
      </ul>

      {candidateAnalysis.withoutEmail > 0 && emailSteps.length > 0 && (
        <div className="space-y-2 rounded-xl border border-warning/25 bg-warning-muted p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              {plural(candidateAnalysis.withoutEmail, 'candidat')} sans adresse e-mail
            </p>
            <BulkEnrichButton profiles={activeProfiles.filter(p => !(p.contact_info?.emails?.[0]))} />
          </div>
          <p className="text-xs text-foreground-secondary">
            Leurs étapes e-mail seront ignorées. Enrichissez leurs coordonnées maintenant pour qu'ils reçoivent les e-mails de la séquence.
          </p>
        </div>
      )}
      {candidateAnalysis.withoutPhone > 0 && whatsappSteps.length > 0 && (
        <div className="space-y-2 rounded-xl border border-warning/25 bg-warning-muted p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              {plural(candidateAnalysis.withoutPhone, 'candidat')} sans téléphone
            </p>
            <BulkEnrichButton profiles={activeProfiles.filter(p => !(p.contact_info?.phones?.[0]))} />
          </div>
          <p className="text-xs text-foreground-secondary">
            Leurs messages WhatsApp seront ignorés. L'enrichissement du numéro coûte 10 crédits par profil.
          </p>
        </div>
      )}

      <section className="rounded-xl border border-border" aria-labelledby={stepsTitleId}>
        <h4 id={stepsTitleId} className="border-b border-border px-4 py-2.5 text-sm font-semibold text-foreground">
          Étapes de la séquence
        </h4>
        <ol className="space-y-0.5 p-2">
          {steps.slice(0, 6).map((step, i) => {
            const delay = delayLabel(step.delayDays, step.delayHours, step.delayMinutes);
            return (
              <li key={step.stepId} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm">
                <StepNumber index={i} />
                <SequenceActionLabel type={step.actionType} className="text-foreground" />
                {step.useAiPersonalization && step.actionType !== 'smart_message' && (
                  <Badge variant="muted" className="px-1.5 py-0 text-3xs">IA</Badge>
                )}
                {delay && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{delay}</span>}
              </li>
            );
          })}
        </ol>
        {steps.length > 6 && (
          <p className="px-4 pb-3 text-xs text-muted-foreground">
            et {plural(steps.length - 6, 'autre étape', 'autres étapes')}
          </p>
        )}
      </section>

      {hasAiSteps && (
        <p className="flex items-start gap-2 rounded-xl border border-border px-3 py-2.5 text-sm text-foreground-secondary">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            Coût estimé de la personnalisation par l'IA :{' '}
            <strong className="font-semibold tabular-nums text-foreground">{creditsLabel(estimatedCredits)}</strong>.
          </span>
        </p>
      )}

      {hasMessageSteps && (
        <Button variant="outline" className="w-full max-md:h-11" onClick={onSwitchToPreview}>
          Voir les aperçus des messages
        </Button>
      )}
    </div>
  );
}

function SummaryRow({ channel, label, count }: { channel: 'linkedin' | 'email'; label: string; count: number }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span aria-hidden="true" className="inline-flex">
        <ChannelIcon channel={channel} size="sm" />
      </span>
      <span className="flex-1 text-sm text-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{count}</span>
    </li>
  );
}

function EnrollmentResults({ results, onClose }: { results: { success: number; skipped: number; errors: string[] }; onClose: () => void }) {
  const failed = results.errors.length;
  const title = results.success > 0
    ? 'Inscription terminée'
    : failed > 0
      ? "L'inscription n'a pas abouti"
      : 'Aucun nouveau candidat inscrit';

  return (
    <div className="w-full max-w-md space-y-5 text-center">
      <span
        className={cn(
          'mx-auto grid h-12 w-12 place-items-center rounded-full',
          results.success > 0 ? 'bg-success-muted text-success' : failed > 0 ? 'bg-danger-muted text-danger' : 'bg-muted text-muted-foreground',
        )}
        aria-hidden="true"
      >
        {results.success > 0 ? <CheckCircle2 className="h-6 w-6" /> : failed > 0 ? <AlertTriangle className="h-6 w-6" /> : <Info className="h-6 w-6" />}
      </span>
      <div className="space-y-1.5" role="status">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        {results.success > 0 && (
          <p className="text-sm text-foreground">
            {plural(results.success, 'candidat inscrit', 'candidats inscrits')} dans la séquence
          </p>
        )}
        {results.skipped > 0 && (
          <p className="text-sm text-muted-foreground">
            {plural(results.skipped, 'candidat déjà inscrit', 'candidats déjà inscrits')}, sans nouvelle inscription
          </p>
        )}
      </div>
      {failed > 0 && (
        <div className="space-y-1.5 rounded-xl border border-danger/25 bg-danger-muted p-3 text-left">
          <p className="text-sm font-medium text-foreground">
            {failed > 1 ? `${failed} inscriptions n'ont pas abouti` : "1 inscription n'a pas abouti"}
          </p>
          <ul className="space-y-0.5 text-xs text-foreground-secondary">
            {results.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
          <p className="text-xs text-foreground-secondary">
            Rouvrez la préparation pour relancer leur inscription : leurs aperçus sont conservés.
          </p>
        </div>
      )}
      <Button variant="primary" onClick={onClose} autoFocus>
        Fermer
      </Button>
    </div>
  );
}

function PreviewPanelFallback({ hasProfiles }: { hasProfiles: boolean }) {
  if (!hasProfiles) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Aucun candidat dans la sélection.
      </p>
    );
  }

  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      </div>

      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-xl border border-border">
          <div className="border-b border-border px-3 py-2">
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="space-y-2 px-3 py-3">
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

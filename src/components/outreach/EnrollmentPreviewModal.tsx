import React, { useState, useEffect, useMemo, useCallback, useRef, useId } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LinkedInProfile } from '@/components/outreach/types';
import { useEnrollmentPreview, SequenceStepPreview, missionIdOfJob, hasMessage } from '@/hooks/useEnrollmentPreview';
import { keptForSendKeys, previewDisplayText, previewEditableText, usePreviewValues } from '@/hooks/usePreviewValues';
import { inviteNoteText, templateKeys } from '@/lib/templatePreview';
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
  AlertCircle, AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Info, ListChecks, Pencil, RefreshCw, Search, Undo2,
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
import type { Json } from '@/integrations/supabase/types';
import {
  findRecentEnrollments,
  formatRecentContactLabel,
  RECENT_CONTACT_WINDOW_DAYS,
  type RecentEnrollment,
} from '@/lib/enrollmentDuplicates';
import { CLOSED_CHANNEL_ACTION_TYPES, checkProfilesCompat, isClosedChannelStep, normalizeNetworkDistance, pickFirstStep } from '@/lib/sequenceCompatibility';
import { SendingAccountNotice } from './enrollment-preview/SendingAccountNotice';
import { OTHER_MEMBER_ACCOUNT_MESSAGE, useSendingAccount } from './enrollment-preview/useSendingAccount';
import { enrollmentRowFields } from './enrollment-preview/enrollmentRowFields';
import {
  FirstMessagePreviewBlock,
  RecipientsConfirm,
  type FirstMessagePreview,
  type FirstMessagePreviewItem,
} from './enrollment-preview/RecipientsConfirm';
import { useRecipientsConfirm } from './enrollment-preview/useRecipientsConfirm';
import { aiReviewMissingMessage } from '@/lib/contactRecipientsGuard';
import { firstMessagePath } from './enrollment-preview/firstMessagePath';
import {
  alreadyInSequenceLabel,
  alreadyPassedLabel,
  classifyExistingEnrollment,
  dedupeProfilesByIdentity,
  DUPLICATE_CHECK_FAILED_MESSAGE,
  enrollFailureMessage,
  enrollmentRefusalOf,
  findBlockingSequenceEnrollments,
  firstActionSummary,
  formerPassageLabel,
  isOtherMemberAccountError,
  NO_LINKEDIN_ACCOUNT_DESCRIPTION,
  NO_LINKEDIN_ACCOUNT_TITLE,
  samePersonRefusedLabel,
  sequenceInactiveReason,
} from './enrollment-preview/enrollmentHelpers';
import { gdprErasedEnrollLabel, refusedCandidatesLabel } from '@/lib/sequenceErrorMessages';
import { plural } from '@/lib/plural';
import { setCandidateStages, skippedStageMessage, stageErrorMessage, type GeneralStage } from '@/lib/candidateStage';
import { invalidateStageReaders } from '@/lib/stageDisplay';

// Étapes de départ de « Présélectionner sans message » : jamais un recul depuis Contacté ou plus loin.
const RETAIN_FROM_STAGES: GeneralStage[] = ['to_sort', 'retained', 'rejected'];

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
  /** Avertissement propre au point d'entrée (ex. relation LinkedIn non vérifiée depuis la messagerie). */
  notice?: string | null;
  onSuccess: () => void;
}

// ── Helpers ──

/** Coût annoncé avant l'action, en toutes lettres. */
function creditsLabel(n: number): string {
  return n > 0 ? `environ ${plural(n, 'crédit')}` : 'aucun crédit';
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Types d'étape dont l'objet part avec le message (InMail, e-mail, message IA en InMail). */
const SUBJECT_ACTIONS = ['inmail', 'email', 'smart_message'];

/**
 * Lot 5d-1 : étape écrite pour un candidat, rendue avec les valeurs du serveur
 * (preview_values) : en préparation (squelette, jamais un texte faux), prête
 * (texte affiché, texte de départ d'une retouche), ou sans aperçu (raison du
 * serveur, « Réessayer » si un nouvel essai peut aboutir).
 */
type WrittenStepPreview =
  | { status: 'loading' }
  | { status: 'ready'; subject: string; text: string; editableSubject: string; editableText: string }
  | { status: 'unavailable'; message: string; onRetry?: () => void };

/** Texte affiché d'une étape : la note d'invitation coupée comme le moteur la coupe (300 caractères). */
const shownText = (actionType: string, text: string) => (actionType === 'connection_request' ? inviteNoteText(text) : text);

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
    // Embranchements suivis par le moteur (vérification oui / non, chaînage) :
    // l'aperçu les signale et l'IA ne mélange pas les deux chemins.
    ifTrueGotoStep: s.if_true_goto_step || s.ifTrueGotoStep || null,
    ifFalseGotoStep: s.if_false_goto_step || s.ifFalseGotoStep || null,
    nextStepId: s.next_step_id || s.nextStepId || null,
    // Parcours du premier message (versions A/B, fin de séquence).
    variantGroup: s.variant_group ?? s.variantGroup ?? null,
    endsSequence: s.ends_sequence ?? s.endsSequence ?? null,
  })).sort((a, b) => a.stepOrder - b.stepOrder);
}

/**
 * Étape dont le message est préparé ici : même règle que la génération
 * (hasMessage : modèle écrit, ou rédaction par l'IA même sans modèle). Un
 * canal fermé (e-mail, WhatsApp, D2) est sauté par le moteur : pas de carte
 * d'aperçu, l'arbre le montre compact.
 */
function isPreviewedMessageStep(step: SequenceStepPreview): boolean {
  return !isClosedChannelStep(step.actionType) && hasMessage(step);
}

/**
 * Affiche {{calendly_link}} (ou {{lien_calendly}}) comme une pastille : le
 * moteur y met le lien d'agenda de la mission à l'envoi. Le texte enregistré
 * dans les messages de l'inscription garde la variable telle quelle.
 */
function renderSendTimeVariables(text: string): React.ReactNode {
  const segments = text.split(/\{\{\s*(?:calendly_link|lien_calendly)\b[^}]*\}\}/gi);
  if (segments.length === 1) return text;
  return segments.flatMap((segment, i) => (i === 0 ? [segment] : [
    <span
      key={`agenda-${i}`}
      className="inline-flex items-center gap-1 rounded-full border border-info/25 bg-info-muted px-1.5 py-px align-baseline text-2xs font-medium text-info"
    >
      <CalendarClock className="h-3 w-3" aria-hidden="true" />
      Lien d'agenda, ajouté à l'envoi
    </span>,
    segment,
  ]));
}

/** « Inscription 12 sur 50… » pendant la boucle, « Inscription… » avant le premier candidat. */
function enrollProgressLabel(progress: { done: number; total: number } | null): string {
  return progress ? `Inscription ${progress.done} sur ${progress.total}…` : 'Inscription…';
}

/**
 * Titre du bandeau de compatibilité (candidats exclus ou inclus quand même).
 * Bloquent : un candidat injoignable, et un candidat déjà en relation quand la
 * séquence ne contient que l'invitation. Déjà en relation avec des messages
 * après l'invitation : simple avertissement (invitation sautée, suite envoyée).
 * Autonome (sans import) : les tests l'évaluent seule.
 */
function compatHeadline(blockers: { issue: string | null }[], included: boolean): string {
  const n = blockers.length;
  const many = n > 1;
  const reason = blockers.every(r => r.issue === 'too_far')
    ? ` : hors de votre réseau LinkedIn, seul un InMail peut ${many ? 'les ' : "l'"}atteindre`
    : blockers.every(r => r.issue === 'connection_only_already_connected')
      ? " : déjà en relation, et la séquence ne contient qu'une invitation"
      : '';
  const outcome = included
    ? (many ? 'Ils seront inscrits quand même.' : 'Il sera inscrit quand même.')
    : (many ? "Ils sont exclus de l'inscription." : "Il est exclu de l'inscription.");
  return `${n} candidat${many ? 's' : ''} ne ${many ? 'peuvent' : 'peut'} pas suivre cette séquence${reason}. ${outcome}`;
}

interface EnrollResults {
  success: number;
  /** Déjà dans la séquence (en cours ou en pause). */
  skipped: number;
  /** Déjà passés par la séquence (terminée, réponse, arrêtée) : à reprendre depuis le suivi. */
  alreadyPassed: number;
  /** Refusés par la base, par nom : profil effacé (décision 12). */
  gdprErased: string[];
  /** Refusés par la base, par nom : même personne dans la séquence sous un autre identifiant (décision 21). */
  samePerson: string[];
  /** Inscrits, déjà passés par la séquence il y a plus de 90 jours sous un autre identifiant (décision 23). */
  formerPassages: number;
  errors: string[];
}

// ── Component ──

export const EnrollmentPreviewModal: React.FC<EnrollmentPreviewModalProps> = ({
  isOpen,
  onClose,
  sequence,
  profiles,
  accountId,
  job,
  notice,
  onSuccess,
}) => {
  const { organizationId, isAdmin } = useOrganization();
  const queryClient = useQueryClient();
  const steps = useMemo(() => mapSteps(sequence.steps), [sequence.steps]);
  const isSingle = profiles.length === 1;
  const isBulk = profiles.length > 10;
  const candidateIds = useMemo(() => profiles.map(profile => profile.id), [profiles]);
  const firstProfileId = candidateIds[0] ?? '';
  const hasSendableMessage = useMemo(() => steps.some(isPreviewedMessageStep), [steps]);
  // Compte d'envoi affiché près du bouton ; déconnecté ou relié à un collègue,
  // il bloque l'inscription (liaison stricte).
  const sendingAccount = useSendingAccount(accountId);

  const [selectedCandidateId, setSelectedCandidateId] = useState<string>(firstProfileId);
  const [mode, setMode] = useState<'preview' | 'summary'>(
    !hasSendableMessage ? 'summary' : (isBulk ? 'summary' : 'preview')
  );
  const [editingSteps, setEditingSteps] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isShortlisting, setIsShortlisting] = useState(false);
  // « Inscription {done} sur {total}… » pendant la boucle d'inscription.
  const [enrollProgress, setEnrollProgress] = useState<{ done: number; total: number } | null>(null);
  // Tant qu'une écriture est en cours, la fenêtre ne se ferme pas : la fermer
  // n'arrêterait pas les inscriptions et le bilan serait perdu.
  const isBusy = isEnrolling || isShortlisting;
  const [enrollResults, setEnrollResults] = useState<EnrollResults | null>(null);
  const [page, setPage] = useState(0);
  const [mobilePane, setMobilePane] = useState<'list' | 'preview'>('preview');
  const pageSize = 10;
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  // Candidat montré par « Aperçu du premier message » du Récapitulatif (null : le premier prêt).
  const [summaryCandidateIndex, setSummaryCandidateIndex] = useState<number | null>(null);
  // Lot 5a-2 : candidat montré par « Messages rédigés par l'IA » du Récapitulatif (null : le premier à générer).
  const [aiSummaryIndex, setAiSummaryIndex] = useState<number | null>(null);

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
    // En contexte de mission, la lecture attend l'organisation.
    if (missionIdOfJob(job.id) && !organizationId) return;
    scoreFetchedRef.current = true;

    const fetchScores = async () => {
      // Contexte de mission (lot 0c-4) : la note par mission et organisation,
      // quelle que soit la forme du job_id ou l'auteur de la ligne ; sinon le poste.
      const missionId = missionIdOfJob(job!.id);
      const ids = profiles.map(p => p.id);
      type ScoreRow = { candidate_id: string; score: number | null; recommendation: string | null };
      // Par lots de 100 : un envoi groupé peut compter des centaines de profils.
      const readBy = async (column: 'project_id' | 'job_id', value: string): Promise<ScoreRow[]> => {
        const rows: ScoreRow[] = [];
        for (let i = 0; i < ids.length; i += 100) {
          let query = supabase
            .from('job_candidate_status')
            .select('candidate_id, score, recommendation')
            .in('candidate_id', ids.slice(i, i + 100))
            .eq(column, value);
          if (column === 'project_id' && organizationId) query = query.eq('organization_id', organizationId);
          // Plus récente d'abord : la ligne notée la plus récente l'emporte plus bas.
          const { data, error } = await query.order('updated_at', { ascending: false });
          if (error) throw error;
          rows.push(...((data ?? []) as ScoreRow[]));
        }
        return rows;
      };

      try {
        let rows = missionId ? await readBy('project_id', missionId) : [];
        // Un job_id ancien n'est pas une mission : repli sur le poste.
        if (rows.length === 0) rows = await readBy('job_id', job!.id);
        const map = new Map<string, { score: number | null; recommendation: string | null }>();
        // Doublons d'un candidat dans la mission, règle de la vue : la ligne notée la
        // plus récente, à défaut la plus récente (les lignes arrivent de la plus récente).
        rows.forEach((r) => {
          const prev = map.get(r.candidate_id);
          if (prev && !(prev.score == null && r.score != null)) return;
          map.set(r.candidate_id, { score: r.score, recommendation: r.recommendation });
        });
        setScoreCache(map);
      } catch (err) {
        // Sans note affichée, l'aperçu reste utilisable : on journalise seulement.
        console.warn('[EnrollmentPreviewModal] lecture des notes impossible :', err);
      }
    };
    fetchScores();
  }, [job?.id, profiles, organizationId]);

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

  // ── Anti-doublon organisation ──
  // Candidats déjà contactés par un membre (séquence encore vivante, contact
  // des 90 derniers jours, InMail groupé) : signalés et exclus de
  // l'inscription, sauf dérogation cochée par un propriétaire ou
  // administrateur. null = vérification pas encore aboutie ; en cas d'échec,
  // un bandeau bloquant propose de réessayer (jamais de Map vide inventée).
  const [recentEnrollments, setRecentEnrollments] = useState<Map<string, RecentEnrollment> | null>(null);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [duplicateCheckFailed, setDuplicateCheckFailed] = useState(false);
  const [duplicateCheckAttempt, setDuplicateCheckAttempt] = useState(0);
  const [enrollDuplicatesAnyway, setEnrollDuplicatesAnyway] = useState(false);
  const profilesKey = useMemo(() => profiles.map(p => p.id).join('|'), [profiles]);
  useEffect(() => {
    if (!isOpen || !organizationId) return;
    let cancelled = false;
    setRecentEnrollments(null);
    setDuplicateCheckFailed(false);
    setEnrollDuplicatesAnyway(false);
    setIsCheckingDuplicates(true);
    findRecentEnrollments(supabase, organizationId, profiles)
      .then(map => { if (!cancelled) setRecentEnrollments(map); })
      .catch(err => {
        console.warn('[EnrollmentPreviewModal] recent enrollments check failed:', err);
        if (!cancelled) setDuplicateCheckFailed(true);
      })
      .finally(() => { if (!cancelled) setIsCheckingDuplicates(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, organizationId, profilesKey, duplicateCheckAttempt]);
  // L'inscription attend la fin de la vérification des contacts récents.
  const duplicatesUnchecked = !recentEnrollments;

  const allowDuplicates = isAdmin && enrollDuplicatesAnyway;
  const duplicateProfiles = useMemo(() =>
    recentEnrollments
      ? profiles.filter(p => recentEnrollments.has(p.id) && !getCandidateState(p.id).removed)
      : [],
    [profiles, recentEnrollments, getCandidateState]);

  // ── Compatibilité candidat / séquence ──
  // Même contrôle que l'inscription simple : un candidat hors réseau ne peut
  // être joint que par InMail, un candidat déjà en relation ne reçoit rien
  // d'une séquence qui n'a que l'invitation (exclus par défaut, « Inclure
  // quand même ») ; déjà en relation avec une suite : averti (invitation sautée).
  const compat = useMemo(() => checkProfilesCompat(profiles, sequence.steps), [profiles, sequence.steps]);
  const incompatibleIds = useMemo(() => new Set(compat.blockers.map(r => r.profile.id)), [compat.blockers]);
  const [includeIncompatible, setIncludeIncompatible] = useState(false);
  const includeIncompatibleId = useId();

  // Active profiles (not removed, not skipped, compatible unless included,
  // not recently contacted unless override)
  const activeProfiles = useMemo(() =>
    profiles.filter(p => {
      const s = getCandidateState(p.id);
      if (s.removed || s.skipped) return false;
      if (!includeIncompatible && incompatibleIds.has(p.id)) return false;
      return allowDuplicates || !recentEnrollments?.has(p.id);
    }), [profiles, getCandidateState, candidateStates, recentEnrollments, allowDuplicates, includeIncompatible, incompatibleIds]);

  // Raison d'exclusion de chaque candidat encore affiché : pastille sur sa
  // carte et détail du compteur (un seul chiffre, issu de activeProfiles).
  const exclusionByCandidate = useMemo(() => {
    const map = new Map<string, { label: string; title: string }>();
    for (const p of profiles) {
      const s = getCandidateState(p.id);
      if (s.removed || s.skipped) continue;
      if (!includeIncompatible && incompatibleIds.has(p.id)) {
        const reason = compat.blockers.find(r => r.profile.id === p.id)?.message;
        map.set(p.id, { label: 'Incompatible, exclu', title: reason || 'Ne peut pas suivre cette séquence' });
        continue;
      }
      const recent = allowDuplicates ? undefined : recentEnrollments?.get(p.id);
      if (recent) map.set(p.id, { label: 'Déjà contacté, exclu', title: formatRecentContactLabel(recent) });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, candidateStates, includeIncompatible, incompatibleIds, compat.blockers, allowDuplicates, recentEnrollments]);
  const excludedCounts = useMemo(() => {
    let duplicates = 0;
    let incompatible = 0;
    exclusionByCandidate.forEach(e => {
      if (e.label.startsWith('Déjà contacté')) duplicates++;
      else incompatible++;
    });
    return { duplicates, incompatible };
  }, [exclusionByCandidate]);

  // Aperçus conservés pour la session : même séquence, même mission, même
  // compte d'envoi (revue design D-46). La génération groupée, son compteur et
  // l'estimation de crédits ne visent que les candidats qui seront inscrits
  // (activeProfiles).
  const sessionKey = `${sequence.id}|${job?.id ?? ''}|${accountId}`;
  // ── Lot 5d-1 : aperçu réel des étapes écrites (preview_values) ──
  // Valeurs calculées par le serveur comme le moteur à l'envoi, pour les
  // seules variables des textes de la séquence ; le texte est rendu ici
  // (renderTemplatePreview). Candidats de l'écran demandés plus bas (pages de
  // 10) ; un candidat hors de l'écran l'est quand l'IA rédige pour lui.
  const previewKeys = useMemo(() => templateKeys(steps.flatMap(s => [s.messageTemplate, s.subjectTemplate])), [steps]);
  const previewValues = usePreviewValues({
    organizationId,
    missionId: missionIdOfJob(job?.id) ?? null,
    sequenceId: sequence.id,
    accountId,
    jobTitle: job?.title ?? null,
    keys: previewKeys,
  });
  const { ensure: ensurePreviewValues } = previewValues;
  // Lu par la génération des messages IA : texte des étapes écrites qui les
  // précèdent, texte de départ si une génération échoue (valeurs attendues).
  const writtenTextForAi = useCallback(async (profile: LinkedInProfile, step: SequenceStepPreview) => {
    const { entries, sendTime } = await ensurePreviewValues([profile]);
    const entry = entries.get(profile.id);
    if (entry?.status !== 'ready') return null;
    const keep = keptForSendKeys(entry, sendTime);
    return {
      subject: previewEditableText(step.subjectTemplate, entry.values, keep),
      message: previewEditableText(step.messageTemplate, entry.values, keep),
    };
  }, [ensurePreviewValues]);
  const {
    previews, messageSteps, hasMessageSteps, hasAiSteps,
    aiReviewSteps, aiReviewMissingCount, aiGenerationVersion,
    generatedCount, totalToGenerate, isBulkGenerating,
    estimatedCredits, creditsPerMessage, candidateAnalysis,
    getPreview, generateForCandidateById, regenerateStep,
    editMessage, generateAll, cancelBulkGeneration, getMessageOverrides, discardSessionPreviews,
    getStepConfig, setStepConfig, getStepConfigOverrides,
  } = useEnrollmentPreview({ steps, profiles, targetProfiles: activeProfiles, job, accountId, sessionKey, writtenText: writtenTextForAi });

  // « Première action : …, dès maintenant / dans 2 jours, pendant vos heures
  // d'envoi » : première étape planifiée et son délai effectif (délai modifié
  // pour cette inscription compris), repris dans le toast de fin.
  const firstAction = useMemo(
    () => firstActionSummary(sequence.steps, getStepConfigOverrides()),
    [sequence.steps, getStepConfigOverrides],
  );

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
    if (!accountId) {
      toast.error(NO_LINKEDIN_ACCOUNT_TITLE, { description: NO_LINKEDIN_ACCOUNT_DESCRIPTION });
      return;
    }
    if (sendingAccount.blockReason) {
      toast.error(sendingAccount.blockReason);
      return;
    }
    // Lot 5a : dès 5 candidats, rien ne part sans la case des destinataires.
    // Lot 5a-2 : séquence à message IA, rien ne part sans chaque texte généré
    // et la case de relecture.
    if (recipients.blocked || aiReviewMissingCount > 0) return;

    setIsEnrolling(true);
    setEnrollResults(null);
    setEnrollProgress(null);
    const results: EnrollResults = { success: 0, skipped: 0, alreadyPassed: 0, gdprErased: [], samePerson: [], formerPassages: 0, errors: [] };
    // Candidats réellement inscrits : leurs aperçus de session sont libérés
    // (rien n'est écrit dans le pipeline à l'inscription, lot 0b).
    const enrolledProfiles: LinkedInProfile[] = [];

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Session expirée : reconnectez-vous, puis réessayez.');
        return;
      }
      const userId = user.id;

      // Séquence désactivée entre l'ouverture du menu et le clic : refus.
      const inactiveReason = await sequenceInactiveReason(supabase, sequence.id);
      if (inactiveReason) {
        toast.error(inactiveReason);
        return;
      }

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
        setDuplicateCheckFailed(false);
      }
      // Même personne sélectionnée sous deux identifiants : une seule
      // inscription, les autres comptées « déjà dans cette séquence ».
      const { unique: enrollSet, duplicates } = dedupeProfilesByIdentity(allowDuplicates
        ? activeProfiles
        : activeProfiles.filter(p => !recent.has(p.id)));
      results.skipped += duplicates;
      if (enrollSet.length === 0) {
        toast.error(
          activeProfiles.length === 0
            ? 'Aucun candidat à inscrire'
            : 'Tous les candidats ont déjà été contactés par votre organisation',
        );
        return;
      }

      for (let index = 0; index < enrollSet.length; index++) {
        const profile = enrollSet[index];
        setEnrollProgress({ done: index + 1, total: enrollSet.length });
        try {
          // Pré-contrôle : la contrainte DB UNIQUE(sequence_id, profile_id)
          // est inconditionnelle, toute ligne existante empêche l'inscription ;
          // sous un autre identifiant du candidat ou son slug public, une
          // inscription en cours ou en pause l'empêche aussi, dérogation
          // comprise (SEQ-046), et une inscription close depuis moins de 90
          // jours (décision 21) ; au-delà, il est inscrit avec un avertissement
          // (décision 23).
          // On distingue « déjà dans la séquence » (en cours, en pause) de
          // « déjà passé par la séquence » (terminée, réponse, arrêtée), à
          // reprendre depuis le suivi. La race fenêtre entre SELECT et INSERT
          // est gérée plus bas via UPSERT + ignoreDuplicates.
          const matches = await findBlockingSequenceEnrollments(supabase, sequence.id, [profile]);
          const existing = matches.blocking.get(profile.id);

          if (existing) {
            if (classifyExistingEnrollment(existing.status) === 'in_sequence') results.skipped++;
            else results.alreadyPassed++;
            continue;
          }

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
          const trackingData: Record<string, Json> = {};
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
              ...enrollmentRowFields(profile),
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

          // Première étape tirée pour CE candidat : un test A/B en première
          // position répartit les variantes comme le moteur (pondération
          // variant_weight) au lieu de n'envoyer que la première ligne.
          const { step: firstStep, variantAssigned } = pickFirstStep(sequence.steps);
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
                variant_assigned: variantAssigned,
                organization_id: organizationId, // RLS multi-tenant
              });

            // Si l'insert de la 1re exécution échoue (RLS, contrainte…),
            // l'enrollment serait « dormant » : actif mais sans aucune étape
            // planifiée — le moteur ne le reprendra JAMAIS (il ne traite que
            // des exécutions existantes). On remonte l'erreur au lieu de
            // compter un faux succès (audit 2026-07, Frontend H2).
            if (execError) {
              console.error('[EnrollmentPreviewModal] first execution insert failed:', execError);
              // Retrait vérifié (.select) : un refus silencieux laisserait une
              // inscription active sans étape, jamais reprise par le moteur.
              const { data: removed } = await supabase
                .from('sequence_enrollments')
                .delete()
                .eq('id', enrollment.id)
                .select('id');
              results.errors.push(removed?.length
                ? `${profile.name} : les étapes n'ont pas pu être planifiées, candidat non inscrit.`
                : `${profile.name} : les étapes n'ont pas pu être planifiées et l'inscription n'a pas pu être retirée. Retirez-la depuis le suivi de la séquence.`);
              continue;
            }
          }

          results.success++;
          if (matches.formerPassages.has(profile.id)) results.formerPassages++;
          enrolledProfiles.push(profile);
        } catch (err) {
          // Refus de la base (SEQ-043) : compte relié à un autre membre. Tous
          // les candidats suivants échoueraient pareil : on arrête la boucle.
          if (isOtherMemberAccountError(err)) throw err;
          // Refus propres à ce candidat (profil effacé, même personne dans la
          // séquence) : comptés à part, les suivants restent inscriptibles.
          const refusal = enrollmentRefusalOf(err);
          if (refusal === 'gdpr_erased') { results.gdprErased.push(profile.name || 'Candidat sans nom'); continue; }
          if (refusal === 'same_person') { results.samePerson.push(profile.name || 'Candidat sans nom'); continue; }
          // Détail technique en console seulement : jamais le message brut de
          // la base (« new row violates row-level security policy… »).
          console.error('[EnrollmentPreviewModal] enrollment failed for', profile.id, err);
          results.errors.push(enrollFailureMessage(profile.name));
        }
      }

      // Rien n'est écrit dans le pipeline à l'inscription : le serveur passe
      // le candidat à « Contacté » au premier envoi réel (lot 0b).

      // Les candidats inscrits n'ont plus besoin de leurs aperçus.
      const enrolledIds = enrolledProfiles.map(p => p.id);
      discardSessionPreviews(enrolledIds);
      setEnrollResults(results);
      if (results.success > 0) {
        toast.success(`${plural(results.success, 'candidat inscrit', 'candidats inscrits')} dans la séquence`, {
          description: firstAction ?? undefined,
        });
      }
      if (results.errors.length > 0) {
        const e = results.errors.length;
        toast.error(`${e} inscription${e > 1 ? 's' : ''} en échec`, {
          description: 'Le détail est affiché dans la fenêtre.',
        });
      }
      if (results.gdprErased.length > 0) toast.warning(gdprErasedEnrollLabel(results.gdprErased.length), { description: refusedCandidatesLabel(results.gdprErased) });
      if (results.samePerson.length > 0) toast.warning(samePersonRefusedLabel(results.samePerson.length), { description: refusedCandidatesLabel(results.samePerson) });
      if (results.formerPassages > 0) toast.warning(formerPassageLabel(results.formerPassages));
      if (results.alreadyPassed > 0) toast.info(alreadyPassedLabel(results.alreadyPassed));
      if (results.skipped > 0) toast.info(alreadyInSequenceLabel(results.skipped));
    } catch (err) {
      console.error('[EnrollmentPreviewModal] Bulk enrollment failed:', err);
      // Compte relié à un autre membre : réessayer échouerait de la même façon.
      toast.error('Inscription impossible', {
        description: isOtherMemberAccountError(err) ? OTHER_MEMBER_ACCOUNT_MESSAGE : 'Réessayez ou contactez le support.',
      });
    } finally {
      setIsEnrolling(false);
      setEnrollProgress(null);
    }
  };

  // ── Shortlist without message ──
  // Lot 0b-4 (N15) : une écriture groupée des données du profil, sans statut,
  // relue (.select), puis set_candidate_stages (origine user) retient les
  // candidats à trier, retenus ou écartés. Le nombre annoncé est celui des
  // lignes réellement retenues. Un candidat déjà contacté ou plus loin garde
  // son étape (jamais rétrogradé), et c'est annoncé.
  const handleShortlist = async () => {
    if (!job?.id) {
      toast.error('Aucune mission associée à ces candidats', {
        description: 'Ouvrez la préparation depuis une mission pour les retenir.',
      });
      return;
    }
    if (!organizationId) {
      toast.error("Votre organisation n'a pas pu être identifiée", {
        description: 'Rechargez la page ou reconnectez votre compte.',
      });
      return;
    }
    if (activeProfiles.length === 0) return;
    setIsShortlisting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Session expirée : reconnectez-vous, puis réessayez.');
        return;
      }
      const userId = user.id;

      // Clé des lignes du Sourcing de mission : job.id tel quel (« project:<uuid> »
      // depuis une mission), comme useJobCandidateStatus. Une ligne déjà présente
      // sous l'une des deux formes (avec ou sans préfixe) est reprise, jamais
      // doublée : set_candidate_stages porte sur les lignes réelles du candidat.
      const jobIdForms = job.id.startsWith('project:')
        ? [job.id, job.id.slice('project:'.length)]
        : [job.id];
      const { data: existingRows, error: readError } = await supabase
        .from('job_candidate_status')
        .select('id, candidate_id')
        .in('job_id', jobIdForms)
        .eq('created_by', userId)
        .in('candidate_id', activeProfiles.map(p => p.id));
      if (readError) throw readError;
      const existingCandidates = new Set((existingRows ?? []).map(r => r.candidate_id));

      const missingProfiles = activeProfiles.filter(profile => !existingCandidates.has(profile.id));
      const rows = missingProfiles.map(profile => ({
        job_id: job.id,
        candidate_id: profile.id,
        candidate_name: profile.name || null,
        candidate_headline: profile.headline || null,
        linkedin_profile_url: profile.profile_url || profile.public_profile_url || null,
        created_by: userId,
        organization_id: organizationId, // requis par RLS org_members_all
      }));

      let written: { id: string }[] = [];
      if (rows.length > 0) {
        const { data, error: writeError } = await supabase
          .from('job_candidate_status')
          .upsert(rows, { onConflict: 'job_id,candidate_id,created_by' })
          .select('id');
        if (writeError) throw writeError;
        written = data ?? [];
      }

      const ids = [...(existingRows ?? []).map(r => r.id), ...written.map(r => r.id)];
      const outcome = await setCandidateStages(ids, { stage: 'retained' }, RETAIN_FROM_STAGES, { surface: 'enrollment' });
      const saved = outcome.updated + outcome.unchanged;
      if (saved > 0) void invalidateStageReaders(queryClient);
      const failure = outcome.error ?? outcome.rows.find(r => r.result === 'error') ?? null;
      if (failure) console.error('[EnrollmentPreviewModal] Shortlist stage failed:', failure);

      if (saved === 0 && outcome.skipped === 0) {
        // Rien d'enregistré (refus silencieux ou refus de l'étape) : la fenêtre reste ouverte.
        toast.error(failure ? stageErrorMessage(failure.hint) : "Ajout impossible : aucun candidat n'a été enregistré.");
        return;
      }
      const failed = (existingRows ?? []).length + rows.length - saved - outcome.skipped;
      if (saved > 0) {
        const added = plural(saved, 'candidat retenu', 'candidats retenus');
        if (failed > 0) {
          toast.warning(added, {
            description: `${failed} candidat${failed > 1 ? 's' : ''} n'${failed > 1 ? 'ont' : 'a'} pas pu être enregistré${failed > 1 ? 's' : ''}.`,
          });
        } else {
          toast.success(added);
        }
      }
      const skipped = skippedStageMessage(outcome.skipped);
      if (skipped) toast.info(skipped);
      onSuccess();
    } catch (err) {
      console.error('[EnrollmentPreviewModal] Shortlist failed:', err);
      toast.error("Ajout impossible : aucun candidat n'a été enregistré.");
    } finally {
      setIsShortlisting(false);
    }
  };

  const handleClose = () => {
    // Jamais de fermeture pendant une écriture : la boucle d'inscription
    // continuerait et le bilan serait perdu.
    if (isBusy) return;
    if (enrollResults?.success) {
      onSuccess();
      return;
    }
    onClose();
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

  // Croix, Échap et « Annuler » passent tous par ici.
  const requestClose = () => {
    if (isBusy) return;
    if (enrollResults) {
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
    setConfirmCloseOpen(false);
    // Même garde que handleClose : jamais de fermeture pendant une inscription.
    if (isBusy) return;
    cancelBulkGeneration();
    onClose();
  };

  // ── Aperçus : prêts, manquants, coût annoncé avant l'action ──
  const isReady = useCallback((candidateId: string, stepId: string) => {
    const preview = getPreview(candidateId, stepId);
    return !!preview && !preview.isGenerating && (preview.isGenerated || !!preview.isEdited);
  }, [getPreview]);
  // Lot 5d-1 : une étape écrite n'a rien à générer ; elle est prête quand le
  // serveur a donné ses valeurs (ou qu'elle est retouchée), jamais en
  // préparation, sans aperçu (effacement, échec) ni avant d'être demandée.
  const { entryOf: previewEntryOf } = previewValues;
  const stepReady = useCallback(
    (candidateId: string, step: SequenceStepPreview) => (step.useAiPersonalization
      ? isReady(candidateId, step.stepId)
      : previewEntryOf(candidateId)?.status === 'ready' || !!getPreview(candidateId, step.stepId)?.isEdited),
    [isReady, previewEntryOf, getPreview],
  );

  const listedProfiles = useMemo(
    () => profiles.filter(p => !getCandidateState(p.id).removed),
    [profiles, getCandidateState],
  );
  // Comme la génération groupée : seulement les candidats qui seront inscrits.
  const readyCount = activeProfiles.filter(p => messageSteps.every(s => stepReady(p.id, s))).length;
  const bulkMissingAi = activeProfiles.reduce(
    (sum, p) => sum + messageSteps.filter(s => s.useAiPersonalization && !isReady(p.id, s.stepId)).length,
    0,
  );
  const bulkMissingCandidates = activeProfiles.filter(p => messageSteps.some(s => !stepReady(p.id, s))).length;

  // ── Lot 5a : case des destinataires et premier message ──
  // N = activeProfiles.length, le nombre du bouton « Inscrire N candidats » :
  // retraits, exclusions et dérogations déjà appliqués. Case décochée dès que
  // la liste change.
  // Lot 5a-2 : séquence à message rédigé par l'IA, la case vaut relecture,
  // obligatoire quel que soit N, décochée par toute génération ou
  // régénération ; dès 5, une seule case pour les deux.
  const hasAiReview = aiReviewSteps.length > 0;
  const recipients = useRecipientsConfirm(activeProfiles.map(p => p.id), { aiReview: hasAiReview, aiGenerationVersion });
  // Premier message que recevra le candidat : parcours du moteur depuis la
  // première étape (firstMessagePath), étape rédigée par l'IA sans modèle
  // comprise. À « Vérifier la relation », la branche du candidat si sa
  // relation est connue, sinon les deux avec leur condition.
  const firstMessagesOf = (profile: LinkedInProfile) => {
    const distance = normalizeNetworkDistance(profile.network_distance);
    const connected = distance === 'FIRST_DEGREE'
      ? true
      : distance === 'SECOND_DEGREE' || distance === 'THIRD_DEGREE' || distance === 'OUT_OF_NETWORK' ? false : null;
    return firstMessagePath(steps, isPreviewedMessageStep, connected);
  };
  // Texte rendu : l'aperçu généré ou retouché, sinon le modèle rendu avec les
  // valeurs du serveur (lot 5d-1, squelette pendant la préparation) ; un
  // message rédigé par l'IA non généré s'annonce, avec sa génération à la
  // demande (coût annoncé).
  const firstMessageFor = (profile: LinkedInProfile): FirstMessagePreview => {
    const candidateName = profile.name || 'ce candidat';
    const { messages, firstAction: pathFirstAction } = firstMessagesOf(profile);
    if (messages.length === 0) {
      const actionLabel = pathFirstAction ? sequenceActionLabel(pathFirstAction.actionType) : null;
      return {
        candidateName,
        items: [],
        emptyLabel: actionLabel
          ? `Aucun message écrit. Première action : ${lowerFirst(actionLabel)}.`
          : 'Aucun message écrit.',
      };
    }
    const items = messages.map(({ step, condition }): FirstMessagePreviewItem => {
      const preview = getPreview(profile.id, step.stepId);
      const withSubject = SUBJECT_ACTIONS.includes(step.actionType);
      const label = sequenceActionLabel(step.actionType);
      if (isReady(profile.id, step.stepId)) {
        return {
          key: step.stepId,
          label,
          condition,
          subject: withSubject ? preview?.subject || null : null,
          text: shownText(step.actionType, (preview?.message || '').replace(/<br\s*\/?>/gi, '\n')),
        };
      }
      if (step.useAiPersonalization && step.actionType !== 'connection_request') {
        return {
          key: step.stepId,
          label,
          condition,
          text: '',
          aiPending: true,
          onGenerate: () => regenerateStep(profile.id, step.stepId),
          isGenerating: !!preview?.isGenerating,
        };
      }
      const written = writtenPreviewOf(profile, step);
      if (written.status === 'loading') return { key: step.stepId, label, condition, text: '', loading: true };
      if (written.status === 'unavailable') {
        return { key: step.stepId, label, condition, text: '', unavailable: written.message, onRetry: written.onRetry };
      }
      return {
        key: step.stepId,
        label,
        condition,
        subject: withSubject ? written.subject || null : null,
        text: shownText(step.actionType, written.text),
      };
    });
    return { candidateName, items, generateCost: creditsLabel(creditsPerMessage) };
  };
  // Pied : le candidat affiché s'il est inscrit, sinon le premier inscrit.
  const footerProfile = activeProfiles.find(p => p.id === selectedCandidateId) ?? activeProfiles[0] ?? null;
  // Récapitulatif : premier candidat dont le premier message est prêt, puis ‹ › pour passer aux suivants.
  const firstReadyIndex = () => Math.max(0, activeProfiles.findIndex(p => {
    const { messages } = firstMessagesOf(p);
    return messages.length > 0 && messages.every(m => stepReady(p.id, m.step));
  }));
  const summaryIndex = Math.min(summaryCandidateIndex ?? firstReadyIndex(), Math.max(activeProfiles.length - 1, 0));
  const summaryProfile = activeProfiles[summaryIndex] ?? null;

  // Lot 5a-2 : messages rédigés par l'IA d'un candidat, étape par étape, pour
  // les relire dans le Récapitulatif (‹ › d'un candidat à l'autre).
  const aiMessagesFor = (profile: LinkedInProfile): FirstMessagePreview => ({
    candidateName: profile.name || 'ce candidat',
    items: aiReviewSteps.map((step): FirstMessagePreviewItem => {
      const preview = getPreview(profile.id, step.stepId);
      const label = sequenceActionLabel(step.actionType);
      const condition = `Étape ${steps.findIndex(s => s.stepId === step.stepId) + 1}`;
      if (isReady(profile.id, step.stepId)) {
        return {
          key: step.stepId,
          label,
          condition,
          subject: SUBJECT_ACTIONS.includes(step.actionType) ? preview?.subject || null : null,
          text: (preview?.message || '').replace(/<br\s*\/?>/gi, '\n'),
        };
      }
      return {
        key: step.stepId,
        label,
        condition,
        text: '',
        aiPending: true,
        onGenerate: () => regenerateStep(profile.id, step.stepId),
        isGenerating: !!preview?.isGenerating,
      };
    }),
    generateCost: creditsLabel(creditsPerMessage),
  });
  const firstAiMissingIndex = () => Math.max(0, activeProfiles.findIndex(p =>
    aiReviewSteps.some(step => !isReady(p.id, step.stepId))));
  const aiIndex = Math.min(aiSummaryIndex ?? firstAiMissingIndex(), Math.max(activeProfiles.length - 1, 0));
  const aiSummaryProfile = hasAiReview ? activeProfiles[aiIndex] ?? null : null;

  // ── Lot 5d-1 : valeurs des candidats de l'écran (candidat affiché,
  // récapitulatif, pied, page de la liste), demandées par pages de 10 ──
  const hasWrittenSteps = messageSteps.some(s => !s.useAiPersonalization || s.actionType === 'connection_request');
  const screenProfiles = [selectedProfile, summaryProfile, footerProfile, ...pagedProfiles].filter((p): p is LinkedInProfile => !!p);
  const screenProfilesRef = useRef(screenProfiles);
  screenProfilesRef.current = screenProfiles;
  const screenKey = screenProfiles.map(p => p.id).join('\u0001');
  const { request: requestPreviewValues } = previewValues;
  useEffect(() => {
    if (!isOpen || !hasWrittenSteps) return;
    void requestPreviewValues(screenProfilesRef.current);
  }, [isOpen, hasWrittenSteps, screenKey, requestPreviewValues]);
  const writtenPreviewOf = (profile: LinkedInProfile, step: SequenceStepPreview): WrittenStepPreview => {
    const entry = previewValues.entryOf(profile.id);
    if (!entry || entry.status === 'loading') return { status: 'loading' };
    if (entry.status === 'unavailable') {
      return { status: 'unavailable', message: entry.message, onRetry: entry.retryable ? previewValues.retry : undefined };
    }
    const keep = keptForSendKeys(entry, previewValues.sendTime);
    return {
      status: 'ready',
      subject: previewDisplayText(step.subjectTemplate, entry.values, previewValues.sendTime, entry.atSend),
      text: previewDisplayText(step.messageTemplate, entry.values, previewValues.sendTime, entry.atSend),
      editableSubject: previewEditableText(step.subjectTemplate, entry.values, keep),
      editableText: previewEditableText(step.messageTemplate, entry.values, keep),
    };
  };

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
    // Pendant une inscription, la sélection ne bouge plus.
    if (isBusy) return;
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
  const compatListed = [...compat.blockers, ...compat.warnings];

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) requestClose(); }}>
        <DialogContent
          className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 max-sm:h-[100dvh] max-sm:w-screen max-sm:max-w-none"
          // Grand espace de travail : un clic sur la marge ne ferme pas.
          onInteractOutside={(e) => e.preventDefault()}
          // Focus d'arrivée : la ligne du candidat affiché, là où les
          // raccourcis de la liste s'appliquent ; sinon la fenêtre elle-même
          // (jamais la croix : Entrée ne doit pas fermer la préparation).
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
                {plural(activeProfiles.length, 'candidat')} · {plural(sequence.steps.length, 'étape')}
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
              activeProfiles={activeProfiles}
              duplicateExcludedCount={excludedCounts.duplicates}
              incompatibleExcludedCount={excludedCounts.incompatible}
              readyCount={readyCount}
            />
          )}

          {/* Anti-doublon organisation : contactés par un membre (séquence en
              cours, ou contact ces 90 derniers jours), toute séquence et tout
              compte. Exclus par défaut ; dérogation réservée aux propriétaires
              et administrateurs. */}
          {!enrollResults && isCheckingDuplicates && (
            <div role="status" className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground sm:px-6">
              <Spinner size="sm" label="Vérification en cours" />
              Vérification des contacts récents de l'organisation
            </div>
          )}
          {!enrollResults && duplicateCheckFailed && !isCheckingDuplicates && (
            <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-danger/25 bg-danger-muted px-4 py-2 sm:px-6">
              <AlertCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-sm text-foreground">{DUPLICATE_CHECK_FAILED_MESSAGE}</p>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="shrink-0 max-md:h-11"
                onClick={() => setDuplicateCheckAttempt(a => a + 1)}
              >
                Réessayer
              </Button>
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

          {!enrollResults && notice && (
            <div role="note" className="flex shrink-0 items-start gap-2 border-b border-warning/25 bg-warning-muted px-4 py-2.5 sm:px-6">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-sm text-foreground">{notice}</p>
            </div>
          )}

          {/* Compatibilité : candidats qui ne peuvent pas suivre cette séquence
              (hors réseau sans InMail, déjà en relation avec une invitation
              seule), exclus par défaut, « Inclure quand même » pour les garder ;
              avertissements (déjà en relation : invitation sautée, messages
              suivants envoyés) sans exclusion. */}
          {!enrollResults && compatListed.length > 0 && (
            <div role="status" className="shrink-0 border-b border-warning/25 bg-warning-muted px-4 py-2.5 sm:px-6">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-sm font-medium text-foreground">
                    {compat.blockers.length > 0
                      ? compatHeadline(compat.blockers, includeIncompatible)
                      : `${plural(compat.warnings.length, 'candidat')} avec un avertissement`}
                  </p>
                  <ul className="max-h-16 space-y-0.5 overflow-y-auto text-xs text-foreground-secondary">
                    {compatListed.slice(0, 5).map(r => (
                      <li key={r.profile.id} className="break-words">
                        <span className="font-medium text-foreground">{r.profile.name}</span>
                        {' : '}{r.message}
                      </li>
                    ))}
                    {compatListed.length > 5 && <li>et {plural(compatListed.length - 5, 'autre')}</li>}
                  </ul>
                  {compat.blockers.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={includeIncompatibleId}
                        checked={includeIncompatible}
                        onCheckedChange={checked => setIncludeIncompatible(checked === true)}
                      />
                      <Label htmlFor={includeIncompatibleId} className="cursor-pointer text-xs font-normal text-foreground max-md:py-3">
                        Inclure quand même ({compat.blockers.length})
                      </Label>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Corps */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {enrollResults ? (
              <div className="flex flex-1 items-center justify-center overflow-y-auto p-6 sm:p-8">
                <EnrollmentResults results={enrollResults} firstAction={firstAction} onClose={handleClose} />
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
                  firstAction={firstAction}
                  onSwitchToPreview={() => setMode('preview')}
                  firstMessage={summaryProfile ? firstMessageFor(summaryProfile) : null}
                  firstMessageNavigation={{
                    index: summaryIndex,
                    total: activeProfiles.length,
                    onPrevious: () => setSummaryCandidateIndex(Math.max(0, summaryIndex - 1)),
                    onNext: () => setSummaryCandidateIndex(Math.min(activeProfiles.length - 1, summaryIndex + 1)),
                  }}
                  aiMessages={aiSummaryProfile ? aiMessagesFor(aiSummaryProfile) : null}
                  aiMessagesNavigation={{
                    index: aiIndex,
                    total: activeProfiles.length,
                    onPrevious: () => setAiSummaryIndex(Math.max(0, aiIndex - 1)),
                    onNext: () => setAiSummaryIndex(Math.min(activeProfiles.length - 1, aiIndex + 1)),
                  }}
                  renderText={renderSendTimeVariables}
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
                          // Lot 5d-1 : étape écrite prête avec ses valeurs (stepReady), étape IA une fois générée.
                          const allGenerated = messageSteps.every(s => (s.useAiPersonalization ? !!getPreview(p.id, s.stepId)?.isGenerated : stepReady(p.id, s)));
                          const hasEdits = messageSteps.some(s => getPreview(p.id, s.stepId)?.isEdited);
                          const state = getCandidateState(p.id);
                          const cachedScore = scoreCache.get(p.id);

                          return (
                            <div role="listitem" key={p.id}>
                              <ScoringPopover
                                candidateId={p.id}
                                jobId={job?.id}
                                projectId={missionIdOfJob(job?.id)}
                                organizationId={organizationId}
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
                                      exclusion={exclusionByCandidate.get(p.id) ?? null}
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
                  {/* Génération groupée : bouton secondaire, coût annoncé avant
                      l'action, sur les seuls candidats qui seront inscrits. */}
                  {!isSingle && hasAiSteps && activeProfiles.length > 0 && (
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
                      ) : (
                        <>
                          {/* Toujours proposé : relancé quand tout est prêt, il ne
                              régénère rien (les aperçus prêts ou retouchés sont gardés). */}
                          <Button variant="outline" size="sm" onClick={() => generateAll(3)} className="max-md:h-11">
                            Générer tous les aperçus
                          </Button>
                          {bulkMissingCandidates > 0 ? (
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {creditsLabel(bulkMissingAi * creditsPerMessage)} pour {plural(bulkMissingCandidates, 'candidat')}
                            </span>
                          ) : (
                            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                              Les aperçus de tous les candidats à inscrire sont prêts.
                            </p>
                          )}
                        </>
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
                            isReady={step => stepReady(selectedProfile.id, step)}
                            isGenerating={messageSteps.some(s => getPreview(selectedProfile.id, s.stepId)?.isGenerating)}
                            isBulkGenerating={isBulkGenerating}
                            creditsPerMessage={creditsPerMessage}
                            onGenerate={() => generateForCandidateById(selectedProfile.id)}
                          />

                          {/* Vue arborescente : décisions à filet pointillé et
                              branches libellées ; les étapes message gardent leur
                              carte complète (aperçu), les autres sont compactes.
                              Délais et délais maximaux se modifient pour tous les
                              candidats de cette inscription (override stocké
                              côté hook). */}
                          <SequenceTreeView
                            steps={steps}
                            getStepConfig={getStepConfig}
                            setStepConfig={setStepConfig}
                            renderStep={(step, idx) => {
                              const isMessageStep = isPreviewedMessageStep(step);
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
                                  written={step.useAiPersonalization ? null : writtenPreviewOf(selectedProfile, step)}
                                  isEditing={isEditing}
                                  index={idx}
                                  candidateName={selectedProfile.name}
                                  creditsPerMessage={creditsPerMessage}
                                  onToggleEdit={() => toggleEditing(step.stepId)}
                                  onRegenerate={() => regenerateStep(selectedCandidateId, step.stepId)}
                                  onEditMessage={(field, value, base) => editMessage(selectedCandidateId, step.stepId, field, value, base)}
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

          {/* Actions : compte d'envoi, puis une seule action principale,
              monochrome (revue design D-45). */}
          {!enrollResults && (
            <div className="shrink-0 space-y-2 border-t border-border px-4 py-3 sm:px-6">
              <SendingAccountNotice state={sendingAccount} />
              {/* Lot 5a-2 : messages rédigés par l'IA à générer avant
                  d'inscrire. Le bouton de génération groupée est ici quand la
                  barre du haut n'est pas affichée (Récapitulatif, un seul
                  candidat). */}
              {hasAiReview && aiReviewMissingCount > 0 && activeProfiles.length > 0 && (
                <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning/25 bg-warning-muted px-3 py-2">
                  <p className="flex min-w-0 flex-1 items-start gap-2 text-xs text-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                    <span>{aiReviewMissingMessage(aiReviewMissingCount, activeProfiles.length)}</span>
                  </p>
                  {(mode === 'summary' || isSingle) && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => generateAll(3)}
                        loading={isBulkGenerating}
                        disabled={isBusy}
                        className="max-md:h-11"
                      >
                        Générer tous les aperçus
                      </Button>
                      {!isBulkGenerating && (
                        <span className="text-2xs tabular-nums text-muted-foreground">
                          {creditsLabel(bulkMissingAi * creditsPerMessage)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {/* Dès 5 candidats : premier message puis case obligatoire. Le
                  Récapitulatif montre déjà le premier message juste au-dessus.
                  Séquence à message IA : case de relecture, quel que soit N. */}
              <RecipientsConfirm
                count={activeProfiles.length}
                confirmed={recipients.confirmed}
                onConfirmedChange={recipients.setConfirmed}
                preview={mode !== 'summary' && footerProfile ? firstMessageFor(footerProfile) : null}
                renderText={renderSendTimeVariables}
                aiReview={hasAiReview}
                disabled={aiReviewMissingCount > 0}
              />
              {isEnrolling && (
                <p role="status" className="text-xs text-muted-foreground">
                  Inscription en cours, ne fermez pas cette fenêtre.
                </p>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="ghost" onClick={requestClose} disabled={isBusy} className="max-md:h-11">
                  Annuler
                </Button>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                  {job?.id && (
                    <Button
                      variant="outline"
                      onClick={handleShortlist}
                      loading={isShortlisting}
                      disabled={isBusy || activeProfiles.length === 0}
                      className="max-md:h-11"
                    >
                      {!isShortlisting && <ListChecks aria-hidden="true" />}
                      Présélectionner sans message
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    onClick={handleEnroll}
                    loading={isEnrolling}
                    disabled={isBusy || activeProfiles.length === 0 || duplicatesUnchecked || !!sendingAccount.blockReason || recipients.blocked || aiReviewMissingCount > 0}
                    className="max-md:h-11"
                  >
                    {isEnrolling ? enrollProgressLabel(enrollProgress) : enrollLabel}
                  </Button>
                </div>
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

/** Candidats déjà contactés par l'organisation (séquence en cours, ou contact récent). */
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
            {count > 1 ? `${count} candidats déjà contactés` : '1 candidat déjà contacté'} par votre organisation (séquence en cours, ou contact ces {RECENT_CONTACT_WINDOW_DAYS} derniers jours)
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
  /** Lot 5d-1 : une étape écrite est prête avec ses valeurs du serveur ; une étape IA, une fois générée ou retouchée. */
  isReady: (step: SequenceStepPreview) => boolean;
  isGenerating: boolean;
  isBulkGenerating: boolean;
  creditsPerMessage: number;
  onGenerate: () => void;
}) {
  if (steps.length === 0) return null;
  const missing = steps.filter(s => !isReady(s));
  const missingAi = missing.filter(s => s.useAiPersonalization).length;
  const ready = steps.length - missing.length;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-border px-4 py-3">
      <p className="flex items-center gap-1.5 text-sm text-foreground">
        {missing.length === 0 && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />}
        Aperçus prêts pour ce candidat : <span className="tabular-nums">{ready} sur {steps.length}</span>
      </p>
      {/* Lot 5d-1 : seules les étapes IA se génèrent ; une étape écrite en préparation ou sans aperçu le dit sur sa carte. */}
      {missingAi > 0 && (
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
            {missingAi > 1 ? `Générer les ${missingAi} aperçus` : "Générer l'aperçu"}
          </Button>
        </div>
      )}
    </div>
  );
}

function MessageStepCard({
  step, preview, written, isEditing, index, candidateName, creditsPerMessage,
  onToggleEdit, onRegenerate, onEditMessage, onGenerate,
}: {
  step: SequenceStepPreview;
  preview: ReturnType<ReturnType<typeof useEnrollmentPreview>['getPreview']>;
  /** Lot 5d-1 : étape écrite, rendue avec les valeurs du serveur ; null pour une étape rédigée par l'IA. */
  written?: WrittenStepPreview | null;
  isEditing: boolean;
  index: number;
  candidateName?: string;
  creditsPerMessage: number;
  onToggleEdit: () => void;
  onRegenerate: () => void;
  /** `base` : texte et objet de départ de la première retouche d'une étape écrite (lot 5d-1). */
  onEditMessage: (field: 'subject' | 'message', value: string, base?: { subject: string; message: string }) => void;
  onGenerate: () => void;
}) {
  const fieldId = useId();
  const cost = step.useAiPersonalization ? creditsLabel(creditsPerMessage) : 'aucun crédit';
  const label = sequenceActionLabel(step.actionType);
  // Lot 5d-1 : étape écrite non retouchée, rendue avec les valeurs du serveur.
  // Retouchée, elle s'affiche comme toute retouche.
  const writtenShown = written && !preview?.isEdited ? written : null;
  const writtenReady = writtenShown?.status === 'ready' ? writtenShown : null;
  const message = writtenReady ? writtenReady.editableText : (preview?.message || '').replace(/<br\s*\/?>/gi, '\n');
  const subject = writtenReady ? writtenReady.editableSubject : preview?.subject || '';
  // Première retouche d'une étape écrite : elle part du texte ET de l'objet rendus.
  const editField = (field: 'subject' | 'message', value: string) => onEditMessage(
    field,
    value,
    writtenReady ? { subject: writtenReady.editableSubject, message: writtenReady.editableText } : undefined,
  );
  // Étape écrite retouchée : « Régénérer » rend le message de la séquence, sans rien générer.
  const isWrittenStep = written !== undefined && written !== null;
  // Un aperçu en échec reste modifiable et régénérable : le texte affiché
  // n'est pas celui qui partira tant qu'il n'est ni généré ni modifié.
  const hasContent = !!(preview?.isGenerated || preview?.isEdited || preview?.error);
  const generationFailed = !!preview?.error && !preview?.isGenerated;
  // Une étape écrite prête se modifie ; « Régénérer » ne sert qu'à une retouche ou à une étape IA.
  const showActions = hasContent || !!writtenReady;
  // Régénérer un message modifié à la main remplace la modification : confirmation.
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const handleRegenerateClick = () => {
    if (preview?.isEdited) setConfirmRegenerate(true);
    else onRegenerate();
  };

  return (
    <article aria-label={`Étape ${index + 1} : ${label}`} className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <StepNumber index={index} />
        <SequenceActionLabel type={step.actionType} className="text-sm font-medium text-foreground" />
        {step.useAiPersonalization && step.actionType !== 'smart_message' && (
          <Badge variant="muted" className="px-1.5 py-0 text-3xs">Personnalisé par l'IA</Badge>
        )}
        {preview?.isEdited && <Badge variant="outline" className="px-1.5 py-0 text-3xs">Modifié</Badge>}
        {showActions && !preview?.isGenerating && (
          <div className="ml-auto flex items-center gap-1">
            {/* En échec, « Réessayer » est dans l'avis ci-dessous. */}
            {hasContent && !generationFailed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={isWrittenStep ? 'Revenir au modèle' : `Régénérer ce message (${cost})`}
                    onClick={handleRegenerateClick}
                    className="text-muted-foreground max-md:h-11 max-md:w-11"
                  >
                    {isWrittenStep ? <Undo2 aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isWrittenStep ? 'Revenir au modèle' : `Régénérer ce message (${cost})`}</TooltipContent>
              </Tooltip>
            )}
            <Button
              variant="ghost"
              size="xs"
              aria-label={isEditing ? 'Voir le message' : 'Modifier le message'}
              onClick={onToggleEdit}
              className={cn('max-md:h-11', isEditing ? 'bg-accent text-foreground' : 'text-muted-foreground')}
            >
              <Pencil aria-hidden="true" />
              {isEditing ? 'Voir' : 'Modifier'}
            </Button>
          </div>
        )}
      </header>

      <div className="px-4 py-4">
        {preview?.isGenerating || writtenShown?.status === 'loading' ? (
          <div className="space-y-3" role="status">
            <span className="sr-only">{preview?.isGenerating ? "Génération de l'aperçu en cours" : "Préparation de l'aperçu en cours"}</span>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : writtenShown?.status === 'unavailable' ? (
          <div role="alert" className="flex flex-wrap items-start gap-2 rounded-lg border border-warning/25 bg-warning-muted px-3 py-2 text-xs text-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
            <p className="min-w-0 flex-1">{writtenShown.message}</p>
            {writtenShown.onRetry && (
              <Button variant="outline" size="xs" onClick={writtenShown.onRetry} className="max-md:h-11">
                <RefreshCw aria-hidden="true" />
                Réessayer
              </Button>
            )}
          </div>
        ) : writtenReady && !isEditing ? (
          <div className="space-y-4">
            {step.actionType === 'email' && (
              <div className="space-y-1.5">
                <p className="eyebrow">Objet</p>
                <p className="text-md font-semibold text-foreground">
                  {writtenReady.subject || <span className="font-normal text-muted-foreground">Sans objet</span>}
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              {step.actionType === 'email' && <p className="eyebrow">Message</p>}
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {shownText(step.actionType, writtenReady.text) || <span className="text-muted-foreground">Sans texte.</span>}
              </p>
            </div>
          </div>
        ) : hasContent || writtenReady ? (
          <div className="space-y-4">
            {preview?.error && (
              <div role="alert" className="flex flex-wrap items-start gap-2 rounded-lg border border-warning/25 bg-warning-muted px-3 py-2 text-xs text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                <p className="min-w-0 flex-1">{preview.error}</p>
                <Button variant="outline" size="xs" onClick={handleRegenerateClick} className="max-md:h-11">
                  <RefreshCw aria-hidden="true" />
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
                      value={subject}
                      onChange={e => editField('subject', e.target.value)}
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
                    onChange={e => editField('message', e.target.value)}
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
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {renderSendTimeVariables(shownText(step.actionType, (preview?.message || '').replace(/<br\s*\/?>/gi, '\n')))}
                  </p>
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
            {/* Lot 5d-1 : seule une étape rédigée par l'IA arrive ici, une étape écrite est rendue d'office. */}
            <Button variant="outline" size="sm" onClick={onGenerate} className="max-md:h-11">
              Générer l'aperçu de ce message
            </Button>
            {/* Coût annoncé seulement pour une étape personnalisée par l'IA. */}
            {step.useAiPersonalization && <p className="text-xs text-muted-foreground">{cost}</p>}
          </div>
        )}
      </div>

      <AlertDialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remplacer votre modification ?</AlertDialogTitle>
            <AlertDialogDescription>
              {isWrittenStep
                ? 'Votre modification sera remplacée par le message de la séquence, rendu pour ce candidat. Cette action est irréversible.'
                : 'Le message que vous avez modifié sera remplacé par une nouvelle version générée. Cette action est irréversible.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Garder ma version</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmRegenerate(false);
                onRegenerate();
              }}
            >
              {isWrittenStep ? 'Revenir au modèle' : 'Régénérer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

function SummaryMode({
  activeProfiles, steps, candidateAnalysis, estimatedCredits, hasAiSteps, hasMessageSteps, firstAction, onSwitchToPreview,
  firstMessage, firstMessageNavigation, aiMessages, aiMessagesNavigation, renderText,
}: {
  activeProfiles: LinkedInProfile[];
  steps: SequenceStepPreview[];
  candidateAnalysis: { total: number; withEmail: number; withoutEmail: number; withPhone: number; withoutPhone: number };
  estimatedCredits: number;
  hasAiSteps: boolean;
  hasMessageSteps: boolean;
  firstAction: string | null;
  onSwitchToPreview: () => void;
  /** Lot 5a : premier message d'un candidat inscrit, ‹ › pour passer aux suivants. */
  firstMessage: FirstMessagePreview | null;
  firstMessageNavigation: { index: number; total: number; onPrevious: () => void; onNext: () => void };
  /** Lot 5a-2 : messages rédigés par l'IA d'un candidat, ‹ › pour les relire un par un. */
  aiMessages: FirstMessagePreview | null;
  aiMessagesNavigation: { index: number; total: number; onPrevious: () => void; onNext: () => void };
  renderText: (text: string) => React.ReactNode;
}) {
  // Canaux fermés (D2) : leurs étapes sont sautées même avec une adresse ou
  // un numéro, donc aucun appel à l'enrichissement payant, un seul avis. Les
  // blocs d'enrichissement reviennent d'eux-mêmes à la réouverture du canal.
  const emailSteps = steps.filter(s => s.actionType === 'email' && !isClosedChannelStep(s.actionType));
  const whatsappSteps = steps.filter(s => s.actionType === 'whatsapp_message' && !isClosedChannelStep(s.actionType));
  const closedChannels = CLOSED_CHANNEL_ACTION_TYPES
    .filter(t => steps.some(s => s.actionType === t))
    .map(t => (t === 'email' ? 'e-mail' : 'WhatsApp'));
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

      {firstAction && (
        <p className="flex items-start gap-2 rounded-xl border border-border px-3 py-2.5 text-sm text-foreground">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{firstAction}</span>
        </p>
      )}

      {firstMessage && (
        <FirstMessagePreviewBlock
          preview={firstMessage}
          title="Aperçu du premier message"
          navigation={firstMessageNavigation}
          renderText={renderText}
        />
      )}

      {aiMessages && (
        <FirstMessagePreviewBlock
          preview={aiMessages}
          title="Messages rédigés par l'IA"
          navigation={aiMessagesNavigation}
          renderText={renderText}
        />
      )}

      {closedChannels.length > 0 && (
        <p role="note" className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning-muted px-3 py-2.5 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span>Les étapes {closedChannels.join(' et ')} ne partent pas encore : elles seront sautées.</span>
        </p>
      )}

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
      <ChannelIcon channel={channel} size="sm" decorative />
      <span className="flex-1 text-sm text-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{count}</span>
    </li>
  );
}

function EnrollmentResults({ results, firstAction, onClose }: { results: EnrollResults; firstAction: string | null; onClose: () => void }) {
  // Icône, couleur et titre selon le bilan : jamais de coche verte quand
  // personne n'a été inscrit, jamais de succès plein sur un échec partiel.
  const failed = results.errors.length;
  const attempted = results.success + failed;
  const outcome: 'success' | 'partial' | 'failure' | 'none' =
    results.success > 0 && failed === 0 ? 'success'
      : results.success > 0 ? 'partial'
      : failed > 0 ? 'failure'
      : 'none';
  const inscribed = plural(results.success, 'candidat inscrit', 'candidats inscrits');
  const title = outcome === 'success'
    ? inscribed
    : outcome === 'partial'
      ? `${inscribed} sur ${attempted}`
      : outcome === 'failure'
        ? 'Aucun candidat inscrit'
        : 'Aucune nouvelle inscription';

  return (
    <div className="w-full max-w-md space-y-5 text-center">
      <span
        className={cn(
          'mx-auto grid h-12 w-12 place-items-center rounded-full',
          outcome === 'success' ? 'bg-success-muted text-success'
            : outcome === 'partial' ? 'bg-warning-muted text-warning'
            : outcome === 'failure' ? 'bg-danger-muted text-danger'
            : 'bg-muted text-muted-foreground',
        )}
        aria-hidden="true"
      >
        {outcome === 'success'
          ? <CheckCircle2 className="h-6 w-6" />
          : outcome === 'partial'
            ? <AlertTriangle className="h-6 w-6" />
            : outcome === 'failure' ? <AlertCircle className="h-6 w-6" /> : <Info className="h-6 w-6" />}
      </span>
      <div className="space-y-1.5" role="status">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        {results.success > 0 && firstAction && (
          <p className="text-sm text-muted-foreground">{firstAction}</p>
        )}
      </div>
      {failed > 0 && (
        <div className="space-y-1.5 rounded-xl border border-danger/25 bg-danger-muted p-3 text-left">
          <p className="text-sm font-medium text-foreground">
            {plural(failed, 'inscription')} en échec
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
      {(results.skipped > 0 || results.alreadyPassed > 0 || results.samePerson.length > 0 || results.gdprErased.length > 0 || results.formerPassages > 0) && (
        <ul className="space-y-2 text-left text-sm">
          {results.skipped > 0 && (
            <li className="flex items-start gap-2 text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{alreadyInSequenceLabel(results.skipped)}</span>
            </li>
          )}
          {results.alreadyPassed > 0 && (
            <li className="flex items-start gap-2 text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{alreadyPassedLabel(results.alreadyPassed)}</span>
            </li>
          )}
          {results.samePerson.length > 0 && (
            <li className="flex items-start gap-2 text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block">{samePersonRefusedLabel(results.samePerson.length)}</span>
                <span className="block text-xs">{refusedCandidatesLabel(results.samePerson)}</span>
              </span>
            </li>
          )}
          {results.gdprErased.length > 0 && (
            <li className="flex items-start gap-2 text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block">{gdprErasedEnrollLabel(results.gdprErased.length)}</span>
                <span className="block text-xs text-foreground-secondary">{refusedCandidatesLabel(results.gdprErased)}</span>
              </span>
            </li>
          )}
          {results.formerPassages > 0 && (
            <li className="flex items-start gap-2 text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <span role="note">{formerPassageLabel(results.formerPassages)}</span>
            </li>
          )}
        </ul>
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

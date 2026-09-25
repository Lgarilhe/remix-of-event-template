import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
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
import { cn } from '@/lib/utils';
import {
  X, Check, CheckCircle, AlertTriangle, AlertCircle,
  Sparkles, RefreshCw, Pencil, Eye, Send, Users, Mail, MessageSquare,
  Loader2, ChevronLeft, ChevronRight, Search, Zap,
  Clock, GitBranch, ListChecks, CalendarClock,
} from 'lucide-react';
import { CandidateSidebarCard } from './enrollment-preview/CandidateSidebarCard';
import { SequenceTreeView } from './enrollment-preview/SequenceTreeView';
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
import { checkProfilesCompat, pickFirstStep } from '@/lib/sequenceCompatibility';
import { SendingAccountNotice } from './enrollment-preview/SendingAccountNotice';
import { useSendingAccount, type SendingAccountState } from './enrollment-preview/useSendingAccount';
import { enrollmentRowFields } from './enrollment-preview/enrollmentRowFields';
import {
  alreadyInSequenceLabel,
  alreadyPassedLabel,
  classifyExistingEnrollment,
  DUPLICATE_CHECK_FAILED_MESSAGE,
  enrollFailureMessage,
  firstActionSummary,
  markCandidatesMessaged,
  NO_LINKEDIN_ACCOUNT_DESCRIPTION,
  NO_LINKEDIN_ACCOUNT_TITLE,
  sequenceInactiveReason,
} from './enrollment-preview/enrollmentHelpers';
import { estimateActionCredits } from '@/lib/invokeWithCredits';

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
  email: 'E-mail',
  message: 'Message LinkedIn',
  smart_message: 'Message IA',
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
  email: { header: 'bg-emerald-500/15 text-foreground', border: 'border-border' },
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
    // Embranchements suivis par le moteur (vérification oui / non, chaînage) :
    // l'aperçu les signale et l'IA ne mélange pas les deux chemins.
    ifTrueGotoStep: s.if_true_goto_step || s.ifTrueGotoStep || null,
    ifFalseGotoStep: s.if_false_goto_step || s.ifFalseGotoStep || null,
    nextStepId: s.next_step_id || s.nextStepId || null,
  })).sort((a, b) => a.stepOrder - b.stepOrder);
}

const MESSAGE_ACTIONS = ['message', 'inmail', 'smart_message', 'email', 'connection_request', 'whatsapp_message'];

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
      className="inline-flex items-center gap-1 rounded-full border border-info/30 bg-info/10 px-1.5 py-px text-[11px] font-medium text-info align-baseline"
    >
      <CalendarClock className="w-3 h-3" aria-hidden="true" />
      Lien d'agenda, ajouté à l'envoi
    </span>,
    segment,
  ]));
}

/** « Inscription 12 sur 50… » pendant la boucle, « Inscription… » avant le premier candidat. */
function enrollProgressLabel(progress: { done: number; total: number } | null): string {
  return progress ? `Inscription ${progress.done} sur ${progress.total}…` : 'Inscription…';
}

/** Titre du bandeau de compatibilité (candidats exclus ou inclus quand même). */
function compatHeadline(blockers: { issue: string | null }[], included: boolean): string {
  const n = blockers.length;
  const plural = n > 1;
  const reason = blockers.every(r => r.issue === 'connection_already_connected')
    ? " : vous êtes déjà en relation, l'invitation échouera"
    : '';
  const outcome = included
    ? (plural ? 'Ils seront inscrits quand même.' : 'Il sera inscrit quand même.')
    : (plural ? "Ils sont exclus de l'inscription." : "Il est exclu de l'inscription.");
  return `${n} candidat${plural ? 's' : ''} ne ${plural ? 'peuvent' : 'peut'} pas suivre cette séquence${reason}. ${outcome}`;
}

interface EnrollResults {
  success: number;
  /** Déjà dans la séquence (en cours ou en pause). */
  skipped: number;
  /** Déjà passés par la séquence (terminée, réponse, arrêtée) : à reprendre depuis le suivi. */
  alreadyPassed: number;
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
  const steps = useMemo(() => mapSteps(sequence.steps), [sequence.steps]);
  const isSingle = profiles.length === 1;
  const isBulk = profiles.length > 10;
  const candidateIds = useMemo(() => profiles.map(profile => profile.id), [profiles]);
  const firstProfileId = candidateIds[0] ?? '';
  const hasSendableMessage = useMemo(
    () => steps.some(s => MESSAGE_ACTIONS.includes(s.actionType) && !!s.messageTemplate?.trim()),
    [steps],
  );
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
  // Même contrôle que l'inscription simple : un candidat déjà en relation ne
  // peut pas recevoir l'invitation de la séquence, un candidat hors réseau ne
  // peut être joint que par InMail. Exclus par défaut, « Inclure quand même ».
  const compat = useMemo(() => checkProfilesCompat(profiles, sequence.steps), [profiles, sequence.steps]);
  const incompatibleIds = useMemo(() => new Set(compat.blockers.map(r => r.profile.id)), [compat.blockers]);
  const [includeIncompatible, setIncludeIncompatible] = useState(false);

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

  // La génération groupée, son compteur et l'estimation de crédits ne visent
  // que les candidats qui seront inscrits (activeProfiles).
  const {
    previews, messageSteps, hasMessageSteps, hasAiSteps,
    generatedCount, totalToGenerate, isBulkGenerating,
    estimatedCredits, candidateAnalysis,
    getPreview, generateForCandidateById, regenerateStep,
    editMessage, generateAll, cancelBulkGeneration, getMessageOverrides,
    getStepConfig, setStepConfig, getStepConfigOverrides,
  } = useEnrollmentPreview({ steps, profiles, targetProfiles: activeProfiles, job, accountId });

  // « Première action : …, dès maintenant / dans 2 jours, pendant vos heures
  // d'envoi » : première étape planifiée et son délai effectif (délai modifié
  // pour cette inscription compris), repris dans le toast de fin.
  const firstAction = useMemo(
    () => firstActionSummary(sequence.steps, getStepConfigOverrides()),
    [sequence.steps, getStepConfigOverrides],
  );

  // Des messages ont été générés ou modifiés : Échap ne ferme pas la fenêtre
  // (le travail et les crédits dépensés seraient perdus sans prévenir).
  const hasPreparedWork = useMemo(
    () => Array.from(previews.values()).some(m => Array.from(m.values()).some(x => x.isGenerated || x.isEdited)),
    [previews],
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

  // ── Raccourcis clavier ──
  // Posés sur la liste des candidats, pas sur toute la fenêtre : Entrée et
  // Espace gardent leur rôle natif sur les boutons, liens, menus et champs du
  // reste de la préparation. Aucune touche seule ne lance de génération payante
  // (Ctrl+Entrée, voir handleGenerateShortcut). Relus à chaque rendu : pas de
  // closure figée sur d'anciens aperçus.
  const candidateListRef = useRef<HTMLDivElement>(null);
  const focusCandidateCard = (id: string) => {
    requestAnimationFrame(() => {
      const cards = candidateListRef.current?.querySelectorAll<HTMLElement>('[data-candidate-id]');
      cards?.forEach(card => { if (card.dataset.candidateId === id) card.focus(); });
    });
  };
  const moveSelection = (index: number) => {
    const next = filteredProfiles[index];
    if (!next) return;
    handleSelectCandidate(next.id);
    setPage(Math.floor(index / pageSize));
    focusCandidateCard(next.id);
  };
  /** Cible hors raccourcis : champ, élément éditable, menu, popover ou fenêtre ouverts dessus. */
  const isOutsideShortcutScope = (e: React.KeyboardEvent<HTMLElement>): boolean => {
    // Les couches ouvertes depuis la liste (menus, popovers, confirmations)
    // sont dans des portails : leurs touches remontent l'arbre React jusqu'ici
    // mais ne sont pas des raccourcis de la préparation.
    if (!e.currentTarget.contains(e.target as Node)) return true;
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
    if (target.isContentEditable) return true;
    return !!target.closest('[role="menu"], [role="menuitem"], [role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper]');
  };
  const handleShortcutKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (mode !== 'preview' || enrollResults || isBusy || e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isOutsideShortcutScope(e)) return;
    const target = e.target as HTMLElement;
    // Bouton natif (menu d'actions d'une carte), lien, case à cocher : Entrée
    // et Espace leur appartiennent. La carte elle-même (role="button") gère
    // Entrée (sélection) et laisse remonter Espace quand elle est sélectionnée.
    const onNativeControl = !!target.closest('button, a, [role="checkbox"], [role="switch"]');

    const currentIdx = filteredProfiles.findIndex(p => p.id === selectedCandidateId);

    if (e.key === 'ArrowDown' && currentIdx < filteredProfiles.length - 1) {
      e.preventDefault();
      moveSelection(currentIdx + 1);
    } else if (e.key === 'ArrowUp' && currentIdx > 0) {
      e.preventDefault();
      moveSelection(currentIdx - 1);
    } else if ((e.key === 'Delete' || e.key === 'x' || e.key === 'X') && selectedCandidateId && !onNativeControl) {
      e.preventDefault();
      handleRemoveCandidate(selectedCandidateId);
    } else if (e.key === ' ' && selectedCandidateId && !onNativeControl) {
      e.preventDefault();
      handleSkipCandidate(selectedCandidateId);
    }
  };
  // Ctrl+Entrée (Cmd+Entrée sur Mac) : génère les aperçus encore vides du
  // candidat affiché. Jamais Entrée seule (elle active le bouton ciblé), jamais
  // depuis un champ de saisie ou une couche ouverte par-dessus.
  const handleGenerateShortcut = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    if (mode !== 'preview' || enrollResults || isBusy || e.defaultPrevented || !selectedCandidateId) return;
    if (isOutsideShortcutScope(e)) return;
    e.preventDefault();
    // Ne génère que les messages encore vides : un message déjà généré ou
    // modifié n'est jamais remplacé (useEnrollmentPreview.generateForCandidate).
    void generateForCandidateById(selectedCandidateId);
  };

  // ── Enrollment Logic ──

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const handleEnroll = async () => {
    // Sans org résolue, les inserts partiraient avec organization_id null →
    // refusés par RLS ou invisibles pour l'org (même garde que
    // SequenceEnrollModal). On refuse plutôt que d'enrôler dans le vide.
    if (!organizationId) {
      toast.error("Organisation non résolue : rechargez la page, puis réessayez.");
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

    setIsEnrolling(true);
    setEnrollResults(null);
    setEnrollProgress(null);
    const results: EnrollResults = { success: 0, skipped: 0, alreadyPassed: 0, errors: [] };
    // Candidats réellement inscrits : leur statut pipeline passe à « contacté ».
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
      const enrollSet = allowDuplicates
        ? activeProfiles
        : activeProfiles.filter(p => !recent.has(p.id));
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
          // est inconditionnelle, toute ligne existante empêche l'inscription.
          // On distingue « déjà dans la séquence » (en cours, en pause) de
          // « déjà passé par la séquence » (terminée, réponse, arrêtée), à
          // reprendre depuis le suivi. La race fenêtre entre SELECT et INSERT
          // est gérée plus bas via UPSERT + ignoreDuplicates.
          const { data: existing, error: existingError } = await supabase
            .from('sequence_enrollments')
            .select('id, status')
            .eq('sequence_id', sequence.id)
            .eq('profile_id', profile.id)
            .maybeSingle();
          if (existingError) throw existingError;

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
          enrolledProfiles.push(profile);
        } catch (err) {
          // Détail technique en console seulement : jamais le message brut de
          // la base (« new row violates row-level security policy… »).
          console.error('[EnrollmentPreviewModal] enrollment failed for', profile.id, err);
          results.errors.push(enrollFailureMessage(profile.name));
        }
      }

      // Statut pipeline « contacté », sans rétrograder un candidat déjà
      // contacté, shortlisté ou qui a répondu (non bloquant).
      if (job?.id && enrolledProfiles.length > 0) {
        await markCandidatesMessaged(supabase, {
          rawJobId: job.id,
          userId,
          organizationId,
          profiles: enrolledProfiles,
        });
      }

      setEnrollResults(results);
      if (results.success > 0) {
        const n = results.success;
        toast.success(`${n} candidat${n > 1 ? 's' : ''} inscrit${n > 1 ? 's' : ''} dans la séquence`, {
          description: firstAction ?? undefined,
        });
      }
      if (results.errors.length > 0) {
        const e = results.errors.length;
        toast.error(`${e} inscription${e > 1 ? 's' : ''} en échec`, {
          description: 'Le détail est affiché dans la fenêtre.',
        });
      }
      if (results.alreadyPassed > 0) toast.info(alreadyPassedLabel(results.alreadyPassed));
      if (results.skipped > 0) toast.info(alreadyInSequenceLabel(results.skipped));
    } catch (err) {
      console.error('[EnrollmentPreviewModal] Bulk enrollment failed:', err);
      toast.error('Inscription impossible', { description: 'Réessayez ou contactez le support.' });
    } finally {
      setIsEnrolling(false);
      setEnrollProgress(null);
    }
  };

  // ── Shortlist without message ──
  // Une seule écriture groupée, relue (.select) : le nombre annoncé est celui
  // des lignes réellement enregistrées. Un candidat déjà contacté ou qui a
  // répondu garde son statut (jamais rétrogradé en « shortlisté »).
  const handleShortlist = async () => {
    if (!job?.id) {
      toast.error("Aucun poste associé pour la shortlist");
      return;
    }
    if (!organizationId) {
      toast.error("Organisation non résolue : rechargez la page, puis réessayez.");
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

      // Idem normalisation : "project:{uuid}" → uuid
      const normalizedJobId = job.id.startsWith('project:')
        ? job.id.slice('project:'.length)
        : job.id;

      const { data: existingRows, error: readError } = await supabase
        .from('job_candidate_status')
        .select('candidate_id, status')
        .eq('job_id', normalizedJobId)
        .eq('created_by', userId)
        .in('candidate_id', activeProfiles.map(p => p.id));
      if (readError) throw readError;
      const alreadyContacted = new Set(
        (existingRows ?? [])
          .filter(r => r.status === 'messaged' || r.status === 'replied')
          .map(r => r.candidate_id),
      );

      const rows = activeProfiles
        .filter(profile => !alreadyContacted.has(profile.id))
        .map(profile => ({
          job_id: normalizedJobId,
          candidate_id: profile.id,
          candidate_name: profile.name || null,
          candidate_headline: profile.headline || null,
          linkedin_profile_url: profile.profile_url || profile.public_profile_url || null,
          status: 'shortlisted',
          created_by: userId,
          organization_id: organizationId, // requis par RLS org_members_all
        }));

      let saved = 0;
      if (rows.length > 0) {
        const { data: written, error: writeError } = await supabase
          .from('job_candidate_status')
          .upsert(rows, { onConflict: 'job_id,candidate_id,created_by' })
          .select('candidate_id');
        if (writeError) throw writeError;
        saved = written?.length ?? 0;
      }

      if (rows.length > 0 && saved === 0) {
        // Rien d'enregistré (refus silencieux) : la fenêtre reste ouverte.
        toast.error("Ajout impossible : aucun candidat n'a été enregistré.");
        return;
      }
      const failed = rows.length - saved;
      if (saved > 0) {
        const added = `${saved} candidat${saved > 1 ? 's' : ''} ajouté${saved > 1 ? 's' : ''} à la shortlist`;
        if (failed > 0) {
          toast.warning(added, {
            description: `${failed} candidat${failed > 1 ? 's' : ''} n'${failed > 1 ? 'ont' : 'a'} pas pu être enregistré${failed > 1 ? 's' : ''}.`,
          });
        } else {
          toast.success(added);
        }
      }
      if (alreadyContacted.size > 0) {
        const n = alreadyContacted.size;
        toast.info(`${n} candidat${n > 1 ? 's' : ''} déjà contacté${n > 1 ? 's' : ''} : statut conservé`);
      }
      onSuccess();
    } catch (err) {
      console.error('[EnrollmentPreviewModal] Shortlist failed:', err);
      toast.error("Ajout impossible : aucun candidat n'a été enregistré.");
    } finally {
      setIsShortlisting(false);
    }
  };

  const contentRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    if (isBusy) return;
    if (enrollResults?.success) onSuccess();
    else onClose();
  };

  if (!isOpen) return null;

  // ── Render ──
  // Dialog Radix plein écran : la préparation rejoint la pile de couches (au-
  // dessus de la fiche profil ouverte en panneau, Échap et clics gérés par la
  // couche du dessus). Non modal pour que les notifications (« Annuler » d'un
  // retrait) restent cliquables ; pointer-events-auto la garde utilisable quand
  // un panneau modal est ouvert dessous.
  return (
    <DialogPrimitive.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={contentRef}
          aria-describedby={undefined}
          className="fixed inset-0 z-[9999] bg-background flex flex-col pointer-events-auto outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0"
          onOpenAutoFocus={(e) => {
            // Focus sur la liste des candidats (flèches actives) ou, sans liste,
            // sur la fenêtre elle-même ; jamais sur la croix : Entrée ne doit
            // pas fermer la préparation.
            e.preventDefault();
            (candidateListRef.current ?? contentRef.current)?.focus();
          }}
          onEscapeKeyDown={(e) => {
            if (isBusy || hasPreparedWork) e.preventDefault();
          }}
          onInteractOutside={(e) => e.preventDefault()}
          onKeyDown={handleGenerateShortcut}
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
              disabled={isBusy}
              className="h-9 w-9 grid place-items-center rounded-full border border-border bg-background hover:bg-accent transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Fermer"
              title={isBusy ? 'Inscription en cours, ne fermez pas cette fenêtre' : undefined}
            >
              <X className="w-4 h-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5 hidden sm:block">
                Inscription en séquence
              </p>
              <DialogPrimitive.Title asChild>
                <h2 className="font-display text-[15px] sm:text-base font-semibold truncate leading-tight">
                  {sequence.name}
                </h2>
              </DialogPrimitive.Title>
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
                  Aperçus
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
          activeProfiles={activeProfiles}
          duplicateExcludedCount={excludedCounts.duplicates}
          incompatibleExcludedCount={excludedCounts.incompatible}
          generatedCount={generatedCount}
          totalToGenerate={totalToGenerate}
          estimatedCredits={estimatedCredits}
          hasAiSteps={hasAiSteps}
        />
      )}

      {/* Anti-doublon organisation : contactés dans les 90 derniers jours par
          un membre, toute séquence et tout compte. Exclus par défaut ;
          dérogation réservée aux propriétaires et administrateurs. */}
      {!enrollResults && isCheckingDuplicates && (
        <div className="px-4 sm:px-6 py-1.5 border-b border-border bg-muted/10 flex items-center gap-2 text-[11px] text-muted-foreground" role="status">
          <Loader2 className="w-3 h-3 animate-spin" />
          Vérification des contacts récents de l'organisation
        </div>
      )}
      {!enrollResults && duplicateCheckFailed && !isCheckingDuplicates && (
        <div className="px-4 sm:px-6 py-2 border-b border-destructive/40 bg-destructive/5 flex items-center gap-2 shrink-0" role="alert">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0" aria-hidden="true" />
          <p className="flex-1 text-[12px] text-destructive">{DUPLICATE_CHECK_FAILED_MESSAGE}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs shrink-0"
            onClick={() => setDuplicateCheckAttempt(a => a + 1)}
          >
            Réessayer
          </Button>
        </div>
      )}
      {!enrollResults && recentEnrollments && duplicateProfiles.length > 0 && (
        <div className="px-4 sm:px-6 py-2.5 border-b border-warning/40 bg-warning/5 shrink-0">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-[12px] font-semibold text-warning">
                {duplicateProfiles.length} candidat{duplicateProfiles.length > 1 ? 's' : ''} déjà contacté{duplicateProfiles.length > 1 ? 's' : ''} par votre organisation (séquence en cours, ou contact ces {RECENT_CONTACT_WINDOW_DAYS} derniers jours)
              </p>
              <ul className="text-[11px] text-muted-foreground space-y-0.5 max-h-20 overflow-y-auto">
                {duplicateProfiles.slice(0, 5).map(p => {
                  const entry = recentEnrollments.get(p.id);
                  return (
                    <li key={p.id} className="truncate">
                      <span className="font-medium text-foreground">{p.name}</span>
                      {' : '}{entry ? formatRecentContactLabel(entry) : 'Déjà contacté'}
                    </li>
                  );
                })}
                {duplicateProfiles.length > 5 && (
                  <li className="italic">et {duplicateProfiles.length - 5} autre{duplicateProfiles.length - 5 > 1 ? 's' : ''}</li>
                )}
              </ul>
              {isAdmin ? (
                <label className="flex items-center gap-2 text-[11px] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={enrollDuplicatesAnyway}
                    onChange={(e) => setEnrollDuplicatesAnyway(e.target.checked)}
                    className="h-3 w-3 rounded border-border"
                  />
                  <span className="text-foreground">Inscrire quand même ({duplicateProfiles.length})</span>
                </label>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Exclus de l'inscription. Seuls les propriétaires et administrateurs peuvent les inscrire quand même.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {!enrollResults && notice && (
        <div className="px-4 sm:px-6 py-2 border-b border-warning/40 bg-warning/5 flex items-start gap-2 shrink-0" role="note">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-[12px] text-foreground">{notice}</p>
        </div>
      )}

      {/* Compatibilité : candidats qui ne peuvent pas suivre cette séquence
          (déjà en relation avec une invitation prévue, hors réseau sans
          InMail). Exclus par défaut, « Inclure quand même » pour les garder. */}
      {!enrollResults && (compat.blockers.length > 0 || compat.warnings.length > 0) && (
        <div className="px-4 sm:px-6 py-2.5 border-b border-warning/40 bg-warning/5 shrink-0">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0 space-y-1.5">
              {compat.blockers.length > 0 ? (
                <p className="text-[12px] font-semibold text-warning">
                  {compatHeadline(compat.blockers, includeIncompatible)}
                </p>
              ) : (
                <p className="text-[12px] font-semibold text-warning">
                  {compat.warnings.length} candidat{compat.warnings.length > 1 ? 's' : ''} avec un avertissement
                </p>
              )}
              <ul className="text-[11px] text-muted-foreground space-y-0.5 max-h-20 overflow-y-auto">
                {[...compat.blockers, ...compat.warnings].slice(0, 5).map(r => (
                  <li key={r.profile.id} className="truncate">
                    <span className="font-medium text-foreground">{r.profile.name}</span>
                    {' : '}{r.message}
                  </li>
                ))}
                {compat.blockers.length + compat.warnings.length > 5 && (
                  <li className="italic">
                    et {compat.blockers.length + compat.warnings.length - 5} autre{compat.blockers.length + compat.warnings.length - 5 > 1 ? 's' : ''}
                  </li>
                )}
              </ul>
              {compat.blockers.length > 0 && (
                <label className="flex items-center gap-2 text-[11px] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeIncompatible}
                    onChange={(e) => setIncludeIncompatible(e.target.checked)}
                    className="h-3 w-3 rounded border-border"
                  />
                  <span className="text-foreground">Inclure quand même ({compat.blockers.length})</span>
                </label>
              )}
            </div>
          </div>
        </div>
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
              <EnrollmentResults results={enrollResults} firstAction={firstAction} onClose={handleClose} />
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
                isBusy={isBusy}
                enrollProgress={enrollProgress}
                sendingAccount={sendingAccount}
                duplicatesUnchecked={duplicatesUnchecked}
                firstAction={firstAction}
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
                        aria-label="Rechercher un candidat"
                        className="w-full h-8 pl-8 pr-3 text-[12px] bg-background border border-border rounded-full focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/30 transition-all"
                      />
                    </div>
                    <p className="hidden sm:block text-[10px] text-muted-foreground leading-snug">
                      ↑ ↓ changer de candidat · Espace passer · X retirer · Ctrl+Entrée générer l'aperçu
                    </p>
                  </div>
                  <ScrollArea className="flex-1">
                    <div
                      ref={candidateListRef}
                      tabIndex={-1}
                      role="group"
                      aria-label="Candidats à inscrire"
                      onKeyDown={handleShortcutKeyDown}
                      className="p-1 space-y-0.5 outline-none"
                    >
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
                                    exclusion={exclusionByCandidate.get(p.id) ?? null}
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
                          Générer tous les aperçus
                        </motion.button>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
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
                              // ce step. Sinon "Générer tous les aperçus" (bulk) reste
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

                {/* Bottom bar — compte d'envoi, puis 3 boutons : primaire
                    (Inscrire), secondaire (Shortlist), tertiaire (Annuler). */}
                <div className="px-4 sm:px-6 py-3 border-t border-border bg-background space-y-2">
                  <SendingAccountNotice state={sendingAccount} />
                  {isEnrolling && (
                    <p className="text-[11px] text-muted-foreground" role="status">
                      Inscription en cours, ne fermez pas cette fenêtre.
                    </p>
                  )}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:justify-between">
                    <button
                      type="button"
                      onClick={handleClose}
                      disabled={isBusy}
                      className="h-9 px-3 text-[12px] text-muted-foreground hover:text-foreground transition-colors rounded-full disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Annuler
                    </button>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      {job?.id && (
                        <button
                          type="button"
                          onClick={handleShortlist}
                          disabled={isBusy || activeProfiles.length === 0}
                          className="h-9 px-4 inline-flex items-center justify-center gap-1.5 text-[12px] font-medium rounded-full border border-border bg-background hover:bg-accent disabled:opacity-50 transition-colors"
                        >
                          {isShortlisting
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <ListChecks className="w-3.5 h-3.5" />}
                          Ajouter à la shortlist sans message
                        </button>
                      )}
                      <motion.button
                        type="button"
                        onClick={handleEnroll}
                        disabled={isBusy || activeProfiles.length === 0 || duplicatesUnchecked || !!sendingAccount.blockReason}
                        whileHover={{ scale: isBusy ? 1 : 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="h-9 px-5 inline-flex items-center justify-center gap-1.5 text-[12px] font-bold rounded-full text-white konekt-skalr-bg konekt-shine konekt-glow disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-shadow"
                      >
                        {isEnrolling ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            {enrollProgressLabel(enrollProgress)}
                          </>
                        ) : (
                          <>
                            <Send className="w-3.5 h-3.5" strokeWidth={2.5} />
                            Inscrire {activeProfiles.length} candidat{activeProfiles.length > 1 ? 's' : ''}
                          </>
                        )}
                      </motion.button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
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
  // Un aperçu en échec reste modifiable et régénérable : le texte affiché
  // n'est pas celui qui partira tant qu'il n'est ni généré ni modifié.
  const hasContent = !!(preview?.isGenerated || preview?.isEdited || preview?.error);
  const generationFailed = !!preview?.error && !preview?.isGenerated;
  // Régénérer un message modifié à la main remplace la modification : confirmation.
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const handleRegenerateClick = () => {
    if (preview?.isEdited) setConfirmRegenerate(true);
    else onRegenerate();
  };

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
          {hasContent && !preview?.isGenerating && (
            <>
              {generationFailed ? (
                <button
                  type="button"
                  onClick={handleRegenerateClick}
                  className="h-7 px-2 inline-flex items-center gap-1 rounded-md text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  Réessayer
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRegenerateClick}
                  className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Régénérer ce message"
                  aria-label="Régénérer ce message"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={onToggleEdit}
                className={cn(
                  "h-7 w-7 grid place-items-center rounded-md transition-colors",
                  isEditing
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                title={isEditing ? "Voir" : "Modifier"}
                aria-label={isEditing ? 'Voir le message' : 'Modifier le message'}
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
        ) : hasContent ? (
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
                  placeholder="Tapez /ai pour générer ou améliorer le message"
                />
              ) : (
                <div className="text-[13.5px] leading-relaxed text-foreground/90 whitespace-pre-wrap font-sans">
                  {renderSendTimeVariables((preview?.message || '').replace(/<br\s*\/?>/gi, '\n'))}
                </div>
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
            type="button"
            onClick={onGenerate}
            className="w-full py-5 px-4 flex flex-col items-center gap-2 rounded-md text-muted-foreground hover:text-foreground border-2 border-dashed border-border hover:border-brand-purple/40 hover:bg-brand-purple/5 transition-all group"
          >
            {step.useAiPersonalization ? (
              <>
                <Sparkles className="w-5 h-5 group-hover:text-brand-purple transition-colors" />
                <span className="text-[12px] font-medium">Générer l'aperçu de ce message</span>
                <span className="text-[10px] text-muted-foreground/70">~{estimateActionCredits('outreach_message')} crédits</span>
              </>
            ) : (
              <>
                <Eye className="w-5 h-5" />
                <span className="text-[12px] font-medium">Voir l'aperçu (gratuit)</span>
              </>
            )}
          </button>
        )}
      </div>
      </motion.div>
      <AlertDialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remplacer votre modification ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le message que vous avez modifié sera remplacé par une nouvelle version générée. Cette action est irréversible.
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
              Régénérer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryMode({
  profiles, activeProfiles, steps, candidateAnalysis, estimatedCredits, hasAiSteps, hasMessageSteps, isBulk,
  onSwitchToPreview, isEnrolling, isBusy, enrollProgress, sendingAccount, duplicatesUnchecked, firstAction,
  onEnroll, onShortlist, onClose, jobId,
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
  isBusy: boolean;
  enrollProgress: { done: number; total: number } | null;
  sendingAccount: SendingAccountState;
  duplicatesUnchecked: boolean;
  firstAction: string | null;
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
          <h3 className="font-display text-xl font-bold">Avant l'inscription</h3>
          <p className="text-[13px] text-muted-foreground mt-1">
            <strong className="text-foreground">{activeProfiles.length}</strong> candidat{activeProfiles.length > 1 ? 's' : ''} sélectionné{activeProfiles.length > 1 ? 's' : ''} pour <strong className="text-foreground">{steps.length} étape{steps.length > 1 ? 's' : ''}</strong> de séquence
          </p>
        </div>
      </motion.div>

      {firstAction && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-border bg-muted/20 text-[12.5px] text-foreground">
          <CalendarClock className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden="true" />
          <span>{firstAction}</span>
        </div>
      )}

      <div className="space-y-2">
        <SummaryRow icon={CheckCircle} color="text-success-foreground" label="Candidats avec LinkedIn" count={activeProfiles.length} />
        {candidateAnalysis.withEmail > 0 && (
          <SummaryRow icon={Mail} color="text-info-foreground" label="Avec e-mail" count={candidateAnalysis.withEmail} />
        )}
        {candidateAnalysis.withoutEmail > 0 && emailSteps.length > 0 && (
          <div className="bg-warning/5 border border-warning/30 rounded-lg p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <SummaryRow icon={AlertTriangle} color="text-warning-foreground" label="Sans e-mail (étapes e-mail sautées)" count={candidateAnalysis.withoutEmail} />
              <BulkEnrichButton
                profiles={activeProfiles.filter(p => !(p.contact_info?.emails?.[0]))}
              />
            </div>
            <p className="text-[11px] text-muted-foreground pl-1">
              Enrichissez maintenant pour que ces candidats reçoivent les e-mails de la séquence.
              Sans adresse, leurs étapes e-mail seront sautées.
            </p>
          </div>
        )}
        {candidateAnalysis.withoutPhone > 0 && whatsappSteps.length > 0 && (
          <div className="bg-warning/5 border border-warning/30 rounded-lg p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <SummaryRow icon={AlertTriangle} color="text-warning-foreground" label="Sans téléphone (étapes WhatsApp sautées)" count={candidateAnalysis.withoutPhone} />
              <BulkEnrichButton
                profiles={activeProfiles.filter(p => !(p.contact_info?.phones?.[0]))}
              />
            </div>
            <p className="text-[11px] text-muted-foreground pl-1">
              Enrichissez avec le téléphone (10 crédits par candidat) pour que les étapes WhatsApp partent.
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
            Ouvrir les aperçus des messages
          </button>
        )}
        <SendingAccountNotice state={sendingAccount} />
        {isEnrolling && (
          <p className="text-[11px] text-muted-foreground text-center" role="status">
            Inscription en cours, ne fermez pas cette fenêtre.
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="sm:flex-1 h-9 text-[12px] text-muted-foreground hover:text-foreground transition-colors rounded-full disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Annuler
          </button>
          {jobId && (
            <button
              type="button"
              onClick={onShortlist}
              disabled={isBusy || activeProfiles.length === 0}
              className="sm:flex-1 h-9 inline-flex items-center justify-center gap-1.5 text-[12px] font-medium rounded-full border border-border bg-background hover:bg-accent disabled:opacity-50 transition-colors"
            >
              <ListChecks className="w-3.5 h-3.5" />
              Ajouter à la shortlist sans message
            </button>
          )}
          <motion.button
            type="button"
            onClick={onEnroll}
            disabled={isBusy || activeProfiles.length === 0 || duplicatesUnchecked || !!sendingAccount.blockReason}
            whileHover={{ scale: isBusy ? 1 : 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="sm:flex-1 h-10 inline-flex items-center justify-center gap-2 text-[12px] font-bold rounded-full text-white konekt-skalr-bg konekt-shine konekt-glow disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
          >
            {isEnrolling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {enrollProgressLabel(enrollProgress)}
              </>
            ) : (
              <>
                <Send className="w-4 h-4" strokeWidth={2.5} />
                Inscrire {activeProfiles.length} candidat{activeProfiles.length > 1 ? 's' : ''}
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

function EnrollmentResults({ results, firstAction, onClose }: { results: EnrollResults; firstAction: string | null; onClose: () => void }) {
  // Icône, couleur et titre selon le bilan : jamais de coche verte quand
  // personne n'a été inscrit, jamais de succès plein sur un échec partiel.
  const attempted = results.success + results.errors.length;
  const outcome: 'success' | 'partial' | 'failure' | 'none' =
    results.success > 0 && results.errors.length === 0 ? 'success'
      : results.success > 0 ? 'partial'
      : results.errors.length > 0 ? 'failure'
      : 'none';
  const plural = (n: number) => (n > 1 ? 's' : '');
  const title = outcome === 'success'
    ? `${results.success} candidat${plural(results.success)} inscrit${plural(results.success)}`
    : outcome === 'partial'
      ? `${results.success} candidat${plural(results.success)} inscrit${plural(results.success)} sur ${attempted}`
      : outcome === 'failure'
        ? 'Aucun candidat inscrit'
        : 'Aucune nouvelle inscription';
  return (
    <div className="max-w-md w-full text-center space-y-6">
      <motion.div
        className={cn(
          "w-20 h-20 mx-auto rounded-full border-2 flex items-center justify-center shadow-lg",
          outcome === 'success' ? "bg-success/10 border-success/30"
            : outcome === 'partial' ? "bg-warning/10 border-warning/30"
            : outcome === 'failure' ? "bg-destructive/10 border-destructive/30"
            : "bg-muted border-border",
        )}
        initial={{ scale: 0, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 220, damping: 16 }}
        >
          {outcome === 'success'
            ? <CheckCircle className="w-10 h-10 text-success" strokeWidth={2.5} />
            : outcome === 'partial'
              ? <AlertTriangle className="w-10 h-10 text-warning" strokeWidth={2.5} />
              : <AlertCircle className={cn("w-10 h-10", outcome === 'failure' ? "text-destructive" : "text-muted-foreground")} strokeWidth={2.5} />}
        </motion.div>
      </motion.div>
      <motion.div
        className="space-y-2"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.3 }}
      >
        <h3 className="font-display text-xl font-bold">{title}</h3>
        {results.success > 0 && firstAction && (
          <p className="text-sm text-muted-foreground">{firstAction}</p>
        )}
        {results.errors.length > 0 && (
          <div className="text-sm text-destructive text-left bg-destructive/5 rounded-xl border border-destructive/30 p-3 mt-3 space-y-1">
            <p className="text-xs font-semibold">
              {results.errors.length} inscription{plural(results.errors.length)} en échec
            </p>
            {results.errors.map((err, i) => (
              <p key={i} className="text-xs">{err}</p>
            ))}
          </div>
        )}
        {results.skipped > 0 && (
          <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {alreadyInSequenceLabel(results.skipped)}
          </p>
        )}
        {results.alreadyPassed > 0 && (
          <p className="text-sm text-muted-foreground flex items-start justify-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {alreadyPassedLabel(results.alreadyPassed)}
          </p>
        )}
      </motion.div>
      <motion.button
        type="button"
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

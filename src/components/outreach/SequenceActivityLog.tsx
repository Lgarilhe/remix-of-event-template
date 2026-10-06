import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import {
  executionDoneVerb,
  executionStatusLabel,
  formatSequenceError,
  formatSkipReason,
  heldExecutionNotice,
  HIDDEN_ACTION_TYPES,
  isAiReviewPending,
  isSentExecutionStatus,
  missionEnrollmentJobIds,
  shouldShowExecutionError,
  scheduledExecutionError,
  skipConflictMessage,
  type HeldExecutionNotice,
} from '@/lib/sequenceErrorMessages';
import { stepTypeLabel } from '@/components/outreach/sequence/sequenceGraph';
import { executionStatusMeta } from '@/lib/sequenceCatalog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState, ErrorState, StatGrid, StatTile } from '@/components/layout';
import { SequenceActionIcon } from './SequenceBadges';
import {
  Activity,
  Search,
  ExternalLink,
  ChevronRight,
  RefreshCw,
  Pencil,
  Ban,
  Pause,
  Sparkles,
} from 'lucide-react';
import { format, isAfter, isBefore, startOfDay, endOfDay, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { EditScheduledMessageModal } from './activity-log/EditScheduledMessageModal';
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
import { plural } from '@/lib/plural';
import { isManualStopTrace } from '@/lib/sequenceLabels';
import { JOURNAL_PAGE_SIZE, journalCursorFilter, nextJournalCursor, type JournalCursor } from '@/lib/journalCursor';
import { clockTime, dayMonth, quotaBlockedLabel } from '@/lib/enrollmentStatusLine';

/** Nombre de lignes lues : au-delà, les compteurs portent sur les plus récentes. */
const JOURNAL_LIMIT = 500;

/** Provenance du texte affiché pour une étape. */
type PreviewSource = 'final' | 'edited' | 'override' | 'template' | 'ai' | 'template_unverified';

interface MessagePreview {
  message: string | null;
  subject: string | null;
  source: PreviewSource;
}

interface StepExecution {
  id: string;
  enrollment_id: string;
  step_id: string;
  step_order: number;
  status: string;
  scheduled_at: string;
  executed_at: string | null;
  final_subject: string | null;
  final_message: string | null;
  error_message: string | null;
  skip_reason: string | null;
  enrollment?: {
    status: string | null;
    /** Membre qui a inscrit le candidat (D3 : un collaborateur n'agit que sur les siens). */
    created_by: string | null;
    profile_name: string | null;
    profile_headline: string | null;
    profile_url: string | null;
    /** Lot 5b : trace d'un arrêt manuel (motif « Arrêt manuel » lu comme un arrêt). */
    stoppedManually: boolean;
    sequence?: {
      name: string;
      is_active: boolean | null;
    };
  };
  step?: {
    action_type: string;
    message_template: string | null;
    subject_template: string | null;
  };
  preview: MessagePreview;
  /** Étape en attente qui ne partira pas (candidat en pause ou sorti, séquence désactivée). */
  held: HeldExecutionNotice | null;
}

interface SequenceActivityLogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Mission d'où le Journal est ouvert : ses inscriptions sont affichées par défaut. */
  projectId?: string | null;
  /**
   * Dans une page (onglet « À venir » de l'écran Séquences, lot 5c-2) : la
   * file sans le panneau latéral, chargée dès l'affichage. Défaut : le
   * panneau, comme avant.
   */
  embedded?: boolean;
  /** Période affichée à l'ouverture ; défaut : toutes les dates. */
  defaultPeriod?: 'all' | 'today' | 'week' | 'upcoming';
  /**
   * Journal d'une séquence (page /sequences/:id, lot 5c-2) : ses seules
   * étapes. Dans une page (`embedded`, avec ou sans séquence), la file est
   * lue par pages de 100 avec un curseur sur (scheduled_at, id) au lieu de la
   * limite de 500 ; statut, période et recherche du candidat filtrés par la
   * requête, « À venir » du plus proche au plus lointain, compteurs exacts en
   * une ligne, sans zéro.
   */
  sequenceId?: string | null;
}

/** Recherche sans les caractères réservés des filtres de l'API. */
const searchTerm = (query: string) => query.replace(/[%_,()"\\*.:]/g, ' ').trim();

type MessageOverride = { subject?: string; message?: string };

/** Types d'étape dont le texte est rédigé par l'IA pour chaque candidat. */
const AI_ACTION_TYPES = new Set(['smart_message']);

type FilterStatus = 'all' | 'scheduled' | 'sent' | 'failed' | 'skipped';
type FilterPeriod = 'all' | 'today' | 'week' | 'upcoming';
type Scope = 'mission' | 'all';

/** Statuts lus par la requête pour chaque filtre (Journal d'une séquence, paginé). */
const STATUS_FILTER_VALUES: Record<Exclude<FilterStatus, 'all'>, string[]> = {
  scheduled: ['scheduled', 'quota_blocked', 'waiting_event', 'sending'],
  sent: ['sent', 'opened', 'clicked', 'replied'],
  failed: ['failed', 'bounced'],
  skipped: ['skipped', 'cancelled'],
};

/** Compteurs exacts du Journal d'une séquence (lecture à part, toute la séquence). */
interface SequenceJournalCounts {
  upcoming: number;
  overdue: number;
  sent: number;
  failed: number;
}

const STATUS_FILTER_MATCH: Record<Exclude<FilterStatus, 'all'>, (status: string) => boolean> = {
  scheduled: (status) => ['scheduled', 'quota_blocked', 'waiting_event', 'sending'].includes(status),
  sent: (status) => isSentExecutionStatus(status),
  failed: (status) => status === 'failed' || status === 'bounced',
  skipped: (status) => status === 'skipped' || status === 'cancelled',
};

/** Étapes encore modifiables ou retirables depuis le Journal (jamais pendant l'envoi). */
const SKIPPABLE_STATUSES = new Set(['scheduled', 'quota_blocked']);

const PREVIEW_TITLES: Record<PreviewSource, string> = {
  final: 'Message',
  edited: 'Message modifié',
  override: "Message validé à l'inscription",
  template: "Modèle, personnalisé au moment de l'envoi",
  // Source rendue sans texte (computePreview : rien de généré ni de modèle) : le titre le dit.
  ai: "Message de l'IA Konekt pour ce candidat, pas encore généré",
  template_unverified: "Modèle de l'étape (aperçu personnalisé indisponible)",
};

/** « 26/09 à 10:42 » */
const formatWhen = (value: string) => format(new Date(value), "dd/MM 'à' HH:mm", { locale: fr });
/** Page : « 26/09 à 10 h 42 », même écriture que les onglets Candidats et Parcours. */
const pageWhen = (value: string) => `${dayMonth(value)} à ${clockTime(new Date(value))}`;

/** Page : couleur d'un statut d'étape, réservée à ce qui demande d'agir. */
function pageStatusTone(status: string, overdue: boolean, held: boolean): string {
  if (held) return 'text-muted-foreground';
  if (status === 'failed' || status === 'bounced') return 'text-danger';
  if (status === 'quota_blocked') return 'text-warning';
  return overdue ? 'text-foreground-secondary' : 'text-muted-foreground';
}

/**
 * Ce qui partira vraiment : le texte figé sur l'exécution (envoyé ou modifié à
 * la main), sinon l'aperçu validé à l'inscription, sinon le modèle, présenté
 * comme tel.
 */
function computePreview(
  exec: { status: string; final_message: string | null; final_subject: string | null; step_id: string },
  step: StepExecution['step'],
  overrides: Map<string, Record<string, MessageOverride>> | null,
  enrollmentId: string,
): MessagePreview {
  const override = overrides?.get(enrollmentId)?.[exec.step_id] ?? null;
  const overrideMessage = override?.message?.trim() || null;
  const overrideSubject = override?.subject?.trim() || null;
  const subject = exec.final_subject?.trim() || overrideSubject || step?.subject_template || null;

  if (exec.final_message?.trim()) {
    return { message: exec.final_message, subject, source: exec.status === 'scheduled' ? 'edited' : 'final' };
  }
  if (overrideMessage) return { message: overrideMessage, subject, source: 'override' };
  if (step?.message_template?.trim()) {
    return { message: step.message_template, subject, source: overrides ? 'template' : 'template_unverified' };
  }
  if (step && AI_ACTION_TYPES.has(step.action_type)) return { message: null, subject, source: 'ai' };
  return { message: null, subject, source: 'template' };
}

export const SequenceActivityLog: React.FC<SequenceActivityLogProps> = ({
  isOpen,
  onClose,
  projectId,
  embedded = false,
  defaultPeriod = 'all',
  sequenceId = null,
}) => {
  const [executions, setExecutions] = useState<StepExecution[]>([]);
  const [loading, setLoading] = useState(true);
  // Journal d'une séquence : page suivante et compteurs exacts.
  const [cursor, setCursor] = useState<JournalCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sequenceCounts, setSequenceCounts] = useState<SequenceJournalCounts | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [periodFilter, setPeriodFilter] = useState<FilterPeriod>(defaultPeriod);
  const [scope, setScope] = useState<Scope>('mission');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [editingExecution, setEditingExecution] = useState<StepExecution | null>(null);
  // Lot 5a-2 : l'étape ouverte l'est pour « Relire le message » (IA reportée).
  const [reviewingExecution, setReviewingExecution] = useState(false);
  const [skippingId, setSkippingId] = useState<string | null>(null);
  const [skipConfirm, setSkipConfirm] = useState<{ id: string; candidateName: string } | null>(null);
  // D3 : un collaborateur ne saute que les étapes des candidats qu'il a
  // inscrits (le serveur refuse les autres, 403).
  const { isCollaborator } = useOrganization();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;

  const missionScoped = !!projectId && scope === 'mission';
  // Dans une page (Journal d'une séquence, « À venir » de l'écran Séquences) :
  // pagination par curseur. Le panneau garde ses 500 lignes.
  const paginated = embedded || !!sequenceId;
  // Filtres appliqués par la requête : dans une page seulement. Dans le
  // panneau, ils restent appliqués à l'écran et ne relancent aucune lecture.
  const serverStatus: FilterStatus = paginated ? statusFilter : 'all';
  const serverPeriod: FilterPeriod = paginated ? periodFilter : 'all';
  // « À venir » : la prochaine étape d'abord.
  const ascending = paginated && periodFilter === 'upcoming';
  // Recherche du candidat, dans la requête (toutes les pages), après une courte pause de frappe.
  const [serverSearch, setServerSearch] = useState('');
  useEffect(() => {
    if (!paginated) return;
    const timer = window.setTimeout(() => setServerSearch(searchTerm(searchQuery)), 300);
    return () => window.clearTimeout(timer);
  }, [paginated, searchQuery]);
  // Typographie de la page : apostrophe typographique dans les textes affichés.
  const typo = useCallback((text: string) => (paginated ? text.replace(/'/g, '’') : text), [paginated]);

  // Lit une page d'étapes et l'enrichit (aperçus, traces d'arrêt). Hors
  // séquence : les 500 plus récentes, comme avant. Séquence : 100 à partir du
  // curseur, statut et période filtrés par la requête.
  const loadRows = useCallback(async (after: JournalCursor | null): Promise<StepExecution[]> => {
      // Dans une mission : seulement ses inscriptions (job_id de la mission),
      // y compris celles faites avec un modèle partagé entre missions.
      let jobIds: string[] | null = null;
      if (projectId && scope === 'mission') {
        const { data: project, error: projectError } = await supabase
          .from('sourcing_projects')
          .select('job_id')
          .eq('id', projectId)
          .maybeSingle();
        if (projectError) throw projectError;
        jobIds = missionEnrollmentJobIds(projectId, project?.job_id);
      }

      // Les étapes internes (attentes, conditions) sont écartées AVANT la
      // limite : les 500 lignes lues sont toutes des actions visibles.
      let query = supabase
        .from('sequence_step_executions')
        .select(
          'id, enrollment_id, step_id, step_order, status, scheduled_at, executed_at, final_subject, final_message, error_message, skip_reason, sequence_steps!inner(action_type, message_template, subject_template), sequence_enrollments!inner(status, created_by, profile_name, profile_headline, profile_url, job_id, outreach_sequences(name, is_active))',
        )
        .not('sequence_steps.action_type', 'in', `(${HIDDEN_ACTION_TYPES.join(',')})`)
        .order('scheduled_at', { ascending });
      if (jobIds) query = query.in('sequence_enrollments.job_id', jobIds);
      if (paginated) {
        query = query.order('id', { ascending });
        if (sequenceId) query = query.eq('sequence_enrollments.sequence_id', sequenceId);
        if (serverStatus !== 'all') query = query.in('status', STATUS_FILTER_VALUES[serverStatus]);
        const now = new Date();
        if (serverPeriod === 'today') query = query.gte('scheduled_at', startOfDay(now).toISOString()).lte('scheduled_at', endOfDay(now).toISOString());
        else if (serverPeriod === 'week') query = query.gte('scheduled_at', subDays(now, 7).toISOString());
        else if (serverPeriod === 'upcoming') query = query.gte('scheduled_at', now.toISOString());
        if (serverSearch) query = query.ilike('sequence_enrollments.profile_name', `%${serverSearch}%`);
        if (after) query = query.or(journalCursorFilter(after, ascending));
        query = query.limit(JOURNAL_PAGE_SIZE);
      } else {
        query = query.limit(JOURNAL_LIMIT);
      }

      const { data: execData, error: execError } = await query;
      if (execError) throw execError;

      const rows = execData || [];

      // Aperçus validés à l'inscription, pour les étapes encore à venir dont
      // le texte n'est pas figé. Lecture par paquets pour garder l'URL courte.
      const needOverrides = [...new Set(
        rows.filter(r => !r.final_message?.trim() && !isSentExecutionStatus(r.status)).map(r => r.enrollment_id),
      )];
      let overrides: Map<string, Record<string, MessageOverride>> | null = new Map();
      for (let i = 0; i < needOverrides.length && overrides; i += 100) {
        const chunk = needOverrides.slice(i, i + 100);
        const { data: trackingRows, error: trackingError } = await supabase
          .from('sequence_enrollments')
          // Seul le chemin JSON utile est lu (tracking_data peut être lourd).
          .select<string, { id: string; message_overrides: unknown }>('id, message_overrides:tracking_data->message_overrides')
          .in('id', chunk);
        if (trackingError) {
          console.warn('[SequenceActivityLog] aperçus indisponibles:', trackingError);
          overrides = null;
          break;
        }
        for (const t of trackingRows || []) {
          const value = t.message_overrides;
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            overrides.set(t.id, value as Record<string, MessageOverride>);
          }
        }
      }

      // Lot 5b : le motif « Arrêt manuel » est lu comme un arrêt seulement si
      // l'inscription porte la trace d'un arrêt manuel (c'était aussi le motif
      // d'une simple pause avant le 28/09). Lecture du seul chemin JSON utile.
      const stopReasonIds = [...new Set(rows.filter(r => r.skip_reason?.startsWith('Arrêt manuel')).map(r => r.enrollment_id))];
      const stoppedManually = new Set<string>();
      for (let i = 0; i < stopReasonIds.length; i += 100) {
        const { data: stopRows, error: stopError } = await supabase
          .from('sequence_enrollments')
          .select<string, { id: string; manual_stop: unknown }>('id, manual_stop:tracking_data->manual_stop')
          .in('id', stopReasonIds.slice(i, i + 100));
        if (stopError) {
          console.warn('[SequenceActivityLog] traces d’arrêt indisponibles:', stopError);
          break;
        }
        for (const t of stopRows || []) if (isManualStopTrace(t.manual_stop)) stoppedManually.add(t.id);
      }

      const enrichedExecutions: StepExecution[] = rows.map(exec => {
        const stepRel = exec.sequence_steps;
        const enrollmentRel = exec.sequence_enrollments;
        const step = stepRel
          ? { action_type: stepRel.action_type, message_template: stepRel.message_template, subject_template: stepRel.subject_template }
          : undefined;
        const sequenceRel = enrollmentRel?.outreach_sequences;
        return {
          id: exec.id,
          enrollment_id: exec.enrollment_id,
          step_id: exec.step_id,
          step_order: exec.step_order,
          status: exec.status,
          scheduled_at: exec.scheduled_at,
          executed_at: exec.executed_at,
          final_subject: exec.final_subject,
          final_message: exec.final_message,
          error_message: exec.error_message,
          skip_reason: exec.skip_reason,
          enrollment: enrollmentRel
            ? {
                status: enrollmentRel.status,
                created_by: enrollmentRel.created_by,
                profile_name: enrollmentRel.profile_name,
                profile_headline: enrollmentRel.profile_headline,
                profile_url: enrollmentRel.profile_url,
                stoppedManually: stoppedManually.has(exec.enrollment_id),
                sequence: sequenceRel ? { name: sequenceRel.name, is_active: sequenceRel.is_active } : undefined,
              }
            : undefined,
          step,
          preview: computePreview(exec, step, overrides, exec.enrollment_id),
          // Contrat §1 et D1 : une pause ou une séquence désactivée garde les
          // étapes à leur date, sans les envoyer.
          held: heldExecutionNotice(exec.status, enrollmentRel?.status, sequenceRel?.is_active),
        };
      });

      return enrichedExecutions;
  }, [projectId, scope, sequenceId, paginated, ascending, serverStatus, serverPeriod, serverSearch]);

  // Compteurs exacts de la file d'une page (une séquence, ou toutes celles que
  // la personne lit) : étapes visibles, toutes pages. Une étape d'un candidat
  // en pause ou d'une séquence en pause n'est ni à venir ni en retard (même
  // règle que heldExecutionNotice).
  const loadSequenceCounts = useCallback(async () => {
    if (!paginated) return;
    const hidden = `(${HIDDEN_ACTION_TYPES.join(',')})`;
    const base = () => {
      const q = supabase
        .from('sequence_step_executions')
        .select('id, sequence_steps!inner(action_type), sequence_enrollments!inner(status, sequence_id, outreach_sequences!inner(is_active))', { count: 'exact', head: true })
        .not('sequence_steps.action_type', 'in', hidden);
      return sequenceId ? q.eq('sequence_enrollments.sequence_id', sequenceId) : q;
    };
    const nowIso = new Date().toISOString();
    const live = <T extends ReturnType<typeof base>>(q: T) => q.eq('sequence_enrollments.status', 'active').eq('sequence_enrollments.outreach_sequences.is_active', true);
    const [upcoming, overdue, sent, failed] = await Promise.all([
      live(base().in('status', ['scheduled', 'quota_blocked']).gt('scheduled_at', nowIso)),
      live(base().eq('status', 'scheduled').lt('scheduled_at', nowIso)),
      base().in('status', STATUS_FILTER_VALUES.sent),
      base().eq('status', 'failed'),
    ]);
    const firstError = upcoming.error || overdue.error || sent.error || failed.error;
    if (firstError) {
      console.warn('[SequenceActivityLog] compteurs du journal indisponibles:', firstError);
      setSequenceCounts(null);
      return;
    }
    setSequenceCounts({ upcoming: upcoming.count ?? 0, overdue: overdue.count ?? 0, sent: sent.count ?? 0, failed: failed.count ?? 0 });
  }, [paginated, sequenceId]);

  const fetchExecutions = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const rows = await loadRows(null);
      setExecutions(rows);
      setCursor(paginated ? nextJournalCursor(rows) : null);
      if (paginated) void loadSequenceCounts();
    } catch (err) {
      console.error('Error fetching executions:', err);
      // Une panne ne se lit pas comme un journal vide : état d'erreur avec « Réessayer ».
      setLoadError(err instanceof Error ? err.message : String(err));
      if (!paginated) toast.error("Impossible de charger le Journal d'activité");
    } finally {
      setLoading(false);
    }
  }, [loadRows, paginated, loadSequenceCounts]);

  // « Afficher la suite » : page suivante après la dernière ligne affichée.
  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const rows = await loadRows(cursor);
      const known = new Set(executions.map((e) => e.id));
      setExecutions((prev) => [...prev, ...rows.filter((r) => !known.has(r.id))]);
      setCursor(nextJournalCursor(rows));
    } catch (err) {
      console.error('Error fetching more executions:', err);
      toast.error('La suite du journal n’a pas pu être chargée. Réessayez.');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (isOpen || embedded) {
      fetchExecutions();
    }
  }, [isOpen, embedded, fetchExecutions]);

  const toggleExpanded = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // « Ne pas envoyer cette étape » : action serveur skip_execution, la même que
  // « Sauter » dans le suivi des inscrits. Elle marque l'étape sautée, avance la
  // séquence et planifie la suivante. Avant, le navigateur passait l'exécution
  // en 'cancelled' : l'inscription restait active sans étape et le moteur
  // replanifiait la même étape une heure plus tard.
  const handleSkipExecution = async (executionId: string, candidateName: string) => {
    setSkippingId(executionId);
    try {
      const { data, error } = await invokeEdgeFunction<{ next_step_order?: number; message?: string }>('process-sequences', {
        action: 'skip_execution',
        execution_id: executionId,
      });

      if (error?.status === 409) {
        // Candidat en pause ou sorti de la séquence : la phrase du serveur dit
        // de le reprendre d'abord. Sinon, étape déjà partie ou traitée.
        toast.error(skipConflictMessage(error.code ?? data?.error_code, error.message));
        return;
      }
      if (error?.status === 403) {
        // Refus définitif (D3 : candidat inscrit par un collègue) : la phrase
        // du serveur, portée par `message`, sans inviter à réessayer.
        toast.error(data?.message || error.message);
        return;
      }
      if (error || !data?.success) {
        toast.error("L'étape n'a pas pu être retirée. Réessayez.", {
          description: error?.message || data?.error,
        });
        return;
      }

      toast.success(`${candidateName} ne recevra pas cette étape`, {
        description: "La séquence passe à l'étape suivante.",
      });
    } catch (err) {
      console.error('Error skipping execution:', err);
      toast.error("L'étape n'a pas pu être retirée. Réessayez.");
    } finally {
      setSkippingId(null);
      fetchExecutions();
    }
  };

  const resetFilters = () => {
    setSearchQuery('');
    setServerSearch('');
    setStatusFilter('all');
    setPeriodFilter(defaultPeriod);
  };

  // Filter and group executions
  const filteredExecutions = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const weekAgo = subDays(now, 7);

    return executions.filter(exec => {
      // Status filter (Journal d'une séquence : déjà appliqué par la requête)
      if (!paginated && statusFilter !== 'all' && !STATUS_FILTER_MATCH[statusFilter](exec.status)) {
        return false;
      }

      // Period filter
      const scheduledAt = new Date(exec.scheduled_at);
      if (paginated) {
        // Déjà appliqué par la requête.
      } else if (periodFilter === 'today') {
        if (isBefore(scheduledAt, todayStart) || isAfter(scheduledAt, todayEnd)) {
          return false;
        }
      } else if (periodFilter === 'week') {
        if (isBefore(scheduledAt, weekAgo)) {
          return false;
        }
      } else if (periodFilter === 'upcoming') {
        if (isBefore(scheduledAt, now)) {
          return false;
        }
      }

      // Search filter (dans une page : déjà appliqué par la requête, sur le nom du candidat)
      if (searchQuery && !paginated) {
        const query = searchQuery.toLowerCase();
        const profileName = exec.enrollment?.profile_name?.toLowerCase() || '';
        const sequenceName = exec.enrollment?.sequence?.name?.toLowerCase() || '';
        const actionType = (exec.step?.action_type ? stepTypeLabel(exec.step.action_type) : '').toLowerCase();

        if (!profileName.includes(query) && !sequenceName.includes(query) && !actionType.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [executions, statusFilter, periodFilter, searchQuery, paginated]);

  // Group by date
  const groupedExecutions = useMemo(() => {
    const groups: Record<string, StepExecution[]> = {};

    filteredExecutions.forEach(exec => {
      const date = format(new Date(exec.scheduled_at), 'yyyy-MM-dd');
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(exec);
    });

    // Jours du plus récent au plus ancien ; « À venir » : du plus proche au plus lointain.
    return Object.entries(groups).sort(([a], [b]) => (ascending ? a.localeCompare(b) : b.localeCompare(a)));
  }, [filteredExecutions, ascending]);

  // Stats — actions visibles seulement (les étapes internes sont exclues par la requête).
  // Une étape retenue (candidat en pause, séquence désactivée) n'est ni à venir ni en retard.
  const stats = useMemo(() => {
    const now = new Date();
    return {
      scheduled: executions.filter(e => !e.held && (e.status === 'scheduled' || e.status === 'quota_blocked') && isAfter(new Date(e.scheduled_at), now)).length,
      pending: executions.filter(e => !e.held && e.status === 'scheduled' && isBefore(new Date(e.scheduled_at), now)).length,
      sent: executions.filter(e => isSentExecutionStatus(e.status)).length,
      failed: executions.filter(e => e.status === 'failed').length,
    };
  }, [executions]);

  const isTruncated = executions.length >= JOURNAL_LIMIT && !paginated;

  // Journal d'une séquence : compteurs exacts en une ligne, sans zéro.
  const countParts = sequenceCounts
    ? [
        sequenceCounts.upcoming > 0 ? { text: `${sequenceCounts.upcoming} à venir`, tone: '' } : null,
        sequenceCounts.overdue > 0 ? { text: `${sequenceCounts.overdue} en retard`, tone: 'text-warning' } : null,
        sequenceCounts.sent > 0 ? { text: plural(sequenceCounts.sent, 'envoyée', 'envoyées'), tone: '' } : null,
        sequenceCounts.failed > 0 ? { text: `${sequenceCounts.failed} en échec`, tone: 'text-danger' } : null,
      ].filter((p): p is { text: string; tone: string } => !!p)
    : [];

  const formatDateHeader = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = startOfDay(new Date());
    const dateStart = startOfDay(date);

    if (dateStart.getTime() === today.getTime()) {
      return typo("Aujourd'hui");
    }

    const yesterday = subDays(today, 1);
    if (dateStart.getTime() === yesterday.getTime()) {
      return "Hier";
    }

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (dateStart.getTime() === tomorrow.getTime()) {
      return "Demain";
    }

    const label = format(date, 'EEEE d MMMM', { locale: fr });
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  // Filtres et actualisation, communs au panneau et à la page.
  const statusSelect = (triggerClass: string) => (
    <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as FilterStatus)}>
      <SelectTrigger className={triggerClass} aria-label="Filtrer par statut">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Tous les statuts</SelectItem>
        <SelectItem value="scheduled">Planifiées</SelectItem>
        <SelectItem value="sent">Envoyées</SelectItem>
        <SelectItem value="failed">En échec</SelectItem>
        <SelectItem value="skipped">Ignorées ou annulées</SelectItem>
      </SelectContent>
    </Select>
  );
  const periodSelect = (triggerClass: string) => (
    <Select value={periodFilter} onValueChange={(v) => setPeriodFilter(v as FilterPeriod)}>
      <SelectTrigger className={triggerClass} aria-label="Filtrer par période">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Toutes les dates</SelectItem>
        <SelectItem value="today">{typo("Aujourd'hui")}</SelectItem>
        <SelectItem value="week">7 derniers jours</SelectItem>
        <SelectItem value="upcoming">À venir</SelectItem>
      </SelectContent>
    </Select>
  );
  const refreshButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 max-md:h-11 max-md:w-11"
          onClick={fetchExecutions}
          disabled={loading}
          aria-label="Rafraîchir les activités"
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Rafraîchir les activités</TooltipContent>
    </Tooltip>
  );

  // Contenu commun au panneau et à la page.
  const body = (
    <>
      {loading ? (
        <div role="status" aria-label="Chargement du journal">
          <span className="sr-only">Chargement…</span>
          <ActivityLogSkeleton />
        </div>
      ) : loadError ? (
        <ErrorState
          title={paginated ? 'Journal indisponible pour l’instant.' : 'Impossible de charger le journal'}
          description="Vérifiez votre connexion, puis réessayez."
          detail={loadError}
          onRetry={fetchExecutions}
        />
      ) : executions.length === 0 && !(paginated && (statusFilter !== 'all' || periodFilter !== defaultPeriod || !!serverSearch)) ? (
        <EmptyState
          icon={Activity}
          title={missionScoped ? 'Aucune étape pour cette mission' : paginated && defaultPeriod === 'upcoming' ? 'Aucune étape prévue pour l’instant.' : typo("Aucune étape pour l'instant")}
          description={paginated && defaultPeriod === 'upcoming'
            ? 'Les prochaines étapes de vos séquences s’afficheront ici, jour par jour.'
            : typo("Les étapes envoyées et planifiées de vos séquences s'afficheront ici dès la première inscription.")}
          action={missionScoped ? (
            <Button variant="outline" size="sm" onClick={() => setScope('all')}>
              Voir toutes les missions
            </Button>
          ) : undefined}
        />
      ) : (
        <>
          {paginated ? (
            countParts.length > 0 && (
              <p className="text-sm text-foreground-secondary">
                {countParts.map((part, i) => (
                  <React.Fragment key={part.text}>
                    {i > 0 && <span aria-hidden="true"> · </span>}
                    <span className={cn('tabular-nums', part.tone)}>{part.text}</span>
                  </React.Fragment>
                ))}
              </p>
            )
          ) : (
          <div className="space-y-1.5">
            <StatGrid cols={{ base: 2, sm: 4 }}>
              <StatTile label="À venir" value={stats.scheduled} />
              <StatTile label="En retard" value={stats.pending} variant="warning" accent={stats.pending > 0} />
              <StatTile label="Envoyées" value={stats.sent} />
              <StatTile label="En échec" value={stats.failed} variant="destructive" accent={stats.failed > 0} />
            </StatGrid>
            {isTruncated && (
              <p className="text-xs text-muted-foreground">
                Sur les {JOURNAL_LIMIT} dernières actions.
              </p>
            )}
          </div>
          )}

          {paginated ? (
            // Page : recherche du candidat et actualisation sur une ligne, puis les deux filtres
            // côte à côte (44 px au doigt, libellés entiers à 360 px).
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex gap-2 sm:max-w-sm sm:flex-1">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    type="search"
                    aria-label="Rechercher dans le journal"
                    placeholder="Rechercher un candidat"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 max-md:h-11"
                  />
                </div>
                {refreshButton}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                {statusSelect('w-full max-md:h-11 sm:w-40')}
                {periodSelect('w-full max-md:h-11 sm:w-44')}
              </div>
            </div>
          ) : (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                aria-label="Rechercher dans le journal"
                placeholder="Candidat, séquence ou étape"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {projectId && (
                <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                  <SelectTrigger className="flex-1 sm:w-40" aria-label="Périmètre">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mission">Cette mission</SelectItem>
                    <SelectItem value="all">Toutes les missions</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {statusSelect('flex-1 sm:w-40')}
              {periodSelect('flex-1 sm:w-36')}
              {refreshButton}
            </div>
          </div>
          )}

          {groupedExecutions.length === 0 ? (
            <EmptyState
              variant="compact"
              icon={Search}
              title="Aucune étape ne correspond à ces filtres"
              description="Élargissez la période ou le statut, ou effacez la recherche."
              action={
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  Réinitialiser les filtres
                </Button>
              }
            />
          ) : (
            <div className="space-y-5">
              {groupedExecutions.map(([date, items]) => (
                <section key={date} aria-labelledby={`journal-${date}`} className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h3 id={`journal-${date}`} className="text-sm font-semibold text-foreground">
                      {formatDateHeader(date)}
                    </h3>
                    <div className="h-px flex-1 bg-border" aria-hidden="true" />
                    <span className="text-xs text-muted-foreground">{plural(items.length, 'étape')}</span>
                  </div>

                  {/* Journal d'une séquence : des filets entre les lignes, sans cadres (06-simplicite, règle 3). */}
                  <ul className={paginated ? 'divide-y divide-border' : 'space-y-2'}>
                    {items.map((exec) => {
                      const actionType = exec.step?.action_type || '';
                      const actionLabel = actionType ? stepTypeLabel(actionType) : 'Action';
                      const isExpanded = expandedItems.has(exec.id);
                      const candidateName = exec.enrollment?.profile_name || 'Candidat';
                      const preview = exec.preview;
                      const hasMessage = !!preview.message || preview.source === 'ai';
                      // Lot 5a-2 : étape rédigée par l'IA reportée par le moteur
                      // faute de texte relu ; sa raison a sa propre ligne, et
                      // disparaît dès que le message est relu.
                      const aiReview = isAiReviewPending(exec);
                      const showError = !!exec.error_message && shouldShowExecutionError(exec.status)
                        && !aiReview && (exec.status !== 'scheduled' || !!scheduledExecutionError(exec));
                      const showReason = !!exec.skip_reason && !isSentExecutionStatus(exec.status);
                      const held = exec.held;
                      const isPast = isBefore(new Date(exec.scheduled_at), new Date());
                      const isOverdue = exec.status === 'scheduled' && isPast && !held;
                      const doneVerb = executionDoneVerb(exec.status);
                      // Le serveur refuse de sauter l'étape d'un candidat non actif (409)
                      // et, pour un collaborateur, d'un candidat inscrit par un collègue (403).
                      const ownRow = !isCollaborator || (!!userId && exec.enrollment?.created_by === userId);
                      const canSkip = SKIPPABLE_STATUSES.has(exec.status) && !held && ownRow;
                      // Le texte reste modifiable pendant la pause, avant la reprise.
                      const canEdit = exec.status === 'scheduled' && !!preview.message && !aiReview;
                      // « Relire le message » : un collaborateur, ses inscriptions seulement.
                      const canReview = aiReview && ownRow;

                      return (
                        <li key={exec.id}>
                          <Collapsible
                            open={isExpanded}
                            onOpenChange={() => toggleExpanded(exec.id)}
                            className={paginated ? undefined : 'rounded-xl border border-border bg-card'}
                          >
                            <CollapsibleTrigger className={cn('flex w-full items-start gap-3 text-left transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', paginated ? 'rounded-lg px-2 py-2.5' : 'rounded-xl p-3')}>
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                                <SequenceActionIcon type={exec.step?.action_type} className="h-4 w-4" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="truncate text-sm font-medium text-foreground">{candidateName}</span>
                                  {paginated ? (
                                    // Page : statut en texte ; la couleur seulement pour ce qui demande d'agir
                                    // (échec, retard, report par le plafond), 06-simplicite, règles 7 et 8.
                                    <span className={cn('text-xs', pageStatusTone(exec.status, isOverdue, !!held))}>
                                      {held ? held.label : exec.status === 'quota_blocked' ? quotaBlockedLabel(actionType) : typo(executionStatusLabel(exec.status))}
                                      {isOverdue && <span className="text-warning"> · En retard</span>}
                                    </span>
                                  ) : (
                                    <>
                                      {held ? (
                                        <Badge variant="muted">
                                          <Pause className="h-3 w-3" aria-hidden="true" />
                                          <span className="ml-1">{held.label}</span>
                                        </Badge>
                                      ) : (
                                        // Libellé de la table partagée des statuts d'exécution, ton du catalogue.
                                        <Badge variant={executionStatusMeta(exec.status).tone}>
                                          {executionStatusLabel(exec.status)}
                                        </Badge>
                                      )}
                                      {isOverdue && <Badge variant="warning">En retard</Badge>}
                                    </>
                                  )}
                                </div>
                                {/* Page : l'heure passe à la ligne au lieu d'être coupée sur téléphone. */}
                                <p className={cn('mt-0.5 text-xs text-muted-foreground', paginated ? 'break-words' : 'truncate')}>
                                  {actionLabel}
                                  {!sequenceId && exec.enrollment?.sequence?.name && ` · ${exec.enrollment.sequence.name}`}
                                  {' · '}
                                  <span className="tabular-nums">{paginated ? clockTime(new Date(exec.scheduled_at)) : format(new Date(exec.scheduled_at), 'HH:mm')}</span>
                                </p>
                                {held && (
                                  <p className="text-xs text-muted-foreground mt-0.5">{held.hint}</p>
                                )}
                              </div>
                              <ChevronRight
                                className={cn('mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150', isExpanded && 'rotate-90')}
                                aria-hidden="true"
                              />
                            </CollapsibleTrigger>

                            <CollapsibleContent>
                              <div className={cn('space-y-3', paginated ? 'px-2 pb-3 pl-12' : 'border-t border-border p-3')}>
                                {showError && (
                                  <p
                                    className={cn(
                                      'rounded-lg px-3 py-2 text-xs',
                                      exec.status === 'failed' ? 'bg-danger-muted text-danger' : 'bg-warning-muted text-foreground',
                                    )}
                                  >
                                    {exec.status === 'failed' ? 'Échec' : 'Tentative précédente'} : {typo(formatSequenceError(exec.error_message))}
                                  </p>
                                )}
                                {aiReview && (
                                  <p className="rounded-lg bg-warning-muted px-3 py-2 text-xs text-foreground">
                                    {formatSequenceError(exec.error_message)}
                                  </p>
                                )}
                                {showReason && (
                                  <p className="text-xs text-muted-foreground">
                                    Raison : {typo(formatSkipReason(exec.skip_reason, { manualStop: exec.enrollment?.stoppedManually }))}
                                  </p>
                                )}

                                {hasMessage && (
                                  <div className="rounded-lg border border-border bg-background p-3">
                                    <p className="mb-2 text-xs font-medium text-foreground-secondary">
                                      {typo(aiReview
                                        ? (preview.message ? "Modèle de l'étape, à relire avant l'envoi" : "Message rédigé par l'IA, pas encore relu")
                                        : PREVIEW_TITLES[preview.source])}
                                    </p>
                                    {preview.subject && (
                                      <p className="mb-2 border-b border-border pb-2 text-xs text-muted-foreground">
                                        <span className="font-medium text-foreground-secondary">Objet :</span> {preview.subject}
                                      </p>
                                    )}
                                    {preview.message && (
                                      <p className="text-sm leading-relaxed text-foreground">
                                        {preview.message.split(/\\n|\n/).map((line, i, arr) => (
                                          <React.Fragment key={i}>
                                            {line}
                                            {i < arr.length - 1 && <br />}
                                          </React.Fragment>
                                        ))}
                                      </p>
                                    )}
                                  </div>
                                )}

                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                  <span>Prévu : {paginated ? pageWhen(exec.scheduled_at) : formatWhen(exec.scheduled_at)}</span>
                                  {exec.executed_at && doneVerb && (
                                    <span>{doneVerb} : {paginated ? pageWhen(exec.executed_at) : formatWhen(exec.executed_at)}</span>
                                  )}
                                </div>

                                {(canEdit || canReview || canSkip || exec.enrollment?.profile_url) && (
                                  <div className="flex flex-wrap items-center gap-2">
                                    {canReview && (
                                      <Button
                                        variant="primary"
                                        size="xs"
                                        className="max-md:h-11"
                                        onClick={() => { setReviewingExecution(true); setEditingExecution(exec); }}
                                      >
                                        <Sparkles aria-hidden="true" />
                                        Relire le message
                                      </Button>
                                    )}
                                    {canEdit && (
                                      <Button
                                        variant="outline"
                                        size="xs"
                                        className="max-md:h-11"
                                        onClick={() => { setReviewingExecution(false); setEditingExecution(exec); }}
                                      >
                                        <Pencil aria-hidden="true" />
                                        Modifier
                                      </Button>
                                    )}
                                    {canSkip && (
                                      <Button
                                        variant="ghost"
                                        size="xs"
                                        className="text-muted-foreground hover:text-danger max-md:h-11"
                                        onClick={() => setSkipConfirm({ id: exec.id, candidateName })}
                                        loading={skippingId === exec.id}
                                      >
                                        {skippingId !== exec.id && <Ban aria-hidden="true" />}
                                        Ne pas envoyer cette étape
                                      </Button>
                                    )}
                                    {exec.enrollment?.profile_url && (
                                      <Button variant="ghost" size="xs" asChild className="max-md:h-11">
                                        <a href={exec.enrollment.profile_url} target="_blank" rel="noopener noreferrer">
                                          <ExternalLink aria-hidden="true" />
                                          Ouvrir le profil LinkedIn
                                        </a>
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {/* Journal d'une séquence : page suivante après la dernière ligne. */}
          {paginated && cursor && (
            <div className="flex justify-center pt-1">
              <Button variant="ghost" size="sm" onClick={() => { void loadMore(); }} loading={loadingMore} className="max-md:h-11">
                Afficher la suite
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );

  const dialogs = (
    <>
      {/* Edit scheduled message modal */}
      <EditScheduledMessageModal
        isOpen={!!editingExecution}
        onClose={() => setEditingExecution(null)}
        execution={editingExecution}
        onSaved={fetchExecutions}
        aiReview={reviewingExecution}
      />

      {/* Confirmation avant de retirer une étape programmée */}
      <AlertDialog open={!!skipConfirm} onOpenChange={(open) => !open && setSkipConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ne pas envoyer cette étape ?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="font-medium text-foreground">{skipConfirm?.candidateName}</strong>
              {paginated
                ? ' ne recevra pas cette étape. La séquence passera à l’étape suivante. Pour ne plus rien lui envoyer, arrêtez la séquence pour ce candidat.'
                : " ne recevra pas cette étape. La séquence passera à l'étape suivante. Pour tout arrêter, mettez ce candidat en pause."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {paginated ? <AlertDialogCancel>Garder l’envoi</AlertDialogCancel> : <AlertDialogCancel>Garder l'envoi</AlertDialogCancel>}
            <AlertDialogAction
              onClick={() => {
                const target = skipConfirm;
                setSkipConfirm(null);
                if (target) handleSkipExecution(target.id, target.candidateName);
              }}
              className="bg-destructive"
            >
              Ne pas envoyer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (embedded) {
    return (
      <div className="space-y-4">
        {body}
        {dialogs}
      </div>
    );
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="space-y-1 border-b border-border px-6 py-5 pr-14 text-left">
          <SheetTitle>Journal d'activité</SheetTitle>
          <SheetDescription>
            Les {JOURNAL_LIMIT} dernières étapes {missionScoped ? 'des candidats de cette mission' : 'de vos séquences'}, envoyées ou planifiées.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">{body}</div>
      </SheetContent>
      {dialogs}
    </Sheet>
  );
};

/** Squelette du journal : tuiles, filtres, puis des lignes d'étape. */
const ActivityLogSkeleton: React.FC = () => (
  <div className="space-y-4" aria-hidden="true">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-20 rounded-xl" />
      ))}
    </div>
    <Skeleton className="h-9 w-full rounded-lg" />
    {[0, 1, 2, 3, 4].map((i) => (
      <div key={i} className="flex items-start gap-3 rounded-xl border border-border p-3">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/5 rounded-sm" />
          <Skeleton className="h-3 w-3/5 rounded-sm" />
        </div>
      </div>
    ))}
  </div>
);

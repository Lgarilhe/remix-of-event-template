import React, { useState, useEffect, useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useIsMobile } from '@/hooks/use-mobile';
import { hasPlanFeature } from '@/lib/featureGates';
import { ENROLLMENT_STATUSES, sequenceChannels } from '@/lib/sequenceCatalog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Banner, bannerActionClass } from '@/components/ui/banner';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState, ErrorState } from '@/components/layout';
import {
  Plus,
  Search,
  BarChart3,
  MoreHorizontal,
  Trash2,
  Pencil,
  Users,
  Copy,
  FastForward,
  Activity,
  FileText,
  Lock,
  AlertTriangle,
  ScrollText,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SEQUENCE_LEVEL_PAUSE_REASONS } from '@/lib/sequenceLabels';
import { actionTypeLabel, sequenceWriteRefusal } from '@/lib/sequenceErrorMessages';
import { SequenceBuilder, Sequence } from './SequenceBuilder';
import type { StopConditions, SenderAccountConfig } from './SequenceBuilder';
import { rowToSequenceStep } from './sequence/sequenceGraph';
import { SequenceEnrollmentsPanel } from './SequenceEnrollmentsPanel';
import { SequenceActivityLog } from './SequenceActivityLog';
import { SequenceDiagnostic } from './SequenceDiagnostic';
// Q5 — SequenceAnalytics contient recharts (~100KB), lazy-load pour split chunk
const SequenceAnalytics = React.lazy(() => import('./SequenceAnalytics'));
import { SequenceTemplateSelector, SaveAsTemplateModal } from './SequenceTemplateSelector';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { plural } from '@/lib/plural';
import { timeAgo } from '@/lib/relativeTime';

interface SequenceWithStats {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  project_id: string | null;
  organization_id: string | null;
  /** Auteur : seul lui modifie la séquence quand il est collaborateur (contrat §8). */
  created_by: string | null;
  // Réglages d'en-tête lus par le moteur : à recharger à l'édition et à
  // recopier à la duplication, sinon ils sont effacés au premier enregistrement.
  stop_conditions: Partial<StopConditions> | null;
  sender_accounts: SenderAccountConfig[] | null;
  rotation_mode: string | null;
  multi_sender_enabled: boolean | null;
  steps: any[];
  enrollments: {
    total: number;
    active: number;
    completed: number;
    replied: number;
    paused: number;
    /** Candidats en pause par raison (sequence_enrollments.pause_reason). */
    pausedByReason: Record<string, number>;
  };
}

interface SequencesListProps {
  // Passés par l'onglet Outreach. La liste n'en a plus besoin depuis le
  // retrait de l'inscription par clic sur une ligne, jamais branchée (revue
  // design D-27) : l'inscription passe par la messagerie et la recherche.
  accounts?: { id: string; name: string }[];
  selectedAccount?: string | null;
  isVisible?: boolean;
  projectId?: string | null;
  /** Incrémenté par le parent pour ouvrir le choix de modèle (bandeau « candidats Go »). */
  createRequestId?: number;
  /** Appelé après chaque rechargement réussi de la liste (inscriptions, pauses, reprises). */
  onDataChanged?: () => void;
  /**
   * « compact » : la forme téléphone (colonnes empilées sous le nom) quelle
   * que soit la largeur de l'écran, pour un conteneur étroit comme le panneau
   * « Prise de contact » de la page mission (440 px). Les colonnes d'ordinateur
   * n'y tiennent pas : le nom s'y écrivait une lettre par ligne.
   */
  layout?: 'auto' | 'compact';
}

// Conditions d'arrêt affichées par défaut dans l'éditeur : ce qui est montré
// est ce qui est enregistré quand la séquence n'en a pas encore.
const DEFAULT_STOP_CONDITIONS: StopConditions = {
  on_reply: true,
  on_click: false,
  on_unsubscribe: true,
  on_meeting_booked: false,
};

// Une étape d'attente sans événement est franchie tout de suite par le moteur :
// « Attendre réponse » clôt l'inscription comme répondue, « Attendre connexion »
// déclare le candidat connecté. L'éditeur visuel et l'assistant n'en posaient
// pas : on le déduit du type d'étape.
const implicitWaitEvent = (actionType: string, waitForEvent: string | null | undefined): string | null => {
  if (waitForEvent) return waitForEvent;
  if (actionType === 'wait_reply') return 'reply_received';
  if (actionType === 'wait_connection') return 'connection_accepted';
  return null;
};

// « 1 candidat », « 3 candidats ».
const candidats = (n: number) => `${n} candidat${n > 1 ? 's' : ''}`;

// Valeurs que l'éditeur affiche par défaut quand la colonne est vide : elles
// sont désormais chargées dans l'état, sinon l'écran montrait « 70 » ou « 3 »
// et l'enregistrement refusait un champ vide.
const DEFAULT_SCORE_THRESHOLD = '70';
const DEFAULT_WAIT_TIMEOUT_DAYS = 3;
const TIMEOUT_REQUIRED_ACTIONS = ['wait_connection', 'wait_reply', 'wait_profile_visit'];

const CONCURRENT_EDIT_MESSAGE = 'Cette séquence a été modifiée par un collègue depuis son ouverture. Rouvrez-la avant d’enregistrer.';

// L'API renvoie au plus 1 000 lignes par requête : au-delà, les compteurs
// étaient faux (« 0 actif » sur une séquence active, désactivation sans
// confirmation). On lit donc toutes les pages.
const API_PAGE_SIZE = 1000;
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += API_PAGE_SIZE) {
    const { data, error } = await page(from, from + API_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < API_PAGE_SIZE) return rows;
  }
}

const emptyEnrollmentStats = (): SequenceWithStats['enrollments'] => ({
  total: 0, active: 0, completed: 0, replied: 0, paused: 0, pausedByReason: {},
});

// Réponse des actions serveur de reprise (process-sequences).
interface ResumeCounts {
  resumed?: number;
  nothing_to_resume?: number;
  account_unlinked?: number;
  not_paused?: number;
  error?: number;
}
interface ResumeResponse {
  success?: boolean;
  results?: Array<{ enrollment_id: string; outcome: keyof ResumeCounts; message?: string }>;
  counts?: ResumeCounts;
  /** Candidats non traités faute de temps côté serveur (reprise par séquence). */
  remaining?: number;
  /**
   * Reprise par séquence d'un collaborateur (contrat §8) : candidats en pause
   * laissés de côté parce qu'inscrits par d'autres membres. 0 sinon.
   */
  other_members?: number;
  message?: string;
  error?: string;
}

// Reprise par séquence : le serveur s'arrête avant la limite de temps d'un appel
// et compte le reste dans `remaining`. On le rappelle tant qu'il en reste et
// qu'il progresse.
const MAX_RESUME_ROUNDS = 10;

// DETAIL du refus STEP_HAS_HISTORY : « Étape(s) concernée(s) : 0, 2 », en
// step_order (base 0, trié comme du texte). L'éditeur numérote à partir de 1.
// Après une suppression, l'éditeur a renuméroté les étapes : chaque étape est
// alors nommée par son type (labelsByOrder, lu en base avant l'enregistrement)
// et son numéro d'avant les modifications.
const blockedStepsNotice = (details: string | null | undefined, labelsByOrder?: Map<number, string>): string => {
  const orders = [...new Set((details?.match(/\d+/g) ?? []).map(Number))].sort((a, b) => a - b);
  if (orders.length === 0) return '';
  const names = orders.map(order => {
    const label = labelsByOrder?.get(order);
    return label ? `« ${label} » (étape ${order + 1} avant vos modifications)` : String(order + 1);
  });
  return names.length > 1 ? ` Étapes concernées : ${names.join(', ')}.` : ` Étape concernée : ${names[0]}.`;
};

// Erreur de la base traduite pour l'éditeur, qui affiche err.message : jamais
// le texte brut de PostgreSQL (« row-level security », « not accessible »).
const sequenceSaveError = (error: { message?: string; code?: string; hint?: string } | null): Error => {
  console.error('Sequence save error:', error);
  const refusal = sequenceWriteRefusal(error);
  if (refusal) return new Error(refusal);
  const text = error?.message ?? '';
  if (/not found or not accessible/i.test(text)) {
    return new Error('Cette séquence n’existe plus ou vous n’y avez plus accès. Actualisez la liste des séquences.');
  }
  if (error?.code === '42501' || /row-level security/i.test(text)) {
    return new Error('Vous n’avez pas les droits nécessaires pour enregistrer cette séquence.');
  }
  return new Error('La séquence n’a pas pu être enregistrée. Vérifiez votre connexion puis réessayez.');
};

// D3 : désactiver met en pause TOUS les candidats en cours. Un collaborateur
// ne peut mettre en pause que les inscriptions qu'il a créées (RLS) : la
// désactivation ne lui est pas proposée.
const COLLABORATOR_DEACTIVATION_HINT = 'Désactiver une séquence met en pause tous ses candidats : réservé aux membres qui gèrent toutes les inscriptions. Mettez vos candidats en pause depuis la liste des inscrits.';

// « Lecture seule » : séquence d'une autre organisation, ou (contrat §8) séquence
// d'un collègue pour un collaborateur, qui ne modifie que celles qu'il a créées.
const OTHER_ORG_READ_ONLY_HINT = 'Séquence d’une autre organisation : vous pouvez la consulter, pas la modifier.';
const NOT_AUTHOR_READ_ONLY_HINT = 'Seul l’auteur de cette séquence peut la modifier : dupliquez-la pour l’adapter.';

// Décision 32 : aucune activation tant que l'état d'abonnement n'est pas lu.
const PLAN_STATE_LOADING_MESSAGE = 'Vérification de votre abonnement en cours : réessayez dans un instant.';
const PLAN_STATE_UNREADABLE_MESSAGE = 'Votre abonnement n’a pas pu être vérifié : la séquence n’a pas été activée. Réessayez dans un instant.';

/** Même grille pour l'en-tête et les lignes, à partir de 1 024 px. */
const ROW_GRID = 'lg:grid-cols-[2.75rem_minmax(0,1fr)_7.5rem_minmax(0,14rem)_9rem_2.25rem]';

export const SequencesList: React.FC<SequencesListProps> = ({
  isVisible = true,
  projectId,
  createRequestId = 0,
  onDataChanged,
  layout = 'auto',
}) => {
  // Colonnes à partir de 1 024 px, sauf dans un conteneur étroit.
  const wide = layout === 'auto';
  // organization_id est exigé par la policy INSERT d'outreach_sequences
  // (WITH CHECK organization_id = get_user_org_id(auth.uid())) : sans lui, la
  // création et la duplication étaient refusées par RLS.
  const { organizationId, isCollaborator } = useOrganization();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const planNoticeId = useId();
  // Gating par plan (lot P0-C) : l'activation d'une séquence est refusée sur le
  // plan gratuit. Décision 32 : tant que l'état d'abonnement n'est pas lu
  // (chargement ou lecture en échec), aucune activation, ni par l'interrupteur
  // ni à la création. canSendSequences reste vrai pendant le chargement pour
  // que l'éditeur n'annonce pas l'offre gratuite à tort.
  const { effectivePlanId, isLoading: isPlanLoading, isLoadingError: isPlanLoadError, refetch: refetchPlan } = useSubscriptionState();
  const canSendSequences = isPlanLoading || hasPlanFeature(effectivePlanId, 'sequences_send');
  const planStateUnknown = isPlanLoading || isPlanLoadError;
  const activationWaitsForPlan = (seq: SequenceWithStats) => !seq.is_active && isPlanLoading;
  const [sequences, setSequences] = useState<SequenceWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingSequence, setEditingSequence] = useState<Sequence | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toggleConfirm, setToggleConfirm] = useState<{ id: string; nextActive: boolean; activeCount: number; shared: boolean } | null>(null);
  // Réactivation avec des candidats à reprendre : confirmation préalable.
  // `otherMembers` : candidats d'autres membres, que la reprise d'un collaborateur laisse en pause (D3).
  const [activateConfirm, setActivateConfirm] = useState<{ id: string; resumable: number; otherPaused: number; otherMembers: number } | null>(null);
  // Séquence dont l'interrupteur est en cours d'écriture : désactivé pendant l'appel.
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // Duplication en cours : « Dupliquer » grisé, un seul appel à la fois.
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const duplicatingRef = React.useRef(false);
  const [enrollmentsPanelSequence, setEnrollmentsPanelSequence] = useState<SequenceWithStats | null>(null);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [showGlobalAnalytics, setShowGlobalAnalytics] = useState(false);
  const [analyticsSequence, setAnalyticsSequence] = useState<SequenceWithStats | null>(null);
  const [nudging, setNudging] = useState(false);
  const [nudgeConfirmOpen, setNudgeConfirmOpen] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [saveTemplateSeq, setSaveTemplateSeq] = useState<SequenceWithStats | null>(null);
  // Échec du chargement de la liste : état d'erreur avec « Réessayer », jamais
  // l'accueil « Créer ma première séquence » (on croyait tout supprimé).
  const [loadError, setLoadError] = useState(false);
  // Message technique de la panne, montré replié sous « Détails techniques ».
  const [loadErrorDetail, setLoadErrorDetail] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Échec des lectures secondaires : étapes (éditeur) ou compteurs (« – »).
  const [detailError, setDetailError] = useState<{ steps: boolean; counts: boolean }>({ steps: false, counts: false });
  // Étapes connues de l'éditeur à l'ouverture d'une séquence existante : une
  // étape ajoutée entre-temps par un collègue bloque l'enregistrement.
  const editorBaseStepIdsRef = React.useRef<{ sequenceId: string; stepIds: Set<string> } | null>(null);
  // Candidats en cours de la séquence ouverte dans l'éditeur (0 pour une
  // nouvelle, undefined si le compte a échoué : l'éditeur confirme alors par prudence).
  const [editingActiveCount, setEditingActiveCount] = useState<number | undefined>(0);
  // Rappel du parent lu par ref : sa nouvelle identité à chaque rendu ne
  // relance pas le chargement.
  const onDataChangedRef = React.useRef(onDataChanged);
  onDataChangedRef.current = onDataChanged;
  // Demande d'ouverture du choix de modèle venue du parent (valeur déjà vue au
  // montage ignorée : un remontage ne rouvre rien).
  const handledCreateRequestRef = React.useRef(createRequestId);

  useEffect(() => {
    if (createRequestId && createRequestId !== handledCreateRequestRef.current) {
      handledCreateRequestRef.current = createRequestId;
      setShowTemplateSelector(true);
    }
  }, [createRequestId]);

  // Seules les séquences de mon organisation sont modifiables (RLS) : celles
  // d'une autre organisation, visibles par l'équipe de mission, sont en lecture
  // seule. Sans ce masquage, un refus silencieux affichait un faux succès.
  const canManage = (seq: SequenceWithStats) => !!organizationId && seq.organization_id === organizationId;
  // Contrat §8 : un collaborateur ne modifie, ne supprime et n'active que les
  // séquences qu'il a créées (policy org_members_update, save_sequence_steps
  // SEQUENCE_NOT_OWNER). « Dupliquer » reste sous canManage : la copie lui appartient.
  const canEdit = (seq: SequenceWithStats) =>
    canManage(seq) && (!isCollaborator || (!!userId && seq.created_by === userId));
  const readOnlyHint = (seq: SequenceWithStats) => (canManage(seq) ? NOT_AUTHOR_READ_ONLY_HINT : OTHER_ORG_READ_ONLY_HINT);
  // D3 : la désactivation (pause de tous les candidats) n'est pas proposée à un collaborateur.
  const deactivationLocked = (seq: SequenceWithStats) => seq.is_active && isCollaborator;
  // Bouton d'un toast qui ouvre la liste des inscrits : c'est là que l'on
  // reprend les candidats restés en pause (un par un ou tous ensemble).
  const enrollmentsPanelAction = (sequenceId: string) => {
    const seq = sequences.find(s => s.id === sequenceId);
    return seq ? { action: { label: 'Voir les inscrits', onClick: () => setEnrollmentsPanelSequence(seq) } } : {};
  };

  // Séquences de CETTE mission dans mon organisation : les seules que
  // « Envoyer les actions du jour » avance (les séquences globales servent à
  // plusieurs missions).
  const missionSequenceIds = sequences
    .filter(s => s.project_id === projectId && canManage(s))
    .map(s => s.id);

  const handleNudgeToday = async () => {
    setNudgeConfirmOpen(false);
    if (missionSequenceIds.length === 0) return;
    setNudging(true);
    try {
      // Le serveur n'avance que les actions prévues plus tard AUJOURD'HUI (fuseau
      // de chaque inscription), hors invitations et étapes d'attente, et
      // seulement pour ces séquences. Les relances des jours suivants gardent
      // leur date ; le moteur les envoie ensuite avec ses garde-fous.
      const { data, error } = await invokeEdgeFunction('process-sequences', {
        action: 'nudge_sequences',
        organization_id: organizationId,
        sequence_ids: missionSequenceIds,
      });
      const payload = data as { success?: boolean; advanced?: number; message?: string; error?: string } | null;
      if (error || !payload?.success) {
        throw new Error(payload?.message || error?.message || payload?.error || 'Réessayez dans un instant.');
      }
      const count = payload.advanced ?? 0;
      if (count > 0) {
        toast.success(`${count} action${count > 1 ? 's' : ''} avancée${count > 1 ? 's' : ''}`, {
          description: 'Elles partiront progressivement pendant vos heures d’envoi.',
        });
      } else {
        toast.info('Rien à avancer pour aujourd’hui.');
      }
    } catch (err) {
      console.error('Nudge sequences error:', err);
      toast.error('Les actions du jour n’ont pas pu être avancées', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setNudging(false);
    }
  };

  // Audit Opus 2026-05-07 : useCallback avec dep `projectId` pour que le
  // listener visibilitychange ne capture pas une closure périmée après un
  // changement de mission.
  const fetchSequences = React.useCallback(async () => {
    try {
      let seqQuery = supabase
        .from('outreach_sequences')
        .select('*')
        .order('created_at', { ascending: false }) as any;

      if (projectId) {
        // Affiche les séquences de la mission courante ET les séquences
        // partagées entre missions (project_id IS NULL).
        seqQuery = seqQuery.or(`project_id.eq.${projectId},project_id.is.null`);
      }

      const { data: seqData, error: seqError } = await seqQuery;

      if (seqError) throw seqError;

      const sequenceIds: string[] = seqData?.map(s => s.id) || [];

      // Étapes et inscriptions : toutes les pages, erreurs lues. Un échec ne
      // vide plus rien en silence : compteurs affichés « – » et éditeur
      // ouvert seulement après relecture des étapes.
      const [stepsResult, enrollResult] = await Promise.allSettled([
        sequenceIds.length === 0 ? Promise.resolve([]) : fetchAllPages((from, to) => supabase
          .from('sequence_steps')
          .select('*')
          .in('sequence_id', sequenceIds)
          .order('step_order', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)),
        // Compteurs calculés en base, une ligne par séquence, statut et raison
        // de pause (même résultat sous la RLS qu'une ligne par candidat).
        sequenceIds.length === 0 ? Promise.resolve([]) : fetchAllPages((from, to) => supabase
          .rpc('get_sequence_enrollment_counts', { p_sequence_ids: sequenceIds })
          .order('sequence_id', { ascending: true })
          .order('status', { ascending: true })
          .order('pause_reason', { ascending: true })
          .range(from, to)),
      ]);
      if (stepsResult.status === 'rejected') console.error('Error fetching sequence steps:', stepsResult.reason);
      if (enrollResult.status === 'rejected') console.error('Error fetching enrollment counts:', enrollResult.reason);
      const stepsData = stepsResult.status === 'fulfilled' ? stepsResult.value : [];
      const enrollData = enrollResult.status === 'fulfilled' ? enrollResult.value : [];

      const statsBySequence = new Map<string, SequenceWithStats['enrollments']>();
      for (const group of enrollData) {
        const n = Number(group.count) || 0;
        const stats = statsBySequence.get(group.sequence_id) ?? emptyEnrollmentStats();
        stats.total += n;
        if (group.status === 'active') stats.active += n;
        else if (group.status === 'completed') stats.completed += n;
        else if (group.status === 'replied') stats.replied += n;
        else if (group.status === 'paused') {
          stats.paused += n;
          const reason = group.pause_reason || 'manual';
          stats.pausedByReason[reason] = (stats.pausedByReason[reason] ?? 0) + n;
        }
        statsBySequence.set(group.sequence_id, stats);
      }

      const enriched: SequenceWithStats[] = (seqData || []).map((seq) => ({
        ...seq,
        steps: stepsData.filter(s => s.sequence_id === seq.id),
        enrollments: statsBySequence.get(seq.id) ?? emptyEnrollmentStats(),
      }));

      setSequences(enriched);
      setLoadError(false);
      setLoadErrorDetail(null);
      setDetailError({ steps: stepsResult.status === 'rejected', counts: enrollResult.status === 'rejected' });
      onDataChangedRef.current?.();
    } catch (err) {
      console.error('Error fetching sequences:', err);
      setLoadError(true);
      setLoadErrorDetail(err instanceof Error ? err.message : (err as { message?: string } | null)?.message ?? null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Refetch when component becomes visible (tab change or page visibility)
  useEffect(() => {
    fetchSequences();

    // Listen for visibility changes (when user returns to browser tab)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchSequences();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchSequences]);

  // Refetch when tab becomes visible within the app
  useEffect(() => {
    if (isVisible) {
      fetchSequences();
    }
  }, [isVisible, fetchSequences]);

  const handleRetry = async () => {
    setRetrying(true);
    await fetchSequences();
    setRetrying(false);
  };

  const handleSaveSequence = async (sequence: Sequence) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');
      if (!organizationId) throw new Error('Organisation introuvable : rechargez la page');

      // Payload de steps envoyé à la RPC transactionnelle `save_sequence_steps`.
      // On garde `id` = id CLIENT (= id DB pour un step existant, id généré pour
      // un nouveau) : la RPC s'en sert pour faire l'UPDATE in-place des steps
      // existants (préserve leurs exécutions planifiées) et pour remapper les
      // refs de branchement (if_true/false_goto, timeout_branch, next_step).
      const buildStepsPayload = () => sequence.steps.map(step => ({
        id: step.id,
        step_order: step.order,
        action_type: step.actionType,
        condition_type: step.conditionType,
        condition_value: step.conditionValue ?? null,
        delay_days: step.delayDays ?? 0,
        delay_hours: step.delayHours ?? 0,
        delay_minutes: step.delayMinutes ?? 0,
        preferred_hour_start: step.preferredHourStart ?? null,
        preferred_hour_end: step.preferredHourEnd ?? null,
        subject_template: step.subjectTemplate ?? null,
        message_template: step.messageTemplate ?? null,
        use_ai_personalization: step.useAiPersonalization ?? false,
        ai_tone: step.aiTone ?? null,
        timeout_days: step.timeoutDays ?? null,
        wait_for_event: implicitWaitEvent(step.actionType, step.waitForEvent),
        variant_group: step.variantGroup ?? null,
        variant_weight: step.variantWeight ?? 100,
        // '__end__' = sentinelle « Fin de séquence » du StepEditor : persistée
        // via ends_sequence (avant, elle devenait next_step_id=null = « auto »
        // et le moteur enchaînait quand même sur l'étape suivante).
        ends_sequence: step.nextStepId === '__end__',
        cc_emails: step.ccEmails ?? null,
        bcc_emails: step.bccEmails ?? null,
        include_unsubscribe: step.includeUnsubscribe ?? null,
        signature_id: step.signatureId ?? null,
        if_true_goto_step: step.ifTrueGotoStep ?? null,
        if_false_goto_step: step.ifFalseGotoStep ?? null,
        timeout_branch_step_id: step.timeoutBranchStepId ?? null,
        next_step_id: step.nextStepId === '__end__' ? null : (step.nextStepId ?? null),
      }));

      let targetSequenceId: string;
      // En-tête créé par cet enregistrement : supprimé si les étapes échouent,
      // sinon une séquence vide restait et le nouvel essai en créait une seconde.
      let createdSequenceId: string | null = null;
      // Type de chaque étape en base, par step_order : nomme une étape refusée
      // (STEP_HAS_HISTORY) que l'éditeur a renumérotée.
      const baseStepLabels = new Map<number, string>();
      // Sans droit d'envoi (plan gratuit) ou abonnement pas encore lu (décision 32),
      // une nouvelle séquence est créée désactivée.
      const createInactiveForPlan = !sequence.id && sequence.isActive && (!canSendSequences || planStateUnknown);

      if (sequence.id) {
        // Une étape en base que l'éditeur n'a jamais vue a été ajoutée par un
        // collègue depuis l'ouverture : la RPC la supprimerait, avec ses envois
        // prévus. On refuse avant toute écriture.
        const base = editorBaseStepIdsRef.current;
        const { data: currentSteps, error: currentStepsError } = await supabase
          .from('sequence_steps')
          .select('id, step_order, action_type')
          .eq('sequence_id', sequence.id);
        if (currentStepsError) {
          throw new Error('La séquence n’a pas pu être vérifiée avant l’enregistrement. Réessayez.');
        }
        const knownIds = base?.sequenceId === sequence.id ? base.stepIds : new Set<string>();
        if ((currentSteps || []).some(s => !knownIds.has(s.id))) {
          throw new Error(CONCURRENT_EDIT_MESSAGE);
        }
        for (const s of currentSteps || []) baseStepLabels.set(s.step_order, actionTypeLabel(s.action_type));

        // UPDATE de l'entête de séquence uniquement (les steps passent par la RPC).
        // is_active n'est pas réécrit : seul l'interrupteur de la liste l'écrit,
        // avec la mise en pause ou la reprise des candidats et le contrôle du
        // plan. L'éditeur renvoyait la valeur lue à l'ouverture, qui pouvait
        // éteindre l'interrupteur de candidats encore en cours d'envoi.
        const { error: updateError } = await supabase
          .from('outreach_sequences')
          .update({
            name: sequence.name,
            description: sequence.description,
            stop_conditions: sequence.stopConditions || null,
            sender_accounts: sequence.senderAccounts || null,
            rotation_mode: sequence.rotationMode || null,
            multi_sender_enabled: sequence.multiSenderEnabled || false,
          } as any)
          .eq('id', sequence.id);

        if (updateError) throw sequenceSaveError(updateError);
        targetSequenceId = sequence.id;
      } else {
        // CREATE de l'entête de séquence.
        const { data: newSeq, error: createError } = await supabase
          .from('outreach_sequences')
          .insert({
            name: sequence.name,
            description: sequence.description,
            is_active: sequence.isActive && !createInactiveForPlan,
            created_by: user.id,
            organization_id: organizationId,
            project_id: projectId || null,
            // Garde-fous et expéditeurs réglés dans l'éditeur : sans eux, le
            // moteur ignorait « Arrêter si un rendez-vous est pris » et la rotation.
            stop_conditions: sequence.stopConditions ?? DEFAULT_STOP_CONDITIONS,
            sender_accounts: sequence.senderAccounts || null,
            rotation_mode: sequence.rotationMode || null,
            multi_sender_enabled: sequence.multiSenderEnabled || false,
          } as any)
          .select()
          .single();

        if (createError) throw sequenceSaveError(createError);
        targetSequenceId = newSeq.id;
        createdSequenceId = newSeq.id;
      }

      // Sauvegarde transactionnelle des steps : UPDATE in-place des existants,
      // INSERT des nouveaux, DELETE des seuls steps réellement retirés. Ne
      // détruit PLUS les exécutions planifiées des enrollments actifs (bloquant B1).
      const { error: stepsError } = await supabase.rpc('save_sequence_steps', {
        p_sequence_id: targetSequenceId,
        p_steps: buildStepsPayload(),
      });

      if (stepsError) {
        if (createdSequenceId) {
          const { error: cleanupError } = await supabase
            .from('outreach_sequences')
            .delete()
            .eq('id', createdSequenceId);
          if (cleanupError) console.error('Error removing empty sequence after failed steps save:', cleanupError);
        }
        // Refus de supprimer une étape qui a un historique d'envoi (sinon ses
        // exécutions et son suivi e-mail disparaissaient, et une réponse à cet
        // e-mail n'était plus détectée).
        if (stepsError.hint === 'STEP_HAS_HISTORY' || stepsError.message?.includes('STEP_HAS_HISTORY')) {
          throw new Error(`Cette étape a déjà été envoyée à des candidats : elle ne peut pas être supprimée. Modifiez son contenu à la place.${blockedStepsNotice(stepsError.details, baseStepLabels)}`);
        }
        throw sequenceSaveError(stepsError);
      }

      if (sequence.id) {
        toast.success('Séquence mise à jour');
      } else {
        // Étape suivante du parcours : inscrire des candidats depuis le Sourcing.
        const enrollAction = projectId
          ? { label: 'Inscrire des candidats', onClick: () => navigate(`/missions/${projectId}?tab=sourcing`) }
          : undefined;
        // Créée désactivée faute de droit d'envoi : l'éditeur (qui reçoit
        // canSendSequences) l'annonce avec le lien vers les offres.
        if (!createInactiveForPlan) {
          toast.success('Séquence créée', {
            description: 'Sélectionnez ensuite vos candidats dans l’onglet Sourcing et cliquez sur Séquence.',
            ...(enrollAction ? { action: enrollAction } : {}),
          });
        } else if (canSendSequences) {
          // Abonnement pas encore lu : l'éditeur n'a rien annoncé.
          toast.warning('Séquence créée désactivée', {
            description: 'Votre abonnement n’était pas encore vérifié : activez-la depuis la liste des séquences.',
          });
        }
      }

      editorBaseStepIdsRef.current = null;
      fetchSequences();
      setShowBuilder(false);
      setEditingSequence(null);
    } catch (err) {
      // Relancé pour que SequenceBuilder.handleSave n'affiche pas
      // « Séquence enregistrée » et ne ferme pas le builder sur un échec
      // (les modifications étaient perdues).
      console.error('Error saving sequence:', err);
      throw err;
    }
  };

  // Désactivation : les inscriptions d'abord, l'interrupteur ensuite. Le moteur
  // ne lit que le statut des inscriptions, jamais outreach_sequences.is_active :
  // un interrupteur « désactivé » sur des inscriptions encore actives laissait
  // partir les messages. Les étapes prévues gardent leur date (le moteur ignore
  // celles d'une inscription en pause) et les attentes restent telles quelles.
  const deactivateSequence = async (sequenceId: string) => {
    setTogglingId(sequenceId);
    const pauseFailed = 'La séquence n’a pas pu être mise en pause. Aucun envoi n’a été arrêté. Réessayez.';
    let pausedCount = 0;
    try {
      const { data: paused, count, error: pauseError } = await supabase
        .from('sequence_enrollments')
        // Raison propre à la désactivation : la réactivation ne reprend
        // qu'elle, jamais une pause manuelle, de compte ou d'abonnement.
        .update({ status: 'paused', pause_reason: 'sequence_inactive' }, { count: 'exact' })
        .eq('sequence_id', sequenceId)
        .eq('status', 'active')
        .select('id');
      if (pauseError) {
        toast.error(pauseFailed);
        return;
      }
      pausedCount = count ?? paused?.length ?? 0;
      // D3 : recompte systématique. La RLS peut ne laisser mettre en pause
      // qu'une partie des candidats (collaborateur : ses seules inscriptions),
      // et d'autres ont pu être inscrits entre-temps. Tant qu'il en reste en
      // cours, la séquence n'est pas affichée désactivée.
      const { count: stillActive, error: countError } = await supabase
        .from('sequence_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('sequence_id', sequenceId)
        .eq('status', 'active');
      const pausedPart = pausedCount > 0
        ? `${candidats(pausedCount)} ${pausedCount > 1 ? 'sont' : 'est'} bien en pause. `
        : 'Aucun candidat n’a été mis en pause. ';
      if (countError) {
        toast.error('La séquence reste active', {
          description: `${pausedPart}Les candidats encore en cours n’ont pas pu être recomptés. Réessayez.`,
        });
        return;
      }
      const remainingActive = stillActive ?? 0;
      if (remainingActive > 0) {
        toast.error('La séquence reste active', {
          description: `${pausedPart}${candidats(remainingActive)} ${remainingActive > 1 ? 'restent' : 'reste'} en cours et ${remainingActive > 1 ? 'recevront' : 'recevra'} encore des messages : vous n’avez pas les droits sur ${remainingActive > 1 ? 'leurs inscriptions' : 'son inscription'}, ou ${remainingActive > 1 ? 'ils viennent' : 'il vient'} d’être ${remainingActive > 1 ? 'inscrits' : 'inscrit'}. Réessayez, ou demandez à un administrateur de désactiver la séquence.`,
          // Les candidats déjà mis en pause se reprennent depuis la liste des inscrits.
          ...(pausedCount > 0 ? enrollmentsPanelAction(sequenceId) : {}),
        });
        return;
      }

      const { data: updated, error: seqError } = await supabase
        .from('outreach_sequences')
        .update({ is_active: false })
        .eq('id', sequenceId)
        .select('id');
      if (seqError || !updated || updated.length === 0) {
        if (pausedCount > 0) {
          toast.error('La séquence n’a pas pu être désactivée', {
            description: `${candidats(pausedCount)} ${pausedCount > 1 ? 'sont' : 'est'} bien en pause et ne ${pausedCount > 1 ? 'recevront' : 'recevra'} plus de messages. Réessayez de désactiver la séquence.`,
          });
        } else if (seqError) {
          toast.error('La séquence n’a pas pu être désactivée. Réessayez.');
        } else {
          toast.error('Désactivation impossible', { description: 'Vous n’avez pas les droits sur cette séquence.' });
        }
        return;
      }

      setSequences(prev => prev.map(s => s.id === sequenceId ? { ...s, is_active: false } : s));
      toast.success(pausedCount > 0
        ? `Séquence désactivée. ${candidats(pausedCount)} mis en pause.`
        : 'Séquence désactivée. Aucun candidat n’était en cours.');
    } catch (err) {
      console.error('Error deactivating sequence:', err);
      toast.error(pausedCount > 0 ? 'La séquence n’a pas pu être désactivée. Réessayez.' : pauseFailed);
    } finally {
      setTogglingId(null);
      fetchSequences();
    }
  };

  // Réactivation : l'interrupteur d'abord (avec preuve d'écriture), puis la
  // reprise côté serveur des seuls candidats mis en pause par la séquence.
  // `otherMembers` : pauses de séquence de candidats inscrits par d'autres membres,
  // que le serveur ne reprend pas pour un collaborateur (D3), comptées au clic.
  const activateSequence = async (sequenceId: string, resumable: number, otherPaused: number, otherMembers = 0) => {
    setTogglingId(sequenceId);
    try {
      const { data: updated, error: seqError } = await supabase
        .from('outreach_sequences')
        .update({ is_active: true })
        .eq('id', sequenceId)
        .select('id');
      if (seqError) {
        toast.error('La séquence n’a pas pu être réactivée. Réessayez.');
        return;
      }
      if (!updated || updated.length === 0) {
        toast.error('Réactivation impossible', { description: 'Vous n’avez pas les droits sur cette séquence.' });
        return;
      }
      setSequences(prev => prev.map(s => s.id === sequenceId ? { ...s, is_active: true } : s));

      // Raisons variées (pause manuelle, compte, limite, candidat injoignable) :
      // toutes ne se reprennent pas depuis le panneau, qui dit quoi faire pour chacun.
      const stayPaused = otherPaused > 0
        ? `${candidats(otherPaused)} ${otherPaused > 1 ? 'restent' : 'reste'} en pause pour une autre raison (pause manuelle, compte déconnecté, limite d’envoi…) : la liste des inscrits indique comment ${otherPaused > 1 ? 'les' : 'le'} reprendre.`
        : undefined;
      // Contrat §8 : candidats d'autres membres laissés en pause (appelant collaborateur).
      const otherMembersNotice = (n: number) => (n > 0
        ? `${candidats(n)} ${n > 1 ? 'inscrits' : 'inscrit'} par d’autres membres ${n > 1 ? 'restent' : 'reste'} en pause : un administrateur ou le membre qui ${n > 1 ? 'les a inscrits peut les' : 'l’a inscrit peut le'} reprendre depuis la liste des inscrits.`
        : null);

      if (resumable === 0) {
        const othersText = otherMembersNotice(otherMembers);
        if (othersText) {
          toast.warning('Séquence réactivée', {
            description: [othersText, stayPaused].filter(Boolean).join(' '),
            ...enrollmentsPanelAction(sequenceId),
          });
        } else {
          toast.success('Séquence réactivée', stayPaused ? { description: stayPaused, ...enrollmentsPanelAction(sequenceId) } : undefined);
        }
        return;
      }

      // Le serveur ne reprend que les pauses de séquence (désactivation,
      // auto-pause du moteur), garde la date de chaque étape en attente (au plus
      // tôt dans une minute), ne transforme jamais une attente (acceptation,
      // réponse) en envoi, et refuse un compte LinkedIn qui n'est plus relié.
      // Il s'arrête avant la limite de temps d'un appel et compte le reste dans
      // `remaining` : on le rappelle tant qu'il en reste et qu'il progresse,
      // puis un seul bilan.
      // Un candidat resté en pause est relu par l'appel suivant : son dernier
      // résultat fait foi, il n'est compté qu'une fois.
      const outcomes = new Map<string, keyof ResumeCounts>();
      const countsWithoutResults: Required<ResumeCounts> = { resumed: 0, nothing_to_resume: 0, account_unlinked: 0, not_paused: 0, error: 0 };
      let remaining = 0;
      // Compte du serveur (contrat §8) quand il le donne ; sinon celui fait au clic.
      let serverOtherMembers: number | null = null;
      for (let round = 0; round < MAX_RESUME_ROUNDS; round += 1) {
        if (round > 0) {
          toast.loading(`Reprise en cours : ${candidats(remaining)} encore à reprendre…`, { id: `resume-${sequenceId}` });
        }
        const { data, error } = await invokeEdgeFunction('process-sequences', {
          action: 'resume_enrollments',
          sequence_id: sequenceId,
          pause_reasons: SEQUENCE_LEVEL_PAUSE_REASONS,
        });
        const payload = data as ResumeResponse | null;
        if (error || !payload?.success || !payload.counts) {
          if (round > 0) break; // Bilan des appels réussis ; le reste est signalé plus bas.
          // L'interrupteur reste actif : les candidats encore en pause ne
          // reçoivent rien, rien n'est envoyé à l'insu de l'utilisateur.
          toast.error('La séquence est réactivée, mais les candidats en pause n’ont pas pu reprendre', {
            description: `${payload?.message || error?.message || ''} Désactivez puis réactivez la séquence pour réessayer, ou reprenez-les depuis la liste des inscrits.`.trim(),
            ...enrollmentsPanelAction(sequenceId),
          });
          return;
        }
        if (serverOtherMembers === null && typeof payload.other_members === 'number') {
          serverOtherMembers = Math.max(0, payload.other_members);
        }
        if (Array.isArray(payload.results)) {
          for (const r of payload.results) outcomes.set(r.enrollment_id, r.outcome);
        } else {
          for (const key of Object.keys(countsWithoutResults) as Array<keyof ResumeCounts>) {
            countsWithoutResults[key] += payload.counts[key] ?? 0;
          }
        }
        const previous = remaining;
        remaining = payload.remaining ?? 0;
        // Plus rien à traiter, ou aucun progrès depuis l'appel précédent.
        if (remaining === 0 || (round > 0 && remaining >= previous)) break;
      }
      toast.dismiss(`resume-${sequenceId}`);

      const tally = { ...countsWithoutResults };
      for (const outcome of outcomes.values()) {
        if (outcome in tally) tally[outcome] += 1;
      }
      const resumed = tally.resumed;
      const failed = tally.error;
      const unlinked = tally.account_unlinked;
      const nothing = tally.nothing_to_resume;
      const othersLeft = serverOtherMembers ?? otherMembers;

      // Filet, tous rôles : pauses de séquence encore en place après la reprise.
      // Celles que le bilan n'explique pas (compte non relié, erreur, reste à
      // traiter, autres membres) interdisent un succès : il n'y a pas de preuve.
      const { count: stillPaused, error: recountError } = await supabase
        .from('sequence_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('sequence_id', sequenceId)
        .eq('status', 'paused')
        .in('pause_reason', SEQUENCE_LEVEL_PAUSE_REASONS);
      if (recountError) console.error('Error recounting paused enrollments after resume:', recountError);
      const unexplained = recountError ? 0 : Math.max(0, (stillPaused ?? 0) - (unlinked + failed + remaining + othersLeft));

      const details = [
        unlinked > 0 ? `${candidats(unlinked)} ${unlinked > 1 ? 'restent' : 'reste'} en pause : compte LinkedIn qui n’est plus relié.` : null,
        nothing > 0 ? `${candidats(nothing)} ${nothing > 1 ? 'n’avaient' : 'n’avait'} plus d’étape à envoyer.` : null,
        remaining > 0 ? `${candidats(remaining)} ${remaining > 1 ? 'n’ont' : 'n’a'} pas encore été ${remaining > 1 ? 'traités' : 'traité'} : reprenez-les depuis la liste des inscrits.` : null,
        otherMembersNotice(othersLeft),
        unexplained > 0 ? `${candidats(unexplained)} ${unexplained > 1 ? 'restent' : 'reste'} en pause sans avoir été repris : la liste des inscrits indique comment ${unexplained > 1 ? 'les' : 'le'} reprendre.` : null,
        recountError ? 'Les candidats encore en pause n’ont pas pu être recomptés : vérifiez la liste des inscrits.' : null,
        stayPaused ?? null,
      ].filter((d): d is string => !!d).join(' ');
      const notAllResumed = othersLeft > 0 || unexplained > 0 || !!recountError;
      // Candidats restés en pause : la liste des inscrits permet de les reprendre.
      const panelAction = (remaining > 0 || failed > 0 || unlinked > 0 || stayPaused || notAllResumed) ? enrollmentsPanelAction(sequenceId) : {};

      if (remaining > 0 && failed === 0) {
        toast.warning(`Séquence réactivée : ${candidats(resumed)} repris pour l’instant`, { description: details, ...panelAction });
      } else if (failed > 0) {
        toast.warning(`Séquence réactivée : ${candidats(resumed)} repris, ${failed} en erreur`, {
          description: `${details} Reprenez les candidats en erreur depuis la liste des inscrits.`.trim(),
          ...panelAction,
        });
      } else if (notAllResumed) {
        toast.warning(`Séquence réactivée : ${candidats(resumed)} repris`, { description: details, ...panelAction });
      } else {
        toast.success(`Séquence réactivée. ${candidats(resumed)} repris.`, details ? { description: details, ...panelAction } : undefined);
      }
    } catch (err) {
      console.error('Error activating sequence:', err);
      toast.dismiss(`resume-${sequenceId}`);
      toast.error('La réactivation a échoué. Réessayez.');
    } finally {
      setTogglingId(null);
      fetchSequences();
    }
  };

  // Clic sur un interrupteur : confirmation avant de désactiver une séquence
  // qui a des candidats en cours, ou de réactiver une séquence qui a des
  // candidats à reprendre.
  const requestToggle = async (seq: SequenceWithStats) => {
    if (togglingId) return;
    // Défense : l'interrupteur n'est rendu que si canEdit.
    if (!canEdit(seq)) {
      toast.error('Modification impossible', { description: readOnlyHint(seq) });
      return;
    }
    if (deactivationLocked(seq)) {
      toast.error('Désactivation réservée', { description: COLLABORATOR_DEACTIVATION_HINT });
      return;
    }
    if (seq.is_active) {
      // Candidats en cours recomptés en base au clic : le compteur affiché peut
      // être périmé ou indisponible, et un 0 faux désactivait sans confirmation.
      setTogglingId(seq.id);
      const { count: activeNow, error: countError } = await supabase
        .from('sequence_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('sequence_id', seq.id)
        .eq('status', 'active');
      setTogglingId(null);
      if (countError) {
        console.error('Error counting active enrollments:', countError);
        toast.error('Les candidats en cours n’ont pas pu être comptés. Réessayez.');
        return;
      }
      if ((activeNow ?? 0) > 0) {
        setToggleConfirm({ id: seq.id, nextActive: false, activeCount: activeNow ?? 0, shared: !seq.project_id });
        return;
      }
      await deactivateSequence(seq.id);
      return;
    }
    // Activer (pas désactiver) exige un plan qui autorise l'envoi de séquences,
    // donc un état d'abonnement lu (décision 32).
    if (planStateUnknown) {
      if (isPlanLoadError) {
        void refetchPlan();
        toast.error(PLAN_STATE_UNREADABLE_MESSAGE);
      } else {
        toast.info(PLAN_STATE_LOADING_MESSAGE);
      }
      return;
    }
    if (!canSendSequences) {
      toast.error("L'envoi de séquences nécessite un abonnement", {
        action: { label: 'Voir les plans', onClick: () => navigate('/pricing') },
      });
      return;
    }
    setTogglingId(seq.id);
    let resumable = 0;
    let otherPaused = 0;
    let otherMembers = 0;
    try {
      const pausedCount = (withReason: boolean, createdBy: string | null = null) => {
        let q = supabase
          .from('sequence_enrollments')
          .select('id', { count: 'exact', head: true })
          .eq('sequence_id', seq.id)
          .eq('status', 'paused');
        if (withReason) q = q.in('pause_reason', SEQUENCE_LEVEL_PAUSE_REASONS);
        if (createdBy) q = q.eq('created_by', createdBy);
        return q;
      };
      // D3 : pour un collaborateur, le serveur ne reprend que les candidats qu'il
      // a inscrits. Ceux des autres membres (visibles sur sa séquence) restent
      // en pause : comptés à part pour ne pas les annoncer comme repris.
      const ownerFilter = isCollaborator ? userId : null;
      const [resumableRes, pausedRes, ownRes] = await Promise.all([
        pausedCount(true),
        pausedCount(false),
        ownerFilter ? pausedCount(true, ownerFilter) : Promise.resolve(null),
      ]);
      if (resumableRes.error || pausedRes.error || ownRes?.error) throw resumableRes.error || pausedRes.error || ownRes?.error;
      const sequencePaused = resumableRes.count ?? 0;
      resumable = ownRes ? Math.min(sequencePaused, ownRes.count ?? 0) : sequencePaused;
      otherMembers = sequencePaused - resumable;
      otherPaused = Math.max(0, (pausedRes.count ?? 0) - sequencePaused);
    } catch (err) {
      console.error('Error counting paused enrollments:', err);
      toast.error('La séquence n’a pas pu être réactivée. Réessayez.');
      setTogglingId(null);
      return;
    }
    setTogglingId(null);
    if (resumable > 0) {
      setActivateConfirm({ id: seq.id, resumable, otherPaused, otherMembers });
      return;
    }
    await activateSequence(seq.id, 0, otherPaused, otherMembers);
  };

  const handleDelete = async (sequenceId: string) => {
    try {
      // .select('id') : un refus d'accès supprime 0 ligne sans erreur.
      const { data: deleted, error } = await supabase
        .from('outreach_sequences')
        .delete()
        .eq('id', sequenceId)
        .select('id');

      if (error) throw error;
      if (!deleted || deleted.length === 0) {
        toast.error('Suppression impossible', { description: 'Vous n’avez pas les droits sur cette séquence.' });
        return;
      }

      setSequences(prev => prev.filter(s => s.id !== sequenceId));
      toast.success('Séquence supprimée');
      // Les chiffres de la mission (inscrits retirés avec la séquence) suivent.
      void fetchSequences();
    } catch (err) {
      console.error('Error deleting sequence:', err);
      toast.error('Impossible de supprimer la séquence', { description: 'Réessayez dans un instant.' });
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleDuplicate = async (seq: SequenceWithStats) => {
    // Séquence d'une autre organisation : ses étapes sont illisibles (RLS) et
    // ses expéditeurs ne sont pas les miens, la copie ne pourrait rien envoyer.
    // Double clic : une seule copie.
    if (!canManage(seq) || duplicatingRef.current) return;
    duplicatingRef.current = true;
    setDuplicatingId(seq.id);
    // En-tête créé : supprimé si la copie des étapes échoue (sinon une
    // séquence vide restait et un nouvel essai en créait une seconde).
    let createdCopyId: string | null = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');
      if (!organizationId) throw new Error('Organisation introuvable : rechargez la page');

      // 1. Charge les steps réelles depuis la DB
      const { data: steps, error: stepsErr } = await (supabase
        .from('sequence_steps')
        .select('*')
        .eq('sequence_id', seq.id)
        .order('step_order', { ascending: true }) as any);
      if (stepsErr) throw sequenceSaveError(stepsErr);

      // 2. Crée la nouvelle séquence avec un nom suffixé "(copie)"
      const { data: newSeq, error: seqErr } = await (supabase
        .from('outreach_sequences')
        .insert({
          name: `${seq.name} (copie)`,
          description: seq.description,
          is_active: false, // toujours inactive par défaut, l'user choisit quand activer
          created_by: user.id,
          organization_id: organizationId,
          ...(projectId ? { project_id: projectId } : {}),
          // Garde-fous et expéditeurs : la copie doit s'arrêter et tourner
          // entre comptes comme l'originale.
          stop_conditions: seq.stop_conditions ?? null,
          sender_accounts: seq.sender_accounts ?? null,
          rotation_mode: seq.rotation_mode ?? null,
          multi_sender_enabled: seq.multi_sender_enabled ?? false,
        } as any)
        .select()
        .single() as any);
      if (seqErr || !newSeq) throw sequenceSaveError(seqErr);
      createdCopyId = newSeq.id;

      // 3. Re-crée les steps via la RPC transactionnelle. On passe les ANCIENS
      // ids comme ids « client » : n'appartenant pas à la nouvelle séquence,
      // la RPC insère des copies et REMAPPE les refs de branchement
      // (next_step_id, if_true/false_goto, timeout_branch) vers les nouveaux
      // ids. L'ancien insert brut copiait ces refs telles quelles → la copie
      // exécutait les steps de la séquence SOURCE (audit 2026-07, Builder H1).
      if (steps && steps.length > 0) {
        const payload = (steps as any[]).map((s: any) => ({
          id: s.id,
          step_order: s.step_order,
          action_type: s.action_type,
          condition_type: s.condition_type,
          condition_value: s.condition_value ?? null,
          delay_days: s.delay_days ?? 0,
          delay_hours: s.delay_hours ?? 0,
          delay_minutes: s.delay_minutes ?? 0,
          preferred_hour_start: s.preferred_hour_start ?? null,
          preferred_hour_end: s.preferred_hour_end ?? null,
          subject_template: s.subject_template ?? null,
          message_template: s.message_template ?? null,
          use_ai_personalization: s.use_ai_personalization ?? false,
          ai_tone: s.ai_tone ?? null,
          // Même délai par défaut qu'à l'ouverture dans l'éditeur : une attente
          // sans délai attendait sans fin dans la copie (le moteur ne l'applique
          // qu'aux attentes sans événement).
          timeout_days: s.timeout_days ?? (TIMEOUT_REQUIRED_ACTIONS.includes(s.action_type) ? DEFAULT_WAIT_TIMEOUT_DAYS : null),
          wait_for_event: implicitWaitEvent(s.action_type, s.wait_for_event),
          variant_group: s.variant_group ?? null,
          variant_weight: s.variant_weight ?? 100,
          // Mêmes clés que buildStepsPayload : sans elles, la RPC remettait la
          // fin de séquence à false et les options e-mail (dont le lien de
          // désinscription) à NULL dans la copie.
          ends_sequence: s.ends_sequence ?? false,
          cc_emails: s.cc_emails ?? null,
          bcc_emails: s.bcc_emails ?? null,
          include_unsubscribe: s.include_unsubscribe ?? null,
          signature_id: s.signature_id ?? null,
          if_true_goto_step: s.if_true_goto_step ?? null,
          if_false_goto_step: s.if_false_goto_step ?? null,
          timeout_branch_step_id: s.timeout_branch_step_id ?? null,
          next_step_id: s.next_step_id ?? null,
        }));
        const { error: stepsCreateErr } = await supabase.rpc('save_sequence_steps', {
          p_sequence_id: newSeq.id,
          p_steps: payload,
        });
        if (stepsCreateErr) throw sequenceSaveError(stepsCreateErr);
      }
      createdCopyId = null;

      toast.success(`Séquence dupliquée : "${newSeq.name}"`, {
        description: 'La copie reste inactive tant que vous ne l’activez pas.',
      });
      // Refresh la liste
      await fetchSequences();
    } catch (err) {
      console.error('Error duplicating sequence:', err);
      if (createdCopyId) {
        const { error: cleanupError } = await supabase
          .from('outreach_sequences')
          .delete()
          .eq('id', createdCopyId);
        if (cleanupError) console.error('Error removing empty copy after failed steps copy:', cleanupError);
      }
      toast.error('Impossible de dupliquer la séquence', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      duplicatingRef.current = false;
      setDuplicatingId(null);
    }
  };

  const handleEdit = async (seq: SequenceWithStats) => {
    // Contrat §8 : l'éditeur ne s'ouvre pas sur une séquence non modifiable. Un
    // collaborateur y réécrivait les messages d'un collègue, puis tout était
    // refusé à l'enregistrement (SEQUENCE_NOT_OWNER), sans brouillon gardé.
    if (!canEdit(seq)) {
      toast.error('Modification impossible', { description: readOnlyHint(seq) });
      return;
    }
    // Étapes relues en base à l'ouverture : la liste peut dater de l'arrivée
    // sur la page (étape ajoutée depuis par un collègue), ou ne pas avoir pu
    // les charger. Sans elles, l'éditeur ne s'ouvre pas : un enregistrement
    // depuis un éditeur vide effaçait les étapes réelles et leurs envois prévus.
    const [{ data: freshSteps, error: stepsError }, { count: activeNow, error: activeError }] = await Promise.all([
      supabase
        .from('sequence_steps')
        .select('*')
        .eq('sequence_id', seq.id)
        .order('step_order', { ascending: true }),
      // Candidats en cours, pour que l'éditeur annonce l'effet des modifications.
      supabase
        .from('sequence_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('sequence_id', seq.id)
        .eq('status', 'active'),
    ]);
    if (activeError) console.error('Error counting active enrollments for edit:', activeError);
    setEditingActiveCount(activeError ? undefined : (activeNow ?? 0));
    if (stepsError) {
      console.error('Error loading sequence steps for edit:', stepsError);
      toast.error('Impossible de charger le détail de cette séquence', {
        description: 'Vérifiez votre connexion puis réessayez.',
      });
      return;
    }
    // Même forme que les étapes de la liste (colonnes récentes absentes des types générés).
    const steps: SequenceWithStats['steps'] = freshSteps || [];
    editorBaseStepIdsRef.current = { sequenceId: seq.id, stepIds: new Set(steps.map(s => s.id)) };

    const sequence: Sequence = {
      id: seq.id,
      name: seq.name,
      description: seq.description || undefined,
      isActive: seq.is_active,
      // Recharger les réglages d'en-tête : sans eux, l'éditeur affichait les
      // valeurs par défaut et l'enregistrement effaçait ceux de la séquence.
      stopConditions: { ...DEFAULT_STOP_CONDITIONS, ...(seq.stop_conditions ?? {}) },
      senderAccounts: seq.sender_accounts ?? [],
      rotationMode: seq.rotation_mode ?? 'round_robin',
      multiSenderEnabled: !!seq.multi_sender_enabled,
      // Même lecture que le choix de modèle (rowToSequenceStep) : variantes,
      // options e-mail, renvois, « Fin de séquence » et « Si timeout » déduit de
      // l'étape de repli. S'y ajoutent les valeurs que l'éditeur affiche par
      // défaut quand la colonne est vide (seuil de score, délai d'attente).
      steps: steps.map(s => ({
        ...rowToSequenceStep(s),
        conditionValue: s.condition_value?.trim()
          ? s.condition_value
          : (s.condition_type === 'if_score_above' ? DEFAULT_SCORE_THRESHOLD : undefined),
        timeoutDays: s.timeout_days
          ?? (TIMEOUT_REQUIRED_ACTIONS.includes(s.action_type) ? DEFAULT_WAIT_TIMEOUT_DAYS : undefined),
      })),
    };
    setEditingSequence(sequence);
    setShowBuilder(true);
  };

  const handleCreateNew = () => {
    setShowTemplateSelector(true);
  };

  const handleSelectBlank = () => {
    setShowTemplateSelector(false);
    setEditingActiveCount(0);
    setEditingSequence(null);
    setShowBuilder(true);
  };

  const handleSelectTemplate = (sequence: Sequence) => {
    setShowTemplateSelector(false);
    setEditingActiveCount(0);
    setEditingSequence(sequence);
    setShowBuilder(true);
  };

  const filteredSequences = sequences.filter(seq =>
    seq.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Envois bloqués, par cause : visibles sans ouvrir chaque séquence.
  const pausedFor = (reason: string) =>
    sequences.reduce((sum, seq) => sum + (seq.enrollments.pausedByReason[reason] ?? 0), 0);
  const disconnectedPaused = pausedFor('account_disconnected');
  const subscriptionPaused = pausedFor('subscription_required');
  const autoPausedSequences = sequences.filter(seq => (seq.enrollments.pausedByReason.auto_paused ?? 0) > 0);

  // Dans une mission : l'onglet Sourcing, où l'on sélectionne les candidats à inscrire.
  const goToSourcing = () => {
    if (projectId) navigate(`/missions/${projectId}?tab=sourcing`);
  };

  // Compteur affiché « – » quand les inscriptions n'ont pas pu être lues.
  const countLabel = (n: number) => (detailError.counts ? '–' : String(n));

  const deleteTarget = deleteConfirmId ? sequences.find(s => s.id === deleteConfirmId) : undefined;

  // Aide de « Envoyer les actions du jour » : ce qui part et ce qui ne bouge pas.
  const nudgeHelp = missionSequenceIds.length === 0
    ? 'Aucune séquence de cette mission à avancer.'
    : 'Avance à maintenant les actions prévues plus tard aujourd’hui pour cette mission, sauf les invitations LinkedIn. Elles partent progressivement pendant vos heures d’envoi.';

  // ── Une ligne par séquence, la même sur téléphone et sur ordinateur (revue design D-24, D-26) ──
  const renderRow = (seq: SequenceWithStats) => {
    const channels = sequenceChannels(seq.steps);
    // Offre sans envoi, abonnement lu : l'interrupteur reste cliquable (il dit
    // pourquoi) et renvoie au bandeau de l'offre.
    const activationBlocked = canEdit(seq) && !seq.is_active && !canSendSequences && !planStateUnknown;
    const createdAt = new Date(seq.created_at);
    const { total, active, replied, completed } = seq.enrollments;

    return (
      <li
        key={seq.id}
        className={cn('grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-4 py-3 transition-colors duration-150 hover:bg-accent/40', wide && `lg:items-center lg:gap-x-4 ${ROW_GRID}`)}
      >
        {/* Activation (revue design D-25). D3 : interrupteur verrouillé d'un
            collaborateur laissé cliquable (aria-disabled) : requestToggle dit
            pourquoi, au clic comme au toucher. La zone de toucher fait 44 px
            sur téléphone. */}
        <div className="flex h-6 items-center gap-1">
          {canEdit(seq) ? (
            <Switch
              checked={seq.is_active}
              disabled={togglingId === seq.id || activationWaitsForPlan(seq)}
              aria-disabled={deactivationLocked(seq) || undefined}
              title={deactivationLocked(seq) ? COLLABORATOR_DEACTIVATION_HINT : activationWaitsForPlan(seq) ? PLAN_STATE_LOADING_MESSAGE : undefined}
              onCheckedChange={() => { void requestToggle(seq); }}
              className={cn("relative after:absolute after:-inset-2.5 lg:after:hidden", deactivationLocked(seq) && "opacity-60")}
              aria-label={seq.is_active ? `Mettre en pause la séquence ${seq.name}` : `Activer la séquence ${seq.name}`}
              aria-describedby={activationBlocked ? planNoticeId : undefined}
            />
          ) : (
            <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
          {activationBlocked && <Lock className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground', wide && 'lg:hidden')} aria-hidden="true" />}
        </div>

        {/* Nom, canaux, portée, description */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {channels.length > 0 && (
              <span className="flex shrink-0 items-center gap-1">
                {channels.map(channel => <ChannelIcon key={channel} channel={channel} size="sm" />)}
              </span>
            )}
            <p className="min-w-0 break-words text-sm font-medium text-foreground">{seq.name}</p>
            {/* Séquence rattachée à aucune mission : elle apparaît et envoie dans
                toutes les missions (ce n'est pas un modèle). */}
            {!seq.project_id && (
              <Badge variant="muted" title="Séquence visible et utilisée dans toutes vos missions">Partagée entre missions</Badge>
            )}
            {/* Séquence d'une autre organisation, ou d'un collègue pour un collaborateur. */}
            {!canEdit(seq) && (
              <Badge variant="outline" title={readOnlyHint(seq)}>Lecture seule</Badge>
            )}
          </div>
          {seq.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{seq.description}</p>}
        </div>

        {/* Inscrits, répartition, date, actions : sous le nom sur téléphone, en colonnes à partir de 1 024 px */}
        <div className={cn('col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1.5', wide && 'lg:contents')}>
          <div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setEnrollmentsPanelSequence(seq)}
              title={detailError.counts ? 'Compteurs indisponibles : cliquez pour voir les candidats inscrits' : undefined}
              className="-ml-2.5 gap-1.5 text-foreground max-md:h-11"
            >
              <Users aria-hidden="true" />
              {detailError.counts ? `Inscrits : ${countLabel(total)}` : total > 0 ? plural(total, 'inscrit') : 'Aucun inscrit'}
              <span className="sr-only">. Voir les candidats inscrits à la séquence {seq.name}</span>
            </Button>
          </div>
          {/* Répartition réelle par état d'inscription */}
          <div className={cn('flex flex-wrap items-center gap-1', wide && 'lg:justify-center')}>
            {detailError.counts ? (
              <span className="text-xs text-muted-foreground" title="Compteurs indisponibles">–</span>
            ) : total > 0 ? (
              <>
                {active > 0 && <Badge variant={ENROLLMENT_STATUSES.active.tone}>{active} en cours</Badge>}
                {seq.enrollments.paused > 0 && (
                  <Badge variant={ENROLLMENT_STATUSES.paused.tone} title="Candidats en pause : ouvrez la liste des inscrits pour voir la raison">
                    {seq.enrollments.paused} en pause
                  </Badge>
                )}
                {replied > 0 && <Badge variant={ENROLLMENT_STATUSES.replied.tone}>{replied} {replied > 1 ? 'ont répondu' : 'a répondu'}</Badge>}
                {completed > 0 && (
                  <Badge variant={ENROLLMENT_STATUSES.completed.tone} title="Candidats arrivés au bout de la séquence sans répondre">
                    {plural(completed, 'terminée')}
                  </Badge>
                )}
              </>
            ) : projectId ? (
              // Étape suivante du parcours : inscrire des candidats depuis le Sourcing.
              <Button type="button" variant="link" size="xs" onClick={goToSourcing} className="h-auto px-0 max-md:min-h-11">
                Inscrire des candidats
              </Button>
            ) : null}
          </div>
          <p className={cn('text-xs text-muted-foreground', wide && 'lg:text-center')}>
            <span className={wide ? 'lg:sr-only' : undefined}>Créée </span>
            <time dateTime={seq.created_at} title={format(createdAt, "d MMMM yyyy 'à' HH:mm", { locale: fr })}>
              {timeAgo(createdAt)}
            </time>
          </p>
          <div className={cn('ml-auto', wide && 'lg:ml-0 lg:justify-self-end')}>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11"
                      aria-label={`Actions de la séquence ${seq.name}`}
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Actions</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                {/* Contrat §8 : « Modifier » et « Supprimer » sous canEdit. */}
                {canEdit(seq) && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEdit(seq); }}>
                    <span className="flex items-center gap-2 max-md:min-h-8">
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      Modifier
                    </span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); setAnalyticsSequence(seq); }}
                  aria-label={`Voir les statistiques de la séquence ${seq.name}`}
                >
                  <span className="flex items-center gap-2 max-md:min-h-8">
                    <BarChart3 className="h-4 w-4" aria-hidden="true" />
                    Statistiques
                  </span>
                </DropdownMenuItem>
                {/* Séquence d'une autre organisation : étapes illisibles et
                    expéditeurs d'un autre compte, la copie ne pourrait rien envoyer. */}
                {canManage(seq) && (
                  <DropdownMenuItem disabled={!!duplicatingId} onClick={(e) => { e.stopPropagation(); handleDuplicate(seq); }}>
                    <span className="flex items-center gap-2 max-md:min-h-8">
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      {duplicatingId === seq.id ? 'Duplication…' : 'Dupliquer'}
                    </span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSaveTemplateSeq(seq); }}>
                  <span className="flex items-center gap-2 max-md:min-h-8">
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    Enregistrer comme modèle
                  </span>
                </DropdownMenuItem>
                {canEdit(seq) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(seq.id); }}
                    >
                      <span className="flex items-center gap-2 max-md:min-h-8">
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Supprimer
                      </span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </li>
    );
  };

  const renderBody = () => {
    // Un seul chargement, en forme de tableau, sans phrase simulée (revue design D-22).
    if (loading) {
      return (
        <div role="status" aria-label="Chargement des séquences" className="overflow-hidden rounded-xl border border-border bg-card">
          <div className={cn('hidden border-b border-border bg-muted/40 px-4 py-2.5', wide && 'lg:block')}>
            <Skeleton className="h-3 w-40" />
          </div>
          {[0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-b-0">
              <Skeleton className="h-6 w-11 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className={cn('hidden h-7 w-24', wide && 'lg:block')} />
              <Skeleton className={cn('hidden h-5 w-36', wide && 'lg:block')} />
            </div>
          ))}
        </div>
      );
    }

    return (
      <>
        {/* Une panne s'affiche comme une panne, jamais comme l'accueil « Créer ma
            première séquence » (on croyait tout supprimé). */}
        {loadError && sequences.length === 0 ? (
          <ErrorState
            title="Impossible de charger vos séquences"
            description="Vérifiez votre connexion puis réessayez. Vos séquences ne sont pas perdues."
            detail={loadErrorDetail}
            onRetry={handleRetry}
            retrying={retrying}
          />
        ) : sequences.length === 0 ? (
          <EmptyState
            illustration="envoi"
            title="Aucune séquence pour cette mission"
            description={
              <>
                Une séquence contacte vos candidats en plusieurs étapes : invitation, message, relance. L'IA Konekt peut
                adapter chaque message au profil et au poste.
                <span className="mt-1 block">Ensuite, sélectionnez vos candidats dans l’onglet Sourcing et cliquez sur Séquence.</span>
              </>
            }
            action={
              <Button type="button" variant="outline" size="sm" onClick={handleCreateNew} className="max-md:h-11">
                <Plus aria-hidden="true" />
                Créer ma première séquence
              </Button>
            }
          />
        ) : (
          <>
            {/* Échec d'actualisation alors qu'une liste est déjà affichée */}
            {loadError && (
              <Banner tone="warning" icon={AlertTriangle} role="alert" className="rounded-lg border" action={
                <Button type="button" variant="link" onClick={handleRetry} loading={retrying} className={`h-auto p-0 ${bannerActionClass}`}>
                  Réessayer
                </Button>
              }>
                La liste n'a pas pu être actualisée : elle date du dernier chargement.
              </Banner>
            )}

            {/* Lectures secondaires en échec : compteurs « – », éditeur relu à l'ouverture */}
            {!loadError && (detailError.steps || detailError.counts) && (
              <Banner tone="warning" icon={AlertTriangle} role="alert" className="rounded-lg border" action={
                <Button type="button" variant="link" onClick={handleRetry} loading={retrying} className={`h-auto p-0 ${bannerActionClass}`}>
                  Réessayer
                </Button>
              }>
                Impossible de charger le détail des séquences.
              </Banner>
            )}

            {/* Envois bloqués : une alerte par cause, avec l'action qui débloque */}
            {(disconnectedPaused > 0 || subscriptionPaused > 0 || autoPausedSequences.length > 0) && (
              <div className="space-y-2">
                {disconnectedPaused > 0 && (
                  <Banner
                    tone="warning"
                    icon={AlertTriangle}
                    className="rounded-lg border"
                    action={<Link to="/settings/account/connections" className={bannerActionClass}>Reconnecter</Link>}
                  >
                    {candidats(disconnectedPaused)} en pause : compte LinkedIn déconnecté.
                  </Banner>
                )}
                {subscriptionPaused > 0 && (
                  <Banner
                    tone="warning"
                    icon={Lock}
                    className="rounded-lg border"
                    action={<Link to="/pricing" className={bannerActionClass}>Voir les offres</Link>}
                  >
                    Envois suspendus : abonnement requis.
                  </Banner>
                )}
                {autoPausedSequences.map(seq => (
                  <Banner
                    key={`auto-paused-${seq.id}`}
                    tone="danger"
                    icon={AlertTriangle}
                    className="rounded-lg border"
                    action={
                      <Button type="button" variant="link" onClick={() => setEnrollmentsPanelSequence(seq)} className={`h-auto p-0 ${bannerActionClass}`}>
                        Voir les erreurs
                      </Button>
                    }
                  >
                    Séquence « {seq.name} » arrêtée automatiquement après trop d’échecs.
                  </Banner>
                ))}
              </div>
            )}

            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                aria-label="Rechercher une séquence"
                placeholder="Rechercher une séquence…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {filteredSequences.length === 0 ? (
              <EmptyState
                variant="compact"
                icon={Search}
                title={`Aucune séquence ne correspond à « ${searchQuery.trim()} »`}
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => setSearchQuery('')} className="max-md:h-11">
                    Effacer la recherche
                  </Button>
                }
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                {/* En-tête de colonnes, à partir de 1 024 px ; chaque cellule se lit aussi seule */}
                <div
                  aria-hidden="true"
                  className={cn('hidden gap-4 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground', wide && `lg:grid ${ROW_GRID}`)}
                >
                  <div>Active</div>
                  <div>Séquence</div>
                  <div>Inscrits</div>
                  <div className="text-center">Répartition</div>
                  <div className="text-center">Créée</div>
                  <div />
                </div>
                <ul className="divide-y divide-border" aria-label="Séquences">
                  {filteredSequences.map(renderRow)}
                </ul>
              </div>
            )}
          </>
        )}
      </>
    );
  };

  return (
    <section className="space-y-4" aria-labelledby="sequences-title">
      {/* En-tête et barre d'outils (revue design D-23) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sequences-title" className="text-base font-semibold text-foreground">Séquences</h2>
        <div className="flex flex-wrap items-center gap-2">
          {!isMobile && (
            <>
              {/* Enveloppe : un bouton grisé ne reçoit pas le survol, l'aide reste lisible. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setNudgeConfirmOpen(true)}
                      disabled={nudging || missionSequenceIds.length === 0}
                      loading={nudging}
                    >
                      {!nudging && <FastForward aria-hidden="true" />}
                      {nudging ? 'En cours…' : 'Envoyer les actions du jour'}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{nudgeHelp}</TooltipContent>
              </Tooltip>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowActivityLog(true)}
                title="Voir le journal détaillé des actions envoyées"
              >
                <ScrollText aria-hidden="true" />
                Journal
              </Button>
            </>
          )}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="icon-sm" aria-label="Plus d'actions" className="max-md:h-11 max-md:w-11">
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Plus d'actions</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-72">
              {isMobile && (
                <>
                  <DropdownMenuItem
                    onClick={() => setNudgeConfirmOpen(true)}
                    disabled={nudging || missionSequenceIds.length === 0}
                    className="items-start gap-2 max-md:min-h-11"
                  >
                    <FastForward className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      <span className="block">{nudging ? 'En cours…' : 'Envoyer les actions du jour'}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{nudgeHelp}</span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowActivityLog(true)} className="gap-2 max-md:min-h-11">
                    <ScrollText className="h-4 w-4" aria-hidden="true" />
                    Journal des envois
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => setShowGlobalAnalytics(true)} className="gap-2 max-md:min-h-11">
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
                Statistiques
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowDiagnostic(true)} className="gap-2 max-md:min-h-11">
                <Activity className="h-4 w-4" aria-hidden="true" />
                Diagnostic des envois
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" variant="primary" size="sm" onClick={handleCreateNew} className="max-md:h-11">
            <Plus aria-hidden="true" />
            Créer une séquence
          </Button>
        </div>
      </div>

      {/* Offre sans envoi, abonnement lu : on prépare, on n'active pas (revue design D-25) */}
      {!canSendSequences && !planStateUnknown && (
        <Banner
          tone="info"
          icon={Lock}
          className="rounded-lg border"
          action={<Link to="/pricing" className={bannerActionClass}>Voir les offres</Link>}
        >
          <span id={planNoticeId}>Votre offre ne permet pas d'envoyer des séquences : vous pouvez les préparer, pas les activer.</span>
        </Banner>
      )}

      {renderBody()}

      {/* Template Selector */}
      <SequenceTemplateSelector
        isOpen={showTemplateSelector}
        onClose={() => setShowTemplateSelector(false)}
        onSelectBlank={handleSelectBlank}
        onSelectTemplate={handleSelectTemplate}
        existingSequences={sequences}
      />

      {/* Save as Template */}
      {saveTemplateSeq && (
        <SaveAsTemplateModal
          isOpen={!!saveTemplateSeq}
          onClose={() => setSaveTemplateSeq(null)}
          sequenceId={saveTemplateSeq.id}
          sequenceName={saveTemplateSeq.name}
          steps={saveTemplateSeq.steps}
        />
      )}

      {/* Éditeur */}
      {showBuilder && (
        <SequenceBuilder
          isOpen={showBuilder}
          onClose={() => {
            setShowBuilder(false);
            setEditingSequence(null);
            editorBaseStepIdsRef.current = null;
          }}
          onSave={handleSaveSequence}
          initialSequence={editingSequence || undefined}
          // Candidats en cours (bandeau sur l'effet des modifications, undefined
          // si le compte a échoué) et droit d'envoi du plan.
          activeEnrollmentCount={editingSequence?.id ? editingActiveCount : 0}
          canSendSequences={canSendSequences}
        />
      )}

      {/* Enrollments panel */}
      {enrollmentsPanelSequence && (
        <SequenceEnrollmentsPanel
          isOpen={!!enrollmentsPanelSequence}
          onClose={() => {
            setEnrollmentsPanelSequence(null);
            // Pauses, reprises ou réponses faites dans le panneau : la liste
            // (pastilles, compteurs) doit les refléter à la fermeture.
            void fetchSequences();
          }}
          sequenceId={enrollmentsPanelSequence.id}
          sequenceName={enrollmentsPanelSequence.name}
        />
      )}

      {/* Activity Log */}
      <SequenceActivityLog
        isOpen={showActivityLog}
        onClose={() => setShowActivityLog(false)}
        projectId={projectId}
      />

      {/* Diagnostic */}
      <SequenceDiagnostic
        open={showDiagnostic}
        onOpenChange={setShowDiagnostic}
        projectId={projectId}
      />

      {/* Global Analytics : chunk recharts chargé à la demande */}
      {showGlobalAnalytics && (
        <React.Suspense fallback={null}>
          <SequenceAnalytics
            isOpen={showGlobalAnalytics}
            onClose={() => setShowGlobalAnalytics(false)}
            projectId={projectId}
          />
        </React.Suspense>
      )}

      {/* Per-sequence Analytics : chunk recharts chargé à la demande */}
      {analyticsSequence && (
        <React.Suspense fallback={null}>
          <SequenceAnalytics
            isOpen={!!analyticsSequence}
            onClose={() => setAnalyticsSequence(null)}
            sequenceId={analyticsSequence.id}
            sequenceName={analyticsSequence.name}
            projectId={projectId}
          />
        </React.Suspense>
      )}

      {/* Confirmation de suppression : nombre d'inscrits touchés, séquence partagée, perte de l'anti-doublon */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette séquence ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Cette action est irréversible : les candidats inscrits sont retirés et leur historique d'envoi
                  (étapes planifiées et envoyées) est supprimé.
                </p>
                {deleteTarget && (() => {
                  const total = deleteTarget.enrollments.total || 0;
                  const active = deleteTarget.enrollments.active || 0;
                  const countsKnown = !detailError.counts;
                  const shared = !deleteTarget.project_id;
                  return (
                    <>
                      {countsKnown && total > 0 && (
                        <p className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-muted px-3 py-2 text-sm text-foreground">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                          <span>
                            {plural(total, 'candidat inscrit', 'candidats inscrits')}
                            {active > 0 && ` (dont ${active} en cours d'envoi)`}.
                          </span>
                        </p>
                      )}
                      {shared && (
                        <p className="font-medium text-foreground">
                          {countsKnown && total === 0
                            ? 'Cette séquence est partagée entre toutes vos missions : elle disparaîtra partout.'
                            : `Cette séquence est partagée entre toutes vos missions : elle disparaîtra partout, avec ${countsKnown ? `ses ${plural(total, 'inscrit')}` : 'tous ses inscrits'}.`}
                        </p>
                      )}
                      {(!countsKnown || total > 0) && (
                        <p>
                          Ces candidats ne seront plus signalés comme déjà contactés lors d'une prochaine inscription.
                          Préférez la désactivation si vous voulez garder cette protection.
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              className="bg-destructive hover:bg-destructive/90"
            >
              Supprimer définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Désactivation d'une séquence qui a des candidats en cours */}
      <AlertDialog open={!!toggleConfirm} onOpenChange={() => setToggleConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Désactiver cette séquence ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {(toggleConfirm?.activeCount || 0) > 1 ? 'Les ' : 'Le '}
                  <strong>{toggleConfirm?.activeCount}</strong> candidat{(toggleConfirm?.activeCount || 0) > 1 ? 's' : ''} en
                  cours {(toggleConfirm?.activeCount || 0) > 1 ? 'seront mis' : 'sera mis'} en pause. Aucun message ne partira tant que la séquence est désactivée.
                </p>
                {toggleConfirm?.shared && (
                  <p className="font-medium text-foreground">
                    Cette séquence est partagée entre vos missions : ses candidats des autres missions seront aussi mis en pause.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Vous pourrez la réactiver à tout moment. Les envois prévus pendant la pause partiront à la réactivation, sans être avancés. Les attentes en cours (acceptation, réponse) reprennent telles quelles.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toggleConfirm) void deactivateSequence(toggleConfirm.id);
                setToggleConfirm(null);
              }}
            >
              Désactiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation de réactivation quand des candidats vont reprendre */}
      <AlertDialog open={!!activateConfirm} onOpenChange={(open) => !open && setActivateConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Réactiver cette séquence ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {candidats(activateConfirm?.resumable ?? 0)} en pause {(activateConfirm?.resumable ?? 0) > 1 ? 'reprendront' : 'reprendra'}.
                  Chaque étape garde sa date prévue ; celles déjà passées partiront dans les prochaines heures.
                </p>
                {(activateConfirm?.otherMembers ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {candidats(activateConfirm?.otherMembers ?? 0)} {(activateConfirm?.otherMembers ?? 0) > 1 ? 'inscrits' : 'inscrit'} par
                    d’autres membres {(activateConfirm?.otherMembers ?? 0) > 1 ? 'resteront' : 'restera'} en pause : un administrateur
                    ou le membre qui {(activateConfirm?.otherMembers ?? 0) > 1 ? 'les a inscrits peut les' : 'l’a inscrit peut le'} reprendre
                    depuis la liste des inscrits.
                  </p>
                )}
                {(activateConfirm?.otherPaused ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {candidats(activateConfirm?.otherPaused ?? 0)} mis en pause pour une autre raison (un par un, compte
                    déconnecté, limite atteinte…) {(activateConfirm?.otherPaused ?? 0) > 1 ? 'resteront' : 'restera'} en pause.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (activateConfirm) {
                  void activateSequence(activateConfirm.id, activateConfirm.resumable, activateConfirm.otherPaused, activateConfirm.otherMembers);
                }
                setActivateConfirm(null);
              }}
            >
              Réactiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation « Envoyer les actions du jour » : l'action déclenche des envois */}
      <AlertDialog open={nudgeConfirmOpen} onOpenChange={setNudgeConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Envoyer maintenant les actions du jour ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les actions prévues aujourd'hui pour cette mission partiront progressivement pendant vos heures d'envoi.
              Les relances des jours suivants gardent leur date. Hors invitations LinkedIn et hors séquences partagées
              entre missions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void handleNudgeToday(); }}>
              Envoyer maintenant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

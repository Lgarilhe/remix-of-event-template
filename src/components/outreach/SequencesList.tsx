import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from '@/hooks/useOrganization';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { hasPlanFeature } from '@/lib/featureGates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Search,
  BarChart3,
  MoreHorizontal,
  Trash2, 
  Edit2,
  Users,
  Sparkles,
  Send,
  Mail,
  UserPlus,
  Eye,
  MessageSquare,
  Activity,
  Zap,
  FileText,
  BookTemplate,
  AlertCircle,
  RefreshCw,
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
import { SequenceBuilder, Sequence, SequenceStep } from './SequenceBuilder';
import type { StopConditions, SenderAccountConfig } from './SequenceBuilder';
import { rowToSequenceStep } from './sequence/sequenceGraph';
import { SequenceEnrollModal } from './SequenceEnrollModal';
import { SequenceEnrollmentsPanel } from './SequenceEnrollmentsPanel';
import { SequenceActivityLog } from './SequenceActivityLog';
import { SequenceDiagnostic } from './SequenceDiagnostic';
// Q5 — SequenceAnalytics contient recharts (~100KB), lazy-load pour split chunk
const SequenceAnalytics = React.lazy(() => import('./SequenceAnalytics'));
import { SequenceTemplateSelector, SaveAsTemplateModal } from './SequenceTemplateSelector';
import { LinkedInProfile } from './types';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface SequenceWithStats {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  project_id: string | null;
  organization_id: string | null;
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
  accounts: { id: string; name: string }[];
  selectedAccount: string | null;
  selectedProfiles?: LinkedInProfile[];
  selectedJob?: any;
  onClearSelection?: () => void;
  isVisible?: boolean;
  projectId?: string | null;
  /** Incrémenté par le parent pour ouvrir le choix de modèle (bandeau « candidats Go »). */
  createRequestId?: number;
  /** Appelé après chaque rechargement réussi de la liste (inscriptions, pauses, reprises). */
  onDataChanged?: () => void;
}

// Emoji pour les séquences
const SEQUENCE_EMOJIS = ['🎯', '🚀', '💼', '✨', '🔥', '💡', '📈', '🎨', '⚡', '🏆', '💪', '🌟'];

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
  message?: string;
  error?: string;
}

// Reprise par séquence : le serveur s'arrête avant la limite de temps d'un appel
// et compte le reste dans `remaining`. On le rappelle tant qu'il en reste et
// qu'il progresse.
const MAX_RESUME_ROUNDS = 10;

// DETAIL du refus STEP_HAS_HISTORY : « Étape(s) concernée(s) : 0, 2 », en
// step_order (base 0, trié comme du texte). L'éditeur numérote à partir de 1.
const blockedStepsNotice = (details: string | null | undefined): string => {
  const numbers = [...new Set((details?.match(/\d+/g) ?? []).map(n => Number(n) + 1))].sort((a, b) => a - b);
  if (numbers.length === 0) return '';
  return numbers.length > 1 ? ` Étapes concernées : ${numbers.join(', ')}.` : ` Étape concernée : ${numbers[0]}.`;
};

export const SequencesList: React.FC<SequencesListProps> = ({
  accounts,
  selectedAccount,
  selectedProfiles = [],
  selectedJob,
  onClearSelection,
  isVisible = true,
  projectId,
  createRequestId = 0,
  onDataChanged,
}) => {
  // organization_id est exigé par la policy INSERT d'outreach_sequences
  // (WITH CHECK organization_id = get_user_org_id(auth.uid())) : sans lui, la
  // création et la duplication étaient refusées par RLS.
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  // Gating par plan (lot P0-C) : l'activation d'une séquence est refusée sur le
  // plan gratuit. Tant que l'état d'abonnement charge, on ne refuse rien (le
  // moteur d'envoi côté serveur reste la référence).
  const { effectivePlanId, isLoading: isPlanLoading } = useSubscriptionState();
  const canSendSequences = isPlanLoading || hasPlanFeature(effectivePlanId, 'sequences_send');
  const [sequences, setSequences] = useState<SequenceWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingSequence, setEditingSequence] = useState<Sequence | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toggleConfirm, setToggleConfirm] = useState<{ id: string; nextActive: boolean; activeCount: number; shared: boolean } | null>(null);
  // Réactivation avec des candidats à reprendre : confirmation préalable.
  const [activateConfirm, setActivateConfirm] = useState<{ id: string; resumable: number; otherPaused: number } | null>(null);
  // Séquence dont l'interrupteur est en cours d'écriture : désactivé pendant l'appel.
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [enrollModalSequence, setEnrollModalSequence] = useState<SequenceWithStats | null>(null);
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
  // Échec des lectures secondaires : étapes (éditeur) ou compteurs (« — »).
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
      // vide plus rien en silence : compteurs affichés « — » et éditeur
      // ouvert seulement après relecture des étapes.
      const [stepsResult, enrollResult] = await Promise.allSettled([
        sequenceIds.length === 0 ? Promise.resolve([]) : fetchAllPages((from, to) => supabase
          .from('sequence_steps')
          .select('*')
          .in('sequence_id', sequenceIds)
          .order('step_order', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)),
        sequenceIds.length === 0 ? Promise.resolve([]) : fetchAllPages((from, to) => supabase
          .from('sequence_enrollments')
          .select('sequence_id, status, pause_reason')
          .in('sequence_id', sequenceIds)
          .order('id', { ascending: true })
          .range(from, to)),
      ]);
      if (stepsResult.status === 'rejected') console.error('Error fetching sequence steps:', stepsResult.reason);
      if (enrollResult.status === 'rejected') console.error('Error fetching enrollment counts:', enrollResult.reason);
      const stepsData = stepsResult.status === 'fulfilled' ? stepsResult.value : [];
      const enrollData = enrollResult.status === 'fulfilled' ? enrollResult.value : [];

      const statsBySequence = new Map<string, SequenceWithStats['enrollments']>();
      for (const e of enrollData) {
        const stats = statsBySequence.get(e.sequence_id) ?? emptyEnrollmentStats();
        stats.total += 1;
        if (e.status === 'active') stats.active += 1;
        else if (e.status === 'completed') stats.completed += 1;
        else if (e.status === 'replied') stats.replied += 1;
        else if (e.status === 'paused') {
          stats.paused += 1;
          const reason = e.pause_reason || 'manual';
          stats.pausedByReason[reason] = (stats.pausedByReason[reason] ?? 0) + 1;
        }
        statsBySequence.set(e.sequence_id, stats);
      }

      const enriched: SequenceWithStats[] = (seqData || []).map((seq) => ({
        ...seq,
        steps: stepsData.filter(s => s.sequence_id === seq.id),
        enrollments: statsBySequence.get(seq.id) ?? emptyEnrollmentStats(),
      }));

      setSequences(enriched);
      setLoadError(false);
      setDetailError({ steps: stepsResult.status === 'rejected', counts: enrollResult.status === 'rejected' });
      onDataChangedRef.current?.();
    } catch (err) {
      console.error('Error fetching sequences:', err);
      setLoadError(true);
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

  const handleSaveSequence = async (sequence: Sequence) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');
      if (!organizationId) throw new Error('Organisation introuvable — rechargez la page');

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
      // Sans droit d'envoi (plan gratuit), une nouvelle séquence est créée désactivée.
      const createInactiveForPlan = !sequence.id && sequence.isActive && !canSendSequences;

      if (sequence.id) {
        // Une étape en base que l'éditeur n'a jamais vue a été ajoutée par un
        // collègue depuis l'ouverture : la RPC la supprimerait, avec ses envois
        // prévus. On refuse avant toute écriture.
        const base = editorBaseStepIdsRef.current;
        const { data: currentSteps, error: currentStepsError } = await supabase
          .from('sequence_steps')
          .select('id')
          .eq('sequence_id', sequence.id);
        if (currentStepsError) {
          throw new Error('La séquence n’a pas pu être vérifiée avant l’enregistrement. Réessayez.');
        }
        const knownIds = base?.sequenceId === sequence.id ? base.stepIds : new Set<string>();
        if ((currentSteps || []).some(s => !knownIds.has(s.id))) {
          throw new Error(CONCURRENT_EDIT_MESSAGE);
        }

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

        if (updateError) throw updateError;
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

        if (createError) throw createError;
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
          throw new Error(`Cette étape a déjà été envoyée à des candidats : elle ne peut pas être supprimée. Modifiez son contenu à la place.${blockedStepsNotice(stepsError.details)}`);
        }
        throw stepsError;
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
  const deactivateSequence = async (sequenceId: string, expectedActive: number) => {
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
      if (pausedCount === 0 && expectedActive > 0) {
        // 0 ligne alors que des candidats étaient en cours : refus d'accès ou
        // liste périmée. On recompte avant de conclure.
        const { count: stillActive, error: countError } = await supabase
          .from('sequence_enrollments')
          .select('id', { count: 'exact', head: true })
          .eq('sequence_id', sequenceId)
          .eq('status', 'active');
        if (countError || (stillActive ?? 0) > 0) {
          toast.error(pauseFailed);
          return;
        }
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
  const activateSequence = async (sequenceId: string, resumable: number, otherPaused: number) => {
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

      const stayPaused = otherPaused > 0
        ? `${candidats(otherPaused)} mis en pause pour une autre raison ${otherPaused > 1 ? 'restent' : 'reste'} en pause : reprenez-les depuis la liste des inscrits.`
        : undefined;

      if (resumable === 0) {
        toast.success('Séquence réactivée', stayPaused ? { description: stayPaused } : undefined);
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
          });
          return;
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
      const details = [
        unlinked > 0 ? `${candidats(unlinked)} ${unlinked > 1 ? 'restent' : 'reste'} en pause : compte LinkedIn qui n’est plus relié.` : null,
        nothing > 0 ? `${candidats(nothing)} ${nothing > 1 ? 'n’avaient' : 'n’avait'} plus d’étape à envoyer.` : null,
        remaining > 0 ? `${candidats(remaining)} ${remaining > 1 ? 'n’ont' : 'n’a'} pas encore été ${remaining > 1 ? 'traités' : 'traité'} : désactivez puis réactivez la séquence pour terminer la reprise.` : null,
        stayPaused ?? null,
      ].filter((d): d is string => !!d).join(' ');

      if (remaining > 0 && failed === 0) {
        toast.warning(`Séquence réactivée : ${candidats(resumed)} repris pour l’instant`, { description: details });
      } else if (failed > 0) {
        toast.warning(`Séquence réactivée : ${candidats(resumed)} repris, ${failed} en erreur`, {
          description: `${details} Reprenez les candidats en erreur depuis la liste des inscrits.`.trim(),
        });
      } else {
        toast.success(`Séquence réactivée. ${candidats(resumed)} repris.`, details ? { description: details } : undefined);
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
      await deactivateSequence(seq.id, 0);
      return;
    }
    // Activer (pas désactiver) exige un plan qui autorise l'envoi de séquences.
    if (!canSendSequences) {
      toast.error("L'envoi de séquences nécessite un abonnement", {
        action: { label: 'Voir les plans', onClick: () => navigate('/pricing') },
      });
      return;
    }
    setTogglingId(seq.id);
    let resumable = 0;
    let otherPaused = 0;
    try {
      const pausedCount = (withReason: boolean) => {
        const q = supabase
          .from('sequence_enrollments')
          .select('id', { count: 'exact', head: true })
          .eq('sequence_id', seq.id)
          .eq('status', 'paused');
        return withReason ? q.in('pause_reason', SEQUENCE_LEVEL_PAUSE_REASONS) : q;
      };
      const [resumableRes, pausedRes] = await Promise.all([pausedCount(true), pausedCount(false)]);
      if (resumableRes.error || pausedRes.error) throw resumableRes.error || pausedRes.error;
      resumable = resumableRes.count ?? 0;
      otherPaused = Math.max(0, (pausedRes.count ?? 0) - resumable);
    } catch (err) {
      console.error('Error counting paused enrollments:', err);
      toast.error('La séquence n’a pas pu être réactivée. Réessayez.');
      setTogglingId(null);
      return;
    }
    setTogglingId(null);
    if (resumable > 0) {
      setActivateConfirm({ id: seq.id, resumable, otherPaused });
      return;
    }
    await activateSequence(seq.id, 0, otherPaused);
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
      toast.error('Erreur lors de la suppression');
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleDuplicate = async (seq: SequenceWithStats) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      if (!organizationId) throw new Error('Organisation introuvable — rechargez la page');

      // 1. Charge les steps réelles depuis la DB
      const { data: steps, error: stepsErr } = await (supabase
        .from('sequence_steps')
        .select('*')
        .eq('sequence_id', seq.id)
        .order('step_order', { ascending: true }) as any);
      if (stepsErr) throw stepsErr;

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
      if (seqErr || !newSeq) throw seqErr || new Error('Création échouée');

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
          timeout_days: s.timeout_days ?? null,
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
        if (stepsCreateErr) throw stepsCreateErr;
      }

      toast.success(`Séquence dupliquée : "${newSeq.name}"`, {
        description: 'Inactive par défaut. Activez-la quand vous êtes prêt.',
      });
      // Refresh la liste
      await fetchSequences();
    } catch (err) {
      console.error('Error duplicating sequence:', err);
      toast.error('Erreur lors de la duplication', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleEdit = async (seq: SequenceWithStats) => {
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

  const handleEnrollSuccess = () => {
    setEnrollModalSequence(null);
    onClearSelection?.();
    fetchSequences();
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

  const getSequenceEmoji = (index: number) => {
    return SEQUENCE_EMOJIS[index % SEQUENCE_EMOJIS.length];
  };

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

  // Compteur affiché « — » quand les inscriptions n'ont pas pu être lues.
  const countLabel = (n: number) => (detailError.counts ? '—' : String(n));

  const deleteTarget = deleteConfirmId ? sequences.find(s => s.id === deleteConfirmId) : undefined;


  if (loading) {
    return <BrutalLoader variant="sequences" rows={4} />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-lg sm:text-xl font-semibold text-foreground tracking-tight">Séquences</h1>
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setShowGlobalAnalytics(true)}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-border bg-background text-foreground hover:bg-muted/50 transition-colors shrink-0"
            aria-label="Statistiques"
          >
            <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Statistiques</span>
          </button>
          <button
            onClick={() => setNudgeConfirmOpen(true)}
            disabled={nudging || missionSequenceIds.length === 0}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-border bg-accent/40 text-foreground hover:bg-accent/60 transition-colors shrink-0 disabled:opacity-50"
            title={missionSequenceIds.length === 0
              ? 'Aucune séquence de cette mission à avancer'
              : 'Avance à maintenant les actions prévues plus tard aujourd’hui pour cette mission (hors invitations LinkedIn)'}
            aria-label="Envoyer les actions du jour"
          >
            <Zap className={cn("w-3.5 h-3.5", nudging && "animate-pulse")} aria-hidden="true" />
            <span className="hidden sm:inline">{nudging ? 'En cours…' : 'Envoyer les actions du jour'}</span>
          </button>
          <button
            onClick={() => setShowDiagnostic(true)}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-border bg-background text-foreground hover:bg-muted/50 transition-colors shrink-0"
            title="Vérifier l'état du système d'envoi"
            aria-label="Diagnostic"
          >
            <Activity className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Diagnostic</span>
          </button>
          <button
            onClick={() => setShowActivityLog(true)}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-border bg-background text-foreground hover:bg-muted/50 transition-colors shrink-0"
            title="Voir le journal détaillé des actions envoyées"
            aria-label="Journal"
          >
            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Journal</span>
          </button>
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors shrink-0"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Créer une séquence</span>
            <span className="sm:hidden">Créer</span>
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="Rechercher une séquence"
            placeholder="Rechercher une séquence..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-background border-border rounded-lg"
          />
        </div>
      </div>

      {/* Selected profiles banner */}
      {selectedProfiles.length > 0 && (
        <div className="p-3 bg-accent/20 border border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-foreground" aria-hidden="true" />
            <span className="font-medium text-foreground">{selectedProfiles.length} candidat(s) sélectionné(s)</span>
            {selectedJob && (
              <Badge variant="outline" className="bg-background">{selectedJob.title}</Badge>
            )}
          </div>
          <p className="text-sm text-foreground/70">
            Cliquez sur une séquence pour y inscrire les candidats
          </p>
        </div>
      )}

      {/* Échec d'actualisation alors qu'une liste est déjà affichée */}
      {loadError && sequences.length > 0 && (
        <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 flex items-center justify-between gap-3" role="alert">
          <p className="text-sm text-foreground">Impossible d’actualiser vos séquences. Vérifiez votre connexion puis réessayez.</p>
          <Button variant="outline" size="sm" onClick={() => { void fetchSequences(); }}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
            Réessayer
          </Button>
        </div>
      )}

      {/* Lectures secondaires en échec : compteurs « — », éditeur relu à l'ouverture */}
      {!loadError && (detailError.steps || detailError.counts) && sequences.length > 0 && (
        <div className="p-3 rounded-lg border border-warning/30 bg-warning/5 flex items-center justify-between gap-3" role="alert">
          <p className="text-sm text-foreground">Impossible de charger le détail des séquences.</p>
          <Button variant="outline" size="sm" onClick={() => { void fetchSequences(); }}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
            Réessayer
          </Button>
        </div>
      )}

      {/* Envois bloqués : une alerte par cause, avec l'action qui débloque */}
      {(disconnectedPaused > 0 || subscriptionPaused > 0 || autoPausedSequences.length > 0) && (
        <div className="space-y-2">
          {disconnectedPaused > 0 && (
            <div className="p-3 rounded-lg border border-warning/30 bg-warning/5 flex items-center justify-between gap-3" role="status">
              <p className="text-sm text-foreground flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-warning" aria-hidden="true" />
                {candidats(disconnectedPaused)} en pause : compte LinkedIn déconnecté.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link to="/settings/account/connections">Reconnecter</Link>
              </Button>
            </div>
          )}
          {subscriptionPaused > 0 && (
            <div className="p-3 rounded-lg border border-warning/30 bg-warning/5 flex items-center justify-between gap-3" role="status">
              <p className="text-sm text-foreground flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-warning" aria-hidden="true" />
                Envois suspendus : abonnement requis.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link to="/pricing">Voir les offres</Link>
              </Button>
            </div>
          )}
          {autoPausedSequences.map(seq => (
            <div key={`auto-paused-${seq.id}`} className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 flex items-center justify-between gap-3" role="status">
              <p className="text-sm text-foreground flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-destructive" aria-hidden="true" />
                Séquence « {seq.name} » arrêtée automatiquement après trop d’échecs.
              </p>
              <Button variant="outline" size="sm" onClick={() => setEnrollmentsPanelSequence(seq)}>
                Voir les erreurs
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {loadError && sequences.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-card rounded-xl border border-destructive/30" role="alert">
          <AlertCircle className="w-8 h-8 text-destructive mb-3" aria-hidden="true" />
          <p className="text-sm text-foreground text-center mb-4 max-w-md">
            Impossible de charger vos séquences. Vérifiez votre connexion puis réessayez.
          </p>
          <Button variant="outline" onClick={() => { void fetchSequences(); }}>
            <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
            Réessayer
          </Button>
        </div>
      ) : sequences.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-card rounded-xl border border-border">
          <div className="text-4xl mb-4" aria-hidden="true">🔗</div>
          <h3 className="font-semibold text-base text-foreground mb-2 tracking-tight">Séquences automatisées</h3>
          <p className="text-muted-foreground text-center mb-2 max-w-md text-sm">
            Les séquences envoient automatiquement des messages personnalisés à vos candidats en plusieurs étapes.
            L'IA adapte chaque message au profil du candidat et au poste.
          </p>
          <p className="text-muted-foreground text-center mb-6 max-w-md text-sm">
            Ensuite, sélectionnez vos candidats dans l’onglet Sourcing et cliquez sur Séquence.
          </p>
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-2 h-9 px-5 bg-foreground text-background hover:bg-foreground/90 rounded-lg text-sm font-semibold transition-colors"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
            Créer ma première séquence
          </button>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {/* Table header - hidden on mobile */}
          <div className="hidden sm:grid grid-cols-[auto_auto_1fr_100px_80px_100px_100px_80px] gap-4 px-4 py-3 bg-muted/40 border-b border-border text-[11px] font-semibold text-muted-foreground">
            <div className="w-5" />
            <div>Statut</div>
            <div>Nom de la séquence</div>
            <div className="text-center">Candidats</div>
            <div className="text-center">Répartition</div>
            <div className="text-center">Créée</div>
            <div className="text-center">Actions</div>
            <div />
          </div>

          {/* Table body */}
          <div className="divide-y divide-foreground/5">
            {filteredSequences.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Aucune séquence ne correspond à « {searchQuery} ».
              </p>
            )}
            {filteredSequences.map((seq, index) => (
              <div
                key={seq.id}
                className={cn(
                  "hidden sm:grid grid-cols-[auto_auto_1fr_100px_80px_100px_100px_80px] gap-4 px-4 py-3 items-center hover:bg-accent/10 transition-colors",
                  selectedProfiles.length > 0 && selectedAccount && "cursor-pointer"
                )}
                onClick={() => {
                  if (selectedProfiles.length > 0 && selectedAccount) {
                    setEnrollModalSequence(seq);
                  }
                }}
              >
                <div className="w-5" />
                {canManage(seq) ? (
                  <Switch
                    checked={seq.is_active}
                    disabled={togglingId === seq.id}
                    onCheckedChange={() => { void requestToggle(seq); }}
                    onClick={(e) => e.stopPropagation()}
                    className="data-[state=checked]:bg-foreground"
                    aria-label={seq.is_active ? `Mettre en pause la séquence ${seq.name}` : `Activer la séquence ${seq.name}`}
                  />
                ) : (
                  <span
                    className="text-[10px] text-muted-foreground"
                    title="Séquence d’une autre organisation : vous pouvez la consulter, pas la modifier."
                  >
                    Lecture seule
                  </span>
                )}
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg" aria-hidden="true">{getSequenceEmoji(index)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-foreground truncate">{seq.name}</div>
                      {/* Séquence rattachée à aucune mission : elle apparaît et
                          envoie dans toutes les missions (ce n'est pas un modèle). */}
                      {!seq.project_id && (
                        <span
                          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-info/10 text-info border border-info/30"
                          title="Séquence visible et utilisée dans toutes vos missions"
                        >
                          Partagée entre missions
                        </span>
                      )}
                    </div>
                    {seq.description && (
                      <div className="text-xs text-muted-foreground truncate">{seq.description}</div>
                    )}
                  </div>
                </div>
                <button
                  className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-sm bg-muted text-foreground hover:bg-accent/20 transition-colors cursor-pointer border border-border"
                  onClick={(e) => { e.stopPropagation(); setEnrollmentsPanelSequence(seq); }}
                  title={detailError.counts
                    ? 'Compteurs indisponibles : cliquez pour voir les candidats inscrits'
                    : `${seq.enrollments.active} en cours • ${seq.enrollments.paused} en pause • ${seq.enrollments.replied} ont répondu • ${seq.enrollments.completed} terminé(s) : cliquez pour voir le détail`}
                  aria-label={`Voir les candidats inscrits à la séquence ${seq.name}`}
                >
                  <Users className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="font-medium tabular-nums">{countLabel(seq.enrollments.active)}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="tabular-nums">{countLabel(seq.enrollments.total)}</span>
                </button>
                {/* Status pills : breakdown réel par état d'inscription.
                    Remplace l'ancien faux "funnel décroissance ~70%" qui ne
                    reflétait AUCUNE donnée réelle (juste de la déco).
                    Maintenant on lit vraiment seq.enrollments.{active,replied,completed}. */}
                {detailError.counts ? (
                  <span className="text-[11px] text-muted-foreground" title="Compteurs indisponibles">—</span>
                ) : seq.enrollments.total > 0 ? (
                  <div className="flex items-center gap-1 flex-wrap" title="Statuts des inscriptions">
                    {seq.enrollments.active > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/30">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        {seq.enrollments.active} actif{seq.enrollments.active > 1 ? 's' : ''}
                      </span>
                    )}
                    {seq.enrollments.paused > 0 && (
                      <span
                        className="inline-flex items-center gap-1 text-[10.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-warning/10 text-warning-foreground border border-warning/30"
                        title="Candidats en pause : ouvrez la liste des inscrits pour voir la raison"
                      >
                        {seq.enrollments.paused} en pause
                      </span>
                    )}
                    {seq.enrollments.replied > 0 && (
                      <span
                        className="inline-flex items-center gap-1 text-[10.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-info/10 text-info border border-info/30"
                        title={`${seq.enrollments.replied} candidat(s) ont répondu`}
                      >
                        <span aria-hidden="true">💬</span> {seq.enrollments.replied}
                        <span className="sr-only"> ont répondu</span>
                      </span>
                    )}
                    {seq.enrollments.completed > 0 && (
                      <span
                        className="inline-flex items-center gap-1 text-[10.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-foreground/8 text-foreground/70 border border-border"
                        title={`${seq.enrollments.completed} candidat(s) ont parcouru toute la séquence sans répondre`}
                      >
                        <span aria-hidden="true">✓</span> {seq.enrollments.completed}
                        <span className="sr-only"> terminé(s) sans réponse</span>
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-0.5">
                    <span className="text-[11px] text-muted-foreground/60 italic">
                      Aucune inscription
                    </span>
                    {projectId && (
                      <button
                        type="button"
                        className="text-[11px] font-medium text-foreground underline underline-offset-2 hover:text-foreground/80"
                        onClick={(e) => { e.stopPropagation(); goToSourcing(); }}
                      >
                        Inscrire des candidats
                      </button>
                    )}
                  </div>
                )}
                <div className="text-center text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(seq.created_at), { addSuffix: true, locale: fr })}
                </div>
                <div className="flex items-center justify-center gap-1">
                  <button
                    className="p-1.5 rounded-md hover:bg-accent/20 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={(e) => { e.stopPropagation(); setAnalyticsSequence(seq); }}
                    title="Voir les statistiques"
                    aria-label={`Voir les statistiques de la séquence ${seq.name}`}
                  >
                    <BarChart3 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <button className="p-1.5 hover:bg-accent/20 text-muted-foreground hover:text-foreground transition-colors" aria-label={`Actions de la séquence ${seq.name}`}>
                      <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-background border-border">
                    {canManage(seq) && (
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEdit(seq); }}>
                        <Edit2 className="w-4 h-4 mr-2" aria-hidden="true" />
                        Modifier
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDuplicate(seq); }}>
                      <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                      Dupliquer
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSaveTemplateSeq(seq); }}>
                      <FileText className="w-4 h-4 mr-2" aria-hidden="true" />
                      Enregistrer comme modèle
                    </DropdownMenuItem>
                    {canManage(seq) && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(seq.id); }}
                        >
                          <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                          Supprimer
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}

            {/* Mobile: card layout */}
            {filteredSequences.map((seq, index) => (
              <div
                key={`mobile-${seq.id}`}
                className={cn(
                  "sm:hidden p-3 space-y-2.5 hover:bg-accent/10 transition-colors",
                  selectedProfiles.length > 0 && selectedAccount && "cursor-pointer"
                )}
                onClick={() => {
                  if (selectedProfiles.length > 0 && selectedAccount) {
                    setEnrollModalSequence(seq);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-base" aria-hidden="true">{getSequenceEmoji(index)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <div className="font-medium text-sm text-foreground truncate">{seq.name}</div>
                        {!seq.project_id && (
                          <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-info/10 text-info border border-info/30">
                            Partagée entre missions
                          </span>
                        )}
                      </div>
                      {seq.description && (
                        <div className="text-xs text-muted-foreground truncate">{seq.description}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Même garde que le Switch desktop (requestToggle) : un tap
                        mobile passe par les mêmes confirmations. */}
                    {canManage(seq) ? (
                      <Switch
                        checked={seq.is_active}
                        disabled={togglingId === seq.id}
                        onCheckedChange={() => { void requestToggle(seq); }}
                        onClick={(e) => e.stopPropagation()}
                        className="data-[state=checked]:bg-foreground"
                        aria-label={seq.is_active ? `Mettre en pause la séquence ${seq.name}` : `Activer la séquence ${seq.name}`}
                      />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">Lecture seule</span>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <button className="p-2 hover:bg-accent/20 text-muted-foreground" aria-label={`Actions de la séquence ${seq.name}`}>
                          <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-background border-border">
                        {canManage(seq) && (
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEdit(seq); }}>
                            <Edit2 className="w-4 h-4 mr-2" aria-hidden="true" />
                            Modifier
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setAnalyticsSequence(seq); }}>
                          <BarChart3 className="w-4 h-4 mr-2" aria-hidden="true" />
                          Statistiques
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDuplicate(seq); }}>
                          <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                          Dupliquer
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSaveTemplateSeq(seq); }}>
                          <FileText className="w-4 h-4 mr-2" aria-hidden="true" />
                          Enregistrer comme modèle
                        </DropdownMenuItem>
                        {canManage(seq) && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(seq.id); }}
                            >
                              <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                              Supprimer
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-muted text-foreground hover:bg-accent/20 border border-border"
                    onClick={(e) => { e.stopPropagation(); setEnrollmentsPanelSequence(seq); }}
                    aria-label={`Voir les candidats inscrits à la séquence ${seq.name}`}
                  >
                    <Users className="w-3 h-3" aria-hidden="true" />
                    <span className="font-medium tabular-nums">{countLabel(seq.enrollments.active)}/{countLabel(seq.enrollments.total)}</span>
                  </button>
                  {/* Répartition (mobile) : pastilles compactes */}
                  {!detailError.counts && seq.enrollments.paused > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-warning/10 text-warning-foreground border border-warning/30">
                      {seq.enrollments.paused} en pause
                    </span>
                  )}
                  {!detailError.counts && seq.enrollments.replied > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-info/10 text-info border border-info/30">
                      <span aria-hidden="true">💬</span> {seq.enrollments.replied}
                      <span className="sr-only"> ont répondu</span>
                    </span>
                  )}
                  {!detailError.counts && seq.enrollments.completed > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-foreground/8 text-foreground/70 border border-border">
                      <span aria-hidden="true">✓</span> {seq.enrollments.completed}
                      <span className="sr-only"> terminé(s) sans réponse</span>
                    </span>
                  )}
                  {!detailError.counts && seq.enrollments.total === 0 && projectId && (
                    <button
                      type="button"
                      className="text-[11px] font-medium text-foreground underline underline-offset-2"
                      onClick={(e) => { e.stopPropagation(); goToSourcing(); }}
                    >
                      Inscrire des candidats
                    </button>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(seq.created_at), { addSuffix: true, locale: fr })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Builder modal */}
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

      {/* Enroll modal */}
      {enrollModalSequence && selectedAccount && (
        <SequenceEnrollModal
          isOpen={!!enrollModalSequence}
          onClose={() => setEnrollModalSequence(null)}
          sequence={enrollModalSequence}
          profiles={selectedProfiles}
          accountId={selectedAccount}
          job={selectedJob}
          onSuccess={handleEnrollSuccess}
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

      {/* Global Analytics — lazy chunk recharts */}
      {showGlobalAnalytics && (
        <React.Suspense fallback={null}>
          <SequenceAnalytics
            isOpen={showGlobalAnalytics}
            onClose={() => setShowGlobalAnalytics(false)}
            projectId={projectId}
          />
        </React.Suspense>
      )}

      {/* Per-sequence Analytics — lazy chunk recharts */}
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
        <AlertDialogContent className="bg-background border-border rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette séquence ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Cette action est <strong>irréversible</strong>. Tous les candidats inscrits seront retirés
                  et leur historique d'envoi (étapes programmées et envoyées) supprimé.
                </p>
                {deleteTarget && (() => {
                  const total = deleteTarget.enrollments.total || 0;
                  const active = deleteTarget.enrollments.active || 0;
                  const countsKnown = !detailError.counts;
                  const shared = !deleteTarget.project_id;
                  return (
                    <>
                      {countsKnown && total > 0 && (
                        <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-sm">
                          <p className="font-semibold text-destructive">Impact :</p>
                          <p className="text-destructive/90 mt-1">
                            {total} candidat{total > 1 ? 's' : ''} inscrit{total > 1 ? 's' : ''}
                            {active > 0 && ` (dont ${active} en cours d'envoi)`}.
                          </p>
                        </div>
                      )}
                      {shared && (
                        <p className="font-medium text-foreground">
                          {countsKnown && total === 0
                            ? 'Cette séquence est partagée entre toutes vos missions : elle disparaîtra partout.'
                            : `Cette séquence est partagée entre toutes vos missions : elle disparaîtra partout, avec ${countsKnown ? `ses ${total} inscrit${total > 1 ? 's' : ''}` : 'tous ses inscrits'}.`}
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

      {/* Confirmation Pause séquence avec actifs */}
      <AlertDialog open={!!toggleConfirm} onOpenChange={() => setToggleConfirm(null)}>
        <AlertDialogContent className="bg-background border-border rounded-lg">
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
                  Les envois prévus pendant la pause partiront à la réactivation, sans être avancés. Les attentes en cours (acceptation, réponse) reprennent telles quelles.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toggleConfirm) void deactivateSequence(toggleConfirm.id, toggleConfirm.activeCount);
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
        <AlertDialogContent className="bg-background border-border rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Réactiver cette séquence ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {candidats(activateConfirm?.resumable ?? 0)} en pause {(activateConfirm?.resumable ?? 0) > 1 ? 'reprendront' : 'reprendra'}.
                  Chaque étape garde sa date prévue ; celles déjà passées partiront dans les prochaines heures.
                </p>
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
                  void activateSequence(activateConfirm.id, activateConfirm.resumable, activateConfirm.otherPaused);
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
        <AlertDialogContent className="bg-background border-border rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Envoyer maintenant les actions du jour ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les actions prévues aujourd'hui pour cette mission partiront progressivement pendant vos heures d'envoi.
              Les relances des jours suivants gardent leur date.
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
    </div>
  );
};

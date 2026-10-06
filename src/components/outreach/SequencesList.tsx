import React, { useState, useEffect, useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useUndoableEnrollmentAction } from '@/hooks/useUndoableEnrollmentAction';
import { useSequenceSave } from '@/hooks/useSequenceSave';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSequencesBeta } from '@/hooks/useSequencesBeta';
import { SEQUENCES_PATH, sequencePath } from '@/lib/sequencesBeta';
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
  ArrowRight,
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
import {
  candidats,
  COLLABORATOR_DEACTIVATION_HINT,
  createSequenceListActions,
  PLAN_STATE_LOADING_MESSAGE,
  type SequenceWithStats,
} from '@/lib/sequenceActions';
import { SequenceBuilder } from './SequenceBuilder';
import type { Sequence } from '@/types/sequence';
import { SequenceEnrollmentsPanel } from './SequenceEnrollmentsPanel';
import { SequenceActivityLog } from './SequenceActivityLog';
import { SequenceDiagnostic } from './SequenceDiagnostic';
// Q5 — SequenceAnalytics contient recharts (~100KB), lazy-load pour split chunk
const SequenceAnalytics = React.lazy(() => import('./SequenceAnalytics'));
import { SequenceTemplateSelector } from './SequenceTemplateSelector';
import { NewSequenceDialog } from '@/components/sequences/NewSequenceDialog';
import { SaveAsTemplateModal } from './SaveAsTemplateModal';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { plural } from '@/lib/plural';
import { timeAgo } from '@/lib/relativeTime';

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

// « Lecture seule » : séquence d'une autre organisation, ou (contrat §8) séquence
// d'un collègue pour un collaborateur, qui ne modifie que celles qu'il a créées.
const OTHER_ORG_READ_ONLY_HINT = 'Séquence d’une autre organisation : vous pouvez la consulter, pas la modifier.';
const NOT_AUTHOR_READ_ONLY_HINT = 'Seul l’auteur de cette séquence peut la modifier : dupliquez-la pour l’adapter.';

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
  // Lot 5c-2 : interrupteur konekt.sequences-v2 allumé, chaque séquence mène à
  // sa page et la liste à l'écran Séquences de l'organisation. Éteint, rien ne change.
  const sequencesBeta = useSequencesBeta();
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
  // Lot 5b : « Mettre en pause la séquence » part sans fenêtre, avec « Annuler »
  // dans le toast ; « Réactiver cette séquence ? » garde sa confirmation.
  const { offerUndo, resumeIds, showSummary } = useUndoableEnrollmentAction();
  // État d'abonnement lu au clic sur « Annuler » (le toast survit aux rendus).
  const planRef = React.useRef({ unknown: planStateUnknown, loadError: isPlanLoadError, canSend: canSendSequences });
  planRef.current = { unknown: planStateUnknown, loadError: isPlanLoadError, canSend: canSendSequences };
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
  // « Nouvelle séquence » de l'éditeur unique (drapeau konekt.sequences-v2 allumé, lot 5d-2).
  const [newDialogOpen, setNewDialogOpen] = useState(false);
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
      if (sequencesBeta) setNewDialogOpen(true);
      else setShowTemplateSelector(true);
    }
  }, [createRequestId, sequencesBeta]);

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

  const { handleSaveSequence } = useSequenceSave({
    organizationId,
    projectId,
    canSendSequences,
    planStateUnknown,
    editorBaseStepIdsRef,
    navigate,
    fetchSequences,
    setShowBuilder,
    setEditingSequence,
  });

  const {
    handleNudgeToday,
    activateSequence,
    requestToggle,
    handleDelete,
    handleDuplicate,
    handleEdit: openLegacyEditor,
  } = createSequenceListActions({
    supabase, invokeEdgeFunction, toast, navigate,
    organizationId, projectId, userId, isCollaborator,
    sequences, setSequences, fetchSequences, togglingId, setTogglingId,
    canManage, canEdit, readOnlyHint, deactivationLocked, enrollmentsPanelAction,
    offerUndo, resumeIds, showSummary,
    planRef, refetchPlan, planStateUnknown, isPlanLoadError, canSendSequences,
    missionSequenceIds, setNudging, setNudgeConfirmOpen,
    setActivateConfirm, setDeleteConfirmId, duplicatingRef, setDuplicatingId,
    editorBaseStepIdsRef, setEditingActiveCount, setEditingSequence, setShowBuilder,
  });

  // Drapeau konekt.sequences-v2 allumé (lot 5d-2) : la modification et la
  // création passent par l'éditeur unique (onglet Étapes de la page de la
  // séquence, « Nouvelle séquence » puis /sequences/nouvelle). Éteint : l'ancien éditeur.
  const handleEdit = (seq: SequenceWithStats) => {
    if (!sequencesBeta) {
      void openLegacyEditor(seq);
      return;
    }
    const path = sequencePath(seq.id, projectId);
    navigate(`${path}${path.includes('?') ? '&' : '?'}onglet=etapes`);
  };

  const handleCreateNew = () => {
    if (sequencesBeta) setNewDialogOpen(true);
    else setShowTemplateSelector(true);
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
            {sequencesBeta ? (
              <Link
                to={sequencePath(seq.id, projectId)}
                className="min-w-0 break-words text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {seq.name}
              </Link>
            ) : (
              <p className="min-w-0 break-words text-sm font-medium text-foreground">{seq.name}</p>
            )}
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

      {sequencesBeta && (
        <Link
          to={SEQUENCES_PATH}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
        >
          Toutes les séquences de l'organisation
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}

      {sequencesBeta && (
        <NewSequenceDialog
          open={newDialogOpen}
          onOpenChange={setNewDialogOpen}
          missionId={projectId ?? null}
          existingSequences={sequences.filter(canManage)}
        />
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
                          Préférez la mise en pause de la séquence si vous voulez garder cette protection.
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

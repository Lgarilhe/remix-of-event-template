/**
 * AgentActionsSettings — Historique des actions IA (lecture).
 *
 * Rubrique Paramètres › Journal de l’assistant (/settings/account/journal),
 * provisoire jusqu'au lot 9 (vue Journal de /agents). Les politiques et les
 * connecteurs n'y sont plus : ils sont dans Règles de l’assistant.
 * Liste les rows de agent_tool_executions pour l'user (par défaut) ou toute
 * l'org (admin/owner uniquement). Realtime via la publication supabase_realtime (cf. migration
 * 20260520150000_realtime_publication_copilot_tables.sql).
 *
 * Trois usages :
 *  1. Voir les actions « en attente » (status=proposed) — l'user a oublié
 *     d'aller cliquer Approuver dans le bandeau ; ici il peut décider.
 *  2. Auditer les actions « exécutées » récentes — savoir CE QUE l'agent a
 *     vraiment fait (et quand).
 *  3. Comprendre un échec — voir le error_message dans real_result quand
 *     status=failed.
 *
 * Lot 12 du chantier design : plus de second en-tête sous celui de la rubrique
 * (F-02) ; une lecture ratée s'affiche en erreur avec « Réessayer », jamais comme
 * une liste vide (F-06) ; statuts en badges du kit, couleur réservée aux écarts
 * (F-14) ; bascule des lectures annoncée (F-15) ; vouvoiement (F-11).
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Toggle } from '@/components/ui/toggle';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { StatGrid, StatTile } from '@/components/layout/StatTile';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorState } from '@/components/layout/ErrorState';
import { EnrollFirstMessagePreview } from '@/components/agent/EnrollFirstMessagePreview';
import { readFirstStepPreview } from '@/components/agent/firstStepPreview';
import { SequenceDraftPreview } from '@/components/agent/SequenceDraftPreview';
import { PROPOSAL_EDITOR_NOTE, readSequenceDraftPreview } from '@/components/agent/sequenceDraftPreview';
import { aiProposalSequencePath } from '@/lib/sequencesBeta';
import { useSequencesBeta } from '@/hooks/useSequencesBeta';
import {
  CheckCircle2,
  Clock,
  Ban,
  XCircle,
  RefreshCw,
  History,
  Activity,
  AlertTriangle,
  RotateCcw,
  Check,
  X,
  ArrowUpRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { timeAgo } from '@/lib/relativeTime';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type ActionStatus = 'proposed' | 'approved' | 'executed' | 'auto_executed' | 'failed' | 'rejected';

interface AgentAction {
  id: string;
  tool_name: string;
  status: ActionStatus;
  params: Record<string, unknown>;
  dry_run_result: {
    summary?: string;
    details?: Record<string, unknown>;
    warning?: string;
  } | null;
  real_result: {
    message?: string;
    error?: string;
    [k: string]: unknown;
  } | null;
  user_id: string;
  proposed_at: string;
  approved_at: string | null;
  executed_at: string | null;
  /** ISO timestamp when a queued action becomes eligible for the cron. null = immediate. */
  scheduled_for: string | null;
}

const TOOL_LABEL: Record<string, string> = {
  // Reads (auto_executed, peu visibles)
  get_my_missions: 'Lister les missions',
  get_mission_overview: 'Aperçu de la mission',
  get_mission_candidates: 'Lister les candidats',
  get_mission_process: 'Process de la mission',
  get_sequences_status: 'Statut des séquences',
  get_candidate_detail: 'Fiche du candidat',
  get_upcoming_interviews: 'Entretiens à venir',
  get_candidate_outreach: 'Prospection du candidat',
  get_linkedin_thread: 'Fil LinkedIn',
  search_knowledge: 'Recherche dans vos documents',
  get_vivier_overview: 'Aperçu du vivier',
  get_org_analytics: 'Statistiques de l’organisation',
  get_team_overview: 'Aperçu de l’équipe',
  get_recent_agent_actions: 'Historique des actions de l’assistant',
  // Mutations
  update_candidate_stage: 'Modifier l’étape du candidat',
  add_to_shortlist: 'Ajouter à la shortlist',
  draft_outreach_message: 'Rédiger un message d\'approche',
  create_mission: 'Créer une mission',
  enroll_in_sequence: 'Inscrire dans une séquence',
  schedule_interview: 'Planifier un entretien',
  enrich_candidate_contact: 'Enrichir un contact',
  add_candidate_note: 'Ajouter une note au candidat',
  dismiss_candidate: 'Écarter un candidat',
  assign_candidate_to_member: 'Assigner un candidat',
  update_mission_status: 'Modifier le statut de la mission',
  update_mission_brief: 'Modifier le brief de la mission',
  regenerate_search_filters: 'Régénérer les filtres LinkedIn',
  send_linkedin_message: 'Envoyer un message LinkedIn',
  pause_sequence: 'Mettre en pause une séquence',
  resume_sequence: 'Reprendre une séquence',
  invite_team_member: 'Inviter un membre',
  update_member_quota: 'Modifier les quotas d\'un membre',
  apply_search_filters_to_mission: 'Appliquer les filtres de recherche',
  launch_search: 'Lancer la recherche autonome',
  get_inbox_overview: 'Aperçu de la messagerie',
  bulk_update_stage: 'Déplacer plusieurs candidats',
  bulk_dismiss: 'Écarter plusieurs candidats',
  send_email: 'Envoyer un e-mail',
  create_sequence: 'Créer une séquence',
  start_background_scoring: 'Évaluer les candidats d’une mission en arrière-plan',
};

/** Nom d'une action à l'écran ; jamais le nom technique d'un outil inconnu. */
const toolLabel = (toolName: string) => TOOL_LABEL[toolName] || 'Action de l’assistant';

type StatusTone = 'warning' | 'info' | 'success' | 'muted' | 'danger';

/** Un statut, un badge du kit (même teinte partout) ; le pluriel sert aux compteurs. */
const STATUS_CONFIG: Record<
  ActionStatus,
  {
    label: string;
    plural: string;
    icon: typeof CheckCircle2;
    tone: StatusTone;
  }
> = {
  proposed: { label: 'En attente', plural: 'En attente', icon: Clock, tone: 'warning' },
  approved: { label: 'Approuvée', plural: 'Approuvées', icon: Activity, tone: 'info' },
  executed: { label: 'Exécutée', plural: 'Exécutées', icon: CheckCircle2, tone: 'success' },
  auto_executed: { label: 'Lecture', plural: 'Lectures', icon: CheckCircle2, tone: 'muted' },
  failed: { label: 'Échec', plural: 'Échecs', icon: XCircle, tone: 'danger' },
  rejected: { label: 'Rejetée', plural: 'Rejetées', icon: Ban, tone: 'muted' },
};

// Sensitive tool list (mirror of AgentToolApprovalCard) — approving these
// from the Settings tab still requires a confirmation dialog.
const SENSITIVE_TOOLS = new Set<string>([
  'send_linkedin_message',
  'dismiss_candidate',
  'invite_team_member',
  'update_member_quota',
  'update_mission_status',
]);

function isSensitiveAction(toolName: string, params: Record<string, unknown>): boolean {
  if (!SENSITIVE_TOOLS.has(toolName)) return false;
  if (toolName === 'update_mission_status') {
    const ns = String(params.new_status || '');
    return ns === 'archived' || ns === 'completed';
  }
  return true;
}

interface PendingDialog {
  action: 'approve' | 'reject' | 'requeue' | 'cancel';
  row: AgentAction;
}

export const AgentActionsSettings = () => {
  const { organizationId, isAdmin, isOwner } = useOrganization();
  const { user } = useAuthReady();
  const currentUserId = user?.id ?? null;
  const isPrivileged = isAdmin || isOwner;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Lot 5e : « Ouvrir la séquence » mène à l'éditeur des pages Séquences,
  // derrière l'interrupteur konekt.sequences-v2 ; éteint, pas de bouton.
  const sequencesBeta = useSequencesBeta();
  const [scope, setScope] = useState<'mine' | 'org'>('mine');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [includeReads, setIncludeReads] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, string | null>>({});
  const [pendingDialog, setPendingDialog] = useState<PendingDialog | null>(null);
  const uid = useId();
  const ids = {
    list: `${uid}-liste`,
    statusLabel: `${uid}-statut-libelle`,
    status: `${uid}-statut`,
    scopeLabel: `${uid}-portee-libelle`,
    scope: `${uid}-portee`,
  };

  // Lock scope to mine for non-privileged
  useEffect(() => {
    if (!isPrivileged && scope === 'org') setScope('mine');
  }, [isPrivileged, scope]);

  const {
    data: actions = [],
    isLoading,
    isLoadingError,
    isRefetchError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['agent-actions', organizationId, scope, statusFilter, includeReads],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      let q = supabase
        .from('agent_tool_executions')
        .select(
          'id, tool_name, status, params, dry_run_result, real_result, user_id, proposed_at, approved_at, executed_at, scheduled_for',
        )
        .eq('organization_id', organizationId)
        .order('proposed_at', { ascending: false })
        .limit(80);
      if (scope === 'mine' && userId) q = q.eq('user_id', userId);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      if (!includeReads) q = q.neq('status', 'auto_executed');
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AgentAction[];
    },
    enabled: !!organizationId,
    staleTime: 15 * 1000,
  });

  // Realtime — toute insertion/update sur agent_tool_executions de l'org → refetch
  useEffect(() => {
    if (!organizationId) return;
    const channel = supabase
      .channel(`agent-actions-settings-${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_tool_executions',
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['agent-actions', organizationId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, queryClient]);

  // Resolve member names for org scope
  const userIds = [...new Set(actions.map((a) => a.user_id))];
  const { data: memberNames = {} } = useQuery({
    queryKey: ['agent-actions-members', organizationId, userIds.join(',')],
    queryFn: async () => {
      if (userIds.length === 0) return {};
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const profile of data ?? []) {
        if (profile.display_name) map[profile.user_id] = profile.display_name;
      }
      return map;
    },
    enabled: scope === 'org' && userIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // ─── Action handlers ─────────────────────────────────────────────────────
  const runApproveReject = useCallback(
    async (row: AgentAction, action: 'approve' | 'reject') => {
      setActionLoading((prev) => ({ ...prev, [row.id]: action }));
      try {
        const { data, error } = await invokeEdgeFunction<{
          success: boolean;
          error?: string;
          data?: Record<string, unknown>;
        }>('agent-tool-action', { execution_id: row.id, action });
        if (error || !data?.success) {
          toast.error(
            data?.error || error?.message
              || (action === 'approve' ? 'L’approbation a échoué. Réessayez.' : 'Le rejet a échoué. Réessayez.'),
          );
          return;
        }
        if (action === 'reject') {
          toast.success('Action rejetée');
        } else if (data?.data?.scheduled === true && typeof data.data.scheduled_for === 'string') {
          const when = new Date(data.data.scheduled_for as string).toLocaleString('fr-FR', {
            weekday: 'long',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          });
          toast.success(`Action programmée pour ${when}`, { duration: 6000 });
        } else {
          toast.success('Action exécutée');
        }
        // Realtime should refresh automatically, but invalidate as a safety net
        queryClient.invalidateQueries({ queryKey: ['agent-actions', organizationId] });
      } finally {
        setActionLoading((prev) => ({ ...prev, [row.id]: null }));
      }
    },
    [queryClient, organizationId],
  );

  const requeueFailed = useCallback(
    async (row: AgentAction) => {
      setActionLoading((prev) => ({ ...prev, [row.id]: 'requeue' }));
      try {
        // Reset failed → proposed so the AgentToolApprovalCard banner picks
        // it back up. We do NOT auto-execute — user must explicitly approve
        // again (with potentially new context).
        // Écriture relue : la RLS ne laisse modifier que ses propres actions,
        // et un refus répond « succès » sur 0 ligne sans .select().
        const { data: updated, error } = await supabase
          .from('agent_tool_executions')
          .update({
            status: 'proposed',
            real_result: null,
            executed_at: null,
            approved_at: null,
            scheduled_for: null,
            proposed_at: new Date().toISOString(),
          })
          .eq('id', row.id)
          .eq('status', 'failed')
          .select('id');
        if (error) {
          console.error('[AgentActionsSettings] requeue', error);
          toast.error('La relance a échoué. Réessayez.');
          return;
        }
        if (!updated || updated.length === 0) {
          toast.error("Cette action n'a pas été relancée : seul son auteur peut la relancer, ou elle a déjà changé d'état.");
          queryClient.invalidateQueries({ queryKey: ['agent-actions', organizationId] });
          return;
        }
        toast.success('Action remise en attente : approuvez-la depuis la conversation avec l’assistant, ou ici.');
        queryClient.invalidateQueries({ queryKey: ['agent-actions', organizationId] });
      } finally {
        setActionLoading((prev) => ({ ...prev, [row.id]: null }));
      }
    },
    [queryClient, organizationId],
  );

  const cancelScheduled = useCallback(
    async (row: AgentAction) => {
      setActionLoading((prev) => ({ ...prev, [row.id]: 'cancel' }));
      try {
        // Écriture relue (même piège RLS que la relance) : sans ligne
        // modifiée, l'envoi programmé partira, jamais de faux succès.
        const { data: updated, error } = await supabase
          .from('agent_tool_executions')
          .update({
            status: 'rejected',
            // Note enregistrée en base, jamais affichée : même valeur qu'avant le lot 12
            // (reprise par e2e/api/seq-scheduled-1.spec.ts), tiret écrit en échappement.
            user_note: '[Annulée depuis Settings \u2014 programmation annulée]',
            scheduled_for: null,
          })
          .eq('id', row.id)
          .eq('status', 'approved')
          .is('executed_at', null)
          .select('id');
        if (error) {
          console.error('[AgentActionsSettings] cancel', error);
          toast.error('L’annulation a échoué. Réessayez.');
          return;
        }
        if (!updated || updated.length === 0) {
          toast.error("La programmation n'a pas été annulée : seul l'auteur de l'action peut l'annuler, ou l'envoi a déjà commencé.");
          queryClient.invalidateQueries({ queryKey: ['agent-actions', organizationId] });
          return;
        }
        toast.success('Programmation annulée');
        queryClient.invalidateQueries({ queryKey: ['agent-actions', organizationId] });
      } finally {
        setActionLoading((prev) => ({ ...prev, [row.id]: null }));
      }
    },
    [queryClient, organizationId],
  );

  // Lot 5e : séquence proposée reprise dans l'éditeur (remplie, non
  // enregistrée) ; la proposition est rejetée avec sa note, pour qu'elle ne
  // puisse plus créer une seconde séquence par « Approuver ».
  const openInEditor = useCallback(
    async (row: AgentAction) => {
      setActionLoading((prev) => ({ ...prev, [row.id]: 'open' }));
      try {
        const { data, error } = await invokeEdgeFunction<{ success: boolean; error?: string }>(
          'agent-tool-action',
          { execution_id: row.id, action: 'reject', reason: PROPOSAL_EDITOR_NOTE },
        );
        if (error || !data?.success) {
          toast.error("La séquence n'a pas pu être ouverte dans l'éditeur. Réessayez dans un instant.");
          return;
        }
        queryClient.invalidateQueries({ queryKey: ['agent-actions', organizationId] });
        navigate(aiProposalSequencePath(row.id));
      } finally {
        setActionLoading((prev) => ({ ...prev, [row.id]: null }));
      }
    },
    [queryClient, organizationId, navigate],
  );

  const handleActionClick = useCallback(
    (row: AgentAction, action: 'approve' | 'reject' | 'requeue' | 'cancel' | 'open') => {
      // Sensitive approves → confirmation dialog. Everything else runs
      // directly (reject is intentional, requeue/cancel are reversible).
      if (action === 'approve' && isSensitiveAction(row.tool_name, row.params)) {
        setPendingDialog({ action, row });
        return;
      }
      if (action === 'approve' || action === 'reject') {
        runApproveReject(row, action);
      } else if (action === 'requeue') {
        requeueFailed(row);
      } else if (action === 'open') {
        openInEditor(row);
      } else {
        cancelScheduled(row);
      }
    },
    [runApproveReject, requeueFailed, cancelScheduled, openInEditor],
  );

  if (!organizationId || isLoading) {
    return (
      <div role="status" className="space-y-6">
        <StatGrid cols={{ base: 2, sm: 4 }}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" aria-hidden="true" />)}
        </StatGrid>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" aria-hidden="true" />)}
        </div>
        <span className="sr-only">Chargement du journal de l’assistant…</span>
      </div>
    );
  }

  // Stats résumé
  const byStatus = actions.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
  const filtered = statusFilter !== 'all';

  return (
    <div className="space-y-6">
      {/* Pas de second en-tête : le titre et la phrase de la rubrique suffisent (F-02). */}
      {!isLoadingError && (
        <StatGrid cols={{ base: 2, sm: 4 }}>
          {(['proposed', 'executed', 'failed', 'rejected'] as ActionStatus[]).map((s) => {
            const cfg = STATUS_CONFIG[s];
            const count = byStatus[s] ?? 0;
            // Couleur réservée aux écarts : ce qui attend une décision, ce qui a échoué (F-14).
            const variant = s === 'proposed' ? 'warning' : s === 'failed' ? 'destructive' : 'default';
            return (
              <StatTile
                key={s}
                label={cfg.plural}
                value={count}
                icon={cfg.icon}
                variant={variant}
                accent={count > 0 && variant !== 'default'}
              />
            );
          })}
        </StatGrid>
      )}

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2">
        <span id={ids.statusLabel} className="sr-only">Statut</span>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger
            id={ids.status}
            aria-labelledby={`${ids.statusLabel} ${ids.status}`}
            className="h-8 w-full text-xs max-md:h-11 sm:w-44"
          >
            <SelectValue placeholder="Statut" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            <SelectItem value="proposed">En attente</SelectItem>
            <SelectItem value="executed">Exécutées</SelectItem>
            <SelectItem value="failed">Échecs</SelectItem>
            <SelectItem value="rejected">Rejetées</SelectItem>
            <SelectItem value="approved">Approuvées</SelectItem>
            <SelectItem value="auto_executed">Lectures</SelectItem>
          </SelectContent>
        </Select>

        {isPrivileged && (
          <>
            <span id={ids.scopeLabel} className="sr-only">Portée</span>
            <Select value={scope} onValueChange={(v) => setScope(v as 'mine' | 'org')}>
              <SelectTrigger
                id={ids.scope}
                aria-labelledby={`${ids.scopeLabel} ${ids.scope}`}
                className="h-8 w-full text-xs max-md:h-11 sm:w-44"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mine">Mes actions</SelectItem>
                {/* Apostrophe droite : texte cliqué par e2e/flows/seq-scheduled-1.spec.ts. */}
                <SelectItem value="org">Toute l'organisation</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}

        {/* Bascule annoncée (aria-pressed), libellé fixe (F-15). */}
        <Toggle
          variant="outline"
          size="sm"
          pressed={includeReads}
          onPressedChange={setIncludeReads}
          className="text-xs max-md:h-11"
        >
          Inclure les lectures
        </Toggle>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => refetch()}
          disabled={isFetching}
          className="max-md:h-11 sm:ml-auto"
        >
          <RefreshCw className={cn(isFetching && 'animate-spin')} aria-hidden="true" />
          Rafraîchir
        </Button>
      </div>

      {/* Liste */}
      <section aria-labelledby={ids.list} className="space-y-2">
        {/* Nomme la liste pour les lecteurs d'écran sans doubler l'en-tête visible de la
            rubrique (F-02). */}
        <h3 id={ids.list} className="sr-only">Actions de l'assistant</h3>
        {/* Actualisation ratée : la liste déjà lue reste, et on le dit. */}
        {isRefetchError && (
          <p role="status" className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
            Actualisation impossible : la liste affichée peut dater.
            <Button variant="link" size="xs" onClick={() => refetch()} className="h-auto px-0 max-md:h-11">
              Réessayer
            </Button>
          </p>
        )}
        {isLoadingError ? (
          // Lecture ratée : une erreur avec « Réessayer », jamais « aucune action » (F-06).
          <ErrorState
            title="Impossible de charger le journal de l’assistant."
            description="Vérifiez votre connexion, puis réessayez."
            detail={error instanceof Error ? error.message : null}
            onRetry={() => { void refetch(); }}
            retrying={isFetching}
          />
        ) : actions.length === 0 ? (
          filtered ? (
            <EmptyState
              variant="compact"
              icon={History}
              title="Aucune action ne correspond à ces filtres."
              headingLevel={4}
              description="Changez de statut pour voir les autres actions."
              action={(
                <Button size="sm" variant="outline" onClick={() => setStatusFilter('all')} className="max-md:h-11">
                  Afficher tous les statuts
                </Button>
              )}
            />
          ) : (
            <EmptyState
              variant="compact"
              icon={History}
              title="Aucune action pour le moment"
              headingLevel={4}
              description="Les actions que l’assistant propose dans vos conversations apparaîtront ici, avec leur statut."
            />
          )
        ) : (
          <ul className="space-y-2">
            {actions.map((action) => (
              <li key={action.id}>
                <ActionRow
                  action={action}
                  showAuthor={scope === 'org'}
                  authorName={memberNames[action.user_id]}
                  loadingAction={actionLoading[action.id] ?? null}
                  canAct={!currentUserId || action.user_id === currentUserId}
                  canOpenSequence={sequencesBeta}
                  onAction={handleActionClick}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Dialog de confirmation pour les actions sensibles approuvées depuis la liste */}
      <AlertDialog open={pendingDialog !== null} onOpenChange={(open) => !open && setPendingDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approuver cette action sensible ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {pendingDialog && (
                  <>
                    <p>
                      Vous allez approuver l'action <strong className="font-medium text-foreground">{toolLabel(pendingDialog.row.tool_name)}</strong>.
                    </p>
                    {pendingDialog.row.dry_run_result?.summary && (
                      <p className="text-xs">
                        {pendingDialog.row.dry_run_result.summary}
                      </p>
                    )}
                    {pendingDialog.row.dry_run_result?.warning && (
                      <p className="flex items-start gap-1 text-xs text-foreground">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
                        {pendingDialog.row.dry_run_result.warning}
                      </p>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDialog) {
                  runApproveReject(pendingDialog.row, 'approve');
                  setPendingDialog(null);
                }
              }}
            >
              Approuver l’action
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

interface ActionRowProps {
  action: AgentAction;
  showAuthor: boolean;
  authorName?: string;
  loadingAction: string | null;
  /** Action de l'utilisateur : seul son auteur peut l'approuver, l'annuler ou la relancer. */
  canAct: boolean;
  /** Lot 5e : « Ouvrir la séquence » (interrupteur konekt.sequences-v2 allumé). */
  canOpenSequence: boolean;
  onAction: (row: AgentAction, action: 'approve' | 'reject' | 'requeue' | 'cancel' | 'open') => void;
}

/** Une action, une carte (Card du kit : repère des tests de parcours). */
function ActionRow({ action, showAuthor, authorName, loadingAction, canAct, canOpenSequence, onAction }: ActionRowProps) {
  // Sub-status : 'approved' avec scheduled_for futur = en attente d'envoi
  const isQueued =
    action.status === 'approved' &&
    action.scheduled_for !== null &&
    new Date(action.scheduled_for).getTime() > Date.now();
  const cfg = isQueued
    ? { label: 'Programmée', icon: Clock, tone: 'info' as StatusTone }
    : STATUS_CONFIG[action.status];
  const Icon = cfg.icon;
  const label = toolLabel(action.tool_name);
  const summary = action.dry_run_result?.summary || '';
  const warning = action.dry_run_result?.warning;
  const firstStepPreview = action.tool_name === 'enroll_in_sequence' && action.status === 'proposed'
    ? readFirstStepPreview(action.dry_run_result?.details)
    : null;
  const sequencePreview = action.tool_name === 'create_sequence' && action.status === 'proposed'
    ? readSequenceDraftPreview(action.dry_run_result?.details)
    : null;
  const errorMessage =
    action.status === 'failed'
      ? action.real_result?.error || action.real_result?.message || null
      : null;
  const resultMessage =
    action.status === 'executed' && typeof action.real_result?.message === 'string'
      ? action.real_result.message
      : null;
  const scheduledLabel = isQueued && action.scheduled_for
    ? new Date(action.scheduled_for).toLocaleString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  const time = action.executed_at || action.approved_at || action.proposed_at;

  return (
    <Card>
      <CardContent className="p-3">
        <div className="min-w-0">
          {/* Titre puis statut : les titres restent alignés quelle que soit la longueur du badge. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-medium text-foreground">{label}</p>
            <Badge variant={cfg.tone} className="shrink-0">
              <Icon className="h-3 w-3" aria-hidden="true" />
              {cfg.label}
            </Badge>
            {showAuthor && authorName && (
              <span className="text-xs text-muted-foreground">par {authorName}</span>
            )}
            <time
              dateTime={time}
              title={format(new Date(time), 'PPp', { locale: fr })}
              className="ml-auto text-xs text-muted-foreground"
            >
              {timeAgo(time)}
            </time>
          </div>

          {summary && (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{summary}</p>
          )}

          {warning && action.status === 'proposed' && (
            <p className="mt-1 flex items-start gap-1 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
              <span>{warning}</span>
            </p>
          )}

          {/* Lot 5e : une séquence proposée s'approuve ici aussi, jamais sans ses textes entiers. */}
          {sequencePreview && <SequenceDraftPreview preview={sequencePreview} />}

          {/* Lot 5a : une inscription s'approuve ici aussi, jamais sans son premier message en entier. */}
          {firstStepPreview && (
            <EnrollFirstMessagePreview
              preview={firstStepPreview}
              fallbackName={String(action.dry_run_result?.details?.candidate ?? 'ce candidat')}
            />
          )}

          {isQueued && scheduledLabel && (
            <p className="mt-1 flex items-start gap-1 text-xs text-foreground-secondary">
              <Clock className="mt-0.5 h-3 w-3 shrink-0 text-foreground" aria-hidden="true" />
              <span>Envoi prévu : <strong className="font-medium text-foreground">{scheduledLabel}</strong></span>
            </p>
          )}

          {errorMessage && (
            <p className="mt-1 flex items-start gap-1 break-words text-xs text-danger">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{String(errorMessage)}</span>
            </p>
          )}

          {resultMessage && (
            <p className="mt-1 break-words text-xs text-foreground-secondary">{resultMessage}</p>
          )}

          {/* Action buttons inline — only for actionable states */}
          {canAct && (action.status === 'proposed' || action.status === 'failed' || isQueued) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {action.status === 'proposed' && (
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    loading={loadingAction === 'approve'}
                    disabled={loadingAction != null}
                    onClick={() => onAction(action, 'approve')}
                    className="max-md:h-11"
                  >
                    {loadingAction !== 'approve' && <Check aria-hidden="true" />}
                    Approuver
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    loading={loadingAction === 'reject'}
                    disabled={loadingAction != null}
                    onClick={() => onAction(action, 'reject')}
                    className="text-muted-foreground max-md:h-11"
                  >
                    {loadingAction !== 'reject' && <X aria-hidden="true" />}
                    Rejeter
                  </Button>
                  {canOpenSequence && sequencePreview && (
                    <Button
                      size="xs"
                      variant="outline"
                      loading={loadingAction === 'open'}
                      disabled={loadingAction != null}
                      onClick={() => onAction(action, 'open')}
                      className="max-md:h-11"
                    >
                      {loadingAction !== 'open' && <ArrowUpRight aria-hidden="true" />}
                      Ouvrir la séquence
                    </Button>
                  )}
                </>
              )}
              {isQueued && (
                <Button
                  size="xs"
                  variant="ghost"
                  loading={loadingAction === 'cancel'}
                  disabled={loadingAction != null}
                  onClick={() => onAction(action, 'cancel')}
                  className="text-muted-foreground max-md:h-11"
                >
                  {loadingAction !== 'cancel' && <Ban aria-hidden="true" />}
                  Annuler la programmation
                </Button>
              )}
              {action.status === 'failed' && (
                <Button
                  size="xs"
                  variant="outline"
                  loading={loadingAction === 'requeue'}
                  disabled={loadingAction != null}
                  onClick={() => onAction(action, 'requeue')}
                  className="max-md:h-11"
                >
                  {loadingAction !== 'requeue' && <RotateCcw aria-hidden="true" />}
                  Relancer
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

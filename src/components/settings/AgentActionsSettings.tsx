/**
 * AgentActionsSettings — Historique des actions IA (lecture).
 *
 * Onglet /settings?tab=agent-actions. Liste les rows de agent_tool_executions
 * pour l'user (par défaut) ou toute l'org (admin/owner uniquement). Realtime
 * via la publication supabase_realtime (cf. migration
 * 20260520150000_realtime_publication_copilot_tables.sql).
 *
 * Trois usages :
 *  1. Voir les actions « en attente » (status=proposed) — l'user a oublié
 *     d'aller cliquer Approuver dans le bandeau ; ici il peut décider.
 *  2. Auditer les actions « exécutées » récentes — savoir CE QUE l'agent a
 *     vraiment fait (et quand).
 *  3. Comprendre un échec — voir le error_message dans real_result quand
 *     status=failed.
 */
import { useCallback, useEffect, useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  Loader2,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { AgentPoliciesSettings } from './AgentPoliciesSettings';

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
  get_mission_overview: 'Aperçu mission',
  get_mission_candidates: 'Lister les candidats',
  get_mission_process: 'Process mission',
  get_sequences_status: 'Statut des séquences',
  get_candidate_detail: 'Détail candidat',
  get_upcoming_interviews: 'Entretiens à venir',
  get_candidate_outreach: 'Outreach candidat',
  get_linkedin_thread: 'Fil LinkedIn',
  search_knowledge: 'Recherche RAG',
  get_vivier_overview: 'Aperçu CRM/vivier',
  get_org_analytics: 'Stats organisation',
  get_team_overview: 'Aperçu équipe',
  get_recent_agent_actions: 'Historique actions IA',
  // Mutations
  update_candidate_stage: 'Modifier le stade candidat',
  add_to_shortlist: 'Ajouter à la shortlist',
  draft_outreach_message: 'Rédiger un message d\'approche',
  create_mission: 'Créer une mission',
  enroll_in_sequence: 'Enrôler dans une séquence',
  schedule_interview: 'Planifier un entretien',
  enrich_candidate_contact: 'Enrichir un contact',
  add_candidate_note: 'Ajouter une note candidat',
  dismiss_candidate: 'Écarter un candidat',
  assign_candidate_to_member: 'Assigner un candidat',
  update_mission_status: 'Modifier le statut mission',
  update_mission_brief: 'Modifier le brief mission',
  regenerate_search_filters: 'Régénérer les filtres LinkedIn',
  send_linkedin_message: 'Envoyer un message LinkedIn',
  pause_sequence: 'Mettre en pause une séquence',
  resume_sequence: 'Reprendre une séquence',
  invite_team_member: 'Inviter un membre',
  update_member_quota: 'Modifier les quotas d\'un membre',
  apply_search_filters_to_mission: 'Appliquer les filtres de recherche',
  launch_search: 'Lancer la recherche autonome',
  get_inbox_overview: 'Vue messagerie',
  bulk_update_stage: 'Déplacer plusieurs candidats',
  bulk_dismiss: 'Écarter plusieurs candidats',
};

const STATUS_CONFIG: Record<
  ActionStatus,
  {
    label: string;
    icon: typeof CheckCircle2;
    className: string;
  }
> = {
  proposed: {
    label: 'En attente',
    icon: Clock,
    className: 'bg-warning/10 text-warning border-warning/40',
  },
  approved: {
    label: 'Approuvée',
    icon: Activity,
    className: 'bg-info/10 text-info border-info/40',
  },
  executed: {
    label: 'Exécutée',
    icon: CheckCircle2,
    className: 'bg-success/10 text-success border-success/40',
  },
  auto_executed: {
    label: 'Lecture',
    icon: CheckCircle2,
    className: 'bg-muted text-muted-foreground border-border',
  },
  failed: {
    label: 'Échec',
    icon: XCircle,
    className: 'bg-destructive/10 text-destructive border-destructive/40',
  },
  rejected: {
    label: 'Rejetée',
    icon: Ban,
    className: 'bg-muted text-muted-foreground border-border',
  },
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
  const isPrivileged = isAdmin || isOwner;
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<'mine' | 'org'>('mine');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [includeReads, setIncludeReads] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, string | null>>({});
  const [pendingDialog, setPendingDialog] = useState<PendingDialog | null>(null);

  // Lock scope to mine for non-privileged
  useEffect(() => {
    if (!isPrivileged && scope === 'org') setScope('mine');
  }, [isPrivileged, scope]);

  const {
    data: actions = [],
    isLoading,
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
      const { data } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
      const map: Record<string, string> = {};
      for (const p of (data as Array<{ id: string; full_name: string | null }> | null) ?? []) {
        if (p.full_name) map[p.id] = p.full_name;
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
          toast.error(data?.error || error?.message || `Action ${action} a échoué`);
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
          toast.success('Action exécutée ✓');
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
        const { error } = await supabase
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
          .eq('status', 'failed');
        if (error) {
          toast.error(`Relance échouée : ${error.message}`);
          return;
        }
        toast.success('Action remise en attente — approuve-la depuis le chat ou ici');
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
        const { error } = await supabase
          .from('agent_tool_executions')
          .update({
            status: 'rejected',
            user_note: '[Annulée depuis Settings — programmation annulée]',
            scheduled_for: null,
          })
          .eq('id', row.id)
          .eq('status', 'approved')
          .is('executed_at', null);
        if (error) {
          toast.error(`Annulation échouée : ${error.message}`);
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

  const handleActionClick = useCallback(
    (row: AgentAction, action: 'approve' | 'reject' | 'requeue' | 'cancel') => {
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
      } else {
        cancelScheduled(row);
      }
    },
    [runApproveReject, requeueFailed, cancelScheduled],
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <BrutalLoader compact />
      </div>
    );
  }

  // Stats résumé
  const byStatus = actions.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <History className="w-5 h-5" />
            Actions IA
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Toutes les actions proposées par le copilot et leur statut d'exécution.
            Source de vérité — mis à jour en temps réel.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching}
          className="shrink-0"
        >
          <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', isFetching && 'animate-spin')} />
          Rafraîchir
        </Button>
      </div>

      {/* Politiques d'autonomie par action (P2.1) */}
      <AgentPoliciesSettings />

      {/* Quick stats — count par statut */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(['proposed', 'executed', 'failed', 'rejected'] as ActionStatus[]).map((s) => {
          const cfg = STATUS_CONFIG[s];
          const Icon = cfg.icon;
          return (
            <Card key={s} className={cn('border', byStatus[s] ? cfg.className : 'border-border')}>
              <CardContent className="p-3 flex items-center gap-2">
                <Icon className="w-4 h-4 shrink-0" />
                <div>
                  <div className="text-xs font-medium">{cfg.label}</div>
                  <div className="text-lg font-bold leading-none">{byStatus[s] ?? 0}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-9 text-xs">
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
          <Select value={scope} onValueChange={(v) => setScope(v as 'mine' | 'org')}>
            <SelectTrigger className="w-40 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">Mes actions</SelectItem>
              <SelectItem value="org">Toute l'organisation</SelectItem>
            </SelectContent>
          </Select>
        )}

        <Button
          size="sm"
          variant={includeReads ? 'default' : 'outline'}
          onClick={() => setIncludeReads((v) => !v)}
          className="h-9 text-xs"
        >
          {includeReads ? 'Masquer' : 'Inclure'} les lectures
        </Button>
      </div>

      {/* Liste */}
      {actions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Aucune action ne correspond à ces filtres.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {actions.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              showAuthor={scope === 'org'}
              authorName={memberNames[action.user_id]}
              loadingAction={actionLoading[action.id] ?? null}
              onAction={handleActionClick}
            />
          ))}
        </div>
      )}

      {/* Dialog de confirmation pour les actions sensibles approuvées depuis la liste */}
      <AlertDialog open={pendingDialog !== null} onOpenChange={(open) => !open && setPendingDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer cette action sensible</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {pendingDialog && (
                  <>
                    <p>
                      Tu vas approuver l'action <strong>{TOOL_LABEL[pendingDialog.row.tool_name] || pendingDialog.row.tool_name}</strong>.
                    </p>
                    {pendingDialog.row.dry_run_result?.summary && (
                      <p className="text-xs text-muted-foreground">
                        {pendingDialog.row.dry_run_result.summary}
                      </p>
                    )}
                    {pendingDialog.row.dry_run_result?.warning && (
                      <p className="text-xs text-warning">⚠️ {pendingDialog.row.dry_run_result.warning}</p>
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
              Oui, j'approuve
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
  onAction: (row: AgentAction, action: 'approve' | 'reject' | 'requeue' | 'cancel') => void;
}

function ActionRow({ action, showAuthor, authorName, loadingAction, onAction }: ActionRowProps) {
  // Sub-status : 'approved' avec scheduled_for futur = en attente d'envoi
  const isQueued =
    action.status === 'approved' &&
    action.scheduled_for !== null &&
    new Date(action.scheduled_for).getTime() > Date.now();
  const cfg = isQueued
    ? {
        label: 'Programmée',
        icon: Clock,
        className: 'bg-info/10 text-info border-info/40',
      }
    : STATUS_CONFIG[action.status];
  const Icon = cfg.icon;
  const label = TOOL_LABEL[action.tool_name] || action.tool_name;
  const summary = action.dry_run_result?.summary || '';
  const warning = action.dry_run_result?.warning;
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
      <CardContent className="p-3 flex items-start gap-3">
        <Badge variant="outline" className={cn('shrink-0 gap-1 h-6', cfg.className)}>
          <Icon className="w-3 h-3" />
          <span className="text-[10px]">{cfg.label}</span>
        </Badge>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm font-medium">{label}</div>
            {showAuthor && authorName && (
              <span className="text-[10px] text-muted-foreground">par {authorName}</span>
            )}
          </div>

          {summary && (
            <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{summary}</div>
          )}

          {warning && action.status === 'proposed' && (
            <div className="mt-1 flex items-start gap-1 text-[11px] text-warning">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>{warning}</span>
            </div>
          )}

          {isQueued && scheduledLabel && (
            <div className="mt-1 flex items-start gap-1 text-[11px] text-info">
              <Clock className="w-3 h-3 shrink-0 mt-0.5" />
              <span>Envoi prévu : <strong>{scheduledLabel}</strong></span>
            </div>
          )}

          {errorMessage && (
            <div className="mt-1 text-[11px] text-destructive break-words">
              ⚠️ {String(errorMessage)}
            </div>
          )}

          {resultMessage && (
            <div className="mt-1 text-[11px] text-success break-words">{resultMessage}</div>
          )}

          {/* Action buttons inline — only for actionable states */}
          {(action.status === 'proposed' || action.status === 'failed' || isQueued) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {action.status === 'proposed' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px] gap-1"
                    disabled={loadingAction != null}
                    onClick={() => onAction(action, 'approve')}
                  >
                    {loadingAction === 'approve' ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Check className="w-3 h-3" />
                    )}
                    Approuver
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px] gap-1"
                    disabled={loadingAction != null}
                    onClick={() => onAction(action, 'reject')}
                  >
                    {loadingAction === 'reject' ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <X className="w-3 h-3" />
                    )}
                    Rejeter
                  </Button>
                </>
              )}
              {isQueued && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px] gap-1 text-warning border-warning/40 hover:bg-warning/10"
                  disabled={loadingAction != null}
                  onClick={() => onAction(action, 'cancel')}
                >
                  {loadingAction === 'cancel' ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Ban className="w-3 h-3" />
                  )}
                  Annuler la programmation
                </Button>
              )}
              {action.status === 'failed' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px] gap-1"
                  disabled={loadingAction != null}
                  onClick={() => onAction(action, 'requeue')}
                >
                  {loadingAction === 'requeue' ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3 h-3" />
                  )}
                  Relancer
                </Button>
              )}
            </div>
          )}
        </div>

        <div
          className="text-[10px] text-muted-foreground shrink-0 text-right"
          title={format(new Date(time), 'PPp', { locale: fr })}
        >
          {formatDistanceToNow(new Date(time), { locale: fr, addSuffix: true })}
        </div>
      </CardContent>
    </Card>
  );
}

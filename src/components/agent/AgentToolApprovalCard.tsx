/**
 * AgentToolApprovalCard — Bandeau d'approbation des actions proposées par l'agent IA.
 *
 * Sprint 1 (RAG_AGENT_AUDIT.md §8) — pattern human-in-the-loop.
 *
 * S'affiche quand l'agent a appelé un tool mutation et créé une row
 * agent_tool_executions avec status='proposed'. L'user voit le summary
 * du dry-run + warning éventuel + boutons Rejeter / Modifier / Approuver.
 *
 * Mode Edit (Clarif.2) : permet à l'user de patcher les params proposés par
 * Claude avant exécution. UPDATE direct sur agent_tool_executions.params puis
 * appel à agent-tool-action 'approve'. Whitelist des champs éditables côté UI
 * — les UUIDs/enums restent lisibles mais non-modifiables pour éviter casser
 * verifyAccess.
 *
 * Realtime via Supabase channel : si l'agent crée une nouvelle proposition
 * pendant que l'user lit le chat, le bandeau apparaît automatiquement.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Check, X, AlertTriangle, Loader2, Pencil, ShieldAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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

interface ToolExecutionRow {
  id: string;
  tool_name: string;
  status: 'proposed' | 'approved' | 'rejected' | 'executed' | 'failed' | 'auto_executed';
  params: Record<string, unknown>;
  dry_run_result: {
    summary?: string;
    details?: Record<string, unknown>;
    warning?: string;
  } | null;
  proposed_at: string;
}

interface AgentToolApprovalCardProps {
  conversationId: string | null;
}

// ─── Sensitive tools — require explicit "I confirmed the target" check ────
// Clarif.3 : pre-flight visuel. Avant d'approuver une de ces actions, l'user
// doit cocher une case "Je confirme la cible" qui rappelle le nom de
// l'entité (extrait de dry_run_result.details). Le bouton Approuver reste
// désactivé tant que la case n'est pas cochée. Skipped en mode Edit (l'user
// a relu et patché les params → confirmation implicite).
const SENSITIVE_TOOLS = new Set<string>([
  'send_linkedin_message',
  'dismiss_candidate',
  'bulk_dismiss',
  'invite_team_member',
  'update_member_quota',
  // update_mission_status est sensible uniquement quand on archive/clôture
  // — la sensibilité réelle est décidée par `isSensitiveAction()` qui regarde
  // params.new_status (handled below).
  'update_mission_status',
]);

/**
 * Pour les tools où la sensibilité dépend des params (genre update_mission_status
 * → seul archived/completed est sensible). Renvoie le tool comme "non sensible"
 * dans les cas légers.
 */
function isSensitiveAction(toolName: string, params: Record<string, unknown>): boolean {
  if (!SENSITIVE_TOOLS.has(toolName)) return false;
  if (toolName === 'update_mission_status') {
    const ns = String(params.new_status || '');
    return ns === 'archived' || ns === 'completed';
  }
  return true;
}

/**
 * Extrait le libellé de la cible pour la checkbox de confirmation, à partir
 * de dry_run_result.details. Best-effort — fallback sur "l'entité ciblée".
 */
function targetLabelForTool(toolName: string, details: Record<string, unknown> | undefined): string {
  if (!details) return "l'entité ciblée";
  switch (toolName) {
    case 'send_linkedin_message': {
      const name = details.recipient_label || details.recipient_provider_id || details.chat_id;
      return name ? `le destinataire « ${name} »` : "le destinataire";
    }
    case 'dismiss_candidate': {
      const cand = details.candidate_name || details.candidate_id;
      const job = details.job_label;
      if (cand && job) return `« ${cand} » sur la mission « ${job} »`;
      if (cand) return `« ${cand} »`;
      return "le candidat ciblé";
    }
    case 'invite_team_member': {
      const email = details.email;
      const role = details.role;
      const org = details.organization_name;
      if (email && org) return `${email} (rôle ${role || 'collaborateur'}) dans « ${org} »`;
      if (email) return email as string;
      return "l'invité";
    }
    case 'update_member_quota': {
      const name = details.target_name || details.target_email || details.target_user_id;
      return name ? `les quotas de « ${name} »` : "les quotas du membre ciblé";
    }
    case 'update_mission_status': {
      const job = details.job_label;
      const to = details.to_status;
      return job && to ? `« ${job} » vers le statut « ${to} »` : "la mission ciblée";
    }
    default:
      return "l'entité ciblée";
  }
}

const TOOL_LABEL: Record<string, string> = {
  update_candidate_stage: 'Modifier le stade candidat',
  add_to_shortlist: 'Ajouter à la shortlist',
  draft_outreach_message: 'Rédiger un message d\'approche',
  create_mission: 'Créer une mission',
  enroll_in_sequence: 'Enrôler dans une séquence',
  schedule_interview: 'Planifier un entretien',
  enrich_candidate_contact: 'Enrichir un contact',
  // Phase A.1 — Pipeline candidat
  add_candidate_note: 'Ajouter une note candidat',
  dismiss_candidate: 'Écarter un candidat',
  assign_candidate_to_member: 'Assigner un candidat',
  // Phase A.2 — Mission management
  update_mission_status: 'Modifier le statut mission',
  update_mission_brief: 'Modifier le brief mission',
  regenerate_search_filters: 'Régénérer les filtres LinkedIn',
  // Phase A.3 — Outreach quota-gated
  send_linkedin_message: 'Envoyer un message LinkedIn',
  pause_sequence: 'Mettre en pause une séquence',
  resume_sequence: 'Reprendre une séquence',
  // Phase A.4 — Équipe
  invite_team_member: 'Inviter un membre',
  update_member_quota: 'Modifier les quotas d\'un membre',
  // Phase Calibration — Push de filtres de recherche
  apply_search_filters_to_mission: 'Appliquer les filtres de recherche LinkedIn',
  launch_search: 'Lancer la recherche autonome',
  bulk_update_stage: 'Déplacer plusieurs candidats',
  bulk_dismiss: 'Écarter plusieurs candidats',
};

// ─── Editable fields configuration ─────────────────────────────────────────
// On limite l'édition aux champs textuels/numériques/booléens où l'user peut
// pertinemment raffiner ce que Claude a proposé. Les UUIDs (candidate_id,
// job_id, target_user_id, etc.) restent affichés en lecture seule — les
// modifier casserait verifyAccess (et n'a aucun sens : ce sont des refs
// résolues).

const READONLY_FIELDS = new Set([
  'candidate_id',
  'job_id',
  'sequence_id',
  'target_user_id',
  'assigned_to_user_id',
  'organization_id',
  'project_id',
  'account_id',
  'chat_id',
  'recipient_provider_id',
  'linkedin_url',
]);

// Champs typés comme textarea (multilignes)
const TEXTAREA_FIELDS = new Set([
  'text',
  'message',
  'content',
  'reason',
  'skip_reason',
  'subject',
  'mission_description',
  'context',
]);

type FieldType = 'string' | 'textarea' | 'number' | 'boolean' | 'json' | 'readonly';

function fieldTypeFor(key: string, value: unknown): FieldType {
  if (READONLY_FIELDS.has(key)) return 'readonly';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') {
    if (TEXTAREA_FIELDS.has(key) || value.length > 80) return 'textarea';
    return 'string';
  }
  if (value === null || value === undefined) {
    if (TEXTAREA_FIELDS.has(key)) return 'textarea';
    return 'string';
  }
  return 'json';
}

function humanLabel(key: string): string {
  // candidate_id → "Candidate Id", max_actions_per_day → "Max Actions Per Day"
  return key
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

interface EditableParamFieldProps {
  field: string;
  value: unknown;
  onChange: (newValue: unknown) => void;
}

const EditableParamField: React.FC<EditableParamFieldProps> = ({ field, value, onChange }) => {
  const type = fieldTypeFor(field, value);
  const label = humanLabel(field);

  if (type === 'readonly') {
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {label} <span className="font-mono normal-case">(lecture seule)</span>
        </Label>
        <div className="text-xs font-mono text-muted-foreground bg-muted/40 px-2 py-1 rounded break-all">
          {String(value ?? '∅')}
        </div>
      </div>
    );
  }

  if (type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {label}
        </Label>
        <Switch checked={!!value} onCheckedChange={onChange} />
      </div>
    );
  }

  if (type === 'number') {
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</Label>
        <Input
          type="number"
          value={String(value ?? '')}
          onChange={(e) => {
            const n = e.target.value === '' ? null : Number(e.target.value);
            onChange(Number.isNaN(n) ? value : n);
          }}
          className="h-8 text-xs"
        />
      </div>
    );
  }

  if (type === 'textarea') {
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</Label>
        <Textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.min(8, Math.max(3, Math.ceil(String(value ?? '').length / 60)))}
          className="text-xs font-mono leading-snug"
        />
      </div>
    );
  }

  if (type === 'json') {
    // Object / array : JSON read-write textarea, best-effort
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {label} <span className="normal-case">(JSON)</span>
        </Label>
        <Textarea
          value={JSON.stringify(value, null, 2)}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value));
            } catch {
              // keep raw string; will fail validation but the user sees their input
              onChange(e.target.value);
            }
          }}
          rows={6}
          className="text-xs font-mono leading-snug"
        />
      </div>
    );
  }

  // default string
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</Label>
      <Input
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs"
      />
    </div>
  );
};

export const AgentToolApprovalCard: React.FC<AgentToolApprovalCardProps> = ({ conversationId }) => {
  const [pending, setPending] = useState<ToolExecutionRow[]>([]);
  const [actionLoading, setActionLoading] = useState<Record<string, 'approve' | 'reject' | 'save' | null>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedParams, setEditedParams] = useState<Record<string, unknown>>({});
  /** ID de la row pour laquelle un dialog de confirmation sensible est ouvert (Clarif.3) */
  const [confirmDialogId, setConfirmDialogId] = useState<string | null>(null);

  // Initial fetch + realtime subscription
  useEffect(() => {
    if (!conversationId) {
      setPending([]);
      return;
    }

    let cancelled = false;

    const refetch = async () => {
      // On ignore les rows 'proposed' de + de 24h — sessions de debug
      // abandonnées qui squattent le bandeau. La row reste en DB pour audit,
      // mais l'UI ne l'affiche plus (l'utilisateur n'a aucun contexte pour
      // décider rationnellement à plus de 24h d'écart).
      const dayAgoIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from('agent_tool_executions')
        .select('id, tool_name, status, params, dry_run_result, proposed_at')
        .eq('conversation_id', conversationId)
        .eq('status', 'proposed')
        .gte('proposed_at', dayAgoIso)
        .order('proposed_at', { ascending: false })
        .limit(10);

      if (cancelled) return;
      if (error) {
        console.warn('[AgentToolApprovalCard] fetch error:', error);
        return;
      }
      setPending((data ?? []) as ToolExecutionRow[]);
    };

    refetch();

    // Realtime : nouveau proposed → refetch ; status change → refetch (la row disparaît du bandeau)
    const channel = supabase
      .channel(`agent-tools-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_tool_executions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          refetch();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const handleAction = useCallback(
    async (executionId: string, action: 'approve' | 'reject') => {
      setActionLoading((prev) => ({ ...prev, [executionId]: action }));
      try {
        const { data, error } = await invokeEdgeFunction<{ success: boolean; error?: string; data?: Record<string, unknown> }>(
          'agent-tool-action',
          { execution_id: executionId, action },
        );
        if (error || !data?.success) {
          toast.error(data?.error || error?.message || `Action ${action} a échoué`);
          return;
        }
        if (action === 'reject') {
          toast.success('Action rejetée');
        } else if (data?.data?.scheduled === true && typeof data.data.scheduled_for === 'string') {
          // L'action a été mise en file (hors plage horaire) au lieu d'exécutée
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
        // Optimistic remove (realtime confirmera)
        setPending((prev) => prev.filter((p) => p.id !== executionId));
      } finally {
        setActionLoading((prev) => ({ ...prev, [executionId]: null }));
      }
    },
    [],
  );

  const handleSaveAndApprove = useCallback(
    async (executionId: string) => {
      setActionLoading((prev) => ({ ...prev, [executionId]: 'save' }));
      try {
        // 1. UPDATE params on the row (only the original proposer's row, RLS-protected)
        const { error: updateError } = await supabase
          .from('agent_tool_executions')
          .update({ params: editedParams })
          .eq('id', executionId)
          .eq('status', 'proposed');
        if (updateError) {
          toast.error(`Sauvegarde échouée : ${updateError.message}`);
          return;
        }
        // 2. Approve via the existing edge fn (re-runs dryRun → execute with the new params)
        const { data, error } = await invokeEdgeFunction<{ success: boolean; error?: string; data?: Record<string, unknown> }>(
          'agent-tool-action',
          { execution_id: executionId, action: 'approve' },
        );
        if (error || !data?.success) {
          toast.error(data?.error || error?.message || 'Approbation après édition a échoué');
          return;
        }
        if (data?.data?.scheduled === true && typeof data.data.scheduled_for === 'string') {
          const when = new Date(data.data.scheduled_for as string).toLocaleString('fr-FR', {
            weekday: 'long',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          });
          toast.success(`Action programmée pour ${when} (avec tes modifs)`, { duration: 6000 });
        } else {
          toast.success('Action exécutée avec tes modifs ✓');
        }
        setEditingId(null);
        setEditedParams({});
        setPending((prev) => prev.filter((p) => p.id !== executionId));
      } finally {
        setActionLoading((prev) => ({ ...prev, [executionId]: null }));
      }
    },
    [editedParams],
  );

  const startEditing = useCallback((row: ToolExecutionRow) => {
    setEditingId(row.id);
    setEditedParams({ ...row.params });
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setEditedParams({});
  }, []);

  if (!conversationId || pending.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 px-4 py-3 border-b border-border bg-muted/30">
      {pending.map((row) => {
        const summary = row.dry_run_result?.summary || `Action proposée : ${row.tool_name}`;
        const warning = row.dry_run_result?.warning;
        const label = TOOL_LABEL[row.tool_name] || row.tool_name;
        const loading = actionLoading[row.id];
        const isEditing = editingId === row.id;
        const isSensitive = isSensitiveAction(row.tool_name, row.params);
        const targetLabel = targetLabelForTool(row.tool_name, row.dry_run_result?.details);
        // Edit mode bypasses the sensitive dialog (the user has already re-read
        // and patched the params — confirmation implicit).
        const approveNeedsDialog = isSensitive && !isEditing;

        return (
          <div
            key={row.id}
            className="border border-border bg-background p-3 flex flex-col gap-2 shadow-sm"
            style={{ boxShadow: '3px 3px 0px 0px hsl(var(--primary))' }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-bold text-muted-foreground">
                    Action proposée
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground/60">
                    {label}
                  </span>
                </div>
                <p className="text-sm text-foreground leading-snug">{summary}</p>
                {warning && (
                  <div className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{warning}</span>
                  </div>
                )}
              </div>
            </div>

            {isEditing && (
              <div className="mt-2 pt-2 border-t border-dashed border-border flex flex-col gap-2.5">
                <div className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground/80">
                  Modifier les paramètres avant d'exécuter
                </div>
                {Object.entries(editedParams).map(([field, value]) => (
                  <EditableParamField
                    key={field}
                    field={field}
                    value={value}
                    onChange={(newValue) => setEditedParams((prev) => ({ ...prev, [field]: newValue }))}
                  />
                ))}
              </div>
            )}

            {isSensitive && !isEditing && (
              <div className="mt-1 flex items-start gap-2 rounded border border-warning/40 bg-warning/5 p-2">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-warning" />
                <div className="text-xs leading-snug text-foreground">
                  <span className="font-bold text-warning/90">Action sensible</span> — une
                  fenêtre de confirmation s'ouvrira au clic sur Approuver pour vérifier la
                  cible (<strong>{targetLabel}</strong>).
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              {!isEditing ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAction(row.id, 'reject')}
                    disabled={loading != null}
                    className="h-7 px-2.5 text-xs gap-1 border-border"
                  >
                    {loading === 'reject' ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                    Rejeter
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => startEditing(row)}
                    disabled={loading != null}
                    className="h-7 px-2.5 text-xs gap-1 border-border"
                  >
                    <Pencil className="w-3 h-3" />
                    Modifier
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (approveNeedsDialog) {
                        setConfirmDialogId(row.id);
                      } else {
                        handleAction(row.id, 'approve');
                      }
                    }}
                    disabled={loading != null}
                    className="h-7 px-2.5 text-xs gap-1 bg-foreground text-background hover:bg-foreground/90"
                  >
                    {loading === 'approve' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Approuver
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={cancelEditing}
                    disabled={loading != null}
                    className="h-7 px-2.5 text-xs gap-1 border-border"
                  >
                    <X className="w-3 h-3" />
                    Annuler
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleSaveAndApprove(row.id)}
                    disabled={loading != null}
                    className="h-7 px-2.5 text-xs gap-1 bg-foreground text-background hover:bg-foreground/90"
                  >
                    {loading === 'save' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Approuver avec modifs
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* Dialog de confirmation pour les actions sensibles (Clarif.3 v2) */}
      <AlertDialog open={confirmDialogId !== null} onOpenChange={(open) => !open && setConfirmDialogId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer cette action sensible</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {confirmDialogId && (() => {
                  const row = pending.find((p) => p.id === confirmDialogId);
                  if (!row) return null;
                  const target = targetLabelForTool(row.tool_name, row.dry_run_result?.details);
                  return (
                    <>
                      <p className="mb-2">
                        Tu vas effectuer cette action sur <strong>{target}</strong>.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.dry_run_result?.summary || row.tool_name}
                      </p>
                      {row.dry_run_result?.warning && (
                        <p className="mt-2 text-xs text-warning">⚠️ {row.dry_run_result.warning}</p>
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
              onClick={() => {
                if (confirmDialogId) {
                  handleAction(confirmDialogId, 'approve');
                  setConfirmDialogId(null);
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

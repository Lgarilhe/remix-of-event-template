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
import { useNavigate } from 'react-router-dom';
import { Check, X, AlertTriangle, Loader2, Pencil, ArrowUpRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { businessDaysCutoff } from '@/lib/businessDays';
import { aiProposalSequencePath } from '@/lib/sequencesBeta';
import { useSequencesBeta } from '@/hooks/useSequencesBeta';
import { EnrollFirstMessagePreview } from './EnrollFirstMessagePreview';
import { readFirstStepPreview } from './firstStepPreview';
import { SequenceDraftPreview } from './SequenceDraftPreview';
import { PROPOSAL_EDITOR_NOTE, readSequenceDraftPreview } from './sequenceDraftPreview';
import { writingDetailsLine } from './writingDetails';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { SegmentedControl } from '@/components/ui/segmented-control';
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
  'send_email',
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
  update_candidate_stage: 'Modifier l’étape du candidat',
  add_to_shortlist: 'Ajouter à la shortlist',
  draft_outreach_message: 'Rédiger un message d\'approche',
  create_mission: 'Créer une mission',
  enroll_in_sequence: 'Inscrire dans une séquence',
  schedule_interview: 'Planifier un entretien',
  enrich_candidate_contact: 'Enrichir un contact',
  // Phase A.1 — Pipeline candidat
  add_candidate_note: 'Ajouter une note au candidat',
  dismiss_candidate: 'Écarter un candidat',
  assign_candidate_to_member: 'Assigner un candidat',
  // Phase A.2 — Mission management
  update_mission_status: 'Modifier le statut de la mission',
  update_mission_brief: 'Modifier le brief de la mission',
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
  send_email: 'Envoyer un e-mail',
  create_sequence: 'Créer une séquence',
  start_background_scoring: 'Évaluer les candidats d’une mission en arrière-plan',
};

// ─── Aperçu du message ─────────────────────────────────────────────────────
// Pour les envois (LinkedIn, e-mail), la card montre ce qui va partir : à qui,
// l'objet et le texte complet, lu dans params (le dry-run n'en garde que 120
// caractères). Sans texte exploitable, on retombe sur le résumé du dry-run.
interface MessagePreview {
  title: string;
  recipient: string | null;
  subject: string | null;
  body: string;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function messagePreviewFor(row: ToolExecutionRow): MessagePreview | null {
  const { params } = row;
  const details = row.dry_run_result?.details;

  if (row.tool_name === 'send_linkedin_message') {
    const body = asText(params.text);
    if (!body) return null;
    const isInmail = params.is_inmail === true;
    return {
      title: isInmail
        ? 'Envoyer un InMail'
        : params.chat_id
        ? 'Répondre dans la conversation'
        : TOOL_LABEL.send_linkedin_message,
      recipient: asText(details?.recipient_label) ?? asText(params.recipient_name),
      subject: isInmail ? asText(params.subject) : null,
      body,
    };
  }

  if (row.tool_name === 'send_email') {
    const body = asText(params.body);
    if (!body) return null;
    const name = asText(params.recipient_name);
    const to = asText(params.to_email);
    return {
      title: TOOL_LABEL.send_email,
      recipient: name && to ? `${name} (${to})` : name ?? to,
      subject: asText(params.subject),
      body,
    };
  }

  return null;
}

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

// Champs en lecture seule pour un outil : ceux avec lesquels la carte a
// construit l'aperçu qu'elle montre. « Enregistrer et approuver » ne rejoue
// pas dryRun : les modifier enverrait un texte jamais montré.
const READONLY_FIELDS_BY_TOOL: Record<string, ReadonlySet<string>> = {
  // Lot 5a : premier message construit avec ce nom et la ligne de la mission
  // retrouvée par ce profil.
  enroll_in_sequence: new Set(['profile_name', 'profile_url']),
  // Lot 5e : forme fixée par le serveur à partir de ces réglages ; seuls les
  // textes se modifient, et ils repassent les contrôles à l'approbation.
  create_sequence: new Set(['mission_id', 'first_contact', 'relances', 'profile_visit']),
  // Lot 5e-2 : style et coût montrés sur la carte, calculés par dryRun avec ces champs.
  draft_outreach_message: new Set(['style', 'tone']),
};

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
  // create_sequence (lot 5e) : textes des étapes.
  'invitation_note',
  'first_message',
  'relance_1',
  'relance_2',
  'relance_3',
]);

// Champs à choix fermé d'un outil : libellés français des seules valeurs
// acceptées par le serveur, jamais la valeur technique en saisie libre.
const CHOICE_FIELDS_BY_TOOL: Record<string, Record<string, ReadonlyArray<{ value: string; label: string }>>> = {
  draft_outreach_message: {
    channel: [
      { value: 'linkedin_dm', label: 'Message LinkedIn' },
      { value: 'linkedin_inmail', label: 'InMail' },
      { value: 'email', label: 'E-mail' },
    ],
  },
};

type FieldType = 'string' | 'textarea' | 'number' | 'boolean' | 'json' | 'readonly' | 'choice';

function fieldTypeFor(key: string, value: unknown, toolName?: string): FieldType {
  if (READONLY_FIELDS.has(key) || (toolName && READONLY_FIELDS_BY_TOOL[toolName]?.has(key))) return 'readonly';
  if (toolName && CHOICE_FIELDS_BY_TOOL[toolName]?.[key]) return 'choice';
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

// Libellés français des champs les plus courants ; les autres passent par humanLabel.
const FIELD_LABEL: Record<string, string> = {
  text: 'Message',
  body: 'Message',
  message: 'Message',
  subject: 'Objet',
  recipient_name: 'Destinataire',
  to_email: 'Adresse e-mail',
  is_inmail: 'Envoyer en InMail',
  reason: 'Motif',
  new_status: 'Nouveau statut',
  // create_sequence (lot 5e)
  invitation_note: "Note d'invitation",
  first_message: 'Premier message',
  first_message_subject: 'Objet du premier message',
  relance_1: 'Relance 1',
  relance_1_subject: 'Objet de la relance 1',
  relance_2: 'Relance 2',
  relance_2_subject: 'Objet de la relance 2',
  relance_3: 'Relance 3',
  relance_3_subject: 'Objet de la relance 3',
  // draft_outreach_message (lot 5e-2)
  channel: 'Canal',
  angle: 'Angle',
};

/** Au moins un champ que la personne peut modifier : sinon, pas de « Modifier ». */
function hasEditableField(params: Record<string, unknown> | null | undefined, toolName: string): boolean {
  return Object.entries(params ?? {}).some(([key, value]) => fieldTypeFor(key, value, toolName) !== 'readonly');
}

function humanLabel(key: string): string {
  // max_actions_per_day → "Max actions per day"
  const words = key.split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface EditableParamFieldProps {
  field: string;
  value: unknown;
  /** Outil de la ligne, pour ses champs en lecture seule. */
  toolName: string;
  onChange: (newValue: unknown) => void;
}

const EditableParamField: React.FC<EditableParamFieldProps> = ({ field, value, toolName, onChange }) => {
  const type = fieldTypeFor(field, value, toolName);
  const label = FIELD_LABEL[field] ?? humanLabel(field);

  // Identifiants techniques : conservés dans les params à l'enregistrement,
  // mais rien à lire ni à modifier pour la personne.
  if (type === 'readonly') return null;

  if (type === 'choice') {
    const options = CHOICE_FIELDS_BY_TOOL[toolName]?.[field] ?? [];
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <SegmentedControl<string>
          aria-label={label}
          variant="quiet"
          value={String(value ?? options[0]?.value ?? '')}
          onValueChange={onChange}
          options={options.map((o) => ({ value: o.value, label: o.label }))}
          className="max-sm:flex max-sm:w-full max-sm:flex-col max-sm:items-stretch"
        />
      </div>
    );
  }

  if (type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium text-muted-foreground">
          {label}
        </Label>
        <Switch checked={!!value} onCheckedChange={onChange} />
      </div>
    );
  }

  if (type === 'number') {
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
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
        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
        <Textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.min(8, Math.max(3, Math.ceil(String(value ?? '').length / 60)))}
          className="text-sm leading-snug"
        />
      </div>
    );
  }

  if (type === 'json') {
    // Object / array : JSON read-write textarea, best-effort
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-xs font-medium text-muted-foreground">
          {label} <span className="font-normal">(données structurées)</span>
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
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
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
  const [actionLoading, setActionLoading] = useState<Record<string, 'approve' | 'reject' | 'save' | 'open' | null>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedParams, setEditedParams] = useState<Record<string, unknown>>({});
  /** ID de la row pour laquelle un dialog de confirmation sensible est ouvert (Clarif.3) */
  const [confirmDialogId, setConfirmDialogId] = useState<string | null>(null);
  const navigate = useNavigate();
  // Lot 5e : « Ouvrir la séquence » mène à l'éditeur des pages Séquences,
  // derrière l'interrupteur konekt.sequences-v2 ; éteint, pas de bouton.
  const sequencesBeta = useSequencesBeta();

  // Initial fetch + realtime subscription
  useEffect(() => {
    if (!conversationId) {
      setPending([]);
      return;
    }

    let cancelled = false;

    const refetch = async () => {
      // On ignore les rows 'proposed' de plus de 3 jours ouvrés : même fenêtre
      // que la section « À valider » de la barre latérale (D28), sinon une
      // ligne de la barre ouvrirait une conversation sans rien à valider.
      // La row reste en DB pour audit, mais l'UI ne l'affiche plus.
      const dayAgoIso = businessDaysCutoff(new Date(), 3).toISOString();
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
          console.warn('[AgentToolApprovalCard] action', action, data?.error || error?.message);
          toast.error(
            action === 'approve'
              ? "L'action n'a pas pu être exécutée. Réessayez dans un instant."
              : "L'action n'a pas pu être rejetée. Réessayez dans un instant.",
          );
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
          toast.success('Action exécutée');
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
          console.warn('[AgentToolApprovalCard] save', updateError.message);
          toast.error("Vos modifications n'ont pas pu être enregistrées. Réessayez.");
          return;
        }
        // 2. Approve via the existing edge fn : verifyAccess puis execute avec
        // les nouveaux paramètres, sans nouveau dryRun (l'aperçu montré reste
        // celui de la proposition : ses champs sont en lecture seule).
        const { data, error } = await invokeEdgeFunction<{ success: boolean; error?: string; data?: Record<string, unknown> }>(
          'agent-tool-action',
          { execution_id: executionId, action: 'approve' },
        );
        if (error || !data?.success) {
          console.warn('[AgentToolApprovalCard] approve after edit', data?.error || error?.message);
          toast.error("L'action n'a pas pu être exécutée avec vos modifications. Réessayez.");
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
          toast.success(`Action programmée pour ${when}, avec vos modifications`, { duration: 6000 });
        } else {
          toast.success('Action exécutée avec vos modifications');
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

  // Lot 5e : la séquence proposée est reprise dans l'éditeur, remplie et non
  // enregistrée ; la proposition est rejetée avec sa note, pour qu'elle ne
  // puisse plus créer une seconde séquence par « Approuver ».
  const handleOpenInEditor = useCallback(
    async (executionId: string) => {
      setActionLoading((prev) => ({ ...prev, [executionId]: 'open' }));
      try {
        const { data, error } = await invokeEdgeFunction<{ success: boolean; error?: string }>(
          'agent-tool-action',
          { execution_id: executionId, action: 'reject', reason: PROPOSAL_EDITOR_NOTE },
        );
        if (error || !data?.success) {
          console.warn('[AgentToolApprovalCard] open in editor', data?.error || error?.message);
          toast.error("La séquence n'a pas pu être ouverte dans l'éditeur. Réessayez dans un instant.");
          return;
        }
        setPending((prev) => prev.filter((p) => p.id !== executionId));
        navigate(aiProposalSequencePath(executionId));
      } finally {
        setActionLoading((prev) => ({ ...prev, [executionId]: null }));
      }
    },
    [navigate],
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
    // Plafonné et défilant : un long message ou plusieurs propositions ne
    // doivent jamais repousser la conversation hors de l'écran. Le padding vit
    // sur le wrapper interne : sur le conteneur défilant, il laisserait un
    // écart sous les boutons collés en bas.
    <div
      role="region"
      aria-label="Actions à valider"
      className="max-h-[55vh] shrink-0 overflow-y-auto border-b border-border bg-muted/30"
    >
      <div className="flex flex-col gap-2 px-4 pb-3 pt-3">
        {pending.map((row) => {
          const summary = row.dry_run_result?.summary || "Action proposée par l'assistant";
          const warning = row.dry_run_result?.warning;
          const preview = messagePreviewFor(row);
          const title = preview?.title ?? (TOOL_LABEL[row.tool_name] || "Action de l'assistant");
          const loading = actionLoading[row.id];
          const isEditing = editingId === row.id;
          const isSensitive = isSensitiveAction(row.tool_name, row.params);
          // Edit mode bypasses the sensitive dialog (the user has already re-read
          // and patched the params, confirmation implicite).
          const approveNeedsDialog = isSensitive && !isEditing;
          const firstStepPreview = row.tool_name === 'enroll_in_sequence'
            ? readFirstStepPreview(row.dry_run_result?.details)
            : null;
          const sequencePreview = row.tool_name === 'create_sequence'
            ? readSequenceDraftPreview(row.dry_run_result?.details)
            : null;
          // Lot 5e-2 : style et niveau de la rédaction proposée.
          const writingLine = writingDetailsLine(row.tool_name, row.dry_run_result?.details, summary);

          return (
            <div
              key={row.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5"
            >
              <div className="min-w-0">
                <p className="eyebrow">À valider</p>
                <p className="mt-0.5 text-sm font-semibold leading-snug text-foreground">{title}</p>
              </div>

              {preview ? (
                !isEditing && (
                  <div className="flex flex-col gap-2">
                    <dl className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
                      {preview.recipient && (
                        <>
                          <dt className="text-muted-foreground">À</dt>
                          <dd className="break-words font-medium text-foreground">{preview.recipient}</dd>
                        </>
                      )}
                      {preview.subject && (
                        <>
                          <dt className="text-muted-foreground">Objet</dt>
                          <dd className="break-words font-medium text-foreground">{preview.subject}</dd>
                        </>
                      )}
                    </dl>
                    <div className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm leading-relaxed text-foreground">
                      {preview.body}
                    </div>
                  </div>
                )
              ) : (
                <p className="text-sm leading-snug text-foreground">{summary}</p>
              )}

              {writingLine && <p className="text-xs leading-snug text-muted-foreground">{writingLine}</p>}

              {/* Lot 5e : textes entiers de la séquence proposée. Masqués en mode
                  Modifier, où ces textes se réécrivent. */}
              {row.tool_name === 'create_sequence' && sequencePreview && !isEditing && (
                <SequenceDraftPreview preview={sequencePreview} />
              )}

              {/* Visible aussi en mode Modifier : les champs dont il dépend y sont en lecture seule. */}
              {row.tool_name === 'enroll_in_sequence' && firstStepPreview && (
                <EnrollFirstMessagePreview
                  preview={firstStepPreview}
                  fallbackName={String(row.dry_run_result?.details?.candidate ?? 'ce candidat')}
                />
              )}

              {warning && (
                <div className="flex items-start gap-2 rounded-lg bg-warning-muted px-2.5 py-2 text-xs leading-snug text-foreground">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                  <span>{warning}</span>
                </div>
              )}

              {isEditing && (
                <div className="flex flex-col gap-2.5 border-t border-border pt-3">
                  <p className="text-xs font-medium text-foreground">Modifier avant d'approuver</p>
                  {Object.entries(editedParams).map(([field, value]) => (
                    <EditableParamField
                      key={field}
                      field={field}
                      value={value}
                      toolName={row.tool_name}
                      onChange={(newValue) => setEditedParams((prev) => ({ ...prev, [field]: newValue }))}
                    />
                  ))}
                </div>
              )}

              {/* Collée au bas du bandeau : si le contenu dépasse la hauteur
                  autorisée, les boutons restent atteignables sans défiler. */}
              <div className="sticky bottom-0 z-10 -mx-3.5 -mb-3.5 flex flex-wrap items-center gap-2 rounded-b-xl border-t border-border bg-card px-3.5 py-3">
                {!isEditing ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleAction(row.id, 'reject')}
                      disabled={loading != null}
                    >
                      {loading === 'reject' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <X aria-hidden="true" />}
                      Rejeter
                    </Button>
                    {hasEditableField(row.params, row.tool_name) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEditing(row)}
                        disabled={loading != null}
                      >
                        <Pencil aria-hidden="true" />
                        Modifier
                      </Button>
                    )}
                    {row.tool_name === 'create_sequence' && sequencesBeta && sequencePreview && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenInEditor(row.id)}
                        disabled={loading != null}
                        className="max-md:h-11"
                      >
                        {loading === 'open' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}
                        Ouvrir la séquence
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="primary"
                      className="ml-auto"
                      onClick={() => {
                        if (approveNeedsDialog) {
                          setConfirmDialogId(row.id);
                        } else {
                          handleAction(row.id, 'approve');
                        }
                      }}
                      disabled={loading != null}
                    >
                      {loading === 'approve' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                      Approuver
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={cancelEditing} disabled={loading != null}>
                      <X aria-hidden="true" />
                      Annuler
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      className="ml-auto"
                      onClick={() => handleSaveAndApprove(row.id)}
                      disabled={loading != null}
                    >
                      {loading === 'save' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                      Enregistrer et approuver
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
                          Vous allez effectuer cette action sur <strong>{target}</strong>.
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.dry_run_result?.summary || row.tool_name}
                        </p>
                        {row.dry_run_result?.warning && (
                          <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            {row.dry_run_result.warning}
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
                onClick={() => {
                  if (confirmDialogId) {
                    handleAction(confirmDialogId, 'approve');
                    setConfirmDialogId(null);
                  }
                }}
              >
                Approuver l'action
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

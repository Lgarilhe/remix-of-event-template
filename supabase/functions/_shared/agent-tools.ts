// ============================================================================
// Agent Tools Registry — Sprint 1 Mutations (RAG_AGENT_AUDIT.md §8)
// ============================================================================
// Pattern : human-in-the-loop. Chaque tool mutant suit le cycle :
//
//   1. Claude propose le tool call (via Anthropic tool use)
//   2. handleProposedToolCall() insère une row 'proposed' dans
//      agent_tool_executions + appelle dryRun() pour preview
//   3. UI bandeau affiche dryRunResult → user clique Approve/Reject/Edit
//   4. confirmToolExecution() passe à 'approved' puis appelle execute()
//   5. Si execute() OK → 'executed', sinon → 'failed' avec error
//   6. recordActionOutcomeMessage() trace le dénouement (exécuté/programmé/
//      échoué) dans agent_messages → le modèle le voit dans son historique
//
// Les tools `requiresApproval: false` s'exécutent direct (read-only ou
// faible impact). Pour les mutations user-facing, on garde toujours true.
// ============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';

// Format Anthropic tool use (https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolContext {
  userId: string;
  organizationId: string;
  conversationId: string | null;
  messageId: string | null;
  /** Service-role client (bypass RLS) — pour les mutations DB */
  adminClient: SupabaseClient;
  /**
   * JWT brut de l'utilisateur (sans le préfixe "Bearer "). Présent quand le
   * tool est proposé (search-agent-chat) ou approuvé (agent-tool-action) —
   * absent sur le chemin cron (process-scheduled-actions). Permet à un tool
   * d'appeler une edge function interne AVEC l'identité user (ex :
   * launch_search → run-agent-search), sans élargir l'auth de la cible.
   */
  userBearer?: string | null;
}

export interface DryRunResult {
  /** Description courte de l'action ("Va déplacer X de stage A vers B") */
  summary: string;
  /** Détails affichés dans le bandeau d'approbation */
  details: Record<string, unknown>;
  /** Warning à afficher en rouge si applicable (ex: "supprimera 12 candidats") */
  warning?: string;
}

export interface ExecuteResult {
  success: boolean;
  /** Données utiles à renvoyer à Claude pour la suite de la conversation */
  data?: Record<string, unknown>;
  error?: string;
}

export interface AgentTool {
  /** Nom unique, utilisé par Claude */
  name: string;
  /** Description claire — Claude lit ça pour décider quand l'appeler */
  description: string;
  /** Schéma des paramètres (format Anthropic) */
  inputSchema: AnthropicToolDefinition['input_schema'];
  /** true = passe par la review user (toutes les mutations). false = exécute direct (read-only). */
  requiresApproval: boolean;
  /** Avoid persisting sensitive tool output (for example personal email bodies) in the audit log. */
  redactResultInAudit?: boolean;
  /** Catégorie pour grouper dans l'UI */
  category: 'read' | 'mutation_safe' | 'mutation_destructive' | 'mutation_external';
  /** Vérifie que l'user a le droit de faire cette action (RLS, role, etc.) */
  verifyAccess: (params: Record<string, unknown>, ctx: ToolContext) => Promise<{ allowed: boolean; reason?: string }>;
  /** Preview "qu'est-ce que ça va faire" sans rien modifier */
  dryRun: (params: Record<string, unknown>, ctx: ToolContext) => Promise<DryRunResult>;
  /** Exécution réelle */
  execute: (params: Record<string, unknown>, ctx: ToolContext) => Promise<ExecuteResult>;
}

// ============================================================================
// Registry — register tools here
// ============================================================================

const registry = new Map<string, AgentTool>();

export function registerTool(tool: AgentTool): void {
  if (registry.has(tool.name)) {
    console.warn(`[agent-tools] Tool ${tool.name} already registered, overwriting`);
  }
  registry.set(tool.name, tool);
}

export function getTool(name: string): AgentTool | undefined {
  return registry.get(name);
}

export function listTools(): AgentTool[] {
  return Array.from(registry.values());
}

/** Renvoie la liste des tools au format Anthropic, à passer dans `tools:` du body API */
export function getAnthropicToolDefinitions(): AnthropicToolDefinition[] {
  return listTools().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

// ============================================================================
// Politiques d'autonomie (P2.1 audit 2026-07-14)
// ============================================================================
// Table agent_tool_policies : une row (org, tool) → 'auto' | 'approve' | 'off'.
// Défaut sans row : reads → auto, mutations → approve (comportement historique).
// GARDE-FOU : les tools mutation_external et la liste destructive ci-dessous ne
// peuvent JAMAIS être 'auto' — le clamp est appliqué ICI, côté serveur, quelle
// que soit la valeur en base (le frontend propose, le serveur tranche).

export type ToolPolicy = 'auto' | 'approve' | 'off';

const NEVER_AUTO_TOOLS = new Set([
  'dismiss_candidate',
  'bulk_dismiss',
  'invite_team_member',
  'update_member_quota',
  'update_mission_status',
]);

const policyCache = new Map<string, { at: number; policies: Map<string, ToolPolicy> }>();
const POLICY_CACHE_TTL_MS = 60_000;

/** Politiques configurées de l'org (cache in-memory 60s par instance). */
export async function getOrgToolPolicies(
  adminClient: ToolContext['adminClient'],
  organizationId: string,
): Promise<Map<string, ToolPolicy>> {
  const cached = policyCache.get(organizationId);
  if (cached && Date.now() - cached.at < POLICY_CACHE_TTL_MS) return cached.policies;
  const policies = new Map<string, ToolPolicy>();
  try {
    const { data } = await adminClient
      .from('agent_tool_policies')
      .select('tool_name, policy')
      .eq('organization_id', organizationId);
    for (const row of (data as Array<{ tool_name: string; policy: string }> | null) ?? []) {
      if (row.policy === 'auto' || row.policy === 'approve' || row.policy === 'off') {
        policies.set(row.tool_name, row.policy);
      }
    }
  } catch (err) {
    // Fail-soft : sans table/erreur DB, on retombe sur les défauts (approve).
    console.warn('[agent-tools] getOrgToolPolicies failed (defaults apply):', err);
  }
  policyCache.set(organizationId, { at: Date.now(), policies });
  return policies;
}

/** Politique effective d'un tool = configurée + clamp serveur. */
export function resolveEffectivePolicy(tool: AgentTool, configured: ToolPolicy | undefined): ToolPolicy {
  if (configured === 'off') return 'off';
  if (!tool.requiresApproval) return 'auto'; // reads : toujours directs
  if (configured === 'auto') {
    if (tool.category === 'mutation_external' || NEVER_AUTO_TOOLS.has(tool.name)) return 'approve';
    return 'auto';
  }
  return 'approve';
}

/** Exposé pour l'UI Settings : un tool peut-il être mis en auto ? */
export function isAutoEligible(tool: AgentTool): boolean {
  return tool.requiresApproval && tool.category !== 'mutation_external' && !NEVER_AUTO_TOOLS.has(tool.name);
}

// ============================================================================
// Lifecycle helpers — appelés depuis search-agent-chat
// ============================================================================

/**
 * Quand Claude renvoie un `tool_use` block, on appelle ça :
 * - Si requiresApproval=false : exécute direct, retourne le result
 * - Si requiresApproval=true : crée une row 'proposed' + dryRun, renvoie le preview
 *   à Claude pour qu'il dise à l'user "j'ai préparé X, valide-moi ça via le bandeau".
 */
export interface HandleProposedToolCallResult {
  /** Action prise — 'executed_inline' = direct, 'awaiting_approval' = bandeau UI, 'denied' = refus */
  outcome: 'executed_inline' | 'awaiting_approval' | 'denied';
  /** ID de la row agent_tool_executions créée (sauf si denied avant DB write) */
  executionId?: string;
  /** Pour 'executed_inline' = result, pour 'awaiting_approval' = dryRunResult, pour 'denied' = reason */
  payload: Record<string, unknown>;
}

export async function handleProposedToolCall(
  toolName: string,
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<HandleProposedToolCallResult> {
  const tool = getTool(toolName);
  if (!tool) {
    return { outcome: 'denied', payload: { error: `Tool ${toolName} not found` } };
  }

  // 0. Politique d'autonomie de l'org (P2.1) : off → refus net ; auto →
  //    exécution directe (bloc 3) ; approve → bandeau (bloc 4).
  const orgPolicies = await getOrgToolPolicies(ctx.adminClient, ctx.organizationId);
  const effectivePolicy = resolveEffectivePolicy(tool, orgPolicies.get(tool.name));
  if (effectivePolicy === 'off') {
    return {
      outcome: 'denied',
      payload: { error: `L'action « ${tool.name} » est désactivée par l'administrateur de l'organisation (Réglages → Actions de l'agent).` },
    };
  }

  // 1. Verify access (RLS / role / membership)
  const access = await tool.verifyAccess(params, ctx);
  if (!access.allowed) {
    return { outcome: 'denied', payload: { error: access.reason || 'Access denied' } };
  }

  // 2. Dry run for preview (always — even for non-approval tools, useful for debugging)
  let dryRunResult: DryRunResult;
  try {
    dryRunResult = await tool.dryRun(params, ctx);
  } catch (err) {
    return {
      outcome: 'denied',
      payload: { error: `Dry run failed: ${err instanceof Error ? err.message : String(err)}` },
    };
  }

  // 3. Politique 'auto' (reads, et mutations autorisées en auto par l'org) :
  //    exécution immédiate, loggée auto_executed dans l'audit.
  if (effectivePolicy === 'auto') {
    let result: ExecuteResult;
    try {
      result = await tool.execute(params, ctx);
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    const auditResult: ExecuteResult = tool.redactResultInAudit
      ? { success: result.success, data: { redacted: true } }
      : result;

    // Log execution (status auto_executed = no review needed, executed inline)
    const { data: row } = await ctx.adminClient
      .from('agent_tool_executions')
      .insert({
        conversation_id: ctx.conversationId,
        message_id: ctx.messageId,
        user_id: ctx.userId,
        organization_id: ctx.organizationId,
        tool_name: toolName,
        params,
        status: result.success ? 'auto_executed' : 'failed',
        dry_run_result: dryRunResult as unknown as Record<string, unknown>,
        real_result: auditResult as unknown as Record<string, unknown>,
        executed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    return {
      outcome: 'executed_inline',
      executionId: row?.id,
      payload: result.success ? (result.data ?? {}) : { error: result.error },
    };
  }

  // 4. Approval required: create 'proposed' row, return dry-run preview
  const { data: row, error: insertError } = await ctx.adminClient
    .from('agent_tool_executions')
    .insert({
      conversation_id: ctx.conversationId,
      message_id: ctx.messageId,
      user_id: ctx.userId,
      organization_id: ctx.organizationId,
      tool_name: toolName,
      params,
      status: 'proposed',
      dry_run_result: dryRunResult as unknown as Record<string, unknown>,
    })
    .select('id')
    .single();

  if (insertError || !row?.id) {
    return {
      outcome: 'denied',
      payload: { error: `Failed to record proposed execution: ${insertError?.message}` },
    };
  }

  return {
    outcome: 'awaiting_approval',
    executionId: row.id,
    payload: {
      summary: dryRunResult.summary,
      details: dryRunResult.details,
      warning: dryRunResult.warning,
      message: 'Awaiting user approval. Use the action card in the chat to approve or reject.',
    },
  };
}

/**
 * Insère dans la conversation d'origine un message assistant qui trace le
 * dénouement réel d'une action approuvée (exécutée / programmée / échouée).
 *
 * Sans cette trace, le modèle ne sait JAMAIS qu'une action approuvée via le
 * bandeau a été exécutée : l'approbation passe par agent-tool-action, hors du
 * fil agent_messages, et search-agent-chat devait appeler
 * get_recent_agent_actions à chaque question « tu l'as fait ? ». Le rôle
 * 'assistant' est sûr même si le dernier message du fil est déjà un
 * assistant : la reconstruction d'historique de search-agent-chat merge les
 * rôles consécutifs avant l'appel API.
 *
 * Best-effort : un échec d'insertion ne doit jamais faire échouer l'action
 * elle-même (déjà exécutée côté DB) — on log et on continue.
 */
export async function recordActionOutcomeMessage(
  // Typé via ToolContext pour ne pas répéter le TS2749 pré-existant
  // (SupabaseClient importé en ?no-check n'expose pas de type).
  adminClient: ToolContext['adminClient'],
  execution: {
    id: string;
    conversationId: string | null;
    toolName: string;
    dryRunSummary?: string | null;
  },
  outcome: 'executed' | 'failed' | 'scheduled',
  result: ExecuteResult,
  scheduledForIso?: string,
): Promise<void> {
  if (!execution.conversationId) return;
  try {
    const summary = (execution.dryRunSummary ?? '').trim();
    const resultMessage =
      typeof result.data?.message === 'string' ? (result.data.message as string).trim() : '';
    let content: string;
    if (outcome === 'scheduled') {
      const when = scheduledForIso
        ? new Date(scheduledForIso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
        : 'plus tard';
      content = `🕒 Action programmée : ${execution.toolName}${summary ? ` — ${summary}` : ''} (exécution prévue le ${when})`;
    } else if (outcome === 'executed') {
      content = `✅ Action exécutée : ${execution.toolName}${summary ? ` — ${summary}` : ''}${resultMessage ? ` → ${resultMessage}` : ''}`;
    } else {
      content = `❌ Action échouée : ${execution.toolName}${summary ? ` — ${summary}` : ''} → ${result.error || 'erreur inconnue'}`;
    }
    const { error } = await adminClient.from('agent_messages').insert({
      conversation_id: execution.conversationId,
      role: 'assistant',
      content,
      metadata: {
        agent_action_result: {
          execution_id: execution.id,
          tool_name: execution.toolName,
          status: outcome,
        },
      },
    });
    if (error) {
      console.warn('[agent-tools] recordActionOutcomeMessage insert error:', error.message);
    }
  } catch (err) {
    console.warn('[agent-tools] recordActionOutcomeMessage failed:', err);
  }
}

/**
 * Appelé depuis l'UI quand l'user clique "Approve" sur un bandeau.
 * Récupère la row, vérifie qu'elle est en 'proposed' ou 'approved', exécute, met à jour.
 *
 * Comportement spécial — QUEUE HORS-PLAGE : si dryRun a inscrit un
 * `scheduled_for` futur dans `dry_run_result.details.scheduled_for`,
 * on marque la row comme approuvée + scheduled_for + approved_at, mais
 * on N'EXÉCUTE PAS. Le cron process-scheduled-actions s'en charge quand
 * la plage horaire s'ouvre. Évite que l'user reste collé hors 8h-16h.
 */
export async function confirmToolExecution(
  executionId: string,
  ctx: ToolContext,
): Promise<ExecuteResult & { executionId: string }> {
  const { data: row, error } = await ctx.adminClient
    .from('agent_tool_executions')
    .select('*')
    .eq('id', executionId)
    .single();

  if (error || !row) {
    return { success: false, error: 'Execution not found', executionId };
  }

  // Idempotency: si déjà executed, retourner le résultat sans re-exécuter
  if (row.status === 'executed') {
    return {
      success: true,
      data: (row.real_result as Record<string, unknown>) ?? {},
      executionId,
    };
  }

  // Sécurité : seul l'user qui a la row peut approuver, et l'org doit matcher
  if (row.user_id !== ctx.userId || row.organization_id !== ctx.organizationId) {
    return { success: false, error: 'Forbidden — execution belongs to another user/org', executionId };
  }

  if (row.status !== 'proposed' && row.status !== 'approved') {
    return { success: false, error: `Cannot execute from status ${row.status}`, executionId };
  }

  const tool = getTool(row.tool_name);
  if (!tool) {
    return { success: false, error: `Tool ${row.tool_name} not registered`, executionId };
  }

  // ── QUEUE HORS-PLAGE : si dryRun a fixé un scheduled_for futur, on ne
  // l'exécute pas maintenant. Le cron prendra le relais.
  const dryRunDetails = ((row.dry_run_result as Record<string, unknown> | null) ?? {});
  const detailsObj = (dryRunDetails.details as Record<string, unknown> | null) ?? dryRunDetails;
  const scheduledForRaw = detailsObj?.scheduled_for ?? null;
  if (typeof scheduledForRaw === 'string' && scheduledForRaw.length > 0) {
    const scheduledMs = Date.parse(scheduledForRaw);
    if (!Number.isNaN(scheduledMs) && scheduledMs > Date.now() + 30_000) {
      // > 30s in the future → queue, don't execute
      const scheduledIso = new Date(scheduledMs).toISOString();
      await ctx.adminClient
        .from('agent_tool_executions')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          scheduled_for: scheduledIso,
        })
        .eq('id', executionId);
      const scheduledResult: ExecuteResult = {
        success: true,
        data: {
          scheduled: true,
          scheduled_for: scheduledIso,
          message: `Action programmée pour ${new Date(scheduledMs).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}.`,
        },
      };
      await recordActionOutcomeMessage(
        ctx.adminClient,
        {
          id: executionId,
          conversationId: row.conversation_id ?? null,
          toolName: row.tool_name,
          dryRunSummary: (dryRunDetails.summary as string | undefined) ?? null,
        },
        'scheduled',
        scheduledResult,
        scheduledIso,
      );
      return { ...scheduledResult, executionId };
    }
  }

  // ── Path standard : exécution immédiate
  // Mark as approved (transitionnel, traçable)
  await ctx.adminClient
    .from('agent_tool_executions')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', executionId);

  // Execute — le ctx d'approbation (agent-tool-action) n'a pas le
  // conversation_id d'origine : on le réinjecte depuis la row pour que les
  // tools qui en dépendent (launch_search) le voient à l'exécution.
  const execCtx: ToolContext = { ...ctx, conversationId: row.conversation_id ?? ctx.conversationId };
  let result: ExecuteResult;
  try {
    result = await tool.execute(row.params as Record<string, unknown>, execCtx);
  } catch (err) {
    result = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Update final status
  await ctx.adminClient
    .from('agent_tool_executions')
    .update({
      status: result.success ? 'executed' : 'failed',
      real_result: result as unknown as Record<string, unknown>,
      executed_at: new Date().toISOString(),
    })
    .eq('id', executionId);

  // Trace le dénouement dans la conversation d'origine pour que le modèle
  // le voie dans son historique au prochain message.
  await recordActionOutcomeMessage(
    ctx.adminClient,
    {
      id: executionId,
      conversationId: row.conversation_id ?? null,
      toolName: row.tool_name,
      dryRunSummary: (dryRunDetails.summary as string | undefined) ?? null,
    },
    result.success ? 'executed' : 'failed',
    result,
  );

  return { ...result, executionId };
}

/**
 * Appelé par le cron process-scheduled-actions. Exécute une row dont
 * scheduled_for est échu et qui est encore en status='approved'.
 * Différent de confirmToolExecution : pas de transition 'proposed'→'approved'
 * (déjà fait), et pas de re-check du scheduled_for (le cron a déjà filtré).
 */
export async function executeScheduledAction(
  executionId: string,
  ctx: ToolContext,
): Promise<ExecuteResult & { executionId: string }> {
  const { data: row, error } = await ctx.adminClient
    .from('agent_tool_executions')
    .select('*')
    .eq('id', executionId)
    .single();

  if (error || !row) {
    return { success: false, error: 'Execution not found', executionId };
  }
  if (row.status !== 'approved') {
    return { success: false, error: `Cannot execute scheduled from status ${row.status}`, executionId };
  }
  if (row.executed_at) {
    return { success: false, error: 'Already executed', executionId };
  }

  const dryRunSummary =
    (((row.dry_run_result as Record<string, unknown> | null) ?? {}).summary as string | undefined) ?? null;

  const tool = getTool(row.tool_name);
  if (!tool) {
    await ctx.adminClient
      .from('agent_tool_executions')
      .update({
        status: 'failed',
        real_result: { error: `Tool ${row.tool_name} not registered` } as unknown as Record<string, unknown>,
        executed_at: new Date().toISOString(),
      })
      .eq('id', executionId);
    await recordActionOutcomeMessage(
      ctx.adminClient,
      { id: executionId, conversationId: row.conversation_id ?? null, toolName: row.tool_name, dryRunSummary },
      'failed',
      { success: false, error: `Tool ${row.tool_name} not registered` },
    );
    return { success: false, error: `Tool ${row.tool_name} not registered`, executionId };
  }

  // Build a ctx scoped to the original user/org so the tool's verifyAccess
  // checks (and any service-role queries it makes) target the correct
  // organization.
  const scopedCtx: ToolContext = {
    ...ctx,
    userId: row.user_id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
  };

  let result: ExecuteResult;
  try {
    result = await tool.execute(row.params as Record<string, unknown>, scopedCtx);
  } catch (err) {
    result = { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  await ctx.adminClient
    .from('agent_tool_executions')
    .update({
      status: result.success ? 'executed' : 'failed',
      real_result: result as unknown as Record<string, unknown>,
      executed_at: new Date().toISOString(),
    })
    .eq('id', executionId);

  // Trace le dénouement dans la conversation d'origine — l'action différée
  // s'exécute des heures après l'approbation, sans ça le modèle n'apprend
  // jamais que l'envoi programmé est parti (ou a échoué).
  await recordActionOutcomeMessage(
    ctx.adminClient,
    { id: executionId, conversationId: row.conversation_id ?? null, toolName: row.tool_name, dryRunSummary },
    result.success ? 'executed' : 'failed',
    result,
  );

  return { ...result, executionId };
}

/**
 * Appelé depuis l'UI quand l'user clique "Reject".
 */
export async function rejectToolExecution(
  executionId: string,
  ctx: ToolContext,
  reason?: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: row, error } = await ctx.adminClient
    .from('agent_tool_executions')
    .select('user_id, organization_id, status')
    .eq('id', executionId)
    .single();

  if (error || !row) return { success: false, error: 'Execution not found' };

  if (row.user_id !== ctx.userId || row.organization_id !== ctx.organizationId) {
    return { success: false, error: 'Forbidden' };
  }

  if (row.status !== 'proposed') {
    return { success: false, error: `Cannot reject from status ${row.status}` };
  }

  await ctx.adminClient
    .from('agent_tool_executions')
    .update({
      status: 'rejected',
      user_note: reason ?? null,
    })
    .eq('id', executionId);

  return { success: true };
}

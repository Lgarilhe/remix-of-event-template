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

  // 3. If no approval needed, execute now
  if (!tool.requiresApproval) {
    let result: ExecuteResult;
    try {
      result = await tool.execute(params, ctx);
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : String(err) };
    }

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
        real_result: result as unknown as Record<string, unknown>,
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
 * Appelé depuis l'UI quand l'user clique "Approve" sur un bandeau.
 * Récupère la row, vérifie qu'elle est en 'proposed' ou 'approved', exécute, met à jour.
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

  // Mark as approved (transitionnel, traçable)
  await ctx.adminClient
    .from('agent_tool_executions')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', executionId);

  // Execute
  let result: ExecuteResult;
  try {
    result = await tool.execute(row.params as Record<string, unknown>, ctx);
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

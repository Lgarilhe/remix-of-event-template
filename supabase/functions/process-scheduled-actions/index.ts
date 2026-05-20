// ============================================================================
// process-scheduled-actions — exécute les actions IA queue
// ============================================================================
// Appelé par pg_cron toutes les 2 minutes (cf migration
// 20260520190000_scheduled_agent_actions.sql).
//
// Sélectionne les rows agent_tool_executions avec :
//   - status = 'approved'  (le user a cliqué Approuver dans le bandeau)
//   - scheduled_for <= now()  (le moment est venu)
//   - executed_at IS NULL  (pas déjà exécuté)
//
// Pour chacune : charge le tool du registry, appelle execute(), met à jour
// le statut (executed/failed) et real_result.
//
// Cas d'usage principal : send_linkedin_message approuvé hors plage horaire
// (ex. Laurent à 17h, plage 8h-16h) → scheduled_for=demain 8h → cron envoie
// demain matin.
//
// Auth : PROCESS_SEQUENCES_SECRET (le même que process-sequences pour ne pas
// multiplier les secrets) OU service_role key.
// ============================================================================
//
// Deno.serve direct (pattern du projet)

import { createClient } from "npm:@supabase/supabase-js@2.75.1";
import { executeScheduledAction, type ToolContext } from "../_shared/agent-tools.ts";
import { registerMutatingTools } from "../_shared/agent-tools-mutations.ts";
import { registerReadTools } from "../_shared/agent-tools-reads.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BATCH_LIMIT = 50; // garde-fou : on traite jusqu'à 50 actions par tick (toutes les 2 min → 1500/h plafond théorique)

// Register tools once at module load — `register*` are idempotent (no-op
// after first call) so multiple invocations of the cron stay cheap.
registerReadTools();
registerMutatingTools();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ===== AUTH CHECK =====
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const serviceRoleKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
  const cronSecret = Deno.env.get('PROCESS_SEQUENCES_SECRET') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

  if (!token || (token !== serviceRoleKey && token !== cronSecret)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ===== FETCH DUE ACTIONS =====
  const nowIso = new Date().toISOString();
  const { data: rows, error: selectError } = await supabase
    .from('agent_tool_executions')
    .select('id, tool_name, user_id, organization_id, conversation_id, scheduled_for')
    .eq('status', 'approved')
    .is('executed_at', null)
    .not('scheduled_for', 'is', null)
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(BATCH_LIMIT);

  if (selectError) {
    console.error('[process-scheduled-actions] select error:', selectError);
    return new Response(
      JSON.stringify({ error: 'Database error', detail: selectError.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (!rows || rows.length === 0) {
    return new Response(
      JSON.stringify({ success: true, processed: 0, message: 'No due actions' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  console.log(`[process-scheduled-actions] Processing ${rows.length} due actions`);

  // ===== EXECUTE EACH =====
  const results: Array<{
    id: string;
    tool: string;
    success: boolean;
    error?: string;
  }> = [];

  for (const row of rows as Array<{
    id: string;
    tool_name: string;
    user_id: string;
    organization_id: string;
    conversation_id: string | null;
    scheduled_for: string;
  }>) {
    const ctx: ToolContext = {
      userId: row.user_id,
      organizationId: row.organization_id,
      conversationId: row.conversation_id,
      messageId: null,
      adminClient: supabase,
    };

    try {
      const result = await executeScheduledAction(row.id, ctx);
      results.push({
        id: row.id,
        tool: row.tool_name,
        success: result.success,
        ...(result.success ? {} : { error: result.error ?? 'unknown' }),
      });
      console.log(
        `[process-scheduled-actions] ${row.tool_name} ${row.id} → ${result.success ? 'executed' : 'failed: ' + result.error}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[process-scheduled-actions] ${row.tool_name} ${row.id} CRASHED:`, msg);
      // Mark as failed so the cron doesn't pick it up again
      await supabase
        .from('agent_tool_executions')
        .update({
          status: 'failed',
          real_result: { error: msg, source: 'process-scheduled-actions-crash' } as unknown as Record<string, unknown>,
          executed_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      results.push({ id: row.id, tool: row.tool_name, success: false, error: msg });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  return new Response(
    JSON.stringify({
      success: true,
      processed: results.length,
      success_count: successCount,
      failure_count: results.length - successCount,
      results,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});

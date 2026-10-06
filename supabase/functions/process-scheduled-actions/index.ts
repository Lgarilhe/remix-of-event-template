// Redeploy 2026-06-10 : prise en compte de verify_jwt=false (config.toml) — fix 401 gateway sur l'auth cron.
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
import { executeScheduledAction, recordActionOutcomeMessage, type ToolContext } from "../_shared/agent-tools.ts";
import { registerMutatingTools } from "../_shared/agent-tools-mutations.ts";
import { registerReadTools } from "../_shared/agent-tools-reads.ts";
import { timingSafeEqual } from "../_shared/timing-safe-equal.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Anti-burst LinkedIn (2026-05-20) : réduit de 50 → 10 actions par tick.
// Cron toutes les 2 min → plafond théorique 300/h (vs 1500/h avant) ; en
// pratique on est très en-dessous (cap user = 80/jour). Combiné au jitter
// de nextBusinessHoursStart (0-45 min), les actions se spread naturellement.
const BATCH_LIMIT = 10;
// Sleep aléatoire 5-15s entre deux actions pour humaniser le pacing au
// niveau du cron (en plus du jitter sur scheduled_for à la queue).
function humanDelayMs(): number {
  return Math.floor(Math.random() * 10_000) + 5_000;
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Budget d'une invocation : la fonction est coupée à 60 s. Au-delà de 40 s,
// on ne réserve plus de nouvelle action ; les lignes non réservées repartent
// au passage suivant (SEQ-114). La pause humanisante est aussi bornée par ce
// budget.
const TIME_BUDGET_MS = 40_000;

// Une action réservée (executed_at posé) mais restée 'approved' au-delà de ce
// délai a été interrompue pendant son exécution (invocation coupée) : son
// statut final ne sera jamais écrit, la sélection (executed_at IS NULL) ne la
// reprend pas. On la clôt en 'failed' avec un message explicite, sans la
// rejouer : l'envoi a pu partir.
const STALE_RESERVATION_MS = 10 * 60 * 1000;
const STALE_RESERVATION_MESSAGE = "Délai dépassé : l'action a pu partir, vérifiez avant de relancer";

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

  // Comparaison à temps constant ; les deux secrets restent acceptés (cron
  // PROCESS_SEQUENCES_SECRET et clé de service).
  const authorized = Boolean(token)
    && (timingSafeEqual(token, serviceRoleKey) || (cronSecret !== '' && timingSafeEqual(token, cronSecret)));
  if (!authorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const startedAt = Date.now();

  // ===== RATTRAPAGE DES RÉSERVATIONS INTERROMPUES =====
  const staleRescued = await failStaleReservations(supabase);

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
      JSON.stringify({ success: true, processed: 0, stale_failed: staleRescued, message: 'No due actions' }),
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
  let deferred = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] as {
      id: string;
      tool_name: string;
      user_id: string;
      organization_id: string;
      conversation_id: string | null;
      scheduled_for: string;
    };
    // Délai humanisant entre 2 actions (sauf la 1ère), dans le budget de
    // temps : au-delà, on s'arrête et les actions restantes, non réservées,
    // partent au passage suivant (2 minutes plus tard).
    if (i > 0) {
      const delay = humanDelayMs();
      if (Date.now() - startedAt + delay > TIME_BUDGET_MS) {
        deferred = rows.length - i;
        break;
      }
      await sleep(delay);
    }
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      deferred = rows.length - i;
      break;
    }

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
      deferred,
      stale_failed: staleRescued,
      results,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});

/**
 * Clôt en 'failed' les actions réservées puis interrompues (executed_at posé
 * depuis plus de STALE_RESERVATION_MS, statut toujours 'approved') et trace le
 * dénouement dans la conversation d'origine. Jamais rejouées : l'envoi a pu
 * partir avant la coupure. Non bloquant.
 */
async function failStaleReservations(
  supabase: ToolContext['adminClient'],
): Promise<number> {
  try {
    const cutoffIso = new Date(Date.now() - STALE_RESERVATION_MS).toISOString();
    const { data: stale, error } = await supabase
      .from('agent_tool_executions')
      .select('id, tool_name, conversation_id, dry_run_result')
      .eq('status', 'approved')
      .not('executed_at', 'is', null)
      .lt('executed_at', cutoffIso)
      .limit(BATCH_LIMIT);
    if (error) {
      console.error('[process-scheduled-actions] stale reservations lookup failed:', error);
      return 0;
    }
    let failed = 0;
    for (const row of (stale ?? []) as Array<{
      id: string;
      tool_name: string;
      conversation_id: string | null;
      dry_run_result: Record<string, unknown> | null;
    }>) {
      const { data: closed, error: closeError } = await supabase
        .from('agent_tool_executions')
        .update({
          status: 'failed',
          real_result: { success: false, error: STALE_RESERVATION_MESSAGE, source: 'process-scheduled-actions-timeout' } as unknown as Record<string, unknown>,
        })
        .eq('id', row.id)
        .eq('status', 'approved')
        .lt('executed_at', cutoffIso)
        .select('id');
      if (closeError) {
        console.error(`[process-scheduled-actions] stale reservation ${row.id} not closed:`, closeError);
        continue;
      }
      if (!closed || closed.length === 0) continue;
      failed += 1;
      const summary = typeof row.dry_run_result?.summary === 'string' ? row.dry_run_result.summary : null;
      await recordActionOutcomeMessage(
        supabase,
        { id: row.id, conversationId: row.conversation_id, toolName: row.tool_name, dryRunSummary: summary },
        'failed',
        { success: false, error: STALE_RESERVATION_MESSAGE },
      );
    }
    if (failed > 0) console.warn(`[process-scheduled-actions] ${failed} interrupted action(s) closed as failed`);
    return failed;
  } catch (e) {
    console.error('[process-scheduled-actions] stale reservations rescue failed:', e);
    return 0;
  }
}

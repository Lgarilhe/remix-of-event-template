// ============================================================================
// agent-tool-action — endpoint d'approbation/rejet des tool calls de l'agent IA
// ============================================================================
// Sprint 1 (RAG_AGENT_AUDIT.md §8) — pattern human-in-the-loop.
//
// Body :
//   { execution_id: "uuid", action: "approve" | "reject", reason?: string }
//
// Vérifie que l'user est bien propriétaire de l'execution row, puis exécute
// le tool ou marque comme rejected. Retourne le result.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';
import { requireAuth } from '../_shared/require-auth.ts';
import { confirmToolExecution, rejectToolExecution } from '../_shared/agent-tools.ts';
import { registerMutatingTools } from '../_shared/agent-tools-mutations.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Register tools at module load
registerMutatingTools();

interface RequestBody {
  execution_id?: string;
  action?: 'approve' | 'reject';
  reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    const userId = auth.userId;
    if (!userId) {
      return new Response(JSON.stringify({ error: 'User auth required (service_role not allowed for this endpoint)' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const { execution_id, action, reason } = body;

    if (!execution_id || (action !== 'approve' && action !== 'reject')) {
      return new Response(
        JSON.stringify({ error: 'execution_id and action ("approve"|"reject") are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const adminKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
    const adminClient = createClient(supabaseUrl, adminKey);

    // Resolve org from user (we don't trust the client to send it)
    const { data: profile } = await adminClient
      .from('profiles')
      .select('active_organization_id')
      .eq('user_id', userId)
      .maybeSingle();
    const organizationId = profile?.active_organization_id;
    if (!organizationId) {
      return new Response(JSON.stringify({ error: 'No active organization' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ctx = {
      userId,
      organizationId,
      conversationId: null,
      messageId: null,
      adminClient,
    };

    if (action === 'approve') {
      const result = await confirmToolExecution(execution_id, ctx);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // action === 'reject'
    const result = await rejectToolExecution(execution_id, ctx, reason);
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[agent-tool-action] error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

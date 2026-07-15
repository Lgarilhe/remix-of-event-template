/**
 * Edge Function: sequence-snippets-crud
 *
 * CRUD for reusable text snippets used in sequence messages.
 * GET    — list snippets by org (optional category filter)
 * POST   — create a snippet
 * PATCH  — update a snippet
 * DELETE — delete a snippet
 */
import { createClient } from "npm:@supabase/supabase-js@2.75.1";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireAuth(req, corsHeaders);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get user's org — profiles n'a PAS de colonne organization_id : c'est
    // active_organization_id, clé user_id. L'ancienne requête échouait
    // silencieusement → orgId null → 403 pour tout le monde (audit 2026-07).
    let orgId: string | null = null;
    if (auth.userId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_organization_id')
        .eq('user_id', auth.userId)
        .single();
      orgId = profile?.active_organization_id || null;
    }

    if (!orgId) {
      return new Response(JSON.stringify({ error: 'No organization' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);

    // ── GET: List snippets ──
    if (req.method === 'GET') {
      let query = supabase
        .from('sequence_snippets')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      const category = url.searchParams.get('category');
      if (category) {
        query = query.eq('category', category);
      }

      const { data, error } = await query;
      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── POST: Create snippet ──
    if (req.method === 'POST') {
      const body = await req.json();
      const { name, content, category } = body;

      if (!name || !content) {
        return new Response(JSON.stringify({ error: 'name and content required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data, error } = await supabase
        .from('sequence_snippets')
        .insert({
          organization_id: orgId,
          name,
          content,
          category: category || null,
          created_by: auth.userId,
        })
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify(data), {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── PATCH: Update snippet ──
    if (req.method === 'PATCH') {
      const body = await req.json();
      const { id, name, content, category } = body;

      if (!id) {
        return new Response(JSON.stringify({ error: 'id required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (content !== undefined) updates.content = content;
      if (category !== undefined) updates.category = category;

      const { data, error } = await supabase
        .from('sequence_snippets')
        .update(updates)
        .eq('id', id)
        .eq('organization_id', orgId)
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── DELETE: Delete snippet ──
    if (req.method === 'DELETE') {
      const body = await req.json();
      const { id } = body;

      if (!id) {
        return new Response(JSON.stringify({ error: 'id required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error } = await supabase
        .from('sequence_snippets')
        .delete()
        .eq('id', id)
        .eq('organization_id', orgId);

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sequence-snippets-crud] Error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

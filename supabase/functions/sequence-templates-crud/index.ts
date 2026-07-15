/**
 * Edge Function: sequence-templates-crud
 *
 * CRUD for sequence templates.
 * GET    — list templates (filter by org, category, is_system)
 * POST   — create a template (snapshot steps from existing sequence)
 * PATCH  — update a template
 * DELETE — delete a template (not is_system)
 */
import { createClient } from "npm:@supabase/supabase-js@2.75.1";
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireAuth(req, corsHeaders);

    // Use service role for reads (RLS handles access), user token for context
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get user's org — profiles n'a PAS de colonne organization_id : c'est
    // active_organization_id, et la clé user est user_id (pas id). L'ancienne
    // requête échouait silencieusement → orgId toujours null → tout le CRUD
    // non-système était inerte (audit 2026-07, Builder H5).
    let orgId: string | null = null;
    if (auth.userId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_organization_id')
        .eq('user_id', auth.userId)
        .single();
      orgId = profile?.active_organization_id || null;
    }

    const url = new URL(req.url);

    // ── GET: List templates ──
    if (req.method === 'GET') {
      let query = supabase.from('sequence_templates').select('*');

      // Filter by org (own + system templates)
      if (orgId) {
        query = query.or(`organization_id.eq.${orgId},is_system.eq.true`);
      } else {
        query = query.eq('is_system', true);
      }

      // Optional category filter
      const category = url.searchParams.get('category');
      if (category) {
        query = query.eq('category', category);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── POST: Create template ──
    if (req.method === 'POST') {
      if (!orgId) {
        return new Response(JSON.stringify({ error: 'No organization' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const body = await req.json();
      const { name, description, steps_config, category, sequence_id } = body;

      let stepsConfig = steps_config;

      // If sequence_id provided, snapshot its steps
      if (sequence_id && !stepsConfig) {
        const { data: steps, error: stepsError } = await supabase
          .from('sequence_steps')
          .select('step_order, action_type, condition_type, delay_days, delay_hours, delay_minutes, timeout_days, wait_for_event, preferred_hour_start, preferred_hour_end, subject_template, message_template, use_ai_personalization, ai_tone, step_channel, ai_personalization_source, ai_personalization_prompt, include_unsubscribe, parent_step_id, branch, cc_emails, bcc_emails')
          .eq('sequence_id', sequence_id)
          .eq('organization_id', orgId)
          .order('step_order', { ascending: true });

        if (stepsError) throw stepsError;
        stepsConfig = steps || [];
      }

      if (!name || !stepsConfig) {
        return new Response(JSON.stringify({ error: 'name and steps_config (or sequence_id) required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data, error } = await supabase
        .from('sequence_templates')
        .insert({
          organization_id: orgId,
          name,
          description: description || null,
          steps_config: stepsConfig,
          category: category || 'custom',
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

    // ── PATCH: Update template ──
    if (req.method === 'PATCH') {
      const body = await req.json();
      const { id, name, description, steps_config, category } = body;

      if (!id) {
        return new Response(JSON.stringify({ error: 'id required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Verify ownership : seul le propriétaire de l'org peut modifier ses
      // templates. Les system templates (is_system=true) sont partagés
      // cross-tenant et ne doivent JAMAIS être éditables côté tenant.
      const { data: existing } = await supabase
        .from('sequence_templates')
        .select('organization_id, is_system')
        .eq('id', id)
        .single();

      if (!existing || existing.is_system || existing.organization_id !== orgId) {
        return new Response(JSON.stringify({ error: 'Not found or not authorized' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (steps_config !== undefined) updates.steps_config = steps_config;
      if (category !== undefined) updates.category = category;

      // Re-filtre par organization_id pour fermer la fenêtre TOCTOU entre
      // le SELECT ci-dessus et l'UPDATE.
      const { data, error } = await supabase
        .from('sequence_templates')
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

    // ── DELETE: Delete template ──
    if (req.method === 'DELETE') {
      const body = await req.json();
      const { id } = body;

      if (!id) {
        return new Response(JSON.stringify({ error: 'id required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Verify ownership and not system
      const { data: existing } = await supabase
        .from('sequence_templates')
        .select('organization_id, is_system')
        .eq('id', id)
        .single();

      if (!existing || existing.organization_id !== orgId) {
        return new Response(JSON.stringify({ error: 'Not found or not authorized' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (existing.is_system) {
        return new Response(JSON.stringify({ error: 'Cannot delete system templates' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error } = await supabase
        .from('sequence_templates')
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
    if (err instanceof Response) return err; // Auth error
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sequence-templates-crud] Error:', message);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

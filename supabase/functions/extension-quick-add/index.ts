/**
 * extension-quick-add — ajoute rapidement un profil LinkedIn au pipeline d'une mission.
 *
 * Body :
 *   - linkedin_url (string, requis) : URL du profil LinkedIn
 *   - name, headline, profile_picture_url (optionnels) : metadata captured par content script
 *   - job_id (requis) : mission (id de sourcing_projects, avec ou sans « project: »)
 *   - note (optionnel) : note à attacher
 *
 * Auth : token extension.
 *
 * Refonte mission, lot 0b-4 : insère une ligne À trier dans la mission de
 * l'organisation (job_id « project:<id> », project_id). Idempotent : une ligne
 * déjà présente pour cet utilisateur, cette mission et ce candidat est gardée
 * telle quelle (ignoreDuplicates), son étape n'est jamais réécrite.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';
import { tryExtensionAuth } from '../_shared/verify-extension-token.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-konekt-extension-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractLinkedInSlug(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('linkedin.com')) return null;
    const match = u.pathname.match(/\/in\/([^/?#]+)/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const auth = await tryExtensionAuth(req, body);
    if (!auth) {
      return new Response(JSON.stringify({ error: 'Token extension requis' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const linkedinUrl = typeof body?.linkedin_url === 'string' ? body.linkedin_url.trim() : '';
    if (!linkedinUrl) {
      return new Response(JSON.stringify({ error: 'linkedin_url requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const slug = extractLinkedInSlug(linkedinUrl);
    if (!slug) {
      return new Response(JSON.stringify({ error: 'URL LinkedIn invalide (format /in/...)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const candidateId = `linkedin:${slug}`;
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : null;
    const headline = typeof body?.headline === 'string' && body.headline.trim() ? body.headline.trim() : null;
    const rawJobId = typeof body?.job_id === 'string' ? body.job_id.trim().replace(/^project:/, '') : '';
    const projectId = UUID_RE.test(rawJobId) ? rawJobId.toLowerCase() : null;
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
    );

    if (!projectId) {
      return new Response(JSON.stringify({ error: 'Choisissez une mission' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // La mission doit appartenir à l'organisation du jeton.
    const { data: mission, error: missionError } = await supabase
      .from('sourcing_projects')
      .select('id')
      .eq('id', projectId)
      .eq('organization_id', auth.organizationId)
      .maybeSingle();
    if (missionError) {
      console.error('[extension-quick-add] mission lookup error:', missionError);
      return new Response(JSON.stringify({ error: 'Erreur lors de l\'ajout' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!mission) {
      return new Response(JSON.stringify({ error: 'Mission introuvable ou accès refusé' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insertion À trier (sans status : valeur par défaut), jamais de mise à
    // jour d'une ligne existante.
    const { data: upserted, error: upsertError } = await supabase
      .from('job_candidate_status')
      .upsert({
        job_id: `project:${projectId}`,
        project_id: projectId,
        candidate_id: candidateId,
        candidate_name: name,
        candidate_headline: headline,
        linkedin_profile_url: linkedinUrl,
        created_by: auth.userId,
        organization_id: auth.organizationId,
      }, {
        onConflict: 'job_id,candidate_id,created_by',
        ignoreDuplicates: true,
      })
      .select('id')
      .maybeSingle();

    if (upsertError) {
      console.error('[extension-quick-add] upsert error:', upsertError);
      return new Response(JSON.stringify({ error: 'Erreur lors de l\'ajout' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Si une note est fournie, l'attacher via candidate_reminders / candidate_notes table
    if (note) {
      try {
        await supabase
          .from('candidate_reminders')
          .insert({
            candidate_id: candidateId,
            candidate_name: name,
            title: '📝 Note via extension Chrome',
            description: note,
            due_at: new Date().toISOString(),
            completed_at: new Date().toISOString(), // déjà fait, c'est juste une note
            created_by: auth.userId,
          });
      } catch (e) {
        console.warn('[extension-quick-add] note attach failed:', e);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        candidate_id: candidateId,
        already_in_pipeline: !upserted, // si upserted null = ignoreDuplicates a sauté = déjà existait
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    console.error('[extension-quick-add] error:', e);
    const status = e?.status === 401 ? 401 : 500;
    return new Response(JSON.stringify({ error: e?.message || 'Erreur serveur' }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

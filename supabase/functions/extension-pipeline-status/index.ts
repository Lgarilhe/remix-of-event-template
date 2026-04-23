/**
 * extension-pipeline-status — endpoint batch pour le content script LinkedIn.
 *
 * Reçoit une liste de LinkedIn URLs (jusqu'à 100) et retourne pour chacune le
 * status pipeline Konekt si le candidat est connu :
 *   - status: 'discovered' | 'scored' | 'messaged' | 'replied' | 'shortlisted' | 'dismissed'
 *   - pipeline_stage: 'Nouveau' | 'Contacté' | 'Répondu' | ... | 'Gagné' | 'Perdu'
 *   - score: number | null
 *   - mission_title: string | null
 *
 * Permet à l'extension d'overlayer des badges sur les résultats de search LinkedIn
 * pour signaler "déjà en pipeline" — anti-doublon massif.
 *
 * Auth : token extension (X-Konekt-Extension-Token).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';
import { tryExtensionAuth } from '../_shared/verify-extension-token.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-konekt-extension-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/**
 * Extrait le slug LinkedIn d'une URL (ex: https://www.linkedin.com/in/jean-dupont-12345/)
 * → 'jean-dupont-12345'. Tolérant aux variantes (with/without www, /).
 */
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

    const urls = Array.isArray(body?.urls) ? body.urls : [];
    if (urls.length === 0) {
      return new Response(JSON.stringify({ success: true, statuses: {} }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (urls.length > 100) {
      return new Response(JSON.stringify({ error: 'Maximum 100 URLs par batch' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract slugs
    const slugMap = new Map<string, string>(); // slug → original URL
    for (const url of urls) {
      if (typeof url !== 'string') continue;
      const slug = extractLinkedInSlug(url);
      if (slug) slugMap.set(slug, url);
    }

    if (slugMap.size === 0) {
      return new Response(JSON.stringify({ success: true, statuses: {} }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
    );

    // job_candidate_status stocke linkedin_profile_url. On filtre par ILIKE %slug% pour
    // matcher les variantes (avec/sans /, query params, etc.)
    // Pour 100 slugs, c'est 100 conditions OR dans une seule query — Postgres tient.
    const slugConditions = Array.from(slugMap.keys())
      .map((slug) => `linkedin_profile_url.ilike.%/${slug}%`)
      .join(',');

    const { data: rows, error } = await supabase
      .from('job_candidate_status')
      .select('linkedin_profile_url, status, pipeline_stage, score, recommendation, job_id')
      .eq('organization_id', auth.organizationId)
      .or(slugConditions);

    if (error) {
      console.error('[extension-pipeline-status] DB error:', error);
      return new Response(JSON.stringify({ error: 'Erreur DB' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Map slug -> data (prend la row la plus pertinente : prio "messaged"/"replied" sur "discovered")
    const STATUS_PRIORITY: Record<string, number> = {
      shortlisted: 5,
      replied: 4,
      messaged: 3,
      scored: 2,
      discovered: 1,
      dismissed: 0,
    };

    const slugToData = new Map<string, any>();
    for (const row of rows ?? []) {
      const url = row.linkedin_profile_url;
      if (!url) continue;
      const slug = extractLinkedInSlug(url);
      if (!slug || !slugMap.has(slug)) continue;

      const existing = slugToData.get(slug);
      if (!existing) {
        slugToData.set(slug, row);
        continue;
      }
      const newPrio = STATUS_PRIORITY[row.status] ?? -1;
      const existingPrio = STATUS_PRIORITY[existing.status] ?? -1;
      if (newPrio > existingPrio) {
        slugToData.set(slug, row);
      }
    }

    // Récup job titles pour ceux qui ont un job_id (en une seule query)
    const jobIds = Array.from(slugToData.values()).map((r) => r.job_id).filter(Boolean);
    const jobTitleMap = new Map<string, string>();
    if (jobIds.length > 0) {
      const { data: jobs } = await supabase
        .from('search_history')
        .select('job_id, job_title')
        .in('job_id', jobIds);
      for (const j of jobs ?? []) {
        if (j.job_title) jobTitleMap.set(j.job_id, j.job_title);
      }
    }

    // Build response : original URL → status
    const statuses: Record<string, {
      status: string;
      pipeline_stage: string | null;
      score: number | null;
      recommendation: string | null;
      mission_title: string | null;
    }> = {};

    for (const [slug, originalUrl] of slugMap.entries()) {
      const row = slugToData.get(slug);
      if (!row) continue;
      statuses[originalUrl] = {
        status: row.status,
        pipeline_stage: row.pipeline_stage,
        score: row.score,
        recommendation: row.recommendation,
        mission_title: row.job_id ? (jobTitleMap.get(row.job_id) ?? null) : null,
      };
    }

    return new Response(
      JSON.stringify({ success: true, statuses, total_known: Object.keys(statuses).length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    console.error('[extension-pipeline-status] error:', e);
    const status = e?.status === 401 ? 401 : 500;
    return new Response(JSON.stringify({ error: e?.message || 'Erreur serveur' }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

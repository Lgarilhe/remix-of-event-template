// @ts-nocheck serve import removed
// add-to-shortlist ne pose plus que le statut Konekt du candidat (job_candidate_status).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface AddToShortlistData {
  jobId?: string;
  linkedinId?: string;
  linkedinUrl?: string;
  name?: string;
  headline?: string;
  etape?: string;             // Pressenti, Contacté, etc.
}

// ── job_candidate_status sync ───────────────────────────────────────
// Écrit le statut Konekt. Historiquement c'était un UPDATE par égalité
// stricte d'URL qui ne matchait jamais (formats d'URL
// différents entre le stockage et le payload) → 0 ligne 'shortlisted' en base
// et la pill Shortlist du sourcing restait vide.

// Stages qu'un simple « message envoyé » (etape Contacté) a le droit d'écraser.
// Tout autre stage (Répondu, Pré-qualif, CV envoyé, ITW en cours, Offre, Gagné,
// Perdu, ou valeur inconnue type « Qualification ») est considéré plus
// avancé → intouchable. Complément de la liste advancedStages
// d'auto-analyze-message. Pressenti (rang 3 du kanban, au-dessus de Répondu)
// est protégé aussi : un shortlisté qui reçoit son premier message le garde.
const CONTACT_OVERWRITABLE_STAGES = new Set<string>(['Nouveau', 'Contacté']);
// Statuts Konekt qui verrouillent le flux Contacté même sans pipeline_stage
// explicite (le kanban dérive « Répondu » de status='replied').
const CONTACT_LOCKED_STATUSES = new Set<string>(['replied', 'dismissed']);
function canOverwriteWithContact(stage: string | null | undefined): boolean {
  return !stage || CONTACT_OVERWRITABLE_STAGES.has(stage);
}
// Même règle pour « Shortlister » (Pressenti) : seuls Nouveau, Contacté et
// Répondu montent en Pressenti. Une étape plus avancée (étape de mission,
// ITW en cours, Offre…), un candidat déjà shortlisté ou écarté restent tels quels.
const SHORTLIST_OVERWRITABLE_STAGES = new Set<string>(['Nouveau', 'Contacté', 'Répondu']);
const SHORTLIST_LOCKED_STATUSES = new Set<string>(['shortlisted', 'dismissed']);
function canOverwriteWithShortlist(stage: string | null | undefined, status: string | null | undefined): boolean {
  return (!stage || SHORTLIST_OVERWRITABLE_STAGES.has(stage)) && !SHORTLIST_LOCKED_STATUSES.has(status || '');
}
type JcsRow = { id: string; pipeline_stage: string | null; status: string | null };

interface JcsSyncInput {
  organizationId: string;
  userId: string;
  jobId?: string;
  linkedinId?: string;
  linkedinUrl?: string;
  name?: string;
  headline?: string;
  etape?: string;
}

// alreadyExists : le candidat était déjà suivi plus loin sur cette mission,
// rien n'a été réécrit.
async function syncCandidateStatus(input: JcsSyncInput): Promise<{ alreadyExists: boolean }> {
  try {
    // Le flux "message envoyé" (etape Contacté) ne doit PAS marquer shortlisted
    // : le statut messaged est posé par ailleurs.
    const isShortlistIntent = input.etape !== 'Contacté';

    // job_id normalisé sans préfixe "project:" (même convention que
    // l'inscription en séquence ; le sourcing lit les 2 formes).
    const normalizedJobId = input.jobId?.startsWith('project:')
      ? input.jobId.slice('project:'.length)
      : input.jobId;

    // 1. Voie fiable : par candidate_id. Une ligne déjà suivie dans
    //    l'organisation (job_id avec ou sans préfixe, quel que soit son auteur)
    //    est mise à jour sans rétrogradation plutôt que dupliquée ; sinon upsert
    //    par (job_id, candidate_id, created_by).
    if (isShortlistIntent && normalizedJobId && input.linkedinId) {
      const { data: existing, error: existingErr } = await supabase
        .from('job_candidate_status')
        .select('id, pipeline_stage, status')
        .eq('organization_id', input.organizationId)
        .eq('candidate_id', input.linkedinId)
        .in('job_id', [normalizedJobId, `project:${normalizedJobId}`]);
      if (existingErr) {
        console.warn('[add-to-shortlist] jcs lookup failed:', existingErr.message);
        return { alreadyExists: false };
      }
      if (existing && existing.length > 0) {
        const targets = existing.filter((r: JcsRow) => canOverwriteWithShortlist(r.pipeline_stage, r.status));
        if (targets.length === 0) {
          console.log('[add-to-shortlist] jcs: already tracked further, nothing rewritten');
          return { alreadyExists: true };
        }
        const { error: updErr } = await supabase
          .from('job_candidate_status')
          .update({ status: 'shortlisted', pipeline_stage: input.etape || 'Pressenti' })
          .in('id', targets.map((r: JcsRow) => r.id));
        if (updErr) console.warn('[add-to-shortlist] jcs update failed:', updErr.message);
        return { alreadyExists: false };
      }
      const { error } = await supabase
        .from('job_candidate_status')
        .upsert({
          job_id: normalizedJobId,
          candidate_id: input.linkedinId,
          created_by: input.userId,
          organization_id: input.organizationId,
          status: 'shortlisted',
          pipeline_stage: input.etape || 'Pressenti',
          ...(input.name ? { candidate_name: input.name } : {}),
          ...(input.headline ? { candidate_headline: input.headline } : {}),
          ...(input.linkedinUrl ? { linkedin_profile_url: input.linkedinUrl } : {}),
        }, { onConflict: 'job_id,candidate_id,created_by' });
      if (error) {
        console.warn('[add-to-shortlist] jcs upsert failed:', error.message);
      } else {
        console.log('[add-to-shortlist] jcs upserted (candidate_id match)');
        return { alreadyExists: false };
      }
    }

    // 2. Fallback : update des lignes existantes par slug LinkedIn (les URLs
    //    varient — www/locale/trailing slash — l'égalité stricte ne matche pas).
    //    Restreint au job fourni quand il existe (sinon toutes les missions de
    //    l'org étaient touchées) et, dans le flux Contacté, aux lignes dont le
    //    stage courant n'est pas déjà plus avancé.
    if (!input.linkedinUrl) return { alreadyExists: false };
    const slug = input.linkedinUrl.match(/\/in\/([^/?#]+)/i)?.[1];
    let lookup = supabase
      .from('job_candidate_status')
      .select('id, pipeline_stage, status')
      .eq('organization_id', input.organizationId);
    if (normalizedJobId) {
      // Les 2 formes coexistent en base (avec/sans préfixe project:)
      lookup = lookup.in('job_id', [normalizedJobId, `project:${normalizedJobId}`]);
    }
    if (slug && !/[%_]/.test(slug)) {
      lookup = lookup.ilike('linkedin_profile_url', `%/in/${slug}%`);
    } else {
      lookup = lookup.eq('linkedin_profile_url', input.linkedinUrl);
    }
    const { data: rows, error: lookupErr } = await lookup;
    if (lookupErr) {
      console.warn('[add-to-shortlist] jcs lookup failed:', lookupErr.message);
      return { alreadyExists: false };
    }
    const targets = (rows || []).filter((r: JcsRow) => isShortlistIntent
      ? canOverwriteWithShortlist(r.pipeline_stage, r.status)
      : canOverwriteWithContact(r.pipeline_stage) && !CONTACT_LOCKED_STATUSES.has(r.status || ''));
    if (targets.length === 0) {
      console.log(`[add-to-shortlist] jcs: ${rows?.length || 0} rows matched, 0 to update (url match)`);
      return { alreadyExists: isShortlistIntent && (rows?.length || 0) > 0 };
    }
    const updatePayload: Record<string, unknown> = {
      ...(isShortlistIntent ? { status: 'shortlisted' } : {}),
      pipeline_stage: input.etape || 'Pressenti',
    };
    const { error: updErr } = await supabase
      .from('job_candidate_status')
      .update(updatePayload)
      .in('id', targets.map((r: { id: string }) => r.id));
    if (updErr) {
      console.warn('[add-to-shortlist] jcs update failed:', updErr.message);
    } else {
      console.log(`[add-to-shortlist] jcs updated ${targets.length} rows (url match)`);
    }
    return { alreadyExists: false };
  } catch (syncErr) {
    // Best-effort, non bloquant
    console.warn('[add-to-shortlist] jcs sync error (non-blocking):', syncErr);
    return { alreadyExists: false };
  }
}

// ── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth: validate JWT and org membership ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const data: AddToShortlistData & { organization_id?: string } = await req.json();

    if (data.organization_id) {
      const { data: membership } = await supabase
        .from('organization_members')
        .select('id')
        .eq('user_id', user.id)
        .eq('organization_id', data.organization_id)
        .maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    if (!data.organization_id) throw new Error('organization_id est requis');

    const { alreadyExists } = await syncCandidateStatus({
      organizationId: data.organization_id,
      userId: user.id,
      jobId: data.jobId,
      linkedinId: data.linkedinId,
      linkedinUrl: data.linkedinUrl,
      name: data.name,
      headline: data.headline,
      etape: data.etape,
    });

    return new Response(
      JSON.stringify({ success: true, ...(alreadyExists ? { alreadyExists: true } : {}) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error adding to shortlist:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

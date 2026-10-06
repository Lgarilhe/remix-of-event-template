// @ts-nocheck serve import removed
// add-to-shortlist : « Retenir » un candidat dans une mission (refonte mission,
// lot 0b-4). L'étape passe par apply_mission_candidate_stage (origine 'user') :
// plus aucune écriture directe de status ni de pipeline_stage.
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
  etape?: string;             // « Contacté » : ignoré depuis le lot 0b-4
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Étapes depuis lesquelles « Retenir » s'applique : un candidat déjà contacté,
// en échange ou en entretien reste à son étape (résultat skipped).
const RETAIN_FROM_STAGES = ['to_sort', 'retained', 'rejected'];

// Mission : id de sourcing_projects, avec ou sans le préfixe « project: ».
function missionIdOf(jobId: unknown): string | null {
  const raw = typeof jobId === 'string' ? jobId.trim().replace(/^project:/, '') : '';
  return UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
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

    // « Contacté » : posé par le serveur à l'envoi réel (lot 0b-2a), plus ici.
    if (data.etape === 'Contacté') {
      return jsonResponse({ success: true, ignored: 'contact' });
    }

    const projectId = missionIdOf(data.jobId);
    if (!projectId) {
      return jsonResponse({ success: false, error: 'Choisissez une mission' }, 400);
    }
    const linkedinId = typeof data.linkedinId === 'string' ? data.linkedinId.trim() : '';
    const linkedinUrl = typeof data.linkedinUrl === 'string' ? data.linkedinUrl.trim() : '';
    if (!linkedinId && !linkedinUrl) {
      return jsonResponse({ success: false, error: 'Profil du candidat introuvable' }, 400);
    }

    // Lignes du candidat dans la mission, tous auteurs (la ligne déjà suivie
    // est reprise, jamais doublée) ; une ligne À trier au nom de l'appelant
    // n'est créée que si la mission n'en a aucune. Puis Retenu depuis À trier,
    // Retenu ou Écarté. La mission est contrôlée dans l'organisation par la fonction.
    const { data: applied, error: applyError } = await supabase.rpc('apply_mission_candidate_stage', {
      p_organization_id: data.organization_id,
      p_project_id: projectId,
      p_candidate: {
        ids: linkedinId ? [linkedinId] : [],
        ...(linkedinUrl ? { profile_url: linkedinUrl } : {}),
        ...(data.name ? { name: data.name } : {}),
        ...(data.headline ? { headline: data.headline } : {}),
      },
      p_stage: 'retained',
      p_source: 'user',
      p_process_step_id: null,
      p_legacy_stage: null,
      p_from_stages: RETAIN_FROM_STAGES,
      p_create_by: user.id,
      p_only_created_by: null,
    });
    if (applyError) {
      console.warn('[add-to-shortlist] apply_mission_candidate_stage failed:', applyError.message, applyError.hint);
      if (applyError.hint === 'STAGE_MISSION_NOT_FOUND') {
        return jsonResponse({ success: false, error: 'Mission introuvable' }, 404);
      }
      return jsonResponse({ success: false, error: "Le candidat n'a pas été ajouté" }, 500);
    }

    const rows: Array<{ result?: string }> = Array.isArray(applied?.rows) ? applied.rows : [];
    if (rows.length === 0) {
      // Aucune ligne trouvée ni créable (profil sans identifiant stable).
      return jsonResponse({ success: false, error: "Le candidat n'a pas été ajouté" }, 422);
    }
    if (rows.every((r) => r.result === 'error')) {
      return jsonResponse({ success: false, error: "Le candidat n'a pas été ajouté" }, 409);
    }
    // alreadyExists : le candidat était déjà suivi plus loin sur cette mission,
    // son étape n'a pas changé.
    const alreadyExists = rows.every((r) => r.result === 'skipped');

    return jsonResponse({ success: true, ...(alreadyExists ? { alreadyExists: true } : {}) });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error adding to shortlist:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

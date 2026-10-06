/**
 * Analyse d'un appel à partir de sa transcription : résumé, étiquettes, ce que
 * le correspondant a dit, suites à donner, lien avec la mission du candidat.
 *
 * POST { organization_id, call_id, force?, fetch_transcript? }, deux appelants :
 *   - aircall-webhook (clé de service), dès qu'une transcription est gardée ;
 *   - un membre de l'organisation (JWT) : « Analyser à nouveau » (`force`), relance
 *     d'une analyse en échec, ou transcription d'un appel reçu avant l'abonnement
 *     à l'événement (`fetch_transcript`).
 *
 * Ne fait qu'écrire l'analyse (phone_call_insights). Rien ne part vers un
 * candidat, rien ne change dans son dossier : les suites sont des suggestions
 * affichées, à appliquer par une personne.
 *
 * Crédits : refus avant l'appel au modèle (assertCredits), débit après. Un appel
 * automatique est imputé à la personne qui a relié Aircall (à défaut, un
 * propriétaire de l'organisation), un appel manuel à son auteur.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';
type SupabaseClient = ReturnType<typeof createClient>;
import { requireAuth, verifyOrgMembership } from '../_shared/require-auth.ts';
import { callClaudeCompat } from '../_shared/call-claude.ts';
import { settleClaudeUsage } from '../_shared/settle-usage.ts';
import { assertCredits, creditGateResponse } from '../_shared/credit-guard.ts';
import { ingestAircallTranscript } from '../_shared/aircall-transcript-ingest.ts';
import { transcriptLength, transcriptToText, type Utterance } from '../_shared/aircall-transcript.ts';
import {
  MIN_TRANSCRIPT_CHARS,
  buildAnalysisPrompt,
  candidateIdForNumber,
  parseCallInsight,
  pickMissions,
  type CandidateContext,
  type MissionRow,
} from '../_shared/phone-call-insight.ts';

const AI_ACTION = 'phone_call_analysis';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTACTS_PAGE = 1000;
const MAX_CONTACT_PAGES = 20;

/**
 * Le candidat de l'organisation dont le numéro est celui de l'appel, et ses
 * missions. Rien si le numéro ne désigne qu'un seul candidat sans certitude :
 * l'analyse se fait alors sans contexte, jamais avec celui d'un autre.
 */
async function loadCandidateContext(admin: SupabaseClient, organizationId: string, numberE164: string | null): Promise<CandidateContext | null> {
  if (!numberE164) return null;

  const contacts: Array<{ candidate_id: string; phone: string | null }> = [];
  for (let page = 0; page < MAX_CONTACT_PAGES; page += 1) {
    const { data, error } = await admin
      .from('candidate_contacts')
      .select('candidate_id, phone')
      .eq('organization_id', organizationId)
      .not('phone', 'is', null)
      .order('candidate_id', { ascending: true })
      .range(page * CONTACTS_PAGE, (page + 1) * CONTACTS_PAGE - 1);
    if (error) throw error;
    contacts.push(...(data ?? []));
    if ((data?.length ?? 0) < CONTACTS_PAGE) break;
  }
  const candidateId = candidateIdForNumber(contacts, numberE164);
  if (!candidateId) return null;

  const { data: rows, error: rowsError } = await admin
    .from('job_candidate_status')
    .select('candidate_name, candidate_headline, project_id, general_stage')
    .eq('organization_id', organizationId)
    .eq('candidate_id', candidateId)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (rowsError) throw rowsError;
  const candidateRows = (rows ?? []) as Array<{ candidate_name: string | null; candidate_headline: string | null; project_id: string | null; general_stage: string | null }>;

  const projectIds = [...new Set(candidateRows.map((r) => r.project_id).filter((id): id is string => !!id))];
  const projects = new Map<string, MissionRow>();
  if (projectIds.length > 0) {
    const { data: projectRows, error: projectError } = await admin
      .from('sourcing_projects')
      .select('id, name, job_title, client_name, job_details')
      .eq('organization_id', organizationId)
      .eq('kind', 'mission')
      .in('id', projectIds.slice(0, 200));
    if (projectError) throw projectError;
    for (const p of (projectRows ?? []) as MissionRow[]) projects.set(p.id, p);
  }

  return {
    name: candidateRows.find((r) => r.candidate_name)?.candidate_name ?? null,
    headline: candidateRows.find((r) => r.candidate_headline)?.candidate_headline ?? null,
    missions: pickMissions(candidateRows, projects),
  };
}

/** Qui paie une analyse lancée sans personne devant l'écran : celui qui a relié Aircall, sinon un propriétaire. */
async function automaticPayer(admin: SupabaseClient, organizationId: string): Promise<string | null> {
  const { data: connection } = await admin
    .from('telephony_connections')
    .select('connected_by')
    .eq('organization_id', organizationId)
    .eq('provider', 'aircall')
    .maybeSingle();
  if (connection?.connected_by) return connection.connected_by as string;
  const { data: owner } = await admin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();
  return (owner?.user_id as string | undefined) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let auth;
  try {
    auth = await requireAuth(req, corsHeaders);
  } catch (authResponse) {
    return authResponse as Response;
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const organizationId = typeof body?.organization_id === 'string' ? body.organization_id : '';
  const callId = typeof body?.call_id === 'string' ? body.call_id : '';
  if (!UUID_RE.test(organizationId) || !UUID_RE.test(callId)) {
    return json({ error: 'Requête invalide.', error_code: 'INVALID_BODY' }, 400);
  }
  const force = body?.force === true;
  const fetchTranscript = body?.fetch_transcript === true;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
  );

  try {
    if (auth.userId) {
      if (!(await verifyOrgMembership(admin as never, auth.userId, organizationId))) {
        return json({ error: "Vous n'êtes pas membre de cette organisation.", error_code: 'FORBIDDEN' }, 403);
      }
      const { data: allowed } = await admin.rpc('check_rate_limit', {
        p_user_id: auth.userId, p_action: 'analyze_phone_call', p_max_requests: 30, p_window_seconds: 60,
      });
      if (allowed === false) return json({ error: 'Trop de demandes. Patientez quelques secondes.', error_code: 'RATE_LIMIT' }, 429);
    }

    const { data: call, error: callError } = await admin
      .from('phone_calls')
      .select('id, external_id, direction, started_at, talk_seconds, contact_name, contact_number_e164, agent_name')
      .eq('id', callId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (callError) throw callError;
    if (!call) return json({ error: 'Appel introuvable.', error_code: 'CALL_NOT_FOUND' }, 404);

    const readTranscript = async () => {
      const { data, error } = await admin
        .from('phone_call_transcripts')
        .select('utterances')
        .eq('call_id', callId)
        .maybeSingle();
      if (error) throw error;
      return (data?.utterances as Utterance[] | undefined) ?? null;
    };

    let utterances = await readTranscript();
    if (!utterances && fetchTranscript && auth.userId) {
      const ingested = await ingestAircallTranscript(admin, organizationId, call.external_id as string);
      if (ingested.status === 'stored') utterances = await readTranscript();
      else return json({ status: 'no_transcript', reason: ingested.status });
    }
    if (!utterances) return json({ status: 'no_transcript', reason: 'none' });

    // Une seule analyse à la fois par appel : un événement rejoué ne la refait ni ne la refacture.
    const { data: claimed, error: claimError } = await admin.rpc('claim_phone_call_analysis', {
      p_organization_id: organizationId, p_call_id: callId, p_force: force,
    });
    if (claimError) throw claimError;
    if (claimed !== true) return json({ status: 'busy' });

    const finish = async (patch: Record<string, unknown>) => {
      const { error } = await admin
        .from('phone_call_insights')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('call_id', callId)
        .eq('organization_id', organizationId);
      if (error) console.error('[analyze-phone-call] état non écrit:', error.message);
    };

    if (transcriptLength(utterances) < MIN_TRANSCRIPT_CHARS) {
      await finish({ status: 'skipped', reason: 'too_short' });
      return json({ status: 'skipped', reason: 'too_short' });
    }

    const payer = auth.userId ?? await automaticPayer(admin, organizationId);
    // Refus avant l'appel au modèle : une organisation sans crédit garde l'analyse en échec, relançable.
    // modelId : l'appel passe par callClaudeCompat sans champ model, donc Haiku (cf _shared/call-claude.ts).
    const gate = await assertCredits({
      userId: payer, organizationId, aiAction: AI_ACTION, modelId: 'claude-haiku-4-5', systemCall: false, adminClient: admin as never,
    });
    if (!gate.ok) {
      await finish({ status: 'failed', reason: 'insufficient_credits' });
      return creditGateResponse(gate, corsHeaders);
    }

    try {
      const context = await loadCandidateContext(admin, organizationId, call.contact_number_e164 as string | null);
      const prompt = buildAnalysisPrompt({
        agentName: call.agent_name as string | null,
        direction: call.direction === 'inbound' || call.direction === 'outbound' ? call.direction : null,
        startedAt: call.started_at as string | null,
        talkSeconds: (call.talk_seconds as number | null) ?? 0,
        contactName: call.contact_name as string | null,
        context,
        transcript: transcriptToText(utterances),
      });

      const result = await callClaudeCompat({
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1500,
        timeoutMs: 40000,
        antiAiStyle: 'compact',
      });
      await settleClaudeUsage({
        userId: payer, organizationId, aiAction: AI_ACTION, usage: result.usage, modelId: result.model,
        description: "Analyse d'un appel",
      });

      const insight = parseCallInsight(result.content, (context?.missions ?? []).map((m) => m.id));
      if (!insight) {
        console.error('[analyze-phone-call] réponse illisible:', (result.content ?? '').slice(0, 200));
        await finish({ status: 'failed', reason: 'unreadable' });
        return json({ status: 'failed', reason: 'unreadable' });
      }

      await finish({
        status: 'done',
        reason: null,
        summary: insight.summary,
        tags: insight.tags,
        facts: insight.facts,
        next_steps: insight.next_steps,
        mission_id: insight.mission_id,
        mission_fit: insight.mission_fit,
        model: result.model,
        analyzed_at: new Date().toISOString(),
      });
      return json({ status: 'done' });
    } catch (error) {
      // Le détail reste dans les journaux : il peut citer le fournisseur du modèle.
      console.error('[analyze-phone-call] analyse en échec:', error);
      await finish({ status: 'failed', reason: 'error' });
      return json({ status: 'failed', reason: 'error' });
    }
  } catch (error) {
    console.error('[analyze-phone-call] erreur:', error);
    return json({ error: "L'analyse n'a pas pu se faire. Réessayez dans un instant.", error_code: 'INTERNAL' }, 500);
  }
});

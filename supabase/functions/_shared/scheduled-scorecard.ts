/** Prepare one durable scorecard per scheduled interview and interviewer. */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import type { AuthResult } from './require-auth.ts';
import { verifyOrgMembership } from './require-auth.ts';
import { settleCredits } from './settle-credits.ts';

type Client = SupabaseClient;
// Stored profile/brief JSON has several legacy provider shapes; normalize at this boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Generator = (context: Row, ownerId: string, organizationId: string) => Promise<Response>;
const LEASE_MS = 3 * 60_000;
const failureMessage = "La préparation de la grille a échoué. Vous pouvez réessayer depuis la fiche candidat.";
const asObject = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(v => typeof v === 'string' ? v : asObject(v).name).filter(v => typeof v === 'string').slice(0, 40) : [];

export function preparationState(row: Row, now = Date.now()): 'ready' | 'preparing' | 'failed' {
  // Never replace a grid that already contains criteria, including one edited manually.
  if (Array.isArray(row.criteria) && row.criteria.length > 0) return 'ready';
  const started = Date.parse(row.preparation_started_at || '');
  return row.preparation_status === 'preparing' && Number.isFinite(started) && now - started < LEASE_MS
    ? 'preparing' : 'failed';
}

function interviewStage(name: string | null): string {
  const text = (name || '').toLowerCase();
  if (text.includes('techni')) return 'technique';
  if (text.includes('culture')) return 'culture_fit';
  if (text.includes('final')) return 'final';
  return 'phone_screen';
}

async function loadContext(admin: Client, session: Row): Promise<Row> {
  const org = session.organization_id;
  let candidateQuery = admin.from('job_candidate_status').select('candidate_name,candidate_headline,linkedin_profile_data,scoring_details,process_step_id,project_id')
    .eq('organization_id', org).eq('candidate_id', session.candidate_profile_id);
  if (session.project_id) candidateQuery = candidateQuery.eq('project_id', session.project_id);
  else if (session.job_id) candidateQuery = candidateQuery.eq('job_id', session.job_id);
  const [{ data: candidate, error: candidateError }, { data: storedProfile, error: profileError }] = await Promise.all([
    candidateQuery.order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('candidate_profiles').select('name,headline,summary,skills').eq('organization_id', org).eq('candidate_id', session.candidate_profile_id).limit(1).maybeSingle(),
  ]);
  if (candidateError || profileError) throw new Error('candidate_context_unavailable');
  const rawProfile = asObject(candidate?.linkedin_profile_data);
  const profile = asObject(rawProfile.profile || rawProfile);
  const experience = Array.isArray(profile.positions) ? profile.positions : Array.isArray(profile.experiences) ? profile.experiences : Array.isArray(profile.work_experience) ? profile.work_experience : [];
  const education = Array.isArray(profile.education) ? profile.education : [];
  let mission: Row | null = null;
  if (session.project_id || session.job_id) {
    const query = admin.from('sourcing_projects').select('id,job_title,client_name,description,job_details').eq('organization_id', org);
    const { data, error } = await (session.project_id ? query.eq('id', session.project_id) : query.eq('job_id', session.job_id)).limit(1).maybeSingle();
    if (error || (session.project_id && !data)) throw new Error('mission_context_unavailable');
    mission = data;
  }
  const brief = asObject(mission?.job_details);
  const criteria = Array.isArray(brief.evaluation_criteria) ? brief.evaluation_criteria : [];
  const jobContext: Row = {
    title: brief.title || mission?.job_title || session.job_title || session.event_name || 'Entretien de qualification',
    client: asObject(brief.client).name || mission?.client_name || session.client_name,
    description: brief.mission_description || brief.context || mission?.description || session.notes,
    skills: [...strings(brief.skills_must_have), ...strings(brief.skills_should_have)],
    requirements: criteria.map((c: Row) => `${c.label}${c.deal_breaker ? ' (rédhibitoire)' : ''}${c.description ? ` : ${c.description}` : ''}`).join(' | ') || JSON.stringify(session.job_criteria || {}),
    currentStepName: session.event_name,
  };
  let processStepId: string | null = null;
  if (mission) {
    const { data: steps, error } = await admin.from('mission_process_steps').select('id,name,objectives,is_eliminatory')
      .eq('project_id', mission.id).order('step_order', { ascending: true });
    if (error) throw new Error('interview_steps_unavailable');
    jobContext.processSteps = steps || [];
    const exactName = (session.event_name || '').trim().toLowerCase();
    const current = steps?.find((step: Row) => step.name?.trim().toLowerCase() === exactName)
      || steps?.find((step: Row) => step.id === candidate?.process_step_id);
    if (current) {
      processStepId = current.id;
      jobContext.currentStepName = current.name;
      jobContext.currentStepObjectives = current.objectives;
      jobContext.currentStepIsEliminatory = current.is_eliminatory;
    }
  }
  return {
    processStepId,
    candidateProfile: {
      name: profile.name || candidate?.candidate_name || storedProfile?.name || session.candidate_name,
      headline: profile.headline || profile.occupation || candidate?.candidate_headline || storedProfile?.headline || session.candidate_headline,
      summary: profile.about || profile.summary || storedProfile?.summary,
      skills: strings(profile.skills || storedProfile?.skills),
      experiences: experience.slice(0, 12).map((e: Row) => ({ title: e.title || e.position, company: typeof e.company === 'string' ? e.company : e.company?.name || e.company_name })),
      education: education.slice(0, 8).map((e: Row) => ({ school: e.school_details?.name || e.school || e.school_name, degree: e.degree || e.degree_name })),
      yearsOfExperience: profile.yearsOfExperience,
    },
    jobContext,
    scoringDetails: candidate?.scoring_details || session.scoring_summary,
    interviewStage: interviewStage(session.event_name),
  };
}

export async function prepareScheduledScorecard({ body, auth, admin, corsHeaders, generate, background = defaultBackground }: {
  body: Row; auth: AuthResult; admin: Client; corsHeaders: Record<string, string>; generate: Generator;
  background?: (work: Promise<unknown>) => void;
}): Promise<Response> {
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  const sessionId = body.qualificationSessionId;
  const organizationId = body.organization_id;
  if (typeof sessionId !== 'string' || typeof organizationId !== 'string') return json({ error: 'Entretien et organisation requis.' }, 400);
  if (auth.method !== 'service_role' && (!auth.userId || !await verifyOrgMembership(admin, auth.userId, organizationId))) return json({ error: 'Accès refusé.' }, 403);
  const { data: session, error: sessionError } = await admin.from('qualification_sessions').select('*').eq('id', sessionId).eq('organization_id', organizationId).maybeSingle();
  if (sessionError) return json({ error: 'Cet entretien ne peut pas être chargé.' }, 503);
  if (!session) return json({ error: 'Entretien introuvable.' }, 404);
  const ownerId = session.manager_id || session.created_by;
  const assignedElsewhere = auth.method !== 'service_role' && auth.userId !== ownerId;
  const canPlanForOwner = body.planning === true && auth.userId === session.created_by;
  if (assignedElsewhere && !canPlanForOwner) return json({ status: 'skipped', reason: 'assigned_elsewhere', error: 'Cet entretien est attribué à un autre recruteur.' });
  if (!ownerId || !await verifyOrgMembership(admin, ownerId, organizationId)) return json({ status: 'skipped', reason: 'interviewer_unavailable', error: "L'intervenant de cet entretien n'est plus disponible." });
  if (!session.candidate_profile_id) return json({ status: 'skipped', reason: 'candidate_missing', error: 'Rattachez un candidat à cet entretien pour préparer sa grille.' });
  if (!['scheduled', 'in_progress'].includes(session.status)) return json({ status: 'skipped', reason: 'interview_closed', error: 'Cet entretien est annulé ou terminé.' });

  const readEvaluation = () => admin.from('candidate_evaluations').select('*').eq('qualification_session_id', sessionId).eq('created_by', ownerId).eq('organization_id', organizationId).maybeSingle();
  const respond = (row: Row) => assignedElsewhere
    ? json({ status: preparationState(row), assignedElsewhere: true })
    : json({ status: preparationState(row), evaluation: row, ...(preparationState(row) === 'failed' ? { error: row.preparation_error || failureMessage } : {}) });
  const { data: existing, error: existingError } = await readEvaluation();
  if (existingError) return json({ error: 'La préparation ne peut pas être chargée.' }, 503);
  if (existing && (preparationState(existing) !== 'failed' || body.retry !== true)) return respond(existing);

  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const preparing = { preparation_status: 'preparing', preparation_started_at: now, preparation_token: token, preparation_error: null };
  let claimed: Row | null = null;
  if (!existing) {
    const { data, error } = await admin.from('candidate_evaluations').insert({
      qualification_session_id: sessionId, organization_id: organizationId, created_by: ownerId,
      candidate_id: session.candidate_profile_id, project_id: session.project_id, job_id: session.job_id,
      job_title: session.job_title, interview_stage: interviewStage(session.event_name), criteria: [], ratings: {}, comments: {}, ai_generated: true,
      ...preparing,
    }).select('*').single();
    if (error && error.code !== '23505') return json({ error: 'La préparation ne peut pas démarrer.' }, 503);
    claimed = data;
  } else {
    // Compare-and-swap: concurrent retries cannot own the same preparation.
    const claimQuery = admin.from('candidate_evaluations').update(preparing)
      .eq('id', existing.id).eq('organization_id', organizationId).eq('updated_at', existing.updated_at).eq('criteria', '[]');
    const { data, error } = await (existing.preparation_token
      ? claimQuery.eq('preparation_token', existing.preparation_token)
      : claimQuery.is('preparation_token', null)).select('*').maybeSingle();
    if (error) return json({ error: 'La préparation ne peut pas redémarrer.' }, 503);
    claimed = data;
  }
  if (!claimed) {
    const { data, error } = await readEvaluation();
    return error || !data ? json({ error: 'La préparation ne peut pas être chargée.' }, 503) : respond(data);
  }

  const claimedRow = claimed;
  const run = async () => {
    let visibleError = failureMessage;
    try {
      const { data: allowed, error: rateError } = await admin.rpc('check_rate_limit', { p_user_id: ownerId, p_action: 'generate_scorecard', p_max_requests: 20, p_window_seconds: 60 });
      if (rateError || allowed === false) throw new Error('rate_limited');
      const context = await loadContext(admin, session);
      const response = await generate(context, ownerId, organizationId);
      const result = await response.json();
      if (!response.ok || !result.success || !Array.isArray(result.criteria) || result.criteria.length === 0) {
        if (response.status === 402) visibleError = 'Crédits IA insuffisants pour préparer la grille.';
        throw new Error(`generation_failed_${response.status}`);
      }
      // Cancellation or a reassignment during inference must not publish a stale grid.
      const { data: current, error: currentError } = await admin.from('qualification_sessions').select('status,candidate_profile_id,project_id,manager_id,created_by')
        .eq('id', sessionId).eq('organization_id', organizationId).maybeSingle();
      if (currentError || !current || !['scheduled', 'in_progress'].includes(current.status)
        || current.candidate_profile_id !== session.candidate_profile_id || current.project_id !== session.project_id
        || (current.manager_id || current.created_by) !== ownerId) throw new Error('interview_changed');
      const { data: saved, error: saveError } = await admin.from('candidate_evaluations').update({
        criteria: result.criteria, process_step_id: session.project_id ? context.processStepId : null,
        preparation_status: 'ready', preparation_error: null,
      }).eq('id', claimedRow.id).eq('organization_id', organizationId).eq('preparation_token', token)
        .eq('updated_at', claimedRow.updated_at).eq('criteria', '[]').select('id').maybeSingle();
      if (saveError || !saved) throw new Error('preparation_save_conflict');
      // Only the winning, persisted generation is billed; reads/retries never re-bill it.
      if (result.usage && result.usage.tokensInput + result.usage.tokensOutput > 0) {
        await settleCredits(admin, {
          organizationId, userId: ownerId, aiAction: 'generate_scorecard', modelId: result.usage.modelId,
          tokensInput: result.usage.tokensInput, tokensOutput: result.usage.tokensOutput,
          description: `Grille préparée pour ${session.candidate_name || 'un entretien'}`,
        }).catch(error => console.error('[scheduled-scorecard] settlement failed', error));
      }
    } catch (error) {
      console.error('[scheduled-scorecard] preparation failed', error);
      const { error: saveError } = await admin.from('candidate_evaluations').update({ preparation_status: 'failed', preparation_error: visibleError })
        .eq('id', claimedRow.id).eq('organization_id', organizationId).eq('preparation_token', token).eq('updated_at', claimedRow.updated_at);
      if (saveError) console.error('[scheduled-scorecard] failure state unavailable', saveError);
    }
  };
  if (body.background === true) {
    background(run());
    return respond(claimedRow);
  }
  await run();
  const { data: prepared, error: preparedError } = await readEvaluation();
  return preparedError || !prepared ? json({ error: failureMessage }, 503) : respond(prepared);
}

function defaultBackground(work: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);
  else void work.catch(error => console.error('[scheduled-scorecard] background failed', error));
}

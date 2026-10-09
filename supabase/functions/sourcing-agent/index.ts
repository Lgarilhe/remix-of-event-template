/** Authenticated controls. Merely opening/configuring an agent never starts it. */
import { createClient } from 'npm:@supabase/supabase-js@2.75.1';
import { requireAuth } from '../_shared/require-auth.ts';
import {
  CONTINUOUS_DEFAULTS, ContinuousError, record, normalizeContinuousSettings, readAgentProject,
  loadContinuousContext, readOwnAgentAccounts, requireAccount, requireAgentPlan, continuousSearchRequest,
  assertContinuousSearchMemory,
  continuousLinkedInUrl,
  isContinuousCandidateUncertain,
  listContinuousAgentCandidates,
  type ContinuousAgent, type ContinuousCandidate, type AgentJson, type AgentAccount, type AgentApi,
} from '../_shared/continuous-sourcing.ts';
import { estimateCredits } from '../_shared/ai-config.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['get', 'configure', 'start_calibration', 'review', 'approve_calibration', 'pause', 'resume', 'stop', 'skip_uncertain']);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  try {
    const auth = await requireAuth(req, corsHeaders);
    if (!auth.userId) throw new ContinuousError('AGENT_FORBIDDEN', 'Une session utilisateur est requise.', 403);
    let body: AgentJson;
    try { body = record(await req.json()); }
    catch { throw new ContinuousError('INVALID_REQUEST', 'La demande doit contenir un JSON valide.', 400); }
    const projectId = typeof body.project_id === 'string' ? body.project_id : '';
    const orgId = typeof body.organization_id === 'string' ? body.organization_id : '';
    const action = typeof body.action === 'string' ? body.action : 'get';
    if (!UUID.test(projectId) || !UUID.test(orgId) || !ACTIONS.has(action)) {
      throw new ContinuousError('INVALID_REQUEST', 'Choisissez une mission et une action valides.', 400);
    }
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
      { auth: { persistSession: false } });
    const userId = auth.userId;
    const checked = async <T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<T> => {
      const { data, error } = await promise;
      if (error) throw error;
      return data;
    };
    if (action !== 'pause' && action !== 'stop') {
      const rateAllowed = await checked(admin.rpc('check_rate_limit', { p_user_id: userId,
        p_action: 'sourcing_agent', p_max_requests: 30, p_window_seconds: 60 }));
      if (rateAllowed !== true) throw new ContinuousError('RATE_LIMITED', 'Trop de demandes. Réessayez dans une minute.', 429);
    }
    // API actions follow the active space; a worker follows its saved grant.
    const profile = await checked(admin.from('profiles').select('active_organization_id').eq('user_id', userId).maybeSingle());
    if (profile?.active_organization_id !== orgId) throw new ContinuousError('AGENT_FORBIDDEN', 'Ouvrez cette mission dans son espace.', 403);
    // Match the SQL service-only authority check, including collaborator rules.
    await checked(admin.rpc('assert_sourcing_agent_actor', { p_user_id: userId, p_project_id: projectId, p_require_active_space: true }));
    let agent = await checked(admin.from('sourcing_agents').select('*').eq('project_id', projectId).eq('organization_id', orgId).maybeSingle()) as ContinuousAgent | null;
    if (agent && agent.created_by !== userId) {
      throw new ContinuousError('AGENT_FORBIDDEN', 'L’agent de cette mission est géré par le recruteur qui l’a activé.', 403);
    }
    const requireRevision = () => {
      if (!Number.isInteger(body.expected_revision) || body.expected_revision !== (agent?.revision || 0)) {
        throw new ContinuousError('REVISION_CONFLICT', 'L’agent a changé. Rechargez avant de continuer.');
      }
    };
    const candidates = async () => agent ? await listContinuousAgentCandidates(admin, agent) : [];
    // A stop must not wait for memory, account-provider or subscription reads.
    // It remains authenticated, actor-scoped and protected by the SQL revision CAS.
    if (action === 'pause' || action === 'stop' || action === 'skip_uncertain') {
      requireRevision();
      if (!agent) throw new ContinuousError('INVALID_REQUEST', 'Agent introuvable.', 400);
      const payload: AgentJson = {};
      if (action === 'skip_uncertain') {
        if (body.confirm_uncertain !== true) throw new ContinuousError('UNCERTAIN_CONSENT_REQUIRED', 'Confirmez que ce profil sera ignoré sans relancer son évaluation.', 400);
        const candidateId = typeof body.candidate_id === 'string' ? body.candidate_id : '';
        const reason = body.reason === undefined ? 'Évaluation interrompue : ne pas relancer ce profil.' : typeof body.reason === 'string' ? body.reason.trim() : '';
        if (!UUID.test(candidateId) || reason.length < 5 || reason.length > 1000) {
          throw new ContinuousError('UNCERTAIN_PROFILE_REQUIRED', 'Choisissez un profil interrompu et un motif valide.', 400);
        }
        const interrupted = (await candidates()).find(item => item.id === candidateId);
        if (!interrupted) throw new ContinuousError('AGENT_FORBIDDEN', 'Ce profil n’appartient pas à cet agent.', 403);
        if (!isContinuousCandidateUncertain(interrupted)) throw new ContinuousError('UNCERTAIN_PROFILE_REQUIRED', 'Ce profil ne porte pas d’évaluation interrompue à ignorer.');
        // The immutable candidate context is authoritative for this free
        // resolution. A changed live brief must never prevent a safe stop.
        Object.assign(payload, { candidate_id: candidateId, context_key: interrupted.context_key, reason });
      }
      agent = await checked(admin.rpc('mutate_sourcing_agent', { p_user_id: userId, p_project_id: projectId,
        p_expected_revision: body.expected_revision, p_action: action, p_payload: payload })) as ContinuousAgent;
      const perProfile = Math.max(estimateCredits('scoring', agent.settings.model_id), 12);
      const used = agent.daily_date === new Date().toISOString().slice(0, 10) ? Number(agent.credits_used) : 0;
      const reserved = Number(agent.credits_reserved);
      let rows: ContinuousCandidate[] = [];
      try { rows = await candidates(); } catch { /* The confirmed stop is still returned if its optional list is unavailable. */ }
      return json({ agent, candidates: rows, context_key: '', requires_refresh: true,
        eligibility: { allowed: false, reasons: ['L’action est enregistrée. Actualisez l’agent avant de reprendre la recherche.'] },
        accounts: [], accounts_error: 'Les comptes LinkedIn seront revérifiés au prochain chargement.',
        credits_estimate: { per_profile: perProfile, daily_limit: agent.settings.daily_credit_limit,
          reserved, used, remaining: Math.max(0, agent.settings.daily_credit_limit - used - reserved) } });
    }
    let project = await readAgentProject(admin, userId, projectId, orgId);
    const defaults = { source: 'pool' as const, account_id: null, api: null, settings: CONTINUOUS_DEFAULTS };
    let config = agent || defaults;
    let context = await loadContinuousContext(admin, project, userId, config);
    let accounts: AgentAccount[] = [];
    let accountsError: string | null = null;
    try { accounts = await readOwnAgentAccounts(admin, userId, orgId); }
    catch (error) { accountsError = error instanceof ContinuousError ? error.message : 'Les comptes LinkedIn ne peuvent pas être vérifiés. Réessayez.'; }
    const requirements = async (candidateConfig = config): Promise<string[]> => {
      const reasons: string[] = [];
      const minimumQuote = Math.max(estimateCredits('scoring', candidateConfig.settings.model_id), 12);
      if (candidateConfig.settings.daily_credit_limit < minimumQuote) reasons.push(`Le budget cible doit couvrir au moins une évaluation, soit ${minimumQuote} crédits.`);
      try { await requireAgentPlan(admin, orgId); } catch (error) { reasons.push(error instanceof Error ? error.message : 'Abonnement indisponible.'); }
      if (project.status !== 'active') reasons.push('La mission doit être active.');
      if (!String(project.job_details.title || project.name).trim()) reasons.push('Décrivez le poste dans le brief.');
      if (candidateConfig.source === 'linkedin') {
        if (accountsError) reasons.push(accountsError);
        try { requireAccount(candidateConfig, accounts); } catch (error) { reasons.push(error instanceof Error ? error.message : 'Compte indisponible.'); }
        try { continuousSearchRequest(project.filters_snapshot, candidateConfig.api || 'classic'); }
        catch (error) { reasons.push(error instanceof Error ? error.message : 'Revoyez les filtres de recherche.'); }
        try { assertContinuousSearchMemory(project.filters_snapshot, context); }
        catch (error) { reasons.push(error instanceof Error ? error.message : 'Actualisez les filtres avec les mémoires de recherche.'); }
      }
      const savedConflicts = project.filters_snapshot.memory_conflicts;
      if (Array.isArray(savedConflicts) && savedConflicts.length) reasons.push('Clarifiez les règles en conflit avant de démarrer.');
      return [...new Set(reasons)];
    };
    const requireContext = () => {
      if (typeof body.expected_context_key !== 'string' || body.expected_context_key !== context.context_key ||
        (agent && action !== 'start_calibration' && agent.context_snapshot.context_key !== context.context_key)) {
        throw new ContinuousError('CONTEXT_CHANGED', 'Le brief, les filtres ou les règles ont changé. Rechargez et recalibrez l’agent.');
      }
    };
    const mutate = async (mutation: string, payload: AgentJson) => {
      agent = await checked(admin.rpc('mutate_sourcing_agent', { p_user_id: userId, p_project_id: projectId,
        p_expected_revision: body.expected_revision, p_action: mutation, p_payload: payload })) as ContinuousAgent;
      config = agent;
    };
    if (action !== 'get') requireRevision();
    if (['configure', 'start_calibration', 'resume', 'approve_calibration'].includes(action) && (await candidates()).some(isContinuousCandidateUncertain)) {
      throw new ContinuousError('SCORING_UNCERTAIN', 'Ignorez les évaluations interrompues, même celles d’un ancien cadrage, avant de relancer l’agent.');
    }
    if (action === 'configure') {
      const source = body.source ?? config.source;
      if (source !== 'pool' && source !== 'linkedin') throw new ContinuousError('INVALID_REQUEST', 'Choisissez la source de recherche.', 400);
      const selectedApi = source === 'linkedin' ? body.api ?? config.api : null;
      if (source === 'linkedin' && !['classic', 'recruiter', 'sales_navigator'].includes(String(selectedApi))) {
        throw new ContinuousError('INVALID_REQUEST', 'Choisissez le type de recherche LinkedIn.', 400);
      }
      const accountId = source === 'linkedin' ? body.account_id ?? config.account_id : null;
      if (source === 'linkedin' && (typeof accountId !== 'string' || !accountId.trim())) throw new ContinuousError('ACCOUNT_FORBIDDEN', 'Choisissez votre compte LinkedIn.', 400);
      const settings = normalizeContinuousSettings(body.settings, config.settings);
      const proposed: Pick<ContinuousAgent, 'source' | 'account_id' | 'api' | 'settings'> = {
        source, account_id: accountId as string | null, api: selectedApi as AgentApi | null, settings,
      };
      if (source === 'linkedin' && !accounts.some(account => account.id === accountId)) throw new ContinuousError('ACCOUNT_FORBIDDEN', 'Ce compte ne vous appartient pas.', 403);
      context = await loadContinuousContext(admin, project, userId, proposed);
      await mutate('configure', { ...proposed, context_snapshot: context, search_filters_snapshot: project.filters_snapshot });
    } else if (action === 'start_calibration' || action === 'resume' || action === 'approve_calibration') {
      if (!agent) throw new ContinuousError('INVALID_REQUEST', 'Enregistrez les réglages de l’agent.', 400);
      requireContext();
      if (config.source === 'linkedin') assertContinuousSearchMemory(project.filters_snapshot, context);
      const reasons = await requirements();
      if (reasons.length) throw new ContinuousError('AGENT_NOT_READY', reasons.join(' '), 409);
      if (action === 'approve_calibration') {
        if (body.save_calibration_profiles !== true) throw new ContinuousError('CALIBRATION_CONSENT_REQUIRED', 'Validez l’ajout des profils de référence au brief.', 400);
        const reviewed = (await candidates()).filter(candidate => candidate.context_key === context.context_key && candidate.state === 'reviewed');
        const fits = reviewed.filter(candidate => candidate.decision === 'fit' && (candidate.reason || '').trim().length >= 5);
        if (reviewed.length < 3 || !fits.length) throw new ContinuousError('CALIBRATION_REQUIRED', 'Donnez trois avis motivés, dont au moins un profil pertinent.');
        const references = fits.slice(0, 5).map(candidate => ({ name: candidate.profile.name || 'Profil de référence',
          headline: candidate.profile.headline || '', linkedin_url: continuousLinkedInUrl(candidate.profile) || '',
          sourcing_agent_candidate_id: candidate.id,
          why_good_fit: [candidate.reason], areas_of_improvement: '' }));
        const previous = project.job_details;
        project = { ...project, job_details: { ...previous, calibration_profiles: references } };
        context = await loadContinuousContext(admin, project, userId, config);
        await mutate('approve_calibration', { expected_job_details: previous, calibration_profiles: references,
          context_snapshot: context, approved_context_key: context.context_key, search_filters_snapshot: project.filters_snapshot });
      } else if (action === 'resume') {
        if (!agent.approved_context_key || agent.approved_context_key !== context.context_key) throw new ContinuousError('CALIBRATION_REQUIRED', 'Validez la calibration avant de reprendre.');
        await mutate('resume', { context_snapshot: context, approved_context_key: context.context_key });
      } else {
        await mutate('start_calibration', { context_snapshot: context, search_filters_snapshot: project.filters_snapshot });
      }
    } else if (action === 'review') {
      if (!agent) throw new ContinuousError('INVALID_REQUEST', 'Agent introuvable.', 400);
      requireContext();
      const candidateId = typeof body.candidate_id === 'string' ? body.candidate_id : '';
      if (!UUID.test(candidateId) || !['fit', 'reject'].includes(String(body.decision)) ||
        typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.trim().length > 1000) {
        throw new ContinuousError('REVIEW_REQUIRED', 'Ajoutez un avis motivé sur ce profil.', 400);
      }
      const candidate = (await candidates()).find(item => item.id === candidateId);
      if (!candidate) throw new ContinuousError('AGENT_FORBIDDEN', 'Ce profil n’appartient pas à cet agent.', 403);
      const reviewed = record(await checked(admin.rpc('review_sourcing_agent_candidate', { p_user_id: userId,
        p_candidate_id: candidateId, p_expected_revision: body.expected_revision,
        p_decision: body.decision, p_reason: body.reason.trim() })));
      agent = reviewed.agent as ContinuousAgent; config = agent;
    }
    project = await readAgentProject(admin, userId, projectId, orgId);
    context = await loadContinuousContext(admin, project, userId, config);
    const reasons = await requirements();
    if (agent && agent.context_snapshot.context_key && agent.context_snapshot.context_key !== context.context_key) {
      reasons.push('Le besoin a changé : relancez la calibration.');
    }
    const perProfile = Math.max(estimateCredits('scoring', config.settings.model_id), 12);
    const used = agent && agent.daily_date === new Date().toISOString().slice(0, 10) ? Number(agent.credits_used) : 0;
    const reserved = agent ? Number(agent.credits_reserved) : 0;
    return json({ agent, candidates: await candidates(), context_key: context.context_key,
      eligibility: { allowed: reasons.length === 0, reasons }, accounts, accounts_error: accountsError,
      credits_estimate: { per_profile: perProfile, daily_limit: config.settings.daily_credit_limit,
        reserved, used, remaining: Math.max(0, config.settings.daily_credit_limit - used - reserved) } });
  } catch (error) {
    if (error instanceof Response) return error;
    const raw = record(error);
    const hint = String(raw.hint || '');
    const code = error instanceof ContinuousError ? error.code : hint.includes('SCORING_UNCERTAIN') ? 'SCORING_UNCERTAIN' : hint.includes('REVISION') ? 'REVISION_CONFLICT' :
      hint.includes('CONTEXT') ? 'CONTEXT_CHANGED' : raw.code === '42501' ? 'AGENT_FORBIDDEN' : 'CONTEXT_UNAVAILABLE';
    const status = error instanceof ContinuousError ? error.status : code === 'SCORING_UNCERTAIN' || raw.code === '40001' ? 409 : raw.code === '42501' ? 403 : 503;
    console.error('[sourcing-agent]', code);
    return json({ error: error instanceof ContinuousError ? error.message : code === 'REVISION_CONFLICT' ? 'L’agent a changé. Rechargez avant de continuer.' :
      code === 'CONTEXT_CHANGED' ? 'Le besoin a changé. Rechargez et recalibrez l’agent.' : code === 'SCORING_UNCERTAIN' ? 'Ignorez les évaluations interrompues avant de relancer l’agent.' : 'L’agent ne peut pas être vérifié. Réessayez.', error_code: code }, status);
  }
});

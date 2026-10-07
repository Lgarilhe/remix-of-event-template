import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';
import { requireOrgAccess } from '../_shared/require-auth.ts';
import { assertCredits, creditGateResponse } from '../_shared/credit-guard.ts';
import { callClaudeCompat } from '../_shared/call-claude.ts';
import { settleCredits } from '../_shared/settle-credits.ts';
import { loadAndBuildAiContext } from '../_shared/ai-context.ts';
import { loadWritingSettings } from '../_shared/writing-settings.ts';
import { AI_LEVEL_LABELS, levelCredits, modelForLevel, resolveAiLevel, styleSummary } from '../_shared/writing-style.ts';
import { CandidateActionContextError, loadCandidateActionContext } from '../_shared/candidate-actions/context.ts';
import { CANDIDATE_ACTION_AI_ACTION, generateCandidateActionPlans, hasReferencedUpcomingInterview } from '../_shared/candidate-actions/generate.ts';
import { CandidateActionTransportError, sendCandidateActionMessage, validateCandidateActionMessage } from '../_shared/candidate-actions/transport.ts';
import { projectCandidateActionError } from '../_shared/candidate-actions/errors.ts';
import {
  approvePlan, claimEffect, completeEffect, createPlan, dismissPlan, getPlan, listMessages,
  listPlans, markNeedsReview, reconcileInterruptedEffects, saveDrafts, writeInternalEffect,
} from '../_shared/candidate-actions/store.ts';
import type { CandidateActionContext, CandidateActionEdits, CandidateActionEffect, CandidateActionPlan, CandidateActionScope } from '../_shared/candidate-actions/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ACTIONS = ['list', 'generate', 'save', 'approve', 'execute_effect', 'dismiss', 'restore'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const str = (value: unknown, maximum = 512) => typeof value === 'string' && value.trim().length <= maximum ? value.trim() : '';

class ActionRequestError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}

function scopeOf(body: Record<string, unknown>): CandidateActionScope {
  const organizationId = str(body.organization_id);
  const candidateId = str(body.candidate_id);
  if (!UUID.test(organizationId) || !candidateId) throw new ActionRequestError('ACTION_IDENTITY_REQUIRED', 'Le candidat ou l’organisation est introuvable.', 400);
  const projectId = str(body.project_id);
  if (projectId && !UUID.test(projectId)) throw new ActionRequestError('ACTION_MISSION_REQUIRED', 'Choisissez la mission concernée.', 400);
  return { organization_id: organizationId, candidate_id: candidateId, project_id: projectId || null,
    linkedin_url: str(body.linkedin_url, 2_000) || null, account_id: str(body.account_id) || null, chat_id: str(body.chat_id) || null };
}

function expectedRevision(body: Record<string, unknown>): number {
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1) throw new ActionRequestError('ACTION_REVISION_REQUIRED', 'Rechargez la proposition avant de la modifier ou de la valider.', 400);
  return Number(body.revision);
}

function editsOf(body: Record<string, unknown>, plan: CandidateActionPlan): CandidateActionEdits {
  const value = body.edits;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 4) throw new ActionRequestError('ACTION_INVALID_EDITS', 'Les modifications ne peuvent pas être enregistrées.', 400);
  const edits: CandidateActionEdits = {};
  for (const [id, raw] of Object.entries(value)) {
    const effect = plan.effects.find((item) => item.id === id);
    if (!effect || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ActionRequestError('ACTION_INVALID_EFFECT', 'Ce contenu ne fait pas partie de la proposition.', 400);
    const edit = raw as Record<string, unknown>;
    if (Object.keys(edit).some((key) => !['content', 'subject'].includes(key))) throw new ActionRequestError('ACTION_INVALID_EDITS', 'Seul le texte et l’objet peuvent être modifiés.', 400);
    const maximum = effect.kind === 'message' ? effect.channel === 'linkedin' ? 1_500 : 5_000 : 4_000;
    const content = str(edit.content, maximum);
    if (!content) throw new ActionRequestError('ACTION_EMPTY_CONTENT', 'Complétez tous les textes avant de valider.', 400);
    const subject = edit.subject === undefined ? undefined : str(edit.subject, 200);
    if (edit.subject !== undefined && (effect.kind !== 'message' || effect.channel !== 'email' || !subject)) throw new ActionRequestError('ACTION_INVALID_SUBJECT', 'L’objet de cet e-mail est incomplet.', 400);
    edits[id] = { content, ...(subject !== undefined ? { subject } : {}) };
  }
  return edits;
}

function sameIdentity(plan: CandidateActionPlan, scope: CandidateActionScope): void {
  if (plan.scope.organization_id !== scope.organization_id || plan.scope.candidate_id !== scope.candidate_id || (plan.scope.project_id ?? null) !== (scope.project_id ?? null)) {
    throw new ActionRequestError('ACTION_SCOPE_CHANGED', 'Cette proposition appartient à un autre candidat ou à une autre mission.', 403);
  }
}

function validateBoundEffect(effect: CandidateActionEffect, context: CandidateActionContext, plan: CandidateActionPlan): void {
  if (effect.kind === 'message') {
    if (effect.audience === 'candidate' && plan.sources.some((source) => source.type === 'ambiguous_message')) throw new ActionRequestError('ACTION_MISSION_UNRESOLVED', 'La mission de cet échange doit être clarifiée avant de répondre au candidat.');
    const target = context.targets.find((item) => item.id === effect.targetId);
    if (!target || ['audience', 'channel', 'service', 'recipient', 'senderAccountId', 'senderAddress', 'chatId', 'recipientProviderId', 'memberId'].some((key) =>
      (effect[key as keyof typeof effect] ?? null) !== (target[key as keyof typeof target] ?? null))) {
      throw new ActionRequestError('ACTION_TARGET_CHANGED', 'Le destinataire ou votre compte d’envoi a changé. Préparez une nouvelle proposition.');
    }
  } else if (effect.kind === 'comment') {
    if (!context.scope.project_id || effect.mentions.some((id) => !context.members.some((member) => member.id === id))) throw new ActionRequestError('ACTION_MEMBER_CHANGED', 'Un membre mentionné n’est plus disponible. Préparez une nouvelle proposition.');
  } else if (effect.evaluationId && !context.ownEvaluationIds.includes(effect.evaluationId)) {
    throw new ActionRequestError('ACTION_EVALUATION_CHANGED', 'Cette évaluation a changé ou ne vous appartient plus. Préparez une nouvelle proposition.');
  } else if (effect.kind === 'document' && effect.documentType === 'interview_brief' && !hasReferencedUpcomingInterview(context, plan.sources)) {
    throw new ActionRequestError('ACTION_INTERVIEW_CHANGED', 'L’entretien préparé a déjà commencé ou n’est plus confirmé. Préparez une nouvelle proposition.');
  }
}

function errorResponse(error: unknown): Response {
  const { payload, status } = projectCandidateActionError(error, error instanceof CandidateActionContextError || error instanceof CandidateActionTransportError);
  // Neither provider errors nor SQL messages enter this log; they can contain source text or credentials.
  console.error('[candidate-actions] request failed:', { code: payload.error_code, status });
  return json(payload, status);
}

/** Une préparation ne produit aucun effet métier. L'approbation puis chaque effet ont leur propre requête et leur résultat durable. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Cette requête n’est pas prise en charge.', error_code: 'ACTION_METHOD' }, 405);
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body) || JSON.stringify(body).length > 36_000 || !ACTIONS.includes(String(body.action))) return json({ error: 'La requête est incomplète.', error_code: 'ACTION_INVALID_REQUEST' }, 400);
    const requestedScope = scopeOf(body);
    let access;
    try { access = await requireOrgAccess(req, body, corsHeaders); } catch (response) { return response as Response; }
    const userId = access.userId;
    // The shared auth helper uses ReturnType of the generic factory; use the actual client's query interface.
    const admin = access.adminClient as SupabaseClient;
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('authorization')! } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const action = String(body.action);
    const { data: allowed, error: rateError } = await admin.rpc('check_rate_limit', {
      p_user_id: userId, p_action: `candidate_actions_${action}`, p_max_requests: action === 'generate' ? 10 : 60, p_window_seconds: 60,
    });
    if (rateError) throw new ActionRequestError('ACTION_RATE_UNAVAILABLE', 'Vos actions ne peuvent pas être vérifiées pour l’instant.', 503);
    if (allowed === false) throw new ActionRequestError('ACTION_RATE_LIMIT', 'Trop de demandes. Patientez quelques secondes.', 429);

    if (action === 'list' || action === 'generate') {
      const context = await loadCandidateActionContext(admin, userClient, userId, requestedScope);
      await reconcileInterruptedEffects(admin, userId, context.scope);
      let plans = await listPlans(admin, userId, context.scope);
      const settings = await loadWritingSettings(admin, { organizationId: context.scope.organization_id, userId });
      const generation = settings.ok ? { estimated: levelCredits(CANDIDATE_ACTION_AI_ACTION, settings.defaultLevel), level: settings.defaultLevel,
        levelLabel: AI_LEVEL_LABELS[settings.defaultLevel], styleSummary: styleSummary(settings.style), model: modelForLevel(settings.defaultLevel) } : null;
      const channels = [...new Map(context.targets.map((target) => [target.senderAccountId, { channel: target.channel, service: target.service, address: target.senderAddress }])).values()];
      if (action === 'list') {
        // Pending proposals lose approval when a real source changes; completed outcomes remain readable.
        for (const plan of plans.filter((item) => ['draft', 'approved', 'running', 'partial'].includes(item.status))) {
          const hasOwnResults = plan.effects.some((effect) => ['succeeded', 'skipped'].includes(effect.status));
          const fresh = hasOwnResults ? await loadCandidateActionContext(admin, userClient, userId, plan.scope, { excludeEffectIds: plan.effects.map((effect) => effect.id) }) : context;
          if (plan.contextVersion !== fresh.contextVersion) await markNeedsReview(admin, userId, plan.id);
        }
        plans = await listPlans(admin, userId, context.scope);
        return json({ success: true, plans, messages: await listMessages(userClient, context.scope), warnings: context.warnings, channels, generation });
      }
      // Re-opening an unchanged context reuses its durable suggestion, including an explicitly dismissed one.
      if (plans.some((plan) => plan.contextVersion === context.contextVersion && plan.status !== 'needs_review')) {
        return json({ success: true, plans, messages: await listMessages(userClient, context.scope), warnings: context.warnings, channels, generation, reused: true });
      }
      if (!settings.ok) throw new ActionRequestError('ACTION_WRITING_UNAVAILABLE', 'Vos réglages de rédaction ne peuvent pas être lus.', 503);
      const level = resolveAiLevel(body.ai_level, settings);
      if (!level.ok) return json({ error: level.error, error_code: level.code }, level.status);
      if (!context.sources.length) throw new ActionRequestError('ACTION_CONTEXT_TOO_THIN', 'Le contexte disponible ne suffit pas pour proposer une action fiable.', 422);
      const model = modelForLevel(level.level);
      const gate = await assertCredits({ userId, organizationId: context.scope.organization_id, aiAction: CANDIDATE_ACTION_AI_ACTION, modelId: model, adminClient: access.adminClient });
      if (!gate.ok) return creditGateResponse(gate, corsHeaders);
      if (gate.remaining === null) throw new ActionRequestError('ACTION_CREDITS_UNAVAILABLE', 'Votre solde de crédits ne peut pas être vérifié. Réessayez dans un instant.', 503);
      const aiContext = await loadAndBuildAiContext(admin, { userId, orgId: context.scope.organization_id, omitTone: true });
      const proposed = await generateCandidateActionPlans(context, userId, { model, style: settings.style, intent: str(body.intent, 500) || undefined }, {
        callModel: (options) => callClaudeCompat({ ...options, aiContext }),
        settle: (result) => settleCredits(access.adminClient, { organizationId: context.scope.organization_id, userId, aiAction: CANDIDATE_ACTION_AI_ACTION, modelId: result.model,
          tokensInput: result.usage.input_tokens, tokensOutput: result.usage.output_tokens, description: 'Préparation des actions candidat' }).then(() => undefined),
      });
      for (const plan of proposed) await createPlan(admin, userId, plan);
      return json({ success: true, plans: await listPlans(admin, userId, context.scope), messages: await listMessages(userClient, context.scope), warnings: context.warnings, channels, generation });
    }

    const planId = str(body.plan_id);
    if (!UUID.test(planId)) throw new ActionRequestError('ACTION_PLAN_REQUIRED', 'La proposition est introuvable.', 400);
    let plan = await getPlan(admin, userId, planId);
    if (plan.scope.organization_id !== requestedScope.organization_id) throw new ActionRequestError('ACTION_SCOPE_FORBIDDEN', 'Cette proposition appartient à une autre organisation.', 403);
    const context = await loadCandidateActionContext(admin, userClient, userId, { ...requestedScope, account_id: plan.scope.account_id, chat_id: plan.scope.chat_id }, { excludeEffectIds: plan.effects.map((effect) => effect.id) });
    sameIdentity(plan, context.scope);
    if (action === 'dismiss' || action === 'restore') return json({ success: true, plan: await dismissPlan(admin, userId, planId, action === 'dismiss') });
    if (plan.contextVersion !== context.contextVersion) {
      await markNeedsReview(admin, userId, planId);
      throw new ActionRequestError('ACTION_CONTEXT_CHANGED', 'Un échange ou une information a changé depuis la préparation. Préparez une nouvelle proposition.');
    }
    if (action === 'save') return json({ success: true, plan: await saveDrafts(admin, userId, planId, expectedRevision(body), editsOf(body, plan)) });
    if (action === 'approve') {
      // All preconditions are checked before the first effect may be claimed. No automatic effects on approval.
      const checks = await Promise.allSettled(plan.effects.filter((effect) => !['succeeded', 'skipped', 'unknown'].includes(effect.status)).map(async (effect) => {
        validateBoundEffect(effect, context, plan);
        if (effect.kind === 'message') await validateCandidateActionMessage(admin, userId, context.scope, effect);
      }));
      const failed = checks.find((check): check is PromiseRejectedResult => check.status === 'rejected');
      if (failed) throw failed.reason;
      plan = await approvePlan(admin, userId, planId, expectedRevision(body), context.contextVersion);
      return json({ success: true, plan });
    }

    const effectId = str(body.effect_id);
    const effect = plan.effects.find((item) => item.id === effectId);
    if (!effect) throw new ActionRequestError('ACTION_EFFECT_REQUIRED', 'Ce contenu ne fait pas partie de la proposition.', 400);
    if (['succeeded', 'skipped', 'unknown', 'running'].includes(effect.status)) return json({ success: true, plan });
    validateBoundEffect(effect, context, plan);
    if (effect.kind === 'message') await validateCandidateActionMessage(admin, userId, context.scope, effect);
    const claim = await claimEffect(admin, userId, planId, effectId);
    if (!claim.claimed || !claim.claimToken) return json({ success: true, plan: await getPlan(admin, userId, planId) });
    if (claim.effect.kind === 'message') {
      // An unexpected exception after the claim may follow an accepted POST. Never mark it retryable.
      const outcome = await sendCandidateActionMessage(admin, userId, context.scope, claim.effect, { planId }).catch(() => ({
        status: 'unknown' as const, result: { errorCode: 'SEND_RESULT_UNCERTAIN', message: 'L’état de l’envoi n’a pas pu être confirmé. Vérifiez vos messages envoyés avant toute nouvelle action.' },
      }));
      plan = await completeEffect(admin, userId, planId, effectId, claim.claimToken, outcome);
    } else {
      // Document/comment creation and its outcome are committed together by the RPC.
      // A lost response may hide success: completion preserves an existing terminal receipt.
      plan = await writeInternalEffect(admin, userId, planId, effectId, claim.claimToken).catch(() => completeEffect(admin, userId, planId, effectId, claim.claimToken!, {
        status: 'failed', result: { errorCode: 'ACTION_INTERNAL_NOT_SAVED', message: 'Le contenu n’a pas pu être enregistré. Les autres résultats sont conservés ; vous pouvez reprendre cet enregistrement.' },
      }));
    }
    return json({ success: true, plan });
  } catch (error) {
    return errorResponse(error);
  }
});

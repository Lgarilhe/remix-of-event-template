import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';
import type {
  CandidateActionEdits, CandidateActionEffect, CandidateActionMessageOutcome,
  CandidateActionPlan, CandidateActionScope, CandidateActionMessageRecord,
} from './types.ts';

/** These RPCs are service-only. The endpoint authenticates and rebuilds context. */
export class CandidateActionStoreError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'CandidateActionStoreError'; }
}

async function rpc<T>(client: SupabaseClient, name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, params);
  if (error) throw new CandidateActionStoreError(error.hint || error.code || 'STORE_ERROR', error.message);
  return data as T;
}

export function createPlan(client: SupabaseClient, userId: string, plan: CandidateActionPlan): Promise<CandidateActionPlan> {
  return rpc(client, 'candidate_actions_create_plan', { p_user_id: userId, p_plan: plan });
}

export async function listPlans(client: SupabaseClient, userId: string, scope: CandidateActionScope): Promise<CandidateActionPlan[]> {
  return rpc(client, 'candidate_actions_list_plans', { p_user_id: userId, p_scope: scope });
}

/** Use the user's JWT client so row-level visibility is never widened by service. */
export async function listMessages(userClient: SupabaseClient, scope: CandidateActionScope): Promise<CandidateActionMessageRecord[]> {
  let query = userClient.from('candidate_action_messages').select('*')
    .eq('organization_id', scope.organization_id).eq('candidate_id', scope.candidate_id)
    .order('occurred_at', { ascending: false }).limit(200);
  // Unassigned history stays visibly unassigned. This display query never
  // turns it into evidence belonging to the currently selected mission.
  query = scope.project_id ? query.or(`project_id.eq.${scope.project_id},project_id.is.null`) : query.is('project_id', null);
  const { data, error } = await query;
  if (error) throw new CandidateActionStoreError(error.hint || error.code || 'STORE_ERROR', error.message);
  return (data ?? []) as CandidateActionMessageRecord[];
}

export function getPlan(client: SupabaseClient, userId: string, planId: string): Promise<CandidateActionPlan> {
  return rpc(client, 'candidate_actions_get_plan', { p_user_id: userId, p_plan_id: planId });
}

export function saveDrafts(client: SupabaseClient, userId: string, planId: string, expectedRevision: number, edits: CandidateActionEdits): Promise<CandidateActionPlan> {
  return rpc(client, 'candidate_actions_save_drafts', {
    p_user_id: userId, p_plan_id: planId, p_expected_revision: expectedRevision, p_edits: edits,
  });
}

export function approvePlan(client: SupabaseClient, userId: string, planId: string, expectedRevision: number, contextVersion?: string): Promise<CandidateActionPlan> {
  return rpc(client, 'candidate_actions_approve_plan', {
    p_user_id: userId, p_plan_id: planId, p_expected_revision: expectedRevision, p_context_version: contextVersion ?? null,
  });
}

export interface CandidateActionClaim { claimed: boolean; claimToken?: string; effect: CandidateActionEffect }
export function claimEffect(client: SupabaseClient, userId: string, planId: string, effectId: string): Promise<CandidateActionClaim> {
  return rpc(client, 'candidate_actions_claim_effect', { p_user_id: userId, p_plan_id: planId, p_effect_id: effectId });
}

export function completeEffect(client: SupabaseClient, userId: string, planId: string, effectId: string, claimToken: string, outcome: CandidateActionMessageOutcome): Promise<CandidateActionPlan> {
  return rpc(client, 'candidate_actions_complete_effect', {
    p_user_id: userId, p_plan_id: planId, p_effect_id: effectId, p_claim_token: claimToken,
    p_status: outcome.status, p_result: outcome.result,
  });
}

export function writeInternalEffect(client: SupabaseClient, userId: string, planId: string, effectId: string, claimToken: string): Promise<CandidateActionPlan> {
  return rpc(client, 'candidate_actions_write_internal_effect', { p_user_id: userId, p_plan_id: planId, p_effect_id: effectId, p_claim_token: claimToken });
}

export function dismissPlan(client: SupabaseClient, userId: string, planId: string, dismissed = true): Promise<CandidateActionPlan> {
  return rpc(client, 'candidate_actions_dismiss_plan', { p_user_id: userId, p_plan_id: planId, p_dismissed: dismissed });
}

export function markNeedsReview(client: SupabaseClient, userId: string, planId: string): Promise<CandidateActionPlan> {
  return rpc(client, 'candidate_actions_mark_needs_review', { p_user_id: userId, p_plan_id: planId });
}

export async function reconcileInterruptedEffects(client: SupabaseClient, userId: string, scope: CandidateActionScope): Promise<number> {
  return rpc(client, 'candidate_actions_reconcile_interrupted', { p_user_id: userId, p_scope: scope });
}

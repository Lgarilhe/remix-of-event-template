/** A mission agent performs one durable, fenced piece of work per invocation. */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.75.1';
import { stableScoringContextKey, SOURCING_SCORING_ENGINE_VERSION } from './scoring-context.ts';
import { loadSourcingMemoryContext } from './sourcing-memory.ts';
import { buildJobFromBrief, buildProfileData } from './profile-data.ts';
import { getSubscriptionGate } from './subscription-gate.ts';
import { resolveUnipileCredentials } from './resolve-org-credentials.ts';
import { assertCredits } from './credit-guard.ts';
import { calculateTokenCredits, estimateCredits, MODEL_CATALOG } from './ai-config.ts';
import { enforceLinkedInAction, getUserQuotas, isWithinBusinessHours, nextBusinessHoursStart } from './linkedin-quotas.ts';
import { isCandidateErasedForOrg, linkedInProfileSlug } from './get-or-fetch-contact.ts';
import { buildContinuousSearchRequest, continuousCalculatedExperienceRange } from './continuous-sourcing-filters.ts';
import { matchesCalculatedExperience } from './profile-experience.ts';

export type AgentJson = Record<string, unknown>;
export type AgentApi = 'classic' | 'recruiter' | 'sales_navigator';
export interface ContinuousSettings {
  cadence_hours: number; daily_profile_limit: number; daily_credit_limit: number;
  max_pending: number; min_score: number; model_id: string;
}
export const CONTINUOUS_DEFAULTS: ContinuousSettings = {
  cadence_hours: 6, daily_profile_limit: 20, daily_credit_limit: 100,
  max_pending: 10, min_score: 70, model_id: 'claude-sonnet-5-5',
};
export interface ContinuousAgent {
  id: string; organization_id: string; project_id: string; created_by: string;
  source: 'linkedin' | 'pool'; account_id: string | null; api: AgentApi | null;
  settings: ContinuousSettings; status: string; revision: number;
  approved_context_key: string | null; context_snapshot: AgentJson;
  search_filters_snapshot: AgentJson; checkpoint: AgentJson;
  next_run_at: string | null; lease_token: string | null; lease_until: string | null;
  daily_date: string; profiles_used: number; credits_reserved: number; credits_used: number;
  last_reason?: string | null; last_error?: string | null;
}
export interface ContinuousCandidate {
  id: string; agent_id: string; candidate_id: string; person_key: string;
  profile: AgentJson; score: number | null; result: AgentJson;
  provenance: AgentJson; source_aliases: string[]; context_key: string;
  state: 'discovered' | 'scored' | 'proposed' | 'reviewed' | 'skipped';
  decision: 'fit' | 'reject' | null; reason: string | null;
  credits_reserved: number; credits_used: number;
}
export function isContinuousCandidateUncertain(candidate: ContinuousCandidate): boolean {
  return candidate.state === 'discovered' && Boolean(candidate.credits_reserved > 0 ||
    typeof candidate.provenance.scoring_started_at === 'string' || candidate.provenance.reservation_recovered);
}
export interface AgentProject extends AgentJson {
  id: string; organization_id: string; created_by: string; name: string;
  status: string; job_details: AgentJson; filters_snapshot: AgentJson;
}
export interface AgentAccount {
  id: string; name: string; apis: AgentApi[]; status: string;
}
export class ContinuousError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
export function record(value: unknown): AgentJson {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AgentJson : {};
}
export function normalizeContinuousSettings(value: unknown, base = CONTINUOUS_DEFAULTS): ContinuousSettings {
  const raw = record(value);
  const allowed = new Set(Object.keys(CONTINUOUS_DEFAULTS));
  if (Object.keys(raw).some(key => !allowed.has(key))) throw new ContinuousError('INVALID_SETTINGS', 'Réglage inconnu.', 400);
  const next = { ...base, ...raw } as ContinuousSettings;
  const bounds: Array<[keyof ContinuousSettings, number, number]> = [
    ['daily_profile_limit', 5, 100], ['daily_credit_limit', 12, 500],
    ['max_pending', 5, 50], ['min_score', 0, 100],
  ];
  for (const [key, min, max] of bounds) {
    const number = next[key];
    if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) {
      throw new ContinuousError('INVALID_SETTINGS', key === 'daily_credit_limit' ? 'Le budget cible doit être un entier compris entre 12 et 500 crédits.' : 'Les limites saisies sont invalides.', 400);
    }
  }
  if (![2, 6, 12, 24].includes(next.cadence_hours) || next.model_id !== CONTINUOUS_DEFAULTS.model_id || !MODEL_CATALOG[next.model_id]) {
    throw new ContinuousError('INVALID_SETTINGS', 'Cadence ou modèle indisponible.', 400);
  }
  return next;
}
export async function continuousContextKey(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableScoringContextKey(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function continuousLinkedInUrl(profile: AgentJson): string | null {
  const value = profile.profile_url ?? profile.profileUrl ?? profile.public_profile_url;
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com')) ? url.href : null;
  } catch { return null; }
}
export function profileIdentity(profile: AgentJson): { candidateId: string; personKey: string; aliases: string[] } | null {
  const ids = [profile.provider_id, profile.id, profile.public_identifier]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map(value => value.trim()).filter(value => value.length <= 490);
  const slug = linkedInProfileSlug(continuousLinkedInUrl(profile));
  const candidateId = ids[0] || (slug ? 'linkedin:' + slug : '');
  if (!candidateId) return null; // Names are never a sufficient identity.
  const aliases = [...new Set([...ids.map(id => 'id:' + id), ...(slug ? ['slug:' + slug] : [])])];
  return { candidateId, personKey: slug ? 'slug:' + slug : 'id:' + candidateId, aliases };
}
export function isLeaseCurrent(agent: ContinuousAgent | null, expected: ContinuousAgent, now: number): boolean {
  return Boolean(agent && ['active', 'calibrating'].includes(agent.status) && agent.lease_token &&
    agent.lease_token === expected.lease_token && Date.parse(agent.lease_until || '') > now &&
    agent.revision === expected.revision && agent.context_snapshot.context_key === expected.context_snapshot.context_key);
}
export async function readAgentProject(admin: SupabaseClient, userId: string, projectId: string, orgId?: string): Promise<AgentProject> {
  const { data: project, error } = await admin.from('sourcing_projects')
    .select('id,organization_id,created_by,name,status,job_details,filters_snapshot,kind').eq('id', projectId).maybeSingle();
  if (error) throw new ContinuousError('CONTEXT_UNAVAILABLE', 'La mission ne peut pas être vérifiée.', 503);
  if (!project || (orgId && project.organization_id !== orgId) || project.kind !== 'mission') {
    throw new ContinuousError('AGENT_FORBIDDEN', 'Cette mission est inaccessible.', 403);
  }
  const { data: member, error: memberError } = await admin.from('organization_members').select('role')
    .eq('organization_id', project.organization_id).eq('user_id', userId).maybeSingle();
  if (memberError || !member) throw new ContinuousError('ACCESS_REVOKED', 'Vous ne faites plus partie de cet espace.', 403);
  // The service-only memory RPC also verifies the actor's access to this mission
  // (including collaborator invitation), rather than trusting org membership.
  await loadSourcingMemoryContext(admin as never, { userId, organizationId: project.organization_id,
    projectId, effect: 'search', serviceRole: true });
  return { ...project, job_details: record(project.job_details), filters_snapshot: record(project.filters_snapshot) } as AgentProject;
}
export async function loadContinuousContext(admin: SupabaseClient, project: AgentProject,
  userId: string, config: Pick<ContinuousAgent, 'source' | 'account_id' | 'api' | 'settings'>): Promise<AgentJson> {
  const [search, scoring] = await Promise.all([
    loadSourcingMemoryContext(admin as never, { userId, organizationId: project.organization_id, projectId: project.id, effect: 'search', serviceRole: true }),
    loadSourcingMemoryContext(admin as never, { userId, organizationId: project.organization_id, projectId: project.id, effect: 'scoring', serviceRole: true }),
  ]);
  const inputs = { job_details: project.job_details, filters_snapshot: project.filters_snapshot,
    source: config.source, account_id: config.account_id, api: config.api, model_id: config.settings.model_id,
    scoring_engine_version: SOURCING_SCORING_ENGINE_VERSION,
    search_memory_version_key: search.versionKey, scoring_memory_version_key: scoring.versionKey };
  return { ...inputs, context_key: await continuousContextKey(inputs),
    search_memory_provenance: search.provenance, scoring_memory_provenance: scoring.provenance };
}
/** Used at the provider boundary, after the service-only lease RPC. */
export async function assertContinuousOperationContext(admin: SupabaseClient, agent: ContinuousAgent): Promise<void> {
  const project = await readAgentProject(admin, agent.created_by, agent.project_id, agent.organization_id);
  if (project.status !== 'active') throw new ContinuousError('MISSION_INACTIVE', 'Cette mission n’est plus active.');
  const live = await loadContinuousContext(admin, project, agent.created_by, agent);
  if (live.context_key !== agent.context_snapshot.context_key ||
    (agent.status === 'active' && agent.approved_context_key !== live.context_key)) {
    throw new ContinuousError('CONTEXT_CHANGED', 'Le brief, les filtres ou les mémoires ont changé. Recalibrez l’agent.');
  }
}
export async function requireAgentPlan(admin: SupabaseClient, orgId: string): Promise<void> {
  const gate = await getSubscriptionGate(admin as never, orgId);
  if (gate.effectivePlanId === 'free' || gate.seatCount > gate.seatLimit || ['unpaid', 'canceled', 'past_due'].includes(gate.status)) {
    throw new ContinuousError('PLAN_REQUIRED', 'L’abonnement ou les sièges de cet espace ne permettent pas de démarrer l’agent.', 403);
  }
}
export async function timedFetch(url: string, init: RequestInit, milliseconds = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try { return await fetch(url, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
}
export async function readOwnAgentAccounts(admin: SupabaseClient, userId: string, orgId: string,
  beforeProvider: () => Promise<void> = async () => {}, selectedAccountId?: string): Promise<AgentAccount[]> {
  let query = admin.from('member_linkedin_accounts')
    .select('linkedin_account_id,linkedin_account_name,account_status').eq('organization_id', orgId).eq('user_id', userId);
  if (selectedAccountId) query = query.eq('linkedin_account_id', selectedAccountId);
  const { data: rows, error } = await query;
  if (error) throw new ContinuousError('ACCOUNT_UNAVAILABLE', 'Vos comptes ne peuvent pas être vérifiés.', 503);
  if (!rows?.length) return [];
  const credentials = await resolveUnipileCredentials(orgId, admin as never);
  if (!credentials) throw new ContinuousError('ACCOUNT_UNAVAILABLE', 'La connexion LinkedIn est indisponible.', 503);
  const base = credentials.dsn.startsWith('http') ? credentials.dsn : 'https://' + credentials.dsn;
  const accounts: AgentAccount[] = [];
  for (const row of rows) {
    const id = String(row.linkedin_account_id || '');
    if (!id || id.includes('..') || /[/\\?#]/.test(id)) continue;
    await beforeProvider();
    const response = await timedFetch(`${base}/api/v1/accounts/${encodeURIComponent(id)}`, {
      headers: { 'X-API-KEY': credentials.apiKey, Accept: 'application/json' },
    });
    if (!response.ok) { accounts.push({ id, name: row.linkedin_account_name || 'Mon compte', status: 'UNAVAILABLE', apis: [] }); continue; }
    const account = record(await response.json());
    if (account.id !== id || String(account.type).toUpperCase() !== 'LINKEDIN') continue;
    const sources = Array.isArray(account.sources) ? account.sources.map(record) : [];
    const status = sources.some(source => source.status === 'OK') ? 'OK' : String(sources[0]?.status || 'UNKNOWN');
    const im = record(record(account.connection_params).im);
    const features = Array.isArray(im.premiumFeatures) ? im.premiumFeatures.map(String).map(value => value.toLowerCase()) : [];
    // Use actual provider entitlements. A Lite entitlement is not full Recruiter.
    const apis: AgentApi[] = ['classic'];
    if (features.some(feature => /recruiter/.test(feature) && !/lite/.test(feature))) apis.push('recruiter');
    if (features.some(feature => /sales.*navigator|sales_navigator/.test(feature))) apis.push('sales_navigator');
    accounts.push({ id, name: String(account.name || row.linkedin_account_name || 'Mon compte'), status, apis });
  }
  return accounts;
}
export function requireAccount(agent: Pick<ContinuousAgent, 'source' | 'account_id' | 'api'>, accounts: AgentAccount[]): void {
  if (agent.source === 'pool') return;
  const account = accounts.find(item => item.id === agent.account_id);
  if (!account) throw new ContinuousError('ACCOUNT_FORBIDDEN', 'Choisissez un compte LinkedIn qui vous appartient.', 403);
  if (account.status !== 'OK') throw new ContinuousError('ACCOUNT_RECONNECT', 'Reconnectez le compte LinkedIn avant de continuer.', 409);
  if (!agent.api || !account.apis.includes(agent.api)) throw new ContinuousError('LICENSE_UNAVAILABLE', 'Cette recherche n’est pas disponible sur le contrat LinkedIn connecté.', 409);
}
export function continuousSearchRequest(snapshot: unknown, api: AgentApi): AgentJson {
  try { return buildContinuousSearchRequest(snapshot, api); }
  catch (error) {
    const code = record(error).code;
    throw new ContinuousError(typeof code === 'string' ? code.toUpperCase() : 'FILTERS_INVALID',
      error instanceof Error ? error.message : 'Revoyez les filtres avant de continuer.', 409);
  }
}
/** A saved query must acknowledge the current shared search decisions. */
export function assertContinuousSearchMemory(snapshot: unknown, context: AgentJson): void {
  const applied = record(record(snapshot).memory_context);
  const current = Array.isArray(context.search_memory_provenance) ? context.search_memory_provenance : [];
  const previous = Array.isArray(applied.provenance) ? applied.provenance : [];
  if ((current.length > 0 || previous.length > 0) &&
    (applied.effect !== 'search' || applied.versionKey !== context.search_memory_version_key)) {
    throw new ContinuousError('FILTERS_MEMORY_STALE', 'Les mémoires de recherche ont changé. Actualisez ou revoyez les filtres dans la recherche avant de calibrer l’agent.');
  }
}
/** Recent history is bounded; unresolved paid operations are always included. */
export async function listContinuousAgentCandidates(admin: SupabaseClient, agent: ContinuousAgent, recentLimit = 200): Promise<ContinuousCandidate[]> {
  const scoped = () => admin.from('sourcing_agent_candidates').select('*').eq('agent_id', agent.id)
    .eq('organization_id', agent.organization_id).eq('created_by', agent.created_by);
  const read = async (query: PromiseLike<{ data: unknown; error: unknown }>): Promise<ContinuousCandidate[]> => {
    const { data, error } = await query;
    if (error || !Array.isArray(data)) throw new ContinuousError('CONTEXT_UNAVAILABLE', 'Les propositions ne peuvent pas être vérifiées.', 503);
    return data as ContinuousCandidate[];
  };
  const uncertain = async () => {
    const rows: ContinuousCandidate[] = [];
    for (let offset = 0; ; offset += 200) {
      const page = await read(scoped().eq('state', 'discovered')
        .or('credits_reserved.gt.0,provenance->>scoring_started_at.not.is.null,provenance->>reservation_recovered.not.is.null')
        .order('updated_at', { ascending: false }).order('id', { ascending: true }).range(offset, offset + 199));
      rows.push(...page);
      if (page.length < 200) return rows;
    }
  };
  const [interrupted, recent] = await Promise.all([uncertain(), read(scoped().order('updated_at', { ascending: false }).limit(recentLimit))]);
  return [...new Map([...interrupted, ...recent].map(candidate => [candidate.id, candidate])).values()];
}

export interface TickDependencies {
  now(): number;
  claim(): Promise<ContinuousAgent | null>;
  reread(agent: ContinuousAgent): Promise<ContinuousAgent | null>;
  context(agent: ContinuousAgent): Promise<AgentJson>;
  eligibility(agent: ContinuousAgent, beforeProvider: () => Promise<void>): Promise<void>;
  candidates(agent: ContinuousAgent): Promise<ContinuousCandidate[]>;
  discover(agent: ContinuousAgent, limit: number): Promise<{ profiles: AgentJson[]; cursor: string | null; exhausted: boolean }>;
  prepare(agent: ContinuousAgent, candidate: ContinuousCandidate): Promise<AgentJson>;
  privateAllowed(agent: ContinuousAgent, profile: AgentJson): Promise<boolean>;
  reserve(agent: ContinuousAgent, count: number, credits: number): Promise<boolean>;
  write(agent: ContinuousAgent, personKey: string, patch: AgentJson): Promise<void>;
  evaluate(agent: ContinuousAgent, candidate: ContinuousCandidate, reservation: number): Promise<{ result: AgentJson; credits: number }>;
  checkpoint(agent: ContinuousAgent, patch: AgentJson): Promise<void>;
  quote(agent: ContinuousAgent, profile: AgentJson): number;
}

/** Tested orchestration. No provider can be reached before authorization and fencing. */
export async function runContinuousSourcingTick(deps: TickDependencies): Promise<AgentJson> {
  const agent = await deps.claim();
  if (!agent) return { processed: 0 };
  const guard = async () => {
    const fresh = await deps.reread(agent);
    if (!isLeaseCurrent(fresh, agent, deps.now())) throw new ContinuousError('LEASE_LOST', 'Le cycle a été arrêté.');
    const context = await deps.context(agent);
    if (context.context_key !== agent.context_snapshot.context_key ||
      (agent.status === 'active' && agent.approved_context_key !== context.context_key)) {
      throw new ContinuousError('CONTEXT_CHANGED', 'Le brief, les filtres ou les règles ont changé. Recalibrez l’agent.');
    }
  };
  const finish = (patch: AgentJson) => deps.checkpoint(agent, patch);
  try {
    await guard();
    await deps.eligibility(agent, guard);
    await guard();
    const candidates = await deps.candidates(agent);
    if (candidates.some(isContinuousCandidateUncertain)) {
      await finish({ status: 'blocked', last_reason: 'SCORING_UNCERTAIN' });
      return { processed: 1, phase: 'uncertain' };
    }
    const current = candidates.filter(candidate => candidate.context_key === agent.context_snapshot.context_key);
    const pending = current.filter(candidate => candidate.state === 'proposed');
    if (pending.length >= agent.settings.max_pending) {
      await finish({ status: 'awaiting_review', last_reason: 'WAITING_REVIEW' });
      return { processed: 1, phase: 'waiting_review' };
    }
    const dailyCapReached = () => {
      const usedToday = agent.daily_date === new Date(deps.now()).toISOString().slice(0, 10);
      return (usedToday && agent.profiles_used >= agent.settings.daily_profile_limit) ||
        (usedToday ? agent.credits_used : 0) + agent.credits_reserved + deps.quote(agent, {}) > agent.settings.daily_credit_limit;
    };
    const waitForBudget = async () => {
      const tomorrow = new Date(deps.now());
      tomorrow.setUTCHours(24, 0, 0, 0);
      await finish({ last_reason: 'DAILY_BUDGET', next_run_at: tomorrow.toISOString() });
      return { processed: 1, phase: 'budget' };
    };
    const ready = current.find(candidate => candidate.state === 'discovered' && candidate.decision !== 'reject');
    if (ready) {
      // A prior invocation might have reached the paid provider. Never retry it
      // automatically: the reservation is a durable uncertainty marker.
      if (isContinuousCandidateUncertain(ready)) {
        await finish({ status: 'blocked', last_reason: 'SCORING_UNCERTAIN' });
        return { processed: 1, phase: 'uncertain' };
      }
      if (!await deps.privateAllowed(agent, ready.profile)) {
        await guard();
        await deps.write(agent, ready.person_key, { state: 'skipped', provenance: { ...ready.provenance, skip_reason: 'PRIVACY_OPPOSITION' }, credits_used: 0 });
        await finish({ next_run_at: new Date(deps.now() + 60_000).toISOString() });
        return { processed: 1, phase: 'privacy_skipped' };
      }
      if (dailyCapReached()) return await waitForBudget();
      if (agent.source === 'linkedin' && !ready.provenance.profile_prepared_at) {
        await guard();
        const fullProfile = await deps.prepare(agent, ready);
        await guard();
        if (!await deps.privateAllowed(agent, fullProfile)) throw new ContinuousError('PRIVACY_CHANGED', 'Les droits sur ce profil ont changé.');
        const identity = profileIdentity(fullProfile);
        if (!identity || !identity.aliases.some(alias => ready.source_aliases.includes(alias))) {
          throw new ContinuousError('PROFILE_IDENTITY_CHANGED', 'L’identité du profil ne peut pas être confirmée.');
        }
        await deps.write(agent, ready.person_key, { profile: fullProfile,
          source_aliases: [...new Set([...ready.source_aliases, ...identity.aliases])],
          provenance: { ...ready.provenance, profile_prepared_at: new Date(deps.now()).toISOString() } });
        await finish({ checkpoint: { ...agent.checkpoint, phase: 'score' },
          next_run_at: new Date(deps.now() + 60_000).toISOString() });
        return { processed: 1, phase: 'prepare', candidate_id: ready.id };
      }
      const reservation = deps.quote(agent, ready.profile);
      await guard();
      if (!await deps.reserve(agent, 1, reservation)) {
        return await waitForBudget();
      }
      await deps.write(agent, ready.person_key, { credits_reserved: reservation,
        provenance: { ...ready.provenance, scoring_started_at: new Date(deps.now()).toISOString() } });
      await guard();
      const scored = await deps.evaluate(agent, ready, reservation);
      await guard();
      if (!await deps.privateAllowed(agent, ready.profile)) throw new ContinuousError('PRIVACY_CHANGED', 'Les droits sur ce profil ont changé.');
      const score = Number(scored.result.finalScore ?? scored.result.score);
      if (!Number.isFinite(score) || score < 0 || score > 100 || typeof record(scored.result.scoringContext).fingerprint !== 'string') {
        throw new ContinuousError('SCORING_UNCERTAIN', 'Le résultat d’évaluation ne peut pas être confirmé.');
      }
      await deps.write(agent, ready.person_key, { score, result: scored.result, credits_used: scored.credits,
        state: agent.status === 'calibrating' || score >= agent.settings.min_score ? 'proposed' : 'scored' });
      const sampleDone = agent.status === 'calibrating' && current.filter(candidate => candidate.id !== ready.id && candidate.result &&
        ['scored', 'proposed', 'reviewed'].includes(candidate.state)).length + 1 >= 5;
      await finish({ ...(sampleDone ? { status: 'awaiting_review', last_reason: 'CALIBRATION_REQUIRED' } : { last_reason: null }),
        next_run_at: new Date(deps.now() + 60_000).toISOString() });
      return { processed: 1, phase: 'score', candidate_id: ready.id };
    }
    if (agent.status === 'calibrating' && current.filter(candidate => candidate.state === 'reviewed').length >= 5) {
      await finish({ status: 'awaiting_review', last_reason: 'CALIBRATION_REQUIRED' });
      return { processed: 1, phase: 'calibration' };
    }
    if (dailyCapReached()) return await waitForBudget();
    const sampleRemaining = agent.status === 'calibrating' ? Math.max(0, 5 - current.filter(candidate => candidate.state !== 'skipped').length) : 25;
    const limit = Math.min(25, agent.settings.daily_profile_limit, sampleRemaining,
      Math.max(0, agent.settings.max_pending - pending.length));
    if (limit <= 0) { await finish({ status: 'awaiting_review', last_reason: 'WAITING_REVIEW' }); return { processed: 1 }; }
    const nextDiscovery = typeof agent.checkpoint.next_discovery_at === 'string' ? Date.parse(agent.checkpoint.next_discovery_at) : NaN;
    if (Number.isFinite(nextDiscovery) && nextDiscovery > deps.now()) {
      await finish({ next_run_at: new Date(nextDiscovery).toISOString() });
      return { processed: 1, phase: 'cadence' };
    }
    await guard();
    const discovered = await deps.discover(agent, limit);
    await guard();
    const seen = new Set(candidates.filter(candidate => candidate.context_key === agent.context_snapshot.context_key || candidate.decision === 'reject' || isContinuousCandidateUncertain(candidate) ||
      candidate.provenance.skip_reason === 'HUMAN_SKIP_UNCERTAIN')
      .flatMap(candidate => [candidate.person_key, ...candidate.source_aliases]));
    let added = 0;
    for (const profile of discovered.profiles) {
      const identity = profileIdentity(profile);
      if (!identity || seen.has(identity.personKey) || identity.aliases.some(alias => seen.has(alias))) continue;
      if (!await deps.privateAllowed(agent, profile)) continue;
      await guard();
      await deps.write(agent, identity.personKey, { candidate_id: identity.candidateId, profile,
        source_aliases: identity.aliases, context_key: agent.context_snapshot.context_key,
        provenance: { source: agent.source, discovered_at: new Date(deps.now()).toISOString(),
          ...(typeof profile._mission_row_id === 'string' ? { mission_row_id: profile._mission_row_id } : {}) }, state: 'discovered' });
      identity.aliases.forEach(alias => seen.add(alias)); seen.add(identity.personKey); added++;
    }
    await finish({ checkpoint: { ...agent.checkpoint, phase: 'score', cursor: discovered.cursor,
      exhausted: discovered.exhausted, next_discovery_at: new Date(deps.now() + agent.settings.cadence_hours * 3600_000).toISOString() },
      last_reason: added === 0 && discovered.exhausted ? 'SEARCH_EXHAUSTED' : null,
      next_run_at: new Date(deps.now() + (added > 0 ? 60_000 : agent.settings.cadence_hours * 3600_000)).toISOString() });
    return { processed: 1, phase: 'discover', added };
  } catch (error) {
    const code = error instanceof ContinuousError ? error.code : 'RETRY_LATER';
    if (code !== 'LEASE_LOST') {
      const retry = ['OUTSIDE_HOURS', 'QUOTA_REACHED', 'DAILY_BUDGET', 'RETRY_LATER'].includes(code);
      await finish({ ...(retry ? {} : { status: 'blocked' }), last_reason: code,
        last_error: code,
        next_run_at: new Date(deps.now() + (retry ? 3600_000 : agent.settings.cadence_hours * 3600_000)).toISOString() });
    }
    return { processed: 1, phase: 'paused', reason: code };
  }
}

/** Adapter kept outside the orchestration so tests exercise decisions without I/O. */
export function createContinuousDependencies(admin: SupabaseClient, supabaseUrl: string, serviceKey: string): TickDependencies {
  const checked = async <T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<T> => {
    const { data, error } = await promise;
    if (error) {
      const raw = record(error);
      const hint = String(raw.hint || '');
      if (hint.includes('STALE_LEASE') || hint.includes('REVISION')) throw new ContinuousError('LEASE_LOST', 'Cycle interrompu.');
      if (hint.includes('CONTEXT_CHANGED')) throw new ContinuousError('CONTEXT_CHANGED', 'Le besoin a changé. Recalibrez l’agent.');
      if (hint.includes('CANDIDATE_ERASED')) throw new ContinuousError('PRIVACY_CHANGED', 'Les données de ce profil ont été effacées.');
      if (hint.includes('SCORING_UNCERTAIN')) throw new ContinuousError('SCORING_UNCERTAIN', 'Ignorez les évaluations interrompues avant de relancer l’agent.');
      if (hint.includes('MISSION_INACTIVE')) throw new ContinuousError('MISSION_INACTIVE', 'Cette mission n’est plus active.');
      if (raw.code === '42501') throw new ContinuousError('ACCESS_REVOKED', 'Les droits de cet agent ont changé.', 403);
      throw error;
    }
    return data;
  };
  const rpc = async <T>(name: string, args: AgentJson): Promise<T> => checked(admin.rpc(name, args)) as Promise<T>;
  const reread = (agent: ContinuousAgent) => checked(admin.from('sourcing_agents').select('*')
    .eq('id', agent.id).eq('organization_id', agent.organization_id).maybeSingle()) as Promise<ContinuousAgent | null>;
  const assertCurrent = async (agent: ContinuousAgent) => {
    if (!isLeaseCurrent(await reread(agent), agent, Date.now())) throw new ContinuousError('LEASE_LOST', 'Cycle interrompu.');
    await assertContinuousOperationContext(admin, agent);
  };
  const fencedRequest = (agent: ContinuousAgent): AgentJson => ({ continuous_agent_run: true,
    continuous_agent_id: agent.id, continuous_lease_token: agent.lease_token,
    continuous_context_key: agent.context_snapshot.context_key, user_id: agent.created_by });
  const functions = async (name: 'unipile-search' | 'score-profile-job', payload: AgentJson, milliseconds = 25_000) => {
    const response = await timedFetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, milliseconds);
    const data = record(await response.json());
    if (!response.ok || data.success === false) {
      const known = typeof data.error_code === 'string' ? data.error_code : response.status === 402 ? 'INSUFFICIENT_CREDITS' :
        response.status === 429 ? 'QUOTA_REACHED' : 'RETRY_LATER';
      throw new ContinuousError(known, typeof data.error === 'string' ? data.error : 'Le traitement n’a pas abouti.', response.status);
    }
    return data;
  };
  return {
    now: () => Date.now(),
    claim: async () => {
      const rows = await rpc<ContinuousAgent[]>('claim_sourcing_agent', {});
      return rows?.[0] || null;
    },
    reread,
    context: async agent => {
      const project = await readAgentProject(admin, agent.created_by, agent.project_id, agent.organization_id);
      return loadContinuousContext(admin, project, agent.created_by, agent);
    },
    eligibility: async (agent, guard) => {
      await requireAgentPlan(admin, agent.organization_id);
      const project = await readAgentProject(admin, agent.created_by, agent.project_id, agent.organization_id);
      if (project.status !== 'active') throw new ContinuousError('MISSION_INACTIVE', 'Cette mission n’est plus active.');
      if (!String(project.job_details.title || project.name).trim()) throw new ContinuousError('BRIEF_REQUIRED', 'Décrivez le poste avant de démarrer.');
      const minimumQuote = Math.max(estimateCredits('scoring', agent.settings.model_id), 12);
      if (agent.settings.daily_credit_limit < minimumQuote) {
        throw new ContinuousError('INVALID_SETTINGS', `Le budget cible doit couvrir au moins une évaluation, soit ${minimumQuote} crédits.`, 400);
      }
      if (agent.source === 'linkedin') {
        assertContinuousSearchMemory(agent.search_filters_snapshot, agent.context_snapshot);
        requireAccount(agent, await readOwnAgentAccounts(admin, agent.created_by, agent.organization_id, guard, agent.account_id || undefined));
        continuousSearchRequest(agent.search_filters_snapshot, agent.api!);
      }
    },
    candidates: agent => listContinuousAgentCandidates(admin, agent, 500),
    privateAllowed: async (agent, profile) => {
      if (profile.no_ai_scoring === true || profile.noAiScoring === true || profile.gdpr_erased_at) return false;
      if (agent.source === 'pool' && typeof profile._mission_row_id === 'string') {
        const source = await checked(admin.from('job_candidate_status').select('linkedin_profile_data')
          .eq('id', profile._mission_row_id).eq('organization_id', agent.organization_id).eq('created_by', agent.created_by).maybeSingle());
        if (!source) return false;
        const latest = record(source.linkedin_profile_data);
        if (latest.no_ai_scoring === true || latest.noAiScoring === true || latest.gdpr_erased_at) return false;
      }
      const identity = profileIdentity(profile);
      if (!identity) return false;
      const emails = [profile.email, ...(Array.isArray(record(profile.contact_info).emails) ? record(profile.contact_info).emails as unknown[] : [])]
        .filter((email): email is string => typeof email === 'string');
      return !await isCandidateErasedForOrg(admin as never, { organizationId: agent.organization_id,
        linkedinIds: identity.aliases.filter(alias => alias.startsWith('id:')).map(alias => alias.slice(3)),
        linkedinUrl: typeof profile.profile_url === 'string' ? profile.profile_url : typeof profile.public_profile_url === 'string' ? profile.public_profile_url : null, emails });
    },
    discover: async (agent, limit) => {
      await assertCurrent(agent);
      const cursor = typeof agent.checkpoint.cursor === 'string' ? agent.checkpoint.cursor : null;
      if (agent.source === 'pool') {
        // Personal pool: service role never widens it to another recruiter's rows.
        let query = admin.from('job_candidate_status').select('id,created_at,candidate_id,candidate_name,candidate_headline,linkedin_profile_url,linkedin_profile_data')
          .eq('organization_id', agent.organization_id).eq('created_by', agent.created_by)
          .not('linkedin_profile_data', 'is', null).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(limit);
        if (cursor) {
          let after: AgentJson;
          try { after = record(JSON.parse(cursor)); } catch { throw new ContinuousError('CURSOR_INVALID', 'Relancez la calibration du vivier.'); }
          if (typeof after.created_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(after.created_at) ||
            typeof after.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(after.id)) {
            throw new ContinuousError('CURSOR_INVALID', 'Relancez la calibration du vivier.');
          }
          query = query.or(`created_at.gt.${after.created_at},and(created_at.eq.${after.created_at},id.gt.${after.id})`);
        }
        const rows = await checked(query) || [];
        const last = rows[rows.length - 1];
        return { profiles: rows.map(row => ({ ...record(row.linkedin_profile_data), id: row.candidate_id,
          name: row.candidate_name, headline: row.candidate_headline, profile_url: row.linkedin_profile_url,
          _mission_row_id: row.id })), cursor: last ? JSON.stringify({ created_at: last.created_at, id: last.id }) : cursor,
          exhausted: rows.length < limit };
      }
      const quotas = await getUserQuotas(admin as never, agent.created_by, agent.organization_id);
      if (!isWithinBusinessHours(quotas.timezone, quotas.business_hours_start, quotas.business_hours_end)) {
        throw new ContinuousError('OUTSIDE_HOURS', 'La recherche reprendra dans votre plage horaire LinkedIn.');
      }
      const gate = await enforceLinkedInAction(admin as never, { accountId: agent.account_id,
        organizationId: agent.organization_id, userId: agent.created_by, actionType: 'search', mode: 'auto', source: 'sourcing_agent' });
      if (!gate.allowed) throw new ContinuousError('QUOTA_REACHED', gate.reason || 'Le quota LinkedIn est atteint.');
      await assertCurrent(agent);
      const payload = { ...continuousSearchRequest(agent.search_filters_snapshot, agent.api!), action: 'search',
        ...fencedRequest(agent),
        organization_id: agent.organization_id, account_id: agent.account_id, api: agent.api, category: 'people', limit,
        ...(cursor ? { cursor } : {}) };
      const result = await functions('unipile-search', payload);
      const calculated = continuousCalculatedExperienceRange(agent.search_filters_snapshot, agent.api!);
      const profiles = (Array.isArray(result.results) ? result.results : []).map(record).slice(0, limit)
        .filter(profile => matchesCalculatedExperience({
          work_experience: Array.isArray(profile.work_experience) ? profile.work_experience : undefined,
          current_positions: Array.isArray(profile.current_positions) ? profile.current_positions : undefined,
          past_positions: Array.isArray(profile.past_positions) ? profile.past_positions : undefined,
          education: Array.isArray(profile.education) ? profile.education : undefined,
        }, calculated.min, calculated.max));
      const nextCursor = typeof result.cursor === 'string' && result.cursor ? result.cursor : null;
      return { profiles, cursor: nextCursor, exhausted: !nextCursor };
    },
    prepare: async (agent, candidate) => {
      await assertCurrent(agent);
      const quotas = await getUserQuotas(admin as never, agent.created_by, agent.organization_id);
      if (!isWithinBusinessHours(quotas.timezone, quotas.business_hours_start, quotas.business_hours_end)) {
        throw new ContinuousError('OUTSIDE_HOURS', 'La consultation reprendra dans votre plage horaire LinkedIn.');
      }
      const gate = await enforceLinkedInAction(admin as never, { accountId: agent.account_id,
        organizationId: agent.organization_id, userId: agent.created_by, actionType: 'profile_view', mode: 'auto', source: 'sourcing_agent' });
      if (!gate.allowed) throw new ContinuousError('QUOTA_REACHED', gate.reason || 'Le quota LinkedIn est atteint.');
      await assertCurrent(agent);
      const response = await functions('unipile-search', { action: 'get_profile', organization_id: agent.organization_id,
        ...fencedRequest(agent),
        account_id: agent.account_id, profile_id: candidate.candidate_id, api: agent.api });
      const profile = record(response.profile);
      const identity = profileIdentity(profile);
      if (!identity || !identity.aliases.some(alias => candidate.source_aliases.includes(alias))) {
        throw new ContinuousError('PROFILE_IDENTITY_CHANGED', 'L’identité du profil ne peut pas être confirmée.');
      }
      return { ...candidate.profile, ...profile };
    },
    reserve: async (agent, count, credits) => {
      const gate = await assertCredits({ userId: agent.created_by, organizationId: agent.organization_id,
        aiAction: 'scoring', modelId: agent.settings.model_id, adminClient: admin as never });
      if (!gate.ok || gate.remaining === null || gate.remaining < credits) {
        throw new ContinuousError('INSUFFICIENT_CREDITS', 'Le solde de crédits ne permet pas cette évaluation.', 402);
      }
      return rpc<boolean>('reserve_sourcing_agent_budget', {
        p_agent_id: agent.id, p_lease_token: agent.lease_token, p_profile_count: count, p_credits: credits,
      });
    },
    write: async (agent, personKey, patch) => {
      await rpc('sourcing_agent_candidate_write', { p_agent_id: agent.id, p_lease_token: agent.lease_token,
        p_person_key: personKey, p_patch: { context_key: agent.context_snapshot.context_key, ...patch } });
    },
    quote: agent => Math.max(estimateCredits('scoring', agent.settings.model_id), 12),
    evaluate: async (agent, candidate, reservation) => {
      await assertCurrent(agent);
      const creditGate = await assertCredits({ userId: agent.created_by, organizationId: agent.organization_id,
        aiAction: 'scoring', modelId: agent.settings.model_id, adminClient: admin as never });
      // The legacy credit helper permits an unreadable balance. An unattended
      // agent must stop instead of treating that as unlimited credit.
      if (!creditGate.ok || creditGate.remaining === null || creditGate.remaining < reservation) {
        throw new ContinuousError('INSUFFICIENT_CREDITS', 'Le solde de crédits ne permet pas cette évaluation.', 402);
      }
      await assertCurrent(agent);
      const jobDetails = record(agent.context_snapshot.job_details);
      const job = buildJobFromBrief(jobDetails, { id: 'project:' + agent.project_id, title: jobDetails.title || '' });
      const profile = { ...buildProfileData(candidate.profile), id: candidate.candidate_id };
      const response = await functions('score-profile-job', { profiles: [profile], job, organization_id: agent.organization_id,
        project_id: agent.project_id, user_id: agent.created_by, _ai_action: 'scoring', _ai_model: agent.settings.model_id,
        expected_memory_version_key: agent.context_snapshot.scoring_memory_version_key,
        continuous_agent_run: true, continuous_agent_id: agent.id, continuous_lease_token: agent.lease_token,
        continuous_context_key: agent.context_snapshot.context_key }, 120_000);
      const results = Array.isArray(response.results) ? response.results : [];
      const result = record(results[0]);
      const stats = record(response.stats);
      if (typeof stats.totalTokens !== 'number' || stats.escalated !== 0) {
        throw new ContinuousError('SCORING_UNCERTAIN', 'Le coût réel de cette évaluation ne peut pas être confirmé.');
      }
      const credits = stats.totalTokens === 0 ? 0 : calculateTokenCredits(stats.totalTokens, 0, agent.settings.model_id, 'scoring').credits;
      return { result, credits };
    },
    checkpoint: async (agent, patch) => {
      let next = patch;
      if (patch.last_reason === 'OUTSIDE_HOURS') {
        const quotas = await getUserQuotas(admin as never, agent.created_by, agent.organization_id);
        next = { ...patch, next_run_at: nextBusinessHoursStart(quotas.timezone, quotas.business_hours_start, quotas.business_hours_end) };
      }
      await rpc('sourcing_agent_checkpoint', { p_agent_id: agent.id, p_lease_token: agent.lease_token,
        p_patch: { context_key: agent.context_snapshot.context_key, ...next } });
    },
  };
}

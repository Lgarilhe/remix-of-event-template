/**
 * Aides des tests qui font tourner le moteur de séquences contre la stack
 * locale (e2e/local-stack) : cycle du moteur, webhooks, journal et réponses
 * scriptées du faux prestataire, organisation autorisée à envoyer, seeds.
 *
 * Tout test qui s'en sert doit s'ignorer sans `engineAvailable` (CI actuelle).
 */
import { expect, request } from '@playwright/test';
import { E2E } from './env';
import { admin, createOrg, seedLinkedInAccount, seedSequence, type SeededStep, type TestOrg } from './supabase-admin';

export const MOCK_URL = process.env.E2E_VENDOR_MOCK_URL ?? '';
export const CRON_SECRET = process.env.E2E_PROCESS_SEQUENCES_SECRET ?? '';
export const WEBHOOK_SECRET = process.env.E2E_UNIPILE_WEBHOOK_SECRET ?? '';
export const engineAvailable = process.env.E2E_EDGE_FUNCTIONS === '1' && !!MOCK_URL && !!CRON_SECRET;
export const ENGINE_SKIP_REASON = 'moteur et faux prestataires absents (lancer e2e/local-stack/up.sh)';

export const rand = () => Math.random().toString(36).slice(2, 10);
export const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

// ─── Faux prestataire ───────────────────────────────────────────────────────

export interface MockCall {
  at: string;
  host: string | null;
  method: string;
  path: string;
  query: Record<string, string>;
  account_id: string | null;
  body: Record<string, unknown> | string;
  scripted?: boolean;
}

/** Appels reçus par le faux prestataire pour un compte LinkedIn (tous les comptes sans argument). */
export async function mockCalls(accountId?: string): Promise<MockCall[]> {
  const q = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
  const res = await fetch(`${MOCK_URL}/__log${q}`);
  return (await res.json()) as MockCall[];
}

/** Messages LinkedIn réellement envoyés depuis ce compte (nouvelle conversation ou suite). */
export async function sentTexts(accountId: string): Promise<string[]> {
  return (await mockCalls(accountId))
    .filter((c) => c.method === 'POST' && (c.path === '/api/v1/chats' || /^\/api\/v1\/chats\/[^/]+\/messages$/.test(c.path)))
    .map((c) => String((c.body as Record<string, unknown>).text ?? ''));
}

/** Invitations LinkedIn envoyées depuis ce compte. */
export async function sentInvites(accountId: string): Promise<MockCall[]> {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST' && c.path === '/api/v1/users/invite');
}

export interface MockRoute {
  method?: string;
  /** Expression régulière appliquée au chemin, ex. '^/api/v1/chats$'. */
  path?: string;
  /** À la place de `path` : expression sur le chemin suivi de la chaîne de requête. */
  url?: string;
  status?: number;
  body?: unknown;
  delay_ms?: number;
  times?: number;
}

/**
 * Comportement du faux prestataire pour un compte : `routes` scriptées, ou
 * raccourcis `fail_send` (statut), `distance` ('SECOND_DEGREE'…), `ai_text`,
 * `candidate_provider_id`. La clé '*' vaut pour tous les comptes : à éviter,
 * d'autres tests tournent sur la même stack.
 */
export async function setMockMode(accountId: string, mode: { routes?: MockRoute[]; [k: string]: unknown }) {
  await fetch(`${MOCK_URL}/__mode`, { method: 'POST', body: JSON.stringify({ [accountId]: mode }) });
}

// ─── Appels aux fonctions ───────────────────────────────────────────────────

export async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${E2E.supabaseUrl}${path}`, {
    headers: { apikey: E2E.anonKey, 'Content-Type': 'application/json', ...headers },
    data: body,
  });
  const status = res.status();
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  await ctx.dispose();
  return { status, body: json };
}

/** Appel d'une edge function avec un JWT utilisateur (ou une autre clé). */
export function callFunction(name: string, token: string, body: Record<string, unknown>) {
  return postJson(`/functions/v1/${name}`, body, { Authorization: `Bearer ${token}` });
}

/** Action du moteur avec le secret du cron. Réessaie tant qu'un autre cycle tient le verrou. */
export async function runEngine(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await postJson('/functions/v1/process-sequences', body, { Authorization: `Bearer ${CRON_SECRET}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    if (res.body.skipped_reason !== 'lock_held') return res.body;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('verrou du moteur jamais libéré');
}

/**
 * Un cycle `process`, comme le cron. `force: true` lève la fenêtre d'envoi
 * (jours ouvrés 8 h-19 h) pour que le test passe aussi le soir et le week-end.
 */
export function runCycle(opts: { force?: boolean } = {}) {
  return runEngine({ action: 'process', force: opts.force ?? true });
}

export async function webhook(payload: Record<string, unknown>) {
  const res = await postJson('/functions/v1/unipile-webhook', payload, { 'unipile-auth': WEBHOOK_SECRET });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

// ─── Seeds ──────────────────────────────────────────────────────────────────

/** Abonnement actif sur un plan payant, qui autorise l'envoi. */
export async function setPaidPlan(orgId: string, planId = 'cabinet') {
  const { error } = await admin()
    .from('organization_subscriptions')
    .upsert({ organization_id: orgId, plan_id: planId, status: 'active' }, { onConflict: 'organization_id' });
  if (error) throw new Error(`organization_subscriptions: ${error.message}`);
}

/** Organisation qui a le droit d'envoyer : offre payante active et compte LinkedIn relié au propriétaire. */
export async function sendingOrg(prefix: string): Promise<{ org: TestOrg; accountId: string }> {
  const org = await createOrg('agency', prefix);
  await setPaidPlan(org.orgId);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_${rand()}`, 'OK');
  return { org, accountId };
}

/** Séquence de messages : un modèle par étape, délai `delayDays` entre étapes. */
export async function messageSequence(org: TestOrg, createdBy: string, templates: string[], delayDays = 3) {
  const seeded = await seedSequence(org.orgId, createdBy, templates.map((_, i) => ({
    action_type: 'message', delay_days: i === 0 ? 0 : delayDays,
  })));
  for (const [i, step] of seeded.steps.entries()) {
    await admin().from('sequence_steps').update({ message_template: templates[i] }).eq('id', step.id);
  }
  return seeded;
}

/** Inscription active, profil LinkedIn unique au format ACo…, fuseau de Paris. */
export async function enroll(
  org: TestOrg,
  sequenceId: string,
  createdBy: string,
  accountId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ enrollmentId: string; profileId: string }> {
  const profileId = (overrides.profile_id as string | undefined) ?? `ACoAAE2E${rand()}${rand()}`;
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .insert({
      sequence_id: sequenceId,
      organization_id: org.orgId,
      created_by: createdBy,
      profile_id: profileId,
      profile_name: 'Camille Martin',
      account_id: accountId,
      status: 'active',
      current_step_order: 0,
      user_timezone: 'Europe/Paris',
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`enroll: ${error?.message}`);
  return { enrollmentId: data.id as string, profileId };
}

/** Exécution d'étape, due par défaut (il y a une minute). À insérer en dernier : un cycle concurrent la prendrait. */
export async function schedule(
  org: TestOrg,
  enrollmentId: string,
  step: SeededStep,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .insert({
      enrollment_id: enrollmentId,
      organization_id: org.orgId,
      step_id: step.id,
      step_order: step.step_order,
      status: 'scheduled',
      scheduled_at: minutesFromNow(-1),
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`schedule: ${error?.message}`);
  return data.id as string;
}

export interface ExecutionRow {
  id: string;
  step_order: number;
  status: string;
  scheduled_at: string;
  final_message: string | null;
  skip_reason: string | null;
  error_message: string | null;
  retry_count: number | null;
}

export async function executionsOf(enrollmentId: string): Promise<ExecutionRow[]> {
  const { data } = await admin()
    .from('sequence_step_executions')
    .select('id, step_order, status, scheduled_at, final_message, skip_reason, error_message, retry_count')
    .eq('enrollment_id', enrollmentId)
    .order('step_order');
  return (data ?? []) as ExecutionRow[];
}

export async function enrollmentRow(id: string) {
  const { data } = await admin()
    .from('sequence_enrollments')
    .select('status, pause_reason, current_step_order, tracking_data, connection_status')
    .eq('id', id)
    .single();
  return data as {
    status: string;
    pause_reason: string | null;
    current_step_order: number;
    tracking_data: Record<string, unknown> | null;
    connection_status: string | null;
  };
}

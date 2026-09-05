/**
 * Moteur de séquences — actions manuelles de l'UI (process-sequences).
 *
 * Couvre les correctifs du lot « moteur de séquences » (audit 2026-09-01) :
 *   - BUG-007 / MQ-002 : `skip_execution` saute l'étape ET fait avancer la
 *     séquence, pour un membre d'organisation (avant : 401 pour tous les
 *     clients, et l'étape sautée repartait une heure plus tard).
 *   - SEC-041 : `nudge_sequences` ne touche que les données de l'organisation
 *     appelante ; `process` et `force_reschedule`, qui balaient tous les
 *     tenants, restent réservés au cron.
 *
 * Ces tests appellent l'edge function déployée. Ils sont donc ignorés tant que
 * `E2E_EDGE_FUNCTIONS=1` n'est pas positionné (la stack locale `supabase start`
 * du CI ne sert que DB + Auth + REST).
 *
 * @critical
 */
import { test, expect, request } from '@playwright/test';
import { E2E } from '../helpers/env';
import {
  admin,
  createOrg,
  deleteOrg,
  seedEnrollment,
  seedExecution,
  seedSequence,
  signIn,
  type SeededStep,
  type TestOrg,
} from '../helpers/supabase-admin';

const EDGE_DEPLOYED = process.env.E2E_EDGE_FUNCTIONS === '1';

test.skip(!EDGE_DEPLOYED, 'process-sequences non déployée sur cet environnement (E2E_EDGE_FUNCTIONS=1 pour activer)');

interface OrgCtx {
  org: TestOrg;
  token: string;
  sequenceId: string;
  steps: SeededStep[];
  enrollmentId: string;
  executionId: string;
}

/** Org + séquence 3 étapes + enrollment positionné sur l'étape 0, exécution planifiée dans 2 h. */
async function setupOrg(namePrefix: string): Promise<OrgCtx> {
  const org = await createOrg('agency', namePrefix);
  const token = (await signIn(org.owner.email, org.owner.password)).access_token;
  const { sequenceId, steps } = await seedSequence(org.orgId, org.owner.userId, [
    { action_type: 'message' },
    { action_type: 'message' },
    { action_type: 'message' },
  ]);
  const enrollmentId = await seedEnrollment(org.orgId, sequenceId, org.owner.userId);
  const executionId = await seedExecution(org.orgId, enrollmentId, steps[0]);
  return { org, token, sequenceId, steps, enrollmentId, executionId };
}

/** POST /functions/v1/process-sequences avec un JWT utilisateur. */
async function callEngine(token: string, body: Record<string, unknown>) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${E2E.supabaseUrl}/functions/v1/process-sequences`, {
    headers: {
      apikey: E2E.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: body,
  });
  const status = res.status();
  const json = await res.json().catch(() => ({}));
  await ctx.dispose();
  return { status, body: json as Record<string, unknown> };
}

async function executionRow(id: string) {
  const { data } = await admin()
    .from('sequence_step_executions')
    .select('id, status, step_order, scheduled_at, skip_reason')
    .eq('id', id)
    .single();
  return data as { status: string; step_order: number; scheduled_at: string; skip_reason: string | null };
}

let a: OrgCtx;
let b: OrgCtx;

test.beforeEach(async () => {
  a = await setupOrg('E2E Engine A');
  b = await setupOrg('E2E Engine B');
});

test.afterEach(async () => {
  await deleteOrg(a.org);
  await deleteOrg(b.org);
});

test.describe('@critical process-sequences — skip_execution', () => {
  test("un membre saute une étape et la séquence avance (BUG-007)", async () => {
    const res = await callEngine(a.token, { action: 'skip_execution', execution_id: a.executionId });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);

    const exec = await executionRow(a.executionId);
    expect(exec.status, 'étape marquée sautée').toBe('skipped');
    expect(exec.skip_reason).toContain('recruteur');

    const { data: enrollment } = await admin()
      .from('sequence_enrollments')
      .select('current_step_order')
      .eq('id', a.enrollmentId)
      .single();
    expect(enrollment?.current_step_order, 'position avancée après le saut').toBe(a.steps[0].step_order + 1);

    // Une exécution existe pour l'étape suivante : sans elle, le janitor
    // re-planifiait l'étape sautée une heure plus tard.
    const { data: nextExecs } = await admin()
      .from('sequence_step_executions')
      .select('id, step_id, status')
      .eq('enrollment_id', a.enrollmentId)
      .eq('step_id', a.steps[1].id);
    expect(nextExecs?.length, 'étape suivante planifiée').toBeGreaterThan(0);
  });

  test("un membre d'une autre organisation ne peut pas sauter l'étape", async () => {
    const res = await callEngine(b.token, { action: 'skip_execution', execution_id: a.executionId });

    expect(res.status).toBe(403);
    const exec = await executionRow(a.executionId);
    expect(exec.status, 'étape inchangée').toBe('scheduled');
  });

  test('sauter deux fois la même étape est refusé la seconde fois', async () => {
    const first = await callEngine(a.token, { action: 'skip_execution', execution_id: a.executionId });
    expect(first.status).toBe(200);

    const second = await callEngine(a.token, { action: 'skip_execution', execution_id: a.executionId });
    expect(second.status, 'transition conditionnée au statut relu').toBe(409);
  });
});

test.describe('@critical process-sequences — nudge_sequences', () => {
  test("avance les actions de mon organisation et laisse celles des autres (SEC-041)", async () => {
    const before = await executionRow(b.executionId);

    const res = await callEngine(a.token, {
      action: 'nudge_sequences',
      organization_id: a.org.orgId,
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.rescheduled, 'mon exécution future avancée').toBe(1);

    const mine = await executionRow(a.executionId);
    expect(new Date(mine.scheduled_at).getTime(), 'avancée à maintenant').toBeLessThanOrEqual(Date.now() + 5_000);

    const other = await executionRow(b.executionId);
    expect(other.scheduled_at, "l'autre organisation n'est pas touchée").toBe(before.scheduled_at);
  });

  test("les invitations LinkedIn ne sont jamais avancées (quota hebdomadaire)", async () => {
    const { sequenceId, steps } = await seedSequence(a.org.orgId, a.org.owner.userId, [
      { action_type: 'connection_request' },
    ]);
    const enrollmentId = await seedEnrollment(a.org.orgId, sequenceId, a.org.owner.userId);
    const inviteExecId = await seedExecution(a.org.orgId, enrollmentId, steps[0]);
    const before = await executionRow(inviteExecId);

    await callEngine(a.token, { action: 'nudge_sequences', organization_id: a.org.orgId });

    const after = await executionRow(inviteExecId);
    expect(after.scheduled_at, 'invitation laissée à sa date').toBe(before.scheduled_at);
  });

  test("sans organisation demandée, seule l'organisation active est touchée", async () => {
    const res = await callEngine(a.token, { action: 'nudge_sequences' });
    expect(res.status).toBe(200);

    const other = await executionRow(b.executionId);
    expect(new Date(other.scheduled_at).getTime(), 'org B intacte').toBeGreaterThan(Date.now() + 60_000);
  });
});

test.describe('@critical process-sequences — actions réservées au cron', () => {
  for (const action of ['process', 'force_reschedule', 'check_replies', 'check_wait_events'] as const) {
    test(`${action} est refusée à un JWT de membre`, async () => {
      const res = await callEngine(a.token, { action, force: true });
      expect(res.status, `${action} doit rester interne`).toBe(401);
    });
  }
});

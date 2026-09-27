/**
 * Lot « actions-2 » du module séquences : reprises et relances côté serveur
 * (process-sequences : resume_enrollments, re_enroll, mark_replied), outils de
 * l'assistant (resume_sequence, enroll_in_sequence, approbation par
 * agent-tool-action), liaison des comptes LinkedIn (unipile-accounts :
 * claim, unlink, stop_member_linkedin ; unipile-webhook : nouvelle connexion
 * hosted_auth) et file des InMails (process-inmail-queue).
 *
 * Contrat : CLAUDE.md, « Séquences : règles du moteur et de l'interface », et
 * docs/audit-2026-09-25-sequences.md (D1 à D6, tableau des décisions).
 *
 * Harnais :
 * - assistant : ligne agent_tool_executions « proposed » insérée en clé de
 *   service, puis POST agent-tool-action { approve } avec le JWT du membre,
 *   comme le bouton « Approuver » (même méthode que seq-assistant.spec.ts) ;
 * - échec d'écriture simulé : déclencheur temporaire posé par psql, limité aux
 *   lignes de l'organisation du test, retiré en fin de test ;
 * - updated_at reculé : psql en supabase_admin avec
 *   session_replication_role = replica (le déclencheur updated_at le remet
 *   sinon à maintenant).
 *
 * Dimanche : le moteur tourne avec force: true. process-inmail-queue n'a pas
 * de forçage : le membre reçoit une plage 0 h-24 h dans un fuseau où l'on est
 * un jour ouvré (même méthode que seq-assistant.spec.ts).
 *
 * Ignoré sans la stack locale (e2e/local-stack/up.sh).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test, expect, request } from '@playwright/test';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedLinkedInAccount,
  seedMission,
  signIn,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  CRON_SECRET,
  ENGINE_SKIP_REASON,
  callFunction,
  engineAvailable,
  enroll,
  enrollmentRow,
  executionsOf,
  messageSequence,
  minutesFromNow,
  mockCalls,
  postJson,
  rand,
  runCycle,
  schedule,
  sendingOrg,
  sentTexts,
  setMockMode,
  setPaidPlan,
  webhook,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => unknown> = [];

test.afterEach(async () => {
  while (cleanups.length) {
    try {
      await cleanups.pop()!();
    } catch {
      // best-effort
    }
  }
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    for (const table of [
      'agent_tool_executions',
      'job_candidate_status',
      'inmail_queue',
      'notifications',
      'member_quotas',
      'organization_subscriptions',
      'organization_integrations',
    ]) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});

function track(org: TestOrg, ...extra: TestUser[]) {
  orgsToDelete.push({ org, extra });
}

// ─── Aides ──────────────────────────────────────────────────────────────────

const DAY = 24 * 60;
const PENDING = ['scheduled', 'waiting_event', 'quota_blocked', 'sending'];
const newProfileId = () => `ACoAAE2EA2${rand()}${rand()}`;

async function tokenOf(user: TestUser): Promise<string> {
  return (await signIn(user.email, user.password)).access_token;
}

/** psql sur la base locale (postgres, ou supabase_admin pour les réglages réservés au superutilisateur). */
function psql(sql: string, user: 'postgres' | 'supabase_admin' = 'postgres'): string {
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-p', '54322', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql],
    { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' },
  );
}

/**
 * Déclencheur temporaire qui fait échouer toute écriture `event` sur `table`
 * pour les lignes de cette organisation (les autres suites ne sont pas touchées).
 * Retiré par la fonction renvoyée, et en fin de test dans tous les cas.
 */
function failingTrigger(table: string, event: 'INSERT' | 'UPDATE', orgId: string): () => void {
  const name = `e2e_a2_fail_${rand()}`;
  psql(
    `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'échec simulé (e2e)'; END $f$;` +
    `CREATE TRIGGER ${name} BEFORE ${event} ON public.${table} FOR EACH ROW ` +
    `WHEN (NEW.organization_id = '${orgId}'::uuid) EXECUTE FUNCTION public.${name}();`,
  );
  let dropped = false;
  const drop = () => {
    if (dropped) return;
    dropped = true;
    psql(`DROP TRIGGER IF EXISTS ${name} ON public.${table}; DROP FUNCTION IF EXISTS public.${name}();`);
  };
  cleanups.push(drop);
  return drop;
}

/** Recule updated_at sans passer par le déclencheur qui le remet à maintenant. */
function backdateUpdatedAt(table: string, id: string, interval: string) {
  psql(
    `SET session_replication_role = replica; UPDATE public.${table} SET updated_at = now() - interval '${interval}' WHERE id = '${id}';`,
    'supabase_admin',
  );
}

function processSequences(token: string, body: Record<string, unknown>) {
  return callFunction('process-sequences', token, body);
}

function unipileAccounts(token: string, body: Record<string, unknown>) {
  return callFunction('unipile-accounts', token, body);
}

async function restPatch(path: string, token: string, body: unknown) {
  const ctx = await request.newContext();
  const res = await ctx.patch(`${E2E.supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: E2E.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    data: body,
  });
  const status = res.status();
  const json = await res.json().catch(() => null);
  await ctx.dispose();
  return { status, body: json as unknown };
}

async function pendingExecutions(enrollmentId: string) {
  return (await executionsOf(enrollmentId)).filter((e) => PENDING.includes(e.status));
}

async function enrollmentFull(id: string) {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('status, pause_reason, replied_at, completed_at, tracking_data, account_id, created_by, updated_at')
    .eq('id', id)
    .single();
  if (error) throw new Error(`enrollmentFull: ${error.message}`);
  return data as {
    status: string;
    pause_reason: string | null;
    replied_at: string | null;
    completed_at: string | null;
    tracking_data: Record<string, unknown> | null;
    account_id: string | null;
    created_by: string | null;
    updated_at: string;
  };
}

async function linkOf(orgId: string, userId: string) {
  const { data } = await admin()
    .from('member_linkedin_accounts')
    .select('id, linkedin_account_id, linked_at, account_status')
    .eq('organization_id', orgId)
    .eq('user_id', userId);
  return (data ?? []) as Array<{ id: string; linkedin_account_id: string; linked_at: string | null; account_status: string }>;
}

async function sequenceActive(sequenceId: string): Promise<boolean> {
  const { data } = await admin().from('outreach_sequences').select('is_active').eq('id', sequenceId).single();
  return data?.is_active as boolean;
}

/** InMail programmé depuis ce compte (dû par défaut il y a une minute). */
async function queueInMail(orgId: string, createdBy: string, accountId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin()
    .from('inmail_queue')
    .insert({
      organization_id: orgId,
      created_by: createdBy,
      account_id: accountId,
      recipient_profile_id: newProfileId(),
      recipient_name: 'Camille Martin',
      subject: 'Opportunité',
      message: 'Bonjour Camille, un poste pourrait vous intéresser.',
      status: 'scheduled',
      scheduled_at: minutesFromNow(-1),
      network_distance: 2,
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`queueInMail: ${error?.message}`);
  return data.id as string;
}

async function inmailStatus(id: string) {
  const { data } = await admin().from('inmail_queue').select('status, error_message, sent_at').eq('id', id).single();
  return data as { status: string; error_message: string | null; sent_at: string | null };
}

// ─── Assistant ──────────────────────────────────────────────────────────────

type ToolResponse = { success?: boolean; error?: string; data?: Record<string, any> };

/** Ligne « proposée » par l'assistant, telle que search-agent-chat l'écrit. */
async function propose(orgId: string, userId: string, tool: string, params: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin()
    .from('agent_tool_executions')
    .insert({
      user_id: userId,
      organization_id: orgId,
      tool_name: tool,
      params,
      status: 'proposed',
      dry_run_result: { summary: `Test e2e ${tool}`, details: {} },
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`propose: ${error?.message}`);
  return data.id as string;
}

/** Clic « Approuver » du bandeau. */
async function approve(token: string, executionId: string) {
  const res = await callFunction('agent-tool-action', token, { execution_id: executionId, action: 'approve' });
  return { status: res.status, body: res.body as ToolResponse };
}

async function execRow(id: string) {
  const { data } = await admin()
    .from('agent_tool_executions')
    .select('status, real_result, executed_at')
    .eq('id', id)
    .single();
  return data as { status: string; real_result: ToolResponse | null; executed_at: string | null };
}

async function enrollmentsOfCandidate(orgId: string, candidateId: string) {
  const { data } = await admin()
    .from('sequence_enrollments')
    .select('id, sequence_id, account_id, created_by, status')
    .eq('organization_id', orgId)
    .eq('provider_id', candidateId);
  return (data ?? []) as Array<{ id: string; sequence_id: string; account_id: string | null; created_by: string; status: string }>;
}

/** Séquence de messages rattachée à une mission (project_id). */
async function missionSequence(org: TestOrg, createdBy: string, missionId: string | null, templates = ['Bonjour', 'Relance']) {
  const seeded = await messageSequence(org, createdBy, templates);
  if (missionId) await admin().from('outreach_sequences').update({ project_id: missionId }).eq('id', seeded.sequenceId);
  return seeded;
}

function linkedinUrlHash(url: string): string {
  const normalized = url.toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '').trim();
  return createHash('sha256').update(normalized).digest('hex');
}

async function eraseLinkedInUrl(url: string) {
  const { data, error } = await admin()
    .from('gdpr_erasures')
    .insert({ linkedin_url_hash: linkedinUrlHash(url), reason: 'user_request', source: 'e2e-seq-actions-2' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`gdpr_erasures: ${error?.message}`);
  cleanups.push(() => admin().from('gdpr_erasures').delete().eq('id', data.id));
}

// Fuseau où l'on est un jour ouvré, loin de minuit (process-inmail-queue et
// les quotas LinkedIn refusent le week-end sans forçage possible).
const WEEKDAY_ZONES = [
  'Europe/Paris', 'Pacific/Kiritimati', 'Pacific/Apia', 'Pacific/Auckland', 'Asia/Tokyo',
  'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Pacific/Pago_Pago',
];
function weekdayZone(): string | null {
  for (const tz of WEEKDAY_ZONES) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date());
    const weekday = parts.find((p) => p.type === 'weekday')?.value;
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    if (weekday !== 'Sat' && weekday !== 'Sun' && hour >= 1 && hour <= 22) return tz;
  }
  return null;
}
const SEND_ZONE = weekdayZone();

async function openBusinessHours(orgId: string, userId: string) {
  const { error } = await admin().from('member_quotas').upsert(
    { organization_id: orgId, user_id: userId, business_hours_start: 0, business_hours_end: 24, timezone: SEND_ZONE },
    { onConflict: 'organization_id,user_id' },
  );
  if (error) throw new Error(`member_quotas: ${error.message}`);
}

// ════════════════════════════════════════════════════════════════════════════
// Reprises et relances côté serveur (process-sequences)
// ════════════════════════════════════════════════════════════════════════════

test.describe('Reprises et relances serveur', () => {
  // resume-concurrence
  test('deux « Reprendre » simultanés du même candidat : une seule reprise, une seule étape en attente', async () => {
    const { org, accountId } = await sendingOrg('E2E A2 Concurrence');
    track(org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const token = await tokenOf(org.owner);

    // Trois essais : la course n'est pas garantie à chaque fois, le résultat
    // attendu est le même dans tous les ordres d'arrivée.
    for (let round = 0; round < 3; round++) {
      const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, {
        status: 'paused', pause_reason: 'manual', current_step_order: 1,
      });
      await schedule(org, enrollmentId, steps[0], {
        status: 'sent', scheduled_at: minutesFromNow(-2 * DAY), executed_at: minutesFromNow(-2 * DAY),
      });

      const [a, b] = await Promise.all([
        processSequences(token, { action: 'resume_enrollments', enrollment_ids: [enrollmentId] }),
        processSequences(token, { action: 'resume_enrollments', enrollment_ids: [enrollmentId] }),
      ]);
      expect(a.status, JSON.stringify(a.body)).toBe(200);
      expect(b.status, JSON.stringify(b.body)).toBe(200);
      const outcomes = [a, b].map((r) => (r.body.results as Array<{ outcome: string; message?: string }>)[0]);
      expect(outcomes.filter((o) => o.outcome === 'resumed'), `essai ${round} : ${JSON.stringify(outcomes)}`).toHaveLength(1);
      const loser = outcomes.find((o) => o.outcome !== 'resumed')!;
      expect(
        loser.outcome === 'not_paused' || (loser.outcome === 'error' && /statut de ce candidat a changé/.test(loser.message ?? '')),
        `second appel : not_paused ou « statut a changé », reçu ${JSON.stringify(loser)}`,
      ).toBe(true);

      expect((await enrollmentRow(enrollmentId)).status).toBe('active');
      const pending = await pendingExecutions(enrollmentId);
      expect(pending, 'une seule exécution en attente').toHaveLength(1);
      expect(pending[0].step_order).toBe(1);
      expect((await executionsOf(enrollmentId)).filter((e) => e.step_order === 0), 'l’étape partie n’est pas recréée').toHaveLength(1);
    }
  });

  // resume-sequence-collaborateur-other-members (partie API ; l'interface est dans e2e/flows/seq-actions-2.spec.ts)
  test('reprise par séquence par un collaborateur : ses seuls candidats reprennent, other_members compte ceux des collègues', async () => {
    const { org, accountId: ownerAccount } = await sendingOrg('E2E A2 Reprise collaborateur');
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    track(org, collab);
    const collabAccount = await seedLinkedInAccount(org.orgId, collab.userId, `acc_a2_${rand()}`, 'OK');
    const { sequenceId, steps } = await messageSequence(org, collab.userId, ['Bonjour', 'Relance']);

    const mine: string[] = [];
    const theirs: string[] = [];
    for (let i = 0; i < 2; i++) {
      mine.push((await enroll(org, sequenceId, collab.userId, collabAccount, { status: 'paused', pause_reason: 'sequence_inactive' })).enrollmentId);
    }
    for (let i = 0; i < 3; i++) {
      theirs.push((await enroll(org, sequenceId, org.owner.userId, ownerAccount, { status: 'paused', pause_reason: 'sequence_inactive' })).enrollmentId);
    }
    for (const id of [...mine, ...theirs]) await schedule(org, id, steps[0], { scheduled_at: minutesFromNow(DAY) });
    // L'interface réactive la séquence avant d'appeler la reprise.
    await admin().from('outreach_sequences').update({ is_active: true }).eq('id', sequenceId);

    const res = await processSequences(await tokenOf(collab), {
      action: 'resume_enrollments', sequence_id: sequenceId, pause_reasons: ['sequence_inactive', 'auto_paused'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.counts as Record<string, number>).resumed).toBe(2);
    expect(res.body.other_members, 'candidats des collègues laissés en pause').toBe(3);
    expect(res.body.remaining).toBe(0);

    for (const id of mine) expect(await enrollmentRow(id)).toMatchObject({ status: 'active', pause_reason: null });
    for (const id of theirs) expect(await enrollmentRow(id)).toMatchObject({ status: 'paused', pause_reason: 'sequence_inactive' });
  });

  // re-enroll-inscription-close
  test('« Relancer » un candidat qui a répondu : actif, date de réponse gardée, étape suivante planifiée, rien de renvoyé', async () => {
    const { org, accountId } = await sendingOrg('E2E A2 Relancer');
    track(org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, enrollmentId, steps[0], {
      status: 'sent', scheduled_at: minutesFromNow(-2 * DAY), executed_at: minutesFromNow(-2 * DAY),
    });
    const followUp = await schedule(org, enrollmentId, steps[1], { scheduled_at: minutesFromNow(DAY) });
    const token = await tokenOf(org.owner);

    // Réponse marquée par le recruteur : clôture serveur, relance annulée.
    const marked = await processSequences(token, { action: 'mark_replied', enrollment_id: enrollmentId });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    const replied = await enrollmentFull(enrollmentId);
    expect(replied.status).toBe('replied');
    expect(replied.replied_at).toBeTruthy();
    expect((await executionsOf(enrollmentId)).find((e) => e.id === followUp)?.status).toBe('cancelled');
    const t0 = replied.replied_at!;

    const before = Date.now();
    const res = await processSequences(token, { action: 're_enroll', enrollment_ids: [enrollmentId] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.results as Array<{ outcome: string }>)[0].outcome).toBe('resumed');

    const row = await enrollmentFull(enrollmentId);
    expect(row.status).toBe('active');
    expect(row.replied_at, 'replied_at vidé').toBeNull();
    expect(row.completed_at).toBeNull();
    expect(new Date(String(row.tracking_data?.previous_replied_at)).getTime(), 'date de réponse gardée').toBe(new Date(t0).getTime());
    const reEnrolledAt = new Date(String(row.tracking_data?.re_enrolled_at)).getTime();
    expect(reEnrolledAt).toBeGreaterThanOrEqual(before - 5_000);
    expect(reEnrolledAt).toBeLessThanOrEqual(Date.now() + 5_000);

    const pending = await pendingExecutions(enrollmentId);
    expect(pending, 'une étape en attente').toHaveLength(1);
    expect(pending[0].step_order, 'l’étape suivante, jamais le premier message').toBe(1);
    expect((await executionsOf(enrollmentId)).filter((e) => e.step_order === 0)).toHaveLength(1);

    // L'étape planifiée part quand elle est due ; le premier message ne repart pas.
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', pending[0].id);
    await runCycle();
    expect(await sentTexts(accountId), 'seule la relance part').toEqual(['Relance']);
  });

  // re-enroll-inscription-close (autres statuts clos)
  test('« Relancer » une inscription terminée, arrêtée ou annulée : active, étape suivante planifiée sans rejouer l’étape partie', async () => {
    const { org, accountId } = await sendingOrg('E2E A2 Relancer clos');
    track(org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const token = await tokenOf(org.owner);

    for (const status of ['completed', 'stopped', 'cancelled']) {
      const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, {
        status, current_step_order: 1, completed_at: status === 'completed' ? minutesFromNow(-60) : null,
      });
      await schedule(org, enrollmentId, steps[0], {
        status: 'sent', scheduled_at: minutesFromNow(-2 * DAY), executed_at: minutesFromNow(-2 * DAY),
      });
      await schedule(org, enrollmentId, steps[1], {
        status: 'cancelled', skip_reason: 'Clôture e2e', scheduled_at: minutesFromNow(DAY),
      });

      const res = await processSequences(token, { action: 're_enroll', enrollment_ids: [enrollmentId] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((res.body.results as Array<{ outcome: string }>)[0].outcome, status).toBe('resumed');
      const row = await enrollmentFull(enrollmentId);
      expect(row.status, status).toBe('active');
      expect(row.completed_at, status).toBeNull();
      expect(row.tracking_data?.re_enrolled_at, status).toBeTruthy();
      const pending = await pendingExecutions(enrollmentId);
      expect(pending, status).toHaveLength(1);
      expect(pending[0].step_order, status).toBe(1);
      expect((await executionsOf(enrollmentId)).filter((e) => e.step_order === 0), status).toHaveLength(1);
    }
  });

  // mark-replied-droits
  test('« Marquer comme répondu » refusé hors organisation (404), sur le candidat d’un collègue pour un collaborateur (403), identifiant mal formé (404) ou absent (400), sans écriture', async () => {
    const { org, accountId } = await sendingOrg('E2E A2 Marquer répondu');
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    track(org, collab);
    const other = await createOrg('agency', 'E2E A2 Marquer répondu autre');
    track(other);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, enrollmentId, steps[0], {
      status: 'sent', scheduled_at: minutesFromNow(-2 * DAY), executed_at: minutesFromNow(-2 * DAY),
    });
    const followUp = await schedule(org, enrollmentId, steps[1], { scheduled_at: minutesFromNow(DAY) });
    const { error: jcsErr } = await admin().from('job_candidate_status').insert({
      organization_id: org.orgId, created_by: org.owner.userId, candidate_id: profileId,
      candidate_name: 'Camille Martin', job_id: `job_${rand()}`, status: 'contacted', pipeline_stage: 'Contacté',
    });
    if (jcsErr) throw new Error(`job_candidate_status: ${jcsErr.message}`);

    const ownerToken = await tokenOf(org.owner);
    const otherToken = await tokenOf(other.owner);
    const collabToken = await tokenOf(collab);

    const foreign = await processSequences(otherToken, { action: 'mark_replied', enrollment_id: enrollmentId });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(404);
    expect(foreign.body.error).toBe('not_found');

    const foreignOrg = await processSequences(otherToken, { action: 'mark_replied', enrollment_id: enrollmentId, organization_id: org.orgId });
    expect(foreignOrg.status, 'organisation demandée qui n’est pas la sienne').toBe(403);

    const colleague = await processSequences(collabToken, { action: 'mark_replied', enrollment_id: enrollmentId });
    expect(colleague.status, JSON.stringify(colleague.body)).toBe(403);
    expect(colleague.body.error).toBe('forbidden');
    expect(String(colleague.body.message)).toMatch(/^Vous ne pouvez agir que sur les candidats que vous avez inscrits/);

    const malformed = await processSequences(ownerToken, { action: 'mark_replied', enrollment_id: 'x' });
    expect(malformed.status, JSON.stringify(malformed.body)).toBe(404);

    const missing = await processSequences(ownerToken, { action: 'mark_replied' });
    expect(missing.status, JSON.stringify(missing.body)).toBe(400);
    expect(missing.body.error).toBe('invalid_request');

    // Aucune écriture.
    expect((await enrollmentFull(enrollmentId))).toMatchObject({ status: 'active', replied_at: null });
    expect((await executionsOf(enrollmentId)).find((e) => e.id === followUp)?.status).toBe('scheduled');
    const { data: jcs } = await admin().from('job_candidate_status').select('status').eq('organization_id', org.orgId).eq('candidate_id', profileId);
    expect(jcs?.[0]?.status, 'pipeline inchangé').toBe('contacted');

    // Contrôle positif : le propriétaire marque la réponse.
    const ok = await processSequences(ownerToken, { action: 'mark_replied', enrollment_id: enrollmentId });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.changed).toBe(true);
    expect((await enrollmentFull(enrollmentId)).status).toBe('replied');
  });

});

// ════════════════════════════════════════════════════════════════════════════
// Assistant : resume_sequence, enroll_in_sequence, approbation
// ════════════════════════════════════════════════════════════════════════════

test.describe('Assistant : réactivation de séquence', () => {
  // assistant-resume-sequence
  test('propriétaire : la séquence est réactivée, les pauses de séquence reprennent, la pause manuelle reste', async () => {
    const { org, accountId } = await sendingOrg('E2E A2 resume_sequence');
    track(org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', sequenceId);
    const bySequence = await enroll(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'sequence_inactive' });
    const manual = await enroll(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'manual' });
    const plannedAt = minutesFromNow(DAY);
    await schedule(org, bySequence.enrollmentId, steps[0], { scheduled_at: plannedAt });
    await schedule(org, manual.enrollmentId, steps[0], { scheduled_at: plannedAt });

    const id = await propose(org.orgId, org.owner.userId, 'resume_sequence', { sequence_id: sequenceId });
    const res = await approve(await tokenOf(org.owner), id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data?.counts?.resumed).toBe(1);

    expect(await sequenceActive(sequenceId)).toBe(true);
    expect(await enrollmentRow(bySequence.enrollmentId)).toMatchObject({ status: 'active', pause_reason: null });
    expect(await enrollmentRow(manual.enrollmentId), 'pause manuelle intacte').toMatchObject({ status: 'paused', pause_reason: 'manual' });
    const pending = await pendingExecutions(bySequence.enrollmentId);
    expect(pending).toHaveLength(1);
    expect(new Date(pending[0].scheduled_at).getTime(), 'l’étape garde sa date').toBe(new Date(plannedAt).getTime());
    expect((await execRow(id)).status).toBe('executed');
  });

  // assistant-resume-sequence
  test('refusé sans offre d’envoi et à un collaborateur non auteur : séquence et pauses inchangées', async () => {
    const { org, accountId } = await sendingOrg('E2E A2 resume_sequence refus');
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    track(org, collab);
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', sequenceId);
    const paused = await enroll(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'sequence_inactive' });

    // Collaborateur qui n'est pas l'auteur de la séquence.
    const byCollab = await propose(org.orgId, collab.userId, 'resume_sequence', { sequence_id: sequenceId });
    const refusedCollab = await approve(await tokenOf(collab), byCollab);
    expect(refusedCollab.body.success, JSON.stringify(refusedCollab.body)).toBe(false);
    expect(refusedCollab.body.error).toMatch(/que les séquences que vous avez créées/);

    // Offre sans envoi de séquences.
    await setPaidPlan(org.orgId, 'free');
    const byOwner = await propose(org.orgId, org.owner.userId, 'resume_sequence', { sequence_id: sequenceId });
    const refusedPlan = await approve(await tokenOf(org.owner), byOwner);
    expect(refusedPlan.body.success, JSON.stringify(refusedPlan.body)).toBe(false);
    expect(refusedPlan.body.error).toMatch(/offre actuelle ne permet pas l'envoi de séquences/);

    expect(await sequenceActive(sequenceId), 'séquence toujours désactivée').toBe(false);
    expect(await enrollmentRow(paused.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'sequence_inactive' });
  });

  // assistant-resume-sequence
  test('collaborateur auteur : avec son JWT seuls ses candidats reprennent et le message cite les collègues ; sans JWT (exécution programmée) rien ne change', async () => {
    const { org, accountId: ownerAccount } = await sendingOrg('E2E A2 resume_sequence collab');
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    track(org, collab);
    const collabAccount = await seedLinkedInAccount(org.orgId, collab.userId, `acc_a2_${rand()}`, 'OK');
    const { sequenceId } = await messageSequence(org, collab.userId, ['Bonjour', 'Relance']);
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', sequenceId);
    const mine = await enroll(org, sequenceId, collab.userId, collabAccount, { status: 'paused', pause_reason: 'sequence_inactive' });
    const theirs = await enroll(org, sequenceId, org.owner.userId, ownerAccount, { status: 'paused', pause_reason: 'sequence_inactive' });

    // 1. Exécution programmée (process-scheduled-actions, sans JWT) : refus, rien ne change.
    const { data: scheduled, error } = await admin()
      .from('agent_tool_executions')
      .insert({
        user_id: collab.userId,
        organization_id: org.orgId,
        tool_name: 'resume_sequence',
        params: { sequence_id: sequenceId },
        status: 'approved',
        approved_at: new Date().toISOString(),
        scheduled_for: minutesFromNow(-1),
        dry_run_result: { summary: 'Test e2e resume_sequence programmé', details: {} },
      })
      .select('id')
      .single();
    if (error || !scheduled) throw new Error(`agent_tool_executions: ${error?.message}`);
    for (let attempt = 0; attempt < 8; attempt++) {
      const cron = await postJson('/functions/v1/process-scheduled-actions', {}, { Authorization: `Bearer ${CRON_SECRET}` });
      expect(cron.status, JSON.stringify(cron.body)).toBe(200);
      if ((await execRow(scheduled.id as string)).status !== 'approved') break;
    }
    const cronRow = await execRow(scheduled.id as string);
    expect(cronRow.status, JSON.stringify(cronRow.real_result)).toBe('failed');
    expect(String(cronRow.real_result?.error ?? '')).toMatch(/doit être validée depuis la conversation/);
    expect(await sequenceActive(sequenceId), 'séquence toujours désactivée').toBe(false);
    expect((await enrollmentRow(mine.enrollmentId)).status).toBe('paused');

    // 2. Approbation depuis la conversation (JWT du collaborateur).
    const id = await propose(org.orgId, collab.userId, 'resume_sequence', { sequence_id: sequenceId });
    const res = await approve(await tokenOf(collab), id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data?.counts?.resumed, 'ses seuls candidats').toBe(1);
    expect(String(res.body.data?.message)).toMatch(/1 inscrits par vos collègues restent en pause/);
    expect(await sequenceActive(sequenceId)).toBe(true);
    expect(await enrollmentRow(mine.enrollmentId)).toMatchObject({ status: 'active', pause_reason: null });
    expect(await enrollmentRow(theirs.enrollmentId), 'candidat du propriétaire laissé en pause').toMatchObject({ status: 'paused', pause_reason: 'sequence_inactive' });
  });
});

test.describe('Assistant : inscription', () => {
  // assistant-inscription-compte-premiere-etape
  test('inscrit depuis le compte relié et OK de l’appelant avec la première étape planifiée ; refuse le compte d’un collègue et un compte déconnecté', async () => {
    const { org, accountId: ownerAccount } = await sendingOrg('E2E A2 Inscription compte');
    const member = await addMember(org.orgId, 'member', 'membre');
    track(org, member);
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_a2_${rand()}`, 'OK');
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const { sequenceId, steps } = await missionSequence(org, org.owner.userId, missionId);
    const ownerToken = await tokenOf(org.owner);

    // 1. Sans account_id : le compte relié de l'appelant, première étape planifiée.
    const cand1 = newProfileId();
    const ok = await approve(ownerToken, await propose(org.orgId, org.owner.userId, 'enroll_in_sequence', {
      sequence_id: sequenceId, candidate_id: cand1, job_id: missionId, profile_name: 'Camille Martin',
    }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const rows1 = await enrollmentsOfCandidate(org.orgId, cand1);
    expect(rows1).toHaveLength(1);
    expect(rows1[0]).toMatchObject({ account_id: ownerAccount, created_by: org.owner.userId, status: 'active' });
    const execs = await executionsOf(rows1[0].id);
    expect(execs).toHaveLength(1);
    expect(execs[0]).toMatchObject({ status: 'scheduled', step_order: steps[0].step_order });
    expect(new Date(execs[0].scheduled_at).getTime(), 'planifiée tout de suite, au prochain créneau').toBeLessThan(Date.now() + 4 * DAY * 60_000);

    // 2. account_id d'un collègue : refus, aucune ligne.
    const cand2 = newProfileId();
    const colleague = await approve(ownerToken, await propose(org.orgId, org.owner.userId, 'enroll_in_sequence', {
      sequence_id: sequenceId, candidate_id: cand2, job_id: missionId, account_id: memberAccount,
    }));
    expect(colleague.body.success, JSON.stringify(colleague.body)).toBe(false);
    expect(colleague.body.error).toMatch(/n'est pas rattaché à votre profil/);
    expect(await enrollmentsOfCandidate(org.orgId, cand2)).toHaveLength(0);

    // 3. Compte de l'appelant déconnecté : refus, aucune ligne.
    await admin().from('member_linkedin_accounts').update({ account_status: 'CREDENTIALS' })
      .eq('organization_id', org.orgId).eq('linkedin_account_id', ownerAccount);
    const cand3 = newProfileId();
    const disconnected = await approve(ownerToken, await propose(org.orgId, org.owner.userId, 'enroll_in_sequence', {
      sequence_id: sequenceId, candidate_id: cand3, job_id: missionId,
    }));
    expect(disconnected.body.success, JSON.stringify(disconnected.body)).toBe(false);
    expect(disconnected.body.error).toMatch(/compte LinkedIn est déconnecté/);
    expect(await enrollmentsOfCandidate(org.orgId, cand3)).toHaveLength(0);
  });

  // assistant-inscription-compte-premiere-etape
  test('première étape impossible à planifier : l’inscription est retirée et l’échec annoncé', async () => {
    const { org } = await sendingOrg('E2E A2 Inscription sans étape');
    track(org);
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const { sequenceId } = await missionSequence(org, org.owner.userId, missionId);
    const ownerToken = await tokenOf(org.owner);
    const cand = newProfileId();
    const execId = await propose(org.orgId, org.owner.userId, 'enroll_in_sequence', {
      sequence_id: sequenceId, candidate_id: cand, job_id: missionId,
    });

    const drop = failingTrigger('sequence_step_executions', 'INSERT', org.orgId);
    const res = await approve(ownerToken, execId);
    drop();
    expect(res.body.success, JSON.stringify(res.body)).toBe(false);
    expect(res.body.error).toMatch(/La première étape n'a pas pu être planifiée : l'inscription est annulée/);
    expect(await enrollmentsOfCandidate(org.orgId, cand), 'aucune inscription restante').toHaveLength(0);
  });

  // assistant-inscription-collaborateur-equipe
  test('collaborateur : refusé dans la séquence d’une mission dont il n’est pas l’équipe, inscrit une fois ajouté à l’équipe ou dans sa propre séquence', async () => {
    const { org } = await sendingOrg('E2E A2 Inscription collaborateur');
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    track(org, collab);
    const collabAccount = await seedLinkedInAccount(org.orgId, collab.userId, `acc_a2_${rand()}`, 'OK');
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const { sequenceId } = await missionSequence(org, org.owner.userId, missionId);
    const token = await tokenOf(collab);

    const cand1 = newProfileId();
    const refused = await approve(token, await propose(org.orgId, collab.userId, 'enroll_in_sequence', {
      sequence_id: sequenceId, candidate_id: cand1, job_id: missionId,
    }));
    expect(refused.body.success, JSON.stringify(refused.body)).toBe(false);
    expect(refused.body.error).toMatch(/que dans vos propres séquences ou dans celles des missions dont vous faites partie de l'équipe/);
    expect(await enrollmentsOfCandidate(org.orgId, cand1)).toHaveLength(0);

    // Ajouté à l'équipe de la mission : l'inscription passe, depuis son compte.
    const { error: teamErr } = await admin().from('mission_team').insert({ project_id: missionId, user_id: collab.userId, role: 'sourcer' });
    if (teamErr) throw new Error(`mission_team: ${teamErr.message}`);
    const cand2 = newProfileId();
    const inTeam = await approve(token, await propose(org.orgId, collab.userId, 'enroll_in_sequence', {
      sequence_id: sequenceId, candidate_id: cand2, job_id: missionId,
    }));
    expect(inTeam.status, JSON.stringify(inTeam.body)).toBe(200);
    const rows = await enrollmentsOfCandidate(org.orgId, cand2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ created_by: collab.userId, account_id: collabAccount });

    // Sa propre séquence, hors mission.
    const own = await messageSequence(org, collab.userId, ['Bonjour']);
    const cand3 = newProfileId();
    const inOwn = await approve(token, await propose(org.orgId, collab.userId, 'enroll_in_sequence', {
      sequence_id: own.sequenceId, candidate_id: cand3, job_id: missionId,
    }));
    expect(inOwn.status, JSON.stringify(inOwn.body)).toBe(200);
    expect(await enrollmentsOfCandidate(org.orgId, cand3)).toHaveLength(1);
  });

  // assistant-inscription-anti-doublon-force
  test('anti-doublon : contacté par un collègue sous un autre identifiant refusé, force réservée aux propriétaires et administrateurs, admin avec force inscrit', async () => {
    const { org } = await sendingOrg('E2E A2 Anti-doublon');
    const member = await addMember(org.orgId, 'member', 'membre');
    const adminUser = await addMember(org.orgId, 'admin', 'admin');
    track(org, member, adminUser);
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_a2_${rand()}`, 'OK');
    await seedLinkedInAccount(org.orgId, adminUser.userId, `acc_a2_${rand()}`, 'OK');
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const target = await missionSequence(org, org.owner.userId, missionId);
    await admin().from('profiles').update({ display_name: 'Martine Collègue' }).eq('user_id', member.userId);

    // Le collègue a inscrit ce candidat ailleurs, sous l'identifiant Recruiter.
    const candidate = newProfileId();
    const memberSeq = await messageSequence(org, member.userId, ['Bonjour']);
    await enroll(org, memberSeq.sequenceId, member.userId, memberAccount, {
      profile_id: `AEMAAE2E${rand()}`, resolved_profile_id: candidate,
    });

    const params = { sequence_id: target.sequenceId, candidate_id: candidate, job_id: missionId, profile_name: 'Camille Martin' };
    const refused = await approve(await tokenOf(org.owner), await propose(org.orgId, org.owner.userId, 'enroll_in_sequence', params));
    expect(refused.body.success, JSON.stringify(refused.body)).toBe(false);
    expect(refused.body.error).toMatch(/Déjà contacté par Martine/);

    const memberForce = await approve(await tokenOf(member), await propose(org.orgId, member.userId, 'enroll_in_sequence', { ...params, force: true }));
    expect(memberForce.body.success, JSON.stringify(memberForce.body)).toBe(false);
    expect(memberForce.body.error).toMatch(/réservée aux propriétaires et administrateurs/);
    expect((await enrollmentsOfCandidate(org.orgId, candidate)).filter((e) => e.sequence_id === target.sequenceId)).toHaveLength(0);

    const adminForce = await approve(await tokenOf(adminUser), await propose(org.orgId, adminUser.userId, 'enroll_in_sequence', { ...params, force: true }));
    expect(adminForce.status, JSON.stringify(adminForce.body)).toBe(200);
    const forced = (await enrollmentsOfCandidate(org.orgId, candidate)).filter((e) => e.sequence_id === target.sequenceId);
    expect(forced).toHaveLength(1);
    expect(forced[0].created_by).toBe(adminUser.userId);

    // Déjà dans cette séquence : refus même avec force.
    const again = await approve(await tokenOf(adminUser), await propose(org.orgId, adminUser.userId, 'enroll_in_sequence', { ...params, force: true }));
    expect(again.body.success, JSON.stringify(again.body)).toBe(false);
    expect(again.body.error).toMatch(/déjà inscrit dans cette séquence/);
  });

  // assistant-inscription-anti-doublon-force
  test('refuse un candidat qui a reçu un InMail groupé il y a 10 jours, une séquence désactivée, un candidat effacé et une offre sans envoi, sans aucune ligne', async () => {
    const { org, accountId } = await sendingOrg('E2E A2 Anti-doublon refus');
    track(org);
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const target = await missionSequence(org, org.owner.userId, missionId);
    const token = await tokenOf(org.owner);
    const tryEnroll = async (params: Record<string, unknown>) =>
      approve(token, await propose(org.orgId, org.owner.userId, 'enroll_in_sequence', { job_id: missionId, sequence_id: target.sequenceId, ...params }));

    // InMail groupé envoyé il y a 10 jours.
    const inmailed = newProfileId();
    await queueInMail(org.orgId, org.owner.userId, accountId, {
      recipient_profile_id: inmailed, status: 'sent', sent_at: minutesFromNow(-10 * DAY),
      created_at: minutesFromNow(-10 * DAY), scheduled_at: minutesFromNow(-10 * DAY),
    });
    const byInMail = await tryEnroll({ candidate_id: inmailed });
    expect(byInMail.body.success, JSON.stringify(byInMail.body)).toBe(false);
    expect(byInMail.body.error).toMatch(/Déjà contacté par .* par InMail/);
    expect(await enrollmentsOfCandidate(org.orgId, inmailed)).toHaveLength(0);

    // Séquence désactivée.
    const off = await missionSequence(org, org.owner.userId, missionId);
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', off.sequenceId);
    const cand1 = newProfileId();
    const inactive = await tryEnroll({ candidate_id: cand1, sequence_id: off.sequenceId });
    expect(inactive.body.success, JSON.stringify(inactive.body)).toBe(false);
    expect(inactive.body.error).toMatch(/est désactivée/);
    expect(await enrollmentsOfCandidate(org.orgId, cand1)).toHaveLength(0);

    // Candidat effacé (registre RGPD) : refus à l'exécution.
    const erasedUrl = `https://www.linkedin.com/in/e2e-a2-efface-${rand()}`;
    await eraseLinkedInUrl(erasedUrl);
    const cand2 = newProfileId();
    const erased = await tryEnroll({ candidate_id: cand2, profile_url: erasedUrl });
    expect(erased.body.success, JSON.stringify(erased.body)).toBe(false);
    expect(erased.body.error).toMatch(/effacement de ses données/);
    expect(await enrollmentsOfCandidate(org.orgId, cand2)).toHaveLength(0);

    // Offre sans envoi.
    await setPaidPlan(org.orgId, 'free');
    const cand3 = newProfileId();
    const free = await tryEnroll({ candidate_id: cand3 });
    expect(free.body.success, JSON.stringify(free.body)).toBe(false);
    expect(free.body.error).toMatch(/offre actuelle ne permet pas l'envoi de séquences/);
    expect(await enrollmentsOfCandidate(org.orgId, cand3)).toHaveLength(0);
  });
});

test.describe('Assistant : approbation', () => {
  // assistant-approbation-droits
  test('une action proposée par un admin ne s’exécute pas pour un autre admin ; double clic : une seule exécution ; rôle retiré : refus ; anonyme 401, clé de service 403', async () => {
    const { org, accountId } = await sendingOrg('E2E A2 Approbation');
    const a1 = await addMember(org.orgId, 'admin', 'admin1');
    const a2 = await addMember(org.orgId, 'admin', 'admin2');
    track(org, a1, a2);
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const e1 = await enroll(org, sequenceId, org.owner.userId, accountId);
    const e2 = await enroll(org, sequenceId, org.owner.userId, accountId);
    const a1Token = await tokenOf(a1);

    // 1. Approuvée par un autre admin : refus, rien ne bouge.
    const byA1 = await propose(org.orgId, a1.userId, 'pause_sequence', { sequence_id: sequenceId });
    const stranger = await approve(await tokenOf(a2), byA1);
    expect(stranger.body.success, JSON.stringify(stranger.body)).toBe(false);
    expect(stranger.body.error).toMatch(/^Forbidden/);
    expect(await sequenceActive(sequenceId)).toBe(true);
    expect((await execRow(byA1)).status).toBe('proposed');

    // 2. Anonyme et clé de service.
    const anonymous = await postJson('/functions/v1/agent-tool-action', { execution_id: byA1, action: 'approve' });
    expect(anonymous.status).toBe(401);
    const service = await postJson('/functions/v1/agent-tool-action', { execution_id: byA1, action: 'approve' }, { Authorization: `Bearer ${E2E.serviceRoleKey}` });
    expect(service.status).toBe(403);
    expect((await execRow(byA1)).status).toBe('proposed');

    // 3. Double clic du proposant : une seule exécution.
    const [first, second] = await Promise.all([approve(a1Token, byA1), approve(a1Token, byA1)]);
    // Résultat d'exécution : direct au premier clic ; le clic rejoué sur une
    // ligne déjà exécutée renvoie la ligne relue (real_result, enveloppé dans data).
    const pausedIn = (r: { body: ToolResponse }) => r.body.data?.paused_enrollments ?? r.body.data?.data?.paused_enrollments;
    expect([first, second].some((r) => r.body.success && pausedIn(r) === 2), JSON.stringify([first.body, second.body])).toBe(true);
    for (const r of [first, second]) {
      // L'autre clic : « déjà en cours » ou le même résultat relu (idempotence), jamais une seconde exécution (0 candidat).
      expect(
        (r.body.success === true && pausedIn(r) === 2) || /déjà en cours ou déjà traitée/.test(String(r.body.error)),
        JSON.stringify(r.body),
      ).toBe(true);
    }
    const row = await execRow(byA1);
    expect(row.status).toBe('executed');
    expect(row.real_result?.data?.paused_enrollments ?? (row.real_result as any)?.paused_enrollments, 'compté une fois').toBe(2);
    for (const e of [e1, e2]) expect(await enrollmentRow(e.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'sequence_inactive' });
    expect(await sequenceActive(sequenceId)).toBe(false);

    // 4. Droits rejoués à l'approbation : A1 devenu collaborateur entre la proposition et le clic.
    await admin().from('outreach_sequences').update({ is_active: true }).eq('id', sequenceId);
    const e3 = await enroll(org, sequenceId, org.owner.userId, accountId);
    const again = await propose(org.orgId, a1.userId, 'pause_sequence', { sequence_id: sequenceId });
    await admin().from('organization_members').update({ role: 'collaborator' }).eq('organization_id', org.orgId).eq('user_id', a1.userId);
    const demoted = await approve(a1Token, again);
    expect(demoted.body.success, JSON.stringify(demoted.body)).toBe(false);
    expect(demoted.body.error).toMatch(/collaborateur/);
    expect(await sequenceActive(sequenceId), 'séquence inchangée').toBe(true);
    expect((await enrollmentRow(e3.enrollmentId)).status).toBe('active');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Liaison des comptes LinkedIn (unipile-accounts, unipile-webhook)
// ════════════════════════════════════════════════════════════════════════════

test.describe('Comptes LinkedIn : dissociation, rattachement, retrait', () => {
  // unlink-droits-garde
  test('« Dissocier » : liaison mal formée 400, compte attendu absent 400 ou différent 409, autre organisation 404, collègue 403 ; titulaire et admin peuvent', async () => {
    const { org, accountId: ownerAccount } = await sendingOrg('E2E A2 Dissocier');
    const member = await addMember(org.orgId, 'member', 'membre');
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    const adminUser = await addMember(org.orgId, 'admin', 'admin');
    track(org, member, collab, adminUser);
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_a2_${rand()}`, 'OK');
    const collabAccount = await seedLinkedInAccount(org.orgId, collab.userId, `acc_a2_${rand()}`, 'OK');
    const other = await sendingOrg('E2E A2 Dissocier autre');
    track(other.org);

    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const ownerEnrollment = await enroll(org, sequenceId, org.owner.userId, ownerAccount);
    const [ownerLink] = await linkOf(org.orgId, org.owner.userId);
    const [memberLink] = await linkOf(org.orgId, member.userId);
    const [collabLink] = await linkOf(org.orgId, collab.userId);
    const [foreignLink] = await linkOf(other.org.orgId, other.org.owner.userId);
    const memberToken = await tokenOf(member);
    const unlink = (token: string, body: Record<string, unknown>) => unipileAccounts(token, { action: 'unlink_linkedin_account', ...body });

    const cases: Array<[string, Promise<{ status: number; body: Record<string, unknown> }>, number]> = [
      ['liaison mal formée', unlink(memberToken, { mapping_id: 'x', expected_account_id: memberAccount }), 400],
      ['compte attendu absent', unlink(memberToken, { mapping_id: memberLink.id }), 400],
      ['compte attendu différent', unlink(memberToken, { mapping_id: memberLink.id, expected_account_id: `acc_autre_${rand()}` }), 409],
      ['liaison d’une autre organisation', unlink(memberToken, { mapping_id: foreignLink.id, expected_account_id: other.accountId }), 404],
      ['membre sur la liaison du propriétaire', unlink(memberToken, { mapping_id: ownerLink.id, expected_account_id: ownerAccount }), 403],
      ['collaborateur sur la liaison d’un membre', unlink(await tokenOf(collab), { mapping_id: memberLink.id, expected_account_id: memberAccount }), 403],
    ];
    for (const [label, call, expected] of cases) {
      const res = await call;
      expect(res.status, `${label} : ${JSON.stringify(res.body)}`).toBe(expected);
    }
    // Rien n'a bougé.
    expect(await linkOf(org.orgId, org.owner.userId)).toHaveLength(1);
    expect(await linkOf(org.orgId, member.userId)).toHaveLength(1);
    expect(await linkOf(other.org.orgId, other.org.owner.userId)).toHaveLength(1);
    expect((await enrollmentRow(ownerEnrollment.enrollmentId)).status).toBe('active');

    // Admin sur la liaison d'un membre ; titulaire sur la sienne.
    const byAdmin = await unlink(await tokenOf(adminUser), { mapping_id: memberLink.id, expected_account_id: memberAccount });
    expect(byAdmin.status, JSON.stringify(byAdmin.body)).toBe(200);
    expect(await linkOf(org.orgId, member.userId)).toHaveLength(0);
    const byHolder = await unlink(await tokenOf(collab), { mapping_id: collabLink.id, expected_account_id: collabAccount });
    expect(byHolder.status, JSON.stringify(byHolder.body)).toBe(200);
    expect(await linkOf(org.orgId, collab.userId)).toHaveLength(0);
  });

  // claim-changement-compte
  test('relier un nouveau compte arrête d’abord les envois de l’ancien (pause manuelle, InMail annulé) et remet linked_at à maintenant', async () => {
    const { org, accountId: acc1 } = await sendingOrg('E2E A2 Changement compte');
    track(org);
    await admin().from('member_linkedin_accounts').update({ linked_at: minutesFromNow(-30 * DAY) })
      .eq('organization_id', org.orgId).eq('linkedin_account_id', acc1);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const e1 = await enroll(org, sequenceId, org.owner.userId, acc1);
    const plannedAt = minutesFromNow(DAY);
    const exec1 = await schedule(org, e1.enrollmentId, steps[0], { scheduled_at: plannedAt });
    const inmail = await queueInMail(org.orgId, org.owner.userId, acc1, { scheduled_at: minutesFromNow(DAY) });
    const acc2 = `acc_a2_new_${rand()}`;

    const before = Date.now();
    const res = await unipileAccounts(await tokenOf(org.owner), { action: 'claim_linkedin_account', account_id: acc2 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);

    const links = await linkOf(org.orgId, org.owner.userId);
    expect(links).toHaveLength(1);
    expect(links[0].linkedin_account_id).toBe(acc2);
    expect(new Date(links[0].linked_at!).getTime(), 'linked_at remis à maintenant').toBeGreaterThanOrEqual(before - 5_000);
    expect(await enrollmentRow(e1.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'manual' });
    const exec = (await executionsOf(e1.enrollmentId)).find((e) => e.id === exec1)!;
    expect(exec.status, 'étape gardée en attente').toBe('scheduled');
    expect(new Date(exec.scheduled_at).getTime()).toBe(new Date(plannedAt).getTime());
    expect((await inmailStatus(inmail)).status).toBe('cancelled');
  });

  // claim-changement-compte
  test('changement de compte dont l’arrêt des envois échoue : 500, l’ancienne liaison reste', async () => {
    const { org, accountId: acc1 } = await sendingOrg('E2E A2 Changement compte échec');
    track(org);
    const oldLinkedAt = minutesFromNow(-30 * DAY);
    await admin().from('member_linkedin_accounts').update({ linked_at: oldLinkedAt })
      .eq('organization_id', org.orgId).eq('linkedin_account_id', acc1);
    const inmail = await queueInMail(org.orgId, org.owner.userId, acc1, { scheduled_at: minutesFromNow(DAY) });

    const drop = failingTrigger('inmail_queue', 'UPDATE', org.orgId);
    const res = await unipileAccounts(await tokenOf(org.owner), { action: 'claim_linkedin_account', account_id: `acc_a2_new_${rand()}` });
    drop();
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    expect(String(res.body.error)).toMatch(/le changement de compte est annulé/);
    const links = await linkOf(org.orgId, org.owner.userId);
    expect(links.map((l) => l.linkedin_account_id), 'ancienne liaison intacte').toEqual([acc1]);
    expect(new Date(links[0].linked_at!).getTime()).toBe(new Date(oldLinkedAt).getTime());
    expect((await inmailStatus(inmail)).status, 'InMail inchangé').toBe('scheduled');
  });

  // claim-droits
  test('« C’est mon compte » : autre espace 403, relié à un collègue 409, orphelin refusé au membre et accepté pour l’admin, liaison pour autrui réservée, cible hors organisation 404', async () => {
    const { org, accountId: ownerAccount } = await sendingOrg('E2E A2 Rattacher');
    const member = await addMember(org.orgId, 'member', 'membre');
    const member2 = await addMember(org.orgId, 'member', 'membre2');
    const adminUser = await addMember(org.orgId, 'admin', 'admin');
    track(org, member, member2, adminUser);
    const other = await sendingOrg('E2E A2 Rattacher autre');
    track(other.org);
    const outsider = await createOrg('agency', 'E2E A2 Rattacher hors');
    track(outsider);
    const memberToken = await tokenOf(member);
    const claim = (token: string, body: Record<string, unknown>) => unipileAccounts(token, { action: 'claim_linkedin_account', ...body });

    const foreign = await claim(memberToken, { account_id: other.accountId });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(403);
    expect(String(foreign.body.error)).toMatch(/autre espace de travail/);

    const colleague = await claim(memberToken, { account_id: ownerAccount });
    expect(colleague.status, JSON.stringify(colleague.body)).toBe(409);

    // Orphelin sans date de création connue du prestataire (le faux prestataire
    // n'en donne pas) : traité comme plus vieux que 30 minutes.
    const orphan = `acc_a2_orphan_${rand()}`;
    const orphanByMember = await claim(memberToken, { account_id: orphan });
    expect(orphanByMember.status, JSON.stringify(orphanByMember.body)).toBe(403);
    expect(String(orphanByMember.body.error)).toMatch(/Demandez à un administrateur/);
    expect(await linkOf(org.orgId, member.userId)).toHaveLength(0);

    const forOther = await claim(memberToken, { account_id: orphan, user_id: member2.userId });
    expect(forOther.status, 'un membre ne relie pas le compte d’un autre').toBe(403);

    const adminToken = await tokenOf(adminUser);
    const notInOrg = await claim(adminToken, { account_id: orphan, user_id: outsider.owner.userId });
    expect(notInOrg.status, JSON.stringify(notInOrg.body)).toBe(404);

    const byAdmin = await claim(adminToken, { account_id: orphan, user_id: member.userId });
    expect(byAdmin.status, JSON.stringify(byAdmin.body)).toBe(200);
    expect((await linkOf(org.orgId, member.userId)).map((l) => l.linkedin_account_id)).toEqual([orphan]);

    // Refus sans écriture : les liaisons des autres n'ont pas bougé.
    expect((await linkOf(org.orgId, org.owner.userId)).map((l) => l.linkedin_account_id)).toEqual([ownerAccount]);
    expect((await linkOf(other.org.orgId, other.org.owner.userId)).map((l) => l.linkedin_account_id)).toEqual([other.accountId]);
    expect(await linkOf(org.orgId, member2.userId)).toHaveLength(0);
  });

  // claim-droits (orphelin récent, type de compte)
  test('« C’est mon compte » sur un orphelin : créé il y a 2 h refusé au membre, il y a 5 min accepté ; compte non LinkedIn 400', async () => {
    const { org } = await sendingOrg('E2E A2 Rattacher orphelin');
    const member = await addMember(org.orgId, 'member', 'membre');
    track(org, member);
    const memberToken = await tokenOf(member);
    // Identifiants LinkedIn propres à l'organisation : l'adresse amène
    // GET /accounts/<compte> du faux prestataire sous ce compte (même méthode
    // que seq-assistant.spec.ts, la clé '*' étant interdite sur la stack partagée).
    const scriptAccount = async (accountId: string, account: Record<string, unknown>) => {
      const { error } = await admin().from('organization_integrations').upsert({
        organization_id: org.orgId,
        unipile_connected: true,
        unipile_api_key: `e2e-${rand()}`,
        unipile_dsn: `e2e-${rand()}.mock.test/api/v1/accounts/${accountId}?account_id=${accountId}&suite=`,
      }, { onConflict: 'organization_id' });
      if (error) throw new Error(`organization_integrations: ${error.message}`);
      await setMockMode(accountId, {
        routes: [{ method: 'GET', path: `^/api/v1/accounts/${accountId}$`, status: 200, body: { object: 'Account', id: accountId, name: 'Compte test', sources: [{ id: `${accountId}_MESSAGING`, status: 'OK' }], ...account } }],
      });
    };
    const claim = (accountId: string) => unipileAccounts(memberToken, { action: 'claim_linkedin_account', account_id: accountId });

    const orphan = `acc_a2_orphan_${rand()}`;
    await scriptAccount(orphan, { type: 'LINKEDIN', created_at: minutesFromNow(-120) });
    const old = await claim(orphan);
    expect(old.status, JSON.stringify(old.body)).toBe(403);
    expect(await linkOf(org.orgId, member.userId)).toHaveLength(0);
    expect((await mockCalls(orphan)).some((c) => c.path === `/api/v1/accounts/${orphan}`), 'le prestataire a bien été consulté').toBe(true);

    await scriptAccount(orphan, { type: 'LINKEDIN', created_at: minutesFromNow(-5) });
    const recent = await claim(orphan);
    expect(recent.status, JSON.stringify(recent.body)).toBe(200);
    expect((await linkOf(org.orgId, member.userId)).map((l) => l.linkedin_account_id)).toEqual([orphan]);

    const mail = `acc_a2_mail_${rand()}`;
    await scriptAccount(mail, { type: 'MAIL', created_at: minutesFromNow(-5) });
    const notLinkedIn = await claim(mail);
    expect(notLinkedIn.status, JSON.stringify(notLinkedIn.body)).toBe(400);
    expect(String(notLinkedIn.body.error)).toMatch(/n'est pas un compte LinkedIn/);
    expect((await linkOf(org.orgId, member.userId)).map((l) => l.linkedin_account_id), 'liaison inchangée').toEqual([orphan]);
  });

  // stop-member-droits
  test('arrêt des envois d’un membre : réservé aux owner/admin, un admin n’arrête pas un propriétaire, inconnu 404, ancien membre accepté, identifiant mal formé 400', async () => {
    const { org } = await sendingOrg('E2E A2 Arrêt membre');
    const member = await addMember(org.orgId, 'member', 'membre');
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    const adminUser = await addMember(org.orgId, 'admin', 'admin');
    const former = await addMember(org.orgId, 'member', 'ancien');
    track(org, member, collab, adminUser, former);
    const adminAccount = await seedLinkedInAccount(org.orgId, adminUser.userId, `acc_a2_${rand()}`, 'OK');
    const formerAccount = await seedLinkedInAccount(org.orgId, former.userId, `acc_a2_${rand()}`, 'OK');
    const { sequenceId, steps } = await messageSequence(org, former.userId, ['Bonjour', 'Relance']);
    const formerEnrollment = await enroll(org, sequenceId, former.userId, formerAccount);
    await schedule(org, formerEnrollment.enrollmentId, steps[0], { scheduled_at: minutesFromNow(DAY) });
    const stop = (token: string, memberUserId: string) =>
      unipileAccounts(token, { action: 'stop_member_linkedin', organization_id: org.orgId, member_user_id: memberUserId });

    expect((await stop(await tokenOf(member), adminUser.userId)).status, 'membre').toBe(403);
    expect((await stop(await tokenOf(collab), adminUser.userId)).status, 'collaborateur').toBe(403);
    const adminToken = await tokenOf(adminUser);
    const adminOnOwner = await stop(adminToken, org.owner.userId);
    expect(adminOnOwner.status, JSON.stringify(adminOnOwner.body)).toBe(403);
    expect(await linkOf(org.orgId, org.owner.userId), 'liaison du propriétaire intacte').toHaveLength(1);
    expect(await linkOf(org.orgId, adminUser.userId), 'rien retiré après un refus').toHaveLength(1);

    const ownerToken = await tokenOf(org.owner);
    const unknown = await stop(ownerToken, '00000000-0000-4000-8000-000000000000');
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(404);
    const malformed = await stop(ownerToken, 'x');
    expect(malformed.status, JSON.stringify(malformed.body)).toBe(400);

    const ownerOnAdmin = await stop(ownerToken, adminUser.userId);
    expect(ownerOnAdmin.status, JSON.stringify(ownerOnAdmin.body)).toBe(200);
    expect(await linkOf(org.orgId, adminUser.userId)).toHaveLength(0);
    void adminAccount;

    // Ancien membre dont la liaison est restée : nettoyage accepté.
    await admin().from('organization_members').delete().eq('organization_id', org.orgId).eq('user_id', former.userId);
    const cleanup = await stop(ownerToken, former.userId);
    expect(cleanup.status, JSON.stringify(cleanup.body)).toBe(200);
    expect(await linkOf(org.orgId, former.userId), 'liaison retirée').toHaveLength(0);
    expect(await enrollmentRow(formerEnrollment.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'manual' });
  });

  // stop-echec-garde-liaison (partie API ; l'écran Équipe est dans e2e/flows/seq-actions-2.spec.ts)
  test('arrêt des envois en échec (retrait d’un membre, dissociation) : 500 avec un message clair, la liaison reste', async () => {
    const { org } = await sendingOrg('E2E A2 Arrêt échec');
    const member = await addMember(org.orgId, 'member', 'membre');
    track(org, member);
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_a2_${rand()}`, 'OK');
    await queueInMail(org.orgId, member.userId, memberAccount, { scheduled_at: minutesFromNow(DAY) });
    const [memberLink] = await linkOf(org.orgId, member.userId);
    const ownerToken = await tokenOf(org.owner);

    const drop = failingTrigger('inmail_queue', 'UPDATE', org.orgId);
    const stop = await unipileAccounts(ownerToken, { action: 'stop_member_linkedin', organization_id: org.orgId, member_user_id: member.userId });
    const unlink = await unipileAccounts(ownerToken, { action: 'unlink_linkedin_account', mapping_id: memberLink.id, expected_account_id: memberAccount });
    drop();

    expect(stop.status, JSON.stringify(stop.body)).toBe(500);
    expect(stop.body.error).toBe("Les envois de ce membre n'ont pas pu être arrêtés : il n'a pas été retiré. Réessayez.");
    expect(unlink.status, JSON.stringify(unlink.body)).toBe(500);
    expect(String(unlink.body.error)).toMatch(/n'ont pas pu être arrêtés : le compte reste relié/);
    expect(await linkOf(org.orgId, member.userId), 'liaison toujours présente').toHaveLength(1);
  });

  // hosted-auth-remplacement
  test('nouvelle connexion LinkedIn (hosted_auth) qui remplace le compte d’un membre : l’ancien s’arrête puis la liaison est repointée', async () => {
    const { org, accountId: acc1 } = await sendingOrg('E2E A2 Hosted auth');
    track(org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const e1 = await enroll(org, sequenceId, org.owner.userId, acc1);
    await schedule(org, e1.enrollmentId, steps[0], { scheduled_at: minutesFromNow(DAY) });
    const inmail = await queueInMail(org.orgId, org.owner.userId, acc1, { scheduled_at: minutesFromNow(DAY) });
    const acc2 = `acc_a2_hosted_${rand()}`;

    await webhook({
      status: 'CREATION_SUCCESS', account_id: acc2, account_type: 'LINKEDIN',
      name: `user:${org.owner.userId}|org:${org.orgId}`,
    });

    expect((await linkOf(org.orgId, org.owner.userId)).map((l) => l.linkedin_account_id)).toEqual([acc2]);
    expect(await enrollmentRow(e1.enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'manual' });
    expect((await inmailStatus(inmail)).status).toBe('cancelled');
  });

  // hosted-auth-remplacement
  test('nouvelle connexion avec un compte d’une autre organisation ou d’un collègue : rien n’est arrêté, liaison inchangée, le membre est notifié', async () => {
    const { org, accountId: acc1 } = await sendingOrg('E2E A2 Hosted auth refus');
    const member = await addMember(org.orgId, 'member', 'membre');
    track(org, member);
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_a2_${rand()}`, 'OK');
    const other = await sendingOrg('E2E A2 Hosted auth autre');
    track(other.org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const e1 = await enroll(org, sequenceId, org.owner.userId, acc1);
    await schedule(org, e1.enrollmentId, steps[0], { scheduled_at: minutesFromNow(DAY) });

    for (const [label, accountId, body] of [
      ['autre organisation', other.accountId, 'déjà rattaché à un autre espace de travail'],
      ['collègue', memberAccount, 'déjà rattaché à un autre membre de votre organisation'],
    ] as const) {
      await webhook({
        status: 'CREATION_SUCCESS', account_id: accountId, account_type: 'LINKEDIN',
        name: `user:${org.owner.userId}|org:${org.orgId}`,
      });
      expect((await linkOf(org.orgId, org.owner.userId)).map((l) => l.linkedin_account_id), label).toEqual([acc1]);
      expect((await enrollmentRow(e1.enrollmentId)).status, `${label} : rien n’est arrêté`).toBe('active');
      const { data: notes } = await admin()
        .from('notifications').select('title, body')
        .eq('organization_id', org.orgId).eq('user_id', org.owner.userId).eq('title', 'Compte LinkedIn non rattaché');
      expect((notes ?? []).some((n) => String(n.body).includes(body)), `${label} : ${JSON.stringify(notes)}`).toBe(true);
    }
    expect((await linkOf(other.org.orgId, other.org.owner.userId)).map((l) => l.linkedin_account_id)).toEqual([other.accountId]);
    expect((await linkOf(org.orgId, member.userId)).map((l) => l.linkedin_account_id)).toEqual([memberAccount]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// File des InMails
// ════════════════════════════════════════════════════════════════════════════

test.describe('File des InMails', () => {
  // inmail-cancel-avant-envoi
  test('un InMail annulé pendant que la file le traite n’est jamais envoyé ; sans annulation, il part (contrôle)', async () => {
    test.skip(!SEND_ZONE, 'aucun fuseau en jour ouvré : la file refuse tout envoi le week-end, sans forçage');
    const { org, accountId } = await sendingOrg('E2E A2 InMail annulé');
    track(org);
    await openBusinessHours(org.orgId, org.owner.userId);
    const token = await tokenOf(org.owner);
    const processQueue = () => postJson('/functions/v1/process-inmail-queue', { action: 'process' }, { Authorization: `Bearer ${CRON_SECRET}` });
    const sends = async () => (await mockCalls(accountId)).filter((c) => c.method === 'POST' && /^\/api\/v1\/chats/.test(c.path));

    // 1. Annulé avant le passage de la file.
    const early = await queueInMail(org.orgId, org.owner.userId, accountId, { user_timezone: SEND_ZONE, scheduled_at: minutesFromNow(-400 * DAY) });
    const cancelEarly = await postJson('/functions/v1/process-inmail-queue', { action: 'cancel', item_ids: [early] }, { Authorization: `Bearer ${token}` });
    expect(cancelEarly.status, JSON.stringify(cancelEarly.body)).toBe(200);
    expect(cancelEarly.body.cancelled).toBe(1);
    expect((await processQueue()).status).toBe(200);
    expect(await sends(), 'rien ne part après une annulation').toEqual([]);
    expect((await inmailStatus(early)).status).toBe('cancelled');

    // 2. Annulé pendant le traitement : le contrôle du solde InMail est
    //    ralenti pour ce compte, l'annulation arrive avant la prise en charge.
    await setMockMode(accountId, { routes: [{ method: 'GET', path: '^/api/v1/linkedin/inmail_balance$', status: 200, body: { recruiter: 10, premium: 0, sales_navigator: 0 }, delay_ms: 6_000, times: 1 }] });
    const racing = await queueInMail(org.orgId, org.owner.userId, accountId, { user_timezone: SEND_ZONE, scheduled_at: minutesFromNow(-400 * DAY) });
    const run = processQueue();
    let balanceSeen = false;
    for (let i = 0; i < 40 && !balanceSeen; i++) {
      await new Promise((r) => setTimeout(r, 250));
      balanceSeen = (await mockCalls(accountId)).some((c) => c.path === '/api/v1/linkedin/inmail_balance');
    }
    expect(balanceSeen, 'la file a pris l’InMail (contrôle du solde en cours)').toBe(true);
    const cancelLate = await postJson('/functions/v1/process-inmail-queue', { action: 'cancel', item_ids: [racing] }, { Authorization: `Bearer ${token}` });
    expect(cancelLate.body.cancelled, JSON.stringify(cancelLate.body)).toBe(1);
    expect((await run).status).toBe(200);
    expect(await sends(), 'l’InMail annulé en cours de traitement ne part pas').toEqual([]);
    expect((await inmailStatus(racing)).status).toBe('cancelled');

    // 3. Contrôle : sans annulation, le même InMail part.
    await setMockMode(accountId, { routes: [] });
    const control = await queueInMail(org.orgId, org.owner.userId, accountId, { user_timezone: SEND_ZONE, scheduled_at: minutesFromNow(-400 * DAY) });
    expect((await processQueue()).status).toBe(200);
    const status = await inmailStatus(control);
    expect(status.status, JSON.stringify(status)).toBe('sent');
    expect(await sends(), 'un seul envoi, celui du contrôle').toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Réactivation directe par l'API (en dernier : défaut connu, le mode série
// arrêterait les tests suivants)
// ════════════════════════════════════════════════════════════════════════════

test.describe('Reprise directe par l’API', () => {
  // reprise-directe-rest-contourne-serveur (compte dissocié)
  test('candidat dont le compte a été dissocié, réactivé par une écriture directe de l’API : rien ne part du compte dissocié', async () => {
    const { org } = await sendingOrg('E2E A2 Reprise directe dissocié');
    const member = await addMember(org.orgId, 'member', 'membre');
    track(org, member);
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_a2_${rand()}`, 'OK');
    const { sequenceId, steps } = await messageSequence(org, member.userId, ['Bonjour', 'Relance'], 0);
    const { enrollmentId } = await enroll(org, sequenceId, member.userId, memberAccount, { current_step_order: 1 });
    await schedule(org, enrollmentId, steps[0], {
      status: 'sent', scheduled_at: minutesFromNow(-3 * DAY), executed_at: minutesFromNow(-3 * DAY),
    });
    const [memberLink] = await linkOf(org.orgId, member.userId);
    const unlink = await unipileAccounts(await tokenOf(org.owner), {
      action: 'unlink_linkedin_account', mapping_id: memberLink.id, expected_account_id: memberAccount,
    });
    expect(unlink.status, JSON.stringify(unlink.body)).toBe(200);
    expect(await enrollmentRow(enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'manual' });

    // Le membre réécrit le statut lui-même par l'API REST.
    const patch = await restPatch(`sequence_enrollments?id=eq.${enrollmentId}`, await tokenOf(member), { status: 'active', pause_reason: null });
    if ((await enrollmentFull(enrollmentId)).status === 'active') {
      backdateUpdatedAt('sequence_enrollments', enrollmentId, '400 days');
      await runCycle();
      for (const e of await pendingExecutions(enrollmentId)) {
        await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', e.id);
      }
      await runCycle();
    }
    expect(await sentTexts(memberAccount), `PATCH ${patch.status} : aucun envoi depuis le compte dissocié`).toEqual([]);
    // Le moteur remet l'inscription en pause (compte non rattaché) au lieu d'envoyer.
    expect((await enrollmentRow(enrollmentId)).status).toBe('paused');
  });

  // reprise-directe-rest-contourne-serveur
  test('candidat effacé (RGPD) réactivé par une écriture directe de l’API : il ne repart pas et rien ne lui est envoyé (D5)', async () => {
    const { org, accountId } = await sendingOrg('E2E A2 Reprise directe');
    track(org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 0);
    const erasedAt = minutesFromNow(-3 * 60);
    // État laissé par un effacement : inscription arrêtée, marqueur durable,
    // étape en attente annulée par l'effacement.
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, {
      status: 'stopped',
      current_step_order: 1,
      profile_url: `https://www.linkedin.com/in/e2e-efface-${rand()}`,
      tracking_data: { gdpr_erased_at: erasedAt },
    });
    await schedule(org, enrollmentId, steps[0], {
      status: 'sent', scheduled_at: minutesFromNow(-3 * DAY), executed_at: minutesFromNow(-3 * DAY),
    });
    await schedule(org, enrollmentId, steps[1], {
      status: 'cancelled', skip_reason: 'Effacement des données demandé : séquence arrêtée', scheduled_at: minutesFromNow(-3 * 60),
    });

    // Réactivation écrite directement par l'API REST avec le JWT du propriétaire.
    const patch = await restPatch(`sequence_enrollments?id=eq.${enrollmentId}`, await tokenOf(org.owner), { status: 'active' });
    const afterPatch = await enrollmentFull(enrollmentId);
    // DÉFAUT reprise-directe-sans-garde : la policy org_members_update laisse passer stopped → active sans passer par la reprise serveur (D5).
    expect.soft(afterPatch.status, `PATCH ${patch.status} : l’inscription d’un candidat effacé ne doit pas redevenir active`).toBe('stopped');

    if (afterPatch.status === 'active') {
      // Le rattrapage des inscriptions dormantes prend les actives sans étape
      // en attente depuis plus d'une heure.
      backdateUpdatedAt('sequence_enrollments', enrollmentId, '400 days');
      await runCycle();
      const pendingNow = await pendingExecutions(enrollmentId);
      // DÉFAUT reprise-directe-sans-garde : le rattrapage planifie une nouvelle étape pour le candidat effacé.
      expect.soft(pendingNow.map((e) => ({ step: e.step_order, status: e.status })), 'aucune étape planifiée pour un candidat effacé').toEqual([]);
      // L'étape éventuellement planifiée arrive à échéance.
      for (const e of pendingNow) {
        await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', e.id);
      }
      if (pendingNow.length) await runCycle();
    }
    // DÉFAUT reprise-directe-sans-garde : le moteur envoie la relance au candidat effacé.
    expect(await sentTexts(accountId), 'aucun message au candidat effacé').toEqual([]);
  });
});

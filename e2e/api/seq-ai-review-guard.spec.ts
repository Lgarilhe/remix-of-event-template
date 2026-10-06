/**
 * Lot 5a-2 (décision 5) : aucun message rédigé par l'IA ne part sans
 * relecture. Le moteur process-sequences reporte d'une heure toute exécution
 * d'une étape à message (message, InMail, Message IA) dont l'étape a
 * use_ai_personalization, sauf texte relu : la retouche validée à
 * l'inscription (tracking_data.message_overrides[step_id]) ou la correction
 * du Journal (final_message d'une exécution programmée, hors copie périmée du
 * modèle). Effet du report : exécution 'scheduled', date avancée d'une heure,
 * raison « Message rédigé par l'IA à relire avant l'envoi. », aucun appel au
 * modèle, aucun envoi, aucune place du plafond LinkedIn, inscription
 * inchangée (ni pause, ni échec, ni retry_count, ni auto-pause).
 *
 * Contrat : CLAUDE.md, « Aucun message IA sans relecture (lot 5a-2) », et
 * docs/refonte-mission/lot5-plan.md, section 5a-2 (« Tests à écrire »).
 * Règle pure : aiReviewRequired, supabase/functions/_shared/sequence-send-rules.ts.
 *
 * Le moteur tourne pour de vrai contre la stack locale (e2e/local-stack) ;
 * LinkedIn et l'IA sont simulés par vendor-mock.mjs, qui journalise chaque
 * appel. Un appel au faux modèle ne porte pas de compte : chaque test place un
 * marqueur aléatoire dans le modèle de l'étape IA et cherche ce marqueur dans
 * les appels POST /v1/messages. Chaque test a sa propre organisation et son
 * propre compte LinkedIn (isolation du journal par account_id). Ignoré sans
 * cette stack.
 *
 * D'autres suites peuvent faire tourner des cycles sur la même base : toute
 * exécution due est insérée en dernier, et les bornes de date du report
 * partent d'avant la remise à échéance.
 */
import { test, expect, request } from '@playwright/test';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  deleteOrg,
  seedLinkedInAccount,
  signIn,
  type SeededStep,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  CRON_SECRET,
  ENGINE_SKIP_REASON,
  callFunction,
  engineAvailable,
  enroll,
  minutesFromNow,
  mockCalls,
  rand,
  schedule,
  sendingOrg,
  sentTexts,
  type MockCall,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

// ─── Textes du contrat ──────────────────────────────────────────────────────

/** AI_REVIEW_REQUIRED_MESSAGE de _shared/sequence-send-rules.ts. */
const AI_REVIEW_REASON = "Message rédigé par l'IA à relire avant l'envoi.";
const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ─── Ménage ─────────────────────────────────────────────────────────────────

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[]; accounts: string[] }> = [];

test.afterEach(async () => {
  while (orgsToDelete.length) {
    const { org, extra, accounts } = orgsToDelete.pop()!;
    await admin().from('member_quotas').delete().eq('organization_id', org.orgId);
    if (accounts.length) await admin().from('linkedin_action_log').delete().in('account_id', accounts);
    await deleteOrg(org, extra);
  }
});

async function sendingOrgTracked(prefix: string) {
  const res = await sendingOrg(prefix);
  orgsToDelete.push({ org: res.org, extra: [], accounts: [res.accountId] });
  return res;
}

// ─── Aides ──────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

/** Action du moteur avec le secret du cron, délai de requête long, réessai tant que le verrou est pris. */
async function engine(body: Json): Promise<Json> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const ctx = await request.newContext();
    const res = await ctx.post(`${E2E.supabaseUrl}/functions/v1/process-sequences`, {
      headers: { apikey: E2E.anonKey, Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
      data: body,
      timeout: 150_000,
    });
    const status = res.status();
    const json = (await res.json().catch(() => ({}))) as Json;
    await ctx.dispose();
    expect(status, JSON.stringify(json)).toBe(200);
    if (json.skipped_reason !== 'lock_held') return json;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('verrou du moteur jamais libéré');
}

/** Un passage du moteur, fenêtre d'envoi levée (le test passe aussi le soir et le week-end). */
const cycle = () => engine({ action: 'process', force: true });

const skippedOf = (res: Json) => Number((res.results as Record<string, unknown> | undefined)?.skipped ?? 0);

interface RestResult {
  status: number;
  body: unknown;
}

/** Appel PostgREST avec un JWT utilisateur (écritures et lectures du navigateur). */
async function rest(method: 'GET' | 'POST' | 'PATCH', path: string, token: string, body?: unknown): Promise<RestResult> {
  const res = await fetch(`${E2E.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: E2E.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* corps non JSON */
  }
  return { status: res.status, body: parsed };
}

async function tokenOf(user: TestUser): Promise<string> {
  return (await signIn(user.email, user.password)).access_token;
}

interface StepSpec {
  action_type: string;
  step_order?: number;
  message_template?: string | null;
  subject_template?: string | null;
  delay_days?: number;
  use_ai_personalization?: boolean;
}

/** Séquence active et étapes insérées une à une (ordre garanti). */
async function insertSequence(org: TestOrg, createdBy: string, specs: StepSpec[]) {
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({ name: `Séquence e2e 5a-2 ${rand()}`, organization_id: org.orgId, created_by: createdBy, is_active: true })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`insertSequence: ${error?.message}`);
  const steps: SeededStep[] = [];
  for (const [i, s] of specs.entries()) {
    const { data, error: stepErr } = await admin()
      .from('sequence_steps')
      .insert({ sequence_id: seq.id, step_order: s.step_order ?? i, delay_days: 0, message_template: null, ...s })
      .select('id, step_order, action_type')
      .single();
    if (stepErr || !data) throw new Error(`insertSequence(étape ${i}): ${stepErr?.message}`);
    steps.push(data as SeededStep);
  }
  return { sequenceId: seq.id as string, steps };
}

interface ExecFull {
  id: string;
  step_id: string;
  step_order: number;
  status: string;
  scheduled_at: string;
  executed_at: string | null;
  final_message: string | null;
  final_subject: string | null;
  skip_reason: string | null;
  error_message: string | null;
  retry_count: number | null;
  tracking_data: Json | null;
}

const EXEC_COLUMNS = 'id, step_id, step_order, status, scheduled_at, executed_at, final_message, final_subject, skip_reason, error_message, retry_count, tracking_data';

async function execRow(id: string): Promise<ExecFull> {
  const { data, error } = await admin().from('sequence_step_executions').select(EXEC_COLUMNS).eq('id', id).single();
  if (error || !data) throw new Error(`execRow ${id}: ${error?.message}`);
  return data as ExecFull;
}

async function execsOf(enrollmentId: string): Promise<ExecFull[]> {
  const { data } = await admin().from('sequence_step_executions').select(EXEC_COLUMNS)
    .eq('enrollment_id', enrollmentId).order('step_order').order('created_at');
  return (data ?? []) as ExecFull[];
}

interface EnrollmentFull {
  status: string;
  pause_reason: string | null;
  current_step_order: number;
  completed_at: string | null;
  replied_at: string | null;
}

async function enrollmentFull(id: string): Promise<EnrollmentFull> {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('status, pause_reason, current_step_order, completed_at, replied_at')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`enrollmentFull ${id}: ${error?.message}`);
  return data as EnrollmentFull;
}

async function sequenceActive(id: string): Promise<boolean> {
  const { data } = await admin().from('outreach_sequences').select('is_active').eq('id', id).single();
  return (data as { is_active: boolean }).is_active;
}

/** L'heure de report écoulée : exécution encore programmée remise due (clé de service, comme le temps qui passe). */
async function makeDue(execId: string): Promise<void> {
  const { error } = await admin().from('sequence_step_executions')
    .update({ scheduled_at: minutesFromNow(-1) }).eq('id', execId).eq('status', 'scheduled');
  if (error) throw new Error(`makeDue ${execId}: ${error.message}`);
}

/** Appels au faux modèle dont la requête porte le marqueur du test. */
async function aiCallsWith(marker: string): Promise<MockCall[]> {
  return (await mockCalls()).filter((c) => c.method === 'POST' && c.path === '/v1/messages' && JSON.stringify(c.body).includes(marker));
}

async function postsOf(accountId: string): Promise<MockCall[]> {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST');
}

/** Lignes du journal des actions LinkedIn (plafond) d'un compte. */
async function ledgerCount(accountId: string): Promise<number> {
  const { count, error } = await admin().from('linkedin_action_log').select('id', { count: 'exact', head: true }).eq('account_id', accountId);
  if (error) throw new Error(`ledgerCount: ${error.message}`);
  return count ?? 0;
}

interface QuotaStatus {
  today: { visible_actions: number; profile_views: number; searches: number; inmails: number };
  week: { invitations: number };
}

/** Compteurs du plafond LinkedIn d'un compte, lus comme l'écran (RPC get_linkedin_quota_status, JWT). */
async function quotaStatus(token: string, accountId: string): Promise<QuotaStatus> {
  const res = await rest('POST', 'rpc/get_linkedin_quota_status', token, { p_account_id: accountId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body, `compteurs du compte ${accountId}`).not.toBeNull();
  return res.body as QuotaStatus;
}

/**
 * Report attendu d'une exécution : toujours programmée, raison posée, aucun
 * texte inventé, aucun essai compté, date avancée d'une heure à partir du
 * passage (bornes : avant la remise à échéance, après le passage).
 */
function expectDeferred(row: ExecFull, from: number, to: number, label: string) {
  expect(row.status, `${label} : reportée, jamais verrouillée`).toBe('scheduled');
  expect(row.error_message, `${label} : raison posée`).toBe(AI_REVIEW_REASON);
  expect(row.final_message, `${label} : aucun texte inventé`).toBeNull();
  expect(row.executed_at, `${label} : jamais exécutée`).toBeNull();
  expect(row.skip_reason, `${label} : jamais sautée`).toBeNull();
  expect(row.retry_count ?? 0, `${label} : aucun essai compté`).toBe(0);
  const at = new Date(row.scheduled_at).getTime();
  expect(at, `${label} : reportée d'une heure`).toBeGreaterThanOrEqual(from + HOUR - 1_000);
  expect(at, `${label} : reportée d'une heure, pas plus`).toBeLessThanOrEqual(to + HOUR + 1_000);
}

/** Inscription intacte : active, sans pause ni fin. */
async function expectEnrollmentUntouched(enrollmentId: string, stepOrder: number, label: string) {
  const enr = await enrollmentFull(enrollmentId);
  expect(enr.status, `${label} : inscription toujours active`).toBe('active');
  expect(enr.pause_reason, `${label} : aucune pause`).toBeNull();
  expect(enr.completed_at, `${label} : jamais close`).toBeNull();
  expect(enr.current_step_order, `${label} : position inchangée`).toBe(stepOrder);
}

// ═══ 1. Étape IA sans retouche ══════════════════════════════════════════════

test.describe('Lot 5a-2 : garde du moteur, étape IA sans relecture', () => {
  test("sans retouche, trois passages : aucun appel au modèle, rien sur le compte LinkedIn, exécution programmée reportée d'une heure avec la raison, inscription active, aucune pause automatique", async () => {
    const { org, accountId } = await sendingOrgTracked('E2E 5a2 Sans relecture');
    const marker = `MQ5A2${rand()}${rand()}`;
    const seq = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: `Bonjour {{prenom}}, ${marker}`, use_ai_personalization: true },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const { enrollmentId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId);
    const x = await schedule(org, enrollmentId, seq.steps[0]);

    for (let pass = 1; pass <= 3; pass++) {
      const from = Date.now();
      if (pass > 1) await makeDue(x);
      const res = await cycle();
      const to = Date.now();
      expect(skippedOf(res), `passage ${pass} : report compté dans skipped`).toBeGreaterThanOrEqual(1);
      expectDeferred(await execRow(x), from, to, `passage ${pass}`);
    }

    const execs = await execsOf(enrollmentId);
    expect(execs.map((e) => e.id), 'aucune autre exécution créée, étape suivante jamais planifiée').toEqual([x]);
    await expectEnrollmentUntouched(enrollmentId, 0, 'après trois passages');
    expect(await sequenceActive(seq.sequenceId), 'aucune pause automatique de la séquence').toBe(true);
    expect(await mockCalls(accountId), 'journal LinkedIn du compte vide').toEqual([]);
    expect(await aiCallsWith(marker), 'aucun appel au faux modèle').toEqual([]);
    expect(await ledgerCount(accountId), 'aucune ligne au journal du plafond').toBe(0);
  });
});

// ═══ 2 et 3. Texte relu : retouche à l'inscription, correction du Journal ═══

test.describe('Lot 5a-2 : garde du moteur, texte relu', () => {
  test("retouche validée à l'inscription (message_overrides) : le texte part tel quel, sans appel au modèle", async () => {
    const { org, accountId } = await sendingOrgTracked('E2E 5a2 Retouche');
    const marker = `MQ5A2${rand()}${rand()}`;
    const seq = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: `Bonjour {{prenom}}, ${marker}`, use_ai_personalization: true },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const stepId = seq.steps[0].id;
    // Retouche modifiée à la main, et aperçu généré validé sans retouche : les deux sont relus.
    const edited = `Bonjour Camille, votre parcours chez Qonto m'a marqué (${rand()}).`;
    const generated = `Bonjour Camille, seriez-vous ouverte à un échange ? (${rand()})`;
    const a = await enroll(org, seq.sequenceId, org.owner.userId, accountId, {
      tracking_data: { message_overrides: { [stepId]: { message: edited, isEdited: true } } },
    });
    const b = await enroll(org, seq.sequenceId, org.owner.userId, accountId, {
      tracking_data: { message_overrides: { [stepId]: { message: generated, isEdited: false } } },
    });
    const xa = await schedule(org, a.enrollmentId, seq.steps[0]);
    const xb = await schedule(org, b.enrollmentId, seq.steps[0]);
    await cycle();

    const ra = await execRow(xa);
    const rb = await execRow(xb);
    expect(ra.status, 'retouche modifiée : partie').toBe('sent');
    expect(ra.final_message, 'texte envoyé figé tel quel').toBe(edited);
    expect(rb.status, 'aperçu validé : parti').toBe('sent');
    expect(rb.final_message).toBe(generated);
    expect([...(await sentTexts(accountId))].sort(), 'le faux LinkedIn reçoit exactement les textes relus').toEqual([edited, generated].sort());
    expect(await aiCallsWith(marker), 'aucun appel au faux modèle').toEqual([]);
    for (const e of [a, b]) expect((await enrollmentFull(e.enrollmentId)).status).toBe('active');
  });

  test("correction par le Journal après un report : le texte corrigé part tel quel au passage suivant ; une copie périmée du modèle n'est pas une relecture", async () => {
    const { org, accountId } = await sendingOrgTracked('E2E 5a2 Journal');
    const token = await tokenOf(org.owner);
    const marker = `MQ5A2${rand()}${rand()}`;
    const template = `Bonjour {{prenom}}, ${marker}`;
    const seq = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: template, use_ai_personalization: true },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const { enrollmentId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId);
    // Contre-cas : copie du modèle posée au verrou d'un ancien essai (SEQ-090), sur un autre candidat.
    const stale = await enroll(org, seq.sequenceId, org.owner.userId, accountId);
    const xStale = await schedule(org, stale.enrollmentId, seq.steps[0], {
      final_message: template, tracking_data: { content_origin: 'template_snapshot' },
    });
    const x = await schedule(org, enrollmentId, seq.steps[0]);

    // Premier passage : les deux étapes sont reportées.
    const from = Date.now();
    await cycle();
    const to = Date.now();
    expectDeferred(await execRow(x), from, to, 'avant relecture');
    const staleRow = await execRow(xStale);
    expectDeferred(staleRow, from, to, 'copie périmée du modèle');
    expect(staleRow.tracking_data?.content_origin, 'marqueur de copie retiré').toBeUndefined();
    expect(await postsOf(accountId), 'rien ne part avant la relecture').toEqual([]);

    // « Relire le message » du Journal : écriture du navigateur sur l'étape encore programmée.
    const corrected = `Bonjour Camille, je reviens vers vous au sujet du poste de Lead Backend (${rand()}).`;
    const saved = await rest('PATCH', `sequence_step_executions?id=eq.${x}&status=eq.scheduled`, token, {
      final_message: corrected, final_subject: null,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(Array.isArray(saved.body) ? saved.body.length : 0, 'une ligne écrite par le propriétaire').toBe(1);

    // L'heure de report écoulée, un passage : le texte corrigé part, la copie périmée est de nouveau reportée.
    const from2 = Date.now();
    await makeDue(x);
    await makeDue(xStale);
    await cycle();
    const to2 = Date.now();
    const sent = await execRow(x);
    expect(sent.status, 'texte corrigé : parti').toBe('sent');
    expect(sent.final_message, 'texte figé tel quel').toBe(corrected);
    expect(await sentTexts(accountId), 'le faux LinkedIn reçoit le texte corrigé, et lui seul').toEqual([corrected]);
    expectDeferred(await execRow(xStale), from2, to2, 'copie périmée, second passage');
    expect(await aiCallsWith(marker), 'aucun appel au faux modèle').toEqual([]);
    expect((await enrollmentFull(enrollmentId)).status).toBe('active');
    await expectEnrollmentUntouched(stale.enrollmentId, 0, 'copie périmée');
  });
});

// ═══ 4. Reprise et relance sur une étape IA ═════════════════════════════════

test.describe('Lot 5a-2 : garde du moteur, reprise et relance', () => {
  test("reprise (resume_enrollments) sur une étape IA : étape gardée ou réarmée, puis reportée au passage suivant, rien ne part", async () => {
    const { org, accountId } = await sendingOrgTracked('E2E 5a2 Reprise');
    const token = await tokenOf(org.owner);
    const marker = `MQ5A2${rand()}${rand()}`;
    const seq = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: `Bonjour {{prenom}}, ${marker}`, use_ai_personalization: true },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    // (a) pause manuelle, étape IA gardée en attente avec sa date.
    const kept = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'manual' });
    const xKept = await schedule(org, kept.enrollmentId, seq.steps[0], { scheduled_at: minutesFromNow(DAY / 60_000) });
    // (b) pause manuelle, étape IA annulée par « Arrêt manuel » (réarmée par la reprise).
    const rearmed = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'manual' });
    const xRearmed = await schedule(org, rearmed.enrollmentId, seq.steps[0], {
      status: 'cancelled', skip_reason: 'Arrêt manuel', scheduled_at: minutesFromNow(-60), created_at: minutesFromNow(-DAY / 60_000),
    });

    const res = await callFunction('process-sequences', token, {
      action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [kept.enrollmentId, rearmed.enrollmentId],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const outcomes = (res.body.results as Array<{ enrollment_id: string; outcome: string }> | undefined) ?? [];
    expect(outcomes.find((r) => r.enrollment_id === kept.enrollmentId)?.outcome).toBe('resumed');
    expect(outcomes.find((r) => r.enrollment_id === rearmed.enrollmentId)?.outcome).toBe('resumed');
    expect((await execRow(xRearmed)).status, 'étape annulée par la pause réarmée').toBe('scheduled');

    const from = Date.now();
    await makeDue(xKept);
    await makeDue(xRearmed);
    await cycle();
    const to = Date.now();
    expectDeferred(await execRow(xKept), from, to, 'reprise, étape gardée');
    expectDeferred(await execRow(xRearmed), from, to, 'reprise, étape réarmée');
    await expectEnrollmentUntouched(kept.enrollmentId, 0, 'reprise, étape gardée');
    await expectEnrollmentUntouched(rearmed.enrollmentId, 0, 'reprise, étape réarmée');
    expect(await mockCalls(accountId), 'journal LinkedIn du compte vide').toEqual([]);
    expect(await aiCallsWith(marker), 'aucun appel au faux modèle').toEqual([]);
    expect(await sequenceActive(seq.sequenceId)).toBe(true);
  });

  test("relance (re_enroll) vers une étape IA : étape suivante planifiée, puis reportée au passage suivant, rien ne part", async () => {
    const { org, accountId } = await sendingOrgTracked('E2E 5a2 Relance');
    const token = await tokenOf(org.owner);
    const marker = `MQ5A2${rand()}${rand()}`;
    const seq = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: `Relance {{prenom}}, ${marker}`, use_ai_personalization: true },
    ]);
    const past = (days: number) => minutesFromNow(-days * DAY / 60_000);
    // Candidat qui a répondu, et inscription arrêtée : le premier message était parti.
    const replied = await enroll(org, seq.sequenceId, org.owner.userId, accountId, {
      status: 'replied', replied_at: past(1), current_step_order: 1,
    });
    const stopped = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { status: 'stopped', current_step_order: 1 });
    for (const e of [replied, stopped]) {
      await schedule(org, e.enrollmentId, seq.steps[0], {
        status: 'sent', scheduled_at: past(2), executed_at: past(2), created_at: past(2), final_message: 'Bonjour',
      });
      await schedule(org, e.enrollmentId, seq.steps[1], {
        status: 'cancelled', skip_reason: 'Clôture e2e', scheduled_at: past(1), created_at: past(2),
      });
    }

    const res = await callFunction('process-sequences', token, {
      action: 're_enroll', organization_id: org.orgId, enrollment_ids: [replied.enrollmentId, stopped.enrollmentId],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const outcomes = (res.body.results as Array<{ enrollment_id: string; outcome: string }> | undefined) ?? [];
    const pending: string[] = [];
    for (const e of [replied, stopped]) {
      expect(outcomes.find((r) => r.enrollment_id === e.enrollmentId)?.outcome).toBe('resumed');
      const next = (await execsOf(e.enrollmentId)).filter((x) => x.status === 'scheduled');
      expect(next, "une étape en attente : l'étape IA").toHaveLength(1);
      expect(next[0].step_order).toBe(1);
      pending.push(next[0].id);
    }

    const from = Date.now();
    for (const id of pending) await makeDue(id);
    await cycle();
    const to = Date.now();
    for (const [i, e] of [replied, stopped].entries()) {
      const label = i === 0 ? 'relance après réponse' : 'relance après arrêt';
      expectDeferred(await execRow(pending[i]), from, to, label);
      await expectEnrollmentUntouched(e.enrollmentId, 1, label);
    }
    expect(await postsOf(accountId), 'rien ne part : ni le modèle brut, ni le premier message').toEqual([]);
    expect(await sentTexts(accountId)).toEqual([]);
    expect(await aiCallsWith(marker), 'aucun appel au faux modèle').toEqual([]);
    expect(await ledgerCount(accountId), 'aucune ligne au journal du plafond').toBe(0);
  });
});

// ═══ 5. Étape IA ajoutée à une séquence qui a des inscrits ═════════════════

test.describe('Lot 5a-2 : garde du moteur, étape IA ajoutée', () => {
  test("étape IA ajoutée par save_sequence_steps à une séquence qui a déjà un inscrit : le premier message part, l'étape IA est reportée au passage suivant", async () => {
    const { org, accountId } = await sendingOrgTracked('E2E 5a2 Étape ajoutée');
    const token = await tokenOf(org.owner);
    const marker = `MQ5A2${rand()}${rand()}`;
    const seq = await insertSequence(org, org.owner.userId, [{ action_type: 'message', message_template: 'Bonjour' }]);
    const { enrollmentId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId);
    const x0 = await schedule(org, enrollmentId, seq.steps[0], { scheduled_at: minutesFromNow(120) });

    // L'éditeur enregistre la séquence avec une relance rédigée par l'IA.
    const saved = await rest('POST', 'rpc/save_sequence_steps', token, {
      p_sequence_id: seq.sequenceId,
      p_steps: [
        { id: seq.steps[0].id, step_order: 0, action_type: 'message', message_template: 'Bonjour', delay_days: 0 },
        {
          id: `nouvelle-${rand()}`, step_order: 1, action_type: 'message', delay_days: 0,
          message_template: `Relance {{prenom}}, ${marker}`, use_ai_personalization: true,
        },
      ],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const savedSteps = saved.body as Array<{ id: string; step_order: number; use_ai_personalization: boolean }>;
    expect(savedSteps.map((s) => [s.step_order, s.use_ai_personalization])).toEqual([[0, false], [1, true]]);

    // Le premier message part ; l'étape IA est planifiée.
    await makeDue(x0);
    await cycle();
    expect((await execRow(x0)).status, 'premier message parti').toBe('sent');
    expect(await sentTexts(accountId)).toEqual(['Bonjour']);
    const next = (await execsOf(enrollmentId)).filter((e) => e.step_order === 1);
    expect(next, "l'étape IA ajoutée est planifiée").toHaveLength(1);
    expect(next[0].status).toBe('scheduled');
    expect(next[0].step_id).toBe(savedSteps[1].id);

    // Passage suivant, l'étape IA due : reportée, rien de plus ne part.
    const from = Date.now();
    await makeDue(next[0].id);
    await cycle();
    const to = Date.now();
    expectDeferred(await execRow(next[0].id), from, to, 'étape IA ajoutée');
    await expectEnrollmentUntouched(enrollmentId, 1, 'étape IA ajoutée');
    expect(await sentTexts(accountId), 'seul le premier message est parti').toEqual(['Bonjour']);
    expect(await aiCallsWith(marker), 'aucun appel au faux modèle').toEqual([]);
    expect(await sequenceActive(seq.sequenceId)).toBe(true);
  });
});

// ═══ 6. Plafond LinkedIn ════════════════════════════════════════════════════

test.describe('Lot 5a-2 : garde du moteur, plafond LinkedIn', () => {
  test("aucune place du plafond LinkedIn consommée par des étapes IA reportées (message, InMail, Message IA) ; le témoin d'un autre compte est compté", async () => {
    const { org, accountId } = await sendingOrgTracked('E2E 5a2 Plafond');
    const member = await addMember(org.orgId, 'member', 'temoin');
    const witnessAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_${rand()}`, 'OK');
    orgsToDelete[orgsToDelete.length - 1].extra.push(member);
    orgsToDelete[orgsToDelete.length - 1].accounts.push(witnessAccount);
    const token = await tokenOf(org.owner);
    const marker = `MQ5A2${rand()}${rand()}`;

    const aiSequences = await Promise.all([
      insertSequence(org, org.owner.userId, [
        { action_type: 'message', message_template: `Bonjour {{prenom}}, ${marker}`, use_ai_personalization: true },
      ]),
      insertSequence(org, org.owner.userId, [
        { action_type: 'inmail', subject_template: 'Un poste pour vous', message_template: `Bonjour {{prenom}}, ${marker}`, use_ai_personalization: true },
      ]),
      insertSequence(org, org.owner.userId, [
        { action_type: 'smart_message', message_template: `Bonjour {{prenom}}, ${marker}`, use_ai_personalization: true },
      ]),
    ]);
    const witnessSeq = await insertSequence(org, member.userId, [{ action_type: 'message', message_template: 'Bonjour, message témoin' }]);
    const aiEnrollments: Array<{ enrollmentId: string; profileId: string }> = [];
    for (const s of aiSequences) aiEnrollments.push(await enroll(org, s.sequenceId, org.owner.userId, accountId));
    const witness = await enroll(org, witnessSeq.sequenceId, member.userId, witnessAccount);

    const quotaBefore = await quotaStatus(token, accountId);
    const witnessBefore = await quotaStatus(token, witnessAccount);
    expect(await ledgerCount(accountId)).toBe(0);

    const aiExecs: string[] = [];
    for (const [i, e] of aiEnrollments.entries()) aiExecs.push(await schedule(org, e.enrollmentId, aiSequences[i].steps[0]));
    const xWitness = await schedule(org, witness.enrollmentId, witnessSeq.steps[0]);
    const from = Date.now();
    await cycle();
    const to = Date.now();

    const labels = ['message IA', 'InMail IA', 'Message IA (smart_message)'];
    for (const [i, x] of aiExecs.entries()) expectDeferred(await execRow(x), from, to, labels[i]);
    for (const e of aiEnrollments) await expectEnrollmentUntouched(e.enrollmentId, 0, 'plafond');

    expect(await ledgerCount(accountId), 'aucune place réservée au journal du plafond').toBe(0);
    const quotaAfter = await quotaStatus(token, accountId);
    expect(quotaAfter.today, 'compteurs du jour inchangés').toEqual(quotaBefore.today);
    expect(quotaAfter.week, 'invitations de la semaine inchangées').toEqual(quotaBefore.week);
    expect(await mockCalls(accountId), 'ni envoi, ni lecture du solde InMail, ni lecture de profil').toEqual([]);
    expect(await aiCallsWith(marker), 'aucun appel au faux modèle').toEqual([]);

    // Témoin : le même passage envoie un message simple depuis l'autre compte, compté au plafond.
    expect((await execRow(xWitness)).status, 'message témoin parti').toBe('sent');
    expect(await sentTexts(witnessAccount)).toEqual(['Bonjour, message témoin']);
    const witnessAfter = await quotaStatus(token, witnessAccount);
    expect(witnessAfter.today.visible_actions, 'le témoin occupe une place du plafond').toBe(witnessBefore.today.visible_actions + 1);
  });
});

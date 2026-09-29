/**
 * Décisions produit du lot moteur (docs/audit-2026-09-25-sequences.md,
 * « Décisions produit en attente », recommandations retenues) :
 *   1. un envoi incertain ne compte pas dans le taux d'échec de l'auto-pause ;
 *   2. une lecture de profil impossible à « Vérifier la connexion » non plus ;
 *   3. une étape arrêtée après le gate quota sans rien envoyer rend sa place du plafond LinkedIn ;
 *   4. rotation au plafond : report au lendemain dans le fuseau et à l'heure de début du titulaire ;
 *   5. une boucle qui revient sur une étape déjà partie termine l'inscription ;
 *   7. un refus 403 à la vérification de réponse garde la date et le compteur d'essais de l'étape ;
 *   9. la scrutation de secours examine les inscriptions terminées depuis moins de 14 jours ;
 *  22. un seul envoi par personne et par cycle, toutes identités confondues ;
 *  25. un rendez-vous pris avant le début de l'inscription ne l'arrête pas ;
 *  26. la clôture par rendez-vous du moteur écrit meeting_booked et prévient le recruteur ;
 *  28. l'étape arrêtée par une condition d'arrêt est « annulée » ;
 *  30. reprise d'une inscription dont toutes les étapes sont parties : « terminée » ;
 *  35. la reprise groupée par séquence refuse une séquence désactivée.
 * (Décision 6 : aucun changement de comportement, contrat écrit dans CLAUDE.md.)
 *
 * Le moteur process-sequences tourne pour de vrai contre la stack locale
 * (e2e/local-stack) ; LinkedIn et l'IA sont simulés par vendor-mock.mjs, qui
 * journalise chaque appel. Ignoré sans cette stack. `force: true` lève la
 * fenêtre d'envoi (jours ouvrés 8 h-19 h).
 */
import { createHash } from 'node:crypto';
import { test, expect, request } from '@playwright/test';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  candidateRowState,
  deleteOrg,
  seedCandidateRow,
  seedLinkedInAccount,
  seedMission,
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
  sentInvites,
  sentTexts,
  setMockMode,
  type MockCall,
  type MockRoute,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const mockedAccounts: string[] = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];
const track = (org: TestOrg, extra: TestUser[] = []) => { orgsToDelete.push({ org, extra }); return org; };

test.afterEach(async () => {
  while (mockedAccounts.length) await setMockMode(mockedAccounts.pop()!, {}).catch(() => undefined);
  while (cleanups.length) {
    const cleanup = cleanups.pop()!;
    try { await cleanup(); } catch { /* nettoyage au mieux */ }
  }
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    for (const table of ['member_quotas', 'notifications', 'qualification_sessions', 'job_candidate_status']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});

// ─── Aides ──────────────────────────────────────────────────────────────────

const DAY = 24 * 3600_000;
const daysAgo = (d: number) => minutesFromNow(-d * 24 * 60);
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/** Action du moteur avec le secret du cron, délai de requête long, réessai tant que le verrou est pris. */
async function engine(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const ctx = await request.newContext();
    const res = await ctx.post(`${E2E.supabaseUrl}/functions/v1/process-sequences`, {
      headers: { apikey: E2E.anonKey, Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
      data: body,
      timeout: 150_000,
    });
    const status = res.status();
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    await ctx.dispose();
    expect(status, JSON.stringify(json)).toBe(200);
    if (json.skipped_reason !== 'lock_held') return json;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('verrou du moteur jamais libéré');
}

const cycle = () => engine({ action: 'process', force: true });

async function mock(accountId: string, mode: { routes?: MockRoute[]; [k: string]: unknown }) {
  mockedAccounts.push(accountId);
  await setMockMode(accountId, mode);
}

interface StepSpec {
  action_type: string;
  step_order?: number;
  message_template?: string | null;
  subject_template?: string | null;
  delay_days?: number;
  timeout_days?: number | null;
  use_ai_personalization?: boolean;
}

/** Séquence et étapes insérées une à une (ordre garanti). */
async function insertSequence(org: TestOrg, createdBy: string, specs: StepSpec[], extra: Record<string, unknown> = {}) {
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({ name: `Séquence décisions ${rand()}`, organization_id: org.orgId, created_by: createdBy, is_active: true, ...extra })
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
    if (stepErr || !data) throw new Error(`insertSequence(step ${i}): ${stepErr?.message}`);
    steps.push(data as SeededStep);
  }
  return { sequenceId: seq.id as string, steps };
}

async function patchStep(stepId: string, patch: Record<string, unknown>) {
  const { error } = await admin().from('sequence_steps').update(patch).eq('id', stepId);
  if (error) throw new Error(`patchStep: ${error.message}`);
}

async function sendingOrgTracked(prefix: string) {
  const res = await sendingOrg(prefix);
  track(res.org);
  return res;
}

/** Organisation qui envoie, avec `n` comptes LinkedIn reliés : propriétaire, puis un membre par compte. */
async function orgWithAccounts(prefix: string, n: number) {
  const { org, accountId } = await sendingOrg(prefix);
  const users: TestUser[] = [org.owner];
  const accounts: string[] = [accountId];
  const members: TestUser[] = [];
  for (let i = 1; i < n; i++) {
    const member = await addMember(org.orgId, 'member', `dec${i}`);
    members.push(member);
    users.push(member);
    accounts.push(await seedLinkedInAccount(org.orgId, member.userId, `acc_${rand()}`, 'OK'));
  }
  track(org, members);
  return { org, users, accounts };
}

interface ExecFull {
  id: string; step_id: string; step_order: number; status: string; scheduled_at: string; executed_at: string | null;
  skip_reason: string | null; error_message: string | null; retry_count: number | null;
}
const EXEC_COLUMNS = 'id, step_id, step_order, status, scheduled_at, executed_at, skip_reason, error_message, retry_count';

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

const PENDING = ['scheduled', 'waiting_event', 'quota_blocked', 'sending'];

async function enrollmentFull(id: string) {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('id, status, pause_reason, completed_at, replied_at, last_check_at, tracking_data')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`enrollmentFull ${id}: ${error?.message}`);
  return data as {
    id: string; status: string; pause_reason: string | null; completed_at: string | null; replied_at: string | null;
    last_check_at: string | null; tracking_data: Record<string, unknown> | null;
  };
}

async function sequenceActive(id: string): Promise<boolean> {
  const { data } = await admin().from('outreach_sequences').select('is_active').eq('id', id).single();
  return (data as { is_active: boolean }).is_active;
}

/** Lignes du journal des actions LinkedIn (plafond) pour un compte et un type. */
async function ledgerCount(accountId: string, actionType: string): Promise<number> {
  const { count, error } = await admin().from('linkedin_action_log').select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('action_type', actionType);
  if (error) throw new Error(`ledgerCount: ${error.message}`);
  return count ?? 0;
}

async function postsOf(accountId: string): Promise<MockCall[]> {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST');
}

/** Conversation scriptable pour le compte : identifiant qui transporte account_id dans l'URL du moteur. */
function scriptedChat(accountId: string) {
  const base = `chat${rand()}${rand()}`;
  return { id: `${base}?account_id=${accountId}&c=`, path: `^/api/v1/chats/${base}$` };
}
const chatListRoute = (chatId: string): MockRoute => ({
  method: 'GET', path: '^/api/v1/chat_attendees/[^/]+/chats$',
  body: { object: 'ChatList', items: [{ id: chatId }], cursor: null },
});
const candidateReplyRoute = (chatPath: string, at: string): MockRoute => ({
  method: 'GET', path: chatPath,
  body: { object: 'MessageList', cursor: null, items: [{ id: `m_${rand()}`, is_sender: 0, text: 'Oui, avec plaisir', timestamp: at }] },
});

/** Date et heure murales dans un fuseau. */
function localParts(d: Date | string, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(d));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    hour: Number(get('hour')) % 24, minute: Number(get('minute')),
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    y: Number(get('year')), m: Number(get('month')), d: Number(get('day')),
  };
}

/** Date locale (AAAA-MM-JJ) de `from` avancée de `days` jours du calendrier local. */
function localYmdPlus(from: Date, tz: string, days: number): string {
  const p = localParts(from, tz);
  return new Date(Date.UTC(p.y, p.m - 1, p.d + days)).toISOString().slice(0, 10);
}

async function tokenOf(user: TestUser): Promise<string> {
  return (await signIn(user.email, user.password)).access_token as string;
}

async function insertMeeting(orgId: string, createdBy: string, fields: Record<string, unknown>) {
  const { data, error } = await admin().from('qualification_sessions').insert({
    organization_id: orgId, created_by: createdBy, calendly_event_id: `evt_dec_${rand()}${rand()}`, status: 'scheduled', ...fields,
  }).select('id').single();
  if (error || !data) throw new Error(`qualification_sessions: ${error?.message}`);
  return data.id as string;
}

const UNCERTAIN = 'Envoi incertain : vérifiez la conversation avant de relancer';
const EMPTY_TEXT_ERROR = "Message vide : rien n'a été envoyé. Complétez le texte de l'étape puis relancez-la.";
const ROTATION_EXHAUSTED = 'Tous les expéditeurs ont atteint leur limite du jour';
const MEETING_STOP = 'Stop condition: meeting booked (Calendly)';
const UNSUB_STOP = 'Stop condition: unsubscribed';

// ═══ Décisions 1 et 2 : auto-pause ══════════════════════════════════════════

test.describe('Décisions 1 et 2 : pannes passagères hors auto-pause', () => {
  test('décision 1 : cinq envois incertains (502 après l’envoi) sur cinq comptes ne désactivent pas la séquence', async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E D1 Incertain', 5);
    const seq = await insertSequence(org, users[0].userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    for (const acc of accounts) {
      await mock(acc, { routes: [{ method: 'POST', path: '^/api/v1/chats$', status: 502, body: { title: 'Bad Gateway' } }] });
    }
    const enrs: string[] = [];
    for (let i = 0; i < 5; i++) enrs.push((await enroll(org, seq.sequenceId, users[i].userId, accounts[i])).enrollmentId);
    const execs: string[] = [];
    for (const id of enrs) execs.push(await schedule(org, id, seq.steps[0]));

    await cycle();

    for (const x of execs) {
      const row = await execRow(x);
      expect(row.status).toBe('failed');
      expect(row.error_message ?? '').toMatch(new RegExp(`^${UNCERTAIN}`));
    }
    for (const acc of accounts) expect((await postsOf(acc)).filter((c) => c.path === '/api/v1/chats'), 'un seul envoi par compte').toHaveLength(1);
    expect(await sequenceActive(seq.sequenceId), 'envois incertains : séquence toujours active').toBe(true);
    for (const id of enrs) {
      const enr = await enrollmentFull(id);
      expect({ status: enr.status, pause_reason: enr.pause_reason }).toEqual({ status: 'active', pause_reason: null });
    }
    const { data: notifs } = await admin().from('notifications').select('id')
      .eq('organization_id', org.orgId).eq('metadata->>source', 'sequence_auto_pause');
    expect(notifs ?? [], 'aucune notification d’auto-pause').toEqual([]);
  });

  test('décision 2 : cinq « Vérifier la connexion » dont la lecture du profil reste impossible après trois essais : échecs, séquence active', async () => {
    const { org, accountId } = await sendingOrgTracked('E2E D2 Lecture profil');
    await mock(accountId, { routes: [{ method: 'GET', path: '^/api/v1/users/', status: 503, body: { title: 'Service Unavailable' } }] });
    const seq = await insertSequence(org, org.owner.userId, [
      { action_type: 'check_connection' },
      { action_type: 'message', message_template: 'Relance', delay_days: 2 },
    ]);
    const execs: string[] = [];
    for (let i = 0; i < 5; i++) {
      const e = await enroll(org, seq.sequenceId, org.owner.userId, accountId);
      execs.push(await schedule(org, e.enrollmentId, seq.steps[0], { retry_count: 3 }));
    }

    const res = await cycle();

    for (const x of execs) {
      const row = await execRow(x);
      expect(row.status).toBe('failed');
      expect(row.error_message ?? '').toMatch(/^profile_read_unavailable/);
    }
    expect(Number((res.results as Record<string, number>).failed)).toBeGreaterThanOrEqual(5);
    expect(await sequenceActive(seq.sequenceId), 'lecture impossible : séquence toujours active').toBe(true);
  });
});

// ═══ Décision 3 : place du plafond rendue ═══════════════════════════════════

test.describe('Décision 3 : une étape arrêtée sans rien envoyer ne consomme pas le plafond LinkedIn', () => {
  test('invitation à une relation directe, message vide, rédaction IA indisponible, étape déjà envoyée : aucune ligne au journal ; le témoin envoyé en laisse une', async () => {
    // Invitation à un candidat déjà en relation (lecture du profil : premier degré).
    const { org: oC, accountId: accC } = await sendingOrgTracked('E2E D3 Relation');
    const sC = await insertSequence(oC, oC.owner.userId, [
      { action_type: 'connection_request' },
      { action_type: 'message', message_template: 'Merci', delay_days: 3 },
    ]);
    const eC = await enroll(oC, sC.sequenceId, oC.owner.userId, accC);

    // Message sans texte.
    const { org: oE, accountId: accE } = await sendingOrgTracked('E2E D3 Vide');
    const sE = await insertSequence(oE, oE.owner.userId, [
      { action_type: 'message', message_template: '' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const eE = await enroll(oE, sE.sequenceId, oE.owner.userId, accE);

    // Rédaction IA refusée (crédits IA épuisés).
    const { org: oA, accountId: accA } = await sendingOrgTracked('E2E D3 IA');
    const { error: balErr } = await admin().from('ai_credit_balances').upsert({
      organization_id: oA.orgId, plan_credits: 0, topup_credits: 0, credits_remaining: 0, credits_total: 0,
      period_start: new Date(Date.now() - DAY).toISOString(), period_end: new Date(Date.now() + 30 * DAY).toISOString(),
    }, { onConflict: 'organization_id' });
    expect(balErr).toBeNull();
    cleanups.push(() => admin().from('ai_credit_balances').delete().eq('organization_id', oA.orgId));
    const sA = await insertSequence(oA, oA.owner.userId, [
      { action_type: 'message', message_template: 'Modèle {{prenom}}', use_ai_personalization: true },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const eA = await enroll(oA, sA.sequenceId, oA.owner.userId, accA);

    // Seconde exécution d'une étape déjà partie (réarmée hors du moteur).
    const { org: oD, accountId: accD } = await sendingOrgTracked('E2E D3 Déjà partie');
    const sD = await insertSequence(oD, oD.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const eD = await enroll(oD, sD.sequenceId, oD.owner.userId, accD);
    await schedule(oD, eD.enrollmentId, sD.steps[0], { status: 'sent', scheduled_at: daysAgo(1), executed_at: daysAgo(1), final_message: 'Bonjour' });

    // Témoin : un message qui part.
    const { org: oS, accountId: accS } = await sendingOrgTracked('E2E D3 Témoin');
    const sS = await insertSequence(oS, oS.owner.userId, [{ action_type: 'message', message_template: 'Bonjour témoin' }]);
    const eS = await enroll(oS, sS.sequenceId, oS.owner.userId, accS);

    const xC = await schedule(oC, eC.enrollmentId, sC.steps[0]);
    const xE = await schedule(oE, eE.enrollmentId, sE.steps[0]);
    const xA = await schedule(oA, eA.enrollmentId, sA.steps[0]);
    const xD = await schedule(oD, eD.enrollmentId, sD.steps[0]);
    const xS = await schedule(oS, eS.enrollmentId, sS.steps[0]);
    await cycle();

    const rC = await execRow(xC);
    expect(rC.status).toBe('skipped');
    expect(rC.skip_reason).toBe('Déjà en relation : invitation inutile');
    expect(await sentInvites(accC)).toEqual([]);
    const rE = await execRow(xE);
    expect(rE.status).toBe('failed');
    expect(rE.error_message).toBe(EMPTY_TEXT_ERROR);
    const rA = await execRow(xA);
    expect(rA.status, 'rédaction IA refusée : nouvel essai').toBe('scheduled');
    expect(rA.retry_count).toBe(1);
    const rD = await execRow(xD);
    expect(rD.status).toBe('skipped');
    expect(rD.skip_reason).toBe('Étape déjà envoyée');
    expect((await execRow(xS)).status).toBe('sent');
    for (const acc of [accE, accA, accD]) expect(await postsOf(acc), 'rien n’est envoyé').toEqual([]);

    expect(await ledgerCount(accC, 'connection_request'), 'invitation inutile : place rendue').toBe(0);
    expect(await ledgerCount(accE, 'message'), 'message vide : place rendue').toBe(0);
    expect(await ledgerCount(accA, 'message'), 'IA indisponible : place rendue').toBe(0);
    expect(await ledgerCount(accD, 'message'), 'étape déjà envoyée : aucune place prise').toBe(0);
    expect(await ledgerCount(accS, 'message'), 'témoin envoyé : exactement une ligne').toBe(1);
  });
});

// ═══ Décision 4 : rotation au plafond ═══════════════════════════════════════

test.describe('Décision 4 : rotation au plafond, report selon le titulaire', () => {
  test('tous les expéditeurs au plafond : étape bloquée jusqu’au lendemain 10 h à New York, fuseau et heure de début du titulaire (l’inscription est à Paris)', async () => {
    const ny = 'America/New_York';
    const { org, users, accounts } = await orgWithAccounts('E2E D4 Rotation', 2);
    const [accA, accB] = accounts;
    const { error: mqErr } = await admin().from('member_quotas').insert({
      organization_id: org.orgId, user_id: users[0].userId, timezone: ny, business_hours_start: 10, business_hours_end: 18,
    });
    expect(mqErr).toBeNull();
    const seq = await insertSequence(org, users[0].userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ], {
      multi_sender_enabled: true,
      rotation_mode: 'round_robin',
      sender_accounts: [
        { account_id: accA, daily_limit: 1, channel: 'linkedin' },
        { account_id: accB, daily_limit: 1, channel: 'linkedin' },
      ],
    });
    // Une action envoyée aujourd'hui par chaque expéditeur : limite du jour atteinte.
    const nowIso = new Date().toISOString();
    const x = await enroll(org, seq.sequenceId, users[0].userId, accA, { assigned_sender_id: accA, current_step_order: 1 });
    const y = await enroll(org, seq.sequenceId, users[1].userId, accB, { assigned_sender_id: accB, current_step_order: 1 });
    await schedule(org, x.enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: nowIso, executed_at: nowIso });
    await schedule(org, y.enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: nowIso, executed_at: nowIso });
    const z = await enroll(org, seq.sequenceId, users[0].userId, accA, { user_timezone: 'Europe/Paris' });
    const xz = await schedule(org, z.enrollmentId, seq.steps[0]);
    const before = new Date();

    await cycle();

    const rz = await execRow(xz);
    expect(rz.status).toBe('quota_blocked');
    expect(rz.skip_reason).toBe(ROTATION_EXHAUSTED);
    const at = localParts(rz.scheduled_at, ny);
    expect(at.ymd, 'lendemain dans le fuseau du titulaire').toBe(localYmdPlus(before, ny, 1));
    expect([at.hour, at.minute], 'heure de début du titulaire (10 h)').toEqual([10, 0]);
    expect(await postsOf(accA)).toEqual([]);
    expect(await postsOf(accB)).toEqual([]);
  });
});

// ═══ Décisions 5 et 30 : boucles ════════════════════════════════════════════

test.describe('Décisions 5 et 30 : boucle vers une étape déjà partie', () => {
  test('décision 5 : repli de délai vers une étape déjà envoyée, inscription terminée sans nouvelle exécution ; avec une autre étape en attente, rien n’est clos', async () => {
    const { org, accountId } = await sendingOrgTracked('E2E D5 Repli');
    const { sequenceId, steps } = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'A' },
      { action_type: 'wait_reply', timeout_days: 1 },
      { action_type: 'message', message_template: 'C', delay_days: 5 },
    ]);
    await patchStep(steps[1].id, { timeout_branch_step_id: steps[0].id });
    const loop = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, loop.enrollmentId, steps[0], { status: 'sent', scheduled_at: daysAgo(3), executed_at: daysAgo(3), final_message: 'A' });
    const wait = await schedule(org, loop.enrollmentId, steps[1], { status: 'waiting_event', scheduled_at: daysAgo(2) });
    // Même situation, mais une autre étape est encore en attente (planification tardive).
    const busy = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, busy.enrollmentId, steps[0], { status: 'sent', scheduled_at: daysAgo(3), executed_at: daysAgo(3), final_message: 'A' });
    const busyWait = await schedule(org, busy.enrollmentId, steps[1], { status: 'waiting_event', scheduled_at: daysAgo(2) });
    const busyPending = await schedule(org, busy.enrollmentId, steps[2], { scheduled_at: minutesFromNow(3 * 24 * 60) });

    for (let i = 0; i < 3; i++) {
      await engine({ action: 'check_timeouts' });
      const rows = await Promise.all([execRow(wait), execRow(busyWait)]);
      if (rows.every((r) => r.status !== 'waiting_event')) break;
    }

    expect((await execRow(wait)).status, 'attente expirée').toBe('skipped');
    expect((await execsOf(loop.enrollmentId)).filter((e) => e.step_id === steps[0].id).map((e) => e.status), 'A jamais replanifiée').toEqual(['sent']);
    const closed = await enrollmentFull(loop.enrollmentId);
    expect(closed.status, 'boucle vers une étape partie : inscription terminée').toBe('completed');
    expect(closed.completed_at).not.toBeNull();

    expect((await execRow(busyWait)).status).toBe('skipped');
    expect((await execsOf(busy.enrollmentId)).filter((e) => e.step_id === steps[0].id).map((e) => e.status)).toEqual(['sent']);
    expect((await enrollmentFull(busy.enrollmentId)).status, 'autre étape en attente : inscription laissée active').toBe('active');
    expect((await execRow(busyPending)).status).toBe('scheduled');
    expect(await sentTexts(accountId), 'aucun renvoi').toEqual([]);
  });

  test('décision 5 : boucle next_step_id A→B→A, B part puis l’inscription est terminée, A jamais renvoyé', async () => {
    const { org, accountId } = await sendingOrgTracked('E2E D5 Chaîne');
    const { sequenceId, steps } = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'A' },
      { action_type: 'message', message_template: 'B' },
    ]);
    await patchStep(steps[0].id, { next_step_id: steps[1].id });
    await patchStep(steps[1].id, { next_step_id: steps[0].id });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: daysAgo(3), executed_at: daysAgo(3), final_message: 'A' });
    const execB = await schedule(org, enrollmentId, steps[1]);

    await cycle();

    expect((await execRow(execB)).status).toBe('sent');
    expect(await sentTexts(accountId)).toEqual(['B']);
    expect((await enrollmentFull(enrollmentId)).status).toBe('completed');
    expect((await execsOf(enrollmentId)).filter((e) => PENDING.includes(e.status)), 'rien en attente').toEqual([]);
  });

  test('décision 30 : « Reprendre » une inscription en pause dont toutes les étapes sont parties (boucle) la passe « terminée », rien ne part', async () => {
    const { org, accountId } = await sendingOrgTracked('E2E D30 Reprise');
    const { sequenceId, steps } = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'A' },
      { action_type: 'message', message_template: 'B', delay_days: 2 },
    ]);
    await patchStep(steps[0].id, { next_step_id: steps[1].id });
    await patchStep(steps[1].id, { next_step_id: steps[0].id });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'manual', current_step_order: 2 });
    await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: daysAgo(5), executed_at: daysAgo(5), created_at: daysAgo(5), final_message: 'A' });
    await schedule(org, enrollmentId, steps[1], { status: 'sent', scheduled_at: daysAgo(2), executed_at: daysAgo(2), created_at: daysAgo(2), final_message: 'B' });

    const res = await callFunction('process-sequences', await tokenOf(org.owner), {
      action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [enrollmentId],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const result = (res.body.results as Array<{ enrollment_id: string; outcome: string }>).find((r) => r.enrollment_id === enrollmentId);
    expect(result?.outcome).toBe('nothing_to_resume');
    const enr = await enrollmentFull(enrollmentId);
    expect(enr.status, 'séquence finie pour ce candidat : terminée').toBe('completed');
    expect((await execsOf(enrollmentId)).filter((e) => PENDING.includes(e.status))).toEqual([]);
    await cycle();
    expect(await sentTexts(accountId)).toEqual([]);
  });
});

// ═══ Décision 7 : refus 403 ═════════════════════════════════════════════════

test.describe('Décision 7 : refus 403 à la vérification de réponse', () => {
  test('pause « blocked_by_candidate », l’étape gardée conserve sa date et son compteur d’essais', async () => {
    const { org, accountId } = await sendingOrgTracked('E2E D7 Bloqué');
    await mock(accountId, { routes: [{ method: 'GET', path: '^/api/v1/chat_attendees/[^/]+/chats$', status: 403, body: { title: 'forbidden' } }] });
    const { sequenceId, steps } = await insertSequence(org, org.owner.userId, [
      { action_type: 'connection_request' },
      { action_type: 'message', message_template: 'Relance', delay_days: 2 },
    ]);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: daysAgo(2), executed_at: daysAgo(2) });
    const dueAt = minutesFromNow(-5);
    const x = await schedule(org, enrollmentId, steps[1], { scheduled_at: dueAt, retry_count: 1 });

    await cycle();

    const enr = await enrollmentFull(enrollmentId);
    expect({ status: enr.status, pause_reason: enr.pause_reason }).toEqual({ status: 'paused', pause_reason: 'blocked_by_candidate' });
    const row = await execRow(x);
    expect(row.status, 'étape gardée').toBe('scheduled');
    expect(ms(row.scheduled_at), 'date inchangée').toBe(ms(dueAt));
    expect(row.retry_count, 'compteur d’essais inchangé').toBe(1);
    expect(row.error_message).toBeNull();
    expect(await postsOf(accountId)).toEqual([]);
  });
});

// ═══ Décision 9 : scrutation des inscriptions terminées ═════════════════════

/** check_replies (un passage toutes les 4 h, 20 inscriptions) jusqu'à ce que ces inscriptions aient été examinées. */
async function checkRepliesUntilExamined(...enrollmentIds: string[]) {
  for (let i = 0; i < 12; i++) {
    await admin().from('internal_config').delete().eq('key', 'last_check_replies');
    await engine({ action: 'check_replies' });
    const { data } = await admin().from('sequence_enrollments').select('id, last_check_at').in('id', enrollmentIds);
    if (((data ?? []) as Array<{ last_check_at: string | null }>).every((r) => !!r.last_check_at)) break;
  }
  await admin().from('internal_config').delete().eq('key', 'last_check_replies');
}

/** check_replies jusqu'à ce que ces inscriptions aient été examinées après `since` (last_check_at déjà renseigné au départ). */
async function checkRepliesUntilCheckedSince(since: string, ...enrollmentIds: string[]) {
  for (let i = 0; i < 12; i++) {
    await admin().from('internal_config').delete().eq('key', 'last_check_replies');
    await engine({ action: 'check_replies' });
    const { data } = await admin().from('sequence_enrollments').select('id, last_check_at').in('id', enrollmentIds);
    if (((data ?? []) as Array<{ last_check_at: string | null }>).every((r) => ms(r.last_check_at) >= ms(since))) break;
  }
  await admin().from('internal_config').delete().eq('key', 'last_check_replies');
}

/** Inscription terminée il y a `completedDaysAgo` jours, ses deux messages partis, et réponse du candidat simulée sur le compte. */
async function completedWithReply(
  org: TestOrg, seq: { sequenceId: string; steps: SeededStep[] }, userId: string, account: string,
  completedDaysAgo: number, extra: Record<string, unknown> = {},
) {
  const e = await enroll(org, seq.sequenceId, userId, account, {
    status: 'completed', completed_at: daysAgo(completedDaysAgo), current_step_order: 2, created_at: daysAgo(completedDaysAgo + 5), ...extra,
  });
  await schedule(org, e.enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: daysAgo(completedDaysAgo + 4), executed_at: daysAgo(completedDaysAgo + 4) });
  await schedule(org, e.enrollmentId, seq.steps[1], { status: 'sent', scheduled_at: daysAgo(completedDaysAgo + 1), executed_at: daysAgo(completedDaysAgo + 1) });
  const chat = scriptedChat(account);
  await mock(account, { routes: [chatListRoute(chat.id), candidateReplyRoute(chat.path, daysAgo(1))] });
  return e;
}

/** Lectures de conversations LinkedIn faites depuis ce compte. */
async function chatReads(accountId: string): Promise<number> {
  return (await mockCalls(accountId)).filter((c) => c.method === 'GET' && /\/chat/.test(c.path)).length;
}

async function repliesCounted(sequenceId: string): Promise<number> {
  const { data } = await admin().from('sequence_analytics').select('replies_received').eq('sequence_id', sequenceId);
  return ((data ?? []) as Array<{ replies_received: number | null }>).reduce((s, x) => s + (x.replies_received ?? 0), 0);
}

test.describe('Décision 9 : scrutation de secours des inscriptions terminées récemment', () => {
  test('terminée il y a 3 jours et réponse après la dernière relance : « répondu », réponse comptée, pipeline, sœur antérieure arrêtée ; au-delà de 14 jours ou close par un rendez-vous : non examinée', async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E D9 Terminées', 4);
    const [accRecent, accOld, accMeeting, accSibling] = accounts;
    const seq = await insertSequence(org, users[0].userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 2 },
    ]);
    const completedFixture = async (userIdx: number, account: string, completedDaysAgo: number, extra: Record<string, unknown> = {}) => {
      const e = await enroll(org, seq.sequenceId, users[userIdx].userId, account, {
        status: 'completed', completed_at: daysAgo(completedDaysAgo), current_step_order: 2, created_at: daysAgo(completedDaysAgo + 5), ...extra,
      });
      await schedule(org, e.enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: daysAgo(completedDaysAgo + 4), executed_at: daysAgo(completedDaysAgo + 4) });
      await schedule(org, e.enrollmentId, seq.steps[1], { status: 'sent', scheduled_at: daysAgo(completedDaysAgo + 1), executed_at: daysAgo(completedDaysAgo + 1) });
      const chat = scriptedChat(account);
      await mock(account, { routes: [chatListRoute(chat.id), candidateReplyRoute(chat.path, daysAgo(Math.max(completedDaysAgo - 1, 0.5)))] });
      return e;
    };
    // Refonte mission, lot 0b : la réponse n'écrit que dans la mission de l'inscription.
    const mission = await seedMission(org.orgId, users[0].userId);
    const recent = await completedFixture(0, accRecent, 3, { job_id: `project:${mission}` });
    const old = await completedFixture(1, accOld, 20);
    const meeting = await completedFixture(2, accMeeting, 2, { tracking_data: { completion_reason: 'meeting_booked' } });

    // Même candidat que « recent » sur un autre compte : une inscription antérieure à la fin, une postérieure.
    const siblingSeq = await insertSequence(org, users[3].userId, [
      { action_type: 'message', message_template: 'Autre' },
      { action_type: 'message', message_template: 'Autre relance', delay_days: 2 },
    ]);
    const earlier = await enroll(org, siblingSeq.sequenceId, users[3].userId, accSibling, { profile_id: recent.profileId, created_at: daysAgo(6), current_step_order: 1 });
    const earlierExec = await schedule(org, earlier.enrollmentId, siblingSeq.steps[1], { scheduled_at: minutesFromNow(2 * 24 * 60) });
    const laterSeq = await insertSequence(org, users[3].userId, [
      { action_type: 'message', message_template: 'Nouvelle approche' },
      { action_type: 'message', message_template: 'Nouvelle relance', delay_days: 2 },
    ]);
    const later = await enroll(org, laterSeq.sequenceId, users[3].userId, accSibling, { profile_id: recent.profileId, created_at: daysAgo(1), current_step_order: 1 });
    const laterExec = await schedule(org, later.enrollmentId, laterSeq.steps[1], { scheduled_at: minutesFromNow(2 * 24 * 60) });
    const jcsRow = await seedCandidateRow({
      orgId: org.orgId, createdBy: users[0].userId, candidateId: recent.profileId, missionId: mission, stage: 'contacted',
    });

    await checkRepliesUntilExamined(recent.enrollmentId);

    const r = await enrollmentFull(recent.enrollmentId);
    expect(r.status, 'réponse à la dernière relance : « répondu »').toBe('replied');
    expect(r.replied_at).not.toBeNull();
    const { data: stats } = await admin().from('sequence_analytics').select('replies_received').eq('sequence_id', seq.sequenceId);
    expect(((stats ?? []) as Array<{ replies_received: number | null }>).reduce((s, x) => s + (x.replies_received ?? 0), 0), 'réponse comptée une fois').toBe(1);
    const jcsAfter = await candidateRowState(jcsRow.id);
    expect({ general_stage: jcsAfter.general_stage, status: jcsAfter.status, pipeline_stage: jcsAfter.pipeline_stage, decision_source: jcsAfter.decision_source })
      .toEqual({ general_stage: 'replied', status: 'replied', pipeline_stage: 'Répondu', decision_source: 'system' });
    expect((await enrollmentFull(earlier.enrollmentId)).status, 'inscription créée avant la fin : arrêtée').toBe('stopped');
    expect((await execRow(earlierExec)).status).toBe('cancelled');
    expect((await enrollmentFull(later.enrollmentId)).status, 'prise de contact démarrée après la fin : intacte').toBe('active');
    expect((await execRow(laterExec)).status).toBe('scheduled');

    const o = await enrollmentFull(old.enrollmentId);
    expect({ status: o.status, last_check_at: o.last_check_at }, 'terminée il y a 20 jours : non examinée').toEqual({ status: 'completed', last_check_at: null });
    const m = await enrollmentFull(meeting.enrollmentId);
    expect({ status: m.status, last_check_at: m.last_check_at }, 'close par un rendez-vous : non examinée').toEqual({ status: 'completed', last_check_at: null });
  });

  test('candidat effacé (RGPD) : terminée avec le marqueur d’effacement, ou adresse inscrite au registre seule, ni conversation lue ni « répondu » ; témoin non effacé clos', async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E D9 RGPD', 3);
    const [accMarked, accRegistry, accWitness] = accounts;
    const seq = await insertSequence(org, users[0].userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 2 },
    ]);
    // Effacement : l'inscription terminée garde son statut, son adresse et le marqueur (recordGdprErasure).
    const marked = await completedWithReply(org, seq, users[0].userId, accMarked, 3, {
      profile_name: null, profile_url: `https://www.linkedin.com/in/efface-${rand()}`, tracking_data: { gdpr_erased_at: daysAgo(1) },
    });
    // Effacement inscrit au registre global seulement (antérieur au marqueur, ou demandé par une autre organisation).
    const registryUrl = `https://www.linkedin.com/in/registre-${rand()}`;
    const registry = await completedWithReply(org, seq, users[1].userId, accRegistry, 3, { profile_url: registryUrl });
    const { data: erasure, error: erasureErr } = await admin().from('gdpr_erasures')
      .insert({ linkedin_url_hash: createHash('sha256').update(registryUrl.toLowerCase()).digest('hex'), source: 'e2e-seq-decisions-engine' })
      .select('id').single();
    expect(erasureErr).toBeNull();
    cleanups.push(() => admin().from('gdpr_erasures').delete().eq('id', (erasure as { id: string }).id));
    // Témoin déjà contrôlé il y a 30 jours : la rotation (jamais contrôlées d'abord) ne l'atteint qu'après toutes les
    // inscriptions jamais contrôlées, l'inscription marquée comprise si elle était sélectionnable.
    const witness = await completedWithReply(org, seq, users[2].userId, accWitness, 3, { last_check_at: daysAgo(30) });
    const since = new Date().toISOString();

    await checkRepliesUntilCheckedSince(since, witness.enrollmentId, registry.enrollmentId);

    expect((await enrollmentFull(witness.enrollmentId)).status, 'témoin non effacé : « répondu »').toBe('replied');
    const mk = await enrollmentFull(marked.enrollmentId);
    expect({ status: mk.status, replied_at: mk.replied_at, last_check_at: mk.last_check_at }, 'marqueur d’effacement : jamais sélectionnée')
      .toEqual({ status: 'completed', replied_at: null, last_check_at: null });
    expect(await chatReads(accMarked), 'aucune lecture de la conversation d’un candidat effacé').toBe(0);
    const rg = await enrollmentFull(registry.enrollmentId);
    expect({ status: rg.status, replied_at: rg.replied_at }, 'registre : examinée, écartée').toEqual({ status: 'completed', replied_at: null });
    expect(rg.last_check_at).not.toBeNull();
    expect(await chatReads(accRegistry), 'registre : aucune lecture de conversation').toBe(0);
    expect(await repliesCounted(seq.sequenceId), 'seule la réponse du témoin est comptée').toBe(1);
  });

  test('même candidat sur le même compte, inscription plus récente ou encore ouverte : l’ancienne terminée reste terminée, réponse comptée une fois, pipeline de sa mission intact', async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E D9 Dernier contact', 3);
    const [accX, accY, accZ] = accounts;
    const oldSeq = await insertSequence(org, users[0].userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 2 },
    ]);
    const newSeq = await insertSequence(org, users[0].userId, [
      { action_type: 'message', message_template: 'Nouvelle approche' },
      { action_type: 'message', message_template: 'Nouvelle relance', delay_days: 5 },
    ]);
    // Refonte mission, lot 0b : deux missions de l'organisation.
    const missionOld = await seedMission(org.orgId, users[0].userId);
    const missionNew = await seedMission(org.orgId, users[0].userId);
    const jobOld = `project:${missionOld}`;
    const jobNew = `project:${missionNew}`;

    // Compte X : E1 (mission M1) terminée il y a 5 jours ; E2 (mission M2), même candidat reconnu par le slug exact
    // de son adresse sous un identifiant Recruiter, créée ensuite et déjà « répondu » par le webhook.
    const slugX = `camille-x-${rand()}`;
    const e1 = await completedWithReply(org, oldSeq, users[0].userId, accX, 5, { profile_url: `https://www.linkedin.com/in/${slugX}`, job_id: jobOld });
    const e2 = await enroll(org, newSeq.sequenceId, users[0].userId, accX, {
      profile_id: `AEMAAX${rand()}`, profile_url: `https://fr.linkedin.com/in/${slugX}/`, job_id: jobNew,
      status: 'replied', replied_at: daysAgo(1), created_at: daysAgo(4), current_step_order: 1,
    });
    await schedule(org, e2.enrollmentId, newSeq.steps[0], { status: 'sent', scheduled_at: daysAgo(3), executed_at: daysAgo(3) });
    const jcsRow = await seedCandidateRow({
      orgId: org.orgId, createdBy: users[0].userId, candidateId: e1.profileId, missionId: missionOld, stage: 'contacted',
    });

    // Compte Y : E3 terminée ; E4 du même candidat (identifiant résolu) encore active, un message parti.
    const e3 = await completedWithReply(org, oldSeq, users[1].userId, accY, 5);
    const e4 = await enroll(org, newSeq.sequenceId, users[1].userId, accY, {
      profile_id: `AEMAAY${rand()}`, resolved_profile_id: e3.profileId, created_at: daysAgo(4), current_step_order: 1,
    });
    await schedule(org, e4.enrollmentId, newSeq.steps[0], { status: 'sent', scheduled_at: daysAgo(3), executed_at: daysAgo(3) });
    const e4Next = await schedule(org, e4.enrollmentId, newSeq.steps[1], { scheduled_at: minutesFromNow(2 * 24 * 60) });

    // Compte Z : E6 terminée il y a 5 jours ; E5, plus ancienne, a reçu la réponse du candidat hier (après la fin d'E6).
    const e6 = await completedWithReply(org, oldSeq, users[2].userId, accZ, 5);
    await enroll(org, newSeq.sequenceId, users[2].userId, accZ, {
      profile_id: e6.profileId, status: 'replied', replied_at: daysAgo(1), created_at: daysAgo(12), current_step_order: 1,
    });

    await checkRepliesUntilExamined(e1.enrollmentId, e3.enrollmentId, e4.enrollmentId, e6.enrollmentId);

    for (const [label, id] of [['compte X', e1.enrollmentId], ['compte Y', e3.enrollmentId], ['compte Z', e6.enrollmentId]] as const) {
      const row = await enrollmentFull(id);
      expect({ status: row.status, replied_at: row.replied_at }, `${label} : l'ancienne inscription reste terminée`).toEqual({ status: 'completed', replied_at: null });
      expect(row.last_check_at, `${label} : examinée`).not.toBeNull();
    }
    expect(await chatReads(accX), 'compte X : conversation jamais relue pour l’ancienne inscription').toBe(0);
    expect(await chatReads(accZ), 'compte Z : conversation jamais relue pour l’ancienne inscription').toBe(0);
    expect((await enrollmentFull(e4.enrollmentId)).status, 'compte Y : la réponse revient à l’inscription ouverte').toBe('replied');
    expect((await execRow(e4Next)).status).toBe('cancelled');
    expect(await repliesCounted(oldSeq.sequenceId), 'aucune réponse comptée sur l’ancienne séquence').toBe(0);
    expect(await repliesCounted(newSeq.sequenceId), 'réponse comptée une fois, sur l’inscription ouverte').toBe(1);
    expect((await candidateRowState(jcsRow.id)).general_stage, 'mission M1 : pipeline intact').toBe('contacted');
  });
});

// ═══ Décision 22 : un envoi par personne et par cycle ═══════════════════════

test.describe('Décision 22 : un seul envoi par personne et par cycle, toutes identités confondues', () => {
  test('même personne sous son identifiant Recruiter (identifiant résolu) ou sous son slug : un envoi au cycle, l’autre au cycle suivant', async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E D22 Identités', 4);
    const s1 = await insertSequence(org, users[0].userId, [{ action_type: 'message', message_template: 'Premier S1' }]);
    const s2 = await insertSequence(org, users[0].userId, [{ action_type: 'message', message_template: 'Premier S2' }]);
    const classic = `ACoAAD22${rand()}${rand()}`;
    const slug = `lea-d22-${rand()}`;
    // Paire A : identifiant classique, puis identifiant Recruiter résolu vers le même classique.
    const a1 = await enroll(org, s1.sequenceId, users[0].userId, accounts[0], { profile_id: classic });
    const a2 = await enroll(org, s2.sequenceId, users[1].userId, accounts[1], { profile_id: `AEMAAD22${rand()}`, resolved_profile_id: classic });
    // Paire B : adresse du profil, puis le slug enregistré comme identifiant.
    const b1 = await enroll(org, s1.sequenceId, users[2].userId, accounts[2], { profile_id: `ACoAAB22${rand()}`, profile_url: `https://www.linkedin.com/in/${slug}/` });
    const b2 = await enroll(org, s2.sequenceId, users[3].userId, accounts[3], { profile_id: slug });
    const xa1 = await schedule(org, a1.enrollmentId, s1.steps[0], { scheduled_at: minutesFromNow(-4) });
    const xb1 = await schedule(org, b1.enrollmentId, s1.steps[0], { scheduled_at: minutesFromNow(-4) });
    const a2At = minutesFromNow(-3);
    const b2At = minutesFromNow(-3);
    const xa2 = await schedule(org, a2.enrollmentId, s2.steps[0], { scheduled_at: a2At });
    const xb2 = await schedule(org, b2.enrollmentId, s2.steps[0], { scheduled_at: b2At });

    await cycle();

    expect((await execRow(xa1)).status, 'plus ancienne de la personne A : envoyée').toBe('sent');
    expect((await execRow(xb1)).status, 'plus ancienne de la personne B : envoyée').toBe('sent');
    const ra2 = await execRow(xa2);
    const rb2 = await execRow(xb2);
    expect([ra2.status, rb2.status], 'la seconde de chaque personne attend le cycle suivant').toEqual(['scheduled', 'scheduled']);
    expect(ms(ra2.scheduled_at), 'date gardée').toBe(ms(a2At));
    expect(ms(rb2.scheduled_at)).toBe(ms(b2At));
    expect(await sentTexts(accounts[1])).toEqual([]);
    expect(await sentTexts(accounts[3])).toEqual([]);

    await cycle();

    expect((await execRow(xa2)).status, 'cycle suivant : envoyée').toBe('sent');
    expect((await execRow(xb2)).status).toBe('sent');
    expect(await sentTexts(accounts[1])).toEqual(['Premier S2']);
    expect(await sentTexts(accounts[3])).toEqual(['Premier S2']);
  });
});

// ═══ Décisions 25, 26 et 28 : conditions d'arrêt ════════════════════════════

test.describe('Décisions 25, 26 et 28 : rendez-vous et désinscription', () => {
  test('rendez-vous pris avant l’inscription : l’envoi part ; pris après : étape annulée, meeting_booked, recruteur prévenu ; désinscription : étape annulée', async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E D25 Arrêts', 2);
    const stop = { on_reply: true, on_unsubscribe: true, on_meeting_booked: true };
    const seq = await insertSequence(org, users[0].userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ], { stop_conditions: stop });

    // Décision 25 : rendez-vous réservé il y a 3 jours, inscription démarrée hier.
    const early = await enroll(org, seq.sequenceId, users[0].userId, accounts[0], { created_at: daysAgo(1) });
    await insertMeeting(org.orgId, users[0].userId, { candidate_profile_id: early.profileId, created_at: daysAgo(3) });

    // Décisions 26 et 28 : inscription démarrée il y a 3 jours, rendez-vous réservé hier.
    const booked = await enroll(org, seq.sequenceId, users[0].userId, accounts[0], { created_at: daysAgo(3), profile_name: 'Camille Rdv' });
    const meetingId = await insertMeeting(org.orgId, users[0].userId, { candidate_profile_id: booked.profileId, created_at: daysAgo(1) });
    const bookedWait = await schedule(org, booked.enrollmentId, seq.steps[1], { status: 'quota_blocked', scheduled_at: minutesFromNow(2 * 24 * 60) });

    // Décision 28 : désinscription (adresse en liste de suppression).
    const email = `dec28.${rand()}@exemple.fr`;
    const { error: supErr } = await admin().from('suppressed_emails').insert({ email, reason: 'unsubscribe' });
    if (supErr) throw new Error(`suppressed_emails: ${supErr.message}`);
    cleanups.push(() => admin().from('suppressed_emails').delete().eq('email', email));
    const unsub = await enroll(org, seq.sequenceId, users[1].userId, accounts[1], { email_used: email });

    const xEarly = await schedule(org, early.enrollmentId, seq.steps[0]);
    const xBooked = await schedule(org, booked.enrollmentId, seq.steps[0]);
    const xUnsub = await schedule(org, unsub.enrollmentId, seq.steps[0]);
    await cycle();

    expect((await execRow(xEarly)).status, 'rendez-vous antérieur à l’inscription : l’envoi part').toBe('sent');
    expect((await enrollmentFull(early.enrollmentId)).status).toBe('active');

    const rb = await execRow(xBooked);
    expect(rb.status, 'étape arrêtée par le rendez-vous : annulée').toBe('cancelled');
    expect(rb.skip_reason).toBe(MEETING_STOP);
    expect((await execRow(bookedWait)).status, 'étapes en attente annulées').toBe('cancelled');
    const eb = await enrollmentFull(booked.enrollmentId);
    expect(eb.status).toBe('completed');
    expect(eb.completed_at).not.toBeNull();
    expect(eb.tracking_data?.completion_reason).toBe('meeting_booked');
    expect(eb.tracking_data?.meeting_booked_at).toBeTruthy();
    expect(eb.tracking_data?.qualification_session_id).toBe(meetingId);
    const { data: notifs } = await admin().from('notifications').select('user_id, type, title, body, link, metadata')
      .eq('organization_id', org.orgId).eq('title', 'RDV pris, séquence arrêtée');
    const rows = (notifs ?? []) as Array<{ user_id: string; type: string; title: string; body: string; link: string; metadata: Record<string, unknown> }>;
    expect(rows, 'recruteur prévenu une fois').toHaveLength(1);
    expect(rows[0].user_id).toBe(users[0].userId);
    expect(rows[0].type).toBe('action');
    expect(rows[0].link).toBe(`/qualification/${meetingId}`);
    expect(rows[0].body).toContain('Camille Rdv');
    expect(rows[0].metadata?.enrollment_ids).toEqual([booked.enrollmentId]);

    const ru = await execRow(xUnsub);
    expect(ru.status, 'étape arrêtée par la désinscription : annulée').toBe('cancelled');
    expect(ru.skip_reason).toBe(UNSUB_STOP);
    const eu = await enrollmentFull(unsub.enrollmentId);
    expect(eu.status).toBe('completed');
    expect(eu.tracking_data?.completion_reason, 'pas de raison « rendez-vous »').toBeUndefined();
    expect(await sentTexts(accounts[0])).toEqual(['Bonjour']);
    expect(await sentTexts(accounts[1])).toEqual([]);
  });
});

// ═══ Décision 35 : reprise groupée d'une séquence désactivée ════════════════

test.describe('Décision 35 : reprise groupée par séquence', () => {
  test('séquence désactivée : refus « sequence_inactive », candidats toujours en pause ; réactivée : reprise', async () => {
    const { org, accountId } = await sendingOrgTracked('E2E D35 Reprise groupée');
    const { sequenceId, steps } = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ], { is_active: false });
    const e = await enroll(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'sequence_inactive' });
    const at = minutesFromNow(24 * 60);
    const x = await schedule(org, e.enrollmentId, steps[0], { scheduled_at: at });
    const token = await tokenOf(org.owner);
    const body = { action: 'resume_enrollments', organization_id: org.orgId, sequence_id: sequenceId, pause_reasons: ['sequence_inactive', 'auto_paused'] };

    const refused = await callFunction('process-sequences', token, body);
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.error_code).toBe('sequence_inactive');
    expect(String(refused.body.message)).toContain('désactivée');
    const still = await enrollmentFull(e.enrollmentId);
    expect({ status: still.status, pause_reason: still.pause_reason }).toEqual({ status: 'paused', pause_reason: 'sequence_inactive' });
    const row = await execRow(x);
    expect(row.status).toBe('scheduled');
    expect(ms(row.scheduled_at)).toBe(ms(at));

    await admin().from('outreach_sequences').update({ is_active: true }).eq('id', sequenceId);
    const ok = await callFunction('process-sequences', token, body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((ok.body.counts as Record<string, number>).resumed).toBe(1);
    expect((await enrollmentFull(e.enrollmentId)).status).toBe('active');
  });
});

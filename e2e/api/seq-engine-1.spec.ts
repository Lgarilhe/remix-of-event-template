/**
 * Moteur de séquences, lot « engine-1 » : verrous, rattrapages, gardes avant
 * envoi, vérification de réponse, issues incertaines d'un envoi, sélection du
 * cycle. Contrat : CLAUDE.md, « Séquences : règles du moteur et de
 * l'interface », et docs/audit-2026-09-25-sequences.md (D1-D6, SEQ-xxx).
 *
 * Le moteur process-sequences tourne pour de vrai contre la stack locale
 * (e2e/local-stack) ; LinkedIn est simulé par vendor-mock.mjs, qui journalise
 * chaque appel. Ignoré sans cette stack.
 *
 * Limite du faux prestataire : il rattache un appel à un compte par le
 * paramètre account_id. Deux appels du moteur n'en portent pas : la lecture
 * des messages d'une conversation (GET /chats/{id}/messages) et l'envoi dans
 * une conversation existante (POST /chats/{id}/messages). Pour scripter ces
 * réponses sans toucher à la clé '*', l'identifiant de conversation renvoyé
 * porte « ?account_id=<compte>&c= » : le moteur l'insère tel quel dans l'URL,
 * le faux prestataire lit alors le compte et le chemin devient
 * /api/v1/chats/<id>. Voir replyChat().
 *
 * `force: true` lève la fenêtre d'envoi (jours ouvrés 8 h-19 h).
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedLinkedInAccount,
  seedMission,
  seedSequence,
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
  enrollmentRow,
  executionsOf,
  messageSequence,
  minutesFromNow,
  mockCalls,
  postJson,
  rand,
  runCycle,
  runEngine,
  schedule,
  sendingOrg,
  setMockMode,
  setPaidPlan,
  type MockCall,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => Promise<unknown>> = [];
const track = (org: TestOrg, extra: TestUser[] = []) => { orgsToDelete.push({ org, extra }); return org; };

test.afterEach(async () => {
  while (cleanups.length) {
    try { await cleanups.pop()!(); } catch { /* nettoyage au mieux */ }
  }
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    // job_candidate_status n'est pas en cascade : supprimé avant l'organisation.
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, extra);
  }
});

// ─── Aides ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string, timeoutMs = 30_000, stepMs = 100): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last = await read();
  while (!ok(last)) {
    if (Date.now() > end) throw new Error(`attente dépassée : ${what} (dernière valeur ${JSON.stringify(last)})`);
    await sleep(stepMs);
    last = await read();
  }
  return last;
}

interface ExecFull {
  id: string;
  step_order: number;
  status: string;
  scheduled_at: string;
  final_message: string | null;
  skip_reason: string | null;
  error_message: string | null;
  retry_count: number | null;
  channel: string | null;
  tracking_data: Record<string, unknown> | null;
  updated_at: string;
}

async function execRow(id: string): Promise<ExecFull | null> {
  const { data } = await admin()
    .from('sequence_step_executions')
    .select('id, step_order, status, scheduled_at, final_message, skip_reason, error_message, retry_count, channel, tracking_data, updated_at')
    .eq('id', id)
    .maybeSingle();
  return (data ?? null) as ExecFull | null;
}

async function enrollmentFull(id: string) {
  const { data } = await admin()
    .from('sequence_enrollments')
    .select('id, status, pause_reason, current_step_order, tracking_data, updated_at, completed_at, replied_at')
    .eq('id', id)
    .maybeSingle();
  return data as {
    id: string; status: string; pause_reason: string | null; current_step_order: number;
    tracking_data: Record<string, unknown> | null; updated_at: string; completed_at: string | null; replied_at: string | null;
  } | null;
}

/** Envois (POST) reçus par le faux prestataire pour ce compte. */
async function postsOf(accountId: string): Promise<MockCall[]> {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST');
}

const isNewChatPost = (c: MockCall) => c.method === 'POST' && c.path === '/api/v1/chats';

/** Conversation scriptable pour le compte (voir l'en-tête du fichier). */
function replyChat(accountId: string) {
  const base = `chat${rand()}${rand()}`;
  return { id: `${base}?account_id=${accountId}&c=`, path: `^/api/v1/chats/${base}$` };
}

const chatListRoute = (chatId: string) => ({
  method: 'GET', path: '^/api/v1/chat_attendees/[^/]+/chats$',
  body: { object: 'ChatList', items: [{ id: chatId }], cursor: null },
});

const candidateReply = (at: string) => ({
  object: 'MessageList', cursor: null,
  items: [{ id: `m_${rand()}`, is_sender: 0, text: 'Oui, avec plaisir', timestamp: at }],
});

/** Décalage de l'heure de Paris par rapport à UTC, en millisecondes, à un instant donné. */
function parisOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second')) - Math.floor(instant / 1000) * 1000;
}

/** Lendemain à `hour` h, heure de Paris. */
function tomorrowParisAt(hour: number, now = Date.now()): Date {
  const wall = new Date(now + parisOffsetMs(now));
  const target = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1, hour);
  return new Date(target - parisOffsetMs(target));
}

async function lockRow() {
  const { data } = await admin().from('sequence_processing_lock').select('locked_at, locked_by').eq('id', 'process').maybeSingle();
  return data as { locked_at: string | null; locked_by: string | null } | null;
}

async function waitLockFree() {
  await until(lockRow, (r) => !r?.locked_at, 'verrou global du moteur libre', 90_000, 500);
}

const processOnce = () => postJson('/functions/v1/process-sequences', { action: 'process', force: true }, { Authorization: `Bearer ${CRON_SECRET}` });

async function ownerToken(org: TestOrg) {
  return (await signIn(org.owner.email, org.owner.password)).access_token;
}

async function seedJcs(orgId: string, createdBy: string, jobId: string, candidateId: string, status = 'contacted') {
  const { data, error } = await admin().from('job_candidate_status').insert({
    organization_id: orgId, created_by: createdBy, job_id: jobId, candidate_id: candidateId, status,
  }).select('id').single();
  if (error || !data) throw new Error(`job_candidate_status: ${error?.message}`);
  return data.id as string;
}

async function jcsStatus(id: string) {
  const { data } = await admin().from('job_candidate_status').select('status').eq('id', id).single();
  return (data as { status: string }).status;
}

async function repliesReceived(sequenceId: string): Promise<number> {
  const { data } = await admin().from('sequence_analytics').select('replies_received').eq('sequence_id', sequenceId);
  return ((data ?? []) as Array<{ replies_received: number | null }>).reduce((s, r) => s + (r.replies_received ?? 0), 0);
}

async function setSubscription(orgId: string, row: Record<string, unknown> | null) {
  await admin().from('organization_subscriptions').delete().eq('organization_id', orgId);
  if (row) {
    const { error } = await admin().from('organization_subscriptions').insert({ organization_id: orgId, seats: 1, ...row });
    if (error) throw new Error(`organization_subscriptions: ${error.message}`);
  }
}

const SUBSCRIPTION_REQUIRED = "Abonnement requis pour l'envoi de séquences";
const ACCOUNT_NOT_IN_ORG = "Compte d'envoi non rattaché à l'organisation";
const UNCERTAIN = 'Envoi incertain : vérifiez la conversation avant de relancer';
const MANUAL_SKIP = 'Manuellement sautée par le recruteur';
const SIBLING_REPLY = "Le candidat a répondu sur un autre compte de l'organisation";
const REPLY_RETRY_1 = "Vérification de réponse impossible : nouvel essai 1/3 dans 30 min, rien n'a été envoyé";
const REPLY_FAILED = "Vérification de réponse impossible : message non envoyé. Vérifiez la conversation puis relancez l'étape.";

/** Séquence [invitation, message] : invitation partie il y a deux jours, relance due. */
async function followUpSetup(org: TestOrg, accountId: string, overrides: Record<string, unknown> = {}) {
  const seeded = await seedSequence(org.orgId, org.owner.userId, [
    { action_type: 'connection_request' },
    { action_type: 'message', delay_days: 2 },
  ]);
  await admin().from('sequence_steps').update({ message_template: 'Relance {{firstName}}' }).eq('id', seeded.steps[1].id);
  const { enrollmentId, profileId } = await enroll(org, seeded.sequenceId, org.owner.userId, accountId, { current_step_order: 1, ...overrides });
  const twoDaysAgo = minutesFromNow(-2 * 24 * 60);
  await schedule(org, enrollmentId, seeded.steps[0], { status: 'sent', scheduled_at: twoDaysAgo, executed_at: twoDaysAgo });
  return { ...seeded, enrollmentId, profileId };
}

// ═══════════════════════════════════════════════════════════════════════════
// Verrou global
// ═══════════════════════════════════════════════════════════════════════════

test.describe('@critical Verrou global du moteur', () => {
  // verrou-cycles-concurrents
  test('@critical deux cycles lancés en même temps : un seul traite le lot, l’autre répond lock_held, l’exécution ne part qu’une fois', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Verrou');
    track(org);
    await setMockMode(accountId, { routes: [{
      method: 'POST', path: '^/api/v1/chats$', status: 201, delay_ms: 4000,
      body: { object: 'ChatStarted', chat_id: `chat_${rand()}`, message_id: `msg_${rand()}` },
    }] });
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour verrou']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    await waitLockFree();
    const execId = await schedule(org, enrollmentId, steps[0]);

    const [a, b] = await Promise.all([processOnce(), processOnce()]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const held = [a, b].filter((r) => r.body.skipped_reason === 'lock_held');
    const ran = [a, b].filter((r) => r.body.skipped_reason !== 'lock_held');
    expect(held, 'exactement une réponse lock_held').toHaveLength(1);
    expect(held[0].body).toEqual({ success: true, skipped_reason: 'lock_held' });
    expect(ran, 'exactement un cycle traite le lot').toHaveLength(1);
    expect(ran[0].body.success).toBe(true);
    expect(ran[0].body.results).toBeTruthy();

    expect((await postsOf(accountId)).filter(isNewChatPost), 'un seul POST d’envoi').toHaveLength(1);
    expect((await execRow(execId))?.status).toBe('sent');
  });

  // verrou-ttl-liberation (partie API)
  test('verrou tenu depuis 5 min par un autre passage : lock_held et battement « skipped » ; tenu depuis 11 min : repris, traité puis libéré', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 TTL');
    track(org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour TTL']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    await waitLockFree();
    const execId = await schedule(org, enrollmentId, steps[0]);
    cleanups.push(async () => {
      await admin().from('sequence_processing_lock').update({ locked_at: null, locked_by: null }).eq('id', 'process').eq('locked_by', 'ghost');
    });

    const readBeat = async () => {
      const { data } = await admin().from('cron_heartbeat').select('last_status, last_run_at, run_count').eq('job_name', 'process-sequences:process').maybeSingle();
      return data as { last_status: string; last_run_at: string; run_count: number } | null;
    };
    // Les battements des passages précédents sont écrits sans attente : on les laisse arriver.
    await sleep(2000);
    const baseline = (await readBeat())?.run_count ?? 0;
    await admin().from('sequence_processing_lock').update({ locked_at: minutesFromNow(-5), locked_by: 'ghost' }).eq('id', 'process');
    const skipped = await processOnce();
    expect(skipped.status).toBe(200);
    expect(skipped.body).toEqual({ success: true, skipped_reason: 'lock_held' });
    const beat = await until(readBeat, (r) => (r?.run_count ?? 0) > baseline, 'battement du passage sauté', 10_000, 200);
    expect(beat?.run_count, 'un seul battement pour ce passage').toBe(baseline + 1);
    expect(beat?.last_status, 'passage sauté noté « skipped »').toBe('skipped');
    expect((await lockRow())?.locked_by, 'le verrou d’un autre n’est pas libéré').toBe('ghost');
    expect(await postsOf(accountId)).toEqual([]);

    await admin().from('sequence_processing_lock').update({ locked_at: minutesFromNow(-11), locked_by: 'ghost' }).eq('id', 'process');
    const ran = await processOnce();
    expect(ran.status).toBe(200);
    expect(ran.body.skipped_reason, 'verrou de plus de 10 min repris').toBeUndefined();
    expect(ran.body.results).toBeTruthy();
    expect((await execRow(execId))?.status).toBe('sent');
    const after = await lockRow();
    expect(after?.locked_at, 'verrou libéré en fin de cycle').toBeNull();
    expect(after?.locked_by).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rattrapages (janitors)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('@critical Rattrapages du début de cycle', () => {
  // janitor-sending-bloque
  test('@critical exécution restée « sending » plus de 5 min : visible en échec sans relance, invisible replanifiée puis en échec après 3 reprises', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Sending');
    track(org);
    const msgSeq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const visitSeq = await seedSequence(org.orgId, org.owner.userId, [{ action_type: 'profile_visit' }, { action_type: 'message' }]);
    const visible = await enroll(org, msgSeq.sequenceId, org.owner.userId, accountId);
    const visitFresh = await enroll(org, visitSeq.sequenceId, org.owner.userId, accountId);
    const visitWorn = await enroll(org, visitSeq.sequenceId, org.owner.userId, accountId);
    const stuckAt = minutesFromNow(-10);
    const visibleExec = await schedule(org, visible.enrollmentId, msgSeq.steps[0], { status: 'sending', scheduled_at: minutesFromNow(-15), updated_at: stuckAt, retry_count: 0, final_message: 'Bonjour' });
    const freshExec = await schedule(org, visitFresh.enrollmentId, visitSeq.steps[0], { status: 'sending', scheduled_at: minutesFromNow(-15), updated_at: stuckAt, retry_count: 0 });
    const wornExec = await schedule(org, visitWorn.enrollmentId, visitSeq.steps[0], { status: 'sending', scheduled_at: minutesFromNow(-15), updated_at: stuckAt, retry_count: 3 });

    const cycleAt = Date.now();
    await runCycle();

    const v = await execRow(visibleExec);
    expect(v?.status, 'message interrompu : échec, jamais rejoué').toBe('failed');
    expect(v?.error_message ?? '').toMatch(/^Interrompu pendant l'envoi \(message\)/);
    expect(v?.retry_count ?? 0, 'retry_count inchangé').toBe(0);
    expect((await enrollmentRow(visible.enrollmentId)).current_step_order, 'inscription non avancée').toBe(0);
    expect(await executionsOf(visible.enrollmentId), 'aucune étape suivante planifiée').toHaveLength(1);

    const f = await execRow(freshExec);
    expect(f?.status, 'visite interrompue : replanifiée').toBe('scheduled');
    expect(f?.retry_count).toBe(1);
    const retryDelay = new Date(f!.scheduled_at).getTime() - cycleAt;
    expect(retryDelay).toBeGreaterThan(9 * 60_000);
    expect(retryDelay).toBeLessThan(11 * 60_000 + 30_000);

    const w = await execRow(wornExec);
    expect(w?.status, 'visite déjà reprise 3 fois : échec').toBe('failed');
    expect(w?.error_message).toBe('Failed after 3 retries (stuck in sending state)');

    expect(await mockCalls(accountId), 'aucun appel au fournisseur').toEqual([]);
  });

  // envoi-parti-statut-non-ecrit (moitié rattrapage)
  test('exécution « Envoyé, statut non enregistré » restée « sending » : passée « sent » sans renvoi, puis l’étape suivante est planifiée', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Statut');
    track(org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 2);
    // Inscription déjà ancienne : le rattrapage des dormantes la reprend dans le même passage.
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { updated_at: minutesFromNow(-120) });
    const execId = await schedule(org, enrollmentId, steps[0], {
      status: 'sending', scheduled_at: minutesFromNow(-20), updated_at: minutesFromNow(-10),
      final_message: 'Bonjour', error_message: 'Envoyé, statut non enregistré',
    });

    await runCycle();

    const e = await execRow(execId);
    expect(e?.status).toBe('sent');
    expect(e?.channel).toBe('linkedin');
    expect(e?.error_message).toBeNull();
    expect(e?.tracking_data?.recovered_by_janitor, 'trace du rattrapage').toBeTruthy();
    expect(await postsOf(accountId), 'le message n’est jamais renvoyé').toEqual([]);
    const execs = await executionsOf(enrollmentId);
    expect(execs.filter((x) => x.step_order === 0), 'étape 0 jamais rejouée').toHaveLength(1);
    const next = execs.filter((x) => x.step_order === 1);
    expect(next.map((x) => x.status), 'étape suivante planifiée').toEqual(['scheduled']);
  });

  // janitor-quota-blocked
  test('« quota_blocked » échues : réarmée et envoyée si tout est actif, gardée si pause ou séquence désactivée, annulée si l’inscription est close', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 QuotaBlocked');
    track(org);
    const active = await messageSequence(org, org.owner.userId, ['Bonjour réarmé']);
    const inactive = await messageSequence(org, org.owner.userId, ['Bonjour inactif']);
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', inactive.sequenceId);
    const ok = await enroll(org, active.sequenceId, org.owner.userId, accountId);
    const paused = await enroll(org, active.sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'manual' });
    const offSeq = await enroll(org, inactive.sequenceId, org.owner.userId, accountId);
    const replied = await enroll(org, active.sequenceId, org.owner.userId, accountId, { status: 'replied', replied_at: minutesFromNow(-30) });
    const dueAt = minutesFromNow(-1);
    const blocked = { status: 'quota_blocked', scheduled_at: dueAt, skip_reason: 'Cap journalier actions LinkedIn atteint (20/20).' };
    const eOk = await schedule(org, ok.enrollmentId, active.steps[0], blocked);
    const ePaused = await schedule(org, paused.enrollmentId, active.steps[0], blocked);
    const eOff = await schedule(org, offSeq.enrollmentId, inactive.steps[0], blocked);
    const eReplied = await schedule(org, replied.enrollmentId, active.steps[0], blocked);

    await runCycle();

    expect((await execRow(eOk))?.status, 'réarmée puis envoyée dans le même cycle').toBe('sent');
    for (const [id, label] of [[ePaused, 'inscription en pause'], [eOff, 'séquence désactivée']] as const) {
      const row = await execRow(id);
      expect(row?.status, label).toBe('quota_blocked');
      expect(new Date(row!.scheduled_at).getTime(), `${label} : date gardée`).toBe(new Date(dueAt).getTime());
    }
    const r = await execRow(eReplied);
    expect(r?.status).toBe('cancelled');
    expect(r?.skip_reason).toBe("Inscription close avant l'envoi (replied)");
    const posts = (await postsOf(accountId)).filter(isNewChatPost);
    expect(posts.map((p) => (p.body as Record<string, unknown>).text), 'seule l’exécution active part').toEqual(['Bonjour réarmé']);
  });

  // janitor-dormante-reprise
  test('inscription dormante (dernière étape envoyée ou sautée à la main) : l’étape suivante est planifiée, jamais la même ; rien pour une séquence désactivée', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Dormante');
    track(org);
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 2);
    const off = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 2);
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', off.sequenceId);
    const old = minutesFromNow(-120);
    const a = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { updated_at: old, current_step_order: 1 });
    const b = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { updated_at: old, current_step_order: 1 });
    const c = await enroll(org, off.sequenceId, org.owner.userId, accountId, { updated_at: old, current_step_order: 1 });
    await schedule(org, a.enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: old, executed_at: old });
    await schedule(org, b.enrollmentId, seq.steps[0], { status: 'skipped', skip_reason: MANUAL_SKIP, scheduled_at: old, executed_at: old });
    await schedule(org, c.enrollmentId, off.steps[0], { status: 'sent', scheduled_at: old, executed_at: old });

    const cycleAt = Date.now();
    await runCycle();

    for (const [who, label] of [[a, 'étape envoyée'], [b, 'étape sautée à la main']] as const) {
      const execs = await executionsOf(who.enrollmentId);
      expect(execs.filter((x) => x.step_order === 0), `${label} : étape 0 jamais rejouée`).toHaveLength(1);
      expect(execs.filter((x) => x.step_order === 1).map((x) => x.status), `${label} : une seule étape 1 planifiée`).toEqual(['scheduled']);
      const enr = await enrollmentFull(who.enrollmentId);
      expect(new Date(enr!.updated_at).getTime(), `${label} : updated_at touché`).toBeGreaterThanOrEqual(cycleAt - 1000);
    }
    expect(await executionsOf(c.enrollmentId), 'séquence désactivée : rien de planifié').toHaveLength(1);
    expect(await postsOf(accountId)).toEqual([]);
  });

  // janitor-dormante-reprise (plafond de 5 par passage)
  test('six inscriptions dormantes : cinq au plus reprises par passage', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Dormantes6');
    track(org);
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 2);
    const base = Date.now() - 3 * 24 * 3600_000;
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const at = new Date(base + i * 60_000).toISOString();
      const e = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { updated_at: at, current_step_order: 1 });
      await schedule(org, e.enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: at, executed_at: at });
      ids.push(e.enrollmentId);
    }
    // Inscriptions dormantes d'autres suites plus anciennes que les nôtres : elles passent avant.
    const { data: olderRows } = await admin().from('sequence_enrollments')
      .select('id, organization_id, sequence:outreach_sequences!inner(is_active)')
      .eq('status', 'active').eq('sequence.is_active', true).lt('updated_at', new Date(base).toISOString()).neq('organization_id', org.orgId);
    const olderIds = ((olderRows ?? []) as Array<{ id: string }>).map((r) => r.id);
    let othersAhead = 0;
    if (olderIds.length) {
      const { data: pend } = await admin().from('sequence_step_executions').select('enrollment_id')
        .in('enrollment_id', olderIds).in('status', ['scheduled', 'sending', 'waiting_event', 'quota_blocked']);
      othersAhead = olderIds.length - new Set(((pend ?? []) as Array<{ enrollment_id: string }>).map((p) => p.enrollment_id)).size;
    }

    await runCycle();

    let resumed = 0;
    for (const id of ids) {
      if ((await executionsOf(id)).some((x) => x.step_order === 1)) resumed++;
    }
    expect(resumed, `cinq reprises au plus (${othersAhead} autre(s) dormante(s) plus ancienne(s))`).toBe(Math.max(0, 5 - othersAhead));
  });

  // janitor-dormante-pause
  test('dormante en échec : pause « send_failed » ; relation inconnue après « Vérifier connexion » : pause expliquée ; délai dépassé : branche de délai', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 DormantePause');
    track(org);
    const old = minutesFromNow(-120);
    // Cas 1 : dernière tentative en échec.
    const s1 = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 2);
    const failed = await enroll(org, s1.sequenceId, org.owner.userId, accountId, { updated_at: old });
    await schedule(org, failed.enrollmentId, s1.steps[0], { status: 'failed', scheduled_at: old, executed_at: old, error_message: 'linkedin_send_failed_400: refus' });
    // Cas 2 : « Vérifier connexion » partie, relation inconnue.
    const s2 = await seedSequence(org.orgId, org.owner.userId, [{ action_type: 'check_connection' }, { action_type: 'message' }, { action_type: 'message' }]);
    const unknown = await enroll(org, s2.sequenceId, org.owner.userId, accountId, { updated_at: old, current_step_order: 1, connection_status: null });
    await schedule(org, unknown.enrollmentId, s2.steps[0], { status: 'sent', scheduled_at: old, executed_at: old });
    // Cas 3 : attente sautée pour délai dépassé, branche de délai vers l'étape 2.
    const s3 = await seedSequence(org.orgId, org.owner.userId, [{ action_type: 'wait_connection' }, { action_type: 'message' }, { action_type: 'message' }]);
    await admin().from('sequence_steps').update({ timeout_branch_step_id: s3.steps[2].id, timeout_days: 3 }).eq('id', s3.steps[0].id);
    const timedOut = await enroll(org, s3.sequenceId, org.owner.userId, accountId, { updated_at: old, current_step_order: 1 });
    await schedule(org, timedOut.enrollmentId, s3.steps[0], { status: 'skipped', skip_reason: 'Timeout 3d', scheduled_at: old, executed_at: old });

    await runCycle();

    const f = await enrollmentRow(failed.enrollmentId);
    expect(f.status).toBe('paused');
    expect(f.pause_reason).toBe('send_failed');
    expect(await executionsOf(failed.enrollmentId), 'aucun rejeu de l’étape en échec').toHaveLength(1);

    const u = await enrollmentRow(unknown.enrollmentId);
    expect(u.status).toBe('paused');
    expect(u.pause_reason).toBe('send_failed');
    expect(String(u.tracking_data?.pause_reason ?? '')).toMatch(/^Relation LinkedIn du candidat inconnue/);
    expect(await executionsOf(unknown.enrollmentId), 'aucune branche devinée').toHaveLength(1);

    const t = await executionsOf(timedOut.enrollmentId);
    expect(t.filter((x) => x.step_order === 1), 'pas la suite linéaire').toHaveLength(0);
    expect(t.filter((x) => x.step_order === 2).map((x) => x.status), 'branche de délai planifiée').toEqual(['scheduled']);
    expect((await enrollmentRow(timedOut.enrollmentId)).status).toBe('active');
    expect(await postsOf(accountId)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Gardes avant envoi
// ═══════════════════════════════════════════════════════════════════════════

test.describe('@critical Gardes avant envoi', () => {
  // garde-inscription-close
  test('@critical exécution échue d’une inscription close (arrêtée, terminée, répondue, effacement RGPD) : annulée avec le statut, aucun appel', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Close');
    track(org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const cases = [
      { status: 'stopped', extra: { completed_at: minutesFromNow(-60) } },
      { status: 'completed', extra: { completed_at: minutesFromNow(-60) } },
      { status: 'replied', extra: { replied_at: minutesFromNow(-60) } },
      { status: 'stopped', extra: { completed_at: minutesFromNow(-60), tracking_data: { gdpr_erased_at: minutesFromNow(-60) } } },
    ];
    const seeded: Array<{ enrollmentId: string; status: string }> = [];
    for (const c of cases) {
      const e = await enroll(org, sequenceId, org.owner.userId, accountId, { status: c.status, ...c.extra });
      seeded.push({ enrollmentId: e.enrollmentId, status: c.status });
    }
    const execIds: string[] = [];
    for (const s of seeded) execIds.push(await schedule(org, s.enrollmentId, steps[0]));

    await runCycle();

    for (const [i, s] of seeded.entries()) {
      const row = await execRow(execIds[i]);
      expect(row?.status, `inscription ${s.status}`).toBe('cancelled');
      expect(row?.skip_reason).toBe(`Inscription close avant l'envoi (${s.status})`);
      expect((await enrollmentRow(s.enrollmentId)).status, 'inscription inchangée').toBe(s.status);
    }
    expect(await mockCalls(accountId), 'aucun appel au fournisseur').toEqual([]);
  });

  // garde-abonnement
  test('@critical plan effectif free (sans abonnement, essai expiré, abonnement annulé) : rien ne part, pause « subscription_required » ; un essai en cours envoie', async () => {
    const cases = [
      { label: 'sans abonnement', sub: null },
      { label: 'essai expiré', sub: { plan_id: 'cabinet', status: 'trialing', trial_ends_at: minutesFromNow(-24 * 60) } },
      { label: 'abonnement annulé', sub: { plan_id: 'cabinet', status: 'canceled' } },
    ];
    const blocked: Array<{ label: string; accountId: string; enrollmentId: string; execId?: string; steps: SeededStep[]; org: TestOrg }> = [];
    for (const c of cases) {
      const { org, accountId } = await sendingOrg(`E2E E1 Plan ${c.label}`);
      track(org);
      await setSubscription(org.orgId, c.sub);
      const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour plan']);
      const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
      blocked.push({ label: c.label, accountId, enrollmentId, steps, org });
    }
    const trial = await sendingOrg('E2E E1 Plan essai');
    track(trial.org);
    await setSubscription(trial.org.orgId, { plan_id: 'cabinet', status: 'trialing', trial_ends_at: minutesFromNow(7 * 24 * 60) });
    const trialSeq = await messageSequence(trial.org, trial.org.owner.userId, ['Bonjour essai']);
    const trialEnr = await enroll(trial.org, trialSeq.sequenceId, trial.org.owner.userId, trial.accountId);

    for (const b of blocked) b.execId = await schedule(b.org, b.enrollmentId, b.steps[0]);
    const trialExec = await schedule(trial.org, trialEnr.enrollmentId, trialSeq.steps[0]);

    const res = await runCycle();
    const results = res.results as Record<string, number>;
    expect(results.subscription_blocked, 'compteur subscription_blocked').toBeGreaterThanOrEqual(3);

    for (const b of blocked) {
      expect(await postsOf(b.accountId), `${b.label} : rien ne part`).toEqual([]);
      const enr = await enrollmentRow(b.enrollmentId);
      expect(enr.status, b.label).toBe('paused');
      expect(enr.pause_reason, b.label).toBe('subscription_required');
      expect(enr.tracking_data?.pause_reason, b.label).toBe(SUBSCRIPTION_REQUIRED);
      const row = await execRow(b.execId!);
      expect(row?.status, b.label).toBe('cancelled');
      expect(row?.skip_reason, b.label).toBe(SUBSCRIPTION_REQUIRED);
    }
    expect((await postsOf(trial.accountId)).filter(isNewChatPost), 'essai en cours : le message part').toHaveLength(1);
    expect((await execRow(trialExec))?.status).toBe('sent');
  });

  // garde-compte-non-rattache
  test('@critical compte d’envoi relié seulement à une autre organisation : aucun appel, pause « manual » motivée, exécution annulée', async () => {
    const { org } = await sendingOrg('E2E E1 Compte A');
    track(org);
    const other = await createOrg('agency', 'E2E E1 Compte B');
    track(other);
    const foreignAccount = await seedLinkedInAccount(other.orgId, other.owner.userId, `acc_${rand()}`, 'OK');
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour ailleurs']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, foreignAccount);
    const execId = await schedule(org, enrollmentId, steps[0]);

    await runCycle();

    expect(await mockCalls(foreignAccount), 'aucun appel sous le compte d’une autre organisation').toEqual([]);
    const enr = await enrollmentRow(enrollmentId);
    expect(enr.status).toBe('paused');
    expect(enr.pause_reason).toBe('manual');
    expect(enr.tracking_data?.pause_reason).toBe(ACCOUNT_NOT_IN_ORG);
    const row = await execRow(execId);
    expect(row?.status).toBe('cancelled');
    expect(row?.skip_reason).toBe(ACCOUNT_NOT_IN_ORG);
  });

  // garde-compte-non-rattache (variante : user_id hérité dans assigned_sender_id)
  test('identifiant d’utilisateur hérité dans assigned_sender_id : ignoré, le message part du compte de l’inscription, sans pause', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Hérité');
    track(org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour hérité', 'Relance'], 2);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { assigned_sender_id: org.owner.userId });
    const execId = await schedule(org, enrollmentId, steps[0]);

    await runCycle();

    const sends = (await postsOf(accountId)).filter(isNewChatPost);
    expect(sends.map((c) => (c.body as Record<string, unknown>).text)).toEqual(['Bonjour hérité']);
    expect((await execRow(execId))?.status).toBe('sent');
    const enr = await enrollmentRow(enrollmentId);
    expect(enr.status).toBe('active');
    expect(enr.pause_reason).toBeNull();
  });

  // garde-etape-deja-envoyee
  test('@critical même étape déjà partie chez ce candidat (envoyée, ou « annulée » héritée de BUG-095) : sautée « Étape déjà envoyée » sans appel, étape suivante planifiée', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 DéjàEnvoyée');
    track(org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 2);
    const sent = await enroll(org, sequenceId, org.owner.userId, accountId);
    const legacy = await enroll(org, sequenceId, org.owner.userId, accountId);
    const hourAgo = minutesFromNow(-60);
    await schedule(org, sent.enrollmentId, steps[0], { status: 'sent', scheduled_at: hourAgo, executed_at: hourAgo, final_message: 'Bonjour' });
    await schedule(org, legacy.enrollmentId, steps[0], { status: 'cancelled', skip_reason: 'Enrollment became replied during execution', scheduled_at: hourAgo, executed_at: hourAgo });
    const dupSent = await schedule(org, sent.enrollmentId, steps[0]);
    const dupLegacy = await schedule(org, legacy.enrollmentId, steps[0]);

    await runCycle();

    for (const [id, enr, label] of [[dupSent, sent, 'après un envoi'], [dupLegacy, legacy, 'après une annulation héritée']] as const) {
      const row = await execRow(id);
      expect(row?.status, label).toBe('skipped');
      expect(row?.skip_reason, label).toBe('Étape déjà envoyée');
      const next = (await executionsOf(enr.enrollmentId)).filter((x) => x.step_order === 1);
      expect(next.map((x) => x.status), `${label} : étape suivante planifiée`).toEqual(['scheduled']);
    }
    expect(await postsOf(accountId), 'aucun envoi').toEqual([]);
  });

  // garde-desinscription
  test('adresse désinscrite (casse différente, interrupteur coupé) : même une étape LinkedIn ne part pas, inscription terminée, étapes en attente annulées', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Désinscrit');
    track(org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 2);
    await admin().from('outreach_sequences').update({ stop_conditions: { on_reply: true, on_unsubscribe: false } }).eq('id', sequenceId);
    const local = `jean.dupont.${rand()}`;
    const { error: supErr } = await admin().from('suppressed_emails').insert({ email: `${local}@example.com`, reason: 'unsubscribe' });
    if (supErr) throw new Error(`suppressed_emails: ${supErr.message}`);
    cleanups.push(() => admin().from('suppressed_emails').delete().eq('email', `${local}@example.com`));
    // email_used en casse mixte : même adresse une fois en minuscules.
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, {
      email_used: `${local.replace('jean.dupont', 'Jean.Dupont')}@Example.COM`,
    });
    const waiting = await schedule(org, enrollmentId, steps[1], { status: 'waiting_event', scheduled_at: minutesFromNow(2 * 24 * 60) });
    const due = await schedule(org, enrollmentId, steps[0]);

    await runCycle();

    const d = await execRow(due);
    // Décision 28 : l'étape arrêtée par une condition d'arrêt est annulée (avant : sautée).
    expect(d?.status).toBe('cancelled');
    expect(d?.skip_reason).toBe('Stop condition: unsubscribed');
    const enr = await enrollmentFull(enrollmentId);
    expect(enr?.status).toBe('completed');
    expect(enr?.completed_at).toBeTruthy();
    expect((await execRow(waiting))?.status, 'attente annulée').toBe('cancelled');
    expect(await postsOf(accountId)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Vérification de réponse avant une relance
// ═══════════════════════════════════════════════════════════════════════════

test.describe('@critical Vérification de réponse avant relance', () => {
  // verif-reponse-detectee
  test('@critical réponse postérieure à l’invitation : rien ne part, inscription « replied », pipeline de la mission seulement, autres inscriptions du candidat arrêtées, réponse comptée une fois', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Réponse');
    track(org);
    const otherOrg = await createOrg('agency', 'E2E E1 Réponse autre');
    track(otherOrg);
    await setPaidPlan(otherOrg.orgId);
    const otherAccount = await seedLinkedInAccount(otherOrg.orgId, otherOrg.owner.userId, `acc_${rand()}`, 'OK');
    const mission = await seedMission(org.orgId, org.owner.userId);
    const otherMission = await seedMission(org.orgId, org.owner.userId);
    const foreignMission = await seedMission(otherOrg.orgId, otherOrg.owner.userId);
    const chat = replyChat(accountId);
    await setMockMode(accountId, { routes: [
      chatListRoute(chat.id),
      { method: 'GET', path: chat.path, body: candidateReply(minutesFromNow(-60)) },
    ] });

    const profileId = `ACoAAE2E${rand()}${rand()}`;
    const main = await followUpSetup(org, accountId, { profile_id: profileId, job_id: mission });
    // Même candidat dans une autre séquence de l'organisation, et dans une autre organisation.
    const siblingSeq = await messageSequence(org, org.owner.userId, ['Autre séquence']);
    const sibling = await enroll(org, siblingSeq.sequenceId, org.owner.userId, accountId, { profile_id: profileId });
    const siblingExec = await schedule(org, sibling.enrollmentId, siblingSeq.steps[0], { scheduled_at: minutesFromNow(24 * 60) });
    const foreignSeq = await messageSequence(otherOrg, otherOrg.owner.userId, ['Autre organisation']);
    const foreign = await enroll(otherOrg, foreignSeq.sequenceId, otherOrg.owner.userId, otherAccount, { profile_id: profileId });
    await schedule(otherOrg, foreign.enrollmentId, foreignSeq.steps[0], { scheduled_at: minutesFromNow(24 * 60) });
    const jcsMission = await seedJcs(org.orgId, org.owner.userId, mission, profileId);
    const jcsOtherMission = await seedJcs(org.orgId, org.owner.userId, otherMission, profileId);
    const jcsForeign = await seedJcs(otherOrg.orgId, otherOrg.owner.userId, foreignMission, profileId);
    const repliesBefore = await repliesReceived(main.sequenceId);
    const followUp = await schedule(org, main.enrollmentId, main.steps[1]);

    await runCycle();

    expect(await postsOf(accountId), 'aucune relance envoyée').toEqual([]);
    expect((await enrollmentRow(main.enrollmentId)).status).toBe('replied');
    expect((await execRow(followUp))?.status, 'relance annulée').toBe('cancelled');
    expect(await jcsStatus(jcsMission), 'pipeline de la mission : Répondu').toBe('replied');
    expect(await jcsStatus(jcsOtherMission), 'autre mission de l’organisation inchangée').toBe('contacted');
    expect(await jcsStatus(jcsForeign), 'autre organisation inchangée').toBe('contacted');
    expect((await enrollmentRow(sibling.enrollmentId)).status, 'autre inscription du candidat arrêtée').toBe('stopped');
    const sib = await execRow(siblingExec);
    expect(sib?.status).toBe('cancelled');
    expect(sib?.skip_reason).toBe(SIBLING_REPLY);
    expect((await enrollmentRow(foreign.enrollmentId)).status, 'inscription d’une autre organisation intacte').toBe('active');
    expect(await repliesReceived(main.sequenceId), 'réponse comptée une fois').toBe(repliesBefore + 1);
  });

  // verif-reponse-detectee (variante re_enrolled_at)
  test('réponse antérieure à la relance du candidat (re_enrolled_at) : elle ne clôt pas, la relance part', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Relancé');
    track(org);
    const chat = replyChat(accountId);
    await setMockMode(accountId, { routes: [
      chatListRoute(chat.id),
      { method: 'GET', path: chat.path, body: candidateReply(minutesFromNow(-60)) },
    ] });
    const main = await followUpSetup(org, accountId, { tracking_data: { re_enrolled_at: minutesFromNow(-30) } });
    const followUp = await schedule(org, main.enrollmentId, main.steps[1]);

    await runCycle();

    // Dernière étape de la séquence : l'inscription se termine normalement, elle n'est pas close « répondu ».
    expect((await enrollmentRow(main.enrollmentId)).status, 'réponse ancienne ignorée').not.toBe('replied');
    expect((await execRow(followUp))?.status).toBe('sent');
    const sends = await postsOf(accountId);
    expect(sends, 'la relance part dans la conversation existante').toHaveLength(1);
  });

  // verif-reponse-inconnue (5xx, puis 3e essai)
  test('@critical vérification de réponse en 5xx : rien ne part, +30 min et essai 1/3 ; après trois essais : échec « message non envoyé »', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 RéponseInconnue');
    track(org);
    await setMockMode(accountId, { routes: [{ method: 'GET', path: '^/api/v1/chat_attendees/[^/]+/chats$', status: 500, body: { title: 'boom' } }] });
    const first = await followUpSetup(org, accountId);
    const worn = await followUpSetup(org, accountId);
    const e1 = await schedule(org, first.enrollmentId, first.steps[1]);
    const e2 = await schedule(org, worn.enrollmentId, worn.steps[1], { retry_count: 3 });

    const cycleAt = Date.now();
    await runCycle();

    const r1 = await execRow(e1);
    expect(r1?.status).toBe('scheduled');
    expect(r1?.retry_count).toBe(1);
    expect(r1?.error_message).toBe(REPLY_RETRY_1);
    const delay = new Date(r1!.scheduled_at).getTime() - cycleAt;
    expect(delay).toBeGreaterThan(29 * 60_000);
    expect(delay).toBeLessThan(31 * 60_000 + 30_000);
    const r2 = await execRow(e2);
    expect(r2?.status).toBe('failed');
    expect(r2?.error_message).toBe(REPLY_FAILED);
    expect(await postsOf(accountId), 'rien n’est envoyé').toEqual([]);
    expect((await enrollmentRow(first.enrollmentId)).status).toBe('active');
  });

  // verif-reponse-inconnue (403)
  test('@critical vérification de réponse en 403 (candidat qui a bloqué le compte) : pause « blocked_by_candidate », exécution gardée, rien ne part', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Bloqué');
    track(org);
    await setMockMode(accountId, { routes: [{ method: 'GET', path: '^/api/v1/chat_attendees/[^/]+/chats$', status: 403, body: { title: 'forbidden' } }] });
    const main = await followUpSetup(org, accountId);
    const e = await schedule(org, main.enrollmentId, main.steps[1]);

    await runCycle();

    const enr = await enrollmentRow(main.enrollmentId);
    expect(enr.status).toBe('paused');
    expect(enr.pause_reason).toBe('blocked_by_candidate');
    expect((await execRow(e))?.status, 'exécution gardée (pas annulée)').toBe('scheduled');
    expect(await postsOf(accountId)).toEqual([]);
  });

  // verif-reponse-inconnue (délai et expéditeur indéterminé)
  test('vérification de réponse sans réponse au bout de 15 s, ou message d’expéditeur indéterminé : comme un 5xx, rien ne part', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 RéponseLente');
    track(org);
    await setMockMode(accountId, { routes: [{ method: 'GET', path: '^/api/v1/chat_attendees/[^/]+/chats$', status: 200, delay_ms: 16_000, body: { items: [] } }] });
    const slow = await followUpSetup(org, accountId);
    const eSlow = await schedule(org, slow.enrollmentId, slow.steps[1]);

    const other = await sendingOrg('E2E E1 RéponseIndéterminée');
    track(other.org);
    const chat = replyChat(other.accountId);
    await setMockMode(other.accountId, { routes: [
      chatListRoute(chat.id),
      // Message postérieur sans indicateur d'expéditeur, puis participants illisibles.
      { method: 'GET', path: chat.path, times: 1, body: { object: 'MessageList', items: [{ id: `m_${rand()}`, text: '?', timestamp: minutesFromNow(-60), sender_attendee_id: 'att_x' }] } },
      { method: 'GET', path: chat.path, status: 500, body: { title: 'boom' } },
    ] });
    const undetermined = await followUpSetup(other.org, other.accountId);
    const eUnd = await schedule(other.org, undetermined.enrollmentId, undetermined.steps[1]);

    await runCycle();

    for (const [id, acc, label] of [[eSlow, accountId, 'délai'], [eUnd, other.accountId, 'expéditeur indéterminé']] as const) {
      const row = await execRow(id);
      expect(row?.status, label).toBe('scheduled');
      expect(row?.retry_count, label).toBe(1);
      expect(row?.error_message, label).toBe(REPLY_RETRY_1);
      expect(await postsOf(acc), `${label} : rien ne part`).toEqual([]);
    }
  });

  // verrou-execution-optimiste (partie moteur)
  test('@critical étape sautée à la main pendant la vérification de réponse : le verrou « sending » échoue, rien ne part', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Optimiste');
    track(org);
    await setMockMode(accountId, { routes: [{ method: 'GET', path: '^/api/v1/chat_attendees/[^/]+/chats$', status: 200, delay_ms: 5000, times: 1, body: { items: [] } }] });
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 2);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    const twoDaysAgo = minutesFromNow(-2 * 24 * 60);
    await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: twoDaysAgo, executed_at: twoDaysAgo, final_message: 'Bonjour' });
    const token = await ownerToken(org);
    const followUp = await schedule(org, enrollmentId, steps[1]);

    const cycle = runCycle();
    await until(() => mockCalls(accountId), (calls) => calls.some((c) => c.method === 'GET' && c.path.includes('/chat_attendees/')), 'vérification de réponse en cours');
    const skip = await callFunction('process-sequences', token, { action: 'skip_execution', execution_id: followUp });
    expect(skip.status, JSON.stringify(skip.body)).toBe(200);
    await cycle;

    const row = await execRow(followUp);
    expect(row?.status).toBe('skipped');
    expect(row?.skip_reason).toBe(MANUAL_SKIP);
    expect(await postsOf(accountId), 'aucun envoi après le saut').toEqual([]);
  });

  // check-replies-detection
  test('@critical check_replies : réponse détectée, inscription close, étapes annulées, pipeline borné à la mission, autres inscriptions arrêtées', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 CheckReplies');
    track(org);
    const otherOrg = await createOrg('agency', 'E2E E1 CheckReplies autre');
    track(otherOrg);
    const mission = await seedMission(org.orgId, org.owner.userId);
    const foreignMission = await seedMission(otherOrg.orgId, otherOrg.owner.userId);
    const chat = replyChat(accountId);
    await setMockMode(accountId, { routes: [
      chatListRoute(chat.id),
      { method: 'GET', path: chat.path, body: candidateReply(minutesFromNow(-30)) },
    ] });
    const profileId = `ACoAAE2E${rand()}${rand()}`;
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 2);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { profile_id: profileId, job_id: mission, current_step_order: 1 });
    const twoHoursAgo = minutesFromNow(-120);
    await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: twoHoursAgo, executed_at: twoHoursAgo, final_message: 'Bonjour' });
    const next = await schedule(org, enrollmentId, steps[1], { scheduled_at: minutesFromNow(24 * 60) });
    const siblingSeq = await messageSequence(org, org.owner.userId, ['Autre séquence']);
    const sibling = await enroll(org, siblingSeq.sequenceId, org.owner.userId, accountId, { profile_id: profileId });
    await schedule(org, sibling.enrollmentId, siblingSeq.steps[0], { scheduled_at: minutesFromNow(24 * 60) });
    const jcsMission = await seedJcs(org.orgId, org.owner.userId, mission, profileId);
    const jcsForeign = await seedJcs(otherOrg.orgId, otherOrg.owner.userId, foreignMission, profileId);

    const res = await checkRepliesUntilExamined(enrollmentId);

    expect(Number(res.repliesDetected ?? 0)).toBeGreaterThanOrEqual(1);
    expect((await enrollmentRow(enrollmentId)).status).toBe('replied');
    expect((await execRow(next))?.status).toBe('cancelled');
    expect(await jcsStatus(jcsMission)).toBe('replied');
    expect(await jcsStatus(jcsForeign), 'pipeline d’une autre organisation inchangé').toBe('contacted');
    expect((await enrollmentRow(sibling.enrollmentId)).status).toBe('stopped');
    expect(await postsOf(accountId)).toEqual([]);
  });

  // check-replies-detection (lecture impossible, 403)
  test('@critical check_replies : lecture impossible (500) rien n’est décidé ; 403 pause « blocked_by_candidate »', async () => {
    const failing = await sendingOrg('E2E E1 CheckReplies 500');
    track(failing.org);
    await setMockMode(failing.accountId, { routes: [{ method: 'GET', path: '^/api/v1/chat_attendees/[^/]+/chats$', status: 500, body: { title: 'boom' } }] });
    const blocked = await sendingOrg('E2E E1 CheckReplies 403');
    track(blocked.org);
    await setMockMode(blocked.accountId, { routes: [{ method: 'GET', path: '^/api/v1/chat_attendees/[^/]+/chats$', status: 403, body: { title: 'forbidden' } }] });
    const setup = async (org: TestOrg, accountId: string) => {
      const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 2);
      const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
      const twoHoursAgo = minutesFromNow(-120);
      await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: twoHoursAgo, executed_at: twoHoursAgo, final_message: 'Bonjour' });
      const next = await schedule(org, enrollmentId, steps[1], { scheduled_at: minutesFromNow(24 * 60) });
      return { enrollmentId, next };
    };
    const f = await setup(failing.org, failing.accountId);
    const b = await setup(blocked.org, blocked.accountId);

    const res = await checkRepliesUntilExamined(f.enrollmentId, b.enrollmentId);

    expect(Number(res.checkFailed ?? 0), 'lecture impossible comptée').toBeGreaterThanOrEqual(1);
    expect((await enrollmentRow(f.enrollmentId)).status, 'rien n’est décidé').toBe('active');
    expect((await execRow(f.next))?.status).toBe('scheduled');
    const be = await enrollmentRow(b.enrollmentId);
    expect(be.status).toBe('paused');
    expect(be.pause_reason).toBe('blocked_by_candidate');
    expect((await execRow(b.next))?.status, 'étape gardée pendant la pause').toBe('scheduled');
  });
});

/**
 * check_replies ne regarde que 20 inscriptions par passage (les moins
 * récemment contrôlées d'abord) et se limite à un passage toutes les 4 h :
 * la marque est effacée avant chaque appel, jusqu'à ce que nos inscriptions
 * aient été examinées. Renvoie le corps du dernier passage.
 */
async function checkRepliesUntilExamined(...enrollmentIds: string[]): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> = {};
  const totals = { repliesDetected: 0, checkFailed: 0 };
  for (let i = 0; i < 8; i++) {
    await admin().from('internal_config').delete().eq('key', 'last_check_replies');
    last = await runEngine({ action: 'check_replies' });
    totals.repliesDetected += Number(last.repliesDetected ?? 0);
    totals.checkFailed += Number(last.checkFailed ?? 0);
    const { data } = await admin().from('sequence_enrollments').select('id, last_check_at').in('id', enrollmentIds);
    if (((data ?? []) as Array<{ last_check_at: string | null }>).every((r) => !!r.last_check_at)) break;
  }
  await admin().from('internal_config').delete().eq('key', 'last_check_replies');
  return { ...last, ...totals };
}

// ═══════════════════════════════════════════════════════════════════════════
// Plafonds LinkedIn (gate quota)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('@critical Gate quota avant le verrou', () => {
  // quota-gate-refus (plafond journalier)
  test('@critical plafond journalier atteint : la seconde exécution est « quota_blocked », reportée au début de plage du lendemain, rien n’est envoyé', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Quota');
    track(org);
    const { error: qErr } = await admin().from('member_quotas').upsert({
      organization_id: org.orgId, user_id: org.owner.userId, max_actions_per_day: 1, business_hours_start: 8, business_hours_end: 19, timezone: 'Europe/Paris',
    }, { onConflict: 'organization_id,user_id' });
    if (qErr) throw new Error(`member_quotas: ${qErr.message}`);
    const { data: q } = await admin().from('member_quotas').select('max_actions_per_day').eq('organization_id', org.orgId).eq('user_id', org.owner.userId).single();
    expect((q as { max_actions_per_day: number }).max_actions_per_day, 'montage : plafond à 1').toBe(1);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour quota']);
    const first = await enroll(org, sequenceId, org.owner.userId, accountId);
    const second = await enroll(org, sequenceId, org.owner.userId, accountId);
    const e1 = await schedule(org, first.enrollmentId, steps[0], { scheduled_at: minutesFromNow(-2) });
    const e2 = await schedule(org, second.enrollmentId, steps[0], { scheduled_at: minutesFromNow(-1) });

    const cycleAt = Date.now();
    await runCycle();

    expect((await postsOf(accountId)).filter(isNewChatPost), 'un seul envoi').toHaveLength(1);
    expect((await execRow(e1))?.status).toBe('sent');
    const r2 = await execRow(e2);
    expect(r2?.status).toBe('quota_blocked');
    expect(r2?.skip_reason ?? '').toMatch(/^Cap journalier actions LinkedIn atteint \(1\/1\)/);
    expect(new Date(r2!.scheduled_at).toISOString(), 'lendemain 8 h (Paris)').toBe(tomorrowParisAt(8, cycleAt).toISOString());
  });

  // quota-gate-refus (pause fournisseur)
  test('compte en pause fournisseur (quota_paused_until) : « quota_blocked » sans envoi, reporté au lendemain', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 PauseFournisseur');
    track(org);
    await admin().from('member_linkedin_accounts').update({ quota_paused_until: minutesFromNow(60) }).eq('linkedin_account_id', accountId);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour pause']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const e = await schedule(org, enrollmentId, steps[0]);

    const cycleAt = Date.now();
    await runCycle();

    const r = await execRow(e);
    expect(r?.status).toBe('quota_blocked');
    expect(r?.skip_reason).toBe('Compte en pause quota (signal fournisseur atteint).');
    expect(new Date(r!.scheduled_at).toISOString()).toBe(tomorrowParisAt(8, cycleAt).toISOString());
    expect(await postsOf(accountId)).toEqual([]);
  });

  // quota-gate-refus (plafond hebdomadaire d'invitations)
  test('plafond hebdomadaire d’invitations atteint : invitation « quota_blocked », reportée de 24 h, aucune invitation envoyée', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Hebdo');
    track(org);
    const twoDaysAgo = minutesFromNow(-2 * 24 * 60);
    const { error: logErr } = await admin().from('linkedin_action_log').insert(Array.from({ length: 100 }, () => ({
      organization_id: org.orgId, user_id: org.owner.userId, account_id: accountId, action_type: 'connection_request', source: 'e2e', created_at: twoDaysAgo,
    })));
    if (logErr) throw new Error(`linkedin_action_log: ${logErr.message}`);
    const { sequenceId, steps } = await seedSequence(org.orgId, org.owner.userId, [{ action_type: 'connection_request' }, { action_type: 'message' }]);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const e = await schedule(org, enrollmentId, steps[0]);

    const cycleAt = Date.now();
    await runCycle();

    const r = await execRow(e);
    expect(r?.status).toBe('quota_blocked');
    expect(r?.skip_reason ?? '').toMatch(/^Limite hebdo invitations atteinte/);
    const delay = new Date(r!.scheduled_at).getTime() - cycleAt;
    expect(delay).toBeGreaterThan(24 * 3600_000 - 60_000);
    expect(delay).toBeLessThan(24 * 3600_000 + 60_000);
    expect(await postsOf(accountId)).toEqual([]);
  });

  // quota-gate-refus (contrôle indisponible)
  test('contrôle du gate indisponible (solde InMail illisible) : « quota_blocked » reporté de 30 min, rien n’est envoyé', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 GateIndispo');
    track(org);
    await setMockMode(accountId, {
      distance: 'SECOND_DEGREE',
      routes: [{ method: 'GET', path: '^/api/v1/linkedin/inmail_balance$', status: 503, body: { title: 'unavailable' } }],
    });
    const { sequenceId, steps } = await seedSequence(org.orgId, org.owner.userId, [{ action_type: 'inmail' }, { action_type: 'message' }]);
    await admin().from('sequence_steps').update({ message_template: 'Bonjour InMail', subject_template: 'Échange' }).eq('id', steps[0].id);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const e = await schedule(org, enrollmentId, steps[0]);

    const cycleAt = Date.now();
    await runCycle();

    const r = await execRow(e);
    expect(r?.status).toBe('quota_blocked');
    expect(r?.skip_reason).toBe('Contrôle des crédits InMail momentanément indisponible, nouvel essai prochainement');
    const delay = new Date(r!.scheduled_at).getTime() - cycleAt;
    expect(delay).toBeGreaterThan(29 * 60_000);
    expect(delay).toBeLessThan(31 * 60_000 + 30_000);
    expect(await postsOf(accountId)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Dernier contrôle entre le verrou et l'envoi
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deux exécutions du même compte : la première part, la seconde est
 * verrouillée puis attend l'espacement de 5 à 15 s entre deux envois du compte,
 * avant le dernier contrôle. `mutate` agit pendant cette attente.
 */
async function lastCallScenario(prefix: string, mutate: (ctx: { enrollmentId: string; sequenceId: string }) => Promise<unknown>) {
  const { org, accountId } = await sendingOrg(prefix);
  track(org);
  const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour premier', 'Relance']);
  const primer = await enroll(org, sequenceId, org.owner.userId, accountId);
  const target = await enroll(org, sequenceId, org.owner.userId, accountId);
  const targetDue = minutesFromNow(-1);
  await schedule(org, primer.enrollmentId, steps[0], { scheduled_at: minutesFromNow(-2) });
  const targetExec = await schedule(org, target.enrollmentId, steps[0], { scheduled_at: targetDue });

  const cycle = runCycle();
  await until(() => execRow(targetExec), (r) => r?.status === 'sending', 'seconde exécution verrouillée', 60_000, 50);
  await mutate({ enrollmentId: target.enrollmentId, sequenceId });
  await cycle;

  const posts = (await postsOf(accountId)).filter(isNewChatPost);
  return { accountId, targetExec, targetDue, target, primer, posts };
}

/** Seul le premier message (inscription d'amorce) est parti ; rien vers le candidat ciblé. */
function expectOnlyPrimerSent(s: Awaited<ReturnType<typeof lastCallScenario>>) {
  expect(s.posts, 'seul le premier message part').toHaveLength(1);
  expect((s.posts[0].body as Record<string, unknown>).attendees_ids).toBe(s.primer.profileId);
}

test.describe('@critical Dernier contrôle avant l’envoi', () => {
  // dernier-controle-avant-envoi (a)
  test('@critical inscription mise en pause entre le verrou et l’envoi : l’exécution redevient « scheduled » avec son contenu d’avant, rien ne part', async () => {
    const s = await lastCallScenario('E2E E1 Dernier pause', ({ enrollmentId }) =>
      admin().from('sequence_enrollments').update({ status: 'paused', pause_reason: 'manual' }).eq('id', enrollmentId));
    expectOnlyPrimerSent(s);
    const row = await execRow(s.targetExec);
    expect(row?.status).toBe('scheduled');
    expect(row?.final_message, 'contenu d’avant le verrou').toBeNull();
    expect(new Date(row!.scheduled_at).getTime(), 'date gardée').toBe(new Date(s.targetDue).getTime());
  });

  // dernier-controle-avant-envoi (b)
  test('@critical séquence désactivée entre le verrou et l’envoi : l’exécution redevient « scheduled », rien ne part', async () => {
    const s = await lastCallScenario('E2E E1 Dernier désactivée', ({ sequenceId }) =>
      admin().from('outreach_sequences').update({ is_active: false }).eq('id', sequenceId));
    expectOnlyPrimerSent(s);
    const row = await execRow(s.targetExec);
    expect(row?.status).toBe('scheduled');
    expect(row?.final_message).toBeNull();
    expect(new Date(row!.scheduled_at).getTime()).toBe(new Date(s.targetDue).getTime());
  });

  // dernier-controle-avant-envoi (c)
  test('@critical réponse entre le verrou et l’envoi : exécution annulée « Enrollment became replied before send », rien ne part', async () => {
    const s = await lastCallScenario('E2E E1 Dernier réponse', ({ enrollmentId }) =>
      admin().from('sequence_enrollments').update({ status: 'replied', replied_at: new Date().toISOString() }).eq('id', enrollmentId));
    expectOnlyPrimerSent(s);
    const row = await execRow(s.targetExec);
    expect(row?.status).toBe('cancelled');
    expect(row?.skip_reason ?? '').toMatch(/^Enrollment became replied before send/);
  });

  // dernier-controle-avant-envoi (d)
  test('@critical inscription supprimée entre le verrou et l’envoi : rien ne part', async () => {
    const s = await lastCallScenario('E2E E1 Dernier supprimée', ({ enrollmentId }) =>
      admin().from('sequence_enrollments').delete().eq('id', enrollmentId));
    expectOnlyPrimerSent(s);
    expect(await execRow(s.targetExec), 'exécution supprimée avec l’inscription').toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Issue incertaine d'un envoi
// ═══════════════════════════════════════════════════════════════════════════

test.describe('@critical Issue de l’envoi', () => {
  // issue-5xx
  test('@critical 5xx du POST d’envoi : « Envoi incertain », un seul POST, aucune relance, inscription non avancée', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 5xx');
    track(org);
    await setMockMode(accountId, { fail_send: 500 });
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour 5xx', 'Relance']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const e = await schedule(org, enrollmentId, steps[0]);

    await runCycle();

    const row = await execRow(e);
    expect(row?.status).toBe('failed');
    expect(row?.error_message).toBe(UNCERTAIN);
    expect(row?.retry_count ?? 0).toBe(0);
    expect(await postsOf(accountId), 'un seul POST').toHaveLength(1);
    expect((await enrollmentRow(enrollmentId)).current_step_order).toBe(0);
    expect(await executionsOf(enrollmentId), 'aucune étape suivante').toHaveLength(1);

    await runCycle();
    expect(await postsOf(accountId), 'aucun nouvel essai au cycle suivant').toHaveLength(1);
    expect((await execRow(e))?.status).toBe('failed');
  });

  // issue-5xx (conversation existante)
  test('@critical 502 sur une conversation existante : jamais de nouvelle conversation, « Envoi incertain »', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 502');
    track(org);
    const chat = replyChat(accountId);
    await setMockMode(accountId, { routes: [
      chatListRoute(chat.id),
      { method: 'POST', path: chat.path, status: 502, body: { title: 'bad gateway' } },
    ] });
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour 502']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const e = await schedule(org, enrollmentId, steps[0]);

    await runCycle();

    const posts = await postsOf(accountId);
    expect(posts, 'un seul POST, dans la conversation existante').toHaveLength(1);
    expect(posts.filter(isNewChatPost), 'aucune nouvelle conversation').toHaveLength(0);
    const row = await execRow(e);
    expect(row?.status).toBe('failed');
    expect(row?.error_message).toBe(UNCERTAIN);
  });

  // issue-timeout
  test('@critical POST d’envoi sans réponse au bout de 15 s : « Envoi incertain », jamais un second POST', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Délai');
    track(org);
    await setMockMode(accountId, { routes: [{
      method: 'POST', path: '^/api/v1/chats$', status: 201, delay_ms: 16_000,
      body: { object: 'ChatStarted', chat_id: `chat_${rand()}`, message_id: `msg_${rand()}` },
    }] });
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour délai', 'Relance']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const e = await schedule(org, enrollmentId, steps[0]);

    await runCycle();

    const row = await execRow(e);
    expect(row?.status).toBe('failed');
    expect(row?.error_message).toBe(UNCERTAIN);
    expect(await postsOf(accountId)).toHaveLength(1);

    await runCycle();
    expect(await postsOf(accountId), 'aucun second POST').toHaveLength(1);
    expect((await enrollmentRow(enrollmentId)).current_step_order).toBe(0);
  });

  // issue-statut-change-pendant-envoi
  for (const change of ['paused', 'replied'] as const) {
    test(`@critical inscription passée « ${change} » pendant l’appel d’envoi : exécution « sent » avec motif, position avancée, rien de planifié`, async () => {
      const { org, accountId } = await sendingOrg(`E2E E1 Pendant ${change}`);
      track(org);
      await setMockMode(accountId, { routes: [{
        method: 'POST', path: '^/api/v1/chats$', status: 201, delay_ms: 6000,
        body: { object: 'ChatStarted', chat_id: `chat_${rand()}`, message_id: `msg_${rand()}` },
      }] });
      const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour pendant', 'Relance'], 2);
      const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
      const e = await schedule(org, enrollmentId, steps[0]);

      const cycle = runCycle();
      await until(() => postsOf(accountId), (p) => p.some(isNewChatPost), 'POST d’envoi reçu');
      await admin().from('sequence_enrollments').update(change === 'paused'
        ? { status: 'paused', pause_reason: 'manual' }
        : { status: 'replied', replied_at: new Date().toISOString() }).eq('id', enrollmentId);
      await cycle;

      const row = await execRow(e);
      expect(row?.status, 'le message est parti : jamais « annulé »').toBe('sent');
      expect(row?.skip_reason).toBe(`Inscription devenue ${change} pendant l'envoi`);
      expect((await enrollmentRow(enrollmentId)).current_step_order).toBe(1);
      expect((await executionsOf(enrollmentId)).filter((x) => x.step_order === 1), 'aucune étape suivante planifiée').toHaveLength(0);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Sélection du cycle
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Sélection du cycle', () => {
  // selection-plafond-par-compte
  test('trois envois au plus par compte et par cycle, espacés de 5 à 15 s ; les autres gardent leur date ; un autre compte n’attend pas', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 Plafond');
    const member = await addMember(org.orgId, 'member', 'plafond');
    track(org, [member]);
    const accountB = await seedLinkedInAccount(org.orgId, member.userId, `acc_${rand()}`, 'OK');
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour plafond']);
    const seqB = await messageSequence(org, member.userId, ['Bonjour compte B']);
    const aEnrollments = [];
    for (let i = 0; i < 5; i++) aEnrollments.push(await enroll(org, sequenceId, org.owner.userId, accountId));
    const bEnrollment = await enroll(org, seqB.sequenceId, member.userId, accountB);
    // Ordre de sélection : A1, B1, A2, A3, A4, A5.
    const base = Date.now() - 30 * 60_000;
    const at = (k: number) => new Date(base + k * 60_000).toISOString();
    const aExecs: Array<{ id: string; at: string }> = [];
    aExecs.push({ id: await schedule(org, aEnrollments[0].enrollmentId, steps[0], { scheduled_at: at(0) }), at: at(0) });
    await schedule(org, bEnrollment.enrollmentId, seqB.steps[0], { scheduled_at: at(1) });
    for (let i = 1; i < 5; i++) aExecs.push({ id: await schedule(org, aEnrollments[i].enrollmentId, steps[0], { scheduled_at: at(i + 1) }), at: at(i + 1) });

    await runCycle();

    const aPosts = (await postsOf(accountId)).filter(isNewChatPost);
    const bPosts = (await postsOf(accountB)).filter(isNewChatPost);
    expect(aPosts, 'trois envois pour le compte A').toHaveLength(3);
    expect(bPosts, 'un envoi pour le compte B').toHaveLength(1);
    const times = aPosts.map((p) => new Date(p.at).getTime());
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      expect(gap, `écart entre envois ${i} et ${i + 1} du compte A`).toBeGreaterThanOrEqual(4_900);
      expect(gap).toBeLessThan(17_000);
    }
    expect(new Date(bPosts[0].at).getTime() - times[0], 'le premier envoi du compte B n’attend pas l’espacement du compte A').toBeLessThan(5_000);
    for (const ex of aExecs.slice(3)) {
      const row = await execRow(ex.id);
      expect(row?.status, 'au-delà du plafond : gardée').toBe('scheduled');
      expect(new Date(row!.scheduled_at).getTime(), 'date inchangée').toBe(new Date(ex.at).getTime());
    }

    await runCycle();
    expect((await postsOf(accountId)).filter(isNewChatPost), 'les deux dernières partent au cycle suivant').toHaveLength(5);
  });

  // selection-plafond-par-compte (étapes invisibles et inscriptions closes)
  test('au plus 15 étapes invisibles et 30 exécutions d’inscriptions closes par cycle : les autres gardent leur date', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 PlafondsCycle');
    track(org);
    const visits = await seedSequence(org.orgId, org.owner.userId, [{ action_type: 'profile_visit' }, { action_type: 'message', delay_days: 2 }]);
    const closedSeq = await messageSequence(org, org.owner.userId, ['Bonjour clos']);
    // Nos exécutions sont les plus anciennes dues : sélectionnées avant celles d'autres suites.
    const base = Date.now() - 24 * 3600_000;
    const at = (i: number) => new Date(base + i * 1000).toISOString();
    const { data: visitEnr, error: vErr } = await admin().from('sequence_enrollments').insert(Array.from({ length: 20 }, (_, i) => ({
      sequence_id: visits.sequenceId, organization_id: org.orgId, created_by: org.owner.userId, account_id: accountId,
      profile_id: `ACoAAE2EVIS${rand()}${i}`, profile_name: 'Candidat Visite', status: 'active', current_step_order: 0, user_timezone: 'Europe/Paris',
    }))).select('id');
    if (vErr || !visitEnr) throw new Error(`visites: ${vErr?.message}`);
    const { data: closedEnr, error: cErr } = await admin().from('sequence_enrollments').insert(Array.from({ length: 35 }, (_, i) => ({
      sequence_id: closedSeq.sequenceId, organization_id: org.orgId, created_by: org.owner.userId, account_id: accountId,
      profile_id: `ACoAAE2ECLO${rand()}${i}`, profile_name: 'Candidat Clos', status: 'stopped', completed_at: at(0), current_step_order: 0, user_timezone: 'Europe/Paris',
    }))).select('id');
    if (cErr || !closedEnr) throw new Error(`closes: ${cErr?.message}`);
    // Autres exécutions dues plus anciennes que les nôtres (suites voisines) : elles passeraient avant.
    const { count: olderDue } = await admin().from('sequence_step_executions').select('id', { count: 'exact', head: true })
      .eq('status', 'scheduled').lt('scheduled_at', at(0)).neq('organization_id', org.orgId);
    expect(olderDue ?? 0, 'montage : aucune autre exécution due plus ancienne').toBe(0);
    const { data: visitExecs, error: veErr } = await admin().from('sequence_step_executions').insert((visitEnr as Array<{ id: string }>).map((r, i) => ({
      enrollment_id: r.id, organization_id: org.orgId, step_id: visits.steps[0].id, step_order: 0, status: 'scheduled', scheduled_at: at(i),
    }))).select('id, scheduled_at');
    if (veErr || !visitExecs) throw new Error(`exécutions visites: ${veErr?.message}`);
    const { data: closedExecs, error: ceErr } = await admin().from('sequence_step_executions').insert((closedEnr as Array<{ id: string }>).map((r, i) => ({
      enrollment_id: r.id, organization_id: org.orgId, step_id: closedSeq.steps[0].id, step_order: 0, status: 'scheduled', scheduled_at: at(100 + i),
    }))).select('id, scheduled_at');
    if (ceErr || !closedExecs) throw new Error(`exécutions closes: ${ceErr?.message}`);

    await runCycle();

    const statuses = async (rows: Array<{ id: string; scheduled_at: string }>) => {
      const { data } = await admin().from('sequence_step_executions').select('id, status, scheduled_at').in('id', rows.map((r) => r.id));
      return (data ?? []) as Array<{ id: string; status: string; scheduled_at: string }>;
    };
    const v = await statuses(visitExecs as Array<{ id: string; scheduled_at: string }>);
    expect(v.filter((x) => x.status === 'sent'), '15 visites au plus dans le cycle').toHaveLength(15);
    const vLeft = v.filter((x) => x.status === 'scheduled');
    expect(vLeft).toHaveLength(5);
    const visitAt = new Map((visitExecs as Array<{ id: string; scheduled_at: string }>).map((r) => [r.id, new Date(r.scheduled_at).getTime()]));
    for (const x of vLeft) expect(new Date(x.scheduled_at).getTime(), 'visite en trop : date gardée').toBe(visitAt.get(x.id));
    const c = await statuses(closedExecs as Array<{ id: string; scheduled_at: string }>);
    expect(c.filter((x) => x.status === 'cancelled'), '30 exécutions closes au plus dans le cycle').toHaveLength(30);
    expect(c.filter((x) => x.status === 'scheduled')).toHaveLength(5);
    expect(await postsOf(accountId), 'aucun envoi visible').toEqual([]);
  });

  // selection-un-par-candidat
  test('deux exécutions échues vers le même candidat : une seule par cycle, la plus ancienne ; l’autre garde sa date', async () => {
    const { org, accountId } = await sendingOrg('E2E E1 UnParCandidat');
    track(org);
    const s1 = await messageSequence(org, org.owner.userId, ['Message séquence un']);
    const s2 = await messageSequence(org, org.owner.userId, ['Message séquence deux']);
    const profileId = `ACoAAE2E${rand()}${rand()}`;
    const e1 = await enroll(org, s1.sequenceId, org.owner.userId, accountId, { profile_id: profileId });
    const e2 = await enroll(org, s2.sequenceId, org.owner.userId, accountId, { profile_id: profileId });
    const olderAt = minutesFromNow(-10);
    const newerAt = minutesFromNow(-5);
    const older = await schedule(org, e1.enrollmentId, s1.steps[0], { scheduled_at: olderAt });
    const newer = await schedule(org, e2.enrollmentId, s2.steps[0], { scheduled_at: newerAt });

    await runCycle();

    const sends = (await postsOf(accountId)).filter(isNewChatPost);
    expect(sends.map((p) => (p.body as Record<string, unknown>).text)).toEqual(['Message séquence un']);
    expect((await execRow(older))?.status).toBe('sent');
    const n = await execRow(newer);
    expect(n?.status).toBe('scheduled');
    expect(new Date(n!.scheduled_at).getTime()).toBe(new Date(newerAt).getTime());
  });
});

/**
 * Lot « steps-2 » du module séquences : conditions, attentes, enchaînement des
 * étapes, variantes A/B, garde « aucun message précédent », rédaction IA,
 * variables des modèles, arrêts toujours actifs, rotation des expéditeurs et
 * file InMail. Contrat : CLAUDE.md (« Séquences : règles du moteur et de
 * l'interface ») et docs/audit-2026-09-25-sequences.md.
 *
 * Le moteur process-sequences et process-inmail-queue tournent pour de vrai
 * sur la stack locale ; LinkedIn et l'IA sont simulés par
 * e2e/local-stack/vendor-mock.mjs, qui journalise chaque appel.
 *
 * Deux contournements du faux prestataire, documentés ici :
 *  - La lecture des messages d'une conversation (GET /chats/<id>/messages)
 *    ne porte pas account_id : le faux prestataire ne peut pas la rattacher à
 *    un compte. Le fil renvoyé par GET /chat_attendees/<profil>/chats (qui,
 *    lui, porte account_id) a un identifiant qui embarque
 *    « ?account_id=<compte>&x= » : la lecture des messages arrive alors avec
 *    le bon compte et reçoit la réponse scriptée du test, sans toucher à la
 *    clé '*' partagée.
 *  - L'appel à l'IA ne porte aucun compte : sa réponse ne se règle que pour
 *    tous ('*'), interdit ici. Les appels IA d'un test sont reconnus par un
 *    marqueur unique placé dans le modèle de l'étape (le prompt le cite).
 *
 * Aujourd'hui est un dimanche : `force: true` lève la fenêtre d'envoi du
 * moteur. La file InMail n'a pas d'option équivalente : son titulaire est
 * placé dans un fuseau où c'est un jour ouvré (réglage produit de member_quotas).
 */
import { test, expect } from '@playwright/test';
import {
  addMember, admin, createOrg, deleteOrg, seedLinkedInAccount, seedMission, setOrgPlan, signIn,
  type SeededStep, type TestOrg, type TestUser,
} from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  callFunction,
  engineAvailable,
  enroll,
  enrollmentRow,
  minutesFromNow,
  mockCalls,
  rand,
  runCycle,
  runEngine,
  schedule,
  sendingOrg,
  sentTexts,
  setMockMode,
  type MockRoute,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
// Exécution une à une (--workers=1) sans le mode 'serial' : ce fichier garde
// des tests en échec qui signalent un défaut (« DÉFAUT »), et le mode 'serial'
// arrêterait tout le fichier au premier d'entre eux. Chaque test est
// indépendant (organisation, comptes et profils propres).
test.describe.configure({ mode: 'default' });
test.setTimeout(300_000);

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const accountsToReset: string[] = [];
const suppressedToDelete: string[] = [];
const inmailOrgsToClean: string[] = [];

test.afterEach(async () => {
  for (const acc of accountsToReset.splice(0)) await setMockMode(acc, {});
  for (const email of suppressedToDelete.splice(0)) await admin().from('suppressed_emails').delete().eq('email', email);
  for (const orgId of inmailOrgsToClean.splice(0)) await admin().from('inmail_queue').delete().eq('organization_id', orgId);
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    await deleteOrg(org, extra);
  }
});

// ─── Aides locales ──────────────────────────────────────────────────────────

const daysAgo = (d: number) => minutesFromNow(-d * 24 * 60);

async function paidOrg(prefix: string) {
  const { org, accountId } = await sendingOrg(prefix);
  orgsToDelete.push({ org, extra: [] });
  accountsToReset.push(accountId);
  return { org, accountId };
}

interface StepSpec {
  action_type: string;
  step_order?: number;
  message_template?: string | null;
  subject_template?: string | null;
  condition_type?: string | null;
  wait_for_event?: string | null;
  timeout_days?: number | null;
  delay_days?: number;
  ends_sequence?: boolean;
  variant_group?: string | null;
  variant_weight?: number;
  use_ai_personalization?: boolean;
}

/** Séquence active avec des étapes aux colonnes libres ; étapes rendues dans l'ordre donné. */
async function buildSequence(org: TestOrg, createdBy: string, specs: StepSpec[], seqExtra: Record<string, unknown> = {}) {
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({ name: `Séquence steps-2 ${rand()}`, organization_id: org.orgId, created_by: createdBy, is_active: true, ...seqExtra })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`buildSequence: ${error?.message}`);
  const steps: SeededStep[] = [];
  for (const [i, s] of specs.entries()) {
    const { data, error: stepErr } = await admin()
      .from('sequence_steps')
      .insert({
        sequence_id: seq.id,
        step_order: s.step_order ?? i,
        action_type: s.action_type,
        message_template: s.message_template ?? null,
        subject_template: s.subject_template ?? null,
        condition_type: s.condition_type ?? null,
        wait_for_event: s.wait_for_event ?? null,
        timeout_days: s.timeout_days ?? null,
        delay_days: s.delay_days ?? 0,
        ends_sequence: s.ends_sequence ?? false,
        variant_group: s.variant_group ?? null,
        variant_weight: s.variant_weight ?? 100,
        use_ai_personalization: s.use_ai_personalization ?? false,
      })
      .select('id, step_order, action_type')
      .single();
    if (stepErr || !data) throw new Error(`buildSequence(step ${i}): ${stepErr?.message}`);
    steps.push(data as SeededStep);
  }
  return { sequenceId: seq.id as string, steps };
}

async function patchStep(stepId: string, patch: Record<string, unknown>) {
  const { error } = await admin().from('sequence_steps').update(patch).eq('id', stepId);
  if (error) throw new Error(`patchStep: ${error.message}`);
}

interface ExecRow {
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
  variant_assigned: string | null;
  tracking_data: Record<string, unknown> | null;
}

async function execs(enrollmentId: string): Promise<ExecRow[]> {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .select('id, step_id, step_order, status, scheduled_at, executed_at, final_message, final_subject, skip_reason, error_message, retry_count, variant_assigned, tracking_data')
    .eq('enrollment_id', enrollmentId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`execs: ${error.message}`);
  return (data ?? []) as ExecRow[];
}

async function execById(id: string): Promise<ExecRow> {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .select('id, step_id, step_order, status, scheduled_at, executed_at, final_message, final_subject, skip_reason, error_message, retry_count, variant_assigned, tracking_data')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`execById: ${error?.message}`);
  return data as ExecRow;
}

/** Ramène une exécution planifiée (souvent lundi 9 h, week-end oblige) à maintenant. */
async function makeDue(execId: string, extra: Record<string, unknown> = {}) {
  const { error } = await admin().from('sequence_step_executions')
    .update({ scheduled_at: minutesFromNow(-1), ...extra }).eq('id', execId);
  if (error) throw new Error(`makeDue: ${error.message}`);
}

async function enrollmentFull(id: string) {
  const { data } = await admin()
    .from('sequence_enrollments')
    .select('status, pause_reason, completed_at, replied_at, connection_status, assigned_sender_id, current_step_order')
    .eq('id', id)
    .single();
  return data as {
    status: string; pause_reason: string | null; completed_at: string | null; replied_at: string | null;
    connection_status: string | null; assigned_sender_id: string | null; current_step_order: number;
  };
}

/** Envois LinkedIn (nouvelle conversation ou suite) faits depuis ce compte, corps multipart compris. */
async function sends(accountId: string): Promise<Array<Record<string, string>>> {
  return (await mockCalls(accountId))
    .filter((c) => c.method === 'POST' && (c.path === '/api/v1/chats' || /^\/api\/v1\/chats\/[^/]+\/messages$/.test(c.path)))
    .map((c) => c.body as Record<string, string>);
}

/** Appels à l'IA dont le prompt cite le marqueur du test. */
async function aiCallsWith(marker: string) {
  return (await mockCalls()).filter((c) => c.method === 'POST' && c.path === '/v1/messages' && JSON.stringify(c.body).includes(marker));
}

/**
 * Routes d'un fil LinkedIn avec une réponse du candidat datée `replyAt`
 * (is_sender 0 = le candidat). Voir le contournement en tête de fichier.
 */
function replyRoutes(accountId: string, profileId: string, replyAt: string): MockRoute[] {
  const chatId = `cE2E${rand()}${rand()}`;
  return [
    {
      method: 'GET',
      path: `^/api/v1/chat_attendees/${profileId}/chats$`,
      body: { object: 'ChatList', items: [{ id: `${chatId}/messages?account_id=${encodeURIComponent(accountId)}&x=` }], cursor: null },
    },
    {
      method: 'GET',
      path: `^/api/v1/chats/${chatId}/messages$`,
      body: { object: 'MessageList', items: [{ id: `m_${rand()}`, is_sender: 0, timestamp: replyAt, text: 'Oui, avec plaisir' }], cursor: null },
    },
  ];
}

/**
 * Cycles du moteur jusqu'à ce que chaque exécution donnée ait été traitée
 * (plus due), cinq au plus : d'autres suites partagent le moteur, son verrou
 * et son budget de 40 s, une exécution peut attendre le cycle suivant.
 */
async function cycleFor(...execIds: string[]) {
  for (let i = 0; i < 5; i++) {
    await runCycle();
    const { data } = await admin().from('sequence_step_executions').select('id, status, scheduled_at').in('id', execIds);
    const pending = ((data ?? []) as Array<{ status: string; scheduled_at: string }>)
      .filter((r) => r.status === 'scheduled' && new Date(r.scheduled_at).getTime() <= Date.now());
    if (pending.length === 0) return;
  }
}

/** check_timeouts jusqu'à ce que l'attente ait quitté 'waiting_event' (trois passages au plus). */
async function timeoutsFor(waitId: string) {
  for (let i = 0; i < 3; i++) {
    await runEngine({ action: 'check_timeouts' });
    const { data } = await admin().from('sequence_step_executions').select('status').eq('id', waitId).single();
    if (data?.status !== 'waiting_event') return;
  }
}

async function actionLogCount(accountId: string, actionType: string): Promise<number> {
  const { count, error } = await admin().from('linkedin_action_log')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('action_type', actionType);
  if (error) throw new Error(`actionLogCount: ${error.message}`);
  return count ?? 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Conditions « Si connecté » / « Si non connecté » / « Si pas de réponse »
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Conditions évaluées à l’exécution', () => {
  // engine-conditions-connected
  test('« Si connecté » fausse : étape sautée « Condition: if_connected », puis l’InMail « Si non connecté » part avec son objet', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 cond');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', condition_type: 'if_connected', message_template: 'A' },
      { action_type: 'inmail', condition_type: 'if_not_connected', message_template: 'B', subject_template: 'O' },
    ]);
    await setMockMode(accountId, { distance: 'SECOND_DEGREE' });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const first = await schedule(org, enrollmentId, steps[0]);

    await cycleFor(first);
    const afterFirst = await execById(first);
    expect(afterFirst.status, 'étape « Si connecté » sautée').toBe('skipped');
    expect(afterFirst.skip_reason).toBe('Condition: if_connected');
    expect(await sentTexts(accountId), 'rien ne part pour une condition fausse').toEqual([]);
    const next = (await execs(enrollmentId)).find((e) => e.step_id === steps[1].id);
    expect(next?.status, 'la suite est planifiée').toBe('scheduled');

    await makeDue(next!.id);
    await cycleFor(next!.id);
    const second = await execById(next!.id);
    expect(second.status, 'InMail parti, pas de clôture « no_previous_message »').toBe('sent');
    expect(second.skip_reason).not.toBe('no_previous_message');
    const bodies = await sends(accountId);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].text).toBe('B');
    expect(bodies[0]['linkedin[inmail]'], 'envoi en InMail').toBe('true');
    expect(bodies[0].subject).toBe('O');
  });

  // engine-conditions-connected
  test('« Si non connecté » : candidat connu connecté en base, profil au 2e degré : étape sautée sans envoi', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 cond base');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'inmail', condition_type: 'if_not_connected', message_template: 'B', subject_template: 'O' },
    ]);
    await setMockMode(accountId, { distance: 'SECOND_DEGREE' });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { connection_status: 'connected' });
    const exec = await schedule(org, enrollmentId, steps[0]);

    await cycleFor(exec);
    const row = await execById(exec);
    expect(row.status).toBe('skipped');
    expect(row.skip_reason).toBe('Condition: if_not_connected');
    expect(await sentTexts(accountId)).toEqual([]);
  });

  // engine-conditions-connected
  test('Profil LinkedIn illisible (503) : l’étape conditionnelle est retentée (1/3), puis passe en échec, jamais tranchée', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 cond 503');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', condition_type: 'if_connected', message_template: 'A' },
    ]);
    const profileId = `ACoAAE2E${rand()}${rand()}`;
    await setMockMode(accountId, { routes: [{ method: 'GET', path: `^/api/v1/users/${profileId}$`, status: 503, body: { status: 503 } }] });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { profile_id: profileId });
    const initialConnection = (await enrollmentFull(enrollmentId)).connection_status;
    const exec = await schedule(org, enrollmentId, steps[0]);

    const before = Date.now();
    await cycleFor(exec);
    const retried = await execById(exec);
    expect(retried.status, 'étape toujours planifiée').toBe('scheduled');
    expect(retried.retry_count).toBe(1);
    expect(retried.error_message).toBe('Lecture du profil LinkedIn impossible : nouvel essai 1/3 dans 30 min');
    expect(new Date(retried.scheduled_at).getTime()).toBeGreaterThan(before + 25 * 60_000);
    expect((await enrollmentFull(enrollmentId)).connection_status, 'connection_status non écrasé').toBe(initialConnection);

    await makeDue(exec, { retry_count: 3 });
    await cycleFor(exec);
    const failed = await execById(exec);
    expect(failed.status, 'échec après trois essais').toBe('failed');
    expect(failed.error_message).toBe("Lecture du profil LinkedIn impossible après plusieurs essais : relancez l'étape plus tard.");
    expect(await sentTexts(accountId)).toEqual([]);
  });

  // engine-condition-no-response
  test('« Si pas de réponse » : réponse du candidat après le dernier envoi, étape sautée sans envoi ; sans réponse, elle part', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 no-resp');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', condition_type: 'if_no_response', message_template: 'Relance', delay_days: 2 },
    ]);
    const replied = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    const silent = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await setMockMode(accountId, { routes: replyRoutes(accountId, replied.profileId, minutesFromNow(-60)) });
    for (const e of [replied, silent]) {
      await schedule(org, e.enrollmentId, steps[0], { status: 'sent', scheduled_at: daysAgo(2), executed_at: daysAgo(2), final_message: 'Bonjour' });
    }
    const repliedExec = await schedule(org, replied.enrollmentId, steps[1]);
    const silentExec = await schedule(org, silent.enrollmentId, steps[1]);

    await cycleFor(repliedExec, silentExec);
    const skipped = await execById(repliedExec);
    expect(skipped.status, 'réponse vue : étape sautée').toBe('skipped');
    expect(skipped.skip_reason).toBe('Condition: if_no_response');
    const sentRow = await execById(silentExec);
    expect(sentRow.status, 'sans réponse : la relance part').toBe('sent');
    const bodies = await sends(accountId);
    expect(bodies, 'un seul envoi, pour le candidat silencieux').toHaveLength(1);
    expect(bodies[0].text).toBe('Relance');
    expect(bodies[0].attendees_ids).toBe(silent.profileId);
  });

  // engine-condition-no-response
  test('« Si pas de réponse » : vérification impossible (503), étape retentée puis en échec, rien n’est envoyé sur un doute', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 no-resp 503');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', condition_type: 'if_no_response', message_template: 'Relance', delay_days: 2 },
    ]);
    const profileId = `ACoAAE2E${rand()}${rand()}`;
    await setMockMode(accountId, { routes: [{ method: 'GET', path: `^/api/v1/chat_attendees/${profileId}/chats$`, status: 503, body: {} }] });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { profile_id: profileId, current_step_order: 1 });
    await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: daysAgo(2), executed_at: daysAgo(2), final_message: 'Bonjour' });
    const exec = await schedule(org, enrollmentId, steps[1]);

    await cycleFor(exec);
    const retried = await execById(exec);
    expect(retried.status).toBe('scheduled');
    expect(retried.retry_count).toBe(1);
    expect(retried.error_message).toBe("Vérification de réponse impossible : nouvel essai 1/3 dans 30 min, rien n'a été envoyé");

    await makeDue(exec, { retry_count: 3 });
    await cycleFor(exec);
    const failed = await execById(exec);
    expect(failed.status).toBe('failed');
    expect(failed.error_message).toBe("Vérification de réponse impossible : message non envoyé. Vérifiez la conversation puis relancez l'étape.");
    expect(await sentTexts(accountId), 'jamais d’envoi sur un doute').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// « Attendre une réponse »
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Attente de réponse', () => {
  // engine-wait-reply
  test('« Attendre une réponse » sans wait_for_event : sans réponse, l’étape attend (jamais « a répondu ») ; délai dépassé, la relance est planifiée', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 wait');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'wait_reply', timeout_days: 3 },
      { action_type: 'message', message_template: 'Relance' },
    ]);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: daysAgo(2), executed_at: daysAgo(2), final_message: 'Bonjour' });
    const wait = await schedule(org, enrollmentId, steps[1]);

    await cycleFor(wait);
    const waiting = await execById(wait);
    expect(waiting.status, 'attente en cours').toBe('waiting_event');
    const enr = await enrollmentFull(enrollmentId);
    expect(enr.status, 'jamais « a répondu » sans réponse').toBe('active');
    expect(enr.replied_at).toBeNull();

    // Délai de 3 jours dépassé : check_timeouts expire l'attente et planifie la relance.
    await admin().from('sequence_step_executions').update({ scheduled_at: daysAgo(4) }).eq('id', wait);
    await timeoutsFor(wait);
    const expired = await execById(wait);
    expect(expired.status).toBe('skipped');
    expect(expired.skip_reason).toMatch(/^Timeout 3d/);
    const followUp = (await execs(enrollmentId)).find((e) => e.step_id === steps[2].id);
    expect(followUp?.status, 'relance planifiée au délai dépassé').toBe('scheduled');
    expect((await enrollmentFull(enrollmentId)).status).toBe('active');
    expect(await sentTexts(accountId)).toEqual([]);
  });

  // engine-wait-reply
  for (const waitForEvent of [null, 'reply_received'] as const) {
    test(`« Attendre une réponse » (wait_for_event ${waitForEvent ?? 'absent'}) : le candidat répond, inscription « a répondu », relance jamais planifiée`, async () => {
      const { org, accountId } = await paidOrg('E2E steps-2 wait reply');
      const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
        { action_type: 'message', message_template: 'Bonjour' },
        { action_type: 'wait_reply', timeout_days: 3, wait_for_event: waitForEvent },
        { action_type: 'message', message_template: 'Relance' },
      ]);
      const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
      await setMockMode(accountId, { routes: replyRoutes(accountId, profileId, minutesFromNow(-60)) });
      await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: daysAgo(2), executed_at: daysAgo(2), final_message: 'Bonjour' });
      const wait = await schedule(org, enrollmentId, steps[1]);

      await cycleFor(wait);
      const enr = await enrollmentFull(enrollmentId);
      expect(enr.status, 'inscription close « a répondu »').toBe('replied');
      expect(enr.replied_at).not.toBeNull();
      const rows = await execs(enrollmentId);
      expect(rows.filter((e) => e.step_id === steps[2].id && ['scheduled', 'waiting_event', 'quota_blocked', 'sending', 'sent'].includes(e.status)),
        'aucune relance en attente ni partie').toEqual([]);
      expect(rows.filter((e) => ['scheduled', 'waiting_event', 'quota_blocked'].includes(e.status)), 'plus rien en attente').toEqual([]);
      expect(await sentTexts(accountId)).toEqual([]);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Enchaînement des étapes
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Enchaînement des étapes', () => {
  // engine-ends-sequence
  test('Étape « Fin de séquence » : après son envoi l’inscription est terminée, l’étape suivante n’est jamais planifiée', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 fin');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'A', ends_sequence: true },
      { action_type: 'message', message_template: 'B' },
    ]);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const exec = await schedule(org, enrollmentId, steps[0]);

    await cycleFor(exec);
    expect(await sentTexts(accountId)).toEqual(['A']);
    const enr = await enrollmentFull(enrollmentId);
    expect(enr.status, 'inscription terminée').toBe('completed');
    expect(enr.completed_at).not.toBeNull();
    expect((await execs(enrollmentId)).filter((e) => e.step_id === steps[1].id), 'aucune exécution de l’étape B').toEqual([]);

    await runCycle();
    expect(await sentTexts(accountId), 'aucun envoi supplémentaire').toEqual(['A']);
  });

  // engine-next-step-chain-and-branch-target
  test('next_step_id posé : après l’étape 0, le moteur planifie l’étape visée (2), jamais l’étape 1', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 chain');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Zéro' },
      { action_type: 'message', message_template: 'Un' },
      { action_type: 'message', message_template: 'Deux' },
    ]);
    await patchStep(steps[0].id, { next_step_id: steps[2].id });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const exec = await schedule(org, enrollmentId, steps[0]);

    await cycleFor(exec);
    expect(await sentTexts(accountId)).toEqual(['Zéro']);
    const rows = await execs(enrollmentId);
    expect(rows.filter((e) => e.step_id === steps[1].id), 'étape 1 jamais planifiée').toEqual([]);
    expect(rows.find((e) => e.step_id === steps[2].id)?.status, 'étape visée planifiée').toBe('scheduled');
  });

  // engine-next-step-chain-and-branch-target
  test('Fin de branche : l’étape visée par « Si vrai » ne retombe pas sur l’ordre suivant (branche « Si faux »), l’inscription se termine', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 branche');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'check_connection' },
      { action_type: 'message', message_template: 'Branche connecté' },
      { action_type: 'inmail', message_template: 'Branche non connecté', subject_template: 'Objet' },
    ]);
    await patchStep(steps[0].id, { if_true_goto_step: steps[1].id, if_false_goto_step: steps[2].id });
    await setMockMode(accountId, { distance: 'FIRST_DEGREE' });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const check = await schedule(org, enrollmentId, steps[0]);

    await cycleFor(check);
    expect((await execById(check)).status, 'vérification de connexion faite').toBe('sent');
    expect((await enrollmentFull(enrollmentId)).connection_status).toBe('connected');
    const trueBranch = (await execs(enrollmentId)).find((e) => e.step_id === steps[1].id);
    expect(trueBranch?.status, 'branche « Si vrai » planifiée').toBe('scheduled');

    await makeDue(trueBranch!.id);
    await cycleFor(trueBranch!.id);
    expect(await sentTexts(accountId)).toEqual(['Branche connecté']);
    const enr = await enrollmentFull(enrollmentId);
    expect(enr.status, 'fin de branche : inscription terminée').toBe('completed');
    expect((await execs(enrollmentId)).filter((e) => e.step_id === steps[2].id), 'branche « Si faux » jamais planifiée').toEqual([]);
  });

  // engine-next-step-chain-and-branch-target
  test('Trou de numérotation (ordres 0 et 5, sans renvoi) : l’étape 5 est planifiée après l’étape 0', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 trou');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Premier', step_order: 0 },
      { action_type: 'message', message_template: 'Cinquième', step_order: 5 },
    ]);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const exec = await schedule(org, enrollmentId, steps[0]);

    await cycleFor(exec);
    expect(await sentTexts(accountId)).toEqual(['Premier']);
    const next = (await execs(enrollmentId)).find((e) => e.step_id === steps[1].id);
    expect(next?.status, 'étape d’ordre 5 planifiée').toBe('scheduled');
    expect((await enrollmentFull(enrollmentId)).status).toBe('active');
  });

  // engine-branch-loop-no-resend
  test('Repli de délai vers une étape déjà envoyée : inscription terminée, aucune nouvelle exécution, aucun renvoi ni place de plafond consommée', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 boucle');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'A' },
      { action_type: 'wait_reply', timeout_days: 1 },
    ]);
    await patchStep(steps[1].id, { timeout_branch_step_id: steps[0].id });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    const sentA = await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: daysAgo(3), executed_at: daysAgo(3), final_message: 'A' });
    const wait = await schedule(org, enrollmentId, steps[1], { status: 'waiting_event', scheduled_at: daysAgo(2) });

    const logBefore = await actionLogCount(accountId, 'message');
    await timeoutsFor(wait);
    expect((await execById(wait)).status, 'attente expirée').toBe('skipped');
    // Décision 5 : la boucle qui revient sur une étape déjà partie termine l'inscription (avant : nouvelle exécution de A, sautée « Étape déjà envoyée »).
    const loop = (await execs(enrollmentId)).find((e) => e.step_id === steps[0].id && e.id !== sentA);
    expect(loop, 'aucune nouvelle exécution de A').toBeUndefined();
    expect((await enrollmentFull(enrollmentId)).status, 'inscription terminée').toBe('completed');

    await runCycle();
    expect(await sends(accountId), 'aucun appel d’envoi au fournisseur').toEqual([]);
    expect(await actionLogCount(accountId, 'message'), 'aucune place de plafond consommée').toBe(logBefore);
  });

  // engine-branch-loop-no-resend (« À vérifier » : boucle next_step_id A→B→A)
  test('Boucle next_step_id A→B→A : A n’est jamais renvoyé après B', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 boucle chaîne');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'A' },
      { action_type: 'message', message_template: 'B' },
    ]);
    await patchStep(steps[0].id, { next_step_id: steps[1].id });
    await patchStep(steps[1].id, { next_step_id: steps[0].id });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: daysAgo(3), executed_at: daysAgo(3), final_message: 'A' });
    const execB = await schedule(org, enrollmentId, steps[1]);

    await cycleFor(execB);
    expect(await sentTexts(accountId), 'B part une fois, A jamais renvoyé').toEqual(['B']);
    const pendingA = (await execs(enrollmentId)).filter((e) => e.step_id === steps[0].id && e.status !== 'sent');
    expect(pendingA, 'aucune nouvelle exécution de A').toEqual([]);
    // Décision 5 : la boucle qui revient sur une étape déjà partie termine l'inscription (statut auparavant seulement observé).
    const observed = await enrollmentFull(enrollmentId);
    const pendingAfter = (await execs(enrollmentId)).filter((e) => ['scheduled', 'waiting_event', 'quota_blocked'].includes(e.status)).length;
    expect(observed.status, 'inscription terminée').toBe('completed');
    expect(pendingAfter, 'rien en attente').toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Variantes A/B
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Variantes A/B', () => {
  // engine-ab-variant-draw
  test('Tirage pondéré : une seule variante par inscription, enregistrée dans variant_assigned, majorité de A (poids 99/1)', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 AB');
    // Étape 0 : attente de connexion déjà satisfaite (candidat connu connecté),
    // franchie sans appel ni plafond d'envoi par compte : 20 inscriptions
    // passent en deux cycles au plus. Rang 1 à un jour : une variante planifiée
    // au premier cycle ne part pas au second (sans délai, en semaine aux heures
    // d'envoi, elle tombait dans les deux minutes, partait et terminait
    // l'inscription ; le test ne passait que hors plage).
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'wait_connection', timeout_days: 7 },
      { action_type: 'message', message_template: 'Variante A', step_order: 1, variant_group: 'A', variant_weight: 99, delay_days: 1 },
      { action_type: 'message', message_template: 'Variante B', step_order: 1, variant_group: 'B', variant_weight: 1, delay_days: 1 },
    ]);
    const variantByStep = new Map([[steps[1].id, 'A'], [steps[2].id, 'B']]);
    const { data: crowd, error } = await admin().from('sequence_enrollments').insert(Array.from({ length: 20 }, (_, i) => ({
      sequence_id: sequenceId, organization_id: org.orgId, created_by: org.owner.userId,
      profile_id: `ACoAAE2EAB${rand()}${i}`, profile_name: 'Camille Martin', account_id: accountId,
      status: 'active', current_step_order: 0, user_timezone: 'Europe/Paris', connection_status: 'connected',
    }))).select('id');
    if (error || !crowd) throw new Error(`crowd: ${error?.message}`);
    const ids = crowd.map((r) => r.id as string);
    const { error: execErr } = await admin().from('sequence_step_executions').insert(ids.map((id) => ({
      enrollment_id: id, organization_id: org.orgId, step_id: steps[0].id, step_order: 0,
      status: 'scheduled', scheduled_at: minutesFromNow(-1),
    })));
    if (execErr) throw new Error(`crowd executions: ${execErr.message}`);

    for (let i = 0; i < 8; i++) {
      await runCycle();
      const { count } = await admin().from('sequence_step_executions').select('id', { count: 'exact', head: true })
        .in('enrollment_id', ids).eq('step_id', steps[0].id).eq('status', 'scheduled');
      if (!count) break;
    }

    const { data: rows } = await admin().from('sequence_step_executions')
      .select('enrollment_id, step_id, step_order, status, variant_assigned')
      .in('enrollment_id', ids).eq('step_order', 1);
    const byEnrollment = new Map<string, Array<{ step_id: string; variant_assigned: string | null }>>();
    for (const r of (rows ?? []) as Array<{ enrollment_id: string; step_id: string; variant_assigned: string | null }>) {
      byEnrollment.set(r.enrollment_id, [...(byEnrollment.get(r.enrollment_id) ?? []), r]);
    }
    let countA = 0;
    for (const id of ids) {
      const rank = byEnrollment.get(id) ?? [];
      expect(rank, `inscription ${id} : exactement une exécution du rang 1`).toHaveLength(1);
      expect(['A', 'B']).toContain(rank[0].variant_assigned);
      expect(rank[0].variant_assigned, 'variant_assigned = variante de l’étape planifiée').toBe(variantByStep.get(rank[0].step_id));
      if (rank[0].variant_assigned === 'A') countA++;
    }
    expect(countA, 'majorité de la variante A (poids 99)').toBeGreaterThanOrEqual(15);
    const { data: statuses } = await admin().from('sequence_enrollments').select('status').in('id', ids);
    expect((statuses ?? []).filter((s) => s.status !== 'active'), 'aucune inscription close faute de suite').toEqual([]);
  });

  // engine-ab-variant-draw
  test('Anti-doublon : une exécution de la variante B existe déjà, l’envoi de l’étape 0 ne planifie pas la variante A', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 AB doublon');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Variante A', step_order: 1, variant_group: 'A', variant_weight: 50 },
      { action_type: 'message', message_template: 'Variante B', step_order: 1, variant_group: 'B', variant_weight: 50 },
    ]);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const futureB = await schedule(org, enrollmentId, steps[2], { scheduled_at: minutesFromNow(5 * 24 * 60), variant_assigned: 'B' });
    const first = await schedule(org, enrollmentId, steps[0]);

    await cycleFor(first);
    expect(await sentTexts(accountId)).toEqual(['Bonjour']);
    const rank = (await execs(enrollmentId)).filter((e) => e.step_order === 1);
    expect(rank.map((e) => e.id), 'seule l’exécution B existante au rang 1').toEqual([futureB]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Garde « aucun message précédent »
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Garde « aucun message précédent »', () => {
  // engine-no-previous-message-guard
  test('Message précédent en échec, aucun envoi : la relance est sautée « no_previous_message » et l’inscription close sans envoi', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 garde');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance' },
    ]);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 0 });
    await schedule(org, enrollmentId, steps[0], { status: 'failed', scheduled_at: daysAgo(3), executed_at: daysAgo(3), error_message: 'linkedin_send_failed_400' });
    const relance = await schedule(org, enrollmentId, steps[1]);

    await cycleFor(relance);
    const row = await execById(relance);
    expect(row.status).toBe('skipped');
    expect(row.skip_reason).toBe('no_previous_message');
    const enr = await enrollmentFull(enrollmentId);
    expect(enr.status).toBe('completed');
    expect(enr.completed_at).not.toBeNull();
    expect(await sentTexts(accountId)).toEqual([]);
  });

  // engine-no-previous-message-guard
  test('Message précédent sauté à la main ou par condition : la relance part', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 garde saut');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance' },
    ]);
    const manual = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    const condition = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, manual.enrollmentId, steps[0], { status: 'skipped', skip_reason: 'Manuellement sautée par le recruteur', scheduled_at: daysAgo(3), executed_at: daysAgo(3) });
    await schedule(org, condition.enrollmentId, steps[0], { status: 'skipped', skip_reason: 'Condition: if_connected', scheduled_at: daysAgo(3), executed_at: daysAgo(3) });
    const manualExec = await schedule(org, manual.enrollmentId, steps[1]);
    const conditionExec = await schedule(org, condition.enrollmentId, steps[1]);

    await cycleFor(manualExec, conditionExec);
    for (const id of [manualExec, conditionExec]) {
      const row = await execById(id);
      expect(row.status, `relance ${id} partie`).toBe('sent');
    }
    const bodies = await sends(accountId);
    expect(bodies.map((b) => b.text)).toEqual(['Relance', 'Relance']);
    expect(new Set(bodies.map((b) => b.attendees_ids))).toEqual(new Set([manual.profileId, condition.profileId]));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rédaction IA
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Personnalisation IA', () => {
  // ai-success-generates-and-bills (partie « pas d'appel IA quand un aperçu validé ou une correction du Journal existe »)
  test('Étape IA : un aperçu validé ou une correction du Journal part tel quel, sans appel au modèle', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 IA aperçu');
    const marker = `MQ${rand()}${rand()}`;
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: `Bonjour {{prenom}} ${marker}`, use_ai_personalization: true },
    ]);
    const preview = await enroll(org, sequenceId, org.owner.userId, accountId, {
      tracking_data: { message_overrides: { [steps[0].id]: { message: 'Aperçu validé pour Camille', isEdited: true } } },
    });
    const journal = await enroll(org, sequenceId, org.owner.userId, accountId);
    const previewExec = await schedule(org, preview.enrollmentId, steps[0]);
    const journalExec = await schedule(org, journal.enrollmentId, steps[0], { final_message: 'Texte corrigé dans le Journal' });

    await cycleFor(previewExec, journalExec);
    expect((await execById(previewExec)).status).toBe('sent');
    expect((await execById(journalExec)).status).toBe('sent');
    const texts = await sentTexts(accountId);
    expect(texts.sort()).toEqual(['Aperçu validé pour Camille', 'Texte corrigé dans le Journal']);
    expect(await aiCallsWith(marker), 'aucun appel au modèle').toEqual([]);
  });

  // ai-credits-exhausted — lot 5a-2 : sans texte relu, l'étape IA n'atteint
  // plus la rédaction ni le contrôle des crédits ; elle est reportée.
  test('Crédits IA épuisés : étape IA sans relecture reportée « à relire », aucun appel au modèle, le modèle brut ne part pas', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 IA crédits');
    const { error: balErr } = await admin().from('ai_credit_balances').upsert({
      organization_id: org.orgId, plan_credits: 0, topup_credits: 0, credits_remaining: 0, credits_total: 0,
      period_start: daysAgo(1), period_end: minutesFromNow(20 * 24 * 60),
    }, { onConflict: 'organization_id' });
    if (balErr) throw new Error(`ai_credit_balances: ${balErr.message}`);
    const marker = `MQ${rand()}${rand()}`;
    const template = `Bonjour {{prenom}} ${marker}`;
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: template, use_ai_personalization: true },
    ]);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const exec = await schedule(org, enrollmentId, steps[0]);

    await cycleFor(exec);
    const row = await execById(exec);
    expect(row.status, 'étape reportée').toBe('scheduled');
    expect(row.retry_count ?? 0, 'aucun essai compté').toBe(0);
    expect(row.error_message).toBe("Message rédigé par l'IA à relire avant l'envoi.");
    expect(row.final_message, 'aucune copie du modèle gardée comme texte à envoyer').toBeNull();
    expect(await aiCallsWith(marker), 'aucun appel au modèle').toEqual([]);
    expect(await sentTexts(accountId), 'le modèle brut ne part jamais').toEqual([]);
  });

  // ai-retry-keeps-generated-text (texte résolu gardé après un refus passager)
  test('Texte déjà rédigé par l’IA : refus passager (429) puis nouvel essai avec le même texte, sans nouvelle rédaction', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 IA 429');
    const marker = `MQ${rand()}${rand()}`;
    const aiText = 'Bonjour Camille, votre parcours sur la data m’intéresse pour une mission, seriez-vous disponible ?\n\nClaire';
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: `Bonjour {{prenom}} ${marker}`, use_ai_personalization: true },
    ]);
    await setMockMode(accountId, { routes: [{ method: 'POST', path: '^/api/v1/chats$', status: 429, body: { status: 429, type: 'errors/too_many_requests' }, times: 1 }] });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    // État laissé par un premier essai : texte rédigé par l'IA figé, marqué « résolu ».
    const exec = await schedule(org, enrollmentId, steps[0], { final_message: aiText, tracking_data: { content_origin: 'resolved' } });

    await cycleFor(exec);
    const refused = await execById(exec);
    expect(refused.status, 'refus passager : étape reportée').toBe('scheduled');
    expect(refused.final_message, 'texte rédigé gardé').toBe(aiText);

    await makeDue(exec);
    await cycleFor(exec);
    expect((await execById(exec)).status).toBe('sent');
    const bodies = await sends(accountId);
    expect(bodies.map((b) => b.text), 'deux tentatives, le même texte').toEqual([aiText, aiText]);
    expect(await aiCallsWith(marker), 'aucune nouvelle rédaction').toEqual([]);
  });

  // ai-retry-keeps-generated-text (copie du modèle laissée par un essai interrompu)
  // Lot 5a-2 : la copie périmée du modèle n'est pas un texte relu ; l'étape est
  // reportée sans rappeler l'IA, et le modèle ne part jamais.
  test('Copie du modèle laissée par un essai interrompu : étape reportée « à relire », sans appel à l’IA, le modèle ne part jamais', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 IA copie');
    const marker = `MQ${rand()}${rand()}`;
    const template = `Bonjour {{prenom}} ${marker}`;
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: template, use_ai_personalization: true },
    ]);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const exec = await schedule(org, enrollmentId, steps[0], { final_message: template, tracking_data: { content_origin: 'template_snapshot' } });

    await cycleFor(exec);
    expect(await aiCallsWith(marker), 'aucun appel au modèle').toEqual([]);
    const texts = await sentTexts(accountId);
    expect(texts, 'le modèle brut ne part jamais').toEqual([]);
    const row = await execById(exec);
    expect(row.status).toBe('scheduled');
    expect(row.error_message).toBe("Message rédigé par l'IA à relire avant l'envoi.");
    expect(row.final_message, 'copie du modèle retirée : « Relire le message » proposé').toBeNull();
    expect((row.tracking_data as Record<string, unknown> | null)?.content_origin, 'marqueur retiré').toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Variables des modèles
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Variables des modèles', () => {
  // interp-known-vars
  test('Variables connues remplies à l’envoi, dans le message et l’objet de l’InMail, avec l’identité du titulaire du compte', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 variables');
    await admin().from('profiles').update({ display_name: 'Claire Dupont', job_title: 'Talent Partner' }).eq('user_id', org.owner.userId);
    const calendly = `https://calendly.com/claire-${rand()}`;
    const missionId = await seedMission(org.orgId, org.owner.userId, {
      calendly_link: calendly, client_name: 'Acme', job_details: { title: 'Data Engineer' },
    });
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      {
        action_type: 'inmail',
        subject_template: '{{poste_recherche}} chez {{client}}',
        message_template: '{{prenom}} {{job_title}} {{lien_calendly}} {{ma_signature}} {{mon_poste}} {{mon_prenom}}',
      },
    ]);
    await setMockMode(accountId, { distance: 'SECOND_DEGREE' });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, {
      job_id: missionId, profile_name: 'Camille Martin', profile_headline: 'Lead Dev chez Foo',
    });
    const exec = await schedule(org, enrollmentId, steps[0]);

    await cycleFor(exec);
    const bodies = await sends(accountId);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].text).toBe(`Camille Lead Dev ${calendly} Claire Dupont Talent Partner Claire`);
    expect(bodies[0].subject).toBe('Data Engineer chez Acme');
    expect(bodies[0]['linkedin[inmail]']).toBe('true');
  });

  // interp-known-vars (compte d'envoi d'un collègue par la rotation)
  test('Rotation vers le compte d’un collègue : {{ma_signature}} et {{mon_poste}} sont ceux du titulaire de ce compte, pas de l’inscripteur', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 variables rotation');
    const colleague = await addMember(org.orgId, 'member', 'marc');
    orgsToDelete[orgsToDelete.length - 1].extra.push(colleague);
    const colleagueAccount = await seedLinkedInAccount(org.orgId, colleague.userId, `acc_${rand()}`, 'OK');
    accountsToReset.push(colleagueAccount);
    await admin().from('profiles').update({ display_name: 'Claire Dupont', job_title: 'Talent Partner' }).eq('user_id', org.owner.userId);
    await admin().from('profiles').update({ display_name: 'Marc Leroy', job_title: 'Sourceur' }).eq('user_id', colleague.userId);
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: '{{prenom}}, {{ma_signature}} {{mon_poste}}' },
    ], { multi_sender_enabled: true, sender_accounts: [{ account_id: colleagueAccount }], rotation_mode: 'round_robin' });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const exec = await schedule(org, enrollmentId, steps[0]);

    await cycleFor(exec);
    expect((await enrollmentFull(enrollmentId)).assigned_sender_id, 'expéditeur tiré : le compte du collègue').toBe(colleagueAccount);
    expect(await sentTexts(accountId), 'rien depuis le compte de l’inscripteur').toEqual([]);
    expect(await sentTexts(colleagueAccount)).toEqual(['Camille, Marc Leroy Sourceur']);
  });

  // interp-unknown-stripped
  test('Variable inconnue retirée sans espace avant la ponctuation, repli « | fallback » utilisé, prénom non fiable : « Bonjour, »', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 variables inconnues');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour {{prenom}}, {{city}} ok {{ville | fallback:"Paris"}} {{ai_snippet}}.' },
    ]);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { profile_name: '🚀 Julie Martin' });
    const exec = await schedule(org, enrollmentId, steps[0]);

    await cycleFor(exec);
    expect(await sentTexts(accountId)).toEqual(['Bonjour, ok Paris.']);
    for (const b of await sends(accountId)) {
      expect(`${b.text ?? ''} ${b.subject ?? ''}`, 'aucun « {{ » ne part').not.toContain('{{');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Arrêts toujours actifs
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Réponse et désinscription arrêtent toujours la séquence', () => {
  // stop-reply-unsubscribe-always
  test('Désinscription (casse ignorée) avec on_unsubscribe désactivé : étape LinkedIn sautée, inscription close, rien ne part', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 désinscription');
    const local = `camille.${rand()}`;
    suppressedToDelete.push(`${local}@exemple.fr`);
    const { error: supErr } = await admin().from('suppressed_emails').insert({ email: `${local}@exemple.fr`, reason: 'unsubscribe' });
    if (supErr) throw new Error(`suppressed_emails: ${supErr.message}`);
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance' },
    ], { stop_conditions: { on_reply: false, on_unsubscribe: false } });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { email_used: `${local.replace('camille', 'Camille')}@Exemple.fr` });
    const exec = await schedule(org, enrollmentId, steps[0]);

    await cycleFor(exec);
    const row = await execById(exec);
    // Décision 28 : l'étape arrêtée par une condition d'arrêt est annulée (avant : sautée).
    expect(row.status).toBe('cancelled');
    expect(row.skip_reason).toBe('Stop condition: unsubscribed');
    const enr = await enrollmentFull(enrollmentId);
    expect(enr.status).toBe('completed');
    expect((await execs(enrollmentId)).filter((e) => ['scheduled', 'waiting_event', 'quota_blocked'].includes(e.status))).toEqual([]);
    expect(await sentTexts(accountId)).toEqual([]);
  });

  // stop-reply-unsubscribe-always
  test('Réponse détectée avant envoi avec on_reply désactivé : inscription « a répondu », la relance ne part pas', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 réponse');
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance' },
    ], { stop_conditions: { on_reply: false, on_unsubscribe: false } });
    const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await setMockMode(accountId, { routes: replyRoutes(accountId, profileId, minutesFromNow(-60)) });
    await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: daysAgo(2), executed_at: daysAgo(2), final_message: 'Bonjour' });
    const relance = await schedule(org, enrollmentId, steps[1]);

    await cycleFor(relance);
    const enr = await enrollmentFull(enrollmentId);
    expect(enr.status, 'la réponse arrête toujours la séquence').toBe('replied');
    expect((await execById(relance)).status).toBe('cancelled');
    expect(await sends(accountId)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rotation des expéditeurs
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Rotation des expéditeurs', () => {
  // rotation-engaged-freeze
  test('Conversation déjà engagée sans expéditeur attribué : figée sur le compte de l’inscription, pas de nouveau tirage', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 rotation figée');
    const colleague = await addMember(org.orgId, 'member', 'rot');
    orgsToDelete[orgsToDelete.length - 1].extra.push(colleague);
    const l2 = await seedLinkedInAccount(org.orgId, colleague.userId, `acc_${rand()}`, 'OK');
    accountsToReset.push(l2);
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance' },
    ], { multi_sender_enabled: true, sender_accounts: [{ account_id: l2 }], rotation_mode: 'round_robin' });
    const engaged = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    const fresh = await enroll(org, sequenceId, org.owner.userId, accountId);
    await schedule(org, engaged.enrollmentId, steps[0], { status: 'sent', scheduled_at: daysAgo(2), executed_at: daysAgo(2), final_message: 'Bonjour' });
    const engagedExec = await schedule(org, engaged.enrollmentId, steps[1]);
    const freshExec = await schedule(org, fresh.enrollmentId, steps[0]);

    await cycleFor(engagedExec, freshExec);
    expect((await enrollmentFull(engaged.enrollmentId)).assigned_sender_id, 'expéditeur figé sur le compte de l’inscription').toBe(accountId);
    expect(await sentTexts(accountId), 'la relance part du compte de la conversation').toEqual(['Relance']);
    // Témoin : une inscription sans envoi tire bien le compte du groupe.
    expect((await enrollmentFull(fresh.enrollmentId)).assigned_sender_id).toBe(l2);
    expect(await sentTexts(l2), 'depuis L2, seul le premier message du témoin').toEqual(['Bonjour']);
  });

  // rotation-unavailable-plans
  test('Tous les expéditeurs au plafond du jour : étape bloquée jusqu’au début de plage du lendemain, aucun repli ni envoi', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 rotation plafond');
    const colleague = await addMember(org.orgId, 'member', 'cap');
    orgsToDelete[orgsToDelete.length - 1].extra.push(colleague);
    const l2 = await seedLinkedInAccount(org.orgId, colleague.userId, `acc_${rand()}`, 'OK');
    accountsToReset.push(l2);
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
    ], { multi_sender_enabled: true, sender_accounts: [{ account_id: l2, daily_limit: 1 }], rotation_mode: 'round_robin' });
    // Envoi du jour déjà fait depuis L2 pour une autre inscription.
    const other = await enroll(org, sequenceId, colleague.userId, l2, { assigned_sender_id: l2 });
    await schedule(org, other.enrollmentId, steps[0], { status: 'sent', scheduled_at: minutesFromNow(-10), executed_at: minutesFromNow(-10), final_message: 'Bonjour' });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const exec = await schedule(org, enrollmentId, steps[0]);

    await cycleFor(exec);
    const row = await execById(exec);
    expect(row.status).toBe('quota_blocked');
    expect(row.skip_reason).toBe('Tous les expéditeurs ont atteint leur limite du jour');
    // Début de plage (8 h, Europe/Paris) du lendemain.
    const at = new Date(row.scheduled_at);
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', day: '2-digit' }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    expect(`${get('hour')}:${get('minute')}`).toBe('08:00');
    const tomorrowDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', day: '2-digit' }).format(new Date(Date.now() + 24 * 3600_000));
    expect(get('day')).toBe(tomorrowDay);
    expect(at.getTime()).toBeGreaterThan(Date.now());
    expect((await enrollmentFull(enrollmentId)).assigned_sender_id).toBeNull();
    expect(await sentTexts(accountId), 'aucun repli sur le compte de l’inscription').toEqual([]);
    expect(await sentTexts(l2)).toEqual([]);
  });

  // rotation-unavailable-plans
  test('Groupe sans compte LinkedIn relié à l’organisation (compte d’une autre organisation, entrée e-mail) : envoi depuis le compte de l’inscription', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 rotation vide');
    const other = await createOrg('agency', 'E2E steps-2 autre org');
    orgsToDelete.push({ org: other, extra: [] });
    const foreign = await seedLinkedInAccount(other.orgId, other.owner.userId, `acc_${rand()}`, 'OK');
    accountsToReset.push(foreign);
    const { sequenceId, steps } = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
    ], {
      multi_sender_enabled: true,
      sender_accounts: [{ account_id: foreign }, { account_id: `mail_${rand()}`, channel: 'email', email: 'recruteur@exemple.fr' }],
      rotation_mode: 'round_robin',
    });
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const exec = await schedule(org, enrollmentId, steps[0]);

    await cycleFor(exec);
    expect((await enrollmentFull(enrollmentId)).assigned_sender_id, 'aucun expéditeur attribué').toBeNull();
    expect(await sentTexts(accountId), 'envoi depuis le compte de l’inscription').toEqual(['Bonjour']);
    expect(await sentTexts(foreign), 'jamais depuis le compte de l’autre organisation').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// File InMail
// ═══════════════════════════════════════════════════════════════════════════

/** Fuseau où l'instant présent tombe un jour ouvré (la file n'a pas d'option force). */
function weekdayZone(): string | null {
  for (const zone of ['Europe/Paris', 'Pacific/Kiritimati', 'Pacific/Auckland', 'Asia/Tokyo', 'America/New_York', 'Pacific/Pago_Pago']) {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(new Date());
    if (day !== 'Sat' && day !== 'Sun') return zone;
  }
  return null;
}

test.describe('File InMail', () => {
  // inmail-queue-plan-and-duplicates
  test('Plan gratuit : rien n’est mis en file (403 PLAN_REQUIRED)', async () => {
    const org = await createOrg('agency', 'E2E steps-2 inmail free');
    orgsToDelete.push({ org, extra: [] });
    inmailOrgsToClean.push(org.orgId);
    await setOrgPlan(org.orgId, 'free');
    const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_${rand()}`, 'OK');
    const token = (await signIn(org.owner.email, org.owner.password)).access_token;

    const res = await callFunction('process-inmail-queue', token, {
      action: 'queue',
      items: [{ account_id: accountId, recipient_profile_id: `ACoAAE2E${rand()}`, recipient_name: 'Camille Martin', subject: 'Objet', message: 'Bonjour', network_distance: 2 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe('PLAN_REQUIRED');
    const { count } = await admin().from('inmail_queue').select('id', { count: 'exact', head: true }).eq('organization_id', org.orgId);
    expect(count, 'aucune ligne en file').toBe(0);
  });

  // inmail-queue-plan-and-duplicates
  test('Anti-doublon : candidat contacté par InMail il y a 30 jours ou en double dans la sélection écarté ; ligne de plus de 90 jours ou d’une autre organisation ignorée', async () => {
    const { org, accountId } = await paidOrg('E2E steps-2 inmail doublons');
    inmailOrgsToClean.push(org.orgId);
    const other = await createOrg('agency', 'E2E steps-2 inmail autre');
    orgsToDelete.push({ org: other, extra: [] });
    inmailOrgsToClean.push(other.orgId);
    const otherAccount = await seedLinkedInAccount(other.orgId, other.owner.userId, `acc_${rand()}`, 'OK');
    const token = (await signIn(org.owner.email, org.owner.password)).access_token;
    const [p1, p2, p3, p4] = Array.from({ length: 4 }, () => `ACoAAE2E${rand()}${rand()}`);
    const sentRow = (recipient: string, orgId: string, account: string, createdBy: string, ageDays: number) => ({
      account_id: account, recipient_profile_id: recipient, subject: 'Objet', message: 'Bonjour', status: 'sent',
      created_by: createdBy, organization_id: orgId, created_at: daysAgo(ageDays), scheduled_at: daysAgo(ageDays), sent_at: daysAgo(ageDays),
    });
    const { error } = await admin().from('inmail_queue').insert([
      sentRow(p1, org.orgId, accountId, org.owner.userId, 30),
      sentRow(p3, org.orgId, accountId, org.owner.userId, 100),
      sentRow(p4, other.orgId, otherAccount, other.owner.userId, 30),
    ]);
    if (error) throw new Error(`inmail_queue seed: ${error.message}`);
    const item = (recipient: string) => ({ account_id: accountId, recipient_profile_id: recipient, recipient_name: 'Camille Martin', subject: 'Objet', message: 'Bonjour', network_distance: 2 });

    const first = await callFunction('process-inmail-queue', token, { action: 'queue', items: [item(p1), item(p2), item(p2)] });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.queued).toBe(1);
    expect(first.body.skipped_duplicates).toBe(1);
    expect(first.body.skipped_recipient_ids).toEqual([p1]);
    const { data: queuedP2 } = await admin().from('inmail_queue').select('id').eq('organization_id', org.orgId).eq('recipient_profile_id', p2).eq('status', 'scheduled');
    expect(queuedP2 ?? [], 'P2 mis en file une seule fois').toHaveLength(1);
    const { data: queuedP1 } = await admin().from('inmail_queue').select('id').eq('organization_id', org.orgId).eq('recipient_profile_id', p1).neq('status', 'sent');
    expect(queuedP1 ?? [], 'P1 pas remis en file').toHaveLength(0);

    const second = await callFunction('process-inmail-queue', token, { action: 'queue', items: [item(p3), item(p4)] });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.queued, 'ligne de plus de 90 jours ou d’une autre organisation : mis en file').toBe(2);
    expect(second.body.skipped_recipient_ids).toEqual([]);
  });

  // inmail-queue-process-send-mode
  test('Traitement : premier degré en message sans contrôle de solde, sinon InMail avec objet après contrôle ; solde nul +4 h, contrôle en échec +30 min ; compte déconnecté +1 h', async () => {
    const zone = weekdayZone();
    test.skip(!zone, 'week-end dans tous les fuseaux candidats : la file InMail ne traite rien');
    const { org, accountId } = await paidOrg('E2E steps-2 inmail envoi');
    inmailOrgsToClean.push(org.orgId);
    // Titulaire du compte dans un fuseau où c'est un jour ouvré, plage 0 h-24 h.
    const { error: qErr } = await admin().from('member_quotas').upsert({
      organization_id: org.orgId, user_id: org.owner.userId, business_hours_start: 0, business_hours_end: 24, timezone: zone,
    }, { onConflict: 'organization_id,user_id' });
    if (qErr) throw new Error(`member_quotas: ${qErr.message}`);
    const token = (await signIn(org.owner.email, org.owner.password)).access_token;
    const due = (recipient: string, distance: number) => ({
      account_id: accountId, recipient_profile_id: recipient, recipient_name: 'Camille Martin', subject: 'Objet InMail',
      message: `Bonjour ${recipient}`, status: 'scheduled', scheduled_at: minutesFromNow(-5), user_timezone: zone,
      created_by: org.owner.userId, organization_id: org.orgId, network_distance: distance,
    });
    const [d1, d2, d3, d4] = Array.from({ length: 4 }, () => `ACoAAE2E${rand()}${rand()}`);
    const rowOf = async (recipient: string) => (await admin().from('inmail_queue')
      .select('status, scheduled_at, error_message').eq('organization_id', org.orgId).eq('recipient_profile_id', recipient).single()).data as
      { status: string; scheduled_at: string; error_message: string | null };

    // 1er degré et 2e degré.
    const { error } = await admin().from('inmail_queue').insert([due(d1, 1), due(d2, 2)]);
    if (error) throw new Error(`inmail_queue: ${error.message}`);
    const res = await callFunction('process-inmail-queue', token, { action: 'process' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await rowOf(d1)).status).toBe('sent');
    expect((await rowOf(d2)).status).toBe('sent');
    const calls = await mockCalls(accountId);
    const posts = calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/chats');
    const direct = posts.find((c) => (c.body as Record<string, string>).attendees_ids === d1)!.body as Record<string, string>;
    const inmail = posts.find((c) => (c.body as Record<string, string>).attendees_ids === d2)!.body as Record<string, string>;
    expect(direct['linkedin[inmail]'], 'premier degré : message direct').toBeUndefined();
    expect(inmail['linkedin[inmail]']).toBe('true');
    expect(inmail.subject).toBe('Objet InMail');
    const balanceIdx = calls.map((c, i) => (c.path === '/api/v1/linkedin/inmail_balance' ? i : -1)).filter((i) => i >= 0);
    expect(balanceIdx, 'un seul contrôle de solde (pour l’InMail)').toHaveLength(1);
    expect(balanceIdx[0], 'contrôle du solde avant l’envoi de l’InMail').toBeLessThan(calls.indexOf(posts.find((c) => (c.body as Record<string, string>).attendees_ids === d2)!));

    // Solde nul : +4 h.
    await setMockMode(accountId, { routes: [{ method: 'GET', path: '^/api/v1/linkedin/inmail_balance$', body: { object: 'InMailBalance', recruiter: 0, premium: 0, sales_navigator: 0 } }] });
    await admin().from('inmail_queue').insert([due(d3, 2)]);
    const before3 = Date.now();
    await callFunction('process-inmail-queue', token, { action: 'process' });
    const r3 = await rowOf(d3);
    expect(r3.status).toBe('scheduled');
    expect(r3.error_message).toBe('Crédits InMail épuisés (re-essai dans 4h)');
    expect(new Date(r3.scheduled_at).getTime()).toBeGreaterThan(before3 + 3.9 * 3600_000);

    // Contrôle du solde en échec (503) : +30 min, rien ne part.
    const d5 = `ACoAAE2E${rand()}${rand()}`;
    await setMockMode(accountId, { routes: [{ method: 'GET', path: '^/api/v1/linkedin/inmail_balance$', status: 503, body: { status: 503 } }] });
    await admin().from('inmail_queue').insert([due(d5, 2)]);
    const before5 = Date.now();
    await callFunction('process-inmail-queue', token, { action: 'process' });
    const r5 = await rowOf(d5);
    expect(r5.status).toBe('scheduled');
    expect(r5.error_message).toBe('Contrôle des crédits InMail momentanément indisponible, nouvel essai dans 30 min');
    expect(new Date(r5.scheduled_at).getTime()).toBeGreaterThan(before5 + 25 * 60_000);
    expect(new Date(r5.scheduled_at).getTime()).toBeLessThan(before5 + 35 * 60_000 + 60_000);

    // Compte déconnecté : +1 h, rien ne part.
    await setMockMode(accountId, {});
    await admin().from('member_linkedin_accounts').update({ account_status: 'CREDENTIALS' }).eq('organization_id', org.orgId).eq('linkedin_account_id', accountId);
    await admin().from('inmail_queue').insert([due(d4, 2)]);
    const before4 = Date.now();
    await callFunction('process-inmail-queue', token, { action: 'process' });
    const r4 = await rowOf(d4);
    expect(r4.status).toBe('scheduled');
    expect(r4.error_message ?? '').toContain('déconnecté');
    expect(new Date(r4.scheduled_at).getTime()).toBeGreaterThan(before4 + 55 * 60_000);
    const finalPosts = (await mockCalls(accountId)).filter((c) => c.method === 'POST' && c.path === '/api/v1/chats');
    expect(finalPosts.map((c) => (c.body as Record<string, string>).attendees_ids).sort(), 'seuls les deux premiers sont partis').toEqual([d1, d2].sort());
  });

  // inmail-queue-process-send-mode
  test('Traitement : abonnement échu (plan gratuit), l’InMail est reporté d’une heure avec la raison, sans envoi', async () => {
    const org = await createOrg('agency', 'E2E steps-2 inmail échu');
    orgsToDelete.push({ org, extra: [] });
    inmailOrgsToClean.push(org.orgId);
    await setOrgPlan(org.orgId, 'free');
    const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_${rand()}`, 'OK');
    const token = (await signIn(org.owner.email, org.owner.password)).access_token;
    const recipient = `ACoAAE2E${rand()}${rand()}`;
    const { error } = await admin().from('inmail_queue').insert({
      account_id: accountId, recipient_profile_id: recipient, subject: 'Objet', message: 'Bonjour', status: 'scheduled',
      scheduled_at: minutesFromNow(-5), created_by: org.owner.userId, organization_id: org.orgId, network_distance: 2,
    });
    if (error) throw new Error(`inmail_queue: ${error.message}`);

    const before = Date.now();
    const res = await callFunction('process-inmail-queue', token, { action: 'process' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { data: row } = await admin().from('inmail_queue').select('status, scheduled_at, error_message').eq('organization_id', org.orgId).single();
    expect(row?.status).toBe('scheduled');
    expect(row?.error_message).toBe("Abonnement requis pour l'envoi d'InMails (prochaine tentative dans 1h)");
    expect(new Date(row!.scheduled_at as string).getTime()).toBeGreaterThan(before + 55 * 60_000);
    expect((await mockCalls(accountId)).filter((c) => c.method === 'POST'), 'rien ne part').toEqual([]);
  });
});

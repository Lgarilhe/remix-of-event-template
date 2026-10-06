/**
 * Lot « steps-1 » du module séquences : routage des étapes de connexion,
 * attentes et délais, rédaction IA en échec, rotation des expéditeurs, file
 * InMail, canaux fermés, mode d'envoi (message direct ou InMail) et
 * invitations inutiles.
 *
 * Contrat : CLAUDE.md, section « Séquences : règles du moteur et de
 * l'interface », et docs/audit-2026-09-25-sequences.md (décisions D1 à D6,
 * tableau des décisions, registre des défauts).
 *
 * Le moteur process-sequences et la file process-inmail-queue tournent pour de
 * vrai contre la stack locale (e2e/local-stack) ; LinkedIn et l'IA sont
 * simulés par e2e/local-stack/vendor-mock.mjs, qui journalise chaque appel.
 * Chaque test a ses propres comptes LinkedIn, ses propres profils, et ne règle
 * le faux prestataire que sur ses comptes (jamais la clé '*').
 *
 * `force: true` lève la fenêtre d'envoi du moteur (jours ouvrés 8 h-19 h). La
 * file InMail n'a pas cette option : ses envois ne se testent qu'en semaine
 * (seuls les contrôles placés avant la plage horaire sont couverts ici).
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
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
  engineAvailable,
  enroll,
  minutesFromNow,
  mockCalls,
  postJson,
  rand,
  runCycle,
  runEngine,
  schedule,
  sendingOrg,
  sentInvites,
  sentTexts,
  setMockMode,
  webhook,
  type MockCall,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
test.afterEach(async () => {
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    // inmail_queue n'est pas nettoyée par deleteOrg.
    await admin().from('inmail_queue').delete().eq('organization_id', org.orgId);
    for (const u of [org.owner, ...extra]) await admin().from('inmail_queue').delete().eq('created_by', u.userId);
    await deleteOrg(org, extra);
  }
});

/** Organisation qui envoie, supprimée après le test. */
async function newSendingOrg(prefix: string) {
  const created = await sendingOrg(prefix);
  const entry = { org: created.org, extra: [] as TestUser[] };
  orgsToDelete.push(entry);
  return { ...created, extra: entry.extra };
}

// ─── Seeds ──────────────────────────────────────────────────────────────────

interface StepSpec {
  action_type: string;
  message_template?: string | null;
  subject_template?: string | null;
  condition_type?: string | null;
  wait_for_event?: string | null;
  timeout_days?: number | null;
  delay_days?: number;
  use_ai_personalization?: boolean;
}

type LinkColumn = 'if_true_goto_step' | 'if_false_goto_step' | 'timeout_branch_step_id' | 'next_step_id';

/**
 * Séquence aux étapes décrites (ordre = index). `links` pose les renvois par
 * ordre d'étape : [0, { if_true_goto_step: 1 }] relie l'étape 0 à l'étape 1.
 */
async function buildSequence(
  org: TestOrg,
  createdBy: string,
  specs: StepSpec[],
  opts: { links?: Array<[number, Partial<Record<LinkColumn, number>>]>; sequence?: Record<string, unknown> } = {},
): Promise<{ sequenceId: string; steps: SeededStep[] }> {
  const { data: seq, error: seqErr } = await admin()
    .from('outreach_sequences')
    .insert({
      name: `Séquence steps-1 ${rand()}`,
      organization_id: org.orgId,
      created_by: createdBy,
      is_active: true,
      ...(opts.sequence ?? {}),
    })
    .select('id')
    .single();
  if (seqErr || !seq) throw new Error(`buildSequence: ${seqErr?.message}`);
  const { data: inserted, error: stepErr } = await admin()
    .from('sequence_steps')
    .insert(specs.map((s, i) => ({
      sequence_id: seq.id,
      organization_id: org.orgId,
      step_order: i,
      delay_days: s.delay_days ?? 0,
      action_type: s.action_type,
      message_template: s.message_template ?? null,
      subject_template: s.subject_template ?? null,
      condition_type: s.condition_type ?? null,
      wait_for_event: s.wait_for_event ?? null,
      timeout_days: s.timeout_days ?? null,
      use_ai_personalization: s.use_ai_personalization ?? false,
    })))
    .select('id, step_order, action_type');
  if (stepErr || !inserted) throw new Error(`buildSequence(étapes): ${stepErr?.message}`);
  const steps = (inserted as SeededStep[]).sort((a, b) => a.step_order - b.step_order);
  for (const [order, link] of opts.links ?? []) {
    const patch: Record<string, string> = {};
    for (const [col, target] of Object.entries(link)) patch[col] = steps[target as number].id;
    const { error } = await admin().from('sequence_steps').update(patch).eq('id', steps[order].id);
    if (error) throw new Error(`buildSequence(renvois): ${error.message}`);
  }
  return { sequenceId: seq.id as string, steps };
}

interface Exec {
  id: string;
  step_id: string;
  step_order: number;
  status: string;
  scheduled_at: string;
  final_message: string | null;
  final_subject: string | null;
  skip_reason: string | null;
  error_message: string | null;
  retry_count: number | null;
}

async function execs(enrollmentId: string): Promise<Exec[]> {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .select('id, step_id, step_order, status, scheduled_at, final_message, final_subject, skip_reason, error_message, retry_count')
    .eq('enrollment_id', enrollmentId)
    .order('created_at');
  if (error) throw new Error(`execs: ${error.message}`);
  return (data ?? []) as Exec[];
}

const onStep = (rows: Exec[], step: SeededStep) => rows.filter((e) => e.step_id === step.id);

async function execById(id: string): Promise<Exec> {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .select('id, step_id, step_order, status, scheduled_at, final_message, final_subject, skip_reason, error_message, retry_count')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`execById: ${error?.message}`);
  return data as Exec;
}

/** Ramène une exécution à « due il y a une minute » (la planification suivante tombe lundi : on est dimanche). */
async function rewind(execId: string) {
  const { error } = await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', execId);
  if (error) throw new Error(`rewind: ${error.message}`);
}

/**
 * Repousse de trois jours les exécutions d'une étape : elles restent hors des
 * cycles suivants du test. En semaine aux heures d'envoi, une étape sans délai
 * est planifiée dans les deux minutes et partirait au cycle suivant (les tests
 * écrits un dimanche comptaient sur un report au lundi).
 */
async function postpone(enrollmentId: string, step: SeededStep) {
  const { error } = await admin().from('sequence_step_executions')
    .update({ scheduled_at: minutesFromNow(3 * 24 * 60) }).eq('enrollment_id', enrollmentId).eq('step_id', step.id);
  if (error) throw new Error(`postpone: ${error.message}`);
}

async function enrollmentFull(id: string) {
  const { data } = await admin()
    .from('sequence_enrollments')
    .select('status, pause_reason, current_step_order, connection_status, assigned_sender_id')
    .eq('id', id)
    .single();
  return data as { status: string; pause_reason: string | null; current_step_order: number; connection_status: string | null; assigned_sender_id: string | null };
}

const isChatPost = (c: MockCall) => c.method === 'POST' && (c.path === '/api/v1/chats' || /^\/api\/v1\/chats\/[^/]+\/messages$/.test(c.path));
const bodyOf = (c: MockCall) => (typeof c.body === 'object' && c.body ? c.body : {}) as Record<string, unknown>;

async function ledger(accountId: string): Promise<string[]> {
  const { data } = await admin().from('linkedin_action_log').select('action_type').eq('account_id', accountId);
  return ((data ?? []) as Array<{ action_type: string }>).map((r) => r.action_type);
}

/** Date locale (Europe/Paris) : jour et heure, pour les reports « lendemain à l'ouverture ». */
function parisParts(d: Date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), minute: Number(get('minute')) };
}

const token = async (u: TestUser) => (await signIn(u.email, u.password)).access_token;

// ═══════════════════════════════════════════════════════════════════════════
// Routage des étapes de connexion
// ═══════════════════════════════════════════════════════════════════════════

test.describe('@critical Étapes de connexion', () => {
  // engine-check-connection-routing
  test('@critical « Vérifier la connexion » : cible « Si connecté » pour une relation directe, « Si non connecté » sinon, étape d\'ordre suivant sans branche', async () => {
    const first = await newSendingOrg('E2E steps-1 routage 1er');
    const second = await newSendingOrg('E2E steps-1 routage 2e');
    await setMockMode(second.accountId, { distance: 'SECOND_DEGREE' });

    const branched = async (org: TestOrg) => buildSequence(org, org.owner.userId, [
      { action_type: 'check_connection' },
      { action_type: 'message', message_template: 'Connecté' },
      { action_type: 'connection_request', message_template: 'Invit' },
    ], { links: [[0, { if_true_goto_step: 1, if_false_goto_step: 2 }]] });
    const plain = async (org: TestOrg) => buildSequence(org, org.owner.userId, [
      { action_type: 'check_connection' },
      { action_type: 'message', message_template: 'Suite' },
      { action_type: 'message', message_template: 'Troisième', delay_days: 3 },
    ]);

    const seqFirst = await branched(first.org);
    const seqSecond = await branched(second.org);
    const plainFirst = await plain(first.org);
    const plainSecond = await plain(second.org);
    const eFirst = await enroll(first.org, seqFirst.sequenceId, first.org.owner.userId, first.accountId);
    const eSecond = await enroll(second.org, seqSecond.sequenceId, second.org.owner.userId, second.accountId);
    const pFirst = await enroll(first.org, plainFirst.sequenceId, first.org.owner.userId, first.accountId);
    const pSecond = await enroll(second.org, plainSecond.sequenceId, second.org.owner.userId, second.accountId);
    await schedule(first.org, eFirst.enrollmentId, seqFirst.steps[0]);
    await schedule(second.org, eSecond.enrollmentId, seqSecond.steps[0]);
    await schedule(first.org, pFirst.enrollmentId, plainFirst.steps[0]);
    await schedule(second.org, pSecond.enrollmentId, plainSecond.steps[0]);

    await runCycle();

    // Relation directe : cible « Si connecté », rien sur « Si non connecté ».
    const firstRows = await execs(eFirst.enrollmentId);
    expect(onStep(firstRows, seqFirst.steps[0])[0]?.status, 'vérification franchie').toBe('sent');
    expect(onStep(firstRows, seqFirst.steps[1]), 'cible « Si connecté » planifiée').toHaveLength(1);
    expect(onStep(firstRows, seqFirst.steps[2]), 'rien sur la cible « Si non connecté »').toHaveLength(0);
    expect((await enrollmentFull(eFirst.enrollmentId)).connection_status).toBe('connected');

    // Hors relation : cible « Si non connecté », rien sur « Si connecté ».
    const secondRows = await execs(eSecond.enrollmentId);
    expect(onStep(secondRows, seqSecond.steps[0])[0]?.status).toBe('sent');
    expect(onStep(secondRows, seqSecond.steps[2]), 'cible « Si non connecté » planifiée').toHaveLength(1);
    expect(onStep(secondRows, seqSecond.steps[1]), 'rien sur la cible « Si connecté »').toHaveLength(0);
    expect((await enrollmentFull(eSecond.enrollmentId)).connection_status).toBe('not_connected');

    // Deux branches « Étape suivante » (NULL) : l'étape d'ordre 1 dans les deux cas.
    for (const [who, seq, status] of [[pFirst, plainFirst, 'connected'], [pSecond, plainSecond, 'not_connected']] as const) {
      const rows = await execs(who.enrollmentId);
      expect(onStep(rows, seq.steps[1]), 'étape d\'ordre suivant planifiée').toHaveLength(1);
      expect(onStep(rows, seq.steps[2])).toHaveLength(0);
      expect((await enrollmentFull(who.enrollmentId)).connection_status).toBe(status);
    }

    // Les suites des séquences sans branche ne partent pas avec les cibles.
    await postpone(pFirst.enrollmentId, plainFirst.steps[1]);
    await postpone(pSecond.enrollmentId, plainSecond.steps[1]);

    // Les cibles partent : message au connecté, invitation au non-connecté, et
    // la branche « Si connecté » ne retombe pas sur l'invitation ensuite.
    await rewind(onStep(firstRows, seqFirst.steps[1])[0].id);
    await rewind(onStep(secondRows, seqSecond.steps[2])[0].id);
    await runCycle();
    expect(await sentTexts(first.accountId)).toEqual(['Connecté']);
    expect(await sentInvites(first.accountId), 'aucune invitation au candidat connecté').toHaveLength(0);
    const invites = await sentInvites(second.accountId);
    expect(invites).toHaveLength(1);
    expect(bodyOf(invites[0]).message).toBe('Invit');
    expect(await sentTexts(second.accountId), 'aucun message au non-connecté').toEqual([]);
    const afterBranch = await execs(eFirst.enrollmentId);
    expect(onStep(afterBranch, seqFirst.steps[2]), 'fin de la branche « Si connecté » : pas d\'invitation').toHaveLength(0);
    expect((await enrollmentFull(eFirst.enrollmentId)).status).toBe('completed');
  });

  // engine-wait-connection-flow
  test('@critical « Attendre la connexion » attend l\'acceptation, le webhook la réarme, le cycle suivant la franchit et planifie la suite', async () => {
    const { org, accountId } = await newSendingOrg('E2E steps-1 attente');
    await setMockMode(accountId, { distance: 'SECOND_DEGREE' });
    const linear = await buildSequence(org, org.owner.userId, [
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted', timeout_days: 7 },
      { action_type: 'message', message_template: 'Merci' },
    ]);
    const withTarget = await buildSequence(org, org.owner.userId, [
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted', timeout_days: 7 },
      { action_type: 'message', message_template: 'Branche par défaut' },
      { action_type: 'message', message_template: 'Cible si connecté' },
    ], { links: [[0, { if_true_goto_step: 2 }]] });

    const active = await enroll(org, linear.sequenceId, org.owner.userId, accountId);
    const targeted = await enroll(org, withTarget.sequenceId, org.owner.userId, accountId);
    const paused = await enroll(org, linear.sequenceId, org.owner.userId, accountId);
    const activeWait = await schedule(org, active.enrollmentId, linear.steps[0]);
    const targetedWait = await schedule(org, targeted.enrollmentId, withTarget.steps[0]);
    const pausedWait = await schedule(org, paused.enrollmentId, linear.steps[0]);

    await runCycle();
    for (const id of [activeWait, targetedWait, pausedWait]) {
      expect((await execById(id)).status, 'attente en cours tant que l\'invitation n\'est pas acceptée').toBe('waiting_event');
    }
    expect((await mockCalls(accountId)).filter((c) => c.method === 'POST'), 'aucun envoi pendant l\'attente').toEqual([]);
    expect((await enrollmentFull(active.enrollmentId)).connection_status).not.toBe('connected');

    // La troisième inscription passe en pause avant l'acceptation.
    await admin().from('sequence_enrollments').update({ status: 'paused', pause_reason: 'manual' }).eq('id', paused.enrollmentId);

    for (const who of [active, targeted, paused]) {
      await webhook({
        event: 'new_relation', account_id: accountId, account_type: 'LINKEDIN',
        user_provider_id: who.profileId, user_full_name: 'Camille Martin', user_public_identifier: `camille-${rand()}`,
      });
    }
    const rearmed = await execById(activeWait);
    expect(rearmed.status, 'webhook d\'acceptation : attente réarmée').toBe('scheduled');
    expect(new Date(rearmed.scheduled_at).getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
    expect((await enrollmentFull(active.enrollmentId)).connection_status).toBe('connected');
    // Inscription en pause : acceptation consignée, attente non réarmée.
    expect((await execById(pausedWait)).status).toBe('waiting_event');
    const pausedRow = await enrollmentFull(paused.enrollmentId);
    expect(pausedRow.connection_status).toBe('connected');
    expect(pausedRow.status).toBe('paused');

    await runCycle();
    const crossed = await execById(activeWait);
    expect(crossed.status).toBe('sent');
    expect(crossed.final_message).toBe('Attente franchie : wait_connection');
    const activeRow = await enrollmentFull(active.enrollmentId);
    expect(activeRow.connection_status).toBe('connected');
    expect(activeRow.current_step_order).toBe(1);
    const next = onStep(await execs(active.enrollmentId), linear.steps[1]);
    expect(next, 'étape suivante planifiée').toHaveLength(1);
    expect(next[0].status).toBe('scheduled');

    // Cible « Si connecté » définie : c'est elle qui est planifiée.
    const targetedRows = await execs(targeted.enrollmentId);
    expect(onStep(targetedRows, withTarget.steps[0])[0].status).toBe('sent');
    expect(onStep(targetedRows, withTarget.steps[2]), 'cible « Si connecté »').toHaveLength(1);
    expect(onStep(targetedRows, withTarget.steps[1])).toHaveLength(0);
    expect((await execById(pausedWait)).status, 'rien ne bouge pour l\'inscription en pause').toBe('waiting_event');

    // La cible « Si connecté » ne part pas avec « Merci ».
    await postpone(targeted.enrollmentId, withTarget.steps[2]);
    await rewind(next[0].id);
    await runCycle();
    expect(await sentTexts(accountId)).toEqual(['Merci']);
  });

  // engine-wait-timeout-branch
  test('@critical délai d\'attente dépassé : attente sautée, étape de repli (ou suivante) planifiée ; candidat connecté réarmé ; rien pour une pause ou une séquence désactivée', async () => {
    const { org, accountId } = await newSendingOrg('E2E steps-1 délai');
    const withFallback = await buildSequence(org, org.owner.userId, [
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted', timeout_days: 3 },
      { action_type: 'message', message_template: 'Relance simple' },
      { action_type: 'inmail', subject_template: 'Une mission', message_template: 'InMail de repli' },
    ], { links: [[0, { timeout_branch_step_id: 2 }]] });
    const noFallback = await buildSequence(org, org.owner.userId, [
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted', timeout_days: 3 },
      { action_type: 'message', message_template: 'Suite linéaire' },
    ]);
    const inactive = await buildSequence(org, org.owner.userId, [
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted', timeout_days: 3 },
      { action_type: 'message', message_template: 'Jamais' },
    ], { links: [], sequence: { is_active: false } });

    const days = (d: number) => minutesFromNow(-d * 24 * 60);
    const expired = await enroll(org, withFallback.sequenceId, org.owner.userId, accountId);
    const notYet = await enroll(org, withFallback.sequenceId, org.owner.userId, accountId);
    const connected = await enroll(org, withFallback.sequenceId, org.owner.userId, accountId, { connection_status: 'connected' });
    const overridden = await enroll(org, withFallback.sequenceId, org.owner.userId, accountId);
    const paused = await enroll(org, withFallback.sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'manual' });
    const linear = await enroll(org, noFallback.sequenceId, org.owner.userId, accountId);
    const off = await enroll(org, inactive.sequenceId, org.owner.userId, accountId);
    await admin().from('sequence_enrollments').update({
      tracking_data: { step_config_overrides: { [withFallback.steps[0].id]: { timeoutDays: 1 } } },
    }).eq('id', overridden.enrollmentId);

    const waiting = { status: 'waiting_event' };
    const wExpired = await schedule(org, expired.enrollmentId, withFallback.steps[0], { ...waiting, scheduled_at: days(4) });
    const wNotYet = await schedule(org, notYet.enrollmentId, withFallback.steps[0], { ...waiting, scheduled_at: days(2) });
    const wConnected = await schedule(org, connected.enrollmentId, withFallback.steps[0], { ...waiting, scheduled_at: days(4) });
    const wOverridden = await schedule(org, overridden.enrollmentId, withFallback.steps[0], { ...waiting, scheduled_at: days(2) });
    const wPaused = await schedule(org, paused.enrollmentId, withFallback.steps[0], { ...waiting, scheduled_at: days(4) });
    const wLinear = await schedule(org, linear.enrollmentId, noFallback.steps[0], { ...waiting, scheduled_at: days(4) });
    const wOff = await schedule(org, off.enrollmentId, inactive.steps[0], { ...waiting, scheduled_at: days(4) });

    const res = await runEngine({ action: 'check_timeouts' });
    expect(res.success).toBe(true);

    // Délai de 3 j dépassé (attente commencée il y a 4 j) : repli planifié, pas l'étape 1.
    const e1 = await execById(wExpired);
    expect(e1.status).toBe('skipped');
    expect(e1.skip_reason).toBe('Timeout 3d');
    const expiredRows = await execs(expired.enrollmentId);
    expect(onStep(expiredRows, withFallback.steps[2]), 'étape de repli planifiée').toHaveLength(1);
    expect(onStep(expiredRows, withFallback.steps[1]), 'l\'étape suivante n\'est pas planifiée').toHaveLength(0);

    // Attente commencée il y a 2 j : délai non atteint.
    expect((await execById(wNotYet)).status).toBe('waiting_event');
    expect(await execs(notYet.enrollmentId)).toHaveLength(1);

    // Candidat déjà connecté : attente réarmée, pas de repli.
    expect((await execById(wConnected)).status).toBe('scheduled');
    expect(onStep(await execs(connected.enrollmentId), withFallback.steps[2])).toHaveLength(0);

    // Délai de l'inscription (1 j) à la place de celui de l'étape.
    const e4 = await execById(wOverridden);
    expect(e4.status).toBe('skipped');
    expect(e4.skip_reason).toContain('Timeout 1d');
    expect(onStep(await execs(overridden.enrollmentId), withFallback.steps[2])).toHaveLength(1);

    // Sans repli : étape suivante.
    expect((await execById(wLinear)).status).toBe('skipped');
    expect(onStep(await execs(linear.enrollmentId), noFallback.steps[1])).toHaveLength(1);

    // Inscription en pause ou séquence désactivée : rien ne bouge.
    for (const [id, enr] of [[wPaused, paused], [wOff, off]] as const) {
      expect((await execById(id)).status).toBe('waiting_event');
      expect(await execs(enr.enrollmentId)).toHaveLength(1);
    }
    expect((await enrollmentFull(paused.enrollmentId)).status).toBe('paused');
    expect((await enrollmentFull(off.enrollmentId)).status).toBe('active');
  });

  // engine-check-connection-read-failure
  test('profil illisible : « Vérifier la connexion » ne choisit aucune branche, n\'écrit pas connection_status, réessaie à 30 min puis échoue après trois essais', async () => {
    const { org, accountId } = await newSendingOrg('E2E steps-1 profil illisible');
    await setMockMode(accountId, { routes: [{ method: 'GET', path: '^/api/v1/users/', status: 503, body: { status: 503 } }] });
    const seq = await buildSequence(org, org.owner.userId, [
      { action_type: 'check_connection' },
      { action_type: 'message', message_template: 'Connecté' },
      { action_type: 'connection_request', message_template: 'Invit' },
    ], { links: [[0, { if_true_goto_step: 1, if_false_goto_step: 2 }]] });
    const { enrollmentId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId);
    const initialStatus = (await enrollmentFull(enrollmentId)).connection_status;
    const checkId = await schedule(org, enrollmentId, seq.steps[0]);

    await runCycle();
    const first = await execById(checkId);
    expect(first.status).toBe('scheduled');
    expect(first.retry_count).toBe(1);
    expect(first.error_message ?? '').toMatch(/^Retry 1\/3: profile_read_unavailable/);
    const delay = new Date(first.scheduled_at).getTime() - Date.now();
    expect(delay, 'nouvel essai vers +30 min').toBeGreaterThan(25 * 60_000);
    expect(delay).toBeLessThan(35 * 60_000);
    expect((await enrollmentFull(enrollmentId)).connection_status, 'relation non devinée ni écrite').toBe(initialStatus);
    expect(await execs(enrollmentId), 'aucune branche planifiée').toHaveLength(1);

    for (let i = 0; i < 3; i++) {
      await rewind(checkId);
      await runCycle();
    }
    const last = await execById(checkId);
    expect(last.status, 'échec après trois essais').toBe('failed');
    expect((await enrollmentFull(enrollmentId)).connection_status).toBe(initialStatus);
    expect(await execs(enrollmentId)).toHaveLength(1);
    expect(await sentTexts(accountId)).toEqual([]);
    expect(await sentInvites(accountId)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rédaction IA en échec
// ═══════════════════════════════════════════════════════════════════════════

test.describe('@critical Rédaction IA', () => {
  // ai-failure-no-send-retry — lot 5a-2 : le moteur ne rédige plus à l'envoi.
  // Une étape IA sans texte relu ne va plus jusqu'au modèle : elle est
  // reportée d'une heure avec la raison, sans jeton débité ni échec.
  test('@critical une étape IA sans relecture n\'appelle pas le modèle : reportée d\'une heure avec la raison, aucun jeton débité, jamais d\'échec, le modèle brut ne part pas', async () => {
    const { org, accountId } = await newSendingOrg('E2E steps-1 IA');
    const marker = `MQ${rand()}${rand()}`;
    const template = `Modèle brut ${marker}`;
    const seq = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: template, use_ai_personalization: true },
    ]);
    const { enrollmentId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId);
    const execId = await schedule(org, enrollmentId, seq.steps[0]);

    await runCycle();
    const first = await execById(execId);
    expect(await sentTexts(accountId), 'rien ne part').toEqual([]);
    expect(first.status).toBe('scheduled');
    expect(first.retry_count ?? 0, 'aucun essai compté').toBe(0);
    expect(first.error_message).toBe("Message rédigé par l'IA à relire avant l'envoi.");
    expect(first.final_message, 'aucun texte figé').toBeNull();
    const delay = new Date(first.scheduled_at).getTime() - Date.now();
    expect(delay, 'report d\'une heure').toBeGreaterThan(55 * 60_000);
    expect(delay).toBeLessThan(65 * 60_000);

    for (let i = 0; i < 3; i++) {
      await rewind(execId);
      await runCycle();
    }
    const last = await execById(execId);
    expect(last.status, 'toujours reportée, jamais en échec').toBe('scheduled');
    expect(last.retry_count ?? 0).toBe(0);
    expect(last.error_message).toBe("Message rédigé par l'IA à relire avant l'envoi.");
    const { data: debits } = await admin().from('ai_credit_transactions').select('id').eq('organization_id', org.orgId);
    expect(debits ?? [], 'aucun jeton débité').toEqual([]);
    const aiCalls = (await mockCalls()).filter((c) => c.method === 'POST' && c.path === '/v1/messages' && JSON.stringify(c.body).includes(marker));
    expect(aiCalls, 'aucun appel au modèle').toEqual([]);
    const texts = await sentTexts(accountId);
    expect(texts, 'aucun envoi').toEqual([]);
    const enrollment = await enrollmentFull(enrollmentId);
    expect(enrollment.status, 'inscription ni en pause ni close').toBe('active');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rotation des expéditeurs
// ═══════════════════════════════════════════════════════════════════════════

test.describe('@critical Rotation des expéditeurs', () => {
  // rotation-assign-before-send
  test('@critical la première étape LinkedIn tire un compte du groupe, l\'enregistre avant l\'envoi, envoie depuis lui et suit ensuite son état', async () => {
    const { org, accountId: ownerAccount, extra } = await newSendingOrg('E2E steps-1 rotation');
    const member = await addMember(org.orgId, 'member', 'rotation');
    extra.push(member);
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_rot_${rand()}`, 'OK');
    const seq = await buildSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Premier message' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ], {
      sequence: {
        multi_sender_enabled: true,
        rotation_mode: 'round_robin',
        sender_accounts: [{ account_id: memberAccount, daily_limit: 50, channel: 'linkedin' }],
      },
    });
    const { enrollmentId } = await enroll(org, seq.sequenceId, org.owner.userId, ownerAccount);
    await schedule(org, enrollmentId, seq.steps[0]);

    await runCycle();
    const row = await enrollmentFull(enrollmentId);
    expect(row.assigned_sender_id, 'compte du groupe enregistré (texte)').toBe(memberAccount);
    expect(await sentTexts(memberAccount), 'envoi depuis le compte tiré').toEqual(['Premier message']);
    expect(await sentTexts(ownerAccount), 'rien depuis le compte de l\'inscription').toEqual([]);
    expect(await ledger(memberAccount)).toContain('message');
    expect(await ledger(ownerAccount)).not.toContain('message');

    // Le compte tiré se déconnecte : l'étape suivante suit SON état, même si
    // le compte de l'inscription est en état OK.
    await admin().from('member_linkedin_accounts').update({ account_status: 'CREDENTIALS' }).eq('linkedin_account_id', memberAccount);
    const followUp = onStep(await execs(enrollmentId), seq.steps[1]);
    expect(followUp).toHaveLength(1);
    await rewind(followUp[0].id);
    await runCycle();
    const paused = await enrollmentFull(enrollmentId);
    expect(paused.status).toBe('paused');
    expect(paused.pause_reason).toBe('account_disconnected');
    expect(await sentTexts(ownerAccount), 'pas de repli sur le compte de l\'inscription').toEqual([]);
    expect(await sentTexts(memberAccount)).toEqual(['Premier message']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// File InMail
// ═══════════════════════════════════════════════════════════════════════════

async function queueRow(fields: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin()
    .from('inmail_queue')
    .insert({
      recipient_profile_id: `ACoAAE2EQ${rand()}${rand()}`,
      recipient_name: 'Candidat File',
      subject: 'Objet',
      message: 'Bonjour',
      status: 'scheduled',
      scheduled_at: minutesFromNow(24 * 60),
      user_timezone: 'Europe/Paris',
      ...fields,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`queueRow: ${error?.message}`);
  return data.id as string;
}

async function queueStatus(id: string) {
  const { data } = await admin().from('inmail_queue').select('status, error_message, scheduled_at').eq('id', id).single();
  return data as { status: string; error_message: string | null; scheduled_at: string | null };
}

const inmailQueue = (tok: string | null, body: Record<string, unknown>) =>
  postJson('/functions/v1/process-inmail-queue', body, tok ? { Authorization: `Bearer ${tok}` } : {});

test.describe('@critical File InMail', () => {
  // inmail-queue-rights
  test('@critical la file refuse l\'anonyme, n\'accepte que le compte relié de l\'appelant, et borne annulation, statut et traitement à ses InMails', async () => {
    const a = await newSendingOrg('E2E steps-1 file A');
    const b = await newSendingOrg('E2E steps-1 file B');
    const member = await addMember(a.org.orgId, 'member', 'file');
    a.extra.push(member);
    const memberAccount = await seedLinkedInAccount(a.org.orgId, member.userId, `acc_q_${rand()}`, 'OK');
    const ownerTok = await token(a.org.owner);
    const memberTok = await token(member);
    const item = (account: string) => ({
      account_id: account, recipient_profile_id: `ACoAAE2EQ${rand()}${rand()}`, recipient_name: 'Candidat',
      subject: 'Une mission', message: 'Bonjour, je me permets.',
    });

    // Sans session.
    const anonItem = item(a.accountId);
    const anon = await inmailQueue(null, { action: 'queue', items: [anonItem] });
    expect(anon.status).toBeGreaterThanOrEqual(400);
    expect(anon.status).toBeLessThan(500);
    const { data: anonRows } = await admin().from('inmail_queue').select('id').eq('recipient_profile_id', anonItem.recipient_profile_id);
    expect(anonRows ?? []).toHaveLength(0);

    // Compte d'un collègue (le propriétaire lui-même est refusé).
    const colleague = await inmailQueue(ownerTok, { action: 'queue', items: [item(memberAccount)] });
    expect(colleague.status).toBe(403);
    expect(colleague.body.error).toBe('ACCOUNT_OF_OTHER_MEMBER');
    // Compte d'une autre organisation.
    const foreign = await inmailQueue(ownerTok, { action: 'queue', items: [item(b.accountId)] });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe('ACCOUNT_NOT_ALLOWED');
    // Son propre compte.
    const own = item(a.accountId);
    const ok = await inmailQueue(ownerTok, { action: 'queue', items: [own] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.queued).toBe(1);
    const { data: ownRows } = await admin().from('inmail_queue').select('organization_id, created_by, account_id, status')
      .eq('recipient_profile_id', own.recipient_profile_id);
    expect(ownRows).toEqual([expect.objectContaining({ organization_id: a.org.orgId, created_by: a.org.owner.userId, account_id: a.accountId })]);
    expect((await mockCalls(memberAccount)).length + (await mockCalls(b.accountId)).length, 'aucun appel pour les comptes refusés').toBe(0);

    // Annulation sans ids : seules les lignes en attente de l'appelant.
    const base = { organization_id: a.org.orgId, account_id: memberAccount, created_by: member.userId };
    const m1 = await queueRow({ ...base, status: 'pending' });
    const m2 = await queueRow({ ...base, status: 'scheduled' });
    const mSent = await queueRow({ ...base, status: 'sent' });
    const ownerPending = await queueRow({ organization_id: a.org.orgId, account_id: a.accountId, created_by: a.org.owner.userId, status: 'scheduled' });
    const cancel = await inmailQueue(memberTok, { action: 'cancel' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(cancel.body.cancelled, 'compteur exact').toBe(2);
    expect((await queueStatus(m1)).status).toBe('cancelled');
    expect((await queueStatus(m2)).status).toBe('cancelled');
    expect((await queueStatus(mSent)).status).toBe('sent');
    expect((await queueStatus(ownerPending)).status, 'la file du collègue n\'est pas touchée').toBe('scheduled');

    // Statut : compteurs sur toute la file de l'appelant (au-delà des 100 lignes affichées).
    const { error: bulkErr } = await admin().from('inmail_queue').insert(Array.from({ length: 101 }, (_, i) => ({
      ...base, recipient_profile_id: `ACoAAE2EBULK${rand()}${i}`, subject: 'Objet', message: 'Bonjour', status: 'failed',
      scheduled_at: minutesFromNow(-60), user_timezone: 'Europe/Paris',
    })));
    if (bulkErr) throw new Error(`bulk: ${bulkErr.message}`);
    const status = await inmailQueue(memberTok, { action: 'status' });
    expect(status.status).toBe(200);
    expect(status.body.stats).toEqual({ pending: 0, scheduled: 0, sending: 0, sent: 1, failed: 101, cancelled: 2 });
    expect((status.body.items as unknown[]).length).toBe(100);

    // Traitement en session : seulement les InMails de l'appelant. Un compte
    // non relié fait échouer la ligne avant la plage horaire : testable dimanche.
    const ghost = `acc_ghost_${rand()}`;
    const memberDue = await queueRow({ ...base, account_id: ghost, scheduled_at: '2000-01-01T00:00:00Z' });
    const ownerDue = await queueRow({ organization_id: a.org.orgId, account_id: ghost, created_by: a.org.owner.userId, scheduled_at: '2000-01-01T00:00:00Z' });
    const processed = await inmailQueue(memberTok, { action: 'process' });
    expect(processed.status, JSON.stringify(processed.body)).toBe(200);
    expect((await queueStatus(memberDue)).status).toBe('failed');
    expect((await queueStatus(ownerDue)).status, 'l\'InMail du collègue n\'est pas traité').toBe('scheduled');
  });

  // inmail-queue-process-account-link
  test('@critical au traitement, un InMail dont le compte n\'est pas relié à l\'organisation de la ligne échoue avant tout appel au fournisseur', async () => {
    const a = await newSendingOrg('E2E steps-1 file liaison A');
    const b = await newSendingOrg('E2E steps-1 file liaison B');
    const id = await queueRow({
      organization_id: a.org.orgId, account_id: b.accountId, created_by: a.org.owner.userId,
      status: 'scheduled', scheduled_at: '2000-01-01T00:00:00Z',
    });
    const res = await inmailQueue(CRON_SECRET, { action: 'process' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await queueStatus(id);
    expect(row.status).toBe('failed');
    expect(row.error_message).toBe('Compte non rattaché à l\'organisation');
    expect(await mockCalls(b.accountId), 'ni solde ni envoi pour ce compte').toEqual([]);
  });

  // inmail-queue-errors-no-double (partie couverte un dimanche : rattrapage 'sending')
  test('@critical une ligne restée « en cours d\'envoi » plus de 15 min échoue sans être renvoyée', async () => {
    const a = await newSendingOrg('E2E steps-1 file bloquée');
    const stuck = await queueRow({
      organization_id: a.org.orgId, account_id: a.accountId, created_by: a.org.owner.userId,
      status: 'sending', scheduled_at: minutesFromNow(-30), updated_at: minutesFromNow(-20),
    });
    const recent = await queueRow({
      organization_id: a.org.orgId, account_id: a.accountId, created_by: a.org.owner.userId,
      status: 'sending', scheduled_at: minutesFromNow(-10), updated_at: minutesFromNow(-5),
    });
    const res = await inmailQueue(CRON_SECRET, { action: 'process' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await queueStatus(stuck);
    expect(row.status).toBe('failed');
    expect(row.error_message ?? '').toContain('Interrompu pendant l\'envoi');
    expect((await queueStatus(recent)).status, 'envoi de moins de 15 min : laissé en cours').toBe('sending');
    expect((await mockCalls(a.accountId)).filter(isChatPost), 'jamais renvoyé').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Canaux fermés, mode d'envoi, invitations
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Canaux et modes d\'envoi', () => {
  // engine-closed-channels-skip
  test('une étape e-mail ou WhatsApp est sautée « pas encore disponible » sans appel, la suite part et l\'inscription n\'est pas close', async () => {
    const { org, accountId } = await newSendingOrg('E2E steps-1 canaux fermés');
    const seq = await buildSequence(org, org.owner.userId, [
      { action_type: 'email', subject_template: 'Une mission', message_template: 'Bonjour par e-mail' },
      { action_type: 'whatsapp_message', message_template: 'Bonjour par WhatsApp' },
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const phone = '+33612345678';
    const { enrollmentId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId, {
      email_used: `camille.${rand()}@e2e.konekt.test`, phone_used: phone,
    });
    const emailExec = await schedule(org, enrollmentId, seq.steps[0]);

    await runCycle();
    const e0 = await execById(emailExec);
    expect(e0.status).toBe('skipped');
    expect(e0.skip_reason).toBe('Étape e-mail pas encore disponible : étape sautée');
    const wa = onStep(await execs(enrollmentId), seq.steps[1]);
    expect(wa, 'étape suivante planifiée').toHaveLength(1);
    await rewind(wa[0].id);

    await runCycle();
    const e1 = await execById(wa[0].id);
    expect(e1.status).toBe('skipped');
    expect(e1.skip_reason).toBe('Étape WhatsApp pas encore disponible : étape sautée');
    const msg = onStep(await execs(enrollmentId), seq.steps[2]);
    expect(msg).toHaveLength(1);
    await rewind(msg[0].id);

    await runCycle();
    expect((await execById(msg[0].id)).status).toBe('sent');
    expect(await sentTexts(accountId)).toEqual(['Bonjour']);
    const calls = await mockCalls(accountId);
    expect(calls.filter((c) => c.path.includes(encodeURIComponent(phone)) || c.path.includes(phone)), 'aucun appel WhatsApp').toEqual([]);
    const { data: tracking } = await admin().from('sequence_email_tracking').select('id').in('execution_id', [emailExec]);
    expect(tracking ?? [], 'aucun appel à l\'envoi d\'e-mail').toEqual([]);
    const rows = await execs(enrollmentId);
    expect(rows.some((r) => r.skip_reason === 'no_previous_message'), 'jamais clos par la garde « aucun message précédent »').toBe(false);
    const enr = await enrollmentFull(enrollmentId);
    expect(enr.status).toBe('active');
    expect(onStep(rows, seq.steps[3]), 'relance planifiée').toHaveLength(1);
  });

  // engine-send-mode-direct
  test('Message IA ou InMail vers une relation directe : message gratuit sans InMail ni solde ; « Message LinkedIn » jamais en InMail', async () => {
    const { org, accountId } = await newSendingOrg('E2E steps-1 message direct');
    const smart = await buildSequence(org, org.owner.userId, [
      { action_type: 'smart_message', subject_template: 'Objet', message_template: 'Texte' },
    ]);
    const inmail = await buildSequence(org, org.owner.userId, [
      { action_type: 'inmail', subject_template: 'Objet InMail', message_template: 'Texte InMail' },
    ]);
    const e1 = await enroll(org, smart.sequenceId, org.owner.userId, accountId);
    const e2 = await enroll(org, inmail.sequenceId, org.owner.userId, accountId);
    await schedule(org, e1.enrollmentId, smart.steps[0]);
    await schedule(org, e2.enrollmentId, inmail.steps[0]);

    await runCycle();
    const posts = (await mockCalls(accountId)).filter(isChatPost);
    expect(posts.map((p) => bodyOf(p).text).sort()).toEqual(['Texte', 'Texte InMail']);
    for (const p of posts) {
      expect(bodyOf(p)['linkedin[inmail]'], 'pas d\'InMail vers une relation directe').toBeUndefined();
      expect(bodyOf(p).subject).toBeUndefined();
    }
    expect((await mockCalls(accountId)).filter((c) => c.path === '/api/v1/linkedin/inmail_balance'), 'aucun contrôle de solde').toEqual([]);
    const log = await ledger(accountId);
    expect(log.filter((t) => t === 'message')).toHaveLength(2);
    expect(log).not.toContain('inmail');

    // Candidat hors relation, étape « Message LinkedIn » : jamais un InMail.
    await setMockMode(accountId, { distance: 'SECOND_DEGREE' });
    const plain = await buildSequence(org, org.owner.userId, [{ action_type: 'message', message_template: 'Message simple' }]);
    const e3 = await enroll(org, plain.sequenceId, org.owner.userId, accountId);
    await schedule(org, e3.enrollmentId, plain.steps[0]);
    await runCycle();
    const simple = (await mockCalls(accountId)).filter(isChatPost).filter((p) => bodyOf(p).text === 'Message simple');
    expect(simple).toHaveLength(1);
    expect(bodyOf(simple[0])['linkedin[inmail]']).toBeUndefined();
    expect(bodyOf(simple[0])['linkedin[api]']).toBeUndefined();
    expect((await mockCalls(accountId)).filter((c) => c.path === '/api/v1/linkedin/inmail_balance')).toEqual([]);
  });

  // engine-inmail-second-degree
  test('hors relation, InMail et Message IA partent en InMail, objet résolu, mode selon les crédits, comptés dans le plafond InMail', async () => {
    const { org, accountId } = await newSendingOrg('E2E steps-1 InMail 2e');
    await setMockMode(accountId, {
      distance: 'SECOND_DEGREE',
      routes: [{ method: 'GET', path: 'inmail_balance', body: { object: 'InMailBalance', recruiter: 0, sales_navigator: 3, premium: 0 } }],
    });
    const inmail = await buildSequence(org, org.owner.userId, [
      { action_type: 'inmail', subject_template: 'Mission {{poste_recherche}}', message_template: 'Bonjour, une mission pourrait vous intéresser.' },
    ]);
    const smart = await buildSequence(org, org.owner.userId, [
      { action_type: 'smart_message', subject_template: 'Échange {{poste_recherche}}', message_template: 'Bonjour, un échange ?' },
    ]);
    const e1 = await enroll(org, inmail.sequenceId, org.owner.userId, accountId, { job_title: 'Développeur Go' });
    const e2 = await enroll(org, smart.sequenceId, org.owner.userId, accountId, { job_title: 'Développeur Go' });
    const x1 = await schedule(org, e1.enrollmentId, inmail.steps[0]);
    const x2 = await schedule(org, e2.enrollmentId, smart.steps[0]);

    await runCycle();
    const posts = (await mockCalls(accountId)).filter(isChatPost);
    expect(posts).toHaveLength(2);
    const bySubject = new Map(posts.map((p) => [String(bodyOf(p).subject), bodyOf(p)]));
    for (const subject of ['Mission Développeur Go', 'Échange Développeur Go']) {
      const b = bySubject.get(subject);
      expect(b, `InMail « ${subject} »`).toBeDefined();
      expect(b!['linkedin[inmail]']).toBe('true');
      expect(b!['linkedin[api]']).toBe('sales_navigator');
    }
    expect((await execById(x1)).final_subject).toBe('Mission Développeur Go');
    expect((await execById(x2)).final_subject).toBe('Échange Développeur Go');
    expect((await mockCalls(accountId)).some((c) => c.path === '/api/v1/linkedin/inmail_balance'), 'solde contrôlé').toBe(true);
    const log = await ledger(accountId);
    expect(log.filter((t) => t === 'inmail'), 'comptés dans le plafond InMail').toHaveLength(2);
    expect(log).not.toContain('message');
  });

  // engine-inmail-credits-zero
  test('sans crédit InMail : étape « quota_blocked » jusqu\'au lendemain à l\'ouverture, sans envoi ni essai consommé ; solde illisible : +30 min', async () => {
    const zero = await newSendingOrg('E2E steps-1 InMail zéro');
    const down = await newSendingOrg('E2E steps-1 InMail solde KO');
    await setMockMode(zero.accountId, {
      distance: 'SECOND_DEGREE',
      routes: [{ method: 'GET', path: 'inmail_balance', body: { recruiter: 0, premium: 0, sales_navigator: 0 } }],
    });
    await setMockMode(down.accountId, {
      distance: 'SECOND_DEGREE',
      routes: [{ method: 'GET', path: 'inmail_balance', status: 503, body: { status: 503 } }],
    });
    const seqZero = await buildSequence(zero.org, zero.org.owner.userId, [
      { action_type: 'inmail', subject_template: 'Objet', message_template: 'Bonjour' },
    ]);
    const seqDown = await buildSequence(down.org, down.org.owner.userId, [
      { action_type: 'inmail', subject_template: 'Objet', message_template: 'Bonjour' },
    ]);
    const ez = await enroll(zero.org, seqZero.sequenceId, zero.org.owner.userId, zero.accountId);
    const ed = await enroll(down.org, seqDown.sequenceId, down.org.owner.userId, down.accountId);
    const xz = await schedule(zero.org, ez.enrollmentId, seqZero.steps[0]);
    const xd = await schedule(down.org, ed.enrollmentId, seqDown.steps[0]);

    const before = new Date();
    await runCycle();

    const z = await execById(xz);
    expect(z.status).toBe('quota_blocked');
    expect(z.skip_reason).toBe('Crédits InMail épuisés');
    expect(z.retry_count ?? 0, 'aucun essai consommé').toBe(0);
    const tomorrow = parisParts(new Date(before.getTime() + 24 * 3600_000)).day;
    const at = parisParts(new Date(z.scheduled_at));
    expect(at.day, 'lendemain, fuseau de l\'inscription').toBe(tomorrow);
    expect([at.hour, at.minute], 'début de la plage d\'envoi').toEqual([8, 0]);
    expect((await mockCalls(zero.accountId)).filter(isChatPost)).toEqual([]);
    const { data: seqRow } = await admin().from('outreach_sequences').select('is_active').eq('id', seqZero.sequenceId).single();
    expect(seqRow?.is_active).toBe(true);
    expect((await enrollmentFull(ez.enrollmentId)).status).toBe('active');

    const d = await execById(xd);
    expect(d.status).toBe('quota_blocked');
    expect(d.skip_reason ?? '').toContain('momentanément indisponible');
    const delay = new Date(d.scheduled_at).getTime() - Date.now();
    expect(delay).toBeGreaterThan(25 * 60_000);
    expect(delay).toBeLessThan(35 * 60_000);
    expect((await mockCalls(down.accountId)).filter(isChatPost)).toEqual([]);
  });

  // engine-invite-already-connected-skip
  test('une invitation à un candidat déjà en relation ou déjà invité est sautée avec sa raison, sans échec ni pause, et la suite est planifiée', async () => {
    const connected = await newSendingOrg('E2E steps-1 déjà relié');
    const invited = await newSendingOrg('E2E steps-1 déjà invité');
    await setMockMode(invited.accountId, {
      distance: 'SECOND_DEGREE',
      routes: [{ method: 'POST', path: '^/api/v1/users/invite$', status: 422, body: { detail: 'already_invited' } }],
    });
    const mk = (org: TestOrg) => buildSequence(org, org.owner.userId, [
      { action_type: 'connection_request', message_template: 'Invitation' },
      { action_type: 'message', message_template: 'Suite' },
    ]);
    const s1 = await mk(connected.org);
    const s2 = await mk(invited.org);
    const e1 = await enroll(connected.org, s1.sequenceId, connected.org.owner.userId, connected.accountId);
    const e2 = await enroll(invited.org, s2.sequenceId, invited.org.owner.userId, invited.accountId);
    const x1 = await schedule(connected.org, e1.enrollmentId, s1.steps[0]);
    const x2 = await schedule(invited.org, e2.enrollmentId, s2.steps[0]);

    await runCycle();

    expect(await sentInvites(connected.accountId), 'aucune invitation au candidat déjà relié').toEqual([]);
    const r1 = await execById(x1);
    expect(r1.status).toBe('skipped');
    expect(r1.skip_reason).toBe('Déjà en relation : invitation inutile');
    const en1 = await enrollmentFull(e1.enrollmentId);
    expect(en1.connection_status).toBe('connected');
    expect(en1.status).toBe('active');
    expect(onStep(await execs(e1.enrollmentId), s1.steps[1]), 'suite planifiée').toHaveLength(1);

    const r2 = await execById(x2);
    expect(r2.status).toBe('skipped');
    expect(r2.skip_reason).toBe('Invitation déjà en attente');
    const en2 = await enrollmentFull(e2.enrollmentId);
    expect(en2.connection_status).toBe('pending_invite');
    expect(en2.status).toBe('active');
    expect(en2.pause_reason).toBeNull();
    expect(onStep(await execs(e2.enrollmentId), s2.steps[1])).toHaveLength(1);
  });
});

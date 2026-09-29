/**
 * Lot « late-reply » du module séquences : réponse du candidat reçue APRÈS la
 * fin de sa séquence (inscription 'completed'). Toute inscription dont le
 * dernier message part passe 'completed' aussitôt (scheduleNextStep), donc
 * chaque réponse à la dernière relance arrive sur une inscription terminée.
 *
 * Contrat : CLAUDE.md, section « Séquences : règles du moteur et de
 * l'interface », et docs/audit-2026-09-25-sequences.md : D3 (collaborateur),
 * SEQ-006 (jamais d'écriture dans une autre organisation), SEQ-027
 * (« terminée » ne redevient jamais active), SEQ-191 (réponse comptée une
 * fois), SEQ-212 (une réponse arrête toutes les séquences du candidat dans
 * l'organisation), SEQ-220 (la relance garde la date de réponse).
 *
 * Décision produit 8 (tranchée) : le webhook passe l'inscription 'completed'
 * en 'replied', compte la réponse et met le pipeline à jour, comme « Marquer
 * comme ayant répondu » (tests dédiés : e2e/api/seq-decisions-reply.spec.ts).
 *
 * Harnais : moteur et webhook servis par la stack locale (e2e/local-stack),
 * LinkedIn et l'IA simulés par vendor-mock.mjs. `force: true` lève la fenêtre
 * d'envoi (jours ouvrés 8 h-19 h). Jamais de mode du faux prestataire sur la
 * clé '*'. Chaque test dans son propre groupe « serial » : un défaut attendu
 * (test laissé en échec) n'empêche pas les suivants de tourner.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedCandidateRowFromLegacy,
  seedLinkedInAccount,
  seedSequence,
  signIn,
  type SeededStep,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  callFunction,
  engineAvailable,
  enroll,
  messageSequence,
  minutesFromNow,
  mockCalls,
  postJson,
  rand,
  runCycle,
  schedule,
  sendingOrg,
  sentInvites,
  sentTexts,
  webhook,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(240_000);

function isolated(key: string, title: string, body: () => Promise<void>) {
  test.describe(key, () => {
    test.describe.configure({ mode: 'serial' });
    test(title, body);
  });
}

// ─── Constantes du code (textes exacts) ─────────────────────────────────────
const DAY = 24 * 60;
const SIBLING_REPLY_SKIP_REASON = "Le candidat a répondu sur un autre compte de l'organisation";
const COLLABORATOR_ACTION_MESSAGE = 'Vous ne pouvez agir que sur les candidats que vous avez inscrits.';

// ─── Ménage ─────────────────────────────────────────────────────────────────
const tracked: Array<{ org: TestOrg; extra: TestUser[] }> = [];
function track(org: TestOrg, ...extra: TestUser[]) {
  tracked.push({ org, extra });
  return org;
}
function trackUser(org: TestOrg, user: TestUser) {
  tracked.find((t) => t.org.orgId === org.orgId)?.extra.push(user);
  return user;
}
test.afterEach(async () => {
  while (tracked.length) {
    const { org, extra } = tracked.pop()!;
    // Tables sans suppression en cascade depuis deleteOrg (l'organisation survit).
    for (const table of ['job_candidate_status', 'notifications', 'organization_integrations']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});

// ─── Lectures ───────────────────────────────────────────────────────────────
type Enr = {
  id: string; status: string; pause_reason: string | null; replied_at: string | null; completed_at: string | null;
  current_step_order: number; tracking_data: Record<string, unknown> | null;
};
async function enr(id: string): Promise<Enr> {
  const { data, error } = await admin().from('sequence_enrollments')
    .select('id, status, pause_reason, replied_at, completed_at, current_step_order, tracking_data')
    .eq('id', id).single();
  if (error || !data) throw new Error(`enr ${id}: ${error?.message}`);
  return data as Enr;
}
type Exec = { id: string; step_order: number; status: string; scheduled_at: string; executed_at: string | null; skip_reason: string | null };
async function execsOf(enrollmentId: string): Promise<Exec[]> {
  const { data, error } = await admin().from('sequence_step_executions')
    .select('id, step_order, status, scheduled_at, executed_at, skip_reason')
    .eq('enrollment_id', enrollmentId).order('step_order').order('created_at');
  if (error) throw new Error(`execs ${enrollmentId}: ${error.message}`);
  return (data ?? []) as Exec[];
}
async function exec(id: string): Promise<Exec> {
  const { data, error } = await admin().from('sequence_step_executions')
    .select('id, step_order, status, scheduled_at, executed_at, skip_reason').eq('id', id).single();
  if (error || !data) throw new Error(`exec ${id}: ${error?.message}`);
  return data as Exec;
}
/** Réponses comptées sur la séquence, toutes dates confondues (0 sans ligne). */
async function repliesOf(sequenceId: string): Promise<number> {
  const { data } = await admin().from('sequence_analytics').select('replies_received').eq('sequence_id', sequenceId);
  return ((data ?? []) as Array<{ replies_received: number | null }>).reduce((s, r) => s + (r.replies_received ?? 0), 0);
}
async function analyticsRows(sequenceId: string) {
  const { data } = await admin().from('sequence_analytics').select('*').eq('sequence_id', sequenceId).order('date');
  return data ?? [];
}
type Notif = { id: string; user_id: string; type: string; read_at: string | null; metadata: Record<string, unknown> | null };
async function notificationsOf(orgId: string): Promise<Notif[]> {
  const { data } = await admin().from('notifications')
    .select('id, user_id, type, read_at, metadata').eq('organization_id', orgId).eq('type', 'new_message');
  return (data ?? []) as Notif[];
}
async function jcsRow(id: string) {
  const { data } = await admin().from('job_candidate_status')
    .select('status, pipeline_stage, recommendation, updated_at').eq('id', id).single();
  return data as { status: string; pipeline_stage: string | null; recommendation: string | null; updated_at: string };
}
const ts = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/**
 * Attend que l'analyse IA lancée en tâche de fond par le webhook
 * (auto-analyze-message) ait lu la conversation, puis laisse finir ses
 * écritures éventuelles : les assertions « rien n'a changé » portent aussi sur
 * ce chemin.
 */
async function waitForAutoAnalyze(chatId: string) {
  await expect.poll(async () => (await mockCalls())
    .filter((c) => c.method === 'GET' && c.path.includes(`/chats/${chatId}/messages`)).length, {
    timeout: 30_000, message: 'auto-analyze-message a lu la conversation',
  }).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 2_000));
}

// ─── Appels ─────────────────────────────────────────────────────────────────
async function tokenOf(user: TestUser) {
  return (await signIn(user.email, user.password)).access_token;
}
function engine(token: string, body: Record<string, unknown>) {
  return callFunction('process-sequences', token, body);
}
/** Message du candidat, format à plat (message_received) ; att_self = le compte lui-même pour le faux prestataire. */
function replyFrom(accountId: string, profileId: string, o: { chatId?: string; messageId?: string; attendeeId?: string } = {}) {
  return {
    event: 'message_received',
    account_id: accountId,
    account_type: 'LINKEDIN',
    chat_id: o.chatId ?? `chat_${rand()}${rand()}`,
    message_id: o.messageId ?? `msg_${rand()}${rand()}`,
    message: 'Bonjour, désolé pour le délai, je suis intéressé',
    sender: { attendee_provider_id: profileId, attendee_id: o.attendeeId ?? 'att_candidate', attendee_name: 'Camille Martin' },
  };
}
/** Requête SQL en superutilisateur (état hérité impossible à créer par l'API). */
function superSql(sql: string) {
  execFileSync('psql', [
    '-h', '127.0.0.1', '-p', '54322', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql,
  ], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? 'postgres' }, stdio: 'pipe' });
}

// ─── Seeds ──────────────────────────────────────────────────────────────────
interface Scene {
  org: TestOrg;
  accountId: string;
  sequenceId: string;
  steps: SeededStep[];
  enrollmentId: string;
  profileId: string;
  completedAt: string;
}

/**
 * Inscription terminée : séquence de messages entièrement partie (ou fin
 * anticipée avec `sentSteps`), dernier message il y a un jour, fin posée à la
 * même date. Les exécutions 'sent' ne sont jamais reprises par un cycle.
 */
async function completedScene(prefix: string, o: {
  templates?: string[]; sentSteps?: number; delayDays?: number; org?: { org: TestOrg; accountId: string };
  createdBy?: string; profileId?: string;
} = {}): Promise<Scene> {
  const templates = o.templates ?? ['Bonjour', 'Relance'];
  const base = o.org ?? await sendingOrg(prefix);
  if (!o.org) track(base.org);
  const { org, accountId } = base;
  const createdBy = o.createdBy ?? org.owner.userId;
  const { sequenceId, steps } = await messageSequence(org, createdBy, templates, o.delayDays ?? 3);
  const sentSteps = o.sentSteps ?? templates.length;
  const completedAt = minutesFromNow(-DAY);
  const { enrollmentId, profileId } = await enroll(org, sequenceId, createdBy, accountId, {
    status: 'completed',
    completed_at: completedAt,
    current_step_order: sentSteps,
    created_at: minutesFromNow(-6 * DAY),
    ...(o.profileId ? { profile_id: o.profileId } : {}),
  });
  for (let i = 0; i < sentSteps; i++) {
    const at = minutesFromNow(-DAY * (1 + 2 * (sentSteps - 1 - i)));
    await schedule(org, enrollmentId, steps[i], { status: 'sent', scheduled_at: at, executed_at: at, final_message: templates[i] });
  }
  return { org, accountId, sequenceId, steps, enrollmentId, profileId, completedAt };
}

// Refonte mission, lot 0b : ligne rattachée à une mission (nouvelle par appel), étape
// dérivée de l'ancien couple et posée par set_candidate_stage.
async function jcs(orgId: string, createdBy: string, candidateId: string, o: Record<string, unknown> = {}) {
  const { status = 'contacted', pipeline_stage = 'Contacté', ...extra } = o as { status?: string; pipeline_stage?: string | null };
  const { id } = await seedCandidateRowFromLegacy({
    orgId, createdBy, candidateId, status, pipelineStage: pipeline_stage, extra: { candidate_name: 'Camille Martin', ...extra },
  });
  return id;
}

async function memberWithAccount(org: TestOrg, role: 'member' | 'admin' | 'collaborator' = 'member') {
  const user = trackUser(org, await addMember(org.orgId, role, 'late'));
  const accountId = await seedLinkedInAccount(org.orgId, user.userId, `acc_late_${rand()}`, 'OK');
  return { user, accountId };
}

// ════════════════════════════════════════════════════════════════════════════
// Réponse tardive reçue par le webhook LinkedIn
// ════════════════════════════════════════════════════════════════════════════

// completed-reply-no-send-no-restart (SEQ-027)
isolated('completed-reply-no-send-no-restart',
  'réponse tardive sur une inscription terminée : aucune exécution créée ni modifiée, le cycle suivant n’envoie rien, l’inscription ne redevient jamais active',
  async () => {
    const s = await completedScene('E2E late aucun envoi');
    const before = await execsOf(s.enrollmentId);
    expect(before.map((e) => e.status)).toEqual(['sent', 'sent']);

    const chatId = `chat_${rand()}${rand()}`;
    await webhook(replyFrom(s.accountId, s.profileId, { chatId }));

    expect(await execsOf(s.enrollmentId), 'exécutions identiques, aucune nouvelle ligne').toEqual(before);
    const row = await enr(s.enrollmentId);
    // Décision 8 : l'inscription terminée passe « A répondu ».
    expect(row.status, `statut après la réponse : ${row.status}`).toBe('replied');
    expect(row.pause_reason).toBeNull();
    expect(ts(row.completed_at), 'date de fin conservée').toBe(ts(s.completedAt));

    await runCycle();
    await waitForAutoAnalyze(chatId);
    expect(await sentTexts(s.accountId), 'aucun message envoyé après la réponse').toEqual([]);
    expect(await sentInvites(s.accountId), 'aucune invitation envoyée').toEqual([]);
    expect(await execsOf(s.enrollmentId), 'toujours aucune exécution nouvelle après le cycle').toEqual(before);
    const after = await enr(s.enrollmentId);
    expect(after.status, 'jamais réactivée').not.toBe('active');
    // Décision 8 : « A répondu » après le cycle aussi.
    expect(after.status).toBe('replied');
  });

// completed-reply-counted-once (SEQ-191) : exactement une fois (décision 8).
isolated('completed-reply-counted-once',
  'réponse tardive puis second message du même candidat : la réponse n’est jamais comptée plus d’une fois sur la séquence',
  async () => {
    const s = await completedScene('E2E late comptage');
    const initial = await repliesOf(s.sequenceId);
    expect(initial).toBe(0);
    const chatId = `chat_${rand()}${rand()}`;

    await webhook(replyFrom(s.accountId, s.profileId, { chatId }));
    const afterFirst = await repliesOf(s.sequenceId);
    // Décision 8 : la réponse tardive est comptée.
    expect(afterFirst - initial, 'premier message : +1').toBe(1);

    await webhook(replyFrom(s.accountId, s.profileId, { chatId }));
    expect(await repliesOf(s.sequenceId), 'second message du même candidat : aucun recomptage').toBe(afterFirst);
    await waitForAutoAnalyze(chatId);
    expect(await repliesOf(s.sequenceId)).toBe(afterFirst);
  });

// completed-reply-other-org-untouched (SEQ-006)
isolated('completed-reply-other-org-untouched',
  'réponse tardive reçue par l’organisation A : inscriptions, pipeline et statistiques de l’organisation B qui suit le même candidat restent intacts',
  async () => {
    const a = await completedScene('E2E late org A');
    // Organisation B : même candidat, sur son propre compte, une inscription
    // terminée, une active (relance dans 24 h) et deux lignes de pipeline.
    const b = await completedScene('E2E late org B', { profileId: a.profileId });
    const bActiveSeq = await messageSequence(b.org, b.org.owner.userId, ['Bonjour B', 'Relance B']);
    const bActive = await enroll(b.org, bActiveSeq.sequenceId, b.org.owner.userId, b.accountId, {
      profile_id: a.profileId, current_step_order: 1,
    });
    const bFollowUp = await schedule(b.org, bActive.enrollmentId, bActiveSeq.steps[1], { scheduled_at: minutesFromNow(DAY) });
    const bJcsContacted = await jcs(b.org.orgId, b.org.owner.userId, a.profileId);
    const bJcsMessaged = await jcs(b.org.orgId, b.org.owner.userId, a.profileId, { status: 'messaged', pipeline_stage: null });
    const bJcsBefore = [await jcsRow(bJcsContacted), await jcsRow(bJcsMessaged)];
    const bCompletedBefore = await enr(b.enrollmentId);
    const bActiveBefore = await enr(bActive.enrollmentId);
    const bFollowUpBefore = await exec(bFollowUp);
    const bAnalyticsBefore = [await analyticsRows(b.sequenceId), await analyticsRows(bActiveSeq.sequenceId)];

    const chatId = `chat_${rand()}${rand()}`;
    await webhook(replyFrom(a.accountId, a.profileId, { chatId }));
    await waitForAutoAnalyze(chatId);

    expect(await enr(b.enrollmentId), 'inscription terminée de B intacte').toEqual(bCompletedBefore);
    expect(await enr(bActive.enrollmentId), 'inscription active de B intacte').toEqual(bActiveBefore);
    expect(await exec(bFollowUp), 'relance de B toujours programmée à la même date').toEqual(bFollowUpBefore);
    expect([await jcsRow(bJcsContacted), await jcsRow(bJcsMessaged)], 'pipeline de B intact').toEqual(bJcsBefore);
    expect([await analyticsRows(b.sequenceId), await analyticsRows(bActiveSeq.sequenceId)], 'statistiques de B intactes')
      .toEqual(bAnalyticsBefore);
    expect(await notificationsOf(b.org.orgId), 'aucune notification dans B').toEqual([]);
  });

// completed-reply-siblings-before-end (SEQ-212, contrat §8 de mark_replied)
isolated('completed-reply-siblings-before-end',
  'réponse tardive : l’inscription sœur commencée avant la fin est arrêtée et ne relance pas le candidat ; celle commencée après la fin reste intacte',
  async () => {
    const { org, accountId: accountA } = await sendingOrg('E2E late sœurs');
    track(org);
    const s = await completedScene('', { org: { org, accountId: accountA } });
    const member = await memberWithAccount(org);
    const colleague = await memberWithAccount(org);

    // S1 : inscription du même candidat sur le compte B, commencée avant la
    // fin de celle de A (il y a deux jours), premier message dans 24 h.
    const seqB = await messageSequence(org, member.user.userId, ['Bonjour de B', 'Relance de B']);
    const s1 = await enroll(org, seqB.sequenceId, member.user.userId, member.accountId, {
      profile_id: s.profileId, created_at: minutesFromNow(-2 * DAY),
    });
    const s1Exec = await schedule(org, s1.enrollmentId, seqB.steps[0], { scheduled_at: minutesFromNow(DAY) });
    // S2 : prise de contact démarrée aujourd'hui par un collègue, après la fin.
    const seqC = await messageSequence(org, colleague.user.userId, ['Bonjour de C', 'Relance de C']);
    const s2 = await enroll(org, seqC.sequenceId, colleague.user.userId, colleague.accountId, { profile_id: s.profileId });
    const s2Exec = await schedule(org, s2.enrollmentId, seqC.steps[0], { scheduled_at: minutesFromNow(DAY) });
    const s2ExecBefore = await exec(s2Exec);

    const chatId = `chat_${rand()}${rand()}`;
    await webhook(replyFrom(accountA, s.profileId, { chatId }));

    // Commencée après la fin : jamais touchée.
    expect.soft((await enr(s2.enrollmentId)).status, 'S2 (après la fin) reste active').toBe('active');
    expect.soft(await exec(s2Exec), 'étape de S2 intacte').toEqual(s2ExecBefore);

    // DÉFAUT late-reply-siblings-not-stopped : le webhook ne cherche que des inscriptions ouvertes sur le compte qui reçoit ; terminée, rien n'est trouvé et closeSiblingEnrollments n'est jamais appelé.
    expect.soft((await enr(s1.enrollmentId)).status, 'S1 (avant la fin) arrêtée').toBe('stopped');
    const s1After = await exec(s1Exec);
    expect.soft(s1After.status, 'étape de S1 annulée').toBe('cancelled');
    expect.soft(s1After.skip_reason).toBe(SIBLING_REPLY_SKIP_REASON);

    // Conséquence observable : l'étape de S1 arrivée à échéance ne part pas.
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', s1Exec);
    await runCycle();
    // DÉFAUT late-reply-siblings-not-stopped : le message de S1 part depuis le compte B après la réponse du candidat.
    expect(await sentTexts(member.accountId), 'aucune relance du candidat qui a répondu, quel que soit le compte').toEqual([]);
    expect(await sentTexts(colleague.accountId), 'S2 n’a rien envoyé (étape prévue demain)').toEqual([]);
  });

// completed-own-message-ignored
isolated('completed-own-message-ignored',
  'message du recruteur envoyé depuis LinkedIn après la fin (is_sender vrai ou participant « soi ») : rien n’est compté ni notifié, les notifications de la conversation passent en lues',
  async () => {
    const s = await completedScene('E2E late message du recruteur');
    const [chatA, chatB] = [`chat_${rand()}${rand()}`, `chat_${rand()}${rand()}`];
    const { data: seeded, error } = await admin().from('notifications').insert([
      { user_id: s.org.owner.userId, organization_id: s.org.orgId, type: 'new_message', title: 'Nouveau message de Camille Martin', metadata: { chat_id: chatA } },
      { user_id: s.org.owner.userId, organization_id: s.org.orgId, type: 'new_message', title: 'Nouveau message de Camille Martin', metadata: { chat_id: chatB } },
    ]).select('id');
    if (error || !seeded) throw new Error(`notifications: ${error?.message}`);

    // (a) format new_message imbriqué, is_sender vrai.
    await webhook({
      event: 'new_message', account_id: s.accountId,
      data: { message: { id: `m_${rand()}${rand()}`, is_sender: true, chat_id: chatA, sender: { provider_id: s.profileId } } },
    });
    // (b) format message_received, expéditeur = participant « soi » (att_self).
    await webhook(replyFrom(s.accountId, s.profileId, { chatId: chatB, attendeeId: 'att_self' }));

    const row = await enr(s.enrollmentId);
    expect(row.status, 'inscription toujours terminée').toBe('completed');
    expect(row.replied_at).toBeNull();
    expect(ts(row.completed_at)).toBe(ts(s.completedAt));
    expect(await repliesOf(s.sequenceId), 'aucune réponse comptée').toBe(0);
    const notifs = await notificationsOf(s.org.orgId);
    expect(notifs.map((n) => n.id).sort(), 'aucune nouvelle notification').toEqual(seeded.map((n) => n.id).sort());
    for (const n of notifs) expect(n.read_at, `notification de ${String(n.metadata?.chat_id)} lue`).not.toBeNull();
    expect(await sentTexts(s.accountId)).toEqual([]);
  });

// completed-own-invite-note-ignored
isolated('completed-own-invite-note-ignored',
  'séquence terminée sur une invitation avec note : le message_received de notre propre note (participant « soi », ou « soi » introuvable) est ignoré, 200, rien n’est écrit',
  async () => {
    const NOTE = 'Bonjour, ravi d’échanger sur votre parcours.';
    /** Séquence d'une seule invitation avec note, partie il y a trois jours, inscription terminée. */
    const inviteScene = async (prefix: string, dsn?: string) => {
      const { org, accountId } = await sendingOrg(prefix);
      track(org);
      if (dsn) {
        // Identifiants propres posés AVANT tout webhook : la résolution des
        // identifiants garde en cache l'absence de configuration d'une organisation.
        const { error } = await admin().from('organization_integrations').upsert({
          organization_id: org.orgId, unipile_connected: true, unipile_api_key: 'mock-key', unipile_dsn: dsn,
        }, { onConflict: 'organization_id' });
        if (error) throw new Error(`organization_integrations: ${error.message}`);
      }
      const { sequenceId, steps } = await seedSequence(org.orgId, org.owner.userId, [{ action_type: 'connection_request' }]);
      await admin().from('sequence_steps').update({ message_template: NOTE }).eq('id', steps[0].id);
      const completedAt = minutesFromNow(-DAY);
      const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, {
        status: 'completed', completed_at: completedAt, current_step_order: 1, connection_status: 'connected',
        created_at: minutesFromNow(-4 * DAY),
      });
      const sentAt = minutesFromNow(-3 * DAY);
      await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: sentAt, executed_at: sentAt, final_message: NOTE });
      const pipeline = await jcs(org.orgId, org.owner.userId, profileId);
      const before = { pipeline: await jcsRow(pipeline), execs: await execsOf(enrollmentId) };
      const check = async (label: string) => {
        const row = await enr(enrollmentId);
        expect(row.status, `${label} : inscription toujours terminée`).toBe('completed');
        expect(row.replied_at, label).toBeNull();
        expect(ts(row.completed_at), label).toBe(ts(completedAt));
        expect(await repliesOf(sequenceId), `${label} : aucune réponse comptée`).toBe(0);
        expect(await notificationsOf(org.orgId), `${label} : aucune notification`).toEqual([]);
        expect(await jcsRow(pipeline), `${label} : pipeline intact`).toEqual(before.pipeline);
        expect(await execsOf(enrollmentId), `${label} : exécutions intactes`).toEqual(before.execs);
      };
      return { accountId, profileId, check };
    };
    const secret = { 'unipile-auth': process.env.E2E_UNIPILE_WEBHOOK_SECRET ?? '' };

    // (a) La note arrive avec l'expéditeur = notre participant (att_self).
    const a = await inviteScene('E2E late note soi');
    const own = await postJson('/functions/v1/unipile-webhook', replyFrom(a.accountId, a.profileId, { attendeeId: 'att_self' }), secret);
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    await a.check('participant « soi »');

    // (b) Participants sans « soi » identifiable : l'appel des participants,
    // sur les identifiants propres de l'organisation, tombe sur la réponse
    // générique du faux prestataire (items vides). Échec fermé : 200, rien d'écrit.
    const b = await inviteScene('E2E late note sans soi', `unipile.mock/e2e-late-${rand()}`);
    const chatId = `chat_${rand()}${rand()}`;
    const unknown = await postJson('/functions/v1/unipile-webhook', replyFrom(b.accountId, b.profileId, { chatId }), secret);
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(200);
    const attendeeCalls = (await mockCalls()).filter((c) => c.method === 'GET' && c.path.includes(`/chats/${chatId}/attendees`));
    expect(attendeeCalls.map((c) => c.path), 'participants demandés sur les identifiants de l’organisation')
      .toEqual([expect.stringMatching(/^\/e2e-late-[a-z0-9]+\/api\/v1\/chats\//)]);
    await b.check('« soi » introuvable');
  });

// completed-reply-notification-per-org (SEQ-006)
isolated('completed-reply-notification-per-org',
  'compte LinkedIn rattaché à deux organisations (état hérité) : seule celle de l’inscription terminée reçoit le contexte candidat, l’autre une notification neutre, ses données intactes',
  async () => {
    const a = await completedScene('E2E late notif A');
    const b = await sendingOrg('E2E late notif B');
    track(b.org);
    const bMember = trackUser(b.org, await addMember(b.org.orgId, 'member', 'late-notif'));
    // Rattachement du même compte à un membre de B : interdit depuis le
    // déclencheur prevent_linkedin_account_cross_tenant, d'où l'écriture en
    // superutilisateur (lignes antérieures au déclencheur, que le webhook
    // traite encore : « même compte LinkedIn rattaché à plusieurs orgs »).
    superSql(`SET session_replication_role = replica;
      INSERT INTO public.member_linkedin_accounts (organization_id, user_id, linked_by, linkedin_account_id, account_status)
      VALUES ('${b.org.orgId}', '${bMember.userId}', '${bMember.userId}', '${a.accountId}', 'OK');`);
    // Données de B pour le même candidat : inscription active sur son autre compte, pipeline.
    const bSeq = await messageSequence(b.org, b.org.owner.userId, ['Bonjour B', 'Relance B']);
    const bEnr = await enroll(b.org, bSeq.sequenceId, b.org.owner.userId, b.accountId, { profile_id: a.profileId, current_step_order: 1 });
    const bExec = await schedule(b.org, bEnr.enrollmentId, bSeq.steps[1], { scheduled_at: minutesFromNow(DAY) });
    const bJcs = await jcs(b.org.orgId, b.org.owner.userId, a.profileId);
    const bBefore = { enr: await enr(bEnr.enrollmentId), exec: await exec(bExec), jcs: await jcsRow(bJcs) };

    const chatId = `chat_${rand()}${rand()}`;
    await webhook(replyFrom(a.accountId, a.profileId, { chatId }));
    await waitForAutoAnalyze(chatId);

    const notifA = await notificationsOf(a.org.orgId);
    expect(notifA, 'une notification pour A').toHaveLength(1);
    expect(notifA[0].user_id).toBe(a.org.owner.userId);
    expect(notifA[0].metadata).toMatchObject({
      chat_id: chatId, is_candidate: true, enrollment_id: a.enrollmentId, sequence_id: a.sequenceId, profile_name: 'Camille Martin',
    });

    const notifB = await notificationsOf(b.org.orgId);
    expect(notifB, 'une notification pour B').toHaveLength(1);
    expect(notifB[0].user_id, 'membre de B rattaché au compte').toBe(bMember.userId);
    expect(notifB[0].metadata?.chat_id).toBe(chatId);
    expect(notifB[0].metadata?.is_candidate, 'B : pas de contexte candidat').toBe(false);
    for (const key of ['enrollment_id', 'enrollment_ids', 'sequence_id', 'profile_name', 'profile_headline', 'project_id']) {
      expect(notifB[0].metadata ?? {}, `B : pas de ${key}`).not.toHaveProperty(key);
    }

    expect({ enr: await enr(bEnr.enrollmentId), exec: await exec(bExec), jcs: await jcsRow(bJcs) }, 'données de B intactes').toEqual(bBefore);
  });

// ════════════════════════════════════════════════════════════════════════════
// « Marquer comme ayant répondu » et « Relancer » sur une inscription terminée
// ════════════════════════════════════════════════════════════════════════════

// completed-mark-replied-roles (D3, SEQ-119)
isolated('completed-mark-replied-roles',
  'inscription terminée : mark_replied réussit pour owner, admin et member ; collaborateur 403 sauf sur la sienne ; autre organisation 404 ; anonyme 401 ; identifiant non UUID 404',
  async () => {
    const s = await completedScene('E2E late rôles');
    const adminUser = trackUser(s.org, await addMember(s.org.orgId, 'admin', 'late-admin'));
    const memberUser = trackUser(s.org, await addMember(s.org.orgId, 'member', 'late-member'));
    const collab = await memberWithAccount(s.org, 'collaborator');
    const reset = async () => {
      const { error } = await admin().from('sequence_enrollments')
        .update({ status: 'completed', replied_at: null, completed_at: s.completedAt }).eq('id', s.enrollmentId);
      if (error) throw new Error(`reset: ${error.message}`);
    };

    for (const [label, user] of [['owner', s.org.owner], ['admin', adminUser], ['member', memberUser]] as const) {
      await reset();
      const t0 = Date.now();
      const res = await engine(await tokenOf(user), { action: 'mark_replied', enrollment_id: s.enrollmentId });
      expect(res.status, `${label} : ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toMatchObject({ success: true, changed: true });
      const row = await enr(s.enrollmentId);
      expect(row.status, `${label} : « A répondu »`).toBe('replied');
      expect(ts(row.replied_at), `${label} : date de réponse posée`).toBeGreaterThanOrEqual(t0 - 5_000);
      expect(ts(row.completed_at), `${label} : date de fin conservée`).toBe(ts(s.completedAt));
      expect(row.pause_reason).toBeNull();
    }

    // Collaborateur sur l'inscription du propriétaire : refusé, rien ne change.
    await reset();
    const collabToken = await tokenOf(collab.user);
    const refused = await engine(collabToken, { action: 'mark_replied', enrollment_id: s.enrollmentId });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(refused.body).toMatchObject({ success: false, error: 'forbidden', message: COLLABORATOR_ACTION_MESSAGE });
    expect((await enr(s.enrollmentId)).status).toBe('completed');

    // Collaborateur sur sa propre inscription terminée : accepté.
    const own = await enroll(s.org, s.sequenceId, collab.user.userId, collab.accountId, {
      status: 'completed', completed_at: minutesFromNow(-DAY), current_step_order: 2,
    });
    const ownRes = await engine(collabToken, { action: 'mark_replied', enrollment_id: own.enrollmentId });
    expect(ownRes.status, JSON.stringify(ownRes.body)).toBe(200);
    expect((await enr(own.enrollmentId)).status).toBe('replied');

    // Membre d'une autre organisation : introuvable (organisation active), refusé (organisation visée).
    const other = track(await createOrg('agency', 'E2E late autre org'));
    const otherToken = await tokenOf(other.owner);
    const notFound = await engine(otherToken, { action: 'mark_replied', enrollment_id: s.enrollmentId });
    expect(notFound.status, JSON.stringify(notFound.body)).toBe(404);
    expect(notFound.body.error).toBe('not_found');
    const forbidden = await engine(otherToken, { action: 'mark_replied', enrollment_id: s.enrollmentId, organization_id: s.org.orgId });
    expect(forbidden.status, JSON.stringify(forbidden.body)).toBe(403);
    expect((await enr(s.enrollmentId)).status, 'autre organisation : rien ne change').toBe('completed');

    // Sans JWT (aucun en-tête, ou clé anonyme) : 401.
    const anonymous = await postJson('/functions/v1/process-sequences', { action: 'mark_replied', enrollment_id: s.enrollmentId });
    expect(anonymous.status).toBe(401);
    const anonKey = await postJson('/functions/v1/process-sequences', { action: 'mark_replied', enrollment_id: s.enrollmentId },
      { Authorization: `Bearer ${E2E.anonKey}` });
    expect(anonKey.status).toBe(401);
    expect((await enr(s.enrollmentId)).status, 'anonyme : rien ne change').toBe('completed');

    // Identifiant mal formé : 404, pas d'erreur serveur.
    const malformed = await engine(await tokenOf(s.org.owner), { action: 'mark_replied', enrollment_id: 'pas-un-uuid' });
    expect(malformed.status, JSON.stringify(malformed.body)).toBe(404);
    expect(malformed.body.error).toBe('not_found');
  });

// completed-reply-re-enroll-tracking (SEQ-004, SEQ-220). La réponse tardive est
// enregistrée par « Marquer comme ayant répondu » (le webhook le fait aussi
// depuis la décision 8).
isolated('completed-reply-re-enroll-tracking',
  'réponse tardive enregistrée puis « Relancer depuis l’étape suivante » : date de réponse gardée dans previous_replied_at, re_enrolled_at posé, étape suivante programmée selon son délai',
  async () => {
    // Trois messages, fin anticipée après le deuxième (current_step_order 2).
    const s = await completedScene('E2E late relance', { templates: ['Bonjour', 'Relance', 'Dernière relance'], sentSteps: 2 });
    const token = await tokenOf(s.org.owner);

    const marked = await engine(token, { action: 'mark_replied', enrollment_id: s.enrollmentId });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    const replied = await enr(s.enrollmentId);
    expect(replied.status).toBe('replied');
    expect(replied.replied_at).not.toBeNull();

    const t0 = Date.now();
    const res = await engine(token, { action: 're_enroll', enrollment_ids: [s.enrollmentId] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const results = res.body.results as Array<{ enrollment_id: string; outcome: string; message?: string }>;
    expect(results, JSON.stringify(res.body)).toEqual([expect.objectContaining({ enrollment_id: s.enrollmentId, outcome: 'resumed' })]);

    const row = await enr(s.enrollmentId);
    expect(row.status, 'inscription relancée').toBe('active');
    expect(row.replied_at, 'réponse courante effacée').toBeNull();
    expect(row.completed_at).toBeNull();
    expect(ts(row.tracking_data?.previous_replied_at as string), 'date de la réponse gardée').toBe(ts(replied.replied_at));
    expect(ts(row.tracking_data?.re_enrolled_at as string), 'date de relance posée').toBeGreaterThanOrEqual(t0 - 5_000);

    const pending = (await execsOf(s.enrollmentId)).filter((e) => ['scheduled', 'waiting_event', 'quota_blocked'].includes(e.status));
    expect(pending, 'une seule étape en attente : la troisième').toHaveLength(1);
    expect(pending[0].step_order).toBe(2);
    expect(ts(pending[0].scheduled_at), 'selon son délai (3 jours), pas tout de suite').toBeGreaterThan(Date.now() + 2 * DAY * 60_000);
    expect(await sentTexts(s.accountId)).toEqual([]);
  });

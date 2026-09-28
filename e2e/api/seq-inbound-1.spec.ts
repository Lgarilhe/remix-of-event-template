/**
 * Lot « inbound-1 » du module séquences : événements entrants. Réponse et
 * acceptation LinkedIn (unipile-webhook), reconnexion du compte, rendez-vous
 * Calendly (D4), souscription Stripe (D1), effacement RGPD (D5).
 *
 * Contrat : CLAUDE.md, section « Séquences : règles du moteur et de
 * l'interface », et docs/audit-2026-09-25-sequences.md (D1 à D6, registre).
 *
 * Les webhooks et le moteur tournent pour de vrai contre la stack locale
 * (e2e/local-stack) ; LinkedIn, Stripe et l'IA sont simulés par
 * vendor-mock.mjs, qui journalise chaque appel. Ignoré sans cette stack.
 *
 * Réponses scriptées : l'appel « participants de la conversation » du webhook
 * ne porte pas d'account_id, donc aucune route par compte ne s'y applique.
 * Les tests qui doivent le faire échouer donnent à LEUR organisation des
 * identifiants LinkedIn propres (organization_integrations.unipile_dsn) dont
 * la requête porte leur account_id : la route reste sur leur compte, jamais
 * sur la clé '*'.
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedLinkedInAccount,
  seedSequence,
  signIn,
  type SeededStep,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  WEBHOOK_SECRET,
  callFunction,
  engineAvailable,
  enroll,
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
  sentTexts,
  setMockMode,
  webhook,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

// ─── Textes du contrat ──────────────────────────────────────────────────────
const SIBLING_REPLY_SKIP_REASON = "Le candidat a répondu sur un autre compte de l'organisation";
const GDPR_MESSAGE = "Ce candidat a demandé l'effacement de ses données : il ne peut plus être relancé.";
const GDPR_ERASURE_SKIP_REASON = 'Effacement des données demandé : séquence arrêtée';
const ACCOUNT_DISCONNECTED_SKIP_REASON = 'Compte LinkedIn déconnecté, reprise automatique à la reconnexion';
const SUBSCRIPTION_REQUIRED_REASON = "Abonnement requis pour l'envoi de séquences";
const CALENDLY_EVENT_NAME = '📅 20 min pour présentation poste - Equipe Konekt';
const STRIPE_SECRET = process.env.E2E_STRIPE_WEBHOOK_SECRET ?? '';
const CALENDLY_KEY = process.env.E2E_CALENDLY_SIGNING_KEY ?? '';
const DAY = 24 * 60;

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];
test.afterEach(async () => {
  while (cleanups.length) await Promise.resolve(cleanups.pop()!()).catch(() => undefined);
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    for (const table of ['job_candidate_status', 'notifications', 'inmail_queue', 'candidate_enrichments', 'qualification_sessions', 'organization_integrations']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});
function track(org: TestOrg, ...extra: TestUser[]) {
  orgsToDelete.push({ org, extra });
  return org;
}
async function trackedSendingOrg(prefix: string) {
  const res = await sendingOrg(prefix);
  track(res.org);
  return res;
}

// ─── Lectures ───────────────────────────────────────────────────────────────
type Enr = {
  id: string; status: string; pause_reason: string | null; connection_status: string | null;
  network_distance: string | null; last_check_at: string | null; replied_at: string | null;
  profile_name: string | null; email_used: string | null; tracking_data: Record<string, unknown> | null;
};
async function enr(id: string): Promise<Enr> {
  const { data, error } = await admin().from('sequence_enrollments')
    .select('id, status, pause_reason, connection_status, network_distance, last_check_at, replied_at, profile_name, email_used, tracking_data')
    .eq('id', id).single();
  if (error || !data) throw new Error(`enr ${id}: ${error?.message}`);
  return data as Enr;
}
type Exec = { id: string; status: string; scheduled_at: string; skip_reason: string | null; final_message: string | null };
async function exec(id: string): Promise<Exec> {
  const { data, error } = await admin().from('sequence_step_executions')
    .select('id, status, scheduled_at, skip_reason, final_message').eq('id', id).single();
  if (error || !data) throw new Error(`exec ${id}: ${error?.message}`);
  return data as Exec;
}
async function analytics(sequenceId: string) {
  const { data } = await admin().from('sequence_analytics')
    .select('replies_received, invites_accepted').eq('sequence_id', sequenceId);
  const rows = (data ?? []) as Array<{ replies_received: number | null; invites_accepted: number | null }>;
  return {
    replies: rows.reduce((s, r) => s + (r.replies_received ?? 0), 0),
    accepted: rows.reduce((s, r) => s + (r.invites_accepted ?? 0), 0),
  };
}
async function dedupRows(eventKey: string) {
  const { data } = await admin().from('webhook_event_log').select('event_key').eq('event_key', eventKey);
  return (data ?? []).length;
}
async function notificationsOf(orgId: string, type?: string) {
  let q = admin().from('notifications').select('id, user_id, type, read_at, metadata').eq('organization_id', orgId);
  if (type) q = q.eq('type', type);
  const { data } = await q;
  return (data ?? []) as Array<{ id: string; user_id: string; type: string; read_at: string | null; metadata: Record<string, unknown> | null }>;
}
const ts = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

// ─── Appels ─────────────────────────────────────────────────────────────────
async function ownerToken(org: TestOrg) {
  return (await signIn(org.owner.email, org.owner.password)).access_token;
}
function engine(token: string, body: Record<string, unknown>) {
  return callFunction('process-sequences', token, body);
}
/** Webhook LinkedIn sans assertion de statut (en-tête d'authentification au choix). */
function rawWebhook(payload: Record<string, unknown>, headers: Record<string, string> = { 'unipile-auth': WEBHOOK_SECRET }, query = '') {
  return postJson(`/functions/v1/unipile-webhook${query}`, payload, headers);
}
/** Message du candidat, format à plat (message_received). */
function replyFrom(accountId: string, profileId: string, o: { chatId?: string; messageId?: string; attendeeId?: string } = {}) {
  return {
    event: 'message_received',
    account_id: accountId,
    account_type: 'LINKEDIN',
    chat_id: o.chatId ?? `chat_${rand()}`,
    message_id: o.messageId ?? `msg_${rand()}`,
    message: 'Bonjour, oui avec plaisir',
    sender: { attendee_provider_id: profileId, attendee_id: o.attendeeId ?? 'att_candidate', attendee_name: 'Camille Martin' },
  };
}
function newRelation(accountId: string, profileId: string) {
  return {
    event: 'new_relation', account_id: accountId, account_type: 'LINKEDIN',
    user_provider_id: profileId, user_full_name: 'Camille Martin', user_public_identifier: `camille-${rand()}`,
  };
}
async function signedPost(fn: string, raw: string, headers: Record<string, string>) {
  const res = await fetch(`${E2E.supabaseUrl}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { apikey: E2E.anonKey, 'Content-Type': 'application/json', ...headers },
    body: raw,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
/** Événement Stripe signé comme le fait Stripe (t=…,v1=HMAC(t.payload)). */
function stripeEvent(event: Record<string, unknown>) {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', STRIPE_SECRET).update(`${t}.${raw}`).digest('hex');
  return signedPost('stripe-webhook', raw, { 'stripe-signature': `t=${t},v1=${sig}` });
}
/**
 * Paiement d'un abonnement au plan cabinet. L'abonnement relu chez Stripe est
 * la réponse par défaut du faux prestataire (sans prix reconnu) : le plan est
 * celui des métadonnées de la session, repli prévu au premier Checkout.
 */
function checkoutCompleted(orgId: string) {
  const s = rand();
  return stripeEvent({
    id: `evt_e2e_${s}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_e2e_${s}`, object: 'checkout.session', mode: 'subscription', payment_status: 'paid',
        subscription: `sub_e2e_${s}`, customer: `cus_e2e_${s}`, client_reference_id: orgId,
        metadata: { organization_id: orgId, plan_id: 'cabinet' },
      },
    },
  });
}
/** Rendez-vous Calendly signé (t=…,v1=HMAC(t.body)). */
function calendlyBooking(slug: string, eventId: string) {
  const body = {
    event: 'invitee.created',
    payload: {
      uri: `https://api.calendly.com/scheduled_events/${eventId}/invitees/inv_${rand()}`,
      email: `camille.${rand()}@e2e.konekt.test`,
      name: 'Camille Martin',
      questions_and_answers: [{ question: 'Votre profil LinkedIn', answer: `https://www.linkedin.com/in/${slug}` }],
      scheduled_event: {
        uri: `https://api.calendly.com/scheduled_events/${eventId}`,
        name: CALENDLY_EVENT_NAME,
        start_time: minutesFromNow(2 * DAY),
        end_time: minutesFromNow(2 * DAY + 20),
      },
    },
  };
  const raw = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', CALENDLY_KEY).update(`${t}.${raw}`).digest('hex');
  return signedPost('calendly-webhook', raw, { 'Calendly-Webhook-Signature': `t=${t},v1=${sig}` });
}
function rgpdErase(token: string, body: Record<string, unknown>) {
  // Adresse IP propre à l'appel : la limite de 30 demandes par heure et par IP
  // est partagée avec les autres suites.
  return postJson('/functions/v1/rgpd-erase-contact', body, {
    Authorization: `Bearer ${token}`,
    'x-forwarded-for': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  });
}

// ─── Seeds ──────────────────────────────────────────────────────────────────
async function setIntegration(orgId: string, patch: Record<string, unknown>) {
  const { error } = await admin().from('organization_integrations')
    .upsert({ organization_id: orgId, ...patch }, { onConflict: 'organization_id' });
  if (error) throw new Error(`organization_integrations: ${error.message}`);
}
/** Membre de l'organisation avec son propre compte LinkedIn relié. */
async function memberWithAccount(org: TestOrg, role: 'member' | 'admin' = 'member') {
  const user = await addMember(org.orgId, role, 'inbound');
  orgsToDelete.find((o) => o.org.orgId === org.orgId)?.extra.push(user);
  const accountId = await seedLinkedInAccount(org.orgId, user.userId, `acc_${rand()}`, 'OK');
  return { user, accountId };
}
async function jcs(orgId: string, createdBy: string, candidateId: string, o: Record<string, unknown> = {}) {
  const { data, error } = await admin().from('job_candidate_status').insert({
    job_id: `job_e2e_${rand()}`, candidate_id: candidateId, created_by: createdBy, organization_id: orgId,
    candidate_name: 'Camille Martin', status: 'contacted', pipeline_stage: 'Contacté', ...o,
  }).select('id').single();
  if (error || !data) throw new Error(`jcs: ${error?.message}`);
  return data.id as string;
}
async function jcsRow(id: string) {
  const { data } = await admin().from('job_candidate_status').select('status, pipeline_stage').eq('id', id).single();
  return data as { status: string; pipeline_stage: string | null };
}
async function stepsWithTemplates(org: TestOrg, createdBy: string, steps: Array<{ action_type: string; template?: string; delay_days?: number; wait_for_event?: string }>) {
  const seeded = await seedSequence(org.orgId, createdBy, steps.map((s) => ({
    action_type: s.action_type, delay_days: s.delay_days ?? 0, wait_for_event: s.wait_for_event ?? null,
  })));
  for (const [i, s] of steps.entries()) {
    if (s.template) await admin().from('sequence_steps').update({ message_template: s.template }).eq('id', seeded.steps[i].id);
  }
  return seeded;
}

// ════════════════════════════════════════════════════════════════════════════
// Réponse du candidat (message_received / new_message)
// ════════════════════════════════════════════════════════════════════════════
test.describe('Réponse du candidat', () => {
  // reponse-pendant-pause (SEQ-012)
  test('@critical une réponse reçue pendant une pause clôt l’inscription ; ni la reprise manuelle, ni la reconnexion, ni la souscription ne relancent le candidat', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound pause');
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance ne doit pas partir']);
    const cases: Array<{ reason: string; cancelledBy: string | null }> = [
      { reason: 'manual', cancelledBy: null },
      { reason: 'account_disconnected', cancelledBy: ACCOUNT_DISCONNECTED_SKIP_REASON },
      { reason: 'subscription_required', cancelledBy: SUBSCRIPTION_REQUIRED_REASON },
    ];
    const seeded: Array<{ reason: string; enrollmentId: string; profileId: string; execs: string[] }> = [];
    for (const c of cases) {
      const e = await enroll(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: c.reason, current_step_order: 1 });
      const execs: string[] = [];
      execs.push(await schedule(org, e.enrollmentId, steps[0], { status: 'sent', scheduled_at: minutesFromNow(-3 * DAY), executed_at: minutesFromNow(-3 * DAY) }));
      // Pause du moteur : étape annulée avec la raison que la reprise automatique réarme.
      // Pause manuelle : étape gardée avec sa date (échue).
      execs.push(await schedule(org, e.enrollmentId, steps[1], c.cancelledBy
        ? { status: 'cancelled', skip_reason: c.cancelledBy, scheduled_at: minutesFromNow(-10) }
        : { scheduled_at: minutesFromNow(-10) }));
      seeded.push({ reason: c.reason, ...e, execs });
    }

    for (const s of seeded) await webhook(replyFrom(accountId, s.profileId));

    for (const s of seeded) {
      const row = await enr(s.enrollmentId);
      expect(row.status, `${s.reason} : inscription close par la réponse`).toBe('replied');
      expect(row.pause_reason, `${s.reason} : plus de raison de pause`).toBeNull();
      expect(row.replied_at).not.toBeNull();
      const relance = await exec(s.execs[1]);
      expect(relance.status, `${s.reason} : relance annulée ou restée annulée`).toBe('cancelled');
    }
    expect((await exec(seeded[0].execs[1])).skip_reason).toBe('Reply detected via webhook');
    expect((await analytics(sequenceId)).replies, 'une réponse comptée par inscription').toBe(3);

    // Reprise manuelle : non éligible.
    const token = await ownerToken(org);
    const resume = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: seeded.map((s) => s.enrollmentId) });
    expect(resume.status, JSON.stringify(resume.body)).toBe(200);
    const results = resume.body.results as Array<{ enrollment_id: string; outcome: string }>;
    expect(results).toHaveLength(3);
    for (const r of results) expect(r.outcome, `reprise refusée pour ${r.enrollment_id}`).toBe('not_paused');

    // Reconnexion du compte, puis souscription payante.
    await webhook({ AccountStatus: { account_id: accountId, account_type: 'LINKEDIN', message: 'OK' } });
    const stripe = await checkoutCompleted(org.orgId);
    expect(stripe.status, JSON.stringify(stripe.body)).toBe(200);

    for (const s of seeded) {
      expect((await enr(s.enrollmentId)).status, `${s.reason} : toujours « a répondu »`).toBe('replied');
      expect((await exec(s.execs[1])).status, `${s.reason} : relance jamais réarmée`).toBe('cancelled');
    }
    await runCycle();
    expect(await sentTexts(accountId), 'aucun message au candidat qui a répondu').toEqual([]);
  });

  // reponse-pipeline-organisation (SEQ-006)
  test('@critical la réponse passe le pipeline « Répondu » dans l’organisation de l’inscription seulement ; étape avancée et autre organisation intactes', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound pipeline A');
    const other = track(await createOrg('agency', 'E2E inbound pipeline B'));
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const contacted = await jcs(org.orgId, org.owner.userId, profileId, { status: 'contacted', pipeline_stage: 'Contacté' });
    const emptyStage = await jcs(org.orgId, org.owner.userId, profileId, { status: 'messaged', pipeline_stage: null });
    const advanced = await jcs(org.orgId, org.owner.userId, profileId, { status: 'contacted', pipeline_stage: 'Entretien' });
    const otherOrg = await jcs(other.orgId, other.owner.userId, profileId, { status: 'contacted', pipeline_stage: 'Contacté' });
    const otherOrgNew = await jcs(other.orgId, other.owner.userId, profileId, { status: 'messaged', pipeline_stage: 'Nouveau' });

    await webhook(replyFrom(accountId, profileId));

    expect((await enr(enrollmentId)).status).toBe('replied');
    expect(await jcsRow(contacted)).toEqual({ status: 'replied', pipeline_stage: 'Répondu' });
    expect(await jcsRow(emptyStage)).toEqual({ status: 'replied', pipeline_stage: 'Répondu' });
    expect(await jcsRow(advanced), 'étape avancée gardée').toEqual({ status: 'replied', pipeline_stage: 'Entretien' });
    expect(await jcsRow(otherOrg), 'autre organisation intacte').toEqual({ status: 'contacted', pipeline_stage: 'Contacté' });
    expect(await jcsRow(otherOrgNew), 'autre organisation intacte').toEqual({ status: 'messaged', pipeline_stage: 'Nouveau' });
  });

  // reponse-arrete-soeurs (SEQ-212)
  test('@critical une réponse arrête les inscriptions du candidat sur les autres comptes de l’organisation, jamais celles d’une autre organisation', async () => {
    const { org, accountId: a1 } = await trackedSendingOrg('E2E inbound soeurs A');
    const { user: member, accountId: a2 } = await memberWithAccount(org);
    const { org: other, accountId: b1 } = await trackedSendingOrg('E2E inbound soeurs B');
    const profileId = `ACoAAE2ESIB${rand()}${rand()}`;

    const seqA1 = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance A1']);
    const seqA2 = await messageSequence(org, member.userId, ['Bonjour', 'Relance A2']);
    const seqA2b = await messageSequence(org, member.userId, ['Bonjour', 'Relance A2 bis']);
    const seqB = await messageSequence(other, other.owner.userId, ['Bonjour', 'Relance B']);

    const onA1 = await enroll(org, seqA1.sequenceId, org.owner.userId, a1, { profile_id: profileId });
    const onA2 = await enroll(org, seqA2.sequenceId, member.userId, a2, { profile_id: profileId });
    const onA2Paused = await enroll(org, seqA2b.sequenceId, member.userId, a2, { profile_id: profileId, status: 'paused', pause_reason: 'manual' });
    const onB = await enroll(other, seqB.sequenceId, other.owner.userId, b1, { profile_id: profileId });
    const later = minutesFromNow(2 * DAY);
    const execA1 = await schedule(org, onA1.enrollmentId, seqA1.steps[1], { scheduled_at: later });
    const execA2 = await schedule(org, onA2.enrollmentId, seqA2.steps[1], { scheduled_at: later });
    const execA2Waiting = await schedule(org, onA2.enrollmentId, seqA2.steps[0], { status: 'waiting_event', scheduled_at: later });
    const execA2Paused = await schedule(org, onA2Paused.enrollmentId, seqA2b.steps[1], { scheduled_at: later });
    const execB = await schedule(other, onB.enrollmentId, seqB.steps[1], { scheduled_at: later });

    await webhook(replyFrom(a1, profileId));

    expect((await enr(onA1.enrollmentId)).status).toBe('replied');
    expect((await exec(execA1)).status).toBe('cancelled');
    for (const [label, id] of [['A2 active', onA2.enrollmentId], ['A2 en pause', onA2Paused.enrollmentId]] as const) {
      const row = await enr(id);
      expect(row.status, `${label} : arrêtée`).toBe('stopped');
      expect(row.pause_reason, `${label} : sans raison de pause`).toBeNull();
    }
    for (const id of [execA2, execA2Waiting, execA2Paused]) {
      const e = await exec(id);
      expect(e.status).toBe('cancelled');
      expect(e.skip_reason).toBe(SIBLING_REPLY_SKIP_REASON);
    }
    // Réponse comptée une fois, sur la séquence qui l'a reçue.
    expect((await analytics(seqA1.sequenceId)).replies).toBe(1);
    expect((await analytics(seqA2.sequenceId)).replies).toBe(0);

    // Autre organisation : rien ne bouge.
    expect((await enr(onB.enrollmentId)).status).toBe('active');
    expect((await exec(execB)).status).toBe('scheduled');
    expect((await analytics(seqB.sequenceId)).replies).toBe(0);
  });

  // dedup-meme-evenement (SEQ-191)
  test('le même événement reçu deux fois n’est traité qu’une fois ; un second message après clôture ne recompte rien', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound dédup');
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    const followUp = await schedule(org, enrollmentId, steps[1], { scheduled_at: minutesFromNow(DAY) });
    expect((await analytics(sequenceId)).replies).toBe(0);

    const chatId = `chat_${rand()}`;
    const messageId = `msg_${rand()}`;
    const first = await webhook(replyFrom(accountId, profileId, { chatId, messageId }));
    expect(first.deduplicated).toBeUndefined();
    const second = await webhook(replyFrom(accountId, profileId, { chatId, messageId }));
    expect(second, 'second envoi du même événement').toEqual({ ok: true, deduplicated: true });
    const thirdId = `msg_${rand()}`;
    const third = await webhook(replyFrom(accountId, profileId, { chatId, messageId: thirdId }));
    expect(third.deduplicated, 'autre message : traité, pas dédoublonné').toBeUndefined();

    expect((await enr(enrollmentId)).status).toBe('replied');
    expect((await exec(followUp)).status).toBe('cancelled');
    expect((await analytics(sequenceId)).replies, 'réponse comptée une seule fois').toBe(1);
    expect(await dedupRows(`unipile:message_received:${messageId}`)).toBe(1);
    expect(await dedupRows(`unipile:message_received:${thirdId}`)).toBe(1);
  });

  // unipile-webhook-auth-refus
  test('un appel au webhook LinkedIn sans authentification valide répond 401 et n’écrit rien', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound auth');
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    const followUp = await schedule(org, enrollmentId, steps[1], { scheduled_at: minutesFromNow(DAY) });

    const messageId = `msg_${rand()}`;
    const payload = replyFrom(accountId, profileId, { messageId });
    const attempts: Array<[string, Record<string, string>, string]> = [
      ['en-tête faux', { 'unipile-auth': 'faux' }, ''],
      ['sans en-tête', {}, ''],
      ['jeton v2 inventé', {}, '?v2_token=invente'],
      ['signature hosted_auth inventée', {}, '?hosted_sig=deadbeef'],
    ];
    for (const [label, headers, query] of attempts) {
      const res = await rawWebhook(payload, headers, query);
      expect(res.status, `${label} : ${JSON.stringify(res.body)}`).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
    }
    expect(await dedupRows(`unipile:message_received:${messageId}`), 'aucune ligne de dédoublonnage').toBe(0);
    expect((await enr(enrollmentId)).status).toBe('active');
    expect((await exec(followUp)).status).toBe('scheduled');
    expect(await notificationsOf(org.orgId, 'new_message')).toEqual([]);

    // Le même événement authentifié est ensuite traité (il n'a pas été consommé).
    await webhook(payload);
    expect((await enr(enrollmentId)).status).toBe('replied');
  });

  // rejeu-apres-echec (SEQ-040)
  test('vérification d’expéditeur impossible : 500, ligne de dédoublonnage purgée, le rejeu est traité normalement', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound rejeu');
    // Identifiants propres à l'organisation : l'appel des participants porte l'account_id.
    await setIntegration(org.orgId, { unipile_connected: true, unipile_api_key: 'mock-key', unipile_dsn: `unipile.mock?account_id=${accountId}&e2e=` });
    await setMockMode(accountId, {
      routes: [
        { method: 'GET', path: '^/$', status: 503, body: { status: 503, title: 'Service Unavailable' }, times: 1 },
        {
          method: 'GET', path: '^/$', status: 200, body: {
            object: 'ChatAttendeeList', items: [
              { object: 'ChatAttendee', id: 'att_self', provider_id: 'ACoAAMOCKME', is_self: 1 },
              { object: 'ChatAttendee', id: 'att_candidate', provider_id: 'ACoAAMOCKCANDIDATE', is_self: 0 },
            ],
          },
        },
      ],
    });
    cleanups.push(() => setMockMode(accountId, {}));
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    const followUp = await schedule(org, enrollmentId, steps[1], { scheduled_at: minutesFromNow(DAY) });

    const messageId = `msg_${rand()}`;
    const payload = replyFrom(accountId, profileId, { messageId });
    const failed = await rawWebhook(payload);
    expect(failed.status, JSON.stringify(failed.body)).toBe(500);
    const scripted = (await mockCalls(accountId)).filter((c) => c.scripted);
    expect(scripted.length, 'la vérification a bien reçu le 503 scripté').toBeGreaterThanOrEqual(1);
    expect(await dedupRows(`unipile:message_received:${messageId}`), 'ligne de dédoublonnage purgée').toBe(0);
    expect((await enr(enrollmentId)).status, 'rien de clos sur échec').toBe('active');
    expect((await exec(followUp)).status).toBe('scheduled');

    // Rejeu du prestataire, même clé.
    const replay = await rawWebhook(payload);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body.deduplicated).toBeUndefined();
    expect((await enr(enrollmentId)).status).toBe('replied');
    expect((await exec(followUp)).status).toBe('cancelled');
  });

  // message-received-expediteur-soi
  test('message envoyé par le compte lui-même : rien n’est clos et les notifications de la conversation passent en lues ; payload incomplet ignoré sans écriture', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound soi');
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const own = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    const ownFollowUp = await schedule(org, own.enrollmentId, steps[1], { scheduled_at: minutesFromNow(DAY) });
    const chatId = `chat_${rand()}`;
    const otherChat = `chat_${rand()}`;
    const { data: notifs, error } = await admin().from('notifications').insert([
      { user_id: org.owner.userId, organization_id: org.orgId, type: 'new_message', title: 'Nouveau message', metadata: { chat_id: chatId } },
      { user_id: org.owner.userId, organization_id: org.orgId, type: 'new_message', title: 'Autre conversation', metadata: { chat_id: otherChat } },
    ]).select('id');
    if (error || !notifs) throw new Error(error?.message);

    // Expéditeur = participant « soi » (att_self pour le faux prestataire).
    await webhook(replyFrom(accountId, own.profileId, { chatId, attendeeId: 'att_self' }));
    expect((await enr(own.enrollmentId)).status, 'notre propre message ne clôt rien').toBe('active');
    expect((await exec(ownFollowUp)).status).toBe('scheduled');
    const after = await notificationsOf(org.orgId, 'new_message');
    expect(after).toHaveLength(2);
    expect(after.find((n) => n.id === notifs[0].id)?.read_at, 'notification de la conversation lue').not.toBeNull();
    expect(after.find((n) => n.id === notifs[1].id)?.read_at, 'autre conversation intacte').toBeNull();

    // Payload sans identifiant de participant, puis sans conversation : ignorés (200).
    const noAttendee = await enroll(org, sequenceId, org.owner.userId, accountId);
    const noAttendeeExec = await schedule(org, noAttendee.enrollmentId, steps[1], { scheduled_at: minutesFromNow(DAY) });
    const missingAttendee = replyFrom(accountId, noAttendee.profileId);
    delete (missingAttendee.sender as Record<string, unknown>).attendee_id;
    await webhook(missingAttendee);
    const missingChat = replyFrom(accountId, noAttendee.profileId) as Record<string, unknown>;
    delete missingChat.chat_id;
    await webhook(missingChat);
    expect((await enr(noAttendee.enrollmentId)).status).toBe('active');
    expect((await exec(noAttendeeExec)).status).toBe('scheduled');
    expect(await notificationsOf(org.orgId, 'new_message'), 'aucune notification créée').toHaveLength(2);
  });

  // message-received-expediteur-soi (participants sans « soi » identifiable)
  test('réponse dont les participants n’ont pas de « soi » identifiable : ignorée (200), rien n’est clos', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound sans soi');
    // Identifiants propres : l'appel des participants tombe sur la réponse
    // générique du faux prestataire (items vides, aucun is_self).
    await setIntegration(org.orgId, { unipile_connected: true, unipile_api_key: 'mock-key', unipile_dsn: `unipile.mock/e2e-sans-soi-${rand()}` });
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    const followUp = await schedule(org, enrollmentId, steps[1], { scheduled_at: minutesFromNow(DAY) });
    const chatId = `chat_${rand()}`;

    const res = await webhook(replyFrom(accountId, profileId, { chatId }));
    expect(res.success).toBe(true);
    const attendeeCalls = (await mockCalls()).filter((c) => c.method === 'GET' && c.path.includes(`/chats/${chatId}/attendees`));
    expect(attendeeCalls.length, 'participants bien demandés').toBe(1);
    expect((await enr(enrollmentId)).status).toBe('active');
    expect((await exec(followUp)).status).toBe('scheduled');
    expect(await notificationsOf(org.orgId, 'new_message')).toEqual([]);
  });

  // new-message-imbrique-is-sender
  test('new_message imbriqué : is_sender vrai ignoré, faux clôt sans demander les participants, absent passe par les participants', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound imbriqué');
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const mine = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    const theirs = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    const unknown = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    const execMine = await schedule(org, mine.enrollmentId, steps[1], { scheduled_at: minutesFromNow(DAY) });
    const execTheirs = await schedule(org, theirs.enrollmentId, steps[1], { scheduled_at: minutesFromNow(DAY) });
    const execUnknown = await schedule(org, unknown.enrollmentId, steps[1], { scheduled_at: minutesFromNow(DAY) });
    const [chatMine, chatTheirs, chatUnknown] = [`chat_${rand()}`, `chat_${rand()}`, `chat_${rand()}`];
    const { data: notif } = await admin().from('notifications').insert({
      user_id: org.owner.userId, organization_id: org.orgId, type: 'new_message', title: 'Nouveau message', metadata: { chat_id: chatMine },
    }).select('id').single();

    await webhook({
      event: 'new_message', account_id: accountId,
      data: { message: { id: `m_${rand()}`, is_sender: true, chat_id: chatMine, sender: { provider_id: mine.profileId } } },
    });
    await webhook({
      event: 'new_message', account_id: accountId,
      data: { message: { id: `m_${rand()}`, is_sender: false, chat_id: chatTheirs, sender: { provider_id: theirs.profileId } } },
    });
    await webhook({
      event: 'new_message', account_id: accountId,
      data: { message: { id: `m_${rand()}`, chat_id: chatUnknown, sender_attendee_id: 'att_self', sender: { provider_id: unknown.profileId } } },
    });

    expect((await enr(mine.enrollmentId)).status, 'is_sender vrai : ignoré').toBe('active');
    expect((await exec(execMine)).status).toBe('scheduled');
    const { data: readNotif } = await admin().from('notifications').select('read_at').eq('id', notif!.id).single();
    expect(readNotif?.read_at, 'notifications de la conversation lues').not.toBeNull();

    expect((await enr(theirs.enrollmentId)).status, 'is_sender faux : réponse').toBe('replied');
    expect((await exec(execTheirs)).status).toBe('cancelled');

    expect((await enr(unknown.enrollmentId)).status, 'is_sender absent, participant « soi » : ignoré').toBe('active');
    expect((await exec(execUnknown)).status).toBe('scheduled');

    const attendeeCalls = (await mockCalls()).filter((c) => c.method === 'GET' && /\/chats\/[^/]+\/attendees$/.test(c.path));
    expect(attendeeCalls.filter((c) => c.path.includes(chatTheirs)), 'is_sender faux : aucun appel des participants').toHaveLength(0);
    expect(attendeeCalls.filter((c) => c.path.includes(chatMine)), 'is_sender vrai : aucun appel des participants').toHaveLength(0);
    expect(attendeeCalls.filter((c) => c.path.includes(chatUnknown)), 'is_sender absent : participants demandés').toHaveLength(1);
  });

  // reponse-compte-rotation (SEQ-013)
  test('réponse et acceptation reçues sur le compte d’envoi en rotation : rattachées à l’inscription enrôlée sur un autre compte', async () => {
    const { org, accountId: accountA } = await trackedSendingOrg('E2E inbound rotation');
    const { accountId: accountB } = await memberWithAccount(org);
    const msgSeq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const replied = await enroll(org, msgSeq.sequenceId, org.owner.userId, accountA, { assigned_sender_id: accountB, current_step_order: 1 });
    const followUp = await schedule(org, replied.enrollmentId, msgSeq.steps[1], { scheduled_at: minutesFromNow(DAY) });

    const waitSeq = await stepsWithTemplates(org, org.owner.userId, [
      { action_type: 'connection_request' },
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted' },
      { action_type: 'message', template: 'Merci' },
    ]);
    const accepted = await enroll(org, waitSeq.sequenceId, org.owner.userId, accountA, { assigned_sender_id: accountB, current_step_order: 1 });
    await schedule(org, accepted.enrollmentId, waitSeq.steps[0], { status: 'sent', scheduled_at: minutesFromNow(-DAY), executed_at: minutesFromNow(-DAY) });
    const wait = await schedule(org, accepted.enrollmentId, waitSeq.steps[1], { status: 'waiting_event', scheduled_at: minutesFromNow(6 * DAY) });

    await webhook(replyFrom(accountB, replied.profileId));
    expect((await enr(replied.enrollmentId)).status, 'réponse reçue sur le compte de rotation').toBe('replied');
    expect((await exec(followUp)).status).toBe('cancelled');

    await webhook(newRelation(accountB, accepted.profileId));
    const w = await exec(wait);
    expect(w.status, 'attente réarmée par l’acceptation sur le compte de rotation').toBe('scheduled');
    expect(ts(w.scheduled_at)).toBeLessThanOrEqual(Date.now() + 5_000);
    expect((await enr(accepted.enrollmentId)).connection_status).toBe('connected');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Acceptation de l'invitation (new_relation)
// ════════════════════════════════════════════════════════════════════════════
test.describe('Acceptation de l’invitation', () => {
  // new-relation-libere-attente (SEQ-209)
  test('new_relation sur une inscription sans connection_status réarme l’attente, la marque connectée, compte l’acceptation, puis l’étape suivante part', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound relation');
    const seq = await stepsWithTemplates(org, org.owner.userId, [
      { action_type: 'connection_request' },
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted' },
      { action_type: 'message', template: 'Merci' },
    ]);
    const { enrollmentId, profileId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { current_step_order: 1, connection_status: null });
    await schedule(org, enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: minutesFromNow(-DAY), executed_at: minutesFromNow(-DAY) });
    const wait = await schedule(org, enrollmentId, seq.steps[1], { status: 'waiting_event', scheduled_at: minutesFromNow(6 * DAY) });

    await webhook(newRelation(accountId, profileId));

    const w = await exec(wait);
    expect(w.status).toBe('scheduled');
    expect(ts(w.scheduled_at)).toBeLessThanOrEqual(Date.now() + 5_000);
    const row = await enr(enrollmentId);
    expect(row.connection_status).toBe('connected');
    expect(row.network_distance).toBe('FIRST_DEGREE');
    expect(row.status).toBe('active');
    expect((await analytics(seq.sequenceId)).accepted, 'invitation acceptée comptée').toBe(1);

    // Même acceptation rejouée par un second événement : pas de double compte.
    // (clé de dédoublonnage différente : chat_id fait partie de la clé.)
    await webhook({ ...newRelation(accountId, profileId), event: 'relation.request.accept', chat_id: `chat_${rand()}` });
    expect((await analytics(seq.sequenceId)).accepted).toBe(1);

    await runCycle();
    expect((await exec(wait)).status, 'attente franchie par le cycle').toBe('sent');
    const next = (await executionsOf(enrollmentId)).filter((e) => e.step_order === 2);
    expect(next, 'étape suivante planifiée').toHaveLength(1);
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', next[0].id);
    await runCycle();
    expect(await sentTexts(accountId)).toEqual(['Merci']);
  });

  // new-relation-en-pause (SEQ-012)
  test('new_relation sur une inscription en pause consigne la connexion sans réarmer l’attente ; l’attente est franchie à la reprise', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound relation pause');
    const seq = await stepsWithTemplates(org, org.owner.userId, [
      { action_type: 'connection_request' },
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted' },
      { action_type: 'message', template: 'Merci' },
    ]);
    const lastCheck = minutesFromNow(-2 * DAY);
    const { enrollmentId, profileId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId, {
      current_step_order: 1, status: 'paused', pause_reason: 'manual', last_check_at: lastCheck,
    });
    await schedule(org, enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: minutesFromNow(-DAY), executed_at: minutesFromNow(-DAY) });
    const waitAt = minutesFromNow(6 * DAY);
    const wait = await schedule(org, enrollmentId, seq.steps[1], { status: 'waiting_event', scheduled_at: waitAt });

    await webhook(newRelation(accountId, profileId));

    const row = await enr(enrollmentId);
    expect(row.connection_status, 'connexion consignée').toBe('connected');
    expect(row.status).toBe('paused');
    expect(row.pause_reason).toBe('manual');
    expect(ts(row.last_check_at), 'last_check_at inchangé').toBe(ts(lastCheck));
    const w = await exec(wait);
    expect(w.status, 'attente non réarmée pendant la pause').toBe('waiting_event');
    expect(ts(w.scheduled_at)).toBe(ts(waitAt));

    const resume = await engine(await ownerToken(org), { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [enrollmentId] });
    expect(resume.status, JSON.stringify(resume.body)).toBe(200);
    expect((resume.body.results as Array<{ outcome: string }>)[0].outcome).toBe('resumed');
    expect((await exec(wait)).status, 'l’attente est gardée telle quelle à la reprise').toBe('waiting_event');

    await runEngine({ action: 'check_wait_events' });
    expect((await exec(wait)).status, 'attente franchie après la reprise (candidat déjà connecté)').toBe('scheduled');
  });

  // new-relation-pas-une-attente (SEQ-190)
  test('new_relation n’avance jamais une étape qui n’est pas une attente et ne ramène jamais une exécution en cours ou partie', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound relation garde');
    const msgSeq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 2);
    const a = await enroll(org, msgSeq.sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, a.enrollmentId, msgSeq.steps[0], { status: 'sent', scheduled_at: minutesFromNow(-DAY), executed_at: minutesFromNow(-DAY) });
    const plannedAt = minutesFromNow(2 * DAY);
    const relance = await schedule(org, a.enrollmentId, msgSeq.steps[1], { scheduled_at: plannedAt });

    const waitSeq = await stepsWithTemplates(org, org.owner.userId, [
      { action_type: 'connection_request' },
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted' },
      { action_type: 'message', template: 'Merci', delay_days: 2 },
    ]);
    const sending = await enroll(org, waitSeq.sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, sending.enrollmentId, waitSeq.steps[0], { status: 'sent', scheduled_at: minutesFromNow(-DAY), executed_at: minutesFromNow(-DAY) });
    const waitSending = await schedule(org, sending.enrollmentId, waitSeq.steps[1], { status: 'sending', scheduled_at: minutesFromNow(-5) });
    const sent = await enroll(org, waitSeq.sequenceId, org.owner.userId, accountId, { current_step_order: 2 });
    await schedule(org, sent.enrollmentId, waitSeq.steps[0], { status: 'sent', scheduled_at: minutesFromNow(-DAY), executed_at: minutesFromNow(-DAY) });
    const waitSent = await schedule(org, sent.enrollmentId, waitSeq.steps[1], { status: 'sent', scheduled_at: minutesFromNow(-60), executed_at: minutesFromNow(-60) });
    const messageLater = await schedule(org, sent.enrollmentId, waitSeq.steps[2], { scheduled_at: plannedAt });

    for (const who of [a, sending, sent]) await webhook(newRelation(accountId, who.profileId));

    const r = await exec(relance);
    expect(r.status).toBe('scheduled');
    expect(ts(r.scheduled_at), 'message prévu dans 2 jours : date gardée').toBe(ts(plannedAt));
    expect((await exec(waitSending)).status, 'attente en cours d’envoi : jamais ramenée').toBe('sending');
    expect((await exec(waitSent)).status, 'attente déjà franchie : reste franchie').toBe('sent');
    const m = await exec(messageLater);
    expect(m.status).toBe('scheduled');
    expect(ts(m.scheduled_at)).toBe(ts(plannedAt));
    for (const who of [a, sending, sent]) expect((await enr(who.enrollmentId)).connection_status).toBe('connected');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Reprises automatiques (reconnexion du compte, souscription)
// ════════════════════════════════════════════════════════════════════════════
test.describe('Reprises automatiques', () => {
  // reconnexion-autres-pauses-intactes (SEQ-002)
  test('@critical la reconnexion ne reprend que la raison « compte déconnecté » : les autres pauses du même compte restent en pause', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound reconnexion');
    const kept = await messageSequence(org, org.owner.userId, ['Ne doit pas partir']);
    const control = await messageSequence(org, org.owner.userId, ['Témoin reconnexion']);
    const reasons = ['manual', 'subscription_required', 'send_failed', 'auto_paused', 'quota_reached'];
    const paused: Array<{ reason: string; enrollmentId: string; profileId: string }> = [];
    for (const reason of reasons) {
      paused.push({ reason, ...await enroll(org, kept.sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: reason }) });
    }
    const witness = await enroll(org, control.sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'account_disconnected' });
    // Même compte utilisé en rotation (assigned_sender_id) par des inscriptions enrôlées sur le compte d'un membre.
    const { user: member, accountId: memberAccount } = await memberWithAccount(org);
    const rotationKept = await enroll(org, kept.sequenceId, member.userId, memberAccount, { status: 'paused', pause_reason: 'manual', assigned_sender_id: accountId });
    const rotationWitness = await enroll(org, control.sequenceId, member.userId, memberAccount, { status: 'paused', pause_reason: 'account_disconnected', assigned_sender_id: accountId });
    await admin().from('member_linkedin_accounts').update({ account_status: 'CREDENTIALS' }).eq('linkedin_account_id', accountId);
    // Étapes échues insérées en dernier (inscriptions en pause : aucun cycle ne les prend).
    const execs = new Map<string, string>();
    for (const p of paused) execs.set(p.reason, await schedule(org, p.enrollmentId, kept.steps[0], { scheduled_at: minutesFromNow(-5) }));
    const witnessExec = await schedule(org, witness.enrollmentId, control.steps[0], {
      status: 'cancelled', skip_reason: ACCOUNT_DISCONNECTED_SKIP_REASON, scheduled_at: minutesFromNow(-5),
    });
    const rotationKeptExec = await schedule(org, rotationKept.enrollmentId, kept.steps[0], { scheduled_at: minutesFromNow(-5) });
    const rotationPlanned = minutesFromNow(2 * DAY);
    const rotationWitnessExec = await schedule(org, rotationWitness.enrollmentId, control.steps[0], {
      status: 'cancelled', skip_reason: ACCOUNT_DISCONNECTED_SKIP_REASON, scheduled_at: rotationPlanned,
    });

    await webhook({ AccountStatus: { account_id: accountId, account_type: 'LINKEDIN', message: 'OK' } });

    for (const p of paused) {
      const row = await enr(p.enrollmentId);
      expect(row.status, `${p.reason} : toujours en pause`).toBe('paused');
      expect(row.pause_reason, `${p.reason} : raison gardée`).toBe(p.reason);
      expect((await exec(execs.get(p.reason)!)).status, `${p.reason} : étape gardée`).toBe('scheduled');
    }
    const rk = await enr(rotationKept.enrollmentId);
    expect(rk.status, 'rotation, pause manuelle : toujours en pause').toBe('paused');
    expect(rk.pause_reason).toBe('manual');
    expect((await exec(rotationKeptExec)).status).toBe('scheduled');
    expect((await enr(rotationWitness.enrollmentId)).status, 'rotation, compte déconnecté : reprise').toBe('active');
    const rw = await exec(rotationWitnessExec);
    expect(rw.status).toBe('scheduled');
    expect(ts(rw.scheduled_at), 'relance future : date prévue gardée').toBe(ts(rotationPlanned));
    const w = await enr(witness.enrollmentId);
    expect(w.status, 'témoin : reprise à la reconnexion').toBe('active');
    expect(w.pause_reason).toBeNull();
    const rearmed = await exec(witnessExec);
    expect(rearmed.status).toBe('scheduled');
    // Replanifiée à max(date prévue, maintenant + 1 min) : on la ramène à échue.
    expect(ts(rearmed.scheduled_at)).toBeGreaterThan(Date.now());
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', witnessExec);

    await runCycle();
    expect(await sentTexts(accountId), 'seul le témoin repart').toEqual(['Témoin reconnexion']);
    expect(await sentTexts(memberAccount)).toEqual([]);
  });

  // stripe-reprise-souscription (SEQ-002, D1)
  test('@critical une souscription payante reprend les pauses « abonnement requis » des séquences actives, replanifie à max(prévu, maintenant + 1 min), laisse le reste intact', async () => {
    // Organisation au plan gratuit (créé à la création de l'organisation).
    const org = track(await createOrg('agency', 'E2E inbound Stripe A'));
    const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_${rand()}`, 'OK');
    const other = track(await createOrg('agency', 'E2E inbound Stripe B'));
    const otherAccount = await seedLinkedInAccount(other.orgId, other.owner.userId, `acc_${rand()}`, 'OK');

    const active = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const inactive = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', inactive.sequenceId);
    const otherSeq = await messageSequence(other, other.owner.userId, ['Bonjour', 'Relance']);

    const later = minutesFromNow(2 * DAY);
    const future = await enroll(org, active.sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'subscription_required' });
    const overdue = await enroll(org, active.sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'subscription_required' });
    const onInactive = await enroll(org, inactive.sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'subscription_required' });
    const manual = await enroll(org, active.sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'manual' });
    const otherOrg = await enroll(other, otherSeq.sequenceId, other.owner.userId, otherAccount, { status: 'paused', pause_reason: 'subscription_required' });
    const cancelled = (at: string) => ({ status: 'cancelled', skip_reason: SUBSCRIPTION_REQUIRED_REASON, scheduled_at: at });
    const execFuture = await schedule(org, future.enrollmentId, active.steps[0], cancelled(later));
    const execOverdue = await schedule(org, overdue.enrollmentId, active.steps[0], cancelled(minutesFromNow(-3 * DAY)));
    const execInactive = await schedule(org, onInactive.enrollmentId, inactive.steps[0], cancelled(later));
    const execManual = await schedule(org, manual.enrollmentId, active.steps[0], cancelled(later));
    const execOther = await schedule(other, otherOrg.enrollmentId, otherSeq.steps[0], cancelled(later));

    // Paiement non encore encaissé : rien ne reprend.
    const unpaid = await stripeEvent({
      id: `evt_e2e_${rand()}`, type: 'checkout.session.completed',
      data: { object: { id: `cs_e2e_${rand()}`, mode: 'subscription', payment_status: 'unpaid', subscription: `sub_e2e_${rand()}`, customer: `cus_e2e_${rand()}`, metadata: { organization_id: org.orgId, plan_id: 'cabinet' } } },
    });
    expect(unpaid.status, JSON.stringify(unpaid.body)).toBe(200);
    expect((await enr(future.enrollmentId)).status, 'paiement non encaissé : toujours en pause').toBe('paused');
    expect((await exec(execFuture)).status).toBe('cancelled');

    const res = await checkoutCompleted(org.orgId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { data: sub } = await admin().from('organization_subscriptions').select('plan_id, status').eq('organization_id', org.orgId).single();
    expect(sub, 'abonnement enregistré').toEqual({ plan_id: 'cabinet', status: 'active' });

    for (const id of [future.enrollmentId, overdue.enrollmentId]) {
      const row = await enr(id);
      expect(row.status, 'reprise après souscription').toBe('active');
      expect(row.pause_reason).toBeNull();
    }
    const f = await exec(execFuture);
    expect(f.status).toBe('scheduled');
    expect(f.skip_reason).toBeNull();
    expect(ts(f.scheduled_at), 'relance future : date prévue gardée').toBe(ts(later));
    const o = await exec(execOverdue);
    expect(o.status).toBe('scheduled');
    expect(ts(o.scheduled_at), 'date passée : maintenant + 1 min').toBeGreaterThanOrEqual(Date.now() + 30_000);
    expect(ts(o.scheduled_at)).toBeLessThanOrEqual(Date.now() + 120_000);

    const inactiveRow = await enr(onInactive.enrollmentId);
    expect(inactiveRow.status, 'séquence désactivée : jamais réactivée (D1)').toBe('paused');
    expect(inactiveRow.pause_reason).toBe('sequence_inactive');
    expect((await exec(execInactive)).status, 'séquence désactivée : aucun réarmement').toBe('cancelled');

    const manualRow = await enr(manual.enrollmentId);
    expect(manualRow.status).toBe('paused');
    expect(manualRow.pause_reason).toBe('manual');
    expect((await exec(execManual)).status).toBe('cancelled');

    const otherRow = await enr(otherOrg.enrollmentId);
    expect(otherRow.status, 'autre organisation intacte').toBe('paused');
    expect(otherRow.pause_reason).toBe('subscription_required');
    expect((await exec(execOther)).status).toBe('cancelled');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rendez-vous Calendly (D4)
// ════════════════════════════════════════════════════════════════════════════
test.describe('Rendez-vous Calendly', () => {
  async function calendlyFixture(prefix: string) {
    const slug = `camille-e2e-${rand()}`;
    const url = `https://www.linkedin.com/in/${slug}`;
    const profileId = `ACoAAE2ECAL${rand()}${rand()}`;
    const orgs: Array<{ org: TestOrg; accountId: string; enrollmentId: string; execId: string; jcsId: string }> = [];
    for (const label of ['A', 'B']) {
      const { org, accountId } = await trackedSendingOrg(`${prefix} ${label}`);
      const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
      const e = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { profile_id: profileId, profile_url: url, current_step_order: 1 });
      const execId = await schedule(org, e.enrollmentId, seq.steps[1], { scheduled_at: minutesFromNow(DAY) });
      const jcsId = await jcs(org.orgId, org.owner.userId, profileId, { linkedin_profile_url: url });
      orgs.push({ org, accountId, enrollmentId: e.enrollmentId, execId, jcsId });
    }
    return { slug, orgs };
  }
  async function sessionsFor(eventId: string) {
    const { data } = await admin().from('qualification_sessions').select('id, organization_id').eq('calendly_event_id', eventId);
    return (data ?? []) as Array<{ id: string; organization_id: string | null }>;
  }
  async function expectNothingChanged(orgs: Awaited<ReturnType<typeof calendlyFixture>>['orgs'], eventId: string) {
    expect(await sessionsFor(eventId), 'aucune session de qualification').toEqual([]);
    for (const o of orgs) {
      expect((await enr(o.enrollmentId)).status, 'inscription intacte').toBe('active');
      expect((await exec(o.execId)).status).toBe('scheduled');
      expect(await jcsRow(o.jcsId)).toEqual({ status: 'contacted', pipeline_stage: 'Contacté' });
      expect(await notificationsOf(o.org.orgId), 'aucune notification').toEqual([]);
    }
  }

  // calendly-organisation-ambigue (SEQ-008, D4)
  test('@critical D4 : profil suivi par deux organisations reliées à Calendly : rien n’est arrêté (ambiguous_org, 2)', async () => {
    const { slug, orgs } = await calendlyFixture('E2E inbound Calendly deux');
    for (const o of orgs) await setIntegration(o.org.orgId, { calendly_connected: true });
    const eventId = `evt_e2e_${rand()}`;
    const res = await calendlyBooking(slug, eventId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ success: true, skipped: true, reason: 'ambiguous_org', calendly_org_count: 2 });
    await expectNothingChanged(orgs, eventId);
  });

  // calendly-organisation-ambigue (variante : aucune organisation reliée)
  test('@critical D4 : profil suivi par deux organisations dont aucune n’est reliée à Calendly : rien n’est arrêté (ambiguous_org, 0)', async () => {
    const { slug, orgs } = await calendlyFixture('E2E inbound Calendly aucune');
    const eventId = `evt_e2e_${rand()}`;
    const res = await calendlyBooking(slug, eventId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ success: true, skipped: true, reason: 'ambiguous_org', calendly_org_count: 0 });
    await expectNothingChanged(orgs, eventId);
  });

  // calendly-organisation-ambigue (variante : une seule organisation reliée)
  test('@critical D4 : une seule organisation reliée à Calendly : seules ses inscriptions sont closes', async () => {
    const { slug, orgs } = await calendlyFixture('E2E inbound Calendly une');
    const [a, b] = orgs;
    await setIntegration(b.org.orgId, { calendly_connected: true });
    const eventId = `evt_e2e_${rand()}`;
    const res = await calendlyBooking(slug, eventId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const sessions = await sessionsFor(eventId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].organization_id).toBe(b.org.orgId);
    const closed = await enr(b.enrollmentId);
    expect(closed.status, 'organisation reliée : inscription close').toBe('completed');
    expect(closed.tracking_data?.completion_reason).toBe('meeting_booked');
    expect((await exec(b.execId)).status).toBe('cancelled');
    expect(await jcsRow(b.jcsId)).toEqual({ status: 'qualification', pipeline_stage: 'Pré-qualif' });
    expect((await notificationsOf(b.org.orgId, 'action')).length).toBe(1);

    expect((await enr(a.enrollmentId)).status, 'autre organisation intacte').toBe('active');
    expect((await exec(a.execId)).status).toBe('scheduled');
    expect(await jcsRow(a.jcsId)).toEqual({ status: 'contacted', pipeline_stage: 'Contacté' });
    expect(await notificationsOf(a.org.orgId)).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Effacement RGPD (SEQ-054, D5)
// ════════════════════════════════════════════════════════════════════════════
test.describe('Effacement RGPD', () => {
  // rgpd-erase-effets (SEQ-054, SEQ-202)
  test('@critical l’effacement arrête, marque, annule, efface et anonymise dans l’organisation demandeuse seulement', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound RGPD A');
    const { org: other, accountId: otherAccount } = await trackedSendingOrg('E2E inbound RGPD B');
    const slug = `camille-e2e-${rand()}`;
    const url = `https://www.linkedin.com/in/${slug}`;
    const email = `camille.${rand()}@e2e.konekt.test`;
    const profileId = `ACoAAE2ERGPD${rand()}${rand()}`;
    const base = { profile_id: profileId, profile_url: `${url}/` };

    const four = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance 1', 'Relance 2', 'Relance 3']);
    const two = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const three = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const otherSeq = await messageSequence(other, other.owner.userId, ['Bonjour', 'Relance']);
    const active = await enroll(org, four.sequenceId, org.owner.userId, accountId, { ...base, email_used: email, current_step_order: 1 });
    const paused = await enroll(org, two.sequenceId, org.owner.userId, accountId, { ...base, status: 'paused', pause_reason: 'manual' });
    const completed = await enroll(org, three.sequenceId, org.owner.userId, accountId, { ...base, status: 'completed', completed_at: minutesFromNow(-DAY) });
    const otherEnr = await enroll(other, otherSeq.sequenceId, other.owner.userId, otherAccount, { ...base, email_used: email });
    const later = minutesFromNow(2 * DAY);
    const sentExec = await schedule(org, active.enrollmentId, four.steps[0], { status: 'sent', final_message: 'Bonjour Camille', executed_at: minutesFromNow(-DAY), scheduled_at: minutesFromNow(-DAY) });
    const scheduledExec = await schedule(org, active.enrollmentId, four.steps[1], { scheduled_at: later, final_message: 'Relance préparée' });
    const waitingExec = await schedule(org, active.enrollmentId, four.steps[2], { status: 'waiting_event', scheduled_at: later });
    const sendingExec = await schedule(org, active.enrollmentId, four.steps[3], { status: 'sending', scheduled_at: minutesFromNow(-2), final_message: 'En cours' });
    const pausedExec = await schedule(org, paused.enrollmentId, two.steps[1], { scheduled_at: later });
    const completedExec = await schedule(org, completed.enrollmentId, three.steps[0], { status: 'sent', final_message: 'Bonjour', executed_at: minutesFromNow(-2 * DAY), scheduled_at: minutesFromNow(-2 * DAY) });
    const otherExec = await schedule(other, otherEnr.enrollmentId, otherSeq.steps[1], { scheduled_at: later, final_message: 'Relance B' });
    const inmail = (orgId: string, acc: string, by: string) => ({
      account_id: acc, recipient_profile_id: profileId, subject: 'Poste', message: 'Bonjour', status: 'scheduled',
      scheduled_at: later, created_by: by, organization_id: orgId,
    });
    const { data: inmails, error: inmailErr } = await admin().from('inmail_queue')
      .insert([inmail(org.orgId, accountId, org.owner.userId), inmail(other.orgId, otherAccount, other.owner.userId)]).select('id, organization_id');
    if (inmailErr || !inmails) throw new Error(inmailErr?.message);
    const { error: enrichErr } = await admin().from('candidate_enrichments').insert([
      { organization_id: org.orgId, linkedin_url: url, contact_email: email, status: 'terminated' },
      { organization_id: other.orgId, linkedin_url: url, contact_email: email, status: 'terminated' },
    ]);
    if (enrichErr) throw new Error(enrichErr.message);
    cleanups.push(() => admin().from('suppressed_emails').delete().eq('email', email));

    const token = await ownerToken(org);
    const res = await rgpdErase(token, { linkedin_url: url, email, organization_id: org.orgId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ success: true, scope: 'organization', stopped_enrollments: 2, cancelled_inmails: 1, email_suppressed: true });

    const markers = new Map<string, string>();
    for (const [label, id, status] of [
      ['active', active.enrollmentId, 'stopped'], ['en pause', paused.enrollmentId, 'stopped'], ['terminée', completed.enrollmentId, 'completed'],
    ] as const) {
      const row = await enr(id);
      expect(row.status, `${label}`).toBe(status);
      expect(row.pause_reason).toBeNull();
      const marker = row.tracking_data?.gdpr_erased_at;
      expect(typeof marker, `${label} : marqueur durable`).toBe('string');
      markers.set(id, marker as string);
      expect(row.profile_name, `${label} : nom effacé`).toBeNull();
      expect(row.email_used, `${label} : adresse effacée`).toBeNull();
    }
    for (const id of [scheduledExec, waitingExec, pausedExec]) {
      const e = await exec(id);
      expect(e.status, 'étape en attente annulée').toBe('cancelled');
      expect(e.skip_reason).toBe(GDPR_ERASURE_SKIP_REASON);
    }
    expect((await exec(sendingExec)).status, 'étape en cours d’envoi : statut jamais touché').toBe('sending');
    for (const id of [sentExec, scheduledExec, sendingExec, completedExec]) {
      expect((await exec(id)).final_message, 'texte effacé').toBeNull();
    }
    expect((await exec(sentExec)).status).toBe('sent');
    const { data: inmailRows } = await admin().from('inmail_queue').select('id, status, organization_id').in('id', inmails.map((i) => i.id));
    expect(inmailRows?.find((i) => i.organization_id === org.orgId)?.status).toBe('cancelled');
    expect(inmailRows?.find((i) => i.organization_id === other.orgId)?.status, 'InMail de l’autre organisation intact').toBe('scheduled');
    const { data: suppressed } = await admin().from('suppressed_emails').select('reason').eq('email', email);
    expect(suppressed).toEqual([{ reason: 'unsubscribe' }]);
    const { data: enrich } = await admin().from('candidate_enrichments').select('organization_id').eq('linkedin_url', url);
    expect(enrich, 'enrichissement supprimé chez A seulement').toEqual([{ organization_id: other.orgId }]);

    // Autre organisation : rien ne bouge.
    const otherRow = await enr(otherEnr.enrollmentId);
    expect(otherRow.status).toBe('active');
    expect(otherRow.profile_name).toBe('Camille Martin');
    expect(otherRow.email_used).toBe(email);
    expect(otherRow.tracking_data?.gdpr_erased_at).toBeUndefined();
    const oe = await exec(otherExec);
    expect(oe.status).toBe('scheduled');
    expect(oe.final_message).toBe('Relance B');

    // Rejeu : le marqueur garde sa première date.
    const replay = await rgpdErase(token, { linkedin_url: url, email, organization_id: org.orgId });
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body.stopped_enrollments).toBe(0);
    for (const [id, marker] of markers) expect((await enr(id)).tracking_data?.gdpr_erased_at, 'date du marqueur conservée').toBe(marker);

    // Adresse jamais utilisée par l'organisation : pas de blocage global.
    const foreignEmail = `jamais.${rand()}@e2e.konekt.test`;
    cleanups.push(() => admin().from('suppressed_emails').delete().eq('email', foreignEmail));
    const foreign = await rgpdErase(token, { linkedin_url: `https://www.linkedin.com/in/inconnu-${rand()}`, email: foreignEmail, organization_id: org.orgId });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(200);
    expect(foreign.body.email_suppressed).toBe(false);
    const { data: notSuppressed } = await admin().from('suppressed_emails').select('id').eq('email', foreignEmail);
    expect(notSuppressed).toEqual([]);
  });

  // rgpd-jamais-repris (SEQ-054, D5)
  test('@critical D5 : une inscription effacée n’est jamais reprise ni relancée (reprise, relance, par séquence, reconnexion, souscription)', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound RGPD D5');
    const url = `https://www.linkedin.com/in/camille-e2e-${rand()}`;
    const profileId = `ACoAAE2ED5${rand()}${rand()}`;
    const base = { profile_id: profileId, profile_url: url };
    const seqs: Array<{ sequenceId: string; steps: SeededStep[] }> = [];
    for (let i = 0; i < 5; i++) seqs.push(await messageSequence(org, org.owner.userId, [`Bonjour ${i}`, `Relance ${i}`]));
    const pausedManual = await enroll(org, seqs[0].sequenceId, org.owner.userId, accountId, { ...base, status: 'paused', pause_reason: 'manual' });
    const pausedDisconnected = await enroll(org, seqs[1].sequenceId, org.owner.userId, accountId, { ...base, status: 'paused', pause_reason: 'account_disconnected' });
    const pausedSubscription = await enroll(org, seqs[2].sequenceId, org.owner.userId, accountId, { ...base, status: 'paused', pause_reason: 'subscription_required' });
    const replied = await enroll(org, seqs[3].sequenceId, org.owner.userId, accountId, { ...base, status: 'replied', replied_at: minutesFromNow(-DAY) });
    const active = await enroll(org, seqs[4].sequenceId, org.owner.userId, accountId, base);
    const all = [pausedManual, pausedDisconnected, pausedSubscription, replied, active].map((e) => e.enrollmentId);
    await schedule(org, pausedManual.enrollmentId, seqs[0].steps[0], { scheduled_at: minutesFromNow(DAY) });
    await schedule(org, pausedDisconnected.enrollmentId, seqs[1].steps[0], { status: 'cancelled', skip_reason: ACCOUNT_DISCONNECTED_SKIP_REASON, scheduled_at: minutesFromNow(-5) });
    await schedule(org, pausedSubscription.enrollmentId, seqs[2].steps[0], { status: 'cancelled', skip_reason: SUBSCRIPTION_REQUIRED_REASON, scheduled_at: minutesFromNow(-5) });
    await schedule(org, replied.enrollmentId, seqs[3].steps[0], { status: 'sent', scheduled_at: minutesFromNow(-2 * DAY), executed_at: minutesFromNow(-2 * DAY) });
    await schedule(org, active.enrollmentId, seqs[4].steps[0], { scheduled_at: minutesFromNow(DAY) });

    const token = await ownerToken(org);
    const erase = await rgpdErase(token, { linkedin_url: url, organization_id: org.orgId });
    expect(erase.status, JSON.stringify(erase.body)).toBe(200);
    expect(erase.body.stopped_enrollments).toBe(4);
    const statusesAfterErase = new Map<string, string>();
    for (const id of all) statusesAfterErase.set(id, (await enr(id)).status);
    expect([...statusesAfterErase.values()].sort()).toEqual(['replied', 'stopped', 'stopped', 'stopped', 'stopped']);

    for (const action of ['resume_enrollments', 're_enroll']) {
      const res = await engine(token, { action, organization_id: org.orgId, enrollment_ids: all });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const results = res.body.results as Array<{ enrollment_id: string; outcome: string; message?: string }>;
      expect(results).toHaveLength(all.length);
      for (const r of results) {
        expect(r.outcome, `${action} ${r.enrollment_id}`).toBe('error');
        expect(r.message, `${action} ${r.enrollment_id}`).toBe(GDPR_MESSAGE);
      }
    }
    const bySequence = await engine(token, {
      action: 'resume_enrollments', organization_id: org.orgId, sequence_id: seqs[0].sequenceId,
      pause_reasons: ['manual', 'account_disconnected', 'subscription_required'],
    });
    expect(bySequence.status, JSON.stringify(bySequence.body)).toBe(200);
    expect((bySequence.body.counts as Record<string, number>).resumed).toBe(0);

    await webhook({ AccountStatus: { account_id: accountId, account_type: 'LINKEDIN', message: 'OK' } });
    const stripe = await checkoutCompleted(org.orgId);
    expect(stripe.status, JSON.stringify(stripe.body)).toBe(200);

    for (const id of all) expect((await enr(id)).status, `statut inchangé ${id}`).toBe(statusesAfterErase.get(id));
    for (const id of all) {
      const pending = (await executionsOf(id)).filter((e) => ['scheduled', 'waiting_event', 'quota_blocked', 'sending'].includes(e.status));
      expect(pending, `aucune étape réarmée pour ${id}`).toEqual([]);
    }
    await runCycle();
    expect(await sentTexts(accountId), 'aucun message au candidat effacé').toEqual([]);
  });
});

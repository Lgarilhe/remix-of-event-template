/**
 * Lot « inbound-2 » du module séquences : événements entrants et contrôles de
 * fond. Connexion hosted_auth d'un compte LinkedIn (SEQ-041), réponse par
 * e-mail (SEQ-039), webhook historique des séquences, canaux fermés (D2),
 * rendez-vous Calendly (SEQ-008, SEQ-112), Stripe (signature, reprise, gate
 * du moteur), effacement RGPD (SEQ-055), check_replies et check_wait_events.
 *
 * Contrat : CLAUDE.md, section « Séquences : règles du moteur et de
 * l'interface », et docs/audit-2026-09-25-sequences.md (D1 à D6, registre).
 *
 * Les webhooks et le moteur tournent pour de vrai contre la stack locale
 * (e2e/local-stack) ; LinkedIn, Stripe et l'IA sont simulés par
 * vendor-mock.mjs, qui journalise chaque appel. Ignoré sans cette stack.
 *
 * Réponses scriptées par compte seulement (jamais la clé '*') : la lecture des
 * messages d'une conversation ne porte pas d'account_id, l'identifiant de
 * conversation renvoyé par le faux prestataire embarque donc
 * « ?account_id=<compte>&c= » (même procédé que seq-engine-1).
 */
import { test, expect } from '@playwright/test';
import { createHash, createHmac } from 'node:crypto';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedLinkedInAccount,
  seedMission,
  signIn,
  type SeededStep,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  WEBHOOK_SECRET,
  CRON_SECRET,
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
  sentTexts,
  setMockMode,
  webhook,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
// Série par bloc (un défaut connu n'empêche pas les autres blocs de tourner).
test.setTimeout(300_000);

// ─── Textes du contrat ──────────────────────────────────────────────────────
const ACCOUNT_DISCONNECTED_SKIP_REASON = 'Compte LinkedIn déconnecté, reprise automatique à la reconnexion';
const SUBSCRIPTION_REQUIRED_REASON = "Abonnement requis pour l'envoi de séquences";
const SIBLING_REPLY_SKIP_REASON = "Le candidat a répondu sur un autre compte de l'organisation";
const EMAIL_CLOSED = 'Étape e-mail pas encore disponible : étape sautée';
const WHATSAPP_CLOSED = 'Étape WhatsApp pas encore disponible : étape sautée';
const MEETING_SKIP_REASON = 'Rendez-vous pris : séquence arrêtée';
const CALENDLY_EVENT_NAME = '📅 20 min pour présentation poste - Equipe Konekt';
const STRIPE_SECRET = process.env.E2E_STRIPE_WEBHOOK_SECRET ?? '';
const CALENDLY_KEY = process.env.E2E_CALENDLY_SIGNING_KEY ?? '';
const SEQUENCE_WEBHOOK_SECRET = process.env.E2E_SEQUENCE_WEBHOOK_SECRET ?? '';
const DAY = 24 * 60;

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];
test.afterEach(async () => {
  while (cleanups.length) await Promise.resolve(cleanups.pop()!()).catch(() => undefined);
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    for (const table of [
      'job_candidate_status', 'notifications', 'inmail_queue', 'qualification_sessions',
      'organization_integrations', 'member_email_accounts', 'candidate_enrichments',
    ]) {
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
/** Membre de l'organisation avec son propre compte LinkedIn relié. */
async function memberWithAccount(org: TestOrg, role: 'member' | 'admin' | 'collaborator' = 'member') {
  const user = await addMember(org.orgId, role, 'inbound2');
  orgsToDelete.find((o) => o.org.orgId === org.orgId)?.extra.push(user);
  const accountId = await seedLinkedInAccount(org.orgId, user.userId, `acc_${rand()}`, 'OK');
  return { user, accountId };
}

// ─── Lectures ───────────────────────────────────────────────────────────────
type Enr = {
  id: string; status: string; pause_reason: string | null; connection_status: string | null;
  network_distance: string | null; last_check_at: string | null; replied_at: string | null;
  tracking_data: Record<string, unknown> | null; updated_at: string;
};
async function enr(id: string): Promise<Enr> {
  const { data, error } = await admin().from('sequence_enrollments')
    .select('id, status, pause_reason, connection_status, network_distance, last_check_at, replied_at, tracking_data, updated_at')
    .eq('id', id).single();
  if (error || !data) throw new Error(`enr ${id}: ${error?.message}`);
  return data as Enr;
}
type Exec = { id: string; status: string; scheduled_at: string; skip_reason: string | null; final_message: string | null; updated_at: string; step_order: number };
async function exec(id: string): Promise<Exec> {
  const { data, error } = await admin().from('sequence_step_executions')
    .select('id, status, scheduled_at, skip_reason, final_message, updated_at, step_order').eq('id', id).single();
  if (error || !data) throw new Error(`exec ${id}: ${error?.message}`);
  return data as Exec;
}
async function execsOf(enrollmentId: string): Promise<Exec[]> {
  const { data } = await admin().from('sequence_step_executions')
    .select('id, status, scheduled_at, skip_reason, final_message, updated_at, step_order')
    .eq('enrollment_id', enrollmentId).order('step_order').order('created_at');
  return (data ?? []) as Exec[];
}
async function rewind(execId: string) {
  await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', execId);
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
async function notificationsOf(orgId: string, type?: string) {
  let q = admin().from('notifications').select('id, user_id, type, title, body, metadata').eq('organization_id', orgId);
  if (type) q = q.eq('type', type);
  const { data } = await q;
  return (data ?? []) as Array<{ id: string; user_id: string; type: string; title: string; body: string | null; metadata: Record<string, unknown> | null }>;
}
async function linksOf(orgId: string, userId: string) {
  const { data } = await admin().from('member_linkedin_accounts')
    .select('linkedin_account_id, account_status, linked_by, failure_reason, linked_at, linkedin_account_name')
    .eq('organization_id', orgId).eq('user_id', userId);
  return (data ?? []) as Array<{
    linkedin_account_id: string; account_status: string | null; linked_by: string; failure_reason: string | null;
    linked_at: string; linkedin_account_name: string | null;
  }>;
}
async function inmailStatus(id: string) {
  const { data } = await admin().from('inmail_queue').select('status, error_message').eq('id', id).single();
  return data as { status: string; error_message: string | null };
}
async function subscriptionOf(orgId: string) {
  const { data } = await admin().from('organization_subscriptions')
    .select('plan_id, status, stripe_customer_id, stripe_subscription_id').eq('organization_id', orgId).maybeSingle();
  return data as { plan_id: string; status: string; stripe_customer_id: string | null; stripe_subscription_id: string | null } | null;
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
const ts = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

// ─── Seeds ──────────────────────────────────────────────────────────────────
type StepSpec = Record<string, unknown> & { action_type: string };
/** Séquence et étapes quelconques (canal, attente, objet…), active par défaut. */
async function insertSequence(org: TestOrg, createdBy: string, steps: StepSpec[], opts: { isActive?: boolean; projectId?: string } = {}) {
  const { data: seq, error } = await admin().from('outreach_sequences').insert({
    name: `Séquence inbound-2 ${rand()}`, organization_id: org.orgId, created_by: createdBy,
    is_active: opts.isActive ?? true, ...(opts.projectId ? { project_id: opts.projectId } : {}),
  }).select('id').single();
  if (error || !seq) throw new Error(`insertSequence: ${error?.message}`);
  const { data: inserted, error: stepErr } = await admin().from('sequence_steps').insert(steps.map((s, i) => ({
    sequence_id: seq.id, step_order: i, delay_days: 0, ...s,
  }))).select('id, step_order, action_type');
  if (stepErr || !inserted) throw new Error(`insertSequence(steps): ${stepErr?.message}`);
  return { sequenceId: seq.id as string, steps: (inserted as SeededStep[]).sort((a, b) => a.step_order - b.step_order) };
}
async function setIntegration(orgId: string, patch: Record<string, unknown>) {
  const { error } = await admin().from('organization_integrations')
    .upsert({ organization_id: orgId, ...patch }, { onConflict: 'organization_id' });
  if (error) throw new Error(`organization_integrations: ${error.message}`);
}
async function queueInmail(orgId: string, accountId: string, createdBy: string) {
  const { data, error } = await admin().from('inmail_queue').insert({
    account_id: accountId, recipient_profile_id: `ACoAAE2EIM${rand()}`, subject: 'Poste', message: 'Bonjour',
    status: 'scheduled', scheduled_at: minutesFromNow(2 * DAY), created_by: createdBy, organization_id: orgId,
  }).select('id').single();
  if (error || !data) throw new Error(`inmail_queue: ${error?.message}`);
  return data.id as string;
}

// ─── Appels ─────────────────────────────────────────────────────────────────
async function ownerToken(org: TestOrg) {
  return (await signIn(org.owner.email, org.owner.password)).access_token;
}
async function userToken(u: TestUser) {
  return (await signIn(u.email, u.password)).access_token;
}
async function rawPost(path: string, raw: string, headers: Record<string, string>) {
  const res = await fetch(`${E2E.supabaseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: raw });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
/**
 * Retour du parcours hosted_auth, tel que le prestataire l'envoie : pas
 * d'en-tête d'authentification, `name` = état signé par unipile-accounts
 * (hosted_sig = HMAC(secret du webhook, name)), statut CREATION_SUCCESS.
 */
function hostedCallback(userId: string, orgId: string, accountId: string, status: 'CREATION_SUCCESS' | 'RECONNECTED' = 'CREATION_SUCCESS') {
  const name = `user:${userId}|org:${orgId}|providers:LINKEDIN|expires:${Date.now() + 20 * 60_000}`;
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(name).digest('hex');
  return rawPost(`/functions/v1/unipile-webhook?hosted_sig=${sig}`, JSON.stringify({ status, account_id: accountId, name }), { apikey: E2E.anonKey });
}
/** Événement Stripe signé comme le fait Stripe (t=…,v1=HMAC(t.payload)). */
function stripeEvent(event: Record<string, unknown>, sign: { secret?: string; t?: number } = {}) {
  const raw = JSON.stringify(event);
  const t = sign.t ?? Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', sign.secret ?? STRIPE_SECRET).update(`${t}.${raw}`).digest('hex');
  return rawPost('/functions/v1/stripe-webhook', raw, { apikey: E2E.anonKey, 'stripe-signature': `t=${t},v1=${sig}` });
}
function checkoutEvent(orgId: string, o: { planId?: string; paymentStatus?: string } = {}) {
  const s = rand();
  return {
    id: `evt_e2e_${s}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_e2e_${s}`, object: 'checkout.session', mode: 'subscription', payment_status: o.paymentStatus ?? 'paid',
        subscription: `sub_e2e_${s}`, customer: `cus_e2e_${s}`, client_reference_id: orgId,
        metadata: { organization_id: orgId, plan_id: o.planId ?? 'cabinet' },
      },
    },
  };
}
/** Rendez-vous Calendly signé (t=…,v1=HMAC(t.body)). */
function calendlyBooking(linkedinUrl: string, eventId: string, eventName = CALENDLY_EVENT_NAME) {
  const body = {
    event: 'invitee.created',
    payload: {
      uri: `https://api.calendly.com/scheduled_events/${eventId}/invitees/inv_${rand()}`,
      email: `camille.${rand()}@e2e.konekt.test`,
      name: 'Camille Martin',
      questions_and_answers: [{ question: 'Votre profil LinkedIn', answer: linkedinUrl }],
      scheduled_event: {
        uri: `https://api.calendly.com/scheduled_events/${eventId}`,
        name: eventName,
        start_time: minutesFromNow(2 * DAY),
        end_time: minutesFromNow(2 * DAY + 20),
      },
    },
  };
  const raw = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', CALENDLY_KEY).update(`${t}.${raw}`).digest('hex');
  return rawPost('/functions/v1/calendly-webhook', raw, { apikey: E2E.anonKey, 'Calendly-Webhook-Signature': `t=${t},v1=${sig}` });
}
const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
function rgpdErase(token: string, body: Record<string, unknown>, ip = randomIp()) {
  // Adresse IP propre à l'appel : la limite de 30 demandes par heure et par IP
  // est partagée avec les autres suites.
  return postJson('/functions/v1/rgpd-erase-contact', body, { Authorization: `Bearer ${token}`, 'x-forwarded-for': ip });
}
/** E-mail reçu sur une boîte connectée (format Unipile mail_received). */
function mailReceived(accountId: string, from: string, o: { inReplyTo?: unknown; subject?: string; emailId?: string } = {}) {
  return {
    event: 'mail_received',
    account_id: accountId,
    email_id: o.emailId ?? `mail_${rand()}`,
    subject: o.subject ?? 'Re: Une mission pour vous',
    from_attendee: { display_name: 'Camille Martin', identifier: from },
    to_attendees: [{ display_name: 'Recruteur', identifier: `recruteur.${rand()}@e2e.konekt.test` }],
    ...(o.inReplyTo !== undefined ? { in_reply_to: o.inReplyTo } : {}),
  };
}
/** Conversation du faux prestataire dont la lecture des messages porte l'account_id. */
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
/** Le candidat a répondu à `at` : conversation et message scriptés sur ce compte. */
async function scriptReply(accountId: string, at: string) {
  const chat = replyChat(accountId);
  await setMockMode(accountId, { routes: [chatListRoute(chat.id), { method: 'GET', path: chat.path, body: candidateReply(at) }] });
  cleanups.push(() => setMockMode(accountId, {}));
}

/**
 * check_replies ne regarde que 20 inscriptions par passage (les moins
 * récemment contrôlées d'abord) et se limite à un passage toutes les 4 h :
 * la marque est effacée avant chaque appel, jusqu'à ce que nos inscriptions
 * aient été examinées. Renvoie les totaux des passages.
 */
async function checkRepliesUntilExamined(...enrollmentIds: string[]): Promise<Record<string, number>> {
  const totals = { repliesDetected: 0, checkFailed: 0, skippedTooRecent: 0, passes: 0 };
  for (let i = 0; i < 8; i++) {
    await admin().from('internal_config').delete().eq('key', 'last_check_replies');
    const last = await runEngine({ action: 'check_replies' });
    totals.passes++;
    totals.repliesDetected += Number(last.repliesDetected ?? 0);
    totals.checkFailed += Number(last.checkFailed ?? 0);
    totals.skippedTooRecent += Number(last.skippedTooRecent ?? 0);
    const { data } = await admin().from('sequence_enrollments').select('id, last_check_at').in('id', enrollmentIds);
    if (((data ?? []) as Array<{ last_check_at: string | null }>).every((r) => !!r.last_check_at)) break;
  }
  return totals;
}
async function withInternalConfig(key: string, run: () => Promise<void>) {
  const { data: before } = await admin().from('internal_config').select('value').eq('key', key).maybeSingle();
  try {
    await run();
  } finally {
    if (before) await admin().from('internal_config').upsert({ key, value: before.value }, { onConflict: 'key' });
    else await admin().from('internal_config').delete().eq('key', key);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Connexion hosted_auth d'un compte LinkedIn (SEQ-041)
// ════════════════════════════════════════════════════════════════════════════
test.describe('Connexion hosted_auth', () => {
  test.describe.configure({ mode: 'serial' });
  // hosted-auth-rattachement (SEQ-041)
  test('un nouveau compte connecté par hosted_auth est rattaché au membre ; l’ancien compte cesse d’envoyer avant le repointage et linked_at repart de zéro', async () => {
    const { org } = await trackedSendingOrg('E2E inbound2 hosted');
    const { user: member, accountId: oldAccount } = await memberWithAccount(org);
    const oldLinkedAt = minutesFromNow(-30 * DAY);
    await admin().from('member_linkedin_accounts').update({
      linked_at: oldLinkedAt, failure_reason: 'ancienne erreur', account_status: 'CREDENTIALS', linked_by: org.owner.userId,
    }).eq('linkedin_account_id', oldAccount);
    const newAccount = `acc_new_${rand()}`;

    const seq = await insertSequence(org, member.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance ancien compte', delay_days: 2 },
    ]);
    const a = await enroll(org, seq.sequenceId, member.userId, oldAccount, { current_step_order: 1 });
    const b = await enroll(org, seq.sequenceId, member.userId, oldAccount, { current_step_order: 1 });
    const autoPaused = await enroll(org, seq.sequenceId, member.userId, oldAccount, { status: 'paused', pause_reason: 'account_disconnected' });
    const inmailId = await queueInmail(org.orgId, oldAccount, member.userId);
    const autoPausedExec = await schedule(org, autoPaused.enrollmentId, seq.steps[1], {
      status: 'cancelled', skip_reason: ACCOUNT_DISCONNECTED_SKIP_REASON, scheduled_at: minutesFromNow(-5),
    });
    // Exécutions échues insérées en dernier.
    const dueA = minutesFromNow(-2);
    const dueB = minutesFromNow(-3);
    const execA = await schedule(org, a.enrollmentId, seq.steps[1], { scheduled_at: dueA });
    const execB = await schedule(org, b.enrollmentId, seq.steps[1], { scheduled_at: dueB });
    const before = Date.now();

    const res = await hostedCallback(member.userId, org.orgId, newAccount);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const links = await linksOf(org.orgId, member.userId);
    expect(links, 'une seule liaison pour le membre').toHaveLength(1);
    expect(links[0].linkedin_account_id, 'liaison repointée sur le nouveau compte').toBe(newAccount);
    expect(links[0].account_status).toBe('OK');
    expect(links[0].linked_by, 'linked_by = le membre qui a lancé la connexion').toBe(member.userId);
    expect(links[0].failure_reason).toBeNull();
    expect(ts(links[0].linked_at), 'linked_at repart de zéro (montée en charge)').toBeGreaterThanOrEqual(before - 5_000);

    for (const [label, id, execId, due] of [['A', a.enrollmentId, execA, dueA], ['B', b.enrollmentId, execB, dueB]] as const) {
      const row = await enr(id);
      expect(row.status, `${label} : ancien compte, inscription en pause`).toBe('paused');
      expect(row.pause_reason, `${label} : pause manuelle`).toBe('manual');
      const e = await exec(execId);
      expect(e.status, `${label} : étape gardée`).toBe('scheduled');
      expect(ts(e.scheduled_at), `${label} : étape gardée à sa date`).toBe(ts(due));
    }
    const ap = await enr(autoPaused.enrollmentId);
    expect(ap.status).toBe('paused');
    expect(ap.pause_reason, 'pause automatique repassée en manuelle (aucune reprise automatique)').toBe('manual');
    expect((await exec(autoPausedExec)).status).toBe('cancelled');
    const im = await inmailStatus(inmailId);
    expect(im.status, 'InMail programmé depuis l’ancien compte annulé').toBe('cancelled');
    expect(await notificationsOf(org.orgId, 'error'), 'aucune notification d’échec').toEqual([]);

    await runCycle();
    expect(await sentTexts(oldAccount), 'rien ne part de l’ancien compte').toEqual([]);
    expect(await sentTexts(newAccount), 'rien ne part non plus du nouveau compte').toEqual([]);

    // Reconnexion du même compte : l'ancienneté de la liaison est gardée.
    const linkedAt = (await linksOf(org.orgId, member.userId))[0].linked_at;
    const again = await hostedCallback(member.userId, org.orgId, newAccount, 'RECONNECTED');
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    const after = await linksOf(org.orgId, member.userId);
    expect(after).toHaveLength(1);
    expect(after[0].linkedin_account_id).toBe(newAccount);
    expect(ts(after[0].linked_at), 'reconnexion du même compte : linked_at inchangé').toBe(ts(linkedAt));
  });

  // hosted-auth-refus-propriete (compte d'un autre membre)
  test('hosted_auth refusé pour un compte déjà relié à un autre membre : notification, ancien compte non arrêté, liaisons inchangées', async () => {
    const { org, accountId: ownerAccount } = await trackedSendingOrg('E2E inbound2 hosted membre');
    const { user: member, accountId: oldAccount } = await memberWithAccount(org);
    const seq = await insertSequence(org, member.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 2 },
    ]);
    const a = await enroll(org, seq.sequenceId, member.userId, oldAccount, { current_step_order: 1 });
    const inmailId = await queueInmail(org.orgId, oldAccount, member.userId);
    const later = minutesFromNow(2 * DAY);
    const execA = await schedule(org, a.enrollmentId, seq.steps[1], { scheduled_at: later });

    const res = await hostedCallback(member.userId, org.orgId, ownerAccount);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const notes = await notificationsOf(org.orgId, 'error');
    expect(notes, 'le membre est prévenu').toHaveLength(1);
    expect(notes[0].user_id).toBe(member.userId);
    expect(notes[0].body).toBe('Ce compte LinkedIn est déjà rattaché à un autre membre de votre organisation.');
    const memberLinks = await linksOf(org.orgId, member.userId);
    expect(memberLinks.map((l) => l.linkedin_account_id), 'liaison du membre inchangée').toEqual([oldAccount]);
    const ownerLinks = await linksOf(org.orgId, org.owner.userId);
    expect(ownerLinks.map((l) => l.linkedin_account_id), 'liaison de l’autre membre inchangée').toEqual([ownerAccount]);
    expect((await enr(a.enrollmentId)).status, 'ancien compte non arrêté').toBe('active');
    expect((await exec(execA)).status).toBe('scheduled');
    expect((await inmailStatus(inmailId)).status, 'InMail gardé').toBe('scheduled');
  });

  // hosted-auth-refus-propriete (compte d'une autre organisation)
  // décision produit en attente : après un rattachement hosted_auth refusé, ignorer le signal « connecté » (rien repris chez le titulaire) ou le traiter comme une reconnexion de son compte (liaison OK puis reprise).
  test.fixme('hosted_auth refusé pour un compte relié à une autre organisation : notification, ancien compte non arrêté, et aucune inscription de l’autre organisation reprise', async () => {
    const { org } = await trackedSendingOrg('E2E inbound2 hosted org A');
    const { user: member, accountId: oldAccount } = await memberWithAccount(org);
    const other = track(await createOrg('agency', 'E2E inbound2 hosted org B'));
    const foreignAccount = await seedLinkedInAccount(other.orgId, other.owner.userId, `acc_${rand()}`, 'CREDENTIALS');

    const seqA = await insertSequence(org, member.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance A', delay_days: 2 },
    ]);
    const seqB = await insertSequence(other, other.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance B', delay_days: 2 },
    ]);
    const a = await enroll(org, seqA.sequenceId, member.userId, oldAccount, { current_step_order: 1 });
    const bPaused = await enroll(other, seqB.sequenceId, other.owner.userId, foreignAccount, { status: 'paused', pause_reason: 'account_disconnected', current_step_order: 1 });
    const inmailId = await queueInmail(org.orgId, oldAccount, member.userId);
    const later = minutesFromNow(2 * DAY);
    const execB = await schedule(other, bPaused.enrollmentId, seqB.steps[1], { status: 'cancelled', skip_reason: ACCOUNT_DISCONNECTED_SKIP_REASON, scheduled_at: later });
    const execA = await schedule(org, a.enrollmentId, seqA.steps[1], { scheduled_at: later });

    const res = await hostedCallback(member.userId, org.orgId, foreignAccount);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const notes = await notificationsOf(org.orgId, 'error');
    expect(notes, 'le membre est prévenu').toHaveLength(1);
    expect(notes[0].user_id).toBe(member.userId);
    expect(notes[0].body).toBe('Ce compte LinkedIn est déjà rattaché à un autre espace de travail.');
    expect((await linksOf(org.orgId, member.userId)).map((l) => l.linkedin_account_id), 'liaison du membre inchangée').toEqual([oldAccount]);
    const foreignLinks = await linksOf(other.orgId, other.owner.userId);
    expect(foreignLinks.map((l) => [l.linkedin_account_id, l.account_status]), 'liaison de l’autre organisation inchangée').toEqual([[foreignAccount, 'CREDENTIALS']]);
    expect((await enr(a.enrollmentId)).status, 'ancien compte non arrêté').toBe('active');
    expect((await exec(execA)).status).toBe('scheduled');
    expect((await inmailStatus(inmailId)).status).toBe('scheduled');
    expect(await notificationsOf(other.orgId), 'rien chez l’autre organisation').toEqual([]);

    // DÉFAUT hosted-auth-refus-reprend-autre-org : après le refus, resumeEnrollmentsAfterReconnect(account_id) reprend quand même les pauses « compte déconnecté » de l'autre organisation.
    const b = await enr(bPaused.enrollmentId);
    expect({ status: b.status, pause_reason: b.pause_reason }, 'inscription de l’autre organisation jamais reprise').toEqual({ status: 'paused', pause_reason: 'account_disconnected' });
    expect((await exec(execB)).status, 'étape de l’autre organisation jamais réarmée').toBe('cancelled');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Réponse par e-mail (SEQ-039)
// ════════════════════════════════════════════════════════════════════════════
test.describe('Réponse par e-mail', () => {
  test.describe.configure({ mode: 'serial' });
  // mail-reponse-rattachement (SEQ-039, SEQ-211, SEQ-212, SEQ-115, SEQ-191)
  test('une réponse e-mail clôt l’inscription par in_reply_to, sinon par adresse (casse ignorée, jokers échappés), toujours dans l’organisation de la boîte ; boîte inconnue : repli sur le compte', async () => {
    const { org, accountId: ownerAccount } = await trackedSendingOrg('E2E inbound2 mail A');
    const { accountId: memberAccount, user: member } = await memberWithAccount(org);
    const { org: other, accountId: otherAccount } = await trackedSendingOrg('E2E inbound2 mail B');
    const r = rand();
    const mailbox = `mbx_${r}`;
    const { error: mbxErr } = await admin().from('member_email_accounts').insert({
      organization_id: org.orgId, user_id: org.owner.userId, email_account_id: mailbox, email_address: `recruteur.${r}@e2e.konekt.test`,
      provider: 'GOOGLE', account_status: 'OK', linked_by: org.owner.userId,
    });
    if (mbxErr) throw new Error(mbxErr.message);
    const domain = `e2e-mail-${r}.test`;
    const addrA1 = `C_1.${r}@${domain.toUpperCase()}`;
    const replyFromOther = `autre.${r}@${domain}`;
    const emailSeq = [
      { action_type: 'email', subject_template: 'Une mission', message_template: 'Bonjour par e-mail' },
      { action_type: 'message', message_template: 'Relance', delay_days: 2 },
      { action_type: 'message', message_template: 'Relance 2', delay_days: 2 },
    ];

    // 1. in_reply_to suivi, réponse envoyée depuis une autre adresse.
    const seqA1 = await insertSequence(org, org.owner.userId, emailSeq);
    const profileA1 = `ACoAAE2EMAIL${rand()}${rand()}`;
    const a1 = await enroll(org, seqA1.sequenceId, org.owner.userId, ownerAccount, { profile_id: profileA1, email_used: addrA1, current_step_order: 1 });
    const seqSibling = await insertSequence(org, member.userId, emailSeq);
    const sibling = await enroll(org, seqSibling.sequenceId, member.userId, memberAccount, { profile_id: profileA1 });
    const seqB = await insertSequence(other, other.owner.userId, emailSeq);
    const b1 = await enroll(other, seqB.sequenceId, other.owner.userId, otherAccount, { email_used: addrA1.toLowerCase(), current_step_order: 1 });
    const b1Other = await enroll(other, seqB.sequenceId, other.owner.userId, otherAccount, { email_used: replyFromOther, current_step_order: 1 });
    const jcsA1 = await jcs(org.orgId, org.owner.userId, profileA1);
    const messageId = `<m1.${r}@e2e.konekt.test>`;
    const sentA1 = await schedule(org, a1.enrollmentId, seqA1.steps[0], { status: 'sent', scheduled_at: minutesFromNow(-DAY), executed_at: minutesFromNow(-DAY) });
    const { error: trErr } = await admin().from('sequence_email_tracking').insert({ execution_id: sentA1, tracking_id: `trk_${r}`, email_message_id: messageId });
    if (trErr) throw new Error(trErr.message);
    const later = minutesFromNow(2 * DAY);
    const followA1 = await schedule(org, a1.enrollmentId, seqA1.steps[1], { scheduled_at: later });
    const waitA1 = await schedule(org, a1.enrollmentId, seqA1.steps[2], { status: 'quota_blocked', scheduled_at: later });
    const siblingExec = await schedule(org, sibling.enrollmentId, seqSibling.steps[1], { scheduled_at: later });
    const followB1 = await schedule(other, b1.enrollmentId, seqB.steps[1], { scheduled_at: later });
    const followB1Other = await schedule(other, b1Other.enrollmentId, seqB.steps[1], { scheduled_at: later });

    const firstMail = mailReceived(mailbox, replyFromOther, { inReplyTo: { message_id: messageId.slice(1, -1) } });
    await webhook(firstMail);

    const rowA1 = await enr(a1.enrollmentId);
    expect(rowA1.status, 'réponse rattachée par in_reply_to').toBe('replied');
    expect(rowA1.replied_at).not.toBeNull();
    for (const id of [followA1, waitA1]) {
      const e = await exec(id);
      expect(e.status, 'étape en attente annulée').toBe('cancelled');
      expect(e.skip_reason).toBe('Email reply detected via webhook');
    }
    expect(await jcsRow(jcsA1), 'pipeline « Répondu » (SEQ-211)').toEqual({ status: 'replied', pipeline_stage: 'Répondu' });
    expect((await enr(sibling.enrollmentId)).status, 'même candidat sur un autre compte : arrêté (SEQ-212)').toBe('stopped');
    const se = await exec(siblingExec);
    expect(se.status).toBe('cancelled');
    expect(se.skip_reason).toBe(SIBLING_REPLY_SKIP_REASON);
    const notes = await notificationsOf(org.orgId, 'new_message');
    expect(notes, 'le recruteur est prévenu (SEQ-115)').toHaveLength(1);
    expect(notes[0].user_id).toBe(org.owner.userId);
    expect(notes[0].metadata?.channel).toBe('email');
    expect(notes[0].metadata?.enrollment_id).toBe(a1.enrollmentId);
    expect((await analytics(seqA1.sequenceId)).replies).toBe(1);
    for (const [label, id, execId] of [['même adresse', b1.enrollmentId, followB1], ['adresse de l’expéditeur', b1Other.enrollmentId, followB1Other]] as const) {
      expect((await enr(id)).status, `autre organisation (${label}) : intacte`).toBe('active');
      expect((await exec(execId)).status).toBe('scheduled');
    }

    // Réponse comptée une fois : même événement rejoué, puis second e-mail.
    const replay = await webhook(firstMail);
    expect(replay).toEqual({ ok: true, deduplicated: true });
    await webhook(mailReceived(mailbox, addrA1.toLowerCase(), { inReplyTo: messageId }));
    expect((await analytics(seqA1.sequenceId)).replies, 'réponse comptée une seule fois (SEQ-191)').toBe(1);
    expect(await notificationsOf(org.orgId, 'new_message')).toHaveLength(1);
    expect((await enr(b1.enrollmentId)).status, 'second e-mail : autre organisation toujours intacte').toBe('active');

    // 2. Repli par adresse : casse ignorée, organisation de la boîte seulement.
    const addrA2 = `Camille.Deux.${r}@${domain}`;
    const seqA2 = await insertSequence(org, org.owner.userId, emailSeq);
    const a2 = await enroll(org, seqA2.sequenceId, org.owner.userId, ownerAccount, { email_used: addrA2, current_step_order: 1 });
    const b2 = await enroll(other, seqB.sequenceId, other.owner.userId, otherAccount, { email_used: addrA2.toLowerCase(), current_step_order: 1 });
    const followA2 = await schedule(org, a2.enrollmentId, seqA2.steps[1], { scheduled_at: later });
    const followB2 = await schedule(other, b2.enrollmentId, seqB.steps[1], { scheduled_at: later });
    await webhook(mailReceived(mailbox, addrA2.toUpperCase()));
    expect((await enr(a2.enrollmentId)).status, 'repli par adresse, casse ignorée').toBe('replied');
    expect((await exec(followA2)).status).toBe('cancelled');
    expect((await enr(b2.enrollmentId)).status, 'même adresse dans une autre organisation : intacte').toBe('active');
    expect((await exec(followB2)).status).toBe('scheduled');

    // 3. Jokers SQL de l'adresse de l'expéditeur échappés.
    const a3 = await enroll(org, seqA2.sequenceId, org.owner.userId, ownerAccount, { email_used: `cx1.${r}@${domain}`, current_step_order: 1 });
    const a4 = await enroll(org, seqA2.sequenceId, org.owner.userId, ownerAccount, { email_used: `cab1.${r}@${domain}`, current_step_order: 1 });
    const followA3 = await schedule(org, a3.enrollmentId, seqA2.steps[1], { scheduled_at: later });
    const followA4 = await schedule(org, a4.enrollmentId, seqA2.steps[1], { scheduled_at: later });
    await webhook(mailReceived(mailbox, `c_1.${r}@${domain}`));
    await webhook(mailReceived(mailbox, `c%1.${r}@${domain}`));
    expect((await enr(a3.enrollmentId)).status, '« _ » n’est pas un joker').toBe('active');
    expect((await enr(a4.enrollmentId)).status, '« % » n’est pas un joker').toBe('active');
    expect((await exec(followA3)).status).toBe('scheduled');
    expect((await exec(followA4)).status).toBe('scheduled');

    // 4. Boîte inconnue : repli sur le compte d'inscription.
    const unknownMailbox = `mbx_inconnue_${r}`;
    const addr5 = `cinq.${r}@${domain}`;
    const a5 = await enroll(org, seqA2.sequenceId, org.owner.userId, unknownMailbox, { email_used: addr5, current_step_order: 1 });
    const b5 = await enroll(other, seqB.sequenceId, other.owner.userId, otherAccount, { email_used: addr5, current_step_order: 1 });
    const followA5 = await schedule(org, a5.enrollmentId, seqA2.steps[1], { scheduled_at: later });
    const followB5 = await schedule(other, b5.enrollmentId, seqB.steps[1], { scheduled_at: later });
    await webhook(mailReceived(unknownMailbox, addr5));
    expect((await enr(a5.enrollmentId)).status, 'boîte inconnue : inscription du compte qui reçoit').toBe('replied');
    expect((await exec(followA5)).status).toBe('cancelled');
    expect((await enr(b5.enrollmentId)).status, 'boîte inconnue : aucune inscription d’un autre compte').toBe('active');
    expect((await exec(followB5)).status).toBe('scheduled');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Webhook historique des séquences (SEQ-012)
// ════════════════════════════════════════════════════════════════════════════
test.describe('sequence-webhooks-handler', () => {
  test.describe.configure({ mode: 'serial' });
  // webhooks-handler-auth-ignores (SEQ-012)
  test('sequence-webhooks-handler refuse sans secret (401) et ignore message_received, new_relation et mail_received (200, aucune écriture)', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound2 handler');
    const r = rand();
    const email = `camille.${r}@e2e.konekt.test`;
    const seq = await insertSequence(org, org.owner.userId, [
      { action_type: 'email', subject_template: 'Une mission', message_template: 'Bonjour' },
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted' },
      { action_type: 'message', message_template: 'Relance', delay_days: 2 },
    ]);
    const { enrollmentId, profileId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { email_used: email, current_step_order: 1, connection_status: null });
    const sent = await schedule(org, enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: minutesFromNow(-DAY), executed_at: minutesFromNow(-DAY) });
    const messageId = `<h.${r}@e2e.konekt.test>`;
    await admin().from('sequence_email_tracking').insert({ execution_id: sent, tracking_id: `trk_h_${r}`, email_message_id: messageId });
    const waitAt = minutesFromNow(5 * DAY);
    const wait = await schedule(org, enrollmentId, seq.steps[1], { status: 'waiting_event', scheduled_at: waitAt });
    const relanceAt = minutesFromNow(2 * DAY);
    const relance = await schedule(org, enrollmentId, seq.steps[2], { scheduled_at: relanceAt });

    const payloads: Record<string, Record<string, unknown>> = {
      message_received: {
        event: 'message_received', account_id: accountId, chat_id: `chat_${r}`, message_id: `msg_${r}`,
        sender: { attendee_provider_id: profileId, attendee_id: 'att_candidate' }, message: 'Oui',
      },
      new_relation: { event: 'new_relation', account_id: accountId, user_provider_id: profileId, user_full_name: 'Camille Martin' },
      mail_received: {
        event: 'mail_received', account_id: accountId, email_id: `mail_${r}`, subject: 'Re: Une mission',
        from_attendee: { identifier: email }, to_attendees: [{ identifier: 'recruteur@e2e.konekt.test' }], in_reply_to: { message_id: messageId },
      },
    };
    const url = '/functions/v1/sequence-webhooks-handler';
    for (const [label, headers] of [
      ['sans en-tête', {}],
      ['secret faux', { 'x-webhook-secret': 'faux' }],
      ['secret du webhook LinkedIn', { 'x-webhook-secret': WEBHOOK_SECRET === SEQUENCE_WEBHOOK_SECRET ? 'faux' : WEBHOOK_SECRET }],
    ] as const) {
      const res = await postJson(url, payloads.message_received, headers as Record<string, string>);
      expect(res.status, `${label} : ${JSON.stringify(res.body)}`).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
    }
    for (const [event, payload] of Object.entries(payloads)) {
      const res = await postJson(url, payload, { 'x-webhook-secret': SEQUENCE_WEBHOOK_SECRET });
      expect(res.status, `${event} : ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body, `${event} : accusé de réception seulement`).toEqual({ received: true });
    }

    const row = await enr(enrollmentId);
    expect(row.status, 'rien n’est clos').toBe('active');
    expect(row.connection_status, 'connexion non consignée').toBeNull();
    expect(row.replied_at).toBeNull();
    const w = await exec(wait);
    expect(w.status, 'attente non réarmée').toBe('waiting_event');
    expect(ts(w.scheduled_at)).toBe(ts(waitAt));
    const rl = await exec(relance);
    expect(rl.status, 'relance gardée').toBe('scheduled');
    expect(ts(rl.scheduled_at)).toBe(ts(relanceAt));
    expect(await analytics(seq.sequenceId)).toEqual({ replies: 0, accepted: 0 });
    expect(await notificationsOf(org.orgId)).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Canaux e-mail et WhatsApp fermés (D2)
// ════════════════════════════════════════════════════════════════════════════
test.describe('Canaux fermés (D2)', () => {
  test.describe.configure({ mode: 'serial' });
  // canal-email-whatsapp-ferme (SEQ-067, D2)
  test('D2 : une étape e-mail ou WhatsApp échue est sautée sans aucun appel, l’inscription reste ouverte et l’étape LinkedIn suivante part', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound2 canaux');
    const start = new Date().toISOString();
    const cases = [
      { label: 'e-mail', first: { action_type: 'email', subject_template: 'Une mission', message_template: 'Bonjour par e-mail' }, reason: EMAIL_CLOSED, text: 'Bonjour après e-mail' },
      { label: 'WhatsApp', first: { action_type: 'whatsapp_message', message_template: 'Bonjour WhatsApp' }, reason: WHATSAPP_CLOSED, text: 'Bonjour après WhatsApp' },
      { label: 'message au canal e-mail', first: { action_type: 'message', step_channel: 'email', subject_template: 'Objet', message_template: 'Canal e-mail' }, reason: EMAIL_CLOSED, text: 'Bonjour après canal e-mail' },
    ];
    const seeded: Array<{ label: string; reason: string; text: string; enrollmentId: string; execId: string; firstStep: SeededStep }> = [];
    for (const c of cases) {
      const seq = await insertSequence(org, org.owner.userId, [c.first, { action_type: 'message', message_template: c.text }]);
      const { enrollmentId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId, {
        email_used: `camille.${rand()}@e2e.konekt.test`, phone_used: '+33612345678',
      });
      seeded.push({ label: c.label, reason: c.reason, text: c.text, enrollmentId, execId: '', firstStep: seq.steps[0] });
    }
    // Exécutions échues insérées en dernier.
    for (const s of seeded) s.execId = await schedule(org, s.enrollmentId, s.firstStep);

    await runCycle();

    for (const s of seeded) {
      const e = await exec(s.execId);
      expect(e.status, `${s.label} : étape sautée`).toBe('skipped');
      expect(e.skip_reason, `${s.label} : motif canal fermé`).toBe(s.reason);
      const row = await enr(s.enrollmentId);
      expect(row.status, `${s.label} : inscription non close`).toBe('active');
      const next = (await execsOf(s.enrollmentId)).filter((x) => x.step_order === 1);
      expect(next.map((x) => x.status), `${s.label} : étape LinkedIn suivante planifiée`).toEqual(['scheduled']);
    }
    expect(await mockCalls(accountId), 'aucun appel au prestataire pour une étape de canal fermé').toEqual([]);
    const { data: tracking } = await admin().from('sequence_email_tracking').select('id').in('execution_id', seeded.map((s) => s.execId));
    expect(tracking ?? [], 'aucun appel à l’envoi d’e-mail').toEqual([]);
    const emailCalls = (await mockCalls()).filter((c) => c.at >= start && (/\/emails?(\/|$)/.test(c.path) || /whatsapp/i.test(c.path)));
    expect(emailCalls, 'aucun envoi e-mail ni WhatsApp chez un prestataire').toEqual([]);

    for (const s of seeded) {
      const next = (await execsOf(s.enrollmentId)).find((x) => x.step_order === 1)!;
      await rewind(next.id);
    }
    await runCycle();
    expect((await sentTexts(accountId)).sort(), 'les étapes LinkedIn suivantes partent').toEqual(seeded.map((s) => s.text).sort());
    for (const s of seeded) expect((await enr(s.enrollmentId)).status).not.toBe('stopped');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rendez-vous Calendly (SEQ-008, SEQ-112)
// ════════════════════════════════════════════════════════════════════════════
test.describe('Rendez-vous Calendly', () => {
  test.describe.configure({ mode: 'serial' });
  async function sessionsFor(eventId: string) {
    const { data } = await admin().from('qualification_sessions').select('id, organization_id').eq('calendly_event_id', eventId);
    return (data ?? []) as Array<{ id: string; organization_id: string | null }>;
  }

  // calendly-arret-rdv (SEQ-008, SEQ-112, SEQ-115)
  test('un rendez-vous d’un candidat reconnu clôt ses inscriptions actives et en pause (completed, meeting_booked), annule leurs étapes et prévient le recruteur', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound2 Calendly');
    await setIntegration(org.orgId, { calendly_connected: true });
    const slug = `camille-e2e-${rand()}`;
    const url = `https://www.linkedin.com/in/${slug}`;
    const profileId = `ACoAAE2ECAL${rand()}${rand()}`;
    const jcsId = await jcs(org.orgId, org.owner.userId, profileId, { linkedin_profile_url: url });
    const seqs: Array<{ sequenceId: string; steps: SeededStep[] }> = [];
    for (let i = 0; i < 4; i++) seqs.push(await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: `Relance ${i}`, delay_days: 2 },
      { action_type: 'wait_reply', wait_for_event: 'reply_received' },
    ]));
    const active = await enroll(org, seqs[0].sequenceId, org.owner.userId, accountId, { profile_id: profileId, current_step_order: 1 });
    const paused = await enroll(org, seqs[1].sequenceId, org.owner.userId, accountId, { profile_id: profileId, status: 'paused', pause_reason: 'manual', current_step_order: 1 });
    // Même candidat, inscrit par son URL (identifiant différent, « / » final).
    const byUrl = await enroll(org, seqs[2].sequenceId, org.owner.userId, accountId, { profile_id: `ACoAAE2EURL${rand()}`, profile_url: `${url}/`, current_step_order: 1 });
    const replied = await enroll(org, seqs[3].sequenceId, org.owner.userId, accountId, { profile_id: profileId, status: 'replied', replied_at: minutesFromNow(-DAY) });
    const later = minutesFromNow(2 * DAY);
    const execActive = await schedule(org, active.enrollmentId, seqs[0].steps[1], { scheduled_at: later });
    const execActiveWait = await schedule(org, active.enrollmentId, seqs[0].steps[2], { status: 'waiting_event', scheduled_at: later });
    const execPaused = await schedule(org, paused.enrollmentId, seqs[1].steps[1], { scheduled_at: later });
    const execByUrl = await schedule(org, byUrl.enrollmentId, seqs[2].steps[1], { status: 'quota_blocked', scheduled_at: later });

    const eventId = `evt_e2e_${rand()}`;
    const res = await calendlyBooking(url, eventId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.sequences_stopped, 'trois inscriptions ouvertes closes').toBe(3);
    expect(res.body.sequences_stop_skipped).toBeUndefined();

    const sessions = await sessionsFor(eventId);
    expect(sessions, 'session de qualification créée').toHaveLength(1);
    expect(sessions[0].organization_id).toBe(org.orgId);
    expect(await jcsRow(jcsId)).toEqual({ status: 'qualification', pipeline_stage: 'Pré-qualif' });
    for (const [label, id] of [['active', active.enrollmentId], ['en pause', paused.enrollmentId], ['par URL', byUrl.enrollmentId]] as const) {
      const row = await enr(id);
      expect(row.status, `${label} : close`).toBe('completed');
      expect(row.pause_reason, `${label} : sans raison de pause`).toBeNull();
      expect(row.tracking_data?.completion_reason, `${label} : raison dans tracking_data (SEQ-112)`).toBe('meeting_booked');
      expect(typeof row.tracking_data?.meeting_booked_at, `${label} : date du rendez-vous`).toBe('string');
      expect(row.tracking_data?.qualification_session_id).toBe(sessions[0].id);
    }
    for (const id of [execActive, execActiveWait, execPaused, execByUrl]) {
      const e = await exec(id);
      expect(e.status, 'étape en attente annulée').toBe('cancelled');
      expect(e.skip_reason).toBe(MEETING_SKIP_REASON);
    }
    expect((await enr(replied.enrollmentId)).status, 'inscription déjà close : inchangée').toBe('replied');
    const notes = await notificationsOf(org.orgId, 'action');
    expect(notes, 'le recruteur est prévenu (SEQ-115)').toHaveLength(1);
    expect(notes[0].user_id).toBe(org.owner.userId);
    expect((notes[0].metadata?.enrollment_ids as string[]).sort()).toEqual([active.enrollmentId, paused.enrollmentId, byUrl.enrollmentId].sort());

    await runCycle();
    expect(await sentTexts(accountId), 'aucune relance après le rendez-vous').toEqual([]);
  });

  // calendly-correspondance-exacte (SEQ-008)
  test('Calendly ne rapproche que par URL exacte : slug préfixe 422 sans arrêt, plus de 5 inscriptions aucun arrêt, autre type d’événement ignoré', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound2 Calendly exact');
    await setIntegration(org.orgId, { calendly_connected: true });
    const base = `camille-e2e-${rand()}`;
    const fullUrl = `https://www.linkedin.com/in/${base}-4b2a1`;
    const profileId = `ACoAAE2EEXA${rand()}${rand()}`;
    const jcsId = await jcs(org.orgId, org.owner.userId, profileId, { linkedin_profile_url: fullUrl });
    const seq = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 2 },
    ]);
    const main = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { profile_id: profileId, profile_url: fullUrl, current_step_order: 1 });
    const later = minutesFromNow(2 * DAY);
    const mainExec = await schedule(org, main.enrollmentId, seq.steps[1], { scheduled_at: later });

    // Slug préfixe : aucun candidat reconnu.
    const prefixEvent = `evt_e2e_${rand()}`;
    const prefix = await calendlyBooking(`https://www.linkedin.com/in/${base}`, prefixEvent);
    expect(prefix.status, JSON.stringify(prefix.body)).toBe(422);
    expect(prefix.body).toEqual({ success: false, error: 'candidate_not_found' });
    expect(await sessionsFor(prefixEvent)).toEqual([]);
    expect((await enr(main.enrollmentId)).status, 'slug préfixe : inscription intacte').toBe('active');
    expect((await exec(mainExec)).status).toBe('scheduled');
    expect(await jcsRow(jcsId)).toEqual({ status: 'contacted', pipeline_stage: 'Contacté' });

    // Autre type d'événement : ignoré.
    const other = await calendlyBooking(fullUrl, `evt_e2e_${rand()}`, 'Autre');
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    expect(other.body).toEqual({ success: true, skipped: true, reason: 'event_type_mismatch' });
    expect((await enr(main.enrollmentId)).status).toBe('active');
    expect(await jcsRow(jcsId)).toEqual({ status: 'contacted', pipeline_stage: 'Contacté' });

    // Six inscriptions correspondantes : aucun arrêt.
    const more: Array<{ enrollmentId: string; execId: string }> = [];
    for (let i = 0; i < 5; i++) {
      const s = await insertSequence(org, org.owner.userId, [
        { action_type: 'message', message_template: 'Bonjour' },
        { action_type: 'message', message_template: `Relance ${i}`, delay_days: 2 },
      ]);
      const e = await enroll(org, s.sequenceId, org.owner.userId, accountId, { profile_id: profileId, profile_url: fullUrl, current_step_order: 1 });
      more.push({ enrollmentId: e.enrollmentId, execId: await schedule(org, e.enrollmentId, s.steps[1], { scheduled_at: later }) });
    }
    const manyEvent = `evt_e2e_${rand()}`;
    const many = await calendlyBooking(fullUrl, manyEvent);
    expect(many.status, JSON.stringify(many.body)).toBe(200);
    expect(many.body.sequences_stopped).toBe(0);
    expect(many.body.sequences_stop_skipped).toBe('too_many_matches');
    for (const m of [{ enrollmentId: main.enrollmentId, execId: mainExec }, ...more]) {
      expect((await enr(m.enrollmentId)).status, 'plus de 5 inscriptions : aucune close').toBe('active');
      expect((await exec(m.execId)).status).toBe('scheduled');
    }
    expect(await notificationsOf(org.orgId, 'action'), 'aucune notification d’arrêt').toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Stripe : signature, absence de reprise, gate du moteur
// ════════════════════════════════════════════════════════════════════════════
test.describe('Stripe', () => {
  test.describe.configure({ mode: 'serial' });
  /** Organisation au plan gratuit, une inscription en pause « abonnement requis ». */
  async function pausedForSubscription(prefix: string) {
    const org = track(await createOrg('agency', prefix));
    const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_${rand()}`, 'OK');
    // Une organisation neuve reçoit un essai : on la place au plan gratuit.
    const { error: planErr } = await admin().from('organization_subscriptions')
      .upsert({ organization_id: org.orgId, plan_id: 'free', status: 'active', trial_ends_at: null, stripe_subscription_id: null }, { onConflict: 'organization_id' });
    if (planErr) throw new Error(planErr.message);
    const seq = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour abonnement' },
      { action_type: 'message', message_template: 'Relance', delay_days: 2 },
    ]);
    const e = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'subscription_required' });
    const execId = await schedule(org, e.enrollmentId, seq.steps[0], { status: 'cancelled', skip_reason: SUBSCRIPTION_REQUIRED_REASON, scheduled_at: minutesFromNow(DAY) });
    return { org, accountId, enrollmentId: e.enrollmentId, execId };
  }
  async function expectStillPaused(enrollmentId: string, execId: string, label: string) {
    const row = await enr(enrollmentId);
    expect({ status: row.status, pause_reason: row.pause_reason }, `${label} : toujours en pause`).toEqual({ status: 'paused', pause_reason: 'subscription_required' });
    expect((await exec(execId)).status, `${label} : étape non réarmée`).toBe('cancelled');
  }

  // stripe-signature
  test('stripe-webhook refuse un événement sans en-tête (400) ou mal signé (401) : aucune écriture d’abonnement, aucune reprise', async () => {
    const p = await pausedForSubscription('E2E inbound2 Stripe signature');
    const before = await subscriptionOf(p.org.orgId);
    const event = checkoutEvent(p.org.orgId);
    const raw = JSON.stringify(event);
    const now = Math.floor(Date.now() / 1000);

    const noHeader = await rawPost('/functions/v1/stripe-webhook', raw, { apikey: E2E.anonKey });
    expect(noHeader.status, JSON.stringify(noHeader.body)).toBe(400);
    expect(noHeader.body).toEqual({ error: 'Missing stripe-signature' });
    for (const [label, header] of [
      ['signature fausse', `t=${now},v1=faux`],
      ['sans horodatage', `v1=${createHmac('sha256', STRIPE_SECRET).update(`${now}.${raw}`).digest('hex')}`],
    ] as const) {
      const res = await rawPost('/functions/v1/stripe-webhook', raw, { apikey: E2E.anonKey, 'stripe-signature': header });
      expect(res.status, `${label} : ${JSON.stringify(res.body)}`).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid signature' });
    }
    const wrongSecret = await stripeEvent(event, { secret: 'whsec_autre_secret' });
    expect(wrongSecret.status, 'autre secret').toBe(401);
    const stale = await stripeEvent(event, { t: now - 600 });
    expect(stale.status, 'horodatage de plus de 5 min').toBe(401);

    expect(await subscriptionOf(p.org.orgId), 'abonnement inchangé').toEqual(before);
    await expectStillPaused(p.enrollmentId, p.execId, 'événements refusés');

    // Témoin : le même événement correctement signé est accepté et reprend.
    const ok = await stripeEvent(event);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await enr(p.enrollmentId)).status, 'témoin signé : reprise').toBe('active');
  });

  // stripe-sans-reprise
  test('aucune reprise pour un paiement non encaissé, un plan « free » ou inconnu, ou un abonnement dont le statut n’est pas actif', async () => {
    const p = await pausedForSubscription('E2E inbound2 Stripe sans reprise');

    const unpaid = await stripeEvent(checkoutEvent(p.org.orgId, { paymentStatus: 'unpaid' }));
    expect(unpaid.status, JSON.stringify(unpaid.body)).toBe(200);
    await expectStillPaused(p.enrollmentId, p.execId, 'paiement non encaissé');

    // Chaque Checkout rattache son abonnement : il est détaché avant le suivant,
    // sinon le suivant serait ignoré comme « autre abonnement vivant ».
    const detach = () => admin().from('organization_subscriptions').update({ stripe_subscription_id: null }).eq('organization_id', p.org.orgId);
    const unknownEvent = checkoutEvent(p.org.orgId, { planId: `plan_inconnu_${rand()}` });
    const unknown = await stripeEvent(unknownEvent);
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(200);
    const afterUnknown = await subscriptionOf(p.org.orgId);
    expect(afterUnknown?.stripe_subscription_id, 'plan inconnu : Checkout bien traité').toBe((unknownEvent.data.object as { subscription: string }).subscription);
    expect(afterUnknown?.plan_id, 'plan inconnu : plan en base conservé').toBe('free');
    await expectStillPaused(p.enrollmentId, p.execId, 'plan inconnu');

    await detach();
    const freeEvent = checkoutEvent(p.org.orgId, { planId: 'free' });
    const free = await stripeEvent(freeEvent);
    expect(free.status, JSON.stringify(free.body)).toBe(200);
    const afterFree = await subscriptionOf(p.org.orgId);
    expect(afterFree?.stripe_subscription_id, 'plan free : Checkout bien traité').toBe((freeEvent.data.object as { subscription: string }).subscription);
    expect(afterFree?.plan_id).toBe('free');
    await expectStillPaused(p.enrollmentId, p.execId, 'plan free');

    // Abonnement payant en base, mais statut relu chez Stripe ni actif ni en essai
    // (le faux prestataire ne renvoie aucun statut, comme « incomplete »).
    const cus = `cus_e2e_${rand()}`;
    await admin().from('organization_subscriptions').update({ plan_id: 'cabinet', status: 'past_due', stripe_customer_id: cus, stripe_subscription_id: null }).eq('organization_id', p.org.orgId);
    const updated = await stripeEvent({
      id: `evt_e2e_${rand()}`, type: 'customer.subscription.updated',
      data: { object: { id: `sub_e2e_${rand()}`, object: 'subscription', customer: cus, status: 'active' } },
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect((await subscriptionOf(p.org.orgId))?.status, 'statut non réécrit depuis l’événement').toBe('past_due');
    await expectStillPaused(p.enrollmentId, p.execId, 'statut relu non actif');
  });

  // stripe-pause-gate-moteur (SEQ-121)
  test('sans plan payant (annulé, impayé, essai échu) le cycle met l’inscription active en pause « subscription_required » et n’envoie rien ; la souscription la reprend', async () => {
    // 1. Abonnement annulé par Stripe.
    const canceled = await trackedSendingOrg('E2E inbound2 gate annulé');
    const cus = `cus_e2e_${rand()}`;
    const sub = `sub_e2e_${rand()}`;
    await admin().from('organization_subscriptions').update({ stripe_customer_id: cus, stripe_subscription_id: sub }).eq('organization_id', canceled.org.orgId);
    const deleted = await stripeEvent({ id: `evt_e2e_${rand()}`, type: 'customer.subscription.deleted', data: { object: { id: sub, object: 'subscription', customer: cus, status: 'canceled' } } });
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect(await subscriptionOf(canceled.org.orgId)).toMatchObject({ plan_id: 'free', status: 'canceled' });
    // 2. Impayé. 3. Essai échu sans abonnement Stripe.
    const unpaid = await trackedSendingOrg('E2E inbound2 gate impayé');
    await admin().from('organization_subscriptions').update({ status: 'unpaid' }).eq('organization_id', unpaid.org.orgId);
    const trial = await trackedSendingOrg('E2E inbound2 gate essai échu');
    await admin().from('organization_subscriptions').update({ status: 'trialing', trial_ends_at: minutesFromNow(-DAY), stripe_subscription_id: null }).eq('organization_id', trial.org.orgId);

    const cases = [
      { label: 'annulé', ...canceled },
      { label: 'impayé', ...unpaid },
      { label: 'essai échu', ...trial },
    ];
    const seeded: Array<{
      label: string; org: TestOrg; accountId: string; enrollmentId: string; execId: string;
      closedId: string; closedExec: string; firstStep: SeededStep;
    }> = [];
    for (const c of cases) {
      const seq = await insertSequence(c.org, c.org.owner.userId, [
        { action_type: 'message', message_template: `Bonjour ${c.label}` },
        { action_type: 'message', message_template: 'Relance', delay_days: 2 },
      ]);
      const e = await enroll(c.org, seq.sequenceId, c.org.owner.userId, c.accountId);
      const closed = await enroll(c.org, seq.sequenceId, c.org.owner.userId, c.accountId, { status: 'replied', replied_at: minutesFromNow(-60) });
      seeded.push({
        label: c.label, org: c.org, accountId: c.accountId, enrollmentId: e.enrollmentId, execId: '',
        closedId: closed.enrollmentId, closedExec: '', firstStep: seq.steps[0],
      });
    }
    // Exécutions échues insérées en dernier.
    for (const s of seeded) {
      s.execId = await schedule(s.org, s.enrollmentId, s.firstStep);
      s.closedExec = await schedule(s.org, s.closedId, s.firstStep);
    }

    await runCycle();

    for (const s of seeded) {
      const row = await enr(s.enrollmentId);
      expect(row.status, `${s.label} : en pause`).toBe('paused');
      expect(row.pause_reason, `${s.label} : abonnement requis`).toBe('subscription_required');
      expect(row.tracking_data?.pause_reason).toBe(SUBSCRIPTION_REQUIRED_REASON);
      const e = await exec(s.execId);
      expect(e.status, `${s.label} : étape annulée`).toBe('cancelled');
      expect(e.skip_reason).toBe(SUBSCRIPTION_REQUIRED_REASON);
      expect(await sentTexts(s.accountId), `${s.label} : rien ne part`).toEqual([]);
      const closedRow = await enr(s.closedId);
      expect(closedRow.status, `${s.label} : inscription close jamais mise en pause`).toBe('replied');
      expect(closedRow.pause_reason).toBeNull();
      expect((await exec(s.closedExec)).status, `${s.label} : étape d'une inscription close jamais envoyée`).not.toBe('sent');
    }

    // Souscription payante : reprise, réarmement, puis envoi.
    const first = seeded[0];
    const paid = await stripeEvent(checkoutEvent(first.org.orgId));
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    const resumed = await enr(first.enrollmentId);
    expect(resumed.status).toBe('active');
    expect(resumed.pause_reason).toBeNull();
    const rearmed = await exec(first.execId);
    expect(rearmed.status).toBe('scheduled');
    expect(ts(rearmed.scheduled_at), 'date passée : maintenant + 1 min').toBeGreaterThan(Date.now());
    await rewind(first.execId);
    await runCycle();
    expect(await sentTexts(first.accountId)).toEqual(['Bonjour annulé']);
    expect(await sentTexts(seeded[1].accountId), 'impayé : toujours rien').toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Effacement RGPD : droits (SEQ-055)
// ════════════════════════════════════════════════════════════════════════════
test.describe('Effacement RGPD : droits', () => {
  test.describe.configure({ mode: 'serial' });
  // rgpd-erase-droits (SEQ-055)
  test('rgpd-erase-contact : anonyme 401, membre et collaborateur 403, owner limité à son organisation, clé de service globale avec une seule ligne de registre, 400 sans cible, 429 au 31e appel', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E inbound2 RGPD A');
    const other = track(await createOrg('agency', 'E2E inbound2 RGPD B'));
    const member = await addMember(org.orgId, 'member', 'rgpd');
    const collaborator = await addMember(org.orgId, 'collaborator', 'rgpd');
    orgsToDelete.find((o) => o.org.orgId === org.orgId)?.extra.push(member, collaborator);
    const slug = `camille-e2e-${rand()}`;
    const url = `https://www.linkedin.com/in/${slug}`;
    const email = `camille.${rand()}@e2e.konekt.test`;
    const urlHash = sha256(url.toLowerCase());
    const emailHash = sha256(email);
    cleanups.push(() => admin().from('gdpr_erasures').delete().or(`linkedin_url_hash.eq.${urlHash},email_hash.eq.${emailHash}`));
    cleanups.push(() => admin().from('suppressed_emails').delete().eq('email', email));
    const registry = async () => {
      const { data } = await admin().from('gdpr_erasures').select('id, email_hash, linkedin_url_hash').or(`linkedin_url_hash.eq.${urlHash},email_hash.eq.${emailHash}`);
      return (data ?? []) as Array<{ id: string; email_hash: string | null; linkedin_url_hash: string | null }>;
    };
    const seq = await insertSequence(org, org.owner.userId, [{ action_type: 'message', message_template: 'Bonjour' }, { action_type: 'message', message_template: 'Relance', delay_days: 2 }]);
    const e = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { profile_url: url, email_used: email });
    await schedule(org, e.enrollmentId, seq.steps[1], { scheduled_at: minutesFromNow(2 * DAY) });
    const body = { linkedin_url: url, email };

    // Anonyme : sans aucun en-tête, puis avec la seule clé publique.
    const bare = await rawPost('/functions/v1/rgpd-erase-contact', JSON.stringify(body), {});
    expect(bare.status, JSON.stringify(bare.body)).toBe(401);
    const anon = await rgpdErase(E2E.anonKey, body);
    expect(anon.status, JSON.stringify(anon.body)).toBe(401);

    const ownerJwt = await ownerToken(org);
    const missing = await rgpdErase(ownerJwt, { organization_id: org.orgId });
    expect(missing.status, 'ni e-mail ni URL').toBe(400);

    for (const [label, u] of [['membre', member], ['collaborateur', collaborator]] as const) {
      const res = await rgpdErase(await userToken(u), { ...body, organization_id: org.orgId });
      expect(res.status, `${label} : ${JSON.stringify(res.body)}`).toBe(403);
    }
    const foreign = await rgpdErase(ownerJwt, { ...body, organization_id: other.orgId });
    expect(foreign.status, `owner de A sur l’organisation B : ${JSON.stringify(foreign.body)}`).toBe(403);
    expect(await registry(), 'aucune ligne de registre après les refus').toEqual([]);
    expect((await enr(e.enrollmentId)).status, 'refus : rien n’est arrêté').toBe('active');

    const scoped = await rgpdErase(ownerJwt, { ...body, organization_id: org.orgId });
    expect(scoped.status, JSON.stringify(scoped.body)).toBe(200);
    expect(scoped.body.scope).toBe('organization');
    expect(scoped.body.stopped_enrollments).toBe(1);
    expect(await registry(), 'effacement limité à l’organisation : pas de blocage global').toEqual([]);

    for (let i = 0; i < 2; i++) {
      const global = await rgpdErase(E2E.serviceRoleKey, body);
      expect(global.status, JSON.stringify(global.body)).toBe(200);
      expect(global.body.scope).toBe('global');
    }
    const rows = await registry();
    expect(rows, 'une seule ligne de registre, même relancé').toHaveLength(1);
    expect(rows[0]).toMatchObject({ email_hash: emailHash, linkedin_url_hash: urlHash });

    // Limite : 30 demandes par heure et par IP (un membre est refusé après la limite).
    const ip = randomIp();
    const memberJwt = await userToken(member);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await rgpdErase(memberJwt, { linkedin_url: `https://www.linkedin.com/in/limite-${rand()}` }, ip)).status);
    expect(statuses.slice(0, 30).every((s) => s === 403), `30 premières : ${statuses.slice(0, 30).join(',')}`).toBe(true);
    expect(statuses[30], '31e demande de la même IP').toBe(429);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// check_replies (scrutation de secours des réponses)
// ════════════════════════════════════════════════════════════════════════════
test.describe('check_replies', () => {
  test.describe.configure({ mode: 'serial' });
  // check-replies-detection (SEQ-006, SEQ-007, SEQ-071, SEQ-087, SEQ-191, SEQ-212)
  test('check_replies clôt une inscription dont le candidat a répondu après le dernier envoi : étapes en attente annulées (pas « sending »), réponse comptée une fois, sœurs arrêtées, pipeline borné, aucun appel Notion, last_check_at écrit', async () => {
    const start = new Date().toISOString();
    const { org, accountId } = await trackedSendingOrg('E2E inbound2 check_replies');
    const { user: member, accountId: memberAccount } = await memberWithAccount(org);
    const otherOrg = track(await createOrg('agency', 'E2E inbound2 check_replies B'));
    const mission = await seedMission(org.orgId, org.owner.userId);
    const otherMission = await seedMission(org.orgId, org.owner.userId);
    await scriptReply(accountId, minutesFromNow(-60));
    const profileId = `ACoAAE2ECR${rand()}${rand()}`;
    const seq = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 2 },
      { action_type: 'message', message_template: 'Relance 2', delay_days: 2 },
      { action_type: 'message', message_template: 'Relance 3', delay_days: 2 },
    ]);
    const { enrollmentId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { profile_id: profileId, job_id: mission, current_step_order: 1 });
    const twoHoursAgo = minutesFromNow(-120);
    await schedule(org, enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: twoHoursAgo, executed_at: twoHoursAgo, final_message: 'Bonjour' });
    const later = minutesFromNow(2 * DAY);
    const next = await schedule(org, enrollmentId, seq.steps[1], { scheduled_at: later });
    const blocked = await schedule(org, enrollmentId, seq.steps[2], { status: 'quota_blocked', scheduled_at: later });
    const sending = await schedule(org, enrollmentId, seq.steps[3], { status: 'sending', scheduled_at: minutesFromNow(-1) });
    const siblingSeq = await insertSequence(org, member.userId, [{ action_type: 'message', message_template: 'Autre séquence' }, { action_type: 'message', message_template: 'Relance autre', delay_days: 2 }]);
    const sibling = await enroll(org, siblingSeq.sequenceId, member.userId, memberAccount, { profile_id: profileId, current_step_order: 1 });
    const siblingExec = await schedule(org, sibling.enrollmentId, siblingSeq.steps[1], { scheduled_at: later });
    const jcsMission = await jcs(org.orgId, org.owner.userId, profileId, { job_id: mission });
    const jcsOtherMission = await jcs(org.orgId, org.owner.userId, profileId, { job_id: otherMission });
    const jcsOtherOrg = await jcs(otherOrg.orgId, otherOrg.owner.userId, profileId, { job_id: mission });

    const res = await checkRepliesUntilExamined(enrollmentId);

    expect(res.repliesDetected, JSON.stringify(res)).toBeGreaterThanOrEqual(1);
    const row = await enr(enrollmentId);
    expect(row.status).toBe('replied');
    expect(row.replied_at).not.toBeNull();
    expect(row.last_check_at, 'last_check_at écrit').not.toBeNull();
    for (const id of [next, blocked]) expect((await exec(id)).status, 'étape en attente annulée (SEQ-071)').toBe('cancelled');
    expect((await exec(sending)).status, 'envoi en cours jamais touché').toBe('sending');
    expect((await analytics(seq.sequenceId)).replies).toBe(1);
    expect((await enr(sibling.enrollmentId)).status, 'même candidat sur un autre compte : arrêté (SEQ-212)').toBe('stopped');
    const se = await exec(siblingExec);
    expect(se.status).toBe('cancelled');
    expect(se.skip_reason).toBe(SIBLING_REPLY_SKIP_REASON);
    expect((await jcsRow(jcsMission)).status, 'pipeline de la mission : répondu').toBe('replied');
    expect((await jcsRow(jcsOtherMission)).status, 'autre mission de l’organisation : inchangée (SEQ-006)').toBe('contacted');
    expect((await jcsRow(jcsOtherOrg)).status, 'autre organisation : inchangée (SEQ-006)').toBe('contacted');
    const notion = (await mockCalls()).filter((c) => c.at >= start && /notion/i.test(String(c.host ?? '')));
    expect(notion, 'aucun appel Notion pour une organisation sans Notion relié (SEQ-007)').toEqual([]);

    // Passage suivant : l'inscription close n'est plus scrutée, rien n'est recompté.
    await checkRepliesUntilExamined(enrollmentId);
    expect((await analytics(seq.sequenceId)).replies, 'réponse comptée une seule fois (SEQ-191)').toBe(1);
    expect(await sentTexts(accountId)).toEqual([]);
  });

  // check-replies-garde-fous (SEQ-075, SEQ-078, SEQ-004, SEQ-220, SEQ-084)
  test('check_replies ne décide rien sans preuve : 5xx sans effet, envoi récent ignoré, réponse antérieure à la relance ignorée, pauses non scrutées, séquence désactivée scrutée, second passage sorti avant le verrou', async () => {
    const later = minutesFromNow(2 * DAY);
    const twoHoursAgo = minutesFromNow(-120);
    const setup = async (prefix: string, sentAt: string, o: { seqActive?: boolean; enrollment?: Record<string, unknown> } = {}) => {
      const { org, accountId } = await trackedSendingOrg(prefix);
      const seq = await insertSequence(org, org.owner.userId, [
        { action_type: 'message', message_template: 'Bonjour' },
        { action_type: 'message', message_template: 'Relance', delay_days: 2 },
      ], { isActive: o.seqActive ?? true });
      const { enrollmentId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { current_step_order: 1, ...(o.enrollment ?? {}) });
      await schedule(org, enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: sentAt, executed_at: sentAt, final_message: 'Bonjour' });
      const nextId = await schedule(org, enrollmentId, seq.steps[1], { scheduled_at: later });
      return { org, accountId, enrollmentId, next: nextId };
    };
    const failing = await setup('E2E inbound2 CR 503', twoHoursAgo);
    await setMockMode(failing.accountId, { routes: [{ method: 'GET', path: '^/api/v1/chat_attendees/[^/]+/chats$', status: 503, body: { title: 'Service Unavailable' } }] });
    cleanups.push(() => setMockMode(failing.accountId, {}));
    const recent = await setup('E2E inbound2 CR récent', minutesFromNow(-10));
    await scriptReply(recent.accountId, minutesFromNow(-5));
    const reEnrolled = await setup('E2E inbound2 CR relance', twoHoursAgo, { enrollment: { tracking_data: { re_enrolled_at: minutesFromNow(-30) } } });
    await scriptReply(reEnrolled.accountId, minutesFromNow(-60));
    const paused = await setup('E2E inbound2 CR pause', twoHoursAgo, { enrollment: { status: 'paused', pause_reason: 'manual' } });
    await scriptReply(paused.accountId, minutesFromNow(-60));
    const inactive = await setup('E2E inbound2 CR désactivée', twoHoursAgo, { seqActive: false });
    await scriptReply(inactive.accountId, minutesFromNow(-60));

    const res = await checkRepliesUntilExamined(failing.enrollmentId, recent.enrollmentId, reEnrolled.enrollmentId, inactive.enrollmentId);

    expect(res.checkFailed, `vérification impossible comptée ${JSON.stringify(res)}`).toBeGreaterThanOrEqual(1);
    expect(res.skippedTooRecent, 'envoi de moins de 30 min compté').toBeGreaterThanOrEqual(1);
    for (const [label, c] of [['5xx', failing], ['envoi récent', recent], ['réponse antérieure à la relance', reEnrolled]] as const) {
      expect((await enr(c.enrollmentId)).status, `${label} : rien n’est décidé`).toBe('active');
      expect((await exec(c.next)).status, `${label} : relance gardée`).toBe('scheduled');
    }
    const p = await enr(paused.enrollmentId);
    expect({ status: p.status, pause_reason: p.pause_reason }, 'inscription en pause : non scrutée').toEqual({ status: 'paused', pause_reason: 'manual' });
    expect(p.last_check_at, 'inscription en pause : jamais examinée').toBeNull();
    expect((await exec(paused.next)).status).toBe('scheduled');
    expect((await enr(inactive.enrollmentId)).status, 'séquence désactivée : réponse détectée quand même').toBe('replied');
    expect((await exec(inactive.next)).status).toBe('cancelled');

    // Second passage immédiat : sorti « trop récent » avant le verrou, un cycle
    // lancé en même temps ne voit pas le verrou pris.
    const [again, cycle] = await Promise.all([
      postJson('/functions/v1/process-sequences', { action: 'check_replies' }, { Authorization: `Bearer ${CRON_SECRET}` }),
      postJson('/functions/v1/process-sequences', { action: 'process', force: true }, { Authorization: `Bearer ${CRON_SECRET}` }),
    ]);
    expect(again.status).toBe(200);
    expect(again.body.skipped, JSON.stringify(again.body)).toBe('too_recent');
    expect(cycle.status).toBe(200);
    expect(cycle.body.skipped_reason, JSON.stringify(cycle.body)).toBeUndefined();
    await admin().from('internal_config').delete().eq('key', 'last_check_replies');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// check_wait_events (attentes de connexion et de réponse)
// ════════════════════════════════════════════════════════════════════════════
test.describe('check_wait_events', () => {
  test.describe.configure({ mode: 'serial' });
  // check-wait-events-phase1 (SEQ-085, SEQ-027, SEQ-190)
  test('phase 1 : seules les attentes de connexion d’inscriptions actives déjà connectées, de séquences actives, sont réarmées à maintenant, sans compter d’acceptation', async () => {
    await withInternalConfig('last_check_wait_events', async () => {
      // Phase 2 neutralisée pendant ce test : seul le passage en base joue.
      await admin().from('internal_config').upsert({ key: 'last_check_wait_events', value: new Date().toISOString() }, { onConflict: 'key' });
      const { org, accountId } = await trackedSendingOrg('E2E inbound2 wait phase 1');
      const connected = { connection_status: 'connected', current_step_order: 1 };
      const build = async (waitStep: StepSpec, o: { seqActive?: boolean; enrollment?: Record<string, unknown> } = {}) => {
        const seq = await insertSequence(org, org.owner.userId, [
          { action_type: 'message', message_template: 'Bonjour' },
          waitStep,
          { action_type: 'message', message_template: 'Suite', delay_days: 2 },
        ], { isActive: o.seqActive ?? true });
        const e = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { ...connected, ...(o.enrollment ?? {}) });
        return { ...e, seq };
      };
      const waitConn = { action_type: 'wait_connection', wait_for_event: 'connection_accepted' };
      const A = await build(waitConn);
      const A2 = await build({ action_type: 'wait_connection' });
      const B = await build({ action_type: 'wait_reply', wait_for_event: 'reply_received' });
      const C = await build(waitConn, { enrollment: { status: 'paused', pause_reason: 'manual' } });
      const D = await build(waitConn, { seqActive: false });
      const F = await build(waitConn);
      const waitAt = minutesFromNow(5 * DAY);
      const execs: Record<string, string> = {};
      for (const [k, e] of Object.entries({ A, A2, B, C, D })) {
        execs[k] = await schedule(org, e.enrollmentId, e.seq.steps[1], { status: 'waiting_event', scheduled_at: waitAt });
      }
      // F : l'attente n'attend plus (déjà réarmée), elle garde sa date.
      execs.F = await schedule(org, F.enrollmentId, F.seq.steps[1], { status: 'scheduled', scheduled_at: waitAt });
      for (const e of [A, A2, B, C, D, F]) await schedule(org, e.enrollmentId, e.seq.steps[2], { scheduled_at: minutesFromNow(9 * DAY) });
      const before = Date.now();

      const res = await runEngine({ action: 'check_wait_events' });

      expect(res.skipped_api, JSON.stringify(res)).toBe('too_recent');
      expect(Number(res.fastUnblocked ?? 0), 'au moins les deux attentes de connexion').toBeGreaterThanOrEqual(2);
      for (const k of ['A', 'A2']) {
        const e = await exec(execs[k]);
        expect(e.status, `${k} : attente de connexion réarmée`).toBe('scheduled');
        expect(ts(e.scheduled_at), `${k} : réarmée à maintenant`).toBeGreaterThanOrEqual(before - 5_000);
        expect(ts(e.scheduled_at)).toBeLessThanOrEqual(Date.now() + 5_000);
      }
      for (const [k, label] of [['B', 'attente de réponse'], ['C', 'inscription en pause'], ['D', 'séquence désactivée']] as const) {
        const e = await exec(execs[k]);
        expect(e.status, `${k} (${label}) : jamais réarmée`).toBe('waiting_event');
        expect(ts(e.scheduled_at), `${k} : date gardée`).toBe(ts(waitAt));
      }
      expect(ts((await exec(execs.F)).scheduled_at), 'exécution qui n’attend plus : date inchangée').toBe(ts(waitAt));
      for (const e of [A, A2]) expect((await analytics(e.seq.sequenceId)).accepted, 'aucune acceptation comptée').toBe(0);
    });
  });

  // check-wait-events-phase2 (SEQ-086, SEQ-031, SEQ-084)
  test('phase 2 : 1er degré → attente réarmée, connecté, acceptation comptée ; réponse → inscription « replied » ; sans événement → fin de file ; séquence désactivée ignorée ; second appel trop récent', async () => {
    await withInternalConfig('last_check_wait_events', async () => {
      await admin().from('internal_config').delete().eq('key', 'last_check_wait_events');
      const old = minutesFromNow(-40 * DAY);
      const connSteps: StepSpec[] = [
        { action_type: 'connection_request' },
        { action_type: 'wait_connection', wait_for_event: 'connection_accepted' },
        { action_type: 'message', message_template: 'Merci', delay_days: 2 },
      ];
      const connSetup = async (prefix: string, o: { seqActive?: boolean; distance?: string } = {}) => {
        const { org, accountId } = await trackedSendingOrg(prefix);
        if (o.distance) {
          await setMockMode(accountId, { distance: o.distance });
          cleanups.push(() => setMockMode(accountId, {}));
        }
        const seq = await insertSequence(org, org.owner.userId, connSteps, { isActive: o.seqActive ?? true });
        const { enrollmentId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { current_step_order: 1, connection_status: null });
        await schedule(org, enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: minutesFromNow(-2 * DAY), executed_at: minutesFromNow(-2 * DAY) });
        const wait = await schedule(org, enrollmentId, seq.steps[1], { status: 'waiting_event', scheduled_at: minutesFromNow(5 * DAY), updated_at: old });
        return { org, accountId, enrollmentId, wait, sequenceId: seq.sequenceId };
      };
      const firstDegree = await connSetup('E2E inbound2 wait 1er degré');
      const secondDegree = await connSetup('E2E inbound2 wait 2e degré', { distance: 'SECOND_DEGREE' });
      const inactive = await connSetup('E2E inbound2 wait désactivée', { seqActive: false });

      const { org: rOrg, accountId: rAccount } = await trackedSendingOrg('E2E inbound2 wait réponse');
      await scriptReply(rAccount, minutesFromNow(-60));
      const mission = await seedMission(rOrg.orgId, rOrg.owner.userId);
      const rSeq = await insertSequence(rOrg, rOrg.owner.userId, [
        { action_type: 'message', message_template: 'Bonjour' },
        { action_type: 'wait_reply', wait_for_event: 'reply_received' },
        { action_type: 'message', message_template: 'Relance sans réponse', delay_days: 2 },
      ]);
      const rProfile = `ACoAAE2EWR${rand()}${rand()}`;
      const rEnr = await enroll(rOrg, rSeq.sequenceId, rOrg.owner.userId, rAccount, { profile_id: rProfile, job_id: mission, current_step_order: 1 });
      await schedule(rOrg, rEnr.enrollmentId, rSeq.steps[0], { status: 'sent', scheduled_at: minutesFromNow(-DAY), executed_at: minutesFromNow(-DAY) });
      const rJcs = await jcs(rOrg.orgId, rOrg.owner.userId, rProfile, { job_id: mission });
      const rLater = await schedule(rOrg, rEnr.enrollmentId, rSeq.steps[2], { scheduled_at: minutesFromNow(6 * DAY) });
      const rWait = await schedule(rOrg, rEnr.enrollmentId, rSeq.steps[1], { status: 'waiting_event', scheduled_at: minutesFromNow(5 * DAY), updated_at: old });
      const before = Date.now();

      const res = await runEngine({ action: 'check_wait_events' });
      expect(res.skipped_api, JSON.stringify(res)).toBeUndefined();
      expect(Number(res.eventsTriggered ?? 0), JSON.stringify(res)).toBeGreaterThanOrEqual(2);

      const w1 = await exec(firstDegree.wait);
      expect(w1.status, '1er degré : attente réarmée').toBe('scheduled');
      expect(ts(w1.scheduled_at)).toBeLessThanOrEqual(Date.now() + 5_000);
      const e1 = await enr(firstDegree.enrollmentId);
      expect(e1.connection_status).toBe('connected');
      expect(e1.network_distance).toBe('FIRST_DEGREE');
      expect((await analytics(firstDegree.sequenceId)).accepted, 'invitation acceptée comptée').toBe(1);

      const rRow = await enr(rEnr.enrollmentId);
      expect(rRow.status, 'réponse détectée : inscription close').toBe('replied');
      const rw = await exec(rWait);
      expect(rw.status, 'attente de réponse franchie').toBe('sent');
      expect((await exec(rLater)).status, 'relance « sans réponse » annulée').toBe('cancelled');
      expect((await jcsRow(rJcs)).status, 'pipeline de la mission : répondu').toBe('replied');
      expect((await analytics(rSeq.sequenceId)).replies).toBe(1);

      const w2 = await exec(secondDegree.wait);
      expect(w2.status, '2e degré : toujours en attente').toBe('waiting_event');
      expect(ts(w2.updated_at), 'attente replacée en fin de file').toBeGreaterThanOrEqual(before - 5_000);
      expect((await enr(secondDegree.enrollmentId)).connection_status).toBeNull();

      const w3 = await exec(inactive.wait);
      expect(w3.status, 'séquence désactivée : attente jamais vérifiée').toBe('waiting_event');
      expect(ts(w3.updated_at), 'séquence désactivée : attente non touchée').toBe(ts(old));
      const inactiveReads = (await mockCalls(inactive.accountId)).filter((c) => c.method === 'GET' && c.path.startsWith('/api/v1/users/'));
      expect(inactiveReads, 'séquence désactivée : aucune lecture de profil').toEqual([]);

      const again = await runEngine({ action: 'check_wait_events' });
      expect(again.skipped_api, 'second appel dans les 8 h').toBe('too_recent');
    });
  });
});

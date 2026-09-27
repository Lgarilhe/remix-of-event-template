/**
 * Lot « inmail-cross » : l'InMail groupé (file inmail_queue, fonction
 * process-inmail-queue) face aux réponses, aux inscriptions en séquence, à
 * l'effacement RGPD et aux envois concurrents.
 *
 * Contrat : CLAUDE.md, section « Séquences : règles du moteur et de
 * l'interface », et docs/audit-2026-09-25-sequences.md (SEQ-212 : aucune
 * relance après une réponse, quel que soit le compte ; SEQ-125 : anti-doublon
 * de l'InMail groupé ; D5 : un candidat effacé n'est plus jamais relancé).
 *
 * process-inmail-queue n'a pas d'option `force` : l'envoi exige un jour ouvré
 * dans le fuseau de l'InMail et des plages du titulaire du compte qui couvrent
 * l'heure. Les tests d'envoi posent member_quotas 0-24 h pour ce titulaire et
 * un fuseau où il est actuellement un jour ouvré (ignorés s'il n'y en a aucun,
 * le samedi vers midi UTC). La file est commune à toute la base et traitée par
 * trois lignes au plus par passage : processUntilHandled rappelle le
 * traitement tant que les lignes du test restent dues.
 *
 * Ignoré sans la stack locale (e2e/local-stack/up.sh).
 */
import { test, expect } from '@playwright/test';
import { addMember, admin, deleteOrg, seedLinkedInAccount, signIn, type TestOrg, type TestUser } from '../helpers/supabase-admin';
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
  webhook,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
// Ordre du fichier, un seul worker, sans le mode 'serial' : plusieurs tests
// décrivent des défauts encore ouverts et 'serial' ignorerait tout ce qui suit
// le premier échec. 'default' garde l'ordre et désactive fullyParallel.
test.describe.configure({ mode: 'default' });
test.setTimeout(240_000);

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const mockAccounts: string[] = [];
test.afterEach(async () => {
  for (const acc of mockAccounts.splice(0)) await setMockMode(acc, {});
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    // inmail_queue n'est pas nettoyée par deleteOrg (clé étrangère sans cascade) :
    // une ligne laissée due partirait au prochain passage d'un autre test.
    await admin().from('inmail_queue').delete().eq('organization_id', org.orgId);
    await admin().from('member_quotas').delete().eq('organization_id', org.orgId);
    await admin().from('member_email_accounts').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, extra);
  }
});

async function newSendingOrg(prefix: string) {
  const res = await sendingOrg(prefix);
  orgsToDelete.push({ org: res.org, extra: [] });
  return res;
}

/** Membre de l'organisation avec son propre compte LinkedIn relié. */
async function memberWithAccount(org: TestOrg, role: 'member' | 'collaborator' = 'member') {
  const user = await addMember(org.orgId, role, 'inmailx');
  orgsToDelete.find((o) => o.org.orgId === org.orgId)?.extra.push(user);
  const accountId = await seedLinkedInAccount(org.orgId, user.userId, `acc_${rand()}`, 'OK');
  return { user, accountId };
}

const newProfileId = () => `ACoAAE2EIX${rand()}${rand()}`;

// ─── Fenêtre d'envoi de la file InMail ──────────────────────────────────────

/** Fuseau où il est actuellement un jour ouvré, loin de minuit (null le samedi vers midi UTC). */
function weekdayTimezone(): string | null {
  for (const tz of ['Europe/Paris', 'Pacific/Kiritimati', 'Pacific/Auckland', 'Asia/Tokyo', 'America/New_York', 'Pacific/Honolulu', 'Pacific/Pago_Pago']) {
    const now = new Date();
    const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (day !== 'Sat' && day !== 'Sun' && hour >= 1 && hour <= 22) return tz;
  }
  return null;
}

/** Plages 0-24 h pour le titulaire du compte d'envoi : seule la règle du jour ouvré reste. */
async function openSendingHours(orgId: string, userId: string) {
  const { error } = await admin().from('member_quotas').upsert(
    { organization_id: orgId, user_id: userId, business_hours_start: 0, business_hours_end: 24 },
    { onConflict: 'organization_id,user_id' },
  );
  if (error) throw new Error(`member_quotas: ${error.message}`);
}

/** Fuseau d'envoi pour ce test, ou test ignoré. */
function sendingTimezone(): string {
  const tz = weekdayTimezone();
  test.skip(!tz, 'aucun fuseau en jour ouvré en ce moment : process-inmail-queue n’a pas de force');
  return tz as string;
}

// ─── File InMail ────────────────────────────────────────────────────────────

interface InMailRow {
  id: string;
  status: string;
  scheduled_at: string | null;
  updated_at: string;
  sent_at: string | null;
  error_message: string | null;
  organization_id: string | null;
}

/** Ligne de file insérée directement (état voulu par le test), non due par défaut. */
async function queueRow(
  org: TestOrg,
  accountId: string,
  recipient: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin()
    .from('inmail_queue')
    .insert({
      account_id: accountId,
      recipient_profile_id: recipient,
      recipient_name: 'Camille Martin',
      subject: 'Votre parcours',
      message: `InMail e2e ${rand()}`,
      status: 'scheduled',
      scheduled_at: minutesFromNow(60),
      user_timezone: 'Europe/Paris',
      created_by: org.owner.userId,
      organization_id: org.orgId,
      network_distance: 2,
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`inmail_queue: ${error?.message}`);
  return data.id as string;
}

async function inmailRow(id: string): Promise<InMailRow> {
  const { data } = await admin()
    .from('inmail_queue')
    .select('id, status, scheduled_at, updated_at, sent_at, error_message, organization_id')
    .eq('id', id)
    .single();
  return data as InMailRow;
}

async function makeDue(id: string) {
  await admin().from('inmail_queue').update({ scheduled_at: minutesFromNow(-1) }).eq('id', id);
}

/** InMails (et messages) réellement partis depuis ce compte vers le faux prestataire. */
async function inmailSends(accountId: string) {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST' && c.path === '/api/v1/chats');
}

type ProcessBody = { processed?: number; results?: Array<{ id: string; success: boolean; error?: string }> };

async function processInMails(): Promise<ProcessBody> {
  const res = await postJson('/functions/v1/process-inmail-queue', { action: 'process' }, { Authorization: `Bearer ${CRON_SECRET}` });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as ProcessBody;
}

/** Traite la file jusqu'à ce que ces lignes ne soient plus dues (3 lignes par passage, toute la base). */
async function processUntilHandled(ids: string[]) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await processInMails();
    const { data } = await admin().from('inmail_queue').select('id, status, scheduled_at').in('id', ids);
    const stillDue = (data ?? []).filter((r: { status: string; scheduled_at: string | null }) =>
      ['scheduled', 'pending'].includes(r.status) && r.scheduled_at && new Date(r.scheduled_at).getTime() <= Date.now());
    if (stillDue.length === 0) return;
  }
  throw new Error('lignes de la file jamais traitées (file encombrée par d’autres lignes dues)');
}

/** Vide la file des lignes dues d'autres tests avant un scénario qui doit passer au premier traitement. */
async function drainQueue() {
  for (let attempt = 0; attempt < 6; attempt++) {
    const body = await processInMails();
    if (!body.processed) return;
  }
}

// ─── Réponses ───────────────────────────────────────────────────────────────

function replyOn(accountId: string, profileId: string) {
  return webhook({
    event: 'message_received',
    account_id: accountId,
    account_type: 'LINKEDIN',
    chat_id: `chat_${rand()}`,
    message_id: `msg_${rand()}`,
    message: 'Bonjour, oui avec plaisir',
    sender: { attendee_provider_id: profileId, attendee_id: `att_${rand()}`, attendee_name: 'Camille Martin' },
  });
}

async function ownerToken(org: TestOrg) {
  return (await signIn(org.owner.email, org.owner.password)).access_token;
}

/** Effacement RGPD dans l'organisation, avec une adresse IP propre (limite de 30 demandes par heure et par IP). */
async function eraseContact(org: TestOrg, linkedinUrl: string) {
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  return postJson('/functions/v1/rgpd-erase-contact', { linkedin_url: linkedinUrl, organization_id: org.orgId }, {
    Authorization: `Bearer ${await ownerToken(org)}`,
    'x-forwarded-for': ip,
  });
}

async function repliesReceived(sequenceId: string): Promise<number> {
  const { data } = await admin().from('sequence_analytics').select('replies_received').eq('sequence_id', sequenceId);
  return ((data ?? []) as Array<{ replies_received: number | null }>).reduce((s, r) => s + (r.replies_received ?? 0), 0);
}

// ════════════════════════════════════════════════════════════════════════════

test.describe('InMail groupé et réponses du candidat', () => {
  // reponse-annule-inmail-programme-meme-compte
  test('@critical une réponse reçue sur le compte A annule l’InMail programmé de A vers ce candidat, rien ne part ensuite', async () => {
    const tz = sendingTimezone();
    const { org, accountId } = await newSendingOrg('E2E InMailX réponse même compte');
    await openSendingHours(org.orgId, org.owner.userId);
    const profileId = newProfileId();
    const inmailId = await queueRow(org, accountId, profileId, { user_timezone: tz });

    await replyOn(accountId, profileId);

    const afterReply = await inmailRow(inmailId);
    // DÉFAUT inmail-programme-non-annule-apres-reponse : le webhook ne lit que les lignes 'sent' (unipile-webhook/index.ts:1530-1535).
    expect.soft(afterReply.status, 'InMail programmé annulé par la réponse').toBe('cancelled');
    expect.soft(afterReply.error_message, 'motif lisible').toBeTruthy();

    // Même ramené à maintenant, l'InMail ne part pas.
    await makeDue(inmailId);
    await processUntilHandled([inmailId]);
    // DÉFAUT inmail-programme-non-annule-apres-reponse : l'InMail part après la réponse du candidat.
    expect(await inmailSends(accountId), 'aucun InMail envoyé après la réponse').toEqual([]);
    expect((await inmailRow(inmailId)).status).toBe('cancelled');
  });

  // envoi-saute-si-inscription-repondue
  test('@critical au traitement, un InMail programmé ne part pas si le candidat a répondu entre-temps sur une séquence de l’organisation', async () => {
    const tz = sendingTimezone();
    const { org, accountId } = await newSendingOrg('E2E InMailX inscription répondue');
    await openSendingHours(org.orgId, org.owner.userId);
    const { user: member, accountId: memberAccount } = await memberWithAccount(org);
    const profileId = newProfileId();
    // InMail mis en file d'abord (non dû), réponse sur une séquence d'un collègue ensuite.
    const inmailId = await queueRow(org, accountId, profileId, { user_timezone: tz });
    const { sequenceId } = await messageSequence(org, member.userId, ['Bonjour']);
    await enroll(org, sequenceId, member.userId, memberAccount, {
      profile_id: profileId, status: 'replied', replied_at: new Date().toISOString(),
    });
    await makeDue(inmailId);

    await processUntilHandled([inmailId]);

    // DÉFAUT inmail-envoye-apres-reponse-sequence : process-inmail-queue ne consulte aucune inscription avant d'envoyer (process-inmail-queue/index.ts:568-810).
    expect.soft((await inmailRow(inmailId)).status, 'InMail annulé').toBe('cancelled');
    expect(await inmailSends(accountId), 'aucun InMail envoyé à un candidat qui a répondu').toEqual([]);
  });

  // reponse-marque-inmail-envoye-meme-compte
  test('une réponse reçue sur le compte A passe « répondu » l’InMail envoyé depuis A à ce candidat', async () => {
    const { org, accountId } = await newSendingOrg('E2E InMailX marque répondu');
    const profileId = newProfileId();
    const inmailId = await queueRow(org, accountId, profileId, {
      status: 'sent', sent_at: minutesFromNow(-24 * 60), scheduled_at: minutesFromNow(-24 * 60),
    });
    const before = await inmailRow(inmailId);
    await new Promise((r) => setTimeout(r, 50));

    const body = await replyOn(accountId, profileId);
    expect(body, 'webhook accepté').toBeTruthy();

    const after = await inmailRow(inmailId);
    expect(after.status).toBe('replied');
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
  });

  // reponse-epargne-inmail-autre-organisation
  test('une réponse reçue par l’organisation A ne touche aucune ligne InMail d’une autre organisation vers ce candidat', async () => {
    const one = await newSendingOrg('E2E InMailX org 1');
    const two = await newSendingOrg('E2E InMailX org 2');
    const profileId = newProfileId();
    const ownSent = await queueRow(one.org, one.accountId, profileId, { status: 'sent', sent_at: minutesFromNow(-60) });
    const otherSent = await queueRow(two.org, two.accountId, profileId, { status: 'sent', sent_at: minutesFromNow(-60) });
    const otherScheduled = await queueRow(two.org, two.accountId, profileId, { scheduled_at: minutesFromNow(120) });
    const before = [await inmailRow(otherSent), await inmailRow(otherScheduled)];

    await replyOn(one.accountId, profileId);

    expect((await inmailRow(ownSent)).status, 'témoin : l’InMail de A est bien marqué').toBe('replied');
    const after = [await inmailRow(otherSent), await inmailRow(otherScheduled)];
    for (const [i, row] of after.entries()) {
      expect(row.status, 'statut inchangé dans l’autre organisation').toBe(before[i].status);
      expect(row.updated_at, 'ligne non réécrite').toBe(before[i].updated_at);
    }
  });

  // reponse-annule-inmail-programme-autres-comptes-org
  test('une réponse reçue sur le compte A annule aussi l’InMail programmé vers ce candidat depuis le compte B de l’organisation', async () => {
    const tz = sendingTimezone();
    const { org, accountId } = await newSendingOrg('E2E InMailX autre compte');
    const { user: member, accountId: memberAccount } = await memberWithAccount(org);
    await openSendingHours(org.orgId, member.userId);
    const profileId = newProfileId();
    await queueRow(org, accountId, profileId, { status: 'sent', sent_at: minutesFromNow(-24 * 60) });
    const fromB = await queueRow(org, memberAccount, profileId, { created_by: member.userId, user_timezone: tz });

    await replyOn(accountId, profileId);

    // DÉFAUT inmail-autre-compte-non-annule-apres-reponse : aucune annulation de la file dans l'organisation (unipile-webhook/index.ts:1524-1570).
    expect.soft((await inmailRow(fromB)).status, 'InMail de B annulé').toBe('cancelled');
    await makeDue(fromB);
    await processUntilHandled([fromB]);
    expect(await inmailSends(memberAccount), 'rien ne part depuis B après la réponse reçue sur A').toEqual([]);
  });

  // reponse-epargne-inmail-programme-autre-org
  test('l’annulation après réponse reste bornée à l’organisation : l’InMail programmé d’une autre organisation garde son état', async () => {
    const one = await newSendingOrg('E2E InMailX borne org 1');
    const two = await newSendingOrg('E2E InMailX borne org 2');
    const profileId = newProfileId();
    await queueRow(one.org, one.accountId, profileId, { scheduled_at: minutesFromNow(90) });
    const other = await queueRow(two.org, two.accountId, profileId, { scheduled_at: minutesFromNow(90) });
    const before = await inmailRow(other);

    await replyOn(one.accountId, profileId);

    const after = await inmailRow(other);
    expect(after.status).toBe('scheduled');
    expect(after.scheduled_at).toBe(before.scheduled_at);
    expect(after.updated_at).toBe(before.updated_at);
  });

  // reponse-inmail-groupe-arrete-inscription-autre-compte
  test('une réponse à un InMail groupé (aucune inscription sur A) arrête l’inscription du candidat sur le compte B', async () => {
    const { org, accountId } = await newSendingOrg('E2E InMailX arrêt inscription B');
    const { user: member, accountId: memberAccount } = await memberWithAccount(org);
    const profileId = newProfileId();
    await queueRow(org, accountId, profileId, { status: 'sent', sent_at: minutesFromNow(-24 * 60) });
    const { sequenceId, steps } = await messageSequence(org, member.userId, ['Bonjour', 'Relance']);
    const { enrollmentId } = await enroll(org, sequenceId, member.userId, memberAccount, { profile_id: profileId });
    const pending = await schedule(org, enrollmentId, steps[0], { scheduled_at: minutesFromNow(24 * 60) });

    await replyOn(accountId, profileId);

    // DÉFAUT reponse-inmail-groupe-sans-arret-autres-inscriptions : closeSiblingEnrollments n'est appelé que si une inscription existe sur A (unipile-webhook/index.ts:1436-1515, appel dans la branche else).
    expect((await enrollmentRow(enrollmentId)).status, 'inscription sur B arrêtée').toBe('stopped');
    const exec = (await executionsOf(enrollmentId)).find((e) => e.id === pending);
    expect(exec?.status).toBe('cancelled');
    expect(exec?.skip_reason).toBe("Le candidat a répondu sur un autre compte de l'organisation");

    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', pending);
    await runCycle();
    expect(await sentTexts(memberAccount), 'rien ne part depuis B').toEqual([]);
  });

  // reponse-inmail-groupe-clot-inscription-meme-compte
  test('une réponse sur A clôt l’inscription du candidat sur A et passe « répondu » l’InMail envoyé depuis A, en un seul événement', async () => {
    const { org, accountId } = await newSendingOrg('E2E InMailX clôture même compte');
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: minutesFromNow(-2 * 24 * 60), executed_at: minutesFromNow(-2 * 24 * 60) });
    const followUp = await schedule(org, enrollmentId, steps[1], { scheduled_at: minutesFromNow(24 * 60) });
    const inmailId = await queueRow(org, accountId, profileId, { status: 'sent', sent_at: minutesFromNow(-3 * 24 * 60) });
    const repliesBefore = await repliesReceived(sequenceId);

    await replyOn(accountId, profileId);

    expect((await enrollmentRow(enrollmentId)).status).toBe('replied');
    expect((await executionsOf(enrollmentId)).find((e) => e.id === followUp)?.status, 'relance annulée').toBe('cancelled');
    expect((await inmailRow(inmailId)).status, 'InMail passé « répondu »').toBe('replied');
    expect(await repliesReceived(sequenceId), 'réponse comptée une fois').toBe(repliesBefore + 1);
  });

  // reponse-email-annule-inmail-programme
  test('une réponse par e-mail qui clôt l’inscription annule aussi l’InMail programmé de l’organisation vers ce candidat', async () => {
    const { org, accountId } = await newSendingOrg('E2E InMailX réponse e-mail');
    const mailbox = `mbx_${rand()}`;
    const { error: mbxError } = await admin().from('member_email_accounts').insert({
      organization_id: org.orgId, user_id: org.owner.userId, linked_by: org.owner.userId,
      email_account_id: mailbox, email_address: `recruteur.${rand()}@e2e.konekt.test`, provider: 'GOOGLE',
    });
    if (mbxError) throw new Error(`member_email_accounts: ${mbxError.message}`);
    const candidateEmail = `camille.${rand()}@e2e.konekt.test`;
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, { email_used: candidateEmail });
    const inmailId = await queueRow(org, accountId, profileId, { scheduled_at: minutesFromNow(90) });

    await webhook({
      event: 'mail_received',
      account_id: mailbox,
      email_id: `mail_${rand()}`,
      message_id: `<${rand()}@mail.e2e>`,
      subject: 'Re: Votre parcours',
      body_plain: 'Bonjour, avec plaisir.',
      from_attendee: { display_name: 'Camille Martin', identifier: candidateEmail },
      to_attendees: [{ display_name: 'Recruteur', identifier: 'recruteur@e2e.konekt.test' }],
    });

    expect((await enrollmentRow(enrollmentId)).status, 'témoin : inscription close par la réponse').toBe('replied');
    // DÉFAUT inmail-programme-non-annule-apres-reponse-email : le canal e-mail ne lit jamais inmail_queue (unipile-webhook/index.ts:1874-2052).
    expect((await inmailRow(inmailId)).status, 'InMail programmé annulé').toBe('cancelled');
  });

  // marquer-repondu-annule-inmail-programme
  test('« Marquer comme répondu » annule les InMails programmés et en attente de l’organisation vers ce candidat, pas ceux d’une autre', async () => {
    const { org, accountId } = await newSendingOrg('E2E InMailX marquer répondu');
    const { user: member, accountId: memberAccount } = await memberWithAccount(org);
    const other = await newSendingOrg('E2E InMailX marquer répondu autre');
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const scheduled = await queueRow(org, accountId, profileId, { scheduled_at: minutesFromNow(90) });
    const pending = await queueRow(org, memberAccount, profileId, { status: 'pending', created_by: member.userId, scheduled_at: minutesFromNow(90) });
    const otherOrg = await queueRow(other.org, other.accountId, profileId, { scheduled_at: minutesFromNow(90) });
    const otherBefore = await inmailRow(otherOrg);

    const res = await callFunction('process-sequences', await ownerToken(org), {
      action: 'mark_replied', enrollment_id: enrollmentId, organization_id: org.orgId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await enrollmentRow(enrollmentId)).status).toBe('replied');

    // DÉFAUT mark-replied-sans-annulation-inmail : closeEnrollmentAsReplied ne touche pas inmail_queue (process-sequences/index.ts:5623-5660).
    expect.soft((await inmailRow(scheduled)).status, 'InMail programmé annulé').toBe('cancelled');
    expect.soft((await inmailRow(pending)).status, 'InMail en attente (compte B) annulé').toBe('cancelled');
    const otherAfter = await inmailRow(otherOrg);
    expect(otherAfter.status, 'autre organisation intacte').toBe('scheduled');
    expect(otherAfter.updated_at).toBe(otherBefore.updated_at);
  });
});

test.describe('InMail groupé : mise en file et envoi', () => {
  // file-refuse-inmail-replied-90j
  test('la mise en file écarte un candidat dont l’InMail de l’organisation a reçu une réponse il y a moins de 90 jours', async () => {
    const { org, accountId } = await newSendingOrg('E2E InMailX file répondu');
    const profileId = newProfileId();
    const first = await queueRow(org, accountId, profileId, { status: 'sent', sent_at: minutesFromNow(-24 * 60) });
    await replyOn(accountId, profileId);
    expect((await inmailRow(first)).status, 'précondition : InMail « répondu »').toBe('replied');

    const res = await callFunction('process-inmail-queue', await ownerToken(org), {
      action: 'queue',
      user_timezone: 'Europe/Paris',
      items: [{ account_id: accountId, recipient_profile_id: profileId, recipient_name: 'Camille Martin', subject: 'Nouvelle opportunité', message: 'Bonjour Camille', network_distance: 2 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { data: rows } = await admin().from('inmail_queue').select('id, status').eq('organization_id', org.orgId).eq('recipient_profile_id', profileId);
    // DÉFAUT inmail-replied-hors-antidoublon-file : DUPLICATE_STATUSES omet 'replied' (process-inmail-queue/index.ts:41).
    expect(res.body.queued, JSON.stringify(res.body)).toBe(0);
    expect(res.body.skipped_duplicates).toBe(1);
    expect(res.body.skipped_recipient_ids).toEqual([profileId]);
    expect(rows ?? [], 'aucune nouvelle ligne en file').toHaveLength(1);
  });

  // file-refuse-candidat-efface-rgpd
  // Attente réfutée (inmail-file-candidat-efface) : D5 tel que décidé interdit
  // la reprise et la relance d'une inscription effacée ; refuser une nouvelle
  // mise en file n'est écrit nulle part (décision produit à prendre, avec les
  // nouvelles inscriptions). Ce qui est garanti : rien ne part vers le candidat
  // effacé, la ligne éventuellement mise en file est annulée au traitement par
  // le dernier contrôle de process-inmail-queue.
  test('un InMail mis en file après l’effacement (RGPD) d’un candidat de l’organisation ne part jamais : annulé au traitement', async () => {
    const tz = sendingTimezone();
    const { org, accountId } = await newSendingOrg('E2E InMailX file RGPD');
    await openSendingHours(org.orgId, org.owner.userId);
    const slug = `camille-efface-${rand()}`;
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, {
      profile_url: `https://www.linkedin.com/in/${slug}`,
    });
    const erase = await eraseContact(org, `https://www.linkedin.com/in/${slug}`);
    expect(erase.status, JSON.stringify(erase.body)).toBe(200);
    expect(((await enrollmentRow(enrollmentId)).tracking_data ?? {}).gdpr_erased_at, 'précondition : marqueur d’effacement').toBeTruthy();

    const res = await callFunction('process-inmail-queue', await ownerToken(org), {
      action: 'queue',
      user_timezone: tz,
      items: [{ account_id: accountId, recipient_profile_id: profileId, recipient_name: 'Camille Martin', subject: 'Nouvelle opportunité', message: 'Bonjour', network_distance: 2 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { data: rows } = await admin().from('inmail_queue').select('id').eq('organization_id', org.orgId).eq('recipient_profile_id', profileId);
    const ids = ((rows ?? []) as Array<{ id: string }>).map((r) => r.id);
    for (const id of ids) await makeDue(id);

    await processUntilHandled(ids);

    expect(await inmailSends(accountId), 'aucun InMail vers un candidat effacé').toEqual([]);
    for (const id of ids) {
      const row = await inmailRow(id);
      expect(row.status, 'InMail annulé').toBe('cancelled');
      expect(row.error_message).toBe('Effacement des données demandé');
    }
  });

  // envoi-saute-si-inmail-repondu
  test('au traitement, un InMail ne part pas si un autre InMail de l’organisation au même candidat a déjà reçu une réponse', async () => {
    const tz = sendingTimezone();
    const { org, accountId } = await newSendingOrg('E2E InMailX envoi après InMail répondu');
    await openSendingHours(org.orgId, org.owner.userId);
    const { user: member, accountId: memberAccount } = await memberWithAccount(org);
    const profileId = newProfileId();
    const due = await queueRow(org, accountId, profileId, { user_timezone: tz });
    await queueRow(org, memberAccount, profileId, {
      status: 'replied', created_by: member.userId, sent_at: minutesFromNow(-2 * 24 * 60),
    });
    await makeDue(due);

    await processUntilHandled([due]);

    // DÉFAUT inmail-envoye-apres-inmail-repondu : aucun contrôle des réponses de l'organisation avant l'envoi (process-inmail-queue/index.ts:568-810).
    expect.soft((await inmailRow(due)).status, 'InMail annulé').toBe('cancelled');
    expect(await inmailSends(accountId), 'aucun InMail envoyé après la réponse reçue par un collègue').toEqual([]);
  });

  // envoi-saute-si-efface-rgpd
  test('au traitement, un InMail ne part pas vers un candidat effacé (marqueur RGPD d’une inscription de l’organisation)', async () => {
    const tz = sendingTimezone();
    const { org, accountId } = await newSendingOrg('E2E InMailX envoi RGPD');
    await openSendingHours(org.orgId, org.owner.userId);
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const { profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, {
      status: 'stopped', completed_at: new Date().toISOString(), tracking_data: { gdpr_erased_at: new Date().toISOString() },
    });
    const due = await queueRow(org, accountId, profileId, { user_timezone: tz });
    await makeDue(due);

    await processUntilHandled([due]);

    // DÉFAUT inmail-envoye-candidat-efface : process-inmail-queue ne lit pas le marqueur gdpr_erased_at (process-inmail-queue/index.ts:568-810).
    expect.soft((await inmailRow(due)).status, 'InMail annulé').toBe('cancelled');
    expect(await inmailSends(accountId), 'aucun InMail vers un candidat effacé').toEqual([]);
  });

  // claim-annulation-pendant-controles
  test('un InMail annulé pendant le contrôle du solde n’est pas envoyé : le claim le voit et la ligne reste annulée', async () => {
    const tz = sendingTimezone();
    const { org, accountId } = await newSendingOrg('E2E InMailX claim');
    await openSendingHours(org.orgId, org.owner.userId);
    mockAccounts.push(accountId);
    await setMockMode(accountId, {
      routes: [{ method: 'GET', path: '^/api/v1/linkedin/inmail_balance$', status: 200, delay_ms: 8_000,
        body: { object: 'InMailBalance', premium: 10, recruiter: 10, sales_navigator: 10 } }],
    });
    await drainQueue();
    const profileId = newProfileId();
    const due = await queueRow(org, accountId, profileId, { user_timezone: tz, network_distance: 2 });
    await makeDue(due);

    const running = processInMails();
    // Le traitement attend le solde (8 s) : l'InMail est annulé pendant ce temps,
    // comme le ferait une réponse ou un effacement.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !(await mockCalls(accountId)).some((c) => c.path === '/api/v1/linkedin/inmail_balance')) {
      await new Promise((r) => setTimeout(r, 200));
    }
    const { data: cancelled } = await admin().from('inmail_queue').update({ status: 'cancelled', error_message: 'Annulé par le test' })
      .eq('id', due).in('status', ['scheduled', 'pending']).select('id');
    expect(cancelled ?? [], 'annulation posée pendant le contrôle du solde').toHaveLength(1);
    const body = await running;

    const result = (body.results ?? []).find((r) => r.id === due);
    expect(result, JSON.stringify(body)).toBeTruthy();
    expect(result?.success).toBe(false);
    expect(result?.error).toBe('already claimed (concurrent run)');
    expect((await inmailRow(due)).status).toBe('cancelled');
    expect(await inmailSends(accountId), 'aucun envoi').toEqual([]);
  });
});

test.describe('InMail groupé et effacement RGPD', () => {
  // rgpd-annule-inmail-via-inscription
  test('l’effacement d’un candidat inscrit annule ses InMails programmés et en attente, jamais ceux en cours d’envoi ou envoyés', async () => {
    const { org, accountId } = await newSendingOrg('E2E InMailX RGPD file');
    const slug = `camille-rgpd-${rand()}`;
    const providerId = `ACoAAE2EIXQ${rand()}${rand()}`;
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const { profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, {
      provider_id: providerId, profile_url: `https://www.linkedin.com/in/${slug}`,
    });
    const scheduled = await queueRow(org, accountId, profileId, { scheduled_at: minutesFromNow(90) });
    const pending = await queueRow(org, accountId, providerId, { status: 'pending', scheduled_at: minutesFromNow(90) });
    const sending = await queueRow(org, accountId, profileId, { status: 'sending', scheduled_at: minutesFromNow(-1) });
    const sent = await queueRow(org, accountId, profileId, { status: 'sent', sent_at: minutesFromNow(-60), scheduled_at: minutesFromNow(-60) });

    const res = await eraseContact(org, `https://www.linkedin.com/in/${slug}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.cancelled_inmails).toBe(2);
    for (const id of [scheduled, pending]) {
      const row = await inmailRow(id);
      expect(row.status).toBe('cancelled');
      expect(row.error_message).toBe('Effacement des données demandé');
    }
    expect((await inmailRow(sending)).status, 'envoi en cours intact').toBe('sending');
    expect((await inmailRow(sent)).status, 'InMail envoyé intact').toBe('sent');
  });
});

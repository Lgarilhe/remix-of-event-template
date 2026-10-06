/**
 * Refonte mission, lot 0b-2a : les écrivains serveur de l'étape candidat,
 * contre la stack locale (e2e/local-stack), webhooks, moteur et envois pour
 * de vrai, prestataires simulés par vendor-mock.mjs.
 *
 * Contrat : plan final du lot 0b (décisions 2 à 23, sections 2.3, 3, 4) et
 * CLAUDE.md (« Séquences : règles du moteur et de l'interface », entrée
 * mission_conversations du Data Model).
 *
 *   A. réponse bornée à la mission de la conversation ; rejeu ;
 *   B. message écrit depuis le compte du recruteur (hors Konekt) : écho d'un
 *      envoi Konekt, note d'invitation, fil rattaché, U-I7 ;
 *   C. notation d'un candidat en entretien (lot 0b-3) : seule la note change ;
 *   D. envois : fenêtre de message (mission explicite, ligne créée, marqueur
 *      avant le POST), candidat effacé, messagerie (mission retrouvée),
 *      assistant, file InMail ;
 *   E. rendez-vous Calendly, candidat suivi dans deux missions ;
 *   F. analyse d'une réponse : résumé et rattrapage borné ; candidat effacé ;
 *   G. preuve d'envoi (« Contacté » puis « A répondu ») ; « Marquer comme
 *      répondu » avec deux missions.
 *
 * Réponses scriptées sans la clé '*' : les appels qui ne portent pas de compte
 * (participants, messages, conversation) passent par des identifiants propres
 * à l'organisation (unipile_dsn « unipile.mock?account_id=X&e2e= ») et des
 * routes `url` ; l'IA répond par marqueur (`ai_markers`).
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
import { createHash, createHmac } from 'node:crypto';
import { E2E } from '../helpers/env';
import {
  admin,
  candidateRowState,
  createOrg,
  deleteOrg,
  seedCandidateRow,
  seedMission,
  seedSequence,
  signIn,
  type CandidateStage,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  CRON_SECRET,
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
  setMockMode,
  webhook,
  type MockRoute,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(240_000);

const DAY = 24 * 60;
const CALENDLY_EVENT_NAME = '📅 20 min pour présentation poste - Equipe Konekt';
const CALENDLY_KEY = process.env.E2E_CALENDLY_SIGNING_KEY ?? '';

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];
test.afterEach(async () => {
  while (cleanups.length) await Promise.resolve(cleanups.pop()!()).catch(() => undefined);
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    for (const table of ['job_candidate_status', 'notifications', 'inmail_queue', 'qualification_sessions', 'organization_integrations', 'member_quotas']) {
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
const newProfileId = () => `ACoAAE2E0B${rand()}${rand()}`;

// ─── Seeds et lectures ──────────────────────────────────────────────────────
function row(org: TestOrg, candidateId: string, missionId: string, stage: CandidateStage, extra: Record<string, unknown> = {}) {
  return seedCandidateRow({ orgId: org.orgId, createdBy: org.owner.userId, candidateId, missionId, stage, extra }).then((r) => r.id);
}
async function stage(id: string) {
  return (await candidateRowState(id)).general_stage;
}
/** Envoi Konekt attribué à une mission (ce qu'écrit un envoi réel), sans créer de ligne. */
async function konektSend(org: TestOrg, accountId: string, candidateId: string, missionId: string, o: { chatId?: string; messageId?: string; slug?: string } = {}) {
  const { data, error } = await admin().rpc('record_candidate_outbound', {
    p_organization_id: org.orgId, p_account_id: accountId,
    p_candidate: { ids: [candidateId], ...(o.slug ? { slug: o.slug } : {}) },
    p_source: 'manual', p_project_id: missionId, p_chat_id: o.chatId ?? null, p_message_id: o.messageId ?? null,
    p_created_by: null, p_pending: false, p_send_kind: 'message',
  });
  if (error) throw new Error(`record_candidate_outbound: ${error.message}`);
  return data as { project_id: string; link_id: string };
}
/** Recule les dates d'envoi d'un lien : au-delà de la fenêtre de 10 minutes de l'écho. */
async function ageLink(linkId: string, minutes = 60) {
  const at = minutesFromNow(-minutes);
  const { error } = await admin().from('mission_conversations').update({
    outbound_pending_at: null, first_outbound_at: at, last_outbound_at: at, last_mission_send_at: at,
  }).eq('id', linkId);
  if (error) throw new Error(`ageLink: ${error.message}`);
}
type Link = {
  id: string; project_id: string; account_id: string; candidate_id: string; chat_id: string | null; source: string;
  enrollment_id: string | null; outbound_pending_at: string | null; last_outbound_at: string | null;
  last_mission_send_at: string | null; last_send_kind: string | null; last_outbound_message_id: string | null;
  last_inbound_at: string | null;
};
async function linksOf(orgId: string, candidateId: string): Promise<Link[]> {
  const { data, error } = await admin().from('mission_conversations')
    .select('id, project_id, account_id, candidate_id, chat_id, source, enrollment_id, outbound_pending_at, last_outbound_at, last_mission_send_at, last_send_kind, last_outbound_message_id, last_inbound_at')
    .eq('organization_id', orgId)
    .or(`candidate_id.eq.${candidateId},candidate_ids.cs.{${candidateId}}`);
  if (error) throw new Error(`mission_conversations: ${error.message}`);
  return (data ?? []) as Link[];
}
async function rowsOf(orgId: string, candidateId: string) {
  const { data } = await admin().from('job_candidate_status')
    .select('id, project_id, job_id, created_by, general_stage, decision_source')
    .eq('organization_id', orgId).eq('candidate_id', candidateId);
  return (data ?? []) as Array<{ id: string; project_id: string | null; job_id: string; created_by: string; general_stage: string; decision_source: string | null }>;
}
async function setIntegration(orgId: string, patch: Record<string, unknown>) {
  const { error } = await admin().from('organization_integrations')
    .upsert({ organization_id: orgId, ...patch }, { onConflict: 'organization_id' });
  if (error) throw new Error(`organization_integrations: ${error.message}`);
}
/**
 * Identifiants LinkedIn propres à l'organisation : tout appel arrive sur « / »
 * avec account_id, et les routes `url` de ce compte s'appliquent.
 */
async function ownVendorRoutes(org: TestOrg, accountId: string, routes: MockRoute[]) {
  await setIntegration(org.orgId, { unipile_connected: true, unipile_api_key: 'mock-key', unipile_dsn: `unipile.mock?account_id=${accountId}&e2e=` });
  await setMockMode(accountId, { routes });
  cleanups.push(() => setMockMode(accountId, {}));
}
/** Participants d'une conversation : le compte (att_self) et le candidat. */
function attendeesRoute(candidateId: string): MockRoute {
  return {
    method: 'GET', url: 'e2e=/api/v1/chats/[^/?]+/attendees', status: 200, body: {
      object: 'ChatAttendeeList', items: [
        { object: 'ChatAttendee', id: 'att_self', provider_id: 'ACoAAMOCKME', is_self: 1 },
        { object: 'ChatAttendee', id: 'att_cand', provider_id: candidateId, is_self: 0 },
      ],
    },
  };
}

// ─── Événements ─────────────────────────────────────────────────────────────
/** Message du candidat (ou du compte, attendeeId 'att_self'), format à plat. */
function messageReceived(accountId: string, senderProviderId: string, o: { chatId?: string; messageId?: string; attendeeId?: string } = {}) {
  return {
    event: 'message_received', account_id: accountId, account_type: 'LINKEDIN',
    chat_id: o.chatId ?? `chat_${rand()}`, message_id: o.messageId ?? `msg_${rand()}`,
    message: 'Bonjour, avec plaisir',
    sender: { attendee_provider_id: senderProviderId, attendee_id: o.attendeeId ?? 'att_candidate', attendee_name: 'Camille Martin' },
  };
}
/** Message écrit depuis le compte (format new_message, is_sender vrai). */
function ownNewMessage(accountId: string, chatId: string, messageId = `m_${rand()}`) {
  return { event: 'new_message', account_id: accountId, data: { message: { id: messageId, is_sender: true, chat_id: chatId } } };
}
async function notificationsOf(orgId: string) {
  const { data } = await admin().from('notifications').select('id, user_id, type, metadata').eq('organization_id', orgId).eq('type', 'new_message');
  return (data ?? []) as Array<{ id: string; user_id: string; type: string; metadata: Record<string, unknown> | null }>;
}
async function ownerToken(org: TestOrg) {
  return (await signIn(org.owner.email, org.owner.password)).access_token;
}

// ════════════════════════════════════════════════════════════════════════════
// A. Réponse bornée à la mission de la conversation
// ════════════════════════════════════════════════════════════════════════════
test.describe('A. Réponse d’un candidat', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical la réponse ne change que la mission de la conversation ; les autres missions et l’autre organisation restent ; le rejeu ne change rien', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b A');
    const other = track(await createOrg('agency', 'E2E 0b A autre'));
    const [m1, m2, m3] = [await seedMission(org.orgId, org.owner.userId), await seedMission(org.orgId, org.owner.userId), await seedMission(org.orgId, org.owner.userId)];
    const m9 = await seedMission(other.orgId, other.owner.userId);
    const p = newProfileId();
    const r1 = await row(org, p, m1, 'contacted');
    const r2 = await row(org, p, m2, 'contacted');
    const r3 = await row(org, p, m3, 'retained');
    const r9 = (await seedCandidateRow({ orgId: other.orgId, createdBy: other.owner.userId, candidateId: p, missionId: m9, stage: 'contacted' })).id;
    // Envois Konekt : M1 sur C1, puis M2 (plus récent) sur C2.
    const [c1, c2] = [`chat_${rand()}`, `chat_${rand()}`];
    const l1 = await konektSend(org, accountId, p, m1, { chatId: c1 });
    const l2 = await konektSend(org, accountId, p, m2, { chatId: c2 });

    const reply = messageReceived(accountId, p, { chatId: c1 });
    await webhook(reply);

    const s1 = await candidateRowState(r1);
    expect({ stage: s1.general_stage, source: s1.decision_source, status: s1.status, pipeline: s1.pipeline_stage }, 'M1 : conversation de la réponse')
      .toEqual({ stage: 'replied', source: 'system', status: 'replied', pipeline: 'Répondu' });
    expect(await stage(r2), 'M2 : envoi plus récent, autre conversation').toBe('contacted');
    expect(await stage(r3), 'M3 : Retenu intact').toBe('retained');
    expect(await stage(r9), 'autre organisation intacte').toBe('contacted');
    const links = await linksOf(org.orgId, p);
    expect(links.find((l) => l.id === l1.link_id)?.last_inbound_at, 'lien M1 : réception datée').not.toBeNull();
    expect(links.find((l) => l.id === l2.link_id)?.last_inbound_at, 'lien M2 : aucune réception').toBeNull();
    // Notification : mission résolue (aucune séquence), clé de l'événement.
    const notes = await notificationsOf(org.orgId);
    expect(notes).toHaveLength(1);
    expect(notes[0].metadata?.project_id).toBe(m1);
    expect(notes[0].metadata?.is_candidate, 'is_candidate inchangé (sans inscription)').toBe(false);

    // Rejeu du même événement : dédoublonné.
    expect(await webhook(reply)).toEqual({ ok: true, deduplicated: true });
    // Nouveau message sur C1 : aucune ligne ne change, une notification de plus.
    const before = await Promise.all([r1, r2, r3].map((id) => candidateRowState(id)));
    await webhook(messageReceived(accountId, p, { chatId: c1 }));
    const after = await Promise.all([r1, r2, r3].map((id) => candidateRowState(id)));
    expect(after, 'second message : aucune étape ne bouge').toEqual(before);
    expect(await notificationsOf(org.orgId)).toHaveLength(2);

    // Réponse sur C2 : c'est M2 qui passe « A répondu ».
    await webhook(messageReceived(accountId, p, { chatId: c2 }));
    expect(await stage(r2)).toBe('replied');
    expect(await stage(r3)).toBe('retained');
  });

  test('sans lien : la mission des lignes contactées la plus récente ; sans mission : aucune écriture', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b A rang 4');
    const [m1, m2] = [await seedMission(org.orgId, org.owner.userId), await seedMission(org.orgId, org.owner.userId)];
    const q = newProfileId();
    const older = await row(org, q, m1, 'contacted');
    const newer = await row(org, q, m2, 'contacted');
    await webhook(messageReceived(accountId, q));
    expect(await stage(newer), 'mission contactée la plus récente').toBe('replied');
    expect(await stage(older)).toBe('contacted');

    // Candidat suivi seulement en À trier : aucune mission, rien n'est écrit, la notification part.
    const z = newProfileId();
    const zRow = await row(org, z, m1, 'to_sort');
    await webhook(messageReceived(accountId, z));
    expect(await stage(zRow)).toBe('to_sort');
    expect(await linksOf(org.orgId, z)).toEqual([]);
    const notes = (await notificationsOf(org.orgId)).filter((n) => !n.metadata?.project_id);
    expect(notes.length, 'notification sans mission').toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. Message écrit depuis le compte du recruteur
// ════════════════════════════════════════════════════════════════════════════
test.describe('B. Message écrit hors Konekt', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical message_received de notre participant, aucun fil rattaché : Retenu dans une seule mission → « Contacté » (lien outside) ; deux missions ou À trier : rien', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b B U-I7');
    const [m1, m2, m3] = [await seedMission(org.orgId, org.owner.userId), await seedMission(org.orgId, org.owner.userId), await seedMission(org.orgId, org.owner.userId)];
    const p = newProfileId();
    const onlyRetained = await row(org, p, m3, 'retained');
    const pToSort = await row(org, p, m1, 'to_sort');
    await ownVendorRoutes(org, accountId, [attendeesRoute(p)]);

    const chat = `chat_${rand()}`;
    await webhook(messageReceived(accountId, 'ACoAAMOCKME', { chatId: chat, attendeeId: 'att_self' }));

    const s = await candidateRowState(onlyRetained);
    expect({ stage: s.general_stage, source: s.decision_source }, 'Retenu dans une seule mission : « Contacté »').toEqual({ stage: 'contacted', source: 'system' });
    expect(await stage(pToSort), 'À trier : intact').toBe('to_sort');
    const links = await linksOf(org.orgId, p);
    expect(links.map((l) => ({ project: l.project_id, source: l.source, kind: l.last_send_kind, chat: l.chat_id })))
      .toEqual([{ project: m3, source: 'outside', kind: 'outside', chat }]);
    const attendeeCalls = (await mockCalls(accountId)).filter((c) => String(c.query.e2e ?? '').endsWith(`/chats/${chat}/attendees`));
    expect(attendeeCalls.length, 'participants lus une seule fois (vérification de l’expéditeur)').toBe(1);

    // Retenu dans deux missions : ambigu, rien.
    const two = newProfileId();
    await setMockMode(accountId, { routes: [attendeesRoute(two)] });
    const twoA = await row(org, two, m1, 'retained');
    const twoB = await row(org, two, m2, 'retained');
    await webhook(messageReceived(accountId, 'ACoAAMOCKME', { chatId: `chat_${rand()}`, attendeeId: 'att_self' }));
    expect([await stage(twoA), await stage(twoB)], 'deux missions : rien').toEqual(['retained', 'retained']);
    expect(await linksOf(org.orgId, two)).toEqual([]);
  });

  test('@critical fil déjà rattaché à M1 (message depuis le téléphone) : M2 où il est Retenu ne bouge pas, l’envoi attribué de M1 non plus ; la réponse suivante va à M1', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b B fil');
    const [m1, m2] = [await seedMission(org.orgId, org.owner.userId), await seedMission(org.orgId, org.owner.userId)];
    const p = newProfileId();
    const r1 = await row(org, p, m1, 'contacted');
    const r2 = await row(org, p, m2, 'retained');
    const chat = `chat_${rand()}`;
    const link = await konektSend(org, accountId, p, m1, { chatId: chat });
    await ageLink(link.link_id);
    const aged = (await linksOf(org.orgId, p))[0];

    await webhook(ownNewMessage(accountId, chat));

    expect(await stage(r2), 'M2 (Retenu ailleurs) intacte').toBe('retained');
    expect(await stage(r1)).toBe('contacted');
    const after = (await linksOf(org.orgId, p)).find((l) => l.id === link.link_id)!;
    expect(after.last_mission_send_at, 'envoi attribué de M1 inchangé (décision 2)').toBe(aged.last_mission_send_at);
    expect(new Date(after.last_outbound_at!).getTime(), 'dernier message sortant daté').toBeGreaterThan(new Date(aged.last_outbound_at!).getTime());
    expect((await linksOf(org.orgId, p)).length, 'aucun lien outside').toBe(1);
    // Candidat lu dans le lien : aucun appel des participants.
    expect((await mockCalls()).filter((c) => c.method === 'GET' && c.path.includes(`/chats/${chat}/attendees`))).toEqual([]);

    await webhook(messageReceived(accountId, p, { chatId: chat }));
    expect(await stage(r1), 'réponse : mission du fil').toBe('replied');
    expect(await stage(r2)).toBe('retained');
  });

  test('écho d’un envoi Konekt (même message, ou moins de 10 min) : rien, même pour un candidat Retenu ailleurs', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b B écho');
    const [m1, m2] = [await seedMission(org.orgId, org.owner.userId), await seedMission(org.orgId, org.owner.userId)];
    const p = newProfileId();
    await row(org, p, m1, 'contacted');
    const r2 = await row(org, p, m2, 'retained');
    // Envoi enregistré il y a une heure avec son identifiant de message.
    const messageId = `msg_konekt_${rand()}`;
    const chat = `chat_${rand()}`;
    const link = await konektSend(org, accountId, p, m1, { chatId: chat, messageId });
    await ageLink(link.link_id);
    await webhook(ownNewMessage(accountId, chat, messageId));
    expect(await stage(r2), 'même identifiant de message : écho').toBe('retained');
    const l = (await linksOf(org.orgId, p))[0];
    expect(new Date(l.last_outbound_at!).getTime(), 'écho : lien non touché').toBeLessThan(Date.now() - 30 * 60_000);

    // Envoi du moteur (marqueur puis envoi réel), puis l'écho sous un autre identifiant.
    const q = newProfileId();
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour du moteur']);
    await admin().from('outreach_sequences').update({ project_id: m1 }).eq('id', sequenceId);
    const q2 = await row(org, q, m2, 'retained');
    const e = await enroll(org, sequenceId, org.owner.userId, accountId, { profile_id: q });
    await schedule(org, e.enrollmentId, steps[0]);
    await runCycle();
    const engineLink = (await linksOf(org.orgId, q)).find((x) => x.project_id === m1);
    expect(engineLink, 'lien de la mission de la séquence').toBeTruthy();
    expect(engineLink!.source).toBe('sequence');
    expect(engineLink!.enrollment_id).toBe(e.enrollmentId);
    expect(engineLink!.last_send_kind).toBe('message');
    expect(engineLink!.outbound_pending_at, 'marqueur posé avant le POST, jamais effacé').not.toBeNull();
    expect(engineLink!.chat_id, 'conversation rendue par l’envoi').toMatch(/^chat_mock_/);
    expect(engineLink!.last_outbound_message_id).toMatch(/^msg_mock_/);
    await webhook(ownNewMessage(accountId, engineLink!.chat_id!));
    expect(await stage(q2), 'écho d’un envoi de moins de 10 min : rien').toBe('retained');
    expect((await linksOf(org.orgId, q)).filter((x) => x.source === 'outside')).toEqual([]);
  });

  test('@critical invitation avec note par le moteur, acceptation, écho de la note, puis réponse : M2 (Retenu ailleurs) intacte, réponse dans la mission de l’invitation', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b B invitation');
    const [m1, m2] = [await seedMission(org.orgId, org.owner.userId), await seedMission(org.orgId, org.owner.userId)];
    const p = newProfileId();
    const r2 = await row(org, p, m2, 'retained');
    await setMockMode(accountId, { distance: 'SECOND_DEGREE' });
    cleanups.push(() => setMockMode(accountId, {}));
    const seq = await seedSequence(org.orgId, org.owner.userId, [{ action_type: 'connection_request' }, { action_type: 'message', delay_days: 3 }]);
    await admin().from('sequence_steps').update({ message_template: 'Ravi d’échanger avec vous' }).eq('id', seq.steps[0].id);
    await admin().from('outreach_sequences').update({ project_id: m1 }).eq('id', seq.sequenceId);
    const e = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { profile_id: p });
    const inviteExec = await schedule(org, e.enrollmentId, seq.steps[0]);
    await runCycle();

    expect((await sentInvites(accountId)).length, 'invitation partie').toBe(1);
    const { data: ex } = await admin().from('sequence_step_executions').select('status').eq('id', inviteExec).single();
    expect(ex?.status).toBe('sent');
    const [invLink] = await linksOf(org.orgId, p);
    expect({ project: invLink.project_id, kind: invLink.last_send_kind, chat: invLink.chat_id }).toEqual({ project: m1, kind: 'invitation', chat: null });
    const created = (await rowsOf(org.orgId, p)).find((x) => x.project_id === m1);
    expect(created, 'ligne créée dans la mission de l’inscription (décision 6)').toBeTruthy();
    expect({ job: created!.job_id, by: created!.created_by, stage: created!.general_stage, source: created!.decision_source })
      .toEqual({ job: `project:${m1}`, by: org.owner.userId, stage: 'contacted', source: 'system' });
    await ageLink(invLink.id);

    // Participants scriptés pour ce compte (identifiants propres à l'organisation).
    // Le cycle du moteur a mis en cache l'absence d'identifiants propres pour 60 s
    // (resolve-org-credentials, cache négatif) : on attend son expiration.
    await ownVendorRoutes(org, accountId, [attendeesRoute(p)]);
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    // Acceptation, puis écho de la note sur la conversation créée.
    await webhook({ event: 'new_relation', account_id: accountId, account_type: 'LINKEDIN', user_provider_id: p, user_full_name: 'Camille Martin', user_public_identifier: `camille-${rand()}` });
    const chat = `chat_${rand()}`;
    await webhook(messageReceived(accountId, 'ACoAAMOCKME', { chatId: chat, attendeeId: 'att_self' }));
    expect(await stage(r2), 'note d’invitation : M2 intacte').toBe('retained');
    const afterNote = await linksOf(org.orgId, p);
    expect(afterNote.map((l) => ({ project: l.project_id, chat: l.chat_id, source: l.source })), 'conversation complétée sur le lien de l’invitation')
      .toEqual([{ project: m1, chat, source: 'sequence' }]);

    // Réponse du candidat sur cette conversation.
    await webhook(messageReceived(accountId, p, { chatId: chat, attendeeId: 'att_cand' }));
    expect(await stage(created!.id), 'réponse dans la mission de l’invitation').toBe('replied');
    expect(await stage(r2)).toBe('retained');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C. Notation d'un candidat en entretien (lot 0b-3)
// ════════════════════════════════════════════════════════════════════════════
test.describe('C. Notation', () => {
  test('@critical une note basse sur un candidat en entretien : étape, étape d’entretien et couple inchangés, seule la note est écrite ; À trier reste À trier', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b C notation');
    const m = await seedMission(org.orgId, org.owner.userId);
    const { data: stepRows, error: stepError } = await admin().from('mission_process_steps')
      .insert({ project_id: m, organization_id: org.orgId, name: 'Entretien RH', step_order: 0 }).select('id').single();
    if (stepError || !stepRows) throw new Error(`mission_process_steps: ${stepError?.message}`);
    const stepId = (stepRows as { id: string }).id;
    const [p, q] = [newProfileId(), newProfileId()];
    const inInterview = (await seedCandidateRow({ orgId: org.orgId, createdBy: org.owner.userId, candidateId: p, missionId: m, stage: 'interviewing', stepId })).id;
    const toSort = await row(org, q, m, 'to_sort');
    const before = await candidateRowState(inInterview);
    expect({ stage: before.general_stage, step: before.process_step_id }).toEqual({ stage: 'interviewing', step: stepId });

    // IA scriptée par marqueur (dans l'intitulé du poste, lu par la notation) : note basse, must-have non satisfait.
    const marker = `NOTE${rand()}`;
    const low = (id: string) => ({
      id, overallScore: 12, techFitScore: 10, softSkillsScore: 20, summary: `Profil éloigné du poste ${marker}`,
      strengths: [], concerns: ['Expérience éloignée'], matchedSkills: [], missingCriticalSkills: ['TypeScript'],
      mustHavePassed: 'failed', criteriaEvaluations: [],
    });
    await setMockMode(accountId, { ai_markers: { [marker]: JSON.stringify([low(p), low(q)]) } });
    cleanups.push(() => setMockMode(accountId, {}));

    const res = await callFunction('score-profile-job', await ownerToken(org), {
      job: { id: `project:${m}`, title: `Développeur TypeScript ${marker}` },
      profiles: [
        { id: p, name: 'Camille Martin', headline: 'Chargée de clientèle' },
        { id: q, name: 'Léa Durand', headline: 'Chargée de clientèle' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const { data: scored } = await admin().from('job_candidate_status')
      .select('id, score, general_stage, process_step_id, status, pipeline_stage, decision_source')
      .in('id', [inInterview, toSort]);
    const byId = new Map(((scored ?? []) as Array<Record<string, unknown>>).map((r) => [r.id as string, r]));
    const a = byId.get(inInterview)!;
    expect(a.score, 'note écrite').not.toBeNull();
    expect({ stage: a.general_stage, step: a.process_step_id, status: a.status, pipeline: a.pipeline_stage, source: a.decision_source },
      'entretien : étape, étape d’entretien et couple inchangés')
      .toEqual({ stage: before.general_stage, step: stepId, status: before.status, pipeline: before.pipeline_stage, source: before.decision_source });
    const b = byId.get(toSort)!;
    expect(b.score, 'note écrite').not.toBeNull();
    expect({ stage: b.general_stage, status: b.status }, 'À trier : noté, jamais écarté').toEqual({ stage: 'to_sort', status: 'scored' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D. Envois
// ════════════════════════════════════════════════════════════════════════════
test.describe('D. Envois', () => {
  test.describe.configure({ mode: 'serial' });

  function sendMessage(token: string, org: TestOrg, accountId: string, body: Record<string, unknown>) {
    return callFunction('unipile-search', token, { action: 'send_message', organization_id: org.orgId, account_id: accountId, text: 'Bonjour', ...body });
  }

  test('@critical fenêtre de message avec la mission : lien, ligne créée À trier puis « Contacté » ; mission d’une autre organisation ignorée', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b D fenêtre');
    const other = track(await createOrg('agency', 'E2E 0b D autre'));
    const m1 = await seedMission(org.orgId, org.owner.userId);
    const foreign = await seedMission(other.orgId, other.owner.userId);
    const token = await ownerToken(org);
    const p = newProfileId();

    const res = await sendMessage(token, org, accountId, { recipient_id: p, project_id: `project:${m1}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
    const [link] = await linksOf(org.orgId, p);
    expect({ project: link.project_id, source: link.source, kind: link.last_send_kind }).toEqual({ project: m1, source: 'manual', kind: 'message' });
    expect(link.outbound_pending_at, 'marqueur posé avant le POST (écho reconnu au webhook)').not.toBeNull();
    expect(link.chat_id).toMatch(/^chat_mock_/);
    expect(link.last_outbound_message_id).toMatch(/^msg_mock_/);
    const rows = await rowsOf(org.orgId, p);
    expect(rows.map((r) => ({ project: r.project_id, job: r.job_id, by: r.created_by, stage: r.general_stage, source: r.decision_source })))
      .toEqual([{ project: m1, job: `project:${m1}`, by: org.owner.userId, stage: 'contacted', source: 'system' }]);

    // Mission d'une autre organisation : ignorée ; sans autre trace, aucune mission, rien n'est écrit.
    const q = newProfileId();
    const res2 = await sendMessage(token, org, accountId, { recipient_id: q, project_id: foreign });
    expect(res2.status, JSON.stringify(res2.body)).toBe(200);
    expect(await linksOf(org.orgId, q)).toEqual([]);
    expect(await rowsOf(org.orgId, q)).toEqual([]);
    const { data: foreignLinks } = await admin().from('mission_conversations').select('id').eq('project_id', foreign);
    expect(foreignLinks ?? []).toEqual([]);
  });

  test('candidat effacé (RGPD) : le message part, rien n’est enregistré (ni marqueur, ni lien, ni étape)', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b D effacé');
    const m1 = await seedMission(org.orgId, org.owner.userId);
    const p = newProfileId();
    const slug = `lea-efface-0b-${rand()}`;
    const r1 = await row(org, p, m1, 'retained', { linkedin_profile_url: `https://www.linkedin.com/in/${slug}` });
    const urlHash = createHash('sha256').update(`https://www.linkedin.com/in/${slug}`).digest('hex');
    const { data: erasure, error } = await admin().from('gdpr_erasures').insert({ linkedin_url_hash: urlHash, source: 'e2e' }).select('id').single();
    if (error) throw new Error(`gdpr_erasures: ${error.message}`);
    cleanups.push(() => admin().from('gdpr_erasures').delete().eq('id', (erasure as { id: string }).id));
    const before = await candidateRowState(r1);
    const res = await sendMessage(await ownerToken(org), org, accountId, { recipient_id: p, project_id: m1 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success, 'le message part').toBe(true);
    expect(await linksOf(org.orgId, p)).toEqual([]);
    expect(await candidateRowState(r1)).toEqual(before);
  });

  test('messagerie sans mission : mission retrouvée (lignes contactées), lien « inferred » qui porte la réponse suivante', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b D messagerie');
    const [m1, m2] = [await seedMission(org.orgId, org.owner.userId), await seedMission(org.orgId, org.owner.userId)];
    const token = await ownerToken(org);
    const q = newProfileId();
    const r1 = await row(org, q, m1, 'retained');
    const r2 = await row(org, q, m2, 'contacted');
    const res = await sendMessage(token, org, accountId, { recipient_id: q });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [link] = await linksOf(org.orgId, q);
    expect({ project: link.project_id, source: link.source }).toEqual({ project: m2, source: 'inferred' });
    expect(await stage(r1), 'Retenu dans une autre mission : intact').toBe('retained');
    await webhook(messageReceived(accountId, q, { chatId: link.chat_id! }));
    expect(await stage(r2)).toBe('replied');
    expect(await stage(r1)).toBe('retained');
  });

  test('assistant (appel interne) : origine assistant, auteur de la ligne créée = l’utilisateur', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b D assistant');
    const m1 = await seedMission(org.orgId, org.owner.userId);
    const p = newProfileId();
    const res = await postJson('/functions/v1/unipile-search', {
      action: 'send_message', organization_id: org.orgId, account_id: accountId, recipient_id: p, text: 'Bonjour',
      project_id: m1, source: 'assistant', created_by: org.owner.userId,
    }, { Authorization: `Bearer ${E2E.serviceRoleKey}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [link] = await linksOf(org.orgId, p);
    expect({ project: link.project_id, source: link.source }).toEqual({ project: m1, source: 'assistant' });
    const rows = await rowsOf(org.orgId, p);
    expect(rows.map((r) => ({ by: r.created_by, stage: r.general_stage }))).toEqual([{ by: org.owner.userId, stage: 'contacted' }]);

    // Appel d'un utilisateur : origine et auteur imposés (manual, l'utilisateur authentifié).
    const q = newProfileId();
    const token = await ownerToken(org);
    const own = await callFunction('unipile-search', token, {
      action: 'send_message', organization_id: org.orgId, account_id: accountId, recipient_id: q, text: 'Bonjour',
      project_id: m1, source: 'assistant', created_by: '00000000-0000-4000-8000-000000000000',
    });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    const [userLink] = await linksOf(org.orgId, q);
    expect(userLink.source).toBe('manual');
    expect((await rowsOf(org.orgId, q))[0]?.created_by).toBe(org.owner.userId);
  });

  test('file InMail avec la mission : project_id vérifié à la mise en file, lien « inmail » et « Contacté » à l’envoi', async () => {
    const tz = weekdayZone();
    test.skip(!tz, 'aucun fuseau en jour ouvré en ce moment : la file InMail n’a pas de force');
    const { org, accountId } = await trackedSendingOrg('E2E 0b D InMail');
    const other = track(await createOrg('agency', 'E2E 0b D InMail autre'));
    const m1 = await seedMission(org.orgId, org.owner.userId);
    const foreign = await seedMission(other.orgId, other.owner.userId);
    const { error: qErr } = await admin().from('member_quotas').upsert(
      { organization_id: org.orgId, user_id: org.owner.userId, business_hours_start: 0, business_hours_end: 24, timezone: tz },
      { onConflict: 'organization_id,user_id' },
    );
    if (qErr) throw new Error(`member_quotas: ${qErr.message}`);
    const token = await ownerToken(org);
    const [p, q] = [newProfileId(), newProfileId()];
    const queued = await callFunction('process-inmail-queue', token, {
      action: 'queue', user_timezone: tz, project_id: `project:${m1}`,
      items: [
        { account_id: accountId, recipient_profile_id: p, recipient_name: 'Camille Martin', subject: 'Votre parcours', message: `InMail ${rand()}`, network_distance: 2 },
        { account_id: accountId, recipient_profile_id: q, recipient_name: 'Léa Durand', subject: 'Votre parcours', message: `InMail ${rand()}`, network_distance: 2, project_id: foreign },
      ],
    });
    expect(queued.status, JSON.stringify(queued.body)).toBe(200);
    const { data: items } = await admin().from('inmail_queue').select('id, recipient_profile_id, project_id').eq('organization_id', org.orgId);
    const byRecipient = new Map((items ?? []).map((i: { recipient_profile_id: string; project_id: string | null; id: string }) => [i.recipient_profile_id, i]));
    expect(byRecipient.get(p)?.project_id, 'mission de l’appel').toBe(m1);
    expect(byRecipient.get(q)?.project_id, 'mission d’une autre organisation : ignorée').toBeNull();

    await admin().from('inmail_queue').update({ scheduled_at: minutesFromNow(-1) }).eq('id', byRecipient.get(p)!.id);
    await admin().from('inmail_queue').update({ scheduled_at: minutesFromNow(DAY) }).eq('id', byRecipient.get(q)!.id);
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await postJson('/functions/v1/process-inmail-queue', { action: 'process' }, { Authorization: `Bearer ${CRON_SECRET}` });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const { data } = await admin().from('inmail_queue').select('status').eq('id', byRecipient.get(p)!.id).single();
      if (data?.status !== 'scheduled' && data?.status !== 'pending') break;
    }
    const { data: sent } = await admin().from('inmail_queue').select('status').eq('id', byRecipient.get(p)!.id).single();
    expect(sent?.status).toBe('sent');
    const [link] = await linksOf(org.orgId, p);
    expect({ project: link.project_id, source: link.source, kind: link.last_send_kind }).toEqual({ project: m1, source: 'inmail_queue', kind: 'inmail' });
    expect(link.outbound_pending_at, 'marqueur avant le POST').not.toBeNull();
    const rows = await rowsOf(org.orgId, p);
    expect(rows.map((r) => ({ project: r.project_id, by: r.created_by, stage: r.general_stage }))).toEqual([{ project: m1, by: org.owner.userId, stage: 'contacted' }]);
  });
});

/** Fuseau où l'on est un jour ouvré, loin de minuit (la file InMail refuse le week-end). */
function weekdayZone(): string | null {
  for (const tz of ['Europe/Paris', 'Pacific/Kiritimati', 'Pacific/Apia', 'Pacific/Auckland', 'Asia/Tokyo', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Pacific/Pago_Pago']) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
    const weekday = parts.find((x) => x.type === 'weekday')?.value;
    const hour = Number(parts.find((x) => x.type === 'hour')?.value);
    if (weekday !== 'Sat' && weekday !== 'Sun' && hour >= 1 && hour <= 22) return tz;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// E. Rendez-vous Calendly
// ════════════════════════════════════════════════════════════════════════════
test.describe('E. Rendez-vous Calendly', () => {
  test.describe.configure({ mode: 'serial' });

  async function calendlyBooking(url: string, eventId: string) {
    const body = {
      event: 'invitee.created',
      payload: {
        uri: `https://api.calendly.com/scheduled_events/${eventId}/invitees/inv_${rand()}`,
        email: `camille.${rand()}@e2e.konekt.test`, name: 'Camille Martin',
        questions_and_answers: [{ question: 'Votre profil LinkedIn', answer: url }],
        scheduled_event: {
          uri: `https://api.calendly.com/scheduled_events/${eventId}`, name: CALENDLY_EVENT_NAME,
          start_time: minutesFromNow(2 * DAY), end_time: minutesFromNow(2 * DAY + 20),
        },
      },
    };
    const raw = JSON.stringify(body);
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', CALENDLY_KEY).update(`${t}.${raw}`).digest('hex');
    const res = await fetch(`${E2E.supabaseUrl}/functions/v1/calendly-webhook`, {
      method: 'POST', headers: { apikey: E2E.anonKey, 'Content-Type': 'application/json', 'Calendly-Webhook-Signature': `t=${t},v1=${sig}` }, body: raw,
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }
  async function sessionOf(eventId: string) {
    const { data } = await admin().from('qualification_sessions').select('project_id, job_id, organization_id').eq('calendly_event_id', eventId);
    return (data ?? []) as Array<{ project_id: string | null; job_id: string | null; organization_id: string | null }>;
  }
  async function steps(org: TestOrg, missionId: string) {
    const { data, error } = await admin().from('mission_process_steps').insert([
      { project_id: missionId, organization_id: org.orgId, name: 'Entretien RH', step_order: 0 },
      { project_id: missionId, organization_id: org.orgId, name: 'Entretien technique', step_order: 1 },
    ]).select('id, step_order');
    if (error || !data) throw new Error(`mission_process_steps: ${error?.message}`);
    return (data as Array<{ id: string; step_order: number }>).sort((a, b) => a.step_order - b.step_order).map((s) => s.id);
  }

  test('@critical candidat suivi dans deux missions : séance et étape dans la mission du lien ; première étape d’entretien, sinon « ITW en cours »', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b E Calendly');
    await setIntegration(org.orgId, { calendly_connected: true });
    const [m1, m3] = [await seedMission(org.orgId, org.owner.userId), await seedMission(org.orgId, org.owner.userId)];
    const [s1] = await steps(org, m3);
    const slug = `camille-0b-${rand()}`;
    const url = `https://www.linkedin.com/in/${slug}`;
    const p = newProfileId();
    const r1 = await row(org, p, m1, 'contacted', { linkedin_profile_url: url });
    const r3 = await row(org, p, m3, 'contacted', { linkedin_profile_url: url });
    // Le lien désigne M1 (envoi attribué), bien que M3 ait été contactée ensuite.
    await konektSend(org, accountId, p, m1, { slug });

    const eventId = `evt_e2e_${rand()}`;
    const res = await calendlyBooking(url, eventId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.stage_skipped).toBeUndefined();
    const [session] = await sessionOf(eventId);
    expect(session.project_id, 'séance dans la mission du rendez-vous').toBe(m1);
    const s = await candidateRowState(r1);
    expect({ stage: s.general_stage, step: s.process_step_id, pipeline: s.pipeline_stage, source: s.decision_source })
      .toEqual({ stage: 'interviewing', step: null, pipeline: 'ITW en cours', source: 'system' });
    expect(await stage(r3), 'M3 intacte').toBe('contacted');

    // Mission à étapes : la première.
    const q = newProfileId();
    const slugQ = `lea-0b-${rand()}`;
    const urlQ = `https://www.linkedin.com/in/${slugQ}`;
    const q3 = await row(org, q, m3, 'contacted', { linkedin_profile_url: urlQ });
    const eventQ = `evt_e2e_${rand()}`;
    expect((await calendlyBooking(urlQ, eventQ)).status).toBe(200);
    const sq = await candidateRowState(q3);
    expect({ stage: sq.general_stage, step: sq.process_step_id }).toEqual({ stage: 'interviewing', step: s1 });
    expect((await sessionOf(eventQ))[0].project_id).toBe(m3);
  });

  test('deux missions sans lien ni contact : séance comme avant, aucune étape (ambiguous_mission) ; un écarté reste écarté', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b E ambigu');
    await setIntegration(org.orgId, { calendly_connected: true });
    const [m1, m2] = [await seedMission(org.orgId, org.owner.userId), await seedMission(org.orgId, org.owner.userId)];
    const slug = `camille-amb-${rand()}`;
    const url = `https://www.linkedin.com/in/${slug}`;
    const p = newProfileId();
    const a = await row(org, p, m1, 'retained', { linkedin_profile_url: url });
    const b = await row(org, p, m2, 'retained', { linkedin_profile_url: url });
    const eventId = `evt_e2e_${rand()}`;
    const res = await calendlyBooking(url, eventId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.stage_skipped).toBe('ambiguous_mission');
    expect(await sessionOf(eventId)).toHaveLength(1);
    expect([await stage(a), await stage(b)]).toEqual(['retained', 'retained']);

    // Seule mission, candidat écarté : la séance est créée, l'écart est gardé.
    const q = newProfileId();
    const slugQ = `lea-rej-${rand()}`;
    const urlQ = `https://www.linkedin.com/in/${slugQ}`;
    const rejected = await row(org, q, m1, 'rejected', { linkedin_profile_url: urlQ });
    await konektSend(org, accountId, q, m1, { slug: slugQ });
    const eventQ = `evt_e2e_${rand()}`;
    expect((await calendlyBooking(urlQ, eventQ)).status).toBe(200);
    expect(await stage(rejected), 'écarté : gardé').toBe('rejected');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// F. Analyse d'une réponse : résumé et rattrapage borné
// ════════════════════════════════════════════════════════════════════════════
test.describe('F. auto-analyze-message', () => {
  test.describe.configure({ mode: 'serial' });

  function chatRoutes(candidateId: string, messages: Array<{ text: string; is_sender: boolean; timestamp: string }>): MockRoute[] {
    return [
      { method: 'GET', url: 'e2e=/api/v1/chats/[^/?]+/messages', status: 200, body: { object: 'MessageList', items: [...messages].reverse(), cursor: null } },
      {
        method: 'GET', url: 'e2e=/api/v1/chats/[^/?]+$', status: 200, body: {
          object: 'Chat', attendee_provider_id: candidateId,
          attendees: [{ is_self: true, provider_id: 'ACoAAMOCKME' }, { is_self: false, provider_id: candidateId, display_name: 'Camille Martin' }],
        },
      },
    ];
  }
  function analyze(org: TestOrg, accountId: string, chatId: string, senderId: string) {
    return postJson('/functions/v1/auto-analyze-message', { chat_id: chatId, account_id: accountId, sender_id: senderId, organization_id: org.orgId },
      { Authorization: `Bearer ${E2E.serviceRoleKey}` });
  }

  test('@critical message du candidat après le premier contact : « A répondu » dans la mission de la conversation et résumé ; recommandation et autres missions intactes ; avant le contact : rien', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b F analyse');
    const [m1, m2] = [await seedMission(org.orgId, org.owner.userId), await seedMission(org.orgId, org.owner.userId)];
    const p = newProfileId();
    const marker = `MARQ${rand()}`;
    const summary = `Intéressé par la mission ${marker}`;
    const r1 = await row(org, p, m1, 'contacted', { recommendation: 'Profil solide' });
    const r2 = await row(org, p, m2, 'retained');
    const chat = `chat_${rand()}`;
    await konektSend(org, accountId, p, m1, { chatId: chat });
    // Identifiants propres à l'organisation : conversation et messages scriptés pour ce compte.
    await setIntegration(org.orgId, { unipile_connected: true, unipile_api_key: 'mock-key', unipile_dsn: `unipile.mock?account_id=${accountId}&e2e=` });
    cleanups.push(() => setMockMode(accountId, {}));
    await setMockMode(accountId, {
      routes: chatRoutes(p, [
        { text: 'Bonjour, une mission pour vous', is_sender: true, timestamp: minutesFromNow(-5) },
        { text: `Oui, avec plaisir ${marker}`, is_sender: false, timestamp: minutesFromNow(1) },
      ]),
      ai_markers: { [marker]: JSON.stringify({ intent: 'interested', confidence: 90, summary }) },
    });

    const res = await analyze(org, accountId, chat, p);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s1 = await candidateRowState(r1);
    expect({ stage: s1.general_stage, source: s1.decision_source, summary: s1.reply_summary, reco: s1.recommendation })
      .toEqual({ stage: 'replied', source: 'system', summary, reco: 'Profil solide' });
    const s2 = await candidateRowState(r2);
    expect({ stage: s2.general_stage, summary: s2.reply_summary }, 'autre mission intacte').toEqual({ stage: 'retained', summary: null });

    // Message du candidat antérieur au premier contact dans la mission : rien.
    const q = newProfileId();
    const q1 = await row(org, q, m1, 'contacted');
    const chatQ = `chat_${rand()}`;
    await konektSend(org, accountId, q, m1, { chatId: chatQ });
    await setMockMode(accountId, { routes: chatRoutes(q, [{ text: 'Ancien message', is_sender: false, timestamp: minutesFromNow(-3 * DAY) }]) });
    const resQ = await analyze(org, accountId, chatQ, q);
    expect(resQ.status, JSON.stringify(resQ.body)).toBe(200);
    expect(await stage(q1), 'message antérieur au premier contact : rien').toBe('contacted');
  });

  test('@critical candidat effacé (RGPD) qui écrit : ni lien, ni étape, ni résumé, par le webhook comme par l’analyse', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b F effacé');
    const m1 = await seedMission(org.orgId, org.owner.userId);
    const p = newProfileId();
    const marker = `MARQ${rand()}`;
    const slug = `camille-efface-0b-${rand()}`;
    const r1 = await row(org, p, m1, 'contacted', { linkedin_profile_url: `https://www.linkedin.com/in/${slug}` });
    // Empreinte de l'URL du profil dans le registre (effacement passé : liens déjà supprimés).
    const urlHash = createHash('sha256').update(`https://www.linkedin.com/in/${slug}`).digest('hex');
    const { data: erasure, error } = await admin().from('gdpr_erasures').insert({ linkedin_url_hash: urlHash, source: 'e2e' }).select('id').single();
    if (error) throw new Error(`gdpr_erasures: ${error.message}`);
    cleanups.push(() => admin().from('gdpr_erasures').delete().eq('id', (erasure as { id: string }).id));
    const chat = `chat_${rand()}`;
    await setIntegration(org.orgId, { unipile_connected: true, unipile_api_key: 'mock-key', unipile_dsn: `unipile.mock?account_id=${accountId}&e2e=` });
    cleanups.push(() => setMockMode(accountId, {}));
    await setMockMode(accountId, {
      routes: [attendeesRoute(p), ...chatRoutes(p, [
        { text: 'Bonjour, une mission pour vous', is_sender: true, timestamp: minutesFromNow(-3 * DAY) },
        { text: `Je reviens vers vous ${marker}`, is_sender: false, timestamp: minutesFromNow(0) },
      ])],
      ai_markers: { [marker]: JSON.stringify({ intent: 'interested', confidence: 90, summary: `Résumé ${marker}` }) },
    });
    const before = await candidateRowState(r1);

    // Réponse au webhook, puis analyse sans le drapeau du webhook (pire cas : rattrapage demandé).
    await webhook(messageReceived(accountId, p, { chatId: chat, attendeeId: 'att_cand' }));
    const res = await analyze(org, accountId, chat, p);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // L'analyse lancée sans attente par le webhook a eu le temps de finir.
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    expect(await linksOf(org.orgId, p), 'aucun lien recréé').toEqual([]);
    const after = await candidateRowState(r1);
    expect(after, 'étape, dates et résumé inchangés').toEqual(before);
    expect(after.reply_summary).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G. Preuve d'envoi et « Marquer comme répondu »
// ════════════════════════════════════════════════════════════════════════════
test.describe('G. Preuve d’envoi', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical Retenu avec un envoi prouvé dans la mission : la réponse fait « Contacté » puis « A répondu » ; sans envoi prouvé : ligne intacte', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b G preuve');
    const m1 = await seedMission(org.orgId, org.owner.userId);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    await admin().from('outreach_sequences').update({ project_id: m1 }).eq('id', sequenceId);

    const withProof = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, withProof.enrollmentId, steps[0], { status: 'sent', scheduled_at: minutesFromNow(-DAY), executed_at: minutesFromNow(-DAY) });
    const proved = await row(org, withProof.profileId, m1, 'retained');
    const withoutProof = await enroll(org, sequenceId, org.owner.userId, accountId);
    const unproved = await row(org, withoutProof.profileId, m1, 'retained');

    await webhook(messageReceived(accountId, withProof.profileId));
    await webhook(messageReceived(accountId, withoutProof.profileId));

    const s = await candidateRowState(proved);
    expect({ stage: s.general_stage, source: s.decision_source }).toEqual({ stage: 'replied', source: 'system' });
    expect(s.contacted_at, '« Contacté » manqué posé').not.toBeNull();
    expect(s.replied_at).not.toBeNull();
    const u = await candidateRowState(unproved);
    expect({ stage: u.general_stage, contacted: u.contacted_at, replied: u.replied_at }, 'sans envoi prouvé : not_contacted')
      .toEqual({ stage: 'retained', contacted: null, replied: null });
    const { data: enrs } = await admin().from('sequence_enrollments').select('id, status').in('id', [withProof.enrollmentId, withoutProof.enrollmentId]);
    for (const e of enrs ?? []) expect((e as { status: string }).status, 'inscriptions closes par la réponse').toBe('replied');
  });

  test('« Marquer comme répondu » : mission de l’inscription d’abord, même si un message manuel plus récent vise une autre mission', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E 0b G marquer');
    const [m1, m2] = [await seedMission(org.orgId, org.owner.userId), await seedMission(org.orgId, org.owner.userId)];
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    await admin().from('outreach_sequences').update({ project_id: m1 }).eq('id', sequenceId);
    const a = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, a.enrollmentId, steps[0], { status: 'sent', scheduled_at: minutesFromNow(-2 * DAY), executed_at: minutesFromNow(-2 * DAY) });
    const rA = await row(org, a.profileId, m1, 'retained');
    const rB = await row(org, a.profileId, m2, 'contacted');
    // Message manuel plus récent, attribué à M2.
    await konektSend(org, accountId, a.profileId, m2, { chatId: `chat_${rand()}` });

    const token = await ownerToken(org);
    const res = await callFunction('process-sequences', token, { action: 'mark_replied', organization_id: org.orgId, enrollment_id: a.enrollmentId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await stage(rA), 'mission de l’inscription').toBe('replied');
    expect(await stage(rB), 'autre mission intacte').toBe('contacted');
  });
});

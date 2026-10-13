/**
 * Correctifs des envois (PR des correctifs séquences), contre la stack locale
 * (e2e/local-stack) : moteur process-sequences et unipile-search exécutés pour
 * de vrai, LinkedIn simulé par vendor-mock.mjs.
 *
 *   A. Condition « rendez-vous pris » du moteur : une séance lue dans un agenda
 *      relié (qualification_sessions.source = 'agenda') n'arrête pas la
 *      séquence (plan agenda, « Effets sur le candidat » : aucun) ; une séance
 *      saisie (manual) ou une réservation (booking) l'arrête, comme avant.
 *   B. Correctif 4 du plan du lot 5 : send_message refuse l'envoi à un
 *      candidat effacé (RGPD), pour tout appelant (fenêtre de message et fiche,
 *      messagerie, assistant) : erreur CANDIDATE_ERASED rendue, aucun envoi au
 *      faux LinkedIn, ni marqueur, ni lien, ni « Contacté », ni place prise
 *      dans le plafond LinkedIn. Avant : seule l'écriture était sautée, le
 *      message partait.
 *
 * Non couvert ici : registre illisible (GDPR_UNVERIFIED), qu'on ne sait pas
 * provoquer sans casser la base partagée ; garde statique dans
 * tests/c1/correctifs-envois.test.mjs.
 *
 * @critical
 */
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { E2E } from '../helpers/env';
import {
  admin,
  candidateRowState,
  deleteOrg,
  seedCandidateRow,
  seedMission,
  seedMissionConversation,
  signIn,
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
  sentTexts,
  setMockMode,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(240_000);

// ─── Textes du contrat ──────────────────────────────────────────────────────
const MEETING_STOP_REASON = 'Stop condition: meeting booked (Calendly)';
const STOP_ON_MEETING = { on_reply: true, on_unsubscribe: true, on_click: false, on_meeting_booked: true };

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];
test.afterEach(async () => {
  while (cleanups.length) await Promise.resolve(cleanups.pop()!()).catch(() => undefined);
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    for (const table of ['qualification_sessions', 'notifications', 'job_candidate_status', 'mission_conversations', 'linkedin_action_log']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});

async function trackedSendingOrg(prefix: string) {
  const res = await sendingOrg(prefix);
  orgsToDelete.push({ org: res.org, extra: [] });
  return res;
}
async function ownerToken(org: TestOrg) {
  return (await signIn(org.owner.email, org.owner.password)).access_token;
}

// ════════════════════════════════════════════════════════════════════════════
// A. Rendez-vous et séances d'agenda
// ════════════════════════════════════════════════════════════════════════════

/** Séance de l'organisation, créée maintenant (après le début des inscriptions). */
async function insertSession(org: TestOrg, fields: Record<string, unknown>) {
  const { data, error } = await admin().from('qualification_sessions').insert({
    organization_id: org.orgId,
    created_by: org.owner.userId,
    status: 'scheduled',
    event_start_at: minutesFromNow(2 * 24 * 60),
    event_end_at: minutesFromNow(2 * 24 * 60 + 30),
    ...fields,
  }).select('id').single();
  if (error || !data) throw new Error(`qualification_sessions: ${error?.message}`);
  return data.id as string;
}

type Exec = { id: string; step_order: number; status: string; skip_reason: string | null };
async function execsOf(enrollmentId: string): Promise<Exec[]> {
  const { data } = await admin().from('sequence_step_executions')
    .select('id, step_order, status, skip_reason').eq('enrollment_id', enrollmentId)
    .order('created_at', { ascending: true });
  return (data ?? []) as Exec[];
}
async function enrollmentOf(id: string) {
  const { data, error } = await admin().from('sequence_enrollments').select('status, tracking_data').eq('id', id).single();
  if (error || !data) throw new Error(`sequence_enrollments ${id}: ${error?.message}`);
  return data as { status: string; tracking_data: Record<string, unknown> | null };
}

/** Cycles jusqu'à ce que ces exécutions ne soient plus échues en attente. */
async function cycleFor(...execIds: string[]) {
  for (let i = 0; i < 5; i++) {
    await runCycle();
    const { data } = await admin().from('sequence_step_executions').select('status, scheduled_at').in('id', execIds);
    const pending = ((data ?? []) as Array<{ status: string; scheduled_at: string }>)
      .filter((r) => r.status === 'scheduled' && new Date(r.scheduled_at).getTime() <= Date.now());
    if (pending.length === 0) return;
  }
}

test.describe('A. Rendez-vous et séances d’agenda', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical une séance d’agenda créée après l’inscription n’arrête pas la séquence ; une séance saisie ou réservée l’arrête', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E correctifs agenda');
    const marker = `AGD${rand()}`;
    const seeded = await messageSequence(org, org.owner.userId, [`Bonjour ${marker}`, `Relance ${marker}`]);
    const { error } = await admin().from('outreach_sequences').update({ stop_conditions: STOP_ON_MEETING }).eq('id', seeded.sequenceId);
    if (error) throw new Error(`stop_conditions: ${error.message}`);
    const [first, second] = seeded.steps;

    // Inscriptions commencées il y a une heure, un profil chacune, même compte.
    const since = minutesFromNow(-60);
    const agenda = await enroll(org, seeded.sequenceId, org.owner.userId, accountId, { created_at: since });
    const manual = await enroll(org, seeded.sequenceId, org.owner.userId, accountId, { created_at: since });
    const booking = await enroll(org, seeded.sequenceId, org.owner.userId, accountId, { created_at: since });

    // Séances créées maintenant, après le début des inscriptions, même profil, même organisation.
    await insertSession(org, { candidate_profile_id: agenda.profileId, source: 'agenda', external_event_id: `evt_agenda_${rand()}`, event_name: 'Point hebdomadaire' });
    const manualSession = await insertSession(org, { candidate_profile_id: manual.profileId, source: 'manual', event_name: 'Entretien' });
    const bookingSession = await insertSession(org, { candidate_profile_id: booking.profileId, source: 'booking', calendly_event_id: `evt_${rand()}${rand()}`, event_name: 'Échange de présentation' });

    const execAgenda = await schedule(org, agenda.enrollmentId, first);
    const execManual = await schedule(org, manual.enrollmentId, first);
    const execBooking = await schedule(org, booking.enrollmentId, first);
    await cycleFor(execAgenda, execManual, execBooking);

    // Agenda : l'étape part, l'inscription reste active, la relance est programmée.
    const agendaExecs = await execsOf(agenda.enrollmentId);
    const agendaFirst = agendaExecs.find((e) => e.id === execAgenda)!;
    expect(agendaFirst.skip_reason, 'agenda : pas d’arrêt « rendez-vous pris »').not.toBe(MEETING_STOP_REASON);
    expect(agendaFirst.status, 'agenda : le premier message part').toBe('sent');
    expect((await enrollmentOf(agenda.enrollmentId)).status, 'agenda : inscription active').toBe('active');
    expect(agendaExecs.filter((e) => e.step_order === second.step_order).map((e) => e.status), 'agenda : relance programmée')
      .toEqual(['scheduled']);
    expect(await sentTexts(accountId), 'un seul envoi : celui de l’inscription de la séance d’agenda').toEqual([`Bonjour ${marker}`]);

    // Saisie et réservation : arrêt, comme avant.
    for (const c of [
      { label: 'séance saisie', enrollmentId: manual.enrollmentId, execId: execManual, sessionId: manualSession },
      { label: 'réservation', enrollmentId: booking.enrollmentId, execId: execBooking, sessionId: bookingSession },
    ]) {
      const exec = (await execsOf(c.enrollmentId)).find((e) => e.id === c.execId)!;
      expect.soft(exec.status, `${c.label} : étape annulée`).toBe('cancelled');
      expect.soft(exec.skip_reason, `${c.label} : motif d’arrêt inchangé`).toBe(MEETING_STOP_REASON);
      const closed = await enrollmentOf(c.enrollmentId);
      expect.soft(closed.status, `${c.label} : inscription close`).toBe('completed');
      expect.soft(closed.tracking_data?.completion_reason, c.label).toBe('meeting_booked');
      expect.soft(closed.tracking_data?.qualification_session_id, `${c.label} : séance gardée`).toBe(c.sessionId);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. Envoi à un candidat effacé (correctif 4)
// ════════════════════════════════════════════════════════════════════════════

const newProfileId = () => `ACoAAE2EGD${rand()}${rand()}`;

/** Candidat Retenu dans une mission de l'organisation, effacé au registre global (par son URL). */
async function erasedCandidate(org: TestOrg) {
  const missionId = await seedMission(org.orgId, org.owner.userId);
  const candidateId = newProfileId();
  const url = `https://www.linkedin.com/in/lea-efface-envoi-${rand()}`;
  const { id: rowId } = await seedCandidateRow({
    orgId: org.orgId, createdBy: org.owner.userId, candidateId, missionId, stage: 'retained', extra: { linkedin_profile_url: url },
  });
  const urlHash = createHash('sha256').update(url).digest('hex');
  const { data: erasure, error } = await admin().from('gdpr_erasures').insert({ linkedin_url_hash: urlHash, source: 'e2e' }).select('id').single();
  if (error || !erasure) throw new Error(`gdpr_erasures: ${error?.message}`);
  cleanups.push(() => admin().from('gdpr_erasures').delete().eq('id', (erasure as { id: string }).id));
  return { missionId, candidateId, rowId };
}

async function linksOf(orgId: string, candidateId: string) {
  const { data, error } = await admin().from('mission_conversations')
    .select('id, project_id, chat_id, source, outbound_pending_at, last_outbound_at, last_mission_send_at')
    .eq('organization_id', orgId)
    .or(`candidate_id.eq.${candidateId},candidate_ids.cs.{${candidateId}}`);
  if (error) throw new Error(`mission_conversations: ${error.message}`);
  return data ?? [];
}
async function rowsOf(orgId: string, candidateId: string) {
  const { data } = await admin().from('job_candidate_status').select('id, general_stage').eq('organization_id', orgId).eq('candidate_id', candidateId);
  return (data ?? []) as Array<{ id: string; general_stage: string }>;
}
/** Places prises dans le plafond LinkedIn par ce compte. */
async function actionLog(accountId: string) {
  const { data } = await admin().from('linkedin_action_log').select('action_type, source').eq('account_id', accountId);
  return (data ?? []) as Array<{ action_type: string; source: string | null }>;
}
/** Appels au faux prestataire dont la requête contient `marker` (tous comptes). */
async function callsWith(marker: string) {
  return (await mockCalls()).filter((c) => JSON.stringify(c).includes(marker));
}
function sendMessage(token: string, org: TestOrg, accountId: string, body: Record<string, unknown>) {
  return callFunction('unipile-search', token, { action: 'send_message', organization_id: org.orgId, account_id: accountId, ...body });
}
function expectErasedRefusal(res: { status: number; body: Record<string, unknown> }) {
  expect(res.status, JSON.stringify(res.body)).toBe(403);
  expect(res.body.success).toBe(false);
  expect(res.body.error_code).toBe('CANDIDATE_ERASED');
  // Phrase française lisible telle quelle à l'écran : ni nombre, ni mot réécrit par humanizeError.
  expect(String(res.body.error)).toMatch(/effacement de ses données/);
  expect(String(res.body.error)).not.toMatch(/\d|forbidden|not found|error/i);
}

test.describe('B. Envoi à un candidat effacé (correctif 4)', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical fenêtre de message et fiche (nouvelle conversation, message ou InMail) : refus, rien ne part ni ne s’écrit ; témoin non effacé envoyé', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E correctifs effacé fenêtre');
    const token = await ownerToken(org);
    const { missionId, candidateId, rowId } = await erasedCandidate(org);
    const before = await candidateRowState(rowId);

    for (const variant of [{ label: 'message', extra: {} }, { label: 'InMail', extra: { is_inmail: true, subject: 'Votre parcours' } }]) {
      const marker = `ERS${rand()}`;
      const res = await sendMessage(token, org, accountId, {
        recipient_id: candidateId, project_id: `project:${missionId}`, text: `Bonjour ${marker}`, ...variant.extra,
      });
      expectErasedRefusal(res);
      expect(await callsWith(marker), `${variant.label} : aucun appel au faux LinkedIn`).toEqual([]);
    }
    expect(await mockCalls(accountId), 'journal du faux LinkedIn vide pour ce compte').toEqual([]);
    expect(await linksOf(org.orgId, candidateId), 'ni marqueur ni lien').toEqual([]);
    expect(await candidateRowState(rowId), 'aucun « Contacté »').toEqual(before);
    expect((await rowsOf(org.orgId, candidateId)).map((r) => r.id), 'aucune ligne créée').toEqual([rowId]);
    expect(await actionLog(accountId), 'aucune place prise dans le plafond LinkedIn').toEqual([]);

    // Témoin : le même envoi à un candidat non effacé part et s'enregistre.
    const other = newProfileId();
    const witnessText = `Bonjour ${rand()}`;
    const ok = await sendMessage(token, org, accountId, { recipient_id: other, project_id: `project:${missionId}`, text: witnessText });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await sentTexts(accountId), 'témoin envoyé').toEqual([witnessText]);
    expect((await rowsOf(org.orgId, other)).map((r) => r.general_stage), 'témoin « Contacté »').toEqual(['contacted']);
    expect((await actionLog(accountId)).map((r) => r.action_type), 'témoin : une place prise').toEqual(['message']);
  });

  test('messagerie (conversation existante, liée ou non, avec recipient_id d’un autre profil ou chat_id encodé) : refus avant tout envoi dans la conversation', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E correctifs effacé messagerie');
    const token = await ownerToken(org);
    const { missionId, candidateId, rowId } = await erasedCandidate(org);
    const before = await candidateRowState(rowId);
    // Conversation non liée : candidat lu dans les participants. Conversation liée à la mission : candidat du lien.
    const unlinked = `chat_e2e_gd_${rand()}${rand()}`;
    const linked = `chat_e2e_gd_${rand()}${rand()}`;
    const linkId = await seedMissionConversation({ orgId: org.orgId, projectId: missionId, accountId, candidateId, chatId: linked });
    const [link] = await linksOf(org.orgId, candidateId);
    await setMockMode(accountId, { routes: [
      { unscoped: true, method: 'GET', path: `^/api/v1/chats/${unlinked}$`, body: { id: unlinked, account_id: accountId, type: 0 } },
      { unscoped: true, method: 'GET', path: `^/api/v1/chats/${linked}$`, body: { id: linked, account_id: accountId, type: 0 } },
      { unscoped: true, method: 'GET', path: `^/api/v1/chats/${unlinked}/attendees$`, body: { items: [
        { object: 'ChatAttendee', id: 'att_self', provider_id: 'ACoAAMOCKME', is_self: 1 },
        { object: 'ChatAttendee', id: 'att_cand', provider_id: candidateId, is_self: 0 },
      ] } },
    ] });
    cleanups.push(() => setMockMode(accountId, {}));

    // Avec chat_id, le message part dans la conversation : ni un recipient_id
    // d'un autre profil, non effacé, ni un chat_id encodé (que l'envoi décode)
    // ne font passer l'envoi, et le profil de recipient_id ne reçoit rien.
    const other = newProfileId();
    for (const chatId of [unlinked, linked]) {
      const encoded = `%${chatId.charCodeAt(0).toString(16)}${chatId.slice(1)}`;
      for (const body of [{ chat_id: chatId }, { chat_id: chatId, recipient_id: other }, { chat_id: encoded }]) {
        const res = await sendMessage(token, org, accountId, { ...body, text: `Bonjour ${rand()}` });
        expectErasedRefusal(res);
      }
      const calls = (await mockCalls()).filter((c) => c.path.includes(chatId.slice(1)));
      expect(calls.filter((c) => c.method !== 'GET'), `${chatId} : aucun envoi dans la conversation`).toEqual([]);
    }
    // Seules lectures : compte de chaque conversation, participants de la conversation non liée.
    const reads = [...new Set((await mockCalls())
      .filter((c) => c.path.includes(unlinked.slice(1)) || c.path.includes(linked.slice(1)))
      .map((c) => `${c.method} ${c.path}`))].sort();
    expect(reads).toEqual([
      `GET /api/v1/chats/${linked}`,
      `GET /api/v1/chats/${unlinked}`,
      `GET /api/v1/chats/${unlinked}/attendees`,
    ].sort());
    expect(await linksOf(org.orgId, candidateId), 'lien intact, aucun marqueur').toEqual([link]);
    expect(link.id).toBe(linkId);
    expect(await candidateRowState(rowId), 'aucun « Contacté »').toEqual(before);
    expect(await linksOf(org.orgId, other), 'recipient_id : ni marqueur ni lien').toEqual([]);
    expect(await rowsOf(org.orgId, other), 'recipient_id : aucune ligne ni « Contacté »').toEqual([]);
    expect(await actionLog(accountId), 'aucune place prise dans le plafond LinkedIn').toEqual([]);
  });

  test('assistant (appel interne) : même refus, rien ne part', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E correctifs effacé assistant');
    const { missionId, candidateId, rowId } = await erasedCandidate(org);
    const before = await candidateRowState(rowId);
    const marker = `ERA${rand()}`;
    const res = await postJson('/functions/v1/unipile-search', {
      action: 'send_message', organization_id: org.orgId, account_id: accountId, recipient_id: candidateId,
      text: `Bonjour ${marker}`, project_id: missionId, source: 'assistant', created_by: org.owner.userId,
    }, { Authorization: `Bearer ${E2E.serviceRoleKey}` });
    expectErasedRefusal(res);
    expect(await callsWith(marker)).toEqual([]);
    expect(await mockCalls(accountId)).toEqual([]);
    expect(await linksOf(org.orgId, candidateId)).toEqual([]);
    expect(await candidateRowState(rowId)).toEqual(before);
  });
});

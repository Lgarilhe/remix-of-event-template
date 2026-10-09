/**
 * Décisions produit du lot « réponses » (docs/audit-2026-09-25-sequences.md,
 * « Décisions produit en attente »), jouées contre la stack locale :
 *
 * - 8 : une réponse reçue sur une inscription terminée (réponse à la dernière
 *   relance) la passe « A répondu », compte une réponse et met à jour le
 *   pipeline (unipile-webhook, message LinkedIn).
 * - 10 : échec persistant de l'arrêt des autres inscriptions du candidat : le
 *   webhook répond 500 (rejeu) ET le recruteur est prévenu, une seule fois ;
 *   sans séquence ni mission (InMails seuls), l'alerte ouvre la fiche du
 *   candidat (décision du 07/10/2026).
 * - 11 : format new_message sans indication d'expéditeur, vérification
 *   impossible : échec (500) et rejeu, rien n'est clos.
 * - 27 : un rendez-vous annule aussi les InMails en attente vers le candidat
 *   (calendly-webhook ; arrêt du moteur sur condition « rendez-vous pris »,
 *   en attente du correctif de process-sequences, hors de ce lot).
 *
 * Contrat : CLAUDE.md, « Séquences : règles du moteur et de l'interface »
 * (réponse d'un candidat, contrat §8 pour une inscription terminée).
 *
 * Pannes simulées par un déclencheur temporaire posé par psql, limité aux
 * lignes du test et retiré en fin de test (même procédé que
 * seq-reply-replay.spec.ts). Réponses du faux prestataire scriptées par compte
 * seulement, jamais sur la clé '*'. Ignoré sans la stack locale.
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  candidateRowState,
  deleteOrg,
  seedCandidateRowFromLegacy,
  seedLinkedInAccount,
  seedMission,
  type SeededStep,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  WEBHOOK_SECRET,
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
  webhook,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(240_000);

// ─── Textes du contrat ──────────────────────────────────────────────────────
const DAY = 24 * 60;
const SIBLING_REPLY_SKIP_REASON = "Le candidat a répondu sur un autre compte de l'organisation";
const ALERT_SOURCE = 'reply_sibling_stop_failed';
const ALERT_TITLE = 'Relances non arrêtées après une réponse';
const MEETING_INMAIL_REASON = 'Rendez-vous pris avec le candidat';
const CALENDLY_EVENT_NAME = '📅 20 min pour présentation poste - Equipe Konekt';
const CALENDLY_KEY = process.env.E2E_CALENDLY_SIGNING_KEY ?? '';

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => unknown> = [];
test.afterEach(async () => {
  while (cleanups.length) {
    try { await cleanups.pop()!(); } catch { /* au mieux */ }
  }
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    for (const table of [
      'job_candidate_status', 'notifications', 'inmail_queue', 'qualification_sessions',
      'organization_integrations', 'member_email_accounts',
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
async function memberWithAccount(org: TestOrg, role: 'member' | 'collaborator' = 'member') {
  const user = await addMember(org.orgId, role, 'decrep');
  orgsToDelete.find((o) => o.org.orgId === org.orgId)?.extra.push(user);
  const accountId = await seedLinkedInAccount(org.orgId, user.userId, `acc_dr_${rand()}`, 'OK');
  return { user, accountId };
}

// ─── Panne simulée (psql) ───────────────────────────────────────────────────
function psql(sql: string): string {
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql],
    { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' },
  );
}
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
/** L'arrêt des inscriptions `ids` (passage à 'stopped') échoue tant que la panne n'est pas retirée. */
function failSiblingStop(ids: string[]): () => void {
  const name = `e2e_dr_fail_${rand()}`;
  psql(
    `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'échec simulé (e2e décisions réponse)'; END $f$;` +
    `CREATE TRIGGER ${name} BEFORE UPDATE ON public.sequence_enrollments FOR EACH ROW WHEN (NEW.status = 'stopped' AND OLD.id IN (${ids.map(lit).join(', ')})) EXECUTE FUNCTION public.${name}();`,
  );
  let dropped = false;
  const drop = () => {
    if (dropped) return;
    dropped = true;
    psql(`DROP TRIGGER IF EXISTS ${name} ON public.sequence_enrollments; DROP FUNCTION IF EXISTS public.${name}();`);
  };
  cleanups.push(drop);
  return drop;
}

/** L'annulation des InMails `ids` (passage à 'cancelled') échoue tant que la panne n'est pas retirée. */
function failInMailCancel(ids: string[]): void {
  const name = `e2e_dr_fail_${rand()}`;
  psql(
    `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'échec simulé (e2e décisions réponse)'; END $f$;` +
    `CREATE TRIGGER ${name} BEFORE UPDATE ON public.inmail_queue FOR EACH ROW WHEN (NEW.status = 'cancelled' AND OLD.id IN (${ids.map(lit).join(', ')})) EXECUTE FUNCTION public.${name}();`,
  );
  cleanups.push(() => psql(`DROP TRIGGER IF EXISTS ${name} ON public.inmail_queue; DROP FUNCTION IF EXISTS public.${name}();`));
}

// ─── Lectures ───────────────────────────────────────────────────────────────
type Enr = {
  status: string; pause_reason: string | null; replied_at: string | null; completed_at: string | null;
  updated_at: string; resolved_profile_id: string | null;
};
async function enr(id: string): Promise<Enr> {
  const { data, error } = await admin().from('sequence_enrollments')
    .select('status, pause_reason, replied_at, completed_at, updated_at, resolved_profile_id').eq('id', id).single();
  if (error || !data) throw new Error(`enr ${id}: ${error?.message}`);
  return data as Enr;
}
type Exec = { status: string; skip_reason: string | null };
async function exec(id: string): Promise<Exec> {
  const { data, error } = await admin().from('sequence_step_executions').select('status, skip_reason').eq('id', id).single();
  if (error || !data) throw new Error(`exec ${id}: ${error?.message}`);
  return data as Exec;
}
async function replies(sequenceId: string): Promise<number> {
  const { data } = await admin().from('sequence_analytics').select('replies_received').eq('sequence_id', sequenceId);
  return ((data ?? []) as Array<{ replies_received: number | null }>).reduce((s, r) => s + (r.replies_received ?? 0), 0);
}
type Notif = { id: string; user_id: string; type: string; title: string; body: string | null; link: string | null; metadata: Record<string, unknown> | null };
async function notificationsOf(orgId: string, type?: string): Promise<Notif[]> {
  let q = admin().from('notifications').select('id, user_id, type, title, body, link, metadata').eq('organization_id', orgId);
  if (type) q = q.eq('type', type);
  const { data } = await q;
  return (data ?? []) as Notif[];
}
async function alertsOf(orgId: string) {
  return (await notificationsOf(orgId, 'action')).filter((n) => n.metadata?.source === ALERT_SOURCE);
}
async function dedupRows(eventKey: string): Promise<number> {
  const { data } = await admin().from('webhook_event_log').select('event_key').eq('event_key', eventKey);
  return (data ?? []).length;
}
// Refonte mission, lot 0b : étape dérivée de l'ancien couple et posée par set_candidate_stage.
async function jcs(orgId: string, createdBy: string, jobId: string, candidateId: string, o: Record<string, unknown> = {}) {
  const { status = 'messaged', pipeline_stage = null, ...extra } = o as { status?: string; pipeline_stage?: string | null };
  const { id } = await seedCandidateRowFromLegacy({
    orgId, createdBy, candidateId, missionId: jobId, status, pipelineStage: pipeline_stage,
    extra: { candidate_name: 'Camille Martin', ...extra },
  });
  return id;
}
async function jcsRow(id: string) {
  const { data } = await admin().from('job_candidate_status').select('status, pipeline_stage').eq('id', id).single();
  return data as { status: string; pipeline_stage: string | null };
}
async function inmailRow(id: string) {
  const { data } = await admin().from('inmail_queue').select('status, error_message, updated_at').eq('id', id).single();
  return data as { status: string; error_message: string | null; updated_at: string };
}
const ts = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

// ─── Appels ─────────────────────────────────────────────────────────────────
function rawWebhook(payload: Record<string, unknown>) {
  return postJson('/functions/v1/unipile-webhook', payload, { 'unipile-auth': WEBHOOK_SECRET });
}
/** Message du candidat, format à plat (message_received), identifiant fixe pour le rejeu. */
function replyFrom(accountId: string, profileId: string, o: { chatId?: string } = {}) {
  const messageId = `msg_dr_${rand()}${rand()}`;
  return {
    messageId,
    eventKey: `unipile:message_received:${messageId}`,
    payload: {
      event: 'message_received',
      account_id: accountId,
      account_type: 'LINKEDIN',
      chat_id: o.chatId ?? `chat_dr_${rand()}${rand()}`,
      message_id: messageId,
      message: 'Bonjour, désolé pour le délai, je suis intéressé',
      sender: { attendee_provider_id: profileId, attendee_id: 'att_candidate', attendee_name: 'Camille Martin' },
    },
  };
}
/** Message au format new_message imbriqué ; `message` complète ou remplace les champs par défaut. */
function newMessage(accountId: string, profileId: string, message: Record<string, unknown> = {}) {
  const id = `m_dr_${rand()}${rand()}`;
  return {
    eventKey: `unipile:new_message:${id}`,
    payload: {
      event: 'new_message',
      account_id: accountId,
      data: { message: { id, chat_id: `chat_dr_${rand()}${rand()}`, sender: { provider_id: profileId }, ...message } },
    },
  };
}
/** Rendez-vous signé (t=…,v1=HMAC(t.body)), candidat désigné par son URL de profil. */
async function booking(linkedinUrl: string) {
  const eventId = `evt_dr_${rand()}`;
  const body = {
    event: 'invitee.created',
    payload: {
      uri: `https://api.calendly.com/scheduled_events/${eventId}/invitees/inv_${rand()}`,
      email: `camille.${rand()}@e2e.konekt.test`,
      name: 'Camille Martin',
      questions_and_answers: [{ question: 'Votre profil LinkedIn', answer: linkedinUrl }],
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
  const res = await fetch(`${E2E.supabaseUrl}/functions/v1/calendly-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: E2E.anonKey, 'Calendly-Webhook-Signature': `t=${t},v1=${sig}` },
    body: raw,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
async function setIntegration(orgId: string, patch: Record<string, unknown>) {
  const { error } = await admin().from('organization_integrations')
    .upsert({ organization_id: orgId, ...patch }, { onConflict: 'organization_id' });
  if (error) throw new Error(`organization_integrations: ${error.message}`);
}

// ─── Seeds ──────────────────────────────────────────────────────────────────
const newProfileId = () => `ACoAAE2EDR${rand()}${rand()}`;

/**
 * Inscription terminée : deux messages partis (le dernier il y a un jour),
 * fin posée à la même date, séquence rattachée à `missionId`.
 */
async function completedEnrollment(org: TestOrg, createdBy: string, accountId: string, o: {
  profileId?: string; missionId?: string | null; completedAt?: string; createdAt?: string; extra?: Record<string, unknown>;
} = {}) {
  const seq = await messageSequence(org, createdBy, ['Bonjour', 'Relance'], 2);
  if (o.missionId) await admin().from('outreach_sequences').update({ project_id: o.missionId }).eq('id', seq.sequenceId);
  const completedAt = o.completedAt ?? minutesFromNow(-DAY);
  const { enrollmentId, profileId } = await enroll(org, seq.sequenceId, createdBy, accountId, {
    status: 'completed', completed_at: completedAt, current_step_order: 2,
    created_at: o.createdAt ?? minutesFromNow(-6 * DAY),
    ...(o.profileId ? { profile_id: o.profileId } : {}),
    ...(o.missionId ? { job_id: o.missionId } : {}),
    ...(o.extra ?? {}),
  });
  for (const [i, step] of seq.steps.entries()) {
    const at = minutesFromNow(-DAY * (1 + 2 * (seq.steps.length - 1 - i)));
    await schedule(org, enrollmentId, step, { status: 'sent', scheduled_at: at, executed_at: at, final_message: i === 0 ? 'Bonjour' : 'Relance' });
  }
  return { ...seq, enrollmentId, profileId, completedAt };
}

/** Inscription active, premier message parti il y a deux jours, relance programmée demain. */
async function activeWithFollowUp(org: TestOrg, createdBy: string, accountId: string, profileId: string, o: {
  missionId?: string | null; createdAt?: string;
} = {}) {
  const seq = await messageSequence(org, createdBy, ['Bonjour', 'Relance'], 2);
  if (o.missionId) await admin().from('outreach_sequences').update({ project_id: o.missionId }).eq('id', seq.sequenceId);
  const { enrollmentId } = await enroll(org, seq.sequenceId, createdBy, accountId, {
    profile_id: profileId, current_step_order: 1,
    ...(o.missionId ? { job_id: o.missionId } : {}),
    ...(o.createdAt ? { created_at: o.createdAt } : {}),
  });
  const sentAt = minutesFromNow(-2 * DAY);
  await schedule(org, enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: sentAt, executed_at: sentAt, final_message: 'Bonjour' });
  const followUp = await schedule(org, enrollmentId, seq.steps[1], { scheduled_at: minutesFromNow(DAY) });
  return { ...seq, enrollmentId, followUp };
}

// ════════════════════════════════════════════════════════════════════════════
// Décision 8 : réponse tardive sur une inscription terminée
// ════════════════════════════════════════════════════════════════════════════
test.describe('Décision 8 : réponse reçue après la dernière relance', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical inscription terminée : « A répondu », date de fin gardée, réponse comptée une fois, pipeline « Répondu » dans sa mission, rien ne part', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E DR8 tardive');
    const m1 = await seedMission(org.orgId, org.owner.userId);
    const m2 = await seedMission(org.orgId, org.owner.userId);
    const s = await completedEnrollment(org, org.owner.userId, accountId, { missionId: m1 });
    const jcsMission = await jcs(org.orgId, org.owner.userId, m1, s.profileId);
    const jcsOther = await jcs(org.orgId, org.owner.userId, m2, s.profileId, { status: 'contacted', pipeline_stage: 'Contacté' });
    expect(await replies(s.sequenceId)).toBe(0);

    const t0 = Date.now();
    const chatId = `chat_dr_${rand()}${rand()}`;
    await webhook(replyFrom(accountId, s.profileId, { chatId }).payload);

    const row = await enr(s.enrollmentId);
    expect(row.status, 'inscription terminée → « A répondu »').toBe('replied');
    expect(ts(row.replied_at), 'date de réponse posée').toBeGreaterThanOrEqual(t0 - 5_000);
    expect(ts(row.completed_at), 'date de fin gardée').toBe(ts(s.completedAt));
    expect(row.pause_reason).toBeNull();
    expect(await replies(s.sequenceId), 'réponse comptée').toBe(1);
    expect(await jcsRow(jcsMission), 'pipeline de la mission de l’inscription').toEqual({ status: 'replied', pipeline_stage: 'Répondu' });
    expect((await candidateRowState(jcsOther)).general_stage, 'autre mission inchangée').toBe('contacted');
    const notes = await notificationsOf(org.orgId, 'new_message');
    expect(notes, 'le recruteur est prévenu du message').toHaveLength(1);
    expect(notes[0].metadata).toMatchObject({ chat_id: chatId, is_candidate: true, enrollment_id: s.enrollmentId });

    // Second message du même candidat : rien n'est recompté.
    await webhook(replyFrom(accountId, s.profileId, { chatId }).payload);
    expect(await replies(s.sequenceId), 'second message : aucun recomptage').toBe(1);
    expect((await enr(s.enrollmentId)).replied_at, 'date de la première réponse gardée').toBe(row.replied_at);

    await runCycle();
    expect(await sentTexts(accountId), 'aucun message après la réponse').toEqual([]);
  });

  test('format new_message (is_sender faux) : même effet sur une inscription terminée', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E DR8 imbriqué');
    const s = await completedEnrollment(org, org.owner.userId, accountId);
    const res = await rawWebhook(newMessage(accountId, s.profileId, { is_sender: false }).payload);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await enr(s.enrollmentId);
    expect(row.status).toBe('replied');
    expect(ts(row.completed_at)).toBe(ts(s.completedAt));
    expect(await replies(s.sequenceId)).toBe(1);
  });

  test('seul le contact clos le plus récent du compte compte : déjà « répondu », aucune ancienne inscription terminée ne change ; terminée, elle seule passe « A répondu »', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E DR8 plus récent');
    // (a) Ancienne inscription terminée il y a 60 jours, puis réponse il y a deux jours sur une autre.
    const p1 = newProfileId();
    const oldCompleted = await completedEnrollment(org, org.owner.userId, accountId, {
      profileId: p1, completedAt: minutesFromNow(-60 * DAY), createdAt: minutesFromNow(-70 * DAY),
    });
    const recentReplied = await messageSequence(org, org.owner.userId, ['Bonjour'], 2);
    const repliedAt = minutesFromNow(-2 * DAY);
    const replied = await enroll(org, recentReplied.sequenceId, org.owner.userId, accountId, {
      profile_id: p1, status: 'replied', replied_at: repliedAt, created_at: minutesFromNow(-10 * DAY),
    });
    await webhook(replyFrom(accountId, p1).payload);
    expect((await enr(oldCompleted.enrollmentId)).status, 'ancienne inscription terminée inchangée').toBe('completed');
    expect(ts((await enr(replied.enrollmentId)).replied_at), 'réponse déjà enregistrée inchangée').toBe(ts(repliedAt));
    expect(await replies(oldCompleted.sequenceId)).toBe(0);
    expect(await replies(recentReplied.sequenceId)).toBe(0);

    // (b) Ancienne réponse il y a 60 jours, puis séquence terminée hier : elle seule passe « A répondu ».
    const p2 = newProfileId();
    const oldRepliedSeq = await messageSequence(org, org.owner.userId, ['Bonjour'], 2);
    const oldRepliedAt = minutesFromNow(-60 * DAY);
    const oldReplied = await enroll(org, oldRepliedSeq.sequenceId, org.owner.userId, accountId, {
      profile_id: p2, status: 'replied', replied_at: oldRepliedAt, created_at: minutesFromNow(-70 * DAY),
    });
    const recentCompleted = await completedEnrollment(org, org.owner.userId, accountId, { profileId: p2 });
    await webhook(replyFrom(accountId, p2).payload);
    expect((await enr(recentCompleted.enrollmentId)).status, 'inscription terminée la plus récente').toBe('replied');
    expect(await replies(recentCompleted.sequenceId)).toBe(1);
    expect(ts((await enr(oldReplied.enrollmentId)).replied_at), 'ancienne réponse inchangée').toBe(ts(oldRepliedAt));
    expect(await replies(oldRepliedSeq.sequenceId)).toBe(0);
  });

  test('ni une inscription close par un rendez-vous (déjà comptée) ni celle d’un candidat effacé ne changent', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E DR8 exclusions');
    const m1 = await seedMission(org.orgId, org.owner.userId);
    const meeting = await completedEnrollment(org, org.owner.userId, accountId, {
      missionId: m1, extra: { tracking_data: { completion_reason: 'meeting_booked', meeting_booked_at: minutesFromNow(-DAY) } },
    });
    const meetingJcs = await jcs(org.orgId, org.owner.userId, m1, meeting.profileId, { status: 'qualification', pipeline_stage: 'Pré-qualif' });
    const erased = await completedEnrollment(org, org.owner.userId, accountId, {
      missionId: m1, extra: { tracking_data: { gdpr_erased_at: minutesFromNow(-DAY) } },
    });
    const erasedJcs = await jcs(org.orgId, org.owner.userId, m1, erased.profileId);

    for (const [label, s, jcsId] of [['rendez-vous', meeting, meetingJcs], ['effacé', erased, erasedJcs]] as const) {
      const before = await enr(s.enrollmentId);
      const pipelineBefore = await jcsRow(jcsId);
      await webhook(replyFrom(accountId, s.profileId).payload);
      const after = await enr(s.enrollmentId);
      expect(after.status, `${label} : toujours terminée`).toBe('completed');
      expect(after.replied_at, label).toBeNull();
      expect(after.updated_at, `${label} : aucune écriture`).toBe(before.updated_at);
      expect(await replies(s.sequenceId), `${label} : aucune réponse comptée`).toBe(0);
      expect(await jcsRow(jcsId), `${label} : pipeline inchangé`).toEqual(pipelineBefore);
    }
  });

  test('@critical rejeu après un premier passage en échec : réponse comptée une fois, l’arrêt reste borné à la date de fin (sœur antérieure arrêtée, prise de contact postérieure intacte)', async () => {
    const { org, accountId: a1 } = await trackedSendingOrg('E2E DR8 rejeu');
    const member = await memberWithAccount(org);
    const colleague = await memberWithAccount(org);
    const s = await completedEnrollment(org, org.owner.userId, a1);
    // S1 : même candidat sur le compte du membre, commencée avant la fin de s.
    const s1 = await activeWithFollowUp(org, member.user.userId, member.accountId, s.profileId, { createdAt: minutesFromNow(-2 * DAY) });
    // S2 : prise de contact d'un collègue démarrée après la fin de s (aujourd'hui, avant la réponse).
    const s2 = await activeWithFollowUp(org, colleague.user.userId, colleague.accountId, s.profileId);
    const s2Before = await enr(s2.enrollmentId);
    const restore = failSiblingStop([s1.enrollmentId]);

    const w = replyFrom(a1, s.profileId);
    const first = await rawWebhook(w.payload);
    expect(first.status, JSON.stringify(first.body)).toBe(500);
    expect((await enr(s.enrollmentId)).status, 'premier passage : réponse enregistrée').toBe('replied');
    expect(await replies(s.sequenceId)).toBe(1);

    restore();
    const replay = await rawWebhook(w.payload);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);

    expect(await replies(s.sequenceId), 'rejeu : pas de recomptage').toBe(1);
    expect(ts((await enr(s.enrollmentId)).completed_at), 'date de fin gardée').toBe(ts(s.completedAt));
    expect((await enr(s1.enrollmentId)).status, 'sœur antérieure à la fin : arrêtée au rejeu').toBe('stopped');
    const f1 = await exec(s1.followUp);
    expect(f1.status).toBe('cancelled');
    expect(f1.skip_reason).toBe(SIBLING_REPLY_SKIP_REASON);
    expect(await enr(s2.enrollmentId), 'prise de contact postérieure à la fin : intacte').toEqual(s2Before);
    expect((await exec(s2.followUp)).status).toBe('scheduled');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Décision 10 : arrêt des autres inscriptions en échec persistant
// ════════════════════════════════════════════════════════════════════════════
test.describe('Décision 10 : 500 et alerte au recruteur', () => {
  test.describe.configure({ mode: 'serial' });

  /** Propriétaire sur A1 (E1, mission M1), membre sur A2 (E2) : même candidat, relances programmées. */
  async function scene(prefix: string) {
    const { org, accountId: a1 } = await trackedSendingOrg(prefix);
    const member = await memberWithAccount(org);
    const m1 = await seedMission(org.orgId, org.owner.userId);
    const profileId = newProfileId();
    const e1 = await activeWithFollowUp(org, org.owner.userId, a1, profileId, { missionId: m1 });
    const e2 = await activeWithFollowUp(org, member.user.userId, member.accountId, profileId);
    return { org, a1, member, m1, profileId, e1, e2 };
  }

  test('@critical échec persistant : chaque passage répond 500, le recruteur reçoit une seule alerte, les autres organisations rien', async () => {
    const s = await scene('E2E DR10 persistant');
    // Même candidat dans une autre organisation : jamais alertée.
    const { org: other, accountId: b1 } = await trackedSendingOrg('E2E DR10 autre org');
    await activeWithFollowUp(other, other.owner.userId, b1, s.profileId);
    failSiblingStop([s.e2.enrollmentId]); // panne laissée en place pendant le rejeu

    const w = replyFrom(s.a1, s.profileId);
    const first = await rawWebhook(w.payload);
    expect(first.status, JSON.stringify(first.body)).toBe(500);
    expect(await dedupRows(w.eventKey), 'clé purgée : le rejeu sera traité').toBe(0);
    const replay = await rawWebhook(w.payload);
    expect(replay.status, `rejeu : ${JSON.stringify(replay.body)}`).toBe(500);

    expect((await enr(s.e1.enrollmentId)).status, 'réponse enregistrée sur E1').toBe('replied');
    expect((await enr(s.e2.enrollmentId)).status, 'E2 n’a pas pu être arrêtée').toBe('active');
    const alerts = await alertsOf(s.org.orgId);
    expect(alerts, `une seule alerte pour deux passages en échec : ${JSON.stringify(alerts)}`).toHaveLength(1);
    const [alert] = alerts;
    expect(alert.user_id, 'le recruteur dont le candidat a répondu').toBe(s.org.owner.userId);
    expect(alert.title).toBe(ALERT_TITLE);
    expect(alert.body).toContain('Camille Martin a répondu');
    expect(alert.body).toContain('vérifiez ses inscriptions');
    expect(alert.body ?? '', 'aucun nom de prestataire').not.toMatch(/unipile|calendly/i);
    expect(alert.link, 'lien vers les séquences de la mission').toBe(`/missions/${s.m1}?tab=outreach`);
    expect(alert.metadata).toMatchObject({ source: ALERT_SOURCE, event_key: w.eventKey, sequence_id: s.e1.sequenceId });
    expect(alert.metadata?.enrollment_ids).toEqual([s.e1.enrollmentId]);
    expect(await alertsOf(other.orgId), 'autre organisation : aucune alerte').toEqual([]);
  });

  test('échec passager : alerte au premier échec, le rejeu arrête la sœur sans seconde alerte', async () => {
    const s = await scene('E2E DR10 passager');
    const restore = failSiblingStop([s.e2.enrollmentId]);
    const w = replyFrom(s.a1, s.profileId);
    expect((await rawWebhook(w.payload)).status).toBe(500);
    expect(await alertsOf(s.org.orgId), 'alerte dès le premier échec (le prestataire peut ne plus rejouer)').toHaveLength(1);

    restore();
    const replay = await rawWebhook(w.payload);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect((await enr(s.e2.enrollmentId)).status).toBe('stopped');
    expect((await exec(s.e2.followUp)).status).toBe('cancelled');
    expect(await alertsOf(s.org.orgId), 'aucune alerte de plus').toHaveLength(1);
  });

  test('réponse par e-mail : même alerte à l’auteur de l’inscription quand l’arrêt de la sœur échoue', async () => {
    const s = await scene('E2E DR10 e-mail');
    const mailbox = `mail_dr_${rand()}${rand()}`;
    const { error: mbErr } = await admin().from('member_email_accounts').insert({
      organization_id: s.org.orgId, user_id: s.org.owner.userId, linked_by: s.org.owner.userId,
      email_account_id: mailbox, email_address: 'recruteur@e2e.konekt.test', provider: 'GOOGLE',
    });
    if (mbErr) throw new Error(`member_email_accounts: ${mbErr.message}`);
    const email = `cand-${rand()}@e2e.konekt.test`;
    await admin().from('sequence_enrollments').update({ email_used: email }).eq('id', s.e1.enrollmentId);
    failSiblingStop([s.e2.enrollmentId]);

    const emailId = `email_dr_${rand()}${rand()}`;
    const res = await rawWebhook({
      event: 'mail_received', account_id: mailbox, email_id: emailId, subject: 'Re: poste',
      from_attendee: { identifier: email, display_name: 'Camille Martin' },
      to_attendees: [{ identifier: 'recruteur@e2e.konekt.test', display_name: 'Recruteur' }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    expect((await enr(s.e1.enrollmentId)).status).toBe('replied');
    const alerts = await alertsOf(s.org.orgId);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].user_id).toBe(s.org.owner.userId);
    expect(alerts[0].metadata).toMatchObject({ source: ALERT_SOURCE, event_key: `unipile:mail_received:${emailId}` });
  });

  // Décision du 07/10/2026 : ni mission ni séquence, la fiche du candidat (l'écran Séquences ne le montre pas).
  async function inmail(org: TestOrg, accountId: string, recipient: string, o: Record<string, unknown> = {}) {
    const { data, error } = await admin().from('inmail_queue').insert({
      account_id: accountId, recipient_profile_id: recipient, subject: 'Poste', message: 'Bonjour',
      status: 'scheduled', scheduled_at: minutesFromNow(2 * DAY), created_by: org.owner.userId, organization_id: org.orgId, ...o,
    }).select('id').single();
    if (error || !data) throw new Error(`inmail_queue: ${error?.message}`);
    return data.id as string;
  }

  test('sans séquence ni mission (InMail programmé seul, annulation en échec) : l’alerte ouvre la fiche du candidat', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E DR10 sans séquence');
    const profileId = newProfileId();
    const scheduled = await inmail(org, accountId, profileId);
    failInMailCancel([scheduled]);

    const w = replyFrom(accountId, profileId);
    const res = await rawWebhook(w.payload);
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    expect((await inmailRow(scheduled)).status, 'InMail toujours programmé').toBe('scheduled');
    const alerts = await alertsOf(org.orgId);
    expect(alerts, JSON.stringify(alerts)).toHaveLength(1);
    const [alert] = alerts;
    expect(alert.user_id, 'membre relié au compte qui a reçu la réponse').toBe(org.owner.userId);
    expect(alert.title).toBe(ALERT_TITLE);
    expect(alert.body).toContain('Camille Martin a répondu');
    expect(alert.link, 'fiche du candidat, plus l’écran Séquences').toBe(`/pipeline?candidate=${encodeURIComponent(profileId)}`);
    expect(alert.metadata).toMatchObject({ source: ALERT_SOURCE, event_key: w.eventKey, enrollment_ids: [], profile_name: 'Camille Martin' });
    expect(alert.metadata, 'aucune séquence').not.toHaveProperty('sequence_id');
    expect(alert.metadata, 'aucune mission').not.toHaveProperty('project_id');
  });

  test('organisation reliée par un InMail envoyé sous un autre identifiant : la fiche porte l’identifiant de l’InMail, pas celui de l’expéditeur', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E DR10 InMail autre identifiant');
    const recruiterId = `AEMAAE2EDR${rand()}${rand()}`;
    const senderId = newProfileId();
    // LinkedIn : l'expéditeur classique correspond à l'identifiant Recruiter des InMails.
    await setMockMode(accountId, {
      routes: [{
        method: 'GET', path: `^/api/v1/users/${senderId}$`, status: 200,
        body: { object: 'UserProfile', provider: 'LINKEDIN', provider_id: senderId, id: recruiterId },
      }],
    });
    cleanups.push(() => setMockMode(accountId, {}));
    await inmail(org, accountId, recruiterId, { status: 'sent', sent_at: minutesFromNow(-DAY), scheduled_at: minutesFromNow(-DAY) });
    const followUp = await inmail(org, accountId, recruiterId);
    failInMailCancel([followUp]);

    const res = await rawWebhook(replyFrom(accountId, senderId).payload);
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    const alerts = await alertsOf(org.orgId);
    expect(alerts, JSON.stringify(alerts)).toHaveLength(1);
    // Entrée de l'InMail au /pipeline : son recipient_profile_id (useATSData).
    expect(alerts[0].link).toBe(`/pipeline?candidate=${encodeURIComponent(recruiterId)}`);
    expect(alerts[0].metadata).not.toHaveProperty('sequence_id');
    expect(alerts[0].metadata).not.toHaveProperty('project_id');
  });

  test('InMail programmé seul sous un identifiant Recruiter : l’alerte ouvre sa fiche et ne crée pas de contact envoyé', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E DR10 InMail programmé alias');
    const colleague = await memberWithAccount(org);
    const recruiterId = `AEMAAE2EDR${rand()}${rand()}`;
    const senderId = newProfileId();
    await setMockMode(accountId, {
      routes: [{
        method: 'GET', path: `^/api/v1/users/${senderId}$`, status: 200,
        body: { object: 'UserProfile', provider: 'LINKEDIN', provider_id: senderId, id: recruiterId },
      }],
    });
    cleanups.push(() => setMockMode(accountId, {}));
    // Aucun InMail envoyé, aucune inscription : seule la ligne programmée porte cet alias.
    const scheduled = await inmail(org, accountId, recruiterId);
    failInMailCancel([scheduled]);
    const colleagueSequence = await messageSequence(org, colleague.user.userId, ['Bonjour'], 2);
    const colleagueEnrollment = await enroll(org, colleagueSequence.sequenceId, colleague.user.userId, colleague.accountId, {
      profile_id: recruiterId,
    });

    const res = await rawWebhook(replyFrom(accountId, senderId).payload);
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    expect((await inmailRow(scheduled)).status).toBe('scheduled');
    expect((await enr(colleagueEnrollment.enrollmentId)).status, 'un InMail non envoyé ne rattache pas les contacts des autres comptes').toBe('active');
    const alerts = await alertsOf(org.orgId);
    expect(alerts, JSON.stringify(alerts)).toHaveLength(1);
    expect(alerts[0].link).toBe(`/pipeline?candidate=${encodeURIComponent(recruiterId)}`);
    expect(alerts[0].metadata).toMatchObject({ enrollment_ids: [] });
    expect(alerts[0].metadata).not.toHaveProperty('sequence_id');
    expect(alerts[0].metadata).not.toHaveProperty('project_id');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Décision 11 : new_message sans indication d'expéditeur
// ════════════════════════════════════════════════════════════════════════════
test.describe('Décision 11 : expéditeur non vérifiable, échec et rejeu', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical vérification des participants impossible : 500, rien n’est clos, clé purgée ; le rejeu vérifié clôt normalement', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E DR11 vérification');
    // Identifiants propres (posés avant tout webhook) : l'appel des participants porte l'account_id.
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
    const profileId = newProfileId();
    const e = await activeWithFollowUp(org, org.owner.userId, accountId, profileId);

    const w = newMessage(accountId, profileId, { sender_attendee_id: 'att_candidate' });
    const failed = await rawWebhook(w.payload);
    expect(failed.status, JSON.stringify(failed.body)).toBe(500);
    expect((await mockCalls(accountId)).filter((c) => c.scripted).length, 'le 503 scripté a bien été servi').toBeGreaterThanOrEqual(1);
    expect(await dedupRows(w.eventKey), 'clé purgée').toBe(0);
    expect((await enr(e.enrollmentId)).status, 'rien de clos').toBe('active');
    expect((await exec(e.followUp)).status).toBe('scheduled');
    expect(await notificationsOf(org.orgId, 'new_message'), 'aucune notification').toEqual([]);

    const replay = await rawWebhook(w.payload);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect((await enr(e.enrollmentId)).status, 'expéditeur vérifié au rejeu').toBe('replied');
    expect((await exec(e.followUp)).status).toBe('cancelled');
    expect(await replies(e.sequenceId)).toBe(1);
  });

  test('participants lus sans « soi » identifiable : 500 (rejeu), rien n’est clos ni compté', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E DR11 sans soi');
    // Réponse générique du faux prestataire : liste de participants vide.
    await setIntegration(org.orgId, { unipile_connected: true, unipile_api_key: 'mock-key', unipile_dsn: `unipile.mock/e2e-dr-${rand()}` });
    const profileId = newProfileId();
    const e = await activeWithFollowUp(org, org.owner.userId, accountId, profileId);
    const w = newMessage(accountId, profileId, { sender_attendee_id: 'att_candidate' });
    const chatId = (w.payload.data.message as { chat_id: string }).chat_id;

    const res = await rawWebhook(w.payload);
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    const attendeeCalls = (await mockCalls()).filter((c) => c.method === 'GET' && c.path.includes(`/chats/${chatId}/attendees`));
    expect(attendeeCalls.length, 'participants bien demandés').toBe(1);
    expect((await enr(e.enrollmentId)).status).toBe('active');
    expect((await exec(e.followUp)).status).toBe('scheduled');
    expect(await replies(e.sequenceId)).toBe(0);
    expect(await dedupRows(w.eventKey)).toBe(0);
  });

  test('ni is_sender, ni conversation, ni participant expéditeur : 500, rien n’est écrit ; is_sender faux clôt toujours', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E DR11 champs absents');
    const profileId = newProfileId();
    const e = await activeWithFollowUp(org, org.owner.userId, accountId, profileId);

    const noAttendee = newMessage(accountId, profileId);
    const noChat = newMessage(accountId, profileId, { chat_id: undefined, sender_attendee_id: 'att_candidate' });
    for (const [label, w] of [['sans participant expéditeur', noAttendee], ['sans conversation', noChat]] as const) {
      const res = await rawWebhook(w.payload);
      expect(res.status, `${label} : ${JSON.stringify(res.body)}`).toBe(500);
      expect(await dedupRows(w.eventKey), label).toBe(0);
    }
    expect((await enr(e.enrollmentId)).status).toBe('active');
    expect((await exec(e.followUp)).status).toBe('scheduled');
    expect(await notificationsOf(org.orgId, 'new_message')).toEqual([]);

    const explicit = await rawWebhook(newMessage(accountId, profileId, { is_sender: false }).payload);
    expect(explicit.status, JSON.stringify(explicit.body)).toBe(200);
    expect((await enr(e.enrollmentId)).status, 'is_sender faux : réponse').toBe('replied');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Décision 27 : un rendez-vous annule aussi les InMails en attente
// ════════════════════════════════════════════════════════════════════════════
test.describe('Décision 27 : rendez-vous et InMails en attente', () => {
  test.describe.configure({ mode: 'serial' });

  async function inmail(org: TestOrg, accountId: string, recipient: string, o: Record<string, unknown> = {}) {
    const { data, error } = await admin().from('inmail_queue').insert({
      account_id: accountId, recipient_profile_id: recipient, subject: 'Poste', message: 'Bonjour',
      status: 'scheduled', scheduled_at: minutesFromNow(2 * DAY), created_by: org.owner.userId, organization_id: org.orgId, ...o,
    }).select('id').single();
    if (error || !data) throw new Error(`inmail_queue: ${error?.message}`);
    return data.id as string;
  }
  async function bookedCandidate(prefix: string) {
    const { org, accountId } = await trackedSendingOrg(prefix);
    await setIntegration(org.orgId, { calendly_connected: true });
    const slug = `camille-dr-${rand()}`;
    const url = `https://www.linkedin.com/in/${slug}`;
    const profileId = newProfileId();
    const m1 = await seedMission(org.orgId, org.owner.userId);
    await jcs(org.orgId, org.owner.userId, m1, profileId, { status: 'contacted', pipeline_stage: 'Contacté', linkedin_profile_url: url });
    return { org, accountId, url, profileId, m1 };
  }

  test('@critical InMails programmés ou en attente de l’organisation vers le candidat annulés (motif lisible), même sous son autre identifiant ; en cours, envoyés, autre candidat et autre organisation intacts', async () => {
    const s = await bookedCandidate('E2E DR27 rdv');
    const altId = `AEMAAE2EDR${rand()}${rand()}`;
    const seq = await messageSequence(s.org, s.org.owner.userId, ['Bonjour', 'Relance'], 2);
    const e = await enroll(s.org, seq.sequenceId, s.org.owner.userId, s.accountId, { profile_id: s.profileId, provider_id: altId, current_step_order: 1 });
    await schedule(s.org, e.enrollmentId, seq.steps[1], { scheduled_at: minutesFromNow(DAY) });
    const cancelled = {
      scheduled: await inmail(s.org, s.accountId, s.profileId),
      pendingAltId: await inmail(s.org, s.accountId, altId, { status: 'pending' }),
    };
    const kept = {
      sending: await inmail(s.org, s.accountId, s.profileId, { status: 'sending' }),
      sent: await inmail(s.org, s.accountId, s.profileId, { status: 'sent', sent_at: minutesFromNow(-DAY) }),
      otherCandidate: await inmail(s.org, s.accountId, newProfileId()),
    };
    const { org: other, accountId: b1 } = await trackedSendingOrg('E2E DR27 autre org');
    const otherOrgInmail = await inmail(other, b1, s.profileId);
    const keptBefore: Record<string, Awaited<ReturnType<typeof inmailRow>>> = {};
    for (const [label, id] of Object.entries({ ...kept, otherOrg: otherOrgInmail })) keptBefore[label] = await inmailRow(id);

    const res = await booking(s.url);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.sequences_stopped).toBe(1);
    expect(res.body.inmails_cancelled, 'deux InMails annulés').toBe(2);

    for (const [label, id] of Object.entries(cancelled)) {
      const row = await inmailRow(id);
      expect(row.status, label).toBe('cancelled');
      expect(row.error_message, label).toBe(MEETING_INMAIL_REASON);
    }
    for (const [label, id] of Object.entries({ ...kept, otherOrg: otherOrgInmail })) {
      expect(await inmailRow(id), `${label} : intact`).toEqual(keptBefore[label]);
    }
    expect((await enr(e.enrollmentId)).status, 'séquence close par le rendez-vous').toBe('completed');
  });

  test('candidat sans inscription (InMail groupé seul) : son InMail programmé est annulé', async () => {
    const s = await bookedCandidate('E2E DR27 sans inscription');
    const scheduled = await inmail(s.org, s.accountId, s.profileId);
    const res = await booking(s.url);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.sequences_stopped).toBe(0);
    expect(res.body.inmails_cancelled).toBe(1);
    expect(await inmailRow(scheduled)).toMatchObject({ status: 'cancelled', error_message: MEETING_INMAIL_REASON });
  });

  test('arrêt refusé (plus de cinq inscriptions correspondent) : InMails intacts aussi', async () => {
    const s = await bookedCandidate('E2E DR27 trop de correspondances');
    for (let i = 0; i < 6; i++) {
      const seq = await messageSequence(s.org, s.org.owner.userId, ['Bonjour', `Relance ${i}`], 2);
      await enroll(s.org, seq.sequenceId, s.org.owner.userId, s.accountId, { profile_id: s.profileId, current_step_order: 1 });
    }
    const scheduled = await inmail(s.org, s.accountId, s.profileId);
    const before = await inmailRow(scheduled);
    const res = await booking(s.url);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.sequences_stop_skipped).toBe('too_many_matches');
    expect(res.body.inmails_cancelled).toBe(0);
    expect(await inmailRow(scheduled)).toEqual(before);
  });

  // Arrêt par le moteur : le correctif est dans process-sequences (lot moteur,
  // hors de ce lot). Test en attente tant que le moteur n'écrit pas le motif du
  // rendez-vous sur les InMails, actif de lui-même ensuite.
  const engineCancelsInMails = /MEETING_INMAIL_CANCEL_REASON|Rendez-vous pris avec le candidat/.test(
    readFileSync(new URL('../../supabase/functions/process-sequences/index.ts', import.meta.url), 'utf8'),
  );
  test('@critical arrêt par le moteur (condition « rendez-vous pris ») : InMails programmés ou en attente du candidat annulés, même motif ; rendez-vous antérieur à l’inscription : InMails intacts', async () => {
    test.fixme(!engineCancelsInMails, 'décision 27 : process-sequences n’annule pas encore les InMails au rendez-vous (lot moteur)');
    const { org, accountId } = await trackedSendingOrg('E2E DR27 moteur');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 2);
    await admin().from('outreach_sequences')
      .update({ stop_conditions: { on_reply: true, on_unsubscribe: true, on_meeting_booked: true } }).eq('id', seq.sequenceId);
    const meeting = async (candidateProfileId: string, createdAt: string) => {
      const { error } = await admin().from('qualification_sessions').insert({
        organization_id: org.orgId, created_by: org.owner.userId, calendly_event_id: `evt_dr_${rand()}${rand()}`,
        status: 'scheduled', candidate_profile_id: candidateProfileId, created_at: createdAt,
      });
      if (error) throw new Error(`qualification_sessions: ${error.message}`);
    };

    // Inscription démarrée il y a 3 jours, rendez-vous pris hier : arrêt, InMails annulés.
    const profileId = newProfileId();
    const altId = `AEMAAE2EDR${rand()}${rand()}`;
    const booked = await enroll(org, seq.sequenceId, org.owner.userId, accountId, {
      profile_id: profileId, provider_id: altId, created_at: minutesFromNow(-3 * DAY),
    });
    await meeting(profileId, minutesFromNow(-DAY));
    // Décision 25 : rendez-vous pris avant l'inscription, pas d'arrêt, InMail gardé.
    const early = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { created_at: minutesFromNow(-DAY) });
    await meeting(early.profileId, minutesFromNow(-3 * DAY));

    const cancelled = {
      scheduled: await inmail(org, accountId, profileId),
      pendingAltId: await inmail(org, accountId, altId, { status: 'pending' }),
    };
    const kept = {
      sending: await inmail(org, accountId, profileId, { status: 'sending' }),
      sent: await inmail(org, accountId, profileId, { status: 'sent', sent_at: minutesFromNow(-DAY) }),
      otherCandidate: await inmail(org, accountId, newProfileId()),
      earlyMeeting: await inmail(org, accountId, early.profileId),
    };
    const { org: other, accountId: b1 } = await trackedSendingOrg('E2E DR27 moteur autre org');
    const otherOrgInmail = await inmail(other, b1, profileId);
    const keptBefore: Record<string, Awaited<ReturnType<typeof inmailRow>>> = {};
    for (const [label, id] of Object.entries({ ...kept, otherOrg: otherOrgInmail })) keptBefore[label] = await inmailRow(id);

    const xBooked = await schedule(org, booked.enrollmentId, seq.steps[0]);
    const xEarly = await schedule(org, early.enrollmentId, seq.steps[0]);
    await runCycle();

    expect((await exec(xBooked)).status, 'étape arrêtée par le rendez-vous').toBe('cancelled');
    expect((await enr(booked.enrollmentId)).status, 'séquence close par le rendez-vous').toBe('completed');
    for (const [label, id] of Object.entries(cancelled)) {
      const row = await inmailRow(id);
      expect(row.status, label).toBe('cancelled');
      expect(row.error_message, label).toBe(MEETING_INMAIL_REASON);
    }
    for (const [label, id] of Object.entries({ ...kept, otherOrg: otherOrgInmail })) {
      expect(await inmailRow(id), `${label} : intact`).toEqual(keptBefore[label]);
    }
    expect((await exec(xEarly)).status, 'rendez-vous antérieur à l’inscription : l’envoi part').toBe('sent');
    expect(await sentTexts(accountId), 'rien ne part vers le candidat du rendez-vous').toEqual(['Bonjour']);
  });
});

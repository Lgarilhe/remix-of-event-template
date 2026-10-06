/**
 * Lot 5b (décision 3) : « Arrêter » et « Annuler » côté serveur, actions
 * membres stop_enrollments et undo_stop_enrollments de process-sequences, et
 * annulation d'une pause par resume_enrollments.
 *
 * Contrat : docs/refonte-mission/lot5-plan.md, section 5b (« Appels serveur »
 * et « Tests à écrire »), CLAUDE.md, « Séquences : règles du moteur et de
 * l'interface ». Règles pures : supabase/functions/_shared/enrollment-stop.ts.
 * - Arrêt : inscription active ou en pause close en 'completed' avec
 *   tracking_data.completion_reason 'manual_stop' et manual_stop { token, by,
 *   at, previous_status, previous_pause_reason } ; étapes en attente
 *   ('scheduled', 'waiting_event', 'quota_blocked') annulées « Arrêt manuel »,
 *   jamais 'sending' ; 200 inscriptions au plus ; un résultat par inscription.
 * - Annulation (2 minutes, son auteur) : retour en pause avec la raison
 *   d'avant, ou reprise serveur (resumeOneEnrollment) si l'inscription était
 *   active ; refus expired, not_author, moved_since, gdpr_erased, replied.
 *
 * Le moteur tourne pour de vrai contre la stack locale (e2e/local-stack) ;
 * LinkedIn est simulé par vendor-mock.mjs, qui journalise chaque appel. Chaque
 * test a sa propre organisation et son propre compte LinkedIn (journal isolé
 * par account_id). Ignoré sans cette stack.
 *
 * D'autres suites font tourner des cycles sur la même base : toute exécution
 * d'une inscription active est prévue dans le futur, et n'est remise à
 * échéance qu'au moment voulu.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  deleteOrg,
  seedLinkedInAccount,
  seedMission,
  seedMissionConversation,
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
  rand,
  runCycle,
  schedule,
  runEngine,
  sendingOrg,
  sentInvites,
  sentTexts,
  setMockMode,
  setPaidPlan,
  webhook,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(240_000);

// ─── Textes du contrat (_shared/enrollment-stop.ts, process-sequences) ──────
const MANUAL_STOP = 'Arrêt manuel';
const COLLABORATOR_ACTION_MESSAGE = 'Vous ne pouvez agir que sur les candidats que vous avez inscrits.';
const GDPR_ERASURE_SKIP_REASON = 'Effacement des données demandé : séquence arrêtée';
const ACCOUNT_UNLINKED_UNDO = 'Arrêt annulé : le candidat reste en pause (compte LinkedIn non relié).';
const SEQUENCE_INACTIVE_UNDO = 'Arrêt annulé : le candidat reste en pause (séquence en pause).';
const ACCOUNT_DISCONNECTED_SKIP_REASON = 'Compte LinkedIn déconnecté, reprise automatique à la reconnexion';
const DAY = 24 * 60;

// ─── Ménage ─────────────────────────────────────────────────────────────────
const tracked: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];
test.afterEach(async () => {
  while (cleanups.length) await Promise.resolve(cleanups.pop()!()).catch(() => undefined);
  while (tracked.length) {
    const { org, extra } = tracked.pop()!;
    // Tables sans suppression en cascade depuis deleteOrg (l'organisation survit).
    for (const table of ['job_candidate_status', 'notifications', 'mission_conversations', 'agent_tool_executions', 'member_quotas']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});

async function scene(prefix: string) {
  const res = await sendingOrg(prefix);
  tracked.push({ org: res.org, extra: [] });
  return { ...res, token: await tokenOf(res.org.owner) };
}
async function member(org: TestOrg, role: 'member' | 'collaborator', prefix: string) {
  const user = await addMember(org.orgId, role, prefix);
  tracked.find((t) => t.org.orgId === org.orgId)?.extra.push(user);
  const accountId = await seedLinkedInAccount(org.orgId, user.userId, `acc_5b_${rand()}`, 'OK');
  return { user, accountId, token: await tokenOf(user) };
}

// ─── Aides ──────────────────────────────────────────────────────────────────
type Json = Record<string, unknown>;
interface StopResult { enrollment_id: string; outcome: string; message?: string; reason?: string; detail?: string }
interface ManualStopTrace { token: string; by: string | null; at: string; previous_status: string; previous_pause_reason: string | null }

async function tokenOf(user: TestUser): Promise<string> {
  return (await signIn(user.email, user.password)).access_token;
}

/** Action membre de process-sequences avec un JWT. */
function engine(token: string, body: Json) {
  return callFunction('process-sequences', token, body);
}

async function stop(token: string, orgId: string, enrollmentIds: string[]) {
  const res = await engine(token, { action: 'stop_enrollments', organization_id: orgId, enrollment_ids: enrollmentIds });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Json & { token: string; stopped_at: string; expires_at: string; expires_in_ms: number; results: StopResult[]; counts: Record<string, number> };
}

async function undo(token: string, orgId: string, enrollmentIds: string[], stopToken: string) {
  const res = await engine(token, { action: 'undo_stop_enrollments', organization_id: orgId, enrollment_ids: enrollmentIds, token: stopToken });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Json & { results: StopResult[]; counts: Record<string, number> };
}

function resultOf(body: { results: StopResult[] }, enrollmentId: string): StopResult | undefined {
  return body.results.find((r) => r.enrollment_id === enrollmentId);
}

type EnrRow = {
  status: string; pause_reason: string | null; completed_at: string | null; replied_at: string | null;
  current_step_order: number; tracking_data: Json | null;
};
async function enrRow(id: string): Promise<EnrRow> {
  const { data, error } = await admin().from('sequence_enrollments')
    .select('status, pause_reason, completed_at, replied_at, current_step_order, tracking_data').eq('id', id).single();
  if (error || !data) throw new Error(`enrRow ${id}: ${error?.message}`);
  return data as EnrRow;
}

type ExecRow = { id: string; status: string; step_order: number; scheduled_at: string; skip_reason: string | null; executed_at: string | null };
async function execRow(id: string): Promise<ExecRow> {
  const { data, error } = await admin().from('sequence_step_executions')
    .select('id, status, step_order, scheduled_at, skip_reason, executed_at').eq('id', id).single();
  if (error || !data) throw new Error(`execRow ${id}: ${error?.message}`);
  return data as ExecRow;
}
async function execsOf(enrollmentId: string): Promise<ExecRow[]> {
  const { data } = await admin().from('sequence_step_executions')
    .select('id, status, step_order, scheduled_at, skip_reason, executed_at')
    .eq('enrollment_id', enrollmentId).order('step_order').order('created_at');
  return (data ?? []) as ExecRow[];
}

/** Remet une exécution à échéance (juste avant un cycle). */
async function makeDue(...ids: string[]) {
  await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).in('id', ids).eq('status', 'scheduled');
}

async function patchTracking(enrollmentId: string, patch: (t: Json) => Json) {
  const row = await enrRow(enrollmentId);
  const { error } = await admin().from('sequence_enrollments').update({ tracking_data: patch(row.tracking_data ?? {}) }).eq('id', enrollmentId);
  if (error) throw new Error(`tracking_data: ${error.message}`);
}

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/** Inscription active au milieu d'une séquence : premier message parti il y a deux jours, relance prévue `followUpInMinutes` plus tard. */
async function midSequence(
  org: TestOrg, sequence: { sequenceId: string; steps: SeededStep[] }, createdBy: string, accountId: string,
  o: { followUpInMinutes?: number; followUpStatus?: string; overrides?: Json } = {},
) {
  const { enrollmentId, profileId } = await enroll(org, sequence.sequenceId, createdBy, accountId, { current_step_order: 1, ...o.overrides });
  const sent = await schedule(org, enrollmentId, sequence.steps[0], {
    status: 'sent', scheduled_at: minutesFromNow(-2 * DAY), executed_at: minutesFromNow(-2 * DAY),
    created_at: minutesFromNow(-2 * DAY), final_message: 'Bonjour',
  });
  const followUp = await schedule(org, enrollmentId, sequence.steps[1], {
    status: o.followUpStatus ?? 'scheduled', scheduled_at: minutesFromNow(o.followUpInMinutes ?? 2 * DAY),
  });
  return { enrollmentId, profileId, sent, followUp };
}

/** Appel PostgREST avec un JWT utilisateur (écritures et lectures du navigateur). */
async function rest(method: 'POST' | 'PATCH', path: string, token: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${E2E.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: E2E.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* corps non JSON */ }
  return { status: res.status, body: parsed };
}

/** Message du candidat, format à plat (message_received). */
function replyFrom(accountId: string, profileId: string, chatId: string) {
  return {
    event: 'message_received',
    account_id: accountId,
    account_type: 'LINKEDIN',
    chat_id: chatId,
    message_id: `msg_${rand()}${rand()}`,
    message: 'Bonjour, je suis intéressé',
    sender: { attendee_provider_id: profileId, attendee_id: 'att_candidate', attendee_name: 'Camille Martin' },
  };
}

/** Laisse finir l'analyse lancée en tâche de fond par le webhook (lecture de la conversation). */
async function waitForAutoAnalyze(chatId: string) {
  await expect.poll(async () => (await mockCalls())
    .filter((c) => c.method === 'GET' && c.path.includes(`/chats/${chatId}/messages`)).length, {
    timeout: 30_000, message: 'auto-analyze-message a lu la conversation',
  }).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 2_000));
}

function linkedinUrlHash(url: string): string {
  const normalized = url.toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '').trim();
  return createHash('sha256').update(normalized).digest('hex');
}

/** SQL direct sur la base locale : une seule écriture pour 200 lignes (date d'arrêt antidatée). */
function psql(sql: string): string {
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql],
    { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' },
  );
}

/** Ligne complète d'une exécution (toutes colonnes). */
async function fullExec(id: string): Promise<Json> {
  const { data, error } = await admin().from('sequence_step_executions').select('*').eq('id', id).single();
  if (error || !data) throw new Error(`fullExec ${id}: ${error?.message}`);
  return data as Json;
}

// ════════════════════════════════════════════════════════════════════════════
// Arrêt : clôture, étapes annulées, rien ne part
// ════════════════════════════════════════════════════════════════════════════
test.describe('@critical Arrêter : clôture et étapes annulées', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical l’arrêt annule les trois statuts en attente avec « Arrêt manuel », ne touche pas « sending », et rien ne part au passage suivant', async () => {
    const { org, accountId, token } = await scene('E2E 5b Arrêt');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const pendings: Array<{ enrollmentId: string; execId: string; status: string }> = [];
    for (const status of ['scheduled', 'waiting_event', 'quota_blocked', 'sending']) {
      const { enrollmentId, followUp } = await midSequence(org, seq, org.owner.userId, accountId, {
        followUpStatus: status, followUpInMinutes: status === 'sending' ? -1 : 60,
      });
      pendings.push({ enrollmentId, execId: followUp, status });
    }
    // Inscription déjà terminée, identifiant inconnu, inscription d'une autre organisation.
    const done = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { status: 'completed', completed_at: minutesFromNow(-60) });
    const other = await scene('E2E 5b Autre org');
    const otherSeq = await messageSequence(other.org, other.org.owner.userId, ['Bonjour']);
    const foreign = await enroll(other.org, otherSeq.sequenceId, other.org.owner.userId, other.accountId);
    const unknown = randomUUID();
    const sendingExec = pendings.find((p) => p.status === 'sending')!.execId;
    const sendingBefore = await fullExec(sendingExec);

    const before = Date.now();
    const res = await stop(token, org.orgId, [...pendings.map((p) => p.enrollmentId), done.enrollmentId, unknown, foreign.enrollmentId]);
    expect(res.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(ms(res.expires_at) - ms(res.stopped_at), 'jeton valable 2 minutes').toBe(120_000);
    expect(res.expires_in_ms).toBeGreaterThan(100_000);
    expect(res.expires_in_ms).toBeLessThanOrEqual(120_000);
    expect(ms(res.stopped_at)).toBeGreaterThanOrEqual(before - 5_000);
    expect(res.counts).toEqual(expect.objectContaining({ stopped: 4, not_eligible: 1, not_found: 2 }));
    expect(resultOf(res, done.enrollmentId)?.outcome).toBe('not_eligible');
    expect(resultOf(res, unknown)?.outcome).toBe('not_found');
    expect(resultOf(res, foreign.enrollmentId)?.outcome, 'jamais une inscription d’une autre organisation').toBe('not_found');
    expect((await enrRow(foreign.enrollmentId)).status).toBe('active');

    for (const p of pendings) {
      expect(resultOf(res, p.enrollmentId)?.outcome).toBe('stopped');
      const row = await enrRow(p.enrollmentId);
      expect(row.status, 'clôture en « terminée » (comptée par l’anti-doublon)').toBe('completed');
      expect(row.pause_reason).toBeNull();
      expect(ms(row.completed_at)).toBe(ms(res.stopped_at));
      expect(row.tracking_data?.completion_reason).toBe('manual_stop');
      expect(row.tracking_data?.manual_stop).toEqual({
        token: res.token, by: org.owner.userId, at: res.stopped_at, previous_status: 'active', previous_pause_reason: null,
      });
      const exec = await execRow(p.execId);
      if (p.status === 'sending') {
        expect(await fullExec(p.execId), 'une étape en cours d’envoi n’est jamais touchée (toutes colonnes)').toEqual(sendingBefore);
      } else {
        expect(exec.status, `étape ${p.status} annulée`).toBe('cancelled');
        expect(exec.skip_reason).toBe(MANUAL_STOP);
      }
    }

    await makeDue(...pendings.map((p) => p.execId));
    await runCycle();
    expect(await sentTexts(accountId), 'aucun message après l’arrêt').toEqual([]);
    expect(await sentInvites(accountId), 'aucune invitation après l’arrêt').toEqual([]);
    expect(await mockCalls(accountId), 'journal du faux LinkedIn vide : ni envoi ni lecture').toEqual([]);
    for (const p of pendings.filter((x) => x.status !== 'sending')) {
      expect((await execRow(p.execId)).status).toBe('cancelled');
    }
    expect(await fullExec(sendingExec), 'étape en cours d’envoi intacte après le passage').toEqual(sendingBefore);
  });

  test('@critical arrêt pendant l’envoi : le dernier contrôle annule l’étape « Arrêt manuel » sans rien envoyer, « Annuler » la réarme à sa date (ou dans une minute), puis elle part', async () => {
    const { org, accountId, token } = await scene('E2E 5b Dernier contrôle');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    // Amorce : un autre candidat du même compte, dû avant. Après son envoi, le
    // moteur verrouille la relance de la cible puis attend 5 à 15 s
    // (espacement entre deux envois du compte) avant son dernier contrôle.
    const primer = await enroll(org, seq.sequenceId, org.owner.userId, accountId);
    await schedule(org, primer.enrollmentId, seq.steps[0], { scheduled_at: minutesFromNow(-3) });
    const target = await midSequence(org, seq, org.owner.userId, accountId, { followUpInMinutes: -1 });

    const cycle = runCycle();
    await expect.poll(async () => (await execRow(target.followUp)).status, {
      timeout: 60_000, intervals: [50], message: 'relance de la cible verrouillée',
    }).toBe('sending');
    const stopped = await stop(token, org.orgId, [target.enrollmentId]);
    expect(resultOf(stopped, target.enrollmentId)?.outcome).toBe('stopped');
    expect((await execRow(target.followUp)).status, 'l’arrêt ne touche pas l’étape en cours d’envoi').toBe('sending');
    await cycle;

    const cancelled = await fullExec(target.followUp);
    expect(cancelled.status, 'dernier contrôle : rien ne part').toBe('cancelled');
    expect(cancelled.skip_reason, 'motif réarmable de l’arrêt').toBe(MANUAL_STOP);
    expect(cancelled.final_message, 'contenu d’avant le verrou').toBeNull();
    expect(await sentTexts(accountId), 'seul le premier message de l’amorce est parti').toEqual(['Bonjour']);

    const res = await undo(token, org.orgId, [target.enrollmentId], stopped.token);
    expect(resultOf(res, target.enrollmentId)).toEqual(expect.objectContaining({
      outcome: 'resumed', message: 'Arrêt annulé : le candidat reprend la séquence là où il en était.',
    }));
    const rearmed = await execRow(target.followUp);
    expect(rearmed.status, 'étape réarmée, pas replanifiée avec tout son délai').toBe('scheduled');
    expect(rearmed.skip_reason).toBeNull();
    expect(ms(rearmed.scheduled_at), 'date passée : dans une minute').toBeGreaterThan(Date.now());
    expect(ms(rearmed.scheduled_at)).toBeLessThan(Date.now() + 3 * 60_000);
    expect(await execsOf(target.enrollmentId), 'aucune exécution créée').toHaveLength(2);
    expect((await enrRow(target.enrollmentId)).status).toBe('active');

    await makeDue(target.followUp);
    await runCycle();
    expect(await sentTexts(accountId), 'la relance part au passage suivant, une seule fois').toEqual(['Bonjour', 'Relance']);
    expect((await execRow(target.followUp)).status).toBe('sent');
  });

  test('@critical après l’arrêt, l’inscription reste un contact : find_recent_org_contacts la renvoie, et l’assistant refuse un collègue dans une autre séquence', async () => {
    const { org, accountId, token } = await scene('E2E 5b Anti-doublon');
    const colleague = await member(org, 'member', 'collegue');
    await admin().from('profiles').update({ display_name: 'Gaston Martin' }).eq('user_id', org.owner.userId);
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const seqA = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const slug = `camille-arret-${rand()}`;
    const { enrollmentId, profileId } = await midSequence(org, seqA, org.owner.userId, accountId, {
      overrides: { profile_url: `https://www.linkedin.com/in/${slug}` },
    });
    expect(resultOf(await stop(token, org.orgId, [enrollmentId]), enrollmentId)?.outcome).toBe('stopped');

    // Écran : l'anti-doublon du navigateur lit find_recent_org_contacts (D3), par identifiant comme par slug.
    for (const args of [{ p_values: [profileId], p_slugs: [] }, { p_values: [], p_slugs: [slug] }]) {
      const rpc = await rest('POST', 'rpc/find_recent_org_contacts', colleague.token, {
        p_org: org.orgId, p_since: minutesFromNow(-90 * DAY), ...args,
      });
      expect(rpc.status, JSON.stringify(rpc.body)).toBe(200);
      expect(rpc.body, 'inscription arrêtée vue comme un contact récent').toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'completed', sequence_id: seqA.sequenceId, created_by: org.owner.userId }),
      ]));
    }

    // Assistant : le collègue tente d'inscrire le candidat dans la séquence de la mission.
    const seqB = await messageSequence(org, org.owner.userId, ['Bonjour B']);
    await admin().from('outreach_sequences').update({ project_id: missionId }).eq('id', seqB.sequenceId);
    const { data: proposed, error } = await admin().from('agent_tool_executions').insert({
      user_id: colleague.user.userId, organization_id: org.orgId, tool_name: 'enroll_in_sequence',
      params: { sequence_id: seqB.sequenceId, candidate_id: profileId, job_id: missionId, profile_name: 'Camille Martin' },
      status: 'proposed', dry_run_result: { summary: 'Test e2e enroll_in_sequence', details: {} },
    }).select('id').single();
    if (error || !proposed) throw new Error(`propose: ${error?.message}`);
    const approved = await callFunction('agent-tool-action', colleague.token, { execution_id: proposed.id, action: 'approve' });
    const body = approved.body as { success?: boolean; error?: string };
    expect(body.success, JSON.stringify(body)).toBe(false);
    expect(body.error).toMatch(/Déjà contacté par Gaston/);
    const { data: inB } = await admin().from('sequence_enrollments').select('id').eq('sequence_id', seqB.sequenceId);
    expect(inB, 'aucune inscription dans l’autre séquence').toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Annuler un arrêt : reprise, retour en pause, étape partie pendant l'arrêt
// ════════════════════════════════════════════════════════════════════════════
test.describe('@critical Annuler un arrêt', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical annulation dans les 2 minutes : étape réarmée à sa date (ou dans une minute), puis partie au passage suivant', async () => {
    const { org, accountId, token } = await scene('E2E 5b Annuler');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const a = await midSequence(org, seq, org.owner.userId, accountId);
    const b = await midSequence(org, seq, org.owner.userId, accountId);
    const originalA = (await execRow(a.followUp)).scheduled_at;

    const stopped = await stop(token, org.orgId, [a.enrollmentId, b.enrollmentId]);
    expect(stopped.counts.stopped).toBe(2);
    // B : sa date est passée pendant l'arrêt.
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-5) }).eq('id', b.followUp);

    const res = await undo(token, org.orgId, [a.enrollmentId, b.enrollmentId], stopped.token);
    expect(resultOf(res, a.enrollmentId)).toEqual(expect.objectContaining({ outcome: 'resumed' }));
    expect(resultOf(res, b.enrollmentId)?.outcome).toBe('resumed');
    expect(res.counts.resumed).toBe(2);

    const execA = await execRow(a.followUp);
    expect(execA.status, 'étape annulée par l’arrêt réarmée').toBe('scheduled');
    expect(execA.skip_reason).toBeNull();
    expect(ms(execA.scheduled_at), 'à sa date').toBe(ms(originalA));
    const execB = await execRow(b.followUp);
    expect(execB.status).toBe('scheduled');
    expect(ms(execB.scheduled_at), 'date passée : dans une minute').toBeGreaterThan(Date.now());
    expect(ms(execB.scheduled_at)).toBeLessThan(Date.now() + 3 * 60_000);
    for (const e of [a, b]) {
      const row = await enrRow(e.enrollmentId);
      expect(row.status).toBe('active');
      expect(row.pause_reason).toBeNull();
      expect(row.completed_at).toBeNull();
      expect(row.tracking_data?.completion_reason).toBeUndefined();
      expect(row.tracking_data?.manual_stop).toBeUndefined();
      expect(typeof row.tracking_data?.manual_stop_undone_at).toBe('string');
      expect(await execsOf(e.enrollmentId), 'aucune exécution créée').toHaveLength(2);
    }

    // Jeton déjà utilisé : la séquence a changé.
    const again = await undo(token, org.orgId, [a.enrollmentId], stopped.token);
    expect(resultOf(again, a.enrollmentId)?.outcome).toBe('moved_since');
    expect((await enrRow(a.enrollmentId)).status).toBe('active');

    await makeDue(a.followUp, b.followUp);
    await runCycle();
    expect(await sentTexts(accountId), 'une relance par candidat, une seule fois').toEqual(['Relance', 'Relance']);
    expect((await execRow(a.followUp)).status).toBe('sent');
    expect((await execRow(b.followUp)).status).toBe('sent');
  });

  test('@critical annulation d’un arrêt posé sur une pause : retour en pause avec sa raison, étape réarmée à la reprise', async () => {
    const { org, accountId, token } = await scene('E2E 5b Pause');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const p = await midSequence(org, seq, org.owner.userId, accountId, {
      followUpInMinutes: DAY, overrides: { status: 'paused', pause_reason: 'quota_reached' },
    });
    const original = (await execRow(p.followUp)).scheduled_at;

    const stopped = await stop(token, org.orgId, [p.enrollmentId]);
    expect(resultOf(stopped, p.enrollmentId)?.outcome).toBe('stopped');
    const closed = await enrRow(p.enrollmentId);
    expect(closed.status).toBe('completed');
    expect(closed.tracking_data?.manual_stop).toEqual(expect.objectContaining({ previous_status: 'paused', previous_pause_reason: 'quota_reached' }));
    expect((await execRow(p.followUp)).skip_reason, 'étape gardée par la pause annulée par l’arrêt').toBe(MANUAL_STOP);

    const res = await undo(token, org.orgId, [p.enrollmentId], stopped.token);
    expect(resultOf(res, p.enrollmentId)).toEqual(expect.objectContaining({ outcome: 'paused' }));
    const row = await enrRow(p.enrollmentId);
    expect(row.status).toBe('paused');
    expect(row.pause_reason, 'raison d’avant l’arrêt').toBe('quota_reached');
    expect(row.completed_at).toBeNull();
    expect(row.tracking_data?.manual_stop).toBeUndefined();
    const exec = await execRow(p.followUp);
    expect(exec.status, 'rien n’est réarmé tant que la pause dure').toBe('cancelled');
    expect(exec.skip_reason).toBe(MANUAL_STOP);

    const resumed = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [p.enrollmentId] });
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
    expect((resumed.body.results as StopResult[])[0]?.outcome).toBe('resumed');
    const rearmed = await execRow(p.followUp);
    expect(rearmed.status, '« Arrêt manuel » réarmé à la reprise').toBe('scheduled');
    expect(ms(rearmed.scheduled_at)).toBe(ms(original));
  });

  test('@critical étape « sending » partie pendant l’arrêt : l’annulation planifie l’étape suivante, la relance n’est jamais renvoyée', async () => {
    const { org, accountId, token } = await scene('E2E 5b Sending');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance', 'Dernière'], 0);
    const s = await midSequence(org, seq, org.owner.userId, accountId, { followUpStatus: 'sending', followUpInMinutes: -1 });

    const stopped = await stop(token, org.orgId, [s.enrollmentId]);
    expect(resultOf(stopped, s.enrollmentId)?.outcome).toBe('stopped');
    expect((await execRow(s.followUp)).status).toBe('sending');
    // Le moteur termine l'envoi pendant l'arrêt : message parti, suite non planifiée.
    await admin().from('sequence_step_executions').update({
      status: 'sent', executed_at: new Date().toISOString(), final_message: 'Relance',
      skip_reason: 'Inscription devenue completed pendant l\'envoi',
    }).eq('id', s.followUp);

    const res = await undo(token, org.orgId, [s.enrollmentId], stopped.token);
    expect(resultOf(res, s.enrollmentId)?.outcome).toBe('resumed');
    expect((await execRow(s.followUp)).status).toBe('sent');
    const next = (await execsOf(s.enrollmentId)).filter((e) => e.status === 'scheduled');
    expect(next, 'l’étape suivante est planifiée').toHaveLength(1);
    expect(next[0].step_order).toBe(2);

    await makeDue(next[0].id);
    await runCycle();
    expect(await sentTexts(accountId), 'seule l’étape suivante part').toEqual(['Dernière']);
  });
  test('@critical attente annulée par l’arrêt : « Annuler » la réarme à sa date d’origine, le moteur la remet en attente sans que son délai reparte de zéro', async () => {
    const { org, accountId, token } = await scene('E2E 5b Attente');
    const { sequenceId, steps } = await seedSequence(org.orgId, org.owner.userId, [
      { action_type: 'message' }, { action_type: 'wait_reply' }, { action_type: 'message', delay_days: 0 },
    ]);
    await admin().from('sequence_steps').update({ timeout_days: 7 }).eq('id', steps[1].id);
    await admin().from('sequence_steps').update({ message_template: 'Relance' }).eq('id', steps[2].id);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, enrollmentId, steps[0], {
      status: 'sent', scheduled_at: minutesFromNow(-7 * DAY), executed_at: minutesFromNow(-7 * DAY),
      created_at: minutesFromNow(-7 * DAY), final_message: 'Bonjour',
    });
    // « Si pas de réponse sous 7 jours » : attente commencée il y a 6 jours.
    const waitingSince = minutesFromNow(-6 * DAY);
    const wait = await schedule(org, enrollmentId, steps[1], { status: 'waiting_event', scheduled_at: waitingSince, created_at: minutesFromNow(-6 * DAY) });

    const stopped = await stop(token, org.orgId, [enrollmentId]);
    expect(resultOf(stopped, enrollmentId)?.outcome).toBe('stopped');
    const cancelled = await execRow(wait);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.skip_reason).toBe(MANUAL_STOP);

    const res = await undo(token, org.orgId, [enrollmentId], stopped.token);
    expect(resultOf(res, enrollmentId)?.outcome).toBe('resumed');
    const rearmed = await execRow(wait);
    expect(rearmed.status).toBe('scheduled');
    expect(ms(rearmed.scheduled_at), 'date d’origine : le délai garde son point de départ').toBe(ms(waitingSince));

    await runCycle();
    const waiting = await execRow(wait);
    expect(waiting.status, 'sans réponse, le moteur la remet en attente').toBe('waiting_event');
    expect(ms(waiting.scheduled_at), 'début de l’attente inchangé (il reste un jour, pas sept)').toBe(ms(waitingSince));
    expect(await sentTexts(accountId), 'rien ne part').toEqual([]);
    expect(await execsOf(enrollmentId), 'aucune exécution créée').toHaveLength(2);

    // Le délai court depuis le début d'origine : un jour plus tard, il est dépassé.
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-7 * DAY - 60) }).eq('id', wait);
    for (let i = 0; i < 3 && (await execRow(wait)).status === 'waiting_event'; i++) await runEngine({ action: 'check_timeouts' });
    expect((await execRow(wait)).status, 'délai dépassé : la branche « sans réponse » est prise').toBe('skipped');
  });

  test('@critical arrêt posé sur une pause automatique : cause levée pendant l’arrêt, « Annuler » reprend l’inscription ; cause toujours présente, retour en pause avec sa raison', async () => {
    const { org, accountId, token } = await scene('E2E 5b Pause levée');
    const colleague = await member(org, 'member', 'collegue');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const seqOff = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', seqOff.sequenceId);
    await admin().from('member_linkedin_accounts').update({ account_status: 'CREDENTIALS' })
      .eq('organization_id', org.orgId).in('linkedin_account_id', [accountId, colleague.accountId]);
    await admin().from('organization_subscriptions').update({ plan_id: 'free', status: 'active' }).eq('organization_id', org.orgId);
    const paused = (reason: string) => ({ overrides: { status: 'paused', pause_reason: reason } });
    const reconnected = await midSequence(org, seq, org.owner.userId, accountId, paused('account_disconnected'));
    const stillDisconnected = await midSequence(org, seq, colleague.user.userId, colleague.accountId, paused('account_disconnected'));
    const reactivated = await midSequence(org, seqOff, org.owner.userId, accountId, paused('sequence_inactive'));
    const subscribed = await midSequence(org, seq, org.owner.userId, accountId, paused('subscription_required'));
    const all = [reconnected, stillDisconnected, reactivated, subscribed];
    const originals = new Map<string, string>();
    for (const e of all) originals.set(e.followUp, (await execRow(e.followUp)).scheduled_at);

    const stopped = await stop(token, org.orgId, all.map((e) => e.enrollmentId));
    expect(stopped.counts.stopped).toBe(4);
    // Pendant l'arrêt : compte du propriétaire reconnecté, séquence réactivée, abonnement payé.
    // Les reprises automatiques ne visent que les inscriptions en pause : celles-ci sont closes.
    await admin().from('member_linkedin_accounts').update({ account_status: 'OK' })
      .eq('organization_id', org.orgId).eq('linkedin_account_id', accountId);
    await admin().from('outreach_sequences').update({ is_active: true }).eq('id', seqOff.sequenceId);
    await setPaidPlan(org.orgId);

    const res = await undo(token, org.orgId, all.map((e) => e.enrollmentId), stopped.token);
    for (const e of [reconnected, reactivated, subscribed]) {
      expect(resultOf(res, e.enrollmentId), 'cause levée : reprise là où elle en était').toEqual(expect.objectContaining({ outcome: 'resumed' }));
      const row = await enrRow(e.enrollmentId);
      expect(row.status).toBe('active');
      expect(row.pause_reason).toBeNull();
      const exec = await execRow(e.followUp);
      expect(exec.status, 'étape annulée par l’arrêt réarmée').toBe('scheduled');
      expect(ms(exec.scheduled_at)).toBe(ms(originals.get(e.followUp)));
    }
    expect(resultOf(res, stillDisconnected.enrollmentId)).toEqual(expect.objectContaining({ outcome: 'paused' }));
    const held = await enrRow(stillDisconnected.enrollmentId);
    expect(held.status, 'compte toujours déconnecté : retour en pause').toBe('paused');
    expect(held.pause_reason, 'la reconnexion de ce compte la reprendra').toBe('account_disconnected');
    expect((await execRow(stillDisconnected.followUp)).skip_reason).toBe(MANUAL_STOP);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Refus d'annulation
// ════════════════════════════════════════════════════════════════════════════
test.describe('@critical Refus d’annulation', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical délai passé, autre auteur, jeton faux : refus sans écriture ; l’auteur annule ensuite avec le bon jeton', async () => {
    const { org, accountId, token } = await scene('E2E 5b Refus');
    const colleague = await member(org, 'member', 'collegue');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const late = await midSequence(org, seq, org.owner.userId, accountId);
    const other = await midSequence(org, seq, org.owner.userId, accountId);
    const forged = await midSequence(org, seq, org.owner.userId, accountId);
    const stopped = await stop(token, org.orgId, [late.enrollmentId, other.enrollmentId, forged.enrollmentId]);
    expect(stopped.counts.stopped).toBe(3);
    await patchTracking(late.enrollmentId, (t) => ({ ...t, manual_stop: { ...(t.manual_stop as Json), at: minutesFromNow(-3) } }));

    const expired = await undo(token, org.orgId, [late.enrollmentId], stopped.token);
    expect(resultOf(expired, late.enrollmentId)).toEqual(expect.objectContaining({
      outcome: 'expired', message: 'Annulation impossible : le délai est passé.',
    }));
    const byColleague = await undo(colleague.token, org.orgId, [other.enrollmentId], stopped.token);
    expect(resultOf(byColleague, other.enrollmentId)?.outcome).toBe('not_author');
    const wrong = await undo(token, org.orgId, [forged.enrollmentId], randomUUID());
    expect(resultOf(wrong, forged.enrollmentId)).toEqual(expect.objectContaining({
      outcome: 'moved_since', message: 'Annulation impossible : la séquence du candidat a changé entre-temps.',
    }));
    for (const e of [late, other, forged]) {
      expect((await enrRow(e.enrollmentId)).status, 'refus : aucune écriture').toBe('completed');
      expect((await execRow(e.followUp)).status).toBe('cancelled');
    }
    // Jeton manquant : demande invalide.
    const missing = await engine(token, { action: 'undo_stop_enrollments', organization_id: org.orgId, enrollment_ids: [other.enrollmentId] });
    expect(missing.status).toBe(400);
    expect(missing.body.error_code).toBe('invalid_request');

    const byAuthor = await undo(token, org.orgId, [other.enrollmentId], stopped.token);
    expect(resultOf(byAuthor, other.enrollmentId)?.outcome, 'un refus ne consomme pas le jeton').toBe('resumed');
  });

  test('@critical réponse tardive après un arrêt : l’inscription passe « répondu » et l’annulation est refusée', async () => {
    const { org, accountId, token } = await scene('E2E 5b Réponse');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const r = await midSequence(org, seq, org.owner.userId, accountId);
    const stopped = await stop(token, org.orgId, [r.enrollmentId]);
    const stoppedAt = ms((await enrRow(r.enrollmentId)).completed_at);

    const chatId = `chat_${rand()}${rand()}`;
    await webhook(replyFrom(accountId, r.profileId, chatId));
    const row = await enrRow(r.enrollmentId);
    expect(row.status, 'réponse tardive : « répondu »').toBe('replied');
    expect(row.replied_at).not.toBeNull();
    expect(ms(row.completed_at), 'date de l’arrêt gardée').toBe(stoppedAt);

    const res = await undo(token, org.orgId, [r.enrollmentId], stopped.token);
    expect(resultOf(res, r.enrollmentId)).toEqual(expect.objectContaining({
      outcome: 'replied', message: 'Annulation impossible : le candidat a répondu entre-temps.',
    }));
    expect((await enrRow(r.enrollmentId)).status).toBe('replied');
    expect((await execRow(r.followUp)).status).toBe('cancelled');

    await makeDue(r.followUp);
    await runCycle();
    await waitForAutoAnalyze(chatId);
    expect(await sentTexts(accountId), 'aucune relance après la réponse').toEqual([]);
  });

  test('@critical réponse vue ailleurs depuis l’arrêt : conversation de la mission ou autre inscription du candidat (slug) ; refus « replied »', async () => {
    const { org, accountId, token } = await scene('E2E 5b Réponse ailleurs');
    const colleague = await member(org, 'member', 'collegue');
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const viaConversation = await midSequence(org, seq, org.owner.userId, accountId);
    const slug = `camille-soeur-${rand()}`;
    const viaSibling = await midSequence(org, seq, org.owner.userId, accountId, {
      overrides: { profile_url: `https://www.linkedin.com/in/${slug}` },
    });
    const control = await midSequence(org, seq, org.owner.userId, accountId);
    const stopped = await stop(token, org.orgId, [viaConversation.enrollmentId, viaSibling.enrollmentId, control.enrollmentId]);
    expect(stopped.counts.stopped).toBe(3);

    // Réponse reçue sur le compte d'un collègue, rattachée à la mission.
    await seedMissionConversation({
      orgId: org.orgId, projectId: missionId, accountId: colleague.accountId, candidateId: viaConversation.profileId,
      lastOutboundAt: new Date(Date.now() - 2 * DAY * 60_000), lastInboundAt: new Date(),
    });
    // Autre inscription du même candidat (même slug, autre identifiant), « répondu » depuis l'arrêt.
    const seqB = await messageSequence(org, colleague.user.userId, ['Bonjour de B']);
    await enroll(org, seqB.sequenceId, colleague.user.userId, colleague.accountId, {
      profile_url: `https://www.linkedin.com/in/${slug}/`, status: 'replied', replied_at: new Date().toISOString(),
      created_at: minutesFromNow(-3 * DAY),
    });
    // Réponse antérieure à l'arrêt : sans effet.
    await seedMissionConversation({
      orgId: org.orgId, projectId: missionId, accountId, candidateId: control.profileId,
      lastOutboundAt: new Date(Date.now() - 2 * DAY * 60_000), lastInboundAt: new Date(Date.now() - DAY * 60_000),
    });

    const res = await undo(token, org.orgId, [viaConversation.enrollmentId, viaSibling.enrollmentId, control.enrollmentId], stopped.token);
    expect(resultOf(res, viaConversation.enrollmentId)?.outcome).toBe('replied');
    expect(resultOf(res, viaSibling.enrollmentId)?.outcome).toBe('replied');
    expect(resultOf(res, control.enrollmentId)?.outcome, 'réponse d’avant l’arrêt : annulation permise').toBe('resumed');
    expect((await enrRow(viaConversation.enrollmentId)).status).toBe('completed');
    expect((await enrRow(viaSibling.enrollmentId)).status).toBe('completed');
  });

  test('@critical RGPD : un candidat effacé n’est ni arrêté ni repris par l’annulation (marqueur, étape annulée, registre)', async () => {
    const { org, accountId, token } = await scene('E2E 5b RGPD');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const marked = await midSequence(org, seq, org.owner.userId, accountId);
    const registryUrl = `https://www.linkedin.com/in/camille-efface-${rand()}`;
    const registry = await midSequence(org, seq, org.owner.userId, accountId, { overrides: { profile_url: registryUrl } });
    const viaExec = await midSequence(org, seq, org.owner.userId, accountId);
    // Effacés avant l'arrêt : ignorés. Par le marqueur durable, ou par une
    // étape annulée par l'effacement (sans marqueur).
    const erasedBefore = await midSequence(org, seq, org.owner.userId, accountId);
    await patchTracking(erasedBefore.enrollmentId, (t) => ({ ...t, gdpr_erased_at: new Date().toISOString() }));
    const erasedByExec = await midSequence(org, seq, org.owner.userId, accountId);
    await schedule(org, erasedByExec.enrollmentId, seq.steps[1], {
      status: 'cancelled', skip_reason: GDPR_ERASURE_SKIP_REASON, scheduled_at: minutesFromNow(-60), executed_at: minutesFromNow(-60),
    });

    const stopped = await stop(token, org.orgId, [
      marked.enrollmentId, registry.enrollmentId, viaExec.enrollmentId, erasedBefore.enrollmentId, erasedByExec.enrollmentId,
    ]);
    for (const e of [erasedBefore, erasedByExec]) {
      expect(resultOf(stopped, e.enrollmentId)?.outcome).toBe('gdpr_erased');
      const row = await enrRow(e.enrollmentId);
      expect(row.status, 'candidat effacé : rien n’est écrit').toBe('active');
      expect(row.tracking_data?.manual_stop).toBeUndefined();
      expect((await execRow(e.followUp)).status).toBe('scheduled');
    }
    expect((await enrRow(erasedByExec.enrollmentId)).tracking_data?.gdpr_erased_at, 'détecté par l’étape annulée seule').toBeUndefined();
    expect(resultOf(stopped, marked.enrollmentId)?.outcome).toBe('stopped');
    expect(resultOf(stopped, registry.enrollmentId)?.outcome).toBe('stopped');
    expect(resultOf(stopped, viaExec.enrollmentId)?.outcome).toBe('stopped');

    // Effacements arrivés pendant l'arrêt : marqueur durable, étape annulée par l'effacement, puis registre global.
    await patchTracking(marked.enrollmentId, (t) => ({ ...t, gdpr_erased_at: new Date().toISOString() }));
    await schedule(org, viaExec.enrollmentId, seq.steps[1], {
      status: 'cancelled', skip_reason: GDPR_ERASURE_SKIP_REASON, scheduled_at: minutesFromNow(-1), executed_at: minutesFromNow(-1),
    });
    const { data: erasure, error } = await admin().from('gdpr_erasures')
      .insert({ linkedin_url_hash: linkedinUrlHash(registryUrl), reason: 'user_request', source: 'e2e-seq-stop' }).select('id').single();
    if (error || !erasure) throw new Error(`gdpr_erasures: ${error?.message}`);
    cleanups.push(() => admin().from('gdpr_erasures').delete().eq('id', erasure.id));

    const res = await undo(token, org.orgId, [marked.enrollmentId, registry.enrollmentId, viaExec.enrollmentId], stopped.token);
    expect(resultOf(res, marked.enrollmentId)?.outcome).toBe('gdpr_erased');
    expect(resultOf(res, registry.enrollmentId)?.outcome).toBe('gdpr_erased');
    expect(resultOf(res, viaExec.enrollmentId)?.outcome, 'étape annulée par l’effacement, sans marqueur').toBe('gdpr_erased');
    expect((await enrRow(viaExec.enrollmentId)).tracking_data?.gdpr_erased_at).toBeUndefined();
    for (const e of [marked, registry, viaExec]) {
      expect((await enrRow(e.enrollmentId)).status).toBe('completed');
      expect((await execRow(e.followUp)).status).toBe('cancelled');
    }
  });

  test('@critical compte dissocié ou séquence en pause entre-temps : l’annulation laisse la pause manuelle et dit pourquoi', async () => {
    const { org, accountId, token } = await scene('E2E 5b Compte');
    const colleague = await member(org, 'member', 'collegue');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const unlinked = await midSequence(org, seq, org.owner.userId, accountId);
    const seq2 = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const inactive = await midSequence(org, seq2, colleague.user.userId, colleague.accountId);

    const stopped = await stop(token, org.orgId, [unlinked.enrollmentId, inactive.enrollmentId]);
    expect(stopped.counts.stopped).toBe(2);
    await admin().from('member_linkedin_accounts').delete().eq('organization_id', org.orgId).eq('linkedin_account_id', accountId);
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', seq2.sequenceId);

    const res = await undo(token, org.orgId, [unlinked.enrollmentId, inactive.enrollmentId], stopped.token);
    expect(resultOf(res, unlinked.enrollmentId)).toEqual(expect.objectContaining({
      outcome: 'resume_refused', reason: 'account_unlinked', message: ACCOUNT_UNLINKED_UNDO,
    }));
    expect(resultOf(res, inactive.enrollmentId)).toEqual(expect.objectContaining({
      outcome: 'resume_refused', reason: 'sequence_inactive', message: SEQUENCE_INACTIVE_UNDO,
    }));
    for (const e of [unlinked, inactive]) {
      const row = await enrRow(e.enrollmentId);
      expect(row.status, 'reste en pause').toBe('paused');
      expect(row.pause_reason).toBe('manual');
      expect(row.completed_at).toBeNull();
      expect(row.tracking_data?.manual_stop).toBeUndefined();
      expect((await execRow(e.followUp)).skip_reason, 'étape gardée pour une reprise').toBe(MANUAL_STOP);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Collaborateur, limite de 200, « Relancer »
// ════════════════════════════════════════════════════════════════════════════
test.describe('@critical Arrêt : collaborateur, limite, relance', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical un collaborateur n’arrête et n’annule que ses candidats', async () => {
    const { org, accountId } = await scene('E2E 5b Collaborateur');
    const collab = await member(org, 'collaborator', 'collab');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const own = await midSequence(org, seq, collab.user.userId, collab.accountId);
    const ownerOne = await midSequence(org, seq, org.owner.userId, accountId);

    const stopped = await stop(collab.token, org.orgId, [own.enrollmentId, ownerOne.enrollmentId]);
    expect(resultOf(stopped, own.enrollmentId)?.outcome).toBe('stopped');
    expect(resultOf(stopped, ownerOne.enrollmentId)).toEqual(expect.objectContaining({ outcome: 'forbidden', message: COLLABORATOR_ACTION_MESSAGE }));
    expect((await enrRow(ownerOne.enrollmentId)).status, 'candidat du propriétaire intact').toBe('active');
    expect((await execRow(ownerOne.followUp)).status).toBe('scheduled');

    const res = await undo(collab.token, org.orgId, [own.enrollmentId], stopped.token);
    expect(resultOf(res, own.enrollmentId)?.outcome).toBe('resumed');
    expect((await enrRow(own.enrollmentId)).status).toBe('active');
  });

  test('@critical 201 identifiants refusés sans écriture ; 200 arrêtés en moins de 60 s', async () => {
    const { org, accountId, token } = await scene('E2E 5b Limite');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const rows = Array.from({ length: 200 }, () => ({
      sequence_id: seq.sequenceId, organization_id: org.orgId, created_by: org.owner.userId,
      profile_id: `ACoAAE2E${rand()}${rand()}`, profile_name: 'Camille Martin', account_id: accountId,
      status: 'active', current_step_order: 0, user_timezone: 'Europe/Paris',
    }));
    const { data: inserted, error } = await admin().from('sequence_enrollments').insert(rows).select('id');
    if (error || !inserted) throw new Error(`enrollments: ${error?.message}`);
    const ids = (inserted as Array<{ id: string }>).map((r) => r.id);
    const { error: execErr } = await admin().from('sequence_step_executions').insert(ids.map((id) => ({
      enrollment_id: id, organization_id: org.orgId, step_id: seq.steps[0].id, step_order: 0,
      status: 'scheduled', scheduled_at: minutesFromNow(2 * DAY),
    })));
    if (execErr) throw new Error(`executions: ${execErr.message}`);

    const tooMany = await engine(token, { action: 'stop_enrollments', organization_id: org.orgId, enrollment_ids: [...ids, randomUUID()] });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body).toEqual(expect.objectContaining({ error_code: 'too_many', message: '200 candidats au plus par demande.' }));
    const { count: stillActive } = await admin().from('sequence_enrollments').select('id', { count: 'exact', head: true })
      .eq('sequence_id', seq.sequenceId).eq('status', 'active');
    expect(stillActive, 'refus : aucune inscription touchée').toBe(200);
    const undoTooMany = await engine(token, { action: 'undo_stop_enrollments', organization_id: org.orgId, enrollment_ids: [...ids, randomUUID()], token: randomUUID() });
    expect(undoTooMany.status).toBe(400);
    expect(undoTooMany.body.error_code).toBe('too_many');

    const started = Date.now();
    const res = await stop(token, org.orgId, ids);
    const elapsed = Date.now() - started;
    console.log(`[seq-stop] 200 arrêts en ${elapsed} ms`, JSON.stringify(res.counts));
    expect(res.counts.stopped, JSON.stringify(res.counts)).toBe(200);
    expect(elapsed, `200 arrêts en ${elapsed} ms`).toBeLessThan(60_000);
    const { count: completed } = await admin().from('sequence_enrollments').select('id', { count: 'exact', head: true })
      .eq('sequence_id', seq.sequenceId).eq('status', 'completed').eq('tracking_data->>completion_reason', 'manual_stop');
    expect(completed).toBe(200);
    const { count: cancelled } = await admin().from('sequence_step_executions').select('id', { count: 'exact', head: true })
      .in('enrollment_id', ids.slice(0, 100)).eq('status', 'cancelled').eq('skip_reason', MANUAL_STOP);
    expect(cancelled).toBe(100);

    // « Annuler » cliqué juste avant l'échéance (toast encore ouvert) : arrêt
    // antidaté à 118,5 s. Le délai est lu à la réception de la demande pour
    // les 200 inscriptions : celles traitées après les 2 minutes sont acceptées.
    psql(`UPDATE public.sequence_enrollments
             SET tracking_data = jsonb_set(tracking_data, '{manual_stop,at}',
                 to_jsonb(to_char((now() - interval '118.5 seconds') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
           WHERE sequence_id = '${seq.sequenceId}' AND status = 'completed'`);
    const undoStarted = Date.now();
    const undone = await undo(token, org.orgId, ids, res.token);
    const undoElapsed = Date.now() - undoStarted;
    console.log(`[seq-stop] 200 annulations en ${undoElapsed} ms`, JSON.stringify(undone.counts));
    expect(undone.counts, `200 annulations en ${undoElapsed} ms`).toEqual(expect.objectContaining({ resumed: 200, expired: 0, error: 0 }));
    expect(undoElapsed, `200 annulations en ${undoElapsed} ms`).toBeLessThan(60_000);
    const { count: active } = await admin().from('sequence_enrollments').select('id', { count: 'exact', head: true })
      .eq('sequence_id', seq.sequenceId).eq('status', 'active');
    expect(active).toBe(200);
  });

  test('@critical « Relancer » après un arrêt : reprend l’étape annulée, trace de l’arrêt retirée', async () => {
    const { org, accountId, token } = await scene('E2E 5b Relancer');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const r = await midSequence(org, seq, org.owner.userId, accountId);
    const original = (await execRow(r.followUp)).scheduled_at;
    await stop(token, org.orgId, [r.enrollmentId]);

    const res = await engine(token, { action: 're_enroll', organization_id: org.orgId, enrollment_ids: [r.enrollmentId] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.results as StopResult[])[0]?.outcome).toBe('resumed');
    const exec = await execRow(r.followUp);
    expect(exec.status, 'étape annulée « Arrêt manuel » réarmée').toBe('scheduled');
    expect(exec.skip_reason).toBeNull();
    expect(ms(exec.scheduled_at)).toBe(ms(original));
    const row = await enrRow(r.enrollmentId);
    expect(row.status).toBe('active');
    expect(row.completed_at).toBeNull();
    expect(row.tracking_data?.completion_reason, 'une fin ultérieure ne s’affichera pas comme un arrêt').toBeUndefined();
    expect(row.tracking_data?.manual_stop).toBeUndefined();
    expect(typeof row.tracking_data?.re_enrolled_at).toBe('string');
    expect(await execsOf(r.enrollmentId)).toHaveLength(2);

    await makeDue(r.followUp);
    await runCycle();
    expect(await sentTexts(accountId)).toEqual(['Relance']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Pause immédiate et son annulation par resume_enrollments
// ════════════════════════════════════════════════════════════════════════════
test.describe('@critical Pause puis « Annuler » (resume_enrollments)', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical pause d’un candidat par le navigateur, puis annulation : reprise, étape gardée à sa date', async () => {
    const { org, accountId, token } = await scene('E2E 5b Pause candidat');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const p = await midSequence(org, seq, org.owner.userId, accountId);
    const original = (await execRow(p.followUp)).scheduled_at;

    // Même écriture que l'écran : garde sur le statut actif, identifiants rendus.
    const paused = await rest('PATCH', `sequence_enrollments?id=eq.${p.enrollmentId}&status=eq.active&select=id`, token, {
      status: 'paused', pause_reason: 'manual',
    });
    expect(paused.status, JSON.stringify(paused.body)).toBe(200);
    expect(paused.body).toEqual([{ id: p.enrollmentId }]);
    expect((await execRow(p.followUp)).status, 'la pause n’annule rien').toBe('scheduled');

    const res = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [p.enrollmentId] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.results as StopResult[])[0]?.outcome).toBe('resumed');
    expect((await enrRow(p.enrollmentId)).status).toBe('active');
    const exec = await execRow(p.followUp);
    expect(exec.status).toBe('scheduled');
    expect(ms(exec.scheduled_at)).toBe(ms(original));
  });

  test('@critical pause de séquence annulée : resume_enrollments ne reprend que les identifiants rendus par la pause ; la pause automatique antérieure, reprenable, reste', async () => {
    const { org, accountId, token } = await scene('E2E 5b Pause séquence');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const a = await midSequence(org, seq, org.owner.userId, accountId);
    const b = await midSequence(org, seq, org.owner.userId, accountId);
    const auto = await midSequence(org, seq, org.owner.userId, accountId, { overrides: { status: 'paused', pause_reason: 'auto_paused' } });

    // « Mettre en pause la séquence » : inscriptions d'abord, interrupteur ensuite.
    const pausedRes = await rest('PATCH', `sequence_enrollments?sequence_id=eq.${seq.sequenceId}&status=eq.active&select=id`, token, {
      status: 'paused', pause_reason: 'sequence_inactive',
    });
    expect(pausedRes.status, JSON.stringify(pausedRes.body)).toBe(200);
    const pausedIds = (pausedRes.body as Array<{ id: string }>).map((r) => r.id).sort();
    expect(pausedIds).toEqual([a.enrollmentId, b.enrollmentId].sort());
    const off = await rest('PATCH', `outreach_sequences?id=eq.${seq.sequenceId}&select=id`, token, { is_active: false });
    expect(off.body).toEqual([{ id: seq.sequenceId }]);

    // « Annuler » : interrupteur remis, puis reprise des seules inscriptions rendues.
    const on = await rest('PATCH', `outreach_sequences?id=eq.${seq.sequenceId}&select=id`, token, { is_active: true });
    expect(on.body).toEqual([{ id: seq.sequenceId }]);
    const res = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: pausedIds });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.counts as Record<string, number>).resumed).toBe(2);
    expect((await enrRow(a.enrollmentId)).status).toBe('active');
    expect((await enrRow(b.enrollmentId)).status).toBe('active');
    const autoRow = await enrRow(auto.enrollmentId);
    expect(autoRow.status, 'pause automatique antérieure gardée').toBe('paused');
    expect(autoRow.pause_reason).toBe('auto_paused');
    expect((await execRow(a.followUp)).status).toBe('scheduled');

    // Elle était bien reprenable : une reprise par séquence et raisons (celle
    // de « Réactiver ») la reprend. L'annulation ne passe jamais par là.
    const bySequence = await engine(token, {
      action: 'resume_enrollments', organization_id: org.orgId, sequence_id: seq.sequenceId, pause_reasons: ['sequence_inactive', 'auto_paused'],
    });
    expect(bySequence.status, JSON.stringify(bySequence.body)).toBe(200);
    expect((await enrRow(auto.enrollmentId)).status, 'reprise par séquence : la pause automatique repart').toBe('active');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Recette locale du plan 5b : heure d'envoi, envoi en cours, compte, acceptation
// ════════════════════════════════════════════════════════════════════════════
test.describe('@critical Recette : arrêt aux moments limites', () => {
  test.describe.configure({ mode: 'serial' });

  /** Envoi LinkedIn lent (le moteur coupe à 15 s) : l'arrêt arrive après son dernier contrôle, pendant l'appel. */
  async function slowSend(accountId: string, delayMs: number) {
    await setMockMode(accountId, { routes: [{
      method: 'POST', path: '^/api/v1/chats', status: 201, delay_ms: delayMs, times: 1,
      body: { object: 'ChatStarted', chat_id: `chat_lent_${rand()}`, message_id: `msg_lent_${rand()}` },
    }] });
  }

  test('@critical étape prévue dans la minute : l’arrêt l’annule, rien ne part à son heure ; « Annuler » la réarme une minute plus tard, puis elle part une fois', async () => {
    const { org, accountId, token } = await scene('E2E 5b Minute');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const m = await midSequence(org, seq, org.owner.userId, accountId, { followUpInMinutes: 0.5 });
    const due = ms((await execRow(m.followUp)).scheduled_at);
    expect(due - Date.now(), 'relance prévue dans moins d’une minute').toBeLessThan(60_000);

    const stopped = await stop(token, org.orgId, [m.enrollmentId]);
    expect(resultOf(stopped, m.enrollmentId)?.outcome).toBe('stopped');
    const cancelled = await execRow(m.followUp);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.skip_reason).toBe(MANUAL_STOP);

    // L'heure prévue passe pendant l'arrêt : le passage du moteur n'envoie rien.
    await new Promise((r) => setTimeout(r, Math.max(0, due + 2_000 - Date.now())));
    await runCycle();
    expect(await mockCalls(accountId), 'journal du faux LinkedIn vide à l’heure prévue').toEqual([]);
    expect((await execRow(m.followUp)).status).toBe('cancelled');

    const res = await undo(token, org.orgId, [m.enrollmentId], stopped.token);
    expect(resultOf(res, m.enrollmentId)?.outcome, 'annulation dans les 2 minutes').toBe('resumed');
    const rearmed = await execRow(m.followUp);
    expect(rearmed.status).toBe('scheduled');
    expect(ms(rearmed.scheduled_at), 'heure passée : une minute plus tard, pas aussitôt').toBeGreaterThan(Date.now() + 30_000);
    expect(ms(rearmed.scheduled_at)).toBeLessThan(Date.now() + 70_000);
    await runCycle();
    expect(await sentTexts(accountId), 'rien avant la nouvelle heure').toEqual([]);

    await makeDue(m.followUp);
    await runCycle();
    expect(await sentTexts(accountId), 'la relance part une fois').toEqual(['Relance']);
    expect(await execsOf(m.enrollmentId), 'aucune exécution créée').toHaveLength(2);
  });

  test('@critical « sending » pendant l’arrêt : le message parti est enregistré sans suite ; « Annuler » planifie l’étape suivante, la relance ne repart jamais', async () => {
    const { org, accountId, token } = await scene('E2E 5b Envoi en cours');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance', 'Dernière'], 0);
    const s = await midSequence(org, seq, org.owner.userId, accountId, { followUpInMinutes: -1 });
    await slowSend(accountId, 8_000);

    const cycle = runCycle();
    await expect.poll(async () => (await sentTexts(accountId)).length, {
      timeout: 60_000, intervals: [100], message: 'appel d’envoi de la relance reçu par le faux LinkedIn',
    }).toBe(1);
    expect((await execRow(s.followUp)).status, 'étape verrouillée en base').toBe('sending');
    const stopped = await stop(token, org.orgId, [s.enrollmentId]);
    expect(resultOf(stopped, s.enrollmentId)?.outcome).toBe('stopped');
    expect((await execRow(s.followUp)).status, 'l’arrêt ne touche pas l’étape en cours d’envoi').toBe('sending');
    await cycle;

    const sent = await fullExec(s.followUp);
    expect(sent.status, 'le message est parti : enregistré « envoyé »').toBe('sent');
    expect(sent.final_message).toBe('Relance');
    const closed = await enrRow(s.enrollmentId);
    expect(closed.status, 'toujours arrêtée').toBe('completed');
    expect(closed.current_step_order, 'position avancée après l’envoi').toBe(2);
    expect((await execsOf(s.enrollmentId)).filter((e) => e.status === 'scheduled'), 'suite non planifiée pendant l’arrêt').toEqual([]);

    const res = await undo(token, org.orgId, [s.enrollmentId], stopped.token);
    expect(resultOf(res, s.enrollmentId)?.outcome).toBe('resumed');
    expect((await execRow(s.followUp)).status, 'la relance partie reste envoyée').toBe('sent');
    const next = (await execsOf(s.enrollmentId)).filter((e) => e.status === 'scheduled');
    expect(next, 'l’étape suivante est planifiée').toHaveLength(1);
    expect(next[0].step_order).toBe(2);

    await makeDue(next[0].id);
    await runCycle();
    expect(await sentTexts(accountId), 'relance une seule fois, puis l’étape suivante').toEqual(['Relance', 'Dernière']);
  });

  test('@critical « Annuler » pendant que l’étape est « sending » : l’annulation ne crée ni ne réarme rien, le moteur enregistre l’envoi et planifie la suite', async () => {
    const { org, accountId, token } = await scene('E2E 5b Annuler pendant envoi');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance', 'Dernière'], 0);
    const s = await midSequence(org, seq, org.owner.userId, accountId, { followUpInMinutes: -1 });
    await slowSend(accountId, 10_000);

    const cycle = runCycle();
    await expect.poll(async () => (await sentTexts(accountId)).length, {
      timeout: 60_000, intervals: [100], message: 'appel d’envoi de la relance reçu par le faux LinkedIn',
    }).toBe(1);
    const stopped = await stop(token, org.orgId, [s.enrollmentId]);
    expect(resultOf(stopped, s.enrollmentId)?.outcome).toBe('stopped');
    const res = await undo(token, org.orgId, [s.enrollmentId], stopped.token);
    expect(resultOf(res, s.enrollmentId)?.outcome).toBe('resumed');
    expect((await execRow(s.followUp)).status, 'annulée pendant l’appel : étape toujours à l’envoi').toBe('sending');
    expect(await execsOf(s.enrollmentId), 'aucune exécution créée par l’annulation').toHaveLength(2);
    expect((await enrRow(s.enrollmentId)).status).toBe('active');
    await cycle;

    expect((await execRow(s.followUp)).status).toBe('sent');
    const row = await enrRow(s.enrollmentId);
    expect(row.status).toBe('active');
    expect(row.current_step_order).toBe(2);
    const next = (await execsOf(s.enrollmentId)).filter((e) => e.status === 'scheduled');
    expect(next, 'suite planifiée par le moteur, une seule fois').toHaveLength(1);
    expect(next[0].step_order).toBe(2);

    await makeDue(next[0].id);
    await runCycle();
    expect(await sentTexts(accountId), 'relance une seule fois, puis l’étape suivante').toEqual(['Relance', 'Dernière']);
  });

  test('@critical compte déconnecté pendant l’arrêt : « Annuler » reprend, rien ne part tant qu’il l’est (pause « compte déconnecté »), la reconnexion relance l’étape une fois', async () => {
    const { org, accountId, token } = await scene('E2E 5b Compte déconnecté');
    const seq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const c = await midSequence(org, seq, org.owner.userId, accountId);
    const original = (await execRow(c.followUp)).scheduled_at;
    const stopped = await stop(token, org.orgId, [c.enrollmentId]);
    expect(resultOf(stopped, c.enrollmentId)?.outcome).toBe('stopped');

    await webhook({ event: 'account_disconnected', account_id: accountId, account_type: 'LINKEDIN' });
    const { data: link } = await admin().from('member_linkedin_accounts').select('account_status')
      .eq('organization_id', org.orgId).eq('linkedin_account_id', accountId).single();
    expect(link?.account_status, 'compte passé déconnecté').toBe('CREDENTIALS');

    const res = await undo(token, org.orgId, [c.enrollmentId], stopped.token);
    expect(resultOf(res, c.enrollmentId)?.outcome, 'compte toujours relié : la reprise accepte').toBe('resumed');
    const rearmed = await execRow(c.followUp);
    expect(rearmed.status).toBe('scheduled');
    expect(ms(rearmed.scheduled_at)).toBe(ms(original));

    await makeDue(c.followUp);
    await runCycle();
    expect(await sentTexts(accountId), 'rien ne part depuis un compte déconnecté').toEqual([]);
    const held = await enrRow(c.enrollmentId);
    expect(held.status).toBe('paused');
    expect(held.pause_reason).toBe('account_disconnected');
    const heldExec = await execRow(c.followUp);
    expect(heldExec.status).toBe('cancelled');
    expect(heldExec.skip_reason).toBe(ACCOUNT_DISCONNECTED_SKIP_REASON);

    await webhook({ event: 'account_connected', account_id: accountId, account_type: 'LINKEDIN' });
    const resumed = await enrRow(c.enrollmentId);
    expect(resumed.status, 'reconnexion : reprise automatique').toBe('active');
    expect(resumed.pause_reason).toBeNull();
    expect((await execRow(c.followUp)).status, 'étape replanifiée').toBe('scheduled');

    await makeDue(c.followUp);
    await runCycle();
    expect(await sentTexts(accountId), 'la relance part une fois après la reconnexion').toEqual(['Relance']);
    expect(await execsOf(c.enrollmentId)).toHaveLength(2);
  });

  test('@critical attente d’acceptation annulée par l’arrêt : « Annuler » la réarme, le moteur la remet en attente sans que son délai reparte ; une acceptation pendant l’arrêt est vue au passage suivant', async () => {
    const { org, accountId, token } = await scene('E2E 5b Acceptation');
    const colleague = await member(org, 'member', 'collegue');
    const { sequenceId, steps } = await seedSequence(org.orgId, org.owner.userId, [
      { action_type: 'connection_request' },
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted' },
      { action_type: 'message', delay_days: 0 },
    ]);
    await admin().from('sequence_steps').update({ timeout_days: 7 }).eq('id', steps[1].id);
    await admin().from('sequence_steps').update({ message_template: 'Merci' }).eq('id', steps[2].id);
    // A (compte du propriétaire) : invitation toujours en attente. B (compte du
    // collègue) : invitation acceptée pendant l'arrêt, LinkedIn la dit connectée.
    await setMockMode(accountId, { distance: 'SECOND_DEGREE' });
    const waitingSince = minutesFromNow(-2 * DAY);
    const seedWaiting = async (createdBy: string, acc: string) => {
      const { enrollmentId, profileId } = await enroll(org, sequenceId, createdBy, acc, { current_step_order: 1 });
      await schedule(org, enrollmentId, steps[0], {
        status: 'sent', scheduled_at: minutesFromNow(-2 * DAY - 1), executed_at: minutesFromNow(-2 * DAY - 1), created_at: minutesFromNow(-2 * DAY - 1),
      });
      const wait = await schedule(org, enrollmentId, steps[1], { status: 'waiting_event', scheduled_at: waitingSince, created_at: waitingSince });
      return { enrollmentId, profileId, wait };
    };
    const a = await seedWaiting(org.owner.userId, accountId);
    const b = await seedWaiting(colleague.user.userId, colleague.accountId);
    const accepted = (acc: string, profileId: string) => webhook({
      event: 'new_relation', account_id: acc, account_type: 'LINKEDIN',
      user_provider_id: profileId, user_full_name: 'Camille Martin', user_public_identifier: `camille-${rand()}`,
    });

    const stopped = await stop(token, org.orgId, [a.enrollmentId, b.enrollmentId]);
    expect(stopped.counts.stopped).toBe(2);
    for (const e of [a, b]) {
      const w = await execRow(e.wait);
      expect(w.status, 'attente annulée par l’arrêt').toBe('cancelled');
      expect(w.skip_reason).toBe(MANUAL_STOP);
    }
    // Acceptation de B pendant l'arrêt : le webhook ne vise que les inscriptions ouvertes.
    await accepted(colleague.accountId, b.profileId);
    expect((await execRow(b.wait)).status).toBe('cancelled');

    const res = await undo(token, org.orgId, [a.enrollmentId, b.enrollmentId], stopped.token);
    for (const e of [a, b]) {
      expect(resultOf(res, e.enrollmentId)?.outcome).toBe('resumed');
      const w = await execRow(e.wait);
      expect(w.status).toBe('scheduled');
      expect(ms(w.scheduled_at), 'date d’origine : le délai garde son point de départ').toBe(ms(waitingSince));
    }

    await runCycle();
    const aWait = await execRow(a.wait);
    expect(aWait.status, 'A : invitation en attente, attente reprise').toBe('waiting_event');
    expect(ms(aWait.scheduled_at), 'début de l’attente inchangé (il reste cinq jours, pas sept)').toBe(ms(waitingSince));
    expect(await sentTexts(accountId)).toEqual([]);
    expect(await sentInvites(accountId), 'aucune invitation renvoyée').toEqual([]);
    const bWait = await fullExec(b.wait);
    expect(bWait.status, 'B : acceptation lue au passage, attente franchie').toBe('sent');
    expect(bWait.final_message).toBe('Attente franchie : wait_connection');
    const { data: bRow } = await admin().from('sequence_enrollments').select('connection_status, status').eq('id', b.enrollmentId).single();
    expect(bRow).toEqual({ connection_status: 'connected', status: 'active' });
    const bNext = (await execsOf(b.enrollmentId)).filter((e) => e.status === 'scheduled');
    expect(bNext).toHaveLength(1);
    expect(bNext[0].step_order).toBe(2);

    // Délai relu : deux jours sur sept, l'attente de A continue.
    await runEngine({ action: 'check_timeouts' });
    expect((await execRow(a.wait)).status).toBe('waiting_event');
    expect(await execsOf(a.enrollmentId)).toHaveLength(2);

    // A accepte ensuite : attente réarmée par le webhook, franchie, puis « Merci » part une fois pour chacun.
    await accepted(accountId, a.profileId);
    expect((await execRow(a.wait)).status).toBe('scheduled');
    await makeDue(bNext[0].id);
    await runCycle();
    expect((await execRow(a.wait)).status).toBe('sent');
    expect(await sentTexts(colleague.accountId)).toEqual(['Merci']);
    const aNext = (await execsOf(a.enrollmentId)).filter((e) => e.status === 'scheduled');
    expect(aNext).toHaveLength(1);
    await makeDue(aNext[0].id);
    await runCycle();
    expect(await sentTexts(accountId)).toEqual(['Merci']);
    expect(await sentInvites(colleague.accountId)).toEqual([]);
  });
});

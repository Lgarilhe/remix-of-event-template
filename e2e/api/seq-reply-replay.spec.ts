/**
 * Lot « reply-replay » du module séquences : réponse d'un candidat reçue par le
 * webhook LinkedIn (unipile-webhook, message_received) quand une écriture
 * échoue au premier passage, puis rejeu du même événement par le prestataire.
 *
 * Contrat : CLAUDE.md, « Séquences : règles du moteur et de l'interface » (une
 * clôture annule toutes les exécutions en attente, jamais 'sending') ;
 * docs/audit-2026-09-25-sequences.md : SEQ-212 (une réponse arrête toutes les
 * séquences du candidat dans l'organisation, quel que soit le compte), SEQ-040
 * (une erreur de base répond 500 pour obtenir un rejeu, la réponse n'est jamais
 * perdue), SEQ-191 (réponse comptée une seule fois), SEQ-006 (pipeline borné à
 * l'organisation), SEQ-027 / SEQ-071 / SEQ-189 (étapes d'une inscription close
 * jamais envoyées).
 *
 * Harnais :
 * - panne simulée : déclencheur temporaire posé par psql, limité aux lignes du
 *   test (identifiant d'inscription, d'organisation ou clé de dédoublonnage),
 *   retiré dès que le scénario le demande et en fin de test dans tous les cas ;
 * - webhook appelé sans exiger 200 (le helper commun l'exige) ;
 * - journal des fonctions : /tmp/konekt-e2e-stack/functions.log (E2E_STACK_DIR),
 *   lu à partir de sa taille avant l'appel.
 *
 * Dimanche : le moteur tourne avec force: true. Ignoré sans la stack locale
 * (e2e/local-stack/up.sh).
 *
 * @critical
 */
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
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
  ENGINE_SKIP_REASON,
  WEBHOOK_SECRET,
  callFunction,
  engineAvailable,
  enroll,
  messageSequence,
  minutesFromNow,
  postJson,
  rand,
  runCycle,
  runEngine,
  schedule,
  sendingOrg,
  sentTexts,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(240_000);

// ─── Textes du contrat ──────────────────────────────────────────────────────
const SIBLING_REPLY_SKIP_REASON = "Le candidat a répondu sur un autre compte de l'organisation";
const WEBHOOK_REPLY_SKIP_REASON = 'Reply detected via webhook';
const closedBeforeSend = (status: string) => `Inscription close avant l'envoi (${status})`;
const closedWaitReason = (status: string) => `Inscription close (${status}) : attente annulée`;
const DAY = 24 * 60;
const STACK_DIR = process.env.E2E_STACK_DIR ?? '/tmp/konekt-e2e-stack';

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => unknown> = [];
test.afterEach(async () => {
  while (cleanups.length) {
    try { await cleanups.pop()!(); } catch { /* best effort */ }
  }
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    for (const table of ['job_candidate_status', 'notifications']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});

// ─── Panne simulée (psql) ───────────────────────────────────────────────────
function psql(sql: string): string {
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql],
    { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' },
  );
}
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * Déclencheur temporaire qui fait échouer l'écriture `event` sur `table` quand
 * `when` est vrai (condition limitée aux lignes du test). Renvoie la fonction
 * qui le retire, appelée aussi en fin de test.
 */
function injectFailure(table: string, event: 'UPDATE' | 'DELETE', when: string): () => void {
  const name = `e2e_rr_fail_${rand()}`;
  psql(
    `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'échec simulé (e2e reply-replay)'; END $f$;` +
    `CREATE TRIGGER ${name} BEFORE ${event} ON public.${table} FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION public.${name}();`,
  );
  let dropped = false;
  const drop = () => {
    if (dropped) return;
    dropped = true;
    psql(`DROP TRIGGER IF EXISTS ${name} ON public.${table}; DROP FUNCTION IF EXISTS public.${name}();`);
  };
  cleanups.push(drop);
  return drop;
}
/** F1 : l'arrêt des inscriptions sœurs échoue (passage à 'stopped' refusé). */
const failSiblingStop = (ids: string[]) =>
  injectFailure('sequence_enrollments', 'UPDATE', `NEW.status = 'stopped' AND OLD.id IN (${ids.map(lit).join(', ')})`);
/** F2 : l'annulation des étapes de l'inscription qui a reçu la réponse échoue. */
const failReplyCancel = (enrollmentId: string) =>
  injectFailure('sequence_step_executions', 'UPDATE', `NEW.skip_reason = ${lit(WEBHOOK_REPLY_SKIP_REASON)} AND NEW.enrollment_id = ${lit(enrollmentId)}`);
/** F3 : l'annulation des étapes des sœurs échoue (sœur déjà passée 'stopped'). */
const failSiblingCancel = (orgId: string) =>
  injectFailure('sequence_step_executions', 'UPDATE', `NEW.skip_reason = ${lit(SIBLING_REPLY_SKIP_REASON)} AND NEW.organization_id = ${lit(orgId)}`);
/** F4 : la purge de la clé de dédoublonnage échoue. */
const failDedupPurge = (eventKey: string) =>
  injectFailure('webhook_event_log', 'DELETE', `OLD.event_key = ${lit(eventKey)}`);

// ─── Journal des fonctions ──────────────────────────────────────────────────
function logSize(): number {
  try { return statSync(`${STACK_DIR}/functions.log`).size; } catch { return 0; }
}
function logSince(offset: number): string {
  const path = `${STACK_DIR}/functions.log`;
  const size = logSize();
  if (size <= offset) return '';
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

// ─── Appels ─────────────────────────────────────────────────────────────────
/** Webhook LinkedIn sans exigence de statut. */
function rawWebhook(payload: Record<string, unknown>) {
  return postJson('/functions/v1/unipile-webhook', payload, { 'unipile-auth': WEBHOOK_SECRET });
}
/** Message du candidat, format à plat (message_received), identifiant de message fixe pour le rejeu. */
function replyFrom(accountId: string, profileId: string) {
  const messageId = `msg_rr_${rand()}`;
  return {
    messageId,
    eventKey: `unipile:message_received:${messageId}`,
    payload: {
      event: 'message_received',
      account_id: accountId,
      account_type: 'LINKEDIN',
      chat_id: `chat_rr_${rand()}`,
      message_id: messageId,
      message: 'Bonjour, oui avec plaisir',
      sender: { attendee_provider_id: profileId, attendee_id: 'att_candidate', attendee_name: 'Camille Martin' },
    },
  };
}

// ─── Lectures ───────────────────────────────────────────────────────────────
type Enr = { status: string; pause_reason: string | null; replied_at: string | null; completed_at: string | null; updated_at: string };
async function enr(id: string): Promise<Enr> {
  const { data, error } = await admin().from('sequence_enrollments')
    .select('status, pause_reason, replied_at, completed_at, updated_at').eq('id', id).single();
  if (error || !data) throw new Error(`enr ${id}: ${error?.message}`);
  return data as Enr;
}
type Exec = { status: string; skip_reason: string | null; scheduled_at: string };
async function exec(id: string): Promise<Exec> {
  const { data, error } = await admin().from('sequence_step_executions')
    .select('status, skip_reason, scheduled_at').eq('id', id).single();
  if (error || !data) throw new Error(`exec ${id}: ${error?.message}`);
  return data as Exec;
}
async function replies(sequenceId: string): Promise<number> {
  const { data } = await admin().from('sequence_analytics').select('replies_received').eq('sequence_id', sequenceId);
  return ((data ?? []) as Array<{ replies_received: number | null }>).reduce((s, r) => s + (r.replies_received ?? 0), 0);
}
async function dedupRows(eventKey: string): Promise<number> {
  const { data } = await admin().from('webhook_event_log').select('event_key').eq('event_key', eventKey);
  return (data ?? []).length;
}
async function notificationsOf(orgId: string) {
  const { data } = await admin().from('notifications').select('id, type, title').eq('organization_id', orgId);
  return (data ?? []) as Array<{ id: string; type: string; title: string }>;
}
async function makeDue(ids: string[]) {
  const { error } = await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).in('id', ids);
  if (error) throw new Error(`makeDue: ${error.message}`);
}

// ─── Seeds ──────────────────────────────────────────────────────────────────
function track(org: TestOrg, ...extra: TestUser[]) {
  orgsToDelete.push({ org, extra });
}
const newProfileId = () => `ACoAAE2ERR${rand()}${rand()}`;

/** Premier message envoyé il y a deux jours, puis relance planifiée (non échue par défaut). */
async function sentThenFollowUp(org: TestOrg, enrollmentId: string, steps: SeededStep[], followUpAt = minutesFromNow(120)) {
  await schedule(org, enrollmentId, steps[0], {
    status: 'sent', scheduled_at: minutesFromNow(-2 * DAY), executed_at: minutesFromNow(-2 * DAY), final_message: 'Bonjour',
  });
  return schedule(org, enrollmentId, steps[1], { scheduled_at: followUpAt });
}

/**
 * Seed S : organisation payante, propriétaire sur A1, membre sur son propre
 * compte A2 ; même candidat P inscrit sur Q1 depuis A1 (E1) et sur Q2 depuis
 * A2 (E2). Aucune exécution n'est insérée ici (à faire en dernier, par le test).
 */
async function seedS(prefix: string, o: { e2?: Record<string, unknown>; q2Steps?: number } = {}) {
  const { org, accountId: a1 } = await sendingOrg(prefix);
  const member = await addMember(org.orgId, 'member', 'rr');
  track(org, member);
  const a2 = await seedLinkedInAccount(org.orgId, member.userId, `acc_rr2_${rand()}`, 'OK');
  const profileId = newProfileId();
  const q1 = await messageSequence(org, org.owner.userId, ['Bonjour A1', 'Relance A1']);
  const q2Templates = ['Bonjour A2', 'Relance A2', 'Suite A2 3', 'Suite A2 4', 'Suite A2 5'].slice(0, o.q2Steps ?? 2);
  const q2 = await messageSequence(org, member.userId, q2Templates);
  const e1 = (await enroll(org, q1.sequenceId, org.owner.userId, a1, { profile_id: profileId, current_step_order: 1 })).enrollmentId;
  const e2 = (await enroll(org, q2.sequenceId, member.userId, a2, { profile_id: profileId, current_step_order: 1, ...(o.e2 ?? {}) })).enrollmentId;
  return { org, member, a1, a2, profileId, q1, q2, e1, e2 };
}

// ════════════════════════════════════════════════════════════════════════════
// Premier passage en échec (arrêt des sœurs), puis rejeu du même événement
// ════════════════════════════════════════════════════════════════════════════
test.describe('Réponse : premier passage en échec puis rejeu', () => {
  test.describe('premier-passage-500-si-soeurs-echouent', () => {
    test.describe.configure({ mode: 'serial' });
    // premier-passage-500-si-soeurs-echouent (SEQ-040, SEQ-212)
    test('arrêt des sœurs en échec : le webhook répond 500 (success:false) pour obtenir un rejeu, E1 reste « replied »', async () => {
      const s = await seedS('E2E RR 500');
      await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      await sentThenFollowUp(s.org, s.e2, s.q2.steps);
      failSiblingStop([s.e2]);

      const w = replyFrom(s.a1, s.profileId);
      const first = await rawWebhook(w.payload);
      expect(first.status, JSON.stringify(first.body)).toBe(500);
      expect(first.body.success).toBe(false);

      const e1 = await enr(s.e1);
      expect(e1.status, 'E1 close par la réponse').toBe('replied');
      expect(e1.replied_at, 'date de réponse posée').not.toBeNull();
      expect((await enr(s.e2)).status, 'E2 intacte (arrêt refusé)').toBe('active');
    });
  });

  test.describe('purge-dedoublonnage-apres-500', () => {
    test.describe.configure({ mode: 'serial' });
    // purge-dedoublonnage-apres-500 (SEQ-040)
    test('après un 500, la clé de dédoublonnage est purgée et le rejeu est traité (pas de deduplicated)', async () => {
      const s = await seedS('E2E RR dédup');
      await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      await sentThenFollowUp(s.org, s.e2, s.q2.steps);
      const restore = failSiblingStop([s.e2]);

      const w = replyFrom(s.a1, s.profileId);
      const first = await rawWebhook(w.payload);
      expect(first.status, JSON.stringify(first.body)).toBe(500);
      expect(await dedupRows(w.eventKey), 'clé purgée après le 500').toBe(0);

      restore();
      const replay = await rawWebhook(w.payload);
      expect(replay.status, JSON.stringify(replay.body)).toBe(200);
      expect(replay.body.deduplicated, 'rejeu traité, pas dédoublonné').toBeUndefined();
      expect(await dedupRows(w.eventKey), 'clé de nouveau enregistrée').toBe(1);
    });
  });

  test.describe('rejeu-arrete-soeur-active', () => {
    test.describe.configure({ mode: 'serial' });
    // rejeu-arrete-soeur-active (SEQ-212, SEQ-040)
    test('@critical au rejeu, l’inscription sœur active du candidat sur l’autre compte de l’organisation est arrêtée', async () => {
      const s = await seedS('E2E RR soeur active');
      await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      await sentThenFollowUp(s.org, s.e2, s.q2.steps);
      const restore = failSiblingStop([s.e2]);

      const w = replyFrom(s.a1, s.profileId);
      const first = await rawWebhook(w.payload);
      expect(first.status, JSON.stringify(first.body)).toBe(500);

      restore();
      const replay = await rawWebhook(w.payload);
      expect(replay.status, JSON.stringify(replay.body)).toBe(200);

      const e2 = await enr(s.e2);
      // DÉFAUT rejeu-soeur-active-non-arretee : au rejeu, E1 déjà « replied » n'est plus retrouvée (recherche active/paused), l'arrêt des sœurs n'est jamais appelé.
      expect(e2.status, `E2 après rejeu : ${JSON.stringify(e2)}`).toBe('stopped');
      expect(e2.pause_reason).toBeNull();
      expect(e2.completed_at).not.toBeNull();
    });
  });

  test.describe('rejeu-aucun-envoi-depuis-compte-soeur', () => {
    test.describe.configure({ mode: 'serial' });
    // rejeu-aucun-envoi-depuis-compte-soeur (SEQ-212)
    test('@critical après le premier passage en échec puis le rejeu, aucun message ne part du compte LinkedIn de la sœur', async () => {
      const s = await seedS('E2E RR aucun envoi');
      await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      const followUp2 = await sentThenFollowUp(s.org, s.e2, s.q2.steps);
      const restore = failSiblingStop([s.e2]);

      const w = replyFrom(s.a1, s.profileId);
      expect((await rawWebhook(w.payload)).status).toBe(500);
      restore();
      expect((await rawWebhook(w.payload)).status).toBe(200);

      // La relance de la sœur arrive à échéance.
      await makeDue([followUp2]);
      await runCycle();

      const sent = await sentTexts(s.a2);
      const relance = await exec(followUp2);
      // DÉFAUT rejeu-relance-soeur-envoyee : E2 restée active après le rejeu, la vérification avant envoi interroge la conversation de A2 (réponse reçue sur A1) et la relance part.
      expect(sent, `envois depuis A2 ; relance de E2 : ${JSON.stringify(relance)}`).toEqual([]);
      expect(relance.status).toBe('cancelled');
    });
  });

  test.describe('rejeu-ne-touche-pas-autre-organisation', () => {
    test.describe.configure({ mode: 'serial' });
    // rejeu-ne-touche-pas-autre-organisation (SEQ-212, SEQ-006)
    test('@critical ni le premier passage ni le rejeu n’arrêtent l’inscription du même candidat dans une autre organisation', async () => {
      const s = await seedS('E2E RR autre org A');
      const { org: other, accountId: b1 } = await sendingOrg('E2E RR autre org B');
      track(other);
      const qb = await messageSequence(other, other.owner.userId, ['Bonjour B', 'Relance B']);
      const eb = (await enroll(other, qb.sequenceId, other.owner.userId, b1, { profile_id: s.profileId, current_step_order: 1 })).enrollmentId;
      await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      await sentThenFollowUp(s.org, s.e2, s.q2.steps);
      const followUpB = await sentThenFollowUp(other, eb, qb.steps);
      const before = await enr(eb);
      const restore = failSiblingStop([s.e2]);

      const w = replyFrom(s.a1, s.profileId);
      expect((await rawWebhook(w.payload)).status).toBe(500);
      restore();
      expect((await rawWebhook(w.payload)).status).toBe(200);

      const after = await enr(eb);
      expect(after.status, 'inscription de l’autre organisation toujours active').toBe('active');
      expect(after.updated_at, 'aucune écriture sur l’inscription de l’autre organisation').toBe(before.updated_at);
      expect((await exec(followUpB)).status, 'sa relance reste planifiée').toBe('scheduled');
      expect(await notificationsOf(other.orgId), 'aucune notification pour l’autre organisation').toEqual([]);
      expect(await replies(qb.sequenceId)).toBe(0);
    });
  });

  test.describe('rejeu-annule-etapes-pendantes-soeur', () => {
    test.describe.configure({ mode: 'serial' });
    // rejeu-annule-etapes-pendantes-soeur (SEQ-212, SEQ-071)
    test('au rejeu, les exécutions en attente de la sœur (scheduled, waiting_event, quota_blocked) sont annulées avec le motif « autre compte », jamais celle en « sending »', async () => {
      const s = await seedS('E2E RR étapes soeur', { q2Steps: 5 });
      await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      const later = minutesFromNow(DAY);
      const [sent0, scheduled, waiting, blocked, sending] = s.q2.steps;
      await schedule(s.org, s.e2, sent0, { status: 'sent', scheduled_at: minutesFromNow(-2 * DAY), executed_at: minutesFromNow(-2 * DAY) });
      const pending = {
        scheduled: await schedule(s.org, s.e2, scheduled, { scheduled_at: later }),
        waiting_event: await schedule(s.org, s.e2, waiting, { status: 'waiting_event', scheduled_at: later }),
        quota_blocked: await schedule(s.org, s.e2, blocked, { status: 'quota_blocked', scheduled_at: later }),
      };
      const inFlight = await schedule(s.org, s.e2, sending, { status: 'sending', scheduled_at: minutesFromNow(-1) });
      const restore = failSiblingStop([s.e2]);

      const w = replyFrom(s.a1, s.profileId);
      expect((await rawWebhook(w.payload)).status).toBe(500);
      restore();
      expect((await rawWebhook(w.payload)).status).toBe(200);

      const observed: Record<string, Exec> = {};
      for (const [label, id] of Object.entries(pending)) observed[label] = await exec(id);
      const flying = await exec(inFlight);
      expect(flying.status, 'un envoi en cours n’est jamais annulé').toBe('sending');
      for (const [label, e] of Object.entries(observed)) {
        // DÉFAUT rejeu-etapes-soeur-non-annulees : la sœur n'est pas retrouvée au rejeu, ses étapes en attente restent vivantes.
        expect.soft(e.status, `${label} : ${JSON.stringify(e)}`).toBe('cancelled');
        expect.soft(e.skip_reason, label).toBe(SIBLING_REPLY_SKIP_REASON);
      }
    });
  });

  test.describe('rejeu-arrete-soeur-en-pause', () => {
    test.describe.configure({ mode: 'serial' });
    // rejeu-arrete-soeur-en-pause (SEQ-012, SEQ-212)
    test('une sœur en pause (manual) est aussi arrêtée au rejeu : « stopped », raison de pause effacée, « Reprendre » ne la relance plus', async () => {
      const s = await seedS('E2E RR soeur pause', { e2: { status: 'paused', pause_reason: 'manual' } });
      await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      await sentThenFollowUp(s.org, s.e2, s.q2.steps);
      const restore = failSiblingStop([s.e2]);

      const w = replyFrom(s.a1, s.profileId);
      expect((await rawWebhook(w.payload)).status).toBe(500);
      restore();
      expect((await rawWebhook(w.payload)).status).toBe(200);

      const afterReplay = await enr(s.e2);
      // DÉFAUT rejeu-soeur-pause-non-arretee : même cause que la sœur active ; la sœur reste en pause 'manual' et redevient reprenable.
      expect.soft(afterReplay.status, `E2 après rejeu : ${JSON.stringify(afterReplay)}`).toBe('stopped');
      expect.soft(afterReplay.pause_reason).toBeNull();

      const memberToken = (await signIn(s.member.email, s.member.password)).access_token;
      const res = await callFunction('process-sequences', memberToken, {
        action: 'resume_enrollments', organization_id: s.org.orgId, enrollment_ids: [s.e2],
      });
      const afterResume = await enr(s.e2);
      expect(afterResume.status, `« Reprendre » après la réponse : ${JSON.stringify(res.body)}`).toBe('stopped');
    });
  });

  test.describe('rejeu-arrete-soeur-collaborateur', () => {
    test.describe.configure({ mode: 'serial' });
    // rejeu-arrete-soeur-collaborateur (SEQ-212)
    test('la sœur inscrite par un collaborateur depuis son propre compte est arrêtée au rejeu comme celle d’un membre', async () => {
      const s = await seedS('E2E RR collaborateur');
      const collaborator = await addMember(s.org.orgId, 'collaborator', 'rrcollab');
      orgsToDelete.find((o) => o.org.orgId === s.org.orgId)?.extra.push(collaborator);
      const a3 = await seedLinkedInAccount(s.org.orgId, collaborator.userId, `acc_rr3_${rand()}`, 'OK');
      const q3 = await messageSequence(s.org, collaborator.userId, ['Bonjour A3', 'Relance A3']);
      const e3 = (await enroll(s.org, q3.sequenceId, collaborator.userId, a3, { profile_id: s.profileId, current_step_order: 1 })).enrollmentId;
      await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      const followUp2 = await sentThenFollowUp(s.org, s.e2, s.q2.steps);
      const followUp3 = await sentThenFollowUp(s.org, e3, q3.steps);
      const restore = failSiblingStop([s.e2, e3]);

      const w = replyFrom(s.a1, s.profileId);
      expect((await rawWebhook(w.payload)).status).toBe(500);
      restore();
      expect((await rawWebhook(w.payload)).status).toBe(200);

      for (const [label, id, followUp] of [['membre (E2)', s.e2, followUp2], ['collaborateur (E3)', e3, followUp3]] as const) {
        const row = await enr(id);
        const f = await exec(followUp);
        // DÉFAUT rejeu-soeur-collaborateur-non-arretee : même cause, aucune sœur n'est recherchée au rejeu.
        expect.soft(row.status, `${label} : ${JSON.stringify(row)}`).toBe('stopped');
        expect.soft(f.status, `${label}, relance : ${JSON.stringify(f)}`).toBe('cancelled');
      }
    });
  });

  test.describe('rejeu-ne-recompte-pas-la-reponse', () => {
    test.describe.configure({ mode: 'serial' });
    // rejeu-ne-recompte-pas-la-reponse (SEQ-191)
    test('après le premier passage en échec puis le rejeu, la réponse compte exactement 1 sur la séquence de E1 et 0 sur celle de la sœur', async () => {
      const s = await seedS('E2E RR compteur');
      await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      await sentThenFollowUp(s.org, s.e2, s.q2.steps);
      const restore = failSiblingStop([s.e2]);

      const w = replyFrom(s.a1, s.profileId);
      expect((await rawWebhook(w.payload)).status).toBe(500);
      restore();
      expect((await rawWebhook(w.payload)).status).toBe(200);

      expect(await replies(s.q1.sequenceId), 'réponse comptée une fois sur Q1').toBe(1);
      expect(await replies(s.q2.sequenceId), 'rien sur la séquence de la sœur').toBe(0);
    });
  });

  test.describe('soeur-stoppee-etapes-non-annulees-filet-moteur', () => {
    test.describe.configure({ mode: 'serial' });
    // soeur-stoppee-etapes-non-annulees-filet-moteur (SEQ-212, SEQ-071, SEQ-027)
    test('sœur passée « stopped » mais étapes non annulées : aucune ne part, le moteur les annule (scheduled et quota_blocked au cycle, waiting_event au contrôle des délais)', async () => {
      const s = await seedS('E2E RR filet moteur', { q2Steps: 4 });
      await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      const later = minutesFromNow(DAY);
      const [sent0, scheduled, waiting, blocked] = s.q2.steps;
      await schedule(s.org, s.e2, sent0, { status: 'sent', scheduled_at: minutesFromNow(-2 * DAY), executed_at: minutesFromNow(-2 * DAY) });
      const execScheduled = await schedule(s.org, s.e2, scheduled, { scheduled_at: later });
      const execWaiting = await schedule(s.org, s.e2, waiting, { status: 'waiting_event', scheduled_at: later });
      const execBlocked = await schedule(s.org, s.e2, blocked, { status: 'quota_blocked', scheduled_at: later });
      const restore = failSiblingCancel(s.org.orgId);

      const w = replyFrom(s.a1, s.profileId);
      const first = await rawWebhook(w.payload);
      expect(first.status, JSON.stringify(first.body)).toBe(500);
      expect((await enr(s.e2)).status, 'E2 arrêtée au premier passage').toBe('stopped');
      for (const id of [execScheduled, execWaiting, execBlocked]) {
        expect(['scheduled', 'waiting_event', 'quota_blocked'], 'étapes encore en attente').toContain((await exec(id)).status);
      }

      restore();
      expect((await rawWebhook(w.payload)).status).toBe(200);

      await makeDue([execScheduled, execBlocked]);
      await runCycle();
      await runEngine({ action: 'check_timeouts' });

      expect(await sentTexts(s.a2), 'aucun envoi depuis le compte de la sœur').toEqual([]);
      const sch = await exec(execScheduled);
      expect(sch.status, JSON.stringify(sch)).toBe('cancelled');
      expect(sch.skip_reason).toBe(closedBeforeSend('stopped'));
      const blk = await exec(execBlocked);
      expect(blk.status, JSON.stringify(blk)).toBe('cancelled');
      expect(blk.skip_reason).toBe(closedBeforeSend('stopped'));
      const wt = await exec(execWaiting);
      expect(wt.status, JSON.stringify(wt)).toBe('cancelled');
      expect(wt.skip_reason).toBe(closedWaitReason('stopped'));
    });
  });

  test.describe('echec-purge-dedoublonnage-detecte', () => {
    test.describe.configure({ mode: 'serial' });
    // echec-purge-dedoublonnage-detecte (SEQ-040, SEQ-212)
    test('purge de la clé de dédoublonnage en échec : l’échec est journalisé et le rejeu n’avale pas l’événement (la sœur finit arrêtée)', async () => {
      const s = await seedS('E2E RR purge');
      await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      await sentThenFollowUp(s.org, s.e2, s.q2.steps);
      const w = replyFrom(s.a1, s.profileId);
      const restoreStop = failSiblingStop([s.e2]);
      failDedupPurge(w.eventKey);

      const offset = logSize();
      const first = await rawWebhook(w.payload);
      expect(first.status, JSON.stringify(first.body)).toBe(500);
      expect(await dedupRows(w.eventKey), 'la clé est restée (purge refusée)').toBe(1);
      let log = '';
      for (let i = 0; i < 10 && !log.includes('Dedup cleanup failed'); i++) {
        await new Promise((r) => setTimeout(r, 300));
        log = logSince(offset);
      }

      restoreStop();
      const replay = await rawWebhook(w.payload);
      const e2 = await enr(s.e2);
      // DÉFAUT echec-purge-dedup-silencieux : le .delete() renvoie { error } sans lever, le catch ne voit rien ; le rejeu répond deduplicated:true et la sœur reste active.
      expect.soft(log.includes('[unipile-webhook] Dedup cleanup failed'), 'échec de la purge journalisé').toBe(true);
      expect(e2.status, `rejeu ${replay.status} ${JSON.stringify(replay.body)} ; E2 : ${JSON.stringify(e2)}`).toBe('stopped');
    });
  });

  test.describe('echec-persistant-soeurs-non-masque', () => {
    test.describe.configure({ mode: 'serial' });
    // echec-persistant-soeurs-non-masque (SEQ-040, SEQ-212)
    test('tant que la sœur n’est pas arrêtée, un rejeu ne répond pas 200 en silence (500 maintenu, ou alerte au recruteur)', async () => {
      const s = await seedS('E2E RR échec persistant');
      await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      await sentThenFollowUp(s.org, s.e2, s.q2.steps);
      failSiblingStop([s.e2]); // panne laissée en place pendant le rejeu

      const w = replyFrom(s.a1, s.profileId);
      expect((await rawWebhook(w.payload)).status).toBe(500);
      const replay = await rawWebhook(w.payload);

      const e2 = await enr(s.e2);
      expect(e2.status, 'panne toujours active : E2 n’a pas pu être arrêtée').toBe('active');
      const alerts = (await notificationsOf(s.org.orgId)).filter((n) => n.type !== 'new_message');
      // DÉFAUT echec-persistant-soeurs-masque : au rejeu E1 est introuvable, l'étape des sœurs est sautée et le webhook répond 200 success sans alerte.
      expect(
        replay.status === 500 || alerts.length > 0,
        `rejeu : ${replay.status} ${JSON.stringify(replay.body)} ; alertes : ${JSON.stringify(alerts)}`,
      ).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Annulation des étapes de E1 en échec au premier passage
// ════════════════════════════════════════════════════════════════════════════
test.describe('Réponse : annulation des étapes de E1 en échec puis rejeu', () => {
  /** Seed à une seule inscription E1 (A1, Q1) avec relance planifiée, panne F2 posée. */
  async function seedE1(prefix: string) {
    const { org, accountId: a1 } = await sendingOrg(prefix);
    track(org);
    const profileId = newProfileId();
    const q1 = await messageSequence(org, org.owner.userId, ['Bonjour A1', 'Relance A1']);
    const e1 = (await enroll(org, q1.sequenceId, org.owner.userId, a1, { profile_id: profileId, current_step_order: 1 })).enrollmentId;
    return { org, a1, profileId, q1, e1 };
  }

  test.describe('e1-etapes-pendantes-jamais-envoyees', () => {
    test.describe.configure({ mode: 'serial' });
    // e1-etapes-pendantes-jamais-envoyees (SEQ-027, SEQ-189)
    test('@critical les étapes restées en attente sur E1 close (annulation échouée) ne partent jamais : le moteur les annule sans envoi', async () => {
      const s = await seedE1('E2E RR E1 pendante');
      const followUp = await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      const restore = failReplyCancel(s.e1);

      const w = replyFrom(s.a1, s.profileId);
      const first = await rawWebhook(w.payload);
      expect(first.status, JSON.stringify(first.body)).toBe(500);
      expect((await enr(s.e1)).status).toBe('replied');
      expect((await exec(followUp)).status, 'relance restée planifiée (annulation refusée)').toBe('scheduled');
      restore();
      expect((await rawWebhook(w.payload)).status).toBe(200);

      await makeDue([followUp]);
      await runCycle();

      expect(await sentTexts(s.a1), 'aucun envoi après la réponse').toEqual([]);
      const f = await exec(followUp);
      expect(f.status, JSON.stringify(f)).toBe('cancelled');
      expect(f.skip_reason).toBe(closedBeforeSend('replied'));
    });
  });

  test.describe('e1-etapes-pendantes-jamais-envoyees, séquence désactivée', () => {
    test.describe.configure({ mode: 'serial' });
    // e1-etapes-pendantes-jamais-envoyees, variante séquence désactivée (D1)
    test('@critical étape en attente d’une inscription « replied » dans une séquence désactivée : jamais envoyée, puis annulée à la réactivation', async () => {
      const s = await seedE1('E2E RR E1 désactivée');
      await admin().from('sequence_enrollments').update({ status: 'replied', replied_at: minutesFromNow(-1) }).eq('id', s.e1);
      await admin().from('outreach_sequences').update({ is_active: false }).eq('id', s.q1.sequenceId);
      const followUp = await sentThenFollowUp(s.org, s.e1, s.q1.steps, minutesFromNow(-1));

      await runCycle();
      expect(await sentTexts(s.a1), 'séquence désactivée : rien ne part').toEqual([]);
      expect(['scheduled', 'cancelled']).toContain((await exec(followUp)).status);

      await admin().from('outreach_sequences').update({ is_active: true }).eq('id', s.q1.sequenceId);
      await runCycle();
      expect(await sentTexts(s.a1), 'réactivée : toujours rien, le candidat a répondu').toEqual([]);
      const f = await exec(followUp);
      expect(f.status, JSON.stringify(f)).toBe('cancelled');
      expect(f.skip_reason).toBe(closedBeforeSend('replied'));
    });
  });

  test.describe('rejeu-compte-reponse-apres-echec-annulation', () => {
    test.describe.configure({ mode: 'serial' });
    // rejeu-compte-reponse-apres-echec-annulation (SEQ-191, SEQ-040)
    test('annulation des étapes de E1 en échec au premier passage : la réponse est comptée une fois à l’issue du rejeu', async () => {
      const s = await seedE1('E2E RR E1 compteur');
      await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      const restore = failReplyCancel(s.e1);

      const w = replyFrom(s.a1, s.profileId);
      expect((await rawWebhook(w.payload)).status).toBe(500);
      restore();
      expect((await rawWebhook(w.payload)).status).toBe(200);

      // DÉFAUT rejeu-reponse-jamais-comptee : le continue de l'échec d'annulation saute l'incrément, et le rejeu ne retrouve plus E1 (déjà « replied »).
      expect(await replies(s.q1.sequenceId), 'replies_received de Q1 après rejeu').toBe(1);
    });
  });

  test.describe('rejeu-pipeline-repondu-apres-echec-annulation', () => {
    test.describe.configure({ mode: 'serial' });
    // rejeu-pipeline-repondu-apres-echec-annulation (SEQ-006, SEQ-040)
    test('annulation des étapes de E1 en échec au premier passage : le candidat passe quand même « Répondu » dans le pipeline de son organisation après le rejeu', async () => {
      const s = await seedE1('E2E RR E1 pipeline');
      const { data: jcsRow, error } = await admin().from('job_candidate_status').insert({
        job_id: `job_rr_${rand()}`, candidate_id: s.profileId, created_by: s.org.owner.userId, organization_id: s.org.orgId,
        candidate_name: 'Camille Martin', status: 'contacted', pipeline_stage: 'Contacté',
      }).select('id').single();
      if (error || !jcsRow) throw new Error(`jcs: ${error?.message}`);
      await sentThenFollowUp(s.org, s.e1, s.q1.steps);
      const restore = failReplyCancel(s.e1);

      const w = replyFrom(s.a1, s.profileId);
      expect((await rawWebhook(w.payload)).status).toBe(500);
      restore();
      expect((await rawWebhook(w.payload)).status).toBe(200);

      const { data: row } = await admin().from('job_candidate_status').select('status, pipeline_stage').eq('id', jcsRow.id).single();
      // DÉFAUT rejeu-pipeline-jamais-repondu : le continue précède markCandidateRepliedInPipeline, et E1 est introuvable au rejeu.
      expect(row, 'pipeline après rejeu').toEqual({ status: 'replied', pipeline_stage: 'Répondu' });
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E1 déjà close par le moteur, webhook de la même réponse
// ════════════════════════════════════════════════════════════════════════════
test.describe('Réponse : E1 déjà close par le moteur', () => {
  test.describe('moteur-a-clos-e1-webhook-arrete-soeurs', () => {
    test.describe.configure({ mode: 'serial' });
    // moteur-a-clos-e1-webhook-arrete-soeurs (SEQ-212, SEQ-191)
    test('le moteur a déjà clos E1 sans arrêter les sœurs : le webhook de la même réponse les arrête', async () => {
      const s = await seedS('E2E RR moteur a clos');
      await admin().from('sequence_enrollments').update({ status: 'replied', replied_at: new Date().toISOString() }).eq('id', s.e1);
      await schedule(s.org, s.e1, s.q1.steps[0], {
        status: 'sent', scheduled_at: minutesFromNow(-2 * DAY), executed_at: minutesFromNow(-2 * DAY),
      });
      const followUp2 = await sentThenFollowUp(s.org, s.e2, s.q2.steps);

      const w = replyFrom(s.a1, s.profileId);
      const res = await rawWebhook(w.payload);
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const e2 = await enr(s.e2);
      const f = await exec(followUp2);
      // DÉFAUT moteur-clos-e1-soeurs-jamais-arretees : le webhook ne cherche que les inscriptions active/paused du compte qui reçoit ; E1 close, aucune sœur n'est arrêtée.
      expect.soft(e2.status, `E2 : ${JSON.stringify(e2)}`).toBe('stopped');
      expect.soft(f.status, `relance de E2 : ${JSON.stringify(f)}`).toBe('cancelled');
      expect.soft(f.skip_reason).toBe(SIBLING_REPLY_SKIP_REASON);
      expect(await replies(s.q1.sequenceId), 'la réponse déjà comptée par le moteur n’est pas recomptée').toBe(0);
    });
  });
});

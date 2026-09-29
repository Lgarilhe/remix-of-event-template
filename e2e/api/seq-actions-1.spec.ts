/**
 * Lot « actions-1 » du module séquences : actions membres de process-sequences
 * (reprise, relance, « Marquer comme répondu », saut d'étape, actions du jour),
 * arrêt des envois à la dissociation d'un compte LinkedIn, contrôle du compte
 * d'envoi par le moteur et outil pause_sequence de l'assistant.
 *
 * Contrat : CLAUDE.md, section « Séquences : règles du moteur et de
 * l'interface », et docs/audit-2026-09-25-sequences.md (D1 à D6, registre).
 *
 * Le moteur process-sequences tourne pour de vrai contre la stack locale
 * (e2e/local-stack) ; LinkedIn est simulé par vendor-mock.mjs, qui journalise
 * chaque appel au lieu de l'envoyer. Ignoré sans cette stack.
 *
 * D'autres suites font tourner des cycles sur la même base en même temps :
 * toute exécution échue est insérée en dernier, ou sur une inscription qui
 * n'est pas active (le moteur ne la prend pas).
 */
import { test, expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  createConfirmedUser,
  createOrg,
  deleteOrg,
  seedCandidateRow,
  seedLinkedInAccount,
  seedMission,
  seedSequence,
  signIn,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  CRON_SECRET,
  ENGINE_SKIP_REASON,
  engineAvailable,
  enroll,
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
  setPaidPlan,
  webhook,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(240_000);

// ─── Textes du contrat (process-sequences, _shared/sequence-resume.ts) ──────
const COLLABORATOR_RESUME_MESSAGE = 'Vous ne pouvez reprendre que les candidats que vous avez inscrits.';
const COLLABORATOR_RE_ENROLL_MESSAGE = 'Vous ne pouvez relancer que les candidats que vous avez inscrits.';
const COLLABORATOR_ACTION_MESSAGE = 'Vous ne pouvez agir que sur les candidats que vous avez inscrits.';
const NOT_FOUND_MESSAGE = 'Inscription introuvable dans votre organisation.';
const SEQUENCE_INACTIVE_MESSAGE = 'La séquence est désactivée : réactivez-la pour reprendre ce candidat.';
const GDPR_MESSAGE = "Ce candidat a demandé l'effacement de ses données : il ne peut plus être relancé.";
const ACCOUNT_NOT_IN_ORG_REASON = "Compte d'envoi non rattaché à l'organisation";
const ACCOUNT_DISCONNECTED_SKIP_REASON = 'Compte LinkedIn déconnecté, reprise automatique à la reconnexion';
const GDPR_ERASURE_SKIP_REASON = 'Effacement des données demandé : séquence arrêtée';
const SIBLING_REPLY_SKIP_REASON = "Le candidat a répondu sur un autre compte de l'organisation";

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];
test.afterEach(async () => {
  while (cleanups.length) await Promise.resolve(cleanups.pop()!()).catch(() => undefined);
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    await deleteOrg(org, extra);
  }
});
function track(org: TestOrg, ...extra: TestUser[]) {
  orgsToDelete.push({ org, extra });
  return org;
}

// ─── Aides ──────────────────────────────────────────────────────────────────
type Json = Record<string, unknown>;
type Result = { enrollment_id: string; outcome: string; message?: string };

async function tokenOf(user: TestUser): Promise<string> {
  return (await signIn(user.email, user.password)).access_token;
}

/** Action membre de process-sequences avec un JWT. */
function engine(token: string, body: Json) {
  return postJson('/functions/v1/process-sequences', body, { Authorization: `Bearer ${token}` });
}

function resultOf(body: Json, enrollmentId: string): Result | undefined {
  return (body.results as Result[] | undefined)?.find((r) => r.enrollment_id === enrollmentId);
}

async function execRow(id: string) {
  const { data } = await admin()
    .from('sequence_step_executions')
    .select('id, status, step_order, step_id, scheduled_at, skip_reason, updated_at')
    .eq('id', id)
    .single();
  return data as { id: string; status: string; step_order: number; step_id: string; scheduled_at: string; skip_reason: string | null; updated_at: string };
}

async function enrRow(id: string) {
  const { data } = await admin()
    .from('sequence_enrollments')
    .select('status, pause_reason, current_step_order, replied_at, completed_at, updated_at, tracking_data')
    .eq('id', id)
    .single();
  return data as {
    status: string; pause_reason: string | null; current_step_order: number; replied_at: string | null;
    completed_at: string | null; updated_at: string; tracking_data: Json | null;
  };
}

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

/** Millisecondes avant minuit à Paris (nudge_sequences n'avance que la journée en cours). */
function msUntilParisMidnight(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + now.getMilliseconds();
  return 24 * 3600 * 1000 - elapsed;
}

/** Plus tard aujourd'hui à Paris (au plus dans 30 min), ou null trop près de minuit. */
function laterTodayIso(): string | null {
  const untilMidnight = msUntilParisMidnight();
  if (untilMidnight < 10 * 60_000) return null;
  return new Date(Date.now() + Math.min(30 * 60_000, untilMidnight / 2)).toISOString();
}

async function mappingIdOf(accountId: string): Promise<string> {
  const { data } = await admin().from('member_linkedin_accounts').select('id').eq('linkedin_account_id', accountId).single();
  return data!.id as string;
}

// ════════════════════════════════════════════════════════════════════════════
// Reprise : réarmement d'une étape annulée par une pause (SEQ-003, SEQ-004)
// ════════════════════════════════════════════════════════════════════════════
test.describe('@critical Reprise : réarmement d’une étape annulée par une pause', () => {
  test.describe.configure({ mode: 'serial' });

  // resume-rearme-annulation-pause
  test('@critical sans étape en attente, « Reprendre » réarme l’étape annulée par la dissociation et le cycle suivant l’envoie une seule fois', async () => {
    const { org, accountId } = await sendingOrg('E2E A1 Réarme');
    track(org);
    const token = await tokenOf(org.owner);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, {
      status: 'paused', pause_reason: 'manual', current_step_order: 1,
    });
    const sent = await schedule(org, enrollmentId, steps[0], {
      status: 'sent', scheduled_at: minutesFromNow(-2 * 24 * 60), executed_at: minutesFromNow(-2 * 24 * 60),
      created_at: minutesFromNow(-2 * 24 * 60), final_message: 'Bonjour',
    });
    const cancelled = await schedule(org, enrollmentId, steps[1], {
      status: 'cancelled', skip_reason: 'Compte LinkedIn dissocié', scheduled_at: minutesFromNow(-60),
      created_at: minutesFromNow(-24 * 60),
    });

    // Même règle pour une étape annulée par « Arrêt manuel » (autre candidat).
    const manual = await enroll(org, sequenceId, org.owner.userId, accountId, {
      status: 'paused', pause_reason: 'manual', current_step_order: 1,
    });
    await schedule(org, manual.enrollmentId, steps[0], {
      status: 'sent', scheduled_at: minutesFromNow(-2 * 24 * 60), executed_at: minutesFromNow(-2 * 24 * 60),
      created_at: minutesFromNow(-2 * 24 * 60),
    });
    const manualCancelled = await schedule(org, manual.enrollmentId, steps[1], {
      status: 'cancelled', skip_reason: 'Arrêt manuel', scheduled_at: minutesFromNow(-60), created_at: minutesFromNow(-24 * 60),
    });

    const res = await engine(token, {
      action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [enrollmentId, manual.enrollmentId],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(resultOf(res.body, enrollmentId)?.outcome).toBe('resumed');
    expect(resultOf(res.body, manual.enrollmentId)?.outcome).toBe('resumed');
    expect((await execRow(manualCancelled)).status, '« Arrêt manuel » réarmé aussi').toBe('scheduled');

    const rearmed = await execRow(cancelled);
    expect(rearmed.status, 'étape annulée par la pause réarmée').toBe('scheduled');
    expect(rearmed.skip_reason).toBeNull();
    // max(date prévue, maintenant + 1 min) : la date d'origine est passée.
    expect(ms(rearmed.scheduled_at)).toBeGreaterThan(Date.now());
    expect(ms(rearmed.scheduled_at)).toBeLessThan(Date.now() + 3 * 60_000);
    expect((await execRow(sent)).status, 'l’étape déjà partie n’est jamais réarmée').toBe('sent');
    const execs = await executionsOf(enrollmentId);
    expect(execs, 'aucune nouvelle exécution créée').toHaveLength(2);
    const enr = await enrRow(enrollmentId);
    expect(enr.status).toBe('active');
    expect(enr.pause_reason).toBeNull();

    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) })
      .in('id', [cancelled, manualCancelled]).eq('status', 'scheduled');
    await runCycle();
    await runCycle();
    expect(await sentTexts(accountId), 'une relance par candidat, une seule fois, jamais le premier message').toEqual(['Relance', 'Relance']);
    for (const id of [cancelled, manualCancelled]) expect((await execRow(id)).status).toBe('sent');
  });

  // resume-rearme-annulation-pause (variante : message livré pendant la pause)
  test('@critical une étape « annulée » dont le message était parti (BUG-095) n’est pas réarmée : la reprise planifie l’étape suivante', async () => {
    const { org, accountId } = await sendingOrg('E2E A1 Livré');
    track(org);
    const token = await tokenOf(org.owner);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance', 'Dernière'], 0);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, {
      status: 'paused', pause_reason: 'manual', current_step_order: 1,
    });
    await schedule(org, enrollmentId, steps[0], {
      status: 'sent', scheduled_at: minutesFromNow(-3 * 24 * 60), executed_at: minutesFromNow(-3 * 24 * 60),
      created_at: minutesFromNow(-3 * 24 * 60),
    });
    const delivered = await schedule(org, enrollmentId, steps[1], {
      status: 'cancelled', skip_reason: 'Enrollment became paused during execution', scheduled_at: minutesFromNow(-24 * 60),
      created_at: minutesFromNow(-24 * 60),
    });

    const res = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [enrollmentId] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(resultOf(res.body, enrollmentId)?.outcome).toBe('resumed');

    expect((await execRow(delivered)).status, 'le message livré n’est pas réarmé').toBe('cancelled');
    const next = (await executionsOf(enrollmentId)).filter((e) => e.status === 'scheduled');
    expect(next, 'l’étape suivante est planifiée').toHaveLength(1);
    expect(next[0].step_order).toBe(2);

    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', next[0].id).eq('status', 'scheduled');
    await runCycle();
    expect(await sentTexts(accountId), 'seule l’étape suivante part').toEqual(['Dernière']);
  });

  // resume-rearme-annulation-pause (variante : « Arrêt manuel » sur une étape déjà partie)
  test('@critical une étape annulée par « Arrêt manuel » mais déjà partie une autre fois n’est jamais réarmée', async () => {
    const { org, accountId } = await sendingOrg('E2E A1 Déjà partie');
    track(org);
    const token = await tokenOf(org.owner);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance', 'Dernière'], 0);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, {
      status: 'paused', pause_reason: 'manual', current_step_order: 2,
    });
    const days = (d: number) => minutesFromNow(-d * 24 * 60);
    await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: days(3), executed_at: days(3), created_at: days(3) });
    const sentRelance = await schedule(org, enrollmentId, steps[1], { status: 'sent', scheduled_at: days(2), executed_at: days(2), created_at: days(2) });
    // Ligne annulée plus récente sur la même étape (reprise antérieure, doublon).
    const staleCancel = await schedule(org, enrollmentId, steps[1], {
      status: 'cancelled', skip_reason: 'Arrêt manuel', scheduled_at: days(1), created_at: days(1),
    });

    const res = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [enrollmentId] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(resultOf(res.body, enrollmentId)?.outcome).toBe('resumed');
    expect((await execRow(staleCancel)).status, 'étape déjà partie : jamais réarmée').toBe('cancelled');
    expect((await execRow(sentRelance)).status).toBe('sent');
    const next = (await executionsOf(enrollmentId)).filter((e) => e.status === 'scheduled');
    expect(next).toHaveLength(1);
    expect(next[0].step_order, 'la reprise repart après l’étape partie').toBe(2);

    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', next[0].id).eq('status', 'scheduled');
    await runCycle();
    expect(await sentTexts(accountId), 'la relance déjà reçue ne repart pas').toEqual(['Dernière']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Collaborateur : reprise et relance par identifiants (D3, SEQ-119)
// ════════════════════════════════════════════════════════════════════════════
test.describe('@critical Reprise par identifiants et rôle collaborateur (D3)', () => {
  test.describe.configure({ mode: 'serial' });

  // resume-collaborateur-par-ids
  test('@critical un collaborateur ne reprend ou ne relance que ses candidats ; un membre reprend ceux de tous', async () => {
    const { org, accountId: ownerAcc } = await sendingOrg('E2E A1 Collab');
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    const member = await addMember(org.orgId, 'member', 'membre');
    track(org, collab, member);
    const collabAcc = await seedLinkedInAccount(org.orgId, collab.userId, `acc_${rand()}`, 'OK');
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const e1 = await enroll(org, sequenceId, org.owner.userId, ownerAcc, { status: 'paused', pause_reason: 'manual' });
    const e2 = await enroll(org, sequenceId, collab.userId, collabAcc, { status: 'paused', pause_reason: 'manual' });
    const e3 = await enroll(org, sequenceId, org.owner.userId, ownerAcc, {
      status: 'replied', replied_at: minutesFromNow(-60), current_step_order: 1,
    });
    await schedule(org, e1.enrollmentId, steps[0], { scheduled_at: minutesFromNow(24 * 60) });
    await schedule(org, e2.enrollmentId, steps[0], { scheduled_at: minutesFromNow(24 * 60) });
    await schedule(org, e3.enrollmentId, steps[0], {
      status: 'sent', scheduled_at: minutesFromNow(-2 * 24 * 60), executed_at: minutesFromNow(-2 * 24 * 60),
    });

    const collabToken = await tokenOf(collab);
    const res = await engine(collabToken, {
      action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [e1.enrollmentId, e2.enrollmentId],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(resultOf(res.body, e1.enrollmentId)).toEqual(expect.objectContaining({ outcome: 'error', message: COLLABORATOR_RESUME_MESSAGE }));
    expect(resultOf(res.body, e2.enrollmentId)?.outcome).toBe('resumed');
    expect(res.body.counts).toEqual(expect.objectContaining({ resumed: 1, error: 1 }));
    expect((await enrRow(e1.enrollmentId)).status, 'candidat du propriétaire resté en pause').toBe('paused');
    expect((await enrRow(e2.enrollmentId)).status).toBe('active');

    const reEnroll = await engine(collabToken, { action: 're_enroll', organization_id: org.orgId, enrollment_ids: [e3.enrollmentId] });
    expect(reEnroll.status, JSON.stringify(reEnroll.body)).toBe(200);
    expect(resultOf(reEnroll.body, e3.enrollmentId)).toEqual(expect.objectContaining({ outcome: 'error', message: COLLABORATOR_RE_ENROLL_MESSAGE }));
    expect((await enrRow(e3.enrollmentId)).status).toBe('replied');

    const byMember = await engine(await tokenOf(member), {
      action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [e1.enrollmentId],
    });
    expect(byMember.status, JSON.stringify(byMember.body)).toBe(200);
    expect(resultOf(byMember.body, e1.enrollmentId)?.outcome, 'un membre reprend le candidat d’un collègue').toBe('resumed');
    expect((await enrRow(e1.enrollmentId)).status).toBe('active');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// « Marquer comme répondu » (SEQ-221, SEQ-212, SEQ-006, SEQ-071)
// ════════════════════════════════════════════════════════════════════════════
test.describe('@critical « Marquer comme répondu » sur une inscription active', () => {
  test.describe.configure({ mode: 'serial' });

  // mark-replied-active-effets
  test('@critical statut répondu, étapes en attente annulées sauf l’envoi en cours, pipeline de la mission seul, autres inscriptions de l’organisation arrêtées, réponse comptée une fois', async () => {
    const { org: a, accountId: accA } = await sendingOrg('E2E A1 Répondu A');
    const b = await createOrg('agency', 'E2E A1 Répondu B');
    track(a);
    track(b);
    const token = await tokenOf(a.owner);
    const job1 = await seedMission(a.orgId, a.owner.userId);
    const job2 = await seedMission(a.orgId, a.owner.userId);
    const profileId = `ACoAAE2EMR${rand()}${rand()}`;

    const seq1 = await seedSequence(a.orgId, a.owner.userId, [
      { action_type: 'message' }, { action_type: 'wait_reply', wait_for_event: 'reply' }, { action_type: 'message', delay_days: 3 },
    ]);
    const seq2 = await seedSequence(a.orgId, a.owner.userId, [{ action_type: 'message' }]);
    const seqB = await seedSequence(b.orgId, b.owner.userId, [{ action_type: 'message' }]);
    const e1 = await enroll(a, seq1.sequenceId, a.owner.userId, accA, { profile_id: profileId, job_id: `project:${job1}` });
    const e2 = await enroll(a, seq2.sequenceId, a.owner.userId, `acc_${rand()}`, { profile_id: profileId, status: 'paused', pause_reason: 'manual' });
    const e3 = await enroll(b, seqB.sequenceId, b.owner.userId, `acc_${rand()}`, { profile_id: profileId });

    // Refonte mission, lot 0b : lignes « Contacté » posées par set_candidate_stage.
    const jcs = async (orgId: string, jobId: string, createdBy: string) => {
      const { id } = await seedCandidateRow({ orgId, createdBy, candidateId: profileId, missionId: jobId, stage: 'contacted' });
      cleanups.push(() => admin().from('job_candidate_status').delete().eq('id', id));
      return id;
    };
    const jcsA1 = await jcs(a.orgId, job1, a.owner.userId);
    const jcsA2 = await jcs(a.orgId, job2, a.owner.userId);
    // Organisation B : sa propre mission (une ligne ne porte que la mission de son organisation, C1).
    const jcsB1 = await jcs(b.orgId, await seedMission(b.orgId, b.owner.userId), b.owner.userId);

    const analytics = async () => {
      const { data } = await admin().from('sequence_analytics').select('replies_received').eq('sequence_id', seq1.sequenceId);
      return (data ?? []).reduce((s: number, r: { replies_received: number | null }) => s + (r.replies_received ?? 0), 0);
    };
    const repliesBefore = await analytics();

    const future = minutesFromNow(24 * 60);
    const sending = await schedule(a, e1.enrollmentId, seq1.steps[0], { status: 'sending', scheduled_at: minutesFromNow(-1) });
    const waiting = await schedule(a, e1.enrollmentId, seq1.steps[1], { status: 'waiting_event', scheduled_at: future });
    const scheduled = await schedule(a, e1.enrollmentId, seq1.steps[2], { scheduled_at: future });
    const e2Exec = await schedule(a, e2.enrollmentId, seq2.steps[0], { scheduled_at: future });
    const e3Exec = await schedule(b, e3.enrollmentId, seqB.steps[0], { scheduled_at: future });

    const res = await engine(token, { action: 'mark_replied', organization_id: a.orgId, enrollment_id: e1.enrollmentId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.changed).toBe(true);
    expect(res.body.stopped_siblings, 'une autre inscription du candidat dans l’organisation').toBe(1);

    const closed = await enrRow(e1.enrollmentId);
    expect(closed.status).toBe('replied');
    expect(closed.replied_at).not.toBeNull();
    expect((await execRow(scheduled)).status, 'étape planifiée annulée').toBe('cancelled');
    expect((await execRow(waiting)).status, 'attente annulée').toBe('cancelled');
    expect((await execRow(sending)).status, 'l’envoi en cours n’est jamais annulé').toBe('sending');

    expect((await enrRow(e2.enrollmentId)).status, 'autre séquence du candidat arrêtée').toBe('stopped');
    const e2After = await execRow(e2Exec);
    expect(e2After.status).toBe('cancelled');
    expect(e2After.skip_reason).toBe(SIBLING_REPLY_SKIP_REASON);
    expect((await enrRow(e3.enrollmentId)).status, 'l’autre organisation n’est pas touchée').toBe('active');
    expect((await execRow(e3Exec)).status).toBe('scheduled');

    const { data: jcsRows } = await admin().from('job_candidate_status').select('id, general_stage').in('id', [jcsA1, jcsA2, jcsB1]);
    const statusOf = (id: string) => (jcsRows ?? []).find((r: { id: string }) => r.id === id)?.general_stage;
    expect(statusOf(jcsA1), 'pipeline de la mission passé « Répondu »').toBe('replied');
    expect(statusOf(jcsA2), 'autre mission de l’organisation intacte').toBe('contacted');
    expect(statusOf(jcsB1), 'autre organisation intacte').toBe('contacted');

    expect(await analytics(), 'réponse comptée une fois').toBe(repliesBefore + 1);

    // Second clic : rien ne change, la réponse n'est pas recomptée.
    const again = await engine(token, { action: 'mark_replied', organization_id: a.orgId, enrollment_id: e1.enrollmentId });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.changed).toBe(false);
    expect(await analytics()).toBe(repliesBefore + 1);

    // La ligne 'sending' est volontairement laissée au moteur : on la retire pour
    // qu'aucun janitor d'une autre suite ne la relise après le test.
    await admin().from('sequence_step_executions').delete().eq('id', sending);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Moteur : compte d'envoi d'une autre organisation (SEQ-010)
// ════════════════════════════════════════════════════════════════════════════
test.describe('@critical Moteur : compte d’envoi rattaché à l’organisation (SEQ-010)', () => {
  test.describe.configure({ mode: 'serial' });

  // inscription-compte-autre-organisation-moteur
  test('@critical une inscription portant le compte LinkedIn d’une autre organisation ne part jamais : pause manuelle et exécution annulée', async () => {
    const { org: a, accountId: accA } = await sendingOrg('E2E A1 Compte A');
    const b = await createOrg('agency', 'E2E A1 Compte B');
    track(a);
    track(b);
    const accB = await seedLinkedInAccount(b.orgId, b.owner.userId, `acc_${rand()}`, 'OK');
    const { sequenceId, steps } = await messageSequence(a, a.owner.userId, ['Bonjour']);
    // Acceptée à l'insertion : accB n'est relié à aucun membre de A.
    const { enrollmentId } = await enroll(a, sequenceId, a.owner.userId, accB);
    // Variante : compte de l'inscription relié dans A, compte de rotation relié dans B.
    const rotated = await enroll(a, sequenceId, a.owner.userId, accA, { assigned_sender_id: accB });
    const execId = await schedule(a, enrollmentId, steps[0]);
    const rotatedExec = await schedule(a, rotated.enrollmentId, steps[0]);

    await runCycle();

    expect(await sentTexts(accB), 'aucun envoi depuis le compte de l’autre organisation').toEqual([]);
    const enr = await enrRow(enrollmentId);
    expect(enr.status).toBe('paused');
    expect(enr.pause_reason).toBe('manual');
    expect(enr.tracking_data?.pause_reason).toBe(ACCOUNT_NOT_IN_ORG_REASON);
    const exec = await execRow(execId);
    expect(exec.status).toBe('cancelled');
    expect(exec.skip_reason).toBe(ACCOUNT_NOT_IN_ORG_REASON);

    const rotatedRow = await enrRow(rotated.enrollmentId);
    expect(rotatedRow.status, 'compte de rotation d’une autre organisation : pause').toBe('paused');
    expect(rotatedRow.tracking_data?.pause_reason).toBe(ACCOUNT_NOT_IN_ORG_REASON);
    expect((await execRow(rotatedExec)).status).toBe('cancelled');
    expect(await sentTexts(accA), 'rien ne part non plus du compte de l’inscription').toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Assistant : outil pause_sequence (SEQ-024, D3)
// ════════════════════════════════════════════════════════════════════════════
test.describe('@critical Assistant : pause_sequence', () => {
  test.describe.configure({ mode: 'serial' });

  async function propose(orgId: string, userId: string, sequenceId: string): Promise<string> {
    const { data, error } = await admin().from('agent_tool_executions').insert({
      tool_name: 'pause_sequence', params: { sequence_id: sequenceId }, status: 'proposed', user_id: userId, organization_id: orgId,
    }).select('id').single();
    if (error) throw new Error(`agent_tool_executions: ${error.message}`);
    cleanups.push(() => admin().from('agent_tool_executions').delete().eq('id', data!.id));
    return data!.id as string;
  }
  const approve = (token: string, executionId: string) =>
    postJson('/functions/v1/agent-tool-action', { execution_id: executionId, action: 'approve' }, { Authorization: `Bearer ${token}` });

  // assistant-pause-sequence
  test('@critical approuvé par le propriétaire, un membre ou un admin : inscriptions actives en pause sequence_inactive, pauses manuelles intactes, séquence désactivée', async () => {
    const org = await createOrg('agency', 'E2E A1 Assistant');
    const member = await addMember(org.orgId, 'member', 'membre');
    const adminUser = await addMember(org.orgId, 'admin', 'admin');
    track(org, member, adminUser);
    await setPaidPlan(org.orgId);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const a1 = await enroll(org, sequenceId, org.owner.userId, `acc_${rand()}`);
    const a2 = await enroll(org, sequenceId, org.owner.userId, `acc_${rand()}`);
    const manual = await enroll(org, sequenceId, org.owner.userId, `acc_${rand()}`, { status: 'paused', pause_reason: 'manual' });
    const dueAt = minutesFromNow(24 * 60);
    const a1Exec = await schedule(org, a1.enrollmentId, steps[0], { scheduled_at: dueAt });

    const res = await approve(await tokenOf(org.owner), await propose(org.orgId, org.owner.userId, sequenceId));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
    expect((res.body.data as Json).paused_enrollments, 'deux candidats en cours').toBe(2);
    for (const id of [a1.enrollmentId, a2.enrollmentId]) {
      const row = await enrRow(id);
      expect(row.status).toBe('paused');
      expect(row.pause_reason).toBe('sequence_inactive');
    }
    expect((await enrRow(manual.enrollmentId)).pause_reason, 'la pause manuelle reste manuelle').toBe('manual');
    const { data: seq } = await admin().from('outreach_sequences').select('is_active').eq('id', sequenceId).single();
    expect(seq?.is_active).toBe(false);
    const exec = await execRow(a1Exec);
    expect(exec.status, 'la pause garde les étapes').toBe('scheduled');
    expect(ms(exec.scheduled_at)).toBe(ms(dueAt));

    // Membre et admin : même droit sur toute la séquence.
    for (const [who, user] of [['membre', member], ['admin', adminUser]] as const) {
      const other = await messageSequence(org, org.owner.userId, ['Bonjour']);
      const e = await enroll(org, other.sequenceId, org.owner.userId, `acc_${rand()}`);
      const r = await approve(await tokenOf(user), await propose(org.orgId, user.userId, other.sequenceId));
      expect(r.status, `${who} : ${JSON.stringify(r.body)}`).toBe(200);
      expect((r.body.data as Json).paused_enrollments).toBe(1);
      expect((await enrRow(e.enrollmentId)).pause_reason).toBe('sequence_inactive');
    }
  });

  // assistant-pause-sequence (refus)
  test('@critical refusé à un collaborateur, même auteur, et pour la séquence d’une autre organisation, sans aucune écriture', async () => {
    const org = await createOrg('agency', 'E2E A1 Assistant refus');
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    const other = await createOrg('agency', 'E2E A1 Assistant autre');
    track(org, collab);
    track(other);
    await setPaidPlan(org.orgId);
    // Séquence créée par le collaborateur lui-même, avec ses propres candidats.
    const { sequenceId } = await messageSequence(org, collab.userId, ['Bonjour']);
    const mine = await enroll(org, sequenceId, collab.userId, `acc_${rand()}`);
    const res = await approve(await tokenOf(collab), await propose(org.orgId, collab.userId, sequenceId));
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(String(res.body.error)).toContain('collaborateur');
    expect((await enrRow(mine.enrollmentId)).status, 'rien n’a changé').toBe('active');
    const { data: seq } = await admin().from('outreach_sequences').select('is_active').eq('id', sequenceId).single();
    expect(seq?.is_active).toBe(true);

    const foreign = await messageSequence(other, other.owner.userId, ['Bonjour']);
    const foreignEnr = await enroll(other, foreign.sequenceId, other.owner.userId, `acc_${rand()}`);
    const cross = await approve(await tokenOf(org.owner), await propose(org.orgId, org.owner.userId, foreign.sequenceId));
    expect(cross.status, JSON.stringify(cross.body)).toBe(400);
    expect(String(cross.body.error)).toContain('autre organisation');
    expect((await enrRow(foreignEnr.enrollmentId)).status).toBe('active');
    const { data: fseq } = await admin().from('outreach_sequences').select('is_active').eq('id', foreign.sequenceId).single();
    expect(fseq?.is_active).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Dissociation d'un compte LinkedIn (SEQ-041, SEQ-042, SEQ-002)
// ════════════════════════════════════════════════════════════════════════════
test.describe('@critical « Dissocier » un compte LinkedIn', () => {
  test.describe.configure({ mode: 'serial' });

  // unlink-arrete-envois
  test('@critical pause manuelle des inscriptions du compte, pauses automatiques relabellisées, InMails annulés, rotation retirée, dates gardées, session prestataire intacte, autre organisation intacte', async () => {
    const { org, accountId: acc1 } = await sendingOrg('E2E A1 Dissocier');
    const b = await createOrg('agency', 'E2E A1 Dissocier B');
    track(org);
    track(b);
    const mappingId = await mappingIdOf(acc1);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    await admin().from('outreach_sequences').update({ sender_accounts: [{ account_id: acc1 }], multi_sender_enabled: true }).eq('id', sequenceId);

    const e1 = await enroll(org, sequenceId, org.owner.userId, acc1);
    const e2 = await enroll(org, sequenceId, org.owner.userId, `acc_${rand()}`, { assigned_sender_id: acc1 });
    const e3 = await enroll(org, sequenceId, org.owner.userId, acc1, { status: 'paused', pause_reason: 'account_disconnected' });
    const seqB = await messageSequence(b, b.owner.userId, ['Bonjour']);
    await admin().from('outreach_sequences').update({ sender_accounts: [{ account_id: acc1 }], multi_sender_enabled: true }).eq('id', seqB.sequenceId);
    const e4 = await enroll(b, seqB.sequenceId, b.owner.userId, acc1);

    const inmail = async (orgId: string | null, status: string) => {
      const { data, error } = await admin().from('inmail_queue').insert({
        account_id: acc1, recipient_profile_id: `ACoAAE2EIM${rand()}`, subject: 'Opportunité', message: 'Bonjour',
        status, scheduled_at: minutesFromNow(24 * 60), created_by: org.owner.userId, organization_id: orgId,
      }).select('id').single();
      if (error) throw new Error(`inmail_queue: ${error.message}`);
      cleanups.push(() => admin().from('inmail_queue').delete().eq('id', data!.id));
      return data!.id as string;
    };
    const imScheduled = await inmail(org.orgId, 'scheduled');
    const imPending = await inmail(org.orgId, 'pending');
    const imNoOrg = await inmail(null, 'scheduled');
    const imSent = await inmail(org.orgId, 'sent');
    const imOtherOrg = await inmail(b.orgId, 'scheduled');

    const dueAt = minutesFromNow(24 * 60);
    const e1Exec = await schedule(org, e1.enrollmentId, steps[0], { scheduled_at: dueAt });
    const e2Exec = await schedule(org, e2.enrollmentId, steps[0], { scheduled_at: dueAt });

    const res = await postJson('/functions/v1/unipile-accounts', {
      action: 'unlink_linkedin_account', organization_id: org.orgId, mapping_id: mappingId, expected_account_id: acc1,
    }, { Authorization: `Bearer ${await tokenOf(org.owner)}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      success: true, removed: 1, paused_enrollments: 2, relabeled_enrollments: 1, cancelled_inmails: 3,
    }));

    for (const id of [e1.enrollmentId, e2.enrollmentId]) {
      const row = await enrRow(id);
      expect(row.status).toBe('paused');
      expect(row.pause_reason).toBe('manual');
    }
    for (const id of [e1Exec, e2Exec]) {
      const exec = await execRow(id);
      expect(exec.status, 'la pause garde l’étape en attente').toBe('scheduled');
      expect(ms(exec.scheduled_at)).toBe(ms(dueAt));
    }
    expect((await enrRow(e3.enrollmentId)).pause_reason, 'pause automatique passée en manuelle').toBe('manual');
    expect((await enrRow(e4.enrollmentId)).status, 'autre organisation intacte').toBe('active');

    const { data: ims } = await admin().from('inmail_queue').select('id, status').in('id', [imScheduled, imPending, imNoOrg, imSent, imOtherOrg]);
    const imStatus = (id: string) => (ims ?? []).find((r: { id: string }) => r.id === id)?.status;
    expect(imStatus(imScheduled)).toBe('cancelled');
    expect(imStatus(imPending)).toBe('cancelled');
    expect(imStatus(imNoOrg)).toBe('cancelled');
    expect(imStatus(imSent), 'InMail déjà parti intact').toBe('sent');
    expect(imStatus(imOtherOrg), 'InMail de l’autre organisation intact').toBe('scheduled');

    const { data: seq } = await admin().from('outreach_sequences').select('sender_accounts, multi_sender_enabled').eq('id', sequenceId).single();
    expect(seq?.sender_accounts).toEqual([]);
    expect(seq?.multi_sender_enabled).toBe(false);
    const { data: seqBRow } = await admin().from('outreach_sequences').select('sender_accounts, multi_sender_enabled').eq('id', seqB.sequenceId).single();
    expect(seqBRow?.sender_accounts, 'rotation de l’autre organisation intacte').toEqual([{ account_id: acc1 }]);
    expect(seqBRow?.multi_sender_enabled).toBe(true);
    const { data: mapping } = await admin().from('member_linkedin_accounts').select('id').eq('id', mappingId);
    expect(mapping, 'liaison retirée').toEqual([]);

    const closedSession = (await mockCalls()).filter((c) => c.method === 'DELETE' && c.path.includes(acc1));
    expect(closedSession, 'aucune fermeture de session chez le prestataire').toEqual([]);
  });

  // unlink-puis-reprises-bloquees
  test('@critical après la dissociation, rien ne part : ni au cycle, ni à la reconnexion, ni par la reprise groupée ou individuelle', async () => {
    const { org, accountId: acc } = await sendingOrg('E2E A1 Dissocié bloqué');
    track(org);
    const token = await tokenOf(org.owner);
    const mappingId = await mappingIdOf(acc);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const e1 = await enroll(org, sequenceId, org.owner.userId, acc);
    const e2 = await enroll(org, sequenceId, org.owner.userId, acc, { status: 'paused', pause_reason: 'account_disconnected' });
    const e3 = await enroll(org, sequenceId, org.owner.userId, acc, { status: 'paused', pause_reason: 'sequence_inactive' });
    await schedule(org, e2.enrollmentId, steps[0], { status: 'cancelled', skip_reason: ACCOUNT_DISCONNECTED_SKIP_REASON, scheduled_at: minutesFromNow(-10) });
    await schedule(org, e3.enrollmentId, steps[0], { scheduled_at: minutesFromNow(-10) });
    // Étape de E1 dans le futur tant que E1 est active (un cycle concurrent la prendrait).
    const e1Exec = await schedule(org, e1.enrollmentId, steps[0], { scheduled_at: minutesFromNow(24 * 60) });

    const unlink = await postJson('/functions/v1/unipile-accounts', {
      action: 'unlink_linkedin_account', organization_id: org.orgId, mapping_id: mappingId, expected_account_id: acc,
    }, { Authorization: `Bearer ${token}` });
    expect(unlink.status, JSON.stringify(unlink.body)).toBe(200);

    // E1 est en pause : son étape devient échue sans risque.
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', e1Exec);
    await runCycle();
    expect(await sentTexts(acc), 'rien ne part au cycle suivant').toEqual([]);

    await webhook({ AccountStatus: { account_id: acc, account_type: 'LINKEDIN', message: 'OK' } });
    const e2After = await enrRow(e2.enrollmentId);
    expect(e2After.status, 'la reconnexion ne reprend pas un compte dissocié').toBe('paused');
    expect(e2After.pause_reason).toBe('manual');

    const bySeq = await engine(token, {
      action: 'resume_enrollments', organization_id: org.orgId, sequence_id: sequenceId, pause_reasons: ['sequence_inactive'],
    });
    expect(bySeq.status, JSON.stringify(bySeq.body)).toBe(200);
    expect(resultOf(bySeq.body, e3.enrollmentId)?.outcome).toBe('account_unlinked');
    expect((await enrRow(e3.enrollmentId)).status).toBe('paused');

    // « Reprendre tous les candidats en pause » (pauses manuelles, dont celles posées par la dissociation).
    const byManual = await engine(token, {
      action: 'resume_enrollments', organization_id: org.orgId, sequence_id: sequenceId, pause_reasons: ['manual'],
    });
    expect(byManual.status, JSON.stringify(byManual.body)).toBe(200);
    for (const id of [e1.enrollmentId, e2.enrollmentId]) {
      expect(resultOf(byManual.body, id)?.outcome).toBe('account_unlinked');
      expect((await enrRow(id)).status).toBe('paused');
    }

    const byId = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [e1.enrollmentId] });
    expect(byId.status, JSON.stringify(byId.body)).toBe(200);
    expect(resultOf(byId.body, e1.enrollmentId)?.outcome).toBe('account_unlinked');
    expect((await enrRow(e1.enrollmentId)).status).toBe('paused');

    await runCycle();
    expect(await sentTexts(acc), 'toujours rien après les tentatives de reprise').toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Authentification et organisation de l'appelant (SEQ-001, SEC-041)
// ════════════════════════════════════════════════════════════════════════════
test.describe('Accès aux actions de process-sequences', () => {
  test.describe.configure({ mode: 'serial' });

  // auth-anonyme-refuse
  test('un appel anonyme (sans en-tête, clé anon seule ou en Bearer) est refusé en 401 pour chaque action, sans écriture', async () => {
    const org = track(await createOrg('agency', 'E2E A1 Anonyme'));
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, `acc_${rand()}`, { status: 'paused', pause_reason: 'manual' });
    const execId = await schedule(org, enrollmentId, steps[0], { scheduled_at: minutesFromNow(24 * 60) });
    const enrBefore = await enrRow(enrollmentId);
    const execBefore = await execRow(execId);

    const bodies: Json[] = [
      { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [enrollmentId] },
      { action: 're_enroll', organization_id: org.orgId, enrollment_ids: [enrollmentId] },
      { action: 'mark_replied', organization_id: org.orgId, enrollment_id: enrollmentId },
      { action: 'skip_execution', execution_id: execId },
      { action: 'nudge_sequences', organization_id: org.orgId },
      { action: 'process', force: true },
    ];
    const variants: Array<[string, Record<string, string>]> = [
      ['sans en-tête', {}],
      ['clé anon seule', { apikey: E2E.anonKey }],
      ['Bearer anon', { apikey: E2E.anonKey, Authorization: `Bearer ${E2E.anonKey}` }],
    ];
    for (const body of bodies) {
      for (const [label, headers] of variants) {
        const res = await fetch(`${E2E.supabaseUrl}/functions/v1/process-sequences`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        expect(res.status, `${body.action} / ${label}`).toBe(401);
        expect(json, `${body.action} / ${label}`).toEqual({ error: 'Unauthorized' });
      }
    }

    const enrAfter = await enrRow(enrollmentId);
    const execAfter = await execRow(execId);
    expect(enrAfter.status).toBe(enrBefore.status);
    expect(enrAfter.pause_reason).toBe(enrBefore.pause_reason);
    expect(enrAfter.updated_at).toBe(enrBefore.updated_at);
    expect(execAfter.status).toBe(execBefore.status);
    expect(execAfter.scheduled_at).toBe(execBefore.scheduled_at);
    expect(execAfter.updated_at).toBe(execBefore.updated_at);
  });

  // organisation-appelant-verifiee
  test('organisation d’un autre : 403 forbidden ; appelant sans organisation active : 400 no_organization ; cron sans organisation : 400 organization_required', async () => {
    const later = laterTodayIso();
    test.skip(!later, 'trop près de minuit à Paris');
    const a = track(await createOrg('agency', 'E2E A1 Org A'));
    const b = track(await createOrg('agency', 'E2E A1 Org B'));
    const tokenA = await tokenOf(a.owner);
    const seqA = await messageSequence(a, a.owner.userId, ['Bonjour']);
    const seqB = await messageSequence(b, b.owner.userId, ['Bonjour', 'Relance']);
    const enrA = await enroll(a, seqA.sequenceId, a.owner.userId, `acc_${rand()}`);
    const activeB = await enroll(b, seqB.sequenceId, b.owner.userId, `acc_${rand()}`);
    const pausedB = await enroll(b, seqB.sequenceId, b.owner.userId, `acc_${rand()}`, { status: 'paused', pause_reason: 'manual' });
    const execA = await schedule(a, enrA.enrollmentId, seqA.steps[0], { scheduled_at: later });
    const execB = await schedule(b, activeB.enrollmentId, seqB.steps[0], { scheduled_at: later });
    await schedule(b, pausedB.enrollmentId, seqB.steps[0], { scheduled_at: minutesFromNow(24 * 60) });
    const beforeA = (await execRow(execA)).scheduled_at;
    const beforeB = (await execRow(execB)).scheduled_at;

    const nudge = await engine(tokenA, { action: 'nudge_sequences', organization_id: b.orgId });
    expect(nudge.status, JSON.stringify(nudge.body)).toBe(403);
    expect(nudge.body.error_code).toBe('forbidden');
    expect((await execRow(execB)).scheduled_at, 'action de B inchangée').toBe(beforeB);

    const resume = await engine(tokenA, { action: 'resume_enrollments', organization_id: b.orgId, enrollment_ids: [pausedB.enrollmentId] });
    expect(resume.status, JSON.stringify(resume.body)).toBe(403);
    expect(resume.body.error_code).toBe('forbidden');
    expect((await enrRow(pausedB.enrollmentId)).status).toBe('paused');

    // Utilisateur sans organisation active.
    const lonely = await createConfirmedUser('sansorg');
    cleanups.push(() => admin().auth.admin.deleteUser(lonely.userId));
    const lonelyToken = await tokenOf(lonely);
    for (const body of [
      { action: 'resume_enrollments', enrollment_ids: [pausedB.enrollmentId] },
      { action: 'nudge_sequences' },
      { action: 'mark_replied', enrollment_id: pausedB.enrollmentId },
    ]) {
      const res = await engine(lonelyToken, body);
      expect(res.status, `${body.action} : ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error_code).toBe('no_organization');
    }
    expect((await enrRow(pausedB.enrollmentId)).status).toBe('paused');

    // Cron sans organisation : jamais toute la plateforme.
    const cron = await postJson('/functions/v1/process-sequences', { action: 'nudge_sequences' }, { Authorization: `Bearer ${CRON_SECRET}` });
    expect(cron.status, JSON.stringify(cron.body)).toBe(400);
    expect(cron.body.error_code).toBe('organization_required');
    expect((await execRow(execA)).scheduled_at).toBe(beforeA);
    expect((await execRow(execB)).scheduled_at).toBe(beforeB);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// « Envoyer les actions du jour » (nudge_sequences, SEQ-001)
// ════════════════════════════════════════════════════════════════════════════
test.describe('« Envoyer les actions du jour »', () => {
  test.describe.configure({ mode: 'serial' });

  // nudge-sequences-autre-org-refusees
  test('une séquence d’une autre organisation dans sequence_ids : 403, rien n’avance ; identifiant mal formé : 400', async () => {
    const later = laterTodayIso();
    test.skip(!later, 'trop près de minuit à Paris');
    const a = track(await createOrg('agency', 'E2E A1 Nudge A'));
    const b = track(await createOrg('agency', 'E2E A1 Nudge B'));
    const token = await tokenOf(a.owner);
    const seqA = await messageSequence(a, a.owner.userId, ['Bonjour']);
    const seqB = await messageSequence(b, b.owner.userId, ['Bonjour']);
    const enrA = await enroll(a, seqA.sequenceId, a.owner.userId, `acc_${rand()}`);
    const execA = await schedule(a, enrA.enrollmentId, seqA.steps[0], { scheduled_at: later });
    const before = (await execRow(execA)).scheduled_at;

    const mixed = await engine(token, { action: 'nudge_sequences', organization_id: a.orgId, sequence_ids: [seqA.sequenceId, seqB.sequenceId] });
    expect(mixed.status, JSON.stringify(mixed.body)).toBe(403);
    expect(mixed.body.error_code).toBe('forbidden');
    expect((await execRow(execA)).scheduled_at, 'rien n’avance').toBe(before);

    const bad = await engine(token, { action: 'nudge_sequences', organization_id: a.orgId, sequence_ids: ['pas-un-uuid'] });
    expect(bad.status, JSON.stringify(bad.body)).toBe(400);
    expect(bad.body.error_code).toBe('invalid_request');
    expect((await execRow(execA)).scheduled_at).toBe(before);
  });

  // nudge-perimetre-pauses-attentes
  test('n’avance ni une inscription en pause ou close, ni une attente, vérification de connexion ou condition, ni une autre séquence ; second appel : 0', async () => {
    const later = laterTodayIso();
    test.skip(!later, 'trop près de minuit à Paris');
    const { org, accountId } = await sendingOrg('E2E A1 Nudge périmètre');
    track(org);
    const token = await tokenOf(org.owner);
    const seq1 = await seedSequence(org.orgId, org.owner.userId, [
      { action_type: 'message' },
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted' },
      { action_type: 'check_connection' },
      { action_type: 'condition_branch', condition_type: 'if_connected' },
    ]);
    const seq2 = await seedSequence(org.orgId, org.owner.userId, [{ action_type: 'message' }]);
    const owner = org.owner.userId;
    const e1 = await enroll(org, seq1.sequenceId, owner, accountId);
    const e2 = await enroll(org, seq1.sequenceId, owner, accountId, { status: 'paused', pause_reason: 'manual' });
    const e3 = await enroll(org, seq1.sequenceId, owner, accountId, { current_step_order: 1 });
    const e4 = await enroll(org, seq1.sequenceId, owner, accountId, { current_step_order: 2 });
    const e5 = await enroll(org, seq2.sequenceId, owner, accountId);
    const e6 = await enroll(org, seq1.sequenceId, owner, accountId, { status: 'replied', replied_at: minutesFromNow(-60) });
    const e7 = await enroll(org, seq1.sequenceId, owner, accountId, { current_step_order: 3 });
    const x1 = await schedule(org, e1.enrollmentId, seq1.steps[0], { scheduled_at: later });
    const others = {
      'inscription en pause': await schedule(org, e2.enrollmentId, seq1.steps[0], { scheduled_at: later }),
      'attente de connexion': await schedule(org, e3.enrollmentId, seq1.steps[1], { scheduled_at: later }),
      'vérification de connexion': await schedule(org, e4.enrollmentId, seq1.steps[2], { scheduled_at: later }),
      'autre séquence': await schedule(org, e5.enrollmentId, seq2.steps[0], { scheduled_at: later }),
      'inscription close': await schedule(org, e6.enrollmentId, seq1.steps[0], { scheduled_at: later }),
      condition: await schedule(org, e7.enrollmentId, seq1.steps[3], { scheduled_at: later }),
    };

    const res = await engine(token, { action: 'nudge_sequences', organization_id: org.orgId, sequence_ids: [seq1.sequenceId] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.advanced).toBe(1);
    expect(ms((await execRow(x1)).scheduled_at), 'seule l’action du candidat actif avance').toBeLessThanOrEqual(Date.now() + 5_000);
    for (const [label, id] of Object.entries(others)) {
      expect(ms((await execRow(id)).scheduled_at), label).toBe(ms(later));
    }

    const again = await engine(token, { action: 'nudge_sequences', organization_id: org.orgId, sequence_ids: [seq1.sequenceId] });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.advanced).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// « Sauter l'étape » (skip_execution : SEQ-119, SEQ-014, SEQ-072, SEQ-027)
// ════════════════════════════════════════════════════════════════════════════
test.describe('« Sauter l’étape »', () => {
  test.describe.configure({ mode: 'serial' });

  // skip-collaborateur-candidat-collegue
  test('un collaborateur ne saute pas l’étape d’un candidat d’un collègue (403) mais saute les siennes ; membre et admin sautent celles de tous', async () => {
    const org = await createOrg('agency', 'E2E A1 Skip collab');
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    const member = await addMember(org.orgId, 'member', 'membre');
    const adminUser = await addMember(org.orgId, 'admin', 'admin');
    track(org, collab, member, adminUser);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance', 'Dernière']);
    const e1 = await enroll(org, sequenceId, org.owner.userId, `acc_${rand()}`);
    const e2 = await enroll(org, sequenceId, collab.userId, `acc_${rand()}`);
    const e3 = await enroll(org, sequenceId, org.owner.userId, `acc_${rand()}`);
    const future = minutesFromNow(24 * 60);
    const x1 = await schedule(org, e1.enrollmentId, steps[0], { scheduled_at: future });
    const x2 = await schedule(org, e2.enrollmentId, steps[0], { scheduled_at: future });
    const x3 = await schedule(org, e3.enrollmentId, steps[0], { scheduled_at: future });

    const collabToken = await tokenOf(collab);
    const refused = await engine(collabToken, { action: 'skip_execution', execution_id: x1 });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(refused.body.error_code).toBe('forbidden');
    expect(refused.body.message).toBe(COLLABORATOR_ACTION_MESSAGE);
    expect((await execRow(x1)).status).toBe('scheduled');
    expect((await enrRow(e1.enrollmentId)).current_step_order).toBe(0);

    const own = await engine(collabToken, { action: 'skip_execution', execution_id: x2 });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect((await execRow(x2)).status).toBe('skipped');

    const byMember = await engine(await tokenOf(member), { action: 'skip_execution', execution_id: x1 });
    expect(byMember.status, JSON.stringify(byMember.body)).toBe(200);
    expect((await execRow(x1)).status).toBe('skipped');

    const byAdmin = await engine(await tokenOf(adminUser), { action: 'skip_execution', execution_id: x3 });
    expect(byAdmin.status, JSON.stringify(byAdmin.body)).toBe(200);
    expect((await execRow(x3)).status).toBe('skipped');
  });

  // skip-envoi-en-cours-refuse
  test('une étape en cours d’envoi ne se saute pas : 409 step_sending, exécution et position inchangées', async () => {
    const org = track(await createOrg('agency', 'E2E A1 Skip envoi'));
    const token = await tokenOf(org.owner);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, `acc_${rand()}`);
    const execId = await schedule(org, enrollmentId, steps[0], { status: 'sending', scheduled_at: minutesFromNow(-1) });
    cleanups.push(() => admin().from('sequence_step_executions').delete().eq('id', execId));

    const res = await engine(token, { action: 'skip_execution', execution_id: execId });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error_code).toBe('step_sending');
    expect((await execRow(execId)).status).toBe('sending');
    expect((await enrRow(enrollmentId)).current_step_order).toBe(0);
    expect(await executionsOf(enrollmentId), 'aucune étape suivante planifiée').toHaveLength(1);
  });

  // skip-inscription-non-active-refusee
  test('sauter l’étape d’une inscription en pause ou close : 409 enrollment_not_active, rien n’est écrit', async () => {
    const org = track(await createOrg('agency', 'E2E A1 Skip inactif'));
    const token = await tokenOf(org.owner);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const repliedAt = minutesFromNow(-90);
    const paused = await enroll(org, sequenceId, org.owner.userId, `acc_${rand()}`, { status: 'paused', pause_reason: 'manual' });
    const replied = await enroll(org, sequenceId, org.owner.userId, `acc_${rand()}`, { status: 'replied', replied_at: repliedAt });
    const future = minutesFromNow(24 * 60);
    const xp = await schedule(org, paused.enrollmentId, steps[0], { scheduled_at: future });
    const xr = await schedule(org, replied.enrollmentId, steps[0], { scheduled_at: future });

    for (const [label, execId, enrollmentId, status] of [
      ['en pause', xp, paused.enrollmentId, 'paused'],
      ['répondu', xr, replied.enrollmentId, 'replied'],
    ] as const) {
      const res = await engine(token, { action: 'skip_execution', execution_id: execId });
      expect(res.status, `${label} : ${JSON.stringify(res.body)}`).toBe(409);
      expect(res.body.error_code).toBe('enrollment_not_active');
      expect((await execRow(execId)).status, label).toBe('scheduled');
      const row = await enrRow(enrollmentId);
      expect(row.status, label).toBe(status);
      expect(row.current_step_order, label).toBe(0);
      expect(await executionsOf(enrollmentId), label).toHaveLength(1);
    }
    expect(ms((await enrRow(replied.enrollmentId)).replied_at), 'date de réponse inchangée').toBe(ms(repliedAt));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Reprise et relance : cas sans rien à réarmer, refus (SEQ-004, SEQ-222, D1,
// SEQ-010, D5)
// ════════════════════════════════════════════════════════════════════════════
test.describe('Reprise et relance : planification et refus', () => {
  test.describe.configure({ mode: 'serial' });

  // resume-planifie-suivante-ou-rien
  test('sans rien à réarmer : étape suivante planifiée à son délai ; séquence finie : nothing_to_resume ; statut inéligible refusé', async () => {
    const { org, accountId } = await sendingOrg('E2E A1 Suivante');
    track(org);
    const token = await tokenOf(org.owner);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance'], 3);
    const past = (d: number) => minutesFromNow(-d * 24 * 60);
    const sentStep = (enrollmentId: string, i: number, daysAgo: number) => schedule(org, enrollmentId, steps[i], {
      status: 'sent', scheduled_at: past(daysAgo), executed_at: past(daysAgo), created_at: past(daysAgo),
    });

    // (a) en pause, étape 0 partie seule.
    const a = await enroll(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'manual', current_step_order: 1 });
    await sentStep(a.enrollmentId, 0, 1);
    // (b) en pause, toutes les étapes parties.
    const b = await enroll(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'manual', current_step_order: 2 });
    await sentStep(b.enrollmentId, 0, 6);
    await sentStep(b.enrollmentId, 1, 3);
    // (c) répondu, toutes les étapes parties.
    const repliedAt = past(1);
    const c = await enroll(org, sequenceId, org.owner.userId, accountId, { status: 'replied', replied_at: repliedAt, current_step_order: 2 });
    await sentStep(c.enrollmentId, 0, 6);
    await sentStep(c.enrollmentId, 1, 3);
    // (d) active, (e) en pause pour une relance.
    const d = await enroll(org, sequenceId, org.owner.userId, accountId);
    await schedule(org, d.enrollmentId, steps[0], { scheduled_at: minutesFromNow(24 * 60) });
    const e = await enroll(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'manual' });
    await schedule(org, e.enrollmentId, steps[0], { scheduled_at: minutesFromNow(24 * 60) });

    const resA = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [a.enrollmentId] });
    expect(resA.status, JSON.stringify(resA.body)).toBe(200);
    expect(resultOf(resA.body, a.enrollmentId)?.outcome).toBe('resumed');
    const nextA = (await executionsOf(a.enrollmentId)).filter((x) => x.status === 'scheduled');
    expect(nextA, '(a) une exécution pour l’étape 1').toHaveLength(1);
    expect(nextA[0].step_order).toBe(1);
    expect(ms(nextA[0].scheduled_at), '(a) au délai de l’étape (3 jours)').toBeGreaterThan(Date.now() + 3 * 24 * 3600_000 - 60_000);
    expect(ms(nextA[0].scheduled_at)).toBeLessThan(Date.now() + 6 * 24 * 3600_000);
    expect((await enrRow(a.enrollmentId)).status).toBe('active');

    const resB = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [b.enrollmentId] });
    expect(resB.status, JSON.stringify(resB.body)).toBe(200);
    expect(resultOf(resB.body, b.enrollmentId)?.outcome).toBe('nothing_to_resume');
    expect((await enrRow(b.enrollmentId)).status, '(b) la reprise clôt la séquence finie').toBe('completed');

    const cBefore = await enrRow(c.enrollmentId);
    const resC = await engine(token, { action: 're_enroll', organization_id: org.orgId, enrollment_ids: [c.enrollmentId] });
    expect(resC.status, JSON.stringify(resC.body)).toBe(200);
    expect(resultOf(resC.body, c.enrollmentId)?.outcome).toBe('nothing_to_resume');
    const cAfter = await enrRow(c.enrollmentId);
    expect(cAfter.status, '(c) la relance remet l’état d’origine').toBe('replied');
    expect(ms(cAfter.replied_at)).toBe(ms(repliedAt));
    expect(cAfter.tracking_data).toEqual(cBefore.tracking_data);

    const dBefore = await enrRow(d.enrollmentId);
    const resD = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [d.enrollmentId] });
    expect(resD.status, JSON.stringify(resD.body)).toBe(200);
    expect(resultOf(resD.body, d.enrollmentId)?.outcome).toBe('not_paused');
    expect((await enrRow(d.enrollmentId)).updated_at, '(d) rien n’est écrit').toBe(dBefore.updated_at);

    const resE = await engine(token, { action: 're_enroll', organization_id: org.orgId, enrollment_ids: [e.enrollmentId] });
    expect(resE.status, JSON.stringify(resE.body)).toBe(200);
    expect(resultOf(resE.body, e.enrollmentId)).toEqual(expect.objectContaining({
      outcome: 'error', message: 'Ce candidat est en pause : utilisez « Reprendre ».',
    }));
    expect((await enrRow(e.enrollmentId)).status).toBe('paused');
  });

  // resume-sequence-desactivee-refus
  test('reprendre un candidat d’une séquence désactivée est refusé (D1) : il reste en pause et rien ne part', async () => {
    const { org, accountId } = await sendingOrg('E2E A1 Séquence off');
    track(org);
    const token = await tokenOf(org.owner);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', sequenceId);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'manual' });
    await schedule(org, enrollmentId, steps[0], { scheduled_at: minutesFromNow(-1) });

    const res = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [enrollmentId] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(resultOf(res.body, enrollmentId)).toEqual(expect.objectContaining({ outcome: 'error', message: SEQUENCE_INACTIVE_MESSAGE }));
    expect((await enrRow(enrollmentId)).status).toBe('paused');

    await runCycle();
    expect(await sentTexts(accountId)).toEqual([]);
  });

  // resume-compte-non-relie
  test('compte d’envoi plus relié à l’organisation : account_unlinked sans réarmement ; relié à nouveau : la reprise réussit ; rotation vers le compte d’une autre organisation : refus', async () => {
    const { org, accountId: acc1 } = await sendingOrg('E2E A1 Non relié');
    const b = await createOrg('agency', 'E2E A1 Non relié B');
    track(org);
    track(b);
    const token = await tokenOf(org.owner);
    const accB = await seedLinkedInAccount(b.orgId, b.owner.userId, `acc_${rand()}`, 'OK');
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const e = await enroll(org, sequenceId, org.owner.userId, acc1, { status: 'paused', pause_reason: 'manual' });
    const plannedAt = minutesFromNow(24 * 60);
    const cancelled = await schedule(org, e.enrollmentId, steps[0], { status: 'cancelled', skip_reason: 'Compte LinkedIn dissocié', scheduled_at: plannedAt });
    const rotated = await enroll(org, sequenceId, org.owner.userId, acc1, { status: 'paused', pause_reason: 'manual', assigned_sender_id: accB });
    await schedule(org, rotated.enrollmentId, steps[0], { scheduled_at: plannedAt });

    await admin().from('member_linkedin_accounts').delete().eq('linkedin_account_id', acc1).eq('organization_id', org.orgId);
    const refused = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [e.enrollmentId] });
    expect(refused.status, JSON.stringify(refused.body)).toBe(200);
    expect(resultOf(refused.body, e.enrollmentId)?.outcome).toBe('account_unlinked');
    expect((await execRow(cancelled)).status, 'aucune étape réarmée').toBe('cancelled');
    expect((await enrRow(e.enrollmentId)).status).toBe('paused');

    await seedLinkedInAccount(org.orgId, org.owner.userId, acc1, 'OK');
    const ok = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [e.enrollmentId] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(resultOf(ok.body, e.enrollmentId)?.outcome).toBe('resumed');
    const rearmed = await execRow(cancelled);
    expect(rearmed.status).toBe('scheduled');
    expect(ms(rearmed.scheduled_at), 'réarmée à sa date prévue').toBe(ms(plannedAt));

    const viaRotation = await engine(token, { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [rotated.enrollmentId] });
    expect(viaRotation.status, JSON.stringify(viaRotation.body)).toBe(200);
    expect(resultOf(viaRotation.body, rotated.enrollmentId)?.outcome, 'compte de rotation relié dans une autre organisation').toBe('account_unlinked');
    expect((await enrRow(rotated.enrollmentId)).status).toBe('paused');
  });

  // resume-rgpd-refuse
  test('un candidat touché par un effacement RGPD n’est ni repris ni relancé, sans aucune écriture (D5)', async () => {
    const { org, accountId } = await sendingOrg('E2E A1 RGPD');
    track(org);
    const token = await tokenOf(org.owner);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const future = minutesFromNow(24 * 60);
    // Marqueur durable.
    const marked = await enroll(org, sequenceId, org.owner.userId, accountId, {
      status: 'paused', pause_reason: 'manual', tracking_data: { gdpr_erased_at: new Date().toISOString() },
    });
    await schedule(org, marked.enrollmentId, steps[0], { scheduled_at: future });
    // Marqueur sur une inscription terminée (relance).
    const completedMarked = await enroll(org, sequenceId, org.owner.userId, accountId, {
      status: 'completed', completed_at: minutesFromNow(-60), current_step_order: 2,
      tracking_data: { gdpr_erased_at: new Date().toISOString() },
    });
    // Étape annulée par l'effacement.
    const stopped = await enroll(org, sequenceId, org.owner.userId, accountId, { status: 'stopped', completed_at: minutesFromNow(-60) });
    await schedule(org, stopped.enrollmentId, steps[0], { status: 'cancelled', skip_reason: GDPR_ERASURE_SKIP_REASON, scheduled_at: future });
    // Empreinte de l'URL du profil dans le registre global.
    const slug = `camille-efface-${rand()}`;
    const profileUrl = `https://www.linkedin.com/in/${slug}/`;
    const hashed = await enroll(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'manual', profile_url: profileUrl });
    await schedule(org, hashed.enrollmentId, steps[0], { scheduled_at: future });
    const urlHash = createHash('sha256').update(`https://www.linkedin.com/in/${slug}`).digest('hex');
    const { data: erasure, error } = await admin().from('gdpr_erasures').insert({ linkedin_url_hash: urlHash, source: 'e2e' }).select('id').single();
    if (error) throw new Error(`gdpr_erasures: ${error.message}`);
    cleanups.push(() => admin().from('gdpr_erasures').delete().eq('id', erasure!.id));

    for (const [label, action, enrollmentId] of [
      ['marqueur', 'resume_enrollments', marked.enrollmentId],
      ['marqueur, inscription terminée', 're_enroll', completedMarked.enrollmentId],
      ['étape annulée par l’effacement', 're_enroll', stopped.enrollmentId],
      ['registre des effacements', 'resume_enrollments', hashed.enrollmentId],
    ] as const) {
      const before = await enrRow(enrollmentId);
      const execsBefore = await executionsOf(enrollmentId);
      const res = await engine(token, { action, organization_id: org.orgId, enrollment_ids: [enrollmentId] });
      expect(res.status, `${label} : ${JSON.stringify(res.body)}`).toBe(200);
      expect(resultOf(res.body, enrollmentId), label).toEqual(expect.objectContaining({ outcome: 'error', message: GDPR_MESSAGE }));
      const after = await enrRow(enrollmentId);
      expect(after.status, label).toBe(before.status);
      expect(after.updated_at, label).toBe(before.updated_at);
      expect(await executionsOf(enrollmentId), label).toEqual(execsBefore);
    }
  });

  // resume-validation-entree
  test('resume_enrollments valide son entrée : 400 sur liste invalide, vide ou trop longue ; identifiant mal formé ou d’une autre organisation : « introuvable » ; par séquence : 400 et 404', async () => {
    const { org, accountId } = await sendingOrg('E2E A1 Validation');
    const b = await createOrg('agency', 'E2E A1 Validation B');
    track(org);
    track(b);
    const token = await tokenOf(org.owner);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const seqB = await messageSequence(b, b.owner.userId, ['Bonjour']);
    const enrA = await enroll(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'manual' });
    await schedule(org, enrA.enrollmentId, steps[0], { scheduled_at: minutesFromNow(24 * 60) });
    const enrB = await enroll(b, seqB.sequenceId, b.owner.userId, `acc_${rand()}`, { status: 'paused', pause_reason: 'manual' });
    const call = (body: Json) => engine(token, { action: 'resume_enrollments', organization_id: org.orgId, ...body });

    const notArray = await call({ enrollment_ids: 'x' });
    expect(notArray.status, JSON.stringify(notArray.body)).toBe(400);
    expect(notArray.body.error_code).toBe('invalid_request');
    const empty = await call({ enrollment_ids: [] });
    expect(empty.status, JSON.stringify(empty.body)).toBe(400);
    expect(empty.body.error_code).toBe('invalid_request');
    const tooMany = await call({ enrollment_ids: Array.from({ length: 101 }, () => randomUUID()) });
    expect(tooMany.status, JSON.stringify(tooMany.body)).toBe(400);
    expect(tooMany.body.error_code).toBe('too_many');

    const mixed = await call({ enrollment_ids: ['abc', enrA.enrollmentId, enrB.enrollmentId] });
    expect(mixed.status, JSON.stringify(mixed.body)).toBe(200);
    expect(resultOf(mixed.body, 'abc')).toEqual(expect.objectContaining({ outcome: 'error', message: NOT_FOUND_MESSAGE }));
    expect(resultOf(mixed.body, enrA.enrollmentId)?.outcome).toBe('resumed');
    expect(resultOf(mixed.body, enrB.enrollmentId)).toEqual(expect.objectContaining({ outcome: 'error', message: NOT_FOUND_MESSAGE }));
    expect((await enrRow(enrB.enrollmentId)).status, 'inscription de l’autre organisation intacte').toBe('paused');

    const noReasons = await call({ sequence_id: sequenceId });
    expect(noReasons.status, JSON.stringify(noReasons.body)).toBe(400);
    const unknownReason = await call({ sequence_id: sequenceId, pause_reasons: ['foo'] });
    expect(unknownReason.status, JSON.stringify(unknownReason.body)).toBe(400);
    const foreignSeq = await call({ sequence_id: seqB.sequenceId, pause_reasons: ['manual'] });
    expect(foreignSeq.status, JSON.stringify(foreignSeq.body)).toBe(404);
    expect((await enrRow(enrB.enrollmentId)).status).toBe('paused');
  });
});

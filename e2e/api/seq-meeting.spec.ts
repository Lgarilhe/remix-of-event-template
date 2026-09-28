/**
 * Lot « meeting » : arrêt des séquences sur rendez-vous (option
 * stop_conditions.on_meeting_booked du moteur process-sequences) et webhook
 * calendly-webhook exécuté pour de vrai.
 *
 * Contrat : CLAUDE.md « Séquences : règles du moteur et de l'interface »
 * (clôture = RDV, reprise d'une inscription close = re_enroll) ; registre de
 * l'audit 2026-09-25 : SEQ-008 (« Calendly : arrêt des séquences sans filtre
 * d'organisation, par sous-chaîne d'URL ou sans filtre de profil », corrigé),
 * SEQ-220 (re_enrolled_at), D4.
 *
 * Le moteur tourne contre la stack locale (e2e/local-stack) ; LinkedIn et l'IA
 * sont simulés par vendor-mock.mjs. Ignoré sans cette stack. `force: true`
 * lève la fenêtre d'envoi (aujourd'hui dimanche).
 *
 * Non couverts ici (voir le rapport) : les cas de backfill-calendly, dont les
 * appels à l'API Calendly ne portent aucun account_id et ne se scriptent que
 * par la clé '*' du faux prestataire, interdite sur la stack partagée.
 */
import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { E2E } from '../helpers/env';
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
  callFunction,
  engineAvailable,
  enroll,
  messageSequence,
  minutesFromNow,
  mockCalls,
  rand,
  runCycle,
  schedule,
  sendingOrg,
  sentInvites,
  sentTexts,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
// Mode série dans chaque bloc d'un seul test : un défaut attendu ne bloque pas les tests suivants.
test.setTimeout(240_000);

// ─── Textes du contrat ──────────────────────────────────────────────────────
const MEETING_STOP_REASON = 'Stop condition: meeting booked (Calendly)';
const CALENDLY_EVENT_NAME = '📅 20 min pour présentation poste - Equipe Konekt';
const CALENDLY_KEY = process.env.E2E_CALENDLY_SIGNING_KEY ?? '';
const DAY = 24 * 60;
const STOP_ON_MEETING = { on_reply: true, on_unsubscribe: true, on_click: false, on_meeting_booked: true };

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
test.afterEach(async () => {
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    for (const table of ['qualification_sessions', 'notifications', 'job_candidate_status', 'organization_integrations']) {
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

// ─── Seeds ──────────────────────────────────────────────────────────────────

/** Séquence de messages avec l'option « Arrêter si un rendez-vous est pris ». */
async function meetingSequence(org: TestOrg, createdBy: string, templates: string[], opts: { aiFirstStep?: boolean } = {}) {
  const seeded = await messageSequence(org, createdBy, templates);
  const { error } = await admin().from('outreach_sequences').update({ stop_conditions: STOP_ON_MEETING }).eq('id', seeded.sequenceId);
  if (error) throw new Error(`stop_conditions: ${error.message}`);
  if (opts.aiFirstStep) {
    const { error: aiErr } = await admin().from('sequence_steps').update({ use_ai_personalization: true }).eq('id', seeded.steps[0].id);
    if (aiErr) throw new Error(`use_ai_personalization: ${aiErr.message}`);
  }
  return seeded;
}

/** Session de qualification (rendez-vous) dans l'organisation. */
async function insertMeeting(orgId: string, createdBy: string, fields: Record<string, unknown>) {
  const { data, error } = await admin().from('qualification_sessions').insert({
    organization_id: orgId,
    created_by: createdBy,
    calendly_event_id: `evt_meeting_${rand()}${rand()}`,
    event_name: CALENDLY_EVENT_NAME,
    status: 'scheduled',
    ...fields,
  }).select('id').single();
  if (error || !data) throw new Error(`qualification_sessions: ${error?.message}`);
  return data.id as string;
}

async function setIntegration(orgId: string, patch: Record<string, unknown>) {
  const { error } = await admin().from('organization_integrations')
    .upsert({ organization_id: orgId, ...patch }, { onConflict: 'organization_id' });
  if (error) throw new Error(`organization_integrations: ${error.message}`);
}

async function jcs(orgId: string, createdBy: string, candidateId: string, o: Record<string, unknown> = {}) {
  const { data, error } = await admin().from('job_candidate_status').insert({
    job_id: `job_meeting_${rand()}`, candidate_id: candidateId, created_by: createdBy, organization_id: orgId,
    candidate_name: 'Camille Martin', status: 'contacted', pipeline_stage: 'Contacté', ...o,
  }).select('id').single();
  if (error || !data) throw new Error(`jcs: ${error?.message}`);
  return data.id as string;
}

// ─── Lectures ───────────────────────────────────────────────────────────────
type Enr = { status: string; completed_at: string | null; current_step_order: number; tracking_data: Record<string, unknown> | null };
async function enr(id: string): Promise<Enr> {
  const { data, error } = await admin().from('sequence_enrollments')
    .select('status, completed_at, current_step_order, tracking_data').eq('id', id).single();
  if (error || !data) throw new Error(`enr ${id}: ${error?.message}`);
  return data as Enr;
}
type Exec = { id: string; step_order: number; status: string; scheduled_at: string; skip_reason: string | null };
async function execsOf(enrollmentId: string): Promise<Exec[]> {
  const { data } = await admin().from('sequence_step_executions')
    .select('id, step_order, status, scheduled_at, skip_reason').eq('enrollment_id', enrollmentId)
    .order('created_at', { ascending: true });
  return (data ?? []) as Exec[];
}
async function execRow(id: string): Promise<Exec> {
  const { data, error } = await admin().from('sequence_step_executions')
    .select('id, step_order, status, scheduled_at, skip_reason').eq('id', id).single();
  if (error || !data) throw new Error(`exec ${id}: ${error?.message}`);
  return data as Exec;
}
/** Appels au modèle IA dont la requête contient `marker` (les appels IA n'ont pas d'account_id). */
async function aiCallsWith(marker: string) {
  return (await mockCalls()).filter((c) => c.method === 'POST' && c.path === '/v1/messages' && JSON.stringify(c.body).includes(marker));
}
/** Envois LinkedIn (nouvelle conversation, suite, invitation) depuis ce compte. */
async function sendsFrom(accountId: string) {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST'
    && (c.path === '/api/v1/chats' || /^\/api\/v1\/chats\/[^/]+\/messages$/.test(c.path) || c.path === '/api/v1/users/invite'));
}

/**
 * Cycles jusqu'à ce que ces exécutions ne soient plus échues en attente : le
 * moteur plafonne les actions visibles par compte et par cycle (SEQ-187), une
 * quatrième exécution du même compte attend le cycle suivant.
 */
async function cycleFor(...execIds: string[]) {
  for (let i = 0; i < 5; i++) {
    await runCycle();
    const { data } = await admin().from('sequence_step_executions').select('id, status, scheduled_at').in('id', execIds);
    const pending = ((data ?? []) as Array<{ status: string; scheduled_at: string }>)
      .filter((r) => r.status === 'scheduled' && new Date(r.scheduled_at).getTime() <= Date.now());
    if (pending.length === 0) return;
  }
}

/** Rendez-vous Calendly signé (t=…,v1=HMAC(t.body)). */
async function calendlyBooking(linkedinAnswer: string, eventId: string) {
  const body = {
    event: 'invitee.created',
    payload: {
      uri: `https://api.calendly.com/scheduled_events/${eventId}/invitees/inv_${rand()}`,
      email: `camille.${rand()}@e2e.konekt.test`,
      name: 'Camille Martin',
      questions_and_answers: [{ question: 'Votre profil LinkedIn', answer: linkedinAnswer }],
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
    headers: { apikey: E2E.anonKey, 'Content-Type': 'application/json', 'Calendly-Webhook-Signature': `t=${t},v1=${sig}` },
    body: raw,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

// ════════════════════════════════════════════════════════════════════════════
// Garde du moteur : rendez-vous du candidat
// ════════════════════════════════════════════════════════════════════════════
test.describe('Garde « rendez-vous pris » du moteur', () => {
  test.describe('arret-par-identifiant-profil', () => {
    test.describe.configure({ mode: 'serial' });
    // arret-par-identifiant-profil
    test('@critical option active : un rendez-vous du même profile_id dans l’organisation arrête la séquence avant tout appel (ni IA ni LinkedIn), inscription « completed »', async () => {
      const { org, accountId } = await trackedSendingOrg('E2E meeting profil');
      // Témoin : même organisation, second compte, séquence IA sans rendez-vous :
      // prouve que l'étape appelle bien l'IA quand la garde ne l'arrête pas.
      const member = await addMember(org.orgId, 'member', 'meeting');
      orgsToDelete[orgsToDelete.length - 1].extra.push(member);
      const controlAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_${rand()}`, 'OK');

      const stopMarker = `MQSTOP${rand()}${rand()}`;
      const controlMarker = `MQCTRL${rand()}${rand()}`;
      const stopped = await meetingSequence(org, org.owner.userId, [`Bonjour {{prenom}} ${stopMarker}`], { aiFirstStep: true });
      const control = await meetingSequence(org, member.userId, [`Bonjour {{prenom}} ${controlMarker}`], { aiFirstStep: true });
      const target = await enroll(org, stopped.sequenceId, org.owner.userId, accountId);
      const witness = await enroll(org, control.sequenceId, member.userId, controlAccount);
      // Rendez-vous réservé après l'inscription, même profil, même organisation.
      await insertMeeting(org.orgId, org.owner.userId, { candidate_profile_id: target.profileId });

      const stoppedExec = await schedule(org, target.enrollmentId, stopped.steps[0]);
      const witnessExec = await schedule(org, witness.enrollmentId, control.steps[0]);
      const cycle = await runCycle();
      await cycleFor(stoppedExec, witnessExec);

      const row = await execRow(stoppedExec);
      // Décision 28 : l'étape arrêtée par le rendez-vous est annulée (une clôture annule).
      expect(row.status, 'étape arrêtée par le rendez-vous, jamais envoyée').toBe('cancelled');
      expect(row.skip_reason ?? '').toMatch(/^Stop condition: meeting booked/);
      const closed = await enr(target.enrollmentId);
      expect(closed.status, 'inscription close').toBe('completed');
      expect(closed.completed_at, 'date de clôture').not.toBeNull();
      expect(Number((cycle.results as Record<string, number> | undefined)?.skipped ?? 0)).toBeGreaterThanOrEqual(1);

      expect(await mockCalls(accountId), 'aucun appel LinkedIn depuis le compte de l’inscription arrêtée').toEqual([]);
      expect(await aiCallsWith(stopMarker), 'aucun appel IA pour l’étape arrêtée').toEqual([]);
      expect((await aiCallsWith(controlMarker)).length, 'témoin : la même étape sans rendez-vous appelle l’IA').toBeGreaterThan(0);
    });
  });

  test.describe('arret-par-url-exacte-variantes', () => {
    test.describe.configure({ mode: 'serial' });
    // arret-par-url-exacte-variantes
    test('option active : une session dont l’URL désigne exactement le même slug arrête la séquence, quelle que soit la variante (/ final, fr., majuscules, sans schéma, ?utm_source=share)', async () => {
      const { org, accountId } = await trackedSendingOrg('E2E meeting variantes');
      const { sequenceId, steps } = await meetingSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
      const slugs = [`ana-${rand()}`, `bruno-${rand()}`, `chloe-${rand()}`, `david-${rand()}`];
      const variants = [
        `https://fr.linkedin.com/in/${slugs[0]}/`,
        `https://www.linkedin.com/in/${slugs[1].toUpperCase()}`,
        `linkedin.com/in/${slugs[2]}`,
        `https://www.linkedin.com/in/${slugs[3]}?utm_source=share&utm_medium=ios_app`,
      ];
      const enrollments: string[] = [];
      for (const slug of slugs) {
        const e = await enroll(org, sequenceId, org.owner.userId, accountId, { profile_url: `https://www.linkedin.com/in/${slug}` });
        enrollments.push(e.enrollmentId);
      }
      // Sessions sans identifiant de profil : seule l'URL peut les rattacher.
      for (const url of variants) await insertMeeting(org.orgId, org.owner.userId, { candidate_linkedin_url: url });

      const execIds: string[] = [];
      for (const id of enrollments) execIds.push(await schedule(org, id, steps[0]));
      await cycleFor(...execIds);

      for (const [i, id] of enrollments.entries()) {
        expect((await enr(id)).status, `variante ${variants[i]} : inscription close`).toBe('completed');
        expect((await execRow(execIds[i])).skip_reason, `variante ${variants[i]}`).toBe(MEETING_STOP_REASON);
      }
      expect(await sendsFrom(accountId), 'aucun envoi').toEqual([]);
    });
  });

  test.describe('slug-prefixe-ne-declenche-pas', () => {
    test.describe.configure({ mode: 'serial' });
    // slug-prefixe-ne-declenche-pas
    test('un rendez-vous de « camille-martin-4b2a1 » n’arrête pas la séquence de « camille » : aucune correspondance par préfixe', async () => {
      const { org, accountId } = await trackedSendingOrg('E2E meeting préfixe');
      const { sequenceId, steps } = await meetingSequence(org, org.owner.userId, ['Bonjour Camille', 'Relance']);
      // Slug unique par test (registre RGPD global par URL) : « camille<x> » et « camille<x>-martin-4b2a1 ».
      const slug = `camille${rand()}`;
      const camille = await enroll(org, sequenceId, org.owner.userId, accountId, { profile_url: `https://www.linkedin.com/in/${slug}` });
      await insertMeeting(org.orgId, org.owner.userId, {
        candidate_profile_id: `ACoAAOTHER${rand()}`,
        candidate_linkedin_url: `https://www.linkedin.com/in/${slug}-martin-4b2a1`,
      });
      const execId = await schedule(org, camille.enrollmentId, steps[0]);
      await cycleFor(execId);

      const row = await execRow(execId);
      // DÉFAUT seq-meeting-slug-prefixe : le moteur cherche ilike '%<slug>%' (process-sequences/index.ts:1774), le rendez-vous d'un autre profil clôt la séquence de Camille.
      expect(row.skip_reason, 'pas d’arrêt « meeting booked »').not.toBe(MEETING_STOP_REASON);
      expect(row.status, 'le premier message part').toBe('sent');
      expect(await sentTexts(accountId)).toEqual(['Bonjour Camille']);
      expect((await enr(camille.enrollmentId)).status, 'inscription toujours active').toBe('active');
    });
  });

  test.describe('slug-infixe-ne-declenche-pas', () => {
    test.describe.configure({ mode: 'serial' });
    // slug-infixe-ne-declenche-pas
    test('le slug « martin » n’est arrêté ni par le rendez-vous de « jean-martin-77 » ni par une page entreprise linkedin.com/company/martin', async () => {
      // Slug unique par test (registre RGPD global par URL) : « martin<x> ».
      const slug = `martin${rand()}`;
      const cases = [
        { label: 'profil jean-martin-77', meetingUrl: `https://www.linkedin.com/in/jean-${slug}-77` },
        { label: 'page entreprise company/martin', meetingUrl: `https://www.linkedin.com/company/${slug}` },
      ];
      // Une organisation par cas : la garde ne lit que les sessions de l'organisation.
      const seeded: Array<{ label: string; accountId: string; enrollmentId: string; execId?: string; step: SeededStep; org: TestOrg }> = [];
      for (const c of cases) {
        const { org, accountId } = await trackedSendingOrg(`E2E meeting infixe ${c.label}`);
        const { sequenceId, steps } = await meetingSequence(org, org.owner.userId, ['Bonjour Martin', 'Relance']);
        const e = await enroll(org, sequenceId, org.owner.userId, accountId, { profile_url: `https://www.linkedin.com/in/${slug}` });
        await insertMeeting(org.orgId, org.owner.userId, { candidate_profile_id: `ACoAAOTHER${rand()}`, candidate_linkedin_url: c.meetingUrl });
        seeded.push({ label: c.label, accountId, enrollmentId: e.enrollmentId, step: steps[0], org });
      }
      for (const s of seeded) s.execId = await schedule(s.org, s.enrollmentId, s.step);
      await cycleFor(...seeded.map((s) => s.execId!));

      for (const s of seeded) {
        const row = await execRow(s.execId!);
        // DÉFAUT seq-meeting-slug-infixe : motif '%martin%' en infixe (process-sequences/index.ts:1771-1775), toute URL contenant « martin » clôt la séquence.
        // Assertions souples : chaque cas (profil, page entreprise) est rapporté.
        expect.soft(row.skip_reason, `${s.label} : pas d’arrêt « meeting booked »`).not.toBe(MEETING_STOP_REASON);
        expect.soft(row.status, `${s.label} : le message part`).toBe('sent');
        expect.soft(await sentTexts(s.accountId), s.label).toEqual(['Bonjour Martin']);
        expect.soft((await enr(s.enrollmentId)).status, `${s.label} : inscription active`).toBe('active');
      }
    });
  });

  test.describe('rdv-reserve-apres-inscription-arrete', () => {
    test.describe.configure({ mode: 'serial' });
    // rdv-reserve-apres-inscription-arrete
    test('un rendez-vous réservé après le début de l’inscription, fixé dans 7 jours, arrête la séquence au passage suivant', async () => {
      const { org, accountId } = await trackedSendingOrg('E2E meeting futur');
      const { sequenceId, steps } = await meetingSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
      const e = await enroll(org, sequenceId, org.owner.userId, accountId, { created_at: minutesFromNow(-2 * DAY) });
      await insertMeeting(org.orgId, org.owner.userId, {
        candidate_profile_id: e.profileId,
        status: 'scheduled',
        event_start_at: minutesFromNow(7 * DAY),
        event_end_at: minutesFromNow(7 * DAY + 20),
      });
      const execId = await schedule(org, e.enrollmentId, steps[0]);
      await cycleFor(execId);

      expect((await execRow(execId)).skip_reason).toBe(MEETING_STOP_REASON);
      const closed = await enr(e.enrollmentId);
      expect(closed.status).toBe('completed');
      expect(closed.completed_at).not.toBeNull();
      expect(await sendsFrom(accountId), 'aucun envoi').toEqual([]);
    });
  });

  test.describe('re-enroll-pas-reclos-par-ancien-rdv', () => {
    test.describe.configure({ mode: 'serial' });
    // re-enroll-pas-reclos-par-ancien-rdv
    test('après « Relancer » (re_enroll) d’une inscription close pour rendez-vous, l’ancien rendez-vous ne la reclôt pas : l’étape suivante part', async () => {
      const { org, accountId } = await trackedSendingOrg('E2E meeting relance');
      const { sequenceId, steps } = await meetingSequence(org, org.owner.userId, ['Bonjour', 'Relance 1', 'Relance 2']);
      const e = await enroll(org, sequenceId, org.owner.userId, accountId);
      await insertMeeting(org.orgId, org.owner.userId, { candidate_profile_id: e.profileId });
      const firstExec = await schedule(org, e.enrollmentId, steps[0]);
      await cycleFor(firstExec);
      expect((await enr(e.enrollmentId)).status, 'close par la garde').toBe('completed');

      // Le recruteur relance explicitement le candidat.
      const token = (await signIn(org.owner.email, org.owner.password)).access_token;
      const res = await callFunction('process-sequences', token, { action: 're_enroll', organization_id: org.orgId, enrollment_ids: [e.enrollmentId] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(JSON.stringify(res.body)).toContain('"outcome":"resumed"');
      const relaunched = await enr(e.enrollmentId);
      expect(relaunched.status).toBe('active');
      expect(relaunched.tracking_data?.re_enrolled_at, 're_enrolled_at posé').toBeTruthy();
      const pending = (await execsOf(e.enrollmentId)).filter((x) => x.status === 'scheduled');
      expect(pending, 'une étape replanifiée').toHaveLength(1);

      // L'étape replanifiée devient échue.
      await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', pending[0].id);
      await cycleFor(pending[0].id);

      const row = await execRow(pending[0].id);
      // DÉFAUT seq-meeting-reclot-apres-relance : la garde ignore tracking_data.re_enrolled_at (process-sequences/index.ts:1748-1778), l'ancienne session reclôt aussitôt l'inscription relancée.
      expect(row.skip_reason, 'pas de reclôture par l’ancien rendez-vous').not.toBe(MEETING_STOP_REASON);
      expect(row.status, 'l’étape part').toBe('sent');
      expect(await sentTexts(accountId), 'un message envoyé').toHaveLength(1);
      expect((await enr(e.enrollmentId)).status, 'inscription active').toBe('active');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// calendly-webhook exécuté
// ════════════════════════════════════════════════════════════════════════════
test.describe('Webhook Calendly : correspondance exacte', () => {
  test.describe('webhook-correspondance-exacte-executee', () => {
    test.describe.configure({ mode: 'serial' });
    // webhook-correspondance-exacte-executee
    test('un rendez-vous pour /in/<slug>?utm_source=share clôt /in/<slug> et /in/<slug>/, pas /in/<slug>-martin-4b2a1', async () => {
      const { org, accountId } = await trackedSendingOrg('E2E meeting webhook');
      await setIntegration(org.orgId, { calendly_connected: true });
      const slug = `camille${rand()}`;
      const trackedCandidateId = `ACoAAE2EJCS${rand()}${rand()}`;
      await jcs(org.orgId, org.owner.userId, trackedCandidateId, { linkedin_profile_url: `https://www.linkedin.com/in/${slug}` });
      const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
      // Identifiants de profil tous différents du candidate_id suivi : seule l'URL rattache.
      const exact = await enroll(org, sequenceId, org.owner.userId, accountId, { profile_url: `https://www.linkedin.com/in/${slug}` });
      // Décision 21 : même slug = même personne, refusée deux fois dans une séquence ; la seconde inscription va dans une autre séquence de l'organisation.
      const slashSeq = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
      const slash = await enroll(org, slashSeq.sequenceId, org.owner.userId, accountId, { profile_url: `https://www.linkedin.com/in/${slug}/` });
      const longer = await enroll(org, sequenceId, org.owner.userId, accountId, { profile_url: `https://www.linkedin.com/in/${slug}-martin-4b2a1` });
      const later = minutesFromNow(DAY);
      const execExact = await schedule(org, exact.enrollmentId, steps[0], { scheduled_at: later });
      const execSlash = await schedule(org, slash.enrollmentId, slashSeq.steps[0], { scheduled_at: later });
      const execLonger = await schedule(org, longer.enrollmentId, steps[0], { scheduled_at: later });

      const eventId = `evt_meeting_${rand()}`;
      const res = await calendlyBooking(`https://www.linkedin.com/in/${slug}?utm_source=share`, eventId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sequences_stopped, 'deux inscriptions closes').toBe(2);

      for (const [label, id, execId] of [['exacte', exact.enrollmentId, execExact], ['/ final', slash.enrollmentId, execSlash]] as const) {
        const row = await enr(id);
        expect(row.status, `${label} : close`).toBe('completed');
        expect(row.tracking_data?.completion_reason, label).toBe('meeting_booked');
        expect((await execRow(execId)).status, `${label} : étape annulée`).toBe('cancelled');
      }
      expect((await enr(longer.enrollmentId)).status, 'slug plus long : inscription intacte').toBe('active');
      expect((await execRow(execLonger)).status, 'slug plus long : étape gardée').toBe('scheduled');

      const { data: sessions } = await admin().from('qualification_sessions').select('organization_id').eq('calendly_event_id', eventId);
      expect(sessions, 'session créée dans l’organisation').toEqual([{ organization_id: org.orgId }]);
      const { data: notifs } = await admin().from('notifications').select('user_id, type, metadata').eq('organization_id', org.orgId).eq('type', 'action');
      expect(notifs ?? [], 'le recruteur est prévenu').toHaveLength(1);
      expect(notifs![0].user_id).toBe(org.owner.userId);
      expect(((notifs![0].metadata as Record<string, unknown>).enrollment_ids as string[]).sort())
        .toEqual([exact.enrollmentId, slash.enrollmentId].sort());
      expect(await sentInvites(accountId)).toEqual([]);
    });
  });
});

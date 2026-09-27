/**
 * Moteur de séquences, lot « engine-2 » : gardes avant envoi (rendez-vous,
 * canaux fermés, heures d'envoi, conditions, attentes, aucun message
 * précédent, texte vide), rotation des expéditeurs, quotas (journal, InMail),
 * IA indisponible, budget du cycle, issues d'envoi (4xx, 429, compte
 * déconnecté, invitation inutile), auto-pause, planification de l'étape
 * suivante (date, fin de séquence, variantes A/B).
 *
 * Contrat : CLAUDE.md, « Séquences : règles du moteur et de l'interface », et
 * docs/audit-2026-09-25-sequences.md (D1-D6, SEQ-xxx). Chaque test cite la clé
 * du comportement de l'inventaire qu'il couvre.
 *
 * Le moteur process-sequences tourne pour de vrai contre la stack locale
 * (e2e/local-stack) ; LinkedIn, l'IA et l'e-mail sont simulés par
 * vendor-mock.mjs, qui journalise chaque appel. Ignoré sans cette stack.
 *
 * Limite du faux prestataire : il rattache un appel à un compte par le
 * paramètre account_id. La lecture des messages d'une conversation et l'envoi
 * dans une conversation existante n'en portent pas : l'identifiant de
 * conversation renvoyé porte « ?account_id=<compte>&c= », que le moteur insère
 * tel quel dans l'URL (voir scriptedChat()).
 *
 * `force: true` lève la fenêtre d'envoi (jours ouvrés 8 h-19 h) ; seul le test
 * des heures d'envoi tourne sans. Les cycles passent par engine() : un cycle
 * avec des délais simulés dépasse les 30 s par défaut d'une requête Playwright.
 */
import { test, expect, request } from '@playwright/test';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedLinkedInAccount,
  seedMission,
  type SeededStep,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  CRON_SECRET,
  ENGINE_SKIP_REASON,
  engineAvailable,
  enroll,
  executionsOf,
  minutesFromNow,
  mockCalls,
  rand,
  schedule,
  sendingOrg,
  sentInvites,
  sentTexts,
  setMockMode,
  type MockCall,
  type MockRoute,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const mockedAccounts: string[] = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];
const track = (org: TestOrg, extra: TestUser[] = []) => { orgsToDelete.push({ org, extra }); return org; };

test.afterEach(async () => {
  while (mockedAccounts.length) await setMockMode(mockedAccounts.pop()!, {}).catch(() => undefined);
  while (cleanups.length) {
    const cleanup = cleanups.pop()!;
    try { await cleanup(); } catch { /* nettoyage au mieux */ }
  }
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    await admin().from('member_quotas').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, extra);
  }
});

// ─── Aides ──────────────────────────────────────────────────────────────────

const MIN = 60_000;
const DAY = 24 * 3600_000;

/** Action du moteur avec le secret du cron, délai de requête long, réessai tant que le verrou est pris. */
async function engine(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const ctx = await request.newContext();
    const res = await ctx.post(`${E2E.supabaseUrl}/functions/v1/process-sequences`, {
      headers: { apikey: E2E.anonKey, Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' },
      data: body,
      timeout: 150_000,
    });
    const status = res.status();
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    await ctx.dispose();
    expect(status, JSON.stringify(json)).toBe(200);
    if (json.skipped_reason !== 'lock_held') return json;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('verrou du moteur jamais libéré');
}

const cycle = (force = true) => engine({ action: 'process', force });

async function mock(accountId: string, mode: { routes?: MockRoute[]; [k: string]: unknown }) {
  mockedAccounts.push(accountId);
  await setMockMode(accountId, mode);
}

interface StepSpec {
  action_type: string;
  step_order?: number;
  message_template?: string | null;
  subject_template?: string | null;
  delay_days?: number;
  condition_type?: string | null;
  wait_for_event?: string | null;
  use_ai_personalization?: boolean;
  ends_sequence?: boolean;
  variant_group?: string | null;
  variant_weight?: number | null;
}

/** Séquence et étapes insérées une à une (ordre garanti, variantes au même rang possibles). */
async function insertSequence(org: TestOrg, createdBy: string, specs: StepSpec[], extra: Record<string, unknown> = {}) {
  const { data: seq, error } = await admin()
    .from('outreach_sequences')
    .insert({ name: `Séquence e2e ${rand()}`, organization_id: org.orgId, created_by: createdBy, is_active: true, ...extra })
    .select('id')
    .single();
  if (error || !seq) throw new Error(`insertSequence: ${error?.message}`);
  const steps: SeededStep[] = [];
  for (const [i, s] of specs.entries()) {
    const { data, error: stepErr } = await admin()
      .from('sequence_steps')
      .insert({ sequence_id: seq.id, step_order: s.step_order ?? i, delay_days: 0, message_template: null, ...s })
      .select('id, step_order, action_type')
      .single();
    if (stepErr || !data) throw new Error(`insertSequence(step ${i}): ${stepErr?.message}`);
    steps.push(data as SeededStep);
  }
  return { sequenceId: seq.id as string, steps };
}

/** Organisation qui envoie, avec `n` comptes LinkedIn reliés : propriétaire, puis un membre par compte. */
async function orgWithAccounts(prefix: string, n: number) {
  const { org, accountId } = await sendingOrg(prefix);
  const users: TestUser[] = [org.owner];
  const accounts: string[] = [accountId];
  const members: TestUser[] = [];
  for (let i = 1; i < n; i++) {
    const member = await addMember(org.orgId, 'member', `exp${i}`);
    members.push(member);
    users.push(member);
    accounts.push(await seedLinkedInAccount(org.orgId, member.userId, `acc_${rand()}`, 'OK'));
  }
  track(org, members);
  return { org, users, accounts };
}

async function sendingOrgTracked(prefix: string) {
  const res = await sendingOrg(prefix);
  track(res.org);
  return res;
}

interface ExecFull {
  id: string;
  step_id: string;
  step_order: number;
  status: string;
  scheduled_at: string;
  executed_at: string | null;
  final_message: string | null;
  skip_reason: string | null;
  error_message: string | null;
  retry_count: number | null;
  variant_assigned: string | null;
  tracking_data: Record<string, unknown> | null;
}

const EXEC_COLUMNS = 'id, step_id, step_order, status, scheduled_at, executed_at, final_message, skip_reason, error_message, retry_count, variant_assigned, tracking_data';

async function execRow(id: string): Promise<ExecFull> {
  const { data, error } = await admin().from('sequence_step_executions').select(EXEC_COLUMNS).eq('id', id).single();
  if (error || !data) throw new Error(`execRow ${id}: ${error?.message}`);
  return data as ExecFull;
}

async function execsOf(enrollmentId: string): Promise<ExecFull[]> {
  const { data } = await admin().from('sequence_step_executions').select(EXEC_COLUMNS)
    .eq('enrollment_id', enrollmentId).order('step_order').order('created_at');
  return (data ?? []) as ExecFull[];
}

async function enrollmentFull(id: string) {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('id, status, pause_reason, current_step_order, connection_status, assigned_sender_id, completed_at, replied_at')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`enrollmentFull ${id}: ${error?.message}`);
  return data as {
    id: string; status: string; pause_reason: string | null; current_step_order: number; connection_status: string | null;
    assigned_sender_id: string | null; completed_at: string | null; replied_at: string | null;
  };
}

async function sequenceActive(id: string): Promise<boolean> {
  const { data } = await admin().from('outreach_sequences').select('is_active').eq('id', id).single();
  return (data as { is_active: boolean }).is_active;
}

/** Lignes du journal des actions LinkedIn (plafond) pour un compte, d'un type ou de tous. */
async function ledgerCount(accountId: string, actionType?: string): Promise<number> {
  let q = admin().from('linkedin_action_log').select('id', { count: 'exact', head: true }).eq('account_id', accountId);
  if (actionType) q = q.eq('action_type', actionType);
  const { count, error } = await q;
  if (error) throw new Error(`ledgerCount: ${error.message}`);
  return count ?? 0;
}

async function postsOf(accountId: string): Promise<MockCall[]> {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST');
}

const isNewChatPost = (c: MockCall) => c.method === 'POST' && c.path === '/api/v1/chats';
const bodyOf = (c: MockCall) => (typeof c.body === 'object' && c.body ? c.body : {}) as Record<string, unknown>;

/** Conversation scriptable pour le compte : identifiant qui transporte account_id dans l'URL du moteur. */
function scriptedChat(accountId: string) {
  const base = `chat${rand()}${rand()}`;
  return { id: `${base}?account_id=${accountId}&c=`, path: `^/api/v1/chats/${base}$` };
}

const chatListRoute = (chatId: string): MockRoute => ({
  method: 'GET', path: '^/api/v1/chat_attendees/[^/]+/chats$',
  body: { object: 'ChatList', items: [{ id: chatId }], cursor: null },
});

const candidateReplyRoute = (chatPath: string, at: string): MockRoute => ({
  method: 'GET', path: chatPath,
  body: { object: 'MessageList', cursor: null, items: [{ id: `m_${rand()}`, is_sender: 0, text: 'Oui, avec plaisir', timestamp: at }] },
});

/** Date et heure murales dans un fuseau. weekday : 0 = dimanche. */
function localParts(d: Date | string, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(d));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdays[get('weekday')] ?? -1,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    y: Number(get('year')), m: Number(get('month')), d: Number(get('day')),
  };
}

/** Date locale (AAAA-MM-JJ) de `from` avancée de `days` jours du calendrier local. */
function localYmdPlus(from: Date, tz: string, days: number): string {
  const p = localParts(from, tz);
  return new Date(Date.UTC(p.y, p.m - 1, p.d + days)).toISOString().slice(0, 10);
}

const isWeekday = (weekday: number) => weekday >= 1 && weekday <= 5;

/**
 * Réplique de la boucle de scheduleNextStep (plage préférée [ps, pe[, jours
 * ouvrés) sans la gigue : { slot, moved }. Un créneau déplacé tombe à ps h
 * locale (+0 à 29 min de gigue côté moteur) ; sinon le créneau reste à
 * `from` (+0 à 2 min).
 */
function expectedPreferredSlot(from: Date, tz: string, ps = 9, pe = 18): { slot: Date; moved: boolean } {
  const atLocal = (y: number, m: number, d: number, h: number) => {
    // Instant de la date locale à h:00 dans tz (deux passes sur le décalage).
    const wall = Date.UTC(y, m - 1, d, h, 0);
    const offset = (ms: number) => { const p = localParts(new Date(ms), tz); return Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute) - Math.floor(ms / MIN) * MIN; };
    let guess = wall - offset(wall);
    guess = wall - offset(guess);
    return new Date(guess);
  };
  let slot = new Date(from);
  let moved = false;
  for (let i = 0; i < 7; i++) {
    const p = localParts(slot, tz);
    if (p.weekday === 6) { slot = atLocal(p.y, p.m, p.d + 2, ps); moved = true; continue; }
    if (p.weekday === 0) { slot = atLocal(p.y, p.m, p.d + 1, ps); moved = true; continue; }
    if (p.hour >= pe) { slot = atLocal(p.y, p.m, p.d + 1, ps); moved = true; continue; }
    if (p.hour < ps) { slot = atLocal(p.y, p.m, p.d, ps); moved = true; }
    break;
  }
  return { slot, moved };
}

async function insertMeeting(orgId: string, createdBy: string, fields: Record<string, unknown>) {
  const { data, error } = await admin().from('qualification_sessions').insert({
    organization_id: orgId, created_by: createdBy, calendly_event_id: `evt_${rand()}${rand()}`, status: 'scheduled', ...fields,
  }).select('id').single();
  if (error || !data) throw new Error(`qualification_sessions: ${error?.message}`);
  const id = data.id as string;
  cleanups.push(() => admin().from('qualification_sessions').delete().eq('id', id));
  return id;
}

const EMPTY_TEXT_ERROR = "Message vide : rien n'a été envoyé. Complétez le texte de l'étape puis relancez-la.";
const ROTATION_EXHAUSTED = 'Tous les expéditeurs ont atteint leur limite du jour';
const ACCOUNT_DISCONNECTED_SKIP = 'Compte LinkedIn déconnecté, reprise automatique à la reconnexion';

// ═══ Gardes avant envoi ═════════════════════════════════════════════════════

test.describe('Moteur engine-2 : gardes avant envoi', () => {
  // garde-rdv-calendly
  test("garde-rdv-calendly : un rendez-vous du candidat dans l'organisation arrête l'inscription, pas celui d'une autre organisation ni d'un autre candidat", async () => {
    const { org, accountId } = await sendingOrgTracked('E2E RDV');
    const other = track(await createOrg('agency', 'E2E RDV autre'));
    const { sequenceId, steps } = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ], { stop_conditions: { on_reply: true, on_unsubscribe: true, on_meeting_booked: true } });
    const slugA = `jean-${rand()}`;
    const slugB = `claire-${rand()}`;
    const slugC = `paul-${rand()}`;
    const a = await enroll(org, sequenceId, org.owner.userId, accountId, { profile_url: `https://www.linkedin.com/in/${slugA}/` });
    const b = await enroll(org, sequenceId, org.owner.userId, accountId, { profile_url: `https://www.linkedin.com/in/${slugB}/` });
    const c = await enroll(org, sequenceId, org.owner.userId, accountId, { profile_url: `https://www.linkedin.com/in/${slugC}/` });
    // d : sur un second compte de l'organisation (au plus trois envois par compte et par cycle).
    const memberD = await addMember(org.orgId, 'member', 'rdv');
    orgsToDelete.find((o) => o.org.orgId === org.orgId)!.extra.push(memberD);
    const accD = await seedLinkedInAccount(org.orgId, memberD.userId, `acc_${rand()}`, 'OK');
    const slugD = `lea-${rand()}`;
    const d = await enroll(org, sequenceId, memberD.userId, accD, { profile_url: `https://www.linkedin.com/in/${slugD}/` });

    // a : rendez-vous du même candidat, mais dans une autre organisation.
    await insertMeeting(other.orgId, other.owner.userId, {
      candidate_profile_id: a.profileId, candidate_linkedin_url: `https://www.linkedin.com/in/${slugA}`,
    });
    // b : rendez-vous du même candidat dans l'organisation de l'inscription.
    await insertMeeting(org.orgId, org.owner.userId, { candidate_profile_id: b.profileId });
    // c : rendez-vous d'un autre candidat dans la même organisation.
    await insertMeeting(org.orgId, org.owner.userId, {
      candidate_profile_id: `ACoAAOTHER${rand()}`, candidate_linkedin_url: `https://www.linkedin.com/in/autre-${rand()}`,
    });

    // d : rendez-vous du même candidat reconnu par son adresse LinkedIn (sans identifiant).
    await insertMeeting(org.orgId, org.owner.userId, { candidate_linkedin_url: `https://www.linkedin.com/in/${slugD}` });

    const execA = await schedule(org, a.enrollmentId, steps[0]);
    const execD = await schedule(org, d.enrollmentId, steps[0]);
    const execB = await schedule(org, b.enrollmentId, steps[0]);
    const execC = await schedule(org, c.enrollmentId, steps[0]);
    await cycle();

    const rowB = await execRow(execB);
    expect(rowB.status, 'étape arrêtée par le rendez-vous').toBe('skipped');
    expect(rowB.skip_reason).toBe('Stop condition: meeting booked (Calendly)');
    const enrB = await enrollmentFull(b.enrollmentId);
    expect(enrB.status).toBe('completed');
    expect(enrB.completed_at).not.toBeNull();
    expect((await execRow(execD)).skip_reason, 'même candidat reconnu par son adresse').toBe('Stop condition: meeting booked (Calendly)');
    expect((await enrollmentFull(d.enrollmentId)).status).toBe('completed');
    expect(await postsOf(accD)).toEqual([]);

    expect((await execRow(execA)).status, "RDV d'une autre organisation : l'envoi part").toBe('sent');
    expect((await execRow(execC)).status, "RDV d'un autre candidat : l'envoi part").toBe('sent');
    const sentTo = (await postsOf(accountId)).filter(isNewChatPost).map((p) => String(bodyOf(p).attendees_ids));
    expect(sentTo.sort()).toEqual([a.profileId, c.profileId].sort());
  });

  // garde-canaux-fermes
  test('garde-canaux-fermes : étapes e-mail et WhatsApp sautées sans aucun appel, le message LinkedIn suivant part comme premier message', async () => {
    const { org, accountId } = await sendingOrgTracked('E2E Canaux fermés');
    const email = await insertSequence(org, org.owner.userId, [
      { action_type: 'email', subject_template: 'Objet', message_template: 'Bonjour par e-mail' },
      { action_type: 'message', message_template: 'Bonjour après e-mail' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const whatsapp = await insertSequence(org, org.owner.userId, [
      { action_type: 'whatsapp_message', message_template: 'Bonjour WhatsApp' },
      { action_type: 'message', message_template: 'Bonjour après WhatsApp' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const e1 = await enroll(org, email.sequenceId, org.owner.userId, accountId, { email_used: `cand.${rand()}@e2e.konekt.test` });
    const e2 = await enroll(org, whatsapp.sequenceId, org.owner.userId, accountId, { phone_used: '+33612345678' });
    const x1 = await schedule(org, e1.enrollmentId, email.steps[0]);
    const x2 = await schedule(org, e2.enrollmentId, whatsapp.steps[0]);

    await cycle();

    const r1 = await execRow(x1);
    expect(r1.status).toBe('skipped');
    expect(r1.skip_reason).toBe('Étape e-mail pas encore disponible : étape sautée');
    const r2 = await execRow(x2);
    expect(r2.status).toBe('skipped');
    expect(r2.skip_reason).toBe('Étape WhatsApp pas encore disponible : étape sautée');
    // Aucun appel : ni fournisseur (journal du compte vide), ni sequence-send-email (aucune ligne de suivi).
    expect(await mockCalls(accountId), 'aucun appel au fournisseur pour une étape de canal fermé').toEqual([]);
    const { data: tracking } = await admin().from('sequence_email_tracking').select('id').in('execution_id', [x1, x2]);
    expect(tracking ?? []).toEqual([]);

    const next1 = (await execsOf(e1.enrollmentId)).filter((e) => e.step_order === 1);
    const next2 = (await execsOf(e2.enrollmentId)).filter((e) => e.step_order === 1);
    expect(next1.map((e) => e.status), 'étape suivante planifiée').toEqual(['scheduled']);
    expect(next2.map((e) => e.status)).toEqual(['scheduled']);

    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).in('id', [next1[0].id, next2[0].id]);
    await cycle();

    expect((await sentTexts(accountId)).sort(), 'le message LinkedIn part comme premier message').toEqual(['Bonjour après WhatsApp', 'Bonjour après e-mail'].sort());
    for (const [e, id] of [[e1, next1[0].id], [e2, next2[0].id]] as const) {
      const row = await execRow(id);
      expect(row.status).toBe('sent');
      expect(row.skip_reason).toBeNull();
      const enr = await enrollmentFull(e.enrollmentId);
      expect(enr.status, 'pas de clôture no_previous_message').toBe('active');
      expect(enr.current_step_order).toBe(2);
    }
  });

  // garde-heures-envoi-fuseau (+ quota-journal-apres-controles : report hors plage)
  test("garde-heures-envoi-fuseau : sans force, hors plage du titulaire (sinon de l'inscription), rien ne part ni n'est journalisé, report au prochain début de plage", async () => {
    const tokyo = 'Asia/Tokyo';
    // Plage du titulaire choisie pour exclure l'heure courante à Tokyo.
    const nowTokyo = localParts(new Date(), tokyo);
    const start = (nowTokyo.hour + 2) % 24;
    const end = start + 1;
    const { org: o1, accountId: acc1 } = await sendingOrgTracked('E2E Heures titulaire');
    const { error: mqErr } = await admin().from('member_quotas').insert({
      organization_id: o1.orgId, user_id: o1.owner.userId, business_hours_start: start, business_hours_end: end, timezone: tokyo,
    });
    expect(mqErr).toBeNull();
    const s1 = await insertSequence(o1, o1.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const e1 = await enroll(o1, s1.sequenceId, o1.owner.userId, acc1, { user_timezone: 'Europe/Paris' });

    // Sans réglage du titulaire : fuseau de l'inscription, plage par défaut 8 h-19 h
    // (fuseau choisi avec une heure de marge hors de la plage).
    const candidates = ['Asia/Tokyo', 'America/New_York', 'Pacific/Auckland', 'America/Los_Angeles', 'Asia/Kolkata'];
    const enrollmentTz = candidates.find((tz) => {
      const p = localParts(new Date(), tz);
      return !isWeekday(p.weekday) || p.hour < 7 || p.hour >= 19;
    })!;
    expect(enrollmentTz, 'un fuseau hors plage existe toujours').toBeTruthy();
    const { org: o2, accountId: acc2 } = await sendingOrgTracked('E2E Heures inscription');
    const s2 = await insertSequence(o2, o2.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const e2 = await enroll(o2, s2.sequenceId, o2.owner.userId, acc2, { user_timezone: enrollmentTz });

    const due = minutesFromNow(-1);
    const x1 = await schedule(o1, e1.enrollmentId, s1.steps[0], { scheduled_at: due });
    const x2 = await schedule(o2, e2.enrollmentId, s2.steps[0], { scheduled_at: due });
    const before = Date.now();
    await cycle(false);

    expect(await mockCalls(acc1), 'rien ne part hors plage').toEqual([]);
    expect(await mockCalls(acc2)).toEqual([]);
    expect(await ledgerCount(acc1), 'rien au plafond').toBe(0);
    expect(await ledgerCount(acc2)).toBe(0);

    const r1 = await execRow(x1);
    expect(r1.status).toBe('scheduled');
    const slot1 = new Date(r1.scheduled_at);
    expect(slot1.getTime()).toBeGreaterThan(before);
    const p1 = localParts(slot1, tokyo);
    expect(p1.hour, 'début de plage du titulaire, dans son fuseau').toBe(start);
    expect(p1.minute).toBeLessThan(30);
    expect(isWeekday(p1.weekday), 'jour ouvré local').toBe(true);
    expect(slot1.getTime()).toBeLessThan(before + 4 * DAY);

    const r2 = await execRow(x2);
    expect(r2.status).toBe('scheduled');
    const slot2 = new Date(r2.scheduled_at);
    expect(slot2.getTime()).toBeGreaterThan(before);
    const p2 = localParts(slot2, enrollmentTz);
    expect(p2.hour, `début de plage par défaut dans le fuseau de l'inscription (${enrollmentTz})`).toBe(8);
    expect(p2.minute).toBeLessThan(30);
    expect(isWeekday(p2.weekday)).toBe(true);

    // Avec force : l'envoi part, et une seule action est journalisée.
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).in('id', [x1, x2]);
    await cycle(true);
    expect(await sentTexts(acc1)).toEqual(['Bonjour']);
    expect(await sentTexts(acc2)).toEqual(['Bonjour']);
    expect(await ledgerCount(acc1, 'message'), 'témoin envoyé : exactement une ligne').toBe(1);
  });

  // garde-condition-lecture-impossible
  test('garde-condition-lecture-impossible : lecture du profil en échec, nouvel essai à 30 min puis échec après 3 essais, jamais sautée', async () => {
    const { org, accountId } = await sendingOrgTracked('E2E Condition illisible');
    await mock(accountId, { routes: [{ method: 'GET', path: '^/api/v1/users/', status: 503, body: { title: 'Service unavailable' } }] });
    const { sequenceId, steps } = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour', condition_type: 'if_connected' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const first = await enroll(org, sequenceId, org.owner.userId, accountId);
    const last = await enroll(org, sequenceId, org.owner.userId, accountId);
    const x1 = await schedule(org, first.enrollmentId, steps[0]);
    const x2 = await schedule(org, last.enrollmentId, steps[0], { retry_count: 3 });
    const before = Date.now();
    await cycle();
    const after = Date.now();

    const r1 = await execRow(x1);
    expect(r1.status, 'ni sautée ni routée').toBe('scheduled');
    expect(r1.retry_count).toBe(1);
    expect(r1.error_message).toBe('Lecture du profil LinkedIn impossible : nouvel essai 1/3 dans 30 min');
    expect(r1.skip_reason).toBeNull();
    const at1 = new Date(r1.scheduled_at).getTime();
    expect(at1).toBeGreaterThanOrEqual(before + 30 * MIN - 1_000);
    expect(at1).toBeLessThanOrEqual(after + 30 * MIN + 1_000);

    const r2 = await execRow(x2);
    expect(r2.status).toBe('failed');
    expect(r2.error_message).toBe("Lecture du profil LinkedIn impossible après plusieurs essais : relancez l'étape plus tard.");

    for (const e of [first, last]) {
      expect((await execsOf(e.enrollmentId)).length, 'aucune étape suivante planifiée').toBe(1);
      expect((await enrollmentFull(e.enrollmentId)).status).toBe('active');
    }
    expect(await postsOf(accountId)).toEqual([]);
  });

  // garde-etape-attente
  test("garde-etape-attente : attente sans wait_for_event, 'waiting_event' tant que rien n'arrive, franchie à la connexion, inscription « répondu » sur une réponse", async () => {
    // Connexion pas encore acceptée.
    const { org: o1, accountId: acc1 } = await sendingOrgTracked('E2E Attente 2e degré');
    await mock(acc1, { distance: 'SECOND_DEGREE' });
    const w1 = await insertSequence(o1, o1.owner.userId, [
      { action_type: 'wait_connection' },
      { action_type: 'message', message_template: 'Merci pour la connexion' },
    ]);
    const e1 = await enroll(o1, w1.sequenceId, o1.owner.userId, acc1);
    const x1 = await schedule(o1, e1.enrollmentId, w1.steps[0]);

    // Connexion constatée (premier degré), suite linéaire et suite par if_true_goto_step.
    const { org: o2, accountId: acc2 } = await sendingOrgTracked('E2E Attente 1er degré');
    const linear = await insertSequence(o2, o2.owner.userId, [
      { action_type: 'wait_connection' },
      { action_type: 'message', message_template: 'Merci pour la connexion' },
    ]);
    const goto = await insertSequence(o2, o2.owner.userId, [
      { action_type: 'wait_connection' },
      { action_type: 'message', message_template: 'Étape ignorée' },
      { action_type: 'message', message_template: 'Étape visée' },
    ]);
    await admin().from('sequence_steps').update({ if_true_goto_step: goto.steps[2].id }).eq('id', goto.steps[0].id);
    const e2 = await enroll(o2, linear.sequenceId, o2.owner.userId, acc2);
    const e3 = await enroll(o2, goto.sequenceId, o2.owner.userId, acc2);
    const x2 = await schedule(o2, e2.enrollmentId, linear.steps[0]);
    const x3 = await schedule(o2, e3.enrollmentId, goto.steps[0]);

    // Attente de réponse : le candidat a répondu après le premier message.
    const { org: o3, accountId: acc3 } = await sendingOrgTracked('E2E Attente réponse');
    const chat = scriptedChat(acc3);
    await mock(acc3, { routes: [chatListRoute(chat.id), candidateReplyRoute(chat.path, minutesFromNow(-5))] });
    const reply = await insertSequence(o3, o3.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'wait_reply' },
      { action_type: 'message', message_template: 'Relance', delay_days: 2 },
    ]);
    const e4 = await enroll(o3, reply.sequenceId, o3.owner.userId, acc3, { current_step_order: 1 });
    await schedule(o3, e4.enrollmentId, reply.steps[0], { status: 'sent', scheduled_at: minutesFromNow(-24 * 60), executed_at: minutesFromNow(-24 * 60) });
    const x4 = await schedule(o3, e4.enrollmentId, reply.steps[1]);

    await cycle();

    const r1 = await execRow(x1);
    expect(r1.status, 'connexion pas encore acceptée').toBe('waiting_event');
    const enr1 = await enrollmentFull(e1.enrollmentId);
    expect(enr1.connection_status).not.toBe('connected');
    expect(enr1.current_step_order).toBe(0);
    expect((await execsOf(e1.enrollmentId)).length).toBe(1);

    const r2 = await execRow(x2);
    expect(r2.status).toBe('sent');
    expect(r2.final_message).toBe('Attente franchie : wait_connection');
    const enr2 = await enrollmentFull(e2.enrollmentId);
    expect(enr2.current_step_order).toBe(1);
    expect(enr2.connection_status).toBe('connected');
    expect((await execsOf(e2.enrollmentId)).filter((e) => e.step_order === 1).map((e) => e.status)).toEqual(['scheduled']);

    expect((await execRow(x3)).status).toBe('sent');
    const next3 = (await execsOf(e3.enrollmentId)).filter((e) => e.id !== x3);
    expect(next3.map((e) => e.step_id), 'suite par if_true_goto_step').toEqual([goto.steps[2].id]);

    const enr4 = await enrollmentFull(e4.enrollmentId);
    expect(enr4.status, 'réponse constatée : inscription « répondu »').toBe('replied');
    const r4 = await execRow(x4);
    expect(r4.status).toBe('sent');
    expect((await execsOf(e4.enrollmentId)).some((e) => e.step_order === 2), 'aucune relance planifiée').toBe(false);

    for (const acc of [acc1, acc2, acc3]) expect(await postsOf(acc), 'une attente n’envoie rien').toEqual([]);
  });

  // garde-aucun-message-precedent (+ quota-journal-apres-controles : clôture no_previous_message)
  test("garde-aucun-message-precedent : relance close si le premier message a échoué ou a été annulé, part après un saut manuel", async () => {
    const { org, accountId } = await sendingOrgTracked('E2E Aucun message précédent');
    const { sequenceId, steps } = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance 1', delay_days: 3 },
      { action_type: 'message', message_template: 'Relance 2', delay_days: 3 },
    ]);
    const past = minutesFromNow(-2 * 24 * 60);
    const failed = await enroll(org, sequenceId, org.owner.userId, accountId);
    const cancelled = await enroll(org, sequenceId, org.owner.userId, accountId);
    const manual = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, failed.enrollmentId, steps[0], { status: 'failed', scheduled_at: past, executed_at: past, error_message: 'linkedin_send_failed_400' });
    await schedule(org, cancelled.enrollmentId, steps[0], { status: 'cancelled', scheduled_at: past, skip_reason: 'Annulée depuis le Journal' });
    await schedule(org, manual.enrollmentId, steps[0], { status: 'skipped', scheduled_at: past, executed_at: past, skip_reason: 'Manuellement sautée par le recruteur' });
    const laterFailed = await schedule(org, failed.enrollmentId, steps[2], { scheduled_at: minutesFromNow(2 * 24 * 60) });
    const xFailed = await schedule(org, failed.enrollmentId, steps[1]);
    const xCancelled = await schedule(org, cancelled.enrollmentId, steps[1]);
    const xManual = await schedule(org, manual.enrollmentId, steps[1]);

    await cycle();

    for (const [e, x] of [[failed, xFailed], [cancelled, xCancelled]] as const) {
      const row = await execRow(x);
      expect(row.status).toBe('skipped');
      expect(row.skip_reason).toBe('no_previous_message');
      expect((await enrollmentFull(e.enrollmentId)).status).toBe('completed');
    }
    expect((await execRow(laterFailed)).status, 'étapes en attente annulées').toBe('cancelled');

    const rowManual = await execRow(xManual);
    expect(rowManual.status, 'un saut manuel ne bloque pas la relance').toBe('sent');
    expect((await enrollmentFull(manual.enrollmentId)).status).toBe('active');
    expect(await sentTexts(accountId)).toEqual(['Relance 1']);
    expect(await ledgerCount(accountId, 'message'), 'seule la relance partie est journalisée').toBe(1);
  });

  // garde-texte-vide
  test('garde-texte-vide : un message sans texte échoue sans appel, une invitation sans note part', async () => {
    const { org: o1, accountId: acc1 } = await sendingOrgTracked('E2E Texte vide');
    const s1 = await insertSequence(o1, o1.owner.userId, [
      { action_type: 'message', message_template: '' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const e1 = await enroll(o1, s1.sequenceId, o1.owner.userId, acc1);
    // InMail avec objet mais sans texte, sur un second compte de la même organisation.
    const memberI = await addMember(o1.orgId, 'member', 'inmail');
    orgsToDelete.find((o) => o.org.orgId === o1.orgId)!.extra.push(memberI);
    const accI = await seedLinkedInAccount(o1.orgId, memberI.userId, `acc_${rand()}`, 'OK');
    const sI = await insertSequence(o1, o1.owner.userId, [
      { action_type: 'inmail', subject_template: 'Objet InMail', message_template: '   ' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const eI = await enroll(o1, sI.sequenceId, memberI.userId, accI);
    const x1 = await schedule(o1, e1.enrollmentId, s1.steps[0]);
    const xI = await schedule(o1, eI.enrollmentId, sI.steps[0]);

    const { org: o2, accountId: acc2 } = await sendingOrgTracked('E2E Invitation sans note');
    await mock(acc2, { distance: 'SECOND_DEGREE' });
    const s2 = await insertSequence(o2, o2.owner.userId, [
      { action_type: 'connection_request' },
      { action_type: 'message', message_template: 'Merci', delay_days: 3 },
    ]);
    const e2 = await enroll(o2, s2.sequenceId, o2.owner.userId, acc2);
    const x2 = await schedule(o2, e2.enrollmentId, s2.steps[0]);

    const res = await cycle();

    const r1 = await execRow(x1);
    expect(r1.status).toBe('failed');
    expect(r1.error_message).toBe(EMPTY_TEXT_ERROR);
    expect(r1.retry_count ?? 0).toBe(0);
    expect(await postsOf(acc1), 'aucun appel d’envoi').toEqual([]);
    const rI = await execRow(xI);
    expect(rI.status, 'InMail sans texte').toBe('failed');
    expect(rI.error_message).toBe(EMPTY_TEXT_ERROR);
    expect(await postsOf(accI)).toEqual([]);
    expect(Number((res.results as Record<string, number>).failed)).toBeGreaterThanOrEqual(2);

    const invites = await sentInvites(acc2);
    expect(invites).toHaveLength(1);
    expect(bodyOf(invites[0]).provider_id).toBe(e2.profileId);
    expect('message' in bodyOf(invites[0]), 'invitation sans note').toBe(false);
    expect((await execRow(x2)).status).toBe('sent');
  });
});

// ═══ Rotation des expéditeurs ═══════════════════════════════════════════════

test.describe('Moteur engine-2 : rotation des expéditeurs', () => {
  // rotation-attribution
  test("rotation-attribution : chaque inscription reçoit un compte du groupe enregistré avant l'envoi, la suite part du même compte ; une attente ne tire personne", async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E Rotation', 2);
    const [accA, accB] = accounts;
    // Les messages partent quel que soit le degré ; l'attente de connexion reste en attente.
    await mock(accA, { distance: 'SECOND_DEGREE' });
    await mock(accB, { distance: 'SECOND_DEGREE' });
    const rotation = {
      multi_sender_enabled: true,
      rotation_mode: 'round_robin',
      sender_accounts: [
        { account_id: accA, daily_limit: 50, channel: 'linkedin' },
        { account_id: accB, daily_limit: 50, channel: 'linkedin' },
      ],
    };
    const seq = await insertSequence(org, users[0].userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ], rotation);
    const waitSeq = await insertSequence(org, users[0].userId, [
      { action_type: 'wait_connection' },
      { action_type: 'message', message_template: 'Merci' },
    ], rotation);
    const e1 = await enroll(org, seq.sequenceId, users[0].userId, accA);
    const e2 = await enroll(org, seq.sequenceId, users[0].userId, accA);
    const e3 = await enroll(org, waitSeq.sequenceId, users[0].userId, accA);
    await schedule(org, e1.enrollmentId, seq.steps[0], { scheduled_at: minutesFromNow(-2) });
    await schedule(org, e2.enrollmentId, seq.steps[0], { scheduled_at: minutesFromNow(-1) });
    const xWait = await schedule(org, e3.enrollmentId, waitSeq.steps[0]);

    await cycle();

    const enr1 = await enrollmentFull(e1.enrollmentId);
    const enr2 = await enrollmentFull(e2.enrollmentId);
    expect([enr1.assigned_sender_id, enr2.assigned_sender_id].sort(), 'un compte du groupe chacun, le moins utilisé du jour').toEqual([accA, accB].sort());
    for (const [e, enr] of [[e1, enr1], [e2, enr2]] as const) {
      const posts = (await postsOf(enr.assigned_sender_id!)).filter(isNewChatPost);
      expect(posts.map((p) => String(bodyOf(p).attendees_ids)), 'message parti du compte enregistré').toEqual([e.profileId]);
    }
    expect(await ledgerCount(accA, 'message'), 'action journalisée sur le compte qui envoie').toBe(1);
    expect(await ledgerCount(accB, 'message')).toBe(1);

    expect((await execRow(xWait)).status).toBe('waiting_event');
    expect((await enrollmentFull(e3.enrollmentId)).assigned_sender_id, "une étape d'attente ne tire personne").toBeNull();

    // Étapes suivantes : même compte.
    const followUps = [
      ...(await execsOf(e1.enrollmentId)).filter((e) => e.step_order === 1),
      ...(await execsOf(e2.enrollmentId)).filter((e) => e.step_order === 1),
    ];
    expect(followUps).toHaveLength(2);
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).in('id', followUps.map((f) => f.id));
    await cycle();
    for (const [e, enr] of [[e1, enr1], [e2, enr2]] as const) {
      const posts = (await postsOf(enr.assigned_sender_id!)).filter(isNewChatPost);
      expect(posts.map((p) => String(bodyOf(p).text)), 'la relance part du même compte').toEqual(['Bonjour', 'Relance']);
      expect(posts.every((p) => String(bodyOf(p).attendees_ids) === e.profileId)).toBe(true);
      expect((await enrollmentFull(e.enrollmentId)).assigned_sender_id).toBe(enr.assigned_sender_id);
    }
  });

  // rotation-attribution (enregistrement avant l'envoi)
  test("rotation-attribution : l'expéditeur tiré est enregistré avant l'envoi, même quand l'envoi est refusé", async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E Rotation avant envoi', 2);
    const [accA, accB] = accounts;
    await mock(accB, { routes: [{ method: 'POST', path: '^/api/v1/chats$', status: 400, body: { title: 'Bad request' } }] });
    const seq = await insertSequence(org, users[0].userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ], { multi_sender_enabled: true, rotation_mode: 'round_robin', sender_accounts: [{ account_id: accB, daily_limit: 50, channel: 'linkedin' }] });
    const e = await enroll(org, seq.sequenceId, users[0].userId, accA);
    const x = await schedule(org, e.enrollmentId, seq.steps[0]);
    await cycle();

    expect((await enrollmentFull(e.enrollmentId)).assigned_sender_id, 'expéditeur enregistré avant l’envoi').toBe(accB);
    expect((await execRow(x)).status).toBe('failed');
    expect((await postsOf(accB)).filter(isNewChatPost).map((p) => String(bodyOf(p).attendees_ids))).toEqual([e.profileId]);
    expect(await mockCalls(accA), "rien depuis le compte de l'inscription").toEqual([]);
  });

  // rotation-indisponible
  test("rotation-indisponible : tous les expéditeurs au plafond du jour, étape bloquée jusqu'au lendemain sans envoi ; groupe sans compte relié, envoi depuis le compte de l'inscription", async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E Rotation pleine', 2);
    const [accA, accB] = accounts;
    const seq = await insertSequence(org, users[0].userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ], {
      multi_sender_enabled: true,
      rotation_mode: 'round_robin',
      sender_accounts: [
        { account_id: accA, daily_limit: 1, channel: 'linkedin' },
        { account_id: accB, daily_limit: 1, channel: 'linkedin' },
      ],
    });
    // Une action envoyée aujourd'hui par chaque expéditeur : limite du jour atteinte.
    const nowIso = new Date().toISOString();
    const x = await enroll(org, seq.sequenceId, users[0].userId, accA, { assigned_sender_id: accA, current_step_order: 1 });
    const y = await enroll(org, seq.sequenceId, users[1].userId, accB, { assigned_sender_id: accB, current_step_order: 1 });
    await schedule(org, x.enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: nowIso, executed_at: nowIso });
    await schedule(org, y.enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: nowIso, executed_at: nowIso });
    const z = await enroll(org, seq.sequenceId, users[0].userId, accA);

    // Groupe dont le seul compte appartient à une autre organisation.
    const { org: o2, accountId: acc2 } = await sendingOrgTracked('E2E Rotation vide');
    const foreign = track(await createOrg('agency', 'E2E Rotation étrangère'));
    const foreignAcc = await seedLinkedInAccount(foreign.orgId, foreign.owner.userId, `acc_${rand()}`, 'OK');
    const seq2 = await insertSequence(o2, o2.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour groupe vide' },
    ], { multi_sender_enabled: true, rotation_mode: 'round_robin', sender_accounts: [{ account_id: foreignAcc, daily_limit: 50, channel: 'linkedin' }] });
    const w = await enroll(o2, seq2.sequenceId, o2.owner.userId, acc2);

    const xz = await schedule(org, z.enrollmentId, seq.steps[0]);
    const xw = await schedule(o2, w.enrollmentId, seq2.steps[0]);
    await cycle();

    const rz = await execRow(xz);
    expect(rz.status).toBe('quota_blocked');
    expect(rz.skip_reason).toBe(ROTATION_EXHAUSTED);
    const at = localParts(rz.scheduled_at, 'Europe/Paris');
    expect(at.ymd, 'lendemain').toBe(localYmdPlus(new Date(), 'Europe/Paris', 1));
    expect([at.hour, at.minute], 'début de plage (8 h)').toEqual([8, 0]);
    expect(await postsOf(accA), 'jamais un envoi depuis le premier compte').toEqual([]);
    expect(await postsOf(accB)).toEqual([]);
    expect((await enrollmentFull(z.enrollmentId)).assigned_sender_id).toBeNull();

    expect((await execRow(xw)).status).toBe('sent');
    expect(await sentTexts(acc2), "envoi depuis le compte de l'inscription").toEqual(['Bonjour groupe vide']);
    expect(await mockCalls(foreignAcc), "rien depuis le compte d'une autre organisation").toEqual([]);
    expect((await enrollmentFull(w.enrollmentId)).assigned_sender_id).toBeNull();
  });

  // rotation-conversation-engagee
  test("rotation-conversation-engagee : conversation déjà engagée sans expéditeur, figée sur le compte de l'inscription, jamais de nouveau tirage", async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E Rotation engagée', 2);
    const [accA, accB] = accounts;
    const seq = await insertSequence(org, users[0].userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ], { multi_sender_enabled: true, rotation_mode: 'round_robin', sender_accounts: [{ account_id: accB, daily_limit: 50, channel: 'linkedin' }] });
    const e = await enroll(org, seq.sequenceId, users[0].userId, accA, { current_step_order: 1 });
    const past = minutesFromNow(-2 * 24 * 60);
    await schedule(org, e.enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: past, executed_at: past });
    const x1 = await schedule(org, e.enrollmentId, seq.steps[1]);

    await cycle();

    expect((await enrollmentFull(e.enrollmentId)).assigned_sender_id, "figée sur le compte de l'inscription").toBe(accA);
    expect((await execRow(x1)).status).toBe('sent');
    expect(await sentTexts(accA)).toEqual(['Relance']);
    expect(await mockCalls(accB), 'aucun appel depuis le compte du groupe').toEqual([]);
  });
});

// ═══ Quotas ═════════════════════════════════════════════════════════════════

test.describe('Moteur engine-2 : quotas', () => {
  // quota-journal-apres-controles
  test("quota-journal-apres-controles : une étape reportée ou close avant le verrou n'ajoute aucune ligne de son type au journal, le témoin envoyé exactement une", async () => {
    // Réponse détectée avant l'envoi de la relance.
    const { org: oR, accountId: accR } = await sendingOrgTracked('E2E Journal réponse');
    const chat = scriptedChat(accR);
    await mock(accR, { routes: [chatListRoute(chat.id), candidateReplyRoute(chat.path, minutesFromNow(-10))] });
    const sR = await insertSequence(oR, oR.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const eR = await enroll(oR, sR.sequenceId, oR.owner.userId, accR, { current_step_order: 1 });
    const past = minutesFromNow(-24 * 60);
    await schedule(oR, eR.enrollmentId, sR.steps[0], { status: 'sent', scheduled_at: past, executed_at: past });

    // Condition fausse (« Si non connecté » vers une relation directe).
    const { org: oK, accountId: accK } = await sendingOrgTracked('E2E Journal condition');
    const sK = await insertSequence(oK, oK.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour', condition_type: 'if_not_connected' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const eK = await enroll(oK, sK.sequenceId, oK.owner.userId, accK);

    // Compte déconnecté en base.
    const { org: oD, accountId: accD } = await sendingOrgTracked('E2E Journal déconnecté');
    await admin().from('member_linkedin_accounts').update({ account_status: 'CREDENTIALS' }).eq('linkedin_account_id', accD);
    const sD = await insertSequence(oD, oD.owner.userId, [{ action_type: 'message', message_template: 'Bonjour' }]);
    const eD = await enroll(oD, sD.sequenceId, oD.owner.userId, accD);

    // Attente non franchie.
    const { org: oW, accountId: accW } = await sendingOrgTracked('E2E Journal attente');
    await mock(accW, { distance: 'SECOND_DEGREE' });
    const sW = await insertSequence(oW, oW.owner.userId, [
      { action_type: 'wait_connection' },
      { action_type: 'message', message_template: 'Merci' },
    ]);
    const eW = await enroll(oW, sW.sequenceId, oW.owner.userId, accW);

    // Témoin.
    const { org: oS, accountId: accS } = await sendingOrgTracked('E2E Journal témoin');
    const sS = await insertSequence(oS, oS.owner.userId, [{ action_type: 'message', message_template: 'Bonjour' }]);
    const eS = await enroll(oS, sS.sequenceId, oS.owner.userId, accS);

    const xR = await schedule(oR, eR.enrollmentId, sR.steps[1]);
    const xK = await schedule(oK, eK.enrollmentId, sK.steps[0]);
    const xD = await schedule(oD, eD.enrollmentId, sD.steps[0]);
    const xW = await schedule(oW, eW.enrollmentId, sW.steps[0]);
    const xS = await schedule(oS, eS.enrollmentId, sS.steps[0]);
    await cycle();

    // Chaque scénario a bien suivi son chemin.
    expect((await enrollmentFull(eR.enrollmentId)).status).toBe('replied');
    expect((await execRow(xR)).status).toBe('cancelled');
    expect((await execRow(xK)).skip_reason).toBe('Condition: if_not_connected');
    expect((await enrollmentFull(eD.enrollmentId)).pause_reason).toBe('account_disconnected');
    expect((await execRow(xD)).status).toBe('cancelled');
    expect((await execRow(xW)).status).toBe('waiting_event');
    expect((await execRow(xS)).status).toBe('sent');

    expect(await ledgerCount(accR, 'message'), 'réponse détectée : rien au plafond').toBe(0);
    expect(await ledgerCount(accK, 'message'), 'condition fausse : rien au plafond').toBe(0);
    expect(await ledgerCount(accD), 'compte déconnecté : rien au journal').toBe(0);
    expect(await ledgerCount(accW, 'message'), 'attente : rien au plafond').toBe(0);
    expect(await ledgerCount(accS, 'message'), 'témoin envoyé : exactement une ligne').toBe(1);
  });

  // quota-inmail
  test("quota-inmail : InMail vers une relation directe en message gratuit ; hors relation, solde nul bloqué au lendemain, solde illisible +30 min, objet manquant relancé sans objet inventé", async () => {
    const inmailSteps = (subject: string | null): StepSpec[] => [
      { action_type: 'inmail', subject_template: subject, message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ];
    // Relation directe (profil au premier degré, par défaut).
    const { org: o1, accountId: acc1 } = await sendingOrgTracked('E2E InMail relation');
    const s1 = await insertSequence(o1, o1.owner.userId, inmailSteps('Objet InMail'));
    const e1 = await enroll(o1, s1.sequenceId, o1.owner.userId, acc1);
    // Hors relation, aucun crédit.
    const { org: o2, accountId: acc2 } = await sendingOrgTracked('E2E InMail sans crédit');
    await mock(acc2, { distance: 'SECOND_DEGREE', routes: [{ method: 'GET', path: '^/api/v1/linkedin/inmail_balance$', body: { object: 'InMailBalance', premium: 0, recruiter: 0, sales_navigator: 0 } }] });
    const s2 = await insertSequence(o2, o2.owner.userId, inmailSteps('Objet InMail'));
    const e2 = await enroll(o2, s2.sequenceId, o2.owner.userId, acc2);
    // Hors relation, solde illisible.
    const { org: o3, accountId: acc3 } = await sendingOrgTracked('E2E InMail solde illisible');
    await mock(acc3, { distance: 'SECOND_DEGREE', routes: [{ method: 'GET', path: '^/api/v1/linkedin/inmail_balance$', status: 503, body: { title: 'Unavailable' } }] });
    const s3 = await insertSequence(o3, o3.owner.userId, inmailSteps('Objet InMail'));
    const e3 = await enroll(o3, s3.sequenceId, o3.owner.userId, acc3);
    // Hors relation, objet manquant.
    const { org: o4, accountId: acc4 } = await sendingOrgTracked('E2E InMail sans objet');
    await mock(acc4, { distance: 'SECOND_DEGREE' });
    const s4 = await insertSequence(o4, o4.owner.userId, inmailSteps(null));
    const e4 = await enroll(o4, s4.sequenceId, o4.owner.userId, acc4);

    // Message IA (smart_message) vers une relation directe, texte du modèle.
    const { org: o5, accountId: acc5 } = await sendingOrgTracked('E2E Message IA relation');
    const s5 = await insertSequence(o5, o5.owner.userId, [
      { action_type: 'smart_message', subject_template: 'Objet', message_template: 'Bonjour en direct' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const e5 = await enroll(o5, s5.sequenceId, o5.owner.userId, acc5);

    const x1 = await schedule(o1, e1.enrollmentId, s1.steps[0]);
    const x2 = await schedule(o2, e2.enrollmentId, s2.steps[0]);
    const x3 = await schedule(o3, e3.enrollmentId, s3.steps[0]);
    const x4 = await schedule(o4, e4.enrollmentId, s4.steps[0]);
    const x5 = await schedule(o5, e5.enrollmentId, s5.steps[0]);
    const before = Date.now();
    await cycle();
    const after = Date.now();

    // 1. Relation directe : message direct, ni solde ni linkedin[inmail], journalisé 'message'.
    expect((await execRow(x1)).status).toBe('sent');
    const calls1 = await mockCalls(acc1);
    expect(calls1.some((c) => c.path === '/api/v1/linkedin/inmail_balance'), 'aucun contrôle de solde').toBe(false);
    const post1 = calls1.filter(isNewChatPost);
    expect(post1).toHaveLength(1);
    expect(bodyOf(post1[0])['linkedin[inmail]'], 'pas de champ linkedin[inmail]').toBeUndefined();
    expect(await ledgerCount(acc1, 'message')).toBe(1);
    expect(await ledgerCount(acc1, 'inmail')).toBe(0);
    expect((await execRow(x5)).status).toBe('sent');
    const calls5 = await mockCalls(acc5);
    expect(calls5.some((c) => c.path === '/api/v1/linkedin/inmail_balance'), 'message IA en relation directe : aucun contrôle de solde').toBe(false);
    const post5 = calls5.filter(isNewChatPost);
    expect(post5.map((p) => String(bodyOf(p).text))).toEqual(['Bonjour en direct']);
    expect(bodyOf(post5[0])['linkedin[inmail]']).toBeUndefined();
    expect(await ledgerCount(acc5, 'message')).toBe(1);
    expect(await ledgerCount(acc5, 'inmail')).toBe(0);

    // 2. Solde nul : bloqué jusqu'au début de plage du lendemain.
    const r2 = await execRow(x2);
    expect(r2.status).toBe('quota_blocked');
    expect(r2.skip_reason).toBe('Crédits InMail épuisés');
    const p2 = localParts(r2.scheduled_at, 'Europe/Paris');
    expect(p2.ymd).toBe(localYmdPlus(new Date(), 'Europe/Paris', 1));
    expect([p2.hour, p2.minute]).toEqual([8, 0]);
    expect(await postsOf(acc2)).toEqual([]);

    // 3. Solde illisible : nouvel essai dans 30 min.
    const r3 = await execRow(x3);
    expect(r3.status).toBe('quota_blocked');
    expect(r3.skip_reason ?? '').toMatch(/^Contrôle des crédits InMail momentanément indisponible/);
    const at3 = new Date(r3.scheduled_at).getTime();
    expect(at3).toBeGreaterThanOrEqual(before + 30 * MIN - 1_000);
    expect(at3).toBeLessThanOrEqual(after + 30 * MIN + 1_000);
    expect(await postsOf(acc3)).toEqual([]);

    // 4. Objet manquant : nouvel essai à 30 min, rien n'est envoyé.
    const r4 = await execRow(x4);
    expect(r4.status).toBe('scheduled');
    expect(r4.retry_count).toBe(1);
    expect(r4.error_message ?? '').toMatch(/^Retry 1\/3: inmail_subject_missing/);
    const at4 = new Date(r4.scheduled_at).getTime();
    expect(at4).toBeGreaterThanOrEqual(before + 30 * MIN - 1_000);
    expect(at4).toBeLessThanOrEqual(after + 30 * MIN + 1_000);
    expect(await postsOf(acc4), "jamais d'objet inventé").toEqual([]);
  });
});

// ═══ IA et budget du cycle ══════════════════════════════════════════════════

test.describe('Moteur engine-2 : IA indisponible et budget du cycle', () => {
  // ia-indisponible
  test("ia-indisponible : génération IA refusée (crédits IA épuisés), report à 30 min sans texte puis échec après 3 essais, hors auto-pause, le modèle brut ne part jamais", async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E IA indisponible', 2);
    const [accA, accB] = accounts;
    // Solde IA lu et nul : le garde de crédits refuse avant l'appel au modèle.
    const { error: balErr } = await admin().from('ai_credit_balances').upsert({
      organization_id: org.orgId, plan_credits: 0, topup_credits: 0, credits_remaining: 0, credits_total: 0,
      period_start: new Date(Date.now() - DAY).toISOString(), period_end: new Date(Date.now() + 30 * DAY).toISOString(),
    }, { onConflict: 'organization_id' });
    expect(balErr).toBeNull();
    const seq = await insertSequence(org, users[0].userId, [
      { action_type: 'message', message_template: 'Modèle brut {{prenom}}', use_ai_personalization: true },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const firstTry = await enroll(org, seq.sequenceId, users[0].userId, accA);
    const lastTries = [
      await enroll(org, seq.sequenceId, users[0].userId, accA),
      await enroll(org, seq.sequenceId, users[0].userId, accA),
      await enroll(org, seq.sequenceId, users[1].userId, accB),
      await enroll(org, seq.sequenceId, users[1].userId, accB),
      await enroll(org, seq.sequenceId, users[1].userId, accB),
    ];
    // Aperçu validé à l'inscription, sur une autre organisation sans crédit IA : il part tel quel.
    const { org: oOv, accountId: accOv } = await sendingOrgTracked('E2E IA aperçu validé');
    await admin().from('ai_credit_balances').upsert({
      organization_id: oOv.orgId, plan_credits: 0, topup_credits: 0, credits_remaining: 0, credits_total: 0,
      period_start: new Date(Date.now() - DAY).toISOString(), period_end: new Date(Date.now() + 30 * DAY).toISOString(),
    }, { onConflict: 'organization_id' });
    const seqOv = await insertSequence(oOv, oOv.owner.userId, [
      { action_type: 'message', message_template: 'Modèle brut {{prenom}}', use_ai_personalization: true },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const eOv = await enroll(oOv, seqOv.sequenceId, oOv.owner.userId, accOv, {
      tracking_data: { message_overrides: { [seqOv.steps[0].id]: { message: 'Aperçu validé pour ce candidat', isEdited: true } } },
    });
    const xOv = await schedule(oOv, eOv.enrollmentId, seqOv.steps[0]);
    const xFirst = await schedule(org, firstTry.enrollmentId, seq.steps[0], { scheduled_at: minutesFromNow(-3) });
    const xLast: string[] = [];
    for (const e of lastTries) xLast.push(await schedule(org, e.enrollmentId, seq.steps[0], { retry_count: 3, scheduled_at: minutesFromNow(-2) }));
    const before = Date.now();
    const res = await cycle();
    const after = Date.now();

    const r1 = await execRow(xFirst);
    expect(r1.status).toBe('scheduled');
    expect(r1.retry_count).toBe(1);
    expect(r1.final_message, 'contenu d’avant le verrou (aucun texte)').toBeNull();
    expect(r1.error_message).toBe('Crédits IA épuisés : nouvel essai 1/3 dans 30 min');
    const at1 = new Date(r1.scheduled_at).getTime();
    expect(at1).toBeGreaterThanOrEqual(before + 30 * MIN - 1_000);
    expect(at1).toBeLessThanOrEqual(after + 30 * MIN + 1_000);

    for (const x of xLast) {
      const row = await execRow(x);
      expect(row.status).toBe('failed');
      expect(row.error_message).toBe("Crédits IA épuisés : message non envoyé après plusieurs essais. Relancez l'étape plus tard.");
      expect(row.final_message).toBeNull();
    }
    expect(Number((res.results as Record<string, number>).ai_unavailable)).toBeGreaterThanOrEqual(5);
    expect(await sequenceActive(seq.sequenceId), 'IA indisponible : hors auto-pause').toBe(true);
    for (const e of [firstTry, ...lastTries]) expect((await enrollmentFull(e.enrollmentId)).status).toBe('active');
    expect(await postsOf(accA), 'le modèle brut ne part jamais').toEqual([]);
    expect(await postsOf(accB)).toEqual([]);
    expect((await execRow(xOv)).status, 'aperçu validé : aucune rédaction IA nécessaire').toBe('sent');
    expect(await sentTexts(accOv)).toEqual(['Aperçu validé pour ce candidat']);
  });

  // budget-cycle
  test("budget-cycle : aucune exécution verrouillée sans 20 s restantes, les suivantes gardent statut et date, aucune ne reste 'sending'", async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E Budget', 3);
    const seq = await insertSequence(org, users[0].userId, [{ action_type: 'message', message_template: 'Bonjour' }]);
    // Recherche de la conversation lente (14 s, sous le délai de 15 s du moteur) pour chaque compte.
    for (const acc of accounts) {
      await mock(acc, { routes: [{ method: 'GET', path: '^/api/v1/chat_attendees/', delay_ms: 14_000, body: { object: 'ChatList', items: [], cursor: null } }] });
    }
    const enrollments = [];
    for (let i = 0; i < 3; i++) enrollments.push(await enroll(org, seq.sequenceId, users[i].userId, accounts[i]));
    const dues = [minutesFromNow(-3), minutesFromNow(-2), minutesFromNow(-1)];
    const execs: string[] = [];
    for (let i = 0; i < 3; i++) execs.push(await schedule(org, enrollments[i].enrollmentId, seq.steps[0], { scheduled_at: dues[i] }));

    const t0 = Date.now();
    await cycle();
    const elapsed = Date.now() - t0;
    expect(elapsed, 'cycle terminé avant la limite de 60 s').toBeLessThan(60_000);

    let posts = 0;
    for (const acc of accounts) posts += (await postsOf(acc)).length;
    expect(posts, 'au plus deux envois dans le budget').toBeLessThanOrEqual(2);
    expect(posts).toBeGreaterThanOrEqual(1);
    const rows = await Promise.all(execs.map(execRow));
    expect(rows.some((r) => r.status === 'sending'), "aucune exécution laissée 'sending'").toBe(false);
    const last = rows[2];
    expect(last.status, 'la dernière exécution attend le cycle suivant').toBe('scheduled');
    expect(new Date(last.scheduled_at).getTime(), 'à la même date').toBe(new Date(dues[2]).getTime());
    for (const [i, r] of rows.entries()) {
      if (r.status !== 'sent') {
        expect(r.status).toBe('scheduled');
        expect(new Date(r.scheduled_at).getTime()).toBe(new Date(dues[i]).getTime());
      }
    }
  });

  // budget-cycle (rédaction IA)
  test("budget-cycle : une étape rédigée par l'IA n'est pas verrouillée sans 30 s restantes, un envoi simple l'est encore avec 20 s", async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E Budget IA', 3);
    const [acc1, acc2, acc3] = accounts;
    const plain = await insertSequence(org, users[0].userId, [{ action_type: 'message', message_template: 'Bonjour' }]);
    const ai = await insertSequence(org, users[0].userId, [{ action_type: 'message', message_template: 'Modèle {{prenom}}', use_ai_personalization: true }]);
    // Premier envoi lent (12 s) : il reste ensuite entre 20 et 30 s au cycle.
    await mock(acc1, { routes: [{ method: 'GET', path: '^/api/v1/chat_attendees/', delay_ms: 12_000, body: { object: 'ChatList', items: [], cursor: null } }] });
    const e1 = await enroll(org, plain.sequenceId, users[0].userId, acc1);
    const e2 = await enroll(org, ai.sequenceId, users[1].userId, acc2);
    const e3 = await enroll(org, plain.sequenceId, users[2].userId, acc3);
    const due2 = minutesFromNow(-2);
    const x1 = await schedule(org, e1.enrollmentId, plain.steps[0], { scheduled_at: minutesFromNow(-3) });
    const x2 = await schedule(org, e2.enrollmentId, ai.steps[0], { scheduled_at: due2 });
    const x3 = await schedule(org, e3.enrollmentId, plain.steps[0], { scheduled_at: minutesFromNow(-1) });
    await cycle();

    expect((await execRow(x1)).status).toBe('sent');
    const r2 = await execRow(x2);
    expect(r2.status, "rédaction IA : pas de verrou sans 30 s").toBe('scheduled');
    expect(new Date(r2.scheduled_at).getTime(), 'date inchangée').toBe(new Date(due2).getTime());
    expect(r2.final_message).toBeNull();
    expect(await postsOf(acc2)).toEqual([]);
    expect((await execRow(x3)).status, 'envoi simple : verrouillé avec 20 s').toBe('sent');
  });
});

// ═══ Issues d'envoi ═════════════════════════════════════════════════════════

test.describe("Moteur engine-2 : issues d'envoi", () => {
  // issue-4xx
  test('issue-4xx : refus 4xx sans relance ; un 404 sur la conversation existante bascule une seule fois vers une nouvelle conversation', async () => {
    // Conversation existante refusée (404), nouvelle conversation acceptée.
    const { org: o1, accountId: acc1 } = await sendingOrgTracked('E2E 404 conversation');
    const chat1 = scriptedChat(acc1);
    await mock(acc1, { routes: [chatListRoute(chat1.id), { method: 'POST', path: chat1.path, status: 404, body: { title: 'Chat not found' } }] });
    const s1 = await insertSequence(o1, o1.owner.userId, [{ action_type: 'message', message_template: 'Bonjour' }]);
    const e1 = await enroll(o1, s1.sequenceId, o1.owner.userId, acc1);
    // Sans conversation, nouvelle conversation refusée (400).
    const { org: o2, accountId: acc2 } = await sendingOrgTracked('E2E 400');
    await mock(acc2, { routes: [{ method: 'POST', path: '^/api/v1/chats$', status: 400, body: { title: 'Bad request', detail: 'invalid attendee' } }] });
    const s2 = await insertSequence(o2, o2.owner.userId, [{ action_type: 'message', message_template: 'Bonjour' }]);
    const e2 = await enroll(o2, s2.sequenceId, o2.owner.userId, acc2);
    // Conversation existante et nouvelle conversation refusées : une seule bascule.
    const { org: o3, accountId: acc3 } = await sendingOrgTracked('E2E 404 deux fois');
    const chat3 = scriptedChat(acc3);
    await mock(acc3, { routes: [
      chatListRoute(chat3.id),
      { method: 'POST', path: chat3.path, status: 404, body: { title: 'Chat not found' } },
      { method: 'POST', path: '^/api/v1/chats$', status: 404, body: { title: 'Attendee not found' } },
    ] });
    const s3 = await insertSequence(o3, o3.owner.userId, [{ action_type: 'message', message_template: 'Bonjour' }]);
    const e3 = await enroll(o3, s3.sequenceId, o3.owner.userId, acc3);

    const x1 = await schedule(o1, e1.enrollmentId, s1.steps[0]);
    const x2 = await schedule(o2, e2.enrollmentId, s2.steps[0]);
    const x3 = await schedule(o3, e3.enrollmentId, s3.steps[0]);
    await cycle();

    const posts1 = await postsOf(acc1);
    expect(posts1.map((p) => p.path), 'conversation existante puis une nouvelle').toEqual([chat1.path.slice(1, -1), '/api/v1/chats']);
    expect((await execRow(x1)).status).toBe('sent');

    const r2 = await execRow(x2);
    expect(r2.status).toBe('failed');
    expect(r2.error_message ?? '').toMatch(/^linkedin_send_failed_400/);
    expect(r2.retry_count ?? 0, 'sans relance').toBe(0);
    expect(await postsOf(acc2)).toHaveLength(1);

    const posts3 = await postsOf(acc3);
    expect(posts3, 'une seule bascule').toHaveLength(2);
    const r3 = await execRow(x3);
    expect(r3.status).toBe('failed');
    expect(r3.error_message ?? '').toMatch(/^linkedin_send_failed_404/);
    expect(r3.retry_count ?? 0).toBe(0);
  });

  // issue-429
  test('issue-429 : 429 à l’envoi, report au jour ouvré suivant 9 h (lundi 9 h pour une invitation), retry_count inchangé, texte résolu gardé', async () => {
    const tz = 'Europe/Paris';
    const { org: o1, accountId: acc1 } = await sendingOrgTracked('E2E 429 message');
    await mock(acc1, { fail_send: 429 });
    const s1 = await insertSequence(o1, o1.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour {{prenom}}' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const e1 = await enroll(o1, s1.sequenceId, o1.owner.userId, acc1);
    const { org: o2, accountId: acc2 } = await sendingOrgTracked('E2E 429 invitation');
    await mock(acc2, { fail_send: 429, distance: 'SECOND_DEGREE' });
    const s2 = await insertSequence(o2, o2.owner.userId, [
      { action_type: 'connection_request' },
      { action_type: 'message', message_template: 'Merci', delay_days: 3 },
    ]);
    const e2 = await enroll(o2, s2.sequenceId, o2.owner.userId, acc2);
    // InMail réellement tenté (hors relation) dont le 429 cite les crédits : 1er du mois suivant.
    const creditsBody = { status: 429, title: 'Too many requests', detail: 'Not enough InMail credits' };
    const { org: o3, accountId: acc3 } = await sendingOrgTracked('E2E 429 InMail crédits');
    await mock(acc3, { distance: 'SECOND_DEGREE', routes: [{ method: 'POST', path: '^/api/v1/chats$', status: 429, body: creditsBody }] });
    const s3 = await insertSequence(o3, o3.owner.userId, [
      { action_type: 'inmail', subject_template: 'Objet', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const e3 = await enroll(o3, s3.sequenceId, o3.owner.userId, acc3);
    // Même erreur, mais l'InMail part en message direct (relation directe) : jour ouvré suivant.
    const { org: o4, accountId: acc4 } = await sendingOrgTracked('E2E 429 InMail direct');
    await mock(acc4, { routes: [{ method: 'POST', path: '^/api/v1/chats$', status: 429, body: creditsBody }] });
    const s4 = await insertSequence(o4, o4.owner.userId, [
      { action_type: 'inmail', subject_template: 'Objet', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const e4 = await enroll(o4, s4.sequenceId, o4.owner.userId, acc4);
    const x1 = await schedule(o1, e1.enrollmentId, s1.steps[0]);
    const x2 = await schedule(o2, e2.enrollmentId, s2.steps[0]);
    const x3 = await schedule(o3, e3.enrollmentId, s3.steps[0]);
    const x4 = await schedule(o4, e4.enrollmentId, s4.steps[0]);
    const now = new Date();
    await cycle();

    const wd = localParts(now, tz).weekday;
    const r1 = await execRow(x1);
    expect(r1.status).toBe('scheduled');
    expect(r1.retry_count ?? 0, 'retry_count inchangé').toBe(0);
    expect(r1.final_message, 'texte résolu conservé').toBe('Bonjour Camille');
    expect(r1.error_message ?? '').toMatch(/^Rate limit \(message\) → rescheduled to /);
    const p1 = localParts(r1.scheduled_at, tz);
    expect(p1.ymd, 'jour ouvré suivant').toBe(localYmdPlus(now, tz, wd === 5 ? 3 : wd === 6 ? 2 : 1));
    expect([p1.hour, p1.minute]).toEqual([9, 0]);
    expect(await postsOf(acc1), 'un seul essai').toHaveLength(1);

    const r2 = await execRow(x2);
    expect(r2.status).toBe('scheduled');
    expect(r2.retry_count ?? 0).toBe(0);
    expect(r2.error_message ?? '').toMatch(/^Rate limit \(connection_request\) → rescheduled to /);
    const p2 = localParts(r2.scheduled_at, tz);
    expect(p2.ymd, 'lundi suivant').toBe(localYmdPlus(now, tz, ((8 - wd) % 7) || 7));
    expect(p2.weekday).toBe(1);
    expect([p2.hour, p2.minute]).toEqual([9, 0]);
    expect(await postsOf(acc2)).toHaveLength(1);

    const pNow = localParts(now, tz);
    const firstOfNext = pNow.m === 12 ? `${pNow.y + 1}-01-01` : `${pNow.y}-${String(pNow.m + 1).padStart(2, '0')}-01`;
    const r3 = await execRow(x3);
    expect(r3.status).toBe('scheduled');
    expect(r3.retry_count ?? 0).toBe(0);
    const p3 = localParts(r3.scheduled_at, tz);
    expect(p3.ymd, 'InMail tenté, crédits cités : 1er du mois suivant').toBe(firstOfNext);
    expect([p3.hour, p3.minute]).toEqual([9, 0]);
    expect(await postsOf(acc3)).toHaveLength(1);

    const r4 = await execRow(x4);
    expect(r4.status).toBe('scheduled');
    const p4 = localParts(r4.scheduled_at, tz);
    expect(p4.ymd, 'parti en message direct : jour ouvré suivant, jamais le mois suivant').toBe(localYmdPlus(now, tz, wd === 5 ? 3 : wd === 6 ? 2 : 1));
    expect([p4.hour, p4.minute]).toEqual([9, 0]);
  });

  // issue-compte-deconnecte-envoi
  test("issue-compte-deconnecte-envoi : envoi refusé pour compte déconnecté, inscription en pause account_disconnected, étape annulée avec un libellé sans nom de prestataire, hors échecs", async () => {
    const cases = [
      { status: 401, body: { title: 'Invalid credentials' } },
      { status: 403, body: { title: 'Forbidden', detail: 'Please reconnect this account' } },
    ];
    const seen: Array<{ seqId: string; enrollmentId: string; exec: string; acc: string }> = [];
    for (const c of cases) {
      const { org, accountId } = await sendingOrgTracked(`E2E Déconnecté ${c.status}`);
      await mock(accountId, { routes: [{ method: 'POST', path: '^/api/v1/chats$', status: c.status, body: c.body }] });
      const s = await insertSequence(org, org.owner.userId, [
        { action_type: 'message', message_template: 'Bonjour' },
        { action_type: 'message', message_template: 'Relance', delay_days: 3 },
      ]);
      const e = await enroll(org, s.sequenceId, org.owner.userId, accountId);
      seen.push({ seqId: s.sequenceId, enrollmentId: e.enrollmentId, exec: '', acc: accountId });
      seen[seen.length - 1].exec = await schedule(org, e.enrollmentId, s.steps[0]);
    }
    await cycle();

    for (const s of seen) {
      const enr = await enrollmentFull(s.enrollmentId);
      expect(enr.status).toBe('paused');
      expect(enr.pause_reason).toBe('account_disconnected');
      const row = await execRow(s.exec);
      expect(row.status, 'annulée, pas en échec').toBe('cancelled');
      expect(row.skip_reason).toBe(ACCOUNT_DISCONNECTED_SKIP);
      expect(row.error_message ?? '').toMatch(/^Compte LinkedIn déconnecté/);
      expect(row.error_message ?? '').not.toMatch(/unipile/i);
      expect(await sequenceActive(s.seqId), 'hors auto-pause').toBe(true);
      const { data: acc } = await admin().from('member_linkedin_accounts').select('account_status').eq('linkedin_account_id', s.acc).single();
      expect((acc as { account_status: string }).account_status).toBe('OK');
    }
  });

  // issue-invitation-deja-relation
  test("issue-invitation-deja-relation : invitation à une relation directe ou déjà invitée sautée avec sa raison, étape suivante planifiée, jamais d'échec ni de pause", async () => {
    const { org: o1, accountId: acc1 } = await sendingOrgTracked('E2E Invitation relation');
    const s1 = await insertSequence(o1, o1.owner.userId, [
      { action_type: 'connection_request' },
      { action_type: 'message', message_template: 'Merci', delay_days: 3 },
    ]);
    const e1 = await enroll(o1, s1.sequenceId, o1.owner.userId, acc1);
    const { org: o2, accountId: acc2 } = await sendingOrgTracked('E2E Invitation en attente');
    await mock(acc2, { distance: 'SECOND_DEGREE', routes: [{ method: 'POST', path: '^/api/v1/users/invite$', status: 422, body: { title: 'Unprocessable', detail: 'User already invited' } }] });
    const s2 = await insertSequence(o2, o2.owner.userId, [
      { action_type: 'connection_request' },
      { action_type: 'message', message_template: 'Merci', delay_days: 3 },
    ]);
    const e2 = await enroll(o2, s2.sequenceId, o2.owner.userId, acc2);
    const x1 = await schedule(o1, e1.enrollmentId, s1.steps[0]);
    const x2 = await schedule(o2, e2.enrollmentId, s2.steps[0]);
    await cycle();

    const r1 = await execRow(x1);
    expect(r1.status).toBe('skipped');
    expect(r1.skip_reason).toBe('Déjà en relation : invitation inutile');
    expect(await sentInvites(acc1), 'aucune invitation envoyée').toEqual([]);
    const r2 = await execRow(x2);
    expect(r2.status).toBe('skipped');
    expect(r2.skip_reason).toBe('Invitation déjà en attente');

    for (const e of [e1, e2]) {
      const enr = await enrollmentFull(e.enrollmentId);
      expect(enr.status, 'ni échec ni pause').toBe('active');
      expect(enr.current_step_order).toBe(1);
      expect((await execsOf(e.enrollmentId)).filter((x) => x.step_order === 1).map((x) => x.status)).toEqual(['scheduled']);
    }
    expect((await enrollmentFull(e1.enrollmentId)).connection_status).toBe('connected');
    expect((await enrollmentFull(e2.enrollmentId)).connection_status).toBe('pending_invite');
  });
});

// ═══ Auto-pause ═════════════════════════════════════════════════════════════

test.describe('Moteur engine-2 : auto-pause des séquences', () => {
  // auto-pause-sequence
  test("auto-pause-sequence : plus de 30 % d'échecs sur 5 actions d'une séquence la désactive, ses inscriptions actives en pause auto_paused (étapes gardées), créateur prévenu ; l'autre séquence reste active", async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E Auto-pause', 2);
    const [accA, accB] = accounts;
    const projectId = await seedMission(org.orgId, users[0].userId);
    const seq1 = await insertSequence(org, users[0].userId, [
      { action_type: 'message', message_template: '' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ], { project_id: projectId });
    const seq2 = await insertSequence(org, users[0].userId, [{ action_type: 'message', message_template: '' }]);

    // Inscription de la séquence 1 en attente d'une étape future.
    const future = await enroll(org, seq1.sequenceId, users[0].userId, accA, { current_step_order: 1 });
    const past = minutesFromNow(-24 * 60);
    await schedule(org, future.enrollmentId, seq1.steps[0], { status: 'sent', scheduled_at: past, executed_at: past });
    const futureAt = minutesFromNow(2 * 24 * 60);
    const futureExec = await schedule(org, future.enrollmentId, seq1.steps[1], { scheduled_at: futureAt });

    // Cinq échecs imputables à la séquence 1 (texte vide), trois sur A, deux sur B ; un sur la séquence 2.
    const failing = [
      await enroll(org, seq1.sequenceId, users[0].userId, accA),
      await enroll(org, seq1.sequenceId, users[0].userId, accA),
      await enroll(org, seq1.sequenceId, users[0].userId, accA),
      await enroll(org, seq1.sequenceId, users[1].userId, accB),
      await enroll(org, seq1.sequenceId, users[1].userId, accB),
    ];
    const other = await enroll(org, seq2.sequenceId, users[1].userId, accB);
    const failingExecs: string[] = [];
    for (const e of failing) failingExecs.push(await schedule(org, e.enrollmentId, seq1.steps[0]));
    const otherExec = await schedule(org, other.enrollmentId, seq2.steps[0]);

    await cycle();

    for (const x of [...failingExecs, otherExec]) expect((await execRow(x)).status).toBe('failed');
    expect(await sequenceActive(seq1.sequenceId), 'séquence 1 désactivée').toBe(false);
    const enrFuture = await enrollmentFull(future.enrollmentId);
    expect(enrFuture.status).toBe('paused');
    expect(enrFuture.pause_reason).toBe('auto_paused');
    const fe = await execRow(futureExec);
    expect(fe.status, 'exécution en attente gardée').toBe('scheduled');
    expect(new Date(fe.scheduled_at).getTime(), 'avec sa date').toBe(new Date(futureAt).getTime());

    const { data: notifs } = await admin().from('notifications').select('user_id, link, metadata')
      .eq('organization_id', org.orgId).eq('metadata->>source', 'sequence_auto_pause');
    const mine = ((notifs ?? []) as Array<{ user_id: string; link: string; metadata: Record<string, unknown> }>)
      .filter((n) => n.metadata?.sequence_id === seq1.sequenceId);
    expect(mine, 'créateur prévenu une fois').toHaveLength(1);
    expect(mine[0].user_id).toBe(users[0].userId);
    expect(mine[0].link).toBe(`/missions/${projectId}?tab=outreach`);

    expect(await sequenceActive(seq2.sequenceId), "les échecs d'une autre séquence ne la désactivent pas").toBe(true);
    expect((await enrollmentFull(other.enrollmentId)).status).toBe('active');
    cleanups.push(() => admin().from('notifications').delete().eq('organization_id', org.orgId));
  });

  // issue-4xx (compté pour l'auto-pause)
  test("issue-4xx : cinq refus 4xx d'une séquence comptent comme échecs et la mettent en pause automatiquement", async () => {
    const { org, users, accounts } = await orgWithAccounts('E2E Auto-pause 4xx', 5);
    const seq = await insertSequence(org, users[0].userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    for (const acc of accounts) {
      await mock(acc, { routes: [{ method: 'POST', path: '^/api/v1/chats$', status: 422, body: { title: 'Unprocessable entity' } }] });
    }
    const enrs: string[] = [];
    for (let i = 0; i < 5; i++) enrs.push((await enroll(org, seq.sequenceId, users[i].userId, accounts[i])).enrollmentId);
    const execs: string[] = [];
    for (const id of enrs) execs.push(await schedule(org, id, seq.steps[0]));
    await cycle();

    for (const x of execs) {
      const row = await execRow(x);
      expect(row.status).toBe('failed');
      expect(row.error_message ?? '').toMatch(/^linkedin_send_failed_422/);
      expect(row.retry_count ?? 0).toBe(0);
    }
    expect(await sequenceActive(seq.sequenceId), 'refus 4xx comptés : séquence désactivée').toBe(false);
    for (const id of enrs) expect((await enrollmentFull(id)).pause_reason).toBe('auto_paused');
    cleanups.push(() => admin().from('notifications').delete().eq('organization_id', org.orgId));
  });

  // auto-pause-sequence (échecs non imputables)
  test("auto-pause-sequence : profils introuvables et comptes déconnectés ne comptent pas dans l'auto-pause", async () => {
    // Cinq comptes, une exécution chacun (aucun espacement entre deux envois du même compte).
    const { org, users, accounts } = await orgWithAccounts('E2E Auto-pause hors échecs', 5);
    const notFound = await insertSequence(org, users[0].userId, [{ action_type: 'connection_request' }]);
    for (const acc of accounts) {
      await mock(acc, { routes: [{ method: 'GET', path: '^/api/v1/users/', status: 404, body: { title: 'Not found' } }] });
    }
    const execs: string[] = [];
    const enrs: string[] = [];
    for (let i = 0; i < 5; i++) {
      const e = await enroll(org, notFound.sequenceId, users[i].userId, accounts[i], { profile_id: `e2e-introuvable-${rand()}` });
      enrs.push(e.enrollmentId);
    }
    const disconnected = await orgWithAccounts('E2E Auto-pause déconnectés', 5);
    const discSeq = await insertSequence(disconnected.org, disconnected.users[0].userId, [{ action_type: 'message', message_template: 'Bonjour' }]);
    for (const acc of disconnected.accounts) {
      await mock(acc, { routes: [{ method: 'POST', path: '^/api/v1/chats$', status: 401, body: { title: 'Invalid credentials' } }] });
    }
    const discEnrs: string[] = [];
    for (let i = 0; i < 5; i++) {
      const e = await enroll(disconnected.org, discSeq.sequenceId, disconnected.users[i].userId, disconnected.accounts[i]);
      discEnrs.push(e.enrollmentId);
    }
    for (const id of enrs) execs.push(await schedule(org, id, notFound.steps[0]));
    const discExecs: string[] = [];
    for (const id of discEnrs) discExecs.push(await schedule(disconnected.org, id, discSeq.steps[0]));

    await cycle();

    for (const x of execs) {
      const row = await execRow(x);
      expect(row.status).toBe('failed');
      expect(row.error_message ?? '').toMatch(/^Profil LinkedIn introuvable/);
    }
    expect(await sequenceActive(notFound.sequenceId), 'profils introuvables : hors auto-pause').toBe(true);
    for (const id of enrs) expect((await enrollmentFull(id)).status).toBe('active');

    for (const x of discExecs) expect((await execRow(x)).status).toBe('cancelled');
    expect(await sequenceActive(discSeq.sequenceId), 'comptes déconnectés : hors auto-pause').toBe(true);
    for (const id of discEnrs) expect((await enrollmentFull(id)).pause_reason).toBe('account_disconnected');
  });
});

// ═══ Planification de l'étape suivante ═══════════════════════════════════════

test.describe("Moteur engine-2 : planification de l'étape suivante", () => {
  // planif-date-etape-suivante
  test("planif-date-etape-suivante : délai de l'étape ou de l'inscription, ramené dans la plage préférée d'un jour ouvré, dans le fuseau du titulaire", async () => {
    const ny = 'America/New_York';
    const { org, accountId } = await sendingOrgTracked('E2E Date suivante');
    const { error: mqErr } = await admin().from('member_quotas').insert({ organization_id: org.orgId, user_id: org.owner.userId, timezone: ny });
    expect(mqErr).toBeNull();
    const seq = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', message_template: 'Relance', delay_days: 3 },
    ]);
    const overridden = await enroll(org, seq.sequenceId, org.owner.userId, accountId, {
      user_timezone: 'Europe/Paris',
      tracking_data: { step_config_overrides: { [seq.steps[1].id]: { delayDays: 1 } } },
    });
    const plain = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { user_timezone: 'Europe/Paris' });
    await schedule(org, overridden.enrollmentId, seq.steps[0]);
    await schedule(org, plain.enrollmentId, seq.steps[0]);
    const t0 = Date.now();
    await cycle();
    const t1 = Date.now();

    const check = async (enrollmentId: string, delayDays: number) => {
      const next = (await execsOf(enrollmentId)).filter((e) => e.step_order === 1);
      expect(next).toHaveLength(1);
      const at = new Date(next[0].scheduled_at);
      const p = localParts(at, ny);
      expect(isWeekday(p.weekday), `jour ouvré à New York (${next[0].scheduled_at})`).toBe(true);
      expect(p.hour, 'plage préférée 9 h-18 h, heure de New York').toBeGreaterThanOrEqual(9);
      expect(p.hour).toBeLessThan(18);
      expect(at.getTime()).toBeGreaterThanOrEqual(t0 + delayDays * DAY);
      // Créneau attendu dans le fuseau du titulaire (New York), pas celui de l'inscription.
      const early = expectedPreferredSlot(new Date(t0 + delayDays * DAY), ny);
      const late = expectedPreferredSlot(new Date(t1 + delayDays * DAY + 3 * MIN), ny);
      const lo = early.moved ? early.slot.getTime() : t0 + delayDays * DAY;
      const hi = late.moved ? late.slot.getTime() + 30 * MIN : t1 + delayDays * DAY + 3 * MIN;
      expect(at.getTime(), 'créneau calculé dans le fuseau du titulaire').toBeGreaterThanOrEqual(lo);
      expect(at.getTime()).toBeLessThanOrEqual(hi);
    };
    await check(overridden.enrollmentId, 1);
    await check(plain.enrollmentId, 3);
  });

  // planif-fin-sequence
  test("planif-fin-sequence : plus d'étape ou étape « Fin de séquence », l'inscription passe 'completed' sans planifier la suite", async () => {
    const { org, accountId } = await sendingOrgTracked('E2E Fin de séquence');
    const single = await insertSequence(org, org.owner.userId, [{ action_type: 'message', message_template: 'Unique' }]);
    const ends = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Fin', ends_sequence: true },
      { action_type: 'message', message_template: 'Jamais' },
    ]);
    const e1 = await enroll(org, single.sequenceId, org.owner.userId, accountId);
    const e2 = await enroll(org, ends.sequenceId, org.owner.userId, accountId);
    await schedule(org, e1.enrollmentId, single.steps[0]);
    await schedule(org, e2.enrollmentId, ends.steps[0]);
    await cycle();

    expect((await sentTexts(accountId)).sort()).toEqual(['Fin', 'Unique']);
    for (const e of [e1, e2]) {
      const enr = await enrollmentFull(e.enrollmentId);
      expect(enr.status).toBe('completed');
      expect(enr.completed_at).not.toBeNull();
      expect((await execsOf(e.enrollmentId)).length, 'aucune étape suivante').toBe(1);
    }
  });

  // planif-variantes-anti-doublon
  test("planif-variantes-anti-doublon : une seule variante planifiée, jamais replanifiée ni doublée, même après une étape déjà partie ou sautée", async () => {
    const { org, accountId } = await sendingOrgTracked('E2E Variantes');
    const seq = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', step_order: 1, message_template: 'Variante A', delay_days: 3, variant_group: 'A', variant_weight: 50 },
      { action_type: 'message', step_order: 1, message_template: 'Variante B', delay_days: 3, variant_group: 'B', variant_weight: 50 },
    ]);
    const variantIds = new Map([[seq.steps[1].id, 'A'], [seq.steps[2].id, 'B']]);
    const e = await enroll(org, seq.sequenceId, org.owner.userId, accountId);
    const x0 = await schedule(org, e.enrollmentId, seq.steps[0]);
    await cycle();

    expect((await execRow(x0)).status).toBe('sent');
    let rank1 = (await execsOf(e.enrollmentId)).filter((x) => x.step_order === 1);
    expect(rank1, 'une seule exécution au rang des variantes').toHaveLength(1);
    expect(['A', 'B']).toContain(rank1[0].variant_assigned);
    expect(variantIds.get(rank1[0].step_id), 'variante enregistrée = étape planifiée').toBe(rank1[0].variant_assigned);
    expect((await enrollmentFull(e.enrollmentId)).status).toBe('active');

    // Seconde planification : une autre exécution de l'étape 0 (déjà partie) repasse.
    const x0b = await schedule(org, e.enrollmentId, seq.steps[0]);
    await cycle();
    const r0b = await execRow(x0b);
    expect(r0b.status).toBe('skipped');
    expect(r0b.skip_reason).toBe('Étape déjà envoyée');
    rank1 = (await execsOf(e.enrollmentId)).filter((x) => x.step_order === 1);
    expect(rank1, 'toujours une seule variante').toHaveLength(1);

    // La variante est sautée : elle n'est jamais replanifiée (hors saut de branche).
    await admin().from('sequence_step_executions').update({ status: 'skipped', skip_reason: 'Manuellement sautée par le recruteur' }).eq('id', rank1[0].id);
    const x0c = await schedule(org, e.enrollmentId, seq.steps[0]);
    await cycle();
    expect((await execRow(x0c)).skip_reason).toBe('Étape déjà envoyée');
    rank1 = (await execsOf(e.enrollmentId)).filter((x) => x.step_order === 1);
    expect(rank1.map((x) => x.status), 'étape sautée jamais replanifiée').toEqual(['skipped']);
    expect(await sentTexts(accountId), 'le candidat ne reçoit que le premier message').toEqual(['Bonjour']);
  });

  // planif-variantes-anti-doublon (tirage)
  test('planif-variantes-anti-doublon : sur 15 inscriptions reprises par le rattrapage, une variante chacune et les deux variantes tirées', async () => {
    const { org, accountId } = await sendingOrgTracked('E2E Variantes tirage');
    const seq = await insertSequence(org, org.owner.userId, [
      { action_type: 'message', message_template: 'Bonjour' },
      { action_type: 'message', step_order: 1, message_template: 'Variante A', delay_days: 3, variant_group: 'A', variant_weight: 50 },
      { action_type: 'message', step_order: 1, message_template: 'Variante B', delay_days: 3, variant_group: 'B', variant_weight: 50 },
    ]);
    // Inscriptions dormantes : étape 0 partie, rien en attente, pas touchées depuis longtemps.
    const { data: rows, error } = await admin().from('sequence_enrollments').insert(Array.from({ length: 15 }, (_, i) => ({
      sequence_id: seq.sequenceId, organization_id: org.orgId, created_by: org.owner.userId,
      profile_id: `ACoAAE2EVAR${rand()}${i}`, profile_name: 'Camille Martin', account_id: accountId,
      status: 'active', current_step_order: 1, user_timezone: 'Europe/Paris', updated_at: '1990-01-01T00:00:00Z',
    }))).select('id');
    if (error || !rows) throw new Error(`dormantes: ${error?.message}`);
    const ids = rows.map((r) => r.id as string);
    const past = minutesFromNow(-2 * 60);
    const { error: execErr } = await admin().from('sequence_step_executions').insert(ids.map((id) => ({
      enrollment_id: id, organization_id: org.orgId, step_id: seq.steps[0].id, step_order: 0,
      status: 'sent', scheduled_at: past, executed_at: past,
    })));
    if (execErr) throw new Error(`exécutions: ${execErr.message}`);

    // Le rattrapage reprend 5 inscriptions par cycle.
    for (let i = 0; i < 6; i++) {
      await cycle();
      const { count } = await admin().from('sequence_step_executions').select('id', { count: 'exact', head: true })
        .in('enrollment_id', ids).eq('step_order', 1);
      if ((count ?? 0) >= 15) break;
    }
    const { data: rank1 } = await admin().from('sequence_step_executions').select('enrollment_id, variant_assigned, status')
      .in('enrollment_id', ids).eq('step_order', 1);
    const list = (rank1 ?? []) as Array<{ enrollment_id: string; variant_assigned: string | null; status: string }>;
    const perEnrollment = new Map<string, number>();
    for (const r of list) perEnrollment.set(r.enrollment_id, (perEnrollment.get(r.enrollment_id) ?? 0) + 1);
    expect(perEnrollment.size, 'toutes reprises').toBe(15);
    expect([...perEnrollment.values()].every((n) => n === 1), 'une seule variante par inscription').toBe(true);
    expect(new Set(list.map((r) => r.variant_assigned)), 'les deux variantes tirées').toEqual(new Set(['A', 'B']));
    expect(await postsOf(accountId), 'rien ne part : la variante est à J+3').toEqual([]);
  });
});

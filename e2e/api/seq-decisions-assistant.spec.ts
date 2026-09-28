/**
 * Décisions produit du lot assistant (docs/audit-2026-09-25-sequences.md,
 * « Décisions produit en attente ») :
 *   13. Registre d'effacement illisible : l'inscription et l'envoi sont
 *       refusés avec un message clair ; la reprise par le moteur est refusée
 *       sans rien annuler (l'étape en attente garde sa date).
 *   16. Un membre (rôle `member`) a dans l'assistant les mêmes droits que dans
 *       l'interface : lectures de toute l'organisation, actions sur toute la
 *       séquence ; réglages (crédits détaillés, actions de toute
 *       l'organisation) réservés au propriétaire et à l'administrateur.
 *   33. Second « Approuver » sur une action déjà exécutée : refus « déjà
 *       traitée », rien n'est rejoué.
 *   34. Message programmé dont le compte d'envoi a changé avant l'échéance :
 *       échec avec un message, rien ne part.
 *
 * Harnais (mêmes conventions que seq-assistant.spec.ts et seq-scheduled-2.spec.ts) :
 * - approbation : ligne agent_tool_executions « proposed » insérée en clé de
 *   service, puis POST agent-tool-action { approve } avec le JWT du membre ;
 * - lecture et échéance : ligne « approved » échue, puis POST
 *   process-scheduled-actions avec le secret du cron ;
 * - registre illisible : SELECT sur gdpr_erasures retiré au rôle de service
 *   par psql le temps d'un appel, rendu aussitôt (et en fin de test dans tous
 *   les cas). Les suites passent une par une sous le verrou de la stack.
 *
 * Ignoré sans la stack locale (e2e/local-stack/up.sh).
 */
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedMission,
  signIn,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
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
  schedule,
  sendingOrg,
  type MockCall,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(240_000);

// ─── Textes du contrat ──────────────────────────────────────────────────────
const DENIED = "Accès refusé à l'exécution : ";
const GDPR_UNVERIFIED = "L'effacement éventuel des données de ce candidat n'a pas pu être vérifié. Réessayez dans un instant.";
// Décision 13 : la reprise dit que le registre est illisible, plus l'échec générique.
const GDPR_REGISTRY_UNREADABLE = "Le registre des effacements de données n'a pas pu être lu. Réessayez dans un instant.";
const ALREADY_HANDLED = 'Action déjà traitée';
const ACCOUNT_CHANGED =
  "Votre compte LinkedIn d'envoi a changé depuis l'approbation : le message n'est pas parti. Redemandez l'envoi pour qu'il parte de votre compte actuel.";

// ─── Registre des effacements illisible (psql) ──────────────────────────────
function psql(sql: string): string {
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql],
    { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' },
  );
}
const restoreRegistry = () => psql('GRANT SELECT ON public.gdpr_erasures TO service_role;');
/** Appel exécuté pendant que le rôle de service ne peut plus lire gdpr_erasures. */
async function withRegistryUnreadable<T>(fn: () => Promise<T>): Promise<T> {
  psql('REVOKE SELECT ON public.gdpr_erasures FROM service_role;');
  try {
    return await fn();
  } finally {
    restoreRegistry();
  }
}

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
test.afterEach(async () => {
  restoreRegistry();
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    // Tables sans cascade utile (l'organisation elle-même survit, voir deleteOrg).
    for (const table of ['agent_tool_executions', 'job_candidate_status', 'member_quotas', 'organization_subscriptions', 'inmail_queue']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});
function track(org: TestOrg, ...extra: TestUser[]) {
  orgsToDelete.push({ org, extra });
}

// ─── Aides ──────────────────────────────────────────────────────────────────
type Json = Record<string, any>;
type ToolResult = { success?: boolean; error?: string; data?: Json };

async function tokenOf(user: TestUser): Promise<string> {
  return (await signIn(user.email, user.password)).access_token;
}

const newProfileId = () => `ACoAAE2ED${rand()}${rand()}`;

async function propose(orgId: string, userId: string, tool: string, params: Json, details: Json = {}): Promise<string> {
  const { data, error } = await admin()
    .from('agent_tool_executions')
    .insert({
      user_id: userId,
      organization_id: orgId,
      tool_name: tool,
      params,
      status: 'proposed',
      dry_run_result: { summary: `Test e2e ${tool}`, details },
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`propose: ${error?.message}`);
  return data.id as string;
}

function approve(token: string, executionId: string) {
  return callFunction('agent-tool-action', token, { execution_id: executionId, action: 'approve' });
}

interface ExecRow {
  status: string;
  real_result: ToolResult | null;
  scheduled_for: string | null;
  executed_at: string | null;
}
async function execRow(id: string): Promise<ExecRow> {
  const { data } = await admin()
    .from('agent_tool_executions')
    .select('status, real_result, scheduled_for, executed_at')
    .eq('id', id)
    .single();
  return data as ExecRow;
}

function cronScheduled() {
  return postJson('/functions/v1/process-scheduled-actions', {}, { Authorization: `Bearer ${CRON_SECRET}` });
}
async function runScheduledUntilDone(ids: string[]) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await cronScheduled();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { data } = await admin().from('agent_tool_executions').select('id, status').in('id', ids);
    if ((data ?? []).every((r) => r.status !== 'approved')) return;
  }
  throw new Error('actions programmées jamais traitées par process-scheduled-actions');
}

/** Outil de lecture exécuté pour ce membre par le chemin cron. */
async function readTool(orgId: string, userId: string, tool: string, params: Json) {
  const { data, error } = await admin()
    .from('agent_tool_executions')
    .insert({
      user_id: userId,
      organization_id: orgId,
      tool_name: tool,
      params,
      status: 'approved',
      approved_at: new Date().toISOString(),
      scheduled_for: minutesFromNow(-1),
      dry_run_result: { summary: `Lecture e2e ${tool}`, details: {} },
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`readTool: ${error?.message}`);
  await runScheduledUntilDone([data.id as string]);
  const row = await execRow(data.id as string);
  return { status: row.status, result: (row.real_result ?? {}) as ToolResult };
}

/** Proposition programmée dans deux heures, puis « Approuver » : la ligne attend le cron. */
async function approveForLater(orgId: string, user: TestUser, tool: string, params: Json, details: Json = {}): Promise<string> {
  const id = await propose(orgId, user.userId, tool, params, { ...details, scheduled_for: minutesFromNow(120) });
  const res = await approve(await tokenOf(user), id);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect((res.body.data as Json | undefined)?.scheduled, 'approbation mise en file').toBe(true);
  return id;
}
async function runWhenDue(id: string): Promise<ExecRow> {
  await admin().from('agent_tool_executions').update({ scheduled_for: minutesFromNow(-1) }).eq('id', id);
  await runScheduledUntilDone([id]);
  return execRow(id);
}

const WEEKDAY_ZONES = [
  'Europe/Paris', 'Pacific/Kiritimati', 'Pacific/Apia', 'Pacific/Auckland', 'Asia/Tokyo',
  'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Pacific/Pago_Pago',
];
function weekdayZone(): string | null {
  for (const tz of WEEKDAY_ZONES) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date());
    const weekday = parts.find((p) => p.type === 'weekday')?.value;
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    if (weekday !== 'Sat' && weekday !== 'Sun' && hour >= 1 && hour <= 22) return tz;
  }
  return null;
}
const SEND_ZONE = weekdayZone();

/** Plage 0 h-24 h dans un fuseau en jour ouvré (checkLinkedInQuota refuse le week-end). */
async function openBusinessHours(orgId: string, userId: string) {
  const { error } = await admin().from('member_quotas').upsert(
    { organization_id: orgId, user_id: userId, business_hours_start: 0, business_hours_end: 24, timezone: SEND_ZONE },
    { onConflict: 'organization_id,user_id' },
  );
  if (error) throw new Error(`member_quotas: ${error.message}`);
}

async function newChatsTo(accountId: string, recipient: string): Promise<MockCall[]> {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST' && c.path === '/api/v1/chats'
    && (c.body as Record<string, unknown>)?.attendees_ids === recipient);
}
async function postsFrom(accountId: string): Promise<MockCall[]> {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST');
}

async function seedCandidate(orgId: string, createdBy: string, o: { id: string; name?: string; url?: string | null; projectId?: string | null }) {
  const { error } = await admin().from('job_candidate_status').insert({
    organization_id: orgId,
    created_by: createdBy,
    candidate_id: o.id,
    candidate_name: o.name ?? 'Camille Martin',
    linkedin_profile_url: o.url ?? null,
    job_id: o.projectId ? `project:${o.projectId}` : `job_${rand()}`,
    project_id: o.projectId ?? null,
    status: 'new',
    pipeline_stage: 'Nouveau',
  });
  if (error) throw new Error(`seedCandidate: ${error.message}`);
}

async function enrollmentsOf(sequenceId: string, profileId: string) {
  const { data } = await admin().from('sequence_enrollments').select('id, status').eq('sequence_id', sequenceId).eq('profile_id', profileId);
  return data ?? [];
}

// ════════════════════════════════════════════════════════════════════════════
// Décision 13 : registre des effacements illisible
// ════════════════════════════════════════════════════════════════════════════
test.describe('Décision 13 : registre des effacements illisible', () => {
  test.describe.configure({ mode: 'serial' });

  test('message ponctuel de l’assistant : refus avec un message clair et rien ne part ; registre relu, le même message part', async () => {
    const { org, accountId } = await sendingOrg('E2E D13 message');
    track(org);
    const recipient = newProfileId();
    // URL connue par le pipeline : le contrôle consulte le registre global.
    await seedCandidate(org.orgId, org.owner.userId, { id: recipient, url: `https://www.linkedin.com/in/e2e-d13-${rand()}` });
    const token = await tokenOf(org.owner);

    const id = await propose(org.orgId, org.owner.userId, 'send_linkedin_message', { recipient_provider_id: recipient, text: 'Bonjour, registre illisible.' });
    const res = await withRegistryUnreadable(() => approve(token, id));
    expect(res.body.success, JSON.stringify(res.body)).toBe(false);
    expect(res.body.error).toBe(DENIED + GDPR_UNVERIFIED);
    const row = await execRow(id);
    expect(row.status).toBe('failed');
    expect(await postsFrom(accountId), 'rien ne part').toEqual([]);

    // Témoin : registre relu, le contrôle laisse passer le même envoi (jour
    // ouvré requis par checkLinkedInQuota, sinon témoin sauté).
    if (SEND_ZONE) {
      await openBusinessHours(org.orgId, org.owner.userId);
      const again = await propose(org.orgId, org.owner.userId, 'send_linkedin_message', { recipient_provider_id: recipient, text: 'Bonjour, registre relu.' });
      const ok = await approve(token, again);
      expect(ok.body.success, JSON.stringify(ok.body)).toBe(true);
      expect(await newChatsTo(accountId, recipient)).toHaveLength(1);
    }
  });

  test('inscription par l’assistant : refus avec un message clair, aucune inscription ; registre relu, l’inscription passe', async () => {
    const { org } = await sendingOrg('E2E D13 inscription');
    track(org);
    const mission = await seedMission(org.orgId, org.owner.userId);
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour {{first_name}}']);
    const candidate = newProfileId();
    const params = {
      sequence_id: sequenceId,
      candidate_id: candidate,
      profile_url: `https://www.linkedin.com/in/e2e-d13-enroll-${rand()}`,
      profile_name: 'Camille Martin',
      job_id: mission,
    };
    const token = await tokenOf(org.owner);

    const id = await propose(org.orgId, org.owner.userId, 'enroll_in_sequence', params);
    const res = await withRegistryUnreadable(() => approve(token, id));
    expect(res.body.success, JSON.stringify(res.body)).toBe(false);
    expect(res.body.error).toBe(GDPR_UNVERIFIED);
    expect((await execRow(id)).status).toBe('failed');
    expect(await enrollmentsOf(sequenceId, candidate), 'aucune inscription').toEqual([]);

    // Témoin : registre relu, la même inscription passe.
    const again = await propose(org.orgId, org.owner.userId, 'enroll_in_sequence', params);
    const ok = await approve(token, again);
    expect(ok.body.success, JSON.stringify(ok.body)).toBe(true);
    expect(await enrollmentsOf(sequenceId, candidate)).toHaveLength(1);
  });

  test('reprise d’une inscription par le moteur : refus sans rien annuler, l’étape en attente garde sa date ; registre relu, la reprise passe', async () => {
    const { org, accountId } = await sendingOrg('E2E D13 reprise');
    track(org);
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId, {
      status: 'paused', pause_reason: 'manual', current_step_order: 1,
      profile_url: `https://www.linkedin.com/in/e2e-d13-reprise-${rand()}`,
    });
    const later = minutesFromNow(2 * 24 * 60);
    const pending = await schedule(org, enrollmentId, steps[1], { scheduled_at: later });
    const token = await tokenOf(org.owner);
    const body = { action: 'resume_enrollments', organization_id: org.orgId, enrollment_ids: [enrollmentId] };

    const res = await withRegistryUnreadable(() => callFunction('process-sequences', token, body));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const result = (res.body.results as Array<{ enrollment_id: string; outcome: string; message?: string }>)
      .find((r) => r.enrollment_id === enrollmentId);
    expect(result, JSON.stringify(res.body)).toMatchObject({ outcome: 'error', message: GDPR_REGISTRY_UNREADABLE });
    expect(await enrollmentRow(enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'manual' });
    const [kept] = (await executionsOf(enrollmentId)).filter((e) => e.id === pending);
    expect(kept.status, 'étape reportée, jamais annulée').toBe('scheduled');
    expect(Date.parse(kept.scheduled_at)).toBe(Date.parse(later));

    // Témoin : registre relu, la reprise passe et l'étape garde sa date.
    const ok = await callFunction('process-sequences', token, body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((ok.body.results as Array<{ enrollment_id: string; outcome: string }>)[0]).toMatchObject({ enrollment_id: enrollmentId, outcome: 'resumed' });
    expect((await enrollmentRow(enrollmentId)).status).toBe('active');
    const [after] = (await executionsOf(enrollmentId)).filter((e) => e.id === pending);
    expect(after.status).toBe('scheduled');
    expect(Date.parse(after.scheduled_at)).toBe(Date.parse(later));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Décision 16 : un membre a les mêmes droits que dans l'interface
// ════════════════════════════════════════════════════════════════════════════
test.describe('Décision 16 : rôle membre dans l’assistant', () => {
  test.describe.configure({ mode: 'serial' });

  test('un membre lit les missions, le pipeline et la prospection de toute l’organisation ; un collaborateur reste limité à ses missions', async () => {
    const org = await createOrg('agency', 'E2E D16 lectures');
    const member = await addMember(org.orgId, 'member', 'membre');
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    track(org, member, collab);
    // Mission du propriétaire : le membre n'est ni son auteur ni dans son équipe.
    const mission = await seedMission(org.orgId, org.owner.userId);
    const candidate = newProfileId();
    const name = `Lina Garnier ${rand()}`;
    await seedCandidate(org.orgId, org.owner.userId, { id: candidate, name, projectId: mission });
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    await enroll(org, sequenceId, org.owner.userId, `acc_${rand()}`, { profile_id: candidate, provider_id: candidate, job_id: mission, profile_name: name });

    const missions = await readTool(org.orgId, member.userId, 'get_my_missions', {});
    expect(missions.status, JSON.stringify(missions.result)).toBe('executed');
    expect(missions.result.data?.role).toBe('member');
    expect(((missions.result.data?.missions ?? []) as Array<{ id: string }>).map((m) => m.id)).toContain(mission);

    const overview = await readTool(org.orgId, member.userId, 'get_mission_overview', { mission_id: mission });
    expect(overview.status, JSON.stringify(overview.result)).toBe('executed');
    expect(overview.result.data?.candidates_loaded).toBe(1);

    const outreach = await readTool(org.orgId, member.userId, 'get_candidate_outreach', { candidate_id: candidate });
    expect(outreach.status, JSON.stringify(outreach.result)).toBe('executed');
    expect(outreach.result.data?.enrollments ?? [], 'inscription d’un collègue visible, comme dans l’interface').toHaveLength(1);

    // Réglages de l'organisation : réservés au propriétaire et à l'administrateur, comme dans l'interface.
    const actions = await readTool(org.orgId, member.userId, 'get_recent_agent_actions', { scope: 'org' });
    expect(actions.status, JSON.stringify(actions.result)).toBe('executed');
    expect(actions.result.data?.scope).toBe('mine');
    const team = await readTool(org.orgId, member.userId, 'get_team_overview', {});
    expect(team.result.data?.my_role).toBe('member');
    expect(team.result.data?.ai_credits?.balance, 'solde détaillé masqué').toBeUndefined();

    // Témoin : le collaborateur ne voit toujours que ses missions.
    const collabMissions = await readTool(org.orgId, collab.userId, 'get_my_missions', {});
    expect(((collabMissions.result.data?.missions ?? []) as Array<{ id: string }>).map((m) => m.id)).not.toContain(mission);
    const collabOverview = await readTool(org.orgId, collab.userId, 'get_mission_overview', { mission_id: mission });
    expect(collabOverview.status).toBe('failed');
    expect(String(collabOverview.result.error)).toContain("Tu n'as pas accès à cette mission");
  });

  test('un membre met en pause la séquence d’un collègue, comme dans l’interface', async () => {
    const { org, accountId } = await sendingOrg('E2E D16 actions');
    const member = await addMember(org.orgId, 'member', 'membre');
    track(org, member);
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);

    const id = await propose(org.orgId, member.userId, 'pause_sequence', { sequence_id: sequenceId });
    const res = await approve(await tokenOf(member), id);
    expect(res.body.success, JSON.stringify(res.body)).toBe(true);
    expect(await enrollmentRow(enrollmentId)).toMatchObject({ status: 'paused', pause_reason: 'sequence_inactive' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Décision 33 : second « Approuver » sur une action déjà exécutée
// ════════════════════════════════════════════════════════════════════════════
test.describe('Décision 33 : action déjà exécutée', () => {
  test.describe.configure({ mode: 'serial' });

  test('second « Approuver » : refus « Action déjà traitée », rien n’est rejoué ; un tiers reçoit Forbidden sans le résultat', async () => {
    const { org, accountId } = await sendingOrg('E2E D33 déjà traitée');
    const otherAdmin = await addMember(org.orgId, 'admin', 'admin');
    track(org, otherAdmin);
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    const token = await tokenOf(org.owner);

    const id = await propose(org.orgId, org.owner.userId, 'pause_sequence', { sequence_id: sequenceId });
    const first = await approve(token, id);
    expect(first.body.success, JSON.stringify(first.body)).toBe(true);
    const executed = await execRow(id);
    expect(executed.status).toBe('executed');

    // La séquence repart entre les deux clics : un second clic rejoué la remettrait en pause.
    await admin().from('outreach_sequences').update({ is_active: true }).eq('id', sequenceId);
    await admin().from('sequence_enrollments').update({ status: 'active', pause_reason: null }).eq('id', enrollmentId);

    const second = await approve(token, id);
    expect(second.status).toBe(400);
    expect(second.body.success).toBe(false);
    expect(second.body.error).toBe(ALREADY_HANDLED);
    expect(JSON.stringify(second.body)).not.toContain('paused_enrollments');
    expect((await enrollmentRow(enrollmentId)).status, 'rien n’est rejoué').toBe('active');
    const { data: seq } = await admin().from('outreach_sequences').select('is_active').eq('id', sequenceId).single();
    expect(seq?.is_active).toBe(true);
    const after = await execRow(id);
    expect(after.status).toBe('executed');
    expect(after.executed_at).toBe(executed.executed_at);
    expect(after.real_result).toEqual(executed.real_result);

    // Un autre administrateur : refus de propriété, jamais le résultat relu.
    const stranger = await approve(await tokenOf(otherAdmin), id);
    expect(stranger.body.success).toBe(false);
    expect(String(stranger.body.error)).toMatch(/^Forbidden/);
    expect(JSON.stringify(stranger.body)).not.toContain('paused_enrollments');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Décision 34 : message programmé, compte d'envoi changé avant l'échéance
// ════════════════════════════════════════════════════════════════════════════
test.describe('Décision 34 : compte d’envoi changé avant l’échéance', () => {
  test.describe.configure({ mode: 'serial' });

  test('liaison remplacée par un autre compte : échec avec un message, rien ne part ni de l’ancien ni du nouveau compte', async () => {
    const { org, accountId } = await sendingOrg('E2E D34 compte remplacé');
    track(org);
    if (SEND_ZONE) await openBusinessHours(org.orgId, org.owner.userId);
    const recipient = newProfileId();
    const id = await approveForLater(org.orgId, org.owner, 'send_linkedin_message',
      { recipient_provider_id: recipient, text: 'Bonjour, message programmé.' },
      { account_id: accountId, account_auto_resolved: true });

    // Même écriture que claim_linkedin_account sur la ligne existante (organisation, utilisateur).
    const newAccount = `acc_d34_${rand()}`;
    const { error } = await admin().from('member_linkedin_accounts')
      .update({ linkedin_account_id: newAccount, linked_at: new Date().toISOString(), account_status: 'OK' })
      .eq('linkedin_account_id', accountId);
    expect(error).toBeNull();

    const row = await runWhenDue(id);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
    expect(row.real_result?.error).toBe(ACCOUNT_CHANGED);
    expect(await postsFrom(accountId), 'rien ne part du compte quitté').toEqual([]);
    expect(await postsFrom(newAccount), 'rien ne part du nouveau compte').toEqual([]);
    const { count } = await admin().from('linkedin_action_log').select('id', { count: 'exact', head: true }).in('account_id', [accountId, newAccount]);
    expect(count, 'aucune action décomptée').toBe(0);
  });

  test('témoin : compte inchangé, le message programmé part du compte affiché à l’approbation', async () => {
    test.skip(!SEND_ZONE, 'aucun fuseau en jour ouvré : checkLinkedInQuota refuse tout envoi le week-end');
    const { org, accountId } = await sendingOrg('E2E D34 témoin');
    track(org);
    await openBusinessHours(org.orgId, org.owner.userId);
    const recipient = newProfileId();
    const id = await approveForLater(org.orgId, org.owner, 'send_linkedin_message',
      { recipient_provider_id: recipient, text: 'Bonjour, message programmé.' },
      { account_id: accountId, account_auto_resolved: true });
    const row = await runWhenDue(id);
    expect(row.status, JSON.stringify(row.real_result)).toBe('executed');
    expect(await newChatsTo(accountId, recipient)).toHaveLength(1);
  });
});

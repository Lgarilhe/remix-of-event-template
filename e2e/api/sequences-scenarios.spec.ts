/**
 * Scénarios de bout en bout du moteur de séquences (audit 2026-09-25,
 * « Vérifications à faire à la main »). Le moteur process-sequences tourne pour
 * de vrai ; LinkedIn est simulé par e2e/local-stack/vendor-mock.mjs, qui
 * journalise chaque appel au lieu de l'envoyer.
 *
 * Ignoré sans E2E_VENDOR_MOCK_URL et E2E_PROCESS_SEQUENCES_SECRET, posés par
 * e2e/local-stack/up.sh : la CI actuelle ne sert pas les edge functions.
 *
 * Le cycle `process` balaie toute la base sous un verrou global : ce fichier
 * tourne en série, et avec --workers=1 si d'autres suites laissent des
 * exécutions échues. `force: true` lève la seule fenêtre d'envoi (jours ouvrés,
 * 8 h-19 h) pour que le test passe aussi le soir et le week-end.
 *
 * @critical
 */
import { test, expect, request } from '@playwright/test';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedLinkedInAccount,
  seedSequence,
  signIn,
  type SeededStep,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';

const MOCK_URL = process.env.E2E_VENDOR_MOCK_URL ?? '';
const CRON_SECRET = process.env.E2E_PROCESS_SEQUENCES_SECRET ?? '';
const WEBHOOK_SECRET = process.env.E2E_UNIPILE_WEBHOOK_SECRET ?? '';

test.skip(
  process.env.E2E_EDGE_FUNCTIONS !== '1' || !MOCK_URL || !CRON_SECRET,
  'moteur et faux prestataires absents (lancer e2e/local-stack/up.sh)',
);
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const rand = () => Math.random().toString(36).slice(2, 10);
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

interface MockCall {
  method: string;
  path: string;
  account_id: string | null;
  body: Record<string, unknown> | string;
}

async function mockCalls(accountId: string): Promise<MockCall[]> {
  const res = await fetch(`${MOCK_URL}/__log?account_id=${encodeURIComponent(accountId)}`);
  return (await res.json()) as MockCall[];
}

/** Messages LinkedIn réellement envoyés depuis ce compte (nouvelle conversation ou suite). */
async function sentTexts(accountId: string): Promise<string[]> {
  return (await mockCalls(accountId))
    .filter((c) => c.method === 'POST' && (c.path === '/api/v1/chats' || /^\/api\/v1\/chats\/[^/]+\/messages$/.test(c.path)))
    .map((c) => String((c.body as Record<string, unknown>).text ?? ''));
}

async function postJson(path: string, body: unknown, headers: Record<string, string>) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${E2E.supabaseUrl}${path}`, {
    headers: { apikey: E2E.anonKey, 'Content-Type': 'application/json', ...headers },
    data: body,
  });
  const status = res.status();
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  await ctx.dispose();
  return { status, body: json };
}

/** Un cycle du moteur, comme le cron. Réessaie si un autre cycle tient le verrou. */
async function runCycle(): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await postJson('/functions/v1/process-sequences', { action: 'process', force: true }, {
      Authorization: `Bearer ${CRON_SECRET}`,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    if (res.body.skipped_reason !== 'lock_held') return res.body;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('verrou du moteur jamais libéré');
}

async function webhook(payload: Record<string, unknown>) {
  const res = await postJson('/functions/v1/unipile-webhook', payload, { 'unipile-auth': WEBHOOK_SECRET });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

/** Organisation qui a le droit d'envoyer : offre payante active et compte LinkedIn relié au propriétaire. */
async function sendingOrg(prefix: string): Promise<{ org: TestOrg; accountId: string }> {
  const org = await createOrg('agency', prefix);
  const { error } = await admin()
    .from('organization_subscriptions')
    .upsert({ organization_id: org.orgId, plan_id: 'cabinet', status: 'active' }, { onConflict: 'organization_id' });
  if (error) throw new Error(`organization_subscriptions: ${error.message}`);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_${rand()}`, 'OK');
  return { org, accountId };
}

async function messageSequence(org: TestOrg, createdBy: string, templates: string[], delayDays = 3) {
  const seeded = await seedSequence(org.orgId, createdBy, templates.map((_, i) => ({
    action_type: 'message', delay_days: i === 0 ? 0 : delayDays,
  })));
  for (const [i, step] of seeded.steps.entries()) {
    await admin().from('sequence_steps').update({ message_template: templates[i] }).eq('id', step.id);
  }
  return seeded;
}

async function enroll(
  org: TestOrg,
  sequenceId: string,
  createdBy: string,
  accountId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ enrollmentId: string; profileId: string }> {
  const profileId = `ACoAAE2E${rand()}${rand()}`;
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .insert({
      sequence_id: sequenceId,
      organization_id: org.orgId,
      created_by: createdBy,
      profile_id: profileId,
      profile_name: 'Camille Martin',
      account_id: accountId,
      status: 'active',
      current_step_order: 0,
      user_timezone: 'Europe/Paris',
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`enroll: ${error?.message}`);
  return { enrollmentId: data.id as string, profileId };
}

async function schedule(
  org: TestOrg,
  enrollmentId: string,
  step: SeededStep,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .insert({
      enrollment_id: enrollmentId,
      organization_id: org.orgId,
      step_id: step.id,
      step_order: step.step_order,
      status: 'scheduled',
      scheduled_at: minutesFromNow(-1),
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`schedule: ${error?.message}`);
  return data.id as string;
}

async function executionsOf(enrollmentId: string) {
  const { data } = await admin()
    .from('sequence_step_executions')
    .select('id, step_order, status, scheduled_at, final_message, skip_reason')
    .eq('enrollment_id', enrollmentId)
    .order('step_order');
  return (data ?? []) as Array<{ id: string; step_order: number; status: string; scheduled_at: string; final_message: string | null; skip_reason: string | null }>;
}

async function enrollmentRow(id: string) {
  const { data } = await admin()
    .from('sequence_enrollments')
    .select('status, pause_reason, current_step_order')
    .eq('id', id)
    .single();
  return data as { status: string; pause_reason: string | null; current_step_order: number };
}

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
test.afterEach(async () => {
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    await deleteOrg(org, extra);
  }
});

test.describe('@critical Scénarios moteur de séquences', () => {
  test("scénario 2 : le texte modifié (aperçu ou Journal) est celui qui part et celui du Journal", async () => {
    const { org, accountId } = await sendingOrg('E2E Scénario 2');
    orgsToDelete.push({ org, extra: [] });
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour {{prenom}}', 'Relance {{prenom}}']);

    // Trois candidats : aperçu modifié à l'inscription, correction faite ensuite
    // dans le Journal, modèle de l'étape.
    const edited = await enroll(org, sequenceId, org.owner.userId, accountId, {
      tracking_data: { message_overrides: { [steps[0].id]: { message: 'Aperçu modifié pour ce candidat' } } },
    });
    const journal = await enroll(org, sequenceId, org.owner.userId, accountId, {
      tracking_data: { message_overrides: { [steps[0].id]: { message: 'Aperçu remplacé ensuite' } } },
    });
    const plain = await enroll(org, sequenceId, org.owner.userId, accountId);
    await schedule(org, edited.enrollmentId, steps[0]);
    await schedule(org, journal.enrollmentId, steps[0], { final_message: 'Texte corrigé dans le Journal' });
    await schedule(org, plain.enrollmentId, steps[0]);

    await runCycle();

    const texts = await sentTexts(accountId);
    expect(texts, 'trois messages partis depuis ce compte').toHaveLength(3);
    expect(texts).toContain('Aperçu modifié pour ce candidat');
    expect(texts).toContain('Texte corrigé dans le Journal');
    expect(texts.some((t) => t.startsWith('Bonjour'))).toBe(true);
    expect(texts.some((t) => t.includes('{{')), 'aucune variable non remplacée').toBe(false);

    for (const [who, expected] of [
      [edited, 'Aperçu modifié pour ce candidat'],
      [journal, 'Texte corrigé dans le Journal'],
    ] as const) {
      const execs = await executionsOf(who.enrollmentId);
      expect(execs[0].status).toBe('sent');
      expect(execs[0].final_message, 'le Journal affiche le texte parti').toBe(expected);
      // Relance planifiée à J+3, pas tout de suite.
      expect(execs[1]?.status).toBe('scheduled');
      expect(new Date(execs[1].scheduled_at).getTime()).toBeGreaterThan(Date.now() + 2 * 24 * 3600_000);
      expect((await enrollmentRow(who.enrollmentId)).current_step_order).toBe(1);
    }
    const plainExec = (await executionsOf(plain.enrollmentId))[0];
    expect(plainExec.status).toBe('sent');
    expect(texts).toContain(plainExec.final_message);
  });

  test('scénario 5 : une réponse du candidat clôt l’inscription et annule la relance programmée', async () => {
    const { org, accountId } = await sendingOrg('E2E Scénario 5');
    orgsToDelete.push({ org, extra: [] });
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, { current_step_order: 1 });
    await schedule(org, enrollmentId, steps[0], { status: 'sent', scheduled_at: minutesFromNow(-2 * 24 * 60), executed_at: minutesFromNow(-2 * 24 * 60) });
    const followUp = await schedule(org, enrollmentId, steps[1], { scheduled_at: minutesFromNow(24 * 60) });

    await webhook({
      event: 'message_received',
      account_id: accountId,
      account_type: 'LINKEDIN',
      chat_id: `chat_${rand()}`,
      message_id: `msg_${rand()}`,
      message: 'Bonjour, oui avec plaisir',
      sender: { attendee_provider_id: profileId, attendee_id: 'att_candidate', attendee_name: 'Camille Martin' },
    });

    const enrollment = await enrollmentRow(enrollmentId);
    expect(enrollment.status, 'inscription « A répondu »').toBe('replied');
    const execs = await executionsOf(enrollmentId);
    expect(execs.find((e) => e.id === followUp)?.status, 'relance annulée').toBe('cancelled');

    // Même la relance ramenée à maintenant ne part pas.
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', followUp);
    await runCycle();
    expect(await sentTexts(accountId)).toEqual([]);
  });

  test('scénario 4 : déconnexion puis reconnexion du compte, séquence active : l’envoi reprend', async () => {
    const { org, accountId } = await sendingOrg('E2E Scénario 4 actif');
    orgsToDelete.push({ org, extra: [] });
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    await schedule(org, enrollmentId, steps[0]);

    await webhook({ AccountStatus: { account_id: accountId, account_type: 'LINKEDIN', message: 'CREDENTIALS' } });
    await runCycle();
    expect(await sentTexts(accountId), 'rien ne part compte déconnecté').toEqual([]);
    const paused = await enrollmentRow(enrollmentId);
    expect(paused.status).toBe('paused');
    expect(paused.pause_reason).toBe('account_disconnected');

    await webhook({ AccountStatus: { account_id: accountId, account_type: 'LINKEDIN', message: 'OK' } });
    const resumed = await enrollmentRow(enrollmentId);
    expect(resumed.status, 'reprise automatique à la reconnexion').toBe('active');
    const pending = (await executionsOf(enrollmentId)).filter((e) => e.status === 'scheduled');
    expect(pending, 'une exécution replanifiée pour l’étape interrompue').toHaveLength(1);
    expect(pending[0].step_order).toBe(0);

    // L'exécution replanifiée part au cycle où elle est due.
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) }).eq('id', pending[0].id);
    await runCycle();
    expect(await sentTexts(accountId)).toEqual(['Bonjour']);
  });

  test('scénario 4 : reconnexion pendant que la séquence est désactivée : rien ne part (D1)', async () => {
    const { org, accountId } = await sendingOrg('E2E Scénario 4 inactif');
    orgsToDelete.push({ org, extra: [] });
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour', 'Relance']);
    const { enrollmentId } = await enroll(org, sequenceId, org.owner.userId, accountId);
    await schedule(org, enrollmentId, steps[0]);

    await webhook({ AccountStatus: { account_id: accountId, account_type: 'LINKEDIN', message: 'CREDENTIALS' } });
    await runCycle();
    expect((await enrollmentRow(enrollmentId)).pause_reason).toBe('account_disconnected');

    // La séquence est désactivée pendant la panne, puis le compte revient.
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', sequenceId);
    await webhook({ AccountStatus: { account_id: accountId, account_type: 'LINKEDIN', message: 'OK' } });

    const after = await enrollmentRow(enrollmentId);
    expect(after.status, 'pas de reprise sur une séquence désactivée').toBe('paused');
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) })
      .eq('enrollment_id', enrollmentId).eq('status', 'scheduled');
    await runCycle();
    expect(await sentTexts(accountId)).toEqual([]);
  });

  test('scénario 7 : retirer un membre met ses inscriptions en pause, rien ne part ensuite', async () => {
    const { org } = await sendingOrg('E2E Scénario 7');
    const member = await addMember(org.orgId, 'member', 'retire');
    orgsToDelete.push({ org, extra: [member] });
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_${rand()}`, 'OK');
    const { sequenceId, steps } = await messageSequence(org, member.userId, ['Bonjour', 'Relance']);
    const a = await enroll(org, sequenceId, member.userId, memberAccount);
    const b = await enroll(org, sequenceId, member.userId, memberAccount);
    const dueAt = minutesFromNow(-1);
    const execA = await schedule(org, a.enrollmentId, steps[0], { scheduled_at: dueAt });
    const execB = await schedule(org, b.enrollmentId, steps[0], { scheduled_at: dueAt });

    const ownerToken = (await signIn(org.owner.email, org.owner.password)).access_token;
    const res = await postJson('/functions/v1/unipile-accounts', {
      action: 'stop_member_linkedin', organization_id: org.orgId, member_user_id: member.userId,
    }, { Authorization: `Bearer ${ownerToken}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    for (const id of [a.enrollmentId, b.enrollmentId]) {
      const row = await enrollmentRow(id);
      expect(row.status).toBe('paused');
      expect(row.pause_reason).toBe('manual');
    }
    // La pause garde les exécutions avec leur date (contrat : aucune pause n'annule).
    for (const id of [execA, execB]) {
      const { data } = await admin().from('sequence_step_executions').select('status, scheduled_at').eq('id', id).single();
      expect(data?.status).toBe('scheduled');
      expect(new Date(data!.scheduled_at as string).getTime()).toBe(new Date(dueAt).getTime());
    }

    await runCycle();
    expect(await sentTexts(memberAccount), 'aucun envoi depuis le compte du membre retiré').toEqual([]);
  });

  test("scénario 6 : un collaborateur voit les doublons de toute l'organisation, pas les inscriptions des autres", async () => {
    const { org, accountId } = await sendingOrg('E2E Scénario 6');
    const collaborator = await addMember(org.orgId, 'collaborator', 'collab');
    orgsToDelete.push({ org, extra: [collaborator] });
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const slug = `jeanne-dupont-${rand()}`;
    const { enrollmentId, profileId } = await enroll(org, sequenceId, org.owner.userId, accountId, {
      profile_url: `https://www.linkedin.com/in/${slug}/`,
    });

    const token = (await signIn(collaborator.email, collaborator.password)).access_token;
    const rpc = (body: Record<string, unknown>) => postJson('/rest/v1/rpc/find_recent_org_contacts', {
      p_org: org.orgId, p_values: [], p_slugs: [], p_since: minutesFromNow(-90 * 24 * 60), ...body,
    }, { Authorization: `Bearer ${token}` });

    const byId = await rpc({ p_values: [profileId] });
    expect(byId.status, JSON.stringify(byId.body)).toBe(200);
    expect(byId.body as unknown as Array<{ created_by: string }>).toEqual([
      expect.objectContaining({ profile_id: profileId, created_by: org.owner.userId, status: 'active' }),
    ]);
    const bySlug = await rpc({ p_slugs: [slug] });
    expect((bySlug.body as unknown as unknown[]).length, 'même candidat reconnu par son adresse').toBe(1);
    const byPrefix = await rpc({ p_slugs: ['jeanne-dupont'] });
    expect((byPrefix.body as unknown as unknown[]).length, 'un préfixe ne suffit pas').toBe(0);

    // Lecture directe : l'inscription d'un collègue reste invisible au collaborateur.
    const ctx = await request.newContext();
    const direct = await ctx.get(`${E2E.supabaseUrl}/rest/v1/sequence_enrollments?id=eq.${enrollmentId}&select=id`, {
      headers: { apikey: E2E.anonKey, Authorization: `Bearer ${token}` },
    });
    expect(await direct.json()).toEqual([]);
    await ctx.dispose();

    // Une autre organisation est refusée.
    const other = await createOrg('agency', 'E2E Scénario 6 autre');
    orgsToDelete.push({ org: other, extra: [] });
    const otherToken = (await signIn(other.owner.email, other.owner.password)).access_token;
    const refused = await postJson('/rest/v1/rpc/find_recent_org_contacts', {
      p_org: org.orgId, p_values: [profileId], p_slugs: [], p_since: null,
    }, { Authorization: `Bearer ${otherToken}` });
    expect(refused.status).toBe(403);
  });

  test('sélection du moteur : un compte au plafond ne bloque pas les suivants (pages 2 et plus)', async () => {
    // 205 exécutions échues d'un compte non relié remplissent la première page
    // (200 lignes). Ce compte atteint son plafond de cycle (3) : la page 2 est lue
    // avec le filtre qui l'exclut, et les deux exécutions d'un autre compte,
    // plus récentes, partent dans le même cycle.
    const { org, accountId } = await sendingOrg('E2E Sélection');
    orgsToDelete.push({ org, extra: [] });
    const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const saturated = `acc_sat_${rand()}`;
    const base = Date.now() - 60 * 60_000;
    const { data: crowd, error } = await admin()
      .from('sequence_enrollments')
      .insert(Array.from({ length: 205 }, (_, i) => ({
        sequence_id: sequenceId, organization_id: org.orgId, created_by: org.owner.userId,
        profile_id: `ACoAAE2ESAT${rand()}${i}`, profile_name: 'Candidat Page Un', account_id: saturated,
        status: 'active', current_step_order: 0, user_timezone: 'Europe/Paris',
      })))
      .select('id');
    if (error || !crowd) throw new Error(`crowd: ${error?.message}`);
    const { error: execErr } = await admin().from('sequence_step_executions').insert(crowd.map((row, i) => ({
      enrollment_id: row.id, organization_id: org.orgId, step_id: steps[0].id, step_order: 0,
      status: 'scheduled', scheduled_at: new Date(base + i * 1_000).toISOString(),
    })));
    if (execErr) throw new Error(`crowd executions: ${execErr.message}`);

    const late = [
      await enroll(org, sequenceId, org.owner.userId, accountId),
      await enroll(org, sequenceId, org.owner.userId, accountId),
    ];
    for (const l of late) await schedule(org, l.enrollmentId, steps[0], { scheduled_at: minutesFromNow(-1) });

    await runCycle();
    expect(await sentTexts(accountId), 'les deux messages du second compte partent').toEqual(['Bonjour', 'Bonjour']);
  });
});

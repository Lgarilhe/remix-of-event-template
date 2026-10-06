/**
 * Module séquences, lot « db » : RLS et infrastructure du moteur vues depuis
 * l'API REST (PostgREST), avec de vrais JWT (propriétaire, autre organisation,
 * anonyme). Le reste du lot (déclencheurs, save_sequence_steps, reprise des
 * données héritées par la migration B6, quotas LinkedIn) est dans
 * supabase/tests/seq_db_audit.sql.
 *
 * Contrat : CLAUDE.md, section « Séquences : règles du moteur et de
 * l'interface », et docs/audit-2026-09-25-sequences.md (SEQ-009, SEQ-011,
 * SEQ-057, SEQ-217). Aucune exécution due n'est semée : le moteur, s'il
 * tourne, n'a rien à prendre dans ces données.
 */
import { test, expect } from '@playwright/test';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedEnrollment,
  seedExecution,
  seedSequence,
  signIn,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import { ENGINE_SKIP_REASON, engineAvailable, rand } from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const logAccounts: string[] = [];

test.afterEach(async () => {
  const a = admin();
  if (logAccounts.length) {
    await a.from('linkedin_action_log').delete().in('account_id', logAccounts.splice(0));
  }
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    // Tables sans cascade depuis l'organisation, ou que deleteOrg ne vide pas.
    await a.from('inmail_queue').delete().eq('organization_id', org.orgId);
    await a.from('inmail_queue').delete().eq('created_by', org.owner.userId);
    await a.from('sequence_snippets').delete().eq('organization_id', org.orgId);
    await a.from('sequence_templates').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, extra);
  }
});

async function newOrg(prefix: string, extra: TestUser[] = []) {
  const org = await createOrg('agency', prefix);
  orgsToDelete.push({ org, extra });
  const token = (await signIn(org.owner.email, org.owner.password)).access_token;
  return { org, token };
}

interface RestResult {
  status: number;
  body: unknown;
}

/** Appel PostgREST ; `token` null = clé anonyme seule. */
async function rest(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  token: string | null,
  body?: unknown,
  prefer = 'return=representation',
): Promise<RestResult> {
  const res = await fetch(`${E2E.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: E2E.anonKey,
      Authorization: `Bearer ${token ?? E2E.anonKey}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* corps non JSON */
  }
  return { status: res.status, body: parsed };
}

/** Lecture ou écriture sans effet : refus (401/403) ou aucune ligne atteinte. */
function expectNoRows(r: RestResult, label: string) {
  const ok = r.status === 401 || r.status === 403 || (r.status < 300 && Array.isArray(r.body) && r.body.length === 0);
  expect(ok, `${label} → ${r.status} ${JSON.stringify(r.body)}`).toBe(true);
}

/** Écriture refusée : 401 (anonyme) ou 403 (utilisateur connecté). */
function expectDenied(r: RestResult, label: string) {
  expect([401, 403], `${label} → ${r.status} ${JSON.stringify(r.body)}`).toContain(r.status);
}

/** Fonction non exécutable : 401, 403 ou 404, jamais 200. */
function expectRpcDenied(r: RestResult, label: string) {
  expect([401, 403, 404], `${label} → ${r.status} ${JSON.stringify(r.body)}`).toContain(r.status);
}

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3600_000).toISOString();

test.describe('Séquences — base et RLS vues de l’API', () => {
  // rls-infra-moteur-inaccessible (SEQ-057)
  test("@critical un utilisateur connecté ne touche ni au verrou du moteur, ni au quota LinkedIn, ni aux statistiques, ni au journal des actions, ni au suivi e-mail", async () => {
    const { org, token } = await newOrg('E2E SeqDB infra');
    const acc = `seqdb_acc_${rand()}`;
    logAccounts.push(acc);
    const { sequenceId, steps } = await seedSequence(org.orgId, org.owner.userId, [{ action_type: 'message' }]);
    // Inscription en pause et exécution annulée : rien que le moteur puisse prendre.
    const enrollmentId = await seedEnrollment(org.orgId, sequenceId, org.owner.userId, {
      account_id: `seqdb-mail-${rand()}@e2e.test`, status: 'paused', pause_reason: 'manual',
    });
    const execId = await seedExecution(org.orgId, enrollmentId, steps[0], { status: 'cancelled', skip_reason: 'Arrêt manuel' });
    const trackingId = `seqdb-trk-${rand()}`;
    const { error: trkErr } = await admin().from('sequence_email_tracking').insert({ execution_id: execId, tracking_id: trackingId });
    expect(trkErr).toBeNull();
    // Une action du jour et une de plus de 30 jours (celle que la purge effacerait).
    const { error: logErr } = await admin().from('linkedin_action_log').insert([
      { account_id: acc, action_type: 'message', organization_id: org.orgId, source: 'e2e', created_at: new Date().toISOString() },
      { account_id: acc, action_type: 'message', organization_id: org.orgId, source: 'e2e', created_at: daysAgo(40) },
    ]);
    expect(logErr).toBeNull();

    // Verrou libre : on pose un verrou déjà échu au nom d'un faux cycle, que
    // le moteur peut reprendre à tout moment (aucun cycle bloqué).
    const runId = `e2e-seqdb-run-${rand()}`;
    const fakeHolder = `e2e-seqdb-holder-${rand()}`;
    const ownerLockId = `e2e-seqdb-owner-${rand()}`;
    const { data: held } = await admin()
      .from('sequence_processing_lock')
      .update({ locked_at: new Date(Date.now() - 11 * 60_000).toISOString(), locked_by: fakeHolder })
      .eq('id', 'process')
      .is('locked_at', null)
      .select('id');
    const lockSeeded = (held?.length ?? 0) === 1;

    try {
      // Fonctions du moteur : aucune n'est exécutable par un utilisateur.
      const rpcs: Array<[string, Record<string, unknown>]> = [
        ['acquire_sequence_lock', { p_run_id: runId }],
        ['release_sequence_lock', { p_run_id: fakeHolder }],
        ['check_linkedin_action_quota', {
          p_account_id: acc, p_action_type: 'message', p_day_since: daysAgo(1), p_week_since: daysAgo(7),
          p_daily_visible_cap: 100, p_log: true,
        }],
        ['increment_sequence_analytics', { p_sequence_id: sequenceId, p_field: 'messages_sent', p_increment: 100 }],
        ['cleanup_linkedin_action_log', {}],
        ['linkedin_ramp_factor', { p_linked_at: new Date().toISOString() }],
      ];
      for (const [fn, args] of rpcs) {
        expectRpcDenied(await rest('POST', `rpc/${fn}`, token, args), `propriétaire → ${fn}`);
      }

      // Tables d'infrastructure : ni lecture, ni écriture, ni suppression.
      expectNoRows(await rest('GET', `linkedin_action_log?account_id=eq.${acc}`, token), 'GET linkedin_action_log');
      expectDenied(await rest('POST', 'linkedin_action_log', token, { account_id: acc, action_type: 'message' }), 'POST linkedin_action_log');
      expectNoRows(await rest('DELETE', `linkedin_action_log?account_id=eq.${acc}`, token), 'DELETE linkedin_action_log');

      expectNoRows(await rest('GET', `sequence_email_tracking?execution_id=eq.${execId}`, token), 'GET sequence_email_tracking');
      expectDenied(await rest('POST', 'sequence_email_tracking', token, { execution_id: execId, tracking_id: `forged-${rand()}` }), 'POST sequence_email_tracking');
      expectNoRows(await rest('PATCH', `sequence_email_tracking?tracking_id=eq.${trackingId}`, token, { email_message_id: 'forged' }), 'PATCH sequence_email_tracking');
      expectNoRows(await rest('DELETE', `sequence_email_tracking?tracking_id=eq.${trackingId}`, token), 'DELETE sequence_email_tracking');

      expectNoRows(await rest('GET', 'sequence_processing_lock?id=eq.process', token), 'GET sequence_processing_lock');
      expectDenied(await rest('POST', 'sequence_processing_lock', token, { id: `e2e-${rand()}` }), 'POST sequence_processing_lock');
      expectNoRows(
        await rest('PATCH', 'sequence_processing_lock?id=eq.process', token, { locked_by: ownerLockId, locked_at: new Date().toISOString() }),
        'PATCH sequence_processing_lock',
      );
      expectNoRows(await rest('DELETE', 'sequence_processing_lock?id=eq.process', token), 'DELETE sequence_processing_lock');

      // Relecture serveur : rien n'a bougé.
      const { data: lock } = await admin().from('sequence_processing_lock').select('locked_at, locked_by').eq('id', 'process').maybeSingle();
      expect(lock, 'ligne du verrou toujours là').not.toBeNull();
      expect(lock!.locked_by, 'verrou jamais pris au nom de l’utilisateur').not.toBe(runId);
      expect(lock!.locked_by).not.toBe(ownerLockId);
      if (lockSeeded && lock!.locked_by !== fakeHolder) {
        // Seul le moteur peut avoir repris le verrou échu entre-temps.
        expect(lock!.locked_by, 'verrou libéré par l’utilisateur').not.toBeNull();
      }

      const { count: logCount } = await admin().from('linkedin_action_log').select('id', { count: 'exact', head: true }).eq('account_id', acc);
      expect(logCount, 'journal des actions LinkedIn inchangé (ni ajout, ni purge, ni suppression)').toBe(2);
      const { data: trk } = await admin().from('sequence_email_tracking').select('email_message_id').eq('tracking_id', trackingId).maybeSingle();
      expect(trk, 'suivi e-mail toujours là').not.toBeNull();
      expect(trk!.email_message_id).toBeNull();
      const { count: statCount } = await admin().from('sequence_analytics').select('id', { count: 'exact', head: true }).eq('sequence_id', sequenceId);
      expect(statCount, 'aucune statistique écrite par l’utilisateur').toBe(0);
    } finally {
      await admin()
        .from('sequence_processing_lock')
        .update({ locked_at: null, locked_by: null })
        .eq('id', 'process')
        .in('locked_by', [fakeHolder, runId, ownerLockId]);
    }
  });

  // rls-isolation-orgs-non-couverte (SEQ-217)
  test("un membre d'une autre organisation ne lit ni ne modifie les étapes, la file InMail, les extraits et les modèles d'une organisation", async () => {
    const { org: orgA, token: tokenA } = await newOrg('E2E SeqDB iso A');
    const { token: tokenB, org: orgB } = await newOrg('E2E SeqDB iso B');
    const { sequenceId, steps } = await seedSequence(orgA.orgId, orgA.owner.userId, [
      { action_type: 'message' }, { action_type: 'message' },
    ]);
    const a = admin();
    const { data: inmail, error: e1 } = await a.from('inmail_queue').insert({
      account_id: `seqdb_acc_${rand()}`, recipient_profile_id: `seqdb-prof-${rand()}`, subject: 'Objet A', message: 'Message A',
      status: 'cancelled', created_by: orgA.owner.userId, organization_id: orgA.orgId,
    }).select('id').single();
    expect(e1).toBeNull();
    const { data: snippet, error: e2 } = await a.from('sequence_snippets').insert({
      organization_id: orgA.orgId, name: 'Extrait A', content: 'Contenu A',
    }).select('id').single();
    expect(e2).toBeNull();
    const { data: template, error: e3 } = await a.from('sequence_templates').insert({
      organization_id: orgA.orgId, name: 'Modèle A', steps_config: [], is_system: false,
    }).select('id').single();
    expect(e3).toBeNull();

    // Contrôle positif : A lit ses propres étapes par la même requête.
    const own = await rest('GET', `sequence_steps?sequence_id=eq.${sequenceId}`, tokenA);
    expect(own.status).toBe(200);
    expect((own.body as unknown[]).length, 'A lit ses deux étapes').toBe(2);

    const targets: Array<{ table: string; id: string; patch: Record<string, unknown>; field: string; original: unknown }> = [
      { table: 'sequence_steps', id: steps[0].id, patch: { message_template: 'Réécrit par B' }, field: 'message_template', original: 'Bonjour {{firstName}}' },
      { table: 'sequence_steps', id: steps[1].id, patch: { message_template: 'Réécrit par B' }, field: 'message_template', original: 'Bonjour {{firstName}}' },
      { table: 'inmail_queue', id: inmail!.id, patch: { status: 'scheduled', message: 'Réécrit par B' }, field: 'message', original: 'Message A' },
      { table: 'sequence_snippets', id: snippet!.id, patch: { content: 'Réécrit par B' }, field: 'content', original: 'Contenu A' },
      { table: 'sequence_templates', id: template!.id, patch: { name: 'Réécrit par B' }, field: 'name', original: 'Modèle A' },
    ];
    for (const t of targets) {
      expectNoRows(await rest('GET', `${t.table}?id=eq.${t.id}`, tokenB), `B GET ${t.table}`);
      expectNoRows(await rest('PATCH', `${t.table}?id=eq.${t.id}`, tokenB, t.patch), `B PATCH ${t.table}`);
      expectNoRows(await rest('DELETE', `${t.table}?id=eq.${t.id}`, tokenB), `B DELETE ${t.table}`);
    }
    for (const t of targets) {
      const { data } = await a.from(t.table).select(`id, ${t.field}`).eq('id', t.id).maybeSingle();
      expect(data, `${t.table} toujours là`).not.toBeNull();
      expect((data as Record<string, unknown>)[t.field], `${t.table}.${t.field} inchangé`).toBe(t.original);
    }
    const { data: inmailRow } = await a.from('inmail_queue').select('status').eq('id', inmail!.id).single();
    expect(inmailRow!.status, 'InMail de A toujours annulé').toBe('cancelled');

    // Écritures au nom de A : refusées.
    expectDenied(await rest('POST', 'sequence_snippets', tokenB, { organization_id: orgA.orgId, name: 'Injecté', content: 'x' }), 'B POST extrait dans A');
    expectDenied(
      await rest('POST', 'sequence_templates', tokenB, { organization_id: orgA.orgId, name: 'Injecté', steps_config: [], is_system: false }),
      'B POST modèle dans A',
    );
    expectDenied(
      await rest('POST', 'sequence_steps', tokenB, { sequence_id: sequenceId, organization_id: orgB.orgId, step_order: 9, action_type: 'message', message_template: 'Injecté' }),
      'B POST étape dans la séquence de A',
    );
    const { count: injected } = await a.from('sequence_snippets').select('id', { count: 'exact', head: true }).eq('organization_id', orgA.orgId).eq('name', 'Injecté');
    expect(injected).toBe(0);
    const { count: stepCount } = await a.from('sequence_steps').select('id', { count: 'exact', head: true }).eq('sequence_id', sequenceId);
    expect(stepCount, 'toujours deux étapes dans la séquence de A').toBe(2);
  });

  // rls-anonyme-aucun-acces
  test("un appel anonyme ne lit ni n'écrit aucune table du module et n'exécute aucune de ses fonctions", async () => {
    const { org } = await newOrg('E2E SeqDB anon');
    const { sequenceId, steps } = await seedSequence(org.orgId, org.owner.userId, [{ action_type: 'message' }]);
    const enrollmentId = await seedEnrollment(org.orgId, sequenceId, org.owner.userId, {
      account_id: `seqdb-mail-${rand()}@e2e.test`, status: 'paused', pause_reason: 'manual',
    });
    const execId = await seedExecution(org.orgId, enrollmentId, steps[0], { status: 'cancelled', skip_reason: 'Arrêt manuel' });
    const anonTag = `seqdb-anon-${rand()}`;
    logAccounts.push(anonTag);

    const tables: Array<[string, Record<string, unknown>]> = [
      ['outreach_sequences', { name: anonTag, organization_id: org.orgId, is_active: false }],
      ['sequence_steps', { sequence_id: sequenceId, step_order: 9, action_type: 'message', message_template: anonTag }],
      ['sequence_enrollments', { sequence_id: sequenceId, account_id: anonTag, profile_id: anonTag, status: 'paused', pause_reason: 'manual' }],
      ['sequence_step_executions', { enrollment_id: enrollmentId, step_id: steps[0].id, step_order: 0, scheduled_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), status: 'cancelled', skip_reason: anonTag }],
      ['sequence_templates', { organization_id: org.orgId, name: anonTag, steps_config: [] }],
      ['sequence_snippets', { organization_id: org.orgId, name: anonTag, content: anonTag }],
      ['sequence_analytics', { sequence_id: sequenceId, date: '2026-01-01', organization_id: org.orgId, messages_sent: 1 }],
      ['inmail_queue', { account_id: anonTag, recipient_profile_id: anonTag, subject: anonTag, message: anonTag, status: 'sent', created_by: org.owner.userId, organization_id: org.orgId }],
      ['sequence_email_tracking', { execution_id: execId, tracking_id: anonTag }],
      ['sequence_processing_lock', { id: anonTag }],
      ['linkedin_action_log', { account_id: anonTag, action_type: 'message' }],
    ];
    for (const [table, row] of tables) {
      expectNoRows(await rest('GET', `${table}?select=*&limit=5`, null), `anon GET ${table}`);
      expectDenied(await rest('POST', table, null, row, 'return=minimal'), `anon POST ${table}`);
    }
    expectNoRows(await rest('DELETE', `outreach_sequences?id=eq.${sequenceId}`, null), 'anon DELETE séquence');
    expectNoRows(await rest('PATCH', `sequence_enrollments?id=eq.${enrollmentId}`, null, { status: 'active' }), 'anon PATCH inscription');

    const rpcs: Array<[string, Record<string, unknown>]> = [
      ['save_sequence_steps', { p_sequence_id: sequenceId, p_steps: [] }],
      ['get_sequence_enrollment_counts', { p_sequence_ids: [sequenceId] }],
      ['find_recent_org_contacts', { p_org: org.orgId, p_values: ['x'], p_slugs: [], p_since: null }],
      ['get_linkedin_quota_status', { p_account_id: anonTag }],
    ];
    for (const [fn, args] of rpcs) {
      expectRpcDenied(await rest('POST', `rpc/${fn}`, null, args), `anon → ${fn}`);
    }

    // Relecture serveur : séquence, étape et inscription intactes, rien d'inséré.
    const a = admin();
    const { data: seq } = await a.from('outreach_sequences').select('id').eq('id', sequenceId).maybeSingle();
    expect(seq, 'séquence toujours là').not.toBeNull();
    const { count: stepCount } = await a.from('sequence_steps').select('id', { count: 'exact', head: true }).eq('sequence_id', sequenceId);
    expect(stepCount).toBe(1);
    const { data: enr } = await a.from('sequence_enrollments').select('status').eq('id', enrollmentId).single();
    expect(enr!.status).toBe('paused');
    const { count: seqInserted } = await a.from('outreach_sequences').select('id', { count: 'exact', head: true }).eq('name', anonTag);
    expect(seqInserted).toBe(0);
    const { count: logInserted } = await a.from('linkedin_action_log').select('id', { count: 'exact', head: true }).eq('account_id', anonTag);
    expect(logInserted).toBe(0);
  });

  // save-steps-autre-organisation (SEQ-009)
  test("save_sequence_steps sur la séquence d'une autre organisation échoue sans rien modifier", async () => {
    const { org: orgA } = await newOrg('E2E SeqDB save A');
    const { token: tokenB } = await newOrg('E2E SeqDB save B');
    const { sequenceId, steps } = await seedSequence(orgA.orgId, orgA.owner.userId, [
      { action_type: 'message' }, { action_type: 'message' },
    ]);
    const { data: before } = await admin().from('sequence_steps')
      .select('id, step_order, message_template, action_type').eq('sequence_id', sequenceId).order('step_order');

    const res = await rest('POST', 'rpc/save_sequence_steps', tokenB, {
      p_sequence_id: sequenceId,
      p_steps: [
        { id: steps[0].id, step_order: 0, action_type: 'message', message_template: 'Réécrit par B' },
        { id: 'n1', step_order: 1, action_type: 'message', message_template: 'Ajouté par B' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    const body = res.body as { code?: string; message?: string };
    expect(body.code).toBe('23514');
    expect(body.message ?? '').toContain('not found or not accessible');

    const { data: after } = await admin().from('sequence_steps')
      .select('id, step_order, message_template, action_type').eq('sequence_id', sequenceId).order('step_order');
    expect(after, 'étapes de A inchangées, aucune étape ajoutée').toEqual(before);
  });

  // inmail-aucune-modification-client (SEQ-011, SEQ-118, SEQ-126)
  test("le navigateur ne modifie ni ne supprime la file InMail et ne note pas un envoi au nom d'un autre ou sans organisation", async () => {
    const created = await newOrg('E2E SeqDB inmail');
    const { org, token } = created;
    const colleague = await addMember(org.orgId, 'member', 'seqdb-colleague');
    orgsToDelete[orgsToDelete.length - 1].extra.push(colleague);
    const a = admin();
    const base = {
      account_id: `seqdb_acc_${rand()}`, recipient_profile_id: `seqdb-prof-${rand()}`, subject: 'Objet', message: 'Message',
      created_by: org.owner.userId, organization_id: org.orgId,
    };
    const { data: cancelled, error: e1 } = await a.from('inmail_queue')
      .insert({ ...base, status: 'cancelled' }).select('id').single();
    expect(e1).toBeNull();
    // Programmée dans une semaine : process-inmail-queue ne la prend pas.
    const later = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { data: scheduled, error: e2 } = await a.from('inmail_queue')
      .insert({ ...base, status: 'scheduled', scheduled_at: later }).select('id').single();
    expect(e2).toBeNull();

    expectNoRows(
      await rest('PATCH', `inmail_queue?id=eq.${cancelled!.id}`, token, { status: 'scheduled', scheduled_at: new Date().toISOString() }),
      'PATCH annulée → programmée',
    );
    expectNoRows(await rest('PATCH', `inmail_queue?id=eq.${scheduled!.id}`, token, { status: 'cancelled' }), 'PATCH programmée → annulée');
    expectNoRows(await rest('DELETE', `inmail_queue?id=eq.${cancelled!.id}`, token), 'DELETE annulée');
    expectNoRows(await rest('DELETE', `inmail_queue?id=eq.${scheduled!.id}`, token), 'DELETE programmée');

    const { data: rows } = await a.from('inmail_queue').select('id, status, scheduled_at')
      .in('id', [cancelled!.id, scheduled!.id]);
    const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));
    expect(byId.get(cancelled!.id)?.status, 'annulée reste annulée').toBe('cancelled');
    expect(byId.get(scheduled!.id)?.status, 'programmée reste programmée').toBe('scheduled');
    expect(new Date(byId.get(scheduled!.id)!.scheduled_at as string).getTime()).toBe(new Date(later).getTime());

    const sent = { ...base, status: 'sent', sent_at: new Date().toISOString() };
    expectDenied(await rest('POST', 'inmail_queue', token, { ...sent, created_by: colleague.userId }), 'POST envoi au nom d’un collègue');
    const { organization_id: _omit, ...withoutOrg } = sent;
    expectDenied(await rest('POST', 'inmail_queue', token, withoutOrg), 'POST envoi sans organisation');
    const { count: forged } = await a.from('inmail_queue').select('id', { count: 'exact', head: true })
      .eq('account_id', base.account_id).eq('status', 'sent');
    expect(forged, 'aucun envoi noté').toBe(0);

    // Contrôle positif : le suivi de son propre message envoyé reste possible.
    const own = await rest('POST', 'inmail_queue', token, sent);
    expect(own.status, JSON.stringify(own.body)).toBe(201);
  });

  // quota-linkedin-concurrence
  test('dix contrôles de quota simultanés sur un même compte n’autorisent jamais plus que le plafond', async () => {
    const acc = `seqdb_conc_${rand()}`;
    logAccounts.push(acc);
    const args = {
      p_account_id: acc,
      p_action_type: 'message',
      p_day_since: daysAgo(1),
      p_week_since: daysAgo(7),
      p_daily_visible_cap: 3,
      p_source: 'e2e-seqdb',
      p_log: true,
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => admin().rpc('check_linkedin_action_quota', args)),
    );
    for (const r of results) expect(r.error, JSON.stringify(r.error)).toBeNull();
    const allowed = results.filter((r) => (r.data as { allowed?: boolean }).allowed === true).length;
    const scopes = results.filter((r) => (r.data as { allowed?: boolean }).allowed === false)
      .map((r) => (r.data as { scope?: string }).scope);
    expect(allowed, 'exactement trois actions autorisées').toBe(3);
    expect(scopes, 'sept refus au plafond journalier').toEqual(Array(7).fill('daily_visible'));
    const { count } = await admin().from('linkedin_action_log').select('id', { count: 'exact', head: true }).eq('account_id', acc);
    expect(count, 'trois lignes au journal').toBe(3);
  });
});

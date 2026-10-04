/**
 * Refonte mission, lot 0c-1 et 0c-2 : les lectures, contre la stack locale
 * (e2e/local-stack), par l'API comme les écrans et l'assistant.
 *
 * Contrat : plan final du lot 0c (section 10.2) et CLAUDE.md (vue
 * mission_candidate_rows, get_mission_stage_counts, rgpd-purge).
 *
 *   A. deux auteurs sur un candidat : une ligne dans la vue, compté une fois,
 *      stats_total_found = 1 ;
 *   B. isolement : un membre de O1 ne lit ni les lignes ni les chiffres d'une
 *      mission de O2 (le refus anonyme est contrôlé par curl dans e2e.yml) ;
 *   A2. doublon À trier d'une ligne en entretien, envoi par la file : le doublon
 *      passe Contacté, la vue rend toujours En entretien ;
 *   C. geste groupé puis annulation : état d'avant rendu, jalons effacés ;
 *      avec une réponse entre les deux : moved_since, rien d'écrit ;
 *   D. InMail envoyé puis répondu : preuve d'envoi, la ligne Retenue passe
 *      « A répondu » ;
 *   E. rgpd-purge sans corps : compte seulement, rien supprimé ;
 *   F. assign_candidate_to_member sur une mission passée en project:<uuid> :
 *      accepté et exécuté.
 * E et F : stack locale seulement (e2e/local-stack/up.sh).
 * Les autres cas de la vue et de la preuve d'envoi : blocs V, U et I de
 * supabase/tests/candidate_stage_readers_audit.sql.
 *
 * @critical
 */
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  candidateRowState,
  createOrg,
  deleteOrg,
  seedCandidateRow,
  seedLinkedInAccount,
  seedMission,
  signIn,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import { ENGINE_SKIP_REASON, callFunction, engineAvailable, postJson, rand, setPaidPlan } from '../helpers/sequence-engine';

test.setTimeout(120_000);

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
test.afterEach(async () => {
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    for (const table of ['agent_tool_executions', 'candidate_assignments', 'mission_conversations', 'inmail_queue',
      'job_candidate_status', 'mission_process_steps', 'organization_subscriptions']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});
function track(org: TestOrg, ...extra: TestUser[]) {
  orgsToDelete.push({ org, extra });
  return org;
}

// ─── Aides ──────────────────────────────────────────────────────────────────
type Json = Record<string, any>;
const newProfileId = () => `ACoAAE2E0C${rand()}${rand()}`;

/** Client du navigateur pour un utilisateur connecté (RLS de l'appelant). */
async function userClient(user: TestUser): Promise<SupabaseClient> {
  const { access_token } = await signIn(user.email, user.password);
  return createClient(E2E.supabaseUrl, E2E.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${access_token}` } },
  });
}

async function viewRows(client: SupabaseClient, missionId: string) {
  const { data, error } = await client.from('mission_candidate_rows')
    .select('id, candidate_id, general_stage, group_size, group_ids, is_unopened')
    .eq('project_id', missionId);
  if (error) throw new Error(`mission_candidate_rows: ${error.message}`);
  return (data ?? []) as Array<{ id: string; candidate_id: string; general_stage: string; group_size: number; group_ids: string[]; is_unopened: boolean }>;
}

async function stageCounts(client: SupabaseClient, missionIds: string[]) {
  const { data, error } = await client.rpc('get_mission_stage_counts', { p_project_ids: missionIds });
  if (error) throw new Error(`get_mission_stage_counts: ${error.message}`);
  return (data ?? []) as Array<Json>;
}

function psql(sql: string): string {
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql],
    { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' },
  );
}

// ════════════════════════════════════════════════════════════════════════════
test.describe('lot 0c : vue et chiffres', () => {
  test('A. deux auteurs sur un candidat : une ligne dans la vue, compté une fois', async () => {
    const org = await createOrg('agency', 'E2E 0c A');
    const member = await addMember(org.orgId, 'member', 'lect0c');
    track(org, member);
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const candidate = newProfileId();
    const first = await seedCandidateRow({ orgId: org.orgId, createdBy: org.owner.userId, candidateId: candidate, missionId });
    const second = await seedCandidateRow({ orgId: org.orgId, createdBy: member.userId, candidateId: candidate, missionId });

    const owner = await userClient(org.owner);
    const rows = await viewRows(owner, missionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].group_size).toBe(2);
    expect([...rows[0].group_ids].sort()).toEqual([first.id, second.id].sort());
    expect(rows[0].is_unopened, 'ajout explicite : reste au Pipeline').toBe(false);

    const [counts] = await stageCounts(owner, [missionId]);
    expect(counts).toMatchObject({ project_id: missionId, to_sort: 1, unopened: 0 });

    const { data: mission } = await admin().from('sourcing_projects')
      .select('stats_total_found').eq('id', missionId).single();
    expect(mission?.stats_total_found).toBe(1);
  });

  test('B. isolement : la mission d’une autre organisation ne rend ni ligne ni chiffre', async () => {
    const o1 = track(await createOrg('agency', 'E2E 0c B1'));
    const o2 = track(await createOrg('agency', 'E2E 0c B2'));
    const foreign = await seedMission(o2.orgId, o2.owner.userId);
    await seedCandidateRow({ orgId: o2.orgId, createdBy: o2.owner.userId, candidateId: newProfileId(), missionId: foreign, stage: 'retained' });

    const reader = await userClient(o1.owner);
    expect(await viewRows(reader, foreign)).toEqual([]);
    expect(await stageCounts(reader, [foreign]), 'aucune ligne, pas des zéros').toEqual([]);

    // Témoin : le propriétaire de O2 voit sa mission.
    const ownerO2 = await userClient(o2.owner);
    expect(await viewRows(ownerO2, foreign)).toHaveLength(1);
    expect(await stageCounts(ownerO2, [foreign])).toHaveLength(1);
  });

  test('D. InMail envoyé puis répondu : la ligne Retenue passe « A répondu »', async () => {
    const org = track(await createOrg('agency', 'E2E 0c D'));
    const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId);
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const candidate = newProfileId();
    const { id } = await seedCandidateRow({ orgId: org.orgId, createdBy: org.owner.userId, candidateId: candidate, missionId, stage: 'retained' });
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const { error: linkErr } = await admin().from('mission_conversations').insert({
      organization_id: org.orgId, project_id: missionId, account_id: accountId, candidate_id: candidate,
      source: 'inferred', last_inbound_at: twoDaysAgo,
    });
    if (linkErr) throw new Error(`mission_conversations: ${linkErr.message}`);
    // Le webhook passe l'InMail en replied avant d'enregistrer la réponse.
    const { error: imErr } = await admin().from('inmail_queue').insert({
      organization_id: org.orgId, project_id: missionId, created_by: org.owner.userId, account_id: accountId,
      recipient_profile_id: candidate, subject: 'Poste', message: 'Bonjour', status: 'replied', sent_at: threeDaysAgo,
    });
    if (imErr) throw new Error(`inmail_queue: ${imErr.message}`);

    const { error } = await admin().rpc('record_candidate_inbound', {
      p_organization_id: org.orgId, p_account_id: accountId, p_candidate: { ids: [candidate] },
    });
    expect(error, error?.message).toBeNull();
    const state = await candidateRowState(id);
    expect(state.general_stage).toBe('replied');
    expect(state.contacted_at).not.toBeNull();
  });

  test('A2. doublon À trier d’une ligne en entretien, envoi Konekt : le doublon passe Contacté, la vue rend En entretien', async () => {
    const org = await createOrg('agency', 'E2E 0c A2');
    const member = await addMember(org.orgId, 'member', 'lect0c2');
    track(org, member);
    const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId);
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const { data: step, error: stepErr } = await admin().from('mission_process_steps').insert({
      project_id: missionId, organization_id: org.orgId, step_order: 0, name: 'Entretien client', duration_minutes: 45,
    }).select('id').single();
    if (stepErr || !step) throw new Error(`mission_process_steps: ${stepErr?.message}`);
    const candidate = newProfileId();
    const interviewing = await seedCandidateRow({
      orgId: org.orgId, createdBy: org.owner.userId, candidateId: candidate, missionId, stage: 'interviewing', stepId: step.id as string,
    });
    const duplicate = await seedCandidateRow({ orgId: org.orgId, createdBy: member.userId, candidateId: candidate, missionId });

    const { error } = await admin().rpc('record_candidate_outbound', {
      p_organization_id: org.orgId, p_account_id: accountId, p_candidate: { ids: [candidate] },
      p_source: 'manual', p_project_id: missionId, p_chat_id: null, p_message_id: null,
      p_created_by: null, p_pending: false, p_send_kind: 'message',
    });
    expect(error, error?.message).toBeNull();
    expect((await candidateRowState(duplicate.id)).general_stage, 'le doublon est Contacté').toBe('contacted');
    expect((await candidateRowState(interviewing.id)).general_stage, 'la ligne en entretien ne recule pas').toBe('interviewing');

    const rows = await viewRows(await userClient(org.owner), missionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ general_stage: 'interviewing', group_size: 2, is_unopened: false });
  });

  const MOVE_COLUMNS = 'id, general_stage, process_step_id, stage_entered_at, decision_source, rejected_at, rejected_from_stage, presented_at, contacted_at, replied_at';
  type MoveRow = {
    id: string; general_stage: string; process_step_id: string | null; stage_entered_at: string; decision_source: string | null;
    rejected_at: string | null; rejected_from_stage: string | null; presented_at: string | null; contacted_at: string | null; replied_at: string | null;
  };

  /** Deux lignes À trier d'une mission, déplacées vers Contacté par le propriétaire (geste groupé du navigateur). */
  async function groupedGesture(label: string) {
    const org = track(await createOrg('agency', label));
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      ids.push((await seedCandidateRow({ orgId: org.orgId, createdBy: org.owner.userId, candidateId: newProfileId(), missionId })).id);
    }
    const { data: beforeRows, error: beforeErr } = await admin().from('job_candidate_status').select(MOVE_COLUMNS).in('id', ids);
    if (beforeErr) throw new Error(`avant : ${beforeErr.message}`);
    const before = new Map((beforeRows as MoveRow[]).map((r) => [r.id, r]));

    const owner = await userClient(org.owner);
    const { data: gesture, error } = await owner.rpc('set_candidate_stages', { p_ids: ids, p_stage: 'contacted', p_source: 'user' });
    expect(error, error?.message).toBeNull();
    const moves = (gesture as Array<{ id: string; result: string; stage_entered_at: string }>).map((g) => {
      const b = before.get(g.id)!;
      expect(g.result).toBe('updated');
      return {
        id: g.id,
        after_entered_at: g.stage_entered_at,
        before: {
          general_stage: b.general_stage, process_step_id: b.process_step_id, legacy_stage: null,
          stage_entered_at: b.stage_entered_at, decision_source: b.decision_source,
          rejected_at: b.rejected_at, rejected_from_stage: b.rejected_from_stage, presented_at: b.presented_at,
        },
      };
    });
    for (const id of ids) {
      const state = await candidateRowState(id);
      expect(state.general_stage).toBe('contacted');
      expect(state.contacted_at, 'jalon posé par le geste').not.toBeNull();
    }
    return { org, owner, ids, moves, before };
  }

  test('C. geste groupé puis annulation : l’état d’avant revient, les jalons du geste sont effacés', async () => {
    const { owner, ids, moves, before } = await groupedGesture('E2E 0c C');
    const { data, error } = await owner.rpc('undo_candidate_stages', { p_moves: moves });
    expect(error, error?.message).toBeNull();
    const result = (data as { rows: Array<{ id: string; result: string }> }).rows;
    expect(result.map((r) => r.result)).toEqual(['updated', 'updated']);
    const { data: afterRows } = await admin().from('job_candidate_status').select(MOVE_COLUMNS).in('id', ids);
    for (const row of afterRows as MoveRow[]) {
      const was = before.get(row.id)!;
      expect(row.general_stage).toBe('to_sort');
      expect(row.decision_source, 'origine d’avant').toBe(was.decision_source);
      expect(new Date(row.stage_entered_at).getTime(), 'date d’entrée d’avant').toBe(new Date(was.stage_entered_at).getTime());
      expect(row.contacted_at, 'jalon du geste effacé').toBeNull();
    }
  });

  test('C. avec une réponse entre le geste et l’annulation : moved_since, rien n’est écrit', async () => {
    const { org, owner, ids, moves } = await groupedGesture('E2E 0c C2');
    // Réponse scriptée sur la première ligne : étape et date d'entrée changent.
    const { error: replyErr } = await admin().rpc('set_candidate_stage', {
      p_id: ids[0], p_stage: 'replied', p_source: 'system', p_organization_id: org.orgId,
    });
    expect(replyErr, replyErr?.message).toBeNull();

    const { data, error } = await owner.rpc('undo_candidate_stages', { p_moves: moves });
    expect(error, error?.message).toBeNull();
    const byId = new Map((data as { rows: Array<{ id: string; result: string }> }).rows.map((r) => [r.id, r.result]));
    expect(byId.get(ids[0])).toBe('moved_since');
    expect(byId.get(ids[1])).toBe('updated');
    expect((await candidateRowState(ids[0])).general_stage, 'la ligne répondue reste où elle est').toBe('replied');
    expect((await candidateRowState(ids[1])).general_stage).toBe('to_sort');
  });
});

// ════════════════════════════════════════════════════════════════════════════
test.describe('lot 0c-2 : fonctions serveur', () => {
  // Stack locale seulement : fonctions serveur et psql (dates posées dans le passé).
  test.skip(!engineAvailable, ENGINE_SKIP_REASON);

  test('E. rgpd-purge sans corps : compte seulement, rien supprimé', async () => {
    const org = track(await createOrg('agency', 'E2E 0c E'));
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const { id } = await seedCandidateRow({ orgId: org.orgId, createdBy: org.owner.userId, candidateId: newProfileId(), missionId });
    // Ligne sans activité depuis 25 mois (dates posées sous le drapeau de reprise).
    psql(`BEGIN;
      ALTER TABLE public.job_candidate_status DISABLE TRIGGER update_job_candidate_status_updated_at;
      SELECT set_config('konekt.stage_write', '*', true);
      UPDATE public.job_candidate_status
         SET updated_at = now() - interval '25 months', stage_entered_at = now() - interval '25 months'
       WHERE id = '${id}';
      ALTER TABLE public.job_candidate_status ENABLE TRIGGER update_job_candidate_status_updated_at;
      COMMIT;`);

    const res = await postJson('/functions/v1/rgpd-purge', {}, { Authorization: `Bearer ${E2E.serviceRoleKey}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.dry_run).toBe(true);
    // La pile locale n'a pas de service de stockage (e2e/local-stack/README.md) :
    // seule la liste des enregistrements audio échoue alors, hors du périmètre testé.
    const errors = (res.body.errors as string[]).filter((e) => e !== 'audio list: no route');
    expect(errors).toEqual([]);
    expect(Number(res.body.candidates_purged)).toBeGreaterThanOrEqual(1);
    const { data } = await admin().from('job_candidate_status').select('id').eq('id', id);
    expect(data, 'compte seulement : la ligne reste').toHaveLength(1);
  });

  test('F. assign_candidate_to_member : mission passée en project:<uuid>, accepté', async () => {
    const org = track(await createOrg('agency', 'E2E 0c F'));
    await setPaidPlan(org.orgId);
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const candidate = newProfileId();
    await seedCandidateRow({ orgId: org.orgId, createdBy: org.owner.userId, candidateId: candidate, missionId });
    const { data: proposed, error } = await admin().from('agent_tool_executions').insert({
      user_id: org.owner.userId, organization_id: org.orgId, tool_name: 'assign_candidate_to_member',
      params: { candidate_id: candidate, job_id: `project:${missionId}`, assigned_to_user_id: org.owner.userId },
      status: 'proposed', dry_run_result: { summary: 'Test e2e assign_candidate_to_member', details: {} },
    }).select('id').single();
    if (error || !proposed) throw new Error(`propose: ${error?.message}`);

    const { access_token } = await signIn(org.owner.email, org.owner.password);
    const res = await callFunction('agent-tool-action', access_token, { execution_id: proposed.id, action: 'approve' });
    expect(res.body.success, JSON.stringify(res.body)).toBe(true);
    const { data: exec } = await admin().from('agent_tool_executions').select('status').eq('id', proposed.id).single();
    expect(exec?.status).toBe('executed');
    const { data: assignments } = await admin().from('candidate_assignments')
      .select('job_id, assigned_to').eq('organization_id', org.orgId).eq('candidate_id', candidate);
    expect(assignments).toHaveLength(1);
    expect(assignments![0].job_id, 'mission sans préfixe').toBe(missionId);
  });
});

/**
 * Lot P, étape P-0b : refresh_candidate_pictures, par l'API comme le navigateur
 * (jeton d'un membre, PostgREST), contre la stack locale ou une base de test.
 *
 * Contrat : docs/design/07-photos-lot-p.md (P-0b) et la migration
 * *_photos_lot_p0b_rafraichir_adresses.sql. Les cas fins (règle de
 * remplacement, lignes sans profil, formes du job_id, refus) sont dans
 * supabase/tests/candidate_pictures_audit.sql ; ici, le tracé complet :
 *
 *   A. une adresse échue est remplacée, et la vue mission_candidate_rows (la
 *      lecture du Pipeline) rend la nouvelle photo, étape inchangée ;
 *   B. un second passage ne réécrit rien ;
 *   C. un membre d'une autre organisation ne touche pas la ligne ;
 *   D. l'appel est refusé sans session (clé anonyme).
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { E2E } from '../helpers/env';
import { admin, createOrg, deleteOrg, seedCandidateRow, signIn, type TestOrg } from '../helpers/supabase-admin';

test.setTimeout(90_000);

const orgs: TestOrg[] = [];
test.afterEach(async () => {
  while (orgs.length) {
    const org = orgs.pop()!;
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, []);
  }
});

const BASE = 'https://media.licdn.com/dms/image/v2/D4E03AQ/profile-displayphoto-shrink_100_100/0/1?e=';
const at = (ms: number, tag: string) => `${BASE}${Math.floor(ms / 1000)}&v=beta&t=${tag}`;
const DAY = 24 * 60 * 60 * 1000;

async function memberClient(org: TestOrg) {
  const session = await signIn(org.owner.email, org.owner.password);
  return createClient(E2E.supabaseUrl, E2E.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
}

test('une adresse échue est remplacée et le Pipeline rend la nouvelle photo', async () => {
  const org = await createOrg('agency');
  orgs.push(org);
  const expired = at(Date.now() - 5 * DAY, 'old');
  const fresh = at(Date.now() + 30 * DAY, 'new');
  const { id, missionId } = await seedCandidateRow({
    orgId: org.orgId,
    createdBy: org.owner.userId,
    candidateId: 'pic-api-1',
    extra: { linkedin_profile_data: { name: 'Camille Martin', headline: 'Staff Engineer', profile_picture_url: expired } },
  });
  const jobId = `project:${missionId}`;
  const client = await memberClient(org);

  const view = async () => {
    const { data, error } = await client
      .from('mission_candidate_rows')
      .select('id, general_stage, picture:linkedin_profile_data->>profile_picture_url, picture_large:linkedin_profile_data->>profile_picture_url_large')
      .eq('project_id', missionId)
      .eq('candidate_id', 'pic-api-1');
    expect(error).toBeNull();
    return data as unknown as Array<{ id: string; general_stage: string; picture: string | null; picture_large: string | null }>;
  };

  const before = await view();
  expect(before).toHaveLength(1);
  expect(before[0].picture).toBe(expired);

  // A. remplacement
  const first = await client.rpc('refresh_candidate_pictures', {
    p_job_ids: [jobId, missionId],
    p_items: [{ candidate_id: 'pic-api-1', picture: fresh, picture_large: fresh }],
  });
  expect(first.error).toBeNull();
  expect(first.data).toBe(1);

  const after = await view();
  expect(after).toHaveLength(1);
  expect(after[0].picture).toBe(fresh);
  expect(after[0].picture_large).toBe(fresh);
  expect(after[0].general_stage).toBe(before[0].general_stage);

  // Le reste du profil est intact.
  const { data: row } = await admin().from('job_candidate_status').select('linkedin_profile_data').eq('id', id).single();
  expect((row?.linkedin_profile_data as Record<string, unknown>).name).toBe('Camille Martin');
  expect((row?.linkedin_profile_data as Record<string, unknown>).headline).toBe('Staff Engineer');

  // B. second passage : plus rien à écrire.
  const second = await client.rpc('refresh_candidate_pictures', {
    p_job_ids: [jobId, missionId],
    p_items: [{ candidate_id: 'pic-api-1', picture: fresh, picture_large: fresh }],
  });
  expect(second.error).toBeNull();
  expect(second.data).toBe(0);
});

test('un membre d\'une autre organisation ne touche pas la ligne', async () => {
  const org = await createOrg('agency');
  const other = await createOrg('agency');
  orgs.push(org, other);
  const expired = at(Date.now() - 5 * DAY, 'old');
  const { missionId } = await seedCandidateRow({
    orgId: org.orgId,
    createdBy: org.owner.userId,
    candidateId: 'pic-api-2',
    extra: { linkedin_profile_data: { name: 'Camille Martin', profile_picture_url: expired } },
  });
  const intruder = await memberClient(other);
  const { data, error } = await intruder.rpc('refresh_candidate_pictures', {
    p_job_ids: [`project:${missionId}`, missionId],
    p_items: [{ candidate_id: 'pic-api-2', picture: at(Date.now() + 30 * DAY, 'new'), picture_large: null }],
  });
  expect(error).toBeNull();
  expect(data).toBe(0);
  const { data: row } = await admin().from('job_candidate_status').select('linkedin_profile_data').eq('candidate_id', 'pic-api-2').single();
  expect((row?.linkedin_profile_data as Record<string, unknown>).profile_picture_url).toBe(expired);
});

test('l\'appel sans session est refusé', async () => {
  const anon = createClient(E2E.supabaseUrl, E2E.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await anon.rpc('refresh_candidate_pictures', { p_job_ids: ['x'], p_items: [] });
  expect(error?.code).toBe('42501');
});

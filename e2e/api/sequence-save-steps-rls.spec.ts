/**
 * B1 sécurité — frontière org sur save_sequence_steps (SECURITY INVOKER).
 *
 * La RPC public.save_sequence_steps réconcilie les steps d'une séquence
 * (UPDATE in-place / INSERT / DELETE des absents). Comme elle est SECURITY
 * INVOKER, un membre d'une AUTRE org ne doit pas pouvoir éditer — et surtout
 * pas VIDER (p_steps=[]) — les steps d'une séquence qui ne lui appartient pas :
 * la RLS filtre les lignes hors de sa portée, donc le DELETE ne touche rien.
 *
 * On appelle la RPC via REST authentifié (Bearer d'un user org B) sur la
 * séquence d'org A, puis on RELIT les steps d'org A via service-role pour
 * prouver qu'ils sont INCHANGÉS. Un sanity check confirme que la RPC mute bien
 * quand elle est appelée légitimement (service-role sur sa propre séquence).
 *
 * @critical
 */
import { test, expect, request } from '@playwright/test';
import { admin, createOrg, deleteOrg, signIn, type TestOrg } from '../helpers/supabase-admin';
import { E2E } from '../helpers/env';

interface SeededStep {
  id: string;
  step_order: number;
}

let orgA: TestOrg;
let orgB: TestOrg;
let sequenceId: string;
let seededSteps: SeededStep[];

/** Crée une séquence d'org avec 2 steps message. Renvoie l'id de séquence + les steps. */
async function seedSequenceWithSteps(org: TestOrg): Promise<{ sequenceId: string; steps: SeededStep[] }> {
  const { data: seq, error: seqErr } = await admin()
    .from('outreach_sequences')
    .insert({
      name: `Seq e2e ${Date.now()}`,
      organization_id: org.orgId,
      created_by: org.owner.userId,
    })
    .select('id')
    .single();
  if (seqErr || !seq) throw new Error(`seedSequence: ${seqErr?.message}`);
  const seqId = seq.id as string;

  const { data: steps, error: stepsErr } = await admin()
    .from('sequence_steps')
    .insert([
      {
        sequence_id: seqId,
        organization_id: org.orgId,
        step_order: 1,
        action_type: 'message',
        message_template: 'Bonjour {{first_name}}',
      },
      {
        sequence_id: seqId,
        organization_id: org.orgId,
        step_order: 2,
        action_type: 'message',
        message_template: 'Relance J+3',
      },
    ])
    .select('id, step_order')
    .order('step_order', { ascending: true });
  if (stepsErr || !steps) throw new Error(`seedSteps: ${stepsErr?.message}`);
  return { sequenceId: seqId, steps: steps as SeededStep[] };
}

/** POST /rest/v1/rpc/save_sequence_steps en tant qu'user authentifié (Bearer). */
async function callSaveSequenceSteps(
  token: string,
  pSequenceId: string,
  pSteps: Record<string, unknown>[],
): Promise<{ status: number }> {
  const ctx = await request.newContext();
  const res = await ctx.post(`${E2E.supabaseUrl}/rest/v1/rpc/save_sequence_steps`, {
    headers: {
      apikey: E2E.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: { p_sequence_id: pSequenceId, p_steps: pSteps },
  });
  const status = res.status();
  await ctx.dispose();
  return { status };
}

/** Nombre de steps actuellement en base pour une séquence (lecture service-role). */
async function countSteps(seqId: string): Promise<number> {
  const { data, error } = await admin().from('sequence_steps').select('id').eq('sequence_id', seqId);
  if (error) throw new Error(`countSteps: ${error.message}`);
  return data?.length ?? 0;
}

test.beforeEach(async () => {
  orgA = await createOrg('agency', 'E2E SeqRLS A');
  orgB = await createOrg('agency', 'E2E SeqRLS B');
  const seeded = await seedSequenceWithSteps(orgA);
  sequenceId = seeded.sequenceId;
  seededSteps = seeded.steps;
});

test.afterEach(async () => {
  // Steps + séquence ne sont pas couverts par deleteOrg → ménage explicite d'abord.
  await admin().from('sequence_steps').delete().eq('sequence_id', sequenceId);
  await admin().from('outreach_sequences').delete().eq('id', sequenceId);
  await deleteOrg(orgA);
  await deleteOrg(orgB);
});

test.describe('@critical save_sequence_steps respecte la frontière org (SECURITY INVOKER)', () => {
  test("un user d'org B ne peut pas vider les steps d'une séquence d'org A", async () => {
    expect(await countSteps(sequenceId), 'seed initial org A = 2 steps').toBe(2);

    const sessionB = await signIn(orgB.owner.email, orgB.owner.password);

    // Tentative destructrice : effacer TOUS les steps d'org A avec un payload vide.
    const { status } = await callSaveSequenceSteps(sessionB.access_token, sequenceId, []);

    // La RPC RAISE 'Sequence not found or not accessible' (check_violation)
    // quand la séquence est invisible pour le caller → PostgREST 4xx. Un 2xx
    // ici signifierait que la RLS a laissé org B VOIR la séquence d'org A.
    // (L'assertion porteuse reste la relecture countSteps ci-dessous.)
    expect(
      status,
      `la RPC doit refuser un caller d'une autre org (status=${status})`,
    ).toBeGreaterThanOrEqual(400);

    expect(
      await countSteps(sequenceId),
      `steps d'org A intacts après tentative d'org B (status=${status})`,
    ).toBe(2);
  });

  test('le service-role peut légitimement éditer sa propre séquence (sanity)', async () => {
    // On ne garde qu'un seul step (le 1er) : la RPC doit DELETE le second et
    // UPDATE in-place le premier (id préservé).
    const keep = seededSteps.find((s) => s.step_order === 1);
    expect(keep, 'step_order=1 présent dans le seed').toBeTruthy();

    const { error } = await admin().rpc('save_sequence_steps', {
      p_sequence_id: sequenceId,
      p_steps: [
        {
          id: keep!.id,
          step_order: 1,
          action_type: 'message',
          message_template: 'Bonjour {{first_name}} (édité)',
        },
      ],
    });
    expect(error, 'save_sequence_steps via service-role').toBeNull();

    expect(await countSteps(sequenceId), 'un step supprimé, un conservé').toBe(1);

    const { data: remaining } = await admin()
      .from('sequence_steps')
      .select('id, message_template')
      .eq('sequence_id', sequenceId);
    expect(remaining?.[0]?.id, 'id du step conservé préservé (FK executions intactes)').toBe(keep!.id);
    expect(remaining?.[0]?.message_template, 'template mis à jour in-place').toContain('édité');
  });
});

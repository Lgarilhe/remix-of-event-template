/**
 * Édition de séquence non destructive — RPC public.save_sequence_steps.
 *
 * Correctifs d'audit couverts :
 *  - B1 : l'édition d'un step se fait en UPDATE in-place (préserve l'id du step)
 *         donc les sequence_step_executions déjà planifiées gardent leur FK et ne
 *         sont PLUS détruites en cascade (l'ancien chemin faisait DELETE-all + INSERT).
 *  - H3 : persistance des options A/B et email (variant_group / variant_weight /
 *         cc_emails) que l'ancien chemin de sauvegarde perdait silencieusement.
 *  - H7 : marqueur ends_sequence, DELETE des SEULS steps retirés du payload, et
 *         remap des refs de branchement (next_step_id) client_id -> db_uuid.
 *
 * La RPC est SECURITY INVOKER : on l'appelle ici en service-role via admin().rpc
 * (la RLS est testée ailleurs) pour exercer purement la logique transactionnelle.
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
import { admin, createOrg, deleteOrg, type TestOrg } from '../helpers/supabase-admin';

const rand = () => Math.random().toString(36).slice(2, 10);

/** Objet step tel qu'accepté par save_sequence_steps (clés snake_case). */
type StepPayload = {
  id?: string;
  step_order: number;
  action_type: string;
  condition_type?: string;
  message_template?: string | null;
  subject_template?: string | null;
  delay_days?: number;
  delay_hours?: number;
  delay_minutes?: number | null;
  use_ai_personalization?: boolean;
  variant_group?: string;
  variant_weight?: number;
  ends_sequence?: boolean;
  cc_emails?: string[];
  next_step_id?: string;
};

/** Ligne sequence_steps relue depuis la DB (colonnes utiles aux assertions). */
type StepRow = {
  id: string;
  step_order: number;
  action_type: string;
  condition_type: string | null;
  message_template: string | null;
  subject_template: string | null;
  delay_days: number;
  delay_hours: number;
  delay_minutes: number | null;
  variant_group: string | null;
  variant_weight: number | null;
  ends_sequence: boolean;
  cc_emails: string[] | null;
  next_step_id: string | null;
};

let org: TestOrg;

/** Crée une outreach_sequence jetable rattachée à l'org courante. */
async function seedSequence(): Promise<string> {
  const { data, error } = await admin()
    .from('outreach_sequences')
    .insert({
      name: `Seq e2e ${rand()}`,
      organization_id: org.orgId,
      created_by: org.owner.userId,
      is_active: true,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedSequence: ${error?.message}`);
  return data.id as string;
}

/** Insère `count` steps directs (step_order 1..count) et renvoie leurs lignes triées. */
async function seedSteps(sequenceId: string, count: number): Promise<StepRow[]> {
  const rows = Array.from({ length: count }, (_, i) => ({
    sequence_id: sequenceId,
    organization_id: org.orgId,
    step_order: i + 1,
    action_type: 'message',
    condition_type: 'always',
    message_template: `Message initial step ${i + 1}`,
  }));
  const { error } = await admin().from('sequence_steps').insert(rows);
  if (error) throw new Error(`seedSteps: ${error.message}`);
  return readSteps(sequenceId);
}

/** Relit tous les steps d'une séquence, triés par step_order. */
async function readSteps(sequenceId: string): Promise<StepRow[]> {
  const { data, error } = await admin()
    .from('sequence_steps')
    .select(
      'id, step_order, action_type, condition_type, message_template, subject_template, ' +
        'delay_days, delay_hours, delay_minutes, variant_group, variant_weight, ' +
        'ends_sequence, cc_emails, next_step_id',
    )
    .eq('sequence_id', sequenceId)
    .order('step_order', { ascending: true });
  if (error) throw new Error(`readSteps: ${error.message}`);
  return (data ?? []) as unknown as StepRow[];
}

/** Appelle la RPC en service-role. Jette si la RPC remonte une erreur SQL. */
async function saveSteps(sequenceId: string, steps: StepPayload[]): Promise<void> {
  const { error } = await admin().rpc('save_sequence_steps', {
    p_sequence_id: sequenceId,
    p_steps: steps,
  });
  if (error) throw new Error(`save_sequence_steps: ${error.message}`);
}

test.beforeEach(async () => {
  org = await createOrg('agency', 'E2E SaveSteps');
});

test.afterEach(async () => {
  const a = admin();
  // Ordre enfant -> parent. deleteOrg couvre sequence_enrollments + sourcing_projects
  // par org, mais PAS outreach_sequences / sequence_steps / executions : on les purge ici.
  await a.from('sequence_step_executions').delete().eq('organization_id', org.orgId);
  await a.from('sequence_steps').delete().eq('organization_id', org.orgId);
  await a.from('outreach_sequences').delete().eq('organization_id', org.orgId);
  await deleteOrg(org);
});

test.describe('@critical Édition de séquence non destructive (RPC save_sequence_steps)', () => {
  test('édite un step sans détruire les exécutions planifiées (B1)', async () => {
    const seqId = await seedSequence();
    const steps = await seedSteps(seqId, 3);
    const [s1, s2, s3] = steps;

    // Un enrollment actif + une exécution PLANIFIÉE pointant sur le step 2.
    const { data: enr, error: enrErr } = await admin()
      .from('sequence_enrollments')
      .insert({
        sequence_id: seqId,
        organization_id: org.orgId,
        created_by: org.owner.userId,
        account_id: `acc_${rand()}`,
        profile_id: `prof_${rand()}`,
        status: 'active',
      })
      .select('id')
      .single();
    expect(enrErr, 'seed enrollment').toBeNull();
    const enrollmentId = (enr as { id: string }).id;

    const { data: exec, error: execErr } = await admin()
      .from('sequence_step_executions')
      .insert({
        enrollment_id: enrollmentId,
        organization_id: org.orgId,
        step_id: s2.id,
        step_order: s2.step_order,
        scheduled_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        status: 'scheduled',
      })
      .select('id')
      .single();
    expect(execErr, 'seed execution').toBeNull();
    const execId = (exec as { id: string }).id;

    // Payload reconstruit depuis les steps existants (id = db-uuid) → UPDATE in-place.
    // Seul le message du step 1 change ; les ids ne bougent pas.
    const NEW_MSG = 'Message ÉDITÉ step 1';
    const payload: StepPayload[] = steps.map((s) => ({
      id: s.id,
      step_order: s.step_order,
      action_type: s.action_type,
      condition_type: s.condition_type ?? 'always',
      message_template: s.id === s1.id ? NEW_MSG : s.message_template,
    }));
    await saveSteps(seqId, payload);

    // L'exécution planifiée existe TOUJOURS, avec le même id et le même step_id.
    const { data: execAfter } = await admin()
      .from('sequence_step_executions')
      .select('id, step_id, status')
      .eq('id', execId)
      .maybeSingle();
    expect(execAfter, "l'exécution planifiée ne doit PAS être détruite par l'édition").not.toBeNull();
    expect((execAfter as { step_id: string }).step_id, 'FK step_id préservée (id du step 2 inchangé)').toBe(s2.id);

    // Les 3 steps existent toujours, mêmes ids, message du step 1 modifié.
    const after = await readSteps(seqId);
    expect(after.length, 'aucun step supprimé (tous dans le payload)').toBe(3);
    expect(after.map((s) => s.id).sort(), 'les ids des steps sont préservés').toEqual(
      [s1.id, s2.id, s3.id].sort(),
    );
    const edited = after.find((s) => s.id === s1.id);
    expect(edited?.message_template, 'message du step 1 bien mis à jour').toBe(NEW_MSG);
    const untouched = after.find((s) => s.id === s2.id);
    expect(untouched?.message_template, 'message du step 2 préservé').toBe(s2.message_template);
  });

  test('supprime uniquement les steps retirés du payload (H7)', async () => {
    const seqId = await seedSequence();
    const [s1, s2, s3] = await seedSteps(seqId, 3);

    // Payload = seulement steps 1 et 3 (le 2 est absent → doit disparaître, lui seul).
    const payload: StepPayload[] = [s1, s3].map((s) => ({
      id: s.id,
      step_order: s.step_order,
      action_type: s.action_type,
      condition_type: s.condition_type ?? 'always',
      message_template: s.message_template,
    }));
    await saveSteps(seqId, payload);

    const after = await readSteps(seqId);
    expect(after.length, 'exactement 2 steps restants').toBe(2);
    expect(after.map((s) => s.id).sort(), 'les 2 ids conservés sont s1 et s3, s2 supprimé').toEqual(
      [s1.id, s3.id].sort(),
    );
    expect(after.some((s) => s.id === s2.id), 'le step retiré du payload a bien disparu').toBe(false);
  });

  test('persiste ends_sequence + cc_emails + variant_group (H3)', async () => {
    const seqId = await seedSequence();

    // 2 nouveaux steps (ids clients) : le 1er porte une variante A/B, le dernier
    // marque la fin de séquence + un cc email.
    const payload: StepPayload[] = [
      {
        id: 'client-a',
        step_order: 1,
        action_type: 'message',
        message_template: 'Variante A',
        variant_group: 'A',
        variant_weight: 50,
      },
      {
        id: 'client-b',
        step_order: 2,
        action_type: 'email',
        message_template: 'Dernier step',
        cc_emails: ['x@y.co'],
        ends_sequence: true,
      },
    ];
    await saveSteps(seqId, payload);

    const after = await readSteps(seqId);
    expect(after.length, 'les 2 steps insérés').toBe(2);
    const first = after[0];
    const last = after[1];
    expect(first.variant_group, 'variant_group A persisté').toBe('A');
    expect(first.variant_weight, 'variant_weight 50 persisté').toBe(50);
    expect(last.ends_sequence, 'ends_sequence=true persisté sur le dernier step').toBe(true);
    expect(last.cc_emails, 'cc_emails persisté').toEqual(['x@y.co']);
  });

  test('remappe next_step_id vers les nouveaux ids sur des steps insérés (H7)', async () => {
    const seqId = await seedSequence();

    // Deux NOUVEAUX steps avec des ids clients non-uuid ; c1 branche vers c2.
    const payload: StepPayload[] = [
      { id: 'c1', step_order: 1, action_type: 'message', message_template: 'Step c1', next_step_id: 'c2' },
      { id: 'c2', step_order: 2, action_type: 'message', message_template: 'Step c2' },
    ];
    await saveSteps(seqId, payload);

    const after = await readSteps(seqId);
    expect(after.length, 'les 2 steps insérés').toBe(2);
    const stepC1 = after[0]; // step_order 1
    const stepC2 = after[1]; // step_order 2
    expect(stepC1.next_step_id, 'next_step_id ne doit pas rester null').not.toBeNull();
    expect(stepC1.next_step_id, "next_step_id ne doit pas rester l'id client brut 'c2'").not.toBe('c2');
    expect(stepC1.next_step_id, 'next_step_id remappé vers le db-uuid du step c2').toBe(stepC2.id);
  });
});

/**
 * Intégrité DB des exécutions de séquence — correctif d'audit H8.
 *
 * Couvre la migration 20260715092000_sequence_integrity_constraints.sql :
 *  1. Index UNIQUE partiel `uq_step_exec_pending_per_enrollment_step` sur
 *     sequence_step_executions (enrollment_id, step_id) WHERE status pendant
 *     ('scheduled','sending','waiting_event','quota_blocked') → empêche la
 *     double-planification (TOCTOU janitor + run concurrent = 2 messages au
 *     même candidat). L'historique terminal (cancelled/sent/…) peut coexister
 *     avec une re-planification légitime.
 *  2. `created_by` rendu NULLABLE sur outreach_sequences + sequence_enrollments
 *     (cohérent avec le ON DELETE SET NULL posé par 20260504150000) → la
 *     suppression d'un compte auth.users ne casse plus l'offboarding / RGPD.
 *
 * Tous les seeds passent par le client service-role (admin()) : on teste ici
 * une contrainte de base de données, pas une frontière RLS.
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
import { admin, createOrg, deleteOrg, type TestOrg } from '../helpers/supabase-admin';

let org: TestOrg;

const rand = () => Math.random().toString(36).slice(2, 10);

test.beforeEach(async () => {
  org = await createOrg('agency', 'E2E SeqIntegrity');
});

test.afterEach(async () => {
  // Supprimer les séquences cascade sur steps / enrollments / executions
  // (ON DELETE CASCADE). outreach_sequences.organization_id est une FK RESTRICT
  // → il FAUT purger les séquences avant deleteOrg, sinon la suppression d'org
  // échoue silencieusement et fuit des données.
  await admin().from('outreach_sequences').delete().eq('organization_id', org.orgId);
  await deleteOrg(org);
});

/** Seed minimal : 1 séquence + 1 step (message) + 1 enrollment actif. */
async function seedSequenceGraph(): Promise<{
  sequenceId: string;
  stepId: string;
  enrollmentId: string;
}> {
  const a = admin();

  const { data: seq, error: seqErr } = await a
    .from('outreach_sequences')
    .insert({ name: `Seq ${rand()}`, organization_id: org.orgId, created_by: org.owner.userId })
    .select('id')
    .single();
  if (seqErr || !seq) throw new Error(`seed outreach_sequences: ${seqErr?.message}`);
  const sequenceId = seq.id as string;

  const { data: step, error: stepErr } = await a
    .from('sequence_steps')
    .insert({
      sequence_id: sequenceId,
      organization_id: org.orgId,
      step_order: 1,
      action_type: 'message',
    })
    .select('id')
    .single();
  if (stepErr || !step) throw new Error(`seed sequence_steps: ${stepErr?.message}`);
  const stepId = step.id as string;

  const { data: enr, error: enrErr } = await a
    .from('sequence_enrollments')
    .insert({
      sequence_id: sequenceId,
      organization_id: org.orgId,
      account_id: `acc_${rand()}`,
      profile_id: `prof_${rand()}`,
      status: 'active',
      created_by: org.owner.userId,
    })
    .select('id')
    .single();
  if (enrErr || !enr) throw new Error(`seed sequence_enrollments: ${enrErr?.message}`);
  const enrollmentId = enr.id as string;

  return { sequenceId, stepId, enrollmentId };
}

test.describe('@critical Intégrité DB des exécutions de séquence', () => {
  test('impossible d\'avoir deux exécutions PENDANTES du même (enrollment, step)', async () => {
    const { stepId, enrollmentId } = await seedSequenceGraph();
    const scheduledAt = new Date().toISOString();

    const first = await admin().from('sequence_step_executions').insert({
      enrollment_id: enrollmentId,
      step_id: stepId,
      step_order: 1,
      scheduled_at: scheduledAt,
      organization_id: org.orgId,
      status: 'scheduled',
    });
    expect(first.error, 'la 1re exécution scheduled doit passer').toBeNull();

    const second = await admin().from('sequence_step_executions').insert({
      enrollment_id: enrollmentId,
      step_id: stepId,
      step_order: 1,
      scheduled_at: scheduledAt,
      organization_id: org.orgId,
      status: 'scheduled',
    });
    // Deux lignes PENDANTES sur le même (enrollment, step) = violation de l'index
    // unique partiel → l'insert DOIT échouer.
    expect(
      second.error,
      'la 2e exécution pendante identique doit être refusée par l\'index unique partiel',
    ).not.toBeNull();
    const diag = `${second.error?.code ?? ''} ${second.error?.message ?? ''}`.toLowerCase();
    expect(
      second.error?.code === '23505' || /unique|duplicate/.test(diag),
      `erreur attendue 23505 / "unique" / "duplicate", reçu: "${diag}"`,
    ).toBe(true);
  });

  test('on peut re-planifier après annulation de la première', async () => {
    const { stepId, enrollmentId } = await seedSequenceGraph();

    const insFirst = await admin()
      .from('sequence_step_executions')
      .insert({
        enrollment_id: enrollmentId,
        step_id: stepId,
        step_order: 1,
        scheduled_at: new Date().toISOString(),
        organization_id: org.orgId,
        status: 'scheduled',
      })
      .select('id')
      .single();
    expect(insFirst.error, 'insertion de la 1re exécution').toBeNull();
    const firstId = insFirst.data!.id as string;

    // Passe la 1re en 'cancelled' → elle sort du prédicat de l'index partiel.
    const upd = await admin()
      .from('sequence_step_executions')
      .update({ status: 'cancelled' })
      .eq('id', firstId);
    expect(upd.error, 'annulation de la 1re exécution').toBeNull();

    // Une nouvelle planification pendante est désormais autorisée : l'index
    // partiel n'inclut PAS le statut 'cancelled', donc pas de collision.
    const insSecond = await admin().from('sequence_step_executions').insert({
      enrollment_id: enrollmentId,
      step_id: stepId,
      step_order: 1,
      scheduled_at: new Date().toISOString(),
      organization_id: org.orgId,
      status: 'scheduled',
    });
    expect(
      insSecond.error,
      're-planification après annulation doit réussir (index partiel exclut cancelled)',
    ).toBeNull();

    // Discriminant : sans l'index, ce test passerait aussi. On prouve que
    // l'index se RÉ-ARME après la re-planification légitime — une 3e ligne
    // pendante sur le même (enrollment, step) doit de nouveau être refusée.
    const insThird = await admin().from('sequence_step_executions').insert({
      enrollment_id: enrollmentId,
      step_id: stepId,
      step_order: 1,
      scheduled_at: new Date().toISOString(),
      organization_id: org.orgId,
      status: 'scheduled',
    });
    expect(
      insThird.error,
      "une 3e exécution pendante doit être refusée (l'index se ré-arme)",
    ).not.toBeNull();
  });

  test('created_by est nullable sur outreach_sequences et sequence_enrollments', async () => {
    // 1) outreach_sequences SANS created_by → doit passer (colonne rendue nullable).
    const seqIns = await admin()
      .from('outreach_sequences')
      .insert({ name: `Seq no-owner ${rand()}`, organization_id: org.orgId })
      .select('id, created_by')
      .single();
    expect(seqIns.error, 'outreach_sequences doit accepter created_by absent/NULL').toBeNull();
    expect(seqIns.data?.created_by, 'created_by doit valoir null sur la séquence').toBeNull();
    const sequenceId = seqIns.data!.id as string;

    // 2) sequence_enrollments avec created_by explicitement null → doit passer.
    // Garantit que le ON DELETE SET NULL (suppression d'un user) ne violera pas
    // de contrainte NOT NULL.
    const enrIns = await admin()
      .from('sequence_enrollments')
      .insert({
        sequence_id: sequenceId,
        organization_id: org.orgId,
        account_id: `acc_${rand()}`,
        profile_id: `prof_${rand()}`,
        status: 'active',
        created_by: null,
      })
      .select('id, created_by')
      .single();
    expect(enrIns.error, 'sequence_enrollments doit accepter created_by NULL').toBeNull();
    expect(enrIns.data?.created_by, 'created_by doit valoir null sur l\'enrollment').toBeNull();
  });
});

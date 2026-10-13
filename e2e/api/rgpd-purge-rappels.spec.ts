/**
 * Chantier RGPD, décisions du propriétaire du 12/10/2026, contre la stack
 * locale (e2e/local-stack) :
 *   (a) rappels et tâches (candidate_reminders) conservés 2 ans : rgpd-purge,
 *       étape 9, 24 mois après leur dernière activité (création, modification,
 *       échéance ou réalisation, la plus tardive) ;
 *   (b) retouches de messages (tracking_data.message_overrides) retirées des
 *       inscriptions déjà effacées : migration 20261012112803.
 *
 *   R. rgpd-purge sans corps compte les rappels sans rien supprimer ; avec
 *      {"dry_run": false}, seuls les rappels dont la dernière activité date de
 *      plus de 24 mois partent, avec ou sans organisation ;
 *   M. la migration, jouée deux fois sur la base locale : une inscription
 *      effacée perd message_overrides (marqueur, statut, updated_at et lien de
 *      conversation gardés), une inscription non effacée ou au marqueur vide
 *      garde les siennes ; le déclencheur de updated_at est réactivé.
 *
 * Stack locale seulement (e2e/local-stack/up.sh) : fonctions serveur et psql.
 * La purge réelle de R vaut pour toute la base locale : elle ne supprime que
 * des données anciennes (24 mois, ou 12 mois après un écart). Elle se fait
 * sous withRgpdPurgeLock (e2e/helpers/rgpd-purge-lock.ts), comme le contrôle du
 * cas E de stage-0c-lectures.spec.ts (ligne candidat de 25 mois, en compte
 * seulement) : jamais l'un pendant l'autre, quel que soit le nombre de workers.
 * Règle pure des rappels : supabase/functions/_shared/reminder-retention.test.ts.
 *
 * @critical
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { E2E } from '../helpers/env';
import {
  admin,
  createOrg,
  deleteOrg,
  seedEnrollment,
  seedMission,
  seedMissionConversation,
  seedSequence,
  type TestOrg,
} from '../helpers/supabase-admin';
import { ENGINE_SKIP_REASON, engineAvailable, postJson, rand } from '../helpers/sequence-engine';
import { withRgpdPurgeLock } from '../helpers/rgpd-purge-lock';

test.setTimeout(120_000);
test.skip(!engineAvailable, ENGINE_SKIP_REASON);

const MIGRATION = fileURLToPath(
  new URL('../../supabase/migrations/20261012112803_rgpd_retouches_inscriptions_effacees.sql', import.meta.url),
);

function psql(args: string[]): string {
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args],
    { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' },
  );
}

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgs: TestOrg[] = [];
const reminderIds: string[] = [];
test.afterEach(async () => {
  if (reminderIds.length) await admin().from('candidate_reminders').delete().in('id', reminderIds.splice(0));
  while (orgs.length) {
    const org = orgs.pop()!;
    await admin().from('candidate_reminders').delete().eq('organization_id', org.orgId);
    await admin().from('mission_conversations').delete().eq('organization_id', org.orgId);
    await deleteOrg(org);
  }
});

/** Il y a `months` mois (et `days` jours de plus). */
function ago(months: number, days = 0): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

// La pile locale n'a pas de service de stockage (e2e/local-stack/README.md) :
// seule la liste des enregistrements audio échoue alors, hors du périmètre testé.
const purgeErrors = (body: Record<string, unknown>) =>
  (body.errors as string[]).filter((e) => e !== 'audio list: no route');

// ════════════════════════════════════════════════════════════════════════════
test.describe('RGPD : purge des rappels à 24 mois (rgpd-purge, étape 9)', () => {
  test('R. compte seulement par défaut, puis seuls les rappels de plus de 24 mois partent', async () => {
    const org = await createOrg('agency', 'E2E RGPD rappels');
    orgs.push(org);
    const base = {
      created_by: org.owner.userId,
      candidate_id: `linkedin:e2e-rappel-${rand()}`,
      candidate_name: 'Camille Martin',
      title: 'Relancer Camille',
      description: 'Note libre sur le candidat',
    };
    const old = { created_at: ago(30), updated_at: ago(30), due_at: ago(26), completed_at: ago(25) };
    const rows = {
      // Toutes les dates au-delà de 24 mois : purgé.
      expired: { ...base, ...old, organization_id: org.orgId },
      // Sans organisation (extension Chrome), même règle : purgé.
      expiredWithoutOrg: { ...base, ...old, completed_at: null, organization_id: null },
      // Une seule date récente garde le rappel, quelle qu'elle soit.
      recentDue: { ...base, ...old, completed_at: null, due_at: ago(23), organization_id: org.orgId },
      recentlyCompleted: { ...base, ...old, completed_at: ago(1), organization_id: org.orgId },
      recentlyUpdated: { ...base, ...old, updated_at: ago(0, 2), organization_id: org.orgId },
      recentWithoutOrg: { ...base, created_at: ago(2), updated_at: ago(2), due_at: ago(1), organization_id: null },
    };
    const ids: Record<keyof typeof rows, string> = {} as Record<keyof typeof rows, string>;
    for (const [key, row] of Object.entries(rows) as Array<[keyof typeof rows, Record<string, unknown>]>) {
      const { data, error } = await admin().from('candidate_reminders').insert(row).select('id').single();
      if (error || !data) throw new Error(`candidate_reminders ${key}: ${error?.message}`);
      ids[key] = data.id as string;
      reminderIds.push(data.id as string);
    }
    const remaining = async () => {
      const { data, error } = await admin().from('candidate_reminders').select('id').in('id', Object.values(ids));
      if (error) throw new Error(error.message);
      return new Set((data ?? []).map((r: { id: string }) => r.id));
    };

    // Sans corps : compte seulement.
    const dry = await postJson('/functions/v1/rgpd-purge', {}, { Authorization: `Bearer ${E2E.serviceRoleKey}` });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.dry_run).toBe(true);
    expect(purgeErrors(dry.body)).toEqual([]);
    expect(Number(dry.body.reminders_purged), 'les deux rappels expirés comptés').toBeGreaterThanOrEqual(2);
    expect(Number(dry.body.reminders_without_org_purged), 'le rappel sans organisation compté à part').toBeGreaterThanOrEqual(1);
    expect(Number(dry.body.reminders_without_org_purged)).toBeLessThanOrEqual(Number(dry.body.reminders_purged));
    expect((await remaining()).size, 'compte seulement : aucun rappel supprimé').toBe(6);

    // Passage réel, sous le verrou : il vaut pour toute la base locale.
    const real = await withRgpdPurgeLock(() =>
      postJson('/functions/v1/rgpd-purge', { dry_run: false }, { Authorization: `Bearer ${E2E.serviceRoleKey}` }));
    expect(real.status, JSON.stringify(real.body)).toBe(200);
    expect(real.body.dry_run).toBe(false);
    expect(purgeErrors(real.body)).toEqual([]);
    expect(Number(real.body.reminders_purged)).toBeGreaterThanOrEqual(2);
    expect(Number(real.body.reminders_without_org_purged)).toBeGreaterThanOrEqual(1);
    const left = await remaining();
    expect(left.has(ids.expired), 'rappel de plus de 24 mois supprimé').toBe(false);
    expect(left.has(ids.expiredWithoutOrg), 'rappel sans organisation de plus de 24 mois supprimé').toBe(false);
    for (const key of ['recentDue', 'recentlyCompleted', 'recentlyUpdated', 'recentWithoutOrg'] as const) {
      expect(left.has(ids[key]), `${key} gardé`).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
test.describe('RGPD : retouches retirées des inscriptions déjà effacées (migration 20261012112803)', () => {
  test('M. effacée : retouches retirées, rien d\'autre ne bouge ; non effacée ou marqueur vide : gardées', async () => {
    const org = await createOrg('agency', 'E2E RGPD retouches');
    orgs.push(org);
    const { sequenceId, steps } = await seedSequence(org.orgId, org.owner.userId);
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const overrides = { [steps[0].id]: { message: 'Bonjour Camille, votre parcours chez Acme a retenu notre attention.' } };
    const erasedAt = '2026-09-30T08:00:00.000Z';
    const oldUpdatedAt = '2025-03-01T10:00:00.000Z';
    const erasedProfile = `ACoAAE2ERGPD${rand()}`;
    const accountId = `acc_${rand()}`;

    const erased = await seedEnrollment(org.orgId, sequenceId, org.owner.userId, {
      profile_id: erasedProfile,
      account_id: accountId,
      status: 'stopped',
      updated_at: oldUpdatedAt,
      tracking_data: { gdpr_erased_at: erasedAt, completion_reason: 'gdpr_erased', message_overrides: overrides },
    });
    const notErased = await seedEnrollment(org.orgId, sequenceId, org.owner.userId, {
      tracking_data: { message_overrides: overrides },
    });
    const emptyMarker = await seedEnrollment(org.orgId, sequenceId, org.owner.userId, {
      status: 'completed',
      tracking_data: { gdpr_erased_at: null, message_overrides: overrides },
    });
    // Lien de conversation posé après le marqueur : la migration ne doit pas le supprimer.
    const linkId = await seedMissionConversation({
      orgId: org.orgId, projectId: missionId, accountId, candidateId: erasedProfile, createdBy: org.owner.userId,
    });

    // Deux passes : la seconde ne trouve plus rien et ne lève rien.
    psql(['-q', '-1', '-f', MIGRATION]);
    psql(['-q', '-1', '-f', MIGRATION]);

    const { data, error } = await admin().from('sequence_enrollments')
      .select('id, status, updated_at, tracking_data').in('id', [erased, notErased, emptyMarker]);
    if (error) throw new Error(error.message);
    type Row = { id: string; status: string; updated_at: string; tracking_data: Record<string, unknown> };
    const byId = new Map(((data ?? []) as Row[]).map((r) => [r.id, r]));

    const e = byId.get(erased)!;
    expect(e.tracking_data, 'retouches retirées, marqueurs gardés').toEqual({ gdpr_erased_at: erasedAt, completion_reason: 'gdpr_erased' });
    expect(e.status).toBe('stopped');
    expect(new Date(e.updated_at).toISOString(), 'updated_at inchangé (purge des inscriptions closes)').toBe(oldUpdatedAt);
    expect(byId.get(notErased)!.tracking_data.message_overrides, 'non effacée : retouches gardées').toEqual(overrides);
    expect(byId.get(emptyMarker)!.tracking_data.message_overrides, 'marqueur vide : retouches gardées').toEqual(overrides);

    const { data: links } = await admin().from('mission_conversations').select('id').eq('id', linkId);
    expect(links, 'lien conversation-mission gardé').toHaveLength(1);
    expect(
      psql(['-Atc', `SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.sequence_enrollments'::regclass
                       AND tgname = 'update_sequence_enrollments_updated_at'`]).trim(),
      'déclencheur de updated_at réactivé',
    ).toBe('O');
  });
});

/**
 * Séquences d'outreach — onglet « outreach » d'une mission.
 *
 * Couvre le lot « moteur de séquences » (audit 2026-09-01) côté interface.
 *
 * Le smoke ci-dessous valide la chaîne auth → routing → RLS → rendu de
 * l'onglet. Les parcours profonds ont leurs fichiers : éditeur (création,
 * branches, expéditeurs, duplication) dans `sequences-builder.spec.ts`, suivi
 * des inscriptions (saut d'étape, envoi du jour, pause et réactivation,
 * collaborateur, retrait d'un membre) dans `sequences-enrollments.spec.ts`,
 * moteur de bout en bout dans `e2e/api/sequences-scenarios.spec.ts`.
 */
import { test, expect } from '../fixtures';
import { pinLegacySequences } from '../helpers/env';
import { storageStateFor, role } from '../helpers/registry';
import { admin, seedEnrollment, seedMission, seedSequence } from '../helpers/supabase-admin';

test.use({ storageState: storageStateFor('agencyOwner') });

// Lot 5h : ancienne interface des séquences, épinglée sur le secours (clé à « 0 ») jusqu'au lot 5j.
test.beforeEach(async ({ context }) => {
  await pinLegacySequences(context);
});

test.describe('Séquences', () => {
  let missionId: string;
  let sequenceId: string;

  test.beforeEach(async () => {
    const g = role('agencyOwner');
    missionId = await seedMission(g.orgId, g.userId, { name: 'Mission Séquences E2E' });
    const seeded = await seedSequence(g.orgId, g.userId, [
      { action_type: 'connection_request' },
      { action_type: 'wait_connection', wait_for_event: 'connection_accepted' },
      { action_type: 'message' },
    ]);
    sequenceId = seeded.sequenceId;
    await seedEnrollment(g.orgId, sequenceId, g.userId);
  });

  test.afterEach(async () => {
    await admin().from('outreach_sequences').delete().eq('id', sequenceId);
    await admin().from('sourcing_projects').delete().eq('id', missionId);
  });

  // mockVendors est indispensable : MissionOutreach sort par un retour anticipé
  // tant que la liste des comptes LinkedIn est vide, et cette liste vient de
  // l'edge function unipile-accounts, que `supabase start` n'expose pas en CI.
  // Les fixtures Playwright sont paresseuses, il faut donc la demander ici.
  test("@smoke l'onglet outreach affiche la séquence de l'organisation", async ({ page, mockVendors }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto(`/missions/${missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    await expect(page).not.toHaveURL(/\/auth\b/);
    await expect(page.locator('#root')).not.toBeEmpty();

    // La séquence seedée est lisible par son org (RLS) et rendue par la liste.
    await expect(page.getByText(/Séquence e2e/i).first()).toBeVisible({ timeout: 15_000 });

    const jsCrashes = errors.filter((e) =>
      /unhandled|uncaught|TypeError|ReferenceError|is not a function/i.test(e),
    );
    expect(jsCrashes, `crashes JS: ${jsCrashes.join(' | ')}`).toEqual([]);
  });
});

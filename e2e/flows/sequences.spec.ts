/**
 * Séquences d'outreach — onglet « outreach » d'une mission.
 *
 * Couvre le lot « moteur de séquences » (audit 2026-09-01) côté interface.
 *
 * Comme pour `sourcing-linkedin.spec.ts`, les enchaînements profonds (builder
 * en 5 étapes, panneau d'enrollments) dépendent de locators qui doivent être
 * capturés EN LIVE par le générateur Playwright plutôt que devinés : ils sont
 * en `test.fixme` avec le scénario précis à jouer. Le smoke ci-dessous valide
 * déjà la chaîne auth → routing → RLS → rendu de l'onglet, et la régression
 * qui comptait le plus (création de séquence refusée par RLS) est couverte
 * sans navigateur par `e2e/api/sequences-rls.spec.ts`.
 */
import { test, expect } from '../fixtures';
import { storageStateFor, role } from '../helpers/registry';
import { admin, seedEnrollment, seedMission, seedSequence } from '../helpers/supabase-admin';

test.use({ storageState: storageStateFor('agencyOwner') });

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

  test("@smoke l'onglet outreach affiche la séquence de l'organisation", async ({ page }) => {
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

  test.fixme('@critical créer une séquence depuis le builder la fait apparaître dans la liste (SEC-013)', async () => {
    // À GÉNÉRER en live (locators du builder) :
    //   1. onglet outreach → bouton « Nouvelle séquence »
    //   2. wizard : nom, une étape message, enregistrer
    //   3. attendre le toast de succès, puis vérifier la ligne dans la liste
    //   4. en base : la ligne porte bien organization_id = org de l'utilisateur
    // Régression visée : les deux inserts sans organization_id étaient refusés
    // par RLS, avec un toast « Séquence enregistrée » trompeur (SEC-013,
    // BUG-045). La policy elle-même est déjà couverte par
    // e2e/api/sequences-rls.spec.ts.
  });

  test.fixme('@critical dupliquer une séquence crée une copie inactive avec ses étapes', async () => {
    // À GÉNÉRER en live :
    //   1. menu « … » de la séquence → « Dupliquer »
    //   2. vérifier la ligne « (copie) », inactive
    //   3. en base : organization_id renseigné et étapes recopiées avec les
    //      branchements remappés vers les nouveaux ids
  });

  test.fixme('@critical « Sauter » une étape avance la séquence et ne la rejoue pas (BUG-007)', async () => {
    // À GÉNÉRER en live :
    //   1. ouvrir le panneau d'enrollments de la séquence
    //   2. sur l'étape planifiée : « Sauter cette étape » → confirmer
    //   3. vérifier le toast, puis en base : exécution 'skipped',
    //      current_step_order incrémenté, exécution créée pour l'étape suivante
    //   4. rejouer le janitor (action `process` en clé de service) et vérifier
    //      qu'AUCUNE nouvelle exécution n'est créée pour l'étape sautée
    // Le contrat serveur est déjà couvert par e2e/api/sequences-engine.spec.ts ;
    // ce test valide le câblage du bouton (avant : 401 avalé silencieusement).
  });

  test.fixme('@critical « Envoyer tout » avance les actions sans erreur pour un membre non admin (MQ-002)', async () => {
    // À GÉNÉRER en live, avec le storageState d'un COLLABORATEUR (pas owner) :
    //   1. liste des séquences → bouton « Envoyer tout »
    //   2. attendre le toast « N action(s) avancée(s) » (et non une erreur)
    //   3. en base : les exécutions futures de MON org sont à maintenant,
    //      celles d'une autre org inchangées
    // Avant le correctif, l'UI appelait `force_reschedule` puis `process`,
    // refusés à tout utilisateur sans rôle plateforme → 401 systématique.
  });
});

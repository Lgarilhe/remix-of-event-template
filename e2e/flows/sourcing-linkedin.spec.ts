/**
 * Sourcing LinkedIn — persona Guillaume.
 * Vendors mockés (Unipile, scoring).
 *
 * NB : le flux de recherche complet (saisie filtres → résultats → scoring →
 * survie du missionSearchCache au tab switch) dépend de locators et d'un
 * enchaînement UI qui doivent être capturés EN LIVE par le générateur
 * Playwright (agent), pas devinés à la main. La partie profonde est donc en
 * `test.fixme` jusqu'à génération live ; le smoke ci-dessous valide déjà la
 * chaîne réelle auth → routing → RLS → rendu de la mission.
 */
import { test, expect } from '../fixtures';
import { storageStateFor, role } from '../helpers/registry';
import { seedMission, admin } from '../helpers/supabase-admin';

test.use({ storageState: storageStateFor('agencyOwner') });

test.describe('Sourcing LinkedIn', () => {
  let missionId: string;

  test.beforeEach(async () => {
    const g = role('agencyOwner');
    missionId = await seedMission(g.orgId, g.userId, { name: 'Mission Sourcing E2E' });
  });

  test.afterEach(async () => {
    await admin().from('sourcing_projects').delete().eq('id', missionId);
  });

  test('@smoke la mission de l\'agency owner s\'ouvre (auth+routing+RLS)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto(`/missions/${missionId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // Valeur du smoke : le storageState (login navigateur) marche, la route
    // protégée s'affiche pour le owner (RLS l'autorise) → PAS de bounce /auth,
    // et l'app a rendu (l'id de mission reste dans l'URL). Les locators fins du
    // workspace sont couverts par le test @critical fixme (à générer en live).
    await expect(page).not.toHaveURL(/\/auth\b/);
    await expect(page).toHaveURL(new RegExp(missionId));
    await expect(page.locator('#root')).not.toBeEmpty();

    // Pas de crash applicatif au chargement.
    expect(errors.filter((e) => /500|crash|unhandled|TypeError/i.test(e))).toEqual([]);
  });

  // eslint-disable-next-line playwright/no-skipped-test
  test.fixme('@critical recherche → résultats mockés → survie au tab switch (missionSearchCache)', async () => {
    // À GÉNÉRER via l'agent Playwright (planner→generator) contre le DOM live :
    // - locators réels du panneau de filtres et du bouton "Rechercher"
    // - pré-requis éventuel d'un compte LinkedIn connecté (à seeder)
    // - vérif des profils mockés (Alex Martin) puis tab switch outreach↔sourcing
    //   et restauration de l'état sans nouvelle recherche.
  });
});

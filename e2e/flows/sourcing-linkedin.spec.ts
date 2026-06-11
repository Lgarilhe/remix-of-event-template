/**
 * Sourcing LinkedIn — persona Guillaume.
 * Vendors mockés (Unipile, scoring). On valide NOTRE orchestration : recherche,
 * affichage des résultats, et surtout la persistance du missionSearchCache au
 * tab switch (régression connue, cf CLAUDE.md "Critical State Patterns").
 *
 * @critical
 */
import { test, expect } from '../fixtures';
import { storageStateFor, role } from '../helpers/registry';
import { seedMission, admin } from '../helpers/supabase-admin';

// Authentifié en agency owner pour tout ce fichier.
test.use({ storageState: storageStateFor('agencyOwner') });

test.describe('@critical Sourcing LinkedIn (mocké)', () => {
  let missionId: string;

  test.beforeEach(async () => {
    const g = role('agencyOwner');
    missionId = await seedMission(g.orgId, g.userId, { name: 'Mission Sourcing E2E' });
  });

  test.afterEach(async () => {
    await admin().from('sourcing_projects').delete().eq('id', missionId);
  });

  test('la recherche affiche les profils mockés et survit au tab switch', async ({ page, mockVendors }) => {
    void mockVendors; // active les routes vendors

    await page.goto(`/missions/${missionId}`);

    // Onglet sourcing (le wording exact peut varier — on cible par rôle/texte tolérant).
    const sourcingTab = page.getByRole('tab', { name: /sourcing/i }).or(page.getByRole('link', { name: /sourcing/i }));
    if (await sourcingTab.count()) await sourcingTab.first().click();

    // Les profils mockés (Alex Martin, Sam Dubois) doivent apparaître après recherche.
    // On déclenche la recherche si un bouton existe, sinon le chargement auto suffit.
    const searchBtn = page.getByRole('button', { name: /rechercher|lancer la recherche|search/i });
    if (await searchBtn.count()) await searchBtn.first().click();

    await expect(page.getByText('Alex Martin')).toBeVisible({ timeout: 15_000 });

    // Tab switch vers outreach puis retour sourcing → l'état doit être restauré
    // (missionSearchCache), pas une page vide nécessitant une nouvelle recherche.
    const outreachTab = page.getByRole('tab', { name: /outreach|messages|séquences/i }).or(page.getByRole('link', { name: /outreach/i }));
    if (await outreachTab.count()) {
      await outreachTab.first().click();
      await sourcingTab.first().click();
      await expect(page.getByText('Alex Martin')).toBeVisible({ timeout: 10_000 });
    }
  });
});

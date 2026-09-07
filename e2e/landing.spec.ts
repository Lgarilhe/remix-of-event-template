/**
 * Page d'accueil publique. Repères mis à jour après le passage sous la marque
 * Konekt : seul le nom du fichier de page a gardé l'ancien nom, ce qui avait
 * masqué le décalage. La spec ne porte pas de tag, elle ne tourne donc que
 * dans la suite nocturne.
 */
import { test, expect } from '@playwright/test';

test.describe('Landing page', () => {
  test('affiche le hero Konekt et ses deux appels à l\'action', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Konekt/i);

    const hero = page.getByRole('heading', { level: 1 }).first();
    await expect(hero).toContainText(/Le recrutement/i);

    await expect(page.getByRole('button', { name: /Réserver une démo/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Essai gratuit/i }).first()).toBeVisible();
  });
});

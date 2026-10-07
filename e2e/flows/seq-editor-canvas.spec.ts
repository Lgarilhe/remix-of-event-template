/**
 * Éditeur de séquences, vue « Visuel » : le panneau de réglages suit l'étape
 * choisie, au clavier comme à la souris.
 *
 * Deux défauts couverts, tous deux introduits puis corrigés pendant l'audit du
 * 25/09 : le panneau attendait la fin de l'animation de sortie de l'ancienne
 * étape (un clic rapide laissait affichés les réglages de la précédente), et
 * la sélection au clavier passait par onSelectionChange, relancé par la
 * sélection que pose l'éditeur lui-même, d'où une bascule sans fin entre deux
 * étapes. Le clavier passe désormais par Entrée ou Espace sur l'étape focalisée.
 *
 * Aucune edge function n'est appelée (comptes LinkedIn simulés par mockVendors).
 */
import { test as base, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { E2E, authStorageKey, pinLegacySequences } from '../helpers/env';
import { admin, seedMission, seedSequence, signIn } from '../helpers/supabase-admin';

interface Space { orgId: string; missionId: string; sequenceName: string }

const test = base.extend<{ space: Space }>({
  // Session du propriétaire de l'org jetable (même forme que global.setup.ts).
  storageState: async ({ org }, provide) => {
    const session = await signIn(org.owner.email, org.owner.password);
    await provide({
      cookies: [],
      origins: [{ origin: new URL(E2E.baseUrl).origin, localStorage: [{ name: authStorageKey(), value: JSON.stringify(session) }] }],
    });
  },
  // Offre payante, mission, séquence partagée de trois messages.
  space: async ({ org }, provide) => {
    const { error } = await admin()
      .from('organization_subscriptions')
      .upsert({ organization_id: org.orgId, plan_id: 'cabinet', status: 'active', seats: 10 }, { onConflict: 'organization_id' });
    if (error) throw new Error(`abonnement: ${error.message}`);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Mission Canevas E2E' });
    const { sequenceId } = await seedSequence(org.orgId, org.owner.userId, [
      { action_type: 'message' }, { action_type: 'message', delay_days: 2 }, { action_type: 'message', delay_days: 2 },
    ]);
    const { data } = await admin().from('outreach_sequences').select('name').eq('id', sequenceId).single();
    await provide({ orgId: org.orgId, missionId, sequenceName: data!.name as string });
  },
});

const canvasNode = (page: Page, order: number) =>
  page.locator('.react-flow__node').filter({ hasText: `Étape ${order}` }).first();

/** Texte du panneau de réglages (vue Visuel). */
const panelText = (page: Page) =>
  page.getByText("Réglages de l'étape", { exact: true }).locator('xpath=../..').innerText().catch(() => '');

const showsStep = (text: string, order: number) => new RegExp(`(^|\\n)Étape ${order}( ·|\\n|$)`).test(text);

async function openVisualEditor(page: Page, space: Space) {
  await page.goto(`/missions/${space.missionId}?tab=outreach`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: `Actions de la séquence ${space.sequenceName}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Modifier' }).click();
  await expect(page.getByRole('textbox', { name: 'Nom de la séquence *' })).toHaveValue(space.sequenceName);
  await page.getByRole('tab', { name: 'Visuel' }).click();
  await expect(canvasNode(page, 3)).toBeVisible();
}

// Lot 5h : ancienne interface des séquences, épinglée sur le secours (clé à « 0 ») jusqu'au lot 5j.
test.beforeEach(async ({ context }) => {
  await pinLegacySequences(context);
});

test.describe('Éditeur, vue Visuel : panneau de réglages', () => {
  test('Entrée ou Espace sur une étape focalisée affiche ses réglages, et le panneau reste sur elle', async ({ page, mockVendors, space }) => {
    await openVisualEditor(page, space);

    await canvasNode(page, 2).focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => showsStep(await panelText(page), 2), { timeout: 5_000 }).toBe(true);

    await canvasNode(page, 3).focus();
    await page.keyboard.press(' ');
    await expect.poll(async () => showsStep(await panelText(page), 3), { timeout: 5_000 }).toBe(true);

    // Pas de bascule : une seconde plus tard, toujours l'étape 3.
    await page.waitForTimeout(1_000);
    expect(showsStep(await panelText(page), 3)).toBe(true);
  });

  test('deux clics rapides sur deux étapes : le panneau affiche la dernière cliquée et s’y tient', async ({ page, mockVendors, space }) => {
    await openVisualEditor(page, space);

    await canvasNode(page, 1).click();
    await canvasNode(page, 2).click();
    await canvasNode(page, 3).click();
    await expect.poll(async () => showsStep(await panelText(page), 3), { timeout: 5_000 }).toBe(true);
    await page.waitForTimeout(1_000);
    expect(showsStep(await panelText(page), 3), 'le panneau ne revient pas sur une étape précédente').toBe(true);

    // Le réglage « Étape suivante » reste cliquable (il se recréait sans cesse).
    await page.getByText('Vers quelle étape aller après celle-ci').locator('xpath=preceding-sibling::*[@role="combobox"][1]').click({ timeout: 5_000 });
    await expect(page.getByRole('option').first()).toBeVisible();
  });
});

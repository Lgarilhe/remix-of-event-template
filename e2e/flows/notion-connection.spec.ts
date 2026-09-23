import { test, expect } from '../fixtures';

async function mockNotionStatus(
  page: import('@playwright/test').Page,
  connected: boolean,
) {
  await page.route('**/functions/v1/notion-mcp-oauth', async (route) => {
    const body = route.request().postDataJSON() as { action?: string };
    if (body.action !== 'status') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Unexpected action in test' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        can_manage: true,
        connection: connected ? {
          connected: true,
          needs_reauthorization: false,
          workspace_id: 'workspace_test',
          email_domain: 'konekt.fr',
          connected_at: '2026-07-16T10:00:00.000Z',
          expires_at: '2026-07-16T18:00:00.000Z',
          has_error: false,
        } : null,
      }),
    });
  });
}

// Paramètres, lot 2 : la carte Notion est dans Connexions (#notion) ; les
// serveurs MCP de l'organisation restent dans Règles de l’assistant (#connecteurs).
test('Notion is a one-click card in Connexions and technical MCP fields stay hidden', async ({ asRole }) => {
  const page = await asRole('agencyOwner');
  await mockNotionStatus(page, false);
  await page.goto('/settings/account/connections');

  const notion = page.locator('#notion');
  await expect(notion.getByRole('heading', { name: 'Notion', exact: true })).toBeVisible();
  await expect(notion.getByRole('button', { name: 'Connecter', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('URL du serveur MCP (https://…)')).toBeHidden();
});

test('MCP servers stay behind the developer options in Règles de l’assistant', async ({ asRole }) => {
  const page = await asRole('agencyOwner');
  await mockNotionStatus(page, false);
  await page.goto('/settings/org/assistant');

  await expect(page.getByPlaceholder('URL du serveur MCP (https://…)')).toBeHidden();
  const advanced = page.getByRole('button', { name: 'Options avancées pour développeurs', exact: true });
  await advanced.click();

  // Le formulaire de connecteur demande un second geste : le panneau déplié
  // n'affiche que la description et le bouton d'ajout. OrgContextCard a deux
  // autres boutons « Ajouter » : on cherche celui des connecteurs.
  await expect(page.getByPlaceholder('URL du serveur MCP (https://…)')).toBeHidden();
  await page.locator('#connecteurs').getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByPlaceholder('URL du serveur MCP (https://…)')).toBeVisible();
});

test('a connected Notion workspace is clearly available in the assistant', async ({ asRole }) => {
  const page = await asRole('agencyOwner');
  await mockNotionStatus(page, true);
  await page.goto('/settings/account/connections');

  // Connexions a d'autres boutons « Déconnecter » (LinkedIn, e-mail) : tout est cherché dans #notion.
  const notion = page.locator('#notion');
  await expect(notion.getByText('Disponible immédiatement dans le chat IA')).toBeVisible();
  await expect(notion.getByText('workspace @konekt.fr')).toBeVisible();
  await expect(notion.getByRole('button', { name: 'Modifier l’accès', exact: true })).toBeVisible();
  await expect(notion.getByRole('button', { name: 'Déconnecter', exact: true })).toBeVisible();
});

test('old OAuth return on ?tab=agent-actions lands on Connexions, message shown once', async ({ asRole }) => {
  const page = await asRole('agencyOwner');
  await mockNotionStatus(page, false);
  await page.goto('/settings?tab=agent-actions&notion_oauth=error&notion_error=access_denied');

  const message = page.getByText('Connexion Notion annulée. Aucun accès n’a été ajouté.', { exact: true });
  await expect(message.first()).toBeVisible();
  // Le lecteur de retour retire notion_* de l'adresse (et, avec setSearchParams, le hash).
  await expect(page).toHaveURL(/\/settings\/account\/connections(?:#notion)?$/);
  expect(page.url()).not.toMatch(/notion_(oauth|error)|[?&]tab=/);
  // Un lecteur monté deux fois afficherait un second message juste après le premier.
  await page.waitForTimeout(1_000);
  await expect(message).toHaveCount(1);
});

test('old digest link ?tab=agent-actions opens Règles de l’assistant at the morning summary', async ({ asRole }) => {
  const page = await asRole('agencyOwner');
  await page.goto('/settings?tab=agent-actions');
  await expect(page).toHaveURL(/\/settings\/org\/assistant#resume$/);
});

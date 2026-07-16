import { test, expect } from '../fixtures';

async function mockConnectedNotion(page: import('@playwright/test').Page) {
  await page.route('**/functions/v1/notion-mcp-oauth', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        can_manage: true,
        connection: {
          connected: true,
          needs_reauthorization: false,
          workspace_id: 'workspace_test',
          email_domain: 'konekt.fr',
          connected_at: '2026-07-16T10:00:00.000Z',
          expires_at: '2026-07-16T18:00:00.000Z',
          has_error: false,
        },
      }),
    });
  });
}

test('Notion can be paused and re-enabled from the chat composer', async ({ asRole }) => {
  const page = await asRole('agencyOwner');
  const connectorSelections: string[][] = [];
  await mockConnectedNotion(page);
  await page.route('**/functions/v1/search-agent-chat', async (route) => {
    const body = route.request().postDataJSON() as { enabled_connectors?: string[] };
    connectorSelections.push(body.enabled_connectors ?? []);
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"choices":[{"delta":{"content":"Réponse test"}}]}\n\ndata: {"done":true}\n\n',
    });
  });
  await page.goto('/dashboard');

  await page.getByRole('button', { name: "Ouvrir l'agent IA" }).click();
  const menuButton = page.getByRole('button', {
    name: /Ajouter un fichier ou gérer les connecteurs/,
  });
  await menuButton.click();

  const notionSwitch = page.getByRole('switch', {
    name: 'Utiliser Notion dans le chat',
  });
  await expect(notionSwitch).toBeChecked();
  await expect(page.getByText('Actif dans le chat')).toBeVisible();

  await notionSwitch.click();
  await expect(notionSwitch).not.toBeChecked();
  await expect(page.getByText('En pause')).toBeVisible();

  await menuButton.click();
  const composer = page.getByPlaceholder('Écris un message à Konekt IA…');
  await composer.fill('Réponds simplement test');
  await composer.press('Enter');
  await expect.poll(() => connectorSelections.length).toBe(1);
  expect(connectorSelections[0]).not.toContain('notion');

  await menuButton.click();
  await notionSwitch.click();
  await expect(notionSwitch).toBeChecked();
  await expect(page.getByText('Actif dans le chat')).toBeVisible();

  await menuButton.click();
  await composer.fill('Réponds encore test');
  await composer.press('Enter');
  await expect.poll(() => connectorSelections.length).toBe(2);
  expect(connectorSelections[1]).toContain('notion');
});

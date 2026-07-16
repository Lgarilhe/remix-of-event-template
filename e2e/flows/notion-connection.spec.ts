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

test('Notion is a one-click card and technical MCP fields stay hidden by default', async ({ asRole }) => {
  const page = await asRole('agencyOwner');
  await mockNotionStatus(page, false);
  await page.goto('/settings?tab=agent-actions');

  await expect(page.getByRole('heading', { name: 'Notion', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connecter', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('URL du serveur MCP (https://…)')).toBeHidden();

  const advanced = page.getByRole('button', { name: 'Options avancées pour développeurs', exact: true });
  await advanced.click();
  await expect(page.getByPlaceholder('URL du serveur MCP (https://…)')).toBeVisible();
});
test('a connected Notion workspace is clearly available in the assistant', async ({ asRole }) => {
  const page = await asRole('agencyOwner');
  await mockNotionStatus(page, true);
  await page.goto('/settings?tab=agent-actions');

  await expect(page.getByText('Disponible immédiatement dans le chat IA')).toBeVisible();
  await expect(page.getByText('workspace @konekt.fr')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Modifier l’accès', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Déconnecter', exact: true })).toBeVisible();
});

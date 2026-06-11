/**
 * Mocks réseau des vendors externes (déterminisme par défaut).
 * On intercepte les appels que le FRONT fait vers les edge functions Supabase
 * et on renvoie des payloads figés — on teste NOTRE logique d'affichage/état,
 * pas les serveurs Unipile/Apollo/Anthropic.
 *
 * Les tests d'intégration réels vivent dans la suite @live (non mockée).
 */
import { test as base, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Lecture runtime plutôt qu'import JSON : les import attributes ESM ("with
// { type: 'json' }") varient selon la version Node — readFileSync est portable.
const MOCKS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mocks');
const loadMock = (rel: string) => JSON.parse(fs.readFileSync(path.join(MOCKS_DIR, rel), 'utf8'));
const unipileSearch = loadMock('unipile/search.json');
const unipileProfile = loadMock('unipile/get_profile.json');

export interface NetworkFixtures {
  /** Active les mocks vendors sur la page courante. */
  mockVendors: void;
}

/** Intercepte les invocations d'edge functions `functions/v1/<name>`. */
async function routeEdgeFunction(
  page: Page,
  name: string,
  handler: (body: unknown) => unknown,
) {
  await page.route(`**/functions/v1/${name}`, async (route) => {
    let body: unknown = {};
    try {
      body = route.request().postDataJSON();
    } catch {
      /* pas de body JSON */
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(handler(body)),
    });
  });
}

export const test = base.extend<NetworkFixtures>({
  mockVendors: [
    async ({ page }, use) => {
      // unipile-search : route par `action` du body.
      await routeEdgeFunction(page, 'unipile-search', (body) => {
        const action = (body as { action?: string })?.action;
        if (action === 'get_profile') return unipileProfile;
        if (action === 'search') return unipileSearch;
        if (action === 'send_message') return { success: true, message_id: 'mock_msg_1' };
        return { success: true };
      });

      // Comptes LinkedIn : un compte OK pour que l'UI sourcing s'active.
      await routeEdgeFunction(page, 'unipile-accounts', () => ({
        success: true,
        accounts: [{ id: 'acc_mock', account_status: 'OK', provider: 'LINKEDIN', name: 'E2E LinkedIn' }],
      }));

      // Scoring IA : score déterministe, pas d'appel Anthropic réel.
      await routeEdgeFunction(page, 'score-profile-job', () => ({
        success: true,
        scores: [{ profile_id: 'p1', score: 82, reasoning: 'Mock fit' }],
      }));

      await use();
    },
    { auto: false },
  ],
});

export { expect } from '@playwright/test';

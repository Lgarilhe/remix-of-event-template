/**
 * `test` étendu de Konekt — compose toutes les fixtures.
 *
 * Fournit :
 *   - mockVendors  : mocks réseau vendors (depuis network.fixture)
 *   - org          : org jetable créée par test + cleanup auto en téardown
 *   - asRole(name) : ouvre une page authentifiée avec le storageState d'un rôle
 *
 * Importer depuis les specs : `import { test, expect } from '../fixtures';`
 */
import { test as networkTest } from './network.fixture';
import type { BrowserContext, Page } from '@playwright/test';
import {
  createOrg,
  deleteOrg,
  type OrgType,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import { storageStateFor, type RoleName } from '../helpers/registry';

interface KonektFixtures {
  /** Org jetable (agency par défaut) créée pour CE test, supprimée après. */
  org: TestOrg & { addExtraUser: (u: TestUser) => void };
  /** Ouvre une page authentifiée avec le storageState d'un rôle de référence. */
  asRole: (name: RoleName) => Promise<Page>;
}

export const test = networkTest.extend<KonektFixtures>({
  org: async ({}, use) => {
    const orgType = (process.env.E2E_ORG_TYPE as OrgType) || 'agency';
    const created = await createOrg(orgType, 'E2E Test');
    const extra: TestUser[] = [];
    await use(Object.assign(created, { addExtraUser: (u: TestUser) => extra.push(u) }));
    await deleteOrg(created, extra);
  },

  asRole: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    const open = async (name: RoleName): Promise<Page> => {
      const context = await browser.newContext({ storageState: storageStateFor(name) });
      contexts.push(context);
      return context.newPage();
    };
    await use(open);
    for (const c of contexts) await c.close();
  },
});

export { expect } from '@playwright/test';

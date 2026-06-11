/**
 * globalSetup — crée les 4 orgs/users de référence (alignés personas + featureGates)
 * et écrit un storageState par rôle dans e2e/.auth/.
 *
 * Les specs réutilisent ces états via `test.use({ storageState })` ou la fixture
 * `authedPage`. Les données de référence persistent pour la durée du run ;
 * les données propres à un test sont créées/détruites par la fixture `org`.
 */
import { test as setup } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { E2E, authStorageKey } from './helpers/env';
import { assertNotProduction } from './helpers/guard-prod';
import { createOrg, addMember, signIn, type TestOrg, type TestUser } from './helpers/supabase-admin';

const AUTH_DIR = path.join(__dirname, '.auth');
const REGISTRY = path.join(AUTH_DIR, 'registry.json');

interface RoleSeed {
  file: string;
  org: TestOrg;
  user: TestUser;
}

/** Écrit un storageState Playwright à partir d'une session Supabase. */
async function writeStorageState(file: string, user: TestUser) {
  const session = await signIn(user.email, user.password);
  const origin = new URL(E2E.baseUrl).origin;
  const value = JSON.stringify(session);
  const state = {
    cookies: [],
    origins: [
      {
        origin,
        localStorage: [{ name: authStorageKey(), value }],
      },
    ],
  };
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(path.join(AUTH_DIR, file), JSON.stringify(state, null, 2));
}

setup('provision test orgs + storageState', async () => {
  assertNotProduction(E2E.supabaseUrl, E2E.baseUrl);

  // 1. Agency owner (Guillaume) — accès /prospection.
  const agency = await createOrg('agency', 'E2E Agency');
  // 2. Enterprise admin (Claire).
  const enterprise = await createOrg('enterprise', 'E2E Enterprise');
  // 3. Freelance (Sophie).
  const freelance = await createOrg('freelance', 'E2E Freelance');
  // 4. Org B (Théo) — cible des tests cross-tenant.
  const orgB = await createOrg('agency', 'E2E OrgB');

  const roles: Record<string, RoleSeed> = {
    agencyOwner: { file: 'agency-owner.json', org: agency, user: agency.owner },
    enterpriseAdmin: { file: 'enterprise-admin.json', org: enterprise, user: enterprise.owner },
    freelance: { file: 'freelance.json', org: freelance, user: freelance.owner },
    orgBOwner: { file: 'org-b-owner.json', org: orgB, user: orgB.owner },
  };

  for (const r of Object.values(roles)) {
    await writeStorageState(r.file, r.user);
  }

  // Registre consommé par les specs pour connaître orgId/userId/email de chaque rôle.
  const registry = Object.fromEntries(
    Object.entries(roles).map(([k, r]) => [
      k,
      { file: r.file, orgId: r.org.orgId, userId: r.user.userId, email: r.user.email, password: r.user.password },
    ]),
  );
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify(registry, null, 2));
});

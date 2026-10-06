/**
 * Séquences — RLS des écritures depuis le navigateur.
 *
 * Régression de SEC-013 (audit 2026-09-01) : les deux `insert` du builder
 * (création et duplication) ne renseignaient pas `organization_id`, exigé par
 * la policy INSERT d'`outreach_sequences`. Résultat : plus aucune séquence
 * créée en production depuis le 2026-05-04, avec un toast « Séquence
 * enregistrée » trompeur par-dessus (BUG-045).
 *
 * Ces tests tapent PostgREST avec un vrai JWT utilisateur : ils valident la
 * policy, pas le composant. Ils tournent partout (aucune edge function requise).
 *
 * @critical
 */
import { test, expect, request } from '@playwright/test';
import { E2E } from '../helpers/env';
import { admin, createOrg, deleteOrg, signIn, type TestOrg } from '../helpers/supabase-admin';

let orgA: TestOrg;
let orgB: TestOrg;
let tokenA: string;
const createdSequenceIds: string[] = [];

test.beforeAll(async () => {
  orgA = await createOrg('agency', 'E2E Seq A');
  orgB = await createOrg('agency', 'E2E Seq B');
  tokenA = (await signIn(orgA.owner.email, orgA.owner.password)).access_token;
});

test.afterAll(async () => {
  if (createdSequenceIds.length > 0) {
    await admin().from('outreach_sequences').delete().in('id', createdSequenceIds);
  }
  await deleteOrg(orgA);
  await deleteOrg(orgB);
});

/** INSERT REST dans outreach_sequences avec le JWT d'un utilisateur. */
async function insertSequence(token: string, row: Record<string, unknown>) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${E2E.supabaseUrl}/rest/v1/outreach_sequences`, {
    headers: {
      apikey: E2E.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    data: row,
  });
  const status = res.status();
  const body = status < 300 ? ((await res.json()) as Array<{ id: string }>) : null;
  await ctx.dispose();
  if (body?.[0]?.id) createdSequenceIds.push(body[0].id);
  return { status, id: body?.[0]?.id };
}

test.describe('@critical Séquences — policy INSERT org-scopée', () => {
  test('sans organization_id, la création est refusée (le bug SEC-013)', async () => {
    const { status } = await insertSequence(tokenA, {
      name: 'Séquence sans org',
      created_by: orgA.owner.userId,
      is_active: false,
    });
    // PostgREST renvoie 403 (42501) sur violation de WITH CHECK.
    expect([401, 403], 'insert sans organization_id').toContain(status);
  });

  test('avec son organization_id, la création passe (le correctif)', async () => {
    const { status, id } = await insertSequence(tokenA, {
      name: 'Séquence org A',
      created_by: orgA.owner.userId,
      organization_id: orgA.orgId,
      is_active: false,
    });
    expect(status, 'insert avec organization_id').toBeLessThan(300);
    expect(id).toBeTruthy();
  });

  test("avec l'organization_id d'une autre org, la création est refusée", async () => {
    const { status } = await insertSequence(tokenA, {
      name: 'Séquence injectée chez B',
      created_by: orgA.owner.userId,
      organization_id: orgB.orgId,
      is_active: false,
    });
    expect([401, 403], 'insert cross-org').toContain(status);
  });

  test("les séquences d'une autre organisation restent invisibles", async () => {
    const { error } = await admin().from('outreach_sequences').insert({
      name: 'Séquence privée B',
      organization_id: orgB.orgId,
      created_by: orgB.owner.userId,
      is_active: false,
    });
    expect(error, 'seed séquence org B').toBeNull();

    const ctx = await request.newContext();
    const res = await ctx.get(
      `${E2E.supabaseUrl}/rest/v1/outreach_sequences?select=id,organization_id`,
      { headers: { apikey: E2E.anonKey, Authorization: `Bearer ${tokenA}` } },
    );
    const rows = (await res.json()) as Array<{ organization_id: string }>;
    await ctx.dispose();

    expect(res.status()).toBe(200);
    expect(rows.every((r) => r.organization_id === orgA.orgId), 'aucune ligne hors org A').toBe(true);
  });
});

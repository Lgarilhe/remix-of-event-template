/**
 * RLS / hardening SECURITY DEFINER — régression des PR #207/#208.
 *
 * Vérifie via l'API REST que les clés client (anon, authenticated) ne peuvent
 * PAS exécuter les fonctions internes révoquées, et que la surface
 * intentionnelle reste joignable.
 *
 * @critical
 */
import { test, expect, request } from '@playwright/test';
import { E2E } from '../helpers/env';
import { role } from '../helpers/registry';
import { signIn } from '../helpers/supabase-admin';

/** POST /rest/v1/rpc/<fn> avec un token donné. Renvoie le status HTTP. */
async function callRpc(token: string, apikey: string, fn: string, body: Record<string, unknown>) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${E2E.supabaseUrl}/rest/v1/rpc/${fn}`, {
    headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: body,
  });
  const status = res.status();
  await ctx.dispose();
  return status;
}

test.describe('@critical RLS — fonctions SECURITY DEFINER révoquées', () => {
  const REVOKED = [
    'deduct_ai_credits',
    'get_org_integration',
    'enqueue_email',
    'increment_enrichment_quota',
    'invoke_process_sequences',
  ];

  test('anon ne peut exécuter aucune fonction interne révoquée', async () => {
    for (const fn of REVOKED) {
      const status = await callRpc(E2E.anonKey, E2E.anonKey, fn, {});
      // 404 (fonction non exposée) ou 401/403 (perm refusée) — jamais 200.
      expect([401, 403, 404], `anon → ${fn}`).toContain(status);
    }
  });

  test('authenticated (org enterprise) ne peut exécuter aucune fonction interne révoquée', async () => {
    const r = role('enterpriseAdmin');
    const session = await signIn(r.email, r.password);
    for (const fn of REVOKED) {
      const status = await callRpc(session.access_token, E2E.anonKey, fn, {});
      expect([401, 403, 404], `authenticated → ${fn}`).toContain(status);
    }
  });

  test('get_vivier_contacts refuse une org enterprise (garde agency-only, #207)', async () => {
    const r = role('enterpriseAdmin');
    const session = await signIn(r.email, r.password);
    const status = await callRpc(session.access_token, E2E.anonKey, 'get_vivier_contacts', {
      p_limit: 10,
    });
    // Soit révoquée (404/403), soit exécutée mais RAISE 42501 → 4xx. Jamais 200.
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('helper RLS has_role reste joignable par authenticated (surface intentionnelle)', async () => {
    const r = role('enterpriseAdmin');
    const session = await signIn(r.email, r.password);
    const status = await callRpc(session.access_token, E2E.anonKey, 'has_role', {
      _user_id: r.userId,
      _role: 'admin',
    });
    // Doit s'exécuter (200) — pas révoqué.
    expect(status).toBe(200);
  });
});

/**
 * Quota gate LinkedIn unifié — régression du ledger (#a35cd65) + endorse (#211).
 *
 * On appelle directement la RPC check_linkedin_action_quota (service-role) et on
 * vérifie le comportement : comptage par type, cap journalier d'actions
 * visibles cumulant message/inmail/connection/endorse, log optimiste.
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
import { admin, createOrg, seedLinkedInAccount, deleteOrg, type TestOrg } from '../helpers/supabase-admin';

let org: TestOrg;
let accountId: string;

test.beforeEach(async () => {
  org = await createOrg('agency', 'E2E Quota');
  accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, undefined, 'OK');
});

test.afterEach(async () => {
  await admin().from('linkedin_action_log').delete().eq('account_id', accountId);
  await deleteOrg(org);
});

async function checkQuota(actionType: string, dailyCap: number, log: boolean) {
  const daySince = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const weekSince = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await admin().rpc('check_linkedin_action_quota', {
    p_account_id: accountId,
    p_action_type: actionType,
    p_day_since: daySince,
    p_week_since: weekSince,
    p_daily_visible_cap: dailyCap,
    p_user_id: org.owner.userId,
    p_organization_id: org.orgId,
    p_source: 'e2e',
    p_log: log,
  });
  if (error) throw new Error(`check_linkedin_action_quota: ${error.message}`);
  return data as { allowed: boolean; scope?: string; count?: number };
}

test.describe('@critical Quota gate LinkedIn', () => {
  test('le cap journalier d\'actions visibles bloque au seuil', async () => {
    const CAP = 3;
    // 3 envois autorisés (loggés), le 4e refusé.
    for (let i = 0; i < CAP; i++) {
      const r = await checkQuota('message', CAP, true);
      expect(r.allowed, `envoi ${i + 1}`).toBe(true);
    }
    const blocked = await checkQuota('message', CAP, true);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('daily_visible');
  });

  test('endorse compte dans le MÊME cap visible que message/inmail (#211)', async () => {
    const CAP = 2;
    // 1 message + 1 endorse → cap atteint, le 3e (peu importe le type) refusé.
    expect((await checkQuota('message', CAP, true)).allowed).toBe(true);
    expect((await checkQuota('endorse', CAP, true)).allowed).toBe(true);
    const blocked = await checkQuota('connection_request', CAP, true);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('daily_visible');
  });

  test('un check non-loggé (log=false) ne consomme pas de slot', async () => {
    const CAP = 1;
    // Dry-run répété : toujours autorisé tant qu'on ne logge pas.
    expect((await checkQuota('message', CAP, false)).allowed).toBe(true);
    expect((await checkQuota('message', CAP, false)).allowed).toBe(true);
    // Premier vrai envoi loggé OK, puis cap atteint.
    expect((await checkQuota('message', CAP, true)).allowed).toBe(true);
    expect((await checkQuota('message', CAP, true)).allowed).toBe(false);
  });

  test('un compte en pause fournisseur est bloqué', async () => {
    const pausedUntil = new Date(Date.now() + 3600 * 1000).toISOString();
    const { error: upErr } = await admin()
      .from('member_linkedin_accounts')
      .update({ quota_paused_until: pausedUntil })
      .eq('linkedin_account_id', accountId);
    expect(upErr, 'update quota_paused_until').toBeNull();
    // Vérifie que le flag est bien persisté (diagnostic : sinon le test pointe l'update, pas la fn).
    const { data: row } = await admin()
      .from('member_linkedin_accounts')
      .select('quota_paused_until')
      .eq('linkedin_account_id', accountId)
      .single();
    expect(row?.quota_paused_until, 'flag pause persisté').toBeTruthy();
    const r = await checkQuota('message', 100, false);
    expect(r.allowed).toBe(false);
    expect(r.scope).toBe('provider_pause');
  });
});

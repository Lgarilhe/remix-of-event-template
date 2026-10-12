/**
 * Ce que le membre apprend quand son compte LinkedIn change d'état (constat F12 de la visite du 12/10/2026),
 * contre la stack locale (e2e/local-stack) : unipile-webhook joué pour de vrai, base réelle.
 *
 * - account.locked : statut LOCKED et UNE notification « Compte LinkedIn restreint » (envois en pause, rien à
 *   reconnecter), pas une seconde pour le même événement rejoué ni pour le même état ;
 * - un nouveau verrouillage après un déverrouillage est un nouveau passage : une nouvelle notification ;
 * - account.status.degraded et partial : état de carte seulement, aucune notification ;
 * - account.status.running avec is_locked : même notification que account.locked ;
 * - account.status.errored : « Problème de connexion LinkedIn », pas « n'est plus connecté » ;
 *   account.status.disconnected garde « Compte LinkedIn déconnecté ».
 * Le bandeau et la ligne d'À traiter lisent le statut enregistré : retour à OK, ils disparaissent.
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
import { admin, createOrg, deleteOrg, seedLinkedInAccount, type TestOrg } from '../helpers/supabase-admin';
import { ENGINE_SKIP_REASON, engineAvailable, rand, v2, webhook } from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(120_000);

const cleanups: Array<() => Promise<unknown>> = [];
test.afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!().catch(() => undefined);
});

interface Scene { org: TestOrg; userId: string; accountId: string }

async function scene(status: 'OK' | 'CREDENTIALS' = 'OK'): Promise<Scene> {
  const org = await createOrg('agency', 'E2E etat compte');
  cleanups.push(() => deleteOrg(org));
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_st${rand()}`, status);
  return { org, userId: org.owner.userId, accountId };
}

const statusOf = async (s: Scene): Promise<string | null> => {
  const { data, error } = await admin().from('member_linkedin_accounts').select('account_status').eq('linkedin_account_id', s.accountId).single();
  if (error) throw new Error(error.message);
  return (data as { account_status: string | null }).account_status;
};
const setStatus = async (s: Scene, status: string | null) => {
  const { error } = await admin().from('member_linkedin_accounts').update({ account_status: status }).eq('linkedin_account_id', s.accountId);
  if (error) throw new Error(error.message);
};

interface Notice { id: string; type: string; title: string; body: string; link: string; organization_id: string; metadata: Record<string, unknown> | null }
const noticesOf = async (s: Scene): Promise<Notice[]> => {
  const { data, error } = await admin().from('notifications').select('id, type, title, body, link, organization_id, metadata')
    .eq('user_id', s.userId).eq('type', 'linkedin_disconnected').order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as Notice[];
};

const lockedEvent = (accountId: string) => v2.envelope('account.status.running', accountId, {
  object: 'Account', id: accountId, status: 'running', is_locked: true, provider: 'linkedin',
});

test.describe('compte LinkedIn : ce que dit l\'application quand l\'état change', () => {
  test('@critical account.locked : LOCKED et une seule notification, rejeu et répétition sans effet, retour à OK sans notification', async () => {
    const s = await scene();
    const event = v2.accountLocked(s.accountId);
    await webhook(event);
    expect(await statusOf(s)).toBe('LOCKED');
    let notices = await noticesOf(s);
    expect(notices).toHaveLength(1);
    const n = notices[0];
    expect(n.title).toBe('Compte LinkedIn restreint');
    expect(n.organization_id).toBe(s.org.orgId);
    expect(n.body).toContain('restreint par LinkedIn');
    expect(n.body).toContain('en pause');
    expect(n.body).toMatch(/Patientez/);
    expect(n.body).not.toMatch(/Reconnectez/);
    expect(n.body).not.toMatch(/unipile/i);
    expect(n.metadata).toMatchObject({ linkedin_account_id: s.accountId, account_status: 'LOCKED' });

    // Même événement rejoué (même evt_) : dédoublonné.
    expect(await webhook(event)).toMatchObject({ deduplicated: true });
    expect(await noticesOf(s)).toHaveLength(1);
    // Même état, autre événement : le compte est déjà LOCKED, personne n'est prévenu une seconde fois.
    await webhook(v2.accountLocked(s.accountId));
    await webhook(lockedEvent(s.accountId));
    expect(await statusOf(s)).toBe('LOCKED');
    expect(await noticesOf(s)).toHaveLength(1);

    // Déverrouillage : le bandeau et la ligne disparaissent (statut OK), aucune notification.
    await webhook(v2.accountUnlocked(s.accountId));
    expect(await statusOf(s)).toBe('OK');
    expect(await noticesOf(s)).toHaveLength(1);

    // Un nouveau verrouillage est un nouveau passage.
    await webhook(v2.accountLocked(s.accountId));
    expect(await statusOf(s)).toBe('LOCKED');
    notices = await noticesOf(s);
    expect(notices).toHaveLength(2);
    expect(notices.every((x) => x.title === 'Compte LinkedIn restreint')).toBe(true);
  });

  test('account.status.running avec is_locked : LOCKED et la même notification, une fois', async () => {
    const s = await scene();
    await webhook(lockedEvent(s.accountId));
    expect(await statusOf(s)).toBe('LOCKED');
    expect(await noticesOf(s)).toHaveLength(1);
    await webhook(lockedEvent(s.accountId));
    expect(await noticesOf(s)).toHaveLength(1);
    await webhook(v2.accountStatus(s.accountId, 'running'));
    expect(await statusOf(s)).toBe('OK');
    expect(await noticesOf(s)).toHaveLength(1);
  });

  test('account.locked sur un compte sans statut : prévenu une fois', async () => {
    const s = await scene();
    await setStatus(s, null);
    await webhook(v2.accountLocked(s.accountId));
    expect(await statusOf(s)).toBe('LOCKED');
    expect(await noticesOf(s)).toHaveLength(1);
  });

  test('account.locked sur un compte déjà à reconnecter, limité ou partiel : statut gardé, personne n\'est prévenu', async () => {
    for (const previous of ['CREDENTIALS', 'ERROR', 'DEGRADED', 'PARTIAL']) {
      const s = await scene();
      await setStatus(s, previous);
      await webhook(v2.accountLocked(s.accountId));
      expect(await statusOf(s), previous).toBe(previous);
      expect(await noticesOf(s), previous).toHaveLength(0);
    }
  });

  test('account.status.degraded et partial : état de carte seulement, aucune notification, retour à OK sans bruit', async () => {
    const s = await scene();
    await webhook(v2.accountStatus(s.accountId, 'degraded'));
    expect(await statusOf(s)).toBe('DEGRADED');
    await webhook(v2.accountStatus(s.accountId, 'partial'));
    expect(await statusOf(s)).toBe('PARTIAL');
    expect(await noticesOf(s)).toHaveLength(0);
    await webhook(v2.accountStatus(s.accountId, 'running'));
    expect(await statusOf(s)).toBe('OK');
    expect(await noticesOf(s)).toHaveLength(0);
  });

  test('account.status.errored : problème de connexion, pas « plus connecté » ; une panne déjà signalée ne prévient pas deux fois', async () => {
    const s = await scene();
    const event = v2.accountStatus(s.accountId, 'errored');
    await webhook(event);
    expect(await statusOf(s)).toBe('ERROR');
    let notices = await noticesOf(s);
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe('Problème de connexion LinkedIn');
    expect(notices[0].body).toContain('problème de connexion');
    expect(notices[0].body).not.toMatch(/n'est plus connecté/);
    expect(notices[0].body).toMatch(/Reconnectez-le/);

    await webhook(event);
    await webhook(v2.accountStatus(s.accountId, 'errored'));
    await webhook(v2.accountStatus(s.accountId, 'disconnected'));
    expect(await statusOf(s)).toBe('CREDENTIALS');
    notices = await noticesOf(s);
    expect(notices, 'rejeu, répétition et passage d\'ERROR à CREDENTIALS : déjà signalé').toHaveLength(1);
  });

  test('account.status.disconnected : « Compte LinkedIn déconnecté », « plus connecté », reconnecter', async () => {
    const s = await scene();
    await webhook(v2.accountStatus(s.accountId, 'disconnected'));
    expect(await statusOf(s)).toBe('CREDENTIALS');
    const notices = await noticesOf(s);
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe('Compte LinkedIn déconnecté');
    expect(notices[0].body).toContain('n\'est plus connecté');
    expect(notices[0].body).toMatch(/Reconnectez-le/);
  });
});

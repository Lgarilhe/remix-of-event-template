/**
 * Ce que le membre apprend quand son compte LinkedIn change d'état (constat F12 de la visite du 12/10/2026),
 * contre la stack locale (e2e/local-stack) : unipile-webhook joué pour de vrai, base réelle.
 *
 * - account.locked : statut LOCKED et UNE notification « Compte LinkedIn restreint » (envois en pause, rien à
 *   reconnecter), pas une seconde pour le même événement rejoué ni pour le même état ;
 * - un nouveau verrouillage après un déverrouillage est un nouveau passage : une nouvelle notification ;
 * - account.status.running avec is_locked : même résultat que account.locked depuis le même statut enregistré
 *   (LOCKED remplace OK, DEGRADED, PARTIAL, l'absence de statut ; jamais CREDENTIALS ni ERROR) ;
 * - le passage est atomique : des livraisons simultanées d'événements distincts ne préviennent qu'une fois ;
 * - account.status.partial : PARTIAL et UNE notification « Connexion LinkedIn partielle » (phrase de la carte de
 *   connexion), une fois par passage, rejeu et répétition sans effet ;
 * - account.status.degraded : état de carte seulement, aucune notification ;
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

  test('account.locked et account.status.running avec is_locked : même résultat depuis le même statut enregistré', async () => {
    // LOCKED remplace OK, DEGRADED, PARTIAL et l'absence de statut (et prévient une fois) ; il ne remplace jamais
    // une panne à reconnecter (CREDENTIALS, ERROR : la liaison garde son statut et sa notification).
    const outcomes: Array<[string | null, string, number]> = [
      ['OK', 'LOCKED', 1], [null, 'LOCKED', 1], ['DEGRADED', 'LOCKED', 1], ['PARTIAL', 'LOCKED', 1],
      ['LOCKED', 'LOCKED', 0], ['CREDENTIALS', 'CREDENTIALS', 0], ['ERROR', 'ERROR', 0],
    ];
    const events: Array<[string, (accountId: string) => ReturnType<typeof v2.accountLocked>]> = [
      ['account.locked', v2.accountLocked],
      ['account.status.running + is_locked', lockedEvent],
    ];
    const s = await scene();
    for (const [name, make] of events) {
      for (const [previous, finalStatus, notified] of outcomes) {
        await setStatus(s, previous);
        const before = (await noticesOf(s)).length;
        await webhook(make(s.accountId));
        expect(await statusOf(s), `${name} depuis ${previous}`).toBe(finalStatus);
        const after = await noticesOf(s);
        expect(after.length - before, `${name} depuis ${previous}`).toBe(notified);
        if (notified) {
          expect(after[after.length - 1].title).toBe('Compte LinkedIn restreint');
          expect(after[after.length - 1].metadata).toMatchObject({ linkedin_account_id: s.accountId, account_status: 'LOCKED' });
        }
      }
    }
  });

  test('@critical verrouillage : des livraisons simultanées d\'événements distincts ne préviennent qu\'une seule fois', async () => {
    // Le fournisseur peut émettre account.locked et account.status.* du même passage à quelques millisecondes.
    // Lecture puis écriture du statut d'avant : chaque livraison lisait OK et prévenait. L'écriture est maintenant
    // conditionnelle au statut d'avant et rend ses lignes : une seule livraison change la ligne.
    for (const [round, count] of [[0, 8], [1, 12]] as const) {
      const s = await scene();
      const events = Array.from({ length: count }, (_, i) => ((i + round) % 2 === 0 ? v2.accountLocked(s.accountId) : lockedEvent(s.accountId)));
      expect(new Set(events.map((e) => e.id)).size, 'chaque livraison a son evt_').toBe(count);
      await Promise.all(events.map((event) => webhook(event)));
      expect(await statusOf(s)).toBe('LOCKED');
      const notices = await noticesOf(s);
      expect(notices, `${count} livraisons simultanées`).toHaveLength(1);
      expect(notices[0].title).toBe('Compte LinkedIn restreint');
      // Un rejeu du même evt_ en parallèle d'une autre livraison reste ignoré.
      await Promise.all([webhook(events[0]), webhook(events[1]), webhook(v2.accountLocked(s.accountId))]);
      expect(await noticesOf(s)).toHaveLength(1);
    }
  });

  test('@critical account.status.partial : PARTIAL et une seule notification « Connexion LinkedIn partielle », rejeu et répétition sans effet', async () => {
    const s = await scene();
    const event = v2.accountStatus(s.accountId, 'partial');
    await webhook(event);
    expect(await statusOf(s)).toBe('PARTIAL');
    let notices = await noticesOf(s);
    expect(notices).toHaveLength(1);
    const n = notices[0];
    expect(n.title).toBe('Connexion LinkedIn partielle');
    expect(n.body).toBe('Une partie de la connexion LinkedIn demande une nouvelle authentification. Reconnectez le compte pour reprendre les envois.');
    expect(n.link).toBe('/settings?tab=account');
    expect(n.organization_id).toBe(s.org.orgId);
    expect(n.metadata).toEqual({ linkedin_account_id: s.accountId, account_status: 'PARTIAL' });
    expect(n.body).not.toMatch(/unipile/i);

    // Même événement rejoué : dédoublonné. Même état, autre événement : déjà annoncé.
    expect(await webhook(event)).toMatchObject({ deduplicated: true });
    await webhook(v2.accountStatus(s.accountId, 'partial'));
    expect(await noticesOf(s)).toHaveLength(1);

    // Retour à OK sans bruit, puis un nouveau passage en PARTIAL est annoncé.
    await webhook(v2.accountStatus(s.accountId, 'running'));
    expect(await statusOf(s)).toBe('OK');
    expect(await noticesOf(s)).toHaveLength(1);
    await webhook(v2.accountStatus(s.accountId, 'partial'));
    notices = await noticesOf(s);
    expect(notices).toHaveLength(2);
    expect(notices.every((x) => x.title === 'Connexion LinkedIn partielle')).toBe(true);
  });

  test('account.status.partial : livraisons simultanées, une seule notification ; depuis une panne à reconnecter, statut PARTIAL sans nouvelle notification', async () => {
    const s = await scene();
    await Promise.all(Array.from({ length: 10 }, () => webhook(v2.accountStatus(s.accountId, 'partial'))));
    expect(await statusOf(s)).toBe('PARTIAL');
    expect(await noticesOf(s)).toHaveLength(1);

    for (const previous of ['CREDENTIALS', 'ERROR']) {
      const r = await scene();
      await setStatus(r, previous);
      await webhook(v2.accountStatus(r.accountId, 'partial'));
      expect(await statusOf(r), previous).toBe('PARTIAL');
      expect(await noticesOf(r), `${previous} : déjà signalé`).toHaveLength(0);
    }
    // Un compte verrouillé qui passe PARTIAL (le verrou est levé, une authentification manque) est annoncé.
    const l = await scene();
    await webhook(v2.accountLocked(l.accountId));
    await webhook(v2.accountStatus(l.accountId, 'partial'));
    expect(await statusOf(l)).toBe('PARTIAL');
    const notices = await noticesOf(l);
    expect(notices.map((x) => x.title)).toEqual(['Compte LinkedIn restreint', 'Connexion LinkedIn partielle']);
  });

  test('account.status.degraded : état de carte seulement, aucune notification, retour à OK sans bruit', async () => {
    const s = await scene();
    await webhook(v2.accountStatus(s.accountId, 'degraded'));
    expect(await statusOf(s)).toBe('DEGRADED');
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

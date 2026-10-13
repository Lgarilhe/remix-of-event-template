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
 *   account.status.disconnected garde « Compte LinkedIn déconnecté » ;
 * - account.unlocked : l'état est relu chez le prestataire et c'est lui qui est écrit (PARTIAL avant le verrou, il
 *   reste PARTIAL ; running, OK ; relecture impossible, OK comme avant) ; un account.status.* qui ne dit pas si le
 *   verrou est levé fait de même sur une liaison LOCKED ;
 * - account.reconnect sans tentative de connexion : mêmes règles que account.status.* ;
 * - des livraisons simultanées (evt_ distincts, 8 et 24, par genre puis mêlées) laissent le statut ET les
 *   notifications d'un ordre série quelconque des mêmes événements : jamais un événement recouvert, perdu ou
 *   annoncé deux fois.
 * Le bandeau et la ligne d'À traiter lisent le statut enregistré : retour à OK, ils disparaissent.
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
import { admin, createOrg, deleteOrg, seedLinkedInAccount, type TestOrg } from '../helpers/supabase-admin';
import { ENGINE_SKIP_REASON, engineAvailable, rand, setMockMode, v2, webhook } from '../helpers/sequence-engine';

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

const clearNotices = async (s: Scene) => {
  const { error } = await admin().from('notifications').delete().eq('user_id', s.userId).eq('type', 'linkedin_disconnected');
  if (error) throw new Error(error.message);
};
const titlesOf = async (s: Scene) => (await noticesOf(s)).map((n) => n.title);

const lockedEvent = (accountId: string) => v2.envelope('account.status.running', accountId, {
  object: 'Account', id: accountId, status: 'running', is_locked: true, provider: 'linkedin',
});
const runningUnlockedEvent = (accountId: string) => v2.envelope('account.status.running', accountId, {
  object: 'Account', id: accountId, status: 'running', is_locked: false, provider: 'linkedin',
});

const RESTREINT = 'Compte LinkedIn restreint', PARTIEL = 'Connexion LinkedIn partielle';
const DECONNECTE = 'Compte LinkedIn déconnecté', PROBLEME = 'Problème de connexion LinkedIn';

// ─── Modèle des ordres séries (écrit à la lettre des règles, pas à partir du code) ───────────────────────────
// `provider` : l'état que le prestataire rapporte à la relecture (constant pendant un essai).

type Kind = 'lock' | 'unlock' | 'running' | 'degraded' | 'partial' | 'disconnected' | 'errored';
type Told = 'locked' | 'partial' | 'disconnected' | 'error';
const BROKEN = ['CREDENTIALS', 'ERROR', 'PERMISSIONS', 'DELETED', 'DISCONNECTED'];
const TITLE_OF: Record<Told, string> = { locked: RESTREINT, partial: PARTIEL, disconnected: DECONNECTE, error: PROBLEME };

function modelApply(status: string, kind: Kind, provider: string): [string, Told | null] {
  const told = (to: string, from: string): Told | null => {
    if (to === 'PARTIAL') return BROKEN.includes(from) || from === 'PARTIAL' ? null : 'partial';
    if (to === 'CREDENTIALS') return BROKEN.includes(from) ? null : 'disconnected';
    if (to === 'ERROR') return BROKEN.includes(from) ? null : 'error';
    return null;
  };
  const afterLock = (): [string, Told | null] => (provider === 'LOCKED' ? [status, null] : [provider, told(provider, 'LOCKED')]);
  switch (kind) {
    case 'lock': return BROKEN.includes(status) || status === 'LOCKED' ? [status, null] : ['LOCKED', 'locked'];
    case 'unlock': return status === 'LOCKED' ? afterLock() : [status, null];
    case 'running': case 'degraded': case 'partial': {
      if (status === 'LOCKED') return afterLock();
      const to = kind === 'running' ? 'OK' : kind === 'degraded' ? 'DEGRADED' : 'PARTIAL';
      return [to, told(to, status)];
    }
    case 'disconnected': return ['CREDENTIALS', told('CREDENTIALS', status)];
    case 'errored': return ['ERROR', told('ERROR', status)];
  }
}

/** Tous les couples (statut final, notifications triées) que donne un ordre série quelconque de `kinds`. */
function serialOutcomes(initial: string, kinds: Kind[], provider: string): Set<string> {
  const names = [...new Set(kinds)];
  const counts = names.map((name) => kinds.filter((kind) => kind === name).length);
  const memo = new Map<string, Set<string>>();
  const walk = (status: string, left: number[]): Set<string> => {
    const key = `${status}|${left.join(',')}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const result = new Set<string>();
    if (left.every((count) => count === 0)) result.add(`${status}|`);
    names.forEach((kind, index) => {
      if (left[index] === 0) return;
      const rest = left.slice();
      rest[index]--;
      const [next, notice] = modelApply(status, kind, provider);
      for (const tail of walk(next, rest)) {
        const cut = tail.indexOf('|');
        const told = tail.slice(cut + 1).split(',').filter(Boolean);
        result.add(`${tail.slice(0, cut)}|${(notice ? [notice, ...told] : told).sort().join(',')}`);
      }
    });
    memo.set(key, result);
    return result;
  };
  return walk(initial, counts);
}

function eventOfKind(accountId: string, kind: Kind, index: number) {
  switch (kind) {
    case 'lock': return index % 2 === 0 ? v2.accountLocked(accountId) : lockedEvent(accountId);
    case 'unlock': return v2.accountUnlocked(accountId);
    case 'running': return runningUnlockedEvent(accountId);
    case 'degraded': return v2.accountStatus(accountId, 'degraded');
    case 'partial': return v2.accountStatus(accountId, 'partial');
    case 'disconnected': return v2.accountStatus(accountId, 'disconnected');
    case 'errored': return v2.accountStatus(accountId, 'errored');
  }
}

/** Générateur pseudo-aléatoire à graine (mulberry32) : les essais se rejouent. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Livre `kinds` en même temps (evt_ distincts) sur la liaison mise à `initial`, et rend le statut final et les notifications. */
async function deliverTogether(s: Scene, initial: string | null, kinds: Kind[], provider: { status: string; locked: boolean }) {
  await setStatus(s, initial);
  await clearNotices(s);
  await setMockMode(s.accountId, { status: provider.status, locked: provider.locked });
  const events = kinds.map((kind, index) => eventOfKind(s.accountId, kind, index));
  expect(new Set(events.map((e) => e.id)).size, 'chaque livraison a son evt_').toBe(kinds.length);
  await Promise.all(events.map((event) => webhook(event)));
  const titles = await titlesOf(s);
  const told = (Object.keys(TITLE_OF) as Told[]).flatMap((notice) => titles.filter((t) => t === TITLE_OF[notice]).map(() => notice)).sort();
  return { status: await statusOf(s), told };
}

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
    // Un compte verrouillé qui passe PARTIAL (le verrou est levé, une authentification manque) est annoncé : la
    // liaison LOCKED prend l'état que le prestataire rapporte (relu), ici partial sans verrou.
    const l = await scene();
    await setMockMode(l.accountId, { status: 'partial', locked: false });
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

  // ─── Déverrouillage : l'état d'avant le verrou n'est pas perdu ───────────────────────────────────────────────

  test('@critical account.unlocked : PARTIAL puis verrou puis déverrouillage reste PARTIAL quand le prestataire le dit, OK s\'il dit running ou si la relecture échoue', async () => {
    const s = await scene();
    const cases: Array<[string, Record<string, unknown>, string, string[]]> = [
      ['partial', { status: 'partial', locked: false }, 'PARTIAL', [RESTREINT, PARTIEL]],
      ['running', { status: 'running', locked: false }, 'OK', [RESTREINT]],
      ['degraded', { status: 'degraded', locked: false }, 'DEGRADED', [RESTREINT]],
      ['disconnected', { status: 'disconnected', locked: false }, 'CREDENTIALS', [RESTREINT, DECONNECTE]],
      ['errored', { status: 'errored', locked: false }, 'ERROR', [RESTREINT, PROBLEME]],
      // Relecture impossible (compte introuvable chez le prestataire) : OK, comme avant la relecture.
      ['compte introuvable', { missing: true }, 'OK', [RESTREINT]],
      // Encore verrouillé chez le prestataire (événement en retard) : rien ne change.
      ['encore verrouillé', { status: 'running', locked: true }, 'LOCKED', [RESTREINT]],
    ];
    for (const [name, mode, finalStatus, titles] of cases) {
      await setStatus(s, 'PARTIAL');
      await clearNotices(s);
      await setMockMode(s.accountId, mode);
      await webhook(v2.accountLocked(s.accountId));
      expect(await statusOf(s), `${name} : verrouillé`).toBe('LOCKED');
      await webhook(v2.accountUnlocked(s.accountId));
      expect(await statusOf(s), `${name} : après le déverrouillage`).toBe(finalStatus);
      expect(await titlesOf(s), `${name} : notifications`).toEqual(titles);
      // Un autre déverrouillage ne change plus rien et ne prévient pas de nouveau.
      await webhook(v2.accountUnlocked(s.accountId));
      expect(await statusOf(s), `${name} : second déverrouillage`).toBe(finalStatus);
      expect(await titlesOf(s), `${name} : second déverrouillage, notifications`).toEqual(titles);
    }
  });

  test('account.unlocked : le retour en PARTIAL prévient une fois même sur des livraisons simultanées', async () => {
    const s = await scene();
    await setStatus(s, 'LOCKED');
    await setMockMode(s.accountId, { status: 'partial', locked: false });
    await Promise.all(Array.from({ length: 8 }, () => webhook(v2.accountUnlocked(s.accountId))));
    expect(await statusOf(s)).toBe('PARTIAL');
    expect(await titlesOf(s)).toEqual([PARTIEL]);
  });

  test('account.status.* sans verrou sur une liaison LOCKED : l\'état est relu chez le prestataire', async () => {
    const s = await scene();
    const cases: Array<[Kind, { status: string; locked: boolean }, string, string[]]> = [
      ['running', { status: 'running', locked: false }, 'OK', []],
      ['running', { status: 'running', locked: true }, 'LOCKED', []],
      ['running', { status: 'partial', locked: false }, 'PARTIAL', [PARTIEL]],
      ['degraded', { status: 'partial', locked: false }, 'PARTIAL', [PARTIEL]],
      ['partial', { status: 'partial', locked: false }, 'PARTIAL', [PARTIEL]],
      ['partial', { status: 'partial', locked: true }, 'LOCKED', []],
      ['partial', { status: 'running', locked: false }, 'OK', []],
    ];
    for (const [kind, provider, finalStatus, titles] of cases) {
      await setStatus(s, 'LOCKED');
      await clearNotices(s);
      await setMockMode(s.accountId, provider);
      await webhook(eventOfKind(s.accountId, kind, 1));
      const label = `${kind} sur LOCKED, prestataire ${provider.status}${provider.locked ? ' + verrou' : ''}`;
      expect(await statusOf(s), label).toBe(finalStatus);
      expect(await titlesOf(s), label).toEqual(titles);
    }
    // Une panne à reconnecter l'emporte sur le verrou sans relecture.
    for (const [kind, finalStatus] of [['disconnected', 'CREDENTIALS'], ['errored', 'ERROR']] as const) {
      await setStatus(s, 'LOCKED');
      await setMockMode(s.accountId, { status: 'running', locked: true });
      await webhook(eventOfKind(s.accountId, kind, 1));
      expect(await statusOf(s), kind).toBe(finalStatus);
    }
  });

  // ─── account.reconnect sans tentative de connexion : mêmes règles que account.status.* ───────────────────────

  test('account.reconnect sans tentative : LOCKED ne remplace jamais CREDENTIALS ni ERROR, PARTIAL et LOCKED préviennent une fois', async () => {
    const s = await scene();
    const reconnect = (payload: Record<string, unknown>) =>
      v2.envelope('account.reconnect', s.accountId, { object: 'Account', id: s.accountId, provider: 'linkedin', ...payload });
    // [statut enregistré, charge, statut final, notifications]
    const cases: Array<[string | null, Record<string, unknown>, string, string[]]> = [
      ['OK', { status: 'running', is_locked: true }, 'LOCKED', [RESTREINT]],
      [null, { status: 'running', is_locked: true }, 'LOCKED', [RESTREINT]],
      ['PARTIAL', { status: 'running', is_locked: true }, 'LOCKED', [RESTREINT]],
      ['LOCKED', { status: 'running', is_locked: true }, 'LOCKED', []],
      ['CREDENTIALS', { status: 'running', is_locked: true }, 'CREDENTIALS', []],
      ['ERROR', { status: 'running', is_locked: true }, 'ERROR', []],
      ['OK', { status: 'partial' }, 'PARTIAL', [PARTIEL]],
      ['PARTIAL', { status: 'partial' }, 'PARTIAL', []],
      ['CREDENTIALS', { status: 'partial' }, 'PARTIAL', []],
      ['OK', { status: 'errored' }, 'ERROR', [PROBLEME]],
      ['OK', { status: 'disconnected' }, 'CREDENTIALS', [DECONNECTE]],
      ['CREDENTIALS', { status: 'running', is_locked: false }, 'OK', []],
    ];
    for (const [previous, payload, finalStatus, titles] of cases) {
      await setStatus(s, previous);
      await clearNotices(s);
      const label = `${previous ?? 'sans statut'} + ${JSON.stringify(payload)}`;
      await webhook(reconnect(payload));
      expect(await statusOf(s), label).toBe(finalStatus);
      expect(await titlesOf(s), label).toEqual(titles);
    }
    // Rejeu, répétition et livraisons simultanées : une seule notification.
    await setStatus(s, 'OK');
    await clearNotices(s);
    const event = reconnect({ status: 'partial' });
    await webhook(event);
    expect(await webhook(event)).toMatchObject({ deduplicated: true });
    await Promise.all(Array.from({ length: 8 }, () => webhook(reconnect({ status: 'partial' }))));
    expect(await titlesOf(s)).toEqual([PARTIEL]);
    await setStatus(s, 'OK');
    await clearNotices(s);
    await Promise.all(Array.from({ length: 8 }, () => webhook(reconnect({ status: 'running', is_locked: true }))));
    expect(await statusOf(s)).toBe('LOCKED');
    expect(await titlesOf(s)).toEqual([RESTREINT]);
  });

  // ─── Livraisons simultanées : l'équivalent d'un ordre série ──────────────────────────────────────────────────

  test('@critical livraisons simultanées d\'un même genre (evt_ distincts, 8 et 24) : une seule notification, statut final celui de l\'événement', async () => {
    const s = await scene();
    for (const kind of ['lock', 'partial', 'disconnected', 'errored'] as const) {
      for (const count of [8, 24]) {
        const { status, told } = await deliverTogether(s, 'OK', Array(count).fill(kind), { status: 'running', locked: false });
        const [finalStatus, notice] = modelApply('OK', kind, 'OK');
        expect(status, `${count} × ${kind}`).toBe(finalStatus);
        expect(told, `${count} × ${kind} : une notification`).toEqual(notice ? [notice] : []);
      }
    }
  });

  test('@critical le même evt_ livré en même temps (disconnected, errored, partial, locked) n\'est traité qu\'une fois', async () => {
    const s = await scene();
    for (const [make, title] of [
      [() => v2.accountStatus(s.accountId, 'disconnected'), DECONNECTE],
      [() => v2.accountStatus(s.accountId, 'errored'), PROBLEME],
      [() => v2.accountStatus(s.accountId, 'partial'), PARTIEL],
      [() => v2.accountLocked(s.accountId), RESTREINT],
    ] as const) {
      await setStatus(s, 'OK');
      await clearNotices(s);
      const event = make();
      await Promise.all(Array.from({ length: 8 }, () => webhook(event)));
      await webhook(event);
      expect(await titlesOf(s), title).toEqual([title]);
    }
  });

  test('@critical événements mêlés livrés ensemble (8 et 24, evt_ distincts) : statut et notifications d\'un ordre série, jamais autre chose', async () => {
    const s = await scene();
    const rng = seeded(20261012);
    const kinds: Kind[] = ['lock', 'unlock', 'running', 'degraded', 'partial', 'disconnected', 'errored'];
    const initials = ['OK', 'PARTIAL', 'LOCKED', 'CREDENTIALS', 'DEGRADED', null];
    const providers = [
      { status: 'running', locked: false, model: 'OK' }, { status: 'partial', locked: false, model: 'PARTIAL' },
      { status: 'degraded', locked: false, model: 'DEGRADED' }, { status: 'running', locked: true, model: 'LOCKED' },
    ];
    const pick = <T,>(list: T[]): T => list[Math.floor(rng() * list.length)];
    let rounds = 0;
    for (const count of [8, 24]) {
      for (let round = 0; round < (count === 8 ? 12 : 6); round++) {
        // 8 événements : les sept genres ; 24 : trois ou quatre genres (le modèle énumère les mélanges possibles).
        const pool = count === 8 ? kinds : [...kinds].sort(() => rng() - 0.5).slice(0, 3 + (round % 2));
        const mix = Array.from({ length: count }, () => pick(pool));
        const initial = pick(initials);
        const provider = pick(providers);
        const { status, told } = await deliverTogether(s, initial, mix, provider);
        const allowed = serialOutcomes(initial ?? '', mix, provider.model);
        expect(allowed.has(`${status}|${told.join(',')}`),
          `${count} événements depuis ${initial}, prestataire ${provider.model} : ${status}|${told.join(',')} n'est le résultat d'aucun ordre série de ${mix.join(' ')}`).toBe(true);
        rounds++;
      }
    }
    expect(rounds).toBeGreaterThanOrEqual(18);
  });
});

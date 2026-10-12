// Pure helpers of the account lists.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-accounts/account-list.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import {
  hasCustomProxy,
  isValidProxyHost,
  mapWithLimit,
  outdatedLinkEntry,
  projectLinkedInEntry,
  subscriptionsFrom,
  TtlCache,
  unverifiedLinkEntry,
} from './account-list.ts';

Deno.test('subscriptionsFrom : les contrats font foi, sinon les produits connectés, classic toujours', () => {
  deepStrictEqual(subscriptionsFrom([], undefined), { classic: true, recruiter: false, sales_navigator: false });
  deepStrictEqual(subscriptionsFrom([{ product: 'recruiter' }], undefined), { classic: true, recruiter: true, sales_navigator: false });
  deepStrictEqual(subscriptionsFrom([{ product: 'sales_navigator' }], { recruiter: 'running' }), {
    classic: true, recruiter: false, sales_navigator: true,
  }, 'avec les contrats, le reste est ignoré');
  deepStrictEqual(subscriptionsFrom(null, { classic: 'running', recruiter: 'running' }), { classic: true, recruiter: true, sales_navigator: false });
  deepStrictEqual(subscriptionsFrom(null, { sales_navigator: 'disconnected' }), { classic: true, recruiter: false, sales_navigator: true });
  deepStrictEqual(subscriptionsFrom(null, null), { classic: true, recruiter: false, sales_navigator: false });
});

Deno.test('projectLinkedInEntry : forme de l ancienne liste, statut au vocabulaire Konekt', () => {
  const entry = projectLinkedInEntry(
    { id: 'acc_1', name: 'Claire Martin', status: 'running', is_locked: false, provider: 'linkedin', initial_sync: { status: 'completed' } },
    { mapped: true, pictureUrl: 'https://media.example/p.jpg', contracts: [{ product: 'recruiter' }] },
  );
  deepStrictEqual(entry, {
    id: 'acc_1',
    name: 'Claire Martin',
    identifier: 'Claire Martin',
    status: 'OK',
    mapped: true,
    profile_picture_url: 'https://media.example/p.jpg',
    subscriptions: { classic: true, recruiter: true, sales_navigator: false },
    is_locked: false,
    reconnectable: false,
    initial_sync_status: 'completed',
  });
  const limited = projectLinkedInEntry({ id: 'acc_2', status: 'partial', is_locked: false }, { mapped: false, pictureUrl: null, contracts: null });
  strictEqual(limited.status, 'PARTIAL');
  strictEqual(limited.reconnectable, true);
  strictEqual(limited.name, 'Compte LinkedIn');
  const locked = projectLinkedInEntry({ id: 'acc_3', status: 'running', is_locked: true }, { mapped: true, pictureUrl: null, contracts: null });
  strictEqual(locked.status, 'LOCKED');
  strictEqual(locked.reconnectable, false);
  const stored = projectLinkedInEntry({ id: 'acc_4', status: 'disconnected' }, { mapped: true, pictureUrl: null, contracts: null, storedName: 'Nom enregistré' });
  strictEqual(stored.name, 'Nom enregistré');
  strictEqual(stored.status, 'CREDENTIALS');
});

Deno.test('outdatedLinkEntry : à reconnecter, aucun appel, jamais le nom qui porte l état', () => {
  const entry = outdatedLinkEntry({ linkedin_account_id: 'ancien-id', linkedin_account_name: 'user:abc|org:def' });
  strictEqual(entry.status, 'CREDENTIALS');
  strictEqual(entry.mapped, true);
  strictEqual(entry.name, 'Compte LinkedIn');
  strictEqual(entry.id, 'ancien-id');
  deepStrictEqual(entry.subscriptions, { classic: true, recruiter: false, sales_navigator: false });
});

Deno.test('unverifiedLinkEntry : dernier état connu, jamais à reconnecter, état inconnu = OK', () => {
  const entry = unverifiedLinkEntry({ linkedin_account_id: 'acc_slow', linkedin_account_name: 'Claire Martin', account_status: 'DEGRADED' });
  strictEqual(entry.id, 'acc_slow');
  strictEqual(entry.status, 'DEGRADED');
  strictEqual(entry.reconnectable, false);
  strictEqual(entry.profile_picture_url, null);
  strictEqual(unverifiedLinkEntry({ linkedin_account_id: 'acc_x', account_status: 'WEIRD' }).status, 'OK');
  strictEqual(unverifiedLinkEntry({ linkedin_account_id: 'acc_x', account_status: 'LOCKED' }).is_locked, true);
});

Deno.test('hasCustomProxy : proxy personnalisé reconnu, proxy automatique ou absent non', () => {
  strictEqual(hasCustomProxy({ proxy: { country: 'FR', auto_proxy: false, host: 'p.example', port: 1080 } }), true);
  strictEqual(hasCustomProxy({ proxy: { country: null, auto_proxy: false } }), true);
  strictEqual(hasCustomProxy({ proxy: { country: 'FR', auto_proxy: true } }), false);
  strictEqual(hasCustomProxy({}), false);
  strictEqual(hasCustomProxy(null), false);
});

Deno.test('isValidProxyHost : nom de machine ou adresse IP, rien d autre', () => {
  for (const ok of ['p.example', 'proxy-1.exemple.fr', '10.0.0.1', '2001:db8::1', 'localhost']) strictEqual(isValidProxyHost(ok), true, ok);
  for (const bad of ['', ' ', 'a b', 'http://x.test', 'x.test/path', 'x.test:80', '-bad.test', 'a'.repeat(254), 'bad_host.test', 'p.example?x=1']) {
    strictEqual(isValidProxyHost(bad), false, bad);
  }
  for (const notString of [undefined, null, 42, {}, ['p.example']]) strictEqual(isValidProxyHost(notString), false);
});

Deno.test('mapWithLimit : ordre conservé, concurrence bornée', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapWithLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5 - (n % 3)));
    inFlight--;
    return n * 2;
  });
  deepStrictEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  ok(peak <= 3 && peak >= 2, `pic ${peak}`);
  deepStrictEqual(await mapWithLimit([], 4, (x) => Promise.resolve(x)), []);
});

Deno.test('mapWithLimit : une erreur remonte', async () => {
  let message = '';
  try {
    await mapWithLimit([1, 2], 2, (n) => n === 2 ? Promise.reject(new Error('boum')) : Promise.resolve(n));
  } catch (e) {
    message = (e as Error).message;
  }
  strictEqual(message, 'boum');
});

Deno.test('TtlCache : expiration, éviction, valeurs nulles gardées', () => {
  let now = 1_000;
  const cache = new TtlCache<string | null>(100, 2, () => now);
  strictEqual(cache.get('a'), undefined);
  cache.set('a', 'x');
  cache.set('b', null);
  strictEqual(cache.get('a'), 'x');
  strictEqual(cache.get('b'), null, 'un null lu est une réponse, pas un manque');
  cache.set('c', 'z'); // plein : le plus ancien part
  strictEqual(cache.get('a'), undefined);
  strictEqual(cache.get('c'), 'z');
  now += 101;
  strictEqual(cache.get('c'), undefined);
  // Une entrée peut avoir sa propre durée (une lecture en échec est gardée moins longtemps).
  cache.set('short', 'x', 10);
  now += 11;
  strictEqual(cache.get('short'), undefined);
});

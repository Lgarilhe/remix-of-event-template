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
    licences_read: true,
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

Deno.test('licences_read : vrai seulement quand les contrats ont vraiment été lus, jamais pour une entrée construite sans lecture', () => {
  const live = (status: string, contracts: ReadonlyArray<{ product?: unknown }> | null, extra: Record<string, unknown> = {}) =>
    projectLinkedInEntry({ id: 'acc_l', name: 'Claire', status, is_locked: false, ...extra }, { mapped: true, pictureUrl: null, contracts });
  // Compte OK dont les contrats sont lus : les licences sont exactes (recruiter, ou classique seule avec une liste vide).
  strictEqual(live('running', [{ product: 'recruiter' }]).licences_read, true);
  strictEqual(live('running', []).licences_read, true, 'une liste vide lue est une lecture : classique seulement, exact');
  deepStrictEqual(live('running', []).subscriptions, { classic: true, recruiter: false, sales_navigator: false });
  // Compte OK dont l appel des contrats a échoué (readContracts rend null) : `subscriptions` n est qu une estimation, rien n est lu.
  const failed = live('running', null);
  strictEqual(failed.licences_read, false);
  deepStrictEqual(failed.subscriptions, { classic: true, recruiter: false, sales_navigator: false }, 'subscriptions gardée pour la compatibilité (ici sans produit connecté)');
  // Avec des produits connectés dans les métadonnées, l estimation les reprend, mais l entrée dit toujours qu elle n est pas lue.
  const estimated = projectLinkedInEntry(
    { id: 'acc_e', name: 'Claire', status: 'running', is_locked: false, metadata: { products_connection_status: { recruiter: 'running' } } },
    { mapped: true, pictureUrl: null, contracts: null },
  );
  strictEqual(estimated.subscriptions.recruiter, true);
  strictEqual(estimated.licences_read, false, 'une estimation n est pas une lecture');
  // Compte PARTIAL réellement lu avec ses contrats : lu ; compte à reconnecter ou orphelin (aucun contrat demandé) : non lu.
  strictEqual(live('partial', [{ product: 'sales_navigator' }]).licences_read, true);
  strictEqual(live('partial', [{ product: 'sales_navigator' }]).subscriptions.sales_navigator, true);
  strictEqual(live('disconnected', null).licences_read, false);
  // Entrées construites sans lecture du prestataire.
  strictEqual(outdatedLinkEntry({ linkedin_account_id: 'ancien-id' }).licences_read, false);
  for (const stored of ['OK', 'DEGRADED', 'CREDENTIALS', 'ERROR', 'PARTIAL', 'LOCKED', 'WEIRD', null, undefined]) {
    const entry = unverifiedLinkEntry({ linkedin_account_id: 'acc_u', account_status: stored });
    strictEqual(entry.licences_read, false, `état gardé ${String(stored)} : aucune lecture`);
    strictEqual(typeof entry.licences_read, 'boolean', 'toujours un booléen, jamais absent');
  }
  // Le JSON envoyé à l écran porte le booléen sur chaque entrée, avec ou sans marqueur `unverified`.
  for (const entry of [live('running', []), live('running', null), unverifiedLinkEntry({ linkedin_account_id: 'a', account_status: 'CREDENTIALS' }), outdatedLinkEntry({ linkedin_account_id: 'b' })]) {
    strictEqual(typeof JSON.parse(JSON.stringify(entry)).licences_read, 'boolean');
  }
});

Deno.test('outdatedLinkEntry : à reconnecter, aucun appel, jamais le nom qui porte l état', () => {
  const entry = outdatedLinkEntry({ linkedin_account_id: 'ancien-id', linkedin_account_name: 'user:abc|org:def' });
  strictEqual('unverified' in entry, false, 'un compte lu ou à reconnecter ne porte pas le marqueur');
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
  strictEqual(entry.unverified, true, 'le marqueur que l écran lit pour ne pas afficher « Actif » ni une licence inventée');
  strictEqual(unverifiedLinkEntry({ linkedin_account_id: 'acc_x', account_status: 'WEIRD' }).unverified, true);
  strictEqual(unverifiedLinkEntry({ linkedin_account_id: 'acc_x', account_status: 'WEIRD' }).status, 'OK');
  strictEqual(unverifiedLinkEntry({ linkedin_account_id: 'acc_x', account_status: 'LOCKED' }).is_locked, true);
});

Deno.test('unverifiedLinkEntry : le marqueur seulement quand le dernier état connu ne dit rien (OK, DEGRADED ou absent)', () => {
  // État absent, vide, inconnu ou sans gravité : le prestataire n'a pas répondu et rien ne dit que le compte va mal.
  const quiet: Array<[string | null | undefined, string]> = [
    ['OK', 'OK'], ['DEGRADED', 'DEGRADED'], [undefined, 'OK'], [null, 'OK'], ['', 'OK'], ['WEIRD', 'OK'], ['ok', 'OK'],
  ];
  for (const [stored, status] of quiet) {
    const entry = unverifiedLinkEntry({ linkedin_account_id: 'acc_q', account_status: stored });
    strictEqual(entry.unverified, true, `état gardé ${String(stored)} : marqueur posé`);
    strictEqual(entry.status, status, `état gardé ${String(stored)}`);
    strictEqual(entry.reconnectable, false, `état gardé ${String(stored)} : rien ne dit qu'il faut reconnecter`);
  }
  // Un webhook a déjà dit la vérité (à reconnecter, en panne, partiel, verrouillé) : la carte la montre avec son action,
  // elle ne dit pas « État à vérifier ». Aucun marqueur, pas même `false`.
  const bad: Array<[string, boolean]> = [['CREDENTIALS', true], ['ERROR', true], ['PARTIAL', true], ['LOCKED', false]];
  for (const [stored, reconnectable] of bad) {
    const entry = unverifiedLinkEntry({ linkedin_account_id: 'acc_b', linkedin_account_name: 'Claire Martin', account_status: stored });
    strictEqual('unverified' in entry, false, `${stored} : aucun marqueur`);
    strictEqual(entry.unverified, undefined, stored);
    strictEqual(entry.status, stored, `${stored} : l'état enregistré est gardé`);
    strictEqual(entry.is_locked, stored === 'LOCKED', stored);
    strictEqual(entry.reconnectable, reconnectable, `${stored} : l'action Reconnecter suit l'état, comme pour un compte lu`);
    strictEqual(entry.mapped, true, stored);
    strictEqual(entry.id, 'acc_b', stored);
    strictEqual(entry.profile_picture_url, null, stored);
  }
  // Le JSON envoyé à l'écran ne porte pas la clé non plus.
  ok(!('unverified' in JSON.parse(JSON.stringify(unverifiedLinkEntry({ linkedin_account_id: 'acc_b', account_status: 'CREDENTIALS' })))));
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

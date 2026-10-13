// Pagination : curseur, offset, has_more (chaînes) et mode automatique, avec
// plafonds durs sur les pages et les éléments.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/pagination.test.ts

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { UnipileError } from './errors.ts';
import {
  collect,
  DEFAULT_MAX_PAGES,
  HARD_MAX_ITEMS,
  HARD_MAX_PAGES,
  pageQuery,
  paginate,
  parsePage,
  type PageParams,
} from './pagination.ts';

/** A provider fed by a list of pages; records the parameters of each request. */
function provider(pages: unknown[]) {
  const requests: PageParams[] = [];
  return {
    requests,
    fetchPage: (params: PageParams) => {
      requests.push(params);
      return Promise.resolve(pages[Math.min(requests.length - 1, pages.length - 1)]);
    },
  };
}

Deno.test('parsePage : data, items, entities, contracts ; next_cursor, total_count, has_more', () => {
  deepStrictEqual(parsePage({ data: [1, 2], next_cursor: 'c', total_count: 9, has_more: true }), {
    items: [1, 2], nextCursor: 'c', totalCount: 9, hasMore: true,
  });
  strictEqual(parsePage({ items: [1] }).items.length, 1);
  strictEqual(parsePage({ entities: [1, 2, 3] }).items.length, 3);
  strictEqual(parsePage({ contracts: [1] }).items.length, 1);
  strictEqual(parsePage([1, 2]).items.length, 2);
});

Deno.test('parsePage : forme inattendue donne une page vide, jamais une exception', () => {
  for (const body of [null, undefined, 'x', 7, {}, { data: 'nope' }, { data: {} }]) {
    deepStrictEqual(parsePage(body), { items: [], nextCursor: null, totalCount: null, hasMore: null });
  }
  strictEqual(parsePage({ data: [], next_cursor: '' }).nextCursor, null);
  strictEqual(parsePage({ data: [], total_count: 'x' }).totalCount, null);
  strictEqual(parsePage({ data: [], has_more: 'yes' }).hasMore, null);
});

Deno.test('pageQuery : nombres pour curseur et offset, chaînes pour has_more', () => {
  deepStrictEqual(pageQuery('cursor', { limit: 20, cursor: 'abc' }), { limit: 20, cursor: 'abc' });
  deepStrictEqual(pageQuery('offset', { limit: 20, offset: 40 }), { limit: 20, offset: 40 });
  deepStrictEqual(pageQuery('has_more', { limit: 20, offset: 40 }), { limit: '20', offset: '40' });
  deepStrictEqual(pageQuery('auto', { limit: 5 }), { limit: 5 });
});

Deno.test('mode cursor : suit next_cursor jusqu’à son absence', async () => {
  const p = provider([
    { data: [1, 2], next_cursor: 'c1' },
    { data: [3, 4], next_cursor: 'c2' },
    { data: [5] },
  ]);
  const result = await collect({ mode: 'cursor', fetchPage: p.fetchPage, limit: 2 });
  deepStrictEqual(result.items, [1, 2, 3, 4, 5]);
  strictEqual(result.pages, 3);
  strictEqual(result.truncated, false);
  deepStrictEqual(p.requests.map((r) => r.cursor), [undefined, 'c1', 'c2']);
  deepStrictEqual(p.requests[0].query, { limit: 2 });
  deepStrictEqual(p.requests[1].query, { limit: 2, cursor: 'c1' });
  ok(p.requests.every((r) => r.offset === undefined));
});

Deno.test('mode cursor : un curseur répété par le fournisseur arrête la boucle', async () => {
  const p = provider([{ data: [1], next_cursor: 'same' }, { data: [2], next_cursor: 'same' }, { data: [3], next_cursor: 'same' }]);
  const result = await collect({ mode: 'cursor', fetchPage: p.fetchPage });
  deepStrictEqual(result.items, [1, 2]);
  strictEqual(p.requests.length, 2);
  strictEqual(result.truncated, false);
});

Deno.test('mode cursor : une page vide avec un curseur est suivie (filtrage côté fournisseur)', async () => {
  const p = provider([{ data: [], next_cursor: 'c1' }, { data: [1] }]);
  const result = await collect({ mode: 'cursor', fetchPage: p.fetchPage });
  deepStrictEqual(result.items, [1]);
});

Deno.test('mode cursor : startCursor reprend là où on s’était arrêté', async () => {
  const p = provider([{ data: [9] }]);
  await collect({ mode: 'cursor', fetchPage: p.fetchPage, startCursor: 'resume' });
  strictEqual(p.requests[0].cursor, 'resume');
  deepStrictEqual(p.requests[0].query, { limit: 20, cursor: 'resume' });
});

Deno.test('mode offset : avance du nombre d’éléments reçus, s’arrête sur une page vide', async () => {
  const p = provider([{ data: [1, 2, 3] }, { data: [4, 5] }, { data: [] }]);
  const result = await collect({ mode: 'offset', fetchPage: p.fetchPage, limit: 3 });
  deepStrictEqual(result.items, [1, 2, 3, 4, 5]);
  deepStrictEqual(p.requests.map((r) => r.offset), [0, 3, 5]);
  deepStrictEqual(p.requests[1].query, { limit: 3, offset: 3 });
});

Deno.test('mode offset : une page plus courte que la limite ne prouve rien, on continue jusqu’à une page vide', async () => {
  const p = provider([{ data: [1] }, { data: [2] }, { data: [] }]);
  const result = await collect({ mode: 'offset', fetchPage: p.fetchPage, limit: 10 });
  deepStrictEqual(result.items, [1, 2]);
  strictEqual(p.requests.length, 3);
});

Deno.test('mode offset : total_count atteint arrête sans requête de trop', async () => {
  const p = provider([{ data: [1, 2], total_count: 4 }, { data: [3, 4], total_count: 4 }, { data: [5], total_count: 4 }]);
  const result = await collect({ mode: 'offset', fetchPage: p.fetchPage, limit: 2 });
  deepStrictEqual(result.items, [1, 2, 3, 4]);
  strictEqual(p.requests.length, 2);
  strictEqual(result.totalCount, 4);
  strictEqual(result.truncated, false);
});

Deno.test('mode offset : startOffset', async () => {
  const p = provider([{ data: [7, 8] }, { data: [] }]);
  await collect({ mode: 'offset', fetchPage: p.fetchPage, startOffset: 40, limit: 2 });
  deepStrictEqual(p.requests.map((r) => r.offset), [40, 42]);
});

Deno.test('mode offset : un fournisseur qui ignore l’offset (même page) est détecté avec keyOf', async () => {
  const same = { data: [{ id: 'a' }, { id: 'b' }] };
  const p = provider([same, same, same, same]);
  const result = await collect({ mode: 'offset', fetchPage: p.fetchPage, limit: 2, keyOf: (x: { id: string }) => x.id });
  deepStrictEqual(result.items.map((i) => i.id), ['a', 'b']);
  strictEqual(p.requests.length, 2);
});

Deno.test('mode has_more : offset et limit en chaînes, suit has_more', async () => {
  const p = provider([
    { object: 'Accounts', data: [1, 2], has_more: true },
    { object: 'Accounts', data: [3], has_more: false },
  ]);
  const result = await collect({ mode: 'has_more', fetchPage: p.fetchPage, limit: 2 });
  deepStrictEqual(result.items, [1, 2, 3]);
  deepStrictEqual(p.requests.map((r) => r.query), [{ limit: '2', offset: '0' }, { limit: '2', offset: '2' }]);
  ok(p.requests.every((r) => typeof r.query.limit === 'string' && typeof r.query.offset === 'string'));
});

Deno.test('mode has_more : has_more vrai sur une page vide ne boucle pas', async () => {
  const p = provider([{ data: [1], has_more: true }, { data: [], has_more: true }, { data: [9], has_more: true }]);
  const result = await collect({ mode: 'has_more', fetchPage: p.fetchPage });
  deepStrictEqual(result.items, [1]);
  strictEqual(p.requests.length, 2);
});

Deno.test('mode auto : curseur d’abord, puis has_more, puis total_count ; sans signal la liste s’arrête', async () => {
  const cursor = provider([{ data: [1], next_cursor: 'c' }, { data: [2] }]);
  deepStrictEqual((await collect({ mode: 'auto', fetchPage: cursor.fetchPage })).items, [1, 2]);
  strictEqual(cursor.requests[1].cursor, 'c');

  const hasMore = provider([{ data: [1], has_more: true }, { data: [2], has_more: false }]);
  deepStrictEqual((await collect({ mode: 'auto', fetchPage: hasMore.fetchPage })).items, [1, 2]);
  strictEqual(hasMore.requests[1].offset, 1);

  const total = provider([{ data: [1, 2], total_count: 3 }, { data: [3], total_count: 3 }]);
  deepStrictEqual((await collect({ mode: 'auto', fetchPage: total.fetchPage })).items, [1, 2, 3]);
  strictEqual(total.requests[1].offset, 2);

  // Une page pleine sans cursor, has_more ni total_count : « limit » est un plafond, pas une garantie.
  const nothing = provider([{ data: [1, 2, 3] }, { data: [4] }]);
  const r = await collect({ mode: 'auto', fetchPage: nothing.fetchPage, limit: 3 });
  deepStrictEqual(r.items, [1, 2, 3]);
  strictEqual(nothing.requests.length, 1);
});

Deno.test('mode auto : après plusieurs pages à curseur, le repli sur l’offset compte tous les éléments reçus', async () => {
  const p = provider([
    { data: [1, 2], next_cursor: 'c1' },
    { data: [3, 4], next_cursor: 'c2' },
    { data: [5], has_more: true },
    { data: [6], has_more: false },
  ]);
  await collect({ mode: 'auto', fetchPage: p.fetchPage, limit: 2 });
  strictEqual(p.requests[3].offset, 5);
});

Deno.test('plafond de pages : truncated vrai si le fournisseur avait encore des pages, curseur de reprise rendu', async () => {
  let n = 0;
  const fetchPage = () => Promise.resolve({ data: [n++], next_cursor: `c${n}` });
  const result = await collect({ mode: 'cursor', fetchPage, maxPages: 3 });
  strictEqual(result.pages, 3);
  strictEqual(result.items.length, 3);
  strictEqual(result.truncated, true);
  strictEqual(result.nextCursor, 'c3');
});

Deno.test('plafond de pages : atteint juste à la fin de la liste, pas de troncature', async () => {
  const p = provider([{ data: [1], next_cursor: 'c1' }, { data: [2], next_cursor: 'c2' }, { data: [3] }]);
  const result = await collect({ mode: 'cursor', fetchPage: p.fetchPage, maxPages: 3 });
  strictEqual(result.truncated, false);
  strictEqual(result.nextCursor, null);
});

Deno.test('plafond d’éléments : coupe exactement à maxItems et indique où reprendre', async () => {
  const p = provider([{ data: [1, 2, 3], total_count: 99 }, { data: [4, 5, 6], total_count: 99 }, { data: [7, 8, 9], total_count: 99 }]);
  const result = await collect({ mode: 'offset', fetchPage: p.fetchPage, limit: 3, maxItems: 4 });
  deepStrictEqual(result.items, [1, 2, 3, 4]);
  strictEqual(result.truncated, true);
  strictEqual(result.nextOffset, 4);
  strictEqual(p.requests.length, 2);
});

Deno.test('plafonds par défaut et plafonds durs : les demandes excessives sont ramenées', async () => {
  strictEqual(DEFAULT_MAX_PAGES, 10);
  // Un fournisseur sans fin : le plafond dur de pages s'applique même si l'appelant en demande 10 000.
  let calls = 0;
  const endless = () => Promise.resolve({ data: [calls++], next_cursor: `c${calls}` });
  const result = await collect({ mode: 'cursor', fetchPage: endless, maxPages: 10_000, maxItems: 10_000_000 });
  strictEqual(result.pages, HARD_MAX_PAGES);
  ok(result.items.length <= HARD_MAX_ITEMS);
  strictEqual(result.truncated, true);
  // Plafond dur d'éléments.
  const wide = () => Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => i), next_cursor: `c${Math.random()}` });
  const big = await collect({ mode: 'cursor', fetchPage: wide, maxPages: 50, maxItems: 99_999 });
  strictEqual(big.items.length, HARD_MAX_ITEMS);
  strictEqual(big.truncated, true);
});

Deno.test('limite de page : par défaut 20, bornée à au moins 1', async () => {
  const p = provider([{ data: [] }]);
  await collect({ mode: 'cursor', fetchPage: p.fetchPage });
  strictEqual(p.requests[0].limit, 20);
  const q = provider([{ data: [] }]);
  await collect({ mode: 'cursor', fetchPage: q.fetchPage, limit: 0 });
  strictEqual(q.requests[0].limit, 1);
});

Deno.test('paginate : générateur page par page, l’appelant peut s’arrêter quand il veut', async () => {
  const p = provider([{ data: [1], next_cursor: 'a' }, { data: [2], next_cursor: 'b' }, { data: [3] }]);
  const seen: number[] = [];
  for await (const page of paginate({ mode: 'cursor', fetchPage: p.fetchPage })) {
    seen.push(...(page.items as number[]));
    if (seen.length === 2) break;
  }
  deepStrictEqual(seen, [1, 2]);
  strictEqual(p.requests.length, 2, 'aucune requête après l’arrêt');
});

Deno.test('une erreur du fournisseur se propage à l’appelant', async () => {
  let n = 0;
  const fetchPage = () => {
    if (n++ === 1) throw new UnipileError('server');
    return Promise.resolve({ data: [n], next_cursor: 'x' + n });
  };
  await rejects(() => collect({ mode: 'cursor', fetchPage }), (e: unknown) => e instanceof UnipileError && e.kind === 'server');
});

Deno.test('collect : deadlineMs 0 arrête après la première page et rend le point de reprise', async () => {
  let calls = 0;
  const result = await collect({
    mode: 'cursor',
    deadlineMs: 0,
    fetchPage: () => Promise.resolve({ data: [{ id: `i${++calls}` }], next_cursor: `c${calls + 1}` }),
  });
  strictEqual(calls, 1);
  strictEqual(result.truncated, true);
  strictEqual(result.nextCursor, 'c2');
  // Sans délai, la liste est lue jusqu'au bout des plafonds.
  calls = 0;
  const all = await collect({
    mode: 'cursor',
    maxPages: 3,
    fetchPage: () => Promise.resolve({ data: [{ id: `i${++calls}` }], next_cursor: `c${calls + 1}` }),
  });
  strictEqual(all.items.length, 3);
});

Deno.test('paginate : deadlineMs 0 ne demande pas de seconde page', async () => {
  let calls = 0;
  const seen: number[] = [];
  for await (const page of paginate({
    mode: 'cursor',
    deadlineMs: 0,
    fetchPage: () => Promise.resolve({ data: [{ id: `i${++calls}` }], next_cursor: `c${calls + 1}` }),
  })) seen.push(page.items.length);
  deepStrictEqual(seen, [1]);
  strictEqual(calls, 1);
});

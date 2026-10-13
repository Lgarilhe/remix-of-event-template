// Garde d'isolation : un compte n'est utilisable que s'il est rattaché à
// l'organisation de l'appelant (LinkedIn, boîte e-mail ou WhatsApp).
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/guard.test.ts

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { isUnipileError } from './errors.ts';
import {
  AccountNotOwnedError,
  assertAccountOwnedByOrg,
  findAccountOwnership,
  type GuardAdmin,
} from './guard.ts';

interface Row {
  id: string;
  user_id: string;
  organization_id: string;
  [column: string]: string;
}

/** Fake admin: tables of rows, `eq` filters, records every query. */
function fakeAdmin(tables: Record<string, Row[]>, failOn?: string) {
  const queries: Array<{ table: string; columns: string; filters: Array<[string, string]>; limit: number | null }> = [];
  const admin: GuardAdmin = {
    from(table: string) {
      return {
        select(columns: string) {
          const record = { table, columns, filters: [] as Array<[string, string]>, limit: null as number | null };
          queries.push(record);
          const query = {
            eq(column: string, value: string) {
              record.filters.push([column, value]);
              return query;
            },
            limit(count: number) {
              record.limit = count;
              return query;
            },
            then<R1, R2>(
              onfulfilled?: ((value: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
              onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
            ) {
              const result = table === failOn
                ? { data: null, error: { message: 'permission denied' } }
                : {
                  data: (tables[table] ?? [])
                    .filter((row) => record.filters.every(([c, v]) => row[c] === v))
                    .slice(0, record.limit ?? Infinity),
                  error: null,
                };
              return Promise.resolve(result).then(onfulfilled, onrejected);
            },
          };
          return query;
        },
      };
    },
  };
  return { admin, queries };
}

const ORG_A = 'org-a';
const ORG_B = 'org-b';

const TABLES: Record<string, Row[]> = {
  member_linkedin_accounts: [
    { id: 'r1', user_id: 'u1', organization_id: ORG_A, linkedin_account_id: 'acc_li_a' },
    { id: 'r2', user_id: 'u2', organization_id: ORG_B, linkedin_account_id: 'acc_li_b' },
  ],
  member_email_accounts: [
    { id: 'r3', user_id: 'u1', organization_id: ORG_A, email_account_id: 'acc_mail_a' },
    { id: 'r4', user_id: 'u2', organization_id: ORG_B, email_account_id: 'acc_mail_b' },
  ],
  member_whatsapp_accounts: [
    { id: 'r5', user_id: 'u1', organization_id: ORG_A, whatsapp_account_id: 'acc_wa_a' },
    { id: 'r6', user_id: 'u2', organization_id: ORG_B, whatsapp_account_id: 'acc_wa_b' },
  ],
};

Deno.test('autorise : compte LinkedIn, boîte e-mail et WhatsApp de la même organisation', async () => {
  const { admin } = fakeAdmin(TABLES);
  deepStrictEqual(await assertAccountOwnedByOrg(admin, ORG_A, 'acc_li_a'), { kind: 'linkedin', rowId: 'r1', userId: 'u1' });
  deepStrictEqual(await assertAccountOwnedByOrg(admin, ORG_A, 'acc_mail_a'), { kind: 'email', rowId: 'r3', userId: 'u1' });
  deepStrictEqual(await assertAccountOwnedByOrg(admin, ORG_A, 'acc_wa_a'), { kind: 'whatsapp', rowId: 'r5', userId: 'u1' });
  deepStrictEqual(await assertAccountOwnedByOrg(admin, ORG_B, 'acc_li_b'), { kind: 'linkedin', rowId: 'r2', userId: 'u2' });
});

Deno.test('refuse : compte d’une autre organisation, dans chacune des trois tables', async () => {
  const { admin } = fakeAdmin(TABLES);
  for (const id of ['acc_li_b', 'acc_mail_b', 'acc_wa_b']) {
    await rejects(
      () => assertAccountOwnedByOrg(admin, ORG_A, id),
      (e: unknown) => e instanceof AccountNotOwnedError && e.kind === 'forbidden' && e.status === 403 && e.code === 'account_not_owned',
      id,
    );
  }
  for (const id of ['acc_li_a', 'acc_mail_a', 'acc_wa_a']) {
    await rejects(() => assertAccountOwnedByOrg(admin, ORG_B, id), AccountNotOwnedError, id);
  }
});

Deno.test('refuse : compte inconnu, identifiants vides ou mal typés (échec fermé)', async () => {
  const { admin, queries } = fakeAdmin(TABLES);
  await rejects(() => assertAccountOwnedByOrg(admin, ORG_A, 'acc_unknown'), AccountNotOwnedError);
  const before = queries.length;
  for (const [org, acc] of [['', 'acc_li_a'], [ORG_A, ''], ['  ', 'acc_li_a'], [ORG_A, '  '], [undefined, 'acc_li_a'], [ORG_A, undefined], [null, null]] as Array<[unknown, unknown]>) {
    await rejects(() => assertAccountOwnedByOrg(admin, org as string, acc as string), AccountNotOwnedError, `${org}/${acc}`);
  }
  strictEqual(queries.length, before, 'aucune requête pour une entrée vide');
});

Deno.test('requête : colonnes exactes, filtre par organisation et par compte, une seule ligne, tables dans l’ordre', async () => {
  const { admin, queries } = fakeAdmin(TABLES);
  await assertAccountOwnedByOrg(admin, ORG_A, 'acc_wa_a');
  deepStrictEqual(queries.map((q) => q.table), ['member_linkedin_accounts', 'member_email_accounts', 'member_whatsapp_accounts']);
  deepStrictEqual(queries.map((q) => q.filters), [
    [['organization_id', ORG_A], ['linkedin_account_id', 'acc_wa_a']],
    [['organization_id', ORG_A], ['email_account_id', 'acc_wa_a']],
    [['organization_id', ORG_A], ['whatsapp_account_id', 'acc_wa_a']],
  ]);
  ok(queries.every((q) => q.limit === 1));
  ok(queries.every((q) => q.columns === 'id, user_id'));
});

Deno.test('arrêt à la première table qui correspond', async () => {
  const { admin, queries } = fakeAdmin(TABLES);
  await assertAccountOwnedByOrg(admin, ORG_A, 'acc_li_a');
  strictEqual(queries.length, 1);
});

Deno.test('kinds : restreint la recherche (une boîte e-mail n’est pas acceptée comme compte LinkedIn)', async () => {
  const { admin, queries } = fakeAdmin(TABLES);
  await rejects(() => assertAccountOwnedByOrg(admin, ORG_A, 'acc_mail_a', { kinds: ['linkedin'] }), AccountNotOwnedError);
  deepStrictEqual(queries.map((q) => q.table), ['member_linkedin_accounts']);
  const ok2 = await assertAccountOwnedByOrg(admin, ORG_A, 'acc_mail_a', { kinds: ['email', 'whatsapp'] });
  strictEqual(ok2.kind, 'email');
});

Deno.test('erreur de lecture : échec fermé avec une erreur serveur, jamais « autorisé » ni « non rattaché »', async () => {
  for (const failing of ['member_linkedin_accounts', 'member_email_accounts', 'member_whatsapp_accounts']) {
    const { admin } = fakeAdmin(TABLES, failing);
    // L'identifiant est cherché partout : la table en échec est atteinte si la précédente ne correspond pas.
    const target = failing === 'member_linkedin_accounts' ? 'acc_li_a' : failing === 'member_email_accounts' ? 'acc_mail_a' : 'acc_wa_a';
    await rejects(
      () => assertAccountOwnedByOrg(admin, ORG_A, target),
      (e: unknown) => isUnipileError(e) && e.kind === 'server' && e.code === 'ownership_check_failed' && !(e instanceof AccountNotOwnedError),
      failing,
    );
  }
});

Deno.test('findAccountOwnership : null quand le compte n’est rattaché nulle part', async () => {
  const { admin } = fakeAdmin(TABLES);
  strictEqual(await findAccountOwnership(admin, ORG_A, 'acc_li_b'), null);
  strictEqual(await findAccountOwnership(admin, ORG_A, ''), null);
  deepStrictEqual(await findAccountOwnership(admin, ORG_A, 'acc_li_a'), { kind: 'linkedin', rowId: 'r1', userId: 'u1' });
});

Deno.test('le même identifiant dans deux organisations ne fuit pas de l’une à l’autre', async () => {
  const shared: Record<string, Row[]> = {
    member_linkedin_accounts: [{ id: 'x1', user_id: 'u9', organization_id: ORG_B, linkedin_account_id: 'acc_shared' }],
  };
  const { admin } = fakeAdmin(shared);
  await rejects(() => assertAccountOwnedByOrg(admin, ORG_A, 'acc_shared'), AccountNotOwnedError);
  strictEqual((await assertAccountOwnedByOrg(admin, ORG_B, 'acc_shared')).userId, 'u9');
});

Deno.test('l’erreur de refus ne contient ni vocabulaire du prestataire ni identifiant dans son message', async () => {
  const { admin } = fakeAdmin(TABLES);
  try {
    await assertAccountOwnedByOrg(admin, ORG_A, 'acc_li_b');
    throw new Error('devait lever');
  } catch (e) {
    ok(e instanceof AccountNotOwnedError);
    ok(!/unipile|acc_/i.test(e.message));
    ok(!JSON.stringify(e).includes('acc_li_b'));
  }
});

Deno.test('userId : le compte d’un collègue de la même organisation est refusé', async () => {
  const tables: Record<string, Row[]> = {
    ...TABLES,
    member_linkedin_accounts: [
      ...TABLES.member_linkedin_accounts,
      { id: 'r7', user_id: 'u3', organization_id: ORG_A, linkedin_account_id: 'acc_li_colleague' },
    ],
  };
  const { admin } = fakeAdmin(tables);
  // Sans userId : rattaché à l’organisation suffit (travail d’organisation).
  strictEqual((await assertAccountOwnedByOrg(admin, ORG_A, 'acc_li_colleague')).userId, 'u3');
  // Avec userId : seul celui qui a relié le compte passe.
  strictEqual((await assertAccountOwnedByOrg(admin, ORG_A, 'acc_li_a', { userId: 'u1' })).userId, 'u1');
  await rejects(
    () => assertAccountOwnedByOrg(admin, ORG_A, 'acc_li_colleague', { userId: 'u1' }),
    (e: unknown) => e instanceof AccountNotOwnedError,
  );
  // Une valeur vide refuse (échec fermé), elle ne retombe pas sur « toute l’organisation ».
  strictEqual(await findAccountOwnership(admin, ORG_A, 'acc_li_a', { userId: '  ' }), null);
});

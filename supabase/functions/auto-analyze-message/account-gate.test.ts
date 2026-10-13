// deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/auto-analyze-message/account-gate.test.ts
import { deepStrictEqual, strictEqual } from 'node:assert';
import { accountFormatRefusal, authorizeAccount, type GateDeps } from './account-gate.ts';

const ACC = 'acc_abc123';

/** Stand-in of the service client for `assertAccountOwnedByOrg`: the given (organisation, account) pairs are linked. */
function fakeAdmin(linked: Array<{ organization_id: string; linkedin_account_id: string }>) {
  return {
    from(table: string) {
      return {
        select() {
          const filters: Record<string, string> = {};
          const chain = {
            eq(column: string, value: string) {
              filters[column] = value;
              return chain;
            },
            limit() {
              const hit = table === 'member_linkedin_accounts' &&
                linked.some((l) => l.organization_id === filters.organization_id && l.linkedin_account_id === filters.linkedin_account_id);
              return Promise.resolve({ data: hit ? [{ id: 'row-1', user_id: 'owner-1' }] : [], error: null });
            },
          };
          return chain;
        },
      };
    },
  };
}

function deps(options: {
  linked?: Array<{ organization_id: string; linkedin_account_id: string }>;
  owner?: { organizationId?: string; userId?: string };
  members?: Array<[string, string]>;
} = {}): GateDeps {
  return {
    admin: fakeAdmin(options.linked ?? []),
    findOwner: () => Promise.resolve(options.owner ?? {}),
    isMember: (userId, organizationId) => Promise.resolve((options.members ?? []).some(([u, o]) => u === userId && o === organizationId)),
  };
}

Deno.test('member: authorised on the organisation that owns the account, never on the one in the body', async () => {
  const d = deps({
    linked: [{ organization_id: 'org-B', linkedin_account_id: ACC }],
    owner: { organizationId: 'org-B', userId: 'owner-1' },
    members: [['user-A', 'org-A']],
  });
  // Member of org A names org A for an account of org B: forbidden.
  const refused = await authorizeAccount({ accountId: ACC, userId: 'user-A', bodyOrganizationId: 'org-A' }, d);
  deepStrictEqual(refused, { ok: false, status: 403, body: { error: 'Forbidden' } });
  // Member of org B: authorised, organisation taken from the owner.
  const d2 = deps({ ...{ linked: [{ organization_id: 'org-B', linkedin_account_id: ACC }], owner: { organizationId: 'org-B', userId: 'owner-1' } }, members: [['user-B', 'org-B']] });
  const ok = await authorizeAccount({ accountId: ACC, userId: 'user-B', bodyOrganizationId: 'org-A' }, d2);
  deepStrictEqual(ok, { ok: true, accountOrgId: 'org-B', ownerUserId: 'owner-1' });
});

Deno.test('member: an account linked nowhere is forbidden', async () => {
  const refused = await authorizeAccount({ accountId: ACC, userId: 'user-A', bodyOrganizationId: 'org-A' }, deps({ members: [['user-A', 'org-A']] }));
  strictEqual(refused.ok, false);
  if (!refused.ok) strictEqual(refused.status, 403);
});

Deno.test('service role naming an organisation: the account must be linked to it', async () => {
  const linked = [{ organization_id: 'org-1', linkedin_account_id: ACC }];
  const ok = await authorizeAccount({ accountId: ACC, userId: null, bodyOrganizationId: 'org-1' }, deps({ linked, owner: { organizationId: 'org-1', userId: 'owner-1' } }));
  deepStrictEqual(ok, { ok: true, accountOrgId: 'org-1', ownerUserId: 'owner-1' });
  const foreign = await authorizeAccount({ accountId: ACC, userId: null, bodyOrganizationId: 'org-2' }, deps({ linked, owner: { organizationId: 'org-1' } }));
  strictEqual(foreign.ok, false);
  if (!foreign.ok) strictEqual(foreign.status, 403);
});

Deno.test('service role without organisation falls back on the owner of the account', async () => {
  const linked = [{ organization_id: 'org-1', linkedin_account_id: ACC }];
  const ok = await authorizeAccount({ accountId: ACC, userId: null, bodyOrganizationId: null }, deps({ linked, owner: { organizationId: 'org-1', userId: 'owner-1' } }));
  deepStrictEqual(ok, { ok: true, accountOrgId: 'org-1', ownerUserId: 'owner-1' });
});

Deno.test('service role without organisation for an account linked nowhere is refused (no read with the shared key)', async () => {
  const refused = await authorizeAccount({ accountId: ACC, userId: null, bodyOrganizationId: undefined }, deps());
  deepStrictEqual(refused, { ok: false, status: 403, body: { error: 'Forbidden' } });
  const emptyOrg = await authorizeAccount({ accountId: ACC, userId: null, bodyOrganizationId: '' }, deps());
  strictEqual(emptyOrg.ok, false);
});

Deno.test('an outdated or unreadable account id is refused before any lookup, with the same upper-case codes as the chat classifier', async () => {
  let lookups = 0;
  const d: GateDeps = { ...deps(), findOwner: () => { lookups++; return Promise.resolve({}); } };
  const outdated = await authorizeAccount({ accountId: 'abc123xyz', userId: null, bodyOrganizationId: 'org-1' }, d);
  strictEqual(outdated.ok, false);
  if (!outdated.ok) {
    strictEqual(outdated.status, 409);
    strictEqual(outdated.body.error_code, 'ACCOUNT_OUTDATED');
    strictEqual(/unipile|acc_/i.test(outdated.body.error), false);
  }
  const invalid = await authorizeAccount({ accountId: 12, userId: null, bodyOrganizationId: 'org-1' }, d);
  strictEqual(invalid.ok, false);
  if (!invalid.ok) {
    strictEqual(invalid.status, 400);
    strictEqual(invalid.body.error_code, 'ACCOUNT_INVALID');
  }
  strictEqual(lookups, 0);
  strictEqual(accountFormatRefusal(ACC), null);
});

Deno.test('no account id: the gate passes the body organisation through (the handler refuses the missing account itself)', async () => {
  deepStrictEqual(await authorizeAccount({ accountId: undefined, userId: null, bodyOrganizationId: 'org-1' }, deps()), { ok: true, accountOrgId: 'org-1', ownerUserId: undefined });
});

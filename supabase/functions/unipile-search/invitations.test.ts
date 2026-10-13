// Actions list_sent_invitations et withdraw_invitation, et règle « depuis son propre compte » : forme de la liste
// (ancienneté en jours), retrait des seules invitations ENVOYÉES, registre des actions, rattachement aux
// inscriptions de l'organisation (statut withdrawn, attente de connexion franchissable), refus et pannes.
// Le prestataire est un transport factice ; la base est une doublure qui enregistre ses écritures.
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-search/invitations.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { withMockTransport, type MockReply, type RecordedRequest } from '../_shared/unipile/testing.ts';
import { ownerOnlyRefusal } from './account-rules.ts';
import {
  LOOKUP_BUDGET_MS,
  candidateIds,
  candidateSlugs,
  enrollmentIsInvitee,
  handleListSentInvitations,
  handleWithdrawInvitation,
  linkedInSlugOf,
  toSentInvitation,
  WITHDRAW_LEDGER_SOURCE,
  WITHDRAW_LEDGER_TYPE,
} from './invitations.ts';

const ACC = 'acc_test1';
const ORG = 'org-1';
const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const originalConsole = { log: console.log, warn: console.warn, error: console.error };
console.log = console.warn = console.error = () => {};
addEventListener('unload', () => Object.assign(console, originalConsole));

type Routes = Record<string, MockReply | MockReply[] | ((request: RecordedRequest) => MockReply)>;
function router(routes: Routes, timeline: string[] = []) {
  const counters = new Map<string, number>();
  return (request: RecordedRequest): MockReply => {
    const key = `${request.method} ${request.path}`;
    timeline.push(key);
    const entry = routes[key];
    if (entry === undefined) return { status: 404, body: { error: 'route inconnue', route: key } };
    if (typeof entry === 'function') return entry(request);
    if (Array.isArray(entry)) {
      const n = counters.get(key) ?? 0;
      counters.set(key, n + 1);
      return entry[Math.min(n, entry.length - 1)];
    }
    return entry;
  };
}

const LIST = `GET /${ACC}/users/me/relation-requests`;
const CANCEL = (id: string) => `POST /${ACC}/users/me/relation-requests/${id}/cancel`;

const request = (id: string, extra: Record<string, unknown> = {}) => ({
  object: 'RelationRequest',
  type: 'sent',
  id,
  created_at: '2026-10-05T12:00:00.000Z',
  message: 'Bonjour Ada',
  user: {
    object: 'User', id: 'ACoAAada', display_name: 'Ada Lovelace', public_identifier: 'ada-lovelace',
    profile_url: 'https://www.linkedin.com/in/ada-lovelace', public_picture_url: 'https://media.example/ada.jpg', headline: 'CTO',
  },
  ...extra,
});

async function call(response: Response) {
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Base factice : chaque requête est enregistrée, les lectures sont résolues par une fonction du test
// ---------------------------------------------------------------------------

interface Op {
  table: string;
  kind: 'select' | 'update' | 'insert';
  columns?: string;
  patch?: Record<string, unknown>;
  eqs: Record<string, unknown>;
  or?: string;
  ilike?: { column: string; pattern: string };
}

function fakeAdmin(resolve: (op: Op) => { data?: unknown; error?: unknown }) {
  const ops: Op[] = [];
  const from = (table: string) => {
    const op: Op = { table, kind: 'select', eqs: {} };
    // deno-lint-ignore no-explicit-any
    const q: any = {
      select: (columns?: string) => {
        if (op.kind === 'select') op.columns = columns;
        return q;
      },
      update: (patch: Record<string, unknown>) => { op.kind = 'update'; op.patch = patch; return q; },
      insert: (row: Record<string, unknown>) => { op.kind = 'insert'; op.patch = row; return q; },
      eq: (column: string, value: unknown) => { op.eqs[column] = value; return q; },
      or: (filter: string) => { op.or = filter; return q; },
      ilike: (column: string, pattern: string) => { op.ilike = { column, pattern }; return q; },
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
        ops.push(op);
        let result: { data?: unknown; error?: unknown };
        try {
          result = resolve(op);
        } catch (error) {
          return Promise.reject(error).then(ok, ko);
        }
        return Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(ok, ko);
      },
    };
    return q;
  };
  return { from, ops };
}

interface Enrollment {
  id: string;
  organization_id: string;
  account_id: string | null;
  assigned_sender_id: string | null;
  status: string;
  connection_status: string | null;
  profile_url: string | null;
  profile_id: string | null;
  resolved_profile_id: string | null;
  provider_id: string | null;
  tracking_data: Record<string, unknown> | null;
}

const enrollment = (id: string, extra: Partial<Enrollment> = {}): Enrollment => ({
  id, organization_id: ORG, account_id: ACC, assigned_sender_id: null, status: 'active', connection_status: 'pending_invite',
  profile_url: 'https://www.linkedin.com/in/ada-lovelace', profile_id: 'ACoAAada', resolved_profile_id: null, provider_id: null,
  tracking_data: null, ...extra,
});

interface Execution {
  id: string;
  enrollment_id: string;
  status: string;
  step: { id: string; action_type: string; wait_for_event: string | null; condition_type: string | null; timeout_days: number | null };
}

/** Résout les lectures et les écritures de `sequence_enrollments` et `sequence_step_executions` sur des lignes en mémoire. */
function memoryDatabase(enrollments: Enrollment[], executions: Execution[] = [], options: { failEnrollmentSelect?: boolean; failLedger?: boolean } = {}) {
  return fakeAdmin((op) => {
    if (op.table === 'linkedin_action_log') return options.failLedger ? { error: { message: 'ledger down' } } : {};
    if (op.table === 'sequence_enrollments' && op.kind === 'select') {
      if (options.failEnrollmentSelect) return { error: { message: 'select failed' } };
      let rows = enrollments.filter((r) => Object.entries(op.eqs).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
      if (op.or) {
        const wanted = op.or.split(',').map((part) => part.split('.eq.')[1]);
        rows = rows.filter((r) => [r.profile_id, r.resolved_profile_id, r.provider_id].some((v) => v && wanted.includes(v)));
      }
      if (op.ilike) {
        const needle = op.ilike.pattern.replace(/^%|%$/g, '').toLowerCase();
        rows = rows.filter((r) => (r.profile_url ?? '').toLowerCase().includes(needle));
      }
      return { data: rows };
    }
    if (op.table === 'sequence_enrollments' && op.kind === 'update') {
      const row = enrollments.find((r) => r.id === op.eqs.id && r.organization_id === op.eqs.organization_id);
      if (!row || row.connection_status === 'connected') return { data: [] };
      Object.assign(row, op.patch);
      return { data: [{ id: row.id }] };
    }
    if (op.table === 'sequence_step_executions' && op.kind === 'select') {
      return { data: executions.filter((e) => e.enrollment_id === op.eqs.enrollment_id && e.status === op.eqs.status) };
    }
    if (op.table === 'sequence_step_executions' && op.kind === 'update') {
      const row = executions.find((e) => e.id === op.eqs.id && e.status === op.eqs.status);
      if (!row) return { data: [] };
      Object.assign(row, op.patch);
      return { data: [{ id: row.id }] };
    }
    throw new Error(`lecture non prévue : ${op.table} ${op.kind}`);
  });
}

const waitConnection = (id: string, enrollmentId: string, timeoutDays: number | null = 7): Execution => ({
  id, enrollment_id: enrollmentId, status: 'waiting_event',
  step: { id: `step-${id}`, action_type: 'wait_connection', wait_for_event: 'connection_accepted', condition_type: null, timeout_days: timeoutDays },
});

const context = (admin: ReturnType<typeof fakeAdmin>, overrides = {}) => ({ organizationId: ORG, userId: 'user-1', admin: () => admin, ...overrides });

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

Deno.test('list_sent_invitations : invitations avec ancienneté en jours, forme réduite, demandes reçues écartées', async () => {
  const timeline: string[] = [];
  await withMockTransport(
    router({
      [LIST]: {
        body: {
          data: [request('inv1'), request('inv2', { created_at: '2026-10-12T08:00:00.000Z', message: undefined, user: { id: 'ACoAAbob', display_name: 'Bob', description: 'Dev' } }), request('rec1', { type: 'received' }), request('inv3', { created_at: undefined })],
          total_count: 3,
          next_cursor: 'cur2',
        },
      },
    }, timeline),
    async (mock) => {
      const { status, body } = await call(await handleListSentInvitations(ACC, { limit: 20 }, () => NOW));
      strictEqual(status, 200);
      strictEqual(body.success, true);
      strictEqual(body.cursor, 'cur2');
      strictEqual(body.total, 3);
      const list = body.invitations as Array<Record<string, unknown>>;
      deepStrictEqual(list.map((i) => i.id), ['inv1', 'inv2', 'inv3']);
      deepStrictEqual(list[0], {
        id: 'inv1', user_id: 'ACoAAada', name: 'Ada Lovelace', headline: 'CTO', profile_url: 'https://www.linkedin.com/in/ada-lovelace',
        public_identifier: 'ada-lovelace', picture_url: 'https://media.example/ada.jpg', message: 'Bonjour Ada',
        sent_at: '2026-10-05T12:00:00.000Z', age_days: 7,
      });
      strictEqual(list[1].age_days, 0);
      strictEqual(list[1].headline, 'Dev');
      strictEqual(list[1].message, null);
      strictEqual(list[2].age_days, null);
      const sent = mock.calls[0];
      strictEqual(sent.query.get('type'), 'sent');
      strictEqual(sent.query.get('limit'), '20');
      strictEqual(sent.query.get('cursor'), null);
    },
  );
  deepStrictEqual(timeline, [LIST]);
});

Deno.test('list_sent_invitations : curseur du prestataire transmis, décalage offset:<n> lu, fin de liste sans curseur', async () => {
  await withMockTransport(
    router({ [LIST]: (r) => ({ body: { data: [request('inv1')], total_count: r.query.get('offset') === '1' ? 2 : 5 } }) }),
    async (mock) => {
      const cursor = await call(await handleListSentInvitations(ACC, { cursor: 'providerCursor==' }, () => NOW));
      strictEqual(mock.calls[0].query.get('cursor'), 'providerCursor==');
      // Sans curseur du prestataire, le total dit qu'il en reste : décalage.
      strictEqual(cursor.body.cursor, 'offset:1');
      const offset = await call(await handleListSentInvitations(ACC, { cursor: 'offset:1' }, () => NOW));
      strictEqual(mock.calls[1].query.get('offset'), '1');
      strictEqual(mock.calls[1].query.get('cursor'), null);
      strictEqual(offset.body.cursor, null, 'offset 1 + 1 reçu = 2 = total');
    },
  );
});

Deno.test('list_sent_invitations : curseur inutilisable refusé sans appel, panne en texte neutre avec liste vide', async () => {
  await withMockTransport(router({ [LIST]: { status: 500, body: { message: 'Unipile secret interne' } } }), async (mock) => {
    const bad = await call(await handleListSentInvitations(ACC, { cursor: 'offset:abc' }, () => NOW));
    strictEqual(bad.status, 400);
    strictEqual(bad.body.errorType, 'INVALID_CURSOR');
    strictEqual((await call(await handleListSentInvitations(ACC, { cursor: 'x'.repeat(2001) }, () => NOW))).status, 400);
    strictEqual(mock.calls.length, 0);
    const failed = await call(await handleListSentInvitations(ACC, {}, () => NOW));
    strictEqual(failed.body.success, false);
    deepStrictEqual(failed.body.invitations, []);
    ok(!/unipile|secret/i.test(JSON.stringify(failed.body)), JSON.stringify(failed.body));
  });
});

Deno.test('toSentInvitation : nombres et champs absents tolérés, demande reçue ou sans identifiant écartée', () => {
  strictEqual(toSentInvitation(null, NOW), null);
  strictEqual(toSentInvitation({ type: 'sent' }, NOW), null);
  strictEqual(toSentInvitation({ id: 'r', type: 'received' }, NOW), null);
  deepStrictEqual(toSentInvitation({ id: 99, type: 'sent' }, NOW), {
    id: '99', user_id: null, name: null, headline: null, profile_url: null, public_identifier: null, picture_url: null,
    message: null, sent_at: null, age_days: null,
  });
  strictEqual(toSentInvitation({ id: 'x', created_at: '2027-01-01T00:00:00Z' }, NOW)?.age_days, 0, 'une date future ne donne jamais une ancienneté négative');
});

// ---------------------------------------------------------------------------
// Retrait
// ---------------------------------------------------------------------------

Deno.test('withdraw_invitation : retrouvée sur la 2e page, annulée, inscrite au registre, inscriptions de l\'organisation mises à jour', async () => {
  const enrollments = [
    enrollment('e-active'),
    enrollment('e-paused', { status: 'paused', profile_id: null, provider_id: 'ACoAAada' }),
    enrollment('e-slug', { profile_id: null, profile_url: 'https://www.linkedin.com/in/Ada-Lovelace/' }),
    enrollment('e-connected', { connection_status: 'connected' }),
    enrollment('e-other-org', { organization_id: 'org-2' }),
    enrollment('e-other-account', { account_id: 'acc_other' }),
    enrollment('e-other-person', { profile_id: 'ACoAAbob', profile_url: 'https://www.linkedin.com/in/bob' }),
    enrollment('e-lookalike', { profile_id: null, profile_url: 'https://www.linkedin.com/in/ada-lovelace-4b2a1' }),
  ];
  const executions: Execution[] = [
    waitConnection('x1', 'e-active', 7),
    waitConnection('x2', 'e-active', null), // sans délai : ne peut pas être franchie
    { ...waitConnection('x3', 'e-active', 7), step: { id: 'step-r', action_type: 'wait_reply', wait_for_event: 'reply_received', condition_type: null, timeout_days: 3 } },
    waitConnection('x4', 'e-paused', 7), // inscription en pause : reprendra son attente à la reprise
    waitConnection('x5', 'e-other-person', 7),
  ];
  const admin = memoryDatabase(enrollments, executions);
  const timeline: string[] = [];
  await withMockTransport(
    router({
      [LIST]: [
        { body: { data: [request('inv-a', { user: { id: 'ACoAAbob', public_identifier: 'bob' } })], next_cursor: 'page2' } },
        { body: { data: [request('inv-target')] } },
      ],
      [CANCEL('inv-target')]: { body: { object: 'RelationRequestCanceled' } },
    }, timeline),
    async (mock) => {
      const { status, body } = await call(await handleWithdrawInvitation(ACC, { request_id: 'inv-target' }, context(admin)));
      strictEqual(status, 200);
      deepStrictEqual(body, { success: true, request_id: 'inv-target', enrollments_updated: 3, enrollments_synced: true });
      deepStrictEqual(timeline, [LIST, LIST, CANCEL('inv-target')]);
      strictEqual(mock.calls[1].query.get('cursor'), 'page2');
      strictEqual(mock.calls[0].query.get('type'), 'sent');
    },
  );

  const status = (id: string) => enrollments.find((e) => e.id === id)!.connection_status;
  strictEqual(status('e-active'), 'withdrawn');
  strictEqual(status('e-paused'), 'withdrawn');
  strictEqual(status('e-slug'), 'withdrawn');
  strictEqual(status('e-connected'), 'connected');
  strictEqual(status('e-other-org'), 'pending_invite', 'jamais une inscription d\'une autre organisation');
  strictEqual(status('e-other-account'), 'pending_invite');
  strictEqual(status('e-other-person'), 'pending_invite');
  strictEqual(status('e-lookalike'), 'pending_invite', 'slug exact seulement');

  // Seule l'attente de connexion avec délai d'une inscription active est avancée, à une date que tout délai a dépassée.
  const moved = (id: string) => Date.parse(String(executions.find((e) => e.id === id)!.scheduled_at ?? '')) ;
  ok(Number.isFinite(moved('x1')) && moved('x1') < Date.now() - 3000 * 86_400_000, 'x1 reculée');
  for (const id of ['x2', 'x3', 'x4', 'x5']) ok(!('scheduled_at' in executions.find((e) => e.id === id)!), `${id} intacte`);

  // Registre : un enregistrement, avec l'organisation, la personne connectée, le compte, le type et l'origine.
  const ledger = admin.ops.filter((op) => op.table === 'linkedin_action_log');
  strictEqual(ledger.length, 1);
  deepStrictEqual(ledger[0].patch, {
    organization_id: ORG, user_id: 'user-1', account_id: ACC, action_type: WITHDRAW_LEDGER_TYPE, source: WITHDRAW_LEDGER_SOURCE,
  });
  // Toutes les lectures d'inscriptions sont bornées à l'organisation et au compte.
  for (const op of admin.ops.filter((o) => o.table === 'sequence_enrollments' && o.kind === 'select')) {
    strictEqual(op.eqs.organization_id, ORG);
    ok(op.eqs.account_id === ACC || op.eqs.assigned_sender_id === ACC);
  }
  for (const op of admin.ops.filter((o) => o.table === 'sequence_enrollments' && o.kind === 'update')) {
    strictEqual(op.eqs.organization_id, ORG);
    deepStrictEqual(op.patch, { connection_status: 'withdrawn' });
  }
});

Deno.test('withdraw_invitation : la délégation d\'envoi (assigned_sender_id) est aussi rattachée', async () => {
  const enrollments = [enrollment('e-rotation', { account_id: 'acc_main', assigned_sender_id: ACC })];
  const admin = memoryDatabase(enrollments);
  await withMockTransport(
    router({ [LIST]: { body: { data: [request('inv1')] } }, [CANCEL('inv1')]: { body: { object: 'RelationRequestCanceled' } } }),
    async () => {
      const { body } = await call(await handleWithdrawInvitation(ACC, { request_id: 'inv1' }, context(admin)));
      strictEqual(body.enrollments_updated, 1);
      strictEqual(enrollments[0].connection_status, 'withdrawn');
    },
  );
});

Deno.test('withdraw_invitation : le délai propre à l\'inscription ne rend franchissable qu\'une attente qui a un délai', async () => {
  const enrollments = [enrollment('e1', { tracking_data: { step_config_overrides: { 'step-x1': { timeoutDays: 2 }, 'step-x2': { timeoutDays: 2 } } } })];
  const executions: Execution[] = [waitConnection('x1', 'e1', 7), waitConnection('x2', 'e1', null)];
  const admin = memoryDatabase(enrollments, executions);
  await withMockTransport(
    router({ [LIST]: { body: { data: [request('inv1')] } }, [CANCEL('inv1')]: { body: { object: 'RelationRequestCanceled' } } }),
    async () => {
      await handleWithdrawInvitation(ACC, { request_id: 'inv1' }, context(admin));
      ok('scheduled_at' in executions[0], 'attente avec délai : franchissable');
      // Le contrôle des délais du moteur ignore une attente sans délai, même avec un réglage d'inscription.
      ok(!('scheduled_at' in executions[1]), 'attente sans délai : intacte');
    },
  );
});

Deno.test('withdraw_invitation : une demande REÇUE ou inconnue n\'est jamais refusée par ce chemin', async () => {
  const admin = memoryDatabase([enrollment('e1')]);
  const timeline: string[] = [];
  await withMockTransport(
    router({ [LIST]: { body: { data: [request('rec1', { type: 'received' }), request('inv1')] } }, [CANCEL('rec1')]: { body: { object: 'RelationRequestCanceled' } } }, timeline),
    async () => {
      for (const id of ['rec1', 'inconnue']) {
        const { status, body } = await call(await handleWithdrawInvitation(ACC, { request_id: id }, context(admin)));
        strictEqual(status, 404);
        strictEqual(body.errorType, 'INVITATION_NOT_FOUND');
        strictEqual(body.error, 'Cette invitation n’existe plus ou a déjà été traitée.');
      }
    },
  );
  ok(!timeline.some((entry) => entry.includes('/cancel')), 'aucune annulation envoyée');
  strictEqual(admin.ops.length, 0, 'ni registre ni inscription touchés');
});

Deno.test('withdraw_invitation : une liste trop longue pour être lue en entier ne passe pas pour une invitation disparue', async () => {
  const admin = memoryDatabase([enrollment('e1')]);
  const timeline: string[] = [];
  let page = 0;
  const hundred = () => Array.from({ length: 100 }, (_, i) => request(`other-${page}-${i}`));
  await withMockTransport(
    router({ [LIST]: () => ({ body: { data: hundred(), next_cursor: `c${++page}`, total_count: 5000 } }) }, timeline),
    async () => {
      const { status, body } = await call(await handleWithdrawInvitation(ACC, { request_id: 'tout-au-bout' }, context(admin)));
      strictEqual(status, 503);
      strictEqual(body.errorType, 'INVITATION_LOOKUP_INCOMPLETE');
      ok(!/unipile/i.test(JSON.stringify(body)));
    },
  );
  strictEqual(timeline.filter((entry) => entry === LIST).length, 10, 'dix pages au plus');
  ok(!timeline.some((entry) => entry.includes('/cancel')));
  strictEqual(admin.ops.length, 0);
});

Deno.test('withdraw_invitation : un prestataire lent arrête la recherche au budget de temps, sans annulation', async () => {
  const admin = memoryDatabase([]);
  const timeline: string[] = [];
  let clock = 0;
  let page = 0;
  await withMockTransport(
    router({
      [LIST]: () => {
        clock += 20_000;
        return { body: { data: [request(`other-${++page}`)], next_cursor: `c${page}`, total_count: 5000 } };
      },
    }, timeline),
    async () => {
      const { status, body } = await call(await handleWithdrawInvitation(ACC, { request_id: 'inv-lointaine' }, context(admin), () => clock));
      strictEqual(status, 503);
      strictEqual(body.errorType, 'INVITATION_LOOKUP_INCOMPLETE');
    },
  );
  ok(LOOKUP_BUDGET_MS <= 30_000);
  strictEqual(timeline.filter((entry) => entry === LIST).length, 2, 'deux lectures de 20 s, la troisième dépasserait 30 s');
  ok(!timeline.some((entry) => entry.includes('/cancel')));
});

Deno.test('withdraw_invitation : identifiant d\'invitation invalide refusé sans appel', async () => {
  const admin = memoryDatabase([]);
  await withMockTransport(router({}), async (mock) => {
    for (const bad of [undefined, '', '  ', 'a/b', '../x', 'x'.repeat(201), {}, ['1']]) {
      const { status, body } = await call(await handleWithdrawInvitation(ACC, { request_id: bad }, context(admin)));
      strictEqual(status, 400, String(bad));
      strictEqual(body.errorType, 'INVALID_REQUEST');
    }
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('withdraw_invitation : un identifiant numérique est accepté', async () => {
  const admin = memoryDatabase([]);
  await withMockTransport(
    router({ [LIST]: { body: { data: [request('7123456789')] } }, [CANCEL('7123456789')]: { body: { object: 'RelationRequestCanceled' } } }),
    async () => {
      const { status } = await call(await handleWithdrawInvitation(ACC, { request_id: 7123456789 }, context(admin)));
      strictEqual(status, 200);
    },
  );
});

Deno.test('withdraw_invitation : l\'annulation refusée par le prestataire ne laisse ni registre ni inscription modifiée', async () => {
  const enrollments = [enrollment('e1')];
  const admin = memoryDatabase(enrollments);
  await withMockTransport(
    router({ [LIST]: { body: { data: [request('inv1')] } }, [CANCEL('inv1')]: { status: 500, body: { message: 'Unipile secret interne' } } }),
    async () => {
      const { status, body } = await call(await handleWithdrawInvitation(ACC, { request_id: 'inv1' }, context(admin)));
      ok(status >= 400);
      strictEqual(body.success, false);
      ok(!/unipile|secret/i.test(JSON.stringify(body)), JSON.stringify(body));
    },
  );
  strictEqual(admin.ops.length, 0);
  strictEqual(enrollments[0].connection_status, 'pending_invite');
});

Deno.test('withdraw_invitation : la lecture des invitations en panne arrête avant l\'annulation', async () => {
  const admin = memoryDatabase([]);
  const timeline: string[] = [];
  await withMockTransport(router({ [LIST]: { status: 500, body: {} } }, timeline), async () => {
    const { body } = await call(await handleWithdrawInvitation(ACC, { request_id: 'inv1' }, context(admin)));
    strictEqual(body.success, false);
  });
  ok(!timeline.some((entry) => entry.includes('/cancel')));
});

Deno.test('withdraw_invitation : retrait réussi mais inscriptions illisibles = succès, enrollments_synced faux, registre écrit', async () => {
  const admin = memoryDatabase([enrollment('e1')], [], { failEnrollmentSelect: true });
  await withMockTransport(
    router({ [LIST]: { body: { data: [request('inv1')] } }, [CANCEL('inv1')]: { body: { object: 'RelationRequestCanceled' } } }),
    async () => {
      const { status, body } = await call(await handleWithdrawInvitation(ACC, { request_id: 'inv1' }, context(admin)));
      strictEqual(status, 200);
      deepStrictEqual(body, { success: true, request_id: 'inv1', enrollments_updated: 0, enrollments_synced: false });
    },
  );
  strictEqual(admin.ops.filter((o) => o.table === 'linkedin_action_log').length, 1);
});

Deno.test('withdraw_invitation : un registre en panne ne fait pas échouer un retrait déjà fait', async () => {
  const enrollments = [enrollment('e1')];
  const admin = memoryDatabase(enrollments, [], { failLedger: true });
  await withMockTransport(
    router({ [LIST]: { body: { data: [request('inv1')] } }, [CANCEL('inv1')]: { body: { object: 'RelationRequestCanceled' } } }),
    async () => {
      const { status, body } = await call(await handleWithdrawInvitation(ACC, { request_id: 'inv1' }, context(admin)));
      strictEqual(status, 200);
      strictEqual(body.enrollments_updated, 1);
    },
  );
});

Deno.test('withdraw_invitation : une invitation sans personne lisible ne touche aucune inscription', async () => {
  const enrollments = [enrollment('e1')];
  const admin = memoryDatabase(enrollments);
  await withMockTransport(
    router({ [LIST]: { body: { data: [{ object: 'RelationRequest', type: 'sent', id: 'inv1' }] } }, [CANCEL('inv1')]: { body: { object: 'RelationRequestCanceled' } } }),
    async () => {
      const { body } = await call(await handleWithdrawInvitation(ACC, { request_id: 'inv1' }, context(admin)));
      strictEqual(body.success, true);
      strictEqual(body.enrollments_updated, 0);
    },
  );
  strictEqual(enrollments[0].connection_status, 'pending_invite');
});

// ---------------------------------------------------------------------------
// Identité d'une personne et règle de compte
// ---------------------------------------------------------------------------

Deno.test('identité : identifiants assainis, slug exact, inscription désignée par identifiant ou par slug', () => {
  deepStrictEqual(candidateIds(['ACoAA1', 'ACoAA1', 'a,b)', '', null, undefined]), ['ACoAA1', 'ab']);
  strictEqual(linkedInSlugOf('https://fr.linkedin.com/in/Ada-Lovelace/?x=1'), 'ada-lovelace');
  strictEqual(linkedInSlugOf('https://www.linkedin.com/company/acme'), null);
  deepStrictEqual(candidateSlugs(['ada-lovelace', 'https://www.linkedin.com/in/Ada-Lovelace', 'a/b', '']), ['ada-lovelace']);
  const row = enrollment('e');
  ok(enrollmentIsInvitee(row, ['ACoAAada'], []));
  ok(enrollmentIsInvitee({ ...row, profile_id: null }, [], ['ada-lovelace']));
  ok(!enrollmentIsInvitee({ ...row, profile_id: null, profile_url: 'https://www.linkedin.com/in/ada-lovelace-2' }, [], ['ada-lovelace']));
  ok(!enrollmentIsInvitee({ ...row, profile_id: null, profile_url: null }, ['x'], ['y']));
});

Deno.test('règle de compte : envoyer et retirer une invitation se font depuis son propre compte', () => {
  const mine = { isInternal: false, userId: 'u1', accountOwnerId: 'u1' };
  const colleague = { isInternal: false, userId: 'u1', accountOwnerId: 'u2' };
  const unowned = { isInternal: false, userId: 'u1', accountOwnerId: null };
  const internal = { isInternal: true, userId: '', accountOwnerId: 'u2' };

  strictEqual(ownerOnlyRefusal('withdraw_invitation', mine), null);
  strictEqual(ownerOnlyRefusal('send_message', mine), null);

  for (const [action, text] of [
    ['withdraw_invitation', "Retirez les invitations depuis votre propre compte."],
    ['send_message', 'Envoyez depuis votre propre compte.'],
  ] as const) {
    for (const ctx of [colleague, unowned]) {
      const refusal = ownerOnlyRefusal(action, ctx)!;
      strictEqual(refusal.status, 403);
      strictEqual(refusal.body.errorType, 'ACCOUNT_NOT_YOURS');
      ok(String(refusal.body.error).endsWith(text), String(refusal.body.error));
      ok(!/unipile/i.test(JSON.stringify(refusal.body)));
    }
  }

  // Appel interne : l'envoi reste permis (cadré par l'appelant), le retrait d'une invitation est un geste de la personne.
  strictEqual(ownerOnlyRefusal('send_message', internal), null);
  const refused = ownerOnlyRefusal('withdraw_invitation', internal)!;
  strictEqual(refused.status, 403);
  strictEqual(refused.body.errorType, 'ACTION_UNAVAILABLE');

  // Les lectures ne sont pas concernées, y compris la liste des invitations d'un compte de l'équipe.
  for (const action of ['list_sent_invitations', 'list_recruiter_projects', 'search_from_url', 'search', 'get_chats']) {
    strictEqual(ownerOnlyRefusal(action, colleague), null, action);
  }
});

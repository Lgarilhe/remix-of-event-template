// Réponse d'un candidat : arrêt de ses autres inscriptions et de ses InMails
// programmés dans l'organisation (SEQ-212), candidat reconnu sous tous ses
// identifiants et son slug public, portée bornée pour un contact déjà clos
// (contrat §8), jamais d'écriture dans une autre organisation (SEQ-006).
//
// Le client Supabase est un faux qui applique eq, in, lt, or (col.in.(…)),
// ilike et update comme la base, sans réseau.
//
//   deno test --no-check supabase/functions/_shared/candidate-reply-closure.test.ts

import { deepStrictEqual as assertEquals, strictEqual } from 'node:assert';
import {
  REPLY_INMAIL_CANCEL_REASON,
  cancelScheduledInMails,
  candidateIds,
  candidateSlugs,
  closeSiblingEnrollments,
  linkedInSlugOf,
  replySiblingScope,
} from './candidate-reply-closure.ts';
import { SIBLING_REPLY_SKIP_REASON } from './sequence-engine-rules.ts';

type Row = Record<string, unknown>;

/** Motif SQL (like / ilike, échappement par antislash) → expression régulière. */
function likeToRegExp(pattern: string, insensitive: boolean): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) source += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (c === '%') source += '.*';
    else if (c === '_') source += '.';
    else source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, insensitive ? 'i' : '');
}

function fakeClient(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const run = () => {
      const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of rows) Object.assign(r, patch);
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const builder = {
      select: () => builder,
      update: (values: Row) => { patch = values; return builder; },
      eq: (col: string, value: unknown) => { filters.push((r) => r[col] === value); return builder; },
      in: (col: string, values: unknown[]) => { filters.push((r) => values.includes(r[col])); return builder; },
      lt: (col: string, value: string) => { filters.push((r) => String(r[col]) < value); return builder; },
      ilike: (col: string, pattern: string) => {
        const re = likeToRegExp(pattern, true);
        filters.push((r) => typeof r[col] === 'string' && re.test(r[col] as string));
        return builder;
      },
      or: (expr: string) => {
        const clauses = [...expr.matchAll(/(\w+)\.in\.\(([^)]*)\)/g)].map((m) => ({ col: m[1], values: m[2].split(',') }));
        filters.push((r) => clauses.some((c) => c.values.includes(r[c.col] as string)));
        return builder;
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve(run()),
    };
    return builder;
  };
  // deno-lint-ignore no-explicit-any
  return { from } as any;
}

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const T0 = '2026-09-20T10:00:00.000Z';
const T1 = '2026-09-25T10:00:00.000Z';

function enrollment(id: string, o: Row = {}): Row {
  return {
    id, organization_id: ORG, status: 'active', profile_id: null, resolved_profile_id: null, provider_id: null,
    profile_url: null, created_at: T0, pause_reason: null, completed_at: null, ...o,
  };
}
function execution(id: string, enrollmentId: string, status: string): Row {
  return { id, enrollment_id: enrollmentId, status, skip_reason: null };
}

// ─── Règles pures ────────────────────────────────────────────────────────────

Deno.test('candidateIds : assainis (aucune échappée du filtre), sans doublon ni vide', () => {
  assertEquals(candidateIds(['ACoAAA1', 'ACoAAA1', null, undefined, '', 'AEMAAA1),organization_id.neq.(x']), [
    'ACoAAA1', 'AEMAAA1organization_idneqx',
  ]);
});

Deno.test('candidateSlugs : URL de profil ou identifiant public brut, en minuscules', () => {
  assertEquals(candidateSlugs([
    'https://www.linkedin.com/in/Jean-Dupont-X/', 'jean-dupont-x', 'https://example.com/jean', null, '', 'a b',
  ]), ['jean-dupont-x']);
  strictEqual(linkedInSlugOf('https://fr.linkedin.com/in/marie-martin?trk=x'), 'marie-martin');
});

Deno.test('replySiblingScope : contact ouvert → tout ; seulement des contacts clos → créés avant la dernière clôture ; sans date → rien', () => {
  assertEquals(replySiblingScope([{ live: false, endedAt: T0 }, { live: true }]), { kind: 'all' });
  assertEquals(replySiblingScope([{ live: false, endedAt: T0 }, { live: false, endedAt: T1 }, { live: false, endedAt: null }]), {
    kind: 'created_before', before: T1,
  });
  assertEquals(replySiblingScope([{ live: false, endedAt: 'pas une date' }]), { kind: 'none' });
  assertEquals(replySiblingScope([]), { kind: 'none' });
});

// ─── Autres inscriptions ─────────────────────────────────────────────────────

Deno.test('closeSiblingEnrollments : identifiants et slug exact, organisation seule, étapes en attente annulées, jamais « sending »', async () => {
  const tables = {
    sequence_enrollments: [
      enrollment('by-provider', { provider_id: 'ACoCAND', status: 'paused', pause_reason: 'manual' }),
      enrollment('by-resolved', { profile_id: 'AEMXX', resolved_profile_id: 'AEMCAND' }),
      enrollment('by-slug', { profile_id: 'AEMZZ', profile_url: 'https://www.linkedin.com/in/jean-dupont/' }),
      enrollment('near-slug', { profile_id: 'AEMYY', profile_url: 'https://www.linkedin.com/in/jean-dupont-4b2a1' }),
      enrollment('handled', { profile_id: 'ACoCAND' }),
      enrollment('closed', { profile_id: 'ACoCAND', status: 'replied' }),
      enrollment('other-org', { profile_id: 'ACoCAND', organization_id: OTHER_ORG }),
    ],
    sequence_step_executions: [
      execution('x1', 'by-provider', 'scheduled'),
      execution('x2', 'by-provider', 'waiting_event'),
      execution('x3', 'by-resolved', 'quota_blocked'),
      execution('x4', 'by-resolved', 'sending'),
      execution('x5', 'other-org', 'scheduled'),
    ],
  };
  const stopped = await closeSiblingEnrollments(
    fakeClient(tables), ORG,
    { ids: ['ACoCAND', 'AEMCAND'], slugs: ['https://www.linkedin.com/in/Jean-Dupont'] },
    new Set(['handled']),
  );
  strictEqual(stopped, 3);
  const status = Object.fromEntries(tables.sequence_enrollments.map((e) => [e.id, [e.status, e.pause_reason]]));
  assertEquals(status, {
    'by-provider': ['stopped', null], 'by-resolved': ['stopped', null], 'by-slug': ['stopped', null],
    'near-slug': ['active', null], handled: ['active', null], closed: ['replied', null], 'other-org': ['active', null],
  });
  const exec = Object.fromEntries(tables.sequence_step_executions.map((x) => [x.id, [x.status, x.skip_reason]]));
  assertEquals(exec, {
    x1: ['cancelled', SIBLING_REPLY_SKIP_REASON], x2: ['cancelled', SIBLING_REPLY_SKIP_REASON],
    x3: ['cancelled', SIBLING_REPLY_SKIP_REASON], x4: ['sending', null], x5: ['scheduled', null],
  });
});

Deno.test('closeSiblingEnrollments : portée « créées avant » respectée, « none » ou sans identité → rien', async () => {
  const tables = {
    sequence_enrollments: [
      enrollment('before', { profile_id: 'ACoCAND', created_at: T0 }),
      enrollment('after', { profile_id: 'ACoCAND', created_at: T1 }),
    ],
    sequence_step_executions: [],
  };
  const client = fakeClient(tables);
  strictEqual(await closeSiblingEnrollments(client, ORG, { ids: ['ACoCAND'] }, new Set(), { kind: 'none' }), 0);
  strictEqual(await closeSiblingEnrollments(client, ORG, { ids: [], slugs: [null] }, new Set()), 0);
  strictEqual(await closeSiblingEnrollments(client, null, { ids: ['ACoCAND'] }, new Set()), 0);
  strictEqual(await closeSiblingEnrollments(client, ORG, { ids: ['ACoCAND'] }, new Set(), { kind: 'created_before', before: '2026-09-22T00:00:00.000Z' }), 1);
  assertEquals(tables.sequence_enrollments.map((e) => e.status), ['stopped', 'active']);
});

// ─── InMails programmés ──────────────────────────────────────────────────────

Deno.test('cancelScheduledInMails : programmés et en attente de l’organisation, jamais envoyés, en cours ni d’une autre organisation', async () => {
  const inmail = (id: string, o: Row) => ({
    id, organization_id: ORG, account_id: 'acc-b', recipient_profile_id: 'AEMCAND', status: 'scheduled', created_at: T0, error_message: null, ...o,
  });
  const tables = {
    inmail_queue: [
      inmail('scheduled', {}),
      inmail('pending', { status: 'pending', recipient_profile_id: 'ACoCAND' }),
      inmail('sending', { status: 'sending' }),
      inmail('sent', { status: 'sent' }),
      inmail('other-candidate', { recipient_profile_id: 'ACoOTHER' }),
      inmail('other-org', { organization_id: OTHER_ORG }),
      inmail('later', { created_at: T1 }),
    ],
  };
  const cancelled = await cancelScheduledInMails(
    fakeClient(tables), { organizationId: ORG }, ['ACoCAND', 'AEMCAND'], { kind: 'created_before', before: '2026-09-22T00:00:00.000Z' },
  );
  strictEqual(cancelled, 2);
  assertEquals(
    Object.fromEntries(tables.inmail_queue.map((r) => [r.id, [r.status, r.error_message]])),
    {
      scheduled: ['cancelled', REPLY_INMAIL_CANCEL_REASON], pending: ['cancelled', REPLY_INMAIL_CANCEL_REASON],
      sending: ['sending', null], sent: ['sent', null], 'other-candidate': ['scheduled', null],
      'other-org': ['scheduled', null], later: ['scheduled', null],
    },
  );
});

Deno.test('cancelScheduledInMails : compte qui reçoit le message, quelle que soit la ligne de l’organisation', async () => {
  const tables = {
    inmail_queue: [
      { id: 'same-account', organization_id: null, account_id: 'acc-a', recipient_profile_id: 'ACoCAND', status: 'scheduled', created_at: T1 },
      { id: 'other-account', organization_id: ORG, account_id: 'acc-b', recipient_profile_id: 'ACoCAND', status: 'scheduled', created_at: T1 },
    ],
  };
  strictEqual(await cancelScheduledInMails(fakeClient(tables), { accountId: 'acc-a' }, ['ACoCAND']), 1);
  assertEquals(tables.inmail_queue.map((r) => r.status), ['cancelled', 'scheduled']);
  strictEqual(await cancelScheduledInMails(fakeClient(tables), { accountId: 'acc-a' }, [null, '']), 0);
});

/**
 * calendly-webhook : annulation (invitee.canceled) et déplacement
 * (invitee.created avec old_invitee) d'un rendez-vous.
 *
 * Le webhook est empaqueté par esbuild et rejoué avec le vrai gestionnaire :
 * signature HMAC comprise, charges utiles à la forme de Calendly (`event` en
 * URI, `scheduled_event` en objet). Seuls le client Supabase (une base en
 * mémoire qui journalise chaque écriture) et les modules serveur sans rapport
 * avec ces deux chemins sont remplacés. Le rejeu contre une vraie base est
 * dans e2e/api/seq-meeting.spec.ts.
 *
 * Lancer : node --test tests/ux/calendly-annulation.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SIGNING_KEY = 'test-signing-key';
const EVENT_NAME = '📅 20 min pour présentation poste - Equipe Konekt';

// ─── Base en mémoire : ce que le webhook appelle sur qualification_sessions ──
const db = { qualification_sessions: [], writes: [] };

class Query {
  constructor(table) {
    this.table = table;
    this.mode = 'select';
    this.patch = null;
    this.filters = [];
    this.described = [];
  }
  select() { return this; }
  update(patch) { this.mode = 'update'; this.patch = patch; return this; }
  eq(col, val) { this.described.push(['eq', col, val]); this.filters.push((r) => r[col] === val); return this; }
  in(col, vals) { this.described.push(['in', col, vals]); this.filters.push((r) => vals.includes(r[col])); return this; }
  is(col, val) { this.described.push(['is', col, val]); this.filters.push((r) => r[col] === val); return this; }
  then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
  run() {
    if (this.table !== 'qualification_sessions') throw new Error(`table inattendue : ${this.table}`);
    const rows = db.qualification_sessions.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === 'update') {
      db.writes.push({ patch: this.patch, filters: this.described });
      rows.forEach((r) => Object.assign(r, this.patch));
      return { data: rows.map((r) => ({ id: r.id })), error: null };
    }
    return { data: rows.map((r) => ({ ...r })), error: null };
  }
}

// ─── Webhook empaqueté ──────────────────────────────────────────────────────
const STUBS = {
  'supabase-js': 'export const createClient = () => globalThis.__fakeSupabase;',
  'candidate-reply-closure': 'export const cancelScheduledInMails = async () => 0; export const MEETING_INMAIL_CANCEL_REASON = "meeting";',
  'candidate-stage-events': 'export const candidateRef = () => ({}); export const recordMeeting = async () => ({ ok: true, data: { rows: [] } }); export const resolveMeetingMission = async () => ({ ok: true, data: null });',
};
const stubName = (path) => (path.startsWith('https://') ? 'supabase-js' : path.match(/candidate-[a-z-]+/)?.[0]);

const { outputFiles } = await build({
  entryPoints: [join(ROOT, 'supabase/functions/calendly-webhook/index.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
  plugins: [{
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /^https:\/\/esm\.sh\// }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onResolve({ filter: /candidate-(reply-closure|stage-events)/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[stubName(a.path)], loader: 'js' }));
    },
  }],
});

let handler;
globalThis.Deno = {
  env: { get: (k) => ({ SUPABASE_URL: 'http://localhost', SB_SECRET_KEY: 'service', CALENDLY_WEBHOOK_SIGNING_KEY: SIGNING_KEY })[k] },
  serve: (h) => { handler = h; },
};
globalThis.__fakeSupabase = { from: (table) => new Query(table) };
await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
assert.equal(typeof handler, 'function', 'le webhook enregistre son gestionnaire');

async function post(body, { signed = true } = {}) {
  const raw = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const headers = { 'Content-Type': 'application/json' };
  if (signed) headers['Calendly-Webhook-Signature'] = `t=${t},v1=${createHmac('sha256', SIGNING_KEY).update(`${t}.${raw}`).digest('hex')}`;
  const log = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try {
    const res = await handler(new Request('http://localhost/calendly-webhook', { method: 'POST', headers, body: raw }));
    return { status: res.status, body: await res.json() };
  } finally {
    Object.assign(console, log);
  }
}

// ─── Fixtures ───────────────────────────────────────────────────────────────
const eventUri = (ev) => `https://api.calendly.com/scheduled_events/${ev}`;
const inviteeUri = (ev, inv) => `${eventUri(ev)}/invitees/${inv}`;

function session(over = {}) {
  return {
    id: 's1',
    organization_id: 'org-a',
    calendly_event_id: 'EV1',
    calendly_invitee_id: 'INV1',
    status: 'scheduled',
    event_start_at: '2026-10-12T09:00:00.000000Z',
    event_end_at: '2026-10-12T09:20:00.000000Z',
    event_location: 'https://meet.example.org/old',
    ...over,
  };
}
const seed = (...rows) => {
  db.qualification_sessions = rows;
  db.writes = [];
};
const row = (id) => db.qualification_sessions.find((r) => r.id === id);

const canceled = (ev, inv, over = {}) => ({
  event: 'invitee.canceled',
  payload: {
    uri: inviteeUri(ev, inv),
    event: eventUri(ev),
    scheduled_event: { uri: eventUri(ev), name: EVENT_NAME, status: 'canceled' },
    status: 'canceled',
    rescheduled: false,
    new_invitee: null,
    ...over,
  },
});

const rescheduledCreated = (oldEv, oldInv, newEv, newInv, over = {}) => ({
  event: 'invitee.created',
  payload: {
    uri: inviteeUri(newEv, newInv),
    event: eventUri(newEv),
    old_invitee: inviteeUri(oldEv, oldInv),
    rescheduled: true,
    scheduled_event: {
      uri: eventUri(newEv),
      name: EVENT_NAME,
      start_time: '2026-10-14T14:00:00.000000Z',
      end_time: '2026-10-14T14:20:00.000000Z',
      location: { type: 'zoom', join_url: 'https://zoom.example.org/new' },
    },
    ...over,
  },
});

// ─── Annulation ─────────────────────────────────────────────────────────────
test('une livraison sans signature valide est refusée, aucune séance ne bouge', async () => {
  seed(session());
  const res = await post(canceled('EV1', 'INV1'), { signed: false });
  assert.equal(res.status, 401);
  assert.equal(row('s1').status, 'scheduled');
  assert.deepEqual(db.writes, []);
});

test('invitee.canceled : la séance de l’invité passe à « cancelled », pas celles des autres invités ni des autres organisations', async () => {
  seed(
    session(),
    session({ id: 's-other-invitee', calendly_invitee_id: 'INV2' }),
    session({ id: 's-other-org', organization_id: 'org-b', calendly_event_id: 'EV9', calendly_invitee_id: 'INV9' }),
  );
  const res = await post(canceled('EV1', 'INV1'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { success: true, sessions_cancelled: 1 });
  assert.equal(row('s1').status, 'cancelled');
  assert.equal(row('s-other-invitee').status, 'scheduled', 'autre invité du même événement');
  assert.equal(row('s-other-org').status, 'scheduled', 'autre organisation');
});

test('l’écriture est filtrée par l’organisation de la séance et par statut ouvert', async () => {
  seed(session());
  await post(canceled('EV1', 'INV1'));
  assert.equal(db.writes.length, 1);
  const { patch, filters } = db.writes[0];
  assert.deepEqual(patch, { status: 'cancelled' });
  assert.deepEqual(filters, [
    ['eq', 'id', 's1'],
    ['eq', 'organization_id', 'org-a'],
    ['in', 'status', ['scheduled', 'in_progress']],
  ]);
});

test('une séance « in_progress » est annulée ; « completed » et « cancelled » ne changent pas', async () => {
  seed(
    session({ id: 'a', calendly_invitee_id: 'A', status: 'in_progress' }),
    session({ id: 'b', calendly_invitee_id: 'B', status: 'completed' }),
    session({ id: 'c', calendly_invitee_id: 'C', status: 'cancelled' }),
  );
  assert.equal((await post(canceled('EV1', 'A'))).body.sessions_cancelled, 1);
  assert.equal((await post(canceled('EV1', 'B'))).body.sessions_cancelled, 0);
  assert.equal((await post(canceled('EV1', 'C'))).body.sessions_cancelled, 0);
  assert.deepEqual(['a', 'b', 'c'].map((id) => row(id).status), ['cancelled', 'completed', 'cancelled']);
});

test('l’annulation d’un déplacement (rescheduled: true) n’annule pas la séance', async () => {
  seed(session());
  const res = await post(canceled('EV1', 'INV1', { rescheduled: true, new_invitee: inviteeUri('EV2', 'INV2') }));
  assert.equal(res.body.reason, 'rescheduled');
  assert.equal(row('s1').status, 'scheduled');
  assert.deepEqual(db.writes, []);
});

test('invitee.canceled sans séance connue ou sans identifiant d’invité : ignoré', async () => {
  seed(session());
  assert.equal((await post(canceled('EV1', 'INCONNU'))).body.reason, 'session_not_found');
  const noUri = canceled('EV1', 'INV1');
  delete noUri.payload.uri;
  assert.equal((await post(noUri)).body.reason, 'invitee_unknown');
  assert.equal(row('s1').status, 'scheduled');
});

test('repli par l’événement : seulement une séance sans identifiant d’invité, jamais celle d’un autre invité', async () => {
  seed(
    session({ id: 'legacy', calendly_event_id: 'EV7', calendly_invitee_id: null }),
    session({ id: 'group', calendly_event_id: 'EV7', calendly_invitee_id: 'INV-GROUP' }),
  );
  const res = await post(canceled('EV7', 'INV-ABSENT'));
  assert.equal(res.body.sessions_cancelled, 1);
  assert.equal(row('legacy').status, 'cancelled');
  assert.equal(row('group').status, 'scheduled');
});

test('une séance sans organisation n’est jamais modifiée', async () => {
  seed(session({ organization_id: null }));
  const res = await post(canceled('EV1', 'INV1'));
  assert.equal(res.body.sessions_cancelled, 0);
  assert.equal(row('s1').status, 'scheduled');
  assert.deepEqual(db.writes, []);
});

// ─── Déplacement ────────────────────────────────────────────────────────────
test('invitee.created avec old_invitee : la séance existante prend le nouvel événement, les nouvelles heures et le nouveau lien, sans seconde séance', async () => {
  seed(session());
  const res = await post(rescheduledCreated('EV1', 'INV1', 'EV2', 'INV2'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { success: true, rescheduled: true, sessions_updated: 1 });
  assert.equal(db.qualification_sessions.length, 1, 'pas de seconde séance');
  assert.deepEqual(
    { ...row('s1') },
    session({
      calendly_event_id: 'EV2',
      calendly_invitee_id: 'INV2',
      event_start_at: '2026-10-14T14:00:00.000000Z',
      event_end_at: '2026-10-14T14:20:00.000000Z',
      event_location: 'https://zoom.example.org/new',
    }),
  );
  assert.deepEqual(db.writes[0].filters.slice(0, 2), [['eq', 'id', 's1'], ['eq', 'organization_id', 'org-a']]);
});

test('le déplacement ne change pas le statut (séance déjà entamée gardée), quel que soit l’ordre des deux événements', async () => {
  seed(session({ status: 'in_progress' }));
  // invitee.canceled (rescheduled) d'abord, puis invitee.created.
  await post(canceled('EV1', 'INV1', { rescheduled: true, new_invitee: inviteeUri('EV2', 'INV2') }));
  await post(rescheduledCreated('EV1', 'INV1', 'EV2', 'INV2'));
  assert.equal(row('s1').status, 'in_progress');
  assert.equal(row('s1').event_start_at, '2026-10-14T14:00:00.000000Z');
  // invitee.created d'abord, puis invitee.canceled de l'ancienne réservation : l'ancien invité n'existe plus.
  seed(session());
  await post(rescheduledCreated('EV1', 'INV1', 'EV2', 'INV2'));
  const late = await post(canceled('EV1', 'INV1', { rescheduled: true, new_invitee: inviteeUri('EV2', 'INV2') }));
  assert.equal(late.body.reason, 'rescheduled');
  assert.equal(row('s1').status, 'scheduled');
  assert.equal(row('s1').calendly_invitee_id, 'INV2');
});

test('rejeu du même invitee.created de déplacement : rien à refaire, toujours une seule séance', async () => {
  seed(session());
  await post(rescheduledCreated('EV1', 'INV1', 'EV2', 'INV2'));
  const writesAfterFirst = db.writes.length;
  const replay = await post(rescheduledCreated('EV1', 'INV1', 'EV2', 'INV2'));
  assert.deepEqual(replay.body, { success: true, rescheduled: true, sessions_updated: 0 });
  assert.equal(db.writes.length, writesAfterFirst, 'aucune écriture au rejeu');
  assert.equal(db.qualification_sessions.length, 1);
});

test('annuler la réservation déplacée annule la même séance (elle porte le nouvel invité)', async () => {
  seed(session());
  await post(rescheduledCreated('EV1', 'INV1', 'EV2', 'INV2'));
  const res = await post(canceled('EV2', 'INV2'));
  assert.equal(res.body.sessions_cancelled, 1);
  assert.equal(row('s1').status, 'cancelled');
});

test('old_invitee inconnu : le déplacement n’est pas traité, le parcours de création reprend la main', async () => {
  seed(session());
  // Nom d'événement différent : le parcours normal l'écarte avant tout accès à la base.
  const res = await post(rescheduledCreated('EVX', 'INV-INCONNU', 'EV2', 'INV2', { scheduled_event: { uri: eventUri('EV2'), name: 'Autre type', start_time: '2026-10-14T14:00:00Z' } }));
  assert.equal(res.body.reason, 'event_type_mismatch');
  assert.equal(row('s1').calendly_invitee_id, 'INV1');
  assert.deepEqual(db.writes, []);
});

test('une réservation sans old_invitee ne touche à aucune séance existante', async () => {
  seed(session());
  const body = rescheduledCreated('EV1', 'INV1', 'EV2', 'INV2');
  delete body.payload.old_invitee;
  body.payload.scheduled_event.name = 'Autre type';
  const res = await post(body);
  assert.equal(res.body.reason, 'event_type_mismatch');
  assert.equal(row('s1').calendly_invitee_id, 'INV1');
  assert.deepEqual(db.writes, []);
});

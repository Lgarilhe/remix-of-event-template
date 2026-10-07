/**
 * Agenda Outlook (lot I3), demande A : l'effacement RGPD d'un candidat
 * supprime ses séances de qualification (rendez-vous lus dans un agenda ou
 * pris par Calendly) et les extraits de connaissance qui en sont tirés.
 *
 * recordGdprErasure est empaqueté par esbuild et rejoué sur une base en
 * mémoire : les séances et les extraits sont de vraies lignes, filtrées par
 * eq, in et ilike (jokers LIKE compris) ; les autres tables sont vides. Le
 * garde statique est dans tests/c1/agenda-base.test.mjs, la forme SQL dans
 * supabase/tests/calendar_accounts_audit.sql.
 *
 * Lancer : node --test tests/ux/agenda-rgpd-seances.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const { outputFiles } = await build({
  entryPoints: [join(ROOT, 'supabase/functions/_shared/get-or-fetch-contact.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { recordGdprErasure } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);

const escapeRe = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Motif LIKE de PostgreSQL (« \ » protège le caractère suivant), insensible à la casse.
function likeToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) re += escapeRe(pattern[(i += 1)]);
    else if (ch === '%') re += '.*';
    else if (ch === '_') re += '.';
    else re += escapeRe(ch);
  }
  return new RegExp(`^${re}$`, 'i');
}

function makeDb() {
  const db = {
    tables: {
      qualification_sessions: [
        // Trouvée par l'identifiant du candidat (son slug LinkedIn).
        { id: 's1', organization_id: 'org-1', candidate_profile_id: 'jean-dupont', candidate_linkedin_url: null, invitee_email: null },
        // Trouvée par l'adresse de son profil, casse et barre finale comprises.
        { id: 's2', organization_id: 'org-1', candidate_profile_id: 'ACoZZ', candidate_linkedin_url: 'https://www.linkedin.com/in/Jean-Dupont/', invitee_email: null },
        // Trouvée par l'adresse e-mail de l'invité, casse comprise.
        { id: 's3', organization_id: 'org-1', candidate_profile_id: null, candidate_linkedin_url: null, invitee_email: 'Jean@X.fr' },
        // Même invité, autre organisation.
        { id: 's4', organization_id: 'org-2', candidate_profile_id: null, candidate_linkedin_url: null, invitee_email: 'jean@x.fr' },
        // Autre personne, même organisation : adresse voisine (le « _ » du motif n'est pas un joker).
        { id: 's5', organization_id: 'org-1', candidate_profile_id: 'autre', candidate_linkedin_url: 'https://www.linkedin.com/in/jean-dupont-2', invitee_email: 'jeanXx.fr' },
      ],
      knowledge_chunks: [
        { id: 'c1', organization_id: 'org-1', source_table: 'qualification_sessions', source_id: 's1' },
        { id: 'c2', organization_id: 'org-1', source_table: 'qualification_sessions', source_id: 's3' },
        { id: 'c3', organization_id: 'org-2', source_table: 'qualification_sessions', source_id: 's4' },
        { id: 'c4', organization_id: 'org-1', source_table: 'qualification_sessions', source_id: 's5' },
        { id: 'c5', organization_id: 'org-1', source_table: 'job_candidate_status', source_id: 's1' },
      ],
    },
    log: [],
    failDelete: null,
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.returning = false;
      this.filters = [];
      this.eqs = {};
      this.ins = {};
    }
    select() { if (this.op === 'delete') this.returning = true; return this.self; }
    delete() { this.op = 'delete'; return this.self; }
    eq(col, val) { this.eqs[col] = val; this.filters.push((r) => r[col] === val); return this.self; }
    in(col, vals) { this.ins[col] = vals; this.filters.push((r) => vals.includes(r[col])); return this.self; }
    ilike(col, pattern) {
      const re = likeToRegExp(pattern);
      this.filters.push((r) => typeof r[col] === 'string' && re.test(r[col]));
      return this.self;
    }
    then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
    run() {
      const rows = db.tables[this.table];
      if (!rows) return { data: [], error: null };
      db.log.push({ table: this.table, op: this.op, eqs: this.eqs, ins: this.ins });
      if (this.op === 'delete' && db.failDelete === this.table) {
        return { data: null, error: { message: 'échec simulé' } };
      }
      const matched = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === 'delete') {
        db.tables[this.table] = rows.filter((r) => !matched.includes(r));
        return { data: this.returning ? matched.map((r) => ({ id: r.id })) : null, error: null };
      }
      return { data: matched.map((r) => ({ ...r })), error: null };
    }
  }

  // Les méthodes que les tests n'observent pas (update, upsert, limit, not, ...) rendent la requête.
  const client = {
    from: (table) => {
      const q = new Query(table);
      const proxy = new Proxy(q, {
        get(target, prop) {
          if (prop in target) return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
          return () => proxy;
        },
      });
      q.self = proxy;
      return proxy;
    },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    rpc: async () => ({ data: null, error: null }),
  };
  return { db, client };
}

const ids = (rows) => rows.map((r) => r.id);
const input = { email: 'jean@x.fr', linkedinUrl: 'https://www.linkedin.com/in/jean-dupont', source: 'test' };

test('séances : effacement limité à une organisation, séances et extraits du candidat supprimés', async () => {
  const { db, client } = makeDb();
  const result = await recordGdprErasure(client, { ...input, organizationId: 'org-1' });
  assert.equal(result.success, true, result.error);
  assert.equal(result.deletedSessions, 3);
  // s1 (identifiant), s2 (adresse du profil), s3 (e-mail) partent ; l'autre organisation et l'autre personne restent.
  assert.deepEqual(ids(db.tables.qualification_sessions), ['s4', 's5']);
  // Extraits de ces séances supprimés ; ceux d'une autre organisation, d'une autre séance ou d'une autre table restent.
  assert.deepEqual(ids(db.tables.knowledge_chunks), ['c3', 'c4', 'c5']);
  // Toute requête sur ces deux tables reste dans l'organisation de l'effacement.
  const touched = db.log.filter((q) => q.table === 'qualification_sessions' || q.table === 'knowledge_chunks');
  assert.ok(touched.length >= 6);
  for (const q of touched) assert.equal(q.eqs.organization_id, 'org-1', `${q.table} ${q.op}`);
  // Les extraits partent avant les séances.
  const firstChunkDelete = db.log.findIndex((q) => q.table === 'knowledge_chunks' && q.op === 'delete');
  const firstSessionDelete = db.log.findIndex((q) => q.table === 'qualification_sessions' && q.op === 'delete');
  assert.ok(firstChunkDelete >= 0 && firstSessionDelete > firstChunkDelete);
});

test('séances : effacement global (administrateur de la plateforme), toutes organisations', async () => {
  const { db, client } = makeDb();
  const result = await recordGdprErasure(client, { ...input, organizationId: null });
  assert.equal(result.success, true, result.error);
  assert.equal(result.deletedSessions, 4);
  assert.deepEqual(ids(db.tables.qualification_sessions), ['s5']);
  assert.deepEqual(ids(db.tables.knowledge_chunks), ['c4', 'c5']);
  const sessionReads = db.log.filter((q) => q.table === 'qualification_sessions' && q.op === 'select');
  // Un lot d'identifiants, les deux formes de l'adresse du profil (avec et sans barre finale), l'adresse e-mail.
  assert.equal(sessionReads.length, 4);
  for (const q of sessionReads) assert.equal(q.eqs.organization_id, undefined);
});

test('séances : aucune séance du candidat, rien n\'est supprimé', async () => {
  const { db, client } = makeDb();
  const result = await recordGdprErasure(client, {
    email: 'inconnu@y.fr',
    linkedinUrl: 'https://www.linkedin.com/in/personne-inconnue',
    source: 'test',
    organizationId: 'org-1',
  });
  assert.equal(result.success, true, result.error);
  assert.equal(result.deletedSessions, 0);
  assert.equal(db.tables.qualification_sessions.length, 5);
  assert.equal(db.tables.knowledge_chunks.length, 5);
  assert.equal(db.log.filter((q) => q.op === 'delete').length, 0);
});

test('séances : un échec de suppression arrête l\'effacement, la reprise retrouve les séances', async () => {
  const { db, client } = makeDb();
  db.failDelete = 'qualification_sessions';
  const failed = await recordGdprErasure(client, { ...input, organizationId: 'org-1' });
  assert.equal(failed.success, false);
  assert.match(failed.error, /^suppression des séances: échec simulé/);
  assert.deepEqual(ids(db.tables.qualification_sessions), ['s1', 's2', 's3', 's4', 's5']);

  db.failDelete = null;
  const retry = await recordGdprErasure(client, { ...input, organizationId: 'org-1' });
  assert.equal(retry.success, true, retry.error);
  assert.equal(retry.deletedSessions, 3);
  assert.deepEqual(ids(db.tables.qualification_sessions), ['s4', 's5']);
});

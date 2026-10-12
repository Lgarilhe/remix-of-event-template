/**
 * Page cachée « Bascule de la connexion » (/settings/admin/bascule, administrateurs de la plateforme).
 *
 * - textes (basculeCopy.ts) : aucun nom de prestataire, vouvoiement, pas de tiret cadratin ni de mot
 *   de remplissage, le mot de confirmation BASCULER ;
 * - lectures et appels (basculeApi.ts, appel injecté, sans réseau) : accès accordé / refusé (403,
 *   sans erreur affichée), échec partiel rendu comme résultat, réponse perdue, forme inconnue ;
 * - garde statique : confirmation à saisir avant toute conversion, annulation derrière sa propre
 *   confirmation, états chargement / erreur / vide, aucun toast sur le refus ;
 * - la page n'est dans aucune navigation : route seule dans App.tsx, absente du registre des
 *   Paramètres, de la barre latérale et de la palette.
 *
 * Lancer : node --test tests/ux/admin-bascule.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, read, ROOT, stripComments } from './connexion-helpers.mjs';

const copy = await loadTs('src/components/settings/admin/basculeCopy.ts');
const api = await loadTs('src/components/settings/admin/basculeApi.ts');

const ADMIN_DIR = 'src/components/settings/admin';
const OWNED = [
  ...readdirSync(join(ROOT, ADMIN_DIR)).map((name) => `${ADMIN_DIR}/${name}`),
  'src/pages/AdminBascule.tsx',
];
const SRC = Object.fromEntries(OWNED.map((rel) => [rel, read(rel)]));
const CODE = Object.fromEntries(Object.entries(SRC).map(([rel, src]) => [rel, stripComments(src)]));

const VENDOR = /uni\s*pile|apollo|people data labs|\bpdl\b|anthropic|resend/i;
const FILLER = /\b(crucial|crucia|essentiel|essentielle|robuste|riche|fluide|puissant|innovant|explorer|naviguer|garantir|veiller à)\b/i;

/** Toutes les phrases que la copie peut rendre (valeurs, fonctions appelées avec quelques entrées). */
function allCopyStrings() {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') {
      for (const args of [[0], [1], [2], [1, 12], [3, 1], [2, 5, 7], ['abcd-1234']]) {
        try {
          const r = v(...args);
          if (Array.isArray(r) || typeof r === 'string' || (r && typeof r === 'object')) walk(r);
        } catch { /* signature différente */ }
      }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const [name, value] of Object.entries(copy)) {
    if (name === 'mentionsVendor') continue;
    walk(value);
  }
  out.push(copy.readinessCounts({ ok: 7, warn: 2, ko: 1 }), copy.checkedAtText('2026-10-12T10:30:00Z'));
  out.push(copy.previewSummary({ total: 10, already: 2, toConvert: 6, unmapped: 2 }), copy.rowsText(1), copy.rowsText(4));
  out.push(copy.errorText('unmapped_accounts', null), copy.errorText(null, null));
  return out.filter((s) => typeof s === 'string' && s !== '');
}

// ------------------------------------------------------------------ textes
test('la copie ne nomme aucun prestataire et ne cite pas de variable d’environnement', () => {
  const strings = allCopyStrings();
  assert.ok(strings.length > 80, `copie lue : ${strings.length} phrases`);
  for (const s of strings) {
    assert.ok(!VENDOR.test(s), `nom de prestataire dans : ${s}`);
    assert.ok(!/UNIPILE|_API_KEY|KONEKT_PLATFORM/.test(s), `variable dans : ${s}`);
  }
});

test('la copie : vouvoiement, pas de tiret cadratin, pas de mot de remplissage, pas d’emoji', () => {
  for (const s of allCopyStrings()) {
    assert.ok(!/[—–]/.test(s), `tiret long dans : ${s}`);
    assert.ok(!FILLER.test(s), `mot de remplissage dans : ${s}`);
    assert.ok(!/\b(tu|ton|ta|tes|toi|tes)\b/i.test(s), `tutoiement dans : ${s}`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(s), `emoji dans : ${s}`);
  }
});

test('le mot de confirmation est BASCULER et la phrase le dit', () => {
  assert.equal(copy.CONFIRM_WORD, 'BASCULER');
  assert.ok(copy.APPLY.typeLabel.includes('BASCULER'));
  assert.equal(copy.APPLY.typePlaceholder, 'BASCULER');
});

test('l’annulation d’un lot a son propre mot, ANNULER, dit par la phrase', () => {
  assert.equal(copy.ROLLBACK_CONFIRM_WORD, 'ANNULER');
  assert.ok(copy.ROLLBACK.typeLabel.includes('ANNULER'));
  assert.equal(copy.ROLLBACK.typePlaceholder, 'ANNULER');
  assert.ok(copy.ERROR_BY_CODE.rollback_confirmation_required.includes('ANNULER'));
});

test('le mot « paire » n’est jamais montré : les textes parlent de comptes', () => {
  for (const s of allCopyStrings()) assert.ok(!/\bpaires?\b/i.test(s), `« paire » dans : ${s}`);
  assert.equal(copy.APPLY.summary(4, 12), '4 comptes convertis, 12 lignes réécrites.');
  assert.equal(copy.BATCHES.pairs(1), '1 compte');
  assert.match(copy.APPLY.dialogLines(2, 3).join(' '), /Chaque compte est traité séparément/);
});

test('le dialogue de conversion rappelle de mettre les envois en pause (pas de double identifiant)', () => {
  assert.match(copy.APPLY.dialogLines(1, 1).join(' '), /mettez les envois automatiques en pause/);
});

test('les textes du serveur prennent les apostrophes de la page', () => {
  assert.equal(copy.shownText('L\'adresse n\'est pas valide.', 'repli'), 'L’adresse n’est pas valide.');
  assert.equal(copy.shownText("'quoted'", 'repli'), "'quoted'");
});

test('le titre de la page de refus est « Accès réservé »', () => {
  assert.equal(copy.DENIED.title, 'Accès réservé');
});

test('les trois boutons portent les libellés demandés', () => {
  assert.equal(copy.READINESS.button, 'Vérifier');
  assert.equal(copy.PREVIEW.button, 'Simuler la conversion des comptes');
  assert.equal(copy.APPLY.button, 'Convertir les comptes');
  assert.equal(copy.BATCHES.rollbackButton, 'Annuler la conversion');
});

test('shownText écarte un texte du serveur qui nomme le prestataire', () => {
  const vendor = ['Uni', 'pile'].join('');
  assert.equal(copy.shownText(`${vendor} a répondu.`, 'repli'), 'repli');
  assert.equal(copy.shownText('  Le service ne répond pas.  ', 'repli'), 'Le service ne répond pas.');
  assert.equal(copy.shownText(null, 'repli'), 'repli');
  assert.equal(copy.shownText('', 'repli'), 'repli');
});

test('errorText : le code prime sur un texte du serveur réécrit par le navigateur', () => {
  assert.equal(copy.errorText('list_truncated', 'Erreur serveur temporaire.'), copy.ERROR_BY_CODE.list_truncated);
  assert.equal(copy.errorText('code_inconnu', 'Phrase du serveur.'), 'Phrase du serveur.');
  assert.equal(copy.errorText(null, undefined), copy.GENERIC_ERROR);
});

test('shortRef ne rend que la fin d’un identifiant', () => {
  assert.equal(copy.shortRef('v1-account-abcdef1234'), '…1234');
  assert.equal(copy.shortRef(''), '…');
  assert.equal(copy.shortRef(null), '…');
});

// ------------------------------------------------------------------ appels
const ok = (data) => async () => ({ data, error: null });
const httpError = (status, data) => async () => ({
  data: { ...data, success: false, error: 'Accès refusé. Vous n’avez pas les permissions nécessaires.' },
  error: Object.assign(new Error('Accès refusé.'), { status, code: data?.error_code }),
});

test('accès : administrateur accordé, 403 = refusé sans message d’erreur à montrer', async () => {
  const granted = await api.checkAccess(ok({ success: true }));
  assert.equal(granted.ok, true);
  const denied = await api.checkAccess(httpError(403, { error_code: 'admin_only' }));
  assert.equal(denied.ok, false);
  assert.equal(denied.denied, true);
  assert.equal(denied.message, copy.DENIED.body);
  // 403 sans code métier : même résultat.
  const bare = await api.checkAccess(httpError(403, {}));
  assert.equal(bare.denied, true);
});

test('accès : une panne (500, réseau, réponse de forme inconnue) n’est pas un refus', async () => {
  const server = await api.checkAccess(httpError(500, { error_code: 'server' }));
  assert.equal(server.ok, false);
  assert.equal(server.denied, false);
  const network = await api.checkAccess(async () => ({ data: { success: false, error: 'Problème de connexion réseau.' }, error: new Error('réseau') }));
  assert.equal(network.denied, false);
  assert.equal(network.lost, true);
  const thrown = await api.checkAccess(async () => { throw new Error('boom'); });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.lost, true);
  const odd = await api.checkAccess(ok({ foo: 1 }));
  assert.equal(odd.ok, false);
  assert.equal(odd.message, copy.UNEXPECTED_ANSWER);
});

const READINESS = {
  success: true,
  checks: [
    { id: 'api_key', label: 'Clé API du service de connexion (V2)', status: 'ok', detail: 'La clé est configurée.' },
    { id: 'webhook_endpoint', label: 'Notifications', status: 'ko', detail: 'Il manque 2 événements sur 9 : a, b.' },
    {
      id: 'accounts_mapping', label: 'Comptes', status: 'warn', detail: '5 comptes en base.',
      data: { unmapped: [{ kind: 'linkedin', label: 'P***', ref: '…1234', reason: 'not_in_service' }], unmapped_truncated: false },
    },
  ],
  summary: { ok: 1, warn: 1, ko: 1, ready: false },
  generated_at: '2026-10-12T10:30:00.000Z',
};

test('vérification : lignes, statut, détail et comptes sans correspondance lus', async () => {
  const result = await api.fetchReadiness(ok(READINESS));
  assert.equal(result.ok, true);
  const { checks, summary } = result.value;
  assert.equal(checks.length, 3);
  assert.equal(checks[1].status, 'ko');
  assert.equal(checks[2].unmapped[0].ref, '…1234');
  assert.equal(summary.ready, false);
  assert.equal(copy.STATUS_LABEL[checks[0].status], 'OK');
  assert.equal(copy.STATUS_BADGE.ko, 'danger');
});

test('vérification : un statut inconnu rend la réponse inattendue, jamais une liste vide', async () => {
  const bad = await api.fetchReadiness(ok({ ...READINESS, checks: [{ id: 'x', label: 'x', status: 'maybe', detail: '' }] }));
  assert.equal(bad.ok, false);
  assert.equal(bad.message, copy.UNEXPECTED_ANSWER);
  const none = await api.fetchReadiness(ok({ success: true }));
  assert.equal(none.ok, false);
});

test('vérification : un texte du serveur qui nomme le prestataire est remplacé', async () => {
  const vendor = ['Uni', 'pile'].join('');
  const result = await api.fetchReadiness(ok({
    ...READINESS,
    checks: [{ id: 'x', label: `Clé ${vendor}`, status: 'ok', detail: `${vendor} répond.` }],
  }));
  assert.equal(result.ok, true);
  assert.ok(!VENDOR.test(result.value.checks[0].label));
  assert.ok(!VENDOR.test(result.value.checks[0].detail));
});

const PREVIEW = {
  success: true,
  counts: {
    all: { total: 4, already_v2: 1, via_v1_account_id: 1, via_email: 1, unmapped: 1 },
    linkedin: { total: 2, already_v2: 0, via_v1_account_id: 1, via_email: 0, unmapped: 1 },
    email: { total: 2, already_v2: 1, via_v1_account_id: 0, via_email: 1, unmapped: 0 },
    whatsapp: { total: 0, already_v2: 0, via_v1_account_id: 0, via_email: 0, unmapped: 0 },
  },
  shared_targets: 0,
  service_accounts: 3,
  truncated: false,
  pairs: [
    { kind: 'linkedin', via: 'v1_account_id', label: 'J*** D***', ref: '…li-1', total_rows: 12, usage: [], usage_error: false, notes: ['Une note.'] },
    { kind: 'email', via: 'email', label: 's***@cabinet.fr', ref: 'il-1', total_rows: 3, usage: [], usage_error: true, notes: [] },
  ],
  plan_fingerprint: 'a'.repeat(64),
  orphans: [
    { table: 'linkedin_action_log', column: 'account_id', ref: '…0042', rows: 5 },
    { table: 'inmail_queue', column: 'account_id', ref: '…0042', rows: 2 },
  ],
  orphans_truncated: true,
  orphans_error: false,
  unmapped: [{ kind: 'linkedin', label: 'P*** P***', ref: '…rdu', reason: 'ambiguous' }],
  unmapped_truncated: false,
  already_v2: 1,
  previous_batches: [
    { batch_id: '33333333-3333-4333-8333-333333333333', pairs: 2, applied_at: '2026-10-11T09:00:00Z', rolled_back: false },
    { batch_id: '44444444-4444-4444-8444-444444444444', pairs: 1, applied_at: '2026-10-10T09:00:00Z', rolled_back: true },
  ],
  previous_batches_error: false,
};

test('simulation : effectifs, paires (libellés masqués), comptes sans correspondance, lots précédents', async () => {
  const result = await api.fetchPreview(ok(PREVIEW));
  assert.equal(result.ok, true);
  const p = result.value;
  assert.equal(p.counts.all.total, 4);
  assert.equal(p.pairs.length, 2);
  assert.equal(p.pairs[0].totalRows, 12);
  assert.equal(p.pairs[1].usageError, true);
  assert.equal(p.unmapped[0].reason, 'ambiguous');
  assert.equal(p.batches.length, 2);
  assert.equal(p.batches[1].rolledBack, true);
  // Jamais l'identifiant entier dans l'état lu.
  assert.ok(!JSON.stringify(p).includes('v1-li-1'));
  assert.ok(!JSON.stringify(p).includes('acc_1'));
  // L'empreinte du plan est gardée pour la conversion ; les anciens identifiants sans compte sont lus.
  assert.equal(p.planFingerprint, 'a'.repeat(64));
  assert.deepEqual(p.orphans[0], { table: 'linkedin_action_log', column: 'account_id', ref: '…0042', rows: 5 });
  assert.equal(p.orphans.length, 2);
  assert.equal(p.orphansTruncated, true);
  assert.equal(p.orphansError, false);
});

test('simulation : sans anciens identifiants isolés ni erreur, rien n’est inventé', async () => {
  const bare = { ...PREVIEW };
  delete bare.orphans; delete bare.orphans_truncated; delete bare.orphans_error; delete bare.plan_fingerprint;
  const result = await api.fetchPreview(ok(bare));
  assert.deepEqual(result.value.orphans, []);
  assert.equal(result.value.orphansError, false);
  assert.equal(result.value.planFingerprint, '');
  const failed = await api.fetchPreview(ok({ ...PREVIEW, orphans: [], orphans_error: true }));
  assert.equal(failed.value.orphansError, true);
});

test('simulation : clé absente (409) et service muet (503) donnent la phrase du code', async () => {
  const key = await api.fetchPreview(httpError(409, { error_code: 'key_missing' }));
  assert.equal(key.ok, false);
  assert.equal(key.message, copy.ERROR_BY_CODE.key_missing);
  const down = await api.fetchPreview(httpError(503, { error_code: 'service_unreachable' }));
  assert.equal(down.message, copy.ERROR_BY_CODE.service_unreachable);
});

test('conversion : la confirmation et le choix des comptes sans correspondance partent dans le corps', async () => {
  let sent = null;
  const done = { success: true, batch_id: 'b', applied: 0, failed: 0, rows_total: 0, remaining: 0, incomplete: false, unmapped_left: 0, results: [] };
  await api.applyRemap(async (body) => { sent = body; return { data: done, error: null }; }, 'BASCULER', true, 'f'.repeat(64));
  // L'empreinte de la simulation part avec la conversion : le serveur refuse si les comptes ont changé.
  assert.deepEqual(sent, { action: 'remap_apply', confirm: 'BASCULER', allow_unmapped: true, plan_fingerprint: 'f'.repeat(64) });
});

test('conversion : un échec partiel (200, success false) est un résultat avec son numéro de lot', async () => {
  const data = {
    success: false, error_code: 'partial_failure', error: '1 paire en échec', batch_id: '33333333-3333-4333-8333-333333333333',
    applied: 2, failed: 1, rows_total: 15, remaining: 0, incomplete: false, unmapped_left: 1,
    results: [
      { kind: 'linkedin', label: 'J*** D***', ref: '…li-1', status: 'applied', rows: 12 },
      { kind: 'email', label: 's***@cabinet.fr', ref: 'il-1', status: 'applied', rows: 3 },
      { kind: 'linkedin', label: 'C*** M***', ref: '…cdef', status: 'failed', error_code: 'conflict', error: 'Le nouvel identifiant est déjà utilisé.' },
    ],
  };
  const result = await api.applyRemap(ok(data), 'BASCULER', false, 'f'.repeat(64));
  assert.equal(result.ok, true);
  const v = result.value;
  assert.equal(v.batchId, data.batch_id);
  assert.equal(v.applied, 2);
  assert.equal(v.failed, 1);
  assert.equal(v.rowsTotal, 15);
  assert.equal(v.success, false);
  assert.equal(v.failedPairs.length, 1);
  assert.equal(v.failedPairs[0].ref, '…cdef');
  assert.equal(v.failedPairs[0].label, 'C*** M***');
  assert.equal(v.failedPairs[0].message, copy.ERROR_BY_CODE.conflict ?? 'Le nouvel identifiant est déjà utilisé.');
  assert.ok(!JSON.stringify(v).includes('v1-li-2'), 'identifiant entier gardé en état');
});

test('conversion : rien à convertir = résultat sans lot', async () => {
  const data = { success: true, batch_id: null, applied: 0, failed: 0, rows_total: 0, remaining: 0, incomplete: false, unmapped_left: 0, results: [] };
  const result = await api.applyRemap(ok(data), 'BASCULER', false, 'f'.repeat(64));
  assert.equal(result.ok, true);
  assert.equal(result.value.batchId, null);
});

test('conversion : les colonnes sautées avec des lignes sont lues, avec le compte et la raison', async () => {
  const data = {
    success: true, batch_id: '33333333-3333-4333-8333-333333333333', applied: 2, failed: 0, rows_total: 15, skipped_rows: 6,
    remaining: 0, incomplete: false, unmapped_left: 0,
    results: [
      { kind: 'linkedin', label: 'J*** D***', ref: '…li-1', status: 'applied', rows: 12, skipped: [
        { table: 'chat_categories', column: 'account_id', status: 'no_primary_key', rows: 4 },
        { table: 'nurturing_opportunities', column: 'linkedin_account_id', status: 'unsupported_type', rows: 2 },
      ] },
      { kind: 'email', label: null, ref: 'il-1', status: 'applied', rows: 3 },
    ],
  };
  const result = await api.applyRemap(ok(data), 'BASCULER', false, 'f'.repeat(64));
  assert.equal(result.ok, true);
  assert.equal(result.value.skippedRows, 6);
  assert.deepEqual(result.value.skippedColumns.map((c) => [c.table, c.column, c.status, c.rows, c.ref]), [
    ['chat_categories', 'account_id', 'no_primary_key', 4, '…li-1'],
    ['nurturing_opportunities', 'linkedin_account_id', 'unsupported_type', 2, '…li-1'],
  ]);
  assert.equal(copy.skippedReasonLabel('no_primary_key'), 'sans clé primaire');
  assert.equal(copy.skippedReasonLabel('unsupported_type'), 'type de colonne inattendu');
  assert.match(copy.APPLY.skippedRows(6), /6 lignes portent encore l’ancien identifiant/);
  // Sans lignes sautées : rien à montrer.
  const clean = await api.applyRemap(ok({ ...data, skipped_rows: 0, results: [data.results[1]] }), 'BASCULER', false, 'f'.repeat(64));
  assert.equal(clean.value.skippedRows, 0);
  assert.deepEqual(clean.value.skippedColumns, []);
});

test('conversion : refus du serveur (409 comptes sans correspondance) et réponse perdue', async () => {
  const refused = await api.applyRemap(httpError(409, { error_code: 'unmapped_accounts' }), 'BASCULER', false, 'f');
  assert.equal(refused.ok, false);
  assert.equal(refused.lost, false);
  assert.equal(refused.message, copy.ERROR_BY_CODE.unmapped_accounts);
  const lost = await api.applyRemap(async () => ({ data: { success: false, error: 'Problème de connexion réseau.' }, error: new Error('réseau') }), 'BASCULER', false, 'f');
  assert.equal(lost.ok, false);
  assert.equal(lost.lost, true);
  const denied = await api.applyRemap(httpError(403, { error_code: 'admin_only' }), 'BASCULER', false, 'f');
  assert.equal(denied.denied, true);
  // Simulation périmée : refus définitif, avec sa phrase.
  const stale = await api.applyRemap(httpError(409, { error_code: 'plan_changed' }), 'BASCULER', false, 'f');
  assert.equal(stale.lost, false);
  assert.equal(stale.code, 'plan_changed');
  assert.equal(stale.message, copy.ERROR_BY_CODE.plan_changed);
});

test('conversion et annulation : une erreur 5xx sans code métier est un résultat inconnu, pas un échec sûr', async () => {
  // Passerelle ou arrêt du serveur : corps vide, statut 502 / 504 / 546. L'action a pu avoir lieu.
  const bare = (status) => async () => ({ data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { status }) });
  for (const status of [500, 502, 504, 546]) {
    const apply = await api.applyRemap(bare(status), 'BASCULER', false, 'f');
    assert.equal(apply.ok, false);
    assert.equal(apply.lost, true, `apply ${status}`);
    const rollback = await api.rollbackRemap(bare(status), 'b1');
    assert.equal(rollback.lost, true, `rollback ${status}`);
  }
  // Le code générique du serveur (exception après des écritures possibles) est aussi inconnu.
  assert.equal((await api.applyRemap(httpError(500, { error_code: 'server' }), 'BASCULER', false, 'f')).lost, true);
  // Un refus à code métier est définitif : le serveur n'avait rien écrit.
  for (const [status, code] of [[500, 'database_unavailable'], [503, 'service_unreachable'], [409, 'not_installed'], [409, 'list_truncated'], [400, 'confirmation_required']]) {
    const refused = await api.applyRemap(httpError(status, { error_code: code }), 'BASCULER', false, 'f');
    assert.equal(refused.lost, false, `${status} ${code}`);
  }
  const rolled = await api.rollbackRemap(httpError(500, { error_code: 'database' }), 'b1');
  assert.equal(rolled.lost, false, 'la base a refusé la restauration : transaction annulée');
  assert.equal(api.isUnknownOutcome({ message: 'x', status: 404 }, null), false, '4xx sans code : définitif');
  assert.equal(api.isUnknownOutcome({ message: 'x' }, null), true, 'sans statut : réponse jamais arrivée');
});

test('annulation : lot restauré, lot inconnu, lot déjà restauré', async () => {
  let sent = null;
  const good = await api.rollbackRemap(async (body) => {
    sent = body;
    return { data: { success: true, batch_id: 'b1', pairs: 2, restored_rows: 14, moved_rows: 1, columns: [] }, error: null };
  }, 'b1');
  // Le mot d'annulation part avec le lot : le serveur exige exactement ANNULER.
  assert.deepEqual(sent, { action: 'remap_rollback', batch_id: 'b1', confirm: 'ANNULER' });
  assert.equal(good.ok, true);
  assert.equal(good.value.restoredRows, 14);
  assert.equal(good.value.movedRows, 1);
  assert.equal(good.value.stillNewRows, 0);
  const late = await api.rollbackRemap(ok({ success: true, batch_id: 'b4', pairs: 1, restored_rows: 3, moved_rows: 0, still_new_rows: 5, still_new: [] }), 'b4');
  assert.equal(late.value.stillNewRows, 5);
  assert.match(copy.ROLLBACK.stillNew(5), /5 lignes créées depuis la conversion portent encore le nouvel identifiant/);
  const unknown = await api.rollbackRemap(httpError(404, { error_code: 'batch_unknown' }), 'b2');
  assert.equal(unknown.message, copy.ERROR_BY_CODE.batch_unknown);
  const again = await api.rollbackRemap(httpError(409, { error_code: 'batch_already_rolled_back' }), 'b3');
  assert.equal(again.message, copy.ERROR_BY_CODE.batch_already_rolled_back);
});

// ------------------------------------------------------------------ garde statique
test('aucun nom de prestataire dans le code de la page (hors le nom interne de la fonction appelée)', () => {
  for (const [rel, code] of Object.entries(CODE)) {
    const withoutFunctionName = code.replace(/'unipile-migration'/g, "''");
    assert.ok(!VENDOR.test(withoutFunctionName), `nom de prestataire dans ${rel}`);
  }
  // La seule mention est le nom de la fonction, dans le hook.
  const mentions = Object.entries(CODE).filter(([, code]) => /unipile/i.test(code)).map(([rel]) => rel);
  assert.deepEqual(mentions, [`${ADMIN_DIR}/useBascule.ts`]);
});

test('la conversion exige le mot saisi : le bouton ouvre le dialogue, le dialogue garde l’action désactivée', () => {
  const dialogs = CODE[`${ADMIN_DIR}/BasculeDialogs.tsx`];
  const panel = CODE[`${ADMIN_DIR}/BasculePanel.tsx`];
  const page = CODE['src/pages/AdminBascule.tsx'];
  assert.match(dialogs, /typed\.trim\(\) === CONFIRM_WORD/);
  assert.match(dialogs, /<AlertDialogAction\s+disabled=\{!typedOk \|\| !unmappedOk\}/);
  assert.match(dialogs, /<Label htmlFor=\{inputId\}>/);
  assert.match(dialogs, /<Input\s+id=\{inputId\}/);
  // Le bouton de la page n'applique rien : il ouvre le dialogue.
  assert.match(panel, /onClick=\{\(\) => setOpen\(true\)\}/);
  assert.equal((panel.match(/onApply\(/g) ?? []).length, 0, 'onApply appelé hors du dialogue');
  assert.match(panel, /onConfirm=\{onApply\}/);
  // Le mot envoyé est la constante de la copie.
  assert.match(page, /runApply\(CONFIRM_WORD, allowUnmapped, fingerprint\)/);
  // Le dialogue est un AlertDialog, jamais window.confirm.
  assert.doesNotMatch(Object.values(CODE).join('\n'), /window\.confirm|\bconfirm\(/);
});

test('les comptes sans correspondance doivent être acceptés par une case avant la conversion', () => {
  const dialogs = CODE[`${ADMIN_DIR}/BasculeDialogs.tsx`];
  assert.match(dialogs, /unmapped === 0 \|\| allowUnmapped/);
  assert.match(dialogs, /<Checkbox/);
});

test('le dialogue repart à vide quand il se ferme', () => {
  const dialogs = CODE[`${ADMIN_DIR}/BasculeDialogs.tsx`];
  assert.match(dialogs, /if \(!open\) \{\s*setTyped\(''\);\s*setAllowUnmapped\(false\);/);
});

test('l’annulation d’un lot a sa propre confirmation (AlertDialog destructif), le mot ANNULER, et nomme le lot', () => {
  const dialogs = CODE[`${ADMIN_DIR}/BasculeDialogs.tsx`];
  const page = CODE['src/pages/AdminBascule.tsx'];
  assert.match(dialogs, /export function RollbackDialog/);
  assert.match(dialogs, /<AlertDialogAction\s+variant="destructive"\s+disabled=\{!typedOk\}/);
  assert.match(dialogs, /typed\.trim\(\) === ROLLBACK_CONFIRM_WORD/);
  assert.match(dialogs, /if \(batchId === null\) setTyped\(''\)/);
  assert.match(dialogs, /ROLLBACK\.lotLine\(batchId\)/);
  // Les boutons « Annuler la conversion » ne lancent rien : ils ouvrent la confirmation.
  assert.match(page, /onRollback=\{setRollbackFor\}/);
  assert.match(page, /runRollback\(batchId\)/);
  const panel = CODE[`${ADMIN_DIR}/BasculePanel.tsx`];
  assert.equal((panel.match(/runRollback/g) ?? []).length, 0);
});

test('chaque étape a ses états : chargement, échec avec « Réessayer », vide', () => {
  const panel = CODE[`${ADMIN_DIR}/BasculePanel.tsx`];
  assert.match(panel, /step\.phase === 'loading' && <RowsSkeleton/);
  assert.match(panel, /<ErrorBox title=\{READINESS\.errorTitle\}/);
  assert.match(panel, /<ErrorBox title=\{PREVIEW\.errorTitle\}/);
  assert.match(panel, /onRetry=\{onRun\}/);
  assert.match(panel, /PREVIEW\.nothingTitle/);
  assert.match(panel, /step\.phase === 'idle' && <Idle>/);
  // Réponse perdue pendant la conversion : l'état réel est annoncé inconnu.
  assert.match(panel, /step\.failure\.lost \? APPLY\.lostAnswer/);
});

test('la conversion part avec l’empreinte de la simulation, et une simulation périmée est à refaire', () => {
  const page = CODE['src/pages/AdminBascule.tsx'];
  const hook = CODE[`${ADMIN_DIR}/useBascule.ts`];
  assert.match(page, /runApply\(CONFIRM_WORD, allowUnmapped, fingerprint\)/);
  assert.match(page, /bascule\.preview\.value\.planFingerprint/);
  assert.match(hook, /outcome\.code === 'plan_changed'\)\) setPreview\(\{ phase: 'idle' \}\)/);
  // Une réponse perdue pendant l'annulation rend la simulation caduque aussi.
  assert.match(hook, /\(!isFailure\(outcome\) \|\| outcome\.lost\)\) setPreview\(\{ phase: 'idle' \}\)/);
});

test('les boutons d’annulation et de conversion sont éteints pendant une conversion ou une annulation', () => {
  const panel = CODE[`${ADMIN_DIR}/BasculePanel.tsx`];
  const page = CODE['src/pages/AdminBascule.tsx'];
  assert.match(page, /const busy = bascule\.apply\.phase === 'loading' \|\| bascule\.rollback\.phase === 'loading'/);
  assert.match(page, /<PreviewStep[^>]*busy=\{busy\}/);
  assert.match(page, /<ApplyStep[\s\S]*busy=\{busy\}/);
  // Trois boutons d'annulation : la liste des lots, le résultat de la conversion ; et la conversion elle-même.
  assert.equal((panel.match(/disabled=\{busy\}/g) ?? []).length, 2);
  assert.match(panel, /const canApply = totals !== null && totals\.toConvert > 0 && !busy/);
});

test('un résultat inconnu (réponse perdue) a son propre titre et sa phrase, pour la conversion comme pour l’annulation', () => {
  const panel = CODE[`${ADMIN_DIR}/BasculePanel.tsx`];
  assert.match(panel, /step\.failure\.lost \? APPLY\.unknownTitle : APPLY\.failedTitle/);
  assert.match(panel, /step\.failure\.lost \? ROLLBACK\.unknownTitle : ROLLBACK\.failedTitle/);
  assert.match(panel, /step\.failure\.lost \? ROLLBACK\.lostAnswer/);
  assert.equal(copy.APPLY.unknownTitle, 'Résultat inconnu');
  assert.ok(!/n’a pas eu lieu/.test(copy.APPLY.unknownTitle));
});

test('accessibilité : texte masqué pour le chargement, une seule zone vivante par étape, focus sur le résultat', () => {
  const panel = CODE[`${ADMIN_DIR}/BasculePanel.tsx`];
  // F2 : le squelette porte du texte lu par la zone vivante, pas seulement un aria-label.
  assert.match(panel, /<span className="sr-only">\{label\}<\/span>/);
  assert.doesNotMatch(panel, /aria-label=\{label\}/);
  // F3 : plus de role=status imbriqué dans une zone aria-live ; l'erreur (role=alert) est hors de la zone vivante.
  assert.equal((panel.match(/role="status"/g) ?? []).length, 0);
  assert.match(panel, /<div aria-live="polite">\s*\{step\.phase === 'idle' && <Idle>\{READINESS\.emptyBody\}/);
  assert.match(panel, /aria-live=\{step\.phase === 'error' \? 'off' : 'polite'\}/);
  // F4 : le bloc de résultat reçoit le focus quand l'étape démarre.
  assert.match(panel, /function useFocusOnStart\(phase: string\)/);
  assert.match(panel, /if \(phase !== 'idle'\) ref\.current\?\.focus\?\.\(\)/);
  assert.equal((panel.match(/tabIndex=\{-1\}/g) ?? []).length, 2);
  assert.doesNotMatch(panel, /scrollIntoView/);
});

test('les états « Accès réservé » et d’erreur d’accès ont un titre de page h1', () => {
  const page = CODE['src/pages/AdminBascule.tsx'];
  assert.equal((page.match(/<PageHeader title=\{PAGE\.title\}/g) ?? []).length, 3, 'refus, erreur, page accordée');
  assert.match(page, /<PageHeader title=\{PAGE\.title\} \/>\s*<EmptyState/);
  assert.match(page, /<PageHeader title=\{PAGE\.title\} \/>\s*<ErrorBox title=\{ACCESS_ERROR\.title\}/);
});

test('la simulation montre les anciens identifiants sans compte relié et leur lecture en échec', () => {
  const panel = CODE[`${ADMIN_DIR}/BasculePanel.tsx`];
  assert.match(panel, /preview\.orphans\.length > 0 && <OrphansList/);
  assert.match(panel, /preview\.orphansError && \(/);
  assert.match(copy.PREVIEW.orphansIntro, /ne seront pas convertis/);
});

test('un accès refusé affiche « Accès réservé » sans toast ni erreur', () => {
  const page = CODE['src/pages/AdminBascule.tsx'];
  const hook = CODE[`${ADMIN_DIR}/useBascule.ts`];
  assert.match(page, /access === 'denied'/);
  assert.match(page, /title=\{DENIED\.title\}/);
  for (const [rel, code] of Object.entries(CODE)) {
    assert.doesNotMatch(code, /from 'sonner'|from "sonner"|\btoast\b|useToast/, `toast dans ${rel}`);
  }
  // Un refus en cours de route ferme la page au lieu de s’afficher comme une erreur.
  assert.match(hook, /else if \(outcome\.denied\) setAccess\('denied'\)/);
  // La page ne se référence pas dans les moteurs de recherche.
  assert.match(page, /noindex/);
});

test('cibles tactiles de 44 px sur les boutons discrets et champs de 16 px', () => {
  const panel = SRC[`${ADMIN_DIR}/BasculePanel.tsx`];
  assert.ok((panel.match(/min-h-11[^"'`]*md:min-h-0/g) ?? []).length >= 6);
  // L’Input partagé passe à 16 px sur téléphone (text-base md:text-sm) : pas de taille écrite à la main.
  assert.doesNotMatch(SRC[`${ADMIN_DIR}/BasculeDialogs.tsx`], /text-\[\d+px\]/);
});

test('pas de couleur brute ni de taille arbitraire dans les écrans', () => {
  for (const rel of [`${ADMIN_DIR}/BasculePanel.tsx`, `${ADMIN_DIR}/BasculeDialogs.tsx`, 'src/pages/AdminBascule.tsx']) {
    const code = CODE[rel];
    assert.doesNotMatch(code, /\b(bg|text|border)-(red|green|amber|emerald|yellow|blue|slate|gray|zinc|neutral)-\d/, `couleur brute dans ${rel}`);
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,6}\b|rgb\(/, `couleur en dur dans ${rel}`);
    assert.doesNotMatch(code, /text-\[\d+px\]/, `taille arbitraire dans ${rel}`);
  }
});

// ------------------------------------------------------------------ navigation
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|mjs|json)$/.test(name)) out.push(full);
  }
  return out;
}

test('la page n’est référencée nulle part hors de sa route : ni barre latérale, ni palette, ni registre des Paramètres', () => {
  const owned = new Set(OWNED.map((rel) => join(ROOT, rel)));
  const offenders = [];
  for (const file of walk(join(ROOT, 'src'))) {
    if (owned.has(file) || file.endsWith('src/App.tsx')) continue;
    const src = readFileSync(file, 'utf8');
    if (/admin\/bascule|AdminBascule/.test(src)) offenders.push(file.replace(ROOT, ''));
  }
  assert.deepEqual(offenders, [], 'référence à la page cachée hors de App.tsx');
});

test('App.tsx : une seule route, avant /settings/*, derrière la connexion et l’organisation', () => {
  const app = read('src/App.tsx');
  const lines = app.split('\n');
  const routeLines = lines.map((line, i) => ({ line, i })).filter(({ line }) => line.includes('"/settings/admin/bascule"'));
  assert.equal(routeLines.length, 1);
  const wildcard = lines.findIndex((line) => line.includes('<Route path="/settings/*"'));
  assert.ok(routeLines[0].i < wildcard, 'la route doit précéder /settings/*');
  assert.match(routeLines[0].line, /<ProtectedRoute><OrganizationGuard><AppLayout><AdminBascule \/>/);
  assert.equal((app.match(/AdminBascule/g) ?? []).length, 3, 'import, route et commentaire éventuel seulement');
});

test('le registre des Paramètres et la table des adresses ne connaissent pas la page', () => {
  const sections = read('src/components/settings/shell/sections.tsx');
  const routes = read('src/lib/settingsRoutes.ts');
  for (const src of [sections, routes]) {
    assert.doesNotMatch(src, /bascule|admin\//i);
  }
});

test('les fichiers de la barre latérale et de la palette ne mènent pas à /settings/admin', () => {
  for (const rel of ['src/components/AppSidebar.tsx', 'src/components/layout/NavigationPalette.tsx', 'src/components/layout/GoShortcuts.tsx']) {
    assert.doesNotMatch(read(rel), /settings\/admin/, rel);
  }
});

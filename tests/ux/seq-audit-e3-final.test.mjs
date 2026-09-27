/**
 * Audit séquences 2026-09-25, lot E3, vague finale : points de la relecture
 * contradictoire (REV) et demandes résiduelles (SEQ-067, SEQ-155, SEQ-125).
 *
 * Même méthode que seq-audit-e3.test.mjs : les modules purs de
 * supabase/functions/_shared sont compilés avec esbuild et exécutés ; les
 * fonctions du moteur sont découpées dans process-sequences, débarrassées de
 * leurs types et exécutées quand elles n'ont besoin que d'un faux client,
 * sinon vérifiées sur leur code (commentaires retirés).
 *
 * Lancer : node --test tests/ux/seq-audit-e3-final.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSync, transformSync } from 'esbuild';

const root = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');

const importModule = async (rel) => {
  const { outputFiles } = buildSync({
    entryPoints: [fileURLToPath(new URL(rel, root))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    external: ['npm:*', 'https:*'],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
};

const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const rawSlice = (src, start, end) => {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `repère introuvable : ${start}`);
  const to = end ? src.indexOf(end, from + start.length) : -1;
  return src.slice(from, to > from ? to : undefined);
};
const sliceBetween = (src, start, end) => code(rawSlice(src, start, end));

/** Fonction TypeScript de process-sequences rendue exécutable (types retirés). */
const loadFunctions = (tsSource, names, inject = {}) => {
  const js = transformSync(tsSource, { loader: 'ts' }).code;
  const params = Object.keys(inject);
  const factory = new Function(...params, `${js}\nreturn { ${names.join(', ')} };`);
  return factory(...params.map((p) => inject[p]));
};

const sequences = read('supabase/functions/process-sequences/index.ts');
const inmailQueue = read('supabase/functions/process-inmail-queue/index.ts');
const replyFn = code(read('supabase/functions/generate-reply-suggestions/index.ts'));
const sendEmailFn = read('supabase/functions/sequence-send-email/index.ts');
const rules = await importModule('supabase/functions/_shared/sequence-send-rules.ts');
const sender = await importModule('supabase/functions/_shared/sequence-sender.ts');

// ---------------------------------------------------------------- 1, 7, 10. SEQ-067 : état de la boîte e-mail
test('boîte e-mail : le moteur applique exactement la règle de sequence-send-email', () => {
  // Règle de référence recopiée depuis sequence-send-email (isUsableMailboxStatus).
  const reference = loadFunctions(
    rawSlice(sendEmailFn, 'function isUsableMailboxStatus(', '\n}\n') + '\n}\n',
    ['isUsableMailboxStatus'],
  ).isUsableMailboxStatus;
  for (const s of [null, undefined, '', '  ', 'OK', 'ok', 'CONNECTED', 'Connected', 'STOPPED', 'CONNECTING', 'PAUSED',
    'CREDENTIALS', 'ERROR', 'PERMISSIONS', 'DELETED', 'SYNC_SUCCESS']) {
    assert.equal(sender.isUsableMailboxStatus(s), reference(s), `état ${String(s)}`);
    assert.equal(sender.isMailboxDisconnected(s), !reference(s), `état ${String(s)}`);
  }
  // Les états qui passaient le contrôle du moteur puis échouaient dans l'envoi.
  for (const s of ['STOPPED', 'CONNECTING', 'PAUSED']) assert.equal(sender.isMailboxDisconnected(s), true, s);
});

test('boîte e-mail déconnectée : jamais traitée comme un compte LinkedIn déconnecté', () => {
  const src = rawSlice(sequences, 'function isAccountDisconnectedError(', '\n}\n') + '\n}\n'
    + rawSlice(sequences, 'function isMailboxDisconnectedError(', '\n}\n') + '\n}\n'
    + rawSlice(sequences, 'function accountDisconnectedLabel(', '\n}\n') + '\n}\n';
  const fns = loadFunctions(src, ['isAccountDisconnectedError', 'isMailboxDisconnectedError', 'accountDisconnectedLabel']);
  const mailboxErr = "email_account_disconnected: boîte e-mail d'envoi déconnectée (STOPPED)";
  assert.equal(fns.isMailboxDisconnectedError(mailboxErr), true);
  assert.equal(fns.isAccountDisconnectedError(mailboxErr), false, 'plus de pause « compte LinkedIn déconnecté » pour la boîte');
  // Les vraies pannes du compte LinkedIn restent reconnues.
  assert.equal(fns.isAccountDisconnectedError('LinkedIn 401: account_disconnected'), true);
  assert.equal(fns.isAccountDisconnectedError('Invalid credentials'), true);
  assert.equal(fns.isMailboxDisconnectedError('LinkedIn 401: account_disconnected'), false);
  const label = fns.accountDisconnectedLabel({ action_type: 'email' }, mailboxErr);
  assert.match(label, /^Boîte e-mail d'envoi déconnectée : reconnectez-la dans Paramètres, Connexions, puis reprenez le candidat\.$/);
  assert.doesNotMatch(label, /LinkedIn|Unipile/);
  // Le contrôle préalable de l'étape e-mail utilise la règle alignée et la même erreur préfixée.
  const emailCase = sliceBetween(sequences, "case 'email': {", "case 'wait_connection'");
  assert.match(emailCase, /isMailboxDisconnected\(mailbox\.mailboxStatus\)/);
  assert.match(emailCase, /error: `email_account_disconnected: /);
});

// ---------------------------------------------------------------- 3, 11. SEQ-155 : cause d'une rotation sans expéditeur
/** Faux client : chaque table répond via un handler, filtres enregistrés. */
function rotationClient(handlers) {
  return {
    from(table) {
      const q = { table, eqs: {}, ins: {} };
      const builder = {
        select() { return builder; },
        eq(col, value) { q.eqs[col] = value; return builder; },
        in(col, values) { q.ins[col] = values; return builder; },
        gte() { return builder; },
        then(resolve, reject) { return Promise.resolve(handlers[table]?.(q) ?? { data: [], error: null }).then(resolve, reject); },
      };
      return builder;
    },
  };
}

test('rotation : null accompagné de sa cause (plafond, groupe vide, sans organisation, lecture en échec)', async () => {
  const fnSrc = rawSlice(sequences, 'async function pickSenderForRotation(', '\nfunction needsMessage')
    .replace("await import('../_shared/sequence-send-rules.ts')", '__rules');
  assert.ok(fnSrc.includes('__rules'), 'import des règles introuvable');
  const { pickSenderForRotation } = loadFunctions(fnSrc, ['pickSenderForRotation'], { __rules: rules, console: { warn() {}, log() {} } });
  const pool = [{ account_id: 'LI_A', daily_limit: 1, channel: 'linkedin' }, { account_id: 'LI_B', daily_limit: 1 }];
  const linkedBoth = { member_linkedin_accounts: () => ({ data: [{ linkedin_account_id: 'LI_A' }, { linkedin_account_id: 'LI_B' }], error: null }) };

  const run = async (sequence, handlers) => {
    const diag = {};
    const chosen = await pickSenderForRotation(rotationClient(handlers), sequence, diag);
    return { chosen, cause: diag.cause };
  };

  // Groupe sans entrée LinkedIn (ancien éditeur : boîte e-mail enregistrée sans canal filtrée par canal).
  assert.deepEqual(await run({ id: 's', organization_id: 'org1', sender_accounts: [{ account_id: 'MAIL', channel: 'email' }] }, {}),
    { chosen: null, cause: 'empty_pool' });
  // Membres partis ou comptes dissociés : aucun compte du groupe relié dans l'organisation.
  assert.deepEqual(await run({ id: 's', organization_id: 'org1', sender_accounts: pool }, { member_linkedin_accounts: () => ({ data: [], error: null }) }),
    { chosen: null, cause: 'empty_pool' });
  assert.deepEqual(await run({ id: 's', organization_id: null, sender_accounts: pool }, linkedBoth),
    { chosen: null, cause: 'no_org' });
  assert.deepEqual(await run({ id: 's', organization_id: 'org1', sender_accounts: pool }, { member_linkedin_accounts: () => ({ data: null, error: { message: 'boom' } }) }),
    { chosen: null, cause: 'lookup_failed' });
  // Tous au plafond du jour.
  const capped = await run({ id: 's', organization_id: 'org1', sender_accounts: pool }, {
    ...linkedBoth,
    sequence_step_executions: () => ({ data: [{ enrollment: { assigned_sender_id: 'LI_A' } }, { enrollment: { assigned_sender_id: 'LI_B' } }], error: null }),
  });
  assert.deepEqual(capped, { chosen: null, cause: 'capped' });
  // Expéditeur disponible : pas de cause.
  const ok = await run({ id: 's', organization_id: 'org1', sender_accounts: pool }, {
    ...linkedBoth,
    sequence_step_executions: () => ({ data: [{ enrollment: { assigned_sender_id: 'LI_A' } }], error: null }),
  });
  assert.equal(ok.chosen?.account_id, 'LI_B');
  assert.equal(ok.cause, undefined);
  // Appel historique sans diag : toujours accepté.
  assert.equal(await pickSenderForRotation(rotationClient({}), { id: 's', organization_id: 'org1', sender_accounts: [] }), null);
});

// ---------------------------------------------------------------- 2. InMail rédigé par l'IA sans objet
test('InMail IA sans objet ni objet de repli : pas de texte figé sans objet, nouvelle rédaction', () => {
  const generate = sliceBetween(sequences, 'async function generatePersonalizedMessage(');
  const normalizeAt = generate.indexOf("parsed.subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : undefined;");
  const guardAt = generate.indexOf('if (isInMail && !parsed.subject && !fallbackSubject) {');
  const returnAt = generate.indexOf('return { message: parsed.message, subject: parsed.subject };');
  assert.ok(normalizeAt > 0 && guardAt > normalizeAt && returnAt > guardAt, 'garde de l’objet InMail mal placée');
  assert.match(generate, /const fallbackSubject = String\(step\.subject_template \?\? ''\)\.trim\(\) \|\| String\(_exec\.final_subject \?\? ''\)\.trim\(\);/);
  const guard = generate.slice(guardAt, generate.indexOf('}', guardAt));
  assert.match(guard, /diag\.reason = "Objet de l'InMail manquant dans la réponse IA"/);
  assert.match(guard, /return null;/);
});

// ---------------------------------------------------------------- 5. 503 de la file InMail
test('file InMail : un 503 n’est jamais renvoyé seul (même règle que le moteur)', () => {
  assert.equal(rules.classifySendStatus(503), 'uncertain');
  assert.equal(rules.inmailQueueRetry(503, null).retry, false);
  assert.equal(rules.inmailQueueRetry(503, 'Service LinkedIn momentanément indisponible, nouvel essai 1/3 dans 1 h').retry, false);
  assert.equal(rules.inmailQueueRetry(429, null).retry, true);
  // Le 503 tombe dans la branche « Envoi incertain ».
  const loop = sliceBetween(inmailQueue, 'const retry = inmailQueueRetry(response.status', 'Capture the provider usage');
  assert.match(loop, /if \(response\.status >= 500\) \{\s*throw new Error\(`Envoi incertain \(code \$\{response\.status\}\)/);
});

// ---------------------------------------------------------------- 6, 12. Compte d'un collègue refusé à la mise en file
test('file InMail, action queue : compte d’un collègue refusé, codes d’erreur du contrat', () => {
  const queue = sliceBetween(inmailQueue, 'if (action === "queue")', '// Abonnement (SEQ-134)');
  assert.match(queue, /\.select\("linkedin_account_id, user_id"\)\s*\.eq\("organization_id", callerOrgId\)/);
  assert.match(queue, /linkRows\.filter\(\(a\) => a\.user_id === user\.id\)/);
  assert.match(queue, /error: "ACCOUNT_OF_OTHER_MEMBER",\s*message: "Ce compte LinkedIn est relié à un autre membre de l'équipe\. Envoyez les InMails depuis votre propre compte\."/);
  assert.match(queue, /error: "ACCOUNT_NOT_ALLOWED", message: "Ce compte LinkedIn n’appartient pas à votre organisation\."/);
  assert.equal((queue.match(/status: 403/g) || []).length, 2);
  assert.doesNotMatch(queue, /error: "Compte LinkedIn non autorisé"/);
  // Le refus du collègue suit le contrôle d'organisation et précède toute écriture.
  assert.ok(queue.indexOf('ACCOUNT_NOT_ALLOWED') < queue.indexOf('ACCOUNT_OF_OTHER_MEMBER'));
});

// ---------------------------------------------------------------- 8. Libellé du contrôle de solde
test('file InMail : contrôle de solde en échec = libellé fixe, jamais l’erreur brute', () => {
  const balance = sliceBetween(inmailQueue, 'const isFirstDegreeMsg = item.network_distance === 1;', 'Gate quota unifié');
  assert.doesNotMatch(balance, /error_message: balErr instanceof Error \? balErr\.message/);
  assert.match(balance, /error_message: "Contrôle des crédits InMail momentanément indisponible, nouvel essai dans 30 min"/);
});

// ---------------------------------------------------------------- 9. Suggestions de réponse
test('suggestions de réponse : l’expéditeur du contexte d’approche est l’appelant, pas le candidat', () => {
  assert.match(replyFn, /\.from\('profiles'\)\.select\('active_organization_id, display_name'\)\.eq\('user_id', userId\)/);
  assert.match(replyFn, /buildOutreachContext\([^)]*callerFirstName,\s*organizationName,\s*\)/);
  const call = replyFn.slice(replyFn.indexOf('buildOutreachContext('), replyFn.indexOf('organizationName,', replyFn.indexOf('buildOutreachContext(')));
  assert.doesNotMatch(call, /candidateName/);
});

/**
 * Lot 1 des Paramètres — arrêt des envois à la dissociation et quotas du
 * titulaire du compte d'envoi (corrections après revue).
 *
 * Invariants épinglés par inspection de source (Deno absent de cette suite),
 * dans le style de tests/ux/linkedin-status.test.mjs :
 *  - C6/C21 : « Dissocier » annule aussi les InMails mis en file sans
 *    organisation (retrouvés par leur auteur, membre de l'organisation) ;
 *  - C7/C22 : le compte dissocié sort des pools de rotation multi-expéditeurs ;
 *    le filtre sur assigned_sender_id tolère 22P02 tant que la colonne est uuid ;
 *  - C9 : tout échec de l'arrêt garde la liaison ; les exécutions en attente
 *    ne sont plus touchées (contrat des lots, audit séquences 2026-09-25) ;
 *
 * L'arrêt des envois vit dans _shared/linkedin-sending-stop.ts (SEQ-041/042),
 * partagé par la dissociation, le changement de compte et le retrait d'un
 * membre.
 *  - C10 : plafond et plages sont ceux du titulaire du compte d'envoi ;
 *  - C11/C24 : la file InMail lit les plages dans la ligne de l'organisation ;
 *  - C12 : la mise en file écrit organization_id.
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PostgrestClient } from '@supabase/postgrest-js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const accountsFn = read('supabase/functions/unipile-accounts/index.ts');
const sendingStop = read('supabase/functions/_shared/linkedin-sending-stop.ts');
const inmailQueue = read('supabase/functions/process-inmail-queue/index.ts');
const sequences = read('supabase/functions/process-sequences/index.ts');

const sliceBetween = (src, start, end) => {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `repère introuvable : ${start}`);
  const to = src.indexOf(end, from);
  assert.ok(to > from, `repère de fin introuvable : ${end}`);
  return src.slice(from, to);
};

const caseBlock = (name) => {
  const start = accountsFn.indexOf(`      case '${name}': {`);
  assert.ok(start >= 0, `case '${name}' introuvable`);
  const next = accountsFn.indexOf('\n      case \'', start + 1);
  const end = next >= 0 ? next : accountsFn.indexOf('\n      default:', start);
  return accountsFn.slice(start, end);
};

const unlink = caseBlock('unlink_linkedin_account');
const deleteAt = unlink.indexOf('.delete()');

// ---------------------------------------------------------------- C6 / C21
test('C6/C21 — Dissocier annule aussi les InMails mis en file sans organisation', () => {
  const cancel = sliceBetween(sendingStop, ".from('inmail_queue')", ".select('id')");
  assert.doesNotMatch(
    cancel,
    /\.eq\('organization_id', organizationId\)/,
    'le filtre strict excluait toutes les lignes sans organisation',
  );
  assert.match(cancel, /\.or\(inmailScope\)/);
  assert.match(cancel, /\.eq\('account_id', accountId\)/);
  assert.match(cancel, /\.in\('status', \['pending', 'scheduled'\]\)/);
  assert.match(
    sendingStop,
    /const inmailScope = `organization_id\.eq\.\$\{organizationId\},organization_id\.is\.null`;/,
    'lignes sans organisation du compte : annulées quel que soit leur auteur',
  );
  assert.match(unlink, /stopLinkedInAccountSending\(adminClient, \{\s*organizationId,\s*accountId: row\.linkedin_account_id,/);
});

test('C6/C21 — le filtre part tel quel dans l\'URL de l\'API', () => {
  const org = '11111111-1111-1111-1111-111111111111';
  const scope = `organization_id.eq.${org},organization_id.is.null`;
  const q = new PostgrestClient('http://local').from('inmail_queue').update({ status: 'cancelled' })
    .or(scope).eq('account_id', 'ACC').in('status', ['pending', 'scheduled']);
  assert.equal(
    q.url.searchParams.get('or'),
    `(organization_id.eq.${org},organization_id.is.null)`,
  );
  assert.equal(q.url.searchParams.get('account_id'), 'eq.ACC');
});

// ---------------------------------------------------------------- C12
test('C12 — la mise en file écrit l\'organisation vérifiée', () => {
  const queue = sliceBetween(inmailQueue, 'if (action === "queue")', 'if (action === "process")');
  assert.match(
    queue,
    /let callerOrgId: string \| null = null;\s*\{\s*const requestedAccountIds/,
    'callerOrgId doit être déclaré avant le bloc de vérification, pour rester visible à l\'insertion',
  );
  const row = sliceBetween(queue, 'const queuedItems', '.insert(queuedItems)');
  assert.match(row, /organization_id: callerOrgId,/);
});

// ---------------------------------------------------------------- C11 / C24
test('C11/C24 — plages de la file InMail lues dans la ligne de l\'organisation', () => {
  const fn = sliceBetween(inmailQueue, 'async function loadUserQuotas', 'Deno.serve(');
  assert.match(fn, /orgId: string \| null/);
  assert.match(fn, /if \(!userId \|\| !orgId\) return defaults;/);
  assert.match(fn, /\.eq\('organization_id', orgId\)/);

  const calls = [...inmailQueue.matchAll(/loadUserQuotas\(supabase, ([^)]*)\)/g)].map((m) => m[1]);
  assert.equal(calls.length, 2, 'appels attendus : mise en file et traitement');
  for (const args of calls) assert.equal(args.split(',').length, 2, `organisation absente : loadUserQuotas(supabase, ${args})`);
  assert.match(inmailQueue, /loadUserQuotas\(supabase, user\.id, callerOrgId\)/);

  const cache = sliceBetween(inmailQueue, 'const getQuotasFor', 'const accountOwnerCache');
  assert.match(cache, /const key = `\$\{orgId\}:\$\{userId\}`;/, 'cache indexé par organisation et utilisateur');

  const loop = sliceBetween(inmailQueue, 'for (const item of pendingItems', 'const gate = await enforceLinkedInAction');
  assert.match(loop, /const itemOrgId = item\.organization_id \?\? orgIdByUser\.get\(item\.created_by\) \?\? null;/);
  assert.ok(
    loop.indexOf('canSendForSubscription(item)') < loop.indexOf('const itemOrgId'),
    'orgIdByUser est rempli par canSendForSubscription, qui doit précéder',
  );
  assert.match(loop, /getQuotasFor\(quotaUserId, itemOrgId\)/);
});

// ---------------------------------------------------------------- C10
test('C10 — séquences : quotas du titulaire du compte d\'envoi, chargés après la rotation', () => {
  // Audit séquences SEQ-076 : le gate quota est désormais juste avant le
  // verrou 'sending' (après santé du compte, condition et vérification de
  // réponse) ; la fenêtre inspectée va donc jusqu'au verrou.
  const loop = sliceBetween(
    sequences,
    'const enrollmentOrgId = enrollment.organization_id',
    'const { data: lockResult',
  );
  const effectiveAt = loop.indexOf('const effectiveAccountId =');
  const quotasAt = loop.indexOf('await getUserQuotas(');
  assert.notEqual(effectiveAt, -1);
  assert.ok(quotasAt > effectiveAt, 'les quotas doivent être chargés après le choix du compte d\'envoi');
  assert.equal(loop.split('await getUserQuotas(').length - 1, 1, 'chargement déplacé, pas dupliqué');

  const owner = sliceBetween(loop, 'let quotaUserId = senderUserId;', 'await getUserQuotas(');
  assert.match(owner, /\.from\('member_linkedin_accounts'\)/);
  assert.match(owner, /\.eq\('organization_id', enrollmentOrgId\)/);
  assert.match(owner, /\.eq\('linkedin_account_id', effectiveAccountId\)/);
  assert.match(loop, /getUserQuotas\(supabase, quotaUserId, enrollmentOrgId \?\? null\)/);

  const call = sliceBetween(loop, 'await checkQuotaForAction(', 'if (!quotaCheck.allowed)');
  assert.match(call, /quotaUserId,/);
  assert.doesNotMatch(call, /senderUserId/, 'le plafond de l\'inscripteur ne doit plus s\'appliquer au compte d\'un autre');
});

test('C10 — file InMail : plafond et plages du titulaire du compte', () => {
  const owner = sliceBetween(inmailQueue, 'const getAccountOwner', 'const credsCache');
  assert.match(owner, /\.from\("member_linkedin_accounts"\)/);
  assert.match(owner, /\.eq\("organization_id", orgId\)/);
  assert.match(owner, /\.eq\("linkedin_account_id", accountId\)/);
  assert.match(
    inmailQueue,
    /const quotaUserId = \(await getAccountOwner\(item\.account_id, itemOrgId\)\) \?\? item\.created_by;/,
  );
  const gate = sliceBetween(inmailQueue, 'const gate = await enforceLinkedInAction', 'if (!gate.allowed)');
  assert.match(gate, /userId: quotaUserId,/);
  assert.doesNotMatch(gate, /userId: item\.created_by/);
});

// ---------------------------------------------------------------- C9
test('C9 — tout échec de l\'arrêt garde la liaison ; exécutions en attente intactes', () => {
  assert.doesNotMatch(unlink, /touchedIds/, 'une relance après échec partiel ne retrouvait aucune inscription');
  assert.doesNotMatch(unlink, /console\.warn\(/, 'un échec d\'arrêt ne doit jamais être seulement journalisé');
  assert.doesNotMatch(sendingStop, /console\.warn\(/, 'un échec d\'arrêt ne doit jamais être seulement journalisé');

  // Chaque écriture de l'arrêt lève en cas d'erreur.
  const throws = sendingStop.match(/throw new LinkedInSendingStopError\(/g) ?? [];
  assert.ok(throws.length >= 5, `lectures/écritures sans levée d'erreur (${throws.length})`);
  // Pauses : inscriptions de l'organisation, par compte d'inscription ou de rotation.
  assert.match(sendingStop, /\.update\(\{ status: 'paused', pause_reason: 'manual', updated_at: nowIso \}\)\s*\.eq\('organization_id', organizationId\)\s*\.eq\(column, accountId\)\s*\.eq\('status', 'active'\)/);
  // Contrat des lots : une pause ne touche pas aux exécutions en attente
  // (le moteur les ignore, la reprise serveur les garde à leur date).
  assert.doesNotMatch(sendingStop, /sequence_step_executions/);

  assert.notEqual(deleteAt, -1);
  const stopCall = sliceBetween(unlink, 'try {', '// 2. La liaison');
  assert.match(stopCall, /stopLinkedInAccountSending\(/);
  assert.match(stopCall, /catch \(stopError\) \{[\s\S]*?throw new HttpError\(500, keptLinked\)/);
  const lastKeptLinked = unlink.lastIndexOf('throw new HttpError(500, keptLinked)');
  assert.ok(lastKeptLinked < deleteAt, 'la liaison n\'est supprimée qu\'une fois les envois arrêtés');
});

// ---------------------------------------------------------------- C7 / C22
test('C7/C22 — Dissocier retire le compte des pools de rotation de l\'organisation', () => {
  const rotation = sliceBetween(sendingStop, ".from('outreach_sequences')", 'return {\n    pausedEnrollments');
  assert.match(rotation, /\.eq\('organization_id', organizationId\)/);
  assert.match(
    rotation,
    /\.contains\('sender_accounts', JSON\.stringify\(\[\{ account_id: accountId \}\]\)\)/,
  );
  assert.match(rotation, /s\?\.account_id !== accountId/);
  assert.match(rotation, /if \(remaining\.length === 0\) patch\.multi_sender_enabled = false;/);
  assert.match(rotation, /\.eq\('id', seq\.id\)\s*\.eq\('organization_id', organizationId\)/);
  assert.match(rotation, /if \(rotationReadError\)[\s\S]*?throw new LinkedInSendingStopError/);
  assert.match(rotation, /if \(rotationError\)[\s\S]*?throw new LinkedInSendingStopError/);
  // assigned_sender_id (compte de rotation) : filtré, mais une colonne encore
  // uuid lève 22P02 sur un identifiant de compte ; seule cette erreur, sur
  // cette seule colonne, est tolérée (aucune ligne ne peut alors porter le compte).
  assert.match(sendingStop, /const UUID_COLUMN_ERROR = '22P02';/);
  const tolerated = sendingStop.match(/if \(column === 'assigned_sender_id' && isUuidColumnError\(error\)\) continue;/g) ?? [];
  assert.equal(tolerated.length, 2);
  assert.doesNotMatch(unlink, /\.(eq|or|in|filter)\([^)]*assigned_sender_id/);
});

test('C7/C22 — contains() doit recevoir du JSON texte sur une colonne jsonb', () => {
  const pool = [{ account_id: 'kzAxdybMQ7ipVxK1U6kwZw' }];
  const asText = new PostgrestClient('http://local').from('outreach_sequences').select('id')
    .contains('sender_accounts', JSON.stringify(pool));
  assert.equal(asText.url.searchParams.get('sender_accounts'), 'cs.[{"account_id":"kzAxdybMQ7ipVxK1U6kwZw"}]');
  // Un tableau JS part en syntaxe de tableau Postgres, inutilisable sur du jsonb.
  const asArray = new PostgrestClient('http://local').from('outreach_sequences').select('id')
    .contains('sender_accounts', pool);
  assert.equal(asArray.url.searchParams.get('sender_accounts'), 'cs.{[object Object]}');
});

/**
 * Connexion des comptes : page de retour /settings/account/connections/retour
 * (src/pages/ConnectReturn.tsx et src/components/connections/returnState.ts).
 * Elle ne lit que `state` dans l'adresse et montre le résultat d'après l'état de
 * la tentative côté serveur.
 *
 * Lancer : node --test tests/ux/connexion-retour.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, read, stripComments } from './connexion-helpers.mjs';

const state = await loadTs('src/components/connections/returnState.ts');
const UUID = '3f2b8c1e-9a4d-4e7b-8c21-0d5e6f7a8b9c';

test('seul `state`, sous forme d\'identifiant, est lu dans l\'adresse', () => {
  assert.equal(state.readReturnState(`?state=${UUID}`), UUID);
  assert.equal(state.readReturnState(`?account_id=acc_1&provider=LINKEDIN&state=${UUID}`), UUID);
  for (const search of ['', '?state=', '?state=abc', '?state=../../x', `?state=${UUID}x`, '?account_id=acc_1', '?state=<script>']) {
    assert.equal(state.readReturnState(search), null, search);
  }
});

const attempt = (over) => ({ status: 'pending', provider: 'linkedin', mode: 'hosted', account: null, next: null, errorCode: null, errorMessage: null, ...over });

test('tentative réussie : l\'écran de réussite, avec le nom lisible du compte', () => {
  const v = state.viewOfAttempt(attempt({ status: 'completed', provider: 'google', account: { id: 'acc_1', name: 'lea@exemple.fr', status: 'OK' } }));
  assert.deepEqual(v, { kind: 'success', provider: 'google', accountName: 'lea@exemple.fr' });
  // Nom codé de l'ancien formulaire : jamais affiché
  const encoded = state.viewOfAttempt(attempt({ status: 'completed', account: { id: 'acc_1', name: 'user:abc|org:def|x', status: 'OK' } }));
  assert.equal(encoded.accountName, 'Compte LinkedIn');
  const none = state.viewOfAttempt(attempt({ status: 'completed' }));
  assert.equal(none.accountName, null);
});

test('tentative échouée, expirée, annulée ou en cours', () => {
  assert.deepEqual(state.viewOfAttempt(attempt({ status: 'failed', errorMessage: 'Message français.' })), { kind: 'failed', message: 'Message français.' });
  assert.match(state.viewOfAttempt(attempt({ status: 'failed' })).message, /La connexion n'a pas abouti/);
  assert.deepEqual(state.viewOfAttempt(attempt({ status: 'expired' })), { kind: 'expired' });
  assert.deepEqual(state.viewOfAttempt(attempt({ status: 'cancelled' })), { kind: 'cancelled' });
  assert.deepEqual(state.viewOfAttempt(attempt({ status: 'pending' })), { kind: 'waiting', slow: false });
  assert.deepEqual(state.viewOfAttempt(attempt({ status: 'pending' }), true), { kind: 'waiting', slow: true });
});

test('fin d\'un suivi : réussite, délai écoulé, tentative introuvable, lecture impossible, arrêt', () => {
  assert.equal(state.viewOfPoll({ kind: 'settled', view: attempt({ status: 'completed' }) }).kind, 'success');
  assert.deepEqual(state.viewOfPoll({ kind: 'timeout', view: attempt() }), { kind: 'waiting', slow: true });
  assert.deepEqual(state.viewOfPoll({ kind: 'timeout', view: null }), { kind: 'waiting', slow: true });
  assert.deepEqual(state.viewOfPoll({ kind: 'error', failure: { ok: false, errorCode: 'attempt_not_found', message: 'x' } }), { kind: 'not_found' });
  assert.deepEqual(state.viewOfPoll({ kind: 'error', failure: { ok: false, errorCode: 'network_lost', message: 'Connexion interrompue. Réessayez.' } }), { kind: 'load_error', message: 'Connexion interrompue. Réessayez.' });
  assert.deepEqual(state.viewOfPoll({ kind: 'aborted' }), { kind: 'reading' });
});

test('ancre de la carte du canal sur la page Connexions', () => {
  assert.equal(state.connectionsAnchor('linkedin'), '#linkedin');
  assert.equal(state.connectionsAnchor('whatsapp'), '#whatsapp');
  for (const p of ['google', 'outlook', 'imap']) assert.equal(state.connectionsAnchor(p), '#email', p);
  assert.equal(state.connectionsAnchor(null), '');
  assert.equal(state.CONNECTIONS_PATH, '/settings/account/connections');
  assert.equal(state.RETURN_PATH, '/settings/account/connections/retour');
});

// --------------------------------------------------------------- Source de la page
const page = read('src/pages/ConnectReturn.tsx');
const code = stripComments(page);

test('la page ne lit que `state` : aucune autre valeur de l\'adresse, aucun texte du fournisseur', () => {
  assert.match(code, /readReturnState\(location\.search\)/);
  assert.doesNotMatch(code, /URLSearchParams|useSearchParams|searchParams/);
  assert.doesNotMatch(code, /error_title|errorTitle|account_id|accountId/, 'ni le titre d\'erreur ni l\'identifiant du fournisseur ne sont lus');
  assert.doesNotMatch(code, /dangerouslySetInnerHTML/);
});

test('la page appelle connection_status (par le hook) et propose le retour aux connexions', () => {
  assert.match(code, /useConnection\(\)/);
  assert.match(code, /watch\(attemptId/);
  assert.match(code, /RETURN_PAGE\.back/);
  assert.match(code, /CONNECTIONS_PATH/);
  const copy = read('src/lib/connectionCopy.ts');
  assert.match(copy, /back: 'Retour aux connexions'/);
});

test('états montrés : lecture, attente, lenteur, réussite, échec, expiré, annulé, introuvable, invalide, lecture impossible', () => {
  for (const kind of ['success', 'failed', 'expired', 'cancelled', 'invalid', 'not_found', 'load_error']) {
    assert.match(code, new RegExp(`'${kind}'`), kind);
  }
  assert.match(code, /view\.kind === 'waiting' && view\.slow/);
  assert.match(code, /RETURN_PAGE\.recheck/);
});

test('accessibilité et appareils tactiles : focus sur le titre, cibles de 44 px', () => {
  assert.match(code, /headingRef\.current\?\.focus/);
  assert.match(code, /max-md:h-11/);
  assert.match(code, /<h1 ref=\{headingRef\} tabIndex=\{-1\}/);
  assert.doesNotMatch(code, /text-\[\d+px\]/);
});

test('R3 — le focus suit aussi le passage à l\'attente lente et le retour de « Revérifier »', () => {
  assert.match(code, /const screenKey = `\$\{view\.kind\}:\$\{view\.kind === 'waiting' && view\.slow \? 'slow' : 'fast'\}`/);
  const effect = code.slice(code.indexOf('headingRef.current?.focus'));
  assert.match(effect.slice(0, 120), /\[screenKey\]/);
  assert.doesNotMatch(effect.slice(0, 120), /\[view\.kind\]/);
});

test('R4 — le texte d\'attente n\'est pas annoncé plusieurs fois : spinner décoratif, pas de zone vivante autour des boutons', () => {
  assert.doesNotMatch(code, /aria-live|aria-busy/);
  assert.match(code, /<span aria-hidden="true"[^>]*><Spinner size="lg" \/><\/span>/);
  assert.doesNotMatch(code, /<Spinner[^>]*label=/);
});

test('R5 — l\'échec ne répète pas son titre et ne promet pas un bouton « Réessayer » qui n\'existe pas', async () => {
  const { loadTs } = await import('./connexion-helpers.mjs');
  const copy = await loadTs('src/lib/connectionCopy.ts');
  const body = state.failedBody(copy.GENERIC_FAILURE);
  assert.ok(!body.includes(copy.RETURN_PAGE.failedTitle), body);
  assert.match(body, /^Recommencez depuis la page Connexions\. Si le problème continue/);
  assert.equal(state.failedBody(copy.RETURN_PAGE.failedTitle), undefined);
  assert.equal(state.failedBody('Cette connexion n\'est pas autorisée pour ce compte.'), 'Cette connexion n\'est pas autorisée pour ce compte.');
  assert.match(code, /failedBody\(view\.message\)/);
});

test('F6 — la destination gardée par le serveur prime sur la note locale', () => {
  const v = (returnTo) => ({ status: 'pending', provider: 'linkedin', mode: 'hosted', account: null, next: null, errorCode: null, errorMessage: null, returnTo });
  assert.equal(state.serverReturnTarget(v('onboarding')), 'onboarding');
  assert.equal(state.serverReturnTarget(v(null)), null);
  assert.equal(state.serverReturnTarget({ kind: 'settled', view: v('onboarding') }), 'onboarding');
  assert.equal(state.serverReturnTarget({ kind: 'timeout', view: v('onboarding') }), 'onboarding');
  assert.equal(state.serverReturnTarget({ kind: 'timeout', view: null }), null);
  assert.equal(state.serverReturnTarget({ kind: 'aborted' }), null);
  assert.match(code, /serverTarget \?\? readReturnTarget\(attemptId\)/);
  assert.match(code, /setServerTarget\(target\)/);
});

test('R9 — depuis l\'installation : ?li=ok seulement une fois le compte rattaché, reprise automatique sur succès', () => {
  assert.match(code, /returnTargetPath\(serverTarget \?\? readReturnTarget\(attemptId\), view\.kind === 'success'\)/);
  assert.doesNotMatch(code, /includes\(view\.kind\)/);
  assert.match(code, /const resumeAuto = view\.kind === 'success' && resumePath !== undefined;/);
  assert.match(code, /navigate\(withPreviewAccessToken\(resumePath, resumeSearch \?\? ''\), \{ replace: true \}\)/);
});

test('la route est déclarée avant /settings/*, derrière la connexion et l\'organisation, sans navigation de Paramètres', () => {
  const app = read('src/App.tsx');
  const route = app.indexOf('path="/settings/account/connections/retour"');
  const settings = app.indexOf('path="/settings/*"');
  assert.ok(route > 0 && settings > route, 'la route de retour précède la route générique');
  const line = app.slice(route, app.indexOf('\n', route));
  assert.match(line, /<ProtectedRoute><OrganizationGuard><AppLayout><ConnectReturn \/><\/AppLayout><\/OrganizationGuard><\/ProtectedRoute>/);
  assert.match(app, /const ConnectReturn = lazy\(\(\) => import\("\.\/pages\/ConnectReturn"\)\);/);
});

test('le chemin de retour du serveur est celui de la route', () => {
  const steps = read('supabase/functions/unipile-accounts/connection-steps.ts');
  assert.match(steps, /CONNECTION_RETURN_PATH = '\/settings\/account\/connections\/retour'/);
  assert.equal(state.RETURN_PATH, '/settings/account/connections/retour');
});

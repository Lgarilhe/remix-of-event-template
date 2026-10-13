/**
 * Connexion des comptes : classes de santé (contrat de connexion, § 4).
 * connected, limited, locked, needs_reconnect, syncing, not_connected, plus
 * connecting et unknown. Le module src/lib/linkedinStatus.ts est pur ; les
 * textes viennent de src/lib/connectionCopy.ts.
 *
 * Lancer : node --test tests/ux/connexion-sante.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, read } from './connexion-helpers.mjs';

const status = await loadTs('src/lib/linkedinStatus.ts');
const copy = await loadTs('src/lib/connectionCopy.ts');
const { disconnectionAlertFor, classifyConnectionHealth, classifyLinkedInStatus, healthOfState, isHealthUsable, resolveMyLinkedInStatus, channelStatusOf, myLinkedInOutage } = status;

test('OK et statuts d\'événement : connected', () => {
  for (const s of ['OK', 'ok', ' Ok ', 'RUNNING', 'RECONNECTED', 'SYNC_SUCCESS', 'CREATION_SUCCESS', 'CONNECTED']) {
    assert.equal(classifyConnectionHealth({ status: s }), 'connected', s);
  }
});

test('CREDENTIALS, PARTIAL et ERROR : needs_reconnect, avec les statuts proches', () => {
  for (const s of ['CREDENTIALS', 'PARTIAL', 'partial', 'ERROR', 'errored', 'disconnected', 'STOPPED', 'PERMISSIONS', 'DELETED', 'CAPTCHA']) {
    assert.equal(classifyConnectionHealth({ status: s }), 'needs_reconnect', s);
  }
});

test('DEGRADED seul : limited (nouvelle tentative automatique, pas de « Reconnecter »)', () => {
  for (const s of ['DEGRADED', 'degraded']) {
    assert.equal(classifyConnectionHealth({ status: s }), 'limited', s);
  }
});

test('R1 — PARTIAL n\'est jamais « limited » : le serveur le dit reconnectable, la carte propose « Reconnecter »', () => {
  for (const s of ['PARTIAL', 'partial']) {
    assert.equal(classifyConnectionHealth({ status: s }), 'needs_reconnect', s);
    assert.equal(copy.healthAction(classifyConnectionHealth({ status: s })), 'reconnect', s);
    assert.doesNotMatch(copy.healthReason(classifyConnectionHealth({ status: s }), 'linkedin'), /rien à faire/, s);
  }
});

test('LOCKED, ou is_locked sur un compte actif : locked', () => {
  assert.equal(classifyConnectionHealth({ status: 'LOCKED' }), 'locked');
  assert.equal(classifyConnectionHealth({ status: 'OK', isLocked: true }), 'locked');
  assert.equal(classifyConnectionHealth({ status: 'DEGRADED', isLocked: true }), 'locked');
});

test('un compte à reconnecter reste « à reconnecter » même verrouillé (la reconnexion est le seul geste utile)', () => {
  assert.equal(classifyConnectionHealth({ status: 'CREDENTIALS', isLocked: true }), 'needs_reconnect');
  assert.equal(classifyConnectionHealth({ status: 'ERROR', isLocked: true }), 'needs_reconnect');
});

test('première synchronisation en cours sur un compte actif : syncing, jamais sur un autre état', () => {
  for (const sync of ['pending', 'running', 'PENDING', 'syncing']) {
    assert.equal(classifyConnectionHealth({ status: 'OK', sync }), 'syncing', sync);
  }
  for (const sync of ['completed', 'failed', null, undefined, '']) {
    assert.equal(classifyConnectionHealth({ status: 'OK', sync }), 'connected', String(sync));
  }
  assert.equal(classifyConnectionHealth({ status: 'CREDENTIALS', sync: 'running' }), 'needs_reconnect');
  assert.equal(classifyConnectionHealth({ status: 'DEGRADED', sync: 'running' }), 'limited');
});

test('CONNECTING : connecting ; valeur absente ou nouvelle : unknown, jamais une panne', () => {
  assert.equal(classifyConnectionHealth({ status: 'CONNECTING' }), 'connecting');
  for (const s of ['UNKNOWN', 'PAUSED', 'RATE_LIMITED', '', null, undefined, 'NOUVEAU']) {
    assert.equal(classifyConnectionHealth({ status: s }), 'unknown', String(s));
  }
});

test('classifyLinkedInStatus reste le statut seul (sans verrou ni synchronisation)', () => {
  assert.equal(classifyLinkedInStatus('LOCKED'), 'locked');
  assert.equal(classifyLinkedInStatus('PARTIAL'), 'needs_reconnect');
  assert.equal(classifyLinkedInStatus('DEGRADED'), 'limited');
  assert.equal(classifyLinkedInStatus('OK'), 'connected');
});

test('isHealthUsable : actif, ou actif en première synchronisation', () => {
  assert.equal(isHealthUsable('connected'), true);
  assert.equal(isHealthUsable('syncing'), true);
  for (const h of ['limited', 'locked', 'needs_reconnect', 'connecting', 'not_connected', 'unknown']) {
    assert.equal(isHealthUsable(h), false, h);
  }
});

test('healthOfState : les états d\'une carte vers les classes de santé', () => {
  assert.equal(healthOfState('not_linked'), 'not_connected');
  assert.equal(healthOfState('missing'), 'needs_reconnect');
  assert.equal(healthOfState('loading'), 'unknown');
  assert.equal(healthOfState('load_error'), 'unknown');
  for (const h of ['connected', 'syncing', 'connecting', 'limited', 'locked', 'needs_reconnect', 'unknown']) {
    assert.equal(healthOfState(h), h, h);
  }
});

const ME = 'user-moi';
const mapMoi = { user_id: ME, linkedin_account_id: 'acc_moi', account_status: 'OK' };
const resolve = (account) => resolveMyLinkedInStatus({
  userId: ME, mappings: [mapMoi], mappingsLoaded: true, accounts: [account], accountsLoaded: true,
});

test('carte LinkedIn : limited et locked ne demandent pas d\'agir, needs_reconnect oui', () => {
  const limited = resolve({ id: 'acc_moi', status: 'DEGRADED' });
  assert.equal(limited.state, 'limited');
  assert.equal(limited.needsAction, false);
  assert.equal(limited.isUsable, false);
  const partial = resolve({ id: 'acc_moi', status: 'PARTIAL' });
  assert.equal(partial.state, 'needs_reconnect');
  assert.equal(partial.needsAction, true);
  const locked = resolve({ id: 'acc_moi', status: 'LOCKED' });
  assert.equal(locked.state, 'locked');
  assert.equal(locked.needsAction, false);
  const lockedFlag = resolve({ id: 'acc_moi', status: 'OK', is_locked: true });
  assert.equal(lockedFlag.state, 'locked');
  const reco = resolve({ id: 'acc_moi', status: 'CREDENTIALS' });
  assert.equal(reco.state, 'needs_reconnect');
  assert.equal(reco.needsAction, true);
});

test('« À traiter » : à reconnecter, connexion partielle (PARTIAL) et accès restreint comptent ; connexion limitée (état de carte) non', () => {
  const input = (account_status, accounts) => ({
    userId: ME, mappings: [{ ...mapMoi, account_status }], mappingsLoaded: true, accounts, accountsLoaded: accounts.length > 0,
  });
  assert.equal(myLinkedInOutage(input('PARTIAL', [])), 'partial');
  assert.equal(myLinkedInOutage(input('DEGRADED', [])), false);
  assert.equal(myLinkedInOutage(input('LOCKED', [])), 'locked');
  assert.equal(myLinkedInOutage(input('CREDENTIALS', [])), 'reconnect');
  assert.equal(myLinkedInOutage(input('OK', [{ id: 'acc_moi', status: 'ERROR' }])), 'reconnect');
  assert.equal(myLinkedInOutage(input('OK', [{ id: 'acc_moi', status: 'PARTIAL' }])), 'partial');
});

test('tableau de bord : limited, locked et syncing restent neutres', () => {
  for (const s of ['limited', 'locked', 'syncing']) assert.equal(channelStatusOf(s), 'connecting', s);
});

// ------------------------------------------------------------- Textes de santé
const HEALTHS = ['connected', 'syncing', 'connecting', 'limited', 'locked', 'needs_reconnect', 'not_connected', 'unknown'];
const CHANNELS = ['linkedin', 'email', 'whatsapp'];

test('chaque classe a un libellé et une teinte connus de Badge', () => {
  const tones = new Set(['success', 'info', 'warning', 'danger', 'muted']);
  for (const h of HEALTHS) {
    assert.ok(copy.HEALTH_LABEL[h], `libellé ${h}`);
    assert.ok(tones.has(copy.HEALTH_TONE[h]), `teinte ${h}`);
  }
});

test('seuls needs_reconnect, not_connected et unknown proposent un geste : ni limited ni locked, et jamais « Reconnecter » pour eux', () => {
  assert.equal(copy.healthAction('limited'), null);
  assert.equal(copy.healthAction('connected'), null);
  assert.equal(copy.healthAction('syncing'), null);
  assert.equal(copy.healthAction('connecting'), null);
  assert.equal(copy.healthAction('needs_reconnect'), 'reconnect');
  assert.equal(copy.healthAction('not_connected'), 'connect');
  assert.equal(copy.healthAction('locked'), null, 'compte restreint : rien à faire dans Konekt, ni bouton ni adresse');
  assert.equal(copy.healthAction('unknown'), 'refresh');
});

test('ligne d\'explication : limited promet une nouvelle tentative, locked ne parle pas de se reconnecter comme remède', () => {
  for (const c of CHANNELS) {
    assert.match(copy.healthReason('limited', c), /Nouvelle tentative automatique/);
    assert.match(copy.healthReason('locked', c), /Se reconnecter n'y change rien/);
    assert.notEqual(copy.healthReason('needs_reconnect', c), '');
    assert.notEqual(copy.healthReason('not_connected', c), '');
  }
  assert.equal(copy.HEALTH_LABEL.limited, 'Connexion limitée');
});

test('libellés d\'action : Connecter selon le fournisseur, Reconnecter, Actualiser', () => {
  assert.equal(copy.healthActionLabel('connect', 'linkedin'), 'Connecter LinkedIn');
  assert.equal(copy.healthActionLabel('connect', 'google'), 'Connecter Gmail');
  assert.equal(copy.healthActionLabel('connect', 'imap'), 'Connecter une messagerie');
  assert.equal(copy.healthActionLabel('reconnect', 'whatsapp'), 'Reconnecter');
  assert.equal(copy.healthActionLabel('refresh', 'linkedin'), 'Actualiser');
});

test('R8 — l\'alerte de déconnexion couvre aussi limited puis panne, jamais un état inconnu ou déjà signalé', () => {
  for (const from of ['connected', 'syncing', 'limited']) {
    assert.equal(disconnectionAlertFor(from, 'needs_reconnect'), 'needs_reconnect', from);
    assert.equal(disconnectionAlertFor(from, 'locked'), 'locked', from);
    assert.equal(disconnectionAlertFor(from, 'connected'), null, from);
  }
  for (const from of ['unknown', 'connecting', 'needs_reconnect', 'locked', 'not_connected']) {
    assert.equal(disconnectionAlertFor(from, 'needs_reconnect'), null, from);
    assert.equal(disconnectionAlertFor(from, 'locked'), null, from);
  }
  const ctx = read('src/contexts/LinkedInAccountsContext.tsx');
  // La décision est dans disconnectToast.ts : le contexte lui donne l'état retenu et le compte listé
  assert.match(ctx, /toastStepFor\(prevHealthRef\.current, acc\)/);
  assert.match(read('src/components/connections/disconnectToast.ts'), /disconnectionAlertFor\(previous, next\)/);
  assert.match(read('src/components/connections/disconnectToast.ts'), /disconnectToastFor\(memory\.health, health, account\)/);
  assert.doesNotMatch(ctx, /prev\.health === 'connected'/);
});

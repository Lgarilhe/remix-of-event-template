/**
 * Alerte en direct du compte LinkedIn (toast de LinkedInAccountsContext), constat de la revue :
 * une connexion partielle (PARTIAL) levait le toast « déconnecté, le compte ne répond plus », faux
 * pour une partie de la connexion qui demande une nouvelle authentification, et un compte
 * restreint (LOCKED) parlait de support et d'accès suspendu quand le bandeau, la barre latérale
 * et la notification disent « restreint, patientez ».
 *
 * La décision est une fonction pure (src/components/connections/disconnectToast.ts) : la classe de
 * santé d'avant et d'après (disconnectionAlertFor), puis la cause lue comme sur les cartes
 * (causeOfReconnect) et les phrases de connectionCopy.ts. Le contexte ne fait que l'afficher.
 *
 * - session expirée (CREDENTIALS) et panne de connexion (ERROR) gardent leur toast ;
 * - PARTIAL a le sien, avec « Reconnecter », mot pour mot la phrase de la carte et de la notification ;
 * - DEGRADED n'en lève aucun (état de carte, reprise automatique) ;
 * - LOCKED : « Compte LinkedIn restreint », « Voir », ni support ni adresse.
 *
 * Une entrée que le serveur n'a pas pu lire (`unverified`) ne lève rien et n'efface pas l'état retenu avant elle
 * (toastStepFor) : un prestataire instable ne fait pas lever deux fois la même alerte.
 *
 * Lancer : node --test tests/ux/connexion-alerte-direct.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, read, stripComments } from './connexion-helpers.mjs';

const toastMod = await loadTs('src/components/connections/disconnectToast.ts');
const view = await loadTs('src/components/connections/connectionView.ts');
const copy = await loadTs('src/lib/connectionCopy.ts');
const status = await loadTs('src/lib/linkedinStatus.ts');

const ACC = (statusRaw, extra = {}) => ({ id: 'acc_abc', name: 'Camille Martin', status: statusRaw, ...extra });
/** Toast levé quand le compte passe de `fromRaw` à `toRaw`, comme l'effet du contexte le calcule. */
function toastOn(fromRaw, toRaw, account = ACC(toRaw), { isLocked = false } = {}) {
  const previous = status.classifyConnectionHealth({ status: fromRaw });
  const next = status.classifyConnectionHealth({ status: toRaw, isLocked });
  return toastMod.disconnectToastFor(previous, next, account);
}

test('OK vers PARTIAL — son propre toast : une partie de la connexion demande une nouvelle authentification, avec « Reconnecter »', () => {
  const t = toastOn('OK', 'PARTIAL');
  assert.ok(t, 'un toast est levé');
  assert.equal(t.title, 'Connexion LinkedIn partielle');
  assert.equal(t.description, copy.causeReason('authentication_partial', 'linkedin'), 'la phrase de la carte');
  assert.match(t.description, /^Une partie de la connexion LinkedIn demande une nouvelle authentification\./);
  assert.equal(t.actionLabel, 'Reconnecter');
  // Pas la phrase d'une déconnexion ni d'une panne
  assert.doesNotMatch(`${t.title} ${t.description}`, /déconnecté|ne répond plus|expiré/);
  // Le statut brut du prestataire, en minuscules, se lit pareil
  assert.deepEqual(toastOn('OK', 'partial', ACC('partial')), t);
});

test('la phrase du toast partiel est celle de la notification serveur et du bandeau', () => {
  const webhook = read('supabase/functions/unipile-webhook/index.ts');
  const sentence = webhook.match(/const PARTIAL_CONNECTION_SENTENCE = '([^']+)';/)?.[1];
  assert.ok(sentence, 'la phrase de la notification est lue');
  assert.equal(toastOn('OK', 'PARTIAL').description, sentence);
  assert.equal(toastOn('OK', 'PARTIAL').title, 'Connexion LinkedIn partielle');
  assert.match(webhook, /title = 'Connexion LinkedIn partielle'/);
});

test('CREDENTIALS et ERROR gardent leur toast', () => {
  const credentials = toastOn('OK', 'CREDENTIALS');
  assert.deepEqual(credentials, {
    title: 'Camille Martin déconnecté',
    description: 'Votre session LinkedIn a expiré. Reconnectez le compte.',
    actionLabel: 'Reconnecter',
  });
  const error = toastOn('OK', 'ERROR');
  assert.deepEqual(error, {
    title: 'Camille Martin déconnecté',
    description: 'Le compte ne répond plus. Reconnectez-le pour reprendre les envois.',
    actionLabel: 'Reconnecter',
  });
  // Un nom encodé par l'ancien formulaire ne s'affiche pas
  assert.equal(toastOn('OK', 'CREDENTIALS', ACC('CREDENTIALS', { name: 'user:abc|org:def' })).title, 'Compte LinkedIn déconnecté');
});

test('les statuts bruts du prestataire (disconnected, errored) suivent la cause que la carte affiche', () => {
  // « disconnected » demande une authentification, comme CREDENTIALS : la carte dit « session expirée », le toast aussi
  assert.equal(toastOn('OK', 'disconnected', ACC('disconnected')).description, 'Votre session LinkedIn a expiré. Reconnectez le compte.');
  assert.equal(toastOn('OK', 'errored', ACC('errored')).description, 'Le compte ne répond plus. Reconnectez-le pour reprendre les envois.');
});

test('DEGRADED ne lève aucun toast : état de carte, reprise automatique', () => {
  for (const from of ['OK', 'DEGRADED']) assert.equal(toastOn(from, 'DEGRADED'), null, from);
  assert.equal(toastOn('OK', 'degraded', ACC('degraded')), null);
});

test('une connexion limitée qui finit en connexion partielle ou en panne alerte, comme avant', () => {
  assert.equal(toastOn('DEGRADED', 'PARTIAL').title, 'Connexion LinkedIn partielle');
  assert.equal(toastOn('DEGRADED', 'ERROR').description, 'Le compte ne répond plus. Reconnectez-le pour reprendre les envois.');
});

test('aucune alerte pour un premier état connu, un état déjà signalé ou une reprise', () => {
  assert.equal(toastOn('UNKNOWN', 'PARTIAL'), null, 'état inconnu avant');
  assert.equal(toastOn('CONNECTING', 'CREDENTIALS'), null);
  assert.equal(toastOn('PARTIAL', 'ERROR'), null, 'déjà à reconnecter');
  assert.equal(toastOn('CREDENTIALS', 'PARTIAL'), null);
  assert.equal(toastOn('PARTIAL', 'OK'), null, 'retour à la normale');
});

test('même table que les cartes : la phrase du toast suit la cause que la carte affiche', () => {
  for (const raw of ['CREDENTIALS', 'PARTIAL', 'ERROR', 'STOPPED', 'PERMISSIONS', 'DISCONNECTED', 'CAPTCHA', 'ERRORED', 'DELETED']) {
    const account = ACC(raw);
    const cause = view.viewOfAccount({ health: status.classifyConnectionHealth({ status: raw }), status: raw, accountId: account.id }, 'linkedin').cause;
    const t = toastOn('OK', raw, account);
    assert.ok(t, raw);
    if (cause === 'authentication_partial') assert.equal(t.description, copy.ALERT.linkedinPartial, raw);
    else if (cause === 'session_expired') assert.equal(t.description, copy.ALERT.linkedinCredentials, raw);
    else assert.equal(t.description, copy.ALERT.linkedinStopped, raw);
  }
  // Un identifiant d'ancien format n'est ni une session expirée ni une connexion partielle
  const outdated = toastOn('OK', 'PARTIAL', ACC('PARTIAL', { id: 'q8Zr1TnWQeG4mXvH2dKpLa' }));
  assert.equal(outdated.description, copy.ALERT.linkedinStopped);
});

test('compte restreint — « Compte LinkedIn restreint », la phrase de la carte, « Voir », ni support ni adresse', () => {
  const t = toastOn('OK', 'OK', ACC('OK'), { isLocked: true });
  assert.ok(t);
  assert.equal(t.title, 'Compte LinkedIn restreint');
  assert.equal(t.description, copy.healthReason('locked', 'linkedin'), 'la phrase de la carte');
  assert.equal(t.actionLabel, 'Voir', 'se reconnecter n\'y change rien');
  assert.notEqual(t.actionLabel, 'Reconnecter');
  assert.doesNotMatch(`${t.title} ${t.description}`, /suspendu|support|débloquer|écrivez|@/i);
  for (const re of [/restreint par LinkedIn/, /en pause/, /Se reconnecter n'y change rien/, /Patientez/, /directement sur LinkedIn/]) {
    assert.match(t.description, re);
  }
  // Même titre que le bandeau, la ligne d'« À traiter » et la notification
  assert.match(read('src/components/dashboard/DashboardFocusPanel.tsx'), /title="Compte LinkedIn restreint"/);
  assert.match(read('src/components/sidebar/todo/LinkedInOutageSection.tsx'), /title: 'Compte LinkedIn restreint'/);
  assert.match(read('supabase/functions/unipile-webhook/index.ts'), /title = 'Compte LinkedIn restreint'/);
  // Statut LOCKED seul, d'un compte qui tournait ou qui tournait au ralenti
  assert.equal(toastOn('OK', 'LOCKED', ACC('LOCKED')).title, 'Compte LinkedIn restreint');
  assert.equal(toastOn('DEGRADED', 'LOCKED', ACC('LOCKED')).title, 'Compte LinkedIn restreint');
  assert.equal(toastOn('LOCKED', 'LOCKED', ACC('LOCKED')), null, 'déjà signalé');
});

/** Suite de listes reçues par le contexte : les alertes levées, comme l'effet du contexte les calcule. */
function polls(accounts) {
  let memory = null;
  const raised = [];
  for (const account of accounts) {
    const step = toastMod.toastStepFor(memory, account);
    memory = step.memory;
    if (step.toast) raised.push(step.toast.title);
  }
  return raised;
}
const withoutMarker = ({ unverified: _unverified, ...rest }) => rest;

test('une lecture ratée entre deux lectures PARTIAL ne fait pas lever deux fois la même alerte', () => {
  const sequence = [
    ACC('OK'),
    ACC('PARTIAL'),
    // Prestataire instable : l'entrée porte le dernier statut enregistré (« OK », le webhook n'est pas passé) et le marqueur
    ACC('OK', { unverified: true }),
    ACC('PARTIAL'),
  ];
  assert.deepEqual(polls(sequence), ['Connexion LinkedIn partielle'], 'une seule alerte');
  // Preuve que la suite compte : lue comme une entrée normale, la lecture ratée ferait lever l'alerte une seconde fois
  assert.deepEqual(polls(sequence.map(withoutMarker)), ['Connexion LinkedIn partielle', 'Connexion LinkedIn partielle']);
});

test('une entrée non lue ne lève rien, quel que soit son dernier statut, et ne change pas la mémoire', () => {
  for (const stored of ['OK', 'DEGRADED', 'CREDENTIALS', 'ERROR', 'PARTIAL', 'LOCKED']) {
    // Compte qui tournait, puis lecture ratée : pas d'alerte, même si le dernier statut enregistré est une panne
    const step = toastMod.toastStepFor({ accountId: 'acc_abc', health: 'connected' }, ACC(stored, { unverified: true, is_locked: stored === 'LOCKED' }));
    assert.equal(step.toast, null, stored);
    assert.deepEqual(step.memory, { accountId: 'acc_abc', health: 'connected' }, `${stored} : la mémoire reste celle de la dernière vraie lecture`);
  }
  // Sans mémoire : la mémoire reste vide, et la première vraie lecture ne lève rien non plus
  assert.equal(toastMod.toastStepFor(null, ACC('OK', { unverified: true })).memory, null);
  assert.deepEqual(polls([ACC('CREDENTIALS', { unverified: true }), ACC('CREDENTIALS')]), [], 'premier passage pour ce compte : pas d\'alerte');
  // Une lecture ratée après une alerte ne la rejoue pas à la lecture suivante, et une vraie reprise puis une nouvelle panne alerte de nouveau
  assert.deepEqual(polls([ACC('OK'), ACC('CREDENTIALS'), ACC('OK', { unverified: true }), ACC('CREDENTIALS')]), ['Camille Martin déconnecté']);
  assert.deepEqual(polls([ACC('OK'), ACC('PARTIAL'), ACC('OK'), ACC('PARTIAL')]), ['Connexion LinkedIn partielle', 'Connexion LinkedIn partielle'], 'une vraie reprise réarme l\'alerte');
});

test('le pas de l\'alerte garde le comportement connu : premier passage, changement de compte, verrou', () => {
  const first = toastMod.toastStepFor(null, ACC('PARTIAL'));
  assert.equal(first.toast, null, 'premier passage');
  assert.deepEqual(first.memory, { accountId: 'acc_abc', health: 'needs_reconnect' });
  // Un autre compte (relié entre-temps) : on repart de lui, sans alerte
  const other = toastMod.toastStepFor({ accountId: 'acc_ancien', health: 'connected' }, ACC('CREDENTIALS'));
  assert.equal(other.toast, null);
  assert.equal(other.memory.accountId, 'acc_abc');
  // Verrou posé sur un compte actif : alerte « restreint »
  const locked = toastMod.toastStepFor({ accountId: 'acc_abc', health: 'connected' }, ACC('OK', { is_locked: true }));
  assert.equal(locked.toast.title, 'Compte LinkedIn restreint');
  assert.equal(locked.memory.health, 'locked');
});

test('le contexte affiche ce que la fonction décide, sans seconde copie des statuts', () => {
  const ctx = stripComments(read('src/contexts/LinkedInAccountsContext.tsx'));
  assert.match(ctx, /import \{ toastStepFor, type ToastMemory \} from '@\/components\/connections\/disconnectToast';/);
  assert.match(ctx, /const step = toastStepFor\(prevHealthRef\.current, acc\);\s*prevHealthRef\.current = step\.memory;\s*const alert = step\.toast;\s*if \(!alert\) return;/);
  assert.doesNotMatch(ctx, /classifyConnectionHealth|disconnectToastFor\(/, 'la classe de santé et le texte ne sont plus lus dans le contexte');
  assert.match(ctx, /toast\.error\(alert\.title, \{\s*description: alert\.description,\s*duration: 12000,\s*action: \{\s*label: alert\.actionLabel,/);
  assert.doesNotMatch(ctx, /ALERT\.|isCredentials|'CREDENTIALS'|'PARTIAL'|toUpperCase\(\)/, 'le texte et les statuts ne sont plus lus dans le contexte');
  const mod = stripComments(read('src/components/connections/disconnectToast.ts'));
  assert.doesNotMatch(mod, /'CREDENTIALS'|'PARTIAL'|'ERROR'|toUpperCase\(\)/, 'la cause vient de causeOfReconnect, pas d\'une seconde table de statuts');
  assert.match(mod, /causeOfReconnect\(\{ status: account\.status, accountId: account\.id \}\)/);
});

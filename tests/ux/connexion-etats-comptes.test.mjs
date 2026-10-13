/**
 * Cartes de Connexions (Paramètres, Connexions), constats F1, F2, F3, F4, F5, F7, F8,
 * F11, F16 de la visite de l'application et R8 de la répétition de la bascule.
 *
 * - modules purs : une phrase par cause (session expirée, panne de connexion,
 *   authentification partielle, identifiant à refaire, compte retiré, état non lu), les
 *   lignes de la carte e-mail (toutes les boîtes), le format de l'identifiant d'un compte,
 *   la garde « un seul à la fois » ;
 * - garde statique des écrans : paramètre ?connection-native monté, compte retiré lu de la
 *   même façon sur les trois cartes, état non lu sans « Actif », liste e-mail partagée,
 *   gestes protégés contre le double clic.
 *
 * Deuxième série (cartes) : pierre tombale WhatsApp d'une déconnexion voulue, carte e-mail
 * (boîte nommée dans la confirmation et les boutons, « Réessayer » bloqué pendant la lecture,
 * deux boîtes sans adresse connue, relecture à l'ouverture), compte restreint (même mot et
 * même phrase que le bandeau, aucun bouton ni adresse), liste e-mail du tableau de bord partagée.
 *
 * Lancer : node --test tests/ux/connexion-etats-comptes.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs, read, stripComments, ROOT } from './connexion-helpers.mjs';

const copy = await loadTs('src/lib/connectionCopy.ts');
const view = await loadTs('src/components/connections/connectionView.ts');
const rows = await loadTs('src/components/connections/mailboxRows.ts');
const flight = await loadTs('src/components/connections/singleFlight.ts');
const ids = await loadTs('src/lib/accountIdFormat.ts');
const status = await loadTs('src/lib/linkedinStatus.ts');
const freshness = await loadTs('src/components/connections/emailListFreshness.ts');

const PROVIDERS = ['linkedin', 'whatsapp', 'google', 'outlook', 'imap'];
const code = (f) => stripComments(read(f));

/** Vue d'un compte d'après son statut brut, comme les cartes la calculent. */
const of = (provider, raw, extra = {}) => view.viewOfAccount(
  { health: status.classifyConnectionHealth({ status: raw }), status: raw, ...extra },
  provider,
);

// ------------------------------------------------------------------ format de l'identifiant (R8)
test('R8 — un identifiant « acc_… » est actuel, tout autre format est ancien', () => {
  for (const ok of ['acc_abc', 'acc_A1-b_2', 'acc_tourcamille000000000li01']) {
    assert.equal(ids.isCurrentAccountId(ok), true, ok);
    assert.equal(ids.hasOutdatedAccountId(ok), false, ok);
  }
  for (const old of ['q8Zr1TnWQeG4mXvH2dKpLa', 'u0Ht4KdMX7jNfC1yPqSbWe', 'acc', 'acc_', 'ACC_x', 'xacc_1', 'acc_a/b']) {
    assert.equal(ids.isCurrentAccountId(old), false, old);
    assert.equal(ids.hasOutdatedAccountId(old), true, old);
  }
  // Une valeur absente n'est pas un ancien format : rien à affirmer
  for (const none of [null, undefined, '', '   ', 42, {}]) {
    assert.equal(ids.hasOutdatedAccountId(none), false, String(none));
  }
});

// ------------------------------------------------------------------ une phrase par cause (F8, R8)
test('F8 — session expirée, panne de connexion et authentification partielle ont chacune leur phrase', () => {
  for (const provider of ['linkedin', 'whatsapp', 'google']) {
    const credentials = of(provider, 'CREDENTIALS');
    const error = of(provider, 'ERROR');
    const partial = of(provider, 'PARTIAL');
    assert.equal(credentials.cause, 'session_expired', provider);
    assert.equal(error.cause, 'connection_error', provider);
    assert.equal(partial.cause, 'authentication_partial', provider);
    assert.equal(new Set([credentials.reason, error.reason, partial.reason]).size, 3, `${provider} : trois phrases distinctes`);
    // Un compte à reconnecter propose « Reconnecter », pour chacune des trois causes
    for (const v of [credentials, error, partial]) {
      assert.equal(v.action, 'reconnect', provider);
      assert.equal(v.actionLabel, 'Reconnecter', provider);
      assert.equal(v.reconnect, 'in_place', provider);
    }
  }
  assert.match(of('linkedin', 'CREDENTIALS').reason, /Votre session LinkedIn a expiré/);
  // Une panne du service n'est pas une session expirée
  assert.doesNotMatch(of('linkedin', 'ERROR').reason, /expiré|session/);
  assert.match(of('linkedin', 'ERROR').reason, /rencontre un problème/);
  assert.doesNotMatch(of('linkedin', 'PARTIAL').reason, /expiré|session/);
  assert.match(of('linkedin', 'PARTIAL').reason, /nouvelle authentification/);
  for (const raw of ['ERRORED', 'STOPPED', 'PERMISSIONS']) assert.equal(of('linkedin', raw).cause, 'connection_error', raw);
  for (const raw of ['DISCONNECTED', 'CAPTCHA']) assert.equal(of('linkedin', raw).cause, 'session_expired', raw);
});

test('F8 — connexion limitée (DEGRADED) : reprise automatique, aucun bouton Reconnecter', () => {
  for (const provider of PROVIDERS) {
    const v = of(provider, 'DEGRADED');
    assert.equal(v.health, 'limited', provider);
    assert.equal(v.action, null, provider);
    assert.equal(v.actionLabel, null, provider);
    assert.match(v.reason, /Nouvelle tentative automatique/, provider);
    assert.equal(v.cause, null, provider);
  }
});

test('R8 — un identifiant d\'un ancien format : « doit être refaite », sans parler de session ni de pause', () => {
  for (const [provider, raw] of [['linkedin', 'CREDENTIALS'], ['google', 'CREDENTIALS'], ['whatsapp', 'CREDENTIALS'], ['linkedin', 'ERROR']]) {
    const v = of(provider, raw, { accountId: 'q8Zr1TnWQeG4mXvH2dKpLa' });
    assert.equal(v.cause, 'outdated_identifier', `${provider} ${raw}`);
    assert.match(v.reason, /^Cette connexion doit être refaite\./, provider);
    assert.doesNotMatch(v.reason, /session|expiré|pause|envois/i, `${provider} : aucune affirmation sur la session ni les envois`);
    assert.equal(v.action, 'reconnect', provider);
    assert.equal(v.actionLabel, 'Reconnecter', provider);
  }
  // Même statut avec un identifiant actuel : la phrase d'une session expirée
  assert.equal(of('linkedin', 'CREDENTIALS', { accountId: 'acc_abc' }).cause, 'session_expired');
  assert.equal(of('linkedin', 'CREDENTIALS', { accountId: null }).cause, 'session_expired');
  // Un compte actif ne devient pas « à refaire » : l'identifiant ne compte que pour un compte à reconnecter
  assert.equal(of('linkedin', 'OK', { accountId: 'q8Zr1TnWQeG4mXvH2dKpLa' }).health, 'connected');
  assert.equal(of('linkedin', 'OK', { accountId: 'q8Zr1TnWQeG4mXvH2dKpLa' }).cause, null);
});

// ------------------------------------------------------------------ compte retiré : une phrase, un geste (F4)
test('F4 — un compte retiré chez le prestataire se lit pareil sur les trois cartes : « À reconnecter » et « Reconnecter »', () => {
  const seen = [];
  for (const provider of ['linkedin', 'google', 'outlook', 'imap', 'whatsapp']) {
    const v = of(provider, 'DELETED', { accountId: 'acc_gone' });
    assert.equal(v.label, 'À reconnecter', provider);
    assert.equal(v.cause, 'removed', provider);
    assert.match(v.reason, /n'est plus disponible\. Reconnectez-(?:le|la) : la nouvelle connexion remplacera celle-ci\./, provider);
    assert.equal(v.action, 'reconnect', provider);
    assert.equal(v.actionLabel, 'Reconnecter', provider);
    assert.equal(v.reconnect, 'new_link', `${provider} : le compte n'existe plus, le geste ouvre une nouvelle connexion`);
    seen.push(v.reason);
  }
  const template = (reason) => reason.replace(/Ce compte LinkedIn|Cette messagerie|Ce compte WhatsApp/, 'X').replace(/Reconnectez-(?:le|la)/, 'Reconnectez-le');
  assert.equal(new Set(seen.map(template)).size, 1, 'une seule phrase, au nom du canal et à l\'accord près');
  // Un identifiant ancien et un compte retiré : le retrait l'emporte (rien à renouveler en place)
  assert.equal(of('google', 'DELETED', { accountId: 'q8Zr1TnWQeG4mXvH2dKpLa' }).cause, 'removed');
  // Le compte disparu de la carte LinkedIn (absent d'une liste reçue) passe par le même état
  assert.equal(of('linkedin', 'DELETED').cause, 'removed');
});

test('F4 — un compte retiré remplacé par une nouvelle connexion ne reste pas affiché à côté d\'elle', () => {
  const gone = { id: 'acc_gone', status: 'DELETED', identifier: 'Camille@Horizon.example' };
  const live = { id: 'acc_new', status: 'OK', identifier: 'camille@horizon.example' };
  const other = { id: 'acc_other', status: 'OK', identifier: 'autre@horizon.example' };
  // Messagerie : même adresse (casse comprise) = remplacée ; une autre adresse reste
  assert.deepEqual(view.withoutSupersededRemoved([gone, live], 'email').map((a) => a.id), ['acc_new']);
  assert.deepEqual(view.withoutSupersededRemoved([gone, other], 'email').map((a) => a.id), ['acc_gone', 'acc_other']);
  assert.deepEqual(view.withoutSupersededRemoved([gone], 'email').map((a) => a.id), ['acc_gone'], 'seul : à reconnecter');
  // WhatsApp : une seule ligne, n'importe quel compte vivant remplace le retiré
  assert.deepEqual(view.withoutSupersededRemoved([gone, other], 'whatsapp').map((a) => a.id), ['acc_other']);
  assert.deepEqual(view.withoutSupersededRemoved([gone], 'whatsapp').map((a) => a.id), ['acc_gone']);
  assert.deepEqual(view.withoutSupersededRemoved([], 'whatsapp'), []);
});

// ------------------------------------------------------------------ état non lu (F3)
test('F3 — un compte que le prestataire n\'a pas répondu : « État à vérifier » et « Réessayer », jamais « Actif »', () => {
  for (const provider of PROVIDERS) {
    // Dernier état connu « OK » : c'est précisément le cas qui affichait « Actif »
    const v = view.viewOfAccount({ health: 'connected', status: 'OK', unverified: true }, provider);
    assert.equal(v.health, 'unknown', provider);
    assert.equal(v.label, 'État à vérifier', provider);
    assert.notEqual(v.label, 'Actif', provider);
    assert.equal(v.tone, 'warning', provider);
    assert.equal(v.action, 'refresh', provider);
    assert.equal(v.actionLabel, 'Réessayer', provider);
    assert.equal(v.cause, 'unreadable', provider);
    assert.match(v.reason, /pas pu lire l'état de ce compte pour le moment/, provider);
  }
  // Même un dernier état « à reconnecter » ou « suspendu » ne s'affiche pas comme lu
  for (const raw of ['CREDENTIALS', 'LOCKED', 'DEGRADED']) {
    const v = view.viewOfAccount({ health: status.classifyConnectionHealth({ status: raw }), status: raw, unverified: true }, 'linkedin');
    assert.equal(v.label, 'État à vérifier', raw);
  }
  // Un compte lu (unverified absent ou faux) garde son état
  assert.equal(of('linkedin', 'OK').label, 'Actif');
  assert.equal(view.viewOfAccount({ health: 'connected', status: 'OK', unverified: false }, 'linkedin').label, 'Actif');
});

test('F3 — la carte LinkedIn ne montre ni « Actif », ni offre, ni contrat d\'un compte non lu', () => {
  const src = code('src/components/settings/MyLinkedInAccount.tsx');
  assert.match(src, /const unverified = myAccount\?\.unverified === true;/);
  assert.match(src, /unverified,\s*\}, 'linkedin'\);/, 'la lecture non vérifiée passe à la vue');
  assert.match(src, /const offer = unverified \? null : offerLabelOf\(myAccount\?\.subscriptions\);/, 'jamais une offre qui n\'a pas été lue');
  assert.match(src, /li\.isUsable && !unverified && \(/, 'ni invitations ni contrat d\'un compte non lu');
  assert.match(src, /\{view\.actionLabel \?\? CARD_COMMON\.refresh\}/, '« Réessayer » vient de la vue');
});

// ------------------------------------------------------------------ toutes les boîtes e-mail (F5)
const MAPS = {
  gmail: { id: 'm1', email_account_id: 'acc_gmail', email_address: 'camille.martin@horizon.example', provider: 'GOOGLE' },
  outlook: { id: 'm2', email_account_id: 'acc_outlook', email_address: 'c.martin@horizon-conseil.example', provider: 'OUTLOOK' },
  imap: { id: 'm3', email_account_id: 'acc_imap', email_address: 'camille@mail.horizon.example', provider: 'IMAP' },
};
const LISTED = [
  { id: 'acc_gmail', identifier: 'camille.martin@horizon.example', status: 'OK', type: 'GOOGLE' },
  { id: 'acc_outlook', identifier: 'c.martin@horizon-conseil.example', status: 'CREDENTIALS', type: 'OUTLOOK' },
  { id: 'acc_imap', identifier: 'camille@mail.horizon.example', status: 'OK', type: 'IMAP' },
];

test('F5 — chaque boîte reliée a sa ligne, avec son état et ses gestes, celle à reconnecter d\'abord', () => {
  const built = rows.buildMailboxRows([MAPS.gmail, MAPS.outlook, MAPS.imap], LISTED, false);
  assert.equal(built.length, 3, 'les trois boîtes sont listées');
  assert.deepEqual(built.map((r) => r.mapping.id), ['m2', 'm1', 'm3'], 'la boîte à reconnecter passe devant, ordre conservé ensuite');
  const outlook = built[0];
  assert.equal(outlook.provider, 'outlook');
  assert.equal(outlook.address, 'c.martin@horizon-conseil.example');
  assert.equal(outlook.view.label, 'À reconnecter');
  assert.equal(outlook.view.action, 'reconnect');
  assert.equal(outlook.mapping.email_account_id, 'acc_outlook', 'le geste vise cette boîte-là');
  assert.equal(built[1].view.label, 'Actif');
  assert.equal(built[1].view.action, null);
  assert.deepEqual(built.map((r) => r.provider), ['outlook', 'google', 'imap']);
});

test('F5 — une seule boîte : une seule ligne, comme avant', () => {
  const built = rows.buildMailboxRows([MAPS.gmail], LISTED, false);
  assert.equal(built.length, 1);
  assert.equal(built[0].view.label, 'Actif');
  assert.equal(built[0].address, 'camille.martin@horizon.example');
  assert.deepEqual(rows.buildMailboxRows([], LISTED, false), [], 'aucune liaison : aucune ligne (état « à connecter »)');
});

test('F5 — liste non reçue : chaque boîte est « à vérifier », liste reçue sans la boîte : compte retiré', () => {
  const failed = rows.buildMailboxRows([MAPS.gmail, MAPS.outlook], [], true);
  assert.deepEqual(failed.map((r) => r.view.label), ['État à vérifier', 'État à vérifier']);
  assert.ok(failed.every((r) => r.view.actionLabel === 'Réessayer'));
  assert.ok(failed.every((r) => r.mapping.email_account_id.startsWith('acc_')), 'les liaisons restent connues : Dissocier reste possible');
  const gone = rows.buildMailboxRows([MAPS.gmail], [], false);
  assert.equal(gone[0].view.label, 'À reconnecter');
  assert.equal(gone[0].view.cause, 'removed');
  assert.equal(gone[0].view.reconnect, 'new_link');
});

test('F4 et R8 sur la carte e-mail : compte retiré remplacé, identifiant ancien à refaire', () => {
  // Boîte retirée (DELETED) et nouvelle boîte de la même adresse : une seule ligne
  const replaced = rows.buildMailboxRows(
    [{ ...MAPS.gmail, id: 'old', email_account_id: 'acc_old' }, MAPS.gmail],
    [{ id: 'acc_old', identifier: 'camille.martin@horizon.example', status: 'DELETED' }, LISTED[0]],
    false,
  );
  assert.deepEqual(replaced.map((r) => r.mapping.email_account_id), ['acc_gmail']);
  // Identifiant d'un ancien format renvoyé par la liste en CREDENTIALS : la connexion est à refaire
  const outdated = rows.buildMailboxRows(
    [{ id: 'm9', email_account_id: 'q8Zr1TnWQeG4mXvH2dKpLa', email_address: 'ancien@horizon.example', provider: 'GOOGLE' }],
    [{ id: 'q8Zr1TnWQeG4mXvH2dKpLa', identifier: 'ancien@horizon.example', status: 'CREDENTIALS', type: 'GOOGLE' }],
    false,
  );
  assert.equal(outdated[0].view.cause, 'outdated_identifier');
  assert.match(outdated[0].view.reason, /^Cette connexion doit être refaite\./);
  // Nom lisible : jamais vide, jamais un nom qui porte l'état d'une ancienne connexion
  const noName = rows.buildMailboxRows([{ id: 'm8', email_account_id: 'acc_x', email_address: null, provider: 'OUTLOOK' }], [{ id: 'acc_x', status: 'OK' }], false);
  assert.equal(noName[0].address, 'Messagerie Outlook');
});

test('F5 — la carte e-mail liste toutes les boîtes de la personne, sans appel propre au serveur', () => {
  const src = code('src/components/settings/MyEmailAccount.tsx');
  assert.match(src, /mappings\.filter\(\(m\) => m\.user_id === currentUserId\)/, 'toutes les liaisons de la personne, pas la première');
  assert.doesNotMatch(src, /getMappingForUser/);
  assert.match(src, /rows\.map\(\(row\) => \(\s*<MyMailbox/);
  assert.match(src, /extraAction=\{rows\.length === 1 \? refreshButton : undefined\}/, 'une seule boîte : la ligne compacte d\'avant');
  assert.match(src, /\{rows\.length > 1 && \(\s*<div className="flex justify-end">\{refreshButton\}<\/div>/);
});

// ------------------------------------------------------------------ liste e-mail partagée (F16)
test('F16 — la liste e-mail est une requête partagée : plus d\'effet qui relit à chaque changement de contexte', () => {
  const card = code('src/components/settings/MyEmailAccount.tsx');
  assert.doesNotMatch(card, /invokeEdgeFunction|list_email|setLoadingAccounts|loadEmailAccounts/, 'la carte ne lit plus la liste elle-même');
  assert.match(card, /const list = useMemberEmailList\(\{ rereadOnMount: true \}\);/);
  const hook = code('src/components/connections/useMemberEmailList.ts');
  assert.match(hook, /useQuery<MemberEmailListEntry\[\]>\(/);
  assert.match(hook, /export const MEMBER_EMAIL_LIST_KEY = \['member-email-accounts', 'list'\] as const;/);
  assert.match(hook, /queryKey: \[\.\.\.MEMBER_EMAIL_LIST_KEY, organizationId, user\?\.id\]/);
  assert.match(hook, /enabled: isReady && !!user\?\.id && !!organizationId,/);
  assert.match(hook, /retry: false,/, 'une lecture ratée s\'affiche tout de suite avec « Réessayer »');
  assert.match(hook, /action: 'list_email'/);
  // Après une dissociation ou une connexion, les liaisons sont invalidées par leur préfixe : la liste suit
  assert.match(code('src/hooks/useMemberEmailAccounts.ts'), /invalidateQueries\(\{ queryKey: \['member-email-accounts'\] \}\)/);
  assert.match(code('src/hooks/useConnection.ts'), /\['member-email-accounts'\],/);
});

// ------------------------------------------------------------------ cartes : mêmes états sur les trois canaux (F2, F4)
test('F2 — WhatsApp : une lecture ratée sans donnée est une erreur avec « Réessayer », jamais « Connecter WhatsApp »', () => {
  const src = code('src/components/settings/MyWhatsAppAccount.tsx');
  const error = src.indexOf('isError && accounts.length === 0 ? (');
  const empty = src.indexOf('listedAccounts.length === 0 && (');
  assert.ok(error > 0 && empty > error, 'l\'erreur est jugée avant l\'état « aucun compte »');
  assert.match(src.slice(error, empty), /<ErrorState variant="compact" title=\{WHATSAPP_CARD\.loadFailedTitle\}[\s\S]*onRetry=\{\(\) => \{ void refetch\(\); \}\}/);
  // Et la liste affichée ne masque plus un compte retiré : il passe par la même vue que les autres
  assert.doesNotMatch(src, /status !== 'DELETED'/);
  assert.match(src, /viewOfAccount\(/);
  assert.match(src, /withoutSupersededRemoved\(/);
});

test('F4 — les trois cartes lisent un compte retiré par viewOfAccount et le reconnectent par une nouvelle connexion', () => {
  for (const f of ['src/components/settings/MyLinkedInAccount.tsx', 'src/components/settings/MyEmailAccount.tsx', 'src/components/settings/MyWhatsAppAccount.tsx']) {
    assert.match(code(f), /startsNew=\{view\.reconnect === 'new_link'\}/, f);
  }
  assert.doesNotMatch(code('src/components/settings/MyLinkedInAccount.tsx'), /missingTitle|Compte LinkedIn introuvable/);
  assert.doesNotMatch(code('src/lib/connectionCopy.ts'), /Compte LinkedIn introuvable|Compte e-mail introuvable|missingTitle|missingBody/, 'plus de seconde formulation du compte retiré');
  assert.doesNotMatch(code('src/components/settings/MyEmailAccount.tsx'), /missingTitle|missingBody|checkErrorTitle|keptBody/);
  const parts = code('src/components/connections/ConnectionParts.tsx');
  assert.match(parts, /reconnectAccountId: startsNew \? null : accountId/, 'nouvelle connexion : aucun compte à renouveler');
  // WhatsApp : un compte retiré n'a rien à déconnecter ; un compte déconnecté à l'instant disparaît de la carte
  const wa = code('src/components/settings/MyWhatsAppAccount.tsx');
  assert.match(wa, /view\.cause !== 'removed' && \(\s*<RemovalDialog/);
  assert.match(wa, /setJustDisconnected\(previous => new Set\(previous\)\.add\(accountId\)\);/);
});

// ------------------------------------------------------------------ ?connection-native (F1)
test('F1 — ?connection-native=1|0 est lu par AppLayout, comme ?sequences-v2', () => {
  const layout = code('src/components/AppLayout.tsx');
  assert.match(layout, /import \{ useConnectionNativeParamSync \} from '@\/hooks\/useConnection';/);
  assert.match(layout, /^\s*useConnectionNativeParamSync\(\);$/m, 'le hook est appelé, pas seulement importé');
  assert.ok(layout.indexOf('useSequencesBetaParamSync();') > 0 && layout.indexOf('useConnectionNativeParamSync();') > layout.indexOf('useSequencesBetaParamSync();'));
  // Le hook écrit l'interrupteur puis retire le paramètre de l'adresse, sans entrée d'historique
  const hook = code('src/hooks/useConnection.ts');
  const body = hook.slice(hook.indexOf('export function useConnectionNativeParamSync'), hook.indexOf('/** Champ des capacités'));
  assert.match(body, /setConnectionNative\(requested\);/);
  assert.match(body, /navigate\(`\$\{pathname\}\$\{withoutConnectionNativeParam\(search\)\}\$\{hash\}`, \{ replace: true \}\);/);
  // Aucune autre page ne doit l'appeler : un seul montage
  const callers = ['src/components/AppLayout.tsx', 'src/components/connections/NativeConnectSlot.tsx', 'src/components/settings/MyLinkedInAccount.tsx']
    .filter((f) => /useConnectionNativeParamSync\(\)/.test(code(f)));
  assert.deepEqual(callers, ['src/components/AppLayout.tsx']);
});

// ------------------------------------------------------------------ validation sur le téléphone (F7)
test('F7 — la validation sur le téléphone n\'a pas de code à renvoyer : le décompte parle de la notification', () => {
  assert.equal(copy.CHECKPOINT.resendNotificationIn(29), 'Renvoyer la notification dans 29 s');
  assert.doesNotMatch(copy.CHECKPOINT.resendNotificationIn(29), /code/i);
  assert.equal(copy.CHECKPOINT.resendIn(29), 'Renvoyer le code dans 29 s', 'un code reçu garde son décompte');
  const src = code('src/components/connections/native/steps/CheckpointSteps.tsx');
  assert.match(src, /const waiting = notification \? CHECKPOINT\.resendNotificationIn\(left\) : CHECKPOINT\.resendIn\(left\);/);
  assert.match(src, /const label = left > 0 \? waiting : notification \? CHECKPOINT\.resendNotification : CHECKPOINT\.resend;/);
  // WaitStep (validation sur le téléphone) utilise la notification, CodeStep le code
  assert.match(src, /<ResendButton notification sentAt=\{sentAt\}/);
  assert.match(src, /<ResendButton notification=\{false\} sentAt=\{sentAt\}/);
});

// ------------------------------------------------------------------ double clic (F11)
test('F11 — la garde « un seul à la fois » : le second appel d\'un double clic ne part pas', async () => {
  const once = flight.createSingleFlight();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const task = async () => { calls += 1; await gate; return 'fait'; };
  // Deux clics dans le même instant : avant le moindre rendu
  const first = once(task);
  const second = once(task);
  assert.equal(await second, undefined, 'le second clic est ignoré');
  release();
  assert.equal(await first, 'fait');
  assert.equal(calls, 1);
  // Le geste fini, un nouveau clic repart
  assert.equal(await once(async () => { calls += 1; return 'encore'; }), 'encore');
  assert.equal(calls, 2);
});

test('F11 — la garde se lève après un échec, et l\'échec remonte à l\'appelant', async () => {
  const once = flight.createSingleFlight();
  await assert.rejects(once(async () => { throw new Error('refus'); }), /refus/);
  assert.equal(await once(async () => 'reparti'), 'reparti');
  // Deux gardes sont indépendantes : un geste n'en bloque pas un autre
  const a = flight.createSingleFlight();
  const b = flight.createSingleFlight();
  let release;
  const pending = a(() => new Promise((resolve) => { release = resolve; }));
  assert.equal(await b(async () => 'autre geste'), 'autre geste');
  release('ok');
  await pending;
});

test('F11 — « Utiliser » un contrat et « Déconnecter » WhatsApp passent par la garde', () => {
  const extras = code('src/components/connections/LinkedInExtras.tsx');
  assert.match(extras, /const once = useMemo\(\(\) => createSingleFlight\(\), \[\]\);/);
  assert.match(extras, /onClick=\{\(\) => \{ void once\(\(\) => select\.mutateAsync\(contract\)\.catch\(\(\) => undefined\)\); \}\}/);
  assert.doesNotMatch(extras, /onClick=\{\(\) => select\.mutate\(contract\)\}/, 'plus d\'appel direct');
  const wa = code('src/components/settings/MyWhatsAppAccount.tsx');
  assert.match(wa, /const once = useMemo\(\(\) => createSingleFlight\(\), \[\]\);/);
  assert.match(wa, /onConfirm=\{\(\) => \{ void once\(\(\) => onDisconnect\(account\.id\)\); \}\}/);
  assert.doesNotMatch(wa, /onConfirm=\{\(\) => \{ void onDisconnect\(account\.id\); \}\}/);
});

// ================================================================== deuxième série (cartes)

// ------------------------------------------------------------------ pierre tombale WhatsApp
const WA = {
  bye: { id: 'acc_bye', status: 'DELETED', identifier: '+33611111111', removed_by_member: true },
  bye2: { id: 'acc_bye2', status: 'DELETED', identifier: '+33611111112', removed_by_member: true },
  bye3: { id: 'acc_bye3', status: 'DELETED', identifier: '+33611111113', removed_by_member: true },
  vanished: { id: 'acc_gone', status: 'DELETED', identifier: '+33622222222', removed_by_member: false },
  legacy: { id: 'acc_old', status: 'DELETED', identifier: '+33633333333' },
  live: { id: 'acc_live', status: 'OK', identifier: '+33644444444', removed_by_member: false },
};
/** Comptes listés par la carte WhatsApp, dans l'ordre de ses filtres. */
const shownOnWhatsApp = (accounts) => view.withoutSupersededRemoved(view.withoutDeliberateDisconnects(accounts), 'whatsapp').map((a) => a.id);

test('WhatsApp — la trace d\'une déconnexion voulue (removed_by_member vrai) est masquée, vrai, faux et champ absent', () => {
  assert.deepEqual(view.withoutDeliberateDisconnects([WA.bye, WA.vanished, WA.legacy, WA.live]).map((a) => a.id), ['acc_gone', 'acc_old', 'acc_live']);
  // Seul le booléen vrai masque : null, absent, texte ou nombre ne masquent rien
  for (const odd of [null, undefined, 'true', 1, 'yes']) {
    assert.equal(view.withoutDeliberateDisconnects([{ id: 'x', status: 'DELETED', removed_by_member: odd }]).length, 1, String(odd));
  }
  assert.deepEqual(view.withoutDeliberateDisconnects([]), []);
});

test('WhatsApp — après un rechargement, une déconnexion voulue ne laisse aucune ligne « À reconnecter »', () => {
  // Trois « Déconnecter » successifs : trois traces, aucune ligne (avant : trois lignes identiques)
  assert.deepEqual(shownOnWhatsApp([WA.bye, WA.bye2, WA.bye3]), []);
  // La trace seule : la carte retrouve l'état « à connecter »
  assert.deepEqual(shownOnWhatsApp([WA.bye]), []);
  // Un compte disparu chez le prestataire (removed_by_member faux) ou d'une réponse sans le champ reste « À reconnecter »
  assert.deepEqual(shownOnWhatsApp([WA.bye, WA.vanished]), ['acc_gone']);
  assert.deepEqual(shownOnWhatsApp([WA.legacy]), ['acc_old']);
  for (const gone of [WA.vanished, WA.legacy]) {
    const v = view.viewOfAccount({ health: status.classifyConnectionHealth({ status: gone.status }), status: gone.status, accountId: gone.id }, 'whatsapp');
    assert.equal(v.label, 'À reconnecter');
    assert.equal(v.cause, 'removed');
    assert.equal(v.action, 'reconnect');
  }
  // Un compte vivant remplace le disparu ; les traces ne reviennent pas
  assert.deepEqual(shownOnWhatsApp([WA.bye, WA.bye2, WA.vanished, WA.live]), ['acc_live']);
});

test('WhatsApp — la carte masque les traces avant de juger les remplacements', () => {
  const src = code('src/components/settings/MyWhatsAppAccount.tsx');
  assert.match(src, /withoutSupersededRemoved\(\s*withoutDeliberateDisconnects\(accounts\)\.filter\(account => !justDisconnected\.has\(account\.id\)\),\s*'whatsapp',\s*\)/);
  assert.match(src, /import \{ viewOfAccount, withoutDeliberateDisconnects, withoutSupersededRemoved \} from '@\/components\/connections\/connectionView';/);
});

// ------------------------------------------------------------------ carte e-mail : la boîte visée est nommée
test('E-mail — la confirmation, le nom accessible des boutons et le message nomment la boîte', () => {
  const addr = 'jean@exemple.fr';
  assert.equal(copy.EMAIL_CARD.unlinkTitle(addr), 'Dissocier la boîte jean@exemple.fr ?');
  assert.equal(copy.EMAIL_CARD.unlinkAria(addr), 'Dissocier la boîte jean@exemple.fr');
  assert.equal(copy.EMAIL_CARD.reconnectAria(addr), 'Reconnecter la boîte jean@exemple.fr');
  assert.equal(copy.EMAIL_CARD.retryAria(addr), 'Réessayer de lire la boîte jean@exemple.fr');
  assert.equal(copy.EMAIL_CARD.unlinkedToast(addr), 'Boîte jean@exemple.fr dissociée');
  // Le nom visible commence le nom accessible (« Dissocier », « Reconnecter ») : la commande vocale reste juste
  assert.ok(copy.EMAIL_CARD.unlinkAria(addr).startsWith(copy.CARD_COMMON.unlink));
  assert.ok(copy.EMAIL_CARD.reconnectAria(addr).startsWith(copy.ACTION_LABEL.reconnect));
  assert.ok(copy.EMAIL_CARD.retryAria(addr).startsWith(copy.CARD_COMMON.retry));
  // Deux boîtes : deux noms différents pour le même geste
  assert.notEqual(copy.EMAIL_CARD.unlinkAria('a@x.fr'), copy.EMAIL_CARD.unlinkAria('b@x.fr'));
});

test('E-mail — chaque ligne passe l\'adresse de sa boîte à la confirmation et aux trois boutons', () => {
  const card = code('src/components/settings/MyEmailAccount.tsx');
  assert.match(card, /title=\{EMAIL_CARD\.unlinkTitle\(row\.address\)\}/);
  assert.match(card, /triggerAriaLabel=\{EMAIL_CARD\.unlinkAria\(row\.address\)\}/);
  assert.match(card, /ariaLabel=\{EMAIL_CARD\.reconnectAria\(row\.address\)\}/);
  assert.match(card, /aria-label=\{EMAIL_CARD\.retryAria\(row\.address\)\}/);
  assert.doesNotMatch(card, /EMAIL_CARD\.unlinkTitle\}/, 'plus de titre fixe');
  const parts = code('src/components/connections/ConnectionParts.tsx');
  assert.match(parts, /aria-label=\{triggerAriaLabel\}/);
  assert.match(parts, /aria-label=\{mine \? undefined : ariaLabel\}/, 'pendant le départ, le libellé d\'attente reste le nom du bouton');
});

test('E-mail — « Réessayer » d\'une ligne attend la fin de la lecture en cours', () => {
  const card = code('src/components/settings/MyEmailAccount.tsx');
  assert.match(card, /const busy = list\.isFetching;/);
  assert.match(card, /retryDisabled=\{busy\}/);
  const row = card.slice(card.indexOf("view.action === 'refresh' && ("), card.indexOf('{extraAction}'));
  assert.match(row, /disabled=\{retryDisabled\}/);
  assert.match(row, /onClick=\{onRetry\}/);
});

// ------------------------------------------------------------------ deux boîtes sans adresse connue
test('E-mail — deux boîtes dont l\'adresse est inconnue ne se masquent pas l\'une l\'autre', () => {
  const m = (id, acc) => ({ id, email_account_id: acc, email_address: null, provider: 'OUTLOOK' });
  const gone = { id: 'acc_a', status: 'DELETED', type: 'OUTLOOK' };
  const live = { id: 'acc_b', status: 'OK', type: 'OUTLOOK' };
  const built = rows.buildMailboxRows([m('m1', 'acc_a'), m('m2', 'acc_b')], [gone, live], false);
  assert.deepEqual(built.map((r) => r.mapping.id), ['m1', 'm2'], 'la boîte retirée reste (à reconnecter ou à dissocier) à côté de la vivante');
  assert.equal(built[0].view.label, 'À reconnecter');
  assert.equal(built[0].address, 'Messagerie Outlook');
  assert.equal(built[1].address, 'Messagerie Outlook');
  assert.deepEqual(built.map((r) => r.identifier), ['', ''], 'un nom de repli ne prouve rien');
  // Un nom d'ancienne connexion ne prouve rien non plus
  const encoded = rows.buildMailboxRows(
    [{ ...m('m3', 'acc_c'), email_address: 'user:abc|org:def' }, { ...m('m4', 'acc_d'), email_address: 'user:abc|org:def' }],
    [{ id: 'acc_c', status: 'DELETED' }, { id: 'acc_d', status: 'OK' }],
    false,
  );
  assert.equal(encoded.length, 2);
  // Une adresse connue d'un côté seulement ne prouve rien : les deux restent
  const oneKnown = rows.buildMailboxRows(
    [{ ...m('m5', 'acc_e'), email_address: 'jean@exemple.fr' }, m('m6', 'acc_f')],
    [{ id: 'acc_e', status: 'DELETED' }, { id: 'acc_f', status: 'OK' }],
    false,
  );
  assert.equal(oneKnown.length, 2);
  // Même adresse (casse comprise) chez une boîte vivante : la retirée est bien remplacée
  const replaced = rows.buildMailboxRows(
    [{ ...m('m7', 'acc_g'), email_address: 'Jean@Exemple.fr' }, { ...m('m8', 'acc_h'), email_address: 'jean@exemple.fr' }],
    [{ id: 'acc_g', status: 'DELETED' }, { id: 'acc_h', status: 'OK' }],
    false,
  );
  assert.deepEqual(replaced.map((r) => r.mapping.id), ['m8']);
});

// ------------------------------------------------------------------ liste e-mail relue à l'ouverture, une lecture par page
test('F16 — la carte relit la liste à chaque ouverture, sauf quand une lecture vient d\'aboutir', () => {
  const NOW = 1_000_000;
  assert.equal(freshness.rereadOnMount(0, NOW), 'always', 'jamais lue : lue');
  assert.equal(freshness.rereadOnMount(NOW - 60_000, NOW), 'always', 'lue il y a une minute (cache encore frais) : relue');
  assert.equal(freshness.rereadOnMount(NOW - freshness.EMAIL_LIST_JUST_READ_MS - 1, NOW), 'always');
  assert.equal(freshness.rereadOnMount(NOW - 800, NOW), false, 'lue par la barre latérale à l\'instant : un seul appel');
  assert.equal(freshness.rereadOnMount(NOW - freshness.EMAIL_LIST_JUST_READ_MS + 1, NOW), false);
  assert.ok(freshness.EMAIL_LIST_JUST_READ_MS <= 15_000, 'un délai court : l\'état se lit au moment de l\'afficher');
  const hook = code('src/components/connections/useMemberEmailList.ts');
  assert.match(hook, /retry: false,/, 'une lecture ratée s\'affiche tout de suite avec « Réessayer »');
  assert.match(hook, /refetchOnMount: reread \? \(query\) => rereadOnMount\(query\.state\.dataUpdatedAt\) : true,/);
  assert.match(hook, /rereadOnMount: reread = false, refetchInterval/);
  assert.match(code('src/components/settings/MyEmailAccount.tsx'), /useMemberEmailList\(\{ rereadOnMount: true \}\)/);
  assert.match(code('src/components/connections/emailListFreshness.ts'), /'always'/);
});

test('F16 — le tableau de bord et la barre latérale lisent la liste e-mail partagée : plus d\'appel propre', () => {
  const hook = code('src/hooks/useDashboardConnections.ts');
  assert.doesNotMatch(hook, /invokeEdgeFunction|list_email|loadEmailAccounts|setEmailAccounts|setEmailLoading|setInterval|useEffect|useState|useCallback/);
  assert.match(hook, /import \{ useMemberEmailList, type MemberEmailListEntry \} from '@\/components\/connections\/useMemberEmailList';/);
  assert.match(hook, /const EMAIL_REFRESH_MS = 5 \* 60 \* 1000;/, 'l\'actualisation de 5 minutes reste');
  assert.match(hook, /const emailList = useMemberEmailList\(\{ refetchInterval: EMAIL_REFRESH_MS \}\);/);
  assert.match(hook, /const emailAccounts = emailList\.data \?\? EMPTY_EMAIL_ACCOUNTS;/);
  // Une seule fonction du navigateur appelle list_email : la requête partagée
  const callers = [];
  const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).forEach((d) => {
    const next = `${dir}/${d.name}`;
    if (d.isDirectory()) walk(next);
    else if (/\.(ts|tsx)$/.test(d.name) && /action: 'list_email'/.test(code(next))) callers.push(next);
  });
  walk('src');
  assert.deepEqual(callers, ['src/components/connections/useMemberEmailList.ts']);
});

// ------------------------------------------------------------------ compte restreint : un mot, une phrase, aucun bouton
const LOCKED_FRAGMENTS = [/restreint/i, /en pause/, /Se reconnecter n'y change rien/, /Patientez/, /directement/];
const NOT_LOCKED = /suspendu|support|débloquer|écrivez|@/i;

test('compte restreint — le mot et la phrase des cartes sont ceux du bandeau, de la barre latérale et de la notification', () => {
  assert.equal(copy.HEALTH_LABEL.locked, 'Compte restreint');
  for (const channel of ['linkedin', 'email', 'whatsapp']) {
    const reason = copy.healthReason('locked', channel);
    for (const re of LOCKED_FRAGMENTS) assert.match(reason, re, `${channel} : ${re}`);
    assert.doesNotMatch(reason, NOT_LOCKED, channel);
  }
  assert.match(copy.healthReason('locked', 'linkedin'), /restreint par LinkedIn/);
  assert.match(copy.healthReason('locked', 'linkedin'), /directement sur LinkedIn/);
  assert.match(copy.healthReason('locked', 'whatsapp'), /restreint par WhatsApp/);
  // Les autres surfaces disent la même chose (lecture des sources, sans les modifier)
  const banner = read('src/components/dashboard/DashboardFocusPanel.tsx');
  const sidebar = read('src/components/sidebar/todo/LinkedInOutageSection.tsx');
  const webhook = read('supabase/functions/unipile-webhook/index.ts');
  assert.match(banner, /title="Compte LinkedIn restreint"/);
  assert.match(sidebar, /title: 'Compte LinkedIn restreint'/);
  assert.match(webhook, /title = 'Compte LinkedIn restreint'/);
  for (const [name, text] of [['bandeau', banner], ['notification', webhook]]) {
    assert.match(text, /restreint/, name);
    assert.match(text, /Patientez/, name);
    assert.match(text, /directement sur LinkedIn/, name);
  }
  assert.match(webhook, /Se reconnecter n'y change rien/);
});

test('compte restreint — aucun bouton « Contacter le support », aucune adresse personnelle', () => {
  for (const provider of PROVIDERS) {
    const v = view.viewOfHealth('locked', provider);
    assert.equal(v.label, 'Compte restreint', provider);
    assert.equal(v.action, null, provider);
    assert.equal(v.actionLabel, null, provider);
    assert.equal(v.tone, 'danger', provider);
  }
  assert.equal(copy.healthAction('locked'), null);
  assert.equal(view.cardAction(view.viewOfHealth('locked', 'linkedin'), false), null);
  // La classe « restreint » l'emporte sur « actif » et reste neutre sur l'accueil
  assert.equal(of('linkedin', 'LOCKED').label, 'Compte restreint');
  assert.equal(view.viewOfAccount({ health: status.classifyConnectionHealth({ status: 'OK', isLocked: true }), status: 'OK' }, 'linkedin').label, 'Compte restreint');
  for (const f of ['src/components/connections/ConnectionParts.tsx', 'src/components/settings/MyLinkedInAccount.tsx', 'src/components/settings/MyEmailAccount.tsx', 'src/components/settings/MyWhatsAppAccount.tsx']) {
    assert.doesNotMatch(code(f), /SupportLink|contact_support|supportMailto|SUPPORT_EMAIL|mailto:/, f);
  }
  assert.doesNotMatch(read('src/lib/connectionCopy.ts'), /@konekt\.fr|Contacter le support|Ou écrivez/);
});

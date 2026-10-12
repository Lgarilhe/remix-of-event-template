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
 * Lancer : node --test tests/ux/connexion-etats-comptes.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, read, stripComments } from './connexion-helpers.mjs';

const copy = await loadTs('src/lib/connectionCopy.ts');
const view = await loadTs('src/components/connections/connectionView.ts');
const rows = await loadTs('src/components/connections/mailboxRows.ts');
const flight = await loadTs('src/components/connections/singleFlight.ts');
const ids = await loadTs('src/lib/accountIdFormat.ts');
const status = await loadTs('src/lib/linkedinStatus.ts');

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
  assert.match(card, /const list = useMemberEmailList\(\);/);
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

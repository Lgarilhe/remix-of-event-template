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
 * Troisième série (cartes) : toast de dissociation qui nomme l'adresse, type de la pierre tombale WhatsApp (renommé dans
 * le type du front, il ne compile plus dans la garde de la carte), avis « Actualisation impossible » de la carte e-mail, noms accessibles qui commencent par le mot
 * affiché, deux boîtes de même nom distinguées par un rang, offre LinkedIn écrite seulement quand elle a été lue, état
 * d'une entrée dont le statut est déjà connu par webhook (même lecture que le bandeau).
 *
 * Quatrième série (cartes) : offre LinkedIn écrite d'après le champ `licences_read` de l'entrée (vrai, faux, absent, par statut
 * et par format d'identifiant), encart rouge de « Plafonds du jour » avec une phrase par cause d'accord avec la carte,
 * boîte e-mail absente d'une liste ancienne (« État à vérifier », jamais « À reconnecter »), nom du champ de la pierre
 * tombale WhatsApp identique côté serveur et côté type.
 *
 * Lancer : node --test tests/ux/connexion-etats-comptes.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
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
  assert.match(src, /const facts = linkedInAccountFacts\(li\);/, 'les faits de la carte viennent d\'une seule fonction');
  assert.match(src, /const unverified = facts\.unverified === true;/);
  assert.match(src, /const view = viewOfAccount\(facts, 'linkedin'\);/, 'la lecture non vérifiée passe à la vue');
  assert.match(src, /const offer = licenceWasRead\(facts\) \? offerLabelOf\(myAccount\?\.subscriptions\) : null;/, 'jamais une offre qui n\'a pas été lue');
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
  assert.equal(copy.EMAIL_CARD.rowRefreshAria(copy.CARD_COMMON.retry, addr), 'Réessayer de lire la boîte jean@exemple.fr');
  assert.equal(copy.EMAIL_CARD.rowRefreshAria(copy.CARD_COMMON.refresh, addr), 'Actualiser l\'état de la boîte jean@exemple.fr');
  assert.equal(copy.EMAIL_CARD.unlinkedToast(addr), 'Boîte jean@exemple.fr dissociée');
  // Adresse inconnue : la phrase générale
  for (const none of [undefined, null, '']) assert.equal(copy.EMAIL_CARD.unlinkedToast(none), 'Compte e-mail dissocié', String(none));
  // Le nom visible commence le nom accessible (« Dissocier », « Reconnecter ») : la commande vocale reste juste
  assert.ok(copy.EMAIL_CARD.unlinkAria(addr).startsWith(copy.CARD_COMMON.unlink));
  assert.ok(copy.EMAIL_CARD.reconnectAria(addr).startsWith(copy.ACTION_LABEL.reconnect));
  assert.ok(copy.EMAIL_CARD.rowRefreshAria(copy.CARD_COMMON.retry, addr).startsWith(copy.CARD_COMMON.retry));
  assert.ok(copy.EMAIL_CARD.rowRefreshAria(copy.CARD_COMMON.refresh, addr).startsWith(copy.CARD_COMMON.refresh));
  // Deux boîtes : deux noms différents pour le même geste
  assert.notEqual(copy.EMAIL_CARD.unlinkAria('a@x.fr'), copy.EMAIL_CARD.unlinkAria('b@x.fr'));
});

test('E-mail — chaque ligne passe l\'adresse de sa boîte à la confirmation et aux trois boutons', () => {
  const card = code('src/components/settings/MyEmailAccount.tsx');
  assert.match(card, /title=\{EMAIL_CARD\.unlinkTitle\(row\.address\)\}/);
  assert.match(card, /triggerAriaLabel=\{EMAIL_CARD\.unlinkAria\(row\.address\)\}/);
  assert.match(card, /ariaLabel=\{EMAIL_CARD\.reconnectAria\(row\.address\)\}/);
  assert.match(card, /aria-label=\{EMAIL_CARD\.rowRefreshAria\(refreshLabel, row\.address\)\}/);
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
  // Même nom de repli : chacune reçoit un rang, pour que la confirmation et les noms accessibles les distinguent
  assert.deepEqual(built.map((r) => r.address), ['Messagerie Outlook (1)', 'Messagerie Outlook (2)']);
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

// ================================================================== troisième série (cartes)

// ------------------------------------------------------------------ toast de dissociation d'une boîte
const HOOK_STUBS = {
  query: `
    export const useQuery = (options) => { globalThis.__queries.push(options); return { data: undefined, isLoading: false, isError: false, refetch: async () => ({}) }; };
    export const useMutation = (options) => { globalThis.__mutations.push(options); return { mutate: () => {}, isPending: false }; };
    export const useQueryClient = () => ({ invalidateQueries: (arg) => { globalThis.__invalidated.push(arg); } });
  `,
  org: 'export const useOrganization = () => ({ organizationId: "org_1" });',
  auth: 'export const useAuthReady = () => ({ user: { id: "user_1" }, isReady: true });',
  client: 'export const supabase = {};',
  sonner: 'export const toast = { success: (m) => globalThis.__toasts.push(["success", m]), error: (m) => globalThis.__toasts.push(["error", m]) };',
  invoke: 'export const invokeEdgeFunction = async (name, body) => { globalThis.__calls.push({ name, body }); return { data: { success: true }, error: null }; };',
};
const hookStubs = {
  name: 'hook-stubs',
  setup(b) {
    b.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({ path: 'query', namespace: 'stub' }));
    b.onResolve({ filter: /^sonner$/ }, () => ({ path: 'sonner', namespace: 'stub' }));
    b.onResolve({ filter: /useOrganization$/ }, () => ({ path: 'org', namespace: 'stub' }));
    b.onResolve({ filter: /useAuthReady$/ }, () => ({ path: 'auth', namespace: 'stub' }));
    b.onResolve({ filter: /integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'stub' }));
    b.onResolve({ filter: /lib\/invokeEdgeFunction$/ }, () => ({ path: 'invoke', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: HOOK_STUBS[args.path], loader: 'js' }));
  },
};
const { outputFiles: hookFiles } = await build({
  stdin: { contents: "export { useMemberEmailAccounts } from './src/hooks/useMemberEmailAccounts';", resolveDir: ROOT, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  tsconfig: join(ROOT, 'tsconfig.app.json'), plugins: [hookStubs],
});
const hookKit = await import(`data:text/javascript;base64,${Buffer.from(hookFiles[0].text).toString('base64')}`);
/** Options de la mutation « dissocier » du hook, avec les doubles remis à zéro. */
function unlinkMutation() {
  Object.assign(globalThis, { __queries: [], __mutations: [], __invalidated: [], __toasts: [], __calls: [] });
  hookKit.useMemberEmailAccounts();
  return globalThis.__mutations.at(-1);
}

test('E-mail — le toast de dissociation nomme la boîte ; sans adresse connue, la phrase générale', () => {
  const mutation = unlinkMutation();
  mutation.onSuccess(undefined, { mappingId: 'm1', expectedAccountId: 'acc_1', address: 'jean@exemple.fr' });
  assert.deepEqual(globalThis.__toasts.at(-1), ['success', 'Boîte jean@exemple.fr dissociée']);
  // Deux boîtes de même nom de repli : le rang du nom se retrouve dans le message
  mutation.onSuccess(undefined, { mappingId: 'm2', expectedAccountId: 'acc_2', address: 'Messagerie Outlook (2)' });
  assert.deepEqual(globalThis.__toasts.at(-1), ['success', 'Boîte Messagerie Outlook (2) dissociée']);
  for (const variables of [{ mappingId: 'm1', expectedAccountId: 'acc_1' }, { mappingId: 'm1', expectedAccountId: 'acc_1', address: '' }]) {
    mutation.onSuccess(undefined, variables);
    assert.deepEqual(globalThis.__toasts.at(-1), ['success', 'Compte e-mail dissocié'], JSON.stringify(variables));
  }
  // Les listes dépendantes sont relues comme avant
  assert.ok(globalThis.__invalidated.some((i) => JSON.stringify(i.queryKey) === JSON.stringify(['member-email-accounts'])));
});

test('E-mail — l\'adresse affichée ne part pas au serveur : seuls la liaison et le compte attendu y vont', async () => {
  const mutation = unlinkMutation();
  await mutation.mutationFn({ mappingId: 'm1', expectedAccountId: 'acc_1', address: 'jean@exemple.fr' });
  const sent = globalThis.__calls.at(-1);
  assert.equal(sent.name, 'unipile-accounts');
  assert.deepEqual(sent.body, { action: 'unlink_email_account', organization_id: 'org_1', mapping_id: 'm1', expected_account_id: 'acc_1' });
});

test('E-mail — la carte donne l\'adresse de la ligne à la dissociation', () => {
  const card = code('src/components/settings/MyEmailAccount.tsx');
  assert.match(card, /onConfirm=\{\(\) => onUnlink\(myMapping, row\.address\)\}/);
  assert.match(card, /unlinkAccount\(\{ mappingId: mapping\.id, expectedAccountId: mapping\.email_account_id, address \}\);/);
  assert.doesNotMatch(code('src/hooks/useMemberEmailAccounts.ts'), /toast\.success\('/, 'plus de phrase écrite dans le hook');
});

// ------------------------------------------------------------------ type de la pierre tombale WhatsApp
test('WhatsApp — removed_by_member est déclaré dans le type, et la garde de la carte le lit par ce type', () => {
  const hook = code('src/hooks/useMemberWhatsAppAccounts.ts');
  assert.match(hook, /removed_by_member\?: boolean;/);
  const helper = code('src/components/connections/connectionView.ts');
  assert.match(helper, /import type \{ MemberWhatsAppAccount \} from '@\/hooks\/useMemberWhatsAppAccounts';/);
  assert.match(helper, /withoutDeliberateDisconnects<T extends Pick<MemberWhatsAppAccount, 'removed_by_member'>>/);
  assert.doesNotMatch(helper, /removed_by_member\?: boolean \| null/, 'plus de forme écrite à la main, à côté du type');
});

/** Erreurs de typage de connectionView.ts quand le type du hook est lu avec `hookSource` (le vrai fichier si absent). */
function typeErrorsOfView(hookSource) {
  const cfg = ts.readConfigFile(join(ROOT, 'tsconfig.app.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
  const hookPath = join(ROOT, 'src/hooks/useMemberWhatsAppAccounts.ts');
  const viewPath = join(ROOT, 'src/components/connections/connectionView.ts');
  const options = { ...parsed.options, noEmit: true, skipLibCheck: true, incremental: false, composite: false, tsBuildInfoFile: undefined };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, lang, onError, shouldCreate) => (
    hookSource !== undefined && file === hookPath ? ts.createSourceFile(file, hookSource, lang, true) : getSourceFile(file, lang, onError, shouldCreate)
  );
  const program = ts.createProgram({ rootNames: [viewPath, hookPath], options, host });
  const file = program.getSourceFile(viewPath);
  return [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

test('WhatsApp — renommé dans le type du front, le champ de la trace ne compile plus dans la garde de la carte', () => {
  // Ce test garde le type du front seulement : la réponse du serveur est lue par un cast, donc un renommage dans
  // unipile-accounts/handler.ts ne casse aucune compilation. Le nom côté serveur est comparé au type plus bas.

  assert.deepEqual(typeErrorsOfView(), [], 'le fichier tel qu\'il est compile');
  const renamed = read('src/hooks/useMemberWhatsAppAccounts.ts').replace('removed_by_member?: boolean;', 'deliberate_removal?: boolean;');
  assert.notEqual(renamed, read('src/hooks/useMemberWhatsAppAccounts.ts'), 'le champ a bien été renommé dans la copie');
  const errors = typeErrorsOfView(renamed);
  assert.ok(errors.some((m) => /removed_by_member/.test(m)), `une erreur de typage nomme le champ : ${JSON.stringify(errors)}`);
});

// ------------------------------------------------------------------ relecture ratée de la liste e-mail
test('E-mail — première lecture ratée : une erreur sans liste ; relecture ratée : la liste reste et le dit', async () => {
  const client = new QueryClient();
  let fail = true;
  const observer = new QueryObserver(client, {
    queryKey: ['liste-email'], retry: false, queryFn: async () => { if (fail) throw new Error('lecture impossible'); return [{ id: 'acc_1' }]; },
  });
  const first = await observer.refetch();
  // Ce que lit la carte : listFailed (erreur sans donnée) et listStale (relecture ratée)
  assert.equal(first.isError && !first.data, true, 'première lecture ratée : liste non reçue');
  assert.equal(first.isRefetchError, false, 'ce n\'est pas une relecture : pas d\'avis « dernière liste »');
  fail = false;
  const ok = await observer.refetch();
  assert.equal(ok.isError, false);
  assert.equal(ok.isRefetchError, false);
  fail = true;
  const again = await observer.refetch();
  assert.equal(again.isError && !again.data, false, 'une liste est déjà là : ce n\'est pas une liste non reçue');
  assert.deepEqual(again.data, [{ id: 'acc_1' }], 'les boîtes gardent leur dernier état');
  assert.equal(again.isRefetchError, true, 'la relecture ratée est connue de la carte');
  client.clear();
});

test('E-mail — la carte dit « Actualisation impossible » comme WhatsApp quand la relecture rate', () => {
  const card = code('src/components/settings/MyEmailAccount.tsx');
  assert.match(card, /const listStale = list\.isRefetchError;/);
  assert.match(card, /<div className="space-y-3">\s*\{listStale && <p role="status" className="text-sm text-danger">\{CARD_COMMON\.staleList\}<\/p>\}\s*\{rows\.map\(/,
    'l\'avis est au-dessus des lignes de boîtes');
  // Même avis, même teinte que la carte WhatsApp
  assert.match(code('src/components/settings/MyWhatsAppAccount.tsx'), /\{isRefetchError && <p role="status" className="text-sm text-danger">\{CARD_COMMON\.staleList\}<\/p>\}/);
  assert.equal(copy.CARD_COMMON.staleList, 'Actualisation impossible. Les derniers comptes reçus restent affichés.');
});

// ------------------------------------------------------------------ noms accessibles
test('E-mail — le nom accessible de « Réessayer » ou « Actualiser » commence par le mot affiché', () => {
  // Statut non reconnu : « Actualiser » (action refresh) ; liste non reçue : « Réessayer »
  const weird = rows.buildMailboxRows([MAPS.gmail], [{ id: 'acc_gmail', identifier: 'camille.martin@horizon.example', status: 'TRUC_NOUVEAU', type: 'GOOGLE' }], false)[0];
  const failed = rows.buildMailboxRows([MAPS.gmail], [], true)[0];
  assert.equal(weird.view.action, 'refresh');
  assert.equal(weird.view.actionLabel, 'Actualiser');
  assert.equal(failed.view.action, 'refresh');
  assert.equal(failed.view.actionLabel, 'Réessayer');
  for (const row of [weird, failed]) {
    const visible = row.view.actionLabel ?? copy.CARD_COMMON.refresh;
    const aria = copy.EMAIL_CARD.rowRefreshAria(visible, row.address);
    assert.ok(aria.startsWith(visible), `${visible} : ${aria}`);
    assert.ok(aria.includes(row.address), aria);
  }
  assert.equal(copy.EMAIL_CARD.rowRefreshAria('Actualiser', 'a@x.fr'), 'Actualiser l\'état de la boîte a@x.fr');
  // La carte passe le mot affiché lui-même, jamais un libellé écrit à part
  const card = code('src/components/settings/MyEmailAccount.tsx');
  assert.match(card, /const refreshLabel = view\.actionLabel \?\? CARD_COMMON\.refresh;/);
  assert.match(card, /aria-label=\{EMAIL_CARD\.rowRefreshAria\(refreshLabel, row\.address\)\}/);
  assert.match(card, /<RefreshCw className=\{cn\(retryDisabled && 'animate-spin'\)\} aria-hidden="true" \/>\s*\{refreshLabel\}/);
});

test('E-mail — deux boîtes de même nom de repli : un rang dans le nom, la confirmation et les noms accessibles', () => {
  const m = (id, acc, provider = 'OUTLOOK') => ({ id, email_account_id: acc, email_address: null, provider });
  const built = rows.buildMailboxRows(
    [m('m1', 'acc_b'), m('m2', 'acc_a')],
    [{ id: 'acc_a', status: 'OK', type: 'OUTLOOK' }, { id: 'acc_b', status: 'CREDENTIALS', type: 'OUTLOOK' }],
    false,
  );
  // La boîte à reconnecter passe devant ; le rang suit le compte, pas la place
  assert.deepEqual(built.map((r) => [r.mapping.email_account_id, r.address]), [['acc_b', 'Messagerie Outlook (2)'], ['acc_a', 'Messagerie Outlook (1)']]);
  for (const name of ['unlinkTitle', 'unlinkAria', 'reconnectAria']) {
    assert.notEqual(copy.EMAIL_CARD[name](built[0].address), copy.EMAIL_CARD[name](built[1].address), name);
  }
  assert.notEqual(copy.EMAIL_CARD.rowRefreshAria('Actualiser', built[0].address), copy.EMAIL_CARD.rowRefreshAria('Actualiser', built[1].address));
  assert.equal(copy.EMAIL_CARD.unlinkTitle(built[0].address), 'Dissocier la boîte Messagerie Outlook (2) ?');
  // Le rang ne bouge pas quand l'état change (la boîte (2) retrouve la santé et perd sa place devant)
  const healed = rows.buildMailboxRows(
    [m('m1', 'acc_b'), m('m2', 'acc_a')],
    [{ id: 'acc_a', status: 'OK', type: 'OUTLOOK' }, { id: 'acc_b', status: 'OK', type: 'OUTLOOK' }],
    false,
  );
  assert.deepEqual(Object.fromEntries(healed.map((r) => [r.mapping.email_account_id, r.address])), { acc_a: 'Messagerie Outlook (1)', acc_b: 'Messagerie Outlook (2)' });
  // Une liste non reçue ne change pas les noms
  const unread = rows.buildMailboxRows([m('m1', 'acc_b'), m('m2', 'acc_a')], [], true);
  assert.deepEqual(Object.fromEntries(unread.map((r) => [r.mapping.email_account_id, r.address])), { acc_a: 'Messagerie Outlook (1)', acc_b: 'Messagerie Outlook (2)' });
  // Trois boîtes de même nom, une quatrième d'un autre fournisseur : seul le groupe identique reçoit des rangs
  const mixed = rows.buildMailboxRows(
    [m('m1', 'acc_1'), m('m2', 'acc_2'), m('m3', 'acc_3'), m('m4', 'acc_4', 'GOOGLE')],
    ['acc_1', 'acc_2', 'acc_3'].map((id) => ({ id, status: 'OK', type: 'OUTLOOK' })).concat({ id: 'acc_4', status: 'OK', type: 'GOOGLE' }),
    false,
  );
  assert.deepEqual(mixed.map((r) => r.address), ['Messagerie Outlook (1)', 'Messagerie Outlook (2)', 'Messagerie Outlook (3)', 'Messagerie Gmail']);
  // Sans doublon, le nom reste tel quel ; une adresse connue aussi
  assert.equal(rows.buildMailboxRows([m('m1', 'acc_a')], [{ id: 'acc_a', status: 'OK' }], false)[0].address, 'Messagerie Outlook');
  assert.deepEqual(rows.buildMailboxRows([MAPS.gmail, MAPS.outlook, MAPS.imap], LISTED, false).map((r) => r.address),
    ['c.martin@horizon-conseil.example', 'camille.martin@horizon.example', 'camille@mail.horizon.example']);
  // La boîte retirée et remplacée disparaît avant le rang : la vivante garde son nom simple
  const replaced = rows.buildMailboxRows(
    [{ ...MAPS.gmail, id: 'old', email_account_id: 'acc_old' }, MAPS.gmail],
    [{ id: 'acc_old', identifier: 'camille.martin@horizon.example', status: 'DELETED' }, LISTED[0]],
    false,
  );
  assert.deepEqual(replaced.map((r) => r.address), ['camille.martin@horizon.example']);
});

// ------------------------------------------------------------------ offre LinkedIn : seulement quand elle a été lue
const CLASSIC = { classic: true, recruiter: false, sales_navigator: false };
/** Entrée de la liste telle que le serveur la rend (unipile-accounts, account-list.ts), sans marqueur sauf indication. */
const entry = (raw, extra = {}) => ({
  id: 'acc_abc', name: 'Camille Martin', identifier: 'Camille Martin', status: raw, mapped: true, profile_picture_url: null,
  subscriptions: CLASSIC, is_locked: raw === 'LOCKED', reconnectable: raw !== 'OK', initial_sync_status: null, ...extra,
});
const MINE = (id = 'acc_abc') => ({ user_id: 'u1', linkedin_account_id: id, account_status: 'OK' });
const resolveInput = (account, mappingId = 'acc_abc', accountsLoaded = true) => ({
  userId: 'u1', mappings: [MINE(mappingId)], mappingsLoaded: true, accounts: account ? [account] : [], accountsLoaded,
});
/** La carte LinkedIn sans React : l'état lu, les faits, la vue et l'offre écrite, comme MyLinkedInAccount les compose. */
function linkedInCard(account, mappingId = 'acc_abc') {
  const li = status.resolveMyLinkedInStatus(resolveInput(account, mappingId));
  const facts = view.linkedInAccountFacts(li);
  const v = view.viewOfAccount(facts, 'linkedin');
  const offer = view.licenceWasRead(facts) ? view.offerLabelOf(account?.subscriptions) : null;
  return { li, facts, view: v, offer };
}

test('Offre — un compte lu l\'affiche : Recruiter, Sales Navigator, ou Classic quand c\'est bien la licence lue', () => {
  assert.equal(linkedInCard(entry('OK', { subscriptions: { ...CLASSIC, recruiter: true } })).offer, 'LinkedIn Recruiter');
  assert.equal(linkedInCard(entry('OK', { subscriptions: { ...CLASSIC, sales_navigator: true } })).offer, 'Sales Navigator');
  assert.equal(linkedInCard(entry('OK')).offer, 'LinkedIn Classic');
  assert.equal(linkedInCard(entry('DEGRADED', { subscriptions: { ...CLASSIC, recruiter: true } })).offer, 'LinkedIn Recruiter', 'connexion limitée : lue');
  assert.equal(linkedInCard(entry('OK', { initial_sync_status: 'RUNNING', subscriptions: { ...CLASSIC, recruiter: true } })).offer, 'LinkedIn Recruiter', 'première synchronisation : lue');
});

test('Offre — jamais inventée : identifiant d\'ancien format, état non lu, compte à reconnecter ou restreint', () => {
  // Identifiant d'ancien format (outdatedLinkEntry : CREDENTIALS et « classique » écrit en dur, sans marqueur)
  const outdated = linkedInCard(entry('CREDENTIALS', { id: 'q8Zr1TnWQeG4mXvH2dKpLa' }), 'q8Zr1TnWQeG4mXvH2dKpLa');
  assert.equal(outdated.view.cause, 'outdated_identifier');
  assert.equal(outdated.offer, null);
  // Même avec un statut qui se dit actif : un ancien identifiant n'a rien de lu
  assert.equal(linkedInCard(entry('OK', { id: 'q8Zr1TnWQeG4mXvH2dKpLa', subscriptions: { ...CLASSIC, recruiter: true } }), 'q8Zr1TnWQeG4mXvH2dKpLa').offer, null);
  // État non lu (marqueur), quel que soit le dernier statut enregistré
  for (const raw of ['OK', 'DEGRADED']) assert.equal(linkedInCard(entry(raw, { unverified: true })).offer, null, raw);
  // Compte vivant à reconnecter, dont les contrats ne sont pas lus : le « classique » vient du défaut du serveur
  for (const raw of ['CREDENTIALS', 'ERROR', 'STOPPED', 'PERMISSIONS']) {
    const card = linkedInCard(entry(raw));
    assert.equal(card.view.label, 'À reconnecter', raw);
    assert.equal(card.offer, null, raw);
  }
  // Restreint, connexion partielle (dernier état connu sous la même forme qu'une lecture), en cours de connexion, statut inconnu
  for (const raw of ['LOCKED', 'PARTIAL', 'CONNECTING', 'TRUC_NOUVEAU']) assert.equal(linkedInCard(entry(raw)).offer, null, raw);
  // Compte relié que la liste ne contient plus
  assert.equal(linkedInCard(null).offer, null);
  assert.equal(view.licenceWasRead({ health: 'connected', accountId: 'acc_abc', unverified: true }), false);
  assert.equal(view.licenceWasRead({ health: 'connected', accountId: 'acc_abc' }), true);
  assert.equal(view.licenceWasRead({ health: 'connected', accountId: null }), true, 'sans identifiant à juger, la lecture compte');
});

test('Offre — la ligne « Offre : » ne s\'écrit que par la règle de lecture, jamais pour un état non lu', () => {
  const src = code('src/components/settings/MyLinkedInAccount.tsx');
  assert.match(src, /const offer = licenceWasRead\(facts\) \? offerLabelOf\(myAccount\?\.subscriptions\) : null;/);
  assert.equal((src.match(/offerLabelOf\(/g) ?? []).length, 1, 'une seule façon d\'écrire l\'offre');
  assert.match(src, /\{\(offer \|\| since\) && \(/);
});

// ------------------------------------------------------------------ statut déjà connu par webhook : l'état et le geste, comme le bandeau
test('Statut connu par webhook, entrée sans marqueur — la carte montre cet état avec son geste, comme le bandeau', () => {
  const EXPECTED = {
    CREDENTIALS: { label: 'À reconnecter', cause: 'session_expired', action: 'reconnect', actionLabel: 'Reconnecter', outage: 'reconnect' },
    ERROR: { label: 'À reconnecter', cause: 'connection_error', action: 'reconnect', actionLabel: 'Reconnecter', outage: 'reconnect' },
    PARTIAL: { label: 'À reconnecter', cause: 'authentication_partial', action: 'reconnect', actionLabel: 'Reconnecter', outage: 'partial' },
    LOCKED: { label: 'Compte restreint', cause: null, action: null, actionLabel: null, outage: 'locked' },
  };
  for (const [raw, want] of Object.entries(EXPECTED)) {
    const account = entry(raw); // exactement la forme d'unverifiedLinkEntry pour un statut déjà connu : statut gardé, pas de marqueur
    assert.equal('unverified' in account, false, raw);
    const { facts, view: v } = linkedInCard(account);
    assert.equal(facts.unverified, false, raw);
    assert.equal(v.label, want.label, raw);
    assert.notEqual(v.label, 'État à vérifier', raw);
    assert.equal(v.cause, want.cause, raw);
    assert.equal(v.action, want.action, raw);
    assert.equal(v.actionLabel, want.actionLabel, raw);
    assert.notEqual(v.actionLabel, 'Réessayer', `${raw} : ni « Réessayer » ni état à vérifier`);
    // Le bandeau du tableau de bord lit la même entrée : « Reconnecter » des deux côtés, ou aucun
    const outage = status.myLinkedInOutage(resolveInput(account));
    assert.equal(outage, want.outage, raw);
    assert.equal(outage === 'reconnect' || outage === 'partial', v.action === 'reconnect', `${raw} : le bandeau et la carte s'accordent sur « Reconnecter »`);
  }
  // Le même statut avec le marqueur (ancien serveur, ou statut qui ne dit rien) reste « à vérifier », sans geste de reconnexion
  const marked = linkedInCard(entry('OK', { unverified: true }));
  assert.equal(marked.view.label, 'État à vérifier');
  assert.equal(marked.view.action, 'refresh');
  assert.equal(status.myLinkedInOutage(resolveInput(entry('OK', { unverified: true }))), false, 'rien à signaler au bandeau');
  // Compte relié absent d'une liste reçue : à reconnecter par une nouvelle connexion, comme le bandeau
  const gone = linkedInCard(null);
  assert.equal(gone.view.cause, 'removed');
  assert.equal(gone.view.reconnect, 'new_link');
  assert.equal(status.myLinkedInOutage(resolveInput(null)), 'reconnect');
});

test('Statut connu par webhook — la carte lit l\'entrée par les mêmes faits pour la vue et l\'offre', () => {
  const src = code('src/components/settings/MyLinkedInAccount.tsx');
  assert.match(src, /const facts = linkedInAccountFacts\(li\);/);
  assert.match(src, /viewOfAccount\(facts, 'linkedin'\)/);
  assert.match(src, /licenceWasRead\(facts\)/);
  assert.doesNotMatch(src, /healthOfState/, 'plus de seconde composition des faits dans la carte');
  // Reconnecter sur la carte : seulement pour l'action reconnect de la vue
  assert.match(src, /\{view\.action === 'reconnect' && \(\s*<ReconnectButton/);
});

// ================================================================== quatrième série (cartes)

// ------------------------------------------------------------------ offre LinkedIn : le champ licences_read de l'entrée
test('Offre — licences_read vrai : la licence a été lue, y compris pour une connexion partielle ; faux : jamais, même sous un statut actif', () => {
  const RECRUITER = { ...CLASSIC, recruiter: true };
  const offerOf = (raw, extra = {}, mappingId = 'acc_abc') => linkedInCard(entry(raw, { subscriptions: RECRUITER, ...extra }), mappingId).offer;
  // Vrai : une connexion partielle vraiment lue montre de nouveau son offre (le défaut « classique » n'est pas en jeu)
  assert.equal(offerOf('PARTIAL', { licences_read: true }), 'LinkedIn Recruiter');
  assert.equal(offerOf('OK', { licences_read: true }), 'LinkedIn Recruiter');
  assert.equal(offerOf('DEGRADED', { licences_read: true }), 'LinkedIn Recruiter');
  assert.equal(linkedInCard(entry('OK', { licences_read: true })).offer, 'LinkedIn Classic', 'lue et classique : c\'est bien la licence');
  // Faux : appel des contrats en échec (compte vivant, statut actif), entrée non lue, statuts que le serveur ne lit pas
  for (const raw of ['OK', 'DEGRADED', 'PARTIAL', 'CREDENTIALS', 'ERROR', 'LOCKED', 'CONNECTING']) {
    assert.equal(offerOf(raw, { licences_read: false }), null, `${raw} : licences_read faux`);
  }
  assert.equal(linkedInCard(entry('OK', { licences_read: false })).offer, null, 'contrats en échec : pas de « LinkedIn Classic » inventé');
});

test('Offre — licences_read absent (serveur plus ancien pendant un déploiement) : la classe de santé décide, comme avant', () => {
  const RECRUITER = { ...CLASSIC, recruiter: true };
  for (const raw of ['OK', 'DEGRADED']) assert.equal(linkedInCard(entry(raw, { subscriptions: RECRUITER })).offer, 'LinkedIn Recruiter', raw);
  for (const raw of ['PARTIAL', 'CREDENTIALS', 'ERROR', 'LOCKED', 'CONNECTING']) assert.equal(linkedInCard(entry(raw, { subscriptions: RECRUITER })).offer, null, raw);
  // Une valeur qui n'est pas un booléen vaut « absent », jamais « vrai »
  for (const odd of ['true', 1, 'oui', {}, []]) {
    assert.equal(view.linkedInAccountFacts({ state: 'connected', account: { status: 'OK', licences_read: odd }, mapping: { linkedin_account_id: 'acc_abc' } }).licencesRead, undefined, JSON.stringify(odd));
    assert.equal(linkedInCard(entry('PARTIAL', { subscriptions: RECRUITER, licences_read: odd })).offer, null, `PARTIAL avec ${JSON.stringify(odd)}`);
  }
  assert.equal(view.linkedInAccountFacts({ state: 'connected', account: { status: 'OK', licences_read: null }, mapping: null }).licencesRead, undefined);
});

test('Offre — champ licences_read, statut et identifiant : la matrice entière', () => {
  const RECRUITER = { ...CLASSIC, recruiter: true };
  const OLD = 'q8Zr1TnWQeG4mXvH2dKpLa';
  const STATUSES = ['OK', 'DEGRADED', 'PARTIAL', 'CREDENTIALS', 'ERROR', 'LOCKED', 'CONNECTING'];
  const HEURISTIC = new Set(['OK', 'DEGRADED']);
  for (const flag of [true, false, undefined]) for (const raw of STATUSES) for (const old of [false, true]) {
    const id = old ? OLD : 'acc_abc';
    const extra = flag === undefined ? {} : { licences_read: flag };
    const offer = linkedInCard(entry(raw, { id, subscriptions: RECRUITER, ...extra }), id).offer;
    // Un identifiant d'ancien format n'a eu aucun appel : jamais d'offre, quel que soit le champ
    const expected = old ? null : flag === true ? 'LinkedIn Recruiter' : flag === false ? null : HEURISTIC.has(raw) ? 'LinkedIn Recruiter' : null;
    assert.equal(offer, expected, `licences_read ${flag}, ${raw}, ${old ? 'ancien' : 'actuel'}`);
  }
  // L'état non lu (marqueur) l'emporte sur le champ
  for (const flag of [true, false, undefined]) {
    const extra = flag === undefined ? {} : { licences_read: flag };
    assert.equal(linkedInCard(entry('OK', { unverified: true, subscriptions: RECRUITER, ...extra })).offer, null, `non lu, licences_read ${flag}`);
  }
  // Compte relié que la liste ne contient plus : pas d'entrée, pas d'offre
  assert.equal(linkedInCard(null).offer, null);
  assert.equal(view.licenceWasRead({ health: 'needs_reconnect', accountId: 'acc_abc', licencesRead: true }), true);
  assert.equal(view.licenceWasRead({ health: 'connected', accountId: 'acc_abc', licencesRead: false }), false);
  assert.equal(view.licenceWasRead({ health: 'connected', accountId: 'acc_abc', licencesRead: true, unverified: true }), false);
});

test('Offre — la carte passe par les faits du champ licences_read, et le type de la liste le déclare', () => {
  const src = code('src/components/connections/connectionView.ts');
  assert.match(src, /licences_read\?: boolean \| null/);
  assert.match(src, /licencesRead: typeof li\.account\?\.licences_read === 'boolean' \? li\.account\.licences_read : undefined,/);
  assert.match(src, /if \(typeof facts\.licencesRead === 'boolean'\) return facts\.licencesRead;/);
  assert.match(code('src/components/settings/MyLinkedInAccount.tsx'), /const offer = licenceWasRead\(facts\) \? offerLabelOf\(myAccount\?\.subscriptions\) : null;/);
});

// ------------------------------------------------------------------ encart rouge de « Plafonds du jour » : une phrase par cause
const sendRules = await loadTs('supabase/functions/_shared/sequence-send-rules.ts');

test('Plafonds du jour — l\'encart dit la cause de la carte : session expirée, panne, connexion partielle, restriction, compte retiré, identifiant à refaire', () => {
  const EXPECTED = {
    CREDENTIALS: 'session_expired',
    ERROR: 'connection_error',
    ERRORED: 'connection_error',
    STOPPED: 'connection_error',
    PERMISSIONS: 'connection_error',
    PARTIAL: 'authentication_partial',
    LOCKED: 'locked',
    DELETED: 'removed',
  };
  for (const [raw, kind] of Object.entries(EXPECTED)) {
    const notice = view.quotaNoticeOf(raw, 'acc_abc');
    assert.equal(notice?.kind, kind, raw);
    assert.equal(notice.title, copy.QUOTA_NOTICE[kind].title, raw);
    assert.equal(notice.body, copy.QUOTA_NOTICE[kind].body, raw);
    // Même cause que la carte du compte au-dessus (sauf l'accès restreint, qui n'a pas de cause de reconnexion)
    const card = of('linkedin', raw, { accountId: 'acc_abc' });
    if (kind === 'locked') assert.equal(card.label, 'Compte restreint', raw);
    else assert.equal(card.cause, kind, `${raw} : l'encart et la carte parlent de la même cause`);
  }
  // Un identifiant d'ancien format se lit « à refaire », comme la carte
  const outdated = view.quotaNoticeOf('CREDENTIALS', 'q8Zr1TnWQeG4mXvH2dKpLa');
  assert.equal(outdated?.kind, 'outdated_identifier');
  assert.equal(of('linkedin', 'CREDENTIALS', { accountId: 'q8Zr1TnWQeG4mXvH2dKpLa' }).cause, 'outdated_identifier');
  // Rien à dire d'un compte actif, limité, en connexion, inconnu ou sans statut
  for (const raw of ['OK', 'RUNNING', 'DEGRADED', 'CONNECTING', 'TRUC_NOUVEAU', '', null, undefined]) {
    assert.equal(view.quotaNoticeOf(raw, 'acc_abc'), null, String(raw));
  }
});

test('Plafonds du jour — le titre reprend la phrase de la carte, sauf pour une session expirée dont le mot « déconnecté » reste', () => {
  for (const kind of ['connection_error', 'authentication_partial', 'removed']) {
    const cardSentence = copy.causeReason(kind, 'linkedin');
    assert.ok(cardSentence.startsWith(copy.QUOTA_NOTICE[kind].title), `${kind} : la carte commence par le titre de l'encart`);
    assert.doesNotMatch(`${copy.QUOTA_NOTICE[kind].title} ${copy.QUOTA_NOTICE[kind].body}`, /déconnect/i, `${kind} : pas « déconnecté » pour une autre cause`);
  }
  assert.equal(copy.QUOTA_NOTICE.session_expired.title, 'Compte déconnecté, reconnectez-le.', 'le mot « déconnecté » reste pour une session expirée');
  assert.equal(copy.QUOTA_NOTICE.session_expired.body, 'Les séquences qui utilisent ce compte sont en pause et reprendront automatiquement après reconnexion.');
  assert.doesNotMatch(`${copy.QUOTA_NOTICE.locked.title} ${copy.QUOTA_NOTICE.locked.body}`, /déconnect|reconnectez/i);
  assert.match(copy.QUOTA_NOTICE.locked.body, /Se reconnecter n'y change rien/);
  assert.match(copy.QUOTA_NOTICE.locked.title, /restreint/);
});

test('Plafonds du jour — « en pause » ne se dit que de ce que le moteur met vraiment en pause', () => {
  // accountSendGate (supabase/functions/_shared/sequence-send-rules.ts) : CREDENTIALS et ERROR sont « disconnected » (le moteur met
  // les inscriptions en pause, account_disconnected, et la reprise vient seule au retour du compte) ; DEGRADED, PARTIAL et LOCKED
  // sont « limited » (les envois sont retenus 6 h, sans mise en pause).
  const KIND = { CREDENTIALS: 'session_expired', ERROR: 'connection_error', PARTIAL: 'authentication_partial', LOCKED: 'locked' };
  assert.equal(sendRules.accountSendGate('CREDENTIALS'), 'disconnected');
  assert.equal(sendRules.accountSendGate('ERROR'), 'disconnected');
  for (const [raw, kind] of Object.entries(KIND)) {
    const gate = sendRules.accountSendGate(raw);
    const { body } = copy.QUOTA_NOTICE[kind];
    assert.notEqual(gate, 'send', `${raw} : le moteur ne laisse rien partir`);
    if (gate === 'disconnected') {
      assert.match(body, /séquences .* sont en pause/, `${raw} : les séquences du compte sont vraiment mises en pause`);
      assert.match(body, /reprendront/, `${raw} : la reprise est automatique au retour du compte`);
    } else {
      assert.doesNotMatch(body, /en pause/, `${raw} (${gate}) : le moteur retient les envois, il ne met rien en pause`);
      assert.match(body, /retenus/, raw);
    }
  }
  // Un compte retiré ou à identifiant d'ancien format : la reconnexion crée un autre compte, le serveur arrête alors les envois de
  // l'ancien (pause « manual », InMails annulés, retrait des rotations) : rien ne reprend seul, la phrase le dit.
  for (const kind of ['outdated_identifier', 'removed']) {
    const { body } = copy.QUOTA_NOTICE[kind];
    assert.match(body, /séquences .* sont en pause/, kind);
    assert.match(body, /relancez/, `${kind} : la personne relance ses séquences`);
    assert.match(body, /ne reprennent pas d'elles-mêmes/, kind);
    assert.doesNotMatch(body, /reprendront/, `${kind} : pas de promesse de reprise automatique`);
  }
});

test('Plafonds du jour — l\'encart de la carte vient de quotaNoticeOf, plus de phrase écrite en dur', () => {
  const src = code('src/components/settings/MyLinkedInAccount.tsx');
  assert.match(src, /const notice = quotaNoticeOf\(status\.account_status, accountId\);/);
  assert.match(src, /\{notice && \(/);
  assert.match(src, /<span className="font-medium">\{notice\.title\}<\/span>/);
  assert.match(src, /<span className="text-foreground-secondary">\{notice\.body\}<\/span>/);
  assert.doesNotMatch(src, /Compte déconnecté, reconnectez-le|Les séquences qui utilisent ce compte/, 'la phrase vit dans connectionCopy.ts');
  assert.doesNotMatch(src, /const disconnected =/);
});

// ------------------------------------------------------------------ boîte e-mail absente d'une liste ancienne
test('E-mail — une boîte absente d\'une liste ancienne (relecture ratée) dit « État à vérifier » avec « Réessayer », jamais « À reconnecter »', () => {
  const m = (id, acc) => ({ id, email_account_id: acc, email_address: null, provider: 'OUTLOOK' });
  const listed = [{ id: 'acc_1', status: 'OK', type: 'OUTLOOK' }];
  const mappings = [m('m1', 'acc_1'), m('m2', 'acc_2')];
  const byAccount = (built) => Object.fromEntries(built.map((r) => [r.mapping.email_account_id, r]));

  // Liste ancienne : la boîte connue garde son dernier état, la boîte absente n'est pas prouvée retirée
  const stale = byAccount(rows.buildMailboxRows(mappings, listed, false, true));
  assert.equal(stale.acc_1.view.label, 'Actif');
  assert.equal(stale.acc_2.view.label, 'État à vérifier');
  assert.equal(stale.acc_2.view.cause, 'unreadable');
  assert.equal(stale.acc_2.view.action, 'refresh');
  assert.equal(stale.acc_2.view.actionLabel, 'Réessayer');
  assert.equal(stale.acc_2.view.reconnect, 'in_place');
  assert.equal(stale.acc_2.status, null, 'pas de statut deviné, donc pas de « DELETED » qui masquerait une autre boîte');
  assert.notEqual(stale.acc_2.view.reason, copy.causeReason('removed', 'email'));

  // Liste à jour (quatrième paramètre faux ou absent) : la même boîte absente est bien retirée
  for (const built of [rows.buildMailboxRows(mappings, listed, false), rows.buildMailboxRows(mappings, listed, false, false)]) {
    const fresh = byAccount(built);
    assert.equal(fresh.acc_2.view.label, 'À reconnecter');
    assert.equal(fresh.acc_2.view.cause, 'removed');
    assert.equal(fresh.acc_2.view.reconnect, 'new_link');
    assert.equal(fresh.acc_2.status, 'DELETED');
  }

  // Une boîte que la liste ancienne contient reste lue telle quelle, y compris retirée ou à reconnecter
  const known = byAccount(rows.buildMailboxRows(mappings, [{ id: 'acc_1', status: 'CREDENTIALS', type: 'OUTLOOK' }, { id: 'acc_2', status: 'DELETED', type: 'OUTLOOK' }], false, true));
  assert.equal(known.acc_1.view.cause, 'session_expired');
  assert.equal(known.acc_2.view.cause, 'removed');

  // Aucune liste reçue : toujours « à vérifier » pour toutes les boîtes
  for (const row of rows.buildMailboxRows(mappings, [], true, false)) assert.equal(row.view.label, 'État à vérifier');
  for (const row of rows.buildMailboxRows(mappings, [], true, true)) assert.equal(row.view.label, 'État à vérifier');
});

test('E-mail — la carte donne à buildMailboxRows la relecture ratée comme quatrième argument', () => {
  const card = code('src/components/settings/MyEmailAccount.tsx');
  assert.match(card, /const listStale = list\.isRefetchError;/);
  assert.match(card, /buildMailboxRows\(myMappings, list\.data \?\? \[\], listFailed, listStale\)/);
  assert.match(card, /\[myMappings, list\.data, listFailed, listStale\]/);
});

// ------------------------------------------------------------------ pierre tombale WhatsApp : même nom côté serveur et côté type
/** Noms du champ de la pierre tombale : celui que list_whatsapp écrit (handler.ts) et celui que le type du front déclare. */
function tombstoneFieldNames(handlerSource, hookSource) {
  const server = [...handlerSource.matchAll(/^\s+(\w+): account\.status === 'DELETED' && mapping\.(\w+) != null,$/gm)]
    .map((match) => ({ field: match[1], column: match[2] }));
  const type = hookSource.match(/export interface MemberWhatsAppAccount \{[\s\S]*?\n\s+(\w+)\?: boolean;\n\}/);
  return { server, type: type ? type[1] : null };
}

test('WhatsApp — le champ de la pierre tombale que le serveur écrit est celui du type du front (un cast les sépare)', () => {
  const handler = read('supabase/functions/unipile-accounts/handler.ts');
  const hook = read('src/hooks/useMemberWhatsAppAccounts.ts');
  const names = tombstoneFieldNames(handler, hook);
  assert.equal(names.server.length, 1, 'une seule projection de la pierre tombale dans list_whatsapp');
  assert.equal(names.type, 'removed_by_member', 'le type du front déclare le champ');
  assert.equal(names.server[0].field, names.type, 'le serveur écrit le champ que le type du front lit');
  assert.equal(names.server[0].column, `${names.type}_at`, 'la colonne qui porte la marque s\'appelle le champ avec _at');
  assert.match(read('src/components/connections/connectionView.ts'), /account\.removed_by_member !== true/, 'la garde de la carte lit ce même nom');
  // La comparaison attrape un renommage d'un seul côté
  const renamedOnServer = handler.replace("removed_by_member: account.status === 'DELETED'", "deliberate_removal: account.status === 'DELETED'");
  assert.notEqual(renamedOnServer, handler, 'le champ a bien été renommé dans la copie du serveur');
  const drifted = tombstoneFieldNames(renamedOnServer, hook);
  assert.notEqual(drifted.server[0]?.field, drifted.type, 'un renommage côté serveur seul est vu');
  const renamedInType = hook.replace('removed_by_member?: boolean;', 'deliberate_removal?: boolean;');
  assert.notEqual(tombstoneFieldNames(handler, renamedInType).server[0].field, tombstoneFieldNames(handler, renamedInType).type, 'un renommage dans le type seul est vu');
});


/**
 * Écrans et extension face aux actions de compte du service LinkedIn v2
 * (supabase/functions/unipile-accounts/handler.ts et connection.ts).
 *
 * Le serveur ne retrouve plus un message, une conversation ou une photo sans le
 * couple conversation / compte, n'a plus de secret d'invitation, de mode proxy
 * « adresse IP », de photo en octets ni de pourcentage d'usage. Ces gardes
 * relisent les appelants du navigateur et de l'extension Chrome.
 *
 * Lancer : node --test tests/ux/unipile-v2-front-comptes.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

test('Réactions, suppression de message et de conversation : la conversation et le compte voyagent avec la demande', () => {
  const hook = code('src/hooks/useMessageActions.ts');
  assert.match(hook, /invoke\('add_reaction', \{[^}]*chat_id: ref\.chatId/s);
  assert.match(hook, /invoke\('delete_message', \{[^}]*chat_id: ref\.chatId/s);
  assert.match(hook, /invoke\('delete_chat', \{ chat_id: chatId, \.\.\.\(accountId \? \{ account_id: accountId \} : \{\}\) \}\)/);
  assert.match(hook, /account_id: ref\.accountId/);

  const inbox = code('src/components/outreach/MessagesInbox.tsx');
  // La conversation du message (fil fusionné) passe avant la conversation ouverte ; le compte est celui de la conversation.
  assert.match(inbox, /chatId: message\?\.chat_id \|\| chat\.id, accountId: chat\.account_id \?\? selectedAccount/);
  assert.match(inbox, /await deleteMessage\(messageId, ref\)/);
  assert.match(inbox, /await addReaction\(messageId, reaction, ref\)/);
  assert.match(inbox, /await deleteChat\(chatId, chatAccountId\)/);
});

test('Photos des interlocuteurs : conversation ou personne, une adresse en retour, jamais des octets', () => {
  const hook = code('src/hooks/useAttendeePictures.ts');
  assert.match(hook, /action: 'get_attendee_picture'/);
  assert.match(hook, /user_id: attendeeId/);
  assert.match(hook, /chat_id: source\.chatId/);
  assert.match(hook, /account_id: source\.accountId/);
  assert.doesNotMatch(hook, /attendee_id|data_url/);
  assert.match(hook, /data\?\.success \? data\.picture_url \|\| null : null/);

  const inbox = code('src/components/outreach/MessagesInbox.tsx');
  assert.match(inbox, /\.map\(\(c\) => \(\{ attendeeId: c\.attendees!\[0\]\.id as string, chatId: c\.id, accountId: c\.account_id \}\)\)/);
  assert.match(code('src/components/outreach/inbox/ChatListItem.tsx'), /fetchPicture\(attendeeId, \{ chatId: chat\.id, accountId: chat\.account_id \}\)/);
  assert.match(code('src/components/outreach/inbox/MessageView.tsx'), /fetchPicture\(attendeeId, \{ chatId: selectedChat\?\.id, accountId: selectedChat\?\.account_id \}\)/);
});

test('Invitations reçues : plus de secret partagé ni de fournisseur par invitation', () => {
  const hook = code('src/hooks/useInvitationsReceived.ts');
  assert.doesNotMatch(hook, /shared_secret|provider/);
  assert.match(hook, /invitation_action: 'accept'/);
  assert.match(hook, /invitation_action: 'decline'/);
  assert.match(hook, /invitation_id: inv\.id,\s*action,/);
});

test('Proxy : pas de mode adresse IP, et la relance de la connexion est dite', () => {
  const proxy = code('src/components/outreach/ProxyConfigPanel.tsx');
  assert.doesNotMatch(proxy, /value: 'ip'|mode === 'ip'|proxy_ip|ipAddress|Adresse IP du proxy/);
  assert.match(proxy, /Changer le proxy relance la connexion LinkedIn de ce compte\. Elle est interrompue un court instant\./);
  // Un ancien réglage « adresse IP » s'ouvre sur Pays, sans valeur reprise.
  assert.match(proxy, /resolvedMode === 'custom' \? 'custom' : 'country'/);
});

test('Plus de pause à 90 % d\'usage annoncée : le prestataire ne rend plus de pourcentage', () => {
  for (const rel of ['src/components/outreach/QuotaDisplay.tsx', 'src/components/settings/LinkedInSafetySettings.tsx']) {
    const src = code(rel);
    assert.doesNotMatch(src, /90 % d'usage/, rel);
    assert.match(src, /pause automatique de 16 h au premier signal de limite|Pause automatique de 16 heures au premier signal de limite/, rel);
  }
});

test('Solde d\'InMails : les clés lues sont celles que le serveur rend', () => {
  const server = read('supabase/functions/unipile-accounts/handler.ts');
  assert.match(server, /balance: \{\s*premium: credits\.classic,\s*recruiter: credits\.recruiter,\s*sales_navigator: credits\.sales_navigator,/);
  const hook = code('src/hooks/useInMailBalance.ts');
  assert.match(hook, /premium: number \| null;\s*recruiter: number \| null;\s*sales_navigator: number \| null;/);
  assert.match(hook, /action: 'inmail_balance', account_id: accountId/);
});

test('Extension Chrome : vrai user agent, cookie premium li_a, vérification et connexion directe fermée dites', () => {
  const sw = code('extensions/chrome/src/background/sw.ts');
  assert.doesNotMatch(sw, /defaultUserAgent|Mozilla\/5\.0 \(Windows/);
  assert.match(sw, /await getUserAgentFromAnyTab\(\) \|\| navigator\.userAgent \|\| ''/);
  assert.match(sw, /\.\.\.\(captured\.li_a \? \{ premium_token: captured\.li_a \} : \{\}\)/);
  assert.match(sw, /data\.object === 'Checkpoint'/);
  // Le message du serveur (connexion directe fermée : texte neutre) est celui qui s'affiche.
  assert.match(sw, /data\?\.error \|\| error \|\| 'Erreur de reconnexion'/);

  const api = code('extensions/chrome/src/lib/konekt-api.ts');
  assert.match(api, /premium_token\?: string;/);
  assert.match(api, /action: 'connect_cookie'/);

  // Le serveur lit ces noms.
  const server = read('supabase/functions/unipile-accounts/connection.ts');
  assert.match(server, /access_token: params\.access_token, premium_access_token: params\.premium_token, user_agent: params\.user_agent/);
});

test('Toute action de compte envoyée par le navigateur existe côté serveur', () => {
  const handler = read('supabase/functions/unipile-accounts/handler.ts');
  const known = new Set([...handler.matchAll(/^\s*case '([a-z_]+)'/gm)].map((m) => m[1]));
  assert.ok(known.has('add_reaction') && known.has('connection_start'), 'liste des actions du serveur lue');

  const files = [
    'src/components/connections/connectionApi.ts',
    'src/components/outreach/ProxyConfigPanel.tsx',
    'src/components/settings/IntegrationsSettings.tsx',
    'src/components/settings/MyEmailAccount.tsx',
    'src/contexts/LinkedInAccountsContext.tsx',
    'src/hooks/useAttendeePictures.ts',
    'src/hooks/useDashboardConnections.ts',
    'src/hooks/useInMailBalance.ts',
    'src/hooks/useInvitationsReceived.ts',
    'src/hooks/useMemberEmailAccounts.ts',
    'src/hooks/useMemberLinkedInAccounts.ts',
    'src/hooks/useMemberWhatsAppAccounts.ts',
    'src/hooks/useMessageActions.ts',
    'src/hooks/useOrganization.ts',
    'extensions/chrome/src/lib/konekt-api.ts',
  ];
  const sent = new Set();
  for (const rel of files) {
    const src = code(rel);
    for (const m of src.matchAll(/(?:(?<![a-z_])action:\s*|invoke\(\s*|call\(\s*)'([a-z_]+)'(?!\s*\|)/g)) sent.add(`${rel} -> ${m[1]}`);
  }
  assert.ok(sent.size >= 15, `actions relevées : ${sent.size}`);
  const unknown = [...sent].filter((entry) => !known.has(entry.split(' -> ')[1]));
  // 'list' de extension-token et les réglages d'un autre service ne sont pas des actions de compte.
  assert.deepEqual(unknown.filter((u) => !/extension-token|aircall/.test(u)), [], `actions inconnues du serveur : ${unknown.join(', ')}`);
});

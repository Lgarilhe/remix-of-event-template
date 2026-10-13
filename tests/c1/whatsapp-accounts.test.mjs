import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Comportement des actions WhatsApp (liste, déconnexion, reconnexion hébergée) : joué contre une
// base factice et un transport factice par supabase/functions/unipile-accounts/handler.test.ts
// (Deno). Ce fichier garde la projection du compte, la validation de l'adresse hébergée, et les
// garde-fous statiques du gestionnaire.
const ROOT = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, ROOT), 'utf8');

async function load(entry) {
  const result = await build({
    entryPoints: [new URL(entry, ROOT).pathname],
    bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const helper = await load('supabase/functions/_shared/whatsapp-account.ts');
const handler = read('supabase/functions/unipile-accounts/handler.ts');
const helperSource = read('supabase/functions/_shared/whatsapp-account.ts');

const caseBlock = name => {
  const start = handler.indexOf(`      case '${name}': {`);
  assert.ok(start >= 0, `case '${name}' introuvable`);
  const next = handler.indexOf("\n      case '", start + 1);
  return handler.slice(start, next >= 0 ? next : handler.indexOf('\n      default:', start));
};

test('WhatsApp projection exposes only identity and status, in the Konekt vocabulary', () => {
  const input = {
    id: 'acc_wa1', provider: 'whatsapp', name: '+33 6 12 34 56 78', status: 'running', is_locked: false,
    metadata: { custom_data: { token: 'secret' } }, proxy: { password: 'secret' },
  };
  assert.deepEqual(helper.projectWhatsAppAccount(input), { id: 'acc_wa1', type: 'WHATSAPP', name: '+33 6 12 34 56 78', identifier: '+33612345678', status: 'OK' });
  assert.equal(helper.projectWhatsAppAccount({ ...input, provider: 'linkedin' }), null);
  assert.equal(helper.projectWhatsAppAccount({ ...input, id: '' }), null);
  assert.equal(helper.projectWhatsAppAccount({ ...input, name: 'Recruteur' }).identifier, null);
  assert.equal(helper.projectWhatsAppAccount({ ...input, status: 'disconnected' }).status, 'CREDENTIALS');
  assert.equal(helper.projectWhatsAppAccount({ ...input, status: 'partial' }).status, 'PARTIAL');
  assert.equal(helper.projectWhatsAppAccount({ ...input, is_locked: true }).status, 'LOCKED');
  assert.doesNotMatch(JSON.stringify(helper.projectWhatsAppAccount(input)), /secret/);
});

test('a name that carries the state of the previous hosted flow is never shown', () => {
  const view = helper.projectWhatsAppAccount({ id: 'acc_wa1', provider: 'whatsapp', name: 'user:u1|org:o1|providers:WHATSAPP|expires:1', status: 'running' });
  assert.equal(view.name, null);
  assert.equal(view.identifier, null);
});

test('the hosted address filter of the previous flow is gone: the server builds the return page', () => {
  // La page de retour est fixée par le serveur (connection.ts) : l'ancien filtre d'adresses fournies par le navigateur n'existe plus.
  assert.equal(helper.validHostedAuthUrl, undefined);
  assert.equal(helper.whatsappReturnUrl, undefined);
  assert.doesNotMatch(helperSource, /validHostedAuthUrl|whatsappReturnUrl|#whatsapp/);
});

test('WhatsApp actions check ownership before any provider call, and never act for a colleague', () => {
  const list = caseBlock('list_whatsapp');
  assert.match(list, /\.eq\('organization_id', organizationId\)\s*\.eq\('user_id', user\.id\)/, 'lit les comptes du membre, jamais ceux des autres');
  assert.match(list, /getAccount\(mapping\.whatsapp_account_id\)/);
  assert.match(list, /throw new HttpError\(502, 'Impossible de vérifier votre compte WhatsApp'\)/, 'un refus du service est une erreur, pas une liste vide');
  const disconnect = caseBlock('disconnect_whatsapp');
  assert.ok(disconnect.indexOf(".eq('user_id', user.id)") < disconnect.indexOf('deleteAccount('), 'propriété vérifiée avant la suppression');
  assert.match(disconnect, /account_status: 'DELETED'/, 'pierre tombale gardée');
  assert.match(disconnect, /e\.kind === 'not_found'/, 'un compte déjà supprimé chez le service est accepté');
  for (const name of ['disconnect', 'get_account_details']) {
    assert.ok(caseBlock(name).indexOf('assertAccountInOrg(') >= 0, `${name} : contrôle d'appartenance`);
  }
  assert.match(read('supabase/functions/unipile-accounts/ownership.ts'), /ownership\.kind === 'whatsapp' && !sameId\(ownership\.userId, callerUserId\)/);
});

test('hosted WhatsApp: browser return addresses are never read, the old hosted actions are gone', () => {
  const connection = read('supabase/functions/unipile-accounts/connection.ts').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(connection, /success_redirect_url|failure_redirect_url|org_name/, 'les adresses fournies par le navigateur ne sont jamais lues');
  assert.match(connection, /const redirectUri = buildRedirectUri\(Deno\.env\.get\('APP_URL'\)\)/, 'adresse de retour fixée par le serveur');
  assert.doesNotMatch(connection, /redirectUri\s*[:=]\s*(params|String\(params)/);
  assert.match(connection, /config\.whatsapp = \{ allow_methods: \['qr', 'pairing'\] \}/);
  assert.doesNotMatch(handler, /case 'hosted_auth_link'|case 'connect_credentials'|case 'solve_checkpoint'/, 'anciens noms retirés (réponse « Action non reconnue »)');
  assert.match(handler, /case 'connect_cookie'/, 'contrat de l extension Chrome gardé');
});

test('email dissociation uses an exact owned binding without provider access or remote deletion', () => {
  const unlink = caseBlock('unlink_email_account');
  assert.match(unlink, /\.eq\('id', mappingId\)\s*\.eq\('organization_id', organizationId\)\.eq\('user_id', user\.id\)/);
  assert.doesNotMatch(unlink, /deleteAccount|unipile|getAccount/i);
  assert.match(handler, /const DATABASE_ONLY_ACTIONS = new Set\(\[[^\]]*'unlink_email_account'[^\]]*\]\)/);
});

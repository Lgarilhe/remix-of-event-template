/**
 * Garde statique de unipile-search sur l'API v2 seule (passage v1 vers v2).
 *
 * Invariants :
 *   - UNS-1 aucun reste de l'API précédente dans le code de production : ni /api/v1, ni UNIPILE_DSN,
 *     UNIPILE_API_KEY, resolveUnipileCredentials, ni lecture de organization_integrations, ni variable dsn ;
 *   - UNS-2 aucun appel direct au prestataire : pas de fetch, le client partagé (_shared/unipile/index.ts) est
 *     le seul import du prestataire ;
 *   - UNS-3 aucun nom de prestataire dans une chaîne qui peut atteindre un utilisateur (les journaux du
 *     serveur, console.*, sont libres) ;
 *   - UNS-4 les actions sont exactement celles d'avant (les nouvelles actions sont réservées à un lot suivant) ;
 *   - UNS-5 un identifiant de compte n'arrive à aucun appel sans avoir passé le rattachement à l'organisation.
 *
 * Lancer : node --test tests/c1/unipile-search-v2.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const DIR = join(ROOT, 'supabase/functions/unipile-search');
const FILES = readdirSync(DIR).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'));
const read = name => readFileSync(join(DIR, name), 'utf8');
const ast = name => ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true);

test('UNS-0 le dossier est lu en entier', () => {
  for (const name of ['index.ts', 'search.ts', 'search-request.ts', 'chats.ts', 'profile.ts', 'send.ts', 'licence.ts', 'responses.ts']) {
    assert.ok(FILES.includes(name), `module attendu et absent : ${name}`);
  }
});

test('UNS-1 aucun reste de l\'API précédente dans le code de production', () => {
  const forbidden = [
    [/\/api\/v1/, '/api/v1'], [/UNIPILE_DSN/, 'UNIPILE_DSN'], [/UNIPILE_API_KEY/, 'UNIPILE_API_KEY'],
    [/resolveUnipileCredentials/, 'resolveUnipileCredentials'], [/organization_integrations/, 'organization_integrations'],
    [/\bdsn\b/i, 'dsn'], [/X-API-KEY/i, 'X-API-KEY'], [/linkedin\[api\]|attendees_ids|chat_attendees/, 'champs de la génération précédente'],
  ];
  for (const name of FILES) {
    for (const [pattern, label] of forbidden) assert.doesNotMatch(read(name), pattern, `${name} : ${label}`);
  }
});

test('UNS-2 aucun appel direct au prestataire, un seul import : le client partagé', () => {
  for (const name of FILES) {
    const source = read(name);
    assert.doesNotMatch(source, /\bfetch\s*\(/, `${name} : fetch`);
    assert.doesNotMatch(source, /fetchWithTimeout/, `${name} : fetchWithTimeout`);
    for (const match of source.matchAll(/from '(\.\.\/_shared\/unipile[^']*)'/g)) {
      assert.equal(match[1], '../_shared/unipile/index.ts', `${name} : import du client`);
    }
    assert.doesNotMatch(source, /unipile-v2\.ts/, `${name} : ancien module`);
  }
});

test('UNS-3 aucun nom de prestataire dans une chaîne qui peut atteindre un utilisateur', () => {
  const vendor = /unipile|apollo|people data labs|\bpdl\b|anthropic|claude/i;
  // Clé interne du plafond de requêtes par minute (check_rate_limit), jamais rendue.
  const internalKeys = new Set(['unipile_search']);
  const found = [];
  const isLogCall = node => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)
        && ts.isIdentifier(parent.expression.expression) && parent.expression.expression.text === 'console') return true;
    }
    return false;
  };
  for (const name of FILES) {
    const file = ast(name);
    const visit = node => {
      const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
      if (literal && vendor.test(node.text) && !internalKeys.has(node.text) && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent)
        && !isLogCall(node)) {
        found.push(`${name} : ${JSON.stringify(node.text)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  assert.deepEqual(found, []);
});

test('UNS-4 les actions sont exactement celles d\'avant', () => {
  const actions = [...read('index.ts').matchAll(/case '([a-z_]+)':/g)].map(match => match[1]).sort();
  assert.deepEqual(actions, [
    'endorse_skill', 'get_chats', 'get_messages', 'get_parameters', 'get_profile', 'get_user_posts', 'mark_as_read',
    'search', 'send_message', 'sync_chat_history',
  ]);
});

test('UNS-5 le compte est contrôlé avant toute action et dans l\'ordre : format v2, rattachement, puis plafond et appel', () => {
  const index = read('index.ts');
  const format = index.indexOf('assertV2AccountId(accountIdRaw)');
  const owner = index.indexOf('await assertAccountOwnedByOrg(');
  const quota = index.indexOf('await enforceLinkedInAction(');
  const dispatch = index.indexOf('switch (action) {');
  assert.ok(format > 0 && owner > format && quota > owner && dispatch > quota, 'ordre des contrôles');
  assert.match(index, /kinds: \['linkedin'\]/, 'seuls les comptes LinkedIn');
  assert.match(index, /action === 'send_message' && !isInternal && ownership\.userId !== userId/, 'envoi depuis son propre compte');
  // Aucun handler ne reçoit le compte brut de la requête.
  assert.doesNotMatch(index, /handle[A-Za-z]+\(\s*account_id\b/);
  assert.match(index, /!isUnipileConfigured\(\)/);
});

test('UNS-6 un envoi : forme de l\'InMail avant le plafond et le marqueur, marqueur avant l\'appel, enregistrement après un envoi confirmé', () => {
  const send = read('send.ts');
  const planned = send.slice(send.indexOf('export async function planSend('), send.indexOf('export async function handleSendMessage('));
  assert.match(planned, /await planInmail\(/);
  assert.match(planned, /chatRef\(accountId, String\(chat_id\)\)/, 'conversation contrôlée avant tout marqueur');
  assert.doesNotMatch(planned, /prepareManualSend|recordManualSend|sendMessage\(|startConversation\(/, 'le plan n\'écrit ni n\'envoie rien');
  const body = send.slice(send.indexOf('export async function handleSendMessage('));
  const marker = body.indexOf('await prepareManualSend(');
  const post = body.indexOf('const outcome = chat_id');
  const failed = body.indexOf("if (outcome.outcome !== 'sent') {");
  const record = body.indexOf('await recordManualSend(');
  assert.ok(marker > 0 && post > marker && failed > post && record > failed);
  assert.doesNotMatch(body, /await planInmail\(/, 'la forme de l\'InMail ne se lit plus après le marqueur');
  assert.doesNotMatch(body, /outcome\.outcome === 'uncertain'[\s\S]{0,200}recordManualSend/);
  // Le plafond LinkedIn passe après les contrôles sans effet (recherche et envoi), jamais avant.
  const index = read('index.ts');
  const gate = index.indexOf('await enforceLinkedInAction(');
  assert.ok(gate > 0);
  assert.ok(index.indexOf('await prepareSearch(') > 0 && index.indexOf('await prepareSearch(') < gate);
  assert.ok(index.indexOf('await planSend(') > 0 && index.indexOf('await planSend(') < gate);
});

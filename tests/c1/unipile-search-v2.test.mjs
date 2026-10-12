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
 *   - UNS-4 les actions sont celles d'avant plus celles du lot S8 (search_from_url, list_recruiter_projects,
 *     list_sent_invitations, withdraw_invitation) ;
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
  for (const name of ['index.ts', 'search.ts', 'search-request.ts', 'chats.ts', 'profile.ts', 'send.ts', 'licence.ts', 'responses.ts',
    'search-url.ts', 'recruiter-projects.ts', 'invitations.ts', 'account-rules.ts']) {
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

test('UNS-4 les actions sont celles d\'avant plus les quatre du lot S8', () => {
  const actions = [...read('index.ts').matchAll(/case '([a-z_]+)':/g)].map(match => match[1]).sort();
  assert.deepEqual(actions, [
    'endorse_skill', 'get_chats', 'get_messages', 'get_parameters', 'get_profile', 'get_user_posts',
    'list_recruiter_projects', 'list_sent_invitations', 'mark_as_read', 'search', 'search_from_url', 'send_message',
    'sync_chat_history', 'withdraw_invitation',
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
  // Envoi et retrait d'une invitation : depuis son propre compte (account-rules.ts), jugé avant le plafond.
  assert.match(index, /ownerOnlyRefusal\(action, \{ isInternal, userId, accountOwnerId: ownership\.userId \}\)/, 'règle du compte propre');
  assert.ok(index.indexOf('ownerOnlyRefusal(action') > owner && index.indexOf('ownerOnlyRefusal(action') < quota);
  const rules = read('account-rules.ts');
  assert.match(rules, /OWNER_ONLY_ACTIONS[^;]*'send_message'[^;]*'withdraw_invitation'/, 'actions réservées au compte propre');
  assert.match(rules, /context\.accountOwnerId === context\.userId/);
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

test('UNS-7 lot S8 : lire une adresse ne cherche pas, le retrait ne touche que les invitations envoyées, le registre suit le retrait', () => {
  // search_from_url ne lance aucune recherche chez le prestataire : ni searchFromUrl, ni requête directe.
  const url = read('search-url.ts');
  assert.doesNotMatch(url, /searchFromUrl\(|unipileJson|unipileFetch|searchRecruiterPeople|searchClassicPeople|searchSalesNavigator/);
  assert.match(url, /resolveSearchUrl\(/);
  // list_recruiter_projects : licence Recruiter jugée avant la liste.
  const projects = read('recruiter-projects.ts');
  const projectsLicence = projects.indexOf('licenceProblem(accountId, recruiterProjectsProblem)');
  assert.ok(projectsLicence > 0 && projectsLicence < projects.indexOf('await listRecruiterProjects('));
  // Les projets clos sont demandés aussi : sans `status`, le prestataire ne rend que les projets actifs.
  assert.match(projects, /status: \[\.\.\.PROJECT_STATUSES\]/);
  assert.match(projects, /PROJECT_STATUSES = \['ACTIVE', 'CLOSED'\]/);
  // withdraw_invitation : l'invitation est retrouvée parmi les ENVOYÉES avant l'annulation, qui précède le registre
  // et la mise à jour des inscriptions ; la route d'annulation refuserait sinon une demande reçue.
  const inv = read('invitations.ts');
  const body = inv.slice(inv.indexOf('export async function handleWithdrawInvitation('));
  const lookup = body.indexOf('await findSentInvitation(');
  const cancel = body.indexOf('await withdrawRelationRequest(');
  const ledger = body.indexOf('await logWithdrawal(');
  const sync = body.indexOf('await syncWithdrawnEnrollments(');
  assert.ok(lookup > 0 && cancel > lookup && ledger > cancel && sync > ledger, 'ordre : recherche, annulation, registre, inscriptions');
  assert.doesNotMatch(inv, /cancelRelationRequest\(|acceptRelationRequest\(/, 'seul le retrait d\'une invitation envoyée');
  assert.match(inv, /listSentRelationRequests\(/);
  // Les écritures d'inscriptions restent dans l'organisation de l'appelant.
  assert.match(inv, /\.eq\('organization_id', organizationId\)/);
  assert.match(inv, /\.eq\('organization_id', args\.organizationId\)/);
  // Le retrait ne passe par aucun plafond : le registre ne lui donne qu'un type qu'aucun plafond ne lit.
  assert.match(inv, /WITHDRAW_LEDGER_TYPE = 'invitation_withdraw'/);
});

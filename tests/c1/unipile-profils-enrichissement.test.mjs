/**
 * Garde statique des profils, de l'enrichissement et des agents de sourcing sur l'API v2 seule
 * (passage v1 vers v2, tranche S6a).
 *
 * Invariants :
 *   - PE-1 aucun reste de l'API précédente : ni /api/v1, ni UNIPILE_DSN, UNIPILE_API_KEY,
 *     resolveUnipileCredentials, ni lecture de organization_integrations.unipile_*, ni variable dsn ;
 *   - PE-2 aucun appel direct au prestataire : le client partagé (_shared/unipile/index.ts) est le seul
 *     import du prestataire, et seuls l'enrichissement et la lecture des comptes d'agent l'appellent ;
 *   - PE-3 un identifiant de compte n'arrive à aucun appel sans avoir passé le format courant (acc_...),
 *     puis le rattachement à l'organisation ;
 *   - PE-4 jamais de visite de profil depuis l'enrichissement ni depuis les agents (conformité LinkedIn) ;
 *   - PE-5 aucun nom de prestataire dans une chaîne qui peut atteindre un utilisateur ou un modèle
 *     (les journaux du serveur, console.*, sont libres) ;
 *   - PE-6 la copie privée des photos garde sa liste d'origines (photos LinkedIn seulement) ;
 *   - PE-7 la source d'un contact tiré du profil ne porte plus le nom du prestataire.
 *
 * Lancer : node --test tests/c1/unipile-profils-enrichissement.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const FN = 'supabase/functions';
const FILES = [
  `${FN}/score-profile-job/index.ts`,
  `${FN}/_shared/profile-enrichment.ts`,
  `${FN}/_shared/profile-data.ts`,
  `${FN}/process-enrichment-queue/index.ts`,
  `${FN}/enrich-candidate-contact/index.ts`,
  `${FN}/get-enrichment-status/index.ts`,
  `${FN}/_shared/get-or-fetch-contact.ts`,
  `${FN}/_shared/continuous-sourcing.ts`,
  `${FN}/process-sourcing-agents/index.ts`,
  `${FN}/sourcing-agent/index.ts`,
  `${FN}/capture-candidate-photos/index.ts`,
  `${FN}/extension-quick-add/index.ts`,
  `${FN}/extension-pipeline-status/index.ts`,
];
const read = path => readFileSync(join(ROOT, path), 'utf8');
const ast = path => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);

test('PE-0 les fichiers de la tranche existent', () => {
  for (const path of FILES) assert.ok(read(path).length > 0, path);
});

test('PE-1 aucun reste de l\'API précédente dans le code de production', () => {
  const forbidden = [
    [/\/api\/v1/, '/api/v1'], [/UNIPILE_DSN/, 'UNIPILE_DSN'], [/UNIPILE_API_KEY/, 'UNIPILE_API_KEY'],
    [/resolveUnipileCredentials/, 'resolveUnipileCredentials'], [/unipile_api_key|unipile_dsn|unipile_connected/, 'colonnes unipile_*'],
    [/organization_integrations/, 'organization_integrations'], [/\bdsn\b/i, 'dsn'], [/X-API-KEY/, 'X-API-KEY'],
    [/linkedin_sections|notify=false|account_id=\$\{/, 'paramètres de la génération précédente'],
    [/parseUsagePct/, 'pourcentage d\'usage du prestataire (absent de l\'API v2)'],
  ];
  for (const path of FILES) {
    const source = read(path);
    for (const [pattern, label] of forbidden) assert.doesNotMatch(source, pattern, `${path} : ${label}`);
  }
});

test('PE-2 le client partagé est le seul accès au prestataire', () => {
  for (const path of FILES) {
    const source = read(path);
    for (const match of source.matchAll(/from ['"]((?:\.\.?\/)+_shared\/unipile[^'"]*|\.\/unipile[^'"]*)['"]/g)) {
      assert.match(match[1], /unipile\/index\.ts$/, `${path} : import du client`);
    }
    assert.doesNotMatch(source, /unipile-v2\.ts/, `${path} : ancien module`);
  }
  // Seuls ces fichiers parlent au prestataire (lecture d'un profil, état d'un compte).
  const users = FILES.filter(path => /from ['"][^'"]*unipile\/index\.ts['"]/.test(read(path))).sort();
  assert.deepEqual(users, [
    `${FN}/_shared/continuous-sourcing.ts`, `${FN}/_shared/profile-enrichment.ts`,
    `${FN}/score-profile-job/index.ts`, `${FN}/sourcing-agent/index.ts`,
  ].sort());
  // Les appels réseau qui restent : la recherche et le scoring de Konekt, le modèle, le fournisseur de contacts, le CDN des photos.
  const fetches = path => [...read(path).matchAll(/\bfetch(?:WithTimeout)?\(\s*(["'`][^"'`]*)/g)].map(match => match[1]);
  assert.deepEqual(fetches(`${FN}/_shared/profile-enrichment.ts`), []);
  assert.deepEqual(fetches(`${FN}/process-enrichment-queue/index.ts`), []);
  assert.ok(fetches(`${FN}/score-profile-job/index.ts`).every(target => target.startsWith('"https://api.anthropic.com/')),
    'score-profile-job : le modèle seulement');
});

test('PE-3 le compte est contrôlé avant tout appel, dans l\'ordre : format courant, rattachement, registre, lecture', () => {
  const enrichment = read(`${FN}/_shared/profile-enrichment.ts`);
  const format = enrichment.indexOf('assertV2AccountId(deps.accountId)');
  const owner = enrichment.indexOf('await assertAccountOwnedByOrg(');
  const ledger = enrichment.indexOf('await enforceLinkedInAction(');
  const read1 = enrichment.indexOf('await getProfile(');
  assert.ok(format > 0 && owner > format && ledger > owner && read1 > ledger, 'ordre des contrôles de l\'enrichissement');
  assert.match(enrichment, /kinds: \["linkedin"\]/);

  // Le compte vient du navigateur : il n'entre dans la file qu'une fois contrôlé.
  const scoring = read(`${FN}/score-profile-job/index.ts`);
  const check = scoring.indexOf('await assertAccountOwnedByOrg(');
  const context = scoring.indexOf('enrichmentCtx = {');
  assert.ok(scoring.indexOf('isV2AccountId(accountId)') > 0 && check > scoring.indexOf('isV2AccountId(accountId)') && context > check);
  assert.match(scoring, /accountId: enrichmentAccountId,/, 'le contexte ne reçoit que le compte contrôlé');
  assert.doesNotMatch(scoring, /enrichmentCtx = \{\s*accountId,/);

  const agents = read(`${FN}/_shared/continuous-sourcing.ts`);
  const body = agents.slice(agents.indexOf('export async function readOwnAgentAccounts('));
  assert.ok(body.indexOf('isV2AccountId(id)') > 0 && body.indexOf('await getAccount(id)') > body.indexOf('isV2AccountId(id)'));
  assert.ok(body.indexOf('await beforeProvider()') > 0 && body.indexOf('await beforeProvider()') < body.indexOf('await getAccount(id)'),
    'la barrière précède chaque appel');
  assert.match(body, /\.eq\('user_id', userId\)/, 'seuls les comptes du membre');

  const control = read(`${FN}/sourcing-agent/index.ts`);
  assert.match(control, /!isV2AccountId\(accountId\)[\s\S]{0,160}ACCOUNT_RECONNECT/);
});

test('PE-4 aucune visite de profil', () => {
  for (const path of FILES) {
    const source = read(path);
    assert.doesNotMatch(source, /visitProfile|visit-profile|notifyVisitToken/, path);
  }
  // Une seule lecture, sans les publications (empreinte minimale, conformité #260513-007211).
  const code = read(`${FN}/_shared/profile-enrichment.ts`).replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /listUserPosts|getUserPosts|\/posts/);
});

test('PE-5 aucun nom de prestataire dans une chaîne qui peut atteindre un utilisateur ou un modèle', () => {
  const vendor = /unipile|apollo|people data labs|\bpdl\b/i;
  const found = [];
  const isLogCall = node => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)
        && ts.isIdentifier(parent.expression.expression) && parent.expression.expression.text === 'console') return true;
    }
    return false;
  };
  for (const path of FILES) {
    const visit = node => {
      const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
      // Le nom de la fonction de recherche est un identifiant interne (adresse d'appel de serveur à serveur).
      // « Apollo GraphQL » est une technologie de la taxonomie des compétences, pas le fournisseur.
      if (literal && vendor.test(node.text) && !/^unipile-search$|\/functions\/v1\/$|apollo graphql/i.test(node.text)
        && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent) && !isLogCall(node)) {
        found.push(`${path} : ${JSON.stringify(node.text)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast(path));
  }
  assert.deepEqual(found, []);
});

test('PE-6 la copie privée des photos ne télécharge que les photos LinkedIn', () => {
  const shared = read(`${FN}/_shared/candidate-photo.ts`);
  assert.match(shared, /DEFAULT_PHOTO_ORIGINS = \['https:\/\/media\.licdn\.com'\]/);
  const capture = read(`${FN}/capture-candidate-photos/index.ts`);
  assert.match(capture, /isAllowedPhotoUrl\(row\.picture_url, origins\)/);
  assert.match(capture, /redirect: "manual"/);
  // L'adresse vient de la base (profile_picture_url), jamais d'un appel au prestataire.
  assert.doesNotMatch(capture, /private_picture_download_url|public_picture_url/);
});

test('PE-7 la source d\'un contact tiré du profil est « linkedin »', () => {
  const contact = read(`${FN}/_shared/get-or-fetch-contact.ts`);
  assert.match(contact, /\| 'linkedin'\s+\/\/ contact_info/);
  assert.match(contact, /source: 'linkedin'/);
  assert.doesNotMatch(contact, /source: 'unipile'|\| 'unipile'/);
});

test('PE-8 une lecture de profil de la file = une seule forme d\'identifiant (une entrée au registre profile_view)', () => {
  const enrichment = read(`${FN}/_shared/profile-enrichment.ts`);
  // Le client essaie chaque forme à la suite : la référence n'en porte qu'une.
  assert.match(enrichment, /if \(id\) return \{ providerId: id \};\s+return slug \? \{ slug \} : null;/);
  assert.doesNotMatch(enrichment, /return slug \|\| id \? \{ slug, providerId: id \}/);
});

test('PE-9 un agent de sourcing ne reçoit que le contrat sélectionné et ne se bloque pas sur une panne passagère', () => {
  const code = read(`${FN}/_shared/continuous-sourcing.ts`);
  assert.match(code, /contract\.selected === true/);
  assert.match(code, /TRANSIENT_KINDS = \['network', 'server', 'rate_limited', 'uncertain', 'account_degraded'\]/);
  assert.match(code, /new ContinuousError\('RETRY_LATER'/);
  const queue = read(`${FN}/process-enrichment-queue/index.ts`);
  assert.match(queue, /nextQueueStep\(res\.reason, item\.attempts\)/);
});

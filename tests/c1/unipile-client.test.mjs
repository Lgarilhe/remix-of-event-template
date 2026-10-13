/**
 * Garde statique du client partagé du prestataire LinkedIn
 * (supabase/functions/_shared/unipile/, passage à l'API v2 seule).
 *
 * Invariants :
 *   - UCLI-1 seul http.ts appelle fetch (donc seul http.ts parle à l'hôte du
 *     prestataire) ;
 *   - UCLI-2 aucun module ne contient /api/v1, UNIPILE_DSN ni
 *     resolveUnipileCredentials (texte brut, commentaires compris : un module
 *     de test peut les citer, pas un module de production) ;
 *   - UCLI-3 aucun module n'importe supabase-js (le client n'écrit jamais en
 *     base, la persistance reste chez l'appelant) ;
 *   - UCLI-4 aucun message d'erreur de errors.ts et de config.ts ne contient le
 *     nom d'un prestataire, quel que soit le contenu de la réponse reçue ;
 *   - UCLI-5 index.ts réexporte tout ce que chaque module exporte, sauf deux
 *     cas écrits ci-dessous (testing.ts et setTransportDefaults), sans
 *     collision de nom, et porte les noms documentés (DESIGN.md, section 2.1).
 *
 * Écarts entre DESIGN.md section 2.1 et les modules écrits (le barrel ne
 * invente aucun alias) :
 *   - searchClassic, searchRecruiter, searchSalesNavigator : les modules
 *     exportent searchClassicPeople, searchRecruiterPeople,
 *     searchSalesNavigatorPeople (et les recherches de sociétés, d'offres,
 *     de publications) ;
 *   - listThreads, getIntent et getAccountUsage (facultative dans le DESIGN)
 *     n'existent pas encore : ils ne sont pas exigés ici.
 *
 * Lancer : node --test tests/c1/unipile-client.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const CLIENT_DIR = join(ROOT, 'supabase/functions/_shared/unipile');

/** Modules que le barrel ne réexporte pas, avec la raison. */
const BARREL_EXCLUDED_MODULES = new Map([
  ['testing.ts', 'aides de test (withMockTransport, fixtures), jamais importées par la production'],
]);
/** Noms que le barrel ne réexporte pas, par module, avec la raison. */
const BARREL_EXCLUDED_NAMES = new Map([
  ['http.ts', new Map([['setTransportDefaults', 'point d\'appui des tests, utilisé par testing.ts seulement']])],
]);

/** Noms de DESIGN.md section 2.1 (colonne Exports), sous le nom réellement exporté. */
const DOCUMENTED = {
  'config.ts': ['UNIPILE_BASE_URL', 'UnipileConfigError', 'getUnipileConfig', 'isUnipileConfigured', 'hostedDomain'],
  'http.ts': ['unipileFetch', 'unipileJson', 'unipileVoid', 'RetryPolicy', 'UnipileRequest'],
  'errors.ts': ['UnipileError', 'classifyError', 'userSafeMessage', 'ErrorKind'],
  'pagination.ts': ['paginate', 'collect', 'Page'],
  'ids.ts': [
    'isV2AccountId', 'assertV2AccountId', 'v1ToV2AccountId', 'normalizeMessageId', 'normalizeMessageIds',
    'userRef', 'chatRef', 'AccountMap',
  ],
  'status.ts': ['mapAccountStatus', 'isSendable', 'isReconnectable', 'KonektAccountStatus'],
  'guard.ts': ['assertAccountOwnedByOrg', 'AccountNotOwnedError'],
  'accounts.ts': [
    'listAccounts', 'getAccount', 'deleteAccount', 'createHostedLink', 'createAuthIntent',
    'submitCheckpoint', 'requestCheckpoint', 'resendCheckpoint',
  ],
  'webhooks.ts': [
    'listEndpoints', 'createEndpoint', 'patchEndpoint', 'deleteEndpoint', 'listDeliveries', 'replayEvent',
    'V2_TRIGGER_EVENTS', 'deriveWebhookToken', 'resolveWebhookToken', 'verifyWebhookRequest',
    'flattenEnvelope', 'EVENT_ALIASES',
  ],
  'messaging.ts': ['listChats', 'getChat', 'getChatForUser', 'startChat', 'sendMessage', 'listMessages', 'markRead', 'SendOutcome'],
  'users.ts': [
    'getProfile', 'visitProfile', 'listRelations', 'sendRelationRequest', 'listSentRelationRequests',
    'withdrawRelationRequest', 'getCompany',
  ],
  'linkedin.ts': [
    'searchClassicPeople', 'searchRecruiterPeople', 'searchSalesNavigatorPeople', 'searchParameters',
    'resolveSearchUrl', 'getInmailCredits', 'listContracts', 'selectContract', 'listRecruiterProjects',
  ],
  'email.ts': ['sendEmail', 'listEmails', 'getEmail', 'getThread'],
  'calendar.ts': ['listCalendars', 'listEvents'],
  'normalize/profile.ts': ['toKonektProfile'],
  'normalize/search.ts': ['toKonektSearchResults', 'toKonektFilters'],
  'normalize/messages.ts': ['toKonektChat', 'toKonektMessage', 'toKonektEmail'],
};

/** Noms de prestataires qu'un utilisateur ne doit jamais lire (CLAUDE.md, « Branding »), plus les autres services du moteur. */
const VENDOR_NAME_RE =
  /unipile|apollo|people\s*data\s*labs|\bpdl\b|anthropic|claude|brandfetch|clearbit|logo\.dev|\bresend\b|coresignal|openai|deepgram|firecrawl|perplexity|bettercontact|dropcontact|stripe/i;

// ---------------------------------------------------------------------------
// Lecture du dossier
// ---------------------------------------------------------------------------

const toPosix = (path) => path.split('\\').join('/');

/** Fichiers .ts du dossier, chemins relatifs à CLIENT_DIR. */
function listTs(dir = CLIENT_DIR) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) files.push(...listTs(abs));
    else if (name.endsWith('.ts')) files.push(toPosix(relative(CLIENT_DIR, abs)));
  }
  return files;
}

const ALL_TS = listTs();
const TEST_FILES = ALL_TS.filter((file) => file.endsWith('.test.ts'));
/** Modules de production (testing.ts et index.ts compris, tests exclus). */
const MODULES = ALL_TS.filter((file) => !file.endsWith('.test.ts'));

const sourceOf = (file) => readFileSync(join(CLIENT_DIR, file), 'utf8');
const parse = (file) => ts.createSourceFile(file, sourceOf(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const lineOf = (node, sf) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

const hasExportModifier = (node) => node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;

/** Noms exportés par un module, avec leur nature : 'type' (effacé à l'exécution) ou 'value'. */
function declaredExports(file) {
  const exported = new Map();
  for (const statement of parse(file).statements) {
    if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
      assert.fail(`${file} : forme d'export non gérée par ce garde (${statement.getText().slice(0, 60)})`);
    }
    if (!hasExportModifier(statement)) continue;
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      exported.set(statement.name.text, 'type');
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      assert.ok(statement.name, `${file} : export sans nom`);
      exported.set(statement.name.text, 'value');
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        assert.ok(ts.isIdentifier(declaration.name), `${file} : export par déstructuration non géré`);
        exported.set(declaration.name.text, 'value');
      }
    }
  }
  return exported;
}

/**
 * Ce que index.ts exporte, calculé sans l'exécuter : nom -> nature, modules
 * cités, noms portés par deux modules à la fois. Le barrel ne contient que des
 * réexportations.
 */
function barrelExports() {
  const names = new Map();
  const owners = new Map();
  const referenced = new Set();
  for (const statement of parse('index.ts').statements) {
    assert.ok(ts.isExportDeclaration(statement) && statement.moduleSpecifier,
      `index.ts : une seule sorte de ligne admise, « export ... from '...' » (trouvé : ${statement.getText().slice(0, 60)})`);
    const target = toPosix(join(dirname('index.ts'), statement.moduleSpecifier.text));
    assert.ok(MODULES.includes(target), `index.ts : module inconnu ${statement.moduleSpecifier.text}`);
    referenced.add(target);
    const declared = declaredExports(target);
    const reexported = [];
    if (!statement.exportClause) {
      for (const [name, kind] of declared) reexported.push([name, kind]);
    } else {
      assert.ok(ts.isNamedExports(statement.exportClause), `index.ts : « export * as ... » non géré (${target})`);
      for (const element of statement.exportClause.elements) {
        const source = (element.propertyName ?? element.name).text;
        assert.ok(declared.has(source), `index.ts : ${target} n'exporte pas « ${source} »`);
        reexported.push([element.name.text, declared.get(source)]);
      }
    }
    for (const [name, kind] of reexported) {
      names.set(name, kind);
      owners.set(name, [...(owners.get(name) ?? []), target]);
    }
  }
  const collisions = [...owners].filter(([, files]) => new Set(files).size > 1).map(([name, files]) => `${name} (${files.join(', ')})`);
  return { names, referenced, collisions };
}

/** Compile des modules du client en un seul module ES chargeable par Node. */
async function loadBundle(entryContents) {
  const result = await build({
    stdin: { contents: entryContents, resolveDir: CLIENT_DIR, loader: 'ts', sourcefile: 'unipile-client-entry.ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

// ---------------------------------------------------------------------------
// Le garde lit bien ce qu'il doit lire
// ---------------------------------------------------------------------------

test('UCLI-0 le dossier du client est lu en entier (le garde n\'est pas vide)', () => {
  for (const file of [
    'config.ts', 'http.ts', 'errors.ts', 'pagination.ts', 'ids.ts', 'status.ts', 'guard.ts', 'accounts.ts',
    'webhooks.ts', 'messaging.ts', 'users.ts', 'linkedin.ts', 'email.ts', 'calendar.ts', 'testing.ts', 'index.ts',
    'normalize/profile.ts', 'normalize/search.ts', 'normalize/messages.ts',
  ]) {
    assert.ok(MODULES.includes(file), `module attendu et absent : ${file}`);
  }
  assert.ok(TEST_FILES.length > 0, 'aucun fichier de test trouvé');
});

// ---------------------------------------------------------------------------
// UCLI-1 un seul transport
// ---------------------------------------------------------------------------

test('UCLI-1 seul http.ts appelle fetch', () => {
  const offenders = [];
  for (const file of MODULES.filter((f) => f !== 'http.ts')) {
    const sf = parse(file);
    visit(sf, (node) => {
      // Identifiant `fetch` (appel, globalThis.fetch, alias) ou globalThis['fetch'] ; les commentaires n'entrent pas dans l'arbre.
      const isFetchIdentifier = ts.isIdentifier(node) && node.text === 'fetch';
      const isFetchString = ts.isStringLiteralLike(node) && node.text === 'fetch';
      if (isFetchIdentifier || isFetchString) offenders.push(`${file}:${lineOf(node, sf)}`);
    });
  }
  assert.deepEqual(offenders, [], `fetch hors de http.ts : ${offenders.join(', ')}`);

  let httpCallsFetch = false;
  visit(parse('http.ts'), (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') httpCallsFetch = true;
  });
  assert.ok(httpCallsFetch, 'http.ts n\'appelle plus fetch : le garde ne vérifie plus rien, à mettre à jour');
});

// ---------------------------------------------------------------------------
// UCLI-2 plus de v1, plus de DSN
// ---------------------------------------------------------------------------

test('UCLI-2 aucun module ne contient /api/v1, UNIPILE_DSN ni resolveUnipileCredentials', () => {
  const forbidden = ['/api/v1', 'UNIPILE_DSN', 'resolveUnipileCredentials'];
  const offenders = [];
  for (const file of MODULES) {
    const lines = sourceOf(file).split('\n');
    lines.forEach((line, index) => {
      for (const word of forbidden) if (line.includes(word)) offenders.push(`${file}:${index + 1} (${word})`);
    });
  }
  assert.deepEqual(offenders, [], `chaînes interdites : ${offenders.join(', ')}`);
});

// ---------------------------------------------------------------------------
// UCLI-3 pas de supabase-js
// ---------------------------------------------------------------------------

test('UCLI-3 aucun fichier du client n\'importe supabase-js', () => {
  const offenders = [];
  for (const file of ALL_TS) {
    const sf = parse(file);
    visit(sf, (node) => {
      let specifier = null;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        specifier = node.moduleSpecifier.text;
      } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])
        && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        specifier = node.arguments[0].text;
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
        && ts.isStringLiteralLike(node.moduleReference.expression)) {
        specifier = node.moduleReference.expression.text;
      }
      if (specifier !== null && /supabase/i.test(specifier)) offenders.push(`${file}:${lineOf(node, sf)} (${specifier})`);
    });
  }
  assert.deepEqual(offenders, [], `import de supabase : ${offenders.join(', ')}`);
});

// ---------------------------------------------------------------------------
// UCLI-4 messages d'erreur sans nom de prestataire
// ---------------------------------------------------------------------------

test('UCLI-4 les messages d\'erreur de errors.ts et config.ts ne nomment aucun prestataire', async () => {
  const { userSafeMessage, safeErrorOf, UnipileError, UnipileConfigError, getUnipileConfig, hostedDomain, isUnipileConfigured } =
    await loadBundle("export * from './errors.ts'; export * from './config.ts';");

  // Les valeurs de ErrorKind, lues dans le type : un genre ajouté plus tard est couvert sans toucher au garde.
  let kinds = [];
  visit(parse('errors.ts'), (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'ErrorKind' && ts.isUnionTypeNode(node.type)) {
      kinds = node.type.types.map((member) => member.literal.text);
    }
  });
  assert.ok(kinds.length >= 12 && kinds.includes('config') && kinds.includes('uncertain'), `ErrorKind mal lu : ${kinds.join(', ')}`);

  const leak = (label, text) => {
    assert.equal(typeof text, 'string', `${label} : pas un texte`);
    assert.ok(text.length > 0, `${label} : texte vide`);
    assert.ok(!VENDOR_NAME_RE.test(text), `${label} : nom de prestataire dans « ${text} »`);
  };

  // Même quand la réponse du prestataire, la note de débogage ou la cause portent son nom.
  for (const kind of kinds) {
    leak(`userSafeMessage('${kind}')`, userSafeMessage(kind));
    const error = new UnipileError(kind, {
      status: 500,
      debug: { body: { message: 'Unipile refused the request', error: 'unipile_error' }, note: 'Unipile note', path: '/accounts/acc_x' },
      cause: new Error('Unipile exploded'),
    });
    leak(`UnipileError('${kind}').message`, error.message);
    leak(`UnipileError('${kind}').userMessage`, error.userMessage);
    leak(`UnipileError('${kind}') JSON`, JSON.stringify(error));
    leak(`safeErrorOf('${kind}')`, safeErrorOf(error).message);
    // String(error) et l'interpolation passent par `name` : le nom de classe ne doit pas porter le prestataire.
    leak(`String(UnipileError('${kind}'))`, String(error));
    leak(`UnipileError('${kind}').name`, error.name);
    assert.ok(!Object.keys(error).includes('debug'), `UnipileError('${kind}') : debug doit rester non énumérable`);
  }
  leak('safeErrorOf(exception étrangère)', safeErrorOf(new Error('Unipile exploded')).message);
  leak('safeErrorOf(chaîne)', safeErrorOf('Unipile exploded').message);

  // config.ts : clé absente, nom d'hôte invalide, constructeur direct.
  let missingKey;
  try {
    getUnipileConfig(() => undefined);
  } catch (error) {
    missingKey = error;
  }
  assert.ok(missingKey instanceof UnipileConfigError, 'getUnipileConfig sans clé doit lever UnipileConfigError');
  leak('getUnipileConfig sans clé', missingKey.message);
  leak('getUnipileConfig sans clé (JSON)', JSON.stringify(missingKey));
  leak('String(UnipileConfigError)', String(missingKey));
  assert.ok(!Object.keys(missingKey).includes('debug'), 'UnipileConfigError : debug doit rester non énumérable');
  assert.equal(isUnipileConfigured(() => undefined), false);

  let badHost;
  try {
    hostedDomain((name) => (name === 'UNIPILE_HOSTED_DOMAIN' ? 'pas un nom d\'hôte !' : undefined));
  } catch (error) {
    badHost = error;
  }
  assert.ok(badHost instanceof UnipileConfigError, 'hostedDomain avec une valeur invalide doit lever UnipileConfigError');
  leak('hostedDomain invalide', badHost.message);
  leak('UnipileConfigError direct', new UnipileConfigError('UNIPILE_V2_API_KEY is not set').message);
});

// ---------------------------------------------------------------------------
// UCLI-5 le barrel
// ---------------------------------------------------------------------------

test('UCLI-5a index.ts réexporte tous les modules et tout ce qu\'ils exportent, sans collision', () => {
  const { names, referenced, collisions } = barrelExports();
  assert.deepEqual(collisions, [], `noms exportés par deux modules : ${collisions.join('; ')}`);

  const missing = [];
  for (const file of MODULES.filter((f) => f !== 'index.ts' && !BARREL_EXCLUDED_MODULES.has(f))) {
    if (!referenced.has(file)) {
      missing.push(`${file} (module non cité)`);
      continue;
    }
    const excludedNames = BARREL_EXCLUDED_NAMES.get(file) ?? new Map();
    for (const [name] of declaredExports(file)) {
      if (!excludedNames.has(name) && !names.has(name)) missing.push(`${file} : ${name}`);
    }
  }
  assert.deepEqual(missing, [], `absent de index.ts : ${missing.join(', ')}`);
});

test('UCLI-5b index.ts laisse de côté testing.ts et setTransportDefaults', () => {
  const { names, referenced } = barrelExports();
  for (const file of BARREL_EXCLUDED_MODULES.keys()) {
    assert.ok(!referenced.has(file), `index.ts ne doit pas citer ${file}`);
    for (const [name] of declaredExports(file)) {
      assert.ok(!names.has(name), `index.ts exporte « ${name} » (${file})`);
    }
  }
  for (const [file, excludedNames] of BARREL_EXCLUDED_NAMES) {
    for (const name of excludedNames.keys()) {
      assert.ok(declaredExports(file).has(name), `${file} n'exporte plus « ${name} » : retirer l'exception du garde`);
      assert.ok(!names.has(name), `index.ts exporte « ${name} » (${file})`);
    }
  }
});

test('UCLI-5c index.ts porte les noms documentés (DESIGN.md, section 2.1)', () => {
  const { names } = barrelExports();
  const problems = [];
  for (const [file, documented] of Object.entries(DOCUMENTED)) {
    const declared = declaredExports(file);
    for (const name of documented) {
      if (!declared.has(name)) problems.push(`${file} n'exporte pas « ${name} »`);
      else if (!names.has(name)) problems.push(`index.ts n'exporte pas « ${name} » (${file})`);
    }
  }
  assert.deepEqual(problems, [], problems.join('; '));
});

test('UCLI-5d le barrel compilé exporte exactement les valeurs que le garde en déduit', async () => {
  const bundle = await loadBundle("export * from './index.ts';");
  const { names } = barrelExports();
  const expected = [...names].filter(([, kind]) => kind === 'value').map(([name]) => name).sort();
  assert.deepEqual(Object.keys(bundle).sort(), expected);
  for (const forbidden of ['setTransportDefaults', 'withMockTransport', 'fixtures']) {
    assert.ok(!(forbidden in bundle), `${forbidden} ne doit pas sortir du barrel`);
  }
});

// ---------------------------------------------------------------------------
// UCLI-6 le point d'appui des tests reste aux tests
// ---------------------------------------------------------------------------

/** Fichiers .ts, .tsx, .mjs de supabase/functions et de e2e (hors node_modules), chemins relatifs à ROOT. */
function listSources(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) listSources(abs, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(toPosix(relative(ROOT, abs)));
  }
  return out;
}

test('UCLI-6 setTransportDefaults (qui accepte une configuration entière) n\'est cité que par http.ts, testing.ts et les tests', () => {
  const allowed = (file) =>
    file === 'supabase/functions/_shared/unipile/http.ts' ||
    file === 'supabase/functions/_shared/unipile/testing.ts' ||
    file === 'supabase/functions/_shared/unipile/index.ts' || // le commentaire du barrel le cite pour dire qu'il le laisse de côté (UCLI-5)
    /\.test\.(ts|mjs)$/.test(file);
  const offenders = [];
  for (const dir of ['supabase/functions', 'e2e']) {
    for (const file of listSources(join(ROOT, dir))) {
      if (allowed(file)) continue;
      if (readFileSync(join(ROOT, file), 'utf8').includes('setTransportDefaults')) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `setTransportDefaults cité hors des tests : ${offenders.join(', ')}`);
});

/**
 * Garde statique du lot S6b (passage à l'API v2 seule) : rédaction des messages,
 * IA de la messagerie, fonctions annexes.
 *
 *   generate-outreach-message, auto-analyze-message, auto-categorize-chats,
 *   resolve-pedigree-directory (appels au prestataire) ;
 *   generate-search-filters, coresignal-search, export-org-data, rgpd-purge,
 *   rgpd-erase-contact, enrich-company, resolve-client-logo,
 *   refresh-pedigree-by-funding-stage, _shared/rag-adapters.ts,
 *   _shared/linkedin-quotas.ts, _shared/timing-safe-equal.ts (aucun appel).
 *
 * Invariants :
 *   - S6B-1 aucun fichier du lot ne contient l'ancienne adresse (/api/v1 du
 *     prestataire LinkedIn), UNIPILE_DSN, UNIPILE_API_KEY, resolveUnipileCredentials,
 *     les colonnes unipile_* d'organization_integrations ni une variable dsn ;
 *   - S6B-2 aucun fichier du lot n'appelle fetch vers l'hôte du prestataire :
 *     les quatre fonctions qui lisent chez lui passent par _shared/unipile ;
 *   - S6B-3 chaque lecture à partir d'un identifiant de compte reçu d'une requête
 *     contrôle le format du compte et son rattachement à l'organisation avant l'appel ;
 *   - S6B-4 aucune phrase rendue à un utilisateur ou invite de modèle ne nomme le prestataire ;
 *   - S6B-5 resolve-pedigree-directory refuse un identifiant de compte ancien.
 *
 * Lancer : node --test tests/c1/unipile-fonctions-annexes.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const FN = 'supabase/functions';
const READERS = {
  'generate-outreach-message': [`${FN}/generate-outreach-message/index.ts`, `${FN}/generate-outreach-message/recent-posts.ts`],
  'auto-analyze-message': [`${FN}/auto-analyze-message/index.ts`, `${FN}/auto-analyze-message/chat-reads.ts`, `${FN}/auto-analyze-message/account-gate.ts`],
  'auto-categorize-chats': [`${FN}/auto-categorize-chats/index.ts`, `${FN}/auto-categorize-chats/chat-messages.ts`, `${FN}/auto-categorize-chats/chat-accounts.ts`],
  'resolve-pedigree-directory': [`${FN}/resolve-pedigree-directory/index.ts`, `${FN}/resolve-pedigree-directory/resolver.ts`],
};
const OTHERS = [
  `${FN}/generate-search-filters/index.ts`,
  `${FN}/coresignal-search/index.ts`,
  `${FN}/export-org-data/index.ts`,
  `${FN}/rgpd-purge/index.ts`,
  `${FN}/rgpd-erase-contact/index.ts`,
  `${FN}/enrich-company/index.ts`,
  `${FN}/resolve-client-logo/index.ts`,
  `${FN}/refresh-pedigree-by-funding-stage/index.ts`,
  `${FN}/_shared/rag-adapters.ts`,
  `${FN}/_shared/linkedin-quotas.ts`,
  `${FN}/_shared/timing-safe-equal.ts`,
];
const PRODUCTION = [...Object.values(READERS).flat(), ...OTHERS];

// Les URL d'API d'autres prestataires (Apollo) portent aussi /api/v1 : elles ne comptent pas.
const OTHER_VENDOR_V1 = /https?:\/\/api\.apollo\.io\/api\/v1|APOLLO_BASE|apollo[^\n]*\/api\/v1|\/api\/v1\/(mixed_|organizations|news_articles)/i;

function offending(src, regex) {
  return src.split('\n').map((line, i) => ({ line, n: i + 1 })).filter(({ line }) => regex.test(line) && !OTHER_VENDOR_V1.test(line));
}

test('S6B-1 : aucun reste de l\'ancienne API dans les fichiers du lot', () => {
  for (const rel of PRODUCTION) {
    const src = read(rel);
    assert.deepEqual(offending(src, /\/api\/v1/), [], `${rel} : /api/v1`);
    assert.doesNotMatch(src, /UNIPILE_DSN|UNIPILE_API_KEY|resolveUnipileCredentials|unipile_api_key|unipile_dsn|unipile_connected/, rel);
    assert.doesNotMatch(src, /\b(const|let|var)\s+dsn\b|\bdsn\s*:/, `${rel} : variable dsn`);
  }
});

test('S6B-1 : resolve-org-credentials n\'a plus d\'ancien résolveur du service LinkedIn', () => {
  const src = read(`${FN}/_shared/resolve-org-credentials.ts`);
  assert.doesNotMatch(src, /resolveUnipileCredentials|UnipileCredentials|UNIPILE_DSN|UNIPILE_API_KEY|unipile_api_key|unipile_dsn|unipile_connected|ancien résolveur/);
  // Les autres résolveurs ne sont pas touchés.
  for (const name of ['resolveApolloCredentials', 'resolveCoresignalCredentials', 'resolveAnthropicCredentials', 'resolveOrgIdFromUser']) {
    assert.match(src, new RegExp(`export async function ${name}\\(`), name);
  }
});

test('S6B-2 : les quatre fonctions qui lisent chez le prestataire passent par le client commun, sans fetch vers lui', () => {
  for (const [name, files] of Object.entries(READERS)) {
    const joined = files.map(read).join('\n');
    assert.match(joined, /_shared\/unipile\/index\.ts/, `${name} : client commun`);
    assert.doesNotMatch(joined, /unipile\.com|X-API-KEY/, `${name} : pas d'hôte ni d'en-tête de clé`);
    // Les fetch restants vont vers le modèle, la recherche de contexte ou une autre fonction Konekt.
    for (const { line, n } of offending(joined, /\bfetch(WithTimeout)?\(/)) {
      assert.match(line, /functions\/v1|anthropic|\$\{|options|url:|function fetchWithTimeout|return fetch\(/i, `${name} : fetch inattendu (${n}) ${line.trim()}`);
    }
  }
  // generate-outreach-message ne redéfinit plus de lecture de publications maison.
  assert.doesNotMatch(read(`${FN}/generate-outreach-message/index.ts`), /async function fetchRecentPosts/);
});

test('S6B-3 : lecture à partir d\'un compte reçu = format du compte + rattachement à l\'organisation, avant l\'appel', () => {
  const posts = read(`${FN}/generate-outreach-message/recent-posts.ts`);
  const post = (re) => posts.search(re);
  assert.ok(post(/assertV2AccountId\(accountId\)/) > 0 && post(/assertAccountOwnedByOrg\(deps\.admin, deps\.organizationId, accountId/) > post(/assertV2AccountId/)
    && post(/listUserPosts\(/) > post(/assertAccountOwnedByOrg\(/), 'publications : format, rattachement, puis lecture');
  // Le compte d'un collègue n'est jamais utilisé : le rattachement est celui de la personne qui rédige.
  assert.match(posts, /assertAccountOwnedByOrg\(deps\.admin, deps\.organizationId, accountId, \{ kinds: \['linkedin'\], userId: deps\.userId \}\)/);
  assert.match(read(`${FN}/generate-outreach-message/index.ts`), /fetchRecentPosts\(\{ admin: svc, organizationId: orgId, userId \}/);

  // Lecture d'analyse : le contrôle est dans account-gate.ts (testé en Deno), appelé avant toute lecture.
  const analyze = read(`${FN}/auto-analyze-message/index.ts`);
  const gateSrc = read(`${FN}/auto-analyze-message/account-gate.ts`);
  assert.ok(gateSrc.indexOf('assertV2AccountId(accountId)') > 0);
  assert.ok(gateSrc.indexOf('assertAccountOwnedByOrg(deps.admin, accountOrgId, accountId') > gateSrc.indexOf('accountFormatRefusal(input.accountId)'));
  assert.match(gateSrc, /if \(!accountOrgId\) return \{ ok: false, \.\.\.FORBIDDEN \}/, 'compte sans organisation : refus, jamais de lecture avec la clé commune');
  assert.doesNotMatch(analyze, /if \(account_id && accountOrgId\)/, 'le contrôle ne dépend plus de la présence d\'une organisation');
  assert.ok(analyze.indexOf('await authorizeAccount(') > 0);
  assert.ok(analyze.indexOf('await Promise.all([\n      fetchChatDetails(account_id, chat_id),') > analyze.indexOf('await authorizeAccount('), 'lectures après le contrôle');

  const categorize = read(`${FN}/auto-categorize-chats/index.ts`);
  const accounts = read(`${FN}/auto-categorize-chats/chat-accounts.ts`);
  assert.match(accounts, /assertV2AccountId\(accountId\);\s*await assertAccountOwnedByOrg\(admin, organizationId, accountId as string, \{ kinds: \['linkedin'\] \}\)/);
  assert.ok(categorize.indexOf('await gateChatAccounts(') > 0);
  assert.ok(categorize.indexOf('await gateChatAccounts(') < categorize.indexOf('await assertCredits('), 'refus avant le garde des crédits');
  assert.ok(categorize.indexOf('await gateChatAccounts(') < categorize.indexOf('fetchChatMessages(chat.account_id'), 'refus avant toute lecture');
});

test('S6B-3 : les lectures de messages écartent les lignes système et les étapes d\'invitation ou d\'InMail du candidat', () => {
  for (const rel of [`${FN}/auto-analyze-message/chat-reads.ts`, `${FN}/auto-categorize-chats/chat-messages.ts`]) {
    const src = read(rel);
    assert.match(src, /isCandidateReplyCandidate\(message\)/, rel);
    assert.match(src, /is_event !== true && message\.is_hidden !== true && message\.is_deleted !== true/, rel);
  }
});

test('S6B-4 : aucune phrase rendue ni invite ne nomme le prestataire LinkedIn', () => {
  const prompt = read(`${FN}/generate-search-filters/index.ts`);
  assert.doesNotMatch(prompt, /API Unipile/);
  assert.match(prompt, /Valeurs VALIDES:/);
  for (const rel of PRODUCTION.filter((f) => !f.endsWith('.test.ts'))) {
    const src = read(rel);
    // Chaînes de texte : on cherche le nom entre guillemets ou apostrophes, hors commentaires et noms de fonctions.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const literals = [...code.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]);
    const hits = literals.filter((l) => /unipile/i.test(l) && !/^(\.\.?\/)|\.ts$|unipile-webhook|unipile-search|unipile-accounts|unipile_conversations|UNIPILE_V2_API_KEY|\[unipile\]/i.test(l));
    assert.deepEqual(hits, [], `${rel} : ${hits.join(' | ')}`);
  }
  const pedigree = read(`${FN}/resolve-pedigree-directory/resolver.ts`) + read(`${FN}/resolve-pedigree-directory/index.ts`);
  assert.doesNotMatch(pedigree, /No Unipile account/);
  const categorize = read(`${FN}/auto-categorize-chats/index.ts`);
  assert.doesNotMatch(categorize, /No Unipile credentials|Missing UNIPILE credentials/);
  // La phrase d'erreur de la fonction n'est jamais celle d'une exception étrangère.
  assert.match(categorize, /isUnipileError\(error\) \? error\.message : 'Une erreur est survenue\. Veuillez réessayer\.'/);
});

test('S6B-5 : le compte de résolution des écoles et entreprises est lu au format courant, refusé sinon', () => {
  const resolver = read(`${FN}/resolve-pedigree-directory/resolver.ts`);
  assert.match(resolver, /if \(!isV2AccountId\(cfgAccountId\)\) return \{ ok: false, message: RESOLVER_ACCOUNT_OUTDATED_MESSAGE \}/);
  // Même espace d'identifiants que les recherches Recruiter et que les identifiants déjà stockés : jamais la liste classique.
  assert.match(resolver, /licence: 'recruiter', source: 'SEARCH', type, keywords: canonical/);
  assert.doesNotMatch(resolver, /licence: 'classic'/);
  assert.match(resolver, /toKonektSearchParameters\(page\.items\)/);
  assert.match(resolver, /'not_found',[\s\S]*'provider_limit'/, 'compte inconnu et quota arrêtent la série');
  const index = read(`${FN}/resolve-pedigree-directory/index.ts`);
  assert.match(index, /pickResolverAccount\(/);
  assert.ok(index.indexOf('await probeResolverAccount(') > index.indexOf('pickResolverAccount(')
    && index.indexOf('await probeResolverAccount(') < index.indexOf("from('pedigree_school_directory')"), 'contrôle du compte avant toute écriture');
  assert.match(index, /resolverAbortMessage\(aborted\.kind\)/, 'message d\'arrêt selon la nature réelle de l\'échec');
  assert.doesNotMatch(index, /userSafeMessage\('account_degraded'\)/);
  assert.doesNotMatch(index, /async function resolveOne|fetchWithTimeout/);
});

test('S6B-4 : generate-search-filters ne rend jamais le texte brut d\'une erreur du modèle ou du réseau', () => {
  const src = read(`${FN}/generate-search-filters/index.ts`);
  assert.doesNotMatch(src, /Erreur IA : \$\{/);
  assert.match(src, /error: ANALYSIS_UNAVAILABLE_MESSAGE, fallback: true/);
});

test('S6B : l\'export, la purge et l\'effacement RGPD n\'ont aucun appel au prestataire et les fonctions du lot gardent leur section de configuration', () => {
  const toml = read('supabase/config.toml');
  for (const name of ['generate-outreach-message', 'auto-analyze-message', 'auto-categorize-chats', 'resolve-pedigree-directory', 'generate-search-filters', 'rgpd-purge', 'rgpd-erase-contact', 'export-org-data']) {
    assert.match(toml, new RegExp(`\\[functions\\.${name}\\]`), name);
  }
  for (const rel of [`${FN}/rgpd-purge/index.ts`, `${FN}/rgpd-erase-contact/index.ts`, `${FN}/export-org-data/index.ts`]) {
    assert.doesNotMatch(read(rel), /_shared\/unipile|unipileFetch|listMessages|getChat\(/, rel);
  }
  assert.ok(existsSync(join(ROOT, `${FN}/resolve-pedigree-directory/resolver.test.ts`)));
});

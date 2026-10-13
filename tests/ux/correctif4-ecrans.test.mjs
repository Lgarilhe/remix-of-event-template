/**
 * Correctif 4 (plan du lot 5), écrans des envois manuels : messagerie
 * (useMessagesInbox), fil de la fiche (CardMessageThread) et fenêtre de
 * message (OutreachMessageModal).
 *
 * unipile-search send_message refuse l'envoi à un candidat effacé (403,
 * CANDIDATE_ERASED) et quand le registre d'effacement est illisible (503,
 * GDPR_UNVERIFIED), avec une phrase française dans `error`. Avant ce
 * correctif, les trois écrans jetaient cette phrase et affichaient un échec
 * générique qui invitait à réessayer. Ils montrent maintenant la phrase du
 * serveur, sans nouvel essai, texte saisi gardé, état d'envoi relâché.
 *
 *   1. invokeUnipile rend `error` et `error_code` d'un refus lu dans la
 *      réponse en erreur (vérification : déjà vrai avant ce correctif).
 *   2. Aucun des réécrivains de messages (humanizeUnipileError,
 *      humanizeError) ne touche ces deux phrases (vérification).
 *   3. Les trois écrans lisent ces deux codes avant leur échec générique,
 *      montrent la phrase du serveur, puis sortent sans relancer l'envoi ni
 *      vider le champ. Trois branchements identiques plutôt qu'une aide
 *      partagée : tests/c1/inbox-loading-performance.test.mjs remplace
 *      '@/lib/invokeUnipile' par un module qui n'exporte qu'invokeUnipile.
 *
 * Seuls les tests du point 3 (un par écran) prouvent la correction : sur le
 * code d'origine, ils échouent et 1 et 2 passent. Exception assumée à la règle
 * « tout nouveau test échoue sans la correction » : 1 et 2 gardent les
 * préconditions dont elle dépend. Si invokeUnipile cessait de rendre
 * `error_code` d'une réponse 403 ou 503, ou si un réécrivain changeait ces
 * phrases, la correction tomberait sans bruit : la spec e2e ne passe pas par
 * ce chemin (son faux prestataire répond en 200).
 *
 * Le parcours à l'écran (messagerie et fiche) est joué par
 * e2e/flows/inbox-loading.spec.ts (« candidat effacé »).
 *
 * Lancer : node --test tests/ux/correctif4-ecrans.test.mjs
 * UX_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD) : c'est
 * ainsi qu'on vérifie que ces tests échouent sur le code d'origine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = process.env.UX_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Le code sans ses commentaires : un commentaire peut nommer ce que le code fait.
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Phrases du serveur, relues dans la fonction : le test suit leur texte.
// Les deux constantes vivent dans send.ts depuis la bascule v2 (index.ts n'est plus que le routeur).
const SEARCH = read('supabase/functions/unipile-search/send.ts');
function serverPhrase(name) {
  const match = SEARCH.match(new RegExp(`const ${name} =\\s*"([^"]+)"`));
  assert.ok(match, `${name} introuvable dans unipile-search`);
  return match[1];
}
const ERASED = serverPhrase('SEND_ERASED_MESSAGE');
const UNVERIFIED = serverPhrase('SEND_GDPR_UNVERIFIED_MESSAGE');

// invokeUnipile réel, transport et organisation remplacés.
const stubs = {
  '@/integrations/supabase/client': 'export const supabase = { functions: { invoke: (name, options) => globalThis.correctif4Invoke(name, options) } };',
  '@/lib/orgContext': "export const getActiveOrganizationId = async () => 'org-a'; export const clearOrgIdCache = () => {};",
};
const { outputFiles } = await build({
  entryPoints: [join(ROOT, 'src/lib/invokeUnipile.ts')],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'correctif4-stubs', setup(builder) {
    builder.onResolve({ filter: /.*/ }, ({ path }) => path in stubs ? { path, namespace: 'stub' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: stubs[path], loader: 'js' }));
  } }],
});
const unipile = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

// Réponse en erreur telle que supabase-js la rend : erreur portant la réponse dans `context`.
function refusedBy(status, body) {
  globalThis.correctif4Invoke = async () => ({
    data: null,
    error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    }),
  });
}

test('Précondition, vraie avant ce correctif : invokeUnipile rend la phrase et le code du refus lus dans la réponse en erreur', async () => {
  for (const [status, errorCode, phrase] of [[403, 'CANDIDATE_ERASED', ERASED], [503, 'GDPR_UNVERIFIED', UNVERIFIED]]) {
    refusedBy(status, { success: false, error: phrase, error_code: errorCode });
    const { data, httpStatus } = await unipile.invokeUnipile({ body: { action: 'send_message', chat_id: 'chat-0', text: 'Bonjour' } });
    assert.equal(httpStatus, status);
    assert.equal(data.success, false);
    assert.equal(data.error_code, errorCode);
    assert.equal(data.error, phrase);
  }
});

test('Précondition, vraie avant ce correctif : aucun réécrivain de messages ne touche les deux phrases du serveur', () => {
  for (const rel of ['src/lib/invokeUnipile.ts', 'src/lib/invokeEdgeFunction.ts']) {
    const keywords = [...code(read(rel)).matchAll(/lower\.includes\('([^']+)'\)/g)].map(m => m[1]);
    assert.ok(keywords.length >= 8, `${rel} : mots déclencheurs introuvables`);
    for (const phrase of [ERASED, UNVERIFIED]) {
      const lower = phrase.toLowerCase();
      const hit = keywords.filter(word => lower.includes(word));
      assert.deepEqual(hit, [], `${rel} réécrirait « ${phrase} »`);
    }
  }
  for (const phrase of [ERASED, UNVERIFIED]) assert.doesNotMatch(phrase, /\d/, `« ${phrase} » ne doit contenir aucun nombre`);
});

const SCREENS = [
  { rel: 'src/hooks/useMessagesInbox.ts', toast: /^\s*toast\.error\(refusal\);/, release: /setSending\(false\)/, clear: /setNewMessage\(''\)/ },
  { rel: 'src/components/outreach/result-card/CardMessageThread.tsx', toast: /^\s*if \(mounted\.current\) toast\.error\(refusal\);/, release: /setIsSending\(false\)/, clear: /setReplyText\(''\)/ },
  { rel: 'src/components/outreach/OutreachMessageModal.tsx', toast: /^\s*toast\.error\(refusal\);/, release: /setSending\(false\)/, clear: /setMessageSent\(true\)/ },
];

for (const screen of SCREENS) {
  test(`${screen.rel} montre la phrase du serveur pour CANDIDATE_ERASED et GDPR_UNVERIFIED, sans nouvel essai`, () => {
    const src = code(read(screen.rel));
    const sends = [...src.matchAll(/action: 'send_message'/g)];
    assert.equal(sends.length, 1, 'un seul envoi manuel attendu dans cet écran');
    const start = sends[0].index;
    const end = src.indexOf('finally {', start);
    assert.ok(end > start, 'bloc finally de l’envoi introuvable');
    const body = src.slice(start, end);
    const branch = body.match(/if \(!data\??\.success\) \{\s*const refusal = data\??\.error_code === 'CANDIDATE_ERASED' \|\| data\??\.error_code === 'GDPR_UNVERIFIED' \? data\.error : undefined;\s*if \(refusal\) \{([\s\S]*?)\}\s*throw new Error\(/);
    assert.ok(branch, 'les deux codes doivent être lus avant l’échec générique, phrase du serveur gardée');
    // La branche montre la phrase et sort : ni nouvel appel, ni champ vidé, ni succès.
    assert.match(branch[1], screen.toast);
    assert.match(branch[1], /return;\s*$/);
    assert.doesNotMatch(branch[1], /invokeUnipile|setNewMessage|setReplyText|setMessage\(|setMessageSent|toast\.success/);
    // Le refus est lu avant tout effet d'un envoi réussi (champ vidé, message marqué envoyé).
    assert.ok(body.indexOf('const refusal =') < body.search(screen.clear), 'refus lu avant l’effet d’un succès');
    // Le bloc finally qui suit relâche l'état d'envoi, même après le return.
    assert.match(src.slice(end, end + 200), screen.release);
  });
}

/**
 * Lot 5d-1 : aperçu réel par preview_values, rendu côté navigateur.
 *
 * Invariants épinglés :
 *   - renderTemplatePreview (src/lib/templatePreview.ts) donne, pour chaque cas
 *     du jeu commun tests/fixtures/template-render-cases.json, le texte et les
 *     variables retirées attendus ; le même fichier est joué sur
 *     interpolateAndStrip, le rendu du moteur, par
 *     supabase/functions/_shared/sequence-preview-values.test.ts (Deno) ;
 *   - module pur, sans import ;
 *   - l'action preview_values de draft-sequence est gratuite et n'écrit rien :
 *     aucune écriture en base, aucun débit de crédits, aucun appel sortant ;
 *     inscriptions lues avec le jeton de l'appelant ; textes visibles sans nom
 *     de fournisseur ni tiret long. Depuis le lot 5e, la même fonction porte
 *     aussi prepare (gratuite) et draft (payante), dans compose.ts : index.ts
 *     ne fait que les aiguiller ;
 *   - relecture adverse (5d-1) : seules les variables demandées (`keys`) sont
 *     rendues, jamais les variables personnelles d'un autre membre ; codes
 *     d'erreur dans `error_code` (invokeEdgeFunction) ; note d'invitation
 *     coupée à 300 caractères comme le moteur (invite_note_cases du jeu commun) ;
 *     templateKeys donne les variables d'une séquence.
 *
 * Sans navigateur ni base. Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const RENDER = 'src/lib/templatePreview.ts';
const FUNCTION = 'supabase/functions/draft-sequence/index.ts';
const COMPOSE = 'supabase/functions/draft-sequence/compose.ts';
const SHARED = 'supabase/functions/_shared/sequence-preview-values.ts';

/** Module TypeScript pur chargé en mémoire (patron de barre-lot56-coquille). */
const loadPure = async (rel) => {
  const { code } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

const { cases } = JSON.parse(read('tests/fixtures/template-render-cases.json'));

test('5D1-R1 renderTemplatePreview : texte attendu et variables retirées du jeu de cas commun', async () => {
  const { renderTemplatePreview } = await loadPure(RENDER);
  assert.ok(cases.length >= 10, 'jeu de cas chargé');
  for (const c of cases) {
    const rendered = renderTemplatePreview(c.text, c.values);
    assert.equal(rendered.text, c.expected, c.name);
    if (c.missing) assert.deepEqual(rendered.missing, c.missing, `${c.name} (variables retirées)`);
  }
});

test('5D1-R2 le jeu de cas couvre repli, variable vide, alias city / ville, prénom fiable, titre « X chez Y »', () => {
  const texts = cases.map((c) => `${c.name} ${c.text}`).join('\n');
  assert.match(texts, /fallback:|default:/, 'repli');
  assert.ok(cases.some((c) => Object.values(c.values).some((v) => typeof v === 'string' && !v.trim())), 'variable vide');
  assert.ok(cases.some((c) => /\{\{city\}\}/.test(c.text) && c.values.city === 'Lyon' && c.custom_variables?.some((v) => v.key === 'ville')), 'alias city / ville');
  assert.ok(cases.some((c) => c.enrollment?.profile_name?.startsWith('🚀') && c.missing?.includes('prenom')), 'prénom non fiable');
  assert.ok(cases.some((c) => / chez /.test(c.enrollment?.profile_headline ?? '') && c.values.entreprise_actuelle), 'titre « X chez Y »');
});

test('5D1-R3 renderTemplatePreview : valeurs absentes, nulles ou vides retirées, texte vide accepté', async () => {
  const { renderTemplatePreview } = await loadPure(RENDER);
  assert.deepEqual(renderTemplatePreview('Bonjour {{prenom}}, à bientôt.', { prenom: null }), { text: 'Bonjour, à bientôt.', missing: ['prenom'] });
  assert.deepEqual(renderTemplatePreview('Bonjour {{prenom}}, à bientôt.', { prenom: 'Julie' }), { text: 'Bonjour Julie, à bientôt.', missing: [] });
  assert.deepEqual(renderTemplatePreview('', { prenom: 'Julie' }), { text: '', missing: [] });
  assert.deepEqual(renderTemplatePreview('{{a}} {{A}} {{ a | upper }}', {}), { text: ' ', missing: ['a'] });
});

test('5D1-R4 module de rendu pur : aucun import', () => {
  assert.doesNotMatch(read(RENDER), /^\s*import\s/m);
});

test('5D1-R5 draft-sequence, preview_values : gratuite, sans écriture ni appel sortant, inscriptions lues sous la RLS de l’appelant', () => {
  const fn = read(FUNCTION);
  const shared = read(SHARED);
  // Lot 5e : prepare et draft vivent dans compose.ts, index.ts ne fait que les aiguiller.
  assert.match(fn, /^import \{ handleDraft, handlePrepare \} from "\.\/compose\.ts";$/m);
  assert.match(fn, /if \(action === "prepare"\) return await handlePrepare\(body,/);
  assert.match(fn, /if \(action === "draft"\) return await handleDraft\(body,/);
  // Dans compose.ts, seule l'action draft débite ; prepare n'appelle ni le modèle ni les crédits.
  const compose = read(COMPOSE);
  const prepare = compose.slice(compose.indexOf('async function prepare('), compose.indexOf('async function draft('));
  assert.ok(prepare.length > 0, 'prepare avant draft');
  assert.match(compose, /export const handlePrepare = guarded\("prepare", prepare\);/);
  assert.doesNotMatch(prepare, /assertCredits\(|settleCredits\(|callModel\(|callClaudeCompat\(|\.(insert|update|upsert|delete)\(|\.rpc\(/, 'prepare : gratuite et sans écriture');
  for (const [name, src] of [[FUNCTION, fn], [SHARED, shared]]) {
    assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(|\.rpc\(/, `${name} n'écrit rien`);
    assert.doesNotMatch(src, /settleCredits|settle-credits|credit-guard|ai_credit/, `${name} ne débite rien`);
    assert.doesNotMatch(src, /\bfetch(WithTimeout)?\(/, `${name} n'appelle aucun service extérieur`);
  }
  assert.match(fn, /requireAuth\(req, corsHeaders\)/);
  assert.match(fn, /verifyOrgMembership\(admin, userId, organizationId\)/);
  assert.match(fn, /buildCorsHeaders\(req\)/);
  // Inscriptions : client au jeton de l'appelant (clé publique + Authorization), jamais la clé de service.
  assert.match(fn, /createClient\(SUPABASE_URL, SUPABASE_ANON_KEY, \{\s*global: \{ headers: \{ Authorization: req\.headers\.get\("Authorization"\)/);
  assert.match(fn, /userClient\s*\.from\("sequence_enrollments"\)/);
  assert.doesNotMatch(fn, /admin\s*\.from\("sequence_enrollments"\)/);
  // Contexte construit comme le moteur (relevé en plus, sans effet sur le contexte).
  assert.match(shared, /buildSequenceContext\(client, \{ enrollment, senderUserId: createdBy \|\| null, trace \}\)/);
});

test('5D1-R7 note d’invitation : inviteNoteText donne le texte du moteur (smartTruncate à 300) du jeu de cas commun', async () => {
  const { inviteNoteText, smartTruncate, INVITE_NOTE_MAX } = await loadPure(RENDER);
  const { invite_note_cases: inviteCases } = JSON.parse(read('tests/fixtures/template-render-cases.json'));
  assert.equal(INVITE_NOTE_MAX, 300);
  assert.ok(inviteCases.length >= 5, 'jeu de cas chargé');
  for (const c of inviteCases) {
    assert.equal(inviteNoteText(c.text), c.expected, c.name);
    assert.equal(smartTruncate(c.text, 300), c.expected, `${c.name} (copie de smartTruncate)`);
  }
  assert.equal(inviteNoteText(''), '', 'invitation sans note : rien');
  // Copie fidèle : même corps que la règle du moteur.
  const engine = read('supabase/functions/_shared/sequence-send-rules.ts');
  const body = (src) => src.slice(src.indexOf('export function smartTruncate'), src.indexOf('\n}\n', src.indexOf('export function smartTruncate')));
  assert.equal(body(read(RENDER)).replace(/\s+/g, ' '), body(engine).replace(/\s+/g, ' '), 'smartTruncate copiée telle quelle');
});

test('5D1-R8 templateKeys : variables d’une séquence comme le moteur les lit, sans doublon, formes impossibles écartées', async () => {
  const { templateKeys } = await loadPure(RENDER);
  assert.deepEqual(
    templateKeys(['Bonjour {{ Prenom | fallback:"à vous" }}, {{prenom}} {{city}}', null, '{{ma_signature}} {{prénom}} {{ }} {{tarif_négocié}}', undefined, '{{CITY}}']),
    ['prenom', 'city', 'ma_signature'],
  );
  assert.deepEqual(templateKeys([]), []);
});

test('5D1-R9 draft-sequence : variables demandées seules, variables d’un autre membre annoncées, codes dans error_code', () => {
  const fn = read(FUNCTION);
  const shared = read(SHARED);
  // Convention de invokeEdgeFunction : error_code (recopié dans error.code), jamais « code: ».
  assert.doesNotMatch(fn, /[{,]\s*code:/, 'aucune réponse avec « code »');
  for (const code of ['PREVIEW_FORBIDDEN', 'MISSION_NOT_FOUND', 'SEQUENCE_NOT_FOUND', 'PREVIEW_ACCOUNT_OF_OTHER_MEMBER', 'PREVIEW_FAILED']) {
    assert.match(fn, new RegExp(`error_code: "${code}"`), code);
  }
  assert.match(fn, /error_code: parsed\.code/);
  // Variables demandées par le navigateur, appelant passé pour ne jamais donner les variables d'un autre.
  assert.match(fn, /callerUserId: userId,/);
  assert.match(fn, /keys,/);
  assert.match(fn, /loadDrawnSenderSequences\(admin, organizationId,/);
  assert.match(shared, /const otherSender = !opts\.senderDrawnAtSend && !!trace\.senderUserId && trace\.senderUserId !== opts\.callerUserId;/);
  assert.match(shared, /for \(const key of opts\.keys\)/, 'seules les clés demandées');
  assert.match(shared, /if \(trace\.failedReads\.length > 0\) \{/, 'lecture en échec : pas d’aperçu');
  assert.match(shared, /return excluded\('preview_failed'\);/);
});

test('5D1-R6 textes visibles de draft-sequence : français, sans nom de fournisseur ni tiret long', () => {
  for (const rel of [FUNCTION, SHARED]) {
    const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    const strings = [...src.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]);
    for (const s of strings) {
      assert.doesNotMatch(s, /Unipile|Apollo|People Data Labs|\bPDL\b|Anthropic|Claude|Notion|—/, `${rel} : « ${s} »`);
    }
  }
});

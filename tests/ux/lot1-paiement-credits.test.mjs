/**
 * Lot 1 des Paramètres — onglets Crédits IA et Abonnement.
 *
 * Invariants épinglés :
 *   - R1/D6 : le modèle IA par défaut n'affiche plus de faux succès (écriture
 *     attendue, réservée au propriétaire) ;
 *   - R8/D10 : l'historique des crédits n'affiche ni identifiant de modèle ni
 *     code interne, et le signe des ajouts est juste ;
 *   - R10/D12 : le retour de paiement porte kind=pack|subscription, un seul
 *     lecteur par kind ; les échecs du paiement s'affichent en français, sans
 *     nom de fournisseur ;
 *   - R5c/R5d : une lecture ratée de l'abonnement ou des enrichissements ne se
 *     lit plus comme « Gratuit » ou « aucun enrichissement ».
 *
 * src/lib/checkoutReturn.ts et l'assainisseur de description de l'historique
 * sont transpilés en mémoire par esbuild (déjà présent via Vite) ; le reste est
 * vérifié par inspection de source, dans le style des autres tests de tests/ux.
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const importTs = async (source) => {
  const { code } = transformSync(source, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

/** Fichiers d'un dossier, récursivement, filtrés par extension. */
const walk = (dir, exts) => {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(rel);
  }
  return out;
};

const VENDORS = /claude|anthropic|unipile|apollo|coresignal|better ?contact|pdl|people data labs|stripe|resend|openai/i;

const credits = read('src/components/settings/AICreditsSettings.tsx');
const billing = read('src/components/settings/BillingSettings.tsx');
const modelPref = read('src/hooks/useModelPreference.ts');
const analytics = read('src/components/settings/EnrichmentAnalytics.tsx');
const permission = read('src/hooks/useEnrichmentPermission.ts');
const subState = read('src/hooks/useSubscriptionState.ts');
const checkoutFn = read('supabase/functions/create-checkout-session/index.ts');
const portalFn = read('supabase/functions/create-portal-session/index.ts');

const { readCheckoutReturn, withoutCheckoutReturn } = await importTs(read('src/lib/checkoutReturn.ts'));

// ---------------------------------------------------------------- R10 / D12
test('R10 — readCheckoutReturn : kind prime, repli sur l\'onglet, inconnu ignoré', () => {
  const cases = [
    ['tab=credits&checkout=success&kind=pack', { status: 'success', kind: 'pack' }],
    ['tab=billing&checkout=cancel&kind=subscription', { status: 'cancel', kind: 'subscription' }],
    ['tab=credits&checkout=success', { status: 'success', kind: 'pack' }],
    ['tab=billing&checkout=success', { status: 'success', kind: 'subscription' }],
    ['tab=credits&checkout=success&kind=subscription', { status: 'success', kind: 'subscription' }],
    ['tab=billing&checkout=cancel&kind=pack', { status: 'cancel', kind: 'pack' }],
    ['tab=credits&checkout=success&kind=autre', null],
    ['checkout=success', null],
    ['tab=general&checkout=cancel', null],
    ['checkout=ok&kind=pack', null],
    ['tab=credits', null],
    ['', null],
  ];
  for (const [query, expected] of cases) {
    assert.deepEqual(readCheckoutReturn(new URLSearchParams(query)), expected, query);
  }
});

test('R10 — withoutCheckoutReturn retire checkout et kind sans toucher l\'entrée', () => {
  const input = new URLSearchParams('tab=credits&checkout=success&kind=pack&x=1');
  const next = withoutCheckoutReturn(input);
  assert.equal(next.toString(), 'tab=credits&x=1');
  assert.equal(input.toString(), 'tab=credits&checkout=success&kind=pack&x=1');
});

test('R10 — le repli sur l\'onglet est daté', () => {
  const lib = read('src/lib/checkoutReturn.ts');
  assert.match(lib, /Repli ajouté le \d{4}-\d{2}-\d{2}/);
});

test('R10 — create-checkout-session pose kind sur les quatre URL de retour', () => {
  for (const url of [
    'tab=credits&checkout=success&kind=pack',
    'tab=credits&checkout=cancel&kind=pack',
    'tab=billing&checkout=success&kind=subscription',
    'tab=billing&checkout=cancel&kind=subscription',
  ]) {
    assert.ok(checkoutFn.includes(url), `URL absente : ${url}`);
  }
  assert.doesNotMatch(checkoutFn, /checkout=(success|cancel)(?!&kind=)/, 'une URL de retour sans kind');
  assert.doesNotMatch(portalFn, /checkout=/, 'le portail ne doit pas déclencher de lecteur de paiement');
});

test('R10 — un seul lecteur par kind, plus aucune lecture brute de ?checkout=', () => {
  assert.match(credits, /ret\.kind !== 'pack'/);
  assert.match(credits, /withoutCheckoutReturn\(/);
  assert.match(credits, /handledCheckoutRef/);
  assert.doesNotMatch(credits, /searchParams\.get\('checkout'\)/);
  assert.doesNotMatch(credits, /searchParams\.delete\(/, 'muter searchParams en place masquait le double toast');
  assert.match(billing, /ret\.kind !== 'subscription'/);
  assert.match(billing, /withoutCheckoutReturn\(/);

  const readers = [];
  for (const rel of walk('src', ['.ts', '.tsx'])) {
    if (rel === 'src/lib/checkoutReturn.ts') continue;
    const src = read(rel);
    assert.doesNotMatch(src, /get\(\s*['"]checkout['"]\s*\)/, `${rel} lit ?checkout= sans readCheckoutReturn`);
    if (/readCheckoutReturn\(/.test(src)) readers.push(rel);
  }
  assert.deepEqual(readers.sort(), [
    'src/components/settings/AICreditsSettings.tsx',
    'src/components/settings/BillingSettings.tsx',
  ]);
});

test('D12 — les échecs du paiement et du portail sont en français, sans fournisseur', () => {
  for (const [name, src] of [['create-checkout-session', checkoutFn], ['create-portal-session', portalFn]]) {
    assert.doesNotMatch(src, /error:\s*["'`][^"'`]*stripe/i, `${name} : nom de fournisseur dans un message`);
    assert.doesNotMatch(src, /error:\s*err instanceof Error \? err\.message/, `${name} : exception brute renvoyée`);
    assert.doesNotMatch(src, /error:\s*["'`]Failed to/, `${name} : message anglais renvoyé`);
  }
  assert.doesNotMatch(checkoutFn, /error:\s*["'`]Invalid plan_id/);
  assert.match(checkoutFn, /Impossible d'ouvrir le paiement pour le moment/);
  assert.match(portalFn, /Impossible d'ouvrir la gestion de l'abonnement pour le moment/);
});

// ---------------------------------------------------------------- R8 / D10
const historyBlock = credits.slice(credits.indexOf('Historique récent'), credits.indexOf('<EnrichmentAnalytics'));

test('R8 — l\'historique n\'affiche ni modèle ni code interne', () => {
  assert.ok(historyBlock.length > 0, 'bloc Historique récent introuvable');
  assert.doesNotMatch(historyBlock, /model_id|modelName|metadata[^\n]*model/);
  assert.doesNotMatch(credits, /tx\.model_id|tx\.metadata/);
  assert.doesNotMatch(historyBlock, /(\|\||\?\?)\s*tx\.action\b/, 'aucun repli sur le code brut de l\'action');
  assert.match(historyBlock, /HISTORY_EXTRA_LABELS\[tx\.action\]/);
  assert.match(historyBlock, /'Action IA'/);
  assert.match(historyBlock, /'Crédits ajoutés'/);
  assert.doesNotMatch(historyBlock, /\{tx\.description\}/, 'la description passe par historyDescription');
  assert.match(historyBlock, /historyDescription\(tx\.description\)/);
});

test('R8 — signe juste : un montant positif est un ajout', () => {
  assert.match(historyBlock, /amount > 0/);
  assert.match(historyBlock, /isCredit \? '\+' : '-'/);
  assert.match(historyBlock, /tx\.credits_used \|\| Math\.abs\(amount\)/);
});

test('D10 — une description technique devient un libellé neutre', async () => {
  const start = credits.indexOf('const TECHNICAL_DESCRIPTION');
  const end = credits.indexOf('\n};\n', start);
  assert.ok(start !== -1 && end !== -1, 'historyDescription introuvable');
  const { historyDescription } = await importTs(`${credits.slice(start, end + 3)}\nexport { historyDescription };`);
  for (const technical of ['generate-outreach-message', 'text-action', 'claude-sonnet-4-6', 'Action IA: rewrite', 'Action IA : resume']) {
    assert.equal(historyDescription(technical), 'Traitement IA', technical);
  }
  for (const readable of ['Base Konekt — aperçu', 'Contact enrichi (email) : https://www.linkedin.com/in/x', 'Titre de conversation']) {
    assert.equal(historyDescription(readable), readable, readable);
  }
  assert.equal(historyDescription(null), null);
  assert.equal(historyDescription('  '), null);
});

test('C16 — les descriptions internes connues deviennent des libellés français neutres', async () => {
  const start = credits.indexOf('const TECHNICAL_DESCRIPTION');
  const end = credits.indexOf('\n};\n', start);
  const { historyDescription } = await importTs(`${credits.slice(start, end + 3)}\nexport { historyDescription };`);
  // stripe-webhook : identifiant interne du pack
  assert.equal(historyDescription('Achat pack pack_400: +400 crédits'), 'Achat de 400 crédits');
  assert.equal(historyDescription('Achat pack pack_1500: +1500 crédits'), `Achat de ${(1500).toLocaleString('fr-FR')} crédits`);
  assert.equal(historyDescription('Achat pack pack_5000'), null, 'sans quantité, le libellé de la ligne suffit');
  // process-sequences et sequence-send-email : anglais et code d'étape
  assert.equal(historyDescription('Sequence AI (INMAIL INITIAL — smart_message)'), 'Message de séquence');
  assert.equal(historyDescription('Sequence email AI snippet (fallback)'), 'Message de séquence');
  // score-profile-job : seconde évaluation d'un profil limite
  assert.equal(historyDescription('score-profile-job (escalation borderline)'), 'Évaluation approfondie');
  assert.equal(historyDescription('scoring (escalation borderline)'), 'Évaluation approfondie');
  for (const raw of ['Achat pack pack_400: +400 crédits', 'Sequence AI (RELANCE 1 — smart_message)', 'Sequence email AI snippet (fallback)']) {
    const shown = historyDescription(raw) ?? '';
    assert.doesNotMatch(shown, /pack_\d|Sequence|snippet|fallback|smart_message|escalation/, `${raw} → ${shown}`);
  }
});

const catalogKeys = (src) => {
  const start = src.indexOf('export const ACTION_COSTS');
  const body = src.slice(start, src.indexOf('\n};', start));
  return [...body.matchAll(/^\s*([a-z0-9_]+):\s*\{\s*action:/gm)].map((m) => m[1]).sort();
};
const frontCatalog = read('src/types/aiCredits.ts');
const extraLabels = (() => {
  const start = credits.indexOf('const HISTORY_EXTRA_LABELS');
  const body = credits.slice(start, credits.indexOf('\n};', start));
  return Object.fromEntries([...body.matchAll(/^\s*([a-z0-9_]+):\s*'([^']+)'/gm)].map((m) => [m[1], m[2]]));
})();

test('R8 — catalogues front et serveur identiques', () => {
  const front = catalogKeys(frontCatalog);
  const server = catalogKeys(read('supabase/functions/_shared/ai-config.ts'));
  assert.ok(front.length >= 40, `catalogue front incomplet (${front.length})`);
  assert.deepEqual(front, server);
});

test('R8 — aucun libellé d\'action ne cite un fournisseur', () => {
  const start = frontCatalog.indexOf('export const ACTION_COSTS');
  const body = frontCatalog.slice(start, frontCatalog.indexOf('\n};', start));
  const labels = [...body.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(labels.length >= 40);
  for (const label of [...labels, ...Object.values(extraLabels)]) {
    assert.doesNotMatch(label, VENDORS, label);
  }
  assert.equal(extraLabels.detect_profile_fraud, 'Détection de fraude');
});

test('R8 — toute action réglée côté serveur a un libellé', () => {
  const known = new Set([...catalogKeys(frontCatalog), ...Object.keys(extraLabels), 'topup_purchase']);
  const patterns = [
    /aiAction:\s*["']([a-z0-9_]+)["']/g,
    /extractAIParams\([^,]+,\s*["']([a-z0-9_]+)["']/g,
    /settle\(svc,[^,]+,[^,]+,\s*"([a-z0-9_]+)"/g,
  ];
  const missing = [];
  for (const rel of walk('supabase/functions', ['.ts'])) {
    const src = read(rel);
    for (const re of patterns) {
      for (const m of src.matchAll(re)) if (!known.has(m[1])) missing.push(`${rel} : ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

// ---------------------------------------------------------------- R1 / D6
test('D6 — modèle par défaut : écriture attendue, propriétaire seul', () => {
  const card = credits.slice(credits.indexOf('{/* Default Model Selector */}'), credits.indexOf('{/* Packs de crédits'));
  assert.ok(card.length > 0, 'carte du modèle introuvable');
  assert.match(card, /disabled=\{!isOwner\}/);
  const iAwait = card.indexOf('await setDefaultModel(');
  const iSuccess = card.indexOf('toast.success(');
  assert.ok(iAwait !== -1 && iAwait < iSuccess, 'le succès doit suivre l\'écriture attendue');
  assert.match(card, /catch \(err\)[\s\S]*toast\.error\(/);
  assert.match(card, /Réglé par le propriétaire/);
});

test('D6 — useModelPreference passe par updateOrganization, sans état optimiste', () => {
  const fn = modelPref.slice(modelPref.indexOf('const setModelId'));
  assert.match(fn, /useCallback\(async/);
  assert.match(fn, /await updateOrganization\(orgId, \{ ai_model_default: id \}\)/);
  assert.ok(fn.indexOf('await updateOrganization(') < fn.indexOf('setModelIdState('), 'état modifié avant l\'écriture');
  assert.ok(fn.indexOf('await updateOrganization(') < fn.indexOf('localStorage.setItem('), 'copie locale écrite avant l\'écriture');
  assert.doesNotMatch(modelPref, /\.update\(/, 'plus d\'UPDATE direct');
  assert.doesNotMatch(modelPref, /as never|: any\b/);
});

test('C4 — une lecture ratée du modèle ne l\'efface pas et n\'affiche pas « Automatique »', () => {
  const effect = modelPref.slice(modelPref.indexOf('useEffect('), modelPref.indexOf('const setModelId'));
  assert.match(effect, /const \{ data, error \} = await/);
  const iError = effect.indexOf('if (error) {');
  const iReturn = effect.indexOf('return;', iError);
  assert.ok(iError !== -1 && iReturn !== -1, 'l\'erreur de lecture doit arrêter l\'hydratation');
  assert.ok(iReturn < effect.indexOf('setModelIdState('), 'état modifié malgré l\'échec');
  assert.ok(iReturn < effect.indexOf('localStorage.removeItem('), 'copie locale effacée malgré l\'échec');
  assert.match(effect.slice(iError, iReturn), /setLoadError\(true\)/);
  assert.match(modelPref, /return \{ modelId, setModelId, loadError, reload \};/);

  const card = credits.slice(credits.indexOf('{/* Default Model Selector */}'), credits.indexOf('{/* Packs de crédits'));
  assert.match(credits, /loadError: modelLoadError, reload: reloadModel \} = useModelPreference\(/);
  const iErr = card.indexOf('{modelLoadError ? (');
  assert.ok(iErr !== -1 && iErr < card.indexOf('<Select'), 'le sélecteur ne doit pas être monté en erreur');
  assert.match(card.slice(iErr, card.indexOf('<Select')), /onClick=\{reloadModel\}[\s\S]*Réessayer/);
});

// ---------------------------------------------------------------- R5c
test('R5c — une lecture ratée de l\'abonnement ne se lit pas « Gratuit »', () => {
  assert.match(billing, /\bisLoadingError\b[^}]*\brefetch\b[^}]*\} = useSubscriptionState\(\)/);
  const iErr = billing.indexOf('{isLoadingError ? (');
  const iRgpd = billing.indexOf('{/* RGPD Data Export */}');
  assert.ok(iErr !== -1 && iRgpd !== -1);
  for (const inside of ["state?.plan_name || 'Gratuit'", "'Choisir un plan'", "Gérer l'abonnement"]) {
    const i = billing.indexOf(inside);
    assert.ok(iErr < i && i < iRgpd, `${inside} hors de la condition d'erreur`);
  }
  assert.match(billing.slice(iErr, iRgpd), /<\/>\s*\)\}\s*$/, 'la carte RGPD reste visible dans les deux cas');
  const errorZone = billing.slice(iErr, billing.indexOf(') : (', iErr));
  assert.match(errorZone, /<ErrorBox/);
  assert.match(errorZone, /Impossible de charger votre abonnement/);
});

test('C17 — une relecture ratée ne remplace pas un abonnement déjà affiché', () => {
  assert.doesNotMatch(billing, /\{error \? \(/, 'l\'erreur ne s\'affiche que sans données');
  // Première lecture en échec seulement : un état null légitime (organisation
  // sans ligne d'abonnement) garde son repli après une relecture ratée.
  assert.match(billing, /\{isLoadingError \? \(/);
  assert.match(subState, /isLoadingError: query\.isLoadingError,/);
});

test('C17 — enrichissements : une relecture ratée garde les statistiques affichées', () => {
  assert.match(analytics, /isLoadingError: rowsError/);
  assert.match(analytics, /isLoadingError: recentError/);
  assert.match(permission, /isLoadingError: orgUsageError/);
});

// ---------------------------------------------------------------- R5d
test('R5d — les lectures des enrichissements ne s\'avalent plus', () => {
  assert.doesNotMatch(analytics, /const \{ data \} = await supabase\s*\.from\('candidate_enrichments'\)/);
  assert.equal((analytics.match(/if \(error\) throw error;/g) || []).length, 2);
  assert.match(analytics, /isLoading \|\| recentLoading \|\| usageLoading/, 'le chargeur attend le forfait');
  const iErr = analytics.indexOf('rowsError || recentError || isUsageError');
  assert.ok(iErr !== -1);
  assert.ok(iErr < analytics.indexOf('Aucune unité incluse'));
  assert.ok(iErr < analytics.indexOf('Aucun enrichissement de contact terminé'));
  assert.match(analytics.slice(iErr, analytics.indexOf('Aucune unité incluse')), /<ErrorBox/);
});

test('R5d — useEnrichmentPermission signale l\'échec du forfait', () => {
  const rpc = permission.slice(permission.indexOf("rpc('get_org_contact_usage'"), permission.indexOf('enabled:', permission.indexOf("rpc('get_org_contact_usage'")));
  assert.match(rpc, /throw error/);
  assert.doesNotMatch(rpc, /return null;/);
  assert.match(permission.slice(permission.lastIndexOf('return {')), /isUsageError/);
});

// ---------------------------------------------------------------- Marque
test('Textes visibles sans nom de fournisseur', () => {
  const visible = (src) => [
    ...[...src.matchAll(/toast\.(?:success|error|info|warning)\(\s*(['"`])((?:(?!\1).)*)\1/g)].map((m) => m[2]),
    ...[...src.matchAll(/title="([^"]*)"/g)].map((m) => m[1]),
    ...[...src.matchAll(/>\s*([^<>{}\n]*[A-Za-zÀ-ÿ][^<>{}\n]*)\s*</g)].map((m) => m[1]),
  ];
  for (const [name, src] of [['AICreditsSettings', credits], ['BillingSettings', billing], ['EnrichmentAnalytics', analytics]]) {
    for (const text of visible(src)) assert.doesNotMatch(text, VENDORS, `${name} : « ${text} »`);
  }
});

// ---------------------------------------------------------------- C18
test('C18 — retour d\'un achat de pack : l\'historique est relu avec le solde, deux fois', () => {
  const effect = credits.slice(credits.indexOf("if (ret.status === 'success')"), credits.indexOf("toast.info('Achat annulé.')"));
  assert.ok(effect.length > 0, 'branche de succès introuvable');
  const refresh = effect.slice(effect.indexOf('const refreshAfterPack'), effect.indexOf('};', effect.indexOf('const refreshAfterPack')));
  assert.match(refresh, /refetch\(\)/, 'le solde');
  assert.match(refresh, /invalidateQueries\(\{ queryKey: \['ai-credit-history'\] \}\)/, 'l\'historique');
  assert.match(effect, /refreshAfterPack\(\);/, 'relecture immédiate');
  assert.match(effect, /window\.setTimeout\(refreshAfterPack, PACK_REFRESH_DELAY_MS\)/, 'relecture différée');
  assert.match(credits, /\}, \[searchParams, setSearchParams, refetch, queryClient\]\);/);
});

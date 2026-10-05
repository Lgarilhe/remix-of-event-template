/**
 * Refonte mission, écran Sourcing de la nouvelle page (disposition « mission-v3 ») :
 * - rangement en trois groupes et textes des lignes
 *   (src/components/missions/v3/sourcing/sourcingGroups.ts) ;
 * - interrupteur éteint : l'ancienne page et /sourcing/:id ne passent pas la
 *   disposition, et chaque prop nouvelle a le rendu actuel pour défaut ;
 * - écritures d'étape seulement par useJobCandidateStatus (candidateStage.ts),
 *   textes sans tiret long, sans emoji ni nom de prestataire ;
 * - design simplifié (04/10/2026) : un seul bouton plein, puces d'état sans cadre,
 *   tableau sans carte ni tiret, colonnes par défaut réduites, choix de colonnes gardé.
 *
 * Module empaqueté par esbuild (alias @/ résolus par tsconfig.app.json), client
 * Supabase remplacé par une doublure.
 * Lancer : node --test tests/ux/lot12-sourcing.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
// Code sans commentaires (les commentaires peuvent citer d'anciens textes).
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'stub' }));
    b.onResolve({ filter: /^(sonner|@tanstack\/react-query)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: args.path === 'client'
        ? 'export const supabase = { rpc: () => { throw new Error("aucun appel attendu"); } };'
        : args.path === 'sonner'
          ? 'export const toast = {};'
          : 'export const useQueryClient = () => null;',
      loader: 'js',
    }));
  },
};

const load = async (rel) => {
  const { outputFiles } = await build({
    entryPoints: [join(ROOT_PATH, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
    plugins: [stubs],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
};

const G = await load('src/components/missions/v3/sourcing/sourcingGroups.ts');

// Le tableau des résultats et le rendu React dans un seul paquet (une seule copie de React).
const { outputFiles: tableFiles } = await build({
  stdin: {
    contents: [
      "export { CompactResultsTable } from './src/components/outreach/search/CompactResultsTable';",
      "export { createElement } from 'react';",
      "export { renderToStaticMarkup } from 'react-dom/server.browser';",
    ].join('\n'),
    resolveDir: ROOT_PATH,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
  plugins: [stubs],
  define: { 'process.env.NODE_ENV': '"production"' },
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(tableFiles[0].text).toString('base64')}`);

// ---------------------------------------------------------------- groupes

test('S-1 : étape déduite de l’ancien couple, comme candidate_stage_from_legacy', () => {
  assert.equal(G.legacyStageOf(null, null), 'to_sort');
  assert.equal(G.legacyStageOf('discovered', null), 'to_sort');
  assert.equal(G.legacyStageOf('scored', null), 'to_sort');
  assert.equal(G.legacyStageOf('shortlisted', null), 'retained');
  assert.equal(G.legacyStageOf('messaged', null), 'contacted');
  assert.equal(G.legacyStageOf('replied', null), 'replied');
  assert.equal(G.legacyStageOf('shortlisted', 'ITW en cours'), 'interviewing');
  assert.equal(G.legacyStageOf('replied', 'b3a1c2d4-0000-4000-8000-000000000001'), 'interviewing');
  assert.equal(G.legacyStageOf('messaged', 'Gagné'), 'hired');
  assert.equal(G.legacyStageOf('dismissed', 'ITW en cours'), 'rejected');
  assert.equal(G.legacyStageOf('shortlisted', 'Perdu'), 'rejected');
});

test('S-2 : trois groupes, À trier, Retenus, Écartés', () => {
  assert.deepEqual([...G.SOURCING_GROUPS], ['to_sort', 'retained', 'rejected']);
  assert.deepEqual({ ...G.SOURCING_GROUP_LABEL }, { to_sort: 'À trier', retained: 'Retenus', rejected: 'Écartés' });
  assert.equal(G.sourcingGroupOf(undefined), 'to_sort');
  assert.equal(G.sourcingGroupOf({ status: 'scored', score: 70 }), 'to_sort');
  for (const status of ['shortlisted', 'messaged', 'replied']) assert.equal(G.sourcingGroupOf({ status }), 'retained');
  assert.equal(G.sourcingGroupOf({ status: 'dismissed' }), 'rejected');
  // Étape des retenus : un libellé, jamais la valeur brute.
  assert.equal(G.retainedStageLabel({ status: 'shortlisted' }), 'Retenu');
  assert.equal(G.retainedStageLabel({ status: 'messaged' }), 'Contacté');
  assert.equal(G.retainedStageLabel({ status: 'replied' }), 'A répondu');
  assert.equal(G.retainedStageLabel({ status: 'replied', pipeline_stage: 'Offre' }), 'En entretien');
});

test('S-3 : note absente = cellule vide, jamais un zéro', () => {
  assert.equal(G.noteOf(undefined, undefined), null);
  assert.equal(G.noteOf(undefined, { score: null }), null);
  assert.equal(G.noteOf({ match_score: 68.6 }, { score: 40 }), 69);
  assert.equal(G.noteOf(undefined, { score: 0 }), 0);
});

test('S-4 : raison d’une ligne', () => {
  assert.deepEqual(G.reasonOf(undefined, undefined), { text: 'Pas encore noté', tone: 'muted' });
  assert.deepEqual(G.reasonOf(undefined, undefined, { scoring: true }), { text: 'Notation en cours', tone: 'muted' });
  assert.deepEqual(
    G.reasonOf({ match_score: 51, recommendation: 'skip', summary: 'Trop junior pour le poste' }, undefined),
    { text: "L'IA suggère d'écarter : trop junior pour le poste", tone: 'ai' },
  );
  assert.deepEqual(
    G.reasonOf({ match_score: 51, recommendation: 'skip', summary: '', missing_skills: ['IFRS', 'LBO'] }, undefined),
    { text: "L'IA suggère d'écarter : IFRS, LBO", tone: 'ai' },
  );
  assert.deepEqual(G.reasonOf(undefined, { score: 69, recommendation: 'go', scoring_details: { summary: 'IFRS, équipe 10+' } }), {
    text: 'IFRS, équipe 10+',
    tone: 'default',
  });
  assert.equal(G.rejectedReasonOf({ skip_reason: 'Trop junior' }), "Selon l'IA : trop junior");
  assert.equal(G.rejectedReasonOf({ skip_reason: null }), '');
  assert.equal(G.isAiSkip({ match_score: 40, recommendation: 'skip' }, undefined), true);
  assert.equal(G.isAiSkip(undefined, { recommendation: 'skip', score: null }), false, 'non noté : jamais une suggestion');
});

test('S-5 : À trier, notés d’abord par note décroissante, puis non notés dans l’ordre reçu', () => {
  const rows = [
    { id: 'a', note: null }, { id: 'b', note: 58 }, { id: 'c', note: null }, { id: 'd', note: 69 }, { id: 'e', note: 58 },
  ];
  assert.deepEqual(G.sortToSort(rows, (r) => r.note).map((r) => r.id), ['d', 'b', 'e', 'a', 'c']);
});

test('S-6 : noms joints, libellé de notation et coût annoncé à côté (plancher de 2 crédits)', () => {
  assert.equal(G.joinNames(['Aurélie Vincent']), 'Aurélie Vincent');
  assert.equal(G.joinNames(['A', 'B']), 'A et B');
  assert.equal(G.joinNames(['A', 'B', 'C']), 'A, B et C');
  assert.equal(G.joinNames(['A', 'B', 'C', 'D', 'E']), 'A, B, C et 2 autres');
  // Le bouton dit l'action ; le coût s'écrit en texte discret à côté, plus entre parenthèses.
  assert.equal(G.scoreButtonText(20, 21), 'Noter les 20 premiers');
  assert.equal(G.scoreCostText(20, 2), 'au moins 40 crédits');
  assert.equal(G.scoreButtonText(12, 12), 'Noter les 12 profils non notés');
  assert.equal(G.scoreCostText(12, 2), 'au moins 24 crédits');
  assert.equal(G.scoreButtonText(1, 1), 'Noter le profil non noté');
  assert.equal(G.scoreCostText(1, 2), 'au moins 2 crédits');
  assert.equal(G.scoreCostText(600, 2).replace(/\s/g, ' '), 'au moins 1 200 crédits');
  assert.match(read('src/types/aiCredits.ts'), /scoring: \{ action: "scoring", label: "[^"]+", floor: 2,/);
});

test('S-6b : profils des groupes, recherche en cours et décisions de la mission, sans plafond', () => {
  const results = [{ id: 'r1' }, { id: 'r2' }];
  const statuses = new Map([
    ['r1', { status: 'shortlisted' }],
    ['p-new', { status: 'discovered' }],
    ['p-scored', { status: 'scored', score: 60 }],
    ['p-kept', { status: 'messaged' }],
    ['p-out', { status: 'dismissed' }],
    ['p-lost', { status: 'shortlisted', pipeline_stage: 'Perdu' }],
    ['p-blank', { status: 'shortlisted' }],
  ]);
  const toProfile = (st) => (st === statuses.get('p-blank') ? null : { id: [...statuses].find(([, v]) => v === st)[0] });
  const ids = G.sourcingProfilesOf(results, statuses, toProfile).map((p) => p.id);
  // À trier d'anciennes recherches exclus (conception 5.1), retenus et écartés gardés.
  assert.deepEqual(ids, ['r1', 'r2', 'p-kept', 'p-out', 'p-lost']);
  // Remis à trier ici : gardé dans À trier.
  assert.deepEqual(G.sourcingProfilesOf(results, statuses, toProfile, new Set(['p-new'])).map((p) => p.id), ['r1', 'r2', 'p-new', 'p-kept', 'p-out', 'p-lost']);
  assert.deepEqual(G.sourcingProfilesOf(results, undefined, toProfile).map((p) => p.id), ['r1', 'r2']);
  const many = new Map(Array.from({ length: 600 }, (_, i) => [`x${i}`, { status: 'dismissed' }]));
  assert.equal(G.sourcingProfilesOf([], many, (st) => ({ id: 'x' })).length, 600, 'aucun plafond');
});

// ---------------------------------------------------------------- interrupteur éteint

test('S-7 : la nouvelle page mission et la page d\'une recherche passent la disposition « mission-v3 »', () => {
  assert.match(code('src/components/missions/v3/shell/SourcingScreen.tsx'), /<MissionSourcing project=\{project\} layout="mission-v3" \/>/);
  assert.match(code('src/components/missions/v2/MissionWorkspaceV2.tsx'), /<MissionSourcing project=\{project\} \/>/);
  // Depuis 2148cfab, /sourcing/:id affiche le Sourcing de la mission, plus LinkedInSearch seul.
  const standalone = code('src/pages/SourcingSearch.tsx');
  assert.match(standalone, /<MissionSourcing project=\{project\} layout="mission-v3"/);
  assert.doesNotMatch(standalone, /<LinkedInSearch\b/);

  // Défauts : le rendu actuel.
  assert.match(code('src/components/missions/MissionSourcing.tsx'), /\{ project, layout = 'default', initialPhrase, startWithFilters \}/);
  assert.match(code('src/components/outreach/LinkedInSearch.tsx'), /layout = 'default',\n  initialPhrase,\n  startWithFilters,\n\}\) => \{\n  const isV3 = layout === 'mission-v3' && !!activeProject;/);
  const panel = code('src/components/outreach/search/SearchResultsPanel.tsx');
  assert.match(panel, /layout = 'default',/);
  assert.match(panel, /chipsDirty = false,/);
  const flow = code('src/components/outreach/search/SourcingFlow.tsx');
  assert.equal((flow.match(/variant = 'default',/g) || []).length, 2, 'SearchHero et FilterChipBar');
  assert.match(code('src/components/outreach/search/SearchFiltersPanel.tsx'), /hidePromptBar = false,/);

  // Ancien rendu gardé tel quel derrière la disposition.
  assert.match(flow, /\{isV3 \? 'Qui cherchez-vous \?' : 'Qui cherches-tu \?'\}/);
  assert.match(panel, /\{isV3 && onSetSelection && onRetainProfiles && onDismissProfiles \? \(/);
  assert.match(panel, /'bg-background border border-border rounded-xl flex w-full max-w-full min-w-0 flex-col min-h-\[420px\] lg:min-h-0 lg:h-full overflow-hidden'/);
  const search = code('src/components/outreach/LinkedInSearch.tsx');
  assert.match(search, /\{activeProject && !isV3 && flowMode === 'results' && \(/);
  assert.match(search, /\{!isV3 && \(!activeProject \|\| flowMode === 'results'\) && pedigreeBanner\}/);
  assert.match(search, /\.\.\.\(isV3 \? \{\n\s+layout: 'mission-v3' as const,/);
  assert.match(code('src/components/missions/MissionSourcing.tsx'), /\{showBriefToFiltersPrompt && !isV3 && \(/);
});

test('S-7b : la nouvelle page n\'écrit rien dans l\'état ni le cache de l\'ancienne', () => {
  const search = code('src/components/outreach/LinkedInSearch.tsx');
  // Clé du cache à part : l'ancienne page garde `mission-sourcing:{id}`.
  assert.match(search, /`\$\{isV3 \? 'mission-sourcing-v3' : 'mission-sourcing'\}:\$\{activeProject\.id\}`/);
  // Vue du vivier jamais forcée dans l'état : seule la lecture change en v3.
  assert.match(search, /showPoolView: isV3 \|\| showPoolView,/);
  const panel = code('src/components/outreach/search/SearchResultsPanel.tsx');
  assert.doesNotMatch(panel, /onSetShowPoolView\(true\)/);
  assert.doesNotMatch(panel, /isV3 && statusFilter !== 'all'/);
  assert.match(panel, /profiles=\{v3Profiles\}/);
  // Fiche : le groupe affiché ; InMail : les profils des groupes.
  assert.match(panel, /const navList = isV3 && v3Order \? v3Order : filteredResults;/);
  assert.match(panel, /totalCount=\{navList\.length\}/);
  assert.match(panel, /\(isV3 \? v3Profiles : results\)\.find\(r => r\.id === id\)/);
});

test('S-8b : remettre à trier efface la note affichée et relit les statuts', () => {
  const search = read('src/components/outreach/LinkedInSearch.tsx');
  const start = search.indexOf('const handleRestoreProfileV3 = useCallback(');
  assert.ok(start >= 0);
  const body = search.slice(start, search.indexOf('\n  }, [', start));
  const restore = body.indexOf('search.candidateStatus.restoreCandidate(candidateId)');
  const drop = body.indexOf('delete next[candidateId]');
  const refresh = body.indexOf('search.candidateStatus.refresh()');
  assert.ok(restore >= 0 && restore < drop && drop < refresh, 'écriture, puis note retirée, puis relecture');
  assert.doesNotMatch(body, /from\('job_candidate_status'\)|\.rpc\(|setCandidateStage/);
  assert.match(search, /onRestoreProfile: handleRestoreProfileV3,/);
});

test('S-8c : état vide après affinage, relance possible ; focus rendu après la confirmation de l\'IA', () => {
  const results = code('src/components/missions/v3/sourcing/SourcingResultsV3.tsx');
  const empty = results.slice(results.indexOf('Aucun profil trouvé'), results.indexOf('Élargir les filtres avec l'));
  assert.match(empty, /\{chipsDirty && onRerun && \(/);
  assert.match(empty, /Relancer avec les nouveaux filtres/);
  assert.match(results, /\(aiTriggerRef\.current \?\? selectAllRef\.current\)\?\.focus\(\);/);
  const top = code('src/components/missions/v3/sourcing/SourcingTopBar.tsx');
  assert.match(top, /readOnly=\{busy\}/);
  assert.doesNotMatch(top, /disabled=\{busy/);
});

// ---------------------------------------------------------------- écritures

test('S-8 : retenir et écarter une liste passent par useJobCandidateStatus', () => {
  const search = read('src/components/outreach/LinkedInSearch.tsx');
  const body = (name) => {
    const start = search.indexOf(`const ${name} = useCallback(`);
    assert.ok(start >= 0, `${name} introuvable`);
    return search.slice(start, search.indexOf('\n  }, [', start));
  };
  const retain = body('handleRetainProfiles');
  assert.match(retain, /search\.candidateStatus\.batchShortlist\(/);
  const echec = retain.indexOf('bilan.failed > 0');
  assert.ok(echec >= 0 && echec < retain.indexOf('dropFromSelection('), 'sélection gardée tant que le bilan a un échec');
  assert.ok(echec < retain.indexOf('toast.success'), 'aucun succès annoncé avant le bilan');
  assert.match(retain, /skippedStageMessage\(bilan\.skipped\)/);
  const dismiss = body('handleDismissProfiles');
  assert.match(dismiss, /const \{ dismissed, failed \} = await search\.candidateStatus\.batchDismiss\(/);
  assert.match(dismiss, /if \(failed === 0\) dropFromSelection\(/);
  for (const text of [retain, dismiss]) {
    assert.doesNotMatch(text, /from\('job_candidate_status'\)|\.rpc\(|setCandidateStage/);
  }
});

// ---------------------------------------------------------------- textes et gardes statiques

const V3_DIR = 'src/components/missions/v3/sourcing';
const v3Files = readdirSync(join(ROOT_PATH, V3_DIR)).map((name) => `${V3_DIR}/${name}`);

test('S-9 : v3/sourcing n’écrit rien en direct et reste dans les règles de rédaction', () => {
  assert.ok(v3Files.length >= 3);
  for (const rel of v3Files) {
    const src = code(rel);
    assert.doesNotMatch(src, /from\(['"]job_candidate_status['"]\)/, `${rel} : écriture directe`);
    assert.doesNotMatch(src, /\.rpc\(/, `${rel} : appel de fonction de la base`);
    assert.doesNotMatch(src, /trackEvent/, `${rel} : trackEvent`);
    assert.doesNotMatch(read(rel), /—/, `${rel} : tiret long`);
    assert.doesNotMatch(read(rel), /\p{Extended_Pictographic}/u, `${rel} : emoji`);
    assert.doesNotMatch(src, /Unipile|Apollo|\bPDL\b|People Data Labs|Anthropic|Claude|Brandfetch|Resend/, `${rel} : nom de prestataire`);
    assert.doesNotMatch(src, /window\.confirm/, `${rel} : confirmation du navigateur`);
  }
  const results = code(`${V3_DIR}/SourcingResultsV3.tsx`);
  for (const needle of [
    'role="tablist"', 'role="tab"', 'aria-selected={selected}', 'role="tabpanel"', "'ArrowRight'",
    'aria-label="Tout sélectionner"', 'aria-label="Actions sur la sélection"', 'aria-label="Tout désélectionner"',
    'Les retenus suivent leur étape dans le Pipeline', 'Ouvrir le Pipeline',
    'Profils retenus depuis vos recherches.', 'Profils écartés depuis vos recherches.',
    'Remettre à trier renvoie le profil dans À trier et efface sa note.',
    "La décision vous revient.", 'Relancer avec les nouveaux filtres', 'Voir la suite',
    'Aucun profil à trier.', 'Aucun profil retenu.', 'Aucun profil écarté.', 'aria-busy="true"',
  ]) {
    assert.ok(results.includes(needle), `SourcingResultsV3 : ${needle} absent`);
  }
  const top = code(`${V3_DIR}/SourcingTopBar.tsx`);
  for (const needle of ['aria-expanded={open}', 'aria-controls={zoneId}', 'Filtres (${filterCount})', 'Nouvelle recherche', 'aria-label="Affiner la recherche en langage naturel"']) {
    assert.ok(top.includes(needle), `SourcingTopBar : ${needle} absent`);
  }
});

test('S-10 : textes de la nouvelle page dans les fichiers partagés, vouvoyés, sans tiret long', () => {
  const flow = read('src/components/outreach/search/SourcingFlow.tsx');
  for (const text of [
    "Décrivez le profil idéal : rôle, séniorité, contexte, lieu. L'IA le traduit en filtres que vous pourrez modifier.",
    'Générer les filtres et chercher', 'Exemples : rôle, séniorité, contexte, lieu', ', sans rien écrire',
  ]) {
    assert.ok(flow.includes(text), `SourcingFlow : ${text} absent`);
  }
  const search = read('src/components/outreach/LinkedInSearch.tsx');
  assert.match(search, /'Filtres mis à jour\. Relancez la recherche pour voir les nouveaux profils\.'/);
  assert.match(search, /passe dans Retenus\./);
  assert.match(search, /passe dans Écartés\./);
});

// ---------------------------------------------------------------- design simplifié (04/10/2026)

test('S-11 : un seul bouton plein, boutons discrets, puces sans cadre, zéro non écrit', () => {
  const results = code(`${V3_DIR}/SourcingResultsV3.tsx`);
  const top = code(`${V3_DIR}/SourcingTopBar.tsx`);
  // Branche des résultats : après l'écran de chargement et l'écran « aucun profil » (qui ont leurs propres boutons).
  const resultsBranch = results.slice(results.indexOf('const canLoadMore'));
  // Liste de résultats : « Noter » est le seul bouton plein, son coût écrit à côté (lu par aria-describedby).
  assert.equal((resultsBranch.match(/variant="primary"/g) || []).length, 1, 'un seul bouton plein dans les résultats');
  assert.match(resultsBranch, /variant="primary"[\s\S]{0,200}aria-describedby="sourcing-cout-notation"/);
  assert.match(resultsBranch, /id="sourcing-cout-notation"[^>]*>\s*\{scoreCostText\(toScore\.length, SCORING_FLOOR\)\}/);
  assert.match(resultsBranch, /\{scoreButtonText\(toScore\.length, unscored\.length\)\}/);
  assert.doesNotMatch(results, /scoreButtonLabel/);
  // Aucun résultat : un seul bouton plein à la fois (« Élargir » ne l'est que sans « Relancer »).
  assert.match(results, /variant=\{chipsDirty && onRerun \? 'ghost' : 'primary'\}/);
  // Sélection, décisions, relance : aucun autre bouton plein, aucun bouton encadré.
  assert.doesNotMatch(results, /variant="(outline|default)"/);
  assert.doesNotMatch(results, /size="sm"\s+variant="default"/);
  assert.doesNotMatch(top, /variant="(primary|outline|default)"/);
  assert.equal((top.match(/variant="ghost"/g) || []).length, 2, '« Filtres » et « Nouvelle recherche » en boutons discrets');
  // Pas de cadre autour des sections ni des listes (le seul cadre gardé : la barre flottante de sélection).
  for (const [name, src] of [['SourcingResultsV3', results], ['SourcingTopBar', top]]) {
    assert.doesNotMatch(src, /\bbg-card\b/, `${name} : carte`);
  }
  assert.equal((results.match(/rounded-(lg|xl) border border-border/g) || []).length, 1, 'un seul cadre : la barre flottante de sélection');
  assert.match(results, /rounded-xl border border-border bg-popover/);
  assert.equal((top.match(/rounded-(lg|xl) border border-border/g) || []).length, 1, 'un seul cadre : le champ « Affiner »');
  assert.doesNotMatch(results, /STAGE_PILL/, 'plus de pastille colorée par étape');
  assert.doesNotMatch(results, /border border-border text-/, 'boutons de décision sans cadre');
  // Puces d'état : le chiffre nul ne s'écrit pas, le nom accessible le garde (« Écartés 0 »).
  assert.match(results, /aria-label=\{`\$\{SOURCING_GROUP_LABEL\[group\]\} \$\{count\}`\}/);
  assert.match(results, /\{count > 0 && \(/);
  // Bascule d'affichage : fond neutre, sans bordure, mêmes noms accessibles qu'avant.
  assert.match(results, /aria-label="Affichage des profils à trier" className="ml-auto inline-flex shrink-0 items-center rounded-lg bg-muted\/60 p-0\.5"/);
  assert.match(results, /aria-pressed=\{view === option\.value\}/);
  assert.match(results, /aria-label="Groupes de résultats"/);
  // Une seule phrase de pied de liste, qui ne répète pas ce que dit « Noter ».
  assert.doesNotMatch(results, /pas encore notés/i);
  assert.match(results, /Tous les profils de cette recherche sont chargés\. Élargissez vos filtres pour en trouver d'autres\./);
});

test('S-11b : cibles de 44 px sur téléphone et nom accessible des boutons gardé', () => {
  const results = code(`${V3_DIR}/SourcingResultsV3.tsx`);
  const top = code(`${V3_DIR}/SourcingTopBar.tsx`);
  for (const [name, src, min] of [['SourcingResultsV3', results, 8], ['SourcingTopBar', top, 3]]) {
    assert.ok((src.match(/max-sm:(min-h|h)-11/g) || []).length >= min, `${name} : cibles de 44 px`);
  }
  assert.match(results, /aria-label=\{`Retenir \$\{row\.name\}`\}/);
  assert.match(results, /aria-label=\{`Écarter \$\{row\.name\}`\}/);
  assert.match(results, /aria-label=\{`Remettre \$\{row\.name\} à trier`\}/);
  assert.match(results, /aria-label=\{`Sélectionner \$\{row\.name\}`\}/);
  // Les puces d'état restent des onglets au clavier (flèches, Origine, Fin), un seul dans l'ordre de tabulation.
  assert.match(results, /tabIndex=\{selected \? 0 : -1\}/);
  // Le visage de chaque ligne et la note en anneau (ScorePill du Pipeline).
  assert.match(results, /<PersonAvatar name=\{row\.name\} src=\{row\.profile\.profile_picture_url\}/);
  assert.match(results, /<ScorePill score=\{row\.note\} \/>/);
});

test('S-11c : écran de départ et carte « Relier LinkedIn » sans cadre ; exemples en liens discrets', () => {
  const screen = code('src/components/missions/v3/shell/SourcingScreen.tsx');
  assert.match(screen, /<Button asChild variant="primary"/);
  assert.match(screen, /<IconTile icon=\{Link2\}/);
  assert.doesNotMatch(screen, /bg-card|rounded-xl border/);
  const flow = code('src/components/outreach/search/SourcingFlow.tsx');
  // Les exemples de la nouvelle page ne sont plus des pastilles encadrées ; l'ancien rendu garde les siennes.
  assert.match(flow, /isV3\s*\?\s*'rounded-sm px-1 py-1\.5 text-sm text-\[var\(--k-text-2\)\] underline/);
  assert.match(flow, /: 'rounded-full border border-\[var\(--k-hairline\)\] px-3 py-1\.5 text-xs/);
  assert.match(flow, /\? 'flex items-center gap-2\.5 w-full text-left border-t border-\[var\(--k-hairline\)\]/);
  assert.match(flow, /: 'flex items-center gap-2\.5 w-full text-left rounded-\[10px\] border/);
});

// ---------------------------------------------------------------- tableau des résultats

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
};
const PEOPLE = [
  { id: 'a', name: 'Camille Fontaine', headline: 'Responsable paie, Groupe Delmas', location: 'Lyon, France' },
  { id: 'b', name: 'Hugo Lambert', headline: 'DRH adjoint', location: 'Paris, France' },
];
const SCORED = { a: { match_score: 86, recommendation: 'go', matching_skills: ['Paie'], missing_skills: [] } };
const tableHtml = (extra = {}, scores = SCORED) =>
  kit.renderToStaticMarkup(kit.createElement(kit.CompactResultsTable, {
    profiles: PEOPLE,
    selectedJob: { id: 'project:1', title: 'Responsable RH', skills: ['Paie', 'Droit social'] },
    jobScores: scores,
    selectedProfiles: new Set(),
    treatedCandidates: new Map(),
    onToggleSelect() {},
    onToggleSelectAll() {},
    allSelected: false,
    onOpenDetail() {},
    storageKey: 'project:1',
    ...extra,
  })).replace(/<svg[\s\S]*?<\/svg>/g, '');
const headers = (html) => [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);

test('S-12 : tableau v3, sans cadre ni tiret, colonnes par défaut réduites, résumé sans « colonnes »', () => {
  store.clear();
  const html = tableHtml({ variant: 'mission-v3' });
  // Pas de carte autour, pas de tiret, pas de « 3/45 colonnes » ; le résumé garde profils et critères.
  assert.doesNotMatch(html, /rounded-xl border/);
  assert.doesNotMatch(html, /—/);
  assert.doesNotMatch(html, /colonnes</);
  assert.match(html.replace(/<[^>]+>/g, ''), /2 profils · 2 critères du poste/);
  // Colonnes utiles seulement : nom (titre dessous), lieu, note ; ni Avis, ni Statut, ni critères d'emblée.
  assert.deepEqual(headers(html).filter((h) => h !== 'Tout sélectionner'), ['Nom', 'Lieu', 'Note', 'Actions']);
  assert.match(html, /Responsable paie, Groupe Delmas/, 'titre du profil sous le nom');
  assert.match(html, /aria-label="Note 86"/, 'note en anneau');
  assert.match(html, />CF</, 'visage (initiales sans photo)');
  // Rien n'est écrit tant que la personne n'a pas choisi.
  assert.equal(store.size, 0);
});

test('S-12b : une colonne vide pour toutes les lignes n\'est pas proposée d\'emblée', () => {
  store.clear();
  const noScore = headers(tableHtml({ variant: 'mission-v3' }, {}));
  assert.ok(!noScore.includes('Note'), 'aucune note : pas de colonne Note');
  assert.ok(noScore.includes('Lieu'));
  const noPlace = headers(kit.renderToStaticMarkup(kit.createElement(kit.CompactResultsTable, {
    profiles: PEOPLE.map(({ location, ...rest }) => rest), jobScores: SCORED, selectedProfiles: new Set(), treatedCandidates: new Map(),
    onToggleSelect() {}, onToggleSelectAll() {}, allSelected: false, onOpenDetail() {}, variant: 'mission-v3',
  })));
  assert.ok(!noPlace.includes('Lieu'), 'aucun lieu : pas de colonne Lieu');
});

test('S-12c : le choix de colonnes d\'une personne est gardé (clé v3, puis choix fait avant sur le même poste)', () => {
  // Choix déjà fait sur le même poste avant la nouvelle page (clé v2) : repris tel quel.
  store.clear();
  store.set('konekt_table_columns_v2_project:1', JSON.stringify(['industry']));
  const kept = headers(tableHtml({ variant: 'mission-v3' }));
  assert.ok(kept.includes('Avis') && kept.includes('Statut'), 'tout le reste est affiché : la personne n\'avait caché que « Secteur »');
  assert.ok(!kept.includes('Secteur'));
  // Choix de la nouvelle page : prioritaire, et seul à jouer.
  store.set('konekt_table_columns_v3_project:1', JSON.stringify(['recommendation', 'konekt_status', 'industry']));
  const own = headers(tableHtml({ variant: 'mission-v3' }));
  assert.ok(!own.includes('Avis') && !own.includes('Statut'));
  // Le nom reste affiché même si un ancien choix l'avait caché (il porte le visage).
  store.set('konekt_table_columns_v3_project:1', JSON.stringify(['name']));
  assert.ok(headers(tableHtml({ variant: 'mission-v3' })).includes('Nom'));
});

test('S-12d : l\'ancien rendu du tableau est gardé tel quel', () => {
  store.clear();
  const html = tableHtml();
  assert.match(html, /rounded-xl border border-border bg-background/);
  assert.match(html.replace(/<[^>]+>/g, ''), /\d+\/\d+ colonnes/);
  assert.match(html, /—/);
  assert.ok(headers(html).includes('Avis') && headers(html).includes('Titre du profil'));
  // Ni colonne du menu collée à droite, ni colonne cachée sur téléphone, ni zone défilante nommée.
  assert.doesNotMatch(html, /sticky right-0/);
  assert.doesNotMatch(html, /max-sm:hidden/);
  assert.doesNotMatch(html, /role="region"/);
  const src = read('src/components/outreach/search/CompactResultsTable.tsx');
  assert.match(src, /variant = 'default',\n\}\) => \{\n  const isV3 = variant === 'mission-v3';/);
  // La nouvelle page n'écrit pas dans la clé de l'ancienne, et seulement sur un choix de la personne.
  assert.match(src, /if \(isV3\) return; \/\/ nouvelle page/);
  assert.match(src, /localStorage\.setItem\(lsKeyV3, JSON\.stringify\(Array\.from\(next\)\)\)/);
  // Seuls le tableau et la fiche de la nouvelle page reçoivent la disposition.
  const panel = code('src/components/outreach/search/SearchResultsPanel.tsx');
  assert.equal((panel.match(/variant="mission-v3"/g) || []).length, 2);
  const tables = panel.split('<CompactResultsTable').slice(1);
  assert.equal(tables.length, 2);
  assert.match(tables[0], /variant="mission-v3"/);
  assert.doesNotMatch(tables[1].slice(0, tables[1].indexOf('/>')), /variant/);
  const cards = panel.split('<LinkedInResultCard').slice(1);
  assert.equal(cards.length, 2);
  assert.match(cards[0].slice(0, cards[0].indexOf('onToggleSelect')), /variant="mission-v3"/);
  assert.doesNotMatch(cards[1].slice(0, cards[1].indexOf('/>')), /variant=/);
});

// ---------------------------------------------------------------- relecture : Détaillé, filtres, téléphone, colonnes

test('S-13 : tableau v3, menu de la ligne collé à droite, lieu et expérience hors téléphone, menu des colonnes borné', () => {
  store.clear();
  const html = tableHtml({ variant: 'mission-v3' });
  // Le menu de la ligne reste collé à droite : en-tête et cellules.
  assert.match(html, /<th[^>]*sticky right-0 z-30 bg-background w-14 min-w-14/);
  assert.match(html, /<td[^>]*sticky right-0 z-10 text-center w-14 min-w-14/);
  // Lieu : jamais en colonne sur téléphone (nom, note et menu tiennent à l'écran), mais affiché ailleurs.
  const th = (label) => html.split('<th').find((chunk) => chunk.includes(`>${label}<`)) ?? '';
  assert.match(th('Lieu'), /max-sm:hidden/);
  // Note : jamais cachée sur téléphone.
  assert.ok(th('Note') && !/max-sm:hidden/.test(th('Note')));
  // Un choix fait avant la notation part de la liste fixe des colonnes cachées, pas de l'état du moment.
  const src = read('src/components/outreach/search/CompactResultsTable.tsx');
  assert.match(src, /const next = new Set\(v3Choice \?\? v3StaticHidden\)/);
  assert.match(src, /const hiddenNow = \(v3Choice \?\? v3DefaultHidden\)\.has\(id\)/);
  assert.doesNotMatch(src, /new Set\(v3Choice \?\? v3DefaultHidden\)/);
  // Menu des colonnes : sa hauteur suit la place libre, il ne sort pas du haut de l'écran.
  assert.match(src, /max-h-\[min\(70vh,var\(--radix-dropdown-menu-content-available-height\)\)\]/);
  assert.match(src, /collisionPadding=\{isV3 \? 8 : undefined\}/);
  // Zone défilante : atteignable au clavier et nommée seulement quand elle déborde, indice d'une suite à droite.
  assert.match(src, /role: 'region', 'aria-label': 'Liste des profils, défilement horizontal possible'/);
  assert.match(src, /scrollCue\.scrollable \? \{ tabIndex: 0/);
});

test('S-13b : Détaillé de la nouvelle page, ligne à filet, note en anneau, boutons discrets, 44 px ; ancien rendu par défaut', () => {
  const card = code('src/components/outreach/LinkedInResultCard.tsx');
  assert.match(card, /variant = 'default',\n\}\) => \{\n  const isV3 = variant === 'mission-v3';/);
  assert.match(card, /border-b border-border\/50/);
  assert.match(card, /<PersonAvatar name=\{fullName\} src=\{profile\.profile_picture_url\} size=\{40\} \/>/);
  assert.match(card, /hasHighScore && !isV3/);
  const badges = code('src/components/outreach/result-card/CardStatusBadges.tsx');
  assert.match(badges, /variant === 'mission-v3' && \(\s*<ScorePill score=\{jobScore\.match_score\}/);
  const actions = code('src/components/outreach/result-card/CardActions.tsx');
  assert.match(actions, /variant=\{isV3 \? 'ghost' : 'primary'\}/);
  assert.match(actions, /variant=\{isV3 \? 'ghost' : 'outline'\}/);
  assert.equal((actions.match(/quiet=\{isV3\}/g) || []).length, 2, 'Séquence et Retenir en boutons discrets');
  assert.match(actions, /h-8 w-8 max-sm:h-11 max-sm:w-11/);
  // Boutons partagés : discrets seulement sur demande, contour par défaut.
  const enroll = code('src/components/outreach/SequenceEnrollButton.tsx');
  assert.match(enroll, /quiet = false,/);
  assert.match(enroll, /variant=\{quiet \? 'ghost' : 'outline'\}/);
  const project = code('src/components/outreach/projects/AddToProjectButton.tsx');
  assert.match(project, /quiet = false,/);
  assert.match(project, /variant=\{isAdded \|\| quiet \? "ghost" : "outline"\}/);
  // « Contacter » de la barre de sélection et des retenus : discret, 44 px sur téléphone.
  const results = code(`${V3_DIR}/SourcingResultsV3.tsx`);
  assert.equal((results.match(/\bquiet\n/g) || []).length, 2);
});

test('S-13c : zone Filtres de la nouvelle page, puces sans cadre, une seule rangée, texte de 14 px, sans « booléen »', () => {
  const overlays = code('src/components/outreach/search/SmartOverlays.tsx');
  assert.match(overlays, /variant = 'default', trailing/);
  const chip = code(`${V3_DIR}/quickChip.ts`);
  assert.match(chip, /export const quickChipV3 = \(active: boolean\) => cn\(/);
  assert.match(chip, /rounded-lg px-2\.5 text-sm/);
  assert.match(chip, /before:absolute before:inset-x-0 before:-inset-y-1\.5 sm:before:hidden/);
  assert.match(overlays, /from '@\/components\/missions\/v3\/sourcing\/quickChip'/);
  assert.match(overlays, /className=\{isV3 \? quickChipV3\(isActive\) : cn\(/);
  // L'ancienne page garde ses pastilles encadrées.
  assert.match(overlays, /'inline-flex items-center gap-1\.5 rounded-full border px-2\.5 py-1 text-xs font-medium/);
  const search = code('src/components/outreach/LinkedInSearch.tsx');
  assert.match(search, /variant="mission-v3"\s+filters=\{search\.filters\}/);
  assert.match(search, /className=\{quickChipV3\(openToWorkActive\)\}/, '« À l\'écoute » rejoint les filtres rapides');
  assert.doesNotMatch(search, /border-success\/40 bg-success-muted/);
  const flow = code('src/components/outreach/search/SourcingFlow.tsx');
  assert.match(flow, /\{chip\.op && !\(isV3 && chip\.op === 'booléen'\) && \(/);
  assert.match(flow, /isV3\s*\? 'rounded-lg bg-muted\/60 text-sm'/);
});

test('S-13d : écran de départ, bouton plein monochrome, consigne lisible ; « Voir la suite » reste en place', () => {
  const flow = code('src/components/outreach/search/SourcingFlow.tsx');
  assert.match(flow, /variant=\{\(armed \|\| onLaunchWithBriefFilters\) \? 'primary' : 'ghost'\}/);
  assert.match(flow, /isV3 \? 'placeholder:text-muted-foreground max-sm:min-h-\[108px\]' : 'placeholder:text-\[var\(--k-text-placeholder\)\]'/);
  // Le bouton de la nouvelle page n'emploie plus la couleur de marque ; celui de l'ancienne page la garde.
  const hero = flow.slice(flow.indexOf('export const SearchHero'), flow.indexOf('export const SearchPlan'));
  assert.equal((hero.match(/bg-\[var\(--k-accent\)\] text-\[var\(--k-on-accent\)\]/g) || []).length, 1);
  const results = code(`${V3_DIR}/SourcingResultsV3.tsx`);
  // Le bouton ne disparaît pas pendant le chargement (le focus resterait sur la page) : aria-disabled, jamais disabled.
  assert.match(results, /aria-disabled=\{loadingMore \|\| undefined\}/);
  assert.match(results, /disabled=\{loading && !loadingMore\}/);
  assert.doesNotMatch(results, /loadingMore \? \(\s*<span aria-hidden="true" className="inline-flex items-center gap-1\.5 px-2">/);
  assert.match(results, /<span role="status" className="sr-only">\{loadAnnouncement\}<\/span>/);
});

test('S-13e : liste Tri, la ligne du nom ne se coupe plus, titre sous le nom jusqu\'à xl, action de retour en icône sur téléphone', () => {
  const results = code(`${V3_DIR}/SourcingResultsV3.tsx`);
  // L'avis de l'IA passe sur la deuxième ligne : il ne mange plus la place du nom.
  const nameRow = results.slice(
    results.indexOf('data-row-name=""'),
    results.indexOf('<span className="flex min-w-0 items-baseline gap-1.5 text-sm text-muted-foreground">'),
  );
  assert.ok(nameRow.length > 100, 'ligne du nom repérée');
  assert.doesNotMatch(nameRow, /Recommandé/);
  assert.match(results, /xl:table-cell">Poste<\/th>/);
  assert.match(results, /max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:break-words/);
  // Écartés sur téléphone : « Remettre à trier » devient une icône de 44 px, au nom accessible gardé.
  assert.match(results, /aria-label=\{`Remettre \$\{row\.name\} à trier`\}/);
  assert.match(results, /max-sm:h-11 max-sm:w-11 max-sm:px-0/);
  assert.match(results, /<Undo2 aria-hidden="true" className="sm:hidden" \/>/);
  // Sous 360 px de large, le visage s'efface pour laisser lire le nom.
  assert.match(results, /className="max-\[359px\]:hidden"/);
});

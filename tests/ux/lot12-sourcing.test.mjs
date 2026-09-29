/**
 * Refonte mission, écran Sourcing de la nouvelle page (disposition « mission-v3 ») :
 * - rangement en trois groupes et textes des lignes
 *   (src/components/missions/v3/sourcing/sourcingGroups.ts) ;
 * - interrupteur éteint : l'ancienne page et /sourcing/:id ne passent pas la
 *   disposition, et chaque prop nouvelle a le rendu actuel pour défaut ;
 * - écritures d'étape seulement par useJobCandidateStatus (candidateStage.ts),
 *   textes sans tiret long, sans emoji ni nom de prestataire.
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

test('S-6 : noms joints et libellé de notation (plancher de 2 crédits)', () => {
  assert.equal(G.joinNames(['Aurélie Vincent']), 'Aurélie Vincent');
  assert.equal(G.joinNames(['A', 'B']), 'A et B');
  assert.equal(G.joinNames(['A', 'B', 'C']), 'A, B et C');
  assert.equal(G.joinNames(['A', 'B', 'C', 'D', 'E']), 'A, B, C et 2 autres');
  assert.equal(G.scoreButtonLabel(20, 21, 2), 'Noter les 20 premiers (au moins 40 crédits)');
  assert.equal(G.scoreButtonLabel(12, 12, 2), 'Noter les 12 profils non notés (au moins 24 crédits)');
  assert.equal(G.scoreButtonLabel(1, 1, 2), 'Noter le profil non noté (au moins 2 crédits)');
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

test('S-7 : seule la nouvelle page passe la disposition « mission-v3 »', () => {
  assert.match(code('src/components/missions/v3/shell/SourcingScreen.tsx'), /<MissionSourcing project=\{project\} layout="mission-v3" \/>/);
  assert.match(code('src/components/missions/v2/MissionWorkspaceV2.tsx'), /<MissionSourcing project=\{project\} \/>/);
  const standalone = code('src/pages/SourcingSearch.tsx');
  const call = standalone.slice(standalone.indexOf('<LinkedInSearch'), standalone.indexOf('/>', standalone.indexOf('<LinkedInSearch')));
  assert.ok(call.length > 0, 'appel de LinkedInSearch introuvable');
  assert.doesNotMatch(call, /layout|mission-v3/);

  // Défauts : le rendu actuel.
  assert.match(code('src/components/missions/MissionSourcing.tsx'), /\{ project, layout = 'default' \}/);
  assert.match(code('src/components/outreach/LinkedInSearch.tsx'), /layout = 'default',\n\}\) => \{\n  const isV3 = layout === 'mission-v3' && !!activeProject;/);
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
  for (const needle of ['aria-expanded={open}', 'aria-controls={zoneId}', 'Filtres ({filterCount})', 'Nouvelle recherche', 'aria-label="Affiner la recherche en langage naturel"']) {
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

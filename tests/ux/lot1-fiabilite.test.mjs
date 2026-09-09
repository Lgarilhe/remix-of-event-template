/**
 * Lot 1 du chantier UX — garde-fous de non-régression.
 *
 * L'audit du 09/09/2026 reproche aux tests existants de protéger le rendu plus
 * que le résultat métier : un faux message de succès passait au vert. Ces tests
 * épinglent les invariants des correctifs du lot 1, dans le style des tests
 * `tests/agent` : inspection de source, exécutable sans navigateur ni base.
 *
 * Ils ne remplacent pas les scénarios de `docs/audit-ux/03-scenarios.md`, qui
 * demandent une application connectée. Ils empêchent le retour silencieux du
 * défaut à la faveur d'un refactor.
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const linkedInSearch = read('src/components/outreach/LinkedInSearch.tsx');
const candidateStatus = read('src/hooks/useJobCandidateStatus.ts');
const sourcingProjects = read('src/hooks/useSourcingProjects.ts');
const chatDraft = read('src/hooks/useChatDraft.ts');
const messageView = read('src/components/outreach/inbox/MessageView.tsx');

// ---------------------------------------------------------------- UX01
test('UX01 — « Shortlister » écrit bien un statut de shortlist', () => {
  const handler = linkedInSearch.slice(
    linkedInSearch.indexOf('const handleBulkAddToProject'),
    linkedInSearch.indexOf('// Handle archive for single profile'),
  );
  assert.ok(handler.length > 0, 'handleBulkAddToProject introuvable');
  assert.match(handler, /batchShortlist\(/, 'le handler doit appeler batchShortlist');
  assert.doesNotMatch(
    handler,
    /batchDiscover\(/,
    'batchDiscover écrit le statut « discovered », que le filtre Shortlist ne trouve pas',
  );
});

test('UX01 — batchShortlist écrit le statut que le filtre Shortlist cherche', () => {
  const fn = candidateStatus.slice(candidateStatus.indexOf('const batchShortlist'));
  assert.match(fn, /status:\s*'shortlisted'/, 'le statut écrit doit être shortlisted');
});

test('UX01 — un profil déjà noté est bien remis en shortlist', () => {
  const fn = candidateStatus.slice(
    candidateStatus.indexOf('const batchShortlist'),
    candidateStatus.indexOf('return {\n    statuses,'),
  );
  // Le tri se fait sur le statut « déjà en shortlist », pas sur la simple
  // présence du candidat : un profil `scored` doit être écrit, pas ignoré.
  assert.match(fn, /statuses\.get\(p\.id\)\?\.status !== 'shortlisted'/);
  assert.doesNotMatch(
    fn,
    /filter\(\s*p\s*=>\s*!statuses\.has\(p\.id\)\s*\)/,
    'filtrer sur la présence du candidat laisserait les profils déjà notés hors shortlist',
  );
});

test('UX01b — un échec de persistance ne peut pas ressortir en succès', () => {
  const fn = candidateStatus.slice(
    candidateStatus.indexOf('const batchShortlist'),
    candidateStatus.indexOf('return {\n    statuses,'),
  );
  assert.match(fn, /failed:\s*toWrite\.length/, 'un échec doit être compté dans le bilan');
  assert.match(fn, /error:\s*error\.message/, 'la cause doit remonter à l’appelant');

  const handler = linkedInSearch.slice(
    linkedInSearch.indexOf('const handleBulkAddToProject'),
    linkedInSearch.indexOf('// Handle archive for single profile'),
  );
  const echec = handler.indexOf('bilan.failed > 0');
  const vidage = handler.indexOf('setSelectedProfiles(new Set())');
  const succes = handler.indexOf('toast.success');
  assert.ok(echec !== -1, 'le handler doit examiner le bilan avant de confirmer');
  assert.ok(echec < vidage, 'la sélection ne doit être vidée qu’après un bilan sans échec');
  assert.ok(echec < succes, 'aucun message de succès avant l’examen du bilan');
});

// ---------------------------------------------------------------- UX02
test('UX02 — les actions groupées résolvent la sélection sur la liste affichée', () => {
  for (const nom of ['handleBulkDismiss', 'handleBulkAddToProject']) {
    const debut = linkedInSearch.indexOf(`const ${nom}`);
    const handler = linkedInSearch.slice(debut, debut + 1800);
    assert.match(
      handler,
      /mergedResults\.find\(/,
      `${nom} doit résoudre sur mergedResults, vivier compris`,
    );
    assert.doesNotMatch(
      handler,
      /search\.results\.find\(/,
      `${nom} : search.results seul laisse tomber les profils du vivier en silence`,
    );
  }
});

// ---------------------------------------------------------------- UX03
test('UX03 — une sauvegarde sans ligne renvoyée est une erreur, pas un succès', () => {
  const debut = sourcingProjects.indexOf('const updateMutation');
  const mutation = sourcingProjects.slice(debut, debut + 1600);
  assert.doesNotMatch(
    mutation,
    /return\s*\(\s*data\s*\|\|/,
    'fabriquer un objet depuis le payload fait passer une ligne absente pour un enregistrement',
  );
  assert.match(mutation, /if\s*\(!data\)\s*\{[\s\S]*throw new Error/);
});

// ---------------------------------------------------------------- UX04
test('UX04 — la dernière frappe est écrite avant de quitter', () => {
  assert.match(chatDraft, /pendingRef/, 'la valeur en attente doit être mémorisée');
  assert.match(chatDraft, /const flush = useCallback/, 'une écriture immédiate doit exister');
  assert.match(chatDraft, /useEffect\(\(\)\s*=>\s*flush,/, 'la sortie du composant doit écrire');
  assert.match(chatDraft, /addEventListener\('pagehide'/, 'la fermeture de page doit écrire');
});

test('UX04 — effacer son texte efface aussi le brouillon stocké', () => {
  // Ancrage sur l'appel lui-même : présent dans toutes les versions, donc le
  // test ne peut pas passer à vide si le composant est réorganisé.
  const appel = messageView.indexOf('setDraft(newMessage);');
  assert.ok(appel !== -1, 'l’enregistrement du brouillon a disparu de MessageView');
  const effet = messageView.slice(Math.max(0, appel - 700), appel);
  assert.doesNotMatch(
    effet,
    /if\s*\(!newMessage\)\s*return;/,
    'ignorer la valeur vide laisse survivre un brouillon que l’utilisateur a effacé',
  );
  assert.match(chatDraft, /localStorage\.removeItem/, 'la valeur vide doit supprimer le brouillon');
});

test('UX04 — vider le brouillon après envoi ne peut pas être annulé par une écriture en retard', () => {
  const clear = chatDraft.slice(chatDraft.indexOf('const clearDraft'));
  assert.match(
    clear,
    /pendingRef\.current = null/,
    'sans ça, un flush ultérieur réécrirait le brouillon qu’on vient d’effacer',
  );
});

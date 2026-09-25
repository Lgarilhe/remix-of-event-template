/**
 * Audit du module séquences (2026-09-25), lot F4, passe 2 : demandes croisées
 * des autres lots.
 *
 * - SEQ-186 (F3) : badges « En séquence » du sourcing lus sur toutes les
 *   valeurs possibles de job_id d'une mission.
 * - SEQ-184 (F5) : fil de la messagerie, libellés du dictionnaire partagé
 *   src/lib/sequenceActionLabels.ts (les mêmes que la fiche candidat).
 * - SEQ-245 (F1b) : un seul nom par type d'étape, celui de l'éditeur
 *   (stepTypeLabel de sequenceGraph), dans l'aperçu d'inscription.
 *
 * La carte d'activité de la messagerie est transpilée par esbuild et rendue
 * avec un React factice (arbre d'éléments) : on lit le texte réellement affiché.
 *
 * Lancer : node --test tests/ux/seq-audit-f4c.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Transpile et charge un module TypeScript ; les imports « @/ » sont résolus dans src/, sauf `stubs`. */
async function loadModule(rel, stubs = {}) {
  const resolveSrc = (spec) => {
    const base = path.join(ROOT, 'src', spec.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`module introuvable : ${spec}`);
  };
  const result = await build({
    stdin: { contents: read(rel), resolveDir: path.dirname(path.join(ROOT, rel)), loader: rel.endsWith('x') ? 'tsx' : 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    plugins: [{
      name: 'alias-and-stubs',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (args.path in stubs) return { path: args.path, namespace: 'stub' };
          if (args.path.startsWith('@/')) return { path: resolveSrc(args.path) };
          return undefined;
        });
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

/** Portion de source entre `start` et `marker` (exclu). */
function slice(source, start, marker) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `« ${start} » introuvable`);
  const to = source.indexOf(marker, from + start.length);
  assert.ok(to > from, `fin « ${marker} » introuvable après « ${start} »`);
  return source.slice(from, to);
}

const resultsPanel = read('src/components/outreach/search/SearchResultsPanel.tsx');
const linkedInSearch = read('src/components/outreach/LinkedInSearch.tsx');
const activityCard = read('src/components/outreach/inbox/ActivityEventCard.tsx');
const previewModal = read('src/components/outreach/EnrollmentPreviewModal.tsx');
const treeView = read('src/components/outreach/enrollment-preview/SequenceTreeView.tsx');

const errorLib = await loadModule('src/lib/sequenceErrorMessages.ts');
const actionLabels = await loadModule('src/lib/sequenceActionLabels.ts');
const graph = await loadModule('src/components/outreach/sequence/sequenceGraph.ts');

// React factice : createElement renvoie l'arbre, on en lit le texte et les classes.
const REACT_STUB = `
  export const createElement = (type, props, ...children) => ({ type, props: props || {}, children });
  export const Fragment = 'Fragment';
  export default { createElement, Fragment };
`;
const ICON_STUB = ['Eye', 'UserPlus', 'MessageSquare', 'Mail', 'Clock', 'GitBranch', 'CheckCircle2', 'XCircle',
  'SkipForward', 'Hourglass', 'CalendarCheck', 'PhoneIncoming', 'PhoneOutgoing', 'Phone']
  .map((name) => `export const ${name} = '${name}';`).join('\n');
const card = await loadModule('src/components/outreach/inbox/ActivityEventCard.tsx', {
  react: REACT_STUB,
  'react-router-dom': 'export const useNavigate = () => () => {};',
  'lucide-react': ICON_STUB,
  '@/assets/aircall-logo.webp': "export default 'aircall.webp';",
  '@/hooks/useProfileActivity': 'export {};',
  '@/hooks/useMessagesInboxHelpers': "export const formatMessageTime = () => '10:00';",
  '@/lib/utils': "export const cn = (...c) => c.filter(Boolean).join(' ');",
});

/** Texte affiché par la carte (enfants texte de tout l'arbre, dans l'ordre). */
function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node.type === 'function') return textOf(node.type({ ...node.props, children: node.children }));
  return textOf(node.children);
}

/** Premier élément dont une classe correspond. */
function findByClass(node, pattern) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByClass(child, pattern);
      if (found) return found;
    }
    return null;
  }
  if (typeof node.props?.className === 'string' && pattern.test(node.props.className)) return node;
  return findByClass(node.children, pattern);
}

const renderCard = (event) => card.ActivityEventCard({
  event: { id: 'e1', type: 'sequence_step', timestamp: '2026-09-25T10:00:00.000Z', stepOrder: 0, ...event },
});

// ---------------------------------------------------------------- SEQ-186
test('SEQ-186 — badges « En séquence » du sourcing : toutes les valeurs de job_id de la mission', () => {
  assert.match(resultsPanel, /import \{ missionEnrollmentJobIds \} from '@\/lib\/sequenceErrorMessages';/);
  assert.match(
    resultsPanel,
    /useProjectEnrollments\(\s*missionEnrollmentJobIds\(activeProject\?\.id, activeProject\?\.job_id\),\s*\)/,
  );
  // Ancien choix exclusif : avec un job rattaché, les inscriptions faites
  // depuis le sourcing (job_id = id de la mission) n'avaient pas de badge.
  assert.doesNotMatch(resultsPanel, /activeProject\?\.job_id \|\| activeProject\?\.id/);
  assert.deepEqual(errorLib.missionEnrollmentJobIds('p1', 'j1'), ['p1', 'project:p1', 'j1']);
  assert.deepEqual(errorLib.missionEnrollmentJobIds(undefined, undefined), []);
  // Recharge de toutes les instances montées après une inscription.
  const handler = slice(linkedInSearch, 'const handleSequenceEnrollSuccess = useCallback(', '}, [search.setSelectedProfiles');
  assert.match(handler, /refreshProjectEnrollments\(\);/);
});

// ---------------------------------------------------------------- SEQ-184
test('SEQ-184 — messagerie : mêmes libellés et mentions de statut que la fiche candidat', () => {
  for (const [actionType, status] of [
    ['inmail', 'sent'],
    ['inmail', 'failed'],
    ['connection_request', 'skipped'],
    ['message', 'replied'],
    ['profile_visit', 'sent'],
    ['email', 'bounced'],
  ]) {
    const expected = actionLabels.sequenceExecutionTitle(actionType, status);
    assert.ok(textOf(renderCard({ actionType, status })).startsWith(expected), `${actionType}/${status} : ${expected}`);
  }
  // Une étape non partie n'est jamais présentée comme envoyée.
  const failed = renderCard({ actionType: 'inmail', status: 'failed', errorMessage: 'boom' });
  assert.doesNotMatch(textOf(failed), /InMail envoyé/);
  assert.match(textOf(failed), /^InMail : échec/);
  assert.ok(findByClass(failed, /font-medium truncate text-destructive/), 'le titre d’un échec est en rouge');
  const skipped = textOf(renderCard({ actionType: 'connection_request', status: 'skipped' }));
  assert.match(skipped, /^Invitation : étape sautée/);
  // Type inconnu : pas d'identifiant technique affiché.
  assert.doesNotMatch(textOf(renderCard({ actionType: 'unknown', status: 'sent' })), /unknown/);
  // Plus de table locale ni d'anciennes clés.
  for (const legacy of ['send_connection', 'send_message', 'send_inmail', 'visit_profile', "label: 'Invitation envoyée'", 'function statusMention']) {
    assert.ok(!activityCard.includes(legacy), `${legacy} encore présent`);
  }
  assert.match(activityCard, /from '@\/lib\/sequenceActionLabels'/);
});

test('SEQ-184 / SEQ-245 — messagerie : une étape interne prend le nom de l’éditeur', () => {
  assert.equal(textOf(renderCard({ actionType: 'wait_connection', status: 'sent' })).replace('10:00', ''), graph.stepTypeLabel('wait_connection'));
  assert.match(textOf(renderCard({ actionType: 'wait_reply', status: 'skipped' })), /^Attendre une réponse : étape sautée/);
  // Rendez-vous : libellé inchangé.
  assert.match(textOf(renderCard({ type: 'booking', actionType: 'calendly_booking', status: 'scheduled' })), /RDV planifié/);
});

// ---------------------------------------------------------------- SEQ-245
test('SEQ-245 — aperçu d’inscription : un seul nom par type d’étape, celui de l’éditeur', () => {
  for (const [name, source] of [['aperçu', previewModal], ['vue arborescente', treeView]]) {
    assert.doesNotMatch(source, /const ACTION_LABELS/, `${name} : table locale divergente`);
    assert.match(source, /from '@\/components\/outreach\/sequence\/sequenceGraph';/, name);
    assert.match(source, /\{stepTypeLabel\(step\.actionType\)\}/, name);
  }
  assert.equal((previewModal.match(/\{stepTypeLabel\(step\.actionType\)\}/g) ?? []).length, 3);
  assert.match(treeView, /const label = STEP_TYPE_LABELS\[step\.actionType\] \|\| 'Décision';/);
  // Anciens noms divergents de l'aperçu.
  for (const legacy of ['Attendre connexion', 'Attendre acceptation', 'Vérifier connexion']) {
    assert.ok(!previewModal.includes(legacy) && !treeView.includes(legacy), legacy);
  }
  assert.equal(graph.stepTypeLabel('wait_connection'), 'Attendre la connexion');
  assert.equal(graph.stepTypeLabel('connection_request'), 'Invitation LinkedIn');
});

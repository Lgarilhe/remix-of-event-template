/**
 * Refonte des séquences (lot 5), socle commun des pages Séquences.
 *
 * Lot 5c-1 (extraction pure) : les types d'une séquence vivent dans
 * src/types/sequence.ts ; seuls les fichiers voués au retrait du lot 5j les
 * lisent encore par le réexport de SequenceBuilder.tsx. Les actions de la
 * liste et du suivi (src/lib/sequenceActions.ts) reçoivent client, toast et
 * mises à jour d'état en paramètres.
 * Étendu au lot 5c-2.
 *
 * Lancer : node --test tests/ux/seq-v2-socle.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

function filesUnder(rel) {
  const dir = new URL(`../../${rel}/`, import.meta.url);
  return readdirSync(dir).flatMap((name) => {
    const child = `${rel}/${name}`;
    return statSync(new URL(name, dir)).isDirectory() ? filesUnder(child) : [child];
  });
}

/** Fichiers retirés au lot 5j qui lisent encore les types par le réexport. */
const RETIRED_TYPE_READERS = new Set([
  'src/components/outreach/sequence/StepEditor.tsx',
  'src/components/outreach/sequence/WorkflowCanvas.tsx',
  'src/components/outreach/sequence/nodes/WorkflowStepNode.tsx',
  'src/components/outreach/sequence/VisualSequenceEditor.tsx',
  'src/components/outreach/sequence/SequenceValidationChecklist.tsx',
]);
const TYPE_NAMES = ['SequenceStep', 'StopConditions', 'SenderAccountConfig', 'Sequence'];

test('5c-1 — les types d’une séquence sont définis une seule fois, dans src/types/sequence.ts', () => {
  const types = read('src/types/sequence.ts');
  for (const name of TYPE_NAMES) {
    assert.match(types, new RegExp(`export interface ${name} \\{`), `${name} absent de src/types/sequence.ts`);
  }
  const builder = read('src/components/outreach/SequenceBuilder.tsx');
  for (const name of TYPE_NAMES) {
    assert.doesNotMatch(builder, new RegExp(`interface ${name} \\{`), `${name} encore défini dans SequenceBuilder.tsx`);
  }
  // Réexport gardé jusqu'au lot 5j pour les fichiers voués au retrait.
  assert.match(builder, /export type \{ SequenceStep, StopConditions, SenderAccountConfig, Sequence \} from '@\/types\/sequence';/);
});

test('5c-1 — hors fichiers voués au retrait, aucun type ne vient plus de SequenceBuilder', () => {
  const importers = filesUnder('src')
    .filter((rel) => /\.(ts|tsx)$/.test(rel))
    .map((rel) => ({ rel, imports: [...read(rel).matchAll(/^import\b[^;]*?from ['"][^'"]*\/SequenceBuilder['"];?$/gm)].map((m) => m[0]) }))
    .filter(({ imports }) => imports.length > 0);
  assert.ok(importers.length > 0, 'aucun importeur trouvé : la recherche est cassée');
  // La liste, l'écran Séquences et la page d'une séquence (lot 5c-2) montent
  // encore l'éditeur actuel (jusqu'aux lots 5d-2 et 5h) : le composant seul.
  const editorMounts = {
    'src/components/outreach/SequencesList.tsx': "import { SequenceBuilder } from './SequenceBuilder';",
    'src/pages/SequencesPage.tsx': "import { SequenceBuilder } from '@/components/outreach/SequenceBuilder';",
    'src/pages/SequenceDetailPage.tsx': "import { SequenceBuilder } from '@/components/outreach/SequenceBuilder';",
  };
  for (const { rel, imports } of importers) {
    if (RETIRED_TYPE_READERS.has(rel)) continue;
    assert.ok(rel in editorMounts, `${rel} lit encore SequenceBuilder`);
    assert.deepEqual(imports, [editorMounts[rel]], `${rel} n’en importe que le composant`);
  }
});

test('5c-1 — les fichiers gardés lisent les types dans src/types/sequence.ts', () => {
  const expected = {
    'src/components/outreach/sequence/sequenceGraph.ts': /import type \{ Sequence, SequenceStep, StopConditions, SenderAccountConfig \} from '\.\.\/\.\.\/\.\.\/types\/sequence';/,
    'src/components/outreach/sequence/messageTypeUtils.ts': /import type \{ SequenceStep \} from '\.\.\/\.\.\/\.\.\/types\/sequence';/,
    'src/components/outreach/SequencesList.tsx': /import type \{ Sequence \} from '@\/types\/sequence';/,
    'src/components/outreach/SequenceTemplateSelector.tsx': /import type \{ Sequence, SequenceStep \} from '@\/types\/sequence';/,
    'src/lib/sequenceActions.ts': /import type \{ Sequence, StopConditions, SenderAccountConfig \} from '@\/types\/sequence';/,
    'src/hooks/useSequenceSave.ts': /import type \{ Sequence \} from '@\/types\/sequence';/,
  };
  for (const [rel, pattern] of Object.entries(expected)) assert.match(read(rel), pattern, rel);
});

test('5c-1 — actions de la liste et du suivi : client, toast et état passés en paramètres', () => {
  const actions = read('src/lib/sequenceActions.ts');
  // Aucun chargement du client, de sonner ni de l'appel serveur à l'exécution : types seulement.
  assert.match(actions, /^import type \{ toast as sonnerToast \} from 'sonner';$/m);
  assert.match(actions, /^import type \{ supabase as supabaseClient \} from '@\/integrations\/supabase\/client';$/m);
  assert.match(actions, /^import type \{ invokeEdgeFunction as invokeEdgeFunctionFn \} from '@\/lib\/invokeEdgeFunction';$/m);
  assert.doesNotMatch(actions, /^import \{[^}]*\} from '(sonner|@\/integrations\/supabase\/client|@\/lib\/invokeEdgeFunction)';$/m);
  assert.match(actions, /export function createSequenceListActions\(deps: SequenceListActionDeps\)/);
  assert.match(actions, /export function createEnrollmentActions\(deps: EnrollmentActionDeps\)/);
  // Les composants passent leur client et leur toast.
  const list = read('src/components/outreach/SequencesList.tsx');
  const panel = read('src/components/outreach/SequenceEnrollmentsPanel.tsx');
  assert.match(list, /\} = createSequenceListActions\(\{\s*supabase, invokeEdgeFunction, toast, navigate,/);
  assert.match(panel, /= createEnrollmentActions\(\{\s*supabase, invokeEdgeFunction, toast, sequenceId, nameOf,/);
  // L'enregistrement de l'éditeur passe par le hook partagé.
  assert.match(list, /const \{ handleSaveSequence \} = useSequenceSave\(\{/);
  assert.match(read('src/hooks/useSequenceSave.ts'), /supabase\.rpc\('save_sequence_steps', \{/);
});

test('5c-1 — « Enregistrer comme modèle » vit dans son propre fichier', () => {
  const modal = read('src/components/outreach/SaveAsTemplateModal.tsx');
  assert.match(modal, /export const SaveAsTemplateModal: React\.FC<SaveAsTemplateModalProps>/);
  assert.doesNotMatch(read('src/components/outreach/SequenceTemplateSelector.tsx'), /SaveAsTemplateModal/);
  assert.match(read('src/components/outreach/SequencesList.tsx'), /import \{ SaveAsTemplateModal \} from '\.\/SaveAsTemplateModal';/);
  // Catégories des modèles : une seule liste, lue par le modal et par le choix de modèle.
  assert.match(read('src/components/outreach/sequence/sequenceGraph.ts'), /export const TEMPLATE_CATEGORIES = \[/);
  assert.match(modal, /import \{ TEMPLATE_CATEGORIES \} from '\.\/sequence\/sequenceGraph';/);
  for (const rel of ['src/components/outreach/SaveAsTemplateModal.tsx', 'src/components/outreach/SequenceTemplateSelector.tsx']) {
    assert.doesNotMatch(read(rel), /const TEMPLATE_CATEGORIES =/, `${rel} redéfinit les catégories`);
  }
});

// ─── Lot 5c-2, partie 1 : interrupteur, routes, écran de l'organisation, accès ───

async function loadTs(t, rel) {
  try {
    return await import(`../../${rel}`);
  } catch (err) {
    if (err && err.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      t.skip('Node sans lecture native du TypeScript (22.18 ou plus requis)');
      return null;
    }
    throw err;
  }
}

/** Littéraux de chaîne et textes JSX, sans commentaires ni chemins d'import. */
const visibleStrings = (src) => {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    .replace(/\bfrom\s+(['"])[^'"\n]*\1/g, '')
    .replace(/\bimport\(\s*(['"])[^'"\n]*\1\s*\)/g, '')
    .replace(/\bconsole\.(?:log|warn|error|info|debug)\((?:[^()]|\([^()]*\))*\)/g, '');
  return [
    ...[...code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]),
    ...[...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]),
    ...[...code.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]),
    ...[...code.matchAll(/>([^<>{}=;]*[A-Za-zÀ-ÿ][^<>{}=;]*)(?=[<{])/g)].map((m) => m[1].trim()),
  ];
};

const SCREEN_FILES = [
  'src/lib/sequencesBeta.ts',
  'src/lib/sequenceTableStats.ts',
  'src/lib/sequenceStarterTemplates.ts',
  'src/lib/enrollmentStatusLine.ts',
  'src/lib/journalCursor.ts',
  'src/lib/sequenceFlow.ts',
  'src/lib/sequenceJourney.ts',
  'src/hooks/useSequencesBeta.ts',
  'src/hooks/useOrgSequences.ts',
  'src/hooks/useSequenceDetail.ts',
  'src/hooks/useSequenceEnrollments.ts',
  'src/pages/SequencesPage.tsx',
  'src/pages/SequenceDetailPage.tsx',
  ...filesUnder('src/components/sequences'),
];

test('5c-2 — interrupteur konekt.sequences-v2 éteint par défaut, lectures protégées', async (t) => {
  const beta = await loadTs(t, 'src/lib/sequencesBeta.ts');
  if (!beta) return;
  assert.equal(beta.SEQUENCES_BETA_STORAGE_KEY, 'konekt.sequences-v2');
  assert.equal(beta.SEQUENCES_BETA_PARAM, 'sequences-v2');
  assert.equal(beta.SEQUENCES_BETA_DEFAULT, false);
  const store = (value) => ({ getItem: () => value, setItem: () => {} });
  assert.equal(beta.readSequencesBeta(store(null)), false, 'jamais choisi : éteint');
  assert.equal(beta.readSequencesBeta(store('1')), true);
  assert.equal(beta.readSequencesBeta(store('0')), false);
  assert.equal(beta.readSequencesBeta(store('oui')), false);
  assert.equal(beta.readSequencesBeta(null), false, 'stockage absent');
  const throwing = { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('bloqué'); } };
  assert.equal(beta.readSequencesBeta(throwing), false, 'lecture qui lève : éteint, sans erreur');
  assert.equal(beta.writeSequencesBeta(true, throwing), false, 'écriture qui lève : false, sans erreur');
  const written = [];
  assert.equal(beta.writeSequencesBeta(true, { getItem: () => null, setItem: (k, v) => written.push([k, v]) }), true);
  assert.deepEqual(written, [['konekt.sequences-v2', '1']]);
  // Paramètre d'adresse.
  assert.equal(beta.sequencesBetaParam('?sequences-v2=1'), true);
  assert.equal(beta.sequencesBetaParam('?a=b&sequences-v2=0'), false);
  assert.equal(beta.sequencesBetaParam('?sequences-v2=2'), null);
  assert.equal(beta.sequencesBetaParam(''), null);
  assert.equal(beta.withoutSequencesBetaParam('?a=b&sequences-v2=1&c=d'), '?a=b&c=d');
  assert.equal(beta.withoutSequencesBetaParam('?sequences-v2=1'), '');
  // Magasin : défaut éteint, abonnés prévenus.
  beta.resetSequencesBetaForTests();
  let calls = 0;
  const off = beta.subscribeSequencesBeta(() => { calls += 1; });
  beta.setSequencesBeta(true);
  assert.equal(beta.getSequencesBeta(), true);
  beta.setSequencesBeta(true);
  assert.equal(calls, 1, 'même valeur : aucun rappel');
  off();
  beta.resetSequencesBetaForTests();
  // Adresses.
  assert.equal(beta.isSequencesPath('/sequences'), true);
  assert.equal(beta.isSequencesPath('/sequences/abc'), true);
  assert.equal(beta.isSequencesPath('/sequencesx'), false);
  assert.equal(beta.sequencePath('s1'), '/sequences/s1');
  assert.equal(beta.sequencePath('s1', 'm1'), '/sequences/s1?depuis=mission:m1');
  // Module pur : aucun import.
  assert.doesNotMatch(read('src/lib/sequencesBeta.ts'), /^import /m);
});

test('5c-2 — routes /sequences et /sequences/:id gardées par l’interrupteur, avant la mise en page', () => {
  const app = read('src/App.tsx');
  for (const [path, page] of [['/sequences', 'SequencesPage'], ['/sequences/:id', 'SequenceDetailPage']]) {
    const route = new RegExp(`<Route path="${path.replace(/[/:]/g, (c) => `\\${c}`)}" element=\\{<ProtectedRoute><OrganizationGuard><SequencesGate><AppLayout><${page} /></AppLayout></SequencesGate></OrganizationGuard></ProtectedRoute>\\} />`);
    assert.match(app, route, `route ${path}`);
    assert.match(app, new RegExp(`const ${page} = lazy\\(\\(\\) => import\\("\\./pages/${page}"\\)\\);`));
  }
  const gate = read('src/components/sequences/SequencesGate.tsx');
  assert.match(gate, /const on = requested \?\? stored;/);
  assert.match(gate, /if \(!on\) return <Navigate to=\{withPreviewAccessToken\(SEQUENCES_FALLBACK_PATH\)\} replace \/>;/);
  assert.match(read('src/lib/sequencesBeta.ts'), /export const SEQUENCES_FALLBACK_PATH = '\/missions';/);
  // ?sequences-v2= ailleurs dans l'application : la mise en page l'applique et le retire.
  assert.match(read('src/components/AppLayout.tsx'), /useSequencesBetaParamSync\(\);/);
  assert.match(read('src/hooks/useSequencesBeta.ts'), /if \(requested === null \|\| isSequencesPath\(pathname\)\) return;/);
});

test('5c-2 — accès (barre, palette, G puis S, raccourcis, liste) seulement interrupteur allumé', () => {
  const bottomRow = read('src/components/sidebar/SidebarBottomRow.tsx');
  assert.match(bottomRow, /const showSequences = useSequencesBeta\(\);/);
  assert.match(bottomRow, /\.\.\.\(showSequences \? \[\{ to: '\/sequences', label: 'Séquences', icon: Send \}\] : \[\]\)/);
  // Même <Link>, nom accessible, page courante et infobulle que ses voisines.
  assert.match(bottomRow, /aria-label=\{name\}/);
  assert.match(bottomRow, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(bottomRow, /<TooltipContent side=\{tooltipSide\}>\{name\}<\/TooltipContent>/);

  const palette = read('src/components/layout/NavigationPalette.tsx');
  assert.match(palette, /const showSequences = useSequencesBeta\(\);/);
  assert.match(palette, /\{showSequences && \(\s*<CommandItem onSelect=\{\(\) => go\('\/sequences'\)\}>[\s\S]*?Séquences\s*<CommandShortcut>G S<\/CommandShortcut>/);

  const go = read('src/components/layout/GoShortcuts.tsx');
  assert.match(go, /s: '\/sequences',/);
  assert.match(go, /if \(path && \(!isSequencesPath\(path\) \|\| getSequencesBeta\(\)\)\) \{/, 'G puis S inerte drapeau éteint');

  const dialog = read('src/components/sidebar/KeyboardShortcutsDialog.tsx');
  assert.match(dialog, /const G_SEQUENCES = \{ keys: 'G puis S', label: 'Séquences' \} as const;/);
  assert.match(dialog, /\.\.\.\(showSequences \? \[G_SEQUENCES\] : \[\]\),/);

  const list = read('src/components/outreach/SequencesList.tsx');
  assert.match(list, /const sequencesBeta = useSequencesBeta\(\);/);
  assert.match(list, /\{sequencesBeta \? \(\s*<Link\s+to=\{sequencePath\(seq\.id, projectId\)\}/);
  // Drapeau éteint : le nom reste le texte d'avant.
  assert.match(list, /\) : \(\s*<p className="min-w-0 break-words text-sm font-medium text-foreground">\{seq\.name\}<\/p>\s*\)\}/);
  assert.match(list, /\{sequencesBeta && \(\s*<Link\s+to=\{SEQUENCES_PATH\}[\s\S]*?Toutes les séquences de l'organisation/);
});

test('5c-2 — écran Séquences : onglets, en-tête, un seul bouton plein, « Supprimer » derrière une confirmation', () => {
  const page = read('src/pages/SequencesPage.tsx');
  for (const label of ["'Toutes'", "'À venir'", "'Modèles'", "'Statistiques'"]) assert.ok(page.includes(label), `onglet ${label}`);
  assert.equal((page.match(/variant="primary"/g) || []).length, 1, 'un seul bouton plein');
  assert.match(page, /variant="primary"[\s\S]{0,200}?<Plus aria-hidden="true" \/>\s*Créer une séquence/);
  assert.match(page, /\{nudging \? 'En cours…' : 'Envoyer les actions du jour'\}/);
  assert.match(page, /<AlertDialogTitle>Envoyer maintenant les actions du jour \?<\/AlertDialogTitle>/);
  assert.match(page, /missionSequenceIds: nudgeSequenceIds/);
  assert.match(page, /const nudgeSequenceIds = sequences\.filter\(\(s\) => canManage\(s\) && s\.is_active\)\.map\(\(s\) => s\.id\);/);
  assert.match(page, /<AlertDialogTitle>Supprimer cette séquence \?<\/AlertDialogTitle>/);
  assert.match(page, /onDelete=\{\(\) => setDeleteConfirmId\(seq\.id\)\}/);
  assert.match(page, /<AlertDialogTitle>Réactiver cette séquence \?<\/AlertDialogTitle>/);
  // Onglets : Statistiques et À venir réutilisent les composants actuels, dans la page.
  assert.match(page, /<SequenceAnalytics isOpen=\{false\} onClose=\{\(\) => undefined\} embedded \/>/);
  assert.match(page, /<SequenceActivityLog isOpen=\{false\} onClose=\{\(\) => undefined\} embedded defaultPeriod="upcoming" \/>/);
  assert.match(page, /<TemplatesGallery onUse=/);
  // Copie depuis l'écran de l'organisation : la mission de l'originale ; depuis une mission : cette mission.
  assert.match(read('src/lib/sequenceActions.ts'), /\.\.\.\(projectId \? \{ project_id: projectId \} : seq\.project_id \? \{ project_id: seq\.project_id \} : \{\}\),/);
  // Compteur d'onglet : jamais de zéro.
  assert.match(page, /\{value === 'toutes' && count > 0 && \(/);
  // États (spécification, section 4).
  for (const text of [
    'Séquences indisponibles pour l’instant.',
    'Aucune séquence pour l’instant.',
    'Une séquence contacte vos candidats en plusieurs étapes LinkedIn et s’arrête dès qu’ils répondent. Elle se crée le plus souvent depuis une mission.',
    'Aucune séquence ne correspond à ces filtres.',
    'Effacer les filtres',
    'Voir les modèles',
    'Un taux s’affiche à partir de 5 candidats contactés.',
  ]) assert.ok(page.includes(text), `texte absent : ${text}`);
  // Composants existants rendus utilisables dans une page, défaut inchangé.
  for (const rel of ['src/components/outreach/SequenceAnalytics.tsx', 'src/components/outreach/SequenceActivityLog.tsx']) {
    const src = read(rel);
    assert.match(src, /embedded = false,/, `${rel} : panneau par défaut`);
    assert.match(src, /if \(isOpen \|\| embedded\)/, `${rel} : chargé dans la page`);
    assert.match(src, /<Sheet open=\{isOpen\}/, `${rel} : panneau gardé`);
  }
});

test('5c-2 — ligne du tableau : interrupteur de 5b, barre, alertes, taux, menu révélé au survol', () => {
  const row = read('src/components/sequences/SequenceRow.tsx');
  assert.match(row, /aria-label=\{seq\.is_active \? `Mettre en pause la séquence \$\{seq\.name\}` : `Réactiver la séquence \$\{seq\.name\}`\}/);
  assert.match(row, /onCheckedChange=\{onToggle\}/);
  assert.match(read('src/pages/SequencesPage.tsx'), /onToggle=\{\(\) => \{ void requestToggle\(seq\); \}\}/);
  assert.match(row, /<EnrollmentProgressBar segments=\{segments\} \/>/);
  assert.match(row, /<SenderAvatars names=\{senders\} \/>/);
  assert.match(row, /className=\{cn\(REVEAL_ON_ROW,/, 'menu « ... » révélé au survol, au focus et au toucher');
  assert.match(row, /aria-label=\{`Actions de la séquence \$\{seq\.name\}`\}/);
  assert.match(row, /Pas encore assez de candidats contactés \(moins de 5\)\./);
  const table = read('src/components/sequences/SequencesTable.tsx');
  assert.match(table, /<caption className="sr-only">/);
  assert.match(table, /Invitations acceptées sur invitations envoyées\./);
  assert.match(table, /Candidats qui ont répondu sur candidats contactés\./);
});

test('5c-2 — chiffres du tableau : taux à partir de 5 contactés, aucune part à zéro, une alerte par cause', async (t) => {
  const stats = await loadTs(t, 'src/lib/sequenceTableStats.ts');
  if (!stats) return;
  const counts = stats.aggregateEnrollmentCounts([
    { sequence_id: 'a', status: 'active', pause_reason: null, count: 6 },
    { sequence_id: 'a', status: 'replied', pause_reason: null, count: '6' },
    { sequence_id: 'a', status: 'paused', pause_reason: 'manual', count: 1 },
    { sequence_id: 'a', status: 'paused', pause_reason: 'send_failed', count: 1 },
    { sequence_id: 'a', status: 'completed', pause_reason: null, count: 9 },
    { sequence_id: 'a', status: 'stopped', pause_reason: null, count: 1 },
    { sequence_id: 'b', status: 'paused', pause_reason: null, count: 2 },
  ]);
  const a = counts.get('a');
  assert.deepEqual({ total: a.total, active: a.active, replied: a.replied, paused: a.paused, completed: a.completed }, { total: 24, active: 6, replied: 6, paused: 2, completed: 9 });
  assert.deepEqual(counts.get('b').pausedByReason, { manual: 2 }, 'pause sans raison : manuelle');
  const seg = stats.progressSegments(a);
  assert.deepEqual(seg, { active: 6, replied: 6, paused: 1, failed: 1, done: 10, total: 24 });
  assert.equal(stats.progressLabel(seg), '6 en cours, 6 ont répondu, 1 en pause, 1 en échec, 10 terminées');
  assert.equal(stats.progressLabel({ active: 0, replied: 1, paused: 0, failed: 0, done: 0, total: 1 }), '1 a répondu', 'aucune part à zéro');

  // Taux : à partir de 5 contactés ; acceptation sur invitations envoyées.
  assert.deepEqual(stats.sequenceRates({ replied: 1, contacted: 4, invitesSent: 4, invitesAccepted: 2 }), { contacted: 4, acceptRate: null, replyRate: null });
  assert.deepEqual(stats.sequenceRates({ replied: 6, contacted: 23, invitesSent: 20, invitesAccepted: 10 }), { contacted: 23, acceptRate: 50, replyRate: 26 });
  assert.equal(stats.sequenceRates({ replied: 2, contacted: 5, invitesSent: 0, invitesAccepted: 0 }).acceptRate, null, 'sans invitation : pas de taux');
  assert.equal(stats.sequenceRates({ replied: 5, contacted: 0, invitesSent: 0, invitesAccepted: 0 }).contacted, 5, 'qui a répondu a été contacté');

  const invites = stats.aggregateInvites([
    { sequence_id: 'a', invites_sent: 3, invites_accepted: 1 },
    { sequence_id: 'a', invites_sent: null, invites_accepted: 2 },
    { sequence_id: null, invites_sent: 9, invites_accepted: 9 },
  ]);
  assert.deepEqual(invites.get('a'), { sent: 3, accepted: 3 });
  assert.equal(invites.size, 1);
  const contacts = stats.aggregateContacts([
    { sequence_id: 'a', created_by: 'u1', status: 'active', sent: [{ id: 'x' }] },
    { sequence_id: 'a', created_by: 'u2', status: 'replied', sent: [] },
    { sequence_id: 'a', created_by: 'u1', status: 'active', sent: [] },
  ]);
  assert.deepEqual(contacts.get('a'), { contacted: 2, enrollers: ['u1', 'u2'] });

  assert.deepEqual(stats.sequenceAlerts({ pausedByReason: {} }), [], 'rien de bloqué : aucune alerte');
  const alerts = stats.sequenceAlerts({ pausedByReason: { send_failed: 1, auto_paused: 2, account_disconnected: 3, subscription_required: 1, manual: 4 } });
  assert.deepEqual(alerts.map((x) => [x.text, x.actionLabel]), [
    ['1 en échec', 'Voir les erreurs'],
    ['2 candidats en pause : trop d’échecs d’envoi', 'Voir les erreurs'],
    ['3 candidats en pause : compte LinkedIn déconnecté', 'Reconnecter'],
    ['1 candidat en pause : abonnement requis', 'Voir les offres'],
  ]);
  assert.equal(stats.isDraftSequence({ total: 0 }), true);
  assert.equal(stats.isDraftSequence({ total: 1 }), false);
});

test('5c-2 — modèles Konekt livrés dans le code : cinq déroulés valides, la séquence longue déplacée', async (t) => {
  const starters = await loadTs(t, 'src/lib/sequenceStarterTemplates.ts');
  const graph = await loadTs(t, 'src/components/outreach/sequence/sequenceGraph.ts');
  if (!starters || !graph) return;
  assert.deepEqual(starters.STARTER_TEMPLATES.map((x) => x.name), [
    'Invitation puis message',
    'Vérifier la connexion d’abord',
    'Invitation, message, relance',
    'InMail si l’invitation n’est pas acceptée',
    'Séquence longue (17 étapes)',
  ]);
  for (const template of starters.STARTER_TEMPLATES) {
    const sequence = starters.starterTemplateToSequence(template);
    const { errors } = graph.validateSequence({ ...sequence, multiSenderEnabled: false, senderAccounts: [] });
    assert.deepEqual(errors, [], `${template.name} : ${errors.map((e) => e.message).join(' ; ')}`);
    // Identifiants neufs à chaque utilisation.
    assert.notEqual(template.build()[0].id, template.build()[0].id);
    for (const step of sequence.steps) {
      for (const text of [step.messageTemplate ?? '', step.subjectTemplate ?? '']) {
        assert.doesNotMatch(text, /—/, `${template.name} : tiret long`);
        for (const key of text.match(/\{\{\s*([a-z_]+)\s*\}\}/g) ?? []) {
          assert.ok(['{{prenom}}', '{{poste_recherche}}', '{{mon_prenom}}'].includes(key), `${template.name} : variable ${key}`);
        }
      }
      if (step.actionType === 'connection_request') assert.ok((step.messageTemplate ?? '').length <= 300, 'note d’invitation de 300 caractères au plus');
    }
  }
  assert.equal(starters.generateRecommendedSequence().length, 17);
  const builder = read('src/components/outreach/SequenceBuilder.tsx');
  assert.doesNotMatch(builder, /const generateRecommendedSequence = /, 'définie une seule fois');
  assert.match(builder, /import \{ generateRecommendedSequence \} from '@\/lib\/sequenceStarterTemplates';/);

  // Modèle de l'organisation : identifiants neufs, renvois traduits, renvoi inconnu retiré.
  const seq = starters.templateRowToSequence({
    id: 't', name: 'Relance vivier', description: null, category: null, is_system: false, created_at: '',
    steps_config: [
      { id: 'a', step_order: 0, action_type: 'connection_request', message_template: 'Bonjour', next_step_id: 'b' },
      { id: 'b', step_order: 1, action_type: 'wait_connection', timeout_branch_step_id: 'c', next_step_id: 'zz' },
      { id: 'c', step_order: 2, action_type: 'inmail', ends_sequence: true },
    ],
  });
  const [s1, s2, s3] = seq.steps;
  assert.ok(![s1.id, s2.id, s3.id].includes('a'));
  assert.equal(s1.nextStepId, s2.id);
  assert.equal(s2.timeoutBranchStepId, s3.id);
  assert.equal(s2.timeoutAction, 'alternative_step');
  assert.equal(s2.nextStepId, undefined, 'renvoi inconnu retiré');
  assert.equal(s3.nextStepId, '__end__');
  assert.deepEqual(seq.steps.map((s) => s.order), [0, 1, 2]);
});

test('5c-2 — écran et pages : aucune écriture d’exécution ni de reprise, aucun nom de prestataire, aucun tiret long', () => {
  for (const rel of SCREEN_FILES) {
    const src = read(rel);
    assert.doesNotMatch(src, /from\(['"]sequence_step_executions['"]\)\s*\.(insert|update|upsert|delete)/, `${rel} : écriture d’exécution`);
    assert.doesNotMatch(src, /status:\s*['"]active['"]/, `${rel} : reprise écrite depuis le navigateur`);
    assert.doesNotMatch(src, /\bany\b(?=[\s>,;)\]])/, `${rel} : any`);
    const texts = visibleStrings(src).join('\n');
    assert.doesNotMatch(texts, /\b(?:Unipile|Apollo|People Data Labs|PDL|Anthropic|Claude|Notion)\b/, `${rel} : nom de prestataire`);
    assert.doesNotMatch(texts, /—/, `${rel} : tiret long`);
    assert.doesNotMatch(src, /window\.confirm/, `${rel} : confirmation native`);
  }
});

// ─── Lot 5c-2, partie 2 : page d'une séquence (/sequences/:id) ───

const NB = ' ';

test('5c-2 — enrollmentStatusLine : une ligne par statut de la spécification (3.1), arrêt manuel et message à relire', async (t) => {
  const m = await loadTs(t, 'src/lib/enrollmentStatusLine.ts');
  if (!m) return;
  const now = new Date(2026, 8, 29, 10, 0);
  const at = (d, h, mi = 0) => new Date(2026, 8, d, h, mi).toISOString();
  const ctx = { now, memberName: (id) => (id === 'u1' ? 'Guillaume Martin' : null), sequenceActive: true, canManageSequence: true, isAccountHolder: true, hasNextStep: true };
  const line = (enrollment, extra = {}) => m.enrollmentStatusLine(enrollment, { ...ctx, ...extra });
  const pick = (l) => [l.chip, l.label, l.action?.kind ?? null, l.action?.label ?? null];

  // active, scheduled : « En cours », « Mettre en pause », prochaine action en clair.
  const running = line({ status: 'active', executions: [{ status: 'scheduled', scheduled_at: at(29, 14, 20), step: { action_type: 'message' } }] });
  assert.deepEqual(pick(running), ['en-cours', 'En cours', 'pause', 'Mettre en pause']);
  assert.equal(running.next, `Message LinkedIn aujourd’hui à 14${NB}h${NB}20`);
  assert.equal(line({ status: 'active', executions: [{ status: 'scheduled', scheduled_at: at(30, 9), step: { action_type: 'wait_reply' } }] }).next, `Demain à 9${NB}h`);
  // active, waiting_event : jusqu'à la fin du délai de l'attente.
  assert.deepEqual(pick(line({ status: 'active', executions: [{ status: 'waiting_event', scheduled_at: at(25, 9), step: { action_type: 'wait_connection', timeout_days: 7 } }] })),
    ['en-cours', 'En attente de l’acceptation, jusqu’au 02/10', 'pause', 'Mettre en pause']);
  // active, quota_blocked : reporté, aucune action.
  assert.deepEqual(pick(line({ status: 'active', executions: [{ status: 'quota_blocked', scheduled_at: at(30, 9), step: { action_type: 'connection_request' } }] })),
    ['en-cours', 'Reporté : plafond d’invitations de la semaine atteint', null, null]);
  // Lot 5a-2 : étape rédigée par l'IA reportée faute de relecture.
  const review = line({ status: 'active', executions: [{ status: 'scheduled', scheduled_at: at(30, 9), error_message: "Message rédigé par l'IA à relire avant l'envoi.", final_message: null, step: { action_type: 'message' } }] });
  assert.deepEqual(pick(review), ['en-cours', 'Message rédigé par l’IA à relire', 'review', 'Relire le message']);
  assert.equal(review.tone, 'warning');
  // Relu (final_message écrit) : de nouveau « En cours ».
  assert.equal(line({ status: 'active', executions: [{ status: 'scheduled', scheduled_at: at(30, 9), error_message: "Message rédigé par l'IA à relire avant l'envoi.", final_message: 'Bonjour', step: { action_type: 'message' } }] }).label, 'En cours');

  // paused, par raison.
  // Pause manuelle : auteur et date non enregistrés (écart à la spécification
  // acté dans le plan, 5c-2) ; updated_at, réécrit à chaque écriture, ne la date pas.
  assert.deepEqual(pick(line({ status: 'paused', pause_reason: 'manual', updated_at: at(25, 9) })), ['en-pause', 'En pause', 'resume', 'Reprendre la séquence']);
  assert.deepEqual(pick(line({ status: 'paused', pause_reason: 'account_disconnected' })), ['en-pause', 'En pause : compte LinkedIn déconnecté', 'reconnect', 'Reconnecter le compte']);
  assert.equal(line({ status: 'paused', pause_reason: 'account_disconnected' }, { isAccountHolder: false }).action, null, 'seul le titulaire reconnecte');
  assert.deepEqual(pick(line({ status: 'paused', pause_reason: 'subscription_required' })), ['en-pause', 'En pause : abonnement requis', 'pricing', 'Voir les offres']);
  assert.deepEqual(pick(line({ status: 'paused', pause_reason: 'sequence_inactive' }, { sequenceActive: false })), ['en-pause', 'En pause avec la séquence', 'reactivate', 'Réactiver la séquence']);
  assert.equal(line({ status: 'paused', pause_reason: 'sequence_inactive' }, { sequenceActive: false, canManageSequence: false }).action, null);
  assert.equal(line({ status: 'paused', pause_reason: 'sequence_inactive' }).action.kind, 'resume', 'séquence de nouveau active : reprise du candidat');
  assert.deepEqual(pick(line({ status: 'paused', pause_reason: 'auto_paused' })), ['en-echec', 'En pause : trop d’échecs d’envoi', 'show_error', 'Voir l’erreur']);
  const failed = line({ status: 'paused', pause_reason: 'send_failed', executions: [{ status: 'failed', scheduled_at: at(28, 9), error_message: 'Profil introuvable' }] });
  assert.deepEqual(pick(failed), ['en-echec', 'En échec : profil introuvable', 'retry', 'Réessayer l’étape en échec']);
  assert.equal(failed.tone, 'danger');
  assert.deepEqual(pick(line({ status: 'paused', pause_reason: 'quota_reached' })), ['en-pause', 'En pause : limite d’envoi atteinte', null, null]);
  assert.deepEqual(pick(line({ status: 'paused', pause_reason: 'blocked_by_candidate' })), ['en-pause', 'En pause : candidat injoignable', 'stop', 'Arrêter pour ce candidat']);

  // Clôtures.
  assert.deepEqual(pick(line({ status: 'replied', replied_at: at(28, 10) })), ['a-repondu', 'A répondu le 28/09', 'conversation', 'Voir la conversation']);
  assert.deepEqual(pick(line({ status: 'completed', completed_at: at(21, 10) })), ['terminees', 'Terminée le 21/09, sans réponse', 'relaunch', 'Relancer depuis l’étape suivante']);
  assert.equal(line({ status: 'completed', completed_at: at(21, 10) }, { hasNextStep: false }).action, null, 'aucune suite : aucune relance');
  // Rendez-vous pris (calendly-webhook, condition d'arrêt du moteur) : but atteint, jamais « sans réponse » ni relance.
  const meeting = line({
    status: 'completed',
    completed_at: at(21, 10),
    tracking_data: { completion_reason: 'meeting_booked', meeting_booked_at: at(21, 10) },
    executions: [
      { status: 'sent', step_order: 0, scheduled_at: at(19, 9), step: { action_type: 'message' } },
      { status: 'cancelled', step_order: 2, scheduled_at: at(23, 9), skip_reason: 'Stop condition: meeting booked', step: { action_type: 'message' } },
    ],
  });
  assert.deepEqual(pick(meeting), ['terminees', 'Terminée le 21/09 : rendez-vous pris', null, null]);
  assert.equal(m.isMeetingBookedCompletion('completed', { completion_reason: 'meeting_booked' }), true);
  assert.equal(m.isMeetingBookedCompletion('completed', { completion_reason: 'manual_stop' }), false);
  // Lot 5b : arrêt manuel, clos en completed avec la trace manual_stop.
  assert.deepEqual(pick(line({ status: 'completed', tracking_data: { completion_reason: 'manual_stop', manual_stop: { by: 'u1', at: at(29, 9) } } })),
    ['terminees', 'Arrêtée par Guillaume Martin le 29/09', null, null]);
  assert.deepEqual(pick(line({ status: 'stopped', executions: [{ status: 'cancelled', scheduled_at: at(29, 9), skip_reason: "Le candidat a répondu sur un autre compte de l'organisation" }] })),
    ['terminees', 'Arrêtée : a répondu dans une autre séquence', 'conversation', 'Voir la conversation']);
  assert.deepEqual(pick(line({ status: 'cancelled' })), ['terminees', 'Annulée', null, null]);
  assert.deepEqual(pick(line({ status: 'bounced' })), ['terminees', 'Non distribuée', null, null]);
  // Effacement RGPD : jamais repris.
  assert.deepEqual(pick(line({ status: 'paused', pause_reason: 'send_failed', tracking_data: { gdpr_erased_at: '2026-09-01' } })).slice(1), ['Données effacées à la demande du candidat', null, null]);
  assert.equal(line({ status: 'completed', executions: [{ status: 'cancelled', scheduled_at: at(29, 9), skip_reason: 'Effacement des données demandé : séquence arrêtée' }] }).action, null);

  // Relance d'une inscription terminée : une étape visible après la dernière faite, sur le graphe.
  const steps = [{ id: 's0', step_order: 0, action_type: 'message' }, { id: 's1', step_order: 1, action_type: 'wait_reply' }, { id: 's2', step_order: 2, action_type: 'message' }];
  assert.equal(m.hasVisibleStepAfterLastDone([{ status: 'sent', step_order: 0, step_id: 's0' }], steps), true);
  assert.equal(m.hasVisibleStepAfterLastDone([{ status: 'sent', step_order: 2, step_id: 's2' }], steps), false);
  assert.equal(m.hasVisibleStepAfterLastDone([{ status: 'sent', step_order: 0, step_id: 's0' }], [{ id: 's0', step_order: 0, action_type: 'message', ends_sequence: true }, ...steps.slice(1)]), false, 'fin de séquence après l’étape faite');
  // Séquence à branches de la maquette : la relance (ordre 3) finit la séquence, l'invitation (ordre 4) est sur l'autre branche.
  const branched = [
    { id: 'visit', step_order: 0, action_type: 'profile_visit' },
    { id: 'check', step_order: 1, action_type: 'check_connection', if_true_goto_step: 'msg', if_false_goto_step: 'invite' },
    { id: 'msg', step_order: 2, action_type: 'message', variant_group: 'A', next_step_id: 'relance' },
    { id: 'relance', step_order: 3, action_type: 'message', ends_sequence: true },
    { id: 'invite', step_order: 4, action_type: 'connection_request', next_step_id: 'wait' },
    { id: 'wait', step_order: 5, action_type: 'wait_connection', timeout_days: 10, timeout_branch_step_id: 'inmail', next_step_id: 'relance' },
    { id: 'inmail', step_order: 6, action_type: 'inmail', ends_sequence: true },
  ];
  assert.equal(m.hasVisibleStepAfterLastDone([{ status: 'sent', step_order: 2, step_id: 'msg' }, { status: 'sent', step_order: 3, step_id: 'relance' }], branched), false, 'branche terminée : aucune suite');
  assert.equal(m.hasVisibleStepAfterLastDone([{ status: 'sent', step_order: 6, step_id: 'inmail' }], branched), false);
  assert.equal(m.hasVisibleStepAfterLastDone([{ status: 'sent', step_order: 1, step_id: 'check' }], branched), true, 'fourche : une branche mène à un message');
  assert.equal(m.hasVisibleStepAfterLastDone([{ status: 'sent', step_order: 5, step_id: 'wait' }], branched), true, 'attente : relance ou InMail');
  // Plafond : une seule forme, selon le type d'étape.
  assert.equal(m.quotaBlockedLabel('connection_request'), 'Reporté : plafond d’invitations de la semaine atteint');
  assert.equal(m.quotaBlockedLabel('message'), 'Reporté : plafond LinkedIn du jour atteint');

  // Puces : comptes de toute la séquence, échecs à part, pause sans raison = manuelle.
  const counts = m.enrollmentChipCounts({ total: 24, active: 6, replied: 6, paused: 2, pausedByReason: { manual: 1, send_failed: 1 } });
  assert.deepEqual(counts, { tous: 24, 'en-cours': 6, 'a-repondu': 6, 'en-pause': 1, 'en-echec': 1, terminees: 10 });
  assert.deepEqual(m.chipFilter('en-pause'), { statuses: ['paused'], pauseReasonsNotIn: ['send_failed', 'auto_paused'] });
  assert.deepEqual(m.chipFilter('en-echec'), { statuses: ['paused'], pauseReasonsIn: ['send_failed', 'auto_paused'] });
  assert.deepEqual(m.chipFilter('terminees'), { statuses: ['completed', 'stopped', 'cancelled', 'bounced'] });
  assert.equal(m.parseEnrollmentChip('en-echec'), 'en-echec');
  assert.equal(m.parseEnrollmentChip('autre'), 'tous');
  assert.equal(m.emptyChipText('en-echec'), 'Aucun candidat en échec.');
  assert.equal(m.emptyChipText('tous'), 'Aucun candidat inscrit.');
});

test('5c-2 — Journal d’une séquence : curseur sur (scheduled_at, id), sans perte ni doublon', async (t) => {
  const c = await loadTs(t, 'src/lib/journalCursor.ts');
  if (!c) return;
  assert.equal(c.JOURNAL_PAGE_SIZE, 100);
  assert.equal(
    c.journalCursorFilter({ scheduled_at: '2026-10-05T10:00:00.123+00:00', id: 'b2' }),
    'scheduled_at.lt."2026-10-05T10:00:00.123+00:00",and(scheduled_at.eq."2026-10-05T10:00:00.123+00:00",id.lt."b2")',
  );
  const page = Array.from({ length: 100 }, (_, i) => ({ scheduled_at: `t${i}`, id: `e${i}` }));
  assert.deepEqual(c.nextJournalCursor(page), { scheduled_at: 't99', id: 'e99' });
  assert.equal(c.nextJournalCursor(page.slice(0, 99)), null, 'page incomplète : fin du journal');

  // Simulation : 600 lignes, dix dates seulement ; les pages se suivent sans perte ni doublon.
  const rows = Array.from({ length: 600 }, (_, i) => ({ scheduled_at: `2026-10-0${i % 10}`, id: `id-${String(i).padStart(4, '0')}` }))
    .sort((a, b) => (b.scheduled_at.localeCompare(a.scheduled_at)) || b.id.localeCompare(a.id));
  const after = (cur) => rows.filter((r) => r.scheduled_at < cur.scheduled_at || (r.scheduled_at === cur.scheduled_at && r.id < cur.id));
  const seen = [];
  let cursor = null;
  for (let guard = 0; guard < 10; guard += 1) {
    const slice = (cursor ? after(cursor) : rows).slice(0, c.JOURNAL_PAGE_SIZE);
    seen.push(...slice);
    cursor = c.nextJournalCursor(slice);
    if (!cursor) break;
  }
  assert.equal(seen.length, 600);
  assert.equal(new Set(seen.map((r) => r.id)).size, 600);
  // « À venir » : ordre croissant, la page suivante prend les lignes après le curseur.
  assert.equal(
    c.journalCursorFilter({ scheduled_at: '2026-10-05T10:00:00+00:00', id: 'b2' }, true),
    'scheduled_at.gt."2026-10-05T10:00:00+00:00",and(scheduled_at.eq."2026-10-05T10:00:00+00:00",id.gt."b2")',
  );
  const log = read('src/components/outreach/SequenceActivityLog.tsx');
  // Dans une page (Journal d'une séquence ou « À venir » de l'écran Séquences) : curseur, jamais la limite de 500.
  assert.match(log, /const paginated = embedded \|\| !!sequenceId;/);
  assert.match(log, /const ascending = paginated && periodFilter === 'upcoming';/);
  assert.match(log, /\.order\('scheduled_at', \{ ascending \}\);/);
  assert.match(log, /query = query\.order\('id', \{ ascending \}\);\s*if \(sequenceId\) query = query\.eq\('sequence_enrollments\.sequence_id', sequenceId\);/);
  assert.match(log, /if \(after\) query = query\.or\(journalCursorFilter\(after, ascending\)\);/);
  // Recherche du candidat dans la requête : elle porte sur toutes les pages, pas sur les lignes déjà lues.
  assert.match(log, /if \(serverSearch\) query = query\.ilike\('sequence_enrollments\.profile_name', `%\$\{serverSearch\}%`\);/);
  assert.match(log, /if \(searchQuery && !paginated\) \{/);
  // Panneau : la limite de 500 reste, aucune lecture relancée par les filtres.
  assert.match(log, /query = query\.limit\(JOURNAL_LIMIT\);/);
  assert.match(log, /const serverStatus: FilterStatus = paginated \? statusFilter : 'all';/);
  assert.match(read('src/pages/SequencesPage.tsx'), /<SequenceActivityLog isOpen=\{false\} onClose=\{\(\) => undefined\} embedded defaultPeriod="upcoming" \/>/);

  // Onglet « Candidats » : curseur sur (created_at, id). Une ligne qui sort du
  // filtre entre deux pages (pause) ne fait sauter personne, contrairement au décalage.
  assert.equal(
    c.enrollmentCursorFilter({ created_at: '2026-10-05T10:00:00+00:00', id: 'e9' }),
    'created_at.lt."2026-10-05T10:00:00+00:00",and(created_at.eq."2026-10-05T10:00:00+00:00",id.lt."e9")',
  );
  const all = Array.from({ length: 130 }, (_, i) => ({ created_at: `2026-09-${String(30 - Math.floor(i / 10)).padStart(2, '0')}`, id: `e${String(999 - i).padStart(3, '0')}`, status: 'active' }));
  const activeAfter = (cur) => all.filter((r) => r.status === 'active' && (!cur || r.created_at < cur.created_at || (r.created_at === cur.created_at && r.id < cur.id)));
  const first = activeAfter(null).slice(0, 100);
  all[3].status = 'paused';
  const second = activeAfter(c.nextEnrollmentCursor(first, 100)).slice(0, 100);
  assert.equal(second.length, 30, 'les 30 suivants, aucun sauté');
  assert.equal(new Set([...first, ...second].map((r) => r.id)).size, 130);
  const hook = read('src/hooks/useSequenceEnrollments.ts');
  assert.match(hook, /if \(after\) query = query\.or\(enrollmentCursorFilter\(after\)\);/);
  assert.doesNotMatch(hook, /\.range\(offset/, 'plus de page par décalage');
});

test('5c-2 — onglet Étapes : fil en lecture fidèle au moteur (fourches, A/B, délais, fin, étape rejointe)', async (t) => {
  const f = await loadTs(t, 'src/lib/sequenceFlow.ts');
  if (!f) return;
  const flow = f.buildSequenceFlow([
    { id: 'a', step_order: 0, action_type: 'profile_visit' },
    { id: 'b', step_order: 1, action_type: 'check_connection', delay_days: 1, if_true_goto_step: 'c', if_false_goto_step: 'e' },
    { id: 'c', step_order: 2, action_type: 'message', variant_group: 'A', next_step_id: 'd', message_template: 'Bonjour {{prenom}}, chez {{entreprise_actuelle | fallback:"votre entreprise"}}' },
    { id: 'c2', step_order: 2, action_type: 'message', variant_group: 'B', next_step_id: 'd', message_template: 'Version B' },
    { id: 'd', step_order: 3, action_type: 'message', delay_days: 5, ends_sequence: true, message_template: 'Relance' },
    { id: 'e', step_order: 4, action_type: 'connection_request', next_step_id: 'f', message_template: 'Note' },
    { id: 'f', step_order: 5, action_type: 'wait_connection', timeout_days: 10, timeout_branch_step_id: 'h', next_step_id: 'g' },
    { id: 'g', step_order: 6, action_type: 'message', next_step_id: 'd', message_template: 'Merci' },
    { id: 'h', step_order: 7, action_type: 'inmail', ends_sequence: true, message_template: 'InMail' },
  ]);
  assert.equal(flow.start, 'Dès l’inscription, au premier créneau');
  assert.equal(flow.stepCount, 8, 'versions A/B comptées une fois');
  const [visit, check] = flow.nodes;
  assert.equal(visit.title, 'Visite de profil');
  assert.equal(check.kind, 'fork');
  assert.equal(check.delay, 'Attendre 1 jour');
  assert.deepEqual(check.branches.map((b) => b.label), ['Connecté (1er degré)', 'Non connecté']);
  const [msg, relance, end] = check.branches[0].nodes;
  assert.equal(msg.excerpt, 'Bonjour [Prénom], chez [Entreprise actuelle]');
  assert.deepEqual(msg.badges, ['A/B · 2 versions']);
  assert.equal(relance.delay, 'Attendre 5 jours');
  assert.equal(end.kind, 'end');
  const [invite, wait] = check.branches[1].nodes;
  assert.deepEqual(invite.badges, ['avec note']);
  assert.deepEqual(wait.branches.map((b) => b.label), ['Acceptée', 'Pas acceptée après 10 jours']);
  assert.deepEqual(wait.branches[0].nodes.map((n) => n.kind), ['step', 'join'], 'étape déjà dessinée : rejointe, pas répétée');
  assert.equal(wait.branches[0].nodes[1].number, 4);
  assert.deepEqual(f.buildSequenceFlow([]).nodes, []);
  assert.equal(f.delayLabel({ delayDays: 2, delayHours: 4, delayMinutes: 0 }), 'Attendre 2 jours et 4 heures');
  assert.equal(f.delayLabel({ delayDays: 0, delayHours: 0, delayMinutes: 0 }), 'Aussitôt');
  // Rendu en DOM : listes imbriquées par branche, plus de canevas.
  const view = read('src/components/sequences/StepsReadOnly.tsx');
  assert.match(view, /<ol className="space-y-0" aria-label=\{label\}>/);
  assert.match(view, /aria-label=\{`Branche : \$\{branch\.label\}`\}/);
  assert.doesNotMatch(view, /@xyflow|ReactFlow/);
  assert.match(view, /Modifier les étapes/);
});

test('5c-2 — page d’une séquence : en-tête, menu « ... », onglets, un seul bouton plein, gestes existants', () => {
  const page = read('src/pages/SequenceDetailPage.tsx');
  const header = read('src/components/sequences/SequenceHeader.tsx');
  const menu = read('src/components/sequences/SequenceMenu.tsx');
  const tabs = read('src/components/sequences/sequenceTabsModel.ts');
  // Un seul bouton plein : « Enregistrer » tant que des réglages attendent, sinon « Inscrire des candidats ».
  assert.equal((header.match(/variant="primary"/g) || []).length, 1);
  assert.match(header, /variant=\{dirty \? 'outline' : 'primary'\}/);
  assert.doesNotMatch(page, /variant="primary"/);
  assert.match(header, /aria-label="Renommer la séquence"/);
  assert.match(header, /aria-label="Fil d’Ariane"/);
  assert.match(page, /const missionId = fromMission\(searchParams\.get\('depuis'\)\);/);
  // Onglets dans l'adresse ; Statistiques et Journal après la première inscription.
  for (const label of ["'Étapes'", "'Candidats'", "'Statistiques'", "'Journal'", "'Réglages'"]) assert.ok(tabs.includes(label), label);
  assert.match(tabs, /hasEnrollments \|\| \(v !== 'statistiques' && v !== 'journal'\)/);
  assert.match(tabs, /return hasEnrollments \? 'candidats' : 'etapes';/);
  // Menu « ... » : gestes de la liste, « Copie de … », suppression confirmée.
  for (const item of ['Dupliquer', 'Enregistrer comme modèle', 'Envoyer les actions du jour', 'Diagnostic des envois', 'Raccourcis clavier', 'Supprimer']) {
    assert.ok(menu.includes(item), `menu : ${item}`);
  }
  assert.match(menu, /<AlertDialogTitle>Supprimer cette séquence \?<\/AlertDialogTitle>/);
  assert.match(menu, /<AlertDialogTitle>Envoyer maintenant les actions du jour \?<\/AlertDialogTitle>/);
  assert.match(menu, /<SaveAsTemplateModal/);
  assert.match(menu, /<KeyboardShortcutsDialog open=\{shortcutsOpen\}/);
  assert.match(page, /copyName: \(name\) => `Copie de \$\{name\}`,/);
  assert.match(page, /onDuplicated: \(copy\) => navigate\(sequencePath\(copy\.id, missionId\)\),/);
  assert.match(page, /const deleted = await handleDelete\(sequence\.id\);/);
  assert.match(page, /missionSequenceIds: sequence && canManage\(sequence\) && sequence\.is_active \? \[sequence\.id\] : \[\],/);
  // Liste : nom de copie et suppression rendue, défaut inchangé.
  const actions = read('src/lib/sequenceActions.ts');
  assert.match(actions, /copyName = \(name: string\) => `\$\{name\} \(copie\)`, onDuplicated,/);
  assert.match(actions, /name: copyName\(seq\.name\),/);
  assert.match(actions, /const handleDelete = async \(sequenceId: string\): Promise<boolean> => \{/);
  // « Modifier les étapes » ouvre l'éditeur actuel ; Statistiques de cette séquence.
  assert.match(page, /onEdit=\{\(\) => \{ void handleEdit\(sequence\); \}\}/);
  assert.match(page, /<SequenceAnalytics isOpen=\{false\} onClose=\{\(\) => undefined\} embedded sequenceId=\{sequence\.id\} sequenceName=\{sequence\.name\} \/>/);
  // Journal : carte « État de l'envoi » (corps du diagnostic hors du panneau), puis la file paginée.
  const journal = read('src/components/sequences/JournalTab.tsx');
  assert.match(journal, /<SequenceActivityLog isOpen=\{false\} onClose=\{\(\) => undefined\} embedded sequenceId=\{sequenceId\} \/>/);
  assert.match(read('src/components/sequences/SendHealthCard.tsx'), /<SequenceDiagnosticBody active=\{active\} sequenceId=\{sequenceId\} compact onShowJourney=\{onShowJourney\} \/>/);
  const diag = read('src/components/outreach/SequenceDiagnostic.tsx');
  assert.match(diag, /export const SequenceDiagnosticBody: React\.FC<SequenceDiagnosticBodyProps>/);
  // Panneau : même corps ; son état vit hors du contenu du Sheet (démonté à la fermeture), la réouverture garde les chiffres lus.
  assert.match(diag, /const diagnostic = useSequenceDiagnosticData\(\{ active: open, projectId \}\);[\s\S]*?<DiagnosticView diagnostic=\{diagnostic\} \/>/, 'panneau : même corps, état hors du Sheet');
  assert.match(diag, /const diagnostic = useSequenceDiagnosticData\(\{ active, projectId, sequenceId \}\);\s*return <DiagnosticView diagnostic=\{diagnostic\} compact=\{compact\} onShowJourney=\{onShowJourney\} \/>;/);
  // Réglages : composants actuels sous « Conditions d'arrêt ».
  const settings = read('src/components/sequences/SettingsTab.tsx');
  // Page : conditions à plat sous des filets (plain) ; l'éditeur actuel garde ses cadres.
  assert.match(settings, /<StopConditionsSettings plain value=\{value\.stopConditions\}/);
  assert.match(settings, /<MultiSenderSettings/);
  assert.match(read('src/components/outreach/sequence/StopConditionsSettings.tsx'), /Conditions d'arrêt/);
  assert.match(page, /stop_conditions: withAlwaysOnStops\(settingsDraft\.stopConditions\) as unknown as Json,/);
  // Textes exacts des états (spécification, section 4).
  for (const text of ['Séquence indisponible pour l’instant.']) assert.ok(page.includes(text), text);
  const cands = read('src/components/sequences/CandidatesTab.tsx');
  for (const text of ['Inscriptions indisponibles pour l’instant.', 'Aucun candidat inscrit.']) assert.ok(cands.includes(text), text);
  assert.ok(read('src/components/outreach/SequenceActivityLog.tsx').includes('Journal indisponible pour l’instant.'));
});

test('5c-2 — onglet Candidats : puces sans zéro, statut par enrollmentStatusLine, gestes de 5b, collaborateur sur ses lignes', () => {
  const cands = read('src/components/sequences/CandidatesTab.tsx');
  // Puces : une puce à zéro est masquée, le nombre ne s'écrit jamais à zéro.
  assert.match(cands, /ENROLLMENT_CHIPS\.filter\(\(c\) => c\.key === 'tous' \|\| c\.key === chip \|\| !counts \|\| counts\[c\.key\] > 0\)/);
  assert.match(cands, /\{n !== undefined && n > 0 && <span/);
  assert.match(cands, /enrollmentStatusLine\(e, \{/);
  // Gestes : pause et arrêt immédiats avec « Annuler » (5b), reprises par le serveur.
  assert.match(cands, /const \{ offerUndoPause, stopEnrollments, resumeIds \} = useUndoableEnrollmentAction\(\);/);
  assert.match(cands, /const \{ stopEnrollment, pauseEnrollments, markReplied \} = createEnrollmentActions\(\{/);
  assert.match(cands, /invokeEdgeFunction<ResumeResponse>\('process-sequences', \{ action: 're_enroll', enrollment_ids: \[id\] \}\)/);
  assert.match(cands, /action: 'skip_execution', execution_id: exec\.id/);
  for (const label of ['Reprendre la séquence', 'Ne pas envoyer cette étape', 'Marquer comme ayant répondu', 'Relire le message', 'Mettre en pause pour ce candidat']) {
    assert.ok(cands.includes(label), label);
  }
  assert.match(cands, /aria-label=\{`Actions pour \$\{name\}`\}/);
  assert.match(cands, /className=\{cn\(REVEAL_ON_ROW,/, 'menu révélé au survol, au focus et au toucher');
  // D3 : un collaborateur n'agit que sur ses inscriptions.
  assert.match(cands, /const ownRow = \(e: DetailEnrollment\) => !isCollaborator \|\| \(!!userId && e\.created_by === userId\);/);
  assert.match(cands, /disabled=\{!own\}/);
  // Relecture : final_message de l'étape programmée (EditScheduledMessageModal), rien d'autre.
  assert.match(cands, /<EditScheduledMessageModal/);
  // Pause groupée : même écriture que la pause d'un candidat, « Annuler » sur les seules touchées.
  const actions = read('src/lib/sequenceActions.ts');
  assert.match(actions, /const pauseEnrollments = async \(enrollmentIds: string\[\]\) => \{/);
  assert.match(actions, /\.update\(\{ status: 'paused', pause_reason: 'manual' \}\)\s*\.in\('id', ids\)\s*\.eq\('status', 'active'\)\s*\.select\('id'\);/);
  // Parcours : panneau « Parcours de … ».
  assert.match(read('src/components/sequences/JourneyPanel.tsx'), /`Parcours de \$\{name\}`/);
  // Lecture filtrée par la requête (pagination juste) ; conversation par les liens de la mission.
  const hook = read('src/hooks/useSequenceEnrollments.ts');
  assert.match(hook, /if \(filter\.pauseReasonsNotIn\) query = query\.or\(`pause_reason\.is\.null,pause_reason\.not\.in\.\(\$\{filter\.pauseReasonsNotIn\.join\(','\)\}\)`\);/);
  assert.match(hook, /\.from\('mission_conversations'\)/);
});

// ─── Lot 5c-2, partie 3 : gardes complémentaires ───

test('5c-2 — enrollmentStatusLine : cas voisins du tableau (plafond du jour, envoi en cours, arrêt du moteur, pause sans date)', async (t) => {
  const m = await loadTs(t, 'src/lib/enrollmentStatusLine.ts');
  if (!m) return;
  const now = new Date(2026, 8, 29, 10, 0);
  const at = (d, h) => new Date(2026, 8, d, h, 0).toISOString();
  const line = (enrollment, extra = {}) => m.enrollmentStatusLine(enrollment, { now, sequenceActive: true, canManageSequence: true, isAccountHolder: true, hasNextStep: true, ...extra });
  const pick = (l) => [l.chip, l.label, l.action?.kind ?? null];
  // Plafond atteint sur un message : « Reporté : … » (vocabulaire 3.2), aucune action.
  assert.deepEqual(pick(line({ status: 'active', executions: [{ status: 'quota_blocked', scheduled_at: at(30, 9), step: { action_type: 'message' } }] })),
    ['en-cours', 'Reporté : plafond LinkedIn du jour atteint', null]);
  // Envoi déjà parti chez le prestataire : aucune pause proposée (une étape « sending » n'est jamais annulée).
  const sending = line({ status: 'active', executions: [{ status: 'sending', scheduled_at: at(29, 9), step: { action_type: 'message' } }] });
  assert.deepEqual(pick(sending), ['en-cours', 'En cours', null]);
  assert.equal(sending.next, 'Envoi en cours');
  // Relecture d'un message IA : prioritaire sur un report de plafond.
  assert.equal(line({ status: 'active', executions: [
    { status: 'quota_blocked', scheduled_at: at(29, 9), step: { action_type: 'connection_request' } },
    { status: 'scheduled', scheduled_at: at(30, 9), error_message: "Message rédigé par l'IA à relire avant l'envoi.", final_message: null, step: { action_type: 'message' } },
  ] }).action.kind, 'review');
  // Arrêt par le moteur sans réponse ailleurs : terminée, aucune action.
  assert.deepEqual(pick(line({ status: 'stopped', executions: [] })), ['terminees', 'Arrêtée automatiquement', null]);
  // Pause manuelle sans date lisible : « En pause », jamais « depuis le Invalid Date ».
  assert.deepEqual(pick(line({ status: 'paused', pause_reason: null, updated_at: 'pas une date' })), ['en-pause', 'En pause', 'resume']);
  // Arrêt manuel d'un membre inconnu : jamais de nom inventé.
  assert.doesNotMatch(line({ status: 'completed', tracking_data: { completion_reason: 'manual_stop', manual_stop: { by: 'u9', at: at(29, 9) } } }, { memberName: () => null }).label, /undefined|null/);
  // Chaque ligne : une seule action au plus, libellé sans tiret long.
  for (const status of ['active', 'paused', 'replied', 'completed', 'stopped', 'cancelled', 'bounced']) {
    const l = line({ status });
    assert.doesNotMatch(l.label, /—/);
    assert.ok(l.action === null || typeof l.action.label === 'string');
  }
});

test('5c-2 — « Supprimer » ne supprime qu’après « Supprimer cette séquence ? », sur l’écran et sur la page', () => {
  // Écran de l'organisation : le menu de la ligne ouvre la confirmation, seule la confirmation supprime.
  const page = read('src/pages/SequencesPage.tsx');
  assert.equal((page.match(/handleDelete\(/g) || []).length, 1, 'un seul appel de suppression');
  assert.match(page, /<AlertDialogAction[\s\S]{0,120}?onClick=\{\(\) => deleteConfirmId && handleDelete\(deleteConfirmId\)\}/);
  assert.match(read('src/components/sequences/SequenceRow.tsx'), /onSelect=\{onDelete\}[\s\S]{0,200}?Supprimer/);
  // Page d'une séquence : l'élément du menu ouvre la confirmation ; la confirmation appelle onDelete.
  const menu = read('src/components/sequences/SequenceMenu.tsx');
  assert.match(menu, /<DropdownMenuItem onSelect=\{\(\) => setDeleteOpen\(true\)\}[\s\S]{0,200}?Supprimer\s*<\/DropdownMenuItem>/);
  assert.match(menu, /<AlertDialogAction onClick=\{onDelete\}[\s\S]{0,120}?Supprimer définitivement/);
  const detail = read('src/pages/SequenceDetailPage.tsx');
  assert.equal((detail.match(/handleDelete\(/g) || []).length, 1);
  assert.equal((detail.match(/deleteSequence\(\)/g) || []).length, 1, 'deleteSequence n’est appelée que par le menu');
  assert.match(detail, /onDelete=\{\(\) => \{ void deleteSequence\(\); \}\}/);
  // Toujours une AlertDialog, jamais la fenêtre native.
  for (const src of [page, menu, detail]) assert.doesNotMatch(src, /window\.confirm|\bconfirm\(/);
});

test('5c-2 — aucun appel serveur nouveau : actions membres existantes de process-sequences, fonctions de base existantes', () => {
  const server = read('supabase/functions/process-sequences/index.ts');
  const block = server.slice(server.indexOf('const MEMBER_ACTIONS = new Set(['), server.indexOf(']);', server.indexOf('const MEMBER_ACTIONS = new Set([')));
  const memberActions = new Set([...block.matchAll(/'(\w+)'/g)].map((x) => x[1]));
  assert.ok(memberActions.has('nudge_sequences') && memberActions.has('stop_enrollments'), 'liste des actions membres introuvable');
  const used = new Set();
  for (const rel of [...SCREEN_FILES, 'src/lib/sequenceActions.ts', 'src/hooks/useUndoableEnrollmentAction.ts']) {
    const src = read(rel);
    for (const [, fn] of src.matchAll(/invokeEdgeFunction(?:<[^>(]*>)?\(\s*'([\w-]+)'/g)) {
      assert.equal(fn, 'process-sequences', `${rel} : fonction serveur ${fn}`);
    }
    for (const [, action] of src.matchAll(/invokeEdgeFunction(?:<[^>(]*>)?\(\s*'process-sequences',\s*\{\s*action:\s*'(\w+)'/g)) used.add(action);
    for (const [, action] of src.matchAll(/^\s*action:\s*'(\w+)',/gm)) used.add(action);
    // Lecture des compteurs (pages) ; écriture des étapes d'une copie (« Dupliquer », déjà là avant 5c-2).
    for (const [, rpc] of src.matchAll(/\.rpc\(\s*'(\w+)'/g)) {
      const allowed = SCREEN_FILES.includes(rel) ? ['get_sequence_enrollment_counts'] : ['get_sequence_enrollment_counts', 'save_sequence_steps'];
      assert.ok(allowed.includes(rpc), `${rel} : fonction ${rpc}`);
    }
    assert.doesNotMatch(src, /functions\.invoke\(/, `${rel} : appel serveur hors invokeEdgeFunction`);
  }
  for (const action of used) assert.ok(memberActions.has(action), `action ${action} absente de MEMBER_ACTIONS`);
  for (const action of ['nudge_sequences', 're_enroll', 'mark_replied', 'skip_execution']) assert.ok(used.has(action), `${action} attendue`);
});

test('5c-2 — drapeau éteint : aucun lien vers /sequences hors des accès gardés', () => {
  // Fichiers qui nomment /sequences en dehors des pages et de leurs modules (SCREEN_FILES) : chacun lit l'interrupteur.
  const GATED = {
    'src/App.tsx': /<SequencesGate>/,
    'src/components/sidebar/SidebarBottomRow.tsx': /showSequences \? \[\{ to: '\/sequences'/,
    'src/components/layout/NavigationPalette.tsx': /\{showSequences && \(\s*<CommandItem onSelect=\{\(\) => go\('\/sequences'\)\}>/,
    'src/components/layout/GoShortcuts.tsx': /!isSequencesPath\(path\) \|\| getSequencesBeta\(\)/,
    'src/components/outreach/SequencesList.tsx': /\{sequencesBeta \? \(\s*<Link\s+to=\{sequencePath/,
  };
  const pageFiles = new Set(SCREEN_FILES);
  const found = filesUnder('src')
    .filter((rel) => /\.(ts|tsx)$/.test(rel) && !pageFiles.has(rel))
    .filter((rel) => /['"`]\/sequences\b|\bSEQUENCES_PATH\b|\bsequencePath\(/.test(read(rel)));
  assert.deepEqual(found.sort(), Object.keys(GATED).sort(), 'nouvel accès à /sequences : le garder derrière l’interrupteur');
  for (const [rel, guard] of Object.entries(GATED)) assert.match(read(rel), guard, `${rel} : accès non gardé`);
  // Le second lien de la liste (« Toutes les séquences de l'organisation ») aussi.
  assert.equal((read('src/components/outreach/SequencesList.tsx').match(/\bSEQUENCES_PATH\b/g) || []).length, 2, 'import et lien gardé seulement');
});

test('5c-2 — onglets de la page : compteur de « Candidats » jamais à zéro, onglet par défaut selon les inscrits', async (t) => {
  const tabs = read('src/components/sequences/SequenceTabs.tsx');
  assert.match(tabs, /value === 'candidats' && candidateCount !== null && candidateCount > 0 &&/);
  const model = await loadTs(t, 'src/components/sequences/sequenceTabsModel.ts');
  if (!model) return;
  assert.deepEqual(model.visibleSequenceTabs(false), ['etapes', 'candidats', 'reglages']);
  assert.deepEqual(model.visibleSequenceTabs(true), ['etapes', 'candidats', 'statistiques', 'journal', 'reglages']);
  assert.equal(model.parseSequenceTab(null, false), 'etapes');
  assert.equal(model.parseSequenceTab(null, true), 'candidats');
  assert.equal(model.parseSequenceTab('journal', false), 'etapes', 'Journal masqué sans inscrit');
  assert.equal(model.parseSequenceTab('journal', true), 'journal');
  assert.equal(model.parseSequenceTab('inconnu', true), 'candidats');
});

// ─── Lot 5c-2, corrections après relecture ───

test('5c-2 — Parcours sur le graphe : branche prise, issues d’une attente en cours, branche non prise, étape rejointe', async (t) => {
  const j = await loadTs(t, 'src/lib/sequenceJourney.ts');
  if (!j) return;
  // Séquence à branches de la maquette (seedDetailSequence).
  const rows = [
    { id: 'visit', step_order: 0, action_type: 'profile_visit' },
    { id: 'check', step_order: 1, action_type: 'check_connection', delay_days: 1, if_true_goto_step: 'msgA', if_false_goto_step: 'invite' },
    { id: 'msgA', step_order: 2, action_type: 'message', variant_group: 'A', next_step_id: 'relance' },
    { id: 'msgB', step_order: 2, action_type: 'message', variant_group: 'B', next_step_id: 'relance' },
    { id: 'relance', step_order: 3, action_type: 'message', delay_days: 5, ends_sequence: true },
    { id: 'invite', step_order: 4, action_type: 'connection_request', next_step_id: 'wait' },
    { id: 'wait', step_order: 5, action_type: 'wait_connection', timeout_days: 10, timeout_branch_step_id: 'inmail', next_step_id: 'relance' },
    { id: 'inmail', step_order: 6, action_type: 'inmail', ends_sequence: true },
  ];
  const now = new Date(2026, 9, 6, 10);
  const ex = (id, step_id, step_order, status, day) => ({
    id, step_id, step_order, status,
    scheduled_at: new Date(2026, 9, day, 9).toISOString(),
    executed_at: status === 'sent' ? new Date(2026, 9, day, 9).toISOString() : null,
  });
  const flat = (items) => items.flatMap((i) => (i.kind === 'branches' ? [{ kind: 'branches', labels: i.branches.map((b) => b.label) }, ...i.branches.flatMap((b) => flat(b.items).map((x) => ({ ...x, branch: b.label })))] : [i]));

  // Sophie / Chloé : branche « Non connecté », invitation envoyée, attente en cours.
  const waiting = flat(j.buildJourney(rows, [ex(1, 'visit', 0, 'sent', 3), ex(2, 'check', 1, 'sent', 4), ex(3, 'invite', 4, 'sent', 5), ex(4, 'wait', 5, 'waiting_event', 5)], { live: true, now }));
  const notTaken = waiting.find((i) => i.kind === 'not_taken');
  assert.equal(notTaken.label, 'Connecté (1er degré)');
  assert.deepEqual(notTaken.steps, ['3 · Message LinkedIn'], 'la relance, rejointe par « Acceptée », n’est pas « non prise »');
  assert.equal(waiting.find((i) => i.kind === 'step' && i.stepId === 'wait').detail, 'En attente');
  assert.deepEqual(waiting.find((i) => i.kind === 'branches').labels, ['Si acceptée', 'Si pas acceptée après 10 jours']);
  const relance = waiting.find((i) => i.kind === 'step' && i.stepId === 'relance');
  assert.equal(relance.branch, 'Si acceptée');
  assert.equal(relance.detail, 'À venir · 5 jours après l’acceptation');
  const inmail = waiting.find((i) => i.kind === 'step' && i.stepId === 'inmail');
  assert.equal(inmail.branch, 'Si pas acceptée après 10 jours');
  assert.equal(inmail.detail, 'À venir · à partir du 15/10, sans acceptation', 'le délai de l’issue, jamais « Aussitôt »');
  // Les étapes de la branche « Non connecté » ne sont jamais annoncées sur la branche prise, et inversement.
  assert.ok(!waiting.some((i) => i.kind === 'step' && i.stepId === 'msgA'), 'message de la branche non prise jamais « à venir »');

  // Claire : branche « Connecté », version B prévue ; l'invitation et l'InMail ne sont pas annoncés.
  const connected = flat(j.buildJourney(rows, [ex(1, 'visit', 0, 'sent', 3), ex(2, 'check', 1, 'sent', 4), ex(3, 'msgB', 2, 'scheduled', 7)], { live: true, now }));
  assert.deepEqual(connected.filter((i) => i.kind === 'step').map((i) => [i.number, i.title, i.state]), [
    [1, 'Visite de profil', 'done'],
    [2, 'Vérifier la connexion', 'done'],
    [3, 'Message LinkedIn · version B', 'current'],
    [4, 'Message LinkedIn', 'todo'],
  ]);
  assert.deepEqual(connected.find((i) => i.kind === 'not_taken').steps, ['5 · Invitation LinkedIn', '7 · InMail']);
  assert.equal(connected.find((i) => i.kind === 'step' && i.stepId === 'visit').detail, `Fait le 03/10 à 9${NB}h`, 'une visite est faite, pas envoyée');

  // Invitation acceptée : la branche de repli est « non prise », la relance est la suite réelle.
  const accepted = flat(j.buildJourney(rows, [ex(1, 'visit', 0, 'sent', 1), ex(2, 'check', 1, 'sent', 2), ex(3, 'invite', 4, 'sent', 2), ex(4, 'wait', 5, 'sent', 3), ex(5, 'relance', 3, 'scheduled', 8)], { live: true, now }));
  assert.deepEqual(accepted.filter((i) => i.kind === 'not_taken').map((i) => [i.label, i.steps]), [['Connecté (1er degré)', ['3 · Message LinkedIn']], ['Pas acceptée après 10 jours', ['7 · InMail']]]);
  assert.equal(accepted.find((i) => i.kind === 'step' && i.stepId === 'relance').state, 'current');

  // Fourche pas encore jouée : deux issues à venir ; la seconde rejoint l'étape déjà dessinée.
  const ahead = flat(j.buildJourney(rows, [ex(1, 'visit', 0, 'sent', 5)], { live: true, now }));
  assert.deepEqual(ahead.find((i) => i.kind === 'branches').labels, ['Si connecté (1er degré)', 'Si non connecté']);
  assert.ok(ahead.some((i) => i.kind === 'join' && i.number === 4), 'la relance est rejointe, pas répétée');

  // Inscription close : le parcours s'arrête à la dernière étape jouée, sans rien annoncer.
  const closed = j.buildJourney(rows, [], { live: false, now });
  assert.deepEqual(closed.map((i) => [i.kind, i.label]), [['end', 'Étapes suivantes non jouées']]);

  // Panneau : inscription de cette séquence seulement, étapes lues par une référence (pas de relecture à chaque rendu).
  const panel = read('src/components/sequences/JourneyPanel.tsx');
  assert.match(panel, /\.from\('sequence_enrollments'\)\.select\('\*'\)\.eq\('id', enrollmentId\)\.eq\('sequence_id', sequenceId\)\.maybeSingle\(\)/);
  assert.match(panel, /title="Parcours indisponible\."/);
  assert.match(panel, /const stepsRef = useRef\(steps\);/);
  assert.match(panel, /\}, \[enrollmentId, sequenceId\]\);/, 'la lecture ne dépend pas du tableau des étapes');
  assert.match(panel, /buildJourney\(steps, enrollment\.executions \?\? \[\]/);
  assert.match(read('src/components/sequences/CandidatesTab.tsx'), /<JourneyPanel\s+enrollmentId=\{journeyId\}\s+sequenceId=\{sequence\.id\}/);
});

test('5c-2 — corrections d’écran : statistiques à plat, file « À venir », rythme, brouillon, onglets, barre, formule gratuite', () => {
  // Statistiques dans une page : jamais « 0 » écrit, taux à partir de 5, versions nommées, aucune carte.
  const analytics = read('src/components/outreach/SequenceAnalytics.tsx');
  const pageStats = analytics.slice(analytics.indexOf('function PageStatsView('), analytics.indexOf('/** Squelette des statistiques'));
  assert.ok(pageStats.length > 0, 'PageStatsView introuvable');
  assert.match(analytics, /\) : embedded \? \(\s*<PageStatsView/);
  assert.match(analytics, /const PAGE_RATE_MIN = RESPONSE_RATE_MIN_CONTACTED;/);
  assert.match(pageStats, /aucune réponse/);
  assert.match(pageStats, /totals\.invitesSent >= PAGE_RATE_MIN \? `\$\{acceptRate\} % acceptées` : null/);
  assert.match(pageStats, /\.filter\(\(row\) => row\.value > 0\)/, 'entonnoir sans ligne nulle');
  assert.match(pageStats, / · version \$\{st\.variant_group\}/);
  assert.match(pageStats, /'en échec'/, '« En échec » à part, comme les puces');
  assert.doesNotMatch(pageStats, /rounded-(?:lg|xl) border|<Section\b|<StatTile\b|<ABTestResults\b/, 'aucune carte dans la page');
  assert.doesNotMatch(pageStats, /text-warning|text-success/, 'taux en couleur neutre');
  assert.match(analytics, /title=\{embedded \? 'Statistiques indisponibles pour l’instant\.' : 'Impossible de charger les statistiques'\}/);

  // File d'une page : statuts de routine en texte neutre, report par le plafond nommé une seule fois, heure entière.
  const log = read('src/components/outreach/SequenceActivityLog.tsx');
  assert.match(log, /exec\.status === 'quota_blocked' \? quotaBlockedLabel\(actionType\)/);
  assert.match(log, /\{paginated \? clockTime\(new Date\(exec\.scheduled_at\)\) : format\(new Date\(exec\.scheduled_at\), 'HH:mm'\)\}/);
  assert.match(log, /paginated \? 'break-words' : 'truncate'/, 'l’heure passe à la ligne sur téléphone');
  assert.match(log, /if \(status === 'failed' \|\| status === 'bounced'\) return 'text-danger';/);
  assert.match(log, /\{statusSelect\('w-full max-md:h-11 sm:w-40'\)\}/);
  assert.match(log, /Pour ne plus rien lui envoyer, arrêtez la séquence pour ce candidat\./);

  // Carte « État de l'envoi » : jamais « 0 sur 25 ».
  assert.match(read('src/components/outreach/SequenceDiagnostic.tsx'), /Aucune invitation cette semaine \(plafond \{weeklyCap\}\)/);

  // Ligne de rythme : un brouillon n'est pas en pause ; prochaine action envoyable seulement ; points entre deux éléments d'une ligne.
  const rhythm = read('src/components/sequences/RhythmLine.tsx');
  assert.match(rhythm, /if \(status === 'active' && nextAt\)/);
  assert.match(rhythm, /if \(status === 'paused'\) parts\.push\('aucun envoi tant que la séquence est en pause'\);/);
  assert.match(rhythm, /<div className="-mx-1 overflow-hidden px-1 py-0\.5">\s*<p className="-ml-3 flex flex-wrap/);
  const page = read('src/pages/SequenceDetailPage.tsx');
  assert.match(page, /const sendable = rows\.find\(\(row\) => !isAiReviewPending\(row\)\);/);
  assert.match(page, /<SequenceTabs\s+active=\{tab\}/);
  assert.match(read('src/components/sequences/SequenceStatusPill.tsx'), /status === 'draft' \? 'Activer la séquence' : 'Réactiver la séquence'/);
  assert.match(read('src/components/sequences/SequenceRow.tsx'), /\{draft && canEdit \? null : canEdit \? \(/, 'aucun interrupteur sur un brouillon');
  // Onglets : l'onglet actif revient dans la vue, sans défilement vertical.
  const tabs = read('src/components/sequences/SequenceTabs.tsx');
  assert.match(tabs, /querySelector<HTMLElement>\('\[role="tab"\]\[data-state="active"\]'\)/);
  assert.doesNotMatch(tabs, /scrollIntoView/);

  // Réglages : conditions d'arrêt à plat dans la page.
  const stops = read('src/components/outreach/sequence/StopConditionsSettings.tsx');
  assert.match(stops, /plain \? 'divide-y divide-border border-y border-border' : 'space-y-2'/);

  // Onglet Candidats : cases de 44 px au doigt, réponse groupée plafonnée et par lots, textes accordés.
  const cands = read('src/components/sequences/CandidatesTab.tsx');
  assert.match(cands, /const CHECKBOX_TOUCH = 'relative max-md:after:absolute max-md:after:-inset-3\.5';/);
  assert.equal((cands.match(/CHECKBOX_TOUCH\b/g) || []).length, 3);
  assert.match(cands, /const BULK_REPLIED_MAX = 200;/);
  assert.match(cands, /for \(let i = 0; i < ids\.length; i \+= BULK_REPLIED_CONCURRENCY\)/);
  assert.match(cands, /Ces \$\{ids\.length\} candidats passeront en « A répondu » et leurs étapes restantes seront annulées\./);
  assert.match(cands, /passera en « A répondu » et ses étapes restantes seront annulées\./);
  assert.match(cands, /!isMeetingBookedCompletion\(e\.status, e\.tracking_data\)/, 'jamais de relance après un rendez-vous');
  assert.doesNotMatch(cands, /mettez ce candidat en pause/);

  // Écran de l'organisation : texte de la spécification (section 4), « Compris » mémorisé, actions du jour masquées sans séquence active, « Copie de … ».
  const orgPage = read('src/pages/SequencesPage.tsx');
  assert.ok(orgPage.includes('Votre formule permet de préparer des séquences et d’écrire aux candidats un par un. L’envoi automatique, avec les relances, fait partie des formules payantes.'));
  assert.match(orgPage, /onClick=\{dismissFreeNotice\}[\s\S]{0,80}Compris/);
  assert.match(orgPage, /localStorage\.setItem\(freeNoticeKey\(userId\), '1'\)/);
  assert.match(orgPage, /\{nudgeSequenceIds\.length > 0 && \(/);
  assert.match(orgPage, /copyName: \(name\) => `Copie de \$\{name\}`,/);
  assert.doesNotMatch(orgPage, /Votre offre ne permet pas/);

  // Barre : six cibles de 44 px sur téléphone seulement drapeau allumé ; éteint, classes d'avant.
  const bottom = read('src/components/sidebar/SidebarBottomRow.tsx');
  assert.match(bottom, /const tight = showSequences && !collapsed;/);
  assert.match(bottom, /tight \? 'md:gap-0\.5' : 'gap-0\.5'/);
  assert.match(bottom, /isTasks && !collapsed && overdue !== null && \(tight \? 'md:gap-1 md:px-2' : 'gap-1 px-2'\)/);
});

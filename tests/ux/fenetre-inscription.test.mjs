/**
 * Fenêtre d'inscription en séquence (EnrollmentPreviewModal), lot de
 * lisibilité du 14/10/2026 :
 *  - la ligne d'un candidat à inscrire qui bloque « Inscrire » le dit en
 *    toutes lettres (message rédigé par l'IA à générer, ou génération en
 *    échec), jamais par la couleur seule ; un candidat passé ou exclu, non ;
 *  - les puces « sans e-mail » et « sans téléphone » (bandeau et lignes)
 *    n'apparaissent que si la séquence a une étape de ce canal qui part ;
 *  - la pastille du bandeau dit ce qu'elle compte : « Aperçus prêts pour N
 *    candidats sur M » (une étape écrite n'est préparée que pour les
 *    candidats de l'écran, ce n'est pas ce qui bloque l'inscription) ;
 *  - les messages rédigés par l'IA d'un candidat s'écrivent dans l'ordre :
 *    jamais une relance avant le message qu'elle relance, ni d'après un texte
 *    de secours après un échec ; une régénération remet ses relances à générer ;
 *  - le Résumé dit qu'une génération a échoué, et le pied mène au candidat
 *    qui bloque « Inscrire ».
 *
 * Rendu statique (esbuild, alias @/ par tsconfig.app.json) des composants,
 * hook d'aperçu exécuté avec un faux modèle, et contrôles de la fenêtre sur
 * sa source.
 * Lancer : node --test tests/ux/fenetre-inscription.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { CandidateSidebarCard } from './src/components/outreach/enrollment-preview/CandidateSidebarCard';",
      "export { DynamicSummaryBanner } from './src/components/outreach/enrollment-preview/DynamicSummaryBanner';",
      "export { FirstMessagePreviewBlock } from './src/components/outreach/enrollment-preview/RecipientsConfirm';",
      "export { TooltipProvider } from './src/components/ui/tooltip';",
      "export { createElement } from 'react';",
      "export { renderToStaticMarkup } from 'react-dom/server.browser';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  tsconfig: join(ROOT, 'tsconfig.app.json'),
  // Logos des canaux : une adresse suffit au rendu statique.
  loader: { '.svg': 'dataurl', '.png': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const h = kit.createElement;
const text = (html) => html.replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');
/** Texte de l'élément `id` (balise équilibrée), tel qu'une description accessible le lit. */
function describedText(html, id) {
  const at = html.indexOf(`id="${id}"`);
  assert.ok(at >= 0, `élément ${id} introuvable`);
  const tagStart = html.lastIndexOf('<', at);
  const tagName = html.slice(tagStart + 1).match(/^\w+/)[0];
  const tags = new RegExp(`<(/?)${tagName}\\b[^>]*>`, 'g');
  tags.lastIndex = tagStart;
  let depth = 0;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return text(html.slice(tagStart, tags.lastIndex));
  }
  throw new Error(`balise ${tagName} non fermée`);
}

const profile = { id: 'p1', name: 'Julie Martin', headline: 'Développeuse', profile_url: 'https://www.linkedin.com/in/julie' };
const noop = () => {};
const row = (props) => text(kit.renderToStaticMarkup(h(kit.TooltipProvider, null, h(kit.CandidateSidebarCard, {
  profile,
  isSelected: false,
  allGenerated: false,
  hasEdits: false,
  state: { removed: false, skipped: false },
  score: null,
  onSelect: noop,
  onRemove: noop,
  onSkip: noop,
  onViewScoring: noop,
  onViewHistory: noop,
  ...props,
}))));

test('ligne : message rédigé par l’IA manquant ou en échec écrit en toutes lettres, avant « Retouché »', () => {
  assert.match(row({ aiStatus: 'missing' }), /Message IA à générer/);
  assert.match(row({ aiStatus: 'failed' }), /Génération en échec/);
  // Ce qui bloque passe avant « Retouché » : une ligne retouchée à qui il manque un message le dit.
  const editedButMissing = row({ aiStatus: 'missing', hasEdits: true });
  assert.match(editedButMissing, /Message IA à générer/);
  assert.doesNotMatch(editedButMissing, /Retouché/);
  // Rien ne bloque : l'état d'avant.
  assert.match(row({ aiStatus: null, allGenerated: true }), /Aperçus prêts/);
  assert.doesNotMatch(row({ aiStatus: null }), /Message IA à générer|Génération en échec/);
});

test('ligne : le statut qui bloque est dans la description accessible du bouton (aria-describedby), pas seulement dans le balisage', () => {
  for (const [aiStatus, label] of [['missing', 'Message IA à générer'], ['failed', 'Génération en échec']]) {
    const html = kit.renderToStaticMarkup(h(kit.TooltipProvider, null, h(kit.CandidateSidebarCard, {
      profile, isSelected: false, allGenerated: false, hasEdits: false, aiStatus,
      state: { removed: false, skipped: false }, score: null,
      onSelect: noop, onRemove: noop, onSkip: noop, onViewScoring: noop, onViewHistory: noop,
    })));
    const button = html.match(/<button[^>]*data-candidate-id="p1"[^>]*>/)?.[0];
    assert.ok(button, 'bouton de la ligne');
    // Le nom accessible (aria-label) remplace le contenu : le statut doit passer par la description.
    assert.match(button, /aria-label="Julie Martin"/);
    const describedBy = button.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(describedBy, 'description reliée');
    assert.match(describedText(html, describedBy.split(' ')[0]), new RegExp(label));
  }
});

test('ligne : e-mail et WhatsApp montrés seulement si une étape de ce canal part', () => {
  const closed = row({});
  assert.doesNotMatch(closed, /sans e-mail|sans tél\./, 'canaux fermés : aucun manque signalé');
  assert.doesNotMatch(closed, /Adresse e-mail disponible|Téléphone disponible pour WhatsApp/);
  assert.match(closed, /LinkedIn disponible/, 'LinkedIn reste montré');
  const open = row({ emailStepOpen: true, whatsappStepOpen: true });
  assert.match(open, /sans e-mail/);
  assert.match(open, /sans tél\./);
});

const banner = (props) => text(kit.renderToStaticMarkup(h(kit.DynamicSummaryBanner, {
  profiles: [profile, { ...profile, id: 'p2', name: 'Marc Lefèvre' }],
  states: new Map(),
  readyCount: 1,
  ...props,
})));

test('bandeau : « Aperçus prêts pour N candidats sur M », puces de canal seulement pour une étape qui part', () => {
  const closed = banner({});
  assert.match(closed, /Aperçus prêts pour 1 candidat sur 2/);
  assert.doesNotMatch(closed, /Candidats prêts/, 'ce compte ne dit pas qui peut être inscrit');
  assert.match(banner({ readyCount: 2 }), /Aperçus prêts pour 2 candidats sur 2/);
  assert.doesNotMatch(closed, /sans e-mail|sans téléphone/);
  const open = banner({ emailStepOpen: true, whatsappStepOpen: true });
  assert.match(open, /2 sans e-mail/);
  assert.match(open, /2 sans téléphone/);
});

test('fenêtre : statut de la ligne calculé sur les étapes IA à relire, pour les seuls candidats à inscrire', () => {
  const modal = read('src/components/outreach/EnrollmentPreviewModal.tsx');
  const status = modal.slice(modal.indexOf('const aiStatusOf = (candidateId: string)'), modal.indexOf('const emailStepOpen ='));
  assert.match(status, /for \(const step of aiReviewSteps\) \{/);
  assert.match(status, /if \(isReady\(candidateId, step\.stepId\)\) continue;/);
  assert.match(status, /if \(preview\?\.error && !preview\.isGenerating\) return 'failed';/);
  assert.match(status, /return missing \? 'missing' : null;/);
  assert.match(modal, /const aiStatus = activeProfiles\.some\(a => a\.id === p\.id\) \? aiStatusOf\(p\.id\) : null;/);
  assert.match(modal, /aiStatus=\{aiStatus\}\s+emailStepOpen=\{emailStepOpen\}\s+whatsappStepOpen=\{whatsappStepOpen\}/);
  // Même filtre que le Résumé (canaux fermés : étapes sautées).
  assert.match(modal, /const emailStepOpen = steps\.some\(s => s\.actionType === 'email' && !isClosedChannelStep\(s\.actionType\)\);/);
  assert.match(modal, /const whatsappStepOpen = steps\.some\(s => s\.actionType === 'whatsapp_message' && !isClosedChannelStep\(s\.actionType\)\);/);
  assert.match(modal, /readyCount=\{readyCount\}\s+emailStepOpen=\{emailStepOpen\}\s+whatsappStepOpen=\{whatsappStepOpen\}/);
});

test('fenêtre : la règle « aucun message IA sans relecture » reste intacte', () => {
  const modal = read('src/components/outreach/EnrollmentPreviewModal.tsx');
  assert.match(modal, /if \(recipients\.blocked \|\| aiReviewMissingCount > 0\) return;/);
  assert.match(modal, /recipients\.blocked \|\| aiReviewMissingCount > 0\}/);
  assert.match(modal, /const recipients = useRecipientsConfirm\(activeProfiles\.map\(p => p\.id\), \{ aiReview: hasAiReview, aiGenerationVersion \}\);/);
  assert.match(modal, /aiReview=\{hasAiReview\}\s+disabled=\{aiReviewMissingCount > 0\}/);
  // Résumé : plus de second total, de doublon du nombre de candidats ni de bouton qui double la bascule.
  const summary = modal.slice(modal.indexOf('function SummaryMode('), modal.indexOf('function SummaryRow('));
  assert.doesNotMatch(summary, /Récapitulatif|candidats sélectionnés|Joignables sur LinkedIn|Voir les aperçus des messages|Coût estimé/);
  assert.match(summary, /Avant l'inscription/);
});

// ─── Ordre de génération des messages rédigés par l'IA (hook réel) ─────────

/** Transpile le hook d'aperçu avec des remplaçants : React qui applique les mises à jour, faux modèle scriptable. */
async function loadPreviewHook() {
  const stubs = {
    // setState applique la mise à jour (sans nouveau rendu) : les lectures par ref voient l'état écrit.
    react: 'export const useState = (i) => { let v = typeof i === "function" ? i() : i; return [v, (u) => { v = typeof u === "function" ? u(v) : u; }]; }; export const useCallback = (f) => f; export const useRef = (v) => ({ current: v }); export const useEffect = () => {}; export const useMemo = (f) => f(); export default {};',
    '@/lib/invokeWithCredits': 'export const invokeWithCredits = async (fn, action, body) => { (globalThis.__fenetreAiCalls ||= []).push(body); return globalThis.__fenetreAi(body); }; export const estimateActionCredits = () => 1;',
    '@/integrations/supabase/client': 'export const supabase = {};',
    '@/hooks/useAuthReady': 'export const useAuthReady = () => ({ user: null });',
  };
  const result = await build({
    entryPoints: [join(ROOT, 'src/hooks/useEnrollmentPreview.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    tsconfig: join(ROOT, 'tsconfig.app.json'),
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => (args.path in stubs ? { path: args.path, namespace: 'stub' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const previewHook = await loadPreviewHook();
const takeAiCalls = () => {
  const calls = globalThis.__fenetreAiCalls || [];
  globalThis.__fenetreAiCalls = [];
  return calls;
};
const julie = { id: 'p1', name: 'Julie Martin' };
const aiStep = (stepId, stepOrder, over = {}) => ({ stepId, stepOrder, actionType: 'message', messageTemplate: `Modèle ${stepId}`, subjectTemplate: '', useAiPersonalization: true, ...over });
const writtenText = async (p, step) => ({ subject: '', message: `${step.messageTemplate} (rendu)` });
const openHook = (steps) => previewHook.useEnrollmentPreview({ steps, profiles: [julie], job: null, accountId: 'acc', writtenText });
// Faux modèle : un texte par étape et par version, ou une panne pour les étapes listées.
let failing = new Set();
let version = 0;
globalThis.__fenetreAi = async (body) => {
  const stepId = body.messageTemplate.replace('Modèle ', '');
  if (failing.has(stepId)) return { data: null, error: new Error('panne') };
  version += 1;
  return { data: { message: `Texte IA ${stepId} v${version}` }, error: null };
};
const reset = () => { failing = new Set(); version = 0; takeAiCalls(); };

test('hook : premier message en échec, la relance n’est pas rédigée d’après le texte de secours', async () => {
  reset();
  const steps = [aiStep('m1', 0), aiStep('m2', 1)];
  const hook = openHook(steps);
  failing = new Set(['m1']);
  await hook.generateForCandidateById('p1');
  const calls = takeAiCalls();
  assert.equal(calls.length, 1, 'un seul appel : le premier message, en échec');
  assert.equal(calls[0].messageTemplate, 'Modèle m1');
  assert.deepEqual(hook.getMessageOverrides('p1'), {}, 'rien de prêt, la relance reste à générer');

  // « Réessayer » le premier message : lui seul, sans crédit pour la relance.
  failing = new Set();
  assert.equal(await hook.regenerateStep('p1', 'm1'), undefined);
  assert.equal(takeAiCalls().length, 1);
  assert.deepEqual(Object.keys(hook.getMessageOverrides('p1')), ['m1']);

  // « Générer les N aperçus » du candidat : la relance, avec le vrai premier message pour historique.
  await hook.generateForCandidateById('p1');
  const [relance] = takeAiCalls();
  assert.equal(relance.messageTemplate, 'Modèle m2');
  assert.deepEqual(relance.sequenceContext.prevSentSteps.map((s) => s.finalMessage), [hook.getMessageOverrides('p1').m1.message]);
});

test('hook : régénérer le premier message remet ses relances à générer, sauf une retouche', async () => {
  reset();
  const steps = [aiStep('m1', 0), aiStep('m2', 1), aiStep('m3', 2)];
  const hook = openHook(steps);
  await hook.generateForCandidateById('p1');
  assert.equal(takeAiCalls().length, 3);
  assert.deepEqual(Object.keys(hook.getMessageOverrides('p1')).sort(), ['m1', 'm2', 'm3']);

  // La relance m3 retouchée : le texte de la personne reste.
  hook.editMessage('p1', 'm3', 'message', 'Relance écrite à la main');
  await hook.regenerateStep('p1', 'm1');
  const calls = takeAiCalls();
  assert.equal(calls.length, 1, 'seul le message demandé est rédigé (coût annoncé)');
  const overrides = hook.getMessageOverrides('p1');
  assert.ok(overrides.m1, 'premier message régénéré');
  assert.equal(overrides.m2, undefined, 'relance générée d’après l’ancien texte : à générer de nouveau');
  assert.equal(overrides.m3.message, 'Relance écrite à la main', 'retouche gardée');

  // Une nouvelle génération du candidat rédige la relance d'après le nouveau premier message.
  await hook.generateForCandidateById('p1');
  const [relance] = takeAiCalls();
  assert.equal(relance.messageTemplate, 'Modèle m2');
  assert.equal(relance.sequenceContext.prevSentSteps[0].finalMessage, overrides.m1.message);
});

test('hook : une relance ne se régénère pas seule tant que le message qu’elle relance n’est pas prêt', async () => {
  reset();
  const hook = openHook([aiStep('m1', 0), aiStep('m2', 1)]);
  assert.equal(await hook.regenerateStep('p1', 'm2'), 'previous_missing');
  assert.equal(takeAiCalls().length, 0, 'aucun appel, aucun crédit');
  assert.deepEqual(hook.getMessageOverrides('p1'), {});
});

test('hook : un message IA en cours ailleurs retient ses relances (génération groupée pendant la barre du candidat)', async () => {
  reset();
  const hook = openHook([aiStep('m1', 0), aiStep('m2', 1)]);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const previous = globalThis.__fenetreAi;
  globalThis.__fenetreAi = async (body) => { await held; return previous(body); };
  const first = hook.regenerateStep('p1', 'm1');
  // Pendant ce temps, une génération du candidat : m1 est en cours, m2 attend.
  globalThis.__fenetreAi = previous;
  await hook.generateForCandidateById('p1');
  release();
  await first;
  assert.deepEqual(takeAiCalls().map((c) => c.messageTemplate), ['Modèle m1'], 'm2 n’est pas rédigée pendant que m1 s’écrit');
  assert.deepEqual(Object.keys(hook.getMessageOverrides('p1')), ['m1']);
});

test('hook : une note d’invitation IA en échec ne retient pas les messages (elle part sur son modèle)', async () => {
  reset();
  const steps = [
    aiStep('note', 0, { actionType: 'connection_request' }),
    { stepId: 'wait', stepOrder: 1, actionType: 'wait_connection', messageTemplate: '', subjectTemplate: '', useAiPersonalization: false },
    aiStep('m1', 2),
  ];
  assert.deepEqual(previewHook.aiPredecessorsOf(steps, steps[2]).map((s) => s.stepId), [], 'seuls les messages à relire comptent');
  const hook = openHook(steps);
  failing = new Set(['note']);
  await hook.generateForCandidateById('p1');
  const calls = takeAiCalls();
  assert.deepEqual(calls.map((c) => c.messageTemplate), ['Modèle note', 'Modèle m1']);
  // Historique du message : la note telle qu'elle partira (modèle rendu), jamais vide.
  assert.equal(calls[1].sequenceContext.prevSentSteps[0].finalMessage, 'Modèle note (rendu)');
});

test('règles pures : historique, messages IA d’avant et d’après', () => {
  const steps = [
    { stepId: 'invite', stepOrder: 0, actionType: 'connection_request', messageTemplate: '', subjectTemplate: '', useAiPersonalization: false },
    { stepId: 'check', stepOrder: 1, actionType: 'check_connection', messageTemplate: '', subjectTemplate: '', useAiPersonalization: false, ifTrueGotoStep: 'msg', ifFalseGotoStep: 'inmail' },
    aiStep('msg', 2, { nextStepId: 'relance' }),
    aiStep('relance', 3),
    aiStep('inmail', 4, { actionType: 'inmail' }),
  ];
  const ids = (list) => list.map((s) => s.stepId);
  assert.deepEqual(ids(previewHook.aiPredecessorsOf(steps, steps[3])), ['msg'], 'la relance suppose le message parti');
  assert.deepEqual(ids(previewHook.aiPredecessorsOf(steps, steps[4])), [], 'l’InMail de l’autre branche ne suppose rien');
  assert.deepEqual(ids(previewHook.aiDependentsOf(steps, 'msg')), ['relance']);
  assert.deepEqual(ids(previewHook.aiDependentsOf(steps, 'inmail')), []);
});

// ─── Résumé, pied et cartes ───────────────────────────────────────────────

test('Résumé : une génération en échec montre sa raison, jamais l’invitation à générer', () => {
  const block = (item) => text(kit.renderToStaticMarkup(h(kit.FirstMessagePreviewBlock, {
    preview: { candidateName: 'Julie Martin', items: [{ key: 's', label: 'Message LinkedIn', text: '', aiPending: true, ...item }] },
    title: "Messages rédigés par l'IA",
  })));
  const failed = block({ error: "Ce message cite une rémunération : régénérez-le ou modifiez-le." });
  assert.match(failed, /Ce message cite une rémunération/);
  assert.doesNotMatch(failed, /générez-le pour le relire/);
  assert.match(block({}), /Message rédigé par l'IA Konekt pour ce candidat : générez-le pour le relire\./);
  assert.match(block({ isGenerating: true, error: 'ancienne erreur' }), /Génération du message en cours\./);
  const modal = read('src/components/outreach/EnrollmentPreviewModal.tsx');
  // Premier message et messages IA du Résumé passent la raison de l'échec.
  assert.equal([...modal.matchAll(/error: !preview\?\.isGenerating \? preview\?\.error : undefined,/g)].length, 2);
});

test('pied : un lien mène au candidat suivant qui bloque, page et recherche comprises ; plus de bouton de génération', () => {
  const modal = read('src/components/outreach/EnrollmentPreviewModal.tsx');
  assert.match(modal, /const blockingProfiles = !isSingle && hasAiReview && aiReviewMissingCount > 0\s*\? activeProfiles\.filter\(p => aiStatusOf\(p\.id\) !== null\)/);
  const show = modal.slice(modal.indexOf('const showBlockingCandidate = (id: string) => {'), modal.indexOf('const handleListKeyDown'));
  assert.match(show, /if \(!filteredProfiles\.some\(p => p\.id === id\)\) setSearchQuery\(''\);/);
  assert.match(show, /setMode\('preview'\);\s*handleSelectCandidate\(id\);\s*focusCandidate\(id\);/);
  const footerStart = modal.indexOf('<SendingAccountNotice state={sendingAccount} />');
  const footer = modal.slice(footerStart, modal.indexOf('Présélectionner sans message', footerStart));
  assert.ok(footer.length > 0, 'pied trouvé');
  assert.match(footer, /onClick=\{\(\) => showBlockingCandidate\(nextBlocking\.id\)\}/);
  assert.match(footer, /Voir \{nextBlocking\.name \|\| 'le candidat'\}/);
  assert.doesNotMatch(footer, /generateAll|creditsLabel/, 'la génération vit dans la bande ou la barre du candidat');
});

test('cartes et barre : « Régénérer » attend la fin d’une génération du candidat, chaque total nomme le niveau', () => {
  const modal = read('src/components/outreach/EnrollmentPreviewModal.tsx');
  const card = modal.slice(modal.indexOf('function MessageStepCard('), modal.indexOf('function SummaryMode('));
  assert.equal([...card.matchAll(/disabled=\{candidateBusy\}/g)].length, 2, '« Régénérer » et « Réessayer »');
  assert.match(modal, /candidateBusy=\{selectedGenerating\}/);
  assert.match(modal, /onRegenerate=\{\(\) => \{ void regenerateCandidateStep\(selectedCandidateId, step\.stepId\); \}\}/);
  assert.match(modal, /if \(outcome === 'previous_missing'\) \{\s*toast\.info\("Générez d'abord le message précédent de ce candidat : celui-ci s'appuie sur lui\."\);/);
  // Résumé : la ligne des adresses e-mail seulement si une étape e-mail part.
  const summary = modal.slice(modal.indexOf('function SummaryMode('), modal.indexOf('function SummaryRow('));
  assert.match(summary, /\{candidateAnalysis\.withEmail > 0 && emailSteps\.length > 0 && \(/);
});

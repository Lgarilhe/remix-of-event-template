/**
 * Audit du module séquences (2026-09-25), lot F4, dernière passe (fiche
 * final2/F4.md) : points de la relecture ciblée de la vague finale.
 *
 * - front-enroll-follow-1 : déjà en relation + séquence qui ne contient
 *   qu'une invitation = bloquant (rien ne partirait) ; avertissement seulement
 *   s'il reste un message ou un InMail après l'invitation.
 * - front-enroll-follow-2 : D2 dans l'aperçu (canaux e-mail et WhatsApp
 *   fermés) : ni génération facturée, ni étape comptée comme envoyée, ni appel
 *   à l'enrichissement, ni annonce comme première action.
 * - front-enroll-follow-3 : la confirmation « Fermer sans inscrire ? »
 *   neutralise la préparation et ne ferme jamais pendant une inscription.
 *
 * Lancer : node --test tests/ux/seq-audit-f4-final2.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build, transform } from 'esbuild';

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

/** Évalue une fonction TypeScript autonome extraite d'un fichier source. */
async function evalFunction(source, name) {
  const body = slice(source, `function ${name}(`, '\n}\n') + '\n}\n';
  const { code } = await transform(body, { loader: 'ts' });
  return new Function(`${code}; return ${name};`)();
}

const previewModal = read('src/components/outreach/EnrollmentPreviewModal.tsx');
const enrollModal = read('src/components/outreach/SequenceEnrollModal.tsx');
const treeView = read('src/components/outreach/enrollment-preview/SequenceTreeView.tsx');

const compat = await loadModule('src/lib/sequenceCompatibility.ts');
const helpers = await loadModule('src/components/outreach/enrollment-preview/enrollmentHelpers.ts');

// Hook d'aperçu avec un React minimal (état initial, callbacks directs) et une
// génération factice qui enregistre chaque appel facturé.
const REACT_STUB = 'export const useState = (i) => [typeof i === "function" ? i() : i, () => {}]; export const useCallback = (f) => f; export const useRef = (v) => ({ current: v }); export const useEffect = () => {}; export const useMemo = (f) => f(); export default {};';
const previewHookModule = await loadModule('src/hooks/useEnrollmentPreview.ts', {
  react: REACT_STUB,
  '@/lib/invokeWithCredits': 'export const invokeWithCredits = async (fn, action, body) => { (globalThis.__f4Final2Calls ||= []).push(body); return { data: { message: "Texte " + body.sequenceContext.currentActionType }, error: null }; }; export const estimateActionCredits = () => 1;',
  '@/integrations/supabase/client': 'export const supabase = {};',
  '@/hooks/useAuthReady': 'export const useAuthReady = () => ({ user: null });',
});

function takeGenerationCalls() {
  const calls = globalThis.__f4Final2Calls || [];
  globalThis.__f4Final2Calls = [];
  return calls;
}

const relation = { id: 'r', name: 'Relation directe', network_distance: 'FIRST_DEGREE' };

// ---------------------------------------------------------------- front-enroll-follow-1
test('front-enroll-follow-1 — déjà en relation + invitation seule : bloquant, rien ne partirait', () => {
  const inviteOnly = [{ action_type: 'connection_request', step_order: 0 }];
  const res = compat.checkProfilesCompat([relation], inviteOnly);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.blockers.length, 1);
  assert.equal(res.blockers[0].issue, 'connection_only_already_connected');
  assert.equal(res.blockers[0].message, "Déjà en relation : cette séquence ne contient qu'une invitation, rien ne lui sera envoyé.");

  // Visite de profil puis invitation : même chose.
  const visitThenInvite = [{ action_type: 'profile_visit', step_order: 0 }, { action_type: 'connection_request', step_order: 1 }];
  assert.deepEqual(compat.checkProfilesCompat([relation], visitThenInvite).blockers.map(r => r.issue), ['connection_only_already_connected']);

  // Une étape e-mail ou WhatsApp (canal fermé, D2) ne compte pas comme suite.
  for (const closed of ['email', 'whatsapp_message']) {
    const steps = [{ action_type: 'connection_request', step_order: 0 }, { action_type: closed, step_order: 1 }];
    assert.deepEqual(compat.checkProfilesCompat([relation], steps).blockers.map(r => r.issue), ['connection_only_already_connected'], closed);
  }

  // Une suite LinkedIn (message, message IA, InMail) : simple avertissement.
  for (const next of ['message', 'smart_message', 'inmail']) {
    const steps = [{ action_type: 'connection_request', step_order: 0 }, { action_type: next, step_order: 1 }];
    const r = compat.checkProfilesCompat([relation], steps);
    assert.deepEqual(r.blockers, [], next);
    assert.equal(r.warnings[0]?.issue, 'connection_already_connected', next);
  }

  // Un candidat au 2e degré reste compatible avec une invitation seule.
  assert.equal(compat.checkProfilesCompat([{ id: 'deux', network_distance: 2 }], inviteOnly).compatible.length, 1);
});

test('front-enroll-follow-1 — les fenêtres excluent ce candidat et le disent', async () => {
  // Inscription simple : « Exclure les incompatibles » le vise (seul
  // connection_already_connected est retiré du filtre) avec son propre libellé.
  assert.match(enrollModal, /\[\.\.\.compat\.blockers, \.\.\.compat\.warnings\]\.filter\(r => r\.issue !== 'connection_already_connected'\)/);
  const label = slice(enrollModal, 'function compatExclusionLabel(', '\n}\n');
  assert.match(label, /if \(issue === 'connection_only_already_connected'\) return 'Déjà en relation, exclu';/);

  // Aperçu : exclu par défaut (blockers) avec une raison propre dans le titre.
  assert.match(previewModal, /const incompatibleIds = useMemo\(\(\) => new Set\(compat\.blockers\.map\(r => r\.profile\.id\)\), \[compat\.blockers\]\);/);
  const compatHeadline = await evalFunction(previewModal, 'compatHeadline');
  const one = compat.checkProfilesCompat([relation], [{ action_type: 'connection_request', step_order: 0 }]).blockers;
  assert.equal(
    compatHeadline(one, false),
    "1 candidat ne peut pas suivre cette séquence : déjà en relation, et la séquence ne contient qu'une invitation. Il est exclu de l'inscription.",
  );
  assert.match(compatHeadline([{ issue: 'too_far' }, { issue: 'too_far' }], true), /hors de votre réseau LinkedIn, seul un InMail peut les atteindre\. Ils seront inscrits quand même\.$/);
});

// ---------------------------------------------------------------- front-enroll-follow-2
test('front-enroll-follow-2 — un seul miroir des canaux fermés, dérivé de l’éditeur', () => {
  assert.deepEqual([...compat.CLOSED_CHANNEL_ACTION_TYPES], ['email', 'whatsapp_message']);
  assert.equal(compat.isClosedChannelStep('email'), true);
  assert.equal(compat.isClosedChannelStep('whatsapp_message'), true);
  for (const open of ['message', 'smart_message', 'inmail', 'connection_request', 'profile_visit', null, undefined, '']) {
    assert.equal(compat.isClosedChannelStep(open), false, String(open));
  }
});

test('front-enroll-follow-2 — aperçu : ni génération facturée pour un e-mail, ni e-mail compté comme envoyé', async () => {
  takeGenerationCalls();
  const profile = { id: 'p1', name: 'Julie Martin', first_name: 'Julie', network_distance: 2 };
  const steps = [
    { stepId: 'mail', stepOrder: 0, actionType: 'email', messageTemplate: 'Bonjour {{first_name}}', subjectTemplate: 'Objet', useAiPersonalization: true },
    { stepId: 'wa', stepOrder: 1, actionType: 'whatsapp_message', messageTemplate: 'Coucou', subjectTemplate: '', useAiPersonalization: true },
    { stepId: 'msg', stepOrder: 2, actionType: 'message', messageTemplate: 'Salut {{first_name}}', subjectTemplate: '', useAiPersonalization: true },
  ];
  const hook = previewHookModule.useEnrollmentPreview({ steps, profiles: [profile], job: null, accountId: 'acc' });

  assert.deepEqual(hook.messageSteps.map(s => s.stepId), ['msg']);
  assert.equal(hook.hasAiSteps, true);
  // Lot 5e-2 : coût d'un message au niveau choisi (Équilibré tant que les réglages ne sont pas lus).
  assert.equal(hook.estimatedCredits, hook.creditsPerMessage, 'une seule génération facturée par candidat (le message LinkedIn)');

  await hook.generateForCandidateById('p1');
  const calls = takeGenerationCalls();
  assert.equal(calls.length, 1, 'aucune génération pour les étapes e-mail et WhatsApp');
  assert.equal(calls[0].sequenceContext.currentActionType, 'message');
  assert.deepEqual(calls[0].sequenceContext.prevSentSteps, [], "l'e-mail sauté n'est pas un message déjà reçu (sinon « relance »)");

  // Régénération d'une étape : même historique ; une étape e-mail n'est jamais générée.
  await hook.regenerateStep('p1', 'msg');
  const regen = takeGenerationCalls();
  assert.equal(regen.length, 1);
  assert.deepEqual(regen[0].sequenceContext.prevSentSteps, []);
  await hook.regenerateStep('p1', 'mail');
  assert.equal(takeGenerationCalls().length, 0);

  // Une vraie étape LinkedIn antérieure reste comptée.
  const withInvite = [
    { stepId: 'inv', stepOrder: 0, actionType: 'connection_request', messageTemplate: 'Ravi de vous suivre', subjectTemplate: '', useAiPersonalization: false },
    ...steps,
  ];
  const hook2 = previewHookModule.useEnrollmentPreview({ steps: withInvite, profiles: [profile], job: null, accountId: 'acc' });
  await hook2.generateForCandidateById('p1');
  const calls2 = takeGenerationCalls();
  assert.equal(calls2.length, 1);
  assert.deepEqual(calls2[0].sequenceContext.prevSentSteps.map(s => s.actionType), ['connection_request']);
});

test('front-enroll-follow-2 — récapitulatif : un avis, plus d’appel à l’enrichissement pour un canal fermé', () => {
  const summary = slice(previewModal, 'function SummaryMode(', '\nfunction ');
  assert.match(summary, /const emailSteps = steps\.filter\(s => s\.actionType === 'email' && !isClosedChannelStep\(s\.actionType\)\);/);
  assert.match(summary, /const whatsappSteps = steps\.filter\(s => s\.actionType === 'whatsapp_message' && !isClosedChannelStep\(s\.actionType\)\);/);
  assert.match(summary, /Les étapes \{closedChannels\.join\(' et '\)\} ne partent pas encore : elles seront sautées\./);
  // Les cartes d'aperçu ne proposent pas de générer un e-mail sauté.
  assert.match(previewModal, /const isMessageStep = isPreviewedMessageStep\(step\);/);
  assert.match(previewModal, /const hasSendableMessage = useMemo\(\(\) => steps\.some\(isPreviewedMessageStep\), \[steps\]\);/);
  const previewed = slice(previewModal, 'function isPreviewedMessageStep(', '\n}\n');
  assert.match(previewed, /!isClosedChannelStep\(step\.actionType\)/);
  // L'arbre signale l'étape sautée.
  assert.match(treeView, /isClosedChannelStep\(step\.actionType\) && \(/);
});

test('front-enroll-follow-2 — une première étape e-mail n’est pas annoncée comme première action', () => {
  assert.equal(
    helpers.firstActionSummary([{ id: 'a', stepOrder: 0, actionType: 'email' }, { id: 'b', stepOrder: 1, actionType: 'message', delayDays: 3 }]),
    "Première étape (E-mail) sautée : ce canal n'est pas encore disponible. La séquence continue avec l'étape suivante.",
  );
  assert.equal(
    helpers.firstActionSummary([{ id: 'w', step_order: 0, action_type: 'whatsapp_message', delay_days: 1 }]),
    "Première étape (WhatsApp) sautée : ce canal n'est pas encore disponible. La séquence continue avec l'étape suivante.",
  );
  // Inchangé pour une étape LinkedIn.
  assert.equal(helpers.firstActionSummary([{ id: 'x', stepOrder: 0, actionType: 'inmail', delayHours: 3 }]), "Première action : InMail, dans 3 heures, pendant vos heures d'envoi");
});

// ---------------------------------------------------------------- front-enroll-follow-3
// Revue design : confirmation du kit (AlertDialog, aria-modal), rendue après la
// fenêtre au même calque : son voile couvre la préparation, qui n'a plus à être
// neutralisée à la main. Confirmer ne ferme jamais pendant une inscription.
test('front-enroll-follow-3 — « Fermer sans inscrire » : préparation neutralisée, jamais de fermeture en pleine inscription', () => {
  const confirm = slice(previewModal, '<AlertDialog open={confirmCloseOpen}', '</AlertDialog>');
  assert.match(confirm, /<AlertDialogAction onClick=\{confirmClose\}>/);
  const onConfirm = slice(previewModal, 'const confirmClose = () => {', '\n  };\n');
  assert.match(onConfirm, /setConfirmCloseOpen\(false\);[\s\S]*if \(isBusy\) return;[\s\S]*onClose\(\);/);
  assert.doesNotMatch(onConfirm, /setConfirmCloseOpen\(false\);\s*onClose\(\);/);
  assert.ok(previewModal.indexOf('</Dialog>') < previewModal.indexOf('<AlertDialog open={confirmCloseOpen}'), 'confirmation hors de la fenêtre, posée au-dessus');
  const kit = read('src/components/ui/alert-dialog.tsx');
  assert.match(kit, /<AlertDialogOverlay \/>/);
  assert.match(kit, /fixed inset-0 z-modal bg-black/);
  assert.match(kit, /aria-modal="true"/);
});

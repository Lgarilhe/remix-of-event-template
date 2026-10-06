/**
 * Refonte mission, lot 5a : garde-fous d'envoi.
 *
 * - Case « Je confirme les destinataires » obligatoire dès 5 candidats
 *   (décisions 4 et 7 du lot 5) dans la préparation avec aperçu
 *   (EnrollmentPreviewModal), l'inscription simple (SequenceEnrollModal) et
 *   l'InMail groupé (BulkInMailModal), sur le nombre du bouton, avec le
 *   premier message en entier au-dessus.
 * - Carte d'approbation de l'assistant : premier message entier, sans
 *   troncature.
 * - Plus aucune phrase qui promet une rédaction par l'IA « au moment de
 *   l'envoi » (la relecture devient obligatoire au lot 5a-2).
 *
 * Le module pur est transpilé par esbuild et exécuté ; les écrans sont
 * vérifiés par inspection du code source, comme les autres tests de tests/ux.
 *
 * Lancer : node --test tests/ux/lot5a-destinataires.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

async function loadModule(rel) {
  const result = await build({
    entryPoints: [path.join(ROOT, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

/** Transpile et charge un module TypeScript ; les imports « @/ » sont résolus dans src/, sauf `stubs`. */
async function loadWithStubs(rel, stubs = {}) {
  const resolveSrc = (spec) => {
    const base = path.join(ROOT, 'src', spec.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`module introuvable : ${spec}`);
  };
  const result = await build({
    entryPoints: [path.join(ROOT, rel)],
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

function between(source, from, to) {
  const a = source.indexOf(from);
  assert.ok(a >= 0, `« ${from} » introuvable`);
  const b = source.indexOf(to, a + from.length);
  assert.ok(b > a, `« ${to} » introuvable après « ${from} »`);
  return source.slice(a, b);
}

const guard = await loadModule('src/lib/contactRecipientsGuard.ts');
const path5a = await loadModule('src/components/outreach/enrollment-preview/firstMessagePath.ts');
const previewHook = await loadWithStubs('src/hooks/useEnrollmentPreview.ts', {
  react: 'export const useState = (i) => [typeof i === "function" ? i() : i, () => {}]; export const useCallback = (f) => f; export const useRef = (v) => ({ current: v }); export const useEffect = () => {}; export const useMemo = (f) => f(); export default {};',
  '@/lib/invokeWithCredits': 'export const invokeWithCredits = async () => ({ data: null, error: null }); export const estimateActionCredits = () => 1;',
  '@/integrations/supabase/client': 'export const supabase = {};',
  '@/hooks/useAuthReady': 'export const useAuthReady = () => ({ user: null });',
});
const guardSrc = read('src/lib/contactRecipientsGuard.ts');
const confirm = read('src/components/outreach/enrollment-preview/RecipientsConfirm.tsx');
const confirmHook = read('src/components/outreach/enrollment-preview/useRecipientsConfirm.ts');
const previewModal = read('src/components/outreach/EnrollmentPreviewModal.tsx');
const enrollModal = read('src/components/outreach/SequenceEnrollModal.tsx');
const bulkInMail = read('src/components/outreach/BulkInMailModal.tsx');
const approvalCard = read('src/components/agent/AgentToolApprovalCard.tsx');
const firstMessageCard = read('src/components/agent/EnrollFirstMessagePreview.tsx');
const firstStepPreviewSrc = read('src/components/agent/firstStepPreview.ts');
const journal = read('src/components/settings/AgentActionsSettings.tsx');
const activityLog = read('src/components/outreach/SequenceActivityLog.tsx');
const firstMessagePathSrc = read('src/components/outreach/enrollment-preview/firstMessagePath.ts');
const enrollPreview = read('supabase/functions/_shared/enroll-preview.ts');

const ids = (n) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

// ─── Module pur ─────────────────────────────────────────────────────────

test('5a — module pur : 4 sans case, 5 avec case', () => {
  assert.equal(guard.RECIPIENTS_CONFIRM_THRESHOLD, 5);
  assert.equal(guard.recipientsConfirmRequired(4), false);
  assert.equal(guard.recipientsConfirmRequired(5), true);
  assert.equal(guard.recipientsConfirmRequired(0), false);
  assert.equal(guard.recipientsConfirmBlocks(ids(4), null), false);
  assert.equal(guard.recipientsConfirmBlocks(ids(5), null), true);
  assert.equal(guard.RECIPIENTS_CONFIRM_LABEL, 'Je confirme les destinataires');
  assert.equal(guard.RECIPIENTS_CONFIRM_HELP, 'Obligatoire à partir de 5 candidats.');
  // Module sans import : testable seul, réutilisable en 5a-2 et 5f-2.
  assert.doesNotMatch(guardSrc, /^import /m);
});

test('5a — module pur : la case cochée ne vaut que pour la liste affichée', () => {
  const five = ids(5);
  const signature = guard.recipientsSignature(five);
  assert.equal(guard.recipientsConfirmBlocks(five, signature), false, 'case cochée pour cette liste');
  // Indépendante de l'ordre.
  assert.equal(guard.recipientsSignature([...five].reverse()), signature);
  // Un candidat retiré, ajouté ou remplacé : nouvelle signature, case à recocher.
  const six = ids(6);
  assert.notEqual(guard.recipientsSignature(six), signature);
  assert.equal(guard.recipientsConfirmBlocks(six, signature), true);
  const replaced = [...five.slice(0, 4), 'c9'];
  assert.notEqual(guard.recipientsSignature(replaced), signature);
  assert.equal(guard.recipientsConfirmBlocks(replaced, signature), true);
  // Retiré sous le seuil : plus de case.
  assert.equal(guard.recipientsConfirmBlocks(five.slice(0, 4), signature), false);
});

// ─── Composant ──────────────────────────────────────────────────────────

test('5a — RecipientsConfirm : case, aide reliée par aria-describedby, rien sous 5', () => {
  const component = between(confirm, 'export function RecipientsConfirm(', '\n}\n');
  // Lot 5a-2 : libellé, aide et seuil viennent de sendConfirmation (case de
  // relecture des messages IA). Sans étape IA : la case des destinataires, rien sous 5.
  assert.match(component, /const \{ required, label, help \} = sendConfirmation\(count, aiReview\);/);
  assert.match(component, /if \(!required\) return null;/);
  assert.match(component, /aiReview = false,/);
  assert.equal(guard.sendConfirmation(4, false).required, false);
  assert.deepEqual(guard.sendConfirmation(5, false), { required: true, label: guard.RECIPIENTS_CONFIRM_LABEL, help: guard.RECIPIENTS_CONFIRM_HELP });
  assert.match(component, /aria-describedby=\{helpId\}/);
  assert.match(component, /<p id=\{helpId\}[^>]*>\{help\}<\/p>/);
  assert.match(component, /<Label htmlFor=\{checkboxId\}[\s\S]*?\{label\}/);
  // Premier message au-dessus de la case, réservé au seuil de 5.
  assert.ok(component.indexOf('<FirstMessagePreviewBlock') < component.indexOf('<Checkbox'));
  assert.match(component, /\{preview && recipientsConfirmRequired\(count\) && <FirstMessagePreviewBlock/);
  // Décochée dès que la liste change.
  const hook = between(confirmHook, 'export function useRecipientsConfirm(', '\n}\n');
  assert.match(hook, /const signature = sendConfirmSignature\(recipientIds, aiReview, options\.aiGenerationVersion \?\? 0\);/);
  assert.equal(guard.sendConfirmSignature(['b', 'a'], false), guard.recipientsSignature(['a', 'b']));
  assert.match(hook, /useEffect\(\(\) => \{\s*setConfirmedFor\(null\);\s*\}, \[signature\]\);/);
  assert.match(hook, /blocked: required && confirmedFor !== signature,/);
});

test('5a — premier message en entier, dans un bloc qui défile ; IA annoncée avec sa génération', () => {
  const block = between(confirm, 'export function FirstMessagePreviewBlock(', '\n}\n');
  assert.match(block, /max-h-40 space-y-2 overflow-y-auto/);
  assert.match(block, /whitespace-pre-wrap break-words/);
  assert.doesNotMatch(block, /\.slice\(|line-clamp/, 'texte tronqué');
  assert.match(block, /Premier message, pour \$\{preview\.candidateName\}/);
  assert.match(block, /Message rédigé par l'IA Konekt pour ce candidat : générez-le pour le relire\./);
  assert.match(block, /Générer l'aperçu/);
  assert.match(block, /aria-label="Candidat précédent"/);
  assert.match(block, /aria-label="Candidat suivant"/);
});

// ─── Trois fenêtres ─────────────────────────────────────────────────────

test('5a — préparation avec aperçu : case sur activeProfiles.length, bouton désactivé sans elle', () => {
  // Lot 5a-2 : la même case vaut relecture des messages IA.
  assert.match(previewModal, /const recipients = useRecipientsConfirm\(activeProfiles\.map\(p => p\.id\), \{ aiReview: hasAiReview, aiGenerationVersion \}\);/);
  assert.match(previewModal, /<RecipientsConfirm\s+count=\{activeProfiles\.length\}\s+confirmed=\{recipients\.confirmed\}\s+onConfirmedChange=\{recipients\.setConfirmed\}/);
  // Même nombre que le bouton « Inscrire N candidats ».
  assert.match(previewModal, /`Inscrire \$\{plural\(activeProfiles\.length, 'candidat'\)\}`/);
  assert.match(previewModal, /disabled=\{isBusy \|\| activeProfiles\.length === 0 \|\| duplicatesUnchecked \|\| !!sendingAccount\.blockReason \|\| recipients\.blocked \|\| aiReviewMissingCount > 0\}/);
  const enroll = between(previewModal, 'const handleEnroll = async () => {', 'setIsEnrolling(true);');
  assert.match(enroll, /if \(recipients\.blocked \|\| aiReviewMissingCount > 0\) return;/);
  // La case est dans le pied, avant les boutons.
  const footer = between(previewModal, '<SendingAccountNotice state={sendingAccount} />', 'Présélectionner sans message');
  assert.match(footer, /<RecipientsConfirm/);
});

test('5a — inscription simple : case sur enrollCount, bouton désactivé sans elle', () => {
  assert.match(enrollModal, /const recipients = useRecipientsConfirm\(profilesToEnroll\.map\(p => p\.id\)\);/);
  assert.match(enrollModal, /const enrollCount = profilesToEnroll\.length;/);
  assert.match(enrollModal, /<RecipientsConfirm\s+count=\{enrollCount\}\s+confirmed=\{recipients\.confirmed\}/);
  assert.match(enrollModal, /disabled=\{isEnrolling \|\| enrollCount === 0 \|\| duplicatesUnchecked \|\| !!sendingAccount\.blockReason \|\| recipients\.blocked\}/);
  const enroll = between(enrollModal, 'const handleEnroll = async () => {', 'setIsEnrolling(true);');
  assert.match(enroll, /if \(recipients\.blocked\) return;/);
  // Séquence sans message : l'aperçu nomme la première action.
  assert.match(enrollModal, /`Aucun message écrit\. Première action : \$\{label\.charAt\(0\)\.toLowerCase\(\)\}\$\{label\.slice\(1\)\}\.`/);
  // Un message rédigé par l'IA sans modèle compte comme message : préparation avec aperçu.
  const hasMessageSteps = between(enrollModal, 'const hasMessageSteps = useMemo(() => {', '}, [sequence.steps]);');
  assert.match(hasMessageSteps, /\|\| hasMessage\(\{ actionType, messageTemplate: template, useAiPersonalization \}\)/);
  // Le hook est appelé avant les retours anticipés (règle des hooks).
  assert.ok(enrollModal.indexOf('useRecipientsConfirm(') < enrollModal.indexOf('if (!canSendSequences) {'));
});

test('5a — InMail groupé : case sur readyCount et premier InMail (objet et texte)', () => {
  assert.match(bulkInMail, /const readyCount = Object\.keys\(generatedMessages\)\.filter\(id => currentRecipientIds\.has\(id\)\)\.length;/);
  // Destinataires avec un message : exactement ceux que compte readyCount.
  assert.match(bulkInMail, /const withMessage = recipients\.filter\(r => generatedMessages\[r\.id\]\);/);
  assert.match(bulkInMail, /const recipientsConfirm = useRecipientsConfirm\(withMessage\.map\(r => r\.id\)\);/);
  assert.match(bulkInMail, /<RecipientsConfirm\s+count=\{readyCount\}/);
  assert.match(bulkInMail, /label: 'InMail', subject: firstReadyMessage\.subject \|\| null, text: firstReadyMessage\.message/);
  assert.match(bulkInMail, /duplicatesUnchecked \|\| recipientsConfirm\.blocked\}/);
  const queue = between(bulkInMail, 'const handleQueueAll = async () => {', 'setIsQueueing(true);');
  assert.match(queue, /if \(recipientsConfirm\.blocked\) return;/);
  // L'AlertDialog « Planifier N InMails ? » reste.
  assert.match(bulkInMail, /<AlertDialogTitle>Planifier \{readyCount\} InMail\{readyCount > 1 \? 's' : ''\} \?<\/AlertDialogTitle>/);
});

test('5a — Récapitulatif : « Aperçu du premier message » avec ‹ ›, premier candidat prêt', () => {
  const summary = between(previewModal, 'function SummaryMode(', 'function SummaryRow(');
  assert.match(summary, /<FirstMessagePreviewBlock\s+preview=\{firstMessage\}\s+title="Aperçu du premier message"\s+navigation=\{firstMessageNavigation\}/);
  assert.match(previewModal, /return messages\.length > 0 && messages\.every\(m => isReady\(p\.id, m\.step\.stepId\)\);/);
  assert.match(previewModal, /onNext: \(\) => setSummaryCandidateIndex\(Math\.min\(activeProfiles\.length - 1, summaryIndex \+ 1\)\),/);
  // Étape rédigée par l'IA non générée : annoncée, jamais inventée, avec sa génération.
  const firstFor = between(previewModal, 'const firstMessageFor = (profile: LinkedInProfile): FirstMessagePreview => {', '// Pied :');
  assert.match(firstFor, /if \(step\.useAiPersonalization && step\.actionType !== 'connection_request'\) \{[\s\S]*?aiPending: true,\s*onGenerate: \(\) => regenerateStep\(profile\.id, step\.stepId\),/);
  // Premier message choisi sur le parcours de la séquence, jamais sur la liste des messages écrits.
  assert.match(previewModal, /return firstMessagePath\(steps, isPreviewedMessageStep, connected\);/);
  assert.doesNotMatch(previewModal, /messageSteps\[0\]/);
});

// ─── Carte d'approbation ────────────────────────────────────────────────

test('5a — carte d’approbation : premier message entier, sans troncature', () => {
  const block = between(firstMessageCard, 'export const EnrollFirstMessagePreview', '\n};\n');
  assert.match(block, /Premier message pour \{name\}/);
  assert.match(block, /whitespace-pre-wrap break-words/);
  assert.doesNotMatch(block, /\.slice\(|truncate|line-clamp|substring\(/, 'texte tronqué');
  assert.match(block, /Ce candidat n'est pas encore dans la mission : aperçu construit avec son seul nom\./);
  assert.match(block, /t\.missing\.map/);
  assert.match(block, /Objet : /);
  // Lecture de details.first_step_preview, rendue pour enroll_in_sequence seulement.
  assert.match(firstStepPreviewSrc, /const raw = details\?\.first_step_preview;/);
  // Visible aussi en mode Modifier, dont les champs de l'aperçu sont en lecture seule.
  assert.match(approvalCard, /\{row\.tool_name === 'enroll_in_sequence' && firstStepPreview && \(/);
  assert.match(approvalCard, /enroll_in_sequence: new Set\(\['profile_name', 'profile_url'\]\),/);
  assert.match(approvalCard, /READONLY_FIELDS_BY_TOOL\[toolName\]\?\.has\(key\)/);
  assert.match(approvalCard, /toolName=\{row\.tool_name\}/);
  assert.doesNotMatch(approvalCard, /re-runs dryRun/);
  // Un candidat par carte : pas de case des destinataires ici.
  assert.doesNotMatch(approvalCard, /RecipientsConfirm/);
});

test('5a — aperçu serveur : libellés et données absentes en français', () => {
  assert.match(enrollPreview, /'Invitation avec note' : 'Invitation sans note'/);
  assert.match(enrollPreview, /poste_actuel: 'Poste actuel inconnu : retiré du message\.',/);
  assert.match(enrollPreview, /check_connection: \{ yes: 'Si déjà en relation', no: 'Sinon' \},/);
  assert.match(enrollPreview, /`Version \$\{s\.variant_group\} selon le tirage`/);
});

test('5a — Journal : une inscription proposée montre son premier message avant « Approuver »', () => {
  assert.match(journal, /import \{ EnrollFirstMessagePreview \} from '@\/components\/agent\/EnrollFirstMessagePreview';/);
  assert.match(journal, /import \{ readFirstStepPreview \} from '@\/components\/agent\/firstStepPreview';/);
  const row = between(journal, 'function ActionRow(', '\n}\n');
  assert.match(row, /action\.tool_name === 'enroll_in_sequence' && action\.status === 'proposed'\s*\? readFirstStepPreview\(action\.dry_run_result\?\.details\)/);
  assert.ok(row.indexOf('<EnrollFirstMessagePreview') > 0, 'aperçu rendu dans la ligne');
  assert.ok(row.indexOf('<EnrollFirstMessagePreview') < row.indexOf('Approuver'), 'aperçu avant le bouton');
});

test('5a — journal de la séquence : la source IA dit que rien n’est encore généré', () => {
  assert.match(activityLog, /ai: "Message de l'IA Konekt pour ce candidat, pas encore généré",/);
});

// ─── Étapes à message et parcours du premier message ────────────────────

const st = (stepId, stepOrder, actionType, over = {}) => ({
  stepId, stepOrder, actionType, messageTemplate: '', subjectTemplate: '', useAiPersonalization: false, ...over,
});

test('5a — hasMessage : un message rédigé par l’IA compte même sans modèle, jamais une invitation sans note', () => {
  const { hasMessage } = previewHook;
  assert.equal(hasMessage(st('a', 0, 'message', { useAiPersonalization: true })), true);
  assert.equal(hasMessage(st('b', 0, 'smart_message', { useAiPersonalization: true })), true);
  assert.equal(hasMessage(st('c', 0, 'inmail', { useAiPersonalization: true })), true);
  assert.equal(hasMessage(st('d', 0, 'message', { messageTemplate: 'Bonjour' })), true);
  // Le moteur ne rédige pas de note : une invitation sans note n'a rien à montrer.
  assert.equal(hasMessage(st('e', 0, 'connection_request', { useAiPersonalization: true })), false);
  assert.equal(hasMessage(st('f', 0, 'connection_request')), false);
  assert.equal(hasMessage(st('g', 0, 'connection_request', { messageTemplate: 'Note' })), true);
  // Canal fermé : sauté par le moteur.
  assert.equal(hasMessage(st('h', 0, 'email', { useAiPersonalization: true })), false);
  assert.equal(hasMessage(st('i', 0, 'message')), false);
});

const ids5a = (r) => r.messages.map((m) => [m.step.stepId, m.condition]);

test('5a — parcours : message IA sans modèle avant une relance écrite, c’est lui le premier message', () => {
  const steps = [
    st('visit', 0, 'profile_visit'),
    st('ai', 1, 'smart_message', { useAiPersonalization: true }),
    st('wait', 2, 'wait_reply'),
    st('relance', 3, 'message', { messageTemplate: 'Relance {{first_name}}' }),
  ];
  const r = path5a.firstMessagePath(steps, previewHook.hasMessage);
  assert.deepEqual(ids5a(r), [['ai', null]]);
  assert.equal(r.firstAction.stepId, 'visit');
});

test('5a — parcours : invitation sans note passée, le message suivant est montré', () => {
  const steps = [
    st('visit', 0, 'profile_visit'),
    st('invite', 1, 'connection_request'),
    st('wait', 2, 'wait_connection'),
    st('msg', 3, 'message', { messageTemplate: 'Bonjour {{first_name}}' }),
  ];
  assert.deepEqual(ids5a(path5a.firstMessagePath(steps, previewHook.hasMessage)), [['msg', null]]);
});

test('5a — parcours : « Vérifier la relation » suit la branche du candidat, sinon montre les deux', () => {
  const steps = [
    st('check', 0, 'check_connection'),
    st('yes-wait', 1, 'wait_reply', { parentStepId: 'check', branch: 'yes' }),
    st('yes-msg', 2, 'message', { parentStepId: 'check', branch: 'yes', messageTemplate: 'Ravi d’échanger' }),
    st('no-invite', 1, 'connection_request', { parentStepId: 'check', branch: 'no', messageTemplate: 'Note' }),
  ];
  // Déjà en relation : la branche « oui », sans condition.
  assert.deepEqual(ids5a(path5a.firstMessagePath(steps, previewHook.hasMessage, true)), [['yes-msg', null]]);
  // Pas en relation : la branche « non ».
  assert.deepEqual(ids5a(path5a.firstMessagePath(steps, previewHook.hasMessage, false)), [['no-invite', null]]);
  // Relation inconnue : les deux, avec leur condition.
  assert.deepEqual(ids5a(path5a.firstMessagePath(steps, previewHook.hasMessage, null)), [
    ['yes-msg', 'Si déjà en relation'],
    ['no-invite', 'Sinon'],
  ]);
});

test('5a — parcours : test A/B, chaque version avec sa condition ; séquence sans message, première action', () => {
  const ab = [
    st('msg-b', 0, 'message', { variantGroup: 'B', messageTemplate: 'B' }),
    st('msg-a', 0, 'message', { variantGroup: 'A', messageTemplate: 'A' }),
  ];
  assert.deepEqual(ids5a(path5a.firstMessagePath(ab, previewHook.hasMessage)), [
    ['msg-a', 'Version A'],
    ['msg-b', 'Version B selon le tirage'],
  ]);
  const none = path5a.firstMessagePath([st('visit', 0, 'profile_visit'), st('check', 1, 'check_connection')], previewHook.hasMessage);
  assert.deepEqual(none.messages, []);
  assert.equal(none.firstAction.stepId, 'visit');
  // Module pur, sans import.
  assert.doesNotMatch(firstMessagePathSrc, /^import /m);
});

// ─── Textes ─────────────────────────────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

test('5a — aucune phrase qui annonce une rédaction par l’IA « au moment de l’envoi » sous src/', () => {
  const offenders = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/au moment de l['’]envoi/.test(line) && /\bIA\b|rédig|écri|personnalis[ée] par/i.test(line)) {
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test('5a — aucun nom de prestataire ni « Notion » dans les textes nouveaux', () => {
  const vendor = /Unipile|Apollo|\bPDL\b|People Data Labs|Anthropic|Claude|Brandfetch|Clearbit|Resend|Notion/;
  for (const [name, source] of [
    ['RecipientsConfirm', confirm],
    ['contactRecipientsGuard', guardSrc],
    ['enroll-preview', enrollPreview],
    ['carte d’approbation (premier message)', firstMessageCard],
    ['parcours du premier message', firstMessagePathSrc],
  ]) {
    assert.doesNotMatch(source, vendor, name);
  }
  // Vouvoiement et pas de tiret long dans les textes visibles nouveaux.
  assert.doesNotMatch(confirm, /—|\btu\b|\bton\b|\bta\b/);
});

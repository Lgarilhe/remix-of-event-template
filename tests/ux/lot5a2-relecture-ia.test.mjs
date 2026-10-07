/**
 * Refonte mission, lot 5a-2 : aucun message rédigé par l'IA ne part sans
 * relecture (décision 5 du lot 5), et correctif 2 (rémunération retirée des
 * aperçus de generate-outreach-message).
 *
 * - Moteur : garde `aiReviewRequired` placée avant hasTimeToLock, le verrou et
 *   checkQuotaForAction ; l'étape reste programmée, reportée d'une heure, sans
 *   pause ni échec.
 * - Préparation : bouton grisé tant qu'un texte IA manque, « Générer tous les
 *   aperçus », case de relecture (une seule case dès 5 candidats).
 * - Après l'inscription : « Relire le message » (suivi, Journal) n'écrit que
 *   final_message et final_subject d'une étape programmée.
 *
 * Les modules purs sont transpilés par esbuild et exécutés ; les écrans et le
 * moteur sont vérifiés par inspection du code source.
 *
 * Lancer : node --test tests/ux/lot5a2-relecture-ia.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

const rules = await loadModule('supabase/functions/_shared/sequence-send-rules.ts');
const guard = await loadModule('src/lib/contactRecipientsGuard.ts');
const errors = await loadModule('src/lib/sequenceErrorMessages.ts');
const previewHook = await loadModule('src/hooks/useEnrollmentPreview.ts', {
  react: 'export const useState = (i) => [typeof i === "function" ? i() : i, () => {}]; export const useCallback = (f) => f; export const useRef = (v) => ({ current: v }); export const useEffect = () => {}; export const useMemo = (f) => f(); export default {};',
  '@/lib/invokeWithCredits': 'export const invokeWithCredits = async () => ({ data: null, error: null }); export const estimateActionCredits = () => 1;',
  '@/integrations/supabase/client': 'export const supabase = {};',
  '@/hooks/useAuthReady': 'export const useAuthReady = () => ({ user: null });',
});

const engine = read('supabase/functions/process-sequences/index.ts');
const rulesSrc = read('supabase/functions/_shared/sequence-send-rules.ts');
const outreach = read('supabase/functions/generate-outreach-message/index.ts');
const hookSrc = read('src/hooks/useEnrollmentPreview.ts');
const guardSrc = read('src/lib/contactRecipientsGuard.ts');
const confirm = read('src/components/outreach/enrollment-preview/RecipientsConfirm.tsx');
const confirmHook = read('src/components/outreach/enrollment-preview/useRecipientsConfirm.ts');
const previewModal = read('src/components/outreach/EnrollmentPreviewModal.tsx');
const panel = read('src/components/outreach/SequenceEnrollmentsPanel.tsx');
const journal = read('src/components/outreach/SequenceActivityLog.tsx');
const editModal = read('src/components/outreach/activity-log/EditScheduledMessageModal.tsx');
const propose = read('src/components/outreach/activity-log/proposeAiMessage.ts');
const errorsSrc = read('src/lib/sequenceErrorMessages.ts');

const REASON = "Message rédigé par l'IA à relire avant l'envoi.";

// ─── Moteur ─────────────────────────────────────────────────────────────

test('5a-2 — aiReviewRequired : IA sans retouche vrai, retouche ou correction du Journal faux, invitation et IA désactivée faux, copie périmée vrai', () => {
  const base = { useAi: true, actionType: 'message', editedMessage: false, usedOverride: false };
  assert.equal(rules.aiReviewRequired(base), true);
  assert.equal(rules.aiReviewRequired({ ...base, usedOverride: true }), false);
  assert.equal(rules.aiReviewRequired({ ...base, editedMessage: true }), false);
  assert.equal(rules.aiReviewRequired({ ...base, actionType: 'connection_request' }), false);
  assert.equal(rules.aiReviewRequired({ ...base, useAi: false }), false);
  assert.equal(rules.aiReviewRequired({ ...base, editedMessage: true, staleTemplateSnapshot: true }), true);
  assert.equal(rules.AI_REVIEW_REQUIRED_MESSAGE, REASON);
  assert.equal(rules.AI_REVIEW_DEFER_MS, 60 * 60 * 1000);
  // Module pur : aucun import.
  assert.doesNotMatch(rulesSrc, /^import /m);
});

test('5a-2 — mêmes étapes que needsMessage du moteur, des deux côtés', () => {
  const needs = engine.match(/function needsMessage\(actionType: string\): boolean \{ return (\[[^\]]+\])\.includes\(actionType\); \}/);
  assert.ok(needs, 'needsMessage introuvable');
  const list = JSON.parse(needs[1].replace(/'/g, '"'));
  assert.deepEqual([...rules.AI_REVIEW_MESSAGE_ACTIONS], list);
  assert.deepEqual([...guard.AI_REVIEW_ACTION_TYPES], list);
  // Libellé du navigateur : la même raison que le moteur.
  assert.equal(errors.AI_REVIEW_REQUIRED_REASON, rules.AI_REVIEW_REQUIRED_MESSAGE);
});

test('5a-2 — garde placée après aiWillGenerate, avant hasTimeToLock, checkQuotaForAction et le verrou', () => {
  const at = engine.indexOf('if (aiReviewRequired({');
  assert.ok(at > 0, 'garde introuvable');
  assert.equal(engine.split('aiReviewRequired({').length - 1, 1, 'une seule garde');
  assert.ok(engine.indexOf('const aiWillGenerate = ') < at, 'après aiWillGenerate');
  assert.ok(at < engine.indexOf('if (!hasTimeToLock(cycleDeadline, Date.now(), { visible: isVisibleAction'), 'avant hasTimeToLock');
  assert.ok(at < engine.indexOf('const quotaCheck = await checkQuotaForAction('), 'avant checkQuotaForAction');
  assert.ok(at < engine.indexOf("status: 'sending',\n            // Fige le contenu"), 'avant le verrou');
  assert.ok(at < engine.indexOf('await generatePersonalizedMessage('), 'avant la rédaction (désormais injoignable)');
  assert.match(engine, /import \{ aiReviewRequired, AI_REVIEW_REQUIRED_MESSAGE, AI_REVIEW_DEFER_MS \} from "\.\.\/_shared\/sequence-send-rules\.ts";/);
});

test('5a-2 — branche de la garde : étape laissée programmée, +1 h, raison, comptée sautée ; ni pause, ni échec, ni essai, ni modèle', () => {
  const branch = between(engine, 'if (aiReviewRequired({', 'continue;\n        }');
  assert.match(branch, /useAi: !!step\.use_ai_personalization,/);
  assert.match(branch, /editedMessage,/);
  assert.match(branch, /usedOverride: usedPreviewOverride,/);
  assert.match(branch, /staleTemplateSnapshot,/);
  assert.match(branch, /scheduled_at: new Date\(Date\.now\(\) \+ AI_REVIEW_DEFER_MS\)\.toISOString\(\),/);
  assert.match(branch, /error_message: AI_REVIEW_REQUIRED_MESSAGE,/);
  assert.match(branch, /\.eq\('id', exec\.id\)\.eq\('status', 'scheduled'\);/);
  assert.match(branch, /results\.skipped\+\+;/);
  for (const forbidden of [/status: 'paused'/, /status: 'failed'/, /'failed'/, /retry_count/, /sequence_enrollments/, /pause_reason/, /generatePersonalizedMessage/, /settleCredits/, /checkQuotaForAction/, /status: 'sending'/]) {
    assert.doesNotMatch(branch, forbidden, String(forbidden));
  }
});

// ─── Préparation (avant l'inscription) ──────────────────────────────────

test('5a-2 — règles de la case : relecture quel que soit N, une seule case dès 5, signature décochée par une génération', () => {
  assert.deepEqual(guard.sendConfirmation(1, true), { required: true, label: "J'ai relu les messages rédigés par l'IA", help: guard.AI_REVIEW_HELP });
  assert.deepEqual(guard.sendConfirmation(5, true), { required: true, label: "Je confirme les destinataires et j'ai relu les messages rédigés par l'IA", help: guard.RECIPIENTS_AND_AI_REVIEW_HELP });
  assert.equal(guard.sendConfirmation(4, false).required, false);
  assert.equal(guard.sendConfirmation(5, false).label, 'Je confirme les destinataires');
  const ids = ['a', 'b'];
  assert.notEqual(guard.sendConfirmSignature(ids, true, 1), guard.sendConfirmSignature(ids, true, 2), 'une génération décoche');
  assert.notEqual(guard.sendConfirmSignature(ids, true, 1), guard.sendConfirmSignature(['a'], true, 1), 'un retrait décoche');
  assert.equal(guard.sendConfirmSignature(ids, false, 7), guard.recipientsSignature(ids), 'sans IA : la signature du lot 5a');
  assert.equal(guard.aiReviewMissingMessage(3, 5), "Générez et relisez les messages rédigés par l'IA avant d'inscrire : 3 candidats sur 5 n'en ont pas encore.");
  assert.equal(guard.aiReviewMissingMessage(1, 1), "Générez et relisez les messages rédigés par l'IA avant d'inscrire : 1 candidat sur 1 n'en a pas encore.");
  assert.equal(guard.requiresAiReview({ actionType: 'message', useAiPersonalization: true }), true);
  assert.equal(guard.requiresAiReview({ actionType: 'connection_request', useAiPersonalization: true }), false, 'une invitation n’est jamais rédigée par l’IA à l’envoi');
  assert.equal(guard.requiresAiReview({ actionType: 'message', useAiPersonalization: false }), false);
  assert.doesNotMatch(guardSrc, /^import /m, 'module pur');
});

test('5a-2 — hook : textes IA manquants comptés par candidat, numéro de génération incrémenté à chaque génération IA', () => {
  assert.match(hookSrc, /const aiReviewSteps = messageSteps\.filter\(requiresAiReview\);/);
  const missing = between(hookSrc, 'const aiReviewMissingCount = ', '\n\n');
  assert.match(missing, /targets\.filter\(p => aiReviewSteps\.some\(s => \{/);
  assert.match(missing, /return !msg \|\| msg\.isGenerating \|\| !\(msg\.isGenerated \|\| msg\.isEdited\);/);
  // Génération groupée ou par candidat, et régénération d'une étape.
  assert.equal(hookSrc.split('setAiGenerationVersion(v => v + 1);').length - 1, 2);
  const generate = between(hookSrc, 'const generateForCandidate = useCallback(', 'const generateForCandidateById = useCallback(');
  assert.ok(generate.indexOf('setAiGenerationVersion(v => v + 1);') > generate.indexOf("invokeWithCredits<"), 'après une génération réussie');
  const regenerate = between(hookSrc, 'const regenerateStep = useCallback(', 'const editMessage = useCallback(');
  assert.ok(regenerate.indexOf('setAiGenerationVersion(v => v + 1);') > regenerate.indexOf("invokeWithCredits<"));
  assert.match(hookSrc, /aiReviewSteps,\n[\s\S]*aiReviewMissingCount,\n[\s\S]*aiGenerationVersion,/);
});

test('5a-2 — préparation : bouton grisé tant qu’un texte IA manque, « Générer tous les aperçus », case de relecture grisée sans les textes', () => {
  assert.match(previewModal, /const hasAiReview = aiReviewSteps\.length > 0;/);
  assert.match(previewModal, /const recipients = useRecipientsConfirm\(activeProfiles\.map\(p => p\.id\), \{ aiReview: hasAiReview, aiGenerationVersion \}\);/);
  assert.match(previewModal, /recipients\.blocked \|\| aiReviewMissingCount > 0\}/);
  const enroll = between(previewModal, 'const handleEnroll = async () => {', 'setIsEnrolling(true);');
  assert.match(enroll, /if \(recipients\.blocked \|\| aiReviewMissingCount > 0\) return;/);
  const footer = between(previewModal, '<SendingAccountNotice state={sendingAccount} />', 'Présélectionner sans message');
  assert.match(footer, /\{aiReviewMissingMessage\(aiReviewMissingCount, activeProfiles\.length\)\}/);
  assert.match(footer, /onClick=\{\(\) => generateAll\(3\)\}[\s\S]*?Générer tous les aperçus/);
  assert.match(footer, /aiReview=\{hasAiReview\}\s+disabled=\{aiReviewMissingCount > 0\}/);
  // Un seul bouton « Générer tous les aperçus » à l'écran : celui du pied quand la barre du haut est absente.
  assert.match(footer, /\{\(mode === 'summary' \|\| isSingle\) && \(/);
  // Récapitulatif : messages IA candidat par candidat.
  assert.match(previewModal, /title="Messages rédigés par l'IA"/);
  assert.match(previewModal, /aiMessages=\{aiSummaryProfile \? aiMessagesFor\(aiSummaryProfile\) : null\}/);
  // Les textes générés partent tels quels (message_overrides), comme au lot 5a.
  assert.match(hookSrc, /if \(msg\.isGenerated \|\| msg\.isEdited\) \{/);
});

test('5a-2 — case : relecture montrée quel que soit N, premier message réservé au seuil, état décoché par une génération', () => {
  const component = between(confirm, 'export function RecipientsConfirm(', '\n}\n');
  assert.match(component, /const \{ required, label, help \} = sendConfirmation\(count, aiReview\);/);
  assert.match(component, /disabled=\{disabled\}/);
  assert.match(component, /\{preview && recipientsConfirmRequired\(count\) && <FirstMessagePreviewBlock/);
  const hook = between(confirmHook, 'export function useRecipientsConfirm(', '\n}\n');
  assert.match(hook, /sendConfirmSignature\(recipientIds, aiReview, options\.aiGenerationVersion \?\? 0\)/);
});

// ─── Après l'inscription ────────────────────────────────────────────────

test('5a-2 — libellé et état d’une étape reportée : « à relire » tant que final_message est vide, raison retirée une fois relue', () => {
  assert.equal(errors.formatSequenceError(REASON), errors.AI_REVIEW_REQUIRED_LABEL);
  assert.equal(errors.isAiReviewPending({ status: 'scheduled', error_message: REASON, final_message: null }), true);
  assert.equal(errors.isAiReviewPending({ status: 'scheduled', error_message: REASON, final_message: 'Texte relu' }), false);
  assert.equal(errors.isAiReviewPending({ status: 'failed', error_message: REASON, final_message: null }), false);
  assert.equal(errors.isAiReviewPending({ status: 'scheduled', error_message: 'Retry 1/3: boom', final_message: null }), false);
  assert.equal(errors.scheduledExecutionError({ status: 'scheduled', error_message: REASON, final_message: 'Texte relu' }), null);
  assert.equal(errors.scheduledExecutionError({ status: 'scheduled', error_message: REASON, final_message: null }), REASON);
  assert.equal(errors.scheduledExecutionError({ status: 'scheduled', error_message: 'Retry 1/3: boom', final_message: 'x' }), 'Retry 1/3: boom');
  assert.doesNotMatch(errorsSrc, /^import /m, 'module sans import');
});

test('5a-2 — suivi et Journal : « Relire le message » sur l’étape reportée, collaborateur sur ses inscriptions', () => {
  assert.match(panel, /\{isAiReviewPending\(exec\) && ownRow && \(\s*<Button[\s\S]*?Relire le message/);
  assert.match(panel, /\{scheduledExecutionError\(exec\) && \(/);
  assert.match(panel, /<EditScheduledMessageModal[\s\S]*?aiReview\s*\/>/);
  assert.match(journal, /const aiReview = isAiReviewPending\(exec\);/);
  assert.match(journal, /const canReview = aiReview && ownRow;/);
  assert.match(journal, /\{canReview && \(\s*<Button[\s\S]*?Relire le message/);
  assert.match(journal, /aiReview=\{reviewingExecution\}/);
});

test('5a-2 — « Relire le message » n’écrit que final_message et final_subject d’une étape encore programmée ; « Proposer avec l’IA » ne fait que lire', () => {
  const save = between(editModal, 'const handleSave = async () => {', 'if (error) throw error;');
  const update = between(save, '.update({', '})');
  const keys = [...update.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(keys, ['final_message', 'final_subject']);
  assert.match(save, /\.eq\('status', 'scheduled'\)/);
  assert.doesNotMatch(editModal, /tracking_data/);
  assert.match(editModal, /\{aiReview \? 'Relire le message' : 'Modifier le message planifié'\}/);
  assert.match(editModal, /Proposer avec l'IA/);
  // Lot 5e-2 : coût au niveau choisi, dans la ligne « Rédaction par l'IA » (style et niveau de la proposition).
  assert.match(editModal, /levelCredits\('outreach_message', DEFAULT_AI_LEVEL\)/, 'coût annoncé avant la lecture des réglages');
  assert.match(editModal, /<WritingSettingsLine[\s\S]*?choices=\{writingChoices\('outreach_message'\)\}/, 'coût annoncé par niveau');
  assert.match(editModal, /proposeAiMessage\(execution\.id, senderName, writing\)/);
  assert.doesNotMatch(propose, /\.(update|insert|upsert|delete)\(/, 'lectures seulement');
  assert.match(propose, /'generate-outreach-message',\s*'outreach_message'/);
});

// ─── Correctif 2 : aperçus de generate-outreach-message ─────────────────

test('correctif 2 — aucune rémunération dans le prompt des aperçus', () => {
  assert.doesNotMatch(outreach, /salaryInfo/);
  assert.doesNotMatch(outreach, /- Rémunération:/);
  assert.doesNotMatch(outreach, /hideSalary|NO_SALARY_CLIENTS/);
  assert.doesNotMatch(outreach, /job\.(salaryMin|salaryMax|tjmMin|tjmMax)/, 'champs de rémunération jamais lus');
  assert.match(outreach, /ne JAMAIS mentionner de salaire, TJM, rémunération/);
});

test('correctif 2 — detectSequenceViolations passé sur l’aperçu : corrigé une fois, revérifié sur le texte final, refus 422 en français', () => {
  assert.match(outreach, /import \{ detectSequenceViolations, hasTimeForAiCorrection \} from "\.\.\/_shared\/sequence-send-rules\.ts";/);
  // Lot 5e-2 : une seule règle bloquante (moteur, tutoiement, note de 300 caractères), avant et après correction.
  const rule = between(outreach, 'const blockingViolations = (draft: { message: string; subject?: string }): string[] => {', '};');
  assert.match(rule, /detectSequenceViolations\(isRPO, draft\.message, draft\.subject\)\.filter\(\(v\) => v\.blocking\)\.map\(\(v\) => v\.label\)/);
  const first = between(outreach, 'for (const label of blockingViolations(parsed)) {', 'if (violations.length > 0');
  assert.match(first, /if \(!violations\.includes\(label\)\) violations\.push\(label\);/);
  // Revérification après le nettoyage et l'anonymisation.
  const finalCheck = outreach.indexOf('const remainingBlocking = blockingViolations(parsed);');
  assert.ok(finalCheck > outreach.indexOf('parsed.message = sanitizeMessage(parsed.message);'));
  assert.ok(finalCheck > outreach.indexOf('applyClientAnonymization(parsed.message'));
  const refusal = between(outreach, 'if (remainingBlocking.length > 0) {\n      return json({', '}, 422);');
  assert.match(refusal, /error_code: PREVIEW_NOT_COMPLIANT_CODE,/);
  assert.match(outreach.slice(outreach.indexOf('if (remainingBlocking.length > 0) {\n      return json({')), /\}, 422\);/);
  assert.match(outreach, /const PREVIEW_NOT_COMPLIANT_CODE = 'PREVIEW_NOT_COMPLIANT';/);
  assert.match(outreach, /`Aperçu refusé : le message proposé \$\{why\}, il ne peut pas partir\. Régénérez l'aperçu\.`/);
  // Le navigateur affiche la phrase du serveur sous l'aperçu, à régénérer.
  assert.equal(previewHook.PREVIEW_NOT_COMPLIANT_CODE, 'PREVIEW_NOT_COMPLIANT');
  const refused = Object.assign(new Error('Aperçu refusé : le message proposé mentionne une rémunération, il ne peut pas partir. Régénérez l\'aperçu.'), { code: 'PREVIEW_NOT_COMPLIANT', status: 422 });
  assert.equal(previewHook.previewErrorMessage(refused), refused.message);
  assert.equal(previewHook.previewErrorMessage(new Error('boom')), previewHook.PREVIEW_GENERATION_FAILED_MESSAGE);
  // Lot 5e-2 : la génération et la régénération passent par reportGenerationError, qui rend previewErrorMessage.
  assert.equal(hookSrc.split('error: reportGenerationError(err),').length - 1, 2, 'génération et régénération');
  assert.match(between(hookSrc, 'const reportGenerationError = useCallback(', '}, []);'), /return previewErrorMessage\(err\);/);
  // Niveau refusé (plafond abaissé entre-temps) : la phrase du serveur, jamais « Réessayez ».
  const levelRefused = Object.assign(new Error("Votre organisation n'autorise pas le niveau Avancé. Choisissez Rapide ou Équilibré."), { code: 'AI_LEVEL_NOT_ALLOWED', status: 403 });
  assert.equal(previewHook.previewErrorMessage(levelRefused), levelRefused.message);
});

// ─── Textes ─────────────────────────────────────────────────────────────

test('5a-2 — aucun nom de prestataire ni « Notion » dans les textes nouveaux, vouvoiement', () => {
  const vendor = /Unipile|Apollo|\bPDL\b|People Data Labs|Anthropic|Claude|Brandfetch|Clearbit|Resend|Notion/;
  const aiReviewPart = between(errorsSrc, '// ─── Lot 5a-2', 'export function formatSequenceError(');
  for (const [name, source] of [
    ['EditScheduledMessageModal', editModal],
    ['proposeAiMessage', propose],
    ['contactRecipientsGuard', guardSrc],
    ['RecipientsConfirm', confirm],
    ['sequenceErrorMessages (5a-2)', aiReviewPart],
  ]) {
    assert.doesNotMatch(source, vendor, name);
  }
  const texts = [REASON, errors.AI_REVIEW_REQUIRED_LABEL, guard.AI_REVIEW_LABEL, guard.AI_REVIEW_HELP, guard.RECIPIENTS_AND_AI_REVIEW_LABEL, guard.RECIPIENTS_AND_AI_REVIEW_HELP, guard.aiReviewMissingMessage(2, 3)];
  for (const t of texts) {
    assert.doesNotMatch(t, /\b(tu|ton|ta|tes|toi)\b/i, t);
    assert.doesNotMatch(t, vendor, t);
  }
});

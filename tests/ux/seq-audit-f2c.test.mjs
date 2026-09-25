/**
 * Audit séquences 2026-09-25, lot F2, second passage — demandes croisées des
 * autres lots (moteur, migration, éditeur, suivi) sur la liste des séquences,
 * le suivi des inscrits et le diagnostic.
 *
 * Lecture du code source, commentaires retirés. Les petites fonctions pures
 * sont extraites du fichier et transpilées en mémoire par esbuild.
 * Lancer : node --test tests/ux/seq-audit-f2c.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/** Retire les commentaires de bloc, JSX et de ligne (hors chaînes d'URL). */
const stripComments = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/([;{}),])\s*\/\/[^\n'"`]*$/gm, '$1');

const list = stripComments(read('src/components/outreach/SequencesList.tsx'));
const panel = stripComments(read('src/components/outreach/SequenceEnrollmentsPanel.tsx'));
const diagnostic = stripComments(read('src/components/outreach/SequenceDiagnostic.tsx'));

/** Corps d'une fonction fléchée `const name = async (...) => { ... }` (accolades équilibrées). */
function body(src, name) {
  const start = src.search(new RegExp(`const ${name} = (async )?\\(`));
  assert.ok(start !== -1, `fonction ${name} introuvable`);
  const open = src.indexOf('{', src.indexOf('=>', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`fin de ${name} introuvable`);
}

/** Transpile une fonction fléchée TypeScript extraite du fichier et la renvoie. */
function extractFunction(src, name) {
  const { code } = transformSync(`${body(src, name)};\nexport default ${name};`, { loader: 'ts', format: 'cjs' });
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports.default;
}

// ---------------------------------------------------------------- SEQ-059 (B6)
test('SEQ-059 — le refus STEP_HAS_HISTORY nomme les étapes, numérotées comme dans l’éditeur', () => {
  const blockedStepsNotice = extractFunction(list, 'blockedStepsNotice');
  // DETAIL de save_sequence_steps en step_order (base 0), trié comme du texte.
  assert.equal(blockedStepsNotice('Étape(s) concernée(s) : 0, 2'), ' Étapes concernées : 1, 3.');
  assert.equal(blockedStepsNotice('Étape(s) concernée(s) : 10, 2'), ' Étapes concernées : 3, 11.');
  assert.equal(blockedStepsNotice('Étape(s) concernée(s) : 4'), ' Étape concernée : 5.');
  assert.equal(blockedStepsNotice(undefined), '');
  assert.equal(blockedStepsNotice(''), '');
  const save = body(list, 'handleSaveSequence');
  assert.match(save, /Modifiez son contenu à la place\.\$\{blockedStepsNotice\(stepsError\.details\)\}/);
});

// ---------------------------------------------------------------- SEQ-219 (F5 / F2b)
test('SEQ-219 — save_sequence_steps est typé : plus de contournement de type', () => {
  assert.doesNotMatch(list, /'save_sequence_steps' as any/);
  assert.equal((list.match(/supabase\.rpc\('save_sequence_steps', \{/g) || []).length, 2, 'enregistrement et duplication');
});

// ---------------------------------------------------------------- SEQ-001 (E1a)
test('SEQ-001 — « Envoyer les actions du jour » lit `advanced`, sans l’ancien alias', () => {
  const nudge = body(list, 'handleNudgeToday');
  assert.match(nudge, /const count = payload\.advanced \?\? 0;/);
  assert.doesNotMatch(nudge, /rescheduled/);
  assert.match(nudge, /payload\?\.message \|\| error\?\.message/, 'le message français du serveur est affiché en premier');
});

// ---------------------------------------------------------------- SEQ-004 (E1a)
test('SEQ-004 — la réactivation rappelle la reprise tant qu’il reste des candidats', () => {
  const on = body(list, 'activateSequence');
  assert.match(list, /const MAX_RESUME_ROUNDS = 10;/);
  assert.match(on, /for \(let round = 0; round < MAX_RESUME_ROUNDS; round \+= 1\) \{/);
  const loop = on.slice(on.indexOf('for (let round'), on.indexOf("toast.dismiss(`resume-${sequenceId}`);"));
  assert.match(loop, /action: 'resume_enrollments'/);
  assert.match(loop, /pause_reasons: SEQUENCE_LEVEL_PAUSE_REASONS/);
  // Arrêt : plus rien à traiter, ou aucun progrès depuis l'appel précédent.
  assert.match(loop, /if \(remaining === 0 \|\| \(round > 0 && remaining >= previous\)\) break;/);
  // Un échec après un premier appel réussi garde le bilan obtenu.
  assert.match(loop, /if \(round > 0\) break;/);
  // Un candidat relu par l'appel suivant n'est compté qu'une fois.
  assert.match(loop, /outcomes\.set\(r\.enrollment_id, r\.outcome\)/);
  // Le bilan n'est affiché qu'après la boucle.
  const after = on.slice(on.indexOf("toast.dismiss(`resume-${sequenceId}`);"));
  assert.match(after, /for \(const outcome of outcomes\.values\(\)\)/);
  assert.match(after, /repris, \$\{failed\} en erreur/);
  assert.doesNotMatch(loop, /toast\.(success|warning)\(/);
});

test('SEQ-004 — « Sauter » n’est proposé que pour un candidat en cours', () => {
  const skipButton = panel.slice(panel.indexOf('Prévu :'), panel.indexOf('Sauter\n'));
  assert.match(skipButton, /\{enrollment\.status === 'active' && \(\s*<button/);
  assert.match(skipButton, /setConfirmAction\(\{ type: 'skipStep', stepId: exec\.id \}\)/);
});

// ---------------------------------------------------------------- SEQ-194 (E1b)
test('SEQ-194 — un passage sauté ou en erreur ne s’affiche plus comme réussi', () => {
  assert.match(diagnostic, /\.select\('last_run_at, last_status'\)/);
  assert.match(diagnostic, /lastCronStatus: heartbeatRes\.data\?\.last_status \?\? null,/);
  assert.match(diagnostic, /const cronSkipped = cronRecent && data\.lastCronStatus === 'skipped';/);
  assert.match(diagnostic, /const cronFailed = cronRecent && data\.lastCronStatus === 'error';/);
  assert.match(diagnostic, /const cronHealthy = cronRecent && !cronSkipped && !cronFailed;/);
  assert.match(diagnostic, /'Passage sauté \(un autre passage était en cours\)'/);
  assert.match(diagnostic, /'Dernier passage en erreur'/);
  // Textes affichés (phrases entre guillemets, interpolations retirées) : aucun nom technique.
  const visible = [...diagnostic.matchAll(/'[^'\n]*'|`[^`\n]*`/g)]
    .map((m) => m[0].replace(/\$\{[^}]*\}/g, ''))
    // Journaux de console exclus : ils ne sont pas affichés.
    .filter((t) => /[A-Za-zÀ-ÿ]{3,} [A-Za-zÀ-ÿ]/.test(t) && !t.includes('[SequenceDiagnostic]'));
  assert.ok(visible.length > 10, 'textes du diagnostic introuvables');
  for (const text of visible) {
    for (const jargon of ['cron', 'heartbeat', 'verrou', 'process-sequences', 'edge function', 'pg_']) {
      assert.ok(!text.toLowerCase().includes(jargon), `texte technique visible : ${text}`);
    }
  }
});

// ---------------------------------------------------------------- SEQ-082 (E1b)
test('SEQ-082 — la cause précise d’une pause « échec d’envoi » est affichée', () => {
  const sendFailedDetail = extractFunction(panel, 'sendFailedDetail');
  const detail = 'Relation LinkedIn du candidat inconnue : reprenez-le pour relancer la vérification de connexion.';
  assert.equal(sendFailedDetail({ status: 'paused', pause_reason: 'send_failed', tracking_data: { pause_reason: detail } }), detail);
  // Rien pour une autre raison de pause (texte éventuellement resté d'une pause précédente) ni hors pause.
  assert.equal(sendFailedDetail({ status: 'paused', pause_reason: 'manual', tracking_data: { pause_reason: detail } }), null);
  assert.equal(sendFailedDetail({ status: 'active', pause_reason: null, tracking_data: { pause_reason: detail } }), null);
  assert.equal(sendFailedDetail({ status: 'paused', pause_reason: 'send_failed', tracking_data: null }), null);
  assert.equal(sendFailedDetail({ status: 'paused', pause_reason: 'send_failed', tracking_data: { pause_reason: '  ' } }), null);
  assert.equal(sendFailedDetail({ status: 'paused', pause_reason: 'send_failed', tracking_data: ['x'] }), null);
  // Une étape en échec l'emporte : c'est l'erreur qu'il faut consulter.
  assert.equal(sendFailedDetail({
    status: 'paused', pause_reason: 'send_failed', tracking_data: { pause_reason: detail },
    executions: [{ status: 'sent' }, { status: 'failed' }],
  }), null);
  assert.equal(sendFailedDetail({
    status: 'paused', pause_reason: 'send_failed', tracking_data: { pause_reason: detail },
    executions: [{ status: 'sent' }, { status: 'skipped' }],
  }), detail);

  assert.match(panel, /const pauseHint = enrollment\.status === 'paused'\s*\?\s*\(pauseDetail \?\? pauseReasonHint\(enrollment\.pause_reason\)\)/);
  // Pas de « Voir l'erreur » ni de « Reprendre à l'étape suivante » quand aucune étape n'a échoué.
  assert.match(panel, /enrollment\.pause_reason === 'send_failed' && !pauseDetail \? 'Reprendre à l’étape suivante' : 'Reprendre la séquence'/);
  assert.match(panel, /\{enrollment\.pause_reason === 'send_failed' && !pauseDetail && \(\s*<DropdownMenuItem onClick=\{\(\) => showEnrollmentDetail/);
});

// ---------------------------------------------------------------- SEQ-161 (F3)
test('SEQ-161 — la reprise individuelle affiche le bilan partagé', () => {
  assert.match(panel, /summarizeResumeResponse,\s*\n\s*type ResumeResponse,\s*\n\} from '@\/lib\/sequenceErrorMessages'/);
  assert.doesNotMatch(panel, /type ResumeOutcome =/);
  assert.doesNotMatch(panel, /interface ResumeResponse/);
  const resume = body(panel, 'resumeEnrollment');
  assert.match(resume, /const summary = summarizeResumeResponse\(payload, name\);/);
  assert.match(resume, /if \(summary\.tone === 'success'\) toast\.success\(summary\.message\);/);
});

// ---------------------------------------------------------------- SEQ-069 (F1a)
test('SEQ-069 — l’éditeur lit les étapes comme le choix de modèle, défauts affichés compris', () => {
  const edit = body(list, 'handleEdit');
  assert.match(edit, /steps: steps\.map\(s => \(\{\s*\.\.\.rowToSequenceStep\(s\),/);
  // Les valeurs par défaut de l'éditeur (SEQ-147) passent après la lecture commune.
  assert.ok(edit.indexOf('...rowToSequenceStep(s)') < edit.indexOf('DEFAULT_SCORE_THRESHOLD'));
  assert.ok(edit.indexOf('...rowToSequenceStep(s)') < edit.indexOf('DEFAULT_WAIT_TIMEOUT_DAYS'));
  // Plus de mapping local qui diverge (fin de séquence, repli, variantes).
  assert.doesNotMatch(edit, /nextStepId: s\.ends_sequence/);
  assert.doesNotMatch(edit, /variantGroup: s\.variant_group/);
});

// ---------------------------------------------------------------- SEQ-150 / SEQ-154 / SEQ-167
test('SEQ-150 / SEQ-154 / SEQ-167 — props attendues par l’éditeur, le journal et les statistiques', () => {
  const builder = list.slice(list.indexOf('<SequenceBuilder'), list.indexOf('/>', list.indexOf('<SequenceBuilder')));
  assert.match(builder, /activeEnrollmentCount=\{editingSequence\?\.id \? editingActiveCount : 0\}/);
  assert.match(builder, /canSendSequences=\{canSendSequences\}/);
  assert.match(list, /<SequenceActivityLog[\s\S]*?projectId=\{projectId\}/);
  assert.equal((list.match(/<SequenceAnalytics[\s\S]*?projectId=\{projectId\}[\s\S]*?\/>/g) || []).length, 2);
});

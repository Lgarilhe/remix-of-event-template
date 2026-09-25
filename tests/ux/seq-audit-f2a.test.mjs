/**
 * Audit séquences 2026-09-25, lot F2a — garde-fous de non-régression sur la
 * liste des séquences, le suivi des inscrits et le diagnostic.
 *
 * Lecture du code source (même modèle que lot1-sequences.test.mjs).
 * Lancer : node --test tests/ux/seq-audit-f2a.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const list = read('src/components/outreach/SequencesList.tsx');
const panel = read('src/components/outreach/SequenceEnrollmentsPanel.tsx');
const diagnostic = read('src/components/outreach/SequenceDiagnostic.tsx');

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
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`fin de ${name} introuvable`);
}

// ---------------------------------------------------------------- SEQ-001
test('SEQ-001 — « Envoyer les actions du jour » est borné à la mission et confirmé', () => {
  const nudge = body(list, 'handleNudgeToday');
  assert.match(nudge, /action: 'nudge_sequences'/);
  assert.match(nudge, /sequence_ids: missionSequenceIds/, 'l’appel doit viser les seules séquences de la mission');
  assert.match(list, /\.filter\(s => s\.project_id === projectId && canManage\(s\)\)/);
  // Le bouton ouvre la confirmation, il n'appelle plus le serveur directement.
  assert.doesNotMatch(list, /onClick=\{handleForceReschedule\}/);
  assert.match(list, /onClick=\{\(\) => setNudgeConfirmOpen\(true\)\}/);
  assert.match(list, /Envoyer maintenant les actions du jour \?/);
  assert.match(list, /Les relances des jours suivants gardent leur date\./);
  assert.match(list, /'Envoyer les actions du jour'/);
  assert.doesNotMatch(list, /'Envoyer tout'/);
});

test('SEQ-001 — le panneau des inscrits n’avance plus rien, le bandeau informe', () => {
  assert.doesNotMatch(panel, /nudge_sequences/);
  assert.doesNotMatch(panel, /Traiter maintenant/);
  assert.match(panel, /Elles partiront au prochain passage, pendant vos heures d’envoi\./);
  // Le compte ne porte que sur les candidats en cours (une pause garde ses étapes).
  assert.match(panel, /const pendingExecutions = enrollments\s*\.filter\(e => e\.status === 'active'\)/);
});

test('SEQ-001 — le diagnostic n’a plus de bouton « Forcer un cycle »', () => {
  assert.doesNotMatch(diagnostic, /nudge_sequences/);
  assert.doesNotMatch(diagnostic, /Forcer un cycle maintenant/);
  assert.doesNotMatch(diagnostic, /invokeEdgeFunction/);
  assert.doesNotMatch(diagnostic, /Lance immédiatement/);
});

// ---------------------------------------------------------------- SEQ-002 / SEQ-004 / SEQ-023
test('SEQ-002 — la désactivation pose une raison propre, la réactivation ne reprend qu’elle', () => {
  const off = body(list, 'deactivateSequence');
  assert.match(off, /pause_reason: 'sequence_inactive'/);
  assert.doesNotMatch(off, /pause_reason: 'manual'/);
  const on = body(list, 'activateSequence');
  assert.match(on, /action: 'resume_enrollments'/);
  assert.match(on, /pause_reasons: SEQUENCE_LEVEL_PAUSE_REASONS/);
  assert.match(list, /import \{ SEQUENCE_LEVEL_PAUSE_REASONS \} from '@\/lib\/sequenceLabels'/);
  // Plus aucune réactivation en masse de toutes les pauses depuis le navigateur.
  assert.doesNotMatch(list, /update\(\{ status: 'active', pause_reason: null \}\)/);
});

test('SEQ-002 — le panneau lit les libellés de pause partagés', () => {
  assert.match(panel, /pausedLabel,\s*\n\s*pauseReasonHint,\s*\n\} from '@\/lib\/sequenceLabels'/);
  assert.doesNotMatch(panel, /const PAUSE_REASON_LABELS/);
});

test('SEQ-004 — reprise et relance passent par le serveur, sans réarmer d’exécution côté navigateur', () => {
  assert.match(body(panel, 'resumeEnrollment'), /callResumeAction\('resume_enrollments', enrollmentId\)/);
  assert.match(body(panel, 'reEnroll'), /callResumeAction\('re_enroll', enrollmentId\)/);
  assert.match(body(panel, 'callResumeAction'), /enrollment_ids: \[enrollmentId\]/);
  // Plus de réarmement « à l'aveugle » de la première exécution annulée.
  assert.doesNotMatch(panel, /\.filter\(e => e\.status === 'cancelled'\)\s*\.sort\(\(a, b\) => a\.step_order - b\.step_order\)/);
  assert.doesNotMatch(panel, /\.in\('status', \['cancelled', 'scheduled', 'failed', 'quota_blocked'\]\)/);
  assert.doesNotMatch(panel, /from\('sequence_step_executions'\)\s*\.update\(\{\s*status: 'scheduled'/);
  // Toasts selon le résultat réel : bilan partagé pour la reprise (même texte
  // que la fiche candidat), textes propres à la relance.
  assert.match(body(panel, 'resumeEnrollment'), /summarizeResumeResponse\(payload, name\)/);
  assert.match(panel, /Rien à relancer : cette séquence est terminée pour \$\{name\}/);
  assert.match(panel, /Ce compte LinkedIn n’est plus relié\. Reliez-le avant de relancer la séquence\./);
});

test('Contrat §4/§6 — « Marquer comme répondu » passe par la clôture serveur', () => {
  const mark = body(panel, 'markReplied');
  assert.match(mark, /action: 'mark_replied'/);
  assert.doesNotMatch(mark, /from\('sequence_enrollments'\)/);
  assert.doesNotMatch(mark, /from\('sequence_step_executions'\)/);
});

test('Contrat §1 — mettre en pause un candidat n’annule plus ses étapes', () => {
  const stop = body(panel, 'stopEnrollment');
  assert.doesNotMatch(stop, /sequence_step_executions/);
  assert.match(stop, /\.eq\('status', 'active'\)\s*\.select\('id'\)/);
  assert.doesNotMatch(panel, /'Arrêt manuel'|'Arrêt groupé'/);
});

test('SEQ-004 — « Relancer » n’est pas proposé à un candidat en pause, et nomme ce qui part', () => {
  const menu = panel.slice(panel.indexOf("setConfirmAction({ type: 'reEnroll'") - 400, panel.indexOf("setConfirmAction({ type: 'reEnroll'"));
  assert.doesNotMatch(menu, /enrollment\.status === 'paused'/, 'un candidat en pause a « Reprendre », pas « Relancer »');
  assert.doesNotMatch(panel, /Ré-enrôler|ré-enrôl/);
  assert.match(panel, /`Relancer \$\{confirmName\} \?`/);
  assert.match(panel, /vérifiez que la conversation est bien close\./);
});

test('SEQ-004 / SEQ-023 — la réactivation ne réécrit plus aucune exécution et se confirme', () => {
  assert.doesNotMatch(list, /scheduled_at: now/);
  assert.doesNotMatch(list, /from\('sequence_step_executions'/);
  assert.match(list, /Réactiver cette séquence \?/);
  assert.match(list, /Chaque étape garde sa date prévue ; celles déjà passées partiront dans les prochaines heures\./);
  assert.match(list, /repris, \$\{failed\} en erreur/);
});

test('SEQ-023 — le dialogue de désactivation dit ce qui se passera vraiment', () => {
  assert.match(list, /Les envois prévus pendant la pause partiront à la réactivation, sans être avancés\./);
  assert.doesNotMatch(list, /les enrollments reprendront là où ils en étaient/);
});

// ---------------------------------------------------------------- SEQ-025
test('SEQ-025 — désactiver : pause des inscriptions vérifiée avant l’interrupteur', () => {
  const off = body(list, 'deactivateSequence');
  const pauseAt = off.indexOf("from('sequence_enrollments')");
  const flagAt = off.indexOf("from('outreach_sequences')");
  assert.ok(pauseAt !== -1 && flagAt !== -1 && pauseAt < flagAt, 'les inscriptions doivent passer en pause avant is_active');
  assert.match(off.slice(0, flagAt), /const \{ data: paused, count, error: pauseError \} = await supabase/);
  assert.match(off.slice(pauseAt, flagAt), /\.select\('id'\)/);
  assert.match(off.slice(pauseAt, flagAt), /if \(pauseError\) \{\s*toast\.error\(pauseFailed\);\s*return;/);
  assert.match(off.slice(flagAt), /\.select\('id'\)/);
  assert.match(off, /Aucun envoi n’a été arrêté\. Réessayez\./);
  assert.match(off, /Séquence désactivée\. \$\{candidats\(pausedCount\)\} mis en pause\./);
});

test('SEQ-025 — interrupteur désactivé pendant l’appel, masqué hors de mon organisation', () => {
  const switches = [...list.matchAll(/<Switch[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(switches.length, 2);
  for (const s of switches) assert.match(s, /disabled=\{togglingId === seq\.id\}/);
  assert.match(list, /const canManage = \(seq: SequenceWithStats\) => !!organizationId && seq\.organization_id === organizationId;/);
  assert.equal((list.match(/\{canManage\(seq\) \? \(\s*<Switch/g) || []).length, 2);
  assert.equal((list.match(/\{canManage\(seq\) && \(\s*<>\s*<DropdownMenuSeparator \/>/g) || []).length, 2);
  assert.equal((list.match(/\{canManage\(seq\) && \(\s*<DropdownMenuItem onClick=\{\(e\) => \{ e\.stopPropagation\(\); handleEdit\(seq\); \}\}>/g) || []).length, 2);
});

test('SEQ-025 — supprimer : 0 ligne n’affiche jamais de succès', () => {
  const del = body(list, 'handleDelete');
  assert.match(del, /\.delete\(\)\s*\.eq\('id', sequenceId\)\s*\.select\('id'\)/);
  assert.match(del, /toast\.error\('Suppression impossible', \{ description: 'Vous n’avez pas les droits sur cette séquence\.' \}\)/);
});

// ---------------------------------------------------------------- SEQ-026
test('SEQ-026 — la pause groupée vise toute la séquence en base, pas la page chargée', () => {
  const bulk = body(panel, 'bulkStopActive');
  assert.doesNotMatch(bulk, /enrollments\.filter\(/);
  assert.match(bulk, /\.eq\('sequence_id', sequenceId\)\s*\.eq\('status', 'active'\)\s*\.select\('id'\)/);
  // Contrat : une pause ne touche pas aux exécutions en attente.
  assert.doesNotMatch(bulk, /sequence_step_executions/);
  assert.match(body(panel, 'fetchStatusCounts'), /\{ count: 'exact', head: true \}/);
  assert.match(panel, /Mettre en pause tous les candidats actifs \(\$\{statusCounts\.active\}\)/);
});

// ---------------------------------------------------------------- SEQ-019
test('SEQ-019 — garde-fous et expéditeurs enregistrés à la création et rechargés à l’édition', () => {
  const save = body(list, 'handleSaveSequence');
  const insert = save.slice(save.indexOf('.insert({'), save.indexOf('.select()'));
  for (const col of ['stop_conditions', 'sender_accounts', 'rotation_mode', 'multi_sender_enabled']) {
    assert.match(insert, new RegExp(`${col}:`), `l’insert doit écrire ${col}`);
  }
  const edit = body(list, 'handleEdit');
  assert.match(edit, /stopConditions: \{ \.\.\.DEFAULT_STOP_CONDITIONS, \.\.\.\(seq\.stop_conditions \?\? \{\}\) \}/);
  assert.match(edit, /senderAccounts: seq\.sender_accounts \?\? \[\]/);
  assert.match(edit, /rotationMode: seq\.rotation_mode \?\? 'round_robin'/);
  assert.match(edit, /multiSenderEnabled: !!seq\.multi_sender_enabled/);
});

// ---------------------------------------------------------------- SEQ-031
test('SEQ-031 — une étape d’attente enregistrée porte toujours son événement', () => {
  assert.match(list, /if \(actionType === 'wait_reply'\) return 'reply_received';/);
  assert.match(list, /if \(actionType === 'wait_connection'\) return 'connection_accepted';/);
  assert.match(list, /wait_for_event: implicitWaitEvent\(step\.actionType, step\.waitForEvent\)/);
  assert.doesNotMatch(list, /wait_for_event: step\.waitForEvent \?\? null/);
});

// ---------------------------------------------------------------- SEQ-059
test('SEQ-059 — refus de supprimer une étape déjà envoyée, message clair', () => {
  const save = body(list, 'handleSaveSequence');
  assert.match(save, /stepsError\.hint === 'STEP_HAS_HISTORY'/);
  assert.match(save, /Cette étape a déjà été envoyée à des candidats : elle ne peut pas être supprimée\. Modifiez son contenu à la place\./);
});

// ---------------------------------------------------------------- SEQ-060
test('SEQ-060 — « Dupliquer » recopie fin de séquence, options e-mail et réglages d’en-tête', () => {
  const dup = body(list, 'handleDuplicate');
  for (const key of ['ends_sequence', 'cc_emails', 'bcc_emails', 'include_unsubscribe', 'signature_id']) {
    assert.match(dup, new RegExp(`${key}: s\\.${key} \\?\\?`), `la copie doit garder ${key}`);
  }
  for (const col of ['stop_conditions', 'sender_accounts', 'rotation_mode', 'multi_sender_enabled']) {
    assert.match(dup, new RegExp(`${col}: seq\\.${col} \\?\\?`), `l’en-tête copié doit garder ${col}`);
  }
});

// ---------------------------------------------------------------- SEQ-069
test('SEQ-069 — à la réouverture, « Si timeout » reflète l’étape de repli', () => {
  // Une seule lecture des étapes (celle du choix de modèle), qui déduit le repli.
  assert.match(body(list, 'handleEdit'), /\.\.\.rowToSequenceStep\(s\),/);
  assert.match(list, /import \{ rowToSequenceStep \} from '\.\/sequence\/sequenceGraph';/);
  const graph = read('src/components/outreach/sequence/sequenceGraph.ts');
  assert.match(graph, /timeoutAction: s\.timeout_branch_step_id \? 'alternative_step' : 'skip'/);
});

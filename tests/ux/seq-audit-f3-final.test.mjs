/**
 * Audit des séquences (2026-09-25), lot F3, vague finale : Journal d'activité
 * et nouvelle sémantique de pause (contrat §1, D1), refus 409 du saut d'étape,
 * effacement RGPD définitif sur la fiche candidat (D5), motifs du moteur.
 *
 * Fonctions pures de src/lib/sequenceErrorMessages.ts transpilées en mémoire
 * par esbuild ; écrans et hooks vérifiés par inspection de source.
 *
 * Lancer : node --test tests/ux/seq-audit-f3-final.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

const { code } = transformSync(read('src/lib/sequenceErrorMessages.ts'), { loader: 'ts', format: 'esm' });
const lib = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const activityLog = read('src/components/outreach/SequenceActivityLog.tsx');
const candidatePanel = read('src/components/outreach/CandidateSequencesPanel.tsx');
const candidateHook = read('src/hooks/useCandidateEnrollments.ts');

const block = (src, start, end) => {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `repère introuvable : ${start}`);
  const to = end ? src.indexOf(end, from + start.length) : src.length;
  assert.ok(to > from, `repère de fin introuvable : ${end}`);
  return src.slice(from, to);
};

/** Valeur d'une constante chaîne exportée par un module du moteur. */
const engineConst = (rel, name) => {
  const m = read(rel).match(new RegExp(`export const ${name} = (['"])(.+?)\\1;`));
  assert.ok(m, `${name} introuvable dans ${rel}`);
  return m[2];
};

// ---------------------------------------------------------------- 1-2. Journal : étapes retenues par une pause
test('front-enroll-follow-3 / integration-7 — une étape en attente d’un candidat en pause ne partira pas', () => {
  for (const status of ['scheduled', 'quota_blocked', 'waiting_event']) {
    const held = lib.heldExecutionNotice(status, 'paused', true);
    assert.deepEqual(held, { label: 'En pause', hint: "Ne partira pas tant que le candidat n'est pas repris." }, status);
  }
  // Candidat sorti de la séquence (reste d'avant l'audit) : ni en pause, ni à venir.
  assert.equal(lib.heldExecutionNotice('scheduled', 'replied', true).label, 'Ne partira pas');
  // D1 : une séquence désactivée n'envoie rien, même pour une inscription active.
  assert.match(lib.heldExecutionNotice('scheduled', 'active', false).hint, /^Séquence désactivée/);
  // L'étape suit son cours : aucune retenue.
  assert.equal(lib.heldExecutionNotice('scheduled', 'active', true), null);
  assert.equal(lib.heldExecutionNotice('scheduled', null, null), null);
  // Étape déjà traitée ou en cours d'envoi : son statut réel reste affiché.
  for (const status of ['sending', 'sent', 'failed', 'skipped', 'cancelled']) {
    assert.equal(lib.heldExecutionNotice(status, 'paused', false), null, status);
  }
});

test('front-enroll-follow-3 / integration-7 — le Journal lit le statut de l’inscription et de la séquence', () => {
  assert.match(activityLog, /sequence_enrollments!inner\(status, created_by, profile_name, profile_headline, profile_url, job_id, outreach_sequences\(name, is_active\)\)/);
  assert.match(activityLog, /held: heldExecutionNotice\(exec\.status, enrollmentRel\?\.status, sequenceRel\?\.is_active\)/);
});

test('front-enroll-follow-3 / integration-7 — ni « À venir », ni « En retard », ni saut pour une étape retenue', () => {
  const stats = block(activityLog, 'const stats = useMemo', 'const isTruncated');
  assert.match(stats, /scheduled: executions\.filter\(e => !e\.held && /);
  assert.match(stats, /pending: executions\.filter\(e => !e\.held && /);
  assert.match(activityLog, /const isOverdue = exec\.status === 'scheduled' && isPast && !held;/);
  // ownRow : règle D3 du collaborateur (tests/ux/seq-audit-f3-last.test.mjs).
  assert.match(activityLog, /const canSkip = SKIPPABLE_STATUSES\.has\(exec\.status\) && !held && ownRow;/);
  // Le bouton « Ne pas envoyer » n'existe que si canSkip ; « Modifier » reste possible pendant la pause.
  assert.match(activityLog, /\{canSkip && \(\s*<Button[\s\S]*?Ne pas envoyer cette étape/);
  assert.match(activityLog, /const canEdit = exec\.status === 'scheduled' && !!preview\.message;/);
  // Badge « En pause » à la place de « Programmé », avec l'aide visible sous la ligne.
  assert.match(activityLog, /\{held \? \(\s*<Badge[^>]*>\s*<Pause [^>]*\/>\s*<span className="ml-1">\{held\.label\}<\/span>/);
  assert.match(activityLog, /\{held && \(\s*<p className="text-xs text-muted-foreground mt-0\.5">\{held\.hint\}<\/p>/);
});

// ---------------------------------------------------------------- 2-3. Refus 409 du saut d'étape
test('integration-7 / SEQ-014 — un 409 « candidat non actif » affiche la phrase du serveur', () => {
  const server = "Ce candidat n'est plus actif dans la séquence : reprenez-le avant de sauter une étape.";
  // Même phrase que le serveur (process-sequences, handleSkipExecution).
  assert.ok(read('supabase/functions/process-sequences/index.ts').includes("Ce candidat n\\'est plus actif dans la séquence : reprenez-le avant de sauter une étape."));
  assert.equal(lib.SKIP_NOT_ACTIVE_MESSAGE, server);
  assert.equal(lib.skipConflictMessage('enrollment_not_active', server), server);
  assert.equal(lib.skipConflictMessage('enrollment_not_active', ''), server, 'repli si le message manque');
  // Les autres 409 (déjà partie, en cours d'envoi, traitée entre-temps) gardent le texte d'avant.
  for (const code of ['step_sending', 'step_done', undefined]) {
    assert.equal(lib.skipConflictMessage(code, 'Étape déjà « sent » — rien à sauter'), "Cette étape est déjà en cours d'envoi ou déjà traitée.", String(code));
  }
  const skip = block(activityLog, 'const handleSkipExecution = async', '// Filter and group executions');
  assert.match(skip, /if \(error\?\.status === 409\) \{\s*(\/\/[^\n]*\n\s*)*toast\.error\(skipConflictMessage\(error\.code \?\? data\?\.error_code, error\.message\)\);/);
  assert.doesNotMatch(skip, /toast\.error\("Cette étape est déjà en cours d'envoi ou déjà traitée\."\)/, 'plus de texte figé pour tout 409');
});

// ---------------------------------------------------------------- D5 : effacement RGPD
test('D5 — fiche candidat : pas de « Reprendre » pour une inscription effacée', () => {
  assert.equal(lib.isGdprErasedEnrollment('2026-09-26T10:00:00Z', []), true);
  // Même motif que le moteur (recordGdprErasure).
  const engine = engineConst('supabase/functions/_shared/get-or-fetch-contact.ts', 'GDPR_ERASURE_SKIP_REASON');
  assert.equal(lib.isGdprErasedEnrollment(null, [{ skip_reason: engine }]), true);
  assert.equal(lib.isGdprErasedEnrollment(undefined, [{ skip_reason: 'Arrêt manuel' }]), false);
  assert.equal(lib.isGdprErasedEnrollment(null, null), false);
  assert.equal(lib.isGdprErasedEnrollment('', undefined), false);
  // Même phrase que le refus du serveur (resume_enrollments, re_enroll).
  assert.equal(lib.GDPR_ERASED_NOTICE, engineConst('supabase/functions/_shared/sequence-resume.ts', 'GDPR_ERASED_RESUME_MESSAGE'));

  // Le hook lit le seul marqueur, pas tout tracking_data.
  assert.match(candidateHook, /gdpr_erased_at:tracking_data->gdpr_erased_at,/);
  assert.match(candidateHook, /gdpr_erased: isGdprErasedEnrollment\(e\.gdpr_erased_at, normalizedExecs\),/);
  // Le panneau masque « Reprendre » (bouton et menu passent tous deux par canResume) et dit pourquoi.
  // Décision 31 : reprise possible calculée à part, réservée à l'auteur pour un collaborateur.
  assert.match(candidatePanel, /const resumable = isPaused && !gdprErased && /);
  assert.match(candidatePanel, /const canResume = resumable && ownRow;/);
  assert.match(candidatePanel, /const pauseHint = gdprErased\s*\? GDPR_ERASED_NOTICE/);
  const card = block(candidatePanel, 'function EnrollmentCard(', 'function ExecutionRow(');
  for (const m of card.matchAll(/onClick=\{onResume\}/g)) {
    const before = card.slice(Math.max(0, m.index - 400), m.index);
    assert.match(before, /canResume && pauseReason (!==|===) 'send_failed'/, 'chaque « Reprendre » dépend de canResume');
  }
});

// ---------------------------------------------------------------- 4 + D2 : motifs du moteur affichés tels quels
test('SEQ-045 / D2 — motifs d’invitation et de canal fermé affichés tels quels', () => {
  for (const name of ['ALREADY_CONNECTED_SKIP_REASON', 'INVITE_PENDING_SKIP_REASON', 'INVITE_RECENTLY_SENT_SKIP_REASON']) {
    const reason = engineConst('supabase/functions/_shared/sequence-send-rules.ts', name);
    assert.equal(lib.formatSkipReason(reason), reason, name);
  }
  for (const name of ['EMAIL_CHANNEL_CLOSED_SKIP_REASON', 'WHATSAPP_CHANNEL_CLOSED_SKIP_REASON']) {
    const reason = engineConst('supabase/functions/_shared/sequence-engine-rules.ts', name);
    assert.equal(lib.formatSkipReason(reason), reason, name);
  }
  const mailbox = engineConst('supabase/functions/_shared/sequence-resume.ts', 'MAILBOX_DISCONNECTED_SKIP_REASON');
  assert.equal(lib.formatSkipReason(mailbox), mailbox);
});

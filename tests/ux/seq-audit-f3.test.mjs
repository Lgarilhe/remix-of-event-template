/**
 * Audit des séquences (2026-09-25), lot F3 : suivi, statistiques, fiche
 * candidat et pipeline de mission.
 *
 * Les fonctions pures de src/lib/sequenceErrorMessages.ts (traductions,
 * comptage A/B, taux de réponse, bilan de reprise) sont transpilées en mémoire
 * par esbuild, sans fichier intermédiaire ni navigateur. Les écrans et les
 * hooks sont vérifiés par inspection de source, dans le style des autres tests
 * de tests/ux.
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

const { code } = transformSync(read('src/lib/sequenceErrorMessages.ts'), { loader: 'ts', format: 'esm' });
const lib = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const activityLog = read('src/components/outreach/SequenceActivityLog.tsx');
const editModal = read('src/components/outreach/activity-log/EditScheduledMessageModal.tsx');
const analytics = read('src/components/outreach/SequenceAnalytics.tsx');
const candidatePanel = read('src/components/outreach/CandidateSequencesPanel.tsx');
const candidateHook = read('src/hooks/useCandidateEnrollments.ts');
const pipelineTable = read('src/components/outreach/projects/ProjectCandidatesTableEnhanced.tsx');
const insights = read('src/components/missions/MissionInsights.tsx');
const todayHook = read('src/hooks/useTodayScheduledMessages.ts');
const projectEnrollments = read('src/hooks/useProjectEnrollments.ts');

/** Corps d'une fonction déclarée `const name = …` jusqu'à la déclaration de même niveau suivante. */
const block = (src, start, end) => {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `repère introuvable : ${start}`);
  const to = end ? src.indexOf(end, from + start.length) : src.length;
  assert.ok(to > from, `repère de fin introuvable : ${end}`);
  return src.slice(from, to);
};

// ---------------------------------------------------------------- SEQ-004 (critical)
test('SEQ-004 — la fiche candidat reprend par l’action serveur, sans réarmer d’exécution', () => {
  const resume = block(candidateHook, 'const resume = useCallback', 'const markReplied = useCallback');
  assert.match(resume, /action: 'resume_enrollments'/);
  assert.match(resume, /enrollment_ids: \[enrollmentId\]/);
  assert.doesNotMatch(resume, /sequence_step_executions/, 'le navigateur ne réécrit plus aucune exécution');
  assert.doesNotMatch(resume, /status: 'cancelled'|setMinutes/, 'plus de première annulée réarmée à +1 min');
  assert.match(resume, /summarizeResumeResponse\(/, 'le message suit le résultat réel du serveur');
});

test('SEQ-004 — le pipeline de mission reprend aussi par l’action serveur', () => {
  const resume = block(pipelineTable, 'const resumeSequence = async', 'const handleConfirmedAction');
  assert.match(resume, /action: 'resume_enrollments'/);
  assert.doesNotMatch(resume, /\.update\(\{ status: 'active' \}\)/, 'repasser active sans étape ne relançait rien');
});

test('SEQ-004 — le bilan de reprise dit ce qui s’est vraiment passé', () => {
  const ok = lib.summarizeResumeResponse({ success: true, counts: { resumed: 1 } }, 'Julie');
  assert.deepEqual([ok.tone, ok.message], ['success', 'Séquence reprise pour Julie']);

  const unlinked = lib.summarizeResumeResponse({ success: true, results: [{ enrollment_id: 'e1', outcome: 'account_unlinked' }] });
  assert.equal(unlinked.tone, 'error');
  assert.equal(unlinked.message, 'Ce compte LinkedIn n\'est plus relié. Reliez-le avant de reprendre la séquence.');

  const nothing = lib.summarizeResumeResponse({ success: true, counts: { nothing_to_resume: 1 } }, 'Julie');
  assert.equal(nothing.message, 'Rien à reprendre : cette séquence est terminée pour Julie');
  assert.notEqual(nothing.tone, 'success', 'aucun succès affiché quand rien ne repart');

  const mixed = lib.summarizeResumeResponse({ success: true, counts: { resumed: 2, error: 1 } });
  assert.equal(mixed.message, '2 séquences reprises, 1 en erreur');

  const refused = lib.summarizeResumeResponse({ success: false, message: 'Accès refusé' });
  assert.deepEqual([refused.tone, refused.message], ['error', 'Accès refusé']);
});

// ---------------------------------------------------------------- SEQ-014 (critical)
test('SEQ-014 — « Ne pas envoyer cette étape » passe par skip_execution', () => {
  const skip = block(activityLog, 'const handleSkipExecution = async', '// Filter and group executions');
  assert.match(skip, /invokeEdgeFunction[^(]*\('process-sequences'/);
  assert.match(skip, /action: 'skip_execution'/);
  assert.match(skip, /execution_id: executionId/);
  assert.match(skip, /error\?\.status === 409/, 'le refus « déjà traitée » du serveur est lu');
  assert.match(skip, /!data\?\.success/, 'aucun succès sans success: true');
  assert.doesNotMatch(activityLog, /status: 'cancelled'/, 'le Journal ne passe plus une étape en annulée');
  assert.doesNotMatch(activityLog, /\.from\('sequence_step_executions'\)\s*\.update/);
});

test('SEQ-014 — le dialogue dit que la séquence passe à l’étape suivante', () => {
  assert.match(activityLog, /<AlertDialogTitle>Ne pas envoyer cette étape \?<\/AlertDialogTitle>/);
  assert.match(activityLog, /La séquence passera à\s+l'étape suivante\. Pour tout arrêter, mettez ce candidat en pause\./);
  assert.match(activityLog, /<AlertDialogCancel>Garder l'envoi<\/AlertDialogCancel>/);
  assert.match(activityLog, /Ne pas envoyer cette étape\n/);
  assert.doesNotMatch(activityLog, /l'étape ne partira plus/, 'la promesse fausse a disparu');
});

// ---------------------------------------------------------------- SEQ-049 (high)
test('SEQ-049 — le pipeline lit les inscriptions de la mission, pas une au hasard', () => {
  const effect = block(pipelineTable, 'const fetchEnrollments = async', 'fetchEnrollments();');
  assert.match(effect, /\.in\('job_id', missionEnrollmentJobIds\(projectId, project\?\.job_id\)\)/);
  assert.doesNotMatch(pipelineTable, /enrollments\?\.find\(e => e\.profile_id === candidateId\)/);
  assert.match(effect, /if \(error\)/, 'l’erreur de lecture est lue');
});

test('SEQ-049 — la pause vise toutes les inscriptions en cours de la mission et relit le résultat', () => {
  const pause = block(pipelineTable, 'const pauseMissionEnrollments = async', '// Mettre en pause les séquences');
  assert.match(pause, /entry\?\.active\.map\(e => e\.id\)/);
  assert.match(pause, /\.update\(\{ status: 'paused', pause_reason: 'manual'/);
  assert.match(pause, /\.in\('id', ids\)/);
  assert.match(pause, /\.select\('id'\)/);
  // Contrat : une pause ne touche pas aux étapes prévues.
  assert.doesNotMatch(pause, /sequence_step_executions/);
  const stop = block(pipelineTable, 'const stopSequence = async', '// Reprendre : action serveur');
  assert.match(stop, /séquences mises en pause pour/, 'le bilan donne le nombre réel');
});

test('SEQ-049 — mission : les trois formes de job_id sont couvertes', () => {
  assert.deepEqual(lib.missionEnrollmentJobIds('p1', 'j1'), ['p1', 'project:p1', 'j1']);
  assert.deepEqual(lib.missionEnrollmentJobIds('p1', null), ['p1', 'project:p1']);
  assert.deepEqual(lib.missionEnrollmentJobIds(null, 'j1'), []);
});

// ---------------------------------------------------------------- SEQ-070 (high)
test('SEQ-070 — A/B : comptage cumulatif et réponse lue sur l’inscription', () => {
  const rows = [
    { variant_assigned: 'A', status: 'sent', enrollment_status: 'replied' }, // réponse LinkedIn
    { variant_assigned: 'A', status: 'opened', enrollment_status: 'active' },
    { variant_assigned: 'A', status: 'clicked', enrollment_status: 'completed' },
    { variant_assigned: 'A', status: 'scheduled', enrollment_status: 'replied' }, // pas partie
    { variant_assigned: 'B', status: 'executed', enrollment_status: 'active' },
    { variant_assigned: 'B', status: 'failed', enrollment_status: 'active' },
    { variant_assigned: null, status: 'sent', enrollment_status: 'replied' },
  ];
  assert.deepEqual(lib.aggregateVariantResults(rows), [
    { variant: 'A', sent: 3, opened: 2, clicked: 1, replied: 1 },
    { variant: 'B', sent: 1, opened: 0, clicked: 0, replied: 0 },
  ]);
});

test('SEQ-070 — les statistiques joignent le statut de l’inscription et utilisent le comptage partagé', () => {
  assert.match(analytics, /sequence_enrollments!inner\(sequence_id, status/);
  assert.match(analytics, /aggregateVariantResults\(/);
  assert.match(analytics, /enrollment_status: one\(row\.sequence_enrollments\)\?\.status/);
  assert.doesNotMatch(analytics, /\['sent', 'executed'\]\.includes\(exec\.status\)/, 'ancien comptage des seuls envois');
  assert.match(analytics, /Réponses suivies pour l'e-mail uniquement/);
});

// ---------------------------------------------------------------- Contrat §1 : la pause ne touche pas aux étapes
test('Contrat — la fiche candidat met en pause sans annuler d’étape, avec raison et contrôle', () => {
  const stop = block(candidateHook, 'const stop = useCallback', 'const resume = useCallback');
  assert.match(stop, /pause_reason: 'manual'/);
  assert.match(stop, /\.select\('id'\)/);
  assert.match(stop, /!data \|\| data\.length === 0/, 'zéro ligne (refus des droits) n’affiche pas de succès');
  assert.doesNotMatch(stop, /sequence_step_executions/);
});

test('SEQ-221 — « Marquer comme ayant répondu » passe par l’action serveur mark_replied', () => {
  const mark = block(candidateHook, 'const markReplied = useCallback', 'return {');
  assert.match(mark, /action: 'mark_replied'/);
  assert.doesNotMatch(mark, /\.from\('sequence_enrollments'\)/);
});

// ---------------------------------------------------------------- SEQ-109 / SEQ-161 / SEQ-176 / SEQ-238
test('SEQ-161 — une table unique de libellés d’exécution, sans repli trompeur', () => {
  assert.equal(lib.executionStatusLabel('opened'), 'Ouvert');
  assert.equal(lib.executionStatusLabel('clicked'), 'Lien cliqué');
  assert.equal(lib.executionStatusLabel('quota_blocked'), 'Reporté (limite LinkedIn du jour atteinte)');
  assert.equal(lib.executionStatusLabel('waiting_event'), "En attente d'une réponse ou d'une acceptation");
  assert.equal(lib.executionStatusLabel('nouveau_statut'), 'Statut inconnu');
  assert.deepEqual([...lib.SENT_EXECUTION_STATUSES], ['sent', 'opened', 'clicked', 'replied']);
  assert.doesNotMatch(activityLog, /statusConfig\.scheduled/, 'plus de repli sur « Planifié »');
  assert.doesNotMatch(candidatePanel, /EXEC_STATUS_CONFIG\.cancelled/, 'plus de repli sur « Annulé »');
});

test('SEQ-109 — error_message affiché seulement pour un échec ou une étape reprogrammée', () => {
  assert.equal(lib.shouldShowExecutionError('failed'), true);
  assert.equal(lib.shouldShowExecutionError('scheduled'), true);
  assert.equal(lib.shouldShowExecutionError('sent'), false);
  assert.match(candidatePanel, /execution\.error_message && shouldShowExecutionError\(execution\.status\)/);
  assert.match(activityLog, /!!exec\.error_message && shouldShowExecutionError\(exec\.status\)/);
});

test('SEQ-176 — la fiche ne dit plus « Envoyé » sur un échec ou un saut', () => {
  assert.equal(lib.executionDoneVerb('failed'), 'Échec');
  assert.equal(lib.executionDoneVerb('skipped'), 'Ignoré');
  assert.equal(lib.executionDoneVerb('cancelled'), 'Annulé');
  assert.equal(lib.executionDoneVerb('opened'), 'Envoyé');
  assert.doesNotMatch(candidatePanel, /execution\.executed_at\s*\?\s*`Envoyé/);
});

test('SEQ-238 — libellés d’action et étapes internes partagés', () => {
  assert.equal(lib.actionTypeLabel('email'), 'E-mail');
  assert.equal(lib.actionTypeLabel('condition_branch'), 'Branchement');
  assert.equal(lib.isHiddenActionType('wait_profile_visit'), true);
  assert.equal(lib.isHiddenActionType('condition_branch'), true);
  assert.equal(lib.isHiddenActionType('inmail'), false);
  assert.match(activityLog, /\.not\('sequence_steps\.action_type', 'in', `\(\$\{HIDDEN_ACTION_TYPES\.join\(','\)\}\)`\)/,
    'les étapes internes sont écartées avant la limite de 500');
});

// ---------------------------------------------------------------- SEQ-162
test('SEQ-162 — raisons et erreurs du moteur traduites', () => {
  assert.equal(lib.formatSkipReason('Enrollment inactive'), "Candidat en pause au moment de l'envoi");
  assert.equal(lib.formatSkipReason('Timeout 3d (override 3d, default 5d)'), "Délai d'attente dépassé (3 jours)");
  assert.equal(lib.formatSkipReason('Condition: if_connected'), 'Condition non remplie');
  assert.equal(lib.formatSkipReason('Reply detected (pre-send check)'), 'Réponse détectée');
  assert.equal(lib.formatSkipReason('No email — channel skipped'), "Pas d'adresse e-mail, étape passée");
  assert.equal(lib.formatSkipReason('Auto-paused: high failure rate'), "Séquence mise en pause automatiquement : trop d'échecs d'envoi");
  assert.equal(lib.formatSkipReason('something_new_from_engine'), 'Étape non envoyée');
  assert.equal(
    lib.formatSequenceError('Retry 1/3: linkedin_send_failed_500: {"status":500}'),
    "Nouvel essai 1 sur 3 : Échec de l'envoi LinkedIn",
  );
  assert.match(lib.formatSequenceError('Rate limit (inmail) → rescheduled to 2026-09-26T14:05:00.000Z'), /^Limite LinkedIn atteinte, nouvel essai le 26 septembre à /);
  assert.equal(lib.formatSequenceError('Recovered: email was sent but status update failed'), 'Envoyé');
  for (const codeErr of ['rate_limit', 'unauthorized', 'email_send_failed', 'linkedin_send_failed_401: {}']) {
    assert.doesNotMatch(lib.formatSequenceError(codeErr), /provider|réessaie|reconnecte-le/, codeErr);
  }
  assert.match(candidatePanel, /Raison : \{formatSkipReason\(execution\.skip_reason\)\}/);
});

// ---------------------------------------------------------------- SEQ-169
test('SEQ-169 — taux de réponse = répondus / contactés, alerte à partir de 5 contactés', () => {
  assert.deepEqual(lib.computeResponseRate({ replied: 1, contacted: 4 }), { replied: 1, contacted: 4, rate: 25 });
  assert.equal(lib.computeResponseRate({ replied: 0, contacted: 0 }).rate, null);
  assert.deepEqual(
    lib.countContactedEnrollments([
      { status: 'active', execution_statuses: ['scheduled'] }, // inscrit, jamais contacté
      { status: 'active', execution_statuses: ['sent', 'scheduled'] },
      { status: 'replied', execution_statuses: [] },
      { status: 'completed' },
    ]),
    { replied: 1, contacted: 3 },
  );
  assert.equal(lib.RESPONSE_RATE_MIN_CONTACTED, 5);
  assert.match(insights, /response\.contacted >= RESPONSE_RATE_MIN_CONTACTED/);
  assert.doesNotMatch(insights, /enrollmentStats\.total >= 5 && responseRate/, 'plus d’alerte dès l’inscription');
});

// ---------------------------------------------------------------- SEQ-167 / SEQ-168
test('SEQ-167/168 — Journal, statistiques et mission comptent les inscriptions de la mission', () => {
  assert.match(activityLog, /projectId\?: string \| null/);
  assert.match(activityLog, /query\.in\('sequence_enrollments\.job_id', jobIds\)/);
  assert.match(activityLog, /Cette mission<\/SelectItem>/);
  assert.match(analytics, /enrollQuery\.in\('job_id', jobIds\)/);
  assert.match(insights, /\.in\('job_id', missionEnrollmentJobIds\(project\.id, project\.job_id\)\)/);
  assert.doesNotMatch(insights, /\.eq\('project_id', project\.id\)/);
});

// ---------------------------------------------------------------- SEQ-164 / SEQ-165 / SEQ-180
test('SEQ-164 — un échec de chargement n’affiche pas des zéros', () => {
  assert.match(analytics, /setLoadError\(true\)/);
  assert.match(analytics, /Impossible de charger les statistiques/);
  assert.match(insights, /setEnrollmentStatsError\(true\)/);
  assert.match(insights, /Chiffre indisponible/);
});

test('SEQ-165 — le Journal signale une liste tronquée', () => {
  assert.match(activityLog, /isTruncated = executions\.length >= JOURNAL_LIMIT/);
  assert.match(activityLog, /Sur les \{JOURNAL_LIMIT\} dernières actions\./);
});

test('SEQ-180 — la période s’applique aux inscriptions et les réponses ont une seule source', () => {
  assert.match(analytics, /\.gte\('created_at', sinceTs\)\s*\.lte\('created_at', untilTs\);\s*if \(filterSeqId\) enrollQuery/);
  assert.match(analytics, /\{ name: 'RÉPONSES', value: enrollmentStats\?\.replied \?\? 0 \}/);
  assert.doesNotMatch(analytics, /action_type\.replace\(\/_\/g, ' '\)/);
});

// ---------------------------------------------------------------- SEQ-123
test('SEQ-123 — retirer un candidat de la mission met sa séquence en pause, sauf choix explicite', () => {
  assert.match(pipelineTable, /Laisser la séquence continuer/);
  assert.match(pipelineTable, /const \[keepSequenceRunning, setKeepSequenceRunning\] = useState\(false\)/);
  const remove = block(pipelineTable, 'const removeFromProject = async', 'if (isLoading)');
  assert.match(remove, /pauseMissionEnrollments\(candidate\.candidate_id\)/);
  assert.match(remove, /\.update\(\{ project_id: null \}\)[\s\S]*?\.select\('id'\)/);
});

// ---------------------------------------------------------------- SEQ-174 / SEQ-175 / SEQ-243
test('SEQ-174/175/243 — le Journal montre et corrige le message qui partira', () => {
  assert.match(activityLog, /message_overrides:tracking_data->message_overrides/);
  assert.match(activityLog, /Modèle, personnalisé au moment de l'envoi/);
  assert.match(editModal, /execution\.final_message \|\| execution\.preview\?\.message/);
  assert.match(editModal, /actionType === 'inmail' \|\| actionType === 'email'/);
  assert.match(editModal, /\{'\{\{prenom\}\}'\}/);
  assert.doesNotMatch(editModal, /firstName/);
});

// ---------------------------------------------------------------- SEQ-181 / SEQ-161 (tableau de bord)
test('SEQ-181 — « Aujourd’hui » : organisation dans la clé, envois ouverts gardés, pauses écartées', () => {
  assert.match(todayHook, /queryKey: \['today-scheduled-messages', organizationId\]/);
  assert.match(todayHook, /\['scheduled', 'sending', 'quota_blocked', 'sent', 'opened', 'clicked', 'replied'\]/);
  assert.match(todayHook, /if \(!sent && enrollment\?\.status !== 'active'\) continue;/);
});

// ---------------------------------------------------------------- SEQ-186 / SEQ-240 / SEQ-241 / SEQ-244
test('SEQ-186 — les badges « En séquence » se rechargent depuis n’importe quel écran', () => {
  assert.match(projectEnrollments, /export function refreshProjectEnrollments\(\)/);
  assert.match(projectEnrollments, /refetch: fetchEnrollments/);
});

test('SEQ-240/244 — fiche candidat : nom accessible, boutons désactivés pendant l’appel, actions envoyées', () => {
  assert.match(candidatePanel, /aria-label="Actions de l'inscription"/);
  assert.match(candidatePanel, /disabled=\{isBusy\}/);
  assert.match(candidatePanel, /action\$\{sentCount > 1 \? 's' : ''\} envoyée/);
  assert.doesNotMatch(candidatePanel, /\{sentCount\}\/\{totalSteps\}/);
});

test('SEQ-241 — les trois hooks de statistiques sans appelant sont supprimés', () => {
  for (const rel of ['src/hooks/useResponseRateStats.ts', 'src/hooks/useDailyInviteStats.ts', 'src/hooks/useOutreachAcceptanceStats.ts']) {
    assert.equal(existsSync(new URL(rel, ROOT)), false, rel);
  }
});

// ---------------------------------------------------------------- SEQ-245
test('SEQ-245 — vocabulaire : pas de tutoiement ni d’anglicisme dans le suivi', () => {
  for (const [name, src] of [['fiche', candidatePanel], ['journal', activityLog], ['statistiques', analytics]]) {
    assert.doesNotMatch(src, /\bTu pourras\b|\bsi tu\b|Skippé|Smart Message|Analytics —|Prospects'|Funnel de conversion/, name);
  }
});

// ---------------------------------------------------------------- Demandes croisées (passe 2)

test('SEQ-202 — adresses bloquées et compte d’envoi hors organisation : motifs lisibles', () => {
  assert.equal(lib.formatSkipReason('Adresse bloquée pour les envois e-mail'), 'Adresse bloquée pour les envois e-mail');
  assert.equal(lib.formatSkipReason('Adresse en liste de suppression (bounce)'), 'Adresse bloquée pour les envois e-mail',
    'la raison technique de l’ancien motif n’est plus exposée');
  assert.equal(lib.formatSkipReason("Compte d'envoi non rattaché à l'organisation"), "Compte d'envoi non rattaché à l'organisation");
  // error_message déjà rédigés en français par l'envoi e-mail : affichés tels quels sur un échec.
  const noMailbox = "Aucune boîte e-mail n'est reliée pour l'expéditeur : reliez-la dans Paramètres, Connexions.";
  const uncertainMail = "Envoi incertain : vérifiez le dossier Envoyés de la boîte d'envoi avant de relancer.";
  assert.equal(lib.formatSequenceError(noMailbox), noMailbox);
  assert.equal(lib.formatSequenceError(uncertainMail), uncertainMail);
  assert.equal(lib.shouldShowExecutionError('failed'), true);
});

test('SEQ-214 — refus de la base traduits en français', () => {
  assert.equal(
    lib.sequenceWriteRefusal({ code: '42501', hint: 'EXECUTION_ALREADY_DONE', message: 'x' }),
    "Cette étape est déjà envoyée ou en cours d'envoi : elle ne peut plus être modifiée.",
  );
  assert.equal(lib.sequenceWriteRefusal({ hint: 'EXECUTION_NOT_SCHEDULED' }), 'Seul un message encore programmé peut être modifié.');
  for (const hint of ['EXECUTION_IMMUTABLE', 'SEQUENCE_ORG_MISMATCH', 'PROJECT_ORG_MISMATCH', 'STEP_SEQUENCE_MISMATCH']) {
    assert.equal(lib.sequenceWriteRefusal({ hint }), 'Action refusée : cet élément appartient à une autre séquence ou organisation.', hint);
    assert.equal(lib.formatSequenceError(hint), 'Action refusée : cet élément appartient à une autre séquence ou organisation.', hint);
  }
  assert.equal(lib.sequenceWriteRefusal({ hint: null, message: 'violates row-level security' }), null, 'autre erreur : message de l’appelant');
  assert.equal(lib.sequenceWriteRefusal(null), null);
  assert.equal(lib.formatSkipReason("Étape d'une autre séquence : annulée"), "Étape d'une autre séquence : annulée");
  assert.match(editModal, /toast\.error\(sequenceWriteRefusal\(err\) \?\? "La modification n'a pas été enregistrée\. Réessayez\."\)/);
});

test('SEQ-003 / SEQ-027 — nouveaux motifs du moteur, plus de repli « Étape non envoyée »', () => {
  assert.equal(lib.formatSkipReason("Inscription devenue replied pendant l'envoi"), "Message envoyé ; le candidat a répondu pendant l'envoi");
  assert.equal(lib.formatSkipReason("Inscription devenue paused pendant l'envoi"), "Message envoyé ; candidat mis en pause pendant l'envoi");
  assert.equal(lib.formatSkipReason("Inscription devenue completed pendant l'envoi"), "Message envoyé ; la séquence s'est terminée pour ce candidat pendant l'envoi");
  assert.equal(lib.formatSkipReason("Inscription close avant l'envoi (replied)"), 'Séquence terminée pour ce candidat');
  assert.equal(lib.formatSkipReason('Inscription close (completed) : attente annulée'), 'Séquence terminée pour ce candidat');
  assert.equal(lib.formatSkipReason('Étape déjà envoyée'), 'Étape déjà envoyée');
  assert.equal(lib.formatSkipReason("Étape incohérente avec l'inscription : annulée sans envoi"), "Étape incohérente avec l'inscription : annulée sans envoi");
  assert.equal(lib.formatSkipReason('Aucune adresse e-mail connue pour ce candidat : étape e-mail sautée'), "Pas d'adresse e-mail, étape passée");
  for (const reason of [
    "Inscription supprimée avant l'envoi",
    'Tous les expéditeurs ont atteint leur limite du jour',
    "Le candidat a répondu sur un autre compte de l'organisation",
    'Rendez-vous pris : séquence arrêtée',
    'Effacement des données demandé : séquence arrêtée',
  ]) {
    assert.equal(lib.formatSkipReason(reason), reason);
  }
  // error_message déjà en français : passent tels quels.
  for (const msg of [
    'Envoi incertain : vérifiez la conversation avant de relancer (code 503)',
    'Génération IA indisponible : nouvel essai 1/3 dans 30 min',
    "Message vide : rien n'a été envoyé. Complétez le texte de l'étape puis relancez-la.",
  ]) {
    assert.equal(lib.formatSequenceError(msg), msg);
  }
});

test('SEQ-005 — codes du moteur « code: phrase » : seule la phrase est affichée', () => {
  assert.equal(lib.formatSequenceError('send_uncertain'), 'Envoi incertain : vérifiez la conversation avant de relancer');
  assert.equal(
    lib.formatSequenceError('inmail_credits_exhausted: Crédits InMail épuisés : l’envoi reprendra quand des crédits seront disponibles.'),
    'Crédits InMail épuisés : l’envoi reprendra quand des crédits seront disponibles.',
  );
  assert.equal(
    lib.formatSequenceError('Retry 1/3: profile_read_unavailable: Lecture du profil LinkedIn momentanément indisponible, nouvel essai plus tard.'),
    'Nouvel essai 1 sur 3 : Lecture du profil LinkedIn momentanément indisponible, nouvel essai plus tard.',
  );
  for (const code of ['profile_read_unavailable', 'inmail_balance_unavailable', 'inmail_credits_exhausted', 'inmail_subject_missing']) {
    assert.doesNotMatch(lib.formatSequenceError(`${code}: Phrase.`), new RegExp(code), code);
    assert.doesNotMatch(lib.formatSequenceError(code), new RegExp(code), `${code} seul`);
  }
  for (const reason of ['Déjà en relation : invitation inutile', 'Invitation déjà en attente', 'Invitation déjà envoyée récemment',
    "Profil LinkedIn introuvable : vérifiez l'adresse du profil dans la fiche du candidat.", 'Crédits InMail épuisés',
    'Contrôle des crédits InMail momentanément indisponible, nouvel essai prochainement']) {
    assert.equal(lib.formatSkipReason(reason), reason);
  }
  assert.equal(lib.formatSkipReason('Contrôle de quota indisponible, nouvel essai prochainement'), 'Reporté : vérification des limites indisponible');
});

test('SEQ-004 — fiche candidat : mark_replied côté serveur, message selon le résultat', () => {
  const mark = block(candidateHook, 'const markReplied = useCallback', 'return {\n    enrollments');
  assert.match(mark, /action: 'mark_replied'/);
  assert.match(mark, /enrollment_id: enrollmentId/);
  assert.match(mark, /data\?\.changed === false/);
  assert.doesNotMatch(mark, /from\('sequence_(enrollments|step_executions)'\)/);
});

test('SEQ-245 — noms des types d’étape : ceux de l’éditeur', async (t) => {
  let graph;
  try {
    graph = await import('../../src/components/outreach/sequence/sequenceGraph.ts');
  } catch (err) {
    if (err && err.code === 'ERR_UNKNOWN_FILE_EXTENSION') return t.skip('Node sans lecture native du TypeScript');
    throw err;
  }
  for (const [key, label] of Object.entries(graph.STEP_TYPE_LABELS)) {
    assert.equal(lib.actionTypeLabel(key), label, key);
  }
  for (const [name, src] of [['journal', activityLog], ['fiche', candidatePanel], ['statistiques', analytics]]) {
    assert.match(src, /import \{ stepTypeLabel \} from '(@\/components\/outreach|\.)\/sequence\/sequenceGraph';/, name);
    assert.doesNotMatch(src, /actionTypeLabel\(/, name);
  }
});

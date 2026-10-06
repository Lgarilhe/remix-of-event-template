/**
 * Audit séquences 2026-09-25, lot F2b — garde-fous de non-régression sur la
 * liste des séquences, le suivi des inscrits, le diagnostic et l'onglet
 * Contact de la mission (défauts medium et low).
 *
 * Lecture du code source (même modèle que lot1-sequences.test.mjs), commentaires
 * retirés : on teste le code, pas ce qu'il raconte.
 * Lancer : node --test tests/ux/seq-audit-f2b.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// F2B_ROOT permet de rejouer ces tests sur une autre copie des fichiers
// (vérification qu'ils échouent sur l'ancien code).
const root = process.env.F2B_ROOT ? new URL(`file://${process.env.F2B_ROOT.replace(/\/?$/, '/')}`) : new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');

/** Retire les commentaires de bloc, JSX et de ligne (hors chaînes d'URL). */
const stripComments = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/([;{}),])\s*\/\/[^\n'"`]*$/gm, '$1');

const list = stripComments(read('src/components/outreach/SequencesList.tsx'));
const panel = stripComments(read('src/components/outreach/SequenceEnrollmentsPanel.tsx'));
const diagnostic = stripComments(read('src/components/outreach/SequenceDiagnostic.tsx'));
const mission = stripComments(read('src/components/missions/MissionOutreach.tsx'));
// Lot 5c-1 : fonctions de la liste et du suivi sorties dans sequenceActions.ts,
// enregistrement de l'éditeur dans useSequenceSave.ts.
const actions = stripComments(read('src/lib/sequenceActions.ts'));
const saveHook = stripComments(read('src/hooks/useSequenceSave.ts'));

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

// ---------------------------------------------------------------- SEQ-071 / SEQ-221
test('SEQ-071 / SEQ-221 — le panneau n’écrit plus aucune exécution depuis le navigateur', () => {
  assert.doesNotMatch(`${panel}\n${actions}`, /from\('sequence_step_executions'\)\s*\.update/);
  assert.doesNotMatch(`${panel}\n${actions}`, /\.eq\('status', 'scheduled'\)\s*;?\s*\n\s*\n?\s*(toast|setEnrollments)/);
  assert.match(body(actions, 'markReplied'), /action: 'mark_replied'/);
});

// ---------------------------------------------------------------- SEQ-121
test('SEQ-121 — chaque raison de pause propose l’action qui débloque', () => {
  assert.match(panel, /<Link to="\/settings\/account\/connections">/);
  assert.match(panel, /Reconnecter le compte/);
  assert.match(panel, /<Link to="\/pricing">/);
  assert.match(panel, /Voir les offres/);
  assert.match(panel, /Voir l'erreur/);
  assert.match(panel, /const RESUMABLE_PAUSE_REASONS = new Set<string>\(\['manual', 'send_failed'\]\)/);
  // « Reprendre » n'est plus proposé pour un compte déconnecté ou un abonnement manquant.
  assert.match(panel, /\(!enrollment\.pause_reason \|\| RESUMABLE_PAUSE_REASONS\.has\(enrollment\.pause_reason\) \|\| sequencePauseResumable\)/);
  assert.match(panel, /\{canResume && \(/);
});

// ---------------------------------------------------------------- SEQ-122 / SEQ-232
test('SEQ-122 / SEQ-232 — la suppression dit ce qu’elle efface, séquence partagée comprise', () => {
  assert.match(list, /Ces candidats ne seront plus signalés comme déjà contactés lors d'une prochaine inscription\./);
  // Lot 5b : l'interrupteur s'appelle « Mettre en pause la séquence ».
  assert.match(list, /Préférez la mise en pause de la séquence si vous voulez garder cette protection\./);
  assert.match(list, /Cette séquence est partagée entre toutes vos missions : elle disparaîtra partout/);
  assert.match(list, /const shared = !deleteTarget\.project_id;/);
  assert.doesNotMatch(list, /✨ Template/);
  // Revue design : une seule ligne responsive par séquence, un seul badge ; plus de
  // copie séparée pour téléphone.
  assert.equal((list.match(/Partagée entre missions/g) || []).length, 1, 'badge de la ligne unique');
  assert.equal((list.match(/filteredSequences\.map\(/g) || []).length, 1, 'une seule liste de lignes');
  assert.doesNotMatch(list, /key=\{`mobile-|sm:hidden/, 'plus de copie pour téléphone');
});

// ---------------------------------------------------------------- SEQ-147
test('SEQ-147 — l’éditeur reçoit les valeurs qu’il affiche par défaut', () => {
  const edit = body(actions, 'handleEdit');
  assert.match(edit, /s\.condition_type === 'if_score_above' \? DEFAULT_SCORE_THRESHOLD : undefined/);
  assert.match(edit, /TIMEOUT_REQUIRED_ACTIONS\.includes\(s\.action_type\) \? DEFAULT_WAIT_TIMEOUT_DAYS : undefined/);
  assert.match(actions, /const DEFAULT_SCORE_THRESHOLD = '70';/);
  assert.match(actions, /const DEFAULT_WAIT_TIMEOUT_DAYS = 3;/);
});

// ---------------------------------------------------------------- SEQ-149
test('SEQ-149 — un échec des étapes à la création supprime l’en-tête créé', () => {
  const save = body(saveHook, 'handleSaveSequence');
  assert.match(save, /createdSequenceId = newSeq\.id;/);
  const onError = save.slice(save.indexOf('if (stepsError) {'));
  assert.match(onError, /if \(createdSequenceId\) \{[\s\S]*?from\('outreach_sequences'\)\s*\.delete\(\)\s*\.eq\('id', createdSequenceId\)/);
});

// ---------------------------------------------------------------- SEQ-150 / SEQ-154
test('SEQ-150 / SEQ-154 — l’éditeur connaît les candidats en cours et le droit d’envoi', () => {
  assert.match(list, /activeEnrollmentCount=\{editingSequence\?\.id \? editingActiveCount : 0\}/);
  assert.match(list, /canSendSequences=\{canSendSequences\}/);
  assert.match(body(actions, 'handleEdit'), /setEditingActiveCount\(activeError \? undefined : \(activeNow \?\? 0\)\)/);
  const save = body(saveHook, 'handleSaveSequence');
  // Décision 32 : abonnement pas encore lu, la séquence est aussi créée désactivée.
  // Lot 5c-1 : règle sortie dans sequenceActions.ts, formule inchangée.
  assert.match(actions, /export const shouldCreateInactiveForPlan = \([\s\S]*?\): boolean => !sequence\.id && sequence\.isActive && \(!canSendSequences \|\| planStateUnknown\);/);
  assert.match(save, /const createInactiveForPlan = shouldCreateInactiveForPlan\(sequence, canSendSequences, planStateUnknown\);/);
  assert.match(save, /is_active: sequence\.isActive && !createInactiveForPlan,/);
  // En modification, l'interrupteur (pause et reprise des candidats) reste seul à écrire is_active.
  const update = save.slice(save.indexOf(".from('outreach_sequences')\n          .update({"), save.indexOf(".eq('id', sequence.id);"));
  assert.ok(update.length > 0, 'mise à jour de l’en-tête introuvable');
  assert.doesNotMatch(update, /is_active:/);
});

// ---------------------------------------------------------------- SEQ-151
test('SEQ-151 — étapes relues à l’ouverture, étape inconnue refusée à l’enregistrement', () => {
  const edit = body(actions, 'handleEdit');
  assert.match(edit, /from\('sequence_steps'\)\s*\.select\('\*'\)\s*\.eq\('sequence_id', seq\.id\)/);
  assert.doesNotMatch(edit, /seq\.steps\.map/);
  assert.match(edit, /editorBaseStepIdsRef\.current = \{ sequenceId: seq\.id, stepIds: new Set\(steps\.map\(s => s\.id\)\) \}/);
  const save = body(saveHook, 'handleSaveSequence');
  const check = save.indexOf('throw new Error(CONCURRENT_EDIT_MESSAGE)');
  const write = save.indexOf(".from('outreach_sequences')\n          .update(");
  assert.ok(check !== -1, 'le contrôle d’édition concurrente doit exister');
  assert.ok(write === -1 || check < write, 'le contrôle doit précéder toute écriture');
  assert.match(saveHook, /Cette séquence a été modifiée par un collègue depuis son ouverture\. Rouvrez-la avant d’enregistrer\./);
});

// ---------------------------------------------------------------- SEQ-161 / SEQ-163 / SEQ-238
test('SEQ-161 / SEQ-163 / SEQ-238 — statuts et types d’étape lus dans les tables partagées', () => {
  assert.match(panel, /executionStatusLabel\(status\)/);
  assert.match(panel, /isSentExecutionStatus\(/);
  assert.doesNotMatch(panel, /executionStatusConfig\.pending/, 'un e-mail ouvert retombait sur « À venir »');
  assert.doesNotMatch(panel, /statusConfig\.active/, 'un rebond retombait sur « Active »');
  assert.match(panel, /enrollmentStatusLabel\(enrollment\.status\)/);
  assert.match(panel, /statusStyle\[enrollment\.status\] \|\| NEUTRAL_STATUS_STYLE/);
  assert.match(panel, /actionTypeLabel\(step\.action_type\)/);
  assert.match(panel, /isHiddenActionType\(/);
  assert.doesNotMatch(panel, /send_inmail|send_invitation|visit_profile/);
  assert.doesNotMatch(panel, /'executed'/);
});

// ---------------------------------------------------------------- SEQ-162
test('SEQ-162 — raisons et erreurs du moteur traduites dans le panneau', () => {
  // Lot 5b : avec le contexte d'arrêt manuel de l'inscription.
  assert.match(panel, /formatSkipReason\(exec\.skip_reason, \{ manualStop: hasManualStopTrace\(enrollment\.tracking_data\) \}\)/);
  assert.doesNotMatch(panel, /\{exec\.skip_reason\}/);
  assert.doesNotMatch(panel, /:\s*exec\.skip_reason\s*\n/);
  assert.doesNotMatch(`${panel}\n${actions}`, /skippée/);
});

// ---------------------------------------------------------------- SEQ-164
test('SEQ-164 — un échec de chargement affiche une erreur et « Réessayer », jamais l’accueil', () => {
  assert.match(list, /const \[loadError, setLoadError\] = useState\(false\);/);
  // Revue design : la phrase est répartie entre le titre et la description de l'état
  // d'erreur du socle, dont le bouton « Réessayer » relance le chargement.
  assert.match(list, /\{loadError && sequences\.length === 0 \? \(\s*<ErrorState\s+title="Impossible de charger vos séquences"\s+description="Vérifiez votre connexion puis réessayez\.[^"]*"[^>]*onRetry=\{handleRetry\}/);
  assert.match(list, /Impossible de charger le détail des séquences\./);
  assert.doesNotMatch(list, /const \{ data: stepsData \} = await/);
  assert.doesNotMatch(list, /const \{ data: enrollData \} = await/);
  // Revue design : pas de tiret long visible, le compteur indisponible s'écrit « – ».
  assert.match(list, /detailError\.counts \? '–' : String\(n\)/);
  // Revue design : recherche sans résultat dans l'état vide du socle.
  assert.match(list, /title=\{`Aucune séquence ne correspond à « \$\{searchQuery\.trim\(\)\} »`\}/);
});

// ---------------------------------------------------------------- SEQ-165
test('SEQ-165 — compteurs exacts au-delà de 1 000 lignes, recompte au clic', () => {
  assert.match(list, /async function fetchAllPages</);
  const fetch = list.slice(list.indexOf('const fetchSequences = React.useCallback('), list.indexOf('}, [projectId]);'));
  assert.ok(fetch.length > 0, 'fetchSequences introuvable');
  // SEQ-165 (B6, vague finale) : compteurs groupés en base, paginés eux aussi.
  assert.match(fetch, /fetchAllPages\(\(from, to\) => supabase\s*\.rpc\('get_sequence_enrollment_counts', \{ p_sequence_ids: sequenceIds \}\)[\s\S]*?\.range\(from, to\)\)/);
  const toggle = body(actions, 'requestToggle');
  // Lot 5b : plus de confirmation, donc plus de comptage avant la pause ; le
  // recompte en base suit la mise en pause des inscriptions (deactivateSequence).
  assert.match(body(actions, 'deactivateSequence'), /\.select\('id', \{ count: 'exact', head: true \}\)\s*\.eq\('sequence_id', sequenceId\)\s*\.eq\('status', 'active'\)/);
  assert.doesNotMatch(toggle, /setToggleConfirm/);
  assert.doesNotMatch(toggle, /if \(seq\.enrollments\.active > 0\)/);
  assert.match(panel, /const EXECUTION_BATCH_SIZE = 50;/);
  assert.match(body(panel, 'fetchExecutionsFor'), /\.range\(from, from \+ EXECUTION_PAGE_SIZE - 1\)/);
});

// ---------------------------------------------------------------- SEQ-166
test('SEQ-166 — la liste se recharge à la fermeture du panneau, le panneau s’actualise', () => {
  const panelBlock = list.slice(list.indexOf('<SequenceEnrollmentsPanel'), list.indexOf('<SequenceEnrollmentsPanel') + 400);
  assert.match(panelBlock, /onClose=\{\(\) => \{\s*setEnrollmentsPanelSequence\(null\);\s*void fetchSequences\(\);/);
  assert.match(panel, /aria-label="Actualiser la liste des inscrits"/);
});

// ---------------------------------------------------------------- SEQ-167 / SEQ-246
test('SEQ-167 / SEQ-246 — journal, statistiques et diagnostic limités à la mission', () => {
  assert.match(list, /<SequenceActivityLog[\s\S]*?projectId=\{projectId\}/);
  assert.equal((list.match(/<SequenceAnalytics[\s\S]*?projectId=\{projectId\}[\s\S]*?\/>/g) || []).length, 2);
  assert.match(diagnostic, /missionEnrollmentJobIds\(projectId\)/);
  assert.match(diagnostic, /\.in\('enrollment\.job_id', jobIds\)/);
  assert.doesNotMatch(diagnostic, /sequenceIds\.length > 0/, 'une mission sans séquence propre montrait toute l’organisation');
  assert.doesNotMatch(diagnostic, /\.in\('enrollment_id'/, 'longues listes d’identifiants dans l’URL');
  assert.match(diagnostic, /Chiffre indisponible/);
  // Lot 5b : dit par le toast de la mise en pause (plus de fenêtre).
  assert.match(actions, /Cette séquence est partagée entre vos missions : ses candidats des autres missions sont aussi en pause\./);
});

// ---------------------------------------------------------------- SEQ-168 / SEQ-169
test('SEQ-168 / SEQ-169 — chiffres de mission par job_id, rechargés, taux de réponse partagé', () => {
  assert.doesNotMatch(mission, /from\('outreach_sequences'\)/);
  assert.match(mission, /missionEnrollmentJobIds\(project\.id, project\.job_id\)/);
  assert.match(mission, /\.select\('id', \{ count: 'exact', head: true \}\)\s*\.in\('job_id', jobIds\)/);
  assert.match(mission, /\}, \[project\.id, project\.job_id, statsVersion\]\);/);
  assert.match(mission, /onDataChanged=\{handleSequencesChanged\}/);
  assert.match(list, /onDataChangedRef\.current\?\.\(\);/);
  assert.match(mission, /computeResponseRate\(\{/);
  assert.doesNotMatch(mission, /enrollmentStats\.replied \/ enrollmentStats\.total/);
  assert.match(mission, /response\.contacted >= RESPONSE_RATE_MIN_CONTACTED/);
});

// ---------------------------------------------------------------- SEQ-170 / SEQ-171 / SEQ-173
test('SEQ-170 — le diagnostic parle clair et ne crie plus à la panne toutes les 5 minutes', () => {
  assert.match(diagnostic, /const HEALTHY_DELAY_MS = 12 \* 60 \* 1000;/);
  assert.doesNotMatch(diagnostic, /< 5 \* 60 \* 1000/);
  for (const jargon of ['pg_cron', 'Pipeline', 'dernier run', 'Dernière exécution cron', 'error_count', 'tu approches']) {
    assert.ok(!diagnostic.includes(jargon), `texte technique restant : ${jargon}`);
  }
  assert.match(diagnostic, /Envoi automatique opérationnel, dernier passage/);
  assert.match(diagnostic, /Les envois automatiques semblent interrompus depuis \$\{/);
  assert.match(diagnostic, /Le système d'envoi passe toutes les 5 minutes\./);
});

test('SEQ-171 — la jauge d’invitations lit le plafond réel du compte de l’utilisateur', () => {
  assert.doesNotMatch(diagnostic, /WEEKLY_INVITE_LIMIT/);
  assert.doesNotMatch(diagnostic, /~100\/semaine/);
  assert.match(diagnostic, /useLinkedInQuotaStatus\(open \? myAccountId : null\)/);
  assert.match(diagnostic, /getUserLinkedAccountId\(user\.id\)/);
  assert.match(diagnostic, /quota\?\.caps\?\.weekly_invitations/);
});

test('SEQ-173 — envois et échecs comptés sur la date d’envoi, dernier message visible', () => {
  assert.doesNotMatch(diagnostic, /\.gte\('created_at', since24h\)/);
  assert.match(diagnostic, /\.gte\('executed_at', since24h\)/);
  assert.match(diagnostic, /executed_at\.gte\.\$\{since24h\},and\(executed_at\.is\.null,updated_at\.gte\.\$\{since24h\}\)/);
  assert.match(diagnostic, /step:sequence_steps!inner\(action_type\)/);
  assert.match(diagnostic, /\.in\('step\.action_type', MESSAGE_ACTION_TYPES\)/);
});

// ---------------------------------------------------------------- SEQ-172
test('SEQ-172 — aucun toast ne promet un départ « dans la minute »', () => {
  for (const src of [list, panel, diagnostic, actions, saveHook]) assert.doesNotMatch(src, /dans la minute/);
  assert.match(body(actions, 'handleNudgeToday'), /toast\.info\('Rien à avancer pour aujourd’hui\.'\)/);
});

// ---------------------------------------------------------------- SEQ-177 / SEQ-178
test('SEQ-177 — bandeau Go : vrai comptage et bouton qui ouvre la création', () => {
  assert.doesNotMatch(mission, /sourcing_project_candidates/);
  assert.match(mission, /from\('job_candidate_status'\)\s*\.select\('candidate_id'\)\s*\.eq\('project_id', project\.id\)\s*\.eq\('recommendation', 'go'\)/);
  assert.match(mission, /candidateIds\.size/);
  assert.match(mission, /setCreateRequestId\(id => id \+ 1\)/);
  assert.match(mission, /createRequestId=\{createRequestId\}/);
  assert.match(list, /if \(createRequestId && createRequestId !== handledCreateRequestRef\.current\) \{[\s\S]*?setShowTemplateSelector\(true\);/);
  assert.match(mission, /Créez une séquence puis inscrivez-les depuis l'onglet Sourcing\./);
});

test('SEQ-178 — l’onglet Contact montre le chemin pour inscrire des candidats', () => {
  assert.match(list, /navigate\(`\/missions\/\$\{projectId\}\?tab=sourcing`\)/);
  // Revue design : une seule ligne responsive par séquence, donc un seul lien de
  // ligne (plus de copie séparée pour téléphone), plus l'action du toast de création.
  assert.ok((`${list}\n${saveHook}`.match(/Inscrire des candidats/g) || []).length >= 2, 'lien de la ligne et action du toast de création');
  assert.match(list, /onClick=\{goToSourcing\}[^>]*>\s*Inscrire des candidats/, 'lien de la ligne vers le Sourcing');
  assert.equal((list.match(/filteredSequences\.map\(/g) || []).length, 1, 'une seule liste de lignes');
  assert.doesNotMatch(list, /key=\{`mobile-|sm:hidden/, 'plus de copie pour téléphone');
  assert.match(list, /Ensuite, sélectionnez vos candidats dans l’onglet Sourcing et cliquez sur Séquence\./);
});

// ---------------------------------------------------------------- SEQ-179
test('SEQ-179 — les envois bloqués sont signalés dans la liste, par cause', () => {
  assert.match(list, /\.rpc\('get_sequence_enrollment_counts'/);
  assert.match(list, /stats\.pausedByReason\[reason\] = \(stats\.pausedByReason\[reason\] \?\? 0\) \+ n;/);
  assert.match(list, /\{candidats\(disconnectedPaused\)\} en pause : compte LinkedIn déconnecté\./);
  assert.match(list, /Envois suspendus : abonnement requis\./);
  assert.match(list, /Séquence « \{seq\.name\} » arrêtée automatiquement après trop d’échecs\./);
  assert.match(list, /\{seq\.enrollments\.paused\} en pause/);
});

// ---------------------------------------------------------------- SEQ-239 / SEQ-240
test('SEQ-239 / SEQ-240 — actions mobiles complètes et noms accessibles', () => {
  // Revue design : une seule ligne responsive par séquence, avec un seul menu complet
  // pour le téléphone et l'ordinateur (plus de copie séparée pour téléphone).
  assert.equal((list.match(/filteredSequences\.map\(/g) || []).length, 1, 'une seule liste de lignes');
  assert.doesNotMatch(list, /key=\{`mobile-|sm:hidden/, 'plus de copie pour téléphone');
  assert.equal((list.match(/handleDuplicate\(seq\);/g) || []).length, 1, 'Dupliquer dans le menu unique');
  assert.equal((list.match(/setSaveTemplateSeq\(seq\);/g) || []).length, 1, 'Enregistrer comme modèle dans le menu unique');
  assert.equal((list.match(/setAnalyticsSequence\(seq\);/g) || []).length, 1, 'Statistiques dans le menu unique');
  assert.doesNotMatch(list, /scale-90/);
  assert.match(list, /<div className="text-center">Créée<\/div>/);
  assert.doesNotMatch(list, /addSuffix: false/);
  assert.equal((list.match(/aria-label=\{seq\.is_active \? `Mettre en pause la séquence \$\{seq\.name\}` : `Activer la séquence \$\{seq\.name\}`\}/g) || []).length, 1);
  assert.match(list, /aria-label=\{`Voir les statistiques de la séquence \$\{seq\.name\}`\}/);
  assert.match(panel, /aria-label=\{`Voir le profil LinkedIn de \$\{enrollment\.profile_name \|\| 'ce candidat'\}`\}/);
});

// ---------------------------------------------------------------- SEQ-242
test('SEQ-242 — plus de sélecteur de compte sans effet au-dessus des séquences', () => {
  assert.doesNotMatch(mission, /<select/);
  assert.doesNotMatch(mission, /Compte :/);
  assert.match(mission, /onAccountChange=\{setSelectedAccount\}/, 'l’onglet Invitations garde son sélecteur');
});

// ---------------------------------------------------------------- SEQ-245
test('SEQ-245 — vocabulaire commun : pas de jargon ni de tutoiement', () => {
  for (const [src, words] of [
    [`${list}\n${actions}\n${saveHook}`, ['Analytics<', "'Analytics'", 'Funnel', 'Créé à', 'Sauvegarder comme template']],
    [`${panel}\n${actions}`, ['Workflow', 'Marquer répondu', "Actions de l'inscription"]],
    [mission, ["séquences d'outreach", '> inscrits<']],
  ]) {
    for (const w of words) assert.ok(!src.includes(w), `texte à remplacer : ${w}`);
  }
  assert.match(panel, /Mettre en pause pour ce candidat/);
  // Lot 5b : « Séquence mise en pause pour Claire Dubois. » avec « Annuler ».
  assert.match(actions, /title: pauseToastTitle\(name\)/);
  assert.match(panel, /Relancer depuis l’étape suivante/);
  assert.match(panel, />\s*Parcours\s*</);
  assert.match(list, /Enregistrer comme modèle/);
  assert.match(list, /<div className="text-center">Répartition<\/div>/);
});

/**
 * Audit des séquences (2026-09-25), lot F5 : équipe, désinscription,
 * notifications, suivi des messages directs, agenda, fiche poste, historiques
 * du candidat, types générés et brouillons d'éditeur.
 *
 * Les modules purs (jobSequenceStats, sequenceActionLabels, notificationKinds,
 * sidebarSignals, editorDraft) sont transpilés en mémoire par esbuild, sans
 * fichier intermédiaire ni navigateur. Les écrans et les hooks sont vérifiés
 * par inspection de source, dans le style des autres tests de tests/ux.
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const load = async (source) => {
  const { code } = transformSync(source, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

/** Tranche de source entre deux repères (le second cherché après le premier). */
const block = (src, start, end) => {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `repère introuvable : ${start}`);
  const to = end ? src.indexOf(end, from + start.length) : src.length;
  assert.ok(to > from, `repère de fin introuvable : ${end}`);
  return src.slice(from, to);
};

const useOrg = read('src/hooks/useOrganization.ts');
const team = read('src/components/settings/TeamManagement.tsx');
const teamSection = read('src/components/settings/shell/TeamSection.tsx');
const unsubscribe = read('src/pages/Unsubscribe.tsx');
const outreachModal = read('src/components/outreach/OutreachMessageModal.tsx');
const safety = read('src/components/settings/LinkedInSafetySettings.tsx');
const calendarHook = read('src/hooks/useCalendarEvents.ts');
const calendarPage = read('src/pages/Calendar.tsx');
const todayPanel = read('src/components/dashboard/DashboardTodayPanel.tsx');
const jobSheet = read('src/components/ats/JobDetailSheet.tsx');
const profileActivity = read('src/hooks/useProfileActivity.ts');
const candidateProfile = read('src/hooks/useCandidateFullProfile.ts');
const types = read('src/integrations/supabase/types.ts');
const app = read('src/App.tsx');

const kinds = await load(read('src/lib/notificationKinds.ts'));
const signals = await load(read('src/lib/sidebarSignals.ts'));
const stats = await load(read('src/lib/jobSequenceStats.ts'));
const labels = await load(read('src/lib/sequenceActionLabels.ts'));

// ------------------------------------------------------------ SEQ-042 (high)
test('SEQ-042 — retirer un membre arrête d’abord ses envois, côté serveur', () => {
  const remove = block(useOrg, 'const removeMember = useMutation', 'return {');
  const stopAt = remove.indexOf("action: 'stop_member_linkedin'");
  const deleteAt = remove.indexOf(".from('organization_members')");
  assert.ok(stopAt !== -1, 'l’action serveur stop_member_linkedin doit être appelée');
  assert.ok(deleteAt !== -1, 'la suppression du membre doit suivre');
  assert.ok(stopAt < deleteAt, 'l’arrêt des envois doit précéder la suppression');
  assert.match(remove, /member_user_id: userId/);
  // Arrêt en échec : exception avant la suppression, le membre reste.
  const guard = remove.indexOf('if (stopError || !stopped?.success)');
  assert.ok(guard !== -1 && guard < deleteAt, 'un arrêt en échec doit empêcher la suppression');
  assert.match(remove.slice(guard, deleteAt), /throw new Error\(/);
  // Suppression vérifiée (refus RLS = 0 ligne).
  assert.match(remove, /\.select\('id'\)/);
  assert.match(remove, /if \(!data\?\.length\) throw/);
});

test('SEQ-042 — la confirmation annonce l’arrêt des envois et attend le résultat', () => {
  assert.match(team, /onRemove: \(params: \{ memberId: string; userId: string \}\) => Promise<unknown>;/);
  assert.match(team, /await onRemove\(\{ memberId: removeConfirm\.id, userId: removeConfirm\.user_id \}\)/);
  assert.match(team, /InMails programmés seront arrêtés/);
  assert.match(team, /Vous pourrez réinscrire ses candidats depuis votre compte/);
  // Ancien comportement : fermeture immédiate, promesse rejetée non gérée.
  assert.doesNotMatch(team, /onRemove\(removeConfirm\.id\);\s*setRemoveConfirm\(null\);/);
  const dialog = block(team, '<AlertDialog open={!!removeConfirm}', '</AlertDialog>');
  assert.match(dialog, /e\.preventDefault\(\);/, 'la confirmation reste ouverte jusqu’au résultat');
  assert.match(dialog, /disabled=\{isRemoving\}/);
  assert.match(teamSection, /onRemove=\{removeMember\}/);
});

// ------------------------------------------------------------ SEQ-104
test('SEQ-104 — désinscription en échec : message distinct et nouvel essai', () => {
  assert.match(unsubscribe, /\{status === 'invalid' && \(/);
  assert.doesNotMatch(unsubscribe, /status === 'invalid' \|\| status === 'error'/);
  const errorBlock = block(unsubscribe, "{status === 'error' && (", '</>');
  assert.match(errorBlock, /Une erreur est survenue, réessayez dans un instant\./);
  assert.match(errorBlock, /onClick=\{retry\}/);
  assert.doesNotMatch(errorBlock, /Lien invalide/);
});

// ------------------------------------------------------------ SEQ-115
test('SEQ-115 — rebond et rendez-vous (type « action ») comptent dans À traiter', () => {
  const bounce = { type: 'action', link: '/missions/p1?tab=outreach', metadata: { source: 'email_bounce', enrollment_id: 'e1' } };
  const booking = { type: 'action', link: '/qualification/q1', metadata: { source: 'calendly', enrollment_ids: ['e1'] } };
  assert.equal(kinds.notificationKind(bounce), 'action');
  assert.equal(kinds.isActionable(bounce), true);
  assert.equal(kinds.notificationKind(booking), 'action');
});

test('SEQ-115 — une réponse par e-mail sans conversation reste une réponse de candidat', () => {
  const row = {
    id: 'n1',
    title: 'Nouveau message de Marie Dupont',
    link: '/missions/p1?tab=outreach',
    created_at: '2026-09-25T10:00:00.000Z',
    metadata: { is_candidate: true, channel: 'email', profile_name: 'Marie Dupont', project_id: 'p1' },
  };
  assert.equal(kinds.notificationKind({ type: 'new_message', link: row.link, metadata: row.metadata }), 'message');
  const grouped = signals.groupReplies([row], new Date('2026-09-20T00:00:00.000Z'));
  assert.equal(grouped.candidates.length, 1);
  assert.equal(grouped.candidates[0].chatId, null);
  assert.equal(grouped.candidates[0].name, 'Marie Dupont');
  assert.equal(grouped.candidates[0].counted, true);
});

// ------------------------------------------------------------ SEQ-118
test('SEQ-118 — suivi d’un message direct : organisation écrite, erreur lue', () => {
  const tracking = block(outreachModal, ".from('inmail_queue').insert(", '} catch (trackErr)');
  assert.match(tracking, /organization_id: organizationId,/);
  assert.match(tracking, /status: 'sent',/);
  assert.match(tracking, /created_by: user\.id,/);
  assert.match(outreachModal, /const \{ error: trackError \} = await supabase\.from\('inmail_queue'\)\.insert\(/);
  assert.match(outreachModal, /if \(trackError\) throw trackError;/);
  assert.match(outreachModal, /const \{ organizationId \} = useOrganization\(\);/);
});

// ------------------------------------------------------------ SEQ-125
test('SEQ-125 — les réglages décrivent l’anti-doublon sur les InMails groupés', () => {
  const line = safety.split('\n').find((l) => l.includes('Anti-doublon'));
  assert.ok(line, 'ligne anti-doublon introuvable');
  assert.match(line, /InMail groupé/);
  assert.match(line, /90 derniers jours/);
});

// ------------------------------------------------------------ SEQ-181
test('SEQ-181 — agenda : seules les inscriptions actives, étapes internes écartées avant la limite', () => {
  const steps = block(calendarHook, '// 3. Étapes de séquence visibles', '.limit(100)');
  assert.match(steps, /sequence_enrollments!inner\(status/);
  assert.match(steps, /\.eq\('sequence_enrollments\.status', 'active'\)/);
  assert.match(steps, /sequence_steps!inner\(action_type\)/);
  assert.match(steps, /\.not\('sequence_steps\.action_type', 'in'/);
  assert.match(calendarHook, /if \(stepExecsError\) throw stepExecsError;/);
  assert.match(calendarHook, /if \(inmailsError\) throw inmailsError;/);
  assert.match(calendarHook, /if \(qualifsError\) throw qualifsError;/);
  for (const internal of ['wait_connection', 'wait_reply', 'condition_branch']) {
    assert.ok(block(calendarHook, 'const HIDDEN_SEQUENCE_ACTIONS', '];').includes(`'${internal}'`), internal);
  }
});

test('SEQ-181 — agenda en erreur : bloc d’erreur, pas de semaine vide', () => {
  assert.match(calendarPage, /isLoading, isError, isFetching, refetch \} = useCalendarEvents/);
  assert.match(calendarPage, /\{isError && \(/);
  assert.match(calendarPage, /<ErrorBox/);
  assert.match(calendarPage, /!isLoading && !isError && totalCount === 0 && rawEvents\.length === 0/);
  // Le tableau de bord ne lit que les entretiens : une panne des envois ne les lui retire pas.
  assert.match(todayPanel, /useCalendarEvents\(\{ from: today, days: 1, outreach: false \}\)/);
  assert.match(todayPanel, /todayEventsError \? null : <EmptyState/);
});

// ------------------------------------------------------------ SEQ-182
test('SEQ-182 — fiche poste : réponses sur le statut, envois réels, libellé « Inscrits »', () => {
  const sentStep = (action_type, status = 'sent') => ({ status, sequence_steps: { action_type } });
  const rows = [
    { sequence_id: 's1', status: 'replied', outreach_sequences: { name: 'Relance' }, sequence_step_executions: [sentStep('message')] },
    { sequence_id: 's1', status: 'completed', sequence_step_executions: [] },
    // Active avec une invitation partie : comptée comme envoyée.
    { sequence_id: 's1', status: 'active', sequence_step_executions: [sentStep('connection_request')] },
    // Active sans envoi réel (condition « sent », visite, échec) : pas comptée.
    { sequence_id: 's1', status: 'active', sequence_step_executions: [sentStep('condition_branch'), sentStep('profile_visit'), sentStep('inmail', 'failed')] },
    { sequence_id: 's1', status: 'active', sequence_step_executions: null },
  ];
  const [stat] = stats.computeJobSequenceStats(rows);
  assert.deepEqual(stat, { id: 's1', name: 'Relance', enrolledCount: 5, sentCount: 3, repliedCount: 1 });
  assert.equal(stats.responseRatePercent(stat), 33);
  assert.match(jobSheet, /computeJobSequenceStats\(enrollments \?\? \[\]\)/);
  assert.doesNotMatch(jobSheet, /connection_status === 'replied'/);
  assert.doesNotMatch(jobSheet, /Enrollés/);
  assert.match(jobSheet, />Inscrits</);
  assert.match(jobSheet, /Impossible de charger les séquences de ce poste\./);
});

// ------------------------------------------------------------ SEQ-183
test('SEQ-183 — messagerie : plus de rapprochement par inclusion partielle du nom', () => {
  assert.doesNotMatch(profileActivity, /\.ilike\('profile_name'/);
  assert.match(profileActivity, /\.eq\('profile_name', exactName\)/);
  assert.match(profileActivity, /enrollments = people\.size === 1 \? rows : \[\];/);
});

test('SEQ-183 — nom de repli générique ou incomplet : aucun rapprochement', async () => {
  const fn = block(profileActivity, 'export function usableProfileName', '\n}\n') + '\n}\n';
  const { usableProfileName } = await load(fn);
  assert.equal(usableProfileName('Marie Dupont'), 'Marie Dupont');
  assert.equal(usableProfileName('  Jean-Paul   Martinez '), 'Jean-Paul Martinez');
  assert.equal(usableProfileName('Marie'), null);
  assert.equal(usableProfileName('Conversation'), null);
  assert.equal(usableProfileName('Conversation du 12/09/2026'), null);
  assert.equal(usableProfileName(''), null);
  assert.equal(usableProfileName(null), null);
});

// ------------------------------------------------------------ SEQ-184
test('SEQ-184 — historique : libellés des vraies étapes, échecs et étapes sautées signalés', () => {
  assert.equal(labels.sequenceExecutionTitle('connection_request', 'sent'), 'Invitation envoyée');
  assert.equal(labels.sequenceExecutionTitle('message', 'replied'), 'Message envoyé');
  assert.equal(labels.sequenceExecutionTitle('inmail', 'opened'), 'InMail envoyé');
  assert.equal(labels.sequenceExecutionTitle('profile_visit', 'sent'), 'Profil visité');
  assert.equal(labels.sequenceExecutionTitle('email', 'clicked'), 'E-mail envoyé');
  assert.equal(labels.sequenceExecutionTitle('inmail', 'failed'), 'InMail : échec');
  assert.equal(labels.sequenceExecutionTitle('connection_request', 'skipped'), 'Invitation : étape sautée');
  assert.doesNotMatch(labels.sequenceExecutionTitle('inconnu', 'sent'), /inconnu/);
  assert.equal(labels.stepNumberLabel(0), 'Étape 1');
  assert.equal(labels.stepNumberLabel(2), 'Étape 3');
  assert.equal(labels.isInternalSequenceAction('wait_connection'), true);
  assert.equal(labels.isInternalSequenceAction('inmail'), false);
});

test('SEQ-184 — la frise de la fiche candidat utilise ces libellés', () => {
  for (const legacy of ['send_connection', 'send_message', 'send_inmail', 'visit_profile', 'Action : ']) {
    assert.ok(!candidateProfile.includes(legacy), `${legacy} encore présent`);
  }
  assert.match(candidateProfile, /title: sequenceExecutionTitle\(step\.actionType, step\.status\)/);
  assert.match(candidateProfile, /stepNumberLabel\(step\.stepOrder\)/);
  assert.match(candidateProfile, /stepNumberLabel\(se\.currentStep\)/);
  assert.match(candidateProfile, /!isInternalSequenceAction\(stepMap\.get\(ex\.step_id\)\)/);
});

// ------------------------------------------------------------ SEQ-219
test('SEQ-219 — types générés : RPC des séquences et colonne ends_sequence', () => {
  const functions = block(types, '    Functions: {', '    Enums: {');
  const save = block(functions, '      save_sequence_steps: {', '\n      }\n');
  assert.match(save, /Args: \{ p_sequence_id: string; p_steps: Json \}/);
  assert.match(save, /to: "sequence_steps"/);
  assert.match(functions, /increment_sequence_analytics: \{\n\s+Args: \{ p_field: string; p_increment\?: number; p_sequence_id: string \}/);
  const steps = block(types, '      sequence_steps: {', 'Relationships: [');
  assert.equal((steps.match(/ends_sequence\??: boolean/g) ?? []).length, 3, 'Row, Insert et Update');
});

// ------------------------------------------------------------ SEQ-231
test('SEQ-231 — les brouillons d’éditeur sont purgés à la déconnexion', async () => {
  const store = new Map();
  globalThis.localStorage = {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const drafts = await load(read('src/lib/editorDraft.ts'));
  drafts.saveEditorDraft('sequence-new:u1:o1', { name: 'Brouillon' });
  drafts.saveEditorDraft('mission-new', { title: 'Mission' });
  store.set('sb-auth-token', 'garde');
  drafts.clearAllEditorDrafts();
  assert.deepEqual([...store.keys()], ['sb-auth-token']);
  assert.equal(drafts.loadEditorDraft('mission-new'), null);
  delete globalThis.localStorage;

  const signedOut = block(app, "if (event === 'SIGNED_OUT'", "} else if (event === 'SIGNED_IN'");
  assert.match(signedOut, /clearAllEditorDrafts\(\);/);
  const userSwitch = block(app, 'if (prevUserIdRef.current && prevUserIdRef.current !== newUserId)', 'prevUserIdRef.current = newUserId;');
  assert.match(userSwitch, /clearAllEditorDrafts\(\);/);
});

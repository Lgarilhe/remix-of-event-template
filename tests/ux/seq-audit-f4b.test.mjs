/**
 * Audit du module séquences (2026-09-25), lot F4b : inscription (modale simple
 * et préparation avec aperçu), InMail groupé, menu Séquence du sourcing et
 * messagerie.
 *
 * Les règles pures (anti-doublon, première action annoncée, statut pipeline
 * sans rétrogradation, inscriptions existantes, embranchements) sont
 * transpilées en mémoire par esbuild et exécutées. Les écrans sont vérifiés par
 * inspection du code source, dans le style des autres tests de tests/ux.
 *
 * Lancer : node --test tests/ux/seq-audit-f4b.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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

const REACT_STUB = 'export const useState = () => [undefined, () => {}]; export const useCallback = (f) => f; export const useRef = (v) => ({ current: v }); export const useEffect = () => {}; export const useMemo = (f) => f(); export default {};';

const enrollModal = read('src/components/outreach/SequenceEnrollModal.tsx');
const previewModal = read('src/components/outreach/EnrollmentPreviewModal.tsx');
const previewHookSrc = read('src/hooks/useEnrollmentPreview.ts');
const bulkInMail = read('src/components/outreach/BulkInMailModal.tsx');
const enrollButton = read('src/components/outreach/SequenceEnrollButton.tsx');
const inbox = read('src/components/outreach/MessagesInbox.tsx');
const inboxHook = read('src/hooks/useMessagesInbox.ts');
const messageView = read('src/components/outreach/inbox/MessageView.tsx');
const activityCard = read('src/components/outreach/inbox/ActivityEventCard.tsx');
const linkedInSearch = read('src/components/outreach/LinkedInSearch.tsx');
const resultsPanel = read('src/components/outreach/search/SearchResultsPanel.tsx');
const sidebarCard = read('src/components/outreach/enrollment-preview/CandidateSidebarCard.tsx');
const treeView = read('src/components/outreach/enrollment-preview/SequenceTreeView.tsx');

/**
 * Chargement tolérant : un module absent ou cassé fait échouer les seuls tests
 * qui l'utilisent (chaque défaut reste vérifiable séparément).
 */
async function tryLoad(rel, stubs) {
  try {
    return await loadModule(rel, stubs);
  } catch (err) {
    return new Proxy({}, { get: (_, key) => { if (key === 'then') return undefined; throw new Error(`${rel} : ${err.message}`); } });
  }
}
const helpers = await tryLoad('src/components/outreach/enrollment-preview/enrollmentHelpers.ts');
const previewHook = await tryLoad('src/hooks/useEnrollmentPreview.ts', {
  react: REACT_STUB,
  '@/lib/invokeWithCredits': 'export const invokeWithCredits = async () => ({ data: null, error: null }); export const estimateActionCredits = () => 3;',
  '@/integrations/supabase/client': 'export const supabase = {};',
  '@/hooks/useAuthReady': 'export const useAuthReady = () => ({ user: null });',
});
const duplicates = await tryLoad('src/lib/enrollmentDuplicates.ts');

/**
 * Client Supabase factice : enregistre chaque requête (table, filtres) et renvoie `rowsFor(table, query)`.
 * La RPC find_recent_org_contacts répond « fonction absente » (PGRST202) : ces
 * tests couvrent le repli sur la lecture directe (base pas encore migrée).
 */
function fakeSupabase(rowsFor) {
  const queries = [];
  const rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
  const from = (table) => {
    const q = { table, eq: [], in: [], gte: [], or: [] };
    queries.push(q);
    const chain = {
      select: () => chain,
      eq: (c, v) => { q.eq.push([c, v]); return chain; },
      in: (c, v) => { q.in.push([c, v]); return chain; },
      gte: (c, v) => { q.gte.push([c, v]); return chain; },
      or: (f) => { q.or.push(f); return chain; },
      order: () => chain,
      then: (resolve) => resolve({ data: rowsFor(table, q), error: null }),
    };
    return chain;
  };
  return { supabase: { from, rpc }, queries };
}

// ---------------------------------------------------------------- SEQ-128
test('SEQ-128 — anti-doublon : inscriptions vivantes sans limite de date, closes sur 90 jours', async () => {
  const { supabase, queries } = fakeSupabase((table, q) => {
    if (table === 'profiles') return [{ user_id: 'u1', display_name: 'Claire Dupont' }];
    const statuses = q.in.find(([c]) => c === 'status')?.[1] ?? [];
    // Inscription en pause créée il y a 120 jours : seule la lecture sans date la voit.
    if (table === 'sequence_enrollments' && statuses.includes('paused') && q.gte.length === 0) {
      return [{ profile_id: 'ACoAAMarc', provider_id: null, resolved_profile_id: null, profile_url: null, created_by: 'u1', created_at: new Date(Date.now() - 120 * 86400000).toISOString(), status: 'paused', sequence_id: 's-longue' }];
    }
    return [];
  });
  const result = await duplicates.findRecentEnrollments(supabase, 'org-1', [{ id: 'ACoAAMarc' }]);
  assert.equal(result.get('ACoAAMarc')?.sequenceId, 's-longue', 'une inscription en pause de plus de 90 jours doit être signalée');
  const enrollmentQueries = queries.filter(q => q.table === 'sequence_enrollments');
  const live = enrollmentQueries.find(q => q.in.some(([c, v]) => c === 'status' && v.includes('active')));
  const closed = enrollmentQueries.find(q => q.in.some(([c, v]) => c === 'status' && v.includes('replied')));
  assert.ok(live && closed, 'deux lectures attendues (vivantes, closes)');
  assert.deepEqual(live.gte, [], 'les inscriptions actives ou en pause ne sont pas bornées dans le temps');
  assert.deepEqual(live.in.find(([c]) => c === 'status')[1], ['active', 'paused']);
  assert.equal(closed.gte[0]?.[0], 'created_at', 'les inscriptions closes restent sur 90 jours');
  assert.deepEqual(closed.in.find(([c]) => c === 'status')[1], ['replied', 'completed']);
});

// ---------------------------------------------------------------- SEQ-125
test('SEQ-125 — anti-doublon étendu aux InMails groupés (programmés, en cours, envoyés, 90 jours)', async () => {
  const { supabase, queries } = fakeSupabase((table) => {
    if (table === 'inmail_queue') return [{ recipient_profile_id: 'ACoAAJulien', created_by: 'u2', created_at: '2026-09-20T10:00:00Z', status: 'scheduled' }];
    if (table === 'profiles') return [{ user_id: 'u2', display_name: 'Théo Martin' }];
    return [];
  });
  const result = await duplicates.findRecentEnrollments(supabase, 'org-1', [{ id: 'ACoAAJulien' }, { id: 'ACoAAAutre' }]);
  const entry = result.get('ACoAAJulien');
  assert.equal(entry?.source, 'inmail');
  assert.equal(entry?.sequenceId, null);
  assert.equal(result.has('ACoAAAutre'), false);
  assert.match(duplicates.formatRecentContactLabel(entry), /^Déjà contacté par Théo le 20\/09\/2026 par InMail$/);
  const inmailQuery = queries.find(q => q.table === 'inmail_queue');
  assert.deepEqual(inmailQuery.eq, [['organization_id', 'org-1']]);
  // Un InMail « répondu » reste un contact (défaut inmail-replied-hors-antidoublon-client).
  assert.deepEqual(inmailQuery.in.find(([c]) => c === 'status')[1], ['pending', 'scheduled', 'sending', 'sent', 'replied']);
  assert.equal(inmailQuery.gte[0]?.[0], 'created_at');
});

test('SEQ-125 — l’InMail groupé vérifie les contacts récents et exclut les candidats déjà contactés', () => {
  assert.match(bulkInMail, /findRecentEnrollments\(supabase, organizationId, allRecipients\.map\(/);
  // Décision 24 : plus de dérogation owner/admin, la file refuse ces candidats côté serveur.
  assert.doesNotMatch(bulkInMail, /allowDuplicates|includeDuplicates|Contacter quand même/);
  assert.match(bulkInMail, /allRecipients\.filter\(r => !recentContacts\.has\(r\.id\)\)/);
  assert.match(bulkInMail, /\{RECENT_CONTACT_REFUSED_MESSAGE\}/);
  assert.match(bulkInMail, /formatRecentContactLabel\(entry\)/);
  // Rien n'est généré ni planifié tant que la vérification n'a pas abouti.
  const queue = slice(bulkInMail, 'const handleQueueAll = async () => {', '// Cancel pending items');
  assert.match(queue, /if \(duplicatesUnchecked\) \{/);
});

// ---------------------------------------------------------------- SEQ-126
test('SEQ-126 — « Annuler les envois en attente » annule toute la file, confirmé et compté en base', () => {
  const cancel = slice(bulkInMail, 'const handleCancelPending = async () => {', '// Format scheduled time');
  assert.doesNotMatch(cancel, /item_ids/, 'la liste des 100 dernières lignes ne doit plus borner l’annulation');
  assert.doesNotMatch(cancel, /queueItems/);
  assert.match(cancel, /action: 'cancel',/);
  assert.match(bulkInMail, /Tous vos InMails programmés et pas encore envoyés seront annulés, y compris ceux d'autres sélections\. Cette action est irréversible\./);
  assert.match(bulkInMail, /<AlertDialogCancel>Garder<\/AlertDialogCancel>/);
  // Compteurs par comptage en base, pas sur les 100 lignes affichées.
  assert.match(bulkInMail, /\.select\('id', \{ count: 'exact', head: true \}\)/);
  assert.match(bulkInMail, /const pendingCount = queueStats \? queueStats\.pending \+ queueStats\.scheduled : 0;/);
});

// ---------------------------------------------------------------- SEQ-127
test('SEQ-127 — vérification des contacts récents en échec : blocage et « Réessayer », jamais de Map vide', () => {
  for (const [name, source] of [['inscription simple', enrollModal], ['aperçu', previewModal]]) {
    assert.doesNotMatch(source, /setRecentEnrollments\(new Map\(\)\)/, `${name} : une Map vide inscrivait sans anti-doublon`);
    assert.match(source, /if \(!cancelled\) setDuplicateCheckFailed\(true\);/, name);
    assert.match(source, /\{DUPLICATE_CHECK_FAILED_MESSAGE\}/, name);
    assert.match(source, /setDuplicateCheckAttempt\(a => a \+ 1\)/, `${name} : bouton « Réessayer »`);
    assert.match(source, /duplicatesUnchecked \|\| !!sendingAccount\.blockReason\}/, `${name} : inscription désactivée tant que la vérification n'a pas abouti`);
  }
  assert.equal(helpers.DUPLICATE_CHECK_FAILED_MESSAGE, "Impossible de vérifier les contacts récents de votre organisation. Réessayez avant d'inscrire.");
});

// ---------------------------------------------------------------- SEQ-124
// Refonte mission, lot 0b-2b : l'inscription n'écrit plus rien dans le
// pipeline. « Contacté » est posé par le serveur au premier envoi réel, ce qui
// règle aussi la rétrogradation que SEQ-124 empêchait côté navigateur.
test('SEQ-124 — l’inscription n’écrit plus le statut pipeline (lot 0b-2b)', () => {
  assert.equal(helpers.shouldMarkMessaged, undefined, 'shouldMarkMessaged supprimée');
  assert.equal(helpers.markCandidatesMessaged, undefined, 'markCandidatesMessaged supprimée');
  assert.equal(helpers.STATUSES_KEPT_ON_ENROLL, undefined, 'STATUSES_KEPT_ON_ENROLL supprimée');
  for (const [name, source] of [['inscription simple', enrollModal], ['aperçu', previewModal]]) {
    assert.doesNotMatch(source, /markCandidatesMessaged/, `${name} : plus d'écriture « contacté » à l'inscription`);
    assert.doesNotMatch(source, /status: 'messaged',/, `${name} : plus d'upsert « contacté »`);
  }
});

test('SEQ-124 — l’inscription ne touche plus job_candidate_status (lot 0b-2b)', () => {
  assert.doesNotMatch(read('src/components/outreach/enrollment-preview/enrollmentHelpers.ts'), /job_candidate_status/);
  const simple = slice(enrollModal, 'const handleEnroll = async () => {', '\n  };\n');
  assert.doesNotMatch(simple, /job_candidate_status/, 'inscription simple');
  const preview = slice(previewModal, 'const handleEnroll = async () => {', '// ── Shortlist without message ──');
  assert.doesNotMatch(preview, /job_candidate_status/, 'aperçu');
});

test('Lot 0b-2b — mission des envois : sans « project: », uuid seulement, sinon rien', () => {
  const id = '6f1c2d3e-0000-4000-8000-000000000001';
  assert.equal(previewHook.missionIdOfJob(`project:${id}`), id);
  assert.equal(previewHook.missionIdOfJob(id), id);
  assert.equal(previewHook.missionIdOfJob('recXYZ123'), undefined, 'poste hors mission');
  assert.equal(previewHook.missionIdOfJob('project:pas-un-uuid'), undefined);
  assert.equal(previewHook.missionIdOfJob(null), undefined);
  assert.equal(previewHook.missionIdOfJob(undefined), undefined);
});

// ---------------------------------------------------------------- SEQ-129
test('SEQ-129 — modale simple : échec de planification, inscriptions retirées, aucun succès annoncé', () => {
  assert.doesNotMatch(enrollModal, /Traiter les séquences/);
  const onError = slice(enrollModal, 'if (execError) {', 'return;\n      }');
  assert.match(onError, /\.in\('id', insertedIds\)/);
  assert.match(onError, /enrollmentResults\.success = 0;/);
  assert.match(onError, /L'inscription a échoué : aucune étape n'a pu être planifiée\. Aucun message ne partira\. Réessayez\./);
  assert.match(onError, /Des inscriptions ont été créées sans étape ; elles démarreront dans l'heure\./);
  assert.doesNotMatch(onError, /toast\.success/);
});

// ---------------------------------------------------------------- SEQ-130
test('SEQ-130 — bilan de l’aperçu : titre et icône selon le résultat, toast d’erreur, messages génériques', () => {
  const results = slice(previewModal, 'function EnrollmentResults(', 'function PreviewPanelFallback(');
  assert.doesNotMatch(results, /'Inscription terminée'/, 'plus de titre de succès fixe');
  assert.match(results, /'Aucun candidat inscrit'/);
  // Revue design : pluriel partagé (D-71) au lieu d'un plural local ; même titre (« 2 candidats inscrits sur 3 »).
  assert.match(results, /const inscribed = plural\(results\.success, 'candidat inscrit', 'candidats inscrits'\);/);
  assert.match(results, /`\$\{inscribed\} sur \$\{attempted\}`/);
  assert.match(results, /outcome === 'partial'\s*\?\s*<AlertTriangle/);
  const enroll = slice(previewModal, 'const handleEnroll = async () => {', 'const handleShortlist = async () => {');
  assert.match(enroll, /toast\.error\(`\$\{e\} inscription\$\{e > 1 \? 's' : ''\} en échec`, \{\s*description: 'Le détail est affiché dans la fenêtre\.',/);
  assert.doesNotMatch(enroll, /err\?\.message/, 'plus de message brut de la base');
  assert.match(enroll, /results\.errors\.push\(enrollFailureMessage\(profile\.name\)\)/);
  assert.equal(helpers.enrollFailureMessage('Marie Dupont'), 'Inscription impossible pour Marie Dupont. Réessayez ou contactez le support.');
});

// ---------------------------------------------------------------- SEQ-131
test('SEQ-131 — génération en échec : texte juste, « Réessayer » et « Modifier » affichés', () => {
  assert.doesNotMatch(previewHookSrc, /sera utilisé tel quel/);
  assert.equal(previewHook.PREVIEW_GENERATION_FAILED_MESSAGE, "La génération a échoué. Réessayez pour voir le message avant l'inscription, ou modifiez-le. Sinon, l'IA Konekt le rédigera au moment de l'envoi.");
  const card = slice(previewModal, 'function MessageStepCard(', 'function SummaryMode(');
  assert.match(card, /const hasContent = !!\(preview\?\.isGenerated \|\| preview\?\.isEdited \|\| preview\?\.error\);/);
  assert.match(card, /\{hasContent && !preview\?\.isGenerating && \(/, 'boutons visibles aussi en cas d’échec');
  assert.match(card, /Réessayer/);
  // Modifier un aperçu en échec lève l'avis d'échec : le texte modifié partira.
  const edit = slice(previewHookSrc, 'const editMessage = useCallback(', '}, [setPreview]);');
  assert.match(edit, /error: undefined/);
});

// ---------------------------------------------------------------- SEQ-132
test('SEQ-132 — sans compte LinkedIn : bouton Séquence du bandeau Go désactivé, garde dans les deux inscriptions', () => {
  const goBanner = slice(resultsPanel, "const goProfiles = Object.values(jobScores)", 'return null;');
  assert.match(goBanner, /\{selectedAccount \? \(\s*<SequenceEnrollButton/);
  assert.match(goBanner, /Connectez votre compte LinkedIn pour lancer une séquence/);
  for (const [name, source] of [['inscription simple', enrollModal], ['aperçu', previewModal]]) {
    assert.match(source, /if \(!accountId\) \{\s*toast\.error\(NO_LINKEDIN_ACCOUNT_TITLE, \{ description: NO_LINKEDIN_ACCOUNT_DESCRIPTION \}\);/, name);
  }
});

// ---------------------------------------------------------------- SEQ-133
test('SEQ-133 — InMail groupé : seuls les destinataires hors relation consomment un crédit', () => {
  assert.doesNotMatch(bulkInMail, /const creditsNeeded = recipients\.length;/);
  assert.match(bulkInMail, /const freeMessageCount = billedRecipients\.filter\(r => queueNetworkDistance\(r\) === 1\)\.length;/);
  assert.match(bulkInMail, /const creditsNeeded = paidInMailCount;/);
  assert.match(bulkInMail, /InMail\$\{paidInMailCount > 1 \? 's' : ''\} payant/);
  assert.match(bulkInMail, /\(déjà en relation\)/);
  // La file reçoit la même distance que le décompte (« FIRST_DEGREE » compris).
  assert.match(bulkInMail, /const networkDistance = queueNetworkDistance\(r\);/);
  assert.match(bulkInMail, /if \(normalized === 'FIRST_DEGREE'\) return 1;/);
});

// ---------------------------------------------------------------- SEQ-134
test('SEQ-134 — plan gratuit : la modale d’inscription et l’InMail groupé proposent un abonnement', () => {
  assert.match(enrollModal, /const canSendSequences = !subscriptionState \|\| hasPlanFeature\(effectivePlanId, 'sequences_send'\);/);
  assert.ok(enrollModal.indexOf('if (!canSendSequences) {') < enrollModal.indexOf('if (hasMessageSteps) {'),
    'le contrôle doit précéder l’aperçu pour couvrir tous les points d’entrée');
  assert.match(enrollModal, /<UpgradePrompt title="Séquences" description=\{SEQUENCES_PLAN_REQUIRED_MESSAGE\} \/>/);
  assert.match(bulkInMail, /const canSendInMails = !subscriptionState \|\| hasPlanFeature\(effectivePlanId, 'sequences_send'\);/);
  assert.match(bulkInMail, /<UpgradePrompt title="InMails"/);
  assert.equal(helpers.SEQUENCES_PLAN_REQUIRED_MESSAGE, "L'envoi de séquences et d'InMails nécessite un abonnement. Passez à un plan payant pour contacter ces candidats.");
});

// ---------------------------------------------------------------- SEQ-135
test('SEQ-135 — la première action est annoncée (délai effectif, heures d’envoi)', () => {
  const steps = [
    { id: 'v', step_order: 0, action_type: 'profile_visit', delay_days: 0 },
    { id: 'i', step_order: 1, action_type: 'connection_request', delay_days: 1 },
  ];
  assert.equal(helpers.firstActionSummary(steps), "Première action : Visite de profil, dès maintenant pendant vos heures d'envoi");
  assert.equal(helpers.firstActionSummary(steps, { v: { delayDays: 2 } }), "Première action : Visite de profil, dans 2 jours, pendant vos heures d'envoi");
  assert.equal(helpers.firstActionSummary([{ id: 'x', stepOrder: 0, actionType: 'inmail', delayHours: 3 }]), "Première action : InMail, dans 3 heures, pendant vos heures d'envoi");
  assert.equal(helpers.firstActionSummary([]), null);
  assert.match(previewModal, /firstActionSummary\(sequence\.steps, getStepConfigOverrides\(\)\)/);
  assert.match(enrollModal, /firstActionSummary\(sequence\.steps\)/);
  assert.match(enrollModal, /description: firstAction \?\? undefined/, 'reprise dans le toast de fin');
});

// ---------------------------------------------------------------- SEQ-136
test('SEQ-136 — embranchements : cibles mappées, bandeau, l’IA n’a pas les messages de l’autre chemin', () => {
  const steps = [
    { stepId: 'invite', stepOrder: 0, actionType: 'connection_request' },
    { stepId: 'check', stepOrder: 1, actionType: 'check_connection', ifTrueGotoStep: 'msg', ifFalseGotoStep: 'inmail' },
    { stepId: 'msg', stepOrder: 2, actionType: 'message', nextStepId: 'relance' },
    { stepId: 'relance', stepOrder: 3, actionType: 'message' },
    { stepId: 'inmail', stepOrder: 4, actionType: 'inmail' },
  ];
  assert.equal(previewHook.hasBranching(steps), true);
  assert.equal(previewHook.hasBranching([{ stepId: 'a', stepOrder: 0, actionType: 'message' }]), false);
  assert.deepEqual([...previewHook.otherBranchStepIds(steps, 'inmail')].sort(), ['msg', 'relance']);
  assert.deepEqual([...previewHook.otherBranchStepIds(steps, 'relance')], ['inmail']);
  assert.equal(previewHook.otherBranchStepIds(steps, 'invite').size, 0);
  // Arbre parent / branche.
  const tree = [
    { stepId: 'cond', stepOrder: 0, actionType: 'condition_branch' },
    { stepId: 'oui', stepOrder: 1, actionType: 'message', parentStepId: 'cond', branch: 'true' },
    { stepId: 'non', stepOrder: 2, actionType: 'message', parentStepId: 'cond', branch: 'false' },
  ];
  assert.deepEqual([...previewHook.otherBranchStepIds(tree, 'non')], ['oui']);
  assert.match(previewModal, /ifTrueGotoStep: s\.if_true_goto_step \|\| s\.ifTrueGotoStep \|\| null,/);
  assert.match(treeView, /Cette séquence contient des embranchements\. L'aperçu les montre à la suite, un seul chemin sera suivi pour chaque candidat\./);
  const generate = slice(previewHookSrc, 'const generateForCandidate = useCallback(', 'const generateForCandidateById');
  assert.match(generate, /!otherBranch\.has\(s\.stepId\)/);
});

// ---------------------------------------------------------------- SEQ-137
test('SEQ-137 — la carte et la fiche transmettent le poste complet à l’inscription', () => {
  for (const rel of ['src/components/outreach/result-card/CardActions.tsx', 'src/components/outreach/result-card/ProfileDetailSheet.tsx']) {
    const source = read(rel);
    assert.doesNotMatch(source, /selectedJob=\{selectedJob \? \{ id: selectedJob\.id, title: selectedJob\.title \} : undefined\}/, rel);
    assert.match(source, /selectedJob=\{selectedJob \?\? undefined\}/, rel);
  }
  assert.match(enrollButton, /selectedJob\?: SequenceEnrollJob \| null;/);
  assert.match(enrollButton, /skills\?: string\[\];/);
});

// ---------------------------------------------------------------- SEQ-139
test('SEQ-139 — un seul compteur, et les candidats exclus sont marqués dans la liste', () => {
  assert.match(previewModal, /exclusion=\{exclusionByCandidate\.get\(p\.id\) \?\? null\}/);
  assert.match(previewModal, /label: 'Déjà contacté, exclu'/);
  assert.match(sidebarCard, /\{exclusion\.label\}/);
  // Revue design : ligne passée ou exclue marquée par un nom atténué (jeton de texte,
  // sans opacité) et la pastille de sa raison, raison reprise dans le nom accessible.
  assert.match(sidebarCard, /const dimmed = state\.skipped \|\| !!shownExclusion;/);
  assert.match(sidebarCard, /dimmed \? 'text-muted-foreground' : 'text-foreground'/);
  assert.match(sidebarCard, /<Badge variant="muted"[^>]*title=\{exclusion\.title\}>\s*\{exclusion\.label\}/);
  assert.match(sidebarCard, /aria-label=\{status \? `\$\{name\}, \$\{status\}` : name\}/);
  assert.doesNotMatch(sidebarCard, /opacity-\d/);
  const banner = read('src/components/outreach/enrollment-preview/DynamicSummaryBanner.tsx');
  assert.match(banner, /\{active > 1 \? 'seront inscrits' : 'sera inscrit'\}/);
  assert.match(banner, /déjà contacté\$\{duplicates > 1 \? 's' : ''\}/);
});

// ---------------------------------------------------------------- SEQ-140
// Revue design : modèle clavier du design (D-44). Les raccourcis partent de la
// ligne d'un candidat (listShortcut) : flèches pour parcourir, P pour passer,
// X ou Suppr pour retirer. Aucune touche avec modificateur (plus de Ctrl+Entrée),
// jamais Entrée ni Espace (ils restent aux boutons), aucune génération au
// clavier. Les menus, fenêtres et champs ouverts depuis la liste n'ont pas de
// data-candidate-id : leurs touches sont ignorées, comme avec l'ancien sélecteur de portée.
test('SEQ-140 — raccourcis posés sur la liste, jamais Entrée seule pour une génération payante', () => {
  const shortcuts = slice(previewModal, 'function listShortcut(', 'function mapSteps(');
  assert.match(shortcuts, /if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey \|\| e\.defaultPrevented\) return null;/, 'aucune touche avec modificateur');
  assert.match(shortcuts, /if \(!target\.dataset\?\.candidateId\) return null;/, 'seulement depuis la ligne d’un candidat');
  assert.doesNotMatch(shortcuts, /'Enter'|' '|'Spacebar'/, 'Entrée et Espace restent aux boutons');
  assert.match(shortcuts, /case 'p': case 'P': return 'skip';/);
  assert.match(shortcuts, /case 'Delete': case 'x': case 'X': return 'remove';/);
  const handler = slice(previewModal, 'const handleListKeyDown = (e', 'if (!isOpen) return null;');
  assert.match(handler, /if \(isBusy\) return;/, 'la sélection ne bouge plus pendant une inscription');
  assert.doesNotMatch(handler, /generate/i, 'aucune génération payante ne part d’une touche');
  assert.doesNotMatch(previewModal, /handleGenerateShortcut|handleShortcutKeyDown/);
  assert.doesNotMatch(previewModal, /window\.addEventListener\(\s*['"]keydown/);
  assert.match(previewModal, /ref=\{listRef\}[\s\S]{0,200}onKeyDown=\{handleListKeyDown\}/);
  assert.match(previewModal, /<Kbd>↑<\/Kbd> <Kbd>↓<\/Kbd> parcourir, <Kbd>P<\/Kbd> passer, <Kbd>X<\/Kbd> retirer/);
});

// ---------------------------------------------------------------- SEQ-141 / SEQ-142 / SEQ-145
test('SEQ-141 — depuis la messagerie, l’inscription est rattachée à une mission (ou « Sans mission »)', () => {
  assert.match(inbox, /<option value="">Sans mission<\/option>/);
  assert.match(inbox, /job=\{selectedMission \? \{ id: selectedMission\.id, title: selectedMission\.name \} : null\}/);
  assert.match(inbox, /if \(inbox\.showSequenceSelect\) setSelectedMissionId\(linkedMissionId\);/);
});

test('SEQ-142 — relation non vérifiée depuis la messagerie : avertissement si la séquence invite', () => {
  assert.match(inboxHook, /network_distance\?: string;/);
  assert.match(inbox, /attendee\?\.specifics\?\.network_distance \?\? attendee\?\.network_distance/);
  // Vague finale (front-enroll-follow-4) : l'invitation d'une relation directe est sautée, plus d'échec.
  assert.match(inbox, /Relation LinkedIn non vérifiée : si vous êtes déjà en relation, l'invitation sera sautée\./);
  assert.match(inbox, /notice=\{enrollNotice\}/);
  assert.match(enrollModal, /notice=\{notice\}/);
  assert.match(previewModal, /\{!enrollResults && notice && \(/);
});

test('SEQ-145 / SEQ-227 — messagerie : étapes complètes, séquences de l’organisation, rechargées et erreur distincte', () => {
  const fetchSequences = slice(inboxHook, 'const fetchSequences = useCallback(', '}, [user]);');
  assert.match(fetchSequences, /sequence_steps \(\*\)/);
  assert.doesNotMatch(fetchSequences, /created_by/, 'les séquences partagées de l’organisation doivent être proposées');
  assert.match(fetchSequences, /setSequencesStatus\('error'\)/);
  const open = slice(inboxHook, 'const handleEnrollInSequence = useCallback(', '}, [selectedChat, fetchSequences]);');
  assert.match(open, /void fetchSequences\(\);/);
  assert.match(inbox, /Impossible de charger les séquences\./);
  assert.match(inbox, /onClick=\{\(\) => void inbox\.fetchSequences\(\)\}/);
});

// ---------------------------------------------------------------- SEQ-143 / SEQ-186
test('SEQ-143 / SEQ-186 — après une inscription depuis la recherche : pas de toast en double, statuts et badges rechargés', () => {
  const handler = slice(linkedInSearch, 'const handleSequenceEnrollSuccess = useCallback(', '}, [search.setSelectedProfiles');
  assert.doesNotMatch(handler, /toast\./);
  assert.match(handler, /search\.candidateStatus\.refresh\(\)/);
  assert.match(handler, /refreshProjectEnrollments\(\);/);
  assert.doesNotMatch(slice(enrollButton, 'const handleEnrollSuccess = () => {', '};'), /toast/);
});

// ---------------------------------------------------------------- SEQ-144
test('SEQ-144 — menu Séquence : rechargé à chaque ouverture, recherche, mission d’abord, états vide et erreur', () => {
  assert.doesNotMatch(enrollButton, /hasFetched/);
  assert.doesNotMatch(enrollButton, /\.limit\(20\)/);
  assert.match(enrollButton, /sequence_steps\(count\)/);
  assert.match(enrollButton, /placeholder="Rechercher une séquence"/);
  assert.match(enrollButton, /mission: filtered\.filter\(s => s\.project_id === missionId\)/);
  assert.match(enrollButton, /Impossible de charger les séquences/);
  assert.match(enrollButton, /`\/missions\/\$\{missionId\}\?tab=outreach`/);
  // La vraie garde : la séquence est relue active au moment d'inscrire.
  for (const [name, source] of [['inscription simple', enrollModal], ['aperçu', previewModal]]) {
    assert.match(source, /const inactiveReason = await sequenceInactiveReason\(supabase, sequence\.id\);/, name);
  }
  assert.equal(helpers.SEQUENCE_INACTIVE_MESSAGE, "Cette séquence est désactivée. Réactivez-la avant d'inscrire des candidats.");
});

// ---------------------------------------------------------------- SEQ-071 / SEQ-185
test('SEQ-071 / SEQ-185 — messagerie : mise en pause simple (contrat), vérifiée, bouton lu en base', () => {
  const pause = slice(messageView, 'const handleStopSequence = async () => {', '/** Wrapper du re-fetch');
  // Contrat de pause : aucune exécution annulée depuis le navigateur.
  assert.doesNotMatch(pause, /sequence_step_executions/);
  assert.doesNotMatch(pause, /Stoppé depuis Inbox/);
  assert.match(pause, /\.update\(\{ status: 'paused', pause_reason: 'manual' \}\)[\s\S]*?\.select\('id'\);/);
  assert.match(pause, /if \(pausedCount === 0\) \{/);
  assert.match(pause, /onEnrollmentsChanged\?\.\(\);/);
  // Le bouton dépend des inscriptions actives lues à l'ouverture, pas du statut de mission.
  // Vague finale (front-enroll-follow-6) : profile_id, provider_id ou resolved_profile_id.
  assert.match(messageView, /\.or\(enrollmentProfileFilter\(chatProfileId\)\)\s*\.eq\('status', 'active'\)/);
  assert.doesNotMatch(messageView, /displayContext\.status === 'active'/);
  // Revue design : l'action est rangée dans le menu « Plus d'actions » de l'en-tête.
  assert.match(messageView, /const canStopSequence = hasActiveEnrollment;/);
  assert.match(messageView, /\{canStopSequence && \(/);
  assert.match(messageView, /Mettre en pause/);
  assert.match(inbox, /onEnrollmentsChanged=\{inbox\.fetchEnrollments\}/);
});

// ---------------------------------------------------------------- SEQ-163
test('SEQ-163 — messagerie : libellés partagés, repli neutre au lieu de « En séquence »', () => {
  // Revue design D-55 : le badge commun du socle (SequenceBadges.tsx), dont les
  // libellés viennent de sequenceLabels.ts.
  assert.match(messageView, /<EnrollmentStatusBadge\s+status=\{enrollmentStatus\}/);
  assert.doesNotMatch(messageView, /En séquence|config\.active/);
  assert.match(read('src/components/outreach/SequenceBadges.tsx'), /pausedLabel\(pauseReason\)/);
  assert.match(read('src/lib/sequenceCatalog.ts'), /import \{ ENROLLMENT_STATUS_LABELS \} from '\.\/sequenceLabels';/);
});

// ---------------------------------------------------------------- SEQ-184
test('SEQ-184 — fil de la messagerie : vrais types d’étape, échec et étape sautée affichés comme tels', () => {
  assert.doesNotMatch(activityCard, /send_connection:/);
  // Passe 2 (demande de F5) : libellés et mentions du dictionnaire partagé
  // src/lib/sequenceActionLabels.ts, comportement vérifié dans seq-audit-f4c.
  // Revue design : icônes d'étape du socle (SequenceBadges.tsx).
  assert.match(activityCard, /<SequenceActionIcon type=\{event\.actionType\}/);
  const badges = read('src/components/outreach/SequenceBadges.tsx');
  assert.match(badges, /connection_request: UserPlus,/);
  assert.match(badges, /profile_visit: Eye,/);
  assert.match(activityCard, /return sequenceExecutionTitle\(actionType, status\);/);
  assert.match(activityCard, /formatSkipReason\(event\.skipReason\)/);
});

// ---------------------------------------------------------------- SEQ-222
test('SEQ-222 — « déjà dans la séquence » distinct de « déjà passé par cette séquence »', () => {
  assert.equal(helpers.classifyExistingEnrollment('active'), 'in_sequence');
  assert.equal(helpers.classifyExistingEnrollment('paused'), 'in_sequence');
  for (const status of ['completed', 'replied', 'cancelled', 'stopped', 'bounced']) {
    assert.equal(helpers.classifyExistingEnrollment(status), 'passed', status);
  }
  assert.equal(helpers.alreadyPassedLabel(1), '1 candidat est déjà passé par cette séquence (terminée, réponse ou arrêt). Relancez-le depuis le suivi de la séquence.');
  // L'aperçu lit toute ligne existante (plus seulement trois statuts).
  const enroll = slice(previewModal, 'const handleEnroll = async () => {', 'const handleShortlist = async () => {');
  assert.doesNotMatch(enroll, /\.in\('status', \['active', 'completed', 'replied'\]\)/);
  assert.match(enroll, /classifyExistingEnrollment\(existing\.status\)/);
});

// ---------------------------------------------------------------- SEQ-223
test('SEQ-223 — la modale simple grise les candidats exclus avec leur raison', () => {
  assert.match(enrollModal, /const exclusion = exclusionReasons\.get\(profile\.id\);/);
  // Revue design : ligne exclue au nom atténué (jeton de texte, sans opacité), la raison à la place du titre et une pastille « Exclu ».
  assert.match(enrollModal, /exclusion \? 'text-muted-foreground' : 'text-foreground'/);
  assert.match(enrollModal, /\{exclusion \?\? profile\.headline\}/);
  assert.match(enrollModal, /\{!results && exclusion && \(\s*<Badge variant="muted"[^>]*>Exclu<\/Badge>/);
  // Vague finale : un candidat déjà en relation n'est plus exclu (invitation sautée).
  assert.match(enrollModal, /issue === 'too_far' \? 'Hors réseau, exclu' : 'InMail inutile, exclu'/);
});

// ---------------------------------------------------------------- SEQ-224 / SEQ-225
test('SEQ-224 — le délai modifié vaut pour tous les candidats de l’inscription', () => {
  assert.doesNotMatch(treeView, /cette inscription uniquement/);
  assert.match(treeView, /tous les candidats de cette inscription<\/span>\. La séquence elle-même n'est pas modifiée\./);
});

test('SEQ-225 — crédits affichés seulement pour une étape IA, compteur d’aperçus dérivé des aperçus', () => {
  const card = slice(previewModal, 'function MessageStepCard(', 'function SummaryMode(');
  assert.doesNotMatch(card, /~2 crédits/);
  // Revue design : coût écrit en toutes lettres (« environ 1 crédit », pluriel partagé),
  // calculé une fois par le hook, affiché pour une étape IA seulement.
  assert.match(previewModal, /return n > 0 \? `environ \$\{plural\(n, 'crédit'\)\}` : 'aucun crédit';/);
  assert.match(card, /const cost = step\.useAiPersonalization \? creditsLabel\(creditsPerMessage\) : 'aucun crédit';/);
  assert.match(card, /\{step\.useAiPersonalization && <p className="text-xs text-muted-foreground">\{cost\}<\/p>\}/);
  assert.match(previewHookSrc, /const creditsPerMessage = estimateActionCredits\('outreach_message'\);/);
  assert.match(card, /Voir l'aperçu \(gratuit\)/);
  assert.doesNotMatch(previewHookSrc, /setGeneratedCount/, 'le compteur ne s’incrémente plus à chaque clic');
  assert.match(previewHookSrc, /const generatedCount = messageSteps\.length === 0/);
});

// ---------------------------------------------------------------- SEQ-226
test('SEQ-226 — InMail groupé : rythme d’envoi réel annoncé', () => {
  assert.doesNotMatch(bulkInMail, /Délai 2-5 min/);
  assert.doesNotMatch(bulkInMail, /espacés de 2 à 5 minutes/);
  assert.match(bulkInMail, /Envoi pendant vos heures d'envoi, les jours ouvrés, 1 à 2 minutes entre chaque InMail\./);
});

// ---------------------------------------------------------------- SEQ-228
test('SEQ-228 — plus d’inscription directe exportée par la messagerie', () => {
  assert.doesNotMatch(inboxHook, /enrollInSequence/);
});

// ---------------------------------------------------------------- SEQ-229
test('SEQ-229 — carte candidat focalisable et menu d’actions visible au clavier et au toucher', () => {
  // Revue design : la ligne est un Button du kit (focalisable, Entrée et Espace natifs,
  // data-candidate-id pour les raccourcis de la liste) ; le menu d'actions est
  // toujours affiché, au clavier comme au doigt, avec une cible de 44 px sur téléphone.
  assert.match(sidebarCard, /<Button\s+type="button"\s+variant="ghost"\s+data-candidate-id=\{profile\.id\}/);
  assert.match(sidebarCard, /aria-current=\{isSelected \? 'true' : undefined\}/);
  assert.match(sidebarCard, /onClick=\{onSelect\}/);
  assert.doesNotMatch(sidebarCard, /opacity-0|group-hover:opacity/, 'menu jamais caché hors survol');
  assert.match(sidebarCard, /size="icon-xs"[\s\S]{0,200}max-md:h-11 max-md:w-11/);
  assert.match(sidebarCard, /aria-label=\{`Actions pour \$\{profile\.name \|\| 'ce candidat'\}`\}/);
});

// ---------------------------------------------------------------- SEQ-245
test('SEQ-245 — textes de l’inscription : français, vouvoiement, vocabulaire commun', () => {
  const texts = [enrollModal, previewModal, enrollButton, treeView].join('\n');
  for (const pattern of [/Shortlister sans message/, /Smart Message/, /réessaie/, /ajoute au moins/, /Tape \/ai/, /séquence d'outreach/, / dans:/]) {
    assert.doesNotMatch(texts, pattern, String(pattern));
  }
  // Revue design : rédaction du design (D-47), un seul verbe ; aucun parcours e2e ne lit ce libellé.
  assert.match(previewModal, /Présélectionner sans message/);
  assert.match(enrollModal, /Inscrire \{enrollCount\} candidat\{enrollCount > 1 \? 's' : ''\}/);
  assert.match(enrollButton, /Inscrire \{count\} candidat\{count > 1 \? 's' : ''\} dans :/);
});

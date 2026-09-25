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

/** Client Supabase factice : enregistre chaque requête (table, filtres) et renvoie `rowsFor(table, query)`. */
function fakeSupabase(rowsFor) {
  const queries = [];
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
  return { supabase: { from }, queries };
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
  assert.deepEqual(inmailQuery.in.find(([c]) => c === 'status')[1], ['scheduled', 'sending', 'sent']);
  assert.equal(inmailQuery.gte[0]?.[0], 'created_at');
});

test('SEQ-125 — l’InMail groupé vérifie les contacts récents et exclut par défaut (dérogation owner/admin)', () => {
  assert.match(bulkInMail, /findRecentEnrollments\(supabase, organizationId, allRecipients\.map\(/);
  assert.match(bulkInMail, /const allowDuplicates = isAdmin && includeDuplicates;/);
  assert.match(bulkInMail, /allRecipients\.filter\(r => !recentContacts\.has\(r\.id\)\)/);
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
test('SEQ-124 — l’inscription ne rétrograde jamais un candidat contacté, shortlisté ou qui a répondu', () => {
  assert.equal(helpers.shouldMarkMessaged([]), true);
  assert.equal(helpers.shouldMarkMessaged(['discovered']), true);
  assert.equal(helpers.shouldMarkMessaged(['shortlisted']), false);
  assert.equal(helpers.shouldMarkMessaged(['scored', 'replied']), false);
  assert.equal(helpers.shouldMarkMessaged(['messaged']), false);
  for (const [name, source] of [['inscription simple', enrollModal], ['aperçu', previewModal]]) {
    assert.match(source, /await markCandidatesMessaged\(supabase, \{/, name);
    assert.doesNotMatch(source, /status: 'messaged',/, `${name} : plus d'upsert « contacté » sans condition`);
  }
});

test('SEQ-124 — markCandidatesMessaged lit les deux formes d’identifiant de mission et n’écrit que les autres', async () => {
  const writes = [];
  const supabase = {
    from: () => {
      const chain = {
        select: () => chain, in: () => chain, eq: () => chain,
        upsert: (rows) => { writes.push(rows); return Promise.resolve({ error: null }); },
        then: (resolve) => resolve({ data: [{ candidate_id: 'shortlisté', status: 'shortlisted' }, { candidate_id: 'nouveau', status: 'scored' }], error: null }),
      };
      return chain;
    },
  };
  await helpers.markCandidatesMessaged(supabase, {
    rawJobId: 'project:6f1c2d3e-0000-4000-8000-000000000001', userId: 'u1', organizationId: 'org-1',
    profiles: [{ id: 'shortlisté' }, { id: 'nouveau' }],
  });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].map(r => [r.candidate_id, r.status, r.job_id]), [['nouveau', 'messaged', '6f1c2d3e-0000-4000-8000-000000000001']]);
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
  assert.match(results, /inscrit\$\{plural\(results\.success\)\} sur \$\{attempted\}/);
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
  assert.match(bulkInMail, /const freeMessageCount = recipients\.filter\(r => queueNetworkDistance\(r\) === 1\)\.length;/);
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
  assert.match(sidebarCard, /\(state\.skipped \|\| exclusion\) && "opacity-50"/);
  const banner = read('src/components/outreach/enrollment-preview/DynamicSummaryBanner.tsx');
  assert.match(banner, /\{active > 1 \? 'seront inscrits' : 'sera inscrit'\}/);
  assert.match(banner, /déjà contacté\$\{duplicates > 1 \? 's' : ''\}/);
});

// ---------------------------------------------------------------- SEQ-140
test('SEQ-140 — raccourcis posés sur la liste, jamais Entrée seule pour une génération payante', () => {
  const shortcuts = slice(previewModal, 'const handleShortcutKeyDown = (e', 'const handleGenerateShortcut');
  assert.doesNotMatch(shortcuts, /e\.key === 'Enter'/, 'Entrée doit activer le bouton ciblé');
  assert.doesNotMatch(shortcuts, /generateForCandidateById/);
  const generate = slice(previewModal, 'const handleGenerateShortcut = (e', '// ── Enrollment Logic ──');
  assert.match(generate, /if \(e\.key !== 'Enter' \|\| !\(e\.ctrlKey \|\| e\.metaKey\)\) return;/);
  assert.match(previewModal, /ref=\{candidateListRef\}[\s\S]{0,200}onKeyDown=\{handleShortcutKeyDown\}/);
  assert.match(previewModal, /↑ ↓ changer de candidat · Espace passer · X retirer/);
  assert.match(previewModal, /\[role="menu"\], \[role="menuitem"\], \[role="dialog"\]/);
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
  assert.match(inbox, /Relation LinkedIn non vérifiée\. Si vous êtes déjà en relation avec ce candidat, l'invitation échouera\./);
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
  assert.match(messageView, /\.eq\('profile_id', chatProfileId\)\s*\.eq\('status', 'active'\)/);
  assert.doesNotMatch(messageView, /displayContext\.status === 'active'/);
  assert.match(messageView, /\{hasActiveEnrollment && \(\s*<button/);
  assert.match(messageView, /Mettre en pause/);
  assert.match(inbox, /onEnrollmentsChanged=\{inbox\.fetchEnrollments\}/);
});

// ---------------------------------------------------------------- SEQ-163
test('SEQ-163 — messagerie : libellés partagés, repli neutre au lieu de « En séquence »', () => {
  const badge = messageView.slice(messageView.indexOf('const SequenceStatusBadge'));
  assert.match(badge, /enrollmentStatusLabel\(effectiveStatus\)/);
  assert.doesNotMatch(badge, /config\.active/);
});

// ---------------------------------------------------------------- SEQ-184
test('SEQ-184 — fil de la messagerie : vrais types d’étape, échec et étape sautée affichés comme tels', () => {
  assert.doesNotMatch(activityCard, /send_connection:/);
  assert.match(activityCard, /connection_request: \{ icon: UserPlus, label: 'Invitation envoyée'/);
  assert.match(activityCard, /profile_visit: \{ icon: Eye, label: 'Profil visité'/);
  assert.match(activityCard, /if \(status === 'failed' \|\| status === 'bounced'\) return 'Échec';/);
  assert.match(activityCard, /if \(status === 'skipped'\) return 'Sauté';/);
  assert.match(activityCard, /formatSkipReason\(event\.skipReason\)/);
});

// ---------------------------------------------------------------- SEQ-222
test('SEQ-222 — « déjà dans la séquence » distinct de « déjà passé par cette séquence »', () => {
  assert.equal(helpers.classifyExistingEnrollment('active'), 'in_sequence');
  assert.equal(helpers.classifyExistingEnrollment('paused'), 'in_sequence');
  for (const status of ['completed', 'replied', 'cancelled', 'stopped', 'bounced']) {
    assert.equal(helpers.classifyExistingEnrollment(status), 'passed', status);
  }
  assert.equal(helpers.alreadyPassedLabel(1), '1 candidat est déjà passé par cette séquence (arrêté). Reprenez-le depuis le suivi de la séquence.');
  // L'aperçu lit toute ligne existante (plus seulement trois statuts).
  const enroll = slice(previewModal, 'const handleEnroll = async () => {', 'const handleShortlist = async () => {');
  assert.doesNotMatch(enroll, /\.in\('status', \['active', 'completed', 'replied'\]\)/);
  assert.match(enroll, /classifyExistingEnrollment\(existing\.status\)/);
});

// ---------------------------------------------------------------- SEQ-223
test('SEQ-223 — la modale simple grise les candidats exclus avec leur raison', () => {
  assert.match(enrollModal, /const exclusion = exclusionReasons\.get\(profile\.id\);/);
  assert.match(enrollModal, /exclusion && 'opacity-60'/);
  assert.match(enrollModal, /Déjà en relation, exclu/);
});

// ---------------------------------------------------------------- SEQ-224 / SEQ-225
test('SEQ-224 — le délai modifié vaut pour tous les candidats de l’inscription', () => {
  assert.doesNotMatch(treeView, /cette inscription uniquement/);
  assert.match(treeView, /tous les candidats de cette inscription<\/span>\. La séquence elle-même n'est pas modifiée\./);
});

test('SEQ-225 — crédits affichés seulement pour une étape IA, compteur d’aperçus dérivé des aperçus', () => {
  const card = slice(previewModal, 'function MessageStepCard(', 'function SummaryMode(');
  assert.doesNotMatch(card, /~2 crédits/);
  assert.match(card, /~\{estimateActionCredits\('outreach_message'\)\} crédits/);
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
  assert.match(sidebarCard, /role="button"\s*tabIndex=\{0\}/);
  assert.match(sidebarCard, /onKeyDown=\{handleKeyDown\}/);
  assert.match(sidebarCard, /group-focus-within:opacity-100/);
  assert.match(sidebarCard, /\[@media\(hover:none\)\]:opacity-100/);
  assert.match(sidebarCard, /aria-label=\{`Actions pour \$\{profile\.name \|\| 'ce candidat'\}`\}/);
});

// ---------------------------------------------------------------- SEQ-245
test('SEQ-245 — textes de l’inscription : français, vouvoiement, vocabulaire commun', () => {
  const texts = [enrollModal, previewModal, enrollButton, treeView].join('\n');
  for (const pattern of [/Shortlister sans message/, /Smart Message/, /réessaie/, /ajoute au moins/, /Tape \/ai/, /séquence d'outreach/, / dans:/]) {
    assert.doesNotMatch(texts, pattern, String(pattern));
  }
  assert.match(previewModal, /Ajouter à la shortlist sans message/);
  assert.match(enrollModal, /Inscrire \{enrollCount\} candidat\{enrollCount > 1 \? 's' : ''\}/);
  assert.match(enrollButton, /Inscrire \{count\} candidat\{count > 1 \? 's' : ''\} dans :/);
});

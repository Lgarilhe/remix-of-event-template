/**
 * Audit du module séquences (2026-09-25), lot F4, vague finale : points de la
 * relecture contradictoire et demandes résiduelles (fiche final/F4.md).
 *
 * - D3 : l'anti-doublon du navigateur lit les inscriptions par la RPC
 *   find_recent_org_contacts (repli sur la lecture directe si absente).
 * - front-enroll-follow-1 : l'InMail groupé part du compte relié de
 *   l'utilisateur (useSendingAccount), jamais de celui d'un collègue.
 * - front-enroll-follow-4 : déjà en relation + invitation = avertissement
 *   (le moteur saute l'invitation), plus d'exclusion ni d'« échouera ».
 * - front-enroll-follow-5 : la dérogation de l'InMail groupé ne couvre pas un
 *   InMail groupé récent (refusé par la file).
 * - front-enroll-follow-6 : la messagerie retrouve une inscription par
 *   profile_id, provider_id ou resolved_profile_id.
 * - front-enroll-follow-7 : fermer la préparation avec des messages préparés
 *   demande confirmation (croix, « Annuler »).
 * - Points low : refus ENROLL_ACCOUNT_OF_OTHER_MEMBER lu, génération d'un seul
 *   candidat après arrêt, crédits sur les messages prêts, libellé « Relancez »,
 *   missionId envoyé à la génération.
 *
 * Lancer : node --test tests/ux/seq-audit-f4-final.test.mjs
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

const bulkInMail = read('src/components/outreach/BulkInMailModal.tsx');
const previewModal = read('src/components/outreach/EnrollmentPreviewModal.tsx');
const enrollModal = read('src/components/outreach/SequenceEnrollModal.tsx');
const previewHook = read('src/hooks/useEnrollmentPreview.ts');
const inbox = read('src/components/outreach/MessagesInbox.tsx');
const messageView = read('src/components/outreach/inbox/MessageView.tsx');
const compatSrc = read('src/lib/sequenceCompatibility.ts');
const inmailQueueFn = read('supabase/functions/process-inmail-queue/index.ts');

const duplicates = await loadModule('src/lib/enrollmentDuplicates.ts');
const compat = await loadModule('src/lib/sequenceCompatibility.ts');
const helpers = await loadModule('src/components/outreach/enrollment-preview/enrollmentHelpers.ts');

/**
 * Client Supabase factice : `rpcResult` (fonction ou valeur) pour la RPC,
 * `rowsFor(table)` pour les lectures directes. Enregistre les appels.
 */
function fakeSupabase({ rpcResult, rowsFor = () => [] }) {
  const calls = { rpc: [], from: [] };
  const from = (table) => {
    calls.from.push(table);
    const chain = {
      select: () => chain, eq: () => chain, in: () => chain, gte: () => chain, or: () => chain, order: () => chain,
      then: (resolve) => resolve({ data: rowsFor(table), error: null }),
    };
    return chain;
  };
  const rpc = async (name, args) => {
    calls.rpc.push({ name, args });
    return typeof rpcResult === 'function' ? rpcResult(name, args) : rpcResult;
  };
  return { supabase: { from, rpc }, calls };
}

// ---------------------------------------------------------------- D3
test('D3 — anti-doublon : les inscriptions passent par la RPC find_recent_org_contacts (toute l’organisation)', async () => {
  const { supabase, calls } = fakeSupabase({
    rpcResult: {
      data: [{ profile_id: 'AEMAAAPaul', provider_id: 'ACoAAPaul', resolved_profile_id: null, profile_url: null, created_by: 'u2', created_at: '2026-09-10T10:00:00Z', status: 'active', sequence_id: 's-collegue' }],
      error: null,
    },
    rowsFor: (table) => (table === 'profiles' ? [{ user_id: 'u2', display_name: 'Théo Martin' }] : []),
  });
  const result = await duplicates.findRecentEnrollments(supabase, 'org-1', [{ id: 'ACoAAPaul', profile_url: 'https://www.linkedin.com/in/paul-martin' }]);
  assert.equal(result.get('ACoAAPaul')?.sequenceId, 's-collegue', 'inscription d’un collègue vue par la RPC');
  assert.equal(result.get('ACoAAPaul')?.createdByFirstName, 'Théo');
  assert.equal(calls.rpc.length, 1);
  const { name, args } = calls.rpc[0];
  assert.equal(name, 'find_recent_org_contacts');
  assert.equal(args.p_org, 'org-1');
  assert.ok(args.p_values.includes('ACoAAPaul'), 'identifiants bruts transmis');
  assert.ok(args.p_slugs.includes('paul-martin'), 'slugs publics transmis');
  assert.ok(!Number.isNaN(Date.parse(args.p_since)), 'p_since : date ISO');
  assert.ok(Math.abs(Date.now() - Date.parse(args.p_since) - 90 * 86400000) < 60_000, 'fenêtre de 90 jours');
  assert.ok(!calls.from.includes('sequence_enrollments'), 'plus de lecture directe (RLS) quand la RPC répond');
  assert.ok(calls.from.includes('inmail_queue'), 'les InMails groupés restent lus');
});

test('D3 — RPC absente (PGRST202 / 42883) : repli sur la lecture directe ; autre erreur : levée', async () => {
  for (const code of ['PGRST202', '42883']) {
    const { supabase, calls } = fakeSupabase({ rpcResult: { data: null, error: { code } } });
    await duplicates.findRecentEnrollments(supabase, 'org-1', [{ id: 'ACoAAX' }]);
    assert.ok(calls.from.includes('sequence_enrollments'), `${code} : lecture directe attendue`);
  }
  const { supabase } = fakeSupabase({ rpcResult: { data: null, error: { code: '42501', hint: 'NOT_ORG_MEMBER' } } });
  await assert.rejects(duplicates.findRecentEnrollments(supabase, 'org-1', [{ id: 'ACoAAX' }]), (err) => err.code === '42501');
});

// ---------------------------------------------------------------- front-enroll-follow-1
test('front-enroll-follow-1 — InMail groupé : compte d’envoi affiché et liaison stricte appliquée', () => {
  assert.match(bulkInMail, /import \{[\s\S]*?useSendingAccount,[\s\S]*?\} from '\.\/enrollment-preview\/useSendingAccount';/);
  assert.match(bulkInMail, /import \{ SendingAccountNotice \} from '\.\/enrollment-preview\/SendingAccountNotice';/);
  assert.match(bulkInMail, /const sendingAccount = useSendingAccount\(accountId\);/);
  // Garde en tête de la génération et de la planification.
  for (const [name, start, end] of [
    ['génération', 'const handleGenerateAll = async () => {', '// Regenerate current message'],
    ['planification', 'const handleQueueAll = async () => {', '// Cancel pending items'],
  ]) {
    const body = slice(bulkInMail, start, end);
    assert.match(body, /if \(accountBlockReason\) \{\s*toast\.error\(accountBlockReason\);\s*return;\s*\}/, `${name} : garde compte d'envoi`);
    assert.ok(body.indexOf('accountBlockReason') < body.indexOf('invokeEdgeFunction') || !body.includes('invokeEdgeFunction'),
      `${name} : la garde précède tout appel serveur`);
  }
  // Boutons « Générer » et « Planifier » désactivés.
  assert.equal((bulkInMail.match(/!!accountBlockReason/g) || []).length, 2);
  // Compte affiché près du bouton et nommé dans la confirmation.
  assert.match(bulkInMail, /\{activeTab === 'compose' && <SendingAccountNotice state=\{sendingAccountState\} \/>\}/);
  const confirm = slice(bulkInMail, '<AlertDialogTitle>Planifier {readyCount}', '</AlertDialogDescription>');
  assert.match(confirm, /Envoyés depuis le compte LinkedIn de \$\{sendingAccount\.name\}/);
});

test('front-enroll-follow-1 — refus formulés pour l’InMail, identiques au refus serveur de la file', () => {
  const otherMember = "Ce compte LinkedIn est relié à un autre membre de l'équipe. Envoyez les InMails depuis votre propre compte.";
  assert.ok(bulkInMail.includes(`[OTHER_MEMBER_ACCOUNT_MESSAGE]: "${otherMember}"`));
  assert.ok(inmailQueueFn.includes(`message: "${otherMember}"`), 'même texte que process-inmail-queue (ACCOUNT_OF_OTHER_MEMBER)');
  assert.match(bulkInMail, /\[DISCONNECTED_ACCOUNT_MESSAGE\]: "Votre compte LinkedIn est déconnecté\. Reconnectez-le avant d'envoyer des InMails\."/);
  assert.match(bulkInMail, /\[NO_ACCOUNT_MESSAGE\]: "Aucun compte LinkedIn n'est sélectionné\. Connectez votre compte avant d'envoyer des InMails\."/);
});

// ---------------------------------------------------------------- front-enroll-follow-4
test('front-enroll-follow-4 — déjà en relation + invitation : avertissement, jamais bloquant', () => {
  const invite = [{ action_type: 'connection_request', step_order: 0 }, { action_type: 'message', step_order: 1 }];
  const inviteLater = [{ action_type: 'message', step_order: 0 }, { action_type: 'connection_request', step_order: 1 }];
  for (const steps of [invite, inviteLater]) {
    const res = compat.checkProfilesCompat([{ id: 'relation', name: 'A', network_distance: 'FIRST_DEGREE' }], steps);
    assert.deepEqual(res.blockers, []);
    assert.equal(res.warnings[0]?.issue, 'connection_already_connected');
    assert.equal(res.warnings[0]?.message, "Déjà en relation : l'invitation sera sautée, les messages suivants partiront.");
  }
  // Hors réseau sans InMail : toujours bloquant.
  const far = compat.checkProfilesCompat([{ id: 'loin', network_distance: 'OUT_OF_NETWORK' }], invite);
  assert.deepEqual(far.blockers.map(r => r.issue), ['too_far']);
  // Plus aucune annonce d'échec de l'invitation.
  for (const [name, src] of [['compatibilité', compatSrc], ['aperçu', previewModal], ['inscription simple', enrollModal], ['messagerie', inbox]]) {
    assert.doesNotMatch(src, /invitation (LinkedIn |prévue plus loin dans la séquence )?échouera/, name);
  }
});

test('front-enroll-follow-4 — les fenêtres n’excluent plus une relation directe', () => {
  // Aperçu : seuls les blockers (hors réseau) sont exclus par défaut ; le titre ne parle plus d'échec.
  const headline = slice(previewModal, 'function compatHeadline(', '\n}\n');
  assert.match(headline, /blockers\.every\(r => r\.issue === 'too_far'\)/);
  assert.doesNotMatch(headline, /connection_already_connected/);
  // Inscription simple : « Exclure les incompatibles » ne vise plus les relations directes.
  assert.match(enrollModal, /\[\.\.\.compat\.blockers, \.\.\.compat\.warnings\]\.filter\(r => r\.issue !== 'connection_already_connected'\)/);
  const compatible = slice(enrollModal, 'const compatibleProfiles = useMemo(() => {', '}, [');
  assert.match(compatible, /const excluded = new Set\(excludableCompat\.map\(r => r\.profile\.id\)\);/);
  assert.doesNotMatch(enrollModal, /compat\.compatible\.map\(c => c\.profile as LinkedInProfile\)/);
  assert.match(enrollModal, /Exclure les candidats incompatibles \(\{excludableCompat\.length\}\)/);
  // « Déjà en relation, exclu » : réservé à une séquence qui ne contient que
  // l'invitation (dernière passe, front-enroll-follow-1), jamais à une relation
  // directe suivie de messages.
  assert.match(slice(enrollModal, 'function compatExclusionLabel(', '\n}\n'), /if \(issue === 'connection_only_already_connected'\) return 'Déjà en relation, exclu';/);
  // Messagerie.
  assert.match(inbox, /"Relation LinkedIn non vérifiée : si vous êtes déjà en relation, l'invitation sera sautée\."/);
});

// ---------------------------------------------------------------- front-enroll-follow-5
test('front-enroll-follow-5 — anti-doublon : un InMail groupé récent est signalé même derrière une inscription plus récente', async () => {
  const { supabase } = fakeSupabase({
    rpcResult: {
      data: [{ profile_id: 'ACoAAJulie', provider_id: null, resolved_profile_id: null, profile_url: null, created_by: 'u1', created_at: '2026-09-20T10:00:00Z', status: 'completed', sequence_id: 's1' }],
      error: null,
    },
    rowsFor: (table) => (table === 'inmail_queue'
      ? [{ recipient_profile_id: 'ACoAAJulie', created_by: 'u2', created_at: '2026-09-01T10:00:00Z', status: 'sent' }]
      : table === 'profiles' ? [] : []),
  });
  const result = await duplicates.findRecentEnrollments(supabase, 'org-1', [{ id: 'ACoAAJulie' }, { id: 'ACoAAMarc' }]);
  const entry = result.get('ACoAAJulie');
  assert.equal(entry?.source, 'sequence', 'le dernier contact reste l’inscription');
  assert.equal(entry?.hasRecentInMail, true, 'l’InMail groupé plus ancien doit être retenu');
  assert.equal(result.has('ACoAAMarc'), false);
});

// Décision 24 : la file InMail refuse sans dérogation tout candidat déjà contacté, la case « Contacter quand même » a disparu.
test('front-enroll-follow-5 — InMail groupé : tout candidat déjà contacté reste exclu, sans dérogation', () => {
  const recipients = slice(bulkInMail, 'const recipients = useMemo(', '[allRecipients, recentContacts]');
  assert.match(recipients, /allRecipients\.filter\(r => !recentContacts\.has\(r\.id\)\)/);
  assert.doesNotMatch(bulkInMail, /Contacter quand même/);
  assert.doesNotMatch(bulkInMail, /overridableDuplicates|allowDuplicates|includeDuplicates/);
  // Aide affichée sous la liste des candidats exclus.
  assert.match(bulkInMail, /const RECENT_CONTACT_REFUSED_MESSAGE =\s*`Sans dérogation possible : la file InMail refuse tout candidat inscrit en séquence ou contacté par votre organisation ces \$\{RECENT_CONTACT_WINDOW_DAYS\} derniers jours, séquence arrêtée comprise\.`;/);
  assert.match(bulkInMail, /<p className="text-\[11px\] text-muted-foreground">\{RECENT_CONTACT_REFUSED_MESSAGE\}<\/p>/);
});

// ---------------------------------------------------------------- front-enroll-follow-6
test('front-enroll-follow-6 — messagerie : inscription retrouvée par profile_id, provider_id ou resolved_profile_id', () => {
  assert.equal(
    duplicates.enrollmentProfileFilter(' ACoAAPaul '),
    'profile_id.eq."ACoAAPaul",provider_id.eq."ACoAAPaul",resolved_profile_id.eq."ACoAAPaul"',
  );
  // Valeur échappée : ni guillemet ni antislash ne cassent le filtre.
  assert.equal(
    duplicates.enrollmentProfileFilter('a"b\\c'),
    'profile_id.eq."a\\"b\\\\c",provider_id.eq."a\\"b\\\\c",resolved_profile_id.eq."a\\"b\\\\c"',
  );
  assert.match(messageView, /import \{ enrollmentProfileFilter \} from '@\/lib\/enrollmentDuplicates';/);
  // Badge et bouton (lecture à l'ouverture) puis mise en pause : même rapprochement.
  assert.match(messageView, /\.or\(enrollmentProfileFilter\(chatProfileId\)\)\s*\.eq\('status', 'active'\)/);
  const pause = slice(messageView, 'const handleStopSequence = async () => {', '/** Wrapper du re-fetch');
  assert.match(pause, /\.or\(enrollmentProfileFilter\(profileId\)\)\s*\.eq\('status', 'active'\)/);
  assert.doesNotMatch(pause, /\.eq\('profile_id', profileId\)/);
  // La mise à jour reste bornée aux inscriptions lues, encore actives, relue.
  assert.match(pause, /\.in\('id', ids\)\s*\.eq\('status', 'active'\)\s*\.select\('id'\);/);
});

// ---------------------------------------------------------------- front-enroll-follow-7
test('front-enroll-follow-7 — fermer la préparation avec des messages préparés demande confirmation', () => {
  const close = slice(previewModal, 'const handleClose = () => {', '\n  };\n');
  assert.match(close, /if \(isBusy\) return;/);
  assert.match(close, /if \(enrollResults\?\.success\) \{\s*onSuccess\(\);\s*return;\s*\}/);
  assert.match(close, /if \(!enrollResults && hasPreparedWork\) \{\s*setConfirmDiscardOpen\(true\);\s*return;\s*\}/);
  assert.ok(close.indexOf('setConfirmDiscardOpen(true)') < close.lastIndexOf('onClose();'), 'confirmation avant la fermeture');
  // Croix et « Annuler » passent par handleClose.
  assert.ok((previewModal.match(/onClick=\{handleClose\}\s*disabled=\{isBusy\}/g) || []).length >= 2);
  // Confirmation au-dessus de la couche plein écran, hors du contenu (raccourcis).
  const dialog = slice(previewModal, '<AlertDialog open={confirmDiscardOpen}', '</AlertDialog>');
  assert.match(dialog, /<AlertDialogContent className="z-\[10000\]">/);
  assert.match(dialog, /<AlertDialogTitle>Fermer sans inscrire \?<\/AlertDialogTitle>/);
  assert.match(dialog, /<AlertDialogDescription>Les messages préparés seront perdus\.<\/AlertDialogDescription>/);
  assert.match(dialog, /<AlertDialogCancel>Continuer la préparation<\/AlertDialogCancel>/);
  // Même garde que handleClose (dernière passe, front-enroll-follow-3).
  assert.match(dialog, /setConfirmDiscardOpen\(false\);[\s\S]*?if \(!isBusy\) onClose\(\);/);
  assert.match(dialog, /Fermer sans inscrire\s*<\/AlertDialogAction>/);
  assert.ok(previewModal.indexOf('</DialogPrimitive.Portal>') < previewModal.indexOf('<AlertDialog open={confirmDiscardOpen}'));
});

// ---------------------------------------------------------------- points low
test('SEQ-043 (low) — refus ENROLL_ACCOUNT_OF_OTHER_MEMBER : message du compte d’un collègue, sans « réessayez »', () => {
  assert.equal(helpers.isOtherMemberAccountError({ code: '42501', hint: 'ENROLL_ACCOUNT_OF_OTHER_MEMBER' }), true);
  assert.equal(helpers.isOtherMemberAccountError({ code: '42501', hint: 'NOT_ORG_MEMBER' }), false);
  assert.equal(helpers.isOtherMemberAccountError(null), false);
  assert.equal(helpers.isOtherMemberAccountError(new Error('x')), false);
  const simpleCatch = slice(enrollModal, "console.error('Enrollment error:', err);", '} finally {');
  assert.match(simpleCatch, /const otherMemberAccount = isOtherMemberAccountError\(err\);/);
  assert.match(simpleCatch, /otherMemberAccount \? OTHER_MEMBER_ACCOUNT_MESSAGE : 'Réessayez ou contactez le support\.'/);
  const enroll = slice(previewModal, 'const handleEnroll = async () => {', 'const handleShortlist = async () => {');
  assert.match(enroll, /if \(isOtherMemberAccountError\(err\)\) throw err;/);
  assert.match(enroll, /isOtherMemberAccountError\(err\) \? OTHER_MEMBER_ACCOUNT_MESSAGE : 'Réessayez ou contactez le support\.'/);
});

test('front-enroll-follow-8 (low) — Ctrl+Entrée après l’arrêt de la génération groupée génère le candidat', () => {
  const byId = slice(previewHook, 'const generateForCandidateById = useCallback(', '}, [profiles, generateForCandidate]);');
  assert.match(byId, /await generateForCandidate\(profile, \{ ignoreBulkAbort: true \}\);/);
  assert.match(previewHook, /if \(abortRef\.current && !options\?\.ignoreBulkAbort\) return;/);
  // Les travailleurs de la génération groupée restent arrêtés par le drapeau.
  assert.match(previewHook, /while \(queue\.length > 0 && !abortRef\.current\) \{[\s\S]*?await generateForCandidate\(profile\);/);
});

test('front-enroll-follow-9 (low) — crédits InMail calculés sur les messages prêts', () => {
  assert.match(bulkInMail, /const withMessage = recipients\.filter\(r => generatedMessages\[r\.id\]\);/);
  assert.match(bulkInMail, /const billedRecipients = withMessage\.length > 0 && !isGenerating \? withMessage : recipients;/);
  assert.match(bulkInMail, /const paidInMailCount = billedRecipients\.length - freeMessageCount;/);
});

test('front-enroll-follow-12 (low) — inscription close : « Relancez » depuis le suivi', () => {
  assert.equal(helpers.alreadyPassedLabel(2), '2 candidats sont déjà passés par cette séquence (terminée, réponse ou arrêt). Relancez-les depuis le suivi de la séquence.');
  assert.doesNotMatch(helpers.alreadyPassedLabel(1), /Reprenez|arrêté\)/);
});

test('SEQ-051 (low) — la génération envoie la mission (missionId) au serveur', () => {
  assert.match(bulkInMail, /missionId: selectedJob\.id \|\| undefined,/);
  assert.equal((previewHook.match(/missionId: job\?\.id \|\| undefined,/g) || []).length, 2, 'les deux appels de useEnrollmentPreview');
});

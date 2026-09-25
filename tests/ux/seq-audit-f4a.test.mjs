/**
 * Audit du module séquences (2026-09-25), lot F4a : inscription, aperçu des
 * messages et InMail groupé.
 *
 * Les modules purs (première étape d'une séquence A/B, compatibilité, anti-
 * doublon, champs de contact d'une inscription, variables de l'aperçu) sont
 * transpilés en mémoire par esbuild et exécutés. Les écrans sont vérifiés par
 * inspection du code source, dans le style des autres tests de tests/ux.
 *
 * Lancer : node --test tests/ux/seq-audit-f4a.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Transpile et charge un module TypeScript depuis son texte. Les imports « @/ »
 * sont résolus dans src/, sauf ceux remplacés par `stubs` (chemin → code).
 */
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
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.path in stubs) return { path: args.path, namespace: 'stub' };
          if (args.path.startsWith('@/')) return { path: resolveSrc(args.path) };
          return undefined;
        });
        build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
      },
    }],
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

/** Corps d'une fonction ou d'un useCallback, de sa déclaration jusqu'à `marker` (exclu). */
function slice(source, start, marker) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `« ${start} » introuvable`);
  const to = source.indexOf(marker, from + start.length);
  assert.ok(to > from, `fin « ${marker} » introuvable après « ${start} »`);
  return source.slice(from, to);
}

const previewHook = read('src/hooks/useEnrollmentPreview.ts');
const previewModal = read('src/components/outreach/EnrollmentPreviewModal.tsx');
const enrollModal = read('src/components/outreach/SequenceEnrollModal.tsx');
const bulkInMail = read('src/components/outreach/BulkInMailModal.tsx');
const accountsHook = read('src/hooks/useFilteredLinkedInAccounts.ts');

const REACT_STUB = 'export const useState = () => [undefined, () => {}]; export const useCallback = (f) => f; export const useRef = (v) => ({ current: v }); export const useEffect = () => {}; export const useMemo = (f) => f(); export default {};';
const previewHookModule = await loadModule('src/hooks/useEnrollmentPreview.ts', {
  react: REACT_STUB,
  '@/lib/invokeWithCredits': 'export const invokeWithCredits = async () => ({ data: null, error: null }); export const estimateActionCredits = () => 1;',
  '@/integrations/supabase/client': 'export const supabase = {};',
  '@/hooks/useAuthReady': 'export const useAuthReady = () => ({ user: null });',
});
const compatModule = await loadModule('src/lib/sequenceCompatibility.ts');

// ---------------------------------------------------------------- SEQ-021
test('SEQ-021 — « Générer tous les aperçus » et Entrée ne remplacent jamais un message généré ou modifié', () => {
  const body = slice(previewHook, 'const generateForCandidate = useCallback(', 'const generateForCandidateById');
  assert.doesNotMatch(body, /existing\?\.isGenerated && !existing\.isEdited/, 'un message modifié (isGenerated + isEdited) était régénéré');
  assert.match(body, /existing && \(existing\.isEdited \|\| existing\.isGenerated/, 'garde sur isEdited ET isGenerated attendue');
  // Lecture fraîche : pas la closure du rendu où la génération a été lancée.
  assert.match(body, /previewsRef\.current\.get\(profile\.id\)\?\.get\(step\.stepId\)/);
  const deps = body.slice(body.lastIndexOf('}, ['));
  assert.doesNotMatch(deps, /\bpreviews\b/, 'generateForCandidate ne doit plus dépendre de la closure `previews`');
  // Le raccourci n'est plus un écouteur window figé sur d'anciens aperçus.
  assert.doesNotMatch(previewModal, /window\.addEventListener\('keydown'/);
  assert.match(previewModal, /onKeyDown=\{handleShortcutKeyDown\}/);
});

// ---------------------------------------------------------------- SEQ-022
test('SEQ-022 — l’InMail groupé planifie le texte corrigé à l’écran, même sans « Sauvegarder »', () => {
  const body = slice(bulkInMail, 'const handleQueueAll = async () => {', '// Cancel pending items');
  const itemsAt = body.indexOf('const items =');
  assert.ok(itemsAt > 0);
  const beforeItems = body.slice(0, itemsAt);
  assert.match(beforeItems, /subject: editingSubject/, 'la saisie de l’objet doit être fusionnée avant les envois');
  assert.match(beforeItems, /message: editingMessage/, 'la saisie du message doit être fusionnée avant les envois');
  assert.doesNotMatch(body, /generatedMessages\[r\.id\]\.message/, 'les envois étaient construits depuis l’état asynchrone');
  assert.match(body, /message: messages\[r\.id\]\.message/);
});

test('SEQ-022 — fermer avec une saisie non reportée demande confirmation', () => {
  assert.match(bulkInMail, /onOpenChange=\{\(open\) => \{ if \(!open\) requestClose\(\); \}\}/);
  assert.match(bulkInMail, /<AlertDialogTitle>Vos modifications ne sont pas enregistrées<\/AlertDialogTitle>/);
  const requestClose = slice(bulkInMail, 'const requestClose = () => {', 'const discardEditAndClose');
  assert.match(requestClose, /hasUnsavedEdit/);
  assert.match(requestClose, /setConfirmCloseOpen\(true\)/);
});

// ---------------------------------------------------------------- SEQ-032
test('SEQ-032 — première étape A/B : tirage pondéré comme le moteur, jamais la seule variante A', () => {
  const { pickFirstStep } = compatModule;
  const steps = [
    { id: 'A', step_order: 0, variant_group: 'A', variant_weight: 30 },
    { id: 'B', step_order: 0, variant_group: 'B', variant_weight: 70 },
    { id: 'relance', step_order: 1 },
  ];
  assert.deepEqual(pickFirstStep(steps, () => 0.1), { step: steps[0], variantAssigned: 'A' });
  assert.deepEqual(pickFirstStep(steps, () => 0.5), { step: steps[1], variantAssigned: 'B' });
  // Poids absent : 100 comme le moteur.
  const equal = [{ id: 'A', step_order: 2, variant_group: 'A' }, { id: 'B', step_order: 2, variant_group: 'B' }];
  assert.equal(pickFirstStep(equal, () => 0.99).step.id, 'B');
  // Séquence linéaire : la plus petite étape de premier niveau, sans variante.
  const linear = [{ id: 'branche', step_order: 0, branch: 'accepted' }, { id: 'visite', step_order: 1 }, { id: 'msg', step_order: 2 }];
  assert.deepEqual(pickFirstStep(linear), { step: linear[1], variantAssigned: null });
  assert.deepEqual(pickFirstStep([]), { step: null, variantAssigned: null });
});

test('SEQ-032 — les deux inscriptions tirent la première étape par candidat et l’enregistrent', () => {
  for (const [name, source] of [['aperçu', previewModal], ['inscription simple', enrollModal]]) {
    assert.match(source, /const \{ step: firstStep, variantAssigned \} = pickFirstStep\(sequence\.steps\)/, name);
    assert.match(source, /variant_assigned: variantAssigned/, name);
  }
  assert.doesNotMatch(previewModal, /sequence\.steps\.find\(\(s: any\) => \(s\.step_order \?\? s\.stepOrder\) === 0\)/);
  assert.doesNotMatch(enrollModal, /const firstStep = sortedSteps\[0\]/);
});

// ---------------------------------------------------------------- SEQ-043
test('SEQ-043 — un membre sans compte relié ne reçoit jamais le compte d’un collègue', () => {
  assert.doesNotMatch(accountsHook, /if \(!linkedAccountId\) return allAccounts;/);
  assert.match(accountsHook, /if \(!ownLinkedAccountId\) return \[\];/);
  // Présélection : son propre compte d'abord, et pas avant d'avoir les liaisons.
  const effect = slice(accountsHook, 'useEffect(() => {', '}, [accounts');
  assert.match(effect, /!mappingsSettled\) return;/);
  assert.match(effect, /setSelectedAccount\(own\?\.id \|\| okAccount\?\.id/);
});

test('SEQ-043 — le compte d’envoi est affiché et bloque s’il est déconnecté ou à un collègue', () => {
  const notice = read('src/components/outreach/enrollment-preview/SendingAccountNotice.tsx');
  const hook = read('src/components/outreach/enrollment-preview/useSendingAccount.ts');
  assert.match(notice, /Envoyé depuis le compte LinkedIn de <strong/);
  assert.match(hook, /Votre compte LinkedIn est déconnecté\. Reconnectez-le avant d'inscrire des candidats\./);
  assert.match(hook, /else if \(belongsToOtherMember\) blockReason = OTHER_MEMBER_ACCOUNT_MESSAGE;/);
  assert.match(hook, /else if \(health === 'needs_reconnect'\) blockReason = DISCONNECTED_ACCOUNT_MESSAGE;/);
  for (const [name, source] of [['aperçu', previewModal], ['inscription simple', enrollModal]]) {
    assert.match(source, /const sendingAccount = useSendingAccount\(accountId\);/, name);
    assert.match(source, /<SendingAccountNotice state=\{sendingAccount\} \/>/, name);
    assert.match(source, /!!sendingAccount\.blockReason\}/, `${name} : bouton d'inscription désactivé si le compte bloque`);
    assert.match(source, /if \(sendingAccount\.blockReason\) \{\s*toast\.error\(sendingAccount\.blockReason\);\s*return;/, name);
  }
});

// ---------------------------------------------------------------- SEQ-045
test('SEQ-045 — compatibilité : déjà en relation avec invitation = exclu, hors réseau joignable par InMail', () => {
  const { checkProfilesCompat } = compatModule;
  const invite = [{ action_type: 'connection_request', step_order: 0 }, { action_type: 'message', step_order: 1 }];
  const inmail = [{ action_type: 'inmail', step_order: 0 }];
  const res = checkProfilesCompat([
    { id: 'relation', name: 'A', network_distance: 1 },
    { id: 'reseau', name: 'B', network_distance: 'DISTANCE_2' },
  ], invite);
  assert.deepEqual(res.blockers.map(r => r.profile.id), ['relation']);
  assert.match(res.blockers[0].message, /déjà en relation/);
  // Hors réseau : exclu d'une séquence sans InMail, compatible avec un InMail.
  assert.equal(checkProfilesCompat([{ id: 'loin', network_distance: 'OUT_OF_NETWORK' }], invite).blockers.length, 1);
  assert.equal(checkProfilesCompat([{ id: 'loin', network_distance: 'OUT_OF_NETWORK' }], inmail).compatible.length, 1);
});

test('SEQ-045 — l’aperçu d’inscription exclut les incompatibles de l’inscription, de la génération et de l’estimation', () => {
  assert.match(previewModal, /checkProfilesCompat\(profiles, sequence\.steps\)/);
  const active = slice(previewModal, 'const activeProfiles = useMemo(() =>', '});\n');
  assert.match(active, /if \(!includeIncompatible && incompatibleIds\.has\(p\.id\)\) return false;/);
  assert.match(previewModal, /useEnrollmentPreview\(\{ steps, profiles, targetProfiles: activeProfiles, job, accountId \}\)/);
  assert.match(previewModal, /Inclure quand même \(\{compat\.blockers\.length\}\)/);
  // Le hook génère et estime sur les candidats visés, pas sur toute la sélection.
  assert.match(previewHook, /const queue = \[\.\.\.targets\];/);
  assert.match(previewHook, /const estimatedCredits = targets\.length \*/);
});

// ---------------------------------------------------------------- SEQ-046
test('SEQ-046 — anti-doublon : identifiant résolu et slug d’URL publique reconnus', async () => {
  const { findRecentEnrollments } = await loadModule('src/lib/enrollmentDuplicates.ts');
  const filters = [];
  const storedRows = [
    // Inscription faite depuis un compte Recruiter : identifiant AE..., l'identifiant classique résolu à part.
    { profile_id: 'AEMAAABBBB', provider_id: null, resolved_profile_id: 'ACoAAMarie', profile_url: null, created_by: 'u1', created_at: '2026-09-01T10:00:00Z', status: 'active', sequence_id: 's1' },
    // Inscription dont seule l'URL publique concorde.
    { profile_id: 'AEMAAACCCC', provider_id: null, resolved_profile_id: null, profile_url: 'https://www.linkedin.com/in/paul-martin/', created_by: 'u1', created_at: '2026-09-02T10:00:00Z', status: 'completed', sequence_id: 's2' },
  ];
  const builder = (table) => {
    const q = {
      select: () => q, eq: () => q, gte: () => q, in: () => q, order: () => q,
      or: (f) => { filters.push(f); return q; },
      then: (resolve) => resolve({ data: table === 'profiles' ? [{ user_id: 'u1', display_name: 'Claire Dupont' }] : storedRows, error: null }),
    };
    return q;
  };
  const supabase = { from: builder };
  const result = await findRecentEnrollments(supabase, 'org-1', [
    { id: 'ACoAAMarie' },
    { id: 'ACoAAPaul', profile_url: 'linkedin.com/in/Paul-Martin' },
    { id: 'ACoAAAutre', profile_url: 'https://www.linkedin.com/in/paul' },
  ]);
  assert.equal(result.get('ACoAAMarie')?.sequenceId, 's1', 'reconnu par resolved_profile_id');
  assert.equal(result.get('ACoAAPaul')?.sequenceId, 's2', 'reconnu par le slug de l’URL publique');
  assert.equal(result.has('ACoAAAutre'), false, 'un slug voisin (/in/paul) ne doit pas concorder');
  assert.equal(result.get('ACoAAMarie')?.createdByFirstName, 'Claire');
  assert.ok(filters.some(f => /resolved_profile_id\.in\./.test(f)), 'resolved_profile_id doit être interrogé');
  assert.ok(filters.some(f => /profile_url\.ilike\."\*\/in\/paul-martin\*"/.test(f)), 'le slug doit être interrogé par motif');
});

test('SEQ-046 / SEQ-066 — chaque inscription porte provider_id, email_used et phone_used', async () => {
  const { enrollmentRowFields } = await loadModule('src/components/outreach/enrollment-preview/enrollmentRowFields.ts');
  assert.deepEqual(
    enrollmentRowFields({ provider_id: 'ACoAAX', contact_info: { emails: ['  Marie.Dupont@Exemple.FR '], phones: [' +33 6 12 34 56 78 '] } }),
    { provider_id: 'ACoAAX', email_used: 'marie.dupont@exemple.fr', phone_used: '+33 6 12 34 56 78' },
  );
  assert.deepEqual(enrollmentRowFields({}), { provider_id: null, email_used: null, phone_used: null });
  assert.deepEqual(enrollmentRowFields({ contact_info: { emails: [''], phones: [] } }), { provider_id: null, email_used: null, phone_used: null });
  for (const [name, source] of [['aperçu', previewModal], ['inscription simple', enrollModal]]) {
    assert.match(source, /\.\.\.enrollmentRowFields\(profile\),/, `${name} : la ligne d'inscription doit poser les champs de contact`);
  }
});

// ---------------------------------------------------------------- SEQ-047
test('SEQ-047 — pendant l’inscription, la préparation ne se ferme pas et montre la progression', () => {
  const close = slice(previewModal, 'const handleClose = () => {', '};');
  assert.match(close, /if \(isBusy\) return;/);
  assert.match(previewModal, /onEscapeKeyDown=\{\(e\) => \{\s*if \(isBusy \|\| hasPreparedWork\) e\.preventDefault\(\);/);
  assert.match(previewModal, /onInteractOutside=\{\(e\) => e\.preventDefault\(\)\}/);
  // Croix et « Annuler » désactivés.
  assert.ok((previewModal.match(/onClick=\{handleClose\}\s*disabled=\{isBusy\}/g) || []).length >= 2);
  assert.match(previewModal, /onClick=\{onClose\}\s*disabled=\{isBusy\}/);
  assert.match(previewModal, /`Inscription \$\{progress\.done\} sur \$\{progress\.total\}…`/);
  assert.match(previewModal, /setEnrollProgress\(\{ done: index \+ 1, total: enrollSet\.length \}\)/);
  assert.match(previewModal, /Inscription en cours, ne fermez pas cette fenêtre\./);
  // Inscription simple : Échap, clic extérieur et croix ignorés pendant l'écriture.
  assert.match(enrollModal, /if \(!open && !isEnrolling\) handleClose\(\);/);
  assert.match(enrollModal, /onClick=\{handleClose\} disabled=\{isEnrolling\}/);
});

// ---------------------------------------------------------------- SEQ-048
test('SEQ-048 — « Shortlister sans message » écrit organization_id et annonce le nombre réel', () => {
  const body = slice(previewModal, 'const handleShortlist = async () => {', 'const handleClose = () => {');
  assert.match(body, /organization_id: organizationId/);
  assert.match(body, /\.upsert\(rows, \{ onConflict: 'job_id,candidate_id,created_by' \}\)\s*\.select\('candidate_id'\)/);
  assert.match(body, /if \(writeError\) throw writeError;/);
  assert.match(body, /saved = written\?\.length \?\? 0;/);
  assert.match(body, /Ajout impossible : aucun candidat n'a été enregistré\./);
  assert.doesNotMatch(body, /00000000-0000-0000-0000-000000000000/);
  assert.doesNotMatch(body, /count\+\+/);
  // Jamais de rétrogradation d'un candidat contacté ou qui a répondu.
  assert.match(body, /r\.status === 'messaged' \|\| r\.status === 'replied'/);
  // Sur échec total, la fenêtre reste ouverte : onSuccess n'est pas appelé.
  const failure = slice(body, 'if (rows.length > 0 && saved === 0) {', '}');
  assert.doesNotMatch(failure, /onSuccess/);
  assert.match(failure, /return;/);
});

// ---------------------------------------------------------------- SEQ-050
test('SEQ-050 — la préparation est un Dialog Radix plein écran, au-dessus de la fiche profil', () => {
  assert.doesNotMatch(previewModal, /createPortal\(/);
  assert.doesNotMatch(previewModal, /z-\[4000\]/);
  assert.match(previewModal, /<DialogPrimitive\.Content[\s\S]*?className="fixed inset-0 z-\[9999\][^"]*pointer-events-auto/);
  assert.match(previewModal, /<DialogPrimitive\.Title asChild>/);
});

// ---------------------------------------------------------------- SEQ-051
test('SEQ-051 — l’InMail groupé transmet les réglages d’approche de la mission', () => {
  assert.match(bulkInMail, /useMissionOutreachConfig\(selectedJob\?\.id\)/);
  const call = slice(bulkInMail, "invokeEdgeFunction<{ subject?: string; message?: string }>('generate-outreach-message'", '});');
  assert.match(call, /outreachConfig: outreachConfig \|\| undefined/);
  assert.match(call, /\baccountId,/);
  assert.match(call, /senderName: effectiveSenderName/);
  // Pas de génération tant que les réglages sont inconnus (chargement ou échec).
  const generate = slice(bulkInMail, 'const handleGenerateAll = async () => {', 'setIsGenerating(true);');
  assert.match(generate, /missionConfigStatus === 'loading' \|\| missionConfigStatus === 'error'/);
  // Lecture partagée avec l'aperçu de séquence, préfixe « project: » retiré.
  assert.match(previewHook, /export function useMissionOutreachConfig\(/);
  assert.equal(previewHookModule.normalizeMissionJobId('project:6f1c2d3e-0000-4000-8000-000000000001'), '6f1c2d3e-0000-4000-8000-000000000001');
  assert.equal(previewHookModule.normalizeMissionJobId('recNotion123'), 'recNotion123');
  assert.equal(previewHookModule.normalizeMissionJobId(undefined), null);
});

// ---------------------------------------------------------------- SEQ-063
test('SEQ-063 — l’aperçu résout {{city}} et {{sender_name}}, garde {{calendly_link}} pour l’envoi', () => {
  const { resolveVariables } = previewHookModule;
  const profile = { name: 'Marie Dupont', location: 'Lyon, Auvergne-Rhône-Alpes, France' };
  assert.equal(
    resolveVariables('Bonjour {{first_name}}, basée à {{city}} ? {{calendly_link}} {{sender_name}}', profile, 'Laurent'),
    'Bonjour Marie, basée à Lyon ? {{calendly_link}} Laurent',
  );
  // Prénom inconnu : la variable reste, le moteur la remplit à l'envoi.
  assert.equal(resolveVariables('{{sender_name}}', profile), '{{sender_name}}');
  assert.match(previewModal, /Lien d'agenda, ajouté à l'envoi/);
  assert.match(previewModal, /\{renderSendTimeVariables\(\(preview\?\.message \|\| ''\)/);
});

// ---------------------------------------------------------------- Vocabulaire
test('Vocabulaire — « inscrire », jamais « enrôler », dans les textes de l’aperçu', () => {
  const jsxText = previewModal.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(jsxText, />\s*Enrôler /);
  assert.doesNotMatch(jsxText, /Avant d'enrôler/);
  assert.match(previewModal, /Inscrire \{activeProfiles\.length\} candidat/);
});

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
// Lot 5d-1 : rendu des étapes écrites avec les valeurs du serveur (preview_values).
const previewValuesModule = await loadModule('src/hooks/usePreviewValues.ts', {
  react: REACT_STUB,
  '@/lib/invokeEdgeFunction': 'export const invokeEdgeFunction = async () => ({ data: null, error: null });',
});

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
  // Revue design : les raccourcis vivent sur la liste des candidats (listShortcut, D-44), sans génération au clavier.
  assert.match(previewModal, /onKeyDown=\{handleListKeyDown\}/);
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
    // Lot 5a : la case des destinataires (dès 5 candidats) s'ajoute à la condition ;
    // lot 5a-2 : dans l'aperçu, les messages IA manquants aussi.
    assert.match(source, /!!sendingAccount\.blockReason \|\| recipients\.blocked( \|\| aiReviewMissingCount > 0)?\}/, `${name} : bouton d'inscription désactivé si le compte bloque`);
    assert.match(source, /if \(sendingAccount\.blockReason\) \{\s*toast\.error\(sendingAccount\.blockReason\);\s*return;/, name);
  }
});

// ---------------------------------------------------------------- SEQ-045
test('SEQ-045 — compatibilité : déjà en relation avec invitation = averti (invitation sautée), hors réseau joignable par InMail', () => {
  const { checkProfilesCompat } = compatModule;
  const invite = [{ action_type: 'connection_request', step_order: 0 }, { action_type: 'message', step_order: 1 }];
  const inmail = [{ action_type: 'inmail', step_order: 0 }];
  const res = checkProfilesCompat([
    { id: 'relation', name: 'A', network_distance: 1 },
    { id: 'reseau', name: 'B', network_distance: 'DISTANCE_2' },
  ], invite);
  // Vague finale (front-enroll-follow-4) : le moteur saute l'invitation d'une
  // relation directe et envoie la suite (SEQ-036) : avertissement, non bloquant.
  assert.deepEqual(res.blockers, []);
  assert.deepEqual(res.warnings.map(r => r.profile.id), ['relation']);
  assert.match(res.warnings[0].message, /^Déjà en relation : l'invitation sera sautée/);
  // Hors réseau : exclu d'une séquence sans InMail, compatible avec un InMail.
  assert.equal(checkProfilesCompat([{ id: 'loin', network_distance: 'OUT_OF_NETWORK' }], invite).blockers.length, 1);
  assert.equal(checkProfilesCompat([{ id: 'loin', network_distance: 'OUT_OF_NETWORK' }], inmail).compatible.length, 1);
});

test('SEQ-045 — l’aperçu d’inscription exclut les incompatibles de l’inscription, de la génération et de l’estimation', () => {
  assert.match(previewModal, /checkProfilesCompat\(profiles, sequence\.steps\)/);
  const active = slice(previewModal, 'const activeProfiles = useMemo(() =>', '});\n');
  assert.match(active, /if \(!includeIncompatible && incompatibleIds\.has\(p\.id\)\) return false;/);
  // Revue design : la clé de session des aperçus gardés (D-46) complète l'appel ;
  // lot 5d-1 : le rendu des étapes écrites (preview_values) aussi.
  assert.match(previewModal, /useEnrollmentPreview\(\{ steps, profiles, targetProfiles: activeProfiles, job, accountId, sessionKey, writtenText: writtenTextForAi \}\)/);
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
  // RPC find_recent_org_contacts pas encore déployée : repli sur la lecture directe.
  const supabase = { from: builder, rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) };
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
  // Revue design : fenêtre du kit. Échap et la croix passent par onOpenChange, donc
  // par requestClose, qui ne ferme rien pendant une écriture et demande
  // confirmation s'il reste des aperçus ou des délais préparés.
  assert.match(previewModal, /onOpenChange=\{\(open\) => \{ if \(!open\) requestClose\(\); \}\}/);
  const request = slice(previewModal, 'const requestClose = () => {', 'const confirmClose = () => {');
  assert.match(request, /^const requestClose = \(\) => \{\s*if \(isBusy\) return;/);
  assert.match(request, /if \(hasWorkInProgress\) \{\s*setConfirmCloseOpen\(true\);\s*return;\s*\}/);
  assert.match(previewModal, /onInteractOutside=\{\(e\) => e\.preventDefault\(\)\}/);
  // « Annuler » désactivé pendant l'écriture ; un seul pied, commun au résumé et aux aperçus.
  assert.match(previewModal, /onClick=\{requestClose\} disabled=\{isBusy\}/);
  assert.doesNotMatch(slice(previewModal, 'function SummaryMode(', 'function SummaryRow('), /onClose|onEnroll|onShortlist/, 'le résumé n’a plus de bouton qui ferme ou inscrit hors de la garde');
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
  assert.match(body, /\.upsert\(rows, \{ onConflict: 'job_id,candidate_id,created_by' \}\)\s*\.select\('id'\)/);
  assert.match(body, /if \(writeError\) throw writeError;/);
  // Lot 0b-4 (N15) : le nombre annoncé est celui des lignes retenues par la base.
  assert.match(body, /const saved = outcome\.updated \+ outcome\.unchanged;/);
  assert.match(body, /Ajout impossible : aucun candidat n'a été enregistré\./);
  assert.doesNotMatch(body, /00000000-0000-0000-0000-000000000000/);
  assert.doesNotMatch(body, /count\+\+/);
  // Jamais de rétrogradation d'un candidat contacté ou plus loin : plus de statut dans
  // l'upsert, Retenu seulement depuis À trier, Retenu ou Écarté (set_candidate_stages,
  // origine user), et les candidats laissés à leur étape sont annoncés.
  const rowsPayload = slice(body, 'const missingProfiles = activeProfiles', '}));');
  assert.doesNotMatch(rowsPayload, /\bstatus:/);
  // Lignes réelles du candidat dans la mission : clé du Sourcing (job.id, « project:<uuid> »),
  // lignes existantes sous l'une des deux formes reprises, jamais doublées.
  assert.match(rowsPayload, /job_id: job\.id,/);
  assert.match(body, /\.in\('job_id', jobIdForms\)/);
  assert.match(rowsPayload, /activeProfiles\.filter\(profile => !existingCandidates\.has\(profile\.id\)\);\s*const rows = missingProfiles\.map\(profile => \(\{/);
  assert.match(body, /const ids = \[\.\.\.\(existingRows \?\? \[\]\)\.map\(r => r\.id\), \.\.\.written\.map\(r => r\.id\)\];/);
  assert.match(body, /setCandidateStages\(ids, \{ stage: 'retained' \}, RETAIN_FROM_STAGES, \{ surface: 'enrollment' \}\)/);
  assert.match(previewModal, /const RETAIN_FROM_STAGES: GeneralStage\[\] = \['to_sort', 'retained', 'rejected'\];/);
  assert.match(body, /skippedStageMessage\(outcome\.skipped\)/);
  // Sur échec total, la fenêtre reste ouverte : onSuccess n'est pas appelé.
  const failure = slice(body, 'if (saved === 0 && outcome.skipped === 0) {', '}');
  assert.doesNotMatch(failure, /onSuccess/);
  assert.match(failure, /return;/);
});

// ---------------------------------------------------------------- SEQ-050
test('SEQ-050 — la préparation est un Dialog Radix plein écran, au-dessus de la fiche profil', () => {
  assert.doesNotMatch(previewModal, /createPortal\(/);
  assert.doesNotMatch(previewModal, /z-\[4000\]/);
  // Revue design : Dialog Radix du kit, au calque des fenêtres (z-modal) : ouverte
  // après la fiche profil (Sheet du kit, même calque), elle se pose au-dessus.
  // Plein écran sur téléphone, presque plein écran ailleurs, sans calque arbitraire.
  assert.match(previewModal, /import \{ Dialog, DialogContent, DialogDescription, DialogTitle \} from '@\/components\/ui\/dialog';/);
  assert.match(previewModal, /<DialogContent\s+className="flex h-\[calc\(100dvh-2rem\)\] w-\[calc\(100vw-2rem\)\] max-w-6xl[^"]*max-sm:h-\[100dvh\] max-sm:w-screen/);
  assert.doesNotMatch(previewModal, /z-\[\d+\]/);
  assert.match(read('src/components/ui/dialog.tsx'), /fixed left-\[50%\] top-\[50%\] z-modal/);
  // Nom de la fenêtre : le titre du kit, que lisent les parcours e2e.
  assert.match(previewModal, /<DialogTitle className="truncate">\{sequence\.name\}<\/DialogTitle>/);
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
  // Lot 5d-1 : resolveVariables est retiré. Les valeurs viennent du serveur
  // (preview_values : contexte du moteur, alias city de la variable ville,
  // sender_name = prénom de l'expéditeur, lien d'agenda de la mission) et le
  // navigateur rend le texte comme le moteur.
  assert.equal(previewHookModule.resolveVariables, undefined, 'plus de rendu deviné dans le navigateur');
  const { previewDisplayText, previewEditableText, KEPT_FOR_SEND_KEYS } = previewValuesModule;
  const values = {
    prenom: 'Marie', first_name: 'Marie', ville: 'Lyon', city: 'Lyon', mon_prenom: 'Laurent', sender_name: 'Laurent',
    lien_calendly: 'https://agenda.example/laurent', calendly_link: 'https://agenda.example/laurent',
  };
  const sendTime = { salutation: '[Bonjour ou Bonsoir, selon l’heure d’envoi]' };
  const template = '{{salutation}} {{first_name}}, basée à {{city}} ? {{calendly_link}} {{sender_name}}';
  // Affiché : le texte qui partira, la salutation de l'heure d'envoi annoncée entre crochets.
  assert.equal(
    previewDisplayText(template, values, sendTime),
    '[Bonjour ou Bonsoir, selon l’heure d’envoi] Marie, basée à Lyon ? https://agenda.example/laurent Laurent',
  );
  // Texte de départ d'une retouche : salutation et lien d'agenda gardés, le moteur les remplit à l'envoi.
  assert.equal(
    previewEditableText(template, values, [...Object.keys(sendTime), ...KEPT_FOR_SEND_KEYS]),
    '{{salutation}} Marie, basée à Lyon ? {{calendly_link}} Laurent',
  );
  // Prénom de l'expéditeur inconnu : la variable est retirée, comme à l'envoi.
  assert.equal(previewDisplayText('Merci {{sender_name}}.', {}, sendTime), 'Merci.');
  assert.match(previewModal, /Lien d'agenda, ajouté à l'envoi/);
  // Lot 5d-1 : la note d'invitation retouchée est coupée comme le moteur (shownText) avant la pastille d'agenda.
  assert.match(previewModal, /\{renderSendTimeVariables\(shownText\(step\.actionType, \(preview\?\.message \|\| ''\)/);
});

// ---------------------------------------------------------------- Vocabulaire
test('Vocabulaire — « inscrire », jamais « enrôler », dans les textes de l’aperçu', () => {
  const jsxText = previewModal.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(jsxText, />\s*Enrôler /);
  assert.doesNotMatch(jsxText, /Avant d'enrôler/);
  // Revue design : pluriel partagé (D-71), même texte affiché (« Inscrire 2 candidats »).
  assert.match(previewModal, /`Inscrire \$\{plural\(activeProfiles\.length, 'candidat'\)\}`/);
});

/**
 * Refonte mission, lot 5f-2c : conteneur ContactFlow, ses lectures et la sortie
 * d'inscription (src/components/sequences/contact/).
 *
 * - Gardes de source : ContactFlow n'écrit que par enrollCandidates (mode groupé,
 *   horaires d'envoi), jamais une inscription, une exécution ni une étape de
 *   candidat ; case des destinataires en garde ; hooks avant les retours
 *   anticipés ; anti-doublon obligatoire ; « Relire les messages » par la fenêtre
 *   de préparation ; textes (français, sans tiret long ni « (s) », sans nom de
 *   prestataire) et composants du kit.
 * - Comportement : toFlowSteps rend ce que rend mapSteps de EnrollmentPreviewModal
 *   (la fonction de la fenêtre est lue dans son source et exécutée), flowSequenceInfo
 *   range les étapes, announceEnrollOutcome parle comme les fenêtres d'inscription
 *   (succès nommé avec « Ouvrir la séquence », sans « Annuler »).
 *
 * Les modules sont transpilés par esbuild (alias « @/ » résolu dans src/) ; sans
 * esbuild, seules les gardes de source tournent.
 *
 * Lancer : node --test tests/ux/lot5f2c-ecran.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Sans commentaires : les gardes de code lisent le code. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const EM_DASH = String.fromCharCode(0x2014);

let esbuild = null;
try {
  esbuild = await import('esbuild');
} catch {
  esbuild = null;
}

let ts = null;
try {
  ts = (await import('typescript')).default;
} catch {
  ts = null;
}

/** Textes que la personne peut lire : texte JSX, phrases entre guillemets (hors imports). */
function visibleTexts(rel) {
  const file = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (text) out.push(text);
    } else if (
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
    ) {
      if (/\s/.test(node.text) && /[A-Za-zÀ-ÿ]/.test(node.text)) out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/** Transpile un module TypeScript et le charge ; « @/ » est résolu dans src/, sauf `stubs`. */
async function loadBundled(rel, stubs = {}) {
  const resolveSrc = (spec) => {
    const base = path.join(ROOT, 'src', spec.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`module introuvable : ${spec}`);
  };
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, rel)],
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

// Ce que les modules lus par useEnrollmentPreview.ts et useSendingAccount.ts demandent à React et au navigateur.
const HOOK_STUBS = {
  react: 'export const useState = (i) => [typeof i === "function" ? i() : i, () => {}]; export const useCallback = (f) => f; export const useRef = (v) => ({ current: v }); export const useEffect = () => {}; export const useMemo = (f) => f(); export default {};',
  '@/lib/invokeWithCredits': 'export const invokeWithCredits = async () => ({ data: null, error: null }); export const estimateActionCredits = () => 1;',
  '@/integrations/supabase/client': 'export const supabase = {};',
  '@/hooks/useAuthReady': 'export const useAuthReady = () => ({ user: null });',
  '@/contexts/LinkedInAccountsContext': 'export const useLinkedInAccounts = () => ({ accounts: [] });',
  '@/hooks/useMemberLinkedInAccounts': 'export const useMemberLinkedInAccounts = () => ({ getMappingForAccount: () => null });',
  '@/lib/linkedinStatus': 'export const classifyLinkedInStatus = () => "connected";',
};

const DIR = 'src/components/sequences/contact';
const FLOW = `${DIR}/ContactFlow.tsx`;
const SEQUENCES = `${DIR}/useContactSequences.ts`;
const STEPS = `${DIR}/useSequenceSteps.ts`;
const ELIGIBILITY = `${DIR}/useContactEligibility.ts`;
const ANNOUNCE = `${DIR}/announceEnrollOutcome.ts`;
const FLOW_STEPS = `${DIR}/flowSteps.ts`;
const MY_FILES = [FLOW, SEQUENCES, STEPS, ELIGIBILITY, ANNOUNCE, FLOW_STEPS];

function between(source, from, to) {
  const a = source.indexOf(from);
  assert.ok(a >= 0, `« ${from} » introuvable`);
  const b = source.indexOf(to, a + from.length);
  assert.ok(b > a, `« ${to} » introuvable après « ${from} »`);
  return source.slice(a, b);
}

const flow = read(FLOW);
const flowCode = code(flow);

// ─── Écritures : seulement enrollCandidates ─────────────────────────────────

test('5F2C-E1 aucune écriture d\'inscription, d\'exécution ni d\'étape de candidat', () => {
  for (const rel of MY_FILES) {
    const src = code(read(rel));
    assert.doesNotMatch(src, /sequence_enrollments|sequence_step_executions|job_candidate_status|mission_candidate_rows/, `${rel} ne touche pas ces tables`);
    assert.doesNotMatch(src, /\.from\([^)]*\)[\s\S]{0,300}?\.(insert|upsert|delete|update)\(/, `${rel} n'écrit dans aucune table`);
    assert.doesNotMatch(src, /\.rpc\(/, `${rel} n'appelle aucune fonction de la base`);
    assert.doesNotMatch(src, /retainCandidates\(|setCandidateStages?\(|set_candidate_stage|pipeline_stage/, `${rel} ne pose aucune étape`);
  }
});

test('5F2C-E2 l\'inscription passe par enrollCandidates : mode groupé, horaires d\'envoi', () => {
  assert.equal((flowCode.match(/await enrollCandidates\(/g) ?? []).length, 1, 'un seul appel');
  const call = between(flowCode, 'await enrollCandidates({', '});');
  assert.match(call, /mode: 'batch'/);
  assert.match(call, /firstStepTiming: 'business_hours'/);
  assert.doesNotMatch(flowCode, /mode: 'one_by_one'|messageOverridesFor|stepConfigOverrides/);
  assert.match(call, /sequence: \{ id: selected\.id, steps: rawSteps \}/, 'lignes brutes snake_case');
  assert.match(call, /recentEnrollments: recentMap/, 'anti-doublon déjà lu, jamais null');
  assert.match(call, /allProfiles: candidates\.map\(\(candidate\) => candidate\.profile\)/);
  assert.match(call, /candidates: readyProfiles/);
  assert.match(call, /allowDuplicates: ready\.some\(\(entry\) => entry\.overridden && entry\.reason === 'recent_contact'\)/);
  assert.match(call, /noCandidatesMessage: 'Aucun candidat à inscrire'/);
  assert.match(flowCode, /const readyProfiles = ready\.map\(\(entry\) => entry\.source\.profile\);/);
});

test('5F2C-E3 handleEnroll : case des destinataires en tête, comptes et anti-doublon avant l\'écriture', () => {
  const body = between(flowCode, 'const handleEnroll = async () => {', 'const openReview = ');
  assert.match(body, /^const handleEnroll = async \(\) => \{\s*if \(recipients\.blocked\) return;/, '`if (recipients.blocked) return;` en tête');
  assert.match(body, /if \(enrollingRef\.current\) return;/, 'pas de double envoi');
  assert.match(body, /Votre organisation n'a pas pu être identifiée/);
  assert.match(body, /NO_LINKEDIN_ACCOUNT_TITLE, \{ description: NO_LINKEDIN_ACCOUNT_DESCRIPTION \}/);
  assert.match(body, /if \(sendingAccount\.blockReason\) \{\s*toast\.error\(sendingAccount\.blockReason\);/);
  assert.match(body, /!recentMap\) return;/, 'jamais d\'inscription sans l\'anti-doublon lu');
  assert.ok(body.indexOf('recipients.blocked') < body.indexOf('await enrollCandidates('));
  // Après l'écriture : annonce, invalidations, puis sortie des lignes inscrites.
  assert.match(body, /announceEnrollOutcome\(outcome, \{/);
  assert.match(body, /if \(outcome\.results\.success > 0\) void invalidateMissionContacted\(queryClient\);/);
  assert.match(body, /if \(outcome\.retained && outcome\.retained\.saved > 0\) void invalidateStageReaders\(queryClient\);/);
  assert.match(body, /new Set\(outcome\.enrolledIds\)/);
  assert.match(body, /candidate\.rowId/);
  assert.match(body, /onEnrolled\(handledRowIds\)/);
  assert.match(body, /retryEligibility\(\);/, 'refusée, en échec ou rien d\'inscrit : les lectures sont rafraîchies');
});

test('5F2C-E4 le bouton Inscrire se désactive tant que l\'inscription n\'est pas permise', () => {
  const disabled = between(flowCode, 'const enrollDisabled = ', ';\n');
  for (const condition of ['enrolling', 'ready.length === 0', '!stepsReady', '!eligibilityReady', 'sendingAccount.blockReason', 'recipients.blocked']) {
    assert.ok(disabled.includes(condition), `désactivé sur « ${condition} »`);
  }
  assert.match(flowCode, /const eligibilityReady = eligibility\.status === 'ready' && !!recentMap;/);
  assert.match(flowCode, /`Inscrire \$\{plural\(ready\.length, 'candidat'\)\}`/);
  assert.match(flowCode, /useRecipientsConfirm\(readyIds, \{ aiReview: false \}\)/);
  const confirm = between(flowCode, '<RecipientsConfirm', '/>');
  assert.match(confirm, /count=\{ready\.length\}/);
  assert.doesNotMatch(confirm, /preview=/, 'l\'aperçu est déjà au-dessus');
});

// ─── Séquence à message IA : « Relire les messages » ────────────────────────

test('5F2C-E5 « Relire les messages » ouvre la fenêtre de préparation ; une séquence à message IA n\'a pas d\'« Inscrire »', () => {
  assert.match(flowCode, /import \{ EnrollmentPreviewModal \} from '@\/components\/outreach\/EnrollmentPreviewModal';/);
  const modal = between(flowCode, '<EnrollmentPreviewModal', '/>');
  assert.match(modal, /sequence=\{review\.sequence\}/);
  assert.match(modal, /profiles=\{review\.profiles\}/);
  assert.match(modal, /accountId=\{accountId\}/);
  assert.match(modal, /job=\{job\}/);
  assert.match(modal, /onSuccess=/);
  // Candidats montrés : les prêts et ceux dont seul le message IA reste à relire.
  assert.match(flowCode, /entry\.reason === 'ai_review'/);
  // Séquence à message IA : « Relire les messages (N) » est le bouton plein, sans « Inscrire ».
  const footer = between(flowCode, '{info.aiReview ? (', '</div>\n        </div>\n      )}');
  const aiBranch = footer.slice(0, footer.indexOf(') : ('));
  assert.match(aiBranch, /variant="primary"/);
  assert.match(aiBranch, /`Relire les messages \(\$\{reviewProfiles\.length\}\)`/);
  assert.doesNotMatch(aiBranch, /Inscrire/);
  const plainBranch = footer.slice(footer.indexOf(') : ('));
  assert.match(plainBranch, /variant="outline"[\s\S]*Relire les messages/);
  assert.match(plainBranch, /variant="primary"[\s\S]*Inscrire/);
  // Un seul plein par zone : les deux sont dans des branches exclusives.
  assert.equal((flowCode.match(/variant="primary"/g) ?? []).length, 2);
  // Pas d'inscription depuis ce composant pour la fenêtre : il relit ce qui est entré dans la séquence.
  assert.match(flowCode, /findBlockingSequenceEnrollments\(supabase, done\.sequence\.id, done\.profiles\)/);
});

test('5F2C-E6 l\'anti-doublon en échec bloque l\'inscription avec « Réessayer »', () => {
  assert.match(flowCode, /DUPLICATE_CHECK_FAILED_MESSAGE,?\n/, 'importé de enrollmentHelpers');
  assert.match(flowCode, /\{DUPLICATE_CHECK_FAILED_MESSAGE\}/);
  const errorBranch = between(flowCode, "eligibility.status === 'error'", '} else {');
  assert.match(errorBranch, /onClick=\{retryEligibility\}/);
  assert.match(errorBranch, /Réessayer/);
});

// ─── Structure : hooks, portes, textes ──────────────────────────────────────

test('5F2C-E7 tous les hooks sont appelés avant le moindre retour anticipé', () => {
  const body = flowCode.slice(flowCode.indexOf('export function ContactFlow('));
  // Les portes, dans l'ordre : formule, candidats (chargement, échec), liste vide, compte d'envoi.
  const gates = [
    'if (!canSendSequences)',
    "if (candidatesStatus === 'loading')",
    "if (candidatesStatus === 'error')",
    'if (candidates.length === 0)',
    'if (!accountId) {\n    if (accountsLoading)',
  ].map((needle) => body.indexOf(needle));
  assert.ok(gates.every((index) => index >= 0), 'cinq portes');
  assert.deepEqual([...gates].sort((a, b) => a - b), gates, 'ordre des portes');
  // Aucun hook après la première porte (donc aucun retour anticipé avant le dernier hook).
  const hooks = [...body.matchAll(/\buse[A-Z]\w*\(/g)].map((m) => m.index);
  assert.ok(hooks.length >= 15, 'les hooks du composant');
  assert.ok(Math.max(...hooks) < gates[0], 'tous les hooks précèdent la première porte');
  // Pas de retour anticipé avant la première porte, hors rappels des effets et des gestes.
  const beforeGates = body.slice(0, gates[0]);
  assert.doesNotMatch(beforeGates, /^  (if \(.*\) )?return\b/m, 'aucun retour au niveau du composant avant les hooks');
});

test('5F2C-E8 textes des portes et du panneau', () => {
  for (const text of [
    'SEQUENCES_PLAN_REQUIRED_MESSAGE',
    "Les candidats sélectionnés n'ont pas pu être chargés.",
    'Aucun candidat sélectionné.',
    'Cochez des candidats dans la liste, puis « Contacter ».',
    'Voir les contactés',
    'Reliez votre compte LinkedIn pour contacter.',
    'Relier LinkedIn',
    'Envoyé depuis les comptes de la rotation de la séquence.',
    "Plafond LinkedIn indisponible pour l'instant.",
    "Message rédigé par l'IA Konekt pour chaque candidat : relisez-les avant l'inscription.",
    'Aucun message écrit.',
    "candidats au plus par inscription",
  ]) {
    assert.ok(flow.includes(text), `texte « ${text} » présent`);
  }
  assert.match(flowCode, /<UpgradePrompt title="Séquences" description=\{SEQUENCES_PLAN_REQUIRED_MESSAGE\} \/>/);
  assert.match(flowCode, /`Contacter \$\{plural\(candidates\.length, 'candidat'\)\}`/);
  assert.match(flowCode, /const CONTACT_FLOW_MAX = 400;/);
  assert.match(flowCode, /to="\/settings\/account\/connections"/);
  // « Ouvrir la séquence » : onglet des candidats de la page de la séquence, depuis la mission.
  assert.match(flowCode, /navigate\(`\$\{sequencePath\(selectedId, missionId\)\}&onglet=candidats`\)/);
  assert.doesNotMatch(flowCode, /['"`]\/sequences/, 'aucun littéral /sequences');
});

test('5F2C-E9 aperçu : candidat courant d\'abord, puis balayage de tous, un paquet de 20 à la fois', () => {
  assert.match(flowCode, /const SWEEP_PACKET = 20;/);
  const sweep = between(flowCode, 'const sweepProfiles = useMemo(', 'const quota = useLinkedInQuotaStatus(');
  assert.match(sweep, /candidate\.hasLinkedIn/, 'seuls les profils avec un lien LinkedIn');
  assert.match(sweep, /for \(let from = 0; from < sweepProfiles\.length; from \+= SWEEP_PACKET\)/);
  assert.match(sweep, /await requestPreviewValues\(sweepProfiles\.slice\(from, from \+ SWEEP_PACKET\)\);/, 'un paquet à la fois');
  assert.match(sweep, /catch \(err\)/, 'un paquet en échec n\'arrête pas le balayage');
  assert.match(sweep, /let cancelled = false;[\s\S]*if \(cancelled\) return;[\s\S]*cancelled = true;/, 'annulable');
  // Le candidat courant avant le balayage.
  assert.ok(flowCode.indexOf('void requestPreviewValues([previewProfile]);') < flowCode.indexOf('const sweepProfiles = useMemo('));
  // Mêmes clés pour toute la vie de la séquence : memo stable.
  assert.match(flowCode, /const previewKeys = useMemo\(\s*\(\) => templateKeys\(steps\.flatMap/);
  // Les effacés viennent de l'aperçu (cas non réessayable du serveur).
  assert.match(flowCode, /entry\?\.status === 'unavailable' && !entry\.retryable/);
  // Navigation ‹ › parmi les prêts.
  const preview = between(flowCode, '<FirstMessagePreviewBlock', '/>');
  assert.match(preview, /total: ready\.length/);
  assert.match(preview, /onPrevious: \(\) => goToPreview\(previewPosition - 1\)/);
  assert.match(preview, /onNext: \(\) => goToPreview\(previewPosition \+ 1\)/);
});

test('5F2C-E10 jauge : première étape par pickFirstStep, chiffres de get_linkedin_quota_status, estimation honnête', () => {
  assert.match(flowCode, /pickFirstStep\(rawSteps, \(\) => 0\)\.step \?\? null/);
  const gauge = between(flowCode, 'const gauge = useMemo(', 'const quotaUnavailable');
  for (const field of ['usedToday: quotaStatus.today.visible_actions', 'capToday: quotaStatus.caps.visible_actions', 'usedWeekInvitations: quotaStatus.week.invitations', 'capWeekInvitations: quotaStatus.caps.weekly_invitations']) {
    assert.ok(gauge.includes(field), field);
  }
  assert.match(flowCode, /\{gauge && <QuotaGauge model=\{gauge\} \/>\}/);
  // Pas de jauge quand elle mentirait : rotation d'expéditeurs (autre compte), première étape reportée d'un jour ou plus.
  assert.match(flowCode, /const gaugeApplies = !rotation && !firstStepLater && gaugeKindOf\(firstStepType\) !== null;/);
  assert.match(flowCode, /useLinkedInQuotaStatus\(gaugeApplies \? accountId : null\)/);
  assert.match(flowCode, />= 1440/);
  // Les candidats comptés sont ceux que l'inscription vise (messages IA compris), sans les déjà en relation pour une invitation.
  const count = between(flowCode, 'const gaugeCount = useMemo(', 'const quotaStatus');
  assert.match(count, /reviewProfiles\.filter\(/);
  assert.match(count, /connection_already_connected/);
});

// ─── Lectures ───────────────────────────────────────────────────────────────

test('5F2C-L1 séquences : requête du menu « Séquence » plus auteur et rotation, relue au retour sur la fenêtre', () => {
  const src = code(read(SEQUENCES));
  assert.match(src, /\.from\('outreach_sequences'\)/);
  assert.match(src, /\.select\('id, name, is_active, created_at, project_id, created_by, multi_sender_enabled, sender_accounts, sequence_steps\(count\)'\)/);
  assert.match(src, /\.eq\('is_active', true\)/);
  assert.match(src, /\.order\('created_at', \{ ascending: false \}\)/);
  assert.match(src, /queryKey: \[CONTACT_SEQUENCES_KEY, organizationId, missionId\]/);
  assert.match(src, /refetchOnMount: 'always'/);
  assert.match(src, /refetchOnWindowFocus: true/);
  assert.match(src, /staleTime: 0/);
  assert.match(src, /stepCount: counts\?\.\[0\]\?\.count \?\? 0/);
  assert.doesNotMatch(src, /organization_id'?\)?,? ?[a-zA-Z]/, 'aucun filtre d\'organisation : la RLS borne');
  assert.doesNotMatch(src, /\.eq\('organization_id'/);
});

test('5F2C-L2 étapes : lignes brutes snake_case dans l\'ordre, relues au retour sur la fenêtre', () => {
  const src = code(read(STEPS));
  assert.match(src, /\.from\('sequence_steps'\)\s*\.select\('\*'\)\s*\.eq\('sequence_id', sequenceId as string\)\s*\.order\('step_order', \{ ascending: true \}\)/);
  assert.match(src, /refetchOnMount: 'always'/);
  assert.match(src, /refetchOnWindowFocus: true/);
  assert.match(src, /enabled: !!sequenceId/);
  assert.match(src, /export type SequenceStepRow = Database\['public'\]\['Tables'\]\['sequence_steps'\]\['Row'\];/);
});

test('5F2C-L3 éligibilité : anti-doublon, déjà dans la séquence, compatibilité ; lecture en échec = erreur', () => {
  const src = code(read(ELIGIBILITY));
  assert.match(src, /findBlockingSequenceEnrollments\(supabase, sequenceId as string, profiles\)/);
  assert.match(src, /findRecentEnrollments\(supabase, organizationId as string, profiles\)/);
  assert.match(src, /formatRecentContactLabel\(entry\)/);
  assert.match(src, /checkProfilesCompat\(profiles, \[\.\.\.rawSteps\]\)/);
  assert.match(src, /classifyExistingEnrollment\(entry\.status\)/);
  // Seuls les candidats avec un lien LinkedIn sont vérifiés.
  assert.match(src, /candidates\.filter\(\(candidate\) => candidate\.hasLinkedIn\)/);
  // Blocages : hors réseau et invitation seule ; avertissements : invitation sautée et InMail inutile.
  assert.match(src, /blocker\.issue === 'too_far' \|\| blocker\.issue === 'connection_only_already_connected'/);
  assert.match(src, /warning\.issue === 'connection_already_connected' \|\| warning\.issue === 'inmail_wasted'/);
  assert.match(src, /query\.isError \|\| query\.fetchStatus === 'paused'\) status = 'error'/);
  assert.match(src, /staleTime: 0/);
  assert.match(src, /queryKey: \[CONTACT_ELIGIBILITY_KEY, organizationId, sequenceId, signature\]/);
  assert.doesNotMatch(src, /usePreviewValues|previewEntryOf|erasedKey/, 'les effacés ne viennent pas d\'ici');
});

// ─── Hygiène des textes et du kit ───────────────────────────────────────────

test('5F2C-H1 aucun tiret long, aucun « (s) », aucun nom de prestataire, aucun mot de jargon anglais visible', () => {
  for (const rel of [...MY_FILES, 'tests/ux/lot5f2c-ecran.test.mjs']) {
    const raw = read(rel);
    assert.ok(!raw.includes(EM_DASH), `${rel} : aucun tiret long, commentaires compris`);
    assert.doesNotMatch(raw, /[A-Za-zÀ-ÿ]\(s\)/, `${rel} : aucun « (s) » collé à un mot`);
  }
  for (const rel of MY_FILES) {
    const src = code(read(rel));
    assert.doesNotMatch(src, /\b(Unipile|Apollo|People Data Labs|PDL|Anthropic|Claude|Notion|Resend|Brandfetch)\b/, `${rel} : aucun nom de prestataire`);
  }
  // Textes visibles (JSX et phrases) du composant et des annonces, lus par l'analyseur TypeScript.
  if (!ts) return;
  for (const rel of [FLOW, ANNOUNCE]) {
    const visible = visibleTexts(rel).join('\n');
    assert.ok(visible.length > 100, `${rel} : textes lus`);
    assert.doesNotMatch(visible, /\b(step|steps|preview|enrollment|enrollments|template|sender|batch|workflow)\b/i, `${rel} : pas de jargon anglais`);
    assert.doesNotMatch(visible, /\b(Unipile|Apollo|PDL|Anthropic|Claude|Notion)\b/, `${rel} : pas de nom de prestataire`);
    assert.doesNotMatch(visible, /Annuler/, `${rel} : aucun « Annuler »`);
    assert.doesNotMatch(visible, /\b(tu|ton|ta|tes|toi)\b/i, `${rel} : vouvoiement`);
  }
});

test('5F2C-H2 composants du kit, pluriels par plural, aucun any, aucune couleur ni taille arbitraire', () => {
  for (const rel of MY_FILES) {
    const src = code(read(rel));
    assert.doesNotMatch(src, /<button\b|<input\b|<select\b|<textarea\b/, `${rel} : pas de balise brute`);
    assert.doesNotMatch(src, /(?:const plural\b|function plural\b)/, `${rel} : pas de plural local`);
    assert.doesNotMatch(src, /:\s*any\b|<any>|\bas any\b|@ts-ignore|@ts-expect-error/, `${rel} : aucun any ni commentaire TS`);
    assert.doesNotMatch(src, /text-\[\d|z-\[\d|ring-\[3px\]|-\[#|bg-gradient/, `${rel} : valeurs arbitraires`);
    assert.doesNotMatch(src, /(bg|text|border|ring)-(red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose|slate|gray|zinc|neutral|stone)-\d/, `${rel} : jetons seulement`);
    assert.doesNotMatch(src, /window\.confirm|trackEvent|localStorage/, `${rel} : ni confirm, ni suivi, ni stockage local`);
  }
  assert.match(flowCode, /import \{ plural \} from '@\/lib\/plural';/);
  assert.match(flowCode, /import \{ Button \} from '@\/components\/ui\/button';/);
  assert.match(code(read(ANNOUNCE)), /import \{ plural \} from '@\/lib\/plural';/);
  // Cibles de 44 px sur téléphone.
  assert.match(flowCode, /const TOUCH = 'max-lg:min-h-11';/);
  // Aucune icône grise ni voilée : le composant n'en pose aucune.
  assert.doesNotMatch(flowCode, /lucide-react/);
  // Dépendances d'effet complètes : aucune désactivation de la règle.
  assert.doesNotMatch(flow, /eslint-disable/);
});

// ─── Comportement : toFlowSteps, flowSequenceInfo ───────────────────────────

test('5F2C-C1 toFlowSteps rend ce que rend mapSteps de la fenêtre d\'inscription, champ par champ', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const modalSrc = read('src/components/outreach/EnrollmentPreviewModal.tsx');
  const fnSrc = between(modalSrc, 'function mapSteps(', '\n}\n') + '\n}\n';
  const mapSteps = new Function(`${esbuild.transformSync(fnSrc, { loader: 'ts' }).code}\nreturn mapSteps;`)();
  const { toFlowSteps } = await loadBundled(FLOW_STEPS, HOOK_STUBS);

  const snake = {
    id: 'a', step_order: 2, action_type: 'message', step_channel: 'linkedin', message_template: 'Bonjour {{prenom}}', subject_template: '',
    use_ai_personalization: false, ai_tone: null, delay_days: 1, delay_hours: 2, delay_minutes: null, timeout_days: 3,
    timeout_branch_step_id: 'x', parent_step_id: 'p', branch: 'yes', if_true_goto_step: 't', if_false_goto_step: 'f',
    next_step_id: 'n', variant_group: 'A', ends_sequence: true,
  };
  const camel = {
    id: 'b', stepOrder: 1, actionType: 'inmail', channel: 'linkedin', messageTemplate: 'Salut', subjectTemplate: 'Objet',
    useAiPersonalization: true, aiTone: 'casual', delayDays: 4, delayHours: 5, delayMinutes: 6, condition: 'c', timeoutDays: 7,
    timeoutBranchStepId: 'y', parentStepId: 'q', branch: 'no', ifTrueGotoStep: 'tt', ifFalseGotoStep: 'ff', nextStepId: 'nn',
    variantGroup: 'B', endsSequence: false,
  };
  const bare = { id: 'c' };
  const empties = { id: 'd', step_order: 0, action_type: '', message_template: '', variant_group: null, ends_sequence: null, delay_days: 0 };
  for (const fixture of [[snake], [camel], [bare], [empties], [snake, camel, bare, empties]]) {
    assert.deepEqual(toFlowSteps(fixture), mapSteps(fixture), JSON.stringify(fixture.map((s) => s.id)));
  }
  // Tri par ordre d'étape.
  assert.deepEqual(toFlowSteps([snake, camel, empties]).map((s) => s.stepId), ['d', 'b', 'a']);
  // Les mêmes champs que la fenêtre (liste lue dans son source).
  const fieldNames = [...between(fnSrc, 'rawSteps.map(', '})).sort').matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
  assert.ok(fieldNames.length >= 20);
  assert.deepEqual(Object.keys(toFlowSteps([bare])[0]), fieldNames);
});

test('5F2C-C2 flowSequenceInfo : messages, relecture IA, textes écrits', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const { toFlowSteps, flowSequenceInfo, isPreviewedMessageStep } = await loadBundled(FLOW_STEPS, HOOK_STUBS);
  const compat = await loadBundled('src/lib/sequenceCompatibility.ts');
  const info = (...rows) => flowSequenceInfo(toFlowSteps(rows.map((row, i) => ({ id: `s${i}`, step_order: i, ...row }))));

  // Invitation avec note, puis message écrit.
  let result = info(
    { action_type: 'connection_request', message_template: 'Bonjour' },
    { action_type: 'message', message_template: 'Suite' },
  );
  assert.equal(result.messageSteps.length, 2);
  assert.equal(result.aiReview, false);
  assert.equal(result.hasWrittenSteps, true);

  // Message rédigé par l'IA, même sans modèle : relecture obligatoire, aucun texte écrit.
  result = info({ action_type: 'message', use_ai_personalization: true });
  assert.equal(result.messageSteps.length, 1);
  assert.equal(result.aiReview, true);
  assert.equal(result.hasWrittenSteps, false);

  // Une étape écrite et une étape IA : relecture obligatoire, texte écrit présent.
  result = info(
    { action_type: 'message', message_template: 'Bonjour' },
    { action_type: 'inmail', use_ai_personalization: true },
  );
  assert.equal(result.aiReview, true);
  assert.equal(result.hasWrittenSteps, true);

  // Une invitation sans note n'est pas un message (même rédigée par l'IA).
  result = info({ action_type: 'connection_request', use_ai_personalization: true }, { action_type: 'profile_visit' });
  assert.equal(result.messageSteps.length, 0);
  assert.equal(result.aiReview, false);
  assert.equal(result.hasWrittenSteps, false);

  // Une invitation avec note rédigée par l'IA reste un texte écrit, sans relecture.
  result = info({ action_type: 'connection_request', message_template: 'Note', use_ai_personalization: true });
  assert.equal(result.aiReview, false);
  assert.equal(result.hasWrittenSteps, true);

  // Un canal fermé est sauté par le moteur : ni message, ni relecture.
  if (compat.CLOSED_CHANNEL_ACTION_TYPES.includes('email')) {
    result = info({ action_type: 'email', message_template: 'Bonjour', use_ai_personalization: true });
    assert.equal(result.messageSteps.length, 0);
    assert.equal(result.aiReview, false);
  }
  const step = toFlowSteps([{ id: 'x', action_type: 'message', message_template: 'Bonjour' }])[0];
  assert.equal(isPreviewedMessageStep(step), true);
  assert.equal(isPreviewedMessageStep({ ...step, messageTemplate: '' }), false);
});

// ─── Comportement : announceEnrollOutcome ───────────────────────────────────

/** Toaster enregistreur : chaque appel garde son type, son titre et ses options. */
function recorder() {
  const calls = [];
  const make = (kind) => (title, options) => { calls.push({ kind, title, options }); };
  const fake = Object.assign(make('message'), {
    success: make('success'), error: make('error'), warning: make('warning'), info: make('info'),
  });
  return { fake, calls };
}

const emptyResults = (extra = {}) => ({
  success: 0, skipped: 0, alreadyPassed: 0, gdprErased: [], samePerson: [], formerPassages: 0, errors: [], ...extra,
});
const done = (results, extra = {}) => ({
  status: 'done', results, enrolledIds: [], recentEnrollments: new Map(), ...extra,
});

test('5F2C-A1 succès nommé, avec « Ouvrir la séquence » et sans « Annuler »', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const { announceEnrollOutcome } = await loadBundled(ANNOUNCE, HOOK_STUBS);
  const { calls, fake } = recorder();
  let opened = 0;
  const ctx = { sequenceName: 'Approche', firstAction: "Première action : Invitation LinkedIn, dès maintenant pendant vos heures d'envoi", onOpenSequence: () => { opened += 1; }, toast: fake };

  announceEnrollOutcome(done(emptyResults({ success: 3 })), ctx);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'success');
  assert.equal(calls[0].title, '3 candidats inscrits dans la séquence « Approche »');
  assert.equal(calls[0].options.description, ctx.firstAction);
  assert.equal(calls[0].options.action.label, 'Ouvrir la séquence');
  calls[0].options.action.onClick();
  assert.equal(opened, 1);
  assert.deepEqual(Object.keys(calls[0].options).sort(), ['action', 'description']);
  assert.ok(!JSON.stringify(calls).includes('Annuler'));

  calls.length = 0;
  announceEnrollOutcome(done(emptyResults({ success: 1 })), { ...ctx, firstAction: null });
  assert.equal(calls[0].title, '1 candidat inscrit dans la séquence « Approche »');
  assert.equal(calls[0].options.description, undefined);
});

test('5F2C-A2 refus, échec et planification en échec', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const { announceEnrollOutcome } = await loadBundled(ANNOUNCE, HOOK_STUBS);
  const helpers = await loadBundled('src/components/outreach/enrollment-preview/enrollmentHelpers.ts', HOOK_STUBS);
  const sending = await loadBundled('src/components/outreach/enrollment-preview/useSendingAccount.ts', HOOK_STUBS);
  const { calls, fake } = recorder();
  const ctx = { sequenceName: 'Approche', firstAction: null, onOpenSequence: () => {}, toast: fake };

  announceEnrollOutcome({ status: 'refused', message: 'Tous les candidats ont déjà été contactés par votre organisation', recentEnrollments: null }, ctx);
  assert.deepEqual(calls.splice(0), [{ kind: 'error', title: 'Tous les candidats ont déjà été contactés par votre organisation', options: undefined }]);

  announceEnrollOutcome({ status: 'failed', error: new Error('boom'), results: emptyResults(), enrolledIds: [], recentEnrollments: null }, ctx);
  assert.deepEqual(calls.splice(0), [{ kind: 'error', title: 'Inscription impossible', options: { description: 'Réessayez ou contactez le support.' } }]);

  announceEnrollOutcome({ status: 'failed', error: { hint: helpers.ENROLL_ACCOUNT_OF_OTHER_MEMBER_HINT }, results: emptyResults(), enrolledIds: [], recentEnrollments: null }, ctx);
  assert.deepEqual(calls.splice(0), [{ kind: 'error', title: 'Inscription impossible', options: { description: sending.OTHER_MEMBER_ACCOUNT_MESSAGE } }]);

  // Planification en échec : un seul toast, rien d'autre.
  const results = emptyResults({ errors: ['Des inscriptions ont été créées sans étape ; elles démarreront dans l\'heure.'], skipped: 2 });
  announceEnrollOutcome(done(results, { schedulingFailure: { rolledBack: true } }), ctx);
  assert.deepEqual(calls.splice(0), [{ kind: 'error', title: 'Inscription impossible', options: { description: results.errors[0] } }]);
  announceEnrollOutcome(done(results, { schedulingFailure: { rolledBack: false } }), ctx);
  assert.deepEqual(calls.splice(0), [{ kind: 'error', title: 'Inscription incomplète', options: { description: results.errors[0] } }]);
});

test('5F2C-A3 ordre des annonces : échecs, effacés, même personne, réinscrits, déjà passés, Retenu en échec', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const { announceEnrollOutcome } = await loadBundled(ANNOUNCE, HOOK_STUBS);
  const helpers = await loadBundled('src/components/outreach/enrollment-preview/enrollmentHelpers.ts', HOOK_STUBS);
  const messages = await loadBundled('src/lib/sequenceErrorMessages.ts');
  const { calls, fake } = recorder();
  const ctx = { sequenceName: 'Approche', firstAction: null, onOpenSequence: () => {}, toast: fake };

  const results = emptyResults({
    success: 2, errors: ['Inscription impossible pour Eva Martin. Réessayez ou contactez le support.'],
    gdprErased: ['Paul Roy'], samePerson: ['Léa Bernard', 'Jean Petit'], formerPassages: 1, alreadyPassed: 1, skipped: 4,
  });
  announceEnrollOutcome(done(results, { enrolledIds: ['a', 'b'], retained: { saved: 1, failed: 2 } }), ctx);
  const kinds = calls.map((c) => c.kind);
  assert.deepEqual(kinds, ['success', 'error', 'warning', 'warning', 'warning', 'info', 'warning']);
  assert.equal(calls[1].title, '1 inscription en échec');
  assert.equal(calls[1].options.description, results.errors[0]);
  assert.equal(calls[2].title, messages.gdprErasedEnrollLabel(1));
  assert.equal(calls[2].options.description, messages.refusedCandidatesLabel(['Paul Roy']));
  assert.equal(calls[3].title, helpers.samePersonRefusedLabel(2));
  assert.equal(calls[3].options.description, messages.refusedCandidatesLabel(['Léa Bernard', 'Jean Petit']));
  assert.equal(calls[4].title, helpers.formerPassageLabel(1));
  // Déjà passés : annoncés à la place de « déjà dans la séquence » (une seule annonce).
  assert.equal(calls[5].title, helpers.alreadyPassedLabel(1));
  const retain = helpers.retainFailedLabel(2);
  assert.equal(calls[6].title, retain.title);
  assert.equal(calls[6].options.description, retain.description);

  // Sans « déjà passés » : déjà dans la séquence.
  calls.length = 0;
  announceEnrollOutcome(done(emptyResults({ skipped: 3 })), ctx);
  assert.deepEqual(calls.map((c) => [c.kind, c.title]), [['info', helpers.alreadyInSequenceLabel(3)]]);

  // Rien d'inscrit et rien à dire : aucune annonce de succès.
  calls.length = 0;
  announceEnrollOutcome(done(emptyResults()), ctx);
  assert.equal(calls.length, 0);

  // Retenu enregistré (saved seul) : aucune annonce.
  announceEnrollOutcome(done(emptyResults({ success: 1 }), { retained: { saved: 1, failed: 0 } }), ctx);
  assert.deepEqual(calls.map((c) => c.kind), ['success']);
});

// ─── Défauts confirmés par la relecture indépendante ────────────────────────

test('5F2C-R1 dérogations : propres à la séquence ET aux candidats montrés, jamais armées pour un candidat coché ensuite', () => {
  assert.match(flowCode, /const candidatesKey = useMemo\(\(\) => candidates\.map\(\(candidate\) => candidate\.id\)\.join\('\\u0001'\), \[candidates\]\);/);
  assert.match(flowCode, /const overrideScope = `\$\{selectedId \?\? ''\}\|\$\{candidatesKey\}`;/);
  assert.match(flowCode, /overrideState\.scope === overrideScope \? overrideState\.set : NO_OVERRIDES/);
  assert.match(flowCode, /return \{ scope: overrideScope, set: next \};/);
  assert.doesNotMatch(flowCode, /overrideState\.sequenceId/);
});

test('5F2C-R2 séquence à message IA : aucune dérogation dans le panneau, la fenêtre de relecture reçoit aussi les exclus à dérogation', () => {
  assert.match(flowCode, /const overridesEnabled = !info\.aiReview;/);
  assert.match(flowCode, /const overrides = overridesEnabled && overrideState\.scope === overrideScope \? overrideState\.set : NO_OVERRIDES;/);
  assert.match(flowCode, /overridesEnabled=\{overridesEnabled\}/);
  const review = between(flowCode, 'const reviewProfiles = useMemo(', 'const [review, setReview]');
  assert.match(review, /if \(info\.aiReview\) \{/);
  for (const reason of ['recent_contact', 'too_far', 'connection_only']) assert.ok(review.includes(`'${reason}'`), reason);
});

test('5F2C-R3 la sélection change panneau ouvert : l\'inscription attend la relecture, rien n\'est lu derrière la porte gratuite', () => {
  assert.match(flowCode, /refreshing = false,/);
  assert.match(flowCode, /const enrollDisabled = enrolling\s*\|\| refreshing/);
  assert.match(flowCode, /const reviewDisabled = enrolling\s*\|\| refreshing/);
  assert.match(flowCode, /const previewsEnabled = canSendSequences\s*&& !!organizationId/);
  assert.match(flowCode, /organizationId: canSendSequences \? organizationId : null,/);
});

test('5F2C-R4 focus et annonces : le résumé est une zone d\'état qui reçoit le focus quand le bouton cliqué disparaît', () => {
  assert.match(flowCode, /<p ref=\{summaryRef\} tabIndex=\{-1\} role="status"/);
  assert.match(flowCode, /focusSummary\.current = true;/);
  assert.match(flowCode, /summaryRef\.current\?\.focus\(\{ preventScroll: true \}\);/);
});

test('5F2C-R5 refus ou échec de l\'inscription : les séquences sont relues (une séquence désactivée ne reste pas choisie)', () => {
  assert.match(flowCode, /retryEligibility\(\);\s*sequencesRead\.refetch\(\);/);
});

test('5F2C-R6 pied : la réserve pour la bulle de l\'assistant ne vaut que dès lg', () => {
  assert.match(flowCode, /px-4 py-3 sm:px-5 lg:pr-20/);
  assert.doesNotMatch(flowCode, /pr-20 sm:pr-20/);
});

test('5F2C-R7 éligibilité : aucune copie gardée, une relecture en échec passe avant les données anciennes', () => {
  const src = code(read('src/components/sequences/contact/useContactEligibility.ts'));
  assert.match(src, /staleTime: 0,\s*gcTime: 0,\s*refetchOnMount: 'always',/);
  const status = src.slice(src.indexOf("else if (profiles.length === 0) status = 'ready';"));
  assert.ok(status.indexOf('query.isError') < status.indexOf('remote !== undefined'), 'erreur avant données');
});

test('5F2C-R8 jauge : aucune jauge pour un InMail, un message IA hors panneau ni une rotation ; plus de jauge sans candidat visé', () => {
  const src = code(read('src/lib/quotaGauge.ts'));
  assert.match(src, /if \(firstActionType === 'message'\) return 'actions';/);
  assert.doesNotMatch(src, /inmail|smart_message/);
});

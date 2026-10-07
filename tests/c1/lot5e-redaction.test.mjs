/**
 * Refonte des séquences, lot 5e : garde-fous statiques de la rédaction par
 * l'IA (docs/refonte-mission/lot5-plan.md, section 5e, « Tests à écrire »).
 *
 * Côté serveur seulement, comme les autres gardes de tests/c1 : lecture du
 * source et assertions sur les motifs, sans navigateur, sans base ni runtime
 * Deno. Les écrans ont leur garde dans tests/ux/lot5e-redaction-ecrans.test.mjs,
 * le comportement est prouvé par e2e/api/seq-draft.spec.ts,
 * e2e/api/seq-draft-skeleton.spec.ts et e2e/flows/seq-v2-redaction.spec.ts.
 *
 * Contrat gardé :
 * - draft-sequence, action draft : membre, mission de l'organisation, crédits
 *   (assertCredits, 402 sans appel), appel (call-claude.ts, modèle par
 *   getAnthropicModelId, 30 s au plus), une correction au plus, puis
 *   settleCredits ; prepare gratuite, sans IA ; aucune garde d'offre ;
 * - draft-sequence n'écrit rien d'autre que le débit : aucune écriture sur les
 *   séquences, les étapes, les inscriptions, les exécutions, inmail_queue ni
 *   job_candidate_status ; aucun module LinkedIn importé ;
 * - create_sequence : forme commune (buildDraftSkeleton, applyDraftReview),
 *   contrôles (checkDraftTexts), écriture par save_sequence_steps, jamais
 *   automatique (NEVER_AUTO_TOOLS, autoEligible false à l'écran) ;
 * - carte d'approbation et Journal : textes entiers, sans troncature ;
 * - text-action : sorties de séquence passées par checkDraftTexts, tutoiement
 *   refusé en contexte séquence, avant tout appel et tout débit ;
 * - draft_outreach_message (correctif 3) : vouvoiement, rémunération contrôlée,
 *   crédits vérifiés avant l'appel ;
 * - dans src/ et supabase/functions/, seule la RPC save_sequence_steps écrit
 *   sequence_steps.
 *
 * Lancer : node --test tests/c1/lot5e-redaction.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD) : c'est
 * ainsi qu'on vérifie que ces tests échouent sur le code d'origine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const DRAFT_INDEX = 'supabase/functions/draft-sequence/index.ts';
const DRAFT_COMPOSE = 'supabase/functions/draft-sequence/compose.ts';
const SEQUENCE_DRAFT = 'supabase/functions/_shared/sequence-draft.ts';
const MUTATIONS = 'supabase/functions/_shared/agent-tools-mutations.ts';
const REGISTRY = 'supabase/functions/_shared/agent-tools.ts';
const TEXT_ACTION = 'supabase/functions/text-action/index.ts';
const POLICIES = 'src/components/settings/AgentPoliciesSettings.tsx';
const CARD = 'src/components/agent/AgentToolApprovalCard.tsx';
const JOURNAL = 'src/components/settings/AgentActionsSettings.tsx';
const PREVIEW = 'src/components/agent/SequenceDraftPreview.tsx';
const PREVIEW_READER = 'src/components/agent/sequenceDraftPreview.ts';

/** Corps d'une fonction de premier niveau : de sa déclaration à la première accolade fermante en colonne 0. */
function fnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} introuvable`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `fin de ${signature} introuvable`);
  return src.slice(start, end);
}

/** Objet de premier niveau déclaré par `const nom: Type = {` : jusqu'à `\n};`. */
function objectBlock(src, declaration) {
  const start = src.indexOf(declaration);
  assert.ok(start >= 0, `${declaration} introuvable`);
  const end = src.indexOf('\n};\n', start);
  assert.ok(end > start, `fin de ${declaration} introuvable`);
  return src.slice(start, end);
}

/** Position d'un motif, échec explicite s'il est absent. */
function at(src, needle, label = needle) {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `${label} introuvable`);
  return i;
}

/** Source sans commentaires (// en début de ligne ou après du code, et /* … *\/), pour ne juger que le code. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

const WRITE_VERB = /\.(insert|update|upsert|delete)\s*\(/;

/** Fichiers .ts, .tsx, .mjs, .js d'un dossier, récursivement, hors tests. */
function sourceFiles(relDir) {
  const out = [];
  const walk = (abs) => {
    for (const name of readdirSync(abs)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = join(abs, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.(ts|tsx|mjs|js)$/.test(name)) out.push(relative(ROOT, full));
    }
  };
  walk(join(ROOT, relDir));
  return out;
}

/** Modules locaux importés, transitivement, à partir d'un fichier (imports statiques et dynamiques). */
function localImportClosure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = read(rel);
    const specs = [
      ...src.matchAll(/(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g),
      ...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]);
    for (const spec of specs) {
      assert.doesNotMatch(spec, /unipile/i, `${rel} importe ${spec}`);
      if (!spec.startsWith('.')) continue;
      const next = normalize(join(dirname(rel), spec));
      if (existsSync(join(ROOT, next))) queue.push(next);
    }
  }
  return [...seen];
}

// ─── draft-sequence : ordre de l'action draft ───────────────────────────────

test('draft : membre, mission de l’organisation, crédits (402 sans appel), appel, correction unique, puis débit', () => {
  const index = read(DRAFT_INDEX);
  // Point d'entrée : jeton vérifié avant toute action, une session utilisateur exigée.
  const auth = at(index, 'auth = await requireAuth(req, corsHeaders);');
  assert.ok(at(index, 'if (action === "draft") return await handleDraft(') > auth, 'draft après requireAuth');
  assert.ok(at(index, 'if (action === "prepare") return await handlePrepare(') > auth, 'prepare après requireAuth');
  assert.match(index, /if \(!auth\.userId\) return json\(/);

  const compose = read(DRAFT_COMPOSE);
  const load = fnBody(compose, 'async function loadMission(');
  const member = at(load, 'await verifyOrgMembership(admin, ctx.userId, organizationId)');
  const mission = at(load, '.from("sourcing_projects")');
  assert.ok(member < mission, 'appartenance avant la lecture de la mission');
  assert.match(load, /\.eq\("id", missionId\)\s*\.eq\("organization_id", organizationId\)/, 'mission lue dans cette organisation seulement');
  assert.match(load, /error_code: "MISSION_NOT_FOUND" \}, 404\)/);
  assert.match(load, /error_code: "DRAFT_JOB_TOO_THIN" \}, 422\)/);

  const draft = fnBody(compose, 'async function draft(');
  const loaded = at(draft, 'await loadMission(organizationId, missionId, ctx)');
  const argument = at(draft, 'checkExtraArgument(argument, organizationName, { hiddenClientNames: facts.company.hiddenNames, forbidden })');
  const credits = at(draft, 'await assertCredits({');
  const refused = at(draft, 'error_code: "INSUFFICIENT_CREDITS"');
  const status402 = at(draft, '}, 402);');
  const define = at(draft, 'const callModel = async');
  const call = at(draft, 'first = await callModel(baseMessages);');
  const settle = at(draft, 'await settleCredits(admin, {');
  assert.ok(loaded < argument && argument < credits, 'mission et arguments ajoutés contrôlés avant les crédits');
  assert.ok(credits < refused && refused < status402 && status402 < define, '402 rendu avant même la préparation de l’appel');
  assert.ok(define < call && call < settle, 'appel au modèle, puis débit');
  assert.equal(draft.match(/callClaudeCompat\(/g)?.length, 1, 'un seul point d’appel au modèle');
  assert.match(draft.slice(define, call), /callClaudeCompat\(\{/);
  // Une correction au plus, seulement s'il reste le temps.
  assert.equal(draft.match(/await callModel\(/g)?.length, 2, 'appel puis une correction au plus');
  assert.match(draft, /if \(\(!readable \|\| needsCorrection\(issues\)\) && hasTimeForAiCorrection\(deadline, Date\.now\(\)\)\) \{/);
  // Modèle indisponible : 503 sans débit (return avant settleCredits).
  const unavailable = at(draft, 'error_code: "DRAFT_UNAVAILABLE" }, 503)');
  assert.ok(call < unavailable && unavailable < settle, 'modèle indisponible : réponse avant le débit');
  // Débit avec l'identifiant de la mission dans la description (migration aucune, plan 5e).
  assert.match(draft.slice(settle), /aiAction: AI_ACTION,/);
  assert.match(draft.slice(settle), /description: `Séquence rédigée à partir du poste \$\{quoteFr\(facts\.title\)\} \(mission \$\{missionId\}\)`/);
  assert.match(compose, /const AI_ACTION = "sequence_draft";/);
});

test('draft : modèle par getAnthropicModelId, 30 s au plus par appel, dans les 60 s de la fonction, sans nouvelle tentative', () => {
  const compose = read(DRAFT_COMPOSE);
  assert.match(compose, /import \{ callClaudeCompat, type OpenAIMessage \} from "\.\.\/_shared\/call-claude\.ts";/);
  assert.match(compose, /const MODEL_TIMEOUT_MS = 30_000;/);
  assert.match(compose, /const FUNCTION_BUDGET_MS = 60_000;/);
  const draft = fnBody(compose, 'async function draft(');
  assert.match(draft, /const anthropicModel = getAnthropicModelId\(modelId\);/);
  assert.match(draft, /model: anthropicModel,/);
  assert.match(draft, /const timeoutMs = Math\.min\(MODEL_TIMEOUT_MS, deadline - Date\.now\(\) - RESPONSE_MARGIN_MS\);/);
  assert.match(draft, /timeoutMs,\n/);
  assert.match(draft, /maxRetries: 0,/);
  // Crédits estimés et débités sur le même modèle.
  assert.match(draft, /assertCredits\(\{ userId: ctx\.userId, organizationId, aiAction: AI_ACTION, modelId, adminClient: admin \}\)/);
  assert.match(draft.slice(draft.indexOf('await settleCredits(')), /modelId,\n/);
  // Aucune garde d'offre (décision 6) : la formule gratuite rédige dans la limite de ses crédits.
  assert.doesNotMatch(compose, /getSubscriptionGate|canSendSequences|subscription-gate/);
});

test('prepare : gratuite, sans IA, sans débit', () => {
  const compose = read(DRAFT_COMPOSE);
  const prepare = fnBody(compose, 'async function prepare(');
  assert.doesNotMatch(prepare, /assertCredits|settleCredits|callClaudeCompat|callModel/);
  // Lot 5e-2 : coût annoncé au niveau par défaut de l'organisation, et pour chaque niveau.
  assert.match(prepare, /const estimated = levelCredits\(AI_ACTION, settings\.defaultLevel\);/, 'coût annoncé, sans débit');
  assert.match(prepare, /levels: levelChoices\(AI_ACTION, settings\),/);
  assert.match(prepare, /notice: DRAFT_NOTICE,/);
  const shared = read(SEQUENCE_DRAFT);
  assert.match(shared, /export const DRAFT_NOTICE = 'Rien ne part avant que vous inscriviez des candidats\.';/);
});

// ─── draft-sequence n'écrit rien d'autre que le débit ───────────────────────

test('draft-sequence : aucune écriture en base (séquences, étapes, inscriptions, exécutions, InMails, Pipeline)', () => {
  for (const rel of [DRAFT_INDEX, DRAFT_COMPOSE]) {
    const code = codeOnly(read(rel));
    assert.doesNotMatch(code, WRITE_VERB, `${rel} : aucune écriture`);
    assert.doesNotMatch(code, /\.rpc\(/, `${rel} : aucune RPC`);
    for (const table of ['outreach_sequences', 'sequence_steps', 'sequence_step_executions', 'inmail_queue', 'job_candidate_status']) {
      assert.doesNotMatch(code, new RegExp(`from\\(["'\`]${table}["'\`]\\)`), `${rel} ne touche pas ${table}`);
    }
  }
  // Seule lecture d'inscriptions : l'aperçu (5d-1), avec le jeton de l'appelant.
  const index = codeOnly(read(DRAFT_INDEX));
  assert.equal(index.match(/from\("sequence_enrollments"\)/g)?.length, 1);
  assert.match(index, /\.from\("sequence_enrollments"\)\s*\.select\("\*"\)/);
  // Module de la rédaction : pur, sans base ni réseau.
  const shared = codeOnly(read(SEQUENCE_DRAFT));
  assert.doesNotMatch(shared, /\.from\(\s*['"`]|\.rpc\(|createClient|\bfetch\(|Deno\.env/);
});

test('draft-sequence : aucun module LinkedIn importé, ni directement ni par ses dépendances', () => {
  const closure = localImportClosure(DRAFT_INDEX);
  assert.ok(closure.includes(DRAFT_COMPOSE) && closure.includes(SEQUENCE_DRAFT), 'compose.ts et sequence-draft.ts suivis');
  for (const rel of closure) assert.doesNotMatch(rel, /unipile/i, `${rel} est un module LinkedIn`);
  // La rédaction n'importe ni le moteur, ni l'arrêt des envois, ni la file InMail.
  for (const rel of localImportClosure(DRAFT_COMPOSE)) {
    assert.doesNotMatch(rel, /process-sequences|linkedin-sending|inmail/i, `${rel} importé par la rédaction`);
  }
});

// ─── create_sequence ────────────────────────────────────────────────────────

test('create_sequence : forme commune, contrôles de la rédaction, écriture par save_sequence_steps', () => {
  const src = read(MUTATIONS);
  const plan = fnBody(src, 'async function planCreateSequence(');
  assert.match(plan, /const skeleton = buildDraftSkeleton\(parsed\.options\);/);
  assert.match(plan, /slotTextsFromFields\(params, skeleton\)/);
  assert.match(plan, /const issues = checkDraftTexts\(texts, draftCheckContextFor\(facts, \{/);
  assert.match(plan, /const refusal = draftRefusalReason\(issues\);\s*if \(refusal\) return \{ ok: false, reason: refusal \};/);
  assert.match(plan, /const \{ steps, flags \} = applyDraftReview\(skeleton, texts, issues\);/);
  assert.match(plan, /const loaded = await loadSequenceMission\(params\.mission_id, ctx\);/);
  assert.match(fnBody(src, 'async function loadSequenceMission('), /\.eq\('id', missionId\)\s*\.eq\('organization_id', ctx\.organizationId\)/, 'mission de l’organisation seulement');
  assert.match(src, /import \{[\s\S]*?buildDraftSkeleton,[\s\S]*?checkDraftTexts,[\s\S]*?\} from '\.\/sequence-draft\.ts';/);

  const tool = objectBlock(src, 'const createSequence: AgentTool = {');
  // Les trois temps rejouent le même plan : un texte modifié dans « Modifier » repasse les contrôles.
  assert.equal(tool.match(/await planCreateSequence\(params, ctx\)/g)?.length, 3);
  assert.match(tool, /requiresApproval: true,/);
  assert.match(tool, /category: 'mutation_safe',/);
  assert.match(tool, /\.rpc\('save_sequence_steps', \{\s*p_sequence_id: seq\.id,\s*p_steps: plan\.steps\.map\(draftStepToSaveRow\),/);
  assert.doesNotMatch(tool, /from\('sequence_steps'\)/, 'plus aucune écriture directe des étapes');
  // Gratuit : créée désactivée (règle existante), échec fermé si l'offre est illisible.
  assert.match(tool, /if \(!gate\.canSendSequences\) \{/);
  assert.match(tool, /is_active: inactiveReason === null,/);
  // Une séquence sans étapes n'est pas laissée en base.
  assert.match(tool, /if \(stepsErr\) \{[\s\S]*?\.from\('outreach_sequences'\)\.delete\(\)\.eq\('id', seq\.id\);/);
  // Le modèle ne choisit pas la forme : ni types d'étape, ni délais dans l'entrée.
  const schema = tool.slice(tool.indexOf('inputSchema:'), tool.indexOf('async verifyAccess('));
  assert.doesNotMatch(schema, /\bsteps:|delay_days|action_type/);
  assert.match(schema, /first_contact: \{[\s\S]*?enum: \['invitation', 'inmail'\]/);
  // Forme commune : use_ai_personalization toujours faux à l'enregistrement.
  const shared = read(SEQUENCE_DRAFT);
  assert.match(fnBody(shared, 'export function draftStepToSaveRow('), /use_ai_personalization: false,/);
  assert.match(fnBody(shared, 'export function buildDraftSkeleton('), /useAiPersonalization: false,/);
});

test('create_sequence : jamais automatique, côté serveur comme à l’écran', () => {
  const registry = read(REGISTRY);
  const set = registry.match(/const NEVER_AUTO_TOOLS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
  assert.match(set, /'create_sequence'/, 'create_sequence dans NEVER_AUTO_TOOLS');
  const policy = fnBody(registry, 'export function resolveEffectivePolicy(');
  assert.match(policy, /NEVER_AUTO_TOOLS\.has\(tool\.name\)\) return 'approve';/);
  const line = read(POLICIES).split('\n').find((l) => l.includes("name: 'create_sequence'"));
  assert.ok(line, 'create_sequence absent de POLICY_TOOLS');
  assert.match(line, /autoEligible: false/);
});

// ─── Carte d'approbation et Journal ─────────────────────────────────────────

test('carte d’approbation et Journal : la séquence proposée avec ses textes entiers, sans troncature', () => {
  const preview = read(PREVIEW);
  assert.doesNotMatch(preview, /truncate|line-clamp|text-ellipsis|\.slice\(|\.substring\(|maxLength/);
  assert.match(preview, /whitespace-pre-wrap break-words/);
  assert.match(preview, /\{step\.body\}/);
  assert.match(preview, /\{step\.subject\}/);
  const reader = read(PREVIEW_READER);
  assert.doesNotMatch(codeOnly(reader), /\.slice\(|\.substring\(|\.substr\(/);
  assert.match(reader, /body: typeof s\.messageTemplate === 'string' \? s\.messageTemplate : '',/);
  for (const rel of [CARD, JOURNAL]) {
    const src = read(rel);
    assert.match(src, /readSequenceDraftPreview\(/, `${rel} lit la séquence proposée`);
    assert.match(src, /<SequenceDraftPreview preview=\{sequencePreview\} \/>/, `${rel} montre la séquence proposée`);
    // « Ouvrir la séquence » rejette la proposition avec sa note avant d'ouvrir l'éditeur.
    assert.match(src, /action: 'reject', reason: PROPOSAL_EDITOR_NOTE/, `${rel} : proposition rejetée avec sa note`);
  }
  assert.match(read(PREVIEW_READER), /export const PROPOSAL_EDITOR_NOTE = "Reprise dans l'éditeur";/);
  // Côté serveur : le dryRun porte les étapes entières et les signalements.
  const tool = objectBlock(read(MUTATIONS), 'const createSequence: AgentTool = {');
  const dry = tool.slice(tool.indexOf('async dryRun('), tool.indexOf('async execute('));
  assert.match(dry, /steps: plan\.steps,/);
  assert.match(dry, /flags: plan\.flags,/);
});

// ─── text-action en contexte séquence ───────────────────────────────────────

test('text-action : sorties de séquence passées par checkDraftTexts, tutoiement refusé avant tout appel et tout débit', () => {
  const src = read(TEXT_ACTION);
  const refuseTone = at(src, "if (body.tone === 'casual') {");
  assert.match(src.slice(refuseTone, refuseTone + 200), /error_code: 'SEQUENCE_TONE_REFUSED' \}, 400\)/);
  const refuseAction = at(src, 'if (!SEQUENCE_ACTIONS.has(action)) {');
  assert.match(src.slice(refuseAction, refuseAction + 200), /error_code: 'SEQUENCE_ACTION_UNSUPPORTED' \}, 400\)/);
  const gate = at(src, 'await assertCredits(');
  const call = at(src, 'result = await callModel();');
  const settle = at(src, 'await settleCredits(adminClient, {');
  const review = at(src, 'const review = reviewTextProposal(');
  assert.ok(refuseTone < gate && refuseAction < gate, 'refus avant le garde des crédits');
  assert.ok(gate < call && call < settle && settle < review, 'crédits, appel, débit, puis contrôle de la proposition');
  assert.match(src, /const SEQUENCE_ACTIONS = new Set<Action>\(\['rewrite', 'shorten', 'hook', 'proofread', 'restyle'\]\);/);
  assert.match(src.slice(review), /if \(review\.refusals\.length > 0\) \{[\s\S]*?error_code: 'PROPOSAL_NOT_COMPLIANT'[\s\S]*?\}, 422\);/);
  // La seule sortie réussie du contexte séquence est la proposition contrôlée.
  const sequenceExit = src.slice(at(src, 'if (sequenceContext) {\n      let proposal'));
  assert.match(sequenceExit, /return json\(\{ success: true, text: proposal, warnings: review\.warnings, credits_used: creditsUsed, \.\.\.applied \}\);/);
  // Vouvoiement imposé dans la consigne, même après le contexte IA ou les préférences ; modèle de l'action par getAnthropicModelId.
  assert.match(src, /"- Vouvoiement obligatoire dans le texte, même si le texte d'origine tutoie ou si un autre ton est indiqué plus haut\."/);
  // Aucune nouvelle tentative du modèle en contexte séquence : la réponse tient dans les 60 s.
  assert.match(src, /\.\.\.\(sequenceContext \? \{ maxRetries: 0 \} : \{\}\),/);
  // Valeurs gardées pour l'équipe contrôlées avec la mission.
  assert.match(src, /sequenceForbidden = briefForbiddenValues\(mission\.job_details\);/);
  assert.match(src, /forbidden: sequenceForbidden,/);
  // Lot 5e-2 : modèle du niveau (jamais _ai_model) en contexte séquence.
  assert.match(src, /const modelId = sequenceLevel \? modelForLevel\(sequenceLevel\) : _aiParams\.modelId;/);
  assert.match(src, /model: sequenceContext \? getAnthropicModelId\(modelId\) : undefined,/);
  // Mission lue dans l'organisation seulement.
  assert.match(src, /\.eq\('id', body\.mission_id\)\s*\.eq\('organization_id', body\.organization_id!\)/);
  // reviewTextProposal applique checkDraftTexts.
  const reviewFn = fnBody(read(SEQUENCE_DRAFT), 'export function reviewTextProposal(');
  assert.match(reviewFn, /checkDraftTexts\(\[\{ slot: input\.slot, subject: '', body \}\], ctx\)/);
  // Une proposition qui tutoie un texte qui vouvoyait est refusée, pas seulement signalée :
  // le tutoiement est un refus de checkDraftTexts (lot 5e-2), hérité seulement s'il était déjà là.
  assert.match(reviewFn, /const refusals = after\.filter\(\(i\) => i\.severity === 'refuse' && !inherited\(i\)\)/);
  const checkFn = fnBody(read(SEQUENCE_DRAFT), 'export function checkDraftTexts(');
  assert.match(checkFn, /if \(hasTutoiement\(plain, \[ctx\.organizationName, \.\.\.\(ctx\.knownNames \?\? \[\]\)\]\)\) \{\n\s*refuse\(field, 'tutoiement'/);
});

// ─── draft_outreach_message (correctif 3) ───────────────────────────────────

test('draft_outreach_message : vouvoiement, rémunération contrôlée, crédits vérifiés avant l’appel', () => {
  const src = read(MUTATIONS);
  const tool = objectBlock(src, 'const draftOutreachMessage: AgentTool = {');
  const exec = tool.slice(tool.indexOf('async execute('));
  const gate = at(exec, 'const gate = await assertCredits({');
  const refused = at(exec, 'if (!gate.ok) {');
  const call = at(exec, 'const result = await callClaudeCompat({');
  const settle = at(exec, 'await settleClaudeUsage({');
  const check = at(exec, 'const issues = checkDraftTexts(');
  assert.ok(gate < refused && refused < call, 'crédits contrôlés avant l’appel, refus sans appel');
  assert.ok(call < settle && settle < check, 'appel, débit, puis contrôle du brouillon');
  assert.match(exec.slice(refused, call), /return \{ success: false, error: 'Crédits IA insuffisants pour rédiger ce message\.' \};/);
  // Lot 5e-2 : modèle du niveau par défaut de l'organisation, estimé par le garde puis appelé.
  assert.match(exec, /const modelId = modelForLevel\(level\);/);
  assert.match(exec, /aiAction: 'outreach_message',\s*modelId,/);
  assert.match(exec, /model: getAnthropicModelId\(modelId\),/);
  assert.doesNotMatch(src, /DRAFT_MESSAGE_MODEL/);
  assert.match(exec, /timeoutMs: 30000,/);
  // Aucune nouvelle tentative : trois essais de 30 s dépasseraient les 60 s.
  assert.match(exec.slice(call, settle), /maxRetries: 0,/);
  // Vouvoiement, quel que soit le ton ; plus aucun ton qui tutoie proposé.
  assert.match(exec, /Le message vouvoie toujours le candidat, quel que soit le ton\./);
  assert.match(exec, /- Vouvoiement obligatoire, jamais de tutoiement/);
  assert.match(exec, /const styleRules = buildStyleInstructions\(style, \{ slots: \[slot\], audience: 'candidate', agenda: 'none' \}\);/);
  assert.match(tool, /The message always addresses the candidate with 'vous'\./);
  assert.match(tool, /enum: \['professional', 'concise'\],/);
  // Poste par la liste fermée (alias d'un client anonymisé), jamais client_name ni la description brute.
  assert.match(exec.slice(0, call), /const facts = pickBriefFacts\(\{/);
  assert.doesNotMatch(exec.slice(0, call), /\$\{project\.client_name|project\.description|jd\.description/);
  // Rémunération : interdite dans la consigne ; brouillon passé par checkDraftTexts (client anonymisé, tutoiement).
  assert.match(exec, /- Aucune rémunération : ni salaire, ni montant, ni fourchette, ni avantage chiffré/);
  assert.match(exec.slice(check), /draftCheckContextFor\(facts, \{ organizationName, firstContact, forbidden: briefForbiddenValues\(project\.job_details\), knownNames \}\)/);
  assert.match(exec.slice(check), /const refusals = issues\.filter\(\(i\) => i\.severity === 'refuse' \|\| i\.code === 'tutoiement'\);/);
  assert.match(exec.slice(check), /return \{ success: false, error: `Brouillon refusé : \$\{why\}\. Demandez une nouvelle proposition\.` \};/);
});

test('create_sequence : le modèle rédige à partir des seuls faits fermés (get_sequence_draft_facts), valeurs internes refusées', () => {
  const src = read(MUTATIONS);
  const facts = objectBlock(src, 'const getSequenceDraftFacts: AgentTool = {');
  assert.match(facts, /category: 'read',/);
  assert.match(facts, /requiresApproval: false,/);
  assert.match(facts, /facts: facts\.facts\.map\(\(f\) => f\.text\),/);
  assert.match(src, /registerTool\(getSequenceDraftFacts\);/);
  // Lecture de la mission : liste fermée et valeurs gardées pour l'équipe, mission de l'organisation.
  const loader = fnBody(src, 'async function loadSequenceMission(');
  assert.match(loader, /\.eq\('organization_id', ctx\.organizationId\)/);
  assert.match(loader, /const facts = pickBriefFacts\(\{/);
  assert.match(loader, /forbidden: briefForbiddenValues\(row\.job_details\),/);
  const plan = fnBody(src, 'async function planCreateSequence(');
  assert.match(plan, /applyClientAlias\(slotTextsFromFields\(params, skeleton\), facts\.company\.hiddenNames, facts\.outreach\.alias\)/);
  assert.match(plan, /forbidden,\n\s*\}\)\);/);
  // La consigne du chat ne renvoie plus au brief complet pour rédiger.
  const chat = read('supabase/functions/search-agent-chat/index.ts');
  const block = chat.slice(chat.indexOf("**Séquences rédigées par l'IA (create_sequence)**"), chat.indexOf('RÈGLE ANTI-FABRICATION'));
  assert.match(block, /Appelle ` \+\s*`d'abord get_sequence_draft_facts/);
  assert.doesNotMatch(block, /Appuie-toi ` \+\s*`sur le poste de la mission \(get_mission_brief\)/);
});

// ─── Seule la RPC écrit sequence_steps ──────────────────────────────────────

test('src/ et supabase/functions/ : seule la RPC save_sequence_steps écrit sequence_steps', () => {
  const files = [...sourceFiles('src'), ...sourceFiles('supabase/functions')]
    .filter((rel) => !rel.endsWith('src/integrations/supabase/types.ts'));
  assert.ok(files.length > 300, `lecture incomplète (${files.length} fichiers)`);
  const writers = [];
  let readers = 0;
  for (const rel of files) {
    const code = codeOnly(read(rel));
    // Écriture SQL brute : aucune.
    if (/\b(insert\s+into|update|delete\s+from)\s+(public\.)?sequence_steps\b/i.test(code)) writers.push(`${rel} (SQL)`);
    for (const m of code.matchAll(/\.from\(\s*['"`]sequence_steps['"`]\s*\)/g)) {
      // La chaîne de l'appel : jusqu'à la fin de l'instruction.
      const rest = code.slice(m.index + m[0].length);
      const end = rest.search(/;|\n\s*\n/);
      const chain = end >= 0 ? rest.slice(0, end) : rest;
      if (WRITE_VERB.test(chain)) writers.push(rel);
      else readers++;
    }
  }
  assert.deepEqual(writers, [], `écriture directe de sequence_steps : ${writers.join(', ')}`);
  assert.ok(readers > 5, 'les lectures de sequence_steps sont bien vues par le contrôle');
  // Les écrivains passent par la RPC : l'éditeur (useSequenceSave), la copie
  // (sequenceActions) et l'assistant (create_sequence).
  for (const rel of ['src/hooks/useSequenceSave.ts', 'src/lib/sequenceActions.ts', MUTATIONS]) {
    assert.match(read(rel), /\.rpc\('save_sequence_steps',/, `${rel} écrit par la RPC`);
  }
});

/**
 * Refonte mission, lot 5a (décision 1 du lot 5) : rien ne part sans le clic
 * d'une personne. enroll_in_sequence et resume_sequence déclenchent des envois
 * de la séquence : aucun des deux ne passe en automatique, quelle que soit la
 * politique enregistrée par l'organisation. Le serveur tranche
 * (NEVER_AUTO_TOOLS, resolveEffectivePolicy) ; l'écran des politiques ne
 * propose plus « Automatique » pour ces outils.
 *
 * Même lot : l'outil d'inscription refuse une séquence dont un message est
 * rédigé par l'IA pour chaque candidat (décision 5), et son aperçu porte les
 * champs que l'inscription écrira (ligne du candidat dans la mission).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const registry = read('supabase/functions/_shared/agent-tools.ts');
const mutations = read('supabase/functions/_shared/agent-tools-mutations.ts');
const settings = read('src/components/settings/AgentPoliciesSettings.tsx');

const SEQUENCE_TOOLS = ['enroll_in_sequence', 'resume_sequence'];

/** Bloc d'un outil, de `const x: AgentTool = {` jusqu'au suivant. */
function toolBlock(name) {
  const start = mutations.indexOf(`name: '${name}',`);
  assert.ok(start >= 0, `${name} introuvable`);
  const end = mutations.indexOf(': AgentTool = {', start);
  return mutations.slice(start, end > start ? end : undefined);
}

function between(source, from, to) {
  const a = source.indexOf(from);
  assert.ok(a >= 0, `« ${from} » introuvable`);
  const b = source.indexOf(to, a + from.length);
  assert.ok(b > a, `« ${to} » introuvable après « ${from} »`);
  return source.slice(a, b);
}

test('5a — inscription et reprise de séquence jamais automatiques (serveur)', () => {
  const set = registry.match(/const NEVER_AUTO_TOOLS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
  assert.ok(set, 'NEVER_AUTO_TOOLS introuvable');
  for (const t of SEQUENCE_TOOLS) assert.match(set, new RegExp(`'${t}'`), `${t} absent de NEVER_AUTO_TOOLS`);
  // Création de séquence : pas encore concernée (lot 5e).
  assert.doesNotMatch(set, /'create_sequence'/);
});

test('5a — une politique « auto » enregistrée est ramenée à « approve », l’outil n’est pas éligible', () => {
  const resolve = registry.match(/export function resolveEffectivePolicy\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(resolve, /if \(configured === 'auto'\) \{\s*if \(tool\.category === 'mutation_external' \|\| NEVER_AUTO_TOOLS\.has\(tool\.name\)\) return 'approve';/);
  const eligible = registry.match(/export function isAutoEligible\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(eligible, /!NEVER_AUTO_TOOLS\.has\(tool\.name\)/);
  // La politique effective est appliquée avant toute exécution directe.
  const handle = between(registry, 'export async function handleProposedToolCall(', '// 4. Approval required');
  assert.ok(handle.indexOf('resolveEffectivePolicy(tool, orgPolicies.get(tool.name))') < handle.indexOf("if (effectivePolicy === 'auto')"));
});

test('5a — les deux outils restent soumis à approbation dans leur définition', () => {
  for (const t of SEQUENCE_TOOLS) {
    const head = between(toolBlock(t), `name: '${t}',`, 'inputSchema');
    assert.match(head, /requiresApproval: true/, `${t} : requiresApproval doit rester à true`);
  }
});

test('5a — l’écran des politiques ne propose pas « Automatique » pour ces outils', () => {
  for (const t of SEQUENCE_TOOLS) {
    const line = settings.split('\n').find((l) => l.includes(`name: '${t}'`));
    assert.ok(line, `${t} absent de POLICY_TOOLS`);
    assert.match(line, /autoEligible: false/, `${t} encore proposé en automatique`);
    assert.match(line, /description: 'Peut déclencher des envois : approbation obligatoire'/, `${t} : texte explicatif absent`);
    assert.doesNotMatch(line, /—/, `${t} : tiret long dans un texte visible`);
  }
  // Cadenas et option rendue seulement pour un outil éligible.
  assert.match(settings, /\{!tool\.autoEligible && <Lock /);
  assert.match(settings, /\{tool\.autoEligible && \(\s*<SelectItem value="auto">/);
  assert.match(settings, /const current: ToolPolicy = !tool\.autoEligible && stored === 'auto' \? 'approve' : stored;/);
  // create_sequence reste éligible jusqu'au lot 5e.
  assert.match(settings, /\{ name: 'create_sequence', label: 'Créer une séquence', autoEligible: true \}/);
});

test('5a — enroll_in_sequence refuse une séquence avec un message rédigé par l’IA, raison rendue au modèle', () => {
  const verify = between(toolBlock('enroll_in_sequence'), 'async verifyAccess(', 'async dryRun(');
  assert.match(verify, /\.from\('sequence_steps'\)\s*\.select\('action_type, use_ai_personalization'\)\s*\.eq\('sequence_id', sequenceId\);/);
  // Échec fermé si les étapes ne peuvent pas être lues.
  assert.match(verify, /if \(aiStepsError\) \{\s*return \{ allowed: false,/);
  assert.match(verify, /if \(hasAiPersonalizedStep\([\s\S]*?\)\) \{\s*return \{ allowed: false, reason: AI_SEQUENCE_ENROLL_MESSAGE \};/);
  assert.match(mutations, /const AI_SEQUENCE_ENROLL_MESSAGE =\s*"Cette séquence contient un message rédigé par l'IA pour chaque candidat : inscrivez ce candidat depuis l'écran, où vous relirez son message\.";/);
  // Le refus de verifyAccess revient au modèle (outcome denied, payload.error).
  assert.match(registry, /if \(!access\.allowed\) \{\s*return \{ outcome: 'denied', payload: \{ error: access\.reason \|\| 'Access denied' \} \};/);
});

test('5a — aperçu et inscription portent les mêmes champs du candidat (ligne de la mission)', () => {
  const enroll = toolBlock('enroll_in_sequence');
  const dry = between(enroll, 'async dryRun(', 'async execute(');
  const exec = enroll.slice(enroll.indexOf('async execute('));
  for (const [name, part] of [['aperçu', dry], ['inscription', exec]]) {
    assert.match(part, /enrollCandidateRow\(params, ctx\)/, `${name} : ligne de la mission relue`);
    assert.match(part, /const candidateFields = missionCandidateFields\(candidateRow, \{/, name);
    assert.match(part, /missionTitle: enrollMissionTitle\(project\),/, name);
  }
  // L'aperçu est construit par la règle du moteur, sur une inscription qui
  // porte ces champs ; l'insertion les écrit.
  assert.match(dry, /buildFirstStepPreview\(/);
  assert.match(dry, /created_by: ctx\.userId,\s*\.\.\.candidateFields,\s*\},/);
  assert.match(dry, /first_step_preview: firstStepPreview,/);
  const insert = between(exec, ".from('sequence_enrollments')\n      .insert({", '.select(');
  assert.match(insert, /\.\.\.candidateFields,/);
  assert.doesNotMatch(insert, /profile_name: params\.profile_name/, 'nom pris hors de la ligne de la mission');
  // Lecture impossible à l'exécution : refus plutôt qu'un autre texte que celui montré.
  assert.match(exec, /catch \(err\) \{[\s\S]*?return \{ success: false, error: CANDIDATE_UNREADABLE_MESSAGE \};/);
  // Ligne relue par organisation et mission, par identifiant puis par slug exact.
  const row = between(mutations, 'async function enrollCandidateRow(', '\n}\n');
  assert.match(row, /\.eq\('organization_id', ctx\.organizationId\)\s*\.eq\('project_id', projectId\)\s*\.eq\('candidate_id', candidateId\)/);
  assert.match(row, /\.ilike\('linkedin_profile_url', `%\/in\/\$\{slug\}%`\)/);
  assert.match(row, /linkedInSlugOf\(row\.linkedin_profile_url\) === slug/);
});

test('5a — module de l’aperçu : moteur pour les variables, première étape et tirage A/B', () => {
  const preview = read('supabase/functions/_shared/enroll-preview.ts');
  assert.match(preview, /import \{ buildSequenceContext, interpolateAndStrip \} from '\.\/template-interpolation\.ts';/);
  assert.match(preview, /import \{ pickFirstRootStep, type SequenceStepLike \} from '\.\/sequence-first-step\.ts';/);
  assert.match(preview, /export const ENROLLMENT_CANDIDATE_COLUMNS = \['profile_name', 'profile_headline', 'job_title', 'company_name'\] as const;/);
  // L'inscription tire la version d'une première étape A/B, comme l'aperçu l'annonce.
  const exec = toolBlock('enroll_in_sequence').split('async execute(')[1];
  assert.match(exec, /const \{ step: firstStep, variantAssigned \} = drawRankVariant\(stepRows, rootStep\);/);
  assert.match(exec, /variant_assigned: variantAssigned,/);
});

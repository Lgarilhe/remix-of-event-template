/**
 * Refonte mission, lot 0a : l'assistant ne change une étape qu'avec un clic
 * (conception 3.3). update_candidate_stage, add_to_shortlist et
 * bulk_update_stage font la même écriture : aucun des trois ne passe en
 * automatique, quelle que soit la politique enregistrée par l'organisation.
 * Le serveur tranche (NEVER_AUTO_TOOLS, resolveEffectivePolicy) ; l'écran des
 * politiques ne propose plus « Automatique » pour ces outils.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const registry = readFileSync(
  new URL('../../supabase/functions/_shared/agent-tools.ts', import.meta.url),
  'utf8',
);
const mutations = readFileSync(
  new URL('../../supabase/functions/_shared/agent-tools-mutations.ts', import.meta.url),
  'utf8',
);
const settings = readFileSync(
  new URL('../../src/components/settings/AgentPoliciesSettings.tsx', import.meta.url),
  'utf8',
);

const STAGE_TOOLS = ['update_candidate_stage', 'add_to_shortlist', 'bulk_update_stage'];

test('0a — les outils qui changent une étape ne passent jamais en automatique (serveur)', () => {
  const set = registry.match(/const NEVER_AUTO_TOOLS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
  assert.ok(set, 'NEVER_AUTO_TOOLS introuvable');
  for (const t of STAGE_TOOLS) assert.match(set, new RegExp(`'${t}'`), `${t} absent de NEVER_AUTO_TOOLS`);
});

test('0a — la politique effective ramène « auto » à « approve » pour la liste', () => {
  const resolve = registry.match(/export function resolveEffectivePolicy\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(resolve, 'resolveEffectivePolicy introuvable');
  assert.match(resolve, /NEVER_AUTO_TOOLS\.has\(tool\.name\)\) return 'approve'/);
  const eligible = registry.match(/export function isAutoEligible\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(eligible, /!NEVER_AUTO_TOOLS\.has\(tool\.name\)/);
});

test('0a — les trois outils restent soumis à approbation dans leur définition', () => {
  for (const t of STAGE_TOOLS) {
    const start = mutations.indexOf(`name: '${t}',`);
    assert.ok(start >= 0, `${t} introuvable dans agent-tools-mutations.ts`);
    const head = mutations.slice(start, mutations.indexOf('inputSchema', start));
    assert.match(head, /requiresApproval: true/, `${t} : requiresApproval doit rester à true`);
  }
});

test('0a — l’écran des politiques ne propose pas « Automatique » pour ces outils', () => {
  for (const t of STAGE_TOOLS) {
    const line = settings.split('\n').find((l) => l.includes(`name: '${t}'`));
    assert.ok(line, `${t} absent de POLICY_TOOLS`);
    assert.match(line, /autoEligible: false/, `${t} encore proposé en automatique`);
    assert.match(line, /approbation obligatoire/, `${t} : texte explicatif absent`);
    assert.doesNotMatch(line, /—/, `${t} : tiret long dans un texte visible`);
  }
  // L'option n'est rendue que pour un outil éligible.
  assert.match(settings, /\{tool\.autoEligible && \(\s*<SelectItem value="auto">/);
  // Une valeur « auto » déjà enregistrée s'affiche comme le serveur l'applique.
  assert.match(settings, /const current: ToolPolicy = !tool\.autoEligible && stored === 'auto' \? 'approve' : stored;/);
});

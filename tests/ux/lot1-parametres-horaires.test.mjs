/**
 * Lot 1 des Paramètres — horaires et plafond LinkedIn (réparations 7 et R5f).
 *
 * Invariants épinglés, par inspection de source (exécutable sans navigateur ni
 * base), dans le style de tests/ux/lot1-fiabilite.test.mjs :
 *  - R7a : le formulaire « Plages & limites de sécurité » n'est plus figé par
 *    une ré-hydratation à chaque rendu, « Enregistrer » ne se grise qu'après
 *    un succès, la ligne écrite est relue et la carte « Plafonds du jour » suit ;
 *  - R7b : une seule borne 1 à 500 pour le plafond, alignée sur la base et
 *    l'outil agent ;
 *  - R7c : les séquences et la file InMail appliquent le plafond enregistré
 *    (organisation transmise au gate) ;
 *  - R7d : le contrôle des heures ouvrées précède le gate, qui journalise
 *    l'action au ledger (plus d'action fantôme hors plage) ;
 *  - R5f : une lecture ratée affiche un bloc d'erreur, pas les défauts, et
 *    aucune écriture ne part sans lecture réussie.
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const hook = read('src/hooks/useMemberQuotas.ts');
const safety = read('src/components/settings/LinkedInSafetySettings.tsx');
const team = read('src/components/settings/TeamManagement.tsx');
const sequences = read('supabase/functions/process-sequences/index.ts');
const inmailQueue = read('supabase/functions/process-inmail-queue/index.ts');
const agentTools = read('supabase/functions/_shared/agent-tools-mutations.ts');
const rangeMigration = read('supabase/migrations/20260513220000_member_quotas_business_hours.sql');

const sliceBetween = (src, start, end) => {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `repère introuvable : ${start}`);
  const to = src.indexOf(end, from);
  assert.ok(to > from, `repère de fin introuvable : ${end}`);
  return src.slice(from, to);
};

// Motif des bornes héritées : 200 dans l'onglet Équipe, 0 à 500 dans l'écran Sécurité.
const LEGACY_BOUNDS = /max:\s*200\b|<=\s*500\b|max=\{(200|500)\}|min=\{0\}|entre 0 et 500/;

// ---------------------------------------------------------------- R7a
test('R7a — le formulaire n\'est plus ré-hydraté à chaque rendu', () => {
  const deps = [...safety.matchAll(/useEffect\([\s\S]*?\},\s*\[([^\]]*)\]\s*\)/g)].map((m) => m[1]);
  assert.ok(deps.length >= 2, 'effets de LinkedInSafetySettings introuvables');
  for (const d of deps) {
    assert.doesNotMatch(
      d,
      /getQuotaForUser/,
      'getQuotaForUser change d\'identité à chaque rendu : en dépendance, il écrase chaque saisie',
    );
  }
  assert.ok(
    deps.some((d) => /savedStart/.test(d) && /savedEnd/.test(d) && /savedCap/.test(d) && /savedTz/.test(d)),
    'l\'hydratation doit dépendre des quatre valeurs enregistrées (primitives)',
  );
});

test('R7a — « Enregistrer » ne se grise qu\'après un succès', () => {
  const hs = sliceBetween(safety, 'const handleSave', 'const handleReset');
  assert.equal(hs.split('setDirty(false)').length - 1, 1, 'un seul setDirty(false) dans handleSave');
  assert.match(hs, /onSuccess:\s*\(\)\s*=>\s*setDirty\(false\)/, 'setDirty(false) seulement dans onSuccess');
});

test('R7a — la ligne écrite est relue et la carte « Plafonds du jour » rafraîchie', () => {
  const mutation = sliceBetween(hook, 'const upsertQuota', 'return {');
  assert.match(mutation, /\.upsert\([\s\S]*?\)\s*\.select\(/, 'l\'upsert doit relire la ligne écrite');
  assert.match(mutation, /\.single\(\)/);
  assert.match(mutation, /Champs non enregistrés/, 'un champ envoyé mais non relu doit lever une erreur');
  assert.match(hook, /import \{ LINKEDIN_QUOTA_STATUS_QUERY_KEY \} from '\.\/useLinkedInQuotaStatus'/);
  assert.match(
    mutation,
    /invalidateQueries\(\{ queryKey: \[LINKEDIN_QUOTA_STATUS_QUERY_KEY\] \}\)/,
    'la carte lit la RPC get_linkedin_quota_status : elle doit être invalidée',
  );
});

test('R7a — onglet Équipe : l\'éditeur ne se ferme qu\'après un succès', () => {
  // assert.ok plutôt que assert.match : un échec n'imprime pas tout le fichier.
  const save = sliceBetween(team, 'const handleSaveQuotas', '// Available LinkedIn accounts');
  assert.ok(/onSuccess/.test(save), 'handleSaveQuotas doit fermer l\'éditeur dans onSuccess');
  assert.ok(/isValidMaxActionsPerDay/.test(save), 'handleSaveQuotas doit valider le plafond');
});

// ---------------------------------------------------------------- R7b
test('R7b — une seule borne, alignée sur la base et l\'outil agent', () => {
  const hookMax = Number(hook.match(/export const MAX_ACTIONS_PER_DAY_MAX\s*=\s*(\d+)/)?.[1]);
  const hookMin = Number(hook.match(/export const MAX_ACTIONS_PER_DAY_MIN\s*=\s*(\d+)/)?.[1]);
  const sqlMax = Number(rangeMigration.match(/max_actions_per_day <= (\d+)/)?.[1]);
  const agentMax = Number(agentTools.match(/max < 1 \|\| max > (\d+)/)?.[1]);
  assert.equal(hookMin, 1, 'plancher réel : enforceLinkedInAction borne chaque plafond à 1 au moins');
  assert.equal(hookMax, 500);
  assert.equal(hookMax, sqlMax, 'borne haute = contrainte member_quotas_max_actions_range');
  assert.equal(hookMax, agentMax, 'borne haute = outil update_member_quota');
});

test('R7b — isValidMaxActionsPerDay accepte 1 à 500, entiers seulement', () => {
  const body = hook.match(/export const isValidMaxActionsPerDay = \([^)]*\)[^=]*=>\s*([^;]+);/)?.[1];
  assert.ok(body, 'isValidMaxActionsPerDay introuvable');
  const min = Number(hook.match(/export const MAX_ACTIONS_PER_DAY_MIN\s*=\s*(\d+)/)?.[1]);
  const max = Number(hook.match(/export const MAX_ACTIONS_PER_DAY_MAX\s*=\s*(\d+)/)?.[1]);
  // Le corps est du JavaScript pur (la seule annotation de type est dans la signature).
  const isValid = new Function('v', 'MAX_ACTIONS_PER_DAY_MIN', 'MAX_ACTIONS_PER_DAY_MAX', `return ${body};`);
  const check = (v) => isValid(v, min, max);
  for (const ok of [1, 80, 500]) assert.equal(check(ok), true, `${ok} doit être accepté`);
  for (const ko of [0, -1, 501, 600, 1.5, Number.NaN, null, undefined, '80']) {
    assert.equal(check(ko), false, `${String(ko)} doit être refusé`);
  }
});

test('R7b — écran Sécurité LinkedIn : bornes partagées, plus de 0 à 500', () => {
  assert.match(safety, /MAX_ACTIONS_PER_DAY_MAX/);
  assert.match(safety, /min=\{MAX_ACTIONS_PER_DAY_MIN\}/);
  assert.match(safety, /Valeur entre \{MAX_ACTIONS_PER_DAY_MIN\} et \{MAX_ACTIONS_PER_DAY_MAX\}\./);
  assert.doesNotMatch(safety, LEGACY_BOUNDS);
  assert.match(
    safety,
    /const capValid = !isAdmin \|\| isValidMaxActionsPerDay\(maxActionsPerDay\);/,
    'un membre n\'envoie pas le plafond : il ne doit pas être bloqué par sa valeur',
  );
});

test('R7b — onglet Équipe : bornes partagées, plus de 200', () => {
  assert.ok(/MAX_ACTIONS_PER_DAY_MAX/.test(team), 'TeamManagement doit utiliser la borne partagée');
  assert.ok(!LEGACY_BOUNDS.test(team), 'TeamManagement garde une borne héritée (200 ou min 0)');
});

// ---------------------------------------------------------------- R7c
test('R7c — les séquences transmettent l\'organisation au gate quota', () => {
  const fn = sliceBetween(sequences, 'async function checkQuotaForAction', 'async function checkStepCondition');
  assert.match(fn, /organizationId\?: string \| null/, 'checkQuotaForAction doit recevoir l\'organisation');
  assert.match(fn, /organizationId: organizationId \?\? null/, 'et la passer à enforceLinkedInAction');
  const call = sliceBetween(sequences, 'await checkQuotaForAction(', 'if (!quotaCheck.allowed)');
  assert.match(call, /enrollmentOrgId/);
});

test('R7c — la file InMail transmet l\'organisation au gate quota', () => {
  const gate = sliceBetween(inmailQueue, 'const gate = await enforceLinkedInAction', 'if (!gate.allowed)');
  assert.match(gate, /organizationId: item\.organization_id \?\? orgIdByUser\.get\(item\.created_by\) \?\? null/);
});

// ---------------------------------------------------------------- R7d
test('R7d — heures ouvrées contrôlées avant le gate qui journalise l\'action', () => {
  const loop = sliceBetween(
    sequences,
    'const enrollmentOrgId = enrollment.organization_id',
    '// Check LinkedIn account health before executing',
  );
  const hoursAt = loop.indexOf('!isWithinBusinessHours(userTimezone');
  const gateAt = loop.indexOf('await checkQuotaForAction(');
  assert.notEqual(hoursAt, -1, 'contrôle des heures ouvrées introuvable dans la boucle');
  assert.notEqual(gateAt, -1, 'gate quota introuvable dans la boucle');
  assert.ok(hoursAt < gateAt, 'une étape hors plage ne doit plus consommer une place du plafond');
  assert.equal(loop.split('const userTimezone =').length - 1, 1, 'le bloc est déplacé, pas dupliqué');
});

// ---------------------------------------------------------------- R5f
test('R5f — le hook expose l\'erreur de lecture et verrouille l\'écriture', () => {
  assert.match(hook, /isLoading, isSuccess, isError, refetch \} = useQuery/);
  const lockAt = hook.search(/getQueryState\(\['member-quotas', organizationId\]\)\?\.status !== 'success'/);
  assert.notEqual(lockAt, -1, 'verrou d\'écriture introuvable');
  assert.ok(lockAt < hook.indexOf('.upsert('), 'le verrou doit précéder l\'upsert');
  const ret = hook.slice(hook.lastIndexOf('return {'));
  assert.match(ret, /\bisError,/);
  assert.match(ret, /\brefetch,/);
  // C19 : « lu avec succès » distinct de « pas encore lu » (isLoading est faux quand la requête est désactivée)
  assert.match(ret, /isReady: isSuccess,/);
});

test('R5f — écran Sécurité LinkedIn : bloc d\'erreur au lieu des valeurs par défaut', () => {
  assert.doesNotMatch(safety, /\[userId, getQuotaForUser\]/);
  assert.match(safety, /import \{ ErrorBox \} from '@\/components\/marketplace\/ErrorBox'/);
  assert.match(safety, /<ErrorBox/);
  const errorAt = safety.indexOf('isError ?');
  assert.notEqual(errorAt, -1);
  assert.ok(errorAt < safety.indexOf('id="start-hour"'), 'en erreur, aucun champ ni « Enregistrer »');
  assert.match(safety, /onRetry=\{\(\) => \{ void refetch\(\); \}\}/);
});

test('R5f — onglet Équipe : bloc d\'erreur au lieu de 80', () => {
  assert.ok(/trailing=\{!isEditingQ && !quotasError &&/.test(team), '« Modifier » doit être masqué en erreur');
  const errorAt = team.indexOf('quotasError ?');
  assert.ok(errorAt !== -1 && errorAt < team.indexOf('QUOTA_FIELDS.map'), 'bloc d\'erreur avant les champs de quota');
});

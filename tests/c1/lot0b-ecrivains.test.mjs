/**
 * Refonte mission, lot 0b : garde-fous statiques des écrivains de l'étape
 * candidat (plan final, section 9).
 *
 * Même forme que c1-fonctions.test.mjs : lecture du source et assertions sur
 * les motifs, sans navigateur, sans base ni runtime Deno. Chaque sous-lot
 * ajoute ici ses assertions, pour que la CI de chaque PR reste verte.
 *
 * Lancer : node --test tests/c1/lot0b-ecrivains.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD) : c'est
 * ainsi qu'on vérifie que ces tests échouent sur le code d'origine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Corps d'une fonction de premier niveau : de sa déclaration à la première
// accolade fermante en colonne 0.
function fnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} introuvable`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `fin de ${signature} introuvable`);
  return src.slice(start, end);
}

// Corps d'un hook déclaré par `const nom = useCallback(` : jusqu'à la fin de
// son tableau de dépendances.
function callbackBody(src, name) {
  const start = src.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `${name} introuvable`);
  const end = src.indexOf('\n  }, [', start);
  assert.ok(end > start, `fin de ${name} introuvable`);
  return src.slice(start, end);
}

const SCORE = 'supabase/functions/score-profile-job/index.ts';
const SCORING_HOOK = 'src/hooks/useLinkedInScoring.ts';
const JCS_HOOK = 'src/hooks/useJobCandidateStatus.ts';

// ─── 0b-3 : la notation n'écrit plus l'étape ni « écarté » ──────────────────

test('0b-3 : score-profile-job n\'écrit plus jamais « dismissed »', () => {
  const src = read(SCORE);
  assert.doesNotMatch(src, /'dismissed'|"dismissed"/);
  const body = fnBody(src, 'async function syncJobCandidateStatus(');
  assert.match(body, /const status = 'scored';/);
  assert.doesNotMatch(body, /pipeline_stage/, 'la notation ne touche pas l\'étape');
  assert.match(body, /skip_reason: result\.skipReason/, 'raison de la suggestion d\'écart, si présente');
  // La raison de l'IA n'est écrite que sur les lignes au stade de la notation :
  // jamais dans la mise à jour « note seule », qui vise aussi les écartés par l'utilisateur.
  const noteStart = body.indexOf('const note = {');
  const noteEnd = body.indexOf('\n    };\n', noteStart);
  assert.ok(noteStart > 0 && noteEnd > noteStart, 'objet note introuvable');
  assert.doesNotMatch(body.slice(noteStart, noteEnd), /skip_reason/, 'skip_reason absent de la note seule');
  assert.match(body, /\.update\(\{ \.\.\.note, status, \.\.\.\(result\.skipReason \? \{ skip_reason: result\.skipReason \} : \{\}\) \}\)/);
  assert.match(src, /const AI_REWRITABLE_STATUSES = \['new', 'discovered', 'untreated', 'scored'\];/);
});

test('0b-3 : useLinkedInScoring n\'archive plus après notation', () => {
  const src = read(SCORING_HOOK);
  assert.doesNotMatch(src, /\bbatchDismiss\b/, 'plus aucun archivage par la notation');
  assert.doesNotMatch(src, /Profil écarté/);
  assert.doesNotMatch(src, /écarté\$\{/, 'le bilan ne parle plus d\'écartés');
  assert.match(src, /peu adapté\$\{[^}]*\}, à confirmer/);
  // Toutes les notes réelles passent par batchSaveScores, raison comprise.
  assert.match(src, /const realScoredProfiles = \[\.\.\.goodScoreProfiles, \.\.\.lowScoreProfiles\];/);
  assert.match(src, /batchSaveScores\(realScoredProfiles\)/);
  assert.match(src, /skipReason: result\.summary \|\| 'Score insuffisant'/);
});

test('0b-3 : les résultats factices d\'un 429 ne sont pas enregistrés', () => {
  const src = read(SCORING_HOOK);
  const placeholder = src.indexOf("summary: 'Rate limited - réessayez plus tard'");
  assert.ok(placeholder > 0, 'résultat factice introuvable');
  assert.match(src.slice(placeholder, placeholder + 600), /rateLimitedPlaceholder: true/);
  const skip = src.indexOf('if (rawResult?.rateLimitedPlaceholder) return;');
  const push = src.indexOf('lowScoreProfiles.push(');
  assert.ok(skip > 0 && skip < push, 'le résultat factice sort avant les listes à enregistrer');
});

test('0b-3 : une note n\'écrit plus le statut dans l\'upsert (N10, N11)', () => {
  const src = read(JCS_HOOK);
  assert.match(src, /const SCORABLE_STATUSES = \['new', 'discovered', 'untreated'\];/);
  const mark = fnBody(src, 'async function markScored(');
  assert.match(mark, /\.update\(\{ status: 'scored' \}\)/);
  assert.match(mark, /\.in\('id', /);
  assert.match(mark, /\.in\('status', SCORABLE_STATUSES\)/);
  const payloads = [['saveScore', '.upsert({', 'onConflict'], ['batchSaveScores', 'const toRecord', '\n      };\n']];
  for (const [name, payloadStart, payloadEnd] of payloads) {
    const body = callbackBody(src, name);
    const from = body.indexOf(payloadStart);
    const to = body.indexOf(payloadEnd, from);
    assert.ok(from > 0 && to > from, `${name} : charge de l'upsert introuvable`);
    assert.doesNotMatch(body.slice(from, to), /\bstatus:/, `${name} : aucun statut dans l'upsert`);
    assert.doesNotMatch(body, /keepStatus/, `${name} : ancienne règle de statut`);
    assert.match(body, /await markScored\(/, `${name} : passage à scored filtré ensuite`);
    // Statut local d'abord (fusion des deux formes de job_id), puis celui relu en base.
    assert.match(body, /statusAfterScore\(existing\?\.status, saved\?\.(\[0\]\?\.)?status\)/,
      `${name} : état local aligné sur la base`);
  }
  const scoring = fnBody(src, 'function isScoringStatus(');
  assert.match(scoring, /SCORABLE_STATUSES\.includes\(status\)/);
  const after = fnBody(src, 'function statusAfterScore(');
  assert.match(after, /if \(!isScoringStatus\(local\)\) return local/, 'un statut local avancé est gardé');
  // Un échec de passage à scored remonte (pas d'état local « scored » menteur).
  assert.match(mark, /if \(error\) throw error;/);
  // En lot : passage à scored juste après l'upsert de chaque groupe, dans la boucle.
  const batch = callbackBody(src, 'batchSaveScores');
  const loop = batch.slice(batch.indexOf('for (const group of groups)'), batch.indexOf('// Update local state'));
  assert.match(loop, /await markScored\(/, 'markScored dans la boucle des groupes');
  assert.equal(batch.match(/await markScored\(/g).length, 1, 'un seul appel, dans la boucle');
  // Rechargement : une ligne au stade de la notation ne masque pas l'autre forme de job_id plus avancée.
  const fetch = callbackBody(src, 'fetchStatuses');
  assert.match(fetch, /status: isScoringStatus\(base\.status\) && !isScoringStatus\(other\.status\) \? other\.status : base\.status/);
});

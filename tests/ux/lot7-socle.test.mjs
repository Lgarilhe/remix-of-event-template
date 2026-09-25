/**
 * Chantier design, lot 7 : barème unique du score et vocabulaire des
 * décisions.
 *
 * Un même score a une seule couleur partout (E-11, E-15) ; une décision se
 * dit en français, jamais par sa clé (E-16). Les modules purs sont transpilés
 * en mémoire par esbuild (patron de notification-kinds.test.mjs).
 *
 * Lancer : node --test tests/ux/lot7-socle.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const load = async (rel) => {
  const { code } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

const scale = await load('src/lib/scoreScale.ts');
const verdicts = await load('src/lib/verdicts.ts');

test('E-15 : seuils du moteur de scoring, 65 et 50', () => {
  // Mêmes seuils que les verdicts du moteur (GOOD_MATCH, POSSIBLE_MATCH).
  const engine = read('supabase/functions/score-profile-job/index.ts');
  assert.match(engine, /score >= 65\) return "GOOD_MATCH"/);
  assert.match(engine, /score >= 50\) return "POSSIBLE_MATCH"/);
  assert.equal(scale.scoreLevel(65), 'strong');
  assert.equal(scale.scoreLevel(64), 'medium');
  assert.equal(scale.scoreLevel(50), 'medium');
  assert.equal(scale.scoreLevel(49), 'weak');
  assert.equal(scale.scoreLevel(null), null);
});

test('E-15 : un score faible reste gris, jamais rouge', () => {
  assert.equal(scale.SCORE_LEVELS.weak.tone, 'muted');
  assert.equal(scale.SCORE_LEVELS.medium.tone, 'warning');
  assert.equal(scale.SCORE_LEVELS.strong.tone, 'success');
});

test('E-15 : score borné, arrondi, et nom accessible en mots', () => {
  assert.equal(scale.normalizeScore(72.4), 72);
  assert.equal(scale.normalizeScore(130), 100);
  assert.equal(scale.normalizeScore(-3), 0);
  assert.equal(scale.scoreAccessibleLabel(72), 'Score 72 sur 100, fort');
  assert.equal(scale.scoreAccessibleLabel(undefined), 'Pas encore de score');
});

test('E-16 : une décision se lit en français, quelle que soit sa clé d’origine', () => {
  assert.equal(verdicts.hiringVerdictMeta('strong_yes').label, 'Oui, clairement');
  assert.equal(verdicts.hiringVerdictMeta('GO').label, 'Oui');
  assert.equal(verdicts.hiringVerdictMeta('NO_GO').label, 'Non');
  assert.equal(verdicts.hiringVerdictMeta('MAYBE').label, 'À revoir');
  assert.equal(verdicts.hiringVerdictMeta('go').label, 'Oui');
  assert.equal(verdicts.hiringVerdictMeta('pending').label, 'En attente');
  assert.equal(verdicts.hiringVerdictMeta('inconnu'), null);
  assert.equal(verdicts.aiRecommendationMeta('shortlist').label, 'Recommandé');
  assert.equal(verdicts.aiRecommendationMeta('skip').label, 'Peu adapté');
  for (const table of [verdicts.HIRING_VERDICTS, verdicts.AI_RECOMMENDATIONS]) {
    for (const [key, meta] of Object.entries(table)) {
      assert.doesNotMatch(meta.label, /Yes|No\b|Maybe|Go\b|_/, `${key} : « ${meta.label} »`);
    }
  }
});

test('E-16 : types d’entretien en français', () => {
  assert.equal(verdicts.interviewTypeLabel('phone_screen'), 'Préqualification');
  assert.equal(verdicts.interviewTypeLabel('culture_fit'), 'Adéquation culturelle');
  assert.equal(verdicts.interviewTypeLabel('autre'), 'Entretien');
});

test('ScoreBadge : un seul rendu, le nombre à l’écran, le niveau dans le nom', () => {
  const badge = read('src/components/ui/score-badge.tsx');
  assert.match(badge, /scoreAccessibleLabel\(value\)/);
  assert.match(badge, /variant=\{meta\.tone\}/);
  assert.doesNotMatch(badge, /%|\/100/, 'le dénominateur ne s’affiche pas');
});

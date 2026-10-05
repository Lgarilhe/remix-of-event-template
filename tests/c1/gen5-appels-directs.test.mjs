/**
 * Garde-fous statiques des appels directs à l'API Anthropic face aux modèles
 * génération 5 (Sonnet 5.5, Opus 5.5).
 *
 * Ces modèles réfléchissent par défaut : la réponse commence par un bloc
 * "thinking" (texte vide) avant le bloc "text", donc content[0].text est vide ;
 * leurs tokens comptent dans max_tokens ; une température hors défaut, un
 * tool_choice forcé et thinking.budget_tokens sont refusés (400). Les sept
 * fonctions ci-dessous reçoivent un modèle choisi par l'utilisateur ou
 * l'organisation, `claude-*` accepté tel quel.
 *
 * Même forme que lot0c-lectures.test.mjs : lecture du source, aucun runtime.
 * Le comportement des aides est testé dans _shared/gen5-models.test.ts (Deno).
 *
 * Lancer : node --test tests/c1/gen5-appels-directs.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de origin/main).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const fn = (name) => read(`supabase/functions/${name}/index.ts`);
// Source sans les lignes de commentaire : un mot cité dans un commentaire n'est pas un envoi.
const code = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const FUNCTIONS = [
  'generate-search-filters',
  'nl-filter-edit',
  'refine-search-filters',
  'generate-outreach-message',
  'sequence-send-email',
  'process-sequences',
  'search-agent-chat',
];

for (const name of FUNCTIONS) {
  test(`${name} : importe les aides génération 5 et les applique à l'appel`, () => {
    const src = code(fn(name));
    assert.match(src, /from ["']\.\.\/_shared\/gen5-models\.ts["']/, 'import de _shared/gen5-models.ts');
    assert.match(src, /withThinkingHeadroom\(/, 'marge de max_tokens pour la réflexion');
    assert.match(src, /\.\.\.gen5Params\(/, 'output_config.effort sur la génération 5');
  });

  test(`${name} : ne lit jamais content[0] (c'est un bloc thinking sur la génération 5)`, () => {
    const src = code(fn(name));
    assert.doesNotMatch(src, /content\??\.?\[0\]/, 'content[0] ou content?.[0]');
  });

  test(`${name} : aucun tool_choice posé`, () => {
    // Le tool_choice forcé ("tool" ou "any") est refusé (400) sur la génération 5.
    assert.doesNotMatch(code(fn(name)), /tool_choice\s*[:=]/);
  });
}

test('aucune température dans les appels directs, hors les deux appels Haiku de search-agent-chat', () => {
  for (const name of FUNCTIONS.filter((n) => n !== 'search-agent-chat')) {
    assert.doesNotMatch(code(fn(name)), /temperature/, `${name} : temperature`);
  }
  // Deux appels callClaudeCompat à modèle codé en dur (titre, classifieur) : jamais gen 5.
  const lines = code(fn('search-agent-chat')).split('\n');
  const hits = lines.map((l, i) => (/temperature\s*:/.test(l) ? i : -1)).filter((i) => i >= 0);
  assert.equal(hits.length, 2, 'les deux seules températures de search-agent-chat');
  for (const i of hits) {
    const around = lines.slice(Math.max(0, i - 3), i).join('\n');
    assert.match(around, /model:\s*"claude-haiku-4-5-20251001"/, `température ligne ${i} : modèle Haiku codé en dur juste avant`);
  }
});

test('search-agent-chat : la boucle d\'outils garde les blocs thinking, tels quels', () => {
  const src = code(fn('search-agent-chat'));
  // Le flux : un bloc de réflexion est reconstruit (texte et signature), pas transformé en bloc texte vide.
  assert.match(src, /cb\.type === "thinking" \|\| cb\.type === "redacted_thinking"/);
  assert.match(src, /delta\?\.type === "thinking_delta"/);
  assert.match(src, /delta\?\.type === "signature_delta"/);
  // Le tour assistant renvoyé après un tool_use (et un pause_turn) les contient.
  const filter = src.match(/const roundContent = roundBlocks\.filter\([\s\S]*?\)\);/);
  assert.ok(filter, 'filtre de roundContent introuvable');
  assert.match(filter[0], /b\.type === 'thinking'/);
  assert.match(filter[0], /b\.type === 'redacted_thinking'/);
});

test('search-agent-chat : thinking.budget_tokens réservé aux modèles hors génération 5', () => {
  const src = code(fn('search-agent-chat'));
  const i = src.indexOf('budget_tokens');
  assert.ok(i >= 0, 'budget_tokens attendu pour la génération 4.6');
  assert.match(src.slice(Math.max(0, i - 200), i), /isGen5Model\(resolvedModel\)/, 'budget_tokens doit suivre un test isGen5Model');
  assert.match(src, /type: "adaptive", display: "summarized"/);
});

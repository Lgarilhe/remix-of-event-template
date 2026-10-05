// Tests des aides pour les modèles génération 5 (appels directs à /v1/messages).
//
//   deno test --no-check supabase/functions/_shared/gen5-models.test.ts
//
// Aucun import distant : le test tourne hors réseau.

import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  GEN5_THINKING_HEADROOM,
  gen5Params,
  isGen5Model,
  textFromContent,
  withThinkingHeadroom,
} from './gen5-models.ts';

Deno.test('isGen5Model : Sonnet 5.x et Opus 5.x seulement', () => {
  for (const id of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-opus-5']) {
    strictEqual(isGen5Model(id), true, id);
  }
  for (const id of ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929', '']) {
    strictEqual(isGen5Model(id), false, id);
  }
});

Deno.test('withThinkingHeadroom : marge de réflexion sur la génération 5 seulement', () => {
  strictEqual(withThinkingHeadroom('claude-sonnet-5-5', 150), 150 + GEN5_THINKING_HEADROOM);
  strictEqual(withThinkingHeadroom('claude-opus-5-5', 2048), 2048 + GEN5_THINKING_HEADROOM);
  strictEqual(withThinkingHeadroom('claude-sonnet-4-6', 150), 150);
  strictEqual(withThinkingHeadroom('claude-haiku-4-5-20251001', 500), 500);
});

Deno.test('gen5Params : effort bas par défaut, rien sur la génération 4', () => {
  deepStrictEqual(gen5Params('claude-sonnet-5-5'), { output_config: { effort: 'low' } });
  deepStrictEqual(gen5Params('claude-opus-5-5', 'medium'), { output_config: { effort: 'medium' } });
  deepStrictEqual(gen5Params('claude-sonnet-4-6'), {});
  deepStrictEqual(gen5Params('claude-haiku-4-5-20251001', 'medium'), {});
});

Deno.test('textFromContent : lit le bloc texte, pas content[0]', () => {
  // Génération 5 : le bloc "thinking" (texte vide) passe avant le texte.
  strictEqual(
    textFromContent([{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: '{"ok":true}' }]),
    '{"ok":true}',
  );
  // Génération 4 : le texte est en tête, même résultat qu'avant.
  strictEqual(textFromContent([{ type: 'text', text: 'bonjour' }]), 'bonjour');
});

Deno.test('textFromContent : réponse sans texte, vide ou absente', () => {
  strictEqual(textFromContent([{ type: 'thinking', thinking: '', signature: 'sig' }]), '');
  strictEqual(textFromContent([]), '');
  strictEqual(textFromContent(undefined), '');
  strictEqual(textFromContent(null), '');
  strictEqual(textFromContent({ type: 'text', text: 'pas un tableau' }), '');
  strictEqual(textFromContent([null, { type: 'text' }]), '');
});

/**
 * Lot 5e-2 (style et niveau de l'IA qui rédige), écrans. Contrat :
 * docs/refonte-mission/lot5-plan.md, section 5e-2.
 *
 * - parité navigateur et serveur : valeurs, défauts, longueurs, résumé,
 *   niveaux, table des modèles, coûts par niveau, préautorisation au prix du
 *   niveau ;
 * - aucune zone de saisie à commandes IA (AiTextarea) dans les fenêtres de
 *   prise de contact ; aucun « Tutoiement » ni nom de modèle dans les écrans
 *   du lot ;
 * - « Votre style » et les consignes ne s'écrasent pas (ligne relue, clés
 *   propres seulement) ; carte du niveau modifiable par le seul propriétaire,
 *   par updateOrganization, agency_permissions fusionné ;
 * - coût affiché pour chaque niveau avant de lancer ; ai_level et style
 *   envoyés par l'assistant de rédaction, « Demander à l'IA », la préparation,
 *   « Relire le message » et les deux fenêtres de message ;
 * - l'exemple écrit sans IA vouvoie, pour chaque combinaison de réglages.
 *
 * Sans navigateur ni base. Lancer : node --test tests/ux/lot5e2-style-niveau.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const codeOf = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

async function loadBundle(rel) {
  const { outputFiles } = buildSync({
    entryPoints: [join(ROOT, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT, 'tsconfig.app.json'),
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

const browser = await loadBundle('src/lib/writingStyle.ts');
const server = await loadBundle('supabase/functions/_shared/writing-style.ts');
const credits = await loadBundle('src/types/aiCredits.ts');
const serverConfig = await loadBundle('supabase/functions/_shared/ai-config.ts');
const draft = await loadBundle('src/lib/sequenceDraft.ts');
const details = await loadBundle('src/components/agent/writingDetails.ts');

/** Textes visibles d'un fichier : littéraux de chaîne et texte JSX, hors imports et commentaires. */
function visibleTexts(rel) {
  const code = codeOf(rel).replace(/^import .*$/gm, '');
  const literals = [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  const jsx = [...code.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]);
  return [...literals, ...jsx].join('\n');
}

const SCREENS = [
  'src/lib/writingStyle.ts',
  'src/components/ai/WritingStyleFields.tsx',
  'src/components/ai/AiLevelPicker.tsx',
  'src/components/ai/WritingSettingsLine.tsx',
  'src/components/settings/WritingStyleCard.tsx',
  'src/components/settings/AiLevelSettings.tsx',
  'src/components/agent/writingDetails.ts',
  'src/components/sequences/ai/AIDraftWizard.tsx',
  'src/components/sequences/ai/AskAIMenu.tsx',
];

const ALL_STYLES = (() => {
  const out = [];
  for (const length of browser.STYLE_VALUES.length)
    for (const tone of browser.STYLE_VALUES.tone)
      for (const spontaneity of browser.STYLE_VALUES.spontaneity)
        for (const hook of browser.STYLE_VALUES.hook)
          for (const cta of browser.STYLE_VALUES.cta) out.push({ length, tone, spontaneity, hook, cta });
  return out;
})();

// ─── Parité ─────────────────────────────────────────────────────────────────

test('parité : valeurs fermées, défauts, longueurs et niveaux identiques au serveur', () => {
  assert.deepEqual(browser.STYLE_VALUES, server.STYLE_VALUES);
  assert.deepEqual(browser.DEFAULT_WRITING_STYLE, server.DEFAULT_WRITING_STYLE);
  assert.deepEqual(browser.LENGTH_TARGETS, server.LENGTH_TARGETS);
  assert.deepEqual(browser.AI_LEVELS, server.AI_LEVELS);
  assert.deepEqual(browser.AI_LEVEL_LABELS, server.AI_LEVEL_LABELS);
  assert.equal(browser.DEFAULT_AI_LEVEL, server.DEFAULT_AI_LEVEL);
  assert.equal(browser.DEFAULT_AI_LEVEL_MAX, server.DEFAULT_AI_LEVEL_MAX);
  assert.deepEqual(credits.WRITING_LEVEL_MODELS, serverConfig.WRITING_LEVEL_MODELS, 'table des niveaux : miroir exact de ai-config.ts');
  // Les choix de l'écran sont les valeurs fermées, dans le même ordre.
  for (const key of browser.STYLE_KEYS) {
    assert.deepEqual(browser.STYLE_FIELDS[key].options.map((o) => o.value), browser.STYLE_VALUES[key], key);
  }
});

test('parité : résumé, anciens tons, lecture tolérante et niveaux de l’organisation', () => {
  // Même résumé, à l'apostrophe près (typographique dans le navigateur).
  const apostrophes = (t) => t.replace(/’/g, "'");
  for (const style of ALL_STYLES) assert.equal(apostrophes(browser.styleSummary(style)), apostrophes(server.styleSummary(style)));
  for (const tone of ['professional', 'formal', 'vous', 'casual', 'tu', 'enthusiastic', 'empathetic', 'direct', 'concise', 'inconnu', null]) {
    assert.deepEqual(browser.styleFromLegacyTone(tone), server.styleFromLegacyTone(tone), String(tone));
    assert.notEqual(browser.styleFromLegacyTone(tone).spontaneity, 'spontane', 'un ancien ton ne donne jamais « spontané »');
  }
  for (const raw of [null, {}, { length: 'court', tone: 'zzz' }, 'texte', { ...browser.DEFAULT_WRITING_STYLE, cta: 'agenda' }]) {
    assert.deepEqual(browser.normalizeWritingStyle(raw, 'tu'), server.normalizeWritingStyle(raw, 'tu'));
  }
  for (const permissions of [null, {}, { ai_writing: { level: 'avance', max: 'equilibre' } }, { ai_writing: { level: 'x', max: 'y' } }, { hide_payments_from_members: true, ai_writing: { level: 'rapide', max: 'rapide' } }]) {
    assert.deepEqual(browser.normalizeOrgLevels(permissions), server.normalizeOrgLevels(permissions));
  }
});

test('coûts par niveau : formule du garde serveur, et préautorisation au prix du niveau', () => {
  for (const action of ['sequence_draft', 'outreach_message', 'rewrite_text']) {
    for (const level of browser.AI_LEVELS) {
      assert.equal(browser.levelCredits(action, level), server.levelCredits(action, level), `${action} ${level}`);
      // invokeWithCredits résout le modèle par resolveModel(tier, modelOverride, …) : avec le modèle du niveau, même estimation.
      const tier = credits.ACTION_COSTS[action].routingTier;
      const model = credits.resolveModel(tier, browser.modelForLevel(level), null, action);
      assert.equal(model, browser.modelForLevel(level));
      assert.equal(credits.estimateCredits(action, model), browser.levelCredits(action, level));
    }
  }
  assert.deepEqual(browser.AI_LEVELS.map((l) => browser.levelCredits('sequence_draft', l)), [3, 7, 11]);
  assert.deepEqual(browser.AI_LEVELS.map((l) => browser.levelCredits('outreach_message', l)), [2, 5, 8]);
  assert.deepEqual(browser.AI_LEVELS.map((l) => browser.levelCredits('rewrite_text', l)), [1, 2, 3]);
  assert.equal(browser.levelCostsSentence('outreach_message'), 'Un message d’approche coûte environ 2 crédits en Rapide, 5 en Équilibré, 8 en Avancé.');
  assert.equal(browser.levelLimitSentence('equilibre'), 'Votre organisation limite le niveau à Équilibré.');
  assert.equal(browser.levelLimitSentence('avance'), null);
  // Libellés du sélecteur de modèle alignés sur les niveaux : un même mot, un même modèle.
  for (const level of browser.AI_LEVELS) {
    assert.equal(credits.MODEL_CATALOG[browser.modelForLevel(level)].name, browser.AI_LEVEL_LABELS[level]);
  }
});

test('préautorisation : chaque appel d’un rédacteur par invokeWithCredits passe le modèle du niveau', () => {
  const files = [
    'src/hooks/useEnrollmentPreview.ts',
    'src/components/outreach/activity-log/proposeAiMessage.ts',
    'src/components/outreach/OutreachMessageModal.tsx',
  ];
  for (const rel of files) {
    const src = codeOf(rel);
    const calls = [...src.matchAll(/invokeWithCredits<[\s\S]*?>\(\s*'generate-outreach-message'/g)].length;
    assert.ok(calls > 0, `${rel} : appel attendu`);
    assert.equal([...src.matchAll(/modelOverride: writingFields\.modelOverride/g)].length, calls, `${rel} : modèle du niveau sur chaque appel`);
    assert.equal([...src.matchAll(/\.\.\.writingFields\.body/g)].length, calls, `${rel} : ai_level et style sur chaque appel`);
    assert.doesNotMatch(src, /\btone: (step\.aiTone|step\.ai_tone|tone\b)/, `${rel} : plus d’ancien ton envoyé`);
  }
});

// ─── Corps envoyés ──────────────────────────────────────────────────────────

test('corps : rédaction de séquence, « Demander à l’IA » et rédaction à partir du poste portent ai_level et style', async () => {
  const style = { length: 'detaille', tone: 'chaleureux', spontaneity: 'ecrit', hook: 'entreprise', cta: 'question' };
  const writing = { level: 'avance', style };
  const text = draft.textActionBody('restyle', { organizationId: 'o', missionId: 'm', text: 'Bonjour', actionType: 'message', isFirstMessage: true, writing });
  assert.equal(text.action, 'restyle');
  assert.equal(text.context, 'sequence');
  assert.equal(text.ai_level, 'avance');
  assert.deepEqual(text.style, style);
  const warm = draft.textActionBody('warm', { organizationId: 'o', missionId: null, text: 'Bonjour', actionType: 'message', isFirstMessage: false, writing });
  assert.equal(warm.tone, 'empathetic');
  assert.equal(warm.ai_level, 'avance');
  // Sans réglages lus : rien n'est envoyé, le serveur applique les défauts.
  const bare = draft.textActionBody('shorten', { organizationId: 'o', missionId: null, text: 'Bonjour', actionType: 'message', isFirstMessage: false });
  assert.equal('ai_level' in bare, false);
  const slot = { slot: 'relance_1', firstContact: 'invitation', relances: 1, isFirstMessage: false };
  const brief = draft.briefDraftRequestBody('o', 'm', slot, writing);
  assert.equal(brief.ai_level, 'avance');
  assert.deepEqual(brief.style, style);

  // Préparation, « Relire le message », fenêtres de message : writingRequest, au prix du niveau.
  const preview = await loadBundle('src/hooks/useEnrollmentPreview.ts').catch(() => null);
  const hookSrc = codeOf('src/hooks/useEnrollmentPreview.ts');
  assert.match(hookSrc, /return \{ body: \{ ai_level: writing\.level, style: writing\.style \}, modelOverride: modelForLevel\(writing\.level\) \};/);
  assert.match(hookSrc, /if \(!writing\) return \{ body: \{\}, modelOverride: modelForLevel\(DEFAULT_AI_LEVEL\) \};/);
  if (preview?.writingRequest) {
    assert.deepEqual(preview.writingRequest(writing).body, { ai_level: 'avance', style });
  }
  const bulk = codeOf('src/components/outreach/BulkInMailModal.tsx');
  assert.match(bulk, /\.\.\.\(writing \? \{ ai_level: writing\.level, style: writing\.style \} : \{\}\)/);
  assert.doesNotMatch(bulk, /^\s*tone,$/m);
});

// ─── Écrans ─────────────────────────────────────────────────────────────────

test('aucune zone de saisie à commandes IA dans les fenêtres de prise de contact', () => {
  for (const rel of [
    'src/components/outreach/EnrollmentPreviewModal.tsx',
    'src/components/outreach/OutreachMessageModal.tsx',
    'src/components/outreach/BulkInMailModal.tsx',
    'src/components/outreach/SequenceEnrollModal.tsx',
    'src/components/outreach/activity-log/EditScheduledMessageModal.tsx',
  ]) {
    assert.doesNotMatch(read(rel), /AiTextarea/, rel);
  }
  // La retouche de la préparation est un champ simple ; « Régénérer » passe par le serveur.
  assert.match(codeOf('src/components/outreach/EnrollmentPreviewModal.tsx'), /<Textarea\s+id=\{`\$\{fieldId\}-message`\}/);
});

test('écrans du lot : ni tutoiement proposé, ni nom de modèle, ni tiret long', () => {
  for (const rel of SCREENS) {
    const texts = visibleTexts(rel);
    assert.doesNotMatch(texts, /Tutoiement|tutoyer/i, `${rel} : tutoiement proposé`);
    assert.doesNotMatch(texts, /\b(?:Claude|Haiku|Sonnet|Opus|Anthropic)\b/, `${rel} : nom de modèle`);
    assert.doesNotMatch(texts, /claude-/, `${rel} : identifiant de modèle affiché`);
    assert.doesNotMatch(texts, /—/, `${rel} : tiret long`);
  }
  // Le seul identifiant de modèle du navigateur pour les niveaux : la table miroir.
  assert.doesNotMatch(codeOf('src/lib/writingStyle.ts'), /'claude-/);
  // Consignes de rédaction : plus de choix « Tutoiement » ; une ancienne valeur reste lisible.
  const consignes = codeOf('src/components/settings/AiContextSettings.tsx');
  const options = consignes.slice(consignes.indexOf('const TONE_OPTIONS'), consignes.indexOf('];', consignes.indexOf('const TONE_OPTIONS')));
  assert.doesNotMatch(options, /value: 'tu'/);
  assert.match(consignes, /initial\.tone === 'tu' \|\| form\.tone === 'tu' \? \[\.\.\.TONE_OPTIONS, LEGACY_TU_OPTION\] : TONE_OPTIONS/);
});

test('exemple écrit sans IA : vouvoie pour chaque combinaison, plus long en Détaillé, relance pour le lien d’agenda', () => {
  for (const style of ALL_STYLES) {
    const example = browser.styleExample(style);
    const text = `${example.firstMessage}\n${example.relance ?? ''}`;
    assert.equal(server.hasTutoiement(text, ['Camille', 'Julie', 'Atelier Nord']), false, JSON.stringify(style));
    assert.doesNotMatch(text, /—/);
    assert.equal(example.relance !== null, style.cta === 'agenda');
  }
  const base = { ...browser.DEFAULT_WRITING_STYLE };
  const short = browser.styleExample({ ...base, length: 'court' }).firstMessage.length;
  const standard = browser.styleExample(base).firstMessage.length;
  const long = browser.styleExample({ ...base, length: 'detaille' }).firstMessage.length;
  assert.ok(short < standard && standard < long, 'la longueur se voit dans l’exemple');
  assert.notEqual(browser.styleExample({ ...base, hook: 'poste' }).firstMessage, browser.styleExample(base).firstMessage, 'l’accroche se voit');
});

test('Paramètres : « Votre style » en tête de Rédaction, « Niveau de l’IA qui rédige » après les consignes de l’organisation', () => {
  const sections = codeOf('src/components/settings/shell/sections.tsx');
  const writing = sections.slice(sections.indexOf('const WritingSection'), sections.indexOf('const BillingSection'));
  assert.ok(writing.indexOf('id="style"><WritingStyleCard') >= 0, '#style = « Votre style »');
  assert.ok(writing.indexOf('id="vos-consignes"><UserContextCard') > writing.indexOf('id="style"'), 'consignes ensuite');
  const assistant = sections.slice(sections.indexOf('const AssistantSection'));
  assert.ok(assistant.indexOf('id="niveau-ia"><AiLevelSettings') > assistant.indexOf('id="consignes"'));
  const card = codeOf('src/components/settings/WritingStyleCard.tsx');
  assert.match(card, /Votre style/);
  assert.match(card, /Les messages vouvoient toujours le candidat\./);
  assert.match(card, /Exemple écrit sans IA, pour montrer l’effet de vos réglages\. Chaque vrai message est adapté au candidat et au poste\./);
  assert.match(card, /'Votre style est enregistré\.'/);
  assert.match(card, /'Votre style n’a pas été enregistré\. Réessayez\.'/);
  // Lecture ratée : erreur avec « Réessayer », jamais les défauts montrés comme vos réglages.
  assert.ok(card.indexOf('isError || !prefs ?') < card.indexOf('<WritingStyleForm'));
  assert.equal([...card.matchAll(/variant="primary"/g)].length, 1, 'un seul bouton plein');
});

test('« Votre style » et « Vos consignes » ne s’écrasent pas : ligne relue, clés propres seulement', () => {
  const prefs = codeOf('src/hooks/useWritingPreferences.ts');
  const save = prefs.slice(prefs.indexOf('const saveStyle'), prefs.indexOf('const saveOrgLevels'));
  assert.ok(save.indexOf(".select('ai_context')") < save.indexOf('.update('), 'relue avant l’écriture');
  assert.match(save, /\{ \.\.\.\(isRecord\(current\?\.ai_context\) \? current\.ai_context : \{\}\), writing_style: style \}/);
  const consignes = codeOf('src/hooks/useAiContext.ts');
  assert.match(consignes, /const CONSIGNE_KEYS = \["tone", "specialty", "do", "dont", "free_text"\] as const;/);
  const userSave = consignes.slice(consignes.indexOf('export function useUserAiContext'), consignes.indexOf('export function useOrgAiContext'));
  assert.ok(userSave.indexOf('.select("ai_context")\n        .eq("user_id", user.id)\n        .maybeSingle()') < userSave.indexOf('.update('), 'consignes : ligne relue avant l’écriture');
  assert.match(userSave, /for \(const key of CONSIGNE_KEYS\) merged\[key\] = normalized\[key\];/);
  // normalizeAiContext garde le style (normalisé), clé absente laissée absente.
  assert.match(consignes, /context\.writing_style = normalizeWritingStyle\(r\.writing_style\);/);
});

test('niveau de l’organisation : propriétaire seul, updateOrganization, agency_permissions fusionné, défaut sous le plafond', () => {
  const card = codeOf('src/components/settings/AiLevelSettings.tsx');
  assert.match(card, /const \{ isOwner \} = useOrganization\(\);/);
  assert.equal([...card.matchAll(/editable=\{isOwner\}/g)].length, 2);
  assert.match(card, /Réglé par le propriétaire de l’organisation\./);
  assert.match(card, /Personne ne peut faire rédiger un message d’approche au-dessus de ce niveau\./);
  assert.doesNotMatch(card, /assistant compris/);
  assert.match(card, /levelCostsSentence\('outreach_message'\)/);
  const prefs = codeOf('src/hooks/useWritingPreferences.ts');
  const save = prefs.slice(prefs.indexOf('const saveOrgLevels'));
  assert.ok(save.indexOf(".select('agency_permissions')") < save.indexOf('updateOrganization('));
  assert.match(save, /updateOrganization\(organizationId, \{ agency_permissions: withOrgLevels\(current\?\.agency_permissions, next\) as Json \}\)/);
  // Fusion : les autres clés restent ; un défaut au-dessus du nouveau plafond le suit.
  assert.deepEqual(browser.withOrgLevels({ hide_payments_from_members: true }, { level: 'avance', max: 'equilibre' }), {
    hide_payments_from_members: true, ai_writing: { level: 'equilibre', max: 'equilibre' },
  });
  assert.deepEqual(browser.withOrgLevels(null, { level: 'rapide', max: 'avance' }), { ai_writing: { level: 'rapide', max: 'avance' } });
});

test('coût de chaque niveau avant de lancer : assistant de rédaction, « Demander à l’IA », fenêtres de message', () => {
  const picker = codeOf('src/components/ai/AiLevelPicker.tsx');
  assert.match(picker, /aboutCredits\(choice\.credits\)/);
  assert.match(picker, /const allowed = choices\.filter\(\(c\) => c\.allowed\);/, 'niveaux au-dessus du plafond absents');
  assert.match(picker, /levelLimitSentence\(maxLevel\)/, 'raison écrite');
  const wizard = codeOf('src/components/sequences/ai/AIDraftWizard.tsx');
  assert.match(wizard, /<AiLevelPicker\s+choices=\{prepare\.writing\.levels\}/);
  assert.match(wizard, /aboutCreditsLabel\(draftCostFor\(prepare, settings\?\.level \?\? null\)\)/, 'pied : coût du niveau choisi');
  assert.match(wizard, /<WritingStyleFields compact value=\{settings\.style \?\? prepare\.writing\.style\}/);
  assert.match(wizard, /AGENDA_FALLBACK_SENTENCE/);
  const menu = codeOf('src/components/sequences/ai/AskAIMenu.tsx');
  assert.match(menu, /\{c\.label\}, \{aboutCreditsLabel\(c\.credits\)\}/);
  assert.match(menu, /aboutCreditsLabel\(draftCostEstimate\(level\)\)/);
  assert.match(menu, /<WritingSettingsEditor/);
  const line = codeOf('src/components/ai/WritingSettingsLine.tsx');
  assert.match(line, /Réglages de cette rédaction/);
  assert.match(line, /Revenir à mon style/);
  for (const rel of ['src/components/outreach/EnrollmentPreviewModal.tsx', 'src/components/outreach/activity-log/EditScheduledMessageModal.tsx', 'src/components/outreach/OutreachMessageModal.tsx', 'src/components/outreach/BulkInMailModal.tsx']) {
    assert.match(codeOf(rel), /<WritingSettingsLine[\s\S]*?choices=\{writingChoices\('outreach_message'\)\}/, rel);
    assert.doesNotMatch(read(rel), /ModelPicker|MESSAGE_TONES/, `${rel} : ni ton ni modèle nommé`);
  }
  assert.match(codeOf('src/components/outreach/EnrollmentPreviewModal.tsx'), /Les aperçus déjà générés gardent leurs réglages\. Régénérez-les pour appliquer les nouveaux\./);
  assert.equal(
    browser.writingSettingsSentence({ style: browser.DEFAULT_WRITING_STYLE, level: 'equilibre' }, 5, 'par message'),
    'Standard, formel, naturel, accroche sur son parcours, court échange. Niveau Équilibré, environ 5 crédits par message.',
  );
});

test('éditeurs de séquence : plus de ton par étape, la phrase du style à la place', () => {
  for (const rel of ['src/components/sequences/editor/StepPanel.tsx', 'src/components/outreach/sequence/StepEditor.tsx', 'src/components/outreach/SequenceBuilder.tsx']) {
    const src = codeOf(rel);
    assert.doesNotMatch(src, /aiTone: value/, `${rel} : sélecteur de ton`);
    assert.match(src, /\{AI_STEP_STYLE_NOTICE\}/, rel);
  }
  assert.equal(browser.AI_STEP_STYLE_NOTICE, 'Style : celui de la rédaction, choisi avant l’inscription (vos réglages par défaut).');
  // aiTone reste dans la charge enregistrée (aucune perte à l'aller-retour).
  assert.match(read('src/hooks/useSequenceSave.ts'), /ai_tone: step\.aiTone \?\? null/);
});

test('carte de l’assistant et Journal : style et niveau utilisés, style en lecture seule', () => {
  const style = 'Standard, formel, naturel, accroche sur son parcours, court échange';
  assert.equal(
    details.writingDetailsLine('draft_outreach_message', { style_summary: style, ai_level_label: 'Équilibré', estimated_credits: 5 }, 'Rédiger un DM LinkedIn à Julie'),
    `Style : ${style}. Niveau Équilibré, environ 5 crédits.`,
  );
  // Le résumé du serveur dit déjà le niveau : pas de répétition.
  assert.equal(
    details.writingDetailsLine('draft_outreach_message', { style_summary: style, ai_level_label: 'Équilibré', estimated_credits: 5 }, 'Rédiger un DM LinkedIn à Julie (niveau Équilibré, environ 5 crédits)'),
    `Style : ${style}.`,
  );
  assert.equal(details.writingDetailsLine('create_sequence', { style_summary: style, ai_level: 'avance', ai_level_label: 'Avancé' }), 'Rédigée par l’assistant de conversation, d’après votre style. Niveau Avancé.');
  assert.equal(details.writingDetailsLine('create_sequence', { style_summary: style, ai_level: null, ai_level_label: null }), 'Rédigée par l’assistant de conversation, d’après votre style.');
  assert.equal(details.writingDetailsLine('draft_outreach_message', { candidate_name: 'Julie' }), null, 'proposition ancienne : rien de plus');
  assert.equal(details.writingDetailsLine('create_sequence', { steps: [] }), null);
  const card = codeOf('src/components/agent/AgentToolApprovalCard.tsx');
  assert.match(card, /draft_outreach_message: new Set\(\['style', 'tone'\]\)/);
  assert.match(card, /writingDetailsLine\(row\.tool_name, row\.dry_run_result\?\.details, summary\)/);
  assert.match(codeOf('src/components/settings/AgentActionsSettings.tsx'), /writingDetailsLine\(action\.tool_name, action\.dry_run_result\?\.details, summary\)/);
});

test('« Demander à l’IA » : style et niveau de l’éditeur ouvert, jamais enregistrés', () => {
  const editor = codeOf('src/components/sequences/editor/StepsEditor.tsx');
  assert.match(editor, /const \[askAiWriting, setAskAiWriting\] = useState<AskAiWriting \| null>\(null\);/);
  assert.match(editor, /askAI=\{askAIForPanel\}/);
  const menu = codeOf('src/components/sequences/ai/AskAIMenu.tsx');
  assert.match(menu, /briefDraftRequestBody\(context\.organizationId, context\.missionId, slot, writing\)/);
  assert.match(menu, /isFirstMessage: slot\.isFirstMessage,\s*writing,/);
  assert.doesNotMatch(menu, /localStorage|sessionStorage/);
});

// ─── Corrections après relecture (06/10) ────────────────────────────────

test('préparation, Récapitulatif : la même ligne « Rédaction par l’IA » et le niveau nommé à côté des coûts', () => {
  const prep = codeOf('src/components/outreach/EnrollmentPreviewModal.tsx');
  // Une seule ligne, rendue dans les aperçus et dans le Récapitulatif (ouvert par défaut au-delà de 10 candidats).
  assert.equal([...prep.matchAll(/<WritingSettingsLine/g)].length, 1, 'une seule définition de la ligne');
  assert.match(prep, /\{renderWritingLine\('shrink-0 border-b border-border px-4 py-2\.5 sm:px-6'\)\}/);
  assert.match(prep, /writingLine=\{renderWritingLine\('rounded-xl border border-border px-3 py-2\.5'\)\}/);
  const summary = prep.slice(prep.indexOf('function SummaryMode('), prep.indexOf('function SummaryRow('));
  assert.ok(summary.indexOf('{writingLine}') >= 0 && summary.indexOf('{writingLine}') < summary.indexOf('Coût estimé de la personnalisation par l'), 'ligne avant le coût');
  // Avant les aperçus du Récapitulatif et leurs « Générer l'aperçu ».
  assert.ok(summary.indexOf('{writingLine}') < summary.indexOf('title="Aperçu du premier message"'), 'ligne avant le premier « Générer l’aperçu »');
  assert.ok(summary.indexOf('{writingLine}') < summary.indexOf('title="Messages rédigés par l\'IA"'), 'ligne avant les messages rédigés par l’IA');
  assert.match(summary, /\{creditsLabel\(estimatedCredits\)\}<\/strong>\n\s*\{estimatedCredits > 0 \? levelSuffix : ''\}\./);
  assert.match(prep, /const levelSuffix = writing \? ` en \$\{AI_LEVEL_LABELS\[writing\.level\]\}` : '';/);
  // Pied : « Générer tous les aperçus · environ 10 crédits en Équilibré ».
  assert.match(prep, /\{creditsLabel\(bulkMissingAi \* creditsPerMessage\)\}\{bulkMissingAi > 0 \? levelSuffix : ''\}/);
});

test('« Demander à l’IA » › Réglages : focus rendu au bouton, fenêtre et groupe nommés, coûts « par retouche »', () => {
  const menu = codeOf('src/components/sequences/ai/AskAIMenu.tsx');
  assert.match(menu, /<Button ref=\{triggerRef\}/);
  const content = menu.slice(menu.indexOf('<PopoverContent'), menu.indexOf('</PopoverContent>'));
  assert.match(content, /aria-labelledby=\{settingsTitleId\}/);
  assert.match(content, /onCloseAutoFocus=\{\(event\) => \{\n\s*event\.preventDefault\(\);\n\s*triggerRef\.current\?\.focus\(\);/);
  assert.match(content, /<p id=\{settingsTitleId\}[^>]*>\{WRITING_SETTINGS_TITLE\}<\/p>/);
  assert.match(content, /levelCreditsSuffix="par retouche"/);
  // Groupe des niveaux relié à son étiquette ; « Modifier » séparé du résumé par une espace.
  assert.match(menu, /<DropdownMenuLabel id=\{levelLabelId\}/);
  assert.match(menu, /<DropdownMenuRadioGroup\n\s*aria-labelledby=\{levelLabelId\}/);
  assert.match(menu, /<>\{' '\}<span className="text-muted-foreground underline underline-offset-2">Modifier<\/span><\/>/);
  const picker = codeOf('src/components/ai/AiLevelPicker.tsx');
  assert.match(picker, /\{aboutCredits\(choice\.credits\)\}\n\s*\{creditsSuffix \? ` \$\{creditsSuffix\}` : ''\}/);
});

test('ligne « Rédaction par l’IA » : bouton et fenêtre nommés', async () => {
  const line = codeOf('src/components/ai/WritingSettingsLine.tsx');
  assert.match(line, /export const WRITING_SETTINGS_BUTTON_LABEL = 'Modifier les réglages de rédaction';/);
  assert.match(line, /aria-label=\{WRITING_SETTINGS_BUTTON_LABEL\}/);
  assert.match(line, /aria-labelledby=\{titleId\}/);
  assert.match(line, /<p id=\{titleId\}[^>]*>\{WRITING_SETTINGS_TITLE\}<\/p>/);
});

test('niveau refusé par le serveur : la phrase du serveur partout, réglages relus', () => {
  const refused = Object.assign(new Error("Votre organisation n'autorise pas le niveau Avancé. Choisissez Rapide ou Équilibré."), { code: 'AI_LEVEL_NOT_ALLOWED' });
  assert.equal(browser.writingRefusalMessage(refused), refused.message);
  for (const code of ['AI_LEVEL_INVALID', 'STYLE_INVALID', 'AI_ORG_REQUIRED']) {
    assert.equal(browser.writingRefusalMessage({ code, message: 'Phrase.' }), 'Phrase.', code);
  }
  assert.equal(browser.writingRefusalMessage({ code: 'PREVIEW_UNAVAILABLE', message: 'x' }), null);
  assert.equal(browser.writingRefusalMessage(new Error('boom')), null);
  const hook = codeOf('src/hooks/useEnrollmentPreview.ts');
  assert.match(hook, /const refusal = writingRefusalMessage\(err\);\n\s*if \(refusal\) return refusal;/);
  assert.match(hook, /if \(writingRefusalMessage\(err\)\) onWritingRefusedRef\.current\?\.\(\);/);
  assert.match(codeOf('src/components/outreach/EnrollmentPreviewModal.tsx'), /const refreshWritingPreferences = useCallback\(\(\) => \{ void refetchWritingPrefs\(\); \}, \[refetchWritingPrefs\]\);/);
  const propose = codeOf('src/components/outreach/activity-log/proposeAiMessage.ts');
  assert.match(propose, /if \(refusal\) throw Object\.assign\(new Error\(refusal\), \{ code: e\?\.code \}\);/);
  assert.match(codeOf('src/components/outreach/activity-log/EditScheduledMessageModal.tsx'), /if \(writingRefusalMessage\(err\)\) void refetchWritingPrefs\(\);/);
  const modal = codeOf('src/components/outreach/OutreachMessageModal.tsx');
  assert.match(modal, /if \(refusal\) void refetchWritingPrefs\(\);\n\s*toast\.error\(refusal \?\? "Le message n'a pas pu être généré\. Réessayez\."\);/);
  const bulk = codeOf('src/components/outreach/BulkInMailModal.tsx');
  assert.match(bulk, /\} else if \(writingRefusalRef\.current\) \{\n\s*break;/, 'les suivants ne sont pas tentés');
  assert.match(bulk, /if \(writingRefusalRef\.current\) \{\n\s*toast\.error\(writingRefusalRef\.current\);\n\s*return;/);
  const menu = codeOf('src/components/sequences/ai/AskAIMenu.tsx');
  assert.equal([...menu.matchAll(/kind === 'level'\) void refetchPrefs\(\);/g)].length, 2);
});

test('InMail hors séquence : longueurs et format de l’InMail demandés au serveur', () => {
  assert.match(codeOf('src/components/outreach/BulkInMailModal.tsx'), /message_kind: 'inmail',/);
  const modal = codeOf('src/components/outreach/OutreachMessageModal.tsx');
  assert.match(modal, /const messageKind = generationDistance === 'DISTANCE_1' \|\| generationDistance === 1 \? 'message' : 'inmail';/);
  assert.match(modal, /message_kind: messageKind,/);
});

test('Paramètres : ton des consignes nommé pour ce qu’il règle, « Votre style » jamais « Enregistré » sans enregistrement, niveau unique écrit', () => {
  const consignes = codeOf('src/components/settings/AiContextSettings.tsx');
  assert.match(consignes, />Ton de la messagerie et de l’assistant<\/Label>/);
  assert.doesNotMatch(consignes, /className="text-xs font-medium">Ton<\/Label>/);
  assert.match(consignes, /Le ton des messages d’approche se règle\n\s*dans « Votre style », ci-dessus\./);
  const card = codeOf('src/components/settings/WritingStyleCard.tsx');
  assert.match(card, /\{state === 'saved' && !saved \? \(\n\s*<span className="text-xs text-muted-foreground">Réglages par défaut<\/span>/);
  assert.match(codeOf('src/hooks/useWritingPreferences.ts'), /styleSaved: isRecord\(context\.writing_style\),/);
  const levels = codeOf('src/components/settings/AiLevelSettings.tsx');
  assert.match(levels, /const fixed = editable && options\.length === 1;/);
  assert.match(levels, /\{AI_LEVEL_LABELS\[value\]\} \(fixé par le niveau maximal\)/);
});

test('carte de l’assistant : canal en choix fermé, « Modifier » seulement s’il reste un champ modifiable', () => {
  const card = codeOf('src/components/agent/AgentToolApprovalCard.tsx');
  assert.match(card, /\{ value: 'linkedin_dm', label: 'Message LinkedIn' \},\n\s*\{ value: 'linkedin_inmail', label: 'InMail' \},\n\s*\{ value: 'email', label: 'E-mail' \},/);
  assert.match(card, /channel: 'Canal',/);
  assert.match(card, /if \(toolName && CHOICE_FIELDS_BY_TOOL\[toolName\]\?\.\[key\]\) return 'choice';/);
  assert.match(card, /\{hasEditableField\(row\.params, row\.tool_name\) && \(/);
});

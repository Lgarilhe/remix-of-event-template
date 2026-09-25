/**
 * Lot 6 du chantier design, partie 6b : liste et éditeur de séquences.
 * Garde-fous de non-régression sur les constats D-22 à D-43 (hors D-28) et
 * D-65 à D-72 pour ces fichiers (docs/design/audit/D-outreach-messagerie.md).
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
/** Code sans commentaires : on vérifie ce qui s'exécute, pas ce qui est raconté. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const list = code('src/components/outreach/SequencesList.tsx');
const builder = code('src/components/outreach/SequenceBuilder.tsx');
const selector = code('src/components/outreach/SequenceTemplateSelector.tsx');

function filesUnder(rel) {
  const dir = new URL(`../../${rel}/`, import.meta.url);
  return readdirSync(dir).flatMap((name) => {
    const child = `${rel}/${name}`;
    return statSync(new URL(name, dir)).isDirectory() ? filesUnder(child) : [child];
  });
}
const scope = [
  'src/components/outreach/SequencesList.tsx',
  'src/components/outreach/SequenceBuilder.tsx',
  'src/components/outreach/SequenceTemplateSelector.tsx',
  ...filesUnder('src/components/outreach/sequence'),
];

// ---------------------------------------------------------------- D-30
test('D-30 — la création enregistre expéditeurs et garde-fous, comme la modification', () => {
  const settings = list.slice(list.indexOf('const sequenceSettings'), list.indexOf('let targetSequenceId'));
  for (const column of ['stop_conditions', 'sender_accounts', 'rotation_mode', 'multi_sender_enabled']) {
    assert.match(settings, new RegExp(`${column}:`), `${column} doit partir à l'enregistrement`);
  }
  const insert = list.slice(list.indexOf(".from('outreach_sequences')\n          .insert({"), list.indexOf('if (createError)'));
  assert.match(insert, /\.\.\.sequenceSettings/, 'la création doit écrire les mêmes réglages que la modification');
  const update = list.slice(list.indexOf('.update({\n            name: sequence.name'), list.indexOf('if (updateError)'));
  assert.match(update, /\.\.\.sequenceSettings/);
});

test('D-30 — une séquence rouverte garde ses réglages (plus de remise à zéro à l’enregistrement)', () => {
  const edit = list.slice(list.indexOf('const handleEdit'), list.indexOf('const handleCreateNew'));
  assert.match(edit, /stopConditions: seq\.stop_conditions/);
  assert.match(edit, /senderAccounts: seq\.sender_accounts/);
  assert.match(edit, /rotationMode: seq\.rotation_mode/);
  assert.match(edit, /multiSenderEnabled: seq\.multi_sender_enabled/);
});

// ---------------------------------------------------------------- D-31, D-33, D-72
test('D-31 — « Retour » et Échap passent par la même garde', () => {
  assert.match(builder, /Quitter sans enregistrer \?/);
  assert.match(builder, /onClick=\{requestClose\}/, '« Retour » doit demander avant de fermer');
  assert.match(builder, /onEscapeKeyDown=\{\(event\) => \{\s*event\.preventDefault\(\);\s*requestClose\(\);/);
  assert.match(builder, /aria-label="Retour"/, 'la flèche seule sur téléphone doit avoir un nom');
});

test('D-33 — l’éditeur est un Dialog plein écran, sans portail maison ni z-[4000]', () => {
  assert.doesNotMatch(builder, /createPortal/);
  assert.doesNotMatch(builder, /z-\[4000\]/);
  assert.match(builder, /<DialogPrimitive\.Content/);
  assert.match(builder, /aria-modal="true"/);
  assert.match(builder, /<DialogTitle/);
});

// ---------------------------------------------------------------- D-32
test('D-32 — l’en-tête d’étape est un bouton de Collapsible, utilisable au clavier', () => {
  assert.match(builder, /<CollapsibleTrigger asChild>\s*<Button/);
  assert.doesNotMatch(builder, /<div[^>]*onClick=\{\(\) => setExpandedStepId/, 'plus de div cliquable');
});

// ---------------------------------------------------------------- D-34
test('D-34 — une nouvelle séquence n’est active que si l’on choisit de l’activer', () => {
  assert.match(builder, /isActive: false,/, 'séquence vierge inactive');
  assert.match(builder, /isActive: isNewSequence \? activate && canActivate : sequence\.isActive/);
  assert.match(builder, /Enregistrer et activer/);
  assert.match(builder, / sans activer/);
  assert.doesNotMatch(selector, /isActive: true/, 'un modèle ou une copie ne crée pas une séquence active');
  assert.doesNotMatch(builder, /toast\.success\('Séquence enregistrée'\)/, 'un seul toast de succès, posé par la liste');
  assert.doesNotMatch(builder, /description: err instanceof Error \? err\.message/, 'pas de message technique brut');
  const topSave = builder.slice(builder.indexOf("onClick={() => handleSave(false)}") - 400, builder.indexOf("onClick={() => handleSave(false)}"));
  assert.doesNotMatch(topSave, /disabled=\{isSaving \|\| !sequence\.name\.trim\(\)/, 'le bouton ne se grise plus en silence');
});

// ---------------------------------------------------------------- D-35, D-42, D-65
test('D-35 — les étapes viennent du catalogue et restent neutres', () => {
  for (const rel of ['src/components/outreach/SequenceBuilder.tsx', 'src/components/outreach/sequence/VisualSequenceEditor.tsx', 'src/components/outreach/sequence/nodes/WorkflowStepNode.tsx']) {
    const src = code(rel);
    assert.match(src, /SequenceActionIcon/, `${rel} : icône du catalogue`);
    assert.match(src, /sequenceActionLabel/, `${rel} : libellé du catalogue`);
    assert.doesNotMatch(src, /\b(?:bg|text|border)-(?:success|warning|info|destructive|brand-purple|whatsapp)\/10\b/, `${rel} : couleur de statut pour un type`);
  }
  assert.doesNotMatch(code('src/components/outreach/sequence/WorkflowCanvas.tsx'), /hsl\(\d/, 'arêtes en couleur écrite en dur');
});

test('D-42 — nœuds sans agrandissement ni ombre colorée, arêtes immobiles, thème suivi', () => {
  const node = code('src/components/outreach/sequence/nodes/WorkflowStepNode.tsx');
  assert.doesNotMatch(node, /scale-\[/);
  assert.doesNotMatch(node, /shadow-(?:info|success|warning|destructive|whatsapp|brand)/);
  assert.match(node, /ring-brand/);
  const canvas = code('src/components/outreach/sequence/WorkflowCanvas.tsx');
  assert.doesNotMatch(canvas, /animated: true/);
  assert.match(canvas, /colorMode=\{theme\}/, 'sans colorMode, React Flow repasse le canevas en thème clair');
  assert.doesNotMatch(code('src/components/outreach/sequence/nodes/WorkflowAddNode.tsx'), /hover:scale|emerald|orange/);
});

// ---------------------------------------------------------------- D-36
test('D-36 — aperçu neutre et une seule syntaxe de variables', () => {
  for (const rel of scope) {
    const src = read(rel);
    assert.doesNotMatch(src, /Laurent|Garilhe|L\.G\./, `${rel} : nom du fondateur`);
    assert.doesNotMatch(src, /\{\{firstName\}\}/, `${rel} : syntaxe que le moteur ne lit pas`);
  }
  assert.match(builder, /previewMessageTemplate\(/);
});

// ---------------------------------------------------------------- D-38, D-39
test('D-38 — boutons icône nommés, libellés reliés, interrupteurs nommés', () => {
  assert.match(builder, /aria-label=\{`Supprimer l'étape \$\{stepNumber\}/);
  assert.match(builder, /aria-label=\{`Supprimer la variante \$\{v\.variantGroup\}`\}/);
  assert.match(builder, /aria-label="Fermer le choix d'étape"/);
  assert.match(builder, /<Label htmlFor=\{fieldId\('days'\)\}/);
  assert.match(builder, /<Switch id=\{fieldId\('ai'\)\}/);
  assert.match(builder, /<Switch id=\{fieldId\('unsubscribe'\)\}/);
  assert.match(code('src/components/outreach/sequence/nodes/WorkflowStepNode.tsx'), /aria-label=\{`Supprimer l'étape/);
  assert.doesNotMatch(builder, /step dots|motion\.div/i, 'plus de points de progression sans nom');
});

test('D-39 — sous 1 024 px, étapes en ligne et liste de contrôle atteignable', () => {
  assert.match(builder, /<SequenceWizardStepperCompact/);
  assert.match(builder, /lg:hidden/);
  assert.match(builder, /<PopoverContent[\s\S]{0,300}<SequenceValidationChecklist/);
});

// ---------------------------------------------------------------- D-40, D-41, D-43, D-70, D-71
test('D-40 — pas de poignée sans glisser-déposer, délai complet, pas de capitales', () => {
  assert.doesNotMatch(builder, /GripVertical/);
  assert.match(builder, /formatStepDelay\(step\.delayDays, step\.delayHours, step\.delayMinutes\)/);
  assert.doesNotMatch(builder, /'TRIGGER'|'ACTION'/);
  assert.match(builder, /scoreThresholdError/);
});

/** Textes lisibles : littéraux de chaîne et texte JSX, sans les chemins d'import (même règle que le cliquet). */
function visibleText(src) {
  const cleaned = src
    .replace(/\bconsole\.(?:log|warn|error|info|debug)\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/\bfrom\s+(['"])[^'"\n]*\1/g, '')
    .replace(/\bimport\(\s*(['"])[^'"\n]*\1\s*\)/g, '');
  return [
    ...[...cleaned.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]),
    ...[...cleaned.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]),
    ...[...cleaned.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, "")),
    ...[...cleaned.matchAll(/>([^<>{}=;]*[A-Za-zÀ-ÿ][^<>{}=;]*)(?=[<{])/g)].map((m) => m[1]),
  ].join('\n');
}

test('D-41, D-70, D-71 — glossaire français, sans emoji ni tiret long', () => {
  const emoji = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u;
  for (const rel of scope) {
    const text = visibleText(code(rel));
    assert.doesNotMatch(text, emoji, `${rel} : emoji`);
    assert.doesNotMatch(text, /—/, `${rel} : tiret long`);
    for (const word of ['Timeout', 'Step alternatif', 'Multi-sender', 'skippés', 'Round-robin', 'Étapes du wizard', 'Smart Message', 'Charger séquence', 'CC / BCC', 'bouncé', 'Analytics', 'Envoyer tout', 'Funnel', 'Prospects', 'Template']) {
      assert.ok(!text.includes(word), `${rel} : « ${word} » encore affiché`);
    }
  }
});

test('D-43 — registre arrondi, casse d’origine, icône d’erreur lucide', () => {
  assert.doesNotMatch(builder, /font-bold uppercase/);
  assert.doesNotMatch(builder, /❌/);
  assert.doesNotMatch(builder, /text-(?:emerald|amber|green)-\d00/);
});

// ---------------------------------------------------------------- D-22 à D-27, D-29
test('D-22 — un seul chargement, en squelette de tableau', () => {
  assert.doesNotMatch(list, /BrutalLoader/);
  assert.match(list, /role="status" aria-label="Chargement des séquences"/);
  assert.match(list, /<ErrorState/, 'une panne ne s’affiche pas comme une liste vide');
});

test('D-23 — barre d’outils en français, « Avancer les envois » expliqué', () => {
  assert.match(list, /Avancer les envois/);
  assert.match(list, /sauf les invitations LinkedIn/);
  assert.match(list, /Statistiques/);
  assert.match(list, /aria-label="Plus d'actions"/);
});

test('D-24, D-26 — une ligne par séquence, le même menu nommé partout', () => {
  assert.match(list, /aria-label=\{`Actions de la séquence « \$\{seq\.name\} »`\}/);
  assert.match(list, /Enregistrer comme modèle/);
  assert.doesNotMatch(list, /addSuffix: false/, 'la date se lit « il y a … » partout');
  assert.doesNotMatch(list, /SEQUENCE_EMOJIS/);
  assert.match(list, /<ChannelIcon/);
  assert.equal((list.match(/<DropdownMenuContent align="end">/g) || []).length, 1, 'un seul menu de ligne, pour téléphone et ordinateur');
});

test('D-25 — interrupteur nommé, désactivé et expliqué sans abonnement', () => {
  assert.match(list, /aria-label=\{`Activer la séquence « \$\{seq\.name\} »`\}/);
  assert.match(list, /disabled=\{activationBlocked\}/);
  assert.match(list, /Voir les offres/);
  assert.doesNotMatch(list, /scale-90/);
});

test('D-27 — plus de chemin d’inscription mort dans la liste', () => {
  assert.doesNotMatch(list, /selectedProfiles/);
  assert.doesNotMatch(list, /SequenceEnrollModal/);
  assert.doesNotMatch(list, /candidat\(s\) sélectionné\(s\)/);
});

test('D-29 — vouvoiement et « inscriptions » dans les messages', () => {
  assert.doesNotMatch(list, /Active-la quand tu es prêt|Tu pourras|enrollments mis en pause|⚠ Impact/);
  assert.match(list, /Vous pourrez la réactiver à tout moment/);
});

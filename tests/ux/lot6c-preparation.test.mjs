/**
 * Chantier design, lot 6c : inscription en séquence et préparation.
 *
 * Garde-fous des constats D-44 à D-51 et D-53 (docs/design/audit/
 * D-outreach-messagerie.md), et de D-33 et D-72 pour ces fichiers : clavier qui
 * ne vole plus les boutons, action principale monochrome, aperçus payés
 * conservés, un seul vocabulaire, catalogue commun des étapes et des canaux,
 * vraie fenêtre de dialogue.
 *
 * Lancer : node --test tests/ux/lot6c-preparation.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/** Code sans commentaires : ils citent souvent ce qui est proscrit. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const PREVIEW_DIR = 'src/components/outreach/enrollment-preview';
const preparation = code(read('src/components/outreach/EnrollmentPreviewModal.tsx'));
const simple = code(read('src/components/outreach/SequenceEnrollModal.tsx'));
const hook = code(read('src/hooks/useEnrollmentPreview.ts'));
const parts = Object.fromEntries(
  readdirSync(new URL(`../../${PREVIEW_DIR}`, import.meta.url))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => [f, code(read(`${PREVIEW_DIR}/${f}`))]),
);
const all = [preparation, simple, ...Object.values(parts)].join('\n');

/** Textes lisibles : littéraux et texte JSX, sans imports ni journaux (patron du cliquet design). */
const visible = (src) => {
  const cleaned = src
    .replace(/\bconsole\.(?:log|warn|error|info|debug)\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/\bfrom\s+(['"])[^'"\n]*\1/g, '');
  return [
    ...[...cleaned.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]),
    ...[...cleaned.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]),
    ...[...cleaned.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, '')),
    ...[...cleaned.matchAll(/>([^<>{}=;]*[A-Za-zÀ-ÿ][^<>{}=;]*)(?=[<{])/g)].map((m) => m[1]),
  ].join('\n');
};
const texts = [preparation, simple, hook, ...Object.values(parts)].map(visible).join('\n');

// ---------------------------------------------------------------- D-44
test('D-44 : plus aucun raccourci global dans la préparation', () => {
  assert.doesNotMatch(preparation, /window\.addEventListener\(\s*['"]keydown/, 'les touches ne sont plus captées sur toute la page');
  assert.match(preparation, /onKeyDown=\{handleListKeyDown\}/, 'les raccourcis vivent sur la liste des candidats');
});

test('D-44 : Entrée et Espace restent aux boutons, aucune génération au clavier', () => {
  const guard = preparation.slice(preparation.indexOf('function listShortcut'), preparation.indexOf('function mapSteps'));
  assert.ok(guard.length > 0);
  assert.match(guard, /e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey \|\| e\.defaultPrevented/);
  assert.match(guard, /dataset\?\.candidateId/, 'seulement depuis la ligne d’un candidat');
  assert.doesNotMatch(guard, /'Enter'|' '|'Spacebar'/, 'Entrée et Espace ne sont pas interceptées');
  const handler = preparation.slice(preparation.indexOf('const handleListKeyDown'), preparation.indexOf('if (!isOpen) return null;'));
  assert.doesNotMatch(handler, /generate/i, 'aucune génération payante ne part d’une touche');
});

// ---------------------------------------------------------------- D-45
test('D-45 : actions du kit, monochromes, sans effet', () => {
  assert.doesNotMatch(all, /konekt-skalr|konekt-shine|konekt-glow|motion\.button|whileHover/);
  assert.match(preparation, /variant="primary"[\s\S]{0,160}onClick=\{handleEnroll\}/, 'inscrire est l’action principale du kit');
  assert.match(preparation, /variant="outline"[^>]*onClick=\{\(\) => generateAll\(3\)\}/, 'la génération groupée est secondaire');
});

// ---------------------------------------------------------------- D-46
test('D-46 : fermer avec du travail en cours demande confirmation', () => {
  assert.match(preparation, /onOpenChange=\{\(open\) => \{ if \(!open\) requestClose\(\); \}\}/, 'Échap, la croix et « Annuler » passent par la même garde');
  assert.match(preparation, /if \(hasWorkInProgress\) \{\s*setConfirmCloseOpen\(true\);/);
  assert.match(preparation, /<AlertDialog open=\{confirmCloseOpen\}/);
  assert.match(preparation, /previewStats\.kept > 0 \|\| delayChanges > 0 \|\| isBulkGenerating/);
});

test('D-46 : les aperçus générés et les retouches sont conservés pour la session', () => {
  assert.match(hook, /const sessionPreviews = new Map/, 'mémoire de session, rien dans le navigateur');
  assert.doesNotMatch(hook, /localStorage|sessionStorage/, 'aucune donnée de candidat écrite dans le navigateur');
  assert.match(hook, /useState<PreviewMap>\(\(\) => restoreFromSession\(sessionKey, steps, profiles\)\)/);
  assert.match(hook, /signatures\.get\(stepId\) === entry\.signature/, 'une étape modifiée depuis ne reprend pas un vieil aperçu');
  assert.match(preparation, /useEnrollmentPreview\(\{ steps, profiles, job, accountId, sessionKey \}\)/);
  assert.match(preparation, /discardSessionPreviews\(enrolledIds\)/, 'les candidats inscrits libèrent leurs aperçus');
});

test('D-46 : la génération groupée n’écrase jamais une retouche', () => {
  assert.match(hook, /if \(existing && \(existing\.isGenerated \|\| existing\.isEdited\)\) continue;/);
  assert.doesNotMatch(hook, /existing\?\.isGenerated && !existing\.isEdited/);
});

// ---------------------------------------------------------------- D-47, D-71
test('D-47 : un seul verbe et des mots français', () => {
  for (const mot of [/Enrôler/, /enrôler/, /Shortlist/, /\bPreviews?\b/, /\bstep\b/, /skipp/, /Smart Message/, /Open to Work/, /~\d+ cr\b/, /\bcr\/profil/, /\btemplate\b/, /\bTimeout\b/, /\bfallback\b/]) {
    assert.doesNotMatch(texts, mot, `${mot} affiché`);
  }
  assert.match(preparation, /Présélectionner sans message/);
  assert.match(preparation, /`Inscrire \$\{plural\(activeProfiles\.length, 'candidat'\)\}`/);
});

test('D-71 : vouvoiement, sans tiret long ni pluriel entre parenthèses', () => {
  for (const tu of [/reconnecte-toi/, /Recharge la page/, /\bLance "/, /\bTape \/ai/, /Modifie le délai/, /ton profil/, /Préfère/]) {
    assert.doesNotMatch(texts, tu, `${tu} tutoie`);
  }
  assert.doesNotMatch(texts, /—/, 'tiret long dans un texte visible');
  assert.doesNotMatch(texts, /\w\(s\)/, 'pluriel « (s) »');
});

// ---------------------------------------------------------------- D-48, D-49, D-65
test('D-49 : plus de tables recopiées, le catalogue commun', () => {
  assert.doesNotMatch(all, /ACTION_ICONS|ACTION_LABELS|makeBrandIcon|CHANNEL_COLORS/);
  assert.match(preparation, /SequenceActionLabel/);
  assert.match(parts['SequenceTreeView.tsx'], /from '@\/components\/outreach\/SequenceBadges'/);
  assert.match(parts['SequenceTreeView.tsx'], /sequenceActionLabel\(step\.actionType\)/);
});

test('D-48 : canaux par leur logo, étapes et décisions neutres', () => {
  assert.match(parts['CandidateSidebarCard.tsx'], /<ChannelIcon channel=\{channel\}/);
  assert.doesNotMatch(all, /linkedin-logo\.svg|whatsapp-logo\.svg/, 'les logos passent par ChannelIcon');
  assert.doesNotMatch(all, /bg-emerald|bg-info\/10|bg-success\/10|brand-purple|brand-pink/);
  assert.match(parts['SequenceTreeView.tsx'], /border-dashed border-border-strong/, 'décision à filet pointillé');
});

// ---------------------------------------------------------------- D-50, D-69
test('D-50 : en-tête du candidat plat et immobile, score au barème commun', () => {
  const header = parts['CandidateContextHeader.tsx'];
  assert.doesNotMatch(all, /framer-motion|konektPulseDot|konekt-fade-up|bg-gradient|font-display/);
  assert.match(header, /<ScoreBadge score=\{score\?\.score\} showLevel/);
  assert.match(header, /<h3 className="text-lg font-semibold/);
  assert.match(header, /<Badge variant="success">Ouvert aux opportunités<\/Badge>/);
  assert.doesNotMatch(all, /from '@\/components\/missions\/v2\/Pill'/, 'plus de pastille IA en dégradé');
});

// ---------------------------------------------------------------- D-51
test('D-51 : fenêtre simple au registre du kit', () => {
  assert.doesNotMatch(simple, /uppercase|rounded-lg"|bg-background border-border/);
  assert.match(simple, /Rechargez la page ou reconnectez votre compte/);
  assert.doesNotMatch(simple, /Traiter les séquences/, 'le toast ne renvoie plus vers un bouton absent');
  assert.match(simple, /La planification sera reprise automatiquement/);
});

// ---------------------------------------------------------------- D-53
test('D-53 : cases du kit et bascule annoncée', () => {
  assert.doesNotMatch(all, /<input\s[^>]*type="checkbox"/);
  assert.match(preparation, /<Checkbox\s+id=\{checkboxId\}/);
  assert.match(simple, /<Checkbox\s+id=\{duplicatesId\}/);
  assert.match(preparation, /<SegmentedControl<'summary' \| 'preview'>/);
});

// ---------------------------------------------------------------- D-33, D-72
test('D-33 : la préparation est un vrai dialogue du kit', () => {
  assert.doesNotMatch(preparation, /createPortal|fixed inset-0 z-\[4000\]/);
  assert.match(preparation, /<DialogContent[\s\S]{0,120}max-w-6xl/);
  assert.match(preparation, /<DialogTitle/);
  assert.doesNotMatch(all, /z-\[\d+\]/, 'aucune couche arbitraire');
});

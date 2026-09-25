/**
 * Chantier design, lot 7b : grille d'entretien (scorecard) et assistant
 * d'entretien.
 *
 * Garde-fous sur le code : enregistrement continu relu (E-04), confirmations
 * (E-05), plus d'action sans effet (E-09), vocabulaire des décisions (E-16),
 * registre calme (E-32, E-33, E-47, E-48).
 *
 * Lancer : node --test tests/ux/lot7b-scorecard.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
/** Code sans commentaires : les commentaires citent parfois ce qui est proscrit. */
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const scorecard = code('src/components/ats/ScorecardTab.tsx');
const fullPage = code('src/pages/ScorecardFullPage.tsx');
const coaching = code('src/components/ats/LiveCoachingPanel.tsx');
const guide = code('src/components/ats/AudioSetupGuide.tsx');
const fraud = code('src/components/ats/FraudDetectionTab.tsx');
const all = [scorecard, fullPage, coaching, guide, fraud].join('\n');

test('E-04 : tous les champs partent seuls, le statut est visible et annoncé', () => {
  assert.match(scorecard, /AUTOSAVE_DELAY_MS = \d+/);
  for (const field of ['handleRate', 'handleComment', 'setRecommendation', "setTextField('summary'", "setTextField('followUpNotes'"]) {
    assert.ok(scorecard.includes(field), `${field} absent`);
  }
  // Toute modification passe par updateEvaluation, qui programme l'enregistrement.
  assert.match(scorecard, /const updateEvaluation = useCallback[\s\S]*?scheduleSave\(key\)/);
  for (const label of ['Modifications non enregistrées', 'Enregistrement…', "Échec de l'enregistrement", 'Réessayer', 'Enregistré à']) {
    assert.ok(scorecard.includes(label), `statut « ${label} » absent`);
  }
  assert.match(scorecard, /role="status" aria-live="polite"/);
  assert.doesNotMatch(scorecard, /Sauvegarder/, "plus de bouton d'enregistrement manuel");
});

test("E-04 : chaque écriture est relue, un refus n'est jamais un succès", () => {
  assert.match(scorecard, /\.update\(fields\)\s*\.eq\('id', id\)\s*\.select\('id, updated_at'\)/);
  assert.match(scorecard, /data\.length === 0/);
  assert.match(scorecard, /\.delete\(\)\.eq\('id', id\)\.select\('id'\)/);
});

test('E-04 : la saisie en attente part au démontage et avant le plein écran', () => {
  assert.match(scorecard, /mountedRef\.current = false;[\s\S]*?persist\(ev\.key, ev\)/);
  assert.match(scorecard, /const ok = activeKey \? await flush\(activeKey\) : true;/);
});

test('E-05 : suppression et régénération confirmées en français', () => {
  assert.match(scorecard, /Supprimer cette grille&nbsp;\?/);
  assert.match(scorecard, /Régénérer la grille&nbsp;\?/);
  assert.ok(scorecard.includes('Les notes saisies seront effacées.'));
  assert.ok(scorecard.includes('Cette action est irréversible.'));
  assert.match(scorecard, /label="Supprimer la grille"/);
  assert.doesNotMatch(scorecard, /window\.confirm/);
  // Régénérer efface les notes rattachées aux anciens critères.
  assert.match(scorecard, /criteria, ratings: \{\}, comments: \{\}, overallScore: null/);
});

test('E-09 : plus aucune action sans effet dans l’assistant d’entretien', () => {
  for (const fake of ['Avancer dans le pipeline', 'Écarter', 'Entretien suivant à planifier', 'lancer le coaching']) {
    assert.ok(!all.includes(fake), `« ${fake} » encore présent`);
  }
  assert.match(coaching, /Programmer l'entretien suivant/);
  assert.match(coaching, /<CreateEventModal open onOpenChange=\{setScheduleOpen\} \/>/);
  assert.match(guide, />\s*Compris\s*</);
  assert.match(coaching, /Démarrer l'enregistrement/);
});

test('E-16 : décisions et types d’entretien en français, jamais la clé brute', () => {
  for (const raw of ['Strong Yes', 'Strong No', "'Maybe'", 'Phone Screen', 'Culture Fit', '{report.recommendation}']) {
    assert.ok(!all.includes(raw), `« ${raw} » encore présent`);
  }
  assert.match(scorecard, /HIRING_VERDICTS\[key\]\.label/);
  assert.match(scorecard, /INTERVIEW_TYPES\[stage\]/);
  assert.match(coaching, /GO: 'yes'/);
  assert.match(coaching, /A_CREUSER: 'maybe'/);
  // Le compte rendu qui remplit la recommandation le dit.
  assert.match(scorecard, /Proposée par le compte rendu de l'entretien/);
  assert.match(fullPage, /Recommandation de l'IA/);
  assert.match(fullPage, /aucune/);
});

test('E-15 : le score de l’IA passe par ScoreBadge, la moyenne a une seule précision', () => {
  assert.match(fullPage, /<ScoreBadge score=\{candidate\.score\}/);
  assert.doesNotMatch(fullPage, /toFixed\(2\)/);
  assert.match(fullPage, /maximumFractionDigits: 1/);
  assert.match(scorecard, /maximumFractionDigits: 1/);
});

test('E-32 : notation et verdict en ToggleGroup, sélection monochrome, catégories neutres', () => {
  assert.match(scorecard, /aria-label=\{`Noter \$\{score\} sur 5`\}/);
  assert.match(scorecard, /h-10 w-10/);
  assert.match(scorecard, /data-\[state=on\]:bg-foreground/);
  assert.doesNotMatch(scorecard, /CATEGORY_CONFIG|dotColor/);
  assert.ok(scorecard.includes("Vous n'avez pas encore de grille pour ce candidat"));
  assert.doesNotMatch(scorecard, /CreditCostBadge/, 'coût affiché une fois, par le sélecteur de modèle');
  assert.doesNotMatch(fullPage, /setInterval/, "plus d'interrogation de la base toutes les 5 s");
});

test('E-33 : un seul nom, rouge réservé à l’enregistrement réel', () => {
  for (const name of ['Coaching Live', 'Coach Live', 'Coaching live', 'Générer le CR', 'Checklist critères', 'Red flag', 'RAS']) {
    assert.ok(!all.includes(name), `« ${name} » encore présent`);
  }
  assert.match(coaching, /Assistant d'entretien/);
  assert.match(fullPage, /\{recording && \(/);
  // Bouton principal monochrome ; le rouge ne sert qu'au point et au minuteur de l'enregistrement.
  assert.match(coaching, /<Button variant="primary" onClick=\{\(\) => void startRecording\(\)\}/);
  assert.doesNotMatch(coaching, /variant="destructive"|bg-destructive/);
});

test('E-13, E-47, E-48 : textes lisibles, ni étincelle, ni emoji, ni animation en boucle', () => {
  assert.doesNotMatch(all, /text-(?:info|warning|success|danger)-foreground/);
  assert.doesNotMatch(all, /Sparkles|animate-pulse|animate-ping|scale-110|bg-gradient|emerald-|brand-purple|font-display|rounded-2xl/);
  assert.doesNotMatch(all, /[\u{1F300}-\u{1FAFF}✅❌✓✕⚠]/u);
  assert.doesNotMatch(all, /—/);
  assert.doesNotMatch(all, /<button\b/);
});

test('Branding : aucun fournisseur nommé dans les textes', () => {
  assert.doesNotMatch(all, /['">][^'"<>]*\b(?:Deepgram|Unipile|Anthropic|Claude)\b/);
});

/**
 * Chantier design, lot 6d : suivi des séquences (inscriptions, journal,
 * diagnostic, statistiques) et InMail (groupé, message unitaire, éditeur).
 *
 * - stepReasonLabel (activity-log/stepReasons.ts), empaqueté par buildSync avec
 *   le catalogue (alias @/ résolus par tsconfig.app.json) : aucune raison écrite
 *   par le moteur d'envoi ne s'affiche telle qu'enregistrée (D-56) ;
 * - écrans : inspection de source (statuts et étapes du socle, registre calme,
 *   confirmations, vocabulaire, jetons).
 *
 * Lancer : node --test tests/ux/lot6d-suivi.test.mjs (ou npm run test:ux)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
/** Code sans commentaires : les commentaires citent parfois ce qu'on bannit. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const { outputFiles } = buildSync({
  entryPoints: [join(ROOT_PATH, 'src/components/outreach/activity-log/stepReasons.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
});
const { stepReasonLabel } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);

const OUTREACH = 'src/components/outreach';
const panel = code(`${OUTREACH}/SequenceEnrollmentsPanel.tsx`);
const journal = code(`${OUTREACH}/SequenceActivityLog.tsx`);
const editModal = code(`${OUTREACH}/activity-log/EditScheduledMessageModal.tsx`);
const diagnostic = code(`${OUTREACH}/SequenceDiagnostic.tsx`);
const analytics = code(`${OUTREACH}/SequenceAnalytics.tsx`);
const bulk = code(`${OUTREACH}/BulkInMailModal.tsx`);
const editor = code(`${OUTREACH}/InMailTextEditor.tsx`);
const single = code(`${OUTREACH}/OutreachMessageModal.tsx`);
const FILES = { panel, journal, editModal, diagnostic, analytics, bulk, editor, single };

test('D-56 : les raisons écrites par le moteur d’envoi sont traduites', () => {
  const cases = {
    'No email — channel skipped': "Pas d'adresse e-mail",
    'No phone number — WhatsApp skipped': 'Pas de numéro de téléphone',
    'Reply detected via webhook': 'Le candidat a répondu',
    'Stoppé depuis Inbox': 'Arrêtée à la main',
    'Compte LinkedIn déconnecté, reprise automatique à la reconnexion': 'Compte LinkedIn déconnecté : reprise à la reconnexion',
    "Abonnement requis pour l'envoi de séquences": 'Abonnement requis',
    'Stop condition: link clicked': 'Le candidat a cliqué sur le lien',
    'Stop condition: meeting booked (Calendly)': 'Rendez-vous pris',
    'Hors plage horaire autorisée (8h–19h Europe/Paris). Action différée.': "Hors de vos horaires d'envoi : envoi différé",
    'Quota InMail épuisé': 'Crédits InMail épuisés',
    'Quota check unavailable (HTTP 503)': "Limites d'envoi non vérifiées : envoi différé",
    'raison inconnue': 'Étape non exécutée',
  };
  for (const [raw, label] of Object.entries(cases)) {
    assert.equal(stepReasonLabel(raw), label, raw);
  }
  assert.equal(stepReasonLabel(null), null);
});

test('D-54, D-55 : statuts et étapes viennent du socle, sans table locale ni aplat saturé', () => {
  for (const [name, src] of Object.entries({ panel, journal })) {
    assert.doesNotMatch(src, /statusConfig|executionStatusConfig|actionTypeConfig/, `${name} : table locale`);
    assert.match(src, /ExecutionStatusBadge/, `${name} : badge d'exécution du socle`);
    assert.match(src, /SequenceActionIcon/, `${name} : icône d'étape du socle`);
    assert.doesNotMatch(src, /text-(?:info|success|warning)-foreground/, `${name} : texte blanc de statut`);
  }
  assert.match(panel, /EnrollmentStatusBadge status=\{enrollment\.status\} pauseReason=\{enrollment\.pause_reason\}/);
  assert.match(analytics, /EnrollmentStatusBadge/, 'répartition des inscriptions : mêmes libellés');
});

test('D-56 : plus d’identifiant brut ni de « Workflow »', () => {
  assert.doesNotMatch(panel, /Workflow/);
  assert.match(panel, /Déroulé/);
  assert.doesNotMatch(panel, /label: step\.action_type|exec\.skip_reason\}/, 'raison ou type affiché tel quel');
  assert.match(panel, /stepReasonLabel\(exec\.skip_reason\)/);
  assert.match(journal, /stepReasonLabel\(exec\.skip_reason\)/);
  assert.doesNotMatch(analytics, /action_type\.replace/, 'type d’étape bricolé en texte');
  assert.match(analytics, /sequenceActionLabel\(s\.action_type\)/);
});

test('D-57 : registre calme (pas de capitales, actions sur Button, arrêt groupé confirmé)', () => {
  for (const [name, src] of Object.entries(FILES)) {
    assert.doesNotMatch(src, /\buppercase\b/, `${name} : capitales`);
    assert.doesNotMatch(src, /rounded-(?:none|2xl|3xl)\b/, `${name} : rayon hors système`);
  }
  assert.doesNotMatch(panel, /<button\b/, 'panneau : boutons du kit seulement');
  assert.match(panel, /<Button[^>]*>\s*Traiter maintenant/s);
  assert.match(panel, /setConfirmAction\(\{ type: 'bulkStop' \}\)/, 'arrêt groupé derrière la confirmation');
  assert.doesNotMatch(panel, /calc\(100vh/, 'hauteur de liste par flex');
  assert.doesNotMatch(panel, /BrutalLoader/, 'squelette, pas de phrases simulées');
});

test('D-58 : le journal ne peint plus les étapes en couleurs brutes', () => {
  assert.doesNotMatch(journal, /\b(?:bg|text)-(?:emerald|blue|purple|indigo)-\d{3}\b/);
  assert.doesNotMatch(journal, /Smart Message/);
});

test('D-59 : diagnostic en mots de recruteur, un seul seuil', () => {
  for (const word of [/pg_cron/, /Pipeline (?:actif|silencieux)/, /\bcron\s(?:a|est)/, /sans run/, /\bban\b/, /<code/, /\bVérifie\b|\bvérifie les\b|\btu approches\b/]) {
    assert.doesNotMatch(diagnostic, word, String(word));
  }
  assert.match(diagnostic, /const SILENCE_THRESHOLD_MIN = 10;/);
  assert.match(diagnostic, /SILENCE_THRESHOLD_MIN \* 60 \* 1000/, 'le code lit le seuil');
  assert.match(diagnostic, /dans les \{SILENCE_THRESHOLD_MIN\} dernières minutes/, 'l’aide cite le même seuil');
  assert.match(diagnostic, /Relancer les envois maintenant/);
});

test('D-60 : légende de la couleur réelle, blocs après chargement, titre « Statistiques : »', () => {
  const series = [...analytics.matchAll(/fill: 'hsl\(var\(--([\w-]+)\)\)', swatch: 'bg-([\w-]+)'/g)];
  assert.equal(series.length, 3, 'trois séries décrites une fois');
  for (const [, fill, swatch] of series) assert.equal(fill, swatch, `légende ${swatch} pour la barre ${fill}`);
  assert.doesNotMatch(analytics, /--primary/, 'plus de barre « primary » (identique au texte principal)');
  assert.match(analytics, /`Statistiques : \$\{sequenceName\}`/);
  const loadedBranch = analytics.indexOf(') : !hasData ? (');
  assert.ok(loadedBranch > 0 && analytics.indexOf('<ABTestResults') > loadedBranch, 'A/B dans l’état chargé');
  assert.ok(analytics.indexOf('Performance par étape') > loadedBranch, 'performance par étape dans l’état chargé');
});

test('D-62 : InMail groupé monochrome, tons du catalogue, annulation confirmée, navigation nommée', () => {
  for (const [name, src] of Object.entries({ bulk, single })) {
    assert.doesNotMatch(src, /bg-linkedin|text-linkedin/, `${name} : couleur LinkedIn hors logo`);
    assert.match(src, /MESSAGE_TONES/, `${name} : tons du catalogue`);
    assert.match(src, /SegmentedControl/, `${name} : un seul sélecteur de ton`);
    assert.doesNotMatch(src, /'(?:Pro|Cool|Wow)'/, `${name} : tons abrégés`);
  }
  assert.match(bulk, /onClick=\{\(\) => setConfirmCancel\(true\)\}/, 'annuler passe par la confirmation');
  assert.match(bulk, /<AlertDialogAction[\s\S]*?handleCancelPending\(\)/);
  assert.match(bulk, /aria-label=\{`Message \$\{i \+ 1\} : \$\{r\.name\}/, 'points de navigation nommés');
  assert.doesNotMatch(bulk, /Ton prénom|Ex: /);
  assert.match(bulk, /InMail groupé/);
});

test('D-65 à D-72 : jetons, typographie et texte dans les fichiers du lot', () => {
  for (const [name, src] of Object.entries(FILES)) {
    assert.doesNotMatch(src, /\btext-\[\d+(?:\.\d+)?px\]/, `${name} : taille arbitraire`);
    assert.doesNotMatch(src, /\b(?:bg|text|border|ring)-(?:red|green|emerald|amber|blue|purple|indigo|violet)-\d{3}\b/, `${name} : couleur brute`);
    assert.doesNotMatch(src, /\btext-(?:muted-)?foreground\/\d+/, `${name} : texte atténué par opacité`);
    assert.doesNotMatch(src, /—/, `${name} : tiret long`);
    assert.doesNotMatch(src, /[a-zé]\(s\)/, `${name} : pluriel « (s) »`);
    assert.doesNotMatch(src, /enrôl/i, `${name} : « enrôler »`);
  }
  // Les emoji restants de l'éditeur sont le contenu à insérer dans le message (D-70).
  for (const [name, src] of Object.entries({ panel, journal, editModal, diagnostic, analytics, bulk, single })) {
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, `${name} : emoji d'interface`);
  }
  assert.match(editor, /aria-label="Gras"/, 'boutons de mise en forme nommés');
  assert.match(editModal, /\{\{first_name\}\}/, 'syntaxe de variable lue par le moteur');
});

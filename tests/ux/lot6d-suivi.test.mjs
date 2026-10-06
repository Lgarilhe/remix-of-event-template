/**
 * Chantier design, lot 6d : suivi des séquences (inscriptions, journal,
 * diagnostic, statistiques) et InMail (groupé, message unitaire, éditeur).
 *
 * - formatSkipReason (src/lib/sequenceErrorMessages.ts, lue par le catalogue
 *   unifié), empaquetée par buildSync (alias @/ résolus par tsconfig.app.json) :
 *   aucune raison technique écrite par le moteur d'envoi ne s'affiche telle
 *   qu'enregistrée (D-56) ;
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

// Revue design : skipReasonLabel n'existe plus ; le catalogue unifié lit les
// raisons de saut avec formatSkipReason, la fonction de l'audit.
const { outputFiles } = buildSync({
  entryPoints: [join(ROOT_PATH, 'src/lib/sequenceErrorMessages.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
});
const { formatSkipReason, formatSequenceError } = await import(
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
  // Revue design : libellés de formatSkipReason (audit), repris par le catalogue unifié.
  const cases = {
    'No email — channel skipped': "Pas d'adresse e-mail, étape passée",
    'No phone number — WhatsApp skipped': 'Pas de numéro de téléphone, étape passée',
    'Reply detected via webhook': 'Réponse détectée',
    'Stoppé depuis Inbox': 'Candidat mis en pause',
    'Stop condition: link clicked': 'Arrêt : le candidat a cliqué sur le lien',
    'Stop condition: meeting booked (Calendly)': 'Arrêt : un rendez-vous a été pris',
    'Hors plage horaire autorisée (8h–19h Europe/Paris). Action différée.': "Reporté : en dehors des horaires d'envoi",
    'Quota check unavailable (HTTP 503)': 'Reporté : vérification des limites indisponible',
    'raison inconnue': 'Étape non envoyée',
  };
  for (const [raw, label] of Object.entries(cases)) {
    assert.equal(formatSkipReason(raw), label, raw);
  }
  // Revue design : une raison que le moteur écrit déjà en français se lit telle
  // quelle (décision de l'audit) ; le moteur écrit « Crédits InMail épuisés ».
  for (const raw of [
    'Compte LinkedIn déconnecté, reprise automatique à la reconnexion',
    "Abonnement requis pour l'envoi de séquences",
    'Crédits InMail épuisés',
  ]) {
    assert.equal(formatSkipReason(raw), raw, raw);
  }
  // « Quota InMail épuisé » est un message d'erreur, pas une raison de saut : même vocabulaire.
  assert.match(formatSequenceError('Quota InMail épuisé'), /^Crédits InMail épuisés/);
  assert.equal(formatSkipReason(null), '');
});

test('D-54, D-55 : statuts et étapes viennent du socle, sans table locale ni aplat saturé', () => {
  for (const [name, src] of Object.entries({ panel, journal })) {
    assert.doesNotMatch(src, /statusConfig|executionStatusConfig|actionTypeConfig/, `${name} : table locale`);
    // Revue design : libellé de la fonction partagée de l'audit, ton du catalogue.
    assert.match(src, /<Badge variant=\{executionStatusMeta\([^)]*\)\.tone\}>\s*\{execution(?:Status)?Label\(/, `${name} : statut d'exécution du socle`);
    assert.match(src, /SequenceActionIcon/, `${name} : icône d'étape du socle`);
    assert.doesNotMatch(src, /text-(?:info|success|warning)-foreground/, `${name} : texte blanc de statut`);
  }
  assert.match(panel, /const executionLabel = \(status: string\) => \(status === 'pending' \? 'À venir' : executionStatusLabel\(status\)\);/);
  // Revue design : statut d'inscription lu par les fonctions de l'audit (pausedLabel
  // pour une pause, comme EnrollmentStatusBadge), peint avec le ton du catalogue.
  assert.match(panel, /Object\.entries\(ENROLLMENT_STATUSES\)\.map\(\(\[status, meta\]\) => \[status, \{ tone: meta\.tone \}\]\)/);
  // Lot 5b : un arrêt manuel se lit « Arrêtée par … le … » avant le statut.
  assert.match(panel, /const statusLabel = manualStop\s*\? manualStopLabel\(manualStop, memberName\(manualStop\.by\)\)\s*: enrollment\.status === 'paused'\s*\? pausedLabel\(enrollment\.pause_reason\)\s*: enrollmentStatusLabel\(enrollment\.status\);/);
  assert.match(panel, /<Badge variant=\{status\.tone\}>\{statusLabel\}<\/Badge>/);
  assert.match(analytics, /EnrollmentStatusBadge/, 'répartition des inscriptions : mêmes libellés');
});

test('D-56 : plus d’identifiant brut ni de « Workflow »', () => {
  assert.doesNotMatch(panel, /Workflow/);
  // Revue design : le titre reste « Parcours », texte attendu par l'e2e
  // (sequences-enrollments.spec.ts) ; raisons et types lus par les fonctions de l'audit.
  assert.match(panel, />\s*Parcours\s*</);
  assert.doesNotMatch(panel, /label: step\.action_type|exec\.skip_reason\}/, 'raison ou type affiché tel quel');
  // Lot 5b : le contexte d'arrêt manuel accompagne la raison.
  assert.match(panel, /formatSkipReason\(exec\.skip_reason, \{ manualStop: hasManualStopTrace\(enrollment\.tracking_data\) \}\)/);
  assert.match(journal, /formatSkipReason\(exec\.skip_reason, \{ manualStop: exec\.enrollment\?\.stoppedManually \}\)/);
  assert.doesNotMatch(analytics, /action_type\.replace/, 'type d’étape bricolé en texte');
  assert.match(analytics, /stepTypeLabel\(s\.action_type\)/);
});

test('D-57 : registre calme (pas de capitales, actions sur Button, arrêt groupé confirmé)', () => {
  for (const [name, src] of Object.entries(FILES)) {
    assert.doesNotMatch(src, /\buppercase\b/, `${name} : capitales`);
    assert.doesNotMatch(src, /rounded-(?:none|2xl|3xl)\b/, `${name} : rayon hors système`);
  }
  assert.doesNotMatch(panel, /<button\b/, 'panneau : boutons du kit seulement');
  // Revue design : « Traiter maintenant » n'existe plus (audit SEQ-001) : le panneau
  // n'avance plus rien, un bandeau dit quand partent les étapes en retard.
  assert.doesNotMatch(panel, /Traiter maintenant|nudge_sequences/);
  assert.match(panel, /Elles partiront au prochain passage, pendant vos heures d’envoi\./);
  // Lot 5b (décision 3) : pause groupée immédiate, « Annuler » dans le toast.
  assert.match(panel, /onClick=\{\(\) => \{ void runBulk\('pause', bulkStopActive\); \}\}/, 'pause groupée sans fenêtre');
  assert.doesNotMatch(panel, /type: 'bulkStop'/, 'plus de confirmation de la pause groupée');
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
  // Revue design : seuil de l'audit (SEQ-170, 12 minutes), défini une fois, lu par
  // le code et cité par l'aide ; plus de bouton de relance (SEQ-001, lecture seule).
  assert.match(diagnostic, /const HEALTHY_DELAY_MS = 12 \* 60 \* 1000;/);
  assert.match(diagnostic, /const HEALTHY_DELAY_MIN = HEALTHY_DELAY_MS \/ 60_000;/);
  assert.match(diagnostic, /Date\.now\(\) - lastCronRunAt\.getTime\(\) < HEALTHY_DELAY_MS/, 'le code lit le seuil');
  assert.match(diagnostic, /dans les \{HEALTHY_DELAY_MIN\} dernières minutes/, 'l’aide cite le même seuil');
  assert.doesNotMatch(diagnostic, /Relancer les envois maintenant|invokeEdgeFunction/, 'plus de bouton de relance');
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

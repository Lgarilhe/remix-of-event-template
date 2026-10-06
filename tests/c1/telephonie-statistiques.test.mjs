/**
 * Téléphonie, lot A4 : statistiques de la page Appels (vue d'ensemble).
 *
 * Les calculs sont des fonctions pures (src/lib/phoneCallStats.ts) importées
 * telles quelles par Node, puis des garde-fous de motifs sur les écrans.
 *
 * Lancer : node --test tests/c1/telephonie-statistiques.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const load = () => import(pathToFileURL(join(ROOT, 'src/lib/phoneCallStats.ts')).href);

let seq = 0;
const call = (over = {}) => ({
  id: `c${++seq}`, provider: 'aircall', direction: 'outbound', outcome: 'done', startedAt: '2026-10-06T10:00:00Z', talkSeconds: 60,
  contactNumber: null, numberE164: '+33611111111', contactName: null, agentName: null, agentEmail: null,
  recordingUrl: null, voicemailUrl: null, tags: [], notes: null, ...over,
});

// « maintenant » : mardi 6 octobre 2026, 16 h à Paris (heure d'été, UTC+2)
const NOW = new Date('2026-10-06T14:00:00Z');

// ---------------------------------------------------------------------
// Jours et heures, à Paris
// ---------------------------------------------------------------------
test('dayKey et hourOf : le jour et l\'heure de Paris, été comme hiver', async () => {
  const { dayKey, hourOf } = await load();
  assert.equal(dayKey('2026-10-06T10:00:00Z'), '2026-10-06');
  assert.equal(dayKey('2026-10-06T22:30:00Z'), '2026-10-07', 'minuit passé à Paris (UTC+2)');
  assert.equal(hourOf('2026-10-06T22:30:00Z'), 0);
  assert.equal(hourOf('2026-10-06T10:00:00Z'), 12);
  assert.equal(dayKey('2026-12-15T23:30:00Z'), '2026-12-16', 'heure d\'hiver (UTC+1)');
  assert.equal(hourOf('2026-12-15T23:30:00Z'), 0);
  assert.equal(dayKey('2026-01-10T12:00:00Z', 'UTC'), '2026-01-10');
});

test('lastDays : les derniers jours, sans trou au changement d\'heure', async () => {
  const { lastDays } = await load();
  assert.deepEqual(lastDays(7, NOW), ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']);
  assert.deepEqual(lastDays(3, new Date('2026-10-26T10:00:00Z')), ['2026-10-24', '2026-10-25', '2026-10-26'], 'changement d\'heure du 25/10');
  assert.equal(lastDays(90, NOW).length, 90);
  assert.deepEqual(lastDays(1, new Date('2026-10-06T22:30:00Z')), ['2026-10-07'], 'après minuit à Paris, c\'est déjà demain');
});

// ---------------------------------------------------------------------
// Chiffres de la période
// ---------------------------------------------------------------------
const SAMPLE = () => [
  call({ direction: 'inbound', outcome: 'done', talkSeconds: 120, startedAt: '2026-10-06T08:00:00Z' }),
  call({ direction: 'inbound', outcome: 'missed', talkSeconds: 0, startedAt: '2026-10-06T09:00:00Z' }),
  call({ direction: 'inbound', outcome: 'voicemail', talkSeconds: 10, startedAt: '2026-10-05T09:00:00Z' }),
  call({ direction: 'outbound', outcome: 'done', talkSeconds: 300, startedAt: '2026-10-06T10:00:00Z' }),
  call({ direction: 'outbound', outcome: 'missed', talkSeconds: 0, startedAt: '2026-10-06T10:30:00Z' }),
  call({ direction: 'outbound', outcome: 'done', talkSeconds: 60, startedAt: '2026-10-02T13:00:00Z' }),
  call({ direction: 'outbound', outcome: 'done', talkSeconds: 999, startedAt: '2026-08-01T13:00:00Z' }), // hors période
  call({ direction: 'outbound', outcome: 'done', talkSeconds: 999, startedAt: null }), // sans date
];

test('computeStats : les comptes de la période, rien hors période ni sans date', async () => {
  const { computeStats } = await load();
  const s = computeStats(SAMPLE(), { days: 7, now: NOW });
  assert.equal(s.total, 6);
  assert.equal(s.inbound, 3);
  assert.equal(s.outbound, 3);
  assert.equal(s.answered, 3);
  assert.equal(s.missed, 2);
  assert.equal(s.voicemail, 1);
  assert.equal(s.talkSeconds, 480, 'seules les conversations comptent : 120 + 300 + 60');
  assert.equal(s.avgTalkSeconds, 160);
  assert.equal(s.answerRate, 1 / 3, 'reçus décrochés / reçus');
  assert.equal(s.reachRate, 2 / 3, 'émis décrochés / émis');
});

test('computeStats : un taux sans appel à diviser vaut null, jamais zéro', async () => {
  const { computeStats } = await load();
  const only = computeStats([call({ direction: 'outbound', outcome: 'missed', talkSeconds: 0 })], { days: 7, now: NOW });
  assert.equal(only.answerRate, null);
  assert.equal(only.reachRate, 0, 'un appel émis, aucun décroché : 0 %, c\'est une vraie valeur');
  assert.equal(only.avgTalkSeconds, null);
  const empty = computeStats([], { days: 30, now: NOW });
  assert.equal(empty.total, 0);
  assert.equal(empty.answerRate, null);
  assert.equal(empty.reachRate, null);
  assert.equal(empty.avgTalkSeconds, null);
  assert.equal(empty.perDay.length, 30);
});

test('computeStats : un jour par case, jours vides compris, somme égale au total', async () => {
  const { computeStats } = await load();
  const s = computeStats(SAMPLE(), { days: 7, now: NOW });
  assert.deepEqual(s.perDay.map((d) => d.day), ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']);
  const byDay = Object.fromEntries(s.perDay.map((d) => [d.day, d]));
  assert.deepEqual(byDay['2026-10-06'], { day: '2026-10-06', answered: 2, missed: 2, voicemail: 0, total: 4 });
  assert.deepEqual(byDay['2026-10-05'], { day: '2026-10-05', answered: 0, missed: 0, voicemail: 1, total: 1 });
  assert.equal(byDay['2026-10-03'].total, 0);
  assert.equal(s.perDay.reduce((n, d) => n + d.total, 0), s.total);
});

test('computeStats : un appel passé après minuit à Paris compte pour le jour suivant', async () => {
  const { computeStats } = await load();
  const s = computeStats([call({ startedAt: '2026-10-05T22:30:00Z' })], { days: 3, now: NOW });
  const byDay = Object.fromEntries(s.perDay.map((d) => [d.day, d.total]));
  assert.equal(byDay['2026-10-06'], 1);
  assert.equal(byDay['2026-10-05'], 0);
});

test('computeStats et bestHours : joignabilité par heure, seuil de volume', async () => {
  const { computeStats, bestHours } = await load();
  // 14 h Paris (12 h UTC) : 4 appels émis, 3 décrochés. 10 h Paris : 3 émis, 1 décroché. 18 h : 2 émis (sous le seuil).
  const at = (utc, outcome) => call({ direction: 'outbound', outcome, startedAt: `2026-10-06T${utc}:00:00Z`, talkSeconds: outcome === 'done' ? 30 : 0 });
  const calls = [
    at('12', 'done'), at('12', 'done'), at('12', 'done'), at('12', 'missed'),
    at('08', 'done'), at('08', 'missed'), at('08', 'missed'),
    at('16', 'done'), at('16', 'done'),
    call({ direction: 'inbound', startedAt: '2026-10-06T12:00:00Z' }), // les appels reçus ne comptent pas ici
  ];
  const s = computeStats(calls, { days: 7, now: NOW });
  assert.deepEqual(s.perHour[14], { hour: 14, outbound: 4, reached: 3 });
  assert.deepEqual(s.perHour[10], { hour: 10, outbound: 3, reached: 1 });
  assert.deepEqual(s.perHour[18], { hour: 18, outbound: 2, reached: 2 });
  assert.equal(s.perHour.length, 24);
  assert.deepEqual(bestHours(s.perHour), [{ hour: 14, rate: 0.75, calls: 4 }, { hour: 10, rate: 1 / 3, calls: 3 }], '18 h : moins de 3 appels, écartée');
  assert.deepEqual(bestHours(s.perHour, 2, 1), [{ hour: 18, rate: 1, calls: 2 }]);
  assert.deepEqual(bestHours(computeStats([], { days: 7, now: NOW }).perHour), []);
  // Un créneau où personne n'a jamais décroché n'est pas un « bon créneau », même bien fourni.
  const none = computeStats([at('12', 'missed'), at('12', 'missed'), at('12', 'missed'), at('12', 'missed')], { days: 7, now: NOW });
  assert.deepEqual(bestHours(none.perHour), []);
});

// ---------------------------------------------------------------------
// Par recruteur
// ---------------------------------------------------------------------
test('statsByRecruiter : un recruteur par ligne, du plus d\'appels au moins, sans les appels sans agent', async () => {
  const { statsByRecruiter } = await load();
  const members = { 'julie@konekt.fr': { userId: 'u1', name: 'Julie Martin', isMember: true } };
  const resolve = (email, name) => {
    if (!email && !name) return null;
    return members[(email ?? '').toLowerCase()] ?? { userId: null, name: name ?? email, isMember: false };
  };
  const calls = [
    call({ agentEmail: 'julie@konekt.fr', agentName: 'J.', direction: 'outbound', outcome: 'done', talkSeconds: 100 }),
    call({ agentEmail: 'Julie@Konekt.fr', agentName: 'J.', direction: 'outbound', outcome: 'done', talkSeconds: 200 }),
    call({ agentEmail: 'julie@konekt.fr', agentName: 'J.', direction: 'inbound', outcome: 'missed', talkSeconds: 0 }),
    call({ agentEmail: 'paul@ailleurs.fr', agentName: 'Paul Durand', direction: 'outbound', outcome: 'done', talkSeconds: 50 }),
    call({ agentEmail: null, agentName: null, direction: 'inbound', outcome: 'missed', talkSeconds: 0 }),
  ];
  const rows = statsByRecruiter(calls, resolve);
  assert.equal(rows.length, 2, 'l\'appel sans agent n\'a pas de ligne');
  assert.deepEqual(rows[0], { key: 'u1', name: 'Julie Martin', isMember: true, calls: 3, answered: 2, outbound: 2, inbound: 1, talkSeconds: 300, avgTalkSeconds: 150 });
  assert.equal(rows[1].key, 'aircall:Paul Durand');
  assert.equal(rows[1].isMember, false);
  assert.equal(rows[1].avgTalkSeconds, 50);
  assert.deepEqual(statsByRecruiter([], resolve), []);
  const none = statsByRecruiter([call({ agentEmail: 'x@y.fr', direction: 'outbound', outcome: 'missed', talkSeconds: 0 })], resolve);
  assert.equal(none[0].avgTalkSeconds, null, 'aucune conversation : pas de durée moyenne');
});

// ---------------------------------------------------------------------
// Appels manqués à rappeler
// ---------------------------------------------------------------------
test('missedToCallBack : manqué reçu, sans rappel depuis, de moins de 7 jours', async () => {
  const { missedToCallBack } = await load();
  const missed = (num, startedAt, over = {}) => call({ direction: 'inbound', outcome: 'missed', talkSeconds: 0, numberE164: num, startedAt, ...over });
  const out = (num, startedAt) => call({ direction: 'outbound', outcome: 'missed', talkSeconds: 0, numberE164: num, startedAt });
  const calls = [
    missed('+33600000001', '2026-10-06T08:00:00Z', { contactName: 'Marc Moreau' }), // à rappeler
    missed('+33600000002', '2026-10-05T08:00:00Z'), out('+33600000002', '2026-10-05T09:00:00Z'), // rappelé (même sans réponse)
    missed('+33600000003', '2026-10-05T08:00:00Z'), out('+33600000003', '2026-10-04T09:00:00Z'), // appel émis AVANT : toujours à rappeler
    missed('+33600000004', '2026-09-20T08:00:00Z'), // trop ancien
    missed(null, '2026-10-06T07:00:00Z'), // numéro masqué : rien à rappeler
    missed('+33600000005', '2026-10-06T06:00:00Z'), missed('+33600000005', '2026-10-05T06:00:00Z', { contactName: 'Claire' }), // deux manqués, un seul numéro
    call({ direction: 'inbound', outcome: 'done', numberE164: '+33600000006', startedAt: '2026-10-06T06:30:00Z' }), // décroché
    call({ direction: 'inbound', outcome: 'voicemail', numberE164: '+33600000007', startedAt: '2026-10-06T06:30:00Z' }), // message laissé : pas « manqué »
  ];
  const rows = missedToCallBack(calls, { now: NOW });
  assert.deepEqual(rows.map((r) => r.numberE164), ['+33600000001', '+33600000005', '+33600000003']);
  assert.equal(rows[0].contactName, 'Marc Moreau');
  assert.equal(rows[1].missedCount, 2);
  assert.equal(rows[1].lastMissedAt, '2026-10-06T06:00:00Z');
  assert.equal(rows[1].contactName, 'Claire', 'le nom connu sur n\'importe lequel des appels');
  assert.deepEqual(missedToCallBack([], { now: NOW }), []);
  assert.equal(missedToCallBack(calls, { now: NOW, withinDays: 30 }).some((r) => r.numberE164 === '+33600000004'), true, 'fenêtre réglable');
});

// ---------------------------------------------------------------------
// Mise en forme
// ---------------------------------------------------------------------
test('formatTalkTime et formatPercent', async () => {
  const { formatTalkTime, formatPercent } = await load();
  assert.equal(formatTalkTime(0), '0 s');
  assert.equal(formatTalkTime(45), '45 s');
  assert.equal(formatTalkTime(60), '1 min');
  assert.equal(formatTalkTime(372), '6 min 12 s');
  assert.equal(formatTalkTime(3720), '1 h 02');
  assert.equal(formatTalkTime(-5), '0 s');
  assert.equal(formatPercent(0.4286), '43 %');
  assert.equal(formatPercent(1), '100 %');
  assert.equal(formatPercent(0), '0 %');
  assert.equal(formatPercent(null), null);
});

// ---------------------------------------------------------------------
// Liste « Tous les appels » : filtres et libellés
// ---------------------------------------------------------------------
const loadFilters = () => import(pathToFileURL(join(ROOT, 'src/lib/phoneCallFilters.ts')).href);

test('callStatusLabel : un libellé par issue et par sens', async () => {
  const { callStatusLabel } = await loadFilters();
  assert.equal(callStatusLabel({ direction: 'inbound', outcome: 'done' }), 'Reçu');
  assert.equal(callStatusLabel({ direction: 'outbound', outcome: 'done' }), 'Émis');
  assert.equal(callStatusLabel({ direction: 'inbound', outcome: 'missed' }), 'Manqué');
  assert.equal(callStatusLabel({ direction: 'outbound', outcome: 'missed' }), 'Sans réponse');
  assert.equal(callStatusLabel({ direction: 'outbound', outcome: 'voicemail' }), 'Messagerie');
});

test('fold et numberDigits : sans accent ni casse, format international ou français', async () => {
  const { fold, numberDigits } = await loadFilters();
  assert.equal(fold('  Valérie SUTTER '), 'valerie sutter');
  assert.deepEqual(numberDigits('+33612345678'), ['33612345678', '0612345678']);
  assert.deepEqual(numberDigits('+442079460958'), ['442079460958']);
  assert.deepEqual(numberDigits(null), []);
});

test('filterCalls : sens, issue, rattachement, recruteur, recherche', async () => {
  const { filterCalls, NO_FILTERS } = await loadFilters();
  const calls = [
    call({ id: 'a', direction: 'inbound', outcome: 'done', numberE164: '+33611111111', contactName: 'Valérie SUTTER', agentEmail: 'julie@konekt.fr' }),
    call({ id: 'b', direction: 'outbound', outcome: 'missed', numberE164: '+33622222222', contactName: null, agentEmail: 'paul@ailleurs.fr' }),
    call({ id: 'c', direction: 'outbound', outcome: 'voicemail', numberE164: '+33633333333', contactName: null, agentEmail: null }),
    call({ id: 'd', direction: 'inbound', outcome: 'missed', numberE164: null, contactName: null, contactNumber: 'Anonyme' }),
  ];
  const attached = new Map([['+33622222222', { name: 'Marc Moreau' }], ['+33633333333', { name: null }]]);
  const recruiterKey = (c) => (c.agentEmail === 'julie@konekt.fr' ? 'u1' : c.agentEmail ? 'aircall:Paul' : null);
  const ids = (f) => filterCalls(calls, { ...NO_FILTERS, ...f }, { attached, recruiterKey }).map((c) => c.id);

  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd'], 'aucun filtre : tout, dans l\'ordre reçu');
  assert.deepEqual(ids({ direction: 'inbound' }), ['a', 'd']);
  assert.deepEqual(ids({ outcome: 'missed' }), ['b', 'd']);
  assert.deepEqual(ids({ matched: 'attached' }), ['b', 'c']);
  assert.deepEqual(ids({ matched: 'unattached' }), ['a', 'd'], 'un numéro masqué n\'est jamais rattaché');
  assert.deepEqual(ids({ recruiter: 'u1' }), ['a']);
  assert.deepEqual(ids({ recruiter: 'aircall:Paul' }), ['b']);
  assert.deepEqual(ids({ direction: 'outbound', outcome: 'missed', matched: 'attached' }), ['b'], 'les filtres se cumulent');
  // Recherche : nom d'opérateur, nom du candidat rattaché (sans accent ni casse), numéro dans les deux formats.
  assert.deepEqual(ids({ query: 'valerie' }), ['a']);
  assert.deepEqual(ids({ query: 'MOREAU' }), ['b']);
  assert.deepEqual(ids({ query: '06 11 11' }), ['a'], 'format français');
  assert.deepEqual(ids({ query: '33622' }), ['b'], 'format international');
  assert.deepEqual(ids({ query: 'anonyme' }), ['d'], 'numéro tel que reçu');
  assert.deepEqual(ids({ query: '06' }), [], 'moins de 3 chiffres : pas de recherche par numéro');
  assert.deepEqual(ids({ query: 'zzz' }), []);
});

// ---------------------------------------------------------------------
// Garde-fous des écrans
// ---------------------------------------------------------------------
test('page Appels : trois onglets, périmètre « Mes appels » par défaut, erreur avant état vide', () => {
  const page = read('src/pages/Calls.tsx');
  assert.match(page, /useState<Tab>\('overview'\)/);
  assert.match(page, /useState<Scope>\('mine'\)/);
  assert.match(page, /\{ value: 'overview', label: "Vue d'ensemble" \}/);
  assert.match(page, /\{ value: 'all', label: 'Tous les appels' \}/);
  assert.match(page, /À rattacher \(\$\{unattachedShown\.length\}\)/, 'le nombre n\'est affiché que s\'il y en a');
  assert.match(page, /const PERIODS = \[7, 30, 90\] as const;/);
  assert.match(page, /isOwnCall\(userEmail, call\.agentEmail\) \|\| \(!call\.agentEmail && !call\.agentName\)/, 'mes appels : les miens et ceux que personne n\'a décrochés');
  assert.ok(page.indexOf('<ErrorState') < page.indexOf('<CallsOverview'), 'une lecture en échec n\'est jamais un état vide');
  assert.doesNotMatch(page, /variant="primary"/, 'aucun bouton plein : rien à créer sur cet écran');
});

test('vue d\'ensemble : rien n\'est affiché à zéro, tout vient des appels déjà lus', () => {
  const overview = read('src/components/calls/CallsOverview.tsx');
  assert.match(overview, /\{answerRate && <StatTile/, 'pas de taux sans appel reçu');
  assert.match(overview, /\{reachRate && <StatTile/, 'pas de taux sans appel émis');
  assert.match(overview, /\{stats\.talkSeconds > 0 && \(/, 'pas de temps de conversation à zéro');
  assert.match(overview, /\{callBack\.length > 0 && \(/, 'pas de section vide');
  assert.match(overview, /\{hours\.length > 0 && \(/);
  assert.match(overview, /if \(stats\.total === 0\) \{/, 'état vide parlant');
  assert.doesNotMatch(overview, /supabase|useQuery|fetch\(/, 'ni requête ni bibliothèque : des calculs sur les appels reçus');
  // Aucune bibliothèque de graphique, aucune couleur : des barres de la couleur du texte.
  assert.doesNotMatch(overview, /recharts|bg-(red|green|blue|orange|emerald|amber)/);
});

test('données de la période : bornées, par organisation, sans migration', () => {
  const lib = read('src/lib/phoneCalls.ts');
  assert.match(lib, /const MAX_PERIOD_ROWS = 5000;/);
  assert.match(lib, /\.gte\('started_at', sinceIso\)/);
  assert.match(lib, /\.range\(from, from \+ CONTACTS_PAGE - 1\)/, 'lecture par pages de 1 000');
  assert.match(lib, /\.from\('job_candidate_status'\)[\s\S]*?\.eq\('organization_id', organizationId\)/, 'noms lus pour l\'organisation active');
  const hub = read('src/hooks/useCallsHub.ts');
  assert.match(hub, /\(days \+ 1\) \* 24 \* 3600 \* 1000/, 'un jour de marge : les jours se comptent à Paris');
});

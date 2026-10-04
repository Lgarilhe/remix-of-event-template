/**
 * Refonte mission, lot 3 : règle de la prochaine action (src/lib/missionNextAction.ts)
 * et reports « Plus tard » (src/lib/missionSnooze.ts), fonctions pures.
 *
 * - chaque rang (3, 6, 7, 8, 8b, 10, 11) seul, puis l'ordre de précédence ;
 * - états des sources : chargement (jamais une carte ni un blocage), indisponible
 *   (listé, les rangs plus bas restent proposés), lue ;
 * - rang 0 : seulement s'il empêche la meilleure action suivante, jamais sur un
 *   état en chargement, cumul de causes, destinataire, téléphone ;
 * - reports : action suivante, report par action, annulation d'un report de
 *   réponse par un message postérieur, échéance, demain 06:00 heure locale ;
 * - jamais « Rien ne presse », pluriels, phrases (vouvoiement, ni tiret long,
 *   ni « (s) », ni nom de prestataire), une justification pour chaque carte ;
 * - colonne « Prochaine action » et liste des missions sur la même règle.
 *
 * Les dates sont locales : ce test fixe TZ=Europe/Paris (le lanceur de la CI le
 * pose aussi). Modules empaquetés par esbuild, client Supabase et React Query
 * remplacés par des modules vides.
 * Lancer : TZ=Europe/Paris node --test tests/ux/lot3-maintenant.test.mjs
 */
process.env.TZ = 'Europe/Paris';

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);

const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'stub' }));
    b.onResolve({ filter: /lib\/analytics$/ }, () => ({ path: 'analytics', namespace: 'stub' }));
    b.onResolve({ filter: /^(react|@tanstack\/react-query)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: ['export const supabase = {};', 'export const trackEvent = () => {};', 'export const useMemo = (f) => f();'].join('\n'),
      loader: 'js',
    }));
  },
};

const load = async (rel) => {
  const { outputFiles } = await build({
    entryPoints: [join(ROOT_PATH, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
    plugins: [stubs],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
};

const rule = await load('src/lib/missionNextAction.ts');
const snooze = await load('src/lib/missionSnooze.ts');
const display = await load('src/lib/stageDisplay.ts');
const stage = await load('src/lib/candidateStage.ts');

const {
  REPLY_MAX_AGE_DAYS, INTERVIEW_WAIT_DAYS, THEN_MAX, RANK_ORDER, RANK_RULES, UNMONITORED_RANKS,
  computeNowCard, missionListAction, buildRowSignals, rowNextAction, parseAttentionRow,
  sourceOf, sourceOk, linkedinSource, whenText, calendarDaysSince, buildMailto,
} = rule;
const { SNOOZE_KINDS, snoozeKey, nextLocalMorning, isSnoozed, snoozeChecker } = snooze;

// ------------------------------------------------------------------ fixtures

assert.equal(new Date(2026, 2, 29, 12).getTimezoneOffset(), -120, 'TZ=Europe/Paris attendu');

const P = '9a000000-0000-4000-8000-000000000001';
const DAY = 86_400_000;
/** Lundi 5 octobre 2026, 10 h, heure de Paris. */
const NOW = new Date(2026, 9, 5, 10, 0, 0).getTime();
/** Date locale, `days` jours civils avant NOW, à l'heure donnée. */
const iso = (days, hour = 9, minute = 0) => new Date(2026, 9, 5 - days, hour, minute, 0).toISOString();

const ok = sourceOk;
const LOADING = { state: 'loading' };
const UNAVAILABLE = { state: 'unavailable' };
const zeroCounts = { unopened: 0, toSort: 0, retained: 0, contacted: 0, replied: 0, interviewing: 0, hired: 0, rejected: 0 };
const counts = (o = {}) => ok({ ...zeroCounts, ...o });
const att = (o = {}) =>
  ok({
    projectId: P, hasOwnAccount: true,
    repliesMine: 0, repliesMineOldestAt: null, repliesOthers: 0, repliesOthersOldestAt: null, replyItems: [],
    interviewWaiting: 0, interviewWaitingOldestAt: null, interviewItems: [],
    toSortScored: 0, toSortRecommended: 0, jobDescribed: true,
    ...o,
  });
const reply = (o = {}) => ({
  linkId: 'l1', rowId: 'r1', candidateId: 'c1', candidateName: 'Marc Moreau', stage: 'contacted',
  chatId: 'chat1', replyAt: iso(1), isMine: true, ownerLabel: null, replySummary: null, ...o,
});
const interview = (o = {}) => ({
  rowId: 'r6', candidateId: 'c6', candidateName: 'Camille Fontaine', processStepId: 's1', stageEnteredAt: iso(6), ...o,
});
const withReplies = (items) =>
  att({ repliesMine: items.filter((i) => i.isMine).length, repliesOthers: items.filter((i) => !i.isMine).length, replyItems: items });
const withInterviews = (items, o = {}) => att({ interviewWaiting: items.length, interviewItems: items, ...o });
const input = (o = {}) => ({
  now: NOW,
  mission: { id: P, name: 'Directeur technique', status: 'active' },
  rights: { ownMission: true },
  role: 'owner',
  ownerName: 'Claire Dupont',
  orgType: ok('agency'),
  linkedin: ok('connected'),
  sendAllowed: ok(true),
  counts: counts({ contacted: 3 }),
  attention: att(),
  snoozed: null,
  interlocutor: null,
  ...o,
});
const keysOf = (...keys) => (k) => keys.includes(k);
const main = (o) => computeNowCard(input(o)).main;
const ranks = (r) => [r.main, ...r.then].filter(Boolean).map((a) => a.rank);

// ------------------------------------------------------------------ constantes et cohérence

test('3 : constantes, rangs et règles', () => {
  assert.equal(REPLY_MAX_AGE_DAYS, 30);
  assert.equal(INTERVIEW_WAIT_DAYS, 5);
  assert.equal(THEN_MAX, 3);
  assert.deepEqual([...RANK_ORDER], ['0', '1', '2', '3', '4', '5', '6', '7', '8', '8b', '9', '10', '11']);
  assert.deepEqual(Object.keys(RANK_RULES).sort(), [...RANK_ORDER].sort());
  assert.deepEqual([...UNMONITORED_RANKS], ['1', '2', '4', '5', '9']);
  for (const id of RANK_ORDER) {
    assert.equal(RANK_RULES[id].monitored, !UNMONITORED_RANKS.includes(id), `rang ${id}`);
    assert.ok(RANK_RULES[id].rule.length > 10 && RANK_RULES[id].label.length > 3);
  }
});

test('3 : les natures de report et les clés sont celles de missionSnooze', () => {
  const r = computeNowCard(input({
    attention: withReplies([reply()]), counts: counts({ retained: 2 }),
  }));
  assert.equal(r.main.snoozeKey, snoozeKey('reply', 'c1'));
  assert.equal(r.then[0].snoozeKey, snoozeKey('retained_uncontacted'));
  // Toutes les natures que la règle produit existent dans la liste de la table.
  const seen = new Set();
  const grid = [
    input({ attention: withReplies([reply()]) }),
    input({ attention: withInterviews([interview()]) }),
    input({ counts: counts({ retained: 2 }) }),
    input({ attention: att({ toSortScored: 3 }) }),
    input({ counts: counts({ unopened: 3 }) }),
    input({ counts: counts(), attention: att() }),
    input({ attention: att({ jobDescribed: false }) }),
    input({ counts: counts({ retained: 2 }), linkedin: ok('needs_reconnect') }),
    input({ attention: att({ toSortScored: 3 }), orgType: ok(null) }),
  ];
  for (const g of grid) for (const a of [computeNowCard(g).main, ...computeNowCard(g).then]) if (a?.snoozeKind) seen.add(a.snoozeKind);
  assert.equal(seen.size, 9, [...seen].join(','));
  for (const kind of seen) assert.ok(SNOOZE_KINDS.includes(kind), kind);
  for (const a of grid.flatMap((g) => [computeNowCard(g).main, ...computeNowCard(g).then])) {
    if (!a?.snoozeKey) continue;
    assert.match(a.snoozeKey, /^[a-z][a-z0-9_]*(:.+)?$/);
    assert.ok(a.snoozeKey.length <= 200);
  }
});

test('3 : seuil et exemptions de « sans mouvement » alignés sur stageDisplay', () => {
  assert.equal(display.STALE_AFTER_DAYS, 7);
  assert.deepEqual([...display.STALE_EXEMPT_STAGES].sort(), ['hired', 'rejected', 'retained', 'to_sort']);
  for (const s of ['to_sort', 'retained', 'contacted', 'replied', 'interviewing', 'hired', 'rejected']) {
    assert.ok(stage.GENERAL_STAGES.includes(s), s);
  }
});

// ------------------------------------------------------------------ chaque rang

test('3 : rang 3, une réponse sur votre compte', () => {
  const r = computeNowCard(input({ attention: withReplies([reply({ replySummary: 'Intéressé, disponible en novembre.' })]) }));
  assert.equal(r.state, 'action');
  const a = r.main;
  assert.equal(a.rank, '3');
  assert.equal(a.phrase, 'Marc Moreau vous a répondu hier.');
  assert.equal(a.subject, 'Marc Moreau');
  assert.equal(a.short, 'Répondre à Marc Moreau');
  assert.equal(a.snoozeKind, 'reply');
  assert.equal(a.snoozeKey, 'reply:c1');
  assert.equal(a.summary, 'Intéressé, disponible en novembre.');
  assert.deepEqual(a.button, { label: 'Répondre', intent: { type: 'open_row', rowId: 'r1', tab: 'echanges' } });
  assert.deepEqual(a.rowIds, ['r1']);
  assert.match(a.detail, /hier/);
});

test('3 : rang 3, plusieurs réponses : la plus ancienne d\'abord, les autres comptées', () => {
  const items = [
    reply({ candidateId: 'c2', rowId: 'r2', candidateName: 'Julie Martin', replyAt: iso(1) }),
    reply({ candidateId: 'c3', rowId: 'r3', candidateName: 'Paul Roux', replyAt: iso(4) }),
    reply({ candidateId: 'c1', rowId: 'r1', candidateName: 'Marc Moreau', replyAt: iso(2) }),
  ];
  const r = computeNowCard(input({ attention: withReplies(items) }));
  assert.equal(r.main.subject, 'Paul Roux');
  assert.match(r.main.phrase, /Paul Roux vous a répondu jeudi\. 2 autres réponses attendent aussi\.$/);
  assert.deepEqual(r.then.map((a) => a.subject), ['Marc Moreau', 'Julie Martin']);
  assert.ok(!/autre/.test(r.then[0].phrase));
  const one = computeNowCard(input({ attention: withReplies(items.slice(0, 2)) }));
  assert.match(one.main.phrase, /1 autre réponse attend aussi\.$/);
});

test('3 : rang 3, plafond de 30 jours, écartés et embauchés, compte d\'un collègue', () => {
  const edge = (offsetMs) => new Date(NOW - REPLY_MAX_AGE_DAYS * DAY + offsetMs).toISOString();
  assert.equal(main({ attention: withReplies([reply({ replyAt: edge(0) })]) }).rank, '3', '30 jours pile : comptée');
  const stale = computeNowCard(input({ attention: withReplies([reply({ replyAt: edge(-1000) })]) }));
  assert.equal(stale.main, null, 'plus de 30 jours : ne monte pas');
  assert.equal(stale.state, 'clear');
  for (const closed of ['rejected', 'hired']) {
    assert.equal(computeNowCard(input({ attention: withReplies([reply({ stage: closed })]) })).main, null, closed);
  }
  // Retenu et À trier gardés.
  for (const open of ['to_sort', 'retained']) assert.equal(main({ attention: withReplies([reply({ stage: open })]) }).rank, '3');
  const others = computeNowCard(input({ attention: withReplies([reply({ isMine: false, ownerLabel: 'Julie' })]) }));
  assert.equal(others.main, null, 'jamais la carte pour un collègue');
  // Sans autre action, l'information rejoint la phrase d'état : « Ensuite » n'est jamais une ligne sans action sous « Rien d'autre à faire ».
  assert.equal(others.then.length, 0);
  assert.equal(others.stateLine, "Rien d'autre à faire. 1 réponse reçue par un collègue.");
  const withAction = computeNowCard(input({ attention: withReplies([reply({ isMine: false, ownerLabel: 'Julie' })]), counts: counts({ retained: 4 }) }));
  assert.equal(withAction.main.rank, '7');
  assert.equal(withAction.then[0].rank, '3');
  assert.equal(withAction.then[0].button, null);
  assert.equal(withAction.then[0].short, '1 réponse reçue par un collègue');
  assert.equal(withAction.then[0].snoozeKey, null);
  const two = computeNowCard(input({ attention: withReplies([reply({ isMine: false }), reply({ isMine: false, linkId: 'l2', candidateId: 'c2' })]), counts: counts({ retained: 4 }) }));
  assert.equal(two.then[0].short, '2 réponses reçues par vos collègues');
});

test('3 : rang 3, sans ligne dans le Pipeline et sans compte relié', () => {
  const noRow = main({ attention: withReplies([reply({ rowId: null })]) });
  assert.deepEqual(noRow.button, { label: 'Répondre', intent: { type: 'open_conversation', chatId: 'chat1' } });
  assert.equal(main({ attention: withReplies([reply({ rowId: null, chatId: null })]) }).button, null);
  assert.equal(main({ attention: withReplies([reply({ candidateName: null })]) }).phrase, 'Un candidat vous a répondu hier.');
  const unlinked = computeNowCard(input({ attention: att({ hasOwnAccount: false }), linkedin: ok('not_linked') }));
  assert.equal(unlinked.main, null);
  assert.ok(unlinked.unmonitored.includes('3'));
  assert.match(unlinked.unmonitoredLine, /compte LinkedIn n'est pas relié/);
  const linked = computeNowCard(input());
  assert.deepEqual(linked.unmonitored, ['1', '2', '4', '5', '9']);
  assert.match(linked.unmonitoredLine, /conversations ouvertes depuis Konekt/);
});

test('3 : rang 3 incomplet : jamais un faux « aucune réponse »', () => {
  // 6 réponses sur le compte, 5 éléments rendus, tous trop anciens : les 6es peuvent être récentes.
  const items = Array.from({ length: 5 }, (_, i) => reply({ linkId: `l${i}`, candidateId: `c${i}`, rowId: `r${i}`, replyAt: iso(40 + i) }));
  const r = computeNowCard(input({ attention: att({ repliesMine: 6, replyItems: items }) }));
  assert.equal(r.main, null);
  assert.deepEqual(r.unavailable, ['3']);
  assert.equal(r.unavailableLine, "D'autres réponses attendent : seules les plus anciennes sont lues pour l'instant.");
  assert.equal(r.stateLine, "Aucune action à proposer pour l'instant.");
  // Une réponse visible reste proposée.
  const seen = computeNowCard(input({ attention: att({ repliesMine: 6, replyItems: [reply()] }) }));
  assert.equal(seen.main.rank, '3');
});

test('3 : rang 6, entretien depuis plus de 5 jours civils', () => {
  const at = (days, h = 9) => main({ attention: withInterviews([interview({ stageEnteredAt: iso(days, h) })]) });
  assert.equal(at(5), null, '5 jours : pas encore');
  assert.equal(at(5, 0), null);
  const a = at(6);
  assert.equal(a.rank, '6');
  assert.equal(a.phrase, 'Camille Fontaine est en entretien depuis 6 jours.');
  assert.equal(a.snoozeKey, 'stalled_interview:c6');
  assert.ok(!/a eu lieu|après l'entretien/.test(a.phrase + a.proposal + a.detail), 'aucune affirmation sur un entretien tenu');
  assert.equal(main({ attention: withInterviews([interview({ stageEnteredAt: null })]) }), null, 'sans date : rien');
  assert.equal(main({ attention: withInterviews([interview({ stageEnteredAt: 'pas une date' })]) }), null);
  // Jours civils : hier 23 h 59 est à 6 jours civils d'un lundi 00 h 01 même si 5 jours pleins seulement ont passé.
  const early = new Date(2026, 9, 5, 0, 1).getTime();
  const justOver = computeNowCard(input({ now: early, attention: withInterviews([interview({ stageEnteredAt: new Date(2026, 8, 29, 23, 59).toISOString() })]) }));
  assert.equal(justOver.main.rank, '6');
  assert.match(justOver.main.phrase, /depuis 6 jours/);
  const late = new Date(2026, 9, 5, 23, 59).getTime();
  const notYet = computeNowCard(input({ now: late, attention: withInterviews([interview({ stageEnteredAt: new Date(2026, 8, 30, 0, 0).toISOString() })]) }));
  assert.equal(notYet.main, null);
  // Plusieurs : la plus ancienne d'abord.
  const many = computeNowCard(input({ attention: withInterviews([
    interview({ candidateId: 'c7', rowId: 'r7', candidateName: 'Léa Petit', stageEnteredAt: iso(8) }),
    interview({ stageEnteredAt: iso(6) }),
  ]) }));
  assert.equal(many.main.subject, 'Léa Petit');
  assert.match(many.main.phrase, /depuis 8 jours\. 1 autre candidat est dans le même cas\.$/);
  assert.equal(many.then[0].subject, 'Camille Fontaine');
});

test('3 : rang 6, bouton selon l\'interlocuteur et le type d\'organisation', () => {
  const att6 = withInterviews([interview()]);
  const mail = main({ attention: att6, interlocutor: { name: 'Anne Leclerc', email: 'anne@client.fr' } }).button;
  assert.equal(mail.label, 'Relancer Anne Leclerc');
  assert.equal(mail.intent.type, 'mailto');
  assert.equal(mail.intent.to, 'anne@client.fr');
  assert.equal(mail.intent.subject, "Suite de l'entretien de Camille Fontaine");
  assert.match(mail.intent.body, /^Bonjour Anne,/);
  assert.match(mail.intent.body, /Camille Fontaine pour le poste « Directeur technique »/);
  assert.ok(mail.intent.href.startsWith('mailto:anne@client.fr?subject='));
  assert.equal(decodeURIComponent(mail.intent.href.split('subject=')[1].split('&body=')[0]), mail.intent.subject);
  assert.equal(decodeURIComponent(mail.intent.href.split('&body=')[1]), mail.intent.body);
  assert.equal(main({ attention: att6, interlocutor: { name: null, email: 'a@b.fr' } }).button.label, 'Relancer');
  assert.deepEqual(main({ attention: att6, orgType: ok('enterprise') }).button,
    { label: "Ajouter l'interlocuteur", intent: { type: 'open_cadrage', section: 'poste' } });
  assert.deepEqual(main({ attention: att6, orgType: ok('agency') }).button,
    { label: 'Ouvrir la fiche', intent: { type: 'open_row', rowId: 'r6', tab: null } });
  assert.deepEqual(main({ attention: att6, orgType: ok('freelance'), interlocutor: { name: 'Anne', email: '  ' } }).button.label, 'Ouvrir la fiche');
  assert.equal(buildMailto('a@b.fr', 'Un objet', 'Ligne 1\nLigne 2'), 'mailto:a@b.fr?subject=Un%20objet&body=Ligne%201%0ALigne%202');
});

test('3 : rang 7, retenus pas contactés, selon la formule', () => {
  const four = main({ counts: counts({ retained: 4 }) });
  assert.equal(four.rank, '7');
  assert.equal(four.phrase, '4 candidats retenus attendent un premier message.');
  assert.deepEqual(four.button, { label: 'Contacter les 4', intent: { type: 'contact_retained' } });
  assert.equal(four.short, 'Contacter les 4 retenus');
  assert.equal(four.snoozeKey, 'retained_uncontacted');
  const one = main({ counts: counts({ retained: 1 }) });
  assert.equal(one.phrase, '1 candidat retenu attend un premier message.');
  assert.equal(one.button.label, 'Contacter ce candidat');
  for (const sendAllowed of [ok(false), UNAVAILABLE]) {
    const b = main({ counts: counts({ retained: 4 }), sendAllowed }).button;
    assert.deepEqual(b, { label: 'Voir les retenus', intent: { type: 'filter_stage', stage: 'retained' } });
  }
  const r = computeNowCard(input({ counts: counts({ retained: 4 }), sendAllowed: LOADING }));
  assert.equal(r.state, 'loading', 'formule en chargement : ni « Contacter » ni impasse');
  // Une réponse plus haute passe avant : le chargement de la formule ne touche que la ligne Ensuite.
  const early = computeNowCard(input({ counts: counts({ retained: 4 }), sendAllowed: LOADING, attention: withReplies([reply()]) }));
  assert.equal(early.main.rank, '3');
  assert.equal(early.thenLoading, true);
  assert.equal(early.then.length, 0);
});

test('3 : rang 8, profils notés, dont recommandés', () => {
  assert.equal(main({ attention: att({ toSortScored: 4, toSortRecommended: 1 }) }).phrase, '4 nouveaux profils notés, dont 1 recommandé.');
  assert.equal(main({ attention: att({ toSortScored: 4, toSortRecommended: 2 }) }).phrase, '4 nouveaux profils notés, dont 2 recommandés.');
  assert.equal(main({ attention: att({ toSortScored: 4 }) }).phrase, '4 nouveaux profils notés.');
  const one = main({ attention: att({ toSortScored: 1, toSortRecommended: 1 }) });
  assert.equal(one.phrase, '1 nouveau profil noté, dont 1 recommandé.');
  assert.equal(one.button.label, 'Trier ce profil');
  const a = main({ attention: att({ toSortScored: 4, toSortRecommended: 1 }) });
  assert.deepEqual(a.button, { label: 'Trier les 4', intent: { type: 'open_to_sort' } });
  assert.equal(a.snoozeKey, 'to_sort');
  assert.equal(main({ attention: att({ toSortScored: 0, toSortRecommended: 0 }) }), null);
  // Plus de recommandés que de notés : rogné, jamais « dont 5 recommandés » pour 4 profils.
  assert.equal(main({ attention: att({ toSortScored: 4, toSortRecommended: 9 }) }).phrase, '4 nouveaux profils notés, dont 4 recommandés.');
});

test('3 : rang 8b, profils trouvés jamais ouverts', () => {
  const a = main({ counts: counts({ unopened: 12 }) });
  assert.equal(a.rank, '8b');
  assert.equal(a.phrase, "12 profils trouvés n'ont pas encore été ouverts.");
  assert.deepEqual(a.button, { label: 'Ouvrir le Sourcing', intent: { type: 'open_sourcing' } });
  assert.equal(a.snoozeKey, 'unopened_profiles');
  assert.equal(main({ counts: counts({ unopened: 1 }) }).phrase, "1 profil trouvé n'a pas encore été ouvert.");
});

test('3 : rangs 10 et 11, aucun profil et poste décrit, poste vide', () => {
  const first = main({ counts: counts() });
  assert.equal(first.rank, '10');
  assert.equal(first.button.intent.type, 'open_sourcing');
  assert.equal(first.snoozeKey, 'first_search');
  assert.equal(first.phrase, "Aucun profil n'a encore été trouvé pour cette mission.");
  // Des écartés comptent : la mission a des profils.
  assert.equal(main({ counts: counts({ rejected: 2 }) }), null);
  const brief = main({ counts: counts(), attention: att({ jobDescribed: false }) });
  assert.equal(brief.rank, '11', 'poste vide et aucun profil : décrire le poste, pas chercher');
  assert.deepEqual(brief.button, { label: 'Décrire le poste', intent: { type: 'open_cadrage', section: 'poste' } });
  assert.equal(brief.snoozeKey, 'describe_brief');
  // Le poste vide passe aussi derrière les profils à trier.
  assert.equal(main({ attention: att({ jobDescribed: false }) }).rank, '11');
  assert.equal(main({ attention: att({ jobDescribed: false, toSortScored: 2 }) }).rank, '8');
  // jobDescribed inconnu : indisponible, jamais « poste vide ».
  const unknown = computeNowCard(input({ counts: counts(), attention: att({ jobDescribed: null }) }));
  assert.equal(unknown.main, null);
  assert.deepEqual(unknown.unavailable, ['10', '11']);
});

// ------------------------------------------------------------------ ordre, Ensuite

const everything = (o = {}) =>
  input({
    counts: counts({ retained: 4, unopened: 12 }),
    attention: att({
      repliesMine: 1, replyItems: [reply()],
      interviewWaiting: 1, interviewItems: [interview()],
      toSortScored: 4, toSortRecommended: 1, jobDescribed: false,
    }),
    ...o,
  });

test('3 : ordre des rangs, un report fait monter l\'action suivante', () => {
  const order = ['3', '6', '7', '8', '8b', '11'];
  const snoozedKeys = [];
  for (const rank of order) {
    const r = computeNowCard(everything({ snoozed: (k) => snoozedKeys.includes(k) }));
    assert.equal(r.state, 'action');
    assert.equal(r.main.rank, rank, `attendu ${rank}`);
    snoozedKeys.push(r.main.snoozeKey);
  }
  const done = computeNowCard(everything({ snoozed: (k) => snoozedKeys.includes(k) }));
  assert.equal(done.state, 'all_snoozed');
  assert.equal(done.main, null);
  assert.equal(done.stateLine, 'Vos actions du jour sont reportées à demain.');
  assert.deepEqual([...done.snoozedKeys].sort(), [...snoozedKeys].sort());
});

test('3 : « Ensuite » : trois actions au plus, sans doublon, sans action reportée', () => {
  const r = computeNowCard(everything());
  assert.equal(r.main.rank, '3');
  assert.deepEqual(r.then.map((a) => a.rank), ['6', '7', '8']);
  assert.ok(r.then.length <= THEN_MAX);
  const keys = [r.main, ...r.then].map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length);
  const later = computeNowCard(everything({ snoozed: keysOf('retained_uncontacted') }));
  assert.deepEqual(later.then.map((a) => a.rank), ['6', '8', '8b']);
  // Chaque action de « Ensuite » est cliquable (sauf l'information sur un collègue) et justifiée.
  for (const a of r.then) {
    assert.ok(a.button, a.key);
    assert.ok(a.why.length > 0 && a.detail.length > 0);
  }
});

test('3 : un report ne vise que sa clé : une autre réponse reste proposée', () => {
  const items = [reply({ candidateId: 'c1', candidateName: 'Marc Moreau', replyAt: iso(3) }), reply({ candidateId: 'c2', rowId: 'r2', candidateName: 'Julie Martin', replyAt: iso(1) })];
  const r = computeNowCard(input({ attention: withReplies(items), snoozed: keysOf('reply:c1') }));
  assert.equal(r.main.subject, 'Julie Martin');
  assert.ok(r.snoozedKeys.includes('reply:c1'));
  assert.ok(!r.then.some((a) => a.subject === 'Marc Moreau'), 'la réponse reportée est masquée aussi dans Ensuite');
});

// ------------------------------------------------------------------ sources

test('3 : sources en chargement : ni carte, ni zéro, ni blocage', () => {
  assert.equal(computeNowCard(input({ attention: LOADING })).state, 'loading');
  assert.equal(computeNowCard(input({ counts: LOADING })).state, 'loading');
  const l = computeNowCard(input({ counts: LOADING, attention: LOADING }));
  assert.deepEqual([l.state, l.main, l.then], ['loading', null, []]);
  assert.equal(l.unavailableLine, null);
  // Un rang plus haut déjà là : la carte s'affiche, seule la ligne Ensuite attend.
  const partial = computeNowCard(input({ counts: LOADING, attention: withReplies([reply()]) }));
  assert.equal(partial.state, 'action');
  assert.equal(partial.main.rank, '3');
  assert.equal(partial.thenLoading, true);
  // Une source plus haute en chargement retient une action plus basse.
  assert.equal(computeNowCard(input({ counts: counts({ retained: 4 }), attention: LOADING })).state, 'loading');
});

test('3 : source indisponible : listée, rangs plus bas proposés, jamais « 0 réponse »', () => {
  const r = computeNowCard(input({ attention: UNAVAILABLE, counts: counts({ retained: 4 }) }));
  assert.equal(r.state, 'action');
  assert.equal(r.main.rank, '7');
  assert.deepEqual(r.unavailable, ['3', '6', '8', '11']);
  assert.match(r.unavailableLine, /Impossible de vérifier les réponses, les entretiens et le poste pour l'instant\./);
  const c = computeNowCard(input({ counts: UNAVAILABLE, attention: withReplies([reply()]) }));
  assert.equal(c.main.rank, '3');
  assert.deepEqual(c.unavailable, ['7', '8b', '10']);
  assert.match(c.unavailableLine, /effectifs de la mission/);
  const both = computeNowCard(input({ counts: UNAVAILABLE, attention: UNAVAILABLE }));
  assert.equal(both.state, 'clear');
  assert.equal(both.stateLine, "Aucune action à proposer pour l'instant.");
  assert.ok(both.unavailable.length > 0);
  assert.ok(!/\b0 réponse/.test(JSON.stringify([r, c, both])));
});

test('3 : sourceOf, linkedinSource : trois états, jamais « gratuit » par défaut', () => {
  assert.deepEqual(sourceOf({ data: false, isError: false }), { state: 'ok', value: false });
  assert.deepEqual(sourceOf({ data: 'x', isError: true }), { state: 'ok', value: 'x' }, 'une relecture ratée garde la donnée');
  assert.deepEqual(sourceOf({ data: null, isError: true }), UNAVAILABLE);
  assert.deepEqual(sourceOf({ data: null, isError: false, offline: true }), UNAVAILABLE);
  assert.deepEqual(sourceOf({ data: undefined, isError: false }), LOADING);
  assert.deepEqual(linkedinSource('loading'), LOADING);
  assert.deepEqual(linkedinSource(undefined), LOADING);
  assert.deepEqual(linkedinSource('load_error'), UNAVAILABLE);
  assert.deepEqual(linkedinSource('needs_reconnect'), ok('needs_reconnect'));
  assert.deepEqual(linkedinSource('connected'), ok('connected'));
  assert.deepEqual(linkedinSource('valeur nouvelle'), ok('unknown'));
});

test('3 : état sans action : « Rien d\'autre à faire. » et ce qui n\'est pas suivi', () => {
  const r = computeNowCard(input());
  assert.equal(r.state, 'clear');
  assert.equal(r.stateLine, "Rien d'autre à faire.");
  assert.deepEqual(r.unavailable, []);
  assert.equal(r.unavailableLine, null);
  assert.deepEqual(r.unmonitored, ['1', '2', '4', '5', '9']);
  assert.match(r.unmonitoredLine, /entretiens, les avis du client, les propositions de l'assistant et les relances automatiques ne sont pas encore suivis/);
});

test('3 : mission archivée ou d\'une autre organisation : pas de carte ; en pause ou pourvue : carte', () => {
  const archived = computeNowCard(input({ mission: { id: P, status: 'archived' }, counts: counts({ retained: 4 }) }));
  assert.deepEqual([archived.state, archived.hiddenReason, archived.main], ['hidden', 'archived', null]);
  const other = computeNowCard(input({ rights: { ownMission: false }, counts: counts({ retained: 4 }) }));
  assert.deepEqual([other.state, other.hiddenReason], ['hidden', 'other_organization']);
  for (const status of ['paused', 'completed', 'active']) {
    assert.equal(computeNowCard(input({ mission: { id: P, status }, counts: counts({ retained: 4 }) })).main.rank, '7', status);
  }
});

// ------------------------------------------------------------------ rang 0

test('3 : rang 0, compte LinkedIn : seulement s\'il empêche la meilleure action', () => {
  const blocked = (condition, extra = {}) => computeNowCard(input({ counts: counts({ retained: 4 }), linkedin: ok(condition), ...extra }));
  const off = blocked('needs_reconnect');
  assert.equal(off.state, 'action');
  assert.equal(off.main.rank, '0');
  assert.equal(off.main.phrase, 'Votre compte LinkedIn est déconnecté.');
  assert.deepEqual(off.main.button, { label: 'Reconnecter', intent: { type: 'open_linkedin_connections' } });
  assert.equal(off.main.detail, 'Cela empêche : contacter les 4 retenus.');
  assert.equal(off.main.snoozeKey, 'blocked_linkedin');
  assert.deepEqual(off.then, [], 'l\'action bloquée n\'est pas proposée en Ensuite');
  assert.equal(blocked('not_linked').main.phrase, "Votre compte LinkedIn n'est pas relié.");
  assert.equal(blocked('not_linked').main.button.label, 'Relier LinkedIn');
  assert.equal(blocked('missing').main.phrase, "Le compte LinkedIn relié à votre profil n'est plus disponible.");
  assert.equal(blocked('missing').main.button.label, 'Ouvrir les connexions');
  for (const fine of ['connected', 'connecting', 'unknown']) assert.equal(blocked(fine).main.rank, '7', fine);
  // La meilleure action n'a pas besoin de LinkedIn : pas de blocage.
  assert.equal(main({ linkedin: ok('needs_reconnect'), attention: att({ toSortScored: 3 }) }).rank, '8');
  assert.equal(main({ linkedin: ok('not_linked'), attention: att({ jobDescribed: false }) }).rank, '11');
  assert.equal(main({ linkedin: ok('not_linked'), attention: withInterviews([interview()]) }).rank, '6');
  assert.equal(main({ linkedin: ok('not_linked'), counts: counts({ unopened: 5 }) }).rank, '8b');
  // Un blocage sur l'action de rang 10 et sur la réponse du rang 3.
  assert.equal(main({ linkedin: ok('not_linked'), counts: counts() }).rank, '0');
  assert.equal(main({ linkedin: ok('needs_reconnect'), attention: withReplies([reply()]) }).rank, '0');
  // Ce qui suit, et n'a pas besoin de LinkedIn, reste proposé.
  const rest = blocked('needs_reconnect', { attention: att({ toSortScored: 2, jobDescribed: false }) });
  assert.deepEqual(rest.then.map((a) => a.rank), ['8', '11']);
});

test('3 : rang 0, jamais sur un état en chargement ; indisponible : action gardée', () => {
  const loading = computeNowCard(input({ counts: counts({ retained: 4 }), linkedin: LOADING }));
  assert.equal(loading.state, 'loading');
  assert.equal(loading.main, null);
  assert.equal(computeNowCard(input({ attention: att({ toSortScored: 3 }), orgType: LOADING })).state, 'loading');
  // Une action qui n'a pas besoin de la source en chargement s'affiche.
  assert.equal(computeNowCard(input({ attention: withInterviews([interview()]), orgType: LOADING, linkedin: LOADING })).main.rank, '6');
  const unavailable = computeNowCard(input({ counts: counts({ retained: 4 }), linkedin: UNAVAILABLE }));
  assert.equal(unavailable.main.rank, '7');
  assert.ok(unavailable.unavailable.includes('0'));
  assert.match(unavailable.unavailableLine, /Impossible de vérifier votre compte LinkedIn/);
  // Cause en chargement et autre cause bloquée : on attend, pas de bascule d'une cause à l'autre.
  assert.equal(computeNowCard(input({ counts: counts({ retained: 4 }), linkedin: LOADING, orgType: ok(null) })).state, 'loading');
});

test('3 : rang 0, type d\'organisation absent, propriétaire ou non', () => {
  const owner = computeNowCard(input({ attention: att({ toSortScored: 3 }), orgType: ok(null), role: 'owner' }));
  assert.equal(owner.main.rank, '0');
  assert.equal(owner.main.phrase, "Le type de votre organisation n'est pas renseigné.");
  assert.equal(owner.main.proposal, 'Choisissez-le pour trier, contacter et décrire le poste.');
  assert.deepEqual(owner.main.button, { label: 'Choisir le type', intent: { type: 'open_org_settings' } });
  assert.equal(owner.main.snoozeKey, 'blocked_org_type');
  assert.equal(owner.main.detail, 'Cela empêche : trier 3 profils notés.');
  const member = computeNowCard(input({ attention: att({ toSortScored: 3 }), orgType: ok(null), role: 'member' }));
  assert.equal(member.main.proposal, 'Demandez à Claire Dupont de le choisir.');
  assert.equal(member.main.button, null);
  const anon = computeNowCard(input({ attention: att({ toSortScored: 3 }), orgType: ok(null), role: 'admin', ownerName: null }));
  assert.equal(anon.main.proposal, 'Demandez à votre administrateur de le choisir.');
  // L'organisation a un type : rien. La recherche (rang 10) n'en dépend pas.
  assert.equal(main({ attention: att({ toSortScored: 3 }) }).rank, '8');
  assert.equal(main({ orgType: ok(null), counts: counts() }).rank, '10');
});

test('3 : rang 0, plusieurs causes : celle que la personne peut corriger d\'abord', () => {
  const both = (role) => computeNowCard(input({
    counts: counts({ retained: 4 }), linkedin: ok('not_linked'), orgType: ok(null), role,
  }));
  const owner = both('owner');
  assert.equal(owner.main.rank, '0');
  assert.equal(owner.main.snoozeKey, 'blocked_linkedin');
  assert.equal(owner.then[0].rank, '0');
  assert.equal(owner.then[0].snoozeKey, 'blocked_org_type');
  assert.equal(owner.then[0].button.label, 'Choisir le type');
  const member = both('member');
  assert.equal(member.main.snoozeKey, 'blocked_linkedin', 'le membre ne peut corriger que son compte');
  assert.equal(member.then[0].button, null);
  assert.deepEqual(owner.then.map((a) => a.rank), ['0']);
});

test('3 : rang 0, reportable comme les autres actions', () => {
  const base = { counts: counts({ retained: 4 }), linkedin: ok('needs_reconnect'), attention: att({ toSortScored: 2 }) };
  const snoozed = computeNowCard(input({ ...base, snoozed: keysOf('blocked_linkedin') }));
  assert.equal(snoozed.main.rank, '8', 'le blocage reporté laisse la prochaine action utilisable');
  assert.ok(snoozed.snoozedKeys.includes('blocked_linkedin'));
  const alone = computeNowCard(input({ counts: counts({ retained: 4 }), linkedin: ok('needs_reconnect'), snoozed: keysOf('blocked_linkedin') }));
  assert.equal(alone.state, 'all_snoozed');
});

test('3 : rang 0 sur téléphone : le texte dit de se reconnecter depuis un ordinateur', () => {
  const phone = main({ counts: counts({ retained: 4 }), linkedin: ok('needs_reconnect'), isPhone: true });
  assert.match(phone.proposal, /depuis un ordinateur/);
  const desktop = main({ counts: counts({ retained: 4 }), linkedin: ok('needs_reconnect') });
  assert.ok(!/ordinateur/.test(desktop.proposal));
});

// ------------------------------------------------------------------ reports

test('3 : report de réponse annulé par un message postérieur', () => {
  const row = (updatedAt) => new Map([[`${P}|reply:c1`, {
    id: 'x', projectId: P, actionKey: 'reply:c1', expiresAt: new Date(NOW + DAY).toISOString(), updatedAt,
  }]]);
  const at = (replyAt, updatedAt) => computeNowCard(input({
    attention: withReplies([reply({ replyAt })]), snoozed: snoozeChecker(row(updatedAt), P, NOW),
  }));
  // Le report date de ce matin 8 h, la réponse d'hier : reportée.
  assert.equal(at(iso(1), iso(0, 8)).state, 'all_snoozed');
  // Un message arrive à 9 h, après le report de 8 h : le report est annulé.
  assert.equal(at(iso(0, 9), iso(0, 8)).main.rank, '3');
  // Même instant : la réponse est celle du report, elle reste reportée.
  assert.equal(at(iso(0, 8), iso(0, 8)).state, 'all_snoozed');
  // Report échu : l'action revient.
  const expired = new Map([[`${P}|reply:c1`, { id: 'x', projectId: P, actionKey: 'reply:c1', expiresAt: iso(0, 9), updatedAt: iso(1) }]]);
  assert.equal(computeNowCard(input({ attention: withReplies([reply()]), snoozed: snoozeChecker(expired, P, NOW) })).main.rank, '3');
});

test('3 : missionSnooze : demain 06:00 heure locale, changements d\'heure compris', () => {
  const local = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()].join('-');
  assert.equal(local(nextLocalMorning(new Date(2026, 9, 5, 10, 0))), '2026-10-6-6-0');
  assert.equal(local(nextLocalMorning(new Date(2026, 9, 5, 3, 0))), '2026-10-6-6-0', 'cliqué à 3 h : le lendemain, pas ce matin');
  assert.equal(local(nextLocalMorning(new Date(2026, 9, 5, 23, 59))), '2026-10-6-6-0');
  assert.equal(local(nextLocalMorning(new Date(2026, 9, 31, 20, 0))), '2026-11-1-6-0');
  assert.equal(local(nextLocalMorning(new Date(2026, 11, 31, 20, 0))), '2027-1-1-6-0');
  assert.equal(local(nextLocalMorning(new Date(2026, 2, 28, 22, 0))), '2026-3-29-6-0', 'veille du passage à l\'heure d\'été');
  assert.equal(local(nextLocalMorning(new Date(2026, 2, 29, 10, 0))), '2026-3-30-6-0', 'jour du passage à l\'heure d\'été');
  assert.equal(local(nextLocalMorning(new Date(2026, 9, 24, 23, 0))), '2026-10-25-6-0', 'veille du retour à l\'heure d\'hiver');
  assert.equal(local(nextLocalMorning(new Date(2026, 9, 25, 10, 0))), '2026-10-26-6-0');
  assert.equal(local(nextLocalMorning(NOW)), '2026-10-6-6-0', 'un nombre de millisecondes est accepté');
  assert.ok(nextLocalMorning(NOW).getTime() > NOW);
});

test('3 : missionSnooze : clés, échéance, événement postérieur', () => {
  assert.equal(snoozeKey('to_sort'), 'to_sort');
  assert.equal(snoozeKey('reply', ' c1 '), 'reply:c1');
  assert.equal(snoozeKey('reply', ''), 'reply');
  assert.equal(snoozeKey('reply', null), 'reply');
  const row = (o = {}) => ({ id: 'r', projectId: P, actionKey: 'to_sort', expiresAt: new Date(NOW + 1000).toISOString(), updatedAt: new Date(NOW - 1000).toISOString(), ...o });
  const map = (r) => new Map([[`${P}|${r.actionKey}`, r]]);
  assert.equal(isSnoozed(map(row()), P, 'to_sort', NOW), true);
  assert.equal(isSnoozed(map(row()), P, 'to_sort', new Date(NOW)), true, 'une Date est acceptée');
  assert.equal(isSnoozed(map(row()), P, 'autre', NOW), false);
  assert.equal(isSnoozed(map(row()), 'autre-mission', 'to_sort', NOW), false);
  assert.equal(isSnoozed(null, P, 'to_sort', NOW), false);
  assert.equal(isSnoozed(map(row({ expiresAt: new Date(NOW).toISOString() })), P, 'to_sort', NOW), false, 'échéance atteinte');
  assert.equal(isSnoozed(map(row({ expiresAt: 'illisible' })), P, 'to_sort', NOW), false);
  assert.equal(isSnoozed(map(row()), P, 'to_sort', NOW, new Date(NOW - 2000).toISOString()), true);
  assert.equal(isSnoozed(map(row()), P, 'to_sort', NOW, new Date(NOW).toISOString()), false, 'événement après le report');
  assert.equal(isSnoozed(map(row()), P, 'to_sort', NOW, 'illisible'), false, 'date illisible : l\'action revient');
  assert.equal(snoozeChecker(map(row()), P, NOW)('to_sort'), true);
});

// ------------------------------------------------------------------ dates

test('3 : whenText et calendarDaysSince : jours civils, heure locale', () => {
  assert.equal(whenText(iso(0, 8), NOW), "aujourd'hui");
  assert.equal(whenText(iso(1, 23, 30), NOW), 'hier');
  assert.equal(whenText(iso(3), NOW), 'vendredi');
  assert.equal(whenText(iso(6), NOW), 'mardi');
  assert.equal(whenText(iso(7), NOW), 'le 28 septembre');
  assert.equal(whenText(new Date(2026, 8, 1, 9).toISOString(), NOW), 'le 1er septembre');
  assert.equal(whenText(new Date(2025, 2, 3, 9).toISOString(), NOW), 'le 3 mars 2025');
  assert.equal(whenText(null, NOW), null);
  assert.equal(whenText('pas une date', NOW), null);
  assert.equal(whenText(new Date(NOW + 3 * 3_600_000).toISOString(), NOW), "aujourd'hui", 'une horloge en avance ne donne pas de jour négatif');
  // Hier 23 h 30 et il est 0 h 10 : hier, bien que 40 minutes seulement séparent les deux.
  const night = new Date(2026, 9, 5, 0, 10).getTime();
  assert.equal(whenText(new Date(2026, 9, 4, 23, 30).toISOString(), night), 'hier');
  assert.equal(calendarDaysSince(new Date(2026, 9, 4, 23, 30).toISOString(), night), 1);
  // Passage à l'heure d'été (29 mars) : 6 jours civils, quelle que soit la durée en heures.
  assert.equal(calendarDaysSince(new Date(2026, 2, 24, 12).toISOString(), new Date(2026, 2, 30, 12).getTime()), 6);
  assert.equal(calendarDaysSince(new Date(2026, 9, 20, 12).toISOString(), new Date(2026, 9, 26, 12).getTime()), 6);
  assert.equal(calendarDaysSince(null, NOW), null);
});

// ------------------------------------------------------------------ justification, langue

const FORBIDDEN = /Rien ne presse|\(s\)|[\u2014\u2013]|\b(Unipile|Apollo|PDL|People Data Labs|Anthropic|Claude)\b|crucial|essentiel|robuste|compl[eè]t|puissan|fluide|explor|\b(tu|toi|ton|tes)\b|😀|[\u{1F300}-\u{1FAFF}]/iu;

test('3 : pourquoi maintenant : la règle, la donnée, ce qui a été examiné avant', () => {
  const r = computeNowCard(everything({ snoozed: keysOf('reply:c1') }));
  assert.equal(r.main.rank, '6');
  assert.ok(r.main.why.startsWith(RANK_RULES['6'].rule));
  assert.ok(r.main.why.includes(r.main.detail));
  assert.match(r.main.why, /Examiné avant : réponses de candidats \(reporté par vous\)\./);
  const seven = computeNowCard(input({ counts: counts({ retained: 4 }) }));
  assert.ok(seven.main.why.includes(RANK_RULES['7'].rule));
  assert.match(seven.main.why, /Aucun blocage ne l'empêche\./);
  assert.match(seven.main.why, /réponses de candidats \(rien à signaler\), entretiens sans nouvelles \(rien à signaler\)/);
  const unknown = computeNowCard(input({ counts: counts({ retained: 4 }), attention: UNAVAILABLE }));
  assert.match(unknown.main.why, /réponses de candidats \(non vérifiable\)/);
  const noCheck = computeNowCard(input({ counts: counts({ retained: 4 }), linkedin: UNAVAILABLE }));
  assert.match(noCheck.main.why, /Les blocages possibles n'ont pas pu être vérifiés\./);
  const first = computeNowCard(input({ attention: withReplies([reply()]) }));
  assert.ok(first.main.why.includes(RANK_RULES['3'].rule));
  assert.ok(!/Examiné avant/.test(first.main.why), 'rien de plus haut à examiner');
  const blocker = computeNowCard(input({ counts: counts({ retained: 4 }), linkedin: ok('not_linked') }));
  assert.ok(blocker.main.why.includes(RANK_RULES['0'].rule));
  assert.ok(blocker.main.why.includes('Cela empêche'));
});

test('3 : balayage : mêmes garanties pour toutes les combinaisons de sources', () => {
  const countsList = [LOADING, UNAVAILABLE, counts(), counts({ contacted: 2, retained: 4, unopened: 9 })];
  const attList = [
    LOADING, UNAVAILABLE, att(), att({ hasOwnAccount: false }),
    att({ repliesMine: 1, replyItems: [reply(), reply({ isMine: false, linkId: 'l9', candidateId: 'c9' })], interviewWaiting: 1,
      interviewItems: [interview()], toSortScored: 4, toSortRecommended: 1, jobDescribed: false }),
    att({ toSortScored: 1, toSortRecommended: 0, jobDescribed: null }),
  ];
  const linkedinList = [LOADING, UNAVAILABLE, ok('connected'), ok('needs_reconnect'), ok('not_linked'), ok('missing')];
  const orgList = [LOADING, UNAVAILABLE, ok(null), ok('agency'), ok('enterprise')];
  const sendList = [LOADING, UNAVAILABLE, ok(true), ok(false)];
  let n = 0;
  for (const c of countsList) for (const a of attList) for (const li of linkedinList) for (const o of orgList) for (const send of sendList) {
    for (const role of ['owner', 'member']) for (const snoozed of [null, () => true]) {
      n += 1;
      const r = computeNowCard(input({ counts: c, attention: a, linkedin: li, orgType: o, sendAllowed: send, role, snoozed, isPhone: role === 'member' }));
      const where = JSON.stringify({ c, a: a.state, li, o, send, role, snoozed: !!snoozed });
      const text = JSON.stringify(r);
      assert.ok(!FORBIDDEN.test(text), `${where} : ${text.match(FORBIDDEN)?.[0]}`);
      assert.ok(!/\b0 réponse/.test(text), where);
      assert.deepEqual(r.unmonitored.filter((x) => UNMONITORED_RANKS.includes(x)), [...UNMONITORED_RANKS], where);
      if (r.state === 'loading') {
        assert.deepEqual([r.main, r.then], [null, []], where);
        continue;
      }
      assert.ok(r.then.length <= THEN_MAX, where);
      const all = [r.main, ...r.then].filter(Boolean);
      assert.equal(new Set(all.map((x) => x.key)).size, all.length, `doublon ${where}`);
      for (const act of all) {
        for (const f of ['phrase', 'proposal', 'detail', 'why', 'short']) assert.ok(typeof act[f] === 'string' && act[f].trim() !== '', `${f} ${where}`);
        assert.ok(act.why.includes(RANK_RULES[act.rank].rule), where);
        assert.ok(RANK_ORDER.includes(act.rank));
      }
      if (r.state === 'clear') assert.ok(r.stateLine && !/Rien ne presse/.test(r.stateLine), where);
      if (r.state === 'all_snoozed') assert.ok(r.snoozedKeys.length > 0, where);
      if (r.state === 'action') assert.ok(r.main, where);
      if (r.state !== 'action') assert.equal(r.main, null, where);
      if (r.main?.rank === '0') {
        const kind = r.main.snoozeKind;
        if (kind === 'blocked_linkedin') assert.ok(li.state === 'ok' && ['needs_reconnect', 'not_linked', 'missing'].includes(li.value), where);
        if (kind === 'blocked_org_type') assert.ok(o.state === 'ok' && o.value === null, where);
        assert.ok(!all.slice(1).some((x) => x.rank !== '0' && x.button === null && x.rank !== '3'), where);
      }
      for (const x of r.then) if (x.rank === '0') assert.equal(r.main.rank, '0', where);
    }
  }
  assert.ok(n > 5000, `${n} combinaisons`);
});

test('3 : textes : pluriels et accords', () => {
  const text = (o) => main(o).phrase;
  assert.equal(text({ counts: counts({ retained: 0 }), attention: att({ toSortScored: 1 }) }), '1 nouveau profil noté.');
  assert.equal(text({ counts: counts({ retained: 2 }) }), '2 candidats retenus attendent un premier message.');
  assert.equal(text({ counts: counts({ retained: 1200 }) }), '1\u202f200 candidats retenus attendent un premier message.');
  assert.equal(main({ counts: counts({ retained: 1 }) }).proposal, 'Contactez-le maintenant.');
  assert.equal(main({ counts: counts({ retained: 3 }) }).proposal, 'Contactez-les maintenant.');
  assert.equal(main({ counts: counts({ retained: 3 }), sendAllowed: ok(false) }).proposal, 'Retrouvez-les dans la liste, filtrée sur Retenu.');
  assert.equal(main({ attention: att({ toSortScored: 1 }) }).proposal, 'Triez-le pour décider de la suite.');
  assert.equal(main({ attention: att({ toSortScored: 3 }) }).short, 'Trier 3 profils notés');
  assert.equal(main({ counts: counts({ unopened: 2 }) }).short, 'Passer en revue 2 profils trouvés');
  assert.equal(main({ counts: counts({ unopened: 1 }) }).short, 'Passer en revue 1 profil trouvé');
});

// ------------------------------------------------------------------ colonne « Prochaine action »

const rowOf = (o = {}) => ({ id: 'r1', candidateId: 'c1', stage: 'contacted', processStepId: null, stageEnteredAt: iso(2), updatedAt: iso(2), createdAt: iso(20), ...o });
const signals = (o = {}) => buildRowSignals({
  now: NOW, attention: withReplies([reply({ rowId: 'r1', candidateId: 'c1' })]).value, snoozed: null, interlocutor: null, orgType: 'agency', ...o,
});

test('3 : colonne, Répondre sur une réponse non traitée de votre compte', () => {
  const a = rowNextAction(rowOf(), signals());
  assert.equal(a.text, 'Répondre (hier)');
  assert.equal(a.rank, '3');
  assert.deepEqual(a.intent, { type: 'open_row', rowId: 'r1', tab: 'echanges' });
  assert.equal(a.snoozeKey, 'reply:c1');
  // Rapprochement par identifiant de candidat quand la ligne n'est pas celle du lien.
  assert.equal(rowNextAction(rowOf({ id: 'autre-ligne' }), signals()).text, 'Répondre (hier)');
  assert.equal(rowNextAction(rowOf({ id: 'autre', candidateId: 'c2' }), signals()).rank, null);
  assert.equal(rowNextAction(rowOf(), signals({ attention: withReplies([reply({ replyAt: iso(9) })]).value })).text, 'Répondre (il y a 9 j)');
  // Réponse de plus de 30 jours, d'un collègue, d'un écarté, report : rien.
  assert.equal(rowNextAction(rowOf(), signals({ attention: withReplies([reply({ replyAt: iso(31) })]).value })).rank, null);
  assert.equal(rowNextAction(rowOf(), signals({ attention: withReplies([reply({ isMine: false })]).value })).rank, null);
  assert.equal(rowNextAction(rowOf(), signals({ attention: att({ hasOwnAccount: false, replyItems: [reply()] }).value })).rank, null);
  assert.equal(rowNextAction(rowOf(), signals({ attention: null })).rank, null);
  assert.equal(rowNextAction(rowOf(), signals({ snoozed: keysOf('reply:c1') })).text, 'Aucune action depuis 2 j');
  const later = new Map([[`${P}|reply:c1`, { id: 'x', projectId: P, actionKey: 'reply:c1', expiresAt: new Date(NOW + DAY).toISOString(), updatedAt: iso(1, 12) }]]);
  const newer = withReplies([reply({ replyAt: iso(0, 8) })]).value;
  assert.equal(rowNextAction(rowOf(), signals({ attention: newer, snoozed: snoozeChecker(later, P, NOW) })).rank, '3', 'un message postérieur annule le report');
});

test('3 : colonne, Relancer, Contacter, texte de repos', () => {
  const sig = signals({ attention: null, interlocutor: { name: 'Anne Leclerc', email: 'anne@client.fr' } });
  const six = rowNextAction(rowOf({ stage: 'interviewing', stageEnteredAt: iso(6) }), sig);
  assert.equal(six.text, 'Relancer Anne Leclerc');
  assert.equal(six.rank, '6');
  assert.equal(six.intent.type, 'mailto');
  assert.equal(six.snoozeKey, 'stalled_interview:c1');
  const five = rowNextAction(rowOf({ stage: 'interviewing', stageEnteredAt: iso(5) }), sig);
  assert.equal(five.text, 'Aucune action depuis 5 j');
  assert.equal(five.rank, null);
  assert.equal(rowNextAction(rowOf({ stage: 'interviewing', stageEnteredAt: iso(6) }), signals({ attention: null, orgType: 'enterprise' })).text, "Ajouter l'interlocuteur");
  assert.equal(rowNextAction(rowOf({ stage: 'interviewing', stageEnteredAt: iso(6) }), signals({ attention: null })).text, 'Relancer');
  assert.equal(rowNextAction(rowOf({ stage: 'interviewing', stageEnteredAt: iso(6) }), signals({ attention: null, snoozed: keysOf('stalled_interview:c1') })).text, 'Aucune action depuis 6 j');
  const retained = rowNextAction(rowOf({ stage: 'retained' }), signals({ attention: null }));
  assert.deepEqual([retained.text, retained.rank, retained.intent], ['Contacter', '7', { type: 'contact_retained' }]);
  assert.equal(rowNextAction(rowOf({ stage: 'retained' }), signals({ attention: null, snoozed: keysOf('retained_uncontacted') })).text, 'Aucune action depuis 2 j');
  assert.equal(rowNextAction(rowOf({ stage: 'to_sort' }), signals({ attention: null })).text, 'À trier');
  assert.equal(rowNextAction(rowOf({ stage: 'hired' }), signals({ attention: null })).text, 'Aucune');
  assert.equal(rowNextAction(rowOf({ stage: 'rejected' }), signals({ attention: null })).text, null);
  assert.equal(rowNextAction(rowOf({ stageEnteredAt: null, updatedAt: null, createdAt: null }), signals({ attention: null })).text, 'Aucune action enregistrée');
  assert.equal(rowNextAction(rowOf({ stage: 'replied', stageEnteredAt: iso(0, 8) }), signals({ attention: null })).text, 'Aucune action depuis 0 j');
});

test('3 : colonne, jours pleins et « sans mouvement » identiques à stageDisplay', () => {
  const stages = ['to_sort', 'retained', 'contacted', 'replied', 'interviewing', 'hired', 'rejected'];
  const dates = [null, iso(0, 8), iso(1), iso(6), iso(7), iso(8, 2), iso(40)];
  const sig = signals({ attention: null });
  for (const st of stages) for (const entered of dates) for (const updated of [null, iso(3)]) {
    const row = rowOf({ stage: st, stageEnteredAt: entered, updatedAt: updated, createdAt: iso(60), candidateId: 'cx', id: 'rx' });
    const a = rowNextAction(row, sig);
    const dated = { stage_entered_at: entered, updated_at: updated, created_at: iso(60) };
    assert.equal(a.days, display.stageAgeDays(dated, NOW), `${st} ${entered}`);
    assert.equal(a.stale, display.isStale({ general_stage: st, process_step_id: null, ...dated }, NOW), `${st} ${entered}`);
  }
});

// ------------------------------------------------------------------ liste des missions

const listInput = (o = {}) => ({ now: NOW, mission: { id: P, status: 'active' }, counts: counts({ contacted: 2 }), attention: att(), snoozed: null, ...o });

test('3 : liste des missions, la même règle en forme courte', () => {
  const l = (o) => missionListAction(listInput(o));
  assert.deepEqual(l({ counts: counts({ retained: 4 }) }), {
    state: 'action', rank: '7', text: 'Contacter les 4 retenus', note: null,
    intent: { type: 'filter_stage', stage: 'retained' }, snoozeKey: 'retained_uncontacted',
  });
  assert.equal(l({ attention: withReplies([reply()]), counts: counts({ retained: 4 }) }).text, 'Répondre à Marc Moreau');
  assert.equal(l({ attention: att({ toSortScored: 4 }) }).text, 'Trier 4 profils notés');
  assert.equal(l({ counts: counts({ unopened: 3 }) }).rank, '8b');
  assert.equal(l({ counts: counts() }).text, 'Chercher des profils');
  assert.equal(l({ attention: att({ jobDescribed: false }) }).text, 'Décrire le poste');
  assert.equal(l({ attention: withInterviews([interview()]) }).text, 'Relancer pour Camille Fontaine');
  // Rien à dire : cellule vide, jamais un texte de repos.
  assert.deepEqual(l({}), { state: 'none', rank: null, text: null, note: null, intent: null, snoozeKey: null });
  assert.equal(l({ counts: LOADING }).state, 'loading');
  assert.equal(l({ attention: LOADING }).state, 'loading');
  assert.deepEqual([l({ counts: UNAVAILABLE, attention: UNAVAILABLE }).state, l({ counts: UNAVAILABLE, attention: UNAVAILABLE }).text], ['unavailable', 'Indisponible']);
  assert.equal(l({ mission: { id: P, status: 'archived' }, counts: counts({ retained: 4 }) }).state, 'none');
  // Réponses non vérifiées : un rang plus bas reste proposé, avec la mention.
  const partial = l({ attention: UNAVAILABLE, counts: counts({ retained: 4 }) });
  assert.equal(partial.text, 'Contacter les 4 retenus');
  assert.equal(partial.note, 'Réponses non vérifiées');
  // Report : la ligne passe à l'action suivante, tout est reporté : cellule vide.
  assert.equal(l({ counts: counts({ retained: 4 }), attention: att({ toSortScored: 2 }), snoozed: keysOf('retained_uncontacted') }).rank, '8');
  assert.equal(l({ counts: counts({ retained: 4 }), snoozed: keysOf('retained_uncontacted') }).state, 'none');
  // Pas de blocage par ligne.
  assert.equal(l({ counts: counts() }).rank, '10');
  assert.ok(!FORBIDDEN.test(JSON.stringify([l({}), l({ counts: counts({ retained: 4 }) })])));
});

test('3 : liste des missions et carte : la même action principale hors blocage', () => {
  const cases = [
    { counts: counts({ retained: 4 }) },
    { attention: withReplies([reply()]), counts: counts({ retained: 4 }) },
    { attention: att({ toSortScored: 2 }) },
    { counts: counts({ unopened: 5 }) },
    { counts: counts() },
    { attention: att({ jobDescribed: false }) },
    { attention: withInterviews([interview()]), counts: counts({ interviewing: 1 }) },
    {},
  ];
  for (const c of cases) {
    const list = missionListAction(listInput(c));
    const card = computeNowCard(input(c));
    assert.equal(list.rank, card.main?.rank ?? null, JSON.stringify(c));
    assert.equal(list.text, card.main?.short ?? null);
  }
});

// ------------------------------------------------------------------ lecture des lignes du serveur

test('3 : parseAttentionRow, tolérant et sans zéro inventé pour le poste', () => {
  assert.equal(parseAttentionRow(null), null);
  assert.equal(parseAttentionRow('x'), null);
  assert.equal(parseAttentionRow({}), null);
  assert.equal(parseAttentionRow({ project_id: '' }), null);
  const a = parseAttentionRow({
    project_id: P, has_own_account: true, replies_mine: '2', replies_mine_oldest_at: iso(3), replies_others: 1, replies_others_oldest_at: null,
    reply_items: [
      { link_id: 'l1', row_id: 'r1', candidate_id: 'c1', candidate_name: 'Marc Moreau', stage: 'contacted', chat_id: 'ch', reply_at: iso(1), is_mine: true, owner_label: 'Julie', reply_summary: 'Oui.' },
      'pas un objet', null, { is_mine: 'oui' },
    ],
    interview_waiting: 1, interview_waiting_oldest_at: iso(6),
    interview_items: [{ row_id: 'r6', candidate_id: 'c6', candidate_name: 'Camille Fontaine', process_step_id: null, stage_entered_at: iso(6) }, 3],
    to_sort_scored: 4, to_sort_recommended: -1,
  });
  assert.equal(a.projectId, P);
  assert.equal(a.hasOwnAccount, true);
  assert.equal(a.repliesMine, 2);
  assert.equal(a.repliesOthers, 1);
  assert.equal(a.replyItems.length, 2);
  assert.deepEqual(a.replyItems[0], {
    linkId: 'l1', rowId: 'r1', candidateId: 'c1', candidateName: 'Marc Moreau', stage: 'contacted', chatId: 'ch',
    replyAt: iso(1), isMine: true, ownerLabel: 'Julie', replySummary: 'Oui.',
  });
  assert.equal(a.replyItems[1].isMine, false);
  assert.equal(a.interviewItems.length, 1);
  assert.equal(a.toSortScored, 4);
  assert.equal(a.toSortRecommended, 0);
  assert.equal(a.jobDescribed, null, 'poste inconnu : null, pas faux');
  assert.equal(parseAttentionRow({ project_id: P, job_described: false }).jobDescribed, false);
  assert.equal(parseAttentionRow({ project_id: P, job_described: true }).hasOwnAccount, false);
  // Ce que la règle lit d'une ligne brute.
  const r = computeNowCard(input({ attention: ok(parseAttentionRow({ project_id: P, has_own_account: true, replies_mine: 1, reply_items: [
    { row_id: 'r1', candidate_id: 'c1', candidate_name: 'Marc Moreau', stage: 'contacted', reply_at: iso(1), is_mine: true }], job_described: true })) }));
  assert.equal(r.main.rank, '3');
});

// ------------------------------------------------------------------ correction : totaux, rangs incomplets, formules

const manyReplies = (n, isMine = true) =>
  Array.from({ length: n }, (_, i) => reply({ linkId: `m${i}`, candidateId: `m${i}`, rowId: `mr${i}`, candidateName: `Cand ${i}`, replyAt: iso(20 - i), isMine }));

test('3 : les nombres de la carte sont ceux du serveur, pas ceux de la liste tronquée', () => {
  // 12 réponses sur le compte, 5 éléments rendus : 11 autres.
  const r = computeNowCard(input({ attention: att({ repliesMine: 12, replyItems: manyReplies(5) }) }));
  assert.match(r.main.phrase, /11 autres réponses attendent aussi\.$/);
  // Une réponse reportée vue se retranche du total.
  const snoozed = computeNowCard(input({ attention: att({ repliesMine: 12, replyItems: manyReplies(5) }), snoozed: keysOf('reply:m0') }));
  assert.match(snoozed.main.phrase, /10 autres réponses attendent aussi\.$/);
  // Entretiens : 12 en attente, 5 éléments rendus, tous au-delà du seuil.
  const items = Array.from({ length: 5 }, (_, i) => interview({ rowId: `i${i}`, candidateId: `i${i}`, candidateName: `Int ${i}`, stageEnteredAt: iso(20 - i) }));
  const iv = computeNowCard(input({ attention: att({ interviewWaiting: 12, interviewItems: items }) }));
  assert.match(iv.main.phrase, /11 autres candidats sont dans le même cas\.$/);
  // Lecture complète : le compte reste celui des éléments.
  const full = computeNowCard(input({ attention: att({ interviewWaiting: 5, interviewItems: items }) }));
  assert.match(full.main.phrase, /4 autres candidats sont dans le même cas\.$/);
});

test('3 : les réponses de collègues se lisent même quand les miennes remplissent la lecture', () => {
  // La lecture est limitée : les miennes passent d'abord, aucune réponse de collègue n'est rendue parmi les éléments.
  const mine = manyReplies(2);
  const r = computeNowCard(input({ attention: att({ repliesMine: 2, repliesOthers: 3, replyItems: mine }) }));
  assert.equal(r.main.rank, '3');
  assert.ok(r.then.some((a) => a.short === '3 réponses reçues par vos collègues'), 'total du serveur');
  // Seules des réponses de collègues rendues : le total du serveur l'emporte sur les éléments.
  const only = computeNowCard(input({ attention: att({ repliesOthers: 12, replyItems: manyReplies(2, false) }), counts: counts({ retained: 2 }) }));
  assert.ok(only.then.some((a) => a.short === '12 réponses reçues par vos collègues'));
});

test('3 : toutes les réponses lues sont reportées, d\'autres existent : pas de panne, « Les reprendre » reste', () => {
  const items = manyReplies(5);
  const keys = items.map((i) => `reply:${i.candidateId}`);
  const r = computeNowCard(input({ attention: att({ repliesMine: 7, replyItems: items }), snoozed: keysOf(...keys), counts: counts({ contacted: 2 }) }));
  assert.equal(r.main, null);
  assert.equal(r.state, 'all_snoozed');
  assert.deepEqual([...r.snoozedKeys].sort(), [...keys].sort());
  assert.deepEqual(r.unavailable, ['3']);
  assert.match(r.unavailableLine, /^D'autres réponses attendent/);
  assert.doesNotMatch(r.unavailableLine, /Impossible de vérifier/);
  // Même cas pour les entretiens : jamais « tout est reporté » sans le dire.
  const iv = Array.from({ length: 5 }, (_, i) => interview({ rowId: `i${i}`, candidateId: `i${i}`, stageEnteredAt: iso(20 - i) }));
  const ik = iv.map((i) => `stalled_interview:${i.candidateId}`);
  const w = computeNowCard(input({ attention: att({ interviewWaiting: 6, interviewItems: iv }), snoozed: keysOf(...ik) }));
  assert.equal(w.main, null);
  assert.deepEqual(w.unavailable, ['6']);
  assert.match(w.unavailableLine, /^D'autres entretiens sans nouvelles attendent/);
  assert.deepEqual([...w.snoozedKeys].sort(), [...ik].sort());
  // Lecture complète et tout reporté : « tout est reporté », sans mention.
  const all = computeNowCard(input({ attention: att({ interviewWaiting: 5, interviewItems: iv }), snoozed: keysOf(...ik) }));
  assert.equal(all.state, 'all_snoozed');
  assert.equal(all.unavailableLine, null);
});

test('0 : le blocage LinkedIn n\'apparaît pas quand la formule interdit déjà l\'envoi', () => {
  for (const sendAllowed of [ok(false), UNAVAILABLE]) {
    const r = computeNowCard(input({ counts: counts({ retained: 4 }), linkedin: ok('needs_reconnect'), sendAllowed }));
    assert.equal(r.main.rank, '7', 'le geste est un filtre de la liste');
    assert.equal(r.main.button.label, 'Voir les retenus');
  }
  // Envoi permis : le blocage passe toujours devant « Contacter les 4 ».
  const allowed = computeNowCard(input({ counts: counts({ retained: 4 }), linkedin: ok('needs_reconnect') }));
  assert.equal(allowed.main.rank, '0');
  assert.match(allowed.main.detail, /Cela empêche : contacter les 4 retenus\./);
});

test('3 : une information sur un collègue n\'est jamais « à faire avant »', () => {
  const r = computeNowCard(input({ attention: withReplies([reply({ isMine: false })]), counts: counts({ retained: 4 }) }));
  assert.equal(r.main.rank, '7');
  assert.doesNotMatch(r.main.why, /à faire avant/);
  assert.match(r.main.why, /réponses de candidats \(réponses chez vos collègues\)/);
  // Une action bloquée puis reportée n'est pas « à faire avant » non plus.
  const blocked = computeNowCard(input({
    counts: counts({ retained: 4 }), attention: att({ toSortScored: 2 }), linkedin: ok('needs_reconnect'), snoozed: keysOf('blocked_linkedin'),
  }));
  assert.equal(blocked.main.rank, '8');
  assert.match(blocked.main.why, /retenus à contacter \(bloqué\)/);
});

test('3 : sans compte relié, les réponses des collègues se lisent et le texte ne se contredit pas', () => {
  const r = computeNowCard(input({
    attention: att({ hasOwnAccount: false, repliesOthers: 1, replyItems: [reply({ isMine: false })] }), linkedin: ok('not_linked'),
    counts: counts({ contacted: 2 }),
  }));
  assert.equal(r.main, null);
  assert.equal(r.stateLine, "Rien d'autre à faire. 1 réponse reçue par un collègue.");
  assert.match(r.unmonitoredLine, /^Les réponses reçues sur votre compte ne sont pas suivies/);
  const why = computeNowCard(input({
    attention: att({ hasOwnAccount: false, toSortScored: 3 }), linkedin: ok('not_linked'),
  })).main.why;
  assert.match(why, /réponses de candidats \(non suivi sur votre compte\)/);
  assert.doesNotMatch(why, /réponses de candidats \(rien à signaler\)/);
});

test('3 : « Rien d\'autre à faire » ne précède jamais une ligne « Ensuite »', () => {
  const r = computeNowCard(input({ attention: withReplies([reply({ isMine: false })]) }));
  assert.equal(r.state, 'clear');
  assert.deepEqual(r.then, []);
  const done = computeNowCard(input({
    attention: withReplies([reply({ isMine: false }), reply({ candidateId: 'c9', linkId: 'l9', rowId: 'r9' })]), snoozed: keysOf('reply:c9'),
  }));
  assert.equal(done.state, 'all_snoozed');
  assert.equal(done.stateLine, 'Vos actions du jour sont reportées à demain. 1 réponse reçue par un collègue.');
  assert.deepEqual(done.then, []);
});

test('3 : sans nom de candidat, les formes courtes disent « un candidat »', () => {
  const r = computeNowCard(input({
    attention: att({ repliesMine: 1, replyItems: [reply({ candidateName: null })] }), counts: counts({ retained: 2 }), linkedin: ok('needs_reconnect'),
  }));
  assert.equal(r.main.rank, '0');
  assert.equal(r.main.detail, 'Cela empêche : répondre à un candidat.');
  const direct = computeNowCard(input({ attention: att({ repliesMine: 1, replyItems: [reply({ candidateName: null })] }) }));
  assert.equal(direct.main.phrase, 'Un candidat vous a répondu hier.');
  assert.equal(direct.main.short, 'Répondre à un candidat');
  const iv = main({ attention: withInterviews([interview({ candidateName: null })]), interlocutor: { name: 'Anne Leclerc', email: 'anne@client.fr' } });
  assert.equal(iv.short, 'Relancer pour un candidat');
  assert.equal(iv.button.intent.subject, "Suite de l'entretien d'un candidat");
  assert.match(iv.button.intent.body, /au sujet de l'entretien d'un candidat pour le poste/);
});

test('3 : liste des missions, la note ne vise que les rangs plus hauts que l\'action affichée', () => {
  const l = (o) => missionListAction(listInput(o));
  // Rang 3 affiché, effectifs illisibles (rangs plus bas) : aucune note.
  assert.equal(l({ counts: UNAVAILABLE, attention: withReplies([reply()]) }).note, null);
  // Rang 7 affiché, rang 3 non lu : la note reste.
  assert.equal(l({ counts: counts({ retained: 4 }), attention: UNAVAILABLE }).note, 'Réponses non vérifiées');
});

test('3 : une adresse d\'interlocuteur sans forme d\'adresse ne donne pas de lien mailto', () => {
  const att6 = withInterviews([interview()]);
  for (const email of ['à confirmer', 'n/a', 'anne@client', '@client.fr', 'anne client@x.fr']) {
    const a = main({ attention: att6, interlocutor: { name: 'Anne Leclerc', email }, orgType: ok('enterprise') });
    assert.equal(a.button.label, "Ajouter l'interlocuteur", email);
    const row = rowNextAction(rowOf({ stage: 'interviewing', stageEnteredAt: iso(6) }), signals({ attention: null, interlocutor: { name: 'Anne', email } }));
    assert.equal(row.intent.type, 'open_row', email);
  }
  assert.equal(main({ attention: att6, interlocutor: { name: null, email: ' anne@client.fr ' } }).button.intent.to, 'anne@client.fr');
});

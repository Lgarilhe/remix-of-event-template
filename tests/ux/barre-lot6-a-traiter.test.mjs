/**
 * Barre latérale, lot 6 : onglet À traiter (§4, §6 et §11.3 de la
 * spécification, chantier C3).
 *
 * Les modules purs (businessDays, sidebarSignals, notificationKinds,
 * linkedinStatus) sont transpilés en mémoire par esbuild et chargés par une
 * URL data: (patron de notification-kinds.test.mjs). Les hooks et les
 * sections, qui dépendent du client Supabase, sont vérifiés par inspection de
 * source.
 *
 * Fuseau fixé à Europe/Paris : les jours ouvrés et le changement d'heure du
 * 25/10/2026 se vérifient en heure locale.
 *
 * Lancer : node --test tests/ux/barre-lot6-a-traiter.test.mjs
 */
process.env.TZ = 'Europe/Paris';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const load = async (rel) => {
  const { code } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

const businessDaysSrc = read('src/lib/businessDays.ts');
const signalsSrc = read('src/lib/sidebarSignals.ts');
const { businessDaysCutoff, isWithinBusinessDays } = await load('src/lib/businessDays.ts');
const {
  badgeLabel,
  groupReplies,
  repliesToShow,
  todoCount,
  deriveAgentSignals,
  formatShortTime,
  canJoin,
  splitInterviews,
  ACTIVITY_OPEN_STORAGE_KEY,
} = await load('src/lib/sidebarSignals.ts');
const { notificationOrgFilter, isInActiveOrg } = await load('src/lib/notificationKinds.ts');
const { myLinkedInNeedsAction } = await load('src/lib/linkedinStatus.ts');

const notificationsHook = read('src/hooks/sidebar/useSidebarNotifications.ts');
const activityHook = read('src/hooks/sidebar/useSidebarActivity.ts');
const agentSignalsHook = read('src/hooks/sidebar/useAgentSignals.ts');
const interviewsHook = read('src/hooks/sidebar/useTodoInterviews.ts');
const realtimeHook = read('src/hooks/sidebar/useSidebarRealtime.ts');
const outageHook = read('src/hooks/sidebar/useLinkedInOutage.ts');
const todoSignalHook = read('src/hooks/sidebar/useTodoSignal.ts');
const approvalCard = read('src/components/agent/AgentToolApprovalCard.tsx');
const approvals = read('src/components/sidebar/todo/ApprovalsSection.tsx');
const forYouSection = read('src/components/sidebar/todo/ForYouSection.tsx');
const outageSection = read('src/components/sidebar/todo/LinkedInOutageSection.tsx');
const repliesSection = read('src/components/sidebar/todo/RepliesSection.tsx');
const activitySection = read('src/components/sidebar/todo/ActivitySection.tsx');
const todoPanel = read('src/components/sidebar/todo/TodoPanel.tsx');
const inbox = read('src/pages/Inbox.tsx');
const dashboard = read('src/pages/Dashboard.tsx');
const focusPanel = read('src/components/dashboard/DashboardFocusPanel.tsx');
const todayPanel = read('src/components/dashboard/DashboardTodayPanel.tsx');

const hasImport = (src) => /^\s*import\s/m.test(src) || /\bimport\s*\(/.test(src) || /\brequire\s*\(/.test(src);
const count = (src, needle) => src.split(needle).length - 1;
const sameLocal = (d, y, m, day, h) =>
  d.getFullYear() === y && d.getMonth() === m && d.getDate() === day && d.getHours() === h && d.getMinutes() === 0;

// ---------------------------------------------------------------- Modules purs
test('B6-1 — businessDays.ts et sidebarSignals.ts sans import', () => {
  assert.equal(hasImport(businessDaysSrc), false);
  assert.equal(hasImport(signalsSrc), false);
});

test('B6-2 — jours ouvrés : week-end sauté, heure locale gardée au changement d’heure', () => {
  assert.ok(sameLocal(businessDaysCutoff(new Date(2026, 8, 21, 10), 3), 2026, 8, 16, 10), 'lundi → mercredi précédent');
  assert.ok(sameLocal(businessDaysCutoff(new Date(2026, 8, 26, 10), 3), 2026, 8, 23, 10), 'samedi → mercredi');
  assert.ok(sameLocal(businessDaysCutoff(new Date(2026, 9, 28, 9), 3), 2026, 9, 23, 9), 'passage à l’heure d’hiver');
  const now = new Date(2026, 8, 21, 10);
  assert.equal(isWithinBusinessDays(new Date(2026, 8, 16, 10).toISOString(), now, 3), true);
  assert.equal(isWithinBusinessDays(new Date(2026, 8, 16, 9).toISOString(), now, 3), false);
});

test('B6-3 — pastille : « 9+ » au-delà de 9', () => {
  assert.equal(badgeLabel(1), '1');
  assert.equal(badgeLabel(9), '9');
  assert.equal(badgeLabel(10), '9+');
  assert.equal(ACTIVITY_OPEN_STORAGE_KEY, 'konekt:nav:activity-open');
});

const notif = (id, at, metadata, title = 'Nouveau message de Léa Martin') => ({
  id, title, link: metadata.chat_id ? `/inbox?chatId=${metadata.chat_id}` : '/inbox', created_at: at, metadata,
});

test('B6-4 — réponses : une ligne par conversation, autres comptées à part, anciennes gardées', () => {
  const cutoff = new Date(2026, 8, 18, 10);
  const recent = (min) => new Date(2026, 8, 21, 9, min).toISOString();
  const rows = [
    ...[1, 2, 3, 4, 5].map((i) => notif(`n${i}`, recent(i), { chat_id: 'c1', is_candidate: true, profile_name: 'Léa Martin', project_id: 'p1' })),
    notif('o1', recent(10), { chat_id: 'c2', is_candidate: false }),
    notif('o2', recent(11), { chat_id: 'c3' }),
    notif('old', new Date(2026, 8, 10, 9).toISOString(), { chat_id: 'c4', is_candidate: true }, 'Nouveau message de Paul Durand'),
  ];
  const { candidates, others } = groupReplies(rows, cutoff);
  assert.equal(others, 2);
  assert.equal(candidates.length, 2);
  const [lea, paul] = candidates;
  assert.equal(lea.chatId, 'c1');
  assert.deepEqual([...lea.ids].sort(), ['n1', 'n2', 'n3', 'n4', 'n5']);
  assert.equal(lea.name, 'Léa Martin');
  assert.equal(lea.projectId, 'p1');
  assert.equal(lea.lastAt, recent(5));
  assert.equal(lea.counted, true);
  assert.equal(paul.name, 'Paul Durand', 'repli sur le titre sans « Nouveau message de »');
  assert.equal(paul.counted, false, 'une réponse d’avant le seuil ne compte pas');
});

test('B6-4 — réponse sans conversation : groupée sur son id, chatId null', () => {
  const { candidates } = groupReplies([notif('x1', new Date().toISOString(), { is_candidate: true })], new Date(0));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].chatId, null);
  assert.deepEqual(candidates[0].ids, ['x1']);
});

test('réponses — toutes les comptées affichées, les anciennes complètent jusqu’à 8', () => {
  const mk = (n, counted) => Array.from({ length: n }, (_, i) => ({ id: `${counted}-${i}`, counted }));
  assert.equal(repliesToShow([...mk(10, true), ...mk(3, false)]).length, 10);
  const mixed = repliesToShow([...mk(5, true), ...mk(6, false)]);
  assert.equal(mixed.length, 8);
  assert.equal(mixed.filter((r) => r.counted).length, 5);
  assert.equal(repliesToShow(mk(12, false)).length, 8);
});

const ok = (data) => ({ status: 'ok', data });
const emptyInput = () => ({
  replies: ok({ candidates: [] }),
  signals: ok({ actions: [], plans: [] }),
  forYouActionCount: ok(0),
  linkedinOutage: ok(false),
});

test('B6-5 — chiffre : une source sans donnée donne null', () => {
  for (const status of ['loading', 'offline', 'error']) {
    for (const key of ['replies', 'signals', 'forYouActionCount', 'linkedinOutage']) {
      assert.equal(todoCount({ ...emptyInput(), [key]: { status, data: undefined } }), null, `${key} ${status}`);
    }
  }
});

test('B6-5 — chiffre : erreur avec données, panne, somme, tout vide', () => {
  assert.equal(todoCount(emptyInput()), 0);
  assert.equal(todoCount({ ...emptyInput(), linkedinOutage: ok(true) }), 1);
  assert.equal(
    todoCount({ ...emptyInput(), replies: { status: 'error', data: { candidates: [{ counted: true }, { counted: false }] } } }),
    1,
    'une source en erreur qui garde ses données compte',
  );
  assert.equal(
    todoCount({
      replies: ok({ candidates: [{ counted: true }, { counted: true }, { counted: false }] }),
      signals: ok({ actions: [{}, {}], plans: [{}] }),
      forYouActionCount: ok(4),
      linkedinOutage: ok(true),
    }),
    1 + 2 + 3 + 4,
  );
});

test('B6-5 — signaux : plan et action d’une même conversation comptent une fois, agent bloqué exclu', () => {
  const now = new Date(2026, 8, 23, 12);
  const at = (h, m = 0) => new Date(2026, 8, 23, h, m).toISOString();
  const convs = [
    { id: 'c1', status: 'plan_proposed', updated_at: at(11) },
    { id: 'c2', status: 'plan_proposed', updated_at: at(10) },
    { id: 'c3', status: 'plan_proposed', updated_at: new Date(2026, 8, 14, 12).toISOString() },
    { id: 'r1', status: 'running', updated_at: at(11, 30) },
    { id: 'r2', status: 'running', updated_at: at(10, 30) },
  ];
  const { plans, running } = deriveAgentSignals(convs, [{ conversation_id: 'c1' }, { conversation_id: null }], now);
  assert.deepEqual(plans.map((p) => p.id), ['c2'], 'c1 a une action (D29), c3 est hors fenêtre');
  assert.deepEqual(running.map((r) => r.id), ['r1'], 'r2 : plus de 60 minutes (D30)');
  const onlyPlan = deriveAgentSignals([convs[0]], [{ conversation_id: 'c1' }], now);
  assert.equal(onlyPlan.plans.length, 0);
});

test('signaux — la fenêtre des plans suit businessDaysCutoff', () => {
  for (const now of [new Date(2026, 8, 21, 10), new Date(2026, 8, 26, 10), new Date(2026, 9, 28, 9)]) {
    const cutoff = businessDaysCutoff(now, 3);
    const justIn = { id: 'in', status: 'plan_proposed', updated_at: cutoff.toISOString() };
    const justOut = { id: 'out', status: 'plan_proposed', updated_at: new Date(cutoff.getTime() - 1).toISOString() };
    assert.deepEqual(deriveAgentSignals([justIn, justOut], [], now).plans.map((p) => p.id), ['in']);
  }
});

test('B6-6 — Rejoindre : lien http(s), de 15 minutes avant le début à la fin', () => {
  const start = new Date(2026, 8, 23, 10);
  const row = { event_location: 'https://meet.example.org/abc', event_start_at: start.toISOString(), event_end_at: new Date(2026, 8, 23, 11).toISOString() };
  assert.equal(canJoin(row, new Date(2026, 8, 23, 9, 50)), true);
  assert.equal(canJoin(row, new Date(2026, 8, 23, 9, 40)), false);
  assert.equal(canJoin(row, new Date(2026, 8, 23, 11, 1)), false);
  assert.equal(canJoin({ ...row, event_location: 'Visio' }, new Date(2026, 8, 23, 10, 5)), false);
  assert.equal(canJoin({ ...row, event_location: null }, new Date(2026, 8, 23, 10, 5)), false);
  assert.equal(canJoin({ ...row, event_end_at: null }, new Date(2026, 8, 23, 10, 55)), true, 'sans fin : 60 minutes');
});

test('B6-6 — entretiens : aujourd’hui et comptes rendus disjoints', () => {
  const now = new Date(2026, 8, 23, 11);
  const iv = (id, h1, m1, h2, m2, status = 'scheduled', day = 23) => ({
    id, status,
    event_start_at: new Date(2026, 8, day, h1, m1).toISOString(),
    event_end_at: h2 === null ? null : new Date(2026, 8, day, h2, m2).toISOString(),
  });
  const nine = iv('nine', 9, 0, 10, 0);
  const halfTen = iv('halfTen', 10, 30, 11, 30);
  const done = iv('done', 8, 0, 9, 0, 'completed');
  let r = splitInterviews([nine, halfTen, done], now);
  assert.deepEqual(r.debriefs.map((x) => x.id), ['nine']);
  assert.deepEqual(r.today.map((x) => x.id), ['halfTen']);

  const rows = [
    nine, halfTen, done,
    iv('later', 15, 0, 16, 0),
    iv('noEnd', 10, 30, null, null),
    iv('noEndPast', 9, 30, null, null),
    iv('yesterday', 14, 0, 15, 0, 'scheduled', 22),
    iv('lastWeek', 14, 0, 15, 0, 'scheduled', 17),
    iv('doneToday', 16, 0, 17, 0, 'completed'),
    { id: 'noStart', status: 'scheduled', event_start_at: null, event_end_at: null },
  ];
  r = splitInterviews(rows, now);
  const todayIds = r.today.map((x) => x.id);
  const debriefIds = r.debriefs.map((x) => x.id);
  assert.deepEqual(todayIds, ['halfTen', 'noEnd', 'later'], 'par heure croissante');
  assert.deepEqual(debriefIds, ['noEndPast', 'nine', 'yesterday', 'lastWeek'], 'du plus récent au plus ancien');
  assert.equal(todayIds.filter((id) => debriefIds.includes(id)).length, 0, 'aucune ligne dans les deux listes');
});

test('B6-7 — heures courtes', () => {
  const now = new Date(2026, 8, 23, 15, 0);
  assert.equal(formatShortTime(new Date(2026, 8, 23, 8, 12).toISOString(), now), '08:12');
  assert.equal(formatShortTime(new Date(2026, 8, 22, 23, 50).toISOString(), now), 'hier');
  assert.equal(
    formatShortTime(new Date(2026, 8, 21, 9).toISOString(), now),
    new Date(2026, 8, 21, 9).toLocaleDateString('fr-FR', { weekday: 'short' }),
  );
  assert.equal(
    formatShortTime(new Date(2026, 8, 12, 9).toISOString(), now),
    new Date(2026, 8, 12, 9).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
  );
  assert.equal(formatShortTime('pas une date', now), '');
});

test('B6-8 — notificationKinds : filtre d’organisation déplacé', () => {
  assert.equal(notificationOrgFilter('o1'), 'organization_id.eq.o1,organization_id.is.null');
  assert.equal(notificationOrgFilter(null), 'organization_id.is.null');
  assert.equal(isInActiveOrg({ organization_id: null }, 'o1'), true);
  assert.equal(isInActiveOrg({ organization_id: 'o1' }, 'o1'), true);
  assert.equal(isInActiveOrg({ organization_id: 'o2' }, 'o1'), false);
});

test('B6-17 — panne LinkedIn : liaisons, puis liste, puis statut enregistré', () => {
  const me = { user_id: 'u1', linkedin_account_id: 'a1', account_status: 'OK' };
  const base = { userId: 'u1', mappings: [me], mappingsLoaded: true, accounts: [], accountsLoaded: false };
  assert.equal(myLinkedInNeedsAction({ ...base, mappings: [], mappingsLoaded: false }), null);
  assert.equal(myLinkedInNeedsAction({ ...base, userId: null }), null);
  assert.equal(myLinkedInNeedsAction({ ...base, mappings: [{ ...me, user_id: 'u2' }] }), false);
  assert.equal(myLinkedInNeedsAction({ ...base, accounts: [{ id: 'a1', status: 'CREDENTIALS' }], accountsLoaded: true }), true);
  assert.equal(myLinkedInNeedsAction({ ...base, accounts: [{ id: 'a1', status: 'OK' }], accountsLoaded: true }), false);
  assert.equal(myLinkedInNeedsAction({ ...base, accounts: [], accountsLoaded: true }), true, 'compte disparu');
  assert.equal(myLinkedInNeedsAction({ ...base, mappings: [{ ...me, account_status: 'CREDENTIALS' }] }), true);
  assert.equal(myLinkedInNeedsAction({ ...base, mappings: [{ ...me, account_status: 'OK' }] }), false);
  assert.doesNotMatch(outageHook, /invokeEdgeFunction/);
  assert.doesNotMatch(outageHook, /unipile/i);
});

// ---------------------------------------------------------------- Hooks (source)
test('B6-9 — Réponses et Pour vous : périmètre, bornes, erreurs', () => {
  const orgFilters = notificationsHook.match(/\.or\(notificationOrgFilter\(organizationId\)\)/g) ?? [];
  assert.ok(orgFilters.length >= 3, 'deux lectures et le marquage global filtrent par organisation');
  assert.match(notificationsHook, /\.eq\('type', 'new_message'\)[\s\S]{0,200}\.limit\(100\)/);
  assert.match(notificationsHook, /\.not\('type', 'in', '\(new_message,linkedin_disconnected\)'\)[\s\S]{0,120}\.limit\(50\)/);
  assert.ok(count(notificationsHook, 'if (error) throw error') >= 2);
  const markAll = notificationsHook.slice(notificationsHook.indexOf('const markAllForYouRead'));
  assert.match(markAll, /\.not\('type', 'in', '\(new_message,linkedin_disconnected\)'\)/);
  assert.match(markAll, /\.or\(notificationOrgFilter\(organizationId\)\)/);
  assert.doesNotMatch(notificationsHook, /activity-open/);
  assert.doesNotMatch(notificationsHook, /\.limit\(30\)/);
  assert.doesNotMatch(notificationsHook, /placeholderData/);
  assert.match(notificationsHook, /businessDaysCutoff\(/);
  assert.match(notificationsHook, /toast\.error\(MARK_ERROR\)/);
  assert.match(notificationsHook, /Le marquage n'a pas été enregistré\. Réessayez\./);
});

test('B6-9 — Activité : lecture à part, seulement section ouverte', () => {
  assert.match(activityHook, /\.or\(notificationOrgFilter\(organizationId\)\)/);
  assert.match(activityHook, /\.neq\('type', 'new_message'\)/);
  assert.match(activityHook, /\.limit\(30\)/);
  assert.match(activityHook, /enabled: open &&/);
  assert.doesNotMatch(activityHook, /placeholderData/);
  assert.match(activitySection, /useSidebarActivity\(open\)/);
  assert.match(activitySection, /ACTIVITY_OPEN_STORAGE_KEY/);
  assert.match(activitySection, /try \{[\s\S]*localStorage/);
});

test('B6-10 — signaux de l’assistant : filtres « moi », organisation, fenêtre', () => {
  assert.match(agentSignalsHook, /\.eq\('user_id', userId\)/);
  assert.match(agentSignalsHook, /\.eq\('created_by', userId\)/);
  assert.equal(count(agentSignalsHook, ".eq('organization_id', organizationId)"), 2);
  assert.match(agentSignalsHook, /\.in\('status', \['plan_proposed', 'running'\]\)/);
  assert.match(agentSignalsHook, /\.is\('archived_at', null\)/);
  assert.match(agentSignalsHook, /businessDaysCutoff/);
  assert.match(agentSignalsHook, /deriveAgentSignals\(/);
  assert.match(agentSignalsHook, /Promise\.all/);
});

test('B6-11 — entretiens : animateur, sinon créateur, borné', () => {
  assert.match(interviewsHook, /manager_id\.eq\./);
  assert.match(interviewsHook, /and\(manager_id\.is\.null,created_by\.eq\./);
  assert.match(interviewsHook, /\.limit\(50\)/);
  // La borne doit couper les plus anciens, jamais ceux du jour.
  assert.match(interviewsHook, /order\('event_start_at', \{ ascending: false \}\)/);
  assert.match(interviewsHook, /\.eq\('organization_id', organizationId\)/);
  assert.match(interviewsHook, /mineTodayIds/);
});

test('B6-12 — temps réel : un canal, regroupé, rattrapage', () => {
  assert.match(realtimeHook, /sidebar-signals-\$\{userId\}-\$\{\+\+channelSeq\}/);
  assert.equal(count(realtimeHook, "'postgres_changes'"), 3);
  assert.match(realtimeHook, /removeChannel/);
  assert.match(realtimeHook, /clearTimeout/);
  assert.match(realtimeHook, /setTimeout\([^)]*300\)/);
  assert.match(realtimeHook, /'SUBSCRIBED'/);
  // Première inscription : seules les données lues avant le canal sont relues.
  assert.match(realtimeHook, /if \(firstSubscribe\) \{\s*firstSubscribe = false;/);
  assert.match(realtimeHook, /dataUpdatedAt < effectStart/);
  assert.match(realtimeHook, /'online'/);
  assert.match(realtimeHook, /'visibilitychange'/);
  assert.match(realtimeHook, /=== 'new_message'/);
  assert.match(realtimeHook, /\}, \[userId, queryClient\]\);/);
});

test('B6-13 — bandeau d’approbation : 3 jours ouvrés au lieu de 24 h', () => {
  assert.doesNotMatch(approvalCard, /24 \* 3600 \* 1000/);
  assert.match(approvalCard, /businessDaysCutoff\(/);
});

test('B6-14 — retrait d’un plan en un clic, avec « Annuler »', () => {
  assert.match(approvals, /Retirer ce plan/);
  assert.match(approvals, /Plan retiré\./);
  assert.match(approvals, /Annuler/);
  assert.match(approvals, /archived_at: null/);
  assert.ok(count(approvals, ".select('id')") >= 2);
  assert.match(approvals, /\.eq\('status', 'plan_proposed'\)/);
  assert.match(approvals, /duration: 8000/);
  assert.doesNotMatch(approvals, /AlertDialog/);
  assert.doesNotMatch(approvals, /window\.confirm/);
  assert.match(approvals, /Le plan n'a pas été retiré\. Réessayez\./);
  assert.match(approvals, /Le plan n'a pas été rétabli\. Réessayez\./);
});

// B6-15 : l'absence des anciens fichiers (cloche, compteur de messages) est
// vérifiée par B-C11 (barre-lot56-coquille.test.mjs, chantier C1b).

test('B6-16 — messagerie : seule la conversation ouverte est marquée lue', () => {
  assert.match(inbox, /metadata->>chat_id/);
  assert.match(inbox, /onChatChange/);
  const chains = inbox.split(".from('notifications')").slice(1);
  assert.ok(chains.length >= 1);
  for (const chain of chains) {
    const statement = chain.slice(0, chain.indexOf(';'));
    assert.match(statement, /metadata->>chat_id/, 'chaque écriture filtre sur la conversation');
  }
  assert.match(inbox, /if \(!user\?\.id \|\| !chatId\) return;/);
});

test('B6-18 — tableau de bord : données de la barre', () => {
  assert.doesNotMatch(dashboard, /useUnreadMessageNotifications/);
  assert.match(dashboard, /useSidebarNotifications/);
  assert.match(focusPanel, /number \| null/);
  assert.match(focusPanel, /Indisponible/);
  assert.match(focusPanel, /'Chargement'/);
  assert.match(todayPanel, /mineTodayIds/);
});

test('B6-19 — icônes de Pour vous et ligne de panne', () => {
  assert.match(forYouSection, /CreditCard/);
  assert.match(forYouSection, /'\/pricing'/);
  assert.match(outageSection, /Compte LinkedIn à reconnecter/);
  assert.match(outageSection, /Les envois sont en pause/);
  assert.match(outageSection, /\/settings\/account\/connections/);
  assert.match(outageSection, /Impossible de vérifier votre compte LinkedIn\./);
});

test('B6-20 — Réponses : toujours affichée, messagerie en un clic, comptées jamais tronquées', () => {
  assert.match(repliesSection, /Ouvrir la messagerie/);
  assert.match(repliesSection, /Aucune réponse en attente\./);
  assert.match(repliesSection, /hideWhenEmpty=\{false\}/);
  assert.match(repliesSection, /Impossible de charger vos réponses\./);
  assert.doesNotMatch(repliesSection, /\.slice\(0, 8\)/);
  assert.match(repliesSection, /repliesToShow\(/);
});

test('B6-21 — Activité : jamais de gras, un point « Non lu »', () => {
  assert.doesNotMatch(activitySection, /\bstrong\b/);
  assert.match(activitySection, /dotLabel/);
  assert.match(activitySection, /Aucune activité ces 30 derniers jours\./);
});

test('panneau — ordre des sections et « Rien à traiter » sous Réponses', () => {
  const order = ['<LinkedInOutageSection', '<FirstStepsSection', '<InterviewsSections', '<RepliesSection',
    'Rien à traiter pour le moment.', '<ApprovalsSection variant="todo"', '<ForYouSection', '<ActivitySection'];
  const jsx = todoPanel.slice(todoPanel.indexOf('return ('));
  const idx = order.map((s) => jsx.indexOf(s));
  assert.ok(idx.every((i) => i >= 0), 'toutes les sections sont rendues');
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, 'ordre fixe');
  assert.match(todoSignalHook, /todoCount\(/);
});

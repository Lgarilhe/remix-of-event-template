/**
 * Barre latérale : zone « Événements à venir » et alerte de début d'entretien.
 *
 * Le module pur sidebarSignals est transpilé en mémoire par esbuild et chargé
 * par une URL data: (patron de barre-lot6-a-traiter.test.mjs). Les hooks et
 * les composants, qui dépendent du client Supabase et du routeur, sont
 * vérifiés par inspection de source.
 *
 * Fuseau fixé à Europe/Paris, comme les autres tests de la barre.
 *
 * Lancer : node --test tests/ux/barre-evenements-a-venir.test.mjs
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

const {
  ALERT_GRACE_MS,
  UPCOMING_DISPLAY_LIMIT,
  dueInterviewAlerts,
  formatUpcomingTime,
  interviewAlertKey,
  interviewLinks,
  isInterviewActive,
  joinUrlOf,
  upcomingInterviews,
} = await load('src/lib/sidebarSignals.ts');

const MIN = 60_000;
// Mercredi 7 octobre 2026, 9 h (heure de Paris).
const NOW = new Date(2026, 9, 7, 9, 0, 0);
const at = (minutes) => new Date(NOW.getTime() + minutes * MIN).toISOString();

const row = (id, startMin, extra = {}) => ({
  id,
  event_start_at: at(startMin),
  event_end_at: at(startMin + 45),
  status: 'scheduled',
  ...extra,
});

test('EV-1 — la liste garde les entretiens non rendus qui ne sont pas finis, par heure', () => {
  const rows = [
    row('later', 300),
    row('ended', -120),
    row('done', 30, { status: 'completed' }),
    row('cancelled', 40, { status: 'cancelled' }),
    row('running', -10),
    row('soon', 8),
    { id: 'no-date', event_start_at: null, event_end_at: null, status: 'scheduled' },
  ];
  assert.deepEqual(upcomingInterviews(rows, NOW).map((r) => r.id), ['running', 'soon', 'later']);
});

test('EV-2 — sans heure de fin, un entretien dure une heure', () => {
  const noEnd = { id: 'x', event_start_at: at(-50), event_end_at: null, status: 'scheduled' };
  assert.equal(upcomingInterviews([noEnd], NOW).length, 1);
  const noEndOld = { id: 'y', event_start_at: at(-70), event_end_at: null, status: 'scheduled' };
  assert.equal(upcomingInterviews([noEndOld], NOW).length, 0);
});

test('EV-3 — la limite d\'affichage coupe la liste', () => {
  const rows = Array.from({ length: 9 }, (_, i) => row(`r${i}`, 10 + i * 5));
  assert.equal(upcomingInterviews(rows, NOW, UPCOMING_DISPLAY_LIMIT).length, UPCOMING_DISPLAY_LIMIT);
  assert.equal(upcomingInterviews(rows, NOW).length, 9);
});

test('EV-4 — les actions se proposent 15 minutes avant et jusqu\'à la fin', () => {
  assert.equal(isInterviewActive(row('a', 16), NOW), false);
  assert.equal(isInterviewActive(row('a', 15), NOW), true);
  assert.equal(isInterviewActive(row('a', -30), NOW), true);
  assert.equal(isInterviewActive(row('a', -46), NOW), false);
  assert.equal(isInterviewActive({ event_start_at: null, event_end_at: null }, NOW), false);
});

test('EV-5 — heure d\'une ligne', () => {
  assert.equal(formatUpcomingTime(at(-5), NOW), 'En cours');
  assert.equal(formatUpcomingTime(at(0), NOW), 'En cours');
  assert.equal(formatUpcomingTime(at(8), NOW), 'Dans 8 min');
  assert.equal(formatUpcomingTime(new Date(NOW.getTime() + 20_000).toISOString(), NOW), 'Dans 1 min');
  assert.equal(formatUpcomingTime(at(59), NOW), 'Dans 59 min');
  assert.equal(formatUpcomingTime(new Date(2026, 9, 7, 17, 0).toISOString(), NOW), '17:00');
  assert.equal(formatUpcomingTime(new Date(2026, 9, 8, 14, 30).toISOString(), NOW), 'Demain 14:30');
  const friday = new Date(2026, 9, 9, 14, 30);
  assert.equal(
    formatUpcomingTime(friday.toISOString(), NOW),
    `${friday.toLocaleDateString('fr-FR', { weekday: 'short' })} 14:30`,
  );
  const later = new Date(2026, 9, 20, 10, 0);
  assert.equal(
    formatUpcomingTime(later.toISOString(), NOW),
    `${later.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} 10:00`,
  );
  assert.equal(formatUpcomingTime('pas une date', NOW), '');
});

test('EV-6 — adresses : fiche, grille, assistant, avec la mission', () => {
  const links = interviewLinks({ id: 'q1', candidate_profile_id: 'cand 1', project_id: 'p-1' });
  assert.equal(links.qualification, '/qualification/q1');
  assert.equal(links.candidate, '/pipeline?candidate=cand%201');
  assert.equal(links.scorecard, '/pipeline/scorecard/cand%201?mission=p-1&session=q1');
  assert.equal(links.coaching, '/pipeline/scorecard/cand%201?mission=p-1&session=q1&coaching=1');
});

test('EV-7 — adresses sans mission, puis sans candidat', () => {
  const noMission = interviewLinks({ id: 'q1', candidate_profile_id: 'c1', project_id: null });
  assert.equal(noMission.scorecard, '/pipeline/scorecard/c1?session=q1');
  assert.equal(noMission.coaching, '/pipeline/scorecard/c1?session=q1&coaching=1');
  const noCandidate = interviewLinks({ id: 'q2', candidate_profile_id: null, project_id: 'p-1' });
  assert.deepEqual(noCandidate, { qualification: '/qualification/q2', candidate: null, scorecard: null, coaching: null });
});

test('EV-8 — lien de visio', () => {
  assert.equal(joinUrlOf(' https://meet.example.com/abc '), 'https://meet.example.com/abc');
  assert.equal(joinUrlOf('Bureau Paris'), null);
  assert.equal(joinUrlOf('+33 6 12 34 56 78'), null);
  assert.equal(joinUrlOf(null), null);
});

test('EV-9 — l\'alerte part à l\'heure du début, pas avant', () => {
  const none = new Set();
  assert.equal(dueInterviewAlerts([row('a', 1)], NOW, none).length, 0);
  assert.equal(dueInterviewAlerts([row('a', 0)], NOW, none).length, 1);
  assert.equal(dueInterviewAlerts([row('a', -5)], NOW, none).length, 1);
});

test('EV-10 — l\'alerte reste proposée 10 minutes, puis seule la ligne de la zone reste', () => {
  const none = new Set();
  const graceMin = ALERT_GRACE_MS / MIN;
  assert.equal(graceMin, 10);
  assert.equal(dueInterviewAlerts([row('a', -(graceMin - 1))], NOW, none).length, 1);
  assert.equal(dueInterviewAlerts([row('a', -graceMin)], NOW, none).length, 0);
  // Un entretien court (fin avant les 10 minutes) n'est plus signalé après sa fin.
  const short = row('s', -4, { event_end_at: at(-1) });
  assert.equal(dueInterviewAlerts([short], NOW, none).length, 0);
});

test('EV-11 — une alerte ne se répète pas, sauf si l\'entretien est déplacé', () => {
  const r = row('a', -2);
  assert.equal(dueInterviewAlerts([r], NOW, new Set([interviewAlertKey(r)])).length, 0);
  const moved = { ...r, event_start_at: at(-1) };
  assert.notEqual(interviewAlertKey(moved), interviewAlertKey(r));
  assert.equal(dueInterviewAlerts([moved], NOW, new Set([interviewAlertKey(r)])).length, 1);
});

test('EV-12 — jamais d\'alerte pour un entretien rendu ou annulé', () => {
  const none = new Set();
  assert.equal(dueInterviewAlerts([row('a', -1, { status: 'completed' })], NOW, none).length, 0);
  assert.equal(dueInterviewAlerts([row('a', -1, { status: 'cancelled' })], NOW, none).length, 0);
});

// ─── Inspection de source ────────────────────────────────────────────────────

const appSidebar = read('src/components/AppSidebar.tsx');
const zone = read('src/components/sidebar/UpcomingEvents.tsx');
const buttons = read('src/components/sidebar/InterviewActionButtons.tsx');
const toastView = read('src/components/sidebar/InterviewAlertToast.tsx');
const alertsHook = read('src/hooks/sidebar/useInterviewAlerts.tsx');
const upcomingHook = read('src/hooks/sidebar/useUpcomingInterviews.ts');

test('EV-13 — la barre monte la zone (barre dépliée) et l\'alerte (toujours)', () => {
  assert.match(appSidebar, /import \{ UpcomingEvents \} from '\.\/sidebar\/UpcomingEvents'/);
  assert.match(appSidebar, /\{!collapsed && <UpcomingEvents \/>\}/);
  assert.match(appSidebar, /useInterviewAlerts\(\);/);
});

test('EV-14 — la lecture est celle des entretiens que j\'anime, dans mon organisation', () => {
  assert.match(upcomingHook, /\.from\('qualification_sessions'\)/);
  assert.match(upcomingHook, /\.eq\('organization_id', organizationId\)/);
  assert.match(upcomingHook, /manager_id\.eq\.\$\{userId\},and\(manager_id\.is\.null,created_by\.eq\.\$\{userId\}\)/);
  // Sous ['sidebar', …] : le rattrapage au retour du réseau la relit.
  assert.match(upcomingHook, /queryKey: \['sidebar', 'upcoming-interviews'/);
});

test('EV-15 — l\'alerte, rendue hors du routeur, ne lit aucun contexte', () => {
  assert.doesNotMatch(toastView, /react-router/);
  assert.doesNotMatch(buttons, /react-router/);
  assert.doesNotMatch(buttons, /useSidebar|useCloseMobileSidebar/);
  assert.match(alertsHook, /toast\.custom\(/);
  assert.match(alertsHook, /navigate\(to\)/);
});

test('EV-16 — l\'alerte se mémorise et se tait sur la grille du candidat', () => {
  assert.match(alertsHook, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(alertsHook, /\/pipeline\/scorecard\//);
});

test('EV-17 — la zone propose fiche, grille et assistant, et renvoie vers l\'agenda', () => {
  assert.match(zone, /to="\/calendar"/);
  assert.match(zone, /isInterviewActive\(row, now\)/);
  assert.match(buttons, /links\.coaching/);
  assert.match(buttons, /links\.scorecard/);
  assert.match(buttons, /links\.candidate/);
  assert.match(buttons, /Assistant d'entretien/);
});

test('EV-18 — aucun nom de prestataire dans les textes affichés', () => {
  for (const src of [zone, buttons, toastView]) {
    assert.doesNotMatch(src, /Unipile|Apollo|PDL|People Data Labs|Calendly|Anthropic/);
  }
});

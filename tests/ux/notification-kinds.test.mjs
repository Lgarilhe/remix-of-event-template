/**
 * Lot 2 de la barre latérale — classement des notifications et justesse des
 * compteurs.
 *
 * notificationKind (src/lib/notificationKinds.ts) décide ce qui alimentera
 * « À traiter » : chaque écriture inventoriée en tête de ce fichier a ici son
 * cas. Le module TypeScript est transpilé en mémoire par esbuild (déjà présent
 * via Vite), sans fichier intermédiaire ni navigateur.
 *
 * Les hooks, qui dépendent du client Supabase, sont vérifiés par inspection de
 * source, dans le style des autres tests de tests/ux.
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const { code } = transformSync(read('src/lib/notificationKinds.ts'), { loader: 'ts', format: 'esm' });
const { notificationKind, isActionable } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

const useNotifications = read('src/hooks/useNotifications.ts');
const useUnreadMessages = read('src/hooks/useUnreadMessageNotifications.ts');
const dropdown = read('src/components/notifications/NotificationDropdown.tsx');

// ---------------------------------------------------------------- Inventaire
// Une ligne par écriture de la table notifications, avec les valeurs réellement
// écrites (metadata vaut '{}' par défaut quand l'écrivain ne la fournit pas).
const market = (extra = {}) => ({ source: 'marketplace', application_id: 'a1', project_id: 'p1', ...extra });
const inventaire = [
  ['unipile-webhook : message reçu',
    { type: 'new_message', link: '/inbox?chatId=c1', metadata: { chat_id: 'c1' } }, 'message'],
  ['unipile-webhook : message reçu sans conversation',
    { type: 'new_message', link: '/inbox', metadata: {} }, 'message'],
  ['unipile-webhook : compte déconnecté',
    { type: 'linkedin_disconnected', link: '/settings?tab=account', metadata: { linkedin_account_id: 'x' } }, 'action'],
  ['unipile-webhook : compte non rattaché',
    { type: 'error', link: '/settings?tab=account', metadata: { linkedin_account_id: 'x' } }, 'action'],
  ['CandidateCommentsTab : mention',
    { type: 'mention', link: '/pipeline?candidate=k1', metadata: {} }, 'action'],
  ['process-agent-tasks : scoring terminé',
    { type: 'success', link: '/missions/p1?tab=pipeline',
      metadata: { source: 'agent_background_task', task_id: 't1', kind: 'score_mission_profiles' } }, 'action'],
  ['process-agent-tasks : scoring terminé hors mission',
    { type: 'success', link: '/pipeline', metadata: { source: 'agent_background_task', task_id: 't1' } }, 'action'],
  ['process-agent-tasks : tâche interrompue',
    { type: 'error', link: '/missions/p1?tab=pipeline',
      metadata: { source: 'agent_background_task', task_id: 't1', error: 'boom' } }, 'action'],
  ['run-agent-search : profils retenus',
    { type: 'success', link: '/agents',
      metadata: { source: 'agent_search', conversation_id: 'c1', go_count: 4 } }, 'action'],
  ['agent-daily-digest',
    { type: 'digest', link: '/dashboard', metadata: { source: 'agent_daily_digest', date: '2026-09-22' } }, 'info'],
  ['marketplace-admin : bienvenue dans le cercle',
    { type: 'success', link: '/marketplace', metadata: { source: 'marketplace_admin', feature: 'marketplace_recruit' } }, 'info'],
  ['SQL : fin d’essai',
    { type: 'error', link: '/pricing', metadata: {} }, 'action'],
  ['SQL : nouvelle candidature à traiter',
    { type: 'info', link: '/missions/p1?tab=config', metadata: market() }, 'action'],
  ['SQL : candidature acceptée (mission confiée)',
    { type: 'success', link: '/missions/p1', metadata: market() }, 'action'],
  ['SQL : candidature non retenue',
    { type: 'info', link: '/marketplace', metadata: market() }, 'info'],
  ['SQL : collaboration terminée',
    { type: 'info', link: '/marketplace', metadata: market() }, 'info'],
  ['SQL : mission pourvue, annulée ou retirée',
    { type: 'info', link: '/marketplace', metadata: market() }, 'info'],
  ['SQL : bienvenue dans le cercle',
    { type: 'success', link: '/marketplace', metadata: { source: 'marketplace', feature: 'marketplace_recruit' } }, 'info'],
];

for (const [nom, notif, attendu] of inventaire) {
  test(`classement — ${nom} → ${attendu}`, () => {
    assert.equal(notificationKind(notif), attendu);
    assert.equal(isActionable(notif), attendu === 'action');
  });
}

test('classement — le type seul ne décide pas', () => {
  const candidature = { type: 'info', link: '/missions/p1?tab=config', metadata: market() };
  const refus = { type: 'info', link: '/marketplace', metadata: market() };
  assert.notEqual(notificationKind(candidature), notificationKind(refus));

  const scoring = { type: 'success', link: '/missions/p1?tab=pipeline', metadata: { source: 'agent_background_task' } };
  const bienvenue = { type: 'success', link: '/marketplace', metadata: { source: 'marketplace', feature: 'marketplace_recruit' } };
  assert.notEqual(notificationKind(scoring), notificationKind(bienvenue));
});

test('classement — un lien vers une mission ne suffit pas sans source marketplace', () => {
  assert.equal(notificationKind({ type: 'info', link: '/missions/p1', metadata: {} }), 'info');
  assert.equal(notificationKind({ type: 'success', link: '/missions/p1', metadata: null }), 'info');
});

test('classement — metadata absente ou malformée : repli sans erreur', () => {
  for (const metadata of [undefined, null, 'marketplace', 42, ['marketplace'], { source: 7 }]) {
    assert.equal(notificationKind({ type: 'info', link: '/missions/p1', metadata }), 'info');
  }
  assert.equal(notificationKind({ type: 'info', link: null, metadata: market() }), 'info');
  assert.equal(notificationKind({ type: 'inconnu' }), 'info');
});

test('classement — les messages ne sont pas des actions (compteur à part)', () => {
  assert.equal(isActionable({ type: 'new_message', link: '/inbox', metadata: {} }), false);
});

// ---------------------------------------------------------------- Périmètre
test('périmètre — liste, « tout marquer lu » et temps réel limités à l’organisation active', () => {
  assert.match(useNotifications, /organization_id\.eq\.\$\{organizationId\},organization_id\.is\.null/);
  const filtres = useNotifications.match(/\.or\(notificationOrgFilter\(organizationId\)\)/g) ?? [];
  assert.ok(filtres.length >= 2, 'la lecture et « tout marquer lu » doivent filtrer par organisation');
  const markAll = useNotifications.slice(useNotifications.indexOf('const markAllAsRead'));
  assert.match(markAll, /\.or\(notificationOrgFilter\(organizationId\)\)/);
  assert.match(useNotifications, /if \(!isInActiveOrg\(newNotif, organizationId\)\) return;/);
});

test('périmètre — le compteur de messages suit la même règle', () => {
  assert.match(useUnreadMessages, /\.or\(notificationOrgFilter\(organizationId\)\)/);
  const gardes = useUnreadMessages.match(/isInActiveOrg\(row, organizationId\)/g) ?? [];
  assert.equal(gardes.length, 2, 'INSERT et UPDATE doivent vérifier l’organisation');
  assert.match(useUnreadMessages, /\[isReady, user, orgLoading, organizationId\]/);
});

// ---------------------------------------------------------------- Pannes
test('panne — une erreur de lecture garde la liste et remonte un état error', () => {
  const fetchFn = useNotifications.slice(
    useNotifications.indexOf('const fetchNotifications'),
    useNotifications.indexOf('useEffect(', useNotifications.indexOf('const fetchNotifications')),
  );
  assert.match(fetchFn, /if \(fetchError\) throw fetchError;/, 'l’erreur PostgREST ne doit plus être ignorée');
  const catchBlock = fetchFn.slice(fetchFn.indexOf('} catch (err) {'), fetchFn.indexOf('} finally {'));
  assert.match(catchBlock, /setError\(/);
  assert.doesNotMatch(catchBlock, /^\s*setNotifications\(\[\]\);/m, 'une panne ne doit pas vider la liste');
  assert.match(useNotifications, /\n\s+error,\n/, 'le hook doit exposer error');
});

test('panne — rechargement à la reconnexion, au retour du réseau et sur l’onglet', () => {
  assert.match(useNotifications, /status === 'SUBSCRIBED' && isMounted\) void fetchNotifications\(\)/);
  assert.match(useNotifications, /addEventListener\('online', reload\)/);
  assert.match(useNotifications, /addEventListener\('visibilitychange', onVisibilityChange\)/);
});

test('panne — la cloche propose « Réessayer » au lieu de « Aucune notification »', () => {
  assert.match(dropdown, /Réessayer/);
  assert.match(dropdown, /onClick=\{\(\) => void refresh\(\)\}/);
  assert.match(dropdown, /notifications\.length === 0 && !error \?/);
});

test('compteur d’actions exposé sans changer le badge de la cloche', () => {
  assert.match(useNotifications, /actionUnreadCount/);
  assert.match(useNotifications, /!n\.read_at && n\.type !== 'new_message'/, 'le badge garde sa règle actuelle');
  assert.doesNotMatch(dropdown, /actionUnreadCount/);
});

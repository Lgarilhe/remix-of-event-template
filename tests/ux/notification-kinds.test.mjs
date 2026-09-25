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
import { existsSync, readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const { code } = transformSync(read('src/lib/notificationKinds.ts'), { loader: 'ts', format: 'esm' });
const { notificationKind, isActionable } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

// Lectures de la barre latérale (lot 6) : la cloche, useNotifications et le
// compteur de messages n'existent plus (A2, D24). Aucun fichier supprimé n'est
// lu au chargement du module, pour que l'inventaire reste testé.
const sidebarNotifications = read('src/hooks/sidebar/useSidebarNotifications.ts');
const sidebarRealtime = read('src/hooks/sidebar/useSidebarRealtime.ts');
const todoSignal = read('src/hooks/sidebar/useTodoSignal.ts');
const dashboard = read('src/pages/Dashboard.tsx');

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
  ['unipile-webhook : réponse par e-mail, sans conversation',
    { type: 'new_message', link: '/missions/p1?tab=outreach',
      metadata: { is_candidate: true, channel: 'email', enrollment_id: 'e1', enrollment_ids: ['e1'], sequence_id: 's1', project_id: 'p1' } }, 'message'],
  ['unipile-webhook : rebond d’e-mail, séquence arrêtée',
    { type: 'action', link: '/missions/p1?tab=outreach',
      metadata: { source: 'email_bounce', enrollment_id: 'e1', sequence_id: 's1', project_id: 'p1' } }, 'action'],
  ['calendly-webhook : RDV pris, séquence arrêtée',
    { type: 'action', link: '/qualification/q1',
      metadata: { source: 'calendly', enrollment_ids: ['e1'], sequence_id: 's1', qualification_session_id: 'q1' } }, 'action'],
  ['calendly-webhook : RDV pris sans session de qualification',
    { type: 'action', link: '/missions', metadata: { source: 'calendly', enrollment_ids: ['e1'], sequence_id: 's1' } }, 'action'],
  ['process-sequences : séquence mise en pause automatiquement',
    { type: 'error', link: '/missions/p1?tab=outreach',
      metadata: { source: 'sequence_auto_pause', sequence_id: 's1', failed: 4, actioned: 5 } }, 'action'],
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
test('périmètre — lectures et « tout marquer lu » limités à l’organisation active', () => {
  const filtres = sidebarNotifications.match(/\.or\(notificationOrgFilter\(organizationId\)\)/g) ?? [];
  assert.ok(filtres.length >= 3, 'Réponses, Pour vous et « tout marquer lu » doivent filtrer par organisation');
  const markAll = sidebarNotifications.slice(sidebarNotifications.indexOf('const markAllForYouRead'));
  assert.match(markAll, /\.or\(notificationOrgFilter\(organizationId\)\)/);
  // Le temps réel invalide les lectures, qui filtrent déjà : aucune ligne
  // reçue par le canal n'est insérée telle quelle, d'où l'absence de garde
  // isInActiveOrg dans le hook.
  assert.doesNotMatch(sidebarNotifications, /isInActiveOrg/);
  assert.doesNotMatch(sidebarRealtime, /setQueryData/);
  assert.match(sidebarRealtime, /invalidateQueries/);
});

test('périmètre — le compteur du tableau de bord lit les Réponses de la barre', () => {
  assert.doesNotMatch(dashboard, /useUnreadMessageNotifications/);
  assert.match(dashboard, /useSidebarNotifications\(\)/);
  assert.match(dashboard, /candidates\.filter\(\(c\) => c\.counted\)\.length : null/);
});

// ---------------------------------------------------------------- Pannes
test('panne — une erreur de lecture remonte au lieu d’être ignorée', () => {
  const erreurs = sidebarNotifications.match(/if \(error\) throw error;/g) ?? [];
  assert.ok(erreurs.length >= 2, 'Réponses et Pour vous lèvent l’erreur PostgREST');
  assert.doesNotMatch(sidebarNotifications, /placeholderData/);
});

test('panne — rechargement à la reconnexion, au retour du réseau et sur l’onglet', () => {
  assert.match(sidebarRealtime, /status !== 'SUBSCRIBED'/);
  assert.match(sidebarRealtime, /addEventListener\('online', catchUp\)/);
  assert.match(sidebarRealtime, /addEventListener\('visibilitychange', onVisibilityChange\)/);
});

// ---------------------------------------------------------------- Cloche retirée
test('la cloche n’existe plus', () => {
  assert.equal(existsSync(new URL('../../src/components/notifications/NotificationDropdown.tsx', import.meta.url)), false);
  assert.doesNotMatch(read('src/components/AppHeader.tsx'), /NotificationDropdown/);
});

test('le chiffre d’actions passe par todoCount', () => {
  assert.match(todoSignal, /todoCount\(/);
  assert.match(todoSignal, /forYouActionCount: \{ status: forYou\.status, data: forYou\.data\?\.actions\.length \}/);
  assert.match(sidebarNotifications, /actions: rows\.filter\(\(n\) => isActionable\(n\)\)/);
});

/**
 * Ce que l'application dit à un membre quand son compte LinkedIn change d'état (constat F12 de la visite
 * du 12/10/2026) : un seul prédicat, lu par le bandeau du tableau de bord et par la ligne et le chiffre
 * d'« À traiter » (src/lib/linkedinStatus.ts, linkedInOutageKind et myLinkedInOutage).
 *
 * - à reconnecter (CREDENTIALS, ERROR et statuts proches, compte disparu) : bandeau « Reconnecter » ;
 * - accès restreint (LOCKED, ou is_locked) : bandeau et ligne sans « Reconnecter » (se reconnecter n'y
 *   change rien) ;
 * - connexion limitée (DEGRADED) et PARTIAL : état de carte seulement, ni bandeau, ni ligne, ni chiffre.
 *   La classe de santé de la carte ne change pas (PARTIAL reste « à reconnecter » sur la carte).
 *
 * Lancer : node --test tests/ux/etat-compte-alertes.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { build } from 'esbuild';
import { loadTs, read, ROOT } from './connexion-helpers.mjs';

const status = await loadTs('src/lib/linkedinStatus.ts');
const { linkedInOutageKind, myLinkedInOutage, classifyConnectionHealth, resolveMyLinkedInStatus } = status;

// --------------------------------------------------------------------------- Prédicat pur
test('linkedInOutageKind : à reconnecter pour CREDENTIALS, ERROR et statuts proches', () => {
  for (const s of ['CREDENTIALS', 'ERROR', 'errored', 'disconnected', 'DISCONNECTED', 'STOPPED', 'PERMISSIONS', 'DELETED', 'CAPTCHA']) {
    assert.equal(linkedInOutageKind({ status: s }), 'reconnect', s);
  }
});

test('linkedInOutageKind : LOCKED, ou is_locked sur un compte actif ou limité : restreint', () => {
  assert.equal(linkedInOutageKind({ status: 'LOCKED' }), 'locked');
  assert.equal(linkedInOutageKind({ status: 'locked' }), 'locked');
  assert.equal(linkedInOutageKind({ status: 'OK', isLocked: true }), 'locked');
  assert.equal(linkedInOutageKind({ status: 'DEGRADED', isLocked: true }), 'locked');
});

test('linkedInOutageKind : DEGRADED et PARTIAL sont un état de carte, pas une panne à signaler', () => {
  for (const s of ['DEGRADED', 'degraded', 'PARTIAL', 'partial', ' Partial ']) {
    assert.equal(linkedInOutageKind({ status: s }), null, s);
  }
});

test('linkedInOutageKind : connecté, en synchronisation, en connexion, inconnu : rien', () => {
  for (const s of ['OK', 'RUNNING', 'CONNECTING', 'UNKNOWN', 'PAUSED', 'NOUVEAU_CODE', '', null, undefined]) {
    assert.equal(linkedInOutageKind({ status: s }), null, String(s));
  }
  assert.equal(linkedInOutageKind({ status: 'OK', sync: 'running' }), null);
});

test('linkedInOutageKind : un compte à reconnecter le reste même verrouillé (comme la carte)', () => {
  assert.equal(linkedInOutageKind({ status: 'CREDENTIALS', isLocked: true }), 'reconnect');
  assert.equal(linkedInOutageKind({ status: 'ERROR', isLocked: true }), 'reconnect');
});

test('la classe de santé de la carte ne bouge pas : PARTIAL reste needs_reconnect, DEGRADED limited, LOCKED locked', () => {
  assert.equal(classifyConnectionHealth({ status: 'PARTIAL' }), 'needs_reconnect');
  assert.equal(classifyConnectionHealth({ status: 'DEGRADED' }), 'limited');
  assert.equal(classifyConnectionHealth({ status: 'LOCKED' }), 'locked');
  assert.equal(resolveMyLinkedInStatus({
    userId: 'u1', mappings: [{ user_id: 'u1', linkedin_account_id: 'a1', account_status: 'OK' }], mappingsLoaded: true,
    accounts: [{ id: 'a1', status: 'PARTIAL' }], accountsLoaded: true,
  }).state, 'needs_reconnect');
});

// --------------------------------------------------------------------------- Compte de la personne
const ME = 'u1';
const mapping = (account_status) => ({ user_id: ME, linkedin_account_id: 'a1', account_status });
const withList = (account, mapStatus = 'OK') => ({
  userId: ME, mappings: [mapping(mapStatus)], mappingsLoaded: true, accounts: account ? [account] : [], accountsLoaded: true,
});
const withoutList = (mapStatus) => ({
  userId: ME, mappings: [mapping(mapStatus)], mappingsLoaded: true, accounts: [], accountsLoaded: false,
});

test('myLinkedInOutage : inconnu tant que les liaisons ne sont pas reçues, rien sans liaison à soi', () => {
  assert.equal(myLinkedInOutage({ ...withoutList('OK'), mappingsLoaded: false, mappings: [] }), null);
  assert.equal(myLinkedInOutage({ ...withoutList('OK'), userId: null }), null);
  assert.equal(myLinkedInOutage({ ...withoutList('OK'), mappings: [{ ...mapping('CREDENTIALS'), user_id: 'u2' }] }), false);
});

test('myLinkedInOutage, liste des comptes reçue : à reconnecter, restreint, rien', () => {
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'CREDENTIALS' })), 'reconnect');
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'ERROR' })), 'reconnect');
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'LOCKED' })), 'locked');
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'OK', is_locked: true })), 'locked');
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'OK' })), false);
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'DEGRADED' })), false);
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'PARTIAL' })), false, 'PARTIAL : état de carte seulement');
  assert.equal(myLinkedInOutage(withList(null)), 'reconnect', 'compte disparu : à reconnecter');
});

test('myLinkedInOutage, sans liste : le statut enregistré sur la liaison fait foi', () => {
  assert.equal(myLinkedInOutage(withoutList('CREDENTIALS')), 'reconnect');
  assert.equal(myLinkedInOutage(withoutList('ERROR')), 'reconnect');
  assert.equal(myLinkedInOutage(withoutList('LOCKED')), 'locked');
  assert.equal(myLinkedInOutage(withoutList('OK')), false);
  assert.equal(myLinkedInOutage(withoutList('DEGRADED')), false);
  assert.equal(myLinkedInOutage(withoutList('PARTIAL')), false);
});

test('retour à OK : la panne disparaît quel que soit son genre (jamais au clic)', () => {
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'LOCKED' }, 'LOCKED')), 'locked');
  assert.equal(myLinkedInOutage(withList({ id: 'a1', status: 'OK' }, 'OK')), false);
  assert.equal(myLinkedInOutage(withoutList('OK')), false);
});

// --------------------------------------------------------------------------- Rendus
const stubs = {
  name: 'stubs',
  setup(b) {
    // La ligne et la section de la barre latérale demandent un SidebarProvider : leur rendu est remplacé
    // par un balisage minimal (titre, sous-titre, lien), ce qui garde le texte et le lien décidés par la section.
    b.onResolve({ filter: /(hooks\/useMissionStageCounts|integrations\/supabase\/client|hooks\/sidebar\/useLinkedInOutage|\/SidebarRow|\/SidebarSection)$/ }, (args) => ({
      path: args.path,
      namespace: 'stub',
    }));
    const stubSource = {
      useLinkedInOutage: 'export const useLinkedInOutage = () => globalThis.__outage;',
      SidebarRow: "import { createElement as h } from 'react';\n"
        + "export const SidebarRow = ({ title, sub, to }) => h('a', { href: to }, h('b', null, title), h('span', null, sub));",
      SidebarSection: "export const SidebarSection = ({ children }) => children ?? null;",
    };
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
      const name = Object.keys(stubSource).find((key) => args.path.endsWith(key));
      return {
        contents: name
          ? stubSource[name]
          : ['export const supabase = {};', 'export const useMissionStageCounts = () => ({ data: undefined });'].join('\n'),
        loader: 'js',
        resolveDir: ROOT,
      };
    });
  },
};

const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { DashboardFocusPanel } from './src/components/dashboard/DashboardFocusPanel';",
      "export { LinkedInOutageSection } from './src/components/sidebar/todo/LinkedInOutageSection';",
      "export { MemoryRouter } from 'react-router-dom';",
      "export { createElement } from 'react';",
      "export { renderToStaticMarkup } from 'react-dom/server.browser';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  loader: { '.webp': 'empty' },
  tsconfig: join(ROOT, 'tsconfig.app.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [stubs],
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const inRouter = (component, props) =>
  kit.renderToStaticMarkup(kit.createElement(kit.MemoryRouter, null, kit.createElement(component, props)));
const focus = (props) => inRouter(kit.DashboardFocusPanel, { unreadMessages: 0, pendingResponses: 0, stagnantCandidates: 0, ...props });
const section = (outage) => {
  globalThis.__outage = { status: 'ok', outage: outage !== null, kind: outage, retry: () => {} };
  return inRouter(kit.LinkedInOutageSection, {});
};

test('bandeau du tableau de bord : à reconnecter garde son texte et son bouton', () => {
  const html = focus({ linkedinIssue: true });
  assert.match(html, />Compte LinkedIn à reconnecter</);
  assert.match(html, /href="\/settings\/account\/connections">Reconnecter</);
});

test('bandeau du tableau de bord : accès restreint, texturé comme l\'autre blocage, SANS bouton « Reconnecter »', () => {
  const html = focus({ linkedinLocked: true });
  assert.match(html, /^<div class="[^"]*"><div class="konekt-card-tex konekt-card-tex--warm /);
  assert.match(html, />Compte LinkedIn restreint</);
  assert.match(html, /Les envois sont en pause/);
  assert.match(html, /Patientez/);
  assert.match(html, /directement sur LinkedIn/);
  assert.doesNotMatch(html, /Reconnecter|<a /, 'ni bouton ni lien : se reconnecter n\'y change rien');
  assert.doesNotMatch(html, /<ul|<li/, 'seul, le bandeau n\'ouvre pas de liste vide');
});

test('bandeau du tableau de bord : jamais les deux à la fois, et rien sans panne', () => {
  const both = focus({ linkedinIssue: true, linkedinLocked: true });
  assert.equal((both.match(/konekt-card-tex--warm/g) || []).length, 1, 'un seul bandeau');
  assert.match(both, />Compte LinkedIn à reconnecter</, 'la reconnexion l\'emporte');
  assert.doesNotMatch(both, /restreint/);
  assert.doesNotMatch(focus({}), /konekt-card-tex|Compte LinkedIn/);
});

test('ligne d\'À traiter : à reconnecter garde son texte, restreint n\'invite pas à reconnecter', () => {
  const reconnect = section('reconnect');
  assert.match(reconnect, /Compte LinkedIn à reconnecter/);
  assert.match(reconnect, /Les envois sont en pause/);
  assert.match(reconnect, /href="\/settings\/account\/connections"/);

  const locked = section('locked');
  assert.match(locked, /Compte LinkedIn restreint/);
  assert.match(locked, /Les envois sont en pause/);
  assert.match(locked, /href="\/settings\/account\/connections"/, 'la carte explique l\'état');
  assert.doesNotMatch(locked, /reconnecter/i);

  assert.equal(section(null), '', 'hors panne : rien');
});

// --------------------------------------------------------------------------- Câblage : une seule source
test('tableau de bord et barre latérale lisent le même hook, donc le même prédicat', () => {
  const hook = read('src/hooks/sidebar/useLinkedInOutage.ts');
  assert.match(hook, /myLinkedInOutage\(/);
  assert.doesNotMatch(hook, /myLinkedInNeedsAction/);
  assert.match(hook, /kind: LinkedInOutageKind \| null/);
  assert.match(hook, /outage: kind !== null/);

  const dashboard = read('src/pages/Dashboard.tsx');
  assert.match(dashboard, /useLinkedInOutage\(\)/);
  assert.match(dashboard, /linkedinIssue=\{linkedinOutage\.kind === 'reconnect'\}/);
  assert.match(dashboard, /linkedinLocked=\{linkedinOutage\.kind === 'locked'\}/);
  assert.doesNotMatch(dashboard, /connections\.linkedin\.status/, 'plus de seconde règle pour le bandeau');

  for (const file of ['src/components/sidebar/todo/TodoPanel.tsx', 'src/hooks/sidebar/useTodoSignal.ts', 'src/components/sidebar/todo/LinkedInOutageSection.tsx']) {
    assert.match(read(file), /useLinkedInOutage\(\)/, file);
  }
});

test('textes : aucun nom de prestataire, pas de tiret cadratin, vouvoiement', () => {
  for (const file of ['src/components/dashboard/DashboardFocusPanel.tsx', 'src/components/sidebar/todo/LinkedInOutageSection.tsx', 'src/hooks/sidebar/useLinkedInOutage.ts']) {
    const src = read(file);
    assert.doesNotMatch(src, /unipile/i, file);
  }
  for (const html of [focus({ linkedinLocked: true }), section('locked')]) {
    assert.doesNotMatch(html, /—|unipile|Apollo|PDL/i);
    assert.doesNotMatch(html, /\b(tu|ton|ta|tes|toi)\b/i);
  }
});

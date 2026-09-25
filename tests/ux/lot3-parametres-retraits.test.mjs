/**
 * Paramètres, lot 3 — retraits.
 *
 * Invariants épinglés, par inspection de source (sans navigateur ni base) :
 *   - les huit fichiers retirés n'existent plus et plus rien ne les importe ;
 *     le hook des variables personnalisées, encore lu par la messagerie, reste ;
 *   - modèle IA par défaut : plus d'écran, plus de lecture, copie locale effacée
 *     au démarrage ;
 *   - Équipe : ni missions assignées, ni badges, ni cartes de chiffres ;
 *   - signatures sans « par défaut », tableau de bord sans WhatsApp ;
 *   - Calendly et Aircall retirés du menu d'ajout, proxy montré seulement s'il
 *     existe, extension masquée sans jeton actif ;
 *   - identifiant de l'organisation retiré de Général ; texte des politiques
 *     qui renvoie au journal de l’assistant.
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const between = (src, start, end) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `repère introuvable : ${start}`);
  const j = end ? src.indexOf(end, i + start.length) : src.length;
  assert.ok(j >= 0, `repère introuvable : ${end}`);
  return src.slice(i, j);
};

/** Fichiers d'un dossier, récursivement, filtrés par extension. */
const walk = (dir, exts) => {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(rel);
  }
  return out;
};

const REMOVED = {
  ConnectorSettings: 'src/components/settings/ConnectorSettings.tsx',
  AgencySettings: 'src/components/settings/AgencySettings.tsx',
  MarketplaceActivation: 'src/components/settings/MarketplaceActivation.tsx',
  MyWhatsAppAccount: 'src/components/settings/MyWhatsAppAccount.tsx',
  CustomVariablesSettings: 'src/components/settings/CustomVariablesSettings.tsx',
  useModelPreference: 'src/hooks/useModelPreference.ts',
  useJobAssignments: 'src/hooks/useJobAssignments.ts',
  useMemberStats: 'src/hooks/useMemberStats.ts',
};

// ---------------------------------------------------------------- 1-2. Fichiers retirés
test('L3-1 — les huit fichiers retirés n’existent plus ; le hook des variables reste', () => {
  for (const rel of Object.values(REMOVED)) assert.equal(existsSync(join(ROOT, rel)), false, `${rel} existe encore`);
  assert.ok(existsSync(join(ROOT, 'src/hooks/useUserTemplateVariables.ts')), 'lu par MessageView et templatePlaceholders');
});

test('L3-2 — aucun import dans src/ ne cite un module retiré', () => {
  const names = Object.keys(REMOVED).join('|');
  const importRe = new RegExp(`(?:\\bfrom\\s+|\\bimport\\s*\\(\\s*|^\\s*import\\s+)['"][^'"]*\\/(?:${names})(?:\\.tsx?)?['"]`, 'm');
  const offenders = walk('src', ['.ts', '.tsx']).filter((rel) => importRe.test(read(rel)));
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------- 3-5. Modèle IA par défaut
test('L3-3 — main.tsx efface la copie locale du modèle par défaut avant le rendu', () => {
  const main = read('src/main.tsx');
  const needle = "localStorage.removeItem('konekt_ai_model_default')";
  const iRemove = main.indexOf(needle);
  assert.ok(iRemove >= 0, `${needle} absent`);
  const iTry = main.lastIndexOf('try {', iRemove);
  assert.ok(iTry >= 0 && main.indexOf('catch', iTry) > iRemove, 'stockage indisponible : removeItem dans un try/catch');
  assert.ok(iRemove < main.indexOf('createRoot('), 'effacé avant createRoot');
  assert.doesNotMatch(main, /removeItem\(['"]konekt_scoring_model/, 'le modèle par mission reste (clé exacte, pas de préfixe)');
});

test('L3-4 — invokeWithCredits ne lit plus de modèle d’organisation', () => {
  const src = read('src/lib/invokeWithCredits.ts');
  for (const gone of ['konekt_ai_model_default', 'localStorage', 'getOrgModelDefault', 'orgModelDefault']) {
    assert.ok(!src.includes(gone), `${gone} encore présent`);
  }
  assert.ok(src.includes('resolveModel(routingTier, modelOverride, null, aiAction)'));
  assert.ok(src.includes('resolveModel(routingTier, options?.modelOverride, null, aiAction)'));
});

test('L3-5 — Abonnement et crédits : plus de sélecteur de modèle', () => {
  const credits = read('src/components/settings/AICreditsSettings.tsx');
  for (const gone of ['Modèle IA par défaut', 'MODEL_CATALOG', 'useModelPreference']) {
    assert.ok(!credits.includes(gone), `${gone} encore présent`);
  }
});

// ---------------------------------------------------------------- 6. Équipe
test('L3-6 — Équipe : ni missions assignées, ni badges, ni cartes de chiffres', () => {
  const team = read('src/components/settings/TeamManagement.tsx');
  // Ancien badge « {stats.active_sequences} séq » ; la confirmation de retrait
  // parle désormais des séquences arrêtées du membre (SEQ-042).
  for (const gone of ['} séq', 'cand/30j', 'Missions assignées', 'Séquences actives', 'Candidats (30j)', 'useJobAssignments', 'useMemberStats', 'useSourcingProjects']) {
    assert.ok(!team.includes(gone), `« ${gone} » encore présent`);
  }
  assert.ok(team.includes('(LinkedIn, quota)'), 'texte des détails réservés aux administrateurs');
  // Repères gardés pour les tests du lot 1 (lot1-profil-equipe).
  assert.ok(team.includes('{/* Expanded panel (admin only) */}'));
  assert.ok(team.includes('{/* Quotas */}'));
});

// ---------------------------------------------------------------- 7-8. Rédaction
test('L3-7 — signatures sans « par défaut », ni interrupteur ni étoile', () => {
  const signatures = read('src/components/settings/EmailSignatures.tsx');
  for (const gone of ['is_default', 'Par défaut', '<Switch']) {
    assert.ok(!signatures.includes(gone), `EmailSignatures : ${gone} encore présent`);
  }
  for (const rel of ['src/components/outreach/sequence/StepEditor.tsx', 'src/components/outreach/SequenceBuilder.tsx']) {
    assert.ok(!read(rel).includes('sig.is_default'), `${rel} : étoile encore affichée`);
  }
});

test('L3-8 — modèles de messages sans variables personnalisées', () => {
  assert.ok(!read('src/components/settings/MessageTemplatesSettings.tsx').includes('CustomVariablesSettings'));
});

// ---------------------------------------------------------------- 9. Tableau de bord
test('L3-9 — tableau de bord sans WhatsApp', () => {
  assert.doesNotMatch(read('src/components/dashboard/DashboardConnections.tsx'), /whatsapp/i);
  assert.ok(!read('src/pages/Dashboard.tsx').includes('whatsapp='));
});

// ---------------------------------------------------------------- 10. Intégrations
test('L3-10 — Calendly et Aircall retirés du menu, proxy seulement s’il existe', () => {
  const integrations = read('src/components/settings/IntegrationsSettings.tsx');
  for (const id of ['calendly', 'aircall']) {
    assert.match(between(integrations, `id: '${id}'`, '\n  },'), /retired: true/, `${id} doit être retiré du menu d’ajout`);
  }
  assert.doesNotMatch(between(integrations, "id: 'notion'", '\n  },'), /retired/, 'Notion reste proposé');
  assert.ok(integrations.includes('!config.retired'));
  // Une clé encore enregistrée garde la carte retirée visible, pour pouvoir la retirer.
  assert.match(between(integrations, 'const visibleIntegrations', '});'), /config\.retired && config\.fields\.some\(f => f\.secret && !!values\[`\$\{f\.key\}_hint`\]\)/);
  const iGuard = integrations.indexOf('if (!hasProxy) return null;');
  assert.ok(iGuard >= 0, 'garde du proxy absente');
  assert.ok(iGuard < integrations.indexOf('<ProxyConfigPanel'), 'la garde précède le panneau du proxy');
  assert.ok(integrations.includes('<WebhookManager />'));
  assert.ok(integrations.includes('allez dans Connexions'));
});

// ---------------------------------------------------------------- 11. Extension
test('L3-11 — extension masquée sans jeton actif, sauf demande explicite', () => {
  const ext = read('src/components/settings/ExtensionTokens.tsx');
  assert.ok(ext.includes('revealWhenEmpty'));
  assert.ok(ext.includes('if (!revealed) return null;'));
  assert.ok(ext.includes('if (revealedRef.current) toast.error('), 'pas de toast pour une carte cachée');
  const iList = ext.indexOf('const list = data.tokens || [];');
  assert.ok(iList >= 0, 'liste des jetons introuvable');
  assert.ok(ext.indexOf('setRevealed(true)', iList) > iList, 'un jeton actif révèle la carte');
  // Rien ne la referme : révoquer le dernier jeton ne la fait pas disparaître.
  assert.ok(!ext.includes('setRevealed(false)'));
  assert.ok(read('src/components/settings/shell/sections.tsx').includes('revealWhenEmpty={revealExtension}'));
  // Détour par /auth : le hash est perdu, le mémo de session prend le relais.
  const guard = read('src/components/ProtectedRoute.tsx');
  const iMemo = guard.indexOf("if (location.hash === '#extension')");
  assert.ok(iMemo >= 0, 'ProtectedRoute ne pose pas le mémo #extension');
  assert.ok(guard.includes('sessionStorage.setItem(EXTENSION_REVEAL_STORAGE_KEY'));
  assert.ok(iMemo < guard.indexOf("withPreviewAccessToken('/auth')"), 'le mémo est posé avant le renvoi vers /auth');
});

// ---------------------------------------------------------------- 12-13. Général et politiques
test('L3-12 — Général sans identifiant d’organisation', () => {
  const general = read('src/components/settings/shell/GeneralSection.tsx');
  assert.ok(!general.includes('Identifiant'));
  assert.ok(!general.includes('organization?.slug'));
});

test('L3-13 — le texte des politiques renvoie au journal de l’assistant', () => {
  const policies = read('src/components/settings/AgentPoliciesSettings.tsx');
  assert.ok(!policies.includes('audit ci-dessous'));
  assert.ok(policies.includes('journal de l’assistant'));
});

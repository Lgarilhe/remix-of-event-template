/**
 * Lot 1 des Paramètres — profil et équipe (vague 2).
 *
 * Invariants épinglés, par inspection de source (exécutable sans navigateur ni
 * base), dans le style de tests/ux/lot1-fiabilite.test.mjs :
 *  - R3 : useCurrentProfile ne lit que les colonnes réelles de profiles, prend
 *    l'e-mail dans la session, n'invente pas d'avatar, et un display_name égal
 *    au préfixe d'e-mail ne masque plus le nom des métadonnées ;
 *  - R13 (hors Settings.tsx) : l'e-mail des membres vient de la RPC
 *    get_org_member_emails dans useTeamMembers, et l'onglet Équipe l'affiche
 *    sous le nom ;
 *  - R5f (onglet Équipe) : une lecture ratée des quotas affiche un bloc
 *    d'erreur, pas 80 par défaut, et masque « Modifier » ; pendant la lecture
 *    (C14, C19), ni 80 ni « Modifier » non plus ;
 *  - C20 (onglet Équipe) : une lecture ratée des liaisons LinkedIn affiche une
 *    erreur avec « Réessayer », pas « Pas de LinkedIn » pour tous ;
 *  - R12 (onglet Équipe) : « Lier » et « Dissocier » passent par la nouvelle
 *    API du hook, la dissociation transmet le compte affiché ;
 *  - réparation 7, étape C : bornes partagées 1 à 500 et éditeur fermé
 *    seulement après un enregistrement confirmé.
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');

const profileHook = read('src/hooks/useCurrentProfile.ts');
const sidebarMenu = read('src/components/sidebar/SidebarUserMenu.tsx');
const dashboard = read('src/pages/Dashboard.tsx');
const teamMembers = read('src/hooks/useTeamMembers.ts');
const createEvent = read('src/components/calendar/CreateEventModal.tsx');
const team = read('src/components/settings/TeamManagement.tsx');
const types = read('src/integrations/supabase/types.ts');

const sliceBetween = (src, start, end) => {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `repère introuvable : ${start}`);
  const to = src.indexOf(end, from);
  assert.ok(to > from, `repère de fin introuvable : ${end}`);
  return src.slice(from, to);
};

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

// Colonnes de la table profiles d'après le type généré (bloc Row).
const profileColumns = (() => {
  const block = sliceBetween(types, '      profiles: {', '        Insert: {');
  const row = block.slice(block.indexOf('Row: {'));
  return new Set([...row.matchAll(/^\s{10}(\w+):/gm)].map((m) => m[1]));
})();

// ---------------------------------------------------------------- R3
test('R3 — aucune lecture de profiles ne demande une colonne absente', () => {
  assert.ok(profileColumns.has('display_name') && profileColumns.has('user_id'), 'bloc Row de profiles introuvable');
  assert.ok(!profileColumns.has('email') && !profileColumns.has('avatar_url'), 'le type généré ne doit pas porter email ni avatar_url');
  const srcDir = new URL('src/', root).pathname;
  const select = /\.from\(\s*['"]profiles['"]\s*\)\s*\.select\(\s*(['"`])([^'"`]*)\1/g;
  const offenders = [];
  let reads = 0;
  for (const file of walk(srcDir)) {
    if (file.endsWith(join('integrations', 'supabase', 'types.ts'))) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(select)) {
      reads += 1;
      const cols = m[2].split(',').map((c) => c.trim()).filter((c) => c && c !== '*' && !c.includes('('));
      const bad = cols.filter((c) => /\b(email|avatar_url|full_name)\b/.test(c) || !profileColumns.has(c.split(/[:\s]/)[0]));
      if (bad.length) offenders.push(`${file.slice(srcDir.length)} : ${bad.join(', ')}`);
    }
  }
  assert.ok(reads >= 10, `lectures de profiles introuvables (${reads}) : le motif ne correspond plus au code`);
  assert.deepEqual(offenders, [], 'colonnes absentes de profiles : PostgREST répond 400 et la lecture entière échoue');
});

test('R3 — le hook ne renvoie plus d\'avatar et prend l\'e-mail de la session', () => {
  assert.doesNotMatch(profileHook, /avatarUrl\s*:/);
  assert.doesNotMatch(profileHook, /avatar_url/, 'aucune colonne avatar_url demandée ni typée');
  assert.match(profileHook, /\.select\('user_id, display_name'\)/);
  assert.match(profileHook, /email:\s*user\?\.email/);
  assert.doesNotMatch(profileHook, /as CurrentProfile/, 'le type est exact : plus de cast qui masquait l\'erreur');
  const iface = sliceBetween(profileHook, 'export interface CurrentProfile', '}');
  assert.doesNotMatch(iface, /\b(email|avatar_url)\b/, 'CurrentProfile ne décrit que des colonnes réelles');
});

test('R3 — un display_name égal au préfixe d\'e-mail ne masque pas les métadonnées', () => {
  assert.match(profileHook, /storedNameIsEmailPrefix\s*\?\s*null/);
  assert.match(profileHook, /storedName\.toLowerCase\(\) === emailLocalPart/);
  const cascade = sliceBetween(profileHook, 'const displayName =', 'const firstName');
  const stored = cascade.indexOf('storedNameIsEmailPrefix');
  const metadata = cascade.indexOf('prettifyName(fallbackFromMetadata)');
  const email = cascade.indexOf('parseEmailToName(');
  assert.ok(stored >= 0 && stored < metadata && metadata < email, 'ordre : nom enregistré, métadonnées, e-mail');
});

test('R3 — barre latérale et salutation n\'attendent plus d\'avatar du profil', () => {
  for (const [name, src] of [['SidebarUserMenu', sidebarMenu], ['Dashboard', dashboard]]) {
    assert.doesNotMatch(src, /profileAvatarUrl/, `${name} lit encore l'avatar du profil`);
    assert.match(src, /const \{ displayName \} = useCurrentProfile\(\);/, name);
  }
  assert.match(sidebarMenu, /const avatarUrl = connections\.linkedin\.avatarUrl \|\| null;/);
  // Depuis le lot 4 du chantier design, la salutation n'affiche plus d'avatar : rien à lire.
  assert.doesNotMatch(dashboard, /avatar_url/);
  assert.doesNotMatch(dashboard, /profil custom upload/, 'le téléversement d\'avatar n\'existe pas');
});

// ---------------------------------------------------------------- R13
test('R13 — useTeamMembers lit l\'e-mail par get_org_member_emails', () => {
  assert.match(teamMembers, /rpc\('get_org_member_emails', \{ p_organization_id: orgId \}\)/);
  assert.match(teamMembers, /email: emailMap\.get\(m\.user_id\) \?\? null/);
  assert.doesNotMatch(teamMembers, /avatarUrl|avatar_url/);
  assert.doesNotMatch(teamMembers, /p\?\.email/, 'profiles n\'a pas de colonne email');
  // Les deux lectures sont indépendantes : l'échec de l'une n'efface pas l'autre.
  assert.match(teamMembers, /Promise\.all\(\[/);
  assert.match(teamMembers, /if \(profilesErr\)/);
  assert.match(teamMembers, /if \(emailsErr\)/);
  assert.match(
    types,
    /get_org_member_emails: \{\s*Args: \{ p_organization_id: string \}\s*Returns: \{ email: string; user_id: string \}\[\]/,
    'entrée de la RPC dans types.ts (à conserver lors d\'une régénération)',
  );
});

test('R13 — le sélecteur de manager n\'attend plus d\'avatar', () => {
  assert.doesNotMatch(createEvent, /m\.avatarUrl/);
  assert.match(createEvent, /m\.displayName \|\| m\.email\?\.split\('@'\)\[0\]/, 'nom, sinon début de l\'e-mail');
});

test('R13 — l\'onglet Équipe affiche l\'e-mail sous le nom, sans doublon', () => {
  assert.match(team, /getEmail\?: \(userId: string\) => string \| null;/);
  assert.match(team, /const memberName = getDisplayName\(member\.user_id\);/);
  assert.match(team, /const memberEmail = getEmail\?\.\(member\.user_id\) \?\? null;/);
  assert.match(team, /\{memberEmail && memberEmail !== memberName && \(/);
});

// ---------------------------------------------------------------- R5f
test('R5f — onglet Équipe : bloc d\'erreur au lieu de 80, « Modifier » masqué', () => {
  assert.match(team, /import \{ ErrorBox \} from '@\/components\/marketplace\/ErrorBox'/);
  assert.match(team, /isError: quotasError, refetch: refetchQuotas,\s*\} = useMemberQuotas\(\)/);
  assert.match(team, /trailing=\{!isEditingQ && !quotasError &&/);
  const errorAt = team.indexOf('quotasError ?');
  assert.ok(errorAt !== -1 && errorAt < team.indexOf('QUOTA_FIELDS.map'), 'bloc d\'erreur avant les champs de quota');
  assert.match(team, /onRetry=\{\(\) => \{ void refetchQuotas\(\); \}\}/);
  assert.match(team, /\{isEditingQ && !quotasError && quotasReady && \(/, 'en erreur ou en lecture, pas de « Sauvegarder »');
});

test('C14/C19 — onglet Équipe : pendant la lecture des quotas, ni 80 ni « Modifier »', () => {
  assert.match(team, /isReady: quotasReady, isError: quotasError/);
  // « Modifier » seulement après une lecture réussie
  assert.match(team, /trailing=\{!isEditingQ && !quotasError && quotasReady && \(/);
  // L'éditeur ne s'ouvre pas sur les défauts
  const start = sliceBetween(team, 'const startEditingQuotas', 'const handleSaveQuotas');
  const guardAt = start.indexOf('if (!quotasReady) return;');
  assert.ok(guardAt !== -1 && guardAt < start.indexOf('getQuotaForUser'), 'garde avant la lecture des valeurs');
  // Indicateur de chargement avant les champs (et donc avant le repli sur DEFAULT_QUOTAS)
  const loadingAt = team.indexOf(') : !quotasReady ? (');
  assert.ok(loadingAt !== -1 && loadingAt < team.indexOf('QUOTA_FIELDS.map'), 'chargement avant les champs de quota');
  assert.match(team.slice(loadingAt, team.indexOf('QUOTA_FIELDS.map')), /Chargement du quota…/);
});

test('C20 — onglet Équipe : liaisons LinkedIn non lues, erreur avec « Réessayer »', () => {
  assert.match(team, /isError: mappingsError, refetch: refetchMappings,/);
  // Ligne repliée : plus de « Pas de LinkedIn » quand la lecture a échoué
  const row = sliceBetween(team, '{linkedInMapping ? (', '{/* Expanded panel (admin only) */}');
  const errAt = row.indexOf(') : mappingsError ? (');
  assert.ok(errAt !== -1 && errAt < row.indexOf('Pas de LinkedIn'), 'erreur testée avant « Pas de LinkedIn »');
  assert.match(row, /Liaison LinkedIn non chargée/);
  // Panneau : bloc d'erreur à la place du sélecteur d'association
  const panel = sliceBetween(team, 'label="Compte LinkedIn"', '{/* Quotas */}');
  const boxAt = panel.indexOf('<ErrorBox title="Impossible de charger les comptes LinkedIn liés." onRetry={() => { void refetchMappings(); }} />');
  assert.ok(boxAt !== -1 && boxAt < panel.indexOf('Associer un compte LinkedIn…'), 'erreur à la place du sélecteur');
  // « Lier » reste bloqué tant que les liaisons ne sont pas lues
  assert.match(panel, /disabled=\{!selectedLinkedInId \|\| isLinking \|\| !mappingsReady\}/);
});

// ---------------------------------------------------------------- R12
test('R12 — « Lier » passe par l\'action serveur, sans nom venu du navigateur', () => {
  const link = sliceBetween(team, 'const handleLinkLinkedIn', 'const startEditingQuotas');
  assert.match(link, /linkAccount\(\{ userId: member\.user_id, linkedinAccountId: selectedLinkedInId \}\)/);
  assert.doesNotMatch(team, /linkedinAccountName/, 'le serveur prend le nom du compte chez le prestataire');
  assert.doesNotMatch(link, /linkedInAccounts\.find/);
  // Liaisons non lues : le serveur remplacerait la liaison réelle du membre.
  assert.match(team, /isReady: mappingsReady/);
  assert.match(team, /disabled=\{!selectedLinkedInId \|\| isLinking \|\| !mappingsReady\}/);
});

test('R12 — « Dissocier » transmet le compte affiché et ne ferme pas la session', () => {
  assert.doesNotMatch(team, /unlinkAccount\(unlinkConfirm\.mappingId\)/);
  assert.match(team, /accountId: linkedInMapping\.linkedin_account_id,/);
  assert.match(
    team,
    /unlinkAccount\(\{ mappingId: unlinkConfirm\.mappingId, expectedAccountId: unlinkConfirm\.accountId \}\)/,
  );
  assert.doesNotMatch(team, /close_?[sS]ession/, 'aucune fermeture de session depuis l\'onglet Équipe');
  assert.match(team, /disabled=\{isUnlinking\}/);
  const dialog = sliceBetween(team, '{/* AlertDialog : dissociation LinkedIn */}', '</AlertDialog>');
  const text = dialog.replace(/\s+/g, ' ');
  assert.match(text, /Les relances qui partent de ce compte seront mises en pause et ses InMails programmés annulés\./);
  assert.match(text, /La session LinkedIn reste ouverte : si le compte est relié de nouveau, les relances pourront être reprises depuis la liste des inscrits\./);
  assert.doesNotMatch(text, /n'est pas affecté côté LinkedIn/);
});

// ---------------------------------------------------------------- 7, étape C
const LEGACY_BOUNDS = /max:\s*200\b|<=\s*500\b|max=\{(200|500)\}|min=\{0\}|entre 0 et 500/;

test('7C — onglet Équipe : bornes partagées 1 à 500, plus de 200 ni de 0', () => {
  assert.match(team, /MAX_ACTIONS_PER_DAY_MIN, MAX_ACTIONS_PER_DAY_MAX, isValidMaxActionsPerDay,\s*\} from '@\/hooks\/useMemberQuotas'/);
  assert.match(team, /max: MAX_ACTIONS_PER_DAY_MAX,/);
  assert.match(team, /min=\{MAX_ACTIONS_PER_DAY_MIN\}/);
  assert.ok(!LEGACY_BOUNDS.test(team), 'TeamManagement garde une borne héritée (200 ou min 0)');
  assert.match(team, /Valeur entre \{MAX_ACTIONS_PER_DAY_MIN\} et \{MAX_ACTIONS_PER_DAY_MAX\}\./);
  assert.match(
    team,
    /disabled=\{isSaving \|\| !isValidMaxActionsPerDay\(editingQuotas\[member\.user_id\]\?\.max_actions_per_day\)\}/,
    '« Sauvegarder » désactivé hors bornes',
  );
});

test('7C — l\'éditeur ne se ferme qu\'après un enregistrement confirmé', () => {
  const save = sliceBetween(team, 'const handleSaveQuotas', '// Available LinkedIn accounts');
  assert.match(save, /if \(!q \|\| !isValidMaxActionsPerDay\(q\.max_actions_per_day\)\) return;/);
  assert.match(save, /upsertQuota\(\{ userId, quotas: q \}, \{\s*onSuccess:/);
  const successAt = save.indexOf('onSuccess');
  const closeAt = save.indexOf('setEditingQuotas');
  assert.ok(successAt !== -1 && closeAt > successAt, 'fermeture de l\'éditeur seulement dans onSuccess');
  assert.equal(save.split('setEditingQuotas').length - 1, 1, 'aucune fermeture inconditionnelle après le mutate');
});

// ---------------------------------------------------------------- Textes
test('Textes visibles : aucun nom de fournisseur dans les fichiers touchés', () => {
  const vendors = /\b(Unipile|Apollo|Anthropic|Claude|Resend|Stripe|BetterContact|People Data Labs|PDL)\b/;
  for (const [name, src] of [
    ['TeamManagement', team], ['useTeamMembers', teamMembers], ['useCurrentProfile', profileHook],
    ['CreateEventModal', createEvent], ['SidebarUserMenu', sidebarMenu], ['Dashboard', dashboard],
  ]) {
    assert.doesNotMatch(src, vendors, name);
  }
});

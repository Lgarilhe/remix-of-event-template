/**
 * Lot C1, réparations des fuites : garde-fous statiques du front.
 *
 * Même forme que tests/ux : lecture du source et assertions sur les motifs,
 * sans navigateur ni base ; les modules purs sont transpilés en mémoire par
 * esbuild. Couvre R11 (textes, formulaire d'invitation, sélecteur de rôle),
 * la décision 17 (Marketplace gelée : publication, invitation et validation
 * de partenaires masquées), R4 côté recruteur (expiration des liens du portail
 * client) et R6 côté front (projection réduite des missions ouvertes).
 *
 * Lancer : node --test tests/c1/c1-front.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD) : c'est
 * ainsi qu'on vérifie que ces tests échouent sur le code d'origine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const between = (src, start, end) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `repère introuvable : ${start}`);
  const j = end ? src.indexOf(end, i + start.length) : src.length;
  assert.ok(j >= 0, `repère introuvable : ${end}`);
  return src.slice(i, j);
};
/** Transpile un extrait TypeScript pur et le charge comme module. */
const loadTs = async (code) => {
  const js = transformSync(code, { loader: 'ts', format: 'esm' }).code;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
};

const HUNT = 'src/components/missions/MissionHuntMode.tsx';
const CIRCLE = 'src/components/marketplace/PartnerCircleCard.tsx';
const INVITE_FORM = 'src/components/settings/InviteMemberForm.tsx';
const TEAM = 'src/components/settings/TeamManagement.tsx';
const FREEZE = 'src/lib/marketplaceFreeze.ts';
const MARKETPLACE_PAGE = 'src/pages/Marketplace.tsx';
const ADMIN = 'src/components/marketplace/PlatformAdminPanel.tsx';
const ENTERPRISE = 'src/components/marketplace/EnterpriseHuntMissions.tsx';
const MISSION_TEAM = 'src/components/missions/process/shared.tsx';
const USE_MARKETPLACE = 'src/hooks/useMarketplace.ts';
const PARTNER_MARKETPLACE = 'src/components/marketplace/PartnerMarketplace.tsx';
const PORTAL_HOOK = 'src/hooks/useClientPortalTokens.ts';
const PORTAL_SCREEN = 'src/components/missions/MissionClientPortal.tsx';

const TOUCHED = [
  HUNT, CIRCLE, INVITE_FORM, TEAM, FREEZE, MARKETPLACE_PAGE, ADMIN, ENTERPRISE,
  MISSION_TEAM, USE_MARKETPLACE, PARTNER_MARKETPLACE, PORTAL_HOOK, PORTAL_SCREEN,
];

// Textes ajoutés par C1 : présents, sans nom de fournisseur ni tiret long.
const NEW_TEXTS = {
  [HUNT]: [
    "Proposer cette mission aux recruteurs partenaires du cercle Konekt n'est pas encore disponible.",
    "Ils postulent, vous choisissez. Le recruteur cherche de son côté : la présentation de candidats dans Konekt n'est pas encore disponible.",
    "verra la fiche complète de la mission, contact du client compris, et ses étapes d'entretien, mais pas vos candidats.",
    "perdra l'accès à la mission. Il sera prévenu par notification.",
    "La publication sur la Marketplace n'est pas encore disponible : vous ne pourrez pas la publier de nouveau pour le moment.",
  ],
  [CIRCLE]: [
    "voient le poste (intitulé, lieu, contrat, compétences clés), l'entreprise et la rémunération, puis postulent.",
    'vous retrouvez la fiche de la mission dans votre liste et vous cherchez des candidats de votre côté.',
    "La présentation de candidats à l'entreprise dans Konekt n'est pas encore disponible.",
    "La consultation des missions ouvertes n'est pas encore disponible.",
    "La Marketplace n'est pas encore ouverte : votre demande reste en attente jusqu'à",
    "La Marketplace n'est pas encore ouverte. Une demande envoyée maintenant reste en attente",
  ],
  [ADMIN]: ["La validation des partenaires n'est pas encore disponible : les demandes restent en attente"],
  [ENTERPRISE]: ["La publication de missions sur la Marketplace n'est pas encore disponible."],
  [MISSION_TEAM]: ["L'invitation de recruteurs partenaires n'est pas encore disponible."],
  [PORTAL_SCREEN]: [
    'Le client voit les candidats retenus et au-delà, jamais les profils à trier, écartés ou seulement contactés.',
    'Chaque nouveau lien est valable {PORTAL_LINK_VALIDITY_DAYS} jours.',
    "Valable jusqu'au",
    'Expiré le',
    'Lien expiré',
  ],
};

// Vendeurs : jamais dans un texte que l'utilisateur lit (CLAUDE.md, Branding).
const VENDORS = /Unipile|Apollo|People Data Labs|\bPDL\b|Kombo|Anthropic|Claude/;

// ─── R11 : textes vrais ──────────────────────────────────────────────────────

test('R11 : le mode chasse ne promet plus de travail commun sur les candidats', () => {
  const src = read(HUNT);
  for (const gone of [
    'ils sourcent avec vous',
    'chercher, scorer et proposer des candidats',
    "Les candidats qu'il a proposés restent dans votre pipeline",
    'prochaine version',
  ]) {
    assert.ok(!src.includes(gone), `« ${gone} » encore présent`);
  }
});

test('R11 : la carte du cercle partenaires décrit ce que voit et fait un partenaire', () => {
  const src = read(CIRCLE);
  for (const gone of [
    "travaillent dessus avec l'entreprise : recherche, scoring, pipeline",
    "vous sourcez directement dans l'espace de travail",
    'prochaine version',
  ]) {
    assert.ok(!src.includes(gone), `« ${gone} » encore présent`);
  }
  // Gardé : vrai pendant la bêta.
  assert.ok(src.includes('Konekt ne prend pas de commission pendant la bêta.'));
});

test("R11 : le formulaire d'invitation ne propose plus « Collaborateur externe »", () => {
  const src = read(INVITE_FORM);
  assert.ok(!src.includes('Collaborateur externe'));
  assert.doesNotMatch(src, /<SelectItem value="collaborator"/);
  assert.match(src, /<SelectItem value="admin">Admin<\/SelectItem>/);
  assert.match(src, /<SelectItem value="member">Membre<\/SelectItem>/);
  assert.match(src, /useState\('member'\)/, 'rôle par défaut inchangé');
});

test('R11 : « Collaborateur » réservé au membre qui l\'a déjà, plus de badge « Externe »', () => {
  const src = read(TEAM);
  const items = [...src.matchAll(/<SelectItem value="collaborator">/g)];
  assert.equal(items.length, 1);
  const before = src.slice(Math.max(0, items[0].index - 120), items[0].index);
  assert.match(before, /\{member\.role === 'collaborator' && \(\s*$/);
  assert.ok(!/>\s*Externe\s*</.test(src), 'badge « Externe » encore présent');
  // Libellé d'affichage gardé pour un rôle existant.
  assert.match(src, /collaborator: 'Collaborateur',/);
});

// ─── Décision 17 : Marketplace gelée jusqu'au lot P2 ─────────────────────────

test('D17 : le gel est déclaré en un seul endroit, actif', async () => {
  assert.ok(existsSync(join(ROOT, FREEZE)), `${FREEZE} absent`);
  const { MARKETPLACE_FROZEN } = await loadTs(read(FREEZE));
  assert.equal(MARKETPLACE_FROZEN, true);
  for (const rel of [HUNT, CIRCLE, MARKETPLACE_PAGE, ADMIN, ENTERPRISE, MISSION_TEAM]) {
    assert.match(read(rel), /import \{ MARKETPLACE_FROZEN \} from '@\/lib\/marketplaceFreeze';/, rel);
  }
});

test("D17 : la configuration d'une mission ne publie plus sur la Marketplace", () => {
  const src = read(HUNT);
  assert.match(src, /const frozen = MARKETPLACE_FROZEN && !isOpen;/);
  const publish = between(src, "{isAdmin && huntStatus === 'draft'", 'Publier sur la marketplace');
  assert.match(publish, /!MARKETPLACE_FROZEN/);
  // Le mode chasse ne s'active plus pendant le gel ; il se désactive encore.
  assert.match(src, /\{frozen && !isEnabled \? null : isAdmin \? \(/);
  // Ni offre de plan pour publier, ni réglages, ni candidatures hors mission ouverte.
  assert.match(src, /\{!frozen && !canPublishPlan && \(/);
  const block = between(src, '{!frozen && (', '{/* Réglages */}');
  assert.ok(block.length < 200);
  // Un partenaire déjà accepté reste visible pour pouvoir mettre fin.
  assert.match(src, /\{\(!frozen \|\| accepted\.length > 0\) && \(/);
});

test('D17 : la page Marketplace ne montre à un cabinet que son adhésion et son état', () => {
  const src = read(MARKETPLACE_PAGE);
  assert.match(src, /isRecruiterOrg && isPartner && !MARKETPLACE_FROZEN\) \{\s*body = <PartnerMarketplace \/>;/);
  assert.equal([...src.matchAll(/<PartnerMarketplace \/>/g)].length, 1);
  assert.match(src, /else if \(isRecruiterOrg && \(isPartner \|\| isSuspended\)\) \{/);
  assert.ok(src.includes('/settings/org/general'), 'lien vers les paramètres gardé (lot 2 des Paramètres)');
});

test("D17 : l'administration du cercle ne valide plus de partenaire, la suspension reste", () => {
  const src = read(ADMIN);
  assert.match(src, /\{p\.status !== 'active' && !MARKETPLACE_FROZEN && \(/);
  assert.match(src, /\{p\.status !== 'suspended' && \(/);
});

test("D17 : l'entreprise ne voit plus ses brouillons comme « En préparation »", () => {
  const src = read(ENTERPRISE);
  assert.match(src, /\{drafts\.length > 0 && !MARKETPLACE_FROZEN && \(/);
  assert.ok(!/puis publiez-la pour la\s*\n\s*proposer/.test(src));
});

test("D17 : plus d'invitation de recruteur partenaire depuis l'équipe de mission", () => {
  const src = read(MISSION_TEAM);
  assert.match(src, /\{!readOnly && \(!MARKETPLACE_FROZEN \|\| invitations\.length > 0\) && \(/);
  assert.match(src, /\{!showInvite && !MARKETPLACE_FROZEN && \(\s*<button\s*onClick=\{\(\) => setShowInvite\(true\)\}/);
  assert.match(src, /\{showInvite && !MARKETPLACE_FROZEN && \(/);
  // Les invitations déjà envoyées restent révocables.
  assert.match(src, /onClick=\{\(\) => cancelInvitation\(inv\.id\)\}/);
});

// ─── R6 : projection réduite des missions ouvertes ───────────────────────────

const OPEN_JOB_FIELDS = ['contract_type', 'location', 'remote_policy', 'seniority', 'skills_must_have', 'title'];

test('R6 : les types ne portent plus le nom du client, l\'organisation ni le poste entier', () => {
  const src = read(USE_MARKETPLACE);
  const open = between(src, 'export interface OpenHuntMission {', '\n}');
  assert.doesNotMatch(open, /client_name|organization_id/);
  assert.match(open, /job_details: OpenHuntMissionJob \| null;/);
  const pick = between(src, 'export type OpenHuntMissionJob = Pick<', '>;');
  const fields = [...pick.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(fields, OPEN_JOB_FIELDS);
  const mine = between(src, 'export interface MyHuntApplication {', '\n}');
  assert.doesNotMatch(mine, /client_name/);
});

test('R6 : la liste blanche du front suit celle de get_open_hunt_missions', () => {
  // Dernière migration qui définit la fonction : c'est elle qui fait foi.
  const dir = 'supabase/migrations';
  const file = readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => read(`${dir}/${f}`).includes('CREATE OR REPLACE FUNCTION public.get_open_hunt_missions()'))
    .pop();
  assert.ok(file, 'aucune migration ne définit get_open_hunt_missions');
  const sql = read(`${dir}/${file}`);
  const fn = between(sql, 'CREATE OR REPLACE FUNCTION public.get_open_hunt_missions()', '$$;');
  const marker = "'job_details', jsonb_strip_nulls(jsonb_build_object(";
  const whitelist = between(fn, marker, ')),').slice(marker.length);
  const keys = [...whitelist.matchAll(/^\s*'([a-z_]+)',/gm)].map((m) => m[1]).sort();
  assert.deepEqual(keys, OPEN_JOB_FIELDS, `${file}`);
  assert.doesNotMatch(fn, /'client_name'|'organization_id'/);
});

test('R6 : les onglets du partenaire ne lisent plus client_name', () => {
  const src = read(PARTNER_MARKETPLACE);
  const openTab = between(src, 'const OpenMissionsTab: React.FC = () => {', 'const MyApplicationsTab');
  const myTab = between(src, 'const MyApplicationsTab: React.FC = () => {', 'const PartnerMissionsTab');
  assert.doesNotMatch(openTab, /client_name/);
  assert.doesNotMatch(myTab, /client_name/);
  assert.match(openTab, /\{mission\.organization_name \|\| 'Entreprise'\}/);
  assert.match(openTab, /target\?\.organization_name \? ` chez \$\{target\.organization_name\}` : ''/);
  assert.match(myTab, /\{a\.organization_name \|\| 'Entreprise'\}/);
});

// ─── R4 côté recruteur : les liens du portail client expirent ────────────────

test('R4 : un nouveau lien porte une date d\'expiration à 90 jours', () => {
  const src = read(PORTAL_HOOK);
  assert.match(src, /export const PORTAL_LINK_VALIDITY_DAYS = 90;/);
  const insert = between(src, ".from('client_portal_tokens')\n        .insert({", '})');
  assert.match(
    insert,
    /expires_at: new Date\(Date\.now\(\) \+ PORTAL_LINK_VALIDITY_DAYS \* 24 \* 60 \* 60 \* 1000\)\.toISOString\(\),/,
  );
});

test('R4 : même règle d\'expiration que client-portal-data (sans date, illisible ou échu)', async () => {
  const src = read(PORTAL_HOOK);
  const snippet = between(src, 'export const PORTAL_LINK_VALIDITY_DAYS', 'export const useClientPortalTokens');
  const { isPortalLinkExpired, PORTAL_LINK_VALIDITY_DAYS } = await loadTs(snippet);
  assert.equal(PORTAL_LINK_VALIDITY_DAYS, 90);
  assert.equal(isPortalLinkExpired(null), true);
  assert.equal(isPortalLinkExpired(undefined), true);
  assert.equal(isPortalLinkExpired(''), true);
  assert.equal(isPortalLinkExpired('pas une date'), true);
  assert.equal(isPortalLinkExpired(new Date(Date.now() - 60_000).toISOString()), true);
  assert.equal(isPortalLinkExpired(new Date(Date.now() + 60_000).toISOString()), false);
});

test("R4 : l'écran affiche l'échéance ; un lien échu ne se copie ni ne s'ouvre", () => {
  const src = read(PORTAL_SCREEN);
  assert.match(src, /import \{ useClientPortalTokens, isPortalLinkExpired, PORTAL_LINK_VALIDITY_DAYS \} from '@\/hooks\/useClientPortalTokens';/);
  assert.match(src, /const expired = isPortalLinkExpired\(t\.expires_at\);/);
  assert.match(src, /disabled=\{expired\}/);
  assert.match(src, /\{!expired && \(\s*<a\s*href=\{`\/client\/\$\{t\.token\}`\}/);
  assert.ok(!src.includes('Lien public pour partager les candidats avec le hiring manager.'));
  // Révoquer reste possible sur un lien échu.
  assert.match(src, /onClick=\{\(\) => handleDelete\(t\.id, t\.client_name\)\}/);
});

// ─── Rédaction ──────────────────────────────────────────────────────────────

test('Rédaction : textes ajoutés présents, sans fournisseur ni tiret long', () => {
  for (const [rel, texts] of Object.entries(NEW_TEXTS)) {
    const src = read(rel);
    for (const t of texts) {
      assert.ok(src.includes(t), `${rel} : « ${t} » absent`);
      assert.doesNotMatch(t, VENDORS, t);
      assert.ok(!t.includes('—'), `tiret long : ${t}`);
    }
  }
});

test('Rédaction : aucun nom de fournisseur dans les fichiers touchés', () => {
  for (const rel of TOUCHED) {
    assert.doesNotMatch(read(rel), VENDORS, rel);
  }
});

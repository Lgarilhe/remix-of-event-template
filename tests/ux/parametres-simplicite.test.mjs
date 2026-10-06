/**
 * Design simplifié, lot Suite 3 : les Paramètres suivent les règles de
 * docs/design/06-simplicite.md, comme le Pipeline global et la messagerie.
 *  - cartes à plat sous chaque rubrique (SettingsAnchor fournit
 *    CardPlainProvider) : ni cadre, ni fond, ni rayon, un filet entre deux
 *    cartes voisines ; hors des Paramètres, une carte garde son rendu ;
 *  - pas de zéro ni d'état qui ne demande rien : plafonds LinkedIn, Base
 *    Konekt, forfait de contacts, compteurs de caractères, historique vide,
 *    invitations vides, palier « Compte mature » ;
 *  - la couleur seulement pour ce qui demande d'agir : état de l'abonnement,
 *    mentions des packs, « Dissocier » au repos, invitation acceptée ;
 *  - les longues explications à la demande (coût par action, protections du
 *    compte LinkedIn), les listes à plat (membres, invitations, modèles,
 *    signatures, outils reliés).
 *
 * Rendu statique de la carte et de la liste des invitations (esbuild, alias @/
 * par tsconfig.app.json), gardes sur le source pour le reste.
 * Lancer : node --test tests/ux/parametres-simplicite.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/** Code sans commentaires : les commentaires citent ce qui a été retiré. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const between = (src, start, end) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `repère introuvable : ${start}`);
  const j = src.indexOf(end, i + start.length);
  assert.ok(j >= 0, `repère introuvable : ${end}`);
  return src.slice(i, j);
};

const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { Card, CardHeader, CardContent, CardPlainProvider } from './src/components/ui/card';",
      "export { SettingsAnchor } from './src/components/settings/shell/SettingsAnchor';",
      "export { PendingInvitations } from './src/components/settings/PendingInvitations';",
      "export { TooltipProvider } from './src/components/ui/tooltip';",
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
  loader: { '.webp': 'empty', '.svg': 'empty', '.png': 'empty' },
  tsconfig: join(ROOT, 'tsconfig.app.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const h = kit.createElement;
const render = (node) => kit.renderToStaticMarkup(h(kit.TooltipProvider, null, node));
const card = () => h(kit.Card, { className: 'p-6' }, h(kit.CardHeader, null, 'Titre'), h(kit.CardContent, null, 'Corps'));

const FILES = {
  credits: 'src/components/settings/AICreditsSettings.tsx',
  billing: 'src/components/settings/BillingSettings.tsx',
  baseKonekt: 'src/components/settings/BaseKonektCard.tsx',
  enrichment: 'src/components/settings/EnrichmentAnalytics.tsx',
  team: 'src/components/settings/TeamManagement.tsx',
  invite: 'src/components/settings/InviteMemberForm.tsx',
  teamSection: 'src/components/settings/shell/TeamSection.tsx',
  general: 'src/components/settings/shell/GeneralSection.tsx',
  integrations: 'src/components/settings/IntegrationsSettings.tsx',
  linkedin: 'src/components/settings/MyLinkedInAccount.tsx',
  safety: 'src/components/settings/LinkedInSafetySettings.tsx',
  aiContext: 'src/components/settings/AiContextSettings.tsx',
  templates: 'src/components/settings/MessageTemplatesSettings.tsx',
  signatures: 'src/components/settings/EmailSignatures.tsx',
};
const src = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, code(rel)]));

test('Carte : à plat sous le fournisseur des Paramètres, inchangée ailleurs', () => {
  const framed = render(card());
  // Hors fournisseur : la carte garde son cadre et reçoit l'ombre légère du relief (01-direction.md, § 4).
  assert.match(framed, /^<div class="rounded-xl border border-border bg-card text-card-foreground shadow-sm p-6">/);
  const plain = render(h(kit.CardPlainProvider, null, card()));
  assert.match(plain, /^<div class="text-card-foreground p-6 border-0 bg-transparent px-0 \[&amp;:not\(:first-child\)\]:border-t \[&amp;:not\(:first-child\)\]:pt-6">/);
  assert.doesNotMatch(plain, /rounded-|bg-card|shadow/, 'ni rayon, ni fond, ni ombre à plat');
  assert.match(plain, /<div class="flex flex-col space-y-1\.5 p-6 px-0 pt-0">Titre<\/div>/);
  assert.match(plain, /<div class="p-6 pt-0 px-0 pb-0">Corps<\/div>/);
});

test('Rubrique : SettingsAnchor met ses cartes à plat et se sépare par un filet', () => {
  const html = render(h(kit.SettingsAnchor, { id: 'membres' }, card()));
  assert.match(html, /^<div id="membres" class="scroll-mt-20 border-t border-border pt-6 empty:hidden first:border-t-0 first:pt-0"><div class="text-card-foreground p-6 border-0/);
  assert.match(src.teamSection, /<SettingsAnchor id="membres">\s*<TeamManagement/);
  assert.match(src.teamSection, /<SettingsAnchor id="invitations">/);
  assert.match(src.general, /<SettingsAnchor id="organisation">\s*<Card>/);
});

test('Invitations : rien sans invitation, liste à plat, une invitation acceptée sans couleur', () => {
  const props = { onCancel: async () => {}, onResend: async () => {}, canManage: true };
  assert.equal(render(h(kit.PendingInvitations, { ...props, invitations: [] })), '');
  const future = new Date(Date.now() + 7 * 864e5).toISOString();
  const html = render(h(kit.PendingInvitations, {
    ...props,
    invitations: [
      { id: 'i1', email: 'ines@exemple.fr', role: 'member', status: 'accepted', created_at: new Date().toISOString(), expires_at: future },
      { id: 'i2', email: 'hugo@exemple.fr', role: 'admin', status: 'pending', created_at: new Date().toISOString(), expires_at: '2020-01-01T00:00:00Z' },
    ],
  }));
  assert.match(html, /^<div class="divide-y divide-border">/);
  assert.doesNotMatch(html, /bg-muted\/50|bg-success/);
  assert.match(html, /bg-muted-foreground" aria-hidden="true"><\/span>Acceptée/);
  assert.match(html, /bg-warning" aria-hidden="true"><\/span>Expirée/, 'une invitation expirée demande un renvoi');
  assert.match(src.invite, /className="mt-4 space-y-2 border-t border-border pt-4 first:mt-0 first:border-t-0 first:pt-0"/);
});

test('Membres : titre « Membres », rôle en texte, jamais répété à côté de son sélecteur', () => {
  assert.match(between(src.team, '<CardTitle', '</CardTitle>'), /Membres/);
  assert.doesNotMatch(src.team, /badgeVariants/);
  assert.match(src.team, /\{!canManage && \(\s*<span className="text-xs text-muted-foreground">\{roleLabels\[member\.role\] \|\| member\.role\}<\/span>\s*\)\}/);
  assert.doesNotMatch(src.team, /isExpanded && 'bg-muted'/, 'ouverte, la ligne garde son fond');
});

test('Connexions : plafonds sans « 0 / N », palier en texte, « Dissocier » neutre au repos', () => {
  const row = between(src.linkedin, 'function QuotaRow', 'function LinkedInQuotaCard');
  const idle = between(row, 'if (used <= 0) {', 'return (\n    <div className="space-y-1">');
  assert.match(idle, /jusqu’à \{cap\}/);
  assert.doesNotMatch(idle, /<Progress|\{used\}/, 'ni barre vide ni zéro');
  assert.match(src.linkedin, /\{status\.ramp_stage && status\.ramp_stage !== 'mature' && \(\s*<span className="text-xs text-muted-foreground">\{rampStageLabel\(status\.ramp_stage\)\}<\/span>/);
  assert.doesNotMatch(src.linkedin, /<Badge/);
  assert.doesNotMatch(src.linkedin, /className="text-danger hover:text-danger/);
  assert.equal((src.linkedin.match(/className="text-muted-foreground hover:text-danger[^"]*" disabled=\{isUnlinking\}/g) || []).length, 2);
});

test('Connexions : les protections du compte LinkedIn se lisent à la demande', () => {
  assert.match(src.safety, /const \[protectionsOpen, setProtectionsOpen\] = useState\(false\);/);
  const block = between(src.safety, '<Collapsible open={protectionsOpen}', '</Collapsible>');
  assert.match(block, /<CollapsibleTrigger asChild>\s*<Button type="button" variant="ghost"/);
  assert.match(block, /Comment Konekt protège votre compte LinkedIn/);
  assert.match(block, /<CollapsibleContent>[\s\S]*PROTECTION_MECHANISMS\.map/);
  assert.doesNotMatch(src.safety, /rounded-lg bg-muted p-3/, 'plus d’encadré gris');
});

test('Rédaction : compteurs seulement quand il y a du texte, listes et suggestions à plat', () => {
  assert.match(src.aiContext, /\{form\.specialty\.length > 0 && \(\s*<p id=\{ids\.specialtyCount\}/);
  assert.match(src.aiContext, /aria-describedby=\{form\.specialty\.length > 0 \? ids\.specialtyCount : undefined\}/);
  assert.match(src.aiContext, /\{form\.free_text\.length > 0 && \(\s*<p id=\{ids\.freeTextCount\}/);
  assert.match(src.aiContext, /\{items\.length > 0 && <span className="tabular-nums text-muted-foreground"> \(\{items\.length\}\/\{MAX_LIST_ITEMS\}\)<\/span>\}/);
  assert.doesNotMatch(src.templates, /border-dashed|rounded-lg border border-border p-3/);
  assert.match(between(src.templates, 'SUGGESTED_TEMPLATES.map', '</ul>'), /variant="ghost"/);
  assert.match(src.templates, /<ul className="divide-y divide-border">\s*\{templates\.map/);
  assert.doesNotMatch(src.templates, /<Badge/);
  assert.match(src.signatures, /<EmptyState\s+variant="compact"\s+icon=\{Mail\}\s+className="border-0"/);
});

test('Crédits : coût par action replié, historique absent sans utilisation, mention des packs neutre', () => {
  assert.match(src.credits, /const \[costsOpen, setCostsOpen\] = useState\(false\);/);
  assert.match(between(src.credits, '<Collapsible open={costsOpen}', '</Collapsible>'), /<CollapsibleContent>[\s\S]*AI_CREDIT_COSTS/);
  assert.match(src.credits, /const showHistory = isLoadingHistory \|\| isHistoryError \|\| history\.length > 0;/);
  assert.match(src.credits, /\{showHistory && \(\s*<Card>/);
  assert.doesNotMatch(src.credits, /Aucune utilisation pour le moment/);
  assert.doesNotMatch(src.credits, /badgeVariants/);
});

test('Abonnement : état en mots, orange seulement s’il faut agir, limites sans tuiles', () => {
  const fn = between(src.billing, 'const statusLabel', '\n};');
  assert.equal((fn.match(/warning: true/g) || []).length, 2, 'paiement en attente et résiliation programmée');
  assert.match(fn, /return \{ label: 'Actif', warning: false \};/);
  assert.match(src.billing, /<span className=\{cn\('text-sm', status\.warning \? 'font-medium text-warning' : 'text-muted-foreground'\)\}>/);
  assert.doesNotMatch(src.billing, /<Badge|bg-muted\/50 p-3/);
});

test('Base Konekt et forfait de contacts : rien d’utilisé, le forfait en clair', () => {
  const base = between(src.baseKonekt, '{includedMonthly > 0 && includedUsed <= 0 ? (', ') : includedMonthly > 0 ? (');
  assert.match(base, /\{includedMonthly\.toLocaleString\('fr-FR'\)\} recherches incluses par mois/);
  assert.doesNotMatch(base, /<Progress|Remise à zéro/);
  assert.doesNotMatch(src.enrichment, /border border-border rounded-lg p-3/);
  assert.match(src.enrichment, /\{includedUsed > 0 \|\| includedMonthly <= 0 \? \(/);
  assert.match(src.enrichment, /plural\(includedMonthly, 'unité incluse', 'unités incluses'\)/);
  assert.match(src.enrichment, /\) : includedUsed > 0 && \(\s*<div className="bg-muted rounded-full h-1\.5/);
});

test('Outils reliés : la ligne part du bord du titre de la rubrique', () => {
  assert.match(src.integrations, /<h4 className="-mx-2">/);
  assert.match(src.integrations, /rounded-lg px-2 py-3 text-left font-normal/);
  assert.doesNotMatch(src.integrations, /CollapsibleContent className="space-y-4 px-4/);
});

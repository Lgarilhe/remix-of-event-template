/**
 * Lot 12 du chantier design, partie 12b : Paramètres, porte « Mon organisation »
 * (Général, Équipe, Abonnement et crédits, Règles de l'assistant) et les
 * notifications en temps réel de l'intégration LinkedIn.
 * Garde-fous de non-régression sur les constats F-01 à F-25 et F-66 pour ces
 * fichiers (docs/design/audit/F-parametres-marketplace-public.md) et D-64
 * (docs/design/audit/D-outreach-messagerie.md).
 *
 * Inspection de source, sans navigateur ni base.
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
/** Code sans commentaires : on vérifie ce qui s'exécute, pas ce qui est raconté. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const between = (src, start, end) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `repère introuvable : ${start}`);
  const j = end ? src.indexOf(end, i + start.length) : src.length;
  assert.ok(j >= 0, `repère introuvable : ${end}`);
  return src.slice(i, j);
};

const FILES = {
  general: 'src/components/settings/shell/GeneralSection.tsx',
  teamSection: 'src/components/settings/shell/TeamSection.tsx',
  orgType: 'src/components/settings/OrgTypeSetting.tsx',
  logo: 'src/components/settings/OrgLogoEditor.tsx',
  integrations: 'src/components/settings/IntegrationsSettings.tsx',
  team: 'src/components/settings/TeamManagement.tsx',
  invite: 'src/components/settings/InviteMemberForm.tsx',
  invitations: 'src/components/settings/PendingInvitations.tsx',
  billing: 'src/components/settings/BillingSettings.tsx',
  credits: 'src/components/settings/AICreditsSettings.tsx',
  enrichment: 'src/components/settings/EnrichmentAnalytics.tsx',
  baseKonekt: 'src/components/settings/BaseKonektCard.tsx',
  policies: 'src/components/settings/AgentPoliciesSettings.tsx',
  connectors: 'src/components/settings/AgentConnectorsSettings.tsx',
  presets: 'src/components/settings/PedigreePresetsSettings.tsx',
  webhooks: 'src/components/outreach/WebhookManager.tsx',
};
const src = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, code(rel)]));

/** Balises d'ouverture d'un composant (attributs compris, flèches => et accolades gérées). */
const openingTags = (c, name) => {
  const tags = [];
  let from = 0;
  for (;;) {
    const start = c.indexOf(`<${name}`, from);
    if (start < 0) return tags;
    let depth = 0;
    let quote = null;
    let i = start + name.length + 1;
    for (; i < c.length; i++) {
      const ch = c[i];
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(c.slice(start, i + 1));
    from = i + 1;
  }
};

/** Littéraux de chaîne et texte JSX (même découpe que scripts/design/ratchet.mjs). */
const visibleStrings = (c) => {
  const cleaned = c
    .replace(/\bconsole\.(?:log|warn|error|info|debug)\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/\bfrom\s+(['"])[^'"\n]*\1/g, '')
    .replace(/^\s*import\s+(['"])[^'"\n]*\1/gm, '');
  return [
    ...[...cleaned.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]),
    ...[...cleaned.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]),
    ...[...cleaned.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]),
    ...[...cleaned.matchAll(/>([^<>{}=;]*[A-Za-zÀ-ÿ][^<>{}=;]*)(?=[<{])/g)].map((m) => m[1]),
  ];
};

// ---------------------------------------------------------------- F-01
test('F-01 — une anatomie de titre de carte : text-sm font-semibold, casse de phrase, icône discrète', () => {
  for (const [name, c] of Object.entries(src)) {
    assert.doesNotMatch(c, /\buppercase\b/, `${name} : titre ou libellé en capitales`);
    assert.doesNotMatch(c, /\btracking-wider\b/, `${name} : espacement de capitales`);
    assert.doesNotMatch(c, /<CardTitle[^>]*text-(?:lg|base)\b/, `${name} : titre de carte hors palier`);
  }
  for (const name of ['general', 'teamSection', 'team', 'billing', 'credits', 'baseKonekt', 'presets']) {
    for (const [title] of src[name].matchAll(/<CardTitle className="[^"]*"/g)) {
      assert.match(title, /text-sm font-semibold/, `${name} : ${title}`);
    }
  }
  // Titres écrits à la main (hors CardTitle) : même palier.
  assert.match(src.enrichment, /<h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">/);
  assert.match(src.webhooks, /<h5 id="notifications-temps-reel" className="text-sm font-semibold text-foreground">/);
  // Action de carte à droite du titre, plus dans le titre lui-même.
  assert.doesNotMatch(between(src.presets, '<CardTitle', '</CardTitle>'), /<Button/);
  assert.match(src.presets, /<CardHeader className="flex-row items-center justify-between gap-3 space-y-0">/);
});

// ---------------------------------------------------------------- F-05
test('F-05 — tailles sur l’échelle nommée, plus aucune taille en pixels', () => {
  for (const [name, c] of Object.entries(src)) {
    assert.doesNotMatch(c, /\btext-\[\d+(?:\.\d+)?px\]/, `${name} : taille arbitraire`);
  }
  // Intitulés de section du panneau d'un membre en casse de phrase.
  const row = between(src.team, 'const SectionRow', '\n);');
  assert.match(row, /<span className="text-sm font-medium text-foreground">/);
});

// ---------------------------------------------------------------- F-06
test('F-06 — politiques de l’assistant : chargement et erreur honnêtes, jamais les valeurs par défaut', () => {
  const p = src.policies;
  assert.match(p, /isPending, isError, refetch \} = useQuery\(/);
  const pending = p.indexOf('{isPending ? (');
  const error = p.indexOf(') : isError ? (');
  const list = p.indexOf('POLICY_TOOLS.map(');
  const digest = p.indexOf('checked={digestEnabled}');
  assert.ok(pending > 0 && pending < error, 'squelette avant l’erreur');
  assert.ok(error < list && error < digest, 'l’erreur remplace la liste et le résumé du matin');
  assert.match(between(p, ') : isError ? (', '<>'), /<ErrorBox title="Impossible de charger les politiques de l’assistant\." onRetry=\{\(\) => \{ void refetch\(\); \}\} \/>/);
  // Message technique de la base jamais à l'écran.
  assert.doesNotMatch(p, /error\.message/);
  // Connecteurs : une lecture ratée ne se lit plus « Aucun connecteur configuré ».
  const c = src.connectors;
  assert.ok(c.indexOf(') : isError ? (') < c.indexOf('Aucun connecteur configuré.'), 'erreur avant l’état vide');
  assert.match(c, /<ErrorBox title="Impossible de charger les connecteurs\." onRetry=\{\(\) => \{ void refetch\(\); \}\} \/>/);
  assert.doesNotMatch(c, /toast\.error\(error\.message\)|Ajout impossible : \$\{|Mise à jour impossible : \$\{/);
});

// ---------------------------------------------------------------- F-09
test('F-09 — type d’organisation : confirmation qui dit la conséquence, écriture après accord', () => {
  const o = src.orgType;
  assert.match(o, /<AlertDialog open=\{!!target\}/);
  assert.match(o, /rights: 'La rubrique Équipe est proposée, le portail client des missions ne l’est pas\.'/);
  assert.match(o, /Il ne doit rester aucun autre membre ni aucune invitation en attente|il ne doit rester aucun autre membre ni aucune invitation en attente/);
  assert.match(o, /\{target\?\.help\} \{target\?\.rights\} Le changement s’applique aussitôt à tous les membres de l’organisation\./);
  // Le choix ouvre la confirmation ; seule l'action de la confirmation écrit.
  assert.match(o, /onValueChange=\{\(value\) => \{ if \(!saving && value !== orgType\) setPending\(value\); \}\}/);
  const action = between(o, '<AlertDialogAction', '</AlertDialogAction>');
  assert.match(action, /e\.preventDefault\(\);/);
  assert.match(action, /void handleSelect\(target\.value\)/);
  assert.match(action, /Changer le type/);
  assert.equal((o.match(/updateOrganization\(/g) || []).length, 1);
});

test('F-09 — rôle d’un membre : confirmation, conséquence écrite, fermée au succès seulement', () => {
  const t = src.team;
  assert.match(t, /onUpdateRole: \(params: \{ memberId: string; role: string \}\) => Promise<unknown>;/);
  // Le sélecteur n'écrit plus : il ouvre la confirmation.
  const select = between(t, '<Select\n                          value={member.role}', '</Select>');
  assert.doesNotMatch(select, /onUpdateRole\(/);
  assert.match(select, /setRoleConfirm\(\{ member, role: value \}\)/);
  const confirm = between(t, 'const handleConfirmRole', '};');
  assert.match(confirm, /await onUpdateRole\(\{ memberId: roleConfirm\.member\.id, role: roleConfirm\.role \}\);\s*setRoleConfirm\(null\);/);
  assert.match(t, /aura les droits d’un administrateur : en plus des missions et des candidats, \$\{ORG_SETTINGS\}\./);
  assert.match(t, /aura les droits d’un membre : les missions et les candidats, sans \$\{ORG_SETTINGS\}\./);
  const dialog = between(t, '<AlertDialog open={!!roleConfirm}', '</AlertDialog>');
  assert.match(dialog, /e\.preventDefault\(\);/);
  assert.match(dialog, /Changer le rôle/);
});

test('F-09 — un seul verbe pour enregistrer, et « Enregistré » en ligne pour les réglages immédiats', () => {
  for (const [name, c] of Object.entries(src)) {
    for (const text of visibleStrings(c)) {
      assert.doesNotMatch(text, /\b(Sauver|Sauvegarder|Mettre à jour)\b/, `${name} : « ${text.trim()} »`);
    }
  }
  for (const name of ['general', 'logo', 'team', 'connectors', 'integrations', 'presets']) {
    assert.match(src[name], /[>}]\s*Enregistrer\s*<|'Enregistrer'/, `${name} : bouton « Enregistrer » attendu`);
  }
  assert.match(src.policies, /import \{ SaveStatus, type SaveState \} from '@\/components\/ui\/save-status';/);
  assert.match(src.policies, /\{saveStates\[tool\.name\] && <SaveStatus state=\{saveStates\[tool\.name\]\} \/>\}/);
  assert.match(src.policies, /setSaveStates\(\(prev\) => \(\{ \.\.\.prev, \[toolName\]: 'saved' \}\)\)/);
});

// ---------------------------------------------------------------- F-13
test('F-13 — ICP : jetons de statut, plus d’ambre ni d’émeraude bruts, plus de variante dark: morte', () => {
  const p = src.presets;
  assert.doesNotMatch(p, /\b(?:amber|emerald)-\d{2,3}\b/);
  assert.doesNotMatch(p, /\bdark:/);
  assert.match(p, /border-warning\/25 bg-warning-muted/);
  assert.match(p, /<AlertCircle className="mt-0\.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" \/>/);
});

// ---------------------------------------------------------------- F-14
test('F-14 — la couleur ne sert qu’aux signaux : pastille de 6 px et mot, consommation neutre', () => {
  // Plus de badges pleins verts « compte connecté » / « Connecté ».
  assert.doesNotMatch(src.integrations, /bg-success text-success-foreground/);
  assert.match(src.integrations, /<span className=\{cn\('h-1\.5 w-1\.5 shrink-0 rounded-full', DOT\[tone\]\)\} aria-hidden="true" \/>/);
  // Historique des crédits : une consommation reste neutre, une recharge en succès.
  assert.match(src.credits, /isCredit \? "text-success" : "text-foreground"/);
  assert.doesNotMatch(src.credits, /isCredit \? "text-success" : "text-destructive"/);
  // Invitations : états en pastille et mot, plus de classes ad hoc ni d'accent gris.
  assert.match(src.invitations, /\{ label: 'Expirée', dot: 'bg-warning' \}/);
  assert.match(src.invitations, /<span className=\{cn\('h-1\.5 w-1\.5 shrink-0 rounded-full', status\.dot\)\} aria-hidden="true" \/>/);
  assert.doesNotMatch(src.invitations, /border-accent\/40|bg-primary\/10/);
  // Plus de bleu LinkedIn hors logo, plus de badge « EXTERNE ».
  for (const [name, c] of Object.entries(src)) {
    assert.doesNotMatch(c, /\b(?:bg|text|border)-linkedin\b/, `${name} : couleur de LinkedIn hors logo`);
    assert.doesNotMatch(c, />\s*EXTERNE\s*</i, name);
  }
});

// ---------------------------------------------------------------- F-15
test('F-15 — libellés reliés, boutons icône nommés, type d’organisation annoncé, en-têtes repliables', () => {
  assert.match(src.general, /<label htmlFor=\{editingName \? 'org-name' : undefined\}/);
  assert.match(src.general, /id="org-name"/);
  assert.match(src.general, /aria-label="Modifier le nom de l’organisation"/);
  assert.match(src.logo, /htmlFor=\{editingWebsite && canEdit \? 'org-website' : undefined\}/);
  assert.match(src.logo, /id="org-website"/);
  assert.match(src.invite, /<label htmlFor="invite-email"/);
  assert.match(src.invite, /id="invite-email"/);
  assert.match(src.invite, /<label htmlFor="invite-role"/);
  assert.match(src.invite, /<SelectTrigger id="invite-role"/);
  assert.match(src.integrations, /<label htmlFor=\{fieldId\}/);
  assert.match(src.integrations, /aria-label=\{`Déconnecter le compte \$\{accountName\}`\}/);
  assert.match(src.integrations, /aria-label="Actualiser la liste des comptes"/);
  assert.match(src.presets, /aria-label=\{`Modifier l'ICP \$\{preset\.name\}`\}/);
  assert.match(src.presets, /aria-label=\{`Supprimer l'ICP \$\{preset\.name\}`\}/);
  // Interrupteur du résumé du matin nommé par son libellé.
  assert.match(src.policies, /<label htmlFor="policy-daily-digest"/);
  assert.match(src.policies, /id="policy-daily-digest"/);
  // Type d'organisation : choix exclusif du kit (aria-pressed, groupe nommé).
  assert.match(src.orgType, /<SegmentedControl<OrgTypeValue>\s+aria-label="Type de l’organisation"/);
  assert.match(read('src/components/ui/segmented-control.tsx'), /aria-pressed=\{active\}/);
  // En-têtes repliables : bouton du kit sous CollapsibleTrigger (aria-expanded), type="button".
  const header = between(src.integrations, 'const IntegrationHeader', '\n);');
  assert.match(header, /<h4 className="-mx-2">\s*<CollapsibleTrigger asChild>\s*<Button\s+type="button"/);
  assert.match(src.team, /aria-expanded=\{isExpanded\}/);
  // Plus aucun <button> écrit à la main dans ces fichiers.
  for (const [name, c] of Object.entries(src)) {
    assert.doesNotMatch(c, /<button\b/, `${name} : bouton fait main`);
  }
});

// ---------------------------------------------------------------- F-16
test('F-16 — Équipe : rôle lisible en entier, actions sous l’identité sur téléphone', () => {
  assert.doesNotMatch(src.team, /w-28 h-8/);
  assert.match(src.team, /<SelectTrigger className="h-8 w-auto min-w-28 gap-2 text-xs max-md:h-11" aria-label=\{`Rôle de \$\{memberName\}`\}>/);
  // Design simplifié : liste à plat, la ligne part du bord du titre (plus de retrait ni de fond à l'ouverture).
  assert.match(src.team, /<div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">/);
  assert.match(src.team, /<div className="flex shrink-0 items-center gap-1\.5 pl-11 sm:w-48 sm:justify-end sm:pl-0">/);
  // Colonne vide sur la ligne du propriétaire : les chevrons restent alignés d'une ligne à l'autre.
  assert.match(src.team, /\) : isOwner \? \(\s*<div className="hidden sm:block sm:w-48 sm:shrink-0" aria-hidden="true" \/>/);
  assert.match(src.invite, /min-w-28/);
  assert.doesNotMatch(src.invite, /(?<!min-)\bw-28\b/);
});

// ---------------------------------------------------------------- F-18
test('F-18 — sous-surfaces arrondies, avatars ronds, boutons en casse de phrase', () => {
  assert.match(src.logo, /h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/);
  assert.match(src.logo, />\s*Supprimer le logo\s*</);
  assert.match(src.team, /grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted/);
  assert.doesNotMatch(src.team, /bg-foreground text-background/);
  // Packs de crédits : tuiles du kit ; la mention du pack en texte neutre posé sur le
  // filet (design simplifié, règle 7), plus de pastille carrée inversée ni de couleur.
  const packs = between(src.credits, 'CREDIT_PACKS.map', '))}');
  assert.match(packs, /<Button/);
  assert.match(packs, /bg-background px-1\.5 text-xs font-medium text-foreground-secondary/);
  assert.doesNotMatch(packs, /badgeVariants|bg-brand/);
  assert.doesNotMatch(packs, /border-2|rounded-md|bg-foreground text-background/);
  // Aucune sous-surface sans rayon.
  for (const [name, c] of Object.entries(src)) {
    assert.doesNotMatch(c, /className="[^"]*\brounded(?:\s|")/, `${name} : rayon « rounded » hors système`);
  }
});

// ---------------------------------------------------------------- F-19
test('F-19 — plus de glyphe servant d’icône (« ✓ », « + » littéral)', () => {
  for (const [name, c] of Object.entries(src)) {
    for (const text of visibleStrings(c)) {
      assert.doesNotMatch(text, /[✓✔✨💡🧩⚠]|\p{Extended_Pictographic}/u, `${name} : « ${text.trim()} »`);
      assert.doesNotMatch(text, /^\s*\+\s+\S/, `${name} : « + » littéral dans « ${text.trim()} »`);
    }
  }
});

// ---------------------------------------------------------------- F-20
test('F-20 — vocabulaire : organisation, français, plus de doublon ni de marque tierce en exemple', () => {
  const all = Object.entries(src);
  for (const [name, c] of all) {
    for (const text of visibleStrings(c)) {
      // Les expressions ${…} d'un gabarit sont du code, pas du texte.
      const t = text.replace(/\$\{[^}]*\}/g, ' ').trim();
      // Un identifiant d'un seul tenant (clé, id, nom de fonction) n'est pas du texte lu, ni
      // les arguments d'un appel pris pour du texte JSX après un type générique (« <T>('…', »).
      if (/^[\w./:?=-]+$/.test(t) || /^\(['"]/.test(t)) continue;
      assert.doesNotMatch(t, /\bagence\b/i, `${name} : « ${t} »`);
      assert.doesNotMatch(t, /\((?:s|e)\)/, `${name} : accord en « (s) » dans « ${t} »`);
      assert.doesNotMatch(t, /\btokens?\b|\bc€|\breset\b|\bsnapshot\b|\bDigest\b|\bWebhooks?\b/i, `${name} : anglicisme dans « ${t} »`);
      assert.doesNotMatch(t, /BlaBlaCar/, `${name} : marque tierce en exemple`);
      assert.doesNotMatch(t, /—/, `${name} : tiret long dans « ${t} »`);
    }
  }
  assert.match(src.integrations, /name: 'Comptes LinkedIn de l\\'organisation'/);
  assert.match(src.connectors, />\s*Désactivé\s*</);
  assert.match(src.policies, />Résumé du matin</);
  // Plus de sous-titre « Invitations » répété dans la carte « Invitations ».
  assert.doesNotMatch(src.invitations, />\s*Invitations\s*</);
  assert.match(src.teamSection, />?\s*Invitations\s*\n\s*<\/CardTitle>/);
});

// ---------------------------------------------------------------- F-21
test('F-21 — annuler une invitation passe par une confirmation', () => {
  const i = src.invitations;
  assert.doesNotMatch(i, /onClick=\{\(\) => onCancel\(inv\.id\)\}/, 'plus d’annulation en un clic');
  assert.match(i, /onClick=\{\(\) => setCancelTarget\(inv\)\}/);
  const dialog = between(i, '<AlertDialog open={!!cancelTarget}', '</AlertDialog>');
  assert.match(dialog, /Annuler cette invitation \?/);
  assert.match(dialog, /className="bg-destructive"/);
  assert.match(dialog, /e\.preventDefault\(\);/);
  const confirm = between(i, 'const handleConfirmCancel', '};');
  assert.match(confirm, /await onCancel\(cancelTarget\.id\);\s*setCancelTarget\(null\);/);
  assert.match(confirm, /toast\.error\('L’invitation n’a pas pu être annulée\. Réessayez\.'\)/);
  assert.match(i, /onCancel: \(id: string\) => Promise<unknown>;/);
});

// ---------------------------------------------------------------- F-22
test('F-22 — crayon pour modifier le site, étincelles réservées à une génération IA', () => {
  assert.doesNotMatch(src.logo, /Building2/);
  assert.match(between(src.logo, 'aria-label="Modifier le site web"', '</Button>'), /<Pencil aria-hidden="true" \/>/);
  for (const name of ['billing', 'enrichment', 'credits']) {
    assert.doesNotMatch(src[name], /\bSparkles\b/, `${name} : étincelle hors génération IA`);
  }
});

// ---------------------------------------------------------------- F-23 (partiel)
test('F-23 — « Outils reliés » titre l’ancre #outils, limites du plan en grille qui se replie', () => {
  const anchor = between(src.general, '<SettingsAnchor id="outils">', '</SettingsAnchor>');
  assert.match(anchor, /<h3 id="outils-titre" className="text-sm font-semibold text-foreground">Outils reliés<\/h3>/);
  assert.match(anchor, /<section aria-labelledby="outils-titre"/);
  assert.ok(anchor.indexOf('Outils reliés') < anchor.indexOf('<IntegrationsSettings />'));
  const limits = between(src.billing, 'Limites du plan', '</Card>');
  assert.doesNotMatch(limits, /grid-cols-2/);
  assert.match(limits, /grid grid-cols-1 gap-3 sm:grid-cols-\[repeat\(auto-fit,minmax\(12rem,1fr\)\)\]/);
});

// ---------------------------------------------------------------- F-24
test('F-24 — « Ajouter une intégration » : menu du kit, icône Plus, filet plein, tuile qui ne se comprime pas', () => {
  const add = between(src.integrations, '{remainingHidden.length > 0 && (', '</DropdownMenu>');
  assert.match(add, /<DropdownMenu>\s*<DropdownMenuTrigger asChild>/);
  assert.match(add, /<Plus aria-hidden="true" \/>\s*Ajouter une intégration/);
  assert.match(add, /<DropdownMenuItem/);
  assert.doesNotMatch(src.integrations, /border-dashed|border-2|showAddMenu/);
  assert.match(src.integrations, /grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted/);
});

// ---------------------------------------------------------------- F-25 (part dans ces fichiers)
test('F-25 — comptes LinkedIn de l’organisation : statut en mots, jamais le code brut', () => {
  assert.match(src.integrations, /import \{ classifyLinkedInStatus, type LinkedInHealth \} from '@\/lib\/linkedinStatus';/);
  assert.match(src.integrations, /const health = LINKEDIN_HEALTH\[classifyLinkedInStatus\(account\.status\)\];/);
  assert.doesNotMatch(src.integrations, /: account\.status\}/, 'le statut brut ne s’affiche plus');
});

// ---------------------------------------------------------------- F-66
test('F-66 — chargements et confirmations destructives sous une forme commune', () => {
  for (const [name, c] of Object.entries(src)) {
    assert.doesNotMatch(c, /BrutalLoader/, `${name} : chargeur « brutal »`);
    for (const [cls] of c.matchAll(/<AlertDialogAction[^>]*className="[^"]*"/g)) {
      assert.match(cls, /className="bg-destructive"$/, `${name} : ${cls}`);
    }
  }
  // Base Konekt : squelette pendant la lecture, erreur avec « Réessayer ».
  assert.match(src.baseKonekt, /<ErrorBox title="Impossible de charger la Base Konekt\." detail=\{errorText\} onRetry=\{refetch\} \/>/);
  assert.doesNotMatch(src.baseKonekt, /Chargement de la Base Konekt\.</);
  // Historique des crédits : une panne propose « Réessayer ».
  assert.match(src.credits, /<ErrorBox title="Historique indisponible pour le moment\." onRetry=\{\(\) => \{ void refetchHistory\(\); \}\} \/>/);
});

// ---------------------------------------------------------------- D-64
test('D-64 — notifications en temps réel : noms métier, jetons, confirmation, action monochrome', () => {
  const w = src.webhooks;
  assert.match(w, /Notifications en temps réel/);
  assert.doesNotMatch(w, /Webhooks Temps Réel|webhook\(s\)|manquant\(s\)/);
  assert.match(w, /label: 'Réponses des candidats'/);
  assert.match(w, /label: 'Invitations acceptées'/);
  // Plus de sources techniques jointes brutes à l'écran.
  assert.doesNotMatch(w, /missingSources\.join\(/);
  assert.match(w, /missingSources\.map\(\(s\) => sourceLabel\(s\)\.toLowerCase\(\)\)\.join\(', '\)/);
  assert.doesNotMatch(w, /\b(?:text|bg)-(?:green|amber)-\d{3}\b/);
  // Suppression confirmée.
  assert.doesNotMatch(w, /onClick=\{\(\) => handleDelete\(webhook\.id\)\}/);
  assert.match(w, /onClick=\{\(\) => setDeleteTarget\(webhook\)\}/);
  const dialog = between(w, '<AlertDialog open={!!deleteTarget}', '</AlertDialog>');
  assert.match(dialog, /className="bg-destructive"/);
  assert.match(dialog, /void handleDelete\(deleteTarget\.id\)/);
  // Action principale monochrome.
  assert.match(between(w, '{missingSources.length > 0 && (', '</Button>'), /variant="primary"/);
  // Une lecture ratée s'affiche en erreur, pas en « trois notifications inactives ».
  assert.match(w, /<ErrorBox title="Impossible de lire l’état des notifications\." onRetry=\{\(\) => \{ void fetchWebhooks\(\); \}\} \/>/);
});

// ---------------------------------------------------------------- Règles transverses
test('Lot 12b — aucun nom de fournisseur dans les textes visibles, cibles de 44 px sur téléphone', () => {
  const VENDORS = /\b(?:Unipile|Apollo|People Data Labs|PDL|Resend|Anthropic|Claude|Stripe|BetterContact)\b/;
  for (const [name, c] of Object.entries(src)) {
    for (const text of visibleStrings(c)) assert.doesNotMatch(text, VENDORS, `${name} : « ${text.trim()} »`);
  }
  let iconButtons = 0;
  for (const name of ['general', 'logo', 'integrations', 'team', 'invitations', 'presets', 'connectors', 'webhooks']) {
    for (const btn of openingTags(src[name], 'Button').filter((t) => /size="icon-(?:xs|sm)"/.test(t))) {
      iconButtons++;
      assert.match(btn, /max-md:h-11 max-md:w-11/, `${name} : bouton icône sous 44 px sur téléphone`);
      assert.match(btn, /aria-label=/, `${name} : bouton icône sans nom`);
    }
  }
  assert.ok(iconButtons >= 12, `trop peu de boutons icône relevés (${iconButtons})`);
});

// ---------------------------------------------------------------- Suites du lot 12b
test('F-06 — ICP : une lecture ratée s’affiche en erreur, jamais en « Aucun ICP configuré »', () => {
  const hook = code('src/hooks/usePedigreePresets.ts');
  assert.match(hook, /setLoadError\(true\);/);
  assert.match(hook, /isError: loadError,/);
  const p = src.presets;
  const error = p.indexOf(') : isError ? (');
  assert.ok(error > p.indexOf('{loading ? ('), 'squelette avant l’erreur');
  assert.ok(error < p.indexOf('title="Aucun ICP configuré"'), 'erreur avant l’état vide');
  assert.match(between(p, ') : isError ? (', '/>'), /title="Impossible de charger les ICP\."[\s\S]*onRetry=\{\(\) => \{ void refresh\(\); \}\}/);
  // Toasts en français, plus de « Non connecté » ni de message brut accolé au titre.
  assert.doesNotMatch(hook, /Non connecté|Erreur lors de la/);
});

test('F-20 — coût par action : libellés en français, badge de remise espacé', () => {
  const catalog = read('src/types/aiCredits.ts');
  const body = between(catalog, 'export const ACTION_COSTS', '\n};');
  const labels = [...body.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(labels.length >= 39);
  for (const label of labels) {
    assert.doesNotMatch(label, /\b(?:Scoring|Screening|Chat|inline|nurturing|live|Email|IA auto)\b/, `« ${label} »`);
  }
  assert.match(catalog, /badge: "-20 %"/);
});

test('F-20 — outils de l’assistant : un seul nom par outil (approbation, politiques, journal)', () => {
  const approval = code('src/components/agent/AgentToolApprovalCard.tsx');
  const journal = code('src/components/settings/AgentActionsSettings.tsx');
  const policies = src.policies;
  const names = {
    update_candidate_stage: 'Modifier l’étape du candidat',
    add_candidate_note: 'Ajouter une note au candidat',
    update_mission_status: 'Modifier le statut de la mission',
    update_mission_brief: 'Modifier le brief de la mission',
    send_email: 'Envoyer un e-mail',
    start_background_scoring: 'Évaluer les candidats d’une mission en arrière-plan',
  };
  for (const [tool, label] of Object.entries(names)) {
    assert.ok(approval.includes(`${tool}: '${label}'`), `carte d’approbation : ${tool}`);
    assert.ok(journal.includes(`${tool}: '${label}'`), `journal : ${tool}`);
    assert.ok(policies.includes(`name: '${tool}', label: '${label}'`), `politiques : ${tool}`);
  }
});

/**
 * Lot 12 du chantier design, partie 12a : coquille des Paramètres et « Mon compte »
 * (Connexions, Rédaction, Journal de l’assistant).
 * Garde-fous de non-régression sur les constats F-01 à F-25 et F-66 de ces fichiers
 * (docs/design/audit/F-parametres-marketplace-public.md), par inspection de source.
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
/** Code sans commentaires : on vérifie ce qui s'exécute, pas ce qui est raconté. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
/** Bloc entre deux repères (le second cherché après le premier). */
const between = (src, start, end) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `repère introuvable : ${start}`);
  const j = end ? src.indexOf(end, i + start.length) : src.length;
  assert.ok(j >= 0, `repère introuvable : ${end}`);
  return src.slice(i, j);
};
/** Littéraux de chaîne et textes JSX, comme le cliquet design (scripts/design/ratchet.mjs). */
const visibleStrings = (src) => {
  const cleaned = src
    .replace(/\bconsole\.(?:log|warn|error|info|debug)\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/\bfrom\s+(['"])[^'"\n]*\1/g, '')
    .replace(/^\s*import\s+(['"])[^'"\n]*\1/gm, '');
  return [
    ...[...cleaned.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]),
    ...[...cleaned.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]),
    ...[...cleaned.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]),
    ...[...cleaned.matchAll(/>([^<>{}=;]*[A-Za-zÀ-ÿ][^<>{}=;]*)(?=[<{])/g)].map((m) => m[1].trim()),
  ];
};

const FILES = {
  shell: 'src/pages/Settings.tsx',
  sections: 'src/components/settings/shell/sections.tsx',
  anchor: 'src/components/settings/shell/SettingsAnchor.tsx',
  redirect: 'src/components/settings/shell/LegacySettingsRedirect.tsx',
  linkedin: 'src/components/settings/MyLinkedInAccount.tsx',
  safety: 'src/components/settings/LinkedInSafetySettings.tsx',
  email: 'src/components/settings/MyEmailAccount.tsx',
  notion: 'src/components/settings/NotionConnectorRow.tsx',
  connectors: 'src/components/settings/AssistantConnectorsCard.tsx',
  extension: 'src/components/settings/ExtensionTokens.tsx',
  aiContext: 'src/components/settings/AiContextSettings.tsx',
  templates: 'src/components/settings/MessageTemplatesSettings.tsx',
  signatures: 'src/components/settings/EmailSignatures.tsx',
  journal: 'src/components/settings/AgentActionsSettings.tsx',
};
const src = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, code(rel)]));
const CARDS = ['linkedin', 'safety', 'email', 'connectors', 'notion', 'extension', 'aiContext', 'templates', 'signatures', 'journal'];

// ---------------------------------------------------------------- F-01
test('F-01 — un seul titre de carte : 13 px, graisse 600, casse de phrase, action à droite', () => {
  for (const key of CARDS) {
    for (const m of src[key].matchAll(/<CardTitle className="([^"]*)"/g)) {
      assert.match(m[1], /\btext-sm font-semibold\b/, `${FILES[key]} : titre de carte ${m[1]}`);
      assert.doesNotMatch(m[1], /uppercase|tracking-wider|text-lg|font-bold/, `${FILES[key]} : ancien titre de carte`);
    }
  }
  // L'action de la carte vit dans l'en-tête, jamais dans le titre (h3) lui-même.
  const signaturesTitle = between(src.signatures, '<CardTitle', '</CardTitle>');
  assert.doesNotMatch(signaturesTitle, /<Button/, 'bouton « Nouvelle signature » dans le titre');
  assert.match(between(src.signatures, '<CardHeader', '</CardHeader>'), /Nouvelle signature/);
  assert.match(between(src.templates, '<CardHeader', '</CardHeader>'), /Nouveau modèle/);
  assert.match(between(src.extension, '<CardHeader', '</CardHeader>'), /Créer un jeton/);
});

// ---------------------------------------------------------------- F-02
test('F-02 — Journal : plus de second en-tête sous celui de la rubrique', () => {
  assert.doesNotMatch(src.journal, /<h2\b/, 'second h2 dans le Journal');
  assert.doesNotMatch(src.journal, /Source de vérité|mis à jour en temps réel/);
  // Seul titre : celui qui nomme la liste, masqué à l'écran (l'en-tête visible est celui de la rubrique).
  const headings = [...src.journal.matchAll(/<h[1-6][^>]*>([^<]*)</g)];
  assert.deepEqual(headings.map((m) => m[1]), ["Actions de l'assistant"]);
  assert.match(headings[0][0], /className="sr-only"/);
  // « Rafraîchir » passe dans la barre de filtres, après la bascule des lectures.
  const filters = between(src.journal, '<Toggle', '<section aria-labelledby={ids.list}');
  assert.match(filters, /Rafraîchir/);
});

// ---------------------------------------------------------------- F-03
test('F-03 — rubrique active : fond discret, texte plein, graisse 600, jamais d’aplat inversé', () => {
  const link = between(src.shell, 'function SectionLink', 'function SettingsList');
  assert.doesNotMatch(link, /bg-foreground text-background/);
  assert.match(link, /isActive\s*\?\s*'bg-muted font-semibold text-foreground'/);
  assert.doesNotMatch(link, /text-foreground\/\d+/, 'texte atténué par opacité');
});

// ---------------------------------------------------------------- F-04
test('F-04 — titres en Instrument Sans ; chasse fixe réservée aux secrets et au code', () => {
  assert.match(src.shell, /<PageHeader title="Paramètres"/);
  assert.equal((src.shell.match(/<PageHeader title="Paramètres"/g) ?? []).length, 2, 'ordinateur et liste du téléphone');
  assert.doesNotMatch(src.shell, /text-2xl font-bold/);
  // LinkedIn : seuls les deux champs de cookie (des secrets) sont en chasse fixe.
  const monoInputs = [...src.linkedin.matchAll(/type="password"[\s\S]{0,260}?className=\{cn\('font-mono/g)];
  assert.equal(monoInputs.length, 2);
  assert.equal((src.linkedin.match(/font-mono/g) ?? []).length, 2, 'chasse fixe hors des cookies');
  // Extension : le jeton à copier seulement, plus le préfixe ni les étapes.
  assert.equal((src.extension.match(/font-mono/g) ?? []).length, 1);
  assert.match(src.extension, /<code className="[^"]*font-mono[^"]*">\{justCreatedToken\}<\/code>/);
});

// ---------------------------------------------------------------- F-05
test('F-05 — six paliers nommés ; les capitales par la seule classe eyebrow', () => {
  for (const key of Object.keys(FILES)) {
    assert.doesNotMatch(src[key], /\btext-\[\d+(?:\.\d+)?(?:px|rem|em)\]/, `${FILES[key]} : taille arbitraire`);
    assert.doesNotMatch(src[key], /\buppercase\b|tracking-wider|tracking-widest/, `${FILES[key]} : capitales hors eyebrow`);
  }
  assert.match(between(src.shell, 'function SettingsNav', 'function SectionLink'), /<h2 id=\{headingId\} className="eyebrow/);
});

// ---------------------------------------------------------------- F-06
test('F-06 — Journal, e-mail et extension : une lecture ratée s’affiche en erreur avec « Réessayer »', () => {
  // Journal : l'erreur passe avant l'état vide, qui distingue « rien encore » et « rien pour ces filtres ».
  assert.match(src.journal, /isLoadingError,\s*isRefetchError,\s*error,\s*refetch,/);
  const list = between(src.journal, '{isLoadingError ? (', '<ul className="space-y-2">');
  assert.match(list, /<ErrorState[\s\S]*onRetry=\{\(\) => \{ void refetch\(\); \}\}/);
  assert.ok(list.indexOf('<ErrorState') < list.indexOf('actions.length === 0'), 'erreur avant le vide');
  assert.match(list, /Aucune action ne correspond à ces filtres\./);
  assert.match(list, /Afficher tous les statuts/);
  // Une actualisation ratée garde la liste lue, et le dit.
  assert.match(src.journal, /\{isRefetchError && \([\s\S]{0,300}Actualisation impossible/);
  // E-mail : une liste non reçue n'est plus un « connectez votre compte ».
  const load = between(src.email, 'const loadEmailAccounts', 'useEffect(');
  assert.match(load, /if \(!options\?\.background\) setListError\(true\);/);
  assert.match(src.email, /\) : listError \? \([\s\S]{0,200}<ErrorState/);
  assert.match(src.email, /useState\(true\);\s*const \[accountsLoaded/, 'chargement dès le montage');
  // Extension : erreur dans la carte, jamais un faux « aucun jeton ».
  const ext = between(src.extension, '{loading ? (', ') : activeTokens.length === 0 ? (');
  assert.match(ext, /loadError \? \(\s*<ErrorState/);
});

// ---------------------------------------------------------------- F-07
test('F-07 — état du compte LinkedIn : libellé et teinte tirés du même état', () => {
  assert.doesNotMatch(src.linkedin, /rawStatus/, 'le statut de la liaison ne décide plus du libellé');
  assert.match(src.linkedin, /const stateDisplay = accountStateDisplay\(li\.state, myAccount\?\.status\);/);
  const fn = between(src.linkedin, 'function accountStateDisplay', 'function statusLabel');
  assert.match(fn, /case 'connected': return \{ label: 'Actif', tone: 'success' \};/);
  assert.match(fn, /default: return \{ label: liveStatus \? statusLabel\(liveStatus\) : 'État à vérifier', tone: 'warning' \};/);
  const row = between(src.linkedin, ') : myMapping && myAccount ? (', ') : myMapping && !myAccount ? (');
  assert.match(row, /STATE_DOT\[stateDisplay\.tone\]/);
  assert.match(row, /STATE_TEXT\[stateDisplay\.tone\]\}>\{stateDisplay\.label\}/);
  assert.doesNotMatch(row, /isAccountHealthy \? 'Actif'/);
});

// ---------------------------------------------------------------- F-08
test('F-08 — téléphone : les actions du compte LinkedIn passent sous l’identité, en pleine largeur', () => {
  const row = between(src.linkedin, ') : myMapping && myAccount ? (', '{canReconnect && reconnectOpen && (');
  assert.match(row, /className="flex flex-col gap-3 rounded-lg bg-muted p-3 sm:flex-row sm:items-center sm:justify-between"/);
  assert.equal((row.match(/max-sm:flex-1/g) ?? []).length, 2, 'Reconnecter et Dissocier en pleine largeur');
  assert.match(row, /<p className="truncate text-sm font-medium text-foreground">\{accountName\}<\/p>/);
});

// ---------------------------------------------------------------- F-09
test('F-09 — un seul verbe « Enregistrer », un état d’enregistrement, jamais « ✓ »', () => {
  for (const key of Object.keys(FILES)) {
    const texts = visibleStrings(src[key]).join('\n');
    assert.doesNotMatch(texts, /\bSauver\b|Sauvegarder|Mettre à jour/, `${FILES[key]} : autre verbe`);
    assert.doesNotMatch(texts, /✓/, `${FILES[key]} : coche littérale`);
  }
  for (const key of ['aiContext', 'safety']) {
    assert.match(src[key], /import \{ SaveStatus, type SaveState \} from '@\/components\/ui\/save-status';/);
    assert.match(src[key], /<SaveStatus state=\{saveState\}/);
    assert.match(src[key], /'saving' : saveFailed \? 'error' : (?:isDirty|dirty) \? 'unsaved' : 'saved'/);
  }
  // Un échec d'enregistrement se voit, sans défaire la garde R7a (un seul setDirty(false)).
  const save = between(src.safety, 'const handleSave', 'const handleReset');
  assert.match(save, /onSuccess: \(\) => setDirty\(false\),\s*onError: \(\) => setSaveFailed\(true\),/);
  assert.match(src.aiContext, /onSave\(form, \{ onError: \(\) => setSaveFailed\(true\) \}\);/);
  assert.match(between(src.signatures, '<DialogFooter>', '</DialogFooter>'), />\s*Enregistrer\s*</);
});

// ---------------------------------------------------------------- F-10
test('F-10 — extension : plus de procédure de développeur, une phrase neutre, les jetons restent', () => {
  const raw = read(FILES.extension);
  for (const gone of ['PowerShell', 'C:\\\\Users', 'npm install', 'npm run build', 'mode développeur', 'non empaquetée', 'chrome://extensions', 'Comment installer']) {
    assert.ok(!raw.includes(gone), `ExtensionTokens : « ${gone} » encore présent`);
  }
  assert.match(src.extension, /L'extension Chrome vous sera proposée ici dès sa publication\./);
  for (const action of ["action: 'list'", "action: 'create'", "action: 'revoke'"]) {
    assert.ok(src.extension.includes(action), `gestion des jetons : ${action}`);
  }
  assert.match(src.extension, /Extension Chrome Konekt/, 'titre lu par e2e/flows/settings-shell.spec.ts');
});

// ---------------------------------------------------------------- F-11
test('F-11 — vouvoiement : Notion, Journal, extension', () => {
  const TU = /\b(?:Clique|Réessaie|Relance la|Choisis|Colle|Ouvre|Active|Sélectionne|approuve-la)\b|\btu (?:vas|pourras)\b|\bTu\b|\bt’est\b|\btes accès\b|\bton assistant\b/;
  for (const key of ['connectors', 'notion', 'journal', 'extension']) {
    for (const text of visibleStrings(src[key])) assert.doesNotMatch(text, TU, `${FILES[key]} : « ${text} »`);
  }
  assert.match(src.notion, /Réessayez ou choisissez un autre espace de travail\./);
  assert.match(src.journal, /Vous allez approuver l'action/);
  assert.match(src.journal, /Action remise en attente : approuvez-la/);
});

// ---------------------------------------------------------------- F-12
test('F-12 — modèles et signatures : Modifier et Supprimer toujours visibles, nommés', () => {
  for (const key of ['templates', 'signatures']) {
    assert.doesNotMatch(src[key], /opacity-0|group-hover:opacity/, `${FILES[key]} : actions au survol seulement`);
  }
  assert.match(src.templates, /aria-label=\{`Modifier le modèle \$\{tpl\.name\}`\}/);
  assert.match(src.templates, /aria-label=\{`Supprimer le modèle \$\{tpl\.name\}`\}/);
  assert.match(src.signatures, /aria-label=\{`Modifier la signature \$\{sig\.name\}`\}/);
  assert.match(src.signatures, /aria-label=\{`Supprimer la signature \$\{sig\.name\}`\}/);
  assert.match(src.signatures, /max-md:h-11 max-md:w-11/, 'cible de 44 px au doigt');
});

// ---------------------------------------------------------------- F-14
test('F-14 — couleur rendue aux signaux : états neutres, écarts en couleur', () => {
  assert.doesNotMatch(src.linkedin, /bg-linkedin/, 'barre de plafond à la couleur d’un canal');
  assert.match(between(src.linkedin, 'function QuotaRow', 'function LinkedInQuotaCard'), /'\[&>div\]:bg-muted-foreground'/);
  assert.doesNotMatch(src.notion, /bg-success text-|bg-white shadow|border-success|bg-success\/5/);
  assert.match(src.notion, /connected: \{ label: 'Connecté', dot: 'bg-success', text: 'text-foreground-secondary' \}/);
  assert.doesNotMatch(src.safety, /bg-success\/|border-success|bg-info\/|border-info/);
  // Journal : un compteur ne prend sa couleur que pour ce qui attend une décision ou a échoué.
  assert.match(src.journal, /accent=\{count > 0 && variant !== 'default'\}/);
  assert.doesNotMatch(src.journal, /text-warning border-warning\/40 hover:bg-warning\/10/);
});

// ---------------------------------------------------------------- F-15
test('F-15 — champs reliés à leur libellé, boutons icône nommés, bascules annoncées', () => {
  for (const key of ['aiContext', 'signatures', 'templates', 'safety', 'linkedin', 'extension']) {
    for (const m of src[key].matchAll(/<Label\b[^>]*>/g)) {
      assert.match(m[0], /htmlFor=/, `${FILES[key]} : ${m[0]}`);
    }
    assert.doesNotMatch(src[key], /<label\b/, `${FILES[key]} : libellé natif`);
  }
  assert.match(src.email, /aria-label="Actualiser la liste des comptes e-mail"/);
  // Journal : une bascule à libellé fixe (Toggle du kit, aria-pressed) au lieu d'« Inclure / Masquer ».
  assert.match(src.journal, /<Toggle[\s\S]*?pressed=\{includeReads\}[\s\S]*?Inclure les lectures\s*<\/Toggle>/);
  assert.doesNotMatch(src.journal, /'Masquer' : 'Inclure'|\{includeReads \? 'Masquer'/);
  // Guides repliables : Collapsible du kit (aria-expanded), plus de <details>.
  assert.doesNotMatch(src.linkedin, /<details|<summary/);
  assert.match(src.linkedin, /<CollapsibleTrigger asChild>/);
});

// ---------------------------------------------------------------- F-17
test('F-17 — ton : le libellé seul dans le champ, l’aide sous le champ', () => {
  const tone = between(src.aiContext, '<Label htmlFor={ids.tone}', '<Label htmlFor={ids.specialty}');
  assert.match(tone, /<SelectItem key=\{opt\.value\} value=\{opt\.value\}>\{opt\.label\}<\/SelectItem>/);
  assert.doesNotMatch(tone, /<SelectItem[^>]*>\s*<div/, 'bloc de deux lignes dans une option');
  assert.match(src.aiContext, /<SelectTrigger id=\{ids\.tone\} aria-describedby=\{ids\.toneHint\} className="max-md:h-11">/);
  assert.match(tone, /<p id=\{ids\.toneHint\}[^>]*>\{tone\.hint\}<\/p>/);
});

// ---------------------------------------------------------------- F-18
test('F-18 — sous-surfaces arrondies dans les cartes, avatar rond', () => {
  for (const key of ['signatures', 'extension', 'linkedin']) {
    assert.doesNotMatch(src[key], /border-2|rounded-none/, `${FILES[key]} : surface carrée`);
  }
  // Design simplifié (règle 3) : les signatures en liste à plat, séparées par des filets fins.
  assert.match(src.signatures, /<ul className="divide-y divide-border">\s*\{signatures\.map/);
  assert.match(src.signatures, /<li key=\{sig\.id\} className="flex items-start justify-between gap-2 py-3">/);
  assert.match(src.extension, /<li key=\{token\.id\} className="[^"]*rounded-lg border border-border/);
  assert.match(between(src.linkedin, 'function AccountAvatar', 'type StateTone'), /rounded-full/);
});

// ---------------------------------------------------------------- F-19
test('F-19 — aucun émoji ni glyphe servant d’icône', () => {
  const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u;
  for (const key of Object.keys(FILES)) {
    for (const text of visibleStrings(src[key])) assert.doesNotMatch(text, EMOJI, `${FILES[key]} : « ${text} »`);
  }
  // Modèles suggérés sans émoji ; celui qu'une personne choisit reste son contenu, décoratif.
  const suggested = between(src.templates, 'const SUGGESTED_TEMPLATES', 'export const MessageTemplatesSettings');
  assert.equal((suggested.match(/emoji: null,/g) ?? []).length, 6);
  assert.doesNotMatch(suggested, /emoji: '/);
  assert.match(src.templates, /<span className="shrink-0 text-lg leading-none" aria-hidden="true">\{tpl\.emoji\}<\/span>/);
});

// ---------------------------------------------------------------- F-20
test('F-20 — vocabulaire : « l’assistant », « organisation », « modèle », « jeton », « e-mail »', () => {
  // Ni les identifiants seuls (clés, noms de fonction serveur, ids), ni les noms de variables
  // interpolées ne s'affichent : on les retire avant de lire le vocabulaire.
  const texts = (key) => visibleStrings(src[key])
    .map((t) => t.replace(/\$\{[^}]*\}/g, ''))
    .filter((t) => !/^[\w-]+$/.test(t) && !t.startsWith('('))
    .join('\n');
  assert.doesNotMatch(texts('templates'), /\btemplates?\b|\bcomposer\b|\bsender\b|\bcustom\b/i);
  assert.doesNotMatch(texts('extension'), /\btokens?\b/i);
  assert.doesNotMatch(texts('aiContext'), /agence|IA Konekt|assistant IA|do\/don't|Patterns|\buser\b/);
  assert.doesNotMatch(texts('safety'), /Cap d'actions|capez|&/);
  assert.doesNotMatch(texts('email'), /\bemails?\b|outreach/i);
  assert.doesNotMatch(texts('notion'), /assistant IA/);
  assert.doesNotMatch(texts('connectors'), /assistant IA/);
  assert.doesNotMatch(texts('journal'), /Recherche RAG|CRM|Stats organisation|Outreach candidat|Envoyer un email|Action \$\{action\}/);
  // Un statut au singulier sur la carte, au pluriel dans les compteurs et le filtre.
  assert.match(src.journal, /executed: \{ label: 'Exécutée', plural: 'Exécutées'/);
  assert.match(src.journal, /label=\{cfg\.plural\}/);
  // Libellé attendu par tests/ux/seq-audit-f5.test.mjs (SEQ-043).
  assert.ok(read(FILES.journal).includes("enroll_in_sequence: 'Inscrire dans une séquence',"));
});

// ---------------------------------------------------------------- F-22
test('F-22 — plus d’étincelles hors d’une génération par l’assistant', () => {
  for (const key of ['aiContext', 'templates']) {
    assert.doesNotMatch(src[key], /Sparkles/, `${FILES[key]} : étincelle`);
  }
});

// ---------------------------------------------------------------- F-25
test('F-25 — fuseaux par leur ville, états du compte e-mail en mots', () => {
  const zones = between(src.safety, 'const TIME_ZONES', 'function utcOffset');
  for (const city of ['Paris', 'Londres', 'Bruxelles', 'Zurich', 'New York', 'Los Angeles']) {
    assert.match(zones, new RegExp(`city: '${city}'`));
  }
  assert.match(src.safety, /<SelectItem key=\{zone\} value=\{zone\}>\{timeZoneLabel\(zone\)\}<\/SelectItem>/);
  assert.doesNotMatch(src.safety, />Europe\/Paris<|>America\/New_York</);
  assert.match(src.linkedin, /fuseau <TimeZoneName timeZone=\{status\.timezone\} \/>/);
  assert.doesNotMatch(src.linkedin, /\(\{status\.timezone\}\)/);
  assert.match(src.email, /function emailStateDisplay/);
  assert.doesNotMatch(src.email, /\{myAccount\.status\}|\{acc\.type\}|\(\$\{myMapping\.provider\}\)/, 'code brut à l’écran');
});

// ---------------------------------------------------------------- F-66
test('F-66 — squelettes pour les blocs, confirmations destructives d’une seule forme', () => {
  for (const key of Object.keys(FILES)) {
    assert.doesNotMatch(src[key], /BrutalLoader|brutal-loader|animate-pulse/, `${FILES[key]} : ancien chargement`);
    for (const m of src[key].matchAll(/<AlertDialogAction[\s\S]*?>/g)) {
      const cls = m[0].match(/className="([^"]*)"/)?.[1];
      if (cls && /destructive/.test(cls)) assert.equal(cls, 'bg-destructive', `${FILES[key]} : ${cls}`);
    }
  }
  for (const key of ['linkedin', 'safety', 'email', 'extension', 'aiContext', 'templates', 'signatures', 'journal']) {
    assert.match(src[key], /<Skeleton\b/, `${FILES[key]} : squelette au chargement`);
  }
  assert.match(src.shell, /<Skeleton className="mx-3 h-5 w-56 max-w-full" aria-hidden="true" \/>/);
});

// ---------------------------------------------------------------- F-21 (part de MyEmailAccount)
test('F-21 — dissocier l’adresse e-mail passe par une confirmation', () => {
  const calls = [...src.email.matchAll(/handleUnlink/g)];
  assert.equal(calls.length, 2, 'définition et un seul appel');
  assert.match(src.email, /<AlertDialogAction onClick=\{handleUnlink\} className="bg-destructive">/);
});

// ---------------------------------------------------------------- Illustrations
test('Illustrations — « connexion » à la place d’une icône quand aucun compte LinkedIn n’est relié', () => {
  assert.equal((src.linkedin.match(/<Illustration\b/g) ?? []).length, 1, 'une illustration par écran');
  // Repère écrit en commentaire dans le composant : lu sur le source brut.
  const raw = read(FILES.linkedin);
  const notLinked = between(raw, '// Not linked (no mapping)', '</CardContent>');
  // Jamais à côté de la liste des comptes disponibles : seulement quand il n'y en a aucun.
  const withAccounts = between(notLinked, '{unlinkedAccounts.length > 0 ? (', ') : (');
  assert.doesNotMatch(withAccounts, /<Illustration/);
  assert.match(withAccounts, /Comptes disponibles/);
  const noAccount = between(notLinked, ') : (', 'Connecter mon LinkedIn');
  // Posé sur la carte des Paramètres : sans tuile de surface carte (contraste v2, 01-direction.md § 8).
  assert.match(noAccount, /<Illustration name="connexion" size="md" tile=\{false\} \/>/);
  assert.match(notLinked, /Connectez votre compte LinkedIn pour pouvoir effectuer des recherches et envoyer des messages\./);
  for (const key of Object.keys(FILES)) {
    if (key === 'linkedin') continue;
    assert.doesNotMatch(src[key], /<Illustration\b|illustration=/, `${FILES[key]} : une seule place dans la zone`);
  }
});

// ---------------------------------------------------------------- Règles transverses
test('Règles — jetons seulement, textes en français sans tiret long ni fournisseur, rien de mort', () => {
  const PALETTE = /\b(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)\b/;
  const VENDORS = /\b(?:Unipile|Apollo|People Data Labs|PDL|Resend|Anthropic|Claude|Deepgram|Coresignal|BetterContact)\b/;
  for (const key of Object.keys(FILES)) {
    assert.doesNotMatch(src[key], PALETTE, `${FILES[key]} : couleur brute`);
    assert.doesNotMatch(src[key], /\bdark:/, `${FILES[key]} : variante dark: morte`);
    assert.doesNotMatch(src[key], /text-(?:muted-)?foreground\/\d+/, `${FILES[key]} : texte atténué par opacité`);
    for (const text of visibleStrings(src[key])) {
      assert.doesNotMatch(text, /—/, `${FILES[key]} : tiret long « ${text} »`);
      assert.doesNotMatch(text, VENDORS, `${FILES[key]} : fournisseur « ${text} »`);
      assert.doesNotMatch(text, /\.\.\./, `${FILES[key]} : points de suspension « ${text} »`);
    }
  }
});

test('Règles — e2e : les textes que cliquent les tests de parcours restent', () => {
  // e2e/flows/seq-scheduled-1.spec.ts (Journal, vue organisation) : il attend l'en-tête de la rubrique.
  assert.match(read('src/components/settings/shell/sections.tsx'), /s\('journal', 'Journal de l’assistant',/);
  assert.match(src.journal, /<SelectItem value="mine">Mes actions<\/SelectItem>/);
  assert.match(src.journal, /<SelectItem value="org">Toute l'organisation<\/SelectItem>/);
  assert.match(src.journal, /label: 'Programmée'/);
  assert.match(src.journal, /Annuler la programmation/);
  assert.match(src.journal, /\n\s*Relancer\n/);
  assert.match(between(src.journal, 'function ActionRow', ''), /<Card>/, 'une carte par action (div.rounded-xl.bg-card)');
  // e2e/flows/notion-connection.spec.ts : Notion, une ligne de « Applications connectées ».
  assert.match(src.connectors, /<CardTitle className="text-sm font-semibold">Applications connectées<\/CardTitle>/);
  assert.match(src.connectors, /<NotionConnectorRow \/>/);
  assert.match(src.notion, /`Espace @\$\{connection\.email_domain\}`/);
  assert.match(src.notion, /'Modifier l’accès' : needsReconnect \? 'Reconnecter' : 'Connecter'/);
  assert.match(src.notion, /access_denied: 'Connexion Notion annulée\. Aucun accès n’a été ajouté\.'/);
});

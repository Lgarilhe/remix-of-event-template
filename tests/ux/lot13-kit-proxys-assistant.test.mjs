/**
 * Chantier design, lot 13 : cinq retouches du kit (interrupteur, carte,
 * confirmation, état vide, ErrorBox), panneau des proxys LinkedIn, boutons de
 * l'assistant et derniers résidus hors refonte mission.
 *
 * Lancer : node --test tests/ux/lot13-kit-proxys-assistant.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
/** Code sans commentaires : les commentaires citent parfois ce qu'on bannit. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Fichiers .ts et .tsx de src, chemins relatifs à la racine. */
const sourceFiles = (() => {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(new URL(rel, ROOT))) {
      const child = `${rel}${name}`;
      if (statSync(new URL(child, ROOT)).isDirectory()) walk(`${child}/`);
      else if (/\.tsx?$/.test(name)) out.push(child);
    }
  };
  walk('src/');
  return out;
})();

/** Blocs `<EmptyState … />` d'un fichier (sans l'import). */
const emptyStates = (src) => [...src.matchAll(/<EmptyState\b[\s\S]*?\/>/g)].map((m) => m[0]);

test('Kit : l’interrupteur garde son dessin et offre 44 px au doigt', () => {
  const sw = code('src/components/ui/switch.tsx');
  assert.match(sw, /"peer relative inline-flex h-6 w-11 /, 'piste inchangée : 24 × 44 px');
  // Bord de 2 px : la zone part du bord intérieur (40 × 20 px), d'où 2 px et 12 px de débord.
  assert.match(sw, /max-md:after:absolute max-md:after:-inset-x-0\.5 max-md:after:-inset-y-3/);
});

test('Kit : une carte se détache par sa luminosité, son filet et une ombre légère', () => {
  const card = code('src/components/ui/card.tsx');
  const base = card.match(/const Card = [\s\S]*?cn\("([^"]+)"/)[1];
  assert.match(base, /\bbg-card\b/);
  assert.match(base, /\bborder border-border\b/);
  assert.match(base, /\bshadow-sm\b/, 'ombre légère : elle donne le relief en thème clair');
  // L'ombre marquée reste aux éléments qui flottent (menus, dialogues, toasts).
  assert.doesNotMatch(base, /shadow-(?:md|lg|xl|2xl)/);
});

test('Kit : la confirmation prend une variante explicite', () => {
  const kit = code('src/components/ui/alert-dialog.tsx');
  assert.match(kit, /variant\?: "primary" \| "destructive";/);
  // L'ancienne consigne (classe bg-destructive) reste lue, seulement sans variante.
  assert.match(kit, /variant === "destructive" \|\|\s*\(variant === undefined && typeof className === "string" && \/\(\^\|\\s\)bg-destructive\(\\s\|\$\)\/\.test\(className\)\)/);
  const confirm = code('src/lib/confirmAlert.tsx');
  assert.match(confirm, /variant=\{destructive \? 'destructive' : 'primary'\}/);
  assert.doesNotMatch(confirm, /bg-destructive/);
  assert.match(read('CLAUDE.md'), /<AlertDialogAction variant="destructive">Supprimer<\/AlertDialogAction>/);
});

test('Kit : le titre d’un état vide suit le niveau de ce qui l’englobe', () => {
  const empty = code('src/components/layout/EmptyState.tsx');
  assert.match(empty, /headingLevel\?: 2 \| 3 \| 4;/);
  assert.match(empty, /headingLevel = 3,/);
  assert.match(empty, /<Heading className=/);
  assert.doesNotMatch(empty, /<h3\b/);
  // À la place du contenu d'une page (sous le h1) : h2. Dans une carte titrée en h3 : h4.
  const levels = {
    'src/pages/Tasks.tsx': 2,
    'src/pages/Agents.tsx': 2,
    'src/pages/Calendar.tsx': 2,
    'src/pages/ATS.tsx': 2,
    'src/pages/ClientPortalV2.tsx': 2,
    'src/components/settings/EmailSignatures.tsx': 4,
    'src/components/settings/ExtensionTokens.tsx': 4,
    'src/components/settings/PedigreePresetsSettings.tsx': 4,
    'src/components/settings/AgentActionsSettings.tsx': 4,
  };
  for (const [rel, level] of Object.entries(levels)) {
    const blocks = emptyStates(code(rel));
    assert.ok(blocks.length > 0, `${rel} : aucun état vide`);
    for (const block of blocks) assert.match(block, new RegExp(`headingLevel=\\{${level}\\}`), `${rel} : h${level} attendu`);
  }
});

test('Kit : ErrorBox vit dans components/layout', () => {
  assert.ok(existsSync(new URL('src/components/layout/ErrorBox.tsx', ROOT)));
  assert.match(code('src/components/layout/index.ts'), /export \{ ErrorBox \} from '\.\/ErrorBox';/);
  // L'ancien chemin ne fait que renvoyer au nouveau, pour les branches en cours.
  assert.equal(code('src/components/marketplace/ErrorBox.tsx').trim(), "export { ErrorBox } from '@/components/layout/ErrorBox';");
  // Seule la refonte mission garde l'ancien chemin, jusqu'au lot 11.
  const oldPath = sourceFiles.filter((rel) => {
    if (rel === 'src/components/marketplace/ErrorBox.tsx') return false;
    const src = read(rel);
    return src.includes("from '@/components/marketplace/ErrorBox'")
      || (rel.startsWith('src/components/marketplace/') && src.includes("from './ErrorBox'"));
  });
  assert.ok(oldPath.every((rel) => rel === 'src/components/missions/MissionHuntMode.tsx'), `ancien chemin : ${oldPath.join(', ')}`);
});

test('Proxys LinkedIn : des mots, sans drapeau ni message technique', () => {
  const proxy = code('src/components/outreach/ProxyConfigPanel.tsx');
  assert.doesNotMatch(proxy, /\p{Extended_Pictographic}|\p{Regional_Indicator}/u, 'aucun drapeau ni emoji');
  assert.doesNotMatch(proxy, /flag|'Custom'|>Custom<|User \(opt\.\)|Pass \(opt\.\)|Pays proxy|text-green-500/);
  assert.match(proxy, /\{ value: 'custom', label: 'Personnalisé' \}/);
  // Un état en mot, jamais la couleur seule.
  assert.match(proxy, /\{ label: 'Actif', dot: 'bg-success' \}/);
  assert.match(proxy, /\{ label: 'En échec', dot: 'bg-danger' \}/);
  // Le message du prestataire reste dans les journaux : l'écran dit quoi faire.
  assert.doesNotMatch(proxy, /\{proxyLastError\}/);
  assert.match(proxy, /Le dernier réglage a été refusé\. Vérifiez-le, puis enregistrez de nouveau\./);
  // Après un enregistrement, l'état suit la réponse du serveur, pas le chargement de la page.
  assert.match(proxy, /const active = outcome === 'ok' \? true : outcome === 'refused' \? false : proxyIsActive;/);
  assert.match(proxy, /const refused = outcome === 'refused' \|\| \(outcome === null && !!proxyLastError\);/);
  assert.match(proxy, /setOutcome\('ok'\);\s*toast\.success\('Proxy enregistré'\);/);
  assert.doesNotMatch(proxy, /data as any|e: any/);
  // Bouton nommé, champs libellés, mot de passe jamais prérempli par le navigateur.
  assert.match(proxy, /loading=\{saving\}[^>]*>\s*Enregistrer\s*<\/Button>/);
  assert.match(proxy, /aria-label=\{`Type de proxy du compte \$\{accountName\}`\}/);
  assert.match(proxy, /aria-label="Pays du proxy"/);
  assert.match(proxy, /aria-label="Adresse IP du proxy"/);
  for (const label of ['Protocole', 'Hôte', 'Port', 'Identifiant (facultatif)', 'Mot de passe (facultatif)']) {
    assert.match(proxy, new RegExp(`<Label htmlFor=\\{\`\\$\\{fieldId\\}-\\w+\`\\} className="text-xs">${label.replace(/[()]/g, '\\$&')}</Label>`), label);
  }
  assert.match(proxy, /type="password"[\s\S]{0,120}autoComplete="new-password"/);
  assert.doesNotMatch(read('src/lib/featureGates.ts'), /getOrgTypeEmoji|\p{Extended_Pictographic}/u);
});

test('Assistant : boutons du kit, noms gardés, 44 px au doigt', () => {
  const panel = code('src/components/agent/AgentChatPanel.tsx');
  const menu = code('src/components/assistant-ui/connector-menu.tsx');
  const thread = code('src/components/assistant-ui/thread.tsx');
  for (const [rel, src] of [['AgentChatPanel', panel], ['connector-menu', menu], ['thread', thread]]) {
    assert.doesNotMatch(src, /<button\b/, `${rel} : bouton écrit à la main`);
  }
  // Infobulle du kit au lieu de l'attribut title ; noms lus par les tests e2e.
  assert.doesNotMatch(panel, /\btitle="/);
  for (const label of ['Revenir à la conversation', "Fermer l'assistant", 'Historique des conversations', 'Nouvelle conversation']) {
    assert.ok(panel.includes(`<HeaderIconButton label="${label}"`), label);
  }
  assert.match(panel, /aria-label=\{label\}[\s\S]{0,80}max-md:h-11 max-md:w-11/);
  assert.match(panel, /<span>Toutes les conversations<\/span>/);
  assert.match(menu, /aria-label=\{triggerLabel\}/);
  assert.match(menu, /<TooltipContent side="top">Ajouter un fichier ou gérer les connecteurs<\/TooltipContent>/);
  assert.match(menu, /<Spinner size="sm" label="Chargement des connecteurs" \/>/);
  assert.match(menu, /aria-label=\{`Connecter \$\{connector\.label\}`\}/);
  // FileUploadTrigger ne transmet pas de ref : l'infobulle s'ancre sur le bouton.
  assert.match(thread, /<FileUploadTrigger asChild>\s*<TooltipTrigger asChild>/);
  assert.match(thread, /aria-label=\{`Retirer le fichier \$\{f\.name\}`\}/);
  assert.match(thread, /max-md:after:absolute max-md:after:-inset-3/);
  assert.match(thread, /rounded-full transition-colors max-md:h-11 max-md:w-11/, 'envoi à 44 px sur téléphone');
});

test('Résidus : tiret long, tutoiement, sélecteur natif, tailles hors échelle', () => {
  assert.match(code('src/hooks/useOrganization.ts'), /'Modification refusée : droits insuffisants'/);
  const edge = code('src/lib/invokeEdgeFunction.ts');
  assert.match(edge, /Contactez le support\./);
  assert.doesNotMatch(edge, /Contacte le support/);
  const inbox = code('src/components/outreach/MessagesInbox.tsx');
  assert.doesNotMatch(inbox, /<select\b|<option\b/);
  assert.match(inbox, /const NO_MISSION = '__none__';/);
  assert.match(inbox, /<SelectTrigger id="inbox-enroll-mission" className="max-md:h-11">/);
  assert.doesNotMatch(code('src/components/ui/chart.tsx'), /rounded-\[/);
  assert.doesNotMatch(code('src/components/ui/calendar.tsx'), /text-\[/);
});
